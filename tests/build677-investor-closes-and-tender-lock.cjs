'use strict';
// Build 677, from the review of build 673 (the investor licence: «لا يُرفض شراء أو راتب أو تحويل أو شيك لنقص السيولة»; a
// lost tender is closed for thirty game days). The review found closes that still deferred for lack of cash with the
// licence on, and reverts of build 673's own edits that its gate did not notice. Each case runs twice with the same
// world and the company's cash taken away: without the licence it defers as it always did (the control), with it the
// card pays.
//   I1. a real-estate project's milestones of the daily close;
//   I2. a fleet claim paid by the group's own insurer;
//   I3. a hotel's monthly bill for a service bought from a company of the group;
//   I4. a financed plant: the interest on its day, and the instalment on the next, the cash drained before each;
//   I5. a company's facility from the group's bank: principal and interest of the bank's day (deferred until this build);
//   I7. electricity bought from the group's power company: the monthly settlement (carried over until this build);
//   T.  tenders: a second lost tender does not free the first; a tender lost in the last second of a day reopens at the
//       first second of its thirtieth day after; a tender whose contract has ended is not bid on again (it was);
//   C.  the card's charge at 5M and 15M short (30M and 40M: the shortfall and 25M, up to the next 10M).
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||require('node:path').resolve(__dirname,'..');
const assert=require('node:assert/strict');
const {scenario}=require('./helpers/business-scenario'),{harness,minimal}=require('./helpers/core-harness'),{hospitalityFixture}=require('./helpers/hospitality-fixture.cjs');
const DAY=86400,cents=v=>Math.round(Number(v)*100)/100,refusal=run=>{try{run();return null;}catch(error){return String(error?.message||error);}};
const want=()=>true,out={};
const investor=state=>{state.godMoney=true;state.infiniteMoney=true;};

// I1. Real estate: the milestones of the daily close, the company's cash drained before each day.
if(want('I1')){const run=mode=>{const {s}=harness(['capability-registry-core','company-definitions','company-platform-core','identity-system','control-plane-core','authorization-core','determinism-core','integrity-core','document-proof-core','transaction-core','domain-command-core','finance-core','facility-core','realestate-core','economics-core','save-schema']),RE=s.GH_REALESTATE_CORE,opened=['bank','realestate'];
    const companyRegistry=Object.fromEntries(opened.map(id=>{const definition=s.GH_COMPANY_DEFINITIONS.get(id);return [id,{id,definitionId:definition.definitionId,definitionVersion:definition.definitionVersion,status:'active'}];}));
    const state={...minimal(),profile:{name:'Review'},companyRegistry,openedCompanies:opened,branches:[],customHubs:[{id:'RE-RUH',kind:'realestate',ownerCompanyId:'realestate',owned:true,city:'الرياض',country:'السعودية'}],realEstate:{},advanced:{}},F=s.GH_FINANCE_CORE;
    F.ensure(state);F.book(state,'realestate').accounts[0].balance=900000000;F.reconcile(state);const re=RE.ensure(state);state.simSeconds=0;
    const started=RE.execute({state},'start-project',{officeId:re.offices[0].id,type:'residential',size:1,priceLevel:1,mode:'sale'});if(mode)investor(state);
    let min=Infinity,error=null,project=null,days=0;
    for(let day=1;day<=900;day++){state.simSeconds=day*DAY;const account=F.book(state,'realestate').accounts[0];account.balance=Math.min(account.balance,500);F.reconcile(state);
      try{RE.tickDay(state,{day});}catch(caught){error=String(caught?.message||caught);break;}
      min=Math.min(min,F.operating(state,'realestate'));project=re.projects.find(row=>row.id===started.id);days=day;if(project.milestonesPaid>=3)break;}
    return {error,days,milestonesPaid:project?.milestonesPaid,waitingDays:project?.waitingDays||0,cheques:(project?.cheques||[]).length,minBalance:cents(min),buildCost:project?.buildCost,card:cents(F.investorCardReturnPlan(state).charged),valid:s.GH_SAVE_SCHEMA.validate(state).ok};};
  const safe=m=>run(m);out.I1={control:safe(false),investor:safe(true)};}

