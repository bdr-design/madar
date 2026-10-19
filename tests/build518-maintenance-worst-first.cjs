'use strict';
// Owner decision (19 Oct 2026): the daily close checks at most 2,000 assets a company (the maintenance network's
// capacity, unchanged, so the close does no more work); they were the first 2,000 rows under the policy line. A fleet
// larger than that had its later rows left unchecked while the capacity went back to the first rows as they wore
// again. The checks now go to the lowest condition first, ties in row order, on the main-thread pass (realism) and the
// worker pass (fleet-day-core) alike. Proven with the real owners:
//  1. 2,400 aircraft at 70%: the first close checks 2,000 (rows 0-1999, a tie), bills them and restores them;
//  2. the checked rows wear back to 75%: the second close checks the 400 rows still at 70% first, then 1,600 at 75%
//     in row order (the former rule took rows 0-1999 again and never reached the last 400);
//  3. the third close checks the last 400: every aircraft was checked within three closes;
//  4. the worker pass chooses the same rows, and its totals are the chosen rows' sums in row order;
//  5. the bill is the chosen rows' check cost; the page states the rule.
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||require('path').resolve(__dirname,'..');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ROOT=process.env.GH_TEST_SOURCE_DIR;
const {scenario}=require('./helpers/business-scenario'),DAY=require(path.join(ROOT,'WebApp/fleet-day-core.js'));
const {s,state,ctx,item}=scenario(),R=s.GH_REALISM,FLEET=s.GH_FLEET_DATA,N=2400,CAP=2000;
state.globalBases.find(row=>row.id==='B1').deliveryCapacity=N;s.GH_FINANCE_CORE.book(state,'air').accounts[0].balance=1e15;
const out=s.GH_DOMAIN_COMMANDS.dispatch(ctx,'procurement','purchase-assets',{type:'air',assetMode:'air',assetClass:'aircraft',tab:'new',item,base:state.globalBases.find(row=>row.id==='B1'),supplier:ctx.supplierFor(),mode:'cash',qty:N,manual:true,requestRef:'WORST-FIRST-QA',upfront:item.price*N,totalPrice:item.price*N,documentLeadDays:1,leadSeconds:0,immediateDelivery:true},{actor:'maintenance-qa',idempotencyKey:'WORST-FIRST-QA'});
assert.ok(out.ok);R.onSimulationTime(state,state.simSeconds);
const ids=[];FLEET.scan(state,['id'],row=>{ids.push(row.id);});assert.equal(ids.length,N);
const set=(list,value)=>{for(const id of list)FLEET.update(state,id,{condition:value});};
const conditions=()=>{const map=new Map();FLEET.scan(state,['id','condition'],row=>{map.set(row.id,row.condition);});return map;};
const worker=()=>DAY.compute(state,FLEET,{storeApi:s.GH_FLEET_STORE}).maintenance.find(([owner])=>owner==='air')[1];
const DAYS=86400;let day=Math.floor(state.simSeconds/DAYS)+1;
// The worker pass's choice is taken before each close, the main-thread close's from the rows it restored.
const close=()=>{const expected=worker(),before=conditions();state.simSeconds=day*DAYS;R.onDay(state,day);const after=conditions(),checked=ids.filter(id=>before.get(id)<80&&after.get(id)===100);return {day:day++,expected,checked,after,row:state.realism.maintenance.companies.air};};
const range=(a,b)=>ids.slice(a,b),price=Math.max(0,Number(item.price)||0)*.004;
assert.equal(R.maintenancePolicy(state,'air'),'standard');
// 1. A tie: the first 2,000 rows.
set(ids,70);const first=close();
assert.deepEqual(first.checked,range(0,CAP),'a tie is checked in row order');assert.deepEqual(first.expected.due,first.checked,'the worker pass chooses the same rows');
assert.equal(first.row.checks,CAP);assert.ok(range(CAP,N).every(id=>first.after.get(id)===70),'the rest wait for the next close');
// 2. The checked rows wear back under the line; the rows never checked come first.
set(range(0,CAP),75);const second=close();
assert.deepEqual(second.checked,[...range(0,1600),...range(CAP,N)],'the 400 rows at 70% first, then 1,600 at 75% in row order');assert.deepEqual(second.expected.due,second.checked,'the worker pass chooses the same rows');
assert.ok(range(1600,CAP).every(id=>second.after.get(id)===75));
// 3. Every aircraft within three closes.
const third=close();assert.deepEqual(third.checked,range(1600,CAP),'the last 400 rows');assert.equal(new Set([...first.checked,...second.checked,...third.checked]).size,N,'every aircraft was checked within three closes');
// 4. Totals in row order over the chosen rows.
for(const [label,run,list] of [['first',first,first.checked],['second',second,second.checked]]){
  let restored=0,cost=0;const cond=label==='first'?()=>70:id=>ids.indexOf(id)>=CAP?70:75;for(const id of list){restored+=100-cond(id);cost+=price;}
  assert.ok(Object.is(run.expected.restored,restored),`${label}: restored summed in row order`);assert.ok(Object.is(run.expected.cost,cost),`${label}: cost summed in row order`);
  // 5. The bill.
  const bill=state.finance.payables.find(doc=>doc.number===`MNT-AIR-${run.day}`);assert.ok(bill,`${label}: a maintenance invoice`);assert.equal(run.row.cost,Math.round(cost));
}
assert.equal(second.row.avgCondition,(CAP*75+400*70+400*30+1600*25)/N,'the fleet average after the checks');
const app=fs.readFileSync(path.join(ROOT,'WebApp/app.js'),'utf8');assert.match(app,/فحص يوميًا لكل شركة، الأسوأ حالة أولًا/);
console.log(JSON.stringify({suite:'build518-maintenance-worst-first',ok:true,fleet:N,capacity:CAP,closes:[first,second,third].map(r=>({day:r.day,checks:r.row.checks,avg:Number(r.row.avgCondition.toFixed(2))}))}));
