'use strict';
// Build 670, found by the review of build 667 and reproduced with the game's own commands: two things a monthly budget
// ceiling broke without stopping the clock.
//   a. A facility drawn from the group's bank moved the cash first and paid its arrangement fee after, from the borrower's
//      «other» budget. A ceiling with no room refused the fee there; the dealership's floor plan tolerates a refused draw
//      inside the day, so the day committed with 5,000,000 moved and no loan, no debt and no facility.
//   b. The company autopilot pays the due payables in one step and checked cash only. One payable the ceiling refuses
//      (an interest invoice, a take-or-pay bill) rejected the whole step, every day: nothing was paid, not even the
//      obligations the ceiling never refuses.
// The draw now refuses before it writes anything; the finance owner says why a transfer cannot settle a payable
// (payableTransferBlocker) and a batch leaves that payable out. Checked here with real commands:
//   1. the draw: with no ceiling it books cash, fee, loan and facility as before (the control); under a ceiling with no
//      room for the fee, called as the floor plan calls it, nothing moves and the day commits; the player's own draw is
//      refused with its reason; a line's ceiling refuses it too; with room for the fee the draw goes through;
//   2. the autopilot under a 1M ceiling: three accrued bills and a payroll shortfall are paid in one step, each once; the
//      1.5M payable the ceiling refuses is left open and no step fails on the following days; what a batch's earlier
//      rows take is counted, per company and per line (two 600K payables: one paid, one left; a payroll shortfall takes
//      the room first, and only as far as its own line goes; an obligation that reserved nothing takes none; an exact
//      fit in cents fails no step); two cheques of one company are not presented against the same cash or room;
//   3. the reasons: unknown payable, cheque in issue, cash, ceiling, and none in investor mode or with no ceiling.
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||require('node:path').resolve(__dirname,'..');
const assert=require('node:assert/strict');
const {scenario}=require('./helpers/business-scenario');
const DAY=86400,cents=value=>Math.round(Number(value)*100)/100;
function world(modules=[]){const sc=scenario(),{s,state,command}=sc,T=s.GH_TRANSACTION_CORE,C=s.GH_CONTROL_PLANE,F=s.GH_FINANCE_CORE,D=s.GH_DOMAIN_COMMANDS,I=s.GH_INTEGRITY_CORE;for(const name of modules)sc.load(name);
  // A simulation slice as app.js runs one: the change, then the hourly cycle's command with the schema and integrity checks.
  const slice=(name,change)=>{try{const out=T.execute(state,{label:`simulation:${name}`,apply:()=>{const value=change();C.execute(state,{name:'MARKET_HOURLY_CYCLE',domain:'market',actor:'simulation-market',correlationId:name},()=>true,{atomic:false,integrity:true,schema:true,deferIntegrityToTransaction:true});return value;}});return {committed:out.committed===true,reason:String(out.reason||''),value:out.value};}catch(error){return {committed:false,reason:String(error?.message||error)};}};
  const system=(name,payload,actor,domain='finance')=>D.dispatchSystem({state},domain,name,payload,{actor}).result,budget=company=>state.companyBudgets[company],cash=company=>F.operating(state,company);
  const valid=label=>{const out=s.GH_SAVE_SCHEMA.validate(state);assert.ok(out.ok,`${label}: ${JSON.stringify(out.errors)}`);assert.deepEqual(Array.from(I.check(state).issues).filter(row=>row.severity==='critical').map(row=>String(row.id)),[],`${label}: no critical issue`);};
  return {s,state,command,slice,system,budget,cash,valid,F,T,D};}
