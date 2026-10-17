// Wire compression only. Vault chunks, their IDs, the manifest and the save schema keep their original bytes.
// Loaded by the save worker, never by the presentation thread. PackBits byte planes are bounded to one 4 MiB chunk.
// Header (little endian): "GHCPRLE1", u32 raw length, u16 stride, u16 zero, u32 CRC-32/ISO-HDLC of raw bytes.
// Each byte plane then contains PackBits packets until its exact raw element count is reached. 128 (NOP) is invalid.
(()=>{
  'use strict';
  const ENCODING='gh-packbits-v1',MAX_BYTES=4*1024*1024,HEADER=20,MAGIC=[71,72,67,80,82,76,69,49];
  const table=new Uint32Array(256);for(let i=0;i<256;i++){let c=i;for(let b=0;b<8;b++)c=c&1?0xedb88320^(c>>>1):c>>>1;table[i]=c>>>0;}
  function crc32(bytes){let c=0xffffffff;for(let i=0;i<bytes.length;i++)c=table[(c^bytes[i])&255]^(c>>>8);return (c^0xffffffff)>>>0;}
  function pack(bytes,stride=128){
    if(!(bytes instanceof Uint8Array)||bytes.length<1||bytes.length>MAX_BYTES||![1,13,128].includes(stride))throw new Error('save-chunk-pack-input');
    const limit=Math.floor(bytes.length*.875);if(limit<=HEADER)return {encoding:'identity',bytes};
    // Abort as soon as compression cannot pay for its own wire overhead. No expanding output is ever sent.
    const out=new Uint8Array(limit),view=new DataView(out.buffer);out.set(MAGIC);view.setUint32(8,bytes.length,true);view.setUint16(12,stride,true);let written=HEADER;
    for(let plane=0;plane<Math.min(stride,bytes.length);plane++){
      const count=Math.floor((bytes.length-1-plane)/stride)+1;let at=0;
      const value=i=>bytes[plane+i*stride];
      while(at<count){
        let run=1;while(run<128&&at+run<count&&value(at+run)===value(at))run++;
        if(run>=3){if(written+2>limit)return {encoding:'identity',bytes};out[written++]=257-run;out[written++]=value(at);at+=run;continue;}
        const start=at;at+=run;
        while(at<count&&at-start<128){let next=1;while(next<3&&at+next<count&&value(at+next)===value(at))next++;if(next>=3)break;at+=Math.min(next,128-(at-start));}
        const length=at-start;if(written+1+length>limit)return {encoding:'identity',bytes};out[written++]=length-1;for(let i=start;i<at;i++)out[written++]=value(i);
      }
    }
    view.setUint32(16,crc32(bytes),true);return {encoding:ENCODING,bytes:out.slice(0,written)};
  }
  // Reference decoder also used by adversarial tests; production iOS decodes the same bounded stream on its vault queue.
  function unpack(bytes,rawBytes){
    const bad=()=>{throw new Error('save-chunk-pack-corrupt');};
    if(!(bytes instanceof Uint8Array)||bytes.length<HEADER||bytes.length>MAX_BYTES||MAGIC.some((v,i)=>bytes[i]!==v))bad();
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),length=view.getUint32(8,true),stride=view.getUint16(12,true);
    if(length<1||length>MAX_BYTES||length!==rawBytes||![1,13,128].includes(stride)||view.getUint16(14,true)!==0||bytes.length>=length)bad();
    const out=new Uint8Array(length);let read=HEADER;
    for(let plane=0;plane<Math.min(stride,length);plane++){
      const count=Math.floor((length-1-plane)/stride)+1;let at=0;
      while(at<count){if(read>=bytes.length)bad();const control=bytes[read++];if(control===128)bad();const run=control<=127?control+1:257-control;if(run>count-at)bad();
        if(control<=127){if(read+run>bytes.length)bad();for(let i=0;i<run;i++)out[plane+(at+i)*stride]=bytes[read++];}
        else{if(read>=bytes.length)bad();const value=bytes[read++];for(let i=0;i<run;i++)out[plane+(at+i)*stride]=value;}
        at+=run;
      }
    }
    if(read!==bytes.length||crc32(out)!==view.getUint32(16,true))bad();return out;
  }
  const api=Object.freeze({ENCODING,MAX_BYTES,pack,unpack,crc32});globalThis.GH_SAVE_CHUNK_CODEC=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
