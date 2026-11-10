'use strict';
// Build 673, from the play-through (the owner: none of this is intended):
//   a. A lost tender stayed open: the same offer won it a tap or two later, after the page had named the competitor it
//      was awarded to (K5: lost three times, then won, with a $21M advance at signature). A tender won and not yet signed
//      could be bid on again.
//   b. The investor card charged twice what was short above 25M: a $110.0B purchase charged $219.95B and left $109.98B in
//      the company.
//   c. With the investor licence («no purchase is refused for lack of cash») a real-estate project, the conference and
//      a bank's campaign were refused once the company's own cash was spent, and a financed plant's interest and
//      instalments were deferred as if it were short.
// Checked here with real commands:
//   1. a lost tender is refused until thirty game days have passed, then open again; one won and unsigned is not bid on
//      again; a tender lost before this build (no day kept) is open; the state stays valid;
//   2. the card charges the shortfall and a fixed 25M margin, in steps of 10M: 30M for 1M short (as before), $110.03B for
//      $110.0B short (it was $220B);
//   3. the investor mode covers a project's start, the conference and a bank branch's campaign; without it each is
//      refused as before (the control). A financed plant and a hotel with no cash pay their interest, instalments and
//      service bill in that mode; without it they are deferred as before.
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||require('node:path').resolve(__dirname,'..');
const assert=require('node:assert/strict');
const {scenario}=require('./helpers/business-scenario'),{harness,minimal}=require('./helpers/core-harness'),{hospitalityFixture}=require('./helpers/hospitality-fixture.cjs');
const DAY=86400,cents=value=>Math.round(Number(value)*100)/100,refusal=run=>{try{run();return null;}catch(error){return String(error?.message||error);}};

// 1. Tenders.
{const w=scenario();w.load('contracts-core');const {s,state,command}=w,Schema=s.GH_SAVE_SCHEMA,C=s.GH_CONTRACTS_CORE,valid=label=>{const out=Schema.validate(state);assert.ok(out.ok,`${label}: ${JSON.stringify(out.errors)}`);};
  const tender={id:'K1',client:'MedAxis International',sector:'air',category:'تشغيل',title:'توزيع دوائي مبرد',value:48000000,termMonths:24,region:'الخليج',sla:'98.5%',penalty:'غرامة',capacity:'18 شاحنة',payment:'شهري'},bid=(won,extra={})=>command('contracts','bid',{...tender,...extra,won,number:won?`GH-CN-QA-${extra.id||tender.id}`:null,competitorId:'RIVAL-1',competitorName:'NorthStar Logistics'});
  assert.equal(state.contractRetenderDays,undefined,'1: a game that lost no tender keeps no map');state.simSeconds=8*DAY+3600;const lost=bid(false);assert.equal(lost.won,false);assert.deepEqual(Array.from(state.failedBids),['K1']);assert.equal(state.contractRetenderDays.K1,38,'1: the lost tender is tendered again on day 38');assert.equal(C.retenderDay(state,'K1'),38);
  assert.equal(refusal(()=>bid(true)),'tender-awarded-elsewhere','1: the same offer cannot win it a tap later');assert.equal(refusal(()=>bid(false)),'tender-awarded-elsewhere');assert.equal(state.contractRegistry.K1,undefined,'1: nothing was awarded to the group');
  state.simSeconds=37*DAY+80000;assert.equal(refusal(()=>bid(true)),'tender-awarded-elsewhere','1: still awarded on day 37');
  state.simSeconds=38*DAY;assert.equal(C.retenderDay(state,'K1'),null,'1: open again on day 38');const again=bid(false);assert.equal(again.won,false);assert.equal(state.contractRetenderDays.K1,68,'1: lost again, it comes back thirty days later');assert.deepEqual(Array.from(state.failedBids),['K1'],'1: recorded once');
  state.simSeconds=68*DAY;const won=bid(true);assert.equal(won.won,true);assert.equal(state.contractRegistry.K1.status,'بانتظار التوقيع');assert.equal(state.contractRetenderDays.K1,undefined,'1: a won tender keeps no day');s.GH_CONTRACTS_CORE.ensure(state);
  assert.equal(refusal(()=>bid(false)),'tender-already-won','1: a tender won and unsigned is not bid on again');assert.equal(refusal(()=>bid(true)),'tender-already-won');assert.equal(state.contractRegistry.K1.number,'GH-CN-QA-K1','1: its contract number is unchanged');
  // A tender lost before this build: the save names it and keeps no day.
  state.failedBids.push('K5');assert.equal(C.retenderDay(state,'K5'),null);assert.equal(bid(true,{id:'K5'}).won,true,'1: a tender lost before this build is open');valid('1: the state');
  const signed=command('contracts','sign',{id:'K1',company:'air',companyId:'air',ownerCompanyId:'air',sector:'air',category:'تشغيل',deposit:4800000,name:tender.title,client:tender.client,value:tender.value,termMonths:24,region:'الخليج',sla:'98.5%',penalty:'غرامة',capacity:'18',payment:'شهري',taxable:false});assert.ok(signed.number,'1: the won tender is signed as before');
  assert.equal(refusal(()=>bid(true)),'contract-already-signed');valid('1: after signing');}
