'use strict';
// Build 374 (owner's decision): one customer base for the companies without transport assets, and a telecom market
// grown from it instead of typed subscriber counts and prices. Here, with the real customer base, telecom market and
// customer-companies owners: reading the base changes nothing; subscribers join and leave each day by the plan's price
// stance; every branch is billed once a calendar month with its country on the invoice; network and acquisition costs
// are the daily operating expense; companies ask for business contracts that are accepted alone or in one batch; a
// day runs once; two identical games give identical numbers; the saved market stays small and the day stays cheap.
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
const results={};

// 1. The customer base reads the owners' records and writes nothing; another company's reach is the telecom affinity.
{
  const env=setup(),s=env.s;
  s.bank={lastProcessedDay:3,branchNetwork:[{country:'السعودية',servicesActive:true,marketPopulation:35300000,retailCustomers:780000,businessCustomers:4000}]};
  s.insurance={lastProcessedDay:3,offices:[{country:'السعودية',lines:{motor:{policies:9000},health:{policies:12000},property:{policies:3000},commercial:{policies:80}}}]};
  s.realEstate={lastProcessedDay:3,projects:[{country:'السعودية',type:'residential',sold:120,presold:40,leased:0},{country:'السعودية',type:'office',leased:30}]};
  const before=JSON.stringify({bank:s.bank,insurance:s.insurance,realEstate:s.realEstate,customerCompanies:s.customerCompanies});
  const snap=env.base.snapshot(s),ksa=snap.byCountry['السعودية'];
  assert.equal(JSON.stringify({bank:s.bank,insurance:s.insurance,realEstate:s.realEstate,customerCompanies:s.customerCompanies}),before,'reading the base changes nothing');
  assert.equal(ksa.households,Math.round(35300000/4.5));// Build 377: a bank's retail customers are people; about 2.5 of them (55% of a 4.5-person household) share a household.
  assert.ok(Math.abs(ksa.companies.bank.households-780000/(.55*4.5))<1e-6,'the bank\'s 780,000 retail customers are about 315,152 households');assert.equal(ksa.companies.insurance.households,12000,'an insurer counts a household once, by its widest household line');
  assert.equal(ksa.companies.realestate.households,160);assert.equal(ksa.companies.realestate.businesses,30);
  assert.ok(env.base.affinity(s,'السعودية','telecom')>.0415&&env.base.affinity(s,'السعودية','telecom')<.0419,'the bank and insurer reach about 4.2% of Saudi households (bank 4.02%, insurer 0.15%)');
  assert.equal(env.base.affinity(s,'مصر','telecom'),0,'no group company in Egypt');
  assert.equal(env.base.snapshot(s),snap,'the base is memoised for the day');
  results.affinity=Number(env.base.affinity(s,'السعودية','telecom').toFixed(4));
}

