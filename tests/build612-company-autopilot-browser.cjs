'use strict';
// Owner («خلاص كل شي يتحول بدقه تلقائي حتا صرف الشيكات وتحصيل الذمم والضرائب»): after each daily close the company
// autopilot (company-autopilot-core.js) takes the decisions the player made by hand, through the same batch commands,
// one step per transaction. In the real app (local DOM, fleet worker), with every service company open and two requests
// of each kind waiting (one the rules accept, one they refuse) and a hotel group offer:
//  1. one day later every request is decided by the rules: the risk whose expected loss is below its premium accepted,
//     the other declined; the tenant at the market rent accepted, the one at 85% declined; the business contract worth
//     more than its network cost accepted, the other declined; the grade-A loan approved, the grade-B loan rejected (the
//     bank's balanced stance); the hotel offer booked; a supplier bill due today (no payment terms) is paid by transfer
//     and a cheque issued for a later day is cashed, an issued invoice due today is collected and the dealership's due
//     VAT is paid; one alert per kind tells the player;
//  2. the outcome is exactly the outcome of the same commands sent by the player (signed, through the buttons' path) after
//     the same daily close: the same requests decided the same way, the same policies, leases, contracts, loans and
//     bookings, the same invoice collected, VAT paid, bill paid and cheque cashed, and every company's current account to
//     the cent;
//  3. a step that fails part-way is rolled back alone (its owner exactly as before, no alert) and recorded, and the other
//     kinds still run; the day still closes;
//  4. with the write audit on, no step writes a root outside the autopilot's declared scope (so a rollback covers it);
//  5. nothing runs twice: the planner has nothing left for the decided requests, and the decisions survive a save and a
//     reload exactly;
//  6. no error is logged.
const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app'),request=require('./helpers/request-decisions-fixture.cjs');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const settle=page=>page.waitForFunction(()=>!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked()&&!__AUDIT__.simulationEngine.snapshot().manualAdvance&&!GH_TRANSACTION_CORE.isStaged(__GH_STATE__),null,{timeout:300000});
const storageOf=page=>page.evaluate(()=>Array.from({length:localStorage.length},(_,i)=>{const key=localStorage.key(i);return [key,localStorage.getItem(key)];}));
// To the next day's boundary (the daily close), then the maintenance queue (the autopilot runs there) until it is empty.
const nextDay=page=>page.evaluate(async()=>{const a=__AUDIT__,s=__GH_STATE__,day=s.lastFinancialDay;window.__GH_MANUAL_CALENDAR_WINDOWS__=false;
  a.simulationEngine.advanceTo((Math.floor(s.simSeconds/86400)+1)*86400,{speed:600,batchSeconds:3600,reason:'qa-612',maxSeconds:3*86400});
  for(let i=0;i<120000&&(a.simulationEngine.snapshot().manualAdvance||GH_TRANSACTION_CORE.isStaged(s));i++)await new Promise(r=>setTimeout(r,2));
  for(let i=0;i<600&&GH_APP_RUNTIME_METRICS.snapshot().maintenance.pending.length;i++)await new Promise(r=>setTimeout(r,10));
  await a.whenStateIdle();return {closed:s.lastFinancialDay-day,pending:GH_APP_RUNTIME_METRICS.snapshot().maintenance.pending};});
