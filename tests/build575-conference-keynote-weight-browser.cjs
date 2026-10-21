'use strict';
// The full-screen keynote is no heavier than the hall it replaces (owner: «انتبه من الثقل»). Measured on this source and
// on the source before it (`f474908`, run from its own tree), the same eleven-company conference, at 956×440 with three
// device pixels per point, the processor slowed four times:
//  1. opening the conference loads no hall photograph and reaches its first slide no slower than before;
//  2. showing the slides, each through the end of its motion, costs no more main-thread work than before (the
//     browser's own task, style and layout clocks over all the slides, the synchronous work of building and laying them
//     out, and the dearest slide), and no task stalls the screen (100 ms) or runs longer than before;
//  3. a slide builds no more elements than before.
// Chromium on a desktop with the CPU throttled 4x; not iPhone performance.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process'),{chromium}=require('playwright'),{serve}=require('./helpers/web-server');
const ROOT=path.resolve(__dirname,'..'),SOURCE=process.env.GH_TEST_SOURCE_DIR||ROOT,PREVIOUS='f474908';
async function measure(root){
 const server=await serve(path.join(root,'WebApp')),browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:956,height:440},deviceScaleFactor:3,locale:'ar-SA'}),errors=[],images=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.resourceType()==='image')images.push(r.url().replace(/^.*?\/assets\//,'assets/'));});try{
  await page.goto(server.baseURL);await page.waitForFunction(()=>window.GH_CONF_KEYNOTE&&window.GH_CONFERENCE_3D&&window.GH_CONFERENCE);await page.evaluate(()=>document.fonts.ready);
  await page.evaluate(()=>{
   const types=['air','sea','road','power','bank','mobility','insurance','realestate','telecom','dealership','hospitality'],seed={simSeconds:365*86400,openedCompanies:types,profile:{name:'مجموعة فنتورا العالمية',founder:'مؤسس المجموعة',reputation:75},hired:[],assets:[],globalBases:[],customHubs:[],branches:[],bank:{branches:32},energy:{solarMW:250},mobility:{vehicles:[]},companyRegistry:{}};
   const s=GH_COMPANY_PLATFORM.migrateState(seed).state;GH_FINANCE_CORE.ensure(s);GH_HR_CORE.ensure(s);
   for(let day=0;day<30;day++){const companies=Object.fromEntries(types.map((type,i)=>[type,{grossRevenue:123456789+i*9876543,expenses:23456789+i*12345678,net:100000000-i*2469135}]));GH_FINANCE_CORE.execute({state:s},'record-daily-close',{day,net:Object.values(companies).reduce((sum,r)=>sum+r.net,0),companies});}
   window.qaSnapshot=GH_CONFERENCE.buildSnapshot(s,2026);window.qaLong=[];new PerformanceObserver(list=>{for(const e of list.getEntries())window.qaLong.push(e.duration);}).observe({type:'longtask'});
  });
  const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  // 1: opening, three times, from launch to the first slide on screen.
  const opens=[];let openImages=[];
  for(let run=0;run<3;run++){images.length=0;opens.push(await page.evaluate(async()=>{const t0=performance.now();GH_CONFERENCE_3D.launch({snapshot:qaSnapshot},{mode:'manual'});while(GH_CONFERENCE_3D.diagnostics().phase!=='presenting')await new Promise(r=>setTimeout(r,4));await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));return performance.now()-t0;}));if(run===0)openImages=[...images];if(run<2)await page.evaluate(()=>GH_CONFERENCE_3D.close());}
  // 2-3: every slide in order, each shown through the end of its entrance motion (1.4 s); the browser's clocks cover the
  // whole pass. The synchronous work of each slide (building it and laying it out) is the cheapest of six showings.
  await cdp.send('Performance.enable');const clock=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
  await page.evaluate(()=>{window.qaLong=[];GH_CONFERENCE_3D.go(0);});await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
  const slides=await page.evaluate(()=>GH_CONFERENCE_3D.diagnostics().slides),cost=[],nodes=[],start=await clock();
  for(let i=0;i<slides;i++){const m=await page.evaluate(i=>{const t0=performance.now();GH_CONFERENCE_3D.go(i);document.querySelector('.ghc3-beat').getBoundingClientRect();return {ms:performance.now()-t0,nodes:document.querySelector('.ghc3').getElementsByTagName('*').length};},i);cost[i]=m.ms;nodes[i]=m.nodes;await page.waitForTimeout(1400);}
  const end=await clock(),spent=key=>(end[key]-start[key])*1000;
  for(let k=0;k<5;k++)for(let i=slides-1;i>=0;i--)cost[i]=Math.min(cost[i],await page.evaluate(i=>{GH_CONFERENCE_3D.go(i===0?1:0);document.body.getBoundingClientRect();const t0=performance.now();GH_CONFERENCE_3D.go(i);document.querySelector('.ghc3-beat').getBoundingClientRect();return performance.now()-t0;},i));
  const long=await page.evaluate(()=>window.qaLong.slice());await page.evaluate(()=>GH_CONFERENCE_3D.close());
  assert.deepEqual(errors,[]);
  return {open:Math.min(...opens),openImages,slides,cost,sync:cost.reduce((a,b)=>a+b,0),worst:Math.max(...cost),task:spent('TaskDuration'),style:spent('RecalcStyleDuration'),layout:spent('LayoutDuration'),script:spent('ScriptDuration'),longest:Math.max(0,...long),longTasks:long.length,nodes:Math.max(...nodes)};
 }finally{await browser.close();await server.close();}
}
(async()=>{
 const tree=fs.mkdtempSync(path.join(os.tmpdir(),'b575-'));try{execFileSync('sh',['-c',`git -C "${ROOT}" archive ${PREVIOUS} WebApp | tar -x -C "${tree}"`]);
  const before=await measure(tree),after=await measure(SOURCE),r=v=>Math.round(v*10)/10;
  const row=m=>({open:r(m.open),slides:m.slides,task:r(m.task),style:r(m.style),layout:r(m.layout),script:r(m.script),sync:r(m.sync),worst:r(m.worst),longest:r(m.longest),longTasks:m.longTasks,nodes:m.nodes,images:m.openImages}),report={before:row(before),after:row(after)};
  assert.equal(after.slides,before.slides,'the same slides are shown');
  assert(before.openImages.some(url=>/assets\/conference\/hall-dark\.webp/.test(url)),`the hall loaded its photograph before: ${JSON.stringify(before.openImages)}`);
  assert(!after.openImages.some(url=>/assets\/conference\//.test(url)),`1: no hall photograph is loaded: ${JSON.stringify(after.openImages)}`);
  assert(after.open<=before.open*1.1+2,`1: the first slide is on screen no slower than before: ${JSON.stringify(report)}`);
  assert(after.task<=before.task*1.15&&after.style+after.layout<=(before.style+before.layout)*1.15,`2: the slides cost no more main-thread work in total than before: ${JSON.stringify(report)}`);
  assert(after.sync<=before.sync*1.15,`2: building and laying out the slides costs no more than before: ${JSON.stringify(report)}`);
  // One slide's few milliseconds vary from run to run on a desktop; the dearest slide is compared, not each slide.
  assert(after.worst<=before.worst*1.5+2,`2: the dearest slide costs no more than before: ${JSON.stringify(report)}`);
  assert(after.longest<=Math.max(100,before.longest*1.15),`2: no task stalls the screen (100 ms) or runs longer than before: ${JSON.stringify(report)}`);
  assert(after.nodes<=before.nodes,`3: no more elements than before: ${JSON.stringify(report)}`);
  console.log(JSON.stringify({suite:'build575-conference-keynote-weight-browser',ok:true,previous:PREVIOUS,...report}));
 }finally{fs.rmSync(tree,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
