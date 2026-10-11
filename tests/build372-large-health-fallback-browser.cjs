'use strict';
// A missing or stale worker result must never turn a large fleet health pass
// into a synchronous scan of every row. Small fleets retain the exact legacy
// fallback; explicit worker issues remain valid at either size.
const assert=require('node:assert/strict');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');

(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    const {page}=await boot({browser,errors,viewport:{width:844,height:390}});page.setDefaultTimeout(60000);
    const result=await page.evaluate(async()=>{
      const a=__AUDIT__,state=__GH_STATE__,STORE=GH_FLEET_STORE,originalClient=a.fleetEngineThreadClient(),tick=()=>new Promise(resolve=>setTimeout(resolve,0));
      const assets=Array.from({length:2050},(_,index)=>({id:`QA-HEALTH-${index}`,name:`Health ${index}`,type:'air',assetMode:'air',ownerCompanyId:'air',phase:'turnaround',condition:90}));state.fleet=STORE.fromAssets(assets,{at:0});
      let mode='missing',requests=0;const fake={disabled:false,busy:false,stats:()=>({}),current:()=>false,health:()=>{requests++;if(mode==='missing')return Promise.resolve(null);return Promise.resolve({store:state.fleet,runtime:STORE.chunkStamp(state.fleet).runtime,revision:state.fleet.revision,structure:state.fleet.structure,length:state.fleet.length,simSeconds:state.simSeconds,issues:[]});}};a.setFleetEngineThreadClient(fake);
      const run=async()=>{const entry={task:'health'};let calls=0;for(;;){calls++;if(a.runMaintenanceTask(entry)!==false)return {calls,retries:entry.retries||0};await tick();if(calls>30)throw new Error('large health retry did not settle');}};
      const before=JSON.stringify(state.diagnostics?.lastHealth??null),missing=await run(),afterMissing=JSON.stringify(state.diagnostics?.lastHealth??null);
      mode='stale';const stale=await run(),afterStale=JSON.stringify(state.diagnostics?.lastHealth??null);
      const realtimeBefore=JSON.stringify(state.diagnostics?.lastHealth??null),largeMain=a.runRealtimeHealth(undefined),afterLargeMain=JSON.stringify(state.diagnostics?.lastHealth??null),largeExplicit=a.runRealtimeHealth([]);
      state.fleet=STORE.fromAssets(assets.slice(0,2),{at:0});const smallMain=a.runRealtimeHealth(undefined);
      a.setFleetEngineThreadClient(originalClient);
      return {missing,stale,requests,missingUntouched:before===afterMissing,staleUntouched:afterMissing===afterStale,largeMain,largeMainUntouched:realtimeBefore===afterLargeMain,largeExplicit,smallMain,unavailable:__GH_APP_RUNTIME_INSTRUMENTATION__.maintenance.healthUnavailable,smallAllowed:a.mainFleetHealthAllowed()};
    });
    assert.deepEqual(errors,[]);assert.equal(result.missing.retries,4);assert.equal(result.stale.retries,4);assert.equal(result.missingUntouched,true,'missing worker evidence does not publish a health report');assert.equal(result.staleUntouched,true,'stale worker evidence does not publish a health report');
    assert.equal(result.largeMain,false,'defensive realtime entry refuses a large main-thread scan');assert.equal(result.largeMainUntouched,true,'refused realtime scan leaves the prior report untouched');assert.equal(result.largeExplicit,true,'explicit worker issues may run the non-fleet health checks');assert.equal(result.smallMain,true,'small fleet keeps the exact main-thread fallback');assert.equal(result.smallAllowed,true);assert.equal(result.unavailable?.rows,2050);assert.match(String(result.unavailable?.reason),/stale-worker-result|worker-unavailable/);
    console.log(JSON.stringify({suite:'build372-large-health-fallback-browser',...result}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
