'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
const {chromium,webkit}=require('playwright'),{serve}=require('./helpers/web-server');
(async()=>{const server=await serve(path.resolve(__dirname,'../WebApp'));try{
 for(const engine of [chromium,webkit]){const browser=await engine.launch({headless:true});try{
  const page=await browser.newPage(),url=server.baseURL+'/__qa_checksum_origin__';await page.route(url,r=>r.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8">'}));await page.goto(url);
  for(const file of ['fleet-store-core.js','state-codec-core.js','save-checksum-thread.js'])await page.addScriptTag({url:server.baseURL+'/'+file});
  const result=await page.evaluate(async()=>{
   const C=GH_STATE_CODEC,S=GH_FLEET_STORE,W=GH_SAVE_CHECKSUM_THREAD,check=(ok,label)=>{if(!ok)throw new Error(label);};
   for(const size of [1,3,4,17,4*1024*1024]){
    const bytes=new Uint8Array(size);for(let i=0;i<size;i++)bytes[i]=(i*19+7)&255;
    const expected=C.chunkChecksum(bytes),found=await W.checksum(bytes);
    check(found.checksum===expected&&found.bytes.byteLength===size&&bytes.byteLength===size,'same checksum and live buffer retained');
    for(let i=0;i<size;i++)if(bytes[i]!==found.bytes[i])throw new Error('worker-snapshot-byte-mismatch');
    check(await W.base64(bytes)===C.bytesToBase64(bytes),'worker bridge encoding is byte-identical');
   }
   let rejected=false;try{await W.checksum(new Uint8Array(4*1024*1024+1));}catch{rejected=true;}check(rejected,'oversized work refused');
   const store=S.create(S.CHUNK_ROWS+1);for(let i=0;i<S.CHUNK_ROWS+1;i++)S.add(store,{id:'W-'+i,name:'Aircraft '+i,assetMode:'air',ownerCompanyId:'air',baseFacility:'B1',phase:'idle',progress:0,fuel:100,condition:90});
   const state={fleet:store},drive=async()=>{const steps=C.serializeChunkedSteps(state,{externalChecksums:true});let input,step;for(;;){step=steps.next(input);if(step.done)return step.value;input=step.value?.kind==='fleet-chunk-checksum'?await W.checksum(step.value.bytes):undefined;}};
   const before=C.cacheStats().chunks.checksumCalls,saved=await drive();check(C.cacheStats().chunks.checksumCalls===before,'no checksum on the presentation thread');check(saved.chunks.every(c=>C.isPreparedChunk(c)),'worker-owned snapshot buffers are reused');
   const byId=new Map(saved.chunks.map(c=>[c.id,c.data]));const restored=C.deserialize(saved.text,{resolveChunk:id=>byId.get(id)});check(restored.fleet.rows.byteLength===store.rows.byteLength,'restored snapshot size');
   const old=saved.chunks.map(c=>c.id),prior=C.cacheStats().chunks.mismatches;new Uint8Array(store.rows)[100]^=1;let next;
   for(let i=0;i<saved.chunks.length+1&&C.cacheStats().chunks.mismatches===prior;i++)next=await drive();check(C.cacheStats().chunks.mismatches===prior+1&&next.chunks.every((c,i)=>c.id!==old[i]),'worker rotating check still catches untracked writes');
   const g=C.serializeChunkedSteps(state,{externalChecksums:true});S.set(store,0,'fuel',90);const step=g.next();check(step.value?.kind==='fleet-chunk-checksum','worker job yielded');const response=await W.checksum(step.value.bytes);S.set(store,1,'fuel',50);rejected=false;try{g.next(response);}catch(e){rejected=/fleet-changed-during-save/.test(e.message);}check(rejected,'stale worker reply cannot publish a manifest');
   const pending=W.checksum(new Uint8Array(4*1024*1024));W.terminate();rejected=false;try{await pending;}catch{rejected=true;}check(rejected,'terminated work rejects without hanging');
   check(W.stats().encodes===5,'all base64 boundary cases used the worker');return W.stats();
  });
  assert.ok(result.completed>=8);assert.equal(result.pending,0);console.log('SAVE_CHECKSUM_WORKER_PASS',engine.name(),JSON.stringify(result));
 }finally{await browser.close();}}
}finally{await server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
