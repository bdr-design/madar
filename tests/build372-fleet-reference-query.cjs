'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const STORE=require(path.join(ROOT,'WebApp','fleet-store-core.js'));
const FLEET=require(path.join(ROOT,'WebApp','fleet-access-core.js'));
const CORE=require(path.join(ROOT,'WebApp','fleet-reference-query-core.js'));

const assets=[
 {id:'A1',type:'air',routeId:'R1',baseFacility:'B1'},
 {id:'A2',type:'air',routeId:'R1',baseFacility:'B1'},
 {id:'A3',type:'air',routeId:'R2',baseFacility:'B2'},
 {id:'S1',type:'sea',routeId:'R1',baseFacility:'P1'},
 {id:'X',type:'road',routeId:null,baseFacility:'B1'}
],state={simSeconds:90,resetEpoch:4,fleet:STORE.fromAssets(assets,{at:90})},params={routeIds:['R1','R2','missing','R1'],baseIds:['B1','B2','P1'],excludeAssetId:'A1',collectRouteIds:true,requestToken:'route-decision-1'};
const result=CORE.plan(state,FLEET,params),index=CORE.lookup(result);
assert(CORE.validPlan(result,params));
assert.deepEqual(result.routeIds,['R1','R2','missing']);
assert.deepEqual([...result.routeCounts],[2,1,0],'R1 excludes A1 but retains A2 and S1');
assert.deepEqual([...result.baseCounts],[3,1,1]);
assert.deepEqual([...index.routeIds],['R1','R2'],'distinct route order matches the original first occurrence');
assert.equal(index.route('R1'),2);assert.equal(index.base('B1'),3);

const airParams={routeIds:['R1','R2'],baseIds:['B1','P1'],type:'air',collectRouteIds:true},air=CORE.plan(state,FLEET,airParams);
assert.deepEqual([...air.routeCounts],[2,1]);assert.deepEqual([...air.baseCounts],[2,0]);assert.deepEqual(air.distinctRouteIds,['R1','R2']);
// Mutation gate: dropping the excluded-id predicate changes R1 immediately.
const noExclude=CORE.plan(state,FLEET,{...params,excludeAssetId:''});assert.notDeepEqual([...noExclude.routeCounts],[...result.routeCounts]);
const stamp=CORE.capture(state,FLEET,params);assert(CORE.current(stamp,state,FLEET,params));
STORE.set(state.fleet,1,'routeId','R3');assert.equal(CORE.current(stamp,state,FLEET,params),false,'a fleet write invalidates usage proof');
assert.equal(CORE.validPlan({...result,routeCounts:new Uint32Array([1])},params),false);
assert.equal(CORE.validPlan({...result,routeIds:['R1','R1','missing']},params),false,'duplicate result ids cannot shadow counts in lookup');
assert.equal(CORE.validPlan({...result,matchedRoutes:result.matchedRoutes+1},params),false,'reported route matches must equal the typed count sum');
assert.equal(CORE.validPlan({...result,matchedBases:result.matchedBases+1},params),false,'reported base matches must equal the typed count sum');
assert.equal(CORE.validPlan({...result,distinctRouteIds:['R1','R1']},params),false,'distinct route proof is actually distinct');
assert.equal(CORE.validPlan({...result,rows:-1},params),false);
const withoutDistinct={...params,collectRouteIds:false},withoutDistinctResult=CORE.plan(state,FLEET,withoutDistinct);
assert(CORE.validPlan(withoutDistinctResult,withoutDistinct));
assert.equal(CORE.validPlan({...withoutDistinctResult,distinctRouteIds:['R1']},withoutDistinct),false,'a query that did not request the complete id set cannot smuggle one in');

// Mutation gate: dropping the type predicate broadens usage.
const freshAir=CORE.plan(state,FLEET,airParams),allTypes=CORE.plan(state,FLEET,{...airParams,type:''});assert.notDeepEqual([...allTypes.routeCounts],[...freshAir.routeCounts]);
console.log(JSON.stringify({ok:true,rows:result.rows,routes:result.distinctRouteIds.length,bases:result.baseIds.length}));
