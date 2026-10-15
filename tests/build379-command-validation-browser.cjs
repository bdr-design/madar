'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),{chromium,webkit}=require('playwright'),{boot}=require('./helpers/local-dom-app'),{serve}=require('./helpers/web-server');
const root=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const qty=Number(process.env.GH_POSTING_PERF_ROWS)||3000;
(async()=>{const server=await serve(path.join(root,'WebApp'));try{for(const engine of [chromium,webkit]){const browser=await engine.launch({headless:true}),errors=[];try{
 const bootBrowser={newPage:async options=>{const p=await browser.newPage(options),url=server.baseURL+'/__qa_379__';await p.route(url,r=>r.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8">'}));await p.goto(url);return p;}};
 const {page}=await boot({root,browser:bootBrowser,errors,fleetWorker:true,beforeScripts:{fn:origin=>{globalThis.__GH_FLEET_ENGINE_WORKER_FACTORY__=()=>new Worker(origin+'/fleet-engine-worker.js');globalThis.__GH_SAVE_CHECKSUM_WORKER_FACTORY__=()=>new Worker(origin+'/save-checksum-worker.js');},arg:server.baseURL}});page.setDefaultTimeout(180000);
 const out=await page.evaluate(async qty=>{
  const a=__AUDIT__,get=()=>__GH_STATE__;get().godMoney=true;get().infiniteMoney=true;
  // Acknowledging vault test double. Every referenced chunk must have arrived before a manifest can commit.
  const chunks=new Set(),commits=[];const deliver=(name,detail)=>setTimeout(()=>dispatchEvent(new CustomEvent(name,{detail})),0);
  const bridge={postMessage(m){if(m.action==='storeSaveChunk'){chunks.add(m.id);deliver('gh-native-chunk-ack',{requestId:m.requestId,id:m.id,success:true});}else if(m.action==='commitSave'){const tree=JSON.parse(m.saveJSON),ids=tree.fleet?.rows?.chunks||[],ok=!window.__379Nack&&ids.every(id=>chunks.has(id))&&GH_CONTROL_PLANE.sha256(m.saveJSON)===m.saveHash;if(ok)commits.push(m);deliver('gh-native-save-ack',{requestId:m.requestId,action:m.action,saveRevision:m.saveRevision,resetEpoch:m.resetEpoch,saveSchemaVersion:m.saveSchemaVersion,saveHash:m.saveHash,success:ok,generation:commits.length});}}};window.webkit={messageHandlers:{saveBridge:bridge,updateBridge:bridge}};
  await a.runAuthorizedDomainCommand('corporate','open-company',{type:'air',capital:900000000,legalName:'QA Sliced Validation'},{silent:true});
  const r=GH_WORLD_DATA.airports.find(x=>x[0]==='OMDB');await a.runAuthorizedDomainCommand('facilities','create',{facility:{id:'QA-379',name:'QA Base',kind:'airport-base',company:'air',ownerCompanyId:'air',owned:true,sourceKey:'air:OMDB',code:r[1]||'OMDB',icao:'OMDB',iata:r[1],city:r[3]||'—',country:String(r[5]||'—'),coords:[r[6],r[7]]},bucket:'globalBases'},{silent:true});
  if(!await a.buyAsset('air','used',GH_ASSET_CATALOG.air.used[0].id,'lease',qty,'QA-379',true,'QA-379-BUY','air'))throw new Error('fixture-purchase-failed:'+JSON.stringify({messages:get().workflowControl?.history?.slice(-3),worker:__AUDIT__.fleetEngineThreadClient()?.stats(),validation:GH_SAVE_SCHEMA.telemetry().lastValidation}));
  const samples=[];for(let i=0;i<3;i++){
   if(qty>3000){const write=GH_FLEET_STORE.columnWriter(get().fleet,['progress']);for(let index=0;index<qty;index++)write(index,'progress',(index+i)/(qty+3));}
   await a.runAuthorizedDomainCommand('corporate','rename-company',{type:'air',legalName:'QA Sliced '+i},{silent:true});
   samples.push({timing:GH_TRANSACTION_CORE.telemetry().lastDurable,fleetWork:GH_SAVE_SCHEMA.telemetry().lastValidation.fleetWork});
  }
  const snap=()=>JSON.stringify({name:get().companyRegistry.air.legalName,rev:get().saveRevision,proofs:get().documentProofs,finance:get().companyFinance});
  const original=GH_FLEET_VALIDATION_PROVIDER,before=snap(),count=commits.length;GH_FLEET_STORE.set(get().fleet,0,'fuel',151);
  let invalid='';try{await a.runAuthorizedDomainCommand('corporate','rename-company',{type:'air',legalName:'MUST ROLLBACK'},{silent:true});}catch(e){invalid=e.message;}
  if(!/asset-fuel/.test(invalid)||snap()!==before||commits.length!==count)throw new Error('invalid-draft-not-atomic:'+invalid);
  GH_FLEET_STORE.set(get().fleet,0,'fuel',100);let unavailable='';GH_FLEET_VALIDATION_PROVIDER=()=>null;
  try{await a.runAuthorizedDomainCommand('corporate','rename-company',{type:'air',legalName:'NO WORKER'},{silent:true});}catch(e){unavailable=e.message;}GH_FLEET_VALIDATION_PROVIDER=original;
  const saves=[];for(let i=0;i<2;i++){
   const revision=get().saveRevision,prior=commits.length,uploads=chunks.size,accepted=a.save();
   await GH_PERSISTENCE.slicedSettled();await GH_PERSISTENCE.drain();
   if(accepted!==true||get().saveRevision!==revision+1||commits.length!==prior+1)throw new Error('large-save-not-committed-once');
   const timing=GH_PERSISTENCE.telemetry().timings.samples.at(-1);saves.push({newChunks:chunks.size-uploads,timing});
  }
  if(saves[1].newChunks!==0)throw new Error('unchanged-fleet-reuploaded');
  const stable=JSON.stringify({size:GH_FLEET_DATA.size(get()),rev:get().saveRevision,finance:get().finance,books:get().companyFinance,authorization:get().authorization,sequences:get().sequences}),beforeNack=commits.length;window.__379Nack=true;
  const refused=await a.buyAsset('air','used',GH_ASSET_CATALOG.air.used[0].id,'lease',50,'QA-379',true,'QA-379-NACK','air');
  const afterNack=JSON.stringify({size:GH_FLEET_DATA.size(get()),rev:get().saveRevision,finance:get().finance,books:get().companyFinance,authorization:get().authorization,sequences:get().sequences});
  if(refused!==null||stable!==afterNack||commits.length!==beforeNack)throw new Error('native-nack-did-not-roll-back-purchase');
  return {rows:GH_FLEET_DATA.size(get()),samples,invalid,unavailable,saves,commits:commits.length,nativeNackRolledBack:true};
 },qty);
 assert.equal(out.rows,qty);assert.match(out.invalid,/asset-fuel/);
 if(!process.env.GH_POSTING_BASELINE){assert.match(out.unavailable,/fleet-validation-unavailable/);assert.ok(out.saves.every(x=>x.timing.kind==='sliced-save'),'ordinary large Native requests must use sliced persistence');for(const row of out.samples){assert.equal(row.fleetWork.workerValidation,1);assert.ok(Number.isFinite(row.timing.validateBusyMs));assert.ok(row.timing.validateMaxSliceMs<=row.timing.validateBusyMs+.1);}}
 assert.deepEqual(errors,[]);console.log(JSON.stringify({suite:'build379-command-validation-browser',ok:true,engine:engine.name(),...out}));
}finally{await browser.close();}}}finally{await server.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
