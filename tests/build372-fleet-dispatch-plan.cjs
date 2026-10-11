'use strict';
// A dispatch plan is computed with the existing Fleet Core on a worker-style replica, restores that replica byte for
// byte, and replays only fixed-width row bytes in bounded stages. Its committed state must equal the former
// assign -> normalize -> load/depart path, while stale plans and partial replays must never publish.
const assert=require('node:assert/strict'),path=require('node:path'),{createHash}=require('node:crypto');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');process.env.GH_TEST_SOURCE_DIR=ROOT;
const {harness,minimal}=require('./helpers/core-harness');
const {s}=harness(['simulation-asset-core','route-core','fleet-core','fleet-dispatch-core']);
const STORE=s.GH_FLEET_STORE,DATA=s.GH_FLEET_DATA,FLEET=s.GH_FLEET_CORE,SIM=s.GH_SIMULATION_ASSET_CORE,DISPATCH=s.GH_FLEET_DISPATCH_CORE;

const ROUTES=10,COUNT=720,TARGETS=137,routes=[];
for(let index=0;index<ROUTES;index++){
  const lat=-54+index*11,lon=-150+(index%2)*85;
  routes.push({id:`DISPATCH-ROUTE-${index}`,type:'air',routeMode:'air',company:'air',ownerCompanyId:'air',name:`Route ${index}`,from:`Origin ${index}`,to:`Destination ${index}`,fromFacility:`BASE-${index}`,toFacility:`END-${index}`,route:[[lat,lon],[lat+3,lon+4+index*.03]],distanceKm:500+index*17,maxLegKm:500+index*17,effectiveSpeedKmh:790-index,tripSeconds:2400+index*31,dwellHours:1.25,fleetCapacity:128});
}
const catalogSpecs={capacity:186,capacityUnit:'راكب',speedKmh:845,rangeKm:7500,market:'air-pax',crewPlan:{pilots:10,cabin:16,aeng:4}};
const assets=Array.from({length:COUNT},(_,index)=>{
  const route=routes[index%ROUTES],target=index<TARGETS,same=target&&index%3===0,hasSpecs=index%11!==0;
  return {id:`DISPATCH-ASSET-${String(index).padStart(5,'0')}`,name:`Aircraft ${index}`,type:'air',assetMode:'air',assetClass:'aircraft',ownerCompanyId:'air',companyId:'air',catalogId:'CAT-AIR',baseFacility:route.fromFacility,phase:same||!target?'turnaround':'idle',progress:index%7?0:undefined,fuel:index%13?81:undefined,condition:index%17?94:undefined,routeId:same||!target?route.id:null,routeSlot:same?80+Math.floor(index/ROUTES):!target?Math.floor(index/ROUTES):null,departureScheduled:false,releaseExclusiveRouteOnArrival:index%29===0,staffing:{mode:'automatic-fixed',ready:true,roles:[],total:8,monthlyPayroll:1},...(hasSpecs?{specs:structuredClone(catalogSpecs)}:{})};
});
const routeTable=Object.fromEntries(routes.map((route,index)=>[`route-${index}`,route]));
const assignments=assets.slice(0,TARGETS).map((asset,index)=>({id:asset.id,routeId:routes[index%ROUTES].id,routeRef:`route-${index%ROUTES}`,baseFacility:routes[index%ROUTES].fromFacility,phase:'turnaround'}));
const context={routesRevision:73,simSeconds:543210,catalogRevision:'c'.repeat(64),ownershipRevision:'d'.repeat(64),requestKey:'dispatch:test:137'};
const input={assignments,routes:routeTable,registeredRoutes:routes,catalogSpecs:{air:{'CAT-AIR':catalogSpecs}},context};
function build(){const state={...minimal(),simSeconds:context.simSeconds,routesRevision:context.routesRevision,customRoutes:structuredClone(routes)};state.fleet=STORE.fromAssets(structuredClone(assets),{at:state.simSeconds});delete state.assets;return state;}
const exportStore=state=>STORE.exportReplica(state.fleet),bytes=buffer=>Buffer.from(new Uint8Array(buffer));
const sha256=text=>createHash('sha256').update(String(text)).digest('hex');
const finish=stages=>{let next;do next=stages.next();while(!next.done);return next.value;};
function assertReplicaContent(actual,expected,label,{revision=true}={}){
  assert.equal(actual.length,expected.length,`${label}:length`);assert.equal(actual.live,expected.live,`${label}:live`);assert.equal(actual.structure,expected.structure,`${label}:structure`);if(revision)assert.equal(actual.revision,expected.revision,`${label}:revision`);
  assert.deepEqual(actual.values,expected.values,`${label}:values`);assert.deepEqual(actual.extras,expected.extras,`${label}:extras`);assert.deepEqual(bytes(actual.rows),bytes(expected.rows),`${label}:rows`);
}
function reference(state){
  FLEET.assignRoutesBatch(state,structuredClone(assignments),routeTable);
  const drafts=assignments.map(row=>DATA.draft(state,row.id));for(let index=0;index<drafts.length;index++)FLEET.normalizeAsset(drafts[index],{route:routeTable[assignments[index].routeRef],catalogItem:{specs:catalogSpecs}});DATA.commit(state,drafts);
  const views=assignments.map(row=>DATA.get(state,row.id)),loads=SIM.loadLabels(views),departures=views.map((asset,index)=>({id:asset.id,routeRef:assignments[index].routeRef,load:loads[index],delaySeconds:FLEET.departureDelay(asset)}));FLEET.departBatch(state,departures,routeTable);
  return {count:views.length,routeIds:[...new Set(assignments.map(row=>row.routeId))],moving:views.filter(row=>DATA.get(state,row.id).phase==='moving').length,scheduled:views.filter(row=>DATA.get(state,row.id).departureScheduled).length,inUseRouteIds:[...DATA.distinctRefs(state,'routeId')]};
}

