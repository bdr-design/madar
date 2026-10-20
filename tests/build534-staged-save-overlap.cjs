'use strict';
// iPhone diagnostic DX-1792492289770 (980,000 assets, play running): 3 of 6 player decisions waited 155-175 ms after their
// checks for the command's chunk staging (GH_PERSISTENCE.prestageDurableChunks) to finish uploading, and only then
// serialized the save (148-547 ms). The save text never needed those uploads. The command now hands the staging to
// commitDurableState, which serializes once the staging has planned its chunks, trusting the ids it planned, and waits for
// its uploads only before its own; if the staging did not upload an id the save lists, the save is serialized again without
// that trust. Proven with the real persistence, codec and fleet store and a stand-in vault that refuses a commit listing a
// missing chunk (the contract of build362-durable-prestage):
//  1. the save is serialized while the staging's uploads are still held, redoes none of the staged pages (only the page
//     every save re-verifies), the commit uploads nothing the staging uploaded, the vault accepts it and rebuilds exactly
//     the committed rows; the wait is recorded (stagingWaitMs);
//  2. control, the previous order (the staging settled, then the commit): serialization starts only after the uploads;
//  3. a staging that fails after planning (an upload refused, or a vault reset) makes the commit serialize again without
//     trusting it (stagingRetakes) and upload what it needs: the vault accepts it with the exact rows;
//  4. executeDurable gives the staging to the default persistence and persists before it settles, records its wait and
//     outcome, and keeps the previous order for a custom persist; the previous wiring, restored in memory, waits first.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {scenario}=require(path.join(ROOT,'tests/helpers/business-scenario'));
const {harness}=require(path.join(ROOT,'tests/helpers/core-harness'));
const e=scenario(),s=e.s,state=e.state,FLEET=s.GH_FLEET_DATA,STORE=s.GH_FLEET_STORE,TX=s.GH_TRANSACTION_CORE;
e.load('migration-core');e.load('state-codec-core');e.load('persistence-core');
e.load('fleet-save-validation-core');e.load('fleet-query-core');
s.GH_FLEET_VALIDATION_PROVIDER=(target,params)=>s.GH_FLEET_QUERY.run('saveValidation',{fleet:target.fleet,simSeconds:Number(target.simSeconds)||0},s.GH_FLEET_DATA,params);
const P=s.GH_PERSISTENCE,CODEC=s.GH_STATE_CODEC,results=[];
async function test(name,fn){try{results.push({name,ok:true,detail:await fn()});}catch(error){results.push({name,ok:false,error:String(error.stack||error).slice(0,2000)});}}
const tick=(ms=1)=>new Promise(resolve=>setTimeout(resolve,ms));