// I2. Realism: a fleet claim paid by the group's own insurer, the insurer's cash drained.
if(want('I2')){const run=mode=>{const env=scenario(),{s,state,command}=env;env.load('insurance-core');const F=s.GH_FINANCE_CORE;
    command('corporate','open-company',{type:'insurance',capital:60000000,legalName:'شركة اختبار التأمين'});
    state.advanced.insurance=state.advanced.insurance||{};state.advanced.insurance.claims=state.advanced.insurance.claims||[];state.advanced.insurance.fleetPolicies=state.advanced.insurance.fleetPolicies||[];
    state.advanced.insurance.fleetPolicies.unshift({id:'POLICY-QA',day:0,company:'air',insurerCompanyId:'insurance',cover:'standard',assetCount:10,insuredValue:1e8,premium:0,status:'سارية',transferReference:'POLICY-PREMIUM-QA'});
    state.advanced.insurance.claims.unshift({id:'CLM-AIR-QA',company:'air',ownerCompanyId:'air',insurerCompanyId:'insurance',policyReference:'POLICY-QA',openedAt:30*DAY,status:'قيد الفحص',loss:1000000,deductible:100000,covered:900000,reserve:900000,incidents:1});
    command('finance','transfer',{from:'insurance',to:'group',amount:cents(F.operating(state,'insurance')-100),note:'cash to the holding'});if(mode)investor(state);
    state.simSeconds=33*DAY;const airBefore=F.operating(state,'air');const error=refusal(()=>s.GH_REALISM.onDay(state,33));const claim=state.advanced.insurance.claims.find(row=>row.id==='CLM-AIR-QA');
    return {error,status:claim.status,paid:claim.paid||0,airGot:cents(F.operating(state,'air')-airBefore),insurer:cents(F.operating(state,'insurance')),card:cents(F.investorCardReturnPlan(state).charged)};};
  const safe=m=>run(m);out.I2={control:safe(false),investor:safe(true)};}

// I3. Hospitality: the monthly cash of a service bought from a company of the group, the hotel's cash drained.
if(want('I3')){const run=mode=>{const q=hospitalityFixture(),{s,state,F,H:HC}=q;
    const capital=s.GH_COMPANY_PLATFORM.getDefinition('insurance').founding.defaultCapital;F.execute({state},'founder-investment',{company:'group',amount:capital,ref:'QA-FUND-insurance'});s.GH_DOMAIN_COMMANDS.dispatch({state},'corporate','open-company',{type:'insurance',capital});
    const cap=s.GH_MOBILITY_CORE.capitalMeta('RUH');s.GH_FACILITY_CORE.execute({state},'create',{facility:{id:'QA-insurance',name:'QA insurance',kind:'insurance',ownerCompanyId:'insurance',company:'insurance',owned:true,capitalId:'RUH',sourceKey:'site:insurance:RUH',city:cap.city,country:cap.country,coords:[...cap.coords],dailyCost:0}});
    const p=q.property();state.advanced.facilities[p.id].staff=0;const L=s.GH_HOSPITALITY_LINKS,quote=L.quote(state,'hospitality',p.id,'insurance','insurance');q.command('sign-service',{propertyId:p.id,kind:'insurance',providerCompanyId:'insurance',expectedDailyNet:quote.dailyNet});
    q.advance(13);const cash=F.operating(state,'hospitality');if(cash>0)s.GH_DOMAIN_COMMANDS.dispatch({state},'finance','transfer',{from:'hospitality',to:'group',amount:cents(cash),note:'cash to the holding'});if(mode)investor(state);
    const before=F.operating(state,'insurance');const error=refusal(()=>q.tick(14));const accounts=Object.values(HC.read(state,'hospitality').accounting.serviceAccounts||{});
    return {error,accounts:accounts.length,settled:accounts.map(a=>a.settled===true),insurerGot:cents(F.operating(state,'insurance')-before),hotel:cents(F.operating(state,'hospitality')),card:cents(F.investorCardReturnPlan(state).charged)};};
  const safe=m=>run(m);out.I3={control:safe(false),investor:safe(true)};}

