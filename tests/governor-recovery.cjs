'use strict';
// Governor recovery (iPhone diagnostic DX-1792300927407-23-287-4168800, 980,000 assets, calendar +7 days).
// The governor took its level from the last stage alone. A slice alternates heavy chunks with near-zero
// create/finish stages, so the level flipped GREEN/YELLOW on almost every slice (80-253 changes per 10 s
// window, up to ~25 a second), and with it the next frame's work budget (x1 / x0.75). Checked here with an
// injected clock; these are synthetic stage durations, not an iPhone benchmark:
// - a level rises at once and falls only after governorRecoveryMs without a stage at that level;
// - it then falls to the highest level seen during that calm, not straight to the last stage's level;
// - the calendar throttle still answers the stage's own pressure, not the level held for recovery;
// - governorRecoveryMs: 0 keeps the previous immediate behaviour.
const assert=require('node:assert/strict');
const path=require('node:path');
process.env.GH_TEST_SOURCE_DIR=path.resolve(__dirname,'..');
const {harness}=require('./helpers/core-harness');
const {s}=harness(['simulation-core']);
const CORE=s.GH_SIMULATION_CORE;

function run({manual=false,frames=2000,chunkMs,chunksPerSlice=4,options={}}){
  let wall=0,time=0,chunk=0;const speed=manual?0:300,levels=[],throttles=[],trace=[];
  const engine=CORE.create({
    getSimTime:()=>time,setSimTime:t=>{time=t;},getSpeed:()=>speed,setSpeed(){},
    createSliceJob:(_slice,meta)=>{let left=chunksPerSlice;return {
      runChunk(){wall+=chunkMs(chunk++);return --left<=0;},
      finish(){time=meta.to;return {committed:true};},
      cancel(){}
    };},
    onGovernor:e=>levels.push({level:e.level,at:wall}),onThrottle:e=>throttles.push(e)
  },{nowMs:()=>wall,allowedSpeeds:[0,30,120,300],fallbackSpeed:30,frameBudgetMs:4,manualFrameBudgetMs:10,minRealSliceSeconds:0,cooldownAfterMs:0,...options});
  if(manual)assert.equal(engine.advanceTo(86400,{speed:300,batchSeconds:3600}).accepted,true);
  for(let frame=0;frame<frames;frame++){
    wall+=16;engine.frame(wall);const snap=engine.snapshot();trace.push({at:wall,governor:snap.governor,budget:snap.activeFrameBudgetMs});
    if(manual&&!snap.manualAdvance)break;
  }
  return {levels,throttles,trace,time,snapshot:engine.snapshot()};
}
const results=[];

// 1. Live play with a recurring heavy chunk (5 ms against a 4 ms budget) between light stages: one rise, no flapping.
{
  const out=run({frames:600,chunkMs:()=>5});
  assert.ok(out.levels.length>=1&&out.levels[0].level==='YELLOW','the first heavy chunk raises the level at once');
  assert.ok(out.levels.length<=2,`recurring pressure holds one level instead of flipping per stage (${out.levels.length} changes)`);
  const budgets=new Set(out.trace.slice(60).map(row=>row.budget));
  assert.equal(budgets.size,1,`the frame budget stays steady under steady pressure (${[...budgets].join(', ')})`);
  results.push({name:'recurring pressure',changes:out.levels.length});
}

// 2. One spike, then light work: held through the recovery window, then down to GREEN.
{
  const SPIKE=40,out=run({frames:200,chunkMs:i=>i===SPIKE?6:1});
  assert.deepEqual(out.levels.map(row=>row.level),['YELLOW','GREEN'],'one rise for the spike, one fall after recovery');
  const [up,down]=out.levels;
  assert.ok(down.at-up.at>=250,`the level falls only after the recovery window (${down.at-up.at} ms)`);
  assert.ok(down.at-up.at<250+40,`and does not linger far beyond it (${down.at-up.at} ms)`);
  results.push({name:'single spike',heldMs:down.at-up.at});
}

// 3. RED, then a calm that still reaches YELLOW: falls to YELLOW (the highest level seen), not to GREEN.
{
  const out=run({frames:200,chunkMs:i=>i===40?130:i>40&&i%6===0?5:1});
  const seq=out.levels.map(row=>row.level);
  assert.equal(seq[0],'RED','a hard task raises the level to RED at once');
  assert.equal(seq[1],'YELLOW',`after the recovery window it falls to the highest calm level (${seq.join(' > ')})`);
  results.push({name:'stepped recovery',sequence:seq.join('>')});
}

// 4. Calendar throttle: one hard stage throttles once; light stages while RED is held do not throttle again.
{
  const out=run({manual:true,frames:3000,chunkMs:i=>i===3?130:1});
  assert.equal(out.time,86400,'the calendar target completes');
  assert.equal(out.throttles.length,1,`only the hard stage throttles (${out.throttles.length})`);
  results.push({name:'calendar throttle',throttles:out.throttles.length});
}

// 5. governorRecoveryMs: 0 keeps the previous behaviour: the level follows each stage.
{
  const out=run({frames:600,chunkMs:()=>5,options:{governorRecoveryMs:0}});
  assert.ok(out.levels.length>20,`0 restores per-stage levels (${out.levels.length} changes)`);
  assert.equal(CORE.create({getSimTime:()=>0,setSimTime(){},createSliceJob(){}},{governorRecoveryMs:0}).config().governorRecoveryMs,0,'0 is kept');
  assert.equal(CORE.create({getSimTime:()=>0,setSimTime(){},createSliceJob(){}},{governorRecoveryMs:-1}).config().governorRecoveryMs,250,'invalid values use the default');
  results.push({name:'recovery disabled',changes:out.levels.length});
}

console.log(JSON.stringify({suite:'governor-recovery',passed:results.length,scope:'simulation governor only; injected clock; not an iPhone benchmark',results},null,2));
