'use strict';
// Build 378: off-plan sales recognised over time. A buyer signs at a fixed price, pays 20% that day and instalments with
// construction until 70% is paid, the rest at handover; revenue and the units' cost follow the construction's progress.
// The units' cost is the sale's expense (not paid again: construction was paid as capex). A save from before Build 378
// recognises its presold units' progress once. A building sold to a property fund carries its cost.
const assert=require('node:assert/strict');
const {harness,minimal}=require('./helpers/core-harness');
const {s}=harness(['capability-registry-core','company-definitions','company-platform-core','identity-system','control-plane-core','authorization-core','determinism-core','integrity-core','document-proof-core','transaction-core','domain-command-core','finance-core','facility-core','realestate-core','economics-core','save-schema']);
const RE=s.GH_REALESTATE_CORE,near=(a,b,tolerance,message)=>assert.ok(Math.abs(a-b)<=tolerance,`${message}: ${a} vs ${b}`);
function setup(){
  const opened=['bank','realestate'],companyRegistry=Object.fromEntries(opened.map(id=>{const definition=s.GH_COMPANY_DEFINITIONS.get(id);return [id,{id,definitionId:definition.definitionId,definitionVersion:definition.definitionVersion,status:'active'}];}));
  const state={...minimal(),profile:{name:'Build 378 off-plan'},companyRegistry,openedCompanies:opened,branches:[],customHubs:[{id:'RE-RUH',kind:'realestate',ownerCompanyId:'realestate',owned:true,city:'الرياض',country:'السعودية'}],realEstate:{},advanced:{}};
  const F=s.GH_FINANCE_CORE;F.ensure(state);for(const id of opened)F.book(state,id).accounts[0].balance=900000000;F.reconcile(state);
  const re=RE.ensure(state);state.simSeconds=0;
  const started=RE.execute({state},'start-project',{officeId:re.offices[0].id,type:'residential',size:1,priceLevel:1,mode:'sale'});
  return {state,re,id:started.id};
}
const unitPrice=project=>Math.round(RE.TYPES[project.type].price*(Number(project.localFactor)||1)*project.priceLevel*.95);