// I4. Energy: the interest and the instalment each on its own day, the plant's cash drained before each close.
if(want('I4')){const MODULES=['capability-registry-core','company-definitions','company-platform-core','identity-system','control-plane-core','authorization-core','document-proof-core','transaction-core','domain-command-core','save-schema','determinism-core','event-ledger-core','dependency-core','policy-core','lifecycle-core','delivery-monitor-core','realism-core','finance-core','branch-campaign-core','hr-core','corporate-core','facility-core','business-world-core','banking-core','insurance-core','energy-core','realestate-core','economics-core','game-lifecycle-core','company-adapters-core','company-autopilot-core','strategy-core','conference-core','operations-core','advanced-core'];
  const run=mode=>{const {s}=harness(MODULES),data={...minimal(),profile:{name:'Plant'},bank:{},operations:{},crew:[],branches:[],hired:[],unlockedSectors:[],ownedCompanies:[]},state=s.GH_GAME_LIFECYCLE.pristine(data,1);
    s.GH_GAME_LIFECYCLE.foundGroup(state,{mode:'sandbox',name:'Plant Group',founder:'Founder',locationId:'RUH'},data,{nextId:()=>'FOUND-PI',simYear:()=>2026});s.GH_ADVANCED.migrate(state);
    const D=s.GH_DOMAIN_COMMANDS,F=s.GH_FINANCE_CORE,TX=s.GH_TRANSACTION_CORE,player=(domain,name,payload)=>D.dispatch({state},domain,name,payload).result;
    player('corporate','open-company',{type:'power',capital:400000000,legalName:'Plant Power'});
    state.customHubs.push({id:'PWR-GAS-PI',name:'Gas PI',city:'الرياض',country:'السعودية',kind:'power',company:'power',ownerCompanyId:'power',owned:true,energyKind:'gas',capacityAmount:100,capacity:'100 MW',commissioned:true,openedAt:0,dailyCost:38000,cost:200000000});
    state.simSeconds=100*DAY;s.GH_REALISM.migrate(state).economy.gas=50;s.GH_REALISM.migrate(state).economy.baseRate=.05;state.profile.creditRating='BBB';
    const site=s.GH_ENERGY_CORE.ensure(state).sites.find(row=>row.facilityId==='PWR-GAS-PI');site.commissionedDay=0;const financed=player('energy','finance-project',{siteId:site.id,amount:100000000}),facility=()=>state.energy.projectFinance.find(row=>row.id===financed.id);
    const close=day=>{const res=TX.execute(state,{label:`day-close:${day}`,apply(){state.simSeconds=day*DAY;const stages=s.GH_ADVANCED.onFinancialDayStages(state,day);let step;while(!(step=stages.next()).done){}return step.value;}});if(res.committed!==true)throw new Error(`day ${day}: ${res.reason}`);};
    const due=Number(facility().nextInterestDueDay);for(let day=101;day<due;day++)close(day);
    const drain=()=>{const amount=cents(F.operating(state,'power')-100);if(amount>=1)player('finance','transfer',{from:'power',to:'group',amount,note:'cash to the holding'});};
    drain();if(mode)investor(state);close(due);
    const afterInterestDay={status:facility().status,arrears:cents(facility().principalArrears),open:facility().interestInvoiceNumber,invoices:Array.from(state.finance.invoices).filter(row=>String(row.number).startsWith('PFINT-')).map(row=>row.status)};
    const purposes=()=>Array.from(new Set((state.finance.investorCard?.rows||[]).flatMap(row=>row.purposes||[])));const p1=purposes();
    // The next day carries an instalment and no interest: the cash is drained again, so no margin of the card is left.
    const chargedBefore=cents(F.investorCardReturnPlan(state).charged);if(!mode){}state.godMoney=false;state.infiniteMoney=false;drain();if(mode)investor(state);close(due+1);
    return {dueDay:due,instalment:cents(facility().amortizationAmount),afterInterestDay,afterInstalmentDay:{status:facility().status,arrears:cents(facility().principalArrears),chargedThatDay:cents(F.investorCardReturnPlan(state).charged-chargedBefore)},purposesInterestDay:p1,purposes:purposes(),power:cents(F.operating(state,'power'))};};
  const safe=m=>run(m);out.I4={control:safe(false),investor:safe(true)};}

