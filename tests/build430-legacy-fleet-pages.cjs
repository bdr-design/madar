'use strict';
// Immutable old-writer fixtures keep real historical decoding covered after
// deleting that writer. The next save must use lanes; old saves stay readable.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');global.window=global;global.GH_NATIVE_ROW_PATCHES=1;
const S=require(path.join(ROOT,'WebApp/fleet-store-core.js')),C=require(path.join(ROOT,'WebApp/state-codec-core.js')),fixture=require('./fixtures/build430-legacy-fleet-pages.json'),results=[];
for(const item of fixture.cases){
 const chunks=new Map(item.chunks.map(([id,b64])=>[id,Uint8Array.from(Buffer.from(b64,'base64'))])),options={resolveChunk:id=>chunks.get(id)},tree=JSON.parse(item.text),loaded=C.deserialize(item.text,options);
 assert.equal(Buffer.from(loaded.fleet.rows).toString('base64'),item.rowsBase64,item.label+': historical records restore bit for bit');assert.equal(loaded.historicalDocument.signature,'immutable historical codec sentinel');
 assert.equal(C.adoptChunkIds(loaded.fleet,tree.fleet.rows),false,'old page identities cannot seed a new lane writer');
 const next=C.serializeChunked(loaded,{knownChunkIds:new Set(chunks.keys())}),nextTree=JSON.parse(next.text);assert.equal(nextTree.fleet.rows.lanes?.version,1,'every new save converts old pages to independent lanes');assert.deepEqual(nextTree.fleet.rows.overlay,{version:2},'old readers must reject the new physical layout explicitly');assert.equal(nextTree.fleet.rows.rowPatches,undefined);
 for(const p of next.chunks)if(p.data)chunks.set(p.id,p.data);const restored=C.deserialize(next.text,options);assert.equal(Buffer.from(restored.fleet.rows).toString('base64'),item.rowsBase64);assert.deepEqual(restored.historicalDocument,loaded.historicalDocument);
 let rejected=0;for(const mutate of [x=>x.fleet.rows.overlay.version=2,x=>x.fleet.rows.overlay.presentMask=0,x=>x.fleet.rows.overlay.chunks=[],x=>x.fleet.rows.baseNormalized=[],x=>x.fleet.rows.chunks.pop()]){const bad=JSON.parse(item.text);mutate(bad);assert.throws(()=>C.decodeState(bad,options),/corrupt/);rejected++;}
 const patch=tree.fleet.rows.rowPatches?.chunks[0];if(patch){const original=chunks.get(patch.id);for(const at of [0,8,12,16,20,24]){const bad=original.slice();bad[at]^=255;assert.throws(()=>C.deserialize(item.text,{resolveChunk:id=>id===patch.id?bad:chunks.get(id)}),/corrupt/);rejected++;}}
 results.push({case:item.label,exactRestore:true,convertedToLanes:true,rejected});
}
console.log(JSON.stringify({suite:'build430-legacy-fleet-pages',ok:true,sourceCommit:fixture.sourceCommit,results}));
