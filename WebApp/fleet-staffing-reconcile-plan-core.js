// Exact worker-side preflight for Fleet Core startup staffing reconciliation.
//
// The healthy startup path contains no row payloads: the worker proves that
// every eligible asset is already staffed and returns the exact eight crew
// totals that synchronizeCrew would write.  Exceptional rows are returned as
// ascending transferable indices, matching reconcileStaffing's sorted repair
// order.  The main thread must recheck current() before using either result.
// This proof covers fleet rows and crew totals only.  It does not replace the
// first reconcileStaffing loop that repairs automatic employment contracts;
// an integration must retain that loop (preferably as bounded stages).
(()=>{
  'use strict';

  const VERSION='1.0.0',SCHEMA='gh-fleet-staffing-reconcile-plan-v1';
  const FIELDS=Object.freeze(['deliveryStatus','phase','staffing']);
  const ROLE_DEFAULTS=Object.freeze({
    pilots:Object.freeze({name:'الطيارون',dailyRate:600}),
    cabin:Object.freeze({name:'طاقم الضيافة',dailyRate:130}),
    aeng:Object.freeze({name:'مهندسو الطيران',dailyRate:230}),
    captains:Object.freeze({name:'قباطنة السفن',dailyRate:450}),
    sailors:Object.freeze({name:'بحارة وملاحون',dailyRate:75}),
    seng:Object.freeze({name:'مهندسو السفن',dailyRate:280}),
    drivers:Object.freeze({name:'سائقو الشاحنات',dailyRate:110}),
    mech:Object.freeze({name:'فنيو الصيانة',dailyRate:140})
  });
  const ROLE_IDS=Object.freeze(Object.keys(ROLE_DEFAULTS)),ROLE_INDEX=new Map(ROLE_IDS.map((id,index)=>[id,index]));
  const object=value=>value!==null&&typeof value==='object';
  const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
  const copy=value=>{if(!object(value))return value;if(globalThis.structuredClone)try{return structuredClone(value);}catch(_error){}return JSON.parse(JSON.stringify(value));};
  const same=(a,b)=>{if(Object.is(a,b))return true;if(!object(a)||!object(b))return false;try{return JSON.stringify(a)===JSON.stringify(b);}catch(_error){return false;}};
  const sourceOf=(state,fleet)=>typeof fleet?.source==='function'?fleet.source(state):(state?.fleet||state?.assets||null);
  const revisionOf=(state,fleet)=>typeof fleet?.revision==='function'?fleet.revision(state):Number.isFinite(state?.fleet?.revision)?state.fleet.revision:null;
  const membershipOf=(state,fleet)=>typeof fleet?.membershipRevision==='function'?fleet.membershipRevision(state):(Array.isArray(state?.assets)?`array:${state.assets.length}`:null);
  const lengthOf=(state,fleet)=>typeof fleet?.scanLength==='function'?fleet.scanLength(state):(Array.isArray(state?.assets)?state.assets.length:Number(state?.fleet?.length)||0);
  function token(value,label){
    if(value===undefined||value===null)return null;
    if(typeof value==='string'||typeof value==='boolean')return value;
    if(typeof value==='number'&&Number.isFinite(value))return value;
    throw new TypeError(`fleet-staffing-reconcile-${label}-token`);
  }
  function normalized(params={}){
    return {
      requestToken:token(params.requestToken,'request'),
      facilitiesToken:token(params.facilitiesToken,'facilities'),
      ownerToken:token(params.ownerToken,'owner')
    };
  }
  function requestKey(params={}){const p=normalized(params);return JSON.stringify([p.requestToken,p.facilitiesToken,p.ownerToken]);}
  function validRequestKey(value){
    if(typeof value!=='string')return false;
    try{const row=JSON.parse(value);return Array.isArray(row)&&row.length===3&&requestKey({requestToken:row[0],facilitiesToken:row[1],ownerToken:row[2]})===value;}catch(_error){return false;}
  }
  function ready(staffing){return staffing?.mode==='automatic-fixed'&&staffing.ready===true;}
  function eligible(row){return row?.deliveryStatus!=='pending'&&row?.phase!=='delivery';}

  class Uint32Builder{
    constructor(chunk=16384){this.chunk=chunk;this.parts=[];this.used=0;this.length=0;}
    push(value){
      if(!(Number.isSafeInteger(value)&&value>=0&&value<=0xFFFFFFFF))throw new RangeError('fleet-staffing-reconcile-index');
      if(!this.parts.length||this.used===this.chunk){this.parts.push(new Uint32Array(this.chunk));this.used=0;}
      this.parts[this.parts.length-1][this.used++]=value;this.length++;
    }
    finish(){const out=new Uint32Array(this.length);let at=0;for(let index=0;index<this.parts.length;index++){const take=index===this.parts.length-1?this.used:this.chunk;out.set(this.parts[index].subarray(0,take),at);at+=take;}return out;}
  }
  function addCrew(counts,staffing,times){
    if(!ready(staffing))return;
    for(const role of staffing.roles||[]){const slot=ROLE_INDEX.get(role.id);if(slot!==undefined)counts[slot]+=(Number(role.count)||0)*times;}
  }
  function rowCrew(state,fleet){
    const counts=new Float64Array(ROLE_IDS.length);
    if(typeof fleet.scan==='function')fleet.scan(state,['staffing'],row=>addCrew(counts,row.staffing,1));
    else if(typeof fleet.forEach==='function')fleet.forEach(state,row=>addCrew(counts,row?.staffing,1));
    else throw new TypeError('fleet-staffing-reconcile-row-scan-unavailable');
    return counts;
  }
  // This deliberately mirrors synchronizeCrew: all staffing classes are
  // collected first; one fractional/non-safe role changes the whole pass to
  // row-order arithmetic.  Keeping the class order preserves IEEE-754 results
  // at and above the safe-integer boundary.
  function crewTotals(state,fleet){
    if(typeof fleet.forEachFieldClasses!=='function')return {counts:rowCrew(state,fleet),strategy:'row-order',classes:0};
    const classes=[];let integral=true;
    fleet.forEachFieldClasses(state,['staffing'],(row,count)=>{
      if(!count)return;classes.push([row.staffing,count]);
      if(!(row.staffing?.roles||[]).every(role=>Number.isSafeInteger(Number(role.count)||0)))integral=false;
    });
    if(!integral)return {counts:rowCrew(state,fleet),strategy:'row-order',classes:classes.length};
    const counts=new Float64Array(ROLE_IDS.length);for(const [staffing,count] of classes)addCrew(counts,staffing,count);
    return {counts,strategy:'class-integral',classes:classes.length};
  }

  function capture(state,fleet,params={}){
    const p=normalized(params),revision=revisionOf(state,fleet),arrayRevision=token(params.arrayRevision,'array-revision');
    return {
      source:sourceOf(state,fleet),revision,membership:copy(membershipOf(state,fleet)),length:lengthOf(state,fleet),
      simSeconds:Number(state?.simSeconds)||0,resetEpoch:Number(state?.resetEpoch)||0,requestKey:requestKey(p),request:p,
      arrayRevision,cacheable:revision!==null&&revision!==undefined||arrayRevision!==null
    };
  }
  function serializableCapture(stamp){
    if(!stamp)return null;
    return {revision:stamp.revision,membership:copy(stamp.membership),length:stamp.length,simSeconds:stamp.simSeconds,resetEpoch:stamp.resetEpoch,requestKey:stamp.requestKey,arrayRevision:copy(stamp.arrayRevision)};
  }

  function plan(state,fleet,params={}){
    if(!fleet||typeof fleet.scan!=='function')throw new TypeError('fleet-staffing-reconcile-scan-unavailable');
    const p=normalized(params),indices=new Uint32Builder();let rows=0,deferred=0,eligibleRows=0,staffedRows=0,eligibleStaffed=0,unstaffedCount=0,selectionStrategy='row-order',selectionClasses=0;
    if(typeof fleet.forEachFieldClasses==='function'){
      selectionStrategy='classes';
      fleet.forEachFieldClasses(state,FIELDS,(row,count)=>{
        if(!count)return;selectionClasses++;rows+=count;const isReady=ready(row.staffing);if(isReady)staffedRows+=count;
        if(!eligible(row)){deferred+=count;return;}eligibleRows+=count;if(isReady)eligibleStaffed+=count;else unstaffedCount+=count;
      });
      // The common healthy path never expands a class.  If repair is needed,
      // one ordered worker scan is cheaper than one full member scan per bad
      // class and yields reconcileStaffing's final sorted order directly.
      if(unstaffedCount)fleet.scan(state,FIELDS,(row,index)=>{if(eligible(row)&&!ready(row.staffing))indices.push(index);});
    }else{
      fleet.scan(state,FIELDS,(row,index)=>{
        rows++;const isReady=ready(row.staffing);if(isReady)staffedRows++;
        if(!eligible(row)){deferred++;return;}eligibleRows++;if(isReady)eligibleStaffed++;else{unstaffedCount++;indices.push(index);}
      });
    }
    const indexArray=indices.finish();if(indexArray.length!==unstaffedCount)throw new Error('fleet-staffing-reconcile-selection-mismatch');
    const crew=crewTotals(state,fleet);
    return {
      schema:SCHEMA,version:VERSION,requestKey:requestKey(p),request:copy(params.request??null),sourceLength:lengthOf(state,fleet),
      rows,deferred,eligible:eligibleRows,staffed:staffedRows,eligibleStaffed,unstaffed:unstaffedCount,indices:indexArray,
      roleIds:[...ROLE_IDS],roleCounts:crew.counts,crewStrategy:crew.strategy,crewClasses:crew.classes,
      selectionStrategy,selectionClasses
    };
  }
  function validPlan(result,params=null){
    if(!result||result.schema!==SCHEMA||result.version!==VERSION||!validRequestKey(result.requestKey)||!Number.isSafeInteger(result.sourceLength)||result.sourceLength<0||!Number.isSafeInteger(result.rows)||result.rows<0||result.rows>result.sourceLength||!Number.isSafeInteger(result.deferred)||result.deferred<0||!Number.isSafeInteger(result.eligible)||result.eligible<0||result.deferred+result.eligible!==result.rows||!Number.isSafeInteger(result.staffed)||result.staffed<0||result.staffed>result.rows||!Number.isSafeInteger(result.eligibleStaffed)||result.eligibleStaffed<0||result.eligibleStaffed>result.eligible||result.eligibleStaffed>result.staffed||!Number.isSafeInteger(result.unstaffed)||result.unstaffed<0||result.eligibleStaffed+result.unstaffed!==result.eligible||!(result.indices instanceof Uint32Array)||result.indices.length!==result.unstaffed||result.indices.byteOffset!==0||result.indices.byteLength!==result.indices.buffer.byteLength||!Array.isArray(result.roleIds)||result.roleIds.length!==ROLE_IDS.length||result.roleIds.some((id,index)=>id!==ROLE_IDS[index])||!(result.roleCounts instanceof Float64Array)||result.roleCounts.length!==ROLE_IDS.length||result.roleCounts.byteOffset!==0||result.roleCounts.byteLength!==result.roleCounts.buffer.byteLength||!['class-integral','row-order'].includes(result.crewStrategy)||!['classes','row-order'].includes(result.selectionStrategy)||!Number.isSafeInteger(result.crewClasses)||result.crewClasses<0||result.crewClasses>result.rows||!Number.isSafeInteger(result.selectionClasses)||result.selectionClasses<0||result.selectionClasses>result.rows)return false;
    if(result.staffed-result.eligibleStaffed>result.deferred||result.selectionStrategy==='row-order'&&result.selectionClasses!==0||result.selectionStrategy==='classes'&&(result.rows===0)!==(result.selectionClasses===0)||result.crewStrategy==='class-integral'&&(result.rows===0)!==(result.crewClasses===0))return false;
    let previous=-1;for(const index of result.indices){if(index<=previous||index>=result.sourceLength)return false;previous=index;}
    return params===null||result.requestKey===requestKey(params);
  }
  function current(stamp,state,fleet,params={}){
    if(!stamp?.cacheable||stamp.source!==sourceOf(state,fleet))return false;
    const request={
      requestToken:own(params,'requestToken')?params.requestToken:stamp.request?.requestToken,
      facilitiesToken:own(params,'facilitiesToken')?params.facilitiesToken:stamp.request?.facilitiesToken,
      ownerToken:own(params,'ownerToken')?params.ownerToken:stamp.request?.ownerToken
    },arrayRevision=own(params,'arrayRevision')?token(params.arrayRevision,'array-revision'):stamp.arrayRevision,result=params.result||null,revision=revisionOf(state,fleet);
    if(revision===null||revision===undefined){if(arrayRevision===null||!same(stamp.arrayRevision,arrayRevision))return false;}else if(!Object.is(stamp.revision,revision))return false;
    if(!same(stamp.membership,membershipOf(state,fleet))||stamp.length!==lengthOf(state,fleet)||!Object.is(stamp.simSeconds,Number(state?.simSeconds)||0)||!Object.is(stamp.resetEpoch,Number(state?.resetEpoch)||0)||stamp.requestKey!==requestKey(request))return false;
    return !result||(validPlan(result,request)&&result.sourceLength===stamp.length&&same(result.request,serializableCapture(stamp)));
  }
  function lookup(result){
    if(!validPlan(result))throw new TypeError('fleet-staffing-reconcile-plan-invalid');
    const counts=new Map(result.roleIds.map((id,index)=>[id,result.roleCounts[index]]));return Object.freeze({count:id=>counts.has(id)?counts.get(id):0,counts});
  }
  // Safe only for the healthy proof.  Repairs create new staffing records, so
  // their role deltas must be applied before publishing crew totals.
  function applyCrewTotals(state,result){
    if(!validPlan(result))throw new TypeError('fleet-staffing-reconcile-plan-invalid');
    if(result.unstaffed)throw new Error('fleet-staffing-reconcile-plan-incomplete');
    state.crew=Array.isArray(state?.crew)?state.crew:[];
    for(let index=0;index<ROLE_IDS.length;index++){
      const id=ROLE_IDS[index],fallback=ROLE_DEFAULTS[id];let saved=state.crew.find(role=>role.id===id);
      if(!saved){saved={id,sector:['pilots','cabin','aeng'].includes(id)?'air':['captains','sailors','seng'].includes(id)?'sea':'road',name:fallback.name,count:0,salaryMin:fallback.dailyRate,salaryMax:fallback.dailyRate,morale:90};state.crew.push(saved);}
      saved.count=result.roleCounts[index];
    }
    return state.crew;
  }
  function* chunks(result,size=256){if(!validPlan(result))throw new TypeError('fleet-staffing-reconcile-plan-invalid');const width=Math.max(1,Math.floor(Number(size)||256));for(let from=0;from<result.indices.length;from+=width)yield result.indices.subarray(from,Math.min(result.indices.length,from+width));}
  function transferables(result){return validPlan(result)?[result.indices.buffer,result.roleCounts.buffer]:[];}

  const API=Object.freeze({VERSION,SCHEMA,FIELDS,ROLE_DEFAULTS,ROLE_IDS,normalized,requestKey,capture,serializableCapture,plan,run:plan,validPlan,current,lookup,applyCrewTotals,chunks,transferables});
  globalThis.GH_FLEET_STAFFING_RECONCILE_PLAN=API;
  if(globalThis.window&&globalThis.window!==globalThis)globalThis.window.GH_FLEET_STAFFING_RECONCILE_PLAN=API;
  if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
