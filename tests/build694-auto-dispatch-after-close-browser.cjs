'use strict';
// Build 694, plan batch 2 (A1; the owner: «لاتخلي شي من الخطه نفذه بدقه»): aircraft, ships and trucks a company bought
// (or the engine stopped) stayed idle until the dispatch button was pressed, paying crews and insurance. The company is
// marked, and after the day's close its idle assets depart through the button's own dispatch, at most 2,000 a company a
// day. In the real app (local DOM, fleet worker, the air dispatch's worker planner):
//   1. a purchase marks the company in its own transaction (the mark is saved with the aircraft);
//   2. after the next close the first 2,000 depart in one command (one alert line «توزيع آلي بعد إقفال اليوم»), the mark
//      stays because 100 are left; after the following close the rest depart and the mark is cleared;
//   3. a day with no mark queues no automatic dispatch at all (no work, no alert);
//   4. no notice or page opens for the player; the button's own result for a press is unchanged (one more aircraft bought
//      and dispatched by hand departs at once, and the mark it set is cleared by the next close, finding none idle);
//   5. no error is logged;
//   6. (review round 8) the automatic dispatch's intents are the autopilot's system decisions, a press stays the founder's;
//   7. (review round 9) a press made while the automatic dispatch's command runs waits for it and is applied.
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');
const prior=fs.readFileSync(require.resolve('./build371-air-fleet-series-browser.cjs'),'utf8');
const installVault=new Function(prior.slice(prior.indexOf('function installVault(){'),prior.indexOf('(async()=>{'))+'\nreturn installVault;')();
const nextDay=page=>page.evaluate(async()=>{const a=__AUDIT__,s=__GH_STATE__,day=s.lastFinancialDay;window.__GH_MANUAL_CALENDAR_WINDOWS__=false;
  a.simulationEngine.advanceTo((Math.floor(s.simSeconds/86400)+1)*86400,{speed:600,batchSeconds:3600,reason:'qa-694',maxSeconds:3*86400});
  for(let i=0;i<120000&&(a.simulationEngine.snapshot().manualAdvance||GH_TRANSACTION_CORE.isStaged(s));i++)await new Promise(r=>setTimeout(r,2));
  for(let i=0;i<600&&GH_APP_RUNTIME_METRICS.snapshot().maintenance.pending.length;i++)await new Promise(r=>setTimeout(r,10));
  // The automatic dispatch runs in the background like a press: wait for its durable command(s) to finish.
  // Review (a reader: the dispatch awaits the fleet worker before its command opens, so a wait on the command alone could
  // pass early): wait until no autopilot or automatic dispatch is queued or running and no command or save is in flight,
  // twice in a row 200 ms apart; a wait that does not settle fails instead of going on.
  const busy=()=>(()=>{const m=window.__GH_APP_RUNTIME_INSTRUMENTATION__?.maintenance||{};return !!window.__GH_DURABLE_COMMAND_CONTEXT__||GH_PERSISTENCE.isLocked()||m.autoDispatchRunning===true||(m.pending||[]).some(t=>t==='autopilot'||t==='auto-dispatch');})();let calm=0;for(let i=0;i<12000&&calm<2;i++){await new Promise(r=>setTimeout(r,20));if(busy())calm=0;else if(i%10===0)calm++;}
  if(calm<2)throw new Error('auto-dispatch-did-not-settle');
  await a.whenStateIdle();return {closed:s.lastFinancialDay-day};});
const look=page=>page.evaluate(()=>{const s=__GH_STATE__,F=GH_FLEET_DATA;let idle=0,routed=0;for(let i=0;i<F.size(s);i++){const v=F.viewAt(s,i);if(v.ownerCompanyId!=='air'&&v.company!=='air')continue;if(v.routeId)routed++;else idle++;}
  const alerts=(s.alerts||[]).map(x=>String(x.text||x));return {idle,routed,pending:s.advanced?.companies?.air?.autoDispatchPending===true,auto:alerts.filter(x=>x.startsWith('توزيع آلي بعد إقفال اليوم')).length,toasts:document.querySelectorAll('#uiToasts .ui-toast').length};});
