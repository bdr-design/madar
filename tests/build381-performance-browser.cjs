'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium,webkit}=require('playwright'),{boot}=require('./helpers/local-dom-app');
const results=[],artifact=process.env.GH_PERFORMANCE_ARTIFACTS;
(async()=>{
 for(const engine of [chromium,webkit]){
  const browser=await engine.launch({headless:true}),errors=[];
  try{
   // A real first-party origin exercises IndexedDB; the game fixture itself still has no server dependency.
   const {page}=await boot({browser:{newPage:async opts=>{const page=await browser.newPage({...opts,hasTouch:true});await page.route('http://performance.test/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>local QA</title>'}));await page.goto('http://performance.test/');return page;}},errors,viewport:{width:956,height:440}});page.setDefaultTimeout(30000);
   await page.evaluate(()=>{window.__PERF_QA__={saveCalls:0,snapshotCalls:0};const p=GH_PERSISTENCE,d=GH_DIAGNOSTICS;window.GH_PERSISTENCE={...p,commitState(...a){__PERF_QA__.saveCalls++;return p.commitState(...a);}};window.GH_DIAGNOSTICS={...d,exportBundleAsync(...a){__PERF_QA__.snapshotCalls++;return d.exportBundleAsync(...a);}};__AUDIT__.openDrawer('diagnostics');});
   const active=()=>page.evaluate(()=>GH_PERFORMANCE_TRACE.active);
   assert.equal(await active(),false);assert.equal(await page.locator('#performanceTracePanel').count(),1);
   const before=await page.evaluate(()=>({cash:__GH_STATE__.cash,revision:__GH_STATE__.saveRevision,sim:__GH_STATE__.simSeconds,saves:__PERF_QA__.saveCalls}));
   await page.locator('[data-gh-action="performance-trace-start"]').tap();await page.waitForFunction(()=>GH_PERFORMANCE_TRACE.active);await page.evaluate(()=>__AUDIT__.closeDrawer());
   await page.waitForTimeout(700);
   await page.evaluate(()=>{const start=performance.now();while(performance.now()-start<75){}GH_PERFORMANCE_TRACE.recordWork('qa.single-block',start,performance.now());});await page.waitForTimeout(180);
   await page.evaluate(()=>__AUDIT__.openDrawer('diagnostics'));await page.locator('[data-gh-action="performance-trace-stop"]').tap();await page.waitForFunction(()=>document.querySelector('#performanceReportNotice'));
   const report=await page.evaluate(async()=>{const store=GH_PERFORMANCE_REPORT_STORE.create();return store.load();});
   assert.ok(report&&report.frameSummary.frames>0);assert.ok(report.incidents.some(e=>e.primaryStage==='qa.single-block'),'single isolated real main-thread block is attributed to its timed evidence');assert.equal(report.native.available,false,'browser does not fabricate native readings');assert.equal(await active(),false);assert.equal(await page.locator('#performanceReportSave').count(),1);
   const after=await page.evaluate(()=>({cash:__GH_STATE__.cash,revision:__GH_STATE__.saveRevision,sim:__GH_STATE__.simSeconds,saves:__PERF_QA__.saveCalls,exports:__PERF_QA__.snapshotCalls}));assert.equal(after.cash,before.cash);assert.equal(after.revision,before.revision);assert.equal(after.sim,before.sim);assert.equal(after.saves,before.saves);assert.equal(after.exports,0,'stopping does not invoke the expensive full diagnostic snapshot');
   await page.locator('#performanceReportLater').tap();assert.equal(await page.locator('#performanceReportNotice').count(),0);assert.equal((await page.evaluate(()=>GH_PERFORMANCE_REPORT_STORE.create().load())).id,report.id,'closing prompt preserves durable report');
   let accept=false;page.on('dialog',d=>accept?d.accept():d.dismiss());await page.locator('[data-gh-action="performance-trace-start"]').tap();assert.equal(await active(),false,'cancel replacement keeps old report');assert.equal((await page.evaluate(()=>GH_PERFORMANCE_REPORT_STORE.create().load())).id,report.id);
   for(const size of [{width:568,height:320},{width:440,height:956},{width:956,height:440}]){await page.setViewportSize(size);for(const id of ['performance-trace-start','performance-trace-view','performance-trace-export']){const button=page.locator(`[data-gh-action="${id}"]`);await button.scrollIntoViewIfNeeded();const b=await button.boundingBox();assert.ok(b&&b.x>=0&&b.x+b.width<=size.width+1,`button ${id} fits ${size.width}`);}}
   if(artifact){fs.mkdirSync(artifact,{recursive:true});await page.locator('#performanceTracePanel').scrollIntoViewIfNeeded();await page.screenshot({path:`${artifact}/${engine.name()}-report.png`});}
   const download=page.waitForEvent('download');await page.locator('[data-gh-action="performance-trace-export"]').tap();const exported=await download;assert.ok(exported.suggestedFilename().endsWith('.ghdiagnostic'));assert.equal((await page.evaluate(()=>GH_PERFORMANCE_REPORT_STORE.create().load())).id,report.id,'export preserves original');
   accept=true;await page.selectOption('#performanceTraceDuration','300000');await page.locator('[data-gh-action="performance-trace-start"]').tap();await page.waitForFunction(()=>GH_PERFORMANCE_TRACE.active);assert.equal((await page.evaluate(()=>GH_PERFORMANCE_REPORT_STORE.create().load())).id,report.id,'new recording leaves old durable report until finalization');await page.locator('[data-gh-action="performance-trace-stop"]').tap();await page.waitForFunction(()=>!!document.getElementById('performanceReportNotice'));const longer=await page.evaluate(()=>GH_PERFORMANCE_REPORT_STORE.create().load());assert.equal(longer.requestedDurationMs,300000);assert.notEqual(longer.id,report.id);await page.locator('#performanceReportLater').tap();
   // Browser-context recreation at the same origin uses the actual persisted IDB record.
   await page.reload({waitUntil:'domcontentloaded'});await page.addScriptTag({content:fs.readFileSync(require.resolve('../WebApp/performance-report-store.js'),'utf8')});const reloaded=await page.evaluate(()=>GH_PERFORMANCE_REPORT_STORE.create().load());assert.equal(reloaded.id,longer.id);
   results.push({engine:engine.name(),reportId:report.id,frames:report.frameSummary.frames,incidents:report.coverage.incidentTotal,isolatedBlockAttributed:true,persistedAfterReload:true,fiveMinuteOption:true,previousReportKeptUntilReplacement:true,financialStateUnchanged:true,fullSnapshotCalls:after.exports,observer:report.observer});assert.deepEqual(errors,[]);
  }finally{await browser.close();}
 }
 const result={suite:'build381-performance-browser',ok:true,engines:2,results};if(artifact)fs.writeFileSync(`${artifact}/browser-results.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
})().catch(error=>{console.error(error);process.exitCode=1;});
