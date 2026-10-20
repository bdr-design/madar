'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright'),{serve}=require('./helpers/web-server'),{drawFounderSignature}=require('./helpers/signature-input');
const ROOT=path.resolve(__dirname,'..'),results=[];let server;
async function boot(browser,errors){
 const page=await browser.newPage({viewport:{width:932,height:430},locale:'ar-SA',isMobile:true,hasTouch:true});page.setDefaultTimeout(60000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.route('**/app.js',r=>{const source=fs.readFileSync(path.join(ROOT,'WebApp/app.js'),'utf8'),i=source.lastIndexOf('})();');return r.fulfill({contentType:'text/javascript',body:source.slice(0,i)+'\nwindow.__TAX_FIX__={openDrawer,closeDrawer,runAuthorizedDomainCommand,requestCalendarAdvance,invoiceArt,isIdle:liveStateWritable};\n'+source.slice(i)});});
 await page.route(/https:\/\/(tile\.openstreetmap\.org|server\.arcgisonline\.com)\//,r=>r.abort());
 await page.goto(server.baseURL);await page.selectOption('#founderMode','sandbox');await page.click('#founderReview');await drawFounderSignature(page);await page.locator('#founderForm button[type=submit]').click();await page.waitForFunction(()=>window.__GH_STATE__?.onboardingComplete&&!window.__GH_DURABLE_COMMAND_CONTEXT__&&!document.getElementById('app')?.hasAttribute('inert'));if(await page.evaluate(()=>__GH_STATE__.speed>0))await page.tap('#speedToggle');return page;
}
const settled=page=>page.waitForFunction(()=>window.__TAX_FIX__?.isIdle()===true,null,{timeout:180000});
async function call(page,name,payload){await settled(page);return page.evaluate(async({name,payload})=>__TAX_FIX__.runAuthorizedDomainCommand({domain:'finance',name,payload,silent:true}),{name,payload});}
async function advance(page,day){await settled(page);assert.equal(await page.evaluate(day=>__TAX_FIX__.requestCalendarAdvance(day*86400,'tax-regression','اختبار الضريبة'),day),true);await page.waitForFunction(day=>!GH_SIM_KERNEL.snapshot().manualAdvance&&(__GH_STATE__.simSeconds>=day*86400||GH_SIM_KERNEL.snapshot().lastError),day,{timeout:180000});assert.ok(await page.evaluate(day=>__GH_STATE__.simSeconds>=day*86400,day),JSON.stringify(await page.evaluate(()=>GH_SIM_KERNEL.snapshot())));}
(async()=>{server=await serve(path.join(ROOT,'WebApp'));try{
 for(const engine of [chromium,webkit]){const browser=await engine.launch({headless:true}),errors=[];try{
  let page=await boot(browser,errors);await page.evaluate(()=>{__GH_STATE__.godMoney=true;__GH_STATE__.infiniteMoney=true;__TAX_FIX__.openDrawer('companies','subs');});
  await page.locator('.open-all-companies').click();await page.locator('dialog.ui-confirm [data-confirm="accept"]').click();await page.waitForFunction(()=>GH_COMPANY_PLATFORM.listInstances(__GH_STATE__,{includeGroup:false}).every(c=>c.operational));
  await page.evaluate(async()=>{for(const [companyId,base,taxId] of [['tax-air-extra','air','300000000000013'],['tax-sea-extra','sea','300000000000023']]){const d=GH_COMPANY_PLATFORM.definitionFor(__GH_STATE__,base);await __TAX_FIX__.runAuthorizedDomainCommand({domain:'corporate',name:'open-company',payload:{companyId,type:companyId,definitionId:d.definitionId,capital:d.founding.defaultCapital,legalName:'QA '+companyId,taxId,formationContract:'INC-'+companyId},silent:true});}__GH_STATE__.godMoney=false;__GH_STATE__.infiniteMoney=false;});
  const ids=await page.evaluate(()=>GH_FINANCE_CORE.companyIds(__GH_STATE__,{openedOnly:true}));assert.equal(ids.length,14);
  for(const company of ids){await call(page,'credit',{company,amount:1150,taxable:true,reference:'TAX-FIX-SALE-'+company,note:'QA taxable sale'});await call(page,'spend',{company,amount:230,taxable:true,note:'QA taxable expense'});}
  await call(page,'close-vat-period',{day:30});
  const before=await page.evaluate(()=>{const s=__GH_STATE__,F=GH_FINANCE_CORE;return F.companyIds(s,{openedOnly:true}).map(c=>{const invoice=s.finance.invoices.find(r=>r.sourceRef==='TAX-FIX-SALE-'+c);return {company:c,cash:F.operating(s,c),number:F.companyTaxNumber(s,c),invoiceTaxNumber:invoice.taxNumber,rendered:__TAX_FIX__.invoiceArt(invoice),due:F.book(s,c).taxPayable};});});
  for(const r of before){assert.equal(r.due,120);assert.equal(r.invoiceTaxNumber,r.number);assert.ok(r.rendered.includes(r.number));}
  await page.evaluate(()=>__TAX_FIX__.openDrawer('invoices',{company:'all',tab:'obligations',view:'taxes'}));assert.equal(await page.locator('.tax-company-live-row').count(),14);
  const revision=await page.evaluate(()=>__GH_STATE__.saveRevision);await page.locator('.pay-all-taxes').tap();await page.waitForFunction(r=>__GH_STATE__.saveRevision>r,revision);
  const paid=await page.evaluate(()=>{const s=__GH_STATE__,F=GH_FINANCE_CORE;return {valid:GH_SAVE_SCHEMA.validate(s).ok,proofs:GH_DOCUMENT_PROOF.forensicInspectStateProofs(s).ok,revision:s.saveRevision,rows:F.companyIds(s,{openedOnly:true}).map(c=>{const t=s.finance.taxSettlements.find(r=>r.company===c),q=s.finance.cheques.find(r=>r.id===t.chequeId);return {company:c,cash:F.operating(s,c),number:t.taxNumber,amount:t.amountPaid,status:q.status,proof:GH_DOCUMENT_PROOF.verifyDocument(s,q).ok};})};});
  assert.equal(paid.revision,revision+1);assert.equal(paid.valid,true);assert.equal(paid.proofs,true);
  for(const r of paid.rows){const old=before.find(v=>v.company===r.company);assert.ok(Math.abs(old.cash-r.cash-120)<.01);assert.equal(r.number,old.number);assert.equal(r.amount,120);assert.equal(r.status,'مصروف');assert.equal(r.proof,true);}
  const financial=()=>page.evaluate(()=>JSON.stringify([__GH_STATE__.companyFinance,__GH_STATE__.finance]));const prior=await financial();
  await call(page,'close-vat-period',{day:30});assert.equal(await financial(),prior,'new approval cannot rebind or modify already closed/paid periods');
  await page.reload();await page.waitForFunction(()=>window.__GH_STATE__?.onboardingComplete&&!window.__GH_DURABLE_COMMAND_CONTEXT__&&!document.getElementById('app')?.hasAttribute('inert'));assert.equal(await financial(),prior);
  await call(page,'close-vat-period',{day:30});assert.equal(await financial(),prior);
  // The deliberately closed/paid period above is immutable. Actual operating revenue is tested in a fresh save.
  await page.close();page=await boot(browser,errors);await page.evaluate(()=>{__GH_STATE__.godMoney=true;__GH_STATE__.infiniteMoney=true;__TAX_FIX__.openDrawer('companies','subs');});await page.locator('.open-all-companies').click();await page.locator('dialog.ui-confirm [data-confirm="accept"]').click();await page.waitForFunction(()=>GH_COMPANY_PLATFORM.listInstances(__GH_STATE__,{includeGroup:false}).every(c=>c.operational));await page.evaluate(()=>{__GH_STATE__.godMoney=false;__GH_STATE__.infiniteMoney=false;});
  await page.evaluate(()=>__TAX_FIX__.openDrawer('network'));await page.selectOption('#worldKind','telecom');
  const india=await page.locator('#worldCountry option').evaluateAll(rows=>rows.find(r=>r.textContent.includes('الهند'))?.value);assert.ok(india);await page.selectOption('#worldCountry',india);await page.locator('.open-directory-site').first().click();await settled(page);
  for(const c of ['bank','realestate','insurance']){await page.evaluate(()=>__TAX_FIX__.openDrawer('network'));await page.selectOption('#worldKind',c);await page.locator('.open-directory-site').first().click();await settled(page);}
  await advance(page,1);
  await page.evaluate(async()=>{for(const variant of ['residential','office']){const A=GH_OPERATING_ACQUISITIONS,t=A.targets(__GH_STATE__,'realestate')[0],q=A.quote(__GH_STATE__,'realestate',t.id,variant);await __TAX_FIX__.runAuthorizedDomainCommand({domain:'realestate',name:'acquire-operating',payload:{targetId:q.targetId,variant:q.variant,quoteKey:q.quoteKey},idempotencyKey:q.id,silent:true});}__TAX_FIX__.closeDrawer();});
  await page.evaluate(async()=>{const A=GH_OPERATING_ACQUISITIONS,t=A.targets(__GH_STATE__,'insurance')[0],q=A.quote(__GH_STATE__,'insurance',t.id,'motor');await __TAX_FIX__.runAuthorizedDomainCommand({domain:'insurance',name:'acquire-operating',payload:{targetId:q.targetId,variant:q.variant,quoteKey:q.quoteKey},idempotencyKey:q.id,silent:true});});
  await advance(page,34);
  const actual=await page.evaluate(()=>{const s=__GH_STATE__;return {valid:GH_SAVE_SCHEMA.validate(s).ok,proofs:GH_DOCUMENT_PROOF.forensicInspectStateProofs(s).ok,
   bank:s.finance.invoices.filter(r=>r.company==='bank'&&r.taxCode==='mixed').slice(0,4),rent:s.finance.invoices.filter(r=>r.company==='realestate'&&String(r.sourceRef).startsWith('RENT-EXT:')),
   walkIn:s.finance.invoices.filter(r=>r.company==='realestate'&&r.taxCode==='mixed'),reserveReturns:s.finance.invoices.filter(r=>r.company==='insurance'&&r.taxCode==='mixed'),
   india:s.finance.invoices.filter(r=>r.company==='telecom'&&r.businessLocationCountry==='الهند'),error:GH_SIM_KERNEL.snapshot().lastError||null};});
  assert.equal(actual.valid,true);assert.equal(actual.proofs,true);assert.equal(actual.error,null);assert.ok(actual.india.length>0);assert.ok(actual.india.every(r=>r.taxJurisdiction==='IN'&&r.taxRate===.15));
  const home=actual.rent.find(r=>r.taxCode==='residential-rent'),office=actual.rent.find(r=>r.taxCode==='commercial-rent');assert.ok(home);assert.equal(home.tax,0);assert.ok(office.tax>0);
  assert.ok(actual.bank.length>0);for(const invoice of actual.bank){assert.equal(invoice.lines.find(r=>r.taxCode==='financial-interest').vat,0);assert.ok(Math.abs(invoice.tax-invoice.lines.find(r=>r.taxCode==='standard').vat)<.01);}
  assert.ok(actual.walkIn.some(r=>r.lines.some(l=>l.taxCode==='residential-rent'&&l.total>0)),'walk-in residential cash reaches its exempt invoice component');
  for(const invoice of actual.walkIn)assert.equal(invoice.lines.find(r=>r.taxCode==='residential-rent').vat,0);
  assert.ok(actual.reserveReturns.some(r=>r.lines.some(l=>l.taxCode==='financial-interest'&&l.total>0)),'real reserve interest reaches its exempt invoice component');
  for(const invoice of actual.reserveReturns)assert.equal(invoice.lines.find(r=>r.taxCode==='financial-interest').vat,0);
  assert.deepEqual(errors,[]);results.push({engine:engine.name(),companies:14,cents:true,closedReplay:true,reload:true,bankMixed:true,residentialExempt:true,walkInExempt:true,reserveReturnsExempt:true,officeTaxed:true,indiaJurisdiction:'IN',indiaRate:.15,proofs:true});console.log('TAX_PRECISION_ROUTING_BROWSER_PASS',engine.name());
 }finally{await browser.close();}}
 const dir=path.join(ROOT,'verification');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'tax-precision-and-routing-browser.json'),JSON.stringify(results,null,2));
 }finally{await server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
