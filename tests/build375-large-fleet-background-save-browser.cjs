'use strict';
// Build 375 regression (iPhone diagnostic, 300,000 assets: the last ordinary save failed with
// invalid-save:fleet-validation-unavailable). The background save of a hidden app and the real-time cap checkpoint are
// the synchronous ordinary save, and Save Schema requires the fleet engine worker's evidence above 2,048 assets, which a
// synchronous caller could never get: with a large fleet every such save failed and the progress since the last durable
// commit was lost when iOS closed the app. Here 3,000 aircraft run past an hour boundary on the real worker, the game is
// paused and the app hidden: the save is written (the worker's last answer, or one asked for then), on the same checks.
const assert=require('node:assert/strict');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');
const QTY=3000;

(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    const {page}=await boot({browser,errors,fleetWorker:true});page.setDefaultTimeout(0);
    const fleet=await page.evaluate(async qty=>{
      const a=__AUDIT__,s=()=>__GH_STATE__,type='air';
      await a.runAuthorizedDomainCommand('corporate','open-company',{type,companyId:type,capital:900000000,legalName:'QA Background Save',formationContract:'QA-BACKGROUND-SAVE'},{silent:true});
      s().godMoney=true;s().infiniteMoney=true;
      const r=GH_WORLD_DATA.airports.find(x=>x[0]==='OMDB');
      await a.runAuthorizedDomainCommand('facilities','create',{facility:{id:'QA-OMDB',name:'QA OMDB',kind:'airport-base',company:type,ownerCompanyId:type,owned:true,sourceKey:'air:OMDB',code:r[1]||'OMDB',icao:'OMDB',iata:r[1],city:r[3]||'—',country:String(r[5]||'—'),coords:[r[6],r[7]]},bucket:'globalBases'},{silent:true});
      await a.buyAsset(type,'used',GH_ASSET_CATALOG.air.used[0].id,'lease',qty,'QA-OMDB',true,'QA-BACKGROUND-SAVE',type);
      return {size:GH_FLEET_DATA.size(s()),limit:GH_FLEET_MAIN_THREAD_POLICY.DEFAULT_ROW_LIMIT};
    },QTY);
    assert.equal(fleet.size,QTY);assert.ok(fleet.size>fleet.limit,'the fleet is above the main-thread limit');
    await page.evaluate(()=>__AUDIT__.setSpeed(4));
    await page.waitForFunction(()=>__GH_STATE__.simSeconds>7300,null,{timeout:240000});
    await page.evaluate(()=>__AUDIT__.setSpeed(0));
    await page.waitForFunction(()=>!GH_SIM_KERNEL.snapshot().jobActive&&!GH_PERSISTENCE.isLocked(),null,{timeout:60000});
    const saved=await page.evaluate(async()=>{
      const before=Number(__GH_STATE__.saveRevision)||0;
      Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>'hidden'});
      document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('pagehide'));
      for(let i=0;i<100&&(Number(__GH_STATE__.saveRevision)||0)===before;i++)await new Promise(resolve=>setTimeout(resolve,50));
      const prep=window.__GH_APP_RUNTIME_INSTRUMENTATION__?.lastSavePreparation||{};
      return {before,after:Number(__GH_STATE__.saveRevision)||0,ok:prep.ok===true,error:prep.error||'',incidents:(__GH_STATE__.controlPlane?.incidents||[]).filter(row=>row.status==='open').map(row=>row.code)};
    });
    assert.equal(saved.after,saved.before+1,`the hidden app's save is written (${saved.error})`);
    assert.equal(saved.ok,true);assert.doesNotMatch(saved.error,/fleet-validation-unavailable/);
    assert.deepEqual(saved.incidents,[],'no open incident');assert.deepEqual(errors,[]);
    console.log(JSON.stringify({suite:'build375-large-fleet-background-save-browser',fleet:fleet.size,saveRevision:saved.after}));
    console.log('BUILD375_LARGE_FLEET_BACKGROUND_SAVE_PASS');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
