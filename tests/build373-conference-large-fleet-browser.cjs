'use strict';
// Build 373 regression: the annual conference (preview and start) needs a fleet summary that is exact for the state.
// conference-core and advanced-core asked ctx for fleetUiSummary / requireFleetUiSummary, which the app never supplied,
// so above the conference's local limit every open failed with conference-fleet-summary-required (11 times in an iPhone
// diagnostic with 300,000 assets). A font that fails to load also failed the whole stage. Here 3,000 aircraft (above the
// local limit) open the conference stage, which presents with no failure.
const assert=require('node:assert/strict');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');
const QTY=3000;

(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    const {page}=await boot({browser,errors,fleetWorker:true});page.setDefaultTimeout(60000);
    const setup=await page.evaluate(async qty=>{
      const a=__AUDIT__,s=()=>__GH_STATE__,type='air';s().godMoney=true;s().infiniteMoney=true;
      await a.runAuthorizedDomainCommand('corporate','open-company',{type,companyId:type,capital:900000000,legalName:'QA Conference',formationContract:'QA-CONFERENCE'},{silent:true});
      const r=GH_WORLD_DATA.airports.find(x=>x[0]==='OMDB');
      await a.runAuthorizedDomainCommand('facilities','create',{facility:{id:'QA-OMDB',name:'QA OMDB',kind:'airport-base',company:type,ownerCompanyId:type,owned:true,sourceKey:'air:OMDB',code:r[1]||'OMDB',icao:'OMDB',iata:r[1],city:r[3]||'—',country:String(r[5]||'—'),coords:[r[6],r[7]]},bucket:'globalBases'},{silent:true});
      const orderId=await a.buyAsset(type,'used',GH_ASSET_CATALOG.air.used[0].id,'lease',qty,'QA-OMDB',true,'QA-CONFERENCE-FLEET',type);
      return {orderId,fleet:GH_FLEET_DATA.size(s())};
    },QTY);
    assert.ok(setup.orderId);assert.equal(setup.fleet,QTY);
    await page.evaluate(()=>__AUDIT__.openDrawer('conference','overview'));
    const preview=page.locator('[data-gh-action="conference-stage-preview"]').first();await preview.waitFor({state:'visible'});await preview.click();
    await page.waitForFunction(()=>{const d=GH_CONFERENCE_3D.diagnostics();return d.failed===true||d.phase==='presenting'||(__GH_STATE__.alerts||[]).some(a=>/تعذر فتح محرك المؤتمر/.test(String(a?.text||a)));},null,{timeout:60000});
    const out=await page.evaluate(()=>({diagnostics:GH_CONFERENCE_3D.diagnostics(),alerts:(__GH_STATE__.alerts||[]).map(a=>String(a?.text||a)).filter(t=>/المؤتمر/.test(t))}));
    assert.deepEqual(out.alerts,[],`the conference opens without a fleet-summary refusal: ${JSON.stringify(out.alerts)}`);
    assert.equal(out.diagnostics.active,true);assert.equal(out.diagnostics.failed,false,`the stage does not fail: ${out.diagnostics.error}`);assert.equal(out.diagnostics.phase,'presenting');
    await page.evaluate(()=>GH_CONFERENCE_3D.close());
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({suite:'build373-conference-large-fleet-browser',assets:QTY,phase:out.diagnostics.phase,chapters:out.diagnostics.chapters}));
    console.log('BUILD373_CONFERENCE_LARGE_FLEET_PASS');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
