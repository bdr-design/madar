'use strict';
// Build 709, batch H (owner, 18 Nov 2026: «يُحذف كما عند الوصول»; dispatch marked after a service only). The real app
// (local DOM, fleet worker), 2,100 aircraft (above the 2,048 rows the main thread may scan):
//   1. servicing an asset isolated while moving, bound to leave a retired route that one other aircraft still uses: the
//      service runs (charged, fault cleared) and the route is kept;
//   2. with no other aircraft on it, the route is deleted in the same command (the worker's reference count bound to the
//      command, the game held from the answer to the commit), and the owner is marked for the automatic dispatch;
//   3. a return to base frees and deletes such a route too, and marks nothing (the asset keeps its fault);
//   4. the clock is held while the proof is taken and the command runs (simSeconds does not move), then runs again;
//   5. no error is logged.
const assert=require('node:assert/strict'),{chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');
(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    const {page}=await boot({browser,errors,fleetWorker:true,appAudit:"{serviceAsset,returnAssetToBase,purchaseHolds:()=>assetPurchaseHolds}"});page.setDefaultTimeout(120000);
    await page.evaluate(async()=>{
      const a=__AUDIT__,s=__GH_STATE__,d=GH_COMPANY_PLATFORM.definitionFor(s,'air');s.speed=0;s.godMoney=true;s.infiniteMoney=true;
      await a.runAuthorizedDomainCommand('corporate','open-company',{type:'air',companyId:'air',capital:Math.max(2e9,d.founding.minimumCapital),legalName:'QA Air 709',formationContract:'QA-AIR-709'},{silent:true});
      const port=GH_WORLD_DATA.airports.find(row=>row[0]==='OERK'),names=new Intl.DisplayNames(['ar'],{type:'region'});
      await a.runAuthorizedDomainCommand('facilities','create',{facility:{id:'QA709-OERK',name:'QA 709',kind:'airport-base',company:'air',ownerCompanyId:'air',owned:true,sourceKey:'air:OERK',code:port[1]||port[0],icao:port[0],iata:port[1],city:port[3]||port[4]||'—',country:names.of(port[5]),coords:[port[6],port[7]]},bucket:'globalBases'},{silent:true});
      const model=GH_ASSET_CATALOG.air.used.filter(row=>Number(row.specs?.rangeKm)>=4000).sort((x,y)=>x.price-y.price)[0];
      let bought=0;while(bought<2100){const n=Math.min(1050,2100-bought);if(!await a.buyAsset('air','used',model.id,'lease',n,'QA709-OERK',true,`QA709-BUY-${bought}`,'air'))throw new Error('purchase fixture');bought+=n;}
      await a.whenStateIdle();
      for(const id of ['QA709-R1','QA709-R2','QA709-R3'])await a.runAuthorizedDomainCommand('routes','create',{route:{id,ownerCompanyId:'air',routeMode:'air',name:id,fromFacility:'QA709-OERK',toFacility:`${id}-END`,from:'QA 709',to:id,route:[[24.71,46.67],[25.2+Number(id.slice(-1))/10,55.27]],distanceKm:900,tripSeconds:5400,dwellHours:2}},{silent:true});
      delete s.godMoney;delete s.infiniteMoney;GH_FINANCE_CORE.book(s,'air').accounts[0].balance=5e9;
      // The fixture writes the live fleet directly (the game paused): three isolated aircraft bound to leave retired routes;
      // one more aircraft parked on R1.
      const list=[];GH_FLEET_DATA.scan(s,['id','ownerCompanyId'],row=>{if(row.ownerCompanyId==='air')list.push(row.id);});
      const isolated={phase:'moving',releaseExclusiveRouteOnArrival:true,simulationFault:{code:'QA_709',detail:'qa'},condition:100};
      GH_FLEET_DATA.update(s,list[0],{...isolated,routeId:'QA709-R1'});GH_FLEET_DATA.update(s,list[1],{routeId:'QA709-R1',phase:'turnaround'});
      GH_FLEET_DATA.update(s,list[2],{...isolated,routeId:'QA709-R2'});GH_FLEET_DATA.update(s,list[3],{...isolated,routeId:'QA709-R3'});
      delete s.advanced?.companies?.air?.autoDispatchPending;
      window.__QA709__={ids:list.slice(0,4)};await a.whenStateIdle();await GH_PERSISTENCE.drain();});
    const ids=await page.evaluate(()=>window.__QA709__.ids);assert.equal(await page.evaluate(()=>GH_FLEET_DATA.size(__GH_STATE__)),2100,'fixture: 2,100 aircraft');
    const routes=()=>page.evaluate(()=>(__GH_STATE__.customRoutes||[]).map(row=>row.id).filter(id=>id.startsWith('QA709-')).sort());
    const marked=()=>page.evaluate(()=>__GH_STATE__.advanced?.companies?.air?.autoDispatchPending===true);
    const accept=async()=>{await page.locator('[data-confirm="accept"]:not([disabled])').click();await page.waitForFunction(()=>!document.querySelector('[data-confirm="accept"]'));};
    assert.deepEqual(await routes(),['QA709-R1','QA709-R2','QA709-R3']);
    // 4. The clock runs while nothing is pressed; it stands still from the proof to the commit.
    await page.evaluate(()=>{window.__T709__={moves:0,heldMoves:0,last:__GH_STATE__.simSeconds,timer:setInterval(()=>{const now=__GH_STATE__.simSeconds;if(now!==window.__T709__.last){window.__T709__.last=now;window.__T709__.moves++;if(__AUDIT__.purchaseHolds()>0)window.__T709__.heldMoves++;}},2)};__GH_STATE__.speed=1;});
    // 1. Another aircraft still on R1: kept, the service runs.
    {const before=await page.evaluate(()=>GH_FINANCE_CORE.operating(__GH_STATE__,'air'));const done=page.evaluate(id=>__AUDIT__.serviceAsset(id),ids[0]);await page.waitForSelector('[data-confirm="accept"]');await accept();assert.equal(await done,true,'1: serviced');
      const row=await page.evaluate(id=>{const a=GH_FLEET_DATA.get(__GH_STATE__,id);return {fault:!!a.simulationFault,route:a.routeId??null,moving:a.phase==='moving'};},ids[0]);
      assert.deepEqual(row,{fault:false,route:null,moving:false},'1: back at its base, fault cleared, off the route');assert.deepEqual(await routes(),['QA709-R1','QA709-R2','QA709-R3'],'1: R1 kept (another aircraft uses it)');assert.equal(await marked(),true,'1: the owner marked after a service');
      assert.equal(await page.evaluate(()=>GH_FINANCE_CORE.operating(__GH_STATE__,'air')),before,'1: at 100% it charges nothing');}
    // 2. No other aircraft on R2: deleted by the service. (The game is held where the proof is taken and where the command
    //    checks it: both observed through the reference-query module the app and fleet-core read.)
    await page.evaluate(()=>{delete __GH_STATE__.advanced.companies.air.autoDispatchPending;const Q=window.GH_FLEET_REFERENCE_QUERY;window.__Q709__=Q;window.__H709__=[];window.GH_FLEET_REFERENCE_QUERY=Object.freeze({...Q,capture:(...args)=>{window.__H709__.push(['capture',__AUDIT__.purchaseHolds()]);return Q.capture(...args);},current:(...args)=>{window.__H709__.push(['current',__AUDIT__.purchaseHolds()]);return Q.current(...args);}});});
    {const done=page.evaluate(id=>__AUDIT__.serviceAsset(id),ids[2]);await page.waitForSelector('[data-confirm="accept"]');await accept();assert.equal(await done,true,'2: serviced');
      assert.deepEqual(await routes(),['QA709-R1','QA709-R3'],'2: R2 deleted in the same command (the worker counted no other user)');assert.equal(await marked(),true,'2: the owner marked');
      const held=await page.evaluate(()=>{window.GH_FLEET_REFERENCE_QUERY=window.__Q709__;return window.__H709__;});
      assert.ok(held.some(([kind])=>kind==='capture')&&held.some(([kind])=>kind==='current'),`4: the proof was taken and checked (${JSON.stringify(held)})`);assert.ok(held.every(([,holds])=>holds>0),`4: the game was held at both (${JSON.stringify(held)})`);}
    // 3. A return to base frees R3, deletes it, marks nothing.
    await page.evaluate(()=>{delete __GH_STATE__.advanced.companies.air.autoDispatchPending;});
    {assert.equal(await page.evaluate(id=>__AUDIT__.returnAssetToBase(id),ids[3]),true,'3: returned');assert.deepEqual(await routes(),['QA709-R1'],'3: R3 deleted');assert.equal(await marked(),false,'3: a return to base marks nothing');
      assert.equal(await page.evaluate(id=>!!GH_FLEET_DATA.get(__GH_STATE__,id).simulationFault,ids[3]),true,'3: the fault stays');}
    {await page.waitForFunction(()=>window.__T709__.moves>0,null,{timeout:20000}).catch(()=>{throw new Error('4: the clock never ran');});const t=await page.evaluate(()=>{clearInterval(window.__T709__.timer);__GH_STATE__.speed=0;return window.__T709__;});assert.equal(t.heldMoves,0,`4: the clock stood still while held (${JSON.stringify(t)})`);}
    await page.evaluate(()=>__AUDIT__.whenStateIdle());
    assert.deepEqual(errors,[],'5: no error');
    console.log(JSON.stringify({suite:'build709-retired-route-browser',ok:true}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
