'use strict';
// The full gate (build358-budgets-browser on the macOS runner) found a player taken back to a decision's page: the
// budget save, like the company decision buttons, redrew its page after its command committed, several frames after the
// press, and a player who had opened another page meanwhile lost it (the treasury loans tab became the budgets page).
// A decision now redraws its page only if no other navigation happened since the press. Proven with the real app and
// the vault holding the commit's acknowledgement, so the navigation always lands while the command is in flight:
//  1. the budget save: navigating to the treasury loans tab during the command keeps the loans tab; the budget is saved;
//  2. a company decision (bank branch campaign): the same, the campaign is committed;
//  3. without navigation both still redraw their own page as before.
// GH_GUARD_ENGINE=chromium runs Chromium only (WebKit is not installed everywhere).
const assert=require('node:assert/strict'),path=require('node:path'),{chromium,webkit}=require('playwright');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {bootRenderApp}=require('./helpers/render-app.cjs'),{installVault}=require('./helpers/differential-vault-fixture.cjs'),{prepare}=require('./helpers/request-decisions-fixture.cjs');
const panel=page=>page.evaluate(()=>({panel:document.querySelector('#drawer')?.dataset.panel||'',loans:!!document.querySelector('#drawerBody #icLoanLender'),budget:!!document.querySelector('#drawerBody .budget-save')}));
async function held(page,press,{navigate}){
  await page.evaluate(()=>{__DIFF_VAULT__.hold=true;__DIFF_VAULT__.pending=[];});
  await press();
  await page.waitForFunction(()=>__DIFF_VAULT__.pending.length>0,null,{timeout:60000});
  if(navigate)await page.evaluate(()=>__AUDIT__.openDrawer('treasury','loans'));
  await page.evaluate(()=>{__DIFF_VAULT__.hold=false;for(const ack of __DIFF_VAULT__.pending.splice(0))ack();});
  await page.waitForFunction(()=>!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked(),null,{timeout:60000});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(resolve,300)))));
  return panel(page);
}
(async()=>{const results=[];for(const engine of process.env.GH_GUARD_ENGINE==='chromium'?[chromium]:[chromium,webkit]){const browser=await engine.launch({headless:true}),errors=[];let env;try{
  env=await bootRenderApp({browser,root:ROOT,errors,viewport:{width:844,height:390},beforeScripts:{fn:installVault}});const page=env.page;page.setDefaultTimeout(120000);
  await prepare(page,{rows:200});
  // The ceilings offered depend on the company's size: the test takes two of the offered non-zero values.
  const card=()=>page.locator('#drawerBody .budget-card').filter({has:page.locator('.budget-save[data-company="air"]')});
  await page.evaluate(()=>__AUDIT__.openDrawer('budgets',{company:'air'}));
  const limits=(await card().locator('[data-budget-limit] option').evaluateAll(options=>options.map(o=>Number(o.value)).filter(v=>v>0))).slice(-2);
  assert.equal(limits.length,2,'two ceilings are offered');
  const budget=async(limit,navigate)=>{
    await page.evaluate(()=>__AUDIT__.openDrawer('budgets',{company:'air'}));
    await card().locator('[data-budget-limit]').selectOption(String(limit));
    return held(page,()=>card().locator('.budget-save').click(),{navigate});
  };
  // 1. Budget save with navigation during the command.
  const moved=await budget(limits[0],true);
  assert.equal(moved.panel,'treasury','1: the player stays on the page they opened');assert.equal(moved.loans,true,'1: the loans tab is shown');
  assert.equal(await page.evaluate(()=>__GH_STATE__.companyBudgets?.air?.limit),limits[0],'1: the budget is saved');
  // 3a. Without navigation the budgets page is redrawn.
  const stayed=await budget(limits[1],false);assert.equal(stayed.panel,'budgets');assert.equal(stayed.budget,true,'3: the budgets page is redrawn');
  assert.equal(await page.evaluate(()=>__GH_STATE__.companyBudgets?.air?.limit),limits[1]);
  // 2. A company decision: bank branch campaign from the branch desk, navigation during the command.
  const campaign=async(navigate,facility)=>{
    await page.evaluate(id=>__AUDIT__.openDrawer('facilityManage',{id,tab:'command'}),facility);
    const button=page.locator('#drawerBody [data-gh-action="bank-branch-campaign"]').first();await button.waitFor();
    return held(page,()=>button.click(),{navigate});
  };
  const before=await page.evaluate(()=>(__GH_STATE__.bank.branchNetwork||[]).filter(b=>Number(b.campaignUntil)>0).length);
  const decided=await campaign(true,'QA-DEC-bank');
  assert.equal(decided.panel,'treasury','2: a company decision keeps the page the player opened');assert.equal(decided.loans,true);
  assert.equal(await page.evaluate(()=>(__GH_STATE__.bank.branchNetwork||[]).filter(b=>Number(b.campaignUntil)>0).length),before+1,'2: the campaign is committed');
  // 3b. A company decision without navigation still redraws its page (the bank branches).
  await page.evaluate(async()=>{const s=__GH_STATE__,M=GH_MOBILITY_CORE,capitalId=Object.keys(M.CAPITALS||{}).concat((Array.isArray(M.CAPITALS)?M.CAPITALS.map(c=>c.id):[])).find(id=>id&&id!=='RUH'&&M.capitalMeta(id)),cap=M.capitalMeta(capitalId),facility={...s.customHubs.find(f=>f.id==='QA-DEC-bank'),id:'QA-DEC-bank-2',sourceKey:`site:bank:${capitalId}`,capitalId,city:cap.city,country:cap.country,coords:cap.coords};await __AUDIT__.runAuthorizedDomainCommand('facilities','create',{facility,bucket:'customHubs'},{silent:true});await __AUDIT__.runAuthorizedDomainCommand('banking','open-branch',{facilityId:facility.id,branchId:'QA-DEC-BR-2',site:facility},{silent:true});});
  const redrawn=await campaign(false,'QA-DEC-bank-2');assert.notEqual(redrawn.panel,'treasury');assert.ok(['bank','facilityManage'].includes(redrawn.panel),`3: the decision's page is redrawn (${redrawn.panel})`);
  assert.deepEqual(errors,[],'no page errors');results.push({engine:engine.name(),moved,stayed,decided,redrawn:redrawn.panel});
 }finally{await browser.close();await env?.closeOrigin?.();}}
 console.log(JSON.stringify({suite:'build527-decision-navigation-guard-browser',ok:true,results}));
})().catch(error=>{console.error(error);process.exit(1);});
