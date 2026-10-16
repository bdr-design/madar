'use strict';
const assert=require('node:assert/strict'),{chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');
(async()=>{const browser=await chromium.launch({headless:true}),errors=[];try{
 const {page}=await boot({browser,errors});page.setDefaultTimeout(15000);let nativeDialogs=0;page.on('dialog',async d=>{nativeDialogs++;await d.dismiss();});
 await page.evaluate(async()=>{const s=__GH_STATE__;s.godMoney=true;s.infiniteMoney=true;for(const type of ['bank','insurance','telecom','dealership'])await __AUDIT__.runAuthorizedDomainCommand('corporate','open-company',{type,capital:200000000,legalName:'QA Campaign '+type},{silent:true});
  for(const [company,kind] of [['insurance','insurance'],['telecom','telecom-branch'],['dealership','dealership-branch']])for(let i=0;i<2;i++)s.customHubs.push({id:`QA-UI-${company}-${i}`,kind,ownerCompanyId:company,owned:true,name:'QA branch',city:'الرياض',country:'السعودية',coords:[24+i*.01,46]});
  GH_BANKING_CORE.ensure(s).branchNetwork=Array.from({length:2},(_,i)=>({id:'QA-UI-B-'+i,city:'الرياض',country:'السعودية',servicesActive:true}));});
 for(const company of ['bank','insurance','telecom','dealership']){
  await page.evaluate(c=>__AUDIT__.openDrawer('companyManage',{type:c,tab:'overview'}),company);const real=page.locator(`[data-gh-action="company-campaign-all"][data-company="${company}"]`);assert.equal(await real.count(),1,company+' campaign button: '+JSON.stringify(await page.evaluate(()=>({panel:__AUDIT__.currentPanel(),arg:__AUDIT__.currentArg(),text:document.getElementById('drawerBody').textContent.slice(-400)}))));
  const snap=()=>page.evaluate(c=>({cash:GH_FINANCE_CORE.operating(__GH_STATE__,c),cheques:__GH_STATE__.finance.cheques.length,revision:__GH_STATE__.saveRevision}),company),before=await snap();
  await real.click();await page.locator('.ui-confirm').waitFor();
  const painted=await page.evaluate(()=>new Promise(resolve=>{let n=0;const step=()=>{if(++n===4)resolve(n);else requestAnimationFrame(step);};requestAnimationFrame(step);}));assert.equal(painted,4,'frames keep painting while confirmation waits');assert.deepEqual(await snap(),before);
  await page.locator('.ui-confirm [data-confirm=cancel]').click();await page.waitForTimeout(30);assert.deepEqual(await snap(),before,'cancel has no financial effect');
  await real.click();await page.locator('.ui-confirm [data-confirm=accept]').click();await page.waitForFunction(rev=>__GH_STATE__.saveRevision>rev,before.revision);await page.waitForFunction(()=>!globalThis.__GH_DURABLE_COMMAND_CONTEXT__);
  const after=await snap();assert.equal(after.cheques,before.cheques+1);assert.equal(after.revision,before.revision+1);assert.ok(after.cash<before.cash);assert.equal(await page.locator(`[data-gh-action="company-campaign-all"][data-company="${company}"]`).count(),0);
 }
 await page.evaluate(()=>{const s=__GH_STATE__,b=GH_BANKING_CORE.ensure(s);b.deposits=100000000;b.branchNetwork[0].deposits=100000000;b.loans=40000000;b.branchNetwork[0].loans=40000000;b.loanPortfolios=['air','sea','road','power'].map((sector,i)=>({id:'QA-OLD-LOAN-'+i,sector,product:'corporate',principal:10000000,outstanding:10000000,rate:.07,termDays:365,remainingDays:365,status:'نشطة',stage:1,pd:.01,lgd:.35}));b.loanRequests=[{id:'QA-UI-LOAN',day:0,expiresDay:7,borrower:'QA Borrower',product:'corporate',amount:1000000,termDays:365,riskGrade:'BBB',collateralCoverage:0,branchId:b.branchNetwork[0].id,sector:'services',status:'بانتظار القرار'}];GH_INSURANCE_CORE.ensure(s).riskRequests=[{id:'QA-UI-RISK',day:0,expiresDay:7,subject:'QA factory',officeId:s.insurance.offices[0].id,grade:'A',sumInsured:20000000,premium:160000,expectedLoss:90000,status:'بانتظار القرار'}];});
 for(const [company,action,decision] of [['bank','bank-loan-request','approve'],['insurance','insurance-decide-risk','accept']]){
  await page.evaluate(c=>__AUDIT__.openDrawer(c,{tab:'overview'}),company);const revision=await page.evaluate(()=>__GH_STATE__.saveRevision);
  await page.locator(`[data-gh-action="${action}"][data-decision="${decision}"]`).first().click();await page.waitForFunction(rev=>__GH_STATE__.saveRevision>rev,revision).catch(async error=>{throw new Error(company+' decision failed: '+await page.evaluate(()=>document.body.textContent.slice(-1600)));});await page.waitForFunction(()=>!globalThis.__GH_DURABLE_COMMAND_CONTEXT__);await page.waitForTimeout(70);
  assert.equal(await page.evaluate(()=>__GH_STATE__.saveRevision),revision+1,company+' decision must not save twice');
 }
 const accepted=await page.evaluate(()=>({loan:__GH_STATE__.bank.loanRequestHistory.find(r=>r.id==='QA-UI-LOAN')?.status,risk:__GH_STATE__.insurance.largeRisks.filter(r=>r.id==='QA-UI-RISK').length,critical:GH_INTEGRITY_CORE.check(__GH_STATE__).counts.critical}));
 assert.equal(accepted.loan,'موافق');assert.equal(accepted.risk,1);assert.equal(accepted.critical,0);
 assert.equal(nativeDialogs,0);assert.deepEqual(errors,[]);console.log(JSON.stringify({suite:'build382-campaign-decisions-browser',ok:true,companies:4,cancelAndFramesAndOneSave:true,bankAndInsuranceSingleSave:true,nativeDialogs}));
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