// ---- stand-in native vault --------------------------------------------------------------------------------------------
const vault={chunks:new Map(),saves:[],messages:[],generation:0,holdChunkAcks:null,refuseNext:0};
const sha=text=>crypto.createHash('sha256').update(text,'utf8').digest('hex');
function referenced(json){const root=JSON.parse(json),rows=root?.fleet?.rows;return [...(rows?.$ghBinary==='chunks-v1'?rows.chunks:[]),...(Array.isArray(root?.stateCodec?.chunks)?root.stateCodec.chunks:[])];}
function deliver(name,detail){setTimeout(()=>s.dispatchEvent(new s.CustomEvent(name,{detail})),0);}
const bridge={postMessage(message){
  vault.messages.push({action:message.action,id:message.id,at:events.length});
  if(message.action==='storeSaveChunk'){
    const bytes=Buffer.from(message.base64,'base64'),refused=vault.refuseNext>0&&vault.refuseNext--;
    const ack=()=>{if(refused)return deliver('gh-native-chunk-ack',{requestId:message.requestId,id:message.id,success:false,message:'qa-chunk-refused'});vault.chunks.set(message.id,bytes);deliver('gh-native-chunk-ack',{requestId:message.requestId,id:message.id,success:true});};
    if(vault.holdChunkAcks)vault.holdChunkAcks.push(ack);else ack();return;
  }
  if(message.action==='commitSave'){
    const missing=referenced(message.saveJSON).find(id=>!vault.chunks.has(id)),ok=!missing&&sha(message.saveJSON)===message.saveHash;
    if(ok)vault.saves.push(message.saveJSON);events.push(ok?'commit':`commit-refused:${missing}`);
    deliver('gh-native-save-ack',{requestId:message.requestId,action:message.action,saveRevision:message.saveRevision,resetEpoch:message.resetEpoch,saveSchemaVersion:message.saveSchemaVersion,saveHash:message.saveHash,success:ok,generation:ok?++vault.generation:undefined,message:missing?`Missing save chunk: ${missing}`:ok?'':'bad hash'});
  }
}};
s.webkit={messageHandlers:{saveBridge:bridge,updateBridge:bridge}};
const uploads=()=>vault.messages.filter(m=>m.action==='storeSaveChunk');
const resetLog=()=>{vault.messages.length=0;events.length=0;};
// The order of events: when a full save serialization (the commit's, not the staging's fleet-only one) ends.
const events=[];
{const codec=s.GH_STATE_CODEC;s.GH_STATE_CODEC={...codec,serializeChunkedSteps:function*(target,options){const value=yield* codec.serializeChunkedSteps(target,options);if(options?.fleetChunksOnly!==true)events.push('serialized');return value;}};}

// ---- a real fleet over two store chunks --------------------------------------------------------------------------------
state.godMoney=true;state.infiniteMoney=true;state.advanced.facilities.B1.capacity=1e7;
const base=state.globalBases.find(row=>row.id==='B1');base.deliveryCapacity=1e7;const item=e.item,total=item.price*3000;
assert.equal(TX.execute(state,{label:'overlap-buy',apply:()=>s.GH_PROCUREMENT_CORE.withPurchaseBatch(state,()=>{const r=e.command('procurement','purchase-assets',{type:'air',ownerCompanyId:'air',tab:'new',item,base,supplier:{id:'S1',name:'Supplier',legalName:'Supplier LLC'},mode:'cash',qty:3000,manual:true,requestRef:'OVERLAP-1',upfront:total,totalPrice:total,paymentMethod:'cash',documentLeadDays:1,leadSeconds:0,immediateDelivery:true});s.GH_REALISM.onSimulationTime(state,state.simSeconds);return r;})}).committed,true);
if(FLEET.mode(state)!=='store')s.GH_MIGRATION_CORE.migrateFleet(state);
TX.execute(state,{label:'overlap-grow',scope:['fleet'],apply:()=>{const template=FLEET.plain(state,FLEET.list(state)[0].id);for(let i=0;i<STORE.CHUNK_ROWS+2000;i++)FLEET.add(state,{...template,id:`N-AIR-OVL-${String(i).padStart(6,'0')}`,name:`GH AIR OVL ${i}`});}});
const key='build534-staged-save-overlap',yieldToFrame=()=>new Promise(resolve=>setTimeout(resolve,0));
const touchBothChunks=fuel=>TX.execute(state,{label:`touch-${fuel}`,scope:['fleet'],apply:()=>{STORE.set(state.fleet,3,'fuel',fuel);STORE.set(state.fleet,STORE.CHUNK_ROWS+3,'fuel',fuel+1);}});
function durableCommit(target,extra={}){const previous=Number(target.saveRevision)||0;target.saveRevision=previous+1;return P.commitDurableState(target,{storageKey:key,prevalidated:true,expectedPreviousRevision:previous,yieldToFrame,...extra});}
const lastSave=()=>P.telemetry().timings.samples.filter(row=>row.kind==='durable-save').at(-1);
function exactRows(json,expected){const loaded=CODEC.deserialize(json,{resolveChunk:id=>vault.chunks.get(id)});assert.deepEqual(new Uint8Array(loaded.fleet.rows),expected,'the vault rebuilds exactly the committed rows');}
// Holds the staging's chunk acks until `release` is called; returns the staging, its planned ids and a settled flag.
async function heldStaging(){
  vault.holdChunkAcks=[];const staging=P.prestageDurableChunks(state,{yieldToFrame});assert(staging,'staging applies to a large native fleet');
  const watch={settled:false};staging.settled.then(()=>{watch.settled=true;events.push('staging-settled');});
  const planned=await staging.planned;assert(typeof planned?.has==='function'&&planned.size>=2,'the staging planned both changed chunks');
  for(let i=0;i<400&&!vault.holdChunkAcks.length;i++)await tick();assert(vault.holdChunkAcks.length>0,'a staged upload is held');
  const release=async()=>{for(let i=0;i<400&&!watch.settled;i++){const held=vault.holdChunkAcks||[];vault.holdChunkAcks=[];held.forEach(ack=>ack());await tick();}vault.holdChunkAcks=null;await staging.settled;};
  return {staging,planned,watch,release};
}

