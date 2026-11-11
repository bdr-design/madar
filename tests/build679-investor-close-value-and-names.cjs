'use strict';
// Build 679 (the owner: «حلها كلها», what the previous report left open):
//   1. the investor licence («لا يُرفض شراء أو راتب أو تحويل أو شيك لنقص السيولة»): payroll arrears waited for the
//      company's own cash. With the licence they are settled (the settlement is a debit the card covers); without it a
//      company with no cash is passed over, as before;
//   2. a hotel's guest refund under the licence: the hotel ledger debits the account itself, so a refund the hotel's
//      cash did not cover stayed queued. It asks the card first; without the licence it waits, as before;
//   3. «قيمة المجموعة $250.0M» beside «السيولة $256.3M» with no debt: the pages read one value: the fair value of the
//      last close, and before any close the running figure, never under the group's cash net of its debt. Reading it
//      writes nothing;
//   4. a public route named «Riyadh → —» (a place whose city is a dash in the directory): named by its own name, then
//      its code;
//   5. loading a save slot replaces the game in play: its confirmation is armed like an erasure's.
// (The holding's daily cost under the licence, and the pages, are held on the real page by tests/build678.)
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||require('node:path').resolve(__dirname,'..');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {scenario}=require('./helpers/business-scenario'),{harness}=require('./helpers/core-harness'),{hospitalityFixture}=require('./helpers/hospitality-fixture.cjs');
const ROOT=process.env.GH_TEST_SOURCE_DIR,source=name=>fs.readFileSync(path.join(ROOT,'WebApp',name),'utf8'),cents=value=>Math.round(Number(value)*100)/100;
const app=source('app.js');

