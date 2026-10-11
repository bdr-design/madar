'use strict';

const assert=require('assert');
const {scenario}=require('./helpers/business-scenario');
const Plan=require('../WebApp/asset-purchase-plan-core.js');
const Apply=require('../WebApp/asset-purchase-apply-core.js');
const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
const results=[];
function test(name,fn){try{fn();results.push({name,ok:true});}catch(error){results.push({name,ok:false,error:error.stack||String(error)});}}

function makeWorld(tag='X'){
  const e=scenario(),{s,state,item}=e;state.simSeconds=172810;state.advanced.facilities.B1.capacity=1000000;
  state.fleet=s.GH_FLEET_STORE.fromAssets([],{at:state.simSeconds});delete state.assets;
  const registry=state.companyRegistry.air,common={contextToken:`purchase:${tag}`,ownerCompanyId:'air',assetMode:'air',assetClass:'aircraft',operationProfileId:registry.operationProfileId,companyShortName:registry.shortName,companyName:registry.legalName,tab:'new',ownership:'cash',simSeconds:state.simSeconds,item:{id:item.id,icon:item.icon,name:item.name,year:item.year,condition:item.condition,specs:clone(item.specs),price:item.price,leaseMonthly:item.leaseMonthly||0}};
  const seedInput={...common,contextToken:`seed:${tag}`,groups:[{qty:93,assetSequenceStart:1,serialStart:1,assetIdPrefix:'N-AIR-SEED',baseId:'B1',baseName:'Test airport',orderId:`SEED-${tag}`,requestRef:`SEED-${tag}`,supplier:'Supplier LLC',contractId:`SEED-EMP-${tag}`,hiringId:`SEED-HR-${tag}`,payment:{kind:'cheque',ref:`SEED-CH-${tag}`,invoiceRef:`SEED-INV-${tag}`,ownerCompanyId:'air',company:'air',amount:item.price*93},orderedAtSeconds:100,deliveredAtSeconds:100,documentLeadDays:1,immediateDelivery:true}]},seedPlan=Plan.prepare(seedInput);
  for(let index=0;index<seedPlan.count;index++)s.GH_FLEET_DATA.add(state,Plan.deliveredAsset(seedPlan,0,index));s.GH_FLEET_CORE.synchronizeCrew(state);
  state.sequences=state.sequences||{};state.sequences['fleetCore_EMP-AUTO']=0;state.sequences['fleetCore_HR-AUTO']=0;state.sequences['N-AIR']=200;state.sequences['DEL-AIR']=2;
  const groups=[
    {qty:67,assetSequenceStart:101,serialStart:401,assetIdPrefix:'N-AIR',baseId:'B1',baseName:'Test airport',orderId:`DEL-${tag}-1`,requestRef:`REQ-${tag}-1`,supplier:'Supplier LLC',contractId:'EMP-AUTO-0000001',hiringId:'HR-AUTO-0000001',payment:{kind:'cheque',ref:`CH-${tag}-1`,invoiceRef:`INV-${tag}-1`,ownerCompanyId:'air',company:'air',amount:item.price*67},orderedAtSeconds:state.simSeconds,deliveredAtSeconds:state.simSeconds,documentLeadDays:120,immediateDelivery:true},
    {qty:35,assetSequenceStart:168,serialStart:468,assetIdPrefix:'N-AIR',baseId:'B1',baseName:'Test airport',orderId:`DEL-${tag}-2`,requestRef:`REQ-${tag}-2`,supplier:'Supplier LLC',contractId:'EMP-AUTO-0000002',hiringId:'HR-AUTO-0000002',payment:{kind:'cheque',ref:`CH-${tag}-2`,invoiceRef:`INV-${tag}-2`,ownerCompanyId:'air',company:'air',amount:item.price*35},orderedAtSeconds:state.simSeconds,deliveredAtSeconds:state.simSeconds,documentLeadDays:120,immediateDelivery:true}
  ],plan=Plan.prepare({...common,groups});
  // Production must use the staged Store reservation owner before entering the
  // atomic apply.  The small differential fixture may reserve synchronously.
  s.GH_FLEET_STORE.ensureCapacity(state.fleet,state.fleet.length+plan.count);
  const receipts=groups.map((_,index)=>Plan.pendingReceipt(plan,index));state.realism.procurement.deliveries.push(...clone(receipts));state.realism.procurement.pendingDeliveryCount+=groups.length;
  for(const group of groups)state.finance.cheques.push({id:group.payment.ref,status:'مصروف',company:'air',amount:group.payment.amount});
  const inputs=groups.map((group,index)=>{const planned=plan.groups[index];return {deliveryId:group.orderId,baseId:group.baseId,assets:Plan.pendingReceipt(plan,index).assets.map(asset=>({...asset,ownerCompanyId:'air',companyName:registry.legalName})),phase:'idle',deliveredDay:planned.deliveredDay,deliveredAtSeconds:planned.deliveredAtSeconds};});
  return {...e,state,plan,inputs};
}
function consume(iterator,onYield=()=>{}){let step;while(!(step=iterator.next()).done)onYield(step.value);return step.value;}
function fleetSnapshot(env){
  const {s,state}=env,store=state.fleet,assets=clone(s.GH_FLEET_DATA.map(state,row=>s.GH_FLEET_DATA.plain(row)));
  return {assets,labor:clone(state.advanced.labor)||null,crew:clone(state.crew),sequences:clone(state.sequences),store:{length:store.length,live:store.live,capacity:store.capacity,structure:store.structure,revision:store.revision,values:clone(store.values),rows:Buffer.from(new Uint8Array(store.rows,0,store.length*s.GH_FLEET_STORE.STRIDE)).toString('base64'),extras:clone(store.extras)}};
}
function adapterFor(env,overrides={}){
  const {s,state}=env;return Apply.createAdapter(state,{fleetData:overrides.fleetData||s.GH_FLEET_DATA,storeApi:s.GH_FLEET_STORE,transactionCore:s.GH_TRANSACTION_CORE,planCore:Plan,facilityOf:id=>state.globalBases.find(row=>row.id===id)||null,capacityOf:facility=>s.GH_FACILITY_CORE.assetCapacity(facility),manageReceipts:false,manageGroupValue:false,maxSynchronousBaselineRows:10000,...overrides});
}

