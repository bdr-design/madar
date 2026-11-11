'use strict';
// Build 684 (a play of the whole game with 30,000 Mobility cars): ensure() regrouped every vehicle and every driver by
// centre for every simulation slice (60,000 rows, 37 ms a slice). The groups are now reused while the walk, which
// still checks every row's owner, finds every row to be the one the groups were built from, at the same place, with
// the same centre and the same driver. Proven on the real ensure() and simulationIndexes() lifted from the source,
// against the same functions made to build afresh every time (their kept groups are dropped before each call):
//   1. after every step of a long random history (trips started and finished, statuses edited, rows replaced, swapped,
//      doubled, removed, added, emptied, a centre or a driver changed, the arrays replaced, an old route schema) the indexes are
//      the same: the same groups with the same rows in the same order, the same counts, drivers and trip rows;
//   2. a step that changes no row, place, centre or driver reuses the groups (the same objects, and no group is
//      written); every other step builds them again;
//   3. a row of another owner is refused on a reused walk as on a fresh one, and a row with no owner is stamped.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),espree=require('espree');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(ROOT,'WebApp/mobility-core.js'),'utf8'),ast=espree.parse(source,{ecmaVersion:'latest',range:true}),declared=new Map();
(function walk(node){if(!node||typeof node!=='object')return;if(node.type==='FunctionDeclaration')declared.set(node.id.name,source.slice(...node.range));for(const value of Object.values(node))if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object')walk(value);})(ast);
const LIFTED=['keepRow','activeTripIds','rememberTripRow','streetRouteKey','validStreetRoute','simulationIndexes','ensure'];
for(const name of LIFTED)assert.ok(declared.has(name),`mobility-core.js declares ${name}`);
function realm(){
  const box={console,structuredClone,VERSION:'test',CLASSES:[],ZONES:[{id:'Z1',coords:[24.7,46.7]},{id:'Z2',coords:[24.8,46.8]}],mobilityOwnerCompanyId:()=> 'mobility',now:state=>state.simSeconds,centerMeta:()=>null,zonesFor:()=>box.ZONES};
  box.globalThis=box;vm.createContext(box);
  vm.runInContext(`const IMMUTABLE_ROWS=new Set(['tripArchive','events','streetRoutes']),simulationIndexCache=new WeakMap(),ROUTE_WAIT_TIMEOUT_SECONDS=900,clone=v=>JSON.parse(JSON.stringify(v));let mapWrites=0;{const set=Map.prototype.set;Map.prototype.set=function(...args){mapWrites++;return set.apply(this,args);};}\n${LIFTED.map(name=>declared.get(name)).join('\n')}\nglobalThis.api={ensure,simulationIndexes,drop:m=>simulationIndexCache.delete(m),kept:m=>simulationIndexCache.get(m),writes:()=>mapWrites};`,box);
  return box.api;
}
const live=realm(),fresh=realm();
// One description of the indexes: every Map and Set in order, each row by its place in the state (identity, not copy).
function describe(indexes,m){
  const place=new Map();m.vehicles.forEach((row,index)=>place.set(row,`v${index}`));m.drivers.forEach((row,index)=>place.set(row,`d${index}`));
  const rows=list=>list.map(row=>place.get(row)||`not-a-member:${row?.id}`);
  return {vehiclesByCenter:[...indexes.vehiclesByCenter].map(([key,list])=>[key,rows(list)]),driversByCenter:[...indexes.driversByCenter].map(([key,list])=>[key,rows(list)]),fleetCounts:[...indexes.fleetCounts],dedicatedDriverIds:[...indexes.dedicatedDriverIds],vehiclesById:[...indexes.vehiclesById].map(([key,list])=>[key,rows(list)]),driversById:[...indexes.driversById].map(([key,list])=>[key,rows(list)]),activeRouteKeys:[...indexes.activeRouteKeys]};
}
let seed=20261111;const random=()=>{seed=(Math.imul(seed,1103515245)+12345)>>>0;return seed/4294967296;},pick=list=>list[Math.floor(random()*list.length)];
const CENTRES=['RUH','JED','DXB',undefined];let serial=0;
const vehicle=()=>{const n=++serial;return {id:`MOB-V-${n}`,ownerCompanyId:'mobility',assetClass:'eco',status:'available',centerId:pick(CENTRES),driverId:random()<.8?`DRV-${n}`:undefined,zoneId:'Z1',tripId:null,totalTrips:0};};
const driver=n=>({id:`DRV-${n}`,ownerCompanyId:'mobility',status:'online',centerId:pick(CENTRES),zoneId:'Z1',tripId:null});
const state={simSeconds:1000,mobility:{routeSchemaVersion:3,vehicles:[],drivers:[],rideRequests:[],activeTrips:[],tripDays:[],tripArchive:[],events:[],capitalCenters:[],streetRoutes:{}}},m=state.mobility;
for(let i=0;i<400;i++){const row=vehicle();m.vehicles.push(row);m.drivers.push(driver(serial));}
// A legacy duplicate identity: two vehicles under one id (both must be found for a trip).
m.vehicles[5].id=m.vehicles[4].id;
const trip=()=>{const row=pick(m.vehicles);return {id:`TRIP-${++serial}`,ownerCompanyId:'mobility',vehicleId:row.id,driverId:pick(m.drivers).id,centerId:row.centerId||'RUH',fromZone:'Z1',toZone:'Z2'};};
// A place whose next member is another row (a row may be in an array twice after the doubling steps).
const differing=list=>{let index=Math.floor(random()*(list.length-1));while(list[index+1]===list[index])index=(index+1)%(list.length-1);return index;};
const STEPS={
  // rows, places, centres and drivers untouched: the groups are reused
  nothing(){},
  'trip started'(){m.activeTrips.push(trip());},
  'trip finished'(){if(m.activeTrips.length)m.activeTrips.splice(Math.floor(random()*m.activeTrips.length),1);},
  'statuses edited'(){for(let i=0;i<20;i++){const row=pick(m.vehicles);row.status=row.status==='moving'?'available':'moving';row.totalTrips++;pick(m.drivers).status='on-trip';}},
  'time passes'(){state.simSeconds+=600;},
  // an empty centre in another form is the same centre (RUH)
  'empty centre in another form'(){const row=m.vehicles.find(r=>!r.centerId),other=m.drivers.find(r=>!r.centerId);for(const x of [row,other])if(x)x.centerId=x.centerId===undefined?'':x.centerId===''?null:undefined;},
  // anything else: built again
  'vehicle replaced by a copy'(){const index=Math.floor(random()*m.vehicles.length);m.vehicles[index]={...m.vehicles[index]};},
  'driver replaced by a copy'(){const index=Math.floor(random()*m.drivers.length);m.drivers[index]={...m.drivers[index]};},
  'two vehicles swapped'(){const a=differing(m.vehicles),b=a+1;[m.vehicles[a],m.vehicles[b]]=[m.vehicles[b],m.vehicles[a]];},
  'two drivers swapped'(){const a=differing(m.drivers),b=a+1;[m.drivers[a],m.drivers[b]]=[m.drivers[b],m.drivers[a]];},
  'vehicle centre changed'(){const row=pick(m.vehicles);row.centerId=(row.centerId||'RUH')==='JED'?'DXB':'JED';},
  'driver centre changed'(){const row=pick(m.drivers);row.centerId=(row.centerId||'RUH')==='JED'?'DXB':'JED';},
  'no driver in another form'(){const row=m.vehicles.find(r=>!r.driverId)||m.vehicles[0];row.driverId=row.driverId===undefined?null:row.driverId===null?'':row.driverId===''?undefined:null;},
  'the same vehicle twice'(){const index=differing(m.vehicles);m.vehicles[index+1]=m.vehicles[index];},
  'the same driver twice'(){const index=differing(m.drivers);m.drivers[index+1]=m.drivers[index];},
  'vehicle driver changed'(){const row=pick(m.vehicles);row.driverId=row.driverId?undefined:`DRV-X${++serial}`;},
  'vehicle emptied in the middle'(){m.vehicles[Math.floor(random()*(m.vehicles.length-1))]=null;},
  'last vehicle emptied'(){m.vehicles[m.vehicles.length-1]=null;},
  'last driver emptied'(){m.drivers[m.drivers.length-1]=null;},
  'vehicle added'(){m.vehicles.push(vehicle());},
  'driver added'(){m.drivers.push(driver(++serial));},
  'vehicle removed'(){m.vehicles.splice(Math.floor(random()*m.vehicles.length),1);},
  'vehicles replaced by a new array'(){m.vehicles=m.vehicles.slice();},
  'drivers replaced by a new array'(){m.drivers=m.drivers.filter(()=>true);},
  'removed and added at once'(){m.vehicles.pop();m.vehicles.push(vehicle());},
};
const REUSED=new Set(['nothing','trip started','trip finished','statuses edited','time passes','empty centre in another form']),names=Object.keys(STEPS),counts={reused:0,rebuilt:0};
const run=label=>{
  const before=live.kept(m),beforeWrites=live.writes();
  live.ensure(state,'',{simulationIndexes:true});const afterWrites=live.writes(),mine=live.simulationIndexes(m),text=JSON.stringify(describe(mine,m));
  fresh.drop(m);fresh.ensure(state,'',{simulationIndexes:true});const reference=JSON.stringify(describe(fresh.simulationIndexes(m),m));
  assert.equal(text,reference,`${label}: the indexes equal a fresh build`);assert.ok(!text.includes('not-a-member'),`${label}: every indexed row is a member`);
  return {before,after:live.kept(m),groupWrites:afterWrites-beforeWrites,tripRows:mine.vehiclesById.size+mine.driversById.size};
};
run('first');
for(let i=0;i<1500;i++){
  const name=i<names.length*2?names[i%names.length]:pick(names);
  // Two walks: the first follows the step, the second finds nothing changed.
  STEPS[name]();const first=run(`${i} ${name}`);
  if(REUSED.has(name)){
    assert.ok(first.before&&first.after,`${i} ${name}: groups are kept`);
    for(const key of ['vehiclesByCenter','driversByCenter','fleetCounts','dedicatedDriverIds'])assert.equal(first.after.indexes[key],first.before.indexes[key],`${i} ${name}: ${key} is reused`);
    // Only the rows of the trips in progress are written (one Map entry per identity found).
    assert.ok(first.groupWrites<=first.tripRows,`${i} ${name}: a reused walk writes no group (${first.groupWrites} Map writes, ${first.tripRows} trip identities)`);counts.reused++;
  }else{
    assert.ok(first.after,`${i} ${name}: groups are kept after the rebuild`);assert.notEqual(first.after.indexes.vehiclesByCenter,first.before.indexes.vehiclesByCenter,`${i} ${name}: the groups are built again`);counts.rebuilt++;
  }
  const second=run(`${i} ${name} (again)`);assert.equal(second.after.indexes.vehiclesByCenter,second.before.indexes.vehiclesByCenter,`${i} ${name}: the walk after it reuses the groups`);
  assert.equal(m.vehicles.includes(null)||m.drivers.includes(null),false,`${i} ${name}: empty members are removed`);
}
assert.ok(counts.reused>200&&counts.rebuilt>600,JSON.stringify(counts));
// An old route schema keeps nothing (its repair edits the rows), and the walk after the repair builds with a proof.
{m.routeSchemaVersion=2;run('old schema');assert.equal(m.routeSchemaVersion,3);const first=run('after the repair'),second=run('after the repair (again)');assert.ok(first.after?.proof,'the walk after the repair keeps its proof');assert.equal(second.after.indexes.vehiclesByCenter,first.after.indexes.vehiclesByCenter);}
// 3. owners on a reused walk
{
  const before=live.kept(m);run('before the owner checks');assert.equal(live.kept(m).indexes.vehiclesByCenter,before.indexes.vehiclesByCenter,'the walk is a reused one');
  for(const [list,index] of [[m.vehicles,0],[m.vehicles,m.vehicles.length-1],[m.drivers,3]]){
    const row=list[index];row.ownerCompanyId='another-company';
    assert.throws(()=>live.ensure(state,'',{simulationIndexes:true}),/mobility-row-owner-conflict/,'a row of another owner is refused on a reused walk');
    fresh.drop(m);assert.throws(()=>fresh.ensure(state,'',{simulationIndexes:true}),/mobility-row-owner-conflict/);
    row.ownerCompanyId='mobility';
  }
  // An empty member and a row of another owner in one walk: refused, and the next walk equals a fresh build.
  {const row=m.drivers[5];m.vehicles[2]=null;row.ownerCompanyId='another-company';assert.throws(()=>live.ensure(state,'',{simulationIndexes:true}),/mobility-row-owner-conflict/);row.ownerCompanyId='mobility';run('after an empty member and a refused owner');}
  delete m.vehicles[9].ownerCompanyId;delete m.drivers[9].ownerCompanyId;const kept=live.kept(m)||null;run('rows with no owner');
  assert.equal(m.vehicles[9].ownerCompanyId,'mobility');assert.equal(m.drivers[9].ownerCompanyId,'mobility');
  if(kept)assert.equal(live.kept(m).indexes.vehiclesByCenter,kept.indexes.vehiclesByCenter,'stamping an owner keeps the groups');
}
console.log(JSON.stringify({suite:'build684-mobility-index-reuse',steps:1500,...counts,vehicles:m.vehicles.length,drivers:m.drivers.length,trips:m.activeTrips.length}));
console.log('BUILD684_MOBILITY_INDEX_REUSE_PASS');
