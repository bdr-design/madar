'use strict';
// Build 362 follow-up (iPhone diagnostic DX-1792142505027, 980,000 assets): a player decision held the calendar ~3.9 s,
// ~2.0 s waiting for the fleet worker's save validation, then ~1.4 s uploading ~127 MB of fleet chunks. A durable command
// may now upload its draft's chunks while the validation runs (GH_PERSISTENCE.prestageDurableChunks). Proven here, with a
// stand-in vault that refuses a commit listing a missing chunk:
// - staging uploads chunks and never commits; the commit that follows uploads nothing staging already uploaded and
//   saves exactly the state it was handed;
// - a command that does not commit releases its staged ids, so a vault that collected them cannot be trusted later;
// - a vault reset during staging leaves nothing trusted; staging is skipped where it cannot help.
// Part 2 (transaction-core.executeDurable): staging starts after apply and before validation; the commit waits for it
// and only runs after every check; a refused validation never persists and still releases the staging.
const assert=require('node:assert/strict'),path=require('node:path'),crypto=require('node:crypto');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {scenario}=require(path.join(ROOT,'tests/helpers/business-scenario'));
const {harness}=require(path.join(ROOT,'tests/helpers/core-harness'));
const e=scenario(),s=e.s,state=e.state,FLEET=s.GH_FLEET_DATA,STORE=s.GH_FLEET_STORE,TX=s.GH_TRANSACTION_CORE;
e.load('migration-core');e.load('state-codec-core');e.load('persistence-core');
e.load('fleet-save-validation-core');e.load('fleet-query-core');
s.GH_FLEET_VALIDATION_PROVIDER=(target,params)=>s.GH_FLEET_QUERY.run('saveValidation',{fleet:target.fleet,simSeconds:Number(target.simSeconds)||0},s.GH_FLEET_DATA,params);
const P=s.GH_PERSISTENCE,CODEC=s.GH_STATE_CODEC,results=[];
async function test(name,fn){try{results.push({name,ok:true,detail:await fn()});}catch(error){results.push({name,ok:false,error:String(error.stack||error).slice(0,2000)});}}

// ---- stand-in native vault (the GlobalSaveVault contract of build358-native-chunked-save) --------------------------
const vault={chunks:new Map(),saves:[],messages:[],generation:0,holdChunkAcks:null};
const sha=text=>crypto.createHash('sha256').update(text,'utf8').digest('hex');
function referenced(json){const root=JSON.parse(json),rows=root?.fleet?.rows;return [...(rows?.$ghBinary==='chunks-v1'?rows.chunks:[]),...(Array.isArray(root?.stateCodec?.chunks)?root.stateCodec.chunks:[])];}
function deliver(name,detail){setTimeout(()=>s.dispatchEvent(new s.CustomEvent(name,{detail})),0);}
const bridge={postMessage(message){
  vault.messages.push({action:message.action,id:message.id});
  if(message.action==='storeSaveChunk'){
    const bytes=Buffer.from(message.base64,'base64');
    const ack=()=>{const prior=vault.chunks.get(message.id);if(prior&&!prior.equals(bytes))return deliver('gh-native-chunk-ack',{requestId:message.requestId,id:message.id,success:false,message:'Save chunk id reused with other bytes.'});vault.chunks.set(message.id,bytes);deliver('gh-native-chunk-ack',{requestId:message.requestId,id:message.id,success:true});};
    if(vault.holdChunkAcks)vault.holdChunkAcks.push(ack);else ack();return;
  }
  if(message.action==='commitSave'){
    const missing=referenced(message.saveJSON).find(id=>!vault.chunks.has(id)),ok=!missing&&sha(message.saveJSON)===message.saveHash;
    if(ok)vault.saves.push(message.saveJSON);
    deliver('gh-native-save-ack',{requestId:message.requestId,action:message.action,saveRevision:message.saveRevision,resetEpoch:message.resetEpoch,saveSchemaVersion:message.saveSchemaVersion,saveHash:message.saveHash,success:ok,generation:ok?++vault.generation:undefined,message:missing?`Missing save chunk: ${missing}`:ok?'':'bad hash'});
  }
}};
s.webkit={messageHandlers:{saveBridge:bridge,updateBridge:bridge}};
const uploads=()=>vault.messages.filter(m=>m.action==='storeSaveChunk');
const commits=()=>vault.messages.filter(m=>m.action==='commitSave');
const resetLog=()=>{vault.messages.length=0;};
// What GlobalSaveVault's collector may delete once the grace period has passed: every chunk no committed save lists.
const collectUnreferenced=()=>{const kept=new Set(vault.saves.flatMap(referenced));let removed=0;for(const id of [...vault.chunks.keys()])if(!kept.has(id)){vault.chunks.delete(id);removed++;}return removed;};