// Planning has no observable write on its source replica.
const candidate=build(),beforePlan=exportStore(candidate),plan=DISPATCH.compute(candidate,input),afterPlan=exportStore(candidate);
assertReplicaContent(afterPlan,beforePlan,'speculative-restore');
assert.equal(plan.count,TARGETS);assert.equal(plan.indices.length,TARGETS);assert.equal(plan.bytes.byteLength,TARGETS*STORE.STRIDE);assert.ok(plan.revisionDelta>TARGETS);assert.ok(plan.values.length>0);

// Staged replay is bit-identical to the old public owner path, including interned refs and the exact revision delta.
const expected=build(),expectedSummary=reference(expected),journal=STORE.beginJournal(candidate.fleet),stages=DISPATCH.applyStages(candidate,plan,input,{rowsPerStage:17});let step,yields=0;do{step=stages.next();if(!step.done)yields++;}while(!step.done);STORE.endJournal(journal);
assert.deepEqual(step.value,expectedSummary);assert.ok(yields>=Math.ceil(TARGETS/17)-1,'large replay yields between bounded row groups');assertReplicaContent(exportStore(candidate),exportStore(expected),'committed-parity');

// A failure after the first applied slice rolls every row and every newly interned value back.
const rollback=build(),rollbackPlan=DISPATCH.compute(rollback,input),rollbackBefore=exportStore(rollback),rollbackJournal=STORE.beginJournal(rollback.fleet),rollbackStages=DISPATCH.applyStages(rollback,rollbackPlan,input,{rowsPerStage:13});let applied=false;
for(;;){const next=rollbackStages.next();if(next.done)break;if(next.value?.stage==='fleet.dispatch.apply'){applied=true;break;}}
assert.equal(applied,true);STORE.rollbackJournal(rollbackJournal);assertReplicaContent(exportStore(rollback),rollbackBefore,'partial-rollback',{revision:false});

// Fleet or route/catalog/request context changes are rejected before the first plan write.
const stale=build(),stalePlan=DISPATCH.compute(stale,input),staleJournal=STORE.beginJournal(stale.fleet);STORE.set(stale.fleet,COUNT-1,'condition',77);assert.throws(()=>DISPATCH.applyStages(stale,stalePlan,input).next(),/fleet-dispatch-plan-stale:revision/);STORE.rollbackJournal(staleJournal);
const contextStale=build(),contextPlan=DISPATCH.compute(contextStale,input),contextJournal=STORE.beginJournal(contextStale.fleet),changedInput={...input,context:{...context,catalogRevision:'e'.repeat(64)}};assert.throws(()=>DISPATCH.applyStages(contextStale,contextPlan,changedInput).next(),/fleet-dispatch-plan-stale:context/);STORE.rollbackJournal(contextJournal);

