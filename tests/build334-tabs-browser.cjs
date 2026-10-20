'use strict';
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {serve}=require('./helpers/web-server');
const {drawFounderSignature}=require('./helpers/signature-input');
const out=path.resolve(__dirname,'../verification');
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const server=await serve(path.resolve(__dirname,'../WebApp'));
 const browser=await chromium.launch({headless:true});
 const results=[],errors=[];
 try{
  for(const viewport of [{width:844,height:390}]){
   const orientation=viewport.width>viewport.height?'landscape':'portrait';
   const context=await browser.newContext({viewport,deviceScaleFactor:2,hasTouch:true,locale:'ar-SA'});
   const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push({orientation,message:e.message}));
   await page.route(/https:\/\/(tile\.openstreetmap\.org|server\.arcgisonline\.com)\//,r=>r.abort());
   await page.goto(server.baseURL);
   assert.equal(await page.locator('#signatureDialog').isVisible(),false,'a new game must not receive the upgrade dialog');
   await page.selectOption('#founderMode','sandbox');await page.click('#founderReview');await drawFounderSignature(page);
   await page.locator('#founderForm button[type=submit]').click();await page.waitForFunction(()=>window.__GH_STATE__?.onboardingComplete&&!window.__GH_DURABLE_COMMAND_CONTEXT__&&!document.getElementById('app')?.hasAttribute('inert'));
   if(await page.evaluate(()=>__GH_STATE__.speed>0))await page.locator('#speedToggle').click();
   assert.equal(await page.evaluate(()=>__GH_STATE__.speed),0);
   await page.evaluate(()=>{const prepare=GH_INTERFACE.prepare;window.GH_INTERFACE={...GH_INTERFACE,prepare(root,panel,arg,ctx){window.qaTabContext=ctx;return prepare(root,panel,arg,ctx);}};});
   const click=locator=>orientation==='portrait'?locator.tap():locator.click();
   const before=await page.evaluate(()=>JSON.stringify(Object.fromEntries(['cash','companyFinance','assets','globalBases','customRoutes','hired','crew','openedCompanies','profile'].map(k=>[k,__GH_STATE__[k]]))));
   for(const kind of ['companies','labor']){
    try{
     if(kind==='companies'){
      await click(page.locator('.side-nav [data-panel=groupHub]'));
      await click(page.locator('#sectionNav').getByRole('button',{name:'الشركات',exact:true}));
      await click(page.getByRole('button',{name:'الشركات التابعة',exact:true}));
      assert.equal(await page.locator('#drawerBody .company-open-list').count(),1,'actual subsidiaries click must render the companies available to open');
      assert.equal(await page.locator('#drawerBody [data-companytab="subs"].active').count(),1);
      assert((await page.locator('#drawerBody .company-open-row').count())>0);
      assert(await page.locator('#drawerBody .company-open-row [data-open="formationContract"]').first().isVisible(),'the opening contract must be reachable without opening a collapsed section');
      await page.screenshot({path:path.join(out,`334-tabs-companies-${orientation}.png`)});
      assert.equal(await page.evaluate(()=>qaTabContext.save()),true,'persist the UI selection through the original save owner');
      await page.reload();await page.waitForFunction(()=>window.__GH_STATE__?.onboardingComplete&&!window.__GH_DURABLE_COMMAND_CONTEXT__&&!document.getElementById('app')?.hasAttribute('inert'));
      assert.equal(await page.locator('#signatureDialog').isVisible(),false,'a valid mandate must survive reload');
      assert.equal(await page.locator('#drawerBody [data-companytab="subs"].active').count(),1,'selected subsidiaries tab must survive save/reload');
      await click(page.getByRole('button',{name:'الشركة القابضة',exact:true}));
      assert.equal(await page.locator('#drawerBody [data-companytab="holding"].active').count(),1);
      assert.equal(await page.locator('#drawerBody .company-visual-grid').count(),0);
     }else{
      // Build 373: the people section strip owns the HR tabs; the page's own bar is hidden so no button shows twice.
      const tabs=[['jobs','الوظائف'],['managers','المديرون التنفيذيون'],['contracts','عقود العمل'],['payroll','الرواتب'],['dashboard','تغطية الوظائف']];
      for(const [id,label] of tabs){
       // Build 373: people have their own rail section.
       await click(page.locator('.side-nav [data-panel=peopleHub]'));
       await click(page.locator('#drawerBody [data-tile="coverage"]'));
       await click(page.locator('#sectionNav').getByRole('button',{name:label,exact:true}));
       assert.equal(await page.locator(`#drawerBody [data-labortab="${id}"].active`).count(),1,`actual HR click must activate ${id}`);
       assert.equal(await page.locator(`#sectionNav [aria-current=page]`).innerText(),label,`the strip marks ${id} as the current page`);
       assert.equal(await page.locator('#drawerBody [data-labortab]:visible').count(),0,'the HR tabs are not shown twice');
       assert((await page.locator('#drawerBody').innerText()).trim().length>20,`${id} renders its content`);
      }
      await page.screenshot({path:path.join(out,`334-tabs-hr-${orientation}.png`)});
     }
     results.push({orientation,kind,result:'passed',realPointerInput:true});
    }catch(e){results.push({orientation,kind,result:'failed',error:e.message});}
   }
   const after=await page.evaluate(()=>JSON.stringify(Object.fromEntries(['cash','companyFinance','assets','globalBases','customRoutes','hired','crew','openedCompanies','profile'].map(k=>[k,__GH_STATE__[k]]))));
   assert.equal(after,before,'navigation must not mutate ownership, money, staff or custom identity');
   assert.equal(await page.locator('#speedMenu [data-speed]').count(),3);
   assert.equal(await page.locator('#speedMenu').innerText(),'30×\n120×\n300×','the supported speed cap is visible and excludes 600×');
   const map=await page.locator('#map').boundingBox();assert(map&&map.width>0&&map.height>0,'map must remain present');
   await context.close();
  }
  fs.writeFileSync(path.join(out,'334-tabs-browser-results.json'),JSON.stringify({results,errors},null,2));
  console.log(JSON.stringify({results,errors},null,2));
  assert.deepEqual(errors,[]);assert(results.every(r=>r.result==='passed'),'a visible tab failed its actual click');
 }finally{await browser.close();await server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