// An accrued bill of the close (it reserves its room), a payroll shortfall, and an ordinary open payable (the shape of an
// interest invoice or a take-or-pay bill: issue-invoice, due, no reservation).
const accrued=(w,number,amount,company='air')=>w.system('accrue-expense',{company,amount,note:'مصروف تشغيلي مستحق مرحّل من الإقفال اليومي',method:'قيد مستحق',dueDay:1,number,expenseAccount:'مصروف تشغيلي',closeOwned:true},'financial-close');
const shortfall=(w,number,amount,company='air')=>w.system('accrue-payroll',{company,amount,note:'رواتب مستحقة يوم 27',number,dueDay:1,reportId:`REPORT-${number}`},'payroll-scheduler');
const ordinary=(w,number,amount,company='air')=>w.system('issue-invoice',{kind:'مصروف',company,amount,status:'مستحقة',taxable:false,method:'التزام عقد وقود',counterparty:'مورد وقود',note:`حد أدنى ملزم لعقد الوقود · ${number}`,number,dueDay:1,sourceRef:`TAKE-OR-PAY-${number}`},'simulation');

// 1. The facility draw.
{const bankWorld=prepare=>{const w=world(['economics-core','banking-core']),{s,state}=w,B=s.GH_BANKING_CORE;w.command('corporate','open-company',{type:'bank',capital:300000000,legalName:'Test Bank'});try{B.execute({state},'ensure',{});}catch(_error){}prepare?.(w);
    const snap=()=>({air:cents(w.cash('air')),bank:cents(w.cash('bank')),debt:cents(w.F.book(state,'air').debt||0),loans:cents(state.bank.loans||0),facilities:Array.from(state.bank.corporateFacilities||[]).length,drawn:cents(state.bank.corporateClients?.air?.drawn||0),transfers:Array.from(state.finance.transfers).filter(row=>/^CF-/.test(String(row.id))).length,spent:cents(w.budget('air')?.spent||0)});
    // The dealership's floor plan (dealer-market-core): the owner's own call inside the day, a refused draw tolerated.
    const floorPlan=amount=>{let drawn=null,error=null;const day=w.slice('DAY',()=>{try{drawn=B.execute({state},'draw-facility',{ownerCompanyId:'air',amount,termDays:90,rate:.06});}catch(caught){error=String(caught?.message||caught);}return true;});return {day,drawn,error};};
    return {...w,B,snap,floorPlan};};
  const noRoom=w=>{w.command('finance','set-budget',{company:'air',limit:1000000,lines:{}});w.system('accrue-expense',{company:'air',amount:1500000,note:'مصروف يومي · فاتورة مورد آجلة',method:'فاتورة مورد آجلة',dueDay:7,number:'AIR-AP-0',paymentTerms:7,closeOwned:true},'financial-close');};
  const fee=Math.max(25000,5000000*.0035);
  const free=bankWorld(),before=free.snap(),control=free.floorPlan(5000000),after=free.snap();assert.equal(control.day.committed,true,control.day.reason);assert.equal(control.error,null,'1: with no ceiling the draw is not refused');
  assert.deepEqual({air:cents(after.air-before.air),bank:cents(after.bank-before.bank),debt:after.debt-before.debt,loans:after.loans-before.loans,facilities:after.facilities-before.facilities,drawn:after.drawn-before.drawn,transfers:after.transfers-before.transfers},{air:cents(5000000-fee),bank:cents(fee-5000000),debt:5000000,loans:5000000,facilities:1,drawn:5000000,transfers:1},'1: the control: cash, fee, loan and facility are booked');free.valid('1 control');
  const capped=bankWorld(noRoom);assert.equal(capped.F.remaining(capped.state,'air'),0,'1: the ceiling has no room');const start=capped.snap(),refused=capped.floorPlan(5000000);
  assert.equal(refused.day.committed,true,`1: the day commits: ${refused.day.reason}`);assert.equal(refused.error,'borrower-fee-budget','1: the draw is refused for its fee\'s budget');assert.deepEqual(capped.snap(),start,'1: nothing moved: no cash, no debt, no loan, no facility');capped.valid('1 refused');
  assert.throws(()=>capped.command('banking','draw-facility',{company:'air',amount:5000000}),/borrower-fee-budget/,'1: the player\'s own draw is refused with the same reason');assert.deepEqual(capped.snap(),start,'1: and moves nothing');
  const line=bankWorld(w=>w.command('finance','set-budget',{company:'air',limit:25000000,lines:{other:10000}})),lineStart=line.snap(),lineOut=line.floorPlan(5000000);assert.equal(lineOut.error,'borrower-fee-budget','1: a line\'s ceiling under the fee refuses the draw');assert.deepEqual(line.snap(),lineStart);
  const room=bankWorld(w=>w.command('finance','set-budget',{company:'air',limit:1000000,lines:{}})),roomStart=room.snap(),roomOut=room.floorPlan(5000000),roomEnd=room.snap();assert.equal(roomOut.error,null,'1: with room for the fee the draw goes through under a ceiling');
  assert.deepEqual({debt:roomEnd.debt-roomStart.debt,facilities:roomEnd.facilities-roomStart.facilities,spent:roomEnd.spent-roomStart.spent},{debt:5000000,facilities:1,spent:cents(fee)},'1: and its fee is counted in the budget');room.valid('1 room');
  const investor=bankWorld(noRoom);investor.state.godMoney=true;investor.state.infiniteMoney=true;assert.equal(investor.floorPlan(5000000).error,null,'1: investor mode is not bound by the ceiling, as before');}
