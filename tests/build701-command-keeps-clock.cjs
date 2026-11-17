'use strict';
// Heaviness batch B (iPhone diagnostic DX-1794605111560; the owner: «نفذ الحل ... على دفعات بدقه واختبارات صارمه»).
// A player command (or a save) at live speed suspends the engine for its duration; the
// source before zeroed the pacing backlog on every suspended tick and the RAF loop reset the engine when the lock began,
// so with minRealSliceSeconds:1 the clock waited a further second of play after each command (iPhone, day 15: 27
// commands in 63 s, clock at 55% of 300x). Against the source before (PREVIOUS, from its own tree), with the real
// simulation-core / pacing-core / time-core, app.js's own engine options and its lock functions, an injected clock at
// 300x and one runtime tick every 16 ms (TICK, app.js liveIntervalMs):
//  a. 20 commands of 400 ms every 1,104 ms: the game commits exactly 14 slices of 300 s for 14.784 s of play (before:
//     none), and never more than live time x 300;
//  b. a 10 s suspension accrues nothing (sim time and backlog unchanged on every tick); the first slice after it comes
//     when the retained backlog plus new play reaches 300 s, not a further second;
//  c. no catch-up burst: at most one slice per tick, each exactly one quantum (300 s); a slice in flight when the lock
//     begins is cancelled once and committed once afterwards;
//  d. hidden and pause still clear the backlog: tick-for-tick the same commits as the source before;
//  e. a calendar advance is held through the lock as before, reaches its target, and its wall time is never replayed
//     as live backlog (tick-for-tick the same as before); a cancelling advance, a reset or a recovery still reset;
//  f. (real fleet economy) the game digest at each committed time is identical to the source before;
//  g. app.js wiring: the loop and observeLoopLock hold a live lifecycle lock instead of resetting the engine.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'),SOURCE=process.env.GH_TEST_SOURCE_DIR||ROOT,PREVIOUS=process.env.B701_PREVIOUS||'a636745';
const read={now:file=>fs.readFileSync(path.join(SOURCE,'WebApp',file),'utf8'),before:file=>execFileSync('git',['-C',ROOT,'show',`${PREVIOUS}:WebApp/${file}`],{maxBuffer:64<<20}).toString()};
const engineOf=source=>{const context={console};context.globalThis=context;context.window=context;for(const file of ['simulation-time-core.js','simulation-pacing-core.js','simulation-core.js'])vm.runInNewContext(source(file),context);return context.GH_SIMULATION_CORE;};
const lift=(text,start,end='\n')=>{const a=text.indexOf(start);assert(a>=0,`app.js: ${start}`);const b=text.indexOf(end,a);return text.slice(a,b);};
function appOf(source){
  const app=source('app.js');
  // The engine's options as app.js passes them (minRealSliceSeconds:1 among them).
  const options=vm.runInNewContext(`(${app.match(/\},(\{minRealSliceSeconds:[^}]*\})\);\n/)[1]})`);
  // The lock functions as written: loopLockReason, holdAdvanceThroughLock, observeLoopLock.
  const text=[lift(app,'  function loopLockReason(){'),lift(app,'  function holdAdvanceThroughLock(lock){'),lift(app,'  function observeLoopLock(){')].join('\n');
  return {app,options,text,core:engineOf(source)};
}
const SOURCES={now:appOf(read.now),before:appOf(read.before)};
const QUANTUM=300,TICK=16,SPEED=300;

