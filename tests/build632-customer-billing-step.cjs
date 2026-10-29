'use strict';
// Owner («نفذ الباقي»; a customer company's billing step took 27-33 ms at 2x CPU throttle: eight invoices with their
// documents and proofs in one task): the day yields after every invoice it issues (BILLING_SLICE 1). With five telecom
// cohorts billed on the month's first day:
//  1. the staged day issues the same five invoices, in the same order and with the same totals, as the same day run at
//     once (tickDay);
//  2. it yields once after each invoice (five stages; with eight per stage, as before, there was none).
const assert=require('node:assert/strict');
const {harness}=require('./helpers/core-harness');
function setup(){
 const h=harness([]),s=h.s,parties=new Map(),commands=[],resolvers=new Map();
 s.GH_AUTHORIZATION={registerCommandTargetResolver(domain,resolver){resolvers.set(domain,resolver);return resolver;}};
 s.GH_COMPANY_PLATFORM={requireCompany(_state,id){return {id,operational:true,registered:true,definition:{capabilities:id==='telecom'?['operations.telecom']:['operations.dealer']}};},resolveCompany(_state,id){return {id,operational:true};}};
 s.GH_BUSINESS_WORLD={recordEvent(_state,event){commands.push({event});return event;},upsertParty(_state,p){const id=String(p.id||`CUST-${String(p.name||p.displayName).toLowerCase().replace(/[^a-z0-9]+/g,'-')}`),old=parties.get(id)||{id,roles:[],sectors:[]};Object.assign(old,p,{id,roles:[...new Set([...(old.roles||[]),...(p.roles||[]),...(p.role?[p.role]:[])])]});parties.set(id,old);return old;},resolveParty(_state,id){return parties.get(String(id))||null;},touchRelationship(){return {};},touchCustomerLifecycle(){return {};},customerPortfolio(){return {companies:{}};}};
 s.GH_FINANCE_CORE={calendarMonthForDay(value){const date=new Date(Date.UTC(2026,0,1)+Math.max(0,Number(value)||0)*86400000);return `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,'0')}`;},execute(ctx,cmd,p){if(cmd==='credit'){const row={company:p.company,kind:'دخل',number:`INV-${ctx.state.finance.invoices.length+1}`,sourceRef:p.ref||p.reference,total:p.amount,status:'مستحقة',at:ctx.state.simSeconds||0,counterpartyPartyId:p.customerId||null,...(p.businessLocationId?{businessLocationId:p.businessLocationId,businessLocationName:p.businessLocationName,businessLocationCity:p.businessLocationCity,businessLocationCountry:p.businessLocationCountry}:{})};ctx.state.finance.invoices.push(row);return row;}if(cmd==='pay-by-cheque')return {cheque:{id:'CHQ-TEST',status:'مصروف'},invoice:{number:'AP-TEST'}};if(cmd==='register-commercial-contract')return {id:p.id};throw new Error(`unexpected finance command ${cmd}`);}};
 s.GH_DOMAIN_COMMANDS={dispatchSystem(_ctx,domain,cmd,p,meta){commands.push({domain,cmd,p,meta});if(domain==='finance'&&cmd==='credit'){const row=s.GH_FINANCE_CORE.execute({state:s},cmd,p);return {ok:true,result:row};}if(domain==='banking'&&cmd==='submit-customer-loan-request')return {ok:true,result:{id:p.id,status:'بانتظار القرار'}};throw new Error(`unexpected system command ${domain}:${cmd}`);}};
 s.GH_BANKING_CORE={execute(){},customerFinancingQuote(_state,p){return {invoiceAmount:p.invoiceAmount,downPayment:p.downPayment||0,loanPrincipal:p.invoiceAmount-(p.downPayment||0),originationFee:0,disbursementAmount:p.invoiceAmount-(p.downPayment||0),termDays:p.termDays,product:p.product};},customerDisbursementForSale(){return null;}};
 h.load('customer-companies-core');
 return {state:s,core:s.GH_CUSTOMER_COMPANIES_CORE,commands,parties,resolvers};
}
function drain(generator){let step;do{step=generator.next();}while(!step.done);return step.value;}
function bill(staged){
 const {state:s,core}=setup();s.finance={invoices:[],revenueCollections:[]};
 for(let i=1;i<=5;i++)core.execute({state:s},'set-market-cohort',{id:`SA-consumer-${i}`,country:'السعودية',segment:'consumer',activeCustomers:1000*i,monthlyPrice:2.5});
 const stages=[];let result;
 if(staged){const it=core.onFinancialDayStages({state:s,companyId:'telecom'},{day:31});for(;;){const step=it.next();if(step.done){result=step.value;break;}stages.push(String(step.value));}}
 else result=core.execute({state:s},'tick-day',{company:'telecom',day:31});
 return {result,stages,invoices:JSON.stringify(s.finance.invoices.map(row=>[row.number,row.sourceRef,row.total,row.company]))};
}
const once=bill(false),staged=bill(true);
// 1.
assert.equal(staged.result.issued,5,'1: five invoices issued');assert.equal(staged.invoices,once.invoices,'1: the same invoices, order and totals as the day run at once');
assert.equal(staged.result.amount,once.result.amount,'1: the same billed amount');
// 2.
assert.equal(staged.stages.filter(name=>name==='telecom.monthly-invoices').length,5,'2: one stage after each invoice');
console.log(JSON.stringify({suite:'build632-customer-billing-step',ok:true,invoices:staged.result.issued,stages:staged.stages.length}));
