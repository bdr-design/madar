'use strict';
// Differential and mutation gate for the worker-side startup staffing proof.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..'),web=path.join(ROOT,'WebApp'),load=name=>require(path.join(web,name));
const STORE=load('fleet-store-core.js');load('simulation-asset-core.js');load('fleet-event-core.js');
const FLEET=load('fleet-access-core.js'),FLEET_CORE=load('fleet-core.js'),PLAN=load('fleet-staffing-reconcile-plan-core.js'),QUERY=load('fleet-query-core.js');
const clone=value=>structuredClone(value),params={requestToken:'startup-1',facilitiesToken:'facilities-9',ownerToken:'owners-4'};
// A staged contract must traverse a segmented id list once.  Count numeric
// segment reads so an implementation based on repeated at() fails this gate.
{const raw=Array.from({length:1024},(_,index)=>`SEG-${index}`);let reads=0;const segments=new Proxy(raw,{get(target,key,receiver){if(/^\d+$/.test(String(key)))reads++;return Reflect.get(target,key,receiver);}}),rows=[...FLEET.idLists.entries({$ids:segments})];assert.equal(rows.length,raw.length);assert.deepEqual(rows[777],[777,'SEG-777']);assert(reads<=raw.length+2,`segmented iteration was not linear: ${reads}`);
 const source=Array.from({length:257},(_,index)=>`GH-ASSET-${String(index+1).padStart(7,'0')}`),steps=FLEET.idLists.ofStages(source,{slice:17});let next,yields=0;do{next=steps.next();if(!next.done)yields++;}while(!next.done);assert.deepEqual(next.value,FLEET.idLists.of(source));assert(yields>0,'large legacy arrays must encode across stages');}
const role=(id,count)=>({id,name:id,dailyRate:1,count,monthlyPayroll:Number(count)*30});
const ready=(roles,contractId)=>({mode:'automatic-fixed',ready:true,roles,total:roles.reduce((sum,row)=>sum+(Number(row.count)||0),0),monthlyPayroll:100,contractId});
const air=ready([role('pilots',2),role('cabin',3),role('aeng',1),role('ignored-role',99)],'EMP-A');
const road=ready([role('drivers',2),role('mech',1)],'EMP-R');
const fractional=ready([role('drivers',.1),role('mech','2')],'EMP-F');
const assets=[
  {id:'READY-A',deliveryStatus:'delivered',phase:'idle',staffing:air},
  {id:'REPAIR-1',deliveryStatus:'delivered',phase:'idle'},
  {id:'DEAD',deliveryStatus:'delivered',phase:'idle',staffing:road},
  {id:'PENDING',deliveryStatus:'pending',phase:'idle'},
  {id:'READY-F',deliveryStatus:'delivered',phase:'idle',staffing:fractional},
  {id:'REPAIR-2',deliveryStatus:'delivered',phase:'turnaround',staffing:{mode:'legacy',ready:false}},
  {id:'DELIVERY',deliveryStatus:'delivered',phase:'delivery'},
  {id:'READY-PENDING',deliveryStatus:'pending',phase:'delivery',staffing:road},
  {id:'READY-R',deliveryStatus:'delivered',phase:'idle',staffing:road}
];
function makeState(source=assets){
  const state={simSeconds:86400*3,resetEpoch:6,fleet:STORE.fromAssets(clone(source)),crew:[{id:'drivers',name:'existing drivers',count:77,marker:'preserve'},{id:'custom',name:'custom',count:11}]};
  if(source===assets)FLEET.remove(state,FLEET.viewAt(state,2));
  return state;
}
function reconciliationIndices(state){
  const indices=[];FLEET.forEachFieldClasses(state,['deliveryStatus','phase','staffing'],(row,count,info)=>{if(!count||row.deliveryStatus==='pending'||row.phase==='delivery'||row.staffing?.mode==='automatic-fixed'&&row.staffing.ready===true)return;info.forEachMember((_member,index)=>indices.push(index));});
  if(indices.length>1)indices.sort((a,b)=>a-b);return indices;
}
function expectedCrew(state){FLEET_CORE.synchronizeCrew(state);return PLAN.ROLE_IDS.map(id=>state.crew.find(row=>row.id===id).count);}

