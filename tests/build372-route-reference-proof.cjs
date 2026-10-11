const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const ROOT=path.resolve(__dirname,'..');
const STORE=require(path.join(ROOT,'WebApp','fleet-store-core.js'));
globalThis.GH_FLEET_STORE=STORE;
const FLEET=require(path.join(ROOT,'WebApp','fleet-access-core.js'));
globalThis.GH_FLEET_DATA=FLEET;
const REFERENCES=require(path.join(ROOT,'WebApp','fleet-reference-query-core.js'));
globalThis.GH_FLEET_REFERENCE_QUERY=REFERENCES;
const ROUTES=require(path.join(ROOT,'WebApp','route-core.js'));

const point=(lat,lon)=>[lat,lon];
function route(id,from='EP-A',to='EP-B',offset=0){
  return {id,ownerCompanyId:'air',routeMode:'air',fromFacility:from,toFacility:to,from,to,route:[point(24+offset,46),point(25+offset,47)]};
}
function asset(id,routeId='',baseFacility='BASE-0'){
  return {id,type:'air',assetMode:'air',ownerCompanyId:'air',routeId,baseFacility,phase:'idle',condition:100};
}
function stateOf(assets,routes=[route('R-OLD')]){
  return {simSeconds:3600,resetEpoch:2,routesRevision:4,customRoutes:structuredClone(routes),routeEndpoints:{'EP-A':{id:'EP-A',routeEndpoint:true,coords:[24,46]},'EP-B':{id:'EP-B',routeEndpoint:true,coords:[25,47]},'EP-C':{id:'EP-C',routeEndpoint:true,coords:[26,48]}},routeCache:{'R-OLD':{canonicalRouteId:'R-OLD',distanceKm:100}},fleet:STORE.fromAssets(structuredClone(assets),{at:3600})};
}
function snapshot(state){return JSON.stringify({routes:state.customRoutes,endpoints:state.routeEndpoints,cache:state.routeCache,revision:state.routesRevision,fleet:STORE.toAssets(state.fleet)});}
function proofFor(state,command,payload,routeApi=ROUTES){
  const params=routeApi.referenceRequest(state,command,payload),stamp=REFERENCES.capture(state,FLEET,params),result=REFERENCES.plan(state,FLEET,params);
  return {params,result,current:target=>REFERENCES.current(stamp,target,FLEET,params)};
}
function withoutMainFleetReads(run){
  const previous=globalThis.GH_FLEET_DATA;
  globalThis.GH_FLEET_DATA=Object.freeze({...FLEET,scan(){throw new Error('unexpected-main-fleet-scan');},distinctRefs(){throw new Error('unexpected-main-distinct-refs');}});
  try{return run();}finally{globalThis.GH_FLEET_DATA=previous;}
}
function differential(command,payload,make){
  const legacy=make(),worker=make(),expected=ROUTES.execute({state:legacy},command,payload),proof=proofFor(worker,command,payload);
  const actual=withoutMainFleetReads(()=>ROUTES.execute({state:worker,fleetReferenceUsage:proof},command,payload));
  assert.deepStrictEqual(actual,expected,`${command}: worker result`);
  assert.equal(snapshot(worker),snapshot(legacy),`${command}: worker state`);
  return {worker,actual};
}

// The only user of R-OLD is excluded from the foreign-use decision. Endpoint cleanup consumes the same pass's base
// counts, and the optimized custom-route relation is built once rather than routeEndpoints x customRoutes.
const replacement=route('R-NEW','EP-A','EP-C',.2),replacePayload={replaceId:'R-OLD',assetId:'A-1',route:replacement};
differential('replace',replacePayload,()=>stateOf([asset('A-1','R-OLD','EP-A')]));

// A second asset keeps the old route busy. The bounded worker count must preserve the original rejection exactly.
{
  const state=stateOf([asset('A-1','R-OLD','EP-A'),asset('A-2','R-OLD','EP-B')]),proof=proofFor(state,'replace',replacePayload);
  assert.throws(()=>withoutMainFleetReads(()=>ROUTES.execute({state,fleetReferenceUsage:proof},'replace',replacePayload)),/route-replace-in-use/);
}

// Route deletion and its endpoint cleanup use one route count plus the requested base counts.
differential('delete',{id:'R-OLD'},()=>stateOf([asset('A-1','', 'BASE-0')]));
{
  const state=stateOf([asset('A-1','R-OLD','EP-A')]),payload={id:'R-OLD'},proof=proofFor(state,'delete',payload);
  assert.throws(()=>withoutMainFleetReads(()=>ROUTES.execute({state,fleetReferenceUsage:proof},'delete',payload)),/route-in-use/);
}

// Dedupe needs the complete distinct route-id set, not a million materialized rows. It retains the duplicate which is
// referenced just as the legacy command does.
{
  const original=route('R-A'),duplicate=route('R-B'),make=()=>stateOf([asset('A-1','R-B')],[original,duplicate]);
  differential('dedupe',{},make);
}

// A proof is request-specific and revision-specific. Once one is supplied, stale/mismatched data fails closed instead
// of silently falling back to an unbounded main-thread read.
{
  const state=stateOf([asset('A-1','')]),payload={id:'R-OLD'},proof=proofFor(state,'delete',payload);
  FLEET.update(state,FLEET.viewAt(state,0),{condition:99});
  assert.throws(()=>withoutMainFleetReads(()=>ROUTES.execute({state,fleetReferenceUsage:proof},'delete',payload)),/route-fleet-reference-proof-stale/);
}
{
  const state=stateOf([asset('A-1','')]),payload={id:'R-OLD'},proof=proofFor(state,'delete',{id:'OTHER'});
  assert.throws(()=>withoutMainFleetReads(()=>ROUTES.execute({state,fleetReferenceUsage:proof},'delete',payload)),/route-fleet-reference-proof-stale/);
}

// Mutation check: deleting the worker foreign-use decision must make the rejection assertion fail.
{
  const source=fs.readFileSync(path.join(ROOT,'WebApp','route-core.js'),'utf8'),needle='if(references)foreignUse=references.route(replaceId)>0;',mutated=source.replace(needle,'if(references)foreignUse=false;');
  assert.notEqual(mutated,source,'mutation applied');
  const guarded=Object.freeze({...FLEET,scan(){throw new Error('unexpected-main-fleet-scan');},distinctRefs(){throw new Error('unexpected-main-distinct-refs');}}),box={console,structuredClone,GH_FLEET_DATA:guarded,GH_FLEET_REFERENCE_QUERY:REFERENCES};box.globalThis=box;vm.createContext(box);vm.runInContext(mutated,box,{filename:'route-core.mutant.js'});
  const state=stateOf([asset('A-1','R-OLD'),asset('A-2','R-OLD')]),proof=proofFor(state,'replace',replacePayload,box.GH_ROUTE_CORE);
  assert.throws(()=>assert.throws(()=>box.GH_ROUTE_CORE.execute({state,fleetReferenceUsage:{...proof,current:()=>true}},'replace',replacePayload),/route-replace-in-use/),/Missing expected exception/);
}

console.log(JSON.stringify({ok:true,suite:'build372-route-reference-proof',commands:['replace','delete','dedupe'],mainThreadReads:0}));