test('two delivery batches match recordDeliveryBatch with one worker baseline query',()=>{
  const reference=makeWorld('DIFF'),candidate=makeWorld('DIFF');let referenceOccupancyPasses=0,referenceCrewPasses=0;
  const original=reference.s.GH_FLEET_DATA,wrapped={...original,countByFields(...args){referenceOccupancyPasses++;return original.countByFields(...args);},forEachFieldClasses(...args){referenceCrewPasses++;return original.forEachFieldClasses(...args);}};reference.s.GH_FLEET_DATA=wrapped;
  reference.s.GH_FLEET_CORE.recordDeliveryBatch(reference.state,reference.inputs);reference.s.GH_FLEET_DATA=original;
  // The plan reserves these deterministic ids before its sliced materialization.
  candidate.state.sequences['fleetCore_EMP-AUTO']=2;candidate.state.sequences['fleetCore_HR-AUTO']=2;
  let candidateClassPasses=0;const baseFleet=candidate.s.GH_FLEET_DATA,instrumented={...baseFleet,forEachFieldClasses(...args){candidateClassPasses++;return baseFleet.forEachFieldClasses(...args);}};const adapter=adapterFor(candidate,{fleetData:instrumented});
  const yielded=[];consume(Plan.applyStages(candidate.plan,adapter,{budgetMs:.25,clock:(()=>{let value=0;return()=>++value;})()}),row=>yielded.push(row));
  assert.deepStrictEqual(fleetSnapshot(candidate),fleetSnapshot(reference));assert.equal(referenceOccupancyPasses,1);assert.equal(referenceCrewPasses,1);assert.equal(candidateClassPasses,2);assert.equal(adapter.telemetry().baselinePasses,2);assert.equal(adapter.telemetry().groupsApplied,2);assert(yielded.length>10);
});

test('fractional legacy staffing preserves synchronizeCrew row-order arithmetic exactly',()=>{
  const reference=makeWorld('FLOAT'),candidate=makeWorld('FLOAT');
  for(const env of [reference,candidate]){
    const first=env.s.GH_FLEET_DATA.viewAt(env.state,0),staffing=clone(first.staffing);staffing.roles=staffing.roles.map(role=>role.id==='pilots'?{...role,count:1/3}:role);
    env.s.GH_FLEET_DATA.update(env.state,first,{staffing});env.s.GH_FLEET_CORE.synchronizeCrew(env.state);
  }
  reference.s.GH_FLEET_CORE.recordDeliveryBatch(reference.state,reference.inputs);candidate.state.sequences['fleetCore_EMP-AUTO']=2;candidate.state.sequences['fleetCore_HR-AUTO']=2;
  const baseline=Apply.computeBaseline(candidate.state,candidate.s.GH_FLEET_DATA,candidate.plan,Plan);assert.equal(baseline.crewRowOrder,true);assert.equal(baseline.rowPasses,1);
  consume(Plan.applyStages(candidate.plan,adapterFor(candidate,{baseline,current:()=>true,maxSynchronousBaselineRows:0}),{budgetMs:.25,clock:(()=>{let value=0;return()=>++value;})()}));
  const expected=reference.state.crew.find(row=>row.id==='pilots').count,actual=candidate.state.crew.find(row=>row.id==='pilots').count;assert(Object.is(actual,expected),`${actual} !== ${expected}`);assert.deepStrictEqual(fleetSnapshot(candidate),fleetSnapshot(reference));
});

