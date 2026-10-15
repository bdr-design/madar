'use strict';
// Build 378 (Basel III capital conservation): the group's bank may not pay cash out to the group below CET1 of 7% (4.5%
// minimum + 2.5% buffer), or below the 3% leverage floor. A cash pool sweep observes the same limit; only the bank's
// actual credit facility command may disburse a loan without treating it as a distribution.
process.env.GH_TEST_SOURCE_DIR=require('path').resolve(__dirname,'..');
const assert=require('node:assert/strict');
const {harness,minimal}=require('./helpers/core-harness');
const {s}=harness(['finance-core','banking-core','transaction-core','save-schema','economics-core']);
const F=s.GH_FINANCE_CORE,B=s.GH_BANKING_CORE;
function setup(){
  const state={...minimal(),profile:{name:'Capital conservation'},openedCompanies:['bank','road'],bank:{},branches:[]};
  F.ensure(state);F.book(state,'bank').accounts[0].balance=120e6;F.book(state,'road').accounts[0].balance=10e6;F.reconcile(state);
  const b=B.ensure(state);Object.assign(b,{deposits:100e6,loans:0,provisions:0,riskPolicy:{maxLdr:120,minLcr:100,minNsfr:100,minCet1:4.5,sectorConcentration:25}});
  b.branchNetwork=[{id:'BR-CC',city:'Riyadh',country:'Saudi Arabia',servicesActive:true,deposits:100e6,loans:0,retailCustomers:10,businessCustomers:2,depositMix:{sight:45e6,savings:35e6,term:20e6},lastProcessedDay:0}];
  B.ensure(state);for(const c of Object.values(b.corporateClients))c.creditLimit=100e6;B.reconcilePrudential(state);state.simSeconds=2*86400;
  B.execute({state},'originate-loan',{amount:10e6,product:'corporate',sector:'commercial'});B.reconcilePrudential(state);return state;
}
// 1. A transfer beyond the distributable capital is refused; within it, allowed; then nothing more can leave.
{
  const state=setup(),limit=B.distributableCash(state);
  assert.ok(Number.isFinite(limit)&&limit>0&&limit<F.book(state,'bank').accounts[0].balance,'the capital above 7% is less than the bank\'s cash');
  assert.throws(()=>F.execute({state},'transfer',{from:'bank',to:'road',amount:Math.round(limit)+1000,note:'QA'}),/bank-distribution-restricted/);
  F.execute({state},'transfer',{from:'bank',to:'road',amount:Math.floor(limit)-1000,note:'QA'});
  B.reconcilePrudential(state);assert.ok(B.distributableCash(state)<1001,'the bank sits on the binding regulatory floor');assert.ok(state.bank.cet1>=7-.01,`CET1 ${state.bank.cet1}`);assert.ok(state.bank.leverageRatio>=3-.01,`leverage ${state.bank.leverageRatio}`);
  assert.ok(state.bank.cet1<7.5||state.bank.leverageRatio<3.5,'at least one distribution floor is binding');
  assert.throws(()=>F.execute({state},'transfer',{from:'bank',to:'road',amount:5000,note:'QA'}),/bank-distribution-restricted/);
  F.execute({state},'transfer',{from:'road',to:'bank',amount:5000,note:'QA'});
}
// 2. The cash pool sweep takes from the bank at most what it may pay out.
{
  const state=setup(),limit=B.distributableCash(state);F.ensure(state);state.finance.centralTreasury.minOperatingCash.bank=0;
  const sweep=F.execute({state},'cash-pool-sweep',{companies:['bank']}),row=sweep.rows.find(item=>item.company==='bank');
  assert.ok(row&&Math.abs(row.amount-limit)<1,'the sweep stops at the floor');
}
// 3. A caller cannot label an ordinary transfer as lending to evade either floor.
{
  const state=setup(),limit=B.distributableCash(state);
  assert.throws(()=>F.execute({state},'transfer',{from:'bank',to:'road',amount:Math.round(limit)+1000,bankLending:true,note:'سحب تسهيل'}),/bank-distribution-restricted/);
}
// 4. A genuine bank credit command still disburses principal, charges one fee and creates a facility record.
{
  const state=setup(),bankCash=F.operating(state,'bank'),borrowerCash=F.operating(state,'road');
  assert.equal(B.execute({state},'draw-facility',{company:'road',amount:1000000}),1000000);
  assert.equal(F.operating(state,'bank'),bankCash-1000000+25000);
  assert.equal(F.operating(state,'road'),borrowerCash+1000000-25000);
  assert.equal(state.bank.corporateFacilities.length,1);
}
console.log(JSON.stringify({suite:'build378-bank-capital-conservation',ok:true}));
