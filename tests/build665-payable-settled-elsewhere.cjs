'use strict';
// Build 665, found by a review of the play-through and reproduced with the game's own commands: two owners issue an
// ordinary payable when their company is short of cash and later settle it themselves, tolerating only «no cash» and «no
// budget». The company autopilot (it pays every due payable once the company can, every game day, at every level) or the
// player paid it first; the owner's settle-payable then threw payable-not-found, the daily close failed
// (financial-day-owner-failed), was rolled back, and failed again at every attempt: the clock could not pass that day.
//   - the energy company's monthly interest on a financed plant (energy-core settleOperatingInterest): unattended, a
//     financed solar plant stopped on game day 154;
//   - the hotel's external service bill, every 15th (hospitality-links-core settle).
// An invoice already settled is recorded by its owner as settled, with no second payment; one with a cheque in issue
// waits for its cheque. Checked here with real commands (the autopilot's own planned step, the player's settle-payable):
//   1. energy: the autopilot pays the open interest invoice; the next closes go on, the invoice is paid exactly once, the
//      period is recorded once and the next one is invoiced a month later;
//   2. energy: the same when the player pays it, also once the settled invoice is archived; a cheque in issue is waited
//      for, then recorded; the financing and the cash end exactly as when the owner pays its own invoice (the control);
//   3. hotel: the player or the autopilot pays the service bill; the next closes go on, one payment, the service account
//      is settled and the service runs; a cheque is waited for; with no other payer the hotel pays as before.
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||require('node:path').resolve(__dirname,'..');
const assert=require('node:assert/strict');
const {harness,minimal}=require('./helpers/core-harness'),{hospitalityFixture}=require('./helpers/hospitality-fixture.cjs');
const DAY=86400,cents=value=>Math.round(Number(value)*100)/100,text=error=>String(error?.message||error);
const closes=(world,days)=>{for(const day of days){const out=world.dayClose(day);assert.equal(out.committed,true,`day ${day}: ${out.reason}`);}};
const refused=(world,day)=>{try{const out=world.dayClose(day);return out.committed?null:String(out.reason);}catch(error){return text(error);}};

