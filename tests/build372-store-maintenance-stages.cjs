'use strict';
// Differential gates for the million-row maintenance paths. Every potentially linear pass must yield in bounded chunks,
// must reject a mixed snapshot, and must preserve the byte/replica result of the original synchronous operation.
const assert=require('node:assert/strict');
const STORE=require('../WebApp/fleet-store-core.js');
const FLEET=require('../WebApp/fleet-access-core.js');

const norm=value=>JSON.stringify(value,(key,row)=>row===undefined?null:row);
const bytes=store=>Buffer.from(store.rows,0,store.length*STORE.STRIDE);
const snapshot=store=>({length:store.length,live:store.live,structure:store.structure,revision:store.revision,rows:bytes(store).toString('base64'),extras:norm(store.extras),assets:norm(STORE.toAssets(store))});
const drain=generator=>{let yields=0,step;while(!(step=generator.next()).done)yields++;return {yields,result:step.value};};
const finish=generator=>{let step;while(!(step=generator.next()).done){}return step.value;};
const asset=index=>({id:`STAGE-${String(index).padStart(6,'0')}`,name:`Stage ${index}`,type:'air',assetMode:'air',ownerCompanyId:'air',phase:index%3===0?'moving':'turnaround',condition:70+(index%31),flightHours:index%700,flightCycles:index%300,...(index%7===0?{}:{nextCheckHours:600}),custom:index%11===0?{index}:undefined});

function stores(count=5000){const assets=Array.from({length:count},(_,index)=>asset(index));return [STORE.fromAssets(assets,{at:0}),STORE.fromAssets(assets,{at:0})];}
function planFor(store){
  const fields=['flightHours','flightCycles','nextCheckHours'],indices=new Int32Array(store.length),values=new Float32Array(store.length*fields.length);
  for(let index=0;index<store.length;index++){indices[index]=index;values[index*3]=index%700+4;values[index*3+1]=index%300+1;values[index*3+2]=600;}
  return {fields,indices,values,count:indices.length};
}
function applyPlain(store,plan){const write=STORE.columnWriter(store,plan.fields);for(let row=0;row<plan.count;row++)for(let field=0;field<plan.fields.length;field++)write(plan.indices[row],plan.fields[field],plan.values[row*plan.fields.length+field]);}

// A bulk reservation copies the existing record buffer in bounded slices, preserves the store/runtime/log identity and
// can live inside the purchase journal. Capacity remains an implementation detail on rollback; every logical byte and
// replica delta matches the original synchronous growth path.
{
  const [plain,staged]=stores(2400),additional=3100,target=plain.length+additional;STORE.drainReplica(plain);STORE.drainReplica(staged);
  const plainRuntime=STORE.chunkStamp(plain).runtime,stagedRuntime=STORE.chunkStamp(staged).runtime,beforePlain=snapshot(plain),beforeStaged=snapshot(staged),jp=STORE.beginJournal(plain),js=STORE.beginJournal(staged);
  STORE.ensureCapacity(plain,target);const run=drain(STORE.reserveCapacityStages(staged,target,{rowSlice:256,label:'qa.capacity'}));
  assert.ok(run.yields>=9,`capacity copy is sliced (${run.yields})`);assert.deepEqual(run.result,{stale:false,grown:true,capacity:plain.capacity});assert.equal(staged.capacity,plain.capacity);assert.equal(STORE.chunkStamp(staged).runtime,stagedRuntime,'staged reserve keeps one runtime');assert.equal(STORE.chunkStamp(plain).runtime,plainRuntime);assert.deepEqual(snapshot(staged),snapshot(plain));assert.equal(STORE.replicaClean(staged),true,'physical growth creates no replica delta');
  for(let index=0;index<300;index++){STORE.add(plain,asset(10000+index),{at:0});STORE.add(staged,asset(10000+index),{at:0});}
  STORE.rollbackJournal(jp);STORE.rollbackJournal(js);assert.equal(snapshot(plain).rows,beforePlain.rows);assert.equal(snapshot(staged).rows,beforeStaged.rows);assert.deepEqual(snapshot(staged),snapshot(plain),'rollback after reserved bulk adds is byte exact');
  const lp=STORE.drainReplica(plain),ls=STORE.drainReplica(staged);assert.deepEqual([...ls.rows],[...lp.rows]);assert.deepEqual([...ls.valueRefs],[...lp.valueRefs]);assert.equal(ls.valuesDirty,lp.valuesDirty);assert.equal(staged.capacity,plain.capacity,'rollback does not need to shrink physical capacity');
}
{
  const [store]=stores(1600),rows=store.rows,capacity=store.capacity,stages=STORE.reserveCapacityStages(store,5000,{rowSlice:256});assert.equal(stages.next().value.stage,'capacity-copy');STORE.set(store,3,'condition',41);
  assert.deepEqual(finish(stages),{stale:true,grown:false,capacity});assert.equal(store.rows,rows,'a row mutation prevents stale buffer publication');assert.equal(STORE.get(store,3,'condition'),41);
}
{
  const [store]=stores(1600),rows=store.rows,capacity=store.capacity;STORE.drainReplica(store);const stages=STORE.reserveCapacityStages(store,5000,{rowSlice:256});stages.next();STORE.drainReplica(store);
  assert.deepEqual(finish(stages),{stale:true,grown:false,capacity});assert.equal(store.rows,rows,'a replica drain prevents split ownership during capacity copy');
}
{
  const [store]=stores(900),state={fleet:store,simSeconds:0},runtime=STORE.chunkStamp(store).runtime,stages=FLEET.reserveCapacityStages(state,1100,{rowSlice:256});const run=drain(stages);
  assert.equal(run.result.stale,false);assert.ok(store.capacity>=2000);assert.equal(STORE.chunkStamp(store).runtime,runtime);assert.deepEqual(finish(FLEET.reserveCapacityStages(state,0)),{stale:false,grown:false,capacity:store.capacity});
}

