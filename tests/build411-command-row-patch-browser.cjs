'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{chromium,webkit}=require('playwright');
const {bootAtOrigin,installVault}=require('./helpers/differential-vault-fixture.cjs'),ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const results=[];
const sha=value=>require('node:crypto').createHash('sha256').update(value).digest('hex');
const projected=()=>{const rows=[];GH_FLEET_DATA.scan(__GH_STATE__,['id','phase','routeId','progress','fuel','condition','flightHours','flightCycles','nextCheckHours','baseFacility'],row=>rows.push({...row}));return JSON.stringify(rows);};
(async()=>{for(const engine of [chromium,webkit]){
 const browser=await engine.launch({headless:true});let env;const errors=[];
 try{
  env=await bootAtOrigin({browser,root:ROOT,errors,fleetWorker:true,viewport:{width:956,height:440},beforeScripts:{fn:installVault}});
  const {page}=env;page.setDefaultTimeout(90000);await page.evaluate(fs.readFileSync(path.join(ROOT,'WebApp/save-chunk-codec.js'),'utf8'));await page.evaluate(()=>{window.GH_NATIVE_ROW_PATCHES=1;window.GH_NATIVE_VALUE_CHUNKS=1;window.GH_NATIVE_CHUNK_ENCODINGS=['gh-packbits-v1'];const codec=GH_STATE_CODEC;window.__PATCH_TRACKING__={batches:0,unowned:0};window.GH_STATE_CODEC={...codec,recordFleetRows(store,revision,indices,owned){__PATCH_TRACKING__.batches++;if(owned!==true)__PATCH_TRACKING__.unowned++;return codec.recordFleetRows(store,revision,indices,owned);}};});
  await page.evaluate(async()=>{
   const a=__AUDIT__,state=()=>__GH_STATE__;state().godMoney=true;state().infiniteMoney=true;
   for(const type of ['air','sea','road','power','bank','mobility','insurance','realestate','telecom','dealership','hospitality']){
    if(state().openedCompanies.includes(type))continue;const d=GH_COMPANY_PLATFORM.definitionFor(state(),type);
    await a.runAuthorizedDomainCommand('corporate','open-company',{type,companyId:type,capital:Math.max(900000000,d.founding.minimumCapital),legalName:'QA Patch '+type,formationContract:'QA-PATCH-'+type},{silent:true});
   }
   for(const code of ['OMDB','EGLL']){const r=GH_WORLD_DATA.airports.find(row=>row[0]===code);await a.runAuthorizedDomainCommand('facilities','create',{facility:{id:'QA-PATCH-'+code,name:'QA Patch '+code,kind:'airport-base',company:'air',ownerCompanyId:'air',owned:true,sourceKey:'air:'+code,code:r[1]||code,icao:code,iata:r[1],city:r[3]||'—',country:String(r[5]||'—'),coords:[r[6],r[7]]},bucket:'globalBases'},{silent:true});}
   const model=GH_ASSET_CATALOG.air.used.filter(x=>!x.specs.cargo&&Number(x.specs.rangeKm)>=6000).sort((a,b)=>a.price-b.price)[0];
   for(const code of ['OMDB','EGLL']){const options={};if(!await a.buyAsset('air','used',model.id,'lease',2200,'QA-PATCH-'+code,true,'QA-PATCH-'+code,'air',options))throw new Error('fixture-buy-failed:'+JSON.stringify({code,options,worker:a.fleetEngineThreadClient()?.stats(),events:state().diagnostics?.events?.slice(0,3)}));}
  });
  await page.evaluate(()=>__AUDIT__.openDrawer('routes','air'));
  await page.locator('.dispatch-international-network[data-company="air"]').first().click();
  await page.waitForFunction(()=>GH_FLEET_DATA.count(__GH_STATE__,r=>!!r.routeId)===4400&&!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked());
  // Move through the actual worker/app transaction, then anchor one successful save.
  await page.evaluate(()=>{const r=__AUDIT__.simulationEngine.advanceTo(1200,{reason:'qa-patch-anchor',speed:300});if(!r.accepted)throw Error(JSON.stringify(r));});
  await page.waitForFunction(()=>!__AUDIT__.simulationEngine.snapshot().manualAdvance||!!__AUDIT__.simulationEngine.snapshot().lastError);
  await page.evaluate(async()=>{__AUDIT__.setSpeed(0);await GH_PERSISTENCE.drain();await __AUDIT__.saveNow();});
  await page.waitForFunction(()=>!GH_TRANSACTION_CORE.isStaged(__GH_STATE__)&&!GH_PERSISTENCE.isLocked()&&!window.__GH_DURABLE_COMMAND_CONTEXT__);
  assert(await page.evaluate(()=>GH_SAVE_CHECKSUM_THREAD.stats().chunkEncodes>0),'row patches must coexist with the advertised native compression capability');
  const before=await page.evaluate(()=>({rows:GH_FLEET_DATA.size(__GH_STATE__),companies:__GH_STATE__.openedCompanies.length,applied:__AUDIT__.fleetEngineThreadClient().stats().applied}));
  await page.evaluate(()=>{const r=__AUDIT__.simulationEngine.advanceTo(__GH_STATE__.simSeconds+1200,{reason:'qa-patch-move',speed:300});if(!r.accepted)throw Error(JSON.stringify(r));});
  await page.waitForFunction(()=>!__AUDIT__.simulationEngine.snapshot().manualAdvance||!!__AUDIT__.simulationEngine.snapshot().lastError);
  await page.waitForFunction(()=>!GH_TRANSACTION_CORE.isStaged(__GH_STATE__)&&!__AUDIT__.fleetEngineThreadClient().busy);
  async function command(key,mode='ok'){
   return page.evaluate(async({key,mode})=>{
    const s=__GH_STATE__,q=__DIFF_VAULT__,before={books:JSON.stringify(s.companyFinance),balance:s.companyFinance.group.accounts[0].balance,head:q.head,revision:s.saveRevision};q.mode=mode;q.uploads=[];q.attempts=[];let rejected=false;const start=performance.now();
    try{await __AUDIT__.runAuthorizedDomainCommand('finance','credit',{company:'group',amount:100,note:'QA '+key,reference:key},{silent:true,idempotencyKey:key});}catch{rejected=true;}
    const decoded=GH_STATE_CODEC.deserialize(q.head,{resolveChunk:id=>q.chunks.get(id)}),tree=JSON.parse(q.head),baseIds=new Set(tree.fleet.rows.lanes.containers.map(p=>p.id)),patches=tree.fleet.rows.rowPatches?.chunks||[];
    let same=true;const live=new Uint8Array(s.fleet.rows),saved=new Uint8Array(decoded.fleet.rows);if(live.length!==saved.length)same=false;for(let i=0;same&&i<live.length;i++)if(live[i]!==saved[i])same=false;
    return {key,rejected,elapsedMs:performance.now()-start,laneUploads:q.uploads.filter(x=>baseIds.has(x.id)).length,patches:patches.length,patchUploads:q.uploads.filter(x=>patches.some(p=>p.id===x.id)).length,uploadBytes:q.uploads.reduce((n,x)=>n+x.bytes,0),attempts:q.attempts.length,balanceDelta:s.companyFinance.group.accounts[0].balance-before.balance,booksRestored:JSON.stringify(s.companyFinance)===before.books,headUnchanged:q.head===before.head,rowsMatch:same,booksMatch:JSON.stringify(decoded.companyFinance)===JSON.stringify(s.companyFinance),revisionDelta:s.saveRevision-before.revision,worker:__AUDIT__.fleetEngineThreadClient().stats()};
   },{key,mode});
  }
  let out=await command('QA-PATCH-CREDIT');assert.equal(out.rejected,false);assert.equal(out.laneUploads,0,'sparse worker movement must reuse every acknowledged lane page');assert(out.patches>0,'real worker replay must be wired to sparse persistence');assert.equal(out.rowsMatch,true);assert.equal(out.booksMatch,true);assert.equal(out.balanceDelta,100);assert.equal(out.attempts,1);results.push({engine:engine.name(),case:'real worker movement then financial command',...before,...out});
  const tracking=await page.evaluate(()=>__PATCH_TRACKING__);assert(tracking.batches>0);assert.equal(tracking.unowned,0,'actual worker replays transfer the existing index list');
  const seed=await page.evaluate(()=>({json:__DIFF_VAULT__.head,chunks:[...__DIFF_VAULT__.chunks].map(([id,b])=>[id,GH_STATE_CODEC.bytesToBase64(b)]),books:JSON.stringify(__GH_STATE__.companyFinance)}));
  seed.projected=await page.evaluate(projected);
  out=await command('QA-PATCH-CREDIT');assert.equal(out.balanceDelta,0);assert.equal(out.attempts,0);assert.equal(out.uploadBytes,0);results.push({engine:engine.name(),case:'receipt replay',...out});
  const cheque=await page.evaluate(async()=>{
   const q=__DIFF_VAULT__,s=__GH_STATE__;s.godMoney=false;s.infiniteMoney=false;q.uploads=[];q.attempts=[];
   const balance=GH_FINANCE_CORE.operating(s,'group'),result=await __AUDIT__.runAuthorizedDomainCommand('finance','issue-cheque',{company:'group',amount:100,beneficiary:'QA Row Patch Vendor LLC',note:'QA patch cheque',requestRef:'QA-PATCH-CHEQUE'},{silent:true});
   const root=JSON.parse(q.head),base=new Set(root.fleet.rows.lanes.containers.map(p=>p.id));return {id:result.result.id,balance,after:GH_FINANCE_CORE.operating(s,'group'),attempts:q.attempts.length,laneUploads:q.uploads.filter(r=>base.has(r.id)).length};
  });assert.equal(cheque.after,cheque.balance);assert.equal(cheque.attempts,1);assert.equal(cheque.laneUploads,0);
  await page.evaluate(()=>{__DIFF_VAULT__.uploads=[];__DIFF_VAULT__.attempts=[];__AUDIT__.openDrawer('invoices',{company:'group',tab:'documents',view:'cheques'});});
  await page.locator('.settle-all-cheques').first().click();
  await page.waitForFunction(id=>__GH_STATE__.finance.cheques.find(row=>row.id===id)?.status==='مصروف'&&!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked(),cheque.id);
  const cashed=await page.evaluate(()=>{const q=__DIFF_VAULT__,root=JSON.parse(q.head),base=new Set(root.fleet.rows.lanes.containers.map(p=>p.id));return {balance:GH_FINANCE_CORE.operating(__GH_STATE__,'group'),attempts:q.attempts.length,laneUploads:q.uploads.filter(r=>base.has(r.id)).length};});assert.equal(cashed.balance,cheque.balance-100);assert.equal(cashed.attempts,1);assert.equal(cashed.laneUploads,0);results.push({engine:engine.name(),case:'actual cheque issuance and bulk cash button',issuedCommits:cheque.attempts,cashCommits:cashed.attempts,laneUploads:0,cashDelta:-100});
  const second=await page.evaluate(async()=>{const out=await __AUDIT__.runAuthorizedDomainCommand('finance','issue-cheque',{company:'group',amount:100,beneficiary:'QA Row Patch Vendor LLC',note:'QA retry cheque',requestRef:'QA-PATCH-CHEQUE-RETRY'},{silent:true});__DIFF_VAULT__.uploads=[];__DIFF_VAULT__.attempts=[];__AUDIT__.openDrawer('invoices',{company:'group',tab:'documents',view:'cheques'});return out.result.id;});
  const cashBefore=await page.evaluate(()=>{const q=__DIFF_VAULT__;q.mode='commit-nack';return {head:q.head,books:JSON.stringify(__GH_STATE__.companyFinance),finance:JSON.stringify(__GH_STATE__.finance)};});
  await page.locator('.settle-all-cheques').first().click();
  await page.waitForFunction(()=>__DIFF_VAULT__.attempts.length===1&&!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked());
  const cashRefused=await page.evaluate(()=>({head:__DIFF_VAULT__.head,books:JSON.stringify(__GH_STATE__.companyFinance),finance:JSON.stringify(__GH_STATE__.finance)}));assert.deepEqual(cashRefused,cashBefore,'bulk cash NACK must restore every financial document and balance');results.push({engine:engine.name(),case:'bulk settlement NACK exact rollback',exactFinance:true});
  await page.evaluate(()=>{__DIFF_VAULT__.mode='ok';__DIFF_VAULT__.uploads=[];__DIFF_VAULT__.attempts=[];__AUDIT__.openDrawer('invoices',{company:'group',tab:'documents',view:'cheques'});});
  await page.locator('.settle-all-cheques').first().click();
  await page.waitForFunction(id=>__GH_STATE__.finance.cheques.find(row=>row.id===id)?.status==='مصروف'&&!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked(),second);
  const retriedCash=await page.evaluate(()=>{const q=__DIFF_VAULT__,tree=JSON.parse(q.head),base=new Set(tree.fleet.rows.lanes.containers.map(p=>p.id)),saved=GH_STATE_CODEC.deserialize(q.head,{resolveChunk:id=>q.chunks.get(id)});return {balance:GH_FINANCE_CORE.operating(__GH_STATE__,'group'),attempts:q.attempts.length,laneUploads:q.uploads.filter(r=>base.has(r.id)).length,rowsExact:GH_STATE_CODEC.bytesToBase64(new Uint8Array(saved.fleet.rows))===GH_STATE_CODEC.bytesToBase64(new Uint8Array(__GH_STATE__.fleet.rows)),booksExact:JSON.stringify(saved.companyFinance)===JSON.stringify(__GH_STATE__.companyFinance)};});assert.equal(retriedCash.balance,cheque.balance-200);assert.equal(retriedCash.attempts,1);assert.equal(retriedCash.rowsExact,true);assert.equal(retriedCash.booksExact,true);results.push({engine:engine.name(),case:'bulk settlement retry after NACK preserves exact rows and books',...retriedCash});
  out=await command('QA-PATCH-NACK','commit-nack');assert.equal(out.rejected,true);assert.equal(out.balanceDelta,0);assert.equal(out.booksRestored,true);assert.equal(out.headUnchanged,true);results.push({engine:engine.name(),case:'NACK preserves money and head',...out});
  out=await command('QA-PATCH-NACK');assert.equal(out.rejected,false);assert.equal(out.balanceDelta,100);assert.equal(out.rowsMatch,true);assert.equal(out.booksMatch,true);assert.equal(out.attempts,1);results.push({engine:engine.name(),case:'retry applies exactly once',...out});
  await page.close();await env.closeOrigin();env=await bootAtOrigin({browser,root:ROOT,errors,fleetWorker:true,viewport:{width:956,height:440},beforeScripts:{fn:seed=>{window.GH_NATIVE_ROW_PATCHES=1;window.GH_NATIVE_VALUE_CHUNKS=1;window.GH_NATIVE_BUILD=362;window.__GH_NATIVE_SAVE_JSON__=seed.json;window.__GH_NATIVE_SAVE_CHUNKS__=new Map(seed.chunks.map(([id,b64])=>[id,Uint8Array.from(atob(b64),c=>c.charCodeAt(0)).buffer]));},arg:seed}});
  await env.page.waitForFunction(()=>__AUDIT__.fleetEngineThreadClient()?.replicaReady(__GH_STATE__.fleet),null,{timeout:60000});
  const replica=await env.page.evaluate(async()=>{const found=await __AUDIT__.fleetEngineThreadClient().inspect();return {rows:GH_STATE_CODEC.bytesToBase64(new Uint8Array(found.rows)),live:GH_STATE_CODEC.bytesToBase64(new Uint8Array(__GH_STATE__.fleet.rows,0,__GH_STATE__.fleet.length*128))};});{const a=Buffer.from(replica.rows,'base64'),b=Buffer.from(replica.live,'base64'),diff=[];for(let i=0;i<Math.max(a.length,b.length)&&diff.length<20;i++)if(a[i]!==b[i])diff.push({at:i,row:Math.floor(i/128),offset:i%128,replica:a[i],live:b[i]});assert.equal(diff.length,0,'cold worker byte mismatch '+JSON.stringify({replicaBytes:a.length,liveBytes:b.length,diff}));}
  const coldProof=await env.page.evaluate(async()=>{const s=__GH_STATE__,proof=await GH_FLEET_QUERY_PROVIDER(s,'saveChunkProof',{index:0,totalByteLength:s.fleet.rows.byteLength});return !!proof&&proof.current()&&proof.result.checksum===GH_STATE_CODEC.fleetRowChecksum(s.fleet,0,s.fleet.rows.byteLength).checksum&&proof.result.byteLength===s.fleet.rows.byteLength;});assert.equal(coldProof,true,'trimmed cold replica independently proves the reserved-capacity save page');
  const restored=await env.page.evaluate(()=>({books:JSON.stringify(__GH_STATE__.companyFinance),worker:__AUDIT__.fleetEngineThreadClient().stats()}));assert.equal(restored.books,seed.books);assert.equal(sha(await env.page.evaluate(projected)),sha(seed.projected),'fleet motion and counter values survive cold bootstrap');assert.equal(restored.worker.seedSyncs,0,'historical base pages must never seed a patched replica');results.push({engine:engine.name(),case:'real bootstrap exact current replica, motion, counters and books',replicaExact:true,coldProof:true,seedSyncs:restored.worker.seedSyncs});
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await env?.closeOrigin?.();}
}
if(process.env.GH_COMMAND_PATCH_RESULTS)fs.writeFileSync(process.env.GH_COMMAND_PATCH_RESULTS,JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify({suite:'build411-command-row-patch-browser',ok:true,results}));
})().catch(error=>{console.error(error);process.exitCode=1;});
