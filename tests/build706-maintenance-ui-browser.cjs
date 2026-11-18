'use strict';
// Build 706, batch F (owner, 17 Nov 2026), the real app (local DOM):
//   1. «يحتاج صيانة» counts the assets under the company's own maintenance line (standard 80, then preventive 90 after
//      the policy is changed in the maintenance panel), not under a fixed 85;
//   2. «إصلاح الكل الآن»: the confirm names the count and the total; cancel sends nothing; accept repairs every asset
//      under the line at the close's price (the cash change is the total of each asset's quote), one signed command;
//   3. the manual service asks first with the close's quote, and charges exactly it;
//   4. an asset isolated while moving shows «إعادة إلى القاعدة» and an enabled service button; returning it parks it at
//      its base, keeps the fault and charges nothing;
//   2b. the clock running, the simulation is held while the repair-all confirm is open (a moving asset's quote would
//      change every tick), and runs again after;
//   6. the «تحتاج صيانة» list filter follows the line too (rebuilt on the policy change), and a bill-only maintenance
//      notice stays in the alerts list while one with an accident shows on the strip;
//   2c. accepted with the clock running and a quoted asset wearing on every tick: nothing wears (the hold lasts through
//      the commit) and the quote is the charge;
//   4b. servicing an asset isolated while moving asks first, even at no cost (cancel changes nothing);
//   5. no error is logged.
const assert=require('node:assert/strict'),{chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');
(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    const {page}=await boot({browser,errors,appAudit:"{purchaseHolds:()=>assetPurchaseHolds,needsService:()=>{const core=window.GH_FLEET_UI_SUMMARY;return core.lookup(core.compute(state,window.GH_FLEET_DATA,fleetUiSummaryOptions(getDynamicFacilities()))).owner('air')?.needsService??null;},renderAssetManage,returnAssetToBase,listService:()=>fleetListQueryEngine.query(state,{owner:'air',status:'service'}).length,automaticAlert}"});page.setDefaultTimeout(120000);
    const ids=await page.evaluate(async()=>{
      const a=__AUDIT__,s=()=>__GH_STATE__,d=GH_COMPANY_PLATFORM.definitionFor(s(),'air');s().speed=0;s().godMoney=true;s().infiniteMoney=true;
      await a.runAuthorizedDomainCommand('corporate','open-company',{type:'air',companyId:'air',capital:Math.max(2e9,d.founding.minimumCapital),legalName:'QA Air 706',formationContract:'QA-AIR-706'},{silent:true});
      const port=GH_WORLD_DATA.airports.find(row=>row[0]==='OERK'),names=new Intl.DisplayNames(['ar'],{type:'region'});
      await a.runAuthorizedDomainCommand('facilities','create',{facility:{id:'QA706-OERK',name:'QA 706',kind:'airport-base',company:'air',ownerCompanyId:'air',owned:true,sourceKey:'air:OERK',code:port[1]||port[0],icao:port[0],iata:port[1],city:port[3]||port[4]||'—',country:names.of(port[5]),coords:[port[6],port[7]],deliveryCapacity:100},bucket:'globalBases'},{silent:true});
      const model=[...GH_ASSET_CATALOG.air.used].sort((x,y)=>(x.leaseMonthly||0)-(y.leaseMonthly||0)||x.price-y.price)[0];
      if(!await a.buyAsset('air','used',model.id,'lease',30,'QA706-OERK',true,'QA706-BUY','air'))throw new Error('purchase fixture');await a.whenStateIdle();
      const list=[];GH_FLEET_DATA.scan(s(),['id','ownerCompanyId'],row=>{if(row.ownerCompanyId==='air')list.push(row.id);});
      // 10 at 70%, 10 at 85%, 10 at 100% (the fixture writes the live fleet directly, the game paused).
      list.forEach((id,i)=>GH_FLEET_DATA.update(s(),id,{condition:i<10?70:i<20?85:100}));delete s().godMoney;delete s().infiniteMoney;GH_FINANCE_CORE.book(s(),'air').accounts[0].balance=5e9;
      await a.whenStateIdle();await GH_PERSISTENCE.drain();return list;});
    assert.equal(ids.length,30,'fixture');
    // 1.
    assert.equal(await page.evaluate(()=>__AUDIT__.needsService()),10,'1: standard (80): the ten at 70%');
    const cash=()=>page.evaluate(()=>GH_FINANCE_CORE.operating(__GH_STATE__,'air')),settle=()=>page.evaluate(()=>__AUDIT__.whenStateIdle());
    const open=async(panel,arg)=>{await page.evaluate(([p,a])=>__AUDIT__.openDrawer(p,a),[panel,arg]);await page.waitForFunction(p=>document.getElementById('drawer').dataset.panel===p,panel);};
    const dialogText=()=>page.evaluate(()=>{const accept=document.querySelector('[data-confirm="accept"]');return accept?accept.closest('dialog').textContent.replace(/[⁦-⁩‎‏]/g,'').replace(/\s+/g,' '):null;});
    const accept=async()=>{await page.locator('[data-confirm="accept"]:not([disabled])').click();await page.waitForFunction(()=>!document.querySelector('[data-confirm="accept"]'));};
    const cancel=async()=>{await page.locator('[data-confirm="cancel"]').click();await page.waitForFunction(()=>!document.querySelector('[data-confirm="accept"]'));};
    await open('maintenance','air');
    await page.evaluate(()=>{const card=document.querySelector('.maintenance-save[data-company="air"]').closest('.maintenance-card');card.querySelector('[data-maintenance-policy]').value='preventive';});
    await page.locator('.maintenance-save[data-company="air"]').click();await page.waitForFunction(()=>__GH_STATE__.advanced?.companies?.air?.maintenancePolicy==='preventive');await settle();
    assert.equal(await page.evaluate(()=>__AUDIT__.needsService()),20,'1: preventive (90): the twenty at 70% and 85%');
    assert.equal(await page.evaluate(()=>__AUDIT__.listService()),20,'6: the list filter follows the new line');
    // 2.
    const quote=await page.evaluate(list=>list.slice(0,20).reduce((sum,id)=>sum+GH_REALISM.maintenanceQuote(GH_FLEET_DATA.get(__GH_STATE__,id)),0),ids);
    await open('maintenance','air');const commandsBefore=await page.evaluate(()=>(GH_APP_RUNTIME_METRICS.snapshot().durable?.samples||[]).length);
    await page.evaluate(()=>{__GH_STATE__.speed=1;});await page.locator('.repair-all-now[data-company="air"]').click();await page.waitForSelector('[data-confirm="accept"]');let text=await dialogText();
    {const t0=await page.evaluate(()=>__GH_STATE__.simSeconds);await page.waitForTimeout(1500);assert.equal(await page.evaluate(()=>__GH_STATE__.simSeconds),t0,'2b: held while the confirm is open');}
    assert.match(text,/20/,`2: the confirm names the count (${text})`);assert.match(text,/90%/,'2: and the line');
    let before=await cash();await cancel();await settle();assert.equal(await cash(),before,'2: cancel sends nothing');
    {const t1=await page.evaluate(()=>__GH_STATE__.simSeconds);await page.waitForFunction(t=>__GH_STATE__.simSeconds>t,t1,{timeout:20000});await page.evaluate(()=>{__GH_STATE__.speed=0;});await settle();}assert.equal(await page.evaluate(()=>__AUDIT__.needsService()),20);
    // 2c. Accepted with the clock running: a hook wears a quoted asset whenever the game time moves (as a moving asset
    //     does). The hold lasts from the quote through the commit, so nothing wears and the quote is the charge.
    await open('maintenance','air');await page.evaluate(id=>{let last=__GH_STATE__.simSeconds;window.__WEAR706__={ticks:0,timer:setInterval(()=>{const now=__GH_STATE__.simSeconds;if(now===last)return;last=now;window.__WEAR706__.ticks++;const a=GH_FLEET_DATA.get(__GH_STATE__,id);if(a&&a.condition<100)GH_FLEET_DATA.update(__GH_STATE__,id,{condition:a.condition-.5});},5)};__GH_STATE__.speed=1;},ids[0]);
    await page.locator('.repair-all-now[data-company="air"]').click();await page.waitForSelector('[data-confirm="accept"]');await page.waitForTimeout(1500);
    // (The game stays held from the quote until the command is published: the first frame without the hold finds the
    //  repair done, no durable command in progress and the save revision moved on.)
    await page.evaluate(list=>{const done=()=>list.slice(0,20).every(id=>GH_FLEET_DATA.get(__GH_STATE__,id).condition===100);window.__HOLD706__={frames:0,end:null,rev0:Number(__GH_STATE__.saveRevision)||0};const loop=()=>{if(__AUDIT__.purchaseHolds()<1){window.__HOLD706__.end={done:done(),inCommand:!!window.__GH_DURABLE_COMMAND_CONTEXT__,rev:Number(__GH_STATE__.saveRevision)||0};return;}window.__HOLD706__.frames++;requestAnimationFrame(loop);};requestAnimationFrame(loop);},ids);
    await accept();
    await page.waitForFunction(()=>window.__HOLD706__.end,null,{timeout:30000}).catch(()=>{throw new Error('2c: the hold was never released');});
    {const hold=await page.evaluate(()=>window.__HOLD706__);assert.ok(hold.end.done&&!hold.end.inCommand&&hold.end.rev>hold.rev0,`2c: held until the repair was published (${JSON.stringify(hold)})`);}
    await page.waitForFunction(list=>list.slice(0,20).every(id=>GH_FLEET_DATA.get(__GH_STATE__,id).condition===100),ids,{timeout:30000}).catch(()=>{throw new Error('2c: the repair did not commit (a quote gone stale while unheld?)');});
    // (Slow frames: the commit's save first, then the clock moves; as 2b, up to 20 s.)
    {await settle();await page.waitForFunction(()=>window.__WEAR706__.ticks>0,null,{timeout:20000}).catch(()=>{throw new Error('2c: the clock did not run again after the commit');});await page.evaluate(()=>{clearInterval(window.__WEAR706__.timer);__GH_STATE__.speed=0;});}
    await settle();
    assert.equal(before-await cash(),quote,'2: the cash change is the total of each asset\'s quote');assert.equal(await page.evaluate(()=>__AUDIT__.needsService()),0,'2: nothing left under the line');
    const repairs=await page.evaluate(n=>(GH_APP_RUNTIME_METRICS.snapshot().durable?.samples||[]).slice(n).filter(t=>/repair-all:air/.test(t.name)&&t.committed).length,commandsBefore);assert.equal(repairs,1,'2: one committed signed command');
    // 3.
    const target=ids[25];await page.evaluate(id=>GH_FLEET_DATA.update(__GH_STATE__,id,{condition:76}),target);await settle();
    const one=await page.evaluate(id=>GH_REALISM.maintenanceQuote(GH_FLEET_DATA.get(__GH_STATE__,id)),target);
    await open('assetManage',target);await page.locator(`.service-asset[data-id="${target}"]`).click();await page.waitForSelector('[data-confirm="accept"]');text=await dialogText();
    assert.ok(text.includes('76.0%'),`3: the confirm states the condition (${text})`);before=await cash();await accept();
    await page.waitForFunction(id=>GH_FLEET_DATA.get(__GH_STATE__,id).condition===100,target);await settle();assert.equal(before-await cash(),one,'3: the service charges the close\'s quote');
    // 4b. Servicing an asset isolated while moving asks first (it returns to its base and its trip is cancelled), even at
    //     no cost: cancel changes nothing; accept clears the fault, parks it and charges nothing (100%).
    {const moving=ids[28];await page.evaluate(id=>GH_FLEET_DATA.update(__GH_STATE__,id,{phase:'moving',simulationFault:{code:'QA_706B',detail:'qa'}}),moving);await settle();
      const asked=()=>page.waitForSelector('[data-confirm="accept"]',{timeout:15000}).catch(()=>{throw new Error('4b: no confirm before servicing an asset isolated while moving');});
      await open('assetManage',moving);await page.locator(`.service-asset[data-id="${moving}"]`).click();await asked();text=await dialogText();
      assert.ok(text.includes('يعود الأصل إلى قاعدة انطلاقه'),`4b: the confirm says it returns to its base (${text})`);before=await cash();await cancel();await settle();
      let row=await page.evaluate(id=>{const a=GH_FLEET_DATA.get(__GH_STATE__,id);return {phase:a.phase,fault:!!a.simulationFault};},moving);assert.deepEqual(row,{phase:'moving',fault:true},'4b: cancel changes nothing');assert.equal(await cash(),before,'4b: and charges nothing');
      await open('assetManage',moving);await page.locator(`.service-asset[data-id="${moving}"]`).click();await asked();await accept();
      await page.waitForFunction(id=>!GH_FLEET_DATA.get(__GH_STATE__,id).simulationFault,moving);await settle();
      row=await page.evaluate(id=>{const a=GH_FLEET_DATA.get(__GH_STATE__,id);return {moving:a.phase==='moving',base:a.baseFacility,condition:a.condition};},moving);
      assert.deepEqual(row,{moving:false,base:'QA706-OERK',condition:100},'4b: serviced back at its base');assert.equal(await cash(),before,'4b: at 100% it charges nothing');}
    // 4.
    const isolated=ids[29];
    const html=await page.evaluate(id=>{GH_FLEET_DATA.update(__GH_STATE__,id,{phase:'moving',simulationFault:{code:'QA_706',detail:'qa'}});return __AUDIT__.renderAssetManage(id);},isolated);
    assert.ok(html.includes('class="secondary-btn return-to-base"'),'4: the return-to-base button');assert.ok(/class="secondary-btn service-asset" data-id="[^"]+" >/.test(html),'4: the service button is enabled');
    before=await cash();const back=await page.evaluate(id=>__AUDIT__.returnAssetToBase(id),isolated);await settle();
    const row=await page.evaluate(id=>{const a=GH_FLEET_DATA.get(__GH_STATE__,id);return {phase:a.phase,fault:!!a.simulationFault,base:a.baseFacility};},isolated);
    assert.equal(back,true);assert.equal(row.phase,'idle','4: parked (no route: idle)');assert.equal(row.fault,true,'4: the fault stays');assert.equal(row.base,'QA706-OERK');assert.equal(await cash(),before,'4: free');
    assert.deepEqual(await page.evaluate(()=>[__AUDIT__.automaticAlert('صيانة QA · اليوم 3: فحص 20 أصول بفاتورة $1.3M تُستحق بعد 7 أيام.'),__AUDIT__.automaticAlert('صيانة QA · اليوم 3: حادث واحد بأضرار $8.3M تُفوتر خلال 7 أيام، بلا تعويض تأمين.')]),[true,false],'6: bill-only notice in the list; an accident on the strip');
    assert.deepEqual(errors,[],'5: no error');
    console.log(JSON.stringify({suite:'build706-maintenance-ui-browser',ok:true,quote,one}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