// The business outcome: the five owners whole (their requests, histories, decision batches, policies, leases, loans,
// contracts and bookings) and every company's current account to the cent.
const outcome=page=>page.evaluate(()=>{
  const s=__GH_STATE__,F=GH_FINANCE_CORE,ids=window.__B612_IDS__;
  const owners=JSON.parse(JSON.stringify({insurance:s.insurance,realEstate:s.realEstate,bank:s.bank,telecom:s.customerCompanies.companies.telecom,hospitality:s.hospitality}));
  const pending={risks:(s.insurance.riskRequests||[]).map(r=>r.id).filter(id=>ids.includes(id)),tenants:(s.realEstate.tenantRequests||[]).map(r=>r.id).filter(id=>ids.includes(id)),loans:(s.bank.loanRequests||[]).map(r=>r.id).filter(id=>ids.includes(id)),telecom:(s.customerCompanies.companies.telecom.market.requests||[]).map(r=>r.id).filter(id=>ids.includes(id)),hotel:(GH_HOSPITALITY_CORE.read(s,'hospitality').requests||[]).map(r=>r.id).filter(id=>ids.includes(id))};
  const accounts=Object.fromEntries(Object.keys(s.companyFinance||{}).sort().map(c=>[c,Math.round(F.operating(s,c)*100)]));
  const finance={invoice:(s.finance.receivables||[]).some(r=>r.note==='QA 612 invoice'),vat:(s.finance.periods||[]).filter(r=>r.company==='dealership'&&r.status==='مستحق').length,bill:(s.finance.payables||[]).some(r=>r.note==='QA 612 supplier bill'),billInvoice:(s.finance.invoices||[]).find(r=>r.note==='QA 612 supplier bill')?.status||null,cheque:(s.finance.cheques||[]).find(r=>r.note==='QA 612 cheque')?.status||null};
  return {pending,owners,accounts,finance};
});
// Which of each pair the owners took: the insured risk, the lease, the loan contract, the telecom contract, the booking.
const fateOf=page=>page.evaluate(()=>{const s=__GH_STATE__,j=JSON.stringify;return {
  riskOk:(s.insurance.largeRisks||[]).some(r=>r.id==='QA612-RISK-OK'),riskBad:(s.insurance.largeRisks||[]).some(r=>r.id==='QA612-RISK-BAD'),
  reOk:(s.realEstate.projects||[]).some(p=>(p.leases||[]).some(l=>l.id==='QA612-RE-OK')),reLow:(s.realEstate.projects||[]).some(p=>(p.leases||[]).some(l=>l.id==='QA612-RE-LOW')),
  telOk:(s.customerCompanies.companies.telecom.market.contracts||[]).some(c=>c.requestId==='QA612-TEL-OK'),telBad:(s.customerCompanies.companies.telecom.market.contracts||[]).some(c=>c.requestId==='QA612-TEL-BAD'),
  loanA:(s.bank.customerLoanContracts||[]).some(c=>c.customerName==='QA 612 borrower A'),loanB:(s.bank.customerLoanContracts||[]).some(c=>c.customerName==='QA 612 borrower B'),
  hotel:(GH_HOSPITALITY_CORE.read(s,'hospitality').bookings||[]).filter(b=>b.customerName==='QA 612 group').length};});
