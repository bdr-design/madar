// Build 372: a shared-network dispatch used to execute forty assignment commands and forty departure commands for a
// 20,000-asset page. Every command rescanned all routed rows, materialized its result and ran on the UI thread. This
// owner computes the exact existing Fleet Core writes speculatively on the fleet worker, returns only a binary row diff,
// then replays that diff in small journaled stages. The speculative pass restores the worker replica before returning;
// the main-side replay refuses a stale fleet, route/catalog context, or request before its first write.
(()=>{
  'use strict';
  const VERSION='1.0.0',SCHEMA='gh-fleet-dispatch-plan-v1',DIGEST_SCHEMA='gh-fleet-dispatch-digest-v1',DEFAULT_ROWS_PER_STAGE=32;
  const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
  const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
  const clone=value=>value===undefined?undefined:(globalThis.structuredClone?structuredClone(value):JSON.parse(JSON.stringify(value)));
  const stable=value=>{
    // `extras` is a sparse side table: an absent extra is represented by an actual undefined array slot.  Keep that
    // value distinct from null in the signed plan instead of silently dropping it or making ordinary rows undigestible.
    if(value===undefined)return'undefined';
    if(value===null)return'null';
    if(typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
    if(typeof value==='number'){if(!Number.isFinite(value))throw new Error('fleet-dispatch-context-non-finite');return Object.is(value,-0)?'0':JSON.stringify(value);}
    if(Array.isArray(value)){const rows=new Array(value.length);for(let index=0;index<value.length;index++)rows[index]=own(value,index)?stable(value[index]):'hole';return`[${rows.join(',')}]`;}
    if(object(value))return`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
    throw new Error('fleet-dispatch-context-invalid');
  };
  function dependencies(){
    const store=globalThis.GH_FLEET_STORE||(typeof require==='function'?require('./fleet-store-core.js'):null),fleet=globalThis.GH_FLEET_CORE||(typeof require==='function'?require('./fleet-core.js'):null),access=globalThis.GH_FLEET_DATA||(typeof require==='function'?require('./fleet-access-core.js'):null),simulation=globalThis.GH_SIMULATION_ASSET_CORE||(typeof require==='function'?require('./simulation-asset-core.js'):null);
    if(!store||!fleet||!access||!simulation)throw new Error('fleet-dispatch-owner-unavailable');return {store,fleet,access,simulation};
  }
  function contextOf(input){
    const context=input?.context;if(!object(context))throw new Error('fleet-dispatch-context-required');
    const routesRevision=Number(context.routesRevision),simSeconds=Number(context.simSeconds);
    if(!Number.isSafeInteger(routesRevision)||routesRevision<0||!Number.isFinite(simSeconds)||typeof context.catalogRevision!=='string'||!context.catalogRevision||typeof context.ownershipRevision!=='string'||!context.ownershipRevision||typeof context.requestKey!=='string'||!context.requestKey)throw new Error('fleet-dispatch-context-invalid');
    return {routesRevision,simSeconds,catalogRevision:context.catalogRevision,ownershipRevision:context.ownershipRevision,requestKey:context.requestKey};
  }
  function tagOf(state,access,store){return {revision:Number(store.revision)||0,structure:Number(store.structure)||0,length:Number(store.length)||0,valuesLength:store.values.length,simSeconds:Number(state?.simSeconds)||0};}
  function sameTag(actual,expected){for(const key of ['revision','structure','length','valuesLength','simSeconds'])if(!Object.is(actual[key],expected?.[key]))return key;return '';}
  function ownershipAdapter(policy){
    if(!object(policy))return null;
    const definitions=object(policy.definitions)?policy.definitions:{},assetOwners=object(policy.assetOwners)?policy.assetOwners:{},routeOwners=object(policy.routeOwners)?policy.routeOwners:{},assetClasses=object(policy.assetClasses)?policy.assetClasses:{};
    const definition=id=>definitions[String(id)]||null;
    return {
      getDefinition:id=>definition(id),
      definitionFor:(_state,id)=>definition(id),
      ownerForLegacyAssetMode:mode=>assetOwners[String(mode)]||'',
      ownerForLegacyRouteMode:mode=>routeOwners[String(mode)]||'',
      assetClassForLegacyMode:mode=>assetClasses[String(mode)]||'',
      isKnownRouteMode:mode=>Object.values(definitions).some(row=>row?.classification?.routeModes?.includes(String(mode))),
      requireCompany(_state,id,options={}){const row=definition(id);if(!row)throw new Error(`company-unknown:${String(id)}`);if(options.operational!==false&&row.operational===false)throw new Error(`company-not-operational:${String(id)}`);if(options.capability&&!row.capabilities?.includes(options.capability))throw new Error(`company-capability-missing:${String(id)}:${String(options.capability)}`);return {id:String(id),definition:row};}
    };
  }
  function withOwnership(policy,fn){
    const adapter=ownershipAdapter(policy);if(!adapter)return fn();
    const had=own(globalThis,'GH_COMPANY_PLATFORM'),previous=globalThis.GH_COMPANY_PLATFORM;globalThis.GH_COMPANY_PLATFORM=adapter;
    try{return fn();}finally{if(had)globalThis.GH_COMPANY_PLATFORM=previous;else delete globalThis.GH_COMPANY_PLATFORM;}
  }
  function catalogSpecs(input,asset){
    const catalogs=input?.catalogSpecs;if(!object(catalogs))return null;const type=String(asset?.type||asset?.assetMode||''),id=String(asset?.catalogId||'');
    const byType=catalogs[type];if(object(byType)&&object(byType[id]))return byType[id];const direct=catalogs[`${type}\u0000${id}`];return object(direct)?direct:null;
  }
  function requestHeader(input){
    const assignments=input?.assignments,routes=input?.routes;if(!Array.isArray(assignments)||!assignments.length||!object(routes))throw new Error('fleet-dispatch-request-invalid');
    return assignments;
  }
  function validateRequest(input){
    const assignments=requestHeader(input),routes=input.routes;
    const ids=new Set();for(const row of assignments){if(!object(row)||typeof row.id!=='string'||!row.id||typeof row.routeId!=='string'||!row.routeId||typeof row.routeRef!=='string'||!own(routes,row.routeRef)||ids.has(row.id))throw new Error('fleet-dispatch-request-invalid');ids.add(row.id);const route=routes[row.routeRef];if(!object(route)||route.id!==row.routeId)throw new Error('fleet-dispatch-route-ref-invalid');}
    return assignments;
  }
  function captureValues(store,journal,sourceLength){
    const refs=[],seen=new Set();for(const ref of journal.reused){if(ref>0&&!seen.has(ref)){seen.add(ref);refs.push(ref);}}
    for(let ref=sourceLength;ref<store.values.length;ref++)if(!seen.has(ref)){seen.add(ref);refs.push(ref);}
    return refs.map(ref=>[ref,clone(store.values[ref]??null)]);
  }
  function compute(state,input={}){
    const {store:STORE,fleet:FLEET,access:ACCESS,simulation:SIM}=dependencies(),recordStore=ACCESS.storeOf(state),assignments=validateRequest(input),context=contextOf(input);
    if(!recordStore)throw new Error('fleet-dispatch-store-required');if(STORE.journalStats(recordStore))throw new Error('fleet-dispatch-plan-worker-journal-active');if(!Object.is(Number(state?.simSeconds)||0,context.simSeconds))throw new Error('fleet-dispatch-context-sim-time');
    const sourceTag=tagOf(state,ACCESS,recordStore),registeredRoutes=Array.isArray(input.registeredRoutes)?input.registeredRoutes:[],requestIds=assignments.map(row=>row.id),indices=new Int32Array(assignments.length);
    for(let k=0;k<requestIds.length;k++){const index=ACCESS.indexOf(state,requestIds[k]);if(index<0)throw new Error(`fleet-dispatch-asset-missing:${requestIds[k]}`);indices[k]=index;}
    const uniqueRows=new Set(indices);if(uniqueRows.size!==indices.length)throw new Error('fleet-dispatch-request-duplicate-row');
    const previousRoutes=state.customRoutes,previousRouteRevision=state.routesRevision,previousSim=state.simSeconds;
    let plan=null;
    withOwnership(input.ownership,()=>STORE.withoutDirtyLog(recordStore,()=>{
      const journal=STORE.beginJournal(recordStore),staticBefore=STORE.staticSnapshot(recordStore);let mutated=false;
      try{
        state.customRoutes=registeredRoutes;state.routesRevision=context.routesRevision;state.simSeconds=context.simSeconds;
        FLEET.assignRoutesBatch(state,assignments,input.routes,{noResult:true});mutated=true;
        const normalized=[];
        for(const row of assignments){const asset=ACCESS.draft(state,row.id),route=input.routes[row.routeRef];if(!asset)throw new Error(`fleet-dispatch-asset-missing:${row.id}`);const specs=catalogSpecs(input,asset);FLEET.normalizeAsset(asset,{route,catalogItem:specs?{specs}:null});normalized.push(asset);}
        ACCESS.commit(state,normalized);
        const views=requestIds.map(id=>ACCESS.get(state,id)),loads=SIM.loadLabels(views),departures=views.map((asset,index)=>({id:asset.id,routeRef:assignments[index].routeRef,load:loads[index],delaySeconds:FLEET.departureDelay(asset)}));
        FLEET.departBatch(state,departures,input.routes,{noResult:true});
        const rows=STORE.readRows(recordStore,indices),routeIds=[...new Set(assignments.map(row=>row.routeId))],finalViews=requestIds.map(id=>ACCESS.get(state,id)),scheduled=finalViews.reduce((sum,row)=>sum+(row?.departureScheduled===true?1:0),0),moving=finalViews.reduce((sum,row)=>sum+(row?.phase==='moving'?1:0),0);
        // Route retirement used to call distinctRefs() on the UI thread after every automatic dispatch. Capture the
        // compact route set while this speculative worker already owns the resulting fleet; the main side only tests
        // the handful of previous routes against this set.
        const inUseRouteIds=[...ACCESS.distinctRefs(state,'routeId')];
        plan={schema:SCHEMA,version:VERSION,tag:sourceTag,context:clone(context),count:assignments.length,indices,bytes:rows.bytes,extras:rows.extras,valuesLength:recordStore.values.length,values:captureValues(recordStore,journal,sourceTag.valuesLength),revisionDelta:recordStore.revision-sourceTag.revision,staticRows:STORE.staticChunksSince(recordStore,staticBefore),summary:{count:assignments.length,routeIds,moving,scheduled,inUseRouteIds}};
      }finally{
        if(journal.active)STORE.rollbackJournal(journal);
        // A speculative worker pass is not a committed store history. Rollback restores every byte/value and invalidates
        // affected caches conservatively; restore the replica counters so its next exact-tag check still matches main.
        recordStore.revision=sourceTag.revision;recordStore.structure=sourceTag.structure;state.customRoutes=previousRoutes;state.routesRevision=previousRouteRevision;state.simSeconds=previousSim;
      }
      if(!mutated||!plan)throw new Error('fleet-dispatch-plan-empty');
    }));
    return plan;
  }
  function validatePlan(plan,input,state,ACCESS,STORE){
    if(!object(plan)||plan.schema!==SCHEMA||plan.version!==VERSION||!(plan.indices instanceof Int32Array)||!(plan.bytes instanceof ArrayBuffer)||!Array.isArray(plan.extras)||!Array.isArray(plan.values)||!object(plan.tag)||!object(plan.context))throw new Error('fleet-dispatch-plan-invalid');
    const assignments=requestHeader(input),context=contextOf(input),recordStore=ACCESS.storeOf(state);if(!recordStore)throw new Error('fleet-dispatch-store-required');
    if(plan.count!==assignments.length||plan.indices.length!==plan.count||plan.extras.length!==plan.count||plan.bytes.byteLength!==plan.count*STORE.STRIDE)throw new Error('fleet-dispatch-plan-shape');
    const chunks=Math.ceil(recordStore.length/STORE.CHUNK_ROWS),staticRows=plan.staticRows;
    if(!object(staticRows))throw new Error('fleet-dispatch-plan-static-rows');
    for(const tier of ['static','identity','routed']){
      const list=staticRows[tier];if(!Array.isArray(list))throw new Error('fleet-dispatch-plan-static-rows');let previous=-1;
      for(const raw of list){const chunk=Number(raw);if(!Number.isSafeInteger(chunk)||chunk<0||chunk>=chunks||chunk<=previous)throw new Error('fleet-dispatch-plan-static-rows');previous=chunk;}
    }
    const stale=sameTag(tagOf(state,ACCESS,recordStore),plan.tag);if(stale)throw new Error(`fleet-dispatch-plan-stale:${stale}`);if(stable(context)!==stable(plan.context))throw new Error('fleet-dispatch-plan-stale:context');
    if(Number(state.routesRevision)!==context.routesRevision||!Object.is(Number(state.simSeconds)||0,context.simSeconds))throw new Error('fleet-dispatch-plan-stale:state-context');
    if(!STORE.journalStats(recordStore))throw new Error('fleet-dispatch-plan-journal-required');
    return {assignments,recordStore};
  }
  const digestText=(digest,value)=>{if(typeof digest!=='function')throw new Error('fleet-dispatch-digest-owner-required');const out=String(digest(stable(value))||'').toLowerCase();if(!/^[0-9a-f]{64}$/.test(out))throw new Error('fleet-dispatch-digest-invalid');return out;};
  const assignmentRow=row=>({id:String(row?.id||''),routeId:String(row?.routeId||''),routeRef:String(row?.routeRef||''),baseFacility:row?.baseFacility==null?null:String(row.baseFacility),phase:row?.phase==null?null:String(row.phase)});
  function bytesHex(buffer,from,to){const bytes=new Uint8Array(buffer,from,to-from),parts=new Array(bytes.length);for(let index=0;index<bytes.length;index++)parts[index]=bytes[index].toString(16).padStart(2,'0');return parts.join('');}
  function planMetadata(plan){return {schema:plan.schema,version:plan.version,tag:plan.tag,context:plan.context,count:plan.count,valuesLength:plan.valuesLength,revisionDelta:plan.revisionDelta,staticRows:plan.staticRows,summary:plan.summary};}
  function assignmentChunk(assignments,from,to){return {from,to,rows:assignments.slice(from,to).map(assignmentRow)};}
  function planChunk(plan,from,to,stride){return {from,to,indices:Array.from(plan.indices.subarray(from,to)),bytes:bytesHex(plan.bytes,from*stride,to*stride),extras:plan.extras.slice(from,to)};}
  function valueChunk(plan,from,to){return {from,to,values:plan.values.slice(from,to)};}
  // A Merkle-style manifest keeps every SHA-256 call small.  The caller drives this generator with a frame budget;
  // applyStages re-hashes all leaves and both roots before interning a value or writing a row, so a changed assignment,
  // byte, extra, value, counter, static tier or summary is rejected before the first mutation.
  function* digestStages(plan,input={},options={}){
    const {store:STORE}=dependencies(),assignments=requestHeader(input),chunkSize=Math.max(1,Math.min(512,Math.floor(Number(options.chunkSize)||DEFAULT_ROWS_PER_STAGE))),digest=options.digest;
    if(!object(plan)||plan.schema!==SCHEMA||plan.version!==VERSION||!(plan.indices instanceof Int32Array)||!(plan.bytes instanceof ArrayBuffer)||!Array.isArray(plan.extras)||!Array.isArray(plan.values)||plan.count!==assignments.length||plan.indices.length!==plan.count||plan.extras.length!==plan.count||plan.bytes.byteLength!==plan.count*STORE.STRIDE)throw new Error('fleet-dispatch-digest-plan-invalid');
    const assignmentChunks=[],planChunks=[],valueChunks=[];
    for(let from=0;from<plan.count;from+=chunkSize){const to=Math.min(plan.count,from+chunkSize);assignmentChunks.push(digestText(digest,assignmentChunk(assignments,from,to)));planChunks.push(digestText(digest,planChunk(plan,from,to,STORE.STRIDE)));if(to<plan.count)yield {stage:'fleet.dispatch.digest-rows',done:to,total:plan.count};}
    for(let from=0;from<plan.values.length;from+=chunkSize){const to=Math.min(plan.values.length,from+chunkSize);valueChunks.push(digestText(digest,valueChunk(plan,from,to)));if(to<plan.values.length)yield {stage:'fleet.dispatch.digest-values',done:to,total:plan.values.length};}
    const metadataDigest=digestText(digest,planMetadata(plan)),assignmentDigest=digestText(digest,{schema:DIGEST_SCHEMA,kind:'assignments',count:plan.count,chunks:assignmentChunks}),planDigest=digestText(digest,{schema:DIGEST_SCHEMA,kind:'plan',count:plan.count,metadataDigest,planChunks,valueChunks});
    return {schema:DIGEST_SCHEMA,chunkSize,assignmentChunks,planChunks,valueChunks,metadataDigest,assignmentDigest,planDigest};
  }
  function* applyStages(state,plan,input={},options={}){
    const {store:STORE,access:ACCESS}=dependencies(),{assignments,recordStore}=validatePlan(plan,input,state,ACCESS,STORE),seal=options.digestManifest||null,rowsPerStage=Math.max(1,Math.min(512,Math.floor(Number(options.rowsPerStage)||seal?.chunkSize||DEFAULT_ROWS_PER_STAGE))),seenRows=new Set(),seenIds=new Set(),seenRefs=new Set(),verifiedAssignments=[],verifiedPlan=[],verifiedValues=[];
    if(seal){
      const assignmentDigest=String(options.assignmentDigest||'').toLowerCase(),planDigest=String(options.planDigest||'').toLowerCase();
      if(seal.schema!==DIGEST_SCHEMA||seal.chunkSize!==rowsPerStage||seal.assignmentDigest!==assignmentDigest||seal.planDigest!==planDigest||!Array.isArray(seal.assignmentChunks)||!Array.isArray(seal.planChunks)||!Array.isArray(seal.valueChunks))throw new Error('fleet-dispatch-digest-seal-invalid');
    }
    // Validate every target and every value reference before the first mutation. The plan is accepted only against the
    // same row membership and value table on which the worker computed it.
    for(let from=0,chunk=0;from<plan.count;from+=rowsPerStage,chunk++){const to=Math.min(plan.count,from+rowsPerStage);for(let k=from;k<to;k++){const row=assignments[k],index=plan.indices[k],id=row?.id;if(!object(row)||typeof id!=='string'||!id||typeof row.routeId!=='string'||!row.routeId||typeof row.routeRef!=='string'||!own(input.routes,row.routeRef)||input.routes[row.routeRef]?.id!==row.routeId||seenIds.has(id)||!(index>=0&&index<recordStore.length)||seenRows.has(index)||STORE.idAt(recordStore,index)!==id)throw new Error(`fleet-dispatch-plan-row-mismatch:${k}`);seenIds.add(id);seenRows.add(index);}if(seal){const assignmentHash=digestText(options.digest,assignmentChunk(assignments,from,to)),planHash=digestText(options.digest,planChunk(plan,from,to,STORE.STRIDE));if(assignmentHash!==seal.assignmentChunks[chunk]||planHash!==seal.planChunks[chunk])throw new Error('fleet-dispatch-digest-row-mismatch');verifiedAssignments.push(assignmentHash);verifiedPlan.push(planHash);}if(to<plan.count)yield {stage:'fleet.dispatch.validate',done:to,total:plan.count};}
    for(let from=0,chunk=0;from<plan.values.length;from+=rowsPerStage,chunk++){const to=Math.min(plan.values.length,from+rowsPerStage);for(let k=from;k<to;k++){const row=plan.values[k];if(!Array.isArray(row)||row.length!==2||!Number.isSafeInteger(row[0])||row[0]<=0||seenRefs.has(row[0]))throw new Error('fleet-dispatch-plan-value-invalid');seenRefs.add(row[0]);}if(seal){const valueHash=digestText(options.digest,valueChunk(plan,from,to));if(valueHash!==seal.valueChunks[chunk])throw new Error('fleet-dispatch-digest-value-mismatch');verifiedValues.push(valueHash);}if(to<plan.values.length)yield {stage:'fleet.dispatch.validate-values',done:to,total:plan.values.length};}
    if(!Number.isSafeInteger(plan.valuesLength)||plan.valuesLength<plan.tag.valuesLength||!Number.isSafeInteger(plan.revisionDelta)||plan.revisionDelta<plan.count)throw new Error('fleet-dispatch-plan-counters-invalid');
    if(seal){const metadataDigest=digestText(options.digest,planMetadata(plan)),assignmentDigest=digestText(options.digest,{schema:DIGEST_SCHEMA,kind:'assignments',count:plan.count,chunks:verifiedAssignments}),planDigest=digestText(options.digest,{schema:DIGEST_SCHEMA,kind:'plan',count:plan.count,metadataDigest,planChunks:verifiedPlan,valueChunks:verifiedValues});if(metadataDigest!==seal.metadataDigest||assignmentDigest!==String(options.assignmentDigest).toLowerCase()||planDigest!==String(options.planDigest).toLowerCase())throw new Error('fleet-dispatch-digest-root-mismatch');}
    for(let from=0;from<plan.values.length;from+=rowsPerStage){const to=Math.min(plan.values.length,from+rowsPerStage);for(let k=from;k<to;k++){const [ref,value]=plan.values[k];if(!STORE.internAt(recordStore,ref,value))throw new Error(`fleet-dispatch-plan-value-conflict:${ref}`);}if(to<plan.values.length)yield {stage:'fleet.dispatch.values',done:to,total:plan.values.length};}
    if(recordStore.values.length!==plan.valuesLength)throw new Error('fleet-dispatch-plan-values-length');
    const sourceRevision=plan.tag.revision;
    for(let from=0;from<plan.count;from+=rowsPerStage){const to=Math.min(plan.count,from+rowsPerStage),partIndices=plan.indices.slice(from,to),partBytes=plan.bytes.slice(from*STORE.STRIDE,to*STORE.STRIDE),partExtras=plan.extras.slice(from,to);STORE.writeRows(recordStore,partIndices,partBytes,partExtras);if(to<plan.count)yield {stage:'fleet.dispatch.apply',done:to,total:plan.count};}
    const targetRevision=sourceRevision+plan.revisionDelta;if(recordStore.revision>targetRevision)throw new Error('fleet-dispatch-plan-revision-overrun');STORE.writeRows(recordStore,new Int32Array(0),new ArrayBuffer(0),[],{revisionDelta:Math.max(0,targetRevision-recordStore.revision),staticRows:plan.staticRows});
    return clone(plan.summary);
  }
  function apply(state,plan,input={},options={}){const stages=applyStages(state,plan,input,options);let step;do step=stages.next();while(!step.done);return step.value;}
  function transferables(plan){return plan&&plan.indices instanceof Int32Array&&plan.bytes instanceof ArrayBuffer?[plan.indices.buffer,plan.bytes]:[];}
  const API=Object.freeze({VERSION,SCHEMA,DIGEST_SCHEMA,DEFAULT_ROWS_PER_STAGE,compute,digestStages,applyStages,apply,transferables,stableContext:stable});
  globalThis.GH_FLEET_DISPATCH_CORE=API;if(globalThis.window&&window!==globalThis)globalThis.window.GH_FLEET_DISPATCH_CORE=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
