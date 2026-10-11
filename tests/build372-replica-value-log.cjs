'use strict';
// The fleet worker's ordinary exchange must be proportional to changed interned refs. This differential test applies
// the incremental payload to a replica and compares it with the store after appends, reclamation, free-slot reuse and
// a transaction that was exchanged while open and then rolled back.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const STORE=require('../WebApp/fleet-store-core.js');

const assets=[
  {id:'VALUE-1',type:'air',assetMode:'air',phase:'idle',routeId:'R-1',condition:100,lastTrip:{revenue:1}},
  {id:'VALUE-2',type:'road',assetMode:'road',phase:'idle',routeId:'R-2',condition:90,lastTrip:{revenue:2}}
];
const store=STORE.fromAssets(assets,{at:0});
const baselineLog=STORE.drainReplica(store);assert.equal(baselineLog.valueRefs.length,0,'construction before a replica baseline does not retain every interned ref');
const replica=STORE.importReplica(STORE.exportReplica(store));
const norm=values=>JSON.stringify(values.map(value=>value===undefined?null:value));
const equal=label=>assert.equal(norm(replica.values),norm(store.values),`${label}: replica value table`);
const exchange=label=>{
  const log=STORE.drainReplica(store);
  if(log.valuesDirty)STORE.applyValueChanges(replica,STORE.replicaValueChanges(store,log.valueRefs));
  equal(label);return log;
};

const append=STORE.intern(store,{kind:'append',n:1});
assert.equal(STORE.intern(store,{kind:'append',n:1}),append,'equal values share a ref');
let log=exchange('append');
assert.deepEqual([...log.valueRefs],[append],'an appended ref is logged once');

// The value is unused, so collection clears it. Reuse must name that same ref with its new immutable value.
STORE.collectValues(store);log=exchange('collect');
assert.deepEqual([...log.valueRefs],[append]);
assert.equal(replica.values[append],null);
const reused=STORE.intern(store,{kind:'reused',n:2});assert.equal(reused,append);
log=exchange('reuse');assert.deepEqual([...log.valueRefs],[reused]);

// Mirror an open transaction, then its rollback. Appended refs disappear through the length in the second payload and
// reused refs are explicitly restored to null, without comparing either complete table.
STORE.collectValues(store);exchange('free-before-transaction');
const journal=STORE.beginJournal(store),insideReused=STORE.intern(store,{kind:'inside-reused'}),insideAppend=STORE.intern(store,{kind:'inside-append'});
assert.ok(insideAppend>=insideReused);exchange('transaction-open');
STORE.rollbackJournal(journal);log=exchange('transaction-rollback');
assert.equal(replica.values.length,store.values.length);
assert.ok(log.valuesDirty,'rollback reports its value-table length/ref restoration');

const clean=STORE.drainReplica(store);assert.equal(clean.valuesDirty,false);assert.equal(clean.valueRefs.length,0);assert.equal(STORE.replicaClean(store),true);

// The production maintenance path uses the staged collector. A stale mark must free/log nothing; its clean retry frees
// a dense orphan set once, and the incremental payload must bring a replica to the exact same table without a full scan.
{
  const stagedStore=STORE.fromAssets(Array.from({length:600},(_,index)=>({id:`STAGED-${index}`,type:'air',assetMode:'air',phase:'idle',routeId:'R-1',condition:100})),{at:0});
  STORE.drainReplica(stagedStore);const stagedReplica=STORE.importReplica(STORE.exportReplica(stagedStore)),orphans=[];
  for(let index=0;index<4096;index++)orphans.push(STORE.intern(stagedStore,{qa:'staged-orphan',index}));
  let stagedLog=STORE.drainReplica(stagedStore);STORE.applyValueChanges(stagedReplica,STORE.replicaValueChanges(stagedStore,stagedLog.valueRefs));
  const stale=STORE.collectValuesStages(stagedStore,{rowSlice:256});assert.equal(stale.next().done,false,'staged mark yields before sweeping');
  STORE.set(stagedStore,0,'condition',99);let turn,result;while(!(turn=stale.next()).done){}result=turn.value;
  assert.equal(result.stale,true);assert.ok(orphans.every(ref=>stagedStore.values[ref]!==null),'a stale mark frees no values');
  stagedLog=STORE.drainReplica(stagedStore);assert.equal(stagedLog.valuesDirty,false,'a stale mark emits no value delta');
  const retry=STORE.collectValuesStages(stagedStore,{rowSlice:256});while(!(turn=retry.next()).done){}result=turn.value;
  assert.equal(result.stale,false);assert.equal(result.freed,orphans.length);
  stagedLog=STORE.drainReplica(stagedStore);assert.equal(stagedLog.valuesDirty,true);assert.equal(stagedLog.valueRefs.length,orphans.length);
  assert.deepEqual(new Set(stagedLog.valueRefs),new Set(orphans),'every dense staged free is logged exactly once');
  const payload=STORE.replicaValueChanges(stagedStore,stagedLog.valueRefs);assert.ok(payload.changes.every(([,value])=>value===null));
  STORE.applyValueChanges(stagedReplica,payload);assert.equal(norm(stagedReplica.values),norm(stagedStore.values),'staged collection replica parity');
}

