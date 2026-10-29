'use strict';
// Owner («نفذ الباقي»; the power company's day took 14 ms and the real-estate day 8 ms in one task each at 2x CPU
// throttle): both are staged commands (GH_ENERGY_CORE / GH_REALESTATE_CORE executeStages through dispatchSystemStages),
// yielding between their parts and, for real estate, after each project. In the real app, every company operating
// (all-operating-world), two closed days, against the same source with the two owners' staged hooks taken away before
// the days close (the scheduler then runs their one-task onFinancialDay, as before):
//  1. the same energy and real-estate state, invoices, transfers, current accounts, ledger and journal, the same document
//     proofs (every content digest) and the same command records, in the same order;
//  2. each day the power company yields its six parts and real estate one stage per project and three closing parts.
const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require('playwright'),{bootRenderApp}=require('./helpers/render-app.cjs'),{installVault}=require('./helpers/differential-vault-fixture.cjs'),{prepareOperatingWorld}=require('./helpers/all-operating-world.cjs');
const ROOT=path.resolve(__dirname,'..');
async function run(root,staged){
  const browser=await chromium.launch({headless:true}),errors=[];let env=null;
  try{
    env=await bootRenderApp({browser,errors,root,beforeScripts:{fn:installVault},viewport:{width:844,height:390}});const {page}=env;page.setDefaultTimeout(600000);
    await prepareOperatingWorld(page,{rows:40,mobilityRows:4,fullDispatch:false});
    await page.waitForFunction(()=>!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked(),null,{timeout:180000});await page.evaluate(()=>GH_PERSISTENCE.drain());
    const out=await page.evaluate(async staged=>{
      // Stage names, read from the owners' staged commands; without them the scheduler runs onFinancialDay.
      const names=[];for(const core of [GH_ENERGY_CORE,GH_REALESTATE_CORE]){if(!staged){delete core.onFinancialDayStages;delete core.executeStages;continue;}const original=core.executeStages;core.executeStages=function*(...args){const it=original.apply(this,args);for(;;){const r=it.next();if(r.done)return r.value;names.push(String(r.value));yield r.value;}};}
      const e=__AUDIT__.simulationEngine,target=(Math.floor(__GH_STATE__.simSeconds/86400)+2)*86400+3600;e.advanceTo(target,{reason:'b631',maxSeconds:366*86400});
      const until=performance.now()+600000;while((e.snapshot().manualAdvance||GH_TRANSACTION_CORE.isStaged(__GH_STATE__))&&performance.now()<until)await new Promise(r=>setTimeout(r,20));
      return {names,projects:(__GH_STATE__.realEstate?.projects||[]).length};
    },staged);
    await page.waitForFunction(()=>!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked(),null,{timeout:180000});
    const finance=await page.evaluate(()=>{const s=__GH_STATE__,pick=row=>JSON.parse(JSON.stringify(row??null));return JSON.stringify({day:s.lastFinancialDay,energy:pick(s.energy),realEstate:pick(s.realEstate),invoices:pick(s.finance.invoices),transfers:pick(s.finance.transfers||[]),books:Object.fromEntries(Object.entries(s.companyFinance||{}).map(([k,b])=>[k,{accounts:b.accounts,ledger:b.ledger,journal:b.journal}])),proofs:Object.values(s.documentProofs?.recordsById||{}).map(r=>[r.id,r.contentDigest]),commands:pick(s.domainRuntime?.commands||s.domainRuntime?.records||[])});});
    assert.deepEqual(errors,[]);
    return {finance,...out};
  }finally{await browser.close();await env?.closeOrigin?.();}
}
(async()=>{
  const root=process.env.GH_TEST_SOURCE_DIR||ROOT,before=await run(root,false),now=await run(root,true);
  // 1.
  const parsed=JSON.parse(now.finance);assert.ok(parsed.day>=2,'1: two days closed');
  assert.ok(Array.isArray(parsed.energy?.dailyHistory)&&parsed.energy.dailyHistory.length>=2,'1: the power company closed its days');
  assert.ok(Array.isArray(parsed.realEstate?.dailyHistory)&&parsed.realEstate.dailyHistory.length>=2,'1: real estate closed its days');
  assert.equal(now.finance,before.finance,'1: the same energy and real-estate state, invoices, transfers, accounts, ledger, journal, document proofs and command records');
  // 2.
  const count=name=>now.names.filter(row=>row===name).length;
  for(const part of ['contracts','outages','economics','project-finance','tenders','internal-supply'])assert.equal(count(`energy.${part}`),2,`2: the power company yields ${part} once a day`);
  assert.equal(count('realestate.project'),2*now.projects,'2: real estate yields after each project each day');
  for(const part of ['archive','internal-rent'])assert.equal(count(`realestate.${part}`),2,`2: real estate yields ${part} once a day`);
  assert.equal(before.names.length,0,'2: (none without the staged hooks)');
  console.log(JSON.stringify({suite:'build631-energy-realestate-day-stages-browser',ok:true,day:parsed.day,stages:now.names.length,projects:now.projects}));
})().catch(error=>{console.error(error);process.exitCode=1;});
