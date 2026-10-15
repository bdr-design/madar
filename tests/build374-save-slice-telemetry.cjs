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
  console.log(JSON.stringify({ok:true,busyMs:t.totalSyncMs,maxBusySliceMs:t.maxBusySliceMs,wallMs:t.wallMs,yields}));
})().catch(e=>{console.error(e);process.exitCode=1;});
