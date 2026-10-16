'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {harness,minimal}=require('./helpers/core-harness'),h=harness(['save-schema','state-codec-core','persistence-core']),s=h.s,P=s.GH_PERSISTENCE;
const source=fs.readFileSync(path.join(__dirname,'../WebApp/persistence-core.js'),'utf8'),start=source.indexOf('function* utf8Steps('),end=source.indexOf('  function receiveChunkAck',start);assert.ok(start>=0&&end>start);
let allocated=0;class Encoder extends TextEncoder{encode(text){const result=super.encode(text);allocated+=result.byteLength;return result;}}
function Bytes(size){allocated+=size;return new Uint8Array(size);}
const encode=vm.runInNewContext('('+source.slice(start,end)+')',{TextEncoder:Encoder,Uint8Array:Bytes,inspectNativeJSON:P.inspectNativeJSON});
const cases=['','plain ASCII','العربية والإنجليزية 🛫 🇸🇦','\ud800','\udc00','\ud800x\udc00','a'.repeat(65535)+'😀'+'ب'.repeat(65536),'a'.repeat(65536)+'\ud800'+'b'.repeat(65536),'ع'.repeat(200000),'a'.repeat(2000000)];
let largest=0;
for(const text of cases){allocated=0;const g=encode(text);let step;do{step=g.next();}while(!step.done);const expected=new TextEncoder().encode(text);assert.equal(Buffer.compare(Buffer.from(step.value),Buffer.from(expected)),0);assert.equal(allocated,expected.length*(text.length>65536?2:1),'one encoding plus one exact joined buffer at most');assert.equal(step.value.buffer.byteLength,expected.length,'no oversized backing store survives');largest=Math.max(largest,expected.length);}
// Refuse an oversized save before allocating its joined buffer; keep the same public error and exact measurement.
const reject=vm.runInNewContext('('+source.slice(start,end)+')',{TextEncoder:Encoder,Uint8Array:Bytes,inspectNativeJSON:(_text,bytes)=>P.inspectNativeJSON('x',{byteLength:bytes.byteLength+P.LIMITS.nativeHardBytes})});allocated=0;
assert.throws(()=>{const g=reject('x'.repeat(65537));while(!g.next().done){};},/native-save-size-hard-limit/);assert.equal(allocated,65537);
(async()=>{
 s.crypto=crypto.webcrypto;s.GH_CONTROL_PLANE={sha256:text=>crypto.createHash('sha256').update(text).digest('hex')};let envelope=null,generation=0;
 s.webkit={messageHandlers:{saveBridge:{postMessage(m){envelope=m;setImmediate(()=>P.receiveAck({...m,success:true,generation:++generation}));}}}};
 const state={...minimal(),notes:'حفظ 🛫 UTF-8 '.repeat(100000)},expected=s.GH_STATE_CODEC.serialize(state),result=await P.commitDurableState(state,{prevalidated:true,yieldToFrame:()=>Promise.resolve()});
 assert.equal(result.ok,true);assert.equal(envelope.saveJSON,expected);assert.equal(result.utf8Bytes,Buffer.byteLength(expected));assert.equal(envelope.saveHash,crypto.createHash('sha256').update(expected).digest('hex'));assert.equal(s.GH_STATE_CODEC.deserialize(envelope.saveJSON).notes,state.notes);assert.equal(P.isLocked(),false);
 const savedEnvelope=envelope;let tick=0,encodingStarted=false;s.performance={now:()=>tick+=4};s.TextEncoder=class extends TextEncoder{encode(text){encodingStarted=true;return super.encode(text);}};await assert.rejects(P.commitDurableState({...state,saveRevision:2},{prevalidated:true,yieldToFrame:()=>{if(encodingStarted)throw Error('host-cancelled-encoding');return Promise.resolve();}}),/host-cancelled-encoding/);assert.equal(encodingStarted,true);assert.equal(envelope,savedEnvelope);assert.equal(P.isLocked(),false,'cancelled preparation must release the lifecycle lock');
 // Upload data is released only after its ACK. A refused chunk keeps its bytes and is not marked present.
 const ua=source.indexOf('async function uploadChunks('),ub=source.indexOf('  // A commit refused',ua),vault=new Set(),timings=[];
 const upload=vm.runInNewContext('('+source.slice(ua,ub)+')',{clock:()=>0,vaultChunks:vault,uploadChunk:async id=>{if(id==='bad')throw Error('chunk-nack');},rememberTiming:row=>timings.push(row)}),rows=[{id:'a',bytes:new Uint8Array(10)},{id:'b',bytes:new Uint8Array(20)}];
 await upload(rows);assert.ok(rows.every(row=>row.bytes===null));assert.equal(timings[0].bytes,30);const bad=[{id:'bad',bytes:new Uint8Array(5)}];await assert.rejects(upload(bad),/chunk-nack/);assert.equal(bad[0].bytes.byteLength,5);assert.equal(vault.has('bad'),false);
 // The public chunked path retains identical live fleet bytes and can reload from the ACKed native chunks.
 s.performance=performance;s.TextEncoder=TextEncoder;const store=s.GH_FLEET_STORE.create(3);for(let i=0;i<3;i++)s.GH_FLEET_STORE.add(store,{id:'ENC-'+i,assetMode:'air',ownerCompanyId:'air',name:'طائرة 🛫 '+i,phase:'idle',progress:0,fuel:100,condition:90});
 const binary={...minimal(),fleet:store},fleetBefore=Buffer.from(new Uint8Array(store.rows)),nativeVault=new Map();
 s.webkit.messageHandlers.saveBridge.postMessage=m=>{if(m.action==='storeSaveChunk'){nativeVault.set(m.id,new Uint8Array(Buffer.from(m.base64,'base64')));setImmediate(()=>s.dispatchEvent(new s.CustomEvent('gh-native-chunk-ack',{detail:{requestId:m.requestId,id:m.id,success:true}})));}else{envelope=m;setImmediate(()=>P.receiveAck({...m,success:true,generation:++generation}));}};
 await P.commitDurableState(binary,{prevalidated:true,yieldToFrame:()=>Promise.resolve()});assert.ok(nativeVault.size>0);const restored=s.GH_STATE_CODEC.deserialize(envelope.saveJSON,{resolveChunk:id=>nativeVault.get(id)});
 assert.equal(store.rows.byteLength,fleetBefore.byteLength);assert.equal(Buffer.compare(Buffer.from(new Uint8Array(store.rows)),fleetBefore),0);assert.equal(Buffer.compare(Buffer.from(new Uint8Array(restored.fleet.rows)),fleetBefore),0);
 P.forgetVaultChunks();let refusedCommitPosts=0;s.webkit.messageHandlers.saveBridge.postMessage=m=>{if(m.action==='storeSaveChunk')setImmediate(()=>s.dispatchEvent(new s.CustomEvent('gh-native-chunk-ack',{detail:{requestId:m.requestId,id:m.id,success:false,message:'injected-chunk-nack'}})));else refusedCommitPosts++;};
 await assert.rejects(P.commitDurableState(binary,{prevalidated:true,yieldToFrame:()=>Promise.resolve()}),/injected-chunk-nack/);assert.equal(refusedCommitPosts,0,'an incomplete upload cannot commit a manifest');assert.equal(P.isLocked(),false);assert.equal(Buffer.compare(Buffer.from(new Uint8Array(store.rows)),fleetBefore),0);
 console.log(JSON.stringify({suite:'build383-save-encoding',ok:true,unicodeCases:cases.length,largestBytes:largest,durableHashAndReload:true,cancellationAndUploadAck:true,binaryRoundtrip:true}));
})().catch(e=>{console.error(e);process.exitCode=1;});
