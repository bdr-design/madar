'use strict';
// Owner decision (19 Oct 2026): the daily close checks at most 2,000 assets a company (the maintenance network's
// capacity, unchanged, so the close does no more work); they were the first 2,000 rows under the policy line. A fleet
// larger than that had its later rows left unchecked while the capacity went back to the first rows as they wore
// again. The checks now go to the lowest condition first, ties in row order, on the main-thread pass (realism) and the
// worker pass (fleet-day-core) alike. A check writes the condition only: the lastMaintenanceAt stamp (read nowhere)
// gave every checked row an extras entry for good (the slow path of every scan) and moved its chunk's identity version
// (static tables checked again by the next save), and worst-first spreads the checks over the fleet. Proven with the
// real owners, on the array fleet and the Fleet Store:
//  1. 2,400 aircraft at 70%: the first close checks 2,000 (rows 0-1999, a tie), bills them and restores them;
//  2. the checked rows wear back to 75%: the second close checks the 400 rows still at 70% first, then 1,600 at 75%
//     in row order (the former rule took rows 0-1999 again and never reached the last 400);
//  3. the third close checks the last 400: every aircraft was checked within three closes;
//  4. the worker pass chooses the same rows, and its totals are the chosen rows' sums in row order;
//  5. the bill is the chosen rows' check cost; the page states the rule;
//  6. a check adds no field outside the columns (no extras entry in the Fleet Store);
//  7. the two passes keep the same selection code.
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||require('path').resolve(__dirname,'..');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ROOT=process.env.GH_TEST_SOURCE_DIR;
const {scenario}=require('./helpers/business-scenario'),DAY=require(path.join(ROOT,'WebApp/fleet-day-core.js'));
const N=2400,CAP=2000,DAYS=86400,results=[];
for(const mode of ['array','store']){
  const {s,state,ctx,item}=scenario(),R=s.GH_REALISM,FLEET=s.GH_FLEET_DATA,STORE=s.GH_FLEET_STORE;
  state.globalBases.find(row=>row.id==='B1').deliveryCapacity=N;s.GH_FINANCE_CORE.book(state,'air').accounts[0].balance=1e15;
  const out=s.GH_DOMAIN_COMMANDS.dispatch(ctx,'procurement','purchase-assets',{type:'air',assetMode:'air',assetClass:'aircraft',tab:'new',item,base:state.globalBases.find(row=>row.id==='B1'),supplier:ctx.supplierFor(),mode:'cash',qty:N,manual:true,requestRef:'WORST-FIRST-QA',upfront:item.price*N,totalPrice:item.price*N,documentLeadDays:1,leadSeconds:0,immediateDelivery:true},{actor:'maintenance-qa',idempotencyKey:'WORST-FIRST-QA'});
  assert.ok(out.ok);R.onSimulationTime(state,state.simSeconds);
  if(mode==='store'&&FLEET.mode(state)!=='store'){const plain=state.assets.map(a=>JSON.parse(JSON.stringify(a)));state.fleet=STORE.fromAssets(plain,{at:state.simSeconds});delete state.assets;}
  assert.equal(FLEET.mode(state),mode);
  const ids=[];FLEET.scan(state,['id'],row=>{ids.push(row.id);});assert.equal(ids.length,N);
  const set=(list,value)=>{for(const id of list)FLEET.update(state,id,{condition:value});};
  const conditions=()=>{const map=new Map();FLEET.scan(state,['id','condition'],row=>{map.set(row.id,row.condition);});return map;};
  const worker=()=>DAY.compute(state,FLEET,{storeApi:STORE}).maintenance.find(([owner])=>owner==='air')[1];
  let day=Math.floor(state.simSeconds/DAYS)+1;
  // The worker pass's choice is taken before each close, the main-thread close's from the rows it restored.
  const close=()=>{const expected=worker(),before=conditions();state.simSeconds=day*DAYS;R.onDay(state,day);const after=conditions(),checked=ids.filter(id=>before.get(id)<80&&after.get(id)===100);return {day:day++,expected,checked,after,row:state.realism.maintenance.companies.air};};
  const range=(a,b)=>ids.slice(a,b),price=Math.max(0,Number(item.price)||0)*.004;
  assert.equal(R.maintenancePolicy(state,'air'),'standard');
  // 1. A tie: the first 2,000 rows.
  set(ids,70);const first=close();
  assert.deepEqual(first.checked,range(0,CAP),`${mode}: a tie is checked in row order`);assert.deepEqual(first.expected.due,first.checked,`${mode}: the worker pass chooses the same rows`);
  assert.equal(first.row.checks,CAP);assert.ok(range(CAP,N).every(id=>first.after.get(id)===70),`${mode}: the rest wait for the next close`);
  // 2. The checked rows wear back under the line; the rows never checked come first.
  set(range(0,CAP),75);const second=close();
  assert.deepEqual(second.checked,[...range(0,1600),...range(CAP,N)],`${mode}: the 400 rows at 70% first, then 1,600 at 75% in row order`);assert.deepEqual(second.expected.due,second.checked,`${mode}: the worker pass chooses the same rows`);
  assert.ok(range(1600,CAP).every(id=>second.after.get(id)===75));
  // 3. Every aircraft within three closes.
  const third=close();assert.deepEqual(third.checked,range(1600,CAP),`${mode}: the last 400 rows`);assert.deepEqual(third.expected.due,third.checked);
  assert.equal(new Set([...first.checked,...second.checked,...third.checked]).size,N,`${mode}: every aircraft was checked within three closes`);
  // 4. and 5. Totals in row order over the chosen rows, and the bill.
  for(const [label,run,cond] of [['first',first,()=>70],['second',second,id=>ids.indexOf(id)>=CAP?70:75],['third',third,()=>75]]){
    let restored=0,cost=0;for(const id of run.checked){restored+=100-cond(id);cost+=price;}
    assert.ok(Object.is(run.expected.restored,restored),`${mode} ${label}: restored summed in row order`);assert.ok(Object.is(run.expected.cost,cost),`${mode} ${label}: cost summed in row order`);
    const bill=state.finance.payables.find(doc=>doc.number===`MNT-AIR-${run.day}`);assert.ok(bill,`${mode} ${label}: a maintenance invoice`);assert.equal(run.row.cost,Math.round(cost));assert.equal(Number(bill.amount),Math.round(cost),`${mode} ${label}: the bill is the chosen rows' check cost`);
  }
  assert.equal(second.row.avgCondition,(CAP*75+400*70+400*30+1600*25)/N,`${mode}: the fleet average after the checks`);
  // 6. No field outside the columns.
  const stamped=[];FLEET.scan(state,['id','lastMaintenanceAt'],row=>{if(row.lastMaintenanceAt!==undefined)stamped.push(row.id);});assert.deepEqual(stamped,[],`${mode}: a check stamps nothing outside the columns`);
  if(mode==='store'){const store=FLEET.storeOf(state);assert.equal(Object.keys(store.extras||{}).length,0,'store: no checked row has an extras entry');}
  results.push({mode,closes:[first,second,third].map(r=>({day:r.day,checks:r.row.checks,avg:Number(r.row.avgCondition.toFixed(2))}))});
}
// 5. The page. 7. The twins.
const read=file=>fs.readFileSync(path.join(ROOT,'WebApp',file),'utf8');
assert.match(read('app.js'),/فحص يوميًا لكل شركة، الأسوأ حالة أولًا/);
const twin=file=>{const text=read(file),from=text.indexOf('const lessUrgent='),to=text.indexOf('heap.length=0;}',from);assert.ok(from>=0&&to>from,`${file}: the selection code`);return text.slice(from,to).replace(/\b(acc|maint)\b/g,'owner');};
assert.equal(twin('fleet-day-core.js'),twin('realism-core.js'),'the worker and main-thread passes keep the same selection code');
console.log(JSON.stringify({suite:'build518-maintenance-worst-first',ok:true,fleet:N,capacity:CAP,results}));
