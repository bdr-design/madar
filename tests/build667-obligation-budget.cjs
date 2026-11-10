'use strict';
// Build 667, found by a review of the play-through and reproduced with the game's own commands: a monthly budget ceiling
// set on the budgets page (the lowest offered is 1M) stopped the clock.
//   a. Payroll (the 27th) checks cash only and then counted its whole amount against the budget: a company whose ceiling
//      was under its payroll ended over its ceiling, a state the save schema («budget») and the integrity check
//      (FINANCE_BUDGET_EXCEEDED) refuse: the day was rolled back at every attempt.
//   b. The holding's and a company's daily running cost are paid by the close through the ordinary «spend», which the
//      ceiling refuses once it is used up (insufficient-funds-or-budget), uncaught: a holding with a 1M ceiling stopped on
//      day 24 with 499M in cash.
// An obligation the close pays is not a discretionary spend: the ceiling does not refuse it, and it counts against the
// month's budget only as far as the room goes, as an accrued obligation is reserved (the rest is outside the budget).
// Checked here with real commands, each inside a simulation slice with the schema and integrity checks due:
//   1. payroll of 2M under a 1M ceiling is paid in full from cash; the budget ends at its ceiling, not over; the slice
//      commits and the state is valid;
//   2. thirty days of the holding's daily cost under a 1M ceiling all commit; the cost is paid in full each day;
//   3. the ceiling still binds what the player decides: a discretionary spend past the room is refused as before, and a
//      «spend» that only claims to be an obligation (not the close's own) is refused too; cash still limits an obligation;
//   4. with no ceiling, or inside it, the budget counts the whole amount as before; investor mode is unchanged.
//   5. the room an obligation may count: a payroll shortfall accrued on the 27th and settled later (settle-payable) is
//      paid in full and counts up to the ceiling; a line's ceiling («other», payroll) bounds the count as the total does;
//      room reserved by an accrued bill is left to it; the next budget month gives the room back;
//   6. the close's own helper, read from app.js and run as written: thirty daily costs of the holding under a 1M ceiling
//      all commit; and only the close may claim an obligation: the same payload from the player, or from another system
//      actor, is an ordinary spend the ceiling refuses;
//   7. (review) the yearly upkeep of a sustainability programme is a programme's spend, which the ceiling governs: under
//      a ceiling (the total's or the «other» line's) it lapses as it does without cash and the day commits; it is tried
//      again the next day and paid at the first attempt with room (without cash, in 30 days).
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||require('node:path').resolve(__dirname,'..');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {scenario}=require('./helpers/business-scenario');
const cents=value=>Math.round(Number(value)*100)/100;
function world(){const sc=scenario(),{s,state,command}=sc,T=s.GH_TRANSACTION_CORE,C=s.GH_CONTROL_PLANE,F=s.GH_FINANCE_CORE,D=s.GH_DOMAIN_COMMANDS,I=s.GH_INTEGRITY_CORE;
  // A simulation slice as app.js runs one: the change, then the hourly cycle's command with the schema and integrity checks.
  const slice=(name,change)=>{try{const out=T.execute(state,{label:`simulation:${name}`,apply:()=>{const value=change();C.execute(state,{name:'MARKET_HOURLY_CYCLE',domain:'market',actor:'simulation-market',correlationId:name},()=>true,{atomic:false,integrity:true,schema:true,deferIntegrityToTransaction:true});return value;}});return {committed:out.committed===true,reason:String(out.reason||''),value:out.value};}catch(error){return {committed:false,reason:String(error?.message||error)};}};
  const system=(name,payload,actor)=>D.dispatchSystem({state},'finance',name,payload,{actor}).result,budget=company=>state.companyBudgets[company],cash=company=>F.operating(state,company);
  const valid=label=>{const out=s.GH_SAVE_SCHEMA.validate(state);assert.ok(out.ok,`${label}: ${JSON.stringify(out.errors)}`);assert.deepEqual(Array.from(I.check(state).issues).filter(row=>row.severity==='critical').map(row=>String(row.id)),[],`${label}: no critical issue`);};
  return {s,state,command,slice,system,budget,cash,valid,F,D,load:sc.load};}
const payroll=(w,company,amount,report)=>w.slice(`PAYROLL-${report}`,()=>w.system('pay-payroll',{company,amount,note:'مسير رواتب',reportId:report},'payroll-scheduler'));
const dailyCost=(w,company,amount,day)=>w.slice(`DAY-${day}`,()=>w.system('spend',{company,amount,note:'إقفال يومي الشركة القابضة · إدارة وامتثال',method:'قيد يومي',taxable:false,closeOwned:true,obligation:true},'financial-close'));

