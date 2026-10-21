'use strict';
// The owner: «الضريبة ماقدر اسددها ولاتنزل». A month of real play without investor mode, then the taxes page:
//  1. a fleet company without the cash for its monthly internal insurance premium no longer stops the game on day 30
//     (the payment threw inside the day's close and every retry failed, so the month never closed and its tax never
//     became payable): the day closes, and that policy is recorded unpaid and moves no money (build572 proves a payer
//     with the cash is still paid);
//  2. the month closes and its VAT becomes due for the companies that sold;
//  3. paying one company from the taxes page pays it, its due goes to zero, and the page stays on every company with
//     the others still due (it jumped to the paid company alone);
//  4. a company short of cash is told what it owes and what it holds, and nothing is paid or saved;
//  5. paying every company pays those that can and names the one that cannot.
// Chromium; the game's own simulation engine and buttons.
const assert=require('node:assert/strict'),path=require('node:path'),{chromium}=require('playwright');
const {bootAtOrigin,installVault}=require('./helpers/differential-vault-fixture.cjs'),{prepareCommandWorld}=require('./helpers/command-world-fixture.cjs');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
(async()=>{const browser=await chromium.launch({headless:true}),errors=[];let env;try{
 env=await bootAtOrigin({browser,root:ROOT,errors,fleetWorker:true,viewport:{width:956,height:440},beforeScripts:{fn:installVault}});const {page}=env;page.setDefaultTimeout(600000);await prepareCommandWorld(page,{count:4});
 await page.evaluate(()=>{window.__QA_NOTICES__=[];const shown=globalThis.GH_INTERACTION_NOTICE;globalThis.GH_INTERACTION_NOTICE=(t,k)=>{window.__QA_NOTICES__.push(String(t));return typeof shown==='function'?shown(t,k):undefined;};});
 const setup=await page.evaluate(async()=>{const s=__GH_STATE__,a=__AUDIT__,F=GH_FINANCE_CORE;s.godMoney=false;s.infiniteMoney=false;
  for(const company of ['group','sea','hospitality'])await a.runAuthorizedDomainCommand('finance','credit',{company,amount:5000000,note:'QA taxable sale',counterparty:'QA Customer',reference:`QA-VAT-${company}`,taxable:true},{silent:true});
  F.book(s,'air').accounts[0].balance=1000;F.reconcile(s);return {insurer:GH_COMPANY_PLATFORM.listInstances(s,{includeGroup:false}).some(row=>row.id==='insurance'&&row.operational)};});
 assert(setup.insurer,'the group has its own insurer');
 // 1 and 2: a month of play
 for(let d=0;d<31;d++){const r=await page.evaluate(async()=>{const r=__AUDIT__.simulationEngine.advanceTo(__GH_STATE__.simSeconds+86400,{reason:'qa-tax-month',speed:300});if(!r.accepted)return r;await new Promise(done=>{const wait=()=>__AUDIT__.simulationEngine.snapshot().manualAdvance?setTimeout(wait,20):done();wait();});return {accepted:true};});assert(r.accepted,JSON.stringify(r));}
 const month=await page.evaluate(()=>{const s=__GH_STATE__,policies=s.advanced.insurance.fleetPolicies||[];return {last:s.lastFinancialDay,fatal:(s.controlPlane?.incidents||[]).filter(i=>i.code==='SIM_FATAL_STATE').map(i=>i.detail),air:policies.filter(p=>p.company==='air'&&p.day===30).map(p=>({status:p.status,transfer:p.transferReference})),paid:policies.filter(p=>p.day===30&&p.company!=='air').map(p=>({status:p.status,transfer:Boolean(p.transferReference)})),premiumTransfers:s.finance.transfers.filter(t=>String(t.reference||'').startsWith('FLEET-POLICY-AIR-30')).length,due:(s.finance.periods||[]).filter(p=>p.status==='مستحق').map(p=>p.company).sort()};});
 assert(month.last>=31,`1: the clock went past day 30 (${month.last})`);assert.deepEqual(month.fatal,[],'1: no fatal simulation state');
 assert.deepEqual(month.air,[{status:'غير مسدد · لا سيولة أو ميزانية',transfer:null}],'1: the unaffordable premium is recorded unpaid');assert.equal(month.premiumTransfers,0,'1: and moves no money');
 assert.deepEqual(month.due,['group','hospitality','sea'],'2: the month\'s VAT is due for the companies that sold');
 // 3
 await page.evaluate(()=>__AUDIT__.openDrawer('invoices',{company:'all',tab:'obligations',view:'taxes'}));await page.waitForSelector('#drawerBody .pay-taxes[data-company="group"]');
 const groupCash=await page.evaluate(()=>GH_FINANCE_CORE.operating(__GH_STATE__,'group')),rev0=await page.evaluate(()=>__GH_STATE__.saveRevision);
 await page.locator('#drawerBody .pay-taxes[data-company="group"]').click();await page.waitForFunction(r=>__GH_STATE__.saveRevision>r&&!window.__GH_DURABLE_COMMAND_CONTEXT__,rev0);await page.waitForTimeout(300);
 const after=await page.evaluate(()=>({arg:__AUDIT__.currentArg(),buttons:[...document.querySelectorAll('#drawerBody .pay-taxes')].map(b=>b.dataset.company).sort(),groupDue:(__GH_STATE__.finance.periods||[]).filter(p=>p.company==='group'&&p.status==='مستحق').length,cash:GH_FINANCE_CORE.operating(__GH_STATE__,'group')}));
 assert.equal(after.arg.company,'all','3: the page stays on every company');assert.deepEqual(after.buttons,['hospitality','sea'],'3: the others are still due and payable');assert.equal(after.groupDue,0,'3: the paid company owes nothing');assert(groupCash-after.cash>600000,'3: the tax left its account');
 // 4
 await page.evaluate(()=>{const s=__GH_STATE__,F=GH_FINANCE_CORE;F.book(s,'sea').accounts[0].balance=1000;F.reconcile(s);});const rev1=await page.evaluate(()=>[__GH_STATE__.saveRevision,window.__QA_NOTICES__.length]);
 await page.locator('#drawerBody .pay-taxes[data-company="sea"]').click();await page.waitForFunction(([,n])=>window.__QA_NOTICES__.length>n,rev1);await page.waitForFunction(()=>!window.__GH_DURABLE_COMMAND_CONTEXT__);
 const poor=await page.evaluate(([r,n])=>({notice:window.__QA_NOTICES__.slice(n).join(' | '),saved:__GH_STATE__.saveRevision>r,due:(__GH_STATE__.finance.periods||[]).some(p=>p.company==='sea'&&p.status==='مستحق'),cash:GH_FINANCE_CORE.operating(__GH_STATE__,'sea')}),rev1);
 assert.match(poor.notice,/لا يكفي لضريبتها المستحقة/,`4: the reason in words: ${poor.notice}`);assert(!/insufficient-cash/.test(poor.notice),'4: not a code');assert.equal(poor.saved,false,'4: nothing saved');assert.equal(poor.due,true,'4: still due');assert.equal(poor.cash,1000,'4: nothing paid');
 // 5
 await page.evaluate(()=>__AUDIT__.openDrawer('invoices',{company:'all',tab:'obligations',view:'taxes'}));const rev2=await page.evaluate(()=>__GH_STATE__.saveRevision);await page.locator('#drawerBody .pay-all-taxes').click();
 await page.waitForFunction(r=>__GH_STATE__.saveRevision>r&&!window.__GH_DURABLE_COMMAND_CONTEXT__,rev2);const all=await page.evaluate(()=>({due:(__GH_STATE__.finance.periods||[]).filter(p=>p.status==='مستحق').map(p=>p.company),alert:(__GH_STATE__.alerts||[]).find(a=>String(a).includes('سُددت ضرائب'))||''}));
 assert.deepEqual(all.due,['sea'],'5: the company that can pay is paid');assert.match(all.alert,/بقيت مستحقة لعدم كفاية الرصيد/,'5: and the one that cannot is named');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({suite:'build571-tax-month-close-browser',ok:true,lastDay:month.last}));
}finally{await browser.close();await env?.closeOrigin?.();}})().catch(error=>{console.error(error);process.exitCode=1;});
