'use strict';
// Build 374 (owner's decision): the car dealership sells to its showrooms' countries instead of typed buyers and
// prices. Here, with the real customer base, dealer market and customer-companies owners: buyers come each day and take
// models in stock; the sales of a month are invoiced once on the next month's first close, one invoice per showroom (no
// document per sale or per day; Build 375, owner's decision); the stock is
// reordered every two weeks to the chosen cover
// through the existing purchase order and cheque, and a model out of stock loses the sale; a discount sells more;
// service plans follow sales and bill monthly; at most one buyer a day asks the group's bank for financing and the sale
// settles by itself once the bank's transfer is proven; a day runs once; two identical games give identical numbers;
// the saved market stays small and the day stays cheap. Catalogue prices are unchanged.
const assert=require('node:assert/strict');
const {harness}=require('./helpers/core-harness');
const DAY=86400;

function setup({showrooms=[['AUTO-RUH','الرياض','السعودية']],level=null,cash=1e12,bank=true,bankBranch=true}={}){
  const h=harness([]),s=h.s,parties=new Map(),cheques=[],loanRequests=[];
  s.GH_AUTHORIZATION={registerCommandTargetResolver(){}};
  s.GH_COMPANY_PLATFORM={requireCompany(_state,id){return {id,operational:true,registered:true};},resolveCompany(_state,id){return {id,operational:id!=='bank'||bank};}};
  s.GH_BUSINESS_WORLD={recordEvent(){},upsertParty(_state,p){const id=String(p.id||`CUST-${parties.size+1}`),old=parties.get(id)||{id,roles:[]};Object.assign(old,p,{id,roles:[...new Set([...(old.roles||[]),...(p.role?[p.role]:[]),...(p.roles||[])])]});parties.set(id,old);return old;},resolveParty(_state,id){return parties.get(String(id))||[...parties.values()].find(row=>row.name===id||row.displayName===id)||null;},touchRelationship(){return {};},touchCustomerLifecycle(){return {};},customerPortfolio(){return {companies:{}};}};
  let spent=0;
  s.GH_FINANCE_CORE={calendarMonthForDay(value){const date=new Date(Date.UTC(2026,0,1)+Math.max(0,Number(value)||0)*86400000);return `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,'0')}`;},operating(){return cash-spent;},
    execute(ctx,cmd,p){if(cmd==='credit'){const row={company:p.company,kind:'دخل',number:`INV-${ctx.state.finance.invoices.length+1}`,sourceRef:p.ref,total:p.amount,status:'مستحقة',at:ctx.state.simSeconds||0,counterpartyPartyId:p.customerId,businessLocationId:p.businessLocationId,businessLocationCountry:p.businessLocationCountry};ctx.state.finance.invoices.push(row);return row;}if(cmd==='pay-by-cheque'){spent+=p.amount;cheques.push(p);return {cheque:{id:`CHQ-${cheques.length}`,status:'مصروف'},invoice:{number:`AP-${cheques.length}`}};}if(cmd==='register-commercial-contract'){(ctx.state.finance.commercialContracts||(ctx.state.finance.commercialContracts=[])).push({id:p.id});return {id:p.id};}throw new Error(`unexpected finance command ${cmd}`);}};
  s.GH_DOMAIN_COMMANDS={dispatchSystem(_ctx,domain,cmd,p){if(domain==='finance'&&cmd==='credit')return {ok:true,result:s.GH_FINANCE_CORE.execute({state:s},cmd,p)};if(domain==='banking'&&cmd==='submit-customer-loan-request'){const row={id:p.id,sourceCompanyId:'dealership',sourceSaleId:p.sourceSaleId,status:'بانتظار القرار'};loanRequests.push(row);s.bank.loanRequests.push(row);return {ok:true,result:row};}throw new Error(`unexpected system command ${domain}:${cmd}`);}};
  s.GH_BANKING_CORE={MAX_OPEN_REQUESTS:5,countryPopulation:name=>({'السعودية':35300000,'الإمارات':9890000}[name]||10000000),customerFinancingQuote(_state,p){return {invoiceAmount:p.invoiceAmount,downPayment:0,loanPrincipal:p.invoiceAmount,originationFee:0,disbursementAmount:p.invoiceAmount,termDays:p.termDays,product:p.product};},customerDisbursementForSale(){return null;},execute(){}};
  s.GH_MAP_LABELS=[];
  h.load('customer-companies-core');h.load('customer-base-core');h.load('dealer-market-core');
  s.simSeconds=0;s.finance={invoices:[]};s.bank={loanRequests:[],branchNetwork:[{id:'BANK-RUH',servicesActive:bankBranch}]};s.openedCompanies=['dealership','bank'];
  s.customHubs=showrooms.map(([id,city,country])=>({id,kind:'dealership-branch',ownerCompanyId:'dealership',owned:true,city,country,name:`معرض ${city}`}));
  if(level){s.GH_DEALER_MARKET.ensure(s);s.customerCompanies.companies.dealership.market.priceLevel=level;}
  return {s,core:s.GH_CUSTOMER_COMPANIES_CORE,market:s.GH_DEALER_MARKET,cheques,loanRequests};
}
function drain(generator){let step;do{step=generator.next();}while(!step.done);return step.value;}
function runDays(env,from,to){for(let day=from;day<=to;day++){env.s.simSeconds=day*DAY;drain(env.core.onFinancialDayStages({state:env.s,companyId:'dealership'},{day}));}}
const results={};

