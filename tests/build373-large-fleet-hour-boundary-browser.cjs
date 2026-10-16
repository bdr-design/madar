'use strict';
// Build 373 regression: Save Schema requires the worker's fleet evidence for a fleet above the main-thread limit (2,048
// rows), and fails closed without it. Nothing supplied it (GH_FLEET_VALIDATION_PROVIDER was never set by the app), so
// the integrity check of the first hour boundary failed with fleet-validation-unavailable and the engine stopped at
// 00:59 (simSeconds 3570) in a fatal state: an iPhone diagnostic with 300,000 assets and this test with 3,000 both did.
// Here 3,000 aircraft (above the limit, inside the browser's 6,000 save limit) cross two hour boundaries on the real
// fleet engine worker with no open incident, and the provider answers from the worker.
const assert=require('node:assert/strict');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');
const QTY=3000;

(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    const {page}=await boot({browser,errors,fleetWorker:true});page.setDefaultTimeout(0);
    const setup=await page.evaluate(async qty=>{
      const a=__AUDIT__,s=()=>__GH_STATE__,type='air';
      await a.runAuthorizedDomainCommand('corporate','open-company',{type,companyId:type,capital:900000000,legalName:'QA Hour Boundary',formationContract:'QA-HOUR-BOUNDARY'},{silent:true});
      s().godMoney=true;s().infiniteMoney=true;
      const r=GH_WORLD_DATA.airports.find(x=>x[0]==='OMDB');
      await a.runAuthorizedDomainCommand('facilities','create',{facility:{id:'QA-OMDB',name:'QA OMDB',kind:'airport-base',company:type,ownerCompanyId:type,owned:true,sourceKey:'air:OMDB',code:r[1]||'OMDB',icao:'OMDB',iata:r[1],city:r[3]||'—',country:String(r[5]||'—'),coords:[r[6],r[7]]},bucket:'globalBases'},{silent:true});
      const model=GH_ASSET_CATALOG.air.used[0];
      const orderId=await a.buyAsset(type,'used',model.id,'lease',qty,'QA-OMDB',true,'QA-HOUR-BOUNDARY',type);
      return {orderId,fleet:GH_FLEET_DATA.size(s()),limit:GH_FLEET_MAIN_THREAD_POLICY.DEFAULT_ROW_LIMIT,provider:typeof globalThis.GH_FLEET_VALIDATION_PROVIDER};
    },QTY);
    assert.ok(setup.orderId,'purchase');assert.equal(setup.fleet,QTY);assert.ok(setup.fleet>setup.limit,'the fleet is above the main-thread limit');assert.equal(setup.provider,'function','the app supplies the worker fleet validation');
    await page.evaluate(()=>__AUDIT__.setSpeed(3));
    const target=7260,started=Date.now();let last=null;
    while(Date.now()-started<240000){
      last=await page.evaluate(()=>{const s=__GH_STATE__;return {sim:s.simSeconds,speed:s.speed,incidents:(s.controlPlane?.incidents||[]).filter(row=>row.status==='open').map(row=>`${row.code}: ${String(row.detail||'').slice(0,160)}`),queries:__AUDIT__.fleetEngineThreadClient()?.stats?.()?.queryRequests||0};});
      if(last.sim>=target||last.incidents.length)break;
      await page.waitForTimeout(500);
    }
    await page.evaluate(()=>__AUDIT__.setSpeed(0));
    assert.deepEqual(last.incidents,[],`no incident while crossing the hour boundaries: ${JSON.stringify(last)}`);
    assert.ok(last.sim>=target,`time crossed two hour boundaries: ${JSON.stringify(last)}`);
    assert.ok(last.queries>0,'the worker answered fleet queries');
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({suite:'build373-large-fleet-hour-boundary-browser',assets:QTY,simSeconds:last.sim,workerQueries:last.queries}));
    console.log('BUILD373_LARGE_FLEET_HOUR_BOUNDARY_PASS');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