test('large integer staffing preserves Fleet Core staffing-only class rounding exactly',()=>{
  const env=makeWorld('WIDE-CLASS');env.state.fleet=env.s.GH_FLEET_STORE.fromAssets([],{at:0});const staffing={mode:'automatic-fixed',ready:true,roles:[{id:'pilots',count:Number.MAX_SAFE_INTEGER}]};
  for(let index=0;index<8;index++)env.s.GH_FLEET_DATA.add(env.state,{...Plan.deliveredAsset(env.plan,0,0),id:`WIDE-${index}`,baseFacility:index<3?'B1':'B2',staffing});
  const baseline=Apply.computeBaseline(env.state,env.s.GH_FLEET_DATA);env.s.GH_FLEET_CORE.synchronizeCrew(env.state);const expected=env.state.crew.find(row=>row.id==='pilots').count,actual=new Map(baseline.crew).get('pilots');assert(Object.is(actual,expected),`${actual} !== ${expected}`);assert.equal(baseline.classPasses,2);
});

test('an exact provided baseline performs no main-thread fleet scan',()=>{
  const env=makeWorld('WORKER'),baseline=Apply.computeBaseline(env.state,env.s.GH_FLEET_DATA,env.plan,Plan);env.state.sequences['fleetCore_EMP-AUTO']=2;env.state.sequences['fleetCore_HR-AUTO']=2;
  const original=env.s.GH_FLEET_DATA,noScan={...original,has(){throw new Error('unexpected-main-id-scan');},forEachFieldClasses(){throw new Error('unexpected-main-baseline-scan');},forEachFields(){throw new Error('unexpected-main-row-scan');}},adapter=adapterFor(env,{fleetData:noScan,baseline,current:()=>true,maxSynchronousBaselineRows:0});
  consume(Plan.applyStages(env.plan,adapter,{budgetMs:4}));const telemetry=adapter.telemetry();assert.equal(telemetry.providedBaseline,true);assert.equal(telemetry.workerIdGuard,true);assert.equal(telemetry.baselinePasses,0);assert.equal(telemetry.duplicateChecks,0);assert.equal(telemetry.assetsApplied,env.plan.count);
});

test('a stale worker baseline is rejected before the first mutation',()=>{
  const env=makeWorld('STALE'),baseline=Apply.computeBaseline(env.state,env.s.GH_FLEET_DATA,env.plan,Plan),before=fleetSnapshot(env);env.s.GH_FLEET_DATA.add(env.state,Plan.deliveredAsset(env.plan,0,0));const afterExternal=fleetSnapshot(env),adapter=adapterFor(env,{baseline,current:()=>true,maxSynchronousBaselineRows:0});
  assert.throws(()=>consume(Plan.applyStages(env.plan,adapter)),/baseline-membership-stale|baseline-stale/);assert.deepStrictEqual(fleetSnapshot(env),afterExternal);assert.notDeepStrictEqual(afterExternal,before);assert.equal(adapter.telemetry().assetsApplied,0);
});

test('a worker baseline requires exact revision, current token, and collision proof',()=>{
  const changed=makeWorld('REVISION'),stale=Apply.computeBaseline(changed.state,changed.s.GH_FLEET_DATA,changed.plan,Plan),first=changed.s.GH_FLEET_DATA.viewAt(changed.state,0);changed.s.GH_FLEET_DATA.update(changed.state,first,{baseFacility:'B1'});
  assert.throws(()=>consume(Plan.applyStages(changed.plan,adapterFor(changed,{baseline:stale,current:()=>true,maxSynchronousBaselineRows:0}))),/baseline-revision-stale/);
  const missing=makeWorld('TOKEN'),exact=Apply.computeBaseline(missing.state,missing.s.GH_FLEET_DATA,missing.plan,Plan);
  assert.throws(()=>consume(Plan.applyStages(missing.plan,adapterFor(missing,{baseline:exact,maxSynchronousBaselineRows:0}))),/baseline-stale/);
  const collision=makeWorld('COLLISION');collision.s.GH_FLEET_DATA.add(collision.state,Plan.deliveredAsset(collision.plan,0,0));const blocked=Apply.computeBaseline(collision.state,collision.s.GH_FLEET_DATA,collision.plan,Plan),at=fleetSnapshot(collision);
  assert.equal(blocked.idsFree,false);assert.throws(()=>consume(Plan.applyStages(collision.plan,adapterFor(collision,{baseline:blocked,current:()=>true,maxSynchronousBaselineRows:0}))),/asset-purchase-id-collision/);assert.deepStrictEqual(fleetSnapshot(collision),at);
  const missingTokens=makeWorld('MISSING-TOKENS'),unguarded=Apply.computeBaseline(missingTokens.state,missingTokens.s.GH_FLEET_DATA,missingTokens.plan,Plan),target=missingTokens.s.GH_FLEET_DATA.viewAt(missingTokens.state,0);missingTokens.s.GH_FLEET_DATA.update(missingTokens.state,target,{id:Plan.assetId(missingTokens.plan,0,0)});unguarded.membershipRevision=null;unguarded.revision=null;
  assert.throws(()=>consume(Plan.applyStages(missingTokens.plan,adapterFor(missingTokens,{baseline:unguarded,current:()=>true,maxSynchronousBaselineRows:0}))),/baseline-token-missing/);assert.equal(missingTokens.s.GH_FLEET_DATA.idCollisions(missingTokens.state).duplicate,false);
});