console.log('1 ok: a draw whose fee the ceiling refuses moves nothing and is refused with its reason; with room or no ceiling it books as before');

// 2. The autopilot's payables step.
{const autopilot=(w,day)=>{const P=w.s.GH_COMPANY_AUTOPILOT,tried=new Set(),out={steps:0,failed:[],paid:[]};w.state.simSeconds=day*DAY+3600;
    for(let guard=0;guard<12;guard++){const step=P.next(w.state,'payables',{tried,F:w.F});if(!step)break;for(const key of step.keys)tried.add(key);out.steps++;
      // app.js runCompanyAutopilotStep: the whole step in one transaction; a failure rolls it back and the day goes on.
      try{const done=w.T.execute(w.state,{label:'company-autopilot:payables',apply:()=>step.commands.map(command=>w.D.dispatchSystem({state:w.state},command.domain,command.name,command.payload,{actor:P.ACTOR}).result)});if(!done.committed)throw new Error(done.reason||'rejected');out.paid.push(...step.commands.map(command=>command.payload.number));}catch(error){out.failed.push(String(error?.message||error));}}
    return out;},open=w=>Array.from(w.state.finance.payables).map(row=>String(row.number)).sort();
  const w=world(['company-autopilot-core']);w.command('finance','set-budget',{company:'air',limit:1000000,lines:{}});for(let i=1;i<=3;i++)accrued(w,`AIR-ACC-${i}`,300000);shortfall(w,'PAY-AIR-2026-01',400000);ordinary(w,'TOP-FC-1',1500000);
  const before=w.cash('air'),first=autopilot(w,2);assert.deepEqual(first.failed,[],'2: no step fails');assert.deepEqual(first.paid.slice().sort(),['AIR-ACC-1','AIR-ACC-2','AIR-ACC-3','PAY-AIR-2026-01'],'2: the accrued bills and the payroll shortfall are paid');
  assert.deepEqual(open(w),['TOP-FC-1'],'2: the payable the ceiling refuses is left open');assert.equal(cents(before-w.cash('air')),1300000,'2: each paid once');assert.equal(cents(w.budget('air').spent),1000000,'2: the budget ends at its ceiling');w.valid('2 first day');
  for(const day of [3,4]){const next=autopilot(w,day);assert.deepEqual({steps:next.steps,failed:next.failed},{steps:0,failed:[]},`2: day ${day}: nothing to try, nothing fails`);}
  assert.equal(cents(before-w.cash('air')),1300000,'2: nothing is paid twice');
  w.command('finance','set-budget',{company:'air',limit:25000000,lines:{}});const later=autopilot(w,5);assert.deepEqual(later.paid,['TOP-FC-1'],'2: with room the left payable is paid');assert.deepEqual(open(w),[]);w.valid('2 later');
  // What the earlier rows of one step take is counted.
  const two=world(['company-autopilot-core']);two.command('finance','set-budget',{company:'air',limit:1000000,lines:{}});ordinary(two,'TOP-A',600000);ordinary(two,'TOP-B',600000);const twoOut=autopilot(two,2);
  assert.deepEqual({failed:twoOut.failed,paid:twoOut.paid.length,open:open(two).length},{failed:[],paid:1,open:1},'2: of two 600K payables under 1M, one is paid and one is left');two.valid('2 two');
  const mixed=world(['company-autopilot-core']);mixed.command('finance','set-budget',{company:'air',limit:1000000,lines:{}});ordinary(mixed,'TOP-AFTER',400000);shortfall(mixed,'PAY-FIRST',800000);assert.equal(String(mixed.state.finance.payables[0].number),'PAY-FIRST','2: the payroll shortfall is read first (the list is newest first)');const mixedOut=autopilot(mixed,2);
  assert.deepEqual({failed:mixedOut.failed,paid:mixedOut.paid,open:open(mixed)},{failed:[],paid:['PAY-FIRST'],open:['TOP-AFTER']},'2: a payroll shortfall takes the room first; the payable after it is left');mixed.valid('2 mixed');
  // The same on a line: «fuel» 1M under a 25M total.
  const lined=world(['company-autopilot-core']);lined.command('finance','set-budget',{company:'air',limit:25000000,lines:{fuel:1000000}});ordinary(lined,'TOP-A',600000);ordinary(lined,'TOP-B',600000);const linedOut=autopilot(lined,2);
  assert.deepEqual({failed:linedOut.failed,paid:linedOut.paid.length,open:open(lined).length},{failed:[],paid:1,open:1},'2: of two 600K payables on a 1M line, one is paid and one is left');lined.valid('2 line');
  // Each company has its own room: the holding's payable is not counted against the airline's ceiling.
  const both=world(['company-autopilot-core']);both.command('finance','set-budget',{company:'air',limit:1000000,lines:{}});both.command('finance','set-budget',{company:'group',limit:1000000,lines:{}});ordinary(both,'TOP-AIR-1',600000);ordinary(both,'TOP-GROUP',600000,'group');ordinary(both,'TOP-AIR-2',600000);const bothOut=autopilot(both,2);
  assert.deepEqual({failed:bothOut.failed,paid:bothOut.paid.slice().sort(),open:open(both)},{failed:[],paid:['TOP-AIR-2','TOP-GROUP'],open:['TOP-AIR-1']},'2: one of the airline\'s two and the holding\'s one are paid');both.valid('2 two companies');
  // A payroll shortfall takes room only as far as its own line goes: 800K on a 100K payroll line leaves 900K of the total.
  const payrollLine=world(['company-autopilot-core']);payrollLine.command('finance','set-budget',{company:'air',limit:1000000,lines:{payroll:100000}});ordinary(payrollLine,'TOP-AFTER',600000);shortfall(payrollLine,'PAY-FIRST',800000);const payrollOut=autopilot(payrollLine,2);
  assert.deepEqual({failed:payrollOut.failed,paid:payrollOut.paid,open:open(payrollLine)},{failed:[],paid:['PAY-FIRST','TOP-AFTER'],open:[]},'2: the payable after it still fits');assert.equal(cents(payrollLine.budget('air').spent),700000,'2: 100K of payroll and the 600K payable are counted');payrollLine.valid('2 payroll line');
  // An obligation accrued when the month had no room reserved nothing and needs none: it is paid with less room than its
  // amount, and takes none of it.
  const unreserved=world(['company-autopilot-core']);ordinary(unreserved,'TOP-AFTER',600000);unreserved.command('finance','set-budget',{company:'air',limit:1000000,lines:{}});unreserved.command('finance','spend',{company:'air',amount:1000000,note:'شراء',method:'تحويل بنكي',taxable:false});
  accrued(unreserved,'ACC-FIRST',700000);unreserved.command('finance','set-budget',{company:'air',limit:1650000,lines:{}});assert.equal(unreserved.F.remaining(unreserved.state,'air'),650000,'2: 650K of room is left');
  {const invoice=unreserved.state.finance.invoices.find(row=>row.number==='ACC-FIRST');assert.deepEqual({obligation:invoice.budgetObligation===true,reserved:Number(invoice.budgetReserved)||0,first:String(unreserved.state.finance.payables[0].number)},{obligation:true,reserved:0,first:'ACC-FIRST'},'2: the accrued bill is an obligation that reserved nothing, read first');}
  const unreservedOut=autopilot(unreserved,2);assert.deepEqual({failed:unreservedOut.failed,paid:unreservedOut.paid,open:open(unreserved)},{failed:[],paid:['ACC-FIRST','TOP-AFTER'],open:[]},'2: both are paid: the obligation needs no room and leaves the 650K to the payable');unreserved.valid('2 unreserved');
  // An exact fit in cents after earlier spending: the plan and the settlement agree, no step fails.
  const exact=world(['company-autopilot-core']);exact.command('finance','set-budget',{company:'air',limit:1000000,lines:{}});exact.command('finance','spend',{company:'air',amount:33401.58,note:'شراء',method:'تحويل بنكي',taxable:false});ordinary(exact,'TOP-A',825482.18);ordinary(exact,'TOP-B',141116.24);
  for(const day of [2,3,4]){const out=autopilot(exact,day);assert.deepEqual(out.failed,[],`2: exact fit, day ${day}: no step fails`);}assert.ok(open(exact).length<=1&&exact.budget('air').spent<=1000000,'2: at least the first is paid and the budget is not passed');exact.valid('2 exact');
  // Cheques: two of one company in one step are not presented against the same cash or room (the second bounced).
  for(const limit of ['ceiling','line','cash']){const w=world(['company-autopilot-core']),P=w.s.GH_COMPANY_AUTOPILOT;if(limit==='ceiling')w.command('finance','set-budget',{company:'air',limit:1000000,lines:{}});else if(limit==='line')w.command('finance','set-budget',{company:'air',limit:25000000,lines:{fuel:1000000}});else w.command('finance','transfer',{from:'air',to:'group',amount:cents(w.cash('air')-1000000),note:'cash to the holding'});
    for(const number of ['CHQ-A','CHQ-B']){w.system('issue-invoice',{kind:'مصروف',company:'air',amount:600000,status:'مستحقة',taxable:false,method:'التزام عقد وقود',counterparty:'مورد وقود',note:`حد أدنى ملزم لعقد الوقود · ${number}`,number,dueDay:30,sourceRef:`TAKE-OR-PAY-${number}`},'simulation');w.command('finance','settle-payable',{number,method:'cheque'});}
    w.state.simSeconds=2*DAY+3600;const tried=new Set(),sizes=[];for(let guard=0;guard<6;guard++){const step=P.next(w.state,'cheques',{tried,F:w.F});if(!step)break;for(const key of step.keys)tried.add(key);sizes.push(step.commands.length);
      const done=w.T.execute(w.state,{label:'company-autopilot:cheques',apply:()=>step.commands.map(command=>w.D.dispatchSystem({state:w.state},command.domain,command.name,command.payload,{actor:P.ACTOR}).result)});assert.equal(done.committed,true,done.reason);}
    const statuses=Array.from(w.state.finance.cheques).map(row=>String(row.status)).sort();assert.deepEqual({sizes,statuses},{sizes:[1],statuses:['صادر','مصروف']},`2: two 600K cheques against 1M of ${limit}: one is cashed, the other waits; none bounces`);w.valid(`2 cheques ${limit}`);}
  {const w=world(['company-autopilot-core']),P=w.s.GH_COMPANY_AUTOPILOT;w.command('finance','set-budget',{company:'air',limit:1000000,lines:{}});for(const number of ['CHQ-A','CHQ-B']){w.system('issue-invoice',{kind:'مصروف',company:'air',amount:300000,status:'مستحقة',taxable:false,method:'التزام عقد وقود',counterparty:'مورد وقود',note:`حد أدنى ملزم لعقد الوقود · ${number}`,number,dueDay:30,sourceRef:`TAKE-OR-PAY-${number}`},'simulation');w.command('finance','settle-payable',{number,method:'cheque'});}
    w.state.simSeconds=2*DAY+3600;const tried=new Set();for(let guard=0;guard<6;guard++){const step=P.next(w.state,'cheques',{tried,F:w.F});if(!step)break;for(const key of step.keys)tried.add(key);w.T.execute(w.state,{label:'company-autopilot:cheques',apply:()=>step.commands.map(command=>w.D.dispatchSystem({state:w.state},command.domain,command.name,command.payload,{actor:P.ACTOR}).result)});}
    assert.deepEqual(Array.from(w.state.finance.cheques).map(row=>String(row.status)),['مصروف','مصروف'],'2: two 300K cheques both fit and are both cashed the same day');}
  // With no ceiling the cash's sum is counted over the whole step: of three 400K cheques against 1M, two are cashed together.
  {const w=world(['company-autopilot-core']),P=w.s.GH_COMPANY_AUTOPILOT;w.command('finance','transfer',{from:'air',to:'group',amount:cents(w.cash('air')-1000000),note:'cash to the holding'});
    for(const number of ['CHQ-A','CHQ-B','CHQ-C']){w.system('issue-invoice',{kind:'مصروف',company:'air',amount:400000,status:'مستحقة',taxable:false,method:'التزام عقد وقود',counterparty:'مورد وقود',note:`حد أدنى ملزم لعقد الوقود · ${number}`,number,dueDay:30,sourceRef:`TAKE-OR-PAY-${number}`},'simulation');w.command('finance','settle-payable',{number,method:'cheque'});}
    w.state.simSeconds=2*DAY+3600;const tried=new Set(),sizes=[];for(let guard=0;guard<6;guard++){const step=P.next(w.state,'cheques',{tried,F:w.F});if(!step)break;for(const key of step.keys)tried.add(key);sizes.push(step.commands.length);w.T.execute(w.state,{label:'company-autopilot:cheques',apply:()=>step.commands.map(command=>w.D.dispatchSystem({state:w.state},command.domain,command.name,command.payload,{actor:P.ACTOR}).result)});}
    assert.deepEqual({sizes,statuses:Array.from(w.state.finance.cheques).map(row=>String(row.status)).sort()},{sizes:[2],statuses:['صادر','مصروف','مصروف']},'2: two are cashed in one step, the third waits; none bounces');}
  // A payable read alone is read exactly as the settlement reads it: 400,000 against exactly 400,000 of cash is paid.
  {const w=world(['company-autopilot-core']);ordinary(w,'TOP-ALL',400000);w.command('finance','transfer',{from:'air',to:'group',amount:cents(w.cash('air')-400000),note:'cash to the holding'});assert.equal(w.cash('air'),400000);const out=autopilot(w,2);
    assert.deepEqual({failed:out.failed,paid:out.paid,open:open(w),cash:w.cash('air')},{failed:[],paid:['TOP-ALL'],open:[],cash:0},'2: a payable for exactly the cash is paid');}
  const none=world(['company-autopilot-core']);for(let i=1;i<=3;i++)accrued(none,`AIR-ACC-${i}`,300000);ordinary(none,'TOP-FC-1',1500000);const noneOut=autopilot(none,2);assert.deepEqual({failed:noneOut.failed,paid:noneOut.paid.length,open:open(none)},{failed:[],paid:4,open:[]},'2: with no ceiling everything due is paid, as before');}
