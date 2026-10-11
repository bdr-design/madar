'use strict';
// Differential gate for fleet-route-normalization-core.  The new query must
// produce the exact rows that the former applyRoadGeometry tail produced:
// drafts(all live rows) -> filter(routeId) -> Fleet Core normalizeAsset ->
// commit.  It must use scanRouted only, compact equal patches into typed
// template references, and reject every stale dependency before application.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const web=path.join(path.resolve(__dirname,'..'),'WebApp'),load=name=>require(path.join(web,name));
const STORE=load('fleet-store-core.js');load('simulation-asset-core.js');load('fleet-event-core.js');
const DATA=load('fleet-access-core.js'),CORE=load('fleet-core.js'),QUERY=load('fleet-route-normalization-core.js');

const clone=value=>structuredClone(value);
const route={id:'ROAD-QA',type:'road',routeMode:'road',from:'الرياض',to:'جدة',distanceKm:947.125,tripSeconds:49860.25,effectiveSpeedKmh:68.385,dwellHours:2.75,speedFactor:1};
const otherRoute={...route,id:'ROAD-OTHER',from:'جدة',to:'دبي',distanceKm:1210,tripSeconds:64000};
const catalogs={road:{fast:{speedKmh:92,capacity:22},slow:{speedKmh:54,capacity:17}}};
function base(id,routeId='ROAD-QA'){
  return {id,name:id,ownerCompanyId:'road',assetMode:'road',type:'road',catalogId:'fast',routeId,reverse:false,phase:'turnaround',progress:0,fuel:100,condition:100,
    specs:{speedKmh:92,capacity:22},distanceKm:10,tripSeconds:20,effectiveSpeedKmh:30,dwellHours:1,from:'قديم أ',to:'قديم ب'};
}
const seed=[];
for(let index=0;index<4000;index++)seed.push({...base(`OTHER-${index}`,'ROAD-OTHER'),reverse:index%2===1});
seed.splice(2,0,
  base('TARGET-A'),
  {...base('TARGET-B'),reverse:true,specs:undefined,catalogId:'slow',phase:'',progress:'bad',fuel:null,condition:'unknown'},
  {...base('TARGET-C'),specs:undefined,catalogId:'missing'},
  {...base('TARGET-D'),assetMode:'',type:'road',specs:{},reverse:true},
  {...base('TARGET-E'),specs:{speedKmh:54,capacity:17},catalogId:'slow'},
  base('TARGET-F')
);
// One target already exactly normalized must be counted but omitted from the
// write plan, as GH_FLEET_DATA.commit omits an empty overlay.
const normalized=base('TARGET-NORMAL');CORE.normalizeAsset(normalized,{route,catalogItem:{specs:catalogs.road.fast}});seed.splice(9,0,normalized);

function makeStore(){return {fleet:STORE.fromAssets(clone(seed),{at:7200}),simSeconds:7200,resetEpoch:4};}
function makeArray(){return {assets:clone(seed),simSeconds:7200,resetEpoch:4};}
const specsFor=row=>catalogs[row.type]?.[row.catalogId]||null;
function oldApply(state){
  const rows=DATA.drafts(state).filter(asset=>asset?.routeId===route.id);
  for(const asset of rows)CORE.normalizeAsset(asset,{route,catalogItem:(()=>{const specs=specsFor(asset);return specs?{specs}:null;})()});
  return DATA.commit(state,rows);
}
function applyPlan(state,result){
  let writes=0;
  for(const chunk of QUERY.chunks(result,2))for(let offset=chunk.from;offset<chunk.to;offset++){
    const view=DATA.viewAt(state,result.indices[offset]);assert.ok(view);
    if(DATA.update(state,view,QUERY.patchAt(result,offset)))writes++;
  }
  return writes;
}
function storeRows(state){const out=[];for(let index=0;index<state.fleet.length;index++)if(STORE.isAlive(state.fleet,index))out.push(STORE.materialize(state.fleet,index));return out;}