// 2. A branch's market grows by itself, bills once a month with its country, and costs network and acquisition.
{
  const env=setup({branches:[['TEL-RUH','الرياض','السعودية'],['TEL-DXB','دبي','الإمارات']]}),s=env.s;
  runDays(env,0,58);
  const m=s.customerCompanies.companies.telecom.market,sum=env.market.summary(s);
  assert.equal(m.branches.length,2);assert.ok(m.branches.every(row=>row.activeCustomers>3000),'both branches gained subscribers');
  assert.ok(sum.byPlan.mobile>sum.byPlan.home&&sum.byPlan.home>sum.byPlan.business,'mobile is the widest plan, business the narrowest');
  const invoices=s.finance.invoices.filter(row=>/^TEL-MKT-INV-/.test(row.sourceRef));
  // Build 377 (IFRS 15): revenue is earned day by day and billed in arrears: one invoice per branch for January (the
  // first month is billed too), issued on February's first close for exactly what January earned.
  assert.equal(invoices.length,2,'one invoice per branch for January, billed in arrears');
  assert.deepEqual(invoices.map(row=>row.businessLocationCountry).sort(),['الإمارات','السعودية']);
  for(const row of invoices)assert.match(row.sourceRef,/-2026-01$/);
  const ruh=m.branches.find(row=>row.facilityId==='TEL-RUH'),billed=invoices.find(row=>row.businessLocationId==='TEL-RUH');assert.ok(billed.total>0);
  const january=m.dailyHistory.filter(row=>row.day<=30).reduce((n,row)=>n+row.accrued,0);
  assert.ok(Math.abs(invoices.reduce((n,row)=>n+row.total,0)-january)<.05,`January's invoices carry exactly what January earned: ${january}`);
  const last=m.dailyHistory[0],result=env.market.dailyResult(s,58);
  assert.ok(last.accrued>0&&result.revenue===last.accrued,'every day earns its share of the monthly bill');assert.equal(result.cashRevenue,0,'without cash');
  const billedDay=env.market.dailyResult(s,31),day31=m.dailyHistory.find(row=>row.day===31);
  assert.equal(billedDay.revenue,day31.accrued,'the invoice day counts its own accrual only, never the invoices again');assert.equal(billedDay.cashRevenue,0);assert.ok(Math.abs(day31.billedArrears-invoices.reduce((n,row)=>n+row.total,0))<.01,'the invoices are recorded apart from the revenue');
  assert.ok(m.branches.every(row=>row.accrual?.period==='2026-02'&&row.accrual.amount>0&&row.billables.length===0),'February accrues and waits for March');
  assert.ok(result.expense>0&&Math.abs(result.expense-last.networkCost-last.acquisitionCost)<1e-6);
  assert.ok(last.networkCost/(sum.monthlyRecurring/30)>.3&&last.networkCost/(sum.monthlyRecurring/30)<.45,'the network costs about 37% of the price');
  const snapshot=JSON.stringify(m);drain(env.core.onFinancialDayStages({state:s,companyId:'telecom'},{day:58}));assert.equal(JSON.stringify(m),snapshot,'a day runs once');
  assert.ok(ruh.marketPopulation===35300000,'the branch keeps its population, as the bank and insurer do');
  results.twoBranches={subscribers:sum.subscribers,monthlyRecurring:Math.round(sum.monthlyRecurring),januaryInvoices:invoices.length};
}

// 2b. Build 377: a branch an older save billed in advance for the current month earns nothing more this month (it is in
// its results) and accrues from the next month; its next invoice bills that month in arrears.
{
  const env=setup({branches:[['TEL-RUH','الرياض','السعودية']]}),s=env.s;runDays(env,0,9);
  const m=s.customerCompanies.companies.telecom.market,branch=m.branches[0];
  for(const key of ['billing','accrual','billables','accrualFromPeriod'])delete branch[key];branch.lastBilledMonth='2026-01';
  runDays(env,10,40);
  assert.equal(branch.billables.length,0,'January was billed in advance: nothing more is billed for it');
  assert.equal(m.dailyHistory.filter(row=>row.day>=10&&row.day<=30).reduce((n,row)=>n+row.accrued,0),0,'and nothing more is earned for it');
  assert.ok(m.dailyHistory.find(row=>row.day===31).accrued>0&&branch.accrual.period==='2026-02','February accrues from its first day');
  results.legacyAdvance={februaryAccrued:Math.round(branch.accrual.amount)};
}

// 3. Price stance: under the market grows faster than over it; nothing outside the three stances is accepted.
{
  const cheap=setup({pricing:{mobile:.9,home:.9,family:.9,business:.9}}),dear=setup({pricing:{mobile:1.1,home:1.1,family:1.1,business:1.1}});
  runDays(cheap,0,89);runDays(dear,0,89);
  const a=cheap.market.summary(cheap.s),b=dear.market.summary(dear.s);
  assert.ok(a.subscribers>b.subscribers*1.5,`-10% wins more subscribers: ${a.subscribers} vs ${b.subscribers}`);
  assert.throws(()=>cheap.core.execute({state:cheap.s},'telecom-set-plan-price',{planId:'mobile',level:.5}),/telecom-price-level-invalid/);
  assert.throws(()=>cheap.core.execute({state:cheap.s},'telecom-set-plan-price',{planId:'satellite',level:1}),/telecom-plan-invalid/);
  const set=cheap.core.execute({state:cheap.s},'telecom-set-plan-price',{planId:'business',level:1.1});assert.equal(set.monthlyPrice,462);
  results.priceStance={under:a.subscribers,over:b.subscribers};
}

