'use strict';
// Deadline signal integration: bounded injected clocks, no physical-device timing claims.
const assert=require('node:assert/strict'),path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..'),Core=require(path.join(ROOT,'WebApp/simulation-core.js'));
function scenario({manual=true,target=7200,steps=30,stepMs=()=>.25,createMs=0,finishMs=0,maxStepsPerChunk=Infinity,pending=false,manualFrameBudgetMs=10}={}){
  let wall=0,sim=0,step=0,frames=0,cancels=0;const levels=[],chunks=[],speedWrites=[],throttles=[];
  const engine=Core.create({getSimTime:()=>sim,setSimTime:t=>{sim=t;},getSpeed:()=>manual?0:300,setSpeed:s=>speedWrites.push(s),
    createSliceJob:(_slice,meta)=>{wall+=createMs;let i=0;return {
      runChunk(_items,{deadline}){const start=wall;let count=0;do{wall+=stepMs(i++,step++);count++;}while(i<steps&&wall<deadline&&count<maxStepsPerChunk);chunks.push({start,end:wall,deadline,took:wall-start});return i>=steps?true:pending?{pending:true}:false;},
      finish(){wall+=finishMs;sim=meta.to;return {committed:true};},cancel(){cancels++;}
    };},onGovernor:e=>levels.push({at:wall,...e}),onThrottle:e=>throttles.push(e)
  },{nowMs:()=>wall,allowedSpeeds:[0,30,120,300],fallbackSpeed:30,frameBudgetMs:4,manualFrameBudgetMs,cooldownAfterMs:0,minRealSliceSeconds:0});
  engine.reset(0);if(manual)assert.equal(engine.advanceTo(target,{speed:300,batchSeconds:3600}).accepted,true);
  function tick(){wall+=16;frames++;engine.frame(wall);return engine.snapshot();}
  function run(n=200){let out=engine.snapshot();for(let i=0;i<n;i++){out=tick();if(manual&&!out.manualAdvance)break;}return out;}
  return {engine,tick,run,levels,chunks,speedWrites,throttles,get sim(){return sim;},get frames(){return frames;},get cancels(){return cancels;}};
}
const results=[];

// A duration above the live threshold is still ordinary work when it stays inside its actual calendar deadline.
{
  const s=scenario({steps:120}),out=s.run();assert.equal(s.sim,7200);assert.equal(s.levels.length,0);assert.equal(out.activeFrameBudgetMs,10);
  assert(s.chunks.some(c=>c.took>=10));assert(s.chunks.every(c=>c.end-c.deadline<.26));assert.equal(s.speedWrites.length,0);
  results.push({name:'ordinary calendar work',levelChanges:0});
}

// All chunks in a frame share its deadline, including time spent creating the job and preceding chunks.
// create=1, first chunk=3, second=10: the latter overruns by 4 despite taking only its nominal 10ms budget.
{
  const s=scenario({steps:2,createMs:1,maxStepsPerChunk:1,stepMs:i=>i===0?3:10});s.tick();
  assert.equal(s.chunks.length,2);const [a,b]=s.chunks;assert.equal(a.deadline,b.deadline);assert.equal(b.end-b.deadline,4);
  assert.equal(b.took,10);assert.equal(s.levels[0]?.level,'YELLOW');assert.equal(s.levels[0]?.stage,'chunk');
  results.push({name:'absolute shared frame deadline',overrunMs:b.end-b.deadline});
}

// Below-threshold overshoot is not pressure, even if a whole chunk is longer than the live frame budget.
{
  const s=scenario({steps:4,stepMs:()=>3});s.tick();assert.equal(s.chunks[0].took,12);assert.equal(s.chunks[0].end-s.chunks[0].deadline,2);assert.equal(s.levels.length,0);
  results.push({name:'small overrun',overrunMs:2,levelChanges:0});
}

// ORANGE still measures full duration even when a generous deadline has not been reached.
{
  const s=scenario({target:3600,steps:1,manualFrameBudgetMs:50,stepMs:()=>30});s.tick();
  assert(s.chunks[0].end<s.chunks[0].deadline);assert.equal(s.levels[0]?.level,'ORANGE');assert.equal(s.engine.snapshot().longTasks,1);
  assert.equal(s.engine.snapshot().manualThrottleYields,0);assert.equal(s.speedWrites.length,0);
  results.push({name:'long task without deadline overrun',level:'ORANGE'});
}

