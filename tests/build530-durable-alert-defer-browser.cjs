'use strict';
// The macOS gate (run 62, build371-calendar-cancel-maintenance-browser) failed with the page error "Durable state command
// is in progress": it pressed "+ day" as soon as the founding command had published its state, while that command still
// held the live state (a frame and its refresh after publication). The calendar request was accepted, then its alert
// (pushAlert, a write on the live state) threw, so the day control and the calendar were not refreshed. The same
// happens to a player who presses "+ day" while a decision is being committed. An alert raised while a durable command
// holds the live state is now written, as raised, once that command has settled. Proven with the real app:
//  1. "+ day" pressed the moment the founding command publishes (the gate's case): no page error, the advance runs and
//     its alert is written once, after the command;
//  2. "+ day" pressed while a decision is in flight: no page error, the decision commits, the alert is written once;
//  3. with no durable command, the alert is written at once, as before.
const assert=require('node:assert/strict'),path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app'),{drawFounderSignature}=require('./helpers/signature-input');
const CALENDAR='بدأ تقديم التقويم';
const alerts=page=>page.evaluate(text=>(__GH_STATE__.alerts||[]).filter(row=>String(row).includes(text)).length,CALENDAR);
const idle=page=>page.waitForFunction(()=>!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_SIM_KERNEL.snapshot().manualAdvance&&!GH_TRANSACTION_CORE.isStaged(__GH_STATE__)&&!GH_PERSISTENCE.isLocked(),null,{timeout:120000});
(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    const {page}=await boot({browser,errors,root:ROOT,found:false});page.setDefaultTimeout(120000);
    // 1. The gate's case: "+ day" in the task after the founding command publishes, before it settles.
    await page.selectOption('#founderMode','sandbox');await page.click('#founderReview');await drawFounderSignature(page);
    // The first animation frame asked for once the state shows the group founded is the command's wait for a painted
    // frame after it publishes; the press follows in a microtask, while the command holds the state. (A timer turn polled
    // for the published state, and on a busy runner its next turn could come after that frame.)
    await page.evaluate(()=>{window.__RACE__=null;const raf=window.requestAnimationFrame;window.requestAnimationFrame=function(cb){if(window.__GH_STATE__?.onboardingComplete){window.requestAnimationFrame=raf;queueMicrotask(()=>{window.__RACE__={held:!!window.__GH_DURABLE_COMMAND_CONTEXT__,day:Math.floor(__GH_STATE__.simSeconds/86400)};document.querySelector('#simNextDay').click();});}return raf.call(window,cb);};});
    await page.locator('#founderForm button[type=submit]').click();
    await page.waitForFunction(()=>!!window.__RACE__);const race=await page.evaluate(()=>window.__RACE__);
    assert.equal(race.held,true,'1: the press lands while the founding command still holds the state');
    await idle(page);
    assert.deepEqual(errors,[],'1: no page error');
    assert.equal(await alerts(page),1,'1: the calendar alert is written once, after the command');
    assert.ok(await page.evaluate(day=>Math.floor(__GH_STATE__.simSeconds/86400)>day,race.day),'1: the day advanced');
    // 2. "+ day" while a decision is in flight.
    const before=await alerts(page);
    const decided=await page.evaluate(async()=>{
      const run=__AUDIT__.runAuthorizedDomainCommand('corporate','rename-company',{type:'group',legalName:'QA Alert Group'},{silent:true});
      let held=false;for(let i=0;i<2000&&!held;i++){if(window.__GH_DURABLE_COMMAND_CONTEXT__){held=true;document.querySelector('#simNextDay').click();break;}await new Promise(r=>setTimeout(r,0));}
      const out=await run;return {held,committed:!!out};
    });
    assert.equal(decided.held,true,'2: the press lands while the decision holds the state');assert.equal(decided.committed,true,'2: the decision commits');
    await idle(page);
    assert.deepEqual(errors,[],'2: no page error');
    assert.equal(await alerts(page),before+1,'2: the calendar alert is written once, after the decision');
    assert.equal(await page.evaluate(()=>__GH_STATE__.companyRegistry?.group?.legalName),'QA Alert Group','2: the decision is saved');
    // 3. No durable command: written at once.
    const now=await alerts(page);
    const immediate=await page.evaluate(text=>{document.querySelector('#simNextDay').click();return (__GH_STATE__.alerts||[]).filter(row=>String(row).includes(text)).length;},CALENDAR);
    assert.equal(immediate,now+1,'3: with no durable command the alert is written in the same task');
    await idle(page);assert.deepEqual(errors,[],'3: no page error');
    console.log(JSON.stringify({suite:'build530-durable-alert-defer-browser',ok:true,race}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
