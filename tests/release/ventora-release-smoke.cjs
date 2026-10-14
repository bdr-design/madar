'use strict';
// VENTORA release smoke: the shipped (minified) WebApp, run as the release edition with no test hooks injected into
// app.js. The group is founded through the founding screen, days pass through the calendar, every rail section and its
// tiles open, the developer pages stay hidden, and «وضع المستثمر الحر» switches on and off. No page error is allowed.
// Usage: node tests/release/ventora-release-smoke.cjs <root with the transformed WebApp>
const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require('playwright'),{boot}=require('../helpers/local-dom-app');
const root=path.resolve(process.argv[2]||path.join(__dirname,'../..'));

(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    const {page}=await boot({browser,errors,root,noAudit:true,beforeScripts:{fn:()=>{window.GH_EDITION='release';},arg:null}});
    page.setDefaultTimeout(60000);page.on('dialog',dialog=>dialog.accept());
    assert.equal(await page.evaluate(()=>__GH_STATE__.onboardingComplete),true,'the group is founded');
    assert.equal(await page.evaluate(()=>__GH_STATE__.profile.name),'فنتورا القابضة');
    await page.click('#simCalendarToggle');
    for(let i=0;i<3;i++){const before=await page.evaluate(()=>__GH_STATE__.simSeconds);await page.click('#simNextDay');await page.waitForFunction(b=>__GH_STATE__.simSeconds>=b+86400&&!GH_SIM_KERNEL.snapshot().manualAdvance,before);}
    await page.click('#simCalendarToggle');
    const rail=await page.evaluate(()=>[...document.querySelectorAll('[data-nav]')].map(b=>b.dataset.nav).filter(Boolean));
    let opened=0;
    for(const nav of rail){
      const button=page.locator(`[data-nav="${nav}"]`).first();if(!(await button.isVisible().catch(()=>false)))continue;await button.click();await page.waitForTimeout(150);opened++;
      const tiles=await page.evaluate(()=>[...document.querySelectorAll('#drawerBody [data-go]')].map(b=>b.dataset.go));
      for(const tool of ['updates','diagnostics','controlPlane'])assert.ok(!tiles.includes(tool),`${nav}: ${tool} is hidden`);
      for(const go of tiles.slice(0,8)){const tile=page.locator(`#drawerBody [data-go="${go}"]`).first();if(await tile.isVisible().catch(()=>false)){await tile.click();await page.waitForTimeout(120);opened++;await button.click();await page.waitForTimeout(80);}}
    }
    assert.ok(opened>=8,`pages opened: ${opened}`);
    await page.click('#settingsBtn');await page.locator('#drawerBody [data-go="investorMode"]').first().click();
    await page.locator('#drawerBody .god-mode-toggle').click();await page.waitForFunction(()=>__GH_STATE__.godMoney===true);
    await page.locator('#drawerBody .god-mode-toggle').click();await page.waitForFunction(()=>__GH_STATE__.godMoney===false);
    assert.deepEqual(errors,[],'no page error');
    console.log('VENTORA_RELEASE_SMOKE_PASS',JSON.stringify({root:path.basename(root),pages:opened}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