console.log('1 ok: a lost tender is closed for thirty game days, then tendered again; a won one is not bid on twice');

// 2. The investor card's charge.
{const charge=short=>{const w=scenario(),{s,state,command}=w,F=s.GH_FINANCE_CORE;state.godMoney=true;state.infiniteMoney=true;assert.equal(F.investorMode(state),true);const cash=F.operating(state,'air');
    command('finance','spend',{company:'air',amount:cents(cash+short),note:'شراء',method:'تحويل بنكي',taxable:false});const plan=F.investorCardReturnPlan(state);return {charged:cents(plan.charged),left:cents(F.operating(state,'air')),valid:s.GH_SAVE_SCHEMA.validate(state).ok};};
  assert.deepEqual(charge(1000000),{charged:30000000,left:29000000,valid:true},'2: 1M short: 30M, as before');assert.deepEqual(charge(24000000),{charged:50000000,left:26000000,valid:true},'2: 24M short: 50M, as before');
  assert.deepEqual(charge(110000000000),{charged:110030000000,left:30000000,valid:true},'2: $110.0B short charges $110.03B and leaves 30M (it charged $220B and left $110B)');
  assert.deepEqual(charge(26000000),{charged:60000000,left:34000000,valid:true},'2: 26M short: 60M (it was 60M too: the same step)');assert.deepEqual(charge(40000000),{charged:70000000,left:30000000,valid:true},'2: 40M short: 70M (it was 80M)');}
console.log('2 ok: the card charges the shortfall and a fixed 25M margin: $110.03B for $110.0B short');

// 3. What the investor mode covers.
// a. A real-estate project's start (the fixture of tests/build378), the company with 1,000 in cash.
{const start=investor=>{const {s}=harness(['capability-registry-core','company-definitions','company-platform-core','identity-system','control-plane-core','authorization-core','determinism-core','integrity-core','document-proof-core','transaction-core','domain-command-core','finance-core','facility-core','realestate-core','economics-core','save-schema']),RE=s.GH_REALESTATE_CORE,opened=['bank','realestate'];
    const companyRegistry=Object.fromEntries(opened.map(id=>{const definition=s.GH_COMPANY_DEFINITIONS.get(id);return [id,{id,definitionId:definition.definitionId,definitionVersion:definition.definitionVersion,status:'active'}];}));
    const state={...minimal(),profile:{name:'Build 673'},companyRegistry,openedCompanies:opened,branches:[],customHubs:[{id:'RE-RUH',kind:'realestate',ownerCompanyId:'realestate',owned:true,city:'الرياض',country:'السعودية'}],realEstate:{},advanced:{}},F=s.GH_FINANCE_CORE;
    F.ensure(state);F.book(state,'realestate').accounts[0].balance=1000;F.reconcile(state);if(investor){state.godMoney=true;state.infiniteMoney=true;}const re=RE.ensure(state);state.simSeconds=0;
    const out=refusal(()=>RE.execute({state},'start-project',{officeId:re.offices[0].id,type:'residential',size:1,priceLevel:1,mode:'sale'}));return {refused:out,projects:Array.from(re.projects).length,cheques:Array.from(state.finance.cheques||[]).filter(row=>row.status==='مصروف').length,cash:F.operating(state,'realestate')};};
  const control=start(false);assert.deepEqual({refused:control.refused,projects:control.projects},{refused:'insufficient-cash',projects:0},'3: without the investor mode a project the company cannot pay for is refused, as before');
  const covered=start(true);assert.deepEqual({refused:covered.refused,projects:covered.projects,cheques:covered.cheques},{refused:null,projects:1,cheques:1},'3: with it the project starts and its first cheque is cashed');assert.ok(covered.cash>=0,'3: the card covered it');}
