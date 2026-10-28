'use strict';
// Battery (owner: «موضوع استهلاك البطارية وش المسببات»). Measured in the real app (2,112 leased aircraft, 956×440): the
// frame loop asked for every display frame, 60 a second, with the game paused and the map still, and through the whole
// conference; the simulation ticked 60 times a second through the conference, which suspends it; the signature audit
// kept verifying every proof again and again while the game was paused and nothing changed. Proven on this source and
// on the source before it (`6511258`, from its own tree):
//  1. paused, with the map still, the loop runs about four passes a second instead of sixty, and the main thread works
//     at most half as much as before;
//  2. through the conference the loop, the simulation's ticks and, once it has gone through every proof, the signature
//     audit rest the same way, at most half the work, and a command through the conference wakes the audit until its
//     cycle ends, then it waits again. Build 89's macOS runner (31 frames and 29 ticks a second) found
//     9.6 ms a second against 18.2: the audit went through every proof again and again through the conference, which
//     suspends the game (158 proofs a second here); with frames and timers held to that rate here, 9.6 ms a second, and
//     4.4 to 5.1 once the audit waits;
//  3. playing is unchanged: frames at the display rate, the same ticks for the page's timer rate and game time per
//     second, and no more work than before beyond a desktop's variation between windows;
//  4. the loop wakes at once when the game resumes, when the map is let go after a drag and for a calendar advance (as
//     soon as the loop that never rested reached its next frame), within one rested pass when the conference closes,
//     and keeps the display rate while the diagnostics recorder samples frames;
//  5. paused, after a command the signature audit runs one whole cycle and then waits while nothing changes; the next
//     command wakes it, and it runs on while the game plays.
// Frame and tick rates are compared within the same seconds: the macOS runner's display rate drifts from one window to
// the next (build 90: 33.9 to 46.5 frames a second for the source before, 26.6 to 43.3 for this one), and build 90
// stopped at claim 3 on two sources measured in turn. Both sources are open side by side: playing, both are measured
// at once, twice; the calendar advance runs on both at once; the recorder's frames are set against the source before's
// in the same window (its loop never rests); the source before's paused and conference frames against its display
// rate, and its conference ticks against a 16 ms timer's rate (its simulation's live cadence), both counted by
// callbacks of the test's own in a window of its own after its work windows. The work at rest is compared on each
// source's lighter of two windows (claims 1 and 2), which count nothing of the test's own. Wake-ups are compared with
// the source before on the same machine, so a runner with slower frames (CI run 83: 116 ms apart in a busy close)
// holds them to its own display rate; each source alone is measured paused and waking while the other stays paused,
// but for the calendar advance, which runs on both. Chromium on a desktop; not iPhone battery. The loop's housekeeping
// (the save cap, map refresh) runs on each rested pass and is not measured here.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const {bootAtOrigin,installVault}=require('./helpers/differential-vault-fixture.cjs'),{prepareCommandWorld}=require('./helpers/command-world-fixture.cjs');
const ROOT=path.resolve(__dirname,'..'),SOURCE=process.env.GH_TEST_SOURCE_DIR||ROOT,PREVIOUS='6511258';
const counters=()=>{window.__qaFrames=0;window.__qaDisplay=0;window.__qaTimer=0;const raf=window.requestAnimationFrame.bind(window);window.requestAnimationFrame=cb=>raf(t=>{window.__qaFrames++;cb(t);});
 // The display rate and a 16 ms timer's rate (the simulation's live cadence), counted by callbacks of the test's own,
 // apart from the page's, only while asked.
 window.__qaReferenceCount=on=>{const run=window.__qaReferenceRun=(window.__qaReferenceRun||0)+1;if(!on)return;const live=()=>window.__qaReferenceRun===run;
  const frame=()=>{if(!live())return;window.__qaDisplay++;raf(frame);},timer=()=>{if(!live())return;window.__qaTimer++;setTimeout(timer,16);};raf(frame);setTimeout(timer,16);};};
