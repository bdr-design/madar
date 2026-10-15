(async()=>{
  'use strict';
  const rows=[],check=(ok,message)=>{if(!ok)throw new Error(message);};
  const test=async(name,run)=>{try{await run();rows.push({name,ok:true});}catch(error){rows.push({name,ok:false,error:String(error?.stack||error).slice(0,1800)});}globalThis.webkit?.messageHandlers?.saveWorkerProbe?.postMessage({progress:true,cases:rows});};
  const S=globalThis.GH_FLEET_STORE,C=globalThis.GH_STATE_CODEC,W=globalThis.GH_SAVE_CHECKSUM_THREAD;
  let state=null,initial=null;const known=new Set(),vault=new Map();
  async function drive(submit=W.checksum){
    const store=state.fleet,revision=store.revision,buffer=store.rows,session=W.createSession({current:()=>store.revision===revision&&store.rows===buffer,submit}),steps=C.serializeChunkedSteps(state,{externalChecksums:true,knownChunkIds:known});let input,step;
    try{for(;;){step=steps.next(input);if(step.done)return {...step.value,session:session.stats()};input=step.value?.kind==='fleet-chunk-checksum'?await session.take(step.value.bytes,step.value.nextBytes):undefined;}}
    finally{await session.close();}
  }
  function retain(saved){for(const c of saved.chunks)if(!known.has(c.id)){check(C.isPreparedChunk(c),'immutable snapshot required');vault.set(c.id,c.data);known.add(c.id);}}
  function exact(saved){retain(saved);const restored=C.deserialize(saved.text,{resolveChunk:id=>vault.get(id)}),a=new Uint32Array(restored.fleet.rows),b=new Uint32Array(state.fleet.rows);check(a.length===b.length,'snapshot length');for(let i=0;i<a.length;i++)if(a[i]!==b[i])throw new Error('snapshot byte mismatch');}
  await test('4 MiB real worker reply matches reference and retains live buffer',async()=>{
    check(S&&C&&W&&typeof W.createSession==='function','runtime modules available');const bytes=new Uint8Array(4194304);for(let i=0;i<bytes.length;i++)bytes[i]=(i*19+7)&255;
    const expected=C.chunkChecksum(bytes),found=await W.checksum(bytes);check(found.checksum===expected&&bytes.byteLength===4194304&&found.bytes.byteLength===bytes.byteLength,'checksum and buffers');
    for(let i=0;i<bytes.length;i++)if(bytes[i]!==found.bytes[i])throw new Error('worker byte mismatch');
  });
  await test('three chunk pipeline uses one bounded lookahead and no main checksum',async()=>{
    const count=S.CHUNK_ROWS*2+3,store=S.create(count);for(let i=0;i<count;i++)S.add(store,{id:'NATIVE-PIPE-'+i,name:'Aircraft '+i,assetMode:'air',ownerCompanyId:'air',baseFacility:'B1',phase:'idle',progress:0,fuel:100,condition:90});state={fleet:store};
    const before=C.cacheStats().chunks.checksumCalls;initial=await drive();check(C.cacheStats().chunks.checksumCalls===before,'no main checksum');check(initial.session.requests===3&&initial.session.lookaheadRequests===2&&initial.session.peakJobs===2,'one chunk ahead');exact(initial);
  });
  await test('unchanged save performs only its rotating check',async()=>{const saved=await drive();check(saved.session.requests===1&&saved.session.lookaheadRequests===0&&saved.chunks.every((c,i)=>c.id===initial.chunks[i].id),'unchanged identities and work');});
  await test('sparse changes skip the known middle chunk and reload exactly',async()=>{S.set(state.fleet,0,'fuel',91);S.set(state.fleet,S.CHUNK_ROWS*2,'fuel',92);const offsets=[],saved=await drive(bytes=>{offsets.push(bytes.byteOffset);return W.checksum(bytes);});check(offsets.length===3&&offsets[0]===0&&offsets[1]===S.CHUNK_ROWS*S.STRIDE*2,'sparse lookahead');exact(saved);});
  await test('forgotten vault gets all unchanged snapshot bytes once',async()=>{known.clear();const saved=await drive();check(saved.session.requests===3&&saved.chunks.every(c=>C.isPreparedChunk(c)),'vault miss snapshots');exact(saved);});
  await test('changed revision rejects old work and then retries cleanly',async()=>{
    S.set(state.fleet,0,'fuel',80);S.set(state.fleet,S.CHUNK_ROWS*2,'fuel',80);let first=true,rejected=false;
    try{await drive(bytes=>{const pending=W.checksum(bytes);if(first){first=false;S.set(state.fleet,1,'fuel',75);}return pending;});}catch(e){rejected=/fleet-changed-during-save/.test(e.message);}check(rejected,'stale snapshot refused');exact(await drive());
  });
  await test('immediate promises cannot claim a worker task boundary',async()=>{const session=W.createSession({submit:bytes=>Promise.resolve({checksum:'0.0',bytes:bytes.slice()})});try{check((await session.take(new Uint8Array(4))).didYieldToWorker===false,'immediate promise preserves budget');}finally{await session.close();}});
  await test('termination rejects pending work without leaving resources',async()=>{const work=W.checksum(new Uint8Array(4194304));W.terminate();let rejected=false;try{await work;}catch{rejected=true;}check(rejected,'termination refuses work');check(W.stats().pending===0&&W.stats().activeSessions===0&&W.stats().activeChannels===0&&W.stats().maxSessionJobs===2,'all resources released');});
  const failed=rows.filter(r=>!r.ok).length,result={version:'save-pipeline-native-v1',cases:rows,total:rows.length,passed:rows.length-failed,failed,stats:W?.stats?.()||null};
  globalThis.__GH_SAVE_WORKER_PROBE__=result;globalThis.webkit?.messageHandlers?.saveWorkerProbe?.postMessage(result);
})().catch(error=>{const result={version:'save-pipeline-native-v1',total:1,passed:0,failed:1,error:String(error?.stack||error)};globalThis.__GH_SAVE_WORKER_PROBE__=result;globalThis.webkit?.messageHandlers?.saveWorkerProbe?.postMessage(result);});
