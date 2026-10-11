'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..'),file=name=>path.join(ROOT,'WebApp',name);
const STORE=require(file('fleet-store-core.js')),FLEET=require(file('fleet-access-core.js')),CORE=require(file('fleet-startup-normalization-core.js')),QUERY=require(file('fleet-query-core.js'));

const routes={
 R1:{distanceKm:900,dwellHours:1.5,from:'A',to:'B',effectiveSpeedKmh:800,tripSeconds:4050},
 S1:{distanceKm:1852,dwellHours:8,from:'P1',to:'P2',effectiveSpeedKmh:37.04,tripSeconds:180000},
 D1:{distanceKm:760,dwellHours:.5,from:'D1',to:'D2',effectiveSpeedKmh:90,tripSeconds:30400}
},catalogSpecs={air:{A320:{speedKmh:830}},sea:{SHIP:{speedKn:21}},road:{TRUCK:{speedKmh:100}}};
const assets=[
 {id:'A1',assetMode:'air',type:'air',catalogId:'A320',routeId:'R1',reverse:false,phase:'moving',progress:.4,fuel:80,condition:95},
 {id:'A2',assetMode:'air',type:'air',catalogId:'A320',routeId:'R1',reverse:true,specs:{speedKmh:700}},
 {id:'S1',assetMode:'sea',type:'sea',catalogId:'SHIP',routeId:'S1',reverse:false,phase:'turnaround',progress:1,fuel:70,condition:88,distanceKm:1852,dwellHours:8,from:'P1',to:'P2'},
 {id:'T1',assetMode:'road',type:'road',catalogId:'TRUCK',routeId:'D1',reverse:false,phase:'idle',progress:0,fuel:100,condition:100},
 {id:'T2',assetMode:'road',type:'road',catalogId:'UNKNOWN',routeId:null,reverse:false},
 {id:'X1',assetMode:'road',type:'road',catalogId:'TRUCK',routeId:'MISSING',phase:'idle',progress:0,fuel:100,condition:100},
 {id:'DONE',assetMode:'air',type:'air',catalogId:'A320',routeId:null,phase:'idle',progress:0,fuel:100,condition:100,specs:{speedKmh:830}}
];
const state={simSeconds:321,resetEpoch:7,fleet:STORE.fromAssets(assets,{at:321})};

// The former app.js startupPatch, kept verbatim enough that this is a
// differential test rather than a second call into the new implementation.
function oldPatch(asset){
 const route=routes[asset.routeId],specs=asset.specs||catalogSpecs[asset.type]?.[asset.catalogId]||null,patch={},set=(key,value)=>{if(Object.is(asset[key],value))delete patch[key];else patch[key]=value;};
 if(route){set('distanceKm',route.distanceKm);set('dwellHours',route.dwellHours);set('from',asset.reverse?route.to:route.from);set('to',asset.reverse?route.from:route.to);set('effectiveSpeedKmh',route.effectiveSpeedKmh);set('tripSeconds',route.tripSeconds);
  if(specs){const mode=String(asset.assetMode||asset.type||'').trim(),rated=mode==='air'?(specs.speedKmh||route.effectiveSpeedKmh)*.9:mode==='sea'?(specs.speedKn||route.effectiveSpeedKmh/1.852)*1.852*.88:(specs.speedKmh||route.effectiveSpeedKmh)*.76,effective=Math.max(20,Math.min(rated,route.effectiveSpeedKmh*1.08));set('effectiveSpeedKmh',effective);set('tripSeconds',route.distanceKm/effective*3600);}}
 if(!asset.phase)set('phase',asset.routeId?'moving':'idle');if(typeof asset.progress!=='number')set('progress',0);if(typeof asset.fuel!=='number')set('fuel',100);if(typeof asset.condition!=='number')set('condition',100);if(!asset.specs&&specs)set('specs',structuredClone(specs));return patch;
}
const expected=[];FLEET.scan(state,CORE.FIELDS,(row,index)=>{const patch=oldPatch(row);if(Object.keys(patch).length)expected.push([index,patch]);});
const stamp=CORE.capture(state,FLEET,{routesToken:12,catalogToken:'catalog-v1',requestToken:'boot-1'}),request=CORE.serializableCapture(stamp);
const result=CORE.plan(state,FLEET,{routes:Object.entries(routes),catalogSpecs,request});
assert(CORE.validPlan(result));assert.equal(result.sourceLength,assets.length);assert.equal(result.changed,expected.length);
assert.deepEqual([...result.indices],expected.map(row=>row[0]));
for(let offset=0;offset<result.changed;offset++)assert.deepEqual(CORE.patchAt(result,offset),expected[offset][1],`patch ${offset}`);
assert(CORE.current(stamp,state,FLEET,{routes,catalogSpecs,routesToken:12,catalogToken:'catalog-v1',requestToken:'boot-1',result}));