// One live game: the real engine with app.js's options, a slice job that commits on its last chunk, the app's suspension
// flags (a durable command, a save lock, a hard reset, a recovery) and the RAF loop's guard (observeLoopLock as written).
function game(which,{chunks=1,start=0}={}){
  const src=SOURCES[which];let wall=0,time=start,speed=SPEED,tick=0;
  const flags={durable:false,save:false,hardReset:false,recovery:false,queued:false};
  const log={commits:[],cancels:[],resets:[],perTick:new Map(),maxBacklog:0,created:0};
  const engine=src.core.create({
    getSimTime:()=>time,setSimTime:t=>{time=t;},getSpeed:()=>speed,setSpeed:v=>{speed=v;},
    isSuspended:()=>flags.durable||flags.save||flags.hardReset,hasQueuedWork:()=>flags.queued,
    createSliceJob:(slice,meta)=>{log.created++;let left=chunks;return {
      runChunk(){return --left<=0?true:{pending:true};},
      finish(){time=meta.to;log.commits.push({tick,from:meta.from,to:meta.to});log.perTick.set(tick,(log.perTick.get(tick)||0)+1);return {committed:true};},
      cancel(info){log.cancels.push({tick,reason:info.reason});}};}
  },{...src.options,nowMs:()=>wall});
  const realReset=engine.reset.bind(engine);
  const spy={snapshot:()=>engine.snapshot(),reset:(now,reason)=>{log.resets.push({tick,reason});return realReset(now,reason);}};
  const sandbox={window:{GH_PERSISTENCE:{isLocked:()=>flags.save,telemetry:()=>({recoveryRequired:flags.recovery})}},simulationEngine:spy,simulationRuntime:{wake(){}},performance:{now:()=>wall}};
  vm.createContext(sandbox);
  vm.runInContext(`var lastLoopGuardReason='';var hardResetInProgress=false,durableCommandInProgress=false;${src.text}\nthis.guard=()=>{const lock=loopLockReason();if(lock){observeLoopLock();return lock;}lastLoopGuardReason='';return '';};this.hold=holdAdvanceThroughLock;`,sandbox);
  const sync=()=>{sandbox.hardResetInProgress=flags.hardReset;sandbox.durableCommandInProgress=flags.durable;vm.runInContext(`hardResetInProgress=this.hardResetInProgress;durableCommandInProgress=this.durableCommandInProgress;`,sandbox);};
  let suspendedMs=0,liveMs=0;
  // One 16 ms step: the RAF guard, then the runtime's engine tick.
  const step=()=>{const suspended=flags.durable||flags.save||flags.hardReset;wall+=TICK;tick++;if(suspended||speed<=0||engine.snapshot().hidden)suspendedMs+=TICK;else liveMs+=TICK;sync();sandbox.guard();engine.frame(wall);log.maxBacklog=Math.max(log.maxBacklog,engine.snapshot().backlog);};
  const run=ms=>{for(let t=0;t<ms;t+=TICK)step();};
  return {engine,log,flags,step,run,sandbox,time:()=>time,wall:()=>wall,tick:()=>tick,setSpeed:v=>{speed=v;},liveSec:()=>liveMs/1000,suspendedSec:()=>suspendedMs/1000,committed:()=>time-start};
}
const commits=g=>g.log.commits.map(c=>`${c.tick}:${c.from}-${c.to}`);
const results=[];

// a. 20 commands of 400 ms, one every 1,104 ms: 44 ticks of play, then 25 ticks of command.
function commandRun(which){const g=game(which);for(let k=0;k<20;k++){g.run(704);g.flags.durable=true;g.run(400);g.flags.durable=false;}g.run(704);return g;}
{
  const now=commandRun('now'),before=commandRun('before'),live=now.liveSec(),slices=now.log.commits.length;
  assert.equal(slices,14,`a: ${slices} slices for ${live} s of play`);assert.equal(now.committed(),4200,'a: 14 quanta committed');
  assert.ok(now.committed()<=live*SPEED+1e-6,`a: committed ${now.committed()} > live ${live} x ${SPEED}`);
  assert.ok(now.log.commits.every(c=>c.to-c.from===QUANTUM),'a: every slice is one quantum');
  assert.ok(before.log.commits.length<=2,`a: (the source before committed ${before.log.commits.length} slices)`);
  assert.deepEqual(now.log.resets,[],'a: no engine reset for a live lifecycle lock');
  assert.ok(before.log.resets.length===20&&before.log.resets.every(r=>r.reason==='lifecycle-lock'),'a: (the source before reset the engine at each command)');
  results.push({name:'a. commands keep the clock',liveSeconds:live,suspendedSeconds:now.suspendedSec(),slicesNow:slices,committedNow:now.committed(),slicesBefore:before.log.commits.length,committedBefore:before.committed()});
}

