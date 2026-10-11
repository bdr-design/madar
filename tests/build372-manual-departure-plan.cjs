'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const STORE=require(path.join(ROOT,'WebApp','fleet-store-core.js')),FLEET=require(path.join(ROOT,'WebApp','fleet-access-core.js')),ROUTE=require(path.join(ROOT,'WebApp','route-core.js')),FLEET_CORE=require(path.join(ROOT,'WebApp','fleet-core.js')),PLAN=require(path.join(ROOT,'WebApp','fleet-manual-departure-plan-core.js'));
const facility=(id,iata)=>({id,iata}),facilities=[facility('F-G','GGG'),facility('F-G-ALIAS','GGG'),facility('T-G','TGG'),facility('F-X','XXX'),facility('T-X','TXX')];
const makeRoute=(id,lat,extra={})=>({id,type:'air',routeMode:'air',ownerCompanyId:'air',fromFacility:extra.fromFacility||'F-G',toFacility:extra.toFacility||'T-G',route:[[lat,0],[lat,1]],maxLegKm:extra.maxLegKm||100,distanceKm:extra.maxLegKm||100,effectiveSpeedKmh:700,tripSeconds:500,dwellHours:1,...extra});
const routes={
  GOOD:makeRoute('GOOD',0),WRONG:makeRoute('WRONG',10,{ownerCompanyId:'other'}),PEND:makeRoute('PEND',20),RANGE:makeRoute('RANGE',30,{maxLegKm:500}),LOC:makeRoute('LOC',40),STAFF:makeRoute('STAFF',50),SALE:makeRoute('SALE',60),CAP:makeRoute('CAP',-20)
};
const ready={mode:'automatic-fixed',ready:true,total:2,monthlyPayroll:100};
const asset=(id,routeId,extra={})=>({id,name:id,ownerCompanyId:'air',assetMode:'air',type:'air',routeId,phase:'turnaround',baseFacility:'F-G-ALIAS',specs:{rangeKm:1000},staffing:ready,...extra});
const assets=[
  asset('GOOD-0','GOOD'),asset('MISS-0','MISSING'),asset('WRONG-0','WRONG'),asset('PEND-0','PEND',{deliveryStatus:'pending'}),
  asset('RANGE-0','RANGE',{specs:{rangeKm:100}}),asset('LOC-0','LOC',{baseFacility:'F-X'}),asset('STAFF-0','STAFF',{staffing:{mode:'automatic-fixed',ready:false}}),asset('SALE-0','SALE',{salePending:true}),
  ...Array.from({length:25},(_,index)=>asset(`CAP-${String(index).padStart(2,'0')}`,'CAP')),
  asset('MOVING-X','GOOD',{phase:'moving'}),asset('SCHEDULED-X','GOOD',{departureScheduled:true}),asset('OTHER-X','GOOD',{ownerCompanyId:'other'})
];
const state={simSeconds:900,resetEpoch:3,customRoutes:Object.values(routes),fleet:STORE.fromAssets(assets,{at:900})};
const facilityById=new Map(facilities.map(row=>[row.id,row]));
const owner=row=>String(row.ownerCompanyId||row.companyId||row.assetMode||row.type||'').trim(),mode=row=>String(row.assetMode||row.type||'').trim(),routeOwner=row=>String(row.ownerCompanyId||row.companyId||row.company||row.routeMode||row.type||'').trim(),routeMode=row=>String(row.routeMode||row.type||'').trim();
function sameFacility(a,b){if(!a||!b)return false;if(a===b)return true;const x=facilityById.get(a),y=facilityById.get(b);return !!x&&!!y&&Boolean((x.iata&&x.iata===y.iata)||(x.icao&&x.icao===y.icao)||(x.code&&x.code===y.code));}
function fits(row,route){const range=row.type==='sea'?(row.specs?.rangeNm||0)*1.852:(row.specs?.rangeKm||0),leg=row.type==='road'?(route.roadNetworkDistanceKm||route.distanceKm):(route.maxLegKm||0);return !range||leg<=range*1.005;}
function select(target){const out=[];FLEET.forEach(target,(row,index)=>{if(owner(row)==='air'&&mode(row)==='air'&&row.routeId&&row.phase==='turnaround'&&!row.departureScheduled)out.push([row,index]);});return out;}
function block(target,row,context){const route=routes[row.routeId];if(!route)return {code:'no-route-data',text:'لا يوجد مسار تشغيلي صالح مرتبط بهذا الأصل.'};if(routeMode(route)!==mode(row)||!owner(row)||routeOwner(route)!==owner(row))return {code:'route-company-mismatch',text:'المسار لا يتبع الشركة المالكة لهذا الأصل.'};if(row.deliveryStatus==='pending'||row.salePending)return {code:'asset-unavailable',text:'الأصل قيد التسليم أو البيع ولا يقبل أمر مغادرة.'};if(!fits(row,route))return {code:'route-range-invalid',text:'المسار يتجاوز مدى الأصل أو قيود التشغيل.'};if(!row.baseFacility||(!sameFacility(row.baseFacility,route.fromFacility)&&!sameFacility(row.baseFacility,route.toFacility)))return {code:'asset-location-mismatch',text:'موقع الأصل لا يطابق إحدى نقطتي المسار.'};if(row.staffing?.mode!=='automatic-fixed'||row.staffing.ready!==true)return {code:'asset-staffing-invalid',text:'سجل الطاقم الثابت لهذا الأصل غير مكتمل. أعد فحص الأصل؛ لا توجد موافقة HR مطلوبة.'};const conflict=FLEET_CORE.routeConflict(target,row.id,route.id,route,context);if(conflict)return {code:'route-not-exclusive',text:`المسار أو ممر مماثل مستخدم بواسطة ${conflict.name}.`};return null;}
function reference(target){const rows=select(target),context=FLEET_CORE.routeConflictContext(target),blocked=[];for(const [row,index] of rows){const reason=block(target,row,context);if(reason)blocked.push({id:row.id,name:row.name,type:mode(row),companyId:owner(row),routeId:row.routeId,phase:row.phase,...reason,index});}return {rows,blocked};}
const stamp=PLAN.capture(state,FLEET,{companyId:'air',type:'air',requestToken:'manual-1',routesToken:'routes-1',facilitiesToken:'facilities-1',ownerToken:'owners-1'}),result=PLAN.plan(state,FLEET,{companyId:'air',type:'air',routes,registeredRoutes:state.customRoutes,facilities,routeCore:ROUTE,request:PLAN.serializableCapture(stamp)}),expected=reference(state);
assert.equal(PLAN.validPlan(result),true);assert.deepEqual([...result.indices],expected.rows.map(([,index])=>index));assert.equal(result.selected,expected.rows.length);assert.equal(result.blocked,expected.blocked.length);
const expectedCounts=new Map();for(const row of expected.blocked)expectedCounts.set(row.code,(expectedCounts.get(row.code)||0)+1);assert.deepEqual(result.reasonCounts,[...expectedCounts]);
assert.deepEqual(result.blockers,expected.blocked.slice(0,30).map(({index,...row})=>row),'bounded blocker details are bit-for-bit equivalent to the original preflight');
assert.equal(PLAN.current(stamp,state,FLEET,{result,requestToken:'manual-1',routesToken:'routes-1',facilitiesToken:'facilities-1',ownerToken:'owners-1'}),true);assert.deepEqual(PLAN.transferables(result),[result.indices.buffer]);assert.throws(()=>[...PLAN.chunks(result)],/blocked/);
assert.equal(PLAN.current(stamp,state,FLEET,{result,routesToken:'routes-2'}),false,'route dependency token invalidates the plan');state.simSeconds++;assert.equal(PLAN.current(stamp,state,FLEET,{result}),false,'simulation time invalidates presented phase');state.simSeconds--;

