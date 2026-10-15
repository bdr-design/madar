'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{chromium,webkit}=require('playwright');
const web=path.resolve(__dirname,'../WebApp'),read=file=>fs.readFileSync(path.join(web,file),'utf8');
const workerSource=read('fleet-store-core.js')+'\n;\n'+read('fleet-engine-worker.js').replace(/^importScripts\([^)]*\);$/m,'');
(async()=>{for(const engine of [chromium,webkit]){
 const browser=await engine.launch({headless:true,...(engine===webkit?{executablePath:webkit.executablePath()}:{})});
 try{const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));await page.addScriptTag({content:read('fleet-store-core.js')});await page.addScriptTag({content:read('fleet-engine-thread.js')});
 const result=await page.evaluate(async workerSource=>{
  const S=GH_FLEET_STORE,url=URL.createObjectURL(new Blob([workerSource],{type:'text/javascript'})),messages=[],spans=[];
  const make=prefix=>{const store=S.create(8000);for(let i=0;i<8000;i++)S.add(store,{id:prefix+'-'+i,type:'air',ownerCompanyId:'air',phase:'idle',condition:90,...(i%100===0?{note:{i,prefix}}:{})});for(let i=0;i<10000;i++)S.intern(store,{document:i,description:prefix+' '+String(i)+'x'.repeat(160)});const chunkBytes=1048576,byteLength=store.length*S.STRIDE,chunks=[];for(let at=0;at<byteLength;at+=chunkBytes)chunks.push(store.rows.slice(at,Math.min(byteLength,at+chunkBytes)));if(!S.setReplicaSeed(store,{chunks,chunkBytes,byteLength}))throw new Error('seed-refused');return {store,chunks};};
  const factory=()=>{const worker=new Worker(url),post=worker.postMessage.bind(worker);worker.postMessage=(message,transfer)=>{messages.push({type:message.type,kind:message.kind,values:message.values?.length,extras:message.entries?.length,streamMetadata:message.streamMetadata,seedValues:Object.hasOwn(message,'values'),seedExtras:Object.hasOwn(message,'extras')});post(message,transfer);};return worker;};
  const client=GH_FLEET_ENGINE_THREAD.create({workerFactory:factory,resolveRoute:()=>null,catalogSpecs:()=>({}),onMainThreadWork:(stage,start,end)=>spans.push({stage,ms:end-start}),replicaValueSlice:512,replicaExtraSlice:32,replicaBudgetMs:2,timeoutMs:30000});
  const until=async test=>{for(let i=0;i<15000&&!test();i++)await new Promise(resolve=>setTimeout(resolve,2));if(!test())throw new Error('timeout:'+JSON.stringify(client.stats()));};
  const equal=async store=>{const replica=await client.inspect();if(!replica)throw new Error('missing');const a=new Uint8Array(store.rows,0,store.length*S.STRIDE),b=new Uint8Array(replica.rows);if(a.length!==b.length||a.some((v,i)=>v!==b[i]))throw new Error('rows-differ');if(JSON.stringify(store.values.map(v=>v===undefined?null:v))!==JSON.stringify(replica.values))throw new Error('values-differ');if(JSON.stringify(store.extras)!==JSON.stringify(replica.extras))throw new Error('extras-differ');if(replica.length!==store.length||replica.live!==store.live||replica.structure!==store.structure||!replica.replicaLogClean)throw new Error('meta-differ');};
  let {store,chunks}=make('SEED-A');const returned=client.prime(store),immediate=client.stats();if(returned!==false||!immediate.replicaPriming||immediate.seedMetadataSlices!==0||immediate.seedSyncs!==0)throw new Error('metadata-was-synchronous');if(!chunks.every(c=>c.byteLength===0))throw new Error('row-buffers-not-transferred');
  // Writes after the immutable seed snapshot, including after streaming starts, must reach the replica before reads.
  S.set(store,12,'condition',31);S.set(store,100,'note',{changed:true});S.intern(store,{late:'before-first-slice'});
  await until(()=>client.stats().seedMetadataSlices>0);if(client.replicaReady(store))throw new Error('partial-seed-visible');S.set(store,13,'condition',32);S.intern(store,{late:'between-slices'});
  await until(()=>{client.prime(store);return client.replicaReady(store);});await equal(store);const first=client.stats();
  if(first.seedSyncs!==1||first.seedMetadataSlices<2||first.fullSyncs!==0)throw new Error('wrong-first-stats');
  // Replacing the store while seed metadata is incomplete abandons the old candidate.
  const old=make('SEED-B');client.prime(old.store);const next=make('SEED-C');store=next.store;client.prime(store);await until(()=>{client.prime(store);return client.replicaReady(store);});await equal(store);
  // A failed worker cannot publish a partial replica, and terminate releases its waiter.
  const cancelled=make('SEED-D');client.prime(cancelled.store);const idle=client.idle();client.terminate('cancelled');await idle;if(client.replicaReady(cancelled.store))throw new Error('cancelled-seed-visible');
  URL.revokeObjectURL(url);return {messages:messages.length,maxValues:Math.max(...messages.filter(m=>m.kind==='values').map(m=>m.values)),maxExtras:Math.max(...messages.filter(m=>m.kind==='extras').map(m=>m.extras)),seedMessages:messages.filter(m=>m.type==='seed'),first:{slices:first.seedMetadataSlices,maxSliceMs:first.maxReplicaPrimeSliceMs},mainSpans:spans.length};
 },workerSource);
 assert.deepEqual(errors,[]);assert.ok(result.seedMessages.length>=4);assert.ok(result.seedMessages.every(m=>m.streamMetadata===true&&!m.seedValues&&!m.seedExtras));assert.ok(result.maxValues<=512&&result.maxExtras<=32);console.log(JSON.stringify({suite:'build376-seed-metadata-browser',ok:true,engine:engine.name(),...result}));
 }finally{await browser.close();}
}})().catch(error=>{console.error(error);process.exitCode=1;});
