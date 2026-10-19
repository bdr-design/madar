'use strict';
// Emulated phone (200,000 assets, 4x CPU, every company): a command's early upload (persistence prestageDurableChunks)
// serialized the whole save to upload the fleet's chunks, discarded the text, and the commit serialized it again
// (128 ms of the early pass in 9 frames for one decision). The early pass now asks the codec for the fleet's chunks
// only (serializeChunkedSteps fleetChunksOnly). Across the eleven companies: decision time 5,968 -> 4,882 ms, the early
// pass's work 1,434 -> 330 ms, the wait for it 1,062 -> 62 ms. Proven with the real codec and fleet store:
//  1. the fleet-only pass returns no text and exactly the fleet chunks (ids, kinds, bytes) of a full serialization;
//  2. running it first changes nothing in the full save that follows (text equal to a fresh codec's);
//  3. after a fleet write both name the same new chunk ids;
//  4. the early upload asks for the fleet's chunks only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {harness}=require(path.join(ROOT,'tests/helpers/core-harness'));
const {fleet}=require(path.join(ROOT,'tests/helpers/fleet-fixture.js'));
const realm=()=>harness(['transaction-core','fleet-store-core','simulation-asset-core','fleet-event-core','fleet-access-core','state-codec-core']).s;
const drain=steps=>{let step;while(!(step=steps.next()).done){}return step.value;};
const template=fleet(),ordinary=template.filter(a=>['A1','S1','R1'].includes(a.routeId)&&!a.salePending&&!a.simulationFault&&a.phase);
function world(s){
  const rows=s.GH_FLEET_STORE.CHUNK_ROWS,assets=template.map(a=>structuredClone(a));
  for(let i=0;assets.length<rows*2+3000;i++)assets.push({...structuredClone(ordinary[i%ordinary.length]),id:'PRE-'+i,name:'Pre '+i});
  return {saveVersion:'3.0.0',saveRevision:3,simSeconds:0,fleet:s.GH_FLEET_STORE.fromAssets(assets,{at:0}),finance:{note:'x'},domainRuntime:{commands:[]}};
}
// Plain values: the codecs live in their own realms (vm contexts), so their arrays have other prototypes.
const plain=value=>JSON.parse(JSON.stringify(value));
const fleetChunks=out=>plain(out.chunks.filter(c=>typeof c.text!=='string'&&!String(c.id).includes('.o.')).map(c=>[c.id,c.kind,c.byteLength]));
const known=new Set();
// 1 and 2.
const a=realm(),stateA=world(a),early=drain(a.GH_STATE_CODEC.serializeChunkedSteps(stateA,{knownChunkIds:known,fleetChunksOnly:true}));
assert.equal(early.text,null,'1: the fleet-only pass writes no save text');
const full=drain(a.GH_STATE_CODEC.serializeChunkedSteps(stateA,{knownChunkIds:known}));
assert.deepEqual(plain(early.chunks.map(c=>[c.id,c.kind,c.byteLength])),fleetChunks(full),'1: exactly the fleet chunks of the full save');
const b=realm(),stateB=world(b),fresh=drain(b.GH_STATE_CODEC.serializeChunkedSteps(stateB,{knownChunkIds:new Set()}));
// Chunk ids carry a per-codec stamp: each id is replaced by its position in the save's chunk list before comparing.
const normal=out=>out.chunks.reduce((text,chunk,index)=>text.split(chunk.id).join(`#${index}`),out.text);
assert.equal(normal(full),normal(fresh),'2: the full save after the early pass equals a fresh codec\'s');
assert.deepEqual(fleetChunks(full).map(c=>c.slice(1)),fleetChunks(fresh).map(c=>c.slice(1)),'2: and the same fleet chunks (kinds and sizes)');
// 3. A fleet write: both passes name the same new ids.
a.GH_FLEET_STORE.set(stateA.fleet,a.GH_FLEET_STORE.CHUNK_ROWS+11,'fuel',12.5);
const early2=drain(a.GH_STATE_CODEC.serializeChunkedSteps(stateA,{knownChunkIds:known,fleetChunksOnly:true})),full2=drain(a.GH_STATE_CODEC.serializeChunkedSteps(stateA,{knownChunkIds:known}));
assert.deepEqual(plain(early2.chunks.map(c=>c.id)),fleetChunks(full2).map(c=>c[0]),'3: the same ids after a fleet write');
assert.notDeepEqual(plain(early2.chunks.map(c=>c.id)),plain(early.chunks.map(c=>c.id)),'3: the written chunk has a new id');
// 4. The early upload asks for the fleet's chunks only.
assert.match(fs.readFileSync(path.join(ROOT,'WebApp/persistence-core.js'),'utf8'),/const save=await serializeNativeSliced\(state,async\(\)=>\{await yieldToFrame\(\);stopIfReleased\(\);\},timing,\{retake:false,fleetChunksOnly:true\}\);/);
console.log(JSON.stringify({suite:'build526-prestage-fleet-chunks-only',ok:true,fleetChunks:early.chunks.length,textChunks:full.chunks.length-early.chunks.length}));
