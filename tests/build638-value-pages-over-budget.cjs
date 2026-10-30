'use strict';
// iPhone diagnostic (630,000 assets, build 362): every durable save carried 5.6 MB of text, 2.2 MB of it the fleet's.
// The value table had grown to 9.8 MB, past the codec's 8 MB of kept page text, and every page past that budget was
// written inline again by every save. A sealed page past the budget now keeps its chunk without its text (its slots are
// compared instead) and its text is made again only when the vault lacks the chunk. Proven on the real transaction,
// fleet store and codec owners (a table of about 10.5 MB, GH_NATIVE_VALUE_CHUNKS=1, a stand-in vault), against the
// source before (b87885e) in its own realm:
//  1. past the budget, every page is a vault chunk (the source before left pages inline), and the kept text stays
//     within the budget;
//  2. a save with nothing changed writes no page's text again and uploads nothing;
//  3. a value replaced through the store writes and uploads exactly its page;
//  4. a vault that lost every chunk gets each page again from the text made of its sealed slots: the same bytes, and the
//     save decodes to the live table;
//  5. without a sealer (no way to compare a page's slots) a page past the budget stays inline, as before.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm'),{execFileSync}=require('node:child_process');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..'),PREVIOUS='b87885e';
const {harness}=require(path.join(ROOT,'tests/helpers/core-harness'));
function world(sealer=true){
  const {s}=harness(sealer?['transaction-core','state-codec-core']:['state-codec-core']),S=s.GH_FLEET_STORE,C=s.GH_STATE_CODEC;s.GH_NATIVE_VALUE_CHUNKS=1;
  if(!sealer)delete s.GH_TRANSACTION_CORE;
  let chars=0;const J=vm.runInContext('JSON',s),stringify=J.stringify;J.stringify=function(...args){const out=stringify.apply(this,args);if(typeof out==='string')chars+=out.length;return out;};
  const fleet=S.create(4),state={saveVersion:'3.0.0',saveRevision:1,resetEpoch:0,simSeconds:0,fleet};
  for(let i=0;i<4;i++)S.add(fleet,{id:'VALUE-'+i,type:'road',name:'Value '+i,phase:'idle',fuel:100,condition:100,progress:0});
  for(let i=0;i<10240;i++)S.intern(fleet,{id:'INTERN-'+i,note:'تشخيص الحركة '.repeat(70),point:[i%90,i%180],amount:i*.25,nested:{phase:'moving',values:[null,true,'"\\\n',i]}});
  const vault=new Map();
  const save=(known=new Set(vault.keys()))=>{chars=0;const out=C.serializeChunked(state,{knownChunkIds:known}),stringified=chars,uploads=[];
    for(const chunk of out.chunks)if(!known.has(chunk.id)){const bytes=chunk.data||new TextEncoder().encode(chunk.text);vault.set(chunk.id,Buffer.from(bytes));uploads.push(chunk.id);}
    const tree=JSON.parse(out.text),parts=Array.isArray(tree.fleet.values)?null:tree.fleet.values.parts;
    return {out,tree,stringified,uploads,valueUploads:uploads.filter(id=>id.includes('.v.')).length,inlineParts:parts?parts.filter(Array.isArray).length:Infinity,pages:parts?parts.length:0,textChars:out.text.length,stats:C.valueChunkStats()};};
  const decodes=out=>{const D=harness(['transaction-core','state-codec-core']).s.GH_STATE_CODEC;return JSON.stringify(D.deserialize(out.text,{resolveChunk:id=>vault.get(id)}).fleet.values)===JSON.stringify(state.fleet.values);};
  return {S,C,fleet,state,save,decodes,tableChars:JSON.stringify(fleet.values).length};
}
if(process.env.GH_B638_CHILD==='1'){const w=world(),first=w.save();process.stdout.write(JSON.stringify({inlineParts:first.inlineParts,pages:first.pages,textChars:first.textChars}));return;}
const w=world();
// 1.
const first=w.save();
assert.ok(w.tableChars>w.C.valueChunkStats().limitChars,`the table (${w.tableChars} characters) is past the kept-text budget`);
assert.equal(first.inlineParts,0,'1: every page is a vault chunk');assert.ok(first.pages>=40);
assert.ok(first.stats.chars<=first.stats.limitChars,'1: the kept text stays within its budget');assert.ok(first.stats.textless>0,'1: pages past the budget are kept without their text');
assert.ok(w.decodes(first.out),'1: the save decodes to the live table');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'gh-b638-'));let before;
try{
  fs.cpSync(path.join(ROOT,'WebApp'),path.join(tmp,'WebApp'),{recursive:true});fs.cpSync(path.join(ROOT,'tests'),path.join(tmp,'tests'),{recursive:true});
  fs.writeFileSync(path.join(tmp,'WebApp','state-codec-core.js'),execFileSync('git',['-C',process.env.GH_B638_GIT_DIR||ROOT,'show',`${PREVIOUS}:WebApp/state-codec-core.js`],{encoding:'utf8',maxBuffer:32*1024*1024}));
  before=JSON.parse(execFileSync(process.execPath,[__filename],{env:{...process.env,GH_TEST_SOURCE_DIR:tmp,GH_B638_CHILD:'1'},encoding:'utf8',maxBuffer:64*1024*1024}));
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
assert.ok(before.inlineParts>0,`1: the source before left ${before.inlineParts} pages inline`);
// 2.
const unchanged=w.save();
assert.equal(unchanged.uploads.length,0,'2: nothing is uploaded');assert.equal(unchanged.stats.written-first.stats.written,0,'2: no page text is written again');assert.equal(unchanged.out.text,first.out.text,'2: the same save text');
// 3.
w.S.applyValueChanges(w.fleet,{length:w.fleet.values.length,changes:[[9000,{...w.fleet.values[9000],note:'قيمة جديدة '.repeat(70)}]]});
const one=w.save();
assert.equal(one.valueUploads,1,'3: exactly the changed page is uploaded');assert.equal(one.stats.written-unchanged.stats.written,1,'3: exactly its page is written');assert.ok(w.decodes(one.out));
// 4.
const remadeBefore=w.C.valueChunkStats().remade,lost=w.save(new Set());
assert.equal(lost.valueUploads,lost.pages,'4: every page is uploaded again');assert.ok(w.C.valueChunkStats().remade-remadeBefore>0,'4: pages kept without text are made again from their slots');
for(const chunk of lost.out.chunks.filter(c=>c.id.includes('.v.')))assert.equal(Buffer.byteLength(chunk.text),chunk.byteLength,'4: the same byte length as written');
assert.ok(w.decodes(lost.out),'4: the save decodes to the live table');
// 5.
const plain=world(false),unsealed=plain.save();
assert.ok(unsealed.inlineParts>0,'5: without a sealer, pages past the budget stay inline');assert.ok(plain.decodes(unsealed.out));
console.log(JSON.stringify({suite:'build638-value-pages-over-budget',ok:true,tableChars:w.tableChars,pages:first.pages,saveTextChars:{previous:before.textChars,current:first.textChars},inlinePages:{previous:before.inlineParts,current:first.inlineParts},textless:first.stats.textless,unchangedSaveChars:unchanged.stringified}));