// RED also measures full duration. A single 121ms step is hard even if its overrun is zero.
{
  const s=scenario({steps:4,manualFrameBudgetMs:200,stepMs:(_i,global)=>global===0?121:.25});s.tick();
  assert(s.chunks[0].end<s.chunks[0].deadline);assert.equal(s.levels[0]?.level,'RED');assert.equal(s.engine.snapshot().manualThrottleYields,1);
  const out=s.run();assert.equal(s.sim,7200);assert.equal(out.hardTasks,1);assert.equal(out.manualThrottleYields,1);
  assert.equal(out.manualFailures,0);assert.equal(out.conflicts,0);assert.equal(s.cancels,0);assert.equal(s.speedWrites.length,0);
  results.push({name:'hard task without deadline overrun',level:'RED',yields:out.manualThrottleYields});
}

// Non-splittable create/finish stages count their full duration, even within the calendar budget.
for(const stage of ['create','finish']){
  const s=scenario({steps:1,[stage+'Ms']:6});s.tick();
  assert(s.levels.some(e=>e.level==='YELLOW'&&e.stage===stage&&e.took===6));assert.equal(s.speedWrites.length,0);
  results.push({name:'indivisible '+stage,level:'YELLOW'});
}

// The existing cadence governor must still cut ordinary calendar work when frame intervals deteriorate.
{
  const s=scenario({steps:10000});assert.equal(s.engine.noteFrameInterval(48.5),1);const first=s.tick();
  assert.equal(first.frameCadencePressure,1);assert.equal(first.activeFrameBudgetMs,4.5);assert.equal(s.levels.length,0);
  for(let i=0;i<50;i++)s.engine.noteFrameInterval(16);
  const recovered=s.tick();assert(recovered.activeFrameBudgetMs>9.99);assert.equal(s.levels.length,0);
  assert.equal(s.engine.noteFrameInterval(NaN),s.engine.noteFrameInterval(-1));
  results.push({name:'cadence pressure remains active',pressedBudgetMs:first.activeFrameBudgetMs,recoveredBudgetMs:recovered.activeFrameBudgetMs});
}

// The moving average only retains 40 observations; a hard spike must not hold pressure indefinitely.
{
  const s=scenario({manual:false,steps:4,stepMs:(_i,global)=>global===0?121:.25});s.run(150);
  assert(s.levels.some(e=>e.level==='RED'));assert.equal(s.engine.snapshot().governor,'GREEN');assert.equal(s.engine.snapshot().hardTasks,1);
  assert.equal(s.speedWrites.length,0);results.push({name:'bounded pressure history',finalLevel:'GREEN'});
}

// A pending planner yields after one chunk instead of spinning through the remaining frame budget.
{
  const s=scenario({steps:8,maxStepsPerChunk:1,pending:true});s.tick();assert.equal(s.chunks.length,1);
  s.tick();assert.equal(s.chunks.length,2);const out=s.run();assert.equal(s.sim,7200);assert.equal(out.lastError,'');
  assert.equal(s.levels.length,0);results.push({name:'pending worker yields',levelChanges:0});
}

// Cancelling after a hard step discards the pending slice and does not advance or duplicate committed time.
{
  const s=scenario({steps:20,maxStepsPerChunk:1,stepMs:(_i,global)=>global===0?121:.25});s.tick();
  assert.equal(s.engine.snapshot().jobActive,true);assert.equal(s.engine.snapshot().manualThrottleYields,1);
  s.engine.cancelAdvance('pressure-test');s.run(20);const at=s.sim;s.run(20);
  assert.equal(at,0);assert.equal(s.sim,at);assert.equal(s.cancels,1);assert.equal(s.engine.snapshot().manualAdvance,null);
  assert.equal(s.engine.snapshot().jobActive,false);assert.equal(s.engine.snapshot().manualThrottleYields,1);assert.equal(s.speedWrites.length,0);
  results.push({name:'cancel hard pending slice',committedSeconds:s.sim,cancels:s.cancels});
}

