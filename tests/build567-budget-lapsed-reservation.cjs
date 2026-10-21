'use strict';
// Owner's diagnostic (build 77, day 54): «صرف كل الشيكات» was refused twice with invalid-draft:budget and no cheque
// could be cashed. An obligation reserves its amount against the month's budget when it is incurred; the budget resets
// every 30 days, so last month's reservation is gone, yet paying it charged it in full to this month without any room
// check, past the cap. Paying a reserved obligation now moves only what this month still holds for it. Proven on the
// real finance, document and integrity owners:
//  1. within the month nothing changes: the reservation becomes spending, and an obligation's unbudgeted part (beyond
//     the room when it was incurred) is not charged, by transfer and by cheque;
//  2. last month's obligation is paid by transfer, by cheque, and several cheques in one go: the money leaves the
//     company's account once with its journal, the payable closes, and this month's spending is unchanged;
//  3. an obligation reserved before the budget was on is paid without charging it;
//  4. mixed with this month's reservation on the same line: both are paid, the cap holds, and the month ends with only
//     this month's obligation spent;
//  5. a payment without the cash still fails (transfer refused, cheque returned), and cashing a cheque again pays
//     nothing more;
//  6. after every step the save validates with no budget error and integrity reports no exceeded budget.
const assert=require('node:assert/strict'),path=require('node:path');
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {scenario}=require('./helpers/business-scenario.js');
const DAY=86400,plain=v=>JSON.parse(JSON.stringify(v));
function world({budget=true}={}){const env=scenario(),{s,state,command}=env;state.godMoney=false;state.infiniteMoney=false;state.simSeconds=10*DAY;if(budget)command('finance','set-budget',{company:'air',limit:1e6});
 const F=s.GH_FINANCE_CORE,accrue=(amount,number)=>command('finance','accrue-expense',{company:'air',amount,note:'صيانة محرك',counterparty:'Supplier',taxable:false,number});
 const b=()=>{const row=F.budget(state,'air');return {spent:row.spent,reserved:row.reserved,maintenance:[Number(row.spentByLine.maintenance)||0,Number(row.reservedByLine.maintenance)||0]};};
 const sound=label=>{const errors=(s.GH_SAVE_SCHEMA.validate(state).errors||[]).filter(e=>/budget/.test(e));assert.deepEqual(plain(errors),[],`${label}: the save validates`);const issues=s.GH_INTEGRITY_CORE.check(state).issues.filter(i=>/BUDGET/.test(i.code||''));assert.deepEqual(plain(issues.map(i=>i.code)),[],`${label}: integrity`);};
 const cash=()=>F.operating(state,'air'),open=n=>(state.finance.payables||[]).some(row=>row.number===n);
 return {...env,F,accrue,b,sound,cash,open};}
const byCheque=(w,n)=>{const c=w.command('finance','settle-payable',{number:n,method:'cheque'});return w.command('finance','settle-cheque',{id:c.chequeId});};
// 1
for(const method of ['transfer','cheque']){const w=world();const doc=w.accrue(600000,`M1-${method}`);w.command('finance','spend',{company:'air',amount:300000,note:'صيانة دورية'});
 assert.deepEqual(w.b(),{spent:300000,reserved:600000,maintenance:[300000,600000]},`1 ${method}: reserved when incurred`);const cash0=w.cash();
 if(method==='transfer')w.command('finance','settle-payable',{number:doc.number,method});else assert.equal(byCheque(w,doc.number).settled,true);
 assert.deepEqual(w.b(),{spent:900000,reserved:0,maintenance:[900000,0]},`1 ${method}: the reservation becomes spending`);assert.equal(cash0-w.cash(),600000);assert.equal(w.open(doc.number),false);w.sound(`1 ${method}`);
 const big=w.accrue(250000,`M1B-${method}`);assert.equal(big.budgetReserved,100000,`1 ${method}: only the room is reserved`);assert.equal(big.budgetUnbudgetedAmount,150000);
 if(method==='transfer')w.command('finance','settle-payable',{number:big.number,method});else assert.equal(byCheque(w,big.number).settled,true);
 assert.deepEqual(w.b(),{spent:1e6,reserved:0,maintenance:[1e6,0]},`1 ${method}: the unbudgeted part is not charged`);w.sound(`1 ${method} unbudgeted`);}