// The worker path asks Fleet Core for no materialized rows; the public API still returns its historical complete rows.
const resultModes=build(),noResultJournal=STORE.beginJournal(resultModes.fleet);assert.equal(FLEET.assignRoutesBatch(resultModes,assignments.slice(0,2),routeTable,{noResult:true}),null);STORE.rollbackJournal(noResultJournal);
const publicState=build(),publicRows=FLEET.assignRoutesBatch(publicState,assignments.slice(0,2),routeTable);assert.equal(publicRows.length,2);assert.ok(publicRows[0].staffing&&publicRows[1].specs&&Object.keys(publicRows[0]).length>12);

// The durable command signs one compact legal intent.  Its payload is bound to the same request/context as the worker
// plan, while the binary replay stays out of the authorization record and idempotency ledger.
s.GH_COMPANY_PLATFORM={requireCompany:(_state,id)=>id==='air'?{id,definition:{classification:{routeModes:['air'],assetClasses:['aircraft']}}}:null,getRouteModes:(_state,id)=>id==='air'?['air']:[],assetClassForLegacyMode:mode=>mode==='air'?'aircraft':null};
const sealedDigests=finish(DISPATCH.digestStages(plan,input,{chunkSize:17,digest:sha256}));
const intent={schema:FLEET.DISPATCH_INTENT_SCHEMA,companyId:'air',mode:'air',count:TARGETS,requestKey:context.requestKey,routesRevision:context.routesRevision,simSeconds:context.simSeconds,catalogRevision:context.catalogRevision,ownershipRevision:context.ownershipRevision,assignmentDigest:sealedDigests.assignmentDigest,planDigest:sealedDigests.planDigest,routeIds:plan.summary.routeIds};
assert.equal(FLEET.validate({state:candidate},'dispatch-plan-intent',intent),true);assert.equal(JSON.stringify(FLEET.execute({state:candidate},'dispatch-plan-intent',intent)),JSON.stringify(intent));
assert.equal(FLEET.validate({state:candidate},'dispatch-plan-intent',{...intent,simSeconds:intent.simSeconds+1}).reason,'fleet-dispatch-intent-context');

// Both cryptographic roots are signed before replay.  Swapping one logical asset-to-route mapping, or flipping one
// binary plan byte afterwards, is rejected during the read-only validation stages; no value or row has been written.
for(const mutation of ['assignment','byte']){
  const target=build(),targetPlan=DISPATCH.compute(target,input),targetInput=structuredClone(input),seal=finish(DISPATCH.digestStages(targetPlan,targetInput,{chunkSize:17,digest:sha256})),before=exportStore(target),journal=STORE.beginJournal(target.fleet);
  if(mutation==='assignment')targetInput.assignments[0]={...targetInput.assignments[0],routeId:routes[1].id,routeRef:'route-1'};else new Uint8Array(targetPlan.bytes)[0]^=1;
  let rejected=false;try{finish(DISPATCH.applyStages(target,targetPlan,targetInput,{rowsPerStage:17,digestManifest:seal,assignmentDigest:seal.assignmentDigest,planDigest:seal.planDigest,digest:sha256}));}catch(error){rejected=/fleet-dispatch-digest-(?:row|root)-mismatch/.test(String(error?.message||error));}
  assert.equal(rejected,true,`${mutation}: post-intent mutation rejected`);assertReplicaContent(exportStore(target),before,`${mutation}-no-write`);STORE.rollbackJournal(journal);
}

console.log(JSON.stringify({suite:'build372-fleet-dispatch-plan',assets:COUNT,targets:TARGETS,planBytes:plan.bytes.byteLength,valueChanges:plan.values.length,revisionDelta:plan.revisionDelta,yields}));
console.log('BUILD372_FLEET_DISPATCH_PLAN_PASS');
