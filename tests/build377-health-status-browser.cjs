'use strict';
// Exercise the actual health refresh and bound drawer controls. A closed page must stay closed, and a visible
// periodic refresh must display its one fresh integrity result without retaining it for a later state change.
const assert=require('node:assert/strict'),{chromium,webkit}=require('playwright'),{boot}=require('./helpers/local-dom-app');
(async()=>{
 for(const engine of [chromium,webkit]){
  const browser=await engine.launch({headless:true}),errors=[];
  try{
   const {page}=await boot({browser,errors});page.setDefaultTimeout(30000);
   await page.evaluate(()=>{
    const q=window.__HEALTH_QA__={checks:0,health:0,renders:0,saves:0,shown:[],passed:null};
    const integrity=GH_INTEGRITY_CORE,diagnostics=GH_DIAGNOSTICS,advanced=GH_ADVANCED,persistence=GH_PERSISTENCE;
    window.GH_INTEGRITY_CORE={...integrity,check(...args){q.checks++;return integrity.check(...args);}};
    window.GH_DIAGNOSTICS={...diagnostics,runHealthCheck(...args){q.health++;q.passed=args[1]?.integrity;return diagnostics.runHealthCheck(...args);}};
    window.GH_ADVANCED={...advanced,render(panel,arg,ctx){if(panel==='diagnostics'){q.renders++;const original=ctx.businessIntegrity;ctx.businessIntegrity=()=>{const result=original();q.shown.push(result);return result;};}return advanced.render(panel,arg,ctx);}};
    window.GH_PERSISTENCE={...persistence,commitState(...args){q.saves++;return persistence.commitState(...args);}};
    q.reset=()=>{q.checks=q.health=q.renders=q.saves=0;q.shown=[];q.passed=null;};
    __AUDIT__.openDrawer('diagnostics');
   });
   // Closing by the real button, rather than only invoking its implementation, also verifies its binding.
   await page.locator('#drawerClose').click();
   const closed=await page.evaluate(()=>{
    const q=__HEALTH_QA__,s=__GH_STATE__,before={speed:s.speed,cash:s.cash,revision:s.saveRevision,fleet:s.fleet,body:document.querySelector('#drawerBody').innerHTML};q.reset();
    const ran=__AUDIT__.runRealtimeHealth([]);
    return {ran,open:document.querySelector('#drawer').classList.contains('open'),checks:q.checks,health:q.health,renders:q.renders,saves:q.saves,sameBody:before.body===document.querySelector('#drawerBody').innerHTML,sameEconomy:before.speed===s.speed&&before.cash===s.cash&&before.revision===s.saveRevision&&before.fleet===s.fleet};
   });
   assert.deepEqual(closed,{ran:true,open:false,checks:1,health:1,renders:0,saves:0,sameBody:true,sameEconomy:true});
   const visible=await page.evaluate(()=>{
    const a=__AUDIT__,q=__HEALTH_QA__;a.openDrawer('diagnostics');const buttons=[...document.querySelectorAll('#drawerBody button')].map(b=>[b.textContent,b.dataset.ghAction,b.disabled]);q.reset();
    const ran=a.runRealtimeHealth([]),shown=q.shown[0];
    return {ran,open:document.querySelector('#drawer').classList.contains('open'),checks:q.checks,health:q.health,renders:q.renders,saves:q.saves,oneSameResult:q.shown.length===1&&shown===q.passed,buttonsUnchanged:JSON.stringify(buttons)===JSON.stringify([...document.querySelectorAll('#drawerBody button')].map(b=>[b.textContent,b.dataset.ghAction,b.disabled]))};
   });
   assert.deepEqual(visible,{ran:true,open:true,checks:1,health:1,renders:1,saves:0,oneSameResult:true,buttonsUnchanged:true});
   const changed=await page.evaluate(()=>{
    const s=__GH_STATE__,a=__AUDIT__,q=__HEALTH_QA__,account=s.companyFinance.group.accounts[0],balance=account.balance;
    let fault,repaired,reopened;
    try{
     account.balance=NaN;q.reset();a.runRealtimeHealth([]);fault={checks:q.checks,critical:q.shown[0]?.counts?.critical||0,same:q.shown[0]===q.passed,report:s.diagnostics.lastHealth.counts.critical};
     account.balance=balance;q.reset();a.runRealtimeHealth([]);repaired={checks:q.checks,critical:q.shown[0]?.counts?.critical||0,same:q.shown[0]===q.passed,report:s.diagnostics.lastHealth.counts.critical};
     // An ordinary subsequent open has no carried evidence and must obtain current integrity again.
     account.balance=NaN;q.reset();a.openDrawer('diagnostics');reopened={checks:q.checks,critical:q.shown[0]?.counts?.critical||0};
    }finally{account.balance=balance;a.runRealtimeHealth([]);}
    a.openDrawer('settings');const body=document.querySelector('#drawerBody').innerHTML;q.reset();a.runRealtimeHealth([]);
    const other={checks:q.checks,renders:q.renders,sameBody:body===document.querySelector('#drawerBody').innerHTML,panel:a.currentPanel()};
    a.openDrawer('diagnostics');return {fault,repaired,reopened,other};
   });
   assert.equal(changed.fault.checks,1);assert.ok(changed.fault.critical>0&&changed.fault.report>0);assert.equal(changed.fault.same,true);
   assert.equal(changed.repaired.checks,1);assert.equal(changed.repaired.critical,0);assert.equal(changed.repaired.report,0);assert.equal(changed.repaired.same,true);
   assert.equal(changed.reopened.checks,1);assert.ok(changed.reopened.critical>0,'no integrity snapshot survives a later page open');
   assert.deepEqual(changed.other,{checks:1,renders:0,sameBody:true,panel:'settings'});
   // The real manual check and recorder controls remain bound and usable after periodic rendering.
   await page.locator('[data-gh-action="diagnostics-run"]').click();
   assert.equal(await page.evaluate(()=>__GH_STATE__.diagnostics.lastHealth.counts.critical),0);
   await page.locator('[data-gh-action="diagnostics-recorder-start"]').click();
   assert.equal(await page.evaluate(()=>GH_DIAGNOSTICS.recorderIsActive(__GH_STATE__)),true);
   await page.locator('[data-gh-action="diagnostics-recorder-stop"]').click();
   assert.equal(await page.evaluate(()=>GH_DIAGNOSTICS.recorderIsActive(__GH_STATE__)),false);
   await page.locator('#drawerClose').click();
   const at=await page.evaluate(()=>__GH_STATE__.diagnostics.lastHealth.checkedAtMs);
   await page.waitForFunction(previous=>__GH_STATE__.diagnostics.lastHealth.checkedAtMs>previous,at,{timeout:25000});
   assert.equal(await page.evaluate(()=>document.querySelector('#drawer').classList.contains('open')),false,'normal automatic cadence must not reopen the closed page');
   assert.deepEqual(errors,[]);
   console.log(JSON.stringify({suite:'build377-health-status-browser',engine:engine.name(),ok:true,closed,visible,changed,automaticClosed:true,controls:true}));
  }finally{await browser.close();}
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
