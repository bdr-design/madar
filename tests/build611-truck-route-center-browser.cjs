'use strict';
// Owner («شوف مسارات الشاحنات فيها مشكلة» — «الشاحنات صفر مكتوب»): the route center read its asset counts from the
// fleet query it skipped when the company had no route card and no manual list, so a logistics company with trucks and no
// route yet read zero trucks, and its dispatch button («توزيع وتشغيل أسطول الشاحنات (0)») stayed disabled: its first
// trucks could never leave. The query is now skipped only when the summary of the same snapshot is already known. In the
// real app (local DOM, fleet worker, the road provider answered by a fixed double), against the source before (1d7dce1,
// from its own tree), with 30 trucks bought for a logistics hub:
//  1. the source before shows the company's page with 0 assets and the dispatch button disabled at (0) (the defect);
//  2. this source shows 30 assets, 30 without a route, and the button enabled at (30); the summary tab shows 30 too;
//  3. pressing the button dispatches all 30 trucks onto road routes of the company (planned, saved, scheduled), and a
//     few hours later trucks are moving and the page counts them;
//  4. no error is logged.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app'),{osrmDouble}=require('./helpers/road-provider-fixture.cjs');
const ROOT=path.resolve(__dirname,'..'),SOURCE=process.env.GH_TEST_SOURCE_DIR||ROOT,PREVIOUS='1d7dce1',TRUCKS=30;
const settle=page=>page.waitForFunction(()=>!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked()&&!GH_TRANSACTION_CORE.isStaged(__GH_STATE__),null,{timeout:120000});
async function world(page){
  return page.evaluate(async count=>{
    const a=__AUDIT__,s=__GH_STATE__;s.godMoney=true;s.infiniteMoney=true;
    await a.runAuthorizedDomainCommand('corporate','open-company',{type:'road',companyId:'road',capital:900000000,legalName:'QA Road',formationContract:'QA-611'},{silent:true});
    const cap=GH_MOBILITY_CORE.capitalMeta('RUH');
    await a.runAuthorizedDomainCommand('facilities','create',{facility:{id:'QA-611-HUB',ownerCompanyId:'road',company:'road',kind:'logistics',owned:true,capitalId:'RUH',sourceKey:'site:road:RUH',city:cap.city,country:cap.country,coords:[...cap.coords],name:'QA 611 Hub',deliveryCapacity:1000000,dailyCost:0},bucket:'customHubs'},{silent:true});
    const model=[...GH_ASSET_CATALOG.road.used].sort((x,y)=>x.price-y.price)[0];
    if(!await a.buyAsset('road','used',model.id,'lease',count,'QA-611-HUB',true,'QA-611-BUY','road',{}))throw new Error('truck-purchase-failed');
    await a.whenStateIdle();
    return {trucks:GH_FLEET_DATA.count(s,row=>row.type==='road'&&row.ownerCompanyId==='road'),routed:GH_FLEET_DATA.count(s,row=>Boolean(row.routeId)),roadRoutes:(s.customRoutes||[]).filter(r=>(r.routeMode||r.type)==='road').length};
  },TRUCKS);
}
// The road company's route page once its counts have come back from the fleet worker (or a few seconds have passed).
async function routePage(page,tab='road'){
  await page.evaluate(tab=>__AUDIT__.openDrawer('routes',tab),tab);
  for(let i=0;i<40;i++){await page.waitForTimeout(100);if(!await page.locator('#drawerBody .route-center-loading').count())break;}
  return page.evaluate(()=>{
    const body=document.querySelector('#drawerBody'),button=body.querySelector('.dispatch-existing-network'),work=body.querySelector('.list-item.sector-road .metric-row');
    const metrics=work?Object.fromEntries([...work.children].map(div=>[div.querySelector('span')?.textContent.trim(),Number(div.querySelector('b')?.textContent.replace(/[^\d]/g,''))])):null;
    return {assets:body.querySelector('.list-item.sector-road .list-item-head .tag')?.textContent.trim()||null,metrics,button:button?{text:button.textContent.trim(),disabled:button.disabled}:null,summary:[...body.querySelectorAll('.command-btn.sector-road small')].map(x=>x.textContent.trim())};
  });
}
(async()=>{
  const tree=fs.mkdtempSync(path.join(os.tmpdir(),'b611-')),browser=await chromium.launch({headless:true}),errors=[];
  try{
    execFileSync('sh',['-c',`git -C "${ROOT}" archive ${PREVIOUS} WebApp | tar -x -C "${tree}"`]);require(path.join(ROOT,'tests/helpers/brand-baseline.cjs')).brandBaseline(tree,ROOT);
    // 1.
    {const env=await boot({browser,errors,root:tree,fleetWorker:true});env.page.setDefaultTimeout(120000);await osrmDouble(env.page);
      const w=await world(env.page);assert.equal(w.trucks,TRUCKS,'1: the trucks were bought');assert.equal(w.roadRoutes,0,'1: (no road route yet)');
      const before=await routePage(env.page);
      assert.equal(before.assets,'0 أصل',`1: the source before reads zero trucks (${JSON.stringify(before)})`);assert.equal(before.button?.text,'توزيع وتشغيل أسطول الشاحنات (0)','1: its dispatch button counts none');assert.equal(before.button.disabled,true,'1: and stays disabled');
      await env.page.close();}
    // 2.
    const env=await boot({browser,errors,root:SOURCE,fleetWorker:true}),page=env.page;page.setDefaultTimeout(120000);await osrmDouble(page);
    const w=await world(page);assert.equal(w.trucks,TRUCKS);assert.equal(w.roadRoutes,0);
    const now=await routePage(page);
    assert.equal(now.assets,require('../WebApp/arabic-copy-core.js').count(TRUCKS,'asset'),`2: the page counts the trucks (${JSON.stringify(now)})`);assert.equal(now.metrics['بلا مسار'],TRUCKS,'2: all without a route');assert.equal(now.metrics['مكلّفة'],0);
    assert.deepEqual(now.button,{text:`توزيع وتشغيل أسطول الشاحنات (${TRUCKS})`,disabled:false},'2: the dispatch button is enabled with every truck');
    const summary=await routePage(page,'all');assert.ok(summary.summary.some(text=>text.startsWith(`${TRUCKS} أصل`)),`2: the summary tab counts them too (${JSON.stringify(summary.summary)})`);
    // 3.
    await routePage(page);await page.locator('#drawerBody .dispatch-existing-network').click();
    if(await page.locator('.ui-confirm [data-confirm="accept"]').count())await page.locator('.ui-confirm [data-confirm="accept"]').click();
    await page.waitForFunction(count=>GH_FLEET_DATA.count(__GH_STATE__,row=>row.type==='road'&&Boolean(row.routeId))===count,TRUCKS,{timeout:120000});await settle(page);
    const sent=await page.evaluate(()=>{const s=__GH_STATE__,routes=(s.customRoutes||[]).filter(r=>(r.routeMode||r.type)==='road');let scheduled=0,moving=0,owners=new Set();GH_FLEET_DATA.scan(s,['type','routeId','phase','departureScheduled'],row=>{if(row.type!=='road')return;if(row.departureScheduled)scheduled++;if(row.phase==='moving')moving++;});for(const r of routes)owners.add(r.ownerCompanyId);return {routes:routes.length,owners:[...owners],scheduled,moving,alert:String(s.alerts?.[0]?.text||s.alerts?.[0]||'')};});
    assert.ok(sent.routes>=1,'3: road routes were created');assert.deepEqual(sent.owners,['road'],'3: owned by the logistics company');
    assert.equal(sent.scheduled+sent.moving,TRUCKS,`3: every truck is scheduled or moving (${JSON.stringify(sent)})`);assert.match(sent.alert,new RegExp(`جُدولت ${TRUCKS} شاحنة`),'3: the dispatch was recorded');
    await page.evaluate(async()=>{const a=__AUDIT__,s=__GH_STATE__;window.__GH_MANUAL_CALENDAR_WINDOWS__=false;a.simulationEngine.advanceTo(s.simSeconds+6*3600,{speed:600,batchSeconds:3600,reason:'qa-611',maxSeconds:86400});for(let i=0;i<60000&&(a.simulationEngine.snapshot().manualAdvance||GH_TRANSACTION_CORE.isStaged(s));i++)await new Promise(r=>setTimeout(r,2));});await settle(page);
    const later=await routePage(page);
    assert.ok(later.metrics['متحركة']>0,`3: trucks are moving and counted (${JSON.stringify(later)})`);assert.equal(later.metrics['مكلّفة'],TRUCKS,'3: all on routes');
    // 4.
    assert.deepEqual(errors,[],'4: no error');
    console.log(JSON.stringify({suite:'build611-truck-route-center-browser',ok:true,before:'0 trucks, button disabled',now:now.button.text,routes:sent.routes,moving:later.metrics['متحركة']}));
  }finally{await browser.close();fs.rmSync(tree,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