test('worker baseline aggregate shape is fail-closed before the first mutation',()=>{
  const cases=[
    baseline=>{baseline.rows=0;},
    baseline=>{baseline.occupancy=[];},
    baseline=>{baseline.occupancy.push(clone(baseline.occupancy[0]));},
    baseline=>{baseline.ownerModeCounts.push(clone(baseline.ownerModeCounts[0]));},
    baseline=>{baseline.ownerModeCounts=[['air','air',baseline.fleetSize+1]];}
  ];
  for(let index=0;index<cases.length;index++){const env=makeWorld(`SHAPE-${index}`),baseline=clone(Apply.computeBaseline(env.state,env.s.GH_FLEET_DATA,env.plan,Plan)),before=fleetSnapshot(env);cases[index](baseline);assert.throws(()=>consume(Plan.applyStages(env.plan,adapterFor(env,{baseline,current:()=>true,maxSynchronousBaselineRows:0}))),/baseline-(?:row-count|occupancy|owner-mode)/);assert.deepStrictEqual(fleetSnapshot(env),before);}
});

test('revision lease rejects an ID collision or row update inserted between slices and rolls back',()=>{
  for(const kind of ['collision','update']){const env=makeWorld(`LEASE-${kind}`),baseline=Apply.computeBaseline(env.state,env.s.GH_FLEET_DATA,env.plan,Plan),before=fleetSnapshot(env),adapter=adapterFor(env,{baseline,current:()=>true,maxSynchronousBaselineRows:0}),steps=Plan.applyStages(env.plan,adapter,{budgetMs:.25,clock:(()=>{let n=0;return()=>++n;})()});let first;do{first=steps.next();assert.equal(first.done,false);}while(first.value?.phase!=='assets');
    if(kind==='collision')env.s.GH_FLEET_DATA.add(env.state,Plan.deliveredAsset(env.plan,1,10));else env.s.GH_FLEET_DATA.update(env.state,env.s.GH_FLEET_DATA.viewAt(env.state,0),{condition:77});
    assert.throws(()=>consume(steps),/asset-purchase-baseline-mutated/);const after=fleetSnapshot(env);delete before.store.revision;delete before.store.structure;delete after.store.revision;delete after.store.structure;assert.deepStrictEqual(after,before);assert.equal(env.s.GH_FLEET_DATA.idCollisions(env.state).duplicate,false);
  }
});

test('a fleet mutation during preparation is rejected as stale without rolling back the external write',()=>{
  const env=makeWorld('PREPARE-STALE'),baseline=Apply.computeBaseline(env.state,env.s.GH_FLEET_DATA,env.plan,Plan),adapter=adapterFor(env,{baseline,current:()=>true,maxSynchronousBaselineRows:0}),steps=Plan.applyStages(env.plan,adapter,{budgetMs:.25,clock:(()=>{let n=0;return()=>++n;})()}),first=steps.next();assert.equal(first.done,false);assert.equal(adapter.active(),false);const row=env.s.GH_FLEET_DATA.viewAt(env.state,0);env.s.GH_FLEET_DATA.update(env.state,row,{condition:61});const afterExternal=fleetSnapshot(env);
  assert.throws(()=>consume(steps),/asset-purchase-baseline-stale/);assert.deepStrictEqual(fleetSnapshot(env),afterExternal);assert.equal(adapter.telemetry().assetsApplied,0);assert.equal(adapter.telemetry().rollbacks,0);
});

