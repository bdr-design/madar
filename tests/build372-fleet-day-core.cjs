'use strict';
// Differential contract for the pure daily fleet pass.  The reference below
// is deliberately self-contained: it does not call helpers exported by the
// implementation under test.
const assert=require('node:assert/strict');
const STORE=require('../WebApp/fleet-store-core.js');
const FLEET=require('../WebApp/fleet-access-core.js');
const DAY=require('../WebApp/fleet-day-core.js');
const QUERY=require('../WebApp/fleet-query-core.js');

const REF_FIELDS=['id','ownerCompanyId','companyId','company','assetMode','type','purchasePrice','condition','ownership','monthlyLease','leaseTermMonths','leaseStartSeconds','deliveredAtSeconds','year','lastTrip','staffing','specs','phase','flightHours','flightCycles','nextCheckHours'];
const YEARS={air:20,sea:25,road:8,power:25,bank:12,group:20},SALVAGE={air:.12,sea:.15,road:.08,power:.10,bank:.05,group:.05};
const POLICIES={preventive:90,standard:80,deferred:65},CHECK_COST={air:.004,sea:.003,road:.006},INCIDENT={air:.000044,sea:.000077,road:.00038},PREMIUM={air:.0035,sea:.006,road:.03};
const LICENCE={air:25000,sea:15000,road:1200},FINE={air:40000,sea:30000,road:5000},DWT={'TEU':13,'طن':1,'م³':.5,'سيارات':2.5,'سيارة':2.5,'راكب':50};
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key),clamp=(n,a,b)=>Math.max(a,Math.min(b,Number(n)||0)),modeOf=row=>String(row?.assetMode||row?.type||'').trim();

