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
    near(result.expense,report.opex+report.commission+report.costOfSales,1e-6,'expense = opex + commission + cost of sales');
    near(result.cashExpense,report.opex+report.commission,1e-6,'the cost of sales is not paid again');
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
// 4. A building sold to a property fund carries its cost into the close.
{
  const {state,re}=setup(),office=re.offices[0];
  re.projects.push({id:'RE-FUND-QA',officeId:office.id,city:office.city,country:office.country,type:'office',name:'مكاتب للصندوق',mode:'lease',units:80,unitCost:1416000,landCost:17280000,buildCost:96000000,priceLevel:1,startDay:0,completeDay:1,status:'مكتمل',milestonesPaid:3,sold:0,presold:0,leased:50,handedOver:0,salesRevenue:0,rentRevenue:0,cheques:[],leases:[]});
  const sale=RE.execute({state},'sell-to-fund',{projectId:'RE-FUND-QA'});state.simSeconds=2*86400;re.lastProcessedDay=1;
  const report=RE.tickDay(state,{day:2});assert.ok(report.sales>=sale.price);assert.ok(report.costOfSales>=80*1416000,'the building\'s cost is the sale\'s cost');
}
console.log(JSON.stringify({suite:'build378-realestate-off-plan',ok:true}));
