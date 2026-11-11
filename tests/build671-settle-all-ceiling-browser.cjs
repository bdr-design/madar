'use strict';
// Build 671 (the review of build 667), through the real button: «سداد الكل بتحويل» pays every open payable in one command
// and checked cash only before each. One payable the month's ceiling refuses (an interest invoice, a take-or-pay bill)
// made the settlement throw inside the batch: the whole command was rejected and nothing was paid.
// The batch now asks the finance owner why a transfer cannot settle a payable (payableTransferBlocker) and skips that
// one with its reason, as it already skips one the cash cannot cover. Checked on the real page:
//   1. under a 1M ceiling, two accrued bills and one 1.5M payable the ceiling refuses: one click pays the two bills in one
//      save, leaves the refused payable open and says why;
//   2. a second click, with only the refused payable left, changes nothing and says why;
//   3. with the ceiling raised, the same click pays it;
//   4. two 600K payables on a 1M line: one click pays one and leaves the other, read against what the first took.
const assert=require('node:assert/strict');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');
(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    const {page}=await boot({browser,errors});page.setDefaultTimeout(60000);
    const command=(domain,name,payload)=>page.evaluate(async([domain,name,payload])=>{await __AUDIT__.runAuthorizedDomainCommand(domain,name,payload,{silent:true});},[domain,name,payload]);
    const read=()=>page.evaluate(()=>{const s=__GH_STATE__,F=GH_FINANCE_CORE;return {open:(s.finance.payables||[]).filter(row=>String(row.number).startsWith('QA-')).map(row=>String(row.number)).sort(),cash:F.operating(s,'group'),spent:s.companyBudgets.group?.spent||0,saveRevision:s.saveRevision,alert:String(s.alerts?.[0]||''),valid:GH_SAVE_SCHEMA.validate(s).ok,busy:!!window.__GH_DURABLE_COMMAND_CONTEXT__};});
    const settleAll=async()=>{const before=await read();await page.evaluate(()=>__AUDIT__.openDrawer('invoices',{company:'group',tab:'obligations',view:'payables'}));const button=page.locator('.settle-all-payables[data-method="transfer"]').first();await button.waitFor({state:'visible'});await button.click();
      await page.waitForFunction(([revision,alert])=>!window.__GH_DURABLE_COMMAND_CONTEXT__&&(__GH_STATE__.saveRevision>revision||String(__GH_STATE__.alerts?.[0]||'')!==alert),[before.saveRevision,before.alert]);await page.waitForTimeout(150);return {before,after:await read()};};
    await command('finance','set-budget',{company:'group',limit:1000000,lines:{}});
    for(const number of ['QA-ACC-1','QA-ACC-2'])await command('finance','accrue-expense',{company:'group',amount:300000,note:`QA accrued ${number}`,counterparty:'QA Vendor LLC',taxable:false,number});
    // An ordinary open payable, as the energy company's interest invoice or a take-or-pay bill is issued (by the system).
    await page.evaluate(()=>{GH_DOMAIN_COMMANDS.dispatchSystem({state:__GH_STATE__},'finance','issue-invoice',{kind:'مصروف',company:'group',amount:1500000,status:'مستحقة',taxable:false,method:'التزام عقد',counterparty:'QA Supplier LLC',note:'حد أدنى ملزم لعقد توريد · QA-TOP-1',number:'QA-TOP-1',dueDay:0,sourceRef:'QA-TOP-1'},{actor:'simulation'});});
    const start=await read();assert.deepEqual(start.open,['QA-ACC-1','QA-ACC-2','QA-TOP-1'],'the three payables are open');assert.deepEqual(await page.evaluate(()=>({room:GH_FINANCE_CORE.remaining(__GH_STATE__,'group'),reserved:__GH_STATE__.companyBudgets.group.reserved})),{room:400000,reserved:600000},'the two accrued bills hold their room; 400,000 is left for a 1.5M payable');

    // 1. One click.
    const first=await settleAll();assert.deepEqual(first.after.open,['QA-TOP-1'],'1: the two accrued bills are paid, the refused payable is left open');assert.equal(Math.round(first.before.cash-first.after.cash),600000,'1: 600,000 left the account');
    assert.equal(first.after.saveRevision,first.before.saveRevision+1,'1: in one save');assert.match(first.after.alert,/سُددت ذمتان/,'1: the result names what was paid');assert.match(first.after.alert,/بقيت ذمة واحدة: 1 سقف الميزانية لا يتسع لها/,`1: and why one was left: ${first.after.alert}`);assert.equal(first.after.valid,true);
    console.log('1 ok: one click pays the two accrued bills in one save and leaves the refused payable with its reason');

    // 2. Only the refused payable is left.
    const second=await settleAll();assert.deepEqual(second.after.open,['QA-TOP-1'],'2: nothing is paid');assert.equal(second.after.cash,second.before.cash,'2: no cash moves');assert.equal(second.after.saveRevision,second.before.saveRevision,'2: nothing is saved');
    assert.match(second.after.alert,/سقف الميزانية لا يتسع لها/,`2: the refusal says why: ${second.after.alert}`);
    console.log('2 ok: with only the refused payable left the click changes nothing and says why');

    // 3. With room.
    await command('finance','set-budget',{company:'group',limit:25000000,lines:{}});const third=await settleAll();assert.deepEqual(third.after.open,[],'3: with room it is paid');assert.equal(Math.round(third.before.cash-third.after.cash),1500000);assert.equal(third.after.valid,true);
    console.log('3 ok: with the ceiling raised the same click pays it');
    // 4. Two payables that fit only one at a time (a 1M «fuel» line): the second is read after the first is paid.
    await command('finance','set-budget',{company:'group',limit:25000000,lines:{fuel:1000000}});
    await page.evaluate(()=>{for(const number of ['QA-FUEL-1','QA-FUEL-2'])GH_DOMAIN_COMMANDS.dispatchSystem({state:__GH_STATE__},'finance','issue-invoice',{kind:'مصروف',company:'group',amount:600000,status:'مستحقة',taxable:false,method:'التزام عقد وقود',counterparty:'QA Fuel LLC',note:`حد أدنى ملزم لعقد الوقود · ${number}`,number,dueDay:0,sourceRef:number},{actor:'simulation'});});
    const fourth=await settleAll();assert.equal(fourth.after.open.length,1,`4: one of the two is paid: ${JSON.stringify(fourth.after.open)}`);assert.equal(Math.round(fourth.before.cash-fourth.after.cash),600000,'4: 600,000 left the account');assert.equal(fourth.after.saveRevision,fourth.before.saveRevision+1,'4: in one save');
    assert.match(fourth.after.alert,/سُددت ذمة واحدة/);assert.match(fourth.after.alert,/بقيت ذمة واحدة: 1 سقف الميزانية لا يتسع لها/,`4: the other is left with its reason: ${fourth.after.alert}`);assert.equal(fourth.after.valid,true);
    console.log('4 ok: of two payables that fit one at a time, one click pays one and leaves the other');
    assert.deepEqual(errors,[]);console.log('build671 settle all under a ceiling: 4 checks passed');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
