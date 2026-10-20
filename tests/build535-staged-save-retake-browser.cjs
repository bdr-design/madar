'use strict';
// build534 proves the staged-save overlap on the persistence owner with a stand-in vault and no save workers. This runs the
// device path in the full app: the fleet engine worker, the save checksum and encoding workers, row patches, value chunks
// and packed lane containers (as GlobalSaveVault advertises them), with the native vault protocol test double, while play
// runs. A player decision's staging has its first upload refused after it planned its chunks; the decision must still
// commit once: its save serialized again without trusting the staging (stagingRetakes 1), every chunk it lists stored in
// the vault, and the stored save decoding to the committed state.
const assert=require('node:assert/strict'),path=require('node:path'),{chromium,webkit}=require('playwright');
const {bootAtOrigin,installVault}=require('./helpers/differential-vault-fixture.cjs'),fixture=require('./helpers/request-decisions-fixture.cjs');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..'),results=[];
(async()=>{
  for(const engine of process.env.GH_REQUEST_ENGINE==='chromium'?[chromium]:[chromium,webkit]){
    const browser=await engine.launch({headless:true}),errors=[];let env;
    try{
      env=await bootAtOrigin({browser,root:ROOT,errors,fleetWorker:true,measureSyncWork:true,viewport:{width:956,height:440},beforeScripts:{fn:installVault}});const {page}=env;page.setDefaultTimeout(120000);
      const world=await fixture.prepare(page);assert.equal(world.rows,4400);await page.evaluate(()=>__AUDIT__.whenStateIdle());await fixture.installTrace(page);
      // One refusal, armed when the decision starts its staging: the next chunk upload (the staging's first) is refused.
      await page.evaluate(()=>{
        const persistence=GH_PERSISTENCE;window.GH_PERSISTENCE={...persistence,prestageDurableChunks(...args){const staging=persistence.prestageDurableChunks(...args);if(staging&&window.__QA_ARM__){window.__QA_ARM__=false;window.__QA_REFUSE_NEXT__=true;}return staging;}};
        const bridge=window.webkit.messageHandlers.saveBridge,post=bridge.postMessage;
        bridge.postMessage=function(message){if(message.action==='storeSaveChunk'&&window.__QA_REFUSE_NEXT__){window.__QA_REFUSE_NEXT__=false;window.__QA_REFUSED__=message.id;const q=__DIFF_VAULT__,mode=q.mode;q.mode='chunk-nack';try{return post.call(this,message);}finally{q.mode=mode;}}return post.call(this,message);};
      });
      for(const [seq,kind] of ['bank','insurance'].entries()){
        // The fixture seeds while idle; play then runs so the decision's fleet validation waits for the worker and stages.
        await page.evaluate(async()=>{__AUDIT__.setSpeed(0);await __AUDIT__.whenStateIdle();});await fixture.seed(page,{kind,decision:'accept',count:2,seq});
        await page.evaluate(()=>__AUDIT__.setSpeed(3));await page.waitForTimeout(2500);
        const button=await fixture.open(page,{kind,decision:'accept',panel:kind});
        // Rows written since the last save: the staging has chunks to upload (a background save may have caught up with play).
        await page.evaluate(seq=>{const s=__GH_STATE__,store=s.fleet;GH_TRANSACTION_CORE.execute(s,{label:'qa-retake-touch',scope:['fleet'],apply:()=>{for(const row of [3,1200,4100])GH_FLEET_STORE.set(store,row,'fuel',40+seq+row%7);}});window.__QA_REFUSED__=null;window.__QA_REFUSE_NEXT__=false;window.__QA_ARM__=true;},seq);
        await fixture.press(page,button);await fixture.waitFinished(page);
        const out=await page.evaluate(()=>{
          const q=__DIFF_VAULT__,samples=GH_PERSISTENCE.telemetry().timings.samples,prestage=samples.filter(r=>r.kind==='durable-prestage').at(-1),save=samples.filter(r=>r.kind==='durable-save').at(-1);
          const root=JSON.parse(q.head),listed=[...(root.fleet?.rows?.chunks||[]),...(root.stateCodec?.chunks||[])],restored=GH_STATE_CODEC.deserialize(q.head,{resolveChunk:id=>q.chunks.get(id)});
          return {committed:__REQUEST_TRACE__.calls[0]?.receipt?.committed===true,error:__REQUEST_TRACE__.calls[0]?.error||null,refused:window.__QA_REFUSED__,attempts:q.attempts.map(a=>a.ok),
            prestageOk:prestage?.ok,prestageReason:prestage?.reason||null,prestageUploads:prestage?.uploads,retakes:save?.stagingRetakes||0,planWait:save?.stagingPlanWaitMs??null,
            missing:listed.filter(id=>!q.chunks.has(id)),savedRevision:restored.saveRevision,liveRevision:__GH_STATE__.saveRevision,savedRows:GH_FLEET_DATA.size(restored),liveRows:GH_FLEET_DATA.size(__GH_STATE__)};
        });
        assert(out.refused,`${engine.name()} ${kind}: the decision staged and its first upload was refused (${JSON.stringify(out)})`);
        assert.equal(out.prestageOk,false,'the staging failed');assert.equal(out.committed,true,`the decision committed (${JSON.stringify(out)})`);
        assert.deepEqual(out.attempts,[true],'one commit, accepted by the vault');assert.equal(out.retakes,1,'the save was serialized again without trusting the staging');
        assert.deepEqual(out.missing,[],'every chunk the save lists is stored');assert.equal(out.savedRevision,out.liveRevision,'the stored save is the committed revision');assert.equal(out.savedRows,out.liveRows);
        results.push({engine:engine.name(),kind,refused:out.refused,prestageReason:out.prestageReason,retakes:out.retakes});console.log('PASS',engine.name(),kind);
      }
      await page.evaluate(()=>__AUDIT__.setSpeed(0));
      assert.deepEqual(errors,[]);
    }finally{await browser.close();await env?.closeOrigin?.();}
  }
  console.log(JSON.stringify({suite:'build535-staged-save-retake-browser',ok:true,results}));
})().catch(error=>{console.error(error);process.exit(1);});
