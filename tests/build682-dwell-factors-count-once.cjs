'use strict';
// Build 682, from a play of the whole game at a million assets (15 companies, 1,950 facilities, 30,000 mobility cars): the
// clock at any speed ran at 28 frames a second with three stalls of 180-330 ms a second, and one «+ يوم» took two minutes.
// The CPU profile put 38% of a day's close and 36% of play at 300× in GH_HR_CORE.facilityNeed: baseDwellFactors (app.js),
// run in every simulation slice, asked for each mobility centre's need with no count, so each of the 130 centres scanned
// every car. The cars are counted once for the call. Checked on the function as the page defines it, with the real owner:
//   1. the factors are the same numbers as before, for every kind of facility and every shape of the cars' list;
//   2. the cars are read once for the call, whatever the number of centres (they were read once per centre);
//   3. with no mobility centre the cars are not read at all; an owner without the counter still gives the same factors.
const path=require('node:path'),fs=require('node:fs'),vm=require('node:vm');
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const assert=require('node:assert/strict');
const {harness}=require('./helpers/core-harness');
const ROOT=process.env.GH_TEST_SOURCE_DIR,app=fs.readFileSync(path.join(ROOT,'WebApp','app.js'),'utf8');
const start=app.indexOf('  function baseDwellFactors(facilities){'),end=app.indexOf('  function simulationAssetRuntimeContext(){',start);assert.ok(start>=0&&end>start,'the factors are where the page defines them');
const h=harness([]);h.load('hr-core');const H=h.s.GH_HR_CORE;assert.equal(typeof H.facilityNeed,'function');assert.equal(typeof H.mobilityCenterCounts,'function','the owner offers its counter');
// The cars' list counts how many of its members are read.
const counted=rows=>{const reads={n:0};return {reads,list:new Proxy(rows,{get(target,key,receiver){if(typeof key==='string'&&/^\d+$/.test(key))reads.n++;return Reflect.get(target,key,receiver);}})};};
const lift=(state,owner=H)=>vm.runInNewContext(`(()=>{${app.slice(start,end)};return baseDwellFactors;})()`,{window:{GH_HR_CORE:owner},state,Math,Number,String});
// The factors as they were computed before: the owner asked for each facility with no count.
const before=(state,facilities)=>{const out={},models=state.advanced?.facilities||{};for(const f of facilities){if(!f?.owned||!f.id)continue;const need=Number(H.facilityNeed(f,state))||0;if(need<=0)continue;const have=Math.max(0,Number(models[f.id]?.staff)||0),coverage=Math.min(1,have/need);if(coverage<1)out[String(f.id)]=Math.round(Math.min(2,1+(1-coverage))*1000)/1000;}return out;};
const plain=value=>JSON.parse(JSON.stringify(value));
const cars=(centres,each)=>{const rows=[];for(const [index,id] of centres.entries())for(let i=0;i<each+index*7;i++)rows.push({id:`V-${id}-${i}`,centerId:id,status:i%3?'available':'moving'});return rows;};
const world=(centres,each,extraCars=[])=>{const facilities=[],models={};
  centres.forEach((id,index)=>{facilities.push({id:`MOB-${id}`,kind:'mobility-center',capitalId:id,owned:true,bays:3000});models[`MOB-${id}`]={staff:index%3===0?0:index%3===1?9:100000};});
  facilities.push({id:'AIR-1',kind:'airport-base',owned:true},{id:'PORT-1',kind:'port-base',owned:true},{id:'DEP-1',kind:'depot',owned:true,bays:400},{id:'PWR-1',kind:'power',owned:true,capacityAmount:1200},{id:'HTL-1',kind:'hotel',owned:true,roomCount:260},{id:'BANK-1',kind:'bank',owned:true},{id:'RENT-1',kind:'depot',owned:false,bays:900},{kind:'depot',owned:true},null,{id:'EX-FRA',name:'مقر'});
  Object.assign(models,{'AIR-1':{staff:3},'PORT-1':{staff:0},'DEP-1':{staff:20},'PWR-1':{staff:1},'HTL-1':{staff:500},'BANK-1':{}});
  const {reads,list}=counted([...cars(centres,each),...extraCars]);return {state:{advanced:{facilities:models},mobility:{vehicles:list}},facilities,reads};};

