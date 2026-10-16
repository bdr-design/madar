'use strict';
const assert=require('node:assert/strict'),{customerCreditFixture}=require('./helpers/customer-credit-fixture.cjs');
const close=(a,b,message)=>assert.ok(Math.abs(a-b)<.02,message+': '+a+' != '+b);
const results={};
{
 const e=customerCreditFixture(),{state,B,F,s}=e,{contract,portfolio}=e.approve();e.pauseBranches();
 assert.equal(portfolio.repaymentModel,'monthly-customer-contract');assert.equal(portfolio.customerContractId,contract.id);
 const opening=F.operating(state,'bank');let principal=0,cashInterest=0,accrued=0,dailyCash=0;
 for(let day=1;day<=30;day++){
  state.simSeconds=day*86400;const row=B.execute({state},'tick-day',{day});principal+=row.principalRepaid;cashInterest+=row.customerInstallmentInterestPaid;accrued+=row.interestIncome;dailyCash+=row.unpostedInterestIncome;
  if(row.unpostedInterestIncome)F.execute({state},'credit',{company:'bank',amount:row.unpostedInterestIncome,taxable:false,reference:'CREDIT-QA-DAY-'+day});
  const eco=s.GH_ECONOMICS_CORE.sectorEconomics(state,{day,preferDailyReport:true});close(eco.detail.bankCashRevenueToPost,row.securityIncome+row.feeIncome,'loan interest is not part of daily cash credit');
  if(day<30){close(portfolio.outstanding,1000000,'principal stays outstanding until due');assert.equal(row.customerInstallmentInterestPaid,0);}
 }
 close(principal,1000000/12,'only the monthly principal was collected');close(portfolio.outstanding,contract.outstanding,'contract and portfolio agree');close(cashInterest,1000000*contract.rate*30/365,'one month of interest');close(accrued,cashInterest,'earned interest matches first month');assert.equal(dailyCash,0);close(F.operating(state,'bank')-opening,principal+cashInterest,'actual finance cash has no duplicate interest');
 const unchanged=JSON.stringify(state);B.execute({state},'tick-day',{day:30});assert.equal(JSON.stringify(state),unchanged,'replayed close cannot collect again');
 const reloaded=JSON.parse(JSON.stringify(state));B.ensure(reloaded);close(reloaded.bank.customerLoanContracts[0].outstanding,reloaded.bank.loanPortfolios.find(r=>r.id===portfolio.id).outstanding,'reload retains matching balances');
 results.month={principal,interest:cashInterest,dailyInterestCash:dailyCash,outstanding:contract.outstanding};
 portfolio.pd=1e-12;
 for(let day=31;day<=360;day++){state.simSeconds=day*86400;const row=B.execute({state},'tick-day',{day});principal+=row.principalRepaid;assert.equal(row.unpostedInterestIncome,0);}
 close(principal,1000000,'the entire term repays exactly the original principal');close(portfolio.outstanding,0,'portfolio is paid at term end');assert.equal(state.bank.customerLoanContracts.length,0);assert.equal(state.bank.customerLoanContractArchive[0].id,contract.id);assert.equal(state.finance.customerLoanPaymentReceipts.length,12);results.fullTerm={months:12,principal,receipts:12};
}
// A legacy aggregate loan keeps its original daily principal/cash policy; monthly loans do not cancel its interest.
{
 const e=customerCreditFixture(),{state,B,F}=e;e.approve();B.execute({state},'originate-loan',{amount:1000000,product:'consumer',termDays:360,riskGrade:'AAA',sector:'retail'});e.pauseBranches();state.simSeconds=30*86400;
 const row=B.execute({state},'tick-day',{day:30});assert.ok(row.customerInstallmentInterestPaid>row.interestIncome);assert.ok(row.unpostedInterestIncome>0,'the legacy loan still earns its own daily cash');close(row.unpostedInterestIncome,row.interestIncome-row.customerContractInterestIncome-row.corporateInterestIncome,'independent interest components');assert.equal(state.bank.loanPortfolios.filter(p=>p.repaymentModel==='monthly-customer-contract').length,1);assert.ok(F.operating(state,'bank')>0);results.mixedLoans=true;
}
// Repair only the evidenced legacy principal mismatch, without creating a cash transfer or rewriting receipts.
{
 const e=customerCreditFixture(),{state,B,F}=e,{contract,portfolio}=e.approve();delete portfolio.repaymentModel;delete portfolio.customerContractId;state.bank.customerCreditSchema=2;state.bank.lastProcessedDay=35;portfolio.outstanding=800000;state.bank.loans=800000;contract.outstanding=900000;contract.lastAccruedDay=30;
 const cash=F.operating(state,'bank'),receipts=JSON.stringify(state.finance.customerLoanPaymentReceipts);B.ensure(state);assert.equal(portfolio.repaymentModel,'monthly-customer-contract');assert.equal(contract.outstanding,800000);assert.equal(contract.lastAccruedDay,30,'do not waive historical interest without per-contract cash evidence');assert.equal(contract.legacyPrincipalPaid,100000);assert.equal(F.operating(state,'bank'),cash);assert.equal(JSON.stringify(state.finance.customerLoanPaymentReceipts),receipts);assert.equal(state.bank.customerCreditSchema,3);assert.equal(state.bank.customerCreditRepair.historicalInterestReview,1);
 B.ensure(state);assert.equal(contract.legacyPrincipalPaid,100000,'legacy reconciliation happens once');results.legacyRepair=true;
}
// Recover a lost Business World party from the stable id and exact name retained on an active loan contract.
{
 const e=customerCreditFixture(),{state,B,F,s}=e,{contract}=e.approve('PARTY-REPAIR');const id=contract.customerId,name=contract.customerName,partiesBefore=Object.keys(state.businessWorld.parties).length,cash=F.operating(state,'bank'),financeBefore=JSON.stringify(state.finance);
 delete state.businessWorld.parties[id];delete state.bank.customerLoanPartySchema;delete state.bank.customerLoanPartyRepair;B.ensure(state);
 assert.equal(s.GH_BUSINESS_WORLD.resolveParty(state,id).displayName,name,'the original customer id and display name are restored');assert.equal(Object.keys(state.businessWorld.parties).length,partiesBefore,'repair does not create a second party');assert.equal(F.operating(state,'bank'),cash,'party repair does not post money');assert.equal(JSON.stringify(state.finance),financeBefore,'party repair leaves receipts and finance documents untouched');assert.equal(JSON.stringify(state.bank.customerLoanPartyRepair),JSON.stringify({schema:1,repaired:1,unresolved:0}));
 B.ensure(state);assert.equal(JSON.stringify(state.bank.customerLoanPartyRepair),JSON.stringify({schema:1,repaired:1,unresolved:0}),'party repair is one-time');
 state.simSeconds=30*86400;const due=B.execute({state},'collect-customer-installments',{throughDay:30,periodId:1,batchId:'PARTY-REPAIR-DUE'});assert.equal(due.paid,1,'the next installment closes successfully');assert.equal(state.finance.customerLoanPaymentReceipts[0].customerId,id);results.customerPartyRepair={repaired:1,collectionAfterRepair:due.paid};
}
// Reject a new orphan request before it can approve or post a loan.
{
 const e=customerCreditFixture(),{state,B}=e,before=state.bank.loanRequests.length,portfolios=state.bank.loanPortfolios.length;
 assert.throws(()=>B.execute({state},'submit-customer-loan-request',{id:'ORPHAN-CUSTOMER-QA',customerId:'MISSING-PARTY-QA',borrower:'Missing party',amount:1000000,product:'consumer',termDays:360,riskGrade:'AAA',sector:'retail'}),/bank-customer-party-not-found/);
 assert.equal(state.bank.loanRequests.length,before);assert.equal(state.bank.loanPortfolios.length,portfolios);results.orphanRequestRejected=true;
}
// Generated customer requests have no external customer id; approval registers the stable id the contract records.
{
 const e=customerCreditFixture(),{state,B,s}=e;state.bank.loanRequests.push({id:'GENERATED-CUSTOMER-QA',borrower:'Generated Buyer',sector:'retail',product:'consumer',amount:1000000,termDays:360,riskGrade:'AAA',collateralCoverage:0,branchId:'BR-CREDIT-QA',expiresDay:7,status:'بانتظار القرار'});
 const result=B.execute({state},'decide-loan-request',{id:'GENERATED-CUSTOMER-QA',decision:'approve'}),contract=state.bank.customerLoanContracts.find(row=>row.id===result.contractId),party=s.GH_BUSINESS_WORLD.resolveParty(state,contract.customerId);
 assert.equal(party.id,contract.customerId);assert.equal(party.displayName,'Generated Buyer');results.generatedCustomerParty=true;
}
{
 const e=customerCreditFixture(),{state,B,F}=e,{contract,portfolio}=e.approve('MISSING-PORTFOLIO');state.bank.loanPortfolios=state.bank.loanPortfolios.filter(row=>row.id!==portfolio.id);state.bank.customerCreditSchema=2;state.bank.lastProcessedDay=35;const cash=F.operating(state,'bank'),owed=contract.outstanding;B.ensure(state);assert.equal(contract.outstanding,owed);assert.equal(F.operating(state,'bank'),cash);assert.equal(state.bank.customerCreditRepair.unresolved,1,'missing evidence is retained for review, never guessed');state.simSeconds=30*86400;const missed=B.execute({state},'collect-customer-installments',{throughDay:30,periodId:1,batchId:'MISSING-EVIDENCE'});assert.equal(missed.paid,0,'a stale lookup cannot resurrect a missing portfolio');assert.equal(F.operating(state,'bank'),cash);results.unresolvedLegacyPreserved=true;
}
// A missed instalment carries interest once, and a later payment clears only that balance plus new interest.
{
 const e=customerCreditFixture(),{state,B}=e,{contract,portfolio}=e.approve();portfolio.stage=3;portfolio.status='متعثرة';
 state.simSeconds=30*86400;const one=B.execute({state},'collect-customer-installments',{throughDay:30,periodId:1,batchId:'MISS-1'});state.simSeconds=60*86400;const two=B.execute({state},'collect-customer-installments',{throughDay:60,periodId:2,batchId:'MISS-2'});
 close(two.items[0].interestDue,one.items[0].interestDue*2,'two missed months accumulate once');assert.equal(state.bank.customerInstallmentSettlements.length,2,'one history record per missed installment');portfolio.stage=1;portfolio.status='نشطة';state.simSeconds=90*86400;
 const paid=B.execute({state},'collect-customer-installments',{throughDay:90,periodId:3,batchId:'MISS-3'});close(paid.interestPaid,one.items[0].interestDue*3,'catch-up payment pays three months once');assert.equal(contract.accruedInterest,0);assert.equal(contract.interestArrears,0);results.arrears=true;
}
// A failed atomic operation restores principal, cash, contracts, receipts and the repayment policy.
{
 const e=customerCreditFixture(),{state,B,s}=e;e.approve();e.pauseBranches();const before=JSON.parse(JSON.stringify(state));
 assert.throws(()=>s.GH_TRANSACTION_CORE.execute(state,{label:'customer-credit-close-failure',apply(){state.simSeconds=30*86400;B.execute({state},'tick-day',{day:30});throw new Error('qa-credit-failure');}}),/qa-credit-failure/);assert.deepEqual(JSON.parse(JSON.stringify(state)),before);results.rollback=true;
}
// Automatic closes yield after each receipt within the existing single atomic day, not a new background worker.
{
 const e=customerCreditFixture(),{state,B,s}=e;for(let i=0;i<26;i++)e.approve('STAGED-'+i,100000);e.pauseBranches();state.simSeconds=30*86400;
 const TX=s.GH_TRANSACTION_CORE,before=JSON.parse(JSON.stringify(state)),start=()=>TX.beginStaged(state,{label:'staged-bank-receipts',apply:function*(){return yield* B.onFinancialDayStages({state,companyId:'bank'},{day:30});}});
 let job=start();while(!job.done&&state.finance.customerLoanPaymentReceipts.length<1)job.step();assert.equal(TX.isStaged(state),true);assert.equal(state.finance.customerLoanPaymentReceipts.length,1);assert.throws(()=>TX.execute(state,{apply(){}}),/staged-transaction-in-progress/);job.abort('qa-bank-abort');assert.deepEqual(JSON.parse(JSON.stringify(state)),before,'abort restores even the first posted receipt');
 job=start();let previous=0,maxDelta=0;while(!job.done){job.step();const n=state.finance.customerLoanPaymentReceipts.length;maxDelta=Math.max(maxDelta,n-previous);previous=n;}
 assert.equal(job.error,null);assert.equal(job.result.committed,true);assert.equal(state.finance.customerLoanPaymentReceipts.length,25);assert.equal(maxDelta,1);assert.equal(state.bank.customerInstallmentSchedule['30'].length,1);assert.equal(TX.isStaged(state),false);results.stagedReceipts={paid:25,maxReceiptsPerStep:maxDelta,abortAndRetry:true};
}
console.log(JSON.stringify({suite:'build385-bank-credit-accounting',ok:true,...results}));
