'use strict';
const assert=require('node:assert/strict'),{chromium,webkit}=require('playwright'),{boot}=require('./helpers/local-dom-app');
(async()=>{for(const engine of [chromium,webkit]){const browser=await engine.launch({headless:true}),errors=[];try{
 const {page}=await boot({browser,errors});
 const result=await page.evaluate(()=>{
  const a=__AUDIT__,s=a.state(),map=a.leafletMap(),core=GH_MAP_PROXY_CORE;
  map.setView([24.7,46.7],9,{animate:false});
  // Presentation fixtures do not purchase or mutate assets in the live game.
  const candidates=[];
  for(const owner of ['air','second-air','sea'])for(let i=0;i<90;i++){
   const n=candidates.length,p=map.containerPointToLatLng([50+n%30*24,55+Math.floor(n/30)*26]),position=[p.lat,p.lng],id=owner+'-'+i;
   candidates.push({id:'competitor:'+id,source:'competitor',ownerCompanyId:owner,mode:owner==='sea'?'sea':'air',position,countryId:'QA',facilityId:'QA-BASE',routeId:id,asset:{id,type:owner==='sea'?'sea':'air',name:'QA '+id,company:owner,progress:0,route:[position,[p.lat+.001,p.lng+.001]]}});
  }
  const snapshot=()=>JSON.stringify({revision:s.saveRevision,cash:s.cash,finance:s.finance,fleet:s.fleet}),before=snapshot(),source=JSON.stringify(candidates),byId=new Map(candidates.map(row=>[row.id,row])),runs=[];
  for(const fallback of [false,true]){
   a.renderMap();window.GH_MAP_PROXY_CORE=fallback?null:core;
   const allocated=a.renderAllocatedVehicles(candidates,map.getZoom()),metrics=a.mapMetrics(),counts={};
   for(const id of metrics.vehicleIds){const owner=byId.get(id)?.ownerCompanyId;counts[owner]=(counts[owner]||0)+1;}
   const first=byId.get(metrics.vehicleIds[0]);map.fire('click',{containerPoint:map.latLngToContainerPoint(first.position)});
   const popup=document.querySelector('.leaflet-popup-content')?.textContent||'';map.closePopup();
   runs.push({fallback,allocated,counts,vehicleCount:metrics.vehicleCount,canvasCount:metrics.vehicleCanvasCount,domMarkers:document.querySelectorAll('#map .competitor-marker').length,clickWorks:popup.includes(first.asset.name)});
  }
  window.GH_MAP_PROXY_CORE=core;
  return {runs,stateUnchanged:snapshot()===before,candidatesUnchanged:JSON.stringify(candidates)===source};
 });
 for(const run of result.runs){assert.equal(run.allocated,150,JSON.stringify(run));assert.deepEqual(run.counts,{air:50,'second-air':50,sea:50});assert.equal(run.vehicleCount,150);assert.equal(run.canvasCount,1);assert.equal(run.domMarkers,0);assert.equal(run.clickWorks,true,'displayed assets retain their click action');}
 assert.equal(result.stateUnchanged,true);assert.equal(result.candidatesUnchanged,true);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({suite:'build384-map-company-cap-browser',engine:engine.name(),ok:true,...result}));
 }finally{await browser.close();}}})().catch(error=>{console.error(error);process.exitCode=1;});