// 1. Sales, the daily invoice, the weekly reorder and the catalogue prices.
{
  const env=setup(),s=env.s;runDays(env,0,20);
  const data=s.customerCompanies.companies.dealership,m=data.market,sum=env.market.summary(s);
  assert.equal(data.supplyAgreements.length,6,'the makers\' supply agreements are signed by themselves');
  assert.ok(sum.carsSold>40&&sum.carsSold<200,`a showroom sells a few cars a day: ${sum.carsSold}`);
  const restocks=env.cheques.filter(row=>/^AUTO-STOCK-AUTO-RESTOCK-/.test(row.requestRef)),firstRound=restocks.filter(row=>row.requestRef.endsWith('-0'));assert.equal(firstRound.length,6,'one purchase order per maker');assert.equal(data.inventory.length,14,'every model is ordered for the first cover');
  assert.ok(restocks.every(row=>row.line==='capex'),'stock is bought through the existing purchase order and cheque');
  const days=new Set(env.cheques.filter(row=>/RESTOCK/.test(row.requestRef)).map(row=>row.requestRef.split('-').pop()));assert.ok([...days].every(day=>Number(day)%14===0),'reordered every two weeks');
  assert.equal(s.finance.invoices.filter(row=>/SALE/.test(row.sourceRef||'')).length,0,'no document per sale');
  const sold=data.inventory.reduce((n,row)=>n+row.sold,0);assert.equal(sold,sum.carsSold,'every sale leaves the stock');
  const revenue=m.dailyHistory.reduce((n,row)=>n+row.salesRevenue,0),retail=data.inventory.reduce((n,row)=>n+row.sold*row.retailPrice,0);assert.equal(revenue,retail,'sold at the catalogue retail price');
  const close=env.market.dailyResult(s,20);assert.equal(close.revenue,0,'retail sales are not posted by the daily close');assert.equal(close.cashRevenue,0);
  assert.equal(s.finance.invoices.filter(row=>/^AUTO-MKT-SALES-INV-/.test(row.sourceRef||'')).length,0,'no sales invoice before the month closes');
  assert.equal(m.showrooms[0].unbilledSales,revenue,'the month\'s sales wait for its invoice');
  const sales=m.dailyHistory.filter(row=>row.salesRevenue>0);
  const snapshot=JSON.stringify(m);drain(env.core.onFinancialDayStages({state:s,companyId:'dealership'},{day:20}));assert.equal(JSON.stringify(m),snapshot,'a day runs once');
  results.firstWeeks={carsSold:sum.carsSold,restockOrders:restocks.length,salesDays:sales.length};
}

