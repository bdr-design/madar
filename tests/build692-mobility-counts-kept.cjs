'use strict';
// Build 692, plan batch 1 (W1; the owner: «لاتخلي شي من الخطه نفذه بدقه»): every simulation slice built the runtime
// context twice (the fleet thread's request and the staleness check of its result), and each read every Mobility car to
// count the cars of each centre (GH_HR_CORE.mobilityCenterCounts): 30,000 cars twice a slice, about a second a day at a
// million assets (desktop). The counts are now kept for the vehicles array they were read from while its length holds.
// Checked on the real owner:
//   1. the counts are the same as a fresh count after every way the cars change: a purchase (pushed), a sale (the array
//      replaced by a filter), a rollback (the array put back), a whole state replaced, a random sequence of 300 changes;
//   2. a second read of an unchanged array reads no car; a change reads them once again;
//   3. an array holding a car with no centre (a save from before the migration) is never kept, so the migration that
//      gives it 'RUH' in place cannot leave the counts stale;
//   4. the staffing need (facilityNeed) of every centre is the same with the kept counts as with the old per-centre scan;
//   5. source: Mobility changes the cars' list only by a push or by replacing it (no splice, no index write, no centre
//      written on an existing car outside the legacy migration), which is what makes the key sound.
const path=require('node:path'),fs=require('node:fs');
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const assert=require('node:assert/strict');
const {harness}=require('./helpers/core-harness');
const ROOT=process.env.GH_TEST_SOURCE_DIR;
const h=harness([]);h.load('hr-core');const H=h.s.GH_HR_CORE;
const fresh=vehicles=>{const counts=new Map();for(const vehicle of vehicles){const center=vehicle?.centerId;if(center===center)counts.set(center,(counts.get(center)||0)+1);}return counts;};
const same=(kept,label,vehicles)=>assert.equal(JSON.stringify([...kept].sort()),JSON.stringify([...fresh(vehicles)].sort()),label);
const counted=rows=>{const reads={n:0};return {reads,list:new Proxy(rows,{get(target,key,receiver){if(typeof key==='string'&&/^\d+$/.test(key))reads.n++;return Reflect.get(target,key,receiver);}})};};
let serial=0;const car=center=>({id:`MOB-V-${++serial}`,centerId:center});
const CENTRES=['RUH','JED','DXB','CAI'];

// 1 and 2.
{const state={mobility:{routeSchemaVersion:3,vehicles:Array.from({length:120},(_,i)=>car(CENTRES[i%4]))}};
  same(H.mobilityCenterCounts(state),'1: first read',state.mobility.vehicles);
  assert.equal(H.mobilityCenterCounts(state),H.mobilityCenterCounts(state),'2: an unchanged array gives the kept counts');
  // A purchase (mobility-core vehicleBatch: m.vehicles.push).
  state.mobility.vehicles.push(car('JED'),car('JED'),car('NEW'));same(H.mobilityCenterCounts(state),'1: after a purchase',state.mobility.vehicles);
  // A sale (mobility-core: m.vehicles=m.vehicles.filter(...)).
  const before=state.mobility.vehicles;state.mobility.vehicles=state.mobility.vehicles.filter(row=>row.centerId!=='DXB');same(H.mobilityCenterCounts(state),'1: after a sale',state.mobility.vehicles);
  // A rollback puts the earlier array back: its own counts, not the sold ones.
  state.mobility.vehicles=before;same(H.mobilityCenterCounts(state),'1: after a rollback',state.mobility.vehicles);
  // A rollback of a purchase that truncates the same array in place.
  const length=state.mobility.vehicles.length;state.mobility.vehicles.push(car('RUH'));H.mobilityCenterCounts(state);state.mobility.vehicles.length=length;same(H.mobilityCenterCounts(state),'1: after a purchase rolled back in place',state.mobility.vehicles);
  // A whole state replaced (a load).
  const loaded={mobility:{routeSchemaVersion:3,vehicles:JSON.parse(JSON.stringify(state.mobility.vehicles))}};same(H.mobilityCenterCounts(loaded),'1: a loaded state',loaded.mobility.vehicles);
  // 300 random changes, each as Mobility makes them.
  let seed=7;const rnd=()=>(seed=(seed*1103515245+12345)%2147483648)/2147483648;
  for(let step=0;step<300;step++){const r=rnd(),m=state.mobility;
    if(r<.45){const n=1+Math.floor(rnd()*5);for(let i=0;i<n;i++)m.vehicles.push(car(CENTRES[Math.floor(rnd()*4)]));}
    else if(r<.8){const id=m.vehicles[Math.floor(rnd()*m.vehicles.length)]?.id;m.vehicles=m.vehicles.filter(row=>row.id!==id);}
    else if(r<.9){const kept=m.vehicles,len=kept.length;m.vehicles.push(car('RUH'));H.mobilityCenterCounts(state);kept.length=len;m.vehicles=kept;}
    same(H.mobilityCenterCounts(state),`1: random change ${step}`,state.mobility.vehicles);}}
{const {reads,list}=counted(Array.from({length:500},(_,i)=>car(CENTRES[i%4]))),state={mobility:{routeSchemaVersion:3,vehicles:list}};
  H.mobilityCenterCounts(state);assert.equal(reads.n,500,'2: the first read reads every car');
  reads.n=0;for(let i=0;i<10;i++)H.mobilityCenterCounts(state);assert.equal(reads.n,0,'2: ten more reads of the same array read no car');
  list.push(car('RUH'));reads.n=0;H.mobilityCenterCounts(state);assert.equal(reads.n,501,'2: a purchase reads them once again');}
