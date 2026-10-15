'use strict';
importScripts('state-codec-core.js');
const VERSION='save-checksum-v1',MAX_BYTES=4*1024*1024;
self.addEventListener('message',event=>{
  const m=event.data||{},started=performance.now();
  try{
    if(!['checksum','base64'].includes(m.type)||m.version!==VERSION||!Number.isSafeInteger(m.id)||!(m.buffer instanceof ArrayBuffer)||m.buffer.byteLength<1||m.buffer.byteLength>MAX_BYTES)throw new Error('save-checksum-request-invalid');
    const bytes=new Uint8Array(m.buffer);
    if(m.type==='base64')self.postMessage({type:'base64-result',version:VERSION,id:m.id,text:self.GH_STATE_CODEC.bytesToBase64(bytes),workerMs:performance.now()-started});
    else{const checksum=self.GH_STATE_CODEC.chunkChecksum(bytes);self.postMessage({type:'checksum-result',version:VERSION,id:m.id,checksum,buffer:m.buffer,workerMs:performance.now()-started},[m.buffer]);}
  }catch(error){self.postMessage({type:'checksum-error',version:VERSION,id:m.id,error:String(error?.message||error).slice(0,200)});}
});
