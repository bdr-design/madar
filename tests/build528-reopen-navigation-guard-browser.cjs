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
// The first version of check 5 read one line at a time and missed thirteen decisions whose page opens on another line
// or in their command's afterCommit; the macOS gate (run 64, tax-precision-and-routing-browser) then lost the global
// network page to "open all companies" redrawing the companies page. Check 5 now parses app.js and covers every page
// open after an await in its async function and in every afterCommit/afterPublish callback; case 6 is that gate's flow:
//  6. "open all companies" with a navigation while it is in flight keeps the page the player opened.
// GH_GUARD_ENGINE=chromium runs Chromium only (WebKit is not installed everywhere).
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{chromium,webkit}=require('playwright');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {bootRenderApp}=require('./helpers/render-app.cjs'),{installVault}=require('./helpers/differential-vault-fixture.cjs'),{prepare}=require('./helpers/request-decisions-fixture.cjs');
// 5. Source (parsed): a page opened after an await of its async function, or in an afterCommit/afterPublish callback,
// opens through reopenDrawer or behind the same revision check.
{
  const acorn=require('acorn'),src=fs.readFileSync(path.join(ROOT,'WebApp/app.js'),'utf8'),ast=acorn.parse(src,{ecmaVersion:'latest',locations:true}),direct=[];let reopened=0;
  const firstAwait=fn=>{let first=Infinity;(function visit(n){if(!n||typeof n!=='object')return;if(n!==fn&&/Function/.test(n.type)&&n.type!=='ArrowFunctionExpression'&&!n.async)return;if(n.type==='AwaitExpression'&&n.start<first)first=n.start;for(const v of Object.values(n)){if(Array.isArray(v))v.forEach(visit);else if(v&&typeof v==='object'&&v.type)visit(v);}})(fn.body);return first;};
  (function visit(n,ancestors){
    if(!n||typeof n!=='object')return;
    if(n.type==='CallExpression'&&n.callee.type==='Identifier'&&n.callee.name==='reopenDrawer'&&n.arguments[0]?.name==='navigationRevision')reopened++;
    if(n.type==='CallExpression'&&n.callee.type==='Identifier'&&n.callee.name==='openDrawer'){
      let late=false;
      for(let i=ancestors.length-1;i>=0;i--){const fn=ancestors[i];if(!/Function/.test(fn.type))continue;const parent=ancestors[i-1];
        if(parent?.type==='Property'&&['afterCommit','afterPublish'].includes(parent.key?.name)){late=true;break;}
        if(fn.async){late=firstAwait(fn)<n.start;break;}}
      const before=src.slice(Math.max(0,n.start-60),n.start);
      if(late&&!/(drawerNavigationRevision===navigationRevision\)|navigationRevision===drawerNavigationRevision\)&&)$/.test(before))direct.push({line:n.loc.start.line,text:src.slice(Math.max(0,n.start-50),n.end)});
    }
    const next=[...ancestors,n];for(const v of Object.values(n)){if(Array.isArray(v))v.forEach(c=>visit(c,next));else if(v&&typeof v==='object'&&v.type)visit(v,next);}
  })(ast,[]);
  assert.equal(direct.length,1,`5: one direct page open after a command (${JSON.stringify(direct)})`);assert.match(direct[0].text,/if\(activeDrawerPanel\)openDrawer\(activeDrawerPanel,activeDrawerArg\)/,'5: god mode redraws the page already shown');
  assert.ok(reopened>=45,`5: the decisions redraw through reopenDrawer (${reopened})`);
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
  // 6. The gate's flow: "open all companies" (after its confirmation) with a navigation while it is in flight.
  await page.evaluate(()=>__AUDIT__.openDrawer('companies','subs'));const openAll=page.locator('#drawerBody .open-all-companies').first();await openAll.waitFor();
  const all=await held(page,async()=>{await openAll.click();await page.locator('dialog.ui-confirm [data-confirm="accept"]').click();},{navigate:true});
  assert.equal(all.panel,'treasury','6: "open all companies" keeps the page the player opened');assert.equal(all.loans,true);
  assert.equal(await page.evaluate(()=>GH_COMPANY_PLATFORM.listInstances(__GH_STATE__,{includeGroup:false}).every(c=>c.operational)),true,'6: every company is opened');
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
  assert.deepEqual(errors,[],'no page errors');results.push({engine:engine.name(),openAll:all.panel,moved:moved.panel,stayed:stayed.panel,traded:traded.panel,tradedHere:tradedHere.panel,opened:opened.panel,openedHere:openedHere.panel});
 }finally{await browser.close();await env?.closeOrigin?.();}}
 console.log(JSON.stringify({suite:'build528-reopen-navigation-guard-browser',ok:true,results}));
})().catch(error=>{console.error(error);process.exit(1);});