console.log('1 ok, 2 ok: the counts follow every change, and an unchanged array is not read again');

// 3.
{const vehicles=[car('RUH'),{id:'LEGACY-1'},{id:'LEGACY-2',centerId:undefined},car('JED')],state={mobility:{vehicles}};
  assert.equal(H.mobilityCenterCounts(state).get('RUH'),1,'3: before the migration');
  for(const vehicle of vehicles)vehicle.centerId=vehicle.centerId||'RUH';state.mobility.routeSchemaVersion=3;
  assert.equal(H.mobilityCenterCounts(state).get('RUH'),3,'3: the migration in place is seen (the array was never kept)');
  assert.equal(H.mobilityCenterCounts(state),H.mobilityCenterCounts(state),'3: once every car has a centre the array is kept');}
// Review round 7 (a reader): a transaction runs the migration (centres given in place, the version set to 3), the counts
// are read, then it rolls back in place with no replacement (restoreScoped): the centres and the version come back. The
// counts are those of the restored cars, not the migrated ones; and before the migration nothing is kept at all.
{const vehicles=[car('JED'),{id:'LEGACY-R1'},{id:'LEGACY-R2'},car('JED')],state={mobility:{routeSchemaVersion:2,vehicles}};
  for(let i=0;i<3;i++)assert.equal(H.mobilityCenterCounts(state).has('RUH'),false,'3: before the migration');
  const saved=vehicles.map(v=>v.centerId);for(const vehicle of vehicles)vehicle.centerId=vehicle.centerId||'RUH';state.mobility.routeSchemaVersion=3;
  assert.equal(H.mobilityCenterCounts(state).get('RUH'),2,'3: inside the transaction, migrated');H.mobilityCenterCounts(state);
  vehicles.forEach((v,i)=>{v.centerId=saved[i];});state.mobility.routeSchemaVersion=2;
  same(H.mobilityCenterCounts(state),'3: rolled back in place: the restored cars, not the migrated counts',vehicles);assert.equal(H.mobilityCenterCounts(state).has('RUH'),false);
  // A complete set of centres still is not kept before the migration (an in-place repair may follow).
  const whole={mobility:{routeSchemaVersion:2,vehicles:[car('RUH'),car('JED')]}};assert.notEqual(H.mobilityCenterCounts(whole),H.mobilityCenterCounts(whole),'3: not kept before version 3');}
// Review round 4: a falsy centre ('' , 0, NaN) is rewritten by the migration as a missing one is.
for(const falsy of ['',0,NaN,false]){const vehicles=[car('RUH'),{id:'LEGACY-F',centerId:falsy}],state={mobility:{vehicles}};H.mobilityCenterCounts(state);
  for(const vehicle of vehicles)vehicle.centerId=vehicle.centerId||'RUH';assert.equal(H.mobilityCenterCounts(state).get('RUH'),2,`3: a centre ${String(falsy)||"''"} migrated in place is seen`);}
console.log('3 ok: a save from before the migration is never kept');

