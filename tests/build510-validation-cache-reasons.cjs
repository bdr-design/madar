'use strict';
// iPhone diagnostic DX-1792378248326: the first command after a day close re-checked all 30 fleet chunks in the save
// validation worker (2.3 s) and the diagnostic could not say why. The cache now records, with its existing counters,
// which part of its key moved (empty, epoch, chunk-mass, context, inspector) and, for each chunk checked again, whether
// its identity version, bounds or interned values changed. Proven here: the summary still equals summarizeReference, and
// each kind of change reports its own reason; the main-thread client copies the reason into its stats.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
global.window=global;require(path.join(ROOT,'WebApp/transaction-core.js'));
const STORE=require(path.join(ROOT,'WebApp/fleet-store-core.js'));require(path.join(ROOT,'WebApp/fleet-event-core.js'));
const FLEET=require(path.join(ROOT,'WebApp/fleet-access-core.js')),CORE=require(path.join(ROOT,'WebApp/fleet-save-validation-core.js'));
const {fleet}=require(path.join(ROOT,'tests/helpers/fleet-fixture.js'));
const CHUNK=STORE.CHUNK_ROWS,template=fleet(),ordinary=template.filter(a=>['A1','S1','R1'].includes(a.routeId)&&!a.salePending&&a.phase);
const assets=template.slice();for(let i=0;assets.length<CHUNK+300;i++){const a=structuredClone(ordinary[i%ordinary.length]);a.id=`CR-${String(i).padStart(7,'0')}`;a.name=`GH CR ${i}`;assets.push(a);}
const state={simSeconds:1000,fleet:STORE.fromAssets(assets,{at:0})},store=state.fleet;
let params={routeIds:['R1','R2','A1','S1','TINY','ZERO'],routes:[['R1','road','road',null],['A1','air','air',null],['S1','sea','sea',null]],registryCompanies:['air','sea','road'],definitionCompanies:['air','sea','road'],legacyAssetOwners:{air:'air',sea:'sea',road:'road'}};
const run=label=>{const value=CORE.summarize(state,FLEET,params);assert.deepEqual(value,CORE.summarizeReference(state,FLEET,params),`${label}: equal to the reference`);const s=CORE.staticStats();return {reset:s.lastReset,miss:s.lastMiss,checked:s.lastChecked,reused:s.lastReused};};
const cold=run('cold');assert.equal(cold.reset,'empty');assert.equal(cold.miss.new,cold.checked);
const warm=run('warm');assert.equal(warm.reset,'');assert.equal(warm.checked,0);
// An identity write in chunk 0 only: that chunk reports 'version', the other is reused.
const index=FLEET.indexOf(state,'CR-0000010');STORE.set(store,index,'name','Renamed CR');
const renamed=run('renamed');assert.equal(renamed.reset,'');assert.equal(renamed.miss.version,1);assert.equal(renamed.checked,1);
// A context change (new route list) resets the cache with 'context'.
params={...params,routeIds:[...params.routeIds,'NEW']};const context=run('context');assert.equal(context.reset,'context');
const thread=fs.readFileSync(path.join(ROOT,'WebApp/fleet-engine-thread.js'),'utf8');
assert.match(thread,/stats\.lastSaveValidationReset=String\(message\.validation\.lastReset\|\|''\)/,'the client keeps the reason in its stats');
// The client times a durable command's save validation (iPhone: a command waited 1.65 s for a 434 ms pass): its round
// trip, the time beyond the worker's pass and what was ahead of it, and a step discarded while the worker still runs it.
// The worker runs in this realm behind a FIFO inbox, so a message waits until it is pumped, as on the device.
(async()=>{let queueEvidence=null;
{
  require(path.join(ROOT,'WebApp/simulation-asset-core.js'));require(path.join(ROOT,'WebApp/fleet-query-core.js'));globalThis.GH_FLEET_STORE=STORE;
  const THREAD=require(path.join(ROOT,'WebApp/fleet-engine-thread.js')),FIX=require(path.join(ROOT,'tests/helpers/fleet-fixture.js'));
  const src=fs.readFileSync(path.join(ROOT,'WebApp/fleet-engine-worker.js'),'utf8'),inbox=[],outbox=[];let listener=null,now=0;
  const self={GH_FLEET_STORE:STORE,GH_FLEET_EVENTS:globalThis.GH_FLEET_EVENTS,GH_FLEET_QUERY:globalThis.GH_FLEET_QUERY,GH_FLEET_DATA:FLEET,GH_FLEET_SAVE_VALIDATION:CORE,addEventListener:(type,fn)=>{if(type==='message')listener=fn;},postMessage:message=>outbox.push(structuredClone(message))};
  new Function('self','importScripts',src)(self,()=>{});
  const worker={postMessage:(message,transfer)=>inbox.push(structuredClone(message,{transfer:transfer||[]})),terminate(){}};
  const client=THREAD.create({workerFactory:()=>worker,resolveRoute:FIX.resolveRoute,catalogSpecs:()=>({}),timeoutMs:60000,clock:()=>now});
  const pump=()=>{while(inbox.length)listener({data:inbox.shift()});},flush=()=>{while(outbox.length)worker.onmessage({data:outbox.shift()});},deliver=()=>{pump();flush();};
  const live=STORE.fromAssets(FIX.fleet()),validate=()=>client.query(live,{name:'saveValidation',params});
  // Idle: nothing is ahead and the round trip is the pass alone.
  // A step discarded before it was posted (the replica was still being built) is not counted as running on the worker.
  const early=client.request(live,{from:0,to:0,context:FIX.context?.()||{},contextKey:'k',order:'events'});assert.ok(early&&early.deferred,'the first step waits for the replica');
  client.discard(early);assert.equal(client.stats().stepsDraining,0,'a step never posted does not drain');deliver();
  // The first step also builds the replica in timer slices: it is answered before the measured part begins.
  const ticket0=client.request(live,{from:0,to:0,context:FIX.context?.()||{},contextKey:'k',order:'events'});for(let i=0;i<500&&ticket0.status==='pending';i++){deliver();await new Promise(r=>setTimeout(r,0));}
  assert.equal(ticket0.status,'ready','the first step is answered');client.discard(ticket0);deliver();assert.equal(client.stats().discardedSteps||0,0,'an answered step does not drain');
  now=1000;const idle=validate();assert.ok(idle,'the validation is posted');now=1040;deliver();const idleAnswer=await idle;assert.ok(idleAnswer&&client.current(idleAnswer,live),'an idle validation is answered and current');
  const s0=client.stats();assert.equal(JSON.stringify(s0.lastSaveValidationAhead),JSON.stringify({steps:0,open:'',queries:0,names:[],classes:0,health:0,dispatch:0}),'nothing ahead when idle');
  const row0=s0.saveValidationLog[0];assert.equal(row0.durable,false,'outside a command');assert.ok(row0.miss&&['version','bounds','refs','new'].every(key=>Number.isFinite(row0.miss[key])),'the log row keeps why chunks were checked again');assert.equal(s0.lastSaveValidationRoundTripMs,40);
  // A step discarded while it still runs on the worker (the command's cancelled slice) is ahead of the validation.
  // A step applied into the caller's transaction and still open: the worker has finished it, so nothing runs ahead.
  const appliedTicket=client.request(live,{from:0,to:0,context:FIX.context?.()||{},contextKey:'k',order:'events'});deliver();let undo=null,commit=null;
  assert.ok(client.apply(appliedTicket,live,{contextKey:'k',tx:{registerUndo:(u,c)=>{undo=u;commit=c;}}}),'the step is applied into the transaction');
  now=1500;const overOpen=validate();assert.ok(overOpen,'a validation is admitted over the applied open step');deliver();assert.ok(await overOpen);
  assert.equal(JSON.stringify(client.stats().lastSaveValidationAhead),JSON.stringify({steps:0,open:'step',queries:0,names:[],classes:0,health:0,dispatch:0}),'an applied step is open, not running');commit();deliver();
  // Another query posted before the validation is named ahead of it, inside a durable command.
  const other=client.query(live,{name:'conditionSum',params:{}});globalThis.__GH_DURABLE_COMMAND_CONTEXT__={liveState:{}};const named=validate();delete globalThis.__GH_DURABLE_COMMAND_CONTEXT__;deliver();await other;await named;
  const sNamed=client.stats();assert.equal(sNamed.lastSaveValidationAhead.queries,1);assert.deepEqual([...sNamed.lastSaveValidationAhead.names],['conditionSum'],'the query ahead is named');assert.equal(sNamed.saveValidationLog[0].durable,true,'the validation is marked as a command\'s');
  sNamed.lastSaveValidationAhead.names.push('x');sNamed.lastSaveValidationMiss.version=-1;assert.deepEqual([...client.stats().lastSaveValidationAhead.names],['conditionSum'],'a copy');assert.notEqual(client.stats().lastSaveValidationMiss.version,-1,'a copy');
  const ticket=client.request(live,{from:0,to:0,context:FIX.context?.()||{},contextKey:'k',order:'events'});assert.ok(ticket,'the thread takes the step');
  const budgetBefore=client.budgetTime(),workerBefore={max:client.stats().maxWorkerMs,last:client.stats().lastWorkerMs,total:client.stats().totalWorkerMs};
  client.discard(ticket);assert.equal(client.busy,false,'the caller sees the thread idle at once');assert.equal(client.stats().stepsDraining,1,'the worker still runs the discarded step');
  now=2000;const queued=validate();assert.ok(queued,'the validation is posted behind it');now=2700;deliver();const answer=await queued;
  assert.ok(answer&&client.current(answer,live),'the validation is answered on the store and current');
  const s1=client.stats();assert.equal(s1.stepsDraining,0,'the discarded step drained');assert.equal(s1.discardedSteps,1);assert.ok(Number.isFinite(s1.lastDiscardedWorkerMs));
  assert.equal(JSON.stringify(s1.lastSaveValidationAhead),JSON.stringify({steps:1,open:'',queries:0,names:[],classes:0,health:0,dispatch:0}),'the discarded step was ahead');
  assert.deepEqual({max:s1.maxWorkerMs,last:s1.lastWorkerMs,total:s1.totalWorkerMs-s1.lastSaveValidationWorkerMs,budget:client.budgetTime()},{...workerBefore,budget:budgetBefore},'a discarded step\'s result changes no step timing nor the next budget');
  // A window step rolled back while the worker runs it drains the same way.
  const session=client.beginWindow(live,{from:0,target:60});const leg=session&&client.requestWindow(session,live,{from:0,to:60,context:FIX.context?.()||{},contextKey:'k',order:'events'});
  assert.ok(leg&&leg.status==='pending'&&!leg.deferredWindow,'the window step is posted');client.settleWindow(session,'rollback');assert.equal(client.stats().stepsDraining,1,'the rolled-back window step drains');
  deliver();assert.equal(client.stats().stepsDraining,0);assert.equal(client.stats().discardedSteps,2,'and is counted when it ends');
  assert.equal(s1.lastSaveValidationRoundTripMs,700);assert.equal(s1.lastSaveValidationQueueMs,Math.max(0,700-s1.lastSaveValidationWorkerMs));
  // The log keeps the last 16 validations and its copy cannot change the client.
  for(let i=0;i<20;i++){const q=validate();deliver();await q;}
  const s2=client.stats();assert.equal(s2.saveValidationLog.length,16,'the last 16 validations');s2.saveValidationLog.length=0;s2.saveValidationLog.push({});assert.equal(client.stats().saveValidationLog.length,16,'a copy');
  // A worker that ends while a step drains leaves nothing behind.
  const t2=client.request(live,{from:0,to:0,context:FIX.context?.()||{},contextKey:'k',order:'events'});client.discard(t2);assert.equal(client.stats().stepsDraining,1);client.terminate('qa');assert.equal(client.stats().stepsDraining,0);
  queueEvidence={idleRoundTripMs:s0.lastSaveValidationRoundTripMs,queuedRoundTripMs:s1.lastSaveValidationRoundTripMs,queueMs:s1.lastSaveValidationQueueMs,discardedSteps:s1.discardedSteps};
}
console.log(JSON.stringify({suite:'build510-validation-cache-reasons',ok:true,cold,warm,renamed,context,queueEvidence}));
})().catch(error=>{console.error(error);process.exitCode=1;});
