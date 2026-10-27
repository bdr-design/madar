'use strict';
// iPhone diagnostic (build 95): the boot verified every proof twice, at load (1,007 ms) and at the boot confirmation
// (590 ms: 4,395 authorization proofs and about 4,750 documents again, in one task). Load now seals the two proof stores
// before its full check, as the first save or draft would: the boot confirmation's full check of the same frozen rows
// reuses each row's own digest and still checks its seal, mandate, chain and references. Proven on the real
// authorization, document proof, transaction, codec, save schema and migration owners, with 80 proofs issued through
// authorized commands, a save written by the codec, loaded by GH_MIGRATION_CORE.load, then checked as app.js's boot
// confirmation checks it (GH_SAVE_SCHEMA.validate), against the same load with the seal turned off:
//  1. the confirmation hashes no proof's own content again and each mandate snapshot once (the unsealed load hashes
//     every proof again); its answer is the same;
//  2. right after load the proof rows and containers are sealed (an edit throws) and finance documents are not;
//  3. nothing else changes: the loaded state's JSON and its codec text are those of the unsealed load;
//  4. no check is weakened: a replaced proof (its digest kept), a seal with changed strokes, a mandate one version on,
//     a replaced document record, an edited invoice and a deleted proof each fail the confirmation exactly as a fresh,
//     unsealed check fails them; a tampered save is refused at load, and a clean load after it passes.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),path=require('node:path');
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {harness,minimal}=require('./helpers/core-harness');
const MODULES=['capability-registry-core','company-definitions','company-platform-core','identity-system','control-plane-core','save-schema','authorization-core','document-proof-core','transaction-core','domain-command-core','state-codec-core','persistence-core','migration-core'];
const KEY='GH_B583_SAVE';
// A world with 80 authorized commands, each sealing a document, saved by the codec.
function savedWorld(){
  const {s}=harness(MODULES),state={...minimal(),saveVersion:'3.0.0',profile:{name:'Proof Holdings',founder:'Proof Founder'},companyRegistry:{},openedCompanies:[]};
  const Auth=s.GH_AUTHORIZATION;Auth.ensurePrincipal(state,{id:'founder',legalName:'Proof Founder'});
  Auth.createVisualSeal(state,{ownerPersonId:'founder',strokes:[[{x:.1,y:.2},{x:.55,y:.65},{x:.9,y:.3}]]});
  Auth.createDefaultMandate(state,{principalId:'founder',companyIds:['*'],scopes:['audit.*']});
  Auth.registerCommandTargetResolver('audit',()=>['group']);
  s.GH_DOMAIN_COMMANDS.register('audit',{execute(ctx,_name,payload){ctx.state.auditCount=(ctx.state.auditCount||0)+1;const document={id:`AUD-${ctx.state.auditCount}`,company:'group',counterparty:payload.counterparty,amount:payload.amount,subtotal:payload.amount,tax:0,total:payload.amount,currency:'USD',issuedAt:ctx.state.simSeconds,note:'Proof document'};s.GH_DOCUMENT_PROOF.sealDocument(ctx.state,document,{type:'audit-invoice',companyId:'group'});ctx.state.finance.invoices.unshift(document);return {document};}});
  for(let i=0;i<80;i++){const envelope=Auth.buildActiveEnvelope(state,{domain:'audit',name:'post',payload:{amount:100+i,counterparty:`Party ${i%7}`},idempotencyKey:`B583-${i}`,actor:{principalId:'founder'}});assert.equal(s.GH_DOMAIN_COMMANDS.dispatchEnvelope({state},envelope).ok,true);}
  if(!s.GH_FLEET_STORE.isStore(state.fleet)){state.fleet=s.GH_FLEET_STORE.fromAssets([],{at:0});delete state.assets;}
  const check=s.GH_SAVE_SCHEMA.validate(state);assert.equal(check.ok,true,check.errors.join(','));
  return {text:JSON.stringify(s.GH_STATE_CODEC.encodeState(state)),proofs:Object.keys(state.authorization.proofsById).length,records:Object.keys(state.documentProofs.recordsById).length};
}
// Load the save in a fresh session; seal:false turns the load-time seal off (the source before this change).
function boot(text,{seal=true}={}){
  const h=harness(MODULES),{s}=h;h.storage.setItem(KEY,text);
  const TX=s.GH_TRANSACTION_CORE;if(!seal)s.GH_TRANSACTION_CORE={...TX,sealCollections:()=>0};
  const defaults={...minimal(),saveVersion:'3.0.0',profile:{name:'Default'},bank:{},energy:{},operations:{},companyRegistry:{},companyModules:{},finance:{...minimal().finance},treasury:structuredClone(minimal().treasury)};
  const loaded=s.GH_MIGRATION_CORE.load({defaultState:defaults,storageKey:KEY,legacyStorageKeys:[],saveSchema:s.GH_SAVE_SCHEMA}).state;
  s.GH_TRANSACTION_CORE=TX;
  return {s,state:loaded};
}
// The boot confirmation, counting the texts hashed (GH_CONTROL_PLANE.sha256 is read at each call).
function confirm(env,state=env.state){
  const inputs=[],plane=env.s.GH_CONTROL_PLANE,original=plane.sha256;
  env.s.GH_CONTROL_PLANE={...plane,sha256:text=>{inputs.push(text);return original?original(text):crypto.createHash('sha256').update(text).digest('hex');}};
  try{return {result:env.s.GH_SAVE_SCHEMA.validate(state),inputs};}finally{env.s.GH_CONTROL_PLANE=plane;}
}
const world=savedWorld();assert.ok(world.proofs>=80&&world.records>=80,'real proofs and records');
const sealedBoot=boot(world.text),plainBoot=boot(world.text,{seal:false});
const A=sealedBoot.s.GH_AUTHORIZATION,stableOf=proof=>{const {proofDigest:_d,...base}=proof;return A.stable?A.stable(base):JSON.stringify(base);};
const proofs=Object.values(sealedBoot.state.authorization.proofsById),selfTexts=new Set(proofs.map(stableOf));
const sealed=confirm(sealedBoot),plain=confirm(plainBoot);
// 1.
assert.equal(sealed.result.ok,true,sealed.result.errors?.join(','));assert.equal(plain.result.ok,true);
const selfHashed=inputs=>inputs.filter(text=>selfTexts.has(text)).length;
assert.ok(selfHashed(plain.inputs)>=proofs.length,`1: the unsealed load's confirmation hashes every proof again (${selfHashed(plain.inputs)})`);
assert.equal(selfHashed(sealed.inputs),0,'1: the sealed load\'s confirmation hashes no proof\'s own content again');
assert.ok(sealed.inputs.length<plain.inputs.length/2,`1: the confirmation hashes far less (${sealed.inputs.length} texts, unsealed ${plain.inputs.length})`);
// 2.
const TX=sealedBoot.s.GH_TRANSACTION_CORE,st=sealedBoot.state;
assert.ok(proofs.every(proof=>TX.isSealed(proof)),'2: every proof is sealed at load');
assert.ok(Object.values(st.documentProofs.recordsById).every(record=>Object.isFrozen(record)),'2: the document records are sealed at load');
assert.throws(()=>{'use strict';proofs[0].signerNameSnapshot='x';},TypeError,'2: an edit of a sealed proof throws');
assert.equal(Object.isFrozen(st.finance.invoices[0]),false,'2: finance documents are not sealed at load');
assert.equal(Object.values(plainBoot.state.authorization.proofsById).some(proof=>Object.isFrozen(proof)),false,'the unsealed load seals nothing');
// 3.
assert.equal(JSON.stringify(st),JSON.stringify(plainBoot.state),'3: the loaded state is the unsealed load\'s');
assert.equal(sealedBoot.s.GH_STATE_CODEC.serialize(st),plainBoot.s.GH_STATE_CODEC.serialize(plainBoot.state),'3: its codec text is the unsealed load\'s');
// 4. Each tampering on a fresh sealed load fails the confirmation as a fresh unsealed check of the same state fails it.
const tamper={
  proofReplaced:s=>{const id=Object.keys(s.authorization.proofsById)[3],copy=structuredClone(s.authorization.proofsById[id]);copy.signerNameSnapshot='Someone Else';s.authorization.proofsById={...s.authorization.proofsById,[id]:copy};},
  sealStrokes:s=>{const id=Object.keys(s.authorization.signatureAssetsById)[0],copy=structuredClone(s.authorization.signatureAssetsById[id]);copy.strokes=[[{x:.2,y:.2},{x:.3,y:.9}]];s.authorization.signatureAssetsById={...s.authorization.signatureAssetsById,[id]:copy};},
  mandateVersion:s=>{const id=Object.keys(s.authorization.mandatesById)[0],copy=structuredClone(s.authorization.mandatesById[id]);copy.version=Number(copy.version)+1;s.authorization.mandatesById={...s.authorization.mandatesById,[id]:copy};},
  recordReplaced:s=>{const id=Object.keys(s.documentProofs.recordsById)[5],copy=structuredClone(s.documentProofs.recordsById[id]);for(const key of Object.keys(copy))if(typeof copy[key]==='string'&&/digest|hash/i.test(key)){copy[key]=copy[key].replace(/^./,c=>c==='a'?'b':'a');break;}s.documentProofs.recordsById={...s.documentProofs.recordsById,[id]:copy};},
  invoiceEdited:s=>{s.finance.invoices[2].total+=1;},
  proofDeleted:s=>{const id=Object.keys(s.authorization.proofsById)[7],{[id]:_gone,...rest}=s.authorization.proofsById;s.authorization.proofsById=rest;},
};
for(const [name,apply] of Object.entries(tamper)){
  const env=boot(world.text);apply(env.state);const got=confirm(env).result,fresh=harness(MODULES).s.GH_SAVE_SCHEMA.validate(JSON.parse(JSON.stringify(env.state,(k,v)=>v)));
  const expected=boot(world.text,{seal:false});apply(expected.state);const want=confirm(expected).result;
  assert.equal(JSON.stringify({ok:got.ok,errors:got.errors}),JSON.stringify({ok:want.ok,errors:want.errors}),`4: ${name}: the confirmation answers as the unsealed load's`);
  // A seal asset replaced in the live state is caught by a fresh check (and at load), not by a later check in the same
  // session, with or without the seal at load: unchanged by this change.
  if(name!=='sealStrokes')assert.equal(got.ok,false,`4: ${name} fails the confirmation`);
  assert.equal(fresh.ok,false,`4: ${name} fails a fresh check`);
}
// A tampered save is refused at load; a clean load after it passes and reuses the digests.
{const codec=harness(MODULES).s.GH_STATE_CODEC,raw=codec.decodeState(JSON.parse(world.text)),id=Object.keys(raw.authorization.proofsById)[0];raw.authorization.proofsById[id]={...raw.authorization.proofsById[id],signerNameSnapshot:'Forged'};
 assert.throws(()=>boot(JSON.stringify(codec.encodeState(raw))),/MIGRATION_SAVE_REJECTED:.*authorization-proof/,'4: a tampered save is refused at load');
 const again=boot(world.text),check=confirm(again);assert.equal(check.result.ok,true);assert.equal(selfHashed(check.inputs),0,'4: a clean load after it passes and reuses the digests');}
console.log(JSON.stringify({suite:'build583-boot-proof-single-hash',ok:true,proofs:proofs.length,records:world.records,confirmationHashes:{sealed:sealed.inputs.length,unsealed:plain.inputs.length},proofSelfHashes:{sealed:selfHashed(sealed.inputs),unsealed:selfHashed(plain.inputs)},tamperCases:Object.keys(tamper).length}));
