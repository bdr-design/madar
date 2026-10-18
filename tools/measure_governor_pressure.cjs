'use strict';
// Synthetic with deadline-bounded chunks, like app.js runChunk -> TX staged.step(deadline): a chunk runs steps
// until the deadline passes (at least one step). Injected clock; NOT an iPhone benchmark.
// Usage: node tools/measure_governor_pressure.cjs <repo-root> label=options-json ... (HEAVY_EVERY=0|400|50; CADENCE_FEEDBACK=1 optional)
const path=require('node:path');const ROOT=process.argv[2];if(!ROOT||process.argv.length<4)throw Error('Provide a repository root and label=options-json');process.env.GH_TEST_SOURCE_DIR=ROOT;
const {harness}=require(path.join(ROOT,'tests/helpers/core-harness'));const {s}=harness(['simulation-core']);const CORE=s.GH_SIMULATION_CORE;
const variants=process.argv.slice(3).map(arg=>{const i=arg.indexOf('=');return [arg.slice(0,i),JSON.parse(arg.slice(i+1))];});
// Slice shape: an ordinary slice has 30 steps of 0.25 ms; a day-boundary slice (every 24th) has 3,000 steps of 0.12 ms
// plus one 9 ms step every 400 steps (an indivisible apply/commit piece).
const HEAVY=Number(process.env.HEAVY_EVERY??400),CADENCE_FEEDBACK=process.env.CADENCE_FEEDBACK==='1';
function makeJob(meta,clockRef,dayEvery){
  const day=Math.round(meta.to/3600)%dayEvery===0,total=day?3000:30;let i=0;
  return {runChunk(_items,options={}){const deadline=Number.isFinite(options.deadline)?options.deadline:-Infinity;
    do{clockRef.t+=day?(HEAVY>0&&i%HEAVY===HEAVY-1?9:0.12):0.25;i++;}while(i<total&&clockRef.t<deadline);return i>=total;},
    finish(){meta.commit();return {committed:true};},cancel(){}};
}
function run(label,options,manual){
  const c={t:0};let time=0,changes=0,frames=0,factorFrames=0,maxFrameWork=0,lastFrameStart=null;
  const e=CORE.create({getSimTime:()=>time,setSimTime:t=>{time=t;},getSpeed:()=>manual?0:300,setSpeed(){},
    createSliceJob:(_s,meta)=>makeJob({...meta,commit:()=>{time=meta.to;}},c,24),onGovernor:()=>{changes++;}},
    {nowMs:()=>c.t,allowedSpeeds:[0,30,120,300],frameBudgetMs:4,manualFrameBudgetMs:10,minRealSliceSeconds:0,cooldownAfterMs:0,...options});
  if(manual)e.advanceTo(86400*7,{speed:300,batchSeconds:3600});
  const limit=manual?200000:1800;
  while(frames<limit){c.t=Math.max(c.t,frames*16.7);const start=c.t;if(CADENCE_FEEDBACK&&lastFrameStart!==null)e.noteFrameInterval(start-lastFrameStart);lastFrameStart=start;e.frame(c.t);maxFrameWork=Math.max(maxFrameWork,c.t-start);frames++;
    const snap=e.snapshot();if(snap.activeFrameBudgetMs<(manual?10:4)-1e-9)factorFrames++;if(manual&&!snap.manualAdvance)break;}
  const out=manual?{framesToFinish:frames}:{simSecondsIn30s:Math.round(time)};
  console.log((manual?'calendar 7d':'live 300x ').padEnd(12),label.padEnd(26),JSON.stringify({...out,governorChanges:changes,framesWithReducedBudget:`${Math.round(100*factorFrames/frames)}%`,maxFrameWorkMs:Math.round(maxFrameWork*10)/10}));
}
for(const manual of [true,false])for(const [label,options] of variants)run(label,options,manual);