// Formula differential: varied modes, directions, catalog presence, defaults,
// speed factors and already-normalized fields.  This compares the pure patch
// against Fleet Core itself rather than duplicating the expected formula.
{
  let random=0x372a11ce;const next=()=>{random=(Math.imul(random,1664525)+1013904223)>>>0;return random/0x100000000;};
  const modes=['road','air','sea'];
  for(let round=0;round<768;round++){
    const mode=modes[round%3],catalogSpecs=mode==='air'?{speedKmh:620+Math.floor(next()*260)}:mode==='sea'?{speedKn:12+Math.floor(next()*18)}:{speedKmh:45+Math.floor(next()*80)},
      candidate={id:`FORMULA-${round}`,routeId:'FORMULA-ROUTE',assetMode:round%7?'':mode,type:mode,catalogId:'model',reverse:round%2===1,
        ...(round%4?{phase:round%5?'turnaround':''}:{}),...(round%6?{progress:next()}:{progress:'legacy'}),...(round%8?{fuel:next()*100}:{fuel:null}),...(round%9?{condition:40+next()*60}:{condition:'legacy'}),
        ...(round%3?{specs:catalogSpecs}:{})},
      candidateRoute={id:'FORMULA-ROUTE',type:mode,routeMode:mode,from:`FROM-${round%11}`,to:`TO-${round%13}`,distanceKm:50+next()*9000,effectiveSpeedKmh:mode==='air'?770:mode==='sea'?34:72,dwellHours:next()*10,speedFactor:round%10===0?.83:1};
    candidateRoute.tripSeconds=candidateRoute.distanceKm/candidateRoute.effectiveSpeedKmh*3600;
    const expected=clone(candidate),actual=clone(candidate),table={[mode]:{model:catalogSpecs}};
    CORE.normalizeAsset(expected,{route:candidateRoute,catalogItem:{specs:catalogSpecs}});
    Object.assign(actual,QUERY.normalizationPatch(actual,candidateRoute,table));
    assert.deepEqual(actual,expected,`normalization formula round ${round}`);
  }
}

// Native store: equality includes every materialized field and the exact
// record/value-table effects of applying patches in row order.
{
  const expected=makeStore(),actual=makeStore(),originalDrafts=DATA.drafts;
  const oldWrites=oldApply(expected);let routedCalls=0,visited=0;
  const fleet={...DATA,scanRouted:(state,fields,fn)=>{routedCalls++;return DATA.scanRouted(state,fields,(row,index)=>{visited++;return fn(row,index);});},drafts:()=>{throw new Error('plan-created-fleet-drafts');}};
  const snapshot=QUERY.capture(actual,fleet,{routeId:route.id,route,catalogToken:'catalog-v1',requestToken:'geometry-7'});
  const result=QUERY.plan(actual,fleet,{routeId:route.id,route,catalogSpecs:catalogs,request:QUERY.serializableCapture(snapshot)});
  assert.equal(routedCalls,1);assert.equal(result.matched,7);assert.equal(result.changed,6);assert.equal(visited,8,'one target group plus one row from the unrelated route');
  assert.ok(result.indices instanceof Uint32Array);assert.ok(result.templateRefs instanceof Uint8Array);
  assert.deepEqual(QUERY.transferables(result),[result.indices.buffer,result.templateRefs.buffer]);
  assert.ok(result.templates.length<result.changed,'equal normalization patches share templates');
  assert.equal(QUERY.validPlan(result),true);
  assert.equal(QUERY.current(snapshot,actual,fleet,{routeId:route.id,route,catalogSpecs:catalogs,catalogToken:'catalog-v1',requestToken:'geometry-7',result}),true);
  const writes=applyPlan(actual,result);assert.equal(writes,oldWrites);
  assert.deepEqual(storeRows(actual),storeRows(expected));
  assert.deepEqual(new Uint8Array(actual.fleet.rows),new Uint8Array(expected.fleet.rows),'record bytes equal the former draft path');
  assert.deepEqual(actual.fleet.values,expected.fleet.values,'interned values equal the former draft path');
  assert.deepEqual(actual.fleet.extras,expected.fleet.extras);
  assert.equal(DATA.drafts,originalDrafts,'the query did not replace the fleet API');
}

// Legacy array compatibility for migrations: the pure result is the same, but
// freshness intentionally needs an owner supplied array mutation revision.
{
  const expected=makeArray(),actual=makeArray(),arrayRevision='migration-12';oldApply(expected);
  const snapshot=QUERY.capture(actual,DATA,{routeId:route.id,route,catalogToken:'catalog-v1',requestToken:'geometry-7',arrayRevision});
  const result=QUERY.plan(actual,DATA,{routeId:route.id,route,catalogSpecs:catalogs,request:QUERY.serializableCapture(snapshot)});
  assert.equal(QUERY.current(snapshot,actual,DATA,{routeId:route.id,route,catalogSpecs:catalogs,catalogToken:'catalog-v1',requestToken:'geometry-7',arrayRevision,result}),true);
  applyPlan(actual,result);assert.deepEqual(actual.assets,expected.assets);
  assert.equal(QUERY.current(snapshot,actual,DATA,{routeId:route.id,route,catalogSpecs:catalogs,result}),false,'an array without its mutation token fails closed');
}