// b. A 10 s suspension accrues nothing; afterwards the retained backlog counts.
{
  const g=game('now');g.run(512);const sim0=g.time(),backlog0=g.engine.snapshot().backlog;
  assert.equal(g.log.commits.length,0,'b: no slice before the first second');assert.ok(backlog0>140&&backlog0<160,`b: ${backlog0}`);
  g.flags.durable=true;
  for(let i=0;i<625;i++){g.step();assert.equal(g.time(),sim0,'b: no game time while suspended');assert.equal(g.engine.snapshot().backlog,backlog0,'b: the backlog neither grows nor is lost while suspended');}
  g.flags.durable=false;
  // (300 - backlog0)/300 s of play makes the slice: 512 ms of play before + 488 after, in 16 ms ticks (31 ticks).
  const need=Math.ceil((QUANTUM-backlog0)/SPEED*1000/TICK);
  for(let i=0;i<need-1;i++)g.step();assert.equal(g.log.commits.length,0,`b: no slice before ${need} ticks`);
  g.step();g.step();assert.equal(g.log.commits.length,1,`b: the slice by tick ${need+1} after the lock`);
  assert.ok(g.committed()<=g.liveSec()*SPEED+1e-6,'b: committed <= live x speed');
  // The source before: zero at the first suspended tick, then a full second.
  const b=game('before');b.run(512);b.flags.durable=true;b.step();assert.equal(b.engine.snapshot().backlog,0,'b: (the source before zeroed it)');
  results.push({name:'b. a suspension accrues nothing',backlogKept:backlog0,ticksToSlice:need});
}

// c. No burst: one slice per tick, a quantum each; a slice in flight is cancelled once and committed once.
{
  const g=commandRun('now');
  assert.ok([...g.log.perTick.values()].every(n=>n===1),'c: at most one slice per tick');
  assert.ok(g.log.maxBacklog<2*QUANTUM,`c: the backlog never holds two quanta (${g.log.maxBacklog})`);
  const m=game('now',{chunks:20});m.run(1008);assert.equal(m.engine.jobActive(),true,'c: a slice in flight');
  m.flags.durable=true;m.run(400);m.flags.durable=false;m.run(2000);
  assert.equal(m.log.cancels.length,1,'c: cancelled once');assert.equal(m.log.cancels[0].reason,'suspended');
  assert.deepEqual(m.log.commits.map(c=>[c.from,c.to]).slice(0,1),[[0,QUANTUM]],'c: the cancelled slice commits once, from where it began');
  assert.equal(new Set(m.log.commits.map(c=>c.from)).size,m.log.commits.length,'c: no interval committed twice');
  assert.ok(m.committed()<=m.liveSec()*SPEED+1e-6,'c: committed <= live x speed');
  results.push({name:'c. no catch-up burst',maxBacklog:g.log.maxBacklog,inFlightCancels:m.log.cancels.length});
}

