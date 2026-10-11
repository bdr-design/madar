'use strict';
// Differential gate for startup staffing reconciliation.  The common healthy
// fleet must stay on class summaries; exceptional rows must produce the exact
// old row-order repairs, contracts, sequences and crew totals.
const assert=require('node:assert/strict'),path=require('node:path');
const web=path.join(path.resolve(__dirname,'..'),'WebApp'),load=name=>require(path.join(web,name));
const STORE=load('fleet-store-core.js');load('simulation-asset-core.js');load('fleet-event-core.js');
const DATA=load('fleet-access-core.js'),CORE=load('fleet-core.js'),ids=DATA.idLists;
const clone=value=>structuredClone(value);

const rolePlan=[{id:'drivers',name:'سائقو الشاحنات',dailyRate:110,count:2,monthlyPayroll:6600},{id:'mech',name:'فنيو الصيانة',dailyRate:140,count:1,monthlyPayroll:4200}];
const staffing=(contractId,ready=true)=>({mode:'automatic-fixed',ready,roles:clone(rolePlan),total:3,monthlyPayroll:10800,contractId,provisionedAt:0,center:'مركز الرياض'});
const assets=[];
function addBatch(prefix,count,contractId){for(let index=0;index<count;index++)assets.push({id:`${prefix}-${index}`,name:`Truck ${prefix}-${index}`,ownerCompanyId:'road',assetMode:'road',type:'road',assetClass:'truck',deliveryStatus:'delivered',phase:'idle',baseFacility:'BASE-RUH',specs:{crewPlan:{drivers:2,mech:1}},staffing:staffing(contractId),crewBlocked:false});}
addBatch('A',6000,'EMP-A');addBatch('B',4000,'EMP-B');
assets.push({id:'PENDING-1',name:'Pending',ownerCompanyId:'road',assetMode:'road',type:'road',assetClass:'truck',deliveryStatus:'pending',phase:'delivery',baseFacility:'BASE-RUH',specs:{crewPlan:{drivers:2,mech:1}}});
assets.push({id:'REPAIR-2',name:'Repair 2',ownerCompanyId:'road',assetMode:'road',type:'road',assetClass:'truck',deliveryStatus:'delivered',phase:'idle',baseFacility:'BASE-RUH',specs:{crewPlan:{drivers:2,mech:1}},staffing:{mode:'legacy',ready:false}});
assets.push({id:'REPAIR-1',name:'Repair 1',ownerCompanyId:'road',assetMode:'road',type:'road',assetClass:'truck',deliveryStatus:'delivered',phase:'idle',baseFacility:'BASE-RUH',specs:{crewPlan:{drivers:2,mech:1}}});
function state(){
  const aIds=assets.filter(row=>row.id.startsWith('A-')).map(row=>row.id),bIds=assets.filter(row=>row.id.startsWith('B-')).map(row=>row.id);
  return {simSeconds:86400,sequences:{},fleet:STORE.fromAssets(clone(assets)),advanced:{labor:{employmentContracts:[
    {id:'EMP-A',automaticAssetStaffing:true,status:'ساري',assetId:aIds[0],assetIds:ids.of(aIds),assetCount:aIds.length,count:aIds.length*3,salary:aIds.length*10800},
    {id:'EMP-B',automaticAssetStaffing:true,status:'ساري',assetId:bIds[0],assetIds:ids.of(bIds),assetCount:bIds.length,count:bIds.length*3,salary:bIds.length*10800}
  ],hiringLog:[]}},crew:[]};
}
function rows(target){const out=[];for(let index=0;index<target.fleet.length;index++)if(STORE.isAlive(target.fleet,index))out.push(STORE.materialize(target.fleet,index));return out;}
// CORE does not export requireFleetAsset, and the production loop merely uses
// it as a guard before provisionStaffing (which performs the same check).  Use
// a faithful former loop for canonical test assets.
function formerCanonical(target,resolver){
  const fleet=DATA;
  for(const contract of target.advanced.labor.employmentContracts){if(contract?.automaticAssetStaffing!==true)continue;const members=ids.is(contract.assetIds)?ids.toArray(contract.assetIds):[contract.assetId],linked=members.map(id=>fleet.get(target,id)).filter(asset=>asset?.staffing?.contractId===contract.id&&asset.staffing?.mode==='automatic-fixed'&&asset.staffing.ready===true);if(linked.length&&ids.is(contract.assetIds)){contract.assetIds=ids.of(linked.map(asset=>asset.id));contract.assetId=linked[0].id;contract.assetCount=linked.length;contract.count=linked.reduce((sum,asset)=>sum+(Number(asset.staffing.total)||0),0);contract.salary=linked.reduce((sum,asset)=>sum+(Number(asset.staffing.monthlyPayroll)||0),0);}if(linked.length&&Array.isArray(contract.roles))delete contract.roles;}
  const unstaffed=[];fleet.scan(target,['deliveryStatus','phase','staffing'],(asset,index)=>{if(asset.deliveryStatus==='pending'||asset.phase==='delivery')return;if(asset.staffing?.mode==='automatic-fixed'&&asset.staffing.ready===true)return;unstaffed.push(index);});let provisioned=0;for(const index of unstaffed){const asset=fleet.viewAt(target,index);if(!asset)continue;try{CORE.provisionStaffing(target,asset,resolver(asset.baseFacility));provisioned++;}catch(_error){continue;}}CORE.synchronizeCrew(target);return provisioned;
}
const expected=state(),actual=state(),resolver=id=>({id,name:'مركز الرياض'});
const formerCount=formerCanonical(expected,resolver),currentCount=CORE.reconcileStaffing(actual,resolver);
assert.equal(currentCount,formerCount);assert.deepEqual(rows(actual),rows(expected),'fleet repairs changed');
assert.deepEqual(actual.advanced.labor,expected.advanced.labor,'labor records changed');assert.deepEqual(actual.sequences,expected.sequences,'id order changed');assert.deepEqual(actual.crew,expected.crew,'crew totals changed');

// Mutation gate: the healthy common path may not call the row scanner.  If the
// class pass is reverted to the former scan this assertion fails immediately.
const healthy=state();healthy.fleet=STORE.fromAssets(clone(assets.slice(0,10000)));let classCallbacks=0;
global.GH_FLEET_DATA={...DATA,scan:()=>{throw new Error('startup-staffing-row-scan');},forEachFieldClasses:(target,fields,fn,options)=>DATA.forEachFieldClasses(target,fields,(row,count,info)=>{classCallbacks++;return fn(row,count,info);},options)};
assert.equal(CORE.reconcileStaffing(healthy,resolver),0);assert.ok(classCallbacks<=6,`healthy fleet expanded to ${classCallbacks} classes`);
global.GH_FLEET_DATA=DATA;
console.log(JSON.stringify({ok:true,assets:assets.length,provisioned:currentCount,healthyClassCallbacks:classCallbacks}));
