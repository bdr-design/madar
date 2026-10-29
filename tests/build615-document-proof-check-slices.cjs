'use strict';
// Owner («تتبع الثقل والاق والمشاكل وحلها بدقه عاليه جدًا»; iPhone diagnostic DX-1793259100633: every simulation slice's
// post-commit save check, 'integrity-final-schema', averaged 40 ms and reached 66 ms, the document proof walk one block,
// and the hourly maintenance schema task 43 ms): the document proof walk keeps its order and verifier and, past 4 ms of
// work, gives the frame back ('document-proof-checks'), as the authorization walk does (build609). On the real
// authorization, document proof, transaction, finance and save schema owners, with 240 sealed documents, against the source
// before (f4d8bfd, from its own tree):
//  1. the full check answers exactly as the source before: a clean store (unverified, then trusted), a document whose
//     amount was changed, a document naming another record's digest, a document whose record is gone;
//  2. with a clock that moves 0.5 ms a call, the staged check gives the frame back inside the document walk (the source
//     before: never), and every other section and slice is yielded in the same order as before;
//  3. no metric counts the time paused: a check whose pauses last 50 ms each reports less than their sum for the document
//     proofs, and its total stays under the source before's plus the pauses.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {harness,minimal}=require('./helpers/core-harness');
const SLICE='document-proof-checks';
function scenario(){
  const {s}=harness(['capability-registry-core','company-definitions','company-platform-core','identity-system','control-plane-core','save-schema','authorization-core','document-proof-core','transaction-core','domain-command-core','finance-core']);
  const Auth=s.GH_AUTHORIZATION,Proof=s.GH_DOCUMENT_PROOF,Schema=s.GH_SAVE_SCHEMA;
  Auth.registerCommandTargetResolver('audit',()=>['group']);
  s.GH_DOMAIN_COMMANDS.register('audit',{execute(ctx,_name,payload){ctx.state.auditCount=(ctx.state.auditCount||0)+1;const document={id:`DOC-${ctx.state.auditCount}`,company:'group',counterparty:`Party ${payload.amount%7}`,amount:payload.amount,subtotal:payload.amount,tax:0,total:payload.amount,currency:'USD',issuedAt:ctx.state.simSeconds,note:'Check document'};Proof.sealDocument(ctx.state,document,{type:'audit-invoice',companyId:'group'});ctx.state.finance.invoices.unshift(document);return {document};}});
  const world=()=>{const state={...minimal(),saveVersion:'3.0.0',profile:{name:'Check Holdings',founder:'Check Founder'},companyRegistry:{},openedCompanies:[]};
    Auth.ensurePrincipal(state,{id:'founder',legalName:'Check Founder'});Auth.createVisualSeal(state,{ownerPersonId:'founder',strokes:[[{x:.1,y:.2},{x:.55,y:.65},{x:.9,y:.3}]]});Auth.createDefaultMandate(state,{principalId:'founder',companyIds:['*'],scopes:['audit.*']});s.GH_FINANCE_CORE.ensure(state);
    for(let i=0;i<240;i++){const envelope=Auth.buildActiveEnvelope(state,{domain:'audit',name:'post',payload:{amount:100+i},idempotencyKey:`B615-${i}`,actor:{principalId:'founder'}});const r=s.GH_DOMAIN_COMMANDS.dispatchEnvelope({state},envelope);if(!r.ok)throw new Error(JSON.stringify(r));}
    if(!s.GH_FLEET_STORE?.isStore?.(state.fleet)&&s.GH_FLEET_STORE){state.fleet=s.GH_FLEET_STORE.fromAssets([],{at:0});delete state.assets;}
    return state;};
  const answer=(state,options)=>{const r=Schema.validate(state,options);return JSON.stringify({ok:r.ok,errors:r.errors,reason:r.reason||null});};
  const out={answers:{},sections:null,metric:null};
  // 1.
  {const state=world();out.answers.clean=answer(state);out.answers.trusted=answer(state,{trustVerified:true});}
  const tamper={
    amount:state=>{const document=state.finance.invoices[17];document.amount+=1;document.total+=1;},
    digest:state=>{const [a,b]=[state.finance.invoices[5],state.finance.invoices[9]];a.contentDigest=b.contentDigest;},
    record:state=>{const document=state.finance.invoices[31];delete state.documentProofs.recordsById[document.documentProofId];}
  };
  for(const [name,edit] of Object.entries(tamper)){const state=world();edit(state);out.answers[name]=answer(state);out.answers[`${name}-trusted`]=answer(state,{trustVerified:true});}
  // 2-3. A clock that moves 0.5 ms a call (and 50 ms each time the document walk is resumed after a pause).
  {const state=world(),real=s.performance;let now=0;s.performance={now:()=>(now+=0.5)};
    try{const steps=Schema.validationSteps(state,{trustVerified:false}),names=[];let step;while(!(step=steps.next()).done){names.push(String(step.value));if(names[names.length-1]===SLICE)now+=50;}
      out.sections={names,ok:step.value.ok};const m=Schema.telemetry().lastValidation;out.metric={documentProofMs:m.documentProofMs,totalMs:m.totalMs,pauses:names.filter(n=>n===SLICE).length};}
    finally{s.performance=real;}}
  return out;
}
if(process.env.QA_BUILD615_SCENARIO){process.stdout.write(JSON.stringify(scenario()));return;}
const ROOT=path.resolve(__dirname,'..'),PREVIOUS='f4d8bfd',tree=fs.mkdtempSync(path.join(os.tmpdir(),'b615-'));
try{
  execFileSync('sh',['-c',`git -C "${ROOT}" archive ${PREVIOUS} WebApp | tar -x -C "${tree}"`]);
  const before=JSON.parse(execFileSync(process.execPath,[__filename],{env:{...process.env,GH_TEST_SOURCE_DIR:tree,QA_BUILD615_SCENARIO:'1'},maxBuffer:64*1024*1024}).toString());
  const now=scenario();
  // 1.
  assert.deepEqual(Object.keys(now.answers),Object.keys(before.answers));
  for(const name of Object.keys(now.answers))assert.equal(now.answers[name],before.answers[name],`1: ${name}: the same answer as the source before (${now.answers[name]})`);
  assert.equal(JSON.parse(now.answers.clean).ok,true,'1: a clean store passes');for(const name of Object.keys(now.answers).filter(n=>!['clean','trusted'].includes(n)))assert.equal(JSON.parse(now.answers[name]).ok,false,`1: ${name}: refused`);
  // 2.
  assert.ok(now.metric.pauses>=2,`2: the document walk gives the frame back (${now.metric.pauses} times)`);assert.equal(before.sections.names.filter(n=>n===SLICE).length,0,'2: (the source before never did)');
  assert.deepEqual(now.sections.names.filter(n=>n!==SLICE),before.sections.names,'2: every other section and slice in the same order');assert.equal(now.sections.ok,true);
  // 3.
  assert.ok(now.metric.documentProofMs<now.metric.pauses*50,`3: the document proof time leaves out the pauses (${now.metric.documentProofMs} ms, ${now.metric.pauses} pauses of 50 ms)`);
  assert.ok(now.metric.totalMs<before.metric.totalMs+now.metric.pauses*50,`3: so does the total (${now.metric.totalMs} against ${before.metric.totalMs})`);
  console.log(JSON.stringify({suite:'build615-document-proof-check-slices',ok:true,pauses:now.metric.pauses,answers:Object.keys(now.answers).length}));
}finally{fs.rmSync(tree,{recursive:true,force:true});}