test('final revision lease rejects a fleet write by a late hook',()=>{
  const env=makeWorld('LEASE-FINAL'),baseline=Apply.computeBaseline(env.state,env.s.GH_FLEET_DATA,env.plan,Plan),before=fleetSnapshot(env),adapter=adapterFor(env,{baseline,current:()=>true,maxSynchronousBaselineRows:0,finalize:()=>env.s.GH_FLEET_DATA.update(env.state,env.s.GH_FLEET_DATA.viewAt(env.state,0),{condition:66})});
  assert.throws(()=>consume(Plan.applyStages(env.plan,adapter)),/asset-purchase-baseline-mutated/);const after=fleetSnapshot(env);delete before.store.revision;delete before.store.structure;delete after.store.revision;delete after.store.structure;assert.deepStrictEqual(after,before);
});

test('Fleet Store journal rolls back a failure in the middle of the second batch',()=>{
  const env=makeWorld('ROLLBACK'),before=fleetSnapshot(env),base=adapterFor(env),failAt=env.plan.groups[0].qty+Math.floor(env.plan.groups[1].qty/2);let added=0;
  const failing={...base,addAsset(asset,meta){base.addAsset(asset,meta);if(added++===failAt)throw new Error('injected-apply-failure');}};
  assert.throws(()=>consume(Plan.applyStages(env.plan,failing,{budgetMs:.25,clock:(()=>{let value=0;return()=>++value;})()})),/injected-apply-failure/);
  const after=fleetSnapshot(env);assert.deepStrictEqual(after.assets,before.assets);assert.deepStrictEqual(after.labor,before.labor);assert.deepStrictEqual(after.crew,before.crew);assert.deepStrictEqual(after.sequences,before.sequences);assert.equal(after.store.length,before.store.length);assert.equal(after.store.live,before.store.live);assert.deepStrictEqual(after.store.values,before.store.values);assert.equal(after.store.rows,before.store.rows);assert.deepStrictEqual(after.store.extras,before.store.extras);assert(after.store.revision>before.store.revision,'rollback revisions remain monotonic');assert.equal(base.telemetry().rollbacks,1);
});

test('an unreserved Store growth is refused before mutation',()=>{
  const env=makeWorld('CAPACITY');env.s.GH_FLEET_STORE.trimCapacity(env.state.fleet);const before=fleetSnapshot(env),adapter=adapterFor(env);
  assert.throws(()=>consume(Plan.applyStages(env.plan,adapter)),/asset-purchase-capacity-reservation-required/);assert.deepStrictEqual(fleetSnapshot(env),before);assert.equal(adapter.telemetry().assetsApplied,0);
});

test('staged capacity reservation grows physical storage before apply and stays logically rollback-safe',()=>{
  const env=makeWorld('RESERVE');env.s.GH_FLEET_STORE.trimCapacity(env.state.fleet);const before=fleetSnapshot(env);let capacityStages=0,reservedCapacity=0,requiredCapacity=0;
  assert.throws(()=>env.s.GH_TRANSACTION_CORE.execute(env.state,{label:'asset-purchase-capacity-and-apply',apply:()=>{
    consume(Apply.reserveCapacityStages(env.state,env.plan,{fleetData:env.s.GH_FLEET_DATA,planCore:Plan,rowSlice:16,current:()=>true}),()=>capacityStages++);reservedCapacity=env.state.fleet.capacity;requiredCapacity=env.state.fleet.length+env.plan.count;
    consume(Plan.applyStages(env.plan,adapterFor(env),{budgetMs:.25,clock:(()=>{let value=0;return()=>++value;})()}));throw new Error('rollback-after-reserved-apply');
  }}),/rollback-after-reserved-apply/);
  const after=fleetSnapshot(env);delete before.store.capacity;delete before.store.revision;delete before.store.structure;delete after.store.capacity;delete after.store.revision;delete after.store.structure;assert.deepStrictEqual(after,before);assert(reservedCapacity>=requiredCapacity);assert(capacityStages>0);
});

test('a stale staged capacity reservation fails before plan mutation',()=>{
  const env=makeWorld('RESERVE-STALE'),before=fleetSnapshot(env),fake={...env.s.GH_FLEET_DATA,*reserveCapacityStages(){yield {stage:'copy'};return {stale:true,grown:false,capacity:env.state.fleet.capacity};}};
  assert.throws(()=>consume(Apply.reserveCapacityStages(env.state,env.plan,{fleetData:fake,planCore:Plan})),/capacity-reservation-stale/);assert.deepStrictEqual(fleetSnapshot(env),before);
});

