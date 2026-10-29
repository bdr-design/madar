'use strict';
// Owner (approved design, «الاشتراكات والمشتريات», and «تسريع الوقت خل عليه عملية شراء»): the store edition of the real
// app (GH_EDITION 'release') with a store bridge standing in for StoreKit 2:
//  1. the app tells the bridge it is ready once the group is founded;
//  2. without purchases, 300× and a seven-day calendar advance are refused and open the store page; investor mode is
//     refused and opens the store page;
//  3. the store page lists the products with the store's localized prices, sends a purchase and a restore to the bridge;
//  4. a verified capital-pack transaction is delivered once: the group receives the pack as a documented founder
//     investment, the bridge is told to finish only after the save, and the same transaction again pays nothing;
//  5. the investor licence opens investor mode; the time accelerator opens 300×;
//  6. a refund takes the capital pack back (documented founder withdrawal) and the licence (investor mode off).
const assert=require('node:assert/strict');
const {boot}=require('./helpers/local-dom-app');
const AUDIT='{toggleInvestorMode,setSpeed}';
const settle=page=>page.waitForFunction(()=>!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked(),null,{timeout:120000});
const RELEASE={fn:()=>{window.GH_EDITION='release';window.__storePosts=[];window.webkit={messageHandlers:{storeBridge:{postMessage:message=>window.__storePosts.push(JSON.parse(JSON.stringify(message)))}}};}};
(async()=>{
  const errors=[],{page,browser}=await boot({errors,appAudit:AUDIT,beforeScripts:RELEASE});
  try{
    page.setDefaultTimeout(120000);
    // 1.
    assert.ok(await page.evaluate(()=>window.__storePosts.some(row=>row.action==='ready')),'1: ready after founding');
    // 2.
    await page.evaluate(()=>__AUDIT__.setSpeed(3));assert.notEqual(await page.evaluate(()=>__GH_STATE__.speed),3,'2: 300× needs the accelerator');
    await page.waitForFunction(()=>document.querySelector('#drawerBody .store-product'),null,{timeout:30000});
    await page.evaluate(()=>__AUDIT__.openDrawer('groupHub'));
    const advance=await page.evaluate(()=>{const s=__GH_STATE__.simSeconds;document.querySelector('[data-calendar-advance="7"]').click();return {before:s,manual:__AUDIT__.simulationEngine.snapshot().manualAdvance};});
    assert.ok(!advance.manual,'2: a seven-day advance needs the accelerator');await page.waitForFunction(()=>document.querySelector('#drawerBody .store-product'),null,{timeout:30000});
    await page.evaluate(()=>__AUDIT__.toggleInvestorMode());await settle(page);assert.equal(await page.evaluate(()=>GH_FINANCE_CORE.investorMode(__GH_STATE__)),false,'2: investor mode needs its licence');
    // 3.
    await page.evaluate(()=>{GH_STORE_NATIVE.onProducts(GH_STORE_CORE&&Object.keys(GH_STORE_CORE.PRODUCTS).map(suffix=>({productId:`com.test.ventora.${suffix}`,displayPrice:`SAR ${suffix.length}.99`,title:suffix})));__AUDIT__.openDrawer('store');});
    await page.waitForFunction(()=>document.querySelector('#drawerBody .store-product'),null,{timeout:30000});
    const listing=await page.evaluate(()=>({cards:document.querySelectorAll('#drawerBody .store-product').length,prices:[...document.querySelectorAll('#drawerBody .store-product .tag')].map(e=>e.textContent),buy:document.querySelector('#drawerBody [data-gh-action="store-buy"][data-product="capital.small"]')?.disabled}));
    assert.ok(listing.cards>=8,`3: the products (${listing.cards})`);assert.ok(listing.prices.includes('SAR 13.99'),'3: the store\'s localized price');assert.equal(listing.buy,false,'3: buying is open with a store bridge');
    await page.click('#drawerBody [data-gh-action="store-buy"][data-product="capital.small"]');await page.click('#drawerBody [data-gh-action="store-restore"]');
    const posts=await page.evaluate(()=>window.__storePosts.map(row=>row.action+':'+(row.productId||'')));assert.ok(posts.includes('purchase:capital.small'),'3: a purchase reaches the bridge');assert.ok(posts.includes('restore:'),'3: a restore reaches the bridge');
    // 4.
    const delivered=await page.evaluate(async()=>{const cash=()=>GH_FINANCE_CORE.operating(__GH_STATE__,'group'),before=cash();window.__storePosts.length=0;await GH_STORE_NATIVE.onTransaction({transactionId:'90001',productId:'com.test.ventora.capital.small'});
      const after=cash(),finishes=window.__storePosts.filter(row=>row.action==='finish').map(row=>row.transactionId),doc=(__GH_STATE__.finance.transfers||[]).find(row=>row.reference==='STORE-90001-1');
      await GH_STORE_NATIVE.onTransaction({transactionId:'90001',productId:'com.test.ventora.capital.small'});return {paid:Math.round(after-before),again:Math.round(cash()-after),finishes,doc:doc?{kind:doc.kind,amount:doc.amount}:null,saved:__GH_STATE__.purchases?.deliveries?.['90001']?.capital};});
    assert.equal(delivered.paid,6000000,'4: the small pack at level 1 (5M × 1.2)');assert.equal(delivered.doc?.kind,'founder-investment','4: a documented founder investment');assert.deepEqual(delivered.finishes,['90001'],'4: finished after the durable save');
    assert.equal(delivered.again,0,'4: the same transaction pays nothing');assert.equal(delivered.saved,6000000);await settle(page);
    // 5.
    await page.evaluate(()=>GH_STORE_NATIVE.onTransaction({transactionId:'90002',productId:'com.test.ventora.investor.licence'}));await settle(page);
    await page.evaluate(()=>__AUDIT__.toggleInvestorMode());await settle(page);assert.equal(await page.evaluate(()=>GH_FINANCE_CORE.investorMode(__GH_STATE__)),true,'5: the licence opens investor mode');
    await page.evaluate(()=>__AUDIT__.toggleInvestorMode());await settle(page);
    await page.evaluate(()=>GH_STORE_NATIVE.onTransaction({transactionId:'90003',productId:'com.test.ventora.time.accelerator'}));await settle(page);
    await page.evaluate(()=>__AUDIT__.setSpeed(3));assert.equal(await page.evaluate(()=>__GH_STATE__.speed),3,'5: the accelerator opens 300×');await page.evaluate(()=>__AUDIT__.setSpeed(0));
    // 6. (owner «نعم تسحب») refunds: the capital pack is taken back as a documented founder withdrawal and the bridge is
    // told to finish after the save; the investor licence is taken back and investor mode turned off.
    await page.evaluate(()=>__AUDIT__.toggleInvestorMode());await settle(page);assert.equal(await page.evaluate(()=>GH_FINANCE_CORE.investorMode(__GH_STATE__)),true);
    const refunded=await page.evaluate(async()=>{const cash=()=>GH_FINANCE_CORE.operating(__GH_STATE__,'group'),before=cash();window.__storePosts.length=0;await GH_STORE_NATIVE.onRevocation({transactionId:'90001',productId:'com.test.ventora.capital.small'});
      const doc=(__GH_STATE__.finance.transfers||[]).find(row=>row.reference==='STORE-REVOKE-90001');return {taken:Math.round(before-cash()),doc:doc?{kind:doc.kind,amount:doc.amount}:null,finishes:window.__storePosts.filter(row=>row.action==='finish').map(row=>row.transactionId)};});
    assert.equal(refunded.taken,6000000,'6: the pack is taken back');assert.equal(refunded.doc?.kind,'founder-withdrawal','6: a documented founder withdrawal');assert.deepEqual(refunded.finishes,['90001'],'6: finished after the durable save');await settle(page);
    await page.evaluate(()=>GH_STORE_NATIVE.onRevocation({transactionId:'90002',productId:'com.test.ventora.investor.licence'}));await settle(page);
    await page.waitForFunction(()=>GH_FINANCE_CORE.investorMode(__GH_STATE__)===false,null,{timeout:60000});
    assert.equal(await page.evaluate(()=>GH_STORE_CORE.featureOpen(__GH_STATE__,'investor')),false,'6: the licence is taken back and investor mode is off');
    assert.equal(await page.evaluate(async()=>{await GH_STORE_NATIVE.onTransaction({transactionId:'90002',productId:'com.test.ventora.investor.licence'});return GH_STORE_CORE.featureOpen(__GH_STATE__,'investor');}),false,'6: a refunded transaction is not delivered again');
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
  console.log(JSON.stringify({suite:'build636-store-release-browser',ok:true}));
})().catch(error=>{console.error(error);process.exitCode=1;});
