'use strict';
// Owner («تتبع الثقل ... ابيها اصفار»; a calendar day in a 300k-asset world: the dealership's fortnightly reorder, six
// purchase orders each paid by cheque, took 87 ms in one task at 2x CPU throttle): each order is now a stage of its own.
// With the real customer-companies, customer-base and dealer market owners (finance and the world stubbed as in
// build374), against the source before (c57745e, from its own tree):
//  1. thirty days with two showrooms give the same market, inventory, purchases, invoices and cheques, in the same order;
//  2. the stages are the same, with one more between two orders of the same round (and none where a round places one);
//  3. a cheque refused on the second order of a round fails the day with the same error, leaving the same state.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {harness}=require('./helpers/core-harness');
const DAY=86400,PREVIOUS='c57745e';
function setup({failCheque=0}={}){
  const h=harness([]),s=h.s,parties=new Map(),cheques=[];
  s.GH_AUTHORIZATION={registerCommandTargetResolver(){}};
  s.GH_COMPANY_PLATFORM={requireCompany(_state,id){return {id,operational:true,registered:true};},resolveCompany(_state,id){return {id,operational:true};}};
  s.GH_BUSINESS_WORLD={recordEvent(){},upsertParty(_state,p){const id=String(p.id||`CUST-${parties.size+1}`),old=parties.get(id)||{id,roles:[]};Object.assign(old,p,{id,roles:[...new Set([...(old.roles||[]),...(p.role?[p.role]:[]),...(p.roles||[])])]});parties.set(id,old);return old;},resolveParty(_state,id){return parties.get(String(id))||[...parties.values()].find(row=>row.name===id||row.displayName===id)||null;},touchRelationship(){return {};},touchCustomerLifecycle(){return {};},customerPortfolio(){return {companies:{}};}};
  let spent=0;const cash=1e12;
  s.GH_FINANCE_CORE={calendarMonthForDay(value){const date=new Date(Date.UTC(2026,0,1)+Math.max(0,Number(value)||0)*86400000);return `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,'0')}`;},operating(){return cash-spent;},
    execute(ctx,cmd,p){if(cmd==='credit'){const row={company:p.company,kind:'دخل',number:`INV-${ctx.state.finance.invoices.length+1}`,sourceRef:p.ref,total:p.amount,status:'مستحقة',at:ctx.state.simSeconds||0,counterpartyPartyId:p.customerId};ctx.state.finance.invoices.push(row);return row;}
      if(cmd==='pay-by-cheque'){if(failCheque&&cheques.length+1===failCheque)throw new Error('qa-cheque-refused');spent+=p.amount;cheques.push({amount:p.amount,note:p.note,beneficiary:p.beneficiary,requestRef:p.requestRef});return {cheque:{id:`CHQ-${cheques.length}`,status:'مصروف'},invoice:{number:`AP-${cheques.length}`}};}
      if(cmd==='register-commercial-contract'){(ctx.state.finance.commercialContracts||(ctx.state.finance.commercialContracts=[])).push({id:p.id});return {id:p.id};}throw new Error(`unexpected finance command ${cmd}`);}};
  s.GH_DOMAIN_COMMANDS={dispatchSystem(_ctx,domain,cmd,p){if(domain==='finance'&&cmd==='credit')return {ok:true,result:s.GH_FINANCE_CORE.execute({state:s},cmd,p)};if(domain==='banking'&&cmd==='submit-customer-loan-request'){const row={id:p.id,sourceCompanyId:'dealership',sourceSaleId:p.sourceSaleId,status:'بانتظار القرار'};s.bank.loanRequests.push(row);return {ok:true,result:row};}throw new Error(`unexpected system command ${domain}:${cmd}`);}};
  s.GH_BANKING_CORE={MAX_OPEN_REQUESTS:5,countryPopulation:name=>({'السعودية':35300000,'الإمارات':9890000}[name]||10000000),customerFinancingQuote(_state,p){return {invoiceAmount:p.invoiceAmount,downPayment:0,loanPrincipal:p.invoiceAmount,originationFee:0,disbursementAmount:p.invoiceAmount,termDays:p.termDays,product:p.product};},customerDisbursementForSale(){return null;},execute(){}};
  s.GH_MAP_LABELS=[];
  h.load('customer-companies-core');h.load('customer-base-core');h.load('dealer-market-core');
  s.simSeconds=0;s.finance={invoices:[]};s.bank={loanRequests:[],branchNetwork:[{id:'BANK-RUH',servicesActive:true}]};s.openedCompanies=['dealership','bank'];
  s.customHubs=[['AUTO-RUH','الرياض','السعودية'],['AUTO-DXB','دبي','الإمارات']].map(([id,city,country])=>({id,kind:'dealership-branch',ownerCompanyId:'dealership',owned:true,city,country,name:`معرض ${city}`}));
  return {s,core:s.GH_CUSTOMER_COMPANIES_CORE,cheques};
}
const snapshot=env=>JSON.stringify({companies:env.s.customerCompanies,finance:env.s.finance,bank:env.s.bank,cheques:env.cheques});
function scenario(){
  const out={};
  // 1-2.
  {const env=setup(),stages=[];for(let day=0;day<=30;day++){env.s.simSeconds=day*DAY;const steps=env.core.onFinancialDayStages({state:env.s,companyId:'dealership'},{day});let step;while(!(step=steps.next()).done)stages.push(`${day}:${String(step.value)}`);}
    out.state=snapshot(env);out.stages=stages;out.cheques=env.cheques.length;}
  // 3.
  {const env=setup({failCheque:2});let error=null;env.s.simSeconds=0;try{const steps=env.core.onFinancialDayStages({state:env.s,companyId:'dealership'},{day:0});while(!steps.next().done){}}catch(caught){error=String(caught?.message||caught);}
    out.failure={error,state:snapshot(env)};}
  return out;
}
if(process.env.QA_BUILD619_SCENARIO){process.stdout.write(JSON.stringify(scenario()));return;}
const ROOT=path.resolve(__dirname,'..'),tree=fs.mkdtempSync(path.join(os.tmpdir(),'b619-'));
try{
  execFileSync('sh',['-c',`git -C "${ROOT}" archive ${PREVIOUS} WebApp | tar -x -C "${tree}"`]);
  const before=JSON.parse(execFileSync(process.execPath,[__filename],{env:{...process.env,GH_TEST_SOURCE_DIR:tree,QA_BUILD619_SCENARIO:'1'},maxBuffer:256*1024*1024}).toString());
  const now=scenario();
  // 1.
  assert.ok(now.cheques>=6,`1: the reorders were paid (${now.cheques} cheques)`);
  assert.equal(now.state,before.state,'1: the same market, inventory, purchases, invoices and cheques');
  // 2.
  const ORDER='dealer-market:restock-order',extra=now.stages.filter(stage=>stage.endsWith(`:${ORDER}`));
  assert.deepEqual(now.stages.filter(stage=>!stage.endsWith(`:${ORDER}`)),before.stages,'2: every other stage in the same order');
  assert.equal(before.stages.some(stage=>stage.endsWith(`:${ORDER}`)),false);
  const rounds=new Map();for(const stage of now.stages){const [day]=stage.split(':');if(stage.endsWith(`:${ORDER}`))rounds.set(day,(rounds.get(day)||0)+1);}
  const ordersByDay=new Map();{const env=JSON.parse(now.state);for(const row of env.companies.companies.dealership.purchases)ordersByDay.set(String(row.createdDay),(ordersByDay.get(String(row.createdDay))||0)+1);}
  for(const [day,count] of ordersByDay)assert.equal(rounds.get(day)||0,count-1,`2: day ${day}: one stage between each two of its ${count} orders`);
  assert.ok(extra.length>=5,`2: the orders of a round are stages of their own (${extra.length})`);
  // 3.
  assert.equal(now.failure.error,'qa-cheque-refused','3: the refused cheque fails the day');assert.equal(now.failure.error,before.failure.error);
  assert.equal(now.failure.state,before.failure.state,'3: leaving the same state as the source before');
  console.log(JSON.stringify({suite:'build619-dealer-restock-stages',ok:true,cheques:now.cheques,orderStages:extra.length,days:31}));
}finally{fs.rmSync(tree,{recursive:true,force:true});}
