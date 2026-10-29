'use strict';
// Owner («نفذ»; a pause pressed during a live day close rolled the close back in one task, 17-25 ms at 2x CPU throttle
// in a 300k-asset world, and the close began again on resume): the player's pause lets the close finish in its slices,
// then pauses. Against the source before (4daed4f, from its own tree):
//  Engine (GH_SIMULATION_CORE, injected clock):
//  1. pauseAfterDayClose during a live day-boundary job: the job is not cancelled, it commits through midnight, no slice
//     starts after it, and the host is handed the pause once; the source before had no such call;
//  2. it is refused (and the job runs as before) for a slice that ends on no day boundary and for a calendar advance;
//  3. cancelPauseAfterDayClose leaves play going; a close cancelled meanwhile (reset) still hands the pause over; a
//     calendar advance asked while the pause waits is refused (the pause would end it).
//  In the real app (40 aircraft on routes, paused one game second before midnight, then played):
//  4. the speed button pressed while the close is staged shows the pause at once, rolls nothing back, and the game
//     pauses at midnight with the day closed; the source before rolled the close back;
//  5. the day closed this way leaves the same finance and document proofs as a day the pause did not touch;
//  6. pressing play while the pause waits keeps the speed and the game goes on past midnight.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm'),{execFileSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'),SOURCE=process.env.GH_TEST_SOURCE_DIR||ROOT,PREVIOUS='4daed4f';
const read={now:file=>fs.readFileSync(path.join(SOURCE,'WebApp',file),'utf8'),before:file=>execFileSync('git',['-C',ROOT,'show',`${PREVIOUS}:WebApp/${file}`]).toString()};
const engineOf=source=>{const context={console};context.globalThis=context;context.window=context;for(const file of ['simulation-time-core.js','simulation-pacing-core.js','simulation-core.js'])vm.runInNewContext(source(file),context);return context.GH_SIMULATION_CORE;};
const core={now:engineOf(read.now),before:engineOf(read.before)};
// A live game whose slices take several chunks; start is the game time it begins at.
function game(api,{start,chunks=6}={}){
  let wall=0,time=start,speed=30;const log={created:[],commits:[],cancels:0,paused:0};
  const engine=api.create({getSimTime:()=>time,setSimTime:t=>{time=t;},getSpeed:()=>speed,setSpeed:v=>{speed=v;},
    createSliceJob:(_slice,meta)=>{log.created.push({from:meta.from,to:meta.to,day:meta.boundary?.day??null});let left=chunks;return {runChunk(){wall+=1;return --left<=0;},finish(){wall+=1;time=meta.to;log.commits.push(meta.to);return {committed:true};},cancel(){log.cancels++;}};},
    onPauseAfterDayClose:()=>{log.paused++;speed=0;}},
    {nowMs:()=>wall,minRealSliceSeconds:1,allowedSpeeds:[0,30,120,300],fallbackSpeed:30,frameBudgetMs:1.5,manualFrameBudgetMs:1.5,chunkItems:32,manualChunkItems:64,manualBatchSeconds:3600,manualMinBatchSeconds:300});
  const frame=()=>{wall+=40;engine.frame(wall);};
  return {engine,log,frame,time:()=>time,speed:()=>speed,setSpeed:v=>{speed=v;}};
}
// Plays frames until a job is in flight.
const untilJob=g=>{for(let i=0;i<50&&!g.engine.jobActive();i++)g.frame();assert.equal(g.engine.jobActive(),true,'a job is in flight');};
// 1.
{const g=game(core.now,{start:86400-30});untilJob(g);assert.notEqual(g.log.created[0].day,null,'1: the job ends on the day boundary');
  assert.equal(g.engine.pauseAfterDayClose(),true,'1: the pause waits for the close');
  for(let i=0;i<60;i++)g.frame();
  assert.equal(g.log.cancels,0,'1: the close is not cancelled');assert.ok(g.log.commits.includes(86400),'1: it commits through midnight');
  assert.equal(g.time(),86400,'1: the game stops at midnight');assert.equal(g.log.created.length,1,'1: no slice starts after it');assert.equal(g.log.paused,1,'1: the pause is handed over once');assert.equal(g.speed(),0,'1: paused');
  assert.equal(g.engine.snapshot().pausesAfterDayClose,1,'1: counted');}
{const g=game(core.before,{start:86400-30});untilJob(g);assert.equal(typeof g.engine.pauseAfterDayClose,'undefined','1: (the source before had none)');g.setSpeed(0);g.frame();assert.equal(g.log.cancels,1,'1: (its pause cancelled the close)');}
// 2.
{const g=game(core.now,{start:1000});untilJob(g);assert.equal(g.log.created[0].day,null,'2: a slice inside the day');assert.equal(g.engine.pauseAfterDayClose(),false,'2: refused outside a day close');assert.equal(g.engine.pausePending(),false,'2: nothing waits');}
{const g=game(core.now,{start:86400-30});g.setSpeed(0);assert.equal(g.engine.advanceTo(86400+3600).accepted,true);untilJob(g);assert.equal(g.engine.pauseAfterDayClose(),false,'2: refused during a calendar advance');}
// 3.
{const g=game(core.now,{start:86400-30});untilJob(g);g.engine.pauseAfterDayClose();assert.equal(g.engine.cancelPauseAfterDayClose(),true,'3: the waiting pause is withdrawn');for(let i=0;i<120;i++)g.frame();
  assert.ok(g.time()>86400,'3: play goes on past midnight');assert.equal(g.log.paused,0,'3: no pause handed over');assert.equal(g.log.cancels,0,'3: nothing cancelled');}
{const g=game(core.now,{start:86400-30});untilJob(g);g.engine.pauseAfterDayClose();g.engine.reset(undefined,'qa-reset');assert.equal(g.log.cancels,1,'3: the close is cancelled by the reset');g.frame();
  assert.equal(g.log.paused,1,'3: the pause is still handed over');assert.equal(g.log.created.length,1,'3: no slice started');}
{const g=game(core.now,{start:86400-30});untilJob(g);g.engine.pauseAfterDayClose();assert.deepEqual({...g.engine.advanceTo(86400*3)},{accepted:false,reason:'pause-after-day-close-pending',target:g.time()},'3: a calendar advance waits for the pause');
  for(let i=0;i<60;i++)g.frame();assert.equal(g.log.paused,1,'3: then the pause');assert.equal(g.engine.advanceTo(86400*3).accepted,true,'3: and the advance is accepted');}

