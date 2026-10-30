'use strict';
// Release edition without routing servers (owner: «نفذ بدون خوادم وبدون ثقل وبدقه عاليه»): the public OSRM demo server
// is not for a store game, and both the manual road route and the road planner (truck dispatch) depended on it.
// GH_MAP_PROVIDER now computes a road route on the device in the release edition (GH_EDITION='release'), in the shape a
// server answer has. Proven on the real provider, route core and road planner (Node, no network):
//  1. no request is made in the release edition, whatever is asked (road, a full batch, the planner's many batches);
//  2. the geometry is exact: it starts and ends at the two points themselves, every point is a valid coordinate, it has
//     LOCAL_MIN..MAX points (one about every 25 km), its distance is the straight distance x 1.25 and its time that
//     distance at 65 km/h (inside the 42-82 km/h of roads), and it stays within the bow of the straight line;
//  3. it is deterministic: the same two points give the same route in another realm; the bow side varies by pair;
//  4. edge cases: across the date line the line stays short (no jump around the world), the same point is no route,
//     an invalid point or a batch of 13 is refused, a cancelled request is cancelled;
//  5. a batch is the same as its single routes, and the planner dispatches a fleet needing new routes with no pause
//     (the development edition still spaces its server requests 1.1 s apart, and still asks the server);
//  6. the planner's routes carry «تقدير محلي للطرق» as their source and pass the route core's conflict check.
const assert=require('node:assert/strict'),path=require('node:path'),vm=require('node:vm'),fs=require('node:fs');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
function realm(edition){
  const requests=[];const s={console,setTimeout,clearTimeout,AbortController,Date,Math,JSON,structuredClone,
    fetch:(url)=>{requests.push(String(url));return Promise.reject(new Error('network-blocked-in-test'));}};
  s.globalThis=s;s.window=s;if(edition)s.GH_EDITION=edition;vm.createContext(s);
  for(const file of ['determinism-core.js','route-core.js','map-provider-core.js','road-planner.js'])vm.runInContext(fs.readFileSync(path.join(ROOT,'WebApp',file),'utf8'),s,{filename:file});
  return {s,P:s.GH_MAP_PROVIDER,R:s.GH_ROUTE_CORE,planner:s.GH_ROAD_PLANNER,requests};
}
const km=(a,b)=>{const r=Math.PI/180,h=Math.sin((b[0]-a[0])*r/2)**2+Math.cos(a[0]*r)*Math.cos(b[0]*r)*Math.sin((b[1]-a[1])*r/2)**2;return 12742*Math.asin(Math.min(1,Math.sqrt(h)));};
const RUH=[24.7136,46.6753],JED=[21.4858,39.1925],DMM=[26.4207,50.0888],DXB=[25.2048,55.2708];
(async()=>{
  const rel=realm('release'),{P}=rel,L=P.LOCAL;
  assert.equal(P.offline(),true);assert.equal(P.health().status,'local');
  // 2.
  const pairs=[[RUH,JED],[RUH,DMM],[DMM,DXB],[JED,DXB],[RUH,[24.80,46.75]]];
  for(const [from,to] of pairs){
    const r=await P.road(from,to,{compactGeometry:true});assert.equal(r.ok,true);const g=r.geometry,straight=km(from,to);
    assert.equal(JSON.stringify(g.route[0]),JSON.stringify(from),'2: starts at the start');assert.equal(JSON.stringify(g.route.at(-1)),JSON.stringify(to),'2: ends at the end');
    assert.ok(g.route.every(p=>Array.isArray(p)&&p.length===2&&Number.isFinite(p[0])&&Number.isFinite(p[1])&&Math.abs(p[0])<=90&&Math.abs(p[1])<=180),'2: valid points');
    assert.equal(g.route.length,Math.max(L.minPoints,Math.min(L.maxPoints,Math.ceil(straight/L.stepKm)+1)),'2: one point about every 25 km, bounded');
    assert.ok(Math.abs(g.distanceKm-straight*L.detour)<1e-9,'2: distance = straight x 1.25');
    assert.ok(Math.abs(g.durationSeconds-g.distanceKm/L.speedKmh*3600)<1e-6,'2: time at 65 km/h');
    const speed=g.distanceKm/(g.durationSeconds/3600);assert.ok(speed>=42&&speed<=82,'2: inside the road speeds');
    // Within the bow: no point farther from both ends than the bow allows (half the 0.12 x length offset + the chord).
    for(const p of g.route)assert.ok(km(from,p)+km(p,to)<=straight*1.05+0.01,`2: the line stays near the straight line (${km(from,p)+km(p,to)} vs ${straight})`);
    assert.equal(g.source,'تقدير محلي للطرق');
  }
  // 3.
  const again=realm('release'),a=await P.road(RUH,JED),b=await again.P.road(RUH,JED);
  assert.equal(JSON.stringify(a),JSON.stringify(b),'3: the same route in another realm');
  const sides=new Set();for(let i=0;i<40;i++){const to=[24+i*.05,47+i*.03],g=(await P.road(RUH,to)).geometry,mid=g.route[g.route.length>>1],cross=(to[1]-RUH[1])*(mid[0]-RUH[0])-(to[0]-RUH[0])*(mid[1]-RUH[1]);if(Math.abs(cross)>1e-9)sides.add(Math.sign(cross));}
  assert.equal(sides.size,2,'3: the bow side varies by pair');
  // 4.
  const east=[10,179.5],west=[10,-179.5],dl=(await P.road(east,west)).geometry;
  for(let i=1;i<dl.route.length;i++)assert.ok(km(dl.route[i-1],dl.route[i])<km(east,west),'4: across the date line, no jump around the world');
  assert.equal(JSON.stringify(await P.road(RUH,RUH)),JSON.stringify({ok:false,status:'no-route',reason:'NoRoute'}),'4: the same point is no route');
  assert.equal((await P.road([95,0],RUH)).status,'invalid-coordinates');
  assert.equal((await P.roadBatch(Array.from({length:13},()=>({from:RUH,to:JED})))).status,'invalid-coordinates','4: a batch of 13 is refused');
  const controller=new AbortController();controller.abort();assert.equal((await P.road(RUH,JED,{signal:controller.signal})).status,'cancelled');
  // 5. A batch is its single routes.
  const batch=await P.roadBatch(pairs.map(([from,to])=>({from,to})));assert.equal(batch.ok,true);
  for(const [i,[from,to]] of pairs.entries())assert.equal(JSON.stringify(batch.geometries[i]),JSON.stringify((await P.road(from,to)).geometry),'5: the batch equals its single routes');
  // 5. The planner: 90 trucks at three origins, no existing route, 12 per new route -> several batches.
  const plan=async R=>{const origins=[{id:'O1',name:'Hub RUH',city:'Riyadh',company:'road',coords:RUH},{id:'O2',name:'Hub JED',city:'Jeddah',company:'road',coords:JED},{id:'O3',name:'Hub DMM',city:'Dammam',company:'road',coords:DMM}];
    const assets=Array.from({length:90},(_,i)=>({id:`T-${String(i).padStart(3,'0')}`,name:`Truck ${i}`,specs:{rangeKm:600},staffing:{mode:'automatic-fixed',ready:true},origin:origins[i%3]}));
    const started=Date.now(),result=await R.planner.plan({assets,routes:[],originFor:asset=>asset.origin,usable:()=>false,seed:7,routeCount:0,routeCapacity:()=>12,targetRouteLoad:12,yieldControl:()=>Promise.resolve()});
    return {result,ms:Date.now()-started};};
  const planned=await plan(rel);
  assert.equal(planned.result.length,90,'5: every truck has a route');assert.ok(planned.ms<1000,`5: no pause between batches (${planned.ms} ms)`);
  const created=planned.result.filter(row=>row.created).map(row=>row.route);assert.ok(created.length>=8,`5: new routes were made (${created.length})`);
  // 6.
  for(const route of created){assert.match(route.routingSource,/^تقدير محلي للطرق · وجهة نقل تلقائية$/,'6: the source says local');assert.equal(route.roadGeometryVersion,311);assert.ok(Math.abs(route.effectiveSpeedKmh-65)<1e-9);}
  for(let i=0;i<created.length;i++)assert.equal(rel.R.conflict(created.slice(0,i),created[i]),null,'6: no planned route conflicts with another');
  // 1.
  assert.equal(rel.requests.length,0,'1: no request in the release edition');assert.equal(again.requests.length,0);
  // 5. The development edition still asks the server and spaces its requests.
  const dev=realm(''),devRoad=await dev.P.road(RUH,JED);
  assert.equal(dev.P.offline(),false);assert.equal(devRoad.ok,false);assert.equal(dev.requests.length,1,'5: the development edition asks the server');assert.match(dev.requests[0],/^https:\/\/router\.project-osrm\.org\//);
  const timed=realm('');let calls=0;const fake={offline:()=>false,roadBatch:async pairs=>{calls++;return rel.P.roadBatch(pairs);}};
  const started=Date.now();await timed.planner.plan({assets:Array.from({length:30},(_,i)=>({id:`D-${i}`,name:`D ${i}`,specs:{rangeKm:600},staffing:{mode:'automatic-fixed',ready:true}})),routes:[],originFor:()=>({id:'O1',name:'Hub',city:'Riyadh',company:'road',coords:RUH}),usable:()=>false,provider:fake,seed:3,routeCount:0,routeCapacity:()=>1,targetRouteLoad:1,yieldControl:()=>Promise.resolve()});
  const devMs=Date.now()-started;assert.ok(calls>=3&&devMs>=1100*(calls-1)-50,`5: a server provider is still spaced (${calls} calls in ${devMs} ms)`);
  console.log(JSON.stringify({suite:'build642-local-road-geometry',ok:true,plannerMs:planned.ms,newRoutes:created.length,serverSpacedMs:devMs,serverCalls:calls}));
})().catch(error=>{console.error(error);process.exit(1);});