// ---- the energy company: one commissioned gas plant, financed through the real finance-project command ----
const ENERGY=['capability-registry-core','company-definitions','company-platform-core','identity-system','control-plane-core','authorization-core','document-proof-core','transaction-core','domain-command-core','save-schema','determinism-core','event-ledger-core','dependency-core','policy-core','lifecycle-core','delivery-monitor-core','realism-core','finance-core','branch-campaign-core','hr-core','corporate-core','facility-core','business-world-core','banking-core','insurance-core','energy-core','realestate-core','economics-core','game-lifecycle-core','company-adapters-core','company-autopilot-core','strategy-core','conference-core','operations-core','advanced-core'];
function plant(){
  const {s}=harness(ENERGY),data={...minimal(),profile:{name:'Plant Interest'},bank:{},operations:{},crew:[],branches:[],hired:[],unlockedSectors:[],ownedCompanies:[]},state=s.GH_GAME_LIFECYCLE.pristine(data,1);
  s.GH_GAME_LIFECYCLE.foundGroup(state,{mode:'sandbox',name:'Plant Group',founder:'Founder',locationId:'RUH'},data,{nextId:()=>'FOUND-PF',simYear:()=>2026});s.GH_ADVANCED.migrate(state);
  const D=s.GH_DOMAIN_COMMANDS,F=s.GH_FINANCE_CORE,P=s.GH_COMPANY_AUTOPILOT,TX=s.GH_TRANSACTION_CORE;
  const player=(domain,name,payload)=>D.dispatch({state},domain,name,payload).result,system=(domain,name,payload,actor)=>D.dispatchSystem({state},domain,name,payload,{actor}).result;
  player('corporate','open-company',{type:'power',capital:400000000,legalName:'Plant Power'});
  // The plant itself is the one hand-made row (as tests/build545 makes it): building one takes 180 game days of set-up.
  state.customHubs.push({id:'PWR-GAS-PF',name:'Gas PF',city:'الرياض',country:'السعودية',kind:'power',company:'power',ownerCompanyId:'power',owned:true,energyKind:'gas',capacityAmount:100,capacity:'100 MW',commissioned:true,openedAt:0,dailyCost:38000,cost:200000000});
  state.simSeconds=100*DAY;s.GH_REALISM.migrate(state).economy.gas=50;s.GH_REALISM.migrate(state).economy.baseRate=.05;state.profile.creditRating='BBB';
  const site=s.GH_ENERGY_CORE.ensure(state).sites.find(row=>row.facilityId==='PWR-GAS-PF');site.commissionedDay=0;
  const financed=player('energy','finance-project',{siteId:site.id,amount:100000000}),facility=()=>state.energy.projectFinance.find(row=>row.id===financed.id),cash=()=>F.operating(state,'power');
  const tick=day=>{state.simSeconds=day*DAY;return system('energy','tick-day',{day,ownerCompanyId:'power'},'simulation-scheduler');};
  // The daily close's owner loop (advanced-core), in one transaction as app.js runs it: a failure rolls the day back.
  const dayClose=day=>TX.execute(state,{label:`day-close:${day}`,apply(){state.simSeconds=day*DAY;const stages=s.GH_ADVANCED.onFinancialDayStages(state,day);let step;while(!(step=stages.next()).done){}return step.value;}});
  const autopilot=()=>{const step=P.next(state,'payables',{tried:new Set(),F});return step?Array.from(step.commands,command=>({command,result:system(command.domain,command.name,command.payload,P.ACTOR)})):[];};
  const invoices=()=>Array.from(state.finance.invoices).filter(row=>String(row.number).startsWith('PFINT-'));
  // The due day with too little cash: the company's cash is moved to the holding by a real transfer the day before.
  const due=Number(facility().nextInterestDueDay);for(let day=101;day<due;day++)tick(day);
  const expected=facility().operatingInterestAccrued+facility().outstanding*facility().rate/365;player('finance','transfer',{from:'power',to:'group',amount:cents(cash()-Math.floor(expected/2)),note:'cash to the holding'});
  const report=tick(due),number=facility().interestInvoiceNumber,amount=facility().interestInvoiceAmount;
  assert.ok(number&&amount>0&&report.postCommissionInterestPaid===0,'the interest invoice is issued and left open');assert.ok(state.finance.payables.some(row=>row.number===number&&row.autoSettle!==true),'as an ordinary payable');
  const fund=value=>player('finance','transfer',{from:'group',to:'power',amount:value,note:'funding'});
  return {s,state,F,player,system,facility,cash,tick,dayClose,autopilot,invoices,due,number,amount,fund};
}
// What the owner holds for the financing and the company's cash: equal, whoever settled the invoice (the history's
// reference names the payment, so it is left out).
const position=world=>{const f=world.facility();return {outstanding:cents(f.outstanding),accrued:cents(f.operatingInterestAccrued),arrears:cents(f.interestArrears),nextDue:Number(f.nextInterestDueDay),open:f.interestInvoiceNumber,openAmount:cents(f.interestInvoiceAmount),status:f.status,periods:Array.from(f.interestSettlementHistory||[],row=>[row.invoiceNumber,cents(row.amount),row.periodId]),cash:cents(world.cash())};};
// The control: with no other payer the owner pays its own invoice at the next close. Its position after three closes.
const control=(()=>{const world=plant();world.fund(2000000);const before=world.cash();closes(world,[world.due+1]);assert.ok(before-world.cash()>=world.amount-1e-6,'control: the owner pays its own invoice');closes(world,[world.due+2,world.due+3]);return position(world);})();
const settledOnce=(world,label)=>{const facility=world.facility(),history=Array.from(facility.interestSettlementHistory||[]),rows=world.invoices();
  assert.equal(facility.interestInvoiceNumber,null,`${label}: the owner holds no open invoice`);assert.equal(facility.interestArrears,0,`${label}: no arrears`);
  assert.deepEqual(history.map(row=>[row.invoiceNumber,cents(row.amount)]),[[world.number,cents(world.amount)]],`${label}: the period is recorded once`);
  assert.deepEqual(rows.filter(row=>row.number===world.number).map(row=>row.status),['مسددة'],`${label}: the invoice is settled`);assert.equal(Number(facility.nextInterestDueDay),world.due+30,`${label}: the next period is due a month later`);
  assert.ok(!world.state.finance.payables.some(row=>row.number===world.number),`${label}: no payable is left`);};

