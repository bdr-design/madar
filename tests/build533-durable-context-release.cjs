'use strict';
// An independent review found that runDurableStateCommand released its __GH_DURABLE_COMMAND_CONTEXT__ only when the
// context's draft was the command's draft. The context is set with draft:null before the clone and replaced with the
// draft after inheritVerified and routeRuntimeForState; a throw in either left {draft:null} set after the command had
// rolled back, so transaction-core refused every authorized command ('durable-command-context-in-progress') and sliced
// saves stopped until another durable command replaced it. The command now releases the context it set, by identity.
// Proven with the real app command (extracted as build334-durable-publication-recovery does) and the real persistence,
// schema, integrity and transaction owners:
//  1. a throw in routeRuntimeForState, and 2. in inheritVerified: the command returns false, the live state and the
//     stored snapshot are unchanged, no context is left, persistence is not locked, an authorized command is admitted,
//     and the next durable command commits exactly once (one revision, its change only);
//  3. a successful command still releases its context and commits once;
//  4. the previous source (ed364e2) leaves the context set after case 1.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{execFileSync}=require('node:child_process');
const {ROOT}=require('./helpers/core-harness'),{scenario}=require('./helpers/business-scenario');
function environment(app,{failRoutes=false,failInherit=false}={}){
  const start=app.indexOf('  let durableCommandSettlement='),end=app.indexOf('  function authorizationIdempotencyKey',start);assert(start>=0&&end>start,'durable command source');
  const stagedStart=app.indexOf('  function stagedStateBusy('),stagedEnd=app.indexOf('  function scheduleSimulationPersistence(',stagedStart);assert(stagedStart>=0&&stagedEnd>stagedStart,'staged source');
  const traceStart=app.indexOf('  const appMetricClock='),traceEnd=app.indexOf('  function recordRenderMetric(',traceStart);assert(traceStart>=0&&traceEnd>traceStart,'trace source');
  const e=scenario();e.load('persistence-core');const key='audit-durable-context',events=[];assert.equal(e.s.GH_PERSISTENCE.commitState(e.state,{storageKey:key}).ok,true);
  let routeCalls=0;
  if(failInherit){const schema=e.s.GH_SAVE_SCHEMA;let thrown=false;e.s.GH_SAVE_SCHEMA={...schema,inheritVerified(...args){if(!thrown){thrown=true;throw new Error('qa-inherit-failure');}return schema.inheritVerified?.(...args);}};}
  Object.assign(e.s,{state:e.state,document:{hidden:false},hardResetInProgress:false,durableCommandInProgress:false,storageKey:key,APP_VERSION:'3.0.0',clone:structuredClone,
    routeRuntimeForState:()=>{if(failRoutes&&routeCalls++===0)throw new Error('qa-route-runtime-failure');return {};},
    replaceLiveState:draft=>e.s.GH_TRANSACTION_CORE.restoreObject(e.state,draft),diag:(type,detail)=>events.push({type,detail}),notice:()=>{},yieldForInteractivePaint:()=>Promise.resolve(),
    fleetStepSettled:()=>Promise.resolve(),simulationEngine:{cancelAdvance:()=>{}},console:{...console,warn:()=>{},error:()=>{}}});
  vm.runInContext(app.slice(traceStart,traceEnd),e.s);vm.runInContext(app.slice(stagedStart,stagedEnd),e.s);vm.runInContext(app.slice(start,end),e.s);
  return {...e,key,events};
}
async function failedThenNext(app,options){
  const e=environment(app,options),before=JSON.stringify(e.state),stored=e.storage.getItem(e.key),revision=e.state.saveRevision;
  const failed=await e.s.runDurableStateCommand('qa-prepare-failure',({state})=>{state.profile.name='Must not publish';return true;},{silent:true});
  const after={failed,stateUnchanged:JSON.stringify(e.state)===before,storedUnchanged:e.storage.getItem(e.key)===stored,contextLeft:e.s.__GH_DURABLE_COMMAND_CONTEXT__!==undefined,locked:e.s.GH_PERSISTENCE.isLocked()};
  // transaction-core admits an authorized command only with no durable command context (it is not run to the end here).
  let admission='admitted';try{await e.s.GH_TRANSACTION_CORE.executeDurable(e.state,{label:'qa-admission',apply:()=>{throw new Error('qa-admission-probe');}});}catch(error){admission=String(error.message||error);}
  after.authorizedRefused=admission==='durable-command-context-in-progress';
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
  assert.equal(out.authorizedRefused,false,`${label}: an authorized command is admitted`);
  assert.equal(out.next,true,`${label}: the next durable command commits`);assert.equal(out.nextRevision,1,`${label}: exactly one revision`);assert.equal(out.storedRevision,1,`${label}: exactly one stored revision`);
  assert.equal(out.name,'Saved once');assert.equal(out.storedName,'Saved once');assert.equal(out.contextAfterNext,false,`${label}: the next command releases its context`);
}
(async()=>{
  const app=fs.readFileSync(path.join(ROOT,'WebApp/app.js'),'utf8'),results={};
  results.routes=await failedThenNext(app,{failRoutes:true});settledFailure('1: routeRuntimeForState throws',results.routes);
  results.inherit=await failedThenNext(app,{failInherit:true});settledFailure('2: inheritVerified throws',results.inherit);
  {const e=environment(app),revision=e.state.saveRevision;const out=await e.s.runDurableStateCommand('qa-success',({state})=>{state.profile.name='Committed';return true;},{silent:true});
    results.success={out,contextLeft:e.s.__GH_DURABLE_COMMAND_CONTEXT__!==undefined,revision:e.state.saveRevision-revision,stored:JSON.parse(e.storage.getItem(e.key)).saveRevision-revision};
    assert.deepEqual(results.success,{out:true,contextLeft:false,revision:1,stored:1},'3: a successful command releases its context and commits once');}
  const git=process.env.GH_DURABLE_CONTEXT_GIT_DIR||path.resolve(ROOT),previous=execFileSync('git',['-C',git,'show','ed364e2:WebApp/app.js'],{encoding:'utf8',maxBuffer:64*1024*1024});
  results.previous=await failedThenNext(previous,{failRoutes:true});
  assert.equal(results.previous.contextLeft,true,'4: the previous source leaves the context set');assert.equal(results.previous.authorizedRefused,true,'4: and refuses authorized commands');
  console.log(JSON.stringify({suite:'build533-durable-context-release',ok:true,results}));
})().catch(error=>{console.error(error);process.exit(1);});