// A clean atomic batch returns row indices in order and can be sliced without
// decoding or copying any asset objects.
const cleanAssets=[asset('C-0','GOOD'),asset('C-1','GOOD'),asset('C-2','GOOD')],clean={simSeconds:1,resetEpoch:1,customRoutes:[routes.GOOD],fleet:STORE.fromAssets(cleanAssets,{at:1})},cleanStamp=PLAN.capture(clean,FLEET,{companyId:'air',type:'air',routeId:'GOOD',routesToken:1,facilitiesToken:1,ownerToken:1}),cleanPlan=PLAN.plan(clean,FLEET,{companyId:'air',type:'air',routeId:'GOOD',routes,registeredRoutes:clean.customRoutes,facilities,routeCore:ROUTE,request:PLAN.serializableCapture(cleanStamp)});
assert.equal(cleanPlan.blocked,0);assert.deepEqual([...PLAN.chunks(cleanPlan,2)].map(rows=>[...rows]),[[0,1],[2]]);assert.equal(PLAN.current(cleanStamp,clean,FLEET,{result:cleanPlan,routesToken:1,facilitiesToken:1,ownerToken:1}),true);

// Two separately registered air routes on the same corridor reproduce the
// existing exclusive-route conflict in both directions.
const twinA=makeRoute('TWIN-A',5),twinB={...makeRoute('TWIN-B',5),route:[[5,0],[5,1]]},twins={['TWIN-A']:twinA,['TWIN-B']:twinB},twinState={simSeconds:2,resetEpoch:1,customRoutes:[twinA,twinB],fleet:STORE.fromAssets([asset('TA','TWIN-A'),asset('TB','TWIN-B')],{at:2})},twinStamp=PLAN.capture(twinState,FLEET,{companyId:'air',type:'air',routesToken:2,facilitiesToken:1,ownerToken:1}),twinPlan=PLAN.plan(twinState,FLEET,{companyId:'air',type:'air',routes:twins,registeredRoutes:twinState.customRoutes,facilities,routeCore:ROUTE,request:PLAN.serializableCapture(twinStamp)}),twinExpected=referenceWithRoutes(twinState,twins);
function referenceWithRoutes(target,runtime){const saved={...routes};for(const key of Object.keys(routes))delete routes[key];Object.assign(routes,runtime);try{return reference(target);}finally{for(const key of Object.keys(routes))delete routes[key];Object.assign(routes,saved);}}
assert.equal(twinPlan.blocked,2);assert.deepEqual(twinPlan.reasonCounts,[['route-not-exclusive',2]]);assert.deepEqual(twinPlan.blockers.map(row=>[row.id,row.code]),twinExpected.blocked.map(row=>[row.id,row.code]));
assert.equal(PLAN.validPlan({...cleanPlan,indices:new Uint32Array([cleanPlan.sourceLength]),selected:1}),false,'out-of-range indices fail closed');

