'use strict';
// Build 372: changing the daily fleet scan's slice boundary must preserve every committed result and row write.
const assert=require('node:assert/strict'),{scenario}=require('./helpers/business-scenario');
const {state,s}=scenario(),F=s.GH_FLEET_DATA,R=s.GH_REALISM;
state.fleet=[];
for(let index=0;index<2500;index++)F.add(state,{
  id:`QA-DAY-${String(index).padStart(5,'0')}`,type:'air',assetMode:'air',ownerCompanyId:'air',companyId:'air',ownership:'owned',
  phase:index%3===0?'moving':'turnaround',condition:60+(index%41),purchasePrice:1000000+(index%17)*1000,
  specs:{capacity:180,rangeKm:5000,speedKmh:800,capacityUnit:'مقعد'},lastTrip:{distanceKm:1200,revenue:20000,fuelCost:4000,crewCost:1500,maintReserve:500},
  flightHours:index%700,flightCycles:index%400,nextCheckHours:600,staffing:{monthlyPayroll:10000,ready:true,total:8},
});
const day=Math.max(1,Number(state.lastFinancialDay||0)+1),plain=JSON.parse(JSON.stringify(state)),staged=JSON.parse(JSON.stringify(state));
R.onDay(plain,day);
const stages=R.onDayStages(staged,day);let fleetStages=0,step;
while(!(step=stages.next()).done)if(step.value==='realism.fleet-day')fleetStages++;
assert.equal(fleetStages,2,'2,500 rows yield after each 1,024-row slice');
assert.deepEqual(staged,plain,'the sliced day close is byte-for-byte equivalent to the one-call close');
console.log(JSON.stringify({suite:'build372-fleet-day-slice-parity',rows:F.size(staged),fleetStages,day}));
console.log('BUILD372_FLEET_DAY_SLICE_PARITY_PASS');