(async()=>{
  await P.commitState(state,{storageKey:key}).native;

  await test('1: the save is serialized while the staging uploads; the commit uploads none of them and the vault accepts it',async()=>{
    touchBothChunks(21);resetLog();const {staging,planned,watch,release}=await heldStaging();
    const lanes=()=>{const c=CODEC.cacheStats().chunks;return (c.reused||0)+(c.named||0);},before=lanes();
    const expected=new Uint8Array(state.fleet.rows.slice(0)),commit=durableCommit(state,{staging});
    for(let i=0;i<800&&!events.includes('serialized');i++)await tick();
    assert(events.includes('serialized'),'the commit serialized its save');assert.equal(watch.settled,false,'while the staging uploads were still held');
    const redone=lanes()-before;assert(redone<=16,`the commit redid only the re-verified page's 16 lanes, not the staged pages: ${redone}`);
    await release();const out=await commit;await staging.release();
    assert.equal(out.ok,true);assert.deepEqual(events,['serialized','staging-settled','commit']);
    // The commit's own uploads are the ones posted after the staging settled.
    const commitUploads=uploads().filter(m=>m.at>events.indexOf('staging-settled')).map(m=>m.id);assert.deepEqual(commitUploads.filter(id=>planned.has(id)),[],'nothing staged is uploaded again');
    const json=vault.saves.at(-1);assert([...planned].every(id=>referenced(json).includes(id)),'the commit lists the staged chunks');exactRows(json,expected);
    const timing=lastSave();assert(timing.stagingWaitMs>0,'the wait for the staging is recorded');assert.equal(timing.stagingWaitMs,(timing.stagingPlanWaitMs||0)+(timing.stagingUploadWaitMs||0),'as the wait for its plan and for its uploads');assert(timing.stagingUploadWaitMs>0);assert.equal(timing.stagingRetakes,undefined);assert.equal(out.stagingWaitMs,timing.stagingWaitMs);
    resetLog();await durableCommit(state);assert.equal(uploads().length,0,'the committed staging is trusted afterwards');
    return {planned:planned.size,redoneLanes:redone,commitUploads:commitUploads.length,stagingWaitMs:timing.stagingWaitMs};
  });

  await test('2: control, the previous order serializes only after the staging uploads',async()=>{
    touchBothChunks(31);resetLog();const {staging,release}=await heldStaging();
    const settled=release().then(()=>durableCommit(state));const out=await settled;await staging.release();
    assert.equal(out.ok,true);assert.deepEqual(events,['staging-settled','serialized','commit']);return {order:events.join('>')};
  });

  for(const [label,fail] of [['an upload refused',()=>{vault.refuseNext=1;}],['a vault reset',()=>P.forgetVaultChunks()]])
    await test(`3: a staging that fails after planning (${label}) is not trusted; the commit serializes again`,async()=>{
      touchBothChunks(label.length+40);resetLog();
      if(label==='an upload refused'){fail();}
      const {staging,planned,watch,release}=await heldStaging();
      const expected=new Uint8Array(state.fleet.rows.slice(0)),commit=durableCommit(state,{staging});
      for(let i=0;i<800&&!events.includes('serialized');i++)await tick();assert.equal(watch.settled,false);
      if(label==='a vault reset')fail();
      await release();const staged=await staging.settled;assert.equal(staged.ok,false,'the staging failed');
      const out=await commit;await staging.release();assert.equal(out.ok,true,'the commit succeeded');
      assert.deepEqual(events.filter(row=>row.startsWith('commit')),['commit'],'the vault accepted it: no missing chunk');
      assert.equal(events.filter(row=>row==='serialized').length,2,'the save was serialized again');assert.equal(lastSave().stagingRetakes,1);
      exactRows(vault.saves.at(-1),expected);return {reason:staged.reason,planned:planned.size,uploads:uploads().length};
    });

  // ---- 4: the wiring inside transaction-core.executeDurable ---------------------------------------------------------
  const source=fs.readFileSync(path.join(ROOT,'WebApp/transaction-core.js'),'utf8'),CURRENT="const stagingInPersist=!!staging?.settled&&typeof options.persist!=='function';";
  assert.equal(source.split(CURRENT).length,2,'the staging is handed to the default persistence');
  async function wiring(text,{custom=false}={}){
    const {s:core}=harness(['transaction-core']);if(text)vm.runInContext(text,core);const t=core.GH_TRANSACTION_CORE,log=[];let open;
    const gate=new Promise(resolve=>{open=resolve;});core.GH_FLEET_DATA={size:()=>0};
    core.GH_FLEET_VALIDATION_PROVIDER=(_draft,_params,{beforeAsync}={})=>{beforeAsync?.();return gate;};
    core.GH_SAVE_SCHEMA={*validationSteps(draft,options){let done=false;options.fleetValidation(draft,{}).then(()=>{done=true;});while(!done)yield 'fleet-validation-wait';log.push('validated');return {ok:true,errors:[]};}};
    const persist=async(_draft,meta)=>{log.push(`persist:${meta.staging?'staging':'none'}`);await meta.staging?.settled;return {ok:true,stagingWaitMs:7};};
    core.GH_PERSISTENCE={commitDurableState:persist};
    const prestage=()=>{log.push('prestage');let finish;const settled=new Promise(resolve=>{finish=resolve;});setTimeout(()=>{log.push('prestage-settled');finish({ok:true,uploads:2,bytes:8,wallMs:3});},20);return {settled,planned:Promise.resolve(new Set()),release(){log.push('release');return settled;}};};
    setTimeout(open,5);const live={saveRevision:1,cash:1};
    const out=await t.executeDurable(live,{yieldToHost:()=>Promise.resolve(),prestage,apply:draft=>{draft.changed=true;},...(custom?{persist}:{})});
    return {committed:out.committed,log,timing:t.telemetry().lastDurable};
  }
  await test('4: executeDurable persists before the staging settles, records it, and keeps the previous order for a custom persist',async()=>{
    const current=await wiring(null);assert.equal(current.committed,true);
    assert.deepEqual(current.log,['prestage','validated','persist:staging','prestage-settled','release'],current.log.join(','));
    assert.equal(current.timing.prestageWaitMs,7,'the wait inside the persistence is recorded');assert.equal(current.timing.prestageOk,true);assert.equal(current.timing.prestageUploads,2);
    const custom=await wiring(null,{custom:true});assert.deepEqual(custom.log,['prestage','validated','prestage-settled','persist:none','release'],custom.log.join(','));
    const previous=await wiring(source.replace(CURRENT,'const stagingInPersist=false;'));
    assert.deepEqual(previous.log,['prestage','validated','prestage-settled','persist:none','release'],'the previous wiring waits for the staging first');
    return {current:current.log.join('>'),custom:custom.log.join('>'),previous:previous.log.join('>')};
  });

  const passed=results.filter(r=>r.ok).length;
  console.log(JSON.stringify({suite:'build534-staged-save-overlap',passed,total:results.length,results},null,2));
  if(passed!==results.length)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
