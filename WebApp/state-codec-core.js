(()=>{
  'use strict';

  // Global Holdings state codec (Build 350).
  //
  // Purpose: the persisted save repeated every property NAME and every identical nested value once per asset
  // (35 keys x 20,000 assets, plus the same crew-role table 20,000 times). That is a storage-format problem, not a
  // gameplay problem, so it is fixed at the storage boundary: large homogeneous collections are written as
  // "shape + positional cells" rows with an interned pool of repeated sub-values. The live in-memory state is never
  // changed; decode(encode(state)) is exactly JSON.parse(JSON.stringify(state)).
  //
  // Encoded value forms (every array below is a TAGGED array, so a raw JSON array can never be misread):
  //   primitive            string | finite number | boolean | null
  //   object               [shapeId, cell0, cell1, ...]     shapeId >= 0 selects an ordered key list
  //   array                [-1, item0, item1, ...]
  //   interned repeat      [-2, poolIndex]                  decoded to a FRESH copy on every use (no aliasing)
  //
  // Collections (arrays / key maps of plain objects with >= MIN_ROWS entries) become
  //   {"$gh":1,"s":shapes,"p":pool,"r":rows}                 array of objects
  //   {"$gh":2,"k":keys,"s":shapes,"p":pool,"r":rows}        map of objects
  // A shape is an ordered key list, or {"k":keys,"c":[[position,cell],...]} where the listed positions hold a value
  // that is IDENTICAL in every row of that shape (stored once, omitted from the rows). Key order is always preserved.
  // The root carries  stateCodec:{version,paths}  so decoding needs no external configuration.
  // Build 358: a collection of SEGMENT_MIN+ rows is written as consecutive segments,
  //   {"$gh":3,"a":1|0,"g":[segment,...]}                   each segment a $gh:1 (array) or $gh:2 (map) collection
  // so a save re-encodes only the segments whose members changed (see serialize). Such a save is SEG_VERSION.
  // Build 359 (iPhone diagnostic: some saves re-sent 52-54 chunks, 14.6 MB, in 0.5-0.77 s): segments were 256 rows by
  // position, so archiving one record shifted every later segment and each was re-encoded and uploaded again. A
  // segment now ends after a member whose identity (map key, or the id/number of an array item) hashes to a boundary,
  // once it holds SEGMENT_FLOOR rows, or at SEGMENT_CEIL rows: removing or adding a member changes its own segment and
  // at most the next. The cached text of a segment is found by its first member's identity, not by its index. A
  // collection whose members have no identity (or a repeated one) keeps the 256-row segments. Readers never relied on
  // segment sizes.
  // Build 358 (save size): with the native vault, a sealed segment (or a whole sealed collection) of TEXT_CHUNK_MIN+
  // characters is kept out of the save text as a vault chunk holding its JSON text (UTF-8):
  //   {"$ghText":"chunk-v1","id":id,"bytes":byteLength}
  // stateCodec.chunks lists every such id in order, so the vault can require them before a commit and keep them while
  // a save mentions them. Such a save is TEXT_VERSION. Only serializeChunked writes these; serialize, encodeState and
  // exports stay self-contained.

  const VERSION='gh-shape-1';
  // Build 358 (million-asset save): runs of sequential ids. An array of RUN_MIN+ strings `prefix + digits` whose
  // numbers are consecutive (the fleet store's pattern rule: zero padding kept as a width) is stored as
  //   [-3, prefix, width, first, count]
  // inside collections, and at RUN paths (meta.runPaths) elsewhere; every element is compared with its rebuilt text
  // before a run is written, so decoding gives exactly the same array. A save with run paths is written as
  // RUN_VERSION, which earlier decoders reject (they would otherwise keep the run marker as data).
  const RUN_VERSION='gh-shape-2',RUN_MIN=64,RUN_MAX=1<<24,RUN_HEAD=/^([\s\S]*?)(\d{1,10})$/;
  function runText(prefix,width,number){const digits=String(number);return prefix+(width?digits.padStart(width,'0'):digits);}
  function idRun(list){
    if(!Array.isArray(list)||list.length<RUN_MIN||list.length>RUN_MAX||typeof list[0]!=='string')return null;
    const head=RUN_HEAD.exec(list[0]);if(!head)return null;
    const prefix=head[1],digits=head[2],first=Number(digits),width=digits.length>1&&digits[0]==='0'?digits.length:0;
    if(first+list.length-1>0xFFFFFFFF||runText(prefix,width,first)!==list[0])return null;
    for(let i=1;i<list.length;i++)if(list[i]!==runText(prefix,width,first+i))return null;
    return [-3,prefix,width,first,list.length];
  }
  function expandRun(cell){
    const [tag,prefix,width,first,count]=cell;
    if(cell.length!==5||tag!==-3||typeof prefix!=='string'||!Number.isInteger(width)||width<0||width>10||!Number.isSafeInteger(first)||first<0||!Number.isInteger(count)||count<1||count>RUN_MAX||first+count-1>0xFFFFFFFF)throw corrupt('run');
    const out=new Array(count);for(let i=0;i<count;i++)out[i]=runText(prefix,width,first+i);return out;
  }
  const MIN_ROWS=64,SEGMENT_ROWS=256,SEGMENT_MIN=SEGMENT_ROWS*2,SEGMENT_FLOOR=64,SEGMENT_CEIL=1024,SEG_VERSION='gh-shape-3',TEXT_VERSION='gh-shape-4',TEXT_CHUNK_MIN=16384;
  const COLD_PAGE_VERSION='gh-cold-archive-page-v1',COLD_PAGE_MARKER='chunk-v1',COLD_PAGE_BYTES=new WeakMap();let coldPageSequence=0;
  const MIN_POOL_CHARS=40;
  const MIN_CONSTANT_ROWS=4;
  const MAX_DEPTH=64;
  const MAX_SCAN_DEPTH=5;

  const own=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
  function isArrayBuffer(value){return !!value&&Object.prototype.toString.call(value)==='[object ArrayBuffer]';}
  // Build 358: base64 for the fleet record buffer (128 bytes per asset). The former String.fromCharCode + btoa path ran at
  // ~45 ns/byte (1.15 s for 25 MB in V8); the native Uint8Array toBase64/fromBase64 (Safari 18.2+) is used when present,
  // otherwise a 12-bit pair table writes ASCII bytes that TextDecoder turns into the string (~2 ns/byte). Output is
  // identical to btoa. Decoding falls back to atob on anything but canonical base64, so errors are unchanged.
  const B64='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',B64_CODES=new Uint8Array(64),B64_PAIRS=new Uint16Array(4096),B64_VALUES=new Int16Array(256).fill(-1);
  for(let i=0;i<64;i++){B64_CODES[i]=B64.charCodeAt(i);B64_VALUES[B64_CODES[i]]=i;}
  for(let i=0;i<4096;i++)B64_PAIRS[i]=B64_CODES[i>>6]|(B64_CODES[i&63]<<8);
  const LITTLE_ENDIAN=new Uint8Array(new Uint16Array([1]).buffer)[0]===1,TEXT_STEP=1<<20;
  function asciiText(bytes){const decoder=new TextDecoder('latin1');let text='';for(let at=0;at<bytes.length;at+=TEXT_STEP)text+=decoder.decode(bytes.subarray(at,Math.min(bytes.length,at+TEXT_STEP)));return text;}
  function tableEncode(bytes){
    const n=bytes.length,full=n-n%3,out=new Uint8Array(Math.ceil(n/3)*4),pairs=new Uint16Array(out.buffer,0,out.length>>1);let j=0;
    for(let i=0;i<full;i+=3){const v=(bytes[i]<<16)|(bytes[i+1]<<8)|bytes[i+2];pairs[j++]=B64_PAIRS[v>>>12];pairs[j++]=B64_PAIRS[v&4095];}
    let o=j*2;const rest=n-full;
    if(rest){const v=(bytes[full]<<16)|(rest===2?bytes[full+1]<<8:0);out[o++]=B64_CODES[v>>>18];out[o++]=B64_CODES[(v>>>12)&63];out[o++]=rest===2?B64_CODES[(v>>>6)&63]:61;out[o++]=61;}
    return asciiText(out);
  }
  function base64Encode(bytes){
    if(typeof bytes.toBase64==='function')return bytes.toBase64();
    if(LITTLE_ENDIAN&&typeof TextDecoder==='function')return tableEncode(bytes);
    if(typeof btoa==='function'){const parts=[];for(let start=0;start<bytes.length;start+=32768)parts.push(String.fromCharCode(...bytes.subarray(start,Math.min(bytes.length,start+32768))));return btoa(parts.join(''));}
    if(typeof Buffer!=='undefined')return Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength).toString('base64');
    throw new Error('state-codec-base64-unavailable');
  }
  // Canonical base64 to bytes, or null (then the caller uses the atob path and its errors).
  function tableDecode(text){
    if(typeof TextEncoder!=='function'||text.length%4!==0)return null;
    const codes=new TextEncoder().encode(text);if(codes.length!==text.length)return null;
    const pad=text.length&&codes[codes.length-1]===61?(codes[codes.length-2]===61?2:1):0,n=text.length/4*3-pad,out=new Uint8Array(n);let o=0;
    for(let i=0;i<codes.length;i+=4){
      const a=B64_VALUES[codes[i]],b=B64_VALUES[codes[i+1]],last=i+4===codes.length,c=last&&pad===2?0:B64_VALUES[codes[i+2]],d=last&&pad>=1?0:B64_VALUES[codes[i+3]];
      if((a|b|c|d)<0)return null;const v=(a<<18)|(b<<12)|(c<<6)|d;
      out[o++]=v>>>16;if(o<n)out[o++]=(v>>>8)&255;if(o<n)out[o++]=v&255;
    }
    return out;
  }
  function base64Decode(text){
    if(typeof atob==='function')return atob(text);
    if(typeof Buffer!=='undefined')return Buffer.from(text,'base64').toString('binary');
    throw corrupt('binary-decoder-unavailable');
  }
  function binaryMarker(buffer){
    const bytes=new Uint8Array(buffer);return {$ghBinary:'arraybuffer-v1',byteLength:bytes.length,base64:base64Encode(bytes)};
  }
  // Build 358: the fleet record buffer is encoded per segment of ROW_SEGMENT_CHUNKS store chunks. A segment is 12 MiB,
  // a multiple of 3 bytes, so the base64 of the whole buffer is exactly the concatenation of the segments' base64. A
  // segment whose chunks were not written since the last save (GH_FLEET_STORE.chunkStamp: same runtime, mass version and
  // chunk versions) reuses its text. Each save re-encodes one reused segment (in rotation) and compares; a mismatch
  // drops the cache and the save is encoded from scratch. The text equals JSON.stringify(binaryMarker(store.rows)).
  const ROW_SEGMENT_CHUNKS=3,rowSegmentCache=new WeakMap();
  let rowCacheStats={hits:0,misses:0,verified:0,mismatches:0};
  function rowsMarkerText(store){
    const STORE=globalThis.GH_FLEET_STORE,bytes=new Uint8Array(store.rows),whole=()=>JSON.stringify(binaryMarker(store.rows));
    if(typeof STORE?.chunkStamp!=='function'||STORE.isStore?.(store)!==true)return whole();
    const segmentBytes=STORE.CHUNK_ROWS*STORE.STRIDE*ROW_SEGMENT_CHUNKS;if(!Number.isSafeInteger(segmentBytes)||segmentBytes<=0||segmentBytes%3!==0)return whole();
    const stamp=STORE.chunkStamp(store),count=Math.ceil(bytes.length/segmentBytes);let entry=rowSegmentCache.get(store);
    if(!entry){entry={segments:[],rotation:0};rowSegmentCache.set(store,entry);}
    const parts=new Array(count),reused=[];
    for(let segment=0;segment<count;segment++){
      const start=segment*segmentBytes,end=Math.min(bytes.length,start+segmentBytes),first=segment*ROW_SEGMENT_CHUNKS;
      let key=`${stamp.runtime}:${stamp.mass}:${start}:${end}`;for(let chunk=first;chunk<first+ROW_SEGMENT_CHUNKS;chunk++)key+=':'+(stamp.versions[chunk]??0);
      const cached=entry.segments[segment];
      if(cached&&cached.key===key){parts[segment]=cached.text;reused.push(segment);rowCacheStats.hits++;}
      else{const text=base64Encode(bytes.subarray(start,end));entry.segments[segment]={key,text};parts[segment]=text;rowCacheStats.misses++;}
    }
    entry.segments.length=count;
    if(reused.length){
      const segment=reused[entry.rotation++%reused.length],start=segment*segmentBytes;rowCacheStats.verified++;
      if(base64Encode(bytes.subarray(start,Math.min(bytes.length,start+segmentBytes)))!==parts[segment]){
        rowCacheStats.mismatches++;rowSegmentCache.delete(store);
        try{globalThis.console?.warn?.('state-codec: fleet row cache mismatch; encoding the whole buffer');}catch{}
        return whole();
      }
    }
    return `{"$ghBinary":"arraybuffer-v1","byteLength":${bytes.length},"base64":"${parts.join('')}"}`;
  }
  // Build 358 (million-asset save): 'chunks-v1' keeps the record buffer out of the JSON text. The marker lists one id
  // per 4 MiB store chunk; options.resolveChunk(id) returns that chunk's bytes (the native vault serves them), so the
  // decoded buffer is assembled from memory. Every length is checked; a missing or short chunk is a corrupt save.
  const CHUNK_ID=/^[A-Za-z0-9._-]{1,160}$/;
  // Build 397: the daily flight counters change across the fleet at day close. Native saves keep their row chunks
  // immutable and store the three f32 words plus their presence bits in one compact page per row chunk. Version 1 is
  // deliberately tied to Fleet Store v3's fixed 128-byte records; older chunks-v1 saves remain valid as-is.
  const FLEET_ROW_STRIDE=128,FLEET_OVERLAY_WORDS=Object.freeze([27,28,29]),FLEET_PRESENT_WORD=12,FLEET_OVERLAY_BYTES_PER_ROW=13;
  const FLEET_OVERLAY_FIELDS=Object.freeze(['flightHours','flightCycles','nextCheckHours']);
  const FLEET_OVERLAY_PRESENT_MASK=((1<<18)|(1<<19)|(1<<20))>>>0;
  // A bounded chain of exact row images reuses the immutable base pages after worker movement. No scanning,
  // timer, or save runs during play. The existing replay hands over only its small list of changed row indices.
  // Unknown writers, structural changes, rollback, missing ancestors and the chain budget use a fresh base instead.
  const ROW_PATCH_MAGIC=[71,72,70,82,79,87,80,49],ROW_PATCH_HEADER=24,ROW_PATCH_RECORD=132;
  const ROW_PATCH_MAX_CHUNKS=128,ROW_PATCH_MAX_BYTES=16*1024*1024,ROW_PATCH_MAX_PENDING=65536,ROW_PATCH_MAX_BATCHES=256;
  const rowPatchEnabled=()=>globalThis.GH_NATIVE_ROW_PATCHES===1;
  function rowPatchParts(marker){
    if(marker.rowPatches===undefined)return [];
    const part=marker.rowPatches;
    if(!isPlain(part)||part.version!==1||!Array.isArray(part.chunks)||part.chunks.length>ROW_PATCH_MAX_CHUNKS)throw corrupt('binary-row-patches');
    let total=0;
    for(const p of part.chunks){
      if(!isPlain(p)||typeof p.id!=='string'||!CHUNK_ID.test(p.id)||!Number.isSafeInteger(p.rows)||p.rows<1||!Number.isSafeInteger(p.byteLength)||p.byteLength!==ROW_PATCH_HEADER+p.rows*ROW_PATCH_RECORD||p.byteLength>4194304||!Array.isArray(p.overlayChunks)||p.overlayChunks.length!==Math.ceil(marker.byteLength/marker.chunkBytes)||p.overlayChunks.some(id=>typeof id!=='string'||!CHUNK_ID.test(id)))throw corrupt('binary-row-patches');
      total+=p.byteLength;
    }
    if(total>ROW_PATCH_MAX_BYTES)throw corrupt('binary-row-patches');return part.chunks;
  }
  function applyRowPatch(bytes,patch,descriptor,overlayChunks,chunkBytes){
    const v=new DataView(patch.buffer,patch.byteOffset,patch.byteLength);
    if(patch.length!==descriptor.byteLength||ROW_PATCH_MAGIC.some((n,i)=>patch[i]!==n)||v.getUint32(8,true)!==bytes.length||v.getUint32(12,true)!==128||v.getUint32(16,true)!==descriptor.rows||v.getUint32(20,true)!==0)throw corrupt('binary-row-patch-header');
    const target=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let previous=-1;
    for(let n=0;n<descriptor.rows;n++){
      const from=ROW_PATCH_HEADER+n*ROW_PATCH_RECORD,index=v.getUint32(from,true);
      if(index<=previous||index>=bytes.length/128)throw corrupt('binary-row-patch-index');previous=index;
      const at=index*128,page=Math.floor(at/chunkBytes),keepCounters=descriptor.overlayChunks[page]!==overlayChunks[page];
      // The latest daily overlay wins only if that page changed after this row image was recorded. Otherwise the
      // row image itself may contain newer counter bits. IDs are immutable; historical IDs here are generation tokens.
      const hours=keepCounters?target.getUint32(at+108,true):0,cycles=keepCounters?target.getUint32(at+112,true):0,next=keepCounters?target.getUint32(at+116,true):0,present=keepCounters?target.getUint32(at+48,true)&FLEET_OVERLAY_PRESENT_MASK:0;
      bytes.set(patch.subarray(from+4,from+ROW_PATCH_RECORD),at);
      if(keepCounters){target.setUint32(at+108,hours,true);target.setUint32(at+112,cycles,true);target.setUint32(at+116,next,true);target.setUint32(at+48,(target.getUint32(at+48,true)&~FLEET_OVERLAY_PRESENT_MASK)|present,true);}
    }
  }
  function freshRowPatch(store,entry,layers=[]){return {buffer:store.rows,revision:store.revision,length:store.length,structure:store.structure,layers:layers.map(p=>({...p})),pending:[],pendingRows:0,invalid:false};}
  function rowPatchCurrent(store,patch,revision=store.revision){return !!patch&&!patch.invalid&&patch.buffer===store.rows&&patch.revision===revision&&patch.length===store.length&&patch.structure===store.structure;}
  function recordFleetRows(store,beforeRevision,indices,takeOwnership=false){
    if(!rowPatchEnabled())return false;const entry=chunkIdCache.get(store),held=entry?.rowPatch;if(!held)return false;
    if(!rowPatchCurrent(store,held,beforeRevision)||!(indices instanceof Int32Array)||held.pendingRows+indices.length>ROW_PATCH_MAX_PENDING||(indices.length&&held.pending.length>=ROW_PATCH_MAX_BATCHES)){held.invalid=true;held.pending=[];held.pendingRows=0;return false;}
    // The engine transfers its completed replay list, which it never edits or reuses. Other callers get a copy.
    // Keep only that list, not the ticket or its row buffer. Row data is copied only at save time.
    if(indices.length){held.pending.push(takeOwnership===true?indices:indices.slice());held.pendingRows+=indices.length;}held.revision=store.revision;return true;
  }
  function beginFleetOverlay(store,fields){
    if(!rowPatchEnabled()||!Array.isArray(fields)||fields.some(f=>!FLEET_OVERLAY_FIELDS.includes(f)))return null;
    const held=chunkIdCache.get(store)?.rowPatch;if(!rowPatchCurrent(store,held))return null;
    const stamp=globalThis.GH_FLEET_STORE.chunkStamp(store);return {held,buffer:store.rows,length:store.length,structure:store.structure,mass:stamp.chunkMass,raw:Array.from(stamp.rawVersions)};
  }
  function endFleetOverlay(store,ticket,completed){
    if(!ticket)return;const {held}=ticket,stamp=globalThis.GH_FLEET_STORE.chunkStamp(store);
    if(!completed||ticket.buffer!==store.rows||ticket.length!==store.length||ticket.structure!==store.structure||ticket.mass!==stamp.chunkMass||ticket.raw.some((n,i)=>n!==stamp.rawVersions[i])){held.invalid=true;return;}
    held.revision=store.revision;
  }
  function fleetRowChecksum(store,index,totalByteLength=store.rows.byteLength){
    const {chunkBytes,bytes}=chunkGeometry(store);
    if(!Number.isSafeInteger(totalByteLength)||totalByteLength<store.length*128||totalByteLength>536870912||totalByteLength%128||!Number.isSafeInteger(index)||index<0||index>=Math.ceil(totalByteLength/chunkBytes))throw new Error('fleet-save-proof-page');
    const start=index*chunkBytes,length=Math.min(chunkBytes,totalByteLength-start);
    // Replicas omit reserved capacity. Independently prove every used byte and the canonical zero tail, without
    // allocating a padded page. Unexpected bytes in the live store's tail still fail the normal checksum comparison.
    return {index,byteLength:length,checksum:paddedRowChecksum(bytes,start,length,store.length*128)};
  }
  function fleetOverlayLayout(){
    const STORE=globalThis.GH_FLEET_STORE;
    if(STORE&&(STORE.STRIDE!==FLEET_ROW_STRIDE||FLEET_OVERLAY_FIELDS.some((name,index)=>STORE.O?.[name]!==FLEET_OVERLAY_WORDS[index])||STORE.O?.present!==FLEET_PRESENT_WORD||FLEET_OVERLAY_FIELDS.some(name=>STORE.HOT_BIT?.[name]===undefined)||FLEET_OVERLAY_FIELDS.reduce((mask,name)=>mask|STORE.HOT_BIT[name],0)!==FLEET_OVERLAY_PRESENT_MASK))throw new Error('state-codec-fleet-overlay-layout');
    return {stride:FLEET_ROW_STRIDE,words:FLEET_OVERLAY_WORDS,presentWord:FLEET_PRESENT_WORD,presentMask:FLEET_OVERLAY_PRESENT_MASK};
  }
  function chunkBytesForId(id,options,meta,length,reason){
    let data;try{data=options.resolveChunk(id,meta);}catch{throw corrupt(reason);}
    const view=ArrayBuffer.isView(data)?new Uint8Array(data.buffer,data.byteOffset,data.byteLength):isArrayBuffer(data)?new Uint8Array(data):null;
    if(!view)throw corrupt(reason);if(view.length!==length)throw corrupt('binary-chunk-length');return view;
  }
  function chunkedBuffer(marker,options={}){
    if(marker.lanes!==undefined)return laneBuffer(marker,options);
    const {byteLength,chunkBytes,chunks}=marker,overlay=marker.overlay;
    if(!Number.isSafeInteger(byteLength)||byteLength<0||byteLength>536870912||!Number.isSafeInteger(chunkBytes)||chunkBytes<=0||!Array.isArray(chunks))throw corrupt('binary-chunks');
    if(typeof options.resolveChunk!=='function')throw corrupt('binary-chunks-unresolved');
    const buffer=new ArrayBuffer(byteLength),bytes=new Uint8Array(buffer),count=Math.ceil(byteLength/chunkBytes);
    if(overlay===undefined){
      if(marker.rowPatches!==undefined)throw corrupt('binary-row-patches');
      if(chunks.length!==count||chunks.some(id=>typeof id!=='string'||!CHUNK_ID.test(id)))throw corrupt('binary-chunks');
      for(let index=0;index<count;index++){
        const start=index*chunkBytes,length=Math.min(chunkBytes,byteLength-start),view=chunkBytesForId(chunks[index],options,{index,byteOffset:start,byteLength:length},length,'binary-chunk-missing');bytes.set(view,start);
      }
      return buffer;
    }
    const layout=fleetOverlayLayout(),baseChunks=marker.baseChunks,overlayChunks=overlay.chunks,patches=rowPatchParts(marker);
    if(overlay.version!==1||byteLength%layout.stride!==0||chunkBytes%layout.stride!==0||!Array.isArray(baseChunks)||baseChunks.length!==count||!Array.isArray(overlayChunks)||overlayChunks.length!==count||!Array.isArray(marker.baseNormalized)||marker.baseNormalized.length!==count||marker.baseNormalized.some(value=>typeof value!=='boolean')||overlay.fields?.length!==FLEET_OVERLAY_FIELDS.length||FLEET_OVERLAY_FIELDS.some((name,index)=>overlay.fields[index]!==name)||overlay.presentMask!==layout.presentMask||chunks.length!==count*2+patches.length)throw corrupt('binary-overlay');
    const all=[...baseChunks,...overlayChunks,...patches.map(p=>p.id)];if(all.some(id=>typeof id!=='string'||!CHUNK_ID.test(id))||new Set(all).size!==all.length||chunks.some((id,index)=>id!==all[index]))throw corrupt('binary-overlay-chunks');
    for(let index=0;index<count;index++){
      const start=index*chunkBytes,length=Math.min(chunkBytes,byteLength-start),base=chunkBytesForId(baseChunks[index],options,{kind:'fleet-base-v1',index,byteOffset:start,byteLength:length},length,'binary-chunk-missing');bytes.set(base,start);
    }
    const rowView=new DataView(buffer);
    for(let index=0;index<count;index++){
      const start=index*chunkBytes,length=Math.min(chunkBytes,byteLength-start),rows=length/layout.stride,pageLength=rows*FLEET_OVERLAY_BYTES_PER_ROW,page=chunkBytesForId(overlayChunks[index],options,{kind:'fleet-overlay-v1',index,byteOffset:start,byteLength:pageLength},pageLength,'binary-chunk-missing');
      const pageView=new DataView(page.buffer,page.byteOffset,page.byteLength);
      for(let row=0;row<rows;row++){
        const rowAt=start+row*layout.stride,pageAt=row*FLEET_OVERLAY_BYTES_PER_ROW;
        for(let field=0;field<layout.words.length;field++)rowView.setUint32(rowAt+layout.words[field]*4,pageView.getUint32(pageAt+field*4,true),true);
        const presentAt=rowAt+layout.presentWord*4,prior=rowView.getUint32(presentAt,true),packed=page[pageAt+12];if(packed>7)throw corrupt('binary-overlay-presence');const bits=(packed<<18)&layout.presentMask;rowView.setUint32(presentAt,(prior&~layout.presentMask)|bits,true);
      }
    }
    for(const p of patches)applyRowPatch(bytes,chunkBytesForId(p.id,options,{kind:'fleet-row-patch-v1',byteLength:p.byteLength},p.byteLength,'binary-chunk-missing'),p,overlayChunks,chunkBytes);
    return buffer;
  }
  function binaryBuffer(marker,options={}){
    if(isPlain(marker)&&marker.$ghBinary==='chunks-v1')return chunkedBuffer(marker,options);
    if(!isPlain(marker)||marker.$ghBinary!=='arraybuffer-v1'||!Number.isSafeInteger(marker.byteLength)||marker.byteLength<0||marker.byteLength>536870912||typeof marker.base64!=='string')throw corrupt('binary-marker');
    let fast=null;
    try{fast=typeof Uint8Array.fromBase64==='function'?Uint8Array.fromBase64(marker.base64):tableDecode(marker.base64);}catch{fast=null;}
    if(fast){if(fast.length!==marker.byteLength)throw corrupt('binary-length');return fast.byteOffset===0&&fast.byteLength===fast.buffer.byteLength?fast.buffer:fast.slice().buffer;}
    let raw;try{raw=base64Decode(marker.base64);}catch{throw corrupt('binary-base64');}if(raw.length!==marker.byteLength)throw corrupt('binary-length');
    const buffer=new ArrayBuffer(raw.length),bytes=new Uint8Array(buffer);for(let start=0;start<raw.length;start+=32768){const end=Math.min(raw.length,start+32768);for(let i=start;i<end;i++)bytes[i]=raw.charCodeAt(i);}
    return buffer;
  }
  // A plain data object: prototype is null or a ROOT prototype (its own prototype is null). That accepts objects from
  // any realm (iframe, vm context, worker-cloned state) while still rejecting class instances, Maps, Dates, etc.
  function isPlain(value){
    if(value===null||typeof value!=='object'||Array.isArray(value))return false;
    const proto=Object.getPrototypeOf(value);
    return proto===null||Object.getPrototypeOf(proto)===null;
  }
  function corrupt(reason){const error=new Error(`state-codec-corrupt:${reason}`);error.code='STATE_CODEC_CORRUPT';return error;}
  // JSON.parse creates an OWN "__proto__" property; a plain assignment would change the prototype instead.
  function assign(target,key,value){
    if(key==='__proto__')Object.defineProperty(target,key,{value,writable:true,enumerable:true,configurable:true});
    else target[key]=value;
  }

  // Pure structural encoding (no pooling yet): primitives, [-1,...items], or [shapeId,...cells].
  const COOPERATIVE_PARTS=new WeakSet();
  function createEncoder(){
    const rowShapeIds=new Map(),nestedShapeIds=new Map(),shapes=[];
    let largeString=false;
    const sameKeys=(a,b)=>{if(a.length!==b.length)return false;for(let i=0;i<a.length;i++)if(a[i]!==b[i])return false;return true;};
    const recent=new Map();                                    // registry -> last shape id (homogeneous rows hit this)
    const shapeFor=(registry,keys)=>{
      const last=recent.get(registry);
      if(last!==undefined&&sameKeys(shapes[last],keys))return last;
      const signature=JSON.stringify(keys);let id=registry.get(signature);
      if(id===undefined){id=shapes.length;shapes.push(keys);registry.set(signature,id);}
      recent.set(registry,id);return id;
    };
    function encodeObject(value,depth,registry){
      const keys=[],cells=[];
      for(const key of Object.keys(value)){
        const cell=encodeValue(value[key],depth+1);
        if(cell!==undefined){keys.push(key);cells.push(cell);}
      }
      return [shapeFor(registry,keys),...cells];
    }
    function encodeValue(value,depth){
      if(depth>MAX_DEPTH)throw new RangeError('state-codec-depth');
      switch(typeof value){
        case 'string':largeString ||= value.length>STRING_PIECE;return value;
        case 'boolean':return value;
        case 'number':return Number.isFinite(value)?value:null;
        case 'undefined':case 'function':case 'symbol':return undefined;
        case 'bigint':throw new TypeError('state-codec-bigint');
        default:break;
      }
      if(value===null)return null;
      if(typeof value.toJSON==='function'){const json=value.toJSON();if(json!==value)return encodeValue(json,depth+1);}
      if(Array.isArray(value)){
        const run=idRun(value);if(run)return run;
        const out=[-1];
        for(let i=0;i<value.length;i++){const cell=encodeValue(value[i],depth+1);out.push(cell===undefined?null:cell);}
        return out;
      }
      return encodeObject(value,depth,nestedShapeIds);
    }
    return {shapes,row:value=>encodeObject(value,0,rowShapeIds),largeString:()=>largeString};
  }

  // Pooling pass. The first occurrence stays inline; the second identical occurrence creates the pool entry and later
  // ones only reference it. Children are pooled before parents, so an entry only ever references LOWER indexes.
  function createPool(){
    const seen=new Map(),pool=[];
    function intern(encoded){
      if(encoded.length<3)return encoded;
      const signature=JSON.stringify(encoded);
      if(signature.length<MIN_POOL_CHARS)return encoded;
      const state=seen.get(signature);
      if(state===undefined){seen.set(signature,-1);return encoded;}
      if(state===-1){const index=pool.length;pool.push(encoded);seen.set(signature,index);return [-2,index];}
      return [-2,state];
    }
    function tree(cell){
      if(!Array.isArray(cell))return cell;
      const out=new Array(cell.length);out[0]=cell[0];
      for(let i=1;i<cell.length;i++)out[i]=tree(cell[i]);
      return intern(out);
    }
    return {pool,tree};
  }

  // Structural equality of two RAW cells (primitives and tagged arrays). Equivalent to comparing their JSON text.
  function rawEqual(a,b){
    if(a===b)return true;
    if(!Array.isArray(a)||!Array.isArray(b)||a.length!==b.length)return false;
    for(let i=0;i<a.length;i++)if(!rawEqual(a[i],b[i]))return false;
    return true;
  }
  // Positions whose (raw) cell is identical in every row of a shape that has >= MIN_CONSTANT_ROWS rows.
  function findConstants(raw,shapes){
    const byShape=new Map();
    for(let i=0;i<raw.length;i++){const sid=raw[i][0];let list=byShape.get(sid);if(!list){list=[];byShape.set(sid,list);}list.push(i);}
    const constants=new Map();
    for(const [sid,indexes] of byShape){
      if(indexes.length<MIN_CONSTANT_ROWS)continue;
      const keys=shapes[sid],found=new Map(),first=raw[indexes[0]];
      for(let position=0;position<keys.length;position++){
        const reference=first[position+1];let constant=true;
        for(let n=1;n<indexes.length;n++){if(!rawEqual(raw[indexes[n]][position+1],reference)){constant=false;break;}}
        if(constant)found.set(position,reference);
      }
      if(found.size)constants.set(sid,found);
    }
    return constants;
  }

  function decodeSegment(isArray,part){if(!part||part.$gh!==(isArray?1:2))throw corrupt('segment-marker');return decodeCollection(part);}
  function combineSegments(isArray,parts){
    if(isArray)return [].concat(...parts);
    const out={};for(const part of parts)for(const key of Object.keys(part)){if(own(out,key))throw corrupt('segment-duplicate-key');assign(out,key,part[key]);}
    return out;
  }
  function decodeCollection(node){
    if(node&&typeof node==='object'&&!Array.isArray(node)&&node.$gh===3){
      if((node.a!==1&&node.a!==0)||!Array.isArray(node.g)||!node.g.length)throw corrupt('segments');
      return combineSegments(node.a,node.g.map(part=>decodeSegment(node.a,part)));
    }
    if(!node||typeof node!=='object'||Array.isArray(node)||(node.$gh!==1&&node.$gh!==2))throw corrupt('collection-marker');
    const {s:shapes,p:pool,r:rows}=node;
    if(!Array.isArray(shapes)||!Array.isArray(pool)||!Array.isArray(rows))throw corrupt('collection-shape');
    // Validate every shape once and precompute how its row cells map onto keys.
    const plans=shapes.map(entry=>{
      const keys=Array.isArray(entry)?entry:entry&&typeof entry==='object'?entry.k:null;
      if(!Array.isArray(keys)||keys.some(key=>typeof key!=='string'))throw corrupt('shape-keys');
      const constAt=new Array(keys.length).fill(undefined),isConst=new Array(keys.length).fill(false);let constCount=0;
      if(!Array.isArray(entry)&&entry.c!==undefined){
        if(!Array.isArray(entry.c))throw corrupt('shape-constants');
        for(const pair of entry.c){
          if(!Array.isArray(pair)||pair.length!==2||!Number.isInteger(pair[0])||pair[0]<0||pair[0]>=keys.length||isConst[pair[0]])throw corrupt('shape-constant-position');
          isConst[pair[0]]=true;constAt[pair[0]]=pair[1];constCount++;
        }
      }
      return {keys,isConst,constAt,arity:keys.length-constCount+1};
    });
    function decode(cell,depth){
      // Cells are primitives or TAGGED arrays only. An untagged object would be returned by reference and could smuggle
      // arbitrary structure past the shape table, so it is rejected instead of trusted.
      if(!Array.isArray(cell)){if(cell!==null&&typeof cell==='object')throw corrupt('untagged-object');return cell;}
      if(depth>MAX_DEPTH)throw corrupt('depth');
      const tag=cell[0];
      if(tag===-1){const out=new Array(cell.length-1);for(let i=1;i<cell.length;i++)out[i-1]=decode(cell[i],depth+1);return out;}
      if(tag===-3)return expandRun(cell);
      if(tag===-2){
        const index=cell[1];if(cell.length!==2||!Number.isInteger(index)||index<0||index>=pool.length)throw corrupt('pool-index');
        return decode(pool[index],depth+1);
      }
      if(Number.isInteger(tag)&&tag>=0){
        const plan=plans[tag];if(!plan||cell.length!==plan.arity)throw corrupt('row-arity');
        const out={},keys=plan.keys;let cursor=1;
        for(let i=0;i<keys.length;i++)assign(out,keys[i],plan.isConst[i]?decode(plan.constAt[i],depth+1):decode(cell[cursor++],depth+1));
        return out;
      }
      throw corrupt('tag');
    }
    if(node.$gh===1){
      const out=new Array(rows.length);
      for(let i=0;i<rows.length;i++){if(!Array.isArray(rows[i]))throw corrupt('row');out[i]=decode(rows[i],0);}
      return out;
    }
    const keys=node.k;if(!Array.isArray(keys)||keys.length!==rows.length||keys.some(key=>typeof key!=='string'))throw corrupt('map-keys');
    const out={};for(let i=0;i<rows.length;i++){if(!Array.isArray(rows[i]))throw corrupt('row');assign(out,keys[i],decode(rows[i],0));}
    return out;
  }

  function encodeRows(value){
    const encoder=createEncoder(),isArray=Array.isArray(value),keys=isArray?null:Object.keys(value);
    const count=isArray?value.length:keys.length,raw=new Array(count);
    for(let i=0;i<count;i++)raw[i]=encoder.row(isArray?value[i]:value[keys[i]]);
    const constants=findConstants(raw,encoder.shapes),pooler=createPool();
    const shapes=encoder.shapes.map((list,sid)=>{
      const found=constants.get(sid);if(!found)return list;
      return {k:list,c:[...found.entries()].sort((a,b)=>a[0]-b[0]).map(([position,cell])=>[position,pooler.tree(cell)])};
    });
    const rows=new Array(count);
    for(let i=0;i<count;i++){
      const source=raw[i],found=constants.get(source[0]),row=[source[0]];
      for(let position=0;position<source.length-1;position++){if(found&&found.has(position))continue;row.push(pooler.tree(source[position+1]));}
      rows[i]=row;
    }
    const part=isArray?{$gh:1,s:shapes,p:pooler.pool,r:rows}:{$gh:2,k:keys,s:shapes,p:pooler.pool,r:rows};if(encoder.largeString())COOPERATIVE_PARTS.add(part);return part;
  }
  function memberIdentity(member){
    if(!member||typeof member!=='object')return null;const id=member.id??member.number;
    return typeof id==='string'?`s:${id}`:Number.isFinite(id)?`n:${id}`:null;
  }
  function identityHash(text){let h=0x811c9dc5|0;for(let i=0;i<text.length;i++)h=Math.imul(h^text.charCodeAt(i),0x01000193);return h>>>0;}
  // Segment bounds: [{start,end,key}] where key names the segment by its first member ('#index' for positional ones).
  function segmentBounds(value){
    const isArray=Array.isArray(value),keys=isArray?null:Object.keys(value),count=isArray?value.length:keys.length,ids=new Array(count),seen=new Set();let identified=true;
    for(let i=0;i<count&&identified;i++){const id=isArray?memberIdentity(value[i]):`k:${keys[i]}`;if(id===null||seen.has(id))identified=false;else{seen.add(id);ids[i]=id;}}
    const out=[];
    if(!identified){for(let start=0,index=0;start<count;start+=SEGMENT_ROWS,index++)out.push({start,end:Math.min(count,start+SEGMENT_ROWS),key:`#${index}`});return {keys,bounds:out};}
    let start=0;
    for(let i=0;i<count;i++){const length=i-start+1;if((length>=SEGMENT_FLOOR&&(identityHash(ids[i])&255)===0)||length>=SEGMENT_CEIL){out.push({start,end:i+1,key:ids[start]});start=i+1;}}
    if(start<count)out.push({start,end:count,key:ids[start]});
    return {keys,bounds:out};
  }
  function segmentSlices(value,layout=segmentBounds(value)){
    const isArray=Array.isArray(value),{keys,bounds}=layout;
    return bounds.map(({start,end})=>{if(isArray)return value.slice(start,end);const part={};for(let i=start;i<end;i++)part[keys[i]]=value[keys[i]];return part;});
  }
  function segmented(value){return (Array.isArray(value)?value.length:Object.keys(value).length)>=SEGMENT_MIN;}
  function encodeCollection(value){
    if(!segmented(value))return encodeRows(value);
    return {$gh:3,a:Array.isArray(value)?1:0,g:segmentSlices(value).map(encodeRows)};
  }

  // Build 359: a sealed container (frozen whole, GH_TRANSACTION_CORE {container:true}) cannot change, so whether it is a
  // collection is answered once per container instead of inspecting every member on every save.
  const sealedContainer=value=>Object.isFrozen(value)&&globalThis.GH_TRANSACTION_CORE?.isSealed?.(value)===true,CANDIDATES=new WeakMap();
  function collectionCandidate(value){
    if(!sealedContainer(value))return memberCandidate(value);
    let known=CANDIDATES.get(value);if(known===undefined){known=memberCandidate(value);CANDIDATES.set(value,known);}return known;
  }
  function memberCandidate(value){
    if(Array.isArray(value)){
      if(value.length<MIN_ROWS)return false;
      for(let i=0;i<value.length;i++){const item=value[i];if(!isPlain(item)||typeof item.toJSON==='function')return false;}
      return true;
    }
    if(!isPlain(value))return false;
    const keys=Object.keys(value);if(keys.length<MIN_ROWS)return false;
    for(const key of keys){const item=value[key];if(!isPlain(item)||typeof item.toJSON==='function')return false;}
    return true;
  }
  // Deterministic discovery: the same state always yields the same ordered path list.
  function selectPaths(state){return scanPaths(state).paths;}
  function scanPaths(state){
    const paths=[],runs=[];
    (function visit(node,path,depth){
      for(const key of Object.keys(node)){
        const value=node[key];if(value===null||typeof value!=='object')continue;
        if(Array.isArray(value)&&value.length>=RUN_MIN){const run=idRun(value);if(run){runs.push({path:[...path,key],run});continue;}}
        if(collectionCandidate(value)){paths.push([...path,key]);continue;}
        if(depth<MAX_SCAN_DEPTH&&typeof value.toJSON!=='function'&&(isPlain(value)||Array.isArray(value)&&value.length<MIN_ROWS))visit(value,[...path,key],depth+1);
      }
    })(state,[],1);
    return {paths,runs};
  }
  function readPath(root,path){let node=root;for(const key of path){if(node===null||typeof node!=='object'||!own(node,key))return undefined;node=node[key];}return node;}
  function writePathCopy(root,path,value){
    // Structural sharing: copy only the objects on the path, never the (huge) collections beside it.
    const copy=value=>Array.isArray(value)?value.slice():{...value},copies=[copy(root)];let cursor=copies[0];
    for(let i=0;i<path.length-1;i++){const next=copy(cursor[path[i]]);cursor[path[i]]=next;cursor=next;}
    cursor[path[path.length-1]]=value;return copies[0];
  }

  function codecMeta(paths,binaryPaths,runs,segments,chunks=[]){
    const version=chunks.length?TEXT_VERSION:segments?SEG_VERSION:runs.length?RUN_VERSION:VERSION,meta=runs.length?{version,paths,binaryPaths,runPaths:runs.map(row=>row.path)}:{version,paths,binaryPaths};
    if(chunks.length)meta.chunks=chunks;return meta;
  }
  function encodeState(state){
    if(!isPlain(state))return state;
    const binaryPaths=[],cold=prepareColdArchive(state,null);let out=cold.root;
    // Fleet rows are the only ArrayBuffer in Save Schema 3. Preserve their
    // bytes through the current JSON transport until binary chunk storage lands.
    if(isArrayBuffer(state.fleet?.rows)){const path=['fleet','rows'];out=writePathCopy(out,path,binaryMarker(state.fleet.rows));binaryPaths.push(path);}
    const scan=scanPaths(out),paths=scan.paths;
    if(!paths.length&&!binaryPaths.length&&!scan.runs.length&&!cold.hasPages)return out;
    let segments=false;
    for(const path of paths){const value=readPath(out,path);if(segmented(value))segments=true;out=writePathCopy(out,path,encodeCollection(value));}
    for(const {path,run} of scan.runs)out=writePathCopy(out,path,run);
    out.stateCodec=codecMeta(paths,binaryPaths,scan.runs,segments);
    return out;
  }

  // Native-only value-table pages. The table is heterogeneous and the ordinary collection encoder leaves it inline.
  // Compare exact JSON text on each save, including unknown direct edits; no writer/version trust or gameplay scan.
  const VALUE_TEXT=new Map(),VALUE_CACHE_CHARS=8*1024*1024,VALUE_PART_CHARS=512*1024,VALUE_ROWS=256;let valueChars=0,valueSequence=0;
  function forgetValueText(key){const old=VALUE_TEXT.get(key);if(old){valueChars-=old.text.length;VALUE_TEXT.delete(key);}}
  function rememberValueText(key,text,chunk){forgetValueText(key);if(text.length>VALUE_PART_CHARS||valueChars+text.length>VALUE_CACHE_CHARS)return false;VALUE_TEXT.set(key,{text,chunk});valueChars+=text.length;return true;}
  function* valueTextPart(text,key,count){
    const old=VALUE_TEXT.get(key);if(old?.text===text)return old.chunk;
    if(text.length>VALUE_PART_CHARS||valueChars-(old?.text.length||0)+text.length>VALUE_CACHE_CHARS){forgetValueText(key);return null;}
    const chunk={id:`${NONCE}.v.${(++valueSequence).toString(36)}`,bytes:yield* utf8LengthSteps(text),count};return rememberValueText(key,text,chunk)?chunk:null;
  }
  function resolveValueTable(marker,pending,options){
    if(!isPlain(marker)||marker.$ghValues!=='segments-v1'||!Number.isSafeInteger(marker.length)||marker.length<1||marker.length>4194304||!Array.isArray(marker.parts)||marker.parts.length!==Math.ceil(marker.length/VALUE_ROWS))throw corrupt('value-table');
    const out=new Array(marker.length);let at=0;
    for(let index=0;index<marker.parts.length;index++){
      const part=marker.parts[index],count=Math.min(VALUE_ROWS,marker.length-at);let values,loadedText=null;
      if(Array.isArray(part))values=part;
      else{
        if(!isPlain(part)||part.$ghValuesPart!==1||typeof part.id!=='string'||!CHUNK_ID.test(part.id)||!Number.isSafeInteger(part.bytes)||part.bytes<2||part.bytes>4194304||part.count!==count||!pending.delete(part.id))throw corrupt('value-part');
        const bytes=chunkBytesForId(part.id,options,{text:true,byteLength:part.bytes},part.bytes,'value-part-missing');let text;
        try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);values=JSON.parse(text);}catch{throw corrupt('value-part-json');}
        loadedText=text;
      }
      if(!Array.isArray(values)||values.length!==count)throw corrupt('value-part-count');
      if(loadedText!==null)rememberValueText(index,loadedText,{id:part.id,bytes:part.bytes,count});
      for(const value of values)out[at++]=value;
    }
    return out;
  }

  function decodeState(tree,options={}){
    if(!isPlain(tree)||!own(tree,'stateCodec'))return tree;
    const meta=tree.stateCodec;
    if(!isPlain(meta)||![VERSION,RUN_VERSION,SEG_VERSION,TEXT_VERSION].includes(meta.version)||!Array.isArray(meta.paths))throw corrupt('meta');
    const listed=meta.chunks===undefined?[]:meta.chunks;
    if(!Array.isArray(listed)||(listed.length&&meta.version!==TEXT_VERSION)||listed.some(id=>typeof id!=='string'||!CHUNK_ID.test(id)))throw corrupt('text-chunks');
    const pending=new Set(listed);if(pending.size!==listed.length)throw corrupt('text-chunk-duplicate');
    const text=(node,partKey)=>{if(!isTextMarker(node))return node;if(!pending.delete(node.id))throw corrupt('text-chunk-unlisted');return resolveTextChunk(node,options,partKey);};
    let out={...tree};delete out.stateCodec;
    if(meta.valueTable!==undefined){
      if(meta.valueTable!=='fleet.values/v1'||meta.version!==TEXT_VERSION||!isPlain(out.fleet))throw corrupt('value-table-meta');
      out=writePathCopy(out,['fleet','values'],resolveValueTable(out.fleet.values,pending,options));
    }
    for(const path of meta.paths){
      if(!Array.isArray(path)||!path.length||path.some(key=>typeof key!=='string'))throw corrupt('path');
      let node=readPath(out,path);if(node===undefined)throw corrupt('path-missing');
      const key=JSON.stringify(path);node=text(node,key);
      if(isPlain(node)&&node.$gh===3&&Array.isArray(node.g)){
        if((node.a!==1&&node.a!==0)||!node.g.length)throw corrupt('segments');
        // A text chunk's place is named as serialize() names it: by the segment layout of the decoded collection.
        const resolved=node.g.map(part=>{const decoded=decodeSegment(node.a,text(part,null)),adopted=isTextMarker(part)?ADOPTED_TEXT.get(null):null;ADOPTED_TEXT.delete(null);return {decoded,adopted};});
        const combined=combineSegments(node.a,resolved.map(row=>row.decoded));
        if(resolved.some(row=>row.adopted)){
          const layout=segmentBounds(combined),byStart=new Map(layout.bounds.map(bound=>[bound.start,bound]));let start=0;
          for(const row of resolved){const length=node.a?row.decoded.length:Object.keys(row.decoded).length,bound=byStart.get(start);if(row.adopted&&bound&&bound.end===start+length)ADOPTED_TEXT.set(`${key}${bound.key.startsWith('#')?'':'@'}${bound.key}`,row.adopted);start+=length;}
        }
        out=writePathCopy(out,path,combined);continue;
      }
      out=writePathCopy(out,path,decodeCollection(node));
    }
    out=adoptColdArchivePages(out,pending,options);
    if(pending.size)throw corrupt('text-chunk-unused');
    const binaryPaths=meta.binaryPaths===undefined?[]:meta.binaryPaths;if(!Array.isArray(binaryPaths))throw corrupt('binary-paths');
    for(const path of binaryPaths){
      if(!Array.isArray(path)||!path.length||path.some(key=>typeof key!=='string'))throw corrupt('binary-path');
      const node=readPath(out,path);if(node===undefined)throw corrupt('binary-path-missing');
      out=writePathCopy(out,path,binaryBuffer(node,options));
    }
    const runPaths=meta.runPaths===undefined?[]:meta.runPaths;
    if(!Array.isArray(runPaths)||(runPaths.length&&meta.version===VERSION))throw corrupt('run-paths');
    for(const path of runPaths){
      if(!Array.isArray(path)||!path.length||path.some(key=>typeof key!=='string'))throw corrupt('run-path');
      const node=readPath(out,path);if(!Array.isArray(node)||node[0]!==-3)throw corrupt('run-path-missing');
      out=writePathCopy(out,path,expandRun(node));
    }
    const STORE=globalThis.GH_FLEET_STORE,decoded=decodedLaneCaches.get(out.fleet?.rows);
    if(decoded&&STORE?.isStore?.(out.fleet))decoded.origin={store:out.fleet,revision:out.fleet.revision,length:out.fleet.length,structure:out.fleet.structure,epoch:STORE.epoch(out.fleet)};
    return out;
  }

  // Build 358 (save size): text chunks. A marker is resolved through options.resolveChunk (the vault's bytes), checked
  // for length and decoded as strict UTF-8 JSON; it must be a $gh:1/$gh:2 collection. The loaded text's checksum is
  // remembered by its place (path and segment): when the first save of the session encodes the same place to the same
  // text, it reuses the chunk id the vault already holds instead of uploading the same bytes again.
  function isTextMarker(node){return isPlain(node)&&own(node,'$ghText');}
  function textChecksum(text){let a=0x811c9dc5|0,b=0x01000193|0;const imul=Math.imul;for(let i=0;i<text.length;i++){a=imul(a^text.charCodeAt(i),0x01000193);b=(b+a)|0;}return `${text.length}.${(a>>>0).toString(36)}.${(b>>>0).toString(36)}`;}
  function coldPageShape(page){return isPlain(page)&&page.$ghCold===COLD_PAGE_MARKER&&page.schema===COLD_PAGE_VERSION&&typeof page.id==='string'&&CHUNK_ID.test(page.id)&&Number.isSafeInteger(page.bytes)&&page.bytes>=2&&page.bytes<=67108864&&typeof page.kind==='string'&&page.kind.length>0&&page.kind.length<=120&&Number.isSafeInteger(page.count)&&page.count>0&&typeof page.sum==='string'&&page.sum.length<=100;}
  function coldBytesFromInline(page){
    if(typeof page.inline!=='string')return null;let fast=null;try{fast=typeof Uint8Array.fromBase64==='function'?Uint8Array.fromBase64(page.inline):tableDecode(page.inline);}catch{fast=null;}
    if(fast)return fast;let raw;try{raw=base64Decode(page.inline);}catch{return null;}const bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);return bytes;
  }
  function verifyColdPageBytes(page,bytes){
    if(!bytes||bytes.byteLength!==page.bytes)throw corrupt('cold-page-length');
    let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw corrupt('cold-page-json');}
    if(textChecksum(text)!==page.sum)throw corrupt('cold-page-checksum');
    return bytes;
  }
  function canonicalColdPage(page){const out={};for(const key of ['$ghCold','schema','id','bytes','kind','count','sum','firstAt','lastAt','createdAtSim'])if(page[key]!==undefined)out[key]=page[key];return Object.freeze(out);}
  function adoptColdArchivePages(root,pending,options){
    const pages=root?.coldArchive?.pages;if(pages===undefined)return root;if(!Array.isArray(pages))throw corrupt('cold-pages-shape');
    const seen=new Set(),next=[];let changed=false;
    for(const source of pages){
      if(!coldPageShape(source)||seen.has(source.id))throw corrupt('cold-page-marker');seen.add(source.id);
      let bytes=coldBytesFromInline(source);
      if(bytes){if(pending.has(source.id))throw corrupt('cold-page-inline-listed');changed=true;}
      else{
        if(!pending.delete(source.id)||typeof options.resolveChunk!=='function')throw corrupt('cold-page-unlisted');
        let data;try{data=options.resolveChunk(source.id,{coldArchive:true,byteLength:source.bytes});}catch{throw corrupt('cold-page-missing');}
        bytes=ArrayBuffer.isView(data)?new Uint8Array(data.buffer,data.byteOffset,data.byteLength):isArrayBuffer(data)?new Uint8Array(data):null;
      }
      verifyColdPageBytes(source,bytes);
      const page=Object.isFrozen(source)&&source.inline===undefined?source:canonicalColdPage(source);COLD_PAGE_BYTES.set(page,bytes);next.push(page);if(page!==source)changed=true;
    }
    if(!changed)return root;const cold={...root.coldArchive,pages:next};return {...root,coldArchive:cold};
  }
  function createColdArchivePage(kind,rows,meta={}){
    if(!Array.isArray(rows)||!rows.length)throw new TypeError('cold-archive-rows-required');kind=String(kind||'').trim();if(!kind||kind.length>120)throw new TypeError('cold-archive-kind-invalid');
    const text=JSON.stringify(rows),bytes=new TextEncoder().encode(text),page=canonicalColdPage({$ghCold:COLD_PAGE_MARKER,schema:COLD_PAGE_VERSION,id:`${NONCE}.c.${(++coldPageSequence).toString(36)}`,bytes:bytes.byteLength,kind,count:rows.length,sum:textChecksum(text),firstAt:meta.firstAt,lastAt:meta.lastAt,createdAtSim:meta.createdAtSim});COLD_PAGE_BYTES.set(page,bytes);return page;
  }
  function coldArchiveRows(page){
    if(!coldPageShape(page))throw corrupt('cold-page-marker');const bytes=COLD_PAGE_BYTES.get(page);if(!bytes||bytes.byteLength!==page.bytes)throw corrupt('cold-page-missing');let text,rows;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(textChecksum(text)!==page.sum)throw corrupt('cold-page-checksum');rows=JSON.parse(text);}catch(error){if(error?.code==='STATE_CODEC_CORRUPT')throw error;throw corrupt('cold-page-json');}if(!Array.isArray(rows)||rows.length!==page.count)throw corrupt('cold-page-count');return rows;
  }
  function validateColdArchive(state){try{const pages=state?.coldArchive?.pages;if(pages===undefined)return {ok:true,pages:0,rows:0};if(!Array.isArray(pages))throw new Error('shape');const ids=new Set();let rows=0;for(const page of pages){if(!coldPageShape(page)||ids.has(page.id)||!COLD_PAGE_BYTES.has(page))throw new Error('page');ids.add(page.id);rows+=page.count;}return {ok:true,pages:pages.length,rows};}catch{return {ok:false,reason:'cold-archive-invalid'};}}
  function coldArchiveStats(state){const check=validateColdArchive(state);if(!check.ok)return check;let bytes=0;for(const page of state?.coldArchive?.pages||[])bytes+=page.bytes;return {...check,bytes};}
  // structuredClone/JSON clones intentionally cannot copy WeakMap ownership. Transaction snapshots, durable drafts and
  // reset checkpoints call this immediately after cloning so their identical page markers inherit the immutable bytes
  // without decoding the historical rows or retaining a second object graph.
  function inheritColdArchive(source,target){
    const from=source?.coldArchive?.pages,to=target?.coldArchive?.pages;if(!Array.isArray(from)||!Array.isArray(to)||!from.length)return target;
    const bytesById=new Map();for(const page of from){const bytes=COLD_PAGE_BYTES.get(page);if(coldPageShape(page)&&bytes)bytesById.set(page.id,{page,bytes});}
    for(const page of to){const found=bytesById.get(page?.id);if(!found||!coldPageShape(page)||page.bytes!==found.page.bytes||page.sum!==found.page.sum||page.kind!==found.page.kind||page.count!==found.page.count)continue;COLD_PAGE_BYTES.set(page,found.bytes);}
    return target;
  }
  const ADOPTED_TEXT=new Map();
  function resolveTextChunk(marker,options,partKey){
    const {id,bytes}=marker;
    if(marker.$ghText!=='chunk-v1'||typeof id!=='string'||!CHUNK_ID.test(id)||!Number.isSafeInteger(bytes)||bytes<2||bytes>67108864)throw corrupt('text-marker');
    if(typeof options.resolveChunk!=='function')throw corrupt('text-chunk-unresolved');
    let data;try{data=options.resolveChunk(id,{text:true,byteLength:bytes});}catch{throw corrupt('text-chunk-missing');}
    const view=ArrayBuffer.isView(data)?new Uint8Array(data.buffer,data.byteOffset,data.byteLength):isArrayBuffer(data)?new Uint8Array(data):null;
    if(!view)throw corrupt('text-chunk-missing');if(view.length!==bytes)throw corrupt('text-chunk-length');
    let text,node;try{text=new TextDecoder('utf-8',{fatal:true}).decode(view);node=JSON.parse(text);}catch{throw corrupt('text-chunk-json');}
    if(!isPlain(node)||(node.$gh!==1&&node.$gh!==2))throw corrupt('text-chunk-collection');
    if(id.includes('.o.'))rememberOpenText(`@${id}`,text,{id,bytes});
    ADOPTED_TEXT.set(partKey,{id,sum:id.includes('.o.')?null:textChecksum(text)});
    return node;
  }
  function* utf8LengthSteps(text){
    let n=0,at=0;
    while(at<text.length){let end=Math.min(text.length,at+16384);if(end<text.length){const a=text.charCodeAt(end-1),b=text.charCodeAt(end);if(a>=0xD800&&a<=0xDBFF&&b>=0xDC00&&b<=0xDFFF)end--;}
      for(let i=at;i<end;i++){const c=text.charCodeAt(i);if(c<128)n++;else if(c<2048)n+=2;else if(c>=0xD800&&c<=0xDBFF&&i+1<end){const d=text.charCodeAt(i+1);if(d>=0xDC00&&d<=0xDFFF){n+=4;i++;}else n+=3;}else n+=3;}at=end;yield;
    }return n;
  }
  function* textChecksumSteps(text){let a=0x811c9dc5|0,b=0x01000193|0;for(let at=0;at<text.length;at+=16384){const end=Math.min(text.length,at+16384);for(let i=at;i<end;i++){a=Math.imul(a^text.charCodeAt(i),0x01000193);b=(b+a)|0;}yield;}return `${text.length}.${(a>>>0).toString(36)}.${(b>>>0).toString(36)}`;}
  let textChunkSequence=0,textChunkStats={named:0,adopted:0,referenced:0};
  // Mutable parts are always encoded afresh: reference identity/write stamps cannot certify legacy nested writes.
  // Exact text equality alone reuses their immutable vault id. Retain at most 4M UTF-16 code units, with bounded
  // entries. Parts outside that budget stay inline, so a large collection cannot churn the cache and reupload every
  // part on each save. The existing manifest commits every part atomically.
  const OPEN_TEXT=new Map(),OPEN_TEXT_LIMIT=4*1024*1024,OPEN_ENTRY_LIMIT=512*1024;
  const openChunkStats={hits:0,misses:0,adopted:0,declined:0,chars:0};
  function forgetOpenText(key){const old=OPEN_TEXT.get(key);if(old){openChunkStats.chars-=old.text.length;OPEN_TEXT.delete(key);}}
  function rememberOpenText(key,text,chunk){
    forgetOpenText(key);if(text.length>OPEN_ENTRY_LIMIT||openChunkStats.chars+text.length>OPEN_TEXT_LIMIT){openChunkStats.declined++;return false;}
    OPEN_TEXT.set(key,{text,chunk});openChunkStats.chars+=text.length;return true;
  }
  function* openTextChunkOf(text,key){
    const prior=OPEN_TEXT.get(key),adopted=ADOPTED_TEXT.get(key),loaded=adopted?OPEN_TEXT.get(`@${adopted.id}`):null;ADOPTED_TEXT.delete(key);
    if(text.length>OPEN_ENTRY_LIMIT||openChunkStats.chars-(prior?.text.length||0)-(loaded?.text.length||0)+text.length>OPEN_TEXT_LIMIT){forgetOpenText(key);if(adopted)forgetOpenText(`@${adopted.id}`);openChunkStats.declined++;return null;}
    let chunk;
    if(prior?.text===text){chunk=prior.chunk;openChunkStats.hits++;}
    else if(loaded?.text===text){chunk=loaded.chunk;openChunkStats.adopted++;}
    else{chunk={id:`${NONCE}.o.${(++textChunkSequence).toString(36)}`,bytes:yield* utf8LengthSteps(text)};openChunkStats.misses++;}
    if(adopted)forgetOpenText(`@${adopted.id}`);return rememberOpenText(key,text,chunk)?chunk:null;
  }
  // The chunk of a cached collection text: an id that never changes while the text does not (the entry is replaced when
  // its members change), the vault's id when the loaded save held the same text at the same place.
  function* textChunkOf(entry,partKey){
    if(!entry.chunk){
      const adopted=ADOPTED_TEXT.get(partKey);ADOPTED_TEXT.delete(partKey);
      const matches=adopted&&(adopted.id.includes('.o.')?OPEN_TEXT.get(`@${adopted.id}`)?.text===entry.text:adopted.sum===(yield* textChecksumSteps(entry.text)));
      const id=matches?adopted.id:`${NONCE}.t.${(++textChunkSequence).toString(36)}`;if(adopted)forgetOpenText(`@${adopted.id}`);
      if(adopted&&id===adopted.id)textChunkStats.adopted++;else textChunkStats.named++;
      entry.chunk={id,bytes:yield* utf8LengthSteps(entry.text)};
    }
    textChunkStats.referenced++;return entry.chunk;
  }

  // Build 358: encoded-collection cache. A collection whose members are all sealed (deep-frozen by their owners, see
  // GH_TRANSACTION_CORE.registerSealedCollections) encodes to a pure function of its member sequence. When that
  // sequence (and, for a map, its keys) is unchanged since the last save, the previous JSON text of the encoded
  // collection is reused. The output is byte-for-byte what JSON.stringify(encodeState(state)) produces.
  const COLLECTION_TEXT=new Map(),NONCE=`${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  let collectionCacheStats={hits:0,misses:0,open:0},layoutCacheStats={hits:0,misses:0};
  // The JSON text of a fragment token (JSON.stringify of `\u0000gh-codec:${NONCE}:${index}\u0000`).
  const FRAGMENT_TOKEN=new RegExp(`"\\\\u0000gh-codec:${NONCE}:(\\d+)\\\\u0000"`,'g');
  // Build 359 (a save hashed the identity of every member of every encoded collection to find its segments, sliced it
  // and asked each member whether it is sealed, unchanged or not): the layout of each collection (member sequence, keys,
  // segment bounds and slices, and which segments are wholly sealed) is kept by path. A collection whose member sequence
  // and keys are the same objects as at the last save reuses it after one identity comparison per member. Sealing is
  // permanent, so a segment found sealed stays sealed; one that was not is asked again.
  const PATH_LAYOUT=new Map();
  function sameSequence(cached,value){
    if(Array.isArray(value)){if(cached.keys||cached.members.length!==value.length)return false;for(let i=0;i<value.length;i++)if(cached.members[i]!==value[i])return false;return true;}
    const keys=Object.keys(value);if(!cached.keys||cached.keys.length!==keys.length)return false;
    for(let i=0;i<keys.length;i++)if(cached.keys[i]!==keys[i]||cached.members[i]!==value[keys[i]])return false;
    return true;
  }
  function collectionLayout(key,value){
    // The same sealed container as at the last save has the same members: no member is compared.
    const cached=PATH_LAYOUT.get(key);if(cached&&(cached.value===value&&sealedContainer(value)||sameSequence(cached,value))){cached.value=value;layoutCacheStats.hits++;return cached;}
    const split=segmented(value),layout=split?segmentBounds(value):null,parts=split?segmentSlices(value,layout):[Array.isArray(value)?value.slice():{...value}],keys=Array.isArray(value)?null:Object.keys(value);
    const entry={value,keys,members:keys?keys.map(name=>value[name]):value.slice(),split,layout,parts,sealed:new Array(parts.length).fill(null)};
    PATH_LAYOUT.set(key,entry);layoutCacheStats.misses++;return entry;
  }
  function sealedMembers(value){
    const sealed=globalThis.GH_TRANSACTION_CORE?.isSealed;if(typeof sealed!=='function')return null;
    const keys=Array.isArray(value)?null:Object.keys(value),members=keys?keys.map(key=>value[key]):value.slice();
    for(let i=0;i<members.length;i++)if(!sealed(members[i]))return null;
    return {keys,members};
  }
  function sameMembers(entry,current){
    if(entry.members.length!==current.members.length||!!entry.keys!==!!current.keys)return false;
    for(let i=0;i<current.members.length;i++)if(entry.members[i]!==current.members[i])return false;
    if(current.keys)for(let i=0;i<current.keys.length;i++)if(entry.keys[i]!==current.keys[i])return false;
    return true;
  }
  function prepareColdArchive(root,coldChunks){
    const pages=root?.coldArchive?.pages;if(!Array.isArray(pages)||!pages.length)return {root,ids:[],hasPages:false};
    const ids=[],next=[];let changed=false;
    for(const page of pages){
      if(!coldPageShape(page))throw new Error('cold-archive-page-invalid');const bytes=COLD_PAGE_BYTES.get(page);if(!bytes||bytes.byteLength!==page.bytes)throw new Error('cold-archive-page-bytes-missing');
      if(coldChunks){ids.push(page.id);coldChunks.push({id:page.id,byteLength:bytes.byteLength,data:bytes});next.push(page);}
      else{next.push({...page,inline:base64Encode(bytes)});changed=true;}
    }
    return {root:changed?writePathCopy(root,['coldArchive','pages'],next):root,ids,hasPages:true};
  }
  // Build 358 (lighter commands): serialization as steps. serializeSteps yields after each encoded collection and after
  // each top-level member of the final text, so an asynchronous caller (a durable command's save) can spread one save
  // over several frames; serialize() runs the same steps at once. The text is the same either way: the final object is
  // written member by member exactly as JSON.stringify writes a plain object.
  function serialize(state,options){const steps=serializeSteps(state,options);let step;while(!(step=steps.next()).done){}return step.value;}
  // Build 359 (the ordinary save's largest step was one root serialized at once, 40 ms on the desktop): a plain object or
  // array is serialized member by member at each JSON depth, with a step every STRINGIFY_STEP members. Long strings
  // yield between bounded pieces without splitting a surrogate pair; the text is exactly JSON.stringify(value)'s
  // (members whose value is undefined, a function or a symbol are
  // left out of objects and written null in arrays; a value with toJSON is serialized whole).
  const STRINGIFY_STEP=256,STRING_PIECE=16384;
  function* stringifySteps(value,depth=0){
    if(typeof value==='string'&&value.length>STRING_PIECE){
      const parts=[];let at=0;
      while(at<value.length){let end=Math.min(value.length,at+STRING_PIECE);if(end<value.length){const high=value.charCodeAt(end-1),low=value.charCodeAt(end);if(high>=0xD800&&high<=0xDBFF&&low>=0xDC00&&low<=0xDFFF)end--;}const part=JSON.stringify(value.slice(at,end));parts.push(part.slice(1,-1));at=end;yield;}
      return `"${parts.join('')}"`;
    }
    if(!value||typeof value!=='object'||depth>MAX_DEPTH||typeof value.toJSON==='function')return JSON.stringify(value);
    if(Array.isArray(value)){
      if(value.length>=STRINGIFY_STEP){
        const parts=[];
        for(let at=0;at<value.length;at+=STRINGIFY_STEP){
          const block=value.slice(at,at+STRINGIFY_STEP);
          // Native JSON handles bounded primitive batches faster than one JS call per cell. A short-string bound
          // keeps a batch below 64K code units before escaping; objects and long strings keep cooperative descent.
          if(block.every(item=>item===null||typeof item==='number'||typeof item==='boolean'||typeof item==='string'&&item.length<=256))parts.push(JSON.stringify(block).slice(1,-1));
          else for(const item of block){const json=item&&typeof item==='object'||typeof item==='string'&&item.length>STRING_PIECE?yield* stringifySteps(item,depth+1):JSON.stringify(item);parts.push(json===undefined?'null':json);}
          yield;
        }
        return `[${parts.join(',')}]`;
      }
      const parts=new Array(value.length);
      for(let index=0;index<value.length;index++){const item=value[index],json=item&&typeof item==='object'||typeof item==='string'&&item.length>STRING_PIECE?yield* stringifySteps(item,depth+1):JSON.stringify(item);parts[index]=json===undefined?'null':json;if(index%STRINGIFY_STEP===STRINGIFY_STEP-1)yield;}
      return `[${parts.join(',')}]`;
    }
    if(!isPlain(value))return JSON.stringify(value);
    const parts=[];let count=0;
    for(const key of Object.keys(value)){const item=value[key],json=item&&typeof item==='object'||typeof item==='string'&&item.length>STRING_PIECE?yield* stringifySteps(item,depth+1):JSON.stringify(item);if(json!==undefined)parts.push(`${JSON.stringify(key)}:${json}`);if(++count%STRINGIFY_STEP===0)yield;}
    return `{${parts.join(',')}}`;
  }
  function* serializeSteps(state,{rowsText=null,textChunks=null,coldChunks=null}={}){
    if(!isPlain(state))return JSON.stringify(encodeState(state));
    const binaryPaths=[],fragments=[],live=new Set(),liveOpen=new Set(),cold=prepareColdArchive(state,coldChunks);let out=cold.root;
    if(isArrayBuffer(state.fleet?.rows)){
      const path=['fleet','rows'],token=`\u0000gh-codec:${NONCE}:${fragments.length}\u0000`;
      fragments.push({token:JSON.stringify(token),text:rowsText===null?rowsMarkerText(state.fleet):rowsText});out=writePathCopy(out,path,token);binaryPaths.push(path);
    }
    let valueTable=false,valueFresh=()=>{};
    if(textChunks&&rowsText!==null&&globalThis.GH_NATIVE_VALUE_CHUNKS===1&&Array.isArray(state.fleet?.values)&&state.fleet.values.length>=VALUE_ROWS&&state.fleet.values.length<=4194304){
      const store=state.fleet,values=store.values,originalLength=values.length,owner=globalThis.GH_FLEET_STORE,valueRevision=owner?.valueRevision?.(store),parts=[],liveValues=new Set();
      valueFresh=()=>{if(state.fleet!==store||store.values!==values||values.length!==originalLength||owner?.valueRevision?.(store)!==valueRevision)throw new Error('state-codec-fleet-changed-during-save');};
      for(let index=0,start=0;start<values.length;index++,start+=VALUE_ROWS){
        const rows=values.slice(start,start+VALUE_ROWS),text=yield* stringifySteps(rows);valueFresh();const chunk=yield* valueTextPart(text,index,rows.length);valueFresh();
        if(chunk){liveValues.add(index);textChunks.push({id:chunk.id,byteLength:chunk.bytes,text:VALUE_TEXT.get(index)?.text||text});parts.push(JSON.stringify({$ghValuesPart:1,...chunk}));}
        else parts.push(text);yield 'fleet-values-part';valueFresh();
      }
      for(const key of VALUE_TEXT.keys())if(!liveValues.has(key))forgetValueText(key);
      // Reuse the already prepared JSON of inline fallback pages too. Never serialize an oversized value twice.
      const token=`\u0000gh-codec:${NONCE}:${fragments.length}\u0000`,text=liveValues.size?`{"$ghValues":"segments-v1","length":${values.length},"parts":[${parts.join(',')}]}`:`[${parts.map(part=>part.slice(1,-1)).join(',')}]`;
      fragments.push({token:JSON.stringify(token),text});out=writePathCopy(out,['fleet','values'],token);valueTable=liveValues.size>0;
    }else if(textChunks&&rowsText!==null){VALUE_TEXT.clear();valueChars=0;}
    const scan=scanPaths(out),paths=scan.paths;
    if(!paths.length&&!binaryPaths.length&&!scan.runs.length&&!cold.ids.length&&!cold.hasPages)return yield* stringifySteps(out);
    let segments=false;const livePaths=new Set();
    for(const path of paths){
      const value=readPath(out,path),key=JSON.stringify(path),shape=collectionLayout(key,value),split=shape.split;if(split)segments=true;livePaths.add(key);
      const layout=shape.layout,parts=shape.parts,texts=[];let cached=true;
      for(let index=0;index<parts.length;index++){
        const partKey=split?`${key}${layout.bounds[index].key.startsWith('#')?'':'@'}${layout.bounds[index].key}`:key;
        let current=shape.sealed[index];if(!current){current=sealedMembers(parts[index]);if(current)shape.sealed[index]=current;}
        // Build 359: a segment with a member that is not sealed (an open finance document) is encoded afresh, inline;
        // the sealed segments beside it keep their cached text (the text is the same as encodeCollection's).
        if(!current){
          if(!split&&!textChunks){cached=false;break;}
          const encoded=encodeRows(parts[index]),text=COOPERATIVE_PARTS.has(encoded)?yield* stringifySteps(encoded):JSON.stringify(encoded);collectionCacheStats.open++;
          const chunk=textChunks&&text.length>=TEXT_CHUNK_MIN?(yield* openTextChunkOf(text,partKey)):null;
          if(chunk){liveOpen.add(partKey);textChunks.push({id:chunk.id,byteLength:chunk.bytes,text});texts.push(`{"$ghText":"chunk-v1","id":${JSON.stringify(chunk.id)},"bytes":${chunk.bytes}}`);}
          else texts.push(text);yield;continue;
        }
        live.add(partKey);let entry=COLLECTION_TEXT.get(partKey);
        if(entry&&(entry.members===current.members&&entry.keys===current.keys||sameMembers(entry,current)))collectionCacheStats.hits++;
        else{const encoded=encodeRows(parts[index]),text=COOPERATIVE_PARTS.has(encoded)?yield* stringifySteps(encoded):JSON.stringify(encoded);entry={keys:current.keys,members:current.members,text};COLLECTION_TEXT.set(partKey,entry);collectionCacheStats.misses++;}
        if(textChunks&&entry.text.length>=TEXT_CHUNK_MIN){const chunk=yield* textChunkOf(entry,partKey);textChunks.push({id:chunk.id,byteLength:chunk.bytes,text:entry.text});texts.push(`{"$ghText":"chunk-v1","id":${JSON.stringify(chunk.id)},"bytes":${chunk.bytes}}`);}
        else texts.push(entry.text);
      }
      if(!cached){out=writePathCopy(out,path,encodeCollection(value));yield;continue;}
      const text=split?`{"$gh":3,"a":${Array.isArray(value)?1:0},"g":[${texts.join(',')}]}`:texts[0];
      const token=`\u0000gh-codec:${NONCE}:${fragments.length}\u0000`;fragments.push({token:JSON.stringify(token),text});out=writePathCopy(out,path,token);yield;
    }
    for(const key of [...COLLECTION_TEXT.keys()])if(!live.has(key))COLLECTION_TEXT.delete(key);
    if(textChunks)for(const key of [...OPEN_TEXT.keys()])if(!liveOpen.has(key))forgetOpenText(key);
    for(const key of [...PATH_LAYOUT.keys()])if(!livePaths.has(key))PATH_LAYOUT.delete(key);
    for(const {path,run} of scan.runs)out=writePathCopy(out,path,run);
    out.stateCodec=codecMeta(paths,binaryPaths,scan.runs,segments,[...(textChunks?textChunks.map(chunk=>chunk.id):[]),...cold.ids]);if(valueTable)out.stateCodec.valueTable='fleet.values/v1';
    // Resolve fragments inside each root before the final join. Never scan/copy the complete save a second time.
    const found=new Array(fragments.length).fill(0);
    const replace=(match,index)=>{const at=Number(index),fragment=fragments[at];if(!fragment||fragment.token!==match)throw new Error('state-codec-fragment-token');found[at]++;return fragment.text;};
    const members=[];for(const key of Object.keys(out)){let json=yield* stringifySteps(out[key]);if(json!==undefined){if(fragments.length)json=json.replace(FRAGMENT_TOKEN,replace);members.push(`${JSON.stringify(key)}:${json}`);}yield;}
    if(found.some(count=>count!==1))throw new Error('state-codec-fragment-token');
    valueFresh();return `{${members.join(',')}}`;
  }
  function deserialize(json,options={}){return decodeState(JSON.parse(json),options);}
  // Build 358 (million-asset save): the save text with the record buffer as a 'chunks-v1' manifest. A chunk keeps its
  // id while its GH_FLEET_STORE.chunkStamp key (save generation, broad save version, chunk version, length) is unchanged.
  // If a broad stamp changes, checksums retain ids for chunks whose bytes stayed equal and issue new ids only for changed
  // bytes. A store decoded from a chunked save adopts its ids (adoptChunkIds), so a fresh session uploads only what
  // changed. Returns
  // {text, chunks:[{id,index,byteLength}]}: every chunk of this save; the caller uploads the ones the vault
  // has not acknowledged. One reused page is re-checked per save in rotation; a mismatch (a write that bypassed the
  // store) replaces only the lanes whose bytes differ. Everything except fleet.rows is exactly
  // serialize()'s text.
  const chunkIdCache=new WeakMap();let chunkSequence=0,chunkCacheStats={reused:0,named:0,adopted:0,verified:0,mismatches:0,checksumCalls:0,checksumBytes:0,base64Calls:0};
  function chunkChecksum(bytes){chunkCacheStats.checksumCalls++;chunkCacheStats.checksumBytes+=bytes.byteLength;const words=new Uint32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength>>>2);let a=0x811c9dc5|0,b=0x01000193|0;const imul=Math.imul;for(let i=0;i<words.length;i++){a=imul(a^words[i],0x01000193);b=(b+a)|0;}for(let i=words.length*4;i<bytes.length;i++){a=imul(a^bytes[i],0x01000193);b=(b+a)|0;}return `${(a>>>0).toString(36)}.${(b>>>0).toString(36)}`;}
  function chunkGeometry(store){const STORE=globalThis.GH_FLEET_STORE;if(typeof STORE?.chunkStamp!=='function'||STORE.isStore?.(store)!==true)throw new Error('state-codec-chunks-need-store');if(STORE.STRIDE!==FLEET_ROW_STRIDE)throw new Error('state-codec-fleet-row-layout');const chunkBytes=STORE.CHUNK_ROWS*STORE.STRIDE,bytes=new Uint8Array(store.rows);return {STORE,chunkBytes,bytes,count:Math.ceil(bytes.length/chunkBytes)};}
  function baseChunkKey(stamp,index,length){return `${stamp.chunkRuntime??stamp.runtime}.${stamp.chunkMass??stamp.mass}.${stamp.rawVersions?.[index]??stamp.versions[index]??0}.${length}`;}
  // A trimmed replica proves the exact raw row page plus its canonical zero
  // capacity tail, without allocating a padded page or masking any counters.
  function paddedRowChecksum(source,start,length,availableLength=source.byteLength){
    chunkCacheStats.checksumCalls++;chunkCacheStats.checksumBytes+=length;
    const available=Math.max(0,Math.min(length,availableLength-start)),words=new Uint32Array(source.buffer,source.byteOffset+Math.min(start,source.byteLength),available>>>2),imul=Math.imul;
    let a=0x811c9dc5|0,b=0x01000193|0;
    for(let index=0;index<(length>>>2);index++){
      const word=words[index]||0;
      a=imul(a^word,0x01000193);b=(b+a)|0;
    }
    return `${(a>>>0).toString(36)}.${(b>>>0).toString(36)}`;
  }
  // Independently reusable 64-bit lanes, packed into one immutable container
  // per changed raw page. All 128 bytes, padding and NaN payloads are retained.
  // Unchanged lanes keep their old ranges; no per-lane native request fanout.
  const decodedLaneCaches=new WeakMap(),LANES=16,LANE_BYTES=8,LANE_PATCH_MAGIC=[71,72,70,82,79,87,80,50],LANE_SUM=/^[0-9a-z]{1,7}\.[0-9a-z]{1,7}$/;
  function validLaneSums(sums){if(!Array.isArray(sums)||sums.length!==LANES)return false;for(let lane=0;lane<LANES;lane++)if(typeof sums[lane]!=='string'||!LANE_SUM.test(sums[lane]))return false;return true;}
  const pageKey=(stamp,index,length)=>`${baseChunkKey(stamp,index,length)}.${stamp.overlayVersion??0}`;
  function laneRawLength(part){
    if(part.encoding===undefined&&part.rawByteLength===undefined)return part.byteLength;
    if(part.encoding==='identity'&&Number.isSafeInteger(part.rawByteLength)&&part.rawByteLength>=1&&part.rawByteLength<=4194304&&part.byteLength===part.rawByteLength)return part.rawByteLength;
    if(part.encoding!=='gh-lz4-block-v1'||!Number.isSafeInteger(part.rawByteLength)||part.rawByteLength<1||part.rawByteLength>4194304||!Number.isSafeInteger(part.byteLength)||part.byteLength<20||part.byteLength>Math.floor(part.rawByteLength*.875))throw corrupt('binary-lane-storage');
    return part.rawByteLength;
  }
  function storedLaneBytes(part,options){
    const data=chunkBytesForId(part.id,options,{kind:'fleet-lane-container-v2',page:part.page,byteLength:part.byteLength},part.byteLength,'binary-chunk-missing');
    if(part.encoding===undefined||part.encoding==='identity')return data;
    const codec=globalThis.GH_SAVE_CHUNK_CODEC;if(!codec?.unpackContainer)throw corrupt('binary-lane-codec-unavailable');
    try{return codec.unpackContainer(data,part.rawByteLength);}catch(_error){throw corrupt('binary-lane-storage-corrupt');}
  }
  function* prepareLaneStorage(data,externalEncoding){
    const rawByteLength=data.length;
    if(externalEncoding&&typeof globalThis.GH_SAVE_CHUNK_ENCODING_PROVIDER==='function'){
      const packed=yield {kind:'fleet-container-encode',bytes:data,stride:8};
      if(!(packed?.bytes instanceof Uint8Array)||packed.rawBytes!==rawByteLength||!(packed.encoding==='identity'&&packed.bytes.length===rawByteLength||packed.encoding==='gh-lz4-block-v1'&&packed.bytes.length>=20&&packed.bytes.length<=Math.floor(rawByteLength*.875)))throw new Error('save-container-encoding-invalid');
      return {data:packed.bytes,kind:'lane-container',byteLength:packed.bytes.length,encoding:packed.encoding,rawByteLength};
    }
    return {data,kind:'lane',byteLength:rawByteLength};
  }
  function laneParts(marker){
    const {byteLength,chunkBytes,chunks,lanes,rowPatches}=marker,count=Math.ceil(byteLength/chunkBytes);
    if(!Number.isSafeInteger(byteLength)||byteLength<0||byteLength>536870912||byteLength%128||!Number.isSafeInteger(chunkBytes)||chunkBytes<128||chunkBytes>4194304||chunkBytes%128||!isPlain(marker.overlay)||marker.overlay.version!==2||marker.baseChunks!==undefined||!isPlain(lanes)||![1,2].includes(lanes.version)||lanes.laneBytes!==8||!Array.isArray(lanes.chunks)||lanes.chunks.length!==count*LANES||!Array.isArray(lanes.ranges)||lanes.ranges.length!==count*LANES||!Array.isArray(lanes.containers)||lanes.containers.length>count*LANES||!Array.isArray(chunks))throw corrupt('binary-lanes');
    const containers=new Map(),occupied=new Set(),order=[],pageBytes=new Array(count).fill(0),expandedBytes=new Array(count).fill(0);
    for(const part of lanes.containers){
      if(!isPlain(part)||typeof part.id!=='string'||!CHUNK_ID.test(part.id)||containers.has(part.id)||!Number.isSafeInteger(part.page)||part.page<0||part.page>=count)throw corrupt('binary-lane-container');
      const width=Math.min(chunkBytes,byteLength-part.page*chunkBytes)/LANES;
      const rawLength=laneRawLength(part);if(lanes.version===1&&part.encoding!==undefined||!Number.isSafeInteger(part.byteLength)||part.byteLength<1||!Number.isSafeInteger(rawLength)||rawLength<width||rawLength>width*LANES||rawLength%width)throw corrupt('binary-lane-container');containers.set(part.id,part);pageBytes[part.page]+=part.byteLength;expandedBytes[part.page]+=rawLength;
      if(pageBytes[part.page]>width*24||expandedBytes[part.page]>width*32)throw corrupt('binary-lane-container-budget');
    }
    const used=new Set();
    for(let at=0;at<lanes.chunks.length;at++){
      const range=lanes.ranges[at],page=Math.floor(at/LANES),width=Math.min(chunkBytes,byteLength-page*chunkBytes)/LANES,part=containers.get(range?.id);
      if(!isPlain(range)||!part||part.page!==page||!Number.isSafeInteger(range.offset)||range.offset<0||range.offset%width||range.offset+width>laneRawLength(part)||lanes.chunks[at]!==`${range.id}.${range.offset.toString(36)}`||occupied.has(lanes.chunks[at]))throw corrupt('binary-lane-range');
      occupied.add(lanes.chunks[at]);if(!used.has(part.id)){used.add(part.id);order.push(part.id);}
    }
    if(order.length!==containers.size||lanes.containers.some((part,index)=>part.id!==order[index]))throw corrupt('binary-lane-container-order');
    let patches=[];
    if(rowPatches!==undefined){if(!isPlain(rowPatches)||rowPatches.version!==2||!Array.isArray(rowPatches.chunks)||rowPatches.chunks.length>ROW_PATCH_MAX_CHUNKS)throw corrupt('binary-lane-patches');patches=rowPatches.chunks;}
    let total=0;
    for(const p of patches){if(!isPlain(p)||!Number.isSafeInteger(p.rows)||p.rows<1||p.byteLength!==ROW_PATCH_HEADER+p.rows*ROW_PATCH_RECORD||p.byteLength>4194304)throw corrupt('binary-lane-patch');total+=p.byteLength;}
    const all=[...order,...patches.map(p=>p.id)];
    if(total>ROW_PATCH_MAX_BYTES||all.some(id=>typeof id!=='string'||!CHUNK_ID.test(id))||new Set(all).size!==all.length||chunks.length!==all.length||chunks.some((id,i)=>id!==all[i]))throw corrupt('binary-lane-chunks');
    return {count,ids:lanes.chunks,ranges:lanes.ranges,containers:lanes.containers,patches};
  }
  function laneBuffer(marker,options){
    const parts=laneParts(marker);if(typeof options.resolveChunk!=='function')throw corrupt('binary-chunks-unresolved');
    const buffer=new ArrayBuffer(marker.byteLength),target=new Uint8Array(buffer),words=new Uint32Array(buffer),sums=[],live=new Map();
    // Each immutable container is decoded once and released after its live lanes are copied.
    // Native bootstrap retains stored bytes; expanded obsolete lanes never accumulate in a map.
    for(let at=0;at<parts.ranges.length;at++){const id=parts.ranges[at].id;let list=live.get(id);if(!list){list=[];live.set(id,list);}list.push(at);}
    for(const part of parts.containers){
      const expanded=storedLaneBytes(part,options),start=part.page*marker.chunkBytes,length=Math.min(marker.chunkBytes,marker.byteLength-start),rows=length/128;
      for(const at of live.get(part.id)||[]){
        const lane=at%LANES,range=parts.ranges[at],data=expanded.subarray(range.offset,range.offset+rows*8),aligned=data.byteOffset%4?data.slice():data,source=new Uint32Array(aligned.buffer,aligned.byteOffset,aligned.length/4),base=start/4+lane*2;sums[at]=chunkChecksum(aligned);
        for(let row=0;row<rows;row++){words[base+row*32]=source[row*2];words[base+row*32+1]=source[row*2+1];}
      }
    }
    for(const p of parts.patches){
      const patch=chunkBytesForId(p.id,options,{kind:'fleet-lane-row-patch-v2',byteLength:p.byteLength},p.byteLength,'binary-chunk-missing'),view=new DataView(patch.buffer,patch.byteOffset,patch.byteLength);
      if(LANE_PATCH_MAGIC.some((v,i)=>patch[i]!==v)||view.getUint32(8,true)!==marker.byteLength||view.getUint32(12,true)!==128||view.getUint32(16,true)!==p.rows||view.getUint32(20,true)!==0)throw corrupt('binary-lane-patch-header');
      let previous=-1;
      for(let i=0;i<p.rows;i++){const at=ROW_PATCH_HEADER+i*ROW_PATCH_RECORD,row=view.getUint32(at,true);if(row<=previous||row>=marker.byteLength/128)throw corrupt('binary-lane-patch-index');previous=row;target.set(patch.subarray(at+4,at+ROW_PATCH_RECORD),row*128);}
    }
    decodedLaneCaches.set(buffer,{ids:parts.ids.slice(),sums,ranges:parts.ranges.map(p=>({...p})),containers:parts.containers.map(p=>({...p})),patches:parts.patches.map(p=>({...p})),chunkBytes:marker.chunkBytes});return buffer;
  }
  function adoptChunkIds(store,marker){
    if(!isPlain(marker)||marker.$ghBinary!=='chunks-v1'||!marker.lanes)return false;
    let parts;try{parts=laneParts(marker);}catch{return false;}
    const decoded=decodedLaneCaches.get(store.rows),origin=decoded?.origin,g=chunkGeometry(store);
    if(!decoded||origin?.store!==store||origin.revision!==store.revision||origin.length!==store.length||origin.structure!==store.structure||origin.epoch!==g.STORE.epoch(store)||g.chunkBytes!==marker.chunkBytes||g.bytes.length!==marker.byteLength||decoded.chunkBytes!==marker.chunkBytes||decoded.ids.length!==parts.ids.length||decoded.ids.some((id,i)=>id!==parts.ids[i]))return false;
    if(decoded.containers.length!==parts.containers.length||decoded.containers.some((p,i)=>p.id!==parts.containers[i].id||p.page!==parts.containers[i].page||p.byteLength!==parts.containers[i].byteLength||p.encoding!==parts.containers[i].encoding||p.rawByteLength!==parts.containers[i].rawByteLength))return false;
    // The decoded bytes already include this exact ordered patch chain. Adopting a shorter or substituted chain would
    // label those bytes as a different checkpoint and could silently discard edits in the next otherwise unchanged save.
    if(decoded.patches.length!==parts.patches.length||decoded.patches.some((p,i)=>p.id!==parts.patches[i].id||p.rows!==parts.patches[i].rows||p.byteLength!==parts.patches[i].byteLength))return false;
    const entry={ids:decoded.ids.slice(),sums:decoded.sums.slice(),ranges:decoded.ranges.map(p=>({...p})),containers:decoded.containers.map(p=>({...p})),keys:[],rotation:0,overlayVersion:globalThis.GH_FLEET_STORE.chunkStamp(store).overlayVersion};
    if(!parts.patches.length){const stamp=g.STORE.chunkStamp(store);for(let page=0;page<g.count;page++)entry.keys[page]=pageKey(stamp,page,Math.min(g.chunkBytes,g.bytes.length-page*g.chunkBytes));}
    entry.rowPatch=freshRowPatch(store,entry,parts.patches);chunkIdCache.set(store,entry);decodedLaneCaches.delete(store.rows);chunkCacheStats.adopted+=parts.ids.length;return true;
  }
  function inheritFleetChunkCache(source,target){
    const STORE=globalThis.GH_FLEET_STORE,prior=chunkIdCache.get(source);if(!prior||!STORE?.isStore?.(target))return false;
    const from=chunkGeometry(source),to=chunkGeometry(target);if(from.bytes.length!==to.bytes.length||from.chunkBytes!==to.chunkBytes||prior.ids.length!==to.count*LANES)return false;
    const sourceStamp=STORE.chunkStamp(source),stamp=STORE.inheritChunkCacheRuntime?.(source,target);if(!stamp)return false;
    const entry={ids:prior.ids.slice(),sums:prior.sums.slice(),ranges:prior.ranges.map(p=>({...p})),containers:prior.containers.map(p=>({...p})),keys:[],rotation:prior.rotation,overlayVersion:prior.overlayVersion===sourceStamp.overlayVersion?stamp.overlayVersion:-1};
    for(let page=0;page<to.count;page++){const length=Math.min(to.chunkBytes,to.bytes.length-page*to.chunkBytes);entry.keys[page]=prior.keys[page]===pageKey(sourceStamp,page,length)?pageKey(stamp,page,length):null;}
    if(prior.rowPatch){entry.rowPatch=freshRowPatch(target,entry,prior.rowPatch.layers);entry.rowPatch.pending=prior.rowPatch.pending.slice();entry.rowPatch.pendingRows=prior.rowPatch.pendingRows;entry.rowPatch.invalid=!rowPatchCurrent(source,prior.rowPatch);}
    chunkIdCache.set(target,entry);return true;
  }
  const preparedChunkSnapshots=new WeakSet();
  function* chunkManifestSteps(store,{externalChecksums=false,externalEncoding=false,knownChunkIds=null,allowRowPatches=false}={}){
    const {STORE,chunkBytes,bytes,count}=chunkGeometry(store),revision=store.revision,buffer=store.rows,stamp=STORE.chunkStamp(store);
    const current=()=>{if(store.revision!==revision||store.rows!==buffer)throw new Error('state-codec-fleet-changed-during-save');},known=id=>knownChunkIds?.has?.(id)===true;
    let prior=chunkIdCache.get(store);if(!prior)prior={ids:[],sums:[],ranges:[],containers:[],keys:[],rotation:0,overlayVersion:-1};
    // Private plan: a failed/yield-aborted save cannot publish half of a manifest cache.
    const entry={ids:prior.ids.slice(),sums:prior.sums.slice(),ranges:prior.ranges.map(p=>({...p})),containers:prior.containers.map(p=>({...p})),keys:prior.keys.slice(),rotation:prior.rotation,overlayVersion:stamp.overlayVersion},held=prior.rowPatch,chunks=[],patches=[],fresh=[],containerById=new Map(entry.containers.map(p=>[p.id,p])),preparedIds=new Set(),backed=id=>known(id)||preparedIds.has(id);
    let patching=false;
    const packetRows=Math.floor((4194304-ROW_PATCH_HEADER)/ROW_PATCH_RECORD),layerBytes=held?.layers.reduce((n,p)=>n+p.byteLength,0)||0;
    const eligible=allowRowPatches&&externalChecksums&&rowPatchEnabled()&&count>0&&prior.overlayVersion===stamp.overlayVersion&&rowPatchCurrent(store,held)&&entry.ids.length===count*LANES&&entry.ranges.length===count*LANES&&entry.ranges.every(p=>known(p.id))&&held.layers.every(p=>known(p.id))&&held.layers.length+Math.ceil(held.pendingRows/packetRows)<=ROW_PATCH_MAX_CHUNKS&&layerBytes+held.pendingRows*ROW_PATCH_RECORD+ROW_PATCH_HEADER*Math.ceil(held.pendingRows/packetRows)<=ROW_PATCH_MAX_BYTES;
    if(eligible){
      const index=entry.rotation%count,start=index*chunkBytes,length=Math.min(chunkBytes,bytes.length-start),proof=yield {kind:'fleet-row-proof',store,index,totalByteLength:bytes.length};current();
      if(proof?.current?.()===true&&proof.result?.index===index&&proof.result?.byteLength===length&&typeof proof.result.checksum==='string'){
        const found=yield {kind:'fleet-chunk-checksum',bytes:bytes.subarray(start,start+length),outputByteLength:length};current();
        if(proof.current()!==true)throw new Error('state-codec-fleet-changed-during-save');
        if(!found||typeof found.checksum!=='string')throw new Error('save-checksum-evidence-invalid');
        if(found.checksum!==proof.result.checksum)throw new Error('save-row-patch-proof-mismatch');
        patching=true;entry.rotation++;chunkCacheStats.verified++;patches.push(...held.layers.map(p=>({...p})));
        let sorted=new Int32Array(held.pendingRows),spare=new Int32Array(held.pendingRows),used=0,work=0;
        for(const batch of held.pending)for(const row of batch){if(!Number.isSafeInteger(row)||row<0||row>=store.length)throw new Error('save-row-patch-index');sorted[used++]=row;if(++work===2048){yield;current();work=0;}}
        for(let width=1;width<used;width*=2){for(let lo=0;lo<used;lo+=width*2){const mid=Math.min(lo+width,used),end=Math.min(lo+width*2,used);let a=lo,b=mid;for(let at=lo;at<end;at++){spare[at]=a<mid&&(b>=end||sorted[a]<=sorted[b])?sorted[a++]:sorted[b++];if(++work===2048){yield;current();work=0;}}}const swap=sorted;sorted=spare;spare=swap;}
        let distinct=0;for(let i=0;i<used;i++){if(!i||sorted[i]!==sorted[i-1])spare[distinct++]=sorted[i];if(++work===2048){yield;current();work=0;}}
        for(let at=0;at<distinct;at+=packetRows){
          const rows=Math.min(packetRows,distinct-at),data=new Uint8Array(ROW_PATCH_HEADER+rows*ROW_PATCH_RECORD),view=new DataView(data.buffer);data.set(LANE_PATCH_MAGIC);view.setUint32(8,bytes.length,true);view.setUint32(12,128,true);view.setUint32(16,rows,true);
          for(let i=0;i<rows;i++){const row=spare[at+i],to=ROW_PATCH_HEADER+i*ROW_PATCH_RECORD;view.setUint32(to,row,true);data.set(bytes.subarray(row*128,(row+1)*128),to+4);if((i+1)%512===0){yield;current();}}
          const part={id:`${NONCE}.0.r.${(++chunkSequence).toString(36)}`,rows,byteLength:data.length};patches.push(part);fresh.push({...part,kind:'row-patch',data});yield;current();
        }
        chunkCacheStats.rowPatchSaves=(chunkCacheStats.rowPatchSaves||0)+1;chunkCacheStats.rowPatchRows=(chunkCacheStats.rowPatchRows||0)+distinct;
      }
    }
    const transform={kind:'fleet-lanes-v1',stride:128,laneBytes:8};
    const needsPage=page=>externalEncoding&&entry.ranges.slice(page*LANES,(page+1)*LANES).some(p=>containerById.get(p.id)?.encoding===undefined)||held?.layers.length||entry.keys[page]!==pageKey(stamp,page,Math.min(chunkBytes,bytes.length-page*chunkBytes))||entry.ids.length!==count*LANES||entry.ranges.slice(page*LANES,(page+1)*LANES).some(p=>!known(p.id))||page===entry.rotation%count;
    if(!patching)for(let page=0;page<count;page++){
      const start=page*chunkBytes,length=Math.min(chunkBytes,bytes.length-start),key=pageKey(stamp,page,length),needs=needsPage(page);
      if(needs){
        let found;
        if(externalChecksums){let next=page+1;while(next<count&&!needsPage(next))next++;const nextStart=next*chunkBytes,nextLength=Math.min(chunkBytes,bytes.length-nextStart);found=yield {kind:'fleet-chunk-checksum',bytes:bytes.subarray(start,start+length),transform,outputByteLength:length,nextBytes:next<count?bytes.subarray(nextStart,nextStart+nextLength):null,nextTransform:next<count?transform:null,nextOutputByteLength:next<count?nextLength:null};current();}
        else{const data=new Uint8Array(length),rows=length/128,source=new Uint32Array(bytes.buffer,bytes.byteOffset+start,length/4),target=new Uint32Array(data.buffer);for(let lane=0;lane<16;lane++){const from=lane*2,to=lane*rows*2;for(let row=0;row<rows;row++){target[to+row*2]=source[row*32+from];target[to+row*2+1]=source[row*32+from+1];}yield;current();}found={bytes:data,laneSums:Array.from({length:16},(_,lane)=>chunkChecksum(data.subarray(lane*length/16,(lane+1)*length/16)))};}
        if(!(found?.bytes instanceof Uint8Array)||found.bytes.length!==length||!validLaneSums(found.laneSums))throw new Error('save-lane-checksum-evidence-invalid');
        const changed=[],laneLength=length/LANES;
        // A forgotten, fully live container can be reconstructed exactly and
        // keep its immutable ID. A container with obsolete ranges cannot: its
        // current live lanes are safely rebased below under a new ID.
        const missing=new Map();for(let lane=0;lane<LANES;lane++){const range=entry.ranges[page*LANES+lane];if(range&&!known(range.id)){let rows=missing.get(range.id);if(!rows){rows=[];missing.set(range.id,rows);}rows.push(lane);}}
        // Several missing containers are rebased together, so forgetting the
        // vault cannot resurrect a request fanout from an older fragmented save.
        if(missing.size===1)for(const [id,lanes] of missing){const part=containerById.get(id);if(!part||lanes.length*laneLength!==part.byteLength||lanes.some(lane=>entry.sums[page*LANES+lane]!==found.laneSums[lane]))continue;
          const data=new Uint8Array(part.byteLength);for(const lane of lanes){data.set(found.bytes.subarray(lane*laneLength,(lane+1)*laneLength),entry.ranges[page*LANES+lane].offset);yield;current();}
          const chunk={...part,kind:part.encoding?'lane-container':'lane',index:page,compacted:false,lanes:lanes.slice().sort((a,b)=>entry.ranges[page*LANES+a].offset-entry.ranges[page*LANES+b].offset),...(lanes.length===1?{lane:lanes[0]}:{}),data};preparedChunkSnapshots.add(chunk);chunks.push(chunk);preparedIds.add(id);
        }
        for(let lane=0;lane<LANES;lane++){
          const at=page*LANES+lane,sum=found.laneSums[lane];
          if(externalEncoding&&containerById.get(entry.ranges[at]?.id)?.encoding===undefined||!entry.ids[at]||entry.sums[at]!==sum||!backed(entry.ranges[at]?.id)){if(entry.ids[at]&&entry.keys[page]===key&&entry.sums[at]!==sum)chunkCacheStats.mismatches++;changed.push(lane);}
          entry.sums[at]=sum;
          if(!changed.includes(lane))chunkCacheStats.reused++;
          yield;current();
        }
        if(changed.length){
          // A container may retain obsolete lanes beside a still-live one.
          // Retire sparse containers before their retained bytes could exceed
          // 1.5 raw pages. This bounds native-bootstrap memory and disk, even
          // for adversarial alternating masks. It uses this already prepared
          // page, adding no fleet scan or background gameplay task.
          const selected=new Set(changed),originalChanged=changed.length;
          for(;;){
            const retained=new Map();for(let lane=0;lane<LANES;lane++)if(!selected.has(lane)){const range=entry.ranges[page*LANES+lane];if(range){let part=retained.get(range.id);if(!part){part={...containerById.get(range.id),live:[]};retained.set(range.id,part);}part.live.push(lane);}}
            const total=[...retained.values()].reduce((sum,p)=>sum+p.byteLength,selected.size*laneLength),expanded=[...retained.values()].reduce((sum,p)=>sum+laneRawLength(p),selected.size*laneLength);if(total<=length*1.5&&expanded<=length*2)break;
            let best=null;for(const part of retained.values())if(!best||laneRawLength(part)-part.live.length*laneLength>laneRawLength(best)-best.live.length*laneLength)best=part;
            if(!best)throw new Error('save-lane-container-budget');for(const lane of best.live)selected.add(lane);
          }
          changed.length=0;changed.push(...selected);changed.sort((a,b)=>a-b);
          const id=`${NONCE}.0.l.${(++chunkSequence).toString(36)}`,data=new Uint8Array(changed.length*laneLength);
          for(let slot=0;slot<changed.length;slot++){const lane=changed[slot],at=page*LANES+lane,offset=slot*laneLength;data.set(found.bytes.subarray(lane*laneLength,(lane+1)*laneLength),offset);entry.ranges[at]={id,offset};entry.ids[at]=`${id}.${offset.toString(36)}`;chunkCacheStats.named++;yield;current();}
          const stored=yield* prepareLaneStorage(data,externalEncoding);current();const part={id,page,byteLength:stored.byteLength,...(stored.encoding?{encoding:stored.encoding,rawByteLength:stored.rawByteLength}:{})};
          const chunk={...part,kind:stored.kind,index:page,lanes:changed.slice(),compacted:changed.length>originalChanged,...(changed.length===1?{lane:changed[0]}:{}),data:stored.data};preparedChunkSnapshots.add(chunk);chunks.push(chunk);containerById.set(id,part);
        }
        entry.keys[page]=key;
      }
    }
    entry.ids.length=count*LANES;entry.sums.length=count*LANES;entry.ranges.length=count*LANES;entry.keys.length=count;
    const freshById=new Map(chunks.map(p=>[p.id,p]));chunks.length=0;
    entry.containers=[];const included=new Set();
    for(let at=0;at<entry.ids.length;at++){const range=entry.ranges[at],id=range.id;if(included.has(id))continue;included.add(id);const part=containerById.get(id);if(!part)throw new Error('save-lane-container-missing');entry.containers.push({...part});chunks.push(freshById.get(id)||{...part,kind:'lane',index:part.page});}
    for(const part of fresh)preparedChunkSnapshots.add(part);
    const partsById=new Map(fresh.map(p=>[p.id,p]));for(const p of patches)chunks.push(partsById.get(p.id)||{...p,kind:'row-patch'});
    current();if(!patching)entry.rotation++;
    entry.rowPatch=freshRowPatch(store,entry,patches);chunkIdCache.set(store,entry);
    // The v2 fence makes an old row/overlay reader refuse this format instead
    // of mistaking a packed lane container for contiguous 128-byte rows.
    return {marker:{$ghBinary:'chunks-v1',byteLength:bytes.length,chunkBytes,chunks:chunks.map(p=>p.id),overlay:{version:2},lanes:{version:entry.containers.some(p=>p.encoding)?2:1,laneBytes:LANE_BYTES,chunks:entry.ids.slice(),ranges:entry.ranges.map(p=>({...p})),containers:entry.containers.map(p=>({...p}))},...(patches.length?{rowPatches:{version:2,chunks:patches}}:{})},chunks};
  }
  // Text chunks follow the fleet chunks as {id,byteLength,text}; the caller uploads the UTF-8 bytes of text.
  function serializeChunked(state,options={}){const steps=serializeChunkedSteps(state,{...options,knownChunkIds:options.knownChunkIds??new Set()});let step;while(!(step=steps.next()).done){}return step.value;}
  function* serializeChunkedSteps(state,options={}){
    if(!isPlain(state)||!isArrayBuffer(state.fleet?.rows))return {text:yield* serializeSteps(state),chunks:[]};
    // Each dirty 4 MiB chunk and the rotating reuse check get their own step. A sliced save can paint between them;
    // the synchronous API drains these identical steps and retains the same IDs, checksums and corruption checks.
    const manifest=yield* chunkManifestSteps(state.fleet,options),textChunks=[],coldChunks=[],text=yield* serializeSteps(state,{rowsText:JSON.stringify(manifest.marker),textChunks,coldChunks});
    return {text,chunks:[...manifest.chunks,...textChunks,...coldChunks]};
  }

  const API=Object.freeze({VERSION,MIN_ROWS,chunkChecksum,recordFleetRows,beginFleetOverlay,endFleetOverlay,fleetRowChecksum,isPreparedChunk:chunk=>preparedChunkSnapshots.has(chunk),encodeState,decodeState,serialize,serializeSteps,deserialize,selectPaths,serializeChunked,serializeChunkedSteps,adoptChunkIds,inheritFleetChunkCache,createColdArchivePage,coldArchiveRows,validateColdArchive,coldArchiveStats,inheritColdArchive,bytesToBase64:bytes=>{chunkCacheStats.base64Calls++;return base64Encode(bytes instanceof Uint8Array?bytes:new Uint8Array(bytes));},cacheStats:()=>({...collectionCacheStats,layout:{...layoutCacheStats,entries:PATH_LAYOUT.size},entries:COLLECTION_TEXT.size,rows:{...rowCacheStats},chunks:{...chunkCacheStats},text:{...textChunkStats,adoptable:ADOPTED_TEXT.size},openChunks:{...openChunkStats,entries:OPEN_TEXT.size,limitChars:OPEN_TEXT_LIMIT}}),valueChunkStats:()=>({entries:VALUE_TEXT.size,chars:valueChars,limitChars:VALUE_CACHE_CHARS}),textChunkMin:TEXT_CHUNK_MIN,isEncoded:tree=>isPlain(tree)&&own(tree,'stateCodec')});
  globalThis.GH_STATE_CODEC=API;
  if(globalThis.window&&globalThis.window!==globalThis)globalThis.window.GH_STATE_CODEC=API;
  if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
