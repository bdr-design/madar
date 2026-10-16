'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');process.env.GH_TEST_SOURCE_DIR=ROOT;
const {scenario}=require(path.join(ROOT,'tests/helpers/business-scenario'));

function openedMobility(name='Mobility QA'){
  const env=scenario(),{state,s,command}=env,M=s.GH_MOBILITY_CORE;
  command('corporate','open-company',{type:'mobility',capital:500000000,legalName:name});
  M.ensure(state);
  state.mobility.routeSchemaVersion=3;
  return {...env,M,HR:s.GH_HR_CORE,F:s.GH_FINANCE_CORE};
}
function measuredRequestReads(centerCount,requestCount=1500){
  const env=openedMobility(`Mobility ${centerCount} center read probe`),{state,M}=env,ids=['RUH','AUH','DOH','KWI','CAI','ANK','BER','LON','PAR','MAD'].slice(0,centerCount);
  state.mobility.status='active';
  state.mobility.capitalCenters=ids.map(capitalId=>({id:`MOB-${capitalId}`,ownerCompanyId:'mobility',capitalId,city:capitalId,country:'QA',coords:[24,46]}));
  state.mobility.vehicles=ids.map((centerId,index)=>({id:`MOB-V-${index}`,ownerCompanyId:'mobility',centerId,status:'moving'}));
  state.mobility.drivers=ids.map((centerId,index)=>({id:`MOB-D-${index}`,ownerCompanyId:'mobility',centerId,status:'on-trip',assetId:`MOB-V-${index}`}));
  state.mobility.rideRequests=Array.from({length:requestCount},(_,index)=>({id:`REQ-${index}`,ownerCompanyId:'mobility',centerId:ids[0],status:'cancelled',requestedAt:0}));
  state.mobility.lastDemandAtByCenter=Object.fromEntries(ids.map(centerId=>[centerId,600]));
  let reads=0;const requests=state.mobility.rideRequests;
  state.mobility.rideRequests=new Proxy(requests,{get(target,key,receiver){if(/^\d+$/.test(String(key)))reads++;return Reflect.get(target,key,receiver);}});
  M.onSimulationTime({state},600);
  return reads;
}
function tripLifecycleReads(kind,total=12000){
  const env=openedMobility(`Mobility ${kind} read probe`),{state,M}=env;
  state.mobility.status='active';
  let vehicleReads=0,driverReads=0;
  const vehicles=Array.from({length:total},(_,index)=>({id:`MOB-V-${index}`,ownerCompanyId:'mobility',centerId:'RUH',status:index===0?'moving':'available',tripId:index===0?'TRIP-1':null,zoneId:'KAFD',totalTrips:0,totalKm:0,battery:100}));
  const drivers=Array.from({length:total},(_,index)=>({id:`MOB-D-${index}`,ownerCompanyId:'mobility',centerId:'RUH',assetId:`MOB-V-${index}`,status:index===0?'on-trip':'online',tripId:index===0?'TRIP-1':null,zoneId:'KAFD',totalTrips:0,earnings:0}));
  state.mobility.vehicles=new Proxy(vehicles,{get(target,key,receiver){if(/^\d+$/.test(String(key)))vehicleReads++;return Reflect.get(target,key,receiver);}});
  state.mobility.drivers=new Proxy(drivers,{get(target,key,receiver){if(/^\d+$/.test(String(key)))driverReads++;return Reflect.get(target,key,receiver);}});
  state.mobility.rideRequests=[{id:'REQ-1',ownerCompanyId:'mobility',status:'active',centerId:'RUH',requestedAt:0}];
  state.mobility.activeTrips=[kind==='complete'
    ?{id:'TRIP-1',ownerCompanyId:'mobility',requestId:'REQ-1',vehicleId:'MOB-V-0',driverId:'MOB-D-0',centerId:'RUH',fromZone:'KAFD',toZone:'OLAYA',routeVerified:true,startedAt:0,dueAt:100,duration:100,distanceKm:10,fare:100}
    :{id:'TRIP-1',ownerCompanyId:'mobility',requestId:'REQ-1',vehicleId:'MOB-V-0',driverId:'MOB-D-0',centerId:'RUH',fromZone:'KAFD',toZone:'OLAYA',routeVerified:false,acceptedAt:0,routingDeadlineAt:900,fare:100}];
  M.onSimulationTime({state},kind==='complete'?100:1000);
  const reads={vehicleReads,driverReads};
  assert.equal(state.mobility.activeTrips.length,0);
  assert.equal(state.mobility.vehicles[0].status,'available');
  assert.equal(state.mobility.drivers[0].status,'online');
  assert.equal(kind==='complete'?state.mobility.kpis.completed:state.mobility.kpis.cancelled,1);
  return reads;
}
function legacyLedgerScenario(){
  const env=openedMobility('Mobility legacy ledger probe'),{state,M,HR}=env,hr=HR.ensure(state);
  delete state.mobility.driverLedgerVersion; // Old saves predate the grouped-ledger format marker.
  const hub={id:'MOB-CENTER-RUH',ownerCompanyId:'mobility',kind:'mobility-center',owned:true,capitalId:'RUH',city:'الرياض',country:'السعودية',coords:[24.7,46.7],bays:120};
  state.customHubs.push(hub);
  state.mobility.capitalCenters=[{id:hub.id,facilityId:hub.id,ownerCompanyId:'mobility',capitalId:'RUH',city:hub.city,country:hub.country,coords:hub.coords}];
  for(let index=0;index<2;index++){
    const id=`LEG-V-${index}`,driverId=`LEG-D-${index}`;
    state.mobility.vehicles.push({id,ownerCompanyId:'mobility',centerId:'RUH',assetClass:'eco-ev',name:`مركبة قديمة ${index}`,purchasePrice:42000,status:'available',baseLocation:'الرياض',driverId,staffing:{mode:'automatic-fixed',ready:true,monthlyPayroll:6000,driverId}});
    state.mobility.drivers.push({id:driverId,ownerCompanyId:'mobility',centerId:'RUH',assetId:id,name:`سائق ${index}`,status:'online',monthlySalary:6000,automaticAssetStaffing:true});
    hr.employmentContracts.push({id:`LEG-EMP-${index}`,assetId:id,company:'mobility',ownerCompanyId:'mobility',name:`سائق قديم ${index}`,role:'سائق تنقل حضري',count:1,center:'شبكة الرياض الحضرية',salary:6000,startDay:0,termMonths:1200,status:'ساري',source:'legacy',automaticAssetStaffing:true,permanent:true});
  }
  hr.employmentContracts.push({id:'LEG-EMP-SOLD',assetId:'SOLD-OLD',company:'mobility',ownerCompanyId:'mobility',name:'سائق سابق',role:'سائق تنقل حضري',count:0,center:'شبكة الرياض الحضرية',salary:0,startDay:0,termMonths:1200,status:'منتهي',endedDay:12,automaticAssetStaffing:true,permanent:true});
  M.ensure(state);
  return env;
}
function mobilityDriverContracts(state){return state.advanced.labor.employmentContracts.filter(row=>row?.automaticAssetStaffing===true&&row.role==='سائق تنقل حضري'&&(row.ownerCompanyId||row.company)==='mobility');}

