'use strict';
// Owner (build 98 iPhone diagnostic; then «كمل الباقي بدقه»): every step of the proof audit checked the signer's visual seal
// by normalizing its strokes into a new copy, encoding the copy and the strokes to compare them, hashing the copy, then
// hashing the strokes again for the seal digest (play, 60 s: about 1.7 MB). Strokes already in normalized form are now
// checked in place (anything else takes the old path), and a valid seal with lower-case ink reuses its check's digest as the
// seal digest (the same fields and strokes). Nothing is kept between checks. On the real authorization owner, against the
// source before (8510d56, from its own tree):
//  1. every seal below gets exactly the source before's answer from validateVisualSeal (ok, reason, digest, points): a
//     canonical seal with and without pressure, upper-case ink, and every kind of stroke the old path refuses or rewrites
//     (array points, numbers as text, an extra key, an unrounded or out-of-range value, a non-finite or unrounded pressure,
//     a symbol key, an object of another class or tag, a hole, an inherited coordinate, a shared point, a getter, too many
//     points, too many strokes, a too short stroke, a wrong digest);
//  2. every proof issued under these seals gets exactly the source before's answer from verifyProof;
//  3. a canonical seal is checked without normalizing its strokes (no encoder is made) and its proof hashes the strokes
//     once (the source before: twice), while a seal that is not canonical still takes the old path.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {harness,minimal}=require('./helpers/core-harness');
const MODULES=['capability-registry-core','company-definitions','company-platform-core','identity-system','control-plane-core','save-schema','authorization-core','document-proof-core','transaction-core','domain-command-core','finance-core'];
function scenario(){
  const {s}=harness(MODULES),A=s.GH_AUTHORIZATION,CP=s.GH_CONTROL_PLANE;
  let encoders=0,strokeHashes=0;const Encoder=s.TextEncoder;s.TextEncoder=class extends Encoder{constructor(){super();encoders++;}};
  s.GH_CONTROL_PLANE={...CP,sha256(text){if(String(text).includes('"strokes"'))strokeHashes++;return CP.sha256(text);}};
  const base=[[{x:.1,y:.2},{x:.55,y:.65},{x:.9,y:.3}],[{x:.2,y:.8,pressure:.5},{x:.3,y:.7,pressure:1}]];
  const sealOf=(strokes,extra={})=>{const row={id:'SIG-QA',ownerPersonId:'founder',kind:'visual-authorization-seal',format:'normalized-strokes-v1',version:1,width:640,height:240,ink:'#1a2b3c',status:'active',strokes,...extra};row.digest=extra.digest??A.digest({format:row.format,ownerPersonId:row.ownerPersonId,version:row.version,strokes:(()=>{try{return A.normalizeStrokes(strokes);}catch(_e){return strokes;}})(),width:row.width,height:row.height,ink:String(row.ink).toLowerCase()});return row;};
  const clone=v=>JSON.parse(JSON.stringify(v));
  const inherited=Object.create({x:.5});inherited.y=.5;
  const shared={x:.4,y:.4};const getter={get x(){return .25;},y:.75};
  const tagged={x:.3,y:.3,[Symbol.toStringTag]:'Point'};const symbol={x:.3,y:.3};symbol[Symbol('qa')]=1;
  class Point{constructor(){this.x=.3;this.y=.3;}}
  const cases={
    canonical:()=>sealOf(clone(base)),
    upperInk:()=>sealOf(clone(base),{ink:'#1A2B3C'}),
    arrayPoints:()=>sealOf([[[.1,.2],[.3,.4]]]),
    textNumbers:()=>sealOf([[{x:'0.1',y:.2},{x:.3,y:.4}]]),
    extraKey:()=>sealOf([[{x:.1,y:.2,t:1},{x:.3,y:.4}]]),
    unrounded:()=>sealOf([[{x:.123456,y:.2},{x:.3,y:.4}]]),
    outOfRange:()=>sealOf([[{x:1.2,y:.2},{x:.3,y:.4}]]),
    negativeZero:()=>sealOf([[{x:-0,y:.2},{x:.3,y:.4}]]),
    pressureNaN:()=>sealOf([[{x:.1,y:.2,pressure:NaN},{x:.3,y:.4}]]),
    pressureNull:()=>sealOf([[{x:.1,y:.2,pressure:null},{x:.3,y:.4}]]),
    pressureUnrounded:()=>sealOf([[{x:.1,y:.2,pressure:.12345},{x:.3,y:.4}]]),
    pressureHigh:()=>sealOf([[{x:.1,y:.2,pressure:2},{x:.3,y:.4}]]),
    symbolKey:()=>sealOf([[symbol,{x:.3,y:.4}]]),
    tagged:()=>sealOf([[tagged,{x:.3,y:.4}]]),
    classPoint:()=>sealOf([[new Point(),{x:.3,y:.4}]]),
    hole:()=>{const stroke=[{x:.1,y:.2},,{x:.3,y:.4}];return sealOf([stroke]);},
    inheritedX:()=>sealOf([[inherited,{x:.3,y:.4}]]),
    sharedPoint:()=>sealOf([[shared,shared,shared]]),
    getter:()=>sealOf([[getter,{x:.3,y:.4}]]),
    manyPoints:()=>sealOf(Array.from({length:5},()=>Array.from({length:2000},(_,i)=>({x:(i%100)/100,y:.5,pressure:.5})))),
    manyStrokes:()=>sealOf(Array.from({length:65},()=>[{x:.1,y:.1},{x:.2,y:.2}])),
    shortStroke:()=>sealOf([[{x:.1,y:.2}]]),
    wrongDigest:()=>sealOf(clone(base),{digest:'0'.repeat(64)})
  };
  const out={validate:{},proofs:{},counts:{}};
  for(const [name,make] of Object.entries(cases)){let row;try{row=make();}catch(error){out.validate[name]={made:String(error.message)};continue;}const check=A.validateVisualSeal(row);out.validate[name]={ok:check.ok,reason:check.reason||null,digest:check.digest||null,points:check.points??null};}
  // 2-3. Proofs under a canonical seal, one with upper-case ink, one not canonical (array points rewritten by hand).
  const state={...minimal(),saveVersion:'3.0.0',profile:{name:'Seal QA',founder:'Seal Founder'},companyRegistry:{},openedCompanies:[]};
  A.ensurePrincipal(state,{id:'founder',legalName:'Seal Founder'});A.createVisualSeal(state,{ownerPersonId:'founder',strokes:clone(base)});A.createDefaultMandate(state,{principalId:'founder',companyIds:['*'],scopes:['audit.*']});
  A.registerCommandTargetResolver('audit',()=>['group']);
  s.GH_FINANCE_CORE.ensure(state);
  s.GH_DOMAIN_COMMANDS.register('audit',{execute(ctx,_name,payload){ctx.state.auditCount=(ctx.state.auditCount||0)+1;const document={id:`AUD-${ctx.state.auditCount}`,company:'group',counterparty:'Seal Party',amount:100+payload.n,subtotal:100+payload.n,tax:0,total:100+payload.n,currency:'USD',issuedAt:ctx.state.simSeconds,note:'Seal document'};s.GH_DOCUMENT_PROOF.sealDocument(ctx.state,document,{type:'audit-invoice',companyId:'group'});ctx.state.finance.invoices.unshift(document);return {document};}});
  const issue=key=>{const envelope=A.buildActiveEnvelope(state,{domain:'audit',name:'post',payload:{n:Number(key.slice(-1))},idempotencyKey:key,actor:{principalId:'founder'}});const result=s.GH_DOMAIN_COMMANDS.dispatchEnvelope({state},envelope);if(!result.ok)throw new Error(JSON.stringify(result));};
  const auth=state.authorization,sealId=Object.keys(auth.signatureAssetsById)[0];
  // The proofs the envelopes issued.
  for(let i=0;i<3;i++)issue('B603-'+i);
  const proofIds=Object.keys(auth.proofsById);
  const verifyAll=label=>{encoders=0;strokeHashes=0;out.proofs[label]=proofIds.map(id=>{const r=A.verifyProof(state,id,{proofs:new Map(),sealDigests:new Map(),mandateDigests:new Map()});return [r.ok,r.reason||null];});out.counts[label]={encoders,strokeHashes:strokeHashes/proofIds.length};};
  verifyAll('canonical');
  const seal=auth.signatureAssetsById[sealId];
  auth.signatureAssetsById[sealId]={...seal,ink:seal.ink.toUpperCase()};verifyAll('upperInk');
  auth.signatureAssetsById[sealId]={...seal,strokes:seal.strokes.map(stroke=>stroke.map(p=>[p.x,p.y]))};verifyAll('notCanonical');
  auth.signatureAssetsById[sealId]={...seal,strokes:clone(seal.strokes).map(stroke=>stroke.map(p=>({...p,x:Math.min(1,p.x+.0001)})))};verifyAll('tampered');
  auth.signatureAssetsById[sealId]=seal;verifyAll('restored');
  out.proofCount=proofIds.length;
  return out;
}
if(process.env.QA_BUILD603_SCENARIO){process.stdout.write(JSON.stringify(scenario()));return;}
const ROOT=path.resolve(__dirname,'..'),PREVIOUS='8510d56',tree=fs.mkdtempSync(path.join(os.tmpdir(),'b603-'));
try{
  execFileSync('sh',['-c',`git -C "${ROOT}" archive ${PREVIOUS} WebApp | tar -x -C "${tree}"`]);
  const before=JSON.parse(execFileSync(process.execPath,[__filename],{env:{...process.env,GH_TEST_SOURCE_DIR:tree,QA_BUILD603_SCENARIO:'1'},maxBuffer:64*1024*1024}).toString());
  const now=scenario();
  // 1.
  assert.deepEqual(Object.keys(now.validate),Object.keys(before.validate));
  for(const name of Object.keys(now.validate))assert.equal(JSON.stringify(now.validate[name]),JSON.stringify(before.validate[name]),`1: ${name}: the same answer as the source before (${JSON.stringify(now.validate[name])} / ${JSON.stringify(before.validate[name])})`);
  assert.equal(now.validate.canonical.ok,true,'1: a canonical seal is valid');assert.equal(now.validate.arrayPoints.ok,false,'1: array points are refused');assert.equal(now.validate.wrongDigest.ok,false,'1: a wrong digest is refused');
  // 2.
  assert.ok(now.proofCount>=3,`proofs issued (${now.proofCount})`);
  for(const label of Object.keys(now.proofs))assert.equal(JSON.stringify(now.proofs[label]),JSON.stringify(before.proofs[label]),`2: ${label}: every proof answers as before (${JSON.stringify(now.proofs[label])})`);
  assert.ok(now.proofs.canonical.every(r=>r[0])&&now.proofs.restored.every(r=>r[0])&&now.proofs.tampered.every(r=>!r[0])&&now.proofs.notCanonical.every(r=>!r[0]),'2: valid proofs pass, a tampered or rewritten seal fails them');
  // 3.
  assert.equal(now.counts.canonical.encoders,0,'3: a canonical seal is checked without normalizing its strokes');assert.ok(before.counts.canonical.encoders>0,'3: (the source before normalized them)');
  assert.equal(now.counts.canonical.strokeHashes,1,`3: its proof hashes the strokes once (${now.counts.canonical.strokeHashes})`);assert.equal(before.counts.canonical.strokeHashes,2,`3: (the source before: twice, ${before.counts.canonical.strokeHashes})`);
  assert.ok(now.counts.notCanonical.encoders>0,'3: a seal that is not canonical takes the old path');
  console.log(JSON.stringify({suite:'build603-visual-seal-check-in-place',ok:true,cases:Object.keys(now.validate).length,counts:{now:now.counts.canonical,before:before.counts.canonical}}));
}finally{fs.rmSync(tree,{recursive:true,force:true});}
