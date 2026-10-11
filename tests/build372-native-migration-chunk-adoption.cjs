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
  for(let index=0;index<marker.chunks.length;index++){
    const id=marker.chunks[index],part=encoded.chunks.find(row=>row.id===id&&row.index===index&&Number.isInteger(row.byteOffset));
    assert(part,`missing fleet chunk descriptor ${index}`);
    chunks.set(id,store.rows.slice(part.byteOffset,part.byteOffset+part.byteLength));
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

const second=CODEC.serializeChunked(loaded.state),next=fleetChunks(second,loaded.state.fleet);
assert.notEqual(next.marker.chunks[0],vault.marker.chunks[0],'a row changed after adoption receives a new chunk id');

const reopenedVault=new Map(vault.chunks);
for(const [id,buffer] of next.chunks)if(!reopenedVault.has(id))reopenedVault.set(id,buffer);
const reopened=CODEC.deserialize(second.text,{resolveChunk:id=>reopenedVault.get(id)});
assert.equal(STORE.peek(reopened.fleet,0,'condition'),37,'the migrated row survives save and reopen');

console.log(JSON.stringify({ok:true,oldChunk:vault.marker.chunks[0],newChunk:next.marker.chunks[0],condition:STORE.peek(reopened.fleet,0,'condition')}));
