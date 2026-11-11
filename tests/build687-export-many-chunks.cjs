'use strict';
// Build 687 (review of Build 685): a save now names one chunk per tracked segment, so a large Mobility network passes the
// export worker's former limit of 4,096 chunk ids and the backup export would have been refused
// (save-export-manifest-invalid) while the saves themselves succeed. Proven on the real export worker and the real codec
// in one realm (a fake worker scope), on a save of more than 4,096 chunks:
//  1. the export is accepted and the exported file holds the state exactly;
//  2. the manifest's shape is still guarded: duplicate ids and more than 65,536 ids are refused, and the bytes stay
//     bounded by the worker's export budget (a chunk past it is refused).
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..'),WEB=path.join(ROOT,'WebApp');
const posted=[];const scope={console,TextEncoder,TextDecoder,Blob,performance,structuredClone,atob,btoa,setTimeout,clearTimeout,listeners:[],postMessage:m=>posted.push(m)};
scope.self=scope;scope.globalThis=scope;scope.window=undefined;scope.addEventListener=(type,fn)=>{if(type==='message')scope.listeners.push(fn);};
scope.importScripts=(...files)=>{for(const file of files)vm.runInContext(fs.readFileSync(path.join(WEB,file),'utf8'),scope,{filename:file});};
vm.createContext(scope);scope.importScripts('save-checksum-worker.js');
// The worker checks `instanceof ArrayBuffer` in its own realm: buffers are made there.
const RealmBuffer=vm.runInContext('ArrayBuffer',scope),realmBytes=text=>{const bytes=new TextEncoder().encode(text),buffer=new RealmBuffer(bytes.byteLength);new Uint8Array(buffer).set(bytes);return buffer;};
const send=m=>{posted.length=0;for(const fn of scope.listeners)fn({data:m});return posted[0];};
const C=scope.GH_STATE_CODEC;C.registerTrackedCollection(['mobility','vehicles'],{rows:2});C.registerTrackedCollection(['mobility','drivers'],{rows:2});
const vehicle=i=>({id:`MOB-V-${String(i).padStart(7,'0')}`,ownerCompanyId:'mobility',name:`ANI Go · سيارة ${i} · ${'Tesla Model 3 '.repeat(8)}`,status:i%4?'available':'moving',centerId:`C${i%130}`,battery:40+i%60,staffing:{mode:'automatic-fixed',driverId:`DRV-${i}`}});
const driver=i=>({id:`DRV-${i}`,ownerCompanyId:'mobility',name:`سائق ${i} · ${'محترف '.repeat(20)}`,status:'online',centerId:`C${i%130}`,assetId:`MOB-V-${String(i).padStart(7,'0')}`});
const state={saveVersion:'3.0.0',saveRevision:7,simSeconds:86400,mobility:{vehicles:Array.from({length:12000},(_,i)=>vehicle(i)),drivers:Array.from({length:12000},(_,i)=>driver(i))},finance:{note:'x'}};
const textChunks=[],steps=C.serializeSteps(state,{textChunks});let step;while(!(step=steps.next()).done){}
const head=step.value,ids=JSON.parse(head).stateCodec.chunks;
assert.ok(ids.length>4096,`the save names more than 4,096 chunks (${ids.length})`);
const meta={format:'global-holdings-save',saveRevision:7,simSeconds:86400};
// 1. accepted and exact
(async()=>{
  const started=send({type:'export-start',version:'save-checksum-v1',id:1,session:'big',json:head,meta});assert.equal(started.ok,true,`start: ${started.error}`);
  let id=2;for(const chunk of textChunks){const buffer=realmBytes(chunk.text);const r=send({type:'export-chunk',version:'save-checksum-v1',id:id++,session:'big',chunkId:chunk.id,buffer,byteLength:buffer.byteLength,offset:0});assert.equal(r.ok,true,`chunk: ${r.error}`);}
  const done=send({type:'export-finish',version:'save-checksum-v1',id:id++,session:'big'});assert.equal(done.ok,true,`finish: ${done.error}`);
  await done.blob.text().then(text=>{const file=JSON.parse(text);assert.equal(file.format,'global-holdings-save');// The file holds the state in the codec's self-contained form (no chunk references): a fresh decoder reads it back.
    assert.ok(!text.includes('$ghText'),'1: the file is self-contained');const decoded=scope.GH_STATE_CODEC.deserialize(JSON.stringify(file.state));assert.equal(JSON.stringify(decoded.mobility),JSON.stringify(state.mobility),'1: the exported file holds the state');
    // 2. the manifest stays guarded
    const dup=JSON.parse(head);dup.stateCodec.chunks=[...dup.stateCodec.chunks,dup.stateCodec.chunks[0]];
    assert.match(String(send({type:'export-start',version:'save-checksum-v1',id:900,session:'dup',json:JSON.stringify(dup),meta}).error),/save-export-manifest-invalid/,'2: duplicate ids are refused');
    const many=JSON.parse(head);many.stateCodec.chunks=Array.from({length:65537},(_,i)=>`x.o.${i.toString(36)}`);
    assert.match(String(send({type:'export-start',version:'save-checksum-v1',id:901,session:'many',json:JSON.stringify(many),meta}).error),/save-export-manifest-invalid/,'2: more than 65,536 ids are refused');
    const source=fs.readFileSync(path.join(WEB,'save-checksum-worker.js'),'utf8');assert.match(source,/EXPORT_LIMIT=512\*1024\*1024,EXPORT_CHUNK_IDS_LIMIT=65536/);assert.match(source,/file\.total\+m\.byteLength>EXPORT_LIMIT\)throw new Error\('save-export-chunk-budget'\)/,'2: the bytes stay bounded');
    console.log(JSON.stringify({suite:'build687-export-many-chunks',chunks:ids.length,fileChars:text.length}));console.log('BUILD687_EXPORT_MANY_CHUNKS_PASS');});
})().catch(error=>{console.error(error);process.exit(1);});
