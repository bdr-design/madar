'use strict';
// Build 376 (owner: the game is VENTORA; the release edition shows the player no developer tools). The iPhone app's
// release build sets GH_EDITION='release': the system section lists no updates, game-health or control pages (a link
// to one opens the settings), the settings carry no update card and no safety-period choices but offer a problem
// report, and the unlimited-money mode lives on its own page, «وضع المستثمر الحر». The development edition keeps its
// tools. The default group is «فنتورا القابضة» and its companies carry the new name.
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
    assert.equal(await page.title(),'VENTORA · فنتورا');
    assert.equal(await page.evaluate(()=>__GH_STATE__.profile.name),'فنتورا القابضة');
    assert.equal(await page.evaluate(()=>GH_COMPANY_PLATFORM.resolveIdentity(__GH_STATE__,'air').legalName),'شركة فنتورا للطيران');
    // A save of the old name takes the new one.
    assert.equal(await page.evaluate(()=>{const s=structuredClone(__GH_STATE__);s.profile.name='المجموعة العالمية القابضة';s.profile.shortName='GH';return GH_COMPANY_PLATFORM.migrateState(s).state.profile.name;}),'فنتورا القابضة');

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
    assert.doesNotMatch(settings,/تحديثات VENTORA|ملف تحديث|عند الخروج فقط|مدة الأمان|God Mode|وضع التجربة/);
    assert.equal(await page.locator('#drawerBody .save-cap-choices').count(),0);assert.equal(await page.locator('#drawerBody .save-now-btn').count(),1);
    assert.equal(await page.locator('#drawerBody [data-gh-action="report-problem"]').count(),1,'the problem report stays');
    assert.equal(await page.locator('#drawerBody .god-mode-toggle').count(),0,'the money mode left the settings');

    // «وضع المستثمر الحر» on its own page.
    await open('investorMode');assert.match(await body(),/وضع المستثمر الحر/);
    await page.locator('#drawerBody .god-mode-toggle').click();await page.waitForFunction(()=>__GH_STATE__.godMoney===true&&__GH_STATE__.infiniteMoney===true);
    await page.waitForFunction(()=>document.querySelector('#drawerBody .god-mode-toggle')?.textContent.includes('إيقاف'));
    await page.locator('#drawerBody .god-mode-toggle').click();await page.waitForFunction(()=>__GH_STATE__.godMoney===false);
    assert.deepEqual(errors,[]);
    console.log('BUILD376_RELEASE_EDITION_BROWSER_PASS');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