(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    const {page}=await boot({browser,errors,fleetWorker:true});page.setDefaultTimeout(600000);await page.evaluate(installVault);
    await page.evaluate(async()=>{
      const a=__AUDIT__,s=__GH_STATE__;
      if(!s.openedCompanies.includes('air'))await a.runAuthorizedDomainCommand('corporate','open-company',{type:'air',capital:400000000,legalName:'Auto Dispatch QA'},{silent:true});
      s.godMoney=true;s.infiniteMoney=true;
      const airport=GH_WORLD_DATA.airports.find(row=>row[0]==='OERK'),facility={id:'AUTO-B1',name:'Auto Riyadh',kind:'airport-base',company:'air',ownerCompanyId:'air',owned:true,sourceKey:'air:OERK',icao:'OERK',code:airport[1]||airport[0],iata:airport[1],coords:[airport[6],airport[7]],city:airport[3]||airport[4]||'—',country:String(airport[5]||'—')};
      await a.runAuthorizedDomainCommand('facilities','create',{facility,bucket:'globalBases'},{silent:true});window.__B694_BASE__=facility.id;
      const item=GH_ASSET_CATALOG.air.used.filter(row=>Number(row.specs?.rangeKm)>=4000).sort((x,y)=>x.price-y.price)[0];window.__B694_MODEL__=item.id;
      let bought=0;while(bought<2100){const n=Math.min(1050,2100-bought);if(!await a.buyAsset('air','used',item.id,'lease',n,facility.id,true,`AUTO-${bought}`,'air'))throw new Error('purchase fixture');bought+=n;}
      await a.whenStateIdle();await GH_PERSISTENCE.drain();});
    // 1.
    let now=await look(page);assert.equal(now.idle,2100,'1: 2,100 aircraft bought, all idle');assert.equal(now.pending,true,'1: the purchase marked the company');
    // 2.
    const toastsBefore=now.toasts;
    // Review round 9 (build571 under load: a player's press during the automatic dispatch's command was refused,
    // durable-transaction-in-progress): a press made while it runs waits for it and is applied, once.
    await page.evaluate(()=>{window.__B694_PRESS__=(async()=>{for(let i=0;i<200000;i++){const m=window.__GH_APP_RUNTIME_INSTRUMENTATION__?.maintenance||{};if(m.autoDispatchRunning===true&&window.__GH_DURABLE_COMMAND_CONTEXT__)break;await new Promise(r=>setTimeout(r,1));}
      const during=!!window.__GH_DURABLE_COMMAND_CONTEXT__;try{const out=await __AUDIT__.runAuthorizedDomainCommand('corporate','set-maintenance-policy',{companyId:'air',policy:'preventive'},{silent:true});return {during,ok:true,policy:out?.result?.policy||null};}catch(error){return {during,ok:false,error:String(error?.message||error)};}})();});
    assert.equal((await nextDay(page)).closed,1,'2: the day closed');now=await look(page);
    {const press=await page.evaluate(()=>window.__B694_PRESS__);assert.equal(press.during,true,`7: the press was made while the automatic dispatch's command ran (${JSON.stringify(press)})`);
      assert.equal(press.ok,true,`7: and applied, not refused (${JSON.stringify(press)})`);assert.equal(await page.evaluate(()=>__GH_STATE__.companies?.air?.maintenancePolicy||__GH_STATE__.advanced?.companies?.air?.maintenancePolicy||null),'preventive','7: applied');assert.equal(await page.evaluate(()=>(__GH_STATE__.domainRuntime?.commands||[]).filter(r=>r.domain==='corporate'&&r.name==='set-maintenance-policy'&&r.status==='committed').length),1,'7: once (one committed command)');}
    assert.equal(now.routed,2000,`2: the first close dispatched 2,000 (${JSON.stringify(now)})`);assert.equal(now.idle,100);assert.equal(now.pending,true,'2: the mark stays, 100 are left');assert.equal(now.auto,1,'2: one alert line');
    assert.equal((await nextDay(page)).closed,1);now=await look(page);
    assert.equal(now.idle,0,`2: the second close dispatched the rest (${JSON.stringify(now)})`);assert.equal(now.pending,false,'2: and cleared the mark');assert.equal(now.auto,2,'2: a second alert line');
    // Review round 8 (a reader: the automatic dispatch minted the founder's signed intent with no press): its intents are the
    // autopilot's system decisions (actor company-autopilot, system-executed), as the autopilot's other decisions.
    const autoIntents=await page.evaluate(()=>(__GH_STATE__.domainRuntime?.commands||[]).filter(r=>r.domain==='fleet'&&r.name==='dispatch-plan-intent').map(r=>({actor:r.actor,system:r.systemAuthorized===true})));
    assert.ok(autoIntents.length>=2,`2: the automatic dispatch's intents are recorded (${JSON.stringify(autoIntents)})`);assert.ok(autoIntents.every(r=>r.actor==='company-autopilot'&&r.system),`2: each by the autopilot, not signed as the founder (${JSON.stringify(autoIntents)})`);
    // 3.
    const queued=await page.evaluate(async()=>{const seen=[];const a=__AUDIT__,s=__GH_STATE__;window.__GH_MANUAL_CALENDAR_WINDOWS__=false;a.simulationEngine.advanceTo((Math.floor(s.simSeconds/86400)+1)*86400,{speed:600,batchSeconds:3600,reason:'qa-694-quiet',maxSeconds:3*86400});
      for(let i=0;i<120000&&(a.simulationEngine.snapshot().manualAdvance||GH_TRANSACTION_CORE.isStaged(s));i++){seen.push(...GH_APP_RUNTIME_METRICS.snapshot().maintenance.pending);await new Promise(r=>setTimeout(r,2));}
      for(let i=0;i<600&&GH_APP_RUNTIME_METRICS.snapshot().maintenance.pending.length;i++){seen.push(...GH_APP_RUNTIME_METRICS.snapshot().maintenance.pending);await new Promise(r=>setTimeout(r,10));}await a.whenStateIdle();return [...new Set(seen)];});
    assert.ok(!queued.includes('auto-dispatch'),`3: a day with no mark queues no automatic dispatch (${queued})`);now=await look(page);assert.equal(now.auto,2,'3: and no alert');
    assert.equal(now.toasts,toastsBefore,'4: no notice was shown for the automatic dispatch');
    // 4. A purchase dispatched by hand at once: the next close finds none idle and clears the mark.
    const hand=await page.evaluate(async()=>{const a=__AUDIT__;if(!await a.buyAsset('air','used',window.__B694_MODEL__,'lease',1,window.__B694_BASE__,true,'AUTO-HAND','air'))throw new Error('hand purchase');const out=await a.dispatchSharedInternationalNetwork('air');await a.whenStateIdle();return {departed:out?.departed||0,pending:__GH_STATE__.advanced?.companies?.air?.autoDispatchPending===true};});
    assert.equal(hand.departed,1,'4: the button dispatches at once');{const last=await page.evaluate(()=>{const r=(__GH_STATE__.domainRuntime?.commands||[]).find(r=>r.domain==='fleet'&&r.name==='dispatch-plan-intent');return r&&{actor:r.actor,system:r.systemAuthorized===true};});assert.ok(last&&last.actor!=='company-autopilot'&&!last.system,`4: the press is the founder's own signed intent (${JSON.stringify(last)})`);}assert.equal(hand.pending,true,'4: the purchase marked the company');
    await nextDay(page);now=await look(page);assert.equal(now.idle,0);assert.equal(now.pending,false,'4: the next close found none idle and cleared the mark');assert.equal(now.auto,2,'4: with no alert');
    assert.equal(await page.evaluate(()=>(__GH_STATE__.alerts||[]).map(x=>String(x.text||x)).filter(x=>x.includes('أُلغي الأمر بالكامل')).length),0,'4: and no cancelled command (none was sent)');
    // Source: a route the engine retired on arrival marks its company; the automatic path is silent; one command a day.
    {const app=fs.readFileSync(require('node:path').join(process.env.GH_TEST_SOURCE_DIR||require('node:path').resolve(__dirname,'..'),'WebApp','app.js'),'utf8');
      assert.ok(app.includes("const route=routesById.get(routeId),routeOwner=route?routeOwnerCompanyId(route):'';if(routeOwner)setAutoDispatchPending(state,routeOwner,true);"),'source: a retired route marks its company (its owner as every route reads it, a legacy route included: review round 4)');
      assert.ok(app.includes("},{silent:options.auto===true,systemActor:options.auto===true?(window.GH_COMPANY_AUTOPILOT?.ACTOR||'company-autopilot'):null,afterCommit:()=>{lastDepartureBlocked=[];renderMap();updateKpis();reopenDrawer(navigationRevision,'routes',companyId);}});")&&app.includes("},{silent:options.auto===true,systemActor:options.auto===true?(window.GH_COMPANY_AUTOPILOT?.ACTOR||'company-autopilot'):null,afterCommit:()=>{lastDepartureBlocked=[];renderMap();updateKpis();},traceStartedAtMs:roadStartedAtMs});"),'source: both automatic dispatches are silent and dispatch as the autopilot (the road one by this source match only)');
      assert.ok(/const AUTO_DISPATCH_LIMIT=2000;/.test(app)&&(app.match(/limit:AUTO_DISPATCH_LIMIT/g)||[]).length===2,'source: at most 2,000 a company a day, air/sea and road');
      assert.ok(app.includes("if(companyRouteModes(ownerCompanyId).some(mode=>['air','sea','road'].includes(mode)))setAutoDispatchPending(draft,ownerCompanyId,true);"),'source: the purchase marks its company in its own transaction');}
    assert.deepEqual(errors,[],'5: no error');
    console.log(JSON.stringify({suite:'build694-auto-dispatch-after-close-browser',ok:true}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
