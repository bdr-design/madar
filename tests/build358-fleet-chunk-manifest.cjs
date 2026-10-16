'use strict';
// Build 358 (million-asset save, step 3 stage A): GH_STATE_CODEC.serializeChunked writes the fleet record buffer as a
// 'chunks-v1' manifest (immutable 4 MiB base chunks plus compact daily-counter overlays) instead of base64 inside the JSON. This proves, without the
// native vault: the text decodes (with a chunk resolver) to exactly the state the base64 save decodes to, after every
// kind of write; only written chunks get new ids; a write that bypasses the store renames every chunk; and a missing,
// short, extra or malformed chunk is a corrupt save.
const assert=require('node:assert/strict'),path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
global.window=global;require(path.join(ROOT,'WebApp/transaction-core.js'));
const STORE=require(path.join(ROOT,'WebApp/fleet-store-core.js')),EVENTS=require(path.join(ROOT,'WebApp/fleet-event-core.js'));
const CODEC=require(path.join(ROOT,'WebApp/state-codec-core.js')),TX=global.GH_TRANSACTION_CORE;
const {fleet,context,resolveRoute}=require('./helpers/fleet-fixture.js');
const results=[];function test(name,fn){try{results.push({name,ok:true,detail:fn()});}catch(error){results.push({name,ok:false,error:String(error.stack||error).slice(0,1500)});}}

const CHUNK=STORE.CHUNK_ROWS,template=fleet(),ordinary=template.filter(a=>['A1','S1','R1'].includes(a.routeId)&&!a.salePending&&!a.simulationFault&&a.phase),assets=template.slice();
for(let i=0;assets.length<CHUNK*2+5000;i++){const a=structuredClone(ordinary[i%ordinary.length]);a.id=`BULK-${String(i).padStart(8,'0')}`;a.name=`GH BULK ${i}`;assets.push(a);}
const state={saveVersion:'3.0.0',simSeconds:0,profile:{name:'chunk probe'},fleet:STORE.fromAssets(assets,{at:0})};
// A stand-in for the vault: chunk bytes by id, copied at "upload" time.
const vault=new Map();
function save(label,{verifyExact=true}={}){
  const out=CODEC.serializeChunked(state,{knownChunkIds:new Set(vault.keys())}),uploaded=[];
  for(const chunk of out.chunks)if(!vault.has(chunk.id)){const bytes=chunk.data?.slice()||new Uint8Array(state.fleet.rows,chunk.byteOffset,chunk.byteLength).slice();vault.set(chunk.id,bytes);uploaded.push({kind:chunk.kind,index:chunk.index,bytes:bytes.byteLength});}
  const decoded=CODEC.deserialize(out.text,{resolveChunk:id=>vault.get(id)}),reference=CODEC.deserialize(CODEC.serialize(state));
  if(verifyExact){assert.deepEqual(new Uint8Array(decoded.fleet.rows),new Uint8Array(reference.fleet.rows),`${label}: rows decode exactly`);const strip=tree=>JSON.stringify({...tree,fleet:{...tree.fleet,rows:null}});assert.equal(strip(decoded),strip(reference),`${label}: everything else decodes exactly`);}
  assert(!out.text.includes('"base64"'),`${label}: no base64 rows in the text`);
  return {uploaded,ids:out.chunks.map(c=>c.id),parts:out.chunks.map(c=>({id:c.id,kind:c.kind,index:c.index,bytes:c.byteLength})),textBytes:out.text.length};
}

