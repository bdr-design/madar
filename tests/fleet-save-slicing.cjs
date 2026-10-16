'use strict';
const assert=require('node:assert/strict');
const S=require('../WebApp/fleet-store-core'),C=require('../WebApp/state-codec-core');
const count=S.CHUNK_ROWS*2+19,store=S.create(count);
for(let i=0;i<count;i++)S.add(store,{id:`SLICE-${i}`,name:`Asset ${i}`,ownerCompanyId:'air',assetMode:'air',baseFacility:'B1',phase:'idle',progress:0,fuel:100,condition:90});
const state={saveVersion:'3.0.0',fleet:store};
const vault=new Map();
function sliced(){const g=C.serializeChunkedSteps(state,{knownChunkIds:new Set(vault.keys())});let row,steps=0;do{const before=C.cacheStats().chunks.named;row=g.next();assert.ok(C.cacheStats().chunks.named-before<=1,'one checksum-bearing dirty chunk at most per step');steps++;}while(!row.done);for(const chunk of row.value.chunks)if(!vault.has(chunk.id)){assert.ok(chunk.data,'new page must carry immutable snapshot bytes');vault.set(chunk.id,chunk.data.slice());}return {...row.value,steps};}
function roundtrip(saved){const restored=C.deserialize(saved.text,{resolveChunk:id=>vault.get(id)});assert.deepEqual(Buffer.from(restored.fleet.rows),Buffer.from(store.rows));assert.deepEqual(restored.fleet.values,store.values);}
const first=sliced();assert.ok(first.chunks.length>=3);assert.ok(first.steps>first.chunks.length);roundtrip(first);
assert.equal(C.serializeChunked(state).text,first.text,'synchronous and sliced APIs preserve the same exact encoding');
assert.deepEqual(C.serializeChunked(state).chunks,first.chunks,'unchanged chunks retain their identities');
for(const i of [0,S.CHUNK_ROWS,count-1])S.set(store,i,'fuel',70);
const changed=sliced(),firstByKey=new Map(first.chunks.map(c=>[`${c.kind}:${c.index}`,c.id]));
assert.deepEqual(changed.chunks.filter(c=>c.kind==='base'&&c.id!==firstByKey.get(`base:${c.index}`)).map(c=>c.index),[0,1,2]);
assert.ok(changed.chunks.filter(c=>c.kind==='overlay').every(c=>c.id===firstByKey.get(`overlay:${c.index}`)),'fuel writes preserve all overlay pages');roundtrip(changed);

// The rotating corruption check still catches a write that bypassed Store and renames the affected page.
const prior=C.cacheStats().chunks.mismatches;new Uint8Array(store.rows)[S.CHUNK_ROWS*S.STRIDE+100]^=1;
let repaired;for(let attempt=0;attempt<changed.chunks.length*4&&C.cacheStats().chunks.mismatches===prior;attempt++)repaired=sliced();
assert.equal(C.cacheStats().chunks.mismatches,prior+1);const changedIds=new Map(changed.chunks.map(c=>[`${c.kind}:${c.index}`,c.id]));
assert.notEqual(repaired.chunks.find(c=>c.kind==='base'&&c.index===1).id,changedIds.get('base:1'));
assert.ok(repaired.chunks.filter(c=>c.kind==='overlay').every(c=>c.id===changedIds.get(`overlay:${c.index}`)),'base corruption does not churn daily counter pages');roundtrip(repaired);

// A write between slices cannot publish a manifest combining different revisions; a fresh retry remains valid.
for(const i of [0,S.CHUNK_ROWS,count-1])S.set(store,i,'fuel',60);
const interrupted=C.serializeChunkedSteps(state);assert.equal(interrupted.next().done,false);S.set(store,1,'fuel',50);
assert.throws(()=>interrupted.next(),/state-codec-fleet-changed-during-save/);roundtrip(sliced());
console.log('FLEET_SAVE_SLICING_PASS');
