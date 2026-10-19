'use strict';
// iPhone diagnostic DX-1792378248326: a durable command's copy ran 4 ms per frame and then waited a frame (cloneMs
// 111-506 ms for 29-131 ms of work). A durable command holds the lifecycle lock, so its copy now takes up to 8 ms per
// frame; ordinary background saves keep 4 ms. Proven with a controlled clock, against the previous transaction-core.js:
//  1. the same draft bytes and the same commit; the published state equals the applied draft;
//  2. about half the host yields of the previous 4 ms copy (each yield is one waited frame);
//  3. no copy slice exceeds the 8 ms budget by more than one copy step; background saves keep the 4 ms default.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {harness}=require(path.join(ROOT,'tests/helpers/core-harness'));
async function run(){
  const {s}=harness(['transaction-core']);let now=0;s.performance={now:()=>(now+=.05)};
  const t=s.GH_TRANSACTION_CORE,live={saveRevision:7,cash:1,rows:Array.from({length:20000},(_,i)=>({id:'R'+i,value:i,note:'n'+(i%97)}))};
  let yields=0,maxSlice=0,persisted=null;
  const out=await t.executeDurable(live,{yieldToHost:async()=>{yields++;},apply:draft=>{draft.cash=2;draft.rows[5].value=-5;},persist:async draft=>{persisted=JSON.stringify(draft);return {ok:true};}});
  const timing=t.telemetry().lastDurable;maxSlice=timing.cloneMaxSliceMs;
  return {committed:out.committed===true,cloneYields:timing.cloneYields,maxSlice,persisted,live:JSON.stringify(live),budget:t.DURABLE_CLONE_SLICE_MS??null};
}
if(process.env.GH_CLONE_BUDGET_CHILD==='1'){run().then(r=>process.stdout.write(JSON.stringify(r)));return;}
(async()=>{
  const current=await run();
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'madar-clone-budget-old-'));let old;
  try{
    fs.cpSync(path.join(ROOT,'WebApp'),path.join(tmp,'WebApp'),{recursive:true});fs.cpSync(path.join(ROOT,'tests'),path.join(tmp,'tests'),{recursive:true});
    const previous=execFileSync('git',['-C',process.env.GH_CLONE_BUDGET_GIT_DIR||ROOT,'show','eb4a8b8:WebApp/transaction-core.js'],{encoding:'utf8',maxBuffer:32*1024*1024});
    assert.ok(!previous.includes('DURABLE_CLONE_SLICE_MS'),'the baseline copies 4 ms per frame');
    fs.writeFileSync(path.join(tmp,'WebApp','transaction-core.js'),previous);
    old=JSON.parse(execFileSync(process.execPath,[__filename],{env:{...process.env,GH_TEST_SOURCE_DIR:tmp,GH_CLONE_BUDGET_CHILD:'1'},encoding:'utf8',maxBuffer:64*1024*1024}));
  }finally{fs.rmSync(tmp,{recursive:true,force:true});}
  assert.equal(current.budget,8);assert.equal(current.committed,true);assert.equal(old.committed,true);
  assert.equal(current.persisted,old.persisted,'the same draft bytes are persisted');assert.equal(current.live,old.live,'the same state is published');
  assert.ok(JSON.parse(current.live).cash===2&&JSON.parse(current.live).rows[5].value===-5,'the applied draft is published');
  assert.ok(current.cloneYields>0&&old.cloneYields>0,'both copies are cooperative');
  assert.ok(current.cloneYields<=Math.ceil(old.cloneYields*.6),`about half the waited frames: ${current.cloneYields} vs ${old.cloneYields}`);
  assert.ok(current.maxSlice<=8.5,`a copy slice stays within the budget: ${current.maxSlice}`);
  const persistence=fs.readFileSync(path.join(ROOT,'WebApp/persistence-core.js'),'utf8');
  assert.ok(/tx\.deepCloneInSlices\(state,\{shareJournaledRoots:true,yieldToHost:/.test(persistence),'background sliced saves keep the 4 ms default');
  const app=fs.readFileSync(path.join(ROOT,'WebApp/app.js'),'utf8');
  assert.match(app,/deepCloneInSlices\(state,\{shareJournaledRoots:true,budgetMs:transactionCore\.DURABLE_CLONE_SLICE_MS\|\|4,/,'composite durable commands use the same budget');
  console.log(JSON.stringify({suite:'build504-durable-clone-budget',ok:true,yields:{previous:old.cloneYields,current:current.cloneYields},maxSliceMs:current.maxSlice}));
})().catch(error=>{console.error(error);process.exitCode=1;});