// A native seed is initialization-only for one runtime. Once a baseline was drained, while a journal is active, after
// one seed was set, or after it was taken, another seed must be refused without erasing the pending replica log.
{
  const seedData=target=>{const byteLength=target.length*STORE.STRIDE,chunkBytes=Math.max(STORE.STRIDE,byteLength);return {chunks:[target.rows.slice(0,byteLength)],chunkBytes,byteLength};};
  const seeded=STORE.fromAssets(assets,{at:0}),first=seedData(seeded);assert.equal(STORE.setReplicaSeed(seeded,first),true);
  assert.equal(STORE.setReplicaSeed(seeded,seedData(seeded)),false,'a second seed before take is refused');
  assert.ok(STORE.takeReplicaSeed(seeded));assert.equal(STORE.setReplicaSeed(seeded,seedData(seeded)),false,'a seed stays one-shot after take');
  const journaled=STORE.fromAssets(assets,{at:0}),open=STORE.beginJournal(journaled);
  assert.equal(STORE.setReplicaSeed(journaled,seedData(journaled)),false,'a seed cannot reset an active journal');STORE.rollbackJournal(open);
  const drained=STORE.fromAssets(assets,{at:0});STORE.drainReplica(drained);STORE.set(drained,0,'condition',77);
  assert.equal(STORE.setReplicaSeed(drained,seedData(drained)),false,'a seed cannot replace an established baseline');
  const pending=STORE.drainReplica(drained);assert.deepEqual([...pending.rows],[0],'refusing a late seed preserves pending row changes');
}

// `present` is transported because columnWriter may expose a previously absent hot field, but it is quiet for the event
// queue. Commit and rollback must report only the actual flight counter; rollback used to promote every snapshot to loud.
for(const outcome of ['commit','rollback']){
  const columns=STORE.fromAssets([{id:`COLUMN-${outcome}`,type:'air',assetMode:'air',phase:'idle',condition:100}],{at:0});
  STORE.drainDirty(columns,columns.revision);STORE.drainReplica(columns);
  const journal=STORE.beginJournal(columns),put=STORE.columnWriter(columns,['flightHours']);put(0,'flightHours',1);
  if(outcome==='commit')STORE.endJournal(journal);else STORE.rollbackJournal(journal);
  const dirty=STORE.drainDirty(columns,0),replicaColumns=STORE.drainReplica(columns);
  assert.deepEqual(new Set(dirty.columns),new Set(['flightHours']),`${outcome}: quiet present is absent from event dirty columns`);
  assert.deepEqual(new Set(replicaColumns.columns),new Set(['present','flightHours']),`${outcome}: both physical columns reach the replica`);
  assert.deepEqual(new Set(replicaColumns.reportedColumns),new Set(['flightHours']),`${outcome}: only the loud column is reported downstream`);
}

const threadSource=fs.readFileSync(path.join(__dirname,'../WebApp/fleet-engine-thread.js'),'utf8');
assert.doesNotMatch(threadSource,/synced\.values(?:\b|\s*=)|STORE\.valueChanges\(/,'ordinary worker sync must not scan or snapshot the full value table');
const storeSource=fs.readFileSync(path.join(__dirname,'../WebApp/fleet-store-core.js'),'utf8'),applySource=storeSource.slice(storeSource.indexOf('function applyValueChanges'),storeSource.indexOf('function internAt'));
assert.doesNotMatch(applySource,/r\.free\s*=\s*\[\]|for\s*\(let ref=1;ref<values\.length/,'a small value payload must not rebuild the whole free list');
console.log(JSON.stringify({ok:true,append,reused,rollbackLength:store.values.length,stagedOrphans:4096,incrementalOnly:true}));
