'use strict';
// Owner (build 106 iPhone diagnostic; then «حل كل شي بدقه عاليه»): three pieces of work that changed nothing.
//  - A departure's signed plan digest wrote each row byte as hex through toString(16).padStart (139 ms for 20,000 assets on
//    desktop); the two digits now come from a table.
//  - The daily proof record collection copied the whole record map (2,318 records, 1.6 MB the save then wrote again)
//    every game day although nothing left it below the record target; with nothing to remove the map is now kept.
//  - That collection walked every replay result for the proofs it names; a sealed entry's are now listed once.
// On the real fleet dispatch, fleet store, control plane, authorization, document proof, transaction and save schema
// owners, against the source before (1d7dce1, from its own tree):
//  1. the dispatch plan digests (every chunk, the metadata, both roots) of plans of 1, 33, 1,000 and 2,500 rows with every
//     byte value are exactly the source before's;
//  2. digesting 2,500 rows converts no byte through Number#toString (the source before: one call per byte);
//  3. a collection with nothing to remove leaves exactly the source before's state, keeps the record map itself (the
//     source before replaced it) and reports the same counts; a collection that removes records (a lower target), with
//     archived records, a superseded version and checkpoints no proof links to, leaves exactly the source before's state
//     and replaces the record map without changing the old one (maintenance keeps it as its rollback snapshot);
//     The proofs named only by sealed replay results are kept exactly as the source before keeps them, and a second
//     collection reads them from memory instead of walking every result again (the source before: 13 ms of the 17 ms
//     daily collection on iPhone);
//  4. a collection inside a transaction that fails afterwards leaves the state exactly as it was.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {harness,minimal}=require('./helpers/core-harness');
function scenario(){
  const out={digests:{},timing:null,compact:{}};
  // 1-2.
  {
    const {s}=harness(['capability-registry-core','company-definitions','company-platform-core','fleet-store-core','simulation-asset-core','fleet-event-core','fleet-access-core','fleet-core','control-plane-core','fleet-dispatch-core']),D=s.GH_FLEET_DISPATCH_CORE,STORE=s.GH_FLEET_STORE,CP=s.GH_CONTROL_PLANE;
    let seed=12345;const rand=()=>{seed=(seed*1103515245+12345)>>>0;return seed;};
    // The plan's buffers are made in the owners' realm (their instanceof checks).
    const realm=name=>require('node:vm').runInContext(name,s),RealmBuffer=realm('ArrayBuffer'),RealmInt32=realm('Int32Array'),RealmUint8=realm('Uint8Array');
    const plan=count=>{const bytes=new RealmBuffer(count*STORE.STRIDE),view=new RealmUint8(bytes);for(let i=0;i<view.length;i++)view[i]=i<256?i:rand()&255;const indices=new RealmInt32(count);for(let i=0;i<count;i++)indices[i]=i*3;
      const assignments=Array.from({length:count},(_,i)=>({id:`N-AIR-${String(i).padStart(8,'0')}`,routeId:`R-${i%7}`,routeRef:`R-${i%7}@B`,baseFacility:'B',phase:'turnaround'}));
      return {plan:{schema:D.SCHEMA,version:D.VERSION,tag:{qa:1},context:{simSeconds:0,routesRevision:1},count,valuesLength:3,revisionDelta:count,staticRows:{static:[],identity:[],routed:[]},summary:{count},indices,bytes,extras:Array.from({length:count},(_,i)=>i%5?null:{note:`x${i}`}),values:[[1,'a'],[2,{b:2}],[3,[3]]]},input:{assignments,routes:{}}};};
    const run=count=>{const {plan:p,input}=plan(count),steps=D.digestStages(p,input,{digest:text=>CP.sha256(text)});let step;while(!(step=steps.next()).done){}return step.value;};
    for(const count of [1,33,1000,2500])out.digests[count]=JSON.stringify(run(count));
    // Number#toString calls in the owners' realm while 2,500 rows are digested.
    const proto=realm('Number').prototype,real=proto.toString;let calls=0;proto.toString=function(...args){calls++;return real.apply(this,args);};try{run(2500);}finally{proto.toString=real;}out.toStringCalls=calls;
  }
  // 3-4.
  {
    const {s}=harness(['capability-registry-core','company-definitions','company-platform-core','identity-system','control-plane-core','save-schema','authorization-core','document-proof-core','transaction-core','domain-command-core','finance-core']);
    const Auth=s.GH_AUTHORIZATION,Proof=s.GH_DOCUMENT_PROOF,TX=s.GH_TRANSACTION_CORE;
    Auth.registerCommandTargetResolver('audit',()=>['group']);
    s.GH_DOMAIN_COMMANDS.register('audit',{execute(ctx,name,payload){ctx.state.auditCount=(ctx.state.auditCount||0)+1;const document={id:`AUD-${ctx.state.auditCount}`,company:'group',counterparty:`Party ${payload.amount%5}`,amount:payload.amount,subtotal:payload.amount,tax:0,total:payload.amount,currency:'USD',issuedAt:ctx.state.simSeconds,note:'Compact document'};Proof.sealDocument(ctx.state,document,{type:'audit-invoice',companyId:'group'});if(name==='post')ctx.state.finance.invoices.unshift(document);return {document};}});
    const world=()=>{const state={...minimal(),saveVersion:'3.0.0',profile:{name:'Compact Holdings',founder:'Compact Founder'},companyRegistry:{},openedCompanies:[]};
      Auth.ensurePrincipal(state,{id:'founder',legalName:'Compact Founder'});Auth.createVisualSeal(state,{ownerPersonId:'founder',strokes:[[{x:.1,y:.2},{x:.55,y:.65},{x:.9,y:.3}]]});Auth.createDefaultMandate(state,{principalId:'founder',companyIds:['*'],scopes:['audit.*']});s.GH_FINANCE_CORE.ensure(state);
      // 30 documents kept; 12 sealed records whose documents are dropped (nothing references them any more).
      for(let i=0;i<42;i++){const envelope=Auth.buildActiveEnvelope(state,{domain:'audit',name:'post',payload:{amount:100+i},idempotencyKey:`B608-${i}`,actor:{principalId:'founder'}});const r=s.GH_DOMAIN_COMMANDS.dispatchEnvelope({state},envelope);if(!r.ok)throw new Error(JSON.stringify(r));}
      state.finance.invoices=state.finance.invoices.slice(0,30);for(const key of Object.keys(state.domainRuntime?.idempotency||{}))delete state.domainRuntime.idempotency[key];
      return state;};
    const runCase=(name,edit,target)=>{const state=world();edit?.(state);const store=Proof.ensure(state),map=store.recordsById,mapBefore=JSON.stringify(map);let result;const t=TX.execute(state,{label:`qa-608-${name}`,apply:()=>{result=target===undefined?Proof.compact(state):Proof.compact(state,target);}});
      out.compact[name]={committed:t.committed,result,state:JSON.stringify(state),kept:Proof.ensure(state).recordsById===map,oldUnchanged:JSON.stringify(map)===mapBefore,records:Object.keys(Proof.ensure(state).recordsById).length};};
    runCase('nothing-to-remove');
    runCase('removes',null,20);
    runCase('archives',state=>{const store=Proof.ensure(state),ids=Object.keys(store.recordsById);store.archiveById={...(store.archiveById||{})};for(const id of ids.slice(0,4)){store.archiveById[id]=store.recordsById[id];}store.supersededById={[ids[5]]:store.recordsById[ids[5]]};},25);
    // 3, replay results: 42 sealed replay entries whose results name their documents' proofs (12 documents dropped from
    // the books, so only their replay results keep their proofs), collected twice; Object.values calls counted in the
    // second collection (the walk of the results).
    {const state=world();const keep=state.domainRuntime.idempotency;// emptied by world(); rebuilt below
      for(let i=0;i<42;i++){const envelope=Auth.buildActiveEnvelope(state,{domain:'audit',name:'replay',payload:{amount:500+i},idempotencyKey:`B608-R-${i}`,actor:{principalId:'founder'}});const r=s.GH_DOMAIN_COMMANDS.dispatchEnvelope({state},envelope);if(!r.ok)throw new Error(JSON.stringify(r));}
      TX.sealCollections(state);const sealed=Object.values(state.domainRuntime.idempotency).filter(e=>TX.isSealed(e)).length;
      const first=Proof.compact(state,0),afterFirst=JSON.stringify(state);const O=require('node:vm').runInContext('Object',s),real=O.values;let calls=0;O.values=function(...args){calls++;return real.apply(this,args);};let second;try{second=Proof.compact(state,0);}finally{O.values=real;}
      out.compact.replay={committed:true,result:{first,second},state:JSON.stringify(state),oldUnchanged:true,sealed,valuesCalls:calls,stable:afterFirst===JSON.stringify(state),records:Object.keys(Proof.ensure(state).recordsById).length};}
    // 4.
    {const state=world(),before=JSON.stringify(state);let failed=null;try{TX.execute(state,{label:'qa-608-fails',apply:()=>{Proof.compact(state,10);throw new Error('qa-608-injected');}});}catch(error){failed=String(error.message);}out.rollback={failed,same:JSON.stringify(state)===before};}
  }
  return out;
}
if(process.env.QA_BUILD608_SCENARIO){process.stdout.write(JSON.stringify(scenario()));return;}
const ROOT=path.resolve(__dirname,'..'),PREVIOUS='1d7dce1',tree=fs.mkdtempSync(path.join(os.tmpdir(),'b608-'));
try{
  execFileSync('sh',['-c',`git -C "${ROOT}" archive ${PREVIOUS} WebApp | tar -x -C "${tree}"`]);
  const before=JSON.parse(execFileSync(process.execPath,[__filename],{env:{...process.env,GH_TEST_SOURCE_DIR:tree,QA_BUILD608_SCENARIO:'1'},maxBuffer:256*1024*1024}).toString());
  const now=scenario();
  // 1.
  for(const count of Object.keys(before.digests))assert.equal(now.digests[count],before.digests[count],`1: ${count} rows: exactly the source before's digests`);
  // 2.
  assert.ok(before.toStringCalls>=2500*24,`2: (the source before converted every byte: ${before.toStringCalls} calls)`);assert.equal(now.toStringCalls,0,`2: no byte is converted by toString now (${now.toStringCalls})`);
  // 3.
  for(const name of Object.keys(before.compact)){const a=now.compact[name],b=before.compact[name];assert.equal(a.committed,true,name);assert.equal(JSON.stringify(a.result),JSON.stringify(b.result),`3: ${name}: the same counts`);assert.equal(a.state,b.state,`3: ${name}: exactly the source before's state`);assert.equal(a.oldUnchanged,true,`3: ${name}: the old record map is unchanged`);}
  assert.equal(now.compact['nothing-to-remove'].kept,true,'3: nothing to remove: the record map is kept');assert.equal(before.compact['nothing-to-remove'].kept,false,'3: (the source before replaced it)');
  assert.ok(now.compact.replay.sealed>=42,`3: sealed replay entries (${now.compact.replay.sealed})`);assert.ok(now.compact.replay.records>=42,'3: the proofs only replay results name are kept');assert.equal(now.compact.replay.stable,true,'3: a second collection changes nothing');
  assert.ok(before.compact.replay.valuesCalls>=42,`3: (the source before walked every replay result again: ${before.compact.replay.valuesCalls})`);assert.ok(now.compact.replay.valuesCalls<before.compact.replay.valuesCalls/4,`3: the second collection reads the sealed results' proofs from memory (${now.compact.replay.valuesCalls} against ${before.compact.replay.valuesCalls} walks)`);
  assert.equal(now.compact.removes.kept,false,'3: records removed: the map is replaced');assert.ok(now.compact.removes.records<before.compact['nothing-to-remove'].records,'3: (records left)');assert.ok(now.compact.archives.result.removed>0,'3: archived records go too');
  // 4.
  assert.equal(now.rollback.failed,'qa-608-injected');assert.equal(now.rollback.same,true,'4: the state is exactly as it was');
  console.log(JSON.stringify({suite:'build608-dispatch-hex-proof-compact',ok:true,toStringCalls:{now:now.toStringCalls,before:before.toStringCalls},records:now.compact['nothing-to-remove'].records}));
}finally{fs.rmSync(tree,{recursive:true,force:true});}
