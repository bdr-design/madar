// Exact worker-side reference usage for route and facility decisions.
//
// Interactive route replacement/deletion and facility closure used to call
// `some`/`distinctRefs` on the live million-row store.  A caller supplies the
// bounded ids it is deciding about; the worker returns counts in the same
// order.  Startup may request `collectRouteIds` to recover the complete set of
// legacy route references in one pass without creating asset views.
(()=>{
  'use strict';

  const VERSION='1.0.1',SCHEMA='gh-fleet-reference-usage-v1';
  const FIELDS=Object.freeze(['id','type','routeId','baseFacility']);
  const copy=value=>value===undefined?undefined:globalThis.structuredClone?structuredClone(value):JSON.parse(JSON.stringify(value));
  const clean=value=>String(value??'').trim();
  function unique(values,label){
    if(values==null)return [];
    if(!Array.isArray(values))throw new TypeError(`fleet-reference-${label}-array`);
    const out=[],seen=new Set();for(const value of values){const id=clean(value);if(!id||seen.has(id))continue;if(id.length>160)throw new RangeError(`fleet-reference-${label}-length`);seen.add(id);out.push(id);}
    return out;
  }
  function normalized(params={}){
    const routeIds=unique(params.routeIds,'routes'),baseIds=unique(params.baseIds,'bases'),excludeAssetId=clean(params.excludeAssetId),type=params.type==null?'':clean(params.type),collectRouteIds=params.collectRouteIds===true,requestToken=copy(params.requestToken??null);
    return {routeIds,baseIds,excludeAssetId,type,collectRouteIds,requestToken};
  }
  function requestKey(params={}){
    const p=normalized(params);return JSON.stringify([p.routeIds,p.baseIds,p.excludeAssetId,p.type,p.collectRouteIds,p.requestToken]);
  }
  function plan(state,fleet,params={}){
    if(!fleet||typeof fleet.scan!=='function')throw new TypeError('fleet-reference-scan-unavailable');
    const p=normalized(params),routeIndex=new Map(p.routeIds.map((id,index)=>[id,index])),baseIndex=new Map(p.baseIds.map((id,index)=>[id,index])),routeCounts=new Uint32Array(p.routeIds.length),baseCounts=new Uint32Array(p.baseIds.length),distinct=p.collectRouteIds?new Set():null;
    let rows=0,matchedRoutes=0,matchedBases=0;
    fleet.scan(state,FIELDS,row=>{
      rows++;if(p.type&&String(row.type||'')!==p.type)return;
      const route=clean(row.routeId),base=clean(row.baseFacility);
      if(route&&distinct)distinct.add(route);
      const routePosition=routeIndex.get(route);if(routePosition!==undefined&&(!p.excludeAssetId||String(row.id||'')!==p.excludeAssetId)){routeCounts[routePosition]++;matchedRoutes++;}
      const basePosition=baseIndex.get(base);if(basePosition!==undefined){baseCounts[basePosition]++;matchedBases++;}
    });
    return {schema:SCHEMA,version:VERSION,requestKey:requestKey(p),routeIds:p.routeIds,routeCounts,baseIds:p.baseIds,baseCounts,distinctRouteIds:distinct?[...distinct]:[],rows,matchedRoutes,matchedBases};
  }
  function validPlan(result,params=null){
    if(!result||result.schema!==SCHEMA||result.version!==VERSION||typeof result.requestKey!=='string'||!Array.isArray(result.routeIds)||!Array.isArray(result.baseIds)||!(result.routeCounts instanceof Uint32Array)||!(result.baseCounts instanceof Uint32Array)||result.routeCounts.length!==result.routeIds.length||result.baseCounts.length!==result.baseIds.length||!Array.isArray(result.distinctRouteIds))return false;
    // Reject malformed or ambiguous ids before a caller turns the arrays into
    // Maps.  Duplicate result keys could otherwise hide one of the counts.
    let routes,bases,distinct;
    try{routes=unique(result.routeIds,'routes');bases=unique(result.baseIds,'bases');distinct=unique(result.distinctRouteIds,'distinct-routes');}catch(_error){return false;}
    if(routes.length!==result.routeIds.length||bases.length!==result.baseIds.length||distinct.length!==result.distinctRouteIds.length)return false;
    for(let index=0;index<routes.length;index++)if(routes[index]!==result.routeIds[index])return false;
    for(let index=0;index<bases.length;index++)if(bases[index]!==result.baseIds[index])return false;
    for(let index=0;index<distinct.length;index++)if(distinct[index]!==result.distinctRouteIds[index])return false;
    if(!Number.isSafeInteger(result.rows)||result.rows<0||!Number.isSafeInteger(result.matchedRoutes)||result.matchedRoutes<0||result.matchedRoutes>result.rows||!Number.isSafeInteger(result.matchedBases)||result.matchedBases<0||result.matchedBases>result.rows||distinct.length>result.rows)return false;
    let routeTotal=0,baseTotal=0;for(const count of result.routeCounts)routeTotal+=count;for(const count of result.baseCounts)baseTotal+=count;
    if(routeTotal!==result.matchedRoutes||baseTotal!==result.matchedBases)return false;
    if(params!=null){const normalizedParams=normalized(params);if(result.requestKey!==requestKey(normalizedParams)||normalizedParams.collectRouteIds!==true&&distinct.length||normalizedParams.routeIds.length!==routes.length||normalizedParams.baseIds.length!==bases.length)return false;for(let index=0;index<routes.length;index++)if(routes[index]!==normalizedParams.routeIds[index])return false;for(let index=0;index<bases.length;index++)if(bases[index]!==normalizedParams.baseIds[index])return false;}
    return true;
  }
  function capture(state,fleet,params={}){
    const store=typeof fleet?.storeOf==='function'?fleet.storeOf(state):null,revision=typeof fleet?.revision==='function'?fleet.revision(state):null,membership=typeof fleet?.membershipRevision==='function'?fleet.membershipRevision(state):null,length=typeof fleet?.scanLength==='function'?fleet.scanLength(state):typeof fleet?.size==='function'?fleet.size(state):null;
    return {source:store||null,revision,membership,length,simSeconds:Number(state?.simSeconds)||0,resetEpoch:Number(state?.resetEpoch)||0,requestKey:requestKey(params),cacheable:!!store&&revision!==null&&revision!==undefined&&membership!==null&&membership!==undefined&&Number.isSafeInteger(length)&&length>=0};
  }
  function current(stamp,state,fleet,params={}){
    if(!stamp?.cacheable)return false;const now=capture(state,fleet,params);return now.cacheable&&stamp.source===now.source&&stamp.revision===now.revision&&stamp.membership===now.membership&&stamp.length===now.length&&stamp.simSeconds===now.simSeconds&&stamp.resetEpoch===now.resetEpoch&&stamp.requestKey===now.requestKey;
  }
  function lookup(result){
    if(!validPlan(result))throw new TypeError('fleet-reference-plan-invalid');
    const routes=new Map(result.routeIds.map((id,index)=>[id,result.routeCounts[index]])),bases=new Map(result.baseIds.map((id,index)=>[id,result.baseCounts[index]])),distinct=new Set(result.distinctRouteIds);
    return Object.freeze({route:id=>routes.get(clean(id))||0,base:id=>bases.get(clean(id))||0,routeIds:distinct});
  }
  function transferables(result){return validPlan(result)?[result.routeCounts.buffer,result.baseCounts.buffer]:[];}
  const API=Object.freeze({VERSION,SCHEMA,FIELDS,normalized,requestKey,plan,run:plan,validPlan,capture,current,lookup,transferables});
  globalThis.GH_FLEET_REFERENCE_QUERY=API;
  if(globalThis.window&&globalThis.window!==globalThis)globalThis.window.GH_FLEET_REFERENCE_QUERY=API;
  if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
