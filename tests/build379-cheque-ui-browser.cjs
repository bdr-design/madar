'use strict';
const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright'),{boot}=require('./helpers/local-dom-app');
(async()=>{for(const engine of [chromium,webkit]){const browser=await engine.launch({headless:true});try{
 const errors=[],{page}=await boot({browser,errors});page.setDefaultTimeout(90000);
 const setup=await page.evaluate(async()=>{
  const a=__AUDIT__;await a.runAuthorizedDomainCommand('corporate','open-company',{type:'air',capital:400000000,legalName:'QA Cheque Review'},{silent:true});
  const st=__GH_STATE__;GH_FINANCE_CORE.book(st,'air').accounts[0].balance=1.98e14;GH_FINANCE_CORE.reconcile(st);
  const issued=await a.runAuthorizedDomainCommand('finance','issue-cheque',{company:'air',amount:925580.55,beneficiary:'QA Supplier',note:'Review numeric post-commit UI check',dueDay:Math.floor(st.simSeconds/86400)},{silent:true});
  const id=issued.result.id;a.openDrawer('invoices',{company:'air',tab:'documents',view:'cheques'});return {id,before:GH_FINANCE_CORE.operating(__GH_STATE__,'air'),saveRevision:__GH_STATE__.saveRevision};
 });
 await page.locator(`.settle-cheque-now[data-id="${setup.id}"]`).first().click();
 await page.waitForFunction(id=>__GH_STATE__.finance.cheques.find(c=>c.id===id)?.status==='مصروف',setup.id);
 await page.waitForFunction(()=>!window.__GH_DURABLE_COMMAND_CONTEXT__);
 await page.waitForFunction(id=>(__GH_STATE__.alerts||[]).some(text=>String(text).includes('تم صرف الشيك '+id)),setup.id);
 const outcome=await page.evaluate(id=>{
  const st=__GH_STATE__,cheque=st.finance.cheques.find(c=>c.id===id),raw=localStorage.getItem('global-holdings-world-v3.0.0'),saved=raw?GH_STATE_CODEC.decodeState(JSON.parse(raw)):null;
  return {status:cheque.status,amount:cheque.amount,after:GH_FINANCE_CORE.operating(st,'air'),saveRevision:st.saveRevision,persistedStatus:saved?.finance?.cheques?.find(c=>c.id===id)?.status,failureNoticeRecorded:(__GH_STATE__.workflowControl?.history||[]).some(r=>String(r.detail?.message||'').includes('cheque-current-account-posting-mismatch')),domainTransaction:GH_TRANSACTION_CORE.telemetry().lastDurable,integrity:GH_INTEGRITY_CORE.check(st).counts};
 },setup.id);
 assert.equal(outcome.status,'مصروف');assert.equal(outcome.persistedStatus,'مصروف');assert.equal(outcome.failureNoticeRecorded,false);assert.equal(outcome.domainTransaction.committed,true);assert.equal(outcome.saveRevision,setup.saveRevision+1);assert.equal(outcome.integrity.critical,0);
 // Retry the financial command in the isolated page: finance must remain idempotent.
 await page.evaluate(id=>__AUDIT__.runAuthorizedDomainCommand('finance','settle-cheque',{id},{silent:true}),setup.id);await page.waitForFunction(()=>!window.__GH_DURABLE_COMMAND_CONTEXT__);
 const afterRetry=await page.evaluate(id=>({balance:GH_FINANCE_CORE.operating(__GH_STATE__,'air'),status:__GH_STATE__.finance.cheques.find(c=>c.id===id)?.status}),setup.id);assert.equal(afterRetry.balance,outcome.after);assert.equal(afterRetry.status,'مصروف');assert.deepEqual(errors,[]);
 console.log(JSON.stringify({suite:'build379-cheque-ui-browser',ok:true,engine:engine.name(),before:setup.before,after:outcome.after,amount:outcome.amount,status:outcome.status,persistedStatus:outcome.persistedStatus,failureNoticeRecorded:false,retryDebitedAgain:false}));
}finally{await browser.close();}}})().catch(e=>{console.error(e);process.exitCode=1;});
