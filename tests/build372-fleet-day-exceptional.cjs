'use strict';
// One exact-storage exception must stay inside the worker result. This gate
// compares the whole daily close, fleet bytes, extras, revision and rollback;
// it also proves the already-computed maintenance counts replace the former
// market-share countByFields pass in both worker and local paths.
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||require('node:path').resolve(__dirname,'..');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {scenario}=require('./helpers/business-scenario');
const ROOT=process.env.GH_TEST_SOURCE_DIR,DAY_SOURCE=fs.readFileSync(path.join(ROOT,'WebApp','fleet-day-core.js'),'utf8'),QUERY_SOURCE=fs.readFileSync(path.join(ROOT,'WebApp','fleet-query-core.js'),'utf8');
const OWNER_FIELDS=['ownerCompanyId','companyId','company','assetMode','type'];

function setup(){
  const sc=scenario(),{s,state}=sc;vm.runInContext(DAY_SOURCE,s,{filename:'fleet-day-core.js'});vm.runInContext(QUERY_SOURCE,s,{filename:'fleet-query-core.js'});
  const template={id:'',name:'',type:'air',assetMode:'air',assetClass:'aircraft',ownerCompanyId:'air',companyId:'air',ownership:'owned',purchasePrice:45000000,year:2021,baseFacility:'B1',phase:'turnaround',condition:100,flightHours:0,flightCycles:0,nextCheckHours:600,specs:{capacity:180,capacityUnit:'مقعد',rangeKm:5500,speedKmh:820},lastTrip:{distanceKm:1300,revenue:90000,fuelCost:17000,crewCost:7000,maintReserve:4000},staffing:{mode:'automatic-fixed',ready:true,total:8,monthlyPayroll:120000}};
  const assets=Array.from({length:2305},(_,index)=>({...structuredClone(template),id:`DAY-EXCEPTION-${String(index).padStart(5,'0')}`,name:`Day exception ${index}`,phase:index%4===0?'moving':'turnaround',condition:55+(index%46),purchasePrice:template.purchasePrice+index,flightHours:index%700,flightCycles:index%300}));
  assets[4].flightHours=Math.fround(.1); // f32 input; +4 is not f32-exact
  assets[5].flightCycles=.1;             // starts and remains in extras
  assets[8].flightHours=Infinity;        // valid original numeric semantics
  assets[9].flightHours=NaN;             // Number(value)||0 becomes exact zero
  assets[10].flightHours=-0;             // || preserves the original +0 result
  assets[12].flightCycles=-Infinity;
  assets[2200].flightCycles=.1;          // a late exceptional row proves full preflight precedes every write
  state.fleet=s.GH_FLEET_STORE.fromAssets(assets,{at:state.simSeconds});delete state.assets;
  const day=Math.floor((Number(state.simSeconds)||0)/86400)+1;state.simSeconds=day*86400;
  const original=s.GH_FLEET_DATA;let ownerCountScans=0;
  s.GH_FLEET_DATA={...original,countByFields(target,fields,...rest){if(Array.isArray(fields)&&fields.length===OWNER_FIELDS.length&&fields.every((field,index)=>field===OWNER_FIELDS[index]))ownerCountScans++;return original.countByFields(target,fields,...rest);}};
  return {...sc,day,ownerCountScans:()=>ownerCountScans};
}
const numberReplacer=(_key,value)=>typeof value==='number'?(Number.isNaN(value)?{$number:'NaN'}:value===Infinity?{$number:'+Infinity'}:value===-Infinity?{$number:'-Infinity'}:Object.is(value,-0)?{$number:'-0'}:value):value;
function snapshot(s,state){
  const root={...state};delete root.fleet;const store=state.fleet,bytes=Buffer.from(new Uint8Array(store.rows,0,store.length*s.GH_FLEET_STORE.STRIDE));
  return {root:JSON.stringify(root,numberReplacer),rows:bytes.toString('base64'),values:JSON.stringify(store.values,numberReplacer),extras:JSON.stringify(store.extras,numberReplacer),length:store.length,live:store.live,revision:store.revision,structure:store.structure,marketOrder:Object.keys(state.realism.market.share)};
}
function assertRolledBack(actual,before){
  for(const key of ['root','rows','values','extras','length','live','marketOrder'])assert.deepEqual(actual[key],before[key],`rollback ${key}`);
  // Fleet Store deliberately keeps generation counters above every value seen
  // in an aborted transaction, so stale caches cannot become current again.
  assert.ok(actual.revision>before.revision,'rollback revision stays monotonic');assert.ok(actual.structure>=before.structure,'rollback structure stays monotonic');
}
async function runStaged(env,{stale=false,staleAfterValidation=false,contextAfterValidation=undefined,throwCurrent=false,corrupt=false,mutate=false,rollback=false}={}){
  const {s,state,day}=env,TX=s.GH_TRANSACTION_CORE,requests=[],stages=[];let pending=[],fleetDayResult=null,currentChecks=0;
  s.GH_FLEET_QUERY_PROVIDER=(target,name,params)=>{
    requests.push(name);const revision=target.fleet.revision,result=s.GH_FLEET_QUERY.run(name,target,s.GH_FLEET_DATA,params);
    if(name==='fleetDay'){
      fleetDayResult=result;
      if(corrupt)result.columns.exceptional.values[(result.columns.exceptional.count-1)*result.columns.fields.length+2]=NaN;
      if(mutate)result.columns.exceptional.values[0]+=0.25;
    }
    return new Promise(resolve=>pending.push(()=>resolve({result,current:()=>{
      if(target.fleet.revision!==revision)return false;
      if(name!=='fleetDay')return true;
      if(throwCurrent)throw new Error('qa-current-fault');
      currentChecks++;if(currentChecks>1&&contextAfterValidation!==undefined)target.realism.economy.airDemand=contextAfterValidation;if(stale)return false;if(staleAfterValidation&&currentChecks>1)return false;return true;
    }})));
  };
  const apply=rollback?function*(){yield* s.GH_REALISM.onDayStages(state,day);throw new Error('qa-fleet-day-rollback');}:function*(){return yield* s.GH_REALISM.onDayStages(state,day);};
  const handle=TX.beginStaged(state,{label:'qa-fleet-day-exceptional',apply});
  for(let calls=0;calls<20000&&!handle.done;calls++){
    handle.step(-Infinity);stages.push(handle.stage);if(pending.length){const settle=pending.splice(0);for(const resolve of settle)resolve();}await new Promise(resolve=>setImmediate(resolve));
  }
  assert.equal(handle.done,true,'staged daily close finishes');
  return {handle,requests,stages,fleetDayResult};
}
function plannedValues(plan,index){
  let row=plan.indices.indexOf(index),source=plan.values;if(row<0){row=plan.exceptional.indices.indexOf(index);source=plan.exceptional.values;}assert.ok(row>=0,`planned row ${index}`);return [...source.subarray(row*plan.fields.length,(row+1)*plan.fields.length)];
}

