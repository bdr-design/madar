// Build 372: the pure, shared row pass used by the daily fleet close.
//
// This module only reads the supplied state/fleet.  In particular, the three
// flight-counter writes are returned as a compact Float32 plan plus an ordered
// Float64 exception plan. A counter held in extras, a value which cannot be
// represented exactly by Float32, or a non-finite value therefore stays exact
// without making the main thread scan the fleet again. Both views share the two
// buffers already transferred for columns.indices / columns.values.
(()=>{
  'use strict';

  const VERSION='1.0.0',SCHEMA='gh-fleet-day-v1',canonicalScan=globalThis.GH_FLEET_DATA?.scan;
  const OWNER_TOTAL_FIELDS=Object.freeze(['ownerCompanyId','companyId','company','assetMode','type','purchasePrice','condition','ownership','monthlyLease','leaseTermMonths','leaseStartSeconds','deliveredAtSeconds','year','lastTrip','staffing']);
  const OPS_FIELDS=Object.freeze(['assetMode','type','specs','lastTrip','condition','purchasePrice','phase','flightHours','flightCycles','nextCheckHours']);
  const FIELDS=Object.freeze([...new Set(['id',...OWNER_TOTAL_FIELDS,...OPS_FIELDS,'routeId','simulationFault'])]);
  const COLUMN_FIELDS=Object.freeze(['flightHours','flightCycles','nextCheckHours']);

  const USEFUL_YEARS=Object.freeze({air:20,sea:25,road:8,power:25,bank:12,group:20});
  const SALVAGE_PCT=Object.freeze({air:.12,sea:.15,road:.08,power:.10,bank:.05,group:.05});
  const MAINTENANCE_POLICIES=Object.freeze({preventive:90,standard:80,deferred:65});
  const CHECK_COST=Object.freeze({air:.004,sea:.003,road:.006});
  const CHECKS_PER_DAY=2000;
  // Owner decision (19 Oct 2026): a company's daily checks go to its lowest-condition assets, ties in row order. The
  // first rows under the line took them all, so the later rows of a fleet larger than the capacity were never checked.
  // A bounded heap holds the candidates (its root the least urgent); the chosen rows are summed in row order, as before.
  // Twin of realism-core's queueCheck/settleChecks (the main-thread pass): keep both the same.
  const lessUrgent=(a,b)=>a.condition>b.condition||(a.condition===b.condition&&a.index>b.index);
  function queueCheck(heap,condition,index,id){
    let at;
    if(heap.length<CHECKS_PER_DAY){at=heap.length;heap.push({condition,index,id,cost:0});
      while(at>0){const up=(at-1)>>1;if(!lessUrgent(heap[at],heap[up]))break;const swap=heap[at];heap[at]=heap[up];heap[up]=swap;at=up;}return heap[at];}
    const entry=heap[0];if(condition>entry.condition||(condition===entry.condition&&index>entry.index))return null;
    entry.condition=condition;entry.index=index;entry.id=id;at=0;
    for(;;){const left=at*2+1,right=left+1;let top=at;if(left<heap.length&&lessUrgent(heap[left],heap[top]))top=left;if(right<heap.length&&lessUrgent(heap[right],heap[top]))top=right;if(top===at)break;const swap=heap[at];heap[at]=heap[top];heap[top]=swap;at=top;}
    return entry;
  }
  function settleChecks(maint,heap){heap.sort((a,b)=>a.index-b.index);for(const entry of heap){maint.due.push(entry.id);maint.restored+=100-entry.condition;maint.cost+=entry.cost;}heap.length=0;}
  const INCIDENT_RATE=Object.freeze({air:.000044,sea:.000077,road:.00038});
  const PREMIUM_RATE=Object.freeze({air:.0035,sea:.006,road:.03});
  const INCIDENT_SAMPLE=64;
  const LICENCE_FEE=Object.freeze({air:25000,sea:15000,road:1200});
  const INSPECTION_FINE=Object.freeze({air:40000,sea:30000,road:5000});
  const UNSAFE_CONDITION=65;
  const CII_CO2_PER_TONNE=3.114;
  const CII_DWT_PER_UNIT=Object.freeze({'TEU':13,'طن':1,'م³':.5,'سيارات':2.5,'سيارة':2.5,'راكب':50});

  const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,Number(n)||0));
  const modeOf=row=>String(row?.assetMode||row?.type||'').trim();
  const ownerKeyOf=row=>`${row?.ownerCompanyId}\u0000${row?.companyId}\u0000${row?.company}\u0000${row?.assetMode}\u0000${row?.type}`;
  function addDailyMetrics(metrics,row,compact){
    metrics.rows++;if((compact?(row.phase||(!row.simulationFault?(row.routeId?'moving':'idle'):row.phase)):row.phase)==='moving')metrics.moving++;
    const mix=metrics.mix,rawBand=row.specs?.co2Band||'C',rawType=row.type;
    // Preserve the original string-key/split behavior even for malformed legacy values containing a separator.
    const simpleBand=rawBand==='A'||rawBand==='B'||rawBand==='C'||rawBand==='D',simpleType=rawType==='road'||rawType==='air'||rawType==='sea';
    const parts=simpleBand&&simpleType?null:`${rawBand}|${rawType}|${row.specs?.electric||row.specs?.hydrogen?1:0}`.split('|'),band=parts?parts[0]:rawBand,type=parts?parts[1]:rawType,electric=parts?parts[2]==='1':!!(row.specs?.electric||row.specs?.hydrogen);
    mix.total++;if(band==='A'||band==='B')mix.lowEmission++;if(type==='road'){mix.road++;if(electric)mix.electricRoad++;}
  }

  function valueMap(value){
    if(value instanceof Map)return value;
    if(Array.isArray(value))return new Map(value);
    if(value&&typeof value==='object')return new Map(Object.keys(value).map(key=>[key,value[key]]));
    return new Map();
  }

  // A function gives the main thread an exact adapter to assetOwnerCompanyId.
  // Workers use the serializable descriptor instead:
  // {platform, knownCompanies, legacyOwners:[[mode, companyId], ...]}.
  function makeOwnerResolver(state,options,flag){
    if(typeof options.resolveOwner==='function')return row=>String(options.resolveOwner(state,row)||'').trim();
    const descriptor=options.ownerResolution;
    if(!descriptor){
      return row=>{
        const explicit=String(row?.ownerCompanyId||row?.companyId||'').trim();if(explicit)return explicit;
        flag.legacy=true;return '';
      };
    }
    const platform=descriptor.platform!==false,known=new Set(descriptor.knownCompanies||[]),legacy=valueMap(descriptor.legacyOwners);
    return row=>{
      const explicit=String(row?.ownerCompanyId||row?.companyId||'').trim();if(explicit)return explicit;
      const company=String(row?.company||'').trim();if(company&&platform&&known.has(company))return company;
      const mode=modeOf(row);return String(platform?(legacy.get(mode)||''):mode).trim();
    };
  }

  function makePolicyResolver(state,options){
    if(typeof options.maintenancePolicy==='function')return owner=>options.maintenancePolicy(state,owner);
    const supplied=options.maintenancePolicies,policies=supplied===undefined?null:valueMap(supplied);
    return owner=>{
      const raw=policies?(policies.has(owner)?policies.get(owner):undefined):state?.advanced?.companies?.[owner]?.maintenancePolicy;
      return own(MAINTENANCE_POLICIES,raw)?raw:'standard';
    };
  }

  function ciiDeadweight(specs){const per=CII_DWT_PER_UNIT[String(specs?.capacityUnit||'')];return per?Math.max(0,Number(specs?.capacity)||0)*per:0;}
  function ciiReference(dwt){return 1984*Math.pow(Math.max(1,dwt),-.489);}

  function makeColumnPlan(state,fleet,options){
    const total=Math.max(0,Math.floor(Number(fleet.scanLength?.(state))||0));
    // The common path stays f32 (12 MB of values at one million air rows). Rare
    // values which need exact f64 storage have their own ordered stream.
    let capacity=Math.min(total||16,4096),indices=new Int32Array(capacity),values=new Float32Array(capacity*COLUMN_FIELDS.length),count=0;
    let exceptionalCapacity=Math.min(total||16,16),exceptionalIndices=new Int32Array(exceptionalCapacity),exceptionalValues=new Float64Array(exceptionalCapacity*COLUMN_FIELDS.length),exceptionalCount=0;
    const mode=typeof fleet.mode==='function'?fleet.mode(state):null,store=options.store||(typeof fleet.storeOf==='function'?fleet.storeOf(state):null),storeApi=options.storeApi||globalThis.GH_FLEET_STORE||null;
    const canCheckExtras=!store||!!storeApi&&typeof storeApi.extrasOf==='function';
    const reasons=new Set();let firstExceptional=null,extrasRows=0,nonExactRows=0;

    const grow=required=>{
      if(required<=capacity)return;
      let next=Math.max(required,capacity?capacity*2:16);if(total)next=Math.min(total,next);
      if(next<required)next=required;
      const nextIndices=new Int32Array(next),nextValues=new Float32Array(next*COLUMN_FIELDS.length);nextIndices.set(indices);nextValues.set(values);indices=nextIndices;values=nextValues;capacity=next;
    };
    const growExceptional=required=>{
      if(required<=exceptionalCapacity)return;
      let next=Math.max(required,exceptionalCapacity?exceptionalCapacity*2:16);if(total)next=Math.min(total,next);
      if(next<required)next=required;
      const nextIndices=new Int32Array(next),nextValues=new Float64Array(next*COLUMN_FIELDS.length);nextIndices.set(exceptionalIndices);nextValues.set(exceptionalValues);exceptionalIndices=nextIndices;exceptionalValues=nextValues;exceptionalCapacity=next;
    };
    const rowValues=[0,0,0];
    const add=(index,hours,cycles,next)=>{
      rowValues[0]=hours;rowValues[1]=cycles;rowValues[2]=next;
      let extras=false,nonExact=false,detail=null;
      if(store&&canCheckExtras){const extra=storeApi.extrasOf(store,index);for(let k=0;k<COLUMN_FIELDS.length;k++)if(extra&&own(extra,COLUMN_FIELDS[k])){extras=true;detail=detail||{index,field:COLUMN_FIELDS[k],reason:'extras'};}}
      for(let k=0;k<COLUMN_FIELDS.length;k++)if(!Number.isFinite(rowValues[k])||!Object.is(Math.fround(rowValues[k]),rowValues[k])){nonExact=true;detail=detail||{index,field:COLUMN_FIELDS[k],reason:'non-hot-exact'};}
      if(extras){extrasRows++;reasons.add('extras');}if(nonExact){nonExactRows++;reasons.add('non-hot-exact');}
      // Exact f32 values remain in the staged plan even when their old value is
      // in extras: columnPlanStages preflights that case and columnWriter moves
      // it back to the hot slot exactly. Values outside the finite exact-f32
      // domain use the Float64 stream.
      if(nonExact){
        growExceptional(exceptionalCount+1);exceptionalIndices[exceptionalCount]=index;const at=exceptionalCount*COLUMN_FIELDS.length;for(let k=0;k<COLUMN_FIELDS.length;k++)exceptionalValues[at+k]=rowValues[k];exceptionalCount++;if(!firstExceptional)firstExceptional=detail;return;
      }
      grow(count+1);indices[count]=index;const at=count*COLUMN_FIELDS.length;for(let k=0;k<COLUMN_FIELDS.length;k++)values[at+k]=rowValues[k];count++;
    };
    const finish=()=>{
      // Pack both streams into the buffers the existing query transport already
      // transfers. Structured clone preserves all views backed by those buffers.
      const indexBuffer=new ArrayBuffer((count+exceptionalCount)*Int32Array.BYTES_PER_ELEMENT),exactIndices=new Int32Array(indexBuffer,0,count),exactExceptionalIndices=new Int32Array(indexBuffer,count*Int32Array.BYTES_PER_ELEMENT,exceptionalCount);exactIndices.set(indices.subarray(0,count));exactExceptionalIndices.set(exceptionalIndices.subarray(0,exceptionalCount));
      const fastBytes=count*COLUMN_FIELDS.length*Float32Array.BYTES_PER_ELEMENT,exceptionalOffset=Math.ceil(fastBytes/Float64Array.BYTES_PER_ELEMENT)*Float64Array.BYTES_PER_ELEMENT,valueBuffer=new ArrayBuffer(exceptionalOffset+exceptionalCount*COLUMN_FIELDS.length*Float64Array.BYTES_PER_ELEMENT),exactValues=new Float32Array(valueBuffer,0,count*COLUMN_FIELDS.length),exactExceptionalValues=new Float64Array(valueBuffer,exceptionalOffset,exceptionalCount*COLUMN_FIELDS.length);exactValues.set(values.subarray(0,count*COLUMN_FIELDS.length));exactExceptionalValues.set(exceptionalValues.subarray(0,exceptionalCount*COLUMN_FIELDS.length));
      // The formulas above deliberately collapse an input NaN through `||`;
      // therefore NaN can never be a valid output.  Keep that domain rule on
      // the transferred plan so Fleet Store can enforce it in its sliced
      // validation pass, before it snapshots or writes any column.
      return {fields:COLUMN_FIELDS,indices:exactIndices,values:exactValues,count,exceptional:{indices:exactExceptionalIndices,values:exactExceptionalValues,count:exceptionalCount},totalCount:count+exceptionalCount,rejectNaN:true,unsupported:false,unsupportedRows:0,exceptionalRows:exceptionalCount,extrasRows,nonExactRows,firstUnsupported:null,firstExceptional,reasons:[...reasons],preflight:{mode:mode||(store?'store':'unknown'),complete:true,extrasChecked:!!store&&canCheckExtras}};
    };
    return {add,finish};
  }

  function compute(state,fleet,options={}){
    if(!fleet||typeof fleet.scan!=='function')throw new TypeError('fleet-day-scan-unavailable');
    const ownerFlag={legacy:false},resolveOwner=makeOwnerResolver(state,options,ownerFlag),policyOf=makePolicyResolver(state,options),owners=new Map(),ownerTotals=new Map(),maintenance=new Map(),checks=new Map(),columns=makeColumnPlan(state,fleet,options);
    const simSeconds=Math.max(0,Number(state?.simSeconds)||0),simYear=2026+Math.floor(simSeconds/(365*86400)),monthlyRate=Math.pow(1.07,1/12)-1;
    const economy=state?.realism?.economy||{},airDemand=own(options,'airDemand')?options.airDemand:economy.airDemand,bunkerValue=own(options,'bunker')?options.bunker:economy.bunker;
    const demand=clamp((airDemand||100)/100,.65,1.35),bunker=Math.max(1,bunkerValue);
    const compact=typeof fleet.mode==='function'&&fleet.mode(state)==='store';
    let insured=0,readiness=0;const dailyMetrics={rows:0,moving:0,mix:{total:0,lowEmission:0,road:0,electricRoad:0}};
    let ask=0,rpk=0,rev=0,cost=0,fuel=0,movingAir=0,airCondition=0,maintReserve=0,maintExposure=0,airCount=0,maintenanceDue=0,aog=0;
    let seaDistance=0,seaFuelProxy=0,seaTransport=0,seaCo2=0,seaWork=0,seaRefWork=0,seaCondition=0,movingSea=0,seaCount=0,seaDryDock=0,roadCount=0,roadWeak=0,roadDamaged=0;

    const STORE=options.storeApi||globalThis.GH_FLEET_STORE,store=fleet.storeOf?.(state),views=STORE?.isStore?.(store)&&fleet.scan===canonicalScan?STORE.views(store):null,profileMemo=views?new Map():null;let scratch=null;
    function fixed(row,out={}){
      const ownerKey=ownerKeyOf(row),price=Math.max(0,Number(row.purchasePrice)||0),mode=modeOf(row),payroll=Number(row.staffing?.monthlyPayroll)||0;
      out.ownerKey=ownerKey;out.price=price;out.mode=mode;out.payroll=payroll;
      if(row.ownership==='lease'){
        const monthly=Math.max(0,Number(row.monthlyLease)||0),term=Math.max(12,Number(row.leaseTermMonths)||60),start=Math.max(0,Number(row.leaseStartSeconds)||Number(row.deliveredAtSeconds)||simSeconds),elapsed=Math.min(term,Math.max(0,Math.floor((simSeconds-start)/(30*86400)))),remaining=Math.max(0,term-elapsed);
        const pv=monthlyRate?monthly*(1-Math.pow(1+monthlyRate,-remaining))/monthlyRate:monthly*remaining,initialPv=monthlyRate?monthly*(1-Math.pow(1+monthlyRate,-term))/monthlyRate:monthly*term;
        out.lease=true;out.pv=pv;out.carrying=initialPv*Math.max(0,1-elapsed/term);out.depr=term?initialPv/term:0;out.interest=pv*monthlyRate;return out;
      }
      const life=USEFUL_YEARS[mode]||15,salvage=price*(SALVAGE_PCT[mode]||.08),modelYear=Math.min(simYear,Math.max(2000,Number(row.year)||simYear)),ageYears=Math.max(0,simYear-modelYear),annualDep=Math.max(0,(price-salvage)/life),accum=Math.min(price-salvage,annualDep*ageYears),book=Math.max(salvage,price-accum);
      out.lease=false;out.book=book;out.depr=annualDep/12;out.rawPrice=Number(row.purchasePrice)||0;return out;
    }
    // Request-local memo over the real scan's immutable profiles. Extras and alternate adapters keep the full formulas.
    // Every per-row addition still executes in original row order; no multiplication replaces financial accumulation.
    function fixedFor(row,index){
      if(!views||views.u8[index*128+STORE.O.flags]&STORE.EXTRAS)return fixed(row,scratch||(scratch={}));
      const ref=views.u32[index*STORE.WORDS_PER_ROW+STORE.O.profile];let cached=profileMemo.get(ref);
      if(!cached){if(profileMemo.size<4096){cached=fixed(row);profileMemo.set(ref,cached);}else cached=fixed(row,scratch||(scratch={}));}return cached;
    }
    fleet.scan(state,FIELDS,(row,index)=>{
      addDailyMetrics(dailyMetrics,row,compact);
      const constants=fixedFor(row,index),ownerKey=constants.ownerKey;let owner=owners.get(ownerKey);if(owner===undefined){owner=resolveOwner(row);owners.set(ownerKey,owner);}

      let total=ownerTotals.get(owner);if(!total){total={assetVal:0,depr:0,leaseLiab:0,rou:0,leaseInterest:0,owned:0,fuelCost:0,maintReserve:0,payroll:0};ownerTotals.set(owner,total);}
      const price=constants.price,condition=clamp(Number(row.condition)||100,0,100);
      if(constants.lease){total.leaseLiab+=constants.pv;total.rou+=constants.carrying;total.depr+=constants.depr;total.leaseInterest+=constants.interest;}
      else{total.assetVal+=constants.book*(.75+.25*condition/100);total.depr+=constants.depr;total.owned+=constants.rawPrice*clamp((Number(row.condition)||100)/100,.4,1);}
      total.fuelCost+=Number(row.lastTrip?.fuelCost)||0;total.maintReserve+=Number(row.lastTrip?.maintReserve)||0;total.payroll+=constants.payroll;

      let maint=maintenance.get(owner);if(!maint){const policy=policyOf(owner);maint={threshold:MAINTENANCE_POLICIES[own(MAINTENANCE_POLICIES,policy)?policy:'standard'],conditionSum:0,restored:0,count:0,due:[],cost:0,value:0,risk:0,premium:0,sample:[],licence:0,fine:0,unsafe:0};maintenance.set(owner,maint);checks.set(maint,[]);}
      const mode=constants.mode;maint.conditionSum+=condition;maint.count++;maint.value+=price;maint.risk+=INCIDENT_RATE[mode]||INCIDENT_RATE.road;maint.premium+=price*(PREMIUM_RATE[mode]||PREMIUM_RATE.road);maint.licence+=LICENCE_FEE[mode]||LICENCE_FEE.road;if(condition<UNSAFE_CONDITION){maint.unsafe++;maint.fine+=INSPECTION_FINE[mode]||INSPECTION_FINE.road;}if(maint.sample.length<INCIDENT_SAMPLE)maint.sample.push({id:row.id,price});if(condition<maint.threshold){const entry=queueCheck(checks.get(maint),condition,index,row.id);if(entry)entry.cost=Math.max(0,Number(row.purchasePrice)||0)*(CHECK_COST[modeOf(row)]||CHECK_COST.road);}

      if(mode==='air'){
        const cap=Math.max(0,Number(row.specs?.capacity)||0),distance=Math.max(0,Number(row.lastTrip?.distanceKm)||Number(row.lastTrip?.distance)||0),airCond=condition,conditionFactor=clamp(.82+(airCond-70)*.004,.70,1.06),loadFactor=clamp(.78*demand*conditionFactor,.52,.96);
        ask+=cap*Math.max(1,distance);rpk+=cap*loadFactor*Math.max(1,distance);rev+=Number(row.lastTrip?.revenue)||0;
        const fuelCost=Number(row.lastTrip?.fuelCost)||0,crewCost=Number(row.lastTrip?.crewCost)||0,reserve=Number(row.lastTrip?.maintReserve)||0;fuel+=fuelCost;maintReserve+=reserve;maintExposure+=Math.max(0,(100-airCond)/100)*(Number(row.purchasePrice)||0)*.0008;cost+=fuelCost+crewCost+reserve;
        if(row.phase==='moving')movingAir++;airCondition+=airCond;airCount++;
        const flightHours=(Number(row.flightHours)||0)+(row.phase==='moving'?4:0),flightCycles=(Number(row.flightCycles)||0)+(row.phase==='turnaround'?1:0),nextCheckHours=Number(row.nextCheckHours)||600;columns.add(index,flightHours,flightCycles,nextCheckHours);
        if(flightHours>=nextCheckHours||Number(row.condition)<72)maintenanceDue++;if(Number(row.condition)<60)aog++;
      }else if(mode==='sea'){
        const distance=Math.max(1,Number(row.lastTrip?.distanceKm)||Number(row.lastTrip?.distance)||1),capacity=Math.max(1,Number(row.specs?.capacity)||Number(row.specs?.teu)||Number(row.specs?.dwt)||1),seaCond=condition;seaDistance+=distance;seaTransport+=distance*capacity;const fuelTonnes=Math.max(0,Number(row.lastTrip?.fuelCost)||0)/bunker;seaFuelProxy+=fuelTonnes;const dwt=ciiDeadweight(row.specs);if(dwt>0&&fuelTonnes>0){const work=dwt*distance/1.852;seaCo2+=fuelTonnes*CII_CO2_PER_TONNE*1e6;seaWork+=work;seaRefWork+=ciiReference(dwt)*work;}seaCondition+=seaCond;if(row.phase==='moving')movingSea++;seaCount++;if(Number(row.condition)<70)seaDryDock++;
      }else if(mode==='road'){roadCount++;if(Number(row.condition)<70)roadWeak++;if(Number(row.condition)<75)roadDamaged++;}

      const rawCondition=Number(row.condition);insured+=rawCondition||100;readiness+=rawCondition||0;
    });

    for(const maint of maintenance.values())settleChecks(maint,checks.get(maint));
    const ops={ask,rpk,rev,cost,fuel,movingAir,airCondition,maintReserve,maintExposure,airCount,maintenanceDue,aog,seaDistance,seaFuelProxy,seaTransport,seaCo2,seaWork,seaRefWork,seaCondition,movingSea,seaCount,seaDryDock,roadCount,roadWeak,roadDamaged};
    return {schema:SCHEMA,version:VERSION,legacy:ownerFlag.legacy,ownerTotals:[...ownerTotals],ops,maintenance:[...maintenance],condition:{insured,readiness},dailyMetrics,columns:columns.finish()};
  }

  const API=Object.freeze({VERSION,SCHEMA,FIELDS,OWNER_TOTAL_FIELDS,OPS_FIELDS,COLUMN_FIELDS,addDailyMetrics,compute,run:compute});
  globalThis.GH_FLEET_DAY_CORE=API;
  if(globalThis.window&&globalThis.window!==globalThis)globalThis.window.GH_FLEET_DAY_CORE=API;
  if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
