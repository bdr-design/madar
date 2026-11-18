'use strict';
// Owner decisions (17 Nov 2026, batch F): the daily close checks EVERY asset under its company's line (C1; the former
// 2,000 a day cap, worst first, left a larger fleet under the line for good), a check is priced by the wear it restores
// (B1: price x CHECK_COST x (100 - condition) / 20, so a check at the standard line costs what it did), and a checked
// aircraft starts again at 0 flight hours, next check at 600 (fault 2). Up to 16,384 rows are restored by id (128 a
// step), more through one ordered column plan in slices (build705 1b). Proven with the real owners, on the array fleet and the Fleet Store:
//  1. 2,400 aircraft at 70% (more than the old cap): one close checks all 2,400,
//     bills each at its wear, resets their hours and restores them to 100%;
//  2. 1,000 of them wear back to 75% and 400 to 85% (above the line): the next close (by id) checks exactly the 1,000;
//  3. the worker pass (fleet-day-core) lists the same rows (maintenanceRows, ascending) and the same sums in row order,
//     and writes the reset hours into its counter plan;
//  4. the bill is the rows' check cost; the page states the rule;
//  5. a check adds no field outside the columns (no extras entry in the Fleet Store), and a road row gets no hours;
//  6. the two passes keep the same price code.
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||require('path').resolve(__dirname,'..');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ROOT=process.env.GH_TEST_SOURCE_DIR;
const {scenario}=require('./helpers/business-scenario'),DAY=require(path.join(ROOT,'WebApp/fleet-day-core.js'));
const N=2400,DAYS=86400,results=[];
for(const mode of ['array','store']){
  const {s,state,ctx,item}=scenario(),R=s.GH_REALISM,FLEET=s.GH_FLEET_DATA,STORE=s.GH_FLEET_STORE;
  state.globalBases.find(row=>row.id==='B1').deliveryCapacity=N;s.GH_FINANCE_CORE.book(state,'air').accounts[0].balance=1e15;
  const out=s.GH_DOMAIN_COMMANDS.dispatch(ctx,'procurement','purchase-assets',{type:'air',assetMode:'air',assetClass:'aircraft',tab:'new',item,base:state.globalBases.find(row=>row.id==='B1'),supplier:ctx.supplierFor(),mode:'cash',qty:N,manual:true,requestRef:'CHECK-ALL-QA',upfront:item.price*N,totalPrice:item.price*N,documentLeadDays:1,leadSeconds:0,immediateDelivery:true},{actor:'maintenance-qa',idempotencyKey:'CHECK-ALL-QA'});
  assert.ok(out.ok);R.onSimulationTime(state,state.simSeconds);
  if(mode==='store'&&FLEET.mode(state)!=='store'){const plain=state.assets.map(a=>JSON.parse(JSON.stringify(a)));state.fleet=STORE.fromAssets(plain,{at:state.simSeconds});delete state.assets;}
  assert.equal(FLEET.mode(state),mode);
  const ids=[];FLEET.scan(state,['id'],row=>{ids.push(row.id);});assert.equal(ids.length,N);
  const set=(list,patch)=>{for(const id of list)FLEET.update(state,id,patch);};
  const rows=()=>{const map=new Map();FLEET.scan(state,['id','condition','flightHours','nextCheckHours'],row=>{map.set(row.id,{condition:row.condition,hours:row.flightHours,next:row.nextCheckHours});});return map;};
  const worker=()=>{const result=DAY.compute(state,FLEET,{storeApi:STORE});return {acc:result.maintenance.find(([owner])=>owner==='air')[1],rows:Array.from(result.maintenanceRows),plan:result.columns};};
  let day=Math.floor(state.simSeconds/DAYS)+1;
  const close=()=>{const expected=worker(),before=rows();state.simSeconds=day*DAYS;R.onDay(state,day);const after=rows(),checked=ids.filter(id=>before.get(id).condition<80&&after.get(id).condition===100);return {day:day++,expected,before,checked,after,row:state.realism.maintenance.companies.air};};
  const range=(a,b)=>ids.slice(a,b),price=Math.max(0,Number(item.price)||0),cost=condition=>price*.004*(100-condition)/20;
  assert.equal(R.maintenancePolicy(state,'air'),'standard');assert.equal(typeof R.checkCost,'function');assert.equal(R.checkCost(price,'air',80),price*.004,'a check at the standard line costs the former flat price');
  // 1. Every one of 2,400 aircraft at 70%.
  set(ids,{condition:70,flightHours:700,nextCheckHours:600});const first=close();
  assert.deepEqual(first.checked,ids,`${mode}: every aircraft under the line is checked in one close`);
  assert.deepEqual(first.expected.rows,ids.map((_,index)=>index),`${mode}: the worker pass lists the same rows, ascending`);
  assert.equal(first.row.checks,N);assert.equal(first.expected.acc.checks,N);
  assert.ok(ids.every(id=>first.after.get(id).hours===0&&first.after.get(id).next===600),`${mode}: a checked aircraft starts again at 0 hours, next check at 600`);
  // The worker writes the same reset through its counter plan (fields flightHours, flightCycles, nextCheckHours).
  const plan=first.expected.plan;assert.equal(plan.count+plan.exceptional.count,N);for(let i=0;i<plan.count;i++){assert.equal(plan.values[i*3],0);assert.equal(plan.values[i*3+2],600);}
  // 2. 1,000 wear to 75% and 400 to 85%: the next close, by id, checks exactly the 1,000.
  set(range(0,1000),{condition:75});set(range(1000,1400),{condition:85});const second=close();
  assert.deepEqual(second.checked,range(0,1000),`${mode}: only the rows under the line`);assert.deepEqual(second.expected.rows,range(0,1000).map((_,index)=>index));
  assert.ok(range(1000,1400).every(id=>second.after.get(id).condition===85),`${mode}: above the line, not checked`);
  // 3. and 4. Sums in row order, and the bill.
  for(const [label,run,cond] of [['first',first,()=>70],['second',second,()=>75]]){
    let restored=0,total=0;for(const id of run.checked){restored+=100-cond(id);total+=cost(cond(id));}
    assert.ok(Object.is(run.expected.acc.restored,restored),`${mode} ${label}: restored summed in row order`);assert.ok(Object.is(run.expected.acc.cost,total),`${mode} ${label}: cost summed in row order`);
    const bill=state.finance.payables.find(doc=>doc.number===`MNT-AIR-${run.day}`);assert.ok(bill,`${mode} ${label}: a maintenance invoice`);assert.equal(run.row.cost,Math.round(total));assert.equal(Number(bill.amount),Math.round(total),`${mode} ${label}: the bill is the rows' check cost`);
  }
  assert.equal(first.row.cost,Math.round(N*cost(70)),`${mode}: at 70% a check costs 1.5 times the line's`);
  assert.equal(second.row.avgCondition,(1000*100+400*85+1000*100)/N,`${mode}: the fleet average after the checks`);
  // 5. No field outside the columns.
  const stamped=[];FLEET.scan(state,['id','lastMaintenanceAt','lastIncidentAt'],row=>{if(row.lastMaintenanceAt!==undefined||row.lastIncidentAt!==undefined)stamped.push(row.id);});assert.deepEqual(stamped,[],`${mode}: a check stamps nothing outside the columns`);
  if(mode==='store'){const store=FLEET.storeOf(state);assert.equal(Object.keys(store.extras||{}).length,0,'store: no checked row has an extras entry');}
  results.push({mode,closes:[first,second].map(r=>({day:r.day,checks:r.row.checks,cost:r.row.cost,avg:Number(r.row.avgCondition.toFixed(2))}))});
}
// 5b. A checked truck gets no flight hours (the worker pass and the main-thread pass).
{
  const {s,state}=scenario(),R=s.GH_REALISM,FLEET=s.GH_FLEET_DATA,STORE=s.GH_FLEET_STORE;
  const truck={id:'TRUCK-CHECK',name:'Truck',type:'road',assetMode:'road',assetClass:'truck',ownerCompanyId:'air',companyId:'air',ownership:'owned',purchasePrice:185000,year:2024,baseFacility:'B1',phase:'idle',condition:60,specs:{capacity:24}};
  state.fleet=STORE.fromAssets([truck],{at:state.simSeconds});delete state.assets;
  const result=DAY.compute(state,FLEET,{storeApi:STORE});assert.deepEqual(Array.from(result.maintenanceRows),[0]);assert.equal(result.columns.count+result.columns.exceptional.count,0,'no counter plan row for a truck');
  const day=Math.floor(state.simSeconds/DAYS)+1;state.simSeconds=day*DAYS;R.onDay(state,day);
  const after=[];FLEET.scan(state,['id','condition','flightHours','nextCheckHours'],row=>after.push(row));
  assert.equal(after[0].condition,100);assert.equal(after[0].flightHours,undefined,'no hours on a truck');assert.equal(after[0].nextCheckHours,undefined);
}
// 4. The page. 6. The twins.
const read=file=>fs.readFileSync(path.join(ROOT,'WebApp',file),'utf8');
assert.match(read('app.js'),/الإقفال اليومي يفحص كل أصل تحت حد شركته ويعيد حالته إلى 100%، ويُصفّر ساعات طيران الطائرة\. سعر الفحص بقدر التآكل الذي يصلحه/);
assert.doesNotMatch(read('app.js'),/فحص يوميًا لكل شركة، الأسوأ حالة أولًا/);
const twin=file=>{const text=read(file),from=text.indexOf('const CHECK_REFERENCE_WEAR='),to=text.indexOf('/CHECK_REFERENCE_WEAR;}',from);assert.ok(from>=0&&to>from,`${file}: the price code`);return text.slice(from,to);};
assert.equal(twin('fleet-day-core.js'),twin('realism-core.js'),'the worker and main-thread passes keep the same price code');
for(const file of ['fleet-day-core.js','realism-core.js'])assert.doesNotMatch(read(file),/CHECKS_PER_DAY|queueCheck|lessUrgent/,`${file}: no daily cap`);
console.log(JSON.stringify({suite:'build518-maintenance-worst-first',ok:true,fleet:N,results}));