// Every input that can change the answer invalidates the request before the
// first write.  Use a fresh state per mutation so each assertion names one
// dependency precisely.
function freshnessCase(mutate,options={}){
  const state=makeStore(),snapshot=QUERY.capture(state,DATA,{routeId:route.id,route,catalogToken:'catalog-v1',requestToken:'geometry-7'}),result=QUERY.plan(state,DATA,{routeId:route.id,route,catalogSpecs:catalogs,request:QUERY.serializableCapture(snapshot)});
  mutate(state);return QUERY.current(snapshot,state,DATA,{routeId:route.id,route,catalogSpecs:options.catalogs||catalogs,catalogToken:options.catalogToken??'catalog-v1',requestToken:options.requestToken??'geometry-7',result,route:options.route||route});
}
assert.equal(freshnessCase(state=>STORE.set(state.fleet,2,'name','changed-after-query')),false,'fleet revision');
assert.equal(freshnessCase(state=>{state.simSeconds++;}),false,'simulation time');
assert.equal(freshnessCase(state=>{state.resetEpoch++;}),false,'world reset');
assert.equal(freshnessCase(()=>{}, {route:{...route,distanceKm:route.distanceKm+1}}),false,'route inputs');
assert.equal(freshnessCase(()=>{}, {catalogToken:'catalog-v2'}),false,'catalog token');
assert.equal(freshnessCase(()=>{}, {requestToken:'geometry-8'}),false,'request token');
{
  const changed=clone(catalogs);changed.road.slow.speedKmh++;
  assert.equal(freshnessCase(()=>{}, {catalogs:changed}),false,'a consulted catalog specification');
}
{
  const changed=clone(catalogs);changed.road.missing={speedKmh:61,capacity:12};
  assert.equal(freshnessCase(()=>{}, {catalogs:changed}),false,'a formerly missing catalog specification');
}
{
  const state=makeStore(),snapshot=QUERY.capture(state,DATA,{routeId:route.id,route,catalogToken:'catalog-v1',requestToken:'geometry-7'}),result=QUERY.plan(state,DATA,{routeId:route.id,route,catalogSpecs:catalogs,request:QUERY.serializableCapture(snapshot)});
  state.fleet=STORE.fromAssets(clone(seed),{at:7200});
  assert.equal(QUERY.current(snapshot,state,DATA,{routeId:route.id,route,catalogSpecs:catalogs,catalogToken:'catalog-v1',requestToken:'geometry-7',result}),false,'another store with equal bytes');
}

// A malformed or reordered result cannot drive the chunk applier.
{
  const state=makeStore(),result=QUERY.plan(state,DATA,{routeId:route.id,route,catalogSpecs:catalogs});
  const broken={...result,indices:result.indices.slice()};broken.indices[1]=broken.indices[0];
  assert.equal(QUERY.validPlan(broken),false);assert.throws(()=>[...QUERY.chunks(broken,64)],/plan-invalid/);
  const outside={...result,indices:result.indices.slice()};outside.indices[outside.indices.length-1]=result.sourceLength;
  assert.equal(QUERY.validPlan(outside),false,'a row at sourceLength is outside the captured fleet');
  const floatRefs={...result,templateRefs:Float64Array.from(result.templateRefs)};
  assert.equal(QUERY.validPlan(floatRefs),false,'template refs must be an unsigned integer view');
}
// Template refs widen only after all templates are known: 256 templates fit
// refs 0..255 in Uint8; the 257th requires Uint16.
{
  const assets=[];for(let index=0;index<257;index++)assets.push({...base(`WIDTH-${index}`),specs:{speedKmh:45+index/10}});
  const state={assets,simSeconds:0},result=QUERY.plan(state,DATA,{routeId:route.id,route,catalogSpecs:{}});
  assert.equal(result.templates.length,257);assert.ok(result.templateRefs instanceof Uint16Array);assert.equal(result.templateRefs[256],256);
  assert.equal([...QUERY.chunks(result)].length,2,'the default write slice is bounded to 256 rows');
}
// Mutation gate: a changed road speed coefficient must be caught by the
// Fleet Core formula differential rather than silently changing trip times.
{
  const source=fs.readFileSync(path.join(web,'fleet-route-normalization-core.js'),'utf8'),needle=":(specs.speedKmh||route.effectiveSpeedKmh)*.76;",mutated=source.replace(needle,":(specs.speedKmh||route.effectiveSpeedKmh)*.75;");assert.notEqual(mutated,source,'road-speed mutation applied');
  const box={module:{exports:{}},exports:{},structuredClone,console};box.globalThis=box;vm.createContext(box);vm.runInContext(mutated,box,{filename:'fleet-route-normalization-core.mutant.js'});const mutant=box.module.exports,candidate=base('MUTANT'),expected=clone(candidate),actual=clone(candidate);CORE.normalizeAsset(expected,{route,catalogItem:{specs:candidate.specs}});Object.assign(actual,mutant.normalizationPatch(actual,route,{road:{fast:candidate.specs}}));
  assert.throws(()=>assert.deepEqual(actual,expected),assert.AssertionError);
}
console.log(JSON.stringify({ok:true,matched:7,changed:6,routeDraftsCreated:0,mutation:true}));
