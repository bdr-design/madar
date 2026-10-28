'use strict';
// Owner (build 98 iPhone diagnostic: «حل باقي المشاكل»; then «صلحها على دفعات دقيقه جدًا»): the proof audit that runs
// through play re-encoded, on every pass, the issuer and counterparty snapshots of every whole proof record (four canonical
// texts each, to compare them with the record's signed content) and re-hashed every sealed signature snapshot, although a
// sealed record or snapshot is frozen with everything in it and cannot change (play, 60 s: 24 KB per audited item, 13 KB
// now). Both are now worked out once per sealed object, as the record's own content digest already was (build 358); every
// comparison with the record, the authorization, the chain and the references still runs on every pass. On the real
// authorization, document proof, transaction and save schema owners, with 40 authorized documents (half of their records
// rewritten in the whole form of earlier builds, the documents of the other half sealed), against the source before
// (8510d56, from its own tree):
//  1. a second audit cycle over the sealed stores encodes no whole record's signed snapshots for that comparison and hashes
//     no sealed signature snapshot again (the source before did both), the first cycle doing it once;
//  2. every audit step and the full check answer exactly as the source before answers;
//  3. no check is weakened: a whole record replaced by a copy whose issuer snapshot no longer matches (unsealed, or sealed),
//     a sealed document whose signature snapshot is replaced by another sealed one, and a record that matched replaced by
//     a tampered frozen copy each fail the audit and the full check exactly as the source before fails them.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {harness,minimal}=require('./helpers/core-harness'),{legacyLiveRecords}=require('./helpers/legacy-proof-records');
const MODULES=['capability-registry-core','company-definitions','company-platform-core','identity-system','control-plane-core','save-schema','authorization-core','document-proof-core','transaction-core','domain-command-core','finance-core'];
function scenario(){
  const {s}=harness(MODULES),Auth=s.GH_AUTHORIZATION,Proof=s.GH_DOCUMENT_PROOF,TX=s.GH_TRANSACTION_CORE,Schema=s.GH_SAVE_SCHEMA;
  const world=()=>{
    const state={...minimal(),saveVersion:'3.0.0',profile:{name:'Proof Holdings',founder:'Proof Founder'},companyRegistry:{},openedCompanies:[]};
    Auth.ensurePrincipal(state,{id:'founder',legalName:'Proof Founder'});Auth.createVisualSeal(state,{ownerPersonId:'founder',strokes:[[{x:.1,y:.2},{x:.55,y:.65},{x:.9,y:.3}]]});
    Auth.createDefaultMandate(state,{principalId:'founder',companyIds:['*'],scopes:['audit.*']});s.GH_FINANCE_CORE.ensure(state);
    for(let i=0;i<40;i++){const envelope=Auth.buildActiveEnvelope(state,{domain:'audit',name:'post',payload:{amount:100+i,counterparty:`Party ${i%7}`},idempotencyKey:`B600-${i}`,actor:{principalId:'founder'}});const out=s.GH_DOMAIN_COMMANDS.dispatchEnvelope({state},envelope);if(!out.ok)throw new Error(JSON.stringify(out));}
    // Half the records in the whole form of earlier builds; the other half's documents sealed.
    const invoices=state.finance.invoices,keep=new Set(invoices.slice(20).map(d=>d.documentProofId)),all=invoices.slice();state.finance.invoices=invoices.slice(0,20);legacyLiveRecords(Proof,state);state.finance.invoices=all;
    for(const document of invoices.slice(20))TX.sealValue(document);TX.sealCollections(state);
    if(!s.GH_FLEET_STORE.isStore(state.fleet)){state.fleet=s.GH_FLEET_STORE.fromAssets([],{at:0});delete state.assets;}
    return {state,whole:Object.values(state.documentProofs.recordsById).filter(r=>!r.form).length,sealedDocuments:invoices.filter(d=>TX.isSealed(d)).length,signed:Object.values(state.documentProofs.recordsById).filter(r=>r.signatureDigest!=null).length,keep};
  };
  Auth.registerCommandTargetResolver('audit',()=>['group']);
  s.GH_DOMAIN_COMMANDS.register('audit',{execute(ctx,_name,payload){ctx.state.auditCount=(ctx.state.auditCount||0)+1;const document={id:`AUD-${ctx.state.auditCount}`,company:'group',counterparty:payload.counterparty,amount:payload.amount,subtotal:payload.amount,tax:0,total:payload.amount,currency:'USD',issuedAt:ctx.state.simSeconds,note:'Proof document'};Proof.sealDocument(ctx.state,document,{type:'audit-invoice',companyId:'group'});ctx.state.finance.invoices.unshift(document);return {document};}});
  // Encodings of the tracked objects: the issuer and recipient inside each whole record's signed content (encoded only to
  // compare them with the record's snapshots) and the sealed documents' signature snapshots. (The document's own snapshots,
  // which can change, are still encoded with the record's on every envelope check.)
  const tracked=new WeakSet(),counts={encoded:0};const A=s.GH_AUTHORIZATION;
  s.GH_AUTHORIZATION={...A,stable(value){if(value&&typeof value==='object'&&tracked.has(value))counts.encoded++;return A.stable(value);}};
  const track=state=>{for(const r of Object.values(state.documentProofs.recordsById))if(!r.form)for(const v of [r.signedContent?.issuer,r.signedContent?.recipient])if(v&&typeof v==='object')tracked.add(v);for(const d of state.finance.invoices)if(TX.isSealed(d)&&d.signatureSnapshot)tracked.add(d.signatureSnapshot);};
  const cycle=state=>{const audit=Schema.createProofAudit(),steps=[];for(let i=0;i<500;i++){const out=audit.step(state,{maxItems:7});steps.push([out.ok,out.errors,out.checked,out.phase,out.fault]);if(out.cycleDone||!out.ok)break;}return steps;};
  const out={};
  // 1-2.
  {
    const w=world(),{state}=w;track(state);out.world={whole:w.whole,sealedDocuments:w.sealedDocuments,signed:w.signed};
    counts.encoded=0;out.first=cycle(state);out.firstEncoded=counts.encoded;
    counts.encoded=0;out.second=cycle(state);out.secondEncoded=counts.encoded;
    const check=Schema.validate(state);out.validate=[check.ok,check.errors];
  }
  // 3.
  out.tampered={};
  const cases={
    'whole-unsealed':state=>{const [id,r]=Object.entries(state.documentProofs.recordsById).find(([,r])=>!r.form);state.documentProofs.recordsById[id]={...structuredClone(r),issuerSnapshot:{...structuredClone(r.issuerSnapshot),legalName:'Tampered Holdings'}};},
    'whole-sealed':state=>{const [id,r]=Object.entries(state.documentProofs.recordsById).find(([,r])=>!r.form);const copy={...structuredClone(r),counterpartySnapshot:{...structuredClone(r.counterpartySnapshot),name:'Tampered Party'}};TX.sealValue(copy);state.documentProofs.recordsById[id]=copy;},
    'signature-sealed':state=>{const i=state.finance.invoices.findIndex(d=>TX.isSealed(d)&&d.signatureSnapshot);if(i<0)throw new Error('no sealed signed document');const d=state.finance.invoices[i],copy={...structuredClone(d),signatureSnapshot:{...structuredClone(d.signatureSnapshot),strokes:[[{x:.2,y:.2},{x:.3,y:.4}]]}};TX.sealValue(copy);state.finance.invoices[i]=copy;},
    'matched-then-tampered':state=>{const [id,r]=Object.entries(state.documentProofs.recordsById).find(([,r])=>!r.form);const copy={...structuredClone(r),issuerSnapshot:{...structuredClone(r.issuerSnapshot),taxId:'399999999999993'}};TX.sealValue(copy);state.documentProofs.recordsById[id]=copy;}
  };
  for(const [name,edit] of Object.entries(cases)){
    const {state}=world();track(state);cycle(state);// every sealed object checked (and remembered) once before
    try{edit(state);}catch(error){out.tampered[name]={error:String(error.message)};continue;}
    const check=Schema.validate(state),steps=cycle(state);out.tampered[name]={validate:[check.ok,check.errors],audit:steps.filter(s=>!s[0])};
  }
  return out;
}
if(process.env.QA_BUILD600_SCENARIO){process.stdout.write(JSON.stringify(scenario()));return;}
const ROOT=path.resolve(__dirname,'..'),PREVIOUS='8510d56',tree=fs.mkdtempSync(path.join(os.tmpdir(),'b600-'));
try{
  execFileSync('sh',['-c',`git -C "${ROOT}" archive ${PREVIOUS} WebApp | tar -x -C "${tree}"`]);
  const before=JSON.parse(execFileSync(process.execPath,[__filename],{env:{...process.env,GH_TEST_SOURCE_DIR:tree,QA_BUILD600_SCENARIO:'1'},maxBuffer:256*1024*1024}).toString());
  const now=scenario();
  assert.ok(now.world.whole>=20&&now.world.sealedDocuments>=20,`a world of whole records and sealed documents (${JSON.stringify(now.world)})`);
  // 1.
  assert.ok(now.firstEncoded>0,`1: the first cycle encodes the snapshots (${now.firstEncoded})`);
  assert.equal(now.secondEncoded,0,`1: the second cycle encodes none of them again (${now.secondEncoded})`);
  assert.ok(before.secondEncoded>=2*now.world.whole,`1: the source before encoded them again (${before.secondEncoded})`);
  // 2.
  assert.equal(JSON.stringify(now.first),JSON.stringify(before.first),'2: the first cycle answers as before');assert.equal(JSON.stringify(now.second),JSON.stringify(before.second),'2: the second cycle answers as before');
  assert.ok(now.second.every(s=>s[0]===true)&&now.validate[0]===true,'2: a clean store passes');assert.equal(JSON.stringify(now.validate),JSON.stringify(before.validate),'2: the full check answers as before');
  // 3.
  for(const name of Object.keys(now.tampered)){
    const a=now.tampered[name],b=before.tampered[name];assert.ok(!a.error,`3: ${name}: ${a.error}`);
    assert.equal(a.validate[0],false,`3: ${name}: the full check fails`);assert.ok(a.audit.length>0,`3: ${name}: the audit fails`);
    assert.equal(JSON.stringify(a),JSON.stringify(b),`3: ${name}: exactly as the source before fails (${JSON.stringify(a)} / ${JSON.stringify(b)})`);
  }
  console.log(JSON.stringify({suite:'build600-proof-audit-sealed-checks',ok:true,world:now.world,encoded:{first:now.firstEncoded,second:now.secondEncoded,secondBefore:before.secondEncoded}}));
}finally{fs.rmSync(tree,{recursive:true,force:true});}