// 1. The autopilot pays first.
{const world=plant();world.fund(2000000);const cashBefore=world.cash(),steps=world.autopilot();
  assert.deepEqual(steps.map(row=>[row.command.name,row.command.payload.number]),[['settle-payable',world.number]],'1: the autopilot takes the open interest invoice');assert.equal(cents(cashBefore-world.cash()),cents(world.amount),'1: and pays it');
  const afterAutopilot=world.cash();closes(world,[world.due+1,world.due+2,world.due+3]);settledOnce(world,'1');
  assert.deepEqual(position(world),control,'1: the financing and the cash are what they are when the owner pays its own invoice');
  assert.ok(world.cash()<=afterAutopilot+1e-6&&afterAutopilot-world.cash()<world.amount/2,'1: the owner pays no second time (only its daily costs move the cash)');
  // A month later the next period is invoiced and, with cash, paid by its owner.
  for(let day=world.due+4;day<=world.due+30;day++)world.tick(day);const second=Array.from(world.facility().interestSettlementHistory);
  assert.equal(second.length,2,'1: the next period is settled by the owner');assert.notEqual(second[0].invoiceNumber,world.number);assert.equal(world.facility().interestInvoiceNumber,null);
  assert.ok(second[0].amount>world.amount*.8&&second[0].amount<world.amount*1.2,`1: the next period's interest is one month's (${cents(second[0].amount)} after ${cents(world.amount)}), not the settled month's again`);}
console.log('1 ok: energy, the autopilot paid the interest invoice: the closes go on and it is paid once');

// 2. The player pays first; a cheque is waited for; the control.
{const world=plant();world.fund(2000000);const paid=world.player('finance','settle-payable',{number:world.number,method:'transfer'});assert.equal(cents(paid.amount),cents(world.amount));
  closes(world,[world.due+1,world.due+2,world.due+3]);settledOnce(world,'2 player');assert.deepEqual(position(world),control,'2: the same position as the control');}
// The settled invoice already moved to the audit archive (the daily compaction moves settled invoices past its live rows).
{const world=plant();world.fund(2000000);world.player('finance','settle-payable',{number:world.number,method:'transfer'});
  const finance=world.state.finance,row=finance.invoices.find(item=>item.number===world.number);finance.invoices=finance.invoices.filter(item=>item!==row);finance.auditArchive=finance.auditArchive||{records:{},digests:[]};finance.auditArchive.records.invoices=[...(finance.auditArchive.records.invoices||[]),row];
  closes(world,[world.due+1,world.due+2,world.due+3]);assert.equal(world.facility().interestInvoiceNumber,null,'2: an archived settled invoice is recorded too');assert.deepEqual({...position(world)},control,'2: with the same position');}
{const world=plant();world.fund(2000000);const cheque=world.player('finance','settle-payable',{number:world.number,method:'cheque'});assert.ok(cheque.chequeId,'2: the player issues a cheque for it');
  assert.ok(Array.from(world.state.finance.cheques).some(row=>row.invoiceNumber===world.number&&row.status==='صادر'));
  closes(world,[world.due+1]);assert.equal(world.facility().interestInvoiceNumber,world.number,'2: while the cheque is in issue the owner waits');
  world.system('finance','settle-cheque',{id:cheque.chequeId},'finance-scheduler'); // the close cashes a due cheque (app.js financialDayStages)
  closes(world,[world.due+2,world.due+3]);settledOnce(world,'2 cheque');}
// The failure this build removes, shown on the same world by taking the settled invoice's record away from the owner's view:
// an invoice that is neither payable nor settled is still refused (a broken state is not papered over).
{const world=plant();world.fund(2000000);world.state.finance.payables=world.state.finance.payables.filter(row=>row.number!==world.number);
  assert.match(refused(world,world.due+1)||'',/payable-not-found/,'2: an open invoice whose payable vanished is still refused');}
console.log('2 ok: energy, the player (transfer or cheque) paid it; the control and a broken state behave as before');

