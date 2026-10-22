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
//  2. those days take no longer than before (main-thread long tasks and wall time, with a margin for noise). Both sources
//     play their ten days at the same time, twice, each in its own browser, and each is taken at the lighter of its two
//     plays (its long tasks, and its wall time). Slowed four times, the simulation's timer tasks take as long on both
//     sources (7.0 to 7.7 s of them in ten days on either, in four plays each, the longest 37 to 56 ms), and now and
//     then a task runs 50 to 220 ms in one play and not the next. Played once each, one after the other, this source
//     counted long tasks in 6 of 16 plays here (up to 175 ms) and the old source in 8 of 16 (up to 202), whichever
//     went first, and build 92's macOS runner read 220 against 0. Work that costs more comes back in both plays: 35 ms
//     of work added once to the card's transfer (140 ms slowed) reads 188 and 192 against 0 ms here in two runs (the
//     single plays read 200 against 65 and passed), 9 ms added to each day's close 354 and 395 against 0 (the single
//     plays 400 against 0); 3 or 6 ms a day passed both ways. Limits: a cost that comes in some plays only (a
//     collection that falls within the days in one play and after them in the next) is caught only when it comes in
//     both; and the two browsers share the machine, so this source's work off the main thread can slow the old
//     source's plays too;
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
async function boot(root){
 const browser=await chromium.launch({headless:true}),errors=[];let env;try{
  env=await bootAtOrigin({browser,root,errors,fleetWorker:true,viewport:{width:1180,height:820},beforeScripts:{fn:installVault}});const {page}=env;page.setDefaultTimeout(120000);await prepareCommandWorld(page,{count:2});
  const settled=()=>page.waitForFunction(()=>!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked()&&!__AUDIT__.simulationEngine.snapshot().manualAdvance);
  await page.evaluate(()=>{const s=__GH_STATE__,F=GH_FINANCE_CORE;for(const t of Object.keys(s.companyFinance))if(t!=='group'){F.book(s,t).accounts[0].balance=0;}F.reconcile(s);__AUDIT__.save?.();});await settled();
  const cdp=await page.context().newCDPSession(page);
  const counts=()=>page.evaluate(()=>{const s=__GH_STATE__;return {founder:s.finance.transfers.filter(t=>t.kind==='founder-investment').length,journal:s.finance.journalEntries.length,proofs:JSON.stringify(s.documentProofs||s.finance.documentProofs||{}).length,save:JSON.stringify(s).length-JSON.stringify(s.finance.investorCard||null).length-JSON.stringify(s.diagnostics||null).length};});
  // Each long task is counted on the day it started in (reported).
  const days=async()=>{
   await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});const start=await counts();
   await page.evaluate(()=>{window.__qaLong=[];window.__qaObserver=new PerformanceObserver(list=>{for(const e of list.getEntries())window.__qaLong.push([e.startTime,e.duration]);});window.__qaObserver.observe({type:'longtask'});});
   const marks=await page.evaluate(async days=>{const marks=[performance.now()];for(let d=0;d<days;d++){const r=__AUDIT__.simulationEngine.advanceTo(__GH_STATE__.simSeconds+86400,{reason:'qa-investor-card-load',speed:300});if(!r.accepted)throw Error(JSON.stringify(r));await new Promise(done=>{const wait=()=>__AUDIT__.simulationEngine.snapshot().manualAdvance?setTimeout(wait,20):done();wait();});marks.push(performance.now());}return marks;},DAYS);
   await settled();const tasks=await page.evaluate(()=>{window.__qaObserver.disconnect();return window.__qaLong;}),end=await counts();await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});
   const day=Array(DAYS).fill(0);for(const [at,ms] of tasks){const next=marks.findIndex(mark=>at<mark);day[next===0?0:next<0?DAYS-1:next-1]+=ms;}
   return {wall:marks[DAYS]-marks[0],day,founder:end.founder-start.founder,journal:end.journal-start.journal,proofs:end.proofs-start.proofs,save:end.save};
  };
  // The app times each open's stages itself (GH_DIAGNOSTICS.recordMainThreadWork); 'ui.render' is building the page and its DOM.
  const pages=async()=>{
   await page.evaluate(()=>{const api=window.GH_DIAGNOSTICS;window.__qaStages=[];window.GH_DIAGNOSTICS={...api,recordMainThreadWork:(s,stage,from,to)=>{window.__qaStages.push([stage,to-from]);return api.recordMainThreadWork(s,stage,from,to);}};});
   const open=async panel=>{await page.evaluate(()=>__AUDIT__.closeDrawer?.());await page.waitForTimeout(100);return page.evaluate(async panel=>{window.__qaStages=[];const t0=performance.now();__AUDIT__.openDrawer(panel);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const stage=name=>window.__qaStages.filter(([k])=>k===name).reduce((n,[,v])=>n+v,0);return {render:stage('ui.render'),open:stage('ui.open'),total:performance.now()-t0,nodes:document.querySelectorAll('#drawerBody *').length};},panel);};
   const best=rows=>({render:Math.min(...rows.map(r=>r.render)),open:Math.min(...rows.map(r=>r.open)),total:Math.min(...rows.map(r=>r.total)),nodes:Math.max(...rows.map(r=>r.nodes))});
   const before=await page.evaluate(()=>JSON.stringify([__GH_STATE__.finance,__GH_STATE__.saveRevision])),runs={investorMode:[],finance:[]};for(let i=0;i<5;i++)for(const panel of Object.keys(runs))runs[panel].push(await open(panel));
   return {investorPage:best(runs.investorMode),financePage:best(runs.finance),unchanged:await page.evaluate(b=>JSON.stringify([__GH_STATE__.finance,__GH_STATE__.saveRevision])===b,before)};
  };
  const quiet=()=>page.evaluate(()=>new Promise(resolve=>setTimeout(()=>requestIdleCallback(()=>resolve(),{timeout:2000}),1000)));
  return {errors,days,pages,quiet,close:async()=>{await browser.close();await env?.closeOrigin?.();}};
 }catch(error){await browser.close();await env?.closeOrigin?.();throw error;}
}
// Both sources at once; a browser that started is closed if the other failed. Both pages settle together (a second,
// then an idle moment) before the work, so the source that booted first has not idled while the other starts on its
// boot's tail.
async function both(roots,work){
 const started=await Promise.allSettled(roots.map(boot)),open=started.filter(r=>r.status==='fulfilled').map(r=>r.value);
 try{const failed=started.find(r=>r.status==='rejected');if(failed)throw failed.reason;await Promise.all(open.map(t=>t.quiet()));return await work(open);}finally{for(const t of open)await t.close();}
}
(async()=>{
 const tree=fs.mkdtempSync(path.join(os.tmpdir(),'b558-'));try{execFileSync('sh',['-c',`git -C "${ROOT}" archive ${PREVIOUS} WebApp | tar -x -C "${tree}"`]);
  // The pages are opened after both sources' first ten days, one source after the other.
  const plays=[];for(let round=0;round<2;round++)plays.push(await both([SOURCE,tree],async([current,old])=>{
   const [now,before]=await Promise.all([current.days(),old.days()]);if(round===0){Object.assign(now,await current.pages());Object.assign(before,await old.pages());}
   for(const t of [current,old])assert.deepEqual(t.errors,[]);return {now,before};}));
  const sum=rows=>rows.reduce((a,b)=>a+b,0),lighter=side=>({days:DAYS,wall:Math.min(...plays.map(p=>p[side].wall)),long:Math.min(...plays.map(p=>sum(p[side].day))),plays:plays.map(p=>({wall:p[side].wall,day:p[side].day.map(Math.round)}))});
  const now={...plays[0].now,...lighter('now')},before={...plays[0].before,...lighter('before')};delete now.day;delete before.day;
  // 1 (in both plays)
  for(const {now,before} of plays){
   assert(now.founder>0,`1: play needed the card (${now.founder})`);assert.equal(now.founder,before.founder,'1: as many founder transfers');assert.equal(now.journal,before.journal,'1: as many journal entries');
   assert(now.proofs<=before.proofs,`1: no bigger proofs (${now.proofs} vs ${before.proofs})`);assert(now.save<=before.save,`1: no bigger save (${now.save} vs ${before.save})`);
  }
  // 2
  assert(now.long<=before.long*1.25+150,`2: long tasks (${now.long.toFixed(0)} vs ${before.long.toFixed(0)} ms, by day ${JSON.stringify(now.plays.map(p=>p.day))} vs ${JSON.stringify(before.plays.map(p=>p.day))})`);assert(now.wall<=before.wall*1.25+300,`2: wall time (${now.wall.toFixed(0)} vs ${before.wall.toFixed(0)} ms)`);
  // 3
  assert(now.unchanged,'3: opening the pages writes nothing');assert(now.investorPage.nodes<=now.financePage.nodes,`3: the investor page builds ${now.investorPage.nodes} elements against the finance overview's ${now.financePage.nodes}`);
  assert(now.investorPage.render>0&&now.investorPage.render<=Math.max(now.financePage.render,1.25)*1.2,`3: building the investor page (${now.investorPage.render.toFixed(1)} ms) against the finance overview (${now.financePage.render.toFixed(1)} ms)`);
  console.log(JSON.stringify({suite:'build558-investor-card-load-browser',ok:true,environment:'Chromium desktop, the days with the CPU throttled 4x, the pages at full speed; not iPhone performance',now,before}));
 }finally{fs.rmSync(tree,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
