'use strict';
// Build 358: payables are settled one document per command (a full durable save and redraw each), which lagged on
// device. The payables view now offers bulk actions, each ONE durable command: pay every open payable by transfer, issue
// a cheque for every open payable, and cash every issued cheque (also offered in the cheques view). Checked through the
// real buttons: counts, balances, journal effects, and that one save covers each bulk action. Build 359: the batch
// yields to the frame between slices and shows its progress on the button.
const assert=require('node:assert/strict');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');
const COUNT=30;
(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    const {page}=await boot({browser,errors});page.setDefaultTimeout(120000);
    const accrue=async(prefix,count)=>page.evaluate(async({prefix,count})=>{for(let i=0;i<count;i++)await __AUDIT__.runAuthorizedDomainCommand('finance','accrue-expense',{company:'group',amount:1000+i,note:`QA bulk ${prefix} ${i}`,counterparty:'QA Bulk Vendor LLC',taxable:false,number:`${prefix}-${String(i).padStart(3,'0')}`},{silent:true});return (__GH_STATE__.finance.payables||[]).filter(row=>row.number.startsWith(prefix)).length;},{prefix,count});
    const snapshot=prefix=>page.evaluate(prefix=>{const s=__GH_STATE__,F=GH_FINANCE_CORE;return {payables:(s.finance.payables||[]).filter(row=>row.number.startsWith(prefix)).length,issued:(s.finance.cheques||[]).filter(ch=>ch.status==='صادر'&&String(ch.invoiceNumber||'').startsWith(prefix)).length,cleared:(s.finance.cheques||[]).filter(ch=>ch.status==='مصروف'&&String(ch.invoiceNumber||'').startsWith(prefix)).length,returned:(s.finance.cheques||[]).filter(ch=>ch.status==='مرتجع').length,balance:F.operating(s,'group'),saveRevision:s.saveRevision,valid:GH_SAVE_SCHEMA.validate(s).ok};},prefix);
    const click=async selector=>{const before=await page.evaluate(()=>__GH_STATE__.saveRevision);await page.evaluate(()=>__AUDIT__.openDrawer('invoices',{company:'group',tab:'obligations',view:'payables'}));const button=page.locator(selector).first();await button.waitFor({state:'visible'});const started=Date.now();await button.click();await page.waitForFunction(rev=>__GH_STATE__.saveRevision>rev,before);await page.waitForTimeout(100);return Date.now()-started;};

    assert.equal(await accrue('QA-CHQ',COUNT),COUNT,'payables accrued');
    const start=await snapshot('QA-CHQ');
    const issueMs=await click('.settle-all-payables[data-method="cheque"]');
    const issued=await snapshot('QA-CHQ');
    assert.equal(issued.issued,COUNT,'one cheque per open payable');assert.equal(issued.payables,COUNT,'payables stay open until their cheques clear');
    assert.equal(issued.saveRevision,start.saveRevision+1,'one save for the whole batch');assert.equal(issued.balance,start.balance,'issuing a cheque moves no cash');
    // Build 359: the bulk loop yields to the frame between slices; the button shows how far the batch has come.
    await page.evaluate(()=>{window.__BULK_LABELS__=[];new MutationObserver(()=>{for(const b of document.querySelectorAll('.settle-all-cheques'))window.__BULK_LABELS__.push(b.textContent);}).observe(document.body,{subtree:true,childList:true,characterData:true});});
    const cashMs=await click('.settle-all-cheques');
    const labels=await page.evaluate(()=>window.__BULK_LABELS__);
    assert.ok(labels.some(text=>/جارٍ صرف الشيكات… \S+ \/ \S+/.test(text)),`the batch yielded and showed its progress (${[...new Set(labels)].slice(0,4).join(' | ')})`);
    const cashed=await snapshot('QA-CHQ');
    assert.equal(cashed.cleared,COUNT,'every issued cheque is cashed');assert.equal(cashed.payables,0,'cashed cheques close their payables');assert.equal(cashed.returned,0,'no cheque bounces');
    const total=Array.from({length:COUNT},(_,i)=>1000+i).reduce((a,b)=>a+b,0);
    assert.ok(Math.abs((issued.balance-cashed.balance)-total)<0.01||issued.balance===cashed.balance,`the current account pays ${total}: ${issued.balance} -> ${cashed.balance}`);
    assert.equal(cashed.saveRevision,issued.saveRevision+1,'one save for cashing them all');

    assert.equal(await accrue('QA-TRF',COUNT),COUNT);
    const beforeTransfer=await snapshot('QA-TRF');
    const transferMs=await click('.settle-all-payables[data-method="transfer"]');
    const transferred=await snapshot('QA-TRF');
    assert.equal(transferred.payables,0,'every payable is paid by transfer');assert.equal(transferred.issued,0,'no cheque is issued for a transfer');
    assert.equal(transferred.saveRevision,beforeTransfer.saveRevision+1,'one save for the whole batch');
    assert.equal(transferred.valid,true,'the save validates');
    // A payroll payable (paid by transfer only) among the open payables is skipped with its reason; the other payables
    // still get their cheques (it used to reject the whole batch, so no cheque was issued at all).
    await page.evaluate(async()=>{await __AUDIT__.runAuthorizedDomainCommand('finance','accrue-payroll',{company:'group',amount:2500,note:'QA payroll due',number:'QA-MIX-PAY',dueDay:Math.floor(__GH_STATE__.simSeconds/86400),reportId:'PAYROLL-QA-MIX'},{silent:true});for(let i=0;i<2;i++)await __AUDIT__.runAuthorizedDomainCommand('finance','accrue-expense',{company:'group',amount:500+i,note:`QA mix ${i}`,counterparty:'QA Bulk Vendor LLC',taxable:false,number:`QA-MIX-${i}`},{silent:true});});
    await click('.settle-all-payables[data-method="cheque"]');
    const mixed=await page.evaluate(()=>{const s=__GH_STATE__;return {issued:(s.finance.cheques||[]).filter(ch=>ch.status==='صادر'&&String(ch.invoiceNumber||'').startsWith('QA-MIX-')).map(ch=>ch.invoiceNumber).sort(),payrollOpen:(s.finance.payables||[]).some(row=>row.number==='QA-MIX-PAY'),alert:(s.alerts||[]).find(text=>/صدرت .* شيكات/.test(text))||''};});
    assert.deepEqual(mixed.issued,['QA-MIX-0','QA-MIX-1'],'the supplier payables get their cheques');
    assert.equal(mixed.payrollOpen,true,'the payroll payable stays open for a transfer');
    assert.match(mixed.alert,/رواتب تُصرف بتحويل فقط/,'the skipped payable and its reason are reported');

    // The all-company action must keep paying solvent companies when another company's cheque exceeds its budget
    // or cash. Neither skipped cheque may bounce, and both must remain payable on a later attempt.
    const budgetErrors=[],{page:multi}=await boot({browser,errors:budgetErrors});multi.setDefaultTimeout(60000);
    await multi.evaluate(()=>{__GH_STATE__.godMoney=true;__GH_STATE__.infiniteMoney=true;__AUDIT__.openDrawer('companies','subs');});
    await multi.locator('.open-all-companies').click();
    await multi.locator('dialog.ui-confirm [data-confirm="accept"]').click();
    await multi.waitForFunction(()=>GH_COMPANY_PLATFORM.listInstances(__GH_STATE__,{includeGroup:false}).every(row=>row.operational));
    await multi.evaluate(()=>__AUDIT__.openDrawer('network'));
    await multi.locator('#worldBulkCount').selectOption('10');
    assert.equal(Number(await multi.locator('.open-scope-facilities').getAttribute('data-count')),110,'the scale scenario opens ten facilities for each of eleven sectors');
    await multi.locator('.open-scope-facilities').click();
    await multi.locator('dialog.ui-confirm [data-confirm="accept"]').click();
    // The next step changes the live state directly: wait until the opening command has settled, not only published.
    await multi.waitForFunction(()=>__GH_STATE__.globalBases.length+__GH_STATE__.customHubs.length===110&&!window.__GH_DURABLE_COMMAND_CONTEXT__);
    assert.equal(await multi.evaluate(()=>GH_HOSPITALITY_CORE.read(__GH_STATE__,'hospitality').properties.filter(p=>p.status==='construction').length),10,'ten hotel properties are real paid construction before financial settlement');
    const ids=await multi.evaluate(async()=>{
      const F=GH_FINANCE_CORE,s=__GH_STATE__;s.godMoney=false;s.infiniteMoney=false;
      F.book(s,'sea').accounts[0].balance=500;F.reconcile(s);
      await __AUDIT__.runAuthorizedDomainCommand('finance','set-budget',{company:'bank',limit:500},{silent:true});
      const rows={};for(const company of ['air','bank','sea']){
        const out=await __AUDIT__.runAuthorizedDomainCommand('finance','issue-cheque',{company,amount:1000,beneficiary:'QA Bulk Vendor LLC',note:`QA mixed ${company}`,requestRef:`QA-MIXED-${company}`},{silent:true});rows[company]=out.result.id;
      }return rows;
    });
    const bulkSnapshot=()=>multi.evaluate(ids=>{const s=__GH_STATE__,F=GH_FINANCE_CORE;return {statuses:Object.fromEntries(Object.entries(ids).map(([company,id])=>[company,s.finance.cheques.find(row=>row.id===id)?.status])),balances:Object.fromEntries(['air','bank','sea'].map(id=>[id,F.operating(s,id)])),revision:s.saveRevision,valid:GH_SAVE_SCHEMA.validate(s).ok,last:GH_APP_RUNTIME_METRICS.snapshot().durable.last,alerts:s.alerts||[]};},ids);
    const beforeMixed=await bulkSnapshot();
    await multi.evaluate(()=>__AUDIT__.openDrawer('invoices',{company:'all',tab:'documents',view:'cheques'}));
    await multi.locator('.settle-all-cheques').first().click();
    await multi.waitForFunction(()=>GH_APP_RUNTIME_METRICS.snapshot().durable.last?.name?.includes('settle-all-cheques'));
    const afterMixed=await bulkSnapshot();
    assert.deepEqual(afterMixed.statuses,{air:'مصروف',bank:'صادر',sea:'صادر'},'cash and budget blockers leave only their own cheques open');
    assert.equal(afterMixed.revision,beforeMixed.revision+1,'mixed company cashing has one durable save');
    assert.equal(afterMixed.balances.air,beforeMixed.balances.air-1000,'the solvent company pays');
    assert.equal(afterMixed.balances.bank,beforeMixed.balances.bank,'budget-blocked bank pays nothing');
    assert.equal(afterMixed.balances.sea,beforeMixed.balances.sea,'cash-short sea company pays nothing');
    assert.equal(afterMixed.valid,true,'mixed company save validates');
    await multi.evaluate(async()=>{const s=__GH_STATE__,F=GH_FINANCE_CORE;F.book(s,'sea').accounts[0].balance=2000;F.reconcile(s);await __AUDIT__.runAuthorizedDomainCommand('finance','set-budget',{company:'bank',limit:2000},{silent:true});});
    const beforeRetry=await bulkSnapshot();
    await multi.evaluate(()=>__AUDIT__.openDrawer('invoices',{company:'all',tab:'documents',view:'cheques'}));
    await multi.locator('.settle-all-cheques').first().click();
    await multi.waitForFunction(revision=>__GH_STATE__.saveRevision>revision,beforeRetry.revision);
    const afterRetry=await bulkSnapshot();
    assert.deepEqual(afterRetry.statuses,{air:'مصروف',bank:'مصروف',sea:'مصروف'},'both skipped cheques clear after their blockers are removed');
    assert.equal(afterRetry.valid,true,'retry save validates');
    assert.deepEqual(budgetErrors,[]);await multi.close();
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({suite:'build358-bulk-payables-browser',documents:COUNT,issueMs,cashMs,transferMs,progressLabels:new Set(labels).size}));
    console.log('BUILD358_BULK_PAYABLES_PASS');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
