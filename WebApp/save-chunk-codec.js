// Wire compression preserves original vault bytes; the separate stored-container codec owns a new immutable ID.
// Compression runs only on the existing save worker. Bootstrap decodes one bounded container at a time.
// Both codecs preserve all row bits; neither runs during simulation or rendering.
// Header (little endian): "GHCPRLE1", u32 raw length, u16 stride, u16 zero, u32 CRC-32/ISO-HDLC of raw bytes.
// Each byte plane then contains PackBits packets until its exact raw element count is reached. 128 (NOP) is invalid.
(()=>{
  'use strict';
  const ENCODING='gh-packbits-v1',MAX_BYTES=4*1024*1024,HEADER=20,MAGIC=[71,72,67,80,82,76,69,49];
  const table=new Uint32Array(256);for(let i=0;i<256;i++){let c=i;for(let b=0;b<8;b++)c=c&1?0xedb88320^(c>>>1):c>>>1;table[i]=c>>>0;}
  const crcPlanes=Array.from({length:8},(_,i)=>i===0?table:new Uint32Array(256));
  for(let plane=1;plane<8;plane++)for(let i=0;i<256;i++){const c=crcPlanes[plane-1][i];crcPlanes[plane][i]=table[c&255]^(c>>>8);}
  function crc32(bytes){
    let c=0xffffffff,i=0;const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),t=crcPlanes;
    for(;i+8<=bytes.length;i+=8){const a=(c^view.getUint32(i,true))>>>0,b=view.getUint32(i+4,true);c=t[7][a&255]^t[6][a>>>8&255]^t[5][a>>>16&255]^t[4][a>>>24]^t[3][b&255]^t[2][b>>>8&255]^t[1][b>>>16&255]^t[0][b>>>24];}
    for(;i<bytes.length;i++)c=table[(c^bytes[i])&255]^(c>>>8);return (c^0xffffffff)>>>0;
  }
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

  // Block compressor adapted from lz4js 0.2.0 (ISC), John Chadwick.
  // Full copyright and permission notice: THIRD_PARTY_NOTICES.txt (bundled with the app).
  // Only bounded block compression is vendored; decode validates every extent below.
  const minMatch=4,minLength=13,searchLimit=5,skipTrigger=6,mlMask=15,runMask=15,mlBits=4;
// Simple hash function, from: http://burtleburtle.net/bob/hash/integer.html.
// Chosen because it doesn't use multiply and achieves full avalanche.
function hashU32 (a) {
  a = a | 0;
  a = a + 2127912214 + (a << 12) | 0;
  a = a ^ -949894596 ^ a >>> 19;
  a = a + 374761393 + (a << 5) | 0;
  a = a + -744332180 ^ a << 9;
  a = a + -42973499 + (a << 3) | 0;
  return a ^ -1252372727 ^ a >>> 16 | 0;
}

// Reads a 32-bit little-endian integer from an array.
function readU32 (b, n) {
  var x = 0;
  x |= b[n++] << 0;
  x |= b[n++] << 8;
  x |= b[n++] << 16;
  x |= b[n++] << 24;
  return x;
}

function compressBlock (src, dst, sIndex, sLength, hashTable) {
  var mIndex, mAnchor, mLength, mOffset, mStep;
  var literalCount, dIndex, sEnd, n;

  // Setup initial state.
  dIndex = 0;
  sEnd = sLength + sIndex;
  mAnchor = sIndex;

  // Process only if block is large enough.
  if (sLength >= minLength) {
    var searchMatchCount = (1 << skipTrigger) + 3;

    // Consume until last n literals (Lz4 spec limitation.)
    while (sIndex + minMatch < sEnd - searchLimit) {
      var seq = readU32(src, sIndex);
      var hash = hashU32(seq) >>> 0;

      // Crush hash to 16 bits.
      hash = ((hash >> 16) ^ hash) >>> 0 & 0xffff;

      // Look for a match in the hashtable. NOTE: remove one; see below.
      mIndex = hashTable[hash] - 1;

      // Put pos in hash table. NOTE: add one so that zero = invalid.
      hashTable[hash] = sIndex + 1;

      // Determine if there is a match (within range.)
      if (mIndex < 0 || ((sIndex - mIndex) >>> 16) > 0 || readU32(src, mIndex) !== seq) {
        mStep = searchMatchCount++ >> skipTrigger;
        sIndex += mStep;
        continue;
      }

      searchMatchCount = (1 << skipTrigger) + 3;

      // Calculate literal count and offset.
      literalCount = sIndex - mAnchor;
      mOffset = sIndex - mIndex;

      // We've already matched one word, so get that out of the way.
      sIndex += minMatch;
      mIndex += minMatch;

      // Determine match length.
      // N.B.: mLength does not include minMatch, Lz4 adds it back
      // in decoding.
      mLength = sIndex;
      while (sIndex < sEnd - searchLimit && src[sIndex] === src[mIndex]) {
        sIndex++;
        mIndex++;
      }
      mLength = sIndex - mLength;

      // Write token + literal count.
      var token = mLength < mlMask ? mLength : mlMask;
      if (literalCount >= runMask) {
        dst[dIndex++] = (runMask << mlBits) + token;
        for (n = literalCount - runMask; n >= 0xff; n -= 0xff) {
          dst[dIndex++] = 0xff;
        }
        dst[dIndex++] = n;
      } else {
        dst[dIndex++] = (literalCount << mlBits) + token;
      }

      // Write literals.
      for (var i = 0; i < literalCount; i++) {
        dst[dIndex++] = src[mAnchor + i];
      }

      // Write offset.
      dst[dIndex++] = mOffset;
      dst[dIndex++] = (mOffset >> 8);

      // Write match length.
      if (mLength >= mlMask) {
        for (n = mLength - mlMask; n >= 0xff; n -= 0xff) {
          dst[dIndex++] = 0xff;
        }
        dst[dIndex++] = n;
      }

      // Move the anchor.
      mAnchor = sIndex;
    }
  }

  // Nothing was encoded.
  if (mAnchor === 0) {
    return 0;
  }

  // Write remaining literals.
  // Write literal token+count.
  literalCount = sEnd - mAnchor;
  if (literalCount >= runMask) {
    dst[dIndex++] = (runMask << mlBits);
    for (n = literalCount - runMask; n >= 0xff; n -= 0xff) {
      dst[dIndex++] = 0xff;
    }
    dst[dIndex++] = n;
  } else {
    dst[dIndex++] = (literalCount << mlBits);
  }

  // Write literals.
  sIndex = mAnchor;
  while (sIndex < sEnd) {
    dst[dIndex++] = src[sIndex++];
  }

  return dIndex;
}


  const LZ4_ENCODING='gh-lz4-block-v1',LZ4_MAGIC=[71,72,67,76,90,52,66,49];
  function packContainer(bytes){
    if(!(bytes instanceof Uint8Array)||bytes.length<1||bytes.length>MAX_BYTES)throw new Error('save-container-pack-input');
    const stride=bytes.length%8===0?8:1,shuffled=new Uint8Array(bytes.length),rows=bytes.length/stride;for(let lane=0;lane<stride;lane++)for(let row=0;row<rows;row++)shuffled[lane*rows+row]=bytes[row*stride+lane];
    const block=new Uint8Array(bytes.length+Math.floor(bytes.length/255)+16),size=compressBlock(shuffled,block,0,bytes.length,new Uint32Array(65536));
    if(!size||size+HEADER>Math.floor(bytes.length*.875))return {encoding:'identity',bytes};
    const out=new Uint8Array(size+HEADER),view=new DataView(out.buffer);out.set(LZ4_MAGIC);view.setUint32(8,bytes.length,true);view.setUint32(12,stride,true);view.setUint32(16,crc32(bytes),true);out.set(block.subarray(0,size),HEADER);return {encoding:LZ4_ENCODING,bytes:out};
  }
  function unpackContainer(bytes,rawBytes){
    const bad=()=>{throw new Error('save-container-pack-corrupt');};
    if(!(bytes instanceof Uint8Array)||bytes.length<HEADER||bytes.length>MAX_BYTES||LZ4_MAGIC.some((v,i)=>bytes[i]!==v)||!Number.isSafeInteger(rawBytes)||rawBytes<1||rawBytes>MAX_BYTES||bytes.length>Math.floor(rawBytes*.875))bad();
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);if(view.getUint32(8,true)!==rawBytes||![1,8].includes(view.getUint32(12,true))||rawBytes%view.getUint32(12,true))bad();
    const out=new Uint8Array(rawBytes);let s=HEADER,d=0;
    const length=n=>{if(n===15){let x;do{if(s>=bytes.length)bad();x=bytes[s++];n+=x;if(n>rawBytes)bad();}while(x===255);}return n;};
    while(s<bytes.length){const token=bytes[s++],literals=length(token>>>4);if(s+literals>bytes.length||d+literals>rawBytes)bad();out.set(bytes.subarray(s,s+literals),d);s+=literals;d+=literals;if(s===bytes.length)break;if(s+2>bytes.length)bad();const offset=bytes[s]|bytes[s+1]<<8;s+=2;if(offset===0||offset>d)bad();const match=length(token&15)+4;if(d+match>rawBytes)bad();for(let i=0;i<match;i++){out[d]=out[d-offset];d++;}}
    if(s!==bytes.length||d!==rawBytes)bad();const stride=view.getUint32(12,true);let raw=out;if(stride>1){raw=new Uint8Array(rawBytes);const rows=rawBytes/stride;for(let lane=0;lane<stride;lane++)for(let row=0;row<rows;row++)raw[row*stride+lane]=out[lane*rows+row];}if(crc32(raw)!==view.getUint32(16,true))bad();return raw;
  }

  const api=Object.freeze({ENCODING,MAX_BYTES,pack,unpack,crc32,LZ4_ENCODING,packContainer,unpackContainer});globalThis.GH_SAVE_CHUNK_CODEC=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
