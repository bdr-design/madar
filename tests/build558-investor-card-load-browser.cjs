'use strict';
// The investor card adds no weight to play (owner: «لاثقل على اللعبة … اختبارات صارمة جدًا لمعرفة اي اسباب ثقل»).
// Measured in the real app with the processor slowed four times, on this source and on the source before the card (run
// from its own tree), the same world with every company's current account emptied so that play needs the card:
//  1. ten game days write as many founder transfers, signed documents and journal entries as before, and no bigger save;
//  2. those days take no longer than before (main-thread long tasks and wall time, with a margin for noise);
//  3. opening the investor mode page (the card, its statement and every company's return) costs no more than opening
//     the finance overview, and writes nothing.
// Desktop Chromium with CPU throttling; not iPhone performance.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const {bootAtOrigin,installVault}=require('./helpers/differential-vault-fixture.cjs'),{prepareCommandWorld}=require('./helpers/command-world-fixture.cjs');
const ROOT=path.resolve(__dirname,'..'),SOURCE=process.env.GH_TEST_SOURCE_DIR||ROOT,PREVIOUS='65ee1eb',DAYS=10;
async function measure(root){
 const browser=await chromium.launch({headless:true}),errors=[];let env;try{
  env=await bootAtOrigin({browser,root,errors,fleetWorker:true,viewport:{width:1180,height:820},beforeScripts:{fn:installVault}});const {page}=env;page.setDefaultTimeout(120000);await prepareCommandWorld(page,{count:2});
  const settled=()=>page.waitForFunction(()=>!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked()&&!__AUDIT__.simulationEngine.snapshot().manualAdvance);
  await page.evaluate(()=>{const s=__GH_STATE__,F=GH_FINANCE_CORE;for(const t of Object.keys(s.companyFinance))if(t!=='group'){F.book(s,t).accounts[0].balance=0;}F.reconcile(s);__AUDIT__.save?.();});await settled();
  const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  const counts=()=>page.evaluate(()=>{const s=__GH_STATE__;return {founder:s.finance.transfers.filter(t=>t.kind==='founder-investment').length,journal:s.finance.journalEntries.length,proofs:JSON.stringify(s.documentProofs||s.finance.documentProofs||{}).length,save:JSON.stringify(s).length-JSON.stringify(s.finance.investorCard||null).length};});
  const start=await counts();
  await page.evaluate(()=>{window.__qaLong=0;window.__qaObserver=new PerformanceObserver(list=>{for(const e of list.getEntries())window.__qaLong+=e.duration;});window.__qaObserver.observe({type:'longtask'});});
  const wall=await page.evaluate(async days=>{const t0=performance.now();for(let d=0;d<days;d++){const r=__AUDIT__.simulationEngine.advanceTo(__GH_STATE__.simSeconds+86400,{reason:'qa-investor-card-load',speed:300});if(!r.accepted)throw Error(JSON.stringify(r));await new Promise(done=>{const wait=()=>__AUDIT__.simulationEngine.snapshot().manualAdvance?setTimeout(wait,20):done();wait();});}return performance.now()-t0;},DAYS);
  await settled();const long=await page.evaluate(()=>{window.__qaObserver.disconnect();return window.__qaLong;}),end=await counts();
  const open=async panel=>{const times=[];for(let i=0;i<3;i++){await page.evaluate(()=>__AUDIT__.closeDrawer?.());await page.waitForTimeout(100);times.push(await page.evaluate(async panel=>{const t0=performance.now();__AUDIT__.openDrawer(panel);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return performance.now()-t0;},panel));}return Math.min(...times);};
  const before=await page.evaluate(()=>JSON.stringify([__GH_STATE__.finance,__GH_STATE__.saveRevision])),investorPage=await open('investorMode'),financePage=await open('finance'),unchanged=await page.evaluate(b=>JSON.stringify([__GH_STATE__.finance,__GH_STATE__.saveRevision])===b,before);
  const companies=await page.locator('#drawerBody').count();void companies;
  assert.deepEqual(errors,[]);return {days:DAYS,wall,long,founder:end.founder-start.founder,journal:end.journal-start.journal,proofs:end.proofs-start.proofs,save:end.save,investorPage,financePage,unchanged};
 }finally{await browser.close();await env?.closeOrigin?.();}}
(async()=>{
 const tree=fs.mkdtempSync(path.join(os.tmpdir(),'b558-'));try{execFileSync('sh',['-c',`git -C "${ROOT}" archive ${PREVIOUS} WebApp | tar -x -C "${tree}"`]);
  const now=await measure(SOURCE),before=await measure(tree);
  // 1
  assert(now.founder>0,`1: play needed the card (${now.founder})`);assert.equal(now.founder,before.founder,'1: as many founder transfers');assert.equal(now.journal,before.journal,'1: as many journal entries');
  assert(now.proofs<=before.proofs,`1: no bigger proofs (${now.proofs} vs ${before.proofs})`);assert(now.save<=before.save,`1: no bigger save (${now.save} vs ${before.save})`);
  // 2
  assert(now.long<=before.long*1.25+150,`2: long tasks (${now.long.toFixed(0)} vs ${before.long.toFixed(0)} ms)`);assert(now.wall<=before.wall*1.25+300,`2: wall time (${now.wall.toFixed(0)} vs ${before.wall.toFixed(0)} ms)`);
  // 3
  assert(now.unchanged,'3: opening the pages writes nothing');assert(now.investorPage<=Math.max(now.financePage,50)*1.2,`3: the investor page (${now.investorPage.toFixed(1)} ms) against the finance overview (${now.financePage.toFixed(1)} ms)`);
  console.log(JSON.stringify({suite:'build558-investor-card-load-browser',ok:true,environment:'Chromium desktop, CPU throttled 4x; not iPhone performance',now,before}));
 }finally{fs.rmSync(tree,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