// 4. A campaign is paid by cheque and speeds the branch; one at a time.
{
  const env=setup(),s=env.s;runDays(env,0,0);
  const branch=s.customerCompanies.companies.telecom.market.branches[0],campaign=env.core.execute({state:s},'telecom-branch-campaign',{branchId:branch.id});
  assert.ok(campaign.cost>=200000&&campaign.cost<=4000000);assert.equal(env.cheques.length,1);assert.equal(env.cheques[0].line,'marketing');
  assert.throws(()=>env.core.execute({state:s},'telecom-branch-campaign',{branchId:branch.id}),/telecom-campaign-running/);
}

// 5. Business contract requests: decided one by one or in one batch; an accepted contract bills its lines monthly.
{
  const env=setup({branches:[['TEL-RUH','الرياض','السعودية'],['TEL-DXB','دبي','الإمارات'],['TEL-CAI','القاهرة','مصر']]}),s=env.s;
  let day=0;const m=()=>s.customerCompanies?.companies?.telecom?.market;
  while((m()?.requests?.length||0)<3&&day<120){runDays(env,day,day);day++;}
  assert.ok(m().requests.length>=2,'companies ask for business contracts');assert.ok(m().requests.length<=5,'at most five open requests');
  const [first,...rest]=m().requests,single=env.core.execute({state:s},'telecom-decide-request',{id:first.id,decision:'accept'});
  assert.equal(single.status,'مقبول');assert.equal(m().contracts.length,1);assert.equal(m().contracts[0].activeCustomers,first.lines);
  const batch=env.core.execute({state:s},'telecom-decide-requests-batch',{batchId:'TEL-BATCH-1',decisions:rest.map(row=>({id:row.id,decision:'decline'}))});
  assert.equal(batch.declined,rest.length);assert.equal(JSON.stringify(env.core.execute({state:s},'telecom-decide-requests-batch',{batchId:'TEL-BATCH-1',decisions:rest.map(row=>({id:row.id,decision:'decline'}))})),JSON.stringify(batch),'a replayed batch returns its first result');
  assert.equal(m().requests.length,0);
  const contract=m().contracts[0],startDay=day;runDays(env,day,day+62);
  const bills=s.finance.invoices.filter(row=>row.sourceRef.startsWith(`TEL-ENT-INV-${contract.id}-`));
  // Build 377: billed in arrears for what each month earned: the first month from the day it started, then whole months.
  const monthly=contract.activeCustomers*contract.monthlyPrice,start=new Date(Date.UTC(2026,0,1)+startDay*86400000),monthDays=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+1,0)).getUTCDate(),firstMonth=monthly*(monthDays-start.getUTCDate()+1)/monthDays;
  assert.ok(bills.length>=2,'the contract is billed monthly');assert.ok(Math.abs(bills[0].total-firstMonth)<.02,`the first month from its start day: ${bills[0].total} vs ${firstMonth}`);assert.ok(Math.abs(bills[1].total-monthly)<.02,'then a whole month');
  results.contracts={requestsSeen:rest.length+1,firstLines:first.lines,bills:bills.length};
}

// 6. Two identical games give identical numbers; a year of five branches stays small and cheap.
{
  const branches=[['TEL-RUH','الرياض','السعودية'],['TEL-DXB','دبي','الإمارات'],['TEL-CAI','القاهرة','مصر'],['TEL-JED','جدة','السعودية'],['TEL-ALX','الإسكندرية','مصر']];
  const a=setup({branches}),b=setup({branches});
  const started=process.hrtime.bigint();runDays(a,0,364);const elapsedMs=Number(process.hrtime.bigint()-started)/1e6;runDays(b,0,364);
  assert.equal(JSON.stringify(a.s.customerCompanies.companies.telecom.market),JSON.stringify(b.s.customerCompanies.companies.telecom.market),'deterministic');
  const bytes=Buffer.byteLength(JSON.stringify(a.s.customerCompanies.companies.telecom.market));
  assert.ok(bytes<120000,`the saved market stays small: ${bytes} bytes`);
  assert.ok(elapsedMs/365<5,`a day of five branches costs under 5 ms: ${(elapsedMs/365).toFixed(3)} ms`);
  const sum=a.market.summary(a.s);
  results.year={subscribers:sum.subscribers,monthlyRecurring:Math.round(sum.monthlyRecurring),bytes,msPerDay:Number((elapsedMs/365).toFixed(3))};
}

console.log(JSON.stringify({suite:'build374-customer-base-telecom-market',...results}));
console.log('BUILD374_CUSTOMER_BASE_TELECOM_MARKET_PASS');
