'use strict';
// The macOS gate (run 65, build334-r4-recovery-browser) failed with "locked runtime must not mutate during recovery
// UI": it locked the runtime for recovery as soon as the founding command had published its state, and the command
// then recorded its DURABLE_COMMAND_COMMITTED diagnostic in the live state, a frame after publication. That event, the
// one write after a publication, is now left out while a recovery lock owns the runtime. Proven with the real app:
//  1. locking in the first task that sees the founding published (the command still holds the state): nothing in the
//     state changes in the 900 ms after the lock, and no committed event is written while it is locked;
//  2. without a lock the committed event is recorded once, with the command's name and revision, as before.
const assert=require('node:assert/strict'),path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {chromium}=require('playwright'),{serve}=require('./helpers/web-server'),{drawFounderSignature}=require('./helpers/signature-input');
(async()=>{
  const server=await serve(path.join(ROOT,'WebApp')),browser=await chromium.launch({headless:true}),runs=[];
  try{for(const lock of [true,false]){const run=lock?'locked':'unlocked';
    const context=await browser.newContext({viewport:{width:844,height:390},locale:'ar-SA'}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
    await page.route(/https:\/\/(tile\.openstreetmap\.org|server\.arcgisonline\.com)\//,r=>r.abort());
    await page.goto(server.baseURL);await page.selectOption('#founderMode','sandbox');await page.click('#founderReview');await drawFounderSignature(page);
    // Locked in the founding command's publication: the first animation frame asked for once the state shows the group
    // founded is the command's wait for a painted frame after it publishes, and the lock follows in a microtask, while
    // the command holds the state (a timer turn polled for it, and could come after that frame on a busy runner).
    await page.evaluate(lock=>{window.__LOCK__=null;const raf=window.requestAnimationFrame;window.requestAnimationFrame=function(cb){if(window.__GH_STATE__?.onboardingComplete){window.requestAnimationFrame=raf;queueMicrotask(()=>{__GH_STATE__.speed=0;window.webkit={messageHandlers:{saveBridge:{postMessage(){}},diagnosticBridge:{postMessage(){}}}};const held=!!window.__GH_DURABLE_COMMAND_CONTEXT__;if(lock)GH_PERSISTENCE.markRecoveryRequired('build531 lock after publication');window.__LOCK__={held,before:JSON.stringify(__GH_STATE__)};});}return raf.call(window,cb);};},lock);
    await page.locator('#founderForm button[type=submit]').click();await page.waitForFunction(()=>!!window.__LOCK__,null,{timeout:60000});await page.waitForTimeout(900);
    const out=await page.evaluate(()=>{const before=JSON.parse(window.__LOCK__.before),after=JSON.parse(JSON.stringify(__GH_STATE__)),changed=Object.keys({...before,...after}).filter(k=>JSON.stringify(before[k])!==JSON.stringify(after[k]));
      const events=(after.diagnostics?.events||[]).filter(e=>e.type==='DURABLE_COMMAND_COMMITTED');return {held:window.__LOCK__.held,locked:GH_PERSISTENCE.isLocked(),changed,events:events.map(e=>({name:e.detail?.name,saveRevision:e.detail?.saveRevision})),revision:after.saveRevision};});
    assert.equal(out.held,true,`${run}: the press lands while the founding command still holds the state`);assert.equal(out.locked,lock);
    if(lock){assert.deepEqual(out.changed,[],`${run}: nothing in the state changes after the lock`);assert.deepEqual(out.events,[],`${run}: no committed event is written while locked`);}
    else assert.deepEqual(out.events,[{name:'found-group',saveRevision:out.revision}],`${run}: without a lock the committed event is recorded once`);
    assert.deepEqual(errors,[],`${run}: no page error`);runs.push(out);await context.close();
  }}finally{await browser.close();await server.close?.();}
  console.log(JSON.stringify({suite:'build531-durable-publish-no-late-write-browser',ok:true,runs:runs.map(r=>({held:r.held,locked:r.locked,changed:r.changed.length,events:r.events.length}))}));
})().catch(error=>{console.error(error);process.exit(1);});
