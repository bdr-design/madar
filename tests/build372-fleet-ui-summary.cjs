'use strict';
// Differential gate for the pure worker-side UI fleet summary.  Every value
// below is also found with the original app predicates, including the port
// per-row Set deduplication and fleetBookValueTotal's numeric coercion.
const assert=require('node:assert/strict');
const path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const STORE=require(path.join(ROOT,'WebApp','fleet-store-core.js'));
const FLEET=require(path.join(ROOT,'WebApp','fleet-access-core.js'));
const SUMMARY=require(path.join(ROOT,'WebApp','fleet-ui-summary-core.js'));

const assets=[
  {id:'A1',ownerCompanyId:'sky',assetMode:'air',type:'air',phase:'turnaround',routeId:'AR-1',condition:82,purchasePrice:100.25,from:'Riyadh',to:'Jeddah',baseFacility:'AP-RUH',staffing:{ready:true,monthlyPayroll:1000.125,total:2}},
  {id:'A2',companyId:'sky',assetMode:'air',type:'air',phase:'idle',status:'moving',routeId:null,condition:64,purchasePrice:'200.5',from:'Doha',to:'Riyadh',baseFacility:'AP-RUH',salePending:true,staffing:{ready:true,monthlyPayroll:1000.125,total:2}},
  {id:'A3',assetMode:'air',type:'air',phase:'turnaround',routeId:null,condition:0,purchasePrice:-40,from:'Riyadh',to:'Riyadh',baseFacility:'AP-RUH',staffing:{ready:false,monthlyPayroll:999999,total:99}},
  {id:'S1',ownerCompanyId:'marine-co',assetMode:'sea',type:'sea',phase:'turnaround',routeId:'SR-1',condition:91,purchasePrice:500,from:'Jeddah',to:'Jeddah',baseFacility:'P-JED',staffing:{ready:true,monthlyPayroll:'250.5',total:'4'}},
  {id:'S2',ownerCompanyId:'marine-co',assetMode:'sea',type:'sea',phase:'turnaround',routeId:null,condition:70,purchasePrice:null,from:'Jeddah',to:'Dubai',baseFacility:'P-JED',staffing:{ready:true,monthlyPayroll:125.25,total:3}},
  {id:'S3',ownerCompanyId:'marine-co',assetMode:'sea',type:'sea',phase:'idle',routeId:null,condition:'84.5',purchasePrice:Infinity,from:'',to:'',baseFacility:'P-DXB'},
  // Compact-store payrollTotals deliberately does not infer a legacy owner;
  // this row proves the UI summary preserves that existing rule.
  {id:'R1',assetMode:'road',type:'road',phase:'moving',routeId:'RR-1',condition:99,purchasePrice:75,baseFacility:'D-1',staffing:{ready:true,monthlyPayroll:3300,total:2}},
  {id:'F1',ownerCompanyId:'sky',assetMode:'air',type:'air',routeId:'AR-FAULT',simulationFault:'bad-row',condition:88,purchasePrice:1,baseFacility:'AP-RUH',staffing:{ready:true,monthlyPayroll:'bad',total:NaN}},
  {id:'X1',ownerCompanyId:'odd',assetMode:'special',type:'sky',phase:'idle',routeId:null,condition:'bad',purchasePrice:'bad',baseFacility:0}
];
const options={legacyOwner:{air:'sky',road:'roads'},facilities:[
  {id:'AP-RUH',city:'Riyadh',mode:'air'},
  {id:'AP-JED',city:'Jeddah',mode:'air'},
  {id:'P-JED',city:'Jeddah',mode:'sea'},
  {id:'P-JED-2',city:'Jeddah',mode:'sea'},
  {id:'P-DXB',city:'Dubai',mode:'sea'}
]};
const state={simSeconds:12345,fleet:STORE.fromAssets(assets,{at:12345})};

const modeOf=row=>String(row?.assetMode||row?.type||'').trim();
const ownerOf=row=>String(row?.ownerCompanyId||row?.companyId||options.legacyOwner[modeOf(row)]||'').trim();
const views=[];FLEET.forEach(state,row=>views.push(row));
const result=SUMMARY.compute(state,FLEET,options),index=SUMMARY.lookup(result);
assert.equal(result.legacy,false);
assert.equal(result.asOfSimSeconds,state.simSeconds);
assert.equal(result.requestKey,SUMMARY.requestKey(options));

