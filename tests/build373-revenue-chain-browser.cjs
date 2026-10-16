'use strict';
// Build 373: the decisions waiting in a company without transport assets (insurance, real estate, bank, telecom, car
// dealership) are accepted or rejected one by one or all in one batch from its panel, through the owners' existing batch
// commands. Build 377 (owner's decision): the revenue-chain design is gone; these companies open on the same panel as
// the airline (the image hero with their main count, the image tiles, then "needs your decision"). Here, in the real
// app: each panel is the airline's, with no chain step, and every tile is also in the page strip; three insurance risks
// are accepted in one batch, two tenant requests rejected in one batch, one bank request rejected alone, and the
// dealership's customer-finance request rejected from its own panel without touching the bank's other request.
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
      const panel=await page.evaluate(id=>{const root=document.querySelector(`#drawerBody .madar-company[data-kind="${id}"]`);if(!root)return null;return {chain:root.querySelectorAll('.mc-chain,.mc-step,.mc-next,.mc-pages').length,chained:root.classList.contains('mc-chained'),hero:root.querySelectorAll('.mc-hero').length,count:root.querySelector('.mc-hero .mc-count')?.textContent.trim()||'',tiles:[...root.querySelectorAll('.mc-grid .mc-tile')].map(button=>({target:`${button.dataset.go}|${button.dataset.goArg||''}`,image:!!button.querySelector('img'),title:button.querySelector('.mc-text b')?.textContent.trim()||''})),strip:[...document.querySelectorAll('#sectionNav [data-go]')].map(button=>`${button.dataset.go}|${button.dataset.goArg||''}`)};},id);
      assert.ok(panel,`${id}: the company panel opens`);
      assert.equal(panel.chain,0,`${id}: no revenue-chain step`);assert.equal(panel.chained,false,`${id}: not the chain design`);
      assert.equal(panel.hero,1,`${id}: the airline's image hero`);assert.match(panel.count,/^\d[\d,]*$/,`${id}: the hero carries the company's main count`);
      assert.ok(panel.tiles.length>=5,`${id}: the airline's image tiles: ${panel.tiles.length}`);
      for(const tile of panel.tiles){assert.ok(tile.image&&tile.title,`${id}: tile ${tile.target} has its image and title`);assert.ok(panel.strip.includes(tile.target),`${id}: page ${tile.target} is also in the page strip`);}      // Build 378: at most three short chips, all on the hero's one line, none repeating the main count's label.
      const chips=await page.evaluate(id=>{const root=document.querySelector(`#drawerBody .madar-company[data-kind="${id}"]`),hero=root.querySelector('.mc-hero .mc-chips'),items=[...hero.querySelectorAll('.mc-chip')];return {texts:items.map(x=>x.textContent.trim()),label:root.querySelector('.mc-hero .mc-hero-count small')?.textContent.trim()||'',lines:new Set(items.map(x=>Math.round(x.getBoundingClientRect().top))).size};},id);
      assert.ok(chips.texts.length<=3&&chips.lines<=1,`${id}: chips fit one line: ${JSON.stringify(chips)}`);
      if(chips.label)assert.ok(!chips.texts.some(text=>text.startsWith(chips.label)),`${id}: no chip repeats the main count`);
    }

    await page.evaluate(()=>{
      const s=__GH_STATE__,day=Math.floor(s.simSeconds/86400);
      s.insurance.riskRequests=[1,2,3].map(i=>({id:`RISK-90${i}`,day,expiresDay:day+7,subject:`QA risk ${i}`,officeId:'QA',grade:'A',sumInsured:1e6*i,premium:1e4*i,expectedLoss:1e3*i,status:'بانتظار القرار'}));
      s.realEstate.tenantRequests=[1,2].map(i=>({id:`RE-REQ-90${i}`,day,expiresDay:day+10,tenant:`QA tenant ${i}`,projectId:'QA',projectName:'QA',units:10*i,rentLevel:1,annualRent:1e5*i,years:3,status:'بانتظار القرار'}));
      s.bank.loanRequests=[{id:'REQ-901',day,expiresDay:day+7,borrower:'QA borrower 1',sector:'consumer',product:'consumer',amount:5e5,termDays:365,riskGrade:'A',collateralCoverage:1,branchId:'QA'},{id:'REQ-902',day,expiresDay:day+7,borrower:'QA borrower 2',sector:'consumer',product:'consumer',amount:7e5,termDays:365,riskGrade:'BB',collateralCoverage:.5,branchId:'QA'},{id:'REQ-903',day,expiresDay:day+7,borrower:'QA dealer customer',sector:'consumer',product:'consumer',amount:9e4,termDays:365,riskGrade:'A',collateralCoverage:1,branchId:'QA',sourceCompanyId:'dealership',customerId:'QA-C',sourceSaleId:'QA-S'}];
    });
    const pending=()=>page.evaluate(()=>({risks:__GH_STATE__.insurance.riskRequests.map(row=>row.id),tenants:__GH_STATE__.realEstate.tenantRequests.map(row=>row.id),loans:__GH_STATE__.bank.loanRequests.map(row=>row.id),alert:String(__GH_STATE__.alerts?.[0]?.text||__GH_STATE__.alerts?.[0]||'')}));
    const press=async(id,selector)=>{await page.evaluate(id=>__AUDIT__.openDrawer('company',id),id);const button=page.locator(selector).first();assert.equal(await button.count(),1,`${id}: ${selector}`);await button.click();dialogs.push(await page.locator('.ui-confirm p').textContent());await page.locator('.ui-confirm [data-confirm="accept"]').click();await page.waitForFunction(()=>!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked());await page.waitForTimeout(300);return pending();};
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