// d. Hidden and pause clear the backlog, tick for tick as before.
{
  const hiddenRun=which=>{const g=game(which);g.run(512);g.engine.setHidden(true);g.run(5000);g.engine.setHidden(false);g.run(3000);return g;};
  const pauseRun=which=>{const g=game(which);g.run(512);g.setSpeed(0);g.run(2000);g.setSpeed(SPEED);g.run(3000);return g;};
  const pauseInLock=which=>{const g=game(which);g.run(512);g.flags.durable=true;g.run(200);g.setSpeed(0);g.run(200);g.flags.durable=false;g.run(200);g.setSpeed(SPEED);g.run(3000);return g;};
  for(const [label,fn] of [['hidden',hiddenRun],['pause',pauseRun],['pause during a lock',pauseInLock]]){
    const now=fn('now'),before=fn('before');
    assert.deepEqual(commits(now),commits(before),`d: ${label}: the same commits, tick for tick`);
    assert.ok(now.log.commits.length>0,`d: ${label}: play resumes`);
  }
  {const g=game('now');g.run(512);g.engine.setHidden(true);assert.equal(g.engine.snapshot().backlog,0,'d: hidden clears');
   const p=game('now');p.run(512);p.setSpeed(0);p.step();assert.equal(p.engine.snapshot().backlog,0,'d: pause clears');}
  results.push({name:'d. hidden and pause clear as before'});
}

// e. Calendar advance: held through the lock, completes, never replayed as live backlog; tick for tick as before.
{
  const advanceRun=which=>{const g=game(which,{chunks:4});g.run(160);assert.equal(g.engine.advanceTo(86400,{speed:SPEED,batchSeconds:3600,reason:'qa'}).accepted,true);
    g.run(48);g.flags.durable=true;g.run(400);const held=!!g.engine.snapshot().manualAdvance;g.flags.durable=false;
    for(let i=0;i<5000&&g.engine.snapshot().manualAdvance;i++)g.step();const done=g.time(),afterTick=g.tick();g.run(3000);return {g,held,done,afterTick};};
  const now=advanceRun('now'),before=advanceRun('before');
  assert.equal(now.held,true,'e: the advance is held through the command');assert.equal(now.done,86400,'e: it reaches its target');
  assert.deepEqual(now.g.log.resets,[],'e: no reset');assert.deepEqual(commits(now.g),commits(before.g),'e: the same commits, tick for tick, as before');
  const firstLive=now.g.log.commits.find(c=>c.from>=86400);assert.ok(firstLive&&firstLive.tick-now.afterTick>=Math.floor(1000/TICK),'e: the first live slice after the advance waits a second of play (no replay)');
  // A cancelling advance, a hard reset and a recovery still reset the engine (both sources alike).
  for(const which of ['now','before']){
    const h=game(which);assert.equal(h.sandbox.hold('conference-3d'),false);assert.equal(h.sandbox.hold('boundary-recovery'),false);
    h.flags.recovery=true;assert.equal(h.sandbox.hold('lifecycle-lock'),false,`e: ${which}: recovery resets`);h.flags.recovery=false;
    h.flags.hardReset=true;h.step();assert.equal(h.log.resets.length,1,`e: ${which}: a hard reset resets`);h.flags.hardReset=false;
    const c=game(which);c.run(160);c.engine.advanceTo(86400,{speed:SPEED,batchSeconds:3600,reason:'qa'});c.flags.queued=true;c.engine.cancelAdvance('qa-cancel');
    assert.equal(c.engine.snapshot().manualAdvance?.cancelling,true,'e: the cancel waits for its queued work');c.flags.durable=true;c.step();assert.equal(c.log.resets.length,1,`e: ${which}: a cancelling advance resets`);
  }
  assert.equal(SOURCES.now.text.includes('holdAdvanceThroughLock'),true);
  {const n=game('now'),b=game('before');assert.equal(n.sandbox.hold('lifecycle-lock'),true,'g: a live lifecycle lock is held');assert.equal(b.sandbox.hold('lifecycle-lock'),false,'g: (the source before reset it)');}
  results.push({name:'e. calendar advance as before',commits:now.g.log.commits.length});
}

