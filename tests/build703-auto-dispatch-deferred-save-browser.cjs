'use strict';
// Build 703, heaviness batch D (iPhone diagnostic DX-1794605111560: the automatic dispatch after each day's close held the
// clock 1-2.3 s a day, more than half of it its own save). The owner: «بلا حفظ مستقل» and «أوامر متعددة في اليوم».
// In the real app (local DOM, fleet worker, the in-page native vault of build371):
//   1. after the close, the idle aircraft leave in bounded commands (2,000, then the 100 left), the clock running
//      between them, the same day, or the 100 at the next close when the second command was refused (it met the player's
//      command below: a save ran meanwhile) or the run's clock budget was spent (slow frames: the first command alone
//      can hold it); each committed command is deferred: no commit of its own reaches the vault;
//   2. the run's end saves once (an ordinary save): the vault's last commit is the state's revision, and the store's
//      persistedRevision reaches it, so nothing is left pending;
//   3. a player's command during the run still saves itself before it publishes (a durable commit in the vault);
//   4. a reload from the vault (the crash case) holds the dispatched aircraft and their routes, the same money;
//   5. the background save does not coalesce away a dispatch not yet saved (source), and the publication of a deferred
//      dispatch failing asks for recovery without claiming a stored commit (source);
//   6. no error is logged.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');
// (The source checks read GH_TEST_SOURCE_DIR and the page boots from GH_AUDIT_ROOT: one source, or the gate proves nothing.)
{const real=dir=>fs.realpathSync(path.resolve(dir));assert.equal(real(process.env.GH_AUDIT_ROOT||path.join(__dirname,'..')),real(process.env.GH_TEST_SOURCE_DIR||path.join(__dirname,'..')),'the page runs the source the gate reads');}
const prior=fs.readFileSync(require.resolve('./build371-air-fleet-series-browser.cjs'),'utf8');
const installVault=new Function(prior.slice(prior.indexOf('function installVault(){'),prior.indexOf('(async()=>{'))+'\nreturn installVault;')();
const settle=page=>page.evaluate(async()=>{
  const busy=()=>{const m=window.__GH_APP_RUNTIME_INSTRUMENTATION__?.maintenance||{};return !!window.__GH_DURABLE_COMMAND_CONTEXT__||GH_PERSISTENCE.isLocked()||GH_PERSISTENCE.slicedActive?.()||m.autoDispatchRunning===true||(m.pending||[]).some(t=>t==='autopilot'||t==='auto-dispatch');};
  let calm=0;for(let i=0;i<30000&&calm<3;i++){await new Promise(r=>setTimeout(r,20));if(busy())calm=0;else if(i%10===0)calm++;}
  if(calm<3)throw new Error('auto-dispatch-did-not-settle');await __AUDIT__.whenStateIdle();await GH_PERSISTENCE.drain();});
const look=page=>page.evaluate(()=>{const s=__GH_STATE__,F=GH_FLEET_DATA;let idle=0,routed=0;for(let i=0;i<F.size(s);i++){const v=F.viewAt(s,i);if(v.ownerCompanyId!=='air'&&v.company!=='air')continue;if(v.routeId)routed++;else idle++;}
  return {idle,routed,pending:s.advanced?.companies?.air?.autoDispatchPending===true,auto:(s.alerts||[]).map(x=>String(x.text||x)).filter(x=>x.startsWith('توزيع آلي بعد إقفال اليوم')).length,revision:Number(s.saveRevision)||0,cash:Number(s.companies?.air?.cash??s.cash)||0};});
