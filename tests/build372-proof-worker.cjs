'use strict';
// Build 372: archived proof maintenance computes canonical content and SHA in a worker-sized batch. This test calls the
// worker entry directly, then commits its answer through the same short transaction app.js uses. The synchronous owner
// remains the differential oracle.
const assert=require('node:assert/strict'),path=require('node:path'),ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {scenario}=require(path.join(ROOT,'tests/helpers/business-scenario'));
const {legacyLiveRecords}=require(path.join(ROOT,'tests/helpers/legacy-proof-records'));

function world({verify=true}={}){
  const e=scenario(),s=e.s,state=e.state,TX=s.GH_TRANSACTION_CORE,Proof=s.GH_DOCUMENT_PROOF;state.godMoney=true;state.infiniteMoney=true;
  for(let index=0;index<12;index++)TX.execute(state,{label:`proof-worker-seed-${index}`,apply:()=>{const cheque=e.command('finance','issue-cheque',{company:'air',amount:500+index,beneficiary:'Supplier LLC',note:'proof worker',requestRef:`PW-${index}`});e.command('finance','settle-cheque',{id:cheque.id});}});
  const finance=state.finance,archive=finance.auditArchive=finance.auditArchive||{records:{},digests:[]};archive.records=archive.records||{};const moving=finance.cheques.slice(4).map(row=>structuredClone(row));archive.records.cheques=moving;finance.cheques.length=4;TX.sealCollections(state);
  assert.ok(moving.length>=8);if(verify)assert.ok(moving.every(row=>Proof.verifyDocument(state,row).ok));
  return {e,s,state,TX,Proof,Schema:s.GH_SAVE_SCHEMA};
}

// level:'root' captures only the proof root. It must not enumerate a large child map, and rollback restores its exact
// reference after the owner replaces that property.
{
  const w=world(),records=w.state.documentProofs.recordsById,guard=new Proxy(records,{ownKeys(){throw new Error('qa-child-map-enumerated');}});w.state.documentProofs.recordsById=guard;
  assert.throws(()=>w.TX.execute(w.state,{label:'proof-root-only-capture',scope:['documentProofs'],writeRoots:['documentProofs'],rowRoots:{documentProofs:{level:'root'}},apply:()=>{w.state.documentProofs.recordsById={};throw new Error('qa-root-rollback');}}),/qa-root-rollback/);
  assert.equal(w.state.documentProofs.recordsById,guard,'root rollback restores the exact child without listing it');
}
const ids=plan=>plan.jobs.map(row=>row.document.documentProofId),json=value=>JSON.stringify(value);
function workerRound(w,limit=2,mutateAnswers=null){
  const plan=w.Proof.prepareArchivedRecords(w.state,{limit}),answers=plan.jobs.map(job=>w.Proof.hashArchivedCandidate(structuredClone(job)));if(mutateAnswers)mutateAnswers(answers,plan);
  let out;const tx=w.TX.execute(w.state,{label:'proof-worker-commit',scope:['documentProofs'],writeRoots:['documentProofs'],rowRoots:{documentProofs:{level:'root'}},apply:()=>{out=w.Proof.commitArchivedRecords(w.state,plan,answers);}});assert.equal(tx.committed,true);return {plan,answers,out};
}

// Exact state parity with the synchronous implementation, round by round.
{
  const sync=world(),worker=world();let converted=0;
  for(let round=0;round<20;round++){
    let expected;sync.TX.execute(sync.state,{label:'proof-sync-oracle',scope:['documentProofs'],writeRoots:['documentProofs'],rowRoots:{documentProofs:{level:'root'}},apply:()=>{expected=sync.Proof.compactArchivedRecords(sync.state,{limit:2});}});
    const actual=workerRound(worker,2).out;assert.equal(actual.compacted,expected.compacted,`round ${round}: count`);assert.equal(json(worker.state.documentProofs),json(sync.state.documentProofs),`round ${round}: proof store`);converted+=actual.compacted;if(!actual.compacted)break;
  }
  assert.equal(converted,worker.state.finance.auditArchive.records.cheques.length);assert.equal(worker.Schema.validate(worker.state).ok,true);assert.equal(sync.Schema.validate(sync.state).ok,true);
}

// A result for replaced containers is stale and cannot publish anything.
{
  const w=world(),plan=w.Proof.prepareArchivedRecords(w.state,{limit:2}),answers=plan.jobs.map(job=>w.Proof.hashArchivedCandidate(structuredClone(job))),before=json(w.state.documentProofs);w.state.documentProofs.recordsById={...w.state.documentProofs.recordsById};
  let out;w.TX.execute(w.state,{label:'proof-worker-stale',scope:['documentProofs'],writeRoots:['documentProofs'],rowRoots:{documentProofs:{level:'root'}},apply:()=>{out=w.Proof.commitArchivedRecords(w.state,plan,answers);}});assert.equal(out.stale,true);assert.equal(json(w.state.documentProofs),before);
}