async function seed(page){
  await request.prepare(page,{rows:40});
  return page.evaluate(async()=>{
    const a=__AUDIT__,s=__GH_STATE__,day=Math.floor(s.simSeconds/86400),H=GH_HOSPITALITY_CORE;
    // A real tenant project (its office first) and a running hotel.
    const cap=GH_MOBILITY_CORE.capitalMeta('RUH');
    await a.runAuthorizedDomainCommand('facilities','create',{facility:{id:'QA612-RE-OFFICE',ownerCompanyId:'realestate',company:'realestate',kind:'realestate',owned:true,capitalId:'RUH',sourceKey:'site:realestate:RUH',city:cap.city,country:cap.country,coords:[...cap.coords],name:'QA 612 Real Estate',dailyCost:0},bucket:'customHubs'},{silent:true});
    const office=GH_REALESTATE_CORE.ensure(s).offices[0].id,project=(await a.runAuthorizedDomainCommand('realestate','start-project',{officeId:office,type:'residential',size:1,priceLevel:1,mode:'lease'},{silent:true})).result;
    const q=H.buildQuote(s,'hospitality',{kind:'hotel',capitalId:'RUH'});await a.runAuthorizedDomainCommand('hospitality','start-property',{companyId:'hospitality',kind:'hotel',capitalId:'RUH',expectedCost:q.cost},{silent:true});
    const propertyId=H.read(s,'hospitality').properties[0].id,accel=H.accelerationQuote(s,'hospitality',propertyId);
    await a.runAuthorizedDomainCommand('hospitality','accelerate-construction',{companyId:'hospitality',propertyId,expectedFee:accel.fee,expectedCompleteDay:accel.completeDay},{silent:true});
    await a.runAuthorizedDomainCommand('hospitality','hire-property',{companyId:'hospitality',propertyId},{silent:true});
    // A supplier bill due today (no payment terms) and a cheque issued for a later day: the autopilot pays the bill by
    // transfer and cashes the cheque (the airline's funds cover both).
    const today=Math.floor(s.simSeconds/86400)+1;
    const bill=(await a.runAuthorizedDomainCommand('finance','accrue-expense',{company:'air',amount:25000,note:'QA 612 supplier bill',dueDay:today},{silent:true})).result;
    const cheque=(await a.runAuthorizedDomainCommand('finance','issue-cheque',{company:'air',amount:15000,beneficiary:'QA 612 Supplier',note:'QA 612 cheque',dueDay:today+20},{silent:true})).result;
    // An issued invoice due today (collected by its incoming cheque) and the dealership's due VAT (paid in full).
    const invoice=(await a.runAuthorizedDomainCommand('finance','issue-invoice',{company:'air',kind:'دخل',amount:40000,note:'QA 612 invoice',counterparty:'QA 612 Customer',dueDay:today,taxable:false},{silent:true})).result;
    await a.runAuthorizedDomainCommand('finance','credit',{company:'dealership',amount:1150000,note:'QA 612 taxable sale',taxable:true},{silent:true});
    await a.runAuthorizedDomainCommand('finance','close-vat-period',{day:today-1},{silent:true});
    window.__B612_FINANCE__={bill:bill.number,cheque:cheque.id,invoice:invoice.number};
    await a.whenStateIdle();await GH_PERSISTENCE.drain();return {project:project.id,propertyId,bill:bill.number,cheque:cheque.id};
  });
}
// Two requests of each kind (the rules accept the first and refuse the second) and a hotel offer, written as the owners'
// generators write them, in each page after it loads (the same rows every time).
function requests(page){
  return page.evaluate(()=>{
    const s=__GH_STATE__,day=Math.floor(s.simSeconds/86400),H=GH_HOSPITALITY_CORE,project=s.realEstate.projects[0],propertyId=H.read(s,'hospitality').properties[0].id;
    const ins=GH_INSURANCE_CORE.ensure(s),office0=ins.offices?.[0]?.id||'QA',telecom=GH_TELECOM_MARKET.ensure(s),branch=telecom.branches[0];
    s.insurance.riskRequests=[{id:'QA612-RISK-OK',day,expiresDay:day+7,subject:'QA 612 risk ok',officeId:office0,grade:'A',sumInsured:1000000,premium:10000,expectedLoss:1000,status:'بانتظار القرار'},{id:'QA612-RISK-BAD',day,expiresDay:day+7,subject:'QA 612 risk bad',officeId:office0,grade:'C',sumInsured:1000000,premium:10000,expectedLoss:20000,status:'بانتظار القرار'}];
    s.realEstate.tenantRequests=[{id:'QA612-RE-OK',day,expiresDay:day+10,tenant:'QA 612 tenant ok',projectId:project.id,projectName:project.name,units:2,rentLevel:1,annualRent:200000,years:3,status:'بانتظار القرار'},{id:'QA612-RE-LOW',day,expiresDay:day+10,tenant:'QA 612 tenant low',projectId:project.id,projectName:project.name,units:2,rentLevel:.85,annualRent:170000,years:3,status:'بانتظار القرار'}];
    s.bank.riskPolicy={...(s.bank.riskPolicy||{}),preset:'balanced'};
    s.bank.loanRequests=[{id:'QA612-LOAN-A',day,expiresDay:day+7,borrower:'QA 612 borrower A',sector:'consumer',product:'consumer',amount:500000,termDays:365,riskGrade:'A',collateralCoverage:1,branchId:'QA-DEC-BR'},{id:'QA612-LOAN-B',day,expiresDay:day+7,borrower:'QA 612 borrower B',sector:'consumer',product:'consumer',amount:500000,termDays:365,riskGrade:'B',collateralCoverage:.5,branchId:'QA-DEC-BR'}];
    telecom.requests=[{id:'QA612-TEL-OK',day,expiresDay:day+7,branchRowId:branch.id,customerName:'QA 612 Enterprise ok',industry:'خدمات',country:branch.country,lines:100,monthlyPrice:420,monthlyValue:42000,networkCost:14000,months:12,status:'بانتظار القرار'},{id:'QA612-TEL-BAD',day,expiresDay:day+7,branchRowId:branch.id,customerName:'QA 612 Enterprise bad',industry:'خدمات',country:branch.country,lines:100,monthlyPrice:420,monthlyValue:42000,networkCost:50000,months:12,status:'بانتظار القرار'}];
    const root=H.read(s,'hospitality'),terms={propertyId,startDay:day+9,endDay:day+12,roomClass:0,rooms:2},quote=H.bookingQuote(s,'hospitality',terms);
    root.requests=[{id:'QA612-HOTEL',...terms,customerName:'QA 612 group',quotedGross:quote.gross,expiresDay:day+6,createdDay:day}];
    window.__B612_IDS__=['QA612-RISK-OK','QA612-RISK-BAD','QA612-RE-OK','QA612-RE-LOW','QA612-LOAN-A','QA612-LOAN-B','QA612-TEL-OK','QA612-TEL-BAD','QA612-HOTEL'];
    return window.__B612_IDS__.length;
  });
}
(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    const setup=await boot({browser,errors,root:ROOT,fleetWorker:true});setup.page.setDefaultTimeout(300000);
    await seed(setup.page);await settle(setup.page);const storage=await storageOf(setup.page);await setup.page.close();
    const ids=['QA612-RISK-OK','QA612-RISK-BAD','QA612-RE-OK','QA612-RE-LOW','QA612-LOAN-A','QA612-LOAN-B','QA612-TEL-OK','QA612-TEL-BAD','QA612-HOTEL'];
    const open=async({audit=false,manual=false,beforeApp=null}={})=>{const env=await boot({browser,errors,root:ROOT,storage,fleetWorker:true,beforeApp:async page=>{await page.evaluate(({manual,audit})=>{if(audit)globalThis.__GH_BUILD339_WRITE_AUDIT__=true;if(manual){window.__B612_PLANNER__=window.GH_COMPANY_AUTOPILOT;delete window.GH_COMPANY_AUTOPILOT;}},{manual,audit});if(beforeApp)await beforeApp(page);}});env.page.setDefaultTimeout(300000);await settle(env.page);assert.equal(await requests(env.page),ids.length);return env.page;};
    // 1 and 4: the autopilot, write audit on.
    const auto=await open({audit:true});
    const day=await nextDay(auto);assert.equal(day.closed,1,'1: the day closed');assert.deepEqual(day.pending,[],'1: the maintenance queue drained');
    const A=await outcome(auto);
    assert.deepEqual(A.pending,{risks:[],tenants:[],loans:[],telecom:[],hotel:[]},`1: every seeded request is decided (${JSON.stringify(A.pending)})`);
    const run=await auto.evaluate(()=>({metric:GH_APP_RUNTIME_METRICS.snapshot().maintenance.autopilot,skipped:(__GH_STATE__.diagnostics?.events||[]).filter(e=>e.type==='COMPANY_AUTOPILOT_STEP_SKIPPED'),alerts:(__GH_STATE__.alerts||[]).map(x=>String(x.text||x)).filter(x=>/^(قرار آلي|تحصيل آلي|سداد آلي|صرف آلي|إعادة تقديم آلية)/.test(x))}));
    assert.deepEqual(run.skipped,[],`4: no step failed under the write audit (${JSON.stringify(run.skipped).slice(0,600)})`);assert.ok(run.metric.steps>=9,`1: the five decision kinds and the four finance kinds ran (${JSON.stringify(run.metric)})`);
    for(const pattern of [/^قرار آلي للتأمين \(المخاطر التجارية\): مقبول 1 · معتذر عنه 1\.$/,/^قرار آلي للعقار \(طلبات الإيجار\): مقبول 1 · معتذر عنه 1\.$/,/^قرار آلي للاتصالات \(عقود الأعمال\): مقبول 1 · معتذر عنه 1\.$/,/^قرار آلي للبنك \(طلبات القروض\): موافق عليه 1 · مرفوض 1\.$/,/^قرار آلي للضيافة \(عروض الإقامة\): مقبول 1\.$/])assert.ok(run.alerts.some(x=>pattern.test(x)),`1: alert ${pattern} (${JSON.stringify(run.alerts)})`);
    assert.deepEqual(A.finance,{invoice:false,vat:0,bill:false,billInvoice:'مسددة',cheque:'مصروف'},`1: the due bill is paid by transfer and the issued cheque cashed (${JSON.stringify(A.finance)})`);
    for(const pattern of [/^تحصيل آلي لـ .+: ذمم مدينة 1 بقيمة /,/^سداد آلي لضريبة /,/^سداد آلي بتحويل بنكي: ذمم دائنة 1 بقيمة /,/^صرف آلي: شيك واحد بقيمة /])assert.ok(run.alerts.some(x=>pattern.test(x)),`1: alert ${pattern} (${JSON.stringify(run.alerts)})`);
    const fate=await fateOf(auto);
    assert.deepEqual(fate,{riskOk:true,riskBad:false,reOk:true,reLow:false,telOk:true,telBad:false,loanA:true,loanB:false,hotel:1},'1: the rules took the profitable risk, the market-rent tenant, the profitable contract, the grade-A loan and the hotel group, and refused the rest');
    // 5. Nothing left for the planner, and a save and reload keep it all.
    const left=await auto.evaluate(()=>{const P=GH_COMPANY_AUTOPILOT,s=__GH_STATE__;return ['insurance','realestate','telecom','bank','hospitality'].map(kind=>{const step=P.next(s,kind,{tried:new Set()});return step?step.keys.filter(key=>window.__B612_IDS__.some(id=>key.endsWith(id))):[];}).flat();});
    assert.deepEqual(left,[],'5: no decided request is planned again');
    assert.equal(await auto.evaluate(async()=>{const ok=await __AUDIT__.saveNow();await GH_PERSISTENCE.drain();return ok;}),true,'5: the game saves');const saved=await storageOf(auto);await auto.close();
    const reload=await boot({browser,errors,root:ROOT,storage:saved,fleetWorker:true});reload.page.setDefaultTimeout(300000);await settle(reload.page);await reload.page.evaluate(ids=>{window.__B612_IDS__=ids;},ids);
    assert.deepEqual(await outcome(reload.page),A,'5: the decisions survive a save and a reload exactly');await reload.page.close();
    // 2. The player's path: the same day closes without the autopilot, then the same commands, signed.
    const manual=await open({manual:true});
    assert.equal((await nextDay(manual)).closed,1);
    const sent=await manual.evaluate(async()=>{const P=window.__B612_PLANNER__,s=__GH_STATE__,tried=new Set(),out=[];
      for(const kind of P.KINDS){const step=P.next(s,kind,{tried,F:GH_FINANCE_CORE});if(!step)continue;for(const key of step.keys)tried.add(key);for(const c of step.commands){const r=await __AUDIT__.runAuthorizedDomainCommand(c.domain,c.name,c.payload,{silent:true});out.push([kind,r.result?.accepted??r.result?.approved,r.result?.declined??r.result?.rejected]);}}
      await __AUDIT__.whenStateIdle();return out;});
    assert.equal(sent.length,9,`2: the player sends the five batches, the collection, the VAT, the bill and the cheque (${JSON.stringify(sent)})`);
    const M=await outcome(manual);
    assert.deepEqual(M,A,'2: the autopilot leaves exactly what the player\'s signed commands leave');await manual.close();
    // 3. A step that fails part-way: the insurance batch, then a command its owner refuses.
    const failing=await open({beforeApp:async page=>page.evaluate(()=>{const P=window.GH_COMPANY_AUTOPILOT;window.GH_COMPANY_AUTOPILOT=Object.freeze({...P,next(s,kind,o){const step=P.next(s,kind,o);return step&&kind==='insurance'?{...step,commands:[...step.commands,{domain:'insurance',name:'qa-612-no-such-command',payload:{}}]}:step;}});})});
    const before=await failing.evaluate(()=>JSON.stringify(__GH_STATE__.insurance));
    assert.equal((await nextDay(failing)).closed,1,'3: the day still closes');
    const failed=await failing.evaluate(()=>({insurance:JSON.stringify(__GH_STATE__.insurance),metric:GH_APP_RUNTIME_METRICS.snapshot().maintenance.autopilot,skipped:(__GH_STATE__.diagnostics?.events||[]).filter(e=>e.type==='COMPANY_AUTOPILOT_STEP_SKIPPED').map(e=>e.detail?.kind||e.data?.kind||e.kind),alerts:(__GH_STATE__.alerts||[]).map(x=>String(x.text||x)).filter(x=>/^قرار آلي للتأمين/.test(x)).length,others:{loans:(__GH_STATE__.bank.loanRequests||[]).filter(r=>String(r.id).startsWith('QA612-')).length,hotel:(GH_HOSPITALITY_CORE.read(__GH_STATE__,'hospitality').requests||[]).filter(r=>String(r.id).startsWith('QA612-')).length}}));
    const daily=JSON.parse(failed.insurance),start=JSON.parse(before);
    assert.deepEqual(daily.riskRequests.map(r=>r.id).filter(id=>id.startsWith('QA612-')),start.riskRequests.map(r=>r.id),'3: the failed step decided nothing');
    assert.equal(failed.alerts,0,'3: and left no alert');assert.ok(failed.metric.failed>=1&&failed.skipped.includes('insurance'),`3: the failure is recorded (${JSON.stringify(failed.skipped)})`);
    assert.deepEqual(failed.others,{loans:0,hotel:0},'3: the other kinds still ran');
    // The rolled-back step left the insurance owner exactly as the day's close left it (the same close without it).
    const control=await open({beforeApp:async page=>page.evaluate(()=>{const P=window.GH_COMPANY_AUTOPILOT;window.GH_COMPANY_AUTOPILOT=Object.freeze({...P,next(s,kind,o){return kind==='insurance'?null:P.next(s,kind,o);}});})});
    await nextDay(control);const controlInsurance=await control.evaluate(()=>JSON.stringify(__GH_STATE__.insurance));
    assert.equal(failed.insurance,controlInsurance,'3: the insurance owner is exactly as a day without that step leaves it');await control.close();await failing.close();
    // 6.
    assert.deepEqual(errors,[],'6: no error');
    console.log(JSON.stringify({suite:'build612-company-autopilot-browser',ok:true,steps:run.metric.steps,alerts:run.alerts.length,sent:sent.length}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
