(()=>{
  'use strict';
  const VERSION='save-checksum-v1',MAX_BYTES=4*1024*1024,pending=new Map(),workerResults=new WeakSet();
  let worker=null,sequence=0;
  const stats={requests:0,completed:0,encodes:0,failures:0,copyMs:0,maxCopyMs:0,workerMs:0,maxWorkerMs:0,sessions:0,activeSessions:0,activeChannels:0,maxSessionJobs:0,lookaheadRequests:0,deferredSubmitMs:0,maxDeferredSubmitMs:0};
  const clock=()=>globalThis.performance?.now?.()??Date.now();
  function stop(reason){worker?.terminate();worker=null;for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error(reason));}pending.clear();}
  function ready(){
    if(worker)return worker;
    worker=typeof globalThis.__GH_SAVE_CHECKSUM_WORKER_FACTORY__==='function'?globalThis.__GH_SAVE_CHECKSUM_WORKER_FACTORY__():new Worker(new URL('save-checksum-worker.js',globalThis.location.href));
    worker.onmessage=event=>{
      const m=event.data||{},p=pending.get(m.id);if(!p)return;
      pending.delete(m.id);clearTimeout(p.timer);
      const valid=p.kind==='checksum'?typeof m.checksum==='string'&&/^[0-9a-z]{1,7}\.[0-9a-z]{1,7}$/.test(m.checksum)&&m.buffer instanceof ArrayBuffer&&m.buffer.byteLength===p.bytes:typeof m.text==='string'&&m.text.length===4*Math.ceil(p.bytes/3);
      if(m.type!==p.kind+'-result'||m.version!==VERSION||!valid){stats.failures++;p.reject(new Error('save-checksum-result-invalid'));return;}
      stats.completed++;stats.workerMs+=Number(m.workerMs)||0;stats.maxWorkerMs=Math.max(stats.maxWorkerMs,Number(m.workerMs)||0);
      if(p.kind==='base64'){stats.encodes++;p.resolve(m.text);}else{const result={checksum:m.checksum,bytes:new Uint8Array(m.buffer),copyMs:p.copyMs,workerMs:Number(m.workerMs)||0};workerResults.add(result);p.resolve(result);}
    };
    worker.onerror=()=>{stats.failures++;stop('save-checksum-worker-error');};
    worker.onmessageerror=()=>{stats.failures++;stop('save-checksum-message-error');};
    return worker;
  }
  function request(kind,bytes){
    if(!(bytes instanceof Uint8Array)||bytes.byteLength<1||bytes.byteLength>MAX_BYTES||pending.size>=2)return Promise.reject(new Error('save-checksum-input-or-backpressure'));
    let w,copy,copyMs;try{w=ready();const start=clock();copy=bytes.slice();copyMs=clock()-start;stats.copyMs+=copyMs;stats.maxCopyMs=Math.max(stats.maxCopyMs,copyMs);}catch(error){return Promise.reject(error);}
    const id=++sequence;stats.requests++;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{stats.failures++;stop('save-checksum-worker-timeout');},60000);pending.set(id,{resolve,reject,timer,bytes:copy.byteLength,copyMs,kind});try{w.postMessage({type:kind,version:VERSION,id,buffer:copy.buffer},[copy.buffer]);}catch(error){clearTimeout(timer);pending.delete(id);stats.failures++;reject(error);}});
  }
  const checksum=bytes=>request('checksum',bytes),base64=bytes=>request('base64',bytes);
  // One save owns a bounded lookahead. The next immutable chunk is copied in another host task while the same
  // worker hashes this chunk. No extra worker, persistent timer, or whole-store copy is introduced.
  function createSession({current=()=>true,submit=checksum}={}){
    if(typeof current!=='function'||typeof submit!=='function')throw new Error('save-checksum-session-options');
    const jobs=new Map(),queue=[],sessionStats={requests:0,lookaheadRequests:0,prefetchHits:0,peakJobs:0,deferredSubmitMs:0,maxDeferredSubmitMs:0};
    let sourceBuffer=null,channel=null,closed=false,closing=null;stats.sessions++;stats.activeSessions++;
    const assertCurrent=()=>{if(closed)throw new Error('save-checksum-session-closed');if(current()!==true)throw new Error('state-codec-fleet-changed-during-save');};
    const finish=(job,outcome)=>{job.done=true;job.resolve(outcome);};
    function start(job){
      if(job.started||job.done)return;
      try{
        assertCurrent();job.started=true;const at=clock(),work=submit(job.bytes),ms=clock()-at;job.bytes=null;
        sessionStats.requests++;if(job.deferred){sessionStats.lookaheadRequests++;stats.lookaheadRequests++;sessionStats.deferredSubmitMs+=ms;sessionStats.maxDeferredSubmitMs=Math.max(sessionStats.maxDeferredSubmitMs,ms);stats.deferredSubmitMs+=ms;stats.maxDeferredSubmitMs=Math.max(stats.maxDeferredSubmitMs,ms);}
        Promise.resolve(work).then(value=>finish(job,{value}),error=>finish(job,{error}));
      }catch(error){job.bytes=null;finish(job,{error});}
    }
    function reserve(bytes,deferred=false){
      assertCurrent();
      if(!(bytes instanceof Uint8Array)||!bytes.byteLength||bytes.byteLength>MAX_BYTES)throw new Error('save-checksum-input-or-backpressure');
      if(sourceBuffer&&sourceBuffer!==bytes.buffer)throw new Error('state-codec-fleet-changed-during-save');sourceBuffer=bytes.buffer;
      const key=bytes.byteOffset+':'+bytes.byteLength,prior=jobs.get(key);if(prior)return prior;
      if(jobs.size>=2)throw new Error('save-checksum-input-or-backpressure');
      let resolve;const job={key,bytes,deferred,started:false,done:false,promise:new Promise(r=>{resolve=r;}),resolve:null};job.resolve=resolve;jobs.set(key,job);
      sessionStats.peakJobs=Math.max(sessionStats.peakJobs,jobs.size);stats.maxSessionJobs=Math.max(stats.maxSessionJobs,jobs.size);
      if(deferred){
        if(!channel){channel=new MessageChannel();stats.activeChannels++;channel.port1.onmessage=()=>{const next=queue.shift();if(next)start(next);};}
        queue.push(job);channel.port2.postMessage(0);
      }else start(job);
      return job;
    }
    async function take(bytes,nextBytes=null){
      const job=reserve(bytes);if(job.deferred)sessionStats.prefetchHits++;
      try{
        if(nextBytes&&typeof MessageChannel==='function')reserve(nextBytes,true);
        const waiting=!job.done,outcome=await job.promise;assertCurrent();if(outcome.error)throw outcome.error;
        return {...outcome.value,didYieldToWorker:waiting&&workerResults.has(outcome.value)};
      }finally{if(!job.done)await job.promise;jobs.delete(job.key);}
    }
    function close(){
      if(closing)return closing;closed=true;
      closing=(async()=>{
        try{
          for(const job of jobs.values())if(!job.started&&!job.done){job.bytes=null;finish(job,{error:new Error('save-checksum-session-closed')});}
          queue.length=0;if(channel){channel.port1.close();channel.port2.close();channel=null;stats.activeChannels--;}
          await Promise.all([...jobs.values()].map(job=>job.promise));
        }finally{jobs.clear();sourceBuffer=null;stats.activeSessions--;}
      })();return closing;
    }
    return Object.freeze({take,close,stats:()=>({...sessionStats,pending:jobs.size,closed})});
  }
  globalThis.GH_SAVE_CHECKSUM_PROVIDER=checksum;
  globalThis.GH_SAVE_ENCODING_PROVIDER=base64;
  globalThis.GH_SAVE_CHECKSUM_THREAD=Object.freeze({VERSION,checksum,base64,createSession,stats:()=>({...stats,pending:pending.size}),terminate:()=>stop('save-checksum-worker-terminated')});
})();