function reference(state,ownerDescriptor,maintenancePolicies){
  const candidates=new Map(),known=new Set(ownerDescriptor.knownCompanies||[]),legacy=new Map(ownerDescriptor.legacyOwners||[]),ownerCache=new Map(),totals=new Map(),maintenance=new Map();
  const ownerOf=row=>{const explicit=String(row?.ownerCompanyId||row?.companyId||'').trim();if(explicit)return explicit;const company=String(row?.company||'').trim();if(company&&ownerDescriptor.platform&&known.has(company))return company;const mode=modeOf(row);return String(ownerDescriptor.platform?(legacy.get(mode)||''):mode).trim();};
  const policyMap=new Map(maintenancePolicies),simSeconds=Math.max(0,Number(state.simSeconds)||0),simYear=2026+Math.floor(simSeconds/(365*86400)),monthlyRate=Math.pow(1.07,1/12)-1;
  const demand=clamp((state.realism.economy.airDemand||100)/100,.65,1.35),bunker=Math.max(1,state.realism.economy.bunker);
  let insured=0,readiness=0;
  let ask=0,rpk=0,rev=0,cost=0,fuel=0,movingAir=0,airCondition=0,maintReserve=0,maintExposure=0,airCount=0,maintenanceDue=0,aog=0;
  let seaDistance=0,seaFuelProxy=0,seaTransport=0,seaCo2=0,seaWork=0,seaRefWork=0,seaCondition=0,movingSea=0,seaCount=0,seaDryDock=0,roadCount=0,roadWeak=0,roadDamaged=0;
  const indices=[],values=[];
  FLEET.scan(state,REF_FIELDS,(row,index)=>{
    const key=`${row.ownerCompanyId}\u0000${row.companyId}\u0000${row.company}\u0000${row.assetMode}\u0000${row.type}`;let owner=ownerCache.get(key);if(owner===undefined){owner=ownerOf(row);ownerCache.set(key,owner);}
    let total=totals.get(owner);if(!total){total={assetVal:0,depr:0,leaseLiab:0,rou:0,leaseInterest:0,owned:0,fuelCost:0,maintReserve:0,payroll:0};totals.set(owner,total);}
    const price=Math.max(0,Number(row.purchasePrice)||0),condition=clamp(Number(row.condition)||100,0,100);
    if(row.ownership==='lease'){
      const monthly=Math.max(0,Number(row.monthlyLease)||0),term=Math.max(12,Number(row.leaseTermMonths)||60),start=Math.max(0,Number(row.leaseStartSeconds)||Number(row.deliveredAtSeconds)||simSeconds),elapsed=Math.min(term,Math.max(0,Math.floor((simSeconds-start)/(30*86400)))),remaining=Math.max(0,term-elapsed);
      const pv=monthlyRate?monthly*(1-Math.pow(1+monthlyRate,-remaining))/monthlyRate:monthly*remaining;total.leaseLiab+=pv;const initial=monthlyRate?monthly*(1-Math.pow(1+monthlyRate,-term))/monthlyRate:monthly*term;total.rou+=initial*Math.max(0,1-elapsed/term);total.depr+=term?initial/term:0;total.leaseInterest+=pv*monthlyRate;
    }else{
      const mode=modeOf(row),life=YEARS[mode]||15,salvage=price*(SALVAGE[mode]||.08),modelYear=Math.min(simYear,Math.max(2000,Number(row.year)||simYear)),age=Math.max(0,simYear-modelYear),annual=Math.max(0,(price-salvage)/life),accum=Math.min(price-salvage,annual*age),book=Math.max(salvage,price-accum);total.assetVal+=book*(.75+.25*condition/100);total.depr+=annual/12;total.owned+=(Number(row.purchasePrice)||0)*clamp((Number(row.condition)||100)/100,.4,1);
    }
    total.fuelCost+=Number(row.lastTrip?.fuelCost)||0;total.maintReserve+=Number(row.lastTrip?.maintReserve)||0;total.payroll+=Number(row.staffing?.monthlyPayroll)||0;

    let maint=maintenance.get(owner);if(!maint){const raw=policyMap.get(owner),policy=own(POLICIES,raw)?raw:'standard';maint={threshold:POLICIES[policy],conditionSum:0,restored:0,count:0,due:[],cost:0,value:0,risk:0,premium:0,sample:[],licence:0,fine:0,unsafe:0};maintenance.set(owner,maint);}
    const mode=modeOf(row);maint.conditionSum+=condition;maint.count++;maint.value+=price;maint.risk+=INCIDENT[mode]||INCIDENT.road;maint.premium+=price*(PREMIUM[mode]||PREMIUM.road);maint.licence+=LICENCE[mode]||LICENCE.road;if(condition<65){maint.unsafe++;maint.fine+=FINE[mode]||FINE.road;}if(maint.sample.length<64)maint.sample.push({id:row.id,price});if(condition<maint.threshold){if(!candidates.has(maint))candidates.set(maint,[]);candidates.get(maint).push({index,id:row.id,condition,cost:Math.max(0,Number(row.purchasePrice)||0)*(CHECK_COST[modeOf(row)]||CHECK_COST.road)});}

    if(mode==='air'){
      const cap=Math.max(0,Number(row.specs?.capacity)||0),distance=Math.max(0,Number(row.lastTrip?.distanceKm)||Number(row.lastTrip?.distance)||0),factor=clamp(.82+(condition-70)*.004,.70,1.06),lf=clamp(.78*demand*factor,.52,.96);ask+=cap*Math.max(1,distance);rpk+=cap*lf*Math.max(1,distance);rev+=Number(row.lastTrip?.revenue)||0;
      const fc=Number(row.lastTrip?.fuelCost)||0,cc=Number(row.lastTrip?.crewCost)||0,reserve=Number(row.lastTrip?.maintReserve)||0;fuel+=fc;maintReserve+=reserve;maintExposure+=Math.max(0,(100-condition)/100)*(Number(row.purchasePrice)||0)*.0008;cost+=fc+cc+reserve;if(row.phase==='moving')movingAir++;airCondition+=condition;airCount++;
      const hours=(Number(row.flightHours)||0)+(row.phase==='moving'?4:0),cycles=(Number(row.flightCycles)||0)+(row.phase==='turnaround'?1:0),next=Number(row.nextCheckHours)||600;indices.push(index);values.push(hours,cycles,next);if(hours>=next||Number(row.condition)<72)maintenanceDue++;if(Number(row.condition)<60)aog++;
    }else if(mode==='sea'){
      const distance=Math.max(1,Number(row.lastTrip?.distanceKm)||Number(row.lastTrip?.distance)||1),capacity=Math.max(1,Number(row.specs?.capacity)||Number(row.specs?.teu)||Number(row.specs?.dwt)||1);seaDistance+=distance;seaTransport+=distance*capacity;const tonnes=Math.max(0,Number(row.lastTrip?.fuelCost)||0)/bunker;seaFuelProxy+=tonnes;const per=DWT[String(row.specs?.capacityUnit||'')],dwt=per?Math.max(0,Number(row.specs?.capacity)||0)*per:0;if(dwt>0&&tonnes>0){const work=dwt*distance/1.852;seaCo2+=tonnes*3.114*1e6;seaWork+=work;seaRefWork+=1984*Math.pow(Math.max(1,dwt),-.489)*work;}seaCondition+=condition;if(row.phase==='moving')movingSea++;seaCount++;if(Number(row.condition)<70)seaDryDock++;
    }else if(mode==='road'){roadCount++;if(Number(row.condition)<70)roadWeak++;if(Number(row.condition)<75)roadDamaged++;}
    const raw=Number(row.condition);insured+=raw||100;readiness+=raw||0;
  });
  // Owner decision (19 Oct 2026): the 2,000 daily checks go to the lowest condition first, ties in row order; the chosen
  // rows are summed in row order.
  for(const [maint,rows] of candidates){const chosen=rows.slice().sort((a,b)=>a.condition-b.condition||a.index-b.index).slice(0,2000).sort((a,b)=>a.index-b.index);for(const row of chosen){maint.due.push(row.id);maint.restored+=100-row.condition;maint.cost+=row.cost;}}
  return {ownerTotals:[...totals],ops:{ask,rpk,rev,cost,fuel,movingAir,airCondition,maintReserve,maintExposure,airCount,maintenanceDue,aog,seaDistance,seaFuelProxy,seaTransport,seaCo2,seaWork,seaRefWork,seaCondition,movingSea,seaCount,seaDryDock,roadCount,roadWeak,roadDamaged},maintenance:[...maintenance],condition:{insured,readiness},indices,values};
}