// b. The conference, the holding with no cash.
{const prepare=investor=>{const env=scenario(),{s,state,command}=env;env.load('arabic-copy-core');env.load('conference-model');env.load('conference-core');state.simSeconds=365*DAY;s.GH_CONFERENCE.execute({state},'tick-day',{day:365});
    const F=s.GH_FINANCE_CORE;command('finance','transfer',{from:'group',to:'air',amount:cents(F.operating(state,'group')-1000),note:'cash to the airline'});if(investor){state.godMoney=true;state.infiniteMoney=true;}
    let prepared=null;const out=refusal(()=>{prepared=command('conference','prepare',{year:2026,packageId:'global'});});return {refused:out,state:prepared?.lifecycle?.state||null};};
  assert.deepEqual(prepare(false),{refused:'conference-insufficient-cash',state:null},'3: without the investor mode the conference is refused, as before');assert.deepEqual(prepare(true),{refused:null,state:'prepared'},'3: with it the conference is prepared');}
// c. A financed plant's interest and instalment (the fixture of tests/build668), the company with no cash.
{const MODULES=['capability-registry-core','company-definitions','company-platform-core','identity-system','control-plane-core','authorization-core','document-proof-core','transaction-core','domain-command-core','save-schema','determinism-core','event-ledger-core','dependency-core','policy-core','lifecycle-core','delivery-monitor-core','realism-core','finance-core','branch-campaign-core','hr-core','corporate-core','facility-core','business-world-core','banking-core','insurance-core','energy-core','realestate-core','economics-core','game-lifecycle-core','company-adapters-core','company-autopilot-core','strategy-core','conference-core','operations-core','advanced-core'];
  const plant=investor=>{const {s}=harness(MODULES),data={...minimal(),profile:{name:'Plant Investor'},bank:{},operations:{},crew:[],branches:[],hired:[],unlockedSectors:[],ownedCompanies:[]},state=s.GH_GAME_LIFECYCLE.pristine(data,1);
    s.GH_GAME_LIFECYCLE.foundGroup(state,{mode:'sandbox',name:'Plant Group',founder:'Founder',locationId:'RUH'},data,{nextId:()=>'FOUND-PI',simYear:()=>2026});s.GH_ADVANCED.migrate(state);
    const D=s.GH_DOMAIN_COMMANDS,F=s.GH_FINANCE_CORE,TX=s.GH_TRANSACTION_CORE,player=(domain,name,payload)=>D.dispatch({state},domain,name,payload).result;
    player('corporate','open-company',{type:'power',capital:400000000,legalName:'Plant Power'});
    state.customHubs.push({id:'PWR-GAS-PI',name:'Gas PI',city:'الرياض',country:'السعودية',kind:'power',company:'power',ownerCompanyId:'power',owned:true,energyKind:'gas',capacityAmount:100,capacity:'100 MW',commissioned:true,openedAt:0,dailyCost:38000,cost:200000000});
    state.simSeconds=100*DAY;s.GH_REALISM.migrate(state).economy.gas=50;s.GH_REALISM.migrate(state).economy.baseRate=.05;state.profile.creditRating='BBB';
    const site=s.GH_ENERGY_CORE.ensure(state).sites.find(row=>row.facilityId==='PWR-GAS-PI');site.commissionedDay=0;const financed=player('energy','finance-project',{siteId:site.id,amount:100000000}),facility=()=>state.energy.projectFinance.find(row=>row.id===financed.id);
    const close=day=>{const out=TX.execute(state,{label:`day-close:${day}`,apply(){state.simSeconds=day*DAY;const stages=s.GH_ADVANCED.onFinancialDayStages(state,day);let step;while(!(step=stages.next()).done){}return step.value;}});assert.equal(out.committed,true,`day ${day}: ${out.reason}`);};
    const due=Number(facility().nextInterestDueDay);for(let day=101;day<due;day++)close(day);
    // The company's cash goes to the holding the day before the interest is due; then the mode is switched as the page switches it.
    player('finance','transfer',{from:'power',to:'group',amount:cents(F.operating(state,'power')-100),note:'cash to the holding'});if(investor){state.godMoney=true;state.infiniteMoney=true;}
    close(due);close(due+1);const now=facility(),invoices=Array.from(state.finance.invoices).filter(row=>String(row.number).startsWith('PFINT-'));
    return {status:now.status,arrears:cents(now.principalArrears),open:now.interestInvoiceNumber,invoices:invoices.map(row=>row.status),card:cents(F.investorCardReturnPlan(state).charged)};};
  const control=plant(false);assert.deepEqual({status:control.status,invoices:control.invoices,card:control.card},{status:'متأخر',invoices:['مستحقة'],card:0},'3: without the investor mode a plant with no cash defers its interest and falls in arrears, as before');assert.ok(control.arrears>0&&control.open);
  const covered=plant(true);assert.deepEqual({status:covered.status,arrears:covered.arrears,open:covered.open,invoices:covered.invoices},{status:'ساري',arrears:0,open:null,invoices:['مسددة']},'3: with it the interest and the instalments are paid');assert.ok(covered.card>0,'3: from the card');}
