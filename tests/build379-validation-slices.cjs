'use strict';
const assert=require('node:assert/strict'),{harness}=require('./helpers/core-harness');
(async()=>{
 const {s}=harness(['transaction-core']);let now=0,yields=0,persisted=0,steps=0;const samples=[],t=s.GH_TRANSACTION_CORE,live={saveRevision:1,cash:1},before=JSON.stringify(live);
 s.performance={now:()=>now};s.GH_FLEET_DATA={size:()=>0};s.GH_SAVE_SCHEMA={validate(){throw new Error('synchronous-validation-forbidden');},*validationSteps(draft){for(let i=0;i<5;i++){now+=3;steps++;yield 'section';}return {ok:!draft.invalid,errors:draft.invalid?['injected-invalid']:[]};}};
 s.GH_DIAGNOSTICS={recordMainThreadWork(_state,stage,start,end){if(stage==='command.schema')samples.push(end-start);}};
 const options={yieldToHost:async()=>{yields++;assert.equal(t.isDurableActive(live),true);assert.equal(JSON.stringify(live),before);assert.throws(()=>t.execute(live,{apply(){}}),/durable-live-state-transaction-blocked/);now+=100;},apply:draft=>{draft.changed=true;},persist:async draft=>{persisted++;assert.equal(JSON.stringify(live),before);assert.equal(draft.saveRevision,2);return {ok:true};}};
 const result=await t.executeDurable(live,options),timing=t.telemetry().lastDurable;
 assert.equal(result.committed,true);assert.equal(steps,5);assert.equal(persisted,1);assert.equal(yields,2);assert.equal(timing.validateBusyMs,15);assert.equal(timing.validateMaxSliceMs,6);assert.equal(timing.validateMs,215);assert.equal(samples.reduce((a,b)=>a+b,0),15);assert.equal(live.changed,true);
 const stable=JSON.stringify(live);await assert.rejects(t.executeDurable(live,{...options,yieldToHost:()=>Promise.resolve(),apply:draft=>{draft.invalid=true;}}),/invalid-draft:injected-invalid/);assert.equal(JSON.stringify(live),stable);assert.equal(persisted,1);assert.equal(t.isDurableActive(live),false);
 await assert.rejects(t.executeDurable(live,{...options,yieldToHost:()=>{throw new Error('host-refused');}}),/host-refused/);assert.equal(JSON.stringify(live),stable);assert.equal(t.isDurableActive(live),false);
 console.log(JSON.stringify({suite:'build379-validation-slices',ok:true,sections:steps,yields,busyMs:timing.validateBusyMs,maxSliceMs:timing.validateMaxSliceMs,wallMs:timing.validateMs,failedValidationDoesNotPersist:true}));
})().catch(error=>{console.error(error);process.exitCode=1;});
