'use strict';
// Owner (build 98 iPhone diagnostic; then «كمل البندين 2 و3»): finance built the list of the companies a world holds once
// per simulation transaction (build594), still several times a second in play (a fleet of 60,000, 60 s: 0.7 MB). The list
// is a function of the registry (its companies, whether each record is an object, the definition it names), the opened
// companies, the companies with a book and the sealed platform's definitions; it is now kept per state while all of these
// are what they were, and checked in place on every call. On the real company platform (sealed), definitions, finance and
// transaction owners, against the source before (8510d56, from its own tree):
//  1. through a sequence of changes, each list finance gives (with and without the group, inside and outside a simulation
//     transaction) is exactly the source before's: a company registered and opened in place, then removed; a record
//     naming another definition (the order follows it); a record that is not an object; the registry replaced by an equal
//     copy; the opened list reordered, given an unknown company, emptied, then absent; a book added for an opened company
//     with no record, and removed; a transaction that registers a company and is rolled back;
//  2. with nothing changed, a hundred calls build the list once per form (the source before built it on every call);
//  3. every call outside a simulation transaction returns its own copy.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {harness,minimal}=require('./helpers/core-harness');
const MODULES=['capability-registry-core','company-definitions','company-platform-core','company-adapters-core','identity-system','control-plane-core','authorization-core','determinism-core','integrity-core','document-proof-core','transaction-core','domain-command-core','finance-core'];
const HELD=['air','sea','road','power','bank','insurance','realestate','telecom','media','healthcare'];
function scenario(){
  const {s}=harness(MODULES),F=s.GH_FINANCE_CORE,T=s.GH_TRANSACTION_CORE,D=s.GH_COMPANY_DEFINITIONS,P=s.GH_COMPANY_PLATFORM;
  if(!P.isSealed())P.seal({runtimeCheck:false});
  let builds=0;s.GH_COMPANY_PLATFORM={...P,listInstances(...args){builds++;return P.listInstances(...args);}};
  const record=id=>{const d=D.get(id);return {id,definitionId:d.definitionId,definitionVersion:d.definitionVersion,status:'active'};};
  const state={...minimal(),saveVersion:'3.0.0',simSeconds:20*86400,profile:{name:'QA Kept'},openedCompanies:[...HELD],companyRegistry:Object.fromEntries(HELD.map(id=>[id,record(id)]))};
  F.ensure(state);
  const lists=[],look=label=>{lists.push([label,F.companyIds(state),F.companyIds(state,{includeGroup:false})]);};
  const sim=(label,apply)=>T.execute(state,{label:'simulation:'+label,apply:()=>{apply?.();look(label+' (simulation)');}});
  look('start');sim('start');
  state.companyRegistry.education=record('education');state.openedCompanies.push('education');look('education registered');sim('education');
  delete state.companyRegistry.education;state.openedCompanies.splice(state.openedCompanies.indexOf('education'),1);look('education removed');
  state.companyRegistry.media={...state.companyRegistry.media,definitionId:D.get('sports').definitionId};look('media names the sports definition');sim('renamed');
  state.companyRegistry.media=record('media');look('media restored');
  state.companyRegistry.telecom=null;look('telecom record not an object');state.companyRegistry.telecom=record('telecom');look('telecom restored');
  state.companyRegistry={...state.companyRegistry};look('registry copied');sim('copied');
  state.openedCompanies=[...state.openedCompanies].reverse();look('opened reversed');state.openedCompanies.push('qa-unknown');look('opened unknown');
  const opened=state.openedCompanies;state.openedCompanies=[];look('opened empty');delete state.openedCompanies;look('opened absent');state.openedCompanies=opened.filter(id=>id!=='qa-unknown');look('opened back');
  state.openedCompanies.push('sports');look('sports opened, no record');state.companyFinance.sports={type:'sports',companyId:'sports',accounts:[{id:'SP-1',balance:0}],ledger:[],taxPayable:0,taxPaid:0,debt:0,vat:{output:0,input:0,creditCarry:0,periodOutputStart:0,periodInputStart:0}};look('sports book added');sim('sports');
  delete state.companyFinance.sports;state.openedCompanies.pop();look('sports gone');
  try{T.execute(state,{label:'qa-register-then-fail',apply:()=>{state.companyRegistry.education=record('education');state.openedCompanies.push('education');look('registered in a transaction');throw new Error('qa-601-rollback');}});}catch(_error){}
  look('after the rollback');sim('after');
  // 2.
  builds=0;for(let i=0;i<50;i++){F.companyIds(state);F.companyIds(state,{includeGroup:false});}const steady=builds;
  // 3.
  const a=F.companyIds(state),b=F.companyIds(state);a.push('tampered');const copies=[a!==b,!b.includes('tampered'),!F.companyIds(state).includes('tampered')];
  return {lists,steady,copies};
}
if(process.env.QA_BUILD601_SCENARIO){process.stdout.write(JSON.stringify(scenario()));return;}
const ROOT=path.resolve(__dirname,'..'),PREVIOUS='8510d56',tree=fs.mkdtempSync(path.join(os.tmpdir(),'b601-'));
try{
  execFileSync('sh',['-c',`git -C "${ROOT}" archive ${PREVIOUS} WebApp | tar -x -C "${tree}"`]);
  const before=JSON.parse(execFileSync(process.execPath,[__filename],{env:{...process.env,GH_TEST_SOURCE_DIR:tree,QA_BUILD601_SCENARIO:'1'},maxBuffer:64*1024*1024}).toString());
  const now=scenario();
  // 1.
  assert.equal(now.lists.length,before.lists.length);
  for(let i=0;i<now.lists.length;i++)assert.equal(JSON.stringify(now.lists[i]),JSON.stringify(before.lists[i]),`1: ${now.lists[i][0]}: the same lists as the source before`);
  const at=label=>now.lists.find(row=>row[0]===label);
  assert.ok(at('education registered')[2].includes('education')&&!at('education removed')[2].includes('education'),'1: a company registered in place is listed at once, and dropped');
  assert.notEqual(JSON.stringify(at('media names the sports definition')[2]),JSON.stringify(at('start')[2]),'1: a record naming another definition moves in the list');
  assert.ok(!at('after the rollback')[2].includes('education'),'1: a rolled back registration is not listed');
  // 2.
  assert.ok(now.steady<=2,`2: a hundred calls with nothing changed build the list once per form at most (${now.steady})`);
  assert.ok(before.steady>=100,`2: the source before built it on every call (${before.steady})`);
  // 3.
  assert.deepEqual(now.copies,[true,true,true],'3: every call returns its own copy');
  console.log(JSON.stringify({suite:'build601-finance-company-ids-kept',ok:true,lists:now.lists.length,builds:{now:now.steady,before:before.steady}}));
}finally{fs.rmSync(tree,{recursive:true,force:true});}
