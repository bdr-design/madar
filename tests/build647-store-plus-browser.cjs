'use strict';
// Owner (approved store design and pricing, «تم اعتمد بدقه» and «نعم، كلها كما في التصميم»): the store edition of the real
// app (GH_EDITION 'release') in a career game, with a store bridge standing in for StoreKit 2:
//  1. the store has its own top-bar button; it opens full screen (the drawer's own head hidden) on the Plus tab; its
//     close button closes it; the page draws no SVG (the drawer refuses it) and stays small;
//  2. the three tabs draw their own cards: Plus (the eight perks, the founder salary of the level, the plan switch that
//     changes what the button buys), capital (three packs, each with its game image; the $0.99 pack is gone) and licences
//     (the investor licence at $99.99, the accelerator, restore, manage, privacy and terms);
//  3. the starter pack is offered from the career's first company, for 7 days; bought, it invests 25M × (1 + level ÷ 5)
//     ($30M at level 1) and
//     opens 300× for three game days, after which a 300× game steps down to 120× by itself;
//  4. the investor licence is unlimited money only: in investor mode the career's levels stay;
//  5. Plus opens slots 4–6 (refused without it, with a notice; the store does not open) and the gold identity on the app, both
//     gone again when the subscription has ended; the long calendar advance is Plus's, not the accelerator's.
const assert=require('node:assert/strict');
const {boot}=require('./helpers/local-dom-app');
const {drawFounderSignature}=require('./helpers/signature-input');
const AUDIT='{openCompany,toggleInvestorMode,openingBlocker,setSpeed}';
const settle=page=>page.waitForFunction(()=>!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked(),null,{timeout:120000});
const RELEASE={fn:()=>{window.GH_EDITION='release';window.__storePosts=[];window.webkit={messageHandlers:{storeBridge:{postMessage:message=>window.__storePosts.push(JSON.parse(JSON.stringify(message)))}}};}};
const tab=page=>page.evaluate(()=>document.querySelector('#drawerBody .st')?.dataset.storeTab||null);
(async()=>{
  const errors=[],{page,browser}=await boot({found:false,errors,appAudit:AUDIT,beforeScripts:RELEASE});
  try{
    page.setDefaultTimeout(120000);
    await page.locator('#legalConsent').waitFor({state:'visible'});await page.locator('#legalConsent [data-legal-agree]').check();await page.locator('#legalConsent [data-legal-accept]').click();
    assert.equal(await page.inputValue('#founderMode'),'career-normal');
    await page.click('#founderReview');await drawFounderSignature(page);await page.locator('#founderForm button[type=submit]').click();
    await page.waitForFunction(()=>window.__GH_STATE__?.onboardingComplete&&!window.__GH_DURABLE_COMMAND_CONTEXT__&&!document.getElementById('app')?.hasAttribute('inert'),null,{timeout:120000});
    if(await page.evaluate(()=>__GH_STATE__.speed>0))await page.click('#speedToggle');
    await page.evaluate(()=>GH_STORE_NATIVE.onProducts(Object.keys(GH_STORE_CORE.PRODUCTS).map(suffix=>({productId:`com.test.ani.${suffix}`,displayPrice:`$${GH_STORE_CORE.PRODUCTS[suffix].price}`,title:suffix}))));
    // 1.
    await page.click('#storeBtn');await page.waitForSelector('#drawerBody .st');
    const opened=await page.evaluate(()=>({tab:document.querySelector('#drawerBody .st').dataset.storeTab,shell:document.getElementById('app').classList.contains('store-open'),head:getComputedStyle(document.querySelector('#drawer .drawer-head')).display,
      svg:document.querySelectorAll('#drawerBody svg').length,nodes:document.querySelectorAll('#drawerBody *').length,full:(()=>{const r=document.querySelector('.sheet-dock').getBoundingClientRect();return r.left<=1&&r.top<=1&&r.right>=innerWidth-1&&r.bottom>=innerHeight-1;})()}));
    assert.equal(opened.tab,'plus','1: the store opens on Plus');assert.equal(opened.shell,true);assert.equal(opened.head,'none','1: the drawer head is hidden');assert.equal(opened.full,true,'1: full screen');
    assert.equal(opened.svg,0,'1: no SVG in the drawer');assert.ok(opened.nodes<160,`1: a small page (${opened.nodes} nodes)`);
    // 2. Plus.
    const plus=await page.evaluate(()=>({tiles:document.querySelectorAll('#drawerBody .st-tile').length,salary:document.querySelector('#drawerBody .st-tile.hl .st-v').textContent,cta:document.querySelector('#drawerBody .st-cta').dataset.product}));
    assert.equal(plus.tiles,8,'2: the eight perks');assert.match(plus.salary,/\$12\.0M/,'2: the founder salary at level 1');assert.equal(plus.cta,'plus.yearly','2: yearly by default');
    await page.click('#drawerBody .st-seg button:first-child');await page.waitForFunction(()=>document.querySelector('#drawerBody .st-cta')?.dataset.product==='plus.monthly');
    await page.click('#drawerBody .st-cta');assert.ok(await page.evaluate(()=>window.__storePosts.some(row=>row.action==='purchase'&&row.productId==='plus.monthly')),'2: the button buys the plan chosen');
    // 2. Capital.
    await page.click('#drawerBody .st-dock button:nth-child(2)');await page.waitForFunction(()=>document.querySelector('#drawerBody .st')?.dataset.storeTab==='cap');
    const cap=await page.evaluate(()=>({cards:[...document.querySelectorAll('#drawerBody .store-product')].map(e=>e.dataset.storeProduct),images:[...document.querySelectorAll('#drawerBody .st-card .st-img')].map(e=>getComputedStyle(e).backgroundImage),small:document.querySelectorAll('#drawerBody [data-product="capital.small"]').length}));
    assert.deepEqual(cap.cards,['capital.medium','capital.large','capital.huge'],'2: three packs; no starter pack before the first company');assert.equal(cap.small,0,'2: the $0.99 pack is gone');
    assert.ok(cap.images.every(url=>/assets\/images\/ui\/air-[a-z]+\.webp/.test(url)),'2: each pack has its game image');
    // 2. Licences.
    await page.click('#drawerBody .st-dock button:nth-child(3)');await page.waitForFunction(()=>document.querySelector('#drawerBody .st')?.dataset.storeTab==='lic');
    const lic=await page.evaluate(()=>({investor:document.querySelector('#drawerBody [data-store-product="investor.licence"] [data-store-price]')?.textContent,actions:[...document.querySelectorAll('#drawerBody .st-links [data-gh-action]')].map(e=>e.dataset.ghAction)}));
    assert.equal(lic.investor,'$99.99','2: the investor licence at $99.99');assert.deepEqual(lic.actions,['store-restore','store-manage','legal-privacy','legal-terms']);
    await page.click('#drawerBody .st-x');await page.waitForFunction(()=>!document.getElementById('drawer').classList.contains('open')&&!document.getElementById('app').classList.contains('store-open'));
    // 3. The starter pack.
    assert.equal(await page.evaluate(()=>GH_STORE_CORE.starterOffered(__GH_STATE__)),false,'3: not before the first company');
    assert.equal(await page.evaluate(()=>__AUDIT__.openCompany('road')),true);await settle(page);
    assert.equal(await page.evaluate(()=>GH_STORE_CORE.starterDaysLeft(__GH_STATE__)),7,'3: offered for 7 days from the first company');
    await page.evaluate(()=>__AUDIT__.openDrawer('store',{tab:'cap'}));await page.waitForSelector('#drawerBody [data-store-product="starter.pack"]');
    const starter=await page.evaluate(async()=>{const cash=()=>GH_FINANCE_CORE.operating(__GH_STATE__,'group'),before=cash();await GH_STORE_NATIVE.onTransaction({transactionId:'S647-1',productId:'com.test.ani.starter.pack'});return {paid:Math.round(cash()-before),expected:GH_STORE_CORE.packAmount(__GH_STATE__,25000000),level:GH_PROGRESSION_CORE.level(__GH_STATE__),until:__GH_STATE__.purchases.entitlements.speed?.untilSim,now:__GH_STATE__.simSeconds};});
    assert.equal(starter.paid,starter.expected,`3: 25M × (1 + level ÷ 5) at level ${starter.level} (30M at level 1)`);assert.equal(starter.until-Math.floor(starter.now),3*86400,'3: 300× for three game days');await settle(page);
    await page.evaluate(()=>__AUDIT__.setSpeed(3));assert.equal(await page.evaluate(()=>__GH_STATE__.speed),3,'3: the starter pack opens 300×');
    await page.evaluate(()=>{__GH_STATE__.purchases.entitlements.speed.untilSim=1;});
    await page.waitForFunction(()=>__GH_STATE__.speed===2,null,{timeout:30000});assert.equal(await page.evaluate(()=>__GH_STATE__.speed),2,'3: after its three days 300× steps down to 120×');
    await page.evaluate(()=>__AUDIT__.setSpeed(0));await settle(page);
    // 4. The investor licence.
    await page.evaluate(()=>GH_STORE_NATIVE.onTransaction({transactionId:'S647-2',productId:'com.test.ani.investor.licence'}));await settle(page);
    await page.evaluate(()=>__AUDIT__.toggleInvestorMode());await settle(page);
    const investor=await page.evaluate(()=>({on:GH_FINANCE_CORE.investorMode(__GH_STATE__),active:GH_PROGRESSION_CORE.active(__GH_STATE__),blocker:__AUDIT__.openingBlocker('media')}));
    assert.equal(investor.on,true);assert.equal(investor.active,true,'4: the levels stay in investor mode');assert.match(investor.blocker,/المستوى 6/);
    await page.evaluate(()=>__AUDIT__.toggleInvestorMode());await settle(page);
    // 5. Plus.
    await page.evaluate(()=>__AUDIT__.openDrawer('settings'));await page.waitForSelector('#drawerBody [data-gh-action="save-slot"]');
    assert.equal(await page.locator('#drawerBody [data-gh-action="save-slot"]').count(),3,'5: three slots without Plus');
    assert.equal(await page.evaluate(()=>GH_STORE_CORE.featureOpen(__GH_STATE__,'advance')),false,'5: no long advance without Plus');
    await page.evaluate(()=>GH_STORE_NATIVE.onTransaction({transactionId:'S647-3',productId:'com.test.ani.plus.yearly',expiresAt:Date.now()+30*86400000}));await settle(page);
    await page.waitForFunction(()=>document.getElementById('app').classList.contains('plus-member'),null,{timeout:30000});
    await page.evaluate(()=>__AUDIT__.openDrawer('settings'));await page.waitForSelector('#drawerBody [data-gh-action="save-slot"]');
    const slots=await page.evaluate(()=>[...document.querySelectorAll('#drawerBody [data-gh-action="save-slot"]')].map(e=>({slot:e.dataset.slot,disabled:e.disabled})));
    assert.deepEqual(slots.map(row=>row.slot),['0','1','2','3','4','5'],'5: six slots with Plus');assert.ok(slots.every(row=>!row.disabled));
    assert.equal(await page.evaluate(()=>GH_STORE_CORE.featureOpen(__GH_STATE__,'advance')),true,'5: Plus opens the long advance');
    await page.locator('#drawerBody [data-gh-action="save-slot"][data-slot="3"]').click();
    await page.waitForFunction(()=>GH_PERSISTENCE.slotStatus(3).exists===true,null,{timeout:60000});
    await page.evaluate(()=>{__GH_STATE__.purchases.entitlements.plus.expiresAt=1;});
    await page.waitForFunction(()=>!document.getElementById('app').classList.contains('plus-member'),null,{timeout:30000});
    await page.evaluate(()=>__AUDIT__.openDrawer('settings'));await page.waitForSelector('#drawerBody [data-gh-action="save-slot"]');
    const lapsed=await page.evaluate(()=>[...document.querySelectorAll('#drawerBody [data-gh-action="save-slot"]')].map(e=>({slot:e.dataset.slot,disabled:e.disabled})));
    assert.deepEqual(lapsed,[{slot:'0',disabled:false},{slot:'1',disabled:false},{slot:'2',disabled:false},{slot:'3',disabled:true}],'5: Plus ended: the saved slot 4 stays to load, saving there closes');
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
  console.log(JSON.stringify({suite:'build647-store-plus-browser',ok:true}));
})().catch(error=>{console.error(error);process.exitCode=1;});
