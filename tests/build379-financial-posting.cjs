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
// Investor mode: a day's loss above the current account is funded first by the investor card. The day close reads the
// balance before it dispatches the settlement and checks the receipt against it (app.js financialDayStages), so the
// receipt names the balance before the card, the card's amount and its transfer, and the check proves each of them.
let investorCases=0;
{
 const INVESTOR_STEP=10000000,code='daily-profit-current-account-mismatch:air',reference='DAY-CASH-air-1',mismatch=error=>error.code==='FINANCE_ACCOUNT_POSTING_MISMATCH';
 const invest=balance=>{const state=fixture(balance);state.godMoney=true;state.infiniteMoney=true;return state;},cards=state=>state.finance.transfers.filter(row=>row.fundingSource==='investor-card');
 for(const base of [0,100,5e13,2**47+.5,1.98e14]){
  const state=invest(base),before=F.operating(state,'air'),loss=base+1000,out=F.execute({state},'settle-daily-cash',{company:'air',amount:-loss,day:1,reference});
  assert.equal(F.assertAccountPosting(state,out,{company:'air',reference,balanceBefore:before,code}),true,'the day close check holds when the card funds the loss');
  assert.equal(out.balanceBeforeCover,before);assert.ok(out.investorCover>0);assert.equal(out.balanceBefore,before+out.investorCover);assert.equal(out.amount,-loss);assert.equal(out.shortfall,0);
  assert.equal(out.balanceAfter,out.balanceBefore-loss);assert.equal(F.operating(state,'air'),out.balanceAfter);assert.equal(Number(state.finance.pendingDailyCash?.air)||0,0);
  assert.equal(cards(state).length,1);assert.equal(cards(state)[0].reference,out.investorCoverReference);assert.equal(cards(state)[0].amount,out.investorCover);
  assert.equal(state.finance.transfers.filter(row=>row.reference===reference).length,1);
  // The receipt before this build (no card fields) fails the same check: that is the day close that froze the game.
  const {balanceBeforeCover:_seen,investorCover:_cover,investorCoverReference:_ref,...bare}=out;
  for(const receipt of [bare,{...out,investorCover:out.investorCover+INVESTOR_STEP},{...out,investorCover:0},{...out,investorCoverReference:'INV-WRONG'},{...out,balanceBeforeCover:before+1},{...out,balanceBeforeCover:undefined}])
   assert.throws(()=>F.assertAccountPosting(state,receipt,{company:'air',reference,balanceBefore:before,code}),mismatch);
  assert.throws(()=>F.assertAccountPosting(state,out,{company:'air',reference,balanceBefore:before+1,code}),mismatch);
  const row=state.finance.transfers.find(x=>x.reference===out.investorCoverReference);
  for(const [key,value] of [['amount',row.amount+1],['toAccount','WRONG'],['fundingSource','god-mode-founder'],['company','sea'],['kind','transfer']]){const kept=row[key];row[key]=value;assert.throws(()=>F.assertAccountPosting(state,out,{company:'air',reference,balanceBefore:before,code}),mismatch,key);row[key]=kept;}
  F.book(state,'air').accounts[0].balance+=.01;assert.throws(()=>F.assertAccountPosting(state,out,{company:'air',reference,balanceBefore:before,code}),mismatch);F.book(state,'air').accounts[0].balance-=.01;F.reconcile(state);
  assert.equal(F.assertAccountPosting(state,out,{company:'air',reference,balanceBefore:before,code}),true);
  const stable=F.operating(state,'air'),retry=F.execute({state},'settle-daily-cash',{company:'air',amount:-loss,day:1,reference});
  assert.equal(retry.idempotent,true);assert.equal(retry.amount,0);assert.equal(retry.investorCover,undefined);assert.equal(cards(state).length,1,'a retry draws nothing more from the card');assert.equal(F.operating(state,'air'),stable);
  assert.equal(F.assertAccountPosting(state,retry,{company:'air',reference,balanceBefore:stable,code}),true);investorCases++;
 }
 // A loss the account covers, a positive day and a loss with the mode off draw nothing from the card and carry no card fields.
 for(const [mode,base,amount] of [[true,1e6,-1000],[true,100,5000],[false,100,-1000]]){
  const state=mode?invest(base):fixture(base),before=F.operating(state,'air'),out=F.execute({state},'settle-daily-cash',{company:'air',amount,day:1,reference});
  assert.equal(out.investorCover,undefined);assert.equal(out.balanceBeforeCover,undefined);assert.equal(cards(state).length,0);assert.equal(F.assertAccountPosting(state,out,{company:'air',reference,balanceBefore:before,code}),true);
  if(!mode)assert.equal(state.finance.pendingDailyCash.air,-900);investorCases++;
 }
 // A fault after a card-funded settlement rolls back the card's transfer and charge with it.
 const state=invest(100),stable=JSON.stringify(state);
 assert.throws(()=>s.GH_TRANSACTION_CORE.execute(state,{label:'investor-cover-rollback',apply(){
  const out=F.execute({state},'settle-daily-cash',{company:'air',amount:-1000,day:1,reference});assert.ok(out.investorCover>0);
  F.book(state,'air').accounts[0].balance+=.01;F.assertAccountPosting(state,out,{company:'air',reference,balanceBefore:100,code});
 }}),error=>error.code==='FINANCE_ACCOUNT_POSTING_MISMATCH'&&error.diagnostic?.postingEvidence?.investorCover>0);
 assert.equal(JSON.stringify(state),stable,'the card transfer, its charge and the settlement roll back together');investorCases++;
}
console.log(JSON.stringify({suite:'build379-financial-posting',ok:true,checks,companies:12,randomSettlements:540,negativeGuards:11,consolidatedGuardPreserved:true,investorCases}));