test('a later outer-transaction failure still rolls back an already committed apply',()=>{
  const env=makeWorld('OUTER');env.state.sequences['fleetCore_EMP-AUTO']=2;env.state.sequences['fleetCore_HR-AUTO']=2;const before=fleetSnapshot(env);
  assert.throws(()=>env.s.GH_TRANSACTION_CORE.execute(env.state,{label:'asset-purchase-outer-rollback',apply:()=>{consume(Plan.applyStages(env.plan,adapterFor(env),{budgetMs:.25,clock:(()=>{let value=0;return()=>++value;})()}));throw new Error('injected-after-purchase-apply');}}),/injected-after-purchase-apply/);
  const after=fleetSnapshot(env),beforeCounters={revision:before.store.revision,structure:before.store.structure},afterCounters={revision:after.store.revision,structure:after.store.structure};delete before.store.revision;delete before.store.structure;delete after.store.revision;delete after.store.structure;
  assert.deepStrictEqual(after,before);assert(afterCounters.revision>beforeCounters.revision);assert(afterCounters.structure>beforeCounters.structure);
});

test('a caught failed apply poisons commit of its borrowed journal and rolls back all outer writes',()=>{
  const env=makeWorld('BORROWED'),before=fleetSnapshot(env),prior={...Plan.deliveredAsset(env.plan,0,0),id:'OUTER-PRIOR-00000001'};
  assert.throws(()=>env.s.GH_TRANSACTION_CORE.execute(env.state,{label:'asset-purchase-borrowed-journal',apply:()=>{
    env.s.GH_FLEET_DATA.add(env.state,prior);const base=adapterFor(env);let added=0,caught=null;
    const failing={...base,addAsset(asset,meta){base.addAsset(asset,meta);if(added++===2)throw new Error('injected-borrowed-failure');}};
    try{consume(Plan.applyStages(env.plan,failing));}catch(error){caught=error;}
    assert.match(String(caught?.message),/injected-borrowed-failure/);assert.equal(env.s.GH_FLEET_DATA.has(env.state,prior.id),true);assert(env.s.GH_FLEET_STORE.journalStats(env.state.fleet),'outer journal must remain active');return 'caller-tried-to-commit';
  }}),/asset-purchase-apply-session-failed:injected-borrowed-failure/);
  const after=fleetSnapshot(env);delete before.store.revision;delete before.store.structure;delete after.store.revision;delete after.store.structure;assert.deepStrictEqual(after,before);
});

test('transaction ownership is target-specific and rejects state B before any root mutation',()=>{
  const owner=makeWorld('OWNER-A'),other=makeWorld('OWNER-B'),before=fleetSnapshot(other);let caught;
  const out=owner.s.GH_TRANSACTION_CORE.execute(owner.state,{label:'asset-purchase-cross-state-owner',apply:()=>{try{consume(Plan.applyStages(other.plan,adapterFor(other,{transactionCore:owner.s.GH_TRANSACTION_CORE})));}catch(error){caught=error;}return 'outer-safe';}});
  assert.equal(out.committed,true);assert.equal(out.value,'outer-safe');assert.match(String(caught?.message),/asset-purchase-transaction-owner-mismatch/);assert.deepStrictEqual(fleetSnapshot(other),before);
});

test('a durable context rejects its live state and leaves fleet labor and receipts untouched',()=>{
  const env=makeWorld('DURABLE-LIVE'),before=fleetSnapshot(env),draft={};globalThis.__GH_DURABLE_COMMAND_CONTEXT__={liveState:env.state,draft};
  try{assert.throws(()=>consume(Plan.applyStages(env.plan,adapterFor(env))),/asset-purchase-durable-live-state-blocked/);}finally{delete globalThis.__GH_DURABLE_COMMAND_CONTEXT__;}
  assert.deepStrictEqual(fleetSnapshot(env),before);
});

test('critical guard registration failure occurs before fleet or business roots are changed',()=>{
  const env=makeWorld('GUARD-ORDER'),before=fleetSnapshot(env),laborRef=env.state.advanced.labor,procurementRef=env.state.realism.procurement;let caught,terminalRuns=0;
  const out=env.s.GH_TRANSACTION_CORE.execute(env.state,{label:'asset-purchase-guard-ordering',apply:()=>{env.s.GH_TRANSACTION_CORE.afterCommit(()=>{terminalRuns++;},{critical:true,irreversible:true,priority:0,owner:'terminal-test'});try{consume(Plan.applyStages(env.plan,adapterFor(env)));}catch(error){caught=error;}return 'no-purchase';}});
  assert.equal(out.committed,true);assert.equal(out.value,'no-purchase');assert.equal(terminalRuns,1);assert.match(String(caught?.message),/transaction-irreversible-ordering:critical-task-after-terminal/);assert.strictEqual(env.state.advanced.labor,laborRef);assert.strictEqual(env.state.realism.procurement,procurementRef);assert.deepStrictEqual(fleetSnapshot(env),before);
});

