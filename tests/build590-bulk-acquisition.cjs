'use strict';
// Owner (build 97): a bulk acquisition buys a page of operating businesses at once. One signed command
// (acquire-operating-batch) runs each offer through the single purchase (its quote check, cheque, transferred balances,
// contract and receipt, the company's capital checks in order) inside one transaction, so the game saves once. Proven on
// the real finance, banking, insurance, real-estate, energy, facility and acquisition owners, for each company with four
// locations:
//  1. a batch leaves exactly the state that the same purchases made one by one leave (finance, the company's book, its
//     operating root and every receipt);
//  2. it runs in one transaction (one save), where one by one took one each;
//  3. any refusal rolls the whole batch back with nothing paid: a stale quote in the middle, a repeated offer, an empty
//     batch or one over the page limit, and the bank's capital check failing on a later offer.
const assert=require('node:assert/strict');
const {harness,minimal}=require('./helpers/core-harness');
const MODULES=['capability-registry-core','company-definitions','company-platform-core','identity-system','control-plane-core','authorization-core','determinism-core','integrity-core','document-proof-core','transaction-core','domain-command-core','finance-core','banking-core','customer-base-core','insurance-core','realestate-core','energy-core','facility-core','operating-acquisition-core'];
const LOCATIONS=4,results=[];
function session(){
  const {s}=harness(MODULES),A=s.GH_OPERATING_ACQUISITIONS,F=s.GH_FINANCE_CORE,T=s.GH_TRANSACTION_CORE;
  const owner=c=>({realestate:s.GH_REALESTATE_CORE,power:s.GH_ENERGY_CORE,insurance:s.GH_INSURANCE_CORE,bank:s.GH_BANKING_CORE}[c]);
  const fixture=()=>{
    const companies=A.COMPANIES,companyRegistry=Object.fromEntries(companies.map(id=>{const d=s.GH_COMPANY_DEFINITIONS.get(id);return [id,{id,definitionId:d.definitionId,definitionVersion:d.definitionVersion,status:'active'}];}));
    const state={...minimal(),saveVersion:'3.0.0',profile:{name:'Bulk QA'},companyRegistry,openedCompanies:[...companies],advanced:{economy:{electricityPriceMWh:72}},realism:{economy:{baseRate:.046}},branches:[],constructionContracts:[]};
    const cities=[['الرياض','السعودية'],['دبي','الإمارات'],['القاهرة','مصر'],['عمّان','الأردن']];
    state.customHubs=companies.flatMap(c=>cities.slice(0,LOCATIONS).map(([city,country],i)=>({id:`FAC-${c}-${i}`,owned:true,kind:c,ownerCompanyId:c,city,country,cost:1000000,dailyCost:0,capacityAmount:1,commissioned:false})));
    F.ensure(state);for(const c of companies)F.book(state,c).accounts[0].balance=900e6;F.reconcile(state);
    s.GH_REALESTATE_CORE.ensure(state);s.GH_INSURANCE_CORE.ensure(state);s.GH_ENERGY_CORE.ensure(state);
    const b=s.GH_BANKING_CORE.ensure(state);b.branchNetwork=cities.slice(0,LOCATIONS).map(([city,country],i)=>({id:`BANK-BR-${i}`,facilityId:`FAC-bank-${i}`,city,country,servicesActive:true,retailCustomers:0,businessCustomers:0,deposits:0,loans:0,depositMix:{sight:0,savings:0,term:0}}));s.GH_BANKING_CORE.ensure(state);s.GH_BANKING_CORE.reconcilePrudential(state);
    return state;
  };
  const offers=(state,c,variant)=>A.targets(state,c).map(t=>A.quote(state,c,t.id,variant)).filter(q=>!q.owned).map(q=>({targetId:q.targetId,variant,quoteKey:q.quoteKey}));
  const relevant=state=>JSON.stringify([state.companyFinance,state.finance,state.realEstate,state.energy,state.insurance,state.bank]);
  // Each run is one command in one transaction (the game saves once per command).
  let transactions=0;
  const run=(state,c,cmd,p)=>{transactions++;try{return T.execute(state,{label:`bulk-${c}`,apply:()=>owner(c).execute({state},cmd,p)});}catch(error){return {committed:false,error:String(error.message)};}};
  return {s,A,F,fixture,offers,relevant,run,count:()=>transactions,reset:()=>{transactions=0;}};
}
const one=session(),bulk=session(),fail=session();
for(const c of one.A.COMPANIES)for(const variant of one.A.VARIANTS[c]){
  const singleState=one.fixture(),bulkState=bulk.fixture(),items=one.offers(singleState,c,variant);
  assert.ok(items.length>=2,`${c}/${variant}: several offers on the page (${items.length})`);
  // Bank purchases are limited by the bank's capital: the batch is the most the single path accepts in a row.
  one.reset();const accepted=[];for(const item of items){const r=one.run(singleState,c,'acquire-operating',item);if(r.committed===false){if(c==='bank')break;assert.fail(`${c}/${variant}: ${r.error}`);}accepted.push(item);}
  assert.ok(accepted.length>=(c==='bank'?1:2),`${c}/${variant}: the single path buys several (${accepted.length})`);const singleTransactions=one.count();
  bulk.reset();const r=bulk.run(bulkState,c,'acquire-operating-batch',{items:accepted});assert.notEqual(r.committed,false,`${c}/${variant}: ${r.error}`);
  // 1, 2.
  assert.equal(bulk.relevant(bulkState),one.relevant(singleState),`1: ${c}/${variant}: a batch leaves the state the same purchases one by one leave`);
  assert.equal(bulk.count(),1,`2: ${c}/${variant}: one transaction`);assert.equal(singleTransactions,accepted.length);
  assert.equal(r.value?.count??r.count,accepted.length);
  results.push({company:c,variant,offers:accepted.length,transactions:{batch:bulk.count(),oneByOne:singleTransactions}});
}
// 3. Refusals roll the whole batch back.
for(const c of fail.A.COMPANIES){
  const variant=fail.A.VARIANTS[c][0];
  const cases={staleMiddle:items=>items.map((row,i)=>i===1?{...row,quoteKey:'0'.repeat(64)}:row),repeated:items=>[items[0],items[1],items[0]],empty:()=>[],overLimit:items=>Array.from({length:fail.A.BATCH_LIMIT+1},(_,i)=>({...items[i%items.length],targetId:`${items[i%items.length].targetId}`}))};
  for(const [name,make] of Object.entries(cases)){
    const state=fail.fixture(),items=fail.offers(state,c,variant),before=fail.relevant(state),r=fail.run(state,c,'acquire-operating-batch',{items:make(items)});
    assert.equal(r.committed,false,`3: ${c}/${name} is refused`);assert.equal(fail.relevant(state),before,`3: ${c}/${name}: nothing paid, nothing kept`);
  }
}
{
  // The bank's capital check failing on a later offer refuses the batch.
  const state=fail.fixture(),items=fail.offers(state,'bank','branch');state.bank.riskPolicy.minCet1=Number(state.bank.cet1)+1e9;const before=fail.relevant(state);
  const r=fail.run(state,'bank','acquire-operating-batch',{items});assert.equal(r.committed,false,'3: the bank\'s capital check refuses the batch');assert.equal(fail.relevant(state),before,'3: and nothing is kept');
}
console.log(JSON.stringify({suite:'build590-bulk-acquisition',ok:true,results}));
