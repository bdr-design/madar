'use strict';
// Build 708, heaviness batch H1 (owner, 18 Nov 2026). iPhone measurement: after each day close, 166-211 chunks were
// uploaded one by one in 424-511 ms while the clock was held. Over the game's own gh: scheme the chunk uploads now run
// up to 4 at a time (persistence-core.js uploadChunks). This gate checks:
//   1. gh: scheme: at most 4 in flight, every chunk uploaded once, the totals equal to the one-by-one totals, and a
//      chunk recorded as present (vaultChunks) only after its own acknowledgement;
//   2. a chunk over 4 MiB alone (no other upload during it), so at most 16 MiB of chunk bytes in flight;
//   3. on the first refusal no new upload starts, the uploads already in flight are awaited (the acknowledged ones are
//      recorded, the refused one is not and keeps its bytes) and that first error is thrown, code included, even when a
//      task queued behind it settles first with the pool's stop; the same id twice is uploaded once, both rows released;
//   4. bridge (Android: fetch but an https page; an older IPA): one at a time, as before;
//   5. a chunk already in the vault is not uploaded again, and its bytes are released;
//   6. the save worker (two requests at most) is never asked more than one encoding at a time by the uploads: the
//      packbits and bridge base64 encodings of concurrent uploads go through one slot, in launch order; the bridge
//      fallback of a gh: upload (an older IPA without the POST route) sends one message at a time;
//   7. after the first refusal, an encoding still queued in the slot is skipped (not run); through the real slots, a task
//      that stops first does not hide the real refusal; the next save runs clean; a throwing postMessage leaves nothing
//      pending; 3d. a rejection without a value fails the list;
//   8. the real https: branch (Android): one message at a time, each chunk recorded only after its own ack.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(ROOT,'WebApp','persistence-core.js'),'utf8');
const constants=source.split('\n').find(line=>line.includes('const UPLOAD_CONCURRENCY='));assert.ok(constants,'persistence-core.js defines the pool limits');
const slotLines=source.split('\n').filter(line=>/^\s*(function inEncodingSlot\(|function inBridgeSlot\(|const poolStopped=|async function stoppingOnFailure\()/.test(line));assert.equal(slotLines.length,4,'persistence-core.js defines the encoding and bridge slots');const slot=slotLines.map(line=>line.trim()).join('\n');
const ua=source.indexOf('async function uploadChunks('),ub=source.indexOf('  // A commit refused',ua);assert.ok(ua>0&&ub>ua,'uploadChunks found');
const ca=source.indexOf('  async function uploadChunk('),cb=source.indexOf('  async function uploadChunks(',ca);assert.ok(ca>0&&cb>ca,'uploadChunk and uploadChunkMessage found');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
// A pool whose uploads are held until released one by one (a fake transport).
function pool({gh=true,refuse=new Set(),stopped=new Set(),bare=new Set(),falsy=new Set(),vault=new Set(),fetch=true}={}){
  const env={inFlight:0,peak:0,inFlightBytes:0,peakBytes:0,starts:[],held:[],timings:[],overlapWithBig:false,bigRunning:false};
  const context={clock:()=>0,vaultChunks:vault,rememberTiming:row=>env.timings.push(row),Promise,Set,Number,String,Math,
    globalThis:{fetch:fetch?()=>{}:undefined,location:{protocol:gh?'gh:':'https:'}},
    uploadChunk:(id,bytes)=>{const size=bytes.byteLength,big=size>4*1024*1024;if(env.bigRunning||(big&&env.inFlight>0))env.overlapWithBig=true;env.inFlight++;env.inFlightBytes+=size;env.peak=Math.max(env.peak,env.inFlight);env.peakBytes=Math.max(env.peakBytes,env.inFlightBytes);if(big)env.bigRunning=true;env.starts.push(id);
      return new Promise((resolve,reject)=>env.held.push({id,go:()=>{env.inFlight--;env.inFlightBytes-=size;if(big)env.bigRunning=false;if(refuse.has(id)){const error=new Error('chunk-nack-'+id);error.code='CHUNK_NACK';reject(error);}else if(bare.has(id))reject(undefined);else if(falsy.has(id))reject(0);else if(stopped.has(id)){const error=new Error('chunk-upload-pool-stopped');error.code='POOL_STOPPED';reject(error);}else resolve({bytes:size,wireBytes:size-1,encoding:id.endsWith('p')?'gh-packbits-v1':'identity',workerMs:2});}}));}};
  vm.createContext(context);vm.runInContext(`${constants.trim()}\nthis.upload=${source.slice(ua,ub).trim()}`,context);
  env.run=rows=>context.upload(rows);
  env.release=async(order='fifo')=>{await tick();while(env.held.length){const next=order==='lifo'?env.held.pop():env.held.shift();next.go();await tick();await tick();}};
  return env;
}
const rows=(n,size=10)=>Array.from({length:n},(_,i)=>({id:`c${i}${i%3===0?'p':''}`,kind:'lane',bytes:new Uint8Array(size)}));
(async()=>{
  // 1. gh: up to 4 in flight, each once, totals as one by one, recorded after its own ack (released out of order).
  {const vault=new Set(),t=pool({vault}),list=rows(11,10+0);const running=t.run(list);await tick();
    assert.equal(t.inFlight,4,'1: 4 in flight at once');assert.equal(vault.size,0,'1: nothing recorded before an ack');
    await t.release('lifo');await running;
    assert.equal(t.peak,4,'1: never more than 4');assert.deepEqual([...t.starts].sort(),list.map(row=>row.id).sort(),'1: every chunk once');assert.equal(new Set(t.starts).size,11);
    assert.equal(vault.size,11,'1: every acknowledged chunk recorded');assert.ok(list.every(row=>row.bytes===null),'1: bytes released after the ack');
    const timing=t.timings[0];assert.equal(timing.bytes,110);assert.equal(timing.wireBytes,99);assert.equal(timing.compressedChunks,4);assert.equal(timing.encodingWorkerMs,22);assert.deepEqual(JSON.parse(JSON.stringify(timing.bytesByKind)),{lane:110});
    assert.equal(timing.concurrency,4);assert.equal(timing.peakInFlight,4);assert.equal(timing.chunks,11);}
  // 2. the byte budget and a large chunk alone.
  {const MiB=1024*1024,t=pool(),list=[{id:'a',bytes:new Uint8Array(3*MiB)},{id:'b',bytes:new Uint8Array(3*MiB)},{id:'c',bytes:new Uint8Array(3*MiB)},{id:'d',bytes:new Uint8Array(3*MiB)},{id:'e',bytes:new Uint8Array(3*MiB)},{id:'f',bytes:new Uint8Array(3*MiB)},{id:'big',bytes:new Uint8Array(5*MiB)},{id:'g',bytes:new Uint8Array(10)}];
    const running=t.run(list);await t.release();await running;assert.ok(t.peakBytes<=16*MiB,`2: at most 16 MiB in flight (${t.peakBytes})`);assert.equal(t.peak,4,'2: still four of 3 MiB at once');assert.equal(t.overlapWithBig,false,'2: a chunk over 4 MiB uploads alone');
    const exact=pool(),fours=Array.from({length:5},(_,i)=>({id:`x${i}`,bytes:new Uint8Array(4*MiB)}));const r4=exact.run(fours);await exact.release();await r4;assert.equal(exact.peak,4,'2: a chunk of exactly 4 MiB is not alone (four in flight)');
    const single=pool(),one=[{id:'huge',bytes:new Uint8Array(20*MiB)}];const r=single.run(one);await single.release();await r;assert.equal(single.starts.length,1,'2: a chunk over the budget still uploads (alone)');}
  // 3. first refusal: nothing new starts, the ones in flight finish, the refused one is not recorded, the first error is thrown.
  {const vault=new Set(),t=pool({vault,refuse:new Set(['c1','c2'])}),list=rows(10);const running=t.run(list);running.catch(()=>{});await tick();
    assert.deepEqual(t.starts,['c0p','c1','c2','c3p']);
    let settled=false;running.then(()=>{settled=true;},()=>{settled=true;});
    t.held.splice(1,1)[0].go();await tick();await tick();// c1 refused first
    assert.equal(t.starts.length,4,'3: no upload starts after the refusal');assert.equal(settled,false,'3: the list does not fail while uploads are still in flight');
    while(t.held.length){t.held.shift().go();await tick();}
    const error=await running.then(()=>null,e=>e);assert.ok(error,'3: the upload list fails');assert.equal(error.message,'chunk-nack-c1');assert.equal(error.code,'CHUNK_NACK','3: the first error, with its code');
    assert.deepEqual([...vault].sort(),['c0p','c3p'],'3: the acknowledged ones recorded, the refused ones not');assert.equal(list[1].bytes.byteLength,10,'3: the refused chunk keeps its bytes');assert.equal(t.timings.length,0,'3: no timing for a failed upload, as before');}
  // 3b. a task queued behind the refusal settles first with POOL_STOPPED: the caller still gets the real first error.
  {const t=pool({refuse:new Set(['c1']),stopped:new Set(['c2'])}),list=rows(4);const running=t.run(list);running.catch(()=>{});await tick();
    t.held.splice(2,1)[0].go();await tick();await tick();while(t.held.length){t.held.shift().go();await tick();}
    const error=await running.then(()=>null,e=>e);assert.equal(error?.code,'CHUNK_NACK',`3b: the real error, not the pool's stop (${error?.code})`);assert.equal(error.message,'chunk-nack-c1');}
  // 3c. the same id twice in one list: uploaded once, the second row's bytes released.
  {const t=pool(),list=[{id:'d0',bytes:new Uint8Array(10)},{id:'d0',bytes:new Uint8Array(10)}];const running=t.run(list);await t.release();await running;assert.deepEqual(t.starts,['d0'],'3c: once');assert.ok(list.every(row=>row.bytes===null),'3c: both rows released');}
  // 3d. a rejection without a value still fails the list (as the one-by-one loop did): not a success, nothing recorded.
  {const vault=new Set(),t=pool({vault,bare:new Set(['c1']),stopped:new Set(['c2'])}),list=rows(8);const running=t.run(list);running.catch(()=>{});await tick();
    t.held.splice(1,1)[0].go();await tick();await tick();assert.equal(t.starts.length,4,'3d: no upload starts after a bare rejection');
    while(t.held.length){t.held.shift().go();await tick();}
    const error=await running.then(()=>null,e=>e);assert.equal(Object.prototype.toString.call(error),'[object Error]','3d: a bare rejection fails the list with an error (vm realm)');assert.equal(error.message,'chunk-upload-failed');assert.equal(error.code,'CHUNK_UPLOAD_FAILED','3d: the bare rejection, not the pool\'s later stop');
    assert.equal(vault.has('c1'),false,'3d: not recorded');assert.deepEqual([...vault].sort(),['c0p','c3p'],'3d: the acknowledged ones recorded');assert.equal(t.timings.length,0,'3d: no success timing');}
  // 3e. a falsy rejection value (0) is reported as an error too.
  {const t=pool({falsy:new Set(['c0p'])}),list=rows(2);const running=t.run(list);running.catch(()=>{});await t.release();const error=await running.then(()=>null,e=>e);assert.equal(error?.code,'CHUNK_UPLOAD_FAILED','3e: a falsy rejection becomes an error');}
  // 4. the bridge: one at a time.
  {const t=pool({gh:false}),list=rows(6);const running=t.run(list);await tick();assert.equal(t.inFlight,1,'4: the bridge sends one at a time');await t.release();await running;assert.equal(t.peak,1);assert.equal(t.timings[0].concurrency,1);}
  {const t=pool({fetch:false}),list=rows(6);const running=t.run(list);await t.release();await running;assert.equal(t.peak,1,'4: a gh: page without fetch: one at a time');}
  // 5. a chunk already in the vault.
  {const vault=new Set(['c1']),t=pool({vault}),list=rows(3);const running=t.run(list);await t.release();await running;assert.deepEqual(t.starts.sort(),['c0p','c2']);assert.equal(list[1].bytes,null,'5: its bytes are released');}
  // 6. the encoding slot: the real uploadChunk/uploadChunkMessage with a fake save worker that refuses a third
  //    request, as save-checksum-thread.js does at two; concurrent uploads never ask it more than one at a time.
  {const env={worker:0,peak:0,order:[],posted:[],bridge:0,bridgePeak:0},MiB=1024*1024;
    const context={Promise,Set,Map,Number,String,Math,Error,Uint8Array,ArrayBuffer,setTimeout,clearTimeout,encodeURIComponent,
      chunkPending:new Map(),chunkSequence:0,CHUNK_ACK_TIMEOUT_MS:60000,encodingSlot:Promise.resolve(),bridgeSlot:Promise.resolve(),
      stateCodec:()=>({bytesToBase64:bytes=>'b64:'+bytes.byteLength}),bridgeFor:()=>({postMessage:m=>{env.posted.push(m.id);env.bridge++;env.bridgePeak=Math.max(env.bridgePeak,env.bridge);setTimeout(()=>{const row=context.chunkPending.get(m.requestId);context.chunkPending.delete(m.requestId);clearTimeout(row.timer);env.bridge--;row.resolve();},3);}}),
      globalThis:{location:{protocol:'gh:'},GH_NATIVE_CHUNK_ENCODINGS:['gh-packbits-v1'],
        fetch:async()=>{throw new Error('scheme-unavailable');},// an older IPA: every POST falls back to the bridge
        GH_SAVE_CHUNK_ENCODING_PROVIDER:async(bytes)=>{if(env.worker>=2)throw new Error('save-checksum-input-or-backpressure');env.worker++;env.peak=Math.max(env.peak,env.worker);env.order.push(bytes.byteLength);await new Promise(r=>setTimeout(r,2));env.worker--;return {rawBytes:bytes.byteLength,bytes:new Uint8Array(Math.floor(bytes.byteLength*.5)),encoding:'gh-packbits-v1',workerMs:1};},
        GH_SAVE_ENCODING_PROVIDER:async(bytes)=>{if(env.worker>=2)throw new Error('save-checksum-input-or-backpressure');env.worker++;env.peak=Math.max(env.peak,env.worker);env.order.push('b64');await new Promise(r=>setTimeout(r,2));env.worker--;return 'b64:'+bytes.byteLength;}}};
    vm.createContext(context);vm.runInContext(`${constants.trim()}\n${slot.trim()}\n${source.slice(ca,cb)}\nthis.uploadChunk=uploadChunk;\nthis.uploadChunks=${source.slice(ua,ub).trim()}`,context);
    context.vaultChunks=new Set();context.clock=()=>0;context.rememberTiming=()=>{};
    const list=Array.from({length:8},(_,i)=>({id:`w${i}`,kind:'lane',bytes:new Uint8Array(64*1024+i*128)}));
    await context.uploadChunks(list);
    assert.equal(env.peak,1,`6: the save worker was asked one encoding at a time (peak ${env.peak})`);assert.equal(context.vaultChunks.size,8,'6: every chunk stored over the bridge fallback');assert.equal(env.posted.length,8);
    assert.deepEqual(env.order.filter(n=>typeof n==='number'),list.map((_,i)=>64*1024+i*128),'6: the packbits encodings ran one at a time, in launch order');assert.equal(env.bridgePeak,1,'6: the bridge fallback sent one message at a time');
    // 7. a refusal: the encodings still queued are skipped.
    const refusedEnv={calls:0};context.globalThis.GH_SAVE_CHUNK_ENCODING_PROVIDER=async(bytes)=>{refusedEnv.calls++;await new Promise(r=>setTimeout(r,2));if(refusedEnv.calls===1)throw new Error('qa-encode-refused');return {rawBytes:bytes.byteLength,bytes:new Uint8Array(Math.floor(bytes.byteLength*.5)),encoding:'gh-packbits-v1',workerMs:1};};
    context.vaultChunks=new Set();const second=Array.from({length:8},(_,i)=>({id:`v${i}`,kind:'lane',bytes:new Uint8Array(64*1024)}));
    await assert.rejects(context.uploadChunks(second),/qa-encode-refused/,'7: the first error');assert.equal(refusedEnv.calls,1,`7: the encodings queued behind the refusal are skipped (${refusedEnv.calls} ran)`);assert.equal(context.vaultChunks.size,0);
    // 7b. the real chain, the reviewer's order: a container chunk's POST fails (bridge fallback) and its base64 encoding is
    //     refused, while a lane chunk launched after a fast ack waits in the slot behind it; that queued task stops first
    //     with the pool's stop, yet the caller gets the base64 refusal.
    const ok=id=>({status:200,ok:true,json:async()=>({ok:true,id})});
    context.globalThis.fetch=async url=>{const id=decodeURIComponent(String(url).split('/').pop());await new Promise(r=>setTimeout(r,1));if(id==='x0')throw new Error('scheme-unavailable');return ok(id);};
    context.globalThis.GH_SAVE_CHUNK_ENCODING_PROVIDER=async(bytes)=>{await new Promise(r=>setTimeout(r,1));return {rawBytes:bytes.byteLength,bytes:new Uint8Array(Math.floor(bytes.byteLength*.5)),encoding:'gh-packbits-v1',workerMs:1};};
    context.globalThis.GH_SAVE_ENCODING_PROVIDER=async()=>{await new Promise(r=>setTimeout(r,8));throw new Error('qa-b64-refused');};
    context.vaultChunks=new Set();const third=[{id:'x0',kind:'lane-container',bytes:new Uint8Array(40*1024)},...Array.from({length:10},(_,i)=>({id:`y${i}`,kind:'lane',bytes:new Uint8Array(64*1024)}))];
    const thirdError=await context.uploadChunks(third).then(()=>null,e=>e);assert.equal(thirdError?.message,'qa-b64-refused',`7b: the real refusal, not the pool's stop (${thirdError?.code||thirdError?.message})`);
    assert.equal(context.vaultChunks.has('x0'),false,'7b: the refused chunk is not recorded');
    // 7c. a new save after the failed one: the slots and the stop are not left behind; every chunk stored, nothing pending.
    context.globalThis.GH_SAVE_ENCODING_PROVIDER=async(bytes)=>{await new Promise(r=>setTimeout(r,1));return 'b64:'+bytes.byteLength;};
    context.vaultChunks=new Set();const fourth=third.map(row=>({id:row.id,kind:row.kind,bytes:new Uint8Array(row.kind==='lane'?64*1024:40*1024)}));
    await context.uploadChunks(fourth);assert.equal(context.vaultChunks.size,fourth.length,'7c: the next save stores every chunk');assert.equal(context.chunkPending.size,0,'7c: nothing left pending');
    // 7d. a bridge whose postMessage throws: that error, no pending entry or timer left behind.
    const postBridge=context.bridgeFor,live=new Set(),realSet=context.setTimeout,realClear=context.clearTimeout;let ackTimers=0;
    context.setTimeout=(fn,ms)=>{const handle=realSet(()=>{live.delete(handle);fn();},ms);if(ms>=60000){live.add(handle);ackTimers++;}return handle;};context.clearTimeout=handle=>{live.delete(handle);realClear(handle);};
    context.bridgeFor=()=>({postMessage:()=>{throw new Error('qa-post-refused');}});context.globalThis.fetch=async()=>{throw new Error('scheme-unavailable');};
    context.vaultChunks=new Set();const posted=await context.uploadChunks([{id:'p0',kind:'lane',bytes:new Uint8Array(100)},{id:'p1',kind:'lane',bytes:new Uint8Array(100)}]).then(()=>null,e=>e);for(const handle of live)realClear(handle);context.setTimeout=realSet;context.clearTimeout=realClear;
    assert.match(String(posted?.message),/qa-post-refused/,'7d: the postMessage error');assert.equal(ackTimers,1,'7d: the acknowledgement timer was armed (once) through the context');
    assert.equal(context.chunkPending.size,0,'7d: no pending entry');assert.equal(live.size,0,'7d: no acknowledgement timer left running');assert.equal(context.vaultChunks.size,0);
    // 7e. a refusal outside the slots (the gh: POST answers 409): the pool's own stop skips the encodings still queued.
    {let packs=0;context.globalThis.location={protocol:'gh:'};
      context.globalThis.GH_SAVE_CHUNK_ENCODING_PROVIDER=async(bytes)=>{packs++;await new Promise(r=>setTimeout(r,2));return {rawBytes:bytes.byteLength,bytes:new Uint8Array(Math.floor(bytes.byteLength*.5)),encoding:'gh-packbits-v1',workerMs:1};};
      context.globalThis.fetch=async url=>{const id=decodeURIComponent(String(url).split('/').pop());return id==='n0'?{status:409,ok:false,json:async()=>({ok:false,message:'qa-nack'})}:ok(id);};
      context.vaultChunks=new Set();const nacked=Array.from({length:8},(_,i)=>({id:`n${i}`,kind:'lane',bytes:new Uint8Array(64*1024)}));
      const nackError=await context.uploadChunks(nacked).then(()=>null,e=>e);assert.equal(nackError?.code,'CHUNK_NACK','7e: the refusal');assert.equal(packs,2,`7e: the encodings queued behind the refusal are skipped (${packs} ran)`);}
    // 8. the real https: branch (Android: fetch present, not gh:): one at a time, each recorded only after its own ack.
    const held=[];context.bridgeFor=()=>({postMessage:m=>held.push(m)});context.globalThis.location={protocol:'https:'};context.vaultChunks=new Set();
    const fifth=Array.from({length:3},(_,i)=>({id:`h${i}`,kind:'lane',bytes:new Uint8Array(100)}));let fifthDone=false;const fifthRun=context.uploadChunks(fifth).then(()=>{fifthDone=true;});
    for(let i=0;i<3;i++){for(let k=0;k<20&&held.length<=i;k++)await tick();assert.equal(held.length,i+1,`8: one message at a time (${held.length})`);assert.equal(context.vaultChunks.size,i,`8: chunk ${i} not recorded before its ack`);assert.equal(fifthDone,false);
      const m=held[i],row=context.chunkPending.get(m.requestId);context.chunkPending.delete(m.requestId);clearTimeout(row.timer);row.resolve();await tick();await tick();}
    await fifthRun;assert.equal(context.vaultChunks.size,3,'8: every acknowledged chunk recorded');context.bridgeFor=postBridge;}
  console.log(JSON.stringify({suite:'build708-chunk-upload-pool',ok:true}));
})().catch(error=>{console.error(error);process.exitCode=1;});
