'use strict';
// While the fleet moved, each fleet summary from the engine worker rebuilt the whole map (scheduleViewportMapRender(0)),
// and that rebuild asked for the next summary: about one structural render a second (41-44 ms each on iPhone; 977k
// assets at 4x CPU: 37 renders in 40 s, 36 from summaries), past the loop's own interval (8/20/30 s by fleet size).
// A summary now redraws at once only for the revision an explicit render wanted, or when the map holds no rows of this
// layout; any newer summary changes the loop's key, so the loop draws it within its interval. Proven in the real app:
//  1. idle play: structural renders stay within the loop's interval (the chain gave about one a second);
//  2. an explicit render during play (a command's afterCommit, a camera move) draws the store revision it saw within
//     2 s, with no chain after it;
//  3. after a compaction (epoch) the vehicles are back within 2 s;
//  4. after play stops, the map draws the final summary within the loop interval.
const assert=require('node:assert/strict'),path=require('node:path'),{chromium}=require('playwright'),{bootRenderApp}=require('./helpers/render-app.cjs'),{installVault}=require('./helpers/differential-vault-fixture.cjs'),{prepare}=require('./helpers/request-decisions-fixture.cjs'),ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const ROWS=Number(process.env.GH_MAP_CADENCE_ROWS||900),PLAY_SECONDS=16;
(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];let env;
  try{
    env=await bootRenderApp({browser,root:ROOT,errors,viewport:{width:844,height:390},beforeScripts:{fn:installVault}});const page=env.page;page.setDefaultTimeout(300000);
    await page.evaluate(()=>__AUDIT__.whenStateIdle());await prepare(page,{rows:ROWS});
    for(let n=0;n<20;n++){const r=await page.evaluate(()=>__AUDIT__.dispatchSharedInternationalNetwork('air'));if(!r?.remaining||r.capacityLimited||!r.departed)break;}
    const interval=await page.evaluate(async()=>{const a=__AUDIT__;a.closeDrawer();a.leafletMap().setView([25,45],3,{animate:false});a.setMapMode('operations');a.renderMap();await new Promise(r=>setTimeout(r,2000));const n=GH_FLEET_DATA.size(__GH_STATE__);return n>3000?30000:n>1000?20000:8000;});
    await page.evaluate(()=>{
      const a=__AUDIT__,real=window.GH_DIAGNOSTICS,q=window.__MAP_CADENCE__={calls:[]};
      window.GH_DIAGNOSTICS={...real,recordMainThreadWork(state,stage,start,end,...rest){if(stage==='map.structure'){const m=a.mapFleetSummary(),store=a.state().fleet;q.calls.push({at:start,drew:m.revision,store:store.revision,usable:!!m.rows&&m.epoch===GH_FLEET_STORE.epoch(store),vehicles:a.mapMetrics().vehicleIds.length});}return real.recordMainThreadWork(state,stage,start,end,...rest);}};
    });
    const play=await page.evaluate(async seconds=>{const a=__AUDIT__,q=__MAP_CADENCE__;q.calls.length=0;const received=a.mapFleetSummary().received;a.setSpeed(3);await new Promise(r=>setTimeout(r,seconds*1000));return {renders:q.calls.length,summaries:a.mapFleetSummary().received-received};},PLAY_SECONDS);
    assert.ok(play.summaries>=4,`the worker kept sending summaries during play: ${play.summaries}`);
    assert.ok(play.renders<=Math.ceil(PLAY_SECONDS*1000/interval)+1,`idle play stays within the loop interval (${interval} ms): ${play.renders} structural renders in ${PLAY_SECONDS} s for ${play.summaries} summaries`);
    const explicit=await page.evaluate(async()=>{const a=__AUDIT__,q=__MAP_CADENCE__,s=a.state(),out=[];
      for(let k=0;k<2;k++){await new Promise(r=>setTimeout(r,1500));const mark=q.calls.length,rev=s.fleet.revision,t0=performance.now();a.renderMap();let hit=null;const deadline=t0+2000;
        while(performance.now()<deadline){hit=q.calls.slice(mark).find(c=>c.drew>=rev&&c.usable);if(hit)break;await new Promise(r=>setTimeout(r,25));}
        const reached=hit?Math.round(hit.at-t0):null,settle=q.calls.length;await new Promise(r=>setTimeout(r,4000));out.push({reached,after:q.calls.length-settle});}
      return out;});
    for(const row of explicit){assert.notEqual(row.reached,null,'an explicit render during play draws the revision it saw within 2 s');assert.ok(row.after<=1,`no chain after it: ${row.after} renders in the next 4 s`);}
    const epoch=await page.evaluate(async()=>{const a=__AUDIT__,q=__MAP_CADENCE__,s=a.state();a.setSpeed(0);await a.whenStateIdle();GH_FLEET_STORE.bumpEpoch(s.fleet);const mark=q.calls.length,t0=performance.now();a.renderMap();let hit=null;
      while(performance.now()-t0<2000){hit=q.calls.slice(mark).find(c=>c.usable&&c.vehicles>0);if(hit)break;await new Promise(r=>setTimeout(r,25));}return {recovered:!!hit,vehicles:hit?.vehicles??0};});
    assert.equal(epoch.recovered,true,'after a compaction the vehicles are back within 2 s');
    const stop=await page.evaluate(async limit=>{const a=__AUDIT__,q=__MAP_CADENCE__,s=a.state();a.setSpeed(3);await new Promise(r=>setTimeout(r,2500));a.setSpeed(0);await a.whenStateIdle();const t0=performance.now();let ok=false;
      while(performance.now()-t0<limit){const last=q.calls[q.calls.length-1],rev=s.fleet.revision;if(last&&last.drew===rev&&last.store===rev&&last.usable){ok=true;break;}await new Promise(r=>setTimeout(r,100));}return {ok,ms:Math.round(performance.now()-t0)};},interval+2000);
    assert.equal(stop.ok,true,`after play stops the map draws the final summary within the loop interval (${interval} ms)`);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({suite:'build514-map-summary-cadence-browser',ok:true,rows:ROWS,interval,play,explicit,epoch,stop}));
  }finally{await Promise.race([browser.close(),new Promise(r=>setTimeout(r,15000))]);await env?.closeOrigin?.();}
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>process.exit(process.exitCode||0));
