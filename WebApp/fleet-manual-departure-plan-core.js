// Worker-side preflight for app.js departRouteAssets.
//
// One fleet pass selects the exact atomic batch, checks all row-local blockers
// and builds the route-user groups required by the existing route-conflict
// rules.  Only row numbers cross back to the main thread.  Blocker details are
// capped at the 30 rows the UI can display; reason totals remain exact.
(()=>{
  'use strict';
  const VERSION='1.0.1',SCHEMA='gh-fleet-manual-departure-plan-v1',EARTH_RADIUS_KM=6371.0088;
  const FIELDS=Object.freeze(['id','name','ownerCompanyId','companyId','assetMode','type','routeId','routeSignature','phase','departureScheduled','deliveryStatus','salePending','specs','baseFacility','staffing']);
  const BASE_CAPACITY=Object.freeze({air:24,sea:24,road:64}),MAX_CAPACITY=Object.freeze({air:8192,sea:8192,road:8192});
  const REASONS=Object.freeze(['','no-route-data','route-company-mismatch','asset-unavailable','route-range-invalid','asset-location-mismatch','asset-staffing-invalid','route-not-exclusive','route-capacity-full']);
  const REASON_CODE=Object.freeze(Object.fromEntries(REASONS.map((value,index)=>[value,index])));
  const object=value=>value!==null&&typeof value==='object';
  const copy=value=>{if(!object(value))return value;if(globalThis.structuredClone)try{return structuredClone(value);}catch(_error){}return JSON.parse(JSON.stringify(value));};
  const same=(a,b)=>{if(Object.is(a,b))return true;if(!object(a)||!object(b))return false;try{return JSON.stringify(a)===JSON.stringify(b);}catch(_error){return false;}};
  const modeOf=row=>String(row?.assetMode||row?.type||'').trim();
  const routeMode=route=>String(route?.routeMode||route?.type||'').trim();
  const legacyValue=(source,key)=>source instanceof Map?source.get(key):(source&&typeof source==='object'?source[key]:undefined);
  const sourceOf=(state,fleet)=>typeof fleet?.source==='function'?fleet.source(state):(state?.fleet||state?.assets||null);
  const revisionOf=(state,fleet)=>typeof fleet?.revision==='function'?fleet.revision(state):Number.isFinite(state?.fleet?.revision)?state.fleet.revision:null;
  const membershipOf=(state,fleet)=>typeof fleet?.membershipRevision==='function'?fleet.membershipRevision(state):(Array.isArray(state?.assets)?`array:${state.assets.length}`:null);
  const lengthOf=(state,fleet)=>typeof fleet?.scanLength==='function'?fleet.scanLength(state):(Array.isArray(state?.assets)?state.assets.length:Number(state?.fleet?.length)||0);
  const normalizeMode=value=>{value=String(value||'').trim();if(!BASE_CAPACITY[value])throw new TypeError('fleet-manual-departure-mode');return value;};
  function assetOwner(row,legacy,flag){const explicit=row?.ownerCompanyId||row?.companyId;if(explicit)return String(explicit).trim();const found=legacyValue(legacy,modeOf(row));if(found===undefined||found===null||found==='')flag.legacy=true;return String(found||'').trim();}
  function routeOwner(route,legacy,flag){const mode=routeMode(route),explicit=route?.ownerCompanyId||route?.companyId||route?.company;if(explicit)return String(explicit).trim();const found=legacyValue(legacy,mode);if(found===undefined||found===null||found==='')flag.legacy=true;return String(found||'').trim();}
  function routeMap(routes){const out=new Map();if(routes instanceof Map){for(const [id,row] of routes)out.set(String(id),row);}else if(Array.isArray(routes)){for(const value of routes){const [id,row]=Array.isArray(value)?value:[value?.id,value];if(id!==undefined)out.set(String(id),row);}}else for(const [id,row] of Object.entries(routes||{}))out.set(String(id),row);return out;}
  function facilityMap(rows){const out=new Map();if(rows instanceof Map){for(const [id,row] of rows)out.set(String(id),row);}else if(Array.isArray(rows)){for(const row of rows)if(row&&row.id!==undefined)out.set(String(row.id),row);}else if(object(rows)){for(const [id,row] of Object.entries(rows))out.set(String(id),row);}return out;}
  function sameFacility(baseId,routeId,facilities){
    if(!baseId||!routeId)return false;if(baseId===routeId)return true;const a=facilities.get(String(baseId)),b=facilities.get(String(routeId));if(!a||!b)return false;
    return Boolean((a.iata&&a.iata===b.iata)||(a.icao&&a.icao===b.icao)||(a.code&&a.code===b.code));
  }
  function haversine(a,b){const rad=Math.PI/180,lat1=a[0]*rad,lat2=b[0]*rad,dLat=(b[0]-a[0])*rad,dLon=(b[1]-a[1])*rad,h=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;return 2*EARTH_RADIUS_KM*Math.asin(Math.sqrt(h));}
  function routeDistance(points){let total=0;for(let i=0;i<(points?.length||0)-1;i++)total+=haversine(points[i],points[i+1]);return total;}
  function routeLongestLeg(points){let longest=0;for(let i=0;i<(points?.length||0)-1;i++)longest=Math.max(longest,haversine(points[i],points[i+1]));return longest;}
  function routeFits(row,route){const range=row.type==='sea'?(row.specs?.rangeNm||0)*1.852:(row.specs?.rangeKm||0),leg=row.type==='road'?(route.roadNetworkDistanceKm||route.distanceKm||routeDistance(route.route)):(route.maxLegKm||routeLongestLeg(route.route));return !range||leg<=range*1.005;}
  function routeCapacity(route){const mode=routeMode(route),base=BASE_CAPACITY[mode]||1,stored=route?.fleetCapacity;return Number.isSafeInteger(stored)&&stored>base?Math.min(stored,MAX_CAPACITY[mode]||base):base;}
  function routeCore(explicit){const core=explicit||globalThis.GH_ROUTE_CORE;if(!core?.signature||!core?.corridorIndex||!core?.corridorMetrics)throw new Error('fleet-manual-departure-route-core-missing');return core;}

  class NumberBuilder{
    constructor(Type=Uint32Array,chunk=16384){this.Type=Type;this.chunk=chunk;this.parts=[];this.used=0;this.length=0;}
    push(value){if(!(Number.isSafeInteger(value)&&value>=0))throw new RangeError('fleet-manual-departure-number');if(!this.parts.length||this.used===this.chunk){this.parts.push(new this.Type(this.chunk));this.used=0;}this.parts[this.parts.length-1][this.used++]=value;this.length++;}
    finish(Type=this.Type){const out=new Type(this.length);let at=0;for(let i=0;i<this.parts.length;i++){const take=i===this.parts.length-1?this.used:this.chunk;out.set(this.parts[i].subarray(0,take),at);at+=take;}return out;}
  }
  const refType=count=>count<=0x100?Uint8Array:count<=0x10000?Uint16Array:Uint32Array;
  const groupKey=(company,mode,routeId)=>`${company}\u0000${mode}\u0000${routeId}`;
  function firstOther(group,assetId){return group?.users?.find(row=>row.id!==assetId)||null;}
  function reasonText(code,conflictName='',capacity=0){
    if(code===REASON_CODE['no-route-data'])return 'لا يوجد مسار تشغيلي صالح مرتبط بهذا الأصل.';
    if(code===REASON_CODE['route-company-mismatch'])return 'المسار لا يتبع الشركة المالكة لهذا الأصل.';
    if(code===REASON_CODE['asset-unavailable'])return 'الأصل قيد التسليم أو البيع ولا يقبل أمر مغادرة.';
    if(code===REASON_CODE['route-range-invalid'])return 'المسار يتجاوز مدى الأصل أو قيود التشغيل.';
    if(code===REASON_CODE['asset-location-mismatch'])return 'موقع الأصل لا يطابق إحدى نقطتي المسار.';
    if(code===REASON_CODE['asset-staffing-invalid'])return 'سجل الطاقم الثابت لهذا الأصل غير مكتمل. أعد فحص الأصل؛ لا توجد موافقة HR مطلوبة.';
    if(code===REASON_CODE['route-not-exclusive'])return `المسار أو ممر مماثل مستخدم بواسطة ${conflictName}.`;
    if(code===REASON_CODE['route-capacity-full'])return `مسار الأسطول تجاوز سعته التشغيلية (${capacity} أصل).`;
    return '';
  }
  function capture(state,fleet,{companyId,type,routeId=null,assetId=null,requestToken=null,routesToken=null,facilitiesToken=null,ownerToken=null,arrayRevision=null}={}){
    companyId=String(companyId||'').trim();if(!companyId)throw new TypeError('fleet-manual-departure-company');type=normalizeMode(type);
    return {source:sourceOf(state,fleet),revision:revisionOf(state,fleet),membership:copy(membershipOf(state,fleet)),length:lengthOf(state,fleet),simSeconds:Number(state?.simSeconds)||0,resetEpoch:Number(state?.resetEpoch)||0,
      companyId,type,routeId:copy(routeId),assetId:copy(assetId),requestToken:copy(requestToken),routesToken:copy(routesToken),facilitiesToken:copy(facilitiesToken),ownerToken:copy(ownerToken),arrayRevision:copy(arrayRevision)};
  }
  function serializableCapture(stamp){if(!stamp)return null;return {revision:stamp.revision,membership:copy(stamp.membership),length:stamp.length,simSeconds:stamp.simSeconds,resetEpoch:stamp.resetEpoch,companyId:stamp.companyId,type:stamp.type,routeId:copy(stamp.routeId),assetId:copy(stamp.assetId),requestToken:copy(stamp.requestToken),routesToken:copy(stamp.routesToken),facilitiesToken:copy(stamp.facilitiesToken),ownerToken:copy(stamp.ownerToken),arrayRevision:copy(stamp.arrayRevision)};}

  function plan(state,fleet,{companyId,type,routeId=null,assetId=null,routes={},registeredRoutes=[],facilities=[],legacyOwner=null,legacyRouteOwner=null,routeCore:explicitRouteCore=null,request=null,blockerLimit=30}={}){
    if(!fleet||typeof fleet.scan!=='function')throw new TypeError('fleet-manual-departure-scan-unavailable');companyId=String(companyId||'').trim();if(!companyId)throw new TypeError('fleet-manual-departure-company');type=normalizeMode(type);
    const allRoutes=routeMap(routes),facilityById=facilityMap(facilities),flag={legacy:false},indices=new NumberBuilder(Uint32Array),routeRefs=new NumberBuilder(Uint32Array),preliminary=new NumberBuilder(Uint8Array),routeIds=[],routeRefById=new Map(),groups=new Map();
    const refOf=value=>{const id=String(value);let ref=routeRefById.get(id);if(ref===undefined){ref=routeIds.length;routeRefById.set(id,ref);routeIds.push(id);}return ref;};
    fleet.scan(state,FIELDS,(row,index)=>{
      const mode=modeOf(row);let owner='';
      if(mode===type){owner=assetOwner(row,legacyOwner,flag);if(owner===companyId&&row.routeId){const id=String(row.routeId),key=groupKey(companyId,type,id);let group=groups.get(key);if(!group){group={companyId,mode:type,routeId:id,count:0,first:index,users:[]};groups.set(key,group);}group.count++;if(group.users.length<2)group.users.push({id:row.id,name:row.name,routeSignature:row.routeSignature});}}
      if(owner!==companyId||mode!==type||!row.routeId||(routeId&&row.routeId!==routeId)||(assetId&&row.id!==assetId)||row.phase!=='turnaround'||row.departureScheduled)return;
      const id=String(row.routeId),route=allRoutes.get(id),ref=refOf(id);let code=0;
      if(!route)code=REASON_CODE['no-route-data'];
      else if(routeMode(route)!==mode||!owner||routeOwner(route,legacyRouteOwner,flag)!==owner)code=REASON_CODE['route-company-mismatch'];
      else if(row.deliveryStatus==='pending'||row.salePending)code=REASON_CODE['asset-unavailable'];
      else if(!routeFits(row,route))code=REASON_CODE['route-range-invalid'];
      else if(!row.baseFacility||(!sameFacility(row.baseFacility,route.fromFacility,facilityById)&&!sameFacility(row.baseFacility,route.toFacility,facilityById)))code=REASON_CODE['asset-location-mismatch'];
      else if(row.staffing?.mode!=='automatic-fixed'||row.staffing.ready!==true)code=REASON_CODE['asset-staffing-invalid'];
      indices.push(index);routeRefs.push(ref);preliminary.push(code);
    });
    if(flag.legacy)return {schema:SCHEMA,version:VERSION,legacy:true};
    const indexArray=indices.finish(),routeRefArray=routeRefs.finish(refType(routeIds.length)),preliminaryArray=preliminary.finish(Uint8Array),conflicts=new Array(routeIds.length).fill(null);
    if(type==='air'&&routeIds.length){
      const core=routeCore(explicitRouteCore),registered=(registeredRoutes||[]).filter(Boolean),registeredById=new Map(registered.map(route=>[String(route.id),route])),registeredRelevant=registered.filter(route=>routeMode(route)==='air'&&routeOwner(route,legacyRouteOwner,flag)===companyId),corridors=core.corridorIndex(registeredRelevant),order=[...groups.values()].filter(group=>group.mode==='air').sort((a,b)=>a.first-b.first).map(group=>group.routeId),position=new Map(order.map((id,at)=>[id,at])),unregistered=order.filter(id=>!registeredById.has(id)),signatureCache=new Map();
      const signature=route=>{if(!route)return null;if(!signatureCache.has(route))signatureCache.set(route,core.signature(route));return signatureCache.get(route);};
      for(let ref=0;ref<routeIds.length;ref++){
        const id=routeIds[ref],route=allRoutes.get(id),sameGroup=groups.get(groupKey(companyId,type,id));if(!route)continue;
        if(sameGroup&&sameGroup.count-1>=routeCapacity(route)){conflicts[ref]={group:sameGroup};continue;}
        const exact=signature(route),pool=new Set(unregistered);for(const other of corridors.candidates(route))pool.add(String(other.id));const ordered=[...pool].filter(other=>position.has(other)).sort((a,b)=>position.get(a)-position.get(b));
        for(const otherId of ordered){if(otherId===id)continue;const otherGroup=groups.get(groupKey(companyId,'air',otherId));if(!otherGroup?.count)continue;const registeredRoute=registeredById.get(otherId),otherSignature=registeredRoute?signature(registeredRoute):otherGroup.users[0]?.routeSignature;if(exact&&otherSignature&&exact===otherSignature){conflicts[ref]={group:otherGroup};break;}if(registeredRoute&&core.corridorMetrics(registeredRoute,route)?.duplicate){conflicts[ref]={group:otherGroup};break;}}
      }
    }else for(let ref=0;ref<routeIds.length;ref++){const route=allRoutes.get(routeIds[ref]),sameGroup=groups.get(groupKey(companyId,type,routeIds[ref]));if(route&&sameGroup&&sameGroup.count-1>=routeCapacity(route))conflicts[ref]={group:sameGroup};}
    if(flag.legacy)return {schema:SCHEMA,version:VERSION,legacy:true};
    const counts=new Map(),blockedOffsets=[];let blocked=0;{const requested=Number(blockerLimit);blockerLimit=Math.max(0,Math.min(100,Number.isFinite(requested)?Math.floor(requested):30));}
    for(let offset=0;offset<indexArray.length;offset++){const code=preliminaryArray[offset]||(conflicts[routeRefArray[offset]]?REASON_CODE[type==='air'?'route-not-exclusive':'route-capacity-full']:0);if(!code)continue;blocked++;const name=REASONS[code];counts.set(name,(counts.get(name)||0)+1);if(blockedOffsets.length<blockerLimit)blockedOffsets.push([offset,code]);}
    const blockers=[];
    for(const [offset,code] of blockedOffsets){const index=indexArray[offset],row=typeof fleet.viewAt==='function'?fleet.viewAt(state,index):(Array.isArray(state?.assets)?state.assets[index]:null),conflict=conflicts[routeRefArray[offset]],other=code===REASON_CODE['route-not-exclusive']?firstOther(conflict?.group,row?.id):null,route=allRoutes.get(String(row?.routeId));blockers.push({id:row?.id,name:row?.name,type:modeOf(row),companyId:assetOwner(row,legacyOwner,flag),routeId:row?.routeId,phase:row?.phase,code:REASONS[code],text:reasonText(code,other?.name||'أصل آخر',route?routeCapacity(route):0)});}
    const seenRoutes=new Set(),traceRouteIds=[];for(const ref of routeRefArray){const id=routeIds[ref];if(!seenRoutes.has(id)){seenRoutes.add(id);if(traceRouteIds.length<12)traceRouteIds.push(id);}}
    return {schema:SCHEMA,version:VERSION,legacy:false,companyId,type,routeId:copy(routeId),assetId:copy(assetId),sourceLength:lengthOf(state,fleet),selected:indexArray.length,blocked,indices:indexArray,reasonCounts:[...counts],blockers,routeIds:traceRouteIds,request:copy(request)};
  }
  function validPlan(result){
    if(!result||result.legacy!==false||result.schema!==SCHEMA||result.version!==VERSION||typeof result.companyId!=='string'||!result.companyId||!BASE_CAPACITY[result.type]||!Number.isSafeInteger(result.sourceLength)||result.sourceLength<0||!Number.isSafeInteger(result.selected)||result.selected<0||!Number.isSafeInteger(result.blocked)||result.blocked<0||result.blocked>result.selected||!(result.indices instanceof Uint32Array)||result.indices.length!==result.selected||!Array.isArray(result.reasonCounts)||result.reasonCounts.some(row=>!Array.isArray(row)||!REASON_CODE[row[0]]||!Number.isSafeInteger(row[1])||row[1]<=0)||!Array.isArray(result.blockers)||result.blockers.length>100||result.blockers.length>result.blocked||!Array.isArray(result.routeIds)||result.routeIds.length>12||new Set(result.routeIds).size!==result.routeIds.length||result.reasonCounts.reduce((sum,row)=>sum+row[1],0)!==result.blocked)return false;
    let previous=-1;for(const index of result.indices){if(index<=previous||index>=result.sourceLength)return false;previous=index;}return result.blockers.every(row=>row&&REASON_CODE[row.code]&&typeof row.text==='string');
  }
  function current(stamp,state,fleet,{companyId=stamp?.companyId,type=stamp?.type,routeId=stamp?.routeId,assetId=stamp?.assetId,requestToken=stamp?.requestToken,routesToken=stamp?.routesToken,facilitiesToken=stamp?.facilitiesToken,ownerToken=stamp?.ownerToken,arrayRevision=null,result=null}={}){
    if(!stamp||stamp.source!==sourceOf(state,fleet))return false;const revision=revisionOf(state,fleet);
    if(revision===null){if(arrayRevision===null||arrayRevision===undefined||!same(stamp.arrayRevision,arrayRevision))return false;}else if(!Object.is(stamp.revision,revision))return false;
    if(!same(stamp.membership,membershipOf(state,fleet))||stamp.length!==lengthOf(state,fleet)||!Object.is(stamp.simSeconds,Number(state?.simSeconds)||0)||!Object.is(stamp.resetEpoch,Number(state?.resetEpoch)||0)||stamp.companyId!==String(companyId||'').trim()||stamp.type!==normalizeMode(type)||!same(stamp.routeId,routeId)||!same(stamp.assetId,assetId)||!same(stamp.requestToken,requestToken)||!same(stamp.routesToken,routesToken)||!same(stamp.facilitiesToken,facilitiesToken)||!same(stamp.ownerToken,ownerToken))return false;
    return !result||(validPlan(result)&&result.companyId===stamp.companyId&&result.type===stamp.type&&same(result.routeId,stamp.routeId)&&same(result.assetId,stamp.assetId)&&result.sourceLength===stamp.length&&same(result.request,serializableCapture(stamp)));
  }
  function* chunks(result,size=256){if(!validPlan(result)||result.blocked)throw new TypeError(result?.blocked?'fleet-manual-departure-blocked':'fleet-manual-departure-plan-invalid');const width=Math.max(1,Math.floor(Number(size)||256));for(let from=0;from<result.selected;from+=width)yield result.indices.subarray(from,Math.min(result.selected,from+width));}
  const transferables=result=>validPlan(result)?[result.indices.buffer]:[];
  const API=Object.freeze({VERSION,SCHEMA,FIELDS,REASONS,REASON_CODE,routeFits,routeCapacity,capture,serializableCapture,plan,run:plan,validPlan,current,chunks,transferables});
  globalThis.GH_FLEET_MANUAL_DEPARTURE_PLAN=API;if(globalThis.window&&window!==globalThis)window.GH_FLEET_MANUAL_DEPARTURE_PLAN=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
