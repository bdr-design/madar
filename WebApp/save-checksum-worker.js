'use strict';
importScripts('state-codec-core.js');
const VERSION='save-checksum-v1',MAX_BYTES=4*1024*1024;
const FLEET_STRIDE=128,FLEET_WORDS=[27,28,29],FLEET_PRESENT_WORD=12,FLEET_PRESENT_MASK=((1<<18)|(1<<19)|(1<<20))>>>0,FLEET_PAGE_BYTES=13;
function transformFleet(bytes,transform,expectedBytes){
  if(!transform||!Number.isSafeInteger(transform.stride)||transform.stride!==FLEET_STRIDE||!Array.isArray(transform.words)||transform.words.length!==3||transform.words.some((word,index)=>word!==FLEET_WORDS[index])||transform.presentWord!==FLEET_PRESENT_WORD||transform.presentMask!==FLEET_PRESENT_MASK||transform.presentShift!==18||transform.bytesPerRow!==FLEET_PAGE_BYTES||bytes.byteLength%FLEET_STRIDE!==0)throw new Error('save-checksum-transform-invalid');
  if(transform.kind==='fleet-base-v1'){
    if(expectedBytes!==bytes.byteLength)throw new Error('save-checksum-output-invalid');const words=new Uint32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength>>>2),stride=FLEET_STRIDE>>>2;
    for(let row=0;row<bytes.byteLength/FLEET_STRIDE;row++){const at=row*stride;for(const word of FLEET_WORDS)words[at+word]=0;words[at+FLEET_PRESENT_WORD]&=~FLEET_PRESENT_MASK;}
    return bytes;
  }
  if(transform.kind==='fleet-overlay-v1'){
    const rows=bytes.byteLength/FLEET_STRIDE;if(expectedBytes!==rows*FLEET_PAGE_BYTES)throw new Error('save-checksum-output-invalid');const page=new Uint8Array(expectedBytes),pageView=new DataView(page.buffer),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    for(let row=0;row<rows;row++){
      const rowAt=row*FLEET_STRIDE,pageAt=row*FLEET_PAGE_BYTES;
      for(let field=0;field<FLEET_WORDS.length;field++)pageView.setUint32(pageAt+field*4,view.getUint32(rowAt+FLEET_WORDS[field]*4,true),true);
      page[pageAt+12]=(view.getUint32(rowAt+FLEET_PRESENT_WORD*4,true)&FLEET_PRESENT_MASK)>>>18;
    }
    return page;
  }
  throw new Error('save-checksum-transform-invalid');
}
self.addEventListener('message',event=>{
  const m=event.data||{},started=performance.now();
  try{
    if(!['checksum','base64'].includes(m.type)||m.version!==VERSION||!Number.isSafeInteger(m.id)||!(m.buffer instanceof ArrayBuffer)||m.buffer.byteLength<1||m.buffer.byteLength>MAX_BYTES||m.transform!=null&&m.type!=='checksum')throw new Error('save-checksum-request-invalid');
    const bytes=new Uint8Array(m.buffer);
    if(m.type==='base64')self.postMessage({type:'base64-result',version:VERSION,id:m.id,text:self.GH_STATE_CODEC.bytesToBase64(bytes),workerMs:performance.now()-started});
    else{const expected=Number.isSafeInteger(m.expectedBytes)?m.expectedBytes:bytes.byteLength,output=m.transform?transformFleet(bytes,m.transform,expected):bytes;if(output.byteLength!==expected||output.byteLength>MAX_BYTES)throw new Error('save-checksum-output-invalid');const checksum=self.GH_STATE_CODEC.chunkChecksum(output);self.postMessage({type:'checksum-result',version:VERSION,id:m.id,checksum,buffer:output.buffer,workerMs:performance.now()-started},[output.buffer]);}
  }catch(error){self.postMessage({type:'checksum-error',version:VERSION,id:m.id,error:String(error?.message||error).slice(0,200)});}
});
