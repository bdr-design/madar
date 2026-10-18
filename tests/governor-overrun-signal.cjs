'use strict';
// Governor pressure signal (iPhone diagnostic DX-1792300927407-23-287-4168800, 980,000 assets).
// A simulation chunk runs until the frame's deadline by design (app.js runChunk -> TX staged step(deadline),
// transaction-core.js: "runs steps until the iterator finishes or the deadline passes"). Its duration therefore equals
// the budget the governor itself set, and the governor compared that duration with the same budget: a full frame read
// as pressure, YELLOW cut the next budget by 25%, the shorter chunk read as GREEN, and so on. The diagnostic shows it:
// live chunks took 4 ms against a 4 ms budget, calendar chunks 9-11 ms against 7.5-10 ms, and the level changed
// 80-253 times per 10 s window. Only work past the deadline is pressure; create/finish are indivisible and count whole.
// Checked with an injected clock and synthetic stage durations; this is not an iPhone benchmark.
const assert=require('node:assert/strict');
const path=require('node:path');
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {harness}=require('./helpers/core-harness');
const {s}=harness(['simulation-core']);
const CORE=s.GH_SIMULATION_CORE;
const FRAME=16.7;

// stepMs(i): duration of the i-th step of a slice. A chunk runs steps until the deadline passes (at least one step),
// exactly like the staged transaction; steps:n steps make one slice.
function run({manual=false,seconds=30,steps=30,stepMs=()=>.25,finishMs=0,options={}}){
  const clock={t:0};let time=0;const levels=[],throttles=[];
  const engine=CORE.create({
    getSimTime:()=>time,setSimTime:t=>{time=t;},getSpeed:()=>manual?0:300,setSpeed(){},
    createSliceJob:(_slice,meta)=>{let i=0;return {
      runChunk(_items,opts={}){const deadline=Number.isFinite(opts.deadline)?opts.deadline:-Infinity;do{clock.t+=stepMs(i);i++;}while(i<steps&&clock.t<deadline);return i>=steps;},
      finish(){clock.t+=finishMs;time=meta.to;return {committed:true};},
      cancel(){}
    };},
    onGovernor:e=>levels.push(e.level),onThrottle:e=>throttles.push(e)
  },{nowMs:()=>clock.t,allowedSpeeds:[0,30,120,300],fallbackSpeed:30,frameBudgetMs:4,manualFrameBudgetMs:10,minRealSliceSeconds:0,cooldownAfterMs:0,...options});
  if(manual)assert.equal(engine.advanceTo(86400,{speed:300,batchSeconds:3600}).accepted,true);
  let frames=0,reduced=0;const limit=manual?20000:Math.round(seconds*1000/FRAME);
  while(frames<limit){
    clock.t=Math.max(clock.t,frames*FRAME);engine.frame(clock.t);frames++;
    const snap=engine.snapshot();if(snap.activeFrameBudgetMs<(manual?10:4)-1e-9)reduced++;
    if(manual&&!snap.manualAdvance)break;
  }
  return {levels,throttles,time,frames,reduced,snapshot:engine.snapshot()};
}
const results=[];

// 1. Live play, ordinary work that fills the frame: no pressure, no level changes, the budget is never cut.
{
  const out=run({});
  assert.equal(out.levels.length,0,`a chunk that stops at its deadline is not pressure (${out.levels.length} level changes)`);
  assert.equal(out.reduced,0,`the live budget is never cut for ordinary work (${out.reduced} frames)`);
  assert.ok(out.time>=0.99*30*300,`live play keeps its requested rate (${Math.round(out.time)} of ${30*300} sim s)`);
  assert.ok(out.time<=1.01*30*300,'live play does not manufacture simulated time');
  results.push({name:'live, deadline-bounded work',levelChanges:out.levels.length,simSeconds:Math.round(out.time)});
}

// 2. Calendar advance with the same work: the calendar budget stays whole.
{
  const out=run({manual:true,steps:120});
  assert.equal(out.time,86400,'the calendar target completes');
  assert.equal(out.levels.length,0,`calendar chunks that stop at their deadline are not pressure (${out.levels.length})`);
  assert.equal(out.reduced,0,`the calendar budget is never cut for ordinary work (${out.reduced} frames)`);
  results.push({name:'calendar, deadline-bounded work',levelChanges:out.levels.length,frames:out.frames});
}

// 3. A real overrun: an indivisible 9 ms step against a 4 ms live budget raises YELLOW; without overruns it returns
//    to GREEN.
{
  let fired=false;
  const out=run({seconds:3,steps:30,stepMs:i=>i===10&&!fired?(fired=true,9):.25});
  assert.ok(out.levels.includes('YELLOW'),`an indivisible step past the deadline is pressure (${out.levels.join(' > ')||'none'})`);
  assert.equal(out.levels[out.levels.length-1],'GREEN','the level returns to GREEN once overruns stop recurring');
  assert.deepEqual(out.levels,['YELLOW','GREEN'],'one isolated overrun recovers without retaining a level');
  results.push({name:'indivisible overrun',sequence:out.levels.slice(0,4).join('>')});
}

// 4. Indivisible finish stages still count whole: a 30 ms commit is a long task (ORANGE), as before.
{
  const out=run({seconds:2,finishMs:30});
  assert.ok(out.levels.includes('ORANGE'),`a 30 ms finish is still a long task (${out.levels.join(' > ')||'none'})`);
  results.push({name:'indivisible finish',sequence:out.levels.slice(0,3).join('>')});
}

// 5. Calendar throttle: one hard stage in each hourly slice yields once per stage, without restarting the slice.
{
  const out=run({manual:true,steps:4,stepMs:i=>i===2?130:.25,finishMs:0});
  assert.equal(out.time,86400,'the calendar target completes');
  assert.ok(out.throttles.length>=1,'a hard stage still throttles the calendar');
  assert.equal(out.snapshot.hardTasks,24,'each of the 24 hourly slices has one hard stage');
  assert.equal(out.snapshot.manualThrottleYields,24,'count all yields; onThrottle only reports the first and each 60th');
  assert.equal(out.snapshot.manualFailures,0);assert.equal(out.snapshot.cancels,0);
  results.push({name:'calendar throttle',notifications:out.throttles.length,yields:out.snapshot.manualThrottleYields});
}

console.log(JSON.stringify({suite:'governor-overrun-signal',passed:results.length,scope:'simulation governor only; injected clock; synthetic stages; not an iPhone benchmark',results},null,2));
