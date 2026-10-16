'use strict';
// Build 372: a native fleet adopts the ids of the vault chunks it was decoded from before load-time migrations write
// the store. A migrated row must therefore move its chunk stamp, receive a new id on the first save, and survive the
// next decode. Adopting after normalize() would bind the old id to the changed bytes and this test would fail.
const assert=require('node:assert/strict'),path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
global.window=global;
const STORE=require(path.join(ROOT,'WebApp/fleet-store-core.js'));
const CODEC=require(path.join(ROOT,'WebApp/state-codec-core.js'));
require(path.join(ROOT,'WebApp/migration-core.js'));

const original={
  saveVersion:'3.0.0',simSeconds:0,
  fleet:STORE.fromAssets([{id:'QA-NATIVE-1',name:'QA Native 1',ownerCompanyId:'air',assetMode:'air',type:'air',phase:'idle',progress:0,fuel:100,condition:91}],{at:0})
};

function fleetChunks(encoded,store){
  const tree=JSON.parse(encoded.text),marker=tree.fleet.rows,chunks=new Map();
  for(const part of encoded.chunks.filter(row=>row.kind==='base'||row.kind==='overlay')){
    assert(part.data instanceof Uint8Array,`missing immutable fleet page ${part.kind}:${part.index}`);
    const copy=part.data.slice();chunks.set(part.id,copy.buffer);
  }
  return {tree,marker,chunks};
}

const first=CODEC.serializeChunked(original),vault=fleetChunks(first,original.fleet),noted=[];
global.GH_PERSISTENCE={noteVaultChunks:ids=>noted.push(...ids)};
global.__GH_NATIVE_SAVE_JSON__=first.text;
global.__GH_NATIVE_SAVE_CHUNKS__=new Map([...vault.chunks].map(([id,buffer])=>[id,buffer.slice(0)]));

const saveSchema={
  validate:()=>({ok:true,errors:[]}),
  normalize:state=>{STORE.set(state.fleet,0,'condition',37);return state;}
};
const loaded=global.GH_MIGRATION_CORE.load({defaultState:{saveVersion:'3.0.0'},storageKey:'qa-native-migration-chunks',saveSchema});
assert.equal(STORE.peek(loaded.state.fleet,0,'condition'),37,'load-time normalization changed the row');
assert.deepEqual(noted,vault.marker.chunks,'the original ids are known to exist in the vault');
assert.equal(STORE.hasReplicaSeed(loaded.state.fleet),true,'the loaded base pages and daily overlays seed the engine replica');
const seed=STORE.takeReplicaSeed(loaded.state.fleet);
assert.equal(seed.chunks.length,1);assert.equal(seed.overlays.length,1,'counter page is carried with the native row seed');
const seeded=new Uint8Array(seed.byteLength),rowView=new DataView(seeded.buffer),base=new Uint8Array(seed.chunks[0]),overlay=new Uint8Array(seed.overlays[0]);seeded.set(base);
for(let row=0;row<seeded.byteLength/STORE.STRIDE;row++){
  const rowAt=row*STORE.STRIDE,pageAt=row*13;
  for(const [field,name] of ['flightHours','flightCycles','nextCheckHours'].entries())seeded.set(overlay.subarray(pageAt+field*4,pageAt+field*4+4),rowAt+STORE.O[name]*4);
  const at=rowAt+STORE.O.present*4,prior=rowView.getUint32(at,true);rowView.setUint32(at,(prior&~seed.presenceMask)|((overlay[pageAt+12]<<18)&seed.presenceMask),true);
}
assert.deepEqual(seeded,new Uint8Array(original.fleet.rows),'native seed pages reconstruct the persisted rows exactly');
const changes=STORE.drainReplica(loaded.state.fleet);
assert.deepEqual([...changes.rows],[0],'the load-time normalization is retained as a delta after the seed');

const second=CODEC.serializeChunked(loaded.state),next=fleetChunks(second,loaded.state.fleet);
assert.notEqual(next.marker.baseChunks[0],vault.marker.baseChunks[0],'a row changed after adoption receives a new base id');

const reopenedVault=new Map(vault.chunks);
for(const [id,buffer] of next.chunks)if(!reopenedVault.has(id))reopenedVault.set(id,buffer);
const reopened=CODEC.deserialize(second.text,{resolveChunk:id=>reopenedVault.get(id)});
assert.equal(STORE.peek(reopened.fleet,0,'condition'),37,'the migrated row survives save and reopen');

console.log(JSON.stringify({ok:true,oldChunk:vault.marker.chunks[0],newChunk:next.marker.chunks[0],condition:STORE.peek(reopened.fleet,0,'condition')}));