// f. Real fleet economy: the same digest at each committed time as the source before (with and without commands).
{
  const {createSimulationAdapter,makeAsset,fixture}=require('./helpers/fleet-simulation-adapter');
  const assets=Array.from({length:24},(_,i)=>makeAsset(`B701-${i}`,{route:fixture.routes.A1,from:0,phase:i%3===0?'turnaround':'moving',progress:i%3===0?0:(i%7)/7,dwellRemaining:i%3===0?(i*37)%3300:0,routeSlot:i%6,baseFacility:'F-AIR-A'}));
  const play=(which,commandsOn)=>{
    const {s,state}=createSimulationAdapter({from:0,assets:structuredClone(assets)});state.simSeconds=0;state.lastFinancialDay=0;state.lastMarketHour=0;
    let wall=0,work=0,durable=false,cancels=0;const digests=new Map();
    // Each stage of a job costs 1 ms of the injected clock (deterministic; the frame budget still ends the frame).
    const measured=fn=>{try{return fn();}finally{work+=1;}};
    const digest=()=>crypto.createHash('sha256').update(JSON.stringify({t:state.simSeconds,fleet:s.GH_FLEET_DATA.list(state).map(a=>s.GH_FLEET_DATA.plain(a)),rev:state.tripRevenueAccrued||{},profit:state.tripProfitAccrued||{},days:s.__financialDays,hours:s.__marketHours})).digest('hex');
    const engine=SOURCES[which].core.create({getSimTime:()=>state.simSeconds,setSimTime:v=>{state.simSeconds=v;},getSpeed:()=>SPEED,setSpeed:()=>{},isSuspended:()=>durable,
      createSliceJob:(slice,meta)=>{const job=measured(()=>s.__makeFleetSliceJob(slice,meta)),finish=job.finish,runChunk=job.runChunk;job.runChunk=(...a)=>measured(()=>runChunk.apply(job,a));job.finish=info=>measured(()=>{const out=finish.call(job,info);if(out?.committed)digests.set(state.simSeconds,digest());return out;});const cancel=job.cancel;job.cancel=info=>{cancels++;return cancel?.call(job,info);};return job;}},
      {...SOURCES[which].options,nowMs:()=>wall+work,longTaskWarnMs:1e9,hardTaskMs:1e9});
    for(let i=0;i<20000&&state.simSeconds<7200;i++){if(commandsOn)durable=(i%69)>=44;wall+=TICK;engine.frame(wall+work);}
    digests.cancels=cancels;return digests;
  };
  const before=play('before',false),now=play('now',true);
  const shared=[...now.keys()].filter(t=>before.has(t));
  assert.equal(now.cancels,before.cancels+1,'f: the command cancels the slice in flight once');assert.ok(shared.length>=20,`f: ${shared.length} common committed times`);
  for(const t of shared)assert.equal(now.get(t),before.get(t),`f: digest at ${t}`);
  results.push({name:'f. same economy at the same committed time',commonTimes:shared.length,cancelsWithCommands:now.cancels,lastNow:Math.max(...now.keys()),lastBefore:Math.max(...before.keys())});
}

// g. app.js wiring (source contract): the loop and observeLoopLock both ask holdAdvanceThroughLock before a reset, and
// the engine is suspended by a durable command and a save lock.
{
  const app=SOURCES.now.app;
  assert.equal((app.match(/if\(!holdAdvanceThroughLock\((?:lock|guardReason)\)\)simulationEngine\.reset\((?:performance\.now\(\)|now),(?:lock|guardReason)\);/g)||[]).length,2,'g: both lock observers ask before resetting');
  assert.match(app,/isSuspended:\(\)=>[^\n]*durableCommandInProgress[^\n]*window\.GH_PERSISTENCE\.isLocked\(\)/,'g: a command and a save suspend the engine');
  assert.equal(SOURCES.now.options.minRealSliceSeconds,1,'g: the app batches a second of play per live slice');
  results.push({name:'g. app wiring'});
}
console.log(JSON.stringify({suite:'build701-command-keeps-clock',ok:true,previous:PREVIOUS,results},null,1));
