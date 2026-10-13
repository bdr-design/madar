'use strict';
// Build 378: inventory finance (floor plan) for the dealership: when on, a restock its cash cannot cover draws the
// shortfall as a 180-day credit facility from the group's bank; off by default; nothing without a bank.
// Manufacturer volume bonus: at a quarter's end a maker pays 2.5% of the cost of its cars sold that quarter when the
// dealership sold at least its target (the maker's units of the quarter before, 30 the first time); cash revenue.
const assert=require('node:assert/strict');
const {harness}=require('./helpers/core-harness');
const DAY=86400;
function setup({showrooms=[['AUTO-RUH','الرياض','السعودية']],level=null,cash=1e12,bank=true,bankBranch=true,failDraw=false,openBank=true}={}){
  const h=harness([]),s=h.s,parties=new Map(),cheques=[],loanRequests=[];
  s.GH_AUTHORIZATION={registerCommandTargetResolver(){}};
  s.GH_COMPANY_PLATFORM={requireCompany(_state,id){return {id,operational:true,registered:true};},resolveCompany(_state,id){return {id,operational:id!=='bank'||bank};}};
  s.GH_BUSINESS_WORLD={recordEvent(){},upsertParty(_state,p){const id=String(p.id||`CUST-${parties.size+1}`),old=parties.get(id)||{id,roles:[]};Object.assign(old,p,{id,roles:[...new Set([...(old.roles||[]),...(p.role?[p.role]:[]),...(p.roles||[])])]});parties.set(id,old);return old;},resolveParty(_state,id){return parties.get(String(id))||[...parties.values()].find(row=>row.name===id||row.displayName===id)||null;},touchRelationship(){return {};},touchCustomerLifecycle(){return {};},customerPortfolio(){return {companies:{}};}};
  let spent=0,drawn=0;const draws=[];
  s.GH_FINANCE_CORE={calendarMonthForDay(value){const date=new Date(Date.UTC(2026,0,1)+Math.max(0,Number(value)||0)*86400000);return `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,'0')}`;},operating(){return cash+drawn-spent;},
    execute(ctx,cmd,p){if(cmd==='credit'){const row={company:p.company,kind:'دخل',number:`INV-${ctx.state.finance.invoices.length+1}`,sourceRef:p.ref,total:p.amount,status:'مستحقة',at:ctx.state.simSeconds||0,counterpartyPartyId:p.customerId,businessLocationId:p.businessLocationId,businessLocationCountry:p.businessLocationCountry};ctx.state.finance.invoices.push(row);return row;}if(cmd==='pay-by-cheque'){spent+=p.amount;cheques.push(p);return {cheque:{id:`CHQ-${cheques.length}`,status:'مصروف'},invoice:{number:`AP-${cheques.length}`}};}if(cmd==='register-commercial-contract'){(ctx.state.finance.commercialContracts||(ctx.state.finance.commercialContracts=[])).push({id:p.id});return {id:p.id};}throw new Error(`unexpected finance command ${cmd}`);}};
  s.GH_DOMAIN_COMMANDS={dispatchSystem(_ctx,domain,cmd,p){if(domain==='finance'&&cmd==='credit')return {ok:true,result:s.GH_FINANCE_CORE.execute({state:s},cmd,p)};if(domain==='banking'&&cmd==='submit-customer-loan-request'){const row={id:p.id,sourceCompanyId:'dealership',sourceSaleId:p.sourceSaleId,status:'بانتظار القرار'};loanRequests.push(row);s.bank.loanRequests.push(row);return {ok:true,result:row};}throw new Error(`unexpected system command ${domain}:${cmd}`);}};
  s.GH_BANKING_CORE={MAX_OPEN_REQUESTS:5,countryPopulation:name=>({'السعودية':35300000,'الإمارات':9890000}[name]||10000000),customerFinancingQuote(_state,p){return {invoiceAmount:p.invoiceAmount,downPayment:0,loanPrincipal:p.invoiceAmount,originationFee:0,disbursementAmount:p.invoiceAmount,termDays:p.termDays,product:p.product};},customerDisbursementForSale(){return null;},execute(_ctx,cmd,p){if(cmd!=='draw-facility')return null;if(failDraw)throw new Error('facility-unavailable');draws.push(p);drawn+=p.amount;return p.amount;}};
  s.GH_MAP_LABELS=[];
  h.load('customer-companies-core');h.load('customer-base-core');h.load('dealer-market-core');
  s.simSeconds=0;s.finance={invoices:[]};s.bank={loanRequests:[],branchNetwork:[{id:'BANK-RUH',servicesActive:bankBranch}]};s.openedCompanies=openBank?['dealership','bank']:['dealership'];
  s.customHubs=showrooms.map(([id,city,country])=>({id,kind:'dealership-branch',ownerCompanyId:'dealership',owned:true,city,country,name:`معرض ${city}`}));
  if(level){s.GH_DEALER_MARKET.ensure(s);s.customerCompanies.companies.dealership.market.priceLevel=level;}
  return {s,core:s.GH_CUSTOMER_COMPANIES_CORE,market:s.GH_DEALER_MARKET,cheques,loanRequests,draws};
}
function drain(generator){let step;do{step=generator.next();}while(!step.done);return step.value;}
function runDays(env,from,to){for(let day=from;day<=to;day++){env.s.simSeconds=day*DAY;drain(env.core.onFinancialDayStages({state:env.s,companyId:'dealership'},{day}));}}

