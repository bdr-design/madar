'use strict';
// The monthly internal fleet insurance premium (found playing a month without investor mode: on day 30 a fleet company
// without the cash threw inside the day's close, every retry failed the same way, and the game stopped there). Proven
// on the real realism, finance and document owners:
//  1. a payer with the cash and the insurance budget pays as before: one signed intercompany transfer, the insurer is
//     paid, the policy is in force;
//  2. a payer without the cash does not throw: the policy is recorded unpaid, no money or document moves;
//  3. a payer whose insurance budget line has no room is treated the same, and its budget is untouched;
//  4. in investor mode the card covers the shortfall and the premium is paid;
//  5. the same day run again records nothing more for a paid policy.
const assert=require('node:assert/strict'),path=require('node:path');
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {scenario}=require('./helpers/business-scenario');
const DAY=86400,drain=generator=>{let step;while(!(step=generator.next()).done){}};
function world({cash,budget=0,investor=false}){const env=scenario(),{s,state,command}=env;env.load('insurance-core');command('corporate','open-company',{type:'insurance',capital:60000000,legalName:'شركة اختبار التأمين'});
 state.godMoney=investor;state.infiniteMoney=investor;const F=s.GH_FINANCE_CORE;state.simSeconds=30*DAY;F.book(state,'air').accounts[0].balance=cash;F.reconcile(state);if(budget)command('finance','set-budget',{company:'air',limit:budget,lines:{insurance:1}});
 const value=10000000,maintenance={companies:new Map([['air',{count:10,conditionSum:1000,value,risk:0,premium:value*.0035,sample:[],due:[],cost:0,restored:0,threshold:80,licence:0,unsafe:0,fine:0}]])};
 const snap=()=>JSON.stringify([F.operating(state,'air'),F.operating(state,'insurance'),state.finance.transfers.length,state.finance.journalEntries.length,state.companyBudgets?.air||null]);
 return {s,state,F,run:()=>drain(s.GH_REALISM.runIncidents(state,maintenance,30)),snap,policies:()=>state.advanced.insurance.fleetPolicies};}
// 1
{const w=world({cash:5e6}),air=w.F.operating(w.state,'air'),insurer=w.F.operating(w.state,'insurance');w.run();const [p]=w.policies();
 assert.equal(p.status,'سارية');assert(p.transferReference);assert.equal(w.F.operating(w.state,'air'),air-p.premium);assert.equal(w.F.operating(w.state,'insurance'),insurer+p.premium,'1: the insurer is paid');
 assert.equal(w.s.GH_DOCUMENT_PROOF.verifyDocument(w.state,w.state.finance.transfers.find(t=>t.reference===p.transferReference)).ok,true,'1: signed');
 // 5
 const before=w.snap();w.run();assert.equal(w.snap(),before,'5: the same day pays nothing more');}
// 2
{const w=world({cash:1000}),before=w.snap();assert.doesNotThrow(()=>w.run(),'2: the day does not fail');const [p]=w.policies();
 assert.deepEqual({status:p.status,transfer:p.transferReference,company:p.company,insurer:p.insurerCompanyId},{status:'غير مسدد · لا سيولة أو ميزانية',transfer:null,company:'air',insurer:'insurance'},'2: recorded unpaid');assert(p.premium>0);
 assert.equal(w.snap(),before,'2: no money, document or entry moves');}
// 3
{const w=world({cash:5e6,budget:1e9}),before=w.snap();assert.doesNotThrow(()=>w.run());const [p]=w.policies();assert.equal(p.status,'غير مسدد · لا سيولة أو ميزانية','3: no room on the insurance line');assert.equal(w.snap(),before,'3: nothing moves, the budget is untouched');}
// 4
{const w=world({cash:1000,investor:true});w.run();const [p]=w.policies();assert.equal(p.status,'سارية','4: paid in investor mode');assert(w.state.finance.transfers.some(t=>t.kind==='founder-investment'&&t.company==='air'),'4: the card covered the shortfall');}
console.log(JSON.stringify({suite:'build572-fleet-premium-unpaid',ok:true}));
