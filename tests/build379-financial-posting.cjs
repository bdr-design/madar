'use strict';
const assert=require('node:assert/strict'),{harness,minimal}=require('./helpers/core-harness'),{scenario}=require('./helpers/business-scenario');
const {s}=harness(['transaction-core','finance-core','integrity-core']),F=s.GH_FINANCE_CORE;let checks=0;
function fixture(balance){const state=minimal();state.openedCompanies=['air'];F.ensure(state);F.book(state,'air').accounts[0].balance=balance;F.reconcile(state);return state;}
let seed=12345;const rnd=()=>(seed=(seed*1103515245+12345)%2147483648)/2147483648;
for(const base of [0,5e13,1e14,2**47-.03125,2**47,1.5e14,1.98e14,5e14,9e15])for(let i=0;i<60;i++){
 const balance=base?base+rnd()*1e9:0,state=fixture(balance),amount=(i%2?-1:1)*(rnd()*1.7e12+.01),reference='POSTING-1';
 const before=F.operating(state,'air'),out=F.execute({state},'settle-daily-cash',{company:'air',amount,day:1,reference});
 const applied=amount>=0?amount:-Math.min(-amount,before);
 assert.equal(out.amount,applied);assert.equal(F.operating(state,'air'),before+applied);assert.equal(F.assertAccountPosting(state,out,{company:'air',reference,balanceBefore:before,amount:applied}),true);
 if(amount<0&&-amount>before)assert.equal(state.finance.pendingDailyCash.air,-(-amount-before));
 const stable=F.operating(state,'air'),retry=F.execute({state},'settle-daily-cash',{company:'air',amount,day:1,reference});assert.equal(retry.idempotent,true);assert.equal(retry.amount,0);assert.equal(F.operating(state,'air'),stable);F.assertAccountPosting(state,retry,{company:'air',reference,balanceBefore:stable,amount:0});checks++;
}
for(const row of [
 {before:5e13,after:5e13,amount:.02},
 {before:1.98e14,after:1.98e14,amount:.10},
 {before:1.98e14,after:1.98e14+.10+.10,amount:.10},
 {before:1.98e14,after:1.98e14-.05,amount:.05},
 {before:1,after:Infinity,amount:Infinity},
 {before:NaN,after:1,amount:1}
]){
 const state=fixture(Number.isFinite(row.after)?row.after:100),receipt={company:'air',accountId:F.book(state,'air').accounts[0].id,reference:'FAULT',balanceBefore:row.before,balanceAfter:row.after,amount:row.amount};
 assert.throws(()=>F.assertAccountPosting(state,receipt,{company:'air',reference:'FAULT'}),error=>error.code==='FINANCE_ACCOUNT_POSTING_MISMATCH'&&error.postingEvidence.reference==='FAULT');checks++;
}
{
 const state=fixture(100),out=F.execute({state},'settle-daily-cash',{company:'air',amount:1,day:1,reference:'IDENTITY'});
 for(const patch of [{company:'sea'},{accountId:'WRONG'},{reference:'WRONG'},{balanceBefore:99},{amount:2}]){assert.throws(()=>F.assertAccountPosting(state,{...out,...patch},{company:'air',reference:'IDENTITY',balanceBefore:100,amount:1}),/posting-mismatch/);checks++;}
 for(const amount of [NaN,Infinity,-Infinity])assert.throws(()=>F.execute({state},'settle-daily-cash',{company:'air',amount,day:2}),/invalid-daily-settlement-amount/);
 const zero=F.execute({state},'settle-daily-cash',{company:'air',amount:0,day:2,reference:'ZERO'});F.assertAccountPosting(state,zero,{company:'air',reference:'ZERO',amount:0});
 // The consolidated-cash guard must still reject a real $1 discrepancy at 198T.
 F.book(state,'air').accounts[0].balance=1.98e14;F.reconcile(state);state.cash+=1;assert.ok(s.GH_INTEGRITY_CORE.check(state).issues.some(x=>x.id==='FINANCE_CONSOLIDATED_CASH_MISMATCH'));
}
for(const company of ['group','air','sea','road','power','bank','mobility','insurance','telecom','realestate','dealership','air-two']){
 const e=scenario(),st=e.state,f=e.s.GH_FINANCE_CORE;
 if(company==='air-two')e.command('corporate','open-company',{companyId:company,definitionId:'gh-air-v1',capital:200000000,legalName:'Second Air'});
 else if(!['group','air'].includes(company))e.command('corporate','open-company',{type:company,capital:200000000,legalName:'Posting '+company});
 f.book(st,company).accounts[0].balance=1.98e14;f.reconcile(st);
 if(company!=='group'){const ref='DAILY-'+company,out=e.command('finance','settle-daily-cash',{company,amount:925580.5497444401,day:1,reference:ref});f.assertAccountPosting(st,out,{company,reference:ref});}
 const cheque=e.command('finance','issue-cheque',{company,amount:925580.55,beneficiary:'Supplier posting',note:'Posting precision'}),before=f.operating(st,company),out=e.command('finance','settle-cheque',{id:cheque.id});
 assert.equal(out.settled,true);assert.equal(f.operating(st,company),before-925580.55);f.assertAccountPosting(st,out.posting,{company,reference:cheque.id,amount:-925580.55});
 assert.equal(e.command('finance','settle-cheque',{id:cheque.id}).reason,'already-settled');assert.equal(f.operating(st,company),before-925580.55);
 const stable=JSON.stringify(st);
 assert.throws(()=>e.s.GH_TRANSACTION_CORE.execute(st,{label:'posting-fault-rollback',apply(){
  const result=e.command('finance','settle-daily-cash',{company:company==='group'?'air':company,amount:.1,day:2,reference:'ROLLBACK'});f.book(st,result.company).accounts[0].balance+=.1;f.assertAccountPosting(st,result,{company:result.company,reference:'ROLLBACK'});
 }}),error=>error.code==='FINANCE_ACCOUNT_POSTING_MISMATCH'&&!!error.diagnostic.postingEvidence);
 assert.equal(JSON.stringify(st),stable,'financial fault must roll back balances, proofs and documents');checks++;
}
console.log(JSON.stringify({suite:'build379-financial-posting',ok:true,checks,companies:12,randomSettlements:540,negativeGuards:11,consolidatedGuardPreserved:true}));