// Off (the default): a restock the cash cannot cover is skipped, as before, and nothing is borrowed.
{
  const env=setup({cash:2e6});runDays(env,1,1);
  assert.equal(env.s.customerCompanies.companies.dealership.market.floorPlan,false,'off by default');
  assert.equal(env.draws.length,0);
}
// On: the shortfall is drawn from the group's bank (rounded up to $100k) for 180 days, and the restock goes ahead.
let shortfall=0;
{
  const off=setup({cash:2e6});runDays(off,1,1);const skipped=off.cheques.length;
  const env=setup({cash:2e6});const result=env.core.execute({state:env.s},'dealership-set-floor-plan',{enabled:true});assert.equal(result.enabled,true);
  runDays(env,1,1);
  assert.equal(env.draws.length,1,'one draw on the restock day');const draw=env.draws[0];
  assert.equal(draw.ownerCompanyId,'dealership');assert.equal(draw.termDays,180);assert.equal(draw.rate,.06,'base rate + 1.5% (6% without a market rate)');
  assert.equal(draw.amount%100000,0);shortfall=draw.amount;
  assert.ok(env.cheques.length>skipped,'the financed restock was ordered');
  const report=env.s.customerCompanies.companies.dealership.market.dailyHistory[0];assert.equal(report.floorPlan.amount,draw.amount);
  runDays(env,2,10);assert.equal(env.draws.length,1,'no draw between restocks');
}
// No bank in the group, or the bank declines: no draw, the restock pays what cash covers.
for(const options of [{openBank:false},{failDraw:true}]){
  const env=setup({cash:2e6,...options});env.core.execute({state:env.s},'dealership-set-floor-plan',{enabled:true});runDays(env,1,1);
  assert.equal(env.draws.length,0,JSON.stringify(options));assert.equal(env.s.customerCompanies.companies.dealership.market.dailyHistory[0].floorPlan,null);
}
// Maker bonus across the first quarter's end (day 90 is 1 April 2026 in this calendar).
let bonusPaid=0;
{
  const env=setup({showrooms:[['AUTO-RUH','الرياض','السعودية'],['AUTO-JED','جدة','السعودية']]});runDays(env,1,89);
  const m=env.s.customerCompanies.companies.dealership.market,q1=JSON.parse(JSON.stringify(m.oemQuarter));assert.equal(q1.period,'2026-Q1');
  assert.equal(m.dailyHistory.slice(0,89).reduce((sum,row)=>sum+row.oemBonus,0),0,'nothing is paid inside the quarter');
  runDays(env,90,90);const day90=m.dailyHistory[0];
  const expected=Object.entries(q1.units).filter(([,units])=>units>=30).reduce((sum,[oemId])=>sum+Math.round(q1.cost[oemId]*.025*100)/100,0);
  assert.ok(Math.abs(day90.oemBonus-expected)<.01,`bonus ${day90.oemBonus} vs ${expected}`);
  assert.ok(day90.revenue>=day90.oemBonus&&Math.abs(day90.cashRevenue-day90.revenue)<1e-6,'cash revenue of the close');
  assert.equal(m.oemQuarter.period,'2026-Q2');assert.deepEqual(Object.keys(m.oemQuarter.last).sort(),Object.keys(q1.units).sort(),'next targets are this quarter\'s units');
  bonusPaid=day90.oemBonus;
  // The second quarter's target is each maker's first-quarter units (day 181 is 1 July).
  runDays(env,91,180);const q2=JSON.parse(JSON.stringify(m.oemQuarter));runDays(env,181,181);
  const paid=Object.entries(q2.units).filter(([oemId,units])=>units>=Math.max(30,q1.units[oemId]||0)),missed=Object.keys(q2.units).length-paid.length;
  assert.ok(Math.abs(m.dailyHistory[0].oemBonus-paid.reduce((sum,[oemId])=>sum+Math.round(q2.cost[oemId]*.025*100)/100,0))<.01,'only makers that beat last quarter pay');
  assert.equal(JSON.stringify(m.oemQuarter.paid.map(row=>row.oemId).sort()),JSON.stringify(paid.map(([oemId])=>oemId).sort()));
  assert.ok(paid.length>0&&missed>0,`q2: ${paid.length} paid, ${missed} missed`);
}
// Satisfaction (customer-base-core): buyers who find their car out of stock lower the showroom's score; a low score
// brings fewer buyers.
{
  const starved=setup({cash:0});runDays(starved,1,30);const room=starved.s.customerCompanies.companies.dealership.market.showrooms[0];
  assert.ok(room.satisfaction<80,`stock-outs: ${room.satisfaction}`);
  const happy=setup(),unhappy=setup();runDays(happy,0,0);runDays(unhappy,0,0);unhappy.s.customerCompanies.companies.dealership.market.showrooms[0].satisfaction=40;happy.s.customerCompanies.companies.dealership.market.showrooms[0].satisfaction=85;
  runDays(happy,1,10);runDays(unhappy,1,10);const buyers=env=>env.s.customerCompanies.companies.dealership.market.dailyHistory.slice(0,10).reduce((sum,row)=>sum+row.carsSold+row.lostSales,0);
  assert.ok(buyers(unhappy)<buyers(happy),`fewer buyers come to an unhappy showroom: ${buyers(unhappy)} vs ${buyers(happy)}`);
}
console.log(JSON.stringify({suite:'build378-dealer-floor-plan',shortfall,bonusPaid}));
