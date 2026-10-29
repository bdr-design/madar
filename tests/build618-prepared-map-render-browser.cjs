'use strict';
// Owner («موافق», design A; renderMap took 31 ms at 2x CPU throttle in a 300k-asset world, every 30 s and on each
// fleet summary it asked for): the periodic structural render is prepared in slices over several tasks, then drawn in
// a task of its own. In the real app, 2,000 moving assets on 100 routes, the game paused:
//  1. a loop or summary render starts a preparation and draws nothing in its own task; the map is drawn later;
//  2. the prepared map is the one an immediate render draws: the same vehicles at the same positions;
//  3. with a clock that moves 0.5 ms a reading, the preparation is cut into slices (several map.prepare tasks), and
//     still draws the same map;
//  4. an explicit render during a preparation draws at once and drops it (no second render after it);
//  5. a zoom change during a preparation starts it again: the map drawn is the one an immediate render at the new zoom
//     draws; a map that keeps changing is drawn at once after three restarts;
//  6. the source before (88f4014) drew the summary render in its own task;
//  7. a render right after a render loads no new vehicle image (the cleared images are taken up again; the source
//     before loaded each one again).
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app'),{scenario}=require('./helpers/business-scenario');
const ROOT=path.resolve(__dirname,'..'),PREVIOUS='88f4014';
const HOOKS=`{prepared:reason=>{mapRenderReason=reason;mapSummaryFollowUpRender=true;try{return renderMap();}finally{mapRenderReason='';mapSummaryFollowUpRender=false;}},
  debug:()=>({mode:mapMode(),aggregate:mapAggregateMode(),assets:mapCategoryVisible("assets"),canvas:!!mapVehicleCanvas,own:ownMarkers.size,hits:mapVehicleHitTargets.size,size:window.GH_FLEET_DATA.size(state),rows:!!mapFleetSummary.rows,client:!!mapFleetSummaryClient(),reps:collectFleetPresentation(currentMapFilter(),[]).representatives?.size,cands:(()=>{const p=collectFleetPresentation(currentMapFilter(),[]);return operationVehicleCandidates(currentMapFilter(),p,[],mapFacilityPresentationContext()).length;})(),first:(()=>{const x=window.GH_FLEET_DATA.get(state,"B618-0");return x&&{owner:x.ownerCompanyId,phase:x.phase,route:x.routeId,pos:assetPosition(x)};})()}),
  preparing:()=>typeof mapPreparation!=='undefined'&&!!mapPreparation,vehicles:()=>[...mapVehicleHitTargets.values()].map(c=>[c.id,c.position[0],c.position[1]]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0),leaflet:()=>map}`;
