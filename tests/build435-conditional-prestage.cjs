'use strict';
const assert=require('node:assert/strict'),{harness}=require('./helpers/core-harness');
const results=[];
function scenario({ready=true,available=true,stageThrows=false,stageFails=false,invalid=false}={}){
 const {s:g}=harness(['transaction-core']),tx=g.GH_TRANSACTION_CORE,log=[],live={saveRevision:1,cash:100,simSeconds:0};
 let resolveValidation,resolveStage,resolvePersist,rejectPersist;
 const validation=new Promise(resolve=>{resolveValidation=resolve;}),staged=new Promise(resolve=>{resolveStage=resolve;}),ack=new Promise((resolve,reject)=>{resolvePersist=resolve;rejectPersist=reject;});
 const evidence={current:()=>true};g.GH_FLEET_DATA={size:()=>1000000};
 g.GH_FLEET_VALIDATION_PROVIDER=(_state,_params,{beforeAsync}={})=>{if(!available)return null;if(ready)return evidence;beforeAsync?.();beforeAsync?.();log.push('worker-query');return validation;};
 g.GH_SAVE_SCHEMA={*validationSteps(draft,options){log.push('schema');const value=options.fleetValidation(draft,{});let found=value;if(value?.then){const box={done:false,value:null};value.then(v=>{box.done=true;box.value=v;});while(!box.done)yield 'fleet-validation-wait';found=box.value;}log.push('schema-done');return {ok:!invalid&&!!found?.current?.(),errors:[invalid?'injected-invalid':'fleet-validation-unavailable']};}};
 const start=()=>tx.executeDurable(live,{yieldToHost:async()=>{},prestage(draft){log.push('prestage');assert.equal(draft.changed,true);assert.equal(draft.saveRevision,2);if(stageThrows)throw new Error('optional-stage-broken');return {settled:staged,release(){log.push('release');}};},apply(draft){log.push('apply');draft.changed=true;},persist:async(draft,meta)=>{log.push('persist');assert.equal(live.changed,undefined);assert.equal(live.saveRevision,1);assert.equal(meta.prevalidated,true);await ack;return {ok:true};}});
 const waitFor=async name=>{for(let i=0;i<100&&!log.includes(name);i++)await new Promise(resolve=>setTimeout(resolve,1));assert(log.includes(name),`missing ${name}: ${log}`);};
 return {g,tx,log,live,start,waitFor,resolveValidation:()=>resolveValidation(evidence),resolveStage:()=>resolveStage({ok:!stageFails,uploads:stageFails?0:2,bytes:stageFails?0:8}),resolvePersist,rejectPersist};
}
(async()=>{
 for(const ready of [true,false]){
  const s=scenario({ready}),pending=s.start();await s.waitFor(ready?'schema-done':'worker-query');
  if(ready){assert.equal(s.log.includes('prestage'),false,'ready fleet evidence must not serialize/prepare the same save twice');await s.waitFor('persist');}
  else{assert(s.log.indexOf('prestage')<s.log.indexOf('worker-query'),'stage starts before validation can queue a full worker pass');s.resolveValidation();await s.waitFor('schema-done');await new Promise(resolve=>setTimeout(resolve,8));assert.equal(s.log.includes('persist'),false,'persist waits for staged uploads to settle');assert.equal(s.live.changed,undefined);s.resolveStage();await s.waitFor('persist');}
  assert.equal(s.live.changed,undefined,'no financial publication before durable ACK');s.resolvePersist();assert.equal((await pending).committed,true);assert.equal(s.live.changed,true);assert.equal(s.live.saveRevision,2);assert.equal(s.log.filter(v=>v==='prestage').length,ready?0:1);assert.equal(s.log.filter(v=>v==='release').length,ready?0:1);results.push({ready,prestage:ready?0:1,ackBeforePublish:true});
 }
 for(const available of [true,false]){
  const s=scenario({ready:false,available,invalid:available}),stable=JSON.stringify(s.live),pending=s.start();const rejected=assert.rejects(pending,/invalid-draft:(injected-invalid|fleet-validation-unavailable)/);
  if(available){await s.waitFor('worker-query');s.resolveValidation();}await rejected;assert.equal(JSON.stringify(s.live),stable);assert.equal(s.log.includes('persist'),false);assert.equal(s.log.filter(v=>v==='prestage').length,available?1:0);assert.equal(s.log.filter(v=>v==='release').length,available?1:0);s.resolveStage();results.push({invalid:true,available,noPersist:true,exactRollback:true});
 }
 for(const stageThrows of [true,false]){
  const s=scenario({ready:false,stageThrows,stageFails:!stageThrows}),pending=s.start();await s.waitFor('worker-query');s.resolveValidation();s.resolveStage();await s.waitFor('persist');s.resolvePersist();assert.equal((await pending).committed,true);assert.equal(s.log.filter(v=>v==='persist').length,1);results.push({optionalStageThrows:stageThrows,optionalStageFails:!stageThrows,fallbackCommit:true});
 }
 for(const ready of [true,false]){
  const s=scenario({ready}),stable=JSON.stringify(s.live),pending=s.start();const rejected=assert.rejects(pending,/native-nack/);
  if(!ready){await s.waitFor('worker-query');s.resolveValidation();s.resolveStage();}await s.waitFor('persist');s.rejectPersist(Error('native-nack'));await rejected;
  assert.equal(JSON.stringify(s.live),stable,'NACK restores live state on both ready and pending-proof paths');assert.equal(s.log.filter(v=>v==='release').length,ready?0:1);assert.equal(s.tx.isDurableActive(s.live),false);results.push({ready,nativeNack:true,exactRollback:true,stagingReleased:!ready});
 }
 console.log(JSON.stringify({suite:'build435-conditional-prestage',passed:results.length,results}));
})().catch(e=>{console.error(e);process.exitCode=1;});
