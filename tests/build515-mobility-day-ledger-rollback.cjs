'use strict';
// Owner decision (19 Oct 2026): Mobility keeps one row per day and center instead of a record per trip and per driver
// (build350). The open day's rows (tripDays) are edited in place, so a simulation slice that fails must restore them
// with Mobility's row-level rollback policy, as it restores vehicles, drivers and requests. Proven here with the real
// transaction core and Mobility owner:
//  1. a slice that completes and cancels trips and closes a day, then fails, leaves Mobility exactly as before;
//  2. the same slice committed gives the day rows, the archive and the open requests, with no per-driver ledger;
//  3. the open day's rows sit three levels deep (root, tripDays, row), inside what the 'rows' policy restores.
const assert=require('node:assert/strict'),path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');process.env.GH_TEST_SOURCE_DIR=ROOT;
const {scenario}=require(path.join(ROOT,'tests/helpers/business-scenario'));
const env=scenario(),{state,s,command}=env,M=s.GH_MOBILITY_CORE,T=s.GH_TRANSACTION_CORE;
command('corporate','open-company',{type:'mobility',capital:500000000,legalName:'Test Mobility'});
state.customHubs.push({id:'MOB-CENTER-RUH',name:'Riyadh',kind:'mobility-center',ownerCompanyId:'mobility',owned:true,capitalId:'RUH',city:'Riyadh',country:'Saudi Arabia',coords:[24.7,46.7],bays:120});
M.ensure(state);state.mobility.capitalCenters.push({id:'MOB-CENTER-RUH',ownerCompanyId:'mobility',capitalId:'RUH',city:'Riyadh',country:'Saudi Arabia',coords:[24.7,46.7],facilityId:'MOB-CENTER-RUH'});
command('mobility','buy-fleet',{quantity:6,centerId:'RUH',classId:'eco-ev'});
const m=state.mobility,plain=value=>JSON.parse(JSON.stringify(value));
const trip=(id,v,extra)=>({id,ownerCompanyId:'mobility',requestId:'REQ-'+id,vehicleId:m.vehicles[v].id,driverId:m.drivers[v].id,centerId:'RUH',fromZone:'KAFD',toZone:'OLAYA',distanceKm:10,fare:100,route:[[24.7,46.7],[24.71,46.71]],routeLocked:true,routeVersion:3,...extra});
// An open day already holding a row (yesterday, day 0), and trips finishing today (day 1).
M.onSimulationTime({state},600);
for(const id of ['A','B','C'])m.rideRequests.push({id:'REQ-'+id,ownerCompanyId:'mobility',status:'active',centerId:'RUH',fromZone:'KAFD',toZone:'OLAYA',fare:100,requestedAt:86400});
m.activeTrips.push(trip('A',0,{routeVerified:true,dueAt:86400+100,startedAt:86400,duration:100}),trip('B',1,{routeVerified:false,routingDeadlineAt:86400+50,acceptedAt:86400,dueAt:null}),trip('C',2,{routeVerified:true,dueAt:86400+120,startedAt:86400,duration:120}));
for(const i of [0,1,2]){m.vehicles[i].status='moving';m.drivers[i].status='on-trip';}
m.tripDays.push({id:'MOB-DAY-0-RUH',ownerCompanyId:'mobility',day:0,centerId:'RUH',completed:2,cancelled:0,grossBookings:200,driverPayouts:20,platformRevenue:180,distanceKm:20});
const before=JSON.stringify(m),beforeRef=m;
// 1. Failed slice.
assert.throws(()=>T.execute(state,{label:'qa-mobility-slice',scope:['mobility'],writeRoots:['mobility'],rowRoots:{mobility:M.ROLLBACK_POLICY},apply(){M.onSimulationTime({state},86400+3600);assert.ok(m.tripArchive.some(r=>r.id==='MOB-DAY-0-RUH'),'the slice closed day 0');throw new Error('qa-slice-failed');}}),/qa-slice-failed/);
assert.equal(state.mobility,beforeRef,'the Mobility root object is kept');assert.equal(JSON.stringify(state.mobility),before,'a failed slice leaves Mobility exactly as before');
// 2. Committed slice.
T.execute(state,{label:'qa-mobility-slice',scope:['mobility'],writeRoots:['mobility'],rowRoots:{mobility:M.ROLLBACK_POLICY},apply(){M.onSimulationTime({state},86400+3600);}});
assert.deepEqual(plain(m.tripArchive.filter(r=>r.id==='MOB-DAY-0-RUH')),[{id:'MOB-DAY-0-RUH',ownerCompanyId:'mobility',day:0,centerId:'RUH',completed:2,cancelled:0,grossBookings:200,driverPayouts:20,platformRevenue:180,distanceKm:20}],'day 0 is archived as it was');
const today=plain(m.tripDays.find(r=>r.id==='MOB-DAY-1-RUH'));assert.ok(today,'today has one row for the center');assert.ok(today.completed>=2,'A and C completed today');assert.ok(today.cancelled>=1,'B was released');
assert.ok(!m.rideRequests.some(r=>['REQ-A','REQ-B','REQ-C'].includes(r.id)),'finished requests are dropped');assert.ok(m.rideRequests.every(r=>r.status==='queued'||r.status==='active'));
assert.ok(m.drivers.every(d=>!('earnings' in d)&&!('totalTrips' in d)),'no per-driver ledger');assert.ok(m.tripArchive.every(r=>r.status===undefined),'no per-trip archive row');
// 3. Shape: tripDays rows are plain records directly under a container of the Mobility root.
assert.equal(M.ROLLBACK_POLICY.level,'rows');assert.ok(!M.ROLLBACK_POLICY.immutable.includes('tripDays'),'open day rows are edited, so they are not immutable');assert.ok(M.ROLLBACK_POLICY.immutable.includes('tripArchive'),'closed rows are never edited');
assert.ok(m.tripDays.every(r=>Object.values(r).every(v=>v===null||typeof v!=='object')),'a day row holds no nested object');
console.log(JSON.stringify({suite:'build515-mobility-day-ledger-rollback',ok:true,today}));
