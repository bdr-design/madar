'use strict';
// Owner (approved consent screen «اعتمدت هذا»; doc «سياسة الخصوصية وشروط الاستخدام»): the store edition (GH_EDITION
// 'release', as the iPhone and Android apps set it before the game runs) shows the privacy policy and the terms once
// before founding, and once to a founded save that has not accepted this version; both texts read in full inside the
// game from the consent, the settings and the store, where «إدارة الاشتراك» opens the store's subscription page. In the
// real app (Chromium):
//  1. a new game: the consent covers the founding screen (no click reaches it), with the approved brand and text; the
//     continue button stays disabled until the box is checked, and founding is refused while the consent is unanswered;
//  2. the reader: each link opens its full text (the texts of GH_LEGAL), the tabs switch, «رجوع إلى الموافقة» and Escape
//     return to the consent with the box as it was;
//  3. accepting writes nothing by itself (no success claimed before storage); the founding command writes the
//     acceptance with the texts' version, and after a reload the consent does not come back;
//  4. a founded save without the acceptance: the consent «قبل أن تتابع» over the game (inert, time paused); a refused
//     save keeps the screen with its message and writes nothing; accepting again stores it once (one save revision even
//     for a double click), the time resumes, the game is kept, and after a reload it does not come back;
//  5. the settings and the store open the texts; «إدارة الاشتراك» asks the store bridge for its page (disabled without
//     the store); the development edition shows no consent at boot (control);
//  6. the save schema refuses a malformed acceptance; the terms name the store's own titles and prices.
const assert=require('node:assert/strict');
const {chromium}=require('playwright'),{boot,reboot}=require('./helpers/local-dom-app'),{drawFounderSignature}=require('./helpers/signature-input');
const RELEASE={beforeApp:page=>page.evaluate(()=>{window.GH_EDITION='release';})};
const AUDIT='{setSpeed:value=>setSpeed(value),promptLegal:()=>promptLegal(),dropLegal:()=>{delete state.legal;},saveRevision:()=>Number(state.saveRevision)||0}';
(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    // 1.
    let {page}=await boot({browser,errors,found:false,appAudit:AUDIT,...RELEASE});page.setDefaultTimeout(60000);
    const consent=page.locator('#legalConsent');await consent.waitFor({state:'visible'});
    assert.equal(await page.locator('#legalConsentTitle').textContent(),'قبل أن تؤسس مجموعتك');
    const panel=await consent.textContent();for(const text of ['أصول ونفوذ','ASSETS & INFLUENCE','على جهازك فقط','بلا تتبّع','مال افتراضي','تظهر مرة واحدة، ومتاحة دائمًا من الحفظ والإعدادات'])assert.ok(panel.includes(text),`1: ${text}`);
    assert.ok(await page.evaluate(()=>{const points=[];for(const x of [.05,.5,.95])for(const y of [.05,.5,.95])points.push(document.elementFromPoint(innerWidth*x,innerHeight*y));return points.every(hit=>!!hit?.closest('#legalConsent'));}),'1: the consent covers the founding screen');
    const accept=consent.locator('[data-legal-accept]');assert.equal(await accept.isDisabled(),true,'1: disabled before the box');
    assert.equal(await page.evaluate(()=>{document.getElementById('founderForm').requestSubmit();return __GH_STATE__.onboardingComplete===true;}),false,'1: founding refused while the consent is unanswered');
    // 2.
    await consent.locator('[data-legal-agree]').check();assert.equal(await accept.isDisabled(),false,'1: enabled once checked');
    await consent.locator('[data-legal-open="privacy"]').click();const reader=page.locator('#legalReader');await reader.waitFor({state:'visible'});
    const docText=kind=>page.evaluate(k=>{const box=document.createElement('div');box.innerHTML=GH_LEGAL.documentMarkup(k);return box.textContent;},kind);
    assert.equal(await page.locator('#legalReaderTitle').textContent(),'سياسة الخصوصية');assert.equal(await reader.locator('.legal-reader-body').textContent(),await docText('privacy'),'2: the full privacy text');
    await reader.locator('[data-legal-tab="terms"]').click();assert.equal(await page.locator('#legalReaderTitle').textContent(),'شروط الاستخدام');assert.equal(await reader.locator('.legal-reader-body').textContent(),await docText('terms'),'2: the full terms');
    assert.match(await reader.locator('.legal-reader-foot').textContent(),/يعمل بلا إنترنت · النص نفسه المنشور على رابط الخصوصية/);
    await reader.locator('.legal-reader-foot [data-legal-close]').click();await reader.waitFor({state:'hidden'});assert.equal(await consent.locator('[data-legal-agree]').isChecked(),true,'2: back to the consent, the box as it was');
    await consent.locator('[data-legal-open="terms"]').click();await reader.waitFor({state:'visible'});await page.keyboard.press('Escape');await reader.waitFor({state:'hidden'});assert.ok(await consent.isVisible(),'2: Escape returns to the consent');
    // 3.
    await accept.click();await consent.waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>__GH_STATE__.legal),undefined,'3: accepting alone writes nothing');
    await page.selectOption('#founderMode','sandbox');await page.click('#founderReview');await drawFounderSignature(page);await page.locator('#founderForm button[type=submit]').click();
    await page.waitForFunction(()=>__GH_STATE__.onboardingComplete&&!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked());
    const version=await page.evaluate(()=>GH_LEGAL.VERSION);
    assert.deepEqual(await page.evaluate(()=>__GH_STATE__.legal),{version,acceptedDay:1},'3: the founding command writes the acceptance with the version');
    ({page}=await reboot(page,{errors,appAudit:AUDIT,...RELEASE}));page.setDefaultTimeout(60000);
    assert.deepEqual(await page.evaluate(()=>__GH_STATE__.legal),{version,acceptedDay:1},'3: stored');assert.equal(await page.locator('#legalConsent').isHidden(),true,'3: not shown again');
    // 4. A founded save without the acceptance.
    await page.evaluate(()=>__AUDIT__.setSpeed(1));assert.equal(await page.evaluate(()=>__GH_STATE__.speed),1);
    await page.evaluate(async()=>{__AUDIT__.dropLegal();window.__qaLegal=__AUDIT__.promptLegal();});
    const founded=page.locator('#legalConsent');await founded.waitFor({state:'visible'});
    assert.equal(await page.locator('#legalConsentTitle').textContent(),'قبل أن تتابع');assert.equal(await founded.locator('[data-legal-accept]').textContent(),'متابعة');
    assert.equal(await page.evaluate(()=>document.getElementById('app').hasAttribute('inert')),true,'4: the game is inert behind it');assert.equal(await page.evaluate(()=>__GH_STATE__.speed),0,'4: its time paused');
    const before=await page.evaluate(()=>({revision:__AUDIT__.saveRevision(),founded:__GH_STATE__.onboardingComplete,name:__GH_STATE__.profile.name,speed:__GH_STATE__.speed}));
    await founded.locator('[data-legal-agree]').check();
    await page.evaluate(()=>{window.__GH_DIAGNOSTIC_EXPORT_IN_PROGRESS__=true;});await founded.locator('[data-legal-accept]').click();
    await page.waitForFunction(()=>document.querySelector('#legalConsent .legal-status')?.textContent.includes('تعذر حفظ الموافقة'));
    assert.ok(await founded.isVisible(),'4: a refused save keeps the screen');assert.equal(await page.evaluate(()=>__GH_STATE__.legal),undefined,'4: and writes nothing');assert.equal(await page.evaluate(()=>__AUDIT__.saveRevision()),before.revision);
    await page.evaluate(()=>{window.__GH_DIAGNOSTIC_EXPORT_IN_PROGRESS__=false;});
    await founded.locator('[data-legal-accept]').dblclick();await page.waitForFunction(()=>window.__qaLegal&&document.getElementById('legalConsent').classList.contains('hidden'));
    assert.equal(await page.evaluate(()=>window.__qaLegal),true);await page.waitForFunction(()=>!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked());
    const after=await page.evaluate(()=>({revision:__AUDIT__.saveRevision(),legal:__GH_STATE__.legal,day:Math.floor(__GH_STATE__.simSeconds/86400)+1,founded:__GH_STATE__.onboardingComplete,name:__GH_STATE__.profile.name,speed:__GH_STATE__.speed,inert:document.getElementById('app').hasAttribute('inert')}));
    assert.equal(after.revision,before.revision+1,'4: stored once, a double click included');assert.equal(after.legal.version,version);assert.ok(after.legal.acceptedDay>=1&&after.legal.acceptedDay<=after.day);
    assert.deepEqual([after.founded,after.name,after.speed,after.inert],[before.founded,before.name,1,false],'4: the game kept, its time resumed, no longer inert');
    ({page}=await reboot(page,{errors,appAudit:AUDIT,...RELEASE}));page.setDefaultTimeout(60000);
    assert.deepEqual(await page.evaluate(()=>__GH_STATE__.legal),after.legal,'4: stored');assert.equal(await page.locator('#legalConsent').isHidden(),true,'4: not shown again');
    // 5. Settings and store.
    await page.evaluate(()=>__AUDIT__.openDrawer('settings'));
    assert.match(await page.locator('#drawerBody .legal-card-row').textContent(),/وافقت على نسخة 30 أكتوبر 2026/);
    await page.locator('#drawerBody [data-gh-action="legal-terms"]').click();await page.locator('#legalReader').waitFor({state:'visible'});assert.equal(await page.locator('#legalReaderTitle').textContent(),'شروط الاستخدام');
    assert.equal(await page.locator('#legalReader .legal-reader-foot [data-legal-close]').textContent(),'رجوع');await page.locator('#legalReader .legal-reader-foot [data-legal-close]').click();await page.locator('#legalReader').waitFor({state:'hidden'});
    await page.evaluate(()=>__AUDIT__.openDrawer('store'));assert.equal(await page.locator('#drawerBody [data-gh-action="store-manage"]').isDisabled(),true,'5: no store, no manage');
    await page.locator('#drawerBody [data-gh-action="legal-privacy"]').click();await page.locator('#legalReader').waitFor({state:'visible'});assert.equal(await page.locator('#legalReaderTitle').textContent(),'سياسة الخصوصية');await page.keyboard.press('Escape');
    await page.evaluate(()=>{window.__qaBridge=[];window.webkit={messageHandlers:{storeBridge:{postMessage:message=>window.__qaBridge.push(message)}}};__AUDIT__.openDrawer('store');});
    await page.locator('#drawerBody [data-gh-action="store-manage"]').click();assert.deepEqual(await page.evaluate(()=>window.__qaBridge.filter(row=>row.action==='manage')),[{action:'manage'}],'5: the store bridge is asked for its subscription page');
    await page.close();
    ({page}=await boot({browser,errors,found:false}));assert.equal(await page.locator('#legalConsent').isHidden(),true,'5: the development edition shows no consent at boot');
    // 6.
    const schema=await page.evaluate(version=>{const s=structuredClone(__GH_STATE__),check=legal=>{s.legal=legal;return GH_SAVE_SCHEMA.validate(s).errors.filter(e=>/^legal/.test(e));};return {ok:check({version,acceptedDay:3}),noVersion:check({acceptedDay:3}),badDay:check({version,acceptedDay:0}),extra:check({version,acceptedDay:2,by:'x'}),text:check('yes')};},version);
    assert.deepEqual(schema.ok,[]);assert.ok(schema.noVersion.length&&schema.badDay.length&&schema.extra.length&&schema.text.length,`6: a malformed acceptance is refused ${JSON.stringify(schema)}`);
    const terms=await docText('terms'),products=await page.evaluate(()=>GH_STORE_CORE.PRODUCTS);
    for(const id of ['plus.monthly','plus.yearly','time.accelerator','investor.licence','starter.pack']){const p=products[id];assert.ok(terms.includes(p.title)&&terms.includes(p.price),`6: the terms name ${p.title} at ${p.price}`);}
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({suite:'build645-legal-consent-browser',ok:true,version,acceptedDay:after.legal.acceptedDay}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