// d. A bank branch's campaign, the bank having spent its cash.
{const campaign=investor=>{const w=scenario();for(const name of ['world-data','mobility-core','economics-core','banking-core'])w.load(name);const {s,state,command}=w,F=s.GH_FINANCE_CORE;command('corporate','open-company',{type:'bank',capital:300000000,legalName:'Test Bank'});
    const capital=s.GH_MOBILITY_CORE.capitalMeta('RUH'),site={key:'site:bank:RUH',sourceKey:'site:bank:RUH',capitalId:'RUH',city:capital.city,country:capital.country,coords:[...capital.coords]};
    command('facilities','create',{facility:{id:'QA-BANK-RUH',sourceKey:site.key,capitalId:'RUH',company:'bank',ownerCompanyId:'bank',kind:'bank',owned:true,name:'bank · الرياض',city:site.city,country:site.country,coords:[...site.coords],cost:15000000,dailyCost:5500},bucket:'customHubs',groupValueAdd:0});
    command('banking','open-branch',{branchId:'BR-QA-BANK-RUH',facilityId:'QA-BANK-RUH',site,servicesActive:true});command('finance','spend',{company:'bank',amount:cents(F.operating(state,'bank')-100),note:'شراء',method:'تحويل بنكي',taxable:false});if(investor){state.godMoney=true;state.infiniteMoney=true;}
    const out=refusal(()=>command('banking','branch-campaign',{branchId:'BR-QA-BANK-RUH'})),branch=state.bank.branchNetwork[0];return {refused:out,running:Number(branch.campaignUntil)>Math.floor(state.simSeconds/DAY)};};
  assert.deepEqual(campaign(false),{refused:'insufficient-cash',running:false},'3: without the investor mode a campaign the bank cannot pay for is refused, as before');assert.deepEqual(campaign(true),{refused:null,running:true},'3: with it the campaign runs');}
// e. A hotel's external service bill on the 15th (the fixture of tests/build665), the hotel with no cash.
{const hotel=investor=>{const q=hospitalityFixture();for(const name of ['company-autopilot-core','strategy-core','conference-core','operations-core','advanced-core'])q.load(name);const {s,state,F,H}=q;s.GH_ADVANCED.migrate(state);
    const property=q.property();state.advanced.facilities[property.id].staff=0;const quote=s.GH_HOSPITALITY_LINKS.quote(state,'hospitality',property.id,'telecom','external');q.command('sign-service',{propertyId:property.id,kind:'telecom',providerCompanyId:'external',expectedDailyNet:quote.dailyNet});
    const account=()=>Object.values(H.read(state,'hospitality').accounting.serviceAccounts||{})[0];q.advance(13);const cash=F.operating(state,'hospitality');if(cash>0)s.GH_DOMAIN_COMMANDS.dispatch({state},'finance','transfer',{from:'hospitality',to:'group',amount:cents(cash),note:'cash to the holding'});
    q.tick(14);const number=account().invoiceNumber;assert.ok(number&&account().settled!==true,'3: the service bill is issued and left open');if(investor){state.godMoney=true;state.infiniteMoney=true;}q.tick(15);
    return {settled:account().settled===true,invoice:String(state.finance.invoices.find(row=>row.number===number).status),card:cents(F.investorCardReturnPlan(state).charged)>0};};
  assert.deepEqual(hotel(false),{settled:false,invoice:'مستحقة',card:false},'3: without the investor mode a hotel with no cash leaves its service bill open, as before');assert.deepEqual(hotel(true),{settled:true,invoice:'مسددة',card:true},'3: with it the bill is paid from the card');}
console.log('3 ok: the investor mode covers a project\'s start, the conference, a bank branch\'s campaign, a plant\'s debt service and a hotel\'s bill');
console.log('build673 tender and investor card: 3 checks passed');