// 1. Payroll arrears: the page's own settlement (lifted as tests/build340 lifts it), then the real settlement command.
{const start=app.indexOf('  function settleOutstandingPayroll(){'),end=app.indexOf('\n  }\n\n  function processFinancialDay',start);assert.ok(start>=0&&end>start,'1: the payroll settlement is where the page defines it');
  const run=investor=>{const dispatched=[],transfers=[],context={state:{finance:{invoices:[{number:'PAY-A',payrollShortfall:true,company:'air'},{number:'PAY-G',payrollShortfall:true,company:'group'}],payables:[{number:'PAY-A',total:900,dueDay:5,company:'air'},{number:'PAY-G',total:400,dueDay:6,company:'group'}]}},
      GH_FINANCE_CORE:{investorMode:()=>investor},companyOperatingBalance:()=>0,transferBetweenCompaniesSystem:(...args)=>{transfers.push(args);return true;},dispatchSystemCommand:(_ctx,domain,command,payload)=>{dispatched.push(`${domain}:${command}:${payload.number}`);return {ok:true,result:{}};},pushAlert:()=>{},fmtMoney:value=>String(value),console:{warn(){}}};
    const out=vm.runInNewContext(`(()=>{${app.slice(start,end+4)};return settleOutstandingPayroll;})()`,context)();return {settled:out.settled,total:out.total,dispatched,transfers:transfers.length};};
  assert.deepEqual(run(false),{settled:0,total:0,dispatched:[],transfers:0},'1: without the licence arrears a company cannot pay are passed over, as before');
  assert.deepEqual(run(true),{settled:2,total:1300,dispatched:['finance:settle-payable:PAY-A','finance:settle-payable:PAY-G'],transfers:0},'1: with it they are settled, in the order they fell due');
  // The settlement itself, with the company's cash taken away: the card pays it.
  const real=investor=>{const {s,state,command}=scenario(),F=s.GH_FINANCE_CORE,system=(domain,name,payload,actor)=>s.GH_DOMAIN_COMMANDS.dispatchSystem({state},domain,name,payload,{actor}).result;
    system('finance','accrue-expense',{company:'air',amount:250000,note:'رواتب مستحقة',method:'قيد مستحق',dueDay:3,number:'PAY-QA-1',expenseAccount:'رواتب وأجور',payrollShortfall:true,closeOwned:true},'financial-close');
    command('finance','transfer',{from:'air',to:'group',amount:cents(F.operating(state,'air')-10),note:'cash to the holding'});if(investor){state.godMoney=true;state.infiniteMoney=true;}
    let refused=null;try{system('finance','settle-payable',{number:'PAY-QA-1'},'payroll-scheduler');}catch(error){refused=String(error.message);}
    const row=Array.from(state.finance.payables).find(item=>item.number==='PAY-QA-1'),invoice=Array.from(state.finance.invoices).find(item=>item.number==='PAY-QA-1');return {refused:refused!==null,open:!!row&&row.status!=='مسددة'&&invoice?.status!=='مسددة',card:cents(F.investorCardReturnPlan(state).charged)>0,cash:F.operating(state,'air')>=0,valid:s.GH_SAVE_SCHEMA.validate(state).ok};};
  assert.deepEqual(real(false),{refused:true,open:true,card:false,cash:true,valid:true},'1: without the licence the settlement is refused for cash, as before');
  assert.deepEqual(real(true),{refused:false,open:false,card:true,cash:true,valid:true},'1: with it the arrears are paid from the card');}
  // (review) The month's payroll run and a day's cost that is not billed (the bank's) were still capped at the company's
  // cash under the licence, and the rest was recorded as arrears for a later close. The page now asks for the whole
  // amount; the commands it calls pay it from the card.
  assert.ok(app.includes("const paid=globalThis.GH_FINANCE_CORE?.investorMode?.(state)===true?amount:Math.min(amount,companyOperatingBalance(company));let paymentRef=null,dueRef=null;"),'1: the payroll run pays the whole payroll under the licence');
  assert.ok(app.includes("paid=globalThis.GH_FINANCE_CORE?.investorMode?.(state)===true?expense:Math.min(available,expense);if(paid>0)spendCompanySystem(companyId,paid,"),'1: an unbilled daily cost is paid whole under the licence');
  const whole=(investor,pay)=>{const {s,state,command}=scenario(),F=s.GH_FINANCE_CORE,system=(domain,name,payload,actor)=>s.GH_DOMAIN_COMMANDS.dispatchSystem({state},domain,name,payload,{actor}).result;
    command('finance','transfer',{from:'air',to:'group',amount:cents(F.operating(state,'air')-10),note:'cash to the holding'});if(investor){state.godMoney=true;state.infiniteMoney=true;}
    let refused=null;try{pay(system);}catch(error){refused=String(error.message);}return {refused:refused!==null,card:cents(F.investorCardReturnPlan(state).charged)>0,cash:F.operating(state,'air')>=0&&F.operating(state,'group')>=0,valid:s.GH_SAVE_SCHEMA.validate(state).ok};};
  for(const [label,pay] of [['the payroll',system=>system('finance','pay-payroll',{company:'air',amount:600000,note:'رواتب يوم 27',reportId:'PAYRUN-QA'},'payroll-scheduler')],['a daily cost',system=>system('finance','spend',{company:'air',amount:46000,note:'مصروف يومي',method:'قيد تشغيلي يومي',taxable:true,closeOwned:true,obligation:true},'financial-close')]]){
    assert.deepEqual(whole(false,pay),{refused:true,card:false,cash:true,valid:true},`1: without the licence ${label} beyond the cash is refused (the page caps it, as before)`);
    assert.deepEqual(whole(true,pay),{refused:false,card:true,cash:true,valid:true},`1: with it ${label} is paid whole from the card`);}
console.log('1 ok: payroll arrears are settled from the card under the licence');

// 2. A guest refund (the fixture and the booking of tests/build393).
{const run=investor=>{const q=hospitalityFixture(),p=q.property(),terms={propertyId:p.id,startDay:2,endDay:5,rooms:3,roomClass:0},quote=q.H.bookingQuote(q.state,'hospitality',terms),b=q.command('reserve-group',{...terms,customerName:'شركة عميل',expectedGross:quote.gross});q.advance(14);
    const current=q.H.read(q.state).bookings.find(row=>row.id===b.id),ref=current.invoiceRefs[0],credit=q.command('credit-booking',{bookingId:b.id,invoiceNumber:ref.number,netCents:b.nightNet*b.rooms},'HOSP-CREDIT-QA');
    const cash=q.F.operating(q.state,'hospitality');q.s.GH_DOMAIN_COMMANDS.dispatch({state:q.state},'finance','transfer',{from:'hospitality',to:'group',amount:cents(cash-1),note:'cash to the holding'});if(investor){q.state.godMoney=true;q.state.infiniteMoney=true;}
    let error=null;try{q.command('settle-due');}catch(caught){error=String(caught.message);}
    const refunds=Array.from(q.state.hospitality.companies.hospitality.refunds||[]),paid=q.state.finance.hospitalityDocuments.filter(row=>row.creditNoteReference===credit.creditNoteReference&&row.cashMovement===true).length;
    return {error,paid,queued:refunds.filter(row=>row.status==='queued').length,card:cents(q.F.investorCardReturnPlan(q.state).charged)>0,cash:q.F.operating(q.state,'hospitality')>=0,refundable:credit.refundable>0};};
  assert.deepEqual(run(false),{error:null,paid:0,queued:1,card:false,cash:true,refundable:true},'2: without the licence a refund the hotel cannot pay stays queued, as before');
  assert.deepEqual(run(true),{error:null,paid:1,queued:0,card:true,cash:true,refundable:true},'2: with it the refund is paid from the card, once');}