// The schema preflight certifies the same exact sealed pairs in worker batches without rewriting the proof store. Once
// the exact archive/map versions are covered, the next preflight is an identity memo hit.
{
  const w=world({verify:false});w.state=structuredClone(w.state);w.TX.sealCollections(w.state);const before=json(w.state.documentProofs);let cursor=null,verified=0,rounds=0,done=false;
  while(!done){const plan=w.Proof.prepareArchivedVerification(w.state,{cursor,limit:3,scan:4}),answers=plan.jobs.map(job=>w.Proof.hashArchivedCandidate(structuredClone(job))),out=w.Proof.commitArchivedVerification(w.state,plan,answers);assert.equal(out.stale,undefined);assert.equal(out.invalid,undefined);verified+=out.verified;cursor=out.cursor;done=out.done;rounds++;assert.ok(rounds<20);}
  assert.equal(verified,w.state.finance.auditArchive.records.cheques.length);assert.equal(json(w.state.documentProofs),before,'verification certificates do not rewrite state');
  const authorization=w.s.GH_AUTHORIZATION;let mainDigestCalls=0;w.s.GH_AUTHORIZATION={...authorization,digest(value){mainDigestCalls++;return authorization.digest(value);}};try{assert.ok(w.state.finance.auditArchive.records.cheques.every(document=>w.Proof.verifyDocument(w.state,document).ok));}finally{w.s.GH_AUTHORIZATION=authorization;}assert.equal(mainDigestCalls,0,'certified sealed pairs do not rebuild SHA on the main thread');assert.equal(w.Schema.validate(w.state).ok,true);assert.equal(w.Schema.telemetry().lastValidation.documentProofWork.documentSerializationRows,0,'sealed exact pairs are still verified without serializing whole documents on the main thread');
  const memo=w.Proof.prepareArchivedVerification(w.state,{limit:3,scan:4});assert.equal(memo.memo,true);assert.equal(memo.jobs.length,0);
}

// A verification certificate also refuses an archive list replaced while its worker batch was in flight.
{
  const w=world({verify:false}),plan=w.Proof.prepareArchivedVerification(w.state,{limit:2}),answers=plan.jobs.map(job=>w.Proof.hashArchivedCandidate(structuredClone(job))),archive=w.state.finance.auditArchive,base=archive.records.cheques,next=base.slice();w.TX.deriveContainer(next,base,{changed:[]});archive.records={...archive.records,cheques:next};w.TX.sealCollections(w.state);
  const out=w.Proof.commitArchivedVerification(w.state,plan,answers);assert.equal(out.stale,true);assert.equal(out.verified,0);
}

// A changed worker digest is fail closed.
{
  const w=world(),before=json(w.state.documentProofs),round=workerRound(w,2,answers=>{answers[0]={...answers[0],contentDigest:'0'.repeat(64)};});assert.ok(round.out.compacted<round.plan.jobs.length);const changed=round.plan.jobs.filter(job=>w.Proof.record(w.state,job.document.documentProofId)?.form===w.Proof.ARCHIVED_FORM_V2).length;assert.equal(changed,round.out.compacted);assert.notEqual(round.out.compacted,round.plan.jobs.length);assert.equal(w.Schema.validate(w.state).ok,true);assert.ok(json(w.state.documentProofs)!==before||round.out.compacted===0);
}

// Root rollback restores the exact child maps and the archived-pass cursor; retry selects the same records.
{
  const w=world(),plan=w.Proof.prepareArchivedRecords(w.state,{limit:2}),answers=plan.jobs.map(job=>w.Proof.hashArchivedCandidate(structuredClone(job))),before=json(w.state.documentProofs),children=Object.fromEntries(Object.entries(w.state.documentProofs).filter(([,value])=>value&&typeof value==='object'));
  assert.throws(()=>w.TX.execute(w.state,{label:'proof-worker-rollback',scope:['documentProofs'],writeRoots:['documentProofs'],rowRoots:{documentProofs:{level:'root'}},apply:()=>{const out=w.Proof.commitArchivedRecords(w.state,plan,answers);assert.equal(out.compacted,2);throw new Error('qa-proof-worker-rollback');}}),/qa-proof-worker-rollback/);
  assert.equal(json(w.state.documentProofs),before);for(const [key,value] of Object.entries(children))assert.equal(w.state.documentProofs[key],value,key);
  const retry=w.Proof.prepareArchivedRecords(w.state,{limit:2});assert.deepEqual(ids(retry),ids(plan),'rollback restores the pass cursor');
}

// The live conversion cursor is writer state too: an injected rollback must retry the exact same documents instead of
// silently starting after them.
{
  const w=world(),legacy=legacyLiveRecords(w.Proof,w.state);assert.ok(legacy.length>=4);let attempted=[];
  assert.throws(()=>w.TX.execute(w.state,{label:'proof-live-cursor-rollback',scope:['documentProofs'],writeRoots:['documentProofs'],rowRoots:{documentProofs:{level:'root'}},apply:()=>{const before=new Map(legacy.map(id=>[id,w.Proof.record(w.state,id)]));const out=w.Proof.compactLiveRecords(w.state,{limit:2,scan:8});assert.equal(out.compacted,2);attempted=legacy.filter(id=>w.Proof.record(w.state,id)!==before.get(id));throw new Error('qa-live-cursor-rollback');}}),/qa-live-cursor-rollback/);
  const before=new Map(legacy.map(id=>[id,w.Proof.record(w.state,id)])),retry=w.Proof.compactLiveRecords(w.state,{limit:2,scan:8}),converted=legacy.filter(id=>w.Proof.record(w.state,id)!==before.get(id));assert.equal(retry.compacted,2);assert.deepEqual(converted,attempted,'live retry starts at the rolled-back cursor');
}

console.log('BUILD372_PROOF_WORKER_PASS');
