'use strict';
// Build 373 (owner's approved design): a company without transport assets (insurance, real estate, bank, telecom, car
// dealership) opens on its revenue chain instead of the image hero and tiles: five steps, the next step, the decisions
// waiting for the player and a light link to every page the tiles opened. Its decisions are accepted or rejected one by
// one or all in one batch through the owners' existing batch commands. Here, in the real app: each panel shows its
// chain with no image and every former tile still reachable; three insurance risks are accepted in one batch, two
// tenant requests rejected in one batch, one bank request rejected alone, and the dealership's customer-finance request
// rejected from its own panel without touching the bank's other request.
const assert=require('node:assert/strict');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');
const KINDS=['insurance','realestate','bank','telecom','dealership'];

(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[],dialogs=[];
  try{
    const {page}=await boot({browser,errors});page.setDefaultTimeout(30000);
    page.on('dialog',dialog=>{dialogs.push(dialog.message());dialog.accept();});
    await page.evaluate(async kinds=>{
      const a=__AUDIT__,s=__GH_STATE__;s.godMoney=true;s.infiniteMoney=true;
      for(const type of kinds)await a.runAuthorizedDomainCommand('corporate','open-company',{type,companyId:type,capital:900000000,legalName:`QA ${type}`,formationContract:`QA-CHAIN-${type}`},{silent:true});
    },KINDS);

    for(const id of KINDS){
      await page.evaluate(id=>__AUDIT__.openDrawer('company',id),id);
      const panel=await page.evaluate(()=>{const root=document.querySelector('#drawerBody .mc-chained');if(!root)return null;return {steps:root.querySelectorAll('.mc-step').length,now:root.querySelectorAll('.mc-step.is-now').length,next:!!root.querySelector('.mc-next [data-go]'),start:!!root.querySelector('.mc-start'),images:root.querySelectorAll('img').length,oldTiles:root.querySelectorAll('.mc-tile').length,pages:[...root.querySelectorAll('.mc-page')].map(button=>`${button.dataset.go}|${button.dataset.goArg||''}`),strip:[...document.querySelectorAll('#sectionNav [data-go]')].map(button=>`${button.dataset.go}|${button.dataset.goArg||''}`)};});
      assert.ok(panel,`${id}: the revenue chain replaces the old panel`);
      assert.equal(panel.steps,5,`${id}: five steps`);assert.equal(panel.now,1,`${id}: one current step`);assert.equal(panel.next,true,`${id}: the next step opens a page`);assert.equal(panel.start,true,`${id}: a new company starts from the first step`);
      assert.equal(panel.images,0,`${id}: no image in the panel`);assert.equal(panel.oldTiles,0,`${id}: no image tile`);
      for(const target of panel.pages)assert.ok(panel.strip.includes(target),`${id}: page ${target} is also in the page strip`);
      assert.ok(panel.pages.length>=6,`${id}: every former tile stays reachable: ${panel.pages.length}`);
    }

    await page.evaluate(()=>{
      const s=__GH_STATE__,day=Math.floor(s.simSeconds/86400);
      s.insurance.riskRequests=[1,2,3].map(i=>({id:`RISK-90${i}`,day,expiresDay:day+7,subject:`QA risk ${i}`,officeId:'QA',grade:'A',sumInsured:1e6*i,premium:1e4*i,expectedLoss:1e3*i,status:'بانتظار القرار'}));
      s.realEstate.tenantRequests=[1,2].map(i=>({id:`RE-REQ-90${i}`,day,expiresDay:day+10,tenant:`QA tenant ${i}`,projectId:'QA',projectName:'QA',units:10*i,rentLevel:1,annualRent:1e5*i,years:3,status:'بانتظار القرار'}));
      s.bank.loanRequests=[{id:'REQ-901',day,expiresDay:day+7,borrower:'QA borrower 1',sector:'consumer',product:'consumer',amount:5e5,termDays:365,riskGrade:'A',collateralCoverage:1,branchId:'QA'},{id:'REQ-902',day,expiresDay:day+7,borrower:'QA borrower 2',sector:'consumer',product:'consumer',amount:7e5,termDays:365,riskGrade:'BB',collateralCoverage:.5,branchId:'QA'},{id:'REQ-903',day,expiresDay:day+7,borrower:'QA dealer customer',sector:'consumer',product:'consumer',amount:9e4,termDays:365,riskGrade:'A',collateralCoverage:1,branchId:'QA',sourceCompanyId:'dealership',customerId:'QA-C',sourceSaleId:'QA-S'}];
    });
    const pending=()=>page.evaluate(()=>({risks:__GH_STATE__.insurance.riskRequests.map(row=>row.id),tenants:__GH_STATE__.realEstate.tenantRequests.map(row=>row.id),loans:__GH_STATE__.bank.loanRequests.map(row=>row.id),alert:String(__GH_STATE__.alerts?.[0]?.text||__GH_STATE__.alerts?.[0]||'')}));
    const press=async(id,selector)=>{await page.evaluate(id=>__AUDIT__.openDrawer('company',id),id);const button=page.locator(selector).first();assert.equal(await button.count(),1,`${id}: ${selector}`);await button.click();await page.waitForFunction(()=>!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked());await page.waitForTimeout(300);return pending();};
    const all=decision=>`#drawerBody [data-gh-action="company-decide-pending"][data-decision="${decision}"]:not([data-request])`;

    await page.evaluate(()=>__AUDIT__.openDrawer('company','insurance'));
    assert.deepEqual(await page.evaluate(()=>[...document.querySelectorAll('#drawerBody .mc-bulk button')].map(button=>button.textContent.trim())),['قبول الكل (3)','رفض الكل (3)']);
    let after=await press('insurance',all('accept'));
    assert.deepEqual(after.risks,[],'all three risks decided in one batch');assert.match(after.alert,/3 مقبول/);
    after=await press('realestate',all('reject'));
    assert.deepEqual(after.tenants,[],'both tenant requests rejected in one batch');assert.match(after.alert,/2 معتذر عنه/);
    after=await press('bank','#drawerBody [data-gh-action="company-decide-pending"][data-decision="reject"][data-request="REQ-901"]');
    assert.deepEqual(after.loans,['REQ-902','REQ-903'],'one row decides only its own request');
    after=await press('dealership',all('reject').replace(':not([data-request])',''));
    assert.deepEqual(after.loans,['REQ-902'],'the dealership decides only its customer-finance request');
    assert.deepEqual(dialogs,['قبول 3 مخاطر تأمين في قرار جماعي واحد؟','رفض 2 طلبات إيجار في قرار جماعي واحد؟','رفض هذا الطلب في قرار واحد؟','رفض هذا الطلب في قرار واحد؟'],'every decision is confirmed first');
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({suite:'build373-revenue-chain-browser',companies:KINDS.length,decided:{insuranceAccepted:3,tenantRequestsRejected:2,bankRejected:1,dealerRejected:1}}));
    console.log('BUILD373_REVENUE_CHAIN_PASS');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
