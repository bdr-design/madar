'use strict';
const assert=require('node:assert/strict'),{harness}=require('./helpers/core-harness');
function run(fails,wait){
  const {s}=harness(['transaction-core']);let clock=0;s.performance={now:()=>clock};const TX=s.GH_TRANSACTION_CORE,state={n:0};
  const h=TX.beginStaged(state,{scope:['n'],apply:function*(){state.n=1;TX.afterCommit(function*(){clock+=5;yield 'section';clock+=7;if(fails)throw new Error('intended-final-failure');},{critical:true,key:'timed'});yield 'apply';}});
  for(let calls=0;!h.done&&calls<20;calls++){clock+=wait;h.step();}
  const t=TX.telemetry().last;assert.equal(h.done,true);assert.equal(!!h.error,fails);assert.equal(state.n,fails?0:1);
  assert.equal(t.postCommitCriticalTasks[0].durationMs,12);assert.equal(t.postCommitCriticalMs,12,'active work only, on success and failure');
  return {fails,wait,criticalMs:t.postCommitCriticalMs};
}
const {s}=harness(['transaction-core']);let clock=0;s.performance={now:()=>clock};const TX=s.GH_TRANSACTION_CORE,state={n:0};
const direct=TX.beginStaged(state,{scope:['n'],apply:function*(){state.n=1;TX.afterCommit(()=>{clock+=7;throw new Error('direct-critical-failure');},{critical:true});yield 'apply';}});
while(!direct.done){clock+=100;direct.step();}
assert.equal(direct.error.message,'direct-critical-failure');assert.equal(state.n,0);
assert.equal(TX.telemetry().last.postCommitCriticalTasks[0].durationMs,7);assert.equal(TX.telemetry().last.postCommitCriticalMs,7);
console.log(JSON.stringify({ok:true,results:[run(false,0),run(false,100),run(true,0),run(true,100)],directThrowMs:7}));