// Differential against the exact implementation used by
// GH_FLEET_CORE.monthlyPayroll/headcount.  It groups compact-store profiles
// before multiplication, so Object.is also checks the floating-point order.
const expectedPayroll=FLEET.payrollTotals(state),expectedPayrollRows=Object.values(expectedPayroll);
const expectedMonthlyPayroll=expectedPayrollRows.reduce((sum,row)=>sum+row.amount,0),expectedHeadcount=expectedPayrollRows.reduce((sum,row)=>sum+row.headcount,0);
assert.ok(Object.is(result.staffing.monthlyPayroll,expectedMonthlyPayroll),'monthly payroll is bit-identical to fleet payrollTotals');
assert.ok(Object.is(result.all.monthlyPayroll,expectedMonthlyPayroll),'owned-assets global payroll comes from the same pass');
assert.ok(Object.is(result.staffing.headcount,expectedHeadcount),'headcount is bit-identical to fleet payrollTotals');
assert.ok(Object.is(result.all.headcount,expectedHeadcount),'global headcount mirrors staffing summary');
assert.equal(result.staffing.staffedAssets,4,'only ready assets with a profile owner enter compact-store payroll');

for(const owner of ['sky','marine-co','roads','odd']){
  const rows=views.filter(row=>ownerOf(row)===owner),actual=index.owner(owner);
  assert.ok(actual,owner);assert.equal(actual.total,rows.length,`${owner}: total`);
  assert.equal(actual.moving,rows.filter(row=>FLEET.presentedPhase(state,row)==='moving').length,`${owner}: presented moving`);
  assert.equal(actual.movingRaw,rows.filter(row=>row.phase==='moving'||row.status==='moving').length,`${owner}: raw moving`);
  assert.equal(actual.routed,rows.filter(row=>row.routeId).length,`${owner}: routed`);
  assert.equal(actual.active,rows.filter(row=>row.routeId||row.phase==='moving'||row.status==='moving').length,`${owner}: active`);
  assert.equal(actual.needsService,rows.filter(row=>Number(row.condition)<85).length,`${owner}: service`);
  assert.equal(actual.healthy,rows.filter(row=>Number(row.condition)>=65).length,`${owner}: healthy`);
  assert.equal(actual.pendingSale,rows.filter(row=>row.salePending).length,`${owner}: pending`);
  assert.equal(actual.routeCount,new Set(rows.map(row=>row.routeId).filter(Boolean)).size,`${owner}: route count`);
  let condition=0,purchase=0,book=0,collateral=0;for(const row of rows){condition+=Number(row.condition)||100;purchase+=Math.max(0,Number(row.purchasePrice)||0);book+=Number((row.purchasePrice||0)*.7)||0;collateral+=Math.max(0,Number(row.purchasePrice)||0)*.55;}
  assert.ok(Object.is(actual.conditionSum,condition),`${owner}: condition sum`);
  assert.ok(Object.is(actual.purchasePrice,purchase),`${owner}: purchase sum`);
  assert.ok(Object.is(actual.bookValue70,book),`${owner}: book sum`);
  assert.ok(Object.is(actual.bankCollateral55,collateral),`${owner}: bank collateral sum`);
  assert.ok(Object.is(actual.monthlyPayroll,Number(expectedPayroll[owner]?.amount)||0),`${owner}: monthly payroll`);
  assert.ok(Object.is(actual.headcount,Number(expectedPayroll[owner]?.headcount)||0),`${owner}: payroll headcount`);
  assert.deepEqual(index.staffing(owner),expectedPayroll[owner]?{monthlyPayroll:expectedPayroll[owner].amount,headcount:expectedPayroll[owner].headcount,staffedAssets:2}:null,`${owner}: staffing lookup`);
  for(const mode of new Set(rows.map(modeOf)))assert.equal(index.ownerMode(owner,mode).total,rows.filter(row=>modeOf(row)===mode).length,`${owner}/${mode}`);
}

for(const mode of new Set(views.map(modeOf)))assert.equal(index.mode(mode).total,views.filter(row=>modeOf(row)===mode).length,`mode ${mode}`);
for(const type of new Set(views.map(row=>row.type)))assert.equal(index.type(type).total,views.filter(row=>row.type===type).length,`type ${type}`);
for(const base of ['AP-RUH','P-JED','P-DXB','D-1'])assert.equal(index.base(base),views.filter(row=>row.baseFacility===base).length,`base ${base}`);
let book=0;for(const row of views)book+=Number((row.purchasePrice||0)*.7)||0;assert.ok(Object.is(result.all.bookValue70,book),'global book value is bit-identical');