(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    const {page}=await boot({browser,errors,fleetWorker:true});page.setDefaultTimeout(900000);await page.evaluate(installVault);
    // Every commit the vault takes (its revision); the durable commands' phase records (GH_APP_RUNTIME_METRICS) name each
    // command, its revision and whether it was deferred.
    await page.evaluate(()=>{const bridge=window.webkit.messageHandlers.saveBridge,post=bridge.postMessage.bind(bridge);window.__B703__={commits:[]};
      bridge.postMessage=m=>{if(m&&m.action==='commitSave')window.__B703__.commits.push(Number(m.saveRevision)||0);return post(m);};});
    await page.evaluate(async()=>{
      const a=__AUDIT__,s=__GH_STATE__;
      if(!s.openedCompanies.includes('air'))await a.runAuthorizedDomainCommand('corporate','open-company',{type:'air',capital:400000000,legalName:'Deferred Dispatch QA'},{silent:true});
      s.godMoney=true;s.infiniteMoney=true;
      const airport=GH_WORLD_DATA.airports.find(row=>row[0]==='OERK'),facility={id:'AUTO-D1',name:'Auto Riyadh',kind:'airport-base',company:'air',ownerCompanyId:'air',owned:true,sourceKey:'air:OERK',icao:'OERK',code:airport[1]||airport[0],iata:airport[1],coords:[airport[6],airport[7]],city:airport[3]||airport[4]||'—',country:String(airport[5]||'—')};
      await a.runAuthorizedDomainCommand('facilities','create',{facility,bucket:'globalBases'},{silent:true});
      const item=GH_ASSET_CATALOG.air.used.filter(row=>Number(row.specs?.rangeKm)>=4000).sort((x,y)=>x.price-y.price)[0];
      let bought=0;while(bought<2100){const n=Math.min(1050,2100-bought);if(!await a.buyAsset('air','used',item.id,'lease',n,facility.id,true,`AUTO-${bought}`,'air'))throw new Error('purchase fixture');bought+=n;}
      await a.whenStateIdle();await GH_PERSISTENCE.drain();});
    let now=await look(page);assert.equal(now.idle,2100);assert.equal(now.pending,true,'the purchase marked the company');
    // A player's command made while an automatic command runs (it waits and saves itself).
    await page.evaluate(()=>{window.__B703_PRESS__=(async()=>{for(let i=0;i<300000;i++){const m=window.__GH_APP_RUNTIME_INSTRUMENTATION__?.maintenance||{};if(m.autoDispatchRunning===true&&window.__GH_DURABLE_COMMAND_CONTEXT__)break;await new Promise(r=>setTimeout(r,1));}
      const out=await __AUDIT__.runAuthorizedDomainCommand('corporate','set-maintenance-policy',{companyId:'air',policy:'preventive'},{silent:true});return {ok:!!out,revision:Number(__GH_STATE__.saveRevision)||0};})();});
    const before=await page.evaluate(()=>({commits:window.__B703__.commits.length}));
    await page.evaluate(async()=>{const a=__AUDIT__,s=__GH_STATE__;window.__GH_MANUAL_CALENDAR_WINDOWS__=false;a.simulationEngine.advanceTo((Math.floor(s.simSeconds/86400)+1)*86400,{speed:600,batchSeconds:3600,reason:'qa-703',maxSeconds:3*86400});
      for(let i=0;i<120000&&(a.simulationEngine.snapshot().manualAdvance||GH_TRANSACTION_CORE.isStaged(s));i++)await new Promise(r=>setTimeout(r,2));});
    await settle(page);now=await look(page);
    // (The 100 left at the next close: the reason is a refusal of the second command or the run's spent budget.)
    let nextClose=false;
    if(now.routed===2000&&now.pending){nextClose=true;const why=await page.evaluate(()=>{const rows=(window.__GH_APP_RUNTIME_INSTRUMENTATION__?.durable?.samples||[]).filter(t=>/bulk-shared-departure:air$/.test(t.name));const run=window.__GH_APP_RUNTIME_INSTRUMENTATION__?.maintenance?.lastAutoDispatch,row=(run?.companies||[]).find(c=>c.companyId==='air')||null;return {refused:rows.filter(t=>!t.committed).length,stoppedBy:row?.stoppedBy||null,row};});
      // (The app's own rule, recorded by the run: it stopped on its clock budget, or the second command was refused for a
      // save that ran meanwhile or answered a busy worker; never a failure.)
      assert.ok(why.row&&!why.row.failed&&(why.stoppedBy==='run-clock-budget'||why.row.saveRefusals>0||why.row.raised>0),`1: the 100 waited for a reason (${JSON.stringify(why)})`);
      await page.evaluate(async()=>{const a=__AUDIT__,s=__GH_STATE__;a.simulationEngine.advanceTo((Math.floor(s.simSeconds/86400)+1)*86400,{speed:600,batchSeconds:3600,reason:'qa-703-next',maxSeconds:3*86400});
        for(let i=0;i<120000&&(a.simulationEngine.snapshot().manualAdvance||GH_TRANSACTION_CORE.isStaged(s));i++)await new Promise(r=>setTimeout(r,2));});
      await settle(page);now=await look(page);}
    const seen=await page.evaluate(()=>({...window.__B703__,samples:(window.__GH_APP_RUNTIME_INSTRUMENTATION__?.durable?.samples||[]).map(t=>({name:t.name,deferred:t.deferred===true,committed:t.committed===true,revision:t.saveRevision,persistMs:t.persistMs}))})),press=await page.evaluate(()=>window.__B703_PRESS__);
    // 1.
    assert.equal(now.routed,2100,`1: all 2,100 dispatched (${JSON.stringify(now)}, next close: ${nextClose})`);assert.equal(now.pending,false,'1: and cleared the mark');
    const dispatches=seen.samples.filter(row=>/bulk-shared-departure:air$/.test(row.name)&&row.committed);
    assert.equal(dispatches.length,2,`1: in two bounded commands (2,000, then the 100 left) (${JSON.stringify(seen.samples)})`);assert.equal(now.auto,2,'1: one alert line each');
    assert.ok(dispatches.every(row=>row.committed&&row.deferred&&row.persistMs<1),`1: each published without a save of its own (${JSON.stringify(dispatches)})`);
    for(const row of dispatches)assert.ok(!seen.commits.includes(row.revision),`1: the vault never took the dispatch's own revision ${row.revision} (${JSON.stringify(seen.commits)})`);
    // 2.
    const persisted=await page.evaluate(()=>GH_PERSISTENCE.persistedRevision());
    assert.equal(persisted.saveRevision,now.revision,`2: the run's end saved the state (${JSON.stringify({persisted,now})})`);assert.equal(seen.commits.at(-1),now.revision,'2: the vault\'s last commit is the state\'s revision');
    assert.ok(Math.max(...dispatches.map(row=>row.revision))<now.revision,'2: after both dispatches');
    // 3.
    assert.equal(press.ok,true,'3: the press was applied');
    assert.ok(seen.commits.includes(press.revision),`3: and saved itself before publishing (${JSON.stringify({press,commits:seen.commits})})`);
    assert.ok(seen.commits.length>before.commits,'3: the vault took commits during the run');
    // 4. The crash case: the vault's last save holds the dispatched fleet, its routes and the same cash.
    const reloaded=await page.evaluate(()=>{const json=window.__VAULT__.saves.at(-1),raw=JSON.parse(json);const ids=JSON.stringify(raw.customRoutes||null).match(/[a-z0-9]+\.t\.[a-z0-9]+/g)||[],text=ids.map(id=>new TextDecoder().decode(window.__VAULT__.chunks.get(id)||new Uint8Array())).join(''),live=(__GH_STATE__.customRoutes||[]).map(route=>String(route.id));return {revision:Number(raw.saveRevision)||0,liveRoutes:live.length,savedRoutes:live.filter(id=>text.includes(JSON.stringify(id))).length,alerts:(raw.alerts||[]).map(x=>String(x.text||x)).filter(x=>x.startsWith('توزيع آلي بعد إقفال اليوم')).length,pending:raw.advanced?.companies?.air?.autoDispatchPending===true};});
    assert.equal(reloaded.revision,now.revision,'4: the last save is the live revision');assert.equal(reloaded.alerts,2,'4: it holds both dispatches');assert.equal(reloaded.pending,false,'4: and the cleared mark');
    assert.ok(reloaded.liveRoutes>0&&reloaded.savedRoutes===reloaded.liveRoutes,`4: and every route they opened (${JSON.stringify(reloaded)})`);
    // 5. Source.
    {const app=fs.readFileSync(path.join(process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..'),'WebApp','app.js'),'utf8');
      assert.ok(app.includes("if(waitedForLifecycle&&!deferredSavePending()&&(durabilityEstablished||"),'5: the background save never coalesces away a dispatch not yet saved');
      assert.ok(app.includes("if(settled.some(row=>row?.committed===true&&row?.durable!==false))durabilityEstablished=true;"),'5: a deferred command establishes no durability');
      assert.ok(app.includes("if(committed&&deferred){window.GH_PERSISTENCE.markRecoveryRequired('deferred-dispatch-publish-failed',{durableCommitted:false,"),'5: a deferred publication failure asks for recovery, claiming no stored commit');
      assert.ok(app.includes("if(deferred&&window.GH_PERSISTENCE.isLocked()){deferredRefusals++;throw new Error(`${name}-deferred-persistence-locked`);}"),'5: a deferred commit is refused when persistence locked meanwhile (a transient refusal)');
      assert.ok(app.includes('&&window.GH_PERSISTENCE.nearSizeLimit?.()!==true;'),'5: never deferred near the save size limit (only commitDurableState checks it)');
      assert.ok(app.includes('if(document.hidden)durableCommandSettlement.then(()=>scheduleSimulationPersistence()).catch(()=>{});'),'5: hidden at the end: the save is asked for once the command has settled');
      assert.ok(app.includes("const deferred=deferPersist===true&&!!systemActor&&!document.hidden&&"),'5: only the autopilot, never while hidden');
      assert.equal((app.match(/deferPersist:options\.auto===true,/g)||[]).length,2,'5: air/sea and road automatic dispatches only');}
    // 7. Post-review: an ordinary save that runs during a deferred command (a native dirty flush) takes the revision for
    // the state before it; the command is refused (rolled back), the mark stays, the next close sends the rest, and every
    // dispatch the live game holds is in the vault's last save (no two contents under one revision).
    {const close=()=>page.evaluate(async()=>{const a=__AUDIT__,s=__GH_STATE__;window.__GH_MANUAL_CALENDAR_WINDOWS__=false;a.simulationEngine.advanceTo((Math.floor(s.simSeconds/86400)+1)*86400,{speed:600,batchSeconds:3600,reason:'qa-703b',maxSeconds:3*86400});for(let i=0;i<120000&&(a.simulationEngine.snapshot().manualAdvance||GH_TRANSACTION_CORE.isStaged(s));i++)await new Promise(r=>setTimeout(r,2));});
      await page.evaluate(async()=>{const a=__AUDIT__,item=GH_ASSET_CATALOG.air.used.filter(row=>Number(row.specs?.rangeKm)>=4000).sort((x,y)=>x.price-y.price)[0];let bought=0;while(bought<2100){const n=Math.min(1050,2100-bought);if(!await a.buyAsset('air','used',item.id,'lease',n,'AUTO-D1',true,`AUTO-B-${bought}`,'air'))throw new Error('purchase fixture 2');bought+=n;}await a.whenStateIdle();await GH_PERSISTENCE.drain();
        // (The save is made at the command's baseline integrity check of the live state: after it took the revision and
        // before its apply and refusal check, whatever the frame rate.)
        window.__B703_INJ__={done:null};window.__B703_OLD__=new Set(window.__GH_APP_RUNTIME_INSTRUMENTATION__?.durable?.samples||[]);const seen=new Set(),I=window.GH_INTEGRITY_CORE,check=I.check.bind(I);
        window.GH_INTEGRITY_CORE=Object.freeze({...I,check:target=>{const c=window.__GH_DURABLE_COMMAND_CONTEXT__;if(!window.__B703_INJ__.done&&c&&c.draft&&target===c.liveState&&/bulk-shared-departure:air$/.test(c.name)){seen.add(c.draft);if(seen.size>=1){const out=GH_PERSISTENCE.commitState(__GH_STATE__,{storageKey:'global-holdings-world-v3.0.0'});(window.__B703_INJ__.tries=window.__B703_INJ__.tries||[]).push({size:seen.size,ok:out?.ok,reason:out?.reason||out?.error||null});if(out?.ok===true)window.__B703_INJ__.done={ok:true,revision:Number(__GH_STATE__.saveRevision)};}}return check(target);}});});
      // (With slow frames the second command can come at the next close: up to three closes until it meets the save.)
      let inj=null,metRow=null;for(let k=0;k<3&&!inj;k++){await close();await settle(page);({inj,metRow}=await page.evaluate(()=>({inj:window.__B703_INJ__.done,metRow:(window.__GH_APP_RUNTIME_INSTRUMENTATION__?.maintenance?.lastAutoDispatch?.companies||[]).find(c=>c.companyId==='air')||null})));}let after=await look(page);
      // (Where no ordinary save could run during the run at all, every attempt refused for the fleet's validation evidence not
      // being ready yet (a CPU throttled 4x), the collision cannot happen: what remains to prove is that every dispatch is in
      // the last save.)
      const tries=await page.evaluate(()=>window.__B703_INJ__.tries||[]),formed=!!(inj&&inj.ok);
      // (Judged on what was observed, not on the run's settings: a slow runner can be as slow as a throttled one.)
      if(!formed){assert.ok(tries.length>0&&tries.every(row=>/validation-unavailable/.test(String(row.reason))),`7: a save ran during a deferred command, or none could run at all (${JSON.stringify({inj,tries})})`);}console.log(JSON.stringify({check:7,formed,tries:tries.length}));
      const samples7=await page.evaluate(()=>(window.__GH_APP_RUNTIME_INSTRUMENTATION__?.durable?.samples||[]).filter(t=>!window.__B703_OLD__.has(t)&&/bulk-shared-departure:air$/.test(t.name)).map(t=>({committed:t.committed,revision:t.saveRevision,deferred:t.deferred,ms:Math.round(t.totalMs)})));const refused=samples7.some(t=>t.committed===false);if(formed)assert.ok(metRow&&metRow.saveRefusals>0&&!metRow.failed,`7: the run that met the save counted it as a save collision, not a failure (${JSON.stringify(metRow)})`);if(formed)assert.ok(refused,`7: that command was refused (rolled back), not published under the saved revision (${JSON.stringify({inj,samples7})})`);
      for(let k=0;k<3&&after.idle>0;k++){assert.equal(after.pending,true,'7: the mark stays for what is left');await close();await settle(page);after=await look(page);}
      assert.equal(after.idle,0,`7: the next close sent the rest (${JSON.stringify(after)})`);
      const last=await page.evaluate(()=>{const raw=JSON.parse(window.__VAULT__.saves.at(-1));return {revision:Number(raw.saveRevision)||0,auto:(raw.alerts||[]).map(x=>String(x.text||x)).filter(x=>x.startsWith('توزيع آلي بعد إقفال اليوم')).length};});
      assert.equal(last.revision,after.revision,'7: the last save is the live revision');assert.equal(last.auto,after.auto,`7: and holds every dispatch the game holds (${JSON.stringify({last,after})})`);
      assert.equal((await page.evaluate(()=>GH_PERSISTENCE.persistedRevision())).saveRevision,after.revision,'7: nothing pending');}
    assert.deepEqual(errors,[],'6: no error');
    console.log(JSON.stringify({nextClose,suite:'build703-auto-dispatch-deferred-save-browser',ok:true,commands:dispatches.length,commits:seen.commits.length}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