// With no active trips, validating an idle fleet must not build a per-identity map for every vehicle and driver.
// That extra allocation made the previous optimization slower than the original linear completion scan.
{
  const {state,M}=openedMobility('Mobility idle identity allocation probe');let idReads=0;
  const row=(id,fields)=>Object.defineProperty({ownerCompanyId:'mobility',centerId:'RUH',...fields},'id',{enumerable:true,get(){idReads++;return id;}});
  state.mobility.vehicles=Array.from({length:2000},(_,i)=>row(`IDLE-V-${i}`,{status:'available'}));
  state.mobility.drivers=Array.from({length:2000},(_,i)=>row(`IDLE-D-${i}`,{status:'online',assetId:`IDLE-V-${i}`}));
  M.onSimulationTime({state},600);
  assert.equal(idReads,0,'no active trip means no full-fleet identity indexing');
}

// Completing or timing out one trip uses the validation-built ID indexes, not another fleet scan.
for(const kind of ['complete','timeout']){
  const reads=tripLifecycleReads(kind);
  assert.deepEqual(reads,{vehicleReads:12000,driverReads:12000},`${kind} should read each fleet row only in the trusted validation pass`);
}

// Request filtering cost stays constant as city count grows; one queue grouping pass serves every center.
const oneCenterReads=measuredRequestReads(1),tenCenterReads=measuredRequestReads(10);
assert.equal(oneCenterReads,tenCenterReads,'adding centers must not rescan the full request list per center');
assert.ok(tenCenterReads<1500*5,`request-list passes must remain bounded: ${tenCenterReads}`);