// 1b. The month's sales are one invoice per showroom on the next month's first close, for exactly that month's sales.
{
  const showrooms=[['AUTO-RUH','الرياض','السعودية'],['AUTO-DXB','دبي','الإمارات']],env=setup({showrooms,bank:false}),s=env.s;runDays(env,0,30);
  const m=s.customerCompanies.companies.dealership.market,january=m.dailyHistory.reduce((n,row)=>n+row.salesRevenue,0);
  assert.equal(s.finance.invoices.filter(row=>/^AUTO-MKT-SALES-INV-/.test(row.sourceRef||'')).length,0,'January is still open on its last day');
  runDays(env,31,58);
  const bills=s.finance.invoices.filter(row=>/^AUTO-MKT-SALES-INV-/.test(row.sourceRef||''));
  assert.equal(bills.length,2,'one invoice per showroom for January');assert.ok(bills.every(row=>row.sourceRef.endsWith('-2026-01')),'billed for January');
  assert.equal(Math.round(bills.reduce((n,row)=>n+row.total,0)),Math.round(january),'the invoices carry exactly January\'s sales');
  assert.deepEqual(new Set(bills.map(row=>row.businessLocationCountry)),new Set(['السعودية','الإمارات']),'each invoice belongs to its showroom');
  const february=m.dailyHistory.filter(row=>row.day>=31).reduce((n,row)=>n+row.salesRevenue,0);assert.equal(Math.round(env.market.summary(s).unbilledSales),Math.round(february),'February waits for March');
  results.monthly={januarySales:Math.round(january),invoices:bills.length};
}

// 2. Without cash for stock, buyers are lost; a discount sells more.
{
  const poor=setup({cash:0});runDays(poor,0,6);const p=poor.market.summary(poor.s);
  assert.equal(p.carsSold,0);assert.ok(p.ytd.lostSales>10,'no stock: the sales are lost');
  const full=setup(),cut=setup({level:.9});runDays(full,0,59);runDays(cut,0,59);
  const a=full.market.summary(full.s),b=cut.market.summary(cut.s);assert.ok(b.carsSold>a.carsSold*1.4,`a 10% discount sells more: ${b.carsSold} vs ${a.carsSold}`);
  assert.throws(()=>full.core.execute({state:full.s},'dealership-set-price',{level:.5}),/dealership-price-level-invalid/);
  assert.throws(()=>full.core.execute({state:full.s},'dealership-set-cover',{days:10}),/dealership-cover-days-invalid/);
  assert.throws(()=>full.core.execute({state:full.s},'dealership-set-service-tier',{tier:'gold'}),/dealership-service-tier-invalid/);
  results.discount={retail:a.carsSold,tenPercent:b.carsSold,lostWithoutCash:p.ytd.lostSales};
}

// 3. Service plans follow sales and bill monthly; one financing request a day at most reaches the bank.
{
  const env=setup(),s=env.s;runDays(env,0,62);
  const m=s.customerCompanies.companies.dealership.market,showroom=m.showrooms[0];
  assert.ok(showroom.servicePlans>20,'a quarter of buyers take the standard plan');
  const bills=s.finance.invoices.filter(row=>/^AUTO-MKT-SVC-INV-/.test(row.sourceRef));assert.ok(bills.length>=1,'plans are billed monthly per showroom');
  assert.ok(Math.abs(bills[0].total%49)<1e-6,'billed at the standard plan price');
  assert.ok(env.loanRequests.length>=1,'companies ask the group bank to finance a fleet');assert.ok(s.bank.loanRequests.length<=5,'never above the bank\'s open-request limit');
  const pending=s.customerCompanies.companies.dealership.sales.filter(row=>row.status==='awaiting-bank-decision');assert.ok(pending.length>=1,'a financed sale waits for the bank');
  const financed=s.customerCompanies.companies.dealership.sales.filter(row=>/^AUTO-MKT-FIN-/.test(row.id));
  assert.ok(financed.some(row=>row.quantity===1&&/^أسرة /.test(row.customer)),'a household finances one car (Build 375)');
  assert.ok(financed.filter(row=>row.quantity>1).every(row=>row.total>=1000000),'a fleet is still $1M or more');
  assert.ok(env.market.dailyResult(s,62).expense>0,'the workshop cost is the daily operating expense');
  results.service={plans:showroom.servicePlans,serviceBills:bills.length,financeRequests:env.loanRequests.length};
}

