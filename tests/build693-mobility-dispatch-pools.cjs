'use strict';
// Build 693, plan batch 1 (W2; the owner: «لاتخلي شي من الخطه نفذه بدقه»): Mobility's dispatch filtered every centre's
// whole fleet and its drivers on every 600-second step and found each car with findIndex/splice (a «+ يوم» at 30,000
// cars: 2.1 s + 0.95 s, desktop). Each centre now keeps a pool of its available cars (all, by class, by zone) and online
// drivers, in the rows' order, kept up to date by the three edits that move a row in or out (a trip assigned, completed,
// released) and rebuilt after any other edit or a rollback. Proven on the real functions lifted from mobility-core.js,
// against the same functions with the former dispatch (dispatchScan, kept in the file) in its place:
//   1. 400 steps of a random history (3 centres, 3 classes, 4 zones, dedicated and shared drivers, verified and
//      unverified routes so trips complete and are released, cars sent to service and back by other edits, steps rolled
//      back): after every step the whole Mobility state is identical, byte for byte;
//   2. a centre whose rows hold the same car twice keeps no pool and is served by the former code (same results); a
//      driver id repeated in a later row is found as the scan found it (the last one);
//   3. weight: on a 3,000-car centre the pools read the cars' status once (to build) and not on each step; the former
//      code read every car on every step;
//   4. source: the three pool-keeping edits are the only keepRow(row,true); every other edit of a car or a driver keeps
//      it with keepRow(row), which makes the pools stale; a rollback makes them stale.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),espree=require('espree');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(ROOT,'WebApp/mobility-core.js'),'utf8'),ast=espree.parse(source,{ecmaVersion:'latest',range:true}),declared=new Map();
(function walk(node){if(!node||typeof node!=='object')return;if(node.type==='FunctionDeclaration')declared.set(node.id.name,source.slice(...node.range));for(const value of Object.values(node))if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object')walk(value);})(ast);
const COMMON=['keepRow','noteMapStructureChange','activeTripIds','rememberTripRow','streetRouteKey','validStreetRoute','simulationIndexes','resolveTripRows','tripDayRow','closeTripDays','pruneRequests','centerKpis','id','complete','releaseRoutingTimeouts','dispatchScan'];
const POOLS=['observePoolReplacement','poolStillValid','revalidatePools','poolSlot','poolPut','poolCut','poolQueue','poolAddVehicle','poolRemoveVehicle','poolLatest','poolAddDriver','poolRemoveDriver','poolHolder','dispatchPool','poolKnown','poolVehicleBack','poolDriverBack','dispatch'];
for(const name of [...COMMON,...POOLS])assert.ok(declared.has(name),`mobility-core.js declares ${name}`);
const PRELUDE=`const IMMUTABLE_ROWS=new Set(['tripArchive','events','streetRoutes']),simulationIndexCache=new WeakMap(),dispatchPools=new WeakMap(),ROUTE_WAIT_TIMEOUT_SECONDS=900,TRIP_DAY_ARCHIVE_LIMIT=400;let mapStructureVersion=0,poolReplacementObserved=false,poolReplaced=0,lastPoolHolder=null;const replacementTouches=[];
const clone=v=>JSON.parse(JSON.stringify(v)),now=s=>Math.max(0,Number(s.simSeconds)||0),hash=text=>{let h=2166136261>>>0;for(const c of String(text)){h^=c.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}return h>>>0;},random=(seed,min=0,max=1)=>min+(hash(seed)/4294967295)*(max-min);`;
// A realm: 'pools' runs the file as it is; 'scan' puts the former dispatch (dispatchScan) in dispatch's place.
function realm(kind){
  const box={console,structuredClone,reads:{status:0,on:false},scanCalls:0,walks:0,builds:0,revalidations:0};box.globalThis=box;vm.createContext(box);
  const fns=COMMON.map(name=>declared.get(name));
  if(kind==='pools')fns.push(...POOLS.map(name=>declared.get(name)).map(text=>text.startsWith('function dispatch(')?text.replace('const pool=dispatchPool(indexes,centerId);if(!pool)return dispatchScan(','const pool=dispatchPool(indexes,centerId);if(!pool)globalThis.scanCalls++;if(!pool)return dispatchScan('):text.startsWith('function revalidatePools(')?text.replace('function revalidatePools(holder){','function revalidatePools(holder){globalThis.revalidations++;'):text.startsWith('function poolRemoveDriver(')?text.replace('for(let i=pool.online.length-1;i>=0;i--){','for(let i=pool.online.length-1;i>=0;i--){globalThis.walks++;'):text.startsWith('function dispatchPool(')?text.replace('holder.centers.set(centerId,usable?pool:null);','globalThis.builds++;holder.centers.set(centerId,usable?pool:null);'):text));
  else fns.push(declared.get('dispatchScan').replace('function dispatchScan(','function dispatch('),'function poolVehicleBack(){}','function poolDriverBack(){}');
  vm.runInContext(`${PRELUDE}\n${fns.join('\n')}\nglobalThis.api={keepRow,simulationIndexes,complete,releaseRoutingTimeouts,dispatch};`,box);
  return box;
}
let seed=0;const rnd=()=>(seed=(seed*1103515245+12345)%2147483648)/2147483648,pick=list=>list[Math.floor(rnd()*list.length)];
const CENTRES=['RUH','JED','DXB'],CLASSES=['economy','comfort','van'],ZONES=['Z1','Z2','Z3','Z4'];
function world(cars,{doubled=false,twin=false,twinAcross=false,unique=false}={}){
  const vehicles=[],drivers=[],routes={};let n=0;
  for(const centerId of CENTRES)for(let i=0;i<cars;i++){const vid=`V${++n}`,dedicated=rnd()<.7,did=dedicated?`D${n}`:null;
    vehicles.push({id:vid,ownerCompanyId:'mobility',centerId,assetClass:pick(CLASSES),zoneId:pick(ZONES),status:rnd()<.85?'available':'maintenance',driverId:did,tripId:null,totalTrips:0,totalKm:0,battery:80});
    if(dedicated)drivers.push({id:did,ownerCompanyId:'mobility',centerId,assetId:vid,status:rnd()<.9?'online':'offline',zoneId:'Z1',tripId:null});}
  for(const centerId of CENTRES)for(let i=0;i<Math.max(2,cars/4);i++)drivers.push({id:`L-${centerId}-${i}`,ownerCompanyId:'mobility',centerId,status:rnd()<.8?'online':'offline',zoneId:'Z1',tripId:null});
  for(const centerId of CENTRES)for(const a of ZONES)for(const b of ZONES)if(rnd()<.6)routes[`${centerId}|${a}|${b}`]={route:[[24.7,46.7],[24.8,46.8]],durationSeconds:300+Math.floor(rnd()*1500),distanceKm:3+Math.floor(rnd()*20)};
  // A driver row repeated under the same id later in the list (the scan's maps took the last one): the pools must too.
  if(!unique)for(const centerId of CENTRES){const first=drivers.find(row=>row.centerId===centerId&&row.assetId);if(first)drivers.push({...first,zoneId:'Z2',status:'online'});}
  if(doubled)vehicles.splice(5,0,vehicles[3]);
  // Two distinct rows under one vehicle id (older saves keep them): the twin of an available car.
  if(twin){const first=vehicles.find(row=>row.centerId==='JED'&&row.status==='available');vehicles.push({...first,zoneId:ZONES.find(z=>z!==first.zoneId)});}
  // The same id in two centres (an older save): a trip of the one rewrites the other in place.
  if(twinAcross)for(const row of vehicles.filter(v=>v.centerId==='RUH'&&v.status==='available').slice(0,4))vehicles.push({...row,centerId:'JED',zoneId:ZONES.find(z=>z!==row.zoneId)});
  return {state:{simSeconds:0},m:{ownerCompanyId:'mobility',status:'active',vehicles,drivers,rideRequests:[],activeTrips:[],tripDays:[],tripArchive:[],events:[],streetRoutes:routes,kpis:{requests:0,accepted:0,completed:0,cancelled:0,grossBookings:0,driverPayouts:0,platformRevenue:0},kpisByCenter:{},sequence:0,routeSchemaVersion:3,lastDemandAtByCenter:{}}};
}
// The routes the file keys as streetRouteKey(center,from,to).
function rekey(box,w){const out={};for(const [key,row] of Object.entries(w.m.streetRoutes)){const [c,a,b]=key.split('|');out[vm.runInContext(`streetRouteKey(${JSON.stringify(c)},${JSON.stringify(a)},${JSON.stringify(b)})`,box)]=row;}w.m.streetRoutes=out;}
// One fake transaction per realm: keepRow keeps rows and registers its undo there.
function tx(box){const t={active:false,undos:[],memo:new Map(),observers:[],isActive:()=>t.active,registerUndo:f=>t.undos.push(f),transactionMemoGet:k=>t.memo.get(k),transactionMemoSet:(k,v)=>t.memo.set(k,v),registerStateReplacementObserver:f=>{t.observers.push(f);return ()=>{};}};box.GH_TRANSACTION_CORE=t;return t;}
function run(cars,steps,options={}){
  const out={};
  for(const kind of ['pools','scan']){
    seed=options.seed||11;const box=realm(kind),T=tx(box),w=world(cars,options);rekey(box,w);const {api}=box,m=w.m,state={...w.state,mobility:m};let at=0,rid=0;const states=[];
    let saved=null;
    for(let step=0;step<steps;step++){
      // A state restored in place (the recovery path's publish): the saved values written into the same rows and the
      // replacement observers told, as GH_TRANSACTION_CORE.publishObject does.
      if(options.saveAt===step)saved=JSON.parse(JSON.stringify(m));
      if(saved&&options.restoreAt===step){m.vehicles.forEach((row,i)=>Object.assign(row,saved.vehicles[i]));m.drivers.forEach((row,i)=>Object.assign(row,saved.drivers[i]));for(const key of Object.keys(saved))if(key!=='vehicles'&&key!=='drivers')m[key]=saved[key];at=saved.lastAt;for(const observe of T.observers)observe({phase:'after',target:state,ok:true});saved=null;}
      if(options.noopReplaceEvery&&step>0&&step%options.noopReplaceEvery===0)for(const observe of T.observers)observe({phase:'after',target:state,ok:true});
      // Review round 7: a publish whose snapshot holds the very mobility object (a command that never touched it), or
      // another one (its rows restored as the draft's), told as transaction-core does: 'before', then 'after'.
      for(const [every,same] of [[options.sameMobilityEvery,true],[options.otherMobilityEvery,false]])if(every&&step>0&&step%every===0){const snapshot={...state,mobility:same?m:{...m}};for(const observe of T.observers)observe({phase:'before',target:state,snapshot});for(const observe of T.observers)observe({phase:'after',target:state,snapshot,ok:true});}
      at+=600;state.simSeconds=at;m.lastAt=at;
      const rollback=options.rollback&&rnd()<.15,before=rollback?JSON.stringify({...m,vehicles:undefined,drivers:undefined}):null;
      T.active=true;T.undos=[];T.memo=new Map();
      const indexes=api.simulationIndexes(m);
      api.releaseRoutingTimeouts(m,at,indexes);api.complete(state,m,at,indexes);
      for(const centerId of CENTRES){const queued=[];const count=Math.floor(rnd()*7);for(let i=0;i<count;i++){const request={id:`R${++rid}`,ownerCompanyId:'mobility',centerId,fromZone:pick(ZONES),toZone:pick(ZONES),service:rnd()<.85?pick(CLASSES):'limo',status:'queued',requestedAt:at,distanceKm:5,fare:40};m.rideRequests.push(request);queued.push(request);}
        box.reads.on=true;api.dispatch(m,at,centerId,ZONES.map(id=>({id,coords:[24.7,46.7]})),indexes,queued);box.reads.on=false;}
      // Another edit (a car sent to service, back again): keepRow(row), as serviceVehicle does.
      if(options.edits&&rnd()<.2){const vehicle=m.vehicles[Math.floor(rnd()*m.vehicles.length)];if(vehicle.status!=='moving'){api.keepRow(vehicle);vehicle.status=vehicle.status==='available'?'maintenance':'available';}}
      if(rollback){for(const undo of T.undos.reverse())undo();const kept=JSON.parse(before);for(const key of Object.keys(kept))if(key!=='vehicles'&&key!=='drivers')m[key]=kept[key];}
      T.active=false;states.push(JSON.stringify(m));
    }
    out[kind]={states,reads:box.reads.status,scanCalls:box.scanCalls,walks:box.walks,builds:box.builds,revalidations:box.revalidations,m};
  }
  return out;
}

// 1.
{const r=run(30,400,{rollback:true,edits:true});
  for(let step=0;step<400;step++)if(r.pools.states[step]!==r.scan.states[step])assert.fail(`1: the state differs after step ${step+1}`);
  const done=r.pools.m.kpis;assert.ok(done.accepted>200&&done.completed>100&&done.cancelled>0,`1: the history assigned, completed and released trips (${JSON.stringify(done)})`);
  assert.equal(r.pools.scanCalls,0,'1: the pools served every call');}
{const r=run(8,300,{seed:5,edits:true});for(let step=0;step<300;step++)if(r.pools.states[step]!==r.scan.states[step])assert.fail(`1: small centres, the state differs after step ${step+1}`);}
console.log('1 ok: 700 steps with rollbacks and other edits, the same state after each');

// 2.
{const r=run(20,120,{seed:3,doubled:true});for(let step=0;step<120;step++)if(r.pools.states[step]!==r.scan.states[step])assert.fail(`2: the state differs after step ${step+1}`);
  assert.ok(r.pools.scanCalls>0,'2: the centre with a doubled car is served by the former code');}
console.log('2 ok: a doubled row falls back to the former code, same results');

// 3.
{const big=(kind)=>{seed=17;const box=realm(kind);tx(box);const w=world(1000);rekey(box,w);
    // Count the cars' status reads made by dispatch only.
    w.m.vehicles=w.m.vehicles.map(row=>new Proxy(row,{get(target,key,receiver){if(key==='status'&&box.reads.on)box.reads.status++;return Reflect.get(target,key,receiver);}}));
    const {api}=box,m=w.m,state={simSeconds:0,mobility:m};let at=0,rid=0;
    for(let step=0;step<40;step++){at+=600;state.simSeconds=at;const indexes=api.simulationIndexes(m);api.releaseRoutingTimeouts(m,at,indexes);api.complete(state,m,at,indexes);
      for(const centerId of CENTRES){const queued=[];for(let i=0;i<5;i++){const request={id:`R${++rid}`,ownerCompanyId:'mobility',centerId,fromZone:pick(ZONES),toZone:pick(ZONES),service:pick(CLASSES),status:'queued',requestedAt:at,distanceKm:5,fare:40};m.rideRequests.push(request);queued.push(request);}box.reads.on=true;api.dispatch(m,at,centerId,ZONES.map(id=>({id,coords:[24.7,46.7]})),indexes,queued);box.reads.on=false;}}
    return box.reads.status;};
  const pools=big('pools'),scan=big('scan');
  assert.ok(scan>=40*3000,`3: the former code read every car on every step (${scan})`);
  assert.ok(pools<=3000+200,`3: the pools read the cars once, to build (${pools} reads against ${scan})`);}
console.log('3 ok: the cars are read once, not on every step');

// 5. Review findings (a reader): a state restored in place; two rows under one vehicle id; no walk over the online drivers
// when a taken driver's id and asset are its own.
{const r=run(30,160,{seed:23,saveAt:60,restoreAt:64});for(let step=0;step<160;step++)if(r.pools.states[step]!==r.scan.states[step])assert.fail(`5: after a restore in place the state differs at step ${step+1}`);
  const moving=r.pools.m.vehicles.filter(v=>v.status==='moving').map(v=>v.id),trips=r.pools.m.activeTrips.map(t=>t.vehicleId);assert.equal(new Set(trips).size,trips.length,'5: no car holds two trips at once');assert.ok(moving.length>0);}
{const r=run(20,160,{seed:29,twin:true});for(let step=0;step<160;step++)if(r.pools.states[step]!==r.scan.states[step])assert.fail(`5: with two rows of one vehicle id the state differs at step ${step+1}`);assert.ok(r.pools.scanCalls>0,'5: that centre is served by the former code');}
{const r=run(200,60,{seed:31,unique:true});for(let step=0;step<60;step++)if(r.pools.states[step]!==r.scan.states[step])assert.fail(`5: the state differs at step ${step+1}`);assert.ok(r.pools.m.kpis.accepted>300,`5: many drivers taken (${r.pools.m.kpis.accepted})`);
  assert.equal(r.pools.walks,0,`5: a driver whose id and asset are its own is taken with no walk over the online drivers (${r.pools.m.kpis.accepted} taken)`);
  // With repeated ids (the world's duplicate driver of each centre) the walk runs, and the results stay the scan's (part 1).
  const d=run(200,60,{seed:31});assert.ok(d.pools.walks>0,'5: a repeated id still finds the driver the scan would');}
{for(const seed of [37,41,43]){const r=run(20,160,{seed,twinAcross:true});for(let step=0;step<160;step++)if(r.pools.states[step]!==r.scan.states[step])assert.fail(`5: with one vehicle id in two centres (seed ${seed}) the state differs at step ${step+1}`);}}
// Review round 6: a replacement that changed no row (a durable command elsewhere) keeps the pools (checked, not rebuilt).
{const quiet=run(30,120,{seed:41}),noisy=run(30,120,{seed:41,noopReplaceEvery:3});for(let step=0;step<120;step++)if(noisy.pools.states[step]!==noisy.scan.states[step])assert.fail(`5: with replacements the state differs at step ${step+1}`);
  assert.equal(noisy.pools.states.join(),quiet.pools.states.join(),'5: the same history');assert.ok(noisy.pools.builds<=quiet.pools.builds+3,`5: 40 replacements rebuilt no pool (${noisy.pools.builds} builds against ${quiet.pools.builds})`);}
// Review round 7 (a reader: the check ran on every durable command's publish, also for one that never touched mobility):
// a replacement whose snapshot holds the same mobility object checks nothing; one with another mobility is checked.
{const quiet=run(30,120,{seed:47}),same=run(30,120,{seed:47,sameMobilityEvery:2}),other=run(30,120,{seed:47,otherMobilityEvery:2});
  for(const r of [same,other])for(let step=0;step<120;step++)if(r.pools.states[step]!==r.scan.states[step])assert.fail(`5: with paired replacements the state differs at step ${step+1}`);
  assert.equal(same.pools.states.join(),quiet.pools.states.join(),'5: the same history');
  assert.equal(same.pools.revalidations,0,'5: 59 publishes with the mobility untouched: no pool checked');
  assert.ok(other.pools.revalidations>=50,`5: a publish with another mobility checks the pools (${other.pools.revalidations})`);
  // A restore in place told with its 'before' (a different mobility object): still the scan's results.
  const r=run(30,160,{seed:53,saveAt:60,restoreAt:64,otherMobilityEvery:7});for(let step=0;step<160;step++)if(r.pools.states[step]!==r.scan.states[step])assert.fail(`5: restore with paired events differs at step ${step+1}`);}
console.log('5 ok: restored in place, twin ids, no walk per driver');

// 4.
{const hot=source.match(/keepRow\((vehicle|driver),true\)/g)||[];assert.equal(hot.length,8,'4: four pool-keeping sites, a vehicle and a driver each (dispatch, its fallback, complete, release)');
  const lines=source.split('\n').filter(line=>/keepRow\((vehicle|driver),true\)/.test(line));
  for(const line of lines)assert.ok(/vehicle\.status='moving'|vehicle\.status='available'|driver\.status='online'/.test(line),`4: a pool-keeping edit moves a row in or out of a pool: ${line.trim().slice(0,120)}`);
  assert.ok(/function keepRow\(row,poolKept=false\)\{\n\s*if\(!poolKept\)keepRow\.epoch=\(keepRow\.epoch\|\|0\)\+1;/.test(source),'4: any other edit makes the pools stale');
  assert.ok(source.includes('tx.registerUndo(()=>{keepRow.epoch=(keepRow.epoch||0)+1;'),'4: a rollback makes the pools stale');
  assert.ok(/poolVehicleBack\(indexes,vehicle\);\}/.test(source)&&/poolDriverBack\(indexes,driver\);\}/.test(source),'4: a completed or released trip puts its car and driver back');}
console.log('build693 ok');
