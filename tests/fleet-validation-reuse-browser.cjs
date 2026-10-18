'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
const {chromium,webkit}=require('playwright'),{boot}=require('./helpers/local-dom-app');
const {serve}=require('./helpers/web-server');
(async()=>{
 const server=await serve(path.resolve(__dirname,'../WebApp'));try{
 for(const engine of [chromium,webkit]){const browser=await engine.launch({headless:true}),errors=[];try{
  // Use the bundled HTTP worker and its real imports under the application's worker-src 'self' CSP.
  const bootBrowser={newPage:async options=>{const p=await browser.newPage(options),url=server.baseURL+'/__qa_worker_origin__';await p.route(url,r=>r.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8">'}));await p.goto(url);return p;}};
  const {page}=await boot({browser:bootBrowser,errors,fleetWorker:true,beforeScripts:{fn:origin=>{globalThis.__GH_FLEET_ENGINE_WORKER_FACTORY__=()=>new Worker(origin+'/fleet-engine-worker.js');globalThis.__GH_SAVE_CHECKSUM_WORKER_FACTORY__=()=>new Worker(origin+'/save-checksum-worker.js');},arg:server.baseURL}});page.setDefaultTimeout(90000);
  await page.evaluate(async()=>{
   const a=__AUDIT__,s=__GH_STATE__;s.godMoney=true;s.infiniteMoney=true;
   await a.runAuthorizedDomainCommand('corporate','open-company',{type:'air',companyId:'air',capital:900000000,legalName:'QA Validation Reuse',formationContract:'QA-REUSE'},{silent:true});
   const r=GH_WORLD_DATA.airports.find(x=>x[0]==='OMDB');
   await a.runAuthorizedDomainCommand('facilities','create',{facility:{id:'QA-REUSE-BASE',name:'QA Reuse Base',kind:'airport-base',company:'air',ownerCompanyId:'air',owned:true,sourceKey:'air:OMDB',code:r[1]||'OMDB',icao:'OMDB',iata:r[1],city:r[3]||'—',country:String(r[5]||'—'),coords:[r[6],r[7]]},bucket:'globalBases'},{silent:true});
   // Each new lane is 8 bytes/row. Exceed the unchanged 32 KiB
   // worker-encoding threshold so the fallback assertion exercises real work.
   await a.buyAsset('air','used',GH_ASSET_CATALOG.air.used[0].id,'lease',4400,'QA-REUSE-BASE',true,'QA-REUSE-BUY','air');
  });
  const result=await page.evaluate(async()=>{
   const s=__GH_STATE__,S=GH_FLEET_STORE,store=s.fleet,provider=GH_FLEET_VALIDATION_PROVIDER;
   const previous=__AUDIT__.fleetEngineThreadClient();previous?.terminate('reuse-test-replacement');
   const workerErrors=[],client=GH_FLEET_ENGINE_THREAD.create({workerFactory:()=>{const worker=__GH_FLEET_ENGINE_WORKER_FACTORY__();worker.addEventListener('error',event=>workerErrors.push({message:event.message,file:event.filename,line:event.lineno}));return worker;},resolveRoute:()=>null,routesRevision:()=>0,catalogSpecs:()=>({}),timeoutMs:60000});
   let requests=0;const facade=new Proxy(client,{get(target,key){if(key==='query')return(...args)=>{if(args[1].name==='saveValidation')requests++;return target.query(...args);};return target[key];}});
   __AUDIT__.setFleetEngineThreadClient(facade);client.prime(store);
   for(let i=0;i<6000&&!client.replicaReady(store)&&!client.disabled;i++)await new Promise(r=>setTimeout(r,5));if(!client.replicaReady(store))throw new Error('test-replica-not-ready:'+JSON.stringify({stats:client.stats(),workerErrors}));
   const params={...GH_SAVE_SCHEMA.fleetValidationParams(s),companyReferenceCompanies:[...GH_SAVE_SCHEMA.fleetValidationParams(s).companyReferenceCompanies,'QAReuse']},same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),check=(v,message)=>{if(!v)throw new Error(message);};
   S.set(store,0,'fuel',98);
   let before=requests;const parallel=await Promise.all(Array.from({length:6},()=>provider(s,params)));check(requests-before===1,'concurrent identical checks must share one worker pass');check(parallel.every(x=>x?.current()&&same(x.result,parallel[0].result)),'concurrent results remain current and identical');
   const baseline=parallel[0].result;before=requests;for(let i=0;i<6;i++){const found=await provider(s,params);check(found.current()&&same(found.result,baseline),'reused result differs');}check(requests===before,'unchanged checks cannot rescan the fleet');check(provider(s,params,{syncOnly:true})?.current(),'synchronous save receives the same current evidence');
   const context={...params,registryCompanies:[],companyReferenceCompanies:[],definitionCompanies:[]};before=requests;const foreign=await provider(s,context);check(requests===before+1,'registry changes invalidate the cached context');check(foreign.result.companyPlatform.errors.length>0,'registry errors are not hidden by a cache');
   const changedRoutes={...params,routeIds:[...params.routeIds,'QA-UNUSED'],routes:[...params.routes,['QA-UNUSED','air','air',24]]};before=requests;const routes=await provider(s,changedRoutes);check(requests===before+1,'route context changes invalidate the cache');check(routes.result.contextToken!==baseline.contextToken,'route context retained');
   S.set(store,1,'fuel',151);check(provider(s,changedRoutes,{syncOnly:true})===null,'stale evidence cannot satisfy an ordinary save');before=requests;const invalid=await provider(s,params);check(requests===before+1,'a fleet write invalidates the evidence');check(invalid.result.errors.includes('asset-fuel'),'the new fault is detected');
   S.set(store,1,'fuel',100);const waiting=provider(s,params);S.set(store,2,'condition',150);const stale=await waiting;check(!stale.current(),'a write while the worker runs invalidates its answer');const final=await provider(s,params);check(final.current()&&final.result.errors.includes('asset-condition'),'a new query sees the new state');
   S.set(store,2,'condition',90);const restored=await provider(s,params);check(restored.current()&&restored.result.errors.length===0,'restored fleet validates');
   const profileRef=S.slot(store,'profile',0),profile=S.value(store,profileRef),rowRevision=store.revision;
   S.applyValueChanges(store,{length:store.values.length,changes:[[profileRef,{...profile,model:'<unsafe-shared-profile>'}]]});
   check(store.revision===rowRevision,'the fixture changes only an interned value');
   check(provider(s,params,{syncOnly:true})===null,'a value-only change must expire cached worker evidence');
   const valueChanged=await provider(s,params);check(valueChanged.current()&&valueChanged.result.errors.includes('display-text-assets-model'),'a new worker pass checks the replaced profile');
   S.applyValueChanges(store,{length:store.values.length,changes:[[profileRef,profile]]});const valueRestored=await provider(s,params);check(valueRestored.current()&&valueRestored.result.errors.length===0,'restored shared profile validates');
   // Exercise the actual large Native background path, with a vault acknowledging only complete, hashed snapshots.
   await provider(s,GH_SAVE_SCHEMA.fleetValidationParams(s));
   const chunks=new Map(),commits=[];
   const deliver=(name,detail)=>setTimeout(()=>window.dispatchEvent(new CustomEvent(name,{detail})),0);
   const bridge={postMessage(m){
    if(m.action==='storeSaveChunk'){const text=atob(m.base64),bytes=new Uint8Array(text.length);for(let i=0;i<bytes.length;i++)bytes[i]=text.charCodeAt(i);chunks.set(m.id,bytes);deliver('gh-native-chunk-ack',{requestId:m.requestId,id:m.id,success:true});return;}
    if(m.action==='commitSave'){const tree=JSON.parse(m.saveJSON),ids=tree.fleet.rows.chunks,ok=ids.every(id=>chunks.has(id))&&GH_CONTROL_PLANE.sha256(m.saveJSON)===m.saveHash;if(ok)commits.push(m);deliver('gh-native-save-ack',{requestId:m.requestId,action:m.action,saveRevision:m.saveRevision,resetEpoch:m.resetEpoch,saveSchemaVersion:m.saveSchemaVersion,saveHash:m.saveHash,success:ok,generation:commits.length});}
   }};
   window.webkit={messageHandlers:{saveBridge:bridge,updateBridge:bridge}};
   const originalRAF=window.requestAnimationFrame;window.requestAnimationFrame=()=>0;
   Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>'hidden'});
   const mainBefore=GH_STATE_CODEC.cacheStats().chunks.checksumCalls,encodeBefore=GH_STATE_CODEC.cacheStats().chunks.base64Calls,workerBefore=GH_SAVE_CHECKSUM_THREAD.stats().completed,revision=s.saveRevision;
   document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('pagehide'));
   for(let i=0;i<3000&&(!commits.length||GH_PERSISTENCE.isLocked());i++)await new Promise(r=>setTimeout(r,5));
   check(commits.length===1&&s.saveRevision===revision+1,'hidden large Native save commits once without an animation frame');
   check(GH_SAVE_CHECKSUM_THREAD.stats().completed>workerBefore,'the real independent worker hashes the snapshot');
   check(GH_STATE_CODEC.cacheStats().chunks.checksumCalls===mainBefore,'large background save performs no chunk checksum on the main thread');
   check(GH_STATE_CODEC.cacheStats().chunks.base64Calls===encodeBefore&&GH_SAVE_CHECKSUM_THREAD.stats().encodes>0,'bridge fallback encoding also stays off the main thread');
   const loaded=GH_STATE_CODEC.deserialize(commits[0].saveJSON,{resolveChunk:id=>chunks.get(id)});check(GH_SAVE_SCHEMA.validate(loaded,{assetScan:'rows'}).ok,'saved snapshot validates after reload');
   const originalProvider=GH_SAVE_CHECKSUM_PROVIDER,count=commits.length,rev=s.saveRevision,calls=GH_STATE_CODEC.cacheStats().chunks.checksumCalls;
   globalThis.GH_SAVE_CHECKSUM_PROVIDER=()=>Promise.reject(new Error('QA-save-worker-unavailable'));
   const failed=await GH_PERSISTENCE.commitStateSliced(s,{yieldToFrame:()=>Promise.resolve()});globalThis.GH_SAVE_CHECKSUM_PROVIDER=originalProvider;
   check(!failed.ok&&commits.length===count&&s.saveRevision===rev,'worker refusal cannot publish a partial save or revision');
   check(GH_STATE_CODEC.cacheStats().chunks.checksumCalls===calls,'worker refusal cannot fall back to a main-thread scan');
   GH_PERSISTENCE.forgetVaultChunks();const originalEncoding=GH_SAVE_ENCODING_PROVIDER;
   globalThis.GH_SAVE_ENCODING_PROVIDER=()=>Promise.reject(new Error('QA-encoding-worker-unavailable'));
   const refused=await GH_PERSISTENCE.commitStateSliced(s,{yieldToFrame:()=>Promise.resolve()});globalThis.GH_SAVE_ENCODING_PROVIDER=originalEncoding;
   check(!refused.ok&&commits.length===count&&s.saveRevision===rev,'encoding worker refusal cannot publish a partial save');
   check(GH_STATE_CODEC.cacheStats().chunks.base64Calls===encodeBefore,'failed encoding cannot run on the main thread');
   const retry=await GH_PERSISTENCE.commitStateSliced(s,{yieldToFrame:()=>Promise.resolve()});check(retry.ok&&commits.length===count+1,'a worker save can retry safely after a vault miss');
   GH_PERSISTENCE.forgetVaultChunks();const beforeAbsent=commits.length,absentRevision=s.saveRevision;globalThis.GH_SAVE_ENCODING_PROVIDER=undefined;
   const absent=await GH_PERSISTENCE.commitStateSliced(s,{yieldToFrame:()=>Promise.resolve()});globalThis.GH_SAVE_ENCODING_PROVIDER=originalEncoding;
   check(!absent.ok&&/save-encoding-worker-unavailable/.test(absent.reason)&&commits.length===beforeAbsent&&s.saveRevision===absentRevision,'compressed containers refuse a missing encoding worker instead of moving tiny outputs onto main');
   check(GH_STATE_CODEC.cacheStats().chunks.base64Calls===encodeBefore&&!GH_PERSISTENCE.isLocked(),'missing encoding owner releases the lock without main-thread work');
   const tick=()=>new Promise(r=>setTimeout(r,0)),beforeRetake=commits.length,retakeRev=s.saveRevision;let writes=0;
   globalThis.GH_SAVE_CHECKSUM_PROVIDER=async(bytes,transform,expectedBytes)=>{const found=await originalProvider(bytes,transform,expectedBytes);if(writes++===0)S.set(store,0,'fuel',95);return found;};
   const retaken=await GH_PERSISTENCE.commitStateSliced(s,{yieldToFrame:tick});globalThis.GH_SAVE_CHECKSUM_PROVIDER=originalProvider;
   check(retaken.ok&&commits.length===beforeRetake+1&&s.saveRevision===retakeRev+1,'one concurrent write takes one fresh, validated worker snapshot');
   check(GH_STATE_CODEC.cacheStats().chunks.checksumCalls===calls&&GH_STATE_CODEC.cacheStats().chunks.base64Calls===encodeBefore,'all successful retries retain the worker path');
   const savedAgain=GH_STATE_CODEC.deserialize(commits.at(-1).saveJSON,{resolveChunk:id=>chunks.get(id)});check(S.get(savedAgain.fleet,0,'fuel')===95,'the retaken save includes the new row');
   // Decoding intentionally verifies the loaded lane cache. Keep test-only
   // reload work outside the measured save/retry interval.
   const beforeInvalid=commits.length,invalidRev=s.saveRevision,afterReloadCalls=GH_STATE_CODEC.cacheStats().chunks.checksumCalls;writes=0;
   globalThis.GH_SAVE_CHECKSUM_PROVIDER=async(bytes,transform,expectedBytes)=>{const found=await originalProvider(bytes,transform,expectedBytes);if(writes++===0)S.set(store,0,'fuel',151);return found;};
   const invalidRetry=await GH_PERSISTENCE.commitStateSliced(s,{yieldToFrame:tick});globalThis.GH_SAVE_CHECKSUM_PROVIDER=originalProvider;
   check(!invalidRetry.ok&&/asset-fuel/.test(invalidRetry.reason)&&commits.length===beforeInvalid&&s.saveRevision===invalidRev,'retry revalidates newly invalid rows instead of publishing old proof');S.set(store,0,'fuel',100);
   writes=0;globalThis.GH_SAVE_CHECKSUM_PROVIDER=async(bytes,transform,expectedBytes)=>{const found=await originalProvider(bytes,transform,expectedBytes);S.set(store,0,'fuel',writes++%2?94:95);return found;};
   const moving=await GH_PERSISTENCE.commitStateSliced(s,{yieldToFrame:tick});globalThis.GH_SAVE_CHECKSUM_PROVIDER=originalProvider;
   check(!moving.ok&&/fleet-changed-during-save/.test(moving.reason)&&writes===2&&commits.length===beforeInvalid&&s.saveRevision===invalidRev,'repeated changes stop after one bounded retry');S.set(store,0,'fuel',100);
   check(GH_STATE_CODEC.cacheStats().chunks.checksumCalls===afterReloadCalls&&GH_STATE_CODEC.cacheStats().chunks.base64Calls===encodeBefore,'all retries and refusals retain the worker path');
   window.requestAnimationFrame=originalRAF;
   // Preserve a real, nonzero month close through the Native commit, then prove a failed next close rolls back.
   const command=(name,payload)=>__AUDIT__.runAuthorizedDomainCommand({domain:'finance',name,payload,silent:true}),live=()=>__GH_STATE__;
   check(await command('credit',{company:'air',amount:1150,taxable:true,reference:'QA-PIPELINE-MONTHLY',note:'QA monthly close revenue'})!==false,'monthly test revenue commits');
   let monthlyMain=GH_STATE_CODEC.cacheStats().chunks.checksumCalls;const janCount=commits.length;
   check(await command('close-vat-period',{day:30})!==false&&commits.length===janCount+1,'January close waits for one Native commit');
   check(GH_STATE_CODEC.cacheStats().chunks.checksumCalls===monthlyMain,'monthly save does not move checksums onto main '+JSON.stringify({before:monthlyMain,after:GH_STATE_CODEC.cacheStats().chunks.checksumCalls}));
   const jan=GH_STATE_CODEC.deserialize(commits.at(-1).saveJSON,{resolveChunk:id=>chunks.get(id)}),janPeriod=jan.finance.periods.find(p=>p.company==='air');
   check(janPeriod?.amount===150&&GH_SAVE_SCHEMA.validate(jan,{assetScan:'rows'}).ok,'nonzero monthly assessment survives exact saved reload');
   const financial=()=>JSON.stringify([live().finance,live().companyFinance,live().cash,live().treasury]),closedJan=financial(),beforeFeb=commits.length,febRevision=live().saveRevision;
   globalThis.GH_SAVE_CHECKSUM_PROVIDER=()=>Promise.reject(new Error('QA-month-close-worker-refusal'));
   let failedMonth=false;try{await command('close-vat-period',{day:58});}catch(error){failedMonth=/QA-month-close-worker-refusal/.test(error.message);}finally{globalThis.GH_SAVE_CHECKSUM_PROVIDER=originalProvider;}
   check(failedMonth&&commits.length===beforeFeb&&live().saveRevision===febRevision&&financial()===closedJan,'failed month close leaves cash, books, periods and saved revision intact');
   monthlyMain=GH_STATE_CODEC.cacheStats().chunks.checksumCalls;
   check(await command('close-vat-period',{day:58})!==false&&commits.length===beforeFeb+1,'month close retries once successfully');
   check(GH_STATE_CODEC.cacheStats().chunks.checksumCalls===monthlyMain,'retried monthly save also stays off main');
   const feb=GH_STATE_CODEC.deserialize(commits.at(-1).saveJSON,{resolveChunk:id=>chunks.get(id)}),periodIds=feb.finance.periods.map(p=>p.id);
   check(new Set(periodIds).size===periodIds.length&&feb.finance.periods.some(p=>p.id===janPeriod.id&&p.amount===150)&&GH_SAVE_SCHEMA.validate(feb,{assetScan:'rows'}).ok,'retry preserves January and stores unique valid periods');
   check(!GH_PERSISTENCE.isLocked()&&GH_SAVE_CHECKSUM_THREAD.stats().activeSessions===0&&GH_SAVE_CHECKSUM_THREAD.stats().activeChannels===0,'monthly success/failure releases persistence and pipeline resources');
   client.terminate('test-done');check(provider(s,params)===null,'a disabled client cannot reuse evidence');return {fleet:store.live,requests,parallel:6,reused:6};
  });
  assert.equal(result.fleet,4400);assert.deepEqual(errors,[]);console.log('FLEET_VALIDATION_REUSE_PASS',engine.name(),JSON.stringify(result));
 }finally{await browser.close();}}
 }finally{await server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
