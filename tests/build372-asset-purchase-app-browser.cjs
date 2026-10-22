'use strict';

// The live app path must keep the commercial purchase independent from the
// number of bounded Fleet Store slices: 200,000 rows are 391 row stages, while
// finance and procurement publish one cheque/invoice/supplier transaction.
// It also proves the pre-write freshness gate and a late (>512 rows) rollback,
// including the speculative worker replica.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');
const root=path.resolve(__dirname,'..'),web=path.join(root,'WebApp'),read=file=>fs.readFileSync(path.join(web,file),'utf8');
const workerFile=read('fleet-engine-worker.js'),importLine=workerFile.match(/^importScripts\(([^)]*)\);$/m);
if(!importLine)throw new Error('fleet worker imports unavailable');
const workerImports=[...importLine[1].matchAll(/['"]([^'"]+)['"]/g)].map(match=>match[1]);
const workerSource=workerImports.map(read).join('\n;\n')+'\n;\n'+workerFile.replace(/^importScripts\([^)]*\);$/m,'');
// Each exchange slower than SLOW_MS, with the browser task that ran it: its wall and thread (CPU) time, and the V8 GC
// time inside the exchange, from a trace of the purchase (top-level tasks, user timing and GC only).
const SLOW_MS=4.5;
function attribute(trace,slow){
  const events=JSON.parse(fs.readFileSync(trace,'utf8')).traceEvents||[],open=new Map(),windows=[];
  for(const e of events){
    if(e.name!=='qa-fleet-sync')continue;const key=`${e.pid}:${e.tid}:${e.id2?.local??e.id2?.global??e.id}`;
    if(e.ph==='b')open.set(key,e);else if(e.ph==='e'&&open.has(key)){const b=open.get(key);open.delete(key);windows.push({pid:b.pid,tid:b.tid,ts:b.ts,end:e.ts});}
  }
  windows.sort((a,b)=>a.ts-b.ts);
  const tasks=events.filter(e=>e.ph==='X'&&e.name==='ThreadControllerImpl::RunTask'),gcs=events.filter(e=>e.ph==='X'&&(e.name==='MinorGC'||e.name==='MajorGC'));
  return slow.map((row,i)=>{
    const w=windows[i];if(!w)return {...row,traced:false};
    const task=tasks.filter(e=>e.pid===w.pid&&e.tid===w.tid&&e.ts<=w.ts&&e.ts+e.dur>=w.end).sort((a,b)=>a.dur-b.dur)[0];
    const gcMs=gcs.filter(e=>e.pid===w.pid&&e.tid===w.tid&&e.ts<w.end&&e.ts+e.dur>w.ts).reduce((sum,e)=>sum+Math.min(w.end,e.ts+e.dur)-Math.max(w.ts,e.ts),0)/1000;
    const taskCpuMs=Number.isFinite(task?.tdur)?task.tdur/1000:null;
    return {...row,traced:true,taskWallMs:task?task.dur/1000:null,taskCpuMs,gcMs,mainThreadMs:taskCpuMs===null?row.syncMs:Math.min(row.syncMs,taskCpuMs)};
  });
}