console.log('2 ok: under a ceiling the autopilot pays what can be paid in one step and leaves the refused payable open; no step fails');

// 3. The reasons.
{const w=world(),B=(number,pending)=>w.F.payableTransferBlocker(w.state,number,pending);ordinary(w,'TOP-1',400000);shortfall(w,'PAY-1',200000);
  assert.equal(B('NO-SUCH'),'payable-not-found');for(const number of ['TOP-1','PAY-1'])assert.equal(B(number),null,`3: with no ceiling ${number} can be settled`);
  w.command('finance','set-budget',{company:'air',limit:500000,lines:{}});accrued(w,'ACC-1',300000);assert.equal(w.F.remaining(w.state,'air'),200000,'3: 300K of the 500K ceiling is reserved');
  assert.deepEqual([B('TOP-1'),B('ACC-1'),B('PAY-1')],['insufficient-budget',null,null],'3: only the unreserved payable is refused by the ceiling');
  {const lined=world();ordinary(lined,'TOP-L',400000);const line=lined.F.lineFor?lined.F.lineFor('حد أدنى ملزم لعقد الوقود · TOP-L','التزام عقد وقود'):'fuel';assert.equal(line,'fuel','3: the fuel bill is on the fuel line');
    lined.command('finance','set-budget',{company:'air',limit:25000000,lines:{fuel:100000}});assert.equal(lined.F.payableTransferBlocker(lined.state,'TOP-L'),'insufficient-budget','3: a line\'s ceiling refuses as the total does');
    assert.throws(()=>lined.system('settle-payable',{number:'TOP-L',method:'transfer'},'company-autopilot'),/insufficient-budget/);lined.command('finance','set-budget',{company:'air',limit:25000000,lines:{fuel:1000000}});assert.equal(lined.F.payableTransferBlocker(lined.state,'TOP-L'),null,'3: and passes with room on the line');}
  w.command('finance','set-budget',{company:'air',limit:25000000,lines:{}});const pending={};assert.equal(B('TOP-1',pending),null);assert.equal(cents(pending.air.cash),400000,'3: a batch counts the cash its rows take');assert.equal(cents(pending.air.room),400000,'3: and the room');
  w.command('finance','settle-payable',{number:'TOP-1',method:'cheque'});assert.equal(B('TOP-1'),'payable-cheque-pending','3: a cheque in issue');
  const all=w.cash('air');ordinary(w,'TOP-BIG',all+1);assert.equal(B('TOP-BIG'),'insufficient-cash','3: more than the cash');
  w.command('finance','set-budget',{company:'air',limit:1000000,lines:{}});ordinary(w,'TOP-2',2000000);assert.equal(B('TOP-2'),'insufficient-budget');w.state.godMoney=true;w.state.infiniteMoney=true;assert.equal(B('TOP-2'),null,'3: investor mode is not bound');assert.equal(B('TOP-BIG'),null);
  // The reason is the settlement's own: what the blocker passes settles, what it refuses is refused.
  w.state.godMoney=false;w.state.infiniteMoney=false;assert.throws(()=>w.system('settle-payable',{number:'TOP-2',method:'transfer'},'company-autopilot'),/insufficient-budget/,'3: the settlement refuses what the blocker refuses');
  assert.equal(B('ACC-1'),null);assert.equal(w.slice('SETTLE',()=>w.system('settle-payable',{number:'ACC-1',method:'transfer'},'company-autopilot')).committed,true,'3: and settles what it passes');}
console.log('3 ok: the reasons a transfer cannot settle a payable are the settlement\'s own');
console.log('build670 ceiling refusals: 3 checks passed');
