'use strict';
// Release review (owner: «راجع الاقسام اللي المفترض تخفى عن اللاعب»): the release edition (GH_EDITION='release', set by the
// iPhone and Android apps) hid the developer pages, but two of their parts still reached the player: the Action Centre's
// «فحص صحة النظام» (system health check) button, which ran the full developer check and opened the settings, and the
// game's internal health issues and control-plane incidents, which were listed as the player's critical tasks (their
// pages are developer tools). Proven in the real app (Chromium):
//  1. the development edition keeps both: the check button, and an internal issue and an open incident as tasks;
//  2. the release edition shows neither (no check button, no internal task), while the player's own tasks stay;
//  3. the check action is ignored in the release edition, and the save messages carry no developer terms.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    const {page}=await boot({browser,errors});page.setDefaultTimeout(60000);
    const open=(panel,arg)=>page.evaluate(([p,a])=>__AUDIT__.openDrawer(p,a),[panel,arg]);
    const view=async()=>({check:await page.locator('#drawerBody [data-gh-action="diagnostics-run"]').count(),text:await page.locator('#drawerBody').textContent()});
    // An internal health issue, an open control-plane incident, and a late delivery (a player's own task).
    await page.evaluate(()=>{const s=__GH_STATE__;s.diagnostics=s.diagnostics||{};s.diagnostics.activeIssues={QA_DIAG:{id:'QA_DIAG',message:'QA-INTERNAL-ISSUE',severity:'critical'}};
      s.controlPlane=s.controlPlane||{};s.controlPlane.incidents=[...(s.controlPlane.incidents||[]),{id:'INC-QA',status:'open',title:'QA-OPEN-INCIDENT',severity:'high'}];
      s.realism.procurement.deliveries=[...(s.realism.procurement.deliveries||[]),{id:'DEL-QA-LATE',status:'pending',catalogId:'QA-LATE-DELIVERY',dueSimSeconds:-1,destination:'QA'}];});
    // 1.
    await open('actionCenter');let v=await view();
    assert.equal(v.check,1,'1: development: the system check button');
    assert.match(v.text,/QA-INTERNAL-ISSUE/,'1: development: an internal issue is a task');assert.match(v.text,/QA-OPEN-INCIDENT/,'1: development: an open incident is a task');
    assert.match(v.text,/QA-LATE-DELIVERY/,'1: development: the late delivery is a task');
    // 2.
    await page.evaluate(()=>{window.GH_EDITION='release';});
    await open('actionCenter');v=await view();
    assert.equal(v.check,0,'2: release: no system check button');
    assert.doesNotMatch(v.text,/QA-INTERNAL-ISSUE|QA-OPEN-INCIDENT/,'2: release: no internal issue or incident among the tasks');
    assert.match(v.text,/QA-LATE-DELIVERY/,'2: release: the player\'s own task stays');
    // 3.
    const advanced=fs.readFileSync(path.join(ROOT,'WebApp/advanced-core.js'),'utf8');
    assert.match(advanced,/if\(id==='diagnostics-run'\)\{if\(release\(\)\)return;/,'3: the check action is ignored in release');
    assert.doesNotMatch(advanced,/Persistence Core unavailable|Save Schema ومزامنة Native Save Vault/,'3: no developer terms in the save messages');
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({suite:'build641-release-player-tasks-browser',ok:true}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
