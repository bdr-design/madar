'use strict';
// Bank transaction fees (loan arrangement, facility and trade fees) were keyed by the day they were charged, while the
// bank's daily close reads the key of its own day and runs at that day's start: a fee charged during the day, after the
// day's close, was never read. The cash reached the bank; its income never reached a close. Proven on the real banking,
// finance and economics owners:
//  1. a fee charged during a day, after that day's bank close, is counted by the next day's close (and its economics);
//  2. a fee charged before the day's bank close is still counted by that close;
//  3. over several days every fee charged is counted exactly once (a save rebuilding the fee map keys it the same way);
//  4. the previous source (run from its own tree) never counted the daytime fee.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'),SOURCE=process.env.GH_TEST_SOURCE_DIR||ROOT,PREVIOUS='e836453';
process.env.GH_TEST_SOURCE_DIR=SOURCE;
const {harness,minimal}=require('./helpers/core-harness');

function scenario(){
  const {s}=harness(['finance-core','banking-core','transaction-core','save-schema','economics-core']);
  const state={...minimal(),profile:{name:'Fee days'},openedCompanies:['bank','road'],bank:{},branches:[]};
  const F=s.GH_FINANCE_CORE;F.ensure(state);for(const id of state.openedCompanies)F.book(state,id).accounts[0].balance=id==='bank'?500e6:100e6;F.reconcile(state);
  const B=s.GH_BANKING_CORE,b=B.ensure(state);Object.assign(b,{deposits:100e6,loans:0,provisions:0,riskPolicy:{maxLdr:120,minLcr:100,minNsfr:100,minCet1:4.5,sectorConcentration:25}});
  b.branchNetwork=[{id:'BR-FEE',city:'Riyadh',country:'Saudi Arabia',servicesActive:true,deposits:100e6,loans:0,retailCustomers:10,businessCustomers:2,depositMix:{sight:45e6,savings:35e6,term:20e6},lastProcessedDay:0}];
  B.ensure(state);for(const c of Object.values(b.corporateClients))c.creditLimit=500e6;B.reconcilePrudential(state);
  const close=day=>{state.simSeconds=day*86400;return B.execute({state},'tick-day',{day});},loan=amount=>B.execute({state},'originate-loan',{amount,product:'corporate',sector:'commercial'}).originationFee;
  const out={charged:0,counted:{}};
  close(2);
  state.simSeconds=2*86400+5*3600;out.daytimeFee=loan(10e6);out.charged+=out.daytimeFee;          // after day 2's close
  {const copy=JSON.parse(JSON.stringify(state));delete copy.bank.transactionFeeByDay;B.ensure(copy);out.rebuilt=copy.bank.transactionFeeByDay;} // a save without the map
  const r3=close(3);out.counted[3]=r3.transactionFeeIncome;out.economics3=s.GH_ECONOMICS_CORE.sectorEconomics(state,{day:3,preferDailyReport:true}).detail.transactionFeeIncome;
  state.simSeconds=4*86400;out.beforeCloseFee=loan(5e6);out.charged+=out.beforeCloseFee;          // day 4, before its close
  out.counted[4]=close(4).transactionFeeIncome;
  out.counted[4.5]=B.execute({state},'tick-day',{day:4}).transactionFeeIncome??0;                    // a repeated close
  out.counted[5]=close(5).transactionFeeIncome;
  out.total=Object.entries(out.counted).filter(([k])=>k!=='4.5').reduce((n,[,v])=>n+num(v),0);return out;
}
const num=v=>Number(v)||0;
if(process.env.GH_B540_CHILD){console.log(JSON.stringify(scenario()));return;}
(()=>{
  const now=scenario();
  assert(now.daytimeFee>0&&now.beforeCloseFee>0,`fees were charged (${JSON.stringify(now)})`);
  assert.equal(now.counted[3],now.daytimeFee,`1: the next day's close counts the daytime fee (${JSON.stringify(now.counted)})`);
  assert.equal(now.economics3,now.daytimeFee,'1: and so do that day\'s economics');
  assert.equal(now.rebuilt['3'],now.daytimeFee,`1: a save rebuilding the map keys the fee to the same close (${JSON.stringify(now.rebuilt)})`);
  assert.equal(now.counted[4],now.beforeCloseFee,'2: a fee charged before the day\'s close is counted by it');
  assert.equal(now.counted[5],0,'3: nothing is counted again later');
  assert(Math.abs(now.total-now.charged)<.01,`3: every fee is counted exactly once (${now.total} of ${now.charged})`);
  const tree=fs.mkdtempSync(path.join(os.tmpdir(),'b540-'));
  try{execFileSync('sh',['-c',`git -C "${ROOT}" archive ${PREVIOUS} WebApp | tar -x -C "${tree}"`]);
    const before=JSON.parse(execFileSync(process.execPath,[__filename],{env:{...process.env,GH_B540_CHILD:'1',GH_TEST_SOURCE_DIR:tree},encoding:'utf8',maxBuffer:16*1024*1024}).trim().split('\n').at(-1));
    assert.equal(before.counted[3],0,'4: the previous source did not count the daytime fee the next day');assert(before.total<before.charged,`4: nor ever (${before.total} of ${before.charged})`);
    console.log(JSON.stringify({suite:'build540-bank-fee-close-day',ok:true,current:{charged:now.charged,counted:now.counted},previous:{charged:before.charged,counted:before.counted}}));
  }finally{fs.rmSync(tree,{recursive:true,force:true});}
})();
