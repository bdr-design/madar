'use strict';
// Build 707 (road post-review): the Simulation Core drain. While the host drains (a held query of the live fleet waits
// for the step in flight), the job in flight runs on and commits, no new job starts, the clock never goes back and no
// job is cancelled; when the drain ends the jobs resume. A suspension, by contrast, cancels the job in flight (the
// former behaviour of the hold, which stepped the visible clock back).
// And the app's drain itself (drainSimulation): a staged step is always waited for (a day close past 2 s would be
// rolled back), any other step at most 2 s.
const assert=require('assert');
global.window=global;require('../WebApp/simulation-time-core.js');require('../WebApp/simulation-pacing-core.js');const Simulation=require('../WebApp/simulation-core.js');
function harness(){
  const h={now:0,time:0,created:0,finished:0,cancelled:0,chunks:0,draining:false,suspended:false,min:Infinity};
  h.engine=Simulation.create({
    getSimTime:()=>h.time,setSimTime:value=>{h.time=value;},getSpeed:()=>0,
    // A job takes 12 chunks of 3 ms: several frames.
    createSliceJob:(_slice,meta)=>{h.created++;let left=12;return {aggregate:meta.aggregate,runChunk:()=>{h.now+=3;h.chunks++;return --left<=0;},finish:()=>{h.finished++;return {committed:true,completeTo:meta.to};},cancel:()=>{h.cancelled++;},cleanup:()=>{}};},
    hasDeferredWork:()=>false,hasQueuedWork:()=>false,runDeferredWork:()=>false,
    isDraining:()=>h.draining,isSuspended:()=>h.suspended
  },{nowMs:()=>h.now,allowedSpeeds:[0,30,600],fallbackSpeed:30,manualBatchSeconds:3600,manualMinBatchSeconds:300,maintenanceEveryHours:12});
  h.frame=()=>{h.now+=16;h.engine.frame(h.now);};
  h.untilJob=()=>{for(let i=0;i<400&&!h.engine.jobActive();i++)h.frame();assert(h.engine.jobActive(),'a job in flight');};
  return h;
}
// 1. The drain lets the job in flight commit, starts none, never steps back.
{const h=harness();assert(h.engine.advanceTo(10*86400,{speed:600,batchSeconds:3600}).accepted);h.untilJob();for(let i=0;i<3&&h.engine.jobActive();i++)h.frame();
  assert(h.engine.jobActive(),'fixture: still mid-job');const created=h.created,cancelled=h.cancelled,finished=h.finished,start=h.time;h.draining=true;
  let last=h.time;for(let i=0;i<60;i++){h.frame();assert(h.time>=last,'the clock never goes back while draining');last=h.time;}
  assert.equal(h.cancelled,cancelled,'1: the job in flight is not cancelled');assert.equal(h.finished,finished+1,'1: it commits');assert.equal(h.created,created,'1: no new job starts');
  assert.equal(h.engine.jobActive(),false,'1: nothing in flight once drained');assert(h.time>start,'1: its time is committed');
  const atDrain=h.time;h.draining=false;for(let i=0;i<60;i++)h.frame();assert(h.created>created,'1: jobs resume after the drain');assert(h.time>atDrain,'1: the clock moves again');}
// 2. Contrast: a suspension cancels the job in flight.
{const h=harness();assert(h.engine.advanceTo(10*86400,{speed:600,batchSeconds:3600}).accepted);h.untilJob();for(let i=0;i<3&&h.engine.jobActive();i++)h.frame();
  const cancelled=h.cancelled;h.suspended=true;h.frame();assert.equal(h.cancelled,cancelled+1,'2: a suspension cancels it');h.suspended=false;}
// 3. The app's drain (app.js drainSimulation): a staged step (a day close over many frames) is waited for past the 2 s
//    cap (cancelling it would roll the clock back); any other step at most 2 s. A fake clock: each wait is 16 ms.
(async()=>{
  const fs=require('fs'),path=require('path'),root=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..'),app=fs.readFileSync(path.join(root,'WebApp','app.js'),'utf8');
  const line=app.split('\n').find(row=>row.includes('async function drainSimulation(){'));assert(line,'drainSimulation in app.js');
  const make=(jobFor,stagedFor)=>{const env={now:0,drains:0,maxDrains:0};const fn=new Function('env',`let fleetQueryDrains=0;const performance={now:()=>env.now};const simulationJobActive=()=>env.now<env.job;const stagedStateBusy=()=>env.now<env.staged;const setTimeout=(resolve,ms)=>{env.now+=ms;env.maxDrains=Math.max(env.maxDrains,fleetQueryDrains);Promise.resolve().then(resolve);};${line.trim()}\nreturn {drain:drainSimulation,drains:()=>fleetQueryDrains};`)(env);env.job=jobFor;env.staged=stagedFor;return {env,...fn};};
  {const t=make(5000,5000);await t.drain();assert(t.env.now>=5000,`3: a staged step is waited for past 2 s (${t.env.now} ms)`);assert.equal(t.drains(),0,'3: the drain mark is released');assert.equal(t.env.maxDrains,1,'3: and held while waiting');}
  {const t=make(5000,0);await t.drain();assert(t.env.now>=2000&&t.env.now<2100,`3: any other step at most 2 s (${t.env.now} ms)`);}
  {const t=make(0,0);await t.drain();assert.equal(t.env.now,0,'3: nothing in flight: no wait');}
  console.log(JSON.stringify({suite:'build707-engine-drain',ok:true}));
})().catch(error=>{console.error(error);process.exitCode=1;});
