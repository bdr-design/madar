'use strict';
// The owner: «بيع الاصول مايشتغل». Selling assets through the game's own buttons, with and without investor mode:
//  1. one owned aircraft: sold once, its proceeds in one credit, and the alert names it (it said «تم بيع undefined»);
//  2. a lease the company cannot pay to end is refused in words and nothing changes;
//  3. a sale left pending on an aircraft that is no longer moving can be completed («إكمال البيع»; it was disabled);
//  4. a scheduled lease return whose fee the company cannot pay when the aircraft arrives puts it back in service with
//     an alert, instead of leaving it idle with its sale pending for ever;
//  5. «بيع جميع أصول الشركة» without investor mode: owned aircraft are sold first, and their proceeds pay the lease
//     fees; as many leases as the budget allows are returned and the rest stay in service and are counted (the whole
//     order failed with «durable-journaled-root-write-failed:fleet»); one credit and one payment of fees for the order;
//  6. the same in investor mode: everything goes, one credit and one payment.
// Chromium; the game's own simulation engine, durable commands and buttons.
const assert=require('node:assert/strict'),path=require('node:path'),{chromium}=require('playwright');
const {bootAtOrigin,installVault}=require('./helpers/differential-vault-fixture.cjs');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
async function world(browser,errors){
 const env=await bootAtOrigin({browser,root:ROOT,errors,fleetWorker:true,viewport:{width:956,height:440},beforeScripts:{fn:installVault}});const {page}=env;page.setDefaultTimeout(300000);
 await page.evaluate(()=>{window.__QA_NOTICES__=[];const shown=globalThis.GH_INTERACTION_NOTICE;globalThis.GH_INTERACTION_NOTICE=(t,k)=>{window.__QA_NOTICES__.push(String(t));return typeof shown==='function'?shown(t,k):undefined;};});
 await page.evaluate(async()=>{const a=__AUDIT__,s=()=>__GH_STATE__,WORLD=GH_WORLD_DATA,type='air';s().godMoney=true;s().infiniteMoney=true;const definition=GH_COMPANY_PLATFORM.definitionFor(s(),type);
  await a.runAuthorizedDomainCommand('corporate','open-company',{type,companyId:type,capital:Math.max(400000000,definition.founding.minimumCapital),legalName:'QA Sale air',formationContract:'QA-SALE-AIR'},{silent:true});
  const airport=WORLD.airports.find(r=>r[0]==='OERK');await a.runAuthorizedDomainCommand('facilities','create',{facility:{id:'QA-air-OERK',name:'QA Airport OERK',kind:'airport-base',company:type,ownerCompanyId:type,owned:true,sourceKey:'air:OERK',code:airport[1]||airport[0],icao:airport[0],iata:airport[1],city:airport[3]||'—',country:String(airport[5]||'—'),coords:[airport[6],airport[7]]},bucket:'globalBases'},{silent:true});
  const model=[...GH_ASSET_CATALOG[type].used].sort((x,y)=>x.price-y.price)[0];await a.buyAsset(type,'used',model.id,'cash',4,'QA-air-OERK',true,'QA-SALE-OWNED',type);await a.buyAsset(type,'used',model.id,'lease',8,'QA-air-OERK',true,'QA-SALE-LEASED',type);});
 await page.waitForFunction(()=>!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked());return env;}