// ---- a real fleet over two store chunks ---------------------------------------------------------------------------
state.godMoney=true;state.infiniteMoney=true;state.advanced.facilities.B1.capacity=1e7;
const base=state.globalBases.find(row=>row.id==='B1');base.deliveryCapacity=1e7;const item=e.item;
const total=item.price*3000;
assert.equal(TX.execute(state,{label:'prestage-buy',apply:()=>s.GH_PROCUREMENT_CORE.withPurchaseBatch(state,()=>{const r=e.command('procurement','purchase-assets',{type:'air',ownerCompanyId:'air',tab:'new',item,base,supplier:{id:'S1',name:'Supplier',legalName:'Supplier LLC'},mode:'cash',qty:3000,manual:true,requestRef:'PRESTAGE-1',upfront:total,totalPrice:total,paymentMethod:'cash',documentLeadDays:1,leadSeconds:0,immediateDelivery:true});s.GH_REALISM.onSimulationTime(state,state.simSeconds);return r;})}).committed,true);
if(FLEET.mode(state)!=='store')s.GH_MIGRATION_CORE.migrateFleet(state);
TX.execute(state,{label:'prestage-grow',scope:['fleet'],apply:()=>{const template=FLEET.plain(state,FLEET.list(state)[0].id);for(let i=0;i<STORE.CHUNK_ROWS+2000;i++)FLEET.add(state,{...template,id:`N-AIR-PRE-${String(i).padStart(6,'0')}`,name:`GH AIR PRE ${i}`});}});
const key='build362-durable-prestage',yieldToFrame=()=>new Promise(resolve=>setTimeout(resolve,0));
const touchBothChunks=(fuel)=>TX.execute(state,{label:`touch-${fuel}`,scope:['fleet'],apply:()=>{STORE.set(state.fleet,3,'fuel',fuel);STORE.set(state.fleet,STORE.CHUNK_ROWS+3,'fuel',fuel+1);}});
async function durableCommit(target){const previous=Number(target.saveRevision)||0;target.saveRevision=previous+1;return P.commitDurableState(target,{storageKey:key,prevalidated:true,expectedPreviousRevision:previous,yieldToFrame});}

