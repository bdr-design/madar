'use strict';
// Owner («كمل ابحاثك عن اسباب الثقل والمشاكل» → «جميعها على دفعات مع مراجعة الوكيل»): the road dispatch («إرسال على
// الشبكة الحالية») plans one routing call per depot batch, and a fixed limit of 80 calls refused the whole dispatch — no
// truck left — for a company with 80 depots or more, even when every route was found; the last check refused a plan that
// had used exactly 80 successful calls. Now the limit follows the calls the plan needs (never below 80):
//   1. 80 depots, every route found: all trucks are assigned (the old planner refused it);
//   2. 288 depots (the road quota's planning slots) with 20,000 trucks: all assigned, one call per depot;
//   3. one depot with 20,000 trucks: unchanged (shared routes, few calls);
//   4. some destinations without a road (10% of batches refused): the plan retries and splits within the limit;
//   5. a provider that never finds a road still stops — each truck's MAX_ATTEMPTS ends it before the call limit (claim 8
//      proves the limit itself) — and commits nothing;
//   6. a cancelled plan is still refused;
//   7. a plan that needs exactly the limit (every batch split down to single rows: 2×12−1 calls per batch) is kept —
//      the call that reaches the limit is not refused after it succeeded (the reviewer's case);
//   8. a plan that needs more than the limit stops at the limit and commits nothing.
const assert=require('node:assert/strict'),path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
global.window=global;
for(const file of ['determinism-core.js','route-core.js','road-planner.js'])require(path.join(ROOT,'WebApp',file));
const P=globalThis.GH_ROAD_PLANNER,R=globalThis.GH_ROUTE_CORE;
const km=(a,b)=>{const r=Math.PI/180,dl=(b[0]-a[0])*r,dn=(b[1]-a[1])*r,x=Math.sin(dl/2)**2+Math.cos(a[0]*r)*Math.cos(b[0]*r)*Math.sin(dn/2)**2;return 6371*2*Math.asin(Math.sqrt(x));};
const depots=count=>Array.from({length:count},(_,i)=>({id:`DEPOT-${i}`,name:`Depot ${i}`,company:'road',city:`City ${i}`,country:'X',coords:[-40+(i%16)*5,-100+Math.floor(i/16)*12]}));
const trucks=(count,origins)=>Array.from({length:count},(_,i)=>({id:`T-${String(i).padStart(6,'0')}`,name:`T${i}`,specs:{rangeKm:700},staffing:{mode:'automatic-fixed',ready:true},depot:i%origins}));
// A provider that finds every road, or refuses a batch when one destination falls in the refused share.
function provider(refused=()=>false){const p={calls:0,offline:()=>true,roadBatch:async pairs=>{p.calls++;if(pairs.some(pair=>refused(pair.to)))return {ok:false,status:'no-route'};return {ok:true,geometries:pairs.map(pair=>({route:[pair.from,pair.to],distanceKm:km(pair.from,pair.to)*1.2,durationSeconds:3600}))};}};return p;}
const share=fraction=>to=>Math.abs(Math.sin(to[0]*12.9898+to[1]*78.233)*43758.5453)%1<fraction;
async function plan(count,origins,net,options={}){
  const bases=depots(origins),assets=trucks(count,origins),budget=R.modeRouteBudget({customRoutes:[]},'road');
  return P.plan({assets,routes:[],originFor:asset=>bases[asset.depot],usable:()=>true,provider:net,routeCount:0,routeBudget:{free:budget.free,reserve:budget.reserve},targetRouteLoad:45,yieldControl:async()=>{},intervalMs:0,...options});
}
(async()=>{
  const results={};
  // 1.
  {const net=provider(),out=await plan(80,80,net);assert.equal(out.length,80,'1: every truck of 80 depots is assigned');assert.equal(net.calls,80,'1: one call per depot');assert.equal(new Set(out.map(row=>row.route.id)).size,80);results.depots80=net.calls;}
  // 2.
  {const net=provider(),out=await plan(20000,288,net);assert.equal(out.length,20000,'2: 20,000 trucks over 288 depots are assigned');assert.equal(net.calls,288);results.depots288=net.calls;}
  // 3.
  {const net=provider(),out=await plan(20000,1,net);assert.equal(out.length,20000,'3: one depot');assert.ok(net.calls<=40,`3: few calls (${net.calls})`);results.depot1=net.calls;}
  // 4.
  {const net=provider(share(.01)),out=await plan(20000,4,net);assert.equal(out.length,20000,'4: refused destinations are retried and split');assert.ok(net.calls>24&&net.calls<=24*P.MAX_ATTEMPTS*2,`4: within the limit (${net.calls})`);results.refused=net.calls;}
  // 5.
  {const net=provider(()=>true);await assert.rejects(plan(200,20,net),/لم تُعتمد أي رحلة/,'5: a provider that never finds a road stops');assert.equal(net.calls,P.MAX_ATTEMPTS,`5: the first truck's MAX_ATTEMPTS ends it (${net.calls} calls)`);results.neverRoute=net.calls;}
  // 7. Four depots of 12 trucks, one truck a route, a provider that refuses any batch of more than one destination.
  const single=to=>false,splitOnly=refuse=>{const p={calls:0,offline:()=>true,roadBatch:async pairs=>{p.calls++;if(pairs.length>1||pairs.some(pair=>refuse(pair.to)))return {ok:false,status:'no-route'};return {ok:true,geometries:pairs.map(pair=>({route:[pair.from,pair.to],distanceKm:km(pair.from,pair.to)*1.2,durationSeconds:3600}))};}};return p;};
  const limit=Math.max(80,4*Math.max(P.MAX_ATTEMPTS*2,2*P.BATCH_SIZE-1));
  {const net=splitOnly(single),out=await plan(48,4,net,{targetRouteLoad:1,newRouteCapacity:1});assert.equal(out.length,48,'7: every truck assigned');assert.equal(net.calls,limit,`7: exactly the limit (${net.calls} of ${limit})`);results.exactLimit=net.calls;}
  // 8. The same, and half of the single destinations refused as well: the retries need more calls than the limit.
  {const net=splitOnly(share(.2));await assert.rejects(plan(48,4,net,{targetRouteLoad:1,newRouteCapacity:1}),/لم تكتمل مسارات الأسطول ضمن حد المحاولات/,'8: beyond the limit the plan stops');assert.equal(net.calls,limit,`8: it stops at the limit (${net.calls})`);results.overLimit=net.calls;}
  // 6.
  {const controller=new AbortController();controller.abort();await assert.rejects(plan(20,2,provider(),{signal:controller.signal}),/أُلغي حساب المسارات/,'6: a cancelled plan is refused');}
  console.log(JSON.stringify({suite:'build657-road-dispatch-depots',ok:true,calls:results}));
})().catch(error=>{console.error(error);process.exit(1);});