// 1. Payroll over the ceiling.
{const w=world();w.command('finance','set-budget',{company:'air',limit:1000000,lines:{}});const before=w.cash('air');assert.ok(before>=2000000,'the airline has the cash');
  const out=payroll(w,'air',2000000,'PAYROLL-2026-01');assert.equal(out.committed,true,`1: ${out.reason}`);
  assert.equal(cents(before-w.cash('air')),2000000,'1: the payroll is paid in full');assert.equal(cents(w.budget('air').spent),1000000,'1: the budget ends at its ceiling');assert.ok(w.budget('air').investorOverrun!==true);w.valid('1');
  // The same payroll again is the same payroll (idempotent), and a second month's payroll still goes through.
  const again=payroll(w,'air',2000000,'PAYROLL-2026-01');assert.equal(again.committed,true,again.reason);assert.equal(cents(before-w.cash('air')),2000000,'1: not paid twice');
  const next=payroll(w,'air',500000,'PAYROLL-2026-02');assert.equal(next.committed,true,next.reason);assert.equal(cents(w.budget('air').spent),1000000);w.valid('1 again');}
console.log('1 ok: payroll of 2M under a 1M ceiling is paid, the budget ends at its ceiling and the day commits');

// 2. The holding's daily cost under a used-up ceiling.
{const w=world();w.command('finance','set-budget',{company:'group',limit:1000000,lines:{}});const before=w.cash('group');
  for(let day=1;day<=30;day++){const out=dailyCost(w,'group',42500,day);assert.equal(out.committed,true,`2: day ${day}: ${out.reason}`);}
  assert.equal(cents(before-w.cash('group')),30*42500,'2: the cost is paid in full every day');assert.equal(cents(w.budget('group').spent),1000000,'2: the budget ends at its ceiling');w.valid('2');}
console.log('2 ok: thirty daily costs of the holding under a 1M ceiling all commit');

// 3. What the ceiling still refuses, and what cash still limits.
{const w=world();w.command('finance','set-budget',{company:'air',limit:1000000,lines:{}});
  const spendAs=(payload,actor)=>{try{return {ok:true,value:w.system('spend',{company:'air',note:'شراء اختياري',method:'تحويل بنكي',taxable:false,...payload},actor)};}catch(error){return {ok:false,reason:String(error?.message||error)};}};
  assert.deepEqual(spendAs({amount:1500000},'financial-close'),{ok:false,reason:'insufficient-funds-or-budget'},'3: a spend past the room is refused');
  assert.deepEqual(spendAs({amount:1500000,obligation:true},'financial-close'),{ok:false,reason:'insufficient-funds-or-budget'},'3: claiming an obligation without being the close\'s own entry changes nothing');
  assert.deepEqual(spendAs({amount:1500000,closeOwned:true},'financial-close'),{ok:false,reason:'insufficient-funds-or-budget'},'3: nor does being the close\'s own entry without being an obligation');
  assert.equal(spendAs({amount:400000},'financial-close').ok,true,'3: a spend inside the room goes through');assert.equal(cents(w.budget('air').spent),400000);
  const all=w.cash('air');assert.deepEqual(spendAs({amount:all+1,closeOwned:true,obligation:true},'financial-close'),{ok:false,reason:'insufficient-funds-or-budget'},'3: an obligation larger than the cash is refused');
  assert.throws(()=>w.system('pay-payroll',{company:'air',amount:all+1,note:'مسير رواتب',reportId:'PAYROLL-TOO-MUCH'},'payroll-scheduler'),/insufficient-payroll-cash/,'3: payroll larger than the cash is refused');w.valid('3');}
console.log('3 ok: the ceiling still refuses a discretionary spend, and cash still limits an obligation');

