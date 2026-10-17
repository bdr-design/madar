'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{Worker}=require('node:worker_threads');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..'),file=name=>path.join(ROOT,'WebApp',name),C=require(file('save-chunk-codec.js'));
const results=[],test=async(name,fn)=>{results.push({name,...await fn()});};
function referenceUnpack(input,expected){
  // Independently written decoder: reconstruct each plane as an ordinary list, then interleave. No production unpack.
  const h=Buffer.from(input);assert.equal(h.subarray(0,8).toString(),'GHCPRLE1');assert.equal(h.readUInt32LE(8),expected);const stride=h.readUInt16LE(12),out=Buffer.alloc(expected);let p=20;
  for(let column=0;column<Math.min(stride,expected);column++){
    const plane=[];while(plane.length<Math.ceil((expected-column)/stride)){const n=h[p++];assert.notEqual(n,128);if(n<128){for(let i=0;i<=n;i++)plane.push(h[p++]);}else{const b=h[p++];for(let i=0;i<257-n;i++)plane.push(b);}}
    plane.forEach((b,i)=>{out[column+i*stride]=b;});
  }
  assert.equal(p,input.length);return out;
}
function adapter(){
  const worker=new Worker(`const {parentPort}=require('node:worker_threads'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');globalThis.self=globalThis;globalThis.addEventListener=(n,fn)=>parentPort.on('message',data=>fn({data}));globalThis.postMessage=(m,t)=>parentPort.postMessage(m,t);globalThis.importScripts=(...names)=>names.forEach(n=>vm.runInThisContext(fs.readFileSync(path.join(${JSON.stringify(path.join(ROOT,'WebApp'))},n),'utf8'),{filename:n}));vm.runInThisContext(fs.readFileSync(${JSON.stringify(file('save-checksum-worker.js'))},'utf8'));`,{eval:true});
  const handle={postMessage:(...args)=>worker.postMessage(...args),terminate:()=>worker.terminate()};worker.on('message',data=>handle.onmessage?.({data}));worker.on('error',error=>handle.onerror?.(error));return handle;
}
let W;
(async()=>{
 await test('CRC standard vector and byte-exact adversarial plane boundaries',()=>{
  assert.equal(C.crc32(new TextEncoder().encode('123456789')),0xcbf43926);
  let cases=0;for(const stride of [1,13,128])for(const length of [1,2,3,19,20,21,127,128,129,255,256,257,4097,65537]){
   for(const mode of ['zero','runs','mixed']){const bytes=new Uint8Array(length);for(let i=0;i<length;i++)bytes[i]=mode==='zero'?0:mode==='runs'?Math.floor(i/(stride*129))&255:(Math.imul(i,19)^(i>>>9))&255;
    const packed=C.pack(bytes,stride);if(packed.encoding===C.ENCODING){assert.deepEqual(C.unpack(packed.bytes,length),bytes);assert.deepEqual(referenceUnpack(packed.bytes,length),Buffer.from(bytes));assert(packed.bytes.length<=Math.floor(length*.875));}else assert.strictEqual(packed.bytes,bytes);cases++;
   }
  }return {cases};
 });
 await test('corruption, truncated packets, hostile sizes, unknown stride and trailing bytes refuse',()=>{
  const raw=new Uint8Array(65536),good=C.pack(raw,128).bytes;let refusals=0;const reject=bytes=>{assert.throws(()=>C.unpack(bytes,raw.length),/corrupt/);refusals++;};
  for(const at of [0,8,12,14,16,20,good.length-1]){const bad=good.slice();bad[at]^=1;reject(bad);}
  for(const end of [0,7,19,20,good.length-1])reject(good.slice(0,end));const trailing=new Uint8Array(good.length+1);trailing.set(good);reject(trailing);
  const nop=good.slice();nop[20]=128;reject(nop);assert.throws(()=>C.unpack(good,raw.length+1),/corrupt/);assert.throws(()=>C.pack(new Uint8Array(4194305)),/input/);assert.throws(()=>C.pack(raw,0),/input/);return {refusals:refusals+4};
 });
 global.__GH_SAVE_CHECKSUM_WORKER_FACTORY__=adapter;vm.runInThisContext(fs.readFileSync(file('save-checksum-thread.js'),'utf8'),{filename:'save-checksum-thread.js'});W=global.GH_SAVE_CHECKSUM_THREAD;
 await test('real worker compresses immutable input and transfers fewer exact bytes',async()=>{
  assert.equal(typeof W.encodeChunk,'function','the actual save worker must own chunk compression');
  const raw=new Uint8Array(4194304),view=new DataView(raw.buffer);for(let at=0;at<raw.length;at+=128){view.setUint32(at+92,at/128,true);view.setFloat64(at+16,99.125,true);view.setFloat64(at+24,90,true);raw[at+120]=1;}
  const before=raw.slice(),out=await W.encodeChunk(raw,128);assert.equal(out.encoding,C.ENCODING);assert.deepEqual(raw,before,'the live/snapshot input is never detached or mutated');assert.deepEqual(C.unpack(out.bytes,raw.length),raw);assert(out.bytes.length<raw.length*.1,'column repetition must reduce this realistic record page by at least 90%');
  const owned=raw.slice(),ownedLength=owned.length,ownedWork=W.encodeChunk(owned,128,{transferOwnership:true});assert.equal(owned.byteLength,0,'exclusive save snapshot is transferred without a main-thread copy');assert.deepEqual(C.unpack((await ownedWork).bytes,ownedLength),raw);
  const random=new Uint8Array(65536);let seed=0x49f17d;for(let i=0;i<random.length;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;random[i]=seed&255;}
  const fallback=await W.encodeChunk(random,128);assert.equal(fallback.encoding,'identity');assert.deepEqual(fallback.bytes,random);
  const jobs=[W.encodeChunk(raw,128),W.encodeChunk(raw,128)];await assert.rejects(W.encodeChunk(raw,128),/backpressure/);await Promise.all(jobs);
  const pending=W.encodeChunk(raw,128);W.terminate();await assert.rejects(pending,/terminated/);assert.equal(W.stats().pending,0);return {rawBytes:raw.length,wireBytes:out.bytes.length,reductionPct:100*(1-out.bytes.length/raw.length),workerMs:out.workerMs};
 });
 console.log(JSON.stringify({suite:'build406-save-chunk-transport',ok:true,results}));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>W?.terminate());