(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    const {page}=await boot({browser,errors,bypassCSP:true,viewport:{width:844,height:390},beforeScripts:{arg:workerSource,fn:source=>{
      const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
      globalThis.__GH_FLEET_ENGINE_WORKER_FACTORY__=()=>new Worker(url);
    }}});
    page.setDefaultTimeout(600000);
    const setup=await page.evaluate(async()=>{
      const a=__AUDIT__,s=__GH_STATE__,type='air';s.godMoney=true;s.infiniteMoney=true;
      await a.runAuthorizedDomainCommand('corporate','open-company',{type,companyId:type,capital:900000000,legalName:'QA Aggregate Purchase',formationContract:'QA-ASSET-PURCHASE'},{silent:true});
      const icao='OMDB',airport=GH_WORLD_DATA.airports.find(row=>row[0]===icao);
      await a.runAuthorizedDomainCommand('facilities','create',{facility:{id:'QA-OMDB',name:'QA OMDB',kind:'airport-base',company:type,ownerCompanyId:type,owned:true,sourceKey:'air:OMDB',code:airport[1]||icao,icao,iata:airport[1],city:airport[3]||'—',country:String(airport[5]||'—'),coords:[airport[6],airport[7]]},bucket:'globalBases'},{silent:true});
      // The browser product limit is 6,000 because its real persistence is one
      // localStorage string. This integration gate exercises the native-scale
      // command and worker lifecycle while other persistence tests own the
      // device acknowledgement path.
      const persistence=GH_PERSISTENCE;window.GH_PERSISTENCE=Object.freeze({...persistence,fleetRecordLimit:()=>1000000,commitDurableState:async()=>({ok:true,testHarness:true})});
      return {fleet:GH_FLEET_DATA.size(s),worker:Boolean(globalThis.__GH_FLEET_ENGINE_WORKER_FACTORY__)};
    });
    assert.deepEqual(setup,{fleet:0,worker:true});

    // A slow exchange is marked for the trace through the client's main-thread work hook (read at each call); the app
    // and the client run unchanged.
    // A full or seed sync of a small store runs at the start of an exchange, before its incremental part, whose time
    // then replaces lastSyncMs: an exchange in which the full or seed count moved is marked with that sync's time too.
    // The counts are read after every fleet stage, so a staged replica's completion (in a 'fleet.replica-slice' stage)
    // is never put on a later exchange.
    await page.evaluate(SLOW=>{
      const real=window.GH_DIAGNOSTICS,slow=window.__QA_SLOW_SYNCS__=[],seen=__AUDIT__.fleetEngineThreadClient()?.stats?.()||{},last={full:seen.fullSyncs||0,seed:seen.seedSyncs||0};
      window.GH_DIAGNOSTICS={...real,recordMainThreadWork(state,stage,start,end,...rest){
        const stats=String(stage).startsWith('fleet.')?__AUDIT__.fleetEngineThreadClient()?.stats?.():null;let ms=0,full=false;
        if(stats){if(stage==='fleet.sync'){ms=stats.lastSyncMs;if(stats.fullSyncs>last.full){ms=Math.max(ms,stats.maxFullSyncMs);full=true;}if(stats.seedSyncs>last.seed){ms=Math.max(ms,stats.maxSeedSyncMs);full=true;}}last.full=stats.fullSyncs;last.seed=stats.seedSyncs;}
        if(ms>SLOW){slow.push({syncMs:ms,full});try{performance.measure('qa-fleet-sync',{start,end});}catch{}}
        return real?.recordMainThreadWork?.(state,stage,start,end,...rest);
      }};
    },SLOW_MS);
    const trace=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'gh-build372-')),'purchase-trace.json');
    await browser.startTracing(null,{path:trace,categories:['toplevel','blink.user_timing','disabled-by-default-v8.gc']});
    const large=await page.evaluate(async()=>{
      const a=__AUDIT__,s=__GH_STATE__,model=GH_ASSET_CATALOG.air.used[0],before={fleet:GH_FLEET_DATA.size(s),cheques:s.finance.cheques.length,invoices:s.finance.invoices.length,supplier:s.supplierTransactions.length,deliveries:s.realism.procurement.deliveries.length,orders:s.realism.procurement.purchaseOrders?.length||0,proofs:Object.values(s.authorization.proofsById).filter(row=>row.action==='asset-purchase.authorize-order').length},options={},started=performance.now();
      const orderId=await a.buyAsset('air','used',model.id,'lease',200000,'QA-OMDB',true,'QA-200K','air',options),client=a.fleetEngineThreadClient(),after={fleet:GH_FLEET_DATA.size(s),cheques:s.finance.cheques.length,invoices:s.finance.invoices.length,supplier:s.supplierTransactions.length,deliveries:s.realism.procurement.deliveries.length,orders:s.realism.procurement.purchaseOrders?.length||0,proofs:Object.values(s.authorization.proofsById).filter(row=>row.action==='asset-purchase.authorize-order').length},audit=s.realism.procurement.purchaseOrders?.[0],receipt=s.realism.procurement.deliveries?.find(row=>row.purchaseOrderRef===audit?.requestRef),stats=client?.stats?.();
      return {orderId,options,before,after,elapsedMs:performance.now()-started,audit,receipt,stats};
    });
    await browser.stopTracing();
    let slow;try{slow=attribute(trace,await page.evaluate(()=>window.__QA_SLOW_SYNCS__));}finally{fs.rmSync(path.dirname(trace),{recursive:true,force:true});}
    assert.ok(large.orderId);assert.equal(large.after.fleet-large.before.fleet,200000);assert.equal(large.options.completedCount,200000);assert.equal(large.options.rowStageCount,391);assert.equal(large.options.chunkCount,391);
    for(const key of ['cheques','invoices','supplier','deliveries','orders','proofs'])assert.equal(large.after[key]-large.before[key],1,`${key} stays one per commercial order`);
    assert.equal(large.audit.totalCount,200000);assert.equal(large.audit.allocations.length,1);assert.equal(large.receipt.payment.ref,large.audit.paymentRef);assert.equal(large.receipt.payment.invoiceRef,large.audit.invoiceRef);assert.equal(large.receipt.purchaseOrderDigest,large.audit.orderDigest);assert.equal(large.receipt.authorizationProofId,large.audit.authorizationProofId);
    assert.equal(large.stats.mutationCommits,1);assert.equal(large.stats.mutationRollbacks||0,0);assert.equal(large.stats.fullSyncs,1);assert(large.stats.maxMutationRows<=512,`worker mutation slice exceeded 512 rows: ${large.stats.maxMutationRows}`);
    // Each incremental exchange keeps the 4.5 ms budget. Measured per exchange, its own work is 0.1-0.5 ms; the rare
    // sample above budget fell at a random exchange and in a random phase (once in code that does no work). Traced, such
    // a sample is the main thread off the CPU, not work: the slowest local one (4.9 ms, in a phase that only compares
    // lengths) ran in a task of 9.36 ms wall time and 2.02 ms thread time, with no GC inside it. Build 74 stopped on one
    // wall sample of 30.6 ms (60.6 and 33.7 ms before) on the shared macOS runner, where the worker, the compositor and
    // the test process compete for 3 cores. So the budget holds for 99% of the exchanges in wall time, and the owner's
    // 20 ms bound holds for each exchange's main-thread time: its wall time, or its task's thread time when that is
    // smaller. The thread time includes GC and all the task's other work, so it never understates the exchange; where
    // the browser reports no thread time the wall time stands. This is not a zero-jank claim.
    assert(large.stats.incrementalSyncs>=large.options.rowStageCount,`every row stage reached the worker: ${large.stats.incrementalSyncs}`);
    const mainThreadMs=Math.max(0,...slow.map(row=>row.mainThreadMs)),slowest=slow.reduce((best,row)=>row.syncMs>(best?.syncMs??-1)?row:best,null);
    console.log('PURCHASE_SYNC_BUDGET',JSON.stringify({maxSyncMs:large.stats.maxSyncMs,maxMainThreadMs:mainThreadMs,maxFullSyncMs:large.stats.maxFullSyncMs,maxSeedSyncMs:large.stats.maxSeedSyncMs,maxReplicaPrimeSliceMs:large.stats.maxReplicaPrimeSliceMs,slowSyncs:large.stats.slowSyncs,incrementalSyncs:large.stats.incrementalSyncs,maxMutationRows:large.stats.maxMutationRows}));
    console.log('PURCHASE_SYNC_SLOW',JSON.stringify(slow));
    assert(large.stats.slowSyncs<=Math.floor(large.stats.incrementalSyncs*0.01),`worker mutation syncs over the 4.5 ms budget: ${large.stats.slowSyncs} of ${large.stats.incrementalSyncs} (max ${large.stats.maxSyncMs})`);
    assert(slow.every(row=>row.traced),`every exchange over ${SLOW_MS} ms is in the trace: ${JSON.stringify(slow)}`);
    // A slowest exchange that was not marked (not an incremental, full or seed sync) keeps its wall time.
    const unmarked=large.stats.maxSyncMs>SLOW_MS&&slowest?.syncMs!==large.stats.maxSyncMs;
    assert(!unmarked||large.stats.maxSyncMs<20,`an unmarked exchange exceeded the owner 20 ms bound: ${large.stats.maxSyncMs} ${JSON.stringify(slowest)}`);
    // A full or seed sync, marked with its exchange, is held to the bound in main-thread time like the incremental ones
    // (the 33.7 ms above was its run's only full sync, with no replica slice: CI run 39338896838; read in wall time, it
    // fails both the unmarked-exchange check and this one). A staged replica's slices are not marked: their longest
    // keeps its wall time.
    const marked=ms=>ms>SLOW_MS?(slow.find(row=>row.full&&row.traced&&row.syncMs===ms)?.mainThreadMs??ms):ms;
    assert(Math.max(marked(large.stats.maxFullSyncMs),marked(large.stats.maxSeedSyncMs),large.stats.maxReplicaPrimeSliceMs||0)<20,`a full or seed sync slice exceeded the owner 20 ms bound: ${JSON.stringify({...large.stats,slow})}`);
    assert(mainThreadMs<20,`a worker mutation sync exceeded the owner 20 ms bound in main-thread time: ${JSON.stringify(slow)}`);

    const stale=await page.evaluate(async()=>{
      const a=__AUDIT__,s=__GH_STATE__,client=a.fleetEngineThreadClient(),model=GH_ASSET_CATALOG.air.used[0],first=GH_FLEET_DATA.get(s,'N-AIR-00000001'),condition=Number(first.condition),documents=()=>({fleet:GH_FLEET_DATA.size(s),cheques:s.finance.cheques.length,invoices:s.finance.invoices.length,supplier:s.supplierTransactions.length,deliveries:s.realism.procurement.deliveries.length,orders:s.realism.procurement.purchaseOrders.length,proofs:Object.keys(s.authorization.proofsById).length,sequences:JSON.stringify(s.sequences)}),before=documents(),original=client.beginMutation;let injected=0;
      client.beginMutation=function(store,options){injected++;GH_FLEET_STORE.set(store,0,'condition',condition===73?72:73);return original.call(this,store,options);};
      const options={};let orderId;try{orderId=await a.buyAsset('air','used',model.id,'lease',512,'QA-OMDB',true,'QA-STALE','air',options);}finally{client.beginMutation=original;}
      return {orderId,error:options.errorMessage,injected,before,after:documents(),conditionBefore:condition,conditionAfter:GH_FLEET_DATA.get(s,'N-AIR-00000001').condition,stats:client.stats()};
    });
    assert.equal(stale.orderId,null);assert.equal(stale.injected,1);assert.deepEqual(stale.after,stale.before,'stale order reached no finance, proof, sequence, document, or fleet-size mutation');assert.notEqual(stale.conditionAfter,stale.conditionBefore,'the external write used to stale the plan remains outside its rollback');assert.equal(stale.stats.mutationRollbacks,1);

    const rollback=await page.evaluate(async()=>{
      const a=__AUDIT__,s=__GH_STATE__,client=a.fleetEngineThreadClient(),model=GH_ASSET_CATALOG.air.used[0],digest=value=>GH_AUTHORIZATION.digest(value),logical=()=>({fleet:GH_FLEET_DATA.size(s),first:GH_FLEET_DATA.get(s,'N-AIR-00000001'),last:GH_FLEET_DATA.get(s,'N-AIR-00200000'),business:digest({finance:s.finance,supplierTransactions:s.supplierTransactions,procurement:s.realism.procurement,labor:s.advanced?.labor,crew:s.crew,sequences:s.sequences,groupValue:s.groupValue,authorization:s.authorization,idempotency:s.domainIdempotency||s.idempotency||null}),saveRevision:s.saveRevision}),before=logical(),revisionBefore=GH_FLEET_DATA.revision(s),structureBefore=s.fleet.structure,original=client.flushMutation;let failedAt=0;
      client.flushMutation=function(session,store){const added=store.length-before.fleet;if(added>512){failedAt=added;return false;}return original.call(this,session,store);};
      const options={};let orderId;try{orderId=await a.buyAsset('air','used',model.id,'lease',1200,'QA-OMDB',true,'QA-LATE-ROLLBACK','air',options);}finally{client.flushMutation=original;}
      let found=null;for(let attempt=0;attempt<100&&!found;attempt++){const asked=client.query(s.fleet,{name:'purchaseBaseline',params:{plan:null,legacyOwner:{}},simSeconds:s.simSeconds});if(asked)found=await asked;else await new Promise(resolve=>setTimeout(resolve,5));}
      return {orderId,error:options.errorMessage,failedAt,before,after:logical(),revisionBefore,revisionAfter:GH_FLEET_DATA.revision(s),structureBefore,structureAfter:s.fleet.structure,replicaCurrent:Boolean(found&&client.current(found,s.fleet)),replicaFleetSize:found?.result?.fleetSize,stats:client.stats()};
    });
    assert.equal(rollback.orderId,null);assert(rollback.failedAt>512,`failure did not occur after the first row stage: ${rollback.failedAt}`);assert.deepEqual(rollback.after,rollback.before,'late failure rolls back fleet, finance, proofs, documents, labor, crew, sequences and save revision');assert(rollback.revisionAfter>rollback.revisionBefore&&rollback.structureAfter>rollback.structureBefore,'rollback invalidates stale Store readers with monotonic tokens');assert.equal(rollback.replicaCurrent,true);assert.equal(rollback.replicaFleetSize,200000);assert.equal(rollback.stats.mutationRollbacks,2);assert.equal(rollback.stats.mutationCommits,1);assert.equal(rollback.stats.fullSyncs,1,'rollback did not repair the worker with a full copy');
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({suite:'build372-asset-purchase-app-browser',ok:true,count:large.options.completedCount,rowStages:large.options.rowStageCount,documents:{cheques:1,invoices:1,supplierTransactions:1,purchaseOrders:1},maxMutationRows:large.stats.maxMutationRows,maxSyncMs:large.stats.maxSyncMs,slowSyncs:large.stats.slowSyncs,incrementalSyncs:large.stats.incrementalSyncs,staleRejected:true,rollbackAfterRows:rollback.failedAt,workerReplicaCurrent:rollback.replicaCurrent}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
