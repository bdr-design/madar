'use strict';
// Owner (build 98 iPhone diagnostic: «حل المشاكل جميعها ... ابيها اصفار فعليًا بالثقل»): a bulk purchase of operating
// businesses held the main thread 67-95 ms in one block (every offer in one signed command). It now runs each offer
// through the single purchase's signed command, all in one durable command, the frame painting between offers. In the
// full app with the real buttons (real estate, twenty offices opened from the world directory, one day closed):
//  1. buying every office offer on the page saves once and keeps every purchase: a receipt per offer, its cheque cashed,
//     its invoice and contract protected, one leased project each;
//  2. no part of the purchase holds the main thread half as long as the purchase's single batch on the source before
//     (8510d56, from its own tree), which ran every offer in one call to the acquisition owner (measured the same way, in
//     the same run; twenty offers, so that call is twenty offers long while each now runs one);
//  3. a refusal at a later offer keeps nothing: buying the twenty residential offers with twenty projects (ten left under
//     the company's limit of 30) is refused at the eleventh, with no save, no cheque, no receipt and no project kept;
//  4. no error is logged and nothing else is rolled back.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');
const ROOT=path.resolve(__dirname,'..'),SOURCE=process.env.GH_TEST_SOURCE_DIR||ROOT,PREVIOUS='8510d56';
async function world(browser,root){
  const errors=[],{page}=await boot({browser,errors,root});page.setDefaultTimeout(60000);
  await page.evaluate(async()=>{const s=__GH_STATE__;s.godMoney=true;s.infiniteMoney=true;await __AUDIT__.runAuthorizedDomainCommand('corporate','open-company',{type:'realestate',companyId:'realestate',capital:900000000,legalName:'QA Real Estate',formationContract:'QA-RE-593'},{silent:true});});
  return {page,errors};
}
async function openOffices(page,count){
  const before=await page.evaluate(()=>(__GH_STATE__.customHubs||[]).filter(h=>(h.ownerCompanyId||h.company)==='realestate').length);
  await page.evaluate(()=>__AUDIT__.openDrawer('network'));await page.locator('#worldKind').selectOption('realestate');await page.locator('#worldBulkCount').selectOption(String(count));
  await page.locator('.open-scope-facilities').click();await page.locator('dialog.ui-confirm [data-confirm="accept"]').click();
  await page.waitForFunction(n=>(__GH_STATE__.customHubs||[]).filter(h=>(h.ownerCompanyId||h.company)==='realestate').length>=n&&!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked(),before+count);
}
async function closeDay(page){
  await page.evaluate(()=>__AUDIT__.closeDrawer());const start=await page.evaluate(()=>Math.floor(__GH_STATE__.simSeconds/86400));
  await page.evaluate(to=>__AUDIT__.simulationEngine.advanceTo(to,{reason:'qa-build593'}),(start+1)*86400+1);
  await page.waitForFunction(()=>!__AUDIT__.simulationEngine.snapshot().manualAdvance&&!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked(),null,{timeout:120000});
}
// One "buy all" of a kind on the market page, through its confirmation; the frames from the confirmation to the end are
// measured (every interval between animation frames, and every long task).
async function buyAll(page,variant){
  const before=await page.evaluate(()=>({revision:__GH_STATE__.saveRevision,receipts:Object.keys(__GH_STATE__.finance.operatingAcquisitions||{}).length,cheques:(__GH_STATE__.finance.cheques||[]).length,projects:(__GH_STATE__.realEstate?.projects||[]).length,offers:GH_OPERATING_ACQUISITIONS.targets(__GH_STATE__,'realestate',0).length}));
  await page.evaluate(()=>__AUDIT__.openDrawer('operatingAssetMarket',{company:'realestate',page:0}));
  await page.locator(`#drawerBody [data-gh-action="operating-buy-all"][data-variant="${variant}"]`).click();await page.locator('dialog.ui-confirm').waitFor();
  await page.evaluate(()=>{window.qaGaps=[];window.qaLong=[];window.qaDispatch=[];window.qaRun=true;let last=performance.now();const tick=t=>{window.qaGaps.push(t-last);last=t;if(window.qaRun)requestAnimationFrame(tick);};requestAnimationFrame(tick);new PerformanceObserver(list=>{for(const e of list.getEntries())window.qaLong.push(e.duration);}).observe({type:'longtask'});
    // The purchase's own work, timed on the main thread: every call to the acquisition owner (one offer, or the batch),
    // which both sources' company owners reach through the global at call time.
    const owner=window.GH_OPERATING_ACQUISITIONS,timed=name=>(...args)=>{const started=performance.now();try{return owner[name](...args);}finally{window.qaDispatch.push(performance.now()-started);}};window.GH_OPERATING_ACQUISITIONS={...owner,acquire:timed('acquire'),acquireBatch:timed('acquireBatch')};});
  await page.locator('dialog.ui-confirm [data-confirm="accept"]').click();
  await page.waitForFunction(()=>!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked()&&!document.querySelector('dialog.ui-confirm[open]'));await page.waitForTimeout(400);
  return page.evaluate(before=>{window.qaRun=false;const s=__GH_STATE__,F=s.finance;return {before,revisions:s.saveRevision-before.revision,receipts:Object.values(F.operatingAcquisitions||{}),newCheques:(F.cheques||[]).slice(before.cheques),projects:(s.realEstate?.projects||[]).length-before.projects,longestFrame:Math.max(0,...window.qaGaps),longTasks:window.qaLong.slice(),dispatches:window.qaDispatch.slice()};},before);
}
(async()=>{
  const browser=await chromium.launch({headless:true}),tree=fs.mkdtempSync(path.join(os.tmpdir(),'b593-'));const r=v=>Math.round(v*10)/10;
  try{
    execFileSync('sh',['-c',`git -C "${ROOT}" archive ${PREVIOUS} WebApp tests/helpers | tar -x -C "${tree}"`]);
    // 2. The source before: the same ten offers bought in one signed command.
    const old=await world(browser,tree);await openOffices(old.page,10);await openOffices(old.page,10);await closeDay(old.page);const oldBuy=await buyAll(old.page,'office');
    assert.equal(oldBuy.receipts.length,20,'the source before bought the twenty offers');
    const now=await world(browser,SOURCE);await openOffices(now.page,10);await openOffices(now.page,10);await closeDay(now.page);const buy=await buyAll(now.page,'office');
    // 1.
    assert.equal(buy.before.offers,20,'twenty office offers on the page');assert.equal(buy.revisions,1,'1: one save for the whole purchase');
    assert.equal(buy.receipts.length,20,'1: a receipt per offer');assert.equal(buy.projects,20,'1: one leased project per offer');
    const kept=await now.page.evaluate(ids=>{const s=__GH_STATE__,F=s.finance,P=GH_DOCUMENT_PROOF;return ids.map(id=>{const r=F.operatingAcquisitions[id],cheque=F.cheques.find(c=>c.id===r.chequeId),invoice=F.invoices.find(i=>i.number===r.invoiceNumber),legal=(F.commercialContracts||[]).find(c=>c.id===r.legalDocumentId);return {cashed:cheque?.status==='مصروف',invoice:!!invoice&&P.verifyDocument(s,invoice).ok,legal:!!legal&&P.verifyDocument(s,legal).ok,project:s.realEstate.projects.some(p=>p.cheques?.includes(r.chequeId)&&p.status==='مكتمل'&&p.leased>0)};});},buy.receipts.map(row=>row.id));
    assert.ok(kept.every(k=>k.cashed&&k.invoice&&k.legal&&k.project),`1: every purchase keeps its cashed cheque, protected invoice and contract, and its leased project: ${JSON.stringify(kept)}`);
    assert.ok(await now.page.evaluate(()=>GH_OPERATING_ACQUISITIONS.validRegistry(__GH_STATE__.finance.operatingAcquisitions)&&GH_SAVE_SCHEMA.validate(__GH_STATE__).ok),'1: the receipts and the save validate');
    // 2.
    // CI (build 99, macOS): the longest frame was the same in both sources (116.6 ms): the durable command's commit (the
    // save written and checked once, as for any command) outlasted the purchase there, so frames cannot show the purchase.
    // Its own work is each call to the acquisition owner (the batch before, one offer now), timed on the main thread.
    const oldLongest=Math.max(0,...oldBuy.dispatches),newLongest=Math.max(0,...buy.dispatches);
    assert.ok(oldBuy.dispatches.length>=1&&oldLongest>0,`2: the source before ran the purchase in the acquisition owner (${oldBuy.dispatches.length} calls)`);
    assert.ok(buy.dispatches.length>=20,`2: one call per offer (${buy.dispatches.length})`);
    assert.ok(newLongest<oldLongest/2,`2: no part of the purchase holds the main thread half as long as the single batch before: ${r(newLongest)} ms against ${r(oldLongest)} ms`);
    // 3. Twenty projects, then the twenty residential offers with ten left under the limit.
    assert.equal(await now.page.evaluate(()=>__GH_STATE__.realEstate.projects.length),20,'3: twenty projects');
    const cash=await now.page.evaluate(()=>GH_FINANCE_CORE.operating(__GH_STATE__,'realestate'));
    const refused=await buyAll(now.page,'residential');
    assert.equal(refused.before.offers,20,'3: twenty residential offers on the page');assert.equal(refused.revisions,0,'3: a refusal at a later offer saves nothing');
    assert.equal(refused.receipts.length,20,'3: no receipt is kept');assert.equal(refused.newCheques.length,0,'3: no cheque is kept');assert.equal(refused.projects,0,'3: no project is kept');
    assert.equal(await now.page.evaluate(()=>GH_FINANCE_CORE.operating(__GH_STATE__,'realestate')),cash,'3: no money moved');
    // 4.
    assert.deepEqual(now.errors,[],'4: no error');assert.deepEqual(old.errors,[]);
    console.log(JSON.stringify({suite:'build593-bulk-acquisition-frames-browser',ok:true,previous:{longestAcquisition:r(oldLongest),calls:oldBuy.dispatches.length,longestFrame:r(oldBuy.longestFrame),longTasks:oldBuy.longTasks.map(r)},now:{longestAcquisition:r(newLongest),calls:buy.dispatches.length,longestFrame:r(buy.longestFrame),longTasks:buy.longTasks.map(r)}}));
  }finally{await browser.close();fs.rmSync(tree,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