// ---- the hotel: an external telecom service signed through the real commands of the hospitality fixture ----
function hotel(){
  const q=hospitalityFixture();for(const name of ['company-autopilot-core','strategy-core','conference-core','operations-core','advanced-core'])q.load(name);
  const {s,state,F,H}=q;s.GH_ADVANCED.migrate(state);const D=s.GH_DOMAIN_COMMANDS,P=s.GH_COMPANY_AUTOPILOT,TX=s.GH_TRANSACTION_CORE;
  const player=(domain,name,payload)=>D.dispatch({state},domain,name,payload).result,system=(domain,name,payload,actor)=>D.dispatchSystem({state},domain,name,payload,{actor}).result;
  const property=q.property();state.advanced.facilities[property.id].staff=0; // no staff yet: no guests, so no receipts on the 15th
  const quote=s.GH_HOSPITALITY_LINKS.quote(state,'hospitality',property.id,'telecom','external');q.command('sign-service',{propertyId:property.id,kind:'telecom',providerCompanyId:'external',expectedDailyNet:quote.dailyNet});
  const cash=()=>F.operating(state,'hospitality'),account=()=>Object.values(H.read(state,'hospitality').accounting.serviceAccounts||{})[0];
  const dayClose=day=>TX.execute(state,{label:`day-close:${day}`,apply(){state.simSeconds=day*DAY;const stages=s.GH_ADVANCED.onFinancialDayStages(state,day);let step;while(!(step=stages.next()).done){}return step.value;}});
  const autopilot=()=>{const step=P.next(state,'payables',{tried:new Set(),F});return step?Array.from(step.commands,command=>({command,result:system(command.domain,command.name,command.payload,P.ACTOR)})):[];};
  // The 15th (day 14) with no cash: the hotel's money is moved to the holding by a real transfer the day before.
  q.advance(13);if(cash()>0)player('finance','transfer',{from:'hospitality',to:'group',amount:cents(cash()),note:'cash to the holding'});q.tick(14);
  const number=account().invoiceNumber,payable=state.finance.payables.find(row=>row.number===number);assert.ok(number&&payable&&payable.autoSettle!==true&&account().settled!==true,'the service bill is issued and left open');
  const fund=()=>player('finance','transfer',{from:'group',to:'hospitality',amount:1000000,note:'funding'});
  return {q,s,state,F,H,player,system,cash,account,dayClose,autopilot,number,total:Number(payable.total),fund};
}
const billSettled=(world,label)=>{const account=world.account(),invoice=Array.from(world.state.finance.invoices).find(row=>row.number===world.number)||world.F.findArchivedDocument(world.state,'invoices','number',world.number);
  assert.equal(account.settled,true,`${label}: the service account is settled`);assert.equal(invoice.status,'مسددة',`${label}: the bill is settled`);assert.ok(!world.state.finance.payables.some(row=>row.number===world.number),`${label}: no payable is left`);
  assert.equal(world.H.read(world.state,'hospitality').properties[0].services[0].status,'active',`${label}: the service runs`);};
const hotelPosition=world=>{const account=world.account(),service=world.H.read(world.state,'hospitality').properties[0].services[0];return {settled:account.settled,net:account.net,invoice:account.invoiceNumber,service:service.status,cash:cents(world.cash())};};
const hotelControl=(()=>{const world=hotel();world.fund();const before=world.cash();closes(world,[15]);assert.ok(before-world.cash()>=world.total-1e-6,'control: the hotel pays its own bill');closes(world,[16,17]);billSettled(world,'control');return hotelPosition(world);})();
// 3. The player pays; the autopilot pays; a cheque; the control.
{const world=hotel();world.fund();const before=world.cash();world.player('finance','settle-payable',{number:world.number,method:'transfer'});assert.equal(cents(before-world.cash()),cents(world.total),'3: the player pays the bill');
  closes(world,[15,16,17]);billSettled(world,'3 player');assert.deepEqual(hotelPosition(world),hotelControl,'3: the account, the service and the cash are what they are when the hotel pays its own bill');}
{const world=hotel();world.fund();const steps=world.autopilot();assert.deepEqual(steps.map(row=>row.command.payload.number),[world.number],'3: the autopilot takes the open bill');closes(world,[15,16,17]);billSettled(world,'3 autopilot');assert.deepEqual(hotelPosition(world),hotelControl,'3: the same position as the control');}
{const world=hotel();world.fund();const cheque=world.player('finance','settle-payable',{number:world.number,method:'cheque'});closes(world,[15]);assert.notEqual(world.account().settled,true,'3: while the cheque is in issue the hotel waits');
  world.system('finance','settle-cheque',{id:cheque.chequeId},'finance-scheduler');closes(world,[16,17]);billSettled(world,'3 cheque');}
// A bill that is neither payable nor settled is still refused (a broken state is not papered over).
{const world=hotel();world.fund();world.state.finance.payables=world.state.finance.payables.filter(row=>row.number!==world.number);assert.match(refused(world,15)||'',/payable-not-found/,'3: an open bill whose payable vanished is still refused');}
console.log('3 ok: hotel, the player, the autopilot or a cheque paid the service bill: the closes go on and it is paid once');
console.log('build665 payable settled elsewhere: 3 checks passed');