(async()=>{
  // A first committed save: the vault then holds every chunk of the current state.
  await P.commitState(state,{storageKey:key}).native;

  await test('staging uploads the changed chunks, never commits, and the commit after it uploads none of them',async()=>{
    touchBothChunks(21);resetLog();
    const staging=P.prestageDurableChunks(state,{yieldToFrame});assert(staging,'staging applies to a large native fleet');
    const staged=await staging.settled;assert.equal(staged.ok,true,staged.reason);
    assert(staged.uploads>=2,'both changed fleet chunks were staged');assert.equal(commits().length,0,'staging commits nothing');
    const stagedIds=uploads().map(m=>m.id);resetLog();
    const expected=new Uint8Array(state.fleet.rows.slice(0)),out=await durableCommit(state);assert.equal(out.ok,true);
    assert.equal(commits().length,1);assert.deepEqual(uploads().map(m=>m.id).filter(id=>stagedIds.includes(id)),[],'nothing staged is uploaded again');
    const json=vault.saves.at(-1);assert(stagedIds.every(id=>referenced(json).includes(id)),'the commit lists the staged chunks');
    await staging.release();
    const loaded=CODEC.deserialize(json,{resolveChunk:id=>vault.chunks.get(id)});assert.deepEqual(new Uint8Array(loaded.fleet.rows),expected,'the vault rebuilds exactly the committed rows');
    // Ids the commit lists stay known after release: an unchanged next save uploads nothing.
    resetLog();await durableCommit(state);assert.equal(uploads().length,0,'the committed staging is trusted afterwards');
    return {staged:staged.uploads,stagedBytes:staged.bytes,commitUploads:0};
  });

  await test('a command that does not commit releases its staging; a vault that collected it is not trusted later',async()=>{
    touchBothChunks(31);resetLog();const before=P.vaultChunkCount();
    const staging=P.prestageDurableChunks(state,{yieldToFrame}),staged=await staging.settled;assert.equal(staged.ok,true,staged.reason);assert(staged.uploads>=2);
    assert.equal(P.vaultChunkCount(),before+staged.uploads,'staged ids are known while the command runs');
    // Validation refused: the command releases instead of committing.
    await staging.release();assert.equal(P.vaultChunkCount(),before,'released ids are forgotten');assert.equal(commits().length,0);
    const removed=collectUnreferenced();assert(removed>=2,'the vault collected the unreferenced uploads');
    resetLog();const out=await durableCommit(state);assert.equal(out.ok,true,'the next commit uploads what it needs instead of failing on a missing chunk');
    assert(uploads().length>=2);return {released:staged.uploads,collected:removed,reuploaded:uploads().length};
  });

  await test('a vault reset during staging leaves nothing trusted',async()=>{
    touchBothChunks(41);resetLog();vault.holdChunkAcks=[];
    const staging=P.prestageDurableChunks(state,{yieldToFrame});
    for(let i=0;i<200&&!vault.holdChunkAcks.length;i++)await new Promise(resolve=>setTimeout(resolve,1));
    assert(vault.holdChunkAcks.length>0,'an upload is in flight');P.forgetVaultChunks();
    for(let i=0;i<50&&vault.holdChunkAcks?.length;i++){const held=vault.holdChunkAcks;vault.holdChunkAcks=[];held.forEach(f=>f());await new Promise(resolve=>setTimeout(resolve,1));}
    vault.holdChunkAcks=null;const staged=await staging.settled;await staging.release();
    assert.equal(staged.ok,false);assert.equal(staged.reason,'prestage-vault-changed');assert.equal(P.vaultChunkCount(),0,'no id uploaded across the reset is trusted');
    resetLog();assert.equal((await durableCommit(state)).ok,true);return {reason:staged.reason,uploadsAfterReset:uploads().length};
  });

  await test('a released staging stops, and a fleet change during staging asks for no fresh validation',async()=>{
    const provider=s.GH_FLEET_VALIDATION_PROVIDER;let validations=0;s.GH_FLEET_VALIDATION_PROVIDER=(...args)=>{validations++;return provider(...args);};
    try{
      // Released while uploads are held: it stops before the next upload and trusts nothing it sent.
      touchBothChunks(51);resetLog();vault.holdChunkAcks=[];const before=P.vaultChunkCount();
      const first=P.prestageDurableChunks(state,{yieldToFrame});
      for(let i=0;i<200&&!vault.holdChunkAcks.length;i++)await new Promise(resolve=>setTimeout(resolve,1));
      assert.equal(vault.holdChunkAcks.length,1,'one upload in flight');const released=first.release();
      const held=vault.holdChunkAcks;vault.holdChunkAcks=null;held.forEach(f=>f());
      const stopped=await first.settled;await released;
      assert.equal(stopped.ok,false);assert.equal(stopped.reason,'prestage-released');assert.equal(uploads().length,1,'no upload after the release');
      assert.equal(P.vaultChunkCount(),before,'the in-flight upload is not trusted');
      // A fleet write between staging slices (a rollback, for instance) ends the staging; it never retakes with validation.
      // A coarse clock makes every serialization step a full slice, so the staging yields between steps.
      touchBothChunks(61);resetLog();let writes=0,fake=0;const performance=s.performance;s.performance={now:()=>(fake+=20)};
      let changed;try{
        const second=P.prestageDurableChunks(state,{yieldToFrame:async()=>{await yieldToFrame();if(!writes++)touchBothChunks(71);}});
        changed=await second.settled;await second.release();
      }finally{s.performance=performance;}
      assert(writes>0,'the staging yielded while serializing');
      assert.equal(changed.ok,false);assert.equal(changed.reason,'state-codec-fleet-changed-during-save');assert.equal(validations,0,'no fleet validation was requested');
      resetLog();assert.equal((await durableCommit(state)).ok,true,'the commit still saves the current rows');
      return {firstReason:stopped.reason,secondReason:changed.reason,validations};
    }finally{s.GH_FLEET_VALIDATION_PROVIDER=provider;vault.holdChunkAcks=null;}
  });

  await test('the periodic sliced save does not stage: a write during its validation takes the retake',async()=>{
    touchBothChunks(81);resetLog();const started=Date.now();
    const out=await P.commitStateSliced(state,{storageKey:key,yieldToFrame});assert.equal(out.ok,true,out.reason);
    const rows=P.telemetry().timings.samples.filter(row=>row.recordedAtMs>=started);
    assert.equal(rows.filter(row=>row.kind==='durable-prestage').length,0,'no staging ran');assert.equal('prestageWaitMs' in rows.find(row=>row.kind==='sliced-save'),false);
    return {commits:commits().length};
  });

  await test('staging is skipped where it cannot help and never throws',async()=>{
    assert.equal(P.prestageDurableChunks(state,{}),null,'no frame scheduler');
    assert.equal(P.prestageDurableChunks({...state,fleet:{rows:[]}},{yieldToFrame}),null,'no binary fleet');
    const small=TX.deepClone(state);small.fleet={...state.fleet,length:100};
    assert.equal(P.prestageDurableChunks(small,{yieldToFrame}),null,'a fleet the main thread saves directly');
    return {skipped:3};
  });

  // ---- Part 2: the order inside transaction-core.executeDurable --------------------------------------------------
  await test('executeDurable stages after apply, commits only after every check, and releases either way',async()=>{
    const {s:core}=harness(['transaction-core']),t=core.GH_TRANSACTION_CORE,log=[];let validationGate=null;
    core.GH_FLEET_DATA={size:()=>0};
    core.GH_SAVE_SCHEMA={*validationSteps(draft){log.push('validate-start');let done=false;validationGate.then(()=>{done=true;});while(!done)yield 'fleet-validation-wait';log.push('validate-end');return {ok:!draft.invalid,errors:draft.invalid?['injected-invalid']:[]};}};
    const prestage=draft=>{log.push(`prestage:${draft.changed===true}`);let finish;const settled=new Promise(resolve=>{finish=resolve;});setTimeout(()=>{log.push('prestage-settled');finish({ok:true,uploads:2,bytes:8,wallMs:3});},5);return {settled,release(){log.push('release');return settled;}};};
    const run=async invalid=>{log.length=0;let open;validationGate=new Promise(resolve=>{open=resolve;});setTimeout(open,15);
      return t.executeDurable(live,{yieldToHost:()=>Promise.resolve(),prestage,apply:draft=>{log.push('apply');draft.changed=true;if(invalid)draft.invalid=true;},persist:async()=>{log.push('persist');return {ok:true};}});};
    const live={saveRevision:1,cash:1},result=await run(false);assert.equal(result.committed,true);
    assert.deepEqual(log,['apply','prestage:true','validate-start','prestage-settled','validate-end','persist','release'],log.join(','));
    const timing=t.telemetry().lastDurable;assert.equal(timing.prestageOk,true);assert.equal(timing.prestageUploads,2);assert.equal(typeof timing.prestageWaitMs,'number');
    const stable=JSON.stringify(live);
    await assert.rejects(run(true),/invalid-draft:injected-invalid/);assert.equal(JSON.stringify(live),stable,'the live state is untouched');
    assert(!log.includes('persist'),'a refused validation never persists');assert(log.includes('release'),'a refused command releases its staging');
    const plain=await t.executeDurable(live,{yieldToHost:()=>Promise.resolve(),prestage:()=>{throw new Error('staging-owner-broken');},apply:draft=>{draft.more=true;},persist:async()=>({ok:true})});
    assert.equal(plain.committed,true,'a broken staging owner never blocks the command');
    return {order:'apply>prestage>validate>persist>release'};
  });

  const passed=results.filter(r=>r.ok).length;
  console.log(JSON.stringify({suite:'build362-durable-prestage',passed,total:results.length,results},null,2));
  if(passed!==results.length)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