// 4-6.
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app'),QTY=40;
async function run(root,mode){
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    const {page}=await boot({browser,errors,root});
    await page.evaluate(async qty=>{
      const a=__AUDIT__,s=()=>__GH_STATE__,type='air',definition=GH_COMPANY_PLATFORM.definitionFor(s(),type);
      await a.runAuthorizedDomainCommand('corporate','open-company',{type,companyId:type,capital:Math.max(400000000,definition.founding.minimumCapital),legalName:'QA Pause Close',formationContract:'QA-PAUSE-CLOSE'},{silent:true});
      const airport=GH_WORLD_DATA.airports.find(r=>r[0]==='OMDB');
      const facility={id:'QA-air-OMDB',name:'QA Airport OMDB',kind:'airport-base',company:type,ownerCompanyId:type,owned:true,sourceKey:'air:OMDB',code:airport[1]||airport[0],icao:airport[0],iata:airport[1],city:airport[3]||airport[4]||'—',country:String(airport[5]||'—'),coords:[airport[6],airport[7]]};
      await a.runAuthorizedDomainCommand('facilities','create',{facility,bucket:'globalBases'},{silent:true});
      const model=[...GH_ASSET_CATALOG[type].used].sort((x,y)=>(x.leaseMonthly||0)-(y.leaseMonthly||0)||x.price-y.price)[0];
      if(!await a.buyAsset(type,'used',model.id,'lease',qty,facility.id,true,'QA-PAUSE-CLOSE-'+qty,type))throw new Error('purchase rejected');
      a.openDrawer('routes',type);
    },QTY);
    const dispatch=page.locator('.dispatch-international-network[data-company="air"]').first();
    await dispatch.waitFor({state:'visible',timeout:30000});await dispatch.click();
    await page.waitForFunction(qty=>{const owned=GH_FLEET_DATA.filter(__GH_STATE__,x=>(x.ownerCompanyId||x.companyId)==='air');return owned.length===qty&&owned.every(x=>x.routeId);},QTY,{timeout:120000});
    await page.waitForFunction(()=>!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked(),null,{timeout:180000});await page.evaluate(()=>GH_PERSISTENCE.drain());
    await page.evaluate(()=>__AUDIT__.closeDrawer());
    const target=await page.evaluate(()=>(Math.floor((__GH_STATE__.simSeconds+2)/86400)+1)*86400-1);
    assert.equal((await page.evaluate(t=>__AUDIT__.simulationEngine.advanceTo(t,{reason:'qa-pause-close'}),target)).accepted,true);
    await page.waitForFunction(()=>!__AUDIT__.simulationEngine.snapshot().manualAdvance,null,{timeout:120000});
    const out=await page.evaluate(async mode=>{
      const TX=GH_TRANSACTION_CORE,s=()=>__GH_STATE__,engine=__AUDIT__.simulationEngine,startDay=s().lastFinancialDay,midnight=(startDay+1)*86400,cancels=engine.snapshot().cancels,toggle=document.getElementById('speedToggle');
      let click=null,frames=0;__AUDIT__.setSpeed(3);
      await new Promise(resolve=>{const tick=()=>{frames++;const staged=TX.isStaged(s());
        if(staged&&!click&&mode!=='none'){const t=performance.now();toggle.click();click={ms:performance.now()-t,pressed:toggle.getAttribute('aria-pressed'),icon:toggle.querySelector('span').textContent.trim(),stagedAfter:TX.isStaged(s()),cancels:engine.snapshot().cancels-cancels};if(mode==='resume')toggle.click();}
        const done=mode==='resume'?s().simSeconds>midnight+60:mode==='none'?s().lastFinancialDay>startDay&&!staged:(s().speed===0&&!staged);
        if(done||frames>1500)return resolve();requestAnimationFrame(tick);};requestAnimationFrame(tick);});
      if(mode==='none')__AUDIT__.setSpeed(0);
      await new Promise(resolve=>setTimeout(resolve,300));
      const pick=row=>JSON.parse(JSON.stringify(row));
      return {click,frames,startDay,day:s().lastFinancialDay,sim:s().simSeconds,midnight,speed:s().speed,cancels:engine.snapshot().cancels-cancels,pressed:toggle.getAttribute('aria-pressed'),
        finance:JSON.stringify({invoices:pick(s().finance.invoices),transfers:pick(s().finance.transfers||[]),books:Object.fromEntries(Object.entries(s().companyFinance||{}).map(([k,b])=>[k,{accounts:b.accounts,ledger:b.ledger,journal:b.journal}])),proofs:Object.values(s().documentProofs?.recordsById||{}).map(r=>[r.id,r.contentDigest])})};
    },mode);
    assert.deepEqual(errors,[]);return out;
  }finally{await browser.close();}
}
(async()=>{
  const tree=fs.mkdtempSync(path.join(os.tmpdir(),'b628-'));let before;
  try{execFileSync('sh',['-c',`git -C "${ROOT}" archive ${PREVIOUS} | tar -x -C "${tree}"`]);before=await run(tree,'pause');}finally{fs.rmSync(tree,{recursive:true,force:true});}
  const paused=await run(SOURCE,'pause'),reference=await run(SOURCE,'none'),resumed=await run(SOURCE,'resume');
  // 4.
  assert.ok(paused.click,'4: the button was pressed while the close was staged');
  assert.equal(paused.click.pressed,'true','4: the button shows the pause at once');assert.equal(paused.click.icon,'▶','4: (play icon)');assert.equal(paused.click.cancels,0,'4: nothing rolled back by the press');assert.equal(paused.click.stagedAfter,true,'4: the close goes on');
  assert.equal(paused.cancels,0,'4: no cancel at all');assert.equal(paused.day,paused.startDay+1,'4: the day closed');assert.equal(paused.sim,paused.midnight,'4: paused at midnight');assert.equal(paused.speed,0,'4: paused');
  assert.ok(before.click&&before.click.cancels>=1,'4: (the source before rolled the close back on the press)');
  // 5.
  assert.equal(reference.day,reference.startDay+1,'5: the reference day closed');assert.equal(paused.finance,reference.finance,'5: the same finance and proofs as a day the pause did not touch');
  // 6.
  assert.ok(resumed.click,'6: pressed while staged');assert.equal(resumed.cancels,0,'6: nothing cancelled');assert.ok(resumed.sim>resumed.midnight+60&&resumed.speed>0,'6: play went on past midnight');assert.equal(resumed.pressed,'false','6: the button shows play');
  console.log(JSON.stringify({suite:'build628-pause-after-day-close',ok:true,clickMs:+paused.click.ms.toFixed(2),closeFrames:paused.frames,beforeCancels:before.click.cancels}));
})().catch(error=>{console.error(error);process.exitCode=1;});
