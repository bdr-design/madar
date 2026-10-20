'use strict';
// A sponsor's monthly payment reached the sponsored company as cash and an income invoice, but never its daily close: the
// day's revenue, the annual figures and the conference results left it out. Proven on the real business world, finance
// and domain command owners (business scenario, an airline sponsored by a payments company):
//  1. each billing period the payment reaches the company's close as income, equal to the cash it received;
//  2. a repeated day bills nothing again; the next period bills (and notes) once more;
//  3. the previous source (run from its own tree) received the cash without the income.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'),SOURCE=process.env.GH_TEST_SOURCE_DIR||ROOT,PREVIOUS='0661b5d';
process.env.GH_TEST_SOURCE_DIR=SOURCE;
const {scenario:business}=require('./helpers/business-scenario.js');

function scenario(){
  const env=business(),{s,state}=env;env.load('business-world-core');const W=s.GH_BUSINESS_WORLD,F=s.GH_FINANCE_CORE;
  W.execute({state},'sync-world',{});const offer=W.execute({state},'accept-sponsorship',{id:'SPON-AERO-001',ownerCompanyId:'air'});
  F.takeOffClosePnl(state);const cash=()=>F.book(state,'air').accounts[0].balance,bill=day=>{const before=cash();state.simSeconds=day*86400;const out=W.execute({state},'tick-day',{day});return {billed:out.sponsorshipRevenue,cash:cash()-before,income:F.takeOffClosePnl(state).air?.revenue||0};};
  const first=offer.nextBillingDay,rows={first:bill(first),repeat:bill(first),next:bill(first+30)};
  return {company:offer.company,monthly:offer.monthlyValue,rows};
}
if(process.env.GH_B546_CHILD){console.log(JSON.stringify(scenario()));return;}
(()=>{
  const now=scenario(),close=(a,b)=>Math.abs(a-b)<.01,{first,repeat,next}=now.rows;
  assert.equal(now.company,'air');assert(now.monthly>0,'the sponsorship bills monthly');
  assert(close(first.billed,now.monthly)&&close(first.cash,now.monthly),`the first period was billed and paid (${JSON.stringify(first)})`);
  assert(close(first.income,now.monthly),`1: and reached the company's close as income (${JSON.stringify(first)})`);
  assert.equal(repeat.billed,0);assert.equal(repeat.income,0,'2: a repeated day notes nothing');
  assert(close(next.billed,now.monthly)&&close(next.income,now.monthly),`2: the next period notes once (${JSON.stringify(next)})`);
  const tree=fs.mkdtempSync(path.join(os.tmpdir(),'b546-'));
  try{execFileSync('sh',['-c',`git -C "${ROOT}" archive ${PREVIOUS} WebApp | tar -x -C "${tree}"`]);
    const before=JSON.parse(execFileSync(process.execPath,[__filename],{env:{...process.env,GH_B546_CHILD:'1',GH_TEST_SOURCE_DIR:tree},encoding:'utf8',maxBuffer:16*1024*1024}).trim().split('\n').at(-1));
    assert(close(before.rows.first.cash,before.monthly),'the previous source paid the cash too');assert.equal(before.rows.first.income,0,'3: without the income');
    console.log(JSON.stringify({suite:'build546-sponsorship-revenue',ok:true,monthly:now.monthly,current:now.rows,previous:before.rows}));
  }finally{fs.rmSync(tree,{recursive:true,force:true});}
})();