test('one adapter can commit two plans without carrying its revision lease across sessions',()=>{
  const env=makeWorld('REUSE'),first=env.plan,groups=first.groups.map((group,index)=>({...group,assetSequenceStart:group.assetSequenceStart+1000,serialStart:group.serialStart+1000,orderId:`REUSE-DEL-${index}`,requestRef:`REUSE-REQ-${index}`,contractId:`REUSE-EMP-${index}`,hiringId:`REUSE-HR-${index}`})),second=Plan.prepare({...first.common,contextToken:'purchase:REUSE-2',item:clone(first.item),groups}),adapter=adapterFor(env),before=env.s.GH_FLEET_DATA.size(env.state);
  env.s.GH_FLEET_STORE.ensureCapacity(env.state.fleet,before+first.count+second.count);consume(Plan.applyStages(first,adapter,{budgetMs:.25,clock:(()=>{let n=0;return()=>++n;})()}));consume(Plan.applyStages(second,adapter,{budgetMs:.25,clock:(()=>{let n=0;return()=>++n;})()}));
  assert.equal(env.s.GH_FLEET_DATA.size(env.state),before+first.count+second.count);assert.equal(adapter.telemetry().commits,2);assert.equal(adapter.telemetry().assetsApplied,first.count+second.count);
});

test('non-overlapping ranges remain valid when groups with one prefix arrive in reverse order',()=>{
  const env=makeWorld('REVERSE'),source=env.plan.groups,groups=[{...source[0],qty:3,assetSequenceStart:900,serialStart:900,orderId:'REV-HIGH',requestRef:'REV-HIGH',contractId:'REV-EMP-HIGH',hiringId:'REV-HR-HIGH'},{...source[1],qty:5,assetSequenceStart:300,serialStart:300,orderId:'REV-LOW',requestRef:'REV-LOW',contractId:'REV-EMP-LOW',hiringId:'REV-HR-LOW'}],plan=Plan.prepare({...env.plan.common,contextToken:'purchase:REVERSE-RANGE',item:clone(env.plan.item),groups}),adapter=adapterFor(env);env.s.GH_FLEET_STORE.ensureCapacity(env.state.fleet,env.state.fleet.length+plan.count);
  consume(Plan.applyStages(plan,adapter,{budgetMs:.25,clock:(()=>{let n=0;return()=>++n;})()}));assert.equal(env.s.GH_FLEET_DATA.has(env.state,Plan.assetId(plan,0,0)),true);assert.equal(env.s.GH_FLEET_DATA.has(env.state,Plan.assetId(plan,1,0)),true);
});

test('the local baseline scans planned IDs and does not trust a stale has index',()=>{
  const env=makeWorld('LOCAL-ID'),collision=Plan.deliveredAsset(env.plan,0,0);env.s.GH_FLEET_DATA.add(env.state,collision);const before=fleetSnapshot(env),real=env.s.GH_FLEET_DATA,staleHas={...real,has(){return false;}},adapter=adapterFor(env,{fleetData:staleHas});
  assert.throws(()=>consume(Plan.applyStages(env.plan,adapter)),/asset-purchase-id-collision/);assert.deepStrictEqual(fleetSnapshot(env),before);assert.equal(adapter.telemetry().assetsApplied,0);
});

test('an ID guard bound before payment remains exact when the final cheque changes plan metadata',()=>{
  const env=makeWorld('PREPAY-GUARD'),groups=env.plan.groups.map(group=>({...group,payment:{...group.payment,ref:'PENDING-CHEQUE',invoiceRef:'PENDING-INVOICE'}})),provisional=Plan.prepare({...env.plan.common,contextToken:env.plan.contextToken,item:clone(env.plan.item),groups}),baseline=Apply.computeBaseline(env.state,env.s.GH_FLEET_DATA,provisional,Plan),adapter=adapterFor(env,{baseline,current:()=>true,maxSynchronousBaselineRows:0});assert.notEqual(provisional.fingerprint,env.plan.fingerprint);assert.equal(baseline.idGuardFingerprint,Apply.plannedIdGuard(env.plan,Plan).fingerprint);
  consume(Plan.applyStages(env.plan,adapter,{budgetMs:.25,clock:(()=>{let n=0;return()=>++n;})()}));assert.equal(adapter.telemetry().assetsApplied,env.plan.count);
});

