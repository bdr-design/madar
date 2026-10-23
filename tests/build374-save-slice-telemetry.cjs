'use strict';
const assert=require('node:assert/strict'),{scenario}=require('./helpers/business-scenario');
(async()=>{
  const e=scenario(),{s,state}=e;e.load('state-codec-core');e.load('persistence-core');
  const original=s.GH_STATE_CODEC;let clock=0,yields=0,generation=0;s.performance={now:()=>clock};
  // Deterministic workload: 4+7 ms in one task, 100 ms host wait, then 3 ms of work.
  s.GH_STATE_CODEC={...original,serializeSteps:function*(){clock+=4;yield;clock+=7;yield;clock+=3;return original.serialize(state);}};
  s.webkit={messageHandlers:{saveBridge:{postMessage(m){
    if(m.action==='commitSave')setImmediate(()=>s.GH_PERSISTENCE.receiveAck({requestId:m.requestId,action:m.action,saveRevision:m.saveRevision,resetEpoch:m.resetEpoch,saveSchemaVersion:m.saveSchemaVersion,saveHash:m.saveHash,success:true,generation:++generation}));
  }}}};
  await s.GH_PERSISTENCE.commitDurableState(state,{yieldToFrame:async()=>{yields++;clock+=100;},prevalidated:true});
  const t=s.GH_PERSISTENCE.telemetry().timings.samples.find(r=>r.kind==='durable-save');
  assert.equal(t.ok,true);assert.equal(t.stringifyMs,14);assert.equal(t.maxBusySliceMs,11);assert.ok(t.wallMs>=114);assert.ok(yields>0);
  assert.equal(t.checksumRequests,0);assert.equal(t.checksumWorkerMs,0);
  // The durable commit records its own duration (it was written as 0), and a save step holding the main thread 8 ms or
  // more is reported to the frame recorder's reporter while a shorter one is not; a failing reporter cannot fail a save.
  // The save's timing names what the codec wrote: its counter deltas and its largest roots, in characters, largest first.
  assert.ok(Array.isArray(t.codec?.roots)&&['collectionHits','collectionMisses','sealedTextHits'].every(key=>Number.isFinite(t.codec[key])),'the save timing carries the codec counter deltas and roots');
  {const rows=n=>Array.from({length:n},(_,i)=>({id:`R-${i}`,kind:'qa',amount:i}));original.serialize({small:{a:1},large:rows(300),middle:rows(90)});
   const roots=original.cacheStats().roots.filter(row=>row.key!=='stateCodec');assert.equal(roots.map(row=>row.key).join(),'large,middle,small','the roots, largest first (the codec\'s own stateCodec root aside)');assert.ok(roots[0].chars>roots[1].chars&&roots[1].chars>roots[2].chars);}
  const commit=s.GH_PERSISTENCE.telemetry().samples.find(r=>r.operation==='durable-commit');assert.ok(commit.durationMs>=114,'the durable commit records its duration');
  const reports=[];s.GH_SAVE_WORK_REPORTER=(start,end)=>reports.push(end-start);
  s.GH_STATE_CODEC={...original,serializeSteps:function*(){clock+=12;yield;clock+=7;yield;clock+=8;return original.serialize(state);}};
  await s.GH_PERSISTENCE.commitDurableState(state,{yieldToFrame:async()=>{clock+=100;},prevalidated:true});
  assert.deepEqual(reports,[12,8],'the 12 and 8 ms steps are reported, the 7 ms one is not');
  s.GH_SAVE_WORK_REPORTER=()=>{throw new Error('reporter-broken');};
  assert.equal((await s.GH_PERSISTENCE.commitDurableState(state,{yieldToFrame:async()=>{clock+=100;},prevalidated:true})).ok,true,'a failing reporter does not fail the save');
  console.log(JSON.stringify({ok:true,busyMs:t.totalSyncMs,maxBusySliceMs:t.maxBusySliceMs,wallMs:t.wallMs,yields}));
})().catch(e=>{console.error(e);process.exitCode=1;});
