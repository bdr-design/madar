'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {harness,minimal}=require('./helpers/core-harness'),ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..'),results=[];
{
 const {s}=harness(['transaction-core','diagnostics-core']),D=s.GH_DIAGNOSTICS,state=minimal();state.speed=3;
 D.recorderStart(state,{speed:300,frames:1},{nowMs:1000});state.simSeconds=20;const first=D.recorderStop(state,{speed:300,frames:2},{nowMs:2000});state.simSeconds=999;
 const again=D.recorderStop(state,{speed:300,frames:3},{nowMs:9000});assert.deepEqual(again,first,'repeated stop must not extend recording time or include later simulation');assert.equal(D.recorderSnapshot(state).endedAtMs,2000);
 D.recorderStart(state,{speed:300,frames:1},{nowMs:10000});D.recorderSample(state,{speed:300,frames:2,hidden:true},{nowMs:11000});D.recorderSample(state,{speed:300,frames:3,hidden:true},{nowMs:21000});D.recorderSample(state,{speed:300,frames:4,hidden:false},{nowMs:30000});
 let events=D.recorderSnapshot(state).events;assert(!events.some(e=>['SIM_PROGRESS_STALLED','LIVE_SPEED_UNDERRUN'].includes(e.type)),'background and first resume are expected pauses');
 D.recorderSample(state,{speed:300,frames:5,hidden:false},{nowMs:38000});events=D.recorderSnapshot(state).events;assert(events.some(e=>e.type==='SIM_PROGRESS_STALLED'),'a genuine visible stall remains detectable');
 results.push({case:'idempotent stop and visibility pause',ok:true});
}
{
 const env=harness([]);let peakMapSize=0;env.s.Map=class extends Map{set(k,v){super.set(k,v);peakMapSize=Math.max(peakMapSize,this.size);return this;}};env.load('transaction-core');let now=0;env.s.performance={now:()=>now};
 const state={count:0},tx=env.s.GH_TRANSACTION_CORE;
 tx.execute(state,{profile:true,apply:measure=>{
  for(let i=0;i<3000;i++)measure(`simulation.finance-day.owner.telecom.telecom-market:MKT-${i}`,()=>{now+=1;});
  for(let i=0;i<3;i++){measure('simulation.finance-day.realism-close:realism.fleet-day-wait',()=>{now+=2;});now+=50;}
  measure('simulation.finance-day.daily-close-postings',()=>{now+=3;});return true;
 }});
 const rows=tx.telemetry().last.phaseTotals,market=rows.find(r=>r.name==='simulation.finance-day.owner.telecom.telecom-market'),wait=rows.find(r=>r.name.endsWith('fleet-day-wait'));
 assert(market,'entity-specific IDs must share the owning stage');assert.equal(market.calls,3000);assert.equal(market.busyMs,3000);assert.equal(wait.calls,3);assert.equal(wait.busyMs,6);assert.equal(wait.spanMs,106);assert.equal(rows.length,3);
 tx.execute(state,{profile:true,apply:measure=>{for(let i=0;i<10000;i++)measure('unknown-'+i,()=>{now++;});}});assert.equal(tx.telemetry().last.phaseTotals.length,65);assert(peakMapSize<=65,'the index itself, not only exported rows, must be bounded');
 results.push({case:'late stages remain attributed; bounded index',entitySteps:3000,lateWaitMs:wait.spanMs,peakMapSize});
}
{
 const app=fs.readFileSync(path.join(ROOT,'WebApp/app.js'),'utf8'),push=app.indexOf('  function pushAlert(text){'),decl=app.lastIndexOf('  const deferredStagedAlerts=',push),end=app.indexOf('  const validMoney',push);assert(push>0&&end>push);
 let staged=true,epoch=0,dispatches=0;const callbacks=[],state={resetEpoch:0},notices=[];
 const context={state,window:{GH_TRANSACTION_CORE:{isStaged:()=>staged,isActive:()=>false,afterCommit:fn=>fn()}},afterStagedState:fn=>callbacks.push(fn),nextId:()=>String(++epoch),dispatchSystemCommand:()=>{if(staged)throw new Error('staged-transaction-in-progress');dispatches++;return {ok:true};},updateKpis:()=>{}};
 const pushAlert=vm.runInNewContext(`(()=>{${app.slice(decl>=0?decl:push,end)};return pushAlert;})()`,context);context.window.GH_INTERACTION_NOTICE=text=>{notices.push(text);return pushAlert(text);};
 for(let i=0;i<100;i++)pushAlert('recording stopped');assert.equal(dispatches,0,'no write before the staged owner settles');assert.equal(callbacks.length,1,'one existing lifecycle waiter, no timer per message');
 staged=false;callbacks.shift()();assert.equal(dispatches,1,'exactly one notification after commit');assert.equal(notices.length,1);
 staged=true;for(let i=0;i<100;i++)pushAlert('notice-'+i);assert.equal(callbacks.length,1);staged=false;callbacks.shift()();assert.equal(dispatches,2,'16 pending messages flush in one notification transaction');assert.equal(notices[1].split(' • ').length,16,'the pending messages stay bounded');
 staged=true;pushAlert('old world');state.resetEpoch++;staged=false;callbacks.shift()();assert.equal(dispatches,2,'old-world callbacks cannot write into a reset game');
 staged=true;pushAlert('after rollback');staged=false;callbacks.shift()();assert.equal(dispatches,3,'rollback releases the notification lifecycle too');
 results.push({case:'staged UI notifications, duplicate/bound/reset/rollback',ok:true});
}
console.log(JSON.stringify({suite:'build407-diagnostic-lifecycle',ok:true,results}));
