'use strict';
// Owner («كمل بدقه»; every seal, amendment and check of a finance document encoded the document's material twice: once
// for its size, then again inside the signed content): the material's text from its size check stands for it when the
// content built in the same step is encoded. In the real finance, document proof and authorization owners (a founder's
// visual seal and mandate, system-authorized commands: each expense invoice sealed, amended and bound), against the source
// before (668f48d, from its own tree):
//  1. the same finance, document proofs and authorization proofs (every digest), byte for byte;
//  2. every invoice verifies the same, and a changed one fails with the same reason;
//  3. no material is encoded a second time (the source before: at least once per seal, amendment and check).
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'),PREVIOUS='668f48d';
if(process.argv[2]==='--run'){
  const {scenario}=require(path.join(ROOT,'tests/helpers/business-scenario')),e=scenario(),s=e.s,state=e.state,Auth=s.GH_AUTHORIZATION;state.godMoney=true;state.infiniteMoney=true;
  // Counts each content encoded right after its own material payload was encoded alone (its size check) whose payload is
  // encoded again (not given as known). A stored content checked later is encoded whole, as before.
  const stableOwner=Auth.stable;let again=0,contents=0,lastAlone=null;
  s.GH_AUTHORIZATION={...Auth,stable(value,known){const payload=value?.material?.payload;if(payload&&typeof payload==='object'){contents++;if(payload===lastAlone&&!(known&&typeof known.has==='function'&&known.has(payload)))again++;}lastAlone=value;return known===undefined?stableOwner(value):stableOwner(value,known);}};
  Auth.ensurePrincipal(state,{id:'PLAYER-FOUNDER',legalName:'B627 Founder'});let seed=627;const r=()=>{seed=(seed*1103515245+12345)%2147483648;return Math.round(seed/2147483648*10000)/10000;};
  Auth.createVisualSeal(state,{ownerPersonId:'PLAYER-FOUNDER',strokes:Array.from({length:3},()=>Array.from({length:40},()=>({x:r(),y:r()})))});const mandate=Auth.createDefaultMandate(state,{principalId:'PLAYER-FOUNDER',companyIds:['*'],scopes:['finance.*','contracts.*','company.*']});
  for(let i=0;i<120;i++)s.GH_DOMAIN_COMMANDS.dispatchSystem(e.ctx,'finance','accrue-expense',{company:i%3?'air':'group',amount:1000+i*7.25,note:`b627 ${i}`,counterparty:'Supplier LLC',closeOwned:true},{actor:'financial-close',authority:{principalId:'PLAYER-FOUNDER',mandateId:mandate.id}});
  const invoices=state.finance.invoices,verified=invoices.map(row=>{const out=s.GH_DOCUMENT_PROOF.verifyDocument(state,row);return [row.number,out.ok,out.reason||null];});
  const changed=structuredClone(invoices[5]);changed.note='changed';const tampered=s.GH_DOCUMENT_PROOF.verifyDocument(state,changed);
  fs.writeFileSync(process.argv[3],JSON.stringify({again,contents,authorized:invoices.filter(row=>row.authorizationProofId).length,verified,tampered:[tampered.ok,tampered.reason],state:{finance:state.finance,documentProofs:state.documentProofs,authorization:state.authorization}}));
  process.exit(0);
}
const run=root=>{const out=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'b627-out-')),'run.json');try{execFileSync(process.execPath,[path.join(ROOT,'tests/build627-document-material-once.cjs'),'--run',out],{env:{...process.env,GH_TEST_SOURCE_DIR:root},stdio:['ignore','ignore','inherit']});return JSON.parse(fs.readFileSync(out,'utf8'));}finally{fs.rmSync(path.dirname(out),{recursive:true,force:true});}};
const tree=fs.mkdtempSync(path.join(os.tmpdir(),'b627-'));let before;
try{execFileSync('sh',['-c',`git -C "${ROOT}" archive ${PREVIOUS} WebApp | tar -x -C "${tree}"`]);before=run(tree);}finally{fs.rmSync(tree,{recursive:true,force:true});}
const now=run(process.env.GH_TEST_SOURCE_DIR||ROOT);
// 1.
assert.ok(now.authorized>=120,`1: the invoices are sealed and bound under the founder's authority (${now.authorized})`);
assert.equal(JSON.stringify(now.state),JSON.stringify(before.state),'1: the same finance, document proofs and authorization proofs');
// 2.
assert.ok(now.verified.every(([,ok])=>ok),'2: every invoice verifies');assert.deepEqual(now.verified,before.verified,'2: the same verifications');
assert.deepEqual(now.tampered,before.tampered,'2: a changed invoice fails the same way');assert.equal(now.tampered[0],false,'2: (it fails)');
// 3.
assert.equal(now.again,0,`3: no material encoded a second time (${now.contents} contents encoded)`);assert.ok(before.again>=120,`3: (the source before encoded ${before.again} again)`);
console.log(JSON.stringify({suite:'build627-document-material-once',ok:true,invoices:now.verified.length,contents:now.contents,againBefore:before.again}));
