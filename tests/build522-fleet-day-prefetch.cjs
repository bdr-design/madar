'use strict';
// iPhone diagnostic DX-1792378248326 (980,000 assets): the day close's first wait was the worker's day pass (1,576 ms),
// asked only when realism-close began, after 228-450 ms of financial stages that do not query the worker. The app now
// asks as the financial day begins (GH_REALISM.prefetchFleetDay) and realism-close reads that answer if it still
// describes the same staged state, simulation time, context and fleet. Proven with the real close and the staged
// provider of build372-fleet-day-worker, each case against a close without the worker (byte-for-byte state):
//  1. asked early, the answer is used: one fleetDay request, and it precedes the realism stages;
//  2. a fleet write after the early request: the answer is not used, the pass is asked again, the state is exact;
//  3. a context change (the economy realism passes to the worker): asked again, exact;
//  4. a close that aborts after its early request leaves nothing behind: the next close asks again, exact;
//  5. outside a staged transaction nothing is asked early.
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||require('node:path').resolve(__dirname,'..');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {scenario}=require('./helpers/business-scenario');
const ROOT=process.env.GH_TEST_SOURCE_DIR,DAY_SOURCE=fs.readFileSync(path.join(ROOT,'WebApp','fleet-day-core.js'),'utf8'),QUERY_SOURCE=fs.readFileSync(path.join(ROOT,'WebApp','fleet-query-core.js'),'utf8');
assert.match(fs.readFileSync(path.join(ROOT,'WebApp','app.js'),'utf8'),/state\.lastFinancialDay\+\+;financialDaysProcessed\+\+;\n\s*\/\/[^\n]*\n\s*window\.GH_REALISM\?\.prefetchFleetDay\?\.\(state\);/,'the financial day asks for the pass as it begins');
function setup(){
  const sc=scenario(),{s,state}=sc,F=s.GH_FLEET_DATA;
  vm.runInContext(DAY_SOURCE,s,{filename:'fleet-day-core.js'});vm.runInContext(QUERY_SOURCE,s,{filename:'fleet-query-core.js'});
  const template={id:'',name:'',type:'air',assetMode:'air',assetClass:'aircraft',ownerCompanyId:'air',companyId:'air',ownership:'owned',purchasePrice:45000000,year:2021,baseFacility:'B1',phase:'turnaround',condition:100,fuel:100,progress:0,crewBlocked:false,releaseExclusiveRouteOnArrival:false};
  const assets=Array.from({length:2305},(_,index)=>({...structuredClone(template),id:`DAY-PREFETCH-${String(index).padStart(5,'0')}`,name:`Day prefetch ${index}`,phase:index%4===0?'moving':'turnaround',condition:55+(index%46)}));
  state.fleet=s.GH_FLEET_STORE.fromAssets(assets,{at:state.simSeconds});delete state.assets;
  const day=Math.floor((Number(state.simSeconds)||0)/86400)+1;state.simSeconds=day*86400;
  return {...sc,day,F};
}
function snapshot(s,state){
  const root={...state};delete root.fleet;
  const store=state.fleet,bytes=Buffer.from(new Uint8Array(store.rows,0,store.length*s.GH_FLEET_STORE.STRIDE));
  return {root:JSON.stringify(root),rows:bytes.toString('base64'),values:JSON.stringify(store.values),extras:JSON.stringify(store.extras),length:store.length,live:store.live,revision:store.revision};
}
// between: what happens after the early request and before realism (the financial stages), on the staged state.
const writeRow=(s,state)=>s.GH_FLEET_DATA.update(state,'DAY-PREFETCH-00007',{condition:61});
const changeEconomy=(s,state)=>{state.realism=state.realism||{};state.realism.economy={...(state.realism.economy||{}),airDemand:1.07};};
function plain(between){const {s,state,day}=setup();s.GH_FLEET_QUERY_PROVIDER=null;s.GH_TRANSACTION_CORE.beginStaged;between?.(s,state);s.GH_REALISM.onDay(state,day);return snapshot(s,state);}
async function close({between=null,early=true,abortFirst=false}={}){
  const {s,state,day,F}=setup(),TX=s.GH_TRANSACTION_CORE,requests=[];let pending=[];
  s.GH_FLEET_QUERY_PROVIDER=(target,name,params)=>{
    requests.push(name);const revision=target.fleet.revision,result=s.GH_FLEET_QUERY.run(name,target,F,params);
    return new Promise(resolve=>pending.push(()=>resolve({result,current:()=>target.fleet.revision===revision})));
  };
  let asked=null;
  const drive=async handle=>{const stages=[];for(let calls=0;calls<10000&&!handle.done;calls++){handle.step(-Infinity);stages.push(handle.stage);if(pending.length){const settle=pending.splice(0);for(const resolve of settle)resolve();}await new Promise(resolve=>setImmediate(resolve));}return stages;};
  if(abortFirst){const aborted=TX.beginStaged(state,{label:'qa-fleet-day-prefetch-abort',apply:function*(){s.GH_REALISM.prefetchFleetDay(state);yield 'finance-day.qa';throw new Error('qa-abort-before-realism');}});await drive(aborted);assert.ok(aborted.error,'the first close aborted');}
  const handle=TX.beginStaged(state,{label:'qa-fleet-day-prefetch',apply:function*(){
    if(early)asked=s.GH_REALISM.prefetchFleetDay(state);
    yield 'finance-day.qa';between?.(s,state);yield 'finance-day.qa';
    return yield* s.GH_REALISM.onDayStages(state,day);
  }}),stages=await drive(handle);
  assert.equal(handle.done,true);assert.equal(handle.error,null,String(handle.error?.stack||handle.error));assert.equal(handle.result.committed,true);
  return {snapshot:snapshot(s,state),requests,asked,stages};
}
(async()=>{
  const base=plain(),rows=[];
  // 1. Used.
  {const r=await close();assert.equal(r.asked,true,'the early request is sent in a staged close');assert.deepEqual(r.snapshot,base,'1: the close equals the close without the worker');
   assert.equal(r.requests.filter(name=>name==='fleetDay').length,1,'1: the day pass is asked once');assert.equal(r.requests[0],'fleetDay','1: and first, before the realism stages ask anything');
   assert.equal(r.stages.includes('realism.fleet-day'),false,'1: the main-thread scan did not run');rows.push(['used',r.requests.filter(n=>n==='fleetDay').length]);}
  // 2. A fleet write after the early request.
  {const expected=plain(writeRow),r=await close({between:writeRow});assert.deepEqual(r.snapshot,expected,'2: exact after a fleet write');assert.equal(r.requests.filter(name=>name==='fleetDay').length,2,'2: the stale answer is not used, the pass is asked again');assert.equal(r.stages.includes('realism.fleet-day'),false);rows.push(['stale fleet',2]);}
  // 3. A context change.
  {const expected=plain(changeEconomy),r=await close({between:changeEconomy});assert.deepEqual(r.snapshot,expected,'3: exact after a context change');assert.equal(r.requests.filter(name=>name==='fleetDay').length,2,'3: asked again for the new context');rows.push(['context',2]);}
  // 4. A close that aborts after its early request: the next close asks for its own pass and is exact.
  {const r=await close({abortFirst:true});assert.deepEqual(r.snapshot,base,'4: exact after an aborted close');assert.equal(r.requests.filter(name=>name==='fleetDay').length,2,'4: one early request per close');rows.push(['after abort',2]);}
  // 5. Outside a staged transaction nothing is asked early.
  {const {s,state}=setup(),requests=[];s.GH_FLEET_QUERY_PROVIDER=(t,name)=>{requests.push(name);return null;};assert.equal(s.GH_REALISM.prefetchFleetDay(state),false);assert.deepEqual(requests,[],'5: no request outside a staged transaction');rows.push(['unstaged',0]);}
  // Without an early request the close is unchanged (one request at realism).
  {const r=await close({early:false});assert.deepEqual(r.snapshot,base);assert.equal(r.requests.filter(name=>name==='fleetDay').length,1);rows.push(['no prefetch',1]);}
  console.log(JSON.stringify({suite:'build522-fleet-day-prefetch',ok:true,cases:rows}));
})().catch(error=>{console.error(error);process.exitCode=1;});