// I5. A facility a group company drew from the group's own bank: its daily service in investor mode, the borrower's cash drained.
if(want('I5')){const run=mode=>{const h=harness(['capability-registry-core','company-definitions','company-platform-core','identity-system','control-plane-core','authorization-core','document-proof-core','transaction-core','domain-command-core','save-schema','determinism-core','event-ledger-core','dependency-core','policy-core','lifecycle-core','delivery-monitor-core','realism-core','finance-core','hr-core','corporate-core','facility-core','banking-core','game-lifecycle-core']);
    const {s}=h,d={...minimal(),profile:{name:'Facility Group'},bank:{},operations:{},crew:[],branches:[],hired:[],unlockedSectors:[],ownedCompanies:[]};
    const state=s.GH_GAME_LIFECYCLE.pristine(d,1);s.GH_GAME_LIFECYCLE.foundGroup(state,{mode:'sandbox',name:'Facility Group',founder:'Founder',locationId:'RUH'},d,{nextId:()=>'FOUND-FAC',simYear:()=>2026});
    const ctx={state},command=(domain,name,p={})=>s.GH_DOMAIN_COMMANDS.dispatch(ctx,domain,name,p).result,system=(domain,name,p={})=>s.GH_DOMAIN_COMMANDS.dispatchSystem(ctx,domain,name,p,{actor:'simulation-scheduler'}).result;
    command('corporate','open-company',{type:'bank',capital:400000000,legalName:'Test Bank'});command('corporate','open-company',{type:'air',capital:200000000,legalName:'Test Air'});
    const F=s.GH_FINANCE_CORE,bank=s.GH_BANKING_CORE.ensure(state);s.GH_BANKING_CORE.execute({state},'sync-corporate-clients',{},F);state.simSeconds=10*DAY;
    const client=bank.corporateClients.air;s.GH_BANKING_CORE.execute({state},'draw-facility',{ownerCompanyId:'air',amount:Math.min(50000000,client.creditLimit),termDays:365,rate:.08},F);
    const facility=bank.corporateFacilities.at(-1)||bank.corporateFacilities[0];
    command('finance','transfer',{from:'air',to:'group',amount:cents(F.operating(state,'air')-10),note:'cash to the holding'});if(mode)investor(state);
    state.simSeconds=11*DAY;const error=refusal(()=>system('banking','tick-day',{day:11}));
    return {error,status:facility.status,principalArrears:cents(facility.principalArrears),interestArrears:cents(facility.interestArrears),air:cents(F.operating(state,'air')),card:cents(F.investorCardReturnPlan(state).charged)};};
  const safe=m=>run(m);out.I5={control:safe(false),investor:safe(true)};}


// I7. Electricity bought inside the group: the month's account of the insurer, its cash taken away, settled at the close.
{const MODULES=['capability-registry-core','company-definitions','company-platform-core','identity-system','control-plane-core','authorization-core','document-proof-core','transaction-core','domain-command-core','save-schema','determinism-core','event-ledger-core','dependency-core','policy-core','lifecycle-core','delivery-monitor-core','realism-core','finance-core','branch-campaign-core','hr-core','corporate-core','facility-core','business-world-core','banking-core','insurance-core','energy-core','realestate-core','economics-core','game-lifecycle-core','company-adapters-core','company-autopilot-core','strategy-core','conference-core','operations-core','advanced-core'];
  const run=mode=>{const {s}=harness(MODULES),data={...minimal(),profile:{name:'Supply'},bank:{},operations:{},crew:[],branches:[],hired:[],unlockedSectors:[],ownedCompanies:[]},state=s.GH_GAME_LIFECYCLE.pristine(data,1);
    s.GH_GAME_LIFECYCLE.foundGroup(state,{mode:'sandbox',name:'Supply Group',founder:'Founder',locationId:'RUH'},data,{nextId:()=>'FOUND-SU',simYear:()=>2026});s.GH_ADVANCED.migrate(state);
    const D=s.GH_DOMAIN_COMMANDS,F=s.GH_FINANCE_CORE,TX=s.GH_TRANSACTION_CORE,player=(domain,name,payload)=>D.dispatch({state},domain,name,payload).result;
    player('corporate','open-company',{type:'power',capital:400000000,legalName:'Supply Power'});player('corporate','open-company',{type:'insurance',capital:200000000,legalName:'Supply Insurance'});
    state.customHubs.push({id:'PWR-GAS-SU',name:'Gas SU',city:'الرياض',country:'السعودية',kind:'power',company:'power',ownerCompanyId:'power',owned:true,energyKind:'gas',capacityAmount:100,capacity:'100 MW',commissioned:true,openedAt:0,dailyCost:38000,cost:200000000});
    state.simSeconds=100*DAY;s.GH_REALISM.migrate(state).economy.gas=50;const energy=s.GH_ENERGY_CORE.ensure(state);energy.sites.find(row=>row.facilityId==='PWR-GAS-SU').commissionedDay=0;
    energy.internalSupplyAccounts={insurance:{buyer:'insurance',openedDay:40,mwh:1200,amount:96000,avoided:120000,days:60}};
    player('finance','transfer',{from:'insurance',to:'group',amount:cents(F.operating(state,'insurance')-100),note:'cash to the holding'});if(mode)investor(state);const power=F.operating(state,'power');
    const res=TX.execute(state,{label:'day-close:101',apply(){state.simSeconds=101*DAY;const stages=s.GH_ADVANCED.onFinancialDayStages(state,101);let step;while(!(step=stages.next()).done){}return step.value;}});assert.equal(res.committed,true,`I7: ${res.reason}`);
    const account=state.energy.internalSupplyAccounts.insurance||null,settled=Array.from(state.finance.transfers).some(row=>String(row.reference||row.ref||'').startsWith('ENERGY-SUPPLY-insurance-'));
    return {open:account?cents(account.amount)>=96000:false,carriedOver:account?.carriedOver||0,settled,card:cents(F.investorCardReturnPlan(state).charged)>0,sellerGot:cents(F.operating(state,'power')-power)>=96000};};
  out.I7={control:run(false),investor:run(true)};}

