// Pure worker plan for the fleet-wide "sell all" preflight.
//
// It preserves app.js' owner predicate, row order and saleEstimate arithmetic,
// while returning row numbers in a transferable typed array.  The caller asks
// for confirmation from count/moving/estimated, then rechecks current() and
// applies the rows in a staged transaction.  No Proxy or asset object crosses
// the worker boundary.
(()=>{
  'use strict';
  const VERSION='1.0.1',SCHEMA='gh-fleet-sale-plan-v1',YEAR_SECONDS=365*86400;
  const FIELDS=Object.freeze(['id','ownerCompanyId','companyId','assetMode','type','salePending','phase','ownership','monthlyLease','catalogId','purchasePrice','year','condition']);
  const object=value=>value!==null&&typeof value==='object';
  const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
  const copy=value=>{if(!object(value))return value;if(globalThis.structuredClone)try{return structuredClone(value);}catch(_error){}return JSON.parse(JSON.stringify(value));};
  const same=(a,b)=>{if(Object.is(a,b))return true;if(!object(a)||!object(b))return false;try{return JSON.stringify(a)===JSON.stringify(b);}catch(_error){return false;}};
  const modeOf=row=>String(row?.assetMode||row?.type||'').trim();
  const legacyValue=(source,mode)=>source instanceof Map?source.get(mode):(source&&typeof source==='object'?source[mode]:undefined);
  const sourceOf=(state,fleet)=>typeof fleet?.source==='function'?fleet.source(state):(state?.fleet||state?.assets||null);
  const revisionOf=(state,fleet)=>typeof fleet?.revision==='function'?fleet.revision(state):Number.isFinite(state?.fleet?.revision)?state.fleet.revision:null;
  const membershipOf=(state,fleet)=>typeof fleet?.membershipRevision==='function'?fleet.membershipRevision(state):(Array.isArray(state?.assets)?`array:${state.assets.length}`:null);
  const lengthOf=(state,fleet)=>typeof fleet?.scanLength==='function'?fleet.scanLength(state):(Array.isArray(state?.assets)?state.assets.length:Number(state?.fleet?.length)||0);

  function ownerResolver(legacyOwner,flag){return row=>{const explicit=row?.ownerCompanyId||row?.companyId;if(explicit)return String(explicit).trim();const found=legacyValue(legacyOwner,modeOf(row));if(found===undefined||found===null||found==='')flag.legacy=true;return String(found||'').trim();};}
  function catalogItem(catalog,type,id){
    const section=catalog?.[type];if(!section)return null;
    if(Array.isArray(section)){for(const item of section)if(item?.id===id)return item;return null;}
    for(const list of [section.new,section.used])if(Array.isArray(list))for(const item of list)if(item?.id===id)return item;
    return null;
  }
  function saleEstimate(row,simSeconds,catalog){
    if(row?.ownership==='lease')return -(Number(row.monthlyLease)||0)*2;
    const item=catalogItem(catalog,row?.type,row?.catalogId),basis=Number(row?.purchasePrice)||Number(item?.price)||1000000,residual=Math.max(.15,Math.min(.95,(Number(item?.residual5y)||60)/100));
    const built=Number(row?.year)||2026,ageYears=Math.max(0,2026+(Number(simSeconds)||0)/YEAR_SECONDS-built),value=Number(row?.purchasePrice)?basis*Math.pow(residual,Math.max(0,ageYears-Math.max(0,2026-built))/5):basis*Math.pow(residual,ageYears/5);
    return value*(.7+.3*Math.max(0,Math.min(100,Number(row?.condition??100)))/100);
  }
  const dependencyKey=(type,id)=>JSON.stringify([type===undefined?['undefined']:['value',type],id===undefined?['undefined']:['value',id]]);
  function recordDependency(table,catalog,row){const key=dependencyKey(row?.type,row?.catalogId);if(table.has(key))return;const item=catalogItem(catalog,row?.type,row?.catalogId);table.set(key,{type:copy(row?.type),catalogId:copy(row?.catalogId),found:!!item,item:item?copy(item):null});}
  function dependenciesCurrent(rows,catalog){for(const row of rows||[]){const item=catalogItem(catalog,row.type,row.catalogId);if(Boolean(item)!==row.found||item&&!same(item,row.item))return false;}return true;}

  function capture(state,fleet,{companyId,requestToken=null,catalogToken=null,ownerToken=null,arrayRevision=null}={}){
    companyId=String(companyId||'').trim();if(!companyId)throw new TypeError('fleet-sale-company');
    return {source:sourceOf(state,fleet),revision:revisionOf(state,fleet),membership:copy(membershipOf(state,fleet)),length:lengthOf(state,fleet),simSeconds:Number(state?.simSeconds)||0,resetEpoch:Number(state?.resetEpoch)||0,
      companyId,requestToken:copy(requestToken),catalogToken:copy(catalogToken),ownerToken:copy(ownerToken),arrayRevision:copy(arrayRevision)};
  }
  function serializableCapture(stamp){if(!stamp)return null;return {revision:stamp.revision,membership:copy(stamp.membership),length:stamp.length,simSeconds:stamp.simSeconds,resetEpoch:stamp.resetEpoch,companyId:stamp.companyId,requestToken:copy(stamp.requestToken),catalogToken:copy(stamp.catalogToken),ownerToken:copy(stamp.ownerToken),arrayRevision:copy(stamp.arrayRevision)};}

  class Uint32Builder{
    constructor(chunk=16384){this.chunk=chunk;this.parts=[];this.used=0;this.length=0;}
    push(value){if(!(Number.isSafeInteger(value)&&value>=0&&value<=0xFFFFFFFF))throw new RangeError('fleet-sale-index');if(!this.parts.length||this.used===this.chunk){this.parts.push(new Uint32Array(this.chunk));this.used=0;}this.parts[this.parts.length-1][this.used++]=value;this.length++;}
    finish(){const out=new Uint32Array(this.length);let at=0;for(let i=0;i<this.parts.length;i++){const take=i===this.parts.length-1?this.used:this.chunk;out.set(this.parts[i].subarray(0,take),at);at+=take;}return out;}
  }
  function plan(state,fleet,{companyId,catalog={},legacyOwner=null,request=null}={}){
    if(!fleet||typeof fleet.scan!=='function')throw new TypeError('fleet-sale-scan-unavailable');companyId=String(companyId||'').trim();if(!companyId)throw new TypeError('fleet-sale-company');
    const flag={legacy:false},owner=ownerResolver(legacyOwner,flag),indices=new Uint32Builder(),dependencies=new Map(),simSeconds=Number(state?.simSeconds)||0;let moving=0,estimated=0;
    fleet.scan(state,FIELDS,(row,index)=>{
      if(owner(row)!==companyId||row.salePending)return;
      indices.push(index);if(row.phase==='moving')moving++;if(row.ownership!=='lease')recordDependency(dependencies,catalog,row);estimated+=Math.max(0,saleEstimate(row,simSeconds,catalog));
    });
    if(flag.legacy)return {schema:SCHEMA,version:VERSION,legacy:true};
    const selected=indices.length;return {schema:SCHEMA,version:VERSION,legacy:false,companyId,sourceLength:lengthOf(state,fleet),selected,moving,estimated,indices:indices.finish(),dependencies:[...dependencies.values()],request:copy(request)};
  }
  function validPlan(result){
    if(!result||result.legacy!==false||result.schema!==SCHEMA||result.version!==VERSION||typeof result.companyId!=='string'||!result.companyId||!Number.isSafeInteger(result.sourceLength)||result.sourceLength<0||!Number.isSafeInteger(result.selected)||result.selected<0||!Number.isSafeInteger(result.moving)||result.moving<0||result.moving>result.selected||!Number.isFinite(result.estimated)||result.estimated<0||!(result.indices instanceof Uint32Array)||result.indices.length!==result.selected||!Array.isArray(result.dependencies))return false;
    let previous=-1;for(const index of result.indices){if(index<=previous||index>=result.sourceLength)return false;previous=index;}return true;
  }
  function current(stamp,state,fleet,{companyId=stamp?.companyId,requestToken=stamp?.requestToken,catalogToken=stamp?.catalogToken,ownerToken=stamp?.ownerToken,arrayRevision=null,catalog={},result=null}={}){
    if(!stamp||stamp.source!==sourceOf(state,fleet))return false;const revision=revisionOf(state,fleet);
    if(revision===null){if(arrayRevision===null||arrayRevision===undefined||!same(stamp.arrayRevision,arrayRevision))return false;}else if(!Object.is(stamp.revision,revision))return false;
    if(!same(stamp.membership,membershipOf(state,fleet))||stamp.length!==lengthOf(state,fleet)||!Object.is(stamp.simSeconds,Number(state?.simSeconds)||0)||!Object.is(stamp.resetEpoch,Number(state?.resetEpoch)||0)||stamp.companyId!==String(companyId||'').trim()||!same(stamp.requestToken,requestToken)||!same(stamp.catalogToken,catalogToken)||!same(stamp.ownerToken,ownerToken))return false;
    return !result||(validPlan(result)&&result.companyId===stamp.companyId&&result.sourceLength===stamp.length&&same(result.request,serializableCapture(stamp))&&dependenciesCurrent(result.dependencies,catalog));
  }
  function* chunks(result,size=256){if(!validPlan(result))throw new TypeError('fleet-sale-plan-invalid');const width=Math.max(1,Math.floor(Number(size)||256));for(let from=0;from<result.selected;from+=width)yield result.indices.subarray(from,Math.min(result.selected,from+width));}
  // Immediate sales remove rows. Processing bounded chunks from the highest row
  // down keeps every lower plan index stable without copying a million ids.
  function* reverseChunks(result,size=256){if(!validPlan(result))throw new TypeError('fleet-sale-plan-invalid');const width=Math.max(1,Math.floor(Number(size)||256));for(let to=result.selected;to>0;to-=width)yield result.indices.subarray(Math.max(0,to-width),to);}
  const transferables=result=>validPlan(result)?[result.indices.buffer]:[];
  const API=Object.freeze({VERSION,SCHEMA,FIELDS,catalogItem,saleEstimate,capture,serializableCapture,plan,run:plan,validPlan,current,chunks,reverseChunks,transferables});
  globalThis.GH_FLEET_SALE_PLAN=API;if(globalThis.window&&window!==globalThis)window.GH_FLEET_SALE_PLAN=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