// Legacy per-driver contracts compact to a center cohort; purchase adds to it and sale subtracts one driver.
{
  const env=legacyLedgerScenario(),{state,M,F}=env;
  const beforeCash=F.operating(state,'mobility');
  M.buyFleet({state},{quantity:2,centerId:'RUH',classId:'eco-ev'});
  const contracts=mobilityDriverContracts(state),active=contracts.filter(row=>row.status==='ساري'),former=contracts.filter(row=>row.status==='منتهي');
  assert.equal(state.mobility.driverLedgerVersion,1);
  assert.equal(active.length,1,'active Mobility drivers have one grouped HR contract for the center');
  assert.equal(active[0].count,4);assert.equal(active[0].salary,6000);assert.equal(active[0].mobilityDriverCohort,true);assert.equal(Object.hasOwn(active[0],'assetId'),false);
  assert.equal(former.length,1);assert.equal(former[0].mobilityFormerDriverCount,1,'legacy ended driver records are represented by a grouped historical row');
  assert.ok(state.mobility.vehicles.every(vehicle=>vehicle.staffing?.employmentContractId===active[0].id),'each vehicle links to the shared contract');
  assert.equal(active[0].count*active[0].salary,M.managementSnapshot(state).monthlyPayroll,'grouped ledger payroll matches per-driver payroll');
  assert.equal(state.mobility.drivers.length,4,'individual driver identities remain available to trip simulation');
  const sale=M.sellVehicle({state},{id:state.mobility.vehicles[0].id});
  assert.equal(sale.proceeds,25200);assert.equal(F.operating(state,'mobility')-beforeCash,-84000+25200,'purchase and sale preserve the established cash values');
  assert.equal(active[0].count,3);assert.equal(active[0].salary,6000);assert.equal(M.managementSnapshot(state).monthlyPayroll,18000);
  assert.equal(mobilityDriverContracts(state).filter(row=>row.status==='ساري').length,1);
}

// Loading an old save can compact its ledger without buying/selling; subsequent calls must do no fleet/HR scan.
{
  const {state,M}=openedMobility();delete state.mobility;
  const created=M.ensure(state);assert.equal(created.driverLedgerVersion,1,'a newly created empty company already has the current ledger format');
  const before=JSON.stringify(state);assert.equal(M.migrateLegacyDriverContracts(state).changed,false);assert.equal(JSON.stringify(state),before,'reloading a newly saved empty company changes no saved field');
}
{
  const {state,M,F}=legacyLedgerScenario(),cash=F.operating(state,'mobility'),finance=JSON.stringify(state.finance),drivers=JSON.stringify(state.mobility.drivers);
  assert.equal(M.migrateLegacyDriverContracts(state).changed,true);
  const active=mobilityDriverContracts(state).filter(row=>row.status==='ساري');
  assert.equal(active.length,1);assert.equal(active[0].count,2);assert.equal(active[0].count*active[0].salary,12000);
  assert.equal(F.operating(state,'mobility'),cash);assert.equal(JSON.stringify(state.finance),finance);assert.equal(JSON.stringify(state.mobility.drivers),drivers);
  const rows=state.mobility.vehicles;state.mobility.vehicles=new Proxy(rows,{get(){throw new Error('migration-rescanned-fleet');}});
  assert.equal(M.migrateLegacyDriverContracts(state).changed,false,'a completed migration returns before touching any fleet row');state.mobility.vehicles=rows;
}
// The generic aircraft/ship/truck migration must recognize Mobility cohorts as a separate completed format.
// Otherwise every reload clones the HR ledger and reprocesses all delivery batches just because this row has no assetIds.
{
  const {state,M}=legacyLedgerScenario();M.migrateLegacyDriverContracts(state);
  const {s:scope}=require('./helpers/core-harness').harness(['migration-core']),STORE=scope.GH_FLEET_STORE,MIGRATION=scope.GH_MIGRATION_CORE;
  const contracts=mobilityDriverContracts(state),rows=new Proxy(contracts,{get(target,key,receiver){if(key==='map')throw new Error('migration-reprocessed-complete-driver-cohort');return Reflect.get(target,key,receiver);}});
  const loaded={saveVersion:'3.0.0',fleet:STORE.create(),mobility:{ownerCompanyId:'mobility'},advanced:{labor:{employmentContracts:rows,hiringLog:[]}},realism:{procurement:{deliveries:[],pendingDeliveryCount:0}}};
  assert.equal(MIGRATION.migrateFleet(loaded).changed,false,'completed Mobility batching must keep the generic delivery migration on its existing fast exit');
}

