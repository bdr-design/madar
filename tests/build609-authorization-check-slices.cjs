'use strict';
// Owner (build 106 iPhone diagnostic: the daily close's post-commit save check spent 28 ms in one step verifying the
// day's new authorization proofs; then «كمل حل الثقل بدقه»): the proof walk keeps its order and verifier and, past 4 ms of
// work, gives the frame back ('authorization-proofs'). On the real authorization, document proof, transaction, finance
// and save schema owners, with 120 authorized documents, against the source before (1d7dce1, from its own tree):
//  1. the full check answers exactly as the source before: a clean store (unverified, then trusted), a proof whose
//     payload digest was changed, a proof naming a missing seal, a proof naming a missing mandate;
//  2. with a clock that moves 0.5 ms a call, the staged check gives the frame back inside the proof walk (the source
//     before: never), and every other section is yielded in the same order as before;
//  3. no metric counts the time paused: a check whose pauses last 200 ms reports under 200 ms for authorization, and its
//     total equals the sum of its sections (both sources measured the same way).
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {harness,minimal}=require('./helpers/core-harness');
function scenario(){
  const {s}=harness(['capability-registry-core','company-definitions','company-platform-core','identity-system','control-plane-core','save-schema','authorization-core','document-proof-core','transaction-core','domain-command-core','finance-core']);
  const Auth=s.GH_AUTHORIZATION,Proof=s.GH_DOCUMENT_PROOF,Schema=s.GH_SAVE_SCHEMA;
  Auth.registerCommandTargetResolver('audit',()=>['group']);
  s.GH_DOMAIN_COMMANDS.register('audit',{execute(ctx,_name,payload){ctx.state.auditCount=(ctx.state.auditCount||0)+1;const document={id:`AUD-${ctx.state.auditCount}`,company:'group',counterparty:`Party ${payload.amount%7}`,amount:payload.amount,subtotal:payload.amount,tax:0,total:payload.amount,currency:'USD',issuedAt:ctx.state.simSeconds,note:'Check document'};Proof.sealDocument(ctx.state,document,{type:'audit-invoice',companyId:'group'});ctx.state.finance.invoices.unshift(document);return {document};}});
  const world=()=>{const state={...minimal(),saveVersion:'3.0.0',profile:{name:'Check Holdings',founder:'Check Founder'},companyRegistry:{},openedCompanies:[]};
    Auth.ensurePrincipal(state,{id:'founder',legalName:'Check Founder'});Auth.createVisualSeal(state,{ownerPersonId:'founder',strokes:[[{x:.1,y:.2},{x:.55,y:.65},{x:.9,y:.3}]]});Auth.createDefaultMandate(state,{principalId:'founder',companyIds:['*'],scopes:['audit.*']});s.GH_FINANCE_CORE.ensure(state);
    for(let i=0;i<120;i++){const envelope=Auth.buildActiveEnvelope(state,{domain:'audit',name:'post',payload:{amount:100+i},idempotencyKey:`B609-${i}`,actor:{principalId:'founder'}});const r=s.GH_DOMAIN_COMMANDS.dispatchEnvelope({state},envelope);if(!r.ok)throw new Error(JSON.stringify(r));}
    if(!s.GH_FLEET_STORE?.isStore?.(state.fleet)&&s.GH_FLEET_STORE){state.fleet=s.GH_FLEET_STORE.fromAssets([],{at:0});delete state.assets;}
    return state;};
  const answer=(state,options)=>{const r=Schema.validate(state,options);return JSON.stringify({ok:r.ok,errors:r.errors,reason:r.reason||null});};
  const out={answers:{},sections:null,metric:null};
  // 1.
  {const state=world();out.answers.clean=answer(state);out.answers.trusted=answer(state,{trustVerified:true});}
  const tamper={
    payload:state=>{const proofs=state.authorization.proofsById,id=Object.keys(proofs)[7];proofs[id]={...proofs[id],payloadDigest:'0'.repeat(64)};},
    seal:state=>{const proofs=state.authorization.proofsById,id=Object.keys(proofs)[11];proofs[id]={...proofs[id],signatureAssetId:'SIG-MISSING',visualSealAssetId:'SIG-MISSING'};},
    mandate:state=>{const proofs=state.authorization.proofsById,id=Object.keys(proofs)[3];proofs[id]={...proofs[id],mandateId:'MANDATE-MISSING'};}
  };
  for(const [name,edit] of Object.entries(tamper)){const state=world();edit(state);out.answers[name]=answer(state);out.answers[`${name}-trusted`]=answer(state,{trustVerified:true});}
  // 2-3. A clock that moves 0.5 ms a call (and 50 ms each time the walk is resumed after a pause).
  {const state=world(),real=s.performance;let now=0;s.performance={now:()=>(now+=0.5)};
    try{const steps=Schema.validationSteps(state,{trustVerified:false}),names=[];let step;while(!(step=steps.next()).done){names.push(String(step.value));if(names[names.length-1]==='authorization-proofs')now+=50;}
      out.sections={names,ok:step.value.ok};const m=Schema.telemetry().lastValidation;out.metric={authorizationMs:m.authorizationMs,totalMs:m.totalMs,pauses:names.filter(n=>n==='authorization-proofs').length};}
    finally{s.performance=real;}}
  return out;
}
if(process.env.QA_BUILD609_SCENARIO){process.stdout.write(JSON.stringify(scenario()));return;}
const ROOT=path.resolve(__dirname,'..'),PREVIOUS='1d7dce1',tree=fs.mkdtempSync(path.join(os.tmpdir(),'b609-'));
try{
  execFileSync('sh',['-c',`git -C "${ROOT}" archive ${PREVIOUS} WebApp | tar -x -C "${tree}"`]);
  const before=JSON.parse(execFileSync(process.execPath,[__filename],{env:{...process.env,GH_TEST_SOURCE_DIR:tree,QA_BUILD609_SCENARIO:'1'},maxBuffer:64*1024*1024}).toString());
  const now=scenario();
  // 1.
  assert.deepEqual(Object.keys(now.answers),Object.keys(before.answers));
  for(const name of Object.keys(now.answers))assert.equal(now.answers[name],before.answers[name],`1: ${name}: the same answer as the source before (${now.answers[name]})`);
  assert.equal(JSON.parse(now.answers.clean).ok,true,'1: a clean store passes');for(const name of ['payload','seal','mandate'])assert.equal(JSON.parse(now.answers[name]).ok,false,`1: ${name}: refused`);
  // 2.
  assert.ok(now.metric.pauses>=2,`2: the proof walk gives the frame back (${now.metric.pauses} times)`);assert.equal(before.sections.names.filter(n=>n==='authorization-proofs').length,0,'2: (the source before never did)');
  // The document proof walk gives the frame back the same way since build615 ('document-proof-checks', its own gate).
  assert.deepEqual(now.sections.names.filter(n=>n!=='authorization-proofs'&&n!=='document-proof-checks'),before.sections.names,'2: every other section in the same order');assert.equal(now.sections.ok,true);
  // 3.
  assert.ok(now.metric.authorizationMs<now.metric.pauses*50,`3: the authorization time leaves out the pauses (${now.metric.authorizationMs} ms, ${now.metric.pauses} pauses of 50 ms)`);
  assert.ok(now.metric.totalMs<before.metric.totalMs+now.metric.pauses*50,`3: so does the total (${now.metric.totalMs} against ${before.metric.totalMs})`);
  console.log(JSON.stringify({suite:'build609-authorization-check-slices',ok:true,pauses:now.metric.pauses,answers:Object.keys(now.answers).length}));
}finally{fs.rmSync(tree,{recursive:true,force:true});}
