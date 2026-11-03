'use strict';
// Owner («نفذ الانجليزي مع الوكيل بالكامل بدقه» → «كمل كل شي بدقه وارفع»), batch EN-2c: the founding screen and its
// contract in English (development edition), with the founding data the save holds left as it is.
//   1. the founding screen holds no Arabic but the bilingual wordmark and the group's default name (the stock Arabic name
//      the company names are built from); the headquarters list reads in English while its values stay the place ids;
//   2. the contract preview is English: its facts (the headquarters "Riyadh · Saudi Arabia", the legal form, the
//      financial year) and its articles;
//   3. a refused field shows the English message beside that field, marked (the field patterns read both languages);
//   4. founding completes in English with a drawn signature: the game starts, the founding alerts and the stored
//      contract's articles are written in English, and the save still holds the place as its Arabic data (city, country)
//      and the stock legal form, which the pages show in English;
//   5. no page error.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app'),{drawFounderSignature}=require('./helpers/signature-input');
const AR=/[؀-ۿ]/;
(async()=>{
  const browser=await chromium.launch({headless:true}),results={};
  try{
    const errors=[];const {page}=await boot({browser,errors,viewport:{width:844,height:390},storage:[['ani-language','en']],found:false,appAudit:'{openCompany}'});await page.waitForTimeout(400);
    const arabic=()=>page.evaluate(()=>{const AR=/[؀-ۿ]/,out=[],root=document.querySelector('.incorporation-workspace');const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);for(let t;(t=walker.nextNode());)if(AR.test(t.nodeValue)&&t.parentElement.getClientRects().length&&!t.parentElement.closest('.incorporation-wordmark'))out.push(t.nodeValue.trim());for(const o of root.querySelectorAll('option,optgroup'))if(AR.test(o.tagName==='OPTGROUP'?o.label:o.textContent))out.push(`${o.tagName.toLowerCase()}: ${o.tagName==='OPTGROUP'?o.label:o.textContent}`);for(const el of root.querySelectorAll('*'))for(const a of ['title','aria-label','placeholder'])if(AR.test(el.getAttribute(a)||''))out.push(`${a}: ${el.getAttribute(a)}`);return [...new Set(out)];});
    // 1.
    const defaultName=await page.inputValue('#founderName');assert.equal(defaultName,'أصول ونفوذ القابضة','1: the default group name stays the stock name');
    assert.deepEqual((await arabic()).filter(t=>t!==defaultName),[],'1: nothing else on the founding screen is Arabic');
    const places=await page.evaluate(()=>[...document.querySelectorAll('#founderLocation option')].map(o=>[o.value,o.textContent]));
    assert.deepEqual(places,[['RUH','Riyadh · Saudi Arabia'],['DXB','Dubai · United Arab Emirates'],['SIN','Singapore · Singapore'],['LON','London · United Kingdom'],['NYC','New York · United States']],'1: the headquarters list in English, its values the place ids');
    // 3.
    await page.fill('#founderName','');await page.click('#founderReview');await page.waitForTimeout(150);
    const refused=await page.evaluate(()=>({text:document.getElementById('founderError').textContent,invalid:document.getElementById('founderName').getAttribute('aria-invalid'),beside:document.getElementById('founderError').previousElementSibling?.contains(document.getElementById('founderName'))||false}));
    assert.deepEqual(refused,{text:'Enter a group name of 1 to 42 characters.',invalid:'true',beside:true},'3: the English message marks its field');
    await page.evaluate(()=>{document.querySelector('.incorporation-customize').open=true;});await page.fill('#founderShort','@@');await page.fill('#founderName','Falcon Holdings');await page.click('#founderReview');await page.waitForTimeout(150);
    assert.equal(await page.evaluate(()=>document.getElementById('founderShort').getAttribute('aria-invalid')),'true','3: the initials message marks the initials');
    await page.fill('#founderShort','FH');
    await page.setInputFiles('#founderLogoUpload',{name:'logo.gif',mimeType:'image/gif',buffer:Buffer.from('GIF89a')});await page.waitForTimeout(250);
    results.logo=await page.evaluate(()=>({status:document.getElementById('founderLogoStatus').textContent,validity:document.getElementById('founderLogoUpload').validationMessage}));
    assert.equal(results.logo.status,'Choose a logo in PNG, JPEG or WebP format.','3: a refused logo is explained in English');assert.ok(!AR.test(results.logo.validity),'3: the logo field\'s validity message is English');
    // 2.
    await page.selectOption('#founderMode','sandbox');await page.click('#founderReview');await page.waitForTimeout(250);
    const contract=await page.evaluate(()=>{const c=document.querySelector('#founderContractPreview .charter');return {title:c.querySelector('.charter-hero small').textContent,facts:[...c.querySelectorAll('.charter-facts>div')].map(d=>[d.querySelector('dt').textContent,d.querySelector('dd').textContent]),articles:[...c.querySelectorAll('.charter-clauses h4')].map(h=>h.textContent),status:c.querySelector('.charter-status').textContent};});
    assert.deepEqual(contract,{title:'Group incorporation contract',facts:[['Headquarters','Riyadh · Saudi Arabia'],['Founder and owner','Founder'],['Legal form','Closed joint-stock holding company'],['Financial year','January – December']],articles:['Entity and ownership','Capital and accounts','Companies and operations'],status:'Draft for review'},'2: the contract preview in English');
    assert.deepEqual(await arabic(),[],'2: nothing on the review step is Arabic');
    // 4.
    await page.locator('#founderForm button[type=submit]').click();await page.waitForTimeout(200);
    results.unsigned=await page.evaluate(()=>{const box=document.getElementById('founderError');return {text:box.textContent,beside:box.previousElementSibling?.id||''};});
    assert.deepEqual(results.unsigned,{text:'Complete your signature with a clearer, longer stroke before the contract is approved.',beside:'founderSignatureMount'},'3: signing without a signature explains it in English beside the pad');
    // The Arabic messages keep their own patterns, unchanged (an error code names no field in either language).
    {const app=fs.readFileSync(path.join(ROOT,'WebApp/app.js'),'utf8');assert.ok(app.includes(":[[/اسمًا للمجموعة/,'founderName'],[/اسم المؤسس/,'founderOwner'],[/الاختصار|اختصار المجموعة/,'founderShort'],[/مقرًا/,'founderLocation'],[/رأس مال/,'founderMode'],[/الشعار/,'founderLogoUpload'],[/توقيعك/,'founderSignatureMount']];"),'3: the Arabic field patterns are unchanged');}
    await drawFounderSignature(page);await page.locator('#founderForm button[type=submit]').click();
    await page.waitForFunction(()=>window.__GH_STATE__?.onboardingComplete&&!window.__GH_DURABLE_COMMAND_CONTEXT__&&!document.getElementById('app')?.hasAttribute('inert'),null,{timeout:60000});
    assert.equal(await page.evaluate(()=>document.getElementById('founderSubmit').textContent),'Sign the contract and found the group','4: the submit button reads English again after founding');
    const founded=await page.evaluate(()=>{const s=__GH_STATE__,doc=s.companyRegistry.group.formationDocument;return {name:s.profile.name,city:s.profile.city,country:s.profile.country,legalForm:s.profile.legalForm,articles:doc.articles.map(a=>a.title),alerts:(s.alerts||[]).filter(a=>typeof a==='string'),docCity:doc.city};});
    results.founded=founded;
    assert.equal(founded.name,'Falcon Holdings');
    assert.deepEqual([founded.city,founded.country,founded.docCity,founded.legalForm],['الرياض','السعودية','الرياض','شركة قابضة مساهمة مقفلة'],'4: the save holds the place and the legal form as their data');
    assert.deepEqual(founded.articles,['Entity and ownership','Capital and accounts','Companies and operations'],'4: the stored contract was written in English');
    assert.ok(founded.alerts.some(a=>/^Contract .+ to found Falcon Holdings in Riyadh, Saudi Arabia, was approved\.$/.test(a)),`4: the founding alert in English (${JSON.stringify(founded.alerts)})`);
    assert.ok(!founded.alerts.some(a=>AR.test(a)),'4: no founding alert in Arabic');
    await page.evaluate(()=>__AUDIT__.openDrawer('formationContract','group'));await page.waitForTimeout(250);
    const stored=await page.evaluate(()=>{const c=document.querySelector('#drawerBody .charter');const AR=/[؀-ۿ]/,left=[];const w=document.createTreeWalker(c,NodeFilter.SHOW_TEXT);for(let t;(t=w.nextNode());)if(AR.test(t.nodeValue))left.push(t.nodeValue.trim());return {facts:[...c.querySelectorAll('.charter-facts>div')].map(d=>[d.querySelector('dt').textContent,d.querySelector('dd').textContent]).slice(0,3),status:c.querySelector('.charter-status').textContent,arabic:left,seal:/^Version \d+ · Fingerprint [0-9a-f]{12}$/.test(c.querySelector('.formation-signature-visual small')?.textContent||'')};});
    assert.deepEqual(stored,{facts:[['Headquarters','Riyadh · Saudi Arabia'],['Founder and owner','Founder'],['Legal form','Closed joint-stock holding company']],status:'Signed and sealed',arabic:[],seal:true},'4: the signed contract shows the saved place and form in English, with no Arabic (its signature\'s version and fingerprint too)');
    // 4. A subsidiary's opening contract, signed in English: its articles and texts in English; what stays Arabic is
    // only the company's legal name where the game builds it from Arabic data.
    assert.equal(await page.evaluate(async()=>await __AUDIT__.openCompany('air')),true,'4: the air company opens');await page.waitForTimeout(300);
    await page.evaluate(()=>__AUDIT__.openDrawer('formationContract','air'));await page.waitForTimeout(250);
    results.opening=await page.evaluate(()=>{const c=document.querySelector('#drawerBody .charter'),AR=/[؀-ۿ]/,left=[];const w=document.createTreeWalker(c,NodeFilter.SHOW_TEXT);for(let t;(t=w.nextNode());)if(AR.test(t.nodeValue))left.push(t.nodeValue.trim());return {articles:[...c.querySelectorAll('.charter-clauses h4')].map(h=>h.textContent),first:c.querySelector('.charter-clauses p')?.textContent||'',arabic:[...new Set(left)]};});
    assert.deepEqual(results.opening.articles,['Entity','Capital','Operations','Approval'],'4: the opening contract\'s articles in English');
    assert.match(results.opening.first,/ is opened as a subsidiary wholly owned by Falcon Holdings, working in passenger and cargo air transport, with its own commercial register and tax file\.$/,'4: the opening contract\'s first article in English');
    {const legal=await page.evaluate(()=>__GH_STATE__.companyRegistry.air.legalName);assert.ok(results.opening.arabic.length&&results.opening.arabic.every(t=>t.includes(legal)),`4: the only Arabic left is the stored legal name ${legal}`);}
    assert.deepEqual(errors,[],'5: no page error');results.contract=contract;
    {const errors2=[];const {page:career}=await boot({browser,errors:errors2,viewport:{width:844,height:390},storage:[['ani-language','en']],found:false});
      await career.selectOption('#founderMode','career-normal');await career.click('#founderReview');await drawFounderSignature(career);await career.locator('#founderForm button[type=submit]').click();
      await career.waitForFunction(()=>window.__GH_STATE__?.onboardingComplete&&!window.__GH_DURABLE_COMMAND_CONTEXT__&&!document.getElementById('app')?.hasAttribute('inert'),null,{timeout:60000});
      const level=await career.evaluate(()=>__GH_STATE__.progression?.mode||null);results.careerMode=level;
      results.career=await career.evaluate(async()=>{const out={};for(const id of ['insurance','media','sports']){__AUDIT__.openDrawer('formationContract',id);await new Promise(r=>setTimeout(r,200));const c=document.querySelector('#drawerBody .charter'),AR=/[؀-ۿ]/,legal=__GH_STATE__.companyRegistry?.[id]?.legalName||null,left=[];const w=document.createTreeWalker(c,NodeFilter.SHOW_TEXT);for(let t;(t=w.nextNode());)if(AR.test(t.nodeValue))left.push(t.nodeValue.trim());out[id]={activity:[...c.querySelectorAll('.charter-facts>div')].map(d=>[d.querySelector('dt').textContent,d.querySelector('dd').textContent]).find(([k])=>k==='Activity')?.[1]||'',blocker:document.querySelector('#drawerBody .charter-blocker')?.textContent||'',arabic:[...new Set(left)]};}return out;});
      assert.ok(level,'4: the helper founds a career game');
      assert.deepEqual(Object.fromEntries(Object.entries(results.career).map(([k,v])=>[k,v.activity])),{insurance:'Insurance services',media:'Media and broadcasting',sports:'Sports club management'},'4: every company\'s activity reads in English');
      for(const [id,row] of Object.entries(results.career)){assert.match(row.blocker,/^This company opens at level \d+ · you are at level \d+\.$/,`4: ${id}: the level lock in English`);
        assert.ok(row.arabic.every(t=>/أصول ونفوذ/.test(t)),`4: ${id}: the only Arabic left is the legal name built from the stock group name (${JSON.stringify(row.arabic)})`);}
      assert.deepEqual(errors2,[],'5: no page error (career)');await career.close();}
    console.log(JSON.stringify({suite:'build661-english-founding-browser',ok:true,...results}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
