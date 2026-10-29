'use strict';
// The keynote in the owner's hall, with the modern slides on its LED screen (owner: «القاعة غير موجوده فقط شاشة»), is no
// heavier than the hall keynote before the full-screen one (owner: «انتبه من الثقل»). Measured on this source and on that
// source (`1d7dce1`, run from its own tree), the same eleven-company conference, at 956×440 with three device pixels per
// point, the processor slowed four times. The reference is the source with the owner's hall in place (owner: «حدث»): measured
// against `f474908`, before the hall, the hall's own cost left the slides at 1.18 to 1.23 of it on the macOS runner (CI
// builds 110 to 113), at the bound; the bounds below are unchanged.
//  1. opening the conference loads the one hall photograph as before and no other conference image, and reaches its
//     first slide no slower than before;
//  2. showing the slides, each through the end of its motion, costs no more main-thread work than before (the
//     browser's own task, style and layout clocks over all the slides); building and laying out a slide costs no more
//     than before (all the slides, and the dearest), and no showing stalls the screen (100 ms) or runs longer than
//     before (the longest task in the lighter half of the eight rounds of showings);
//  3. a slide builds no more elements than before.
// Both sources are open side by side and measured in turn (each opening, then each slide's synchronous cost) or at
// once (the pass through the slides), so a machine that slows down or speeds up during the run weighs on both alike.
// The synchronous costs are taken with the
// processor at full speed: slowed four times, the throttle's own pauses land in them at random, and the same source
// measured 124 to 293 ms over the slides and a longest task of 57 to 253 ms from run to run. Chromium on a desktop;
// not iPhone performance.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process'),{chromium}=require('playwright'),{serve}=require('./helpers/web-server');
const ROOT=path.resolve(__dirname,'..'),SOURCE=process.env.GH_TEST_SOURCE_DIR||ROOT,PREVIOUS='1d7dce1';
async function boot(root){
 const server=await serve(path.join(root,'WebApp'));let browser;try{
  browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:956,height:440},deviceScaleFactor:3,locale:'ar-SA'}),errors=[],images=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.resourceType()==='image')images.push(r.url().replace(/^.*?\/assets\//,'assets/'));});
  await page.goto(server.baseURL);await page.waitForFunction(()=>window.GH_CONF_KEYNOTE&&window.GH_CONFERENCE_3D&&window.GH_CONFERENCE);await page.evaluate(()=>document.fonts.ready);
  await page.evaluate(()=>{
   const types=['air','sea','road','power','bank','mobility','insurance','realestate','telecom','dealership','hospitality'],seed={simSeconds:365*86400,openedCompanies:types,profile:{name:'مجموعة فنتورا العالمية',founder:'مؤسس المجموعة',reputation:75},hired:[],assets:[],globalBases:[],customHubs:[],branches:[],bank:{branches:32},energy:{solarMW:250},mobility:{vehicles:[]},companyRegistry:{}};
   const s=GH_COMPANY_PLATFORM.migrateState(seed).state;GH_FINANCE_CORE.ensure(s);GH_HR_CORE.ensure(s);
   for(let day=0;day<30;day++){const companies=Object.fromEntries(types.map((type,i)=>[type,{grossRevenue:123456789+i*9876543,expenses:23456789+i*12345678,net:100000000-i*2469135}]));GH_FINANCE_CORE.execute({state:s},'record-daily-close',{day,net:Object.values(companies).reduce((sum,r)=>sum+r.net,0),companies});}
   window.qaSnapshot=GH_CONFERENCE.buildSnapshot(s,2026);window.qaLong=[];new PerformanceObserver(list=>{for(const e of list.getEntries())window.qaLong.push(e.duration);}).observe({type:'longtask'});
  });
  const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  return {page,cdp,errors,images,opens:[],openImages:[],cost:[],nodes:[],close:async()=>{await browser.close();await server.close();}};
 }catch(error){await browser?.close();await server.close();throw error;}
}
// 1: from launch to the first slide on screen; the entrance motion is then finished so the other source's turn runs on
// a quiet machine.
async function open(t,run){
 t.images.length=0;t.opens.push(await t.page.evaluate(async()=>{const t0=performance.now();GH_CONFERENCE_3D.launch({snapshot:qaSnapshot},{mode:'manual'});while(GH_CONFERENCE_3D.diagnostics().phase!=='presenting')await new Promise(r=>setTimeout(r,4));await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));const ms=performance.now()-t0;for(const a of document.getAnimations())a.finish();return ms;}));
 if(run===0)t.openImages=[...t.images];if(run<6)await t.page.evaluate(()=>GH_CONFERENCE_3D.close());
}
// 2-3: every slide in order on both sources at once, each shown through the end of its entrance motion (1.4 s), the
// processor slowed four times; each browser's own clocks cover its whole pass. Showing the two together halves the
// gate's time (158 s here one after the other; CI ran gates up to 2.6 times slower than here, and each has 300 s).
async function pass(sources){
 const clock=async t=>Object.fromEntries((await t.cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
 for(const t of sources){await t.cdp.send('Performance.enable');await t.page.evaluate(()=>{window.qaLong=[];GH_CONFERENCE_3D.go(0);});await t.page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));t.slides=await t.page.evaluate(()=>GH_CONFERENCE_3D.diagnostics().slides);}
 const slides=Math.min(...sources.map(t=>t.slides)),start=new Map();for(const t of sources)start.set(t,await clock(t));
 for(let i=0;i<slides;i++){for(const t of sources)t.nodes[i]=await t.page.evaluate(i=>{GH_CONFERENCE_3D.go(i);document.querySelector('.ghc3-beat').getBoundingClientRect();return document.querySelector('.ghc3').getElementsByTagName('*').length;},i);await sources[0].page.waitForTimeout(1400);}
 for(const t of sources){const end=await clock(t),from=start.get(t);t.spent=key=>(end[key]-from[key])*1000;t.passLong=await t.page.evaluate(()=>window.qaLong.slice());}
}
// A slide shown from another slide at full speed: building it and laying it out, synchronously; its motion is finished
// after.
const again=(t,i)=>t.page.evaluate(i=>{GH_CONFERENCE_3D.go(i===0?1:0);document.body.getBoundingClientRect();const t0=performance.now();GH_CONFERENCE_3D.go(i);document.querySelector('.ghc3-beat').getBoundingClientRect();const ms=performance.now()-t0;for(const a of document.getAnimations())a.finish();return ms;},i);
async function result(t){
 const shown=await t.page.evaluate(()=>window.qaShown.slice());await t.page.evaluate(()=>GH_CONFERENCE_3D.close());assert.deepEqual(t.errors,[]);const cost=t.cost;
 const halves=[0,0];for(const [at,ms] of shown){const round=t.rounds.filter(start=>start<=at).length-1;halves[round<6?0:1]=Math.max(halves[round<6?0:1],ms);}
 const opens=t.opens.slice().sort((a,b)=>a-b);
 return {open:opens[Math.floor(opens.length/2)],fastestOpen:opens[0],openImages:t.openImages,slides:t.slides,cost,sync:cost.reduce((a,b)=>a+b,0),worst:Math.max(...cost),task:t.spent('TaskDuration'),style:t.spent('RecalcStyleDuration'),layout:t.spent('LayoutDuration'),script:t.spent('ScriptDuration'),longest:Math.min(...halves),halves,longTasks:shown.length,passLongest:Math.max(0,...t.passLong),passLongTasks:t.passLong.length,nodes:Math.max(...t.nodes)};
}
(async()=>{
 const tree=fs.mkdtempSync(path.join(os.tmpdir(),'b575-'));let old,now;try{execFileSync('sh',['-c',`git -C "${ROOT}" archive ${PREVIOUS} WebApp | tar -x -C "${tree}"`]);
  old=await boot(tree);now=await boot(SOURCE);
  // Seven openings each, taking turns; the median is compared (builds 100 and 101, macOS: the source before's fastest of
  // three opened in 137 ms in one run and 51 ms in the next, the same code; here five builds of the same source, the hall
  // taken out piece by piece, had fastest openings from 113 to 140 ms and medians from 150 to 171 ms).
  for(let run=0;run<7;run++)for(const t of [old,now])await open(t,run);
  await pass([old,now]);
  assert.equal(now.slides,old.slides,'the same slides are shown');
  // Each slide's synchronous cost is the cheapest of twelve showings at full speed (eight before builds 100 and 101), the two sources taking turns slide by
  // slide (six left the sum within 0.92 to 1.07 of the source before under a machine running three other gates); a
  // task of the showings over 50 ms is a long task.
  // Each long task of the showings is placed in its round; a showing that stalls the screen does so in every round, so
  // the longest is taken in the lighter half of the twelve rounds (one macOS probe run saw three long tasks on each
  // source, the longest 84 and 111 ms; the two probe runs before it saw none).
  for(const t of [old,now]){await t.cdp.send('Emulation.setCPUThrottlingRate',{rate:1});await t.page.evaluate(()=>{window.qaLong=[];window.qaShown=[];new PerformanceObserver(list=>{for(const e of list.getEntries())window.qaShown.push([e.startTime,e.duration]);}).observe({type:'longtask'});});t.rounds=[];}
  for(let k=0;k<12;k++){for(const t of [old,now])t.rounds.push(await t.page.evaluate(()=>performance.now()));for(let i=old.slides-1;i>=0;i--)for(const t of [old,now])t.cost[i]=Math.min(t.cost[i]??Infinity,await again(t,i));}
  const before=await result(old),after=await result(now),r=v=>Math.round(v*10)/10;
  const row=m=>({open:r(m.open),fastestOpen:r(m.fastestOpen),slides:m.slides,task:r(m.task),style:r(m.style),layout:r(m.layout),script:r(m.script),passLongest:r(m.passLongest),passLongTasks:m.passLongTasks,sync:r(m.sync),worst:r(m.worst),longest:r(m.longest),halves:m.halves.map(r),longTasks:m.longTasks,nodes:m.nodes,images:m.openImages}),report={before:row(before),after:row(after)};
  assert(before.openImages.some(url=>/assets\/conference\/hall-dark\.webp/.test(url)),`the hall loaded its photograph before: ${JSON.stringify(before.openImages)}`);
  assert.equal(after.openImages.filter(url=>/assets\/conference\//.test(url)).join(),'assets/conference/hall-dark.webp',`1: the one hall photograph is loaded, as before, and no other conference image: ${JSON.stringify(after.openImages)}`);
  assert(after.open<=before.open*1.1+2,`1: the first slide is on screen no slower than before (the median of seven openings): ${JSON.stringify(report)}`);
  assert(after.task<=before.task*1.15&&after.style+after.layout<=(before.style+before.layout)*1.15,`2: the slides cost no more main-thread work in total than before: ${JSON.stringify(report)}`);
  assert(after.sync<=before.sync*1.15,`2: building and laying out the slides costs no more than before: ${JSON.stringify(report)}`);
  // One slide's few milliseconds vary from run to run on a desktop; the dearest slide is compared, not each slide.
  assert(after.worst<=before.worst*1.5+2,`2: the dearest slide costs no more than before: ${JSON.stringify(report)}`);
  assert(after.longest<=Math.max(100,before.longest*1.15),`2: no showing stalls the screen (100 ms) or runs longer than before: ${JSON.stringify(report)}`);
  assert(after.nodes<=before.nodes,`3: no more elements than before: ${JSON.stringify(report)}`);
  console.log(JSON.stringify({suite:'build575-conference-keynote-weight-browser',ok:true,previous:PREVIOUS,...report}));
 }finally{await old?.close();await now?.close();fs.rmSync(tree,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
