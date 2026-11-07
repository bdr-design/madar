'use strict';
// The real fleet worker must load the daily core itself, return its typed plan
// through structured cloning, and keep the simulation worker alive when one
// optional query is invalid.  This uses the actual worker URL/importScripts,
// rather than concatenating its dependencies into a test-only blob.
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
  const port=server.address().port,browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(String(error)));
    await page.goto(`http://127.0.0.1:${port}/`);
    for(const file of ['fleet-store-core.js','fleet-access-core.js','fleet-day-core.js','fleet-query-core.js','fleet-engine-thread.js'])await page.addScriptTag({url:`http://127.0.0.1:${port}/${file}`});
    const result=await page.evaluate(async()=>{
      const STORE=GH_FLEET_STORE,DATA=GH_FLEET_DATA,Q=GH_FLEET_QUERY;
      const assets=Array.from({length:5000},(_,index)=>({
        id:`REAL-DAY-${String(index).padStart(5,'0')}`,ownerCompanyId:index%7?'air':'road',assetMode:index%7?'air':'road',type:index%7?'air':'road',ownership:index%5?'owned':'lease',purchasePrice:45000000+index,monthlyLease:300000,leaseTermMonths:72,condition:55+(index%46),phase:index%3?'turnaround':'moving',flightHours:index%700,flightCycles:index%200,nextCheckHours:600,specs:{capacity:180,capacityUnit:'مقعد'},lastTrip:{distanceKm:900+(index%300),revenue:70000,fuelCost:12000,crewCost:5000,maintReserve:2500},staffing:{mode:'automatic-fixed',ready:true,total:8,monthlyPayroll:90000}
      }));
      assets[3].flightHours=Math.fround(.1);assets[4].flightCycles=.1;assets[6].nextCheckHours=Infinity;
      const state={fleet:STORE.fromAssets(assets,{at:86400}),simSeconds:86400,realism:{economy:{airDemand:113,bunker:null}}},store=state.fleet;
      const params={simSeconds:state.simSeconds,ownerResolution:{platform:true,knownCompanies:[],legacyOwners:[['air','air'],['road','road']]},maintenancePolicies:[['air','preventive'],['road','standard']],airDemand:113,bunker:null};
      const client=GH_FLEET_ENGINE_THREAD.create({workerFactory:()=>new Worker('fleet-engine-worker.js'),resolveRoute:()=>null,routesRevision:()=>0,catalogSpecs:()=>({}),timeoutMs:60000});
      // 5,000 rows exceed the synchronous replica limit (2,048): the replica is streamed in frame slices and the worker
      // then names its route pairs. A fixed sleep raced that on slower runners (query() returned null); wait for the
      // exact replica instead, bounded so a replica that never becomes ready still fails the gate.
      const readyBy=performance.now()+30000;client.prime(store);
      while(!client.replicaReady(store)){if(performance.now()>readyBy)throw new Error(`replica not ready: ${JSON.stringify(client.stats())}`);await new Promise(resolve=>setTimeout(resolve,10));client.prime(store);}
      const asked=client.query(store,{name:'fleetDay',params,simSeconds:state.simSeconds}),found=asked&&await asked;
      const expected=Q.run('fleetDay',state,DATA,params),actualPlan=found?.result?.columns,expectedPlan=expected.columns,exceptionValues=actualPlan?.exceptional?.values,expectedExceptionValues=expectedPlan.exceptional.values;
      const same=found&&JSON.stringify(found.result)===JSON.stringify(expected)&&exceptionValues.length===expectedExceptionValues.length&&Array.from(exceptionValues,(value,index)=>Object.is(value,expectedExceptionValues[index])).every(Boolean);
      const typed=actualPlan?.rejectNaN===true&&actualPlan?.indices instanceof Int32Array&&actualPlan?.values instanceof Float32Array&&actualPlan?.exceptional?.indices instanceof Int32Array&&exceptionValues instanceof Float64Array&&actualPlan.indices.buffer===actualPlan.exceptional.indices.buffer&&actualPlan.values.buffer===exceptionValues.buffer&&actualPlan.exceptional.count>0&&exceptionValues.some(value=>value===Infinity);
      const lateAsked=client.query(store,{name:'fleetDay',params,simSeconds:state.simSeconds});STORE.set(store,10,'condition',91);const late=lateAsked&&await lateAsked,stale=!client.current(late,store);
      // A bad optional query is local to that request.  It must not terminate
      // the event engine or make later health/day queries fall back forever.
      const invalidAsked=client.query(store,{name:'does-not-exist',params:{},simSeconds:state.simSeconds}),invalid=invalidAsked&&await invalidAsked;
      const recoveryAsked=client.query(store,{name:'conditionSum',params:{},simSeconds:state.simSeconds}),recovery=recoveryAsked&&await recoveryAsked;
      const out={same,typed,current:client.current(found,store)===false,stale,invalid:invalid===null,recovered:!!recovery&&!client.disabled,disabled:client.disabled,stats:client.stats()};client.terminate('test-done');return out;
    });
    assert.deepEqual(errors,[]);assert.equal(result.same,true,'real worker daily result matches the shared main implementation');assert.equal(result.typed,true,'typed buffers survive the real worker boundary');
    assert.equal(result.current,true,'the first result becomes stale after the deliberate write');assert.equal(result.stale,true);assert.equal(result.invalid,true,'unknown optional query is declined');assert.equal(result.recovered,true,'worker serves a later query');assert.equal(result.disabled,null);
    console.log(JSON.stringify({suite:'build372-fleet-day-worker-browser',same:result.same,typed:result.typed,stale:result.stale,queryRequests:result.stats.queryRequests,maxQueryWorkerMs:result.stats.maxQueryWorkerMs}));
    console.log('BUILD372_FLEET_DAY_WORKER_BROWSER_PASS');
  }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
