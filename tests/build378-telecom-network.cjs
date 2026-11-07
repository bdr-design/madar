'use strict';
// Build 378: telecom network investment (three levels of the branch's own network over leased capacity).
const assert=require('node:assert/strict');
const {harness}=require('./helpers/core-harness');
const DAY=86400;
function setup({branches=[['TEL-RUH','الرياض','السعودية']],pricing=null}={}){
  const h=harness([]),s=h.s,parties=new Map(),cheques=[];
  s.GH_AUTHORIZATION={registerCommandTargetResolver(){}};
  s.GH_COMPANY_PLATFORM={requireCompany(_state,id){return {id,operational:true,registered:true};},resolveCompany(_state,id){return {id,operational:true};}};
  s.GH_BUSINESS_WORLD={recordEvent(){},upsertParty(_state,p){const id=String(p.id||`CUST-${parties.size+1}`),old=parties.get(id)||{id,roles:[]};Object.assign(old,p,{id,roles:[...new Set([...(old.roles||[]),...(p.role?[p.role]:[])])]});parties.set(id,old);return old;},resolveParty(_state,id){return parties.get(String(id))||[...parties.values()].find(row=>row.name===id)||null;},touchRelationship(){return {};},touchCustomerLifecycle(){return {};},customerPortfolio(){return {companies:{}};}};
  s.GH_FINANCE_CORE={calendarMonthForDay(value){const date=new Date(Date.UTC(2026,0,1)+Math.max(0,Number(value)||0)*86400000);return `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,'0')}`;},operating(){return 1e12;},
    execute(ctx,cmd,p){if(cmd==='credit'){const row={company:p.company,kind:'دخل',number:`INV-${ctx.state.finance.invoices.length+1}`,sourceRef:p.ref,total:p.amount,at:ctx.state.simSeconds||0,counterpartyPartyId:p.customerId,businessLocationId:p.businessLocationId,businessLocationCountry:p.businessLocationCountry};ctx.state.finance.invoices.push(row);return row;}if(cmd==='pay-by-cheque'){cheques.push(p);return {cheque:{id:`CHQ-${cheques.length}`,status:'مصروف'}};}if(cmd==='register-commercial-contract'){(ctx.state.finance.commercialContracts||(ctx.state.finance.commercialContracts=[])).push({id:p.id});return {id:p.id};}throw new Error(`unexpected finance command ${cmd}`);}};
  s.GH_DOMAIN_COMMANDS={dispatchSystem(_ctx,domain,cmd,p){if(domain==='finance'&&cmd==='credit')return {ok:true,result:s.GH_FINANCE_CORE.execute({state:s},cmd,p)};throw new Error(`unexpected system command ${domain}:${cmd}`);}};
  s.GH_BANKING_CORE={countryPopulation:name=>({'السعودية':35300000,'الإمارات':9890000,'مصر':112700000}[name]||10000000)};
  s.GH_MAP_LABELS=[];
  s.GH_TRANSACTION_CORE={isActive:()=>true};
  h.load('customer-companies-core');h.load('customer-base-core');h.load('telecom-market-core');
  s.simSeconds=0;s.finance={invoices:[]};s.openedCompanies=['telecom','bank'];
  s.customHubs=branches.map(([id,city,country])=>({id,kind:'telecom-branch',ownerCompanyId:'telecom',owned:true,city,country,name:`فرع ${city}`}));
  if(pricing){s.GH_TELECOM_MARKET.ensure(s);Object.assign(s.customerCompanies.companies.telecom.market.pricing,pricing);}
  return {s,core:s.GH_CUSTOMER_COMPANIES_CORE,market:s.GH_TELECOM_MARKET,base:s.GH_CUSTOMER_BASE,cheques};
}
function drain(generator){let step;do{step=generator.next();}while(!step.done);return step.value;}
function runDays(env,from,to){for(let day=from;day<=to;day++){env.s.simSeconds=day*DAY;drain(env.core.onFinancialDayStages({state:env.s,companyId:'telecom'},{day}));}}

// Network investment: up to three levels per branch, each paid once as capex (5 per person of the branch's market at
// the country's price level) and depreciated over 8 years; each cuts the network cost per subscriber by 12% and churn
// by 6%, and raises joining by 6%. The depreciation is the day's expense but not its cash.
const levelOf=env=>env.s.customerCompanies.companies.telecom.market.branches[0];
const flat=setup(),built=setup();runDays(flat,0,0);runDays(built,0,0);
const branch=levelOf(built),T=built.s.GH_TELECOM_MARKET,capex=T.networkCapex(built.s.customerCompanies.companies.telecom.market,branch);
assert.ok(capex>1e8&&capex<3e8,`a country-scale network: ${capex}`);
const upgrade=built.core.execute({state:built.s},'telecom-upgrade-network',{branchId:branch.id});assert.equal(upgrade.level,1);assert.equal(upgrade.cost,capex);
for(let level=2;level<=3;level++)assert.equal(built.core.execute({state:built.s},'telecom-upgrade-network',{branchId:branch.id}).level,level);
assert.throws(()=>built.core.execute({state:built.s},'telecom-upgrade-network',{branchId:branch.id}),/telecom-network-max-level/);
runDays(flat,1,120);runDays(built,1,120);
const a=flat.s.customerCompanies.companies.telecom.market,b=built.s.customerCompanies.companies.telecom.market,last=b.dailyHistory[0],subs=m=>m.dailyHistory[0].subscribers;
assert.ok(subs(b)>subs(a),'a better network keeps and wins more subscribers');
assert.ok(Math.abs(last.depreciation-3*capex/2920)<1e-6,'three levels depreciate over eight years');
assert.ok(Math.abs(last.expense-last.cashExpense-last.depreciation)<1e-6,'depreciation is expense, not cash');
const result=built.s.GH_TELECOM_MARKET.dailyResult(built.s,120);assert.ok(Math.abs(result.expense-result.cashExpense-last.depreciation)<1e-6);
const perSub=m=>m.dailyHistory[0].networkCost/subs(m);assert.ok(Math.abs(perSub(b)/perSub(a)-(1-.36))<.02,`network cost per subscriber cut by 36%: ${perSub(b)/perSub(a)}`);
console.log(JSON.stringify({suite:'build378-telecom-network',capex,subscribers:{leased:subs(a),ownNetwork:subs(b)}}));
