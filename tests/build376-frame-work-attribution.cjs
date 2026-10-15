'use strict';
const assert=require('node:assert/strict'),{harness,minimal}=require('./helpers/core-harness');
(async()=>{
 const fs=require('node:fs'),path=require('node:path'),app=fs.readFileSync(path.resolve(__dirname,'../WebApp/app.js'),'utf8'),start=app.indexOf('  function yieldForInteractivePaint('),end=app.indexOf('  function bindDrawerActions(',start);assert.ok(start>=0&&end>start);
 let rafCallback,sequence=0,resumed=false;const timers=new Map(),paintYield=new Function('requestAnimationFrame','setTimeout','clearTimeout',app.slice(start,end)+';return yieldForInteractivePaint;')(fn=>{rafCallback=fn;},(fn,ms)=>{const id=++sequence;timers.set(id,{fn,ms});return id;},id=>timers.delete(id));
 const painting=paintYield().then(()=>{resumed=true;});rafCallback();await Promise.resolve();assert.equal(resumed,false,'the copy must not resume in an animation callback microtask before paint');
 const next=[...timers.entries()];assert.equal(next.length,1);assert.equal(next[0][1].ms,0);timers.delete(next[0][0]);next[0][1].fn();await painting;assert.equal(resumed,true);
 resumed=false;const hidden=paintYield(80).then(()=>{resumed=true;});const fallback=[...timers.entries()][0];timers.delete(fallback[0]);fallback[1].fn();await hidden;rafCallback();assert.equal(resumed,true);assert.equal(timers.size,0,'late animation callbacks cannot resume a timed-out yield twice');
 const {s}=harness(['transaction-core','diagnostics-core']),d=s.GH_DIAGNOSTICS,tx=s.GH_TRANSACTION_CORE,state=minimal();
 let now=1000;s.performance={now:()=>now};state.speed=0;
 assert.equal(d.recordMainThreadWork(state,'off',1,100),false);
 d.recorderStart(state,{speed:0},{nowMs:1000000,performanceNowMs:now});
 const saved=JSON.stringify(state),frame=(at)=>d.recorderFrame(state,{rafTimestampMs:at,callbackStartMs:at+.1,callbackEndMs:at+1,visible:true,hidden:false});
 for(let i=0;i<40;i++){frame(now);now+=1000/60;}
 const oldAt=now-500;d.recordMainThreadWork(state,'stale.clone',oldAt,oldAt+100);
 const native=s.structuredClone;s.structuredClone=value=>{const out=native(value);now+=24;return out;};
 let release,persistStarted=false;const copyStarted=now;
 const pending=tx.executeDurable(state,{apply:draft=>{draft.sample='kept';},persist:()=>{persistStarted=true;return new Promise(resolve=>{release=resolve;});},publish:(live,draft)=>Object.assign(live,draft)});
 await Promise.resolve();await Promise.resolve();assert.equal(persistStarted,true);
 frame(now+25);now+=25;
 let drop=d.recorderSnapshot(state).events.find(row=>row.type==='FRAME_DROP');
 assert.equal(drop.detail.cause.kind,'measured-main-thread-work');assert.equal(drop.detail.cause.stage,'command.clone');assert.equal(drop.detail.cause.durationMs,24);
 assert.ok(drop.detail.mainThreadWork.every(row=>row.stage!=='stale.clone'),'old work cannot explain a current gap');
 assert.equal(state.sample,undefined,'live state remains unchanged while native commit is pending');
 // A native/worker wait is deliberately long; its wall time never becomes a synchronous-work interval.
 now+=600;frame(now);drop=d.recorderSnapshot(state).events.find(row=>row.type==='FRAME_DROP');
 assert.equal(drop.detail.cause.kind,'unattributed-scheduler-or-compositor');assert.equal(drop.detail.mainThreadWork.length,0);
 release({ok:true});await pending;assert.equal(state.sample,'kept');assert.ok(tx.telemetry().lastDurable.totalMs>=649);
 assert.equal(d.recordMainThreadWork(state,'invalid',NaN,now),false);assert.equal(d.recordMainThreadWork(state,'reversed',now+1,now),false);
 // Bounded collection, including at speed zero; no state scans or changes from measurement.
 const before=JSON.stringify(state);for(let i=0;i<1000;i++)d.recordMainThreadWork(state,'bounded',now+i,now+i+2);assert.equal(JSON.stringify(state),before);assert.equal(d.recorderSnapshot(state).frameSummary.mainThreadWorkSamples,96);
 d.recordMainThreadWork(state,'future',now+5000,now+5100);
 now+=1200;frame(now);now+=60;frame(now);
 assert.equal(d.recorderSnapshot(state).events.find(row=>row.type==='FRAME_DROP').detail.mainThreadWork.length,0,'future intervals do not explain an earlier frame');
 d.recorderStop(state,{speed:0},{nowMs:1005000});assert.equal(d.recordMainThreadWork(state,'stopped',now,now+100),false);
 assert.ok(saved.length>0&&copyStarted>1000);
 console.log(JSON.stringify({suite:'build376-frame-work-attribution',ok:true,blockingCloneMs:24,asyncWaitMs:600,asyncWaitBlamed:false,staleWorkBlamed:false,durable:true}));
})().catch(error=>{console.error(error);process.exitCode=1;});
