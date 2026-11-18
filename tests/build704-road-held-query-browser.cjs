'use strict';
// Build 704, batch D (road). A road fleet above the fleet worker's threshold could not be dispatched while the clock ran
// through a calendar advance: the idle-truck query of the live fleet met a simulation step on its way to the worker and
// was refused (fleet-dispatch-worker-not-ready), so the button failed at once and the automatic dispatch after the close
// was deferred every day. The query now holds the simulation for itself only (as a purchase's quote does) and waits for
// the step in flight. In the real app (local DOM, fleet worker, a stub routing server):
//   1. during a calendar advance, at a moment the worker is refusing live queries, the road dispatch places its trucks
//      (one committed command), the hold is released, and the clock keeps moving afterwards;
//   2. two presses at once start one planning: the first reserves it before its query (synchronously), the second is
//      refused while the first is still pending, and one command departs;
//   2b. a press that finds no idle truck (the automatic "none" path and the manual one) releases the reservation: the
//      next press plans and departs;
//   2d. a new game during the held query stops the press and releases the planning;
//   2c. presses during a calendar advance never move the clock back (the engine drains the step in flight instead of
//      cancelling it) and the clock moves during each;
//   3. the automatic dispatch's probes use the held query too (source);
//   4. no error is logged.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');
async function osrmDouble(page){
  await page.route(/https:\/\/router\.project-osrm\.org\//,route=>{
    const url=new URL(route.request().url()),coords=url.pathname.split('/').pop().split(';').map(p=>p.split(',').map(Number));
    const hav=(a,b)=>{const R=6371000,r=x=>x*Math.PI/180,dLat=r(b[1]-a[1]),dLon=r(b[0]-a[0]),h=Math.sin(dLat/2)**2+Math.cos(r(a[1]))*Math.cos(r(b[1]))*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(h));};
    const legs=[],all=[];
    for(let i=0;i<coords.length-1;i++){const a=coords[i],b=coords[i+1],n=40,pts=[];for(let k=0;k<=n;k++){const t=k/n,w=Math.sin(t*Math.PI)*0.02;pts.push([+(a[0]+(b[0]-a[0])*t+w).toFixed(5),+(a[1]+(b[1]-a[1])*t).toFixed(5)]);}
      const d=hav(a,b)*1.25+50;legs.push({distance:d,duration:d/22,steps:[{geometry:{coordinates:pts},distance:d,duration:d/22}]});for(const p of pts)if(!all.length||all.at(-1)[0]!==p[0]||all.at(-1)[1]!==p[1])all.push(p);}
    const distance=legs.reduce((x,l)=>x+l.distance,0);
    route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({code:'Ok',routes:[{distance,duration:distance/22,geometry:{type:'LineString',coordinates:all},legs}],waypoints:coords.map(c=>({location:c}))})});
  });
}
(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    const {page}=await boot({browser,errors,fleetWorker:true,bypassCSP:true,appAudit:"{roadBatch:(c,o)=>dispatchExistingDistinctNetworkBatch(c,null,o),roadOne:(c,id,o)=>dispatchExistingDistinctNetworkBatch(c,id,o),planning:()=>!!roadPlanning,rawQuery:p=>fleetDispatchQuery(state,'dispatchEligible',p,null),fleetQueryHolds:()=>typeof fleetQueryHolds==='number'?fleetQueryHolds:0}"});page.setDefaultTimeout(600000);
    await osrmDouble(page);
    await page.evaluate(async()=>{
      const a=__AUDIT__,s=()=>__GH_STATE__;s().godMoney=true;s().infiniteMoney=true;const d=GH_COMPANY_PLATFORM.definitionFor(s(),'road');
      await a.runAuthorizedDomainCommand('corporate','open-company',{type:'road',companyId:'road',capital:Math.max(100000000,d.founding.minimumCapital),legalName:'QA Road 704',formationContract:'QA-ROAD-704'},{silent:true});
      s().godMoney=true;s().infiniteMoney=true;const sites=GH_MOBILITY_CORE.CAPITALS.slice(0,2);
      for(const site of sites)await a.runAuthorizedDomainCommand('facilities','create',{facility:{id:`QA704-${site.id}`,sourceKey:`site:road:${site.id}`,capitalId:site.id,kind:'logistics',company:'road',ownerCompanyId:'road',owned:true,deliveryCapacity:1000000,name:`QA704 ${site.city}`,city:site.city,country:site.country,coords:[...site.coords],cost:8500000,dailyCost:12500,capacity:'1000000 trucks'},bucket:'customHubs'},{silent:true});
      const model=[...GH_ASSET_CATALOG.road.used].sort((x,y)=>x.leaseMonthly-y.leaseMonthly||x.price-y.price)[0];let bought=0,order=0;
      while(bought<2600){const qty=Math.min(1300,2600-bought),site=sites[order%sites.length];if(!await a.buyAsset('road','used',model.id,'lease',qty,`QA704-${site.id}`,true,`QA704-${order++}`,'road'))throw new Error('purchase fixture');bought+=qty;}
      // The automatic dispatch is left out (no mark): the presses are measured alone.
      if(s().advanced?.companies?.road)delete s().advanced.companies.road.autoDispatchPending;
      await a.whenStateIdle();await GH_PERSISTENCE.drain();});
    await page.evaluate(()=>__AUDIT__.openDrawer('routes','road'));const manual=page.locator('.build-road-route[data-company="road"]').first();await manual.waitFor({state:'visible'});
    await page.evaluate(()=>{const from=document.getElementById('roadFrom'),to=document.getElementById('roadTo');const first=from.options[0].value;from.value=first;to.value=[...to.options].find(row=>row.value!==first).value;});
    await manual.click();await page.waitForFunction(()=>__GH_STATE__.customRoutes.some(route=>(route.routeMode||route.type)==='road'),null,{timeout:120000});
    await page.waitForFunction(()=>!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked(),null,{timeout:120000});await page.evaluate(()=>__AUDIT__.closeDrawer());
    const idle=()=>page.evaluate(()=>{let n=0;GH_FLEET_DATA.scan(__GH_STATE__,['ownerCompanyId','companyId','routeId'],r=>{if((r.ownerCompanyId||r.companyId)==='road'&&!r.routeId)n++;});return n;});
    const before=await idle();assert.ok(before>=2500,`fixture: ${before} idle trucks`);
    // 1.
    const one=await page.evaluate(async()=>{const a=__AUDIT__,s=__GH_STATE__;window.__GH_MANUAL_CALENDAR_WINDOWS__=false;a.simulationEngine.advanceTo(s.simSeconds+3*86400,{speed:300,batchSeconds:3600,reason:'qa-704',maxSeconds:4*86400});
      let refused=0,press=null;for(let i=0;i<20000&&!press;i++){await new Promise(r=>setTimeout(r,2));try{await a.rawQuery({companyId:'road',type:'road',limit:1,includeModeRouteIds:true});}catch(error){if(/worker-not-ready/.test(String(error?.message))){refused++;press=a.roadBatch('road',{limit:500});}}}
      if(!press)return {refused,skipped:true};const commandsBefore=(GH_APP_RUNTIME_METRICS.snapshot().durable?.samples||[]).length,sim0=s.simSeconds;const out=await press;const sim1=s.simSeconds;
      await new Promise(r=>setTimeout(r,1500));return {refused,departed:out?.departed??null,result:out===false?false:typeof out,holds:a.fleetQueryHolds(),moved:s.simSeconds>sim1,sim0,sim1,committed:(GH_APP_RUNTIME_METRICS.snapshot().durable?.samples||[]).slice(-3).filter(t=>t.name==='authorized:bulk-shared-departure:road'&&t.committed).length};});
    assert.ok(!one.skipped,`1: the worker refused a live query during the advance (${JSON.stringify(one)})`);
    assert.equal(one.departed,500,`1: the press placed its trucks while the worker was refusing live queries (${JSON.stringify(one)})`);
    assert.ok(one.committed>=1,'1: in a committed road command');assert.equal(one.holds,0,'1: the hold is released');assert.equal(one.moved,true,`1: and the clock moves afterwards (${JSON.stringify(one)})`);
    await page.evaluate(async()=>{for(let i=0;i<60000&&(__AUDIT__.simulationEngine.snapshot().manualAdvance||window.__GH_DURABLE_COMMAND_CONTEXT__);i++)await new Promise(r=>setTimeout(r,5));await __AUDIT__.whenStateIdle();});
    assert.equal(await idle(),before-500,'1: exactly 500 trucks left');
    // 2.
    const two=await page.evaluate(async()=>{const a=__AUDIT__;let firstDone=false;const first=a.roadBatch('road',{limit:200});const reserved=a.planning();first.then(()=>{firstDone=true;});
      const y=await a.roadBatch('road',{limit:200}),secondWhileFirstPending=!firstDone;const x=await first;return {reserved,secondWhileFirstPending,x:x===false?false:x?.departed,y:y===false?false:y?.departed,holds:a.fleetQueryHolds(),planning:a.planning()};});
    assert.equal(two.reserved,true,`2: the first press reserves the planning before its query (${JSON.stringify(two)})`);
    assert.equal(two.y,false,'2: the second press is refused');assert.equal(two.secondWhileFirstPending,true,'2: refused while the first is still pending (not by the command lock after it)');
    assert.equal(two.x,200,`2: the first press departs (${JSON.stringify(two)})`);assert.equal(two.holds,0);assert.equal(two.planning,false,'2: released');
    await page.evaluate(()=>__AUDIT__.whenStateIdle());assert.equal(await idle(),before-700,'2: 200 more trucks left');
    // 2b. A truck already on a route: the query finds none (the automatic "none" return, then the manual one).
    const none=await page.evaluate(async()=>{const a=__AUDIT__;let busy=null;GH_FLEET_DATA.scan(__GH_STATE__,['id','ownerCompanyId','companyId','routeId'],r=>{if(!busy&&(r.ownerCompanyId||r.companyId)==='road'&&r.routeId)busy=r.id;});
      const auto=await a.roadOne('road',busy,{auto:true});const afterAuto=a.planning();const manual=await a.roadOne('road',busy,{});const afterManual=a.planning();const next=await a.roadBatch('road',{limit:100});await a.whenStateIdle();
      return {busy:!!busy,auto,afterAuto,manual,afterManual,next:next===false?false:next?.departed};});
    assert.ok(none.busy,'2b: fixture');assert.equal(none.auto?.none,true,`2b: the automatic query finds none (${JSON.stringify(none)})`);assert.equal(none.afterAuto,false,'2b: released after the automatic "none"');
    assert.equal(none.manual,false);assert.equal(none.afterManual,false,'2b: released after the manual "none"');assert.equal(none.next,100,`2b: the next press plans and departs (${JSON.stringify(none)})`);
    assert.equal(await idle(),before-800,'2b: 100 more trucks left');
    // 2d. A new game during the held query: the press stops and releases the planning; the next press plans.
    const reset=await page.evaluate(async()=>{const a=__AUDIT__,s=__GH_STATE__,epoch=s.resetEpoch;const press=a.roadBatch('road',{limit:50});const reserved=a.planning();s.resetEpoch=(Number(epoch)||0)+1000;const out=await press;const after=a.planning();s.resetEpoch=epoch;const next=await a.roadBatch('road',{limit:50});await a.whenStateIdle();return {reserved,out,after,next:next===false?false:next?.departed};});
    assert.equal(reset.reserved,true);assert.equal(reset.out,false,'2d: the press stops on a new game');assert.equal(reset.after,false,'2d: and releases the planning');assert.equal(reset.next,50,`2d: the next press plans (${JSON.stringify(reset)})`);
    assert.equal(await idle(),before-850,'2d: 50 more trucks left');
    // 2c. Presses during an advance: the clock never goes back.
    const jumps=await page.evaluate(async()=>{const a=__AUDIT__,s=__GH_STATE__;delete window.__GH_MANUAL_CALENDAR_WINDOWS__;a.simulationEngine.advanceTo(s.simSeconds+20*86400,{speed:300,batchSeconds:3600,reason:'qa-704c',maxSeconds:21*86400});
      const out=[];for(let press=0;press<3;press++){await new Promise(r=>setTimeout(r,300));for(let i=0;i<2000&&!a.simulationEngine.jobActive();i++)await new Promise(r=>setTimeout(r,1));const inFlight=a.simulationEngine.jobActive(),start=s.simSeconds;let min=start,sampling=true;const sample=()=>{if(!sampling)return;min=Math.min(min,s.simSeconds);requestAnimationFrame(sample);};requestAnimationFrame(sample);
        const result=await a.roadBatch('road',{limit:100});await new Promise(r=>setTimeout(r,400));sampling=false;min=Math.min(min,s.simSeconds);out.push({inFlight,start,min,end:s.simSeconds,departed:result===false?false:result?.departed});}
      a.simulationEngine.cancelAdvance?.('qa-704c',{immediate:true});for(let i=0;i<60000&&(a.simulationEngine.snapshot().manualAdvance||window.__GH_DURABLE_COMMAND_CONTEXT__);i++)await new Promise(r=>setTimeout(r,5));await a.whenStateIdle();return out;});
    for(const [i,row] of jumps.entries()){assert.equal(row.inFlight,true,`2c: press ${i+1} arrives with a step in flight (${JSON.stringify(row)})`);assert.ok(row.min>=row.start,`2c: press ${i+1}: the clock never went back (${JSON.stringify(row)})`);assert.ok(row.end>row.start,`2c: press ${i+1}: the clock moved (${JSON.stringify(row)})`);assert.equal(row.departed,100,`2c: press ${i+1} departed (${JSON.stringify(row)})`);}
    // 3. Source.
    {const app=fs.readFileSync(path.join(process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..'),'WebApp','app.js'),'utf8');
      assert.equal((app.match(/await heldFleetDispatchQuery\(state,'dispatchEligible'/g)||[]).length,3,'3: the probe, the re-probe and the road query hold the simulation');
      assert.ok(app.includes('||fleetQueryHolds>0||'),'3: a held query suspends the simulation');}
    assert.deepEqual(errors,[],'4: no error');
    console.log(JSON.stringify({suite:'build704-road-held-query-browser',ok:true,refused:one.refused,jumps}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