test('integral crew additions preserve staffing-class order at the safe-integer boundary',()=>{
  const reference=makeWorld('CREW-ROUND'),candidate=makeWorld('CREW-ROUND');
  for(const env of [reference,candidate]){const asset=env.s.GH_FLEET_DATA.viewAt(env.state,0),staffing=clone(asset.staffing);staffing.roles=staffing.roles.map(role=>role.id==='pilots'?{...role,count:Number.MAX_SAFE_INTEGER}:role);env.s.GH_FLEET_DATA.update(env.state,asset,{staffing});env.s.GH_FLEET_CORE.synchronizeCrew(env.state);}
  reference.s.GH_FLEET_CORE.recordDeliveryBatch(reference.state,reference.inputs);candidate.state.sequences['fleetCore_EMP-AUTO']=2;candidate.state.sequences['fleetCore_HR-AUTO']=2;consume(Plan.applyStages(candidate.plan,adapterFor(candidate),{budgetMs:.25,clock:(()=>{let n=0;return()=>++n;})()}));
  const expected=reference.state.crew.find(row=>row.id==='pilots').count,actual=candidate.state.crew.find(row=>row.id==='pilots').count;assert(Object.is(actual,expected),`${actual} !== ${expected}`);assert.deepStrictEqual(fleetSnapshot(candidate),fleetSnapshot(reference));
});

test('large group validation and labor publication stay staged and preserve existing ledger rows',()=>{
  const env=makeWorld('LARGE-LEDGER'),source=env.plan.groups[0],groups=Array.from({length:256},(_,index)=>({...source,qty:1,assetSequenceStart:2000+index,serialStart:2000+index,orderId:`LARGE-DEL-${index}`,requestRef:`LARGE-REQ-${index}`,contractId:`LARGE-EMP-${index}`,hiringId:`LARGE-HR-${index}`})),plan=Plan.prepare({...env.plan.common,contextToken:'purchase:LARGE-LEDGER',item:clone(env.plan.item),groups}),oldRows=Array.from({length:50000},(_,index)=>({id:`OLD-${index}`,marker:index}));let labor={employmentContracts:oldRows,hiringLog:Array.from({length:200},(_,index)=>({id:`OLD-HR-${index}`})),marker:'preserve'},laborPublishes=0,procurementReads=0;env.state.advanced.labor=labor;Object.defineProperty(env.state.advanced,'labor',{configurable:true,get:()=>labor,set:value=>{laborPublishes++;labor=value;}});Object.defineProperty(env.state.realism,'procurement',{configurable:true,get:()=>{procurementReads++;throw new Error('manageReceipts-false-read');}});env.s.GH_FLEET_STORE.ensureCapacity(env.state.fleet,env.state.fleet.length+plan.count);const adapter=adapterFor(env,{maxSynchronousGroups:64}),phases=[];
  consume(Plan.applyStages(plan,adapter,{budgetMs:4,clock:(()=>{let n=0;return()=>++n;})()}),stage=>phases.push(stage?.phase));assert(phases.includes('validate-groups'));assert(phases.includes('labor-contracts'));assert(adapter.telemetry().prepareYields>0);assert(adapter.telemetry().finishYields>0);assert.equal(laborPublishes,1);assert.equal(procurementReads,0);assert.strictEqual(labor.employmentContracts[groups.length+123],oldRows[123]);assert.equal(labor.employmentContracts.length,oldRows.length+groups.length);
});

test('a large receipt ledger is indexed and reordered in bounded stages',()=>{
  const env=makeWorld('RECEIPT-STAGES'),existing=env.state.realism.procurement.deliveries;for(let index=0;index<5000;index++)existing.unshift({id:`ARCHIVE-${index}`,status:'delivered',baseId:'B1',count:1,payment:{ref:`OLD-${index}`}});const adapter=adapterFor(env,{manageReceipts:true,transitionReceipt:delivery=>{delivery.lifecycleRevision=(Number(delivery.lifecycleRevision)||0)+1;return true;}}),phases=[];
  env.s.GH_TRANSACTION_CORE.execute(env.state,{label:'asset-purchase-receipt-stages',apply:()=>consume(Plan.applyStages(env.plan,adapter,{budgetMs:4,clock:(()=>{let n=0;return()=>++n;})()}),stage=>phases.push(stage?.phase))});assert(phases.includes('delivery-index'));assert(phases.includes('delivery-ledger'));assert(adapter.telemetry().prepareYields>0);assert(adapter.telemetry().finishYields>0);assert.equal(env.state.realism.procurement.deliveries.filter(row=>row.status==='pending').length,0);
});

if(results.some(row=>!row.ok)){console.error(JSON.stringify({suite:'build372-asset-purchase-apply',results},null,2));process.exitCode=1;}else console.log(JSON.stringify({suite:'build372-asset-purchase-apply',scope:'Fleet Store journal adapter, one occupancy/crew baseline, differential multi-batch delivery, worker baseline and rollback',passed:results.length,total:results.length,results},null,2));