// 2
for(const method of ['transfer','cheque','three cheques']){const w=world(),docs=(method==='three cheques'?[200000,250000,150000]:[600000]).map((a,i)=>w.accrue(a,`M2-${method.length}-${i}`));
 assert.equal(w.b().reserved,docs.reduce((n,d)=>n+d.total,0),`2 ${method}: reserved last month`);
 w.state.simSeconds=40*DAY;w.command('finance','spend',{company:'air',amount:500000,note:'صيانة دورية'});const month=w.b(),cash0=w.cash(),journal0=w.state.finance.journalEntries.length;
 assert.deepEqual(month,{spent:500000,reserved:0,maintenance:[500000,0]},`2 ${method}: a new month`);
 for(const d of docs){if(method==='transfer')w.command('finance','settle-payable',{number:d.number,method});else assert.equal(byCheque(w,d.number).settled,true,`2 ${method}: ${d.number} cashed`);}
 const total=docs.reduce((n,d)=>n+d.total,0);assert.equal(cash0-w.cash(),total,`2 ${method}: the money leaves once`);assert(docs.every(d=>!w.open(d.number)),`2 ${method}: the payables close`);
 const added=w.state.finance.journalEntries.slice(0,w.state.finance.journalEntries.length-journal0);assert.equal(added.length,docs.length,`2 ${method}: one journal each`);for(const j of added)assert.deepEqual(plain(j.lines.map(l=>[l.account,!!l.debit,!!l.credit])),[['ذمم دائنة',true,false],[w.state.companyFinance.air.accounts[0].id,false,true]],`2 ${method}: payables against the account`);
 assert.deepEqual(w.b(),month,`2 ${method}: this month's spending is unchanged`);w.sound(`2 ${method}`);}
// 3
{const w=world({budget:false}),doc=w.accrue(600000,'M3');w.command('finance','set-budget',{company:'air',limit:1e6});w.command('finance','spend',{company:'air',amount:500000,note:'تسويق'});const before=w.b();
 assert.equal(byCheque(w,doc.number).settled,true,'3: cashed');assert.equal(w.b().spent,before.spent,'3: not charged');assert.equal(w.b().reserved,0);w.sound('3');}
// 4
{const w=world(),old=w.accrue(400000,'M4-OLD');w.state.simSeconds=40*DAY;w.command('finance','spend',{company:'air',amount:300000,note:'صيانة دورية'});const now=w.accrue(500000,'M4-NOW');
 assert.deepEqual(w.b(),{spent:300000,reserved:500000,maintenance:[300000,500000]},'4: this month holds only its own');
 assert.equal(byCheque(w,old.number).settled,true);let row=w.b();assert(row.spent+row.reserved<=1e6+.01,`4: the cap holds ${JSON.stringify(row)}`);w.sound('4 old');
 w.command('finance','settle-payable',{number:now.number,method:'transfer'});row=w.b();assert.deepEqual(row,{spent:800000,reserved:0,maintenance:[800000,0]},'4: only this month\'s obligation spent');w.sound('4 both');}
// 5
{const w=world(),doc=w.accrue(600000,'M5'),poor=w.accrue(700000,'M5-P');w.state.simSeconds=40*DAY;const account=w.state.companyFinance.air.accounts[0];
 const keep=account.balance;account.balance=100000;w.F.reconcile(w.state);const before=JSON.stringify(w.b());
 assert.throws(()=>w.command('finance','settle-payable',{number:doc.number,method:'transfer'}),/insufficient-cash/,'5: no cash, no transfer');
 const c=w.command('finance','settle-payable',{number:poor.number,method:'cheque'}),bounced=w.command('finance','settle-cheque',{id:c.chequeId});assert.equal(bounced.settled,false);assert.equal(bounced.reason,'insufficient-funds-or-budget');
 assert.equal(w.state.finance.cheques.find(x=>x.id===c.chequeId).status,'مرتجع','5: the cheque is returned');assert.equal(JSON.stringify(w.b()),before,'5: the budget is untouched');
 account.balance=keep;w.F.reconcile(w.state);const c2=w.command('finance','settle-payable',{number:doc.number,method:'cheque'});assert.equal(w.command('finance','settle-cheque',{id:c2.chequeId}).settled,true);
 const cash1=w.cash(),after=JSON.stringify(w.b()),again=w.command('finance','settle-cheque',{id:c2.chequeId});assert.equal(again.reason,'already-settled','5: cashing again');assert.equal(w.cash(),cash1,'5: pays nothing more');assert.equal(JSON.stringify(w.b()),after);w.sound('5');}
console.log(JSON.stringify({suite:'build567-budget-lapsed-reservation',ok:true}));
