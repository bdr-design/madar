'use strict';
// Battery (owner: «موضوع استهلاك البطارية وش المسببات»). Measured in the real app (2,112 leased aircraft, 956×440): the
// frame loop asked for every display frame, 60 a second, with the game paused and the map still, and through the whole
// conference; the simulation ticked 60 times a second through the conference, which suspends it; the signature audit
// kept verifying every proof again and again while the game was paused and nothing changed. Proven on this source and
// on the source before it (`6511258`, from its own tree):
//  1. paused, with the map still, the loop runs about four passes a second instead of sixty, and the main thread works
//     at most half as much as before;
//  2. through the conference the loop and the simulation's ticks rest the same way, at most half the work;
//  3. playing is unchanged: frames at the display rate, the same ticks and game time per second, and no more work
//     than before beyond a desktop's variation between windows;
//  4. the loop wakes at once when the game resumes, when the conference closes, when the map is let go after a drag and
//     for a calendar advance, and keeps the display rate while the diagnostics recorder samples frames;
//  5. paused, after a command the signature audit runs one whole cycle and then waits while nothing changes; the next
//     command wakes it, and it runs on while the game plays.
// Chromium on a desktop; not iPhone battery. The loop's housekeeping (the save cap, map refresh) runs on each rested
// pass and is not measured here.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const {bootAtOrigin,installVault}=require('./helpers/differential-vault-fixture.cjs'),{prepareCommandWorld}=require('./helpers/command-world-fixture.cjs');
const ROOT=path.resolve(__dirname,'..'),SOURCE=process.env.GH_TEST_SOURCE_DIR||ROOT,PREVIOUS='6511258';
const counters=()=>{window.__qaFrames=0;const raf=window.requestAnimationFrame.bind(window);window.requestAnimationFrame=cb=>raf(t=>{window.__qaFrames++;cb(t);});};
const CONFERENCE={year:2026,group:{name:'المجموعة',grossRevenue:500000,expenses:100000,net:400000,reportedDays:30,expectedDays:365,dataQuality:{status:'ok'}},companies:[],social:{}};
async function run(root,full){
 const browser=await chromium.launch({headless:true}),errors=[];let env;try{
  env=await bootAtOrigin({browser,root,errors,fleetWorker:true,viewport:{width:956,height:440},beforeScripts:{run:async page=>{await page.evaluate(installVault);await page.evaluate(counters);}}});const {page}=env;page.setDefaultTimeout(120000);
  await prepareCommandWorld(page,{count:2});const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');
  const busy=async()=>(await cdp.send('Performance.getMetrics')).metrics.find(m=>m.name==='TaskDuration').value*1000;
  const sample=()=>page.evaluate(()=>({frames:window.__qaFrames,ticks:__AUDIT__.simulationRuntime.snapshot().ticks,sim:__GH_STATE__.simSeconds,at:performance.now()}));
  const measure=async(ms=3000)=>{await page.waitForTimeout(1200);const a=await sample(),b0=await busy();await page.waitForTimeout(ms);const b=await sample(),b1=await busy(),s=(b.at-a.at)/1000;return {frames:(b.frames-a.frames)/s,ticks:(b.ticks-a.ticks)/s,sim:(b.sim-a.sim)/s,busy:(b1-b0)/s};};
  const speed=v=>page.evaluate(v=>{const s=__GH_STATE__;if(v===0){if(s.speed>0)document.getElementById('speedToggle').click();}else{if(s.speed===0)document.getElementById('speedToggle').click();[...document.querySelectorAll('#speedMenu button[data-speed]')].find(b=>Number(b.dataset.speed)===v).click();}return s.speed;},v);
  await page.evaluate(()=>__AUDIT__.closeDrawer?.());
  const out={};
  // Playing is measured twice and the lighter window kept: a desktop's busy time varies by a third between windows.
  await speed(1);const play=[await measure(),await measure()];out.play=play[0].busy<=play[1].busy?play[0]:play[1];
  await speed(0);out.paused=await measure();
  await speed(1);await page.evaluate(c=>GH_CONFERENCE_3D.launch({snapshot:c},{mode:'manual'}),CONFERENCE);out.conference=await measure();await page.evaluate(()=>GH_CONFERENCE_3D.close());
  if(full){
   // 4: waking. Each starts from a resting loop (a pass every 250 ms) and times the loop's next pass after the act; a
   // pass that waited for the rest would take 125 ms on average and up to 250 ms. The game time is read 1.5 s later
   // (the simulation advances in slices of at least one second).
   const latency=kind=>page.evaluate(async kind=>{const f0=window.__qaFrames,t0=performance.now();
    if(kind==='resume')document.getElementById('speedToggle').click();else if(kind==='close')GH_CONFERENCE_3D.close();else if(kind==='release'){const map=__AUDIT__.leafletMap();map.fire('movestart');map.fire('moveend');}
    else if(kind==='calendar')__AUDIT__.requestCalendarAdvance(Math.floor(__GH_STATE__.simSeconds/86400+1)*86400,'qa-presentation-rest','QA');
    while(window.__qaFrames===f0)await new Promise(r=>setTimeout(r,2));return performance.now()-t0;},kind);
   const timed=async(kind,before)=>{const runs=[];for(let i=0;i<5;i++){await before();await page.waitForTimeout(700);runs.push(await latency(kind));}return Math.max(...runs);};
   const simAfter=async()=>{const a=await sample();await page.waitForTimeout(1500);return (await sample()).sim-a.sim;};
   out.resumeMs=await timed('resume',()=>speed(0));out.resumeSim=await simAfter();
   out.closeMs=await timed('close',()=>page.evaluate(c=>GH_CONFERENCE_3D.launch({snapshot:c},{mode:'manual'}),CONFERENCE));out.closeSim=await simAfter();
   await speed(0);out.releaseMs=await timed('release',async()=>{});out.afterRelease=await measure(1500);
   const a=await sample();out.calendarMs=await latency('calendar');await page.waitForTimeout(400);out.calendar={frames:((await sample()).frames-a.frames)/((await sample()).at-a.at)*1000};
   await page.waitForFunction(()=>!__AUDIT__.simulationEngine.snapshot().manualAdvance,null,{timeout:60000});out.afterCalendar=await measure(1500);
   await page.evaluate(()=>GH_DIAGNOSTICS.recorderStart(__GH_STATE__,__AUDIT__.simulationEngine.snapshot()));out.recorder=await measure(1500);await page.evaluate(()=>GH_DIAGNOSTICS.recorderStop(__GH_STATE__,__AUDIT__.simulationEngine.snapshot()));
   // 5: the audit, paused: one whole cycle, then nothing until a command; playing, it runs on.
   const audit=()=>page.evaluate(()=>({checked:window.__GH_APP_RUNTIME_INSTRUMENTATION__.proofAudit?.totalChecked||0,cycles:window.__GH_APP_RUNTIME_INSTRUMENTATION__.proofAudit?.cycles||0}));
   const transfer=note=>page.evaluate(note=>__AUDIT__.runAuthorizedDomainCommand('finance','transfer',{from:'air',to:'sea',amount:1000,note},{silent:true}),note);
   await transfer('QA audit change');const cycles0=(await audit()).cycles;await page.waitForFunction(c=>(window.__GH_APP_RUNTIME_INSTRUMENTATION__.proofAudit?.cycles||0)>c,cycles0,{timeout:120000});
   const rest0=await audit();await page.waitForTimeout(2500);const rest1=await audit();out.auditResting=rest1.checked-rest0.checked;
   await transfer('QA audit resume');await page.waitForTimeout(2500);out.auditAfterCommand=(await audit()).checked-rest1.checked;
   await speed(1);const play0=await audit();await page.waitForTimeout(2500);out.auditPlaying=(await audit()).checked-play0.checked;
  }
  assert.deepEqual(errors,[]);return out;
 }finally{await browser.close();await env?.closeOrigin?.();}
}
(async()=>{
 const tree=fs.mkdtempSync(path.join(os.tmpdir(),'b576-'));try{execFileSync('sh',['-c',`git -C "${ROOT}" archive ${PREVIOUS} WebApp | tar -x -C "${tree}"`]);
  const before=await run(tree,false),after=await run(SOURCE,true),r=v=>Math.round(v*10)/10,row=m=>Object.fromEntries(Object.entries(m).map(([k,v])=>[k,typeof v==='object'&&v?Object.fromEntries(Object.entries(v).map(([a,b])=>[a,r(b)])):v]));
  const report={before:row(before),after:row(after)},show=JSON.stringify(report);
  assert(before.paused.frames>=45&&before.conference.frames>=45&&before.conference.ticks>=45,`the loop and the ticks ran at the display rate before: ${show}`);
  // 1
  assert(after.paused.frames<=8,`1: paused, the loop rests: ${show}`);assert(after.paused.busy<=before.paused.busy*.5,`1: paused, at most half the work: ${show}`);
  // 2
  assert(after.conference.frames<=8&&after.conference.ticks<=8,`2: through the conference the loop and the ticks rest: ${show}`);assert(after.conference.busy<=before.conference.busy*.5,`2: at most half the work: ${show}`);
  // 3
  assert(after.play.frames>=45&&Math.abs(after.play.ticks-before.play.ticks)<=6,`3: playing keeps the display rate and the ticks: ${show}`);assert(Math.abs(after.play.sim-before.play.sim)<=before.play.sim*.1,`3: the same game time per second: ${show}`);assert(after.play.busy<=before.play.busy*1.5,`3: no more work playing (within a desktop's variation): ${show}`);
  // 4
  assert(after.resumeMs<=60&&after.resumeSim>0,`4: resuming wakes the loop at once and the game runs: ${show}`);
  assert(after.closeMs<=300&&after.closeSim>0,`4: closing the conference brings the loop and the game back within a rested pass: ${show}`);
  assert(after.releaseMs<=60,`4: letting go of the map wakes the loop at once: ${show}`);assert(after.afterRelease.frames<=8,`4: and it rests again once the map is still: ${show}`);
  assert(after.calendarMs<=60&&after.calendar.frames>=30,`4: a calendar advance wakes the loop to the display rate: ${show}`);assert(after.afterCalendar.frames<=8,`4: and it rests again after: ${show}`);
  assert(after.recorder.frames>=45,`4: the recorder keeps the display rate: ${show}`);
  // 5
  assert.equal(after.auditResting,0,`5: paused and unchanged, the audit waits: ${show}`);assert(after.auditAfterCommand>0,`5: a command wakes the audit: ${show}`);assert(after.auditPlaying>0,`5: playing, the audit runs on: ${show}`);
  console.log(JSON.stringify({suite:'build576-presentation-rest-browser',ok:true,previous:PREVIOUS,...report}));
 }finally{fs.rmSync(tree,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
