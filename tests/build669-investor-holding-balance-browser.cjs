'use strict';
// Build 669, seen in the play-through (the buyer of the investor licence): the companies page printed «رصيد القابضة
// $InfinityT» on the open-all card and «حساب القابضة يكفي $InfinityT» on every unopened company. In the investor mode no
// balance bounds an opening, so the page's own figure is Infinity and it was printed as money.
// The two cards now name what pays: the investor card. Checked on the real page, the mode switched by its own button:
//   1. without the mode the cards print the holding's balance as before (the control), and a company the holding cannot
//      afford shows what it lacks;
//   2. with the mode on, no text of the page holds «Infinity»; the open-all card and every unopened company read
//      «التمويل · بطاقة المستثمر», nothing is short and the open-all button is enabled;
//   3. with the mode off again the cards print the balance again.
const assert=require('node:assert/strict');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');
(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    const {page}=await boot({browser,errors,viewport:{width:844,height:390}});page.setDefaultTimeout(60000);
    const read=async()=>{await page.evaluate(()=>__AUDIT__.openDrawer('companies','subs'));await page.locator('#drawerBody .company-open-all').waitFor({state:'visible'});
      return page.evaluate(()=>{const body=document.getElementById('drawerBody'),pair=node=>[node.querySelector('dt,span').textContent.trim(),node.querySelector('dd,b').textContent.trim()];
        return {text:body.innerText,openAll:[...body.querySelectorAll('.company-open-all .metric-row>div')].map(pair),disabled:body.querySelector('.open-all-companies').disabled,funding:[...body.querySelectorAll('dl>div.is-good,dl>div.is-short')].map(node=>[node.className,...pair(node)]),
          holding:GH_FINANCE_CORE.operating(__GH_STATE__,'group'),investor:GH_FINANCE_CORE.investorMode(__GH_STATE__),unopened:GH_COMPANY_PLATFORM.listInstances(__GH_STATE__,{includeGroup:false}).filter(row=>!row.opened).length};});};
    const toggle=async on=>{await page.evaluate(()=>__AUDIT__.openDrawer('investorMode'));await page.locator('#drawerBody .investor-mode-toggle').first().click();await page.waitForFunction(on=>GH_FINANCE_CORE.investorMode(__GH_STATE__)===on&&!window.__GH_DURABLE_COMMAND_CONTEXT__,on);};
    const money=/^\$[\d.,]+[KMBT]?$/;

    // 1. The control: no investor mode.
    const before=await read();assert.equal(before.investor,false,'1: the game starts without the investor mode');assert.ok(before.unopened>=8&&before.funding.length===before.unopened,`1: one funding line per unopened company (${before.funding.length} of ${before.unopened})`);
    assert.equal(before.openAll[1][0],'رصيد القابضة','1: the open-all card names the holding\'s balance');assert.match(before.openAll[1][1],money,'1: as money');
    assert.ok(before.funding.every(row=>['ينقص حساب القابضة','حساب القابضة يكفي'].includes(row[1])&&money.test(row[2])),`1: every company prints the balance or what it lacks: ${JSON.stringify(before.funding.slice(0,3))}`);
    assert.ok(before.funding.some(row=>row[1]==='حساب القابضة يكفي'&&row[2]===before.openAll[1][1]),'1: an affordable company prints the same balance as the open-all card');
    assert.doesNotMatch(before.text,/Infinity|NaN|undefined/,'1: no raw value on the page');
    console.log(`1 ok: without the investor mode the cards print the holding's balance (${before.openAll[1][1]})`);

    // A company the holding cannot afford: the holding spends 900M, and the larger capitals are short.
    await page.evaluate(async()=>{await __AUDIT__.runAuthorizedDomainCommand('finance','spend',{company:'group',amount:900000000,note:'QA holding expense',method:'تحويل بنكي',taxable:false},{silent:true});});
    const short=await read(),lacking=short.funding.filter(row=>row[1]==='ينقص حساب القابضة');assert.ok(short.holding<150000000,'1: the holding is down to about 100M');
    assert.ok(lacking.length>=1&&lacking.length<short.funding.length,`1: some companies are short, not all (${lacking.length} of ${short.funding.length})`);assert.ok(lacking.every(row=>row[0].includes('is-short')&&money.test(row[2])),'1: a short company prints what it lacks');
    assert.ok(short.funding.filter(row=>row[1]==='حساب القابضة يكفي').every(row=>row[2]===short.openAll[1][1]),'1: an affordable one prints the balance');assert.doesNotMatch(short.openAll[2][1],/^\$0(\.0+)?$/,'1: the open-all card shows the shortfall');assert.equal(short.disabled,true,'1: and its button is disabled');

    // 2. The investor mode, switched by its own button.
    await toggle(true);const on=await read();assert.equal(on.investor,true);
    assert.doesNotMatch(on.text,/Infinity|NaN|undefined|∞/,'2: no raw value on the page');
    assert.deepEqual(on.openAll[1],['التمويل','بطاقة المستثمر'],'2: the open-all card names the investor card');assert.equal(on.openAll[0][1],before.openAll[0][1],'2: the total capital is unchanged');assert.ok(on.funding.every(row=>row[1]!=='ينقص حساب القابضة'),'2: no company is short');assert.match(on.openAll[2][1],/^\$0(\.0+)?$/,'2: nothing is short');assert.equal(on.disabled,false,'2: the open-all button is enabled');
    assert.equal(on.funding.length,on.unopened,'2: one funding line per unopened company');assert.ok(on.funding.every(row=>row[0].includes('is-good')&&row[1]==='التمويل'&&row[2]==='بطاقة المستثمر'),`2: every company names the investor card: ${JSON.stringify(on.funding.slice(0,3))}`);
    console.log(`2 ok: with the investor mode, ${on.funding.length} companies and the open-all card read «التمويل · بطاقة المستثمر»; no «Infinity»`);

    // 3. Off again.
    await toggle(false);const off=await read();assert.equal(off.investor,false);assert.equal(off.openAll[1][0],'رصيد القابضة','3: the balance is named again');assert.match(off.openAll[1][1],money,'3: as money');
    assert.ok(off.funding.every(row=>['ينقص حساب القابضة','حساب القابضة يكفي'].includes(row[1])&&money.test(row[2])),'3: every company prints money again');assert.deepEqual(off.funding,short.funding,'3: as before the mode, short companies included');assert.doesNotMatch(off.text,/Infinity|NaN|undefined/,'3: no raw value on the page');
    console.log('3 ok: with the mode off the cards print the balance again');
    assert.deepEqual(errors,[]);console.log('build669 investor holding balance: 3 checks passed');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
