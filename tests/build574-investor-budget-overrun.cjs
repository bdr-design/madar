'use strict';
// Investor mode spends past the company's budget by design (its card covers any shortfall and the budget check lets it
// through), but the save and integrity checks then rejected the whole command: «أُلغي الأمر بالكامل ولم يتغير أي أصل:
// invalid-draft:budget-line» (found selling a fleet whose lease fees passed the capital line). Proven on the real finance,
// save and integrity owners:
//  1. in investor mode a spend past the month's total limit and past a line limit is made, the month's budget records
//     that investor mode overran it, the save validates and integrity reports no exceeded budget;
//  2. after investor mode is turned off the overrun stays accepted for that month, and new spending is still refused by
//     the budget as before;
//  3. without investor mode a spend past the budget is refused and nothing is marked;
//  4. the next month starts clean, without the mark, and its limits apply again.
const assert=require('node:assert/strict'),path=require('node:path');
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {scenario}=require('./helpers/business-scenario.js');
const DAY=86400,plain=v=>JSON.parse(JSON.stringify(v));
function world(investor){const env=scenario(),{s,state,command}=env;state.godMoney=investor;state.infiniteMoney=investor;state.simSeconds=10*DAY;
 const F=s.GH_FINANCE_CORE;F.book(state,'air').accounts[0].balance=5e6;F.reconcile(state);
 const used=()=>{const b=F.budget(state,'air');return Number(b.spentByLine.capex)||0;};command('finance','set-budget',{company:'air',limit:F.budget(state,'air').spent+1e6,lines:{capex:used()+5e5}});
 const sound=label=>{assert.deepEqual(plain((s.GH_SAVE_SCHEMA.validate(state).errors||[]).filter(e=>/budget/.test(e))),[],`${label}: the save validates`);assert.deepEqual(plain(s.GH_INTEGRITY_CORE.check(state).issues.filter(i=>/BUDGET/.test(i.id)).map(i=>i.id)),[],`${label}: integrity`);};
 return {...env,F,sound,budget:()=>F.budget(state,'air')};}
// 1
{const w=world(true),{state,command}=w,before=w.budget();
 command('finance','spend',{company:'air',amount:8e5,note:'معدات رأسمالية',line:'capex',taxable:false});let b=w.budget();
 assert.equal(b.spentByLine.capex-(Number(before.spentByLine.capex)||0),8e5,'1: the spend is made');assert.equal(b.investorOverrun,true,'1: the line overrun is recorded');w.sound('1 line');
 command('finance','spend',{company:'air',amount:2e6,note:'تسويق',line:'marketing',taxable:false});b=w.budget();assert(b.spent+b.reserved>b.limit,'1: past the total limit too');w.sound('1 total');
 // 2
 state.godMoney=false;state.infiniteMoney=false;w.sound('2 after investor mode');
 assert.throws(()=>command('finance','spend',{company:'air',amount:1000,note:'تسويق',line:'marketing',taxable:false}),/insufficient-funds-or-budget/,'2: the budget still refuses new spending');}
// 3
{const w=world(false),{command}=w;assert.throws(()=>command('finance','spend',{company:'air',amount:8e5,note:'معدات رأسمالية',line:'capex',taxable:false}),/insufficient-funds-or-budget/,'3: refused');assert.equal(w.budget().investorOverrun,undefined,'3: nothing marked');w.sound('3');}
// 4
{const w=world(true),{state,command}=w;command('finance','spend',{company:'air',amount:8e5,note:'معدات رأسمالية',line:'capex',taxable:false});assert.equal(w.budget().investorOverrun,true);
 state.simSeconds=40*DAY;const next=w.budget();assert.equal(next.investorOverrun,undefined,'4: a new month starts without the mark');assert.equal(next.spent,0);
 state.godMoney=false;state.infiniteMoney=false;assert.throws(()=>command('finance','spend',{company:'air',amount:6e5,note:'معدات رأسمالية',line:'capex',taxable:false}),/insufficient-funds-or-budget/,'4: its limits apply');w.sound('4');}
console.log(JSON.stringify({suite:'build574-investor-budget-overrun',ok:true}));