const chunks=[...CORE.chunks(result,2)];assert.equal(chunks.length,Math.ceil(result.changed/2));assert.equal(chunks.reduce((sum,row)=>sum+row.indices.length,0),result.changed);
assert.deepEqual(new Set(CORE.transferables(result)),new Set([result.indices.buffer,result.templateRefs.buffer]));
const delegated=QUERY.run('startupNormalizationPlan',state,FLEET,{routes:Object.entries(routes),catalogSpecs,request});assert(CORE.validPlan(delegated));assert.strictEqual(delegated.columns.indices,delegated.indices);assert.strictEqual(delegated.columns.values,delegated.templateRefs);
assert.equal(CORE.validPlan({...result,indices:new Uint32Array([result.indices[0]])}),false);
assert.equal(CORE.validPlan({...result,changed:result.changed+1}),false);
assert.equal(CORE.validPlan({...result,routeDependencies:[...result.routeDependencies,result.routeDependencies[0]]}),false);

const changedRoutes=structuredClone(routes);changedRoutes.R1.distanceKm++;
assert.equal(CORE.current(stamp,state,FLEET,{routes:changedRoutes,catalogSpecs,routesToken:12,catalogToken:'catalog-v1',requestToken:'boot-1',result}),false,'a consulted route change invalidates the plan even if its external token was reused');
const addedRoute=structuredClone(routes);addedRoute.MISSING={...routes.D1,from:'M1',to:'M2'};
assert.equal(CORE.current(stamp,state,FLEET,{routes:addedRoute,catalogSpecs,routesToken:12,catalogToken:'catalog-v1',requestToken:'boot-1',result}),false,'a formerly missing referenced route becoming available invalidates the plan');
const changedCatalog=structuredClone(catalogSpecs);changedCatalog.air.A320.speedKmh++;
assert.equal(CORE.current(stamp,state,FLEET,{routes,catalogSpecs:changedCatalog,routesToken:12,catalogToken:'catalog-v1',requestToken:'boot-1',result}),false,'a consulted catalog profile change invalidates the plan');
assert.equal(CORE.current(stamp,state,FLEET,{routes,catalogSpecs,routesToken:13,catalogToken:'catalog-v1',requestToken:'boot-1',result}),false);
STORE.set(state.fleet,0,'fuel',79);assert.equal(CORE.current(stamp,state,FLEET,{routes,catalogSpecs,routesToken:12,catalogToken:'catalog-v1',requestToken:'boot-1',result}),false,'a fleet write invalidates the plan');

// Mutation gate: changing the established road coefficient must make the
// differential disagree on the first road row.
const source=fs.readFileSync(file('fleet-startup-normalization-core.js'),'utf8'),mutated=source.replace("(specs.speedKmh||route.effectiveSpeedKmh)*.76","(specs.speedKmh||route.effectiveSpeedKmh)*.75");assert.notEqual(mutated,source);
const sandbox={module:{exports:{}},exports:{},structuredClone,console};sandbox.globalThis=sandbox;sandbox.window=sandbox;vm.runInNewContext(mutated,sandbox,{filename:'fleet-startup-normalization-mutant.js'});const mutant=sandbox.module.exports;
const road=assets.find(row=>row.id==='T1'),expectedRoad=oldPatch(road),mutantRoad=mutant.startupPatch(road,routes.D1,catalogSpecs);assert.notDeepEqual(mutantRoad,expectedRoad,'mutation must be observed by the differential fixture');

console.log(JSON.stringify({ok:true,rows:assets.length,changed:result.changed,templates:result.templates.length,mutation:true}));