function planesAtAirport(f){return views.filter(row=>row.type==='air'&&((row.phase==='turnaround'&&(row.to===f.city||row.from===f.city))||(row.baseFacility===f.id&&!row.routeId))).length;}
function shipsAtPorts(ports){
  const idsByCity=new Map(),portIds=new Set(),counts=new Map();for(const port of ports){portIds.add(port.id);const city=String(port.city||'');if(!city)continue;const ids=idsByCity.get(city);if(ids)ids.push(port.id);else idsByCity.set(city,[port.id]);}
  for(const row of views){if(row.type!=='sea')continue;const matched=new Set();if(row.phase==='turnaround')for(const city of new Set([row.to,row.from].filter(Boolean)))for(const id of idsByCity.get(String(city))||[])matched.add(id);if(!row.routeId&&portIds.has(row.baseFacility))matched.add(row.baseFacility);for(const id of matched)counts.set(id,(counts.get(id)||0)+1);}
  return counts;
}
const airports=options.facilities.filter(row=>row.mode==='air'),ports=options.facilities.filter(row=>row.mode==='sea'),ships=shipsAtPorts(ports);
for(const row of airports)assert.equal(index.facility('air',row.id),planesAtAirport(row),`airport ${row.id}`);
for(const row of ports)assert.equal(index.facility('sea',row.id),ships.get(row.id)||0,`port ${row.id}`);
// A1 matches AP-RUH through its city, A2 through its base, and A3 through
// both city/base; A3 is still counted once.
assert.equal(index.facility('air','AP-RUH'),3,'airport union is deduplicated per row');
// S1 has the same endpoint twice; each Jeddah port still counts it once.
assert.equal(index.facility('sea','P-JED-2'),2,'port endpoints are deduplicated per row');

const stamp=SUMMARY.capture(state,FLEET,{...options,storeApi:STORE});
assert.equal(stamp.cacheable,true);assert.equal(SUMMARY.current(stamp,state,FLEET,{...options,storeApi:STORE}),true);
state.simSeconds++;assert.equal(SUMMARY.current(stamp,state,FLEET,{...options,storeApi:STORE}),false,'simulation time invalidates derived condition/phase counters');state.simSeconds--;
STORE.set(state.fleet,0,'salePending',true);assert.equal(SUMMARY.current(stamp,state,FLEET,{...options,storeApi:STORE}),false,'a fleet write invalidates the result');
const fresh=SUMMARY.capture(state,FLEET,{...options,storeApi:STORE});assert.equal(SUMMARY.current(fresh,state,FLEET,{...options,storeApi:STORE,facilities:options.facilities.slice(1)}),false,'a descriptor change invalidates the result');
const legacyState={simSeconds:0,assets:assets.map(row=>({...row}))},arrayFleet={scan(_state,_fields,fn){legacyState.assets.forEach(fn);},scanLength(){return legacyState.assets.length;},revision(){return null;},storeOf(){return null;}};
assert.equal(SUMMARY.capture(legacyState,arrayFleet,options).cacheable,false,'mutable legacy arrays are never cached as exact');

const unresolved=SUMMARY.compute({simSeconds:0},arrayFleet,{facilities:[]});assert.equal(unresolved.legacy,true,'a worker result without the legacy owner table is rejected');
const entryOwners=SUMMARY.compute(legacyState,arrayFleet,{legacyOwner:Object.entries(options.legacyOwner)});assert.equal(SUMMARY.lookup(entryOwners).owner('sky').total,index.owner('sky').total,'serialized legacy owner entries resolve once and exactly');
globalThis.GH_COMPANY_PLATFORM={ownerForLegacyAssetMode:mode=>options.legacyOwner[mode]};
const legacyPayroll=FLEET.payrollTotals(legacyState),legacyPayrollRows=Object.values(legacyPayroll),legacyMonthlyPayroll=legacyPayrollRows.reduce((sum,row)=>sum+row.amount,0),legacyHeadcount=legacyPayrollRows.reduce((sum,row)=>sum+row.headcount,0);
assert.ok(Object.is(entryOwners.staffing.monthlyPayroll,legacyMonthlyPayroll),'legacy-array payroll preserves the original per-row arithmetic');
assert.ok(Object.is(entryOwners.staffing.headcount,legacyHeadcount),'legacy-array staffing uses the same ownership fallback');
delete globalThis.GH_COMPANY_PLATFORM;
assert.throws(()=>SUMMARY.compute(state,FLEET,{facilities:[{city:'Riyadh',mode:'air'}]}),/facility-id-missing/);

console.log(JSON.stringify({ok:true,assets:result.all.total,owners:result.owners.length,facilities:result.facilities.length}));