// 2b (review). The other refund: the deposit of a cancelled booking.
{const run=investor=>{const q=hospitalityFixture(),p=q.property(),terms={propertyId:p.id,startDay:20,endDay:23,rooms:3,roomClass:0},quote=q.H.bookingQuote(q.state,'hospitality',terms),b=q.command('reserve-group',{...terms,customerName:'شركة عميل',expectedGross:quote.gross});q.advance(14);
    const cash=q.F.operating(q.state,'hospitality');q.s.GH_DOMAIN_COMMANDS.dispatch({state:q.state},'finance','transfer',{from:'hospitality',to:'group',amount:cents(cash-1),note:'cash to the holding'});if(investor){q.state.godMoney=true;q.state.infiniteMoney=true;}
    const cancelled=q.command('cancel-booking',{bookingId:b.id});let error=null;try{q.command('settle-due');}catch(caught){error=String(caught.message);}
    const root=q.state.hospitality.companies.hospitality,refunds=Array.from(root.refunds||[]),booking=Array.from(root.bookings).find(row=>row.id===b.id);
    return {error,refundable:cancelled.refundable>0,returned:booking.depositRefunded===Math.round(cancelled.refundable*100),queued:refunds.filter(row=>row.status==='queued').length,card:cents(q.F.investorCardReturnPlan(q.state).charged)>0,cash:q.F.operating(q.state,'hospitality')>=0};};
  assert.deepEqual(run(false),{error:null,refundable:true,returned:false,queued:1,card:false,cash:true},'2: without the licence a deposit the hotel cannot return stays queued, as before');
  assert.deepEqual(run(true),{error:null,refundable:true,returned:true,queued:0,card:true,cash:true},'2: with it the deposit is returned from the card, in full');}
console.log('2 ok: a hotel\'s guest refund is paid from the card under the licence');

// 3. The group's value as the pages show it.
{const h=harness([]);for(const name of ['capability-registry-core','company-definitions','company-platform-core','corporate-core'])h.load(name);const C=h.s.GH_CORPORATE_CORE,read=state=>{const before=JSON.stringify(state),value=C.shownValue(state);assert.equal(JSON.stringify(state),before,'3: reading the value writes nothing');return value;};
  assert.equal(read({groupValue:250000000,cash:256300000,debt:0}),256300000,'3: before a close the value is not under the group\'s cash (it read 250.0M beside 256.3M)');
  assert.equal(read({groupValue:250000000,cash:256300000,debt:40000000}),250000000,'3: net of its debt the running figure stands');
  assert.equal(read({groupValue:412000000,cash:10,debt:0}),412000000);assert.equal(read({}),0);assert.equal(read({groupValue:5,cash:1,debt:900}),5);
  assert.equal(read({groupValue:250000000,cash:256300000,debt:0,advanced:{valuation:{day:null,fair:0}}}),256300000,'3: a valuation that has not closed a day is not read');
  assert.equal(read({groupValue:250000000,cash:300000000,debt:0,advanced:{valuation:{day:8,fair:260700000}}}),260700000,'3: after a close the fair value of that close is the value, as the finance page prints it');
  assert.equal(read({groupValue:1,cash:1,debt:0,advanced:{valuation:{day:8,fair:-5}}}),0);
  for(const [file,call] of [['madar-shell.js',"money(ctx,globalThis.GH_CORPORATE_CORE?.shownValue?.(state)??state.groupValue)"],['advanced-core.js',"ctx.fmtMoney(globalThis.GH_CORPORATE_CORE?.shownValue?.(s)??s.groupValue)"],['app.js',"fmtMoney(window.GH_CORPORATE_CORE.shownValue?.(state)??state.groupValue)"]])assert.ok(source(file).includes(call),`3: ${file} prints that value`);}
