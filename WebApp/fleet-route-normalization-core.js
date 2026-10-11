// Fleet route normalization query (Build 372).
//
// Updating a road route used to call GH_FLEET_DATA.drafts(state) before it
// filtered by routeId.  That creates a Proxy and draft shell for every live
// asset, even when only a few trucks use the route.  This module contains the
// pure half of the replacement:
//
//   1. run plan() on the fleet worker's exact replica;
//   2. check the main-thread request with current();
//   3. apply plan chunks inside one staged fleet transaction.
//
// plan() never materializes or drafts an asset.  It reads routed rows through
// scanRouted(), computes the same final assignments as
// GH_FLEET_CORE.normalizeAsset(), and returns only changed row indices plus a
// typed reference to shared patch templates.  A million equal trucks therefore
// transfer two typed numbers per changed row, rather than a million objects.
//
// Freshness is deliberately fail-closed.  capture() pins the fleet source,
// revision, membership, length, simulation time, reset epoch, every route field
// read by normalization, and an optional catalog/request token.  current()
// additionally checks every catalog entry actually consulted by plan().  The
// caller must hold the staged transaction while applying chunks: its own writes
// then advance the revision, so current() is checked once immediately before
// the first write and the transaction lock excludes unrelated writes until the
// final commit or rollback.
(()=>{
  'use strict';
  const VERSION='1.0.0',SCHEMA='gh-fleet-route-normalization-plan-v1';
  const ROUTE_FIELDS=Object.freeze(['distanceKm','tripSeconds','effectiveSpeedKmh','dwellHours','from','to','speedFactor']);
  // The exact fields normalizeAsset reads. routeId is first so scanRouted can
  // select without a second projection.
  const READ_FIELDS=Object.freeze(['routeId','reverse','assetMode','type','catalogId','specs','distanceKm','tripSeconds','effectiveSpeedKmh','dwellHours','from','to','phase','progress','fuel','condition']);
  const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
  const object=value=>value!==null&&typeof value==='object';
  const copy=value=>{
    if(!object(value))return value;
    if(globalThis.structuredClone)try{return structuredClone(value);}catch(_error){}
    return JSON.parse(JSON.stringify(value));
  };
  // GH_FLEET_DATA.commit uses this equality before it writes a draft overlay.
  const sameValue=(a,b)=>{
    if(Object.is(a,b))return true;
    if(!object(a)||!object(b))return false;
    try{return JSON.stringify(a)===JSON.stringify(b);}catch(_error){return false;}
  };
  const modeOf=row=>String(row?.assetMode||row?.type||'').trim();

  function routeStamp(routeId,route){
    const values={};for(const field of ROUTE_FIELDS)values[field]=copy(route?.[field]);
    return {routeId:copy(routeId),values};
  }
  function sameRouteStamp(stamp,routeId,route){
    if(!stamp||!sameValue(stamp.routeId,routeId))return false;
    for(const field of ROUTE_FIELDS)if(!sameValue(stamp.values?.[field],route?.[field]))return false;
    return true;
  }
  function sourceOf(state,fleet){return typeof fleet?.source==='function'?fleet.source(state):(state?.fleet||state?.assets||null);}
  function lengthOf(state,fleet){
    if(typeof fleet?.scanLength==='function')return fleet.scanLength(state);
    if(Number.isSafeInteger(state?.fleet?.length))return state.fleet.length;
    return Array.isArray(state?.assets)?state.assets.length:0;
  }
  function membershipOf(state,fleet){
    if(typeof fleet?.membershipRevision==='function')return fleet.membershipRevision(state);
    return Array.isArray(state?.assets)?`array:${state.assets.length}`:null;
  }
  function revisionOf(state,fleet){return typeof fleet?.revision==='function'?fleet.revision(state):Number.isFinite(state?.fleet?.revision)?state.fleet.revision:null;}
  function capture(state,fleet,{routeId,route,catalogToken=null,requestToken=null,arrayRevision=null}={}){
    return {
      source:sourceOf(state,fleet),revision:revisionOf(state,fleet),membership:membershipOf(state,fleet),length:lengthOf(state,fleet),
      simSeconds:Number(state?.simSeconds)||0,resetEpoch:Number(state?.resetEpoch)||0,route:routeStamp(routeId,route),
      catalogToken:copy(catalogToken),requestToken:copy(requestToken),arrayRevision:copy(arrayRevision)
    };
  }
  function serializableCapture(snapshot){
    if(!snapshot)return null;
    return {revision:snapshot.revision,membership:copy(snapshot.membership),length:snapshot.length,simSeconds:snapshot.simSeconds,resetEpoch:snapshot.resetEpoch,
      route:copy(snapshot.route),catalogToken:copy(snapshot.catalogToken),requestToken:copy(snapshot.requestToken),arrayRevision:copy(snapshot.arrayRevision)};
  }

  function catalogResult(catalogSpecs,row){
    let value,found=false;
    if(typeof catalogSpecs==='function'){
      value=catalogSpecs(row);found=value!==null&&value!==undefined;
    }else if(object(catalogSpecs)){
      const byType=catalogSpecs[row?.type];
      if(object(byType)&&own(byType,row?.catalogId)){value=byType[row.catalogId];found=value!==null&&value!==undefined;}
    }
    return {found,value};
  }
  function dependencyKey(type,catalogId){return JSON.stringify([type===undefined?['undefined']:['value',type],catalogId===undefined?['undefined']:['value',catalogId]]);}
  function recordDependency(table,row,result){
    const key=dependencyKey(row?.type,row?.catalogId);
    if(!table.has(key))table.set(key,{type:copy(row?.type),catalogId:copy(row?.catalogId),found:result.found,specs:result.found?copy(result.value):null});
  }

  // The final overlay produced by Fleet Core normalizeAsset, reduced the same
  // way GH_FLEET_DATA.commit reduces a draft: overwritten assignments retain
  // their first key position, and values equal to the live view are omitted.
  function normalizationPatch(row,route,catalogSpecs=null,onCatalog=null){
    if(!object(row))throw new TypeError('fleet-route-normalization-row');
    if(!object(route))throw new TypeError('fleet-route-normalization-route');
    const next={};
    const speed=Number(route.speedFactor)>0&&Number(route.speedFactor)<=1?Number(route.speedFactor):1;
    next.distanceKm=route.distanceKm;
    next.tripSeconds=route.tripSeconds/speed;
    next.effectiveSpeedKmh=route.effectiveSpeedKmh*speed;
    next.dwellHours=route.dwellHours;
    next.from=row.reverse?route.to:route.from;
    next.to=row.reverse?route.from:route.to;
    if(!row.phase)next.phase=row.routeId?'moving':'idle';
    if(typeof row.progress!=='number')next.progress=0;
    if(typeof row.fuel!=='number')next.fuel=100;
    if(typeof row.condition!=='number')next.condition=100;
    let specs=row.specs;
    if(!specs){
      const resolved=catalogResult(catalogSpecs,row);if(onCatalog)onCatalog(row,resolved);
      if(resolved.found){specs=copy(resolved.value);next.specs=specs;}
    }
    if(specs){
      const mode=modeOf(row),rated=mode==='air'?(specs.speedKmh||route.effectiveSpeedKmh)*.9:mode==='sea'?(specs.speedKn||route.effectiveSpeedKmh/1.852)*1.852*.88:(specs.speedKmh||route.effectiveSpeedKmh)*.76;
      next.effectiveSpeedKmh=Math.max(20,Math.min(rated,route.effectiveSpeedKmh*1.08)*speed);
      next.tripSeconds=next.distanceKm/next.effectiveSpeedKmh*3600;
    }
    const patch={};for(const field of Object.keys(next))if(!sameValue(row[field],next[field]))patch[field]=next[field];
    return patch;
  }

  // A key that preserves Object.is distinctions for scalar patch values while
  // using the same JSON equality as commit() for objects.
  function valueKey(value){
    if(value===undefined)return 'u';if(value===null)return 'l';
    switch(typeof value){
      case 'number':return Number.isNaN(value)?'n:NaN':Object.is(value,-0)?'n:-0':value===Infinity?'n:+Inf':value===-Infinity?'n:-Inf':`n:${value}`;
      case 'string':return `s:${JSON.stringify(value)}`;
      case 'boolean':return value?'b:1':'b:0';
      case 'bigint':return `i:${value}`;
      default:return `j:${JSON.stringify(value)}`;
    }
  }
  function patchKey(patch){return JSON.stringify(Object.keys(patch).map(field=>[field,valueKey(patch[field])]));}
  // Fixed typed chunks avoid V8's boxed/double JS arrays and avoid retaining a
  // chain of successively doubled ArrayBuffers while a million-row query runs.
  // finish() allocates the exact transferable size once and releases chunks.
  class Uint32Builder{
    constructor(chunkSize=16384){this.chunkSize=chunkSize;this.chunks=[];this.used=0;this.length=0;}
    push(value){
      if(!(Number.isSafeInteger(value)&&value>=0&&value<=0xFFFFFFFF))throw new RangeError('fleet-route-normalization-u32');
      if(!this.chunks.length||this.used===this.chunkSize){this.chunks.push(new Uint32Array(this.chunkSize));this.used=0;}
      this.chunks[this.chunks.length-1][this.used++]=value;this.length++;
    }
    finish(Type=Uint32Array){
      const out=new Type(this.length);let at=0;
      for(let index=0;index<this.chunks.length;index++){const chunk=this.chunks[index],count=index===this.chunks.length-1?this.used:this.chunkSize;out.set(chunk.subarray(0,count),at);at+=count;}
      this.chunks.length=0;this.used=0;this.length=0;return out;
    }
  }
  function typedRefs(builder,templateCount){
    if(templateCount<=0x100)return builder.finish(Uint8Array);
    if(templateCount<=0x10000)return builder.finish(Uint16Array);
    return builder.finish(Uint32Array);
  }

  function plan(state,fleet,{routeId,route,catalogSpecs=null,request=null}={}){
    if(!fleet||typeof fleet.scanRouted!=='function')throw new TypeError('fleet-route-normalization-scan-routed-required');
    if(routeId===null||routeId===undefined||routeId==='')throw new TypeError('fleet-route-normalization-route-id');
    if(!object(route))throw new TypeError('fleet-route-normalization-route');
    const indices=new Uint32Builder(),refs=new Uint32Builder(),templates=[],byPatch=new Map(),dependencies=new Map();let matched=0;
    const onCatalog=(row,result)=>recordDependency(dependencies,row,result);
    fleet.scanRouted(state,READ_FIELDS,(row,index)=>{
      if(row.routeId!==routeId)return fleet.SKIP_ROUTE;
      matched++;
      const patch=normalizationPatch(row,route,catalogSpecs,onCatalog),keys=Object.keys(patch);if(!keys.length)return undefined;
      const key=patchKey(patch);let ref=byPatch.get(key);
      if(ref===undefined){ref=templates.length;byPatch.set(key,ref);templates.push(patch);}
      indices.push(index);refs.push(ref);return undefined;
    });
    const changed=indices.length,sourceLength=lengthOf(state,fleet);
    return {schema:SCHEMA,version:VERSION,route:routeStamp(routeId,route),request:copy(request),sourceLength,matched,changed,
      indices:indices.finish(),templateRefs:typedRefs(refs,templates.length),templates,dependencies:[...dependencies.values()]};
  }

  function validPlan(value){
    const refs=value?.templateRefs,refsTyped=refs instanceof Uint8Array||refs instanceof Uint16Array||refs instanceof Uint32Array;
    if(!value||value.schema!==SCHEMA||value.version!==VERSION||!(value.indices instanceof Uint32Array)||!refsTyped||!Array.isArray(value.templates)||!Array.isArray(value.dependencies))return false;
    if(!Number.isSafeInteger(value.sourceLength)||value.sourceLength<0||value.changed!==value.indices.length||value.templateRefs.length!==value.indices.length||!Number.isSafeInteger(value.matched)||value.matched<value.changed||value.matched>value.sourceLength)return false;
    let previous=-1;for(let k=0;k<value.indices.length;k++){const index=value.indices[k],ref=value.templateRefs[k];if(index<=previous||index>=value.sourceLength||ref>=value.templates.length||!object(value.templates[ref]))return false;previous=index;}
    return true;
  }
  function dependenciesCurrent(dependencies,catalogSpecs){
    for(const dependency of dependencies||[]){const found=catalogResult(catalogSpecs,dependency);if(found.found!==dependency.found)return false;if(found.found&&!sameValue(found.value,dependency.specs))return false;}
    return true;
  }
  function current(snapshot,state,fleet,{routeId,route,catalogSpecs=null,catalogToken=snapshot?.catalogToken,requestToken=snapshot?.requestToken,arrayRevision=null,result=null}={}){
    if(!snapshot||snapshot.source!==sourceOf(state,fleet))return false;
    const revision=revisionOf(state,fleet);
    // Legacy arrays expose no write revision.  They are accepted only when the
    // owner supplies an exact mutation token; production route hydration uses
    // the native store and its monotonic revision.
    if(revision===null){if(arrayRevision===null||arrayRevision===undefined||!sameValue(snapshot.arrayRevision,arrayRevision))return false;}
    else if(!Object.is(snapshot.revision,revision))return false;
    if(!sameValue(snapshot.membership,membershipOf(state,fleet))||snapshot.length!==lengthOf(state,fleet))return false;
    if(!Object.is(snapshot.simSeconds,Number(state?.simSeconds)||0)||!Object.is(snapshot.resetEpoch,Number(state?.resetEpoch)||0))return false;
    if(!sameRouteStamp(snapshot.route,routeId,route)||!sameValue(snapshot.catalogToken,catalogToken)||!sameValue(snapshot.requestToken,requestToken))return false;
    if(result){
      if(!validPlan(result)||result.sourceLength!==snapshot.length||!sameRouteStamp(result.route,routeId,route)||!sameValue(result.request,serializableCapture(snapshot)))return false;
      if(!dependenciesCurrent(result.dependencies,catalogSpecs))return false;
    }
    return true;
  }
  function patchAt(result,offset){if(!validPlan(result)||!(offset>=0&&offset<result.changed))return null;return result.templates[result.templateRefs[offset]];}
  function transferables(result){if(!validPlan(result))return [];return result.indices.buffer===result.templateRefs.buffer?[result.indices.buffer]:[result.indices.buffer,result.templateRefs.buffer];}
  function* chunks(result,size=256){
    if(!validPlan(result))throw new TypeError('fleet-route-normalization-plan-invalid');
    const width=Math.max(1,Math.floor(Number(size)||256));
    for(let from=0;from<result.changed;from+=width){const to=Math.min(result.changed,from+width);yield {from,to,indices:result.indices.subarray(from,to),templateRefs:result.templateRefs.subarray(from,to)};}
  }

  const API=Object.freeze({VERSION,SCHEMA,ROUTE_FIELDS,READ_FIELDS,routeStamp,capture,serializableCapture,normalizationPatch,plan,validPlan,current,patchAt,transferables,chunks});
  globalThis.GH_FLEET_ROUTE_NORMALIZATION=API;
  if(globalThis.window&&globalThis.window!==globalThis)globalThis.window.GH_FLEET_ROUTE_NORMALIZATION=API;
  if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