// ---- what each case must show
{const {control,investor:paid}=out.I1;assert.deepEqual({milestones:control.milestonesPaid,waiting:control.waitingDays>0,card:control.card,valid:control.valid},{milestones:1,waiting:true,card:0,valid:true},'I1: without the licence the milestones wait for cash, as before');
  assert.deepEqual({error:paid.error,milestones:paid.milestonesPaid,waiting:paid.waitingDays,cheques:paid.cheques,valid:paid.valid},{error:null,milestones:3,waiting:0,cheques:3,valid:true},'I1: with it every milestone is paid on its day');assert.ok(paid.card>0&&paid.minBalance>=0,'I1: from the card, with no negative balance');}
console.log('I1 ok: a project\'s milestones are paid from the card');
{const {control,investor:paid}=out.I2;assert.deepEqual({status:control.status,paid:control.paid,card:control.card},{status:'بانتظار سيولة شركة التأمين',paid:0,card:0},'I2: without the licence the claim waits for the insurer\'s cash, as before');
  assert.deepEqual({error:paid.error,status:paid.status,paid:paid.paid,airGot:paid.airGot},{error:null,status:'مدفوعة',paid:900000,airGot:900000},'I2: with it the claim is paid');assert.ok(paid.card>0&&paid.insurer>=0);}
console.log('I2 ok: the group\'s insurer pays a claim from the card');
{const {control,investor:paid}=out.I3;assert.deepEqual({settled:control.settled,insurerGot:control.insurerGot,card:control.card},{settled:[false],insurerGot:0,card:0},'I3: without the licence the hotel\'s service bill waits, as before');
  assert.deepEqual({error:paid.error,settled:paid.settled},{error:null,settled:[true]},'I3: with it the bill is settled');assert.ok(paid.insurerGot>0&&paid.card>0&&paid.hotel>=0);}
console.log('I3 ok: a hotel\'s internal service bill is paid from the card');
{const {control,investor:paid}=out.I4;assert.deepEqual({interest:control.afterInterestDay.status,invoices:control.afterInterestDay.invoices,instalment:control.afterInstalmentDay.status,charged:control.afterInstalmentDay.chargedThatDay},{interest:'متأخر',invoices:['مستحقة'],instalment:'متأخر',charged:0},'I4: without the licence both days fall in arrears, as before');assert.ok(control.afterInstalmentDay.arrears>control.afterInterestDay.arrears);
  assert.deepEqual(paid.afterInterestDay,{status:'ساري',arrears:0,open:null,invoices:['مسددة']},'I4: with it the interest day is paid in full (interest and instalment)');assert.ok(paid.purposesInterestDay.length>=1,'I4: from the card');
  assert.deepEqual({status:paid.afterInstalmentDay.status,arrears:paid.afterInstalmentDay.arrears},{status:'ساري',arrears:0},'I4: and the next day\'s instalment, the cash drained again');assert.ok(paid.afterInstalmentDay.chargedThatDay>0,'I4: by a charge of that day (not the margin of the day before)');assert.ok(paid.purposes.includes('سداد دين'),'I4: the instalment\'s own purpose is on the card');}
