'use strict';
// iPhone diagnostic (build 95): every save listed the fleet's extras (75,963 rows, 2.9 MB) twice, compared each row and
// encoded them all afresh, about 2 MB of it inline in the save envelope. The fleet store replaces a row's extras object
// on every write (it never edits one in place) and now moves extrasVersion on every write of the container; the codec
// seals the rows before it writes their text, keeps segments of about 1,024 rows (each its own chunk), and reuses its
// reading of an unchanged container. Proven on the real transaction, fleet store and codec owners (6,000 rows with
// extras, a stand-in vault), against the source before (e2160b5, from its own tree), each in its own process:
//  1. a save with nothing changed writes no extras text, reuses the container's reading and uploads nothing; the extras
//     leave the envelope (the previous source wrote them all, inline, on every save);
//  2. one row's extras written through the store (set) writes and uploads exactly one segment;
//  3. every save decodes (in another session) to the live state, and to what the previous source's save decodes to;
//  4. an edit in place of a saved row now throws (the previous source saved it; the store never does it), and the next
//     save is unchanged; a write the fleet's journal rolls back (as app.js registers it) writes and uploads nothing;
//  5. a reload adopts every extras segment (it uploads no more than the previous source's reload), writes each once,
//     then none;
//  6. no code but the store's three helpers writes store.extras (the version cannot be skipped).
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..'),PREVIOUS='e2160b5',ROWS=6000;
if(process.argv[2]==='--measure'){
  process.env.GH_TEST_SOURCE_DIR=process.argv[3];
  const vm=require('node:vm'),{harness}=require(path.join(process.argv[3],'tests/helpers/core-harness'));
  const session=()=>{const {s}=harness(['transaction-core','state-codec-core']),J=vm.runInContext('JSON',s),raw=J.stringify,meter={chars:0};J.stringify=function(...args){const o=raw.apply(this,args);if(typeof o==='string')meter.chars+=o.length;return o;};// The fleet's journal, as app.js registers it: a rolled-back write is undone by the store, not by a copy of the state.
    const F=s.GH_FLEET_DATA;s.GH_TRANSACTION_CORE.registerJournaledRoot('fleet',{begin:target=>F.beginJournal(target),commit:(target,_root,journal)=>F.commitJournal(target,journal),rollback:(target,_root,journal)=>F.rollbackJournal(target,journal),revision:(_target,root)=>Number(root?.revision)||0});
    return {s,S:s.GH_FLEET_STORE,C:s.GH_STATE_CODEC,meter};};
  const main=session(),D=session().C,{S,C,meter}=main;
  const fleet=S.create(ROWS),state={saveVersion:'3.0.0',saveRevision:1,resetEpoch:0,simSeconds:0,fleet,finance:{note:'x'}};
  for(let i=0;i<ROWS;i++)S.add(fleet,{id:'X-'+i,type:['air','sea','road'][i%3],name:'Row '+i,phase:'idle',fuel:100,condition:100,progress:0,maintenanceNote:'صيانة دورية '+(i%17),serviceHistory:[{day:i%40,kind:'check'}]});
  assert.ok(Object.keys(fleet.extras).length===ROWS,'every row has extras');
  const vault=new Map(),out={saves:[]},nonceOf=r=>String(r.chunks.find(c=>/\.[a-z]\./.test(c.id))?.id||'').split('.')[0];
  const save=(target,label,codec=C,m=meter,decoder=D)=>{m.chars=0;const result=codec.serializeChunked(target,{knownChunkIds:new Set(vault.keys())}),chars=m.chars,uploads=[];
    for(const chunk of result.chunks)if(!vault.has(chunk.id)){vault.set(chunk.id,Buffer.from(chunk.data||new TextEncoder().encode(chunk.text)));uploads.push(chunk.id);}
    const decoded=decoder.deserialize(result.text,{resolveChunk:id=>vault.get(id)}),json=decoder.serialize(decoded);
    const row={label,chars,uploads:uploads.length,envelope:result.text.length,exact:json===decoder.serialize(target),json,extras:codec.extrasStats?.()||null};out.saves.push(row);return row;};
  save(state,'first');save(state,'unchanged');state.finance.note='y';save(state,'finance-only');
  S.set(fleet,4321,'maintenanceNote','صيانة شاملة');save(state,'one-row');
  // 4.
  try{fleet.extras[17].maintenanceNote='edited in place';out.inPlace='accepted';}catch(error){out.inPlace=error?.name==='TypeError'?'refused':String(error);}
  save(state,'after-in-place');
  {const T=main.s.GH_TRANSACTION_CORE;try{T.execute(state,{label:'qa-rolled-back',apply:()=>{S.set(fleet,99,'maintenanceNote','rolled back');throw new Error('qa-rollback');}});}catch{}save(state,'after-rollback');}
  // 5. A fresh session reloads the last save.
  {const last=C.serializeChunked(state,{knownChunkIds:new Set(vault.keys())}).text,fresh=session(),loaded=fresh.C.deserialize(last,{resolveChunk:id=>vault.get(id)});
   out.reload=[save(loaded,'reload-first',fresh.C,fresh.meter),save(loaded,'reload-second',fresh.C,fresh.meter)].map(({label,chars,uploads,exact})=>({label,chars,uploads,exact}));}
  for(const row of out.saves)row.json=require('node:crypto').createHash('sha256').update(row.json).digest('hex');
  process.stdout.write(JSON.stringify(out));
  return;
}
const measure=tree=>JSON.parse(execFileSync(process.execPath,[__filename,'--measure',tree],{encoding:'utf8',maxBuffer:1<<28}));
const before=fs.mkdtempSync(path.join(os.tmpdir(),'gh-b587-'));
try{
  const archive=path.join(before,'previous.tar');execFileSync('git',['-C',process.env.GH_B587_GIT_DIR||ROOT,'archive','-o',archive,PREVIOUS,'WebApp','tests/helpers']);execFileSync('tar',['-xf',archive,'-C',before]);fs.rmSync(archive);
  const old=measure(before),now=measure(ROOT),at=(run,label)=>run.saves.find(row=>row.label===label),first=at(now,'first');
  // 1.
  for(const label of ['unchanged','finance-only']){const n=at(now,label),o=at(old,label);
    assert.ok(o.chars>first.chars*.5,`the previous source writes the extras again (${label}: ${o.chars} characters)`);
    assert.ok(n.chars<first.chars*.02,`1: ${label}: no extras text written (${n.chars} characters, previously ${o.chars})`);
    assert.equal(n.uploads,0,`1: ${label}: nothing uploaded`);
    assert.ok(n.envelope<o.envelope/4,`1: ${label}: the extras leave the envelope (${n.envelope} characters, previously ${o.envelope})`);}
  assert.ok(at(now,'unchanged').extras.layoutReused>at(now,'first').extras.layoutReused,'1: the unchanged container\'s reading is reused');
  // 2.
  {const n=at(now,'one-row');assert.equal(n.uploads,1,`2: one row's write uploads one segment (${n.uploads})`);assert.ok(n.chars<first.chars/3,`2: and writes about one segment of about 1,024 of the 6,000 rows (${n.chars} characters)`);}
  // 3.
  for(const label of ['first','unchanged','finance-only','one-row']){assert.equal(at(now,label).exact,true,`3: ${label} decodes to the live state`);assert.equal(at(now,label).json,at(old,label).json,`3: ${label}: what the previous source's save decodes to`);}
  // 4.
  assert.equal(old.inPlace,'accepted');assert.equal(now.inPlace,'refused','4: an edit in place of a saved row throws');
  {const n=at(now,'after-in-place');assert.equal(n.uploads,0);assert.equal(n.json,at(now,'one-row').json,'4: the next save is unchanged');assert.equal(n.exact,true);}
  {const n=at(now,'after-rollback');assert.equal(n.uploads,0,'4: a rolled-back write uploads nothing');assert.ok(n.chars<first.chars*.02,`4: and writes no extras (${n.chars})`);assert.equal(n.exact,true);}
  // 5.
  {const [r1,r2]=now.reload;assert.ok(r1.uploads<=old.reload[0].uploads,`5: a reload adopts every extras segment (${r1.uploads} uploads, the previous source ${old.reload[0].uploads})`);assert.ok(r1.chars>first.chars*.5,'5: writes each once');assert.ok(r2.chars<first.chars*.02,`5: then none (${r2.chars})`);assert.equal(r2.uploads,0);assert.ok(r1.exact&&r2.exact);}
  // 6.
  {const webapp=path.join(ROOT,'WebApp'),store=fs.readFileSync(path.join(webapp,'fleet-store-core.js'),'utf8'),write=/delete\s+store\.extras\[|store\.extras\s*=[^=]|store\.extras\[[^\]]+\]\s*=[^=]/g;
   const outside=store.split('\n').filter(line=>write.test(line)&&!/function (putExtras|dropExtras|replaceExtras)\(/.test(line));write.lastIndex=0;
   assert.deepEqual(outside,[],'6: the store writes store.extras only in its three helpers');
   const foreign=fs.readdirSync(webapp).filter(name=>name.endsWith('.js')&&name!=='fleet-store-core.js').filter(name=>/(\bstore|\bfleet)\.extras\s*(\[[^\]]+\])?\s*=[^=]|delete\s+[\w.]*(store|fleet)\.extras\[/.test(fs.readFileSync(path.join(webapp,name),'utf8')));
   assert.deepEqual(foreign,[],'6: no other code writes a fleet store\'s extras');}
  console.log(JSON.stringify({suite:'build587-fleet-extras-reuse',ok:true,rows:ROWS,firstSaveChars:first.chars,unchangedSave:{previousChars:at(old,'unchanged').chars,currentChars:at(now,'unchanged').chars,previousEnvelope:at(old,'unchanged').envelope,currentEnvelope:at(now,'unchanged').envelope},oneRow:{uploads:at(now,'one-row').uploads,chars:at(now,'one-row').chars}}));
}finally{fs.rmSync(before,{recursive:true,force:true});}
