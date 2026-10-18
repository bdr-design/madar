'use strict';
// A real same-origin worker, on both WebView engines. GH_GC_ROWS=1000000
// enables the bounded scale probe without making every source gate a soak.
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path'),{chromium,webkit}=require('playwright');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..'),WEB=path.join(ROOT,'WebApp'),ROWS=Number(process.env.GH_GC_ROWS||65539),results=[];
const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://127.0.0.1').pathname,file=path.resolve(WEB,'.'+name);if(name==='/'){res.writeHead(200,{'content-type':'text/html'});res.end('<!doctype html><meta charset="utf-8">');return;}if(!file.startsWith(WEB+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}res.writeHead(200,{'content-type':'text/javascript'});res.end(fs.readFileSync(file));});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 for(const engine of [chromium,webkit]){
  const browser=await engine.launch({headless:true});try{
   const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));await page.goto('http://127.0.0.1:'+server.address().port+'/');
   for(const file of ['fleet-store-core.js','fleet-access-core.js','fleet-query-core.js','fleet-engine-thread.js'])await page.addScriptTag({url:'/'+file});
   const result=await page.evaluate(async count=>{
    const S=GH_FLEET_STORE,F=GH_FLEET_DATA,state={fleet:S.create(count),simSeconds:86400},store=state.fleet;
    for(let i=0;i<count;i++)S.add(store,{id:'WORKERGC-'+i,name:'Worker GC '+i,type:['air','sea','road'][i%3],ownerCompanyId:['air','sea','road'][i%3],phase:'idle',routeId:null,condition:95,fuel:80,progress:0});
    for(let i=0;i<4096;i++)S.intern(store,{orphan:i});
    const expected=S.planValueCollection(store),valuesBefore=store.values.slice(),client=GH_FLEET_ENGINE_THREAD.create({workerFactory:()=>new Worker('fleet-engine-worker.js'),resolveRoute:()=>null,routesRevision:()=>0,catalogSpecs:()=>({}),timeoutMs:60000});
    const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve)),readyBy=performance.now()+120000;client.prime(store);
    while(!client.replicaReady(store)){if(performance.now()>readyBy)throw Error('replica readiness timeout');await frame();client.prime(store);}
    let queryCount=0;globalThis.GH_FLEET_QUERY_PROVIDER=(s,name,params)=>{queryCount++;const asked=client.query(s.fleet,{name,params,simSeconds:s.simSeconds});return asked&&asked.then(found=>found?{result:found.result,current:()=>client.current(found,s.fleet)}:null);};
    const it=F.maintainStages(state,1),at=performance.now(),stages=[];let step,maxMainMs=0;
    do{const start=performance.now();step=it.next();maxMainMs=Math.max(maxMainMs,performance.now()-start);if(!step.done){stages.push(step.value.stage);await frame();}}while(!step.done);
    const elapsedMs=performance.now()-at,freed=step.value.values.freed;
    if(step.value.values.deferred)throw Error('unexpected deferred GC '+JSON.stringify(step.value));
    const wanted=new Set(expected.indices);let exact=true;for(let ref=0;ref<store.values.length;ref++)if(store.values[ref]!== (wanted.has(ref)?null:valuesBefore[ref]))exact=false;
    // Synchronizing the reclaimed refs must leave an exact worker value table:
    // its next mark finds no extra orphan, and free refs can be reused safely.
    const again=await client.query(store,{name:'valueCollection'}),noDuplicateFree=again?.result?.columns?.indices?.length===0;
    for(let i=0;i<20;i++)S.intern(store,{reuse:i});const late=await client.query(store,{name:'valueCollection'}),lateExpected=S.planValueCollection(store);
    const reusedParity=JSON.stringify([...late.result.columns.indices])===JSON.stringify([...lateExpected.indices]);
    const stats=client.stats();client.terminate('test-done');return {rows:count,freed,expected:expected.indices.length,exact,noDuplicateFree,reusedParity,queryCount,mainMarkSlices:stages.filter(s=>s==='mark').length,waitFrames:stages.filter(s=>s==='values-wait').length,maxMainMs,elapsedMs,maxQueryWorkerMs:stats.maxQueryWorkerMs};
   },ROWS);
   assert.deepEqual(errors,[]);assert.equal(result.exact,true);assert.equal(result.freed,result.expected);assert.equal(result.noDuplicateFree,true);assert.equal(result.reusedParity,true);assert.equal(result.queryCount,1);assert.equal(result.mainMarkSlices,0);results.push({engine:engine.name(),...result});
  }finally{await browser.close();}
 }
 console.log(JSON.stringify({suite:'build429-worker-value-collection-browser',ok:true,results}));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());
