'use strict';
const assert=require('node:assert/strict'),{harness}=require('./helpers/core-harness');
const {s}=harness(['madar-shell']),M=s.GH_MADAR;
const capabilities={air:'asset.aircraft',sea:'asset.vessel',road:'asset.truck',mobility:'operations.mobility',power:'operations.energy',bank:'operations.bank',insurance:'operations.insurance',realestate:'operations.realestate',telecom:'operations.telecom',dealership:'operations.dealer',hospitality:'operations.hospitality'};
const definitions=Object.fromEntries(Object.entries(capabilities).flatMap(([kind,capability])=>[[kind,{capabilities:[capability]}],[kind+'-second',{capabilities:[capability]}]]));
s.GH_COMPANY_PLATFORM={definitionFor:(_state,id)=>definitions[id],listInstances:()=>Object.keys(definitions).map(id=>({id,operational:true,definition:definitions[id]}))};
s.GH_ADVANCED={companyOverviewSummary:()=>({primaryOperatingCount:17,primaryOperatingLabel:'التشغيل',metrics:[]})};
s.GH_HR_CORE={officialManager:()=>({name:'QA Manager'})};s.GH_MOBILITY_CORE={managementSnapshot:()=>({vehicles:19,moving:3})};
const state={profile:{},simSeconds:0},results=[];
for(const kind of Object.keys(capabilities))for(const id of [kind,kind+'-second']){
 let reads=0;const ctx={state,fmtMoney:String,companyPerformance:()=>null,companyOperatingBalance:()=>100,companyFleetStats(owner){assert.equal(owner,id);reads++;return {total:23,moving:5,service:0};}};
 const before=JSON.stringify(state),html=M.render('company',id,ctx),needsFleet=['air','sea','road','mobility'].includes(kind);assert(html.includes('madar-company'));assert.equal(reads,needsFleet?1:0,`${id}: a service panel must not enqueue a million-asset worker query whose result it never displays`);assert.equal(JSON.stringify(state),before,'render does not mutate game state');
 if(!needsFleet){ctx.companyFleetStats=()=>{throw Error('forbidden-unused-fleet-work');};assert.equal(M.render('company',id,ctx),html,'service output is independent of unused fleet data');}
 results.push({kind,id,fleetReads:reads});
}
(async()=>{
 const {activity}=require('./helpers/request-decisions-fixture.cjs'),vm=require('node:vm');s.__GH_STATE__={simSeconds:20};let scans=0;
 s.GH_FLEET_DATA={scan(state,fields,visit){assert.equal(state,s.__GH_STATE__);assert.deepEqual(Array.from(fields),['routeId','phase']);scans++;for(const row of [{routeId:'R1',phase:'moving'},{routeId:'R2',phase:'turnaround'},{routeId:null,phase:'idle'}])visit(row);},forEach(){throw Error('measurement-must-not-allocate-fleet-views');}};
 const counters=await activity({evaluate:fn=>vm.runInContext('('+fn.toString()+')()',s)});assert.deepEqual(JSON.parse(JSON.stringify(counters)),{routed:2,moving:1,simSeconds:20});assert.equal(scans,1);
 console.log(JSON.stringify({suite:'build434-service-panel-fleet-work',passed:results.length,nonfleetQueries:0,retainedFleetKinds:4,dynamicCompanyInstances:true,measurementUsesRawScan:true,results},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