// The staged column plan is byte/counter/log identical to columnWriter for commit and rollback. Snapshot preparation is
// read-only and abandoned preparation does not become a rollback column or replica payload.
for(const outcome of ['commit','rollback']){
  const [plain,staged]=stores(),plan=planFor(plain);STORE.drainReplica(plain);STORE.drainReplica(staged);
  const beforePlain=snapshot(plain),beforeStaged=snapshot(staged),jp=STORE.beginJournal(plain),js=STORE.beginJournal(staged);
  applyPlain(plain,plan);const run=drain(STORE.columnPlanStages(staged,plan,{rowSlice:256,label:'qa.column-plan',replicaTransfer:true}));
  assert.ok(run.yields>=60,`column validation/snapshots/apply are sliced (${run.yields})`);assert.equal(run.result.count,plan.count);
  if(outcome==='commit'){STORE.endJournal(jp);STORE.endJournal(js);}else{STORE.rollbackJournal(jp);STORE.rollbackJournal(js);assert.equal(snapshot(plain).rows,beforePlain.rows);assert.equal(snapshot(staged).rows,beforeStaged.rows);}
  assert.deepEqual(snapshot(staged),snapshot(plain),`${outcome}: staged column plan matches columnWriter exactly`);
  const lp=STORE.drainReplica(plain),ls=STORE.drainReplica(staged);
  assert.deepEqual(ls.columns,lp.columns);assert.deepEqual(ls.reportedColumns,lp.reportedColumns);assert.deepEqual([...ls.rows],[...lp.rows]);
  if(outcome==='commit'){
    assert.ok(ls.columnPlan,'the first committed mass write retains its sparse plan');assert.equal(ls.columnPlan.indices,plan.indices);assert.equal(ls.columnPlan.values,plan.values);assert.deepEqual(ls.columnPlan.columns,ls.columns);assert.deepEqual(ls.columnPlan.reportedColumns,ls.reportedColumns);
  }else assert.equal(ls.columnPlan,null,'rollback invalidates the forward plan and sends restored columns');
}
// A previous mass write has ordering that the sparse plan does not describe. It deliberately keeps the complete-column
// fallback; likewise, any row write after a retained plan invalidates it because that final row must win.
{
  const [store]=stores(1200),write=STORE.columnWriter(store,['condition']);STORE.drainReplica(store);write(0,'condition',31);finish(STORE.columnPlanStages(store,planFor(store),{rowSlice:256,replicaTransfer:true}));
  const log=STORE.drainReplica(store);assert.equal(log.columnPlan,null,'a prior column write selects the complete-column fallback');assert.ok(log.columns.includes('condition'));assert.ok(log.columns.includes('flightHours'));
}
{
  const [store]=stores(1200);STORE.drainReplica(store);finish(STORE.columnPlanStages(store,planFor(store),{rowSlice:256,replicaTransfer:true}));STORE.set(store,7,'flightHours',999);
  const log=STORE.drainReplica(store);assert.equal(log.columnPlan,null,'a later row override invalidates the retained plan');assert.ok([...log.rows].includes(7));
}
// Draining the replica log between apply chunks would split one mass write across exchanges. The staged writer detects
// that ownership change and aborts so its transaction can restore the partial write instead of publishing a mixed log.
{
  const [store]=stores(1200),journal=STORE.beginJournal(store),stages=STORE.columnPlanStages(store,planFor(store),{rowSlice:256,replicaTransfer:true}),revision=store.revision;
  let step;while(store.revision===revision&&!(step=stages.next()).done){}assert.ok(store.revision>revision,'guard setup reached the sliced apply');STORE.drainReplica(store);
  assert.throws(()=>stages.next(),/fleet-store-column-plan-changed/);STORE.rollbackJournal(journal);assert.equal(STORE.drainReplica(store).columnPlan,null);
}
{
  const [store]=stores(1200),before=snapshot(store);STORE.drainReplica(store);const journal=STORE.beginJournal(store),stages=STORE.columnPlanStages(store,planFor(store),{rowSlice:256});
  assert.equal(stages.next().done,false);assert.deepEqual(STORE.journalStats(store).columns,[],'validation/preparation has not armed a rollback column');
  STORE.rollbackJournal(journal);const log=STORE.drainReplica(store);assert.deepEqual(log.columns,[],'abandoned preparation reports no physical column');assert.deepEqual(log.reportedColumns,[]);assert.equal(snapshot(store).rows,before.rows);
}
for(const bad of [NaN]){
  const [store]=stores(300),plan=planFor(store);plan.values=new Float64Array(plan.values);plan.values[17]=bad;plan.rejectNaN=true;const before=snapshot(store),journal=STORE.beginJournal(store),stages=STORE.columnPlanStages(store,plan,{rowSlice:256});
  assert.throws(()=>finish(stages),/fleet-store-column-plan-value/);assert.equal(snapshot(store).rows,before.rows,'invalid values fail before the first write');STORE.rollbackJournal(journal);
}
{
  const [plain,staged]=stores(20),fields=['condition'],indices=new Int32Array([0,1,2,3]),values=new Float64Array([Infinity,-Infinity,-0,NaN]),plan={fields,indices,values,count:4};STORE.drainReplica(plain);STORE.drainReplica(staged);applyPlain(plain,plan);finish(STORE.columnPlanStages(staged,plan,{rowSlice:256}));
  assert.equal(bytes(staged).compare(bytes(plain)),0,'f64 IEEE values match columnWriter byte for byte');for(let index=0;index<4;index++)assert.ok(Object.is(STORE.get(staged,index,'condition'),STORE.get(plain,index,'condition')),'f64 IEEE identity is preserved');
}
{
  const [plain,staged]=stores(20),fields=['flightHours'],indices=new Int32Array([0,1,2,3,4]),values=new Float64Array([Infinity,-Infinity,-0,NaN,.1]),plan={fields,indices,values,count:5};STORE.drainReplica(plain);STORE.drainReplica(staged);applyPlain(plain,plan);finish(STORE.columnPlanStages(staged,plan,{rowSlice:256}));
  assert.equal(bytes(staged).compare(bytes(plain)),0,'f32 IEEE/nonexact values match columnWriter byte for byte');assert.equal(norm(staged.extras),norm(plain.extras));for(let index=0;index<5;index++)assert.ok(Object.is(STORE.get(staged,index,'flightHours'),STORE.get(plain,index,'flightHours')),'f32/extras identity is preserved');
}
// The direct dual transport merges fast-f32 and exceptional-f64 rows before a
// single writer. Cover both a true f64 column and an f32/extras column, all IEEE
// edge values, global order, commit and rollback against columnWriter itself.
for(const outcome of ['commit','rollback']){
  const [plain,staged]=stores(20),fields=['condition','flightHours'],indices=new Int32Array([0,6]),values=new Float32Array([71.5,2.5,72.5,-0]),exceptionalIndices=new Int32Array([1,2,3,4,5]),exceptionalValues=new Float64Array([Infinity,Infinity,-Infinity,-Infinity,-0,-0,NaN,NaN,.1,.1]);
  const plan={fields,indices,values,count:2,exceptional:{indices:exceptionalIndices,values:exceptionalValues,count:5},totalCount:7},beforePlain=snapshot(plain),beforeStaged=snapshot(staged),jp=STORE.beginJournal(plain),js=STORE.beginJournal(staged),write=STORE.columnWriter(plain,fields);
  let fast=0,slow=0;while(fast<indices.length||slow<exceptionalIndices.length){const useFast=slow>=exceptionalIndices.length||fast<indices.length&&indices[fast]<exceptionalIndices[slow],row=useFast?indices[fast]:exceptionalIndices[slow],source=useFast?values:exceptionalValues,at=(useFast?fast++:slow++)*fields.length;for(let field=0;field<fields.length;field++)write(row,fields[field],source[at+field]);}
  finish(STORE.columnPlanStages(staged,plan,{rowSlice:256,replicaTransfer:true}));
  if(outcome==='commit'){STORE.endJournal(jp);STORE.endJournal(js);}else{STORE.rollbackJournal(jp);STORE.rollbackJournal(js);assert.equal(snapshot(plain).rows,beforePlain.rows);assert.equal(snapshot(staged).rows,beforeStaged.rows);}
  assert.deepEqual(snapshot(staged),snapshot(plain),`dual IEEE ${outcome} matches columnWriter byte/extras/counters`);
  if(outcome==='commit')for(const row of [0,1,2,3,4,5,6])for(const field of fields)assert.ok(Object.is(STORE.get(staged,row,field),STORE.get(plain,row,field)),`dual ${field}/${row} preserves IEEE identity`);
}
{
  const [store]=stores(300),plan=planFor(store);plan.values=new Float64Array(plan.values);plan.exceptionalPositions=new Int32Array([5]);plan.values[15]=Infinity;plan.values[16]=.1;plan.values[17]=-Infinity;STORE.drainReplica(store);
  const result=finish(STORE.columnPlanStages(store,plan,{rowSlice:256,replicaTransfer:true})),log=STORE.drainReplica(store);assert.equal(result.replicaTransfer,true);assert.equal(STORE.get(store,5,'flightHours'),Infinity);assert.equal(STORE.get(store,5,'flightCycles'),.1);assert.equal(STORE.get(store,5,'nextCheckHours'),-Infinity);assert.equal(log.columnPlan.exceptionalPositions,plan.exceptionalPositions);
}
{
  const [store]=stores(300),fields=['flightHours','flightCycles','nextCheckHours'],indices=new Int32Array(299),values=new Float32Array(299*3),exceptionalIndices=new Int32Array([5]),exceptionalValues=new Float64Array([Infinity,.1,-Infinity]);let at=0;
  for(let index=0;index<300;index++){if(index===5)continue;indices[at]=index;values[at*3]=index;values[at*3+1]=index;values[at*3+2]=600;at++;}
  const plan={fields,indices,values,count:299,exceptional:{indices:exceptionalIndices,values:exceptionalValues,count:1},totalCount:300};STORE.drainReplica(store);const result=finish(STORE.columnPlanStages(store,plan,{rowSlice:256,replicaTransfer:true})),log=STORE.drainReplica(store);
  assert.equal(result.count,300);assert.equal(result.replicaTransfer,true);assert.equal(STORE.get(store,5,'flightHours'),Infinity);assert.equal(STORE.get(store,5,'flightCycles'),.1);assert.equal(STORE.get(store,5,'nextCheckHours'),-Infinity);assert.equal(log.columnPlan.exceptional.indices,exceptionalIndices);assert.equal(log.columnPlan.exceptional.values,exceptionalValues);
}

