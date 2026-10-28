'use strict';
// Owner (build 106 iPhone diagnostic: a six-hour calendar window of 630,000 assets took 16.4 s, 1,244 stages at one a
// frame, the main thread idle; then «صلح كل شي بدقه ابيها قريب من الاصفار»): a fleet window's job ran one stage and
// ended the frame as if it awaited the fleet worker. Its stages now run on within the frame's budget and stop only when
// the next worker leg is awaited. In the real app (local DOM, fleet worker), from one saved world (2,400 aircraft on
// routes), against the source before (1d7dce1, from its own tree, same browser):
//  1. a five-hour window leaves exactly the source before's state (every root, the fleet's words, values and extras),
//     which is also exactly the state of the same five hours run hour by hour;
//  2. it paints at most half the frames the source before paints for the same window, and no frame of the advance waits
//     more than 50 ms;
//  3. an advance cancelled while its window is open (a leg replayed) rolls back to its start: the state is exactly what it
//     was before the advance;
//  4. no error is logged.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');
const ROOT=path.resolve(__dirname,'..'),SOURCE=process.env.GH_TEST_SOURCE_DIR||ROOT,PREVIOUS='1d7dce1',BASES=['OMDB','EGLL'],PER_BASE=1200,HOURS=5;
const canonical=page=>page.evaluate(()=>{
  const s=__GH_STATE__,state=JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(s).filter(([key])=>key!=='fleet'))));
  // Diagnostics hold wall-clock samples; the kernel's last commit names the window or the hour (build362 compares the same).
  delete state.diagnostics;delete state.simulationKernel;
  const replica=GH_FLEET_STORE.exportReplica(s.fleet);
  return JSON.stringify({state,fleet:{length:replica.length,live:replica.live,values:replica.values,extras:replica.extras,words:Array.from(new Uint32Array(replica.rows))}});
});
const settle=page=>page.waitForFunction(()=>!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked()&&!__AUDIT__.simulationEngine.snapshot().manualAdvance&&!GH_TRANSACTION_CORE.isStaged(__GH_STATE__),null,{timeout:300000});
async function advance(page,enabled,cancel=false){
  return page.evaluate(async({hours,enabled,cancel})=>{
    const a=__AUDIT__,s=__GH_STATE__;window.__GH_MANUAL_CALENDAR_WINDOWS__=enabled;
    const start=s.simSeconds,target=start+hours*3600;let frames=0,on=true,maxGap=0,last=performance.now();
    const tick=t=>{frames++;maxGap=Math.max(maxGap,t-last);last=t;if(on)requestAnimationFrame(tick);};requestAnimationFrame(tick);
    const h0=a.simulationEngine.health(),t0=GH_APP_RUNTIME_METRICS.snapshot().fleetEngineThread;let cancelled=null;
    const accepted=a.simulationEngine.advanceTo(target,{speed:600,batchSeconds:3600,reason:'qa-607',maxSeconds:366*86400});
    for(let i=0;i<120000&&(a.simulationEngine.snapshot().manualAdvance||GH_TRANSACTION_CORE.isStaged(s));i++){
      if(cancel&&cancelled===null&&GH_APP_RUNTIME_METRICS.snapshot().fleetEngineThread.windowSteps>t0.windowSteps&&GH_TRANSACTION_CORE.isStaged(s)){cancelled={sim:s.simSeconds,staged:true};a.simulationEngine.cancelAdvance('qa-607-cancel',{immediate:true});}
      await new Promise(r=>setTimeout(r,2));
    }
    on=false;const h=a.simulationEngine.health(),t=GH_APP_RUNTIME_METRICS.snapshot().fleetEngineThread;
    return {accepted:accepted?.accepted===true,start,end:s.simSeconds,frames,maxGap,windows:h.aggregateWindows-h0.aggregateWindows,windowSteps:t.windowSteps-t0.windowSteps,windowCommits:t.windowCommits-t0.windowCommits,windowRollbacks:t.windowRollbacks-t0.windowRollbacks,hours:h.hours-h0.hours,cancelled,failure:a.simulationEngine.snapshot().lastAdvanceFailure||null};
  },{hours:HOURS,enabled,cancel});
}
(async()=>{
  const tree=fs.mkdtempSync(path.join(os.tmpdir(),'b607-')),browser=await chromium.launch({headless:true}),errors=[];
  try{
    execFileSync('sh',['-c',`git -C "${ROOT}" archive ${PREVIOUS} WebApp | tar -x -C "${tree}"`]);
    // One saved world for every run.
    const setup=await boot({browser,errors,root:SOURCE,fleetWorker:true,viewport:{width:844,height:390}});setup.page.setDefaultTimeout(600000);
    const world=await setup.page.evaluate(async({bases,per})=>{
      const a=__AUDIT__,s=__GH_STATE__,W=GH_WORLD_DATA;s.godMoney=true;s.infiniteMoney=true;
      await a.runAuthorizedDomainCommand('corporate','open-company',{type:'air',companyId:'air',capital:900000000,legalName:'QA Window Air',formationContract:'QA-607'},{silent:true});
      for(const icao of bases){const row=W.airports.find(i=>i[0]===icao);await a.runAuthorizedDomainCommand('facilities','create',{facility:{id:`QA-${icao}`,name:`QA ${icao}`,kind:'airport-base',company:'air',ownerCompanyId:'air',owned:true,sourceKey:`air:${icao}`,code:row[1]||icao,icao,iata:row[1],city:row[3]||'—',country:String(row[5]||'—'),coords:[row[6],row[7]]},bucket:'globalBases'},{silent:true});}
      const model=[...GH_ASSET_CATALOG.air.used].sort((x,y)=>(x.leaseMonthly||0)-(y.leaseMonthly||0)||x.price-y.price)[0];
      for(const icao of bases)await a.buyAsset('air','used',model.id,'lease',per,`QA-${icao}`,true,`QA-607-${icao}`,'air',{});
      let dispatched=null;try{dispatched=await a.dispatchSharedInternationalNetwork('air');}catch(error){dispatched=String(error?.message||error);}
      return {dispatched:JSON.stringify(dispatched)?.slice(0,300),fleet:GH_FLEET_DATA.size(s),routed:GH_FLEET_DATA.count(s,row=>Boolean(row.routeId)),pending:GH_REALISM.hasPendingDeliveries(s),sim:s.simSeconds};
    },{bases:BASES,per:PER_BASE});
    await settle(setup.page);await setup.page.evaluate(()=>GH_PERSISTENCE.drain());
    const storage=await setup.page.evaluate(()=>Array.from({length:localStorage.length},(_,i)=>{const key=localStorage.key(i);return [key,localStorage.getItem(key)];}));await setup.page.close();
    assert.equal(world.fleet,BASES.length*PER_BASE);assert.equal(world.routed,world.fleet,`every aircraft on a route (${world.dispatched})`);assert.equal(world.pending,false,'no pending delivery (the window\'s condition)');
    const run=async(root,enabled,cancel=false)=>{const env=await boot({browser,errors,root,storage,fleetWorker:true,viewport:{width:844,height:390}});env.page.setDefaultTimeout(600000);await settle(env.page);
      const before=cancel?await canonical(env.page):null,result=await advance(env.page,enabled,cancel);await settle(env.page);const state=await canonical(env.page);await env.page.close();return {result,state,before};};
    const old=await run(tree,true),now=await run(SOURCE,true),hourly=await run(SOURCE,false);
    for(const [label,r] of [['before',old],['now',now],['hourly',hourly]]){assert.equal(r.result.accepted,true,label);assert.equal(r.result.failure,null,`${label}: ${JSON.stringify(r.result.failure)}`);assert.equal(r.result.end-r.result.start,HOURS*3600,`${label}: the advance reaches its target`);}
    assert.equal(now.result.windows,1,'the window path ran');assert.equal(now.result.windowSteps,HOURS);assert.equal(now.result.windowCommits,1);assert.equal(old.result.windows,1);assert.equal(hourly.result.windows,0);
    // 1.
    assert.equal(now.state,old.state,'1: exactly the source before\'s state after the window');assert.equal(now.state,hourly.state,'1: exactly the state of the same hours run one by one');
    // 2.
    assert.ok(now.result.frames<=0.5*old.result.frames,`2: at most half the source before's frames (${now.result.frames} against ${old.result.frames})`);
    assert.ok(now.result.maxGap<=50,`2: no frame waits more than 50 ms (${now.result.maxGap.toFixed(1)})`);
    // 3.
    const cancelled=await run(SOURCE,true,true);
    assert.ok(cancelled.result.cancelled,'3: the advance was cancelled while its window was open');assert.equal(cancelled.result.windowCommits,0,'3: the window did not commit');assert.ok(cancelled.result.windowRollbacks>=1,'3: the worker\'s window rolled back');
    assert.equal(cancelled.result.end,cancelled.result.start,'3: the game time is back at the start');assert.equal(cancelled.state,cancelled.before,'3: the state is exactly what it was before the advance');
    // 4.
    assert.deepEqual(errors,[],'4: no error');
    console.log(JSON.stringify({suite:'build607-calendar-window-stages-browser',ok:true,world:{...world,dispatched:undefined},frames:{now:now.result.frames,before:old.result.frames,hourly:hourly.result.frames},maxGap:Math.round(now.result.maxGap)}));
  }finally{await browser.close();fs.rmSync(tree,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