// Sea/road capacity uses the original route-capacity-full code and text. It is
// distinct from the air-only exclusive-corridor reason shown above.
const roadRoute={id:'ROAD-CAP',type:'road',routeMode:'road',ownerCompanyId:'road',fromFacility:'F-G',toFacility:'T-G',route:[[0,0],[0,1]],distanceKm:100,roadNetworkDistanceKm:100,effectiveSpeedKmh:70,tripSeconds:5200,dwellHours:1},roadAssets=Array.from({length:65},(_,index)=>({id:`ROAD-${index}`,name:`ROAD-${index}`,ownerCompanyId:'road',assetMode:'road',type:'road',routeId:roadRoute.id,phase:'turnaround',baseFacility:'F-G-ALIAS',specs:{rangeKm:1000},staffing:ready})),roadState={simSeconds:3,resetEpoch:1,customRoutes:[roadRoute],fleet:STORE.fromAssets(roadAssets,{at:3})},roadStamp=PLAN.capture(roadState,FLEET,{companyId:'road',type:'road',routesToken:3,facilitiesToken:1,ownerToken:1}),roadPlan=PLAN.plan(roadState,FLEET,{companyId:'road',type:'road',routes:{[roadRoute.id]:roadRoute},registeredRoutes:[roadRoute],facilities,routeCore:ROUTE,request:PLAN.serializableCapture(roadStamp)});
assert.equal(roadPlan.blocked,65);assert.deepEqual(roadPlan.reasonCounts,[['route-capacity-full',65]]);assert(roadPlan.blockers.every(row=>row.code==='route-capacity-full'&&row.text==='مسار الأسطول تجاوز سعته التشغيلية (64 أصل).'));
assert.equal(PLAN.validPlan({...roadPlan,reasonCounts:[['route-capacity-full',-1],['route-not-exclusive',66]]}),false,'reason totals must be positive exact integers');

// Mutation gate: if the selector stops requiring turnaround, MOVING-X enters
// the typed plan and the same differential assertion fails.
{
  const source=fs.readFileSync(path.join(ROOT,'WebApp','fleet-manual-departure-plan-core.js'),'utf8'),needle="||row.phase!=='turnaround'||row.departureScheduled",mutated=source.replace(needle,'||false||row.departureScheduled');assert.notEqual(mutated,source,'selection mutation applied');
  const box={module:{exports:{}},exports:{},structuredClone,console};box.globalThis=box;vm.createContext(box);vm.runInContext(mutated,box,{filename:'fleet-manual-departure-plan-core.mutant.js'});const mutant=box.module.exports;
  const assertSelection=api=>assert.deepEqual([...api.plan(state,FLEET,{companyId:'air',type:'air',routes,registeredRoutes:state.customRoutes,facilities,routeCore:ROUTE,request:PLAN.serializableCapture(stamp)}).indices],expected.rows.map(([,index])=>index));
  assertSelection(PLAN);assert.throws(()=>assertSelection(mutant),assert.AssertionError);
}

console.log(JSON.stringify({ok:true,selected:result.selected,blocked:result.blocked,clean:cleanPlan.selected,twin:twinPlan.blocked,roadCapacity:roadPlan.blocked,mutation:true}));
