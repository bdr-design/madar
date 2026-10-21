'use strict';
// The dividends on the group's share page (owner's IPO restructuring, batch 4, as designed; the founder's part stays in
// the holding). Proven in the real app (its stock desk, confirmation dialog, durable command, save, and its own daily
// close at a quarter's end), the native storage protocol doubled:
//  1. the page offers 0, 25, 40 or 60% with the current one on, the next quarter's day, its estimated dividend, per share,
//     the public's part by transfer and the founder's part kept in the holding, and the year's yield;
//  2. choosing a share asks first, with the next quarter's split; cancelling changes nothing, accepting saves the share;
//  3. the game's own close of the quarter's last day pays the public's part by one signed outgoing transfer, keeps the
//     founder's part, alerts the player, and the page shows the dividend paid and the year's yield;
//  4. the group's transfer documents show it as an outgoing transfer to the offering's shareholders;
//  5. weight: a close on any other day reads nothing for the dividend; the page opens as before (Chromium here).
const assert=require('node:assert/strict'),path=require('node:path'),{chromium}=require('playwright');
const {bootAtOrigin,installVault}=require('./helpers/differential-vault-fixture.cjs'),{prepareCommandWorld}=require('./helpers/command-world-fixture.cjs');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
(async()=>{const browser=await chromium.launch({headless:true}),errors=[];let env;try{
 env=await bootAtOrigin({browser,root:ROOT,errors,fleetWorker:true,viewport:{width:1180,height:820},beforeScripts:{fn:installVault}});const {page}=env;page.setDefaultTimeout(120000);await prepareCommandWorld(page,{count:2});
 const settled=()=>page.waitForFunction(()=>!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked());
 const open=async()=>{await page.evaluate(()=>__AUDIT__.openDrawer('stocks','ipo'));await page.waitForSelector('#drawerBody .pv');return page.locator('#drawerBody').innerText();};
 // A group listed on day 180 with a profitable quarter so far, the clock on day 269 (the quarter ends on day 270). The
 // jump from the world's first days makes day 270's own close carry months of costs, so the quarter so far is ample.
 await page.evaluate(()=>{const s=__GH_STATE__;s.godMoney=false;s.infiniteMoney=false;s.simSeconds=269*86400+3600;s.lastFinancialDay=269;
  s.ipo={listed:true,ticker:'VH',listedDay:180,issuedPct:20,proceeds:4e8,fees:1.5e7,netProceeds:3.85e8,offerPrice:20,sharesIssued:2e7,totalShares:1e8,capTable:[{holderId:'founders',label:'المؤسس',shares:8e7},{holderId:'public-float',label:'مساهمو الطرح',shares:2e7}],transferReference:'IPO-VH-180',lockupUntilDay:360};
  s.finance.dailyCompanyReports=Array.from({length:200},(_,i)=>({id:`CLOSE-${269-i}`,day:269-i,net:1e7}));const F=GH_FINANCE_CORE;F.book(s,'group').accounts[0].balance=Math.max(F.book(s,'group').accounts[0].balance,5e8);F.reconcile(s);
  delete s.advanced.valuation;GH_CORPORATE_CORE.execute({state:s},'close-valuation',{day:268});GH_CORPORATE_CORE.execute({state:s},'close-valuation',{day:269});});
 // 1
 let text=await open();const plan0=await page.evaluate(()=>GH_CORPORATE_CORE.dividendPlan(__GH_STATE__));
 assert.deepEqual(await page.locator('#drawerBody .dividend-policy').allInnerTexts(),['0%','25%','40%','60%'],'1: the four shares');assert.equal(await page.locator('#drawerBody .dividend-policy.on').innerText(),'0%','1: none yet');
 for(const shown of ['توزيع الأرباح','نسبة من ربح كل ربع، تُدفع في آخره.','التوزيع القادم · بعد 1 يومًا','للسهم','لمساهمي الطرح 20% · بحوالة','للمؤسس 80% · في القابضة','عائد التوزيع','0.0%'])assert(text.includes(shown),`1: «${shown}»\n${text}`);
 assert.equal(plan0.estimate,0,'1: nothing at 0%');
 // 2
 const before=await page.evaluate(()=>JSON.stringify([__GH_STATE__.advanced.dividends||null,__GH_STATE__.saveRevision]));
 await page.locator('#drawerBody .dividend-policy[data-payout="25"]').click();await page.waitForSelector('dialog.ui-confirm[open]');
 const plan=await page.evaluate(()=>GH_CORPORATE_CORE.dividendPlan(__GH_STATE__,25)),dialog={title:await page.locator('dialog.ui-confirm[open] h2, dialog.ui-confirm[open] h3, dialog.ui-confirm[open] [data-confirm-title]').first().innerText(),body:await page.locator('dialog.ui-confirm p').innerText(),accept:await page.locator('dialog.ui-confirm [data-confirm="accept"]').innerText()};
 assert.equal(dialog.title.trim(),'نسبة توزيع الأرباح');assert.equal(dialog.accept.trim(),'اعتماد النسبة');for(const part of ['توزيع 25% من ربح كل ربع ابتداءً من الربع الحالي','لمساهمي الطرح بحوالة صادرة','حصة المؤسس تبقى في القابضة','التوزيع يُنقص نقد القابضة ولا يمس ربحها'])assert(dialog.body.includes(part),`2: «${part}» in ${dialog.body}`);
 assert(plan.estimate>0&&Math.abs(plan.publicAmount-plan.estimate*.2)<.01,'2: a split to show');
 await page.locator('dialog.ui-confirm [data-confirm="cancel"]').click();await settled();assert.equal(await page.evaluate(()=>JSON.stringify([__GH_STATE__.advanced.dividends||null,__GH_STATE__.saveRevision])),before,'2: cancelling changes nothing');
 const revision=await page.evaluate(()=>__GH_STATE__.saveRevision);await page.locator('#drawerBody .dividend-policy[data-payout="25"]').click();await page.waitForSelector('dialog.ui-confirm[open]');await page.locator('dialog.ui-confirm [data-confirm="accept"]').click();
 await page.waitForFunction(()=>__GH_STATE__.advanced.dividends?.payout===25);await settled();assert(await page.evaluate(r=>__GH_STATE__.saveRevision>r,revision),'2: saved');
 await page.waitForSelector('#drawerBody .dividend-policy.on[data-payout="25"]');
 // 3: the game's own close of day 270
 const start=await page.evaluate(()=>{const s=__GH_STATE__;s.simSeconds=270*86400-1800;s.lastFinancialDay=269;s.lastMarketHour=Math.floor(s.simSeconds/3600);return {cash:GH_FINANCE_CORE.operating(s,'group'),transfers:s.finance.transfers.length,alerts:JSON.stringify(s.alerts||[]).length};});
 const wall=await page.evaluate(async()=>{const t0=performance.now(),r=__AUDIT__.simulationEngine.advanceTo(270*86400+3600,{reason:'qa-565-quarter',speed:300});if(!r.accepted)throw Error(JSON.stringify(r));await new Promise(done=>{const w=()=>__AUDIT__.simulationEngine.snapshot().manualAdvance?setTimeout(w,20):done();w();});return performance.now()-t0;});await settled();
 const paid=await page.evaluate(start=>{const s=__GH_STATE__,F=GH_FINANCE_CORE,record=s.advanced.dividends.records[0],added=s.finance.transfers.slice(0,s.finance.transfers.length-start.transfers).filter(t=>t.kind==='dividend-distribution');return {lastFinancialDay:s.lastFinancialDay,record,added:added.map(t=>({amount:t.amount,ref:t.reference,to:t.to,signed:Boolean(t.contentDigest)&&t.authorizationKind==='system-unsealed'})),cashDrop:start.cash-F.operating(s,'group'),alert:JSON.stringify(s.alerts||[]).includes('صُرف توزيع أرباح الربع')&&JSON.stringify(s.alerts||[]).includes('تبقى في القابضة')};},start);
 assert.equal(paid.record.day,270);assert.equal(paid.record.paid,true,`3: paid ${JSON.stringify(paid.record)}`);assert.equal(paid.added.length,1,'3: one transfer');assert.equal(paid.added[0].amount,paid.record.publicAmount);assert.equal(paid.added[0].ref,'DIV-VH-270');assert(paid.added[0].signed,'3: signed');
 assert(Math.abs(paid.record.publicAmount-paid.record.amount*.2)<.01&&Math.abs(paid.record.founderAmount-paid.record.amount*.8)<.02,'3: 20% to the public, 80% kept');assert(paid.alert,'3: the player is told');assert.equal(paid.lastFinancialDay,270,'3: the game closed day 270');
 text=await open();const after=await page.evaluate(()=>GH_CORPORATE_CORE.dividendPlan(__GH_STATE__));assert(after.yieldPct>0,'3: a yield');assert(text.includes(`${after.yieldPct.toFixed(1)}%`)&&text.includes('آخر توزيع اليوم 270'),`3: the page shows the dividend\n${text}`);
 // 4
 let card=null;for(let pageNo=0;pageNo<20&&!card;pageNo++){await page.evaluate(pageNo=>__AUDIT__.openDrawer('invoices',{company:'group',tab:'documents',view:'transfers',direction:'outgoing',page:pageNo}),pageNo);await page.waitForSelector('#drawerBody');
  card=await page.evaluate(()=>{const found=[...document.querySelectorAll('#drawerBody *')].filter(el=>el.textContent.includes('DIV-VH-270')&&el.textContent.includes('إشعار تحويل')).sort((a,b)=>a.textContent.length-b.textContent.length)[0];return found?found.innerText:null;});}
 assert(card,'4: the dividend is among the group\'s outgoing transfers');for(const shown of ['إشعار تحويل صادر','مساهمو الطرح العام','توزيع أرباح على مساهمي الطرح'])assert(card.includes(shown),`4: its page shows «${shown}»\n${card}`);
 // 5
 const quiet=await page.evaluate(()=>{const s=__GH_STATE__,C=GH_CORPORATE_CORE;let t=performance.now();for(let i=0;i<20000;i++)C.execute({state:s},'close-dividend',{day:271+(i%89)});return (performance.now()-t)/20000;});assert(quiet<.01,`5: a close on another day costs ${quiet} ms`);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({suite:'build565-group-dividends-browser',ok:true,record:paid.record,dayMs:Math.round(wall),quietUs:+(quiet*1000).toFixed(2)}));
}finally{await browser.close();await env?.closeOrigin?.();}})().catch(error=>{console.error(error);process.exitCode=1;});
