'use strict';
// Emulated phone session for comparing two sources (a tool, not an acceptance gate, and not an iPhone measurement).
// Chromium with an iPhone landscape page (844x390, 3x, touch, mobile), the CPU throttled 4x, the real app with the real
// fleet worker and a moving air fleet. The same scripted session runs on each source and every animation-frame interval
// is recorded by phase: map play, page opens, bank/telecom decision buttons (to ACK and UI end), and one day close.
//   node tools/measure_mobile_session.cjs <sourceRoot> <label> [rows=20000] [out.json]
const path=require('path'),fs=require('fs'),assert=require('assert/strict');
const ROOT=path.resolve(process.argv[2]||path.join(__dirname,'..')),LABEL=process.argv[3]||'run',ROWS=Number(process.argv[4]||20000),OUT=process.argv[5]||null;
const HERE=path.resolve(__dirname,'..'),{chromium}=require(path.join(HERE,'node_modules/playwright'));
const {bootRenderApp}=require(path.join(HERE,'tests/helpers/render-app.cjs')),{installVault}=require(path.join(HERE,'tests/helpers/differential-vault-fixture.cjs')),fixture=require(path.join(HERE,'tests/helpers/request-decisions-fixture.cjs'));
const PHONE={deviceScaleFactor:3,isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'};
const stats=rows=>{const xs=rows.slice().sort((a,b)=>a-b),q=p=>xs.length?+xs[Math.min(xs.length-1,Math.floor(xs.length*p))].toFixed(1):0;return {frames:xs.length,p50:q(.5),p95:q(.95),max:xs.length?+xs[xs.length-1].toFixed(1):0,over20:xs.filter(x=>x>20).length,over33:xs.filter(x=>x>33.4).length,missed:Math.round(xs.reduce((n,x)=>n+Math.max(0,Math.round(x/16.67)-1),0))};};
(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[],wrapped={newPage:config=>browser.newPage({...config,...PHONE})};let env;const out={label:LABEL,source:ROOT,rows:ROWS,phone:{viewport:'844x390',...PHONE,cpuThrottle:4},phases:{},commands:[]};
  try{
    env=await bootRenderApp({browser:wrapped,root:ROOT,errors,measureSyncWork:true,viewport:{width:844,height:390},beforeScripts:{fn:installVault}});const page=env.page;page.setDefaultTimeout(300000);
    const world=await fixture.prepare(page,{rows:ROWS});out.world=world;
    const dispatch=await page.evaluate(()=>__AUDIT__.dispatchSharedInternationalNetwork('air'));out.dispatch={departed:dispatch?.departed||0};
    await page.evaluate(()=>{window.__FRAMES__={phase:'setup',rows:[]};let last=null;const loop=t=>{if(last!==null)window.__FRAMES__.rows.push([window.__FRAMES__.phase,t-last]);last=t;requestAnimationFrame(loop);};requestAnimationFrame(loop);});
    const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
    const phase=name=>page.evaluate(n=>{window.__FRAMES__.phase=n;},name);
    // 1. Map play at speed 3 for 8 s.
    await phase('play');await page.evaluate(()=>__AUDIT__.setSpeed(3));await page.waitForTimeout(8000);await page.evaluate(()=>__AUDIT__.setSpeed(0));await page.evaluate(()=>__AUDIT__.whenStateIdle());
    // 2. Page opens, each followed by 700 ms.
    await phase('pages');for(const [p,a] of [['finance'],['company','bank'],['compliance'],['invoices',{company:'all',tab:'overview'}],['leadershipHub'],['company','air'],['market']]){await page.evaluate(([p,a])=>__AUDIT__.openDrawer(p,a),[p,a]);await page.waitForTimeout(700);}
    // 3. Decision buttons (real buttons, real owners, ACK from the test vault).
    await fixture.installTrace(page);await phase('decisions');let seq=0;
    for(const [kind,decision] of [['bank','accept'],['bank','reject'],['telecom','accept'],['insurance','reject']]){
      // Seeding requests is test setup, not a player action: its frames are kept out of the decision phase.
      await phase('setup');await page.evaluate(()=>__AUDIT__.whenStateIdle());await fixture.seed(page,{kind,decision,count:5,seq:seq++});
      if(kind==='bank')await page.evaluate(()=>{const b=__GH_STATE__.bank.branchNetwork?.[0];if(b)for(const r of __GH_STATE__.bank.loanRequests)r.branchId=b.id;});
      await phase('decisions');const started=Date.now(),button=await fixture.open(page,{kind,decision});await fixture.press(page,button);await fixture.waitFinished(page);out.commands.push({kind,decision,wallMs:Date.now()-started,durable:await page.evaluate(()=>{const t=GH_TRANSACTION_CORE.telemetry().lastDurable||{};return {cloneMs:t.cloneMs,cloneBusyMs:t.cloneBusyMs,cloneYields:t.cloneYields,validateMs:t.validateMs,validateMaxSliceMs:t.validateMaxSliceMs,persistMs:t.persistMs,publishMs:t.publishMs,totalMs:t.totalMs};})});await page.waitForTimeout(500);
    }
    // 4. One day close (manual advance to the next midnight at 300x).
    await phase('day-close');await page.evaluate(()=>__AUDIT__.closeDrawer?.());const target=await page.evaluate(()=>{const t=(Math.floor(__GH_STATE__.simSeconds/86400)+1)*86400;const r=__AUDIT__.simulationEngine.advanceTo(t,{reason:'qa-mobile-day-close',speed:300});if(!r.accepted)throw Error('advance-refused');return t;});
    await page.waitForFunction(t=>__GH_STATE__.simSeconds>=t&&!__AUDIT__.simulationEngine.snapshot().manualAdvance,target,{timeout:600000,polling:250});await page.evaluate(()=>__AUDIT__.whenStateIdle());await page.waitForTimeout(500);
    await phase('done');
    const rows=await page.evaluate(()=>window.__FRAMES__.rows);for(const name of ['play','pages','decisions','day-close'])out.phases[name]=stats(rows.filter(r=>r[0]===name).map(r=>r[1]));
    out.dayClose=await page.evaluate(()=>{const s=GH_TRANSACTION_CORE.telemetry().lastSimulation||{};return {label:s.label,totalMs:s.totalMs,stagedSteps:s.stagedSteps};});
    out.errors=errors.slice(0,5);assert.deepEqual(errors,[],'no page errors');
  }finally{await Promise.race([browser.close(),new Promise(r=>setTimeout(r,15000))]);await env?.closeOrigin?.();}
  const text=JSON.stringify(out,null,1);if(OUT)fs.writeFileSync(OUT,text);console.log(text);
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>process.exit(process.exitCode||0));
