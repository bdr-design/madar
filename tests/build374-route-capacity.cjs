'use strict';
const assert=require('node:assert/strict'),{harness}=require('./helpers/core-harness');
const {s}=harness(['route-core','air-sea-network-core']),R=s.GH_ROUTE_CORE,N=s.GH_AIR_SEA_NETWORK_CORE;
const alloc=(free,groups)=>Array.from(R.allocateAvailableForBudget({free,reserve:32},groups,100,8192),row=>({...row}));
assert.deepEqual(alloc(2,[20000]),[{routes:2,load:8192,count:16384}]);
assert.deepEqual(alloc(0,[20000]),[{routes:0,load:0,count:0}]);
for(const groups of [[20000,20000],[8192,1,8193],[0,20000],[1,1,1]])for(const free of [0,1,2,3,32,320]){
  const rows=alloc(free,groups);assert.ok(rows.reduce((n,r)=>n+r.routes,0)<=free);
  rows.forEach((r,i)=>{assert.ok(r.count<=groups[i]&&r.count<=r.routes*8192&&r.load<=8192);assert.ok(!r.count||r.routes>0);});
}
const assets=Array.from({length:20000},(_,i)=>({id:`P-${i}`,originId:'B1',rangeKm:1000}));
const routes=Array.from({length:318},(_,i)=>({id:`R-${i}`,fromFacility:'B1',toFacility:`D-${i}`,legKm:900}));
const input={assets,routes,originRoutes:[{originId:'B1',routeIds:routes.map(r=>r.id)}],initialLoads:Object.fromEntries(routes.map(r=>[r.id,100])),targetLoad:100,routeCapacity:8192};
const ordinary=N.plan(input);assert.equal(ordinary.assignments.length,0);assert.equal(ordinary.waitingGroups[0].assetIds.length,20000);
const pressure={...input,targetLoad:8192},plan=N.plan(pressure);assert.equal(plan.assignments.length,20000);assert.equal(plan.waitingGroups.length,0);assert.equal(N.validatePlan(pressure,plan),true);
// Capacity may not make an unreachable route suitable, or move an asset to another origin.
const unreachable={...pressure,routes:routes.map(r=>({...r,legKm:2000}))},blocked=N.plan(unreachable);assert.equal(blocked.assignments.length,0);
const otherOrigin={...pressure,originRoutes:[{originId:'OTHER',routeIds:routes.map(r=>r.id)}]};assert.equal(N.plan(otherOrigin).assignments.length,0);
console.log(JSON.stringify({ok:true,originalWaiting:20000,reusedExisting:plan.assignments.length,newSlots:2,partialAccepted:16384,remaining:3616,hardCap:8192}));
