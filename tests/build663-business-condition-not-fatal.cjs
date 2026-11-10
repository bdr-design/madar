'use strict';
// Build 663, found by playing (store edition): a bank left alone (10 branches, deposits growing, nothing lent) reached
// «CET1 below 4.5%» on game day 219, and a 15-company world on day 61. The integrity check reported it as 'critical', and
// every owner refuses an operation that brings a new critical issue: the day of the simulation that crossed the line was
// rolled back each time, the clock stopped for good and nothing on the screen said why. LCR and NSFR under 100% and a
// negative capacity reserve margin were classed the same way. These are conditions of the business, reported as
// warnings now; a broken state is still critical and still refuses the operation. Checked here:
// - the four conditions are reported, each a warning, and alone they leave the report's status at 'warning';
// - an operation (a control-plane command inside the slice's transaction, as the simulation runs) that takes the bank under each
//   minimum, or the grid under its demand, commits; the same operation on the source before this build was refused;
// - an operation that breaks the state (two invoices with one number) is still refused and rolled back, alone or
//   together with a business condition.
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||require('node:path').resolve(__dirname,'..');
const assert=require('node:assert/strict');
const {harness,minimal}=require('./helpers/core-harness');
const {s}=harness(['transaction-core','control-plane-core','integrity-core']);
const T=s.GH_TRANSACTION_CORE,C=s.GH_CONTROL_PLANE,I=s.GH_INTEGRITY_CORE;
const CONDITIONS=['BANK_CET1_REGULATORY_MIN','BANK_LCR_BELOW_100','BANK_NSFR_BELOW_100','POWER_RESERVE_MARGIN_NEGATIVE'];
const generationFacility={id:'POWER-1',kind:'power',ownerCompanyId:'power',energyKind:'gas',capacityAmount:100,capacity:'100 MW',commissioned:true};
// A healthy group: a bank inside its minimums and a power company whose capacity covers its demand.
function world(){
  const state=minimal();state.saveVersion='3.0.0';state.speed=1;state.cash=1000000;state.debt=0;state.groupValue=1000000;state.eventLog=[];state.sectorProfitToday={};state.tripRevenueAccrued={};state.constructionContracts=[];
  state.openedCompanies=['power'];state.simSeconds=2*86400;state.lastFinancialDay=2;state.customHubs=[{...generationFacility}];
  const margin=12,availableMW=78*(1+margin/100);
  state.energy={gasMW:0,solarMW:0,windMW:0,storageMWh:0,availability:availableMW,sites:[{id:'SITE-POWER-1',facilityId:'POWER-1',kind:'gas',capacity:100,commissioned:true,commissionedDay:0}]};
  state.realism={energy:{reserveMargin:margin,availableMW,storageHealth:99,adequacyEvaluatedDay:2,adequacyMethodVersion:3},banking:{cet1:14,lcr:120,nsfr:112,npl:1,provisionCoverage:100},procurement:{deliveries:[]},projects:[]};
  return state;
}
const report=state=>I.check(state),found=(state,id)=>Array.from(report(state).issues).find(row=>String(row.id)===id);
const conditionIds=state=>Array.from(report(state).issues).map(row=>String(row.id)).filter(id=>CONDITIONS.includes(id)).sort();
const breach={
  BANK_CET1_REGULATORY_MIN:state=>{state.realism.banking.cet1=3.2;},
  BANK_LCR_BELOW_100:state=>{state.realism.banking.lcr=64;},
  BANK_NSFR_BELOW_100:state=>{state.realism.banking.nsfr=91;},
  POWER_RESERVE_MARGIN_NEGATIVE:state=>{const margin=-6,availableMW=78*(1+margin/100);state.energy.availability=availableMW;state.realism.energy.reserveMargin=margin;state.realism.energy.availableMW=availableMW;}
};
// An operation as the simulation runs its hourly cycle (app.js: MARKET_HOURLY_CYCLE): a command of the control plane inside
// the slice's transaction, its integrity check deferred to the transaction's commit.
function operate(state,name,change){
  try{const out=T.execute(state,{label:`simulation:${name}`,apply:()=>C.execute(state,{name:'MARKET_HOURLY_CYCLE',domain:'market',actor:'simulation-market',correlationId:name},()=>{change(state);return true;},{atomic:false,integrity:true,schema:false,deferIntegrityToTransaction:true})});return {committed:out.committed===true,reason:String(out.reason||'')};}
  catch(error){return {committed:false,reason:String(error?.message||error)};}
}

// 1. The healthy group has none of them; each one alone is reported as a warning and the status is 'warning'.
{const state=world();assert.deepEqual(conditionIds(state),[],JSON.stringify(Array.from(report(state).issues,row=>row.id)));
  for(const id of CONDITIONS){const next=world();breach[id](next);const row=found(next,id);assert.ok(row,`${id} is reported`);assert.equal(row.severity,'warning',`${id} is a condition of the business`);assert.ok(row.title&&row.detail&&row.evidence,`${id} keeps its text and evidence`);
    assert.equal(report(next).status,'warning');assert.equal(report(next).counts.critical,0);}
  const all=world();for(const id of CONDITIONS)breach[id](all);assert.deepEqual(conditionIds(all),[...CONDITIONS].sort());assert.equal(report(all).counts.critical,0);}
console.log('1 ok: the four business conditions are reported as warnings');

// 2. The operation that reaches a condition commits: the state it leaves is the business's, and it is kept.
for(const id of CONDITIONS){const state=world(),out=operate(state,`REACH_${id}`,breach[id]);
  assert.equal(out.committed,true,`${id}: ${out.reason}`);assert.deepEqual(conditionIds(state),[id],'the condition is in the committed state');}
{const state=world(),out=operate(state,'REACH_ALL',next=>{for(const id of CONDITIONS)breach[id](next);});assert.equal(out.committed,true,out.reason);assert.deepEqual(conditionIds(state),[...CONDITIONS].sort());}
console.log('2 ok: an operation that takes the bank or the grid under a minimum commits');

// 3. A broken state is still refused and rolled back.
const duplicateInvoice=state=>{state.finance.invoices.push({number:'AIR-000001',company:'group',amount:10,total:10,status:'مدفوعة'},{number:'AIR-000001',company:'group',amount:10,total:10,status:'مدفوعة'});};
{const probe=world();duplicateInvoice(probe);const critical=Array.from(report(probe).issues).filter(row=>row.severity==='critical').map(row=>String(row.id));assert.ok(critical.some(id=>id.startsWith('FINANCE_INVOICE_DUP_')),JSON.stringify(critical));}
{const state=world(),before=JSON.stringify(state.finance.invoices),out=operate(state,'BREAK_STATE',duplicateInvoice);
  assert.equal(out.committed,false,'a broken state is refused');assert.match(out.reason,/BUSINESS_INTEGRITY: FINANCE_INVOICE_DUP_/);assert.equal(JSON.stringify(state.finance.invoices),before,'and rolled back');}
{const state=world(),out=operate(state,'BREAK_STATE_AND_BANK',next=>{breach.BANK_CET1_REGULATORY_MIN(next);duplicateInvoice(next);});
  assert.equal(out.committed,false);assert.match(out.reason,/BUSINESS_INTEGRITY: FINANCE_INVOICE_DUP_/);assert.doesNotMatch(out.reason,/BANK_CET1/);assert.equal(state.realism.banking.cet1,14,'the whole operation is rolled back');}
console.log('3 ok: a broken state is still refused and rolled back');
console.log('build663 business condition not fatal: 3 checks passed');