// 1. The same numbers.
{const centres=['RUH','JED','DXB','CAI','LHR','NYC','TYO'],shapes=[[],[null],[{id:'X',centerId:undefined}],[{id:'Y'}],[{id:'Z',centerId:NaN}],[{id:'W',centerId:'RUH'},{id:'Q',centerId:'nowhere'}]];
  for(const each of [0,1,39,40,41,400,2999])for(const extra of shapes){const w=world(centres,each,extra),now=plain(lift(w.state)(w.facilities)),was=plain(before(w.state,w.facilities));assert.deepEqual(now,was,`1: ${each} cars a centre, extra ${JSON.stringify(extra)}`);}
  const w=world(centres,400),now=plain(lift(w.state)(w.facilities));assert.ok(Object.keys(now).some(id=>id.startsWith('MOB-'))&&Object.keys(now).some(id=>!id.startsWith('MOB-')),'1: understaffed mobility centres and other bases are both listed');assert.ok(!('MOB-DXB' in now)&&now['MOB-RUH']===2,'1: a staffed centre is not listed; an empty one turns round at twice the time');
  // A centre with no capital id counts the cars with no centre, as before.
  const none=Array.from({length:80},(_,index)=>index%2?{id:`N${index}`}:{id:`N${index}`,centerId:undefined}),bare=H.facilityNeed({kind:'mobility-center'},{mobility:{vehicles:[]}}),odd={state:{advanced:{facilities:{'MOB-ODD':{staff:bare}}},mobility:{vehicles:[...none,{id:'C',centerId:'RUH'}]}},facilities:[{id:'MOB-ODD',kind:'mobility-center',owned:true}]};
  assert.ok(H.facilityNeed(odd.facilities[0],odd.state)>bare,'1: eighty cars with no centre raise the need of a centre with no capital id');assert.deepEqual(plain(lift(odd.state)(odd.facilities)),plain(before(odd.state,odd.facilities)),'1: a centre with no capital id');assert.ok(lift(odd.state)(odd.facilities)['MOB-ODD']>1,'1: and it is listed as understaffed');
  for(const state of [{advanced:{}},{},{advanced:{facilities:{}},mobility:{}}]){const facilities=[{id:'MOB-1',kind:'mobility-center',capitalId:'RUH',owned:true},{id:'DEP-1',kind:'depot',owned:true,bays:40}];assert.deepEqual(plain(lift(state)(facilities)),plain(before(state,facilities)),'1: a state with no cars');}}
console.log('1 ok: the factors are the same numbers');

// 2. One pass over the cars for the call.
{const centres=Array.from({length:130},(_,index)=>`C${index}`),w=world(centres,20),total=w.state.mobility.vehicles.length;assert.ok(total>50000,'2: 130 centres and tens of thousands of cars');
  const out=lift(w.state)(w.facilities);assert.ok(w.reads.n<=total,`2: each car is read once (${w.reads.n} reads of ${total} cars)`);assert.ok(Object.keys(out).length>0);
  const old=world(centres,20);before(old.state,old.facilities);assert.ok(old.reads.n>=total*130,`2: it was once per centre (${old.reads.n} reads)`);}
console.log('2 ok: the cars are read once for the call');

// 3. No mobility centre: the cars are not read. An owner without the counter: the same factors, the old way.
{const w=world([],0,cars(['RUH'],500));const out=lift(w.state)(w.facilities);assert.equal(w.reads.n,0,'3: with no mobility centre the cars are not read');assert.deepEqual(plain(out),plain(before(w.state,w.facilities)));
  const centres=['RUH','JED','DXB'],v=world(centres,120),without=Object.create(H,{mobilityCenterCounts:{value:undefined}});assert.deepEqual(plain(lift(v.state,without)(v.facilities)),plain(before(v.state,v.facilities)),'3: an owner without the counter gives the same factors');
  assert.deepEqual(plain(lift({advanced:{}},{})([{id:'X',kind:'depot',owned:true}])),{},'3: no owner, no factor');}
console.log('3 ok: no centre, no read; an owner without the counter still answers');
console.log('BUILD682_DWELL_FACTORS_COUNT_ONCE_PASS');