// 4. No ceiling, inside the ceiling, and investor mode: as before.
{const w=world();const out=payroll(w,'air',2000000,'PAYROLL-NO-CEILING');assert.equal(out.committed,true,out.reason);assert.equal(cents(w.budget('air')?.spent||0),0,'4: with no ceiling nothing is counted (as before)');
  w.command('finance','set-budget',{company:'air',limit:5000000,lines:{}});const inside=payroll(w,'air',2000000,'PAYROLL-INSIDE');assert.equal(inside.committed,true,inside.reason);assert.equal(cents(w.budget('air').spent),2000000,'4: inside the ceiling the whole amount is counted');w.valid('4');}
{const w=world();w.state.godMoney=true;w.state.infiniteMoney=true;assert.equal(w.F.investorMode(w.state),true);w.command('finance','set-budget',{company:'air',limit:1000000,lines:{}});
  const out=payroll(w,'air',2000000,'PAYROLL-INVESTOR');assert.equal(out.committed,true,out.reason);assert.equal(cents(w.budget('air').spent),2000000,'4: investor mode spends past the ceiling');assert.equal(w.budget('air').investorOverrun,true,'4: and the budget records that it did');}
console.log('4 ok: no ceiling, inside the ceiling and investor mode are unchanged');

// 5. The room an obligation may count.
const DAY=86400;
{const w=world(),{state}=w,number='PAY-AIR-2026-01',reportId='PAYROLL-2026-01';w.command('finance','set-budget',{company:'air',limit:1000000,lines:{}});
  // The shortfall as the close makes and settles it: accrue-payroll and the month's report, then settle-payable at a later close.
  const accrued=w.slice('ACCRUE',()=>{const doc=w.system('accrue-payroll',{company:'air',amount:2000000,note:'رواتب مستحقة يوم 27 · Test Air',number,dueDay:26,reportId},'payroll-scheduler');
    w.system('record-payroll-report',{report:{id:reportId,day:26,month:'يناير 2026',monthKey:'2026-01',calendarDate:'2026-01-27',lines:[{company:'air',companyName:'Test Air',amount:2000000,paid:0,due:2000000,autoFunding:0,paymentRef:null,dueRef:doc.number,headcount:10}]}},'payroll-scheduler');return doc.number;});
  assert.equal(accrued.committed,true,`5: the accrual: ${accrued.reason}`);assert.equal(cents(w.budget('air').spent),0,'5: an accrued payroll shortfall counts nothing yet');
  const before=w.cash('air');state.simSeconds+=DAY;const out=w.slice('SETTLE',()=>w.system('settle-payable',{number},'payroll-scheduler'));assert.equal(out.committed,true,`5: the settlement: ${out.reason}`);
  assert.equal(cents(before-w.cash('air')),2000000,'5: the shortfall is paid in full');assert.equal(cents(w.budget('air').spent),1000000,'5: the budget ends at its ceiling');assert.equal(cents(w.budget('air').spentByLine.payroll),1000000,'5: on the payroll line');
  assert.equal(state.finance.payables.some(row=>row.number===number),false,'5: the payable is closed');assert.equal(state.finance.invoices.find(row=>row.number===number).status,'مسددة','5: the invoice is settled');
  const report=state.finance.payrollReports.find(row=>row.id===reportId);assert.equal(cents(report.due),0,'5: the report owes nothing');w.valid('5 shortfall');
  assert.throws(()=>w.system('settle-payable',{number},'payroll-scheduler'),/payable-not-found/,'5: it is not paid twice');assert.equal(cents(before-w.cash('air')),2000000);}
{const w=world();w.command('finance','set-budget',{company:'group',limit:25000000,lines:{other:100000}});const before=w.cash('group');
  for(let day=1;day<=5;day++){const out=dailyCost(w,'group',42500,day);assert.equal(out.committed,true,`5: line, day ${day}: ${out.reason}`);}
  assert.equal(cents(before-w.cash('group')),5*42500,'5: under a line\'s ceiling the cost is paid in full');assert.equal(cents(w.budget('group').spentByLine.other),100000,'5: the line ends at its ceiling');assert.equal(cents(w.budget('group').spent),100000,'5: the total counts what the line counted');w.valid('5 line');}
{const w=world();w.command('finance','set-budget',{company:'air',limit:25000000,lines:{payroll:600000}});const out=payroll(w,'air',2000000,'PAYROLL-LINE');assert.equal(out.committed,true,out.reason);
  assert.equal(cents(w.budget('air').spentByLine.payroll),600000,'5: a payroll line ends at its ceiling');assert.equal(cents(w.budget('air').spent),600000);w.valid('5 payroll line');}
{const w=world();w.command('finance','set-budget',{company:'air',limit:1000000,lines:{}});
  w.system('accrue-expense',{company:'air',amount:700000,note:'مصروف يومي · فاتورة مورد آجلة (عقود/منشآت/إيجارات)',method:'فاتورة مورد آجلة',dueDay:7,number:'AIR-AP-0',expenseAccount:'مصروف تشغيلي',taxable:false,paymentTerms:7,counterparty:'موردو الطيران المعتمدون',closeOwned:true},'financial-close');
  assert.equal(cents(w.budget('air').reserved),700000,'5: an accrued bill reserves its room');const out=payroll(w,'air',2000000,'PAYROLL-RESERVED');assert.equal(out.committed,true,out.reason);
  assert.equal(cents(w.budget('air').spent),300000,'5: payroll counts only the room left');assert.equal(cents(w.budget('air').reserved),700000,'5: the reservation is untouched');w.valid('5 reserved');
  w.state.simSeconds=7*DAY+60;const due=w.slice('DUE',()=>w.system('settle-due-terms',{day:7,company:'air',maxRows:8},'financial-close'));assert.equal(due.committed,true,due.reason);assert.equal(due.value.paid,1,'5: the accrued bill is paid on its day');
  assert.equal(cents(w.budget('air').spent),1000000,'5: its reservation becomes spent, at the ceiling');assert.equal(cents(w.budget('air').reserved),0);w.valid('5 due');}
{const w=world();w.command('finance','set-budget',{company:'air',limit:1000000,lines:{}});assert.equal(payroll(w,'air',2000000,'PAYROLL-M1').committed,true);
  w.state.simSeconds+=30*DAY;const out=payroll(w,'air',400000,'PAYROLL-M2');assert.equal(out.committed,true,out.reason);assert.equal(w.budget('air').period,1,'5: a new budget month');assert.equal(cents(w.budget('air').spent),400000,'5: which counts from nothing');w.valid('5 month');}