// Staged compaction publishes the same rows/extras/counters and replica delta as the in-place reference, preserving live
// row order. Pending row bits are remapped while the private buffer is built rather than rescanned at publication.
{
  const [plain,staged]=stores(6000);STORE.drainReplica(plain);STORE.drainReplica(staged);
  const dead=[];for(let index=0;index<6000;index++)if(index%4===0)dead.push(index);STORE.removeMany(plain,dead);STORE.removeMany(staged,dead);
  for(const index of [1,1025,4097]){STORE.set(plain,index,'condition',33);STORE.set(staged,index,'condition',33);}
  const expected=STORE.compactRows(plain),run=drain(STORE.compactRowsStages(staged,{rowSlice:256}));
  assert.ok(run.yields>=20);assert.deepEqual(run.result,{stale:false,...expected});assert.deepEqual(snapshot(staged),snapshot(plain),'staged compaction is byte-for-byte/order equivalent');
  const lp=STORE.drainReplica(plain),ls=STORE.drainReplica(staged);assert.deepEqual([...ls.rows],[...lp.rows]);assert.equal(ls.compactions.length,1);assert.deepEqual([...ls.compactions[0].dead],[...lp.compactions[0].dead]);assert.equal(ls.compactions[0].length,lp.compactions[0].length);
  const replica=STORE.fromAssets(Array.from({length:6000},(_,index)=>asset(index)),{at:0});STORE.compactRowsAt(replica,ls.compactions[0]);const rows=STORE.readRows(staged,ls.rows);STORE.writeRows(replica,ls.rows,rows.bytes,rows.extras,{staticRows:true});replica.live=staged.live;replica.structure=staged.structure;
  assert.equal(bytes(replica).compare(bytes(staged)),0,'compaction plus incremental rows reproduces the main record buffer');assert.equal(norm(replica.extras),norm(staged.extras));
}
{
  const [store]=stores(2400),dead=[];for(let index=0;index<2400;index+=3)dead.push(index);STORE.removeMany(store,dead);const originalRows=store.rows,stages=STORE.compactRowsStages(store,{rowSlice:256});assert.equal(stages.next().value.stage,'compact-build');
  STORE.set(store,1,'condition',41);const result=finish(stages);assert.equal(result.stale,true);assert.equal(store.rows,originalRows,'a stale private compaction buffer is never published');assert.equal(STORE.get(store,1,'condition'),41);assert.equal(store.length,2400);
}
{
  const [store]=stores(1200),dead=[];for(let index=0;index<1200;index+=3)dead.push(index);STORE.drainReplica(store);STORE.removeMany(store,dead);const stages=STORE.compactRowsStages(store,{rowSlice:256});stages.next();STORE.drainReplica(store);assert.equal(finish(stages).stale,true,'draining row deltas invalidates a compaction log snapshot');assert.equal(store.length,1200);
}

