'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const STORE=require(path.join(ROOT,'WebApp','fleet-store-core.js')),FLEET=require(path.join(ROOT,'WebApp','fleet-access-core.js')),QUERY=require(path.join(ROOT,'WebApp','fleet-global-route-query-core.js'));
const assets=[
  {id:'A0',type:'air',phase:'idle'},{id:'A1',type:'air',phase:'moving'},{id:'S0',type:'sea',phase:'turnaround'},
  // A missing stored phase on a route is presented as moving and must not be
  // offered, exactly like app.js' Proxy predicate.
  {id:'A2',type:'air',routeId:'AIR-X'},{id:'A3',type:'air',phase:'turnaround'},{id:'S1',type:'sea',phase:'idle'},
  {id:'A4',type:'air',phase:'idle'},{id:'R0',type:'road',phase:'idle'}
];
const state={simSeconds:70,fleet:STORE.fromAssets(assets,{at:70})};
function expected(type){const rows=[];FLEET.forEach(state,(row,index)=>{if(row.type===type&&row.phase!=='moving')rows.push(index);});return rows;}
for(const [type,limit] of [['air',2],['air',80],['sea',1]]){
  const stamp=QUERY.capture(state,FLEET,{type,limit,requestToken:'drawer-1'}),result=QUERY.plan(state,FLEET,{type,limit,request:QUERY.serializableCapture(stamp)}),wanted=expected(type);
  assert.equal(QUERY.validPlan(result),true);assert.equal(result.total,wanted.length);assert.deepEqual([...result.indices],wanted.slice(0,result.limit));assert.equal(result.truncated,wanted.length>result.limit);
  assert.equal(QUERY.current(stamp,state,FLEET,{type,limit,requestToken:'drawer-1',result}),true);assert.deepEqual(QUERY.transferables(result),[result.indices.buffer]);
}
const stamp=QUERY.capture(state,FLEET,{type:'air',limit:2,requestToken:'drawer-1'}),result=QUERY.plan(state,FLEET,{type:'air',limit:2,request:QUERY.serializableCapture(stamp)});
state.simSeconds++;assert.equal(QUERY.current(stamp,state,FLEET,{result}),false,'view phase is pinned to simulation time');state.simSeconds--;
STORE.set(state.fleet,0,'phase','moving');assert.equal(QUERY.current(stamp,state,FLEET,{result}),false,'a fleet write invalidates candidates');
const broken={...result,indices:new Uint32Array([result.sourceLength])};assert.equal(QUERY.validPlan(broken),false,'out-of-range worker indices fail closed');
const legacy={simSeconds:0,assets:assets.map(row=>({...row}))},arrayFleet={source:s=>s.assets,revision:()=>null,membershipRevision:s=>`a:${s.assets.length}`,scanLength:s=>s.assets.length,scan(s,fields,fn){s.assets.forEach((row,index)=>fn(row,index));}};
const legacyStamp=QUERY.capture(legacy,arrayFleet,{type:'air',arrayRevision:4});assert.equal(QUERY.current(legacyStamp,legacy,arrayFleet,{type:'air',arrayRevision:null}),false,'legacy arrays require an owner mutation token');assert.equal(QUERY.current(legacyStamp,legacy,arrayFleet,{type:'air',arrayRevision:4}),true);
assert.throws(()=>QUERY.plan(state,FLEET,{type:'road'}),/global-route-type/);
console.log(JSON.stringify({ok:true,air:expected('air').length,sea:expected('sea').length}));
