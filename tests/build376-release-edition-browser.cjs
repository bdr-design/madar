'use strict';
// Build 376 (owner: the game is VENTORA; the release edition shows the player no developer tools). The iPhone app's
// release build sets GH_EDITION='release': the system section lists no updates, game-health or control pages (a link
// to one opens the settings), the settings carry no update card and no safety-period choices but offer a problem
// report, and the unlimited-money mode lives on its own page, «وضع المستثمر الحر», opened by the investor licence from the
// store. The development edition keeps its
// tools. The default group is «أصول ونفوذ القابضة» (ASSETS & INFLUENCE, owner: «غير مايلزم باللعبة كامله») and its companies carry the new
// name; a save of an older name (فنتورا القابضة, المجموعة العالمية القابضة) takes it on load.
const assert=require('node:assert/strict');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');

(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    const {page}=await boot({browser,errors});page.setDefaultTimeout(60000);page.on('dialog',dialog=>dialog.accept());
    const tiles=()=>page.evaluate(()=>[...document.querySelectorAll('#drawerBody [data-go]')].map(b=>b.dataset.go));
    const open=(panel,arg)=>page.evaluate(([p,a])=>__AUDIT__.openDrawer(p,a),[panel,arg]);
    const body=()=>page.locator('#drawerBody').textContent();

    // The new name.
    assert.equal(await page.title(),'أصول ونفوذ · ASSETS & INFLUENCE');
    assert.equal(await page.evaluate(()=>__GH_STATE__.profile.name),'أصول ونفوذ القابضة');
    assert.equal(await page.evaluate(()=>GH_COMPANY_PLATFORM.resolveIdentity(__GH_STATE__,'air').legalName),'شركة أصول ونفوذ للطيران');
    // A save of the old name takes the new one.
    assert.equal(await page.evaluate(()=>{const s=structuredClone(__GH_STATE__);s.profile.name='المجموعة العالمية القابضة';s.profile.shortName='GH';return GH_COMPANY_PLATFORM.migrateState(s).state.profile.name;}),'أصول ونفوذ القابضة');
    assert.equal(await page.evaluate(()=>{const s=structuredClone(__GH_STATE__);s.profile.name='فنتورا القابضة';s.profile.shortName='VH';const p=GH_COMPANY_PLATFORM.migrateState(s).state.profile;return `${p.name}|${p.shortName}`;}),'أصول ونفوذ القابضة|ANI');

    // Development edition: the tools are listed.
    await open('systemHub');let listed=await tiles();
    for(const page of ['settings','investorMode','updates','diagnostics','controlPlane'])assert.ok(listed.includes(page),`development lists ${page}`);

    // Release edition.
    await page.evaluate(()=>{window.GH_EDITION='release';});
    await open('systemHub');listed=await tiles();
    assert.ok(listed.includes('settings')&&listed.includes('investorMode'),'the settings and the investor mode stay');
    for(const tool of ['updates','diagnostics','controlPlane'])assert.ok(!listed.includes(tool),`release hides ${tool}`);
    await open('diagnostics');assert.equal(await page.locator('#drawerTitle').textContent(),'الحفظ والإعدادات','a developer page opens the settings');
    const settings=await body();
    assert.doesNotMatch(settings,/تحديثات (?:أصول ونفوذ|VENTORA)|ملف تحديث|عند الخروج فقط|مدة الأمان|God Mode|وضع التجربة/);
    assert.equal(await page.locator('#drawerBody .save-cap-choices').count(),0);assert.equal(await page.locator('#drawerBody .save-now-btn').count(),1);
    assert.equal(await page.locator('#drawerBody [data-gh-action="report-problem"]').count(),1,'the problem report stays');
    assert.equal(await page.locator('#drawerBody .investor-mode-toggle').count(),0,'the money mode left the settings');

    // «وضع المستثمر الحر» on its own page.
    await open('investorMode');assert.match(await body(),/وضع المستثمر الحر/);
    // In the store edition the mode is the investor licence's (GH_STORE_CORE): refused, the store page opens; once the
    // licence is delivered (the store bridge's verified transaction) it switches on and off as before.
    await page.locator('#drawerBody .investor-mode-toggle').click();await page.waitForFunction(()=>document.querySelector('#drawerBody .store-product'));
    assert.equal(await page.evaluate(()=>__GH_STATE__.godMoney===true),false,'investor mode needs its licence in the store edition');
    await page.evaluate(()=>GH_STORE_NATIVE.onTransaction({transactionId:'B376-1',productId:'com.ventora.b376.investor.licence'}));await page.waitForFunction(()=>__GH_STATE__.purchases?.entitlements?.investor&&!window.__GH_DURABLE_COMMAND_CONTEXT__);
    await open('investorMode');
    await page.locator('#drawerBody .investor-mode-toggle').click();await page.waitForFunction(()=>__GH_STATE__.godMoney===true&&__GH_STATE__.infiniteMoney===true);
    await page.waitForFunction(()=>document.querySelector('#drawerBody .investor-mode-toggle')?.textContent.includes('إيقاف'));
    await page.locator('#drawerBody .investor-mode-toggle').click();await page.waitForFunction(()=>__GH_STATE__.godMoney===false);
    assert.deepEqual(errors,[]);
    console.log('BUILD376_RELEASE_EDITION_BROWSER_PASS');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