function gcFixture(){
  const store=STORE.fromAssets(Array.from({length:700},(_,index)=>asset(index)),{at:0}),orphans=[];for(let index=0;index<4096;index++)orphans.push(STORE.intern(store,{orphan:index}));
  STORE.drainReplica(store);return {store,orphans,replica:STORE.importReplica(STORE.exportReplica(store))};
}
function runTo(generator,wanted,predicate=()=>true){let step;while(!(step=generator.next()).done){if(step.value.stage===wanted&&predicate(step.value))return step.value;}throw new Error(`missing stage ${wanted}`);}

// Mutation during mark or candidate discovery frees nothing. Mutation between free batches stops later candidates; the
// safe prefix plus the interleaved reuse remain an exact incremental replica payload.
for(const phase of ['mark','candidates']){
  const {store,orphans}=gcFixture(),stages=STORE.collectValuesStages(store,{rowSlice:256,valueSlice:256,freeSlice:256});runTo(stages,phase,row=>(row.rows??row.refs)===row.total);STORE.set(store,1,'condition',44);const result=finish(stages);
  assert.equal(result.stale,true);assert.equal(result.freed,0);assert.ok(orphans.every(ref=>store.values[ref]!==null),`${phase}: stale read-only phases free nothing`);
}
{
  const {store,orphans,replica}=gcFixture(),stages=STORE.collectValuesStages(store,{rowSlice:256,valueSlice:256,freeSlice:256});runTo(stages,'free');const reused=STORE.intern(store,{interleaved:true}),result=finish(stages);
  assert.equal(result.stale,true);assert.equal(result.freed,256);assert.ok(orphans.slice(256).some(ref=>store.values[ref]!==null),'later candidates remain untouched');assert.ok(reused<store.values.length);
  const log=STORE.drainReplica(store),payload=STORE.replicaValueChanges(store,log.valueRefs);STORE.applyValueChanges(replica,payload);assert.equal(norm(replica.values),norm(store.values),'partial free/reuse delta keeps replica exact');
}
{
  const {store,orphans,replica}=gcFixture(),run=drain(STORE.collectValuesStages(store,{rowSlice:256,valueSlice:256,freeSlice:256}));assert.equal(run.result.stale,false);assert.equal(run.result.freed,orphans.length);assert.ok(run.yields>=20,'mark, candidates and free are all sliced');
  const log=STORE.drainReplica(store);assert.equal(log.valueRefs.length,orphans.length);STORE.applyValueChanges(replica,STORE.replicaValueChanges(store,log.valueRefs));assert.equal(norm(replica.values),norm(store.values),'full staged GC replica parity');
}

console.log(JSON.stringify({suite:'build372-store-maintenance-stages',columnRows:5000,compactRows:6000,gcOrphans:4096,staged:true}));
console.log('BUILD372_STORE_MAINTENANCE_STAGES_PASS');
