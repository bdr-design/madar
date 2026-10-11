'use strict';
// The worker daily pass must replace the main fleet scan without changing any business result or row write. This gate
// runs the real close twice and supplies the worker result through the same staged provider used by the app.
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||require('node:path').resolve(__dirname,'..');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {scenario}=require('./helpers/business-scenario');
const ROOT=process.env.GH_TEST_SOURCE_DIR,DAY_SOURCE=fs.readFileSync(path.join(ROOT,'WebApp','fleet-day-core.js'),'utf8'),QUERY_SOURCE=fs.readFileSync(path.join(ROOT,'WebApp','fleet-query-core.js'),'utf8');

function setup(){
  const sc=scenario(),{s,state}=sc,F=s.GH_FLEET_DATA;
  vm.runInContext(DAY_SOURCE,s,{filename:'fleet-day-core.js'});vm.runInContext(QUERY_SOURCE,s,{filename:'fleet-query-core.js'});
  const template={id:'',name:'',type:'air',assetMode:'air',assetClass:'aircraft',ownerCompanyId:'air',companyId:'air',ownership:'owned',purchasePrice:45000000,year:2021,baseFacility:'B1',phase:'turnaround',condition:100,flightHours:0,flightCycles:0,nextCheckHours:600,specs:{capacity:180,capacityUnit:'مقعد',rangeKm:5500,speedKmh:820},lastTrip:{distanceKm:1300,revenue:90000,fuelCost:17000,crewCost:7000,maintReserve:4000},staffing:{mode:'automatic-fixed',ready:true,total:8,monthlyPayroll:120000}};
  const assets=Array.from({length:2305},(_,index)=>({...structuredClone(template),id:`DAY-WORKER-${String(index).padStart(5,'0')}`,name:`Day worker ${index}`,phase:index%4===0?'moving':'turnaround',condition:55+(index%46),purchasePrice:template.purchasePrice+index,flightHours:index%700,flightCycles:index%300}));
  state.fleet=s.GH_FLEET_STORE.fromAssets(assets,{at:state.simSeconds});delete state.assets;
  const day=Math.floor((Number(state.simSeconds)||0)/86400)+1;state.simSeconds=day*86400;
  return {...sc,day,F};
}
function snapshot(s,state){
  const root={...state};delete root.fleet;
  const store=state.fleet,bytes=Buffer.from(new Uint8Array(store.rows,0,store.length*s.GH_FLEET_STORE.STRIDE));
  return {root:JSON.stringify(root),rows:bytes.toString('base64'),values:JSON.stringify(store.values),extras:JSON.stringify(store.extras),length:store.length,live:store.live,revision:store.revision,structure:store.structure};
}
const plain=(()=>{const {s,state,day}=setup();s.GH_FLEET_QUERY_PROVIDER=null;s.GH_REALISM.onDay(state,day);return snapshot(s,state);})();

(async()=>{
  const {s,state,day,F}=setup(),TX=s.GH_TRANSACTION_CORE,requests=[];let pending=[];
  s.GH_FLEET_QUERY_PROVIDER=(target,name,params)=>{
    requests.push(name);const revision=target.fleet.revision,result=s.GH_FLEET_QUERY.run(name,target,F,params);
    return new Promise(resolve=>pending.push(()=>resolve({result,current:()=>target.fleet.revision===revision})));
  };
  const handle=TX.beginStaged(state,{label:'qa-fleet-day-worker',apply:function*(){return yield* s.GH_REALISM.onDayStages(state,day);}}),stages=[];
  for(let calls=0;calls<10000&&!handle.done;calls++){
    handle.step(-Infinity);stages.push(handle.stage);
    if(pending.length){const settle=pending.splice(0);for(const resolve of settle)resolve();}
    await new Promise(resolve=>setImmediate(resolve));
  }
  assert.equal(handle.done,true);assert.equal(handle.error,null,String(handle.error?.stack||handle.error));assert.equal(handle.result.committed,true);
  assert.deepEqual(snapshot(s,state),plain,'worker and original daily close states, fleet bytes and counters are byte-for-byte equal');
  assert.equal(requests[0],'fleetDay','the combined pass is the first fleet query');
  assert.equal(requests.filter(name=>name==='fleetDay').length,1,'the daily pass is computed once');
  assert.ok(stages.includes('realism.fleet-day-wait'),'the staged close yields while the worker computes');
  assert.ok(stages.includes('realism.fleet-day-apply'),'the returned column plan is applied in bounded slices');
  assert.equal(stages.includes('realism.fleet-day'),false,'the main-thread fleet scan did not run');
  console.log(JSON.stringify({suite:'build372-fleet-day-worker',rows:F.size(state),requests,waits:stages.filter(stage=>stage==='realism.fleet-day-wait').length,applySlices:stages.filter(stage=>stage==='realism.fleet-day-apply').length}));
  console.log('BUILD372_FLEET_DAY_WORKER_PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