function exact(actual,expected,path='result'){
  if(typeof expected==='number'){assert.ok(Object.is(actual,expected),`${path}: ${String(actual)} !== ${String(expected)}`);return;}
  if(Array.isArray(expected)){assert.ok(Array.isArray(actual),`${path}: expected array`);assert.equal(actual.length,expected.length,`${path}.length`);for(let i=0;i<expected.length;i++)exact(actual[i],expected[i],`${path}[${i}]`);return;}
  if(expected&&typeof expected==='object'){assert.ok(actual&&typeof actual==='object',`${path}: expected object`);assert.deepEqual(Object.keys(actual),Object.keys(expected),`${path}: keys`);for(const key of Object.keys(expected))exact(actual[key],expected[key],`${path}.${key}`);return;}
  assert.equal(actual,expected,path);
}
function mergedColumnPlan(plan){
  const indices=[],values=[],exceptional=plan.exceptional;let fastAt=0,exceptionalAt=0;
  while(fastAt<plan.count||exceptionalAt<exceptional.count){
    const fastIndex=fastAt<plan.count?plan.indices[fastAt]:Infinity,exceptionalIndex=exceptionalAt<exceptional.count?exceptional.indices[exceptionalAt]:Infinity,useFast=fastIndex<exceptionalIndex,row=useFast?fastAt:exceptionalAt,source=useFast?plan.values:exceptional.values;
    indices.push(useFast?fastIndex:exceptionalIndex);values.push(...source.subarray(row*3,row*3+3));if(useFast)fastAt++;else exceptionalAt++;
  }
  return {indices,values};
}

const ownerResolution={platform:true,knownCompanies:['sea-known'],legacyOwners:[['air','air-legacy'],['sea','sea-legacy'],['road','road-legacy']]};
const maintenancePolicies=[['alpha','preventive'],['sea-known','deferred'],['road-legacy','bogus'],['air-legacy','standard'],['bulk','preventive']];
const baseAssets=[
  {id:'DAY-AIR-0001',ownerCompanyId:' alpha ',companyId:'ignored',assetMode:'air',type:'air',ownership:'owned',purchasePrice:120000000,year:2020,condition:88,phase:'moving',flightHours:120,flightCycles:30,nextCheckHours:600,specs:{capacity:260,capacityUnit:'مقعد'},lastTrip:{distanceKm:4400,revenue:480000,fuelCost:90000,crewCost:25000,maintReserve:17000},staffing:{monthlyPayroll:220000}},
  {id:'DAY-AIR-0002',companyId:'alpha',assetMode:'air',ownership:'lease',monthlyLease:750000,leaseTermMonths:84,leaseStartSeconds:86400*30,deliveredAtSeconds:1,condition:0,phase:'turnaround',flightHours:599,flightCycles:81,nextCheckHours:600,specs:{capacity:150},lastTrip:{distance:700,revenue:85000,fuelCost:14000,crewCost:6000,maintReserve:3000},staffing:{monthlyPayroll:90000}},
  {id:'DAY-SEA-0001',company:'sea-known',assetMode:'sea',ownership:'owned',purchasePrice:80000000,year:2015,condition:64,phase:'moving',specs:{capacity:9000,capacityUnit:'TEU'},lastTrip:{distanceKm:5000,fuelCost:640000,revenue:1100000}},
  {id:'DAY-ROAD-0001',company:'unknown-company',type:'road',ownership:'owned',purchasePrice:-500,condition:69,phase:'idle',specs:{capacity:12},lastTrip:{distanceKm:220,fuelCost:300}},
  {id:'DAY-AIR-0003',company:'unknown-company',type:'air',ownership:'owned',purchasePrice:40000000,year:2035,condition:55,phase:'idle',flightHours:0,flightCycles:0,nextCheckHours:0,specs:{capacity:90},lastTrip:{distanceKm:0,revenue:1,fuelCost:2,crewCost:3,maintReserve:4}},
];
// The last five bulk rows are the worst: they take five of the 2,000 checks from the end of the tied rows.
for(let i=0;i<2005;i++)baseAssets.push({id:`DAY-BULK-${String(i).padStart(4,'0')}`,ownerCompanyId:'bulk',assetMode:'road',ownership:'owned',purchasePrice:1000+i,condition:i>=2000?40:50,phase:'idle'});