const settle=page=>page.waitForFunction(()=>!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked());
async function sellOne(page,id){await page.evaluate(id=>__AUDIT__.openDrawer('assetManage',id),id);const button=page.locator(`#drawerBody .sell-asset[data-id="${id}"]`);await button.waitFor();const label=(await button.innerText()).trim(),n=await page.evaluate(()=>window.__QA_NOTICES__.length);await button.click();await page.waitForTimeout(300);if(await page.locator('dialog.ui-confirm[open]').count())await page.locator('dialog.ui-confirm [data-confirm="accept"]').click();await page.waitForTimeout(300);await settle(page);return {label,notices:await page.evaluate(n=>window.__QA_NOTICES__.slice(n),n)};}
const snap=page=>page.evaluate(()=>{const s=__GH_STATE__;return {fleet:GH_FLEET_DATA.size(s),cash:GH_FINANCE_CORE.operating(s,'air'),invoices:s.finance.invoices.length,alerts:(s.alerts||[]).slice(0,3).map(String)};});
(async()=>{const browser=await chromium.launch({headless:true}),errors=[];let env;try{
 env=await world(browser,errors);let {page}=env;
 const ids=await page.evaluate(()=>({owned:GH_FLEET_DATA.filter(__GH_STATE__,x=>x.ownership!=='lease').map(x=>({id:x.id,name:x.name})),leased:GH_FLEET_DATA.filter(__GH_STATE__,x=>x.ownership==='lease').map(x=>({id:x.id,name:x.name}))}));
 assert.equal(ids.owned.length,4);assert.equal(ids.leased.length,8);
 // 1
 let before=await snap(page);const one=await sellOne(page,ids.owned[0].id);let after=await snap(page);
 assert.equal(after.fleet,before.fleet-1,'1: sold');assert.equal(after.invoices,before.invoices+1,'1: one sale invoice');assert(after.cash>before.cash,'1: proceeds received');assert(after.alerts[0].includes(`تم بيع ${ids.owned[0].name}`)&&!after.alerts[0].includes('undefined'),`1: the alert names it: ${after.alerts[0]}`);
 // 2
 await page.evaluate(()=>{const s=__GH_STATE__;s.godMoney=false;s.infiniteMoney=false;GH_FINANCE_CORE.book(s,'air').accounts[0].balance=1000;GH_FINANCE_CORE.reconcile(s);});before=await snap(page);
 const poor=await sellOne(page,ids.leased[0].id);after=await snap(page);
 assert.match(poor.notices.join(' | '),/تعذر إنهاء تأجير .*لا يكفي لرسوم إنهاء التأجير/,`2: the reason in words: ${poor.notices}`);assert.deepEqual({fleet:after.fleet,cash:after.cash,invoices:after.invoices},{fleet:before.fleet,cash:before.cash,invoices:before.invoices},'2: nothing changes');
 // 3: a pending sale on an aircraft at its base
 await page.evaluate(id=>{const s=__GH_STATE__;s.godMoney=true;s.infiniteMoney=true;GH_TRANSACTION_CORE.execute(s,{label:'QA-stuck-sale',apply:()=>GH_DOMAIN_COMMANDS.dispatchSystem({state:s},'fleet','request-sale',{id,clearRoute:true},{actor:'system-fleet-auto-disposal'})});},ids.owned[1].id);
 before=await snap(page);const stuck=await sellOne(page,ids.owned[1].id);after=await snap(page);
 assert.equal(stuck.label,'إكمال البيع','3: the button offers to complete the sale');assert.equal(after.fleet,before.fleet-1,'3: completed');
 // 4: a scheduled lease return the company cannot pay when the aircraft arrives
 await page.evaluate(()=>__AUDIT__.openDrawer('routes','air'));const dispatchAll=page.locator('.dispatch-international-network[data-company="air"]').first();await dispatchAll.waitFor({state:'visible',timeout:30000});await dispatchAll.click();
 await page.waitForFunction(()=>GH_FLEET_DATA.filter(__GH_STATE__,x=>x.ownership==='lease'&&x.phase==='moving').length>0&&!window.__GH_DURABLE_COMMAND_CONTEXT__,null,{timeout:120000});
 const moving=await page.evaluate(()=>GH_FLEET_DATA.filter(__GH_STATE__,x=>x.ownership==='lease'&&x.phase==='moving')[0].id);await sellOne(page,moving);
 assert.equal(await page.evaluate(id=>GH_FLEET_DATA.get(__GH_STATE__,id)?.salePending,moving),true,'4: scheduled');
 await page.evaluate(()=>{const s=__GH_STATE__;s.godMoney=false;s.infiniteMoney=false;GH_FINANCE_CORE.book(s,'air').accounts[0].balance=1000;GH_FINANCE_CORE.reconcile(s);});
 for(let i=0;i<8;i++){const state=await page.evaluate(id=>{const x=GH_FLEET_DATA.get(__GH_STATE__,id);return x?{pending:x.salePending,phase:x.phase}:null;},moving);if(state&&!state.pending)break;
  await page.evaluate(async()=>{const r=__AUDIT__.simulationEngine.advanceTo(__GH_STATE__.simSeconds+43200,{reason:'qa-sale',speed:300});if(!r.accepted)return;await new Promise(done=>{const wait=()=>__AUDIT__.simulationEngine.snapshot().manualAdvance?setTimeout(wait,20):done();wait();});});}
 const back=await page.evaluate(id=>{const x=GH_FLEET_DATA.get(__GH_STATE__,id);return {exists:!!x,pending:x?.salePending===true,alert:(__GH_STATE__.alerts||[]).map(String).find(a=>a.includes('أُلغي أمر البيع وعاد الأصل إلى الخدمة'))||''};},moving);
 assert.deepEqual({exists:back.exists,pending:back.pending},{exists:true,pending:false},'4: back in service, not stuck');assert(back.alert,'4: the player is told');
 // 5: a fresh world, every aircraft at its base; sell everything without investor mode, with cash for some fees only
 await env.page.close();await env.closeOrigin?.();env=await world(browser,errors);page=env.page;
 await page.evaluate(()=>{const s=__GH_STATE__;s.godMoney=false;s.infiniteMoney=false;});
 const plan=await page.evaluate(()=>{const s=__GH_STATE__,owned=GH_FLEET_DATA.filter(s,x=>x.ownership!=='lease'&&!x.salePending),leased=GH_FLEET_DATA.filter(s,x=>x.ownership==='lease'&&!x.salePending),fee=leased.length?GH_FLEET_CORE.saleQuote(s,leased[0]).fee:0,proceeds=owned.reduce((n,x)=>n+GH_FLEET_CORE.saleQuote(s,x).proceeds,0);
  GH_FINANCE_CORE.book(s,'air').accounts[0].balance=1000;GH_FINANCE_CORE.reconcile(s);return {owned:owned.length,leased:leased.length,fee,proceeds,cash:GH_FINANCE_CORE.operating(s,'air')};});
 // The owned aircraft's proceeds would pay every fee; the capital-spending budget line allows two and a half.
 await page.evaluate(async fee=>{const b=GH_FINANCE_CORE.budget(__GH_STATE__,'air'),used=(Number(b.spentByLine.capex)||0)+(Number(b.reservedByLine.capex)||0);await __AUDIT__.runAuthorizedDomainCommand('finance','set-budget',{company:'air',limit:1e12,lines:{capex:used+fee*2.5}},{silent:true});},plan.fee);await settle(page);
 assert(plan.leased>=3&&plan.owned>=1,JSON.stringify(plan));
 await page.evaluate(()=>__AUDIT__.openDrawer('assetMarket','air'));await page.waitForTimeout(1500);await page.evaluate(()=>__AUDIT__.openDrawer('assetMarket','air'));const sellAll=page.locator('#drawerBody .sell-all-assets[data-company="air"]');await sellAll.waitFor();await page.waitForFunction(()=>!document.querySelector('#drawerBody .sell-all-assets[data-company="air"]')?.disabled);
 before=await snap(page);const inv0=await page.evaluate(()=>__GH_STATE__.finance.invoices.length);await sellAll.click();await page.waitForTimeout(300);if(await page.locator('dialog.ui-confirm[open]').count())await page.locator('dialog.ui-confirm [data-confirm="accept"]').click();await page.waitForTimeout(300);await settle(page);after=await snap(page);
 const bulk=await page.evaluate(n=>({alert:(__GH_STATE__.alerts||[]).map(String).find(a=>a.startsWith('أمر البيع الجماعي'))||'',leased:GH_FLEET_DATA.filter(__GH_STATE__,x=>x.ownership==='lease').length,owned:GH_FLEET_DATA.filter(__GH_STATE__,x=>x.ownership!=='lease').length,newInvoices:__GH_STATE__.finance.invoices.length-n,notices:window.__QA_NOTICES__.slice(-2)}),inv0);
 assert.equal(bulk.owned,0,`5: every owned aircraft sold ${JSON.stringify(bulk)}`);assert.equal(bulk.leased,plan.leased-2,`5: two leases returned within the budget, the rest kept ${JSON.stringify(bulk)}`);assert.match(bulk.alert,/بقي \d+ مؤجر في الخدمة/,'5: the kept leases are counted');
 assert(bulk.newInvoices<=2,`5: one credit and one payment for the order (${bulk.newInvoices} invoices)`);assert(after.cash>=0,'5: never below zero');
 // 6
 await page.evaluate(()=>{const s=__GH_STATE__;s.godMoney=true;s.infiniteMoney=true;});await page.evaluate(()=>__AUDIT__.openDrawer('assetMarket','air'));await page.waitForTimeout(1500);await page.evaluate(()=>__AUDIT__.openDrawer('assetMarket','air'));await page.waitForFunction(()=>!document.querySelector('#drawerBody .sell-all-assets[data-company="air"]')?.disabled);
 const inv1=await page.evaluate(()=>__GH_STATE__.finance.invoices.length);await page.locator('#drawerBody .sell-all-assets[data-company="air"]').click();await page.waitForTimeout(300);if(await page.locator('dialog.ui-confirm[open]').count())await page.locator('dialog.ui-confirm [data-confirm="accept"]').click();await page.waitForTimeout(300);await settle(page);
 const all=await page.evaluate(n=>({left:GH_FLEET_DATA.filter(__GH_STATE__,x=>!x.salePending).length,newInvoices:__GH_STATE__.finance.invoices.length-n,notices:window.__QA_NOTICES__.slice(-2)}),inv1);
 assert.equal(all.left,0,'6: everything goes in investor mode');assert(all.newInvoices<=1,`6: one payment of fees (${all.newInvoices})`);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({suite:'build573-asset-sale-browser',ok:true,plan,bulk}));
}finally{await browser.close();await env?.closeOrigin?.();}})().catch(error=>{console.error(error);process.exitCode=1;});