(async()=>{
  const plainEnv=setup();plainEnv.s.GH_FLEET_QUERY_PROVIDER=null;plainEnv.s.GH_REALISM.onDay(plainEnv.state,plainEnv.day);const plain=snapshot(plainEnv.s,plainEnv.state);
  assert.equal(plainEnv.ownerCountScans(),0,'local daily close reuses maintenance owner counts for market share');

  const workerEnv=setup(),worker=await runStaged(workerEnv);assert.equal(worker.handle.error,null,String(worker.handle.error?.stack||worker.handle.error));assert.equal(worker.handle.result.committed,true);
  const plan=worker.fleetDayResult.columns;
  assert.equal(plan.unsupported,false);assert.equal(plan.rejectNaN,true,'daily counter plans reject impossible NaN outputs');assert.ok(plan.exceptional.count>=4,'extras, non-exact and infinite counters stay in the result');assert.ok(plan.exceptional.values.some(value=>value===Infinity));assert.ok(plan.exceptional.values.some(value=>value===-Infinity));
  assert.equal(plannedValues(plan,8)[0],Infinity);assert.equal(plannedValues(plan,12)[1],-Infinity);assert.ok(Object.is(plannedValues(plan,9)[0],0)&&!Object.is(plannedValues(plan,9)[0],-0),'NaN input follows the original || zero semantics');assert.ok(Object.is(plannedValues(plan,10)[0],0)&&!Object.is(plannedValues(plan,10)[0],-0),'-0 input follows the original || positive-zero semantics');
  assert.equal(plan.indices.buffer,plan.exceptional.indices.buffer,'index streams share the transferred buffer');assert.equal(plan.values.buffer,plan.exceptional.values.buffer,'numeric streams share the transferred buffer');
  assert.deepEqual(snapshot(workerEnv.s,workerEnv.state),plain,'exceptional worker close is byte-for-byte equal to the local close');assert.equal(workerEnv.ownerCountScans(),0,'worker daily close does not count owners again');assert.equal(worker.stages.includes('realism.fleet-day'),false,'exceptions do not trigger a main-thread fleet scan');assert.ok(worker.stages.includes('realism.fleet-day-apply'));

  const staleEnv=setup(),stale=await runStaged(staleEnv,{stale:true});assert.equal(stale.handle.error,null);assert.deepEqual(snapshot(staleEnv.s,staleEnv.state),plain,'a stale answer falls back before writes and stays exact');assert.ok(stale.stages.includes('realism.fleet-day'));assert.equal(staleEnv.ownerCountScans(),0);

  const currentErrorEnv=setup(),currentError=await runStaged(currentErrorEnv,{throwCurrent:true});assert.equal(currentError.handle.error,null);assert.deepEqual(snapshot(currentErrorEnv.s,currentErrorEnv.state),plain,'a faulty current() guard declines only this worker result and preserves the daily close');assert.ok(currentError.stages.includes('realism.fleet-day'));

  const barrierEnv=setup(),barrier=await runStaged(barrierEnv,{staleAfterValidation:true});assert.equal(barrier.handle.error,null);assert.deepEqual(snapshot(barrierEnv.s,barrierEnv.state),plain,'an answer that becomes stale at the validation barrier falls back before snapshots or writes');assert.ok(barrier.stages.filter(stage=>stage==='realism.fleet-day-apply').length>=Math.ceil(barrier.fleetDayResult.columns.totalCount/1024));assert.ok(barrier.stages.includes('realism.fleet-day'));

  const contextPlainEnv=setup();contextPlainEnv.state.realism.economy.airDemand=NaN;contextPlainEnv.s.GH_FLEET_QUERY_PROVIDER=null;contextPlainEnv.s.GH_REALISM.onDay(contextPlainEnv.state,contextPlainEnv.day);const contextPlain=snapshot(contextPlainEnv.s,contextPlainEnv.state);
  const contextEnv=setup();contextEnv.state.realism.economy.airDemand=Infinity;const context=await runStaged(contextEnv,{contextAfterValidation:NaN});assert.equal(context.handle.error,null);assert.deepEqual(snapshot(contextEnv.s,contextEnv.state),contextPlain,'tagged Infinity-to-NaN context change at the barrier rejects the old worker answer');assert.ok(context.stages.includes('realism.fleet-day'));

  const corruptEnv=setup(),corrupt=await runStaged(corruptEnv,{corrupt:true});assert.equal(corrupt.handle.error,null);assert.deepEqual(snapshot(corruptEnv.s,corruptEnv.state),plain,'a late NaN is rejected after full sliced validation and before the first worker-plan write');assert.ok(corrupt.stages.filter(stage=>stage==='realism.fleet-day-apply').length>=2);assert.ok(corrupt.stages.includes('realism.fleet-day'));assert.equal(corruptEnv.ownerCountScans(),0);

  const rollbackEnv=setup(),beforeRollback=snapshot(rollbackEnv.s,rollbackEnv.state),rolled=await runStaged(rollbackEnv,{rollback:true});assert.match(String(rolled.handle.error?.message),/qa-fleet-day-rollback/);assertRolledBack(snapshot(rollbackEnv.s,rollbackEnv.state),beforeRollback);assert.equal(rollbackEnv.ownerCountScans(),0);

  const mutantEnv=setup(),mutant=await runStaged(mutantEnv,{mutate:true});assert.equal(mutant.handle.error,null);assert.equal(mutant.stages.includes('realism.fleet-day'),false);assert.throws(()=>assert.deepEqual(snapshot(mutantEnv.s,mutantEnv.state),plain),assert.AssertionError,'a changed exceptional value is caught by the byte differential');

  console.log(JSON.stringify({suite:'build372-fleet-day-exceptional',rows:workerEnv.s.GH_FLEET_DATA.size(workerEnv.state),fast:plan.count,exceptional:plan.exceptional.count,applySlices:worker.stages.filter(stage=>stage==='realism.fleet-day-apply').length,marketOwnerScans:workerEnv.ownerCountScans()}));
  console.log('BUILD372_FLEET_DAY_EXCEPTIONAL_PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
