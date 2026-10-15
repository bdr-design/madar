'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),{chromium,webkit}=require('playwright'),{boot}=require('./helpers/local-dom-app');
(async()=>{
 for(const engine of [chromium,webkit]){
  const browser=await engine.launch({headless:true,...(engine===webkit?{executablePath:webkit.executablePath()}:{})}),errors=[];
  try{
   const {page}=await boot({browser,errors,viewport:{width:844,height:390}});page.setDefaultTimeout(90000);
   const initial=await page.evaluate(()=>GH_ADVANCED.newsSummary(__GH_STATE__));assert.ok(initial.count>0,'group formation produces news through the actual founding flow');assert.equal(initial.latest.company,'group');
   await page.evaluate(async()=>{await __AUDIT__.runAuthorizedDomainCommand('corporate','open-company',{type:'power',capital:200000000,legalName:'طاقة المجموعة للأخبار'},{silent:true});__AUDIT__.openDrawer('news',{filter:'company'});});
   assert.match(await page.locator('.official-news-lead h2').innerText(),/طاقة المجموعة للأخبار/);
   const revision=await page.evaluate(()=>__GH_STATE__.saveRevision);await page.locator('.official-news-lead [data-news-source]').click();
   assert.equal(await page.evaluate(()=>__AUDIT__.currentPanel()),'formationContract');assert.equal(await page.evaluate(()=>__AUDIT__.currentArg()),'power');
   assert.equal(await page.evaluate(()=>__GH_STATE__.saveRevision),revision,'opening a news source does not trigger another save');
   const preparation=await page.evaluate(async()=>{
    const a=__AUDIT__,s=__GH_STATE__;if(!s.openedCompanies.includes('air'))await a.runAuthorizedDomainCommand('corporate','open-company',{type:'air',capital:400000000,legalName:'طيران أخبار المجموعة'},{silent:true});
    const row=GH_WORLD_DATA.airports.find(r=>r[0]==='OERK'),facility={id:'NEWS-OERK',name:'قاعدة أخبار المجموعة',kind:'airport-base',company:'air',ownerCompanyId:'air',owned:true,sourceKey:'air:OERK',icao:'OERK',code:row[1]||row[0],iata:row[1],coords:[row[6],row[7]],city:row[3]||row[4]||'—',country:String(row[5]||'—')};
    await a.runAuthorizedDomainCommand('facilities','create',{facility,bucket:'globalBases'},{silent:true});a.openDrawer('news',{filter:'facility'});
    return {sequence:s.businessWorld.sequence,saveRevision:s.saveRevision};
   });
   assert.match(await page.locator('.official-news-lead h2').innerText(),/قاعدة أخبار المجموعة/);await page.locator('.official-news-lead [data-news-source]').click();assert.equal(await page.evaluate(()=>__AUDIT__.currentPanel()),'facilityManage');
   assert.equal(await page.evaluate(()=>__GH_STATE__.saveRevision),preparation.saveRevision);
   await page.evaluate(async()=>{await __AUDIT__.runAuthorizedDomainCommand('facilities','close',{id:'NEWS-OERK'},{silent:true});__AUDIT__.openDrawer('news',{filter:'facility'});});
   await page.locator('.official-news-lead [data-news-source]').click();assert.equal(await page.evaluate(()=>__AUDIT__.currentPanel()),'companyFacilities','closed facilities link to the company record rather than a missing facility');
   assert.equal(await page.evaluate(()=>__AUDIT__.currentArg()),'air');
   await page.evaluate(async()=>{const a=__AUDIT__,invoice=(await a.runAuthorizedDomainCommand('finance','accrue-expense',{company:'power',amount:1000,note:'مستحقات مورد للأخبار',counterparty:'مورد المجموعة',taxable:false},{silent:true})).result;await a.runAuthorizedDomainCommand('finance','settle-payable',{number:invoice.number,method:'cheque'},{silent:true});a.openDrawer('news',{filter:'payment'});});
   await page.locator('.official-news-lead [data-news-source]').click();assert.equal((await page.evaluate(()=>__AUDIT__.currentArg())).view,'cheques','a cheque issued from the payable page opens the cheque source');
   // Sourced finance records can share a reference across subsidiaries without hiding one another.
   await page.evaluate(()=>{const s=__GH_STATE__;for(const company of ['power','air'])GH_BUSINESS_WORLD.recordEvent(s,{kind:'payment',company,title:`حوالة ${company}`,reference:'PAY-CROSS-COMPANY',official:true,sourceDomain:'finance',sourceRef:'BANK-REF',documentRef:'INV-REF'});__AUDIT__.openDrawer('news',{filter:'payment'});});
   assert.equal(await page.locator('.official-news-lead,.official-news-card').count(),3);await page.locator('.official-news-lead [data-news-source]').click();
   assert.equal(await page.evaluate(()=>__AUDIT__.currentPanel()),'invoices');assert.equal((await page.evaluate(()=>__AUDIT__.currentArg())).company,'air');
   const measured=await page.evaluate(()=>{
    __AUDIT__.openDrawer('news',{filter:'all',limit:80});const s=__GH_STATE__,saved=JSON.stringify(s.businessWorld),revision=s.saveRevision,metrics=GH_BUSINESS_WORLD.newsMetrics();
    for(let i=0;i<10000;i++)GH_ADVANCED.newsSummary(s);
    return {sameNews:saved===JSON.stringify(s.businessWorld),sameRevision:revision===s.saveRevision,additionalVisits:GH_BUSINESS_WORLD.newsMetrics().visited-metrics.visited,cards:document.querySelectorAll('.official-news-lead,.official-news-card').length,thumbs:document.querySelectorAll('.official-news-thumb').length};
   });
   assert.equal(measured.additionalVisits,0);assert.equal(measured.sameNews,true);assert.equal(measured.sameRevision,true);assert.ok(measured.cards<=80&&measured.thumbs<=3);
   const quiet=await page.evaluate(()=>{const lead=document.querySelector('.official-news-lead'),s=__GH_STATE__;GH_BUSINESS_WORLD.recordEvent(s,{kind:'competitor',company:'group',title:'External market noise',reference:'RIVAL-BROWSER'});__AUDIT__.updateKpis();return {sameNode:lead===document.querySelector('.official-news-lead'),badge:Number(document.querySelector('#alertCount').textContent),stories:GH_ADVANCED.newsSummary(s).count};});
   assert.equal(quiet.sameNode,true,'external market noise does not rebuild the visible news page');assert.equal(quiet.badge,quiet.stories,'the news badge counts group stories rather than unrelated UI alerts');
   // Filtering and live publication preserve the user's reading position and selected category.
   await page.evaluate(()=>{__AUDIT__.openDrawer('news',{filter:'company',limit:50});document.querySelector('#drawerBody').scrollTop=40;});
   await page.evaluate(async()=>{await __AUDIT__.runAuthorizedDomainCommand('corporate','rename-company',{type:'power',legalName:'الاسم الجديد للمجموعة'},{silent:true});__AUDIT__.updateKpis();});
   assert.match(await page.locator('.official-news-lead h2').innerText(),/الاسم الجديد/);assert.equal(await page.locator('[data-news-filter="company"]').getAttribute('aria-pressed'),'true');
   for(const size of [{width:667,height:375},{width:956,height:440},{width:1280,height:720}]){
    await page.setViewportSize(size);await page.evaluate(()=>__AUDIT__.openDrawer('news'));
    const overflow=await page.evaluate(()=>{const page=document.querySelector('.official-news-page'),body=document.querySelector('#drawerBody');return {page:page.scrollWidth-page.clientWidth,body:body.scrollWidth-body.clientWidth};});
    assert.ok(overflow.page<=1&&overflow.body<=1,`${engine.name()} news overflow at ${size.width}: ${JSON.stringify(overflow)}`);
   }
   if(process.env.GH_NEWS_ARTIFACT_DIR)await page.screenshot({path:path.join(process.env.GH_NEWS_ARTIFACT_DIR,`news-${engine.name()}.png`)});
   await page.locator('[data-news-close]').click();assert.equal(await page.locator('#drawer.open').count(),0);assert.deepEqual(errors,[]);
   console.log(JSON.stringify({ok:true,engine:engine.name(),viewports:3,measured}));
  }finally{await browser.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
