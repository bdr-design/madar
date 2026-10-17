'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),{chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');
const root=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
(async()=>{
 const browser=await chromium.launch({headless:true}),errors=[],results=[];try{
  const {page}=await boot({root,browser,errors});page.setDefaultTimeout(60000);
  for(const [width,height] of (process.env.GH_MAP_ONLY?[]:[[956,440],[844,390],[667,375]])){
   await page.setViewportSize({width,height});
   await page.evaluate(()=>__AUDIT__.openDrawer('diagnostics'));
   await page.locator('[data-gh-action="diagnostics-recorder-start"]').first().click();
   await page.waitForFunction(()=>GH_DIAGNOSTICS.recorderIsActive(__GH_STATE__));
   await page.evaluate(()=>{const s=__GH_STATE__,to=(Math.floor(s.simSeconds/86400)+1)*86400;s.simSeconds=to-1;s.lastMarketHour=to/3600-1;window.__QA_STAGED__=__AUDIT__.createSimulationSliceJob(1,{from:to-1,to,speed:300,boundary:GH_SIMULATION_TIME_CORE.boundaryAt(to)});__QA_STAGED__.runChunk(1,{deadline:-Infinity});});
   await page.locator('[data-gh-action="diagnostics-recorder-stop"]').first().click();
   await page.waitForTimeout(35);
   const during=await page.evaluate(()=>({active:GH_DIAGNOSTICS.recorderIsActive(__GH_STATE__),ended:GH_DIAGNOSTICS.recorderSnapshot(__GH_STATE__).endedAtMs,failures:__GH_STATE__.diagnostics.events.filter(e=>e.type==='BUTTON_ACTION_FAILED'&&e.detail?.action==='diagnostics-recorder-stop').length,staged:GH_TRANSACTION_CORE.isStaged(__GH_STATE__)}));
   assert.equal(during.active,false);assert.equal(during.staged,true);assert.equal(during.failures,0,'actual stop button must complete while the staged state remains locked');
   await page.evaluate(()=>{for(let i=0;i<10000;i++){const out=__QA_STAGED__.runChunk(1,{deadline:-Infinity});if(out===true||out?.done===true){const result=__QA_STAGED__.finish();if(!result.committed)throw new Error('day close did not commit');return;}}throw new Error('day close did not finish');});
   await page.waitForTimeout(80);await page.evaluate(()=>GH_DIAGNOSTICS.recorderStop(__GH_STATE__,GH_SIM_KERNEL.snapshot()));
   assert.equal(await page.evaluate(()=>GH_DIAGNOSTICS.recorderSnapshot(__GH_STATE__).endedAtMs),during.ended,'repeat button cannot extend the recording');
   results.push({case:'real recorder stop button during staged transaction',width,height,ok:true});
  }
  results.push(await page.evaluate(async()=>{
   const a=__AUDIT__,s=__GH_STATE__,map=a.leafletMap();a.closeDrawer();
   await a.runAuthorizedDomainCommand('corporate','open-company',{type:'air',capital:100000000,legalName:'Map test air'});
   for(const [i,icao] of ['OERK','OEJN','OEDF'].entries()){const r=GH_WORLD_DATA.airports.find(row=>row[0]===icao);await a.runAuthorizedDomainCommand('facilities','create',{facility:{id:'QA-MAP-'+i,name:'Map facility '+i,kind:'airport-base',company:'air',ownerCompanyId:'air',owned:true,sourceKey:'air:'+r[0],code:r[1]||r[0],icao:r[0],iata:r[1],coords:[r[6],r[7]],city:r[3]||r[4],country:new Intl.DisplayNames(['ar'],{type:'region'}).of(r[5]),deliveryCapacity:1000},bucket:'globalBases',groupValueAdd:0});}
   a.closeDrawer();map.setView([24.5,44.8],6,{animate:false});a.renderMap();
   const facilities=()=>Object.values(map._layers).filter(x=>x._icon&&x._icon.matches('.facility-marker,.map-base-dot,.map-hub-dot,.map-place-marker.owned-country,.map-place-marker.owned-city'));
   const before=facilities(),nodes=before.map(m=>m._icon),money=JSON.stringify({cash:s.cash,finance:s.finance,companyFinance:s.companyFinance,treasury:s.treasury});
   if(before.length<3)throw new Error('facility fixture did not create visible individual markers');
   const factory=L.marker,icons=L.divIcon;let allocations=0,iconAllocations=0;
   L.marker=function(...args){if(args[1]?.icon?.options?.className?.match(/facility-marker|map-base-dot|map-hub-dot|map-place-marker owned/))allocations++;return factory.apply(this,args);};
   L.divIcon=function(options){if(options?.className?.match(/facility-marker|map-base-dot|map-hub-dot|map-place-marker owned/))iconAllocations++;return icons.call(this,options);};
   const times=[];try{for(let i=0;i<20;i++){const at=performance.now();a.renderMap();times.push(performance.now()-at);}}finally{L.marker=factory;L.divIcon=icons;}
   if(allocations!==0||iconAllocations!==0)throw new Error(`unchanged facilities rebuilt: ${allocations} markers, ${iconAllocations} icons`);
   if(before.some((m,i)=>!map.hasLayer(m)||m._icon!==nodes[i]||!nodes[i].isConnected))throw new Error('unchanged facility DOM identity was lost');
   if(JSON.stringify({cash:s.cash,finance:s.finance,companyFinance:s.companyFinance,treasury:s.treasury})!==money)throw new Error('render changed finance');
   map.setView(s.globalBases.find(f=>f.id==='QA-MAP-0').coords,9,{animate:false});a.renderMap();a.clickFacilityMarker('QA-MAP-0');if(a.currentPanel()!=='facilityManage'||a.currentArg()?.id!=='QA-MAP-0')throw new Error('retained marker click is stale');a.closeDrawer();
   a.setMapMode('network');a.setMapMode('operations');a.renderMap();if(a.mapMetrics().vehicleCanvasCount!==1)throw new Error('map transition duplicated canvas');
   return {case:'unchanged facility DOM retained, actions and mode transitions',facilities:before.length,repeatedRenders:20,markerAllocations:allocations,iconAllocations,medianRenderMs:times.sort((x,y)=>x-y)[Math.floor(times.length/2)]};
  }));
  assert.deepEqual(errors,[]);console.log(JSON.stringify({suite:'build408-diagnostic-map-browser',engine:'chromium',ok:true,results}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