const CONFERENCE={year:2026,group:{name:'المجموعة',grossRevenue:500000,expenses:100000,net:400000,reportedDays:30,expectedDays:365,dataQuality:{status:'ok'}},companies:[],social:{}};
async function boot(root){
 const browser=await chromium.launch({headless:true}),errors=[];let env;try{
  env=await bootAtOrigin({browser,root,errors,fleetWorker:true,viewport:{width:956,height:440},beforeScripts:{run:async page=>{await page.evaluate(installVault);await page.evaluate(counters);}}});const {page}=env;page.setDefaultTimeout(120000);
  await prepareCommandWorld(page,{count:2});const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');
  const busy=async()=>(await cdp.send('Performance.getMetrics')).metrics.find(m=>m.name==='TaskDuration').value*1000;
  const sample=()=>page.evaluate(()=>({frames:window.__qaFrames,display:window.__qaDisplay,timer:window.__qaTimer,ticks:__AUDIT__.simulationRuntime.snapshot().ticks,sim:__GH_STATE__.simSeconds,at:performance.now()}));
  const measure=async(ms=3000)=>{await page.waitForTimeout(1200);const a=await sample(),b0=await busy();await page.waitForTimeout(ms);const b=await sample(),b1=await busy(),s=(b.at-a.at)/1000;return {frames:(b.frames-a.frames)/s,ticks:(b.ticks-a.ticks)/s,sim:(b.sim-a.sim)/s,busy:(b1-b0)/s,display:(b.display-a.display)/s,timer:(b.timer-a.timer)/s};};
  const referenceCount=on=>page.evaluate(on=>window.__qaReferenceCount(on),on);
  const speed=v=>page.evaluate(v=>{const s=__GH_STATE__;if(v===0){if(s.speed>0)document.getElementById('speedToggle').click();}else{if(s.speed===0)document.getElementById('speedToggle').click();[...document.querySelectorAll('#speedMenu button[data-speed]')].find(b=>Number(b.dataset.speed)===v).click();}return s.speed;},v);
  await page.evaluate(()=>__AUDIT__.closeDrawer?.());
  return {page,errors,sample,measure,speed,referenceCount,close:async()=>{await browser.close();await env?.closeOrigin?.();}};
 }catch(error){await browser.close();await env?.closeOrigin?.();throw error;}
}
async function alone(t,current,ref){
 const {page,sample,measure,speed,referenceCount}=t,out={};
 const audit=()=>page.evaluate(()=>{const i=window.__GH_APP_RUNTIME_INSTRUMENTATION__;return {checked:i.proofAudit?.totalChecked||0,cycles:i.proofAudit?.cycles||0,renders:i.simRender?.count||0};});
 const transfer=note=>page.evaluate(note=>__AUDIT__.runAuthorizedDomainCommand('finance','transfer',{from:'air',to:'sea',amount:1000,note},{silent:true}),note);
 // Paused and through the conference, two windows each. The work compared is each source's lighter window: a desktop's
 // work comes in bursts (a periodic check costs some 60 ms now and then, alike on both sources), and one 3 s window may
 // catch a burst on one source and not the other, as build 91's did (8.9 ms a second against 8.5 on its faster runner,
 // 3.2 on build 90's). The loop's and the ticks' rest must hold in both windows. These windows count nothing of the
 // test's own; then the source before alone takes a third window counting its display rate and a 16 ms timer's rate,
 // the references in the same seconds for its frames and ticks.
 const twice=async()=>{const w=[await measure(),await measure()];return {busy:Math.min(w[0].busy,w[1].busy),busyMax:Math.max(w[0].busy,w[1].busy),frames:Math.max(w[0].frames,w[1].frames),ticks:Math.max(w[0].ticks,w[1].ticks),sim:Math.max(w[0].sim,w[1].sim)};};
 const reference=async()=>{await referenceCount(true);const w=await measure();await referenceCount(false);return w;};
 await speed(0);out.paused=await twice();if(!current)out.pausedReference=await reference();
 // 2: the conference opens with the game running, as in play, and is measured on both sources once the audit has ended
 // the cycle it was in, or has checked nothing through four render callbacks (it may rest at once: nothing changed
 // since the pause), at most 10 s; the proofs it checks through the window are counted.
 await speed(1);await page.evaluate(c=>GH_CONFERENCE_3D.launch({snapshot:c},{mode:'manual'}),CONFERENCE);
 {const start=await audit();let last=start;for(let i=0;i<20;i++){await page.waitForTimeout(500);const now=await audit();if(now.cycles>start.cycles)break;if(now.checked!==last.checked)last=now;else if(now.renders-last.renders>=4)break;}}
 const conferenceAudit=await audit();out.conference=await twice();out.conferenceAudit=(await audit()).checked-conferenceAudit.checked;if(!current)out.conferenceReference=await reference();
 if(current){
  // 2: a command through the conference wakes the audit: it steps until its cycle ends (a resting audit takes no step,
  // so a cycle ending is the wake; it may end the cycle a speed change began), then waits again.
  const revision=await page.evaluate(()=>__GH_STATE__.saveRevision),woke0=await audit();await transfer('QA audit through the conference');
  out.conferenceCommandSaved=await page.evaluate(r=>__GH_STATE__.saveRevision>r,revision);
  out.conferenceAuditWoke=await page.waitForFunction(c=>(window.__GH_APP_RUNTIME_INSTRUMENTATION__.proofAudit?.cycles||0)>c,woke0.cycles,{timeout:60000}).then(()=>true,()=>false);
  const woke1=await audit();out.conferenceAuditWokeChecked=woke1.checked-woke0.checked;await page.waitForTimeout(2500);out.conferenceAuditAfter=(await audit()).checked-woke1.checked;
 }
 await page.evaluate(()=>GH_CONFERENCE_3D.close());
 {
  // 4: waking. Each starts from a resting loop (a pass every 250 ms; the source before never rested) and times the
  // loop's next pass after the act; a pass that waited for the rest would take up to 250 ms more. The game time is read
  // 1.5 s later (the simulation advances in slices of at least one second).
  const latencyOn=(p,kind)=>p.evaluate(async kind=>{const f0=window.__qaFrames,t0=performance.now();
   if(kind==='resume')document.getElementById('speedToggle').click();else if(kind==='close')GH_CONFERENCE_3D.close();else if(kind==='release'){const map=__AUDIT__.leafletMap();map.fire('movestart');map.fire('moveend');}
   else if(kind==='calendar')__AUDIT__.requestCalendarAdvance(Math.floor(__GH_STATE__.simSeconds/86400+1)*86400,'qa-presentation-rest','QA');
   while(window.__qaFrames===f0)await new Promise(r=>setTimeout(r,2));return performance.now()-t0;},kind),latency=kind=>latencyOn(page,kind);
  const timed=async(kind,before)=>{const runs=[];for(let i=0;i<5;i++){await before();await page.waitForTimeout(700);runs.push(await latency(kind));}return Math.max(...runs);};
  const simAfter=async()=>{const a=await sample();await page.waitForTimeout(1500);return (await sample()).sim-a.sim;};
  out.resumeMs=await timed('resume',()=>speed(0));out.resumeSim=await simAfter();
  out.closeMs=await timed('close',()=>page.evaluate(c=>GH_CONFERENCE_3D.launch({snapshot:c},{mode:'manual'}),CONFERENCE));out.closeSim=await simAfter();
  await speed(0);out.releaseMs=await timed('release',async()=>{});out.afterRelease=await measure(1500);
  // With the source before at hand (ref), the calendar advance runs on both at once, the same work in the same seconds,
  // and the recorder's frames are set against the source before's frames through the same window.
  // The display rate through the advance is counted over 1.5 s of it, or to its end if sooner (builds 103 and 104, macOS,
  // the same app: 400 ms, seven to nine frames there, met the advance's day close in one run and not in the other; the
  // advance lasts about 3.9 s here on either source).
  const calendarWindow=async p=>{const a=await p.sample(),ms=await latencyOn(p.page,'calendar');await p.page.waitForFunction(()=>!__AUDIT__.simulationEngine.snapshot().manualAdvance,null,{timeout:1500,polling:50}).catch(()=>{});const b=await p.sample();return {ms,frames:(b.frames-a.frames)/(b.at-a.at)*1000};};
  const advanced=p=>p.page.waitForFunction(()=>!__AUDIT__.simulationEngine.snapshot().manualAdvance,null,{timeout:60000});
  const [calendar,calendarReference]=await Promise.all([calendarWindow(t),ref&&calendarWindow(ref)]);out.calendarMs=calendar.ms;out.calendar={frames:calendar.frames};if(ref)out.calendarReference={frames:calendarReference.frames};
  await Promise.all([advanced(t),ref&&advanced(ref)]);out.afterCalendar=await measure(1500);
  await page.evaluate(()=>GH_DIAGNOSTICS.recorderStart(__GH_STATE__,__AUDIT__.simulationEngine.snapshot()));
  const [recorder,recorderReference]=await Promise.all([measure(1500),ref&&ref.measure(1500)]);out.recorder=recorder;if(ref)out.recorderReference=recorderReference;
  await page.evaluate(()=>GH_DIAGNOSTICS.recorderStop(__GH_STATE__,__AUDIT__.simulationEngine.snapshot()));
 }
 if(current){
  // 5: the audit, paused: one whole cycle, then nothing until a command; playing, it runs on.
  await speed(0);await transfer('QA audit change');const cycles0=(await audit()).cycles;
  // Build 103 (macOS) timed out here; what holds the audit is reported with the timeout (the claim is unchanged).
  try{await page.waitForFunction(c=>(window.__GH_APP_RUNTIME_INSTRUMENTATION__.proofAudit?.cycles||0)>c,cycles0,{timeout:120000});}
  catch(error){const held=await page.evaluate(async()=>{const i=window.__GH_APP_RUNTIME_INSTRUMENTATION__,s=__GH_STATE__,renders0=i.simRender?.count||0;await new Promise(r=>setTimeout(r,3000));return {speed:s.speed,conference:window.GH_CONFERENCE?.isPresentationActive?.()===true,locked:GH_PERSISTENCE.isLocked(),durable:!!window.__GH_DURABLE_COMMAND_CONTEXT__,hidden:document.hidden,sim:__AUDIT__.simulationEngine.snapshot(),audit:i.proofAudit,renders:[renders0,i.simRender?.count||0],saveRevision:s.saveRevision,events:(s.diagnostics?.events||[]).slice(0,8).map(e=>[e.type,e.severity])};}).catch(e=>String(e));throw new Error(`5: the audit's cycle did not finish while paused: ${JSON.stringify(held).slice(0,3000)} (${error.message.split('\n')[0]})`);}
  const rest0=await audit();await page.waitForTimeout(2500);const rest1=await audit();out.auditResting=rest1.checked-rest0.checked;
  await transfer('QA audit resume');await page.waitForTimeout(2500);out.auditAfterCommand=(await audit()).checked-rest1.checked;
  await speed(1);const play0=await audit();await page.waitForTimeout(2500);out.auditPlaying=(await audit()).checked-play0.checked;
 }
 await speed(0);assert.deepEqual(t.errors,[]);return out;
}
(async()=>{
 const tree=fs.mkdtempSync(path.join(os.tmpdir(),'b576-'));let old,now;try{execFileSync('sh',['-c',`git -C "${ROOT}" archive ${PREVIOUS} WebApp | tar -x -C "${tree}"`]);
  old=await boot(tree);now=await boot(SOURCE);
  // 3: playing, both sources measured at once in the same two windows (the runner's rates and a desktop's busy time drift
  // between windows, alike for both in the same seconds); each keeps its mean over the two. Each page also counts its
  // display and a 16 ms timer (its simulation's live cadence) in those seconds: the runner gives each page a timer rate
  // of its own (in the probe before build 93, 25.9 ticks a second for the source before against 29.2 for this one in
  // the same windows, the frames 26.6 against 26.4; in six other runs within 4%), and a page's ticks follow its timer
  // (through the conference, where its simulation never rests, the source before ticked 25.6 to 37.2 times a second,
  // each run equal to its own timer's count).
  await old.speed(1);await now.speed(1);await Promise.all([old.referenceCount(true),now.referenceCount(true)]);const plays=[[],[]];for(let k=0;k<2;k++){const [a,b]=await Promise.all([old.measure(),now.measure()]);plays[0].push(a);plays[1].push(b);}
  await Promise.all([old.referenceCount(false),now.referenceCount(false)]);
  const mean=rows=>Object.fromEntries(Object.keys(rows[0]).map(k=>[k,(rows[0][k]+rows[1][k])/2]));await old.speed(0);await now.speed(0);
  // 1, 2, 4 and 5: each source alone, the other paused; the source before is the reference for this one's calendar
  // advance and recorder.
  const before={play:mean(plays[0]),...await alone(old,false)},after={play:mean(plays[1]),...await alone(now,true,old)};
  assert.deepEqual(old.errors,[],'the source before ran without errors as the reference');
  const r=v=>Math.round(v*10)/10,row=m=>Object.fromEntries(Object.entries(m).map(([k,v])=>[k,typeof v==='object'&&v?Object.fromEntries(Object.entries(v).map(([a,b])=>[a,r(b)])):v]));
  const report={before:row(before),after:row(after)},show=JSON.stringify(report);
  const kept=(w,rate,reference)=>w[reference]>0&&w[rate]>=w[reference]*.8;
  assert(kept(before.pausedReference,'frames','display')&&kept(before.conferenceReference,'frames','display')&&kept(before.conferenceReference,'ticks','timer'),`the loop and the ticks ran at the display rate before: ${show}`);
  // 1
  assert(after.paused.frames<=8,`1: paused, the loop rests: ${show}`);assert(after.paused.busy<=before.paused.busy*.5,`1: paused, at most half the work: ${show}`);
  // 2
  assert(after.conference.frames<=8&&after.conference.ticks<=8,`2: through the conference the loop and the ticks rest: ${show}`);assert(after.conference.busy<=before.conference.busy*.5,`2: at most half the work: ${show}`);
  assert.equal(after.conferenceAudit,0,`2: through the conference, once it has gone through every proof, the audit waits: ${show}`);
  assert(after.conferenceCommandSaved&&after.conferenceAuditWoke&&after.conferenceAuditAfter===0,`2: a command through the conference wakes the audit until its cycle ends, then it waits again: ${show}`);
  // 3
  const per=(w,rate,reference)=>w[reference]>0?w[rate]/w[reference]:0,counted=w=>w.display>0&&w.timer>0;
  assert(counted(before.play)&&counted(after.play)&&per(after.play,'frames','display')>=per(before.play,'frames','display')*.9&&Math.abs(per(after.play,'ticks','timer')-per(before.play,'ticks','timer'))<=per(before.play,'ticks','timer')*.1,`3: playing keeps the display rate and the ticks: ${show}`);assert(Math.abs(after.play.sim-before.play.sim)<=before.play.sim*.1,`3: the same game time per second: ${show}`);assert(after.play.busy<=before.play.busy*1.5,`3: no more work playing (within a desktop's variation): ${show}`);
  // 4
  assert(after.resumeMs<=before.resumeMs+50&&after.resumeSim>0,`4: resuming wakes the loop at once and the game runs: ${show}`);
  assert(after.closeMs<=before.closeMs+250+50&&after.closeSim>0,`4: closing the conference brings the loop and the game back within a rested pass: ${show}`);
  assert(after.releaseMs<=before.releaseMs+50,`4: letting go of the map wakes the loop at once: ${show}`);assert(after.afterRelease.frames<=8,`4: and it rests again once the map is still: ${show}`);
  assert(after.calendarMs<=before.calendarMs+50&&after.calendar.frames>=after.calendarReference.frames*.8,`4: a calendar advance wakes the loop to the display rate: ${show}`);assert(after.afterCalendar.frames<=8,`4: and it rests again after: ${show}`);
  assert(after.recorder.frames>=after.recorderReference.frames*.8,`4: the recorder keeps the display rate: ${show}`);
  // 5
  assert.equal(after.auditResting,0,`5: paused and unchanged, the audit waits: ${show}`);assert(after.auditAfterCommand>0,`5: a command wakes the audit: ${show}`);assert(after.auditPlaying>0,`5: playing, the audit runs on: ${show}`);
  console.log(JSON.stringify({suite:'build576-presentation-rest-browser',ok:true,previous:PREVIOUS,...report}));
 }finally{await old?.close();await now?.close();fs.rmSync(tree,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
