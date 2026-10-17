'use strict';
// Full-app wiring above the 2,048-row limit: the day commits without any of the three former main-thread fleet
// readers; the original typed day plan is flushed before a later row write; pausing a held company check rolls back.
const assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const {chromium}=require('playwright');
const {bootAtOrigin,installVault}=require('./helpers/differential-vault-fixture.cjs');
const QTY=2305;
(async()=>{
 const browser=await chromium.launch({headless:true}),errors=[];let started;
 try{
  started=await bootAtOrigin({browser,errors,fleetWorker:true,viewport:{width:956,height:440},beforeScripts:{fn:installVault}});
  const {page}=started;
  await page.evaluate(async qty=>{
   const a=__AUDIT__,s=()=>__GH_STATE__;
   await a.runAuthorizedDomainCommand('corporate','open-company',{type:'air',companyId:'air',capital:900000000,legalName:'QA Worker Close',formationContract:'QA-WORKER-CLOSE'},{silent:true});
   s().godMoney=true;s().infiniteMoney=true;
   const r=GH_WORLD_DATA.airports.find(row=>row[0]==='OMDB');
   await a.runAuthorizedDomainCommand('facilities','create',{facility:{id:'QA-WORKER-BASE',name:'QA Worker Base',kind:'airport-base',company:'air',ownerCompanyId:'air',owned:true,sourceKey:'air:OMDB',code:r[1]||'OMDB',icao:'OMDB',iata:r[1],city:r[3]||'—',country:String(r[5]||'—'),coords:[r[6],r[7]]},bucket:'globalBases'},{silent:true});
   const model=GH_ASSET_CATALOG.air.used[0];if(!await a.buyAsset('air','used',model.id,'lease',qty,'QA-WORKER-BASE',true,'QA-WORKER-CLOSE','air'))throw new Error('fixture-purchase-failed');
   await GH_PERSISTENCE.drain();
   const request=a.simulationEngine.advanceTo(86399,{reason:'qa-worker-close',speed:300});if(!request.accepted)throw new Error(JSON.stringify(request));
  },QTY);
  console.log('worker-close: fixture ready; advancing to boundary');
  await page.waitForFunction(()=>!__AUDIT__.simulationEngine.snapshot().manualAdvance||!!__AUDIT__.simulationEngine.snapshot().lastError,null,{timeout:60000});
  assert.equal(await page.evaluate(()=>__AUDIT__.simulationEngine.snapshot().lastError),'');
  assert.equal(await page.evaluate(()=>__GH_STATE__.simSeconds),86399);
  console.log('worker-close: before midnight');
  const before=await page.evaluate(()=>{
   const F=GH_FLEET_DATA,oldDay=GH_REALISM.onDayStages,watch=window.__WORKER_CLOSE_WATCH__={fullWalks:0,injected:false,before:__AUDIT__.fleetEngineThreadClient().stats()};
   const signatures=new Set([JSON.stringify(['type','specs']),JSON.stringify(['phase','routeId','simulationFault']),JSON.stringify(['id','ownerCompanyId','companyId','assetMode','type','assetClass'])]);
   const deny=()=>{watch.fullWalks++;throw new Error('forbidden-main-fleet-walk');};
   window.__WORKER_CLOSE_RESTORE__=()=>{window.GH_FLEET_DATA=F;window.GH_REALISM.onDayStages=oldDay;};
   window.GH_FLEET_DATA={...F,*columnPlanStages(state,plan,options){
    const stages=F.columnPlanStages(state,plan,options),revision=state.fleet.revision;
    try{for(;;){const step=stages.next();if(step.done)return step.value;
     // Force the real map reader between partial apply slices. A HUD refresh must never drain the replica log or
     // transfer half a column plan; this interleaving formerly stopped day close depending on frame timing.
     if(state.fleet.revision!==revision){watch.interleaved=(watch.interleaved||0)+1;__AUDIT__.mapFleetClassRows();}
     yield step.value;
    }}finally{stages.return();}
   },countByPhase:deny,countByFields:deny,forEachFieldClasses(state,fields,...rest){if(state===__GH_STATE__&&signatures.has(JSON.stringify(fields)))return deny();return F.forEachFieldClasses(state,fields,...rest);}};
   GH_REALISM.onDayStages=function*(state,day){const steps=oldDay(state,day);for(;;){const step=steps.next();if(step.done)return step.value;if(!watch.injected&&step.value==='realism.budgets'){watch.injected=true;GH_FLEET_STORE.set(state.fleet,0,'condition',64);}yield step.value;}};
   __AUDIT__.setSpeed(3);return watch.before;
  });
  await page.waitForFunction(()=>__GH_STATE__.lastFinancialDay===1&&!GH_TRANSACTION_CORE.isStaged(__GH_STATE__)||!!__AUDIT__.simulationEngine.snapshot().lastError,null,{timeout:60000});
  const commit=await page.evaluate(()=>{
   __AUDIT__.setSpeed(0);const watch=__WORKER_CLOSE_WATCH__,out={interleaved:watch.interleaved||0,fullWalks:watch.fullWalks,injected:watch.injected,after:__AUDIT__.fleetEngineThreadClient().stats(),day:__GH_STATE__.lastFinancialDay,error:__AUDIT__.simulationEngine.snapshot().lastError,metrics:GH_REALISM.fleetDailyMetrics(__GH_STATE__)};__WORKER_CLOSE_RESTORE__();return out;
  });
  assert.equal(commit.day,1,commit.error);assert.equal(commit.error,'');assert.equal(commit.fullWalks,0);assert.equal(commit.injected,true);
  assert.ok(commit.interleaved>0,'the map read actually ran between partial column writes');
  assert.ok(commit.after.replicaRefusals['column-plan-applying']>0,'readers defer until the whole typed plan is ready');
  assert.ok(commit.after.columnPlanSyncs>before.columnPlanSyncs,'the typed plan travelled before the later condition row write');
  assert.equal(commit.after.columnSyncs,before.columnSyncs,'no whole-column gather was needed');
  assert.equal(commit.metrics.rows,QTY);
  await page.waitForFunction(()=>!__GH_APP_RUNTIME_INSTRUMENTATION__.maintenance.pending?.length&&!GH_PERSISTENCE.isLocked()&&!__AUDIT__.fleetEngineThreadClient().busy,null,{timeout:30000});
  const cancelled=await page.evaluate(async()=>{
   const s=()=>__GH_STATE__,proofProvider=GH_COMPANY_FLEET_VALIDATION_PROVIDER,TX=GH_TRANSACTION_CORE;
   const snapshot=()=>({sim:s().simSeconds,day:s().lastFinancialDay,money:JSON.stringify({cash:s().cash,companyFinance:s().companyFinance,finance:s().finance,treasury:s().treasury,tripProfitAccrued:s().tripProfitAccrued,tripRevenueAccrued:s().tripRevenueAccrued,tripCountAccrued:s().tripCountAccrued}),rows:GH_STATE_CODEC.bytesToBase64(new Uint8Array(s().fleet.rows)),values:JSON.stringify(s().fleet.values),extras:JSON.stringify(s().fleet.extras)});
   const before=snapshot();let release=null,late=null,held=false;
   window.GH_TRANSACTION_CORE={...TX,beginStaged(state,options){
    if(state!==s()||!String(options.label).startsWith('simulation:'))return TX.beginStaged(state,options);
    const apply=options.apply;return TX.beginStaged(state,{...options,apply:function*(measure){const steps=apply(measure);try{for(;;){const step=steps.next();if(step.done)return step.value;if(step.value==='slice.fleet-apply')GH_FLEET_STORE.set(state.fleet,0,'assetClass','temporary-class');yield step.value;}}finally{steps.return();}}});
   }};
   window.GH_COMPANY_FLEET_VALIDATION_PROVIDER=(state,options={})=>{
    if(options.syncOnly)return null;const asked=proofProvider(state,options);return new Promise(resolve=>Promise.resolve(asked).then(value=>{late=value;held=true;release=()=>resolve(value);}));
   };
   __AUDIT__.setSpeed(3);
   await new Promise((resolve,reject)=>{const end=performance.now()+30000;const tick=()=>{if(held&&GH_TRANSACTION_CORE.isStaged(s()))return resolve();if(performance.now()>end)return reject(new Error('held company check did not start'));requestAnimationFrame(tick);};tick();});
   __AUDIT__.setSpeed(0);const staged=GH_TRANSACTION_CORE.isStaged(s()),after=snapshot(),lateCurrent=late?.current?.()===true;
   window.GH_COMPANY_FLEET_VALIDATION_PROVIDER=proofProvider;window.GH_TRANSACTION_CORE=TX;release();await new Promise(resolve=>setTimeout(resolve,100));
   return {before,after,afterLate:snapshot(),staged,lateCurrent,cancelReason:__AUDIT__.simulationEngine.snapshot().lastCancelReason};
  });
  assert.equal(cancelled.staged,false);assert.equal(cancelled.cancelReason,'user-speed-change');assert.equal(cancelled.lateCurrent,false,'an answer from before rollback expired');
  fs.writeFileSync('/tmp/madar-worker-close-cancel.json',JSON.stringify(cancelled));
  const digest=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
  for(const key of Object.keys(cancelled.before)){assert.equal(digest(cancelled.after[key]),digest(cancelled.before[key]),`pause restores ${key}`);assert.equal(digest(cancelled.afterLate[key]),digest(cancelled.before[key]),`late resolution cannot alter ${key}`);}
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({suite:'build405-worker-close-browser',rows:QTY,mainFullWalks:commit.fullWalks,columnPlanSyncs:commit.after.columnPlanSyncs-before.columnPlanSyncs,wholeColumnSyncs:commit.after.columnSyncs-before.columnSyncs,interleavedMapReads:commit.interleaved,cancelRollback:true,lateAnswerRejected:true}));
 }finally{await browser.close();await started?.closeOrigin();}
})().catch(error=>{console.error(error);process.exitCode=1;});
