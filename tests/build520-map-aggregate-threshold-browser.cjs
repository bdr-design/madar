'use strict';
// Owner decision (emulated phone, 4x CPU, median structural map render): one view per asset cost 41 ms at 2,000 assets,
// 93 ms at 5,000 and 234 ms at 20,000 (the 250-770 ms play freezes of mid-size fleets), while the class path stayed at
// 19-36 ms. The map now draws from classes above 1,000 assets. Proven with the real app and fleet worker at 1,200
// moving and parked assets:
//  1. after the fleet's membership changes (a purchase), a structural render never lists the fleet (no view per asset);
//  2. the map still draws the player's vehicles and parked counts, at most one vehicle per owner, base and route;
//  3. the render changes no game state;
//  4. the threshold is 1,000.
// GH_MAP_ENGINE=chromium runs Chromium only (WebKit is not installed everywhere).
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{chromium,webkit}=require('playwright');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {bootRenderApp}=require('./helpers/render-app.cjs'),{installVault}=require('./helpers/differential-vault-fixture.cjs'),{prepare}=require('./helpers/request-decisions-fixture.cjs');
assert.match(fs.readFileSync(path.join(ROOT,'WebApp/app.js'),'utf8'),/const MAP_AGGREGATE_ASSETS=1000;/,'the map draws from classes above 1,000 assets');
(async()=>{const results=[];for(const engine of process.env.GH_MAP_ENGINE==='chromium'?[chromium]:[chromium,webkit]){const browser=await engine.launch({headless:true}),errors=[];let env;try{
  env=await bootRenderApp({browser,root:ROOT,errors,beforeScripts:{fn:installVault}});const page=env.page;page.setDefaultTimeout(240000);
  const world=await prepare(page,{rows:1200});assert.equal(world.rows,1200);
  await page.evaluate(()=>__AUDIT__.dispatchSharedInternationalNetwork('air'));
  // Play 2.5 s, and on until a committed slice has some dispatched aircraft moving while others stay parked, then pause:
  // 2.5 s alone left the first slice about 1.5 s to commit after its second of backlog.
  await page.evaluate(()=>__AUDIT__.setSpeed(3));await page.waitForTimeout(2500);
  await page.waitForFunction(()=>{const s=__GH_STATE__,F=GH_FLEET_DATA;if(GH_TRANSACTION_CORE.isStaged(s))return false;let moving=0,parked=0;F.scan(s,['phase','routeId','simulationFault'],a=>{F.presentedPhase(s,a)==='moving'?moving++:parked++;});return moving>0&&parked>0;},null,{polling:100});
  await page.evaluate(()=>__AUDIT__.setSpeed(0));await page.evaluate(()=>__AUDIT__.whenStateIdle());
  // The class summary comes from the fleet worker; the first render may ask for it and draw once it arrives.
  await page.evaluate(()=>__AUDIT__.renderMap());
  await page.waitForFunction(()=>__AUDIT__.mapMetrics().ownMarkers>0,null,{timeout:60000});
  // A purchase changes the fleet's membership, so a view per asset would list the fleet again on the next render.
  await page.evaluate(async()=>{const model=GH_ASSET_CATALOG.air.used.filter(m=>!m.specs.cargo&&Number(m.specs.rangeKm)>=6000).sort((a,b)=>a.price-b.price)[0];if(!await __AUDIT__.buyAsset('air','used',model.id,'lease',1,'QA-DEC-OMDB',true,'QA-MAP-THRESHOLD','air'))throw Error('purchase-failed');});
  await page.evaluate(()=>__AUDIT__.whenStateIdle());
  const out=await page.evaluate(()=>{
   const fleet=window.GH_FLEET_DATA,s=__GH_STATE__,before=JSON.stringify({revision:s.saveRevision,cash:s.cash,simSeconds:s.simSeconds,fleetRevision:s.fleet?.revision});let lists=0;
   window.GH_FLEET_DATA={...fleet,list(...args){lists++;return fleet.list(...args);}};
   try{__AUDIT__.renderMap();__AUDIT__.renderMap();}finally{window.GH_FLEET_DATA=fleet;}
   const combos=new Set();let moving=0,parked=0;
   fleet.scan(s,['ownerCompanyId','companyId','baseFacility','routeId','phase'],a=>{if(fleet.presentedPhase(s,a)==='moving'){moving++;if(a.routeId)combos.add(`${a.ownerCompanyId||a.companyId}:${a.baseFacility||'no-base'}:${a.routeId}`);}else parked++;});
   const m=__AUDIT__.mapMetrics();
   return {lists,own:m.ownMarkers,combos:combos.size,moving,parked,unchanged:before===JSON.stringify({revision:s.saveRevision,cash:s.cash,simSeconds:s.simSeconds,fleetRevision:s.fleet?.revision})};
  });
  assert.equal(out.lists,0,'1. a structural render above 1,000 assets never lists the fleet');
  assert.ok(out.moving>0&&out.parked>0,`the fixture has moving and parked assets (${out.moving}/${out.parked})`);
  assert.ok(out.own>0&&out.own<=out.combos+1,`2. vehicles drawn (${out.own}), at most one per owner, base and route (${out.combos}) plus a selection`);
  assert.equal(out.unchanged,true,'3. the render changes no game state');
  assert.deepEqual(errors,[],'no page errors');results.push({engine:engine.name(),...out});
 }finally{await browser.close();await env?.closeOrigin?.();}}
 console.log(JSON.stringify({suite:'build520-map-aggregate-threshold-browser',ok:true,results}));
})().catch(error=>{console.error(error);process.exit(1);});
