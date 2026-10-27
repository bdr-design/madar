'use strict';
// iPhone diagnostic (build 95): the fleet summary that a page reads (uiSummary) was asked again for every fleet revision
// that moved while its previous query was still on the worker, so whole-fleet passes queued behind each other on the
// worker's queue, ahead of the save validation. app.js now keeps one query per request key in flight: a newer entry
// waits on it, and when it answers, the entry it no longer fits asks once for the current revision. The real summary
// section of app.js runs in a VM (as build439 runs it) against the same section of the source before this change, read
// from git, with the worker's answers and the host's turns controlled here:
//  1. ten revision moves while a query is in flight post no further query (the previous source posted ten more);
//  2. when the stale answer comes, exactly one query is posted for the current revision, and its answer is the page's
//     summary, current, as the previous source's last answer is; the page is asked to refresh once, as before;
//  3. a command waiting on the summary (requireFleetUiSummary) during that time gets the current summary, even with no
//     time left to poll (it waits on the query handed on, as it waited on its own);
//  4. a failed or null stale answer also hands on (one query for the current revision);
//  5. a replaced fleet asks at once (also while a query is carried, which then hands on nothing), a dynamic summary
//     hands on for the current time, the projection of another key's current summary still answers at once, and a
//     disabled worker asks nothing, as before;
//  6. a revision that does not move while in flight behaves as before (one query, its answer is current).
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{execFileSync}=require('node:child_process'),{harness}=require('./helpers/core-harness');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..'),PREVIOUS='87b678f';
const current=fs.readFileSync(path.join(ROOT,'WebApp/app.js'),'utf8');
const previous=execFileSync('git',['-C',process.env.GH_B584_GIT_DIR||ROOT,'show',`${PREVIOUS}:WebApp/app.js`],{encoding:'utf8',maxBuffer:1<<28});
function section(source){const start=source.indexOf('  const fleetUiSummaryCache=new Map();'),end=source.indexOf('  const summaryNumber=',start);assert(start>=0&&end>start,'the summary section');return source.slice(start,end);}
function environment(source){
  const {s:g}=harness(['fleet-ui-summary-core']),S=g.GH_FLEET_STORE,F=g.GH_FLEET_DATA,store=S.create(1);S.add(store,{id:'SUMMARY-1',type:'air',ownerCompanyId:'air',fuel:90});
  const state={fleet:store,simSeconds:10},queue=[],timers=[],posted=[];let now=0,primes=0,refreshes=0;
  const tag=(s,time)=>({store:s,revision:s.revision,valueRevision:S.valueRevision(s),simSeconds:time});
  const client={disabled:false,current(t,s){return t.store===s&&t.revision===s.revision&&t.valueRevision===S.valueRevision(s);},query(s,{name,params,simSeconds}){assert.equal(name,'uiSummary');posted.push({revision:s.revision,key:JSON.stringify(params)});return new Promise((resolve,reject)=>queue.push({resolve(value){if(value===null){resolve(null);return;}const t=tag(s,simSeconds);resolve({...t,result:{requestKey:JSON.stringify(params),asOfSimSeconds:simSeconds,legacy:false,all:{total:Number(s.length)||0},owners:[]}});},reject}));}};
  g.state=state;g.client=client;g.GH_FLEET_UI_SUMMARY={requestKey:JSON.stringify,lookup:r=>({total:r.all.total}),project:(result,_from,options)=>({...result,requestKey:JSON.stringify(options),projected:true})};g.GH_FLEET_DATA={...F,size:()=>3000};
  g.performance={now:()=>now};g.setTimeout=(fn,ms)=>{timers.push({fn,ms});return timers.length;};g.clearTimeout=()=>{};
  g.$=()=>({classList:{contains:()=>true}});g.openDrawer=()=>{refreshes++;};g.refreshAssetMarketSummary=()=>{refreshes++;};g.routeCenterLegacyOwnerMap=()=>({air:'air'});g.primeFleetThreadAfterCommand=()=>primes++;
  vm.runInContext(`let fleetEngineThreadClient=client;let activeDrawerPanel='conference',activeDrawerArg;const FLEET_THREAD_EARLY_ROWS=256;${section(source)};globalThis.api={read:fleetUiSummary,current:currentFleetUiSummary,require:requireFleetUiSummary,cache:fleetUiSummaryCache};`,g);
  const move=n=>{for(let i=0;i<n;i++){S.set(state.fleet,0,'fuel',80-i);}};
  const runTimers=ms=>{const due=timers.filter(t=>t.ms===ms);timers.splice(0,timers.length,...timers.filter(t=>t.ms!==ms));for(const t of due)t.fn();return due.length;};
  return {g,S,state,client,queue,timers,posted,api:g.api,move,runTimers,advance:()=>{now+=100;},get primes(){return primes;},get refreshes(){return refreshes;}};
}
async function flush(){for(let n=0;n<12;n++)await Promise.resolve();}
const out=[];
async function run(label,source){
  const r={};
  // 1, 2.
  {
    const e=environment(source);assert.equal(e.api.read(),null);const r0=e.state.fleet.revision;
    for(let i=0;i<10;i++){e.move(1);assert.notEqual(e.state.fleet.revision,r0);assert.equal(e.api.read(),null);}
    r.postedWhileInFlight=e.posted.length-1;
    let answered=0;while(e.queue.length){e.queue.shift().resolve();answered++;await flush();}
    const page=e.api.read();r.totalPosted=e.posted.length;r.lastPostRevision=e.posted.at(-1).revision;r.pageTotal=page?.lookup?.total;r.pageCurrent=!!page&&!!e.api.current()?.current(e.state);r.refreshTimers=e.timers.filter(t=>t.ms===0).length;r.answered=answered;r.revision=e.state.fleet.revision;
  }
  // 3.
  {
    const e=environment(source);e.api.read();for(let i=0;i<5;i++){e.move(1);e.api.read();}const waiting=e.api.require([],{timeoutMs:20000});
    for(let turn=0;turn<20&&e.queue.length;turn++){e.queue.shift().resolve();await flush();e.advance();e.runTimers(50);await flush();}
    const got=await waiting;r.requireCurrent=!!got&&got.current(e.state);r.requirePosted=e.posted.length;
  }
  {
    const e=environment(source);e.api.read();e.move(2);e.api.read();const waiting=e.api.require([],{timeoutMs:0});
    for(let turn=0;turn<6&&e.queue.length;turn++){e.queue.shift().resolve();await flush();}
    const got=await Promise.race([waiting,flush().then(()=>'pending')]);r.requireNoTimeCurrent=got!=='pending'&&!!got&&got.current(e.state);
  }
  // 4.
  for(const fail of ['reject','null']){
    const e=environment(source);e.api.read();e.move(2);e.api.read();const before=e.posted.length,first=e.queue.shift();if(fail==='reject')first.reject(Error('injected-worker-failure'));else first.resolve(null);await flush();
    r[`${fail}HandsOn`]=e.posted.length-before;r[`${fail}LastRevision`]=e.posted.at(-1).revision===e.state.fleet.revision;
    while(e.queue.length){e.queue.shift().resolve();await flush();}r[`${fail}Current`]=!!e.api.current()?.current(e.state);
  }
  // 5.
  {
    const e=environment(source);e.api.read();e.state.fleet=e.g.structuredClone(e.state.fleet);e.api.read();r.replacedPosted=e.posted.length;
    const c=environment(source);c.api.read();c.move(1);c.api.read();c.state.fleet=c.g.structuredClone(c.state.fleet);c.api.read();const asked=c.posted.length;while(c.queue.length){c.queue.shift().resolve();await flush();}r.replacedCarriedPosted=[asked,c.posted.length];r.replacedCarriedCurrent=!!c.api.current()?.current(c.state);
    const y=environment(source);y.api.read([],{dynamic:true});y.move(1);y.state.simSeconds+=5;y.api.read([],{dynamic:true});while(y.queue.length){y.queue.shift().resolve();await flush();}const dyn=y.api.current([],{dynamic:true});r.dynamicPosted=y.posted.length;r.dynamicCurrent=!!dyn?.current(y.state)&&Number(dyn.result.asOfSimSeconds)===y.state.simSeconds;
    // The facility key's query is in flight when the revision moves; the default key is asked at the new revision and
    // answers first. The facility key is then projected from it at once (the previous source, which had posted the
    // facility key again, waited for that query instead).
    const p=environment(source),f=[{id:'AP-1',city:'A',kind:'airport-base'}];p.api.read(f);p.move(1);p.api.read();p.api.read(f);
    r.projectionPosted=p.posted.length;p.queue.splice(1,1)[0].resolve();await flush();
    const projected=p.api.read(f);r.projected=!!projected?.result?.projected&&projected.result.requestKey===JSON.stringify({legacyOwner:{air:'air'},facilities:[{id:'AP-1',city:'A',mode:'air'}]});
    const d=environment(source);d.client.disabled=true;assert.equal(await d.api.require([],{timeoutMs:0}),null);r.disabledPosted=d.posted.length;
  }
  // 6.
  {
    const e=environment(source),waiting=e.api.require();e.queue.shift().resolve();const got=await waiting;r.steadyPosted=e.posted.length;r.steadyCurrent=!!got&&got.current(e.state);
  }
  out.push({label,...r});return r;
}
(async()=>{
  const before=await run('previous',previous),after=await run('current',current);
  // 1.
  assert.equal(before.postedWhileInFlight,10,'the previous source posts a query for every revision that moved while one was in flight');
  assert.equal(after.postedWhileInFlight,0,'1: no query is posted while this key\'s query is in flight');
  // 2.
  assert.equal(after.totalPosted,2,'2: the stale answer hands on exactly one query');
  assert.equal(after.lastPostRevision,after.revision,'2: for the current revision');
  assert.equal(before.lastPostRevision,before.revision);
  assert.equal(after.pageCurrent,true,'2: its answer is the page\'s summary, current');assert.equal(before.pageCurrent,true);
  assert.equal(after.pageTotal,before.pageTotal,'2: the same summary as the previous source\'s last answer');
  assert.equal(after.refreshTimers,1,'2: the page is asked to refresh once');assert.equal(before.refreshTimers,1);
  // 3.
  assert.equal(after.requireCurrent,true,'3: a waiting command gets the current summary');assert.equal(before.requireCurrent,true);
  assert.equal(after.requireNoTimeCurrent,true,'3: with no time left to poll, it waits on the query handed on and gets the current summary');
  assert.ok(after.requirePosted<before.requirePosted,`3: with fewer whole-fleet queries (${after.requirePosted}, previously ${before.requirePosted})`);
  // 4.
  for(const fail of ['reject','null']){assert.equal(after[`${fail}HandsOn`],1,`4: a ${fail} stale answer hands on one query`);assert.equal(after[`${fail}LastRevision`],true);assert.equal(after[`${fail}Current`],true,`4: ${fail}: the page ends current`);}
  // 5.
  assert.equal(after.replacedPosted,2,'5: a replaced fleet asks at once');assert.equal(before.replacedPosted,2);
  assert.deepEqual(after.replacedCarriedPosted,[2,2],'5: a fleet replaced while a query is carried asks at once; the stale answer hands on nothing');assert.equal(after.replacedCarriedCurrent,true);assert.equal(before.replacedCarriedCurrent,true);
  assert.equal(after.dynamicPosted,2,'5: a dynamic summary carried across a move hands on one query');assert.equal(after.dynamicCurrent,true,'5: for the current time');assert.equal(before.dynamicCurrent,true);
  assert.equal(after.projected,true,'5: another key\'s current summary is projected at once, with its own query in flight');assert.equal(after.projectionPosted,2);assert.equal(before.projectionPosted,3);
  assert.equal(after.disabledPosted,0);assert.equal(before.disabledPosted,0);
  // 6.
  assert.equal(after.steadyPosted,1);assert.equal(after.steadyCurrent,true);assert.deepEqual([before.steadyPosted,before.steadyCurrent],[1,true]);
  console.log(JSON.stringify({suite:'build584-summary-one-in-flight',ok:true,results:out}));
})().catch(error=>{console.error(error);process.exitCode=1;});
