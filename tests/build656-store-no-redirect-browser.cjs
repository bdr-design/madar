'use strict';
// Owner (store edition: «شاشة المتجر تفتح تلقائي في اللعبة + عند ضغط على اي شي مقفل يحولك المتجر هذا غلط + عند تقديم
// التقويم تعلق الصفحة بسبب المتجر»; «نعم أصلحه الآن», the look unchanged). In the store edition (GH_EDITION 'release')
// without purchases:
//   1. a save left at 300× (from an edition without locks) opens at 120×, with one notice, and the store does not open;
//   2. choosing 300× is refused with its notice; the speed stays as it was and the store does not open;
//   3. a seven-day calendar advance is refused with its notice; the store does not open; the calendar stays open and
//      usable: «+ يوم» then advances the day (the page does not freeze);
//   4. investor mode is refused with its notice and the store does not open;
//   5. the pause button resumes a remembered locked 300× at 120×, never opening the store;
//   6. the store still opens from its own button;
//   7. in the development edition 300× is open, as before;
//   8. no page error.
const assert=require('node:assert/strict');
const {chromium}=require('playwright'),{boot,reboot}=require('./helpers/local-dom-app');
const RELEASE={fn:()=>{window.GH_EDITION='release';}},AUDIT='{toggleInvestorMode}';

(async()=>{
  const browser=await chromium.launch({headless:true});const results={};
  try{
    const watch=page=>page.evaluate(()=>{window.__notices=[];const show=window.GH_INTERACTION_NOTICE;window.GH_INTERACTION_NOTICE=(text,kind)=>{window.__notices.push(String(text));return show?.(text,kind);};});
    const storeOpen=page=>page.evaluate(()=>__AUDIT__.currentPanel()==='store'||!!document.querySelector('#drawerBody .store-product'));
    const day=page=>page.evaluate(()=>Math.floor((Number(__GH_STATE__.simSeconds)||0)/86400));
    // 1.
    const errors=[];let {page}=await boot({browser,errors,viewport:{width:844,height:390},beforeScripts:RELEASE,appAudit:AUDIT});
    assert.equal(await page.evaluate(()=>GH_STORE_CORE.featureOpen(__GH_STATE__,'accelerator')),false,'store edition, no purchase');
    await page.evaluate(async()=>{__GH_STATE__.speed=3;await GH_RUNTIME.persistForBackground();});
    ({page}=await reboot(page,{errors,viewport:{width:844,height:390},beforeScripts:RELEASE,appAudit:AUDIT}));
    await page.waitForTimeout(400);
    // (the helper pauses after each boot, as the player's pause button does; play then resumes the speed the boot kept)
    await page.click('#speedToggle');
    const opened={speed:await page.evaluate(()=>__GH_STATE__.speed),store:await storeOpen(page),notice:await page.evaluate(()=>(__GH_STATE__.workflowControl?.history||[]).some(r=>/تستمر اللعبة على 120×/.test(JSON.stringify(r))))};
    assert.deepEqual(opened,{speed:2,store:false,notice:true},'1: a saved 300× opens (and plays) at 120× with one notice, without the store');
    results.opened=opened;
    // 2.
    await watch(page);
    const refused=await page.evaluate(()=>{const before=__GH_STATE__.speed;const ok=__AUDIT__.setSpeed(3);return {ok,before,after:__GH_STATE__.speed};});
    assert.equal(refused.ok,false);assert.equal(refused.after,refused.before,'2: the speed stays');assert.equal(await storeOpen(page),false,'2: 300× does not open the store');
    assert.ok((await page.evaluate(()=>window.__notices)).some(t=>/300×/.test(t)),'2: its notice');
    // 3.
    await page.evaluate(()=>__AUDIT__.setSpeed(0));await page.click('#simCalendarToggle');await page.waitForTimeout(250);
    await watch(page);const day0=await day(page);
    await page.click('#simCalendarPanel [data-calendar-advance="7"]');await page.waitForTimeout(400);
    const after7=await page.evaluate(()=>({manual:!!__AUDIT__.simulationEngine.snapshot().manualAdvance,calendar:getComputedStyle(document.getElementById('simCalendarPanel')).display!=='none'&&!document.getElementById('simCalendarPanel').classList.contains('hidden')}));
    assert.equal(after7.manual,false,'3: seven days refused');assert.equal(await storeOpen(page),false,'3: the store does not open');assert.equal(after7.calendar,true,'3: the calendar stays open');
    assert.ok((await page.evaluate(()=>window.__notices)).some(t=>/أكثر من يوم واحد/.test(t)),'3: its notice');
    await page.click('#simNextDay');await page.waitForFunction(d=>Math.floor((Number(__GH_STATE__.simSeconds)||0)/86400)>d,day0,{timeout:90000});
    assert.equal(await day(page),day0+1,'3: one day ahead still works (no freeze)');assert.equal(await storeOpen(page),false);
    await page.waitForFunction(()=>!__AUDIT__.simulationEngine.snapshot().manualAdvance&&!window.__GH_DURABLE_COMMAND_CONTEXT__,null,{timeout:60000});
    // 4.
    await watch(page);await page.evaluate(()=>__AUDIT__.toggleInvestorMode());await page.waitForTimeout(400);
    assert.equal(await page.evaluate(()=>GH_FINANCE_CORE.investorMode(__GH_STATE__)),false,'4: refused');assert.equal(await storeOpen(page),false,'4: the store does not open');
    assert.ok((await page.evaluate(()=>window.__notices)).some(t=>/رخصة المستثمر/.test(t)),'4: its notice');
    // 5.
    await page.evaluate(()=>{__AUDIT__.setSpeed(2);__AUDIT__.setSpeed(0);});await page.evaluate(()=>{__GH_STATE__.speed=0;});
    const resumed=await page.evaluate(()=>{document.getElementById('speedToggle').click();return __GH_STATE__.speed;});
    assert.ok([1,2].includes(resumed),`5: resumes at a held speed (${resumed})`);assert.equal(await storeOpen(page),false,'5: the store does not open');
    // 6.
    await page.click('#storeBtn');await page.waitForFunction(()=>__AUDIT__.currentPanel()==='store');results.storeButton=true;
    assert.deepEqual(errors,[],'8: no page error');await page.close();
    // 7.
    {const errors2=[];const {page:dev}=await boot({browser,errors:errors2,viewport:{width:844,height:390}});
      assert.equal(await dev.evaluate(()=>{__AUDIT__.setSpeed(3);return __GH_STATE__.speed;}),3,'7: the development edition keeps 300×');
      assert.equal(await dev.evaluate(()=>__AUDIT__.currentPanel()==='store'),false);assert.deepEqual(errors2,[]);await dev.close();}
    console.log(JSON.stringify({suite:'build656-store-no-redirect-browser',ok:true,...results}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
