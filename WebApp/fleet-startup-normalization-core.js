// Exact single-pass startup normalization for the fleet worker.
//
// The old boot path built a patch for every live row on the main thread before
// first paint.  This module preserves that patch byte for byte while returning
// only changed row numbers and shared patch templates.  A caller must validate
// current() immediately before applying the first bounded chunk.
(()=>{
  'use strict';
  const VERSION='1.0.1',SCHEMA='gh-fleet-startup-normalization-plan-v1';
  const FIELDS=Object.freeze(['routeId','reverse','assetMode','type','catalogId','specs','distanceKm','dwellHours','from','to','effectiveSpeedKmh','tripSeconds','phase','progress','fuel','condition']);
  const ROUTE_FIELDS=Object.freeze(['distanceKm','dwellHours','from','to','effectiveSpeedKmh','tripSeconds']);
  const object=value=>value!==null&&typeof value==='object',own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
  const copy=value=>{if(!object(value))return value;if(globalThis.structuredClone)try{return structuredClone(value);}catch(_error){}return JSON.parse(JSON.stringify(value));};
  const same=(a,b)=>{if(Object.is(a,b))return true;if(!object(a)||!object(b))return false;try{return JSON.stringify(a)===JSON.stringify(b);}catch(_error){return false;}};
  const sourceOf=(state,fleet)=>typeof fleet?.source==='function'?fleet.source(state):(typeof fleet?.storeOf==='function'?fleet.storeOf(state):(state?.fleet||state?.assets||null));
  const revisionOf=(state,fleet)=>typeof fleet?.revision==='function'?fleet.revision(state):Number.isFinite(state?.fleet?.revision)?state.fleet.revision:null;
  const membershipOf=(state,fleet)=>typeof fleet?.membershipRevision==='function'?fleet.membershipRevision(state):(Array.isArray(state?.assets)?`array:${state.assets.length}`:null);
  const lengthOf=(state,fleet)=>typeof fleet?.scanLength==='function'?fleet.scanLength(state):(Array.isArray(state?.assets)?state.assets.length:Number(state?.fleet?.length)||0);
  const modeOf=row=>String(row?.assetMode||row?.type||'').trim();

  function routeMap(source){
    const out=new Map();
    if(source instanceof Map){for(const [id,row] of source)out.set(String(id),row);}
    else if(Array.isArray(source)){for(const value of source){const [id,row]=Array.isArray(value)?value:[value?.id,value];if(id!==undefined&&id!==null)out.set(String(id),row);}}
    else if(object(source))for(const [id,row] of Object.entries(source))out.set(String(id),row);
    return out;
  }
  function routeSnapshot(id,route){const found=object(route),values={};if(found)for(const field of ROUTE_FIELDS)values[field]=copy(route[field]);return {id:String(id),found,values};}
  function sameRoute(snapshot,route){const found=object(route);if(!snapshot||snapshot.found!==found)return false;if(!found)return true;for(const field of ROUTE_FIELDS)if(!same(snapshot.values?.[field],route[field]))return false;return true;}
  function catalogResult(catalog,row){
    const type=row?.type,id=row?.catalogId,section=catalog instanceof Map?catalog.get(type):catalog?.[type];let found=false,value;
    if(section instanceof Map){found=section.has(id);value=section.get(id);}
    else if(object(section)&&own(section,id)){found=true;value=section[id];}
    // The app passes a catalog-spec snapshot. Accepting {specs:{...}} as well
    // keeps a direct catalog item snapshot exact without changing semantics.
    if(found&&object(value)&&own(value,'specs'))value=value.specs;
    return {found:found&&value!==null&&value!==undefined,value};
  }
  const dependencyKey=(type,id)=>JSON.stringify([type===undefined?['undefined']:['value',type],id===undefined?['undefined']:['value',id]]);
  function recordCatalog(table,catalog,row){const key=dependencyKey(row?.type,row?.catalogId);if(table.has(key))return;const resolved=catalogResult(catalog,row);table.set(key,{type:copy(row?.type),catalogId:copy(row?.catalogId),found:resolved.found,specs:resolved.found?copy(resolved.value):null});}

  // Verbatim equivalent of app.js' startupPatch.  In particular it does not
  // apply route.speedFactor; changing that here would alter an in-flight
  // arrival time on load.
  function startupPatch(row,route,catalog,onCatalog=null){
    let resolved=null,specs=row?.specs;
    if(!specs){resolved=catalogResult(catalog,row);if(onCatalog)onCatalog(row,resolved);specs=resolved.found?resolved.value:null;}
    const patch={},set=(key,value)=>{if(Object.is(row?.[key],value))delete patch[key];else patch[key]=copy(value);};
    if(route){
      set('distanceKm',route.distanceKm);set('dwellHours',route.dwellHours);set('from',row.reverse?route.to:route.from);set('to',row.reverse?route.from:route.to);set('effectiveSpeedKmh',route.effectiveSpeedKmh);set('tripSeconds',route.tripSeconds);
      if(specs){const mode=modeOf(row),rated=mode==='air'?(specs.speedKmh||route.effectiveSpeedKmh)*.9:mode==='sea'?(specs.speedKn||route.effectiveSpeedKmh/1.852)*1.852*.88:(specs.speedKmh||route.effectiveSpeedKmh)*.76,effective=Math.max(20,Math.min(rated,route.effectiveSpeedKmh*1.08));set('effectiveSpeedKmh',effective);set('tripSeconds',route.distanceKm/effective*3600);}
    }
    if(!row?.phase)set('phase',row?.routeId?'moving':'idle');if(typeof row?.progress!=='number')set('progress',0);if(typeof row?.fuel!=='number')set('fuel',100);if(typeof row?.condition!=='number')set('condition',100);if(!row?.specs&&specs)set('specs',specs);
    return patch;
  }

  class Uint32Builder{
    constructor(size=16384){this.size=size;this.parts=[];this.used=0;this.length=0;}
    push(value){if(!(Number.isSafeInteger(value)&&value>=0&&value<=0xFFFFFFFF))throw new RangeError('fleet-startup-normalization-index');if(!this.parts.length||this.used===this.size){this.parts.push(new Uint32Array(this.size));this.used=0;}this.parts[this.parts.length-1][this.used++]=value;this.length++;}
    finish(Type=Uint32Array){const out=new Type(this.length);let at=0;for(let index=0;index<this.parts.length;index++){const take=index===this.parts.length-1?this.used:this.size;out.set(this.parts[index].subarray(0,take),at);at+=take;}return out;}
  }
  function valueKey(value){if(value===undefined)return 'u';if(value===null)return 'l';if(typeof value==='number')return Number.isNaN(value)?'n:NaN':Object.is(value,-0)?'n:-0':value===Infinity?'n:+Inf':value===-Infinity?'n:-Inf':`n:${value}`;if(typeof value==='string')return `s:${JSON.stringify(value)}`;if(typeof value==='boolean')return value?'b:1':'b:0';return `j:${JSON.stringify(value)}`;}
  const patchKey=patch=>JSON.stringify(Object.keys(patch).map(key=>[key,valueKey(patch[key])]));
  function typedRefs(builder,count){return builder.finish(count<=0x100?Uint8Array:count<=0x10000?Uint16Array:Uint32Array);}

  function capture(state,fleet,{routesToken=null,catalogToken=null,requestToken=null,arrayRevision=null}={}){
    return {source:sourceOf(state,fleet),revision:revisionOf(state,fleet),membership:copy(membershipOf(state,fleet)),length:lengthOf(state,fleet),simSeconds:Number(state?.simSeconds)||0,resetEpoch:Number(state?.resetEpoch)||0,routesToken:copy(routesToken),catalogToken:copy(catalogToken),requestToken:copy(requestToken),arrayRevision:copy(arrayRevision)};
  }
  function serializableCapture(stamp){if(!stamp)return null;return {revision:stamp.revision,membership:copy(stamp.membership),length:stamp.length,simSeconds:stamp.simSeconds,resetEpoch:stamp.resetEpoch,routesToken:copy(stamp.routesToken),catalogToken:copy(stamp.catalogToken),requestToken:copy(stamp.requestToken),arrayRevision:copy(stamp.arrayRevision)};}
  function plan(state,fleet,{routes={},catalogSpecs={},request=null}={}){
    if(!fleet||typeof fleet.scan!=='function')throw new TypeError('fleet-startup-normalization-scan-unavailable');
    const byRoute=routeMap(routes),indices=new Uint32Builder(),refs=new Uint32Builder(),templates=[],templateByKey=new Map(),routeDependencies=new Map(),catalogDependencies=new Map();
    fleet.scan(state,FIELDS,(row,index)=>{
      const routeId=String(row?.routeId??''),route=byRoute.get(routeId);if(routeId&&!routeDependencies.has(routeId))routeDependencies.set(routeId,routeSnapshot(routeId,route));
      const patch=startupPatch(row,route,catalogSpecs,(asset,resolved)=>{const key=dependencyKey(asset?.type,asset?.catalogId);if(!catalogDependencies.has(key))catalogDependencies.set(key,{type:copy(asset?.type),catalogId:copy(asset?.catalogId),found:resolved.found,specs:resolved.found?copy(resolved.value):null});});if(!Object.keys(patch).length)return;
      const key=patchKey(patch);let ref=templateByKey.get(key);if(ref===undefined){ref=templates.length;templateByKey.set(key,ref);templates.push(patch);}indices.push(index);refs.push(ref);
    });
    const changed=indices.length;return {schema:SCHEMA,version:VERSION,sourceLength:lengthOf(state,fleet),changed,referencedRoutes:routeDependencies.size,indices:indices.finish(),templateRefs:typedRefs(refs,templates.length),templates,routeDependencies:[...routeDependencies.values()],catalogDependencies:[...catalogDependencies.values()],request:copy(request)};
  }
  function validPlan(result){
    const refs=result?.templateRefs,typed=refs instanceof Uint8Array||refs instanceof Uint16Array||refs instanceof Uint32Array;
    if(!result||result.schema!==SCHEMA||result.version!==VERSION||!Number.isSafeInteger(result.sourceLength)||result.sourceLength<0||!Number.isSafeInteger(result.changed)||result.changed<0||result.changed>result.sourceLength||!Number.isSafeInteger(result.referencedRoutes)||result.referencedRoutes<0||!(result.indices instanceof Uint32Array)||!typed||result.indices.length!==result.changed||refs.length!==result.changed||!Array.isArray(result.templates)||!Array.isArray(result.routeDependencies)||!Array.isArray(result.catalogDependencies)||result.referencedRoutes!==result.routeDependencies.length)return false;
    let prior=-1;for(let offset=0;offset<result.changed;offset++){const index=result.indices[offset],ref=refs[offset];if(index<=prior||index>=result.sourceLength||ref>=result.templates.length||!object(result.templates[ref])||!Object.keys(result.templates[ref]).length)return false;prior=index;}
    const routeIds=new Set();for(const row of result.routeDependencies){if(!row||typeof row.id!=='string'||!row.id||routeIds.has(row.id)||typeof row.found!=='boolean'||!object(row.values)||row.found!==true&&Object.keys(row.values).length)return false;routeIds.add(row.id);}
    const catalogIds=new Set();for(const row of result.catalogDependencies){if(!row||typeof row.found!=='boolean'||row.found!==true&&row.specs!==null)return false;const key=dependencyKey(row.type,row.catalogId);if(catalogIds.has(key))return false;catalogIds.add(key);}
    return true;
  }
  function dependenciesCurrent(result,routes,catalog){
    const byRoute=routeMap(routes);for(const dependency of result.routeDependencies){if(!sameRoute(dependency,byRoute.get(dependency.id)))return false;}
    for(const dependency of result.catalogDependencies){const found=catalogResult(catalog,dependency);if(found.found!==dependency.found||found.found&&!same(found.value,dependency.specs))return false;}
    return true;
  }
  function current(stamp,state,fleet,{routes={},catalogSpecs={},routesToken=stamp?.routesToken,catalogToken=stamp?.catalogToken,requestToken=stamp?.requestToken,arrayRevision=null,result=null}={}){
    if(!stamp||stamp.source!==sourceOf(state,fleet))return false;const revision=revisionOf(state,fleet);if(revision===null){if(arrayRevision===null||arrayRevision===undefined||!same(stamp.arrayRevision,arrayRevision))return false;}else if(!Object.is(stamp.revision,revision))return false;
    if(!same(stamp.membership,membershipOf(state,fleet))||stamp.length!==lengthOf(state,fleet)||!Object.is(stamp.simSeconds,Number(state?.simSeconds)||0)||!Object.is(stamp.resetEpoch,Number(state?.resetEpoch)||0)||!same(stamp.routesToken,routesToken)||!same(stamp.catalogToken,catalogToken)||!same(stamp.requestToken,requestToken))return false;
    return !result||validPlan(result)&&result.sourceLength===stamp.length&&same(result.request,serializableCapture(stamp))&&dependenciesCurrent(result,routes,catalogSpecs);
  }
  function patchAt(result,offset){if(!validPlan(result)||!Number.isSafeInteger(offset)||offset<0||offset>=result.changed)return null;return result.templates[result.templateRefs[offset]];}
  function* chunks(result,size=256){if(!validPlan(result))throw new TypeError('fleet-startup-normalization-plan-invalid');const width=Math.max(1,Math.floor(Number(size)||256));for(let from=0;from<result.changed;from+=width){const to=Math.min(result.changed,from+width);yield {from,to,indices:result.indices.subarray(from,to),templateRefs:result.templateRefs.subarray(from,to)};}}
  function transferables(result){if(!validPlan(result))return [];return result.indices.buffer===result.templateRefs.buffer?[result.indices.buffer]:[result.indices.buffer,result.templateRefs.buffer];}
  const API=Object.freeze({VERSION,SCHEMA,FIELDS,ROUTE_FIELDS,routeMap,routeSnapshot,startupPatch,capture,serializableCapture,plan,run:plan,validPlan,current,patchAt,chunks,transferables});
  globalThis.GH_FLEET_STARTUP_NORMALIZATION=API;if(globalThis.window&&window!==globalThis)window.GH_FLEET_STARTUP_NORMALIZATION=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
