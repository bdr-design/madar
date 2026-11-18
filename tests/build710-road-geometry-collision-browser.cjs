'use strict';
// Build 710 (owner, 18 Nov 2026: «أثبته ثم أصلحه»). A road route's real geometry is applied in a staged transaction of its
// own (app.js applyRoadGeometry). A simulation slice that began its transaction while it was open failed with
// 'staged-transaction-in-progress': a calendar advance stopped with SIM_CALENDAR_ADVANCE_FAILED and the game with
// SIM_FATAL_STATE (speed 0). Now a geometry drains the simulation from its plan to its commit (the slice in flight finishes,
// its finish included, and no new one starts). This gate, in the real app (local DOM, fleet worker), checks:
//   1. geometries applied over and over during a calendar advance: none refused by the collision, no fatal state, no advance
//      failure, and the advance then reaches its target;
//   2. a geometry never opens while a slice is in flight (that slice finishes first, its finish included); while one is
//      open no slice is in flight (none starts while the simulation is drained), counted in engine ticks;
//   1b. deterministic: a slice held committed-but-unfinished (the runtime stopped there): the geometry waits, opens after
//      the slice has finished, and applies;
//   1c. deterministic: a slice held in flight before its commit: the geometry asks its plan only after that slice has
//      finished (no slice in flight when the plan is asked), so its plan is current and it applies;
//   1d. deterministic: a save that locks the live state while the geometry plans: the plan answers while the lock is held,
//      the transaction opens only once the state is writable again, then applies;
//   1e. two geometries asked at once apply one after the other, both applied, with the drain released between them;
//   1f. a worker that never answers the plan: the geometry is refused after its 10 s bound and the drain is released; a
//      geometry asked within that bound is refused at once without draining; after the worker's late answer one applies;
//   1g. a save lock held when a geometry's turn comes: it waits (it is not dropped) and applies once the lock is released;
//   1h. a route rebuilt between other endpoints while its geometry waits in the drain for the slice in flight (no plan asked
//      meanwhile): refused, never opened;
//   1j. the route templates rebuilt while the plan is asked (as a command's commit rebuilds them, replaceLiveState), with
//      the cache saved (the production path): the geometry reaches the live template, and the trucks agree with it;
//   1i. a slice in flight longer than the drain's 240-frame wait: the geometry releases the drain, waits again (it is not
//      dropped) and applies once the slice ends;
//   3. the same during live play at speed;
//   4. the trucks on the route agree with its template afterwards, the save validates, no error is logged;
//   5. (source) the geometry body runs only inside the drain: its one call is in drainedRoadGeometry, reached through
//      settledRoadGeometry, which the game's caller (applyRoadGeometryWhenSettled) queues;
//   7. several of a geometry's transaction stages run in one synchronous run (batch H item 6: a ~4 ms predicted budget a
//      frame), not one a yield.
// The fixture route was built from the road form (verified geometry, version 311); just before each request it is marked
// as awaiting its geometry (version 0, no canonical cache entry) so the game's caller accepts it.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');
const SHIPS=2,TRUCKS=6;
const bend={value:0.02};
async function osrmDouble(page){
  await page.route(/https:\/\/router\.project-osrm\.org\//,route=>{
    const url=new URL(route.request().url()),coords=url.pathname.split('/').pop().split(';').map(p=>p.split(',').map(Number));
    const hav=(a,b)=>{const R=6371000,r=x=>x*Math.PI/180,dLat=r(b[1]-a[1]),dLon=r(b[0]-a[0]),h=Math.sin(dLat/2)**2+Math.cos(r(a[1]))*Math.cos(r(b[1]))*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(h));};
    const legs=[],all=[];
    for(let i=0;i<coords.length-1;i++){const a=coords[i],b=coords[i+1],n=40,pts=[];for(let k=0;k<=n;k++){const t=k/n,w=Math.sin(t*Math.PI)*(bend.value||0.02);pts.push([+(a[0]+(b[0]-a[0])*t+w).toFixed(5),+(a[1]+(b[1]-a[1])*t).toFixed(5)]);}
      const d=hav(a,b)*1.25+50;legs.push({distance:d,duration:d/22,steps:[{geometry:{coordinates:pts},distance:d,duration:d/22}]});for(const p of pts)if(!all.length||all.at(-1)[0]!==p[0]||all.at(-1)[1]!==p[1])all.push(p);}
    const distance=legs.reduce((x,l)=>x+l.distance,0);
    route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({code:'Ok',routes:[{distance,duration:distance/22,geometry:{type:'LineString',coordinates:all},legs}],waypoints:coords.map(c=>({location:c}))})});
  });
}
async function settled(page,pattern){
  await page.waitForFunction(pattern=>{const last=GH_APP_RUNTIME_METRICS.snapshot().durable.last;return !!last&&new RegExp(pattern).test(String(last.name||''))&&!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked();},pattern,{timeout:180000});
  await page.evaluate(()=>GH_PERSISTENCE.drain());
}
async function setup(page){
  await page.evaluate(async({trucks,ships})=>{
    const a=__AUDIT__,s=()=>__GH_STATE__;
    for(const type of ['road','sea']){const d=GH_COMPANY_PLATFORM.definitionFor(s(),type);await a.runAuthorizedDomainCommand('corporate','open-company',{type,companyId:type,capital:Math.max(400000000,d.founding.minimumCapital),legalName:`QA Isolation ${type}`,formationContract:`QA-ISOLATION-${type.toUpperCase()}`},{silent:true});}
    const sites=GH_MOBILITY_CORE.CAPITALS.slice(0,2);
    for(const site of sites)await a.runAuthorizedDomainCommand('facilities','create',{facility:{id:`QA-ROAD-${site.id}`,sourceKey:`site:road:${site.id}`,capitalId:site.id,kind:'logistics',company:'road',ownerCompanyId:'road',owned:true,deliveryCapacity:40,name:`QA Logistics ${site.city}`,city:site.city,country:site.country,coords:[...site.coords],cost:8500000,dailyCost:12500,capacity:'40',level:1}},{silent:true});
    const truck=[...GH_ASSET_CATALOG.road.used].sort((x,y)=>x.leaseMonthly-y.leaseMonthly||x.price-y.price)[0];
    await a.buyAsset('road','used',truck.id,'lease',trucks,`QA-ROAD-${sites[0].id}`,true,'QA-ISOLATION-ROAD','road');
    const port=GH_WORLD_DATA.ports.find(r=>Number.isFinite(Number(r[3]))&&Number.isFinite(Number(r[4])));
    await a.runAuthorizedDomainCommand('facilities','create',{facility:{id:'QA-sea-PORT',name:`QA Port ${port[0]}`,kind:'port-base',company:'sea',ownerCompanyId:'sea',owned:true,sourceKey:`port:${port[0]}:${port[3]}:${port[4]}`,code:String(port[0]).slice(0,5),city:String(port[1]||port[0]),country:String(port[2]||'—'),coords:[port[3],port[4]]},bucket:'globalBases'},{silent:true});
    const ship=[...GH_ASSET_CATALOG.sea.used].sort((x,y)=>(x.leaseMonthly||0)-(y.leaseMonthly||0)||x.price-y.price)[0];
    await a.buyAsset('sea','used',ship.id,'lease',ships,'QA-sea-PORT',true,'QA-ISOLATION-SEA','sea');
    await GH_PERSISTENCE.drain();
  },{trucks:TRUCKS,ships:SHIPS});
  // One road route from the real form, and the trucks dispatched on it.
  await page.evaluate(()=>__AUDIT__.openDrawer('routes','road'));
  const manual=page.locator('.build-road-route[data-company="road"]').first();await manual.waitFor({state:'visible'});
  await page.evaluate(()=>{const from=document.getElementById('roadFrom'),to=document.getElementById('roadTo');const first=from.options[0].value;from.value=first;to.value=[...to.options].find(row=>row.value!==first).value;});
  await manual.click();await settled(page,'road');
  await page.evaluate(()=>__AUDIT__.openDrawer('routes','road'));
  await page.locator('.dispatch-existing-network[data-company="road"]').first().click();await settled(page,'bulk-shared-departure:road');
  return page.evaluate(()=>{const counts={};GH_FLEET_DATA.forEach(__GH_STATE__,a=>{if((a.ownerCompanyId||a.companyId)==='road'&&a.routeId)counts[a.routeId]=(counts[a.routeId]||0)+1;});return Object.entries(counts).sort((x,y)=>y[1]-x[1])[0]?.[0];});
}


