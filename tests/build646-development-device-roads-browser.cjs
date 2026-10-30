'use strict';
// Development edition (owner: «موضوع الخادم عشان نعرف اذا فيه مشكلة»): a development build can compute new road routes
// on the device, as the store edition does, from a setting kept on the device, to find a problem in them before release.
// In the real app (Chromium, the fleet engine worker, the road planner worker), a road company with two hubs and 80
// trucks; every request the page makes is recorded:
//  1. the settings card «مصدر مسارات الطرق (نسخة التطوير)» reads «الخادم»; its button switches it to «على الجهاز», kept on
//     the device (not in the save);
//  2. then a manual road route from the real form and the fleet's dispatch (new routes in the planner worker) are computed
//     on the device: «تقدير محلي للطرق», distance = straight x 1.25, 65 km/h; every truck departs or is scheduled, the
//     state validates, and not one request leaves the page;
//  3. after a reload the choice is kept; switched back, the development edition asks the routing server again;
//  4. the store edition has no such card and refuses the choice (its routes are always computed on the device);
//  5. the road planner worker itself (road-planner-worker.js with its importScripts, as the iPhone runs it; the test page
//     cannot load it and plans on the main thread): the message that carries the choice plans new routes on the device
//     with no request; a message without it asks the server.
const assert=require('node:assert/strict');
const {chromium}=require('playwright'),{boot,reboot}=require('./helpers/local-dom-app');
const TRUCKS=80,HUB_CAPACITY=40,fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const WEB=path.join(process.env.GH_TEST_SOURCE_DIR||process.env.GH_AUDIT_ROOT||path.resolve(__dirname,'..'),'WebApp');
// The real worker file in a worker-like sandbox: importScripts reads WebApp, every fetch is recorded and refused.
function workerSandbox(){
  const requests=[],posted=[],listeners=[];const self={console,setTimeout,clearTimeout,AbortController,Date,Math,JSON,structuredClone,
    fetch:url=>{requests.push(String(url));return Promise.reject(new Error('network-blocked-in-test'));},
    postMessage:message=>posted.push(message),addEventListener:(type,fn)=>{if(type==='message')listeners.push(fn);}};
  self.self=self;self.globalThis=self;self.importScripts=(...files)=>{for(const file of files)vm.runInContext(fs.readFileSync(path.join(WEB,file),'utf8'),self,{filename:file});};
  vm.createContext(self);vm.runInContext(fs.readFileSync(path.join(WEB,'road-planner-worker.js'),'utf8'),self,{filename:'road-planner-worker.js'});
  const send=async message=>{const before=posted.length;for(const fn of listeners)fn({data:message});for(let i=0;i<2000&&!posted.slice(before).some(row=>row.type==='result'||row.type==='error');i++)await new Promise(done=>setImmediate(done));return posted.slice(before).find(row=>row.type==='result'||row.type==='error');};
  return {send,requests};
}
async function workerClaims(){
  const origin={id:'O1',name:'Hub RUH',city:'Riyadh',country:'Saudi Arabia',company:'road',coords:[24.7136,46.6753]};
  const assets=Array.from({length:24},(_,i)=>({id:`T-${String(i).padStart(3,'0')}`,name:`Truck ${i}`,type:'road',assetMode:'road',ownerCompanyId:'road',baseFacility:'O1',specs:{rangeKm:900},staffing:{mode:'automatic-fixed',ready:true}}));
  const input={assets,routes:[],origins:assets.map(()=>origin),assetOwners:assets.map(()=>'road'),routeOwners:[],facilities:[{id:'O1'}],initialLoads:{},routeCount:0,seed:7,targetRouteLoad:12,routeCapacity:12,baseRouteCapacity:12,yieldEvery:512,intervalMs:0};
  const local=workerSandbox(),done=await local.send({type:'plan',requestId:1,input,edition:'',localRoads:true});
  assert.equal(done?.type,'result',`5: the worker plans (${JSON.stringify(done)?.slice(0,200)})`);assert.equal(done.plan.length,24,'5: every truck has a route');
  const made=done.plan.filter(row=>row.created).map(row=>row.route);assert.ok(made.length>=2,'5: new routes were made');
  assert.ok(made.every(route=>/^تقدير محلي للطرق/.test(route.routingSource)),'5: computed on the device');assert.deepEqual(local.requests,[],'5: no request from the worker');
  const server=workerSandbox();await server.send({type:'plan',requestId:2,input,edition:''});
  assert.ok(server.requests.length>=1&&server.requests.every(url=>/^https:\/\/router\.project-osrm\.org\//.test(url)),'5: without the choice the worker asks the server');
  // The page sends the choice with every plan request (app.js, the message the worker reads above).
  const app=fs.readFileSync(path.join(WEB,'app.js'),'utf8');assert.match(app,/worker\.postMessage\(\{type:'plan',requestId,input,edition:window\.GH_EDITION==='release'\?'release':'',localRoads:window\.GH_LOCAL_ROADS===true\}\)/,'5: the page passes the choice to the worker');
  return made.length;
}
const km=(a,b)=>{const r=Math.PI/180,h=Math.sin((b[0]-a[0])*r/2)**2+Math.cos(a[0]*r)*Math.cos(b[0]*r)*Math.sin((b[1]-a[1])*r/2)**2;return 12742*Math.asin(Math.min(1,Math.sqrt(h)));};
(async()=>{
  const workerRoutes=await workerClaims();
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    let {page}=await boot({browser,errors,viewport:{width:844,height:390},bypassCSP:true});page.setDefaultTimeout(300000);
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
    // 1. The development edition's setting, from its card.
    assert.equal(await page.evaluate(()=>[window.GH_EDITION||'',GH_MAP_PROVIDER.offline()].join('|')),'|false','the development edition asks the server by default');
    await page.evaluate(()=>__AUDIT__.openDrawer('settings'));const card=page.locator('#drawerBody .road-source-card');
    assert.match(await card.textContent(),/الخادم/);await card.locator('[data-gh-action="road-source-toggle"]').click();
    await page.waitForFunction(()=>document.querySelector('#drawerBody .road-source-card .tag')?.textContent==='على الجهاز');
    assert.deepEqual(await page.evaluate(()=>({local:window.GH_LOCAL_ROADS,offline:GH_MAP_PROVIDER.offline(),kept:localStorage.getItem('gh-road-source'),edition:window.GH_EDITION||''})),{local:true,offline:true,kept:'device',edition:''},'1: switched to the device, kept on the device');
    await page.evaluate(()=>__AUDIT__.closeDrawer());recording=true;
    // 2. The manual route, from the real form.
    await page.evaluate(()=>__AUDIT__.openDrawer('routes','road'));
    const manual=page.locator('.build-road-route[data-company="road"]').first();await manual.waitFor({state:'visible'});
    const picked=await page.evaluate(()=>{const from=document.getElementById('roadFrom'),to=document.getElementById('roadTo');const first=from.options[0].value;from.value=first;to.value=[...to.options].find(row=>row.value!==first).value;return {from:from.value,to:to.value};});
    await manual.click();
    await page.waitForFunction(()=>__GH_STATE__.customRoutes.some(route=>(route.routeMode||route.type)==='road'),null,{timeout:120000});
    await page.waitForFunction(()=>!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked(),null,{timeout:120000});
    const route=await page.evaluate(()=>JSON.parse(JSON.stringify(__GH_STATE__.customRoutes.find(route=>(route.routeMode||route.type)==='road'))));
    const from=setup.sites.find(site=>site.id===picked.from).coords,to=setup.sites.find(site=>site.id===picked.to).coords,straight=km(from,to);
    assert.equal(route.routingSource,'تقدير محلي للطرق','2: the route is computed on the device');
    assert.equal(JSON.stringify(route.route[0]),JSON.stringify(from),'2: from the start hub');assert.equal(JSON.stringify(route.route.at(-1)),JSON.stringify(to),'2: to the end hub');
    assert.ok(Math.abs(route.roadNetworkDistanceKm-straight*1.25)<1e-6,`2: distance = straight x 1.25 (${route.roadNetworkDistanceKm}, ${straight})`);
    assert.ok(Math.abs(route.effectiveSpeedKmh-65)<1e-9,'2: 65 km/h');
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
    recording=false;assert.deepEqual(outside,[],'2: no request left the page with the device chosen');
    // 3. Kept after a reload; switched back, the server is asked again.
    ({page}=await reboot(page,{errors,viewport:{width:844,height:390},bypassCSP:true}));page.setDefaultTimeout(300000);
    assert.equal(await page.evaluate(()=>window.GH_LOCAL_ROADS===true&&GH_MAP_PROVIDER.offline()===true),true,'3: the choice is kept after a reload');
    await page.route(/https:\/\/router\.project-osrm\.org\//,route=>route.abort());
    const osrm=[];page.on('request',request=>{if(/router\.project-osrm\.org/.test(request.url()))osrm.push(request.url());});
    await page.evaluate(()=>__AUDIT__.openDrawer('settings'));await page.locator('#drawerBody .road-source-card [data-gh-action="road-source-toggle"]').click();
    await page.waitForFunction(()=>document.querySelector('#drawerBody .road-source-card .tag')?.textContent==='الخادم');
    assert.equal(await page.evaluate(()=>localStorage.getItem('gh-road-source')),null,'3: switching back forgets the choice');
    await page.evaluate(async()=>{await GH_MAP_PROVIDER.road([24.7136,46.6753],[21.4858,39.1925]);});
    assert.ok(osrm.length>=1,'3: switched back, the development edition asks the routing server');
    // 4. The store edition: no card, the choice refused.
    await page.evaluate(()=>{window.GH_EDITION='release';__AUDIT__.openDrawer('settings');});
    assert.equal(await page.locator('#drawerBody .road-source-card').count(),0,'4: no card in the store edition');
    assert.equal(await page.evaluate(()=>GH_ROAD_SOURCE.set(false)),false,'4: the store edition refuses the choice');assert.equal(await page.evaluate(()=>GH_MAP_PROVIDER.offline()),true,'4: its routes stay on the device');
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({suite:'build646-development-device-roads-browser',ok:true,roads:out.roads,phases:out.phases,workerRoutes}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
