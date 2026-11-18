'use strict';
// Heaviness batch A2 (iPhone diagnostic DX-1794605111560: after every cancelled slice the save validation re-checked 15
// of 23 fleet chunks, 85-95 ms of worker time per player command; the owner: «نفذ الحل ... على دفعات بدقه واختبارات صارمه»).
// A rolled-back journal restores each row's preimage; it now moves a chunk's static, identity and routed versions only
// where they moved inside the journal, or where a staged writer (the thread's step replay, the dispatch apply) wrote rows
// and had not yet moved their tiers. The thread tells the worker's replica which chunks' tiers to move: every tier of a
// chunk any writer other than a rollback wrote since the last drain, and in a chunk only a rollback restored, the tiers
// the store moved. Proven here with the real store, validation core, thread client and worker (same realm, FIFO inbox):
//  S. store: an engine-only rollback keeps the static proof and identity evidence; a real identity or route write inside
//     the journal still expires a cache built inside it; appended rows, rollback twice, two journals in a row; a staged
//     writer cancelled before its tier move still moves the tiers (refRowTables and identity evidence never stale);
//  T. thread and worker: an identity write re-checks exactly its chunk; a cancelled real engine step (staged replay in
//     rows slices) re-checks exactly the chunks whose identity moved (the fixture's faulted row re-faults each step), not
//     every restored chunk; a fault written inside an open journal is seen and
//     goes with the rollback; a step cancelled in the middle of its replay; a staged write spanning two chunks; a split dispatch apply with a sync between its rows and its tier move is never stale; the
//     replica stays byte-equal and its tiers move wherever the store's did; a rolled-back purchase leaves no profile
//     groups behind on the replica;
//  every validation deep-equals summarizeReference. Counts, not milliseconds.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
global.window=global;require(path.join(ROOT,'WebApp/transaction-core.js'));
const STORE=require(path.join(ROOT,'WebApp/fleet-store-core.js'));require(path.join(ROOT,'WebApp/fleet-event-core.js'));
const FLEET=require(path.join(ROOT,'WebApp/fleet-access-core.js')),CORE=require(path.join(ROOT,'WebApp/fleet-save-validation-core.js'));
require(path.join(ROOT,'WebApp/simulation-asset-core.js'));require(path.join(ROOT,'WebApp/fleet-query-core.js'));globalThis.GH_FLEET_STORE=STORE;
const THREAD=require(path.join(ROOT,'WebApp/fleet-engine-thread.js')),FIX=require(path.join(ROOT,'tests/helpers/fleet-fixture.js'));
const C=STORE.CHUNK_ROWS,template=FIX.fleet(),ordinary=template.filter(a=>['A1','S1','R1'].includes(a.routeId)&&a.phase&&!a.simulationFault&&a.baseFacility!=='ELSEWHERE'&&!a.salePending);
function build(count,prefix,bad=-1){const assets=template.slice();for(let i=0;assets.length<count;i++){const a=structuredClone(ordinary[i%ordinary.length]);a.id=`${prefix}-${String(i).padStart(7,'0')}`;a.name=i===bad?'<bad 0>':`GH ${prefix} ${i}`;assets.push(a);}return assets;}
const params={routeIds:['R1','R2','A1','S1','TINY','ZERO'],routes:[['R1','road','road',null],['A1','air','air',null],['S1','sea','sea',null]],registryCompanies:['air','sea','road'],definitionCompanies:['air','sea','road'],legacyAssetOwners:{air:'air',sea:'sea',road:'road'}};
const results=[];