// 4.
{const vehicles=Array.from({length:3000},(_,i)=>car(CENTRES[i%4==3?0:i%4])),state={mobility:{routeSchemaVersion:3,vehicles}},counts=H.mobilityCenterCounts(state);
  for(const capitalId of [...CENTRES,'NONE']){const f={id:`MOB-${capitalId}`,kind:'mobility-center',capitalId,owned:true};assert.equal(H.facilityNeed(f,state,counts),H.facilityNeed(f,state),`4: the need of ${capitalId}`);}}
console.log('4 ok: the staffing need is the same');

// 5.
{const mobility=fs.readFileSync(path.join(ROOT,'WebApp','mobility-core.js'),'utf8'),app=fs.readFileSync(path.join(ROOT,'WebApp','app.js'),'utf8');
  for(const [name,text] of [['mobility-core.js',mobility],['app.js',app]]){
    assert.ok(!/vehicles\.(splice|copyWithin|fill|reverse|sort|shift|unshift|pop)\(/.test(text),`5: ${name} edits no cars' list in place`);
    assert.ok(!/vehicles\[[^\]]+\]\s*=(?!=)/.test(text),`5: ${name} writes no car by index`);}
  const centreWrites=(mobility.match(/vehicle\.centerId\s*=(?!=)/g)||[]).length;assert.equal(centreWrites,1,'5: one centre written on an existing car');
  assert.ok(mobility.includes("vehicle.centerId=vehicle.centerId||'RUH'"),'5: and it is the legacy migration (a missing centre only)');
  const hr=fs.readFileSync(path.join(ROOT,'WebApp','hr-core.js'),'utf8');assert.match(hr,/if\(settled&&Array\.isArray\(vehicles\)&&!unplaced&&!between\)\{const cache=mobilityCountCache,entry=\{length:vehicles\.length,counts\};/,'5: only an array with every car placed, after the migration, is kept');}
// 6. Review (a reader): a durable command publishes into the live state in place (the same vehicles array, its rows
// rewritten): a sale, then a purchase in another centre (the same length, no read between) must not read the old counts.
{const h2=harness([]);h2.load('transaction-core');h2.load('hr-core');const H2=h2.s.GH_HR_CORE,TX=h2.s.GH_TRANSACTION_CORE;assert.equal(typeof TX?.publishObject,'function','6: the transaction owner is loaded');
  const car=(id,centerId)=>({id,ownerCompanyId:'mobility',centerId,status:'available'}),truth=s=>{const out={};for(const v of s.mobility.vehicles)out[v.centerId]=(out[v.centerId]||0)+1;return out;},read=s=>Object.fromEntries([...H2.mobilityCenterCounts(s)]);
  const state={simSeconds:0,mobility:{vehicles:[car('V1','RUH'),car('V2','RUH'),car('V3','JED')]}};assert.deepEqual(read(state),{RUH:2,JED:1});
  {const draft=structuredClone(state);draft.mobility.vehicles=draft.mobility.vehicles.filter(v=>v.id!=='V2');TX.publishObject(state,draft);}
  {const draft=structuredClone(state);draft.mobility.vehicles.push(car('V4','JED'));TX.publishObject(state,draft);}
  assert.equal(state.mobility.vehicles.length,3,'6: the same length');assert.deepEqual(read(state),truth(state),'6: the counts after a sale and a purchase published in place');}
console.log('6 ok: a publish in place drops the kept counts');
// 7. Review round 7: the real transaction owner's scoped rollback puts the centres and the version back in place (no
// replacement event); the counts read inside the failed transaction do not survive it.
{const h3=harness([]);h3.load('transaction-core');h3.load('hr-core');const H3=h3.s.GH_HR_CORE,TX=h3.s.GH_TRANSACTION_CORE;
  const state={simSeconds:0,mobility:{routeSchemaVersion:2,vehicles:[{id:'L1',centerId:'JED'},{id:'L2'},{id:'L3'}]}};
  assert.throws(()=>TX.execute(state,{label:'qa-migrate-then-fail',scope:['mobility'],apply:()=>{for(const v of state.mobility.vehicles)v.centerId=v.centerId||'RUH';state.mobility.routeSchemaVersion=3;assert.equal(H3.mobilityCenterCounts(state).get('RUH'),2);H3.mobilityCenterCounts(state);throw new Error('qa-fail');}}),/qa-fail/);
  assert.equal(state.mobility.routeSchemaVersion,2,'7: the version is restored');assert.equal(state.mobility.vehicles[1].centerId,undefined,'7: the centre is restored');
  same(H3.mobilityCenterCounts(state),'7: the counts after the rollback are the restored cars\'',state.mobility.vehicles);}
console.log('7 ok: a migration rolled back leaves no counts behind');
// 8. Review round 7 (a verifier: part 7 deep-clones the root): the real migration (GH_MOBILITY_CORE.ensure, centres given
// through keepRow) inside a transaction with Mobility's own row policy (rows level: the root's fields captured, the rows
// restored by keepRow's undo) that fails: the version and the centres come back, and the counts read inside leave with
// the rollback (review round 10: the transaction's undo drops them), so even a later version 3 with other centres on the
// same array reads its own counts.
{const h4=harness([]);for(const n of ['transaction-core','mobility-core','hr-core'])h4.load(n);const TX=h4.s.GH_TRANSACTION_CORE,M=h4.s.GH_MOBILITY_CORE,H4=h4.s.GH_HR_CORE;
  const state={simSeconds:3600};M.ensure(state);const m=state.mobility,cls=M.CLASSES[0].id;m.vehicles.push({id:'MOB-V-R1',assetClass:cls,centerId:'JED',status:'available'},{id:'MOB-V-R2',assetClass:cls,status:'available'},{id:'MOB-V-R3',assetClass:cls,status:'available'});m.routeSchemaVersion=2;
  let inside=null;assert.throws(()=>TX.execute(state,{label:'qa-row-policy-migration',scope:['mobility'],rowRoots:{mobility:M.ROLLBACK_POLICY},apply:()=>{M.ensure(state);inside=Object.fromEntries(H4.mobilityCenterCounts(state));H4.mobilityCenterCounts(state);throw new Error('qa-fail');}}),/qa-fail/);
  assert.deepEqual(inside,{JED:1,RUH:2},'8: the migration ran inside');assert.equal(state.mobility,m,'8: rolled back in place (no replacement)');assert.equal(m.routeSchemaVersion,2,'8: the version is restored');
  assert.deepEqual(Array.from(m.vehicles,v=>v.centerId),['JED',undefined,undefined],'8: the centres are restored');same(H4.mobilityCenterCounts(state),'8: the counts are the restored cars\'',m.vehicles);
  for(const v of m.vehicles)if(!v.centerId)v.centerId='DXB';m.routeSchemaVersion=3;same(H4.mobilityCenterCounts(state),'8: the same array at version 3 with other centres reads them, not the counts of the failed transaction',m.vehicles);assert.equal(H4.mobilityCenterCounts(state).get('DXB'),2);}
console.log('8 ok: the real migration rolled back under the row policy leaves no counts behind');
// 9. Review round 10 (a verifier): read between the steps of a staged transaction (no transaction is active there, so no
// undo can be registered) and then aborted: nothing was kept, so the counts after the abort are the restored cars'; and
// a read inside a step, then an abort, is dropped by the step's undo.
{const h5=harness([]);h5.load('transaction-core');h5.load('hr-core');const TX=h5.s.GH_TRANSACTION_CORE,H5=h5.s.GH_HR_CORE;
  const st=()=>({simSeconds:0,mobility:{routeSchemaVersion:3,vehicles:[{id:'A',centerId:'RUH'},{id:'B',centerId:'RUH'},{id:'C',centerId:'JED'}]}});
  const swap=s=>{const v=s.mobility.vehicles;v.length=0;v.push({id:'A',centerId:'DXB'},{id:'D',centerId:'DXB'},{id:'C',centerId:'DXB'});};
  {const s=st(),job=TX.beginStaged(s,{label:'qa-staged-gap',scope:['mobility'],apply:function*(){swap(s);yield 'a';yield 'b';}});job.step();job.step();assert.equal(H5.mobilityCenterCounts(s).get('DXB'),3,'9: read between steps');job.abort('qa');
    same(H5.mobilityCenterCounts(s),'9: after the abort, the restored cars\' counts (nothing kept between steps)',s.mobility.vehicles);assert.equal(H5.mobilityCenterCounts(s).get('RUH'),2);}
  {const s=st(),job=TX.beginStaged(s,{label:'qa-staged-inside',scope:['mobility'],apply:function*(){swap(s);H5.mobilityCenterCounts(s);yield 'a';}});job.step();job.abort('qa');
    same(H5.mobilityCenterCounts(s),'9: a read inside a step is dropped with the abort',s.mobility.vehicles);}}
console.log('9 ok: staged transactions leave no counts behind');
console.log('build692 ok');
