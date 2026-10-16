'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium,webkit}=require('playwright');
const {boot}=require('./helpers/local-dom-app'),{installVault}=require('./helpers/differential-vault-fixture.cjs');
const results=[];
(async()=>{for(const engine of [chromium,webkit]){
 const browser=await engine.launch({headless:true}),errors=[];let page;
 try{
  ({page}=await boot({browser,errors}));page.setDefaultTimeout(30000);
  const nativeDialogs=[];page.on('dialog',async dialog=>{nativeDialogs.push(dialog.message());await dialog.dismiss();});
  await page.evaluate(async()=>{await __AUDIT__.runAuthorizedDomainCommand('corporate','open-company',{type:'hospitality',capital:120000000},{silent:true});await __AUDIT__.runAuthorizedDomainCommand('corporate','open-company',{type:'bank',capital:100000000},{silent:true});__AUDIT__.openDrawer('hospitality',{company:'hospitality',tab:'properties'});});
  await page.evaluate(installVault);
  const snap=()=>page.evaluate(()=>({cash:GH_FINANCE_CORE.operating(__GH_STATE__,'hospitality'),revision:__GH_STATE__.saveRevision,hospitality:JSON.stringify(__GH_STATE__.hospitality||null),books:JSON.stringify(__GH_STATE__.companyFinance),sites:JSON.stringify(__GH_STATE__.customHubs)}));
  async function open(tab){await page.evaluate(tab=>__AUDIT__.openDrawer('hospitality',{company:'hospitality',tab}),tab);}
  async function review(name){const btn=page.locator(`[data-gh-action="hospitality-${name}"]`).first();await btn.click();await page.locator('.ui-confirm[open]').waitFor();return btn;}
  async function finish(){await page.waitForFunction(()=>!window.__GH_DURABLE_COMMAND_CONTEXT__&&!document.querySelector('.ui-confirm[open]')&&![...document.querySelectorAll('[data-gh-action^="hospitality-"]')].some(b=>b.dataset.busy));}
  async function accept(name){await review(name);await page.locator('.ui-confirm [data-confirm=accept]').click();await finish();}
  await page.selectOption('#hospCity','RUH');const beforeCancel=await snap(),button=await review('start-property');
  assert.deepEqual(await snap(),beforeCancel);await button.dispatchEvent('click');assert.equal(await page.locator('.ui-confirm[open]').count(),1);
  assert.equal(await page.evaluate(()=>new Promise(resolve=>{let n=0;const next=()=>++n===3?resolve(n):requestAnimationFrame(next);requestAnimationFrame(next);})),3);
  await page.locator('.ui-confirm [data-confirm=cancel]').click();await finish();assert.deepEqual(await snap(),beforeCancel);assert.equal(await page.evaluate(()=>__DIFF_VAULT__.attempts.length),0);
  results.push({engine:engine.name(),case:'creation cancellation and repeated clicks preserve balances and frames'});
  await page.evaluate(()=>{__DIFF_VAULT__.hold=true;__DIFF_VAULT__.attempts=[];});await review('start-property');await page.locator('.ui-confirm [data-confirm=accept]').click();await page.waitForFunction(()=>__DIFF_VAULT__.pending.length===1);
  assert.deepEqual(await snap(),beforeCancel,'no construction or money is published before native ACK');
  await page.evaluate(()=>{const q=__DIFF_VAULT__;q.hold=false;q.pending.splice(0).forEach(fn=>fn());});await finish();
  assert.equal(await page.evaluate(()=>GH_HOSPITALITY_CORE.read(__GH_STATE__).properties.length),1);assert.equal(await page.evaluate(()=>__DIFF_VAULT__.attempts.length),1);
  results.push({engine:engine.name(),case:'one native ACK publishes creation, payment, contract and notice together'});
  const beforeFailure=await snap();await page.evaluate(()=>{__DIFF_VAULT__.mode='commit-nack';__DIFF_VAULT__.attempts=[];});await accept('accelerate');assert.deepEqual(await snap(),beforeFailure);assert.equal(await page.evaluate(()=>__DIFF_VAULT__.attempts.length),1);
  results.push({engine:engine.name(),case:'native refusal restores accelerated construction and books without a second save'});
  await page.evaluate(()=>{__DIFF_VAULT__.mode='ok';__DIFF_VAULT__.attempts=[];});await accept('accelerate');assert.equal(await page.evaluate(()=>GH_HOSPITALITY_CORE.read(__GH_STATE__).properties[0].status),'operating');assert.equal(await page.evaluate(()=>__DIFF_VAULT__.attempts.length),1);
  await page.evaluate(()=>{__DIFF_VAULT__.attempts=[];});await accept('hire');assert.equal(await page.evaluate(()=>GH_HOSPITALITY_CORE.summary(__GH_STATE__).properties[0].staffing.coverage),1);assert.equal(await page.evaluate(()=>__DIFF_VAULT__.attempts.length),1);
  results.push({engine:engine.name(),case:'acceleration finishes the actual building and hiring uses one saved command'});
  await open('reservations');await page.fill('#hospCustomer','شركة حجز المتصفح');await page.fill('#hospRooms','3');await page.fill('#hospArrival','2026-01-21');await page.fill('#hospDeparture','2026-01-24');await accept('reserve');
  assert.equal(await page.evaluate(()=>GH_HOSPITALITY_CORE.read(__GH_STATE__).bookings.length),1);
  assert.equal(await page.evaluate(()=>__AUDIT__.requestCalendarAdvance(14*86400,'hospitality-regression','اختبار إقفال الضيافة')),true);await page.waitForFunction(()=>!GH_SIM_KERNEL.snapshot().manualAdvance&&__GH_STATE__.lastFinancialDay===14&&GH_HOSPITALITY_CORE.read(__GH_STATE__).lastProcessedDay===14,null,{timeout:90000});assert(await page.evaluate(()=>__GH_STATE__.bank.dailyHistory.some(r=>r.day===14)),'the real calendar also runs the staged bank owner');
  const day=await page.evaluate(()=>({lastDay:GH_HOSPITALITY_CORE.read(__GH_STATE__).lastProcessedDay,deposit:GH_HOSPITALITY_CORE.read(__GH_STATE__).bookings[0].depositCollected,daily:__GH_STATE__.finance.dailyCompanyReports[0].companies.hospitality,outputVat:GH_FINANCE_CORE.book(__GH_STATE__,'hospitality').vat.output,critical:GH_INTEGRITY_CORE.check(__GH_STATE__).counts.critical}));
  assert.equal(day.lastDay,14);assert(day.deposit>0&&day.outputVat>0&&day.daily.operatingRevenue>0);assert.equal(day.critical,0);
  results.push({engine:engine.name(),case:'actual financial-day scheduler includes hospitality profit, deposits and VAT on January 15',...day});
  await open('reservations');await accept('cancel');await open('finance');const beforeRefund=await snap();await page.evaluate(()=>{__DIFF_VAULT__.attempts=[];});await accept('settle');const refunded=await snap();assert.equal(Math.round((beforeRefund.cash-refunded.cash)*100),day.deposit);assert.equal(await page.evaluate(()=>__DIFF_VAULT__.attempts.length),1);
  results.push({engine:engine.name(),case:'cancellation and one saved refund batch preserve customer rights'});
  for(const viewport of [{width:320,height:568},{width:390,height:844},{width:440,height:956},{width:844,height:390},{width:956,height:440}]){
   await page.setViewportSize(viewport);for(const tab of ['overview','properties','reservations','finance']){await open(tab);const box=await page.locator('.hospitality-panel').evaluate(node=>{const edge=node.getBoundingClientRect();return {client:node.clientWidth,scroll:node.scrollWidth,overflow:[...node.querySelectorAll('*')].filter(el=>{const r=el.getBoundingClientRect();return r.left<edge.left-1||r.right>edge.right+1;}).slice(0,8).map(el=>({tag:el.tagName,class:el.className,id:el.id,text:el.textContent.slice(0,70)}))};});assert(box.scroll<=box.client+1,`${engine.name()} ${JSON.stringify(viewport)} ${tab} overflows: ${JSON.stringify(box)}`);}
  }
  results.push({engine:engine.name(),case:'four panels fit five viewports from 320px to 956px in portrait and landscape'});
  const saved=await page.evaluate(()=>{const q=__DIFF_VAULT__;return {json:q.head,chunks:[...q.chunks].map(([id,bytes])=>[id,GH_STATE_CODEC.bytesToBase64(bytes)]),hospitality:JSON.stringify(__GH_STATE__.hospitality),books:JSON.stringify(__GH_STATE__.companyFinance)};});
  const commitsBeforeDensity=await page.evaluate(()=>__DIFF_VAULT__.attempts.length);
  // Read-only synthetic density: restore the genuine saved state immediately after this UI-only case.
  await page.evaluate(()=>{const root=GH_HOSPITALITY_CORE.read(__GH_STATE__),base=root.properties[0];root.properties=Array.from({length:500},(_,i)=>({...structuredClone(base),id:'HOSP-UI-'+i,facilityId:'HOSP-UI-'+i,name:'منشأة عرض '+i,...(i===0?{status:'closed',repairClaims:[{id:'ui-pending',coverageServiceId:'ui-policy'}]}:{})}));__AUDIT__.openDrawer('hospitality',{company:'hospitality',tab:'properties'});});
  assert.equal(await page.locator('.hospitality-property').count(),12);assert.equal(await page.locator('[data-gh-action="hospitality-claim"][data-repair="ui-pending"]').count(),1,'closed properties retain a visible claim action');const firstCard=await page.locator('.hospitality-property h4').first().textContent();await page.locator('.hospitality-actions button').filter({hasText:'التالي'}).last().click();assert.equal(await page.locator('.hospitality-property').count(),12);assert.notEqual(await page.locator('.hospitality-property h4').first().textContent(),firstCard);assert.equal(await page.evaluate(()=>__DIFF_VAULT__.attempts.length),commitsBeforeDensity);
  results.push({engine:engine.name(),case:'500 synthetic properties render twelve cards per page and pagination requests no save'});
  await page.close();({page}=await boot({browser,errors,beforeScripts:{fn:seed=>{GH_NATIVE_BUILD=362;window.__GH_NATIVE_SAVE_JSON__=seed.json;window.__GH_NATIVE_SAVE_CHUNKS__=new Map(seed.chunks.map(([id,b64])=>[id,Uint8Array.from(atob(b64),c=>c.charCodeAt(0)).buffer]));},arg:saved}}));
  const loaded=await page.evaluate(()=>({hospitality:JSON.stringify(__GH_STATE__.hospitality),books:JSON.stringify(__GH_STATE__.companyFinance),schema:GH_SAVE_SCHEMA.validate(__GH_STATE__),critical:GH_INTEGRITY_CORE.check(__GH_STATE__).counts.critical}));assert.equal(loaded.hospitality,saved.hospitality);assert.equal(loaded.books,saved.books);assert(loaded.schema.ok,JSON.stringify(loaded.schema));assert.equal(loaded.critical,0);assert.deepEqual(errors,[]);assert.deepEqual(nativeDialogs,[]);
  results.push({engine:engine.name(),case:'real native bootstrap restores hospitality, tax and books with no blocking dialogs'});
 }finally{await browser.close();}
}
if(process.env.GH_HOSPITALITY_BROWSER_RESULTS)fs.writeFileSync(process.env.GH_HOSPITALITY_BROWSER_RESULTS,JSON.stringify(results,null,2)+'\n');
console.log(JSON.stringify({suite:'build394-hospitality-browser',passed:results.length,results}));
})().catch(error=>{console.error(error);process.exitCode=1;});