async function applyMany(page,roadRoute,{advance,speed,limit}){
  return page.evaluate(async({roadRoute,advance,speed,limit})=>{
    const a=__AUDIT__,s=__GH_STATE__,tpl=a.routeTemplatesFor(roadRoute),base=JSON.parse(JSON.stringify(tpl.route)),now=Number(s.simSeconds)||0,target=(Math.floor(now/86400)+1)*86400;
    const cancelsBefore=GH_SIM_KERNEL.snapshot().cancels||0,startSim=Number(s.simSeconds)||0;
    // (At the moment a geometry's transaction opens, no slice may be in flight, committed or not: its finish must have run.
    //  Observed by wrapping the transaction owner the app reads at call time.)
    const TX=window.GH_TRANSACTION_CORE,opens={count:0,readyToFinish:0,jobActive:0};
    window.GH_TRANSACTION_CORE=Object.freeze({...TX,beginStaged:(target,options)=>{if(String(options?.label||'').startsWith('road-geometry')){opens.count++;const snap=GH_SIM_KERNEL.snapshot();if(snap.jobReadyToFinish)opens.readyToFinish++;if(snap.jobActive)opens.jobActive++;}return TX.beginStaged(target,options);}});
    // Samples while a geometry is open: is a slice kept in flight past the first frame?
    const watch={open:0,kept:0,timer:null,sinceTick:null,maxTicks:0};watch.timer=setInterval(()=>{const snap=GH_SIM_KERNEL.snapshot(),ticks=Number(snap.runtime?.ticks)||0;if(a.foreignHolds()>0){if(watch.sinceTick===null)watch.sinceTick=ticks;watch.open++;if(snap.jobActive){const after=ticks-watch.sinceTick;if(after>=2)watch.kept++;watch.maxTicks=Math.max(watch.maxTicks,after);}}else watch.sinceTick=null;},4);
    if(advance){if(!a.requestCalendarAdvance(target,'qa-710','+1'))throw new Error('advance refused');}else s.speed=speed;
    const results=[];let i=0;const busy=()=>advance?!!GH_SIM_KERNEL.snapshot().manualAdvance:true;
    // (Each attempt waits until the live state is writable, as the game's caller applyRoadGeometryWhenSettled does; a save or
    //  command in progress is not the collision this gate is about.)
    while(busy()&&i<limit){for(let w=0;w<400&&!a.liveStateWritable();w++)await new Promise(r=>setTimeout(r,10));if(!busy())break;i++;const shift=(i%2?1:-1)*0.002;const route=base.map(p=>[p[0]+shift,p[1]]);
      try{results.push(await __QA_AWAITING__(roadRoute)(roadRoute,{route,durationSeconds:3600+i},false));}catch(e){results.push('throw:'+e.message);}
      watch.sinceTick=null;await new Promise(r=>setTimeout(r,60));} // (each geometry counts its own ticks; slices run in the gap between two)
    if(!advance){await new Promise(r=>setTimeout(r,2500));s.speed=0;} // (play resumes once the geometries release the simulation)
    const t0=performance.now();while(advance&&GH_SIM_KERNEL.snapshot().manualAdvance&&performance.now()-t0<120000)await new Promise(r=>setTimeout(r,50));
    clearInterval(watch.timer);window.GH_TRANSACTION_CORE=TX;await a.whenStateIdle?.();
    const k=s.simulationKernel||{},snap=GH_SIM_KERNEL.snapshot();
    return {startSim,tries:i,applied:results.filter(x=>x===true).length,other:results.filter(x=>x!==true).slice(0,3),fatal:k.runtimeFatal||null,failure:k.lastAdvanceFailure||null,sim:s.simSeconds,target,advancing:!!snap.manualAdvance,cancels:(snap.cancels||0)-cancelsBefore,lastCancel:snap.lastCancelReason,watch:{open:watch.open,kept:watch.kept,maxTicks:watch.maxTicks},opens};
  },{roadRoute,advance,speed,limit});
}
(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    const {page}=await boot({browser,errors,bypassCSP:true,fleetWorker:true,appAudit:"{applyRoadGeometry:applyRoadGeometryWhenSettled,requestCalendarAdvance,liveStateWritable,foreignHolds:()=>String(activeStagedSlice?.label||'').startsWith('road-geometry')?1:0,simEngine:()=>simulationEngine,simRuntime:()=>simulationRuntime,fleetThread:()=>fleetEngineThread(),drains:()=>foreignStagedDrains,rebuildTemplate:id=>{routeTemplates[id]=clone(routeTemplates[id]);return routeTemplates[id];}}"});page.setDefaultTimeout(180000);await osrmDouble(page);
    const roadRoute=await setup(page);assert(roadRoute,'fixture: trucks on a road route');
    // (The template is rebuilt from the saved route during play, so each request marks it again just before it is made.)
    await page.evaluate(()=>{window.__QA_AWAITING__=roadRoute=>{const tpl=__AUDIT__.routeTemplatesFor(roadRoute);tpl.roadGeometryVersion=0;if(__GH_STATE__.routeCache?.[roadRoute])delete __GH_STATE__.routeCache[roadRoute].canonicalRouteId;return __AUDIT__.applyRoadGeometry;};});
    // 1-2. During a calendar advance.
    const adv=await applyMany(page,roadRoute,{advance:true,limit:12});
    assert.equal(adv.fatal,null,`1: no fatal state (${JSON.stringify(adv.fatal)})`);assert.equal(adv.failure,null,`1: the advance did not fail (${JSON.stringify(adv.failure)})`);
    assert.equal(adv.applied,adv.tries,`1: every geometry applied (${JSON.stringify(adv)})`);assert.ok(adv.tries>=3,`1: geometries were applied during the advance (${adv.tries})`);
    assert.equal(adv.advancing,false,'1: the advance finished');assert.equal(adv.sim,adv.target,'1: it reached its target');
    assert.equal(adv.opens.count,adv.tries,'2: each geometry opened its transaction');assert.equal(adv.opens.readyToFinish,0,`2: never while a slice is committed but unfinished (${JSON.stringify(adv.opens)})`);assert.equal(adv.opens.jobActive,0,`2: never while a slice is in flight (it finished first) (${JSON.stringify(adv.opens)})`);
    assert.ok(adv.watch.open>0,`2: a geometry was observed open (${JSON.stringify(adv.watch)})`);assert.equal(adv.watch.kept,0,`2: no slice kept in flight while a geometry is open (${JSON.stringify(adv.watch)})`);
    // 1b. Deterministic: a slice held committed-but-unfinished (the runtime stopped at that moment); a geometry asked then
    //     waits, opens only after the slice has finished, and applies.
    const held=await page.evaluate(async roadRoute=>{
      const a=__AUDIT__,s=__GH_STATE__,eng=a.simEngine(),rt=a.simRuntime(),tpl=a.routeTemplatesFor(roadRoute),base=JSON.parse(JSON.stringify(tpl.route));
      // The first slice transaction that commits holds the thread past the frame deadline and stops the runtime: the engine
      // keeps it committed but unfinished (the finish deferred to a next tick that does not come until the runtime restarts).
      const SIM_TX=window.GH_TRANSACTION_CORE;let armed=true;
      window.GH_TRANSACTION_CORE=Object.freeze({...SIM_TX,beginStaged:(target,options)=>{const handle=SIM_TX.beginStaged(target,options);if(String(options?.label||'').startsWith('road-geometry'))return handle;
        return new Proxy(handle,{get(h,key){if(key!=='step')return typeof h[key]==='function'?h[key].bind(h):h[key];return(...args)=>{const out=h.step(...args);if(armed&&h.done&&h.result?.committed){armed=false;const until=performance.now()+40;while(performance.now()<until){}rt.stop();}return out;};}});}});
      const now=Number(s.simSeconds)||0,target=(Math.floor(now/86400)+1)*86400;if(!a.requestCalendarAdvance(target,'qa-710b','+1')){window.GH_TRANSACTION_CORE=SIM_TX;return {started:false};}
      let caught=false;for(let i=0;i<60000&&eng.snapshot().manualAdvance;i++){if(!armed){caught=eng.snapshot().jobReadyToFinish===true;break;}await new Promise(r=>setTimeout(r,0));}
      window.GH_TRANSACTION_CORE=SIM_TX;if(!caught)rt.start();
      if(!caught){const t0=performance.now();while(eng.snapshot().manualAdvance&&performance.now()-t0<120000)await new Promise(r=>setTimeout(r,50));return {started:true,caught:false};}
      const TX=window.GH_TRANSACTION_CORE,opens={count:0,readyToFinish:0};
      window.GH_TRANSACTION_CORE=Object.freeze({...TX,beginStaged:(target,options)=>{if(String(options?.label||'').startsWith('road-geometry')){opens.count++;if(eng.snapshot().jobReadyToFinish)opens.readyToFinish++;}return TX.beginStaged(target,options);}});
      const cancelsBefore=eng.snapshot().cancels||0,committedAt=Number(s.simSeconds)||0,asked=__QA_AWAITING__(roadRoute)(roadRoute,{route:base.map(p=>[p[0]+0.003,p[1]]),durationSeconds:7300},false);
      await new Promise(r=>setTimeout(r,500));
      const whileHeld={opened:opens.count,stillReady:eng.snapshot().jobReadyToFinish===true};
      rt.start();const applied=await asked;window.GH_TRANSACTION_CORE=TX;
      const t0=performance.now();while(eng.snapshot().manualAdvance&&performance.now()-t0<120000)await new Promise(r=>setTimeout(r,50));
      const k=s.simulationKernel||{};
      return {started:true,caught:true,whileHeld,applied,opens,committedAt,cancels:(eng.snapshot().cancels||0)-cancelsBefore,fatal:k.runtimeFatal||null,failure:k.lastAdvanceFailure||null,done:!eng.snapshot().manualAdvance,sim:s.simSeconds,target};
    },roadRoute);
    assert.equal(held.started,true,'1b: the advance started');assert.equal(held.caught,true,`1b: a slice was caught committed but unfinished (${JSON.stringify(held)})`);
    assert.equal(held.whileHeld.stillReady,true,'1b: the fixture held it there');assert.equal(held.whileHeld.opened,0,`1b: the geometry did not open while the slice was unfinished (${JSON.stringify(held)})`);
    assert.equal(held.applied,true,'1b: then it applied');assert.equal(held.cancels,0,'1b: the held slice was not cancelled (it finished)');assert.equal(held.opens.readyToFinish,0,'1b: and it opened only after the slice had finished');
    assert.equal(held.fatal,null);assert.equal(held.failure,null);assert.equal(held.done,true,'1b: the advance finished');assert.equal(held.sim,held.target);
    // 1c. A slice held in flight before it begins its transaction (the runtime stopped while it waits for its fleet step).
    const early=await page.evaluate(async roadRoute=>{
      const a=__AUDIT__,s=__GH_STATE__,eng=a.simEngine(),rt=a.simRuntime(),tpl=a.routeTemplatesFor(roadRoute),base=JSON.parse(JSON.stringify(tpl.route));
      const now=Number(s.simSeconds)||0,target=(Math.floor(now/86400)+1)*86400;if(!a.requestCalendarAdvance(target,'qa-710c','+1'))return {started:false};
      let caught=false;for(let i=0;i<60000&&eng.snapshot().manualAdvance;i++){if(eng.jobActive()&&!window.GH_TRANSACTION_CORE.isStaged(s)&&!eng.snapshot().jobReadyToFinish){rt.stop();caught=true;break;}await new Promise(r=>setTimeout(r,0));}
      if(!caught){const t0=performance.now();while(eng.snapshot().manualAdvance&&performance.now()-t0<120000)await new Promise(r=>setTimeout(r,50));return {started:true,caught:false};}
      const client=a.fleetThread(),query=client.query,asks=[];client.query=function(store,request){if(request?.name==='routeNormalizationPlan')asks.push({jobActive:eng.jobActive(),readyToFinish:eng.snapshot().jobReadyToFinish===true});return query.apply(this,arguments);};
      const simAt=Number(s.simSeconds)||0,asked=__QA_AWAITING__(roadRoute)(roadRoute,{route:base.map(p=>[p[0]-0.003,p[1]]),durationSeconds:7400},false);
      await new Promise(r=>setTimeout(r,400));const whileHeld={jobActive:eng.jobActive(),sim:Number(s.simSeconds)||0,asks:asks.length};
      rt.start();const applied=await asked;client.query=query;
      const t0=performance.now();while(eng.snapshot().manualAdvance&&performance.now()-t0<120000)await new Promise(r=>setTimeout(r,50));
      const k=s.simulationKernel||{};return {started:true,caught:true,simAt,whileHeld,asks,applied,fatal:k.runtimeFatal||null,failure:k.lastAdvanceFailure||null,done:!eng.snapshot().manualAdvance,sim:s.simSeconds,target};
    },roadRoute);
    assert.equal(early.caught,true,`1c: a slice was caught in flight before its commit (${JSON.stringify(early)})`);assert.equal(early.whileHeld.jobActive,true,'1c: the fixture held it there');assert.equal(early.whileHeld.asks,0,'1c: no plan asked while the slice is held');
    assert.deepEqual(early.asks,[{jobActive:false,readyToFinish:false}],`1c: the plan asked once, with no slice in flight (${JSON.stringify(early.asks)})`);
    assert.equal(early.applied,true,`1c: the geometry applied after that slice committed (its plan made after it) (${JSON.stringify(early)})`);assert.equal(early.fatal,null);assert.equal(early.failure,null);assert.equal(early.done,true);assert.equal(early.sim,early.target);
    // 1d. The game paused; the save lock raised just after the geometry starts (its plan in flight), released 400 ms later.
    const locked=await page.evaluate(async roadRoute=>{
      const a=__AUDIT__,s=__GH_STATE__,tpl=a.routeTemplatesFor(roadRoute),base=JSON.parse(JSON.stringify(tpl.route));s.speed=0;await a.whenStateIdle?.();
      const P=window.GH_PERSISTENCE,TX=window.GH_TRANSACTION_CORE;let lock=false,lockedChecks=0;const opens={count:0,whileLocked:0};
      window.GH_PERSISTENCE=Object.freeze({...P,isLocked:()=>{if(lock)lockedChecks++;return lock||P.isLocked();}});
      window.GH_TRANSACTION_CORE=Object.freeze({...TX,beginStaged:(target,options)=>{if(String(options?.label||'').startsWith('road-geometry')){opens.count++;if(lock)opens.whileLocked++;}return TX.beginStaged(target,options);}});
      for(let w=0;w<400&&!a.liveStateWritable();w++)await new Promise(r=>setTimeout(r,10));
      // (The lock rises when the geometry captures its plan's stamp, after its first checks: it is held 400 ms.)
      const N=window.GH_FLEET_ROUTE_NORMALIZATION;let released=null,openedWhileLocked=null;
      window.GH_FLEET_ROUTE_NORMALIZATION=Object.freeze({...N,capture:(...args)=>{if(!lock&&!released){lock=true;released=new Promise(r=>setTimeout(()=>{openedWhileLocked=opens.count;lock=false;r();},400));}return N.capture(...args);}});
      const client=a.fleetThread(),query=client.query;let answeredWhileLocked=null;client.query=function(store,request){const out=query.apply(this,arguments);if(request?.name==='routeNormalizationPlan'&&out)Promise.resolve(out).then(()=>{answeredWhileLocked=lock;},()=>{});return out;};
      const asked=__QA_AWAITING__(roadRoute)(roadRoute,{route:base.map(p=>[p[0]+0.004,p[1]]),durationSeconds:7500},false);
      const applied=await asked;await released;client.query=query;window.GH_FLEET_ROUTE_NORMALIZATION=N;window.GH_PERSISTENCE=P;window.GH_TRANSACTION_CORE=TX;return {applied,openedWhileLocked,opens,lockedChecks,answeredWhileLocked,captured:!!released};
    },roadRoute);
    assert.equal(locked.captured,true,'1d: the lock rose while the plan was made');assert.equal(locked.openedWhileLocked,0,`1d: no transaction while the save lock is held (${JSON.stringify(locked)})`);assert.equal(locked.applied,true,'1d: applied once the state is writable');assert.equal(locked.opens.whileLocked,0);assert.equal(locked.answeredWhileLocked,true,`1d: the plan answered while the lock was held, so the wait before the transaction ran (${JSON.stringify(locked)})`);
    // 1e. Two geometries asked at once (as the route hydration asks them): they apply one after the other, the second planned
    //     after the first committed, so both apply. 7. Several of a geometry's stages run in one frame (item 6).
    const pair=await page.evaluate(async roadRoute=>{
      const a=__AUDIT__,s=__GH_STATE__,tpl=a.routeTemplatesFor(roadRoute),base=JSON.parse(JSON.stringify(tpl.route));s.speed=0;await a.whenStateIdle?.();
      for(let w=0;w<400&&!a.liveStateWritable();w++)await new Promise(r=>setTimeout(r,10));
      // (Two stages in one synchronous run: the second runs before the microtask queued after the first.)
      const TX=window.GH_TRANSACTION_CORE,pace={steps:0,sameRun:0,inRun:false},gap={opens:0,first:null,releasedBetween:false};
      const sampler=setInterval(()=>{if(gap.opens===1&&gap.first?.done&&a.drains()===0)gap.releasedBetween=true;},1);
      window.GH_TRANSACTION_CORE=Object.freeze({...TX,beginStaged:(target,options)=>{const handle=TX.beginStaged(target,options);if(!String(options?.label||'').startsWith('road-geometry'))return handle;gap.opens++;if(gap.opens===1)gap.first=handle;
        return new Proxy(handle,{get(h,key){if(key!=='step')return typeof h[key]==='function'?h[key].bind(h):h[key];return(...args)=>{pace.steps++;if(pace.inRun)pace.sameRun++;pace.inRun=true;queueMicrotask(()=>{pace.inRun=false;});return h.step(...args);};}});}});
      const results=await Promise.all([__QA_AWAITING__(roadRoute)(roadRoute,{route:base.map(p=>[p[0]+0.005,p[1]]),durationSeconds:7600},false),__QA_AWAITING__(roadRoute)(roadRoute,{route:base.map(p=>[p[0]-0.005,p[1]]),durationSeconds:7700},false)]);
      clearInterval(sampler);window.GH_TRANSACTION_CORE=TX;return {results,steps:pace.steps,sameRun:pace.sameRun,opens:gap.opens,releasedBetween:gap.releasedBetween};
    },roadRoute);
    assert.deepEqual(pair.results,[true,true],`1e: both geometries applied, one after the other (${JSON.stringify(pair)})`);
    assert.equal(pair.opens,2);assert.equal(pair.releasedBetween,true,`1e: the drain was released between the two geometries (${JSON.stringify(pair)})`);
    assert.ok(pair.sameRun>0,`7: several stages in one synchronous run (${JSON.stringify(pair)})`);
    // 1f. A worker that never answers the plan: the geometry gives up after its bound (10 s) and the simulation is no longer
    //     drained (the game moves again).
    const hung=await page.evaluate(async roadRoute=>{
      const a=__AUDIT__,s=__GH_STATE__,tpl=a.routeTemplatesFor(roadRoute),base=JSON.parse(JSON.stringify(tpl.route)),client=a.fleetThread(),query=client.query;s.speed=0;await a.whenStateIdle?.();
      for(let w=0;w<400&&!a.liveStateWritable();w++)await new Promise(r=>setTimeout(r,10));
      let answer=null;client.query=function(store,request){if(request?.name==='routeNormalizationPlan')return new Promise(r=>{answer=r;});return query.apply(this,arguments);};
      const t0=performance.now(),applied=await __QA_AWAITING__(roadRoute)(roadRoute,{route:base.map(p=>[p[0]+0.006,p[1]]),durationSeconds:7800},false),waited=performance.now()-t0;
      client.query=query;const drains=a.drains(),sim0=Number(s.simSeconds)||0;s.speed=3;await new Promise(r=>setTimeout(r,2500));s.speed=0;const moved=(Number(s.simSeconds)||0)>sim0;await a.whenStateIdle?.();
      // (Within the bound: dropped at once, the simulation never drained.)
      let drainedSeen=0;const sampler=setInterval(()=>{if(a.drains()>0)drainedSeen++;},1);
      const t1=performance.now(),second=await __QA_AWAITING__(roadRoute)(roadRoute,{route:base.map(p=>[p[0]+0.007,p[1]]),durationSeconds:7900},false),secondMs=performance.now()-t1;clearInterval(sampler);
      // (The worker's late answer ends the bound.)
      answer?.(null);await new Promise(r=>setTimeout(r,50));const third=await __QA_AWAITING__(roadRoute)(roadRoute,{route:base.map(p=>[p[0]+0.008,p[1]]),durationSeconds:8000},false);
      return {applied,waited,drains,moved,second,secondMs,drainedSeen,third};
    },roadRoute);
    assert.equal(hung.applied,false,'1f: the unanswered geometry is refused');assert.ok(hung.waited>=9000&&hung.waited<20000,`1f: after its bound (${Math.round(hung.waited)} ms)`);
    assert.equal(hung.drains,0,'1f: the simulation is no longer drained');assert.equal(hung.moved,true,'1f: the game moves again');
    assert.equal(hung.second,false,'1f: a geometry asked within the bound is dropped');assert.ok(hung.secondMs<2000,`1f: at once (${Math.round(hung.secondMs)} ms)`);assert.equal(hung.drainedSeen,0,'1f: without draining the simulation');
    assert.equal(hung.third,true,`1f: after the worker's late answer a geometry applies (${JSON.stringify(hung)})`);
    // 1g. A save lock held when the geometry's turn comes: it waits, then applies once released.
    const turn=await page.evaluate(async roadRoute=>{
      const a=__AUDIT__,s=__GH_STATE__,tpl=a.routeTemplatesFor(roadRoute),base=JSON.parse(JSON.stringify(tpl.route));s.speed=0;await a.whenStateIdle?.();
      for(let w=0;w<400&&!a.liveStateWritable();w++)await new Promise(r=>setTimeout(r,10));
      const P=window.GH_PERSISTENCE,TX=window.GH_TRANSACTION_CORE;let lock=true;const opens={count:0,whileLocked:0};
      window.GH_PERSISTENCE=Object.freeze({...P,isLocked:()=>lock||P.isLocked()});
      window.GH_TRANSACTION_CORE=Object.freeze({...TX,beginStaged:(target,options)=>{if(String(options?.label||'').startsWith('road-geometry')){opens.count++;if(lock)opens.whileLocked++;}return TX.beginStaged(target,options);}});
      const asked=__QA_AWAITING__(roadRoute)(roadRoute,{route:base.map(p=>[p[0]+0.009,p[1]]),durationSeconds:8100},false);
      await new Promise(r=>setTimeout(r,600));const openedWhileLocked=opens.count;lock=false;
      const applied=await asked;window.GH_PERSISTENCE=P;window.GH_TRANSACTION_CORE=TX;return {applied,openedWhileLocked,opens};
    },roadRoute);
    assert.equal(turn.openedWhileLocked,0,`1g: nothing opened while locked (${JSON.stringify(turn)})`);assert.equal(turn.applied,true,`1g: the geometry waited and applied (${JSON.stringify(turn)})`);
    // 1h. The route rebuilt between other endpoints while its geometry waits inside the drain for the slice in flight: refused,
    //     never opened. (The game paused; the engine reports a slice in flight until the route has changed, so the wait in
    //     the drain is reached deterministically: the replica is ready, unlike with a real slice held mid-way.)
    const moved=await page.evaluate(async roadRoute=>{
      const a=__AUDIT__,s=__GH_STATE__,eng=a.simEngine(),tpl=a.routeTemplatesFor(roadRoute),base=JSON.parse(JSON.stringify(tpl.route));s.speed=0;await a.whenStateIdle?.();
      for(let w=0;w<400&&!a.liveStateWritable();w++)await new Promise(r=>setTimeout(r,10));
      const TX=window.GH_TRANSACTION_CORE,opens={count:0};window.GH_TRANSACTION_CORE=Object.freeze({...TX,beginStaged:(target,options)=>{if(String(options?.label||'').startsWith('road-geometry'))opens.count++;return TX.beginStaged(target,options);}});
      const jobActive=eng.jobActive;let held=true,asksWhileHeld=0;eng.jobActive=function(){return held||jobActive.apply(this,arguments);};
      const client=a.fleetThread(),query=client.query;client.query=function(store,request){if(request?.name==='routeNormalizationPlan'&&held)asksWhileHeld++;return query.apply(this,arguments);};
      const to=tpl.toFacility;let entered=false,asksHeld=null,applied=null;
      try{const asked=__QA_AWAITING__(roadRoute)(roadRoute,{route:base.map(p=>[p[0]-0.009,p[1]]),durationSeconds:8200},false);
        for(let i=0;i<300&&!entered;i++){await new Promise(r=>setTimeout(r,10));entered=a.drains()>0;}
        await new Promise(r=>setTimeout(r,300));asksHeld=asksWhileHeld;
        tpl.toFacility=`${to}-QA-REBUILT`;held=false;applied=await asked;
      }finally{held=false;tpl.toFacility=to;eng.jobActive=jobActive;client.query=query;window.GH_TRANSACTION_CORE=TX;}
      const k=s.simulationKernel||{};return {entered,asksHeld,applied,opens:opens.count,drains:a.drains(),fatal:k.runtimeFatal||null};
    },roadRoute);
    assert.equal(moved.entered,true,`1h: the geometry was waiting inside the drain when the route changed (${JSON.stringify(moved)})`);assert.equal(moved.asksHeld,0,`1h: no plan asked while the slice is in flight (the drain waits for it first) (${JSON.stringify(moved)})`);
    assert.equal(moved.applied,false,`1h: refused (${JSON.stringify(moved)})`);assert.equal(moved.opens,0,'1h: never opened');assert.equal(moved.drains,0);assert.equal(moved.fatal,null);
    // 1i. A slice in flight for longer than the drain's wait (240 frames): the drain is released, the geometry waits again and
    //     applies once the slice ends.
    const longSlice=await page.evaluate(async roadRoute=>{
      const a=__AUDIT__,s=__GH_STATE__,eng=a.simEngine(),tpl=a.routeTemplatesFor(roadRoute),base=JSON.parse(JSON.stringify(tpl.route));s.speed=0;await a.whenStateIdle?.();
      for(let w=0;w<400&&!a.liveStateWritable();w++)await new Promise(r=>setTimeout(r,10));
      const jobActive=eng.jobActive;let held=true,frames=0,live=true,drained=0,released=0;const tick=()=>{frames++;if(a.drains()>0)drained++;else if(drained)released++;if(live)requestAnimationFrame(tick);};requestAnimationFrame(tick);
      eng.jobActive=function(){return held||jobActive.apply(this,arguments);};
      let heldFrames=0,applied=null;
      try{const asked=__QA_AWAITING__(roadRoute)(roadRoute,{route:base.map(p=>[p[0]+0.01,p[1]]),durationSeconds:8300},false);
        for(let i=0;i<1500&&frames<300;i++)await new Promise(r=>setTimeout(r,10));
        heldFrames=frames;held=false;applied=await asked;
      }finally{held=false;live=false;eng.jobActive=jobActive;}
      return {applied,heldFrames,drained,released,drains:a.drains()};
    },roadRoute);
    assert.ok(longSlice.heldFrames>=260,`1i: the slice was held past the wait (${JSON.stringify(longSlice)})`);assert.ok(longSlice.released>0,`1i: the drain was released while it waited again (${JSON.stringify(longSlice)})`);
    assert.equal(longSlice.applied,true,`1i: then it applied (${JSON.stringify(longSlice)})`);assert.equal(longSlice.drains,0);
    // 1j. Templates rebuilt while the plan is asked; the cache saved.
    const rebuilt=await page.evaluate(async roadRoute=>{
      const a=__AUDIT__,s=__GH_STATE__,tpl=a.routeTemplatesFor(roadRoute),base=JSON.parse(JSON.stringify(tpl.route));s.speed=0;await a.whenStateIdle?.();
      for(let w=0;w<400&&!a.liveStateWritable();w++)await new Promise(r=>setTimeout(r,10));
      const client=a.fleetThread(),query=client.query;let detached=null;client.query=function(store,request){if(request?.name==='routeNormalizationPlan'&&!detached){detached=a.routeTemplatesFor(roadRoute);a.rebuildTemplate(roadRoute);}return query.apply(this,arguments);};
      const route=base.map(p=>[p[0]+0.011,p[1]]),applied=await __QA_AWAITING__(roadRoute)(roadRoute,{route,durationSeconds:8400},true);client.query=query;await GH_PERSISTENCE.drain();
      const live=a.routeTemplatesFor(roadRoute),trucks=GH_FLEET_DATA.filter(s,x=>x.routeId===roadRoute).map(x=>x.distanceKm);
      return {applied,rebuilt:!!detached&&detached!==live,liveRoute:JSON.stringify(live.route?.[1])===JSON.stringify(route[1]),liveKm:live.distanceKm,trucks,cachedKm:s.routeCache?.[roadRoute]?Number(s.routeCache[roadRoute].distanceKm):null};
    },roadRoute);
    assert.equal(rebuilt.applied,true,`1j: applied (${JSON.stringify(rebuilt)})`);assert.equal(rebuilt.rebuilt,true,'1j: the template was rebuilt during the plan');
    assert.equal(rebuilt.liveRoute,true,`1j: the live template carries the new geometry (${JSON.stringify(rebuilt)})`);assert.ok(rebuilt.trucks.length>0&&rebuilt.trucks.every(d=>Math.abs(d-rebuilt.liveKm)<1e-6),`1j: the trucks agree with the live template (${JSON.stringify(rebuilt)})`);
    assert.ok(rebuilt.cachedKm!==null&&Math.abs(rebuilt.cachedKm-rebuilt.liveKm)<1e-6,`1j: cached by cache-geometry inside the transaction (a custom route's entry names its canonical route; its distance is the new one) (${JSON.stringify(rebuilt)})`);
    // 3. Live play.
    const live=await applyMany(page,roadRoute,{advance:false,speed:3,limit:8});
    assert.equal(live.fatal,null,`3: no fatal state at speed (${JSON.stringify(live.fatal)})`);assert.equal(live.applied,live.tries,`3: every geometry applied at speed (${JSON.stringify(live)})`);assert.equal(live.watch.kept,0,'3: no slice kept in flight while a geometry is open');assert.equal(live.opens.readyToFinish,0,`3: never while a slice is committed but unfinished (${JSON.stringify(live.opens)})`);assert.equal(live.opens.jobActive,0,`3: never while a slice is in flight (${JSON.stringify(live.opens)})`);assert.ok(live.sim>live.startSim,`3: play resumed after the geometries (${live.startSim}→${live.sim})`);
    // 4. Consistency.
    const read=await page.evaluate(roadRoute=>{const tpl=__AUDIT__.routeTemplatesFor(roadRoute);return {template:tpl.distanceKm,trucks:GH_FLEET_DATA.filter(__GH_STATE__,a=>a.routeId===roadRoute).map(a=>a.distanceKm),valid:GH_SAVE_SCHEMA.validate(__GH_STATE__).ok};},roadRoute);
    assert.ok(read.trucks.length>0&&read.trucks.every(d=>Math.abs(d-read.template)<1e-6),`4: trucks agree with the template (${JSON.stringify(read)})`);assert.equal(read.valid,true,'4: the save validates');
    assert.deepEqual(errors,[],'4: no error');
    // 5.
    {const app=fs.readFileSync(path.join(process.env.GH_AUDIT_ROOT||path.resolve(__dirname,'..'),'WebApp','app.js'),'utf8');
      const fn=name=>{const a=app.search(new RegExp(`\\n  (async )?function ${name}\\(`));assert.ok(a>=0,name);return app.slice(a,app.indexOf('\n  }\n',a+1)+4);};
      const calls=[...app.matchAll(/(?<![\w.])applyRoadGeometry\(/g)].length;assert.equal(calls,2,`5: the geometry body is defined once and called once (${calls})`);
      assert.match(fn('drainedRoadGeometry'),/foreignStagedDrains\+\+;[\s\S]*return await applyRoadGeometry\(routeId,geometry,saveCache\)/,'5: that one call is inside the drain');assert.match(fn('settledRoadGeometry'),/await drainedRoadGeometry\(routeId,geometry,saveCache,request\)/,'5: reached through the settled wait');
      assert.match(fn('applyRoadGeometryWhenSettled'),/roadGeometryChain\.then\(\(\)=>settledRoadGeometry\(routeId,geometry,saveCache,request\)\)/,'5: which the game\'s caller queues');
      assert.equal([...app.matchAll(/(?<![\w.])drainedRoadGeometry\(/g)].length,2,'5: drainedRoadGeometry defined once, called once');}
    console.log(JSON.stringify({suite:'build710-road-geometry-collision-browser',ok:true,advance:{tries:adv.tries,cancels:adv.cancels,open:adv.watch.open},live:{tries:live.tries}}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
