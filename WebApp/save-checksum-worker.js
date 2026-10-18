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
// Explicit file exports share this worker. One bounded session owns its immutable input;
// no simulation tick, timer, or extra worker is added. The final Blob never becomes a giant UI-thread JSON string.
const exportFiles=new Map(),EXPORT_LIMIT=512*1024*1024;
function exportMessage(m){
  if(m.version!==VERSION||!Number.isSafeInteger(m.id)||typeof m.session!=='string'||!/^[a-z0-9._-]{1,80}$/.test(m.session))throw new Error('save-export-request-invalid');
  if(m.type==='export-abort'){if(exportFiles.delete(m.session))importScripts('state-codec-core.js');return {ok:true};}
  if(m.type==='export-start'){
    if(exportFiles.size||typeof m.json!=='string'||m.json.length>64*1024*1024||!m.meta||m.meta.format!=='global-holdings-save')throw new Error('save-export-start-invalid');
    const root=JSON.parse(m.json),ids=[...(root.fleet?.rows?.chunks||[]),...(root.stateCodec?.chunks||[])];
    if(ids.length>4096||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!/^[A-Za-z0-9._-]{1,160}$/.test(id))||Number(m.meta.saveRevision)!==(Number(root.saveRevision)||0)||Number(m.meta.simSeconds)!==(Number(root.simSeconds)||0))throw new Error('save-export-manifest-invalid');
    exportFiles.set(m.session,{json:m.json,meta:m.meta,ids:new Set(ids),chunks:new Map(),total:0});return {ok:true};
  }
  const file=exportFiles.get(m.session);if(!file)throw new Error('save-export-session-missing');
  if(m.type==='export-chunk'){
    if(!file.ids.has(m.chunkId)||!(m.buffer instanceof ArrayBuffer)||m.buffer.byteLength<1||m.buffer.byteLength>MAX_BYTES||!Number.isSafeInteger(m.byteLength)||m.byteLength<1||m.byteLength>64*1024*1024||!Number.isSafeInteger(m.offset)||m.offset<0)throw new Error('save-export-chunk-invalid');
    let chunk=file.chunks.get(m.chunkId);const bytes=new Uint8Array(m.buffer);
    if(!chunk){if(m.offset!==0||file.total+m.byteLength>EXPORT_LIMIT)throw new Error('save-export-chunk-budget');file.total+=m.byteLength;chunk={length:m.byteLength,written:0,data:bytes.length===m.byteLength?bytes:new Uint8Array(m.byteLength)};file.chunks.set(m.chunkId,chunk);}
    if(chunk.length!==m.byteLength||chunk.written!==m.offset||m.offset+bytes.length>chunk.length)throw new Error('save-export-chunk-order');
    if(chunk.data!==bytes)chunk.data.set(bytes,m.offset);chunk.written+=bytes.length;return {ok:true};
  }
  if(m.type!=='export-finish')throw new Error('save-export-command-invalid');
  try{
    if(file.chunks.size!==file.ids.size||[...file.chunks.values()].some(c=>c.written!==c.length))throw new Error('save-export-incomplete');
    if(!self.GH_FLEET_STORE)importScripts('fleet-store-core.js');
    const codec=self.GH_STATE_CODEC,state=codec.deserialize(file.json,{resolveChunk:id=>file.chunks.get(id)?.data}),rows=state.fleet?.rows,parts=[JSON.stringify(file.meta).slice(0,-1)+',"state":'];
    if(rows instanceof ArrayBuffer){
      const token='\u0000gh-export:'+m.session+'\u0000',needle=JSON.stringify(token).slice(1,-1),marker=JSON.stringify({$ghBinary:'arraybuffer-v1',byteLength:rows.byteLength,base64:token}),text=codec.serialize(state,{rowsText:marker}),at=text.indexOf(needle);
      if(at<0||text.indexOf(needle,at+needle.length)!==-1)throw new Error('save-export-marker-invalid');parts.push(new Blob([text.slice(0,at)]));
      // 4,194,303 is divisible by three; concatenated base64 fragments have padding only in the final fragment.
      for(let offset=0;offset<rows.byteLength;offset+=4194303)parts.push(new Blob([codec.bytesToBase64(new Uint8Array(rows,offset,Math.min(4194303,rows.byteLength-offset)))]));
      parts.push(new Blob([text.slice(at+needle.length)]));
    }else parts.push(new Blob([codec.serialize(state)]));
    parts.push('}');const blob=new Blob(parts,{type:'application/json'});if(blob.size>1073741824)throw new Error('save-export-file-budget');return {ok:true,blob};
  }finally{exportFiles.delete(m.session);importScripts('state-codec-core.js');}
}
self.addEventListener('message',event=>{
  const m=event.data||{},started=performance.now();
  try{
    if(['export-start','export-chunk','export-finish','export-abort'].includes(m.type)){const result=exportMessage(m);self.postMessage({type:m.type+'-result',version:VERSION,id:m.id,session:m.session,...result,...(m.type==='export-finish'?{remainingFiles:exportFiles.size,codecCacheEntries:self.GH_STATE_CODEC.cacheStats().entries}:{}),workerMs:performance.now()-started});return;}
    if(!['checksum','base64','chunk-encode'].includes(m.type)||m.version!==VERSION||!Number.isSafeInteger(m.id)||!(m.buffer instanceof ArrayBuffer)||m.buffer.byteLength<1||m.buffer.byteLength>MAX_BYTES||m.transform!=null&&m.type!=='checksum')throw new Error('save-checksum-request-invalid');
    const bytes=new Uint8Array(m.buffer);
    if(m.type==='chunk-encode'){const packed=m.stride===8?self.GH_SAVE_CHUNK_CODEC.packContainer(bytes):self.GH_SAVE_CHUNK_CODEC.pack(bytes,m.stride);self.postMessage({type:'chunk-encode-result',version:VERSION,id:m.id,encoding:packed.encoding,rawBytes:bytes.byteLength,buffer:packed.bytes.buffer,workerMs:performance.now()-started},[packed.bytes.buffer]);}
    else if(m.type==='base64')self.postMessage({type:'base64-result',version:VERSION,id:m.id,text:self.GH_STATE_CODEC.bytesToBase64(bytes),workerMs:performance.now()-started});
    else{const expected=Number.isSafeInteger(m.expectedBytes)?m.expectedBytes:bytes.byteLength,output=m.transform?transformFleet(bytes,m.transform,expected):bytes;if(output.byteLength!==expected||output.byteLength>MAX_BYTES)throw new Error('save-checksum-output-invalid');
      // Lane consumers use all 16 independent hashes. A second whole-page hash is unused; raw replica proofs still
      // require their original checksum over the complete row page.
      const evidence=m.transform?.kind==='fleet-lanes-v1'?{laneSums:Array.from({length:16},(_,i)=>self.GH_STATE_CODEC.chunkChecksum(output.subarray(i*output.length/16,(i+1)*output.length/16)))}:{checksum:self.GH_STATE_CODEC.chunkChecksum(output)};
      self.postMessage({type:'checksum-result',version:VERSION,id:m.id,...evidence,buffer:output.buffer,workerMs:performance.now()-started},[output.buffer]);}
  }catch(error){self.postMessage({type:'checksum-error',version:VERSION,id:m.id,error:String(error?.message||error).slice(0,200)});}
});