console.log('5 ok: a settled payroll shortfall, a line\'s ceiling, reserved room and the month\'s roll-over count as far as the room goes');

// 6. The close's own helper, from app.js as written.
{const app=fs.readFileSync(path.join(process.env.GH_TEST_SOURCE_DIR,'WebApp','app.js'),'utf8'),start=app.indexOf('  function spendCompanySystem(');assert.ok(start>=0,'6: app.js has the close\'s spend helper');
  const source=app.slice(start,app.indexOf('\n',start)),w=world(),{state}=w,calls=[];
  const dispatchSystemCommand=(context,domain,name,payload,options)=>{calls.push({domain,name,actor:options?.actor});return w.D.dispatchSystem(context,domain,name,payload,options);},validMoney=value=>Number.isFinite(value)&&value>0;
  const spendCompanySystem=new Function('state','dispatchSystemCommand','validMoney',`${source}\nreturn spendCompanySystem;`)(state,dispatchSystemCommand,validMoney);
  w.command('finance','set-budget',{company:'group',limit:1000000,lines:{}});const before=w.cash('group');
  for(let day=1;day<=30;day++){const out=w.slice(`CLOSE-${day}`,()=>spendCompanySystem('group',42500,'إقفال يومي الشركة القابضة · إدارة وامتثال','قيد يومي',false));assert.equal(out.committed,true,`6: day ${day}: ${out.reason}`);assert.equal(out.value,true);}
  assert.equal(cents(before-w.cash('group')),30*42500,'6: the close\'s helper pays the cost in full every day');assert.equal(cents(w.budget('group').spent),1000000,'6: the budget ends at its ceiling');
  assert.deepEqual([...new Set(calls.map(row=>`${row.domain}:${row.name}:${row.actor}`))],['finance:spend:financial-close'],'6: as the financial close');w.valid('6 helper');}
{const w=world();w.command('finance','set-budget',{company:'air',limit:1000000,lines:{}});const payload={company:'air',amount:1500000,note:'شراء',method:'تحويل بنكي',taxable:false,closeOwned:true,obligation:true},before=w.cash('air');
  assert.throws(()=>w.command('finance','spend',payload),/insufficient-funds-or-budget/,'6: the player cannot claim an obligation');
  assert.throws(()=>w.D.dispatch({state:w.state},'finance','spend',payload,{actor:'financial-close'}),/insufficient-funds-or-budget/,'6: nor a plain dispatch that names the close');
  for(const actor of ['company-autopilot','payroll-scheduler','simulation-scheduler'])assert.throws(()=>w.system('spend',payload,actor),/insufficient-funds-or-budget|not-authorized|unauthor|forbidden|denied/i,`6: nor can ${actor}`);
  assert.equal(w.cash('air'),before,'6: nothing was spent');assert.equal(cents(w.budget('air').spent),0);
  assert.equal(w.slice('CLOSE',()=>w.system('spend',payload,'financial-close')).committed,true,'6: the close can');assert.equal(cents(before-w.cash('air')),1500000);assert.equal(cents(w.budget('air').spent),1000000);w.valid('6 actor');}
