'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium,webkit}=require('playwright'),{boot}=require('./helpers/local-dom-app');
const results=[];
(async()=>{for(const engine of [chromium,webkit]){
 const browser=await engine.launch({headless:true}),errors=[];let page;
 try{
  ({page}=await boot({browser,errors}));page.setDefaultTimeout(15000);
  await page.evaluate(async()=>{
   const s=__GH_STATE__;s.speed=0;s.godMoney=true;s.infiniteMoney=true;
   await __AUDIT__.runAuthorizedDomainCommand('corporate','open-company',{type:'bank',capital:400000000,legalName:'QA Tracking Bank'},{silent:true});
   window.__TRACK_QA__={hold:false,mode:'ok',commits:[],pending:[],generation:0};
   // A refused command legitimately appends diagnostic/control-plane audit records. Fleet rollback advances its
   // revision to invalidate caches, while restoring the actual rows. Compare every other root and all fleet bytes.
   window.__TRACK_BUSINESS_SNAPSHOT__=s=>{const value=JSON.parse(JSON.stringify(s));delete value.diagnostics;delete value.controlPlane;if(value.fleet)delete value.fleet.revision;return JSON.stringify({value,fleetBytes:Array.from(new Uint8Array(s.fleet.rows))});};
   GH_NATIVE_BUILD=362;window.webkit={messageHandlers:{saveBridge:{postMessage(m){
    const q=__TRACK_QA__;
    if(m.action==='storeSaveChunk'){setTimeout(()=>dispatchEvent(new CustomEvent('gh-native-chunk-ack',{detail:{requestId:m.requestId,id:m.id,success:true}})),0);return;}
    if(m.action!=='commitSave')throw new Error('unexpected bridge action '+m.action);
    q.commits.push(m);const success=q.mode==='ok',generation=success?++q.generation:0;
    const ack=()=>dispatchEvent(new CustomEvent('gh-native-save-ack',{detail:{requestId:m.requestId,action:m.action,saveRevision:m.saveRevision,resetEpoch:m.resetEpoch,saveSchemaVersion:m.saveSchemaVersion,saveHash:m.saveHash,success,generation,message:success?null:'qa-tracking-nack'}}));
    if(q.hold)q.pending.push(ack);else setTimeout(ack,0);
   }}}};
  });
  const check=(name,detail)=>results.push({engine:engine.name(),name,...detail});
  let out=await page.evaluate(async()=>{
   const state=__GH_STATE__,c=GH_TRANSACTION_CORE.changeTracking;window.__TRACKING_OLD__=c.capture(state);
   const before=__TRACK_QA__.commits.length,out=GH_PERSISTENCE.commitState(state,{storageKey:'qa-tracking'});await out.native;
   return {ok:out.ok,writes:__TRACK_QA__.commits.length-before,pending:c.pending(state),metadataLeaked:/"(?:changeTracking|acknowledgedRevision|incrementalReady)"/.test(out.json)};
  });
  assert.equal(out.ok,true);assert.equal(out.writes,1);assert.equal(out.pending.unknown,false);assert.deepEqual(out.pending.roots,[]);assert.equal(out.pending.incrementalReady,false);assert.equal(out.metadataLeaked,false);check('ordinary ACK clears only its snapshot',out);
  await page.evaluate(()=>{
   const state=__GH_STATE__,q=__TRACK_QA__;q.hold=true;
   window.__TRACKING_WAIT__=GH_PERSISTENCE.commitState(state,{storageKey:'qa-tracking'}).native;
  });
  await page.waitForFunction(()=>__TRACK_QA__.pending.length===1);
  out=await page.evaluate(()=>{const state=__GH_STATE__,c=GH_TRANSACTION_CORE.changeTracking;state.profile={...state.profile,trackingNote:'after serialization'};c.touch(state,['profile']);return c.pending(state);});
  assert.equal(out.unknown,true);
  out=await page.evaluate(async()=>{const q=__TRACK_QA__;q.hold=false;q.pending.splice(0).forEach(fn=>fn());await __TRACKING_WAIT__;return GH_TRANSACTION_CORE.changeTracking.pending(__GH_STATE__);});
  assert.equal(out.unknown,false);assert.deepEqual(out.roots,['profile']);check('later write survives an older native ACK',out);
  out=await page.evaluate(async()=>{
   const state=__GH_STATE__,q=__TRACK_QA__,before=q.commits.length;
   const out=await GH_PERSISTENCE.commitStateSliced(state,{storageKey:'qa-tracking',yieldToFrame:()=>Promise.resolve()});
   return {ok:out.ok,writes:q.commits.length-before,pending:GH_TRANSACTION_CORE.changeTracking.pending(state),revision:state.saveRevision};
  });
  assert.equal(out.ok,true);assert.equal(out.writes,1);assert.equal(out.pending.unknown,false);assert.deepEqual(out.pending.roots,[]);check('sliced snapshot acknowledges its original live checkpoint',out);
  out=await page.evaluate(async()=>{
   const state=__GH_STATE__,c=GH_TRANSACTION_CORE.changeTracking,q=__TRACK_QA__,before=__TRACK_BUSINESS_SNAPSHOT__(state),token=c.capture(state),writes=q.commits.length;
   q.mode='nack';let rejected=false;try{await __AUDIT__.runAuthorizedDomainCommand('banking','set-risk-preset',{preset:'balanced'},{silent:true,idempotencyKey:'QA-TRACK-NACK'});}catch{rejected=true;}
   q.mode='ok';return {rejected,writes:q.commits.length-writes,sameState:__TRACK_BUSINESS_SNAPSHOT__(state)===before,changes:c.since(state,token)};
  });
  assert.equal(out.rejected,true);assert.equal(out.writes,1);assert.equal(out.sameState,true,JSON.stringify(out));assert.equal(out.changes.unknown,false);assert.deepEqual(out.changes.roots,[]);check('durable NACK discards private draft tracking and financial mutations',out);
  out=await page.evaluate(async()=>{
   const state=__GH_STATE__,c=GH_TRANSACTION_CORE.changeTracking,q=__TRACK_QA__,writes=q.commits.length,token=c.capture(state),revision=state.saveRevision;
   await __AUDIT__.runAuthorizedDomainCommand('banking','set-risk-preset',{preset:'balanced'},{silent:true,idempotencyKey:'QA-TRACK-ACK'});
   const after=q.commits.length,replay=await __AUDIT__.runAuthorizedDomainCommand('banking','set-risk-preset',{preset:'balanced'},{silent:true,idempotencyKey:'QA-TRACK-ACK'});
   return {writes:after-writes,replayWrites:q.commits.length-after,revisionDelta:state.saveRevision-revision,pending:c.pending(state),oldTokenRejected:!c.acknowledgeSnapshot(state,token),replayOK:replay.ok};
  });
  assert.equal(out.writes,1);assert.equal(out.replayWrites,0);assert.equal(out.revisionDelta,1);assert.equal(out.pending.unknown,true);assert.equal(out.oldTokenRejected,true);assert.equal(out.replayOK,true);check('durable publish invalidates old checkpoints and replay creates no save',out);
  out=await page.evaluate(async()=>{
   const state=__GH_STATE__,c=GH_TRANSACTION_CORE.changeTracking,q=__TRACK_QA__;
   const saved=GH_PERSISTENCE.commitState(state,{storageKey:'qa-tracking'});await saved.native;
   const before=__TRACK_BUSINESS_SNAPSHOT__(state),token=c.capture(state),writes=q.commits.length;let rejected=false;
   try{await __AUDIT__.runAuthorizedDomainCommand('banking','set-risk-preset',{preset:'invalid'},{silent:true,idempotencyKey:'QA-TRACK-INVALID'});}catch{rejected=true;}
   const integrity=GH_INTEGRITY_CORE.check(state);return {rejected,writes:q.commits.length-writes,sameState:__TRACK_BUSINESS_SNAPSHOT__(state)===before,changes:c.since(state,token),schema:GH_SAVE_SCHEMA.validate(state).ok,critical:(integrity.critical||integrity.issues.filter(x=>x.severity==='critical')).length};
  });
  assert.equal(out.rejected,true);assert.equal(out.writes,0);assert.equal(out.sameState,true,JSON.stringify(out));assert.equal(out.changes.unknown,false);assert.deepEqual(out.changes.roots,[]);assert.equal(out.schema,true);assert.equal(out.critical,0);check('domain refusal changes neither live tracking nor books',out);
  await page.evaluate(()=>{__TRACK_QA__.hold=true;window.__TRACKING_WAIT__=GH_PERSISTENCE.commitState(__GH_STATE__,{storageKey:'qa-tracking'}).native;});
  await page.waitForFunction(()=>__TRACK_QA__.pending.length===1);
  out=await page.evaluate(async()=>{
   const state=__GH_STATE__,tx=GH_TRANSACTION_CORE,q=__TRACK_QA__,copy=tx.deepClone(state),old=tx.changeTracking.capture(state);
   copy.profile={...copy.profile,trackingNote:'replacement after serialization'};tx.publishObject(state,copy);
   q.hold=false;q.pending.splice(0).forEach(fn=>fn());await __TRACKING_WAIT__;
   return {pending:tx.changeTracking.pending(state),oldTokenRejected:!tx.changeTracking.acknowledgeSnapshot(state,old),note:state.profile.trackingNote};
  });
  assert.equal(out.pending.unknown,true);assert.equal(out.oldTokenRejected,true);assert.equal(out.note,'replacement after serialization');check('late ACK cannot clear a replacement world',out);
  out=await page.evaluate(async()=>{
   const state=__GH_STATE__,q=__TRACK_QA__,c=GH_TRANSACTION_CORE.changeTracking;q.mode='nack';
   const saved=GH_PERSISTENCE.commitState(state,{storageKey:'qa-tracking'}),ack=await saved.native;
   return {ackOK:ack.ok,pending:c.pending(state),recovery:GH_PERSISTENCE.isLocked(),samePending:c.pending(state).unknown};
  });
  assert.equal(out.ackOK,false);assert.equal(out.pending.unknown,true);check('ordinary native NACK does not acknowledge the checkpoint',out);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
}
if(process.env.GH_CHANGE_TRACKING_RESULTS)fs.writeFileSync(process.env.GH_CHANGE_TRACKING_RESULTS,JSON.stringify(results,null,2)+'\n');
console.log(JSON.stringify({suite:'build388-change-tracking-browser',ok:true,engines:2,results}));
})().catch(error=>{console.error(error);process.exitCode=1;});