// S. Store tier.
{
  const assets=build(2*C+300,'ST',77),fresh=()=>({simSeconds:1000,fleet:STORE.fromAssets(assets,{at:0})});
  const same=(state,label)=>{const value=CORE.summarize(state,FLEET,params);assert.deepEqual(value,CORE.summarizeReference(state,FLEET,params),`${label}: equal to the reference`);return CORE.staticStats();};
  // S1. Engine-only writes in two chunks, rolled back: evidence and every static chunk kept; the engine and save caches
  // and the replica log still see the restore.
  {const state=fresh(),t=state.fleet;same(state,'S1 cold');const outer=STORE.identitySnapshot(t),tiers=STORE.staticSnapshot(t),chunkStamp=[...STORE.chunkStamp(t).versions];
   const journal=STORE.beginJournal(t);STORE.set(t,1,'condition',42);STORE.set(t,C+5,'fuel',50);STORE.set(t,C+6,'progress',.3);same(state,'S1 inside');STORE.rollbackJournal(journal);
   assert.equal(STORE.identityCurrent(t,outer),true,'S1: identity evidence from before the journal is kept');
   // (set() of an engine field moves the static tier inside the journal: a volatile write; identity and routed stay.)
   {const moved=STORE.staticChunksSince(t,tiers);assert.deepEqual(moved.identity,[],'S1: identity tier kept');assert.deepEqual(moved.routed,[],'S1: routed tier kept');}
   const after=same(state,'S1 after');assert.equal(after.lastReset,'');assert.equal(after.lastChecked,0,'S1: every static chunk reused');
   assert.ok(STORE.chunkStamp(t).versions[0]!==chunkStamp[0]&&STORE.chunkStamp(t).versions[1]!==chunkStamp[1],'S1: the engine and save versions move');assert.equal(STORE.replicaClean(t),false,'S1: the replica log has the restored rows');}
  // S2. An identity write interning no new value: a stamp and a cache built inside the journal both expire.
  {const state=fresh(),t=state.fleet;same(state,'S2 cold');const len=t.values.length,journal=STORE.beginJournal(t);STORE.set(t,C+9,'name','<bad 3>');assert.equal(t.values.length,len,'S2: no value interned');
   const inside=same(state,'S2 inside');assert.equal(inside.lastChecked,1);const inner=STORE.identitySnapshot(t),innerTiers=STORE.staticSnapshot(t);
   STORE.rollbackJournal(journal);assert.equal(STORE.identityCurrent(t,inner),false,'S2: a stamp taken inside expires');assert.deepEqual(STORE.staticChunksSince(t,innerTiers).identity,[1]);
   const after=same(state,'S2 after');assert.equal(after.lastChecked,1);assert.equal(after.lastMiss.version,1);}
  // S3. A fault with a new value inside the journal: seen inside, gone after, values restored.
  {const state=fresh(),t=state.fleet;same(state,'S3 cold');const len=t.values.length,journal=STORE.beginJournal(t);STORE.set(t,C+10,'name','<a fresh fault>');
   assert.ok(CORE.summarize(state,FLEET,params).errors.includes('display-text-assets-name'));same(state,'S3 inside');STORE.rollbackJournal(journal);assert.equal(t.values.length,len,'S3: values restored');same(state,'S3 after');}
  // S4. A route-tier write rolled back: static and routed move in its chunk, identity does not; validation reuses all.
  {const state=fresh(),t=state.fleet;same(state,'S4 cold');const journal=STORE.beginJournal(t);STORE.set(t,C+3,'routeId','S1');const inner=STORE.staticSnapshot(t);STORE.rollbackJournal(journal);
   assert.deepEqual(STORE.staticChunksSince(t,inner),{static:[1],identity:[],routed:[1]});assert.equal(same(state,'S4 after').lastChecked,0);}
  // S5. Appended rows rolled back: the appended chunk moves; equal to the reference.
  {const state=fresh(),t=state.fleet;same(state,'S5 cold');const before=STORE.staticSnapshot(t),length=t.length,journal=STORE.beginJournal(t);
   for(let i=0;i<5;i++)FLEET.add(state,{...FLEET.plain(state,FLEET.list(state)[3].id),id:`APP-${i}`,name:'<appended>'});same(state,'S5 inside');STORE.rollbackJournal(journal);
   assert.equal(t.length,length);assert.ok(STORE.staticChunksSince(t,before).identity.includes(2),'S5: the appended chunk moves');same(state,'S5 after');}
  // S6. Rollback twice, and a nested beginJournal returning the same journal.
  {const state=fresh(),t=state.fleet,journal=STORE.beginJournal(t);assert.equal(STORE.beginJournal(t),journal);STORE.set(t,1,'name','<x>');STORE.rollbackJournal(journal);
   const tiers=STORE.staticSnapshot(t),revision=t.revision,structure=t.structure;STORE.rollbackJournal(journal);assert.deepEqual(STORE.staticChunksSince(t,tiers),{static:[],identity:[],routed:[]});assert.equal(t.revision,revision);assert.equal(t.structure,structure);}
  // S7. Two engine-only journals in a row: every chunk reused after each.
  {const state=fresh(),t=state.fleet;same(state,'S7 cold');for(let k=0;k<2;k++){const journal=STORE.beginJournal(t);STORE.set(t,k*C+2,'progress',.3);STORE.rollbackJournal(journal);assert.equal(same(state,`S7 ${k}`).lastChecked,0,`S7: journal ${k} reuses every chunk`);}}
  // S8. A staged writer (rows first, tiers later) cancelled before its tier move: the route table and identity evidence
  // built in its yield never stay current; settled by a tier list, an engine-only rollback still keeps the evidence.
  {const rows=FIX.fleet(),store=STORE.fromAssets(rows,{at:0}),x=rows.findIndex(a=>a.routeId==='A1');
   const scratch=STORE.importReplica(STORE.exportReplica(store));STORE.set(scratch,x,'routeId','S1');STORE.set(scratch,x,'name','Renamed mid-slice');
   assert.equal(STORE.intern(store,'Renamed mid-slice'),STORE.intern(scratch,'Renamed mid-slice'));const image=STORE.readRows(scratch,Int32Array.of(x));
   const listed=()=>{const table=STORE.refRowTables(store,'routeId')[0],at=table.values.indexOf('S1');return at<0?false:[...table.rows[at]].includes(x);};
   const journal=STORE.beginJournal(store);STORE.writeRows(store,Int32Array.of(x),image.bytes,image.extras);assert.equal(listed(),true,'S8: the yield sees the staged row');
   const evidence=STORE.identitySnapshot(store);STORE.rollbackJournal(journal);
   assert.equal(listed(),false,'S8: the route table follows the rollback');assert.equal(STORE.identityCurrent(store,evidence),false,'S8: evidence from the yield expires');assert.equal(STORE.get(store,x,'routeId'),'A1');
   const kept=STORE.identitySnapshot(store),settled=STORE.beginJournal(store),engineOnly=STORE.readRows(store,Int32Array.of(x));new Float64Array(engineOnly.bytes)[0]=new Float64Array(engineOnly.bytes)[0];
   STORE.writeRows(store,Int32Array.of(x),engineOnly.bytes,engineOnly.extras);STORE.writeRows(store,new Int32Array(0),new ArrayBuffer(0),[],{staticRows:{static:[],identity:[],routed:[]}});STORE.rollbackJournal(settled);
   assert.equal(STORE.identityCurrent(store,kept),true,'S8: a settled staged write rolled back keeps the evidence');}
  // S9. A staged write spanning two chunks, cancelled before its tier move: both chunks' route rows follow the rollback.
  {const rows=build(C+400,'S9'),store=STORE.fromAssets(rows,{at:0}),x=rows.findIndex(a=>a.routeId==='A1'),y=C+rows.slice(C).findIndex(a=>a.routeId==='A1');assert.ok(x>=0&&x<C&&y>=C,'S9: rows in two chunks');
   const scratch=STORE.importReplica(STORE.exportReplica(store));for(const index of [x,y])STORE.set(scratch,index,'routeId','S1');const image=STORE.readRows(scratch,Int32Array.of(x,y));
   const listed=index=>{const table=STORE.refRowTables(store,'routeId')[index>>>STORE.CHUNK_SHIFT],at=table?table.values.indexOf('S1'):-1;return at<0?false:[...table.rows[at]].includes(index);};
   const journal=STORE.beginJournal(store);STORE.writeRows(store,Int32Array.of(x,y),image.bytes,image.extras);assert.ok(listed(x)&&listed(y),'S9: the yield sees both staged rows');STORE.rollbackJournal(journal);
   assert.equal(listed(x),false,'S9: chunk 0 follows the rollback');assert.equal(listed(y),false,'S9: chunk 1 follows the rollback');}
  // S10. A `true` write after a staged write settles only its own rows' chunks: with no rows, or a row in another
  // chunk, the staged chunk still follows the rollback (post-review: a `true` call used to clear every pending chunk).
  for(const settle of ['no rows','other chunk']){const rows=build(C+400,'S10'),store=STORE.fromAssets(rows,{at:0}),x=rows.findIndex(a=>a.routeId==='A1'),y=C+rows.slice(C).findIndex(a=>a.routeId==='A1');assert.ok(x>=0&&x<C&&y>=C,'S10: rows in two chunks');
   const scratch=STORE.importReplica(STORE.exportReplica(store));STORE.set(scratch,x,'routeId','S1');const image=STORE.readRows(scratch,Int32Array.of(x)),other=STORE.readRows(store,Int32Array.of(y));
   const listed=()=>{const table=STORE.refRowTables(store,'routeId')[0],at=table.values.indexOf('S1');return at<0?false:[...table.rows[at]].includes(x);};
   const journal=STORE.beginJournal(store);STORE.writeRows(store,Int32Array.of(x),image.bytes,image.extras);assert.equal(listed(),true,`S10 ${settle}: the yield sees the staged row`);
   if(settle==='no rows')STORE.writeRows(store,new Int32Array(0),new ArrayBuffer(0),[],{staticRows:true});else STORE.writeRows(store,Int32Array.of(y),other.bytes,other.extras,{staticRows:true});
   STORE.rollbackJournal(journal);assert.equal(listed(),false,`S10 ${settle}: the staged chunk follows the rollback`);assert.equal(STORE.get(store,x,'routeId'),'A1');}
  // S11. A rollback that throws while restoring a row (injected): the chunks of the rows restored before it and of the
  // row it threw on still move their tiers (post-review: the tier move ran after the loop, so a throw skipped it).
  {const rows=build(C+400,'S11'),t=STORE.fromAssets(rows,{at:0}),journal=STORE.beginJournal(t);STORE.set(t,1,'name','<x>');STORE.set(t,C+2,'name','<y>');const inner=STORE.staticSnapshot(t);
   const extras=journal.log.extras;journal.log.extras=new Proxy(extras,{get(o,k){if(k==='1')throw new Error('build702-injected');return o[k];}});
   assert.throws(()=>STORE.rollbackJournal(journal),/build702-injected/,'S11: the injected error reaches the caller');const moved=STORE.staticChunksSince(t,inner);
   for(const tier of ['static','identity','routed'])assert.deepEqual(moved[tier],[0,1],`S11: ${tier} moves on both restored chunks after the throw`);}
  // S12. Two staged writers in one journal: one writer's tier list settles only its own chunks (post-review: any list
  // settled every pending chunk, so the other writer's rows kept the route table from its yield after the rollback).
  for(const shape of ['two chunks','one chunk']){const rows=build(C+400,'S12'),store=STORE.fromAssets(rows,{at:0}),x=rows.findIndex(a=>a.routeId==='A1'),y=shape==='one chunk'?rows.findIndex((a,i)=>i>x&&a.routeId==='A1'):C+rows.slice(C).findIndex(a=>a.routeId==='A1');assert.ok(x>=0&&y>x,'S12: rows');
   const scratch=STORE.importReplica(STORE.exportReplica(store));STORE.set(scratch,x,'routeId','S1');const image=STORE.readRows(scratch,Int32Array.of(x)),other=STORE.readRows(store,Int32Array.of(y));
   const listed=()=>{const table=STORE.refRowTables(store,'routeId')[0],at=table.values.indexOf('S1');return at<0?false:[...table.rows[at]].includes(x);};
   const journal=STORE.beginJournal(store),a=STORE.stagedWriter(),b=STORE.stagedWriter();STORE.writeRows(store,Int32Array.of(x),image.bytes,image.extras,{writer:a});STORE.writeRows(store,Int32Array.of(y),other.bytes,other.extras,{writer:b});assert.equal(listed(),true,`S12 ${shape}: the yield sees A's staged row`);
   STORE.writeRows(store,new Int32Array(0),new ArrayBuffer(0),[],{staticRows:{static:[],identity:[],routed:[]},writer:b});STORE.rollbackJournal(journal);
   assert.equal(listed(),false,`S12 ${shape}: B's settled list leaves A's chunk pending; it follows the rollback`);assert.equal(STORE.get(store,x,'routeId'),'A1');
   // Both settled (each by its own list): an engine-only rollback keeps the evidence from before the journal.
   const kept=STORE.identitySnapshot(store),again=STORE.beginJournal(store),c=STORE.stagedWriter(),d=STORE.stagedWriter(),same=STORE.readRows(store,Int32Array.of(x,y));STORE.writeRows(store,Int32Array.of(x,y),same.bytes,same.extras,{writer:c});STORE.writeRows(store,Int32Array.of(y),STORE.readRows(store,Int32Array.of(y)).bytes,[undefined],{writer:d});
   for(const w of [c,d])STORE.writeRows(store,new Int32Array(0),new ArrayBuffer(0),[],{staticRows:{static:[],identity:[],routed:[]},writer:w});STORE.rollbackJournal(again);assert.equal(STORE.identityCurrent(store,kept),true,`S12 ${shape}: two settled writers rolled back keep the evidence`);}
  // S12b. A writer reused in a later journal counts its chunk again there; an empty replay settle (a tier list with no
  // rows, its own writer) leaves another writer's chunk pending (post-review round 2).
  {const rows=build(C+400,'S12b'),store=STORE.fromAssets(rows,{at:0}),x=rows.findIndex(a=>a.routeId==='A1');
   const scratch=STORE.importReplica(STORE.exportReplica(store));STORE.set(scratch,x,'routeId','S1');const image=STORE.readRows(scratch,Int32Array.of(x));
   const listed=()=>{const table=STORE.refRowTables(store,'routeId')[0],at=table.values.indexOf('S1');return at<0?false:[...table.rows[at]].includes(x);};
   // Each journal starts after an identity write in the chunk, so the route table is rebuilt inside its yield.
   let renames=0;const fresh=()=>STORE.set(store,x+1,'name',`S12b fresh ${++renames}`);
   const a=STORE.stagedWriter(),first=STORE.beginJournal(store);STORE.writeRows(store,Int32Array.of(x),image.bytes,image.extras,{writer:a});STORE.rollbackJournal(first);assert.equal(listed(),false,'S12b: first journal follows the rollback');
   fresh();const second=STORE.beginJournal(store);STORE.writeRows(store,Int32Array.of(x),image.bytes,image.extras,{writer:a});assert.equal(listed(),true,'S12b: the yield sees the reused writer\'s row');STORE.rollbackJournal(second);assert.equal(listed(),false,'S12b: a reused writer counts its chunk in the new journal');
   fresh();const third=STORE.beginJournal(store),b=STORE.stagedWriter();STORE.writeRows(store,Int32Array.of(x),image.bytes,image.extras,{writer:b});assert.equal(listed(),true);
   STORE.writeRows(store,new Int32Array(0),new ArrayBuffer(0),[],{staticRows:{static:[],identity:[],routed:[]},writer:STORE.stagedWriter()});STORE.rollbackJournal(third);assert.equal(listed(),false,'S12b: an empty settle with its own writer leaves B pending');
   // A write that throws part way (a row out of range after a good one) leaves its chunk pending.
   fresh();const fourth=STORE.beginJournal(store),c=STORE.stagedWriter(),two=STORE.readRows(scratch,Int32Array.of(x,x));assert.throws(()=>STORE.writeRows(store,Int32Array.of(x,store.length+5),two.bytes,two.extras,{writer:c}),/out-of-range/);assert.equal(listed(),true,'S12b: the first row was written');
   STORE.rollbackJournal(fourth);assert.equal(listed(),false,'S12b: a write that threw part way leaves its chunk pending');}
  // S14. The staged writers pass their own writer (post-review: the store's frozen API cannot be spied on, and the
  // dispatch apply refuses any other write while it runs, so the wiring is pinned in the source): the dispatch apply on
  // its row slices and its tier list; the thread's step replay on its row slices, its last slice and its empty replay.
  {const fs=require('node:fs'),root=process.env.GH_TEST_SOURCE_DIR||require('node:path').resolve(__dirname,'..'),read=name=>fs.readFileSync(require('node:path').join(root,'WebApp',name),'utf8');
   const dispatch=read('fleet-dispatch-core.js'),thread=read('fleet-engine-thread.js');
   assert.ok(dispatch.includes('const writer=STORE.stagedWriter?.()||null;')&&dispatch.includes('STORE.writeRows(recordStore,partIndices,partBytes,partExtras,{writer});')&&dispatch.includes('staticRows:plan.staticRows,writer});'),'S14: the dispatch apply writes and settles with its own writer');
   assert.ok(thread.includes('staticRows:message.staticRows,writer:STORE.stagedWriter?.()||null})));return;}'),'S14: the empty step replay settles with its own writer');
   assert.ok(thread.includes('const writer=STORE.stagedWriter?.()||null;')&&thread.includes("staticRows:message.staticRows===true?true:last?message.staticRows:false,writer})));"),'S14: the step replay writes and settles with its own writer');}
  // S13. Both compactions (in place and staged) log every chunk foreign: the replica moves every tier.
  for(const staged of [false,true]){const rows=build(C+400,'S13'),store=STORE.fromAssets(rows,{at:0});STORE.drainReplica(store);STORE.removeMany(store,[3,C+5]);STORE.drainReplica(store);
   if(staged){const stages=STORE.compactRowsStages(store,{rowSlice:4096});let step;do step=stages.next();while(!step.done);}else STORE.compactRows(store);
   const log=STORE.drainReplica(store),chunks=Math.ceil(store.length/C);for(let chunk=0;chunk<chunks;chunk++)assert.ok(log.foreignChunks.includes(chunk),`S13 ${staged?'staged':'in place'}: chunk ${chunk} foreign`);}
  results.push({name:'S. store tiers'});
}

