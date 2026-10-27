'use strict';
// iPhone diagnostic (build 95): every native save stringified the fleet's whole value table again (6.24 MB, 88 pages of
// 256 values) only to find the few pages that changed. The fleet store interns each value once and never edits it in
// place; the codec now seals a page's objects before it writes the page's text (GH_TRANSACTION_CORE.sealValue, as the
// first save seals the proof stores) and reuses the text of a page whose slots hold the same sealed values. Proven on the
// real transaction, fleet store and codec owners (a fleet of 19 rows and 4,099 interned values of Arabic text, numbers
// and nested objects, GH_NATIVE_VALUE_CHUNKS=1, a stand-in vault), on this source and on the source before (e2160b5,
// from its own tree), each in its own process, the save texts compared with the session's random chunk prefix masked:
//  1. a save with nothing changed writes no value page's text again (the previous source wrote all of them: millions of
//     characters) and uploads nothing, as before;
//  2. a value replaced through the store (applyValueChanges, as the worker's results arrive) writes exactly its page
//     and uploads exactly that page, as before;
//  3. every save text is the previous source's, and each decodes to the live state;
//  4. an edit in place of a saved value now throws (the previous source saved it; the store never does it) and the next
//     save is unchanged: nothing goes unsaved;
//  5. a reload adopts every page (0 uploads), writes each page's text once (its values were not sealed yet) and then
//     none; an oversized page stays inline and exact.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..'),PREVIOUS='e2160b5';
if(process.argv[2]==='--measure'){
  process.env.GH_TEST_SOURCE_DIR=process.argv[3];
  const {harness}=require(path.join(process.argv[3],'tests/helpers/core-harness'));
  const {s}=harness(['transaction-core','state-codec-core']),S=s.GH_FLEET_STORE,C=s.GH_STATE_CODEC;s.GH_NATIVE_VALUE_CHUNKS=1;
  let chars=0;const J=require('node:vm').runInContext('JSON',s),stringify=J.stringify;J.stringify=function(...args){const out=stringify.apply(this,args);if(typeof out==='string')chars+=out.length;return out;};
  const D=harness(['transaction-core','state-codec-core']).s.GH_STATE_CODEC;
  const fleet=S.create(19),state={saveVersion:'3.0.0',saveRevision:1,resetEpoch:0,simSeconds:0,fleet,companyFinance:{group:{accounts:[{balance:1}]}}};
  for(let i=0;i<19;i++)S.add(fleet,{id:'VALUE-'+i,type:['air','sea','road'][i%3],name:'Value '+i,phase:'idle',fuel:100,condition:100,progress:0});
  for(let i=0;i<4099;i++)S.intern(fleet,{id:'INTERN-'+i,note:'تشخيص الحركة '.repeat(30),point:[i%90,i%180],amount:i*.25,nested:{phase:'moving',values:[null,true,'"\\\n',i]}});
  const vault=new Map(),out={saves:[]};let nonce='';
  const save=(target,label)=>{chars=0;const result=C.serializeChunked(target,{knownChunkIds:new Set(vault.keys())}),stringified=chars,uploaded=[];
    for(const chunk of result.chunks)if(!vault.has(chunk.id)){const bytes=chunk.data||new TextEncoder().encode(chunk.text);vault.set(chunk.id,Buffer.from(bytes));uploaded.push(chunk.id);}
    nonce=nonce||String(result.chunks.find(c=>c.id.includes('.v.'))?.id||'').split('.')[0];
    // Decoded in another session: a decode adopts the pages it reads, which the saving session does only at load.
    const decoded=D.deserialize(result.text,{resolveChunk:id=>vault.get(id)}),exact=D.serialize(decoded)===D.serialize(target);
    const row={label,stringified,uploads:uploaded.length,uploadKinds:uploaded.map(id=>id.includes('.v.')?'v':'other'),text:nonce?result.text.split(nonce).join('N'):result.text,exact,stats:C.valueChunkStats()};out.saves.push(row);return {result,row};};
  save(state,'first');save(state,'unchanged');
  state.companyFinance.group.accounts[0].balance+=5;save(state,'finance-only');
  S.applyValueChanges(fleet,{length:fleet.values.length,changes:[[301,{...fleet.values[301],note:'قيمة جديدة '.repeat(30)}]]});save(state,'one-value');
  // 4.
  try{'use strict';fleet.values[302].nested.phase='turnaround';out.inPlace='accepted';}catch(error){out.inPlace=error?.name==='TypeError'?'refused':String(error);}
  save(state,'after-in-place');
  // 5. A fresh session reloads the last save.
  {const last=out.saves.at(-1);const h=harness(['transaction-core','state-codec-core']),s2=h.s,C2=s2.GH_STATE_CODEC;s2.GH_NATIVE_VALUE_CHUNKS=1;
   let c2=0;const J2=require('node:vm').runInContext('JSON',s2),st2=J2.stringify;J2.stringify=function(...args){const o=st2.apply(this,args);if(typeof o==='string')c2+=o.length;return o;};
   const text=C.serializeChunked(state,{knownChunkIds:new Set(vault.keys())}).text,loaded=C2.deserialize(text,{resolveChunk:id=>vault.get(id)});C2.adoptChunkIds?.(loaded.fleet,JSON.parse(text).fleet?.rows);
   const rows=[];for(const label of ['reload-first','reload-second']){c2=0;const r=C2.serializeChunked(loaded,{knownChunkIds:new Set(vault.keys())});let uploads=0;for(const chunk of r.chunks)if(!vault.has(chunk.id)){uploads++;vault.set(chunk.id,Buffer.from(chunk.data||new TextEncoder().encode(chunk.text)));}rows.push({label,stringified:c2,uploads,exact:C2.serialize(C2.deserialize(r.text,{resolveChunk:id=>vault.get(id)}))===C2.serialize(loaded)});}
   out.reload=rows;void last;}
  // 5. An oversized page stays inline and exact.
  {const big={saveVersion:'3.0.0',simSeconds:0,fleet:S.create(0)};big.fleet.values=Array.from({length:512},(_,i)=>i?{n:i}:null);big.fleet.values[1]={note:'x'.repeat(600000)};const r=C.serializeChunked(big),tree=JSON.parse(r.text);out.oversized={inline:Array.isArray(tree.fleet.values.parts?.[0])||Array.isArray(tree.fleet.values),exact:C.serialize(C.deserialize(r.text,{resolveChunk:id=>{const c=r.chunks.find(x=>x.id===id);return c?.data||new TextEncoder().encode(c?.text||'');}}))===C.serialize(big)};}
  process.stdout.write(JSON.stringify(out));
  return;
}
const measure=tree=>JSON.parse(execFileSync(process.execPath,[__filename,'--measure',tree],{encoding:'utf8',maxBuffer:1<<28}));
const before=fs.mkdtempSync(path.join(os.tmpdir(),'gh-b586-'));
try{
  const archive=path.join(before,'previous.tar');execFileSync('git',['-C',process.env.GH_B586_GIT_DIR||ROOT,'archive','-o',archive,PREVIOUS,'WebApp','tests/helpers']);execFileSync('tar',['-xf',archive,'-C',before]);fs.rmSync(archive);
  const old=measure(before),now=measure(ROOT),at=(run,label)=>run.saves.find(row=>row.label===label);
  const first=at(now,'first');assert.ok(first.stringified>1e6,'the first save writes the value table');
  // 1.
  for(const label of ['unchanged','finance-only']){const n=at(now,label),o=at(old,label);
    assert.ok(o.stringified>first.stringified*.9,`the previous source writes the value table again (${label}: ${o.stringified} characters)`);
    assert.ok(n.stringified<first.stringified*.01,`1: ${label}: no value page is written again (${n.stringified} characters, previously ${o.stringified})`);
    assert.equal(n.uploads,0,`1: ${label}: nothing uploaded`);assert.equal(o.uploads,0);}
  assert.equal(at(now,'finance-only').stats.written,at(now,'first').stats.written,'1: no page written since the first save');
  // 2.
  {const n=at(now,'one-value'),o=at(old,'one-value');assert.deepEqual(n.uploadKinds,['v'],'2: exactly the changed page is uploaded');assert.deepEqual(o.uploadKinds,['v']);
   assert.equal(n.stats.written-at(now,'finance-only').stats.written,1,'2: exactly its page is written');assert.ok(n.stringified<first.stringified*.05,`2: a page's worth (${n.stringified} characters)`);}
  // 3.
  for(const label of ['first','unchanged','finance-only','one-value']){assert.equal(at(now,label).text,at(old,label).text,`3: ${label}: the previous source's save text`);assert.equal(at(now,label).exact,true,`3: ${label} decodes to the live state`);}
  // 4.
  assert.equal(old.inPlace,'accepted','the previous source let a saved value be edited in place');assert.equal(now.inPlace,'refused','4: an edit in place of a saved value throws');
  {const n=at(now,'after-in-place');assert.equal(n.uploads,0,'4: the next save uploads nothing');assert.equal(n.text,at(now,'one-value').text,'4: and is unchanged');assert.equal(n.exact,true);}
  assert.equal(at(old,'after-in-place').uploads,1,'the previous source saved the edited page');
  // 5.
  {const [r1,r2]=now.reload;assert.equal(r1.uploads,0,'5: a reload adopts every page');assert.ok(r1.stringified>1e6,'5: and writes each page once');assert.ok(r2.stringified<first.stringified*.01,`5: then none (${r2.stringified} characters)`);assert.equal(r2.uploads,0);assert.ok(r1.exact&&r2.exact);}
  assert.deepEqual(now.oversized,{inline:true,exact:true},'5: an oversized page stays inline and exact');
  console.log(JSON.stringify({suite:'build586-value-pages-reuse',ok:true,firstSaveChars:first.stringified,unchangedSaveChars:{previous:at(old,'unchanged').stringified,current:at(now,'unchanged').stringified},oneValueChars:{previous:at(old,'one-value').stringified,current:at(now,'one-value').stringified},reload:now.reload.map(r=>r.stringified)}));
}finally{fs.rmSync(before,{recursive:true,force:true});}
