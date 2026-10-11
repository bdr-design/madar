'use strict';
// The app must authorize one compact dispatch intent and replay the worker plan inside the durable fleet journal.  The
// former per-512/500 assign and depart domain commands must not return, and an unavailable or stale production-scale
// worker must roll back route and fleet writes instead of scanning the fleet on the UI thread.
const assert=require('node:assert/strict');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');

(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    const {page}=await boot({browser,errors});page.setDefaultTimeout(120000);
    const projection=await page.evaluate(async()=>{const trace={},values=new Uint32Array(20000);await __AUDIT__.cooperativeFleetLoop(values.length,index=>{values[index]=(index*17)>>>0;},trace);return {...trace,checksum:values[19999]};});
    assert.ok(projection.projectionYields>=78,`20k projection did not yield often enough: ${JSON.stringify(projection)}`);assert.equal(projection.checksum,19999*17);
    const successful=await page.evaluate(async()=>{
      const a=__AUDIT__,s=__GH_STATE__,type='air',definition=GH_COMPANY_PLATFORM.definitionFor(s,type);s.godMoney=true;s.infiniteMoney=true;
      if(!s.openedCompanies.includes(type))await a.runAuthorizedDomainCommand('corporate','open-company',{type,companyId:type,capital:definition.founding.defaultCapital,legalName:'QA Dispatch Intent Air',formationContract:'QA-DISPATCH-INTENT'},{silent:true});
      const airport=GH_WORLD_DATA.airports.find(row=>row[0]==='OMDB'),facility={id:'QA-DISPATCH-BASE',name:'QA Dispatch Base',kind:'airport-base',company:type,ownerCompanyId:type,owned:true,sourceKey:`air:${airport[0]}`,code:airport[1]||airport[0],icao:airport[0],iata:airport[1],city:airport[3]||'Dubai',country:String(airport[5]||'UAE'),coords:[airport[6],airport[7]]};
      await a.runAuthorizedDomainCommand('facilities','create',{facility,bucket:'globalBases'},{silent:true});
      const model=GH_ASSET_CATALOG.air.used[0],bought=await a.buyAsset(type,'used',model.id,'lease',12,facility.id,true,'QA-DISPATCH-INTENT-BUY',type);
      const original=GH_DOMAIN_COMMANDS,commands=[];window.GH_DOMAIN_COMMANDS={...original,dispatchEnvelope(ctx,envelope,options){const command=GH_AUTHORIZATION.commandIntent(envelope.command);commands.push({domain:command.domain,name:command.name,payload:structuredClone(command.payload)});return original.dispatchEnvelope(ctx,envelope,options);}};
      let result;try{result=await a.dispatchSharedInternationalNetwork(type);}finally{window.GH_DOMAIN_COMMANDS=original;}await new Promise(resolve=>setTimeout(resolve,20));
      return {bought:Boolean(bought),result,commands,routed:GH_FLEET_DATA.filter(s,row=>row.ownerCompanyId===type&&row.routeId).length,alerts:(s.alerts||[]).slice(0,4).map(row=>String(row?.text||row))};
    });
    assert.equal(successful.bought,true);assert.equal(successful.result?.departed,12,JSON.stringify(successful));assert.equal(successful.routed,12);
    const fleetCommands=successful.commands.filter(row=>row.domain==='fleet'),intents=fleetCommands.filter(row=>row.name==='dispatch-plan-intent');
    assert.equal(intents.length,1,'one signed dispatch intent');assert.equal(fleetCommands.some(row=>row.name==='assign-routes-batch'||row.name==='depart-batch'),false,'legacy chunk commands are absent');
    assert.equal(intents[0].payload.count,12);assert.equal('bytes' in intents[0].payload||'indices' in intents[0].payload,false);assert.ok(JSON.stringify(intents[0].payload).length<1600,'intent stays compact');

    const rollback=await page.evaluate(async()=>{
      const a=__AUDIT__,s=__GH_STATE__,STORE=GH_FLEET_STORE,COUNT=2050,specs={capacity:80,capacityUnit:'passenger',speedKmh:720,rangeKm:6000,market:'air-pax',crewPlan:{pilots:4,cabin:8,aeng:2}},assets=[];
      for(let index=0;index<COUNT;index++)assets.push({id:`QA-LARGE-${String(index).padStart(5,'0')}`,name:`QA ${index}`,type:'air',assetMode:'air',assetClass:'aircraft',ownerCompanyId:'air',companyId:'air',catalogId:'QA-CAT',baseFacility:'QA-BASE',phase:'idle',progress:0,fuel:100,condition:91,routeId:null,routeSlot:null,departureScheduled:false,staffing:{mode:'automatic-fixed',ready:true,roles:[],total:14,monthlyPayroll:1},specs});
      s.fleet=STORE.fromAssets(assets,{at:s.simSeconds});s.customRoutes=[];s.routesRevision=(Number(s.routesRevision)||0)+1;a.setFleetEngineThreadClient(null);window.__GH_FLEET_ENGINE_THREAD__=false;
      const route={id:'QA-WORKER-ROUTE',type:'air',routeMode:'air',company:'air',ownerCompanyId:'air',name:'QA Worker Route',from:'QA Base',to:'QA End',fromFacility:'QA-BASE',toFacility:'QA-END',route:[[24,54],[25,55]],distanceKm:150,maxLegKm:150,effectiveSpeedKmh:700,tripSeconds:772,dwellHours:1,fleetCapacity:8192},routeTable={qa:route},assignments=assets.slice(0,24).map(row=>({id:row.id,routeId:route.id,routeRef:'qa',baseFacility:row.baseFacility,phase:'turnaround'}));
      const mark=()=>({saveRevision:s.saveRevision,routesRevision:s.routesRevision,routes:JSON.stringify(s.customRoutes),condition:GH_FLEET_DATA.get(s,assets.at(-1).id).condition,size:GH_FLEET_DATA.size(s)}),beforeUnavailable=mark();let activeDraft=null;
      const run=label=>a.runDurableStateCommand(label,async({state:draft})=>{activeDraft=draft;try{draft.customRoutes.push(structuredClone(route));draft.routesRevision++;return await a.applyFleetDispatchWorkerPlan({draft,dispatch:()=>{throw new Error('intent-must-not-run');},companyId:'air',mode:'air',assignments,routeTable});}finally{activeDraft=null;}},{silent:true});
      const unavailable=await run('qa-dispatch-worker-unavailable'),afterUnavailable=mark();
      const fake={disabled:null,busy:false,replicaReady:()=>true,stats:()=>({seedSyncs:1,fullSyncs:0}),dispatchPlan(store,{input}){const replica=STORE.importReplica(STORE.exportReplica(store)),plan=GH_FLEET_DISPATCH_CORE.compute({fleet:replica,simSeconds:input.context.simSeconds,routesRevision:input.context.routesRevision,customRoutes:input.registeredRoutes},input);STORE.set(store,store.length-1,'condition',43);return Promise.resolve({store,plan});},current:()=>false};
      a.setFleetEngineThreadClient(fake);const beforeStale=mark(),stale=await run('qa-dispatch-worker-stale'),afterStale=mark();
      const contextFake={...fake,dispatchPlan(store,{input}){const replica=STORE.importReplica(STORE.exportReplica(store)),plan=GH_FLEET_DISPATCH_CORE.compute({fleet:replica,simSeconds:input.context.simSeconds,routesRevision:input.context.routesRevision,customRoutes:input.registeredRoutes},input);activeDraft.routesRevision++;return Promise.resolve({store,plan});},current:()=>true};
      a.setFleetEngineThreadClient(contextFake);const beforeContext=mark(),contextStale=await run('qa-dispatch-context-stale'),afterContext=mark();a.setFleetEngineThreadClient(null);
      return {unavailable,stale,contextStale,beforeUnavailable,afterUnavailable,beforeStale,afterStale,beforeContext,afterContext};
    });
    assert.equal(rollback.unavailable,false);assert.deepEqual(rollback.afterUnavailable,rollback.beforeUnavailable,'unavailable worker rolls back route state');
    assert.equal(rollback.stale,false);assert.deepEqual(rollback.afterStale,rollback.beforeStale,'stale worker rolls back its intervening fleet write and route state');
    assert.equal(rollback.contextStale,false);assert.deepEqual(rollback.afterContext,rollback.beforeContext,'route/catalog context freshness failure rolls back route state');
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({suite:'build372-dispatch-app-integration',fleetCommands:fleetCommands.map(row=>row.name),intentBytes:JSON.stringify(intents[0].payload).length,projection,rollback:{unavailable:rollback.unavailable,stale:rollback.stale,contextStale:rollback.contextStale}}));
    console.log('BUILD372_DISPATCH_APP_INTEGRATION_PASS');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