test('first save names every chunk; the text holds no rows',()=>{
  const first=save('first');assert.equal(first.uploaded.length,2*Math.ceil(state.fleet.rows.byteLength/(CHUNK*STORE.STRIDE)));
  const again=save('unchanged');assert.deepEqual(again.uploaded,[],'nothing to upload');assert.deepEqual(again.ids,first.ids,'same ids');
  return {chunks:first.uploaded.length,textBytes:first.textBytes,rowsBytes:state.fleet.rows.byteLength};
});
test('a single-row write renames only its chunk',()=>{
  STORE.set(state.fleet,CHUNK+11,'fuel',12.5);const out=save('one row');assert.deepEqual(out.uploaded.map(row=>`${row.kind}:${row.index}`),['base:1']);return out.uploaded.map(row=>({kind:row.kind,index:row.index,bytes:row.bytes}));
});
test('day-close counters upload compact overlay pages and preserve exact rows',()=>{
  const before=save('day-close baseline'),prior=new Map(before.parts.map(part=>[`${part.kind}:${part.index}`,part.id]));
  const write=STORE.columnWriter(state.fleet,['flightHours','flightCycles','nextCheckHours']);
  TX.execute(state,{label:'day-close-overlay',scope:['fleet'],apply:()=>{
    for(let row=0;row<state.fleet.length;row++){
      write(row,'flightHours',Number(STORE.get(state.fleet,row,'flightHours')||0)+4);
      write(row,'flightCycles',Number(STORE.get(state.fleet,row,'flightCycles')||0)+1);
      write(row,'nextCheckHours',Number(STORE.get(state.fleet,row,'nextCheckHours')||600)+4);
    }
  }});
  const closed=save('day-close'),expected=Math.ceil(state.fleet.rows.byteLength/(CHUNK*STORE.STRIDE));
  assert.equal(closed.uploaded.length,expected,'only one compact page per row chunk uploads');
  assert(closed.uploaded.every(part=>part.kind==='overlay'),'daily fields do not rewrite base row chunks');
  assert.equal(closed.uploaded.reduce((sum,part)=>sum+part.bytes,0),state.fleet.rows.byteLength/STORE.STRIDE*13,'overlay payload is 13 bytes per row');
  assert(closed.parts.filter(part=>part.kind==='base').every(part=>prior.get(`base:${part.index}`)===part.id),'base chunk identities remain stable');
  assert(closed.parts.filter(part=>part.kind==='overlay').every(part=>prior.get(`overlay:${part.index}`)!==part.id),'only changed overlay pages receive new ids');
  assert.deepEqual(save('day-close unchanged').uploaded,[],'an unchanged day close uploads nothing');
  assert.throws(()=>TX.execute(state,{label:'day-close rollback',scope:['fleet'],apply:()=>{write(0,'flightHours',999);throw new Error('rollback');}}),/rollback/);
  assert.deepEqual(save('day-close after rollback').uploaded,[],'rollback restores saved overlay bytes without a duplicate upload');
  return {rows:state.fleet.length,overlayBytes:closed.uploaded.reduce((sum,part)=>sum+part.bytes,0),baseBytes:state.fleet.rows.byteLength};
});
test('a single counter update changes only its overlay page',()=>{
  const before=save('single-counter baseline'),prior=new Map(before.parts.map(part=>[`${part.kind}:${part.index}`,part.id]));
  STORE.set(state.fleet,CHUNK+17,'flightHours',STORE.get(state.fleet,CHUNK+17,'flightHours')+0.25);
  const out=save('single-counter update');
  assert.deepEqual(out.uploaded.map(part=>`${part.kind}:${part.index}`),['overlay:1']);
  assert(out.parts.filter(part=>part.kind==='base').every(part=>prior.get(`base:${part.index}`)===part.id),'counter edit never renames its base page');
  return out.uploaded[0];
});
test('a counter that spills into extras also refreshes the base page and restores exactly',()=>{
  const fleet=STORE.fromAssets([{id:'OVERLAY-SPILL-001',assetMode:'air',phase:'idle',flightHours:8,flightCycles:2,nextCheckHours:600}],{at:0}),local={saveVersion:'3.0.0',fleet};
  const first=CODEC.serializeChunked(local),known=new Set(first.chunks.map(chunk=>chunk.id)),vault=new Map(first.chunks.filter(chunk=>chunk.data).map(chunk=>[chunk.id,chunk.data]));
  const save=()=>{
    const out=CODEC.serializeChunked(local,{knownChunkIds:known}),uploaded=out.chunks.filter(chunk=>chunk.data&&!known.has(chunk.id));
    for(const chunk of uploaded){vault.set(chunk.id,chunk.data);known.add(chunk.id);}
    const restored=CODEC.deserialize(out.text,{resolveChunk:id=>vault.get(id)});
    assert.deepEqual(new Uint8Array(restored.fleet.rows),new Uint8Array(fleet.rows));
    assert.equal(STORE.get(restored.fleet,0,'flightHours'),STORE.get(fleet,0,'flightHours'));
    return uploaded.map(chunk=>`${chunk.kind}:${chunk.index}`);
  };
  STORE.set(fleet,0,'flightHours',0.1);assert.deepEqual(save(),['base:0','overlay:0'],'EXTRAS flag and overlay presence both change');
  STORE.set(fleet,0,'flightHours',9);assert.deepEqual(save(),['base:0','overlay:0'],'removing the last extra restores the exact base row');
  return {spillAndRecoveryPages:2,restoredHours:STORE.get(fleet,0,'flightHours')};
});
test('replacing a row refreshes its base and counter pages together',()=>{
  const before=save('replace baseline'),prior=new Map(before.parts.map(part=>[`${part.kind}:${part.index}`,part.id])),index=CHUNK+21,row=STORE.materialize(state.fleet,index);
  row.name=`${row.name} revised`;row.fuel=(Number(STORE.get(state.fleet,index,'fuel'))||0)+1;row.flightHours=Number(row.flightHours||0)+1;
  STORE.replace(state.fleet,index,row);
  const out=save('replace row'),changed=out.uploaded.map(part=>`${part.kind}:${part.index}`);
  assert.deepEqual(changed,['base:1','overlay:1']);
  assert(out.parts.filter(part=>part.kind==='base'&&part.index!==1).every(part=>prior.get(`base:${part.index}`)===part.id));
  assert(out.parts.filter(part=>part.kind==='overlay'&&part.index!==1).every(part=>prior.get(`overlay:${part.index}`)===part.id));
  return {index,pages:changed};
});
test('engine advance, rollbacks, column writes, growth and compaction keep the round trip exact',()=>{
  EVENTS.advance(state.fleet,{from:0,to:4200,context:context(0),resolveRoute,order:'sweep'});state.simSeconds=4200;save('advance');
  assert.throws(()=>TX.execute(state,{label:'rollback',scope:['fleet'],apply:()=>{STORE.set(state.fleet,3,'fuel',1);save('inside transaction');throw new Error('fail');}}),/fail/);save('after rollback');
  TX.execute(state,{label:'column',scope:['fleet'],apply:()=>{STORE.rememberColumn(state.fleet,'condition');for(let r=0;r<state.fleet.length;r+=5)STORE.setSlot(state.fleet,'condition',r,77);}});const column=save('column');assert.equal(column.uploaded.length,Math.ceil(state.fleet.rows.byteLength/(CHUNK*STORE.STRIDE)),'a non-overlay column rewrite replaces each base chunk');assert(column.uploaded.every(row=>row.kind==='base'));
  const extra=[];for(let i=0;i<CHUNK/2;i++){const a=structuredClone(ordinary[i%ordinary.length]);a.id=`GROW-${i}`;extra.push(a);}
  TX.execute(state,{label:'grow',scope:['fleet'],apply:()=>{for(const a of extra)STORE.add(state.fleet,a);}});save('grown');
  TX.execute(state,{label:'remove',scope:['fleet'],apply:()=>{const rows=[];for(let r=0;r<state.fleet.length;r+=4)rows.push(r);STORE.removeMany(state.fleet,rows);}});STORE.compactRows(state.fleet);save('compacted');
  return {rows:state.fleet.length,vaultChunks:vault.size};
});
test('a write that bypasses the store is detected by the rotating base integrity check',()=>{
  save('baseline');const bytes=new Uint8Array(state.fleet.rows),at=CHUNK*STORE.STRIDE+77;bytes[at]^=0x5a;
  let renamed=0;for(let n=1;n<=4&&!renamed;n++){const before=CODEC.cacheStats().chunks.mismatches,out=save(`bypass ${n}`,{verifyExact:false});if(CODEC.cacheStats().chunks.mismatches>before){renamed=n;assert.deepEqual(out.uploaded.map(row=>`${row.kind}:${row.index}`),['base:1'],'only the corrupted base chunk gets a new id');save('after bypass detection');}}
  assert(renamed>=1,'the bypass is detected');bytes[at]^=0x5a;STORE.touch(state.fleet,CHUNK);save('repaired');return {detectedAfter:renamed};
});
test('a sparse mass-column write does not invalidate byte-identical chunks',()=>{
  save('sparse-column-baseline');const previous=CODEC.serializeChunked(state,{knownChunkIds:new Set(vault.keys())}),oldIds=new Map(previous.chunks.map(chunk=>[`${chunk.kind}:${chunk.index}`,chunk.id])),index=CHUNK+123,prior=STORE.get(state.fleet,index,'condition'),next=prior===71.25?72.25:71.25,checksumBefore=CODEC.cacheStats().chunks.checksumBytes;
  TX.execute(state,{label:'sparse-column',scope:['fleet'],apply:()=>STORE.columnWriter(state.fleet,['condition'])(index,'condition',next)});
  const out=save('sparse mass column'),changed=CODEC.serializeChunked(state,{knownChunkIds:new Set(vault.keys())}).chunks.filter(chunk=>chunk.id!==oldIds.get(`${chunk.kind}:${chunk.index}`)).map(chunk=>`${chunk.kind}:${chunk.index}`);
  assert.deepEqual(changed,['base:1'],'only the chunk with changed bytes receives a new id');assert.deepEqual(out.uploaded.map(row=>`${row.kind}:${row.index}`),['base:1'],'only that chunk is uploaded');
  const uploadedBytes=Math.min(CHUNK*STORE.STRIDE,state.fleet.rows.byteLength-CHUNK*STORE.STRIDE);
  const sparseChecksumBytes=CODEC.cacheStats().chunks.checksumBytes-checksumBefore;assert(sparseChecksumBytes<=3*CHUNK*STORE.STRIDE,'only the changed base chunk plus one rotating base/overlay integrity pair are checksummed');
  return {chunks:out.ids.length,totalFleetBytes:state.fleet.rows.byteLength,uploadedChunks:out.uploaded.length,uploadedBytes,sparseChecksumBytes,avoidedBytes:state.fleet.rows.byteLength-uploadedBytes};
});
test('a store decoded from a chunked save adopts its ids: a new session uploads only what it changes',()=>{
  const out=CODEC.serializeChunked(state),tree=JSON.parse(out.text),marker=tree.fleet.rows,loaded=CODEC.decodeState(tree,{resolveChunk:id=>vault.get(id)});
  assert.equal(CODEC.adoptChunkIds(loaded.fleet,marker),true);
  const same=CODEC.serializeChunked(loaded);assert.deepEqual(same.chunks.map(c=>c.id),out.chunks.map(c=>c.id),'unchanged chunks keep the ids they were loaded from');
  STORE.set(loaded.fleet,5,'fuel',3.25);const changed=CODEC.serializeChunked(loaded),priorIds=new Map(out.chunks.map(c=>[`${c.kind}:${c.index}`,c.id])),renamed=changed.chunks.filter(c=>c.id!==priorIds.get(`${c.kind}:${c.index}`)).map(c=>`${c.kind}:${c.index}`);
  assert.deepEqual(renamed,['base:0'],'only the written base chunk is renamed');
  assert.equal(CODEC.adoptChunkIds(loaded.fleet,{...marker,chunks:marker.chunks.slice(1)}),false,'a manifest of another shape is not adopted');
  return {chunks:out.chunks.length,renamed};
});
test('legacy chunks-v1 row pages still load and migrate to overlays',()=>{
  const tree=JSON.parse(CODEC.serialize(state)),raw=new Uint8Array(state.fleet.rows),chunkBytes=CHUNK*STORE.STRIDE,count=Math.ceil(raw.length/chunkBytes),ids=Array.from({length:count},(_,index)=>`legacy.${index}`),legacy=new Map();
  for(let index=0;index<count;index++){const start=index*chunkBytes;legacy.set(ids[index],raw.slice(start,Math.min(raw.length,start+chunkBytes)));}
  tree.fleet.rows={$ghBinary:'chunks-v1',byteLength:raw.length,chunkBytes,chunks:ids};
  const loaded=CODEC.deserialize(JSON.stringify(tree),{resolveChunk:id=>legacy.get(id)});
  assert.deepEqual(new Uint8Array(loaded.fleet.rows),raw,'the previous one-page format decodes byte-for-byte');
  assert.equal(CODEC.adoptChunkIds(loaded.fleet,tree.fleet.rows),true,'legacy page IDs can seed the new cache');
  const upgraded=CODEC.serializeChunked(loaded,{knownChunkIds:new Set(ids)}),marker=JSON.parse(upgraded.text).fleet.rows;
  assert.equal(marker.overlay.version,1);assert.deepEqual(marker.baseChunks,ids,'legacy base pages remain readable beneath the overlay');
  const pages=new Map([...legacy,...upgraded.chunks.filter(chunk=>chunk.data).map(chunk=>[chunk.id,chunk.data])]);
  const reopened=CODEC.deserialize(upgraded.text,{resolveChunk:id=>pages.get(id)});
  assert.deepEqual(new Uint8Array(reopened.fleet.rows),raw,'the migrated overlay format restores the exact legacy rows');
  return {legacyPages:ids.length,upgradedPages:marker.chunks.length};
});
test('missing, short, extra and malformed chunks are corrupt saves',()=>{
  const out=CODEC.serializeChunked(state),tree=JSON.parse(out.text),errors={};
  const attempt=(label,mutate,resolve=id=>vault.get(id))=>{const copy=structuredClone(tree);mutate(copy.fleet.rows);try{CODEC.decodeState(copy,{resolveChunk:resolve});errors[label]='accepted';}catch(error){errors[label]=error.message;}};
  attempt('no resolver',()=>{},null);
  attempt('missing chunk',()=>{},id=>id===out.chunks[1].id?undefined:vault.get(id));
  attempt('short chunk',()=>{},id=>id===out.chunks[0].id?vault.get(id).subarray(1):vault.get(id));
  attempt('resolver throws',()=>{},()=>{throw new Error('io');});
  attempt('wrong count',rows=>rows.chunks.pop());
  attempt('bad normalization metadata',rows=>{rows.baseNormalized=[];});
  attempt('bad id',rows=>{rows.chunks[0]='../../etc/passwd';});
  attempt('bad length',rows=>{rows.byteLength=-1;});
  assert.deepEqual(errors,{'no resolver':'state-codec-corrupt:binary-chunks-unresolved','missing chunk':'state-codec-corrupt:binary-chunk-missing','short chunk':'state-codec-corrupt:binary-chunk-length','resolver throws':'state-codec-corrupt:binary-chunk-missing','wrong count':'state-codec-corrupt:binary-overlay','bad normalization metadata':'state-codec-corrupt:binary-overlay','bad id':'state-codec-corrupt:binary-overlay-chunks','bad length':'state-codec-corrupt:binary-chunks'});
  return errors;
});

const passed=results.filter(r=>r.ok).length;
console.log(JSON.stringify({suite:'build358-fleet-chunk-manifest',passed,total:results.length,results},null,2));
if(passed!==results.length)process.exitCode=1;
