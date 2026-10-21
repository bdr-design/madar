'use strict';
// The investor card page (owner: the card from the registered bank, its statement, and returns only by the player's
// hand). Proven in the real app (its page, buttons, confirmation dialog, durable commands and save), with only the
// native storage protocol doubled:
//  1. opening the page writes nothing;
//  2. the card carries the registered bank's trade name (a rename shows at once), and «حساب المؤسس الخاص» while the
//     bank is not founded;
//  3. the statement shows 10 rows and «عرض المزيد» shows the rest (at most 50);
//  4. a return asks first: cancelling changes nothing; accepting returns the typed amount (never more than is available),
//     as one signed outgoing transfer, saved, and the page shows what the company still owes;
//  5. «return all» asks first; if one of its transfers fails, nothing is returned at all;
//  6. time passing in investor mode never returns money by itself;
//  7. the card's transfers list as incoming and a return as outgoing; nothing of the old mode is on the page.
const assert=require('node:assert/strict'),path=require('node:path'),{chromium}=require('playwright');
const {bootAtOrigin,installVault}=require('./helpers/differential-vault-fixture.cjs'),{prepareCommandWorld}=require('./helpers/command-world-fixture.cjs');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
(async()=>{const browser=await chromium.launch({headless:true}),errors=[];let env;try{
 env=await bootAtOrigin({browser,root:ROOT,errors,fleetWorker:true,viewport:{width:1180,height:820},beforeScripts:{fn:installVault}});const {page}=env;page.setDefaultTimeout(45000);await prepareCommandWorld(page,{count:2});
 const settled=()=>page.waitForFunction(()=>!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked());
 await page.evaluate(async()=>{const s=__GH_STATE__,F=GH_FINANCE_CORE;for(let i=0;i<12;i++){s.simSeconds+=86400;const company=['telecom','insurance','air'][i%3];await __AUDIT__.runAuthorizedDomainCommand('finance','spend',{company,amount:F.operating(s,company)+3000000,note:'تشغيل',line:'other'});}});await settled();
 const fingerprint=()=>page.evaluate(()=>JSON.stringify([__GH_STATE__.finance,__GH_STATE__.companyFinance,__GH_STATE__.saveRevision]));
 // 1
 const before=await fingerprint();await page.evaluate(()=>__AUDIT__.openDrawer('investorMode'));await page.waitForSelector('#drawerBody .investor-card');assert.equal(await fingerprint(),before,'1: opening the page writes nothing');
 // 2
 const issuer=()=>page.locator('#drawerBody .investor-card .ic-title small').innerText();
 assert.equal(await issuer(),`${await page.evaluate(()=>GH_COMPANY_PLATFORM.resolveIdentity(__GH_STATE__,'bank').tradeName)} · وضع المستثمر`,'2: the registered bank');
 await page.evaluate(()=>{const s=__GH_STATE__;window.__qaBank=JSON.stringify(s.companyRegistry.bank);Object.assign(s.companyRegistry.bank,{legalName:'مصرف الأفق',tradeName:'مصرف الأفق',customName:true});__AUDIT__.openDrawer('investorMode');});
 assert.equal(await issuer(),'مصرف الأفق · وضع المستثمر','2: a renamed bank shows at once');
 await page.evaluate(()=>{const s=__GH_STATE__;s.companyRegistry.bank=JSON.parse(window.__qaBank);window.__qaOpened=s.openedCompanies.slice();s.openedCompanies=s.openedCompanies.filter(t=>t!=='bank');__AUDIT__.openDrawer('investorMode');});
 assert.equal(await issuer(),'حساب المؤسس الخاص · وضع المستثمر','2: before the bank is founded');
 await page.evaluate(()=>{__GH_STATE__.openedCompanies=window.__qaOpened;__AUDIT__.openDrawer('investorMode');});assert.equal(await fingerprint(),before,'2: the checks left the save as it was');
 // 3
 const statementRows=await page.evaluate(()=>GH_FINANCE_CORE.investorCardReturnPlan(__GH_STATE__).statement.length);assert(statementRows>10,`3: more than 10 statement rows (${statementRows})`);
 assert.equal(await page.locator('#drawerBody .ic-row').count(),10,'3: 10 rows');await page.locator('#drawerBody [data-go="investorMode"]').click();await page.waitForFunction(n=>document.querySelectorAll('#drawerBody .ic-row').length===n,Math.min(50,statementRows));
 // 4
 const company='telecom',state=()=>page.evaluate(c=>{const s=__GH_STATE__,plan=GH_FINANCE_CORE.investorCardReturnPlan(s).rows.find(r=>r.company===c);return {cash:GH_FINANCE_CORE.operating(s,c),owed:plan.owed,available:plan.available,returns:s.finance.transfers.filter(t=>t.kind==='founder-withdrawal'&&t.fundingSource==='investor-card').length,revision:s.saveRevision};},company);
 const start=await state();assert(start.available>2000000,JSON.stringify(start));const button=page.locator(`#drawerBody [data-gh-action="investor-card-return"][data-company="${company}"]`);
 await page.fill(`#icReturn-${company}`,'2000000');await button.click();await page.waitForSelector('dialog.ui-confirm[open]');assert.match(await page.locator('dialog.ui-confirm p').innerText(),/إرجاع 2,000,000 دولار/);
 await page.locator('dialog.ui-confirm [data-confirm="cancel"]').click();await settled();assert.deepEqual(await state(),start,'4: cancelling changes nothing');
 await button.click();await page.waitForSelector('dialog.ui-confirm[open]');await page.locator('dialog.ui-confirm [data-confirm="accept"]').click();await page.waitForFunction(n=>__GH_STATE__.finance.transfers.filter(t=>t.kind==='founder-withdrawal'&&t.fundingSource==='investor-card').length>n,start.returns);await settled();
 const once=await state();assert.equal(once.cash,start.cash-2000000,'4: the typed amount');assert.equal(once.owed,start.owed-2000000);assert.equal(once.returns,start.returns+1);assert(once.revision>start.revision,'4: saved');
 const doc=await page.evaluate(()=>{const t=__GH_STATE__.finance.transfers.find(x=>x.kind==='founder-withdrawal'&&x.fundingSource==='investor-card');return {to:t.to,signed:Boolean(t.documentProofId&&t.contentDigest)};});assert(doc.signed&&/^بطاقة المستثمر · /.test(doc.to),JSON.stringify(doc));
 await page.waitForSelector(`#icReturn-${company}`);assert.match(await page.locator(`#drawerBody [data-company="${company}"]`).locator('xpath=ancestor::article[1]').innerText(),new RegExp((once.owed).toLocaleString('en-US',{maximumFractionDigits:0})),'4: the page shows what it still owes');
 await page.fill(`#icReturn-${company}`,String(once.available*10));await button.click();await page.waitForSelector('dialog.ui-confirm[open]');assert.match(await page.locator('dialog.ui-confirm p').innerText(),new RegExp(`إرجاع ${once.available.toLocaleString('en-US',{maximumFractionDigits:0})} دولار`),'4: never more than is available');await page.locator('dialog.ui-confirm [data-confirm="cancel"]').click();
 // 5
 const all=await page.evaluate(()=>{const s=__GH_STATE__,F=GH_FINANCE_CORE;return {plan:F.investorCardReturnPlan(s),cash:Object.fromEntries(F.investorCardReturnPlan(s).rows.map(r=>[r.company,F.operating(s,r.company)])),transfers:s.finance.transfers.length};});
 assert(all.plan.rows.filter(r=>r.availableAll>0).length>=2,'5: two companies or more to return');
 await page.evaluate(()=>{const proof=window.GH_DOCUMENT_PROOF;let calls=0;window.__qaProof=proof;window.__qaSeals=()=>calls;window.GH_DOCUMENT_PROOF={...proof,sealDocument(...args){if(++calls===2)throw new Error('qa-seal-failure');return proof.sealDocument(...args);}};});
 await page.locator('#drawerBody [data-gh-action="investor-card-return-all"]').click();await page.waitForSelector('dialog.ui-confirm[open]');await page.locator('dialog.ui-confirm [data-confirm="accept"]').click();await page.waitForTimeout(800);await settled();
 const failed=await page.evaluate(()=>{if(window.__qaSeals()<2)throw new Error('the second transfer was never attempted');window.GH_DOCUMENT_PROOF=window.__qaProof;const s=__GH_STATE__,F=GH_FINANCE_CORE;return {cash:Object.fromEntries(F.investorCardReturnPlan(s).rows.map(r=>[r.company,F.operating(s,r.company)])),transfers:s.finance.transfers.length};});
 assert.deepEqual(failed,{cash:all.cash,transfers:all.transfers},'5: a failed «return all» returns nothing');
 await page.evaluate(()=>__AUDIT__.openDrawer('investorMode'));await page.locator('#drawerBody [data-gh-action="investor-card-return-all"]').click();await page.waitForSelector('dialog.ui-confirm[open]');await page.locator('dialog.ui-confirm [data-confirm="accept"]').click();
 const expected=all.plan.rows.filter(r=>r.availableAll>0).length;await page.waitForFunction(([n,k])=>__GH_STATE__.finance.transfers.length>=n+k,[all.transfers,expected]);await settled();
 const done=await page.evaluate(()=>{const s=__GH_STATE__,F=GH_FINANCE_CORE;return Object.fromEntries(F.investorCardReturnPlan(s).rows.map(r=>[r.company,F.operating(s,r.company)]));});for(const row of all.plan.rows)assert(Math.abs(done[row.company]-(all.cash[row.company]-row.availableAll))<.01,`5: then every company returns its share (${row.company})`);
 // 6
 const returned=await page.evaluate(()=>JSON.stringify(__GH_STATE__.finance.investorCard.returned));
 await page.evaluate(()=>{const r=__AUDIT__.simulationEngine.advanceTo(__GH_STATE__.simSeconds+3*86400,{reason:'qa-investor-card',speed:300});if(!r.accepted)throw Error(JSON.stringify(r));});await page.waitForFunction(()=>!__AUDIT__.simulationEngine.snapshot().manualAdvance,null,{timeout:60000});await settled();
 assert.equal(await page.evaluate(()=>JSON.stringify(__GH_STATE__.finance.investorCard.returned)),returned,'6: nothing returned by itself');
 // 7
 const html=await page.evaluate(()=>document.querySelector('#drawerBody').innerHTML);assert.doesNotMatch(html,/وضع التجربة|God Mode|god-mode/);
 // The documents page lists rows; the full transfer opens from its row.
 await page.evaluate(c=>__AUDIT__.openDrawer('invoices',{company:c,tab:'incoming'}),company);await page.waitForSelector('#drawerBody .doc-list-row');const inRow=page.locator('#drawerBody .doc-list-row',{hasText:'بطاقة المستثمر'}).first();assert(await inRow.count()>0,'7: incoming row');await inRow.click();await page.waitForSelector('#drawerBody .document-card');assert(await page.locator('#drawerBody .document-card',{hasText:'بطاقة المستثمر'}).count()>0,'7: incoming');
 await page.evaluate(c=>__AUDIT__.openDrawer('invoices',{company:c,tab:'outgoing'}),company);await page.waitForSelector('#drawerBody .doc-list-row');const outRow=page.locator('#drawerBody .doc-list-row',{hasText:'بطاقة المستثمر'}).first();assert(await outRow.count()>0,'7: outgoing row');await outRow.click();await page.waitForSelector('#drawerBody .document-card');const out=page.locator('#drawerBody .document-card',{hasText:'إرجاع إلى بطاقة المستثمر'}).first();assert.match(await out.innerText(),/إشعار تحويل صادر/,'7: outgoing');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({suite:'build556-investor-card-page-browser',ok:true,statementRows,returned:2000000}));
}finally{await browser.close();await env?.closeOrigin?.();}})().catch(error=>{console.error(error);process.exitCode=1;});