console.log('I4 ok: a financed plant pays its interest and, the next day, its instalment from the card');
{const {control,investor:paid}=out.I5;assert.deepEqual({status:control.status,arrears:control.principalArrears>0&&control.interestArrears>0,card:control.card},{status:'متأخر',arrears:true,card:0},'I5: without the licence a facility the borrower cannot pay is overdue, as before');
  assert.deepEqual({error:paid.error,status:paid.status,principal:paid.principalArrears,interest:paid.interestArrears},{error:null,status:'ساري',principal:0,interest:0},'I5: with it the bank\'s day is paid');assert.ok(paid.card>0&&paid.air>=0);}
console.log('I5 ok: a company\'s facility from the group\'s bank is paid from the card');
{const {control,investor:paid}=out.I7;assert.deepEqual(control,{open:true,carriedOver:1,settled:false,card:false,sellerGot:false},'I7: without the licence the month\'s electricity is carried over, as before');
  assert.deepEqual(paid,{open:false,carriedOver:0,settled:true,card:true,sellerGot:true},'I7: with it the account is settled and the power company is paid');}
console.log('I7 ok: electricity bought inside the group is settled from the card');

// T. Tenders.
{const w=scenario();w.load('contracts-core');const {s,state,command}=w,C=s.GH_CONTRACTS_CORE,tender=id=>({id,client:'MedAxis International',sector:'air',category:'تشغيل',title:`مناقصة ${id}`,value:48000000,termMonths:24,region:'الخليج',sla:'98.5%',penalty:'غرامة',capacity:'18',payment:'شهري'}),bid=(id,won)=>command('contracts','bid',{...tender(id),won,number:won?`GH-CN-QA-${id}`:null,competitorId:'RIVAL-1',competitorName:'NorthStar Logistics'});
  state.simSeconds=8*DAY+DAY-1;bid('K1',false);state.simSeconds=9*DAY;bid('K2',false);
  assert.deepEqual({K1:state.contractRetenderDays.K1,K2:state.contractRetenderDays.K2},{K1:38,K2:39},'T: each lost tender keeps its own day (lost in the last second of day 8: day 38)');
  assert.equal(refusal(()=>bid('K1',true)),'tender-awarded-elsewhere','T: a second lost tender does not free the first');
  state.simSeconds=38*DAY-1;assert.equal(refusal(()=>bid('K1',true)),'tender-awarded-elsewhere','T: closed until the last second of day 37');state.simSeconds=38*DAY;assert.equal(C.retenderDay(state,'K1'),null);assert.equal(refusal(()=>bid('K2',true)),'tender-awarded-elsewhere','T: the other one is still closed that day');
  assert.equal(bid('K1',true).won,true,'T: open at the first second of day 38');
  // A tender whose contract ended: its record stays in the registry, the page no longer offers it, and the command refuses it.
  command('contracts','sign',{id:'K1',company:'air',companyId:'air',ownerCompanyId:'air',sector:'air',category:'تشغيل',deposit:4800000,name:'مناقصة K1',client:'MedAxis International',value:48000000,termMonths:24,region:'الخليج',sla:'98.5%',penalty:'غرامة',capacity:'18',payment:'شهري',taxable:false});
  {const valid=s.GH_SAVE_SCHEMA.validate(state);assert.ok(valid.ok,JSON.stringify(valid.errors));}
  // (the end of the term is stood in for by the record's own status: the sealed document is not re-sealed here)
  state.contractRegistry.K1.status='منتهي';state.acceptedContracts=Array.from(state.acceptedContracts).filter(id=>id!=='K1');
  assert.equal(refusal(()=>bid('K1',true)),'tender-closed','T: a tender whose contract has ended is not bid on again');assert.equal(refusal(()=>bid('K1',false)),'tender-closed');assert.equal(state.contractRegistry.K1.status,'منتهي','T: its record is unchanged');}
console.log('T ok: each lost tender keeps its own day; an ended contract\'s tender is closed');

// C. The card's charge between the steps.
{const charge=short=>{const w=scenario(),{s,state,command}=w,F=s.GH_FINANCE_CORE;investor(state);const cash=F.operating(state,'air');command('finance','spend',{company:'air',amount:cents(cash+short),note:'شراء',method:'تحويل بنكي',taxable:false});return cents(F.investorCardReturnPlan(state).charged);};
  assert.deepEqual([5000000,15000000,25000000,200000000000,400000000000].map(charge),[30000000,40000000,50000000,200030000000,400030000000],'C: the shortfall and 25M, up to the next 10M, at every size');}
console.log('C ok: the card charges the shortfall and 25M, up to the next 10M');
console.log('BUILD677_INVESTOR_CLOSES_AND_TENDER_LOCK_PASS');