// An exception still cancels the current atomic job and reports failure without publishing its time.
{
  const s=scenario({stepMs:(_i,global)=>{if(global===1)throw Error('injected-chunk-failure');return .25;}}),out=s.tick();
  assert.equal(s.sim,0);assert.equal(out.jobActive,false);assert.equal(out.manualAdvance,null);
  assert(out.lastError.includes('injected-chunk-failure'));assert.equal(s.cancels,1);assert.equal(s.speedWrites.length,0);
  results.push({name:'failed chunk',committedSeconds:s.sim,cancels:s.cancels});
}
// A display the host reports at 30 Hz (iOS Low Power Mode or serious heat) holds 33.3 ms frames without pressure, a frame
// past 35.2 ms is still late; without the report, or at 60 Hz, the 18.5 ms bound is unchanged.
{
  const s=scenario({steps:10000});for(let i=0;i<50;i++)assert.equal(s.engine.noteFrameInterval(33.3,1000/30),0);
  const held=s.tick();assert.equal(held.frameCadencePressure,0);assert.equal(held.activeFrameBudgetMs,10);assert.equal(held.frameCadenceFloorMs,35.2);
  const late=s.engine.noteFrameInterval(48.5,1000/30);assert.ok(late>.44&&late<.45,`a late 30 Hz frame is pressure: ${late}`);
  const t=scenario({steps:10000});assert.ok(t.engine.noteFrameInterval(33.3)>.48,'no report: 33.3 ms is pressure as before');assert.equal(t.engine.noteFrameInterval(48.5,0),1);assert.equal(t.engine.snapshot().frameCadenceFloorMs,18.5);
  const u=scenario({steps:10000});assert.equal(u.engine.noteFrameInterval(48.5,1000/60),1,'60 Hz keeps the 18.5 ms bound');assert.equal(u.engine.snapshot().frameCadenceFloorMs,18.5);
  results.push({name:'reported 30 Hz display',heldBudgetMs:held.activeFrameBudgetMs,latePressure:late});
}

// A live slice that ends on a day boundary (the day close) takes the calendar's cooperative budget, under the governor;
// every other live slice keeps the live one. 1 real second of 300x backlog makes one 300 sim-s slice.
function liveDayScenario(startSim){
  let wall=0,sim=startSim;const chunks=[];
  const engine=Core.create({getSimTime:()=>sim,setSimTime:v=>{sim=v;},getSpeed:()=>300,setSpeed:()=>{},
    createSliceJob:(_slice,meta)=>{let i=0;return {runChunk(_items,{deadline}){const start=wall;do{wall+=.25;i++;}while(i<400&&wall<deadline);chunks.push({to:meta.to,start,deadline,budget:deadline-start});return i>=400;},finish(){sim=meta.to;return {committed:true};},cancel(){}};}
  },{nowMs:()=>wall,allowedSpeeds:[0,30,120,300],fallbackSpeed:30,frameBudgetMs:4,manualFrameBudgetMs:10,cooldownAfterMs:0,minRealSliceSeconds:1});
  engine.reset(0);for(let i=0;i<600&&sim<startSim+300;i++){wall+=16;engine.frame(wall);}
  return {chunks,sim,engine};
}
{
  const day=liveDayScenario(86400-300),hour=liveDayScenario(3600-300);
  assert.equal(day.sim,86400,'the day slice commits');assert.equal(hour.sim,3600,'the hour slice commits');
  const dayLater=day.chunks.filter(c=>c.to===86400).slice(1),hourLater=hour.chunks.filter(c=>c.to===3600).slice(1);assert.ok(dayLater.length&&hourLater.length);
  assert.ok(dayLater.every(c=>c.budget>4.01&&c.budget<=10.01),`the day close takes the calendar budget: ${dayLater.map(c=>c.budget)}`);
  assert.ok(hourLater.every(c=>c.budget<=4.01),`an hour slice keeps the live budget: ${hourLater.map(c=>c.budget)}`);
  assert.ok(dayLater.length<hourLater.length,'the day close needs fewer ticks than the same work under the live budget');
  results.push({name:'live day close budget',dayTicks:dayLater.length+1,hourTicks:hourLater.length+1});
}
assert.equal(Core.DEFAULTS.frameBudgetMs,5.5);assert.equal(Core.DEFAULTS.manualFrameBudgetMs,10);
assert.equal(Core.DEFAULTS.longTaskWarnMs,28);assert.equal(Core.DEFAULTS.hardTaskMs,120);
assert(!Object.hasOwn(Core.DEFAULTS,'governorRecoveryMs'));assert(!Object.hasOwn(Core.DEFAULTS,'governorRecoveryFrames'));assert(!Object.hasOwn(Core.DEFAULTS,'governorRecoveryRatio'));
console.log(JSON.stringify({suite:'build426-governor-pressure',passed:results.length,scope:'deadline pressure and existing safety; synthetic clock only',results},null,2));
