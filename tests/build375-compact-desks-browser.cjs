'use strict';
// Build 375 (owner-approved compact design): the stock desk and the facility desks in the real game. The stock desk is
// a segmented bar (portfolio, offering, history) and a stock's own screen; selling is offered only for shares held. A
// telecom branch and a car showroom have their own desks (the airport-shaped page showed "operating gates"); their
// choices are buttons with the current one marked, and a choice returns to the desk. An air base shows its stationed
// assets, offers no expansion (its capacity never binds) and no "movements a day" figure, and nothing is typed.
const assert=require('node:assert/strict');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');
const KINDS=['air','telecom','dealership','mobility'];

(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    const {page}=await boot({browser,errors});page.setDefaultTimeout(60000);page.on('dialog',dialog=>dialog.accept());
    await page.evaluate(async kinds=>{const s=__GH_STATE__;s.godMoney=true;s.infiniteMoney=true;for(const type of kinds){const d=GH_COMPANY_PLATFORM.definitionFor(s,type);await __AUDIT__.runAuthorizedDomainCommand('corporate','open-company',{type,companyId:type,capital:Math.max(2000000000,d?.founding?.minimumCapital||0),legalName:`QA ${type}`,formationContract:`QA-DESK-${type}`},{silent:true});}},KINDS);
    for(const kind of KINDS){await page.evaluate(()=>__AUDIT__.openDrawer('network'));await page.locator('#worldKind').selectOption(kind);await page.locator('#drawerBody .open-directory-site').first().click();await page.waitForFunction(k=>(__GH_STATE__.customHubs||[]).concat(__GH_STATE__.globalBases||[]).some(f=>(f.ownerCompanyId||f.company)===k),kind);}
    await page.evaluate(()=>__AUDIT__.closeDrawer());await page.click('#simCalendarToggle');
    for(let i=0;i<2;i++){const before=await page.evaluate(()=>__GH_STATE__.simSeconds);await page.click('#simNextDay');await page.waitForFunction(b=>__GH_STATE__.simSeconds>=b+86400&&!GH_SIM_KERNEL.snapshot().manualAdvance,before);}
    await page.click('#simCalendarToggle');
    const typed=()=>page.evaluate(()=>[...document.querySelectorAll('#drawerBody input,#drawerBody textarea')].filter(x=>!['checkbox','file','radio'].includes(x.type)).length);

    // Stocks: portfolio -> a stock -> buy -> sell -> offering -> history.
    await page.evaluate(()=>__AUDIT__.openDrawer('stocks'));
    assert.equal(await page.locator('#drawerBody .pv-seg button').count(),3,'one segmented bar');assert.equal(await page.locator('#drawerBody .pv-hero').count(),1);
    assert.equal(await page.locator('#drawerBody .pv-row[data-arg^="sym:"]').count(),await page.evaluate(()=>__GH_STATE__.market.length),'one row per listed stock');
    await page.locator('#drawerBody .pv-row[data-arg="sym:BANK"]').click();await page.locator('#drawerBody .buy-stock').waitFor();
    assert.equal(await page.locator('#drawerBody .sell-stock').count(),0,'no sale offered without shares');
    await page.locator('#drawerBody .buy-stock').click();await page.waitForFunction(()=>__GH_STATE__.portfolio.BANK===1000);await page.locator('#drawerBody .sell-stock').waitFor();
    assert.match(await page.locator('#drawerBody .pv-big b').textContent(),/^\$\d+\.\d{2}$/,'the share price shows its cents');
    await page.locator('#drawerBody .sell-stock').click();await page.waitForFunction(()=>!__GH_STATE__.portfolio.BANK);
    await page.locator('#drawerBody .pv-back').click();await page.locator('#drawerBody .pv-seg button[data-arg="ipo"]').click();await page.locator('#drawerBody .launch-ipo').waitFor();
    await page.locator('#drawerBody .pv-seg button[data-arg="history"]').click();await page.locator('#drawerBody .pv-row').first().waitFor();
    assert.equal(await page.locator('#drawerBody .pv-row').count(),2,'the buy and the sale, one row each');assert.equal(await typed(),0);

    const facilities=await page.evaluate(()=>Object.fromEntries([...__GH_STATE__.globalBases,...__GH_STATE__.customHubs].map(f=>[f.ownerCompanyId||f.company,f.id])));
    const open=(id,tab)=>page.evaluate(([id,tab])=>__AUDIT__.openDrawer('facilityManage',tab?{id,tab}:{id}),[id,tab]);
    // Air base: stationed assets, no display-only capacity, no expansion, and the closure in money.
    await open(facilities.air);const air=await page.locator('#drawerBody').textContent();
    assert.match(air,/أصل متمركز/);assert.doesNotMatch(air,/حركات\/يوم|1,000,000/,'no display-only figures');
    await open(facilities.air,'operations');assert.equal(await page.locator('#drawerBody [data-gh-action="facility-expand"]').count(),0,'a base whose capacity never binds is not expanded');assert.equal(await page.locator('#drawerBody [data-gh-action="facility-hire"]').count(),1);
    await open(facilities.air,'finance');assert.equal(await page.locator('#drawerBody [data-gh-action="facility-close"]').count(),1,'the closure is offered');
    // A mobility centre's bays bind: its expansion costs a quarter of the centre ($250,000 at least) and raises the bays and
    // the running cost by 25%.
    const before=await page.evaluate(id=>{const f=[...__GH_STATE__.customHubs,...__GH_STATE__.globalBases].find(x=>x.id===id);return {cost:f.cost,bays:GH_FACILITY_CORE.assetCapacity(f),daily:f.dailyCost,price:GH_FACILITY_CORE.expansionCost(f)};},facilities.mobility);
    assert.equal(before.price,Math.max(250000,Math.round(before.cost*.25/1000)*1000));
    await open(facilities.mobility,'operations');await page.locator('#drawerBody [data-gh-action="facility-expand"]').click();
    await page.waitForFunction(([id,bays])=>GH_FACILITY_CORE.assetCapacity([...__GH_STATE__.customHubs,...__GH_STATE__.globalBases].find(x=>x.id===id))>bays,[facilities.mobility,before.bays]);
    const after=await page.evaluate(id=>{const f=[...__GH_STATE__.customHubs,...__GH_STATE__.globalBases].find(x=>x.id===id);return {bays:GH_FACILITY_CORE.assetCapacity(f),daily:f.dailyCost};},facilities.mobility);
    assert.equal(after.bays,Math.round(before.bays*1.25));assert.equal(after.daily,Math.round(before.daily*1.25*100)/100,'the running cost grows with the capacity');
    // Telecom branch desk.
    await open(facilities.telecom);assert.match(await page.locator('#drawerBody .pv-hero').textContent(),/مشترك/);assert.equal(await page.locator('#drawerBody .pv-row').count(),4,'one row per plan');
    await open(facilities.telecom,'operations');
    const plans=await page.evaluate(()=>[...document.querySelectorAll('#drawerBody .pv-opt')].map(group=>group.querySelectorAll('[data-current="1"]').length));assert.deepEqual(plans,[1,1,1,1],'each plan marks its current price');
    await page.locator('#drawerBody [data-gh-action="telecom-set-price"][data-plan="home"]:not([disabled])').first().click();
    await page.waitForFunction(()=>Number(GH_TELECOM_MARKET.read(__GH_STATE__).pricing.home)!==1);await page.waitForFunction(()=>document.querySelector('#drawerBody .tab-btn.active[data-facility-tab="operations"]'));
    assert.equal(await page.evaluate(()=>document.querySelectorAll('#drawerBody .pv-opt')[1].querySelector('[data-current="1"]').dataset.level!=='1'),true,'the choice returns to the desk, marked');
    // Showroom desk.
    await open(facilities.dealership);assert.match(await page.locator('#drawerBody .pv-hero').textContent(),/مبيعات الشهر/);
    await open(facilities.dealership,'operations');assert.equal(await page.locator('#drawerBody .pv-opt').count(),3,'price, stock cover and service plan');assert.equal(await page.locator('#drawerBody [data-current="1"]').count(),3);
    assert.equal(await typed(),0,'nothing is typed');assert.deepEqual(errors,[]);
    console.log('BUILD375_COMPACT_DESKS_BROWSER_PASS');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
