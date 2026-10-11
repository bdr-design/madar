'use strict';
// A large store without a vault seed must not call the synchronous whole-store export from prime(). Records, interned
// values and sparse extras cross to the real worker in bounded frame slices. A write during those slices invalidates the
// candidate; only a restarted, exact snapshot may become replicaReady.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),web=path.join(root,'WebApp'),read=file=>fs.readFileSync(path.join(web,file),'utf8');
const workerSource=read('fleet-store-core.js')+'\n;\n'+read('fleet-engine-worker.js').replace(/^importScripts\([^)]*\);$/m,'');

(async()=>{
  const executablePath=['/usr/bin/chromium','/usr/bin/chromium-browser'].find(file=>fs.existsSync(file));
  const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
  try{
    const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(String(error)));
    await page.setContent('<!doctype html><meta charset="utf-8">');await page.addScriptTag({content:read('fleet-store-core.js')});
    // Bind the thread to an instrumented Store facade. Any regression to exportReplica for a large store fails at the
    // call site, in addition to the before-first-frame assertions below.
    await page.evaluate(()=>{const store=GH_FLEET_STORE;window.__STAGED_EXPORTS__=[];window.GH_FLEET_STORE=new Proxy(store,{get(target,key){if(key==='exportReplica')return value=>{window.__STAGED_EXPORTS__.push(value?.length);if(value?.length>2048)throw new Error('large-exportReplica-forbidden');return target.exportReplica(value);};return target[key];}});});
    await page.addScriptTag({content:read('fleet-engine-thread.js')});
    const result=await page.evaluate(async({workerSource})=>{
      const STORE=GH_FLEET_STORE,url=URL.createObjectURL(new Blob([workerSource],{type:'text/javascript'}));
      const makeStore=(prefix,count)=>{
        const store=STORE.create(count);for(let index=0;index<count;index++)STORE.add(store,{id:`${prefix}-${String(index).padStart(7,'0')}`,name:`${prefix} aircraft ${index}`,type:'air',assetMode:'air',ownerCompanyId:'air',phase:'idle',condition:80+index%20,...(index%997===0?{note:{prefix,index}}:{})});
        // Exercise the value-table stage independently of row compression (ids/names with numeric suffixes share a
        // pattern ref in the real Store).
        for(let index=0;index<4096;index++)STORE.intern(store,{prime:prefix,index});return store;
      };
      const client=GH_FLEET_ENGINE_THREAD.create({workerFactory:()=>new Worker(url),resolveRoute:()=>null,routesRevision:()=>0,catalogSpecs:()=>({}),timeoutMs:60000,replicaRowSlice:256,replicaValueSlice:64,replicaExtraSlice:32,replicaBudgetMs:1});
      const until=async(test,label)=>{for(let guard=0;guard<30000&&!test();guard++)await new Promise(resolve=>setTimeout(resolve,2));if(!test())throw new Error(`timeout:${label}:${JSON.stringify(client.stats())}`);};
      const equal=async(store,label)=>{
        const replica=await client.inspect();if(!replica)throw new Error(`${label}:inspect-missing`);
        const left=new Uint8Array(store.rows,0,store.length*STORE.STRIDE),right=new Uint8Array(replica.rows);let mismatch=-1;if(left.length!==right.length)mismatch=-2;else for(let index=0;index<left.length;index++)if(left[index]!==right[index]){mismatch=index;break;}
        if(mismatch!==-1)throw new Error(`${label}:rows:${mismatch}`);
        if(JSON.stringify(store.values.map(value=>value===undefined?null:value))!==JSON.stringify(replica.values))throw new Error(`${label}:values`);
        if(JSON.stringify(store.extras)!==JSON.stringify(replica.extras))throw new Error(`${label}:extras`);
        if(store.length!==replica.length||store.live!==replica.live||store.structure!==replica.structure||replica.replicaLogClean!==true)throw new Error(`${label}:meta`);
      };

      let store=makeStore('PRIME-A',12000),before=client.stats(),returned=client.prime(store),immediate=client.stats();
      if(returned!==false||!immediate.replicaPriming||immediate.fullSyncs!==0||immediate.replicaPrimeSlices!==0)throw new Error(`synchronous-prime:${JSON.stringify({returned,before,immediate})}`);
      if(!STORE.replicaClean(store))throw new Error('baseline-log-was-enumerated-instead-of-reset');
      await new Promise(resolve=>requestAnimationFrame(resolve));const firstFrame=client.stats();
      if(firstFrame.replicaPrimeSlices<1||firstFrame.fullSyncs!==0||!firstFrame.replicaPriming)throw new Error(`not-sliced:${JSON.stringify(firstFrame)}`);
      await until(()=>client.replicaReady(store),'first-ready');await equal(store,'first');const firstDone=client.stats();
      if(firstDone.fullSyncs!==1||firstDone.replicaPrimeSlices<2||firstDone.replicaPrimeRows<store.length||!(firstDone.maxReplicaPrimeSliceMs>=0))throw new Error(`first-stats:${JSON.stringify(firstDone)}`);

      store=makeStore('PRIME-B',12500);const slices=client.stats().replicaPrimeSlices;if(client.prime(store)!==false)throw new Error('replacement-prime-was-synchronous');
      await until(()=>client.stats().replicaPrimeSlices>slices,'replacement-started');
      // This changes a row, appends an interned value and replaces sparse extras while the candidate is paused.
      STORE.set(store,777,'condition',17);STORE.set(store,778,'registration','PRIME-B-FRESH');STORE.set(store,997,'note',{changed:true,at:997});
      await until(()=>client.stats().replicaPrimeRestarts>=1,'stale-restarted');
      if(client.replicaReady(store))throw new Error('stale-candidate-became-ready');
      await until(()=>client.replicaReady(store),'replacement-ready');await equal(store,'replacement');const final=client.stats();
      client.terminate('test-complete');URL.revokeObjectURL(url);
      return {exports:[...window.__STAGED_EXPORTS__],immediate:{fullSyncs:immediate.fullSyncs,slices:immediate.replicaPrimeSlices,priming:immediate.replicaPriming},firstFrame:{slices:firstFrame.replicaPrimeSlices,priming:firstFrame.replicaPriming},final:{fullSyncs:final.fullSyncs,slices:final.replicaPrimeSlices,restarts:final.replicaPrimeRestarts,failures:final.replicaPrimeFailures,rows:final.replicaPrimeRows,values:final.replicaPrimeValues,extras:final.replicaPrimeExtras,maxSliceMs:final.maxReplicaPrimeSliceMs,reasons:final.fullSyncReasons}};
    },{workerSource});
    assert.deepEqual(errors,[]);assert.deepEqual(result.exports,[],'large staged primes never call exportReplica');assert.equal(result.immediate.fullSyncs,0);assert.equal(result.immediate.slices,0);assert.equal(result.immediate.priming,true);assert.ok(result.firstFrame.slices>=1);assert.equal(result.final.fullSyncs,2);assert.ok(result.final.restarts>=1);assert.equal(result.final.failures,0);assert.ok(result.final.slices>2);console.log(JSON.stringify({ok:true,...result}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