function makeState(assets){const state={simSeconds:86400*800,realism:{economy:{airDemand:117,bunker:713}},advanced:{companies:{}}};state.fleet=STORE.fromAssets(assets,{at:state.simSeconds});return state;}
function comparePass(state){
  const before=STORE.toAssets(state.fleet),revision=state.fleet.revision,expected=reference(state,ownerResolution,maintenancePolicies),actual=DAY.compute(state,FLEET,{ownerResolution,maintenancePolicies,storeApi:STORE});
  assert.equal(actual.schema,'gh-fleet-day-v1');assert.equal(actual.legacy,false);assert.equal(actual.columns.rejectNaN,true);assert.ok(actual.columns.indices instanceof Int32Array);assert.ok(actual.columns.values instanceof Float32Array);assert.ok(actual.columns.exceptional.indices instanceof Int32Array);assert.ok(actual.columns.exceptional.values instanceof Float64Array);assert.deepEqual(actual.columns.fields,['flightHours','flightCycles','nextCheckHours']);
  const merged=mergedColumnPlan(actual.columns);exact(actual.ownerTotals,expected.ownerTotals,'ownerTotals');exact(actual.ops,expected.ops,'ops');exact(actual.maintenance,expected.maintenance,'maintenance');exact(actual.condition,expected.condition,'condition');exact(merged.indices,expected.indices,'columns.indices');exact(merged.values,expected.values,'columns.values');
  assert.equal(actual.columns.totalCount,expected.indices.length,'all air rows are represented once');assert.equal(actual.columns.indices.buffer,actual.columns.exceptional.indices.buffer,'both index views share one transferable buffer');assert.equal(actual.columns.values.buffer,actual.columns.exceptional.values.buffer,'both value views share one transferable buffer');
  assert.deepEqual(actual.ownerTotals.map(entry=>entry[0]),['alpha','sea-known','road-legacy','air-legacy','bulk'],'owner Map insertion order');assert.deepEqual(actual.maintenance.map(entry=>entry[0]),['alpha','sea-known','road-legacy','air-legacy','bulk'],'maintenance Map insertion order');
  const bulk=actual.maintenance.find(([owner])=>owner==='bulk')[1];assert.equal(bulk.due.length,2000,'maintenance due cap');assert.equal(bulk.sample.length,64,'incident sample cap');assert.deepEqual(bulk.due.slice(0,2),['DAY-BULK-0000','DAY-BULK-0001']);assert.equal(bulk.due[1994],'DAY-BULK-1994');assert.deepEqual(bulk.due.slice(-5),['DAY-BULK-2000','DAY-BULK-2001','DAY-BULK-2002','DAY-BULK-2003','DAY-BULK-2004'],'the worst rows are checked first');
  assert.equal(state.fleet.revision,revision,'pure pass does not write revision');assert.deepEqual(STORE.toAssets(state.fleet),before,'pure pass does not alter fleet');return actual;
}

const safe=comparePass(makeState(baseAssets));
assert.equal(safe.columns.unsupported,false);assert.equal(safe.columns.preflight.complete,true);assert.equal(safe.columns.preflight.extrasChecked,true);assert.equal(safe.columns.unsupportedRows,0);