// T. Thread and worker.
(async()=>{
  const assets=build(70000,'VX',3),src=fs.readFileSync(path.join(ROOT,'WebApp/fleet-engine-worker.js'),'utf8'),inbox=[],outbox=[],syncs=[];let listener=null,replica=null;
  const spy={...STORE,importReplica(...args){replica=STORE.importReplica(...args);return replica;}};
  const self={GH_FLEET_STORE:spy,GH_FLEET_EVENTS:globalThis.GH_FLEET_EVENTS,GH_FLEET_QUERY:globalThis.GH_FLEET_QUERY,GH_FLEET_DATA:FLEET,GH_FLEET_SAVE_VALIDATION:CORE,addEventListener:(type,fn)=>{if(type==='message')listener=fn;},postMessage:message=>outbox.push(structuredClone(message))};
  new Function('self','importScripts',src)(self,()=>{});
  const worker={postMessage:(message,transfer)=>{if(message?.type==='sync')syncs.push(message.staticRows);inbox.push(structuredClone(message,{transfer:transfer||[]}));},terminate(){}};
  const client=THREAD.create({workerFactory:()=>worker,resolveRoute:FIX.resolveRoute,catalogSpecs:()=>({}),timeoutMs:600000});
  const deliver=()=>{while(inbox.length||outbox.length){while(inbox.length)listener({data:inbox.shift()});while(outbox.length)worker.onmessage({data:outbox.shift()});}};
  const live=STORE.fromAssets(assets,{at:0}),state={simSeconds:1000,fleet:live},t=1000;let mainTiers=null,replicaTiers=null;
  async function validate(label){
    const query=client.query(live,{name:'saveValidation',params,simSeconds:state.simSeconds});assert.ok(query,`${label}: posted`);deliver();const found=await query;assert.ok(found&&client.current(found,live),`${label}: current`);
    assert.deepEqual(found.result,CORE.summarizeReference(state,FLEET,params),`${label}: equal to the reference`);
    const stats=client.stats(),mainAll=mainTiers?STORE.staticChunksSince(live,mainTiers):null,replicaAll=mainTiers&&replica?STORE.staticChunksSince(replica,replicaTiers):null,mainMoved=mainAll?mainAll.identity:null;
    if(mainAll)for(const tier of ['static','identity','routed'])assert.ok(mainAll[tier].every(chunk=>replicaAll[tier].includes(chunk)),`${label}: the replica's ${tier} tier moved wherever the store's did`);
    mainTiers=STORE.staticSnapshot(live);replicaTiers=replica?STORE.staticSnapshot(replica):null;
    return {checked:stats.lastSaveValidationChunksChecked,reset:stats.lastSaveValidationReset,mainMoved,errors:found.result.errors};
  }
  const wait=async ticket=>{for(let i=0;i<4000&&ticket.status==='pending';i++){deliver();await new Promise(resolve=>setTimeout(resolve,0));}};
  {const ticket=client.request(live,{from:t,to:t,context:FIX.context(t),contextKey:'k',order:'events'});await wait(ticket);client.discard(ticket);deliver();}
  await validate('T cold');const warm=await validate('T1 warm');assert.equal(warm.checked,0,'T1: warm reuses every chunk');
  // T2. A main-thread identity write interning no new value: exactly its chunk.
  STORE.set(live,C+11,'name','<bad 7>');const written=await validate('T2 write');assert.equal(written.checked,1,'T2: exactly its chunk');assert.ok(written.errors.includes('display-text-assets-name'));
  STORE.set(live,C+11,'name','GH VX 7');assert.equal((await validate('T2 restore')).checked,1);
  // T3. A real engine step replayed in row slices (a staged writer), then cancelled, twice: the worker re-checks exactly
  // the chunks whose identity moved on the main store (the fixture's faulted row moves one), not every restored chunk.
  for(let k=0;k<2;k++){
    const ticket=client.request(live,{from:t,to:t+600,context:FIX.context(t),contextKey:'k',order:'events'});await wait(ticket);
    const journal=STORE.beginJournal(live);let undo=null;const stages=client.applyStages(ticket,live,{contextKey:'k',tx:{registerUndo:fn=>{undo=fn;},afterCommit(){}},rowSlice:256,budgetMs:Infinity});let yields=0;
    let step;do{step=stages.next();if(!step.done)yields++;}while(!step.done);assert.ok(step.value,`T3 ${k}: the step replays`);assert.ok(yields>0,`T3 ${k}: replayed in row slices (a staged writer)`);STORE.rollbackJournal(journal);undo?.();deliver();
    const cancelled=await validate(`T3 cancelled step ${k}`);assert.equal(cancelled.checked,cancelled.mainMoved.length,`T3 ${k}: re-checked exactly the chunks whose identity moved`);assert.ok(cancelled.checked<Math.ceil(live.length/C),`T3 ${k}: fewer than every chunk (before: every restored chunk)`);
  }
  // T3b. A step cancelled in the middle of its staged replay (after 1, 2 and 3 row slices): equal to the reference.
  for(const cut of [1,2,3]){
    const ticket=client.request(live,{from:t,to:t+600,context:FIX.context(t),contextKey:'k',order:'events'});await wait(ticket);
    const journal=STORE.beginJournal(live);let undo=null,yields=0;const stages=client.applyStages(ticket,live,{contextKey:'k',tx:{registerUndo:fn=>{undo=fn;},afterCommit(){}},rowSlice:64,budgetMs:Infinity});
    let step=stages.next();while(!step.done&&yields<cut){yields++;step=stages.next();}assert.equal(step.done,false,`T3b ${cut}: cancelled mid-replay`);stages.return();STORE.rollbackJournal(journal);undo?.();deliver();
    const cancelled=await validate(`T3b cancelled after ${cut}`);assert.equal(cancelled.checked,cancelled.mainMoved.length,`T3b ${cut}: re-checked exactly the chunks whose identity moved`);assert.ok(cancelled.checked<Math.ceil(live.length/C),`T3b ${cut}: fewer than every chunk`);
  }
  // T4. A fault inside an open main journal: seen by the worker; after the rollback, its chunk re-checked and gone.
  {const journal=STORE.beginJournal(live);STORE.set(live,5,'name','<bad 9>');const mid=await validate('T4 mid');assert.equal(mid.checked,1);assert.ok(mid.errors.includes('display-text-assets-name'));
   STORE.rollbackJournal(journal);const after=await validate('T4 after');assert.equal(after.checked,1,'T4: the chunk is re-checked after the rollback');}
  // T5. A split dispatch apply (rows, then a sync from a render-time query, then the tier move), and a values-only sync:
  // the worker is never stale (the rows reached it as a foreign chunk).
  {const x=C+77,chunk=x>>>STORE.CHUNK_SHIFT,scratch=STORE.importReplica(STORE.exportReplica(live));assert.equal(STORE.intern(live,'<split>'),STORE.intern(scratch,'<split>'));
   STORE.set(scratch,x,'name','<split>');const image=STORE.readRows(scratch,Int32Array.of(x)),journal=STORE.beginJournal(live);
   STORE.writeRows(live,Int32Array.of(x),image.bytes,image.extras);assert.equal(client.prime(live),true);deliver();
   const sent=syncs[syncs.length-1];assert.ok(sent&&typeof sent==='object'&&sent.identity.includes(chunk),'T5: the staged rows travel with their chunk marked');
   STORE.writeRows(live,new Int32Array(0),new ArrayBuffer(0),[],{staticRows:{static:[chunk],identity:[chunk],routed:[chunk]}});STORE.intern(live,'<values-only>');
   const mid=await validate('T5 split apply');assert.ok(mid.errors.includes('display-text-assets-name'),'T5: the worker sees the staged fault');STORE.endJournal(journal);await validate('T5 commit');
   STORE.set(live,x,'name','GH VX 77');await validate('T5 restore');}
  // T8. A purchase (appended rows) rolled back after the worker counted them, with a restored engine-only row: the
  // replica's profile groups follow the truncation (before, only a later staticRows:true sync reset them).
  {const counts=store=>JSON.stringify([...STORE.profileRefCounts(store)]);client.prime(live);deliver();const journal=STORE.beginJournal(live),plain=FLEET.plain(state,FLEET.list(state)[3].id);
   for(let i=0;i<5;i++)FLEET.add(state,{...plain,id:`BUY-${i}`});STORE.toucher(live)(7);client.prime(live);deliver();const mid=counts(replica);
   STORE.rollbackJournal(journal);client.prime(live);deliver();const truth=counts(STORE.importReplica(STORE.exportReplica(live)));
   assert.notEqual(mid,truth,'T8: the worker counted the bought rows');assert.equal(counts(replica),truth,'T8: the replica profile groups follow the rollback');}
  // T6. The replica is byte-equal to the store.
  {const inspect=client.inspect();deliver();const seen=await inspect;assert.equal(Buffer.compare(Buffer.from(seen.rows),Buffer.from(new Uint8Array(live.rows,0,live.length*STORE.STRIDE))),0,'T6: replica rows byte-equal');assert.equal(JSON.stringify(seen.values),JSON.stringify(live.values),'T6: values equal');}
  // T7. The sync names tier lists (not true) once the replica has a baseline.
  assert.ok(syncs.slice(1).some(entry=>entry&&typeof entry==='object'&&!Array.isArray(entry)),'T7: syncs after the first name their chunks');
  results.push({name:'T. thread and worker',syncs:syncs.length});
  console.log(JSON.stringify({suite:'build702-rollback-tier-evidence',ok:true,results}));
})().catch(error=>{console.error(error);process.exitCode=1;});
