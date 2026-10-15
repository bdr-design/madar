'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright'),{serve}=require('./helpers/web-server'),{drawFounderSignature}=require('./helpers/signature-input');
const ROOT=path.resolve(__dirname,'..'),DAY=86400,results=[];let server;
async function prepare(browser){
 const errors=[],page=await browser.newPage({viewport:{width:932,height:430},locale:'ar-SA',isMobile:true,hasTouch:true});page.setDefaultTimeout(60000);
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.route('**/app.js',r=>{const source=fs.readFileSync(path.join(ROOT,'WebApp/app.js'),'utf8'),i=source.lastIndexOf('})();');return r.fulfill({contentType:'text/javascript',body:source.slice(0,i)+'\nwindow.__DEALER_FIX__={openDrawer,closeDrawer,runAuthorizedDomainCommand,requestCalendarAdvance};\n'+source.slice(i)});});
 await page.route(/https:\/\/(tile\.openstreetmap\.org|server\.arcgisonline\.com)\//,r=>r.abort());
 await page.goto(server.baseURL);await page.selectOption('#founderMode','sandbox');await page.click('#founderReview');await drawFounderSignature(page);await page.locator('#founderForm button[type=submit]').click();await page.waitForFunction(()=>__GH_STATE__?.onboardingComplete);
 if(await page.evaluate(()=>__GH_STATE__.speed>0))await page.tap('#speedToggle');
 await page.evaluate(()=>{__GH_STATE__.godMoney=true;__GH_STATE__.infiniteMoney=true;__DEALER_FIX__.openDrawer('companies','subs');});
 await page.locator('.open-all-companies').click();await page.locator('dialog.ui-confirm [data-confirm="accept"]').click();await page.waitForFunction(()=>GH_COMPANY_PLATFORM.listInstances(__GH_STATE__,{includeGroup:false}).every(c=>c.operational));
 for(const c of ['bank','dealership']){await page.evaluate(()=>__DEALER_FIX__.openDrawer('network'));await page.selectOption('#worldKind',c);await page.locator('.open-directory-site').first().click();await page.waitForFunction(c=>__GH_STATE__.customHubs.some(f=>f.owned&&(f.ownerCompanyId||f.company)===c),c);}
 await page.evaluate(()=>{__GH_STATE__.godMoney=false;__GH_STATE__.infiniteMoney=false;__DEALER_FIX__.closeDrawer();});await advance(page,2);return {page,errors};
}
async function advance(page,day){assert.equal(await page.evaluate(day=>__DEALER_FIX__.requestCalendarAdvance(day*86400,'dealer-regression','اختبار ترحيل الوكالة'),day),true);await page.waitForFunction(day=>__GH_STATE__.simSeconds>=day*86400&&!GH_SIM_KERNEL.snapshot().manualAdvance,day);}
async function read(page){return page.evaluate(()=>{
 const s=__GH_STATE__,root=s.customerCompanies.companies.dealership,M=GH_DEALER_MARKET;
 return {cash:GH_FINANCE_CORE.operating(s,'dealership'),pending:root.pendingSaleAccrual||null,report:s.finance.dailyCompanyReports[0].companies.dealership,
 row:M.read(s).dailyHistory[0],valid:GH_SAVE_SCHEMA.validate(s).ok,sales:root.sales.filter(r=>r.id.startsWith('FIX-')),
 stock:root.inventory.map(r=>({model:r.modelId,quantity:r.quantity,reserved:r.reserved,sold:r.sold})),proofs:GH_DOCUMENT_PROOF.forensicInspectStateProofs(s).ok};
 });}
async function sell(page){await page.evaluate(async()=>{
 const branchId=GH_DEALER_MARKET.read(__GH_STATE__).showrooms[0].branchId;
 for(const [saleId,financeRequested,customerName] of [['FIX-DIRECT',false,'عميل اختبار مباشر'],['FIX-FINANCED',true,'عميل اختبار التمويل']]){
  await __DEALER_FIX__.runAuthorizedDomainCommand({domain:'customer-companies',name:'retail-sale',payload:{company:'dealership',branchId,saleId,customerName,modelId:'corolla',quantity:1,termsDays:0,financeRequested,downPayment:0},silent:true});
  if(financeRequested){const sale=__GH_STATE__.customerCompanies.companies.dealership.sales.find(r=>r.id===saleId);if(sale.status==='sold-financed'){await __DEALER_FIX__.runAuthorizedDomainCommand({domain:'customer-companies',name:'settle-financed-sale',payload:{company:'dealership',saleId},silent:true});continue;}
   await __DEALER_FIX__.runAuthorizedDomainCommand({domain:'banking',name:'decide-loan-request',payload:{id:sale.bankApplicationId,decision:'approve'},silent:true});
   await __DEALER_FIX__.runAuthorizedDomainCommand({domain:'customer-companies',name:'settle-financed-sale',payload:{company:'dealership',saleId},silent:true});
  }
 }
 });}
(async()=>{server=await serve(path.join(ROOT,'WebApp'));try{
 for(const engine of [chromium,webkit]){const browser=await engine.launch({headless:true});try{
  const base=await prepare(browser),changed=await prepare(browser),before=await read(changed.page);await sell(changed.page);const delivered=await read(changed.page);
  assert.ok(Math.abs(delivered.cash-before.cash-44800)<.01);assert.equal(delivered.pending.revenue,44800);assert.equal(delivered.pending.cost,41200);assert.equal(delivered.pending.units,2);
  await changed.page.reload();await changed.page.waitForFunction(()=>__GH_STATE__?.onboardingComplete);const loaded=await read(changed.page);assert.equal(loaded.pending.revenue,44800);assert.equal(loaded.cash,delivered.cash);
  await advance(base.page,3);await advance(changed.page,3);const a=await read(base.page),b=await read(changed.page);
  assert.ok(Math.abs(b.report.grossRevenue-a.report.grossRevenue-44800)<.01);assert.ok(Math.abs(b.report.expenses-a.report.expenses-41200)<.01);assert.ok(Math.abs(b.report.net-a.report.net-3600)<.01);assert.equal(b.pending.revenue,0);assert.equal(b.row.namedUnits,2);assert.equal(b.valid,true);assert.equal(b.proofs,true);
  await sell(changed.page);const replay=await read(changed.page);assert.equal(replay.cash,b.cash);assert.deepEqual(replay.stock,b.stock);assert.equal(replay.pending.revenue,0);
  await changed.page.reload();await changed.page.waitForFunction(()=>__GH_STATE__?.onboardingComplete);const replayLoaded=await read(changed.page);assert.equal(replayLoaded.report.net,b.report.net);assert.equal(replayLoaded.pending.revenue,0);
  await advance(changed.page,4);const next=await read(changed.page);assert.equal(next.row.namedSales,0);assert.equal(next.pending.revenue,0);assert.equal(next.valid,true);assert.equal(next.proofs,true);assert.deepEqual([...base.errors,...changed.errors],[]);
  results.push({engine:engine.name(),received:44800,addedRevenue:b.report.grossRevenue-a.report.grossRevenue,addedCost:b.report.expenses-a.report.expenses,addedNet:b.report.net-a.report.net,reload:true,replay:true,proofs:true});
  console.log('DEALER_LEDGER_STOCK_BROWSER_PASS',engine.name());
 }finally{await browser.close();}}
 const dir=path.join(ROOT,'verification');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'dealer-ledger-and-stock-browser.json'),JSON.stringify(results,null,2));
 }finally{await server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
