'use strict';
// The owner's failing action from the diagnostic (build 77, day 54), through the real app: payables incurred last month
// under a budget, a new month with part of its budget spent, a cheque for every payable, then «صرف كل الشيكات». It was
// cancelled whole with «أُلغي الأمر بالكامل ولم يتغير أي أصل: invalid-draft:budget»; checked through the real buttons:
//  1. every cheque is cashed by one durable command and one save, the payables close, and the money leaves once;
//  2. this month's budget is unchanged (last month's payables were counted in their own month), the cap holds, and the
//     save validates; no notice of a cancelled command;
//  3. weight: the batch's time is reported.
const assert=require('node:assert/strict');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');
const COUNT=6,AMOUNT=150000,ROOM=400000;
(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    const {page}=await boot({browser,errors});page.setDefaultTimeout(120000);
    const budget=()=>page.evaluate(()=>{const b=GH_FINANCE_CORE.budget(__GH_STATE__,'group');return {limit:b.limit,spent:b.spent,reserved:b.reserved,period:b.period};});
    const snapshot=()=>page.evaluate(()=>{const s=__GH_STATE__,F=GH_FINANCE_CORE;return {payables:(s.finance.payables||[]).filter(row=>row.number.startsWith('QA-LAPSE')).length,issued:(s.finance.cheques||[]).filter(ch=>ch.status==='صادر'&&String(ch.invoiceNumber||'').startsWith('QA-LAPSE')).length,cleared:(s.finance.cheques||[]).filter(ch=>ch.status==='مصروف'&&String(ch.invoiceNumber||'').startsWith('QA-LAPSE')).length,returned:(s.finance.cheques||[]).filter(ch=>ch.status==='مرتجع').length,balance:F.operating(s,'group'),saveRevision:s.saveRevision,schema:GH_SAVE_SCHEMA.validate(s).errors||[]};});
    // Every notice the player sees, so a cancelled command fails here with its own message rather than a timeout.
    await page.evaluate(()=>{window.__QA_NOTICES__=[];const shown=globalThis.GH_INTERACTION_NOTICE;globalThis.GH_INTERACTION_NOTICE=(text,kind)=>{window.__QA_NOTICES__.push(String(text));return typeof shown==='function'?shown(text,kind):undefined;};});
    const click=async selector=>{const before=await page.evaluate(()=>[__GH_STATE__.saveRevision,window.__QA_NOTICES__.length]);await page.evaluate(()=>__AUDIT__.openDrawer('invoices',{company:'group',tab:'obligations',view:'payables'}));const button=page.locator(selector).first();await button.waitFor({state:'visible'});const started=Date.now();await button.click();
      await page.waitForFunction(([rev,seen])=>__GH_STATE__.saveRevision>rev||window.__QA_NOTICES__.slice(seen).some(text=>/أُلغي الأمر|تعذر/.test(text)),before);const ms=Date.now()-started;await page.waitForTimeout(100);
      const cancelled=await page.evaluate(seen=>window.__QA_NOTICES__.slice(seen).filter(text=>/أُلغي الأمر|تعذر/.test(text)),before[1]);assert.deepEqual(cancelled,[],`${selector}: the command was not cancelled`);return ms;};
    // Last month: a budget, and payables that reserve their amounts in it.
    const month0=await page.evaluate(async({COUNT,AMOUNT})=>{const s=__GH_STATE__,a=__AUDIT__,F=GH_FINANCE_CORE;s.godMoney=false;s.infiniteMoney=false;const b=F.budget(s,'group');
      await a.runAuthorizedDomainCommand('finance','set-budget',{company:'group',limit:b.spent+b.reserved+1e6},{silent:true});
      for(let i=0;i<COUNT;i++)await a.runAuthorizedDomainCommand('finance','accrue-expense',{company:'group',amount:AMOUNT,note:`QA صيانة ${i}`,counterparty:'QA Lapse Vendor LLC',taxable:false,number:`QA-LAPSE-${i}`},{silent:true});
      const after=F.budget(s,'group');return {day:Math.floor(s.simSeconds/86400),reserved:after.reserved,line:after.reservedByLine.maintenance,limit:after.limit};},{COUNT,AMOUNT});
    assert(month0.line>=COUNT*AMOUNT,`the payables reserved their amounts ${JSON.stringify(month0)}`);
    // A new month: its budget starts empty; spend all but ROOM of it.
    await page.evaluate(async({ROOM})=>{const s=__GH_STATE__,day=Math.floor(s.simSeconds/86400),next=(Math.floor(day/30)+1)*30;s.simSeconds=next*86400+3600;s.lastFinancialDay=next;
      const b=GH_FINANCE_CORE.budget(s,'group');await __AUDIT__.runAuthorizedDomainCommand('finance','spend',{company:'group',amount:b.limit-ROOM,note:'QA صيانة دورية'},{silent:true});},{ROOM});
    const month1=await budget();assert.equal(month1.reserved,0,'a new month holds nothing');assert.equal(month1.limit-month1.spent,ROOM,'the room left');assert(COUNT*AMOUNT>ROOM,'the payables exceed the room');
    await click('.settle-all-payables[data-method="cheque"]');const issued=await snapshot();assert.equal(issued.issued,COUNT,'a cheque for every payable');
    // 1
    const ms=await click('.settle-all-cheques'),cashed=await snapshot();
    assert.equal(cashed.cleared,COUNT,'every cheque is cashed');assert.equal(cashed.payables,0,'the payables close');assert.equal(cashed.returned,0,'no cheque bounces');
    assert.equal(cashed.saveRevision,issued.saveRevision+1,'one save');assert(Math.abs(issued.balance-cashed.balance-COUNT*AMOUNT)<.01,`the money leaves once: ${issued.balance} -> ${cashed.balance}`);
    // 2
    const after=await budget();assert.deepEqual(after,month1,'this month\'s budget is unchanged');assert(after.spent+after.reserved<=after.limit+.01,'the cap holds');
    assert.deepEqual(cashed.schema.filter(e=>/budget/.test(e)),[],'the save validates');assert.equal(errors.length,0,errors.join('\n'));
    console.log(JSON.stringify({suite:'build568-budget-lapsed-cheques-browser',ok:true,cheques:COUNT,batchMs:ms}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
