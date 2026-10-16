'use strict';
const assert=require('node:assert/strict'),{chromium,webkit}=require('playwright'),{boot,reboot}=require('./helpers/local-dom-app');
(async()=>{for(const engine of [chromium,webkit]){const browser=await engine.launch({headless:true}),errors=[];try{
 let {page}=await boot({browser,errors});page.setDefaultTimeout(90000);
 const result=await page.evaluate(async()=>{
  const a=__AUDIT__;await a.runAuthorizedDomainCommand('corporate','open-company',{type:'bank',capital:400000000,legalName:'QA Monthly Credit Bank'},{silent:true});
  const s=__GH_STATE__,B=GH_BANKING_CORE,F=GH_FINANCE_CORE;let contractId,portfolioId;
  GH_TRANSACTION_CORE.execute(s,{label:'qa-credit-origination',apply(){
   B.ensure(s).branchNetwork=[{id:'QA-CREDIT-BR',facilityId:'QA-CREDIT-BR',city:'Riyadh',country:'Saudi Arabia',servicesActive:true,services:[...B.ALL_BRANCH_SERVICES],retailCustomers:0,businessCustomers:0,deposits:0,loans:0,depositMix:{sight:0,savings:0,term:0},lastProcessedDay:0}];
   const customer=GH_BUSINESS_WORLD.upsertParty(s,{id:'QA-CREDIT-CUSTOMER',name:'QA Customer',role:'customer',country:'Saudi Arabia',sectors:['bank']});
   B.execute({state:s},'submit-customer-loan-request',{id:'QA-CREDIT-LOAN',customerId:customer.id,borrower:'QA Customer',amount:1000000,product:'consumer',termDays:360,riskGrade:'AAA',sector:'retail'});
   const decision=B.execute({state:s},'decide-loan-request',{id:'QA-CREDIT-LOAN',decision:'approve'});contractId=decision.contractId;portfolioId=decision.loanId;
   for(const row of s.bank.branchNetwork)row.servicesActive=false;s.bank.autoLiquidity=false;
  }});
  let earlyCash=0,principal=0,interest=0,bankDueSteps=0;const rate=s.bank.customerLoanContracts.find(row=>row.id===contractId).rate;
  for(let day=1;day<=30;day++){
   GH_TRANSACTION_CORE.execute(s,{label:'qa-monthly-bank-close-'+day,apply(){s.simSeconds=day*86400;a.processFinancialDay(day,(name,work)=>{const value=work(),label=typeof name==='function'?name():name;if(day===30&&String(label).includes('simulation.finance-day.owner.bank.'))bankDueSteps++;return value;});}});
   const row=s.bank.dailyHistory.find(row=>row.day===day);earlyCash+=row.unpostedInterestIncome;principal+=row.customerInstallmentPrincipalPaid;interest+=row.customerInstallmentInterestPaid;
  }
  const contract=s.bank.customerLoanContracts.find(row=>row.id===contractId),portfolio=s.bank.loanPortfolios.find(row=>row.id===portfolioId),receipts=s.finance.customerLoanPaymentReceipts.filter(row=>row.contractId===contractId);
  const bankCollections=s.finance.transfers.filter(row=>String(row.reference||row.id||'').startsWith('OPER-COLLECT-bank-'));
  const dailyCreditsExcludeLoan=bankCollections.length===30&&bankCollections.every(collection=>{const day=Number((collection.reference||collection.id).split('-').pop()),r=s.bank.dailyHistory.find(row=>row.day===day);return r&&Math.abs(collection.amount-r.securityIncome-r.feeIncome)<.02;});
  const saved=await a.saveNow();return {earlyCash,principal,interest,expectedInterest:1000000*rate*30/365,contractOutstanding:contract.outstanding,portfolioOutstanding:portfolio.outstanding,receipts:receipts.length,proofs:receipts.every(row=>GH_DOCUMENT_PROOF.verifyDocument(s,row).ok),dailyCreditsExcludeLoan,bankDueSteps,financialDays:s.lastFinancialDay,saveOk:saved!==false};
 });
 assert.equal(result.earlyCash,0);assert.ok(Math.abs(result.principal-1000000/12)<.02);assert.ok(Math.abs(result.interest-result.expectedInterest)<.02);assert.equal(result.contractOutstanding,result.portfolioOutstanding);assert.equal(result.receipts,1);assert.equal(result.proofs,true);assert.equal(result.dailyCreditsExcludeLoan,true);assert.ok(result.bankDueSteps>=2,'the real company adapter resumes after the installment');assert.equal(result.financialDays,30);assert.equal(result.saveOk,true);
 ({page}=await reboot(page,{browser,errors}));const reload=await page.evaluate(()=>({outstanding:__GH_STATE__.bank.customerLoanContracts.find(row=>row.customerId==='QA-CREDIT-CUSTOMER')?.outstanding,receipts:__GH_STATE__.finance.customerLoanPaymentReceipts.filter(row=>row.customerId==='QA-CREDIT-CUSTOMER').length,day:__GH_STATE__.lastFinancialDay}));assert.equal(reload.outstanding,result.contractOutstanding);assert.equal(reload.receipts,1);assert.equal(reload.day,30);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({suite:'build385-bank-credit-browser',engine:engine.name(),ok:true,...result,reload:true}));
 }finally{await browser.close();}}})().catch(error=>{console.error(error);process.exitCode=1;});