console.log('3 ok: the pages read one group value, never under the cash before a close');

// 4. A public route's ends.
{const at=app.indexOf('  function routeEndpointName(endpoint){'),name=vm.runInNewContext(`(()=>{${app.slice(at,app.indexOf('\n',at))};return routeEndpointName;})()`);
  assert.deepEqual([{city:'Riyadh',name:'King Khalid'},{city:'—',name:'Pump Station 10 Airport'},{city:' - ',name:'',iata:'XYZ'},{city:'',name:'–',code:'OEPS'},{city:'—'},null,{city:'الرياض'},{name:'Port-au-Prince'},{city:'St. John\'s'}].map(name),['Riyadh','Pump Station 10 Airport','XYZ','OEPS','وجهة عالمية','وجهة عالمية','الرياض','Port-au-Prince','St. John\'s'],'4: a dash is no name');}
console.log('4 ok: a route\'s end is named by its city, its name or its code, never a dash');

// 5. Loading a slot.
{const advanced=source('advanced-core.js');assert.match(advanced,/if\(await confirmDecision\(ctx,'تحميل هذه الخانة واستبدال التقدم الحالي؟[^']*','critical','load-slot'\)\)/,'5: the slot\'s confirmation is an armed one');assert.equal(advanced.includes("'high','load-slot'"),false);
  const core=source('interface-core.js');assert.match(core,/if\(risk==='critical'\|\|armed===true\)\{const accept=dialog\.querySelector\('\[data-confirm=accept\]'\),armAt=performance\.now\(\)\+CRITICAL_ARM_MS;/,'5: an armed confirmation holds its button until its time has passed (tests/build664)');}
console.log('5 ok: loading a slot is confirmed by an armed dialog');
// 6 (Build 680, review). The rule of the large-spend question and the amount it asks about, as the page defines them.
{const start=app.indexOf('  const LARGE_SPEND_SHARE=.5,LARGE_SPEND_ABSOLUTE=1000000000;'),end=app.indexOf('  async function manualPurchaseFromCard(button){',start);assert.ok(start>=0&&end>start,'6: the rule is where the page defines it');
  const lift=({investor=false,cash={},catalog={},priced=row=>row,facilities=[]}={})=>{const context={state:{},window:{GH_FINANCE_CORE:{investorMode:()=>investor},GH_GOVERNANCE_CORE:{pricedAsset:(_state,row)=>priced(row)},GH_INTERFACE:{confirm:async()=>true}},companyOperatingBalance:company=>{if(!(company in cash))throw new Error('no such company');return cash[company];},catalogItem:(_type,id)=>catalog[id]||null,companyAssetClassForMode:()=>'cargo',assetPurchaseFacilitySnapshot:()=>facilities,fmtMoney:String};
    return vm.runInNewContext(`(()=>{${app.slice(start,end)};return {largeSpend,manualPurchaseEstimate};})()`,context);};
  const plain=value=>value&&JSON.parse(JSON.stringify(value,(_key,item)=>item===Infinity?'∞':item));
  {const {largeSpend}=lift({cash:{road:10000000,group:10000000}});
    assert.equal(largeSpend(9900000,'road'),null,'6: under half of what can pay it: no question');assert.deepEqual(plain(largeSpend(10000000,'road')),{investor:false,available:20000000,share:true},'6: half of the company\'s cash and the holding\'s: a question');
    assert.deepEqual(plain(largeSpend(20000000,'road')),{investor:false,available:20000000,share:true},'6: all of it: a question');assert.equal(largeSpend(20000001,'road'),null,'6: more than can pay it: left to the refusal');
    assert.deepEqual(plain(largeSpend(5000000,'road',false)),{investor:false,available:10000000,share:true},'6: a company whose cheque is its own is measured by its own cash');assert.equal(largeSpend(4900000,'road',false),null);assert.equal(largeSpend(11000000,'road',false),null,'6: and what its own cash cannot pay is left to the refusal');
    assert.deepEqual(plain(largeSpend(5000000,'group')),{investor:false,available:10000000,share:true},'6: the holding is not counted twice');for(const bad of [0,-5,NaN,'x',null])assert.equal(largeSpend(bad,'road'),null,'6: no amount, no question');assert.equal(largeSpend(1000,'nobody'),null,'6: an unknown payer asks nothing');}
  {const {largeSpend}=lift({cash:{road:0,group:5000000000}});assert.equal(largeSpend(999999999,'road'),null,'6: under a billion and under half: no question');assert.deepEqual(plain(largeSpend(1000000000,'road')),{investor:false,available:5000000000,share:false},'6: a billion asks even when it is a fifth of the cash');assert.deepEqual(plain(largeSpend(2500000000,'road')),{investor:false,available:5000000000,share:true});}
  {const {largeSpend}=lift({investor:true,cash:{road:0,group:0}});assert.equal(largeSpend(999999999,'road'),null,'6: under the licence less than a billion asks nothing');assert.deepEqual(plain(largeSpend(1000000000,'road')),{investor:true,available:'∞',share:false},'6: a billion asks');}
  {const catalog={A:{id:'A',name:'طائرة',price:200000000,leaseMonthly:2000000,downPayment:.25},B:{id:'B',name:'بلا دفعة',price:100,leaseMonthly:0}},facilities=[{id:'1',owned:true,compatible:true,ownerCompanyId:'air'},{id:'2',owned:true,compatible:true,ownerCompanyId:'air'},{id:'3',owned:false,compatible:true,ownerCompanyId:'air'},{id:'4',owned:true,compatible:false,ownerCompanyId:'air'},{id:'5',owned:true,compatible:true,ownerCompanyId:'sea'}],{manualPurchaseEstimate:estimate}=lift({catalog,facilities});
    assert.deepEqual(plain(estimate('air','A','cash','4','air','total')),{amount:800000000,count:4,each:4,facilities:1,name:'طائرة'},'6: a total count');
    assert.deepEqual(plain(estimate('air','A','cash','4','air','per-facility')),{amount:1600000000,count:8,each:4,facilities:2,name:'طائرة'},'6: «العدد لكل منشأة» counts every owned, compatible facility of the company (4 at each of two was asked about as 4)');
    assert.equal(estimate('air','A','finance',2,'air','total').amount,100000000,'6: a financed purchase is asked about by its down payment');assert.equal(estimate('air','B','finance',1,'air','total').amount,20,'6: the order\'s own 20% when the model names none');
    assert.equal(estimate('air','A','lease',10,'air','total').amount,60000000,'6: a lease by its three months (it was asked about as one)');assert.deepEqual(plain(estimate('air','none','cash',3,'air','total')),{amount:0,count:3,each:3,facilities:1,name:'none'},'6: an unknown model asks nothing');
    assert.equal(lift({catalog,priced:row=>({...row,price:row.price*.9})}).manualPurchaseEstimate('air','A','cash',1,'air','total').amount,180000000,'6: at the supply programme\'s price, as the order charges');}
  for(const [name,call] of [['the asset market',"if(!await confirmLargeSpend(estimate.amount,ownerCompanyId,"],['the mobility market',"*quantity,owner,`شراء ${countText(quantity,'vehicle',undefined,true)} · ${spec?.name||classId}؟`,false))return null;}"],['a directory site',"if(!isHospitalityDirectoryCompany(company)&&!await confirmLargeSpend(offer.quote,company,"],['a regional headquarters',"if(!opts.silent&&!(state.branches||[]).includes(id)&&!await confirmLargeSpend(Number(constructionBid('group','hq',site.price,site.name)?.winner?.quote)||site.price,'group',"]])assert.ok(app.includes(call),`6: ${name} asks by the rule`);
  assert.ok(app.includes("action:'large-spend',risk:'financial',armed:true}"),'6: the confirming button is held');
  const market=app.slice(app.indexOf('  async function manualPurchaseFromCard(button){')),busy=market.indexOf("const release=beginButtonOperation(button,'جارٍ الشراء والتسليم…')"),asks=market.indexOf('await confirmLargeSpend(');assert.ok(busy>0&&asks>busy,'6: the button is busy before the question (a redrawn card does not drop an accepted purchase)');}
console.log('6 ok: the large-spend rule and the amount it asks about');
console.log('BUILD679_INVESTOR_CLOSE_VALUE_AND_NAMES_PASS');