// 1. A new project from start to sell-out.
{
  const {state,re,id}=setup();let firstSale=null,handover=null,totals={revenue:0,cash:0,cost:0},lastRecognized=0;
  for(let day=1;day<=1500;day++){
    state.simSeconds=day*86400;const before=re.projects.find(row=>row.id===id),value=before?.offPlan?.value||0,soldBefore=before?.presold||0;
    const report=RE.tickDay(state,{day}),result=RE.dailyResult(state,day),project=re.projects.find(row=>row.id===id);
    near(result.expense,report.opex+report.commission+report.serviceCost+report.costOfSales+report.depreciation,1e-6,'expense = opex + commission + service cost + cost of sales + depreciation');
    near(result.cashExpense,report.opex+report.commission+report.serviceCost,1e-6,'the cost of sales is not paid again');
    totals.revenue+=report.offPlanRevenue;totals.cash+=report.offPlanCash;
    if(project?.offPlan){
      assert.ok(project.offPlan.recognized+1e-6>=lastRecognized,'recognised revenue never goes back');lastRecognized=project.offPlan.recognized;
      assert.ok(project.offPlan.collected<=project.offPlan.value*.7+0.01,'no more than 70% before handover');
      totals.cost+=report.costOfSales;
      if(!firstSale&&project.presold>0){
        const take=project.presold-soldBefore,signed=take*unitPrice(project),progress=project.offPlan.progress;
        firstSale={day,progress};near(project.offPlan.value,signed,0,'contract price fixed on signing');
        near(report.offPlanCash,signed*(.2+.5*progress),0.02,'deposit and instalments due on signing');
        near(report.offPlanRevenue,signed*progress,0.02,'revenue at the progress so far');
        near(report.commission,signed*.02,0.01,'commission on signing');
      }
    }
    if(report.completed.includes(id)){handover={day,value,units:project.sold};assert.equal(project.presold,0);assert.equal(project.offPlan,null);}
    if(!project)break;
  }
  assert.ok(firstSale&&handover,'sold off-plan and handed over');
  assert.ok(firstSale.day<30,'revenue starts within the first month, not at completion');
  near(totals.revenue,handover.value,1,'off-plan revenue = contract value');
  near(totals.cash,handover.value,1,'off-plan cash = contract value');
  console.log(JSON.stringify({firstSaleDay:firstSale.day,handoverDay:handover.day,contractValue:handover.value,units:handover.units}));
}
// 2. A save from before Build 378: presold units, no off-plan record, half-way through construction.
{
  const {state,re,id}=setup(),project=re.projects.find(row=>row.id===id),half=Math.floor((project.completeDay-project.startDay)/2);
  project.presold=50;delete project.offPlan;re.lastProcessedDay=half-1;state.simSeconds=half*86400;
  const value=50*unitPrice(project),report=RE.tickDay(state,{day:half}),plan=project.offPlan,progress=plan.progress,today=project.presold-50,todayValue=today*unitPrice(project);
  near(progress,.5,.01,'progress half-way');
  near(report.offPlanRevenue,(value+todayValue)*progress,0.05,'the construction done so far is recognised once');
  near(report.offPlanCash,(value+todayValue)*(.2+.5*progress),0.05,'deposit and instalments due so far');
  near(report.commission,(value+todayValue)*.02,0.05,'commission paid once (it was due at handover before)');
  const next=RE.tickDay(state,{day:half+1});assert.ok(next.offPlanRevenue<value/100,'no second catch-up');assert.ok(next.commission<value*.02/10,'no second commission');
}
// 3. A completion waiting for its last milestone moves its day; the recognised share does not go back.
{
  const {state,re,id}=setup(),project=re.projects.find(row=>row.id===id),day=project.completeDay-1;
  project.presold=10;delete project.offPlan;re.lastProcessedDay=day-1;state.simSeconds=day*86400;RE.tickDay(state,{day});
  const recognized=project.offPlan.recognized;project.completeDay+=30;re.lastProcessedDay=day;state.simSeconds=(day+1)*86400;
  const report=RE.tickDay(state,{day:day+1});assert.ok(report.offPlanRevenue>=0&&project.offPlan.recognized>=recognized,'a delayed completion keeps the recognised revenue');
}
// 4. A rented building sold to a property fund carries its net book cost, after depreciation already expensed.
{
  const {state,re}=setup(),office=re.offices[0];
  re.projects.push({id:'RE-FUND-QA',officeId:office.id,city:office.city,country:office.country,type:'office',name:'مكاتب للصندوق',mode:'lease',units:80,unitCost:1416000,landCost:17280000,buildCost:96000000,priceLevel:1,startDay:0,completeDay:1,status:'مكتمل',milestonesPaid:3,sold:0,presold:0,leased:50,handedOver:0,salesRevenue:0,rentRevenue:0,cheques:[],leases:[]});
  state.simSeconds=86400;const held=RE.tickDay(state,{day:1}),project=re.projects.find(row=>row.id==='RE-FUND-QA');
  near(project.accumulatedDepreciation,held.depreciation,1e-6,'depreciation posted while rented is tracked on the building');
  const carryingValue=80*1416000-project.accumulatedDepreciation;
  state.simSeconds=2*86400;const sale=RE.execute({state},'sell-to-fund',{projectId:'RE-FUND-QA'});
  const report=RE.tickDay(state,{day:2});assert.ok(report.sales>=sale.price);near(report.costOfSales,carryingValue,1e-6,'the building is sold at its carrying cost, not gross cost');
}
// 5. Construction risk (projects started from Build 378): some run late (learnt at mid-construction, 2-15% of the
// duration) and some over cost (1-10% of the build cost on the last payment, which is then the units' cost, off-plan
// units included). A project from an older save never does.
let risk={late:0,over:0,projects:0};
{
  const {state,re,id}=setup(),legacy=re.projects.find(row=>row.id===id);delete legacy.risk;const ids=[];
  for(let i=0;i<11;i++)ids.push(RE.execute({state},'start-project',{officeId:re.offices[0].id,type:'residential',size:1,priceLevel:1,mode:'sale'}).id);
  const planned=Object.fromEntries(re.projects.map(row=>[row.id,{complete:row.completeDay,unitCost:row.unitCost}])),seen=new Map();
  for(let day=1;day<=720;day++){
    state.simSeconds=day*86400;const before=new Map(re.projects.map(row=>[row.id,{cost:row.offPlan?.recognizedCost||0,cash:row.offPlan?.cost||0}]));
    const report=RE.tickDay(state,{day});for(const row of re.projects)seen.set(row.id,{...row,offPlan:row.offPlan?{...row.offPlan}:null});
  }
  for(const projectId of [id,...ids]){
    const row=seen.get(projectId)||re.completedArchive.find(item=>item.id===projectId),plan=planned[projectId];risk.projects++;
    if(projectId===id){assert.equal(row.delayDays,undefined);assert.equal(row.overrun,undefined);continue;}
    if(row.delayDays){risk.late++;assert.ok(row.delayDays<=Math.round(540*.15)+1);assert.equal(row.completeDay,plan.complete+row.delayDays,'the delay moves completion');}
    if(row.overrun){risk.over++;assert.ok(row.overrun<=row.buildCost*.1+1);assert.equal(row.unitCost,Math.round((row.landCost+row.buildCost+row.overrun)/row.units),'the overrun is the units\' cost');}
  }
  assert.ok(risk.late>0&&risk.late<11&&risk.over>0&&risk.over<11,JSON.stringify(risk));
}
// 6. Service charges: from handover the owners pay a yearly charge (residential $1,800 a unit at Riyadh prices), 85% of
// it the building's running cost; it is the company's, so it continues once a sold-out project leaves the active list.
{
  const {state,re,id}=setup();let last=null;for(let day=1;day<=700;day++){state.simSeconds=day*86400;last=RE.tickDay(state,{day});}
  const project=re.projects.find(row=>row.id===id);assert.ok(project.handedOver>100);
  near(last.serviceCharges,project.handedOver*1800/365,1e-6,'every handed-over unit pays its charge');
  near(last.serviceCost,last.serviceCharges*.85,1e-6);near(RE.dailyResult(state,last.day).cashExpense,last.opex+last.commission+last.serviceCost,1e-6,'its running cost is paid');
  const handed=project.handedOver;re.projects=re.projects.filter(row=>row.id!==id);state.simSeconds=701*86400;const after=RE.tickDay(state,{day:701});
  near(after.serviceCharges,handed*1800/365,1e-6,'charges continue after the project leaves the active list');
}
// 7. A building kept to let is depreciated: its build cost (not the land) over 40 years, an expense but not cash.
{
  const {state,re}=setup(),office=re.offices[0];
  re.projects.push({id:'RE-DEP-QA',officeId:office.id,city:office.city,country:office.country,type:'office',name:'مكاتب مؤجرة',mode:'lease',units:80,unitCost:1416000,landCost:17280000,buildCost:96000000,priceLevel:1,startDay:0,completeDay:1,status:'مكتمل',milestonesPaid:3,sold:0,presold:0,leased:40,handedOver:0,salesRevenue:0,rentRevenue:0,cheques:[],leases:[]});
  state.simSeconds=2*86400;re.lastProcessedDay=0;const report=RE.tickDay(state,{day:2}),result=RE.dailyResult(state,2);
  near(report.depreciation,96000000/(40*365),1e-6,'build cost over 40 years');near(result.expense-result.cashExpense,report.costOfSales+report.depreciation,1e-6,'not paid in cash');
  const project=re.projects.find(row=>row.id==='RE-DEP-QA');near(project.accumulatedDepreciation,report.depreciation,1e-6,'legacy project begins tracking depreciation when a day is processed');
  project.accumulatedDepreciation=project.buildCost-100;state.simSeconds=3*86400;
  const final=RE.tickDay(state,{day:3});near(final.depreciation,100,1e-6,'depreciation stops at the building cost');near(project.accumulatedDepreciation,project.buildCost,1e-6,'the accumulated amount never exceeds the building cost');
}
// 8. A save that already expensed depreciation before this build recovers the exact fixed daily amount before a sale
// or the next daily close. It must not expense those previous days a second time.
for(const saleBeforeClose of [true,false]){
  const {state,re}=setup(),office=re.offices[0],basis=96000000,gross=80*1416000,daily=basis/(40*365);
  re.projects.push({id:'RE-LEGACY-DEP',officeId:office.id,city:office.city,country:office.country,type:'office',name:'مكاتب قديمة',mode:'lease',units:80,unitCost:1416000,landCost:17280000,buildCost:basis,priceLevel:1,startDay:0,completeDay:1,status:'مكتمل',milestonesPaid:3,sold:0,presold:0,leased:40,handedOver:0,salesRevenue:0,rentRevenue:0,cheques:[],leases:[]});
  re.lastProcessedDay=100;re.ytd.depreciation=100*daily;state.simSeconds=101*86400;
  if(!saleBeforeClose){const report=RE.tickDay(state,{day:101}),project=re.projects.find(row=>row.id==='RE-LEGACY-DEP');near(report.depreciation,daily,1e-6,'only the new day is expensed');near(project.accumulatedDepreciation,101*daily,1e-6,'prior depreciation restored from completed days');}
  RE.execute({state},'sell-to-fund',{projectId:'RE-LEGACY-DEP'});
  near(re.pendingFundSales[0].cost,gross-(saleBeforeClose?100:101)*daily,1e-6,'fund sale uses the recovered carrying value');
}
console.log(JSON.stringify({suite:'build378-realestate-off-plan',risk}));
