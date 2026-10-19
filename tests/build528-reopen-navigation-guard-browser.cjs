'use strict';
// build527 kept the page a player opened while a budget or a company decision committed. About thirty other app.js
// decisions (stakes, hedges, credit and bonds, debt, transfers, company names and logos, contracts, stocks, receivables,
// payables, taxes, Mobility, fleet service and departures, bank branches, energy, Mobility centers, company opening)
// still redrew their own page after their command committed and took a player who had opened another page meanwhile
// back to it. They now redraw through reopenDrawer, which does nothing after another navigation. Proven with the real
// app and the vault holding the commit's acknowledgement, so the navigation lands while the command is in flight:
//  1. a page button (the finance page's reserve transfer), 2. a decision function from its page (a stock purchase) and
//     3. a decision that redraws after its commit (signing a company's charter) each keep the treasury loans tab and commit;
//  4. without navigation each still redraws its own page;
//  5. no other app.js decision awaits and then opens a page directly (god mode redraws the page already shown).
// GH_GUARD_ENGINE=chromium runs Chromium only (WebKit is not installed everywhere).
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{chromium,webkit}=require('playwright');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {bootRenderApp}=require('./helpers/render-app.cjs'),{installVault}=require('./helpers/differential-vault-fixture.cjs'),{prepare}=require('./helpers/request-decisions-fixture.cjs');
// 5. Source: after an await, a page opens only through reopenDrawer or behind the same revision check.
{
  const lines=fs.readFileSync(path.join(ROOT,'WebApp/app.js'),'utf8').split('\n'),direct=[];
  lines.forEach((line,index)=>{const at=line.indexOf('await');if(at<0)return;const tail=line.slice(at),re=/(^|[^A-Za-z_.])openDrawer\(/g;let m;
    while((m=re.exec(tail))){const before=tail.slice(Math.max(0,m.index-60),m.index+1);if(/(drawerNavigationRevision===navigationRevision\)|navigationRevision===drawerNavigationRevision\)&&)$/.test(before))continue;direct.push({line:index+1,text:tail.slice(Math.max(0,m.index-50),m.index+60)});}});
  assert.equal(direct.length,1,`5: one direct page open after an await (${JSON.stringify(direct)})`);assert.match(direct[0].text,/if\(activeDrawerPanel\)openDrawer\(activeDrawerPanel,activeDrawerArg\)/,'5: god mode redraws the page already shown');
  assert.ok(lines.filter(line=>line.includes('reopenDrawer(navigationRevision,')).length>=30,'5: the decisions redraw through reopenDrawer');
}
const panel=page=>page.evaluate(()=>({panel:document.querySelector('#drawer')?.dataset.panel||'',loans:!!document.querySelector('#drawerBody #icLoanLender')}));
async function held(page,press,{navigate}){
  await page.evaluate(()=>{__DIFF_VAULT__.hold=true;__DIFF_VAULT__.pending=[];});
  const done=press();
  await page.waitForFunction(()=>__DIFF_VAULT__.pending.length>0,null,{timeout:60000});
  if(navigate)await page.evaluate(()=>__AUDIT__.openDrawer('treasury','loans'));
  await page.evaluate(()=>{__DIFF_VAULT__.hold=false;for(const ack of __DIFF_VAULT__.pending.splice(0))ack();});
  await done;
  await page.waitForFunction(()=>!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked(),null,{timeout:60000});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(resolve,300)))));
  return panel(page);
}
(async()=>{const results=[];for(const engine of process.env.GH_GUARD_ENGINE==='chromium'?[chromium]:[chromium,webkit]){const browser=await engine.launch({headless:true}),errors=[];let env;try{
  env=await bootRenderApp({browser,root:ROOT,errors,viewport:{width:844,height:390},beforeScripts:{fn:installVault}});const page=env.page;page.setDefaultTimeout(120000);
  // 3. A decision that redraws after its commit: signing a company's charter opens its formation contract.
  // It runs before the fixture opens every company; money as the fixture sets it.
  const types=await page.evaluate(()=>{const s=__GH_STATE__;s.godMoney=true;s.infiniteMoney=true;return ['telecom','dealership','insurance','realestate'].filter(type=>!s.openedCompanies.includes(type));});
  assert.ok(types.length>=2,`two companies are still to open (${types})`);
  const charter=async(navigate,type)=>{
    await page.evaluate(type=>__AUDIT__.openDrawer('formationContract',type),type);const button=page.locator(`#drawerBody .sign-charter[data-company="${type}"]`).first();await button.waitFor();
    const out=await held(page,()=>button.click(),{navigate});return {...out,opened:await page.evaluate(type=>__GH_STATE__.openedCompanies.includes(type),type)};
  };
  const opened=await charter(true,types[0]);assert.equal(opened.panel,'treasury','3: a company opening keeps the page the player opened');assert.equal(opened.loans,true);assert.equal(opened.opened,true,'3: the company is opened');
  const openedHere=await charter(false,types[1]);assert.equal(openedHere.panel,'formationContract','4: without navigation the formation contract is shown');assert.equal(openedHere.opened,true);
  await prepare(page,{rows:200});
  // 1. A page button: the finance page's reserve transfer.
  const reserve=()=>page.evaluate(()=>{const s=__GH_STATE__;return (s.companyFinance?.group?.accounts?.[1]?.balance)??JSON.stringify(s.companyFinance?.group?.accounts||null);});
  const transfer=async navigate=>{
    await page.evaluate(()=>__AUDIT__.openDrawer('finance'));const button=page.locator('#drawerBody .company-reserve-transfer[data-direction="reserve"][data-company="group"]').first();await button.waitFor();
    const before=await reserve(),out=await held(page,()=>button.click(),{navigate});return {...out,before,after:await reserve()};
  };
  const moved=await transfer(true);
  assert.equal(moved.panel,'treasury','1: the player stays on the page they opened');assert.equal(moved.loans,true,'1: the loans tab is shown');assert.notEqual(moved.after,moved.before,'1: the transfer is committed');
  const stayed=await transfer(false);assert.equal(stayed.panel,'finance','4: without navigation the finance page is redrawn');assert.notEqual(stayed.after,stayed.before);
  // 2. A decision function from its page's button: a stock purchase (the stock page's buy button, 1,000 shares).
  const sym=await page.evaluate(()=>__GH_STATE__.market.find(row=>Number(row.price)>0).sym),shares=()=>page.evaluate(sym=>Number(__GH_STATE__.portfolio?.[sym])||0,sym);
  const trade=async navigate=>{
    await page.evaluate(sym=>__AUDIT__.openDrawer('stocks',`sym:${sym}`),sym);const button=page.locator(`#drawerBody .buy-stock[data-id="${sym}"]`).first();await button.waitFor();const before=await shares();
    const out=await held(page,()=>button.click(),{navigate});return {...out,bought:await shares()-before};
  };
  const traded=await trade(true);assert.equal(traded.panel,'treasury','2: a stock purchase keeps the page the player opened');assert.equal(traded.loans,true);assert.equal(traded.bought,1000,'2: the shares are bought');
  const tradedHere=await trade(false);assert.equal(tradedHere.panel,'stocks','4: without navigation the stock page is redrawn');assert.equal(tradedHere.bought,1000);
  assert.deepEqual(errors,[],'no page errors');results.push({engine:engine.name(),moved:moved.panel,stayed:stayed.panel,traded:traded.panel,tradedHere:tradedHere.panel,opened:opened.panel,openedHere:openedHere.panel});
 }finally{await browser.close();await env?.closeOrigin?.();}}
 console.log(JSON.stringify({suite:'build528-reopen-navigation-guard-browser',ok:true,results}));
})().catch(error=>{console.error(error);process.exit(1);});
