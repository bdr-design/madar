'use strict';
// Owner (build 98 iPhone diagnostic: «حل باقي المشاكل»): finance rebuilt the list of the companies a world holds from the
// company platform on every finance call (its definitions, every company resolved, sorted), dozens of times in each hour of
// play, and the garbage this left was a third of play's allocations here (a fleet of 60,000: 10.2 MB in 15 s, 6.4 with
// the list built once). Inside a simulation transaction the held companies cannot change (only a player's command
// founds or registers one), so the list is now built once per such transaction. On the real company platform,
// definitions, finance and transaction owners:
//  1. a day's finance work (expenses accrued for every company, then the day's close) inside a simulation transaction
//     leaves exactly the state the same work leaves inside an ordinary transaction, where the list is built every time;
//  2. inside the simulation transaction the list is built once for each form (with and without the group), against once
//     per call in the ordinary transaction; every call returns its own copy;
//  3. outside a simulation transaction nothing is kept: a company registered in the middle of a transaction is listed at
//     once (and finance opens its book), as before.
const assert=require('node:assert/strict');
const {harness,minimal}=require('./helpers/core-harness');
const MODULES=['capability-registry-core','company-definitions','company-platform-core','identity-system','control-plane-core','authorization-core','determinism-core','integrity-core','document-proof-core','transaction-core','domain-command-core','finance-core'];
const {s}=harness(MODULES),F=s.GH_FINANCE_CORE,T=s.GH_TRANSACTION_CORE,D=s.GH_COMPANY_DEFINITIONS;
const HELD=['air','sea','road','power','bank','insurance','realestate','telecom','media','healthcare'];
// A world holding ten companies; the registry's key listing is counted (the list's build reads it each time).
function world(){
  const registry=Object.fromEntries(HELD.map(id=>{const d=D.get(id);return [id,{id,definitionId:d.definitionId,definitionVersion:d.definitionVersion,status:'active'}];}));
  const state={...minimal(),saveVersion:'3.0.0',simSeconds:20*86400,profile:{name:'QA Memo'},openedCompanies:[...HELD],companyRegistry:registry};
  F.ensure(state);for(const id of HELD)F.book(state,id).accounts[0].balance=50e6;F.reconcile(state);
  // Only the finance list's reads are counted (the transaction's rollback snapshot also lists the registry, once).
  let builds=0;state.companyRegistry=new Proxy(registry,{ownKeys(t){if(/platformInstances/.test(new Error().stack))builds++;return Reflect.ownKeys(t);}});
  return {state,builds:()=>builds,reset:()=>{builds=0;}};
}
const day=state=>{
  for(const [i,id] of HELD.entries()){F.execute({state},'accrue-expense',{company:id,amount:1000+i,note:`QA memo ${id}`,counterparty:'QA Memo Supplier',taxable:false,number:`QA-MEMO-${id}`});F.execute({state},'accrue-expense',{company:id,amount:2000+i,note:`QA memo b ${id}`,counterparty:'QA Memo Supplier',taxable:false,number:`QA-MEMO-B-${id}`});}
  const companies=Object.fromEntries(HELD.map((id,i)=>[id,{grossRevenue:10000+i,expenses:4000+i,net:6000}]));
  F.execute({state},'record-daily-close',{day:20,net:HELD.length*6000,companies});
  return [F.companyIds(state),F.companyIds(state,{includeGroup:false})];
};
// 1-2. One build of the list reads the registry's keys a fixed number of times (counted here, outside any transaction).
const simulated=world(),ordinary=world();simulated.reset();F.companyIds(simulated.state);F.companyIds(simulated.state,{includeGroup:false});const perPair=simulated.builds();
let simLists,ordLists,simCopies;
simulated.reset();T.execute(simulated.state,{label:'simulation:qa-memo-day',apply:()=>{simLists=day(simulated.state);const a=F.companyIds(simulated.state),b=F.companyIds(simulated.state);a.push('tampered');simCopies=[a!==b,!b.includes('tampered'),!F.companyIds(simulated.state).includes('tampered')];}});
ordinary.reset();T.execute(ordinary.state,{label:'qa-memo-command',apply:()=>{ordLists=day(ordinary.state);}});
const plain=state=>JSON.stringify({...state,companyRegistry:{...state.companyRegistry}});
assert.equal(plain(simulated.state),plain(ordinary.state),'1: the same day leaves the same state with the list built once');
assert.deepEqual(simLists,ordLists,'1: the same lists');assert.ok(simLists[0].includes('group')&&!simLists[1].includes('group')&&simLists[1].length===HELD.length,'1: the held companies, with and without the group');
assert.ok(perPair>0&&simulated.builds()<=perPair,`2: built once for each form inside the simulation transaction (${simulated.builds()} reads, ${perPair} for one build of each)`);
assert.ok(ordinary.builds()>=20*perPair,`2: against every call in an ordinary transaction (${ordinary.builds()} reads)`);
assert.deepEqual(simCopies,[true,true,true],'2: every call returns its own copy');
// 3.
{
  const {state}=world();let before,after,book;
  T.execute(state,{label:'qa-register-company',apply:()=>{before=F.companyIds(state,{includeGroup:false});const d=D.get('education');state.companyRegistry.education={id:'education',definitionId:d.definitionId,definitionVersion:d.definitionVersion,status:'active'};state.openedCompanies.push('education');after=F.companyIds(state,{includeGroup:false});F.ensure(state);book=!!state.companyFinance.education;}});
  assert.ok(!before.includes('education')&&after.includes('education'),'3: a company registered in the middle of a transaction is listed at once');assert.equal(book,true,'3: and finance opens its book');
}
console.log(JSON.stringify({suite:'build594-finance-company-ids-memo',ok:true,registryReads:{oneBuildOfEach:perPair,simulation:simulated.builds(),ordinary:ordinary.builds()}}));
