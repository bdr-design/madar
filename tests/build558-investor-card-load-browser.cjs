'use strict';
// The investor card adds no weight to play (owner: «لاثقل على اللعبة … اختبارات صارمة جدًا لمعرفة اي اسباب ثقل»).
// Measured in the real app with the processor slowed four times, on this source and on the source before the card (run
// from its own tree), the same world with every company's current account emptied so that play needs the card:
//  1. ten game days write as many founder transfers, signed documents and journal entries as before, and no bigger save.
//     The save is weighed without the card's statement and without the app's diagnostics (its event log, counters, open
//     issues and last health report), which record how the machine ran: the governor's events come from ten-second
//     windows of wall time and carry the chunks' timings. With them, this source's save moved by up to 1,402 bytes from
//     one run to the next here, and build 88's macOS runner found it 1,102 bytes bigger than the old source's; without
//     them both are the same in every run (832,094 against 832,789 bytes here, frames held 80 ms or not). The card
//     writes nothing there;
//  2. those days take no longer than before (main-thread long tasks and wall time, with a margin for noise);
//  3. opening the investor mode page (the card, its statement and every company's return) builds no more than opening the
//     finance overview, and writes nothing: fewer elements, and no longer by the app's own clock of building a page and
//     its DOM (the two pages taken in turn, the fastest of five each). The whole open to the second frame is reported, not
//     compared: its style, layout and paint depend on the machine's graphics (build 80's macOS runner painted the card's
//     gradients slower than the finance overview's text, 87 against 65 ms, the reverse of here, 63 against 142 ms).
//     The pages are built at full speed: slowed four times, the throttle's own pauses land at random in a build of a few
//     milliseconds (one documents page measured 3.6 to 15 ms from one opening to the next, build570). The floor under
//     the finance overview's time is 1.25 ms, a quarter of the 5 ms it had slowed four times.
// Desktop Chromium, the days with the CPU throttled 4x; not iPhone performance.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const {bootAtOrigin,installVault}=require('./helpers/differential-vault-fixture.cjs'),{prepareCommandWorld}=require('./helpers/command-world-fixture.cjs');
const ROOT=path.resolve(__dirname,'..'),SOURCE=process.env.GH_TEST_SOURCE_DIR||ROOT,PREVIOUS='65ee1eb',DAYS=10;
async function measure(root){
 const browser=await chromium.launch({headless:true}),errors=[];let env;try{
  env=await bootAtOrigin({browser,root,errors,fleetWorker:true,viewport:{width:1180,height:820},beforeScripts:{fn:installVault}});const {page}=env;page.setDefaultTimeout(120000);await prepareCommandWorld(page,{count:2});
  const settled=()=>page.waitForFunction(()=>!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked()&&!__AUDIT__.simulationEngine.snapshot().manualAdvance);
  await page.evaluate(()=>{const s=__GH_STATE__,F=GH_FINANCE_CORE;for(const t of Object.keys(s.companyFinance))if(t!=='group'){F.book(s,t).accounts[0].balance=0;}F.reconcile(s);__AUDIT__.save?.();});await settled();
  const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  const counts=()=>page.evaluate(()=>{const s=__GH_STATE__;return {founder:s.finance.transfers.filter(t=>t.kind==='founder-investment').length,journal:s.finance.journalEntries.length,proofs:JSON.stringify(s.documentProofs||s.finance.documentProofs||{}).length,save:JSON.stringify(s).length-JSON.stringify(s.finance.investorCard||null).length-JSON.stringify(s.diagnostics||null).length};});
  const start=await counts();
  await page.evaluate(()=>{window.__qaLong=0;window.__qaObserver=new PerformanceObserver(list=>{for(const e of list.getEntries())window.__qaLong+=e.duration;});window.__qaObserver.observe({type:'longtask'});});
  const wall=await page.evaluate(async days=>{const t0=performance.now();for(let d=0;d<days;d++){const r=__AUDIT__.simulationEngine.advanceTo(__GH_STATE__.simSeconds+86400,{reason:'qa-investor-card-load',speed:300});if(!r.accepted)throw Error(JSON.stringify(r));await new Promise(done=>{const wait=()=>__AUDIT__.simulationEngine.snapshot().manualAdvance?setTimeout(wait,20):done();wait();});}return performance.now()-t0;},DAYS);
  await settled();const long=await page.evaluate(()=>{window.__qaObserver.disconnect();return window.__qaLong;}),end=await counts();
  // The app times each open's stages itself (GH_DIAGNOSTICS.recordMainThreadWork); 'ui.render' is building the page and its DOM.
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});
  await page.evaluate(()=>{const api=window.GH_DIAGNOSTICS;window.__qaStages=[];window.GH_DIAGNOSTICS={...api,recordMainThreadWork:(s,stage,from,to)=>{window.__qaStages.push([stage,to-from]);return api.recordMainThreadWork(s,stage,from,to);}};});
  const open=async panel=>{await page.evaluate(()=>__AUDIT__.closeDrawer?.());await page.waitForTimeout(100);return page.evaluate(async panel=>{window.__qaStages=[];const t0=performance.now();__AUDIT__.openDrawer(panel);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const stage=name=>window.__qaStages.filter(([k])=>k===name).reduce((n,[,v])=>n+v,0);return {render:stage('ui.render'),open:stage('ui.open'),total:performance.now()-t0,nodes:document.querySelectorAll('#drawerBody *').length};},panel);};
  const best=rows=>({render:Math.min(...rows.map(r=>r.render)),open:Math.min(...rows.map(r=>r.open)),total:Math.min(...rows.map(r=>r.total)),nodes:Math.max(...rows.map(r=>r.nodes))});
  const before=await page.evaluate(()=>JSON.stringify([__GH_STATE__.finance,__GH_STATE__.saveRevision])),runs={investorMode:[],finance:[]};for(let i=0;i<5;i++)for(const panel of Object.keys(runs))runs[panel].push(await open(panel));
  const investorPage=best(runs.investorMode),financePage=best(runs.finance),unchanged=await page.evaluate(b=>JSON.stringify([__GH_STATE__.finance,__GH_STATE__.saveRevision])===b,before);
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
  assert(now.unchanged,'3: opening the pages writes nothing');assert(now.investorPage.nodes<=now.financePage.nodes,`3: the investor page builds ${now.investorPage.nodes} elements against the finance overview's ${now.financePage.nodes}`);
  assert(now.investorPage.render>0&&now.investorPage.render<=Math.max(now.financePage.render,1.25)*1.2,`3: building the investor page (${now.investorPage.render.toFixed(1)} ms) against the finance overview (${now.financePage.render.toFixed(1)} ms)`);
  console.log(JSON.stringify({suite:'build558-investor-card-load-browser',ok:true,environment:'Chromium desktop, the days with the CPU throttled 4x, the pages at full speed; not iPhone performance',now,before}));
 }finally{fs.rmSync(tree,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
