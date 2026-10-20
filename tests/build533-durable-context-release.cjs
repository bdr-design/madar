'use strict';
// An independent review found that runDurableStateCommand released its __GH_DURABLE_COMMAND_CONTEXT__ only when the
// context's draft was the command's draft. The context is set with draft:null before the clone and replaced with the
// draft after inheritVerified and routeRuntimeForState; a throw in either left {draft:null} set after the command had
// rolled back, so transaction-core refused every authorized command ('durable-command-context-in-progress'), sliced
// saves stopped and pushAlert kept deferring, until another durable command replaced it. The command now releases the
// context it set, by identity, and a notice raised while the context held no draft (a refused tap during the sliced
// clone) moves to the full context instead of being dropped. Proven with the real app command and notice() (extracted
// as build334-durable-publication-recovery does) and the real persistence, schema, integrity and transaction owners:
//  1. a throw in routeRuntimeForState, and 2. in inheritVerified: the command returns false, the live state and the
//     stored snapshot are unchanged, no context is left, persistence is not locked, an authorized command is admitted,
//     the failure notice is shown, and the next durable command commits exactly once (one revision, its change only);
//  3. a successful command releases its context and commits once; a notice raised during the clone and one raised
//     during apply are each shown once, after the command;
//  4. a context the command did not set is never deleted: one present when a command fails before setting its own,
//     and one put in place from inside apply before it throws;
//  5. the previous release condition, restored in memory, leaves the context set and refuses authorized commands.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {ROOT}=require('./helpers/core-harness'),{scenario}=require('./helpers/business-scenario');
const PREVIOUS_RELEASE="const context=window.__GH_DURABLE_COMMAND_CONTEXT__?.liveState===state&&window.__GH_DURABLE_COMMAND_CONTEXT__?.draft===draft?window.__GH_DURABLE_COMMAND_CONTEXT__:null;";
const CURRENT_RELEASE="const context=durableContext&&window.__GH_DURABLE_COMMAND_CONTEXT__===durableContext?durableContext:null;";
const tick=()=>new Promise(resolve=>setTimeout(resolve,5));
function environment(app,{failRoutes=false,failInherit=false,noticeDuringClone=null}={}){
  const cut=(from,to)=>{const a=app.indexOf(from),b=app.indexOf(to,a);assert(a>=0&&b>a,`source: ${from}`);return app.slice(a,b);};
  const e=scenario();e.load('persistence-core');const key='audit-durable-context',events=[],shown=[];assert.equal(e.s.GH_PERSISTENCE.commitState(e.state,{storageKey:key}).ok,true);
  let routeCalls=0,cloneNoticeRaised=false;
  if(failInherit){const schema=e.s.GH_SAVE_SCHEMA;let thrown=false;e.s.GH_SAVE_SCHEMA={...schema,inheritVerified(...args){if(!thrown){thrown=true;throw new Error('qa-inherit-failure');}return schema.inheritVerified?.(...args);}};}
  // The cooperative clone path yields to the page; a notice raised there is raised while the context holds no draft.
  const tx=e.s.GH_TRANSACTION_CORE;e.s.GH_TRANSACTION_CORE={...tx,deepCloneInSlices:async(value,options)=>{await options.yieldToHost();return tx.deepCloneInSlices(value,options);}};
  Object.assign(e.s,{state:e.state,document:{hidden:false},hardResetInProgress:false,durableCommandInProgress:false,storageKey:key,APP_VERSION:'3.0.0',clone:structuredClone,fleetEngineThreadClient:null,activeDrawerPanel:null,
    routeRuntimeForState:()=>{if(failRoutes&&routeCalls++===0)throw new Error('qa-route-runtime-failure');return {};},
    replaceLiveState:draft=>e.s.GH_TRANSACTION_CORE.restoreObject(e.state,draft),diag:(type,detail)=>events.push({type,detail}),pushAlert:text=>shown.push(String(text)),GH_WORKFLOW:{notify:text=>{shown.push(String(text));return true;}},
    yieldForInteractivePaint:()=>{if(noticeDuringClone&&!cloneNoticeRaised){cloneNoticeRaised=true;e.s.notice(noticeDuringClone);}return Promise.resolve();},
    fleetStepSettled:()=>Promise.resolve(),simulationEngine:{cancelAdvance:()=>{}},console:{...console,warn:()=>{},error:()=>{}}});
  vm.runInContext(cut('  const appMetricClock=','  function recordRenderMetric('),e.s);vm.runInContext(cut('  function stagedStateBusy(','  function scheduleSimulationPersistence('),e.s);
  vm.runInContext(cut('  let durableCommandSettlement=','  function authorizationIdempotencyKey'),e.s);vm.runInContext(cut('  function notice(','  async function ask('),e.s);
  return {...e,key,events,shown};
}
async function admission(e){try{await e.s.GH_TRANSACTION_CORE.executeDurable(e.state,{label:'qa-admission',apply:()=>{throw new Error('qa-admission-probe');}});return 'admitted';}catch(error){return String(error.message||error);}}
async function failedThenNext(app,options){
  const e=environment(app,options),before=JSON.stringify(e.state),stored=e.storage.getItem(e.key),revision=e.state.saveRevision;
  const failed=await e.s.runDurableStateCommand('qa-prepare-failure',({state})=>{state.profile.name='Must not publish';return true;},{silent:false});await tick();
  const after={failed,stateUnchanged:JSON.stringify(e.state)===before,storedUnchanged:e.storage.getItem(e.key)===stored,contextLeft:e.s.__GH_DURABLE_COMMAND_CONTEXT__!==undefined,locked:e.s.GH_PERSISTENCE.isLocked(),failureShown:e.shown.length>0};
  after.authorizedRefused=await admission(e)==='durable-command-context-in-progress';
  if(!after.contextLeft){
    const next=await e.s.runDurableStateCommand('qa-next',({state})=>{state.profile.name='Saved once';return true;},{silent:true});
    const saved=JSON.parse(e.storage.getItem(e.key));
    Object.assign(after,{next,nextRevision:e.state.saveRevision-revision,storedRevision:saved.saveRevision-revision,name:e.state.profile.name,storedName:saved.profile.name,contextAfterNext:e.s.__GH_DURABLE_COMMAND_CONTEXT__!==undefined});
  }
  return after;
}
function settledFailure(label,out){
  assert.equal(out.failed,false,`${label}: the command reports the failure`);
  assert.equal(out.stateUnchanged,true,`${label}: the live state is unchanged`);assert.equal(out.storedUnchanged,true,`${label}: the stored snapshot is unchanged`);
  assert.equal(out.contextLeft,false,`${label}: no durable command context is left`);assert.equal(out.locked,false,`${label}: persistence is not locked`);
  assert.equal(out.authorizedRefused,false,`${label}: an authorized command is admitted`);assert.equal(out.failureShown,true,`${label}: the failure is shown`);
  assert.equal(out.next,true,`${label}: the next durable command commits`);assert.equal(out.nextRevision,1,`${label}: exactly one revision`);assert.equal(out.storedRevision,1,`${label}: exactly one stored revision`);
  assert.equal(out.name,'Saved once');assert.equal(out.storedName,'Saved once');assert.equal(out.contextAfterNext,false,`${label}: the next command releases its context`);
}
(async()=>{
  const app=fs.readFileSync(path.join(ROOT,'WebApp/app.js'),'utf8'),results={};
  assert.equal(app.split(CURRENT_RELEASE).length,2,'the release condition is the identity check');
  results.routes=await failedThenNext(app,{failRoutes:true});settledFailure('1: routeRuntimeForState throws',results.routes);
  results.inherit=await failedThenNext(app,{failInherit:true});settledFailure('2: inheritVerified throws',results.inherit);
  {const e=environment(app,{noticeDuringClone:'qa-notice-during-clone'}),revision=e.state.saveRevision;
    const out=await e.s.runDurableStateCommand('qa-success',({state})=>{state.profile.name='Committed';e.s.notice('qa-notice-during-apply');return true;},{silent:true});
    const queued=e.shown.slice();await tick();
    results.success={out,contextLeft:e.s.__GH_DURABLE_COMMAND_CONTEXT__!==undefined,revision:e.state.saveRevision-revision,stored:JSON.parse(e.storage.getItem(e.key)).saveRevision-revision,shownDuring:queued,shown:e.shown};
    assert.deepEqual({out:results.success.out,contextLeft:results.success.contextLeft,revision:results.success.revision,stored:results.success.stored},{out:true,contextLeft:false,revision:1,stored:1},'3: a successful command releases its context and commits once');
    assert.deepEqual(queued,[],'3: notices wait for the command');
    assert.deepEqual(e.shown.filter(text=>text.startsWith('qa-notice')).sort(),['qa-notice-during-apply','qa-notice-during-clone'],'3: the clone and apply notices are each shown once');}
  {const e=environment(app),foreign={name:'qa-foreign',liveState:e.state,draft:null};e.s.__GH_DURABLE_COMMAND_CONTEXT__=foreign;
    const out=await e.s.runDurableStateCommand('qa-early-failure',()=>true,{silent:true,fleetMutation:true});
    results.foreignAtEntry={out,kept:e.s.__GH_DURABLE_COMMAND_CONTEXT__===foreign,inProgress:e.s.durableCommandInProgress};
    assert.deepEqual(results.foreignAtEntry,{out:false,kept:true,inProgress:false},'4: a context present before a command that fails before setting its own is kept');}
  {const e=environment(app),foreign={name:'qa-foreign-inside'};
    const out=await e.s.runDurableStateCommand('qa-apply-replaces',()=>{e.s.__GH_DURABLE_COMMAND_CONTEXT__=foreign;throw new Error('qa-apply-failure');},{silent:true});
    results.foreignInside={out,kept:e.s.__GH_DURABLE_COMMAND_CONTEXT__===foreign,inProgress:e.s.durableCommandInProgress};
    assert.deepEqual(results.foreignInside,{out:false,kept:true,inProgress:false},'4: a context put in place from inside apply is kept');}
  results.previous=await failedThenNext(app.replace(CURRENT_RELEASE,PREVIOUS_RELEASE),{failRoutes:true});
  assert.equal(results.previous.contextLeft,true,'5: the previous release leaves the context set');assert.equal(results.previous.authorizedRefused,true,'5: and refuses authorized commands');
  console.log(JSON.stringify({suite:'build533-durable-context-release',ok:true,results}));
})().catch(error=>{console.error(error);process.exit(1);});
