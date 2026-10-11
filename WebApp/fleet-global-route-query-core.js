// Worker-safe bounded selection for the public destination drawer.
//
// The old drawer materialized every non-moving aircraft/ship and rendered one
// DOM card per asset.  At a million rows that is both a full main-thread scan
// and an unbounded DOM build.  This query preserves the view-phase predicate
// and row order, but returns only the first `limit` row numbers plus the exact
// total.  A caller resolves those bounded rows only after current() succeeds.
(()=>{
  'use strict';
  const VERSION='1.0.0',SCHEMA='gh-fleet-global-route-candidates-v1';
  const FIELDS=Object.freeze(['type','phase']);
  const object=value=>value!==null&&typeof value==='object';
  const copy=value=>{if(!object(value))return value;if(globalThis.structuredClone)try{return structuredClone(value);}catch(_error){}return JSON.parse(JSON.stringify(value));};
  const same=(a,b)=>{if(Object.is(a,b))return true;if(!object(a)||!object(b))return false;try{return JSON.stringify(a)===JSON.stringify(b);}catch(_error){return false;}};
  const sourceOf=(state,fleet)=>typeof fleet?.source==='function'?fleet.source(state):(state?.fleet||state?.assets||null);
  const revisionOf=(state,fleet)=>typeof fleet?.revision==='function'?fleet.revision(state):Number.isFinite(state?.fleet?.revision)?state.fleet.revision:null;
  const membershipOf=(state,fleet)=>typeof fleet?.membershipRevision==='function'?fleet.membershipRevision(state):(Array.isArray(state?.assets)?`array:${state.assets.length}`:null);
  const lengthOf=(state,fleet)=>typeof fleet?.scanLength==='function'?fleet.scanLength(state):(Array.isArray(state?.assets)?state.assets.length:Number(state?.fleet?.length)||0);
  const normalizeType=value=>{value=String(value||'').trim();if(value!=='air'&&value!=='sea')throw new TypeError('fleet-global-route-type');return value;};
  const normalizeLimit=value=>Math.max(1,Math.min(4096,Math.floor(Number(value)||80)));

  function capture(state,fleet,{type,limit=80,requestToken=null,arrayRevision=null}={}){
    return {source:sourceOf(state,fleet),revision:revisionOf(state,fleet),membership:copy(membershipOf(state,fleet)),length:lengthOf(state,fleet),simSeconds:Number(state?.simSeconds)||0,
      type:normalizeType(type),limit:normalizeLimit(limit),requestToken:copy(requestToken),arrayRevision:copy(arrayRevision)};
  }
  function serializableCapture(stamp){if(!stamp)return null;return {revision:stamp.revision,membership:copy(stamp.membership),length:stamp.length,simSeconds:stamp.simSeconds,type:stamp.type,limit:stamp.limit,requestToken:copy(stamp.requestToken),arrayRevision:copy(stamp.arrayRevision)};}

  class Uint32Builder{
    constructor(chunk=4096){this.chunk=chunk;this.parts=[];this.used=0;this.length=0;}
    push(value){if(!(Number.isSafeInteger(value)&&value>=0&&value<=0xFFFFFFFF))throw new RangeError('fleet-global-route-index');if(!this.parts.length||this.used===this.chunk){this.parts.push(new Uint32Array(this.chunk));this.used=0;}this.parts[this.parts.length-1][this.used++]=value;this.length++;}
    finish(){const out=new Uint32Array(this.length);let at=0;for(let i=0;i<this.parts.length;i++){const take=i===this.parts.length-1?this.used:this.chunk;out.set(this.parts[i].subarray(0,take),at);at+=take;}return out;}
  }

  function plan(state,fleet,{type,limit=80,request=null}={}){
    if(!fleet||typeof fleet.scan!=='function')throw new TypeError('fleet-global-route-scan-unavailable');
    type=normalizeType(type);limit=normalizeLimit(limit);const indices=new Uint32Builder();let total=0;
    fleet.scan(state,FIELDS,(row,index)=>{if(row.type!==type||row.phase==='moving')return;total++;if(indices.length<limit)indices.push(index);});
    return {schema:SCHEMA,version:VERSION,type,limit,total,truncated:total>indices.length,sourceLength:lengthOf(state,fleet),indices:indices.finish(),request:copy(request)};
  }
  function validPlan(result){
    if(!result||result.schema!==SCHEMA||result.version!==VERSION||(result.type!=='air'&&result.type!=='sea')||!Number.isSafeInteger(result.limit)||result.limit<1||result.limit>4096||!Number.isSafeInteger(result.total)||result.total<0||!Number.isSafeInteger(result.sourceLength)||result.sourceLength<0||!(result.indices instanceof Uint32Array)||result.indices.length!==Math.min(result.total,result.limit)||result.truncated!==(result.total>result.indices.length))return false;
    let previous=-1;for(const index of result.indices){if(index<=previous||index>=result.sourceLength)return false;previous=index;}return true;
  }
  function current(stamp,state,fleet,{type=stamp?.type,limit=stamp?.limit,requestToken=stamp?.requestToken,arrayRevision=null,result=null}={}){
    if(!stamp||stamp.source!==sourceOf(state,fleet))return false;const revision=revisionOf(state,fleet);
    if(revision===null){if(arrayRevision===null||arrayRevision===undefined||!same(stamp.arrayRevision,arrayRevision))return false;}else if(!Object.is(stamp.revision,revision))return false;
    if(!same(stamp.membership,membershipOf(state,fleet))||stamp.length!==lengthOf(state,fleet)||!Object.is(stamp.simSeconds,Number(state?.simSeconds)||0)||stamp.type!==normalizeType(type)||stamp.limit!==normalizeLimit(limit)||!same(stamp.requestToken,requestToken))return false;
    return !result||(validPlan(result)&&result.type===stamp.type&&result.limit===stamp.limit&&result.sourceLength===stamp.length&&same(result.request,serializableCapture(stamp)));
  }
  const transferables=result=>validPlan(result)?[result.indices.buffer]:[];
  const API=Object.freeze({VERSION,SCHEMA,FIELDS,capture,serializableCapture,plan,run:plan,validPlan,current,transferables});
  globalThis.GH_FLEET_GLOBAL_ROUTE_QUERY=API;if(globalThis.window&&window!==globalThis)window.GH_FLEET_GLOBAL_ROUTE_QUERY=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
