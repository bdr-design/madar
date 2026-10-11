'use strict';
// Differential gate for applying the exact worker staffing proof.  The
// application path may touch only listed repair rows and contract ids; it must
// never rebuild fleet classes or expand a compact contract through toArray().
const assert=require('node:assert/strict'),path=require('node:path');
const web=path.join(path.resolve(__dirname,'..'),'WebApp'),load=name=>require(path.join(web,name));
const STORE=load('fleet-store-core.js');load('simulation-asset-core.js');load('fleet-event-core.js');
const DATA=load('fleet-access-core.js'),CORE=load('fleet-core.js'),PLAN=load('fleet-staffing-reconcile-plan-core.js'),clone=value=>structuredClone(value);
const params={requestToken:'startup-staffing-apply',facilitiesToken:'facilities-1',ownerToken:'owners-1'},resolver=id=>({id,name:'مركز الرياض'});
const ready=contractId=>({mode:'automatic-fixed',ready:true,roles:[{id:'drivers',name:'سائقون',dailyRate:110,count:2,monthlyPayroll:6600},{id:'mech',name:'فنيون',dailyRate:140,count:1,monthlyPayroll:4200}],total:3,monthlyPayroll:10800,contractId,provisionedAt:0,center:'مركز الرياض'});
const assets=[...Array.from({length:96},(_,index)=>({id:`TRK-${String(index+1).padStart(5,'0')}`,name:`Truck ${index+1}`,ownerCompanyId:'road',assetMode:'road',type:'road',assetClass:'truck',deliveryStatus:'delivered',phase:'idle',baseFacility:'BASE-RUH',specs:{crewPlan:{drivers:2,mech:1}},staffing:ready('EMP-BATCH'),crewBlocked:false})),
  {id:'REPAIR-1',name:'Repair 1',ownerCompanyId:'road',assetMode:'road',type:'road',assetClass:'truck',deliveryStatus:'delivered',phase:'idle',baseFacility:'BASE-RUH',specs:{crewPlan:{drivers:2,mech:1}}},
  {id:'REPAIR-2',name:'Repair 2',ownerCompanyId:'road',assetMode:'road',type:'road',assetClass:'truck',deliveryStatus:'delivered',phase:'turnaround',baseFacility:'BASE-RUH',specs:{crewPlan:{drivers:2,mech:1}},staffing:{mode:'legacy',ready:false}},
  {id:'PENDING',name:'Pending',ownerCompanyId:'road',assetMode:'road',type:'road',assetClass:'truck',deliveryStatus:'pending',phase:'delivery',baseFacility:'BASE-RUH',specs:{crewPlan:{drivers:2,mech:1}}}];
function makeState(){const listed=assets.slice(0,96).map(row=>row.id);listed.splice(41,0,'MISSING-LEGACY-MEMBER');return {simSeconds:86400,resetEpoch:1,sequences:{},fleet:STORE.fromAssets(clone(assets)),advanced:{labor:{employmentContracts:[{id:'EMP-BATCH',automaticAssetStaffing:true,status:'ساري',assetId:listed[0],assetIds:DATA.idLists.of(listed),assetCount:listed.length,count:999,salary:999,roles:[{id:'legacy'}]}],hiringLog:[]}},crew:[{id:'custom',count:7}]};}
function rows(state){const out=[];DATA.forEach(state,row=>out.push(DATA.plain(row)));return out;}
function former(target){const fleet=DATA,ids=fleet.idLists;for(const contract of target.advanced.labor.employmentContracts){if(contract?.automaticAssetStaffing!==true)continue;const members=ids.is(contract.assetIds)?ids.toArray(contract.assetIds):[contract.assetId],linked=members.map(id=>fleet.get(target,id)).filter(asset=>asset?.staffing?.contractId===contract.id&&asset.staffing?.mode==='automatic-fixed'&&asset.staffing.ready===true);if(linked.length&&ids.is(contract.assetIds)){contract.assetIds=ids.of(linked.map(asset=>asset.id));contract.assetId=linked[0].id;contract.assetCount=linked.length;contract.count=linked.reduce((sum,asset)=>sum+(Number(asset.staffing.total)||0),0);contract.salary=linked.reduce((sum,asset)=>sum+(Number(asset.staffing.monthlyPayroll)||0),0);}if(linked.length&&Array.isArray(contract.roles))delete contract.roles;}
 const unstaffed=[];fleet.scan(target,['deliveryStatus','phase','staffing'],(row,index)=>{if(row.deliveryStatus!=='pending'&&row.phase!=='delivery'&&!(row.staffing?.mode==='automatic-fixed'&&row.staffing.ready===true))unstaffed.push(index);});for(const index of unstaffed){const asset=fleet.viewAt(target,index);try{CORE.provisionStaffing(target,asset,resolver(asset.baseFacility));}catch(_error){}}CORE.synchronizeCrew(target);}
function finish(stages){let step,yields=0;do{step=stages.next();if(!step.done)yields++;}while(!step.done);return {value:step.value,yields};}

const expected=makeState();former(expected);
const actual=makeState(),stamp=PLAN.capture(actual,DATA,params),first=PLAN.plan(actual,DATA,{...params,request:PLAN.serializableCapture(stamp)});assert.equal(first.unstaffed,2);
const guardedIds=Object.freeze({...DATA.idLists,toArray(){throw new Error('staffing-apply-expanded-id-list');}}),guarded=Object.freeze({...DATA,idLists:guardedIds,forEachFieldClasses(){throw new Error('staffing-apply-main-class-scan');},scan(){throw new Error('staffing-apply-main-row-scan');}}),previous=global.GH_FLEET_DATA;global.GH_FLEET_DATA=guarded;
try{
  const applied=finish(CORE.reconcileStaffingPlanStages(actual,resolver,first,{slice:7,current:()=>PLAN.current(stamp,actual,DATA,{...params,result:first})}));assert(applied.yields>0);assert.equal(applied.value.provisioned,2);assert.equal(applied.value.needsRefresh,true);
  const secondStamp=PLAN.capture(actual,DATA,params),second=PLAN.plan(actual,DATA,{...params,request:PLAN.serializableCapture(secondStamp)});assert.equal(second.unstaffed,0);
  const published=finish(CORE.reconcileStaffingPlanStages(actual,resolver,second,{slice:7,reconcileContracts:false,current:()=>PLAN.current(secondStamp,actual,DATA,{...params,result:second})}));assert.equal(published.value.needsRefresh,false);
}finally{global.GH_FLEET_DATA=previous;}
assert.deepEqual(rows(actual),rows(expected),'worker-plan row repairs differ from former startup reconciliation');
assert.deepEqual(actual.advanced.labor,expected.advanced.labor,'worker-plan labor records differ');assert.deepEqual(actual.sequences,expected.sequences,'worker-plan sequence order differs');assert.deepEqual(actual.crew,expected.crew,'worker-plan crew totals differ');

const stale=makeState(),staleStamp=PLAN.capture(stale,DATA,params),stalePlan=PLAN.plan(stale,DATA,{...params,request:PLAN.serializableCapture(staleStamp)});STORE.set(stale.fleet,0,'condition',87);assert.throws(()=>finish(CORE.reconcileStaffingPlanStages(stale,resolver,stalePlan,{current:()=>PLAN.current(staleStamp,stale,DATA,{...params,result:stalePlan})})),/stale/);assert.equal(stale.advanced.labor.employmentContracts[0].count,999,'stale proof mutated contracts');

console.log(JSON.stringify({ok:true,rows:assets.length,repairs:first.unstaffed,contracts:actual.advanced.labor.employmentContracts.length}));
