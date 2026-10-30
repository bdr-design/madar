'use strict';
// Release edition without routing servers, in the real app (Chromium, the fleet engine worker, the road planner worker):
// a road company with two hubs and 80 trucks, then the release edition (GH_EDITION='release', as the iPhone and Android
// apps set it). Every request the page makes is recorded:
//  1. a manual road route is created from the real form, computed on the device: «تقدير محلي للطرق», from the start hub's
//     coordinates to the end hub's, distance = straight x 1.25, 65 km/h;
//  2. dispatching the fleet (more trucks than the manual route holds) plans new routes in the planner worker and every
//     truck departs or is scheduled, each new route carrying the local source; the state validates;
//  3. not one request leaves the page (no routing server, no other host) while the routes are made and the fleet leaves;
//  4. the development edition still asks the routing server (control: the rule is the release edition's).
const assert=require('node:assert/strict');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');
const TRUCKS=80,HUB_CAPACITY=40;
const km=(a,b)=>{const r=Math.PI/180,h=Math.sin((b[0]-a[0])*r/2)**2+Math.cos(a[0]*r)*Math.cos(b[0]*r)*Math.sin((b[1]-a[1])*r/2)**2;return 12742*Math.asin(Math.min(1,Math.sqrt(h)));};
(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    const {page}=await boot({browser,errors,viewport:{width:844,height:390},bypassCSP:true});page.setDefaultTimeout(300000);
    const outside=[];let recording=false;
    page.on('request',request=>{const url=request.url();if(!/^(https?:\/\/(127\.0\.0\.1|localhost)[:/]|data:|blob:|about:)/.test(url)&&recording)outside.push(url);});
    page.context().on('request',request=>{const url=request.url();if(!/^(https?:\/\/(127\.0\.0\.1|localhost)[:/]|data:|blob:|about:)/.test(url)&&recording)outside.push(url);});
    await page.route(/https:\/\/router\.project-osrm\.org\//,route=>route.abort());
    const setup=await page.evaluate(async({trucks,hubCapacity})=>{
      const a=__AUDIT__,s=()=>__GH_STATE__;s().godMoney=true;s().infiniteMoney=true;
      const d=GH_COMPANY_PLATFORM.definitionFor(s(),'road');
      await a.runAuthorizedDomainCommand('corporate','open-company',{type:'road',companyId:'road',capital:Math.max(100000000,d.founding.minimumCapital),legalName:'QA Road',formationContract:'QA-ROAD-OFFLINE'},{silent:true});
      const sites=GH_MOBILITY_CORE.CAPITALS.slice(0,Math.ceil(trucks/hubCapacity));
      for(const site of sites)await a.runAuthorizedDomainCommand('facilities','create',{facility:{id:`QA-ROAD-${site.id}`,sourceKey:`site:road:${site.id}`,capitalId:site.id,kind:'logistics',company:'road',ownerCompanyId:'road',owned:true,deliveryCapacity:hubCapacity,name:`QA Logistics ${site.city}`,city:site.city,country:site.country,coords:[...site.coords],cost:8500000,dailyCost:12500,capacity:`${hubCapacity}`,level:1}},{silent:true});
      const model=[...GH_ASSET_CATALOG.road.used].sort((x,y)=>x.leaseMonthly-y.leaseMonthly||x.price-y.price)[0];let bought=0,order=0;
      for(const site of sites){const qty=Math.min(hubCapacity,trucks-bought);if(qty<=0)break;if(!await a.buyAsset('road','used',model.id,'lease',qty,`QA-ROAD-${site.id}`,true,`QA-ROAD-OFF-${order++}`,'road'))return {error:'purchase',bought};bought+=qty;}
      await GH_PERSISTENCE.drain();
      return {bought,size:GH_FLEET_DATA.size(s()),sites:sites.map(site=>({id:`QA-ROAD-${site.id}`,coords:[...site.coords]}))};
    },{trucks:TRUCKS,hubCapacity:HUB_CAPACITY});
    assert.equal(setup.error,undefined,JSON.stringify(setup));assert.equal(setup.size,TRUCKS);
    // The release edition from here on.
    await page.evaluate(()=>{window.GH_EDITION='release';});recording=true;
    assert.equal(await page.evaluate(()=>GH_MAP_PROVIDER.offline()),true);
    // 1. The manual route, from the real form.
    await page.evaluate(()=>__AUDIT__.openDrawer('routes','road'));
    const manual=page.locator('.build-road-route[data-company="road"]').first();await manual.waitFor({state:'visible'});
    const picked=await page.evaluate(()=>{const from=document.getElementById('roadFrom'),to=document.getElementById('roadTo');const first=from.options[0].value;from.value=first;to.value=[...to.options].find(row=>row.value!==first).value;return {from:from.value,to:to.value};});
    await manual.click();
    await page.waitForFunction(()=>__GH_STATE__.customRoutes.some(route=>(route.routeMode||route.type)==='road'),null,{timeout:120000});
    await page.waitForFunction(()=>!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked(),null,{timeout:120000});
    const route=await page.evaluate(()=>JSON.parse(JSON.stringify(__GH_STATE__.customRoutes.find(route=>(route.routeMode||route.type)==='road'))));
    const from=setup.sites.find(site=>site.id===picked.from).coords,to=setup.sites.find(site=>site.id===picked.to).coords,straight=km(from,to);
    assert.equal(route.routingSource,'تقدير محلي للطرق','1: the route is computed on the device');
    assert.equal(JSON.stringify(route.route[0]),JSON.stringify(from),'1: from the start hub');assert.equal(JSON.stringify(route.route.at(-1)),JSON.stringify(to),'1: to the end hub');
    assert.ok(Math.abs(route.roadNetworkDistanceKm-straight*1.25)<1e-6,`1: distance = straight x 1.25 (${route.roadNetworkDistanceKm}, ${straight})`);
    assert.ok(Math.abs(route.effectiveSpeedKmh-65)<1e-9,'1: 65 km/h');
    // 2. The fleet leaves.
    await page.evaluate(()=>{__AUDIT__.closeDrawer();__AUDIT__.openDrawer('routes','road');});
    const button=page.locator('.dispatch-existing-network[data-company="road"]').first();await button.waitFor({state:'visible'});await button.click();
    await page.waitForFunction(()=>/bulk-shared-departure:road/.test(GH_APP_RUNTIME_METRICS.snapshot().durable?.last?.name||''),null,{timeout:300000,polling:200});
    await page.waitForFunction(()=>!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked(),null,{timeout:120000});
    const out=await page.evaluate(()=>{const s=__GH_STATE__,phases={};let routed=0;
      GH_FLEET_DATA.forEach(s,asset=>{if((asset.ownerCompanyId||asset.companyId)!=='road')return;const key=asset.phase+(asset.departureScheduled?'+scheduled':'');phases[key]=(phases[key]||0)+1;if(asset.routeId)routed++;});
      const roads=s.customRoutes.filter(route=>(route.routeMode||route.type)==='road');
      return {phases,routed,roads:roads.length,sources:[...new Set(roads.map(route=>route.routingSource))],schema:GH_SAVE_SCHEMA.validate(s).ok};});
    assert.equal(out.routed,TRUCKS,`2: every truck has a route (${JSON.stringify(out)})`);
    assert.equal((out.phases.moving||0)+(out.phases['turnaround+scheduled']||0)+(out.phases['idle+scheduled']||0),TRUCKS,`2: every truck departed or is scheduled: ${JSON.stringify(out.phases)}`);
    assert.ok(out.roads>=2,`2: the planner made new routes (${out.roads})`);
    assert.ok(out.sources.every(source=>/^تقدير محلي للطرق( · وجهة نقل تلقائية)?$/.test(source)),`2: every road route is local: ${out.sources}`);
    assert.equal(out.schema,true,'2: the state validates');
    // 3.
    recording=false;assert.deepEqual(outside,[],'3: no request left the page in the release edition');
    // 4. Control: the development edition asks the routing server.
    const osrm=[];page.on('request',request=>{if(/router\.project-osrm\.org/.test(request.url()))osrm.push(request.url());});
    await page.evaluate(async()=>{delete window.GH_EDITION;await GH_MAP_PROVIDER.road([24.7136,46.6753],[21.4858,39.1925]);});
    assert.ok(osrm.length>=1,'4: the development edition still asks the routing server');
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({suite:'build643-release-roads-offline-browser',ok:true,roads:out.roads,phases:out.phases}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
