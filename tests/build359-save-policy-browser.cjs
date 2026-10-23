'use strict';
// Build 358 (save policy, GH_SAVE_POLICY): the game does not save on a timer while it runs. Player commands save
// themselves; between them the game saves when the app is hidden, and when the real-time cap (15 min by default, a Settings choice) has passed since the last save: at the first quiet
// moment (time stopped), or regardless of it once the 5-minute grace has also passed. Save Now saves at once.
// 1. The pure rules (cap, grace, retry spacing, the cap choices).
// 2. The real game (local DOM, an in-page native vault that records every commit):
//    - live play at the top speed with map mode and layer changes: no save at all;
//    - a calendar advance saves nothing (across April 1 too), even with the cap overdue while it runs;
//    - the cap: no save while time runs, one at the first stopped moment, one regardless after the grace, none when
//      the cap is "on exit only";
//    - Settings: the card, the cap choice (saved with the next save), Save Now;
//    - hiding the app saves.
const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require('playwright'),{bootAtOrigin}=require('./helpers/differential-vault-fixture.cjs');
const POLICY=require(path.join(process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..'),'WebApp/save-policy-core.js'));

// 1. Pure rules.
{
  const min=m=>m*60000,base={nowMs:min(1),lastSaveAtMs:0,capMinutes:15,quiet:true};
  assert.equal(POLICY.due(base),null,'nothing is due before the cap');
  assert.equal(POLICY.due({...base,nowMs:min(15),quiet:false}),null,'the cap waits for a quiet moment');
  assert.equal(POLICY.due({...base,nowMs:min(15)}),'cap-quiet');
  let reads=0;assert.equal(POLICY.due({...base,nowMs:min(14),quiet:()=>{reads++;return true;}}),null);assert.equal(reads,0,'quiet is read only once the cap has passed');
  assert.equal(POLICY.due({...base,nowMs:min(20)-1,quiet:false}),null);assert.equal(POLICY.due({...base,nowMs:min(20),quiet:false}),'cap-forced','the grace ends the wait');
  assert.equal(POLICY.due({...base,nowMs:min(600),capMinutes:0,quiet:false}),null,'"on exit only" never saves by time');
  assert.equal(POLICY.due({...base,nowMs:min(15),lastAttemptAtMs:min(15)-1000}),null,'a refused save is retried after 30 s');
  assert.equal(POLICY.due({...base,nowMs:min(15),lastAttemptAtMs:min(15)-30000}),'cap-quiet');
  assert.equal(POLICY.due({...base,nowMs:min(15),lastAttemptAtMs:null}),'cap-quiet','no attempt yet is not an attempt at time 0');
  assert.equal(POLICY.due({...base,nowMs:min(60),lastSaveAtMs:null}),null,'an unknown last save time does not trigger the cap');
  assert.equal('quarterOf' in POLICY,false,'there is no calendar save');
  assert.deepEqual([...POLICY.CAP_CHOICES],[0,5,10,15,30]);assert.equal(POLICY.capMinutes({}),15);assert.equal(POLICY.capMinutes({savePolicy:{capMinutes:7}}),15,'an unknown choice falls back to the default');assert.equal(POLICY.capMinutes({savePolicy:{capMinutes:0}}),0);
}

function installVault(){
  const vault=window.__VAULT__={commits:[]};
  const deliver=(name,detail)=>setTimeout(()=>window.dispatchEvent(new CustomEvent(name,{detail})),0);
  const bridge={postMessage(m){
    if(m.action==='storeSaveChunk')return deliver('gh-native-chunk-ack',{requestId:m.requestId,id:m.id,success:true});
    if(m.action==='commitSave'||m.action==='resetGameSave'){
      const parsed=JSON.parse(m.saveJSON);vault.commits.push({simSeconds:parsed.simSeconds,savePolicy:parsed.savePolicy||null,saveRevision:m.saveRevision,advancing:!!window.__AUDIT__?.simulationEngine?.snapshot?.().manualAdvance});
      deliver(m.action==='resetGameSave'?'gh-native-reset-ack':'gh-native-save-ack',{requestId:m.requestId,action:m.action,saveRevision:m.saveRevision,resetEpoch:m.resetEpoch,saveSchemaVersion:m.saveSchemaVersion,saveHash:m.saveHash,success:true,generation:vault.commits.length});
    }
  }};
  window.webkit={messageHandlers:{saveBridge:bridge,updateBridge:bridge}};window.GH_NATIVE_BUILD=358;
}

(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];let closeOrigin=null;
  try{
    const started=await bootAtOrigin({browser,errors});closeOrigin=started.closeOrigin;const {page}=started;page.setDefaultTimeout(200000);
    await page.evaluate(installVault);
    // The policy reads the last save's time from GH_PERSISTENCE.saveCadence: __AGE__(ms) makes the save that exists now
    // look that much older (a save made after it is reported as it is).
    await page.evaluate(()=>{const P=window.GH_PERSISTENCE;let aged=null;window.__AGE__=ms=>{aged=ms>0?{atMs:P.saveCadence().lastSaveAtMs,ms}:null;};
      const wrapped={...P,saveCadence(){const c=P.saveCadence();return aged&&c.lastSaveAtMs===aged.atMs?{...c,lastSaveAtMs:c.lastSaveAtMs-aged.ms}:c;}};window.GH_PERSISTENCE=wrapped;globalThis.GH_PERSISTENCE=wrapped;});
    const commits=()=>page.evaluate(()=>window.__VAULT__.commits.length);
    // Waits until the vault holds `count` commits (or `ms` pass), then 1.5 s more; returns how long the commit took.
    await page.evaluate(()=>{window.__SAVED__=async(count,ms)=>{const from=performance.now(),until=from+ms;while(window.__VAULT__.commits.length<count&&performance.now()<until)await new Promise(r=>setTimeout(r,50));const took=performance.now()-from;await new Promise(r=>setTimeout(r,1500));return took;};});
    const settle=()=>page.evaluate(async()=>{const a=__AUDIT__,s=__GH_STATE__;for(let i=0;i<400&&(a.simulationEngine.snapshot().manualAdvance||GH_TRANSACTION_CORE.isStaged(s)||GH_PERSISTENCE.isLocked());i++)await new Promise(r=>setTimeout(r,25));await GH_PERSISTENCE.drain();});
    // A first save establishes the cadence (as the founding command does in a real game). It is asked for once the game
    // is idle and counted once committed: on the macOS runner a save asked for at once was refused or deferred, and the
    // count read 0.
    await page.evaluate(()=>__AUDIT__.whenStateIdle());await page.evaluate(()=>__AUDIT__.save());
    await page.waitForFunction(()=>window.__VAULT__.commits.length>=1,null,{timeout:60000});await settle();
    const first=await commits();assert.equal(first,1,'one baseline save');

    // Live play at the top speed with map changes: no save. A live slice writes its time in its first stage and commits
    // in a later one; pausing cancels a slice still in flight and rolls its time back (the macOS gate once read 3,900 s
    // there and kept 3,600 s), so the crossing is read once committed.
    const live=await page.evaluate(async()=>{const a=__AUDIT__,before=__VAULT__.commits.length,from=__GH_STATE__.simSeconds;a.setSpeed(3);
      for(const mode of ['network','expansion','operations']){document.querySelector(`.map-modes [data-map-mode="${mode}"]`)?.click();await new Promise(r=>setTimeout(r,1200));}
      document.querySelector('#layerMenu button')?.click();const deadline=performance.now()+60000;while((__GH_STATE__.simSeconds<=from+3600||GH_TRANSACTION_CORE.isStaged(__GH_STATE__))&&performance.now()<deadline)await new Promise(r=>setTimeout(r,50));a.setSpeed(0);return {saves:__VAULT__.commits.length-before,sim:__GH_STATE__.simSeconds,advanced:__GH_STATE__.simSeconds-from};});
    await settle();
    assert.equal(live.saves,0,`live play with map changes does not save (${JSON.stringify(live)})`);assert.ok(live.advanced>3600,'time crosses an hour boundary at the supported maximum speed');

    // Calendar: an advance across April 1 saves nothing, during it or after it; nor does an overdue cap while it runs.
    const advance=days=>page.evaluate(async d=>{const a=__AUDIT__,s=__GH_STATE__,target=(Math.floor(s.simSeconds/86400)+d)*86400,before=__VAULT__.commits.length;
      for(let attempt=0;attempt<20&&s.simSeconds<target-1;attempt++){a.simulationEngine.advanceTo(target,{speed:300,batchSeconds:3600,reason:'qa-save-policy',maxSeconds:400*86400});
        while(a.simulationEngine.snapshot().manualAdvance||GH_TRANSACTION_CORE.isStaged(s))await new Promise(r=>setTimeout(r,25));}
      await new Promise(r=>setTimeout(r,2500));return {reached:s.simSeconds>=target-1,day:Math.floor(s.simSeconds/86400),saves:__VAULT__.commits.slice(before)};},days);
    const across=await advance(95-await page.evaluate(()=>Math.floor(__GH_STATE__.simSeconds/86400)));await settle();
    assert.equal(across.reached,true);assert.ok(across.day>=95,'past April 1');assert.deepEqual(across.saves,[],'an advance across April 1 saves nothing');
    await page.evaluate(()=>window.__AGE__(25*60000));const overdue=await advance(3);await page.evaluate(()=>window.__AGE__(0));await settle();
    assert.equal(overdue.reached,true);assert.deepEqual(overdue.saves.filter(row=>row.advancing),[],'an overdue cap does not save while the advance runs');

    // The cap: not while time runs; at the first stopped moment; regardless after the grace; never on "exit only".
    const capRun=await page.evaluate(async()=>{const a=__AUDIT__,before=__VAULT__.commits.length;window.__AGE__(16*60000);a.setSpeed(2);await new Promise(r=>setTimeout(r,3000));const running=__VAULT__.commits.length-before;
      // The policy is checked at most once a second, and its save waits for an idle moment (up to 1.5 s): each save is
      // waited for (up to 15 s), then the count is held 1.5 s more, so a second save would still be counted.
      // Each save must also come promptly: within 6 s (the check is once a second and the save waits up to 1.5 s for an
      // idle moment; a check every 10 s, or a save deferred several seconds, fails).
      a.setSpeed(0);const took=await window.__SAVED__(before+running+1,15000);const stopped=__VAULT__.commits.length-before-running;window.__AGE__(0);return {running,stopped,prompt:took<=6000};});
    await settle();assert.deepEqual(capRun,{running:0,stopped:1,prompt:true},'the cap waits for a stopped moment, then saves once, promptly');
    const forced=await page.evaluate(async()=>{const a=__AUDIT__,before=__VAULT__.commits.length;window.__AGE__(21*60000);a.setSpeed(2);const took=await window.__SAVED__(before+1,15000);const n=__VAULT__.commits.length-before;window.__AGE__(0);a.setSpeed(0);return {n,prompt:took<=6000};});
    await settle();assert.deepEqual(forced,{n:1,prompt:true},'after the grace the cap saves while time runs, promptly');
    await page.evaluate(async()=>{__AUDIT__.openDrawer('settings');await new Promise(r=>setTimeout(r,200));});
    const card=await page.evaluate(()=>{const c=document.querySelector('.save-policy-card');return c?{choices:[...c.querySelectorAll('[data-save-cap]')].map(b=>[b.dataset.saveCap,b.getAttribute('aria-pressed')]),saveNow:!!c.querySelector('.save-now-btn'),text:c.textContent}:null;});
    assert.ok(card,'the Settings card is shown');assert.deepEqual(card.choices,[['0','false'],['5','false'],['10','false'],['15','true'],['30','false']]);assert.equal(card.saveNow,true);assert.match(card.text,/مدة الأمان/);assert.doesNotMatch(card.text,/ربع/);
    await page.click('.save-policy-card [data-save-cap="0"]');
    const off=await page.evaluate(async()=>{const a=__AUDIT__,before=__VAULT__.commits.length;window.__AGE__(120*60000);await new Promise(r=>setTimeout(r,2500));const n=__VAULT__.commits.length-before;window.__AGE__(0);return {n,cap:__GH_STATE__.savePolicy?.capMinutes,pressed:document.querySelector('.save-policy-card [data-save-cap="0"]')?.getAttribute('aria-pressed')};});
    assert.deepEqual(off,{n:0,cap:0,pressed:'true'},'"on exit only" never saves by time, and the choice is shown');
    await page.click('.save-policy-card [data-save-cap="30"]');
    const saveNowBefore=await commits();await page.click('.save-policy-card .save-now-btn');await settle();
    const savedNow=await page.evaluate(()=>__VAULT__.commits.at(-1));assert.equal(await commits(),saveNowBefore+1,'Save Now saves once');
    assert.deepEqual(savedNow.savePolicy,{capMinutes:30},'the cap choice is saved with the next save');

    // Hiding the app saves.
    const hidden=await page.evaluate(async()=>{const before=__VAULT__.commits.length;Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));
      const took=await window.__SAVED__(before+1,10000);const n=__VAULT__.commits.length-before;Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'));return {n,prompt:took<=4000};});
    assert.deepEqual(hidden,{n:1,prompt:true},'hiding the app saves, within 4 s');
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({suite:'build359-save-policy-browser',live,across:{day:across.day,saves:across.saves.length},overdue:overdue.saves.length,capRun,forced,off,hidden},null,1));
    console.log('BUILD359_SAVE_POLICY_PASS');
  }finally{await browser.close();await closeOrigin?.();}
})().catch(error=>{console.error(error);process.exitCode=1;});
