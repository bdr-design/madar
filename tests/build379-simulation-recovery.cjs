'use strict';
const assert=require('node:assert/strict'),{harness}=require('./helpers/core-harness');let checks=0;
for(const rollback of [false,true]){
 const {s}=harness(['simulation-core']);let now=0,time=0,fault=true,allow=false;const events=[];
 const engine=s.GH_SIMULATION_CORE.create({getSimTime:()=>time,setSimTime:v=>{time=v;},getSpeed:()=>0,canRecoverFatal:()=>allow,
 createSliceJob:(_slice,meta)=>({runChunk:()=>true,finish:()=>{if(fault)throw Object.assign(new Error(rollback?'rollback failed':'posting failure'),{code:rollback?'TRANSACTION_ROLLBACK_FAILED':'FINANCE_ACCOUNT_POSTING_MISMATCH',postingEvidence:{company:'air',before:1.98e14,appliedAmount:.1}});return {committed:true,completeTo:meta.to};},cancel(){}}),onAdvance:e=>events.push(e)
 },{nowMs:()=>now,allowedSpeeds:[0,30,600],fallbackSpeed:30,manualMinBatchSeconds:300});
 const advance=target=>{assert.equal(engine.advanceTo(target).accepted,true);for(let i=0;i<100&&engine.snapshot().manualAdvance;i++){now+=16;engine.frame(now);}assert.equal(engine.snapshot().manualAdvance,null);};
 advance(600);assert.equal(time,0);assert.ok(engine.snapshot().fatalError);assert.equal(events.find(e=>e.failed).errorDetail.postingEvidence.company,'air');engine.reset();assert.ok(engine.snapshot().fatalError,'reset must retain the unresolved fault');
 fault=false;advance(300);assert.ok(engine.snapshot().fatalError,'a commit before the failed boundary is insufficient');
 advance(600);assert.ok(engine.snapshot().fatalError,'the host must confirm recovery');allow=true;advance(900);
 if(rollback)assert.ok(engine.snapshot().fatalError,'rollback failures require explicit recovery');else{assert.equal(engine.snapshot().fatalError,null);assert.equal(engine.snapshot().lastRecoveredFatal.error.code,'FINANCE_ACCOUNT_POSTING_MISMATCH');assert.equal(engine.snapshot().lastRecoveredFatal.recoveredAt,900);}
 assert.equal(engine.snapshot().manualFailures,1,'recovery must not erase fault history');checks++;
}
{
 const {s}=harness(['diagnostics-core']);const state={simSeconds:1,speed:0,cash:1,debt:0,groupValue:1,finance:{},simulationKernel:{runtimeFatal:{error:{code:'FINANCE_ACCOUNT_POSTING_MISMATCH',message:'posting failure'}}}};
 assert.ok(s.GH_DIAGNOSTICS.runHealthCheck(state).issues.some(x=>x.id==='SIM_FATAL_STATE'),'omitting runtime snapshot cannot hide a persisted active fatal');checks++;
}
console.log(JSON.stringify({suite:'build379-simulation-recovery',ok:true,checks,resetCannotClear:true,rollbackCannotAutoRecover:true,historyPreserved:true}));
