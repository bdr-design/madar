'use strict';
// Bulk dispatch is computed by the real fleet worker against an exact replica, then returned as transferred fixed-row
// bytes. The main replay must equal the former assign -> normalize -> load/depart path byte for byte, remain bounded,
// leave the worker replica unchanged after speculative planning, reject a stale fleet before writing, and keep the
// shared simulation worker alive after an invalid dispatch request.
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {chromium}=require('playwright');
const WEB=path.join(path.resolve(__dirname,'..'),'WebApp');

const server=http.createServer((request,response)=>{
  const pathname=new URL(request.url,'http://127.0.0.1').pathname;
  if(pathname==='/'){response.writeHead(200,{'content-type':'text/html'});response.end('<!doctype html><meta charset="utf-8">');return;}
  const file=path.join(WEB,pathname.replace(/^\//,''));
  if(!file.startsWith(WEB+path.sep)||!fs.existsSync(file)){response.writeHead(404);response.end('missing');return;}
  response.writeHead(200,{'content-type':'text/javascript'});response.end(fs.readFileSync(file));
});

(async()=>{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const port=server.address().port,executablePath=['/usr/bin/chromium','/usr/bin/chromium-browser'].find(file=>fs.existsSync(file));
  const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
  try{
    const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(String(error)));
    await page.goto(`http://127.0.0.1:${port}/`);
    for(const file of ['fleet-store-core.js','simulation-asset-core.js','route-core.js','fleet-access-core.js','fleet-core.js','fleet-dispatch-core.js','fleet-engine-thread.js'])await page.addScriptTag({url:`http://127.0.0.1:${port}/${file}`});
    const result=await page.evaluate(async()=>{
      const STORE=GH_FLEET_STORE,DATA=GH_FLEET_DATA,FLEET=GH_FLEET_CORE,SIM=GH_SIMULATION_ASSET_CORE,DISPATCH=GH_FLEET_DISPATCH_CORE;
      const COUNT=1800,TARGETS=137,ROUTES=8,routes=[];
      for(let index=0;index<ROUTES;index++)routes.push({id:`WORKER-ROUTE-${index}`,type:'air',routeMode:'air',company:'air',ownerCompanyId:'air',name:`Route ${index}`,from:`Origin ${index}`,to:`Destination ${index}`,fromFacility:`BASE-${index}`,toFacility:`END-${index}`,route:[[-65+index*15,-165+index*7],[-61+index*15,-159+index*7]],distanceKm:700+index*23,maxLegKm:700+index*23,effectiveSpeedKmh:800-index,tripSeconds:3200+index*37,dwellHours:1.5,fleetCapacity:8192});
      const specs={capacity:186,capacityUnit:'passenger',speedKmh:845,rangeKm:7500,market:'air-pax',crewPlan:{pilots:10,cabin:16,aeng:4}},assets=[];
      for(let index=0;index<COUNT;index++){
        const route=routes[index%ROUTES],target=index<TARGETS,same=target&&index%3===0;
        assets.push({id:`WORKER-ASSET-${String(index).padStart(5,'0')}`,name:`Aircraft ${index}`,type:'air',assetMode:'air',assetClass:'aircraft',ownerCompanyId:'air',companyId:'air',catalogId:'CAT-AIR',baseFacility:route.fromFacility,phase:same||!target?'turnaround':'idle',progress:0,fuel:81,condition:94,routeId:same||!target?route.id:null,routeSlot:same?4000+Math.floor(index/ROUTES):!target?Math.floor(index/ROUTES):null,departureScheduled:false,releaseExclusiveRouteOnArrival:false,staffing:{mode:'automatic-fixed',ready:true,roles:[],total:8,monthlyPayroll:1},...(index%11?{specs:structuredClone(specs)}:{})});
      }
      const table=Object.fromEntries(routes.map((route,index)=>[`route-${index}`,route])),assignments=assets.slice(0,TARGETS).map((asset,index)=>({id:asset.id,routeId:routes[index%ROUTES].id,routeRef:`route-${index%ROUTES}`,baseFacility:routes[index%ROUTES].fromFacility,phase:'turnaround'}));
      const context={routesRevision:91,simSeconds:654321,catalogRevision:'catalog:test:v1',ownershipRevision:'ownership:test:v1',requestKey:'dispatch-worker:137'},input={assignments,routes:table,registeredRoutes:routes,catalogSpecs:{air:{'CAT-AIR':specs}},context};
      const build=()=>({fleet:STORE.fromAssets(structuredClone(assets),{at:context.simSeconds}),simSeconds:context.simSeconds,routesRevision:context.routesRevision,customRoutes:structuredClone(routes)}),state=build(),expected=build(),store=state.fleet;
      const client=GH_FLEET_ENGINE_THREAD.create({workerFactory:()=>new Worker('fleet-engine-worker.js'),resolveRoute:()=>null,routesRevision:()=>state.routesRevision,catalogSpecs:()=>input.catalogSpecs,timeoutMs:60000});
      const asked=client.dispatchPlan(store,{input,timeout:60000});if(!asked)throw new Error('dispatch-plan-refused');
      const busyWhilePlanning=client.busy&&client.dispatchPlan(store,{input})===null,found=await asked;
      if(!found||!client.current(found,store))throw new Error('dispatch-plan-missing-or-stale');
      const plan=found.plan,typed=plan.indices instanceof Int32Array&&plan.bytes instanceof ArrayBuffer&&plan.bytes.byteLength===TARGETS*STORE.STRIDE;
      const replica=await client.inspect(),mainRows=new Uint8Array(store.rows,0,store.length*STORE.STRIDE),workerRows=new Uint8Array(replica.rows);let replicaSame=mainRows.length===workerRows.length;
      for(let index=0;replicaSame&&index<mainRows.length;index++)if(mainRows[index]!==workerRows[index])replicaSame=false;
      replicaSame=replicaSame&&JSON.stringify(store.values)===JSON.stringify(replica.values)&&JSON.stringify(store.extras)===JSON.stringify(replica.extras)&&replica.replicaLogClean===true;

      // Historical path, unchanged, is the differential oracle.
      FLEET.assignRoutesBatch(expected,structuredClone(assignments),table);
      const drafts=assignments.map(row=>DATA.draft(expected,row.id));for(let index=0;index<drafts.length;index++)FLEET.normalizeAsset(drafts[index],{route:table[assignments[index].routeRef],catalogItem:{specs}});DATA.commit(expected,drafts);
      const views=assignments.map(row=>DATA.get(expected,row.id)),loads=SIM.loadLabels(views),departures=views.map((asset,index)=>({id:asset.id,routeRef:assignments[index].routeRef,load:loads[index],delaySeconds:FLEET.departureDelay(asset)}));FLEET.departBatch(expected,departures,table);

      const journal=STORE.beginJournal(store),stages=DISPATCH.applyStages(state,plan,input,{rowsPerStage:16});let next,yields=0;do{next=stages.next();if(!next.done)yields++;}while(!next.done);STORE.endJournal(journal);
      const a=STORE.exportReplica(store),b=STORE.exportReplica(expected.fleet),bytesEqual=(left,right)=>{const x=new Uint8Array(left),y=new Uint8Array(right);if(x.length!==y.length)return false;for(let index=0;index<x.length;index++)if(x[index]!==y[index])return false;return true;};
      const parity=a.revision===b.revision&&a.structure===b.structure&&a.length===b.length&&JSON.stringify(a.values)===JSON.stringify(b.values)&&JSON.stringify(a.extras)===JSON.stringify(b.extras)&&bytesEqual(a.rows,b.rows);

      // A completed plan becomes unusable after any fleet write and fails before touching a target row.
      const staleState=build(),staleAsked=client.dispatchPlan(staleState.fleet,{input});
      // The client is bound to one current store; bring the worker to the new store first if the direct request is refused.
      let staleFound=staleAsked&&await staleAsked;
      if(!staleFound){client.prime(staleState.fleet);for(let wait=0;wait<600&&!client.replicaReady(staleState.fleet);wait++)await new Promise(resolve=>setTimeout(resolve,50));if(!client.replicaReady(staleState.fleet))throw new Error('worker-replica-not-ready');const retry=client.dispatchPlan(staleState.fleet,{input});staleFound=retry&&await retry;}
      if(!staleFound)throw new Error('stale-plan-setup-failed');
      const staleBefore=STORE.readRows(staleState.fleet,staleFound.plan.indices),staleJournal=STORE.beginJournal(staleState.fleet);STORE.set(staleState.fleet,COUNT-1,'condition',71);let staleRejected=false;
      try{DISPATCH.applyStages(staleState,staleFound.plan,input).next();}catch(error){staleRejected=/fleet-dispatch-plan-stale:revision/.test(String(error?.message||error));}
      const staleAfter=STORE.readRows(staleState.fleet,staleFound.plan.indices),noTargetWrite=bytesEqual(staleBefore.bytes,staleAfter.bytes)&&JSON.stringify(staleBefore.extras)===JSON.stringify(staleAfter.extras);STORE.rollbackJournal(staleJournal);

      // Invalid planning is request-local; the same worker must answer a later valid plan.
      const invalidInput={...input,assignments:[assignments[0],assignments[0]],context:{...context,requestKey:'invalid-duplicate'}},invalidAsked=client.dispatchPlan(staleState.fleet,{input:invalidInput}),invalid=invalidAsked&&await invalidAsked;
      const recoveryAsked=client.dispatchPlan(staleState.fleet,{input}),recovery=recoveryAsked&&await recoveryAsked,statsOut=client.stats(),workerAlive=!client.disabled&&!!recovery;
      client.terminate('test-done');
      return {typed,replicaSame,parity,yields,busyWhilePlanning,staleRejected,noTargetWrite,invalid:invalid===null,workerAlive,planBytes:plan.bytes.byteLength,stats:statsOut};
    });
    assert.deepEqual(errors,[]);assert.equal(result.typed,true,'binary dispatch plan crossed the worker boundary');assert.equal(result.replicaSame,true,'speculative planning restored the worker replica');assert.equal(result.parity,true,'staged replay equals the former path byte for byte');assert.ok(result.yields>=20,'replay is split into bounded stages');assert.equal(result.busyWhilePlanning,true);assert.equal(result.staleRejected,true);assert.equal(result.noTargetWrite,true);assert.equal(result.invalid,true);assert.equal(result.workerAlive,true);
    console.log(JSON.stringify({suite:'build372-fleet-dispatch-worker-browser',planBytes:result.planBytes,yields:result.yields,workerMs:result.stats.lastDispatchWorkerMs,maxWorkerMs:result.stats.maxDispatchWorkerMs,requests:result.stats.dispatchPlanRequests}));
    console.log('BUILD372_FLEET_DISPATCH_WORKER_BROWSER_PASS');
  }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