// A new fixed-salary driver must join a cohort with those exact terms, including after a legacy save with other wages.
{
  const {state,M,HR}=legacyLedgerScenario(),hr=HR.ensure(state);
  hr.employmentContracts.find(row=>row.id==='LEG-EMP-0').salary=8000;
  state.mobility.drivers[0].monthlySalary=8000;state.mobility.vehicles[0].staffing.monthlyPayroll=8000;
  M.buyFleet({state},{quantity:1,centerId:'RUH',classId:'eco-ev'});
  const active=mobilityDriverContracts(state).filter(row=>row.status==='ساري'),added=state.mobility.vehicles.find(row=>row.id!=='LEG-V-0'&&row.id!=='LEG-V-1');
  assert.equal(active.reduce((sum,row)=>sum+row.count*row.salary,0),20000,'adding a 6000-salary driver raises the existing 14000 payroll by exactly 6000');
  assert.equal(active.find(row=>row.id===added.staffing.employmentContractId).salary,6000,'the new driver links to the matching wage cohort');
  M.sellVehicle({state},{id:added.id});assert.equal(active.reduce((sum,row)=>sum+(row.status==='ساري'?row.count*row.salary:0),0),14000,'sale preserves each remaining cohort wage');
}
{
  const {state,M,HR}=legacyLedgerScenario(),hr=HR.ensure(state);
  hr.employmentContracts.find(row=>row.id==='LEG-EMP-0').salary=0;
  const before=mobilityDriverContracts(state).reduce((sum,row)=>sum+(row.status==='ساري'?row.count*row.salary:0),0);
  M.buyFleet({state},{quantity:1,centerId:'RUH',classId:'eco-ev'});
  assert.equal(mobilityDriverContracts(state).reduce((sum,row)=>sum+(row.status==='ساري'?row.count*row.salary:0),0),before+6000,'migration preserves an explicit zero salary');
}
// Recover an unambiguous legacy link without reducing the wage of every driver left in the shared contract.
{
  const {state,M}=legacyLedgerScenario();M.buyFleet({state},{quantity:1,centerId:'RUH',classId:'eco-ev'});
  const vehicle=state.mobility.vehicles[0],cohort=mobilityDriverContracts(state).find(row=>row.id===vehicle.staffing.employmentContractId);
  delete vehicle.staffing.employmentContractId;M.sellVehicle({state},{id:vehicle.id});
  assert.equal(cohort.count,2);assert.equal(cohort.salary,6000,'repairing a missing link leaves the cohort per-driver salary intact');
}
for(const invalid of ['ambiguous','count-invalid']){
  const {state,M,HR}=legacyLedgerScenario();M.buyFleet({state},{quantity:1,centerId:'RUH',classId:'eco-ev'});
  const vehicle=state.mobility.vehicles[0],cohort=mobilityDriverContracts(state).find(row=>row.id===vehicle.staffing.employmentContractId);
  if(invalid==='ambiguous'){delete vehicle.staffing.employmentContractId;HR.ensure(state).employmentContracts.push({...cohort,id:'QA-DUPLICATE-COHORT'});}else cohort.count=0;
  const before=JSON.stringify(state);
  assert.throws(()=>M.sellVehicle({state},{id:vehicle.id}),new RegExp(`mobility-driver-contract-${invalid}`));
  assert.equal(JSON.stringify(state),before,`a ${invalid} contract refuses the sale and restores money and fleet exactly`);
}
{
  const {state,M,HR}=legacyLedgerScenario();M.buyFleet({state},{quantity:1,centerId:'RUH',classId:'eco-ev'});
  const before=JSON.stringify(state),original=HR.reconcileFacilityStaffing;
  HR.reconcileFacilityStaffing=function(...args){original.apply(this,args);throw new Error('build401-injected-after-driver-sale');};
  try{assert.throws(()=>M.sellVehicle({state},{id:state.mobility.vehicles[0].id}),/build401-injected-after-driver-sale/);}finally{HR.reconcileFacilityStaffing=original;}
  assert.equal(JSON.stringify(state),before,'failed grouped sale restores its cash, drivers, vehicles, contracts and references');
}
// A failure after compaction and purchase restores both the legacy ledger and Mobility state exactly.
{
  const env=legacyLedgerScenario(),{state,M,HR}=env,hr=HR.ensure(state),before=JSON.stringify(state),original=HR.executeHiring;
  HR.executeHiring=function(...args){original.apply(this,args);throw new Error('build401-injected-after-grouped-driver-ledger');};
  try{assert.throws(()=>M.buyFleet({state},{quantity:1,centerId:'RUH',classId:'eco-ev'}),/build401-injected-after-grouped-driver-ledger/);}
  finally{HR.executeHiring=original;}
  assert.equal(JSON.stringify(state),before,'failed grouped purchase rolls back the old contracts, fleet, and money');
}

console.log(JSON.stringify({suite:'build401-mobility-batching-and-indexes',fleetRowsPerTrip:12000,oneCenterRequestReads:oneCenterReads,tenCenterRequestReads:tenCenterReads,activeDriverContracts:1,groupedDriverCount:4,legacyHistoryRows:1,rollbackExact:true}));
