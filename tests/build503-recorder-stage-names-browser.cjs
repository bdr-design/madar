'use strict';
// iPhone diagnostic DX-1792378248326: 110 of 120 recorded frame drops read "unattributed-scheduler-or-compositor" because
// page opens, structural map renders and maintenance parts were not named for the explicit fault recorder, and
// longTasks=0 read as evidence although WebKit never delivers longtask entries. Proven in the real app:
//  1. with the recorder on, a page open names ui.render / ui.prepare / ui.bind / ui.open in that order of start time,
//     a structural map render names map.structure and a maintenance part names maintenance.<task>;
//  2. with the recorder off the real recordMainThreadWork keeps nothing (returns false) for the same stages;
//  3. the longtask status reports an engine without the entry type instead of 'installed'.
const assert=require('node:assert/strict'),path=require('node:path'),{chromium}=require('playwright'),{bootRenderApp}=require('./helpers/render-app.cjs'),{installVault}=require('./helpers/differential-vault-fixture.cjs'),{prepare}=require('./helpers/request-decisions-fixture.cjs'),ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];let env;
  try{
    env=await bootRenderApp({browser,root:ROOT,errors,viewport:{width:844,height:390},beforeScripts:{fn:installVault}});const page=env.page;page.setDefaultTimeout(60000);
    if(process.env.GH_STAGE_DEBUG)console.log('booted');await prepare(page,{rows:2400});if(process.env.GH_STAGE_DEBUG)console.log('prepared');
    const out=await page.evaluate(async()=>{
      const a=__AUDIT__,real=window.GH_DIAGNOSTICS,seen=[];
      // Off: the real recorder keeps nothing.
      const off=real.recordMainThreadWork(__GH_STATE__,'ui.open',0,10);
      window.GH_DIAGNOSTICS={...real,recordMainThreadWork(state,stage,start,end){seen.push({stage,start,end});return real.recordMainThreadWork(state,stage,start,end);}};
      try{
        a.openDrawer('finance');a.openDrawer('labor','dashboard');
        a.renderMap();
        return {off,stages:seen.map(row=>row.stage),ordered:seen.filter(row=>row.stage.startsWith('ui.')).slice(0,4).map(row=>row.stage),longTask:real.recorderSnapshot?.(__GH_STATE__)?.frameCapabilities?.longTaskObserver??null};
      }finally{window.GH_DIAGNOSTICS=real;}
    });
    assert.equal(out.off,false,'the real recorder keeps nothing while it is off');
    assert.deepEqual(out.ordered,['ui.render','ui.prepare','ui.bind','ui.open'],`page open stages: ${out.stages}`);
    assert.ok(out.stages.filter(name=>name==='ui.open').length>=2,'each page open is named');
    const app=require('node:fs').readFileSync(path.join(ROOT,'WebApp/app.js'),'utf8'),diagnostics=require('node:fs').readFileSync(path.join(ROOT,'WebApp/diagnostics-core.js'),'utf8');
    assert.ok(out.stages.includes('map.structure'),`a structural map render is named: ${out.stages}`);
    assert.match(app,/recordMainThreadWork\?\.\(state,`maintenance\.\$\{entry\.task\}/,'maintenance parts are named with their task');
    assert.match(app,/recordMainThreadWork\?\.\(state,'command\.publish\.routes'/,'the route runtime rebuilt after each command is named');
    assert.match(diagnostics,/supportedEntryTypes\.includes\('longtask'\)\?'not-supported-by-engine':'installed'/,'longtask support is reported, not assumed');
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({suite:'build503-recorder-stage-names-browser',ok:true,stages:[...new Set(out.stages)]}));
  }finally{await Promise.race([browser.close(),new Promise(resolve=>setTimeout(resolve,15000))]);await env?.closeOrigin?.();}
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>process.exit(process.exitCode||0));
