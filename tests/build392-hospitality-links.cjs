'use strict';
const assert=require('node:assert/strict');
const {hospitalityFixture}=require('./helpers/hospitality-fixture.cjs');
const results=[];
function test(name,run){run();results.push(name);}
function openOther(q,type){const capital=q.s.GH_COMPANY_PLATFORM.getDefinition(type).founding.defaultCapital;q.F.execute({state:q.state},'founder-investment',{company:'group',amount:capital,ref:'HOSP-QA-FUND-'+type});q.s.GH_DOMAIN_COMMANDS.dispatch({state:q.state},'corporate','open-company',{type,capital});}
function facility(q,type,kind){const cap=q.s.GH_MOBILITY_CORE.capitalMeta('RUH');q.s.GH_FACILITY_CORE.execute({state:q.state},'create',{facility:{id:'HOSP-QA-'+type,name:'QA '+type,kind,ownerCompanyId:type,company:type,owned:true,capitalId:'RUH',sourceKey:`site:${type}:RUH`,city:cap.city,country:cap.country,coords:[...cap.coords],dailyCost:0}});}
test('staff uses hospitality profile, leases cannot be fabricated from an office, and occupied sites cannot close',()=>{
 const q=hospitalityFixture(),p=q.property();q.state.advanced.facilities[p.id].staff=0;q.command('hire-property',{propertyId:p.id});assert.equal(q.state.advanced.facilities[p.id].staff,60);
 const contracts=q.state.advanced.labor?.employmentContracts||[];assert(contracts.some(r=>r.facilityId===p.id&&r.salary===1800));
 const terms={propertyId:p.id,startDay:7,endDay:9,rooms:2,roomClass:0},bq=q.H.bookingQuote(q.state,'hospitality',terms);q.command('reserve-group',{...terms,customerName:'جهة اختبار',expectedGross:bq.gross});
 assert.throws(()=>q.command('close-property',{propertyId:p.id}),/has-bookings/);assert.throws(()=>q.H.leaseQuote(q.state,'hospitality','missing'),/company-not|company.*registered|company.*operational/);
});
test('external service accrues without daily invoices and settles with one supplier bill on the 15th',()=>{
 const q=hospitalityFixture(),p=q.property(),L=q.s.GH_HOSPITALITY_LINKS,quote=L.quote(q.state,'hospitality',p.id,'telecom','external');
 q.command('sign-service',{propertyId:p.id,kind:'telecom',providerCompanyId:'external',expectedDailyNet:quote.dailyNet});q.advance(13);
 assert.equal(q.state.finance.invoices.filter(r=>r.sourceRef?.startsWith('HOSP-SERVICE-SETTLE')).length,0);
 const earned=q.H.read(q.state).history[0];assert(earned.serviceExpense>0);q.tick(14);
 const bills=q.state.finance.invoices.filter(r=>r.sourceRef?.startsWith('HOSP-SERVICE-SETTLE'));assert.equal(bills.length,1);assert.equal(bills[0].status,'مسددة');
 const accounts=Object.values(q.H.read(q.state).accounting.serviceAccounts);assert(accounts.every(a=>a.settled));const cash=q.F.operating(q.state,'hospitality');q.command('settle-due');assert.equal(q.F.operating(q.state,'hospitality'),cash);
});
test('internal insurance service has paired daily books, paired monthly cash and no duplicate cash in economics',()=>{
 const q=hospitalityFixture(),p=q.property();openOther(q,'insurance');facility(q,'insurance','insurance');
 const L=q.s.GH_HOSPITALITY_LINKS,quote=L.quote(q.state,'hospitality',p.id,'insurance','insurance');q.command('sign-service',{propertyId:p.id,kind:'insurance',providerCompanyId:'insurance',expectedDailyNet:quote.dailyNet});
 const before=q.F.operating(q.state,'insurance');q.advance(13);assert.equal(q.F.operating(q.state,'insurance'),before);
 const eco=q.s.GH_ECONOMICS_CORE.sectorEconomics(q.state,{day:13,preferDailyReport:true}).detail;assert(eco.companyRevenue.insurance>0);assert.equal(eco.companyCashRevenue.insurance,0);
 q.tick(14);assert.equal(Math.round((q.F.operating(q.state,'insurance')-before)*100),quote.dailyNet*15);
 const transfers=q.state.finance.transfers.filter(r=>r.kind==='intercompany-service'&&r.fromCompany==='hospitality'&&r.toCompany==='insurance');assert.equal(transfers.length,1);
 assert(transfers[0].expenseDocumentNumber&&transfers[0].incomeDocumentNumber);
});
test('a provider must cover the property country and unpayable services pause without losing the payable',()=>{
 const q=hospitalityFixture(),p=q.property();openOther(q,'telecom');const L=q.s.GH_HOSPITALITY_LINKS;
 assert.throws(()=>L.quote(q.state,'hospitality',p.id,'telecom','telecom'),/local-coverage/);
 const quote=L.quote(q.state,'hospitality',p.id,'telecom','external');q.command('sign-service',{propertyId:p.id,kind:'telecom',providerCompanyId:'external',expectedDailyNet:quote.dailyNet});
 q.advance(13);q.state.companyFinance.hospitality.accounts[0].balance=0;
 // No lodging receipts are collectible in this controlled case: isolate the supplier arrears.
 for(const b of Object.values(q.H.read(q.state).accounting.buckets))b.dueDay=45;
 q.tick(14);const account=Object.values(q.H.read(q.state).accounting.serviceAccounts)[0];assert(!account.settled&&account.invoiceNumber);q.tick(15);
 assert.equal(q.H.read(q.state).properties[0].services[0].status,'paused');assert(q.state.finance.payables.some(r=>r.number===account.invoiceNumber));
 q.F.book(q.state,'hospitality').accounts[0].balance=1000000;q.command('settle-due');assert.equal(q.H.read(q.state).properties[0].services[0].status,'active','paying the overdue service restores its remaining term without a new contract');
});
test('financing is principal, is bound to the quoted rate and cannot be issued twice',()=>{
 const q=hospitalityFixture(),p=q.property(),before=q.F.operating(q.state,'hospitality'),share=.4,expectedAmount=Math.round(p.constructionCost*share),expectedRate=q.F.fixedDebtQuote(q.state,5*365);
 assert.throws(()=>q.command('finance-property',{propertyId:p.id,share,expectedAmount,expectedRate:expectedRate+.001}),/quote-changed/);
 const out=q.command('finance-property',{propertyId:p.id,share,expectedAmount,expectedRate});assert.equal(q.F.operating(q.state,'hospitality'),before+expectedAmount);assert(q.state.finance.debtRecords.some(r=>r.id===out.ref&&r.annualRate===expectedRate));
 const cash=q.F.operating(q.state,'hospitality');q.command('finance-property',{propertyId:p.id,share,expectedAmount,expectedRate});assert.equal(q.F.operating(q.state,'hospitality'),cash);assert.equal(q.H.read(q.state).totals.net,0);
});
test('real estate retains hotel ownership and the hotel operator rents one real building',()=>{
 const q=hospitalityFixture();openOther(q,'realestate');facility(q,'realestate','realestate');const R=q.s.GH_REALESTATE_CORE,re=R.ensure(q.state),cap=q.s.GH_MOBILITY_CORE.capitalMeta('RUH');
 re.projects.push({id:'HOSP-QA-LEASE-BUILDING',officeId:re.offices[0].id,city:cap.city,country:cap.country,type:'hotel',name:'مبنى فندقي للاختبار',mode:'lease',units:1,unitCost:25000000,localFactor:1,landCost:4500000,buildCost:20500000,status:'مكتمل',startDay:0,completeDay:0,sold:0,presold:0,leased:0,handedOver:0,salesRevenue:0,rentRevenue:0,leases:[],cheques:[]});
 const quote=q.H.leaseQuote(q.state,'hospitality','HOSP-QA-LEASE-BUILDING'),out=q.command('lease-property',{projectId:quote.leaseProjectId,expectedCost:quote.cost}),p=q.H.read(q.state).properties.find(r=>r.id===out.propertyId);
 assert.equal(p.ownership,'leased');assert.equal(p.status,'operating');assert.equal(re.projects[0].leased,1);assert.equal(re.projects[0].leases[0].tenantCompanyId,'hospitality');
 assert.throws(()=>q.H.leaseQuote(q.state,'hospitality','HOSP-QA-LEASE-BUILDING'),/unavailable/);assert.throws(()=>q.command('expand-property',{propertyId:p.id,expectedCost:200000}),/leased-building/);
 q.state.simSeconds=86400;R.tickDay(q.state,{day:1});assert(R.dailyResult(q.state,1).internalRentRows.some(r=>r.companyId==='hospitality'));
 q.advance(1);const rent=R.dailyResult(q.state,1).internalRentRows.find(r=>r.companyId==='hospitality').amount,own=q.H.dailyResult(q.state,1),economics=q.s.GH_ECONOMICS_CORE.sectorEconomics(q.state,{day:1,preferDailyReport:true}).detail;assert(Math.abs(economics.companyExpense.hospitality-own.expense-rent)<.005,'tenant daily profit must include rent as well as hospitality costs');assert.equal(economics.companyCashExpense.hospitality,own.cashExpense,'the paired rent settlement owns its cash');
 const end=p.leaseEndDay;q.state.simSeconds=(end-3)*86400;assert.throws(()=>q.H.bookingQuote(q.state,'hospitality',{propertyId:p.id,startDay:end-2,endDay:end+1,rooms:1}),/terms-invalid/);const root=q.H.read(q.state);root.lastProcessedDay=end-1;root.accounting.lastAccruedDay=end-1;q.tick(end);assert.equal(q.H.read(q.state).properties[0].status,'closed');assert(!q.state.customHubs.some(f=>f.id===p.id));assert(q.H.validateState(q.state).ok);
});
console.log(JSON.stringify({suite:'build392-hospitality-links',passed:results.length,results}));