async function run(root){
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    const {page}=await boot({browser,errors,root,fleetWorker:true,appAudit:HOOKS});
    const e=scenario();e.manualPurchase(1);
    return await page.evaluate(async fixture=>{
      const a=__AUDIT__,s=__GH_STATE__,tick=()=>new Promise(resolve=>setTimeout(resolve,0)),settle=async()=>{for(let i=0;i<400&&a.preparing();i++)await tick();await tick();await tick();};
      const toStore=(target,assets)=>{target.fleet=GH_FLEET_STORE.fromAssets(assets,{at:Number(target.simSeconds)||0});delete target.assets;return target;};
      const base=toStore({...structuredClone(s),...fixture},fixture.assets||[]);a.replaceLiveState(base);s.fleet=base.fleet;s.speed=0;a.simulationEngine.reset(performance.now(),'b618');
      const reference=structuredClone(a.routeTemplates.AIR_RUH_LHR),seed=structuredClone(fixture.assets[0]),state=structuredClone(s);
      const routes=Array.from({length:100},(_,i)=>({...structuredClone(reference),id:`B618-ROUTE-${i}`,ownerCompanyId:'air',routeMode:'air',type:'air',fromFacility:'B1',route:[[8+(i%10)*4,-100+Math.floor(i/10)*20],[13+(i%10)*4,-85+Math.floor(i/10)*20]],tripSeconds:6000,referenceOnly:false}));
      state.customRoutes=routes;toStore(state,Array.from({length:2000},(_,i)=>({...structuredClone(seed),id:`B618-${i}`,ownerCompanyId:'air',type:'air',routeId:routes[i%routes.length].id,phase:'moving',tripSeconds:6000,progress:(i%7)/50,reverse:false})));
      a.replaceLiveState(state);s.fleet=state.fleet;for(const route of Object.values(a.routeTemplates))if(route.id?.startsWith('B618-'))a.prepareRoute(route);
      const real=window.GH_DIAGNOSTICS,work=[];window.GH_DIAGNOSTICS={...real,recordMainThreadWork(target,stage,start,end,detail){work.push({stage,reason:detail?.reason||''});return real?.recordMainThreadWork?.(target,stage,start,end,detail);}};
      const out={};
      try{
        a.renderMap();for(let i=0;i<100&&!a.vehicles().length;i++){await new Promise(resolve=>setTimeout(resolve,50));await settle();}
        a.renderMap();const immediate=a.vehicles();out.immediateCount=immediate.length;out.debug=a.debug();
        // 1-2.
        a.renderMap();work.length=0;const started=a.prepared('summary-due');out.started=started;out.preparingAfterTask=a.preparing();out.drawnInTask=work.filter(w=>w.stage==='map.structure').length;
        await settle();out.prepared=a.vehicles();out.sameAsImmediate=JSON.stringify(out.prepared)===JSON.stringify(immediate);out.structureRenders=work.filter(w=>w.stage==='map.structure').map(w=>w.reason);
        // 3.
        const clock=performance.now.bind(performance);let offset=0;work.length=0;performance.now=()=>clock()+(offset+=0.5);
        try{a.prepared('loop');await settle();}finally{performance.now=clock;}
        out.slices=work.filter(w=>w.stage==='map.prepare').length;out.slicedSame=JSON.stringify(a.vehicles())===JSON.stringify(immediate);out.slicedRenders=work.filter(w=>w.stage==='map.structure').length;
        // 4.
        work.length=0;a.prepared('loop');a.renderMap();out.droppedPreparing=a.preparing();await settle();out.afterExplicit=work.filter(w=>w.stage==='map.structure').length;
        // 5.
        const leaflet=a.leaflet(),zoom=leaflet.getZoom();a.prepared('summary-due');leaflet.setZoom(zoom+1,{animate:false});await settle();const restarted=a.vehicles();
        a.renderMap();out.restartSame=JSON.stringify(restarted)===JSON.stringify(a.vehicles());out.restartZoom=leaflet.getZoom();
        work.length=0;let flips=0;performance.now=()=>clock()+(offset+=0.5);
        try{a.prepared('summary-due');for(let i=0;i<60&&a.preparing();i++){leaflet.setZoom(flips++%2?zoom:zoom+1,{animate:false});await tick();}}finally{performance.now=clock;}
        await settle();
        out.flips=flips;out.keptChangingDrawn=work.filter(w=>w.stage==='map.structure').length;out.stillPreparing=a.preparing();
        // 7.
        a.renderMap();const RealImage=window.Image;let images=0;window.Image=function(...args){images++;return new RealImage(...args);};try{a.renderMap();}finally{window.Image=RealImage;}out.imagesOnRerender=images;
      }finally{window.GH_DIAGNOSTICS=real;}
      return out;
    },e.state);
  }finally{await browser.close();}
}
(async()=>{
  const now=await run(process.env.GH_TEST_SOURCE_DIR||ROOT);
  const tree=fs.mkdtempSync(path.join(os.tmpdir(),'b618-'));let before;
  try{execFileSync('sh',['-c',`git -C "${ROOT}" archive ${PREVIOUS} | tar -x -C "${tree}"`]);before=await run(tree);}finally{fs.rmSync(tree,{recursive:true,force:true});}
  assert.ok(now.immediateCount>=20,`a fleet is drawn (${now.immediateCount} vehicles) ${JSON.stringify(now.debug)}`);
  // 1.
  assert.equal(now.started,false,'1: the summary render only starts a preparation');assert.equal(now.preparingAfterTask,true,'1: a preparation is in progress');assert.equal(now.drawnInTask,0,'1: nothing drawn in its own task');
  assert.deepEqual(now.structureRenders,['summary-due'],'1: drawn once, later, under its own reason');
  // 2.
  assert.equal(now.sameAsImmediate,true,'2: the same vehicles at the same positions as an immediate render');
  // 3.
  assert.ok(now.slices>=2,`3: the preparation is cut into slices (${now.slices})`);assert.equal(now.slicedSame,true,'3: and draws the same map');assert.equal(now.slicedRenders,1,'3: drawn once');
  // 4.
  assert.equal(now.droppedPreparing,false,'4: an explicit render drops the preparation');assert.equal(now.afterExplicit,1,'4: no second render after it');
  // 5.
  assert.equal(now.restartSame,true,'5: a zoom change restarts the preparation: the map at the new zoom');
  assert.equal(now.stillPreparing,false,'5: a map that keeps changing is drawn');assert.equal(now.keptChangingDrawn,1,'5: once, at once after the restarts');assert.ok(now.flips<=8,`5: within the restart limit (${now.flips} changes)`);
  // 6.
  assert.notEqual(before.started,false,'6: (the source before drew the summary render in its own task)');assert.equal(before.drawnInTask,1);
  // 7.
  assert.equal(now.imagesOnRerender,0,'7: no vehicle image loaded again');assert.ok(before.imagesOnRerender>0,`7: (the source before loaded ${before.imagesOnRerender})`);
  console.log(JSON.stringify({suite:'build618-prepared-map-render-browser',ok:true,vehicles:now.immediateCount,slices:now.slices,flips:now.flips,imagesOnRerender:now.imagesOnRerender,before:{drawnInTask:before.drawnInTask,imagesOnRerender:before.imagesOnRerender}}));
})().catch(error=>{console.error(error);process.exitCode=1;});