const state=makeState(),beforeRevision=state.fleet.revision,expectedIndices=reconciliationIndices(state),crewReference=expectedCrew(makeState());
const stamp=PLAN.capture(state,FLEET,params),request=PLAN.serializableCapture(stamp),result=PLAN.plan(state,FLEET,{...params,request});
assert.equal(state.fleet.revision,beforeRevision,'planning must not write the fleet');
assert.equal(PLAN.validPlan(result,params),true);assert.deepEqual([...result.indices],expectedIndices,'repair indices and order differ from reconcileStaffing');
const delegated=QUERY.run('staffingReconcilePlan',state,FLEET,{...params,request});assert.equal(PLAN.validPlan(delegated,params),true);assert.deepEqual([...delegated.indices],[...result.indices]);assert.deepEqual([...delegated.roleCounts],[...result.roleCounts]);assert.strictEqual(delegated.columns.indices,delegated.indices);assert.strictEqual(delegated.columns.values,delegated.roleCounts);
assert.deepEqual([...result.roleCounts],crewReference,'crew totals differ from synchronizeCrew');
assert.equal(result.crewStrategy,'row-order','one fractional count must switch the entire crew pass to row order');
assert.equal(result.rows,assets.length-1);assert.equal(result.unstaffed,2);assert.equal(result.deferred,3);assert.equal(result.eligibleStaffed+result.unstaffed,result.eligible);
assert.equal(PLAN.current(stamp,state,FLEET,{...params,result}),true);assert.equal(PLAN.current(stamp,state,FLEET,{...params,requestToken:'startup-2',result}),false,'request identity is a freshness dependency');
assert.deepEqual(PLAN.transferables(result),[result.indices.buffer,result.roleCounts.buffer]);assert.deepEqual([...PLAN.chunks(result,1)].map(rows=>[...rows]),expectedIndices.map(index=>[index]));
assert.equal(PLAN.lookup(result).count('drivers'),crewReference[PLAN.ROLE_IDS.indexOf('drivers')]);
assert.throws(()=>PLAN.applyCrewTotals({crew:[]},result),/plan-incomplete/,'partial crew totals cannot be published before repairs');
assert.throws(()=>PLAN.requestKey({requestToken:{bad:true}}),/request-token/,'dependency tokens must be stable scalar values');
assert.equal(PLAN.validPlan({...result,indices:new Uint32Array([result.sourceLength]),unstaffed:1,eligibleStaffed:result.eligible-1}),false,'out-of-range repair indices fail closed');
assert.equal(PLAN.validPlan({...result,roleIds:[...result.roleIds].reverse()}),false,'role order is part of the plan contract');
assert.equal(PLAN.validPlan({...result,deferred:result.deferred+1}),false,'aggregate inconsistencies fail closed');
assert.equal(PLAN.validPlan({...result,requestKey:'not-a-key'}),false,'malformed request keys fail closed');
const paddedIndices=new Uint32Array(result.indices.length+1);paddedIndices.set(result.indices,1);assert.equal(PLAN.validPlan({...result,indices:paddedIndices.subarray(1)}),false,'transfer views may not expose a larger backing buffer');
assert.equal(PLAN.validPlan({...result,selectionClasses:result.rows+1}),false,'class telemetry cannot exceed live rows');

// A fleet write invalidates the proof even when it touches a field outside the
// three projected columns: the plan authorizes a startup state, not a subset.
STORE.set(state.fleet,0,'condition',91);assert.equal(PLAN.current(stamp,state,FLEET,{...params,result}),false);

// Healthy plans can publish crew totals in O(the eight fixed roles). This is
// byte-for-byte equivalent to synchronizeCrew, including custom/duplicate
// rows and the row-order fallback for fractional legacy staffing values.
const healthyAssets=assets.filter(row=>!['REPAIR-1','REPAIR-2','DEAD'].includes(row.id)),healthy=makeState(healthyAssets),healthyReference=makeState(healthyAssets),healthyStamp=PLAN.capture(healthy,FLEET,params),healthyResult=PLAN.plan(healthy,FLEET,{...params,request:PLAN.serializableCapture(healthyStamp)});
assert.equal(healthyResult.unstaffed,0);FLEET_CORE.synchronizeCrew(healthyReference);PLAN.applyCrewTotals(healthy,healthyResult);assert.deepEqual(healthy.crew,healthyReference.crew,'healthy crew publication differs from synchronizeCrew');

// Integral counts stay on the same class-order arithmetic as synchronizeCrew.
// This catches rounding changes at the safe-integer boundary.
const huge=ready([role('pilots',Number.MAX_SAFE_INTEGER)],'EMP-HUGE'),one=ready([role('pilots',1)],'EMP-ONE'),integralState=makeState([
  {id:'H-0',deliveryStatus:'delivered',phase:'idle',staffing:huge},
  {id:'H-1',deliveryStatus:'delivered',phase:'idle',staffing:huge},
  {id:'H-2',deliveryStatus:'delivered',phase:'idle',staffing:one}
]),integralReference=makeState([
  {id:'H-0',deliveryStatus:'delivered',phase:'idle',staffing:huge},
  {id:'H-1',deliveryStatus:'delivered',phase:'idle',staffing:huge},
  {id:'H-2',deliveryStatus:'delivered',phase:'idle',staffing:one}
]),integralResult=PLAN.plan(integralState,FLEET,params);
FLEET_CORE.synchronizeCrew(integralReference);assert.equal(integralResult.crewStrategy,'class-integral');assert(Object.is(PLAN.lookup(integralResult).count('pilots'),integralReference.crew.find(row=>row.id==='pilots').count),'class-order IEEE result changed');

// Mutation gates: relaxing the deferred-row predicate changes the exact repair
// set, and dropping one known role changes the synchronizeCrew differential.
const source=fs.readFileSync(path.join(web,'fleet-staffing-reconcile-plan-core.js'),'utf8');
function mutant(replaceFrom,replaceTo,label){const changed=source.replace(replaceFrom,replaceTo);assert.notEqual(changed,source,`${label} mutation applied`);const box={module:{exports:{}},exports:{},structuredClone,console};box.globalThis=box;vm.createContext(box);vm.runInContext(changed,box,{filename:`fleet-staffing-reconcile-plan-core.${label}.js`});return box.module.exports;}
const selectionMutant=mutant("function eligible(row){return row?.deliveryStatus!=='pending'&&row?.phase!=='delivery';}","function eligible(row){return row?.phase!=='delivery';}",'selection-mutant');
assert.throws(()=>assert.deepEqual([...selectionMutant.plan(makeState(),FLEET,params).indices],expectedIndices),assert.AssertionError);
const crewMutant=mutant('if(slot!==undefined)counts[slot]+=(Number(role.count)||0)*times;','if(slot!==undefined&&role.id!==\'drivers\')counts[slot]+=(Number(role.count)||0)*times;','crew-mutant');
assert.throws(()=>assert.deepEqual([...crewMutant.plan(makeState(),FLEET,params).roleCounts],crewReference),assert.AssertionError);

console.log(JSON.stringify({ok:true,rows:result.rows,unstaffed:result.unstaffed,crewStrategy:result.crewStrategy,integralStrategy:integralResult.crewStrategy,mutation:true}));
