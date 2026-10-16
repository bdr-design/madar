'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
const {chromium,webkit}=require('playwright'),{serve}=require('./helpers/web-server');
(async()=>{const server=await serve(path.resolve(__dirname,'../WebApp'));try{
 for(const engine of [chromium,webkit]){const browser=await engine.launch({headless:true});try{
  const page=await browser.newPage(),url=server.baseURL+'/__qa_save_pipeline__';await page.route(url,r=>r.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; worker-src \'self\'">'}));await page.goto(url);
  for(const file of ['fleet-store-core.js','state-codec-core.js','save-checksum-thread.js'])await page.addScriptTag({url:server.baseURL+'/'+file});
  const result=await page.evaluate(async()=>{
   const S=GH_FLEET_STORE,C=GH_STATE_CODEC,W=GH_SAVE_CHECKSUM_THREAD,check=(ok,label)=>{if(!ok)throw new Error(label);};
   const count=S.CHUNK_ROWS*3+19,store=S.create(count),chunkBytes=S.CHUNK_ROWS*S.STRIDE;
   for(let i=0;i<count;i++)S.add(store,{id:'PIPE-'+i,name:'Aircraft '+i,assetMode:'air',ownerCompanyId:'air',baseFacility:'B1',phase:'idle',progress:0,fuel:100,condition:90});
   const state={fleet:store},known=new Set(),vault=new Map();
   async function drive(submit=W.checksum){
    const revision=store.revision,buffer=store.rows,session=W.createSession({current:()=>store.revision===revision&&store.rows===buffer,submit}),g=C.serializeChunkedSteps(state,{externalChecksums:true,knownChunkIds:known});let input,step;
    try{for(;;){step=g.next(input);if(step.done)return {...step.value,session:session.stats()};input=step.value?.kind==='fleet-chunk-checksum'?await session.take(step.value.bytes,step.value.nextBytes,step.value.transform,step.value.outputByteLength,step.value.nextTransform,step.value.nextOutputByteLength):undefined;}}
    finally{await session.close();check(W.stats().pending===0&&W.stats().activeSessions===0&&W.stats().activeChannels===0,'save releases worker requests and MessageChannel ports');}
   }
   function remember(saved){for(const c of saved.chunks)if(!known.has(c.id)){check(C.isPreparedChunk(c),'every unknown fleet chunk has an immutable worker snapshot');vault.set(c.id,c.data);known.add(c.id);}}
   function roundtrip(saved){remember(saved);const loaded=C.deserialize(saved.text,{resolveChunk:id=>vault.get(id)}),a=new Uint32Array(loaded.fleet.rows),b=new Uint32Array(store.rows);check(a.length===b.length,'roundtrip length');for(let i=0;i<a.length;i++)if(a[i]!==b[i])throw new Error('roundtrip bytes');}
   let before=C.cacheStats().chunks.checksumCalls;const cold=await drive();check(C.cacheStats().chunks.checksumCalls===before,'pipeline does not checksum on main');check(cold.session.requests===8&&cold.session.lookaheadRequests===6&&cold.session.peakJobs===2,'cold save pipelines the base and compact overlay pages');roundtrip(cold);
   const unchanged=await drive();check(unchanged.session.requests===2&&unchanged.session.lookaheadRequests===0&&unchanged.session.peakJobs===1,'unchanged save checks one base page and its overlay');check(unchanged.chunks.every((c,i)=>c.id===cold.chunks[i].id),'unchanged identities');
   const seen=[];S.set(store,0,'fuel',91);S.set(store,S.CHUNK_ROWS*2,'fuel',92);
   before=C.cacheStats().chunks.checksumCalls;const sparse=await drive((bytes,transform,expectedBytes)=>{seen.push({offset:bytes.byteOffset,kind:transform.kind,expectedBytes});return W.checksum(bytes,transform,expectedBytes);});check(C.cacheStats().chunks.checksumCalls===before,'sparse pipeline stays off main');check(seen.length===4&&seen.some(row=>row.kind==='fleet-base-v1'&&row.offset===0)&&seen.some(row=>row.kind==='fleet-base-v1'&&row.offset===chunkBytes*2)&&seen.some(row=>row.kind==='fleet-overlay-v1'&&row.offset===chunkBytes),'lookahead skips unchanged known base pages; the rotating pair includes its compact overlay');check(sparse.chunks[0].id!==cold.chunks[0].id&&sparse.chunks[2].id!==cold.chunks[2].id&&sparse.chunks[1].id===cold.chunks[1].id&&sparse.chunks[3].id===cold.chunks[3].id&&sparse.chunks.slice(4).every((c,i)=>c.id===cold.chunks[i+4].id),'only the two changed base identities are renamed');roundtrip(sparse);
   known.clear();const missing=await drive();check(missing.session.requests===8&&missing.chunks.every(c=>C.isPreparedChunk(c)),'forgotten vault gets every base and overlay snapshot once');roundtrip(missing);
   const prior=C.cacheStats().chunks.mismatches,ids=new Map(missing.chunks.map(c=>[`${c.kind}:${c.index}`,c.id]));new Uint8Array(store.rows)[chunkBytes+100]^=1;let repaired;
   for(let i=0;i<5&&C.cacheStats().chunks.mismatches===prior;i++)repaired=await drive();check(C.cacheStats().chunks.mismatches===prior+1&&repaired.chunks.find(c=>c.kind==='base'&&c.index===1).id!==ids.get('base:1')&&repaired.chunks.filter(c=>c.kind==='overlay').every(c=>c.id===ids.get(`overlay:${c.index}`)),'rotating corruption detection renames only the affected immutable page');roundtrip(repaired);
   S.set(store,0,'fuel',90);S.set(store,S.CHUNK_ROWS*2,'fuel',85);let first=true,rejected=false;
   try{await drive((bytes,transform,expectedBytes)=>{const work=W.checksum(bytes,transform,expectedBytes);if(first){first=false;S.set(store,1,'fuel',80);}return work;});}catch(e){rejected=/fleet-changed-during-save/.test(e.message);}check(rejected,'a change before deferred copying refuses the old snapshot and drains its primary request');roundtrip(await drive());
   for(let i=0;i<store.length;i+=S.CHUNK_ROWS)S.set(store,i,'fuel',75);first=true;rejected=false;
   try{await drive((bytes,transform,expectedBytes)=>{const work=W.checksum(bytes,transform,expectedBytes);if(first){first=false;W.terminate();}return work;});}catch(e){rejected=/terminated/.test(e.message);}check(rejected,'worker termination rejects and cancels queued lookahead');roundtrip(await drive());
   const immediate=W.createSession({submit:bytes=>Promise.resolve({checksum:'0.0',bytes:bytes.slice()})});const cached=await immediate.take(new Uint8Array(4));check(cached.didYieldToWorker===false,'an immediate promise cannot reset the UI budget');await immediate.close();
   check(W.stats().maxSessionJobs===2&&W.stats().pending===0&&W.stats().activeSessions===0&&W.stats().activeChannels===0,'bounded and drained after all scenarios');return {rows:count,chunks:cold.chunks.length,coldLookahead:cold.session.lookaheadRequests,sparseRequests:sparse.session.requests,stats:W.stats()};
  });
  assert.equal(result.chunks,8);console.log('SAVE_PIPELINE_PASS',engine.name(),JSON.stringify(result));
 }finally{await browser.close();}}
}finally{await server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