// 3b. A group bank without an open branch gets no financing request, and the days still close (the real bank refuses a
// customer request without one: bank-active-branch-required; Build 374 stopped the clock on it).
{
  const env=setup({bankBranch:false}),s=env.s;runDays(env,0,62);
  assert.equal(env.loanRequests.length,0,'no request reaches a bank without a branch');
  assert.equal(s.customerCompanies.companies.dealership.market.lastProcessedDay,62,'every day closed');
  results.noBranch={days:63,requests:0};
}

// 4. Two identical games give identical numbers; a year of three showrooms stays small and cheap.
{
  const showrooms=[['AUTO-RUH','الرياض','السعودية'],['AUTO-JED','جدة','السعودية'],['AUTO-DXB','دبي','الإمارات']];
  const a=setup({showrooms,bank:false}),b=setup({showrooms,bank:false});
  const started=process.hrtime.bigint();runDays(a,0,364);const elapsedMs=Number(process.hrtime.bigint()-started)/1e6;runDays(b,0,364);
  assert.equal(JSON.stringify(a.s.customerCompanies.companies.dealership.market),JSON.stringify(b.s.customerCompanies.companies.dealership.market),'deterministic');
  const bytes=Buffer.byteLength(JSON.stringify(a.s.customerCompanies.companies.dealership.market));
  assert.ok(bytes<80000,`the saved market stays small: ${bytes} bytes`);
  assert.ok(elapsedMs/365<5,`a day of three showrooms costs under 5 ms: ${(elapsedMs/365).toFixed(3)} ms`);
  const sum=a.market.summary(a.s);results.year={carsSold:sum.carsSold,servicePlans:sum.servicePlans,salesRevenue:Math.round(sum.ytd.salesRevenue),restockSpend:Math.round(sum.ytd.restockSpend),bytes,msPerDay:Number((elapsedMs/365).toFixed(3))};
}

// 5. The real bank (Build 375, owner's decision): an individual loan finances one car at its price with a $250 fee
// floor; other products keep their minimums and the $25,000 floor.
{
  const B=require('../WebApp/banking-core.js');
  const car=B.customerFinancingQuote({},{invoiceAmount:31900,downPayment:0,product:'consumer',termDays:1825});
  assert.equal(car.disbursementAmount,31900,'the bank pays the dealer the car\'s price');assert.equal(car.originationFee,250);assert.equal(car.loanPrincipal,32150,'the loan is the price and its fee, not $1M');
  const corporate=B.customerFinancingQuote({},{invoiceAmount:2000000,downPayment:0,product:'corporate'});assert.equal(corporate.loanPrincipal,10000000,'corporate keeps its $10M minimum');assert.equal(corporate.originationFee,60000);
  const small=B.customerFinancingQuote({},{invoiceAmount:500000,downPayment:0,product:'sme'});assert.equal(small.originationFee,30000,'the $25,000 floor stays for the other products (0.6% of $5M)');
  results.bank={carPrincipal:car.loanPrincipal,carFee:car.originationFee};
}

console.log(JSON.stringify({suite:'build374-dealer-market',...results}));
console.log('BUILD374_DEALER_MARKET_PASS');
