'use strict';
// Execute the actual app summary boundary in an isolated VM. Queued worker replies and host turns are controlled here,
// never in the product. Related browser gates exercise the same API with the real fleet worker and conference UI.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{harness}=require('./helpers/core-harness');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(ROOT,'WebApp/app.js'),'utf8');
const start=source.indexOf('  const fleetUiSummaryCache=new Map();'),end=source.indexOf('  const summaryNumber=',start);assert(start>=0&&end>start);
function environment(){
 const {s:g}=harness(['fleet-ui-summary-core']),S=g.GH_FLEET_STORE,F=g.GH_FLEET_DATA,store=S.create(1);S.add(store,{id:'SUMMARY-1',type:'air',ownerCompanyId:'air',fuel:90});
 const state={fleet:store,simSeconds:10},queue=[],timers=[];let now=0,queries=0,primes=0;
 const tag=(s,time)=>({store:s,revision:s.revision,valueRevision:S.valueRevision(s),simSeconds:time});
 const client={disabled:false,current(t,s){return t.store===s&&t.revision===s.revision&&t.valueRevision===S.valueRevision(s);},query(s,{name,params,simSeconds}){assert.equal(name,'uiSummary');queries++;const t=tag(s,simSeconds);return new Promise((resolve,reject)=>queue.push({resolve(value){if(value===null){resolve(null);return;}resolve({...t,result:{requestKey:JSON.stringify(params),asOfSimSeconds:simSeconds,legacy:false,all:{total:1},owners:[]}});},reject}));}};
 g.state=state;g.client=client;g.GH_FLEET_UI_SUMMARY={requestKey:JSON.stringify,lookup:r=>({total:r.all.total})};g.GH_FLEET_DATA={...F,size:()=>3000};g.performance={now:()=>now};g.setTimeout=(fn,ms)=>{timers.push({fn,ms});return timers.length;};g.clearTimeout=()=>{};
 g.$=()=>({classList:{contains:()=>false}});g.openDrawer=()=>{};g.routeCenterLegacyOwnerMap=()=>({air:'air'});g.primeFleetThreadAfterCommand=()=>primes++;
 vm.runInContext(`let fleetEngineThreadClient=client;let activeDrawerPanel='conference',activeDrawerArg;const FLEET_THREAD_EARLY_ROWS=256;${source.slice(start,end)};globalThis.api={read:fleetUiSummary,current:currentFleetUiSummary,require:requireFleetUiSummary,cache:fleetUiSummaryCache};`,g);
 return {g,S,state,client,queue,timers,api:g.api,get queries(){return queries;},get primes(){return primes;},advanceClock:()=>{now+=100;}};
}
async function flush(){for(let n=0;n<8;n++)await Promise.resolve();}
(async()=>{
 const out=[];
 {
  const e=environment();assert.equal(e.api.read(),null);const first=e.api.require(),second=e.api.require();assert.equal(e.queries,1,'a render and two consumers must share one pending whole-fleet query');e.queue.shift().resolve();const [a,b]=await Promise.all([first,second]);assert(a.current(e.state));assert(b.current(e.state));assert.equal(a.result,b.result);assert.equal(e.api.read().result,a.result);assert.equal(e.queries,1);assert.equal(e.timers.filter(t=>t.ms===50).length,0,'a successful shared reply needs no polling delay');
  const draft={...e.state};assert.equal(a.current(draft),false);e.g.__GH_DURABLE_COMMAND_CONTEXT__={liveState:e.state,draft};assert(a.current(draft));draft.fleet=e.S.create();assert.equal(a.current(draft),false);
  out.push({case:'shared-render-and-consumers',queries:e.queries,pollWaits:0});
 }
 {
  const e=environment(),waiting=e.api.require([],{timeoutMs:0});e.S.set(e.state.fleet,0,'fuel',80);e.queue.shift().resolve();assert.equal(await waiting,null,'an answer for a changed fleet cannot authorize a command');assert.equal(e.api.read(),null);assert.equal(e.queries,2);e.queue.shift().resolve();await flush();assert(e.api.current().current(e.state));out.push({case:'stale-row-then-retry',queries:e.queries});
 }
 {
  const e=environment(),old=e.api.require([{id:'OLD-DESCRIPTOR',city:'Old city',kind:'airport-base'}],{timeoutMs:0}),oldStore=e.state.fleet;e.state.fleet=e.g.structuredClone(oldStore);e.api.read();assert.equal(e.api.cache.size,1,'replacing the fleet drops other strong references to historical summary stores');assert.equal(e.queries,2);e.queue.shift().resolve();assert.equal(await old,null);e.queue.shift().resolve();await flush();assert(e.api.current().current(e.state));assert.equal(e.api.cache.size,1);out.push({case:'store-replacement',retainedEntries:1});
 }
 {
  const e=environment(),f=[{id:'AP-1',city:'A',kind:'airport-base'}],other=[{id:'AP-2',city:'B',kind:'airport-base'}],a=e.api.require(f),b=e.api.require(other);assert.equal(e.queries,2,'different facility descriptors remain independent');e.queue.shift().resolve();e.queue.shift().resolve();const [x,y]=await Promise.all([a,b]);assert.notEqual(x.result.requestKey,y.result.requestKey);assert(x.current(e.state)&&y.current(e.state));out.push({case:'descriptor-isolation',queries:2});
 }
 {
  const e=environment(),a=e.api.require([],{dynamic:true,timeoutMs:0});e.state.simSeconds++;e.queue.shift().resolve();assert.equal(await a,null,'dynamic results cannot be consumed for a different simulation time');const b=e.api.require([],{dynamic:true,timeoutMs:0});assert.equal(e.queries,2);e.queue.shift().resolve();assert((await b).current(e.state));out.push({case:'dynamic-time',queries:2});
 }
 {
  const e=environment();e.api.read([],{dynamic:true});e.state.simSeconds++;const a=e.api.require([],{dynamic:true,timeoutMs:0});assert.equal(e.queries,1);e.queue.shift().resolve();assert.equal(await a,null,'joining an older pending timestamp must not label that dynamic result current');out.push({case:'pending-older-time',failedClosed:true});
 }
 {
  const e=environment(),pending=e.api.require();e.queue.shift().resolve();await pending;const ready=e.api.current(),revision=e.state.fleet.revision,ref=e.S.views(e.state.fleet).u32[e.S.O.profile];e.S.applyValueChanges(e.state.fleet,{length:e.state.fleet.values.length,changes:[[ref,{...e.state.fleet.values[ref],model:'changed-profile'}]]});assert.equal(e.state.fleet.revision,revision);assert.equal(ready.current(e.state),false,'a cached summary proof must expire on value-only writes as well as row writes');out.push({case:'cached-value-only-change',failedClosed:true});
 }
 for(const fail of ['reject','null','legacy','key']){
  const e=environment(),a=e.api.require([],{timeoutMs:0}),item=e.queue.shift();if(fail==='reject')item.reject(Error('injected-worker-failure'));else if(fail==='null')item.resolve(null);
  if(fail==='legacy'||fail==='key'){const original=e.client.current;e.client.current=(found,s)=>{if(fail==='legacy')found.result.legacy=true;else found.result.requestKey='wrong';return original(found,s);};item.resolve();}
  assert.equal(await a,null);assert.equal(e.api.cache.values().next().value.found,null);out.push({case:fail,failedClosed:true});
 }
 {
  const e=environment();e.client.disabled=true;assert.equal(await e.api.require([],{timeoutMs:0}),null);assert.equal(e.queries,0);out.push({case:'disabled',queries:0});
 }
 console.log(JSON.stringify({suite:'build439-summary-single-request',passed:out.length,results:out}));
})().catch(e=>{console.error(e);process.exitCode=1;});
