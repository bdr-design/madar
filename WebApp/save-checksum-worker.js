'use strict';
importScripts('state-codec-core.js','save-chunk-codec.js');
const VERSION='save-checksum-v1',MAX_BYTES=4*1024*1024;
function transformFleet(bytes,transform,expectedBytes){
  if(transform?.kind!=='fleet-lanes-v1'||transform.stride!==128||transform.laneBytes!==8||bytes.length%128||expectedBytes!==bytes.length)throw new Error('save-checksum-transform-invalid');
  const rows=bytes.length/128,out=new Uint8Array(bytes.length),source=new Uint32Array(bytes.buffer,bytes.byteOffset,bytes.length/4),target=new Uint32Array(out.buffer);
  // Copy exact integer words, including NaN payloads. Byte-plane compression
  // runs later only for changed lanes, rather than transposing all 128 MiB.
  for(let start=0;start<rows;start+=128){const end=Math.min(rows,start+128);for(let lane=0;lane<16;lane++){const from=lane*2,to=lane*rows*2;for(let row=start;row<end;row++){target[to+row*2]=source[row*32+from];target[to+row*2+1]=source[row*32+from+1];}}}
  return out;
}
self.addEventListener('message',event=>{
  const m=event.data||{},started=performance.now();
  try{
    if(!['checksum','base64','chunk-encode'].includes(m.type)||m.version!==VERSION||!Number.isSafeInteger(m.id)||!(m.buffer instanceof ArrayBuffer)||m.buffer.byteLength<1||m.buffer.byteLength>MAX_BYTES||m.transform!=null&&m.type!=='checksum')throw new Error('save-checksum-request-invalid');
    const bytes=new Uint8Array(m.buffer);
    if(m.type==='chunk-encode'){const packed=self.GH_SAVE_CHUNK_CODEC.pack(bytes,m.stride);self.postMessage({type:'chunk-encode-result',version:VERSION,id:m.id,encoding:packed.encoding,rawBytes:bytes.byteLength,buffer:packed.bytes.buffer,workerMs:performance.now()-started},[packed.bytes.buffer]);}
    else if(m.type==='base64')self.postMessage({type:'base64-result',version:VERSION,id:m.id,text:self.GH_STATE_CODEC.bytesToBase64(bytes),workerMs:performance.now()-started});
    else{const expected=Number.isSafeInteger(m.expectedBytes)?m.expectedBytes:bytes.byteLength,output=m.transform?transformFleet(bytes,m.transform,expected):bytes;if(output.byteLength!==expected||output.byteLength>MAX_BYTES)throw new Error('save-checksum-output-invalid');
      // Lane consumers use all 16 independent hashes. A second whole-page hash is unused; raw replica proofs still
      // require their original checksum over the complete row page.
      const evidence=m.transform?.kind==='fleet-lanes-v1'?{laneSums:Array.from({length:16},(_,i)=>self.GH_STATE_CODEC.chunkChecksum(output.subarray(i*output.length/16,(i+1)*output.length/16)))}:{checksum:self.GH_STATE_CODEC.chunkChecksum(output)};
      self.postMessage({type:'checksum-result',version:VERSION,id:m.id,...evidence,buffer:output.buffer,workerMs:performance.now()-started},[output.buffer]);}
  }catch(error){self.postMessage({type:'checksum-error',version:VERSION,id:m.id,error:String(error?.message||error).slice(0,200)});}
});
