'use strict';
// Build 362 follow-up (the iPhone day close took 4.5-5.7 s, yet the last 64 profiled phases it kept explained ~90 ms):
// a profiled transaction also keeps, per phase name, its calls, work, longest call and the span from its first start to
// its last end (waits between its calls included), in order of first start, bounded to 64 names plus '(other phases)'.
// Nothing is kept for a transaction that is not profiled.
const assert=require('node:assert/strict');
const {harness,minimal}=require('./helpers/core-harness');
const {s}=harness(['transaction-core']),tx=s.GH_TRANSACTION_CORE;let now=0;s.performance={now:()=>now};
const state=minimal();state.counter=0;

const profiled=tx.execute(state,{label:'simulation:0->86400',profile:true,apply:measure=>{
  // 'realism.insurance-wait' is called three times, 4 ms of work each, with 100 ms of waiting between the calls.
  measure('realism.maintenance',()=>{now+=2;});
  for(let k=0;k<3;k++){measure('realism.insurance-wait',()=>{now+=4;});now+=100;}
  measure('daily-close-postings',()=>{now+=30;measure('daily-close-postings.inner',()=>{now+=5;});});
  for(let k=0;k<80;k++)measure(`phase-${k}`,()=>{now+=1;});
  state.counter++;return true;
}});
assert.equal(profiled.committed,true);
const sample=tx.telemetry().profiledSamples[0],rows=sample.phaseTotals,byName=new Map(rows.map(row=>[row.name,row]));
assert.equal(sample.phaseBreakdown.length,64,'the recent-phase list keeps its bound');
const wait=byName.get('realism.insurance-wait');
assert.deepEqual({calls:wait.calls,busyMs:wait.busyMs,maxMs:wait.maxMs,spanMs:wait.spanMs},{calls:3,busyMs:12,maxMs:4,spanMs:212},'work and span (waits included) are both kept');
assert.equal(byName.get('daily-close-postings').busyMs,35,'a phase includes its nested phases');assert.equal(byName.get('daily-close-postings.inner').busyMs,5);
assert.deepEqual(rows.slice(0,3).map(row=>row.name),['realism.maintenance','realism.insurance-wait','daily-close-postings'],'rows follow first start');
assert.equal(rows.length,65,'64 names, then one row for the rest');
const other=byName.get('(other phases)');assert.equal(other.calls,84-64+0,'the remaining names share one row');
assert.equal(rows.reduce((sum,row)=>sum+row.calls,0),3+1+1+1+80,'every call is counted once');

const plain=tx.execute(state,{label:'plain',profile:false,apply:measure=>{measure('x',()=>{now+=1;});return true;}});
assert.equal(plain.committed,true);assert.equal(tx.telemetry().last.phaseTotals,null,'an unprofiled transaction keeps nothing');
console.log(JSON.stringify({suite:'build362-phase-totals',ok:true,names:rows.length,insuranceWait:{calls:wait.calls,busyMs:wait.busyMs,spanMs:wait.spanMs}}));