const unsafeAssets=baseAssets.map(row=>({...row}));
unsafeAssets[0]={...unsafeAssets[0],flightHours:Math.fround(.1)}; // hot input; +4 is not exactly float32
unsafeAssets[1]={...unsafeAssets[1],flightCycles:.1};             // stored in extras
const unsafeState=makeState(unsafeAssets),unsafe=comparePass(unsafeState),extra=STORE.extrasOf(unsafeState.fleet,1);
assert.ok(extra&&own(extra,'flightCycles'),'fixture keeps the target field in extras');assert.equal(unsafe.columns.unsupported,false);assert.ok(unsafe.columns.exceptional.count>=1);assert.ok(unsafe.columns.nonExactRows>=1);assert.ok(unsafe.columns.extrasRows>=1);assert.ok(unsafe.columns.reasons.includes('non-hot-exact'));assert.ok(unsafe.columns.reasons.includes('extras'));

const infiniteState=makeState(baseAssets.map((row,index)=>index===baseAssets.length-1?{...row,type:'air',assetMode:'air',flightHours:Infinity,flightCycles:0,nextCheckHours:600}:row));
const infinite=DAY.compute(infiniteState,FLEET,{ownerResolution,maintenancePolicies,storeApi:STORE});
assert.equal(infinite.columns.unsupported,false,'a non-finite late row stays in the exact exception stream');
assert.ok(infinite.columns.exceptional.values.some(value=>value===Infinity),'Infinity survives the Float64 exception plan');
assert.ok(infinite.columns.reasons.includes('non-hot-exact'));

const nullBunkerState=makeState(baseAssets);nullBunkerState.realism.economy.bunker=null;
const nullBunkerDirect=DAY.compute(nullBunkerState,FLEET,{ownerResolution,maintenancePolicies,bunker:null,airDemand:117,storeApi:STORE});
const nullBunkerQuery=QUERY.fleetDay(nullBunkerState,FLEET,{ownerResolution,maintenancePolicies,bunker:null,airDemand:117});
exact(nullBunkerQuery.ops,nullBunkerDirect.ops,'query.nullBunker.ops');

const unresolved=DAY.compute(makeState([{id:'DAY-LEGACY-1',assetMode:'air',phase:'idle',condition:100}]),FLEET,{storeApi:STORE});
assert.equal(unresolved.legacy,true,'missing serializable owner resolution is rejected by the caller');

// One-million-aircraft transport shape: the two logical streams still own
// only two transferable buffers, preserve their shared-view relationship and
// move the exceptional IEEE values without copying or widening the fast path.
{
  const total=1_000_000,fastCount=total-1,width=3,indexBuffer=new ArrayBuffer(total*Int32Array.BYTES_PER_ELEMENT),indices=new Int32Array(indexBuffer,0,fastCount),exceptionalIndices=new Int32Array(indexBuffer,fastCount*Int32Array.BYTES_PER_ELEMENT,1);
  indices[fastCount-1]=fastCount-1;exceptionalIndices[0]=total-1;
  const fastBytes=fastCount*width*Float32Array.BYTES_PER_ELEMENT,exceptionalOffset=Math.ceil(fastBytes/Float64Array.BYTES_PER_ELEMENT)*Float64Array.BYTES_PER_ELEMENT,valueBuffer=new ArrayBuffer(exceptionalOffset+width*Float64Array.BYTES_PER_ELEMENT),values=new Float32Array(valueBuffer,0,fastCount*width),exceptionalValues=new Float64Array(valueBuffer,exceptionalOffset,width);
  values[values.length-1]=600;exceptionalValues.set([Infinity,-Infinity,-0]);
  const moved=structuredClone({fields:['flightHours','flightCycles','nextCheckHours'],indices,values,count:fastCount,exceptional:{indices:exceptionalIndices,values:exceptionalValues,count:1},totalCount:total,rejectNaN:true},{transfer:[indexBuffer,valueBuffer]});
  assert.equal(indexBuffer.byteLength,0);assert.equal(valueBuffer.byteLength,0);assert.equal(moved.indices.length,fastCount);assert.equal(moved.exceptional.indices[0],total-1);assert.equal(moved.indices.buffer,moved.exceptional.indices.buffer);assert.equal(moved.values.buffer,moved.exceptional.values.buffer);assert.equal(moved.exceptional.values[0],Infinity);assert.equal(moved.exceptional.values[1],-Infinity);assert.ok(Object.is(moved.exceptional.values[2],-0));
}

console.log(JSON.stringify({suite:'build372-fleet-day-core',rows:baseAssets.length,airRows:safe.columns.totalCount,owners:safe.ownerTotals.length,exceptionalRows:unsafe.columns.exceptionalRows}));
console.log('BUILD372_FLEET_DAY_CORE_PASS');