console.log('6 ok: the close\'s helper of app.js pays thirty daily costs under a 1M ceiling; only the close may claim an obligation');

// 7. The yearly upkeep of a sustainability programme under a ceiling (the day's real owner: GH_REALISM.onDay).
{const upkeep=limit=>{const w=world(),{s,state}=w;w.load('governance-core');w.command('governance','esg-program',{id:'saf'});state.simSeconds+=40*DAY;if(limit)w.command('finance','set-budget',{company:'air',limit,lines:{}});
    const program=()=>state.sustainability.programs.saf,due=program().nextUpkeepDay,amount=Math.round(program().cost*.1),day=at=>{state.simSeconds=at*DAY+3600;return w.slice(`REALISM-DAY-${at}`,()=>s.GH_REALISM.onDay(state,at));};
    return {w,state,program,due,amount,day};};
  const free=upkeep(0);assert.ok(free.amount>=500000,'7: the upkeep is a real amount');let cash=free.w.cash('air');assert.equal(free.day(free.due-1).committed,true);assert.equal(free.program().upkeepPaid||0,0,'7: nothing before its day');
  cash=free.w.cash('air');const paid=free.day(free.due);assert.equal(paid.committed,true,paid.reason);assert.equal(free.program().upkeepPaid,free.amount,'7: with no ceiling the upkeep is paid on its day');assert.equal(free.program().lapsed,false);assert.equal(free.program().nextUpkeepDay,free.due+365,'7: and is due a year later');
  const capped=upkeep(1000000);assert.ok(capped.amount>1000000,'7: the upkeep is over the 1M ceiling');cash=capped.w.cash('air');assert.ok(cash>capped.amount,'7: the airline has the cash');
  for(const at of [capped.due-1,capped.due,capped.due+1]){const out=capped.day(at);assert.equal(out.committed,true,`7: day ${at} under the ceiling: ${out.reason}`);}
  assert.deepEqual({paid:capped.program().upkeepPaid||0,lapsed:capped.program().lapsed,next:capped.program().nextUpkeepDay,spent:cents(capped.w.budget('air').spent)},{paid:0,lapsed:true,next:capped.due+2,spent:0},'7: refused by the ceiling, the programme lapses and is tried again every next day');capped.w.valid('7 lapsed');
  capped.w.command('finance','set-budget',{company:'air',limit:25000000,lines:{}});const retry=capped.day(capped.due+2);assert.equal(retry.committed,true,retry.reason);
  assert.deepEqual({paid:capped.program().upkeepPaid,lapsed:capped.program().lapsed,spent:cents(capped.w.budget('air').spent)},{paid:capped.amount,lapsed:false,spent:capped.amount},'7: with room it is paid at the next attempt and counted in the budget');capped.w.valid('7 paid');
  // A line's ceiling: «other» 1M under a 25M total.
  const lined=upkeep(0);lined.w.command('finance','set-budget',{company:'air',limit:25000000,lines:{other:1000000}});const line=lined.day(lined.due);assert.equal(line.committed,true,`7: under a line's ceiling: ${line.reason}`);
  assert.deepEqual({paid:lined.program().upkeepPaid||0,lapsed:lined.program().lapsed,next:lined.program().nextUpkeepDay},{paid:0,lapsed:true,next:lined.due+1},'7: the «other» line refuses it as the total does');
  // Without the cash it waits 30 days, as before.
  const poor=upkeep(0);poor.w.command('finance','transfer',{from:'air',to:'group',amount:cents(poor.w.cash('air')-1000),note:'cash to the holding'});const short=poor.day(poor.due);assert.equal(short.committed,true,short.reason);
  assert.deepEqual({paid:poor.program().upkeepPaid||0,lapsed:poor.program().lapsed,next:poor.program().nextUpkeepDay},{paid:0,lapsed:true,next:poor.due+30},'7: without the cash it lapses and is tried again in 30 days');}
console.log('7 ok: a programme\'s yearly upkeep the ceiling refuses lapses and the day commits; it is paid at the first attempt with room');
console.log('build667 obligation budget: 7 checks passed');
