// Build 372: one pure fleet pass for UI counters that previously walked the
// complete fleet independently.  The pass is worker safe: it reads only the
// supplied state/fleet and returns structured cloneable data.
//
// The result deliberately contains no asset views.  A view is a Proxy on the
// compact store, so retaining a million of them is both expensive and unsafe
// across later writes.  Decision making code must also revalidate a result
// against the exact store revision and simulation time; capture/current below
// provide that contract for a main thread cache, while the fleet worker adds
// its own runtime/revision tag around this result.
(()=>{
  'use strict';

  const VERSION='1.2.0',SCHEMA='gh-fleet-ui-summary-v3';
  const FIELDS=Object.freeze([
    'ownerCompanyId','companyId','assetMode','type','phase','status','routeId','simulationFault',
    'salePending','condition','purchasePrice','baseFacility','from','to','staffing'
  ]);
  const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
  const modeOf=row=>String(row?.assetMode||row?.type||'').trim();
  const clean=value=>String(value||'').trim();

  function legacyValue(source,mode){
    if(typeof source==='function')return source(mode);
    if(source instanceof Map)return source.get(mode);
    return source&&typeof source==='object'?source[mode]:undefined;
  }

  // This is app.js' assetOwnerCompanyId rule.  A worker must receive the
  // serializable legacyOwner table.  Missing legacy ownership marks the whole
  // result legacy so a caller cannot silently attribute those rows to ''.
  function ownerResolver(options,flag){
    if(typeof options.resolveOwner==='function')return (state,row)=>clean(options.resolveOwner(state,row));
    // Convert entry arrays once, outside the million-row loop.
    const legacy=Array.isArray(options.legacyOwner)?new Map(options.legacyOwner):options.legacyOwner;
    return (_state,row)=>{
      const explicit=clean(row?.ownerCompanyId||row?.companyId);if(explicit)return explicit;
      const mode=modeOf(row),resolved=clean(legacyValue(legacy,mode));
      if(!resolved)flag.legacy=true;
      return resolved;
    };
  }

  // Mirror GH_FLEET_DATA.payrollTotals rather than summing monthlyPayroll per
  // row.  The compact store groups equal immutable profiles, multiplies each
  // value by its live multiplicity, then adds those groups in first-seen
  // order.  Keeping that arithmetic order matters for decimal payrolls and
  // also avoids exposing the store's first class-table build to a UI render.
  function payrollAccumulator(state,fleet,options){
    const store=typeof fleet?.storeOf==='function'?fleet.storeOf(state):null,native=!!store;
    const legacy=Array.isArray(options.legacyOwner)?new Map(options.legacyOwner):options.legacyOwner;
    const groups=native?new Map():null,totals=Object.create(null);
    const add=(company,monthlyPayroll,headcount,count=1)=>{
      let row=totals[company];if(!row)row=totals[company]={monthlyPayroll:0,headcount:0,staffedAssets:0};
      row.monthlyPayroll+=monthlyPayroll*count;row.headcount+=headcount*count;row.staffedAssets+=count;
    };
    const companyOf=row=>{
      // The compact schema stores ownerCompanyId in the immutable profile;
      // companyId is an extras-era ownership fallback and is therefore not
      // visible to STORE.forEachPayrollGroup/payrollTotals.
      if(native)return String(row?.ownerCompanyId||'');
      const resolved=row?.ownerCompanyId||row?.companyId||(typeof options.resolveOwner==='function'?options.resolveOwner(state,row):legacyValue(legacy,modeOf(row)))||'';
      return String(resolved);
    };
    return {
      visit(row){
        const staff=row?.staffing;if(staff?.ready!==true)return;
        const company=companyOf(row);if(!company)return;
        const monthlyPayroll=Number(staff.monthlyPayroll)||0,headcount=Number(staff.total)||0;
        if(!native){add(company,monthlyPayroll,headcount);return;}
        const key=`${company}\u0000${monthlyPayroll}\u0000${headcount}`;let group=groups.get(key);
        if(!group){group={company,monthlyPayroll,headcount,count:0};groups.set(key,group);}group.count++;
      },
      finish(){
        if(groups)for(const group of groups.values())add(group.company,group.monthlyPayroll,group.headcount,group.count);
        let monthlyPayroll=0,headcount=0,staffedAssets=0;
        // Object.values preserves payrollTotals/monthlyPayroll's company-key
        // ordering, including integer-like company ids.
        for(const row of Object.values(totals)){monthlyPayroll+=row.monthlyPayroll;headcount+=row.headcount;staffedAssets+=row.staffedAssets;}
        return {monthlyPayroll,headcount,staffedAssets,companies:Object.entries(totals).map(([company,row])=>[company,{...row}])};
      }
    };
  }

  const freshStats=()=>({total:0,moving:0,movingRaw:0,routed:0,active:0,needsService:0,healthy:0,pendingSale:0,conditionSum:0,purchasePrice:0,bookValue70:0,bankCollateral55:0});
  function addStats(out,row,presentedPhase){
    const condition=Number(row.condition),price=Math.max(0,Number(row.purchasePrice)||0);
    out.total++;
    if(presentedPhase==='moving')out.moving++;
    if(row.phase==='moving'||row.status==='moving')out.movingRaw++;
    if(row.routeId)out.routed++;
    if(row.routeId||row.phase==='moving'||row.status==='moving')out.active++;
    if(condition<85)out.needsService++;
    if(condition>=65)out.healthy++;
    if(row.salePending)out.pendingSale++;
    out.conditionSum+=condition||100;
    out.purchasePrice+=price;
    // Keep app.js fleetBookValueTotal's coercion and row order verbatim.
    out.bookValue70+=Number((row.purchasePrice||0)*.7)||0;
    // Banking Core used to multiply each row before adding it.  Keeping that
    // order avoids a floating-point change when review-limits consumes the
    // worker summary instead of repeating one full scan per company.
    out.bankCollateral55+=Math.max(0,Number(row.purchasePrice)||0)*.55;
  }

  function bucket(map,key){let row=map.get(key);if(!row){row=freshStats();map.set(key,row);}return row;}
  function ownerBucket(map,key){let row=map.get(key);if(!row){row=freshStats();row.modes=new Map();row.routes=new Set();map.set(key,row);}return row;}

  function normalizeFacilities(options){
    const rows=[];
    for(const value of options.facilities||[]){
      const mode=clean(value?.mode||value?.type);if(mode!=='air'&&mode!=='sea')continue;
      if(!value||!own(value,'id'))throw new TypeError('fleet-ui-facility-id-missing');
      rows.push({id:value.id,city:value.city,mode});
    }
    for(const value of options.airports||[]){if(!value||!own(value,'id'))throw new TypeError('fleet-ui-facility-id-missing');rows.push({id:value.id,city:value.city,mode:'air'});}
    for(const value of options.ports||[]){if(!value||!own(value,'id'))throw new TypeError('fleet-ui-facility-id-missing');rows.push({id:value.id,city:value.city,mode:'sea'});}
    return rows;
  }

  // Build lookup tables once.  `marks` deduplicates a row that matches the
  // same facility through both endpoints and its unassigned base, preserving
  // shipCountsForPorts' Set semantics without allocating a Set per asset.
  function facilityCounter(descriptors){
    const counts=new Uint32Array(descriptors.length),marks=new Uint32Array(descriptors.length);
    const airCity=new Map(),seaCity=new Map(),airBase=new Map(),seaBase=new Map();let generation=0;
    const put=(map,key,index)=>{let list=map.get(key);if(!list){list=[];map.set(key,list);}list.push(index);};
    descriptors.forEach((row,index)=>{
      if(row.mode==='air'){
        // planesAtAirport compares endpoints directly with facility.city.
        put(airCity,row.city,index);put(airBase,row.id,index);
      }else{
        // shipCountsForPorts stringifies non-empty city keys.
        const city=String(row.city||'');if(city)put(seaCity,city,index);put(seaBase,row.id,index);
      }
    });
    const add=list=>{for(const index of list||[])if(marks[index]!==generation){marks[index]=generation;counts[index]++;}};
    const visit=row=>{
      generation=(generation+1)>>>0;
      // Reset the row marks on Uint32 wrap.
      if(generation===0){marks.fill(0);generation=1;}
      if(row.type==='air'){
        if(row.phase==='turnaround'){add(airCity.get(row.to));add(airCity.get(row.from));}
        if(!row.routeId)add(airBase.get(row.baseFacility));
      }else if(row.type==='sea'){
        if(row.phase==='turnaround'){
          if(row.to)add(seaCity.get(String(row.to)));
          if(row.from)add(seaCity.get(String(row.from)));
        }
        if(!row.routeId)add(seaBase.get(row.baseFacility));
      }
    };
    return {visit,finish:()=>descriptors.map((row,index)=>({id:row.id,mode:row.mode,count:counts[index]}))};
  }

  function finishStats(row){return {...row};}
  function finishOwner(row,staffing=null){
    const out=finishStats(row);delete out.modes;delete out.routes;
    out.routeCount=row.routes.size;
    out.modes=[...row.modes].map(([key,value])=>[key,finishStats(value)]);
    out.monthlyPayroll=Number(staffing?.monthlyPayroll)||0;
    out.headcount=Number(staffing?.headcount)||0;
    out.staffedAssets=Number(staffing?.staffedAssets)||0;
    return out;
  }

  function compute(state,fleet,options={}){
    if(!fleet||typeof fleet.scan!=='function')throw new TypeError('fleet-ui-summary-scan-unavailable');
    const flag={legacy:false},resolveOwner=ownerResolver(options,flag),owners=new Map(),modes=new Map(),types=new Map(),bases=new Map(),all=freshStats();
    const descriptors=normalizeFacilities(options),locations=facilityCounter(descriptors),payroll=payrollAccumulator(state,fleet,options);
    fleet.scan(state,FIELDS,row=>{
      const owner=resolveOwner(state,row),mode=modeOf(row),type=row.type,presented=typeof fleet.presentedPhase==='function'?fleet.presentedPhase(state,row):row.phase;
      addStats(all,row,presented);addStats(bucket(modes,mode),row,presented);addStats(bucket(types,type),row,presented);
      if(owner){const owned=ownerBucket(owners,owner);addStats(owned,row,presented);addStats(bucket(owned.modes,mode),row,presented);if(row.routeId)owned.routes.add(row.routeId);}
      // app.js/facility-core use row.baseFacility || null for these counts.
      if(row.baseFacility)bases.set(row.baseFacility,(bases.get(row.baseFacility)||0)+1);
      if(descriptors.length)locations.visit(row);
      payroll.visit(row);
    });
    const staffing=payroll.finish(),staffingByCompany=new Map(staffing.companies),allStats=finishStats(all);
    allStats.monthlyPayroll=staffing.monthlyPayroll;allStats.headcount=staffing.headcount;allStats.staffedAssets=staffing.staffedAssets;
    return {
      schema:SCHEMA,version:VERSION,legacy:flag.legacy,requestKey:requestKey(options),
      asOfSimSeconds:Math.max(0,Number(state?.simSeconds)||0),all:allStats,staffing,
      owners:[...owners].map(([key,value])=>[key,finishOwner(value,staffingByCompany.get(key))]),
      modes:[...modes].map(([key,value])=>[key,finishStats(value)]),
      types:[...types].map(([key,value])=>[key,finishStats(value)]),
      bases:[...bases],facilities:locations.finish()
    };
  }

  // Stable cache key for serializable query parameters.  Functions are main
  // thread only and intentionally make a cache request unique to that function.
  const functionIds=new WeakMap();let nextFunctionId=1;
  function stable(value,seen=new Set()){
    if(typeof value==='function'){let id=functionIds.get(value);if(!id){id=nextFunctionId++;functionIds.set(value,id);}return `fn:${id}`;}
    if(value===null||typeof value!=='object')return JSON.stringify(value);
    if(seen.has(value))throw new TypeError('fleet-ui-summary-options-cycle');seen.add(value);
    let out;
    if(value instanceof Map)out=`map:[${[...value].map(([key,item])=>`${stable(key,seen)}:${stable(item,seen)}`).join(',')}]`;
    else if(Array.isArray(value))out=`[${value.map(item=>stable(item,seen)).join(',')}]`;
    else out=`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stable(value[key],seen)}`).join(',')}}`;
    seen.delete(value);return out;
  }
  function hash(value){let out=2166136261>>>0;for(let index=0;index<value.length;index++){out^=value.charCodeAt(index);out=Math.imul(out,16777619);}return (out>>>0).toString(36);}
  function requestKey(options={}){
    const relevant={legacyOwner:options.legacyOwner??null,facilities:options.facilities??null,airports:options.airports??null,ports:options.ports??null,resolveOwner:options.resolveOwner??null};
    return `${SCHEMA}:${hash(stable(relevant))}`;
  }

  // Facility descriptors affect only the facility counters. All other figures
  // can be reused from an exact caller-validated summary of the same fleet.
  // No asset is visited and a missing descriptor requires the ordinary pass.
  function project(result,previousOptions={},options={}){
    if(!result||result.schema!==SCHEMA||result.legacy||result.requestKey!==requestKey(previousOptions))return null;
    if(typeof previousOptions.resolveOwner==='function'||typeof options.resolveOwner==='function'||typeof previousOptions.legacyOwner==='function'||typeof options.legacyOwner==='function')return null;
    if(stable(previousOptions.legacyOwner??null)!==stable(options.legacyOwner??null)||stable(previousOptions.resolveOwner??null)!==stable(options.resolveOwner??null))return null;
    const requested=normalizeFacilities(options),facilities=[];
    if(requested.length){
      const previous=normalizeFacilities(previousOptions),index=new Map();if(previous.length!==result.facilities?.length)return null;
      for(let i=0;i<previous.length;i++){
        const descriptor=previous[i],row=result.facilities[i];if(!row||!Object.is(row.id,descriptor.id)||row.mode!==descriptor.mode||!Number.isSafeInteger(row.count)||row.count<0)return null;
        let ids=index.get(descriptor.mode);if(!ids){ids=new Map();index.set(descriptor.mode,ids);}let cities=ids.get(descriptor.id);if(!cities){cities=new Map();ids.set(descriptor.id,cities);}cities.set(descriptor.city,row.count);
      }
      for(const descriptor of requested){const cities=index.get(descriptor.mode)?.get(descriptor.id);if(!cities?.has(descriptor.city))return null;facilities.push({id:descriptor.id,mode:descriptor.mode,count:cities.get(descriptor.city)});}
    }
    return {...result,requestKey:requestKey(options),facilities};
  }

  // Exact cache freshness.  Mutable legacy arrays deliberately return
  // cacheable:false: length/identity cannot detect an in-place asset write.
  function capture(state,fleet,options={}){
    const store=typeof fleet?.storeOf==='function'?fleet.storeOf(state):null,revision=typeof fleet?.revision==='function'?fleet.revision(state):null;
    const membership=typeof fleet?.membershipRevision==='function'?fleet.membershipRevision(state):null,length=typeof fleet?.scanLength==='function'?fleet.scanLength(state):(typeof fleet?.size==='function'?fleet.size(state):null);
    let runtime=null;if(store&&options.storeApi&&typeof options.storeApi.chunkStamp==='function')runtime=options.storeApi.chunkStamp(store)?.runtime??null;
    return {source:store||null,runtime,revision,membership,length,simSeconds:Math.max(0,Number(state?.simSeconds)||0),requestKey:requestKey(options),cacheable:!!store&&revision!==null&&revision!==undefined};
  }
  function current(stamp,state,fleet,options={}){
    if(!stamp?.cacheable)return false;const now=capture(state,fleet,options);
    return now.cacheable&&stamp.source===now.source&&stamp.runtime===now.runtime&&stamp.revision===now.revision&&stamp.membership===now.membership&&stamp.length===now.length&&stamp.simSeconds===now.simSeconds&&stamp.requestKey===now.requestKey;
  }

  const lookupCache=new WeakMap();
  function lookup(result){
    if(!result||typeof result!=='object')throw new TypeError('fleet-ui-summary-result-required');
    let cached=lookupCache.get(result);if(cached)return cached;
    const owners=new Map(result.owners||[]),ownerModes=new Map(),modes=new Map(result.modes||[]),types=new Map(result.types||[]),bases=new Map(result.bases||[]),facilities=new Map(),staffing=new Map(result.staffing?.companies||[]);
    for(const [id,row] of owners)ownerModes.set(id,new Map(row?.modes||[]));
    for(const row of result.facilities||[]){let byId=facilities.get(row.mode);if(!byId){byId=new Map();facilities.set(row.mode,byId);}byId.set(row.id,row.count);}
    cached=Object.freeze({
      owner:id=>owners.get(String(id))||null,
      ownerMode:(id,mode)=>ownerModes.get(String(id))?.get(String(mode))||null,
      staffing:id=>staffing.get(String(id))||null,staffingTotal:result.staffing||null,
      mode:id=>modes.get(String(id))||null,type:id=>types.get(id)||null,
      base:id=>bases.get(id)||0,facility:(mode,id)=>facilities.get(mode)?.get(id)||0
    });lookupCache.set(result,cached);return cached;
  }

  const API=Object.freeze({VERSION,SCHEMA,FIELDS,compute,run:compute,requestKey,project,capture,current,lookup});
  globalThis.GH_FLEET_UI_SUMMARY=API;
  if(globalThis.window&&globalThis.window!==globalThis)globalThis.window.GH_FLEET_UI_SUMMARY=API;
  if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
