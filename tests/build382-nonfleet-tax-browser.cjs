'use strict';
const assert=require('node:assert/strict'),{chromium}=require('playwright'),{boot,reboot}=require('./helpers/local-dom-app');
(async()=>{const browser=await chromium.launch({headless:true}),errors=[];try{
 let {page}=await boot({browser,errors});page.setDefaultTimeout(90000);
 const companies=['bank','insurance','telecom','dealership'];
 const before=await page.evaluate(async companies=>{const s=__GH_STATE__,a=__AUDIT__,F=GH_FINANCE_CORE;s.godMoney=true;s.infiniteMoney=true;
  for(const type of companies){await a.runAuthorizedDomainCommand('corporate','open-company',{type,capital:200000000,legalName:'QA Tax '+type},{silent:true});await a.runAuthorizedDomainCommand('finance','credit',{company:type,amount:11500000,taxable:true,reference:'QA-OUTPUT-'+type},{silent:true});}
  return companies.map(c=>({company:c,output:F.book(s,c).vat.output,due:F.book(s,c).taxPayable}));},companies);
 assert.ok(before.every(r=>r.output===1500000&&r.due===0),'output VAT exists while the month remains open');
 await page.evaluate(()=>__AUDIT__.openDrawer('invoices',{company:'telecom',tab:'obligations',view:'taxes'}));assert.match(await page.locator('.tax-company-live-row').textContent(),/لا مبلغ للسداد الآن.*إقفال/);
 const closed=await page.evaluate(companies=>{const s=__GH_STATE__;s.simSeconds=30*86400;s.lastFinancialDay=29;GH_TRANSACTION_CORE.execute(s,{label:'QA-real-month-end',apply:()=>__AUDIT__.processFinancialDay(30)});
  return companies.map(company=>{const p=s.finance.periods.find(r=>r.company===company&&r.periodKey==='2026-01');return {company,period:p?.id,amount:p?.amount,due:GH_FINANCE_CORE.book(s,company).taxPayable};});},companies);
 assert.ok(closed.every(r=>r.period&&r.amount>0&&r.due===r.amount),JSON.stringify(closed));
 await page.evaluate(()=>__AUDIT__.openDrawer('invoices',{company:'all',tab:'obligations',view:'taxes'}));
 assert.equal(await page.locator('.pay-taxes').count(),4);
 const paid=await page.evaluate(async companies=>{const results=[];for(const company of companies){const F=GH_FINANCE_CORE,s=__GH_STATE__,before=F.operating(s,company),r=(await __AUDIT__.runAuthorizedDomainCommand('finance','pay-taxes',{company},{silent:true})).result;results.push({company,amount:r.amount,debit:before-F.operating(s,company),due:F.book(s,company).taxPayable,cheque:s.finance.cheques.find(c=>c.id===r.chequeId)?.status});}return results;},companies);
 assert.ok(paid.every(r=>r.amount>0&&Math.abs(r.amount-r.debit)<.01&&r.due===0&&r.cheque==='مصروف'),JSON.stringify(paid));
 ({page}=await reboot(page,{browser,errors}));
 const reloaded=await page.evaluate(companies=>companies.map(company=>({company,due:GH_FINANCE_CORE.book(__GH_STATE__,company).taxPayable,paid:GH_FINANCE_CORE.book(__GH_STATE__,company).taxPaid})),companies);
 assert.ok(reloaded.every(r=>r.due===0&&r.paid>0));assert.deepEqual(errors,[]);
 const credit=await page.evaluate(async()=>{const a=__AUDIT__,s=__GH_STATE__,F=GH_FINANCE_CORE;s.simSeconds=31*86400;
  await a.runAuthorizedDomainCommand('finance','spend',{company:'telecom',amount:1150000,taxable:true,note:'QA INPUT CREDIT',counterparty:'QA Supplier'},{silent:true});await a.runAuthorizedDomainCommand('finance','credit',{company:'telecom',amount:115000,taxable:true,reference:'QA-FEB-OUTPUT'},{silent:true});
  const state=__GH_STATE__;state.simSeconds=58*86400;state.lastFinancialDay=57;GH_TRANSACTION_CORE.execute(state,{apply:()=>a.processFinancialDay(58)});return {due:F.book(state,'telecom').taxPayable,carry:F.book(state,'telecom').vat.creditCarry};});
 assert.deepEqual(credit,{due:0,carry:135000});await page.evaluate(()=>__AUDIT__.openDrawer('invoices',{company:'telecom',tab:'obligations',view:'taxes'}));assert.match(await page.locator('.tax-company-live-row').textContent(),/رصيد دائن/);
 console.log(JSON.stringify({suite:'build382-nonfleet-tax-browser',ok:true,before,closed,paid,reloadPreserved:true,inputCredit:credit}));
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
