'use strict';
// Explicit on-demand benchmark only: GH_PATCH_ROWS=1000000 node tools/measure_fleet_row_patch_save.cjs
// GH_TEST_SOURCE_DIR can point to the pre-change archive. Codec preparation excludes native upload/ACK and save
// validation. The deterministic proof fixture runs locally; actual independent worker wiring is gated by build411.
// Total checkpoint time includes full-buffer SHA-256 restoration assertions that are test work, not gameplay work.
const assert=require('node:assert/strict'),path=require('node:path'),crypto=require('node:crypto');
const ROOT=path.resolve(process.env.GH_TEST_SOURCE_DIR||path.join(__dirname,'..'));global.window=global;
const S=require(path.join(ROOT,'WebApp/fleet-store-core.js')),C=require(path.join(ROOT,'WebApp/state-codec-core.js'));
const W=require('../tests/helpers/save-checksum-node-worker.cjs').install(ROOT);global.GH_NATIVE_ROW_PATCHES=1;
const count=Number(process.env.GH_PATCH_ROWS||S.CHUNK_ROWS*2+7),vault=new Map(),results=[];
function fixture(n){const fleet=S.create(n);for(let i=0;i<n;i++)S.add(fleet,{id:'PATCH-'+i,name:'Patch '+i,type:['air','sea','road'][i%3],ownerCompanyId:['air','sea','road'][i%3],phase:'moving',progress:.1+(i%100)/1000,fuel:80,condition:95,flightHours:3,flightCycles:1,nextCheckHours:600});return {saveVersion:'3.0.0',simSeconds:0,fleet};}
const state=fixture(count),digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function proof(index,store){const start=index*S.CHUNK_ROWS*S.STRIDE,raw=new Uint8Array(store.rows,start,Math.min(S.CHUNK_ROWS*S.STRIDE,store.rows.byteLength-start)),revision=store.revision;return {result:{index,checksum:C.chunkChecksum(raw),byteLength:raw.length},current:()=>store.revision===revision};}
async function save(target=state,options={}){
 const store=target.fleet,iterator=C.serializeChunkedSteps(target,{externalChecksums:true,knownChunkIds:new Set(vault.keys()),allowRowPatches:true,...options.codec}),started=performance.now();let input,step;
 let maxCodecStepMs=0;
 try{for(;;){const start=performance.now();step=iterator.next(input);maxCodecStepMs=Math.max(maxCodecStepMs,performance.now()-start);input=undefined;if(step.done)break;const job=step.value;
  if(job?.kind==='fleet-chunk-checksum')input=await W.checksum(job.bytes,job.transform,job.outputByteLength);
  else if(job?.kind==='fleet-row-proof'){input=options.noProof?null:proof(job.index,options.proofStore||store);if(options.badProof)input.result.checksum='0.0';if(options.staleProof)input.current=()=>false;options.afterProof?.();}
 }}finally{iterator.return();}
 const serializationMs=performance.now()-started,out=step.value,uploaded=[];for(const chunk of out.chunks)if(!vault.has(chunk.id)){assert(chunk.data,'new parts must own immutable bytes');vault.set(chunk.id,chunk.data.slice());uploaded.push({id:chunk.id,kind:chunk.kind,bytes:chunk.data.length});}
 let compressionWallMs=0,wireBytes=0;
 if(process.env.GH_PATCH_WIRE==='1'){
  const wireCodec=require(path.join(ROOT,'WebApp/save-chunk-codec.js'));
  for(const part of uploaded){const chunk=out.chunks.find(c=>c.id===part.id),bytes=chunk.data;
   if(!['lane','base','overlay'].includes(part.kind)||bytes.length<32768){wireBytes+=bytes.length;continue;}
   const at=performance.now(),packed=await W.encodeChunk(bytes,part.kind==='overlay'?13:128,{transferOwnership:true});compressionWallMs+=performance.now()-at;wireBytes+=packed.bytes.length;
   const raw=packed.encoding==='identity'?packed.bytes:wireCodec.unpack(packed.bytes,part.bytes);assert.equal(digest(raw),digest(vault.get(part.id)),'compressed container is independently byte-exact');
  }
 }
 const decoded=C.deserialize(out.text,{resolveChunk:id=>vault.get(id)});assert.equal(digest(new Uint8Array(decoded.fleet.rows)),digest(new Uint8Array(store.rows)),'every restored bit must equal the live rows');
 assert.deepEqual(decoded.fleet.extras,store.extras);assert.deepEqual(decoded.fleet.values,store.values);
 return {out,uploaded,serializationMs,maxCodecStepMs,compressionWallMs,wireBytes:process.env.GH_PATCH_WIRE==='1'?wireBytes:null,prepareAndCompressMs:serializationMs+compressionWallMs,wallMs:performance.now()-started};
}
function replay(target,indices,edit){const store=target.fleet,before=store.revision,changed=S.readRows(store,indices),view=new DataView(changed.bytes);for(let i=0;i<indices.length;i++)edit(view,i*128,i);S.writeRows(store,indices,changed.bytes,changed.extras,{revisionDelta:indices.length});C.recordFleetRows?.(store,before,indices);}
const decode=out=>C.deserialize(out.out.text,{resolveChunk:id=>vault.get(id)}),baseCount=out=>out.uploaded.filter(x=>x.kind==='base').length;
async function test(name,fn){results.push({name,...await fn()});}

(async()=>{await save();const changed=Math.min(count,Number(process.env.GH_PATCH_CHANGED_ROWS||Math.ceil(count/S.CHUNK_ROWS))),ids=Int32Array.from({length:changed},(_,i)=>process.env.GH_PATCH_CHANGED_ROWS?Math.floor(i*(count-1)/Math.max(1,changed-1)):Math.min(count-1,i*S.CHUNK_ROWS+1));const trackStart=performance.now();replay(state,ids,(v,at,i)=>v.setFloat64(at+8,.42+i/1e8,true));const replayMs=performance.now()-trackStart;const out=await save();const tracking=[];if(C.recordFleetRows){for(let i=0;i<128;i++){const at=performance.now();C.recordFleetRows(state.fleet,state.fleet.revision,ids,true);tracking.push(performance.now()-at);}}tracking.sort((a,b)=>a-b);console.log(JSON.stringify({source:ROOT,rows:count,changedRows:ids.length,replayMs,trackingBatchRows:ids.length,trackingSamples:tracking.length,trackingP50Ms:tracking[Math.floor(tracking.length*.5)]||0,trackingP99Ms:tracking[Math.floor(tracking.length*.99)]||0,trackingMaxMs:tracking.at(-1)||0,checkpointIncludingRestoreProofMs:out.wallMs,serializationMs:out.serializationMs,maxCodecStepMs:out.maxCodecStepMs,compressionWallMs:out.compressionWallMs,wireBytes:out.wireBytes,prepareAndCompressMs:out.prepareAndCompressMs,format:JSON.parse(out.out.text).fleet.rows.lanes?'lanes-v1':'overlay-v1',laneUploads:out.uploaded.filter(x=>x.kind==='lane').length,baseUploads:baseCount(out),uploadedBytes:out.uploaded.reduce((n,x)=>n+x.bytes,0),patchBytes:out.uploaded.filter(x=>x.kind==='row-patch').reduce((n,x)=>n+x.bytes,0),exactRestore:true}));})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>W.terminate());
