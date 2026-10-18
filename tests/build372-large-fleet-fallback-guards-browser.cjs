'use strict';
// A worker refusal may preserve the exact synchronous path only for a bounded
// fleet. At production scale simulation pauses without entering EVENTS.advance,
// and route-center data stays in loading/retry until a current worker answer.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');

(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    const {page}=await boot({browser,errors});page.setDefaultTimeout(60000);
    // The actual large-route request now carries canonical company ownership. Open the fixture's owner through its domain command.
    await page.evaluate(async()=>{const s=__GH_STATE__,d=GH_COMPANY_PLATFORM.definitionFor(s,'air');s.godMoney=true;s.infiniteMoney=true;await __AUDIT__.runAuthorizedDomainCommand('corporate','open-company',{type:'air',companyId:'air',capital:Math.max(900000000,d.founding.minimumCapital),legalName:'QA Guard Air',formationContract:'QA-GUARD-AIR'},{silent:true});});
    const result=await page.evaluate(async()=>{
      const a=__AUDIT__,s=__GH_STATE__,STORE=GH_FLEET_STORE,tick=()=>new Promise(resolve=>setTimeout(resolve,0)),asset=index=>({id:`QA-GUARD-${index}`,name:`Guard ${index}`,type:'air',assetMode:'air',ownerCompanyId:'air',companyId:'air',catalogId:'QA-GUARD-CAT',baseFacility:'QA-BASE',phase:'turnaround',progress:0,fuel:100,condition:90,routeId:null,departureScheduled:false,salePending:false,deliveryStatus:'delivered',specs:{rangeKm:8000}});
      const originalEvents=window.GH_FLEET_EVENTS,originalQuery=window.GH_FLEET_QUERY;let advanceCalls=0,routeScans=0;
      window.GH_FLEET_EVENTS=Object.freeze({...originalEvents,advance(store,options){advanceCalls++;return {completeTo:options.to,effects:a.makeSimulationEffects(),events:0,fast:0,slow:0,faults:0};}});
      window.GH_FLEET_QUERY=Object.freeze({...originalQuery,run(name,...args){if(name==='routeCenter')routeScans++;return originalQuery.run(name,...args);}});
      const drain=async job=>{let done=false;for(let calls=0;calls<80;calls++){const out=job.runChunk(64,{deadline:performance.now()+1000});if(out===true||out?.done===true){done=true;break;}await tick();}if(!done)throw new Error('simulation guard job did not settle');return job.finish();};
      try{
        s.fleet=STORE.fromAssets(Array.from({length:2049},(_,index)=>asset(index)),{at:s.simSeconds});s.speed=3;
        a.setFleetEngineThreadClient({disabled:true,busy:false,stats:()=>({})});
        const missingFrom=Number(s.simSeconds)||0,missing=await drain(a.createSimulationSliceJob(1,{from:missingFrom,to:missingFrom+1,staged:true,boundary:GH_SIMULATION_TIME_CORE.boundaryAt(missingFrom+1)}));
        const afterMissing={advanceCalls,speed:s.speed,simSeconds:s.simSeconds};

        s.speed=3;const staleClient={disabled:false,busy:false,stats:()=>({}),request(){return {status:'ready',reason:''};},apply(){return null;},discard(){},prime(){return true;}};a.setFleetEngineThreadClient(staleClient);
        const staleFrom=Number(s.simSeconds)||0,stale=await drain(a.createSimulationSliceJob(1,{from:staleFrom,to:staleFrom+1,staged:true,boundary:GH_SIMULATION_TIME_CORE.boundaryAt(staleFrom+1)}));
        const afterStale={advanceCalls,speed:s.speed,simSeconds:s.simSeconds};

        s.fleet=STORE.fromAssets([asset(1),asset(2)],{at:s.simSeconds});s.speed=0;a.setFleetEngineThreadClient({disabled:true,busy:false,stats:()=>({})});
        const smallFrom=Number(s.simSeconds)||0,small=await drain(a.createSimulationSliceJob(1,{from:smallFrom,to:smallFrom+1,staged:true,boundary:GH_SIMULATION_TIME_CORE.boundaryAt(smallFrom+1)}));
        const afterSmall={advanceCalls,simSeconds:s.simSeconds};

        const route={id:'QA-GUARD-ROUTE',type:'air',routeMode:'air',ownerCompanyId:'air',fromFacility:'QA-BASE',toFacility:'QA-END',distanceKm:400,maxLegKm:400,route:[[0,0],[1,1]]},makeCards=()=>[{r:route,wantsAssignable:true,routeConflict:null,capacity:40,assignable:[],assignableMore:false}],routeArgs=()=>['air','',makeCards(),40,a.routeCenterFleetSnapshot(),80];
        s.fleet=STORE.fromAssets(Array.from({length:2049},(_,index)=>asset(index+10000)),{at:s.simSeconds});a.setFleetEngineThreadClient({disabled:true,busy:false,stats:()=>({})});
        const routeMissing=a.routeCenterDetails(...routeArgs()),routeAfterMissing=routeScans;
        let resolveStale;const staleQuery=new Promise(resolve=>{resolveStale=resolve;});a.setFleetEngineThreadClient({disabled:false,busy:false,query(){return staleQuery;},current(){return false;}});const routeStaleFirst=a.routeCenterDetails(...routeArgs());resolveStale({store:s.fleet,revision:s.fleet.revision,result:{legacy:false}});await tick();const routeAfterStale=routeScans;
        const workerResult={legacy:false,summaryByCompany:[['air',{total:2049,assigned:0,idle:2049,moving:0,movingPhase:0,ready:0,internationalReady:2049,manualReady:2049,idleAssets:[]}]],cards:[[route.id,{count:0,turn:0,scheduled:0,inMotion:0,primaryId:null,scored:0,margin:0,revenue:0}]],manualAssets:[asset(10000)],assignable:[[route.id,{rows:[],more:false}]]};
        a.setFleetEngineThreadClient({disabled:false,busy:false,query(){return Promise.resolve({store:s.fleet,revision:s.fleet.revision,result:workerResult});},current(found,store){return found?.store===store&&found.revision===store.revision;}});a.routeCenterDetails(...routeArgs());await tick();const routeCurrent=a.routeCenterDetails(...routeArgs());
        s.fleet=STORE.fromAssets([asset(20001),asset(20002)],{at:s.simSeconds});a.setFleetEngineThreadClient({disabled:true,busy:false,stats:()=>({})});const routeSmall=a.routeCenterDetails(...routeArgs()),routeAfterSmall=routeScans;
        return {missing,stale,small,afterMissing,afterStale,afterSmall,routeMissing,routeStaleFirst,routeCurrent:{pending:routeCurrent.pending,status:routeCurrent.status,manualIds:routeCurrent.manualAssets.map(row=>row.id)},routeSmall:{pending:routeSmall.pending,status:routeSmall.status},routeAfterMissing,routeAfterStale,routeAfterSmall,instrumentation:__GH_APP_RUNTIME_INSTRUMENTATION__.fleetMainThreadGuard||null};
      }finally{window.GH_FLEET_EVENTS=originalEvents;window.GH_FLEET_QUERY=originalQuery;a.setFleetEngineThreadClient(null);}
    });
    assert.equal(result.missing.committed,false);assert.equal(result.missing.reason,'large-fleet-worker-required');assert.equal(result.afterMissing.advanceCalls,0);assert.equal(result.afterMissing.speed,0);assert.equal(result.afterMissing.simSeconds,0);
    assert.equal(result.stale.committed,false);assert.equal(result.stale.reason,'large-fleet-worker-required');assert.equal(result.afterStale.advanceCalls,0);assert.equal(result.afterStale.speed,0);assert.equal(result.afterStale.simSeconds,0);
    assert.equal(result.small.committed,true);assert.equal(result.afterSmall.advanceCalls,1);assert.equal(result.afterSmall.simSeconds,1,'bounded fallback preserves the exact advance result');
    assert.equal(result.routeMissing.pending,true);assert.equal(result.routeMissing.status,'loading');assert.equal(result.routeAfterMissing,0,'missing worker does not scan 2049 route rows');
    assert.equal(result.routeStaleFirst.pending,true);assert.equal(result.routeAfterStale,0,'stale worker result does not trigger a large synchronous scan');
    assert.equal(result.routeCurrent.pending,false);assert.equal(result.routeCurrent.status,'ready');assert.deepEqual(result.routeCurrent.manualIds,['QA-GUARD-10000'],'a current worker result is accepted');
    assert.equal(result.routeSmall.pending,false);assert.equal(result.routeSmall.status,'ready');assert.equal(result.routeAfterSmall,1,'small route center keeps the exact synchronous fallback');
    assert.equal(result.instrumentation?.rows,2049);assert.deepEqual(errors,[]);
    const app=fs.readFileSync(path.join(process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..'),'WebApp','app.js'),'utf8');assert.match(app,/routeDetails\.pending[\s\S]{0,600}جارٍ تجهيز بيانات الأسطول/,'the route center renders its loading/retry state');
    console.log(JSON.stringify({suite:'build372-large-fleet-fallback-guards-browser',result}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
