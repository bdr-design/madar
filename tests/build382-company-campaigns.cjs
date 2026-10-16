'use strict';
const assert=require('node:assert/strict'),{scenario}=require('./helpers/business-scenario');
function setup(){const e=scenario();e.command('finance','credit',{company:'group',amount:2000000000,taxable:false,reference:'QA-CAMPAIGN-CAPITAL'});for(const n of ['branch-campaign-core','banking-core','insurance-core','customer-companies-core','customer-base-core','telecom-market-core','dealer-market-core'])e.load(n);
 for(const company of ['bank','insurance','telecom','dealership'])e.command('corporate','open-company',{type:company,capital:200000000,legalName:'Campaign '+company});
 for(const [company,kind] of [['insurance','insurance'],['telecom','telecom-branch'],['dealership','dealership-branch']])for(let i=0;i<3;i++)e.state.customHubs.push({id:`QA-${company}-${i}`,kind,ownerCompanyId:company,owned:true,city:'الرياض',country:'السعودية',coords:[24+i*.01,46]});
 e.s.GH_BANKING_CORE.ensure(e.state).branchNetwork=Array.from({length:3},(_,i)=>({id:'QA-B-'+i,city:'الرياض',country:'السعودية',servicesActive:true}));return e;}
const e=setup(),{s,state}=e,F=s.GH_FINANCE_CORE,T=s.GH_TRANSACTION_CORE;
const unchanged=before=>{const a=JSON.parse(before),b=JSON.parse(JSON.stringify(state));function diff(a,b,path=''){if(JSON.stringify(a)===JSON.stringify(b))return '';if(!a||!b||typeof a!=='object'||typeof b!=='object')return path+': '+JSON.stringify(a)+' -> '+JSON.stringify(b);for(const k of new Set([...Object.keys(a),...Object.keys(b)])){const d=diff(a[k],b[k],path+'.'+k);if(d)return d;}return '';}assert.equal(diff(a,b),'');};
const owners=[['bank',s.GH_BANKING_CORE,'branch-campaigns',()=>state.bank.branchNetwork],['insurance',s.GH_INSURANCE_CORE,'office-campaigns',()=>state.insurance.offices],['telecom',s.GH_TELECOM_MARKET,'branch-campaigns',()=>s.GH_TELECOM_MARKET.ensure(state).branches],['dealership',s.GH_DEALER_MARKET,'showroom-campaigns',()=>s.GH_DEALER_MARKET.ensure(state).showrooms]];
for(const [company,owner,cmd,rows] of owners){
 const initial=owner.campaignQuote(state);assert.equal(initial.count,3,`${company} has three eligible branches`);
 rows()[0].campaignUntil=30;
 const q=owner.campaignQuote(state);assert.equal(q.count,2);assert.equal(q.total,rows().slice(1).reduce((n,row)=>n+owner.campaignCost(company==='bank'?state.bank:company==='insurance'?state.insurance:company==='telecom'?s.GH_TELECOM_MARKET.ensure(state):s.GH_DEALER_MARKET.ensure(state),row),0));
 const payload={reference:'QA-ALL-'+company,quoteKey:q.quoteKey},before=F.operating(state,company),cheques=state.finance.cheques.length,invoices=state.finance.invoices.length;
 const run=p=>T.execute(state,{label:'campaign-all',apply:()=>owner.execute({state},cmd,p)}).value;
 const snapshot=JSON.stringify(state);assert.throws(()=>run({...payload,quoteKey:initial.quoteKey}),/campaign-quote-changed/);unchanged(snapshot);
 const r=run(payload);assert.equal(r.count,2);assert.equal(before-F.operating(state,company),q.total);assert.equal(state.finance.cheques.length,cheques+1);assert.equal(state.finance.invoices.length,invoices+1);
 for(const row of rows().slice(1)){assert.equal(row.campaignUntil,30);assert.equal(row.campaigns,1);}
 const stable=JSON.stringify(state);assert.equal(run(payload).idempotent,true);unchanged(stable);
 assert.throws(()=>run({...payload,quoteKey:'different'}),/campaign-reference-conflict/);unchanged(stable);
 for(const doc of [state.finance.cheques[0],state.finance.invoices[0]])assert.equal(s.GH_DOCUMENT_PROOF.verifyDocument(state,doc).ok,true);
}
// A payment failure rolls back every branch and all financial/proof records.
state.simSeconds=31*86400;const owner=s.GH_TELECOM_MARKET,q=owner.campaignQuote(state),account=F.book(state,'telecom').accounts[0];account.balance=0;state.godMoney=false;state.infiniteMoney=false;F.reconcile(state);const before=JSON.stringify(state);
assert.throws(()=>T.execute(state,{apply:()=>owner.execute({state},'branch-campaigns',{reference:'QA-NO-CASH',quoteKey:q.quoteKey})}),/insufficient|settlement-failed/);unchanged(before);
F.book(state,'telecom').accounts[0].balance=200000000;F.execute({state},'set-budget',{company:'telecom',limit:1,resetSpent:true});F.reconcile(state);const budgetBefore=JSON.stringify(state);
assert.throws(()=>T.execute(state,{apply:()=>owner.execute({state},'branch-campaigns',{reference:'QA-NO-BUDGET',quoteKey:q.quoteKey})}),/budget/);unchanged(budgetBefore);
console.log(JSON.stringify({suite:'build382-company-campaigns',ok:true,companies:4,onePaymentPerCompany:true,staleQuoteAndReplayAndRollback:true}));
