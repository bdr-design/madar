'use strict';
const assert=require('node:assert/strict'),{customerCreditFixture}=require('./helpers/customer-credit-fixture.cjs');
const e=customerCreditFixture(),{state,B,F,s}=e;state.simSeconds=29*86400;
for(let i=0;i<26;i++)e.approve('BACKLOG-'+i,100000);e.pauseBranches();state.simSeconds=59*86400;
const first=B.execute({state},'tick-day',{day:59});assert.equal(first.customerInstallmentsPaid,25);assert.equal(state.bank.customerInstallmentSchedule['59'].length,1);
// Reload with one old date bucket: the next automatic day includes it, although the period changed.
const reload=JSON.parse(JSON.stringify(state));reload.simSeconds=60*86400;const next=B.execute({state:reload},'tick-day',{day:60});assert.equal(next.customerInstallmentsPaid,1);assert.equal(reload.bank.customerInstallmentSchedule['59'],undefined);assert.equal(reload.finance.customerLoanPaymentReceipts.length,26);
const after=JSON.stringify(reload);B.execute({state:reload},'tick-day',{day:60});assert.equal(JSON.stringify(reload),after);
// Explicit historical-period calls stay restricted to the requested period.
const manual=B.execute({state:reload},'collect-customer-installments',{throughDay:90,periodId:2,batchId:'MANUAL-PERIOD-2'});assert.equal(manual.due,25);assert.equal(manual.remaining,true);assert.equal(manual.items.every(row=>Number(row.dueDay)>=60&&Number(row.dueDay)<90),true);
// Exactly 25 remaining rows should not falsely advertise another nonempty batch.
const just=customerCreditFixture();for(let i=0;i<25;i++)just.approve('EXACT-'+i,100000);just.state.simSeconds=30*86400;
const exact=just.B.execute({state:just.state},'collect-customer-installments',{throughDay:30,periodId:1,batchId:'EXACT-25'});assert.equal(exact.due,25);assert.equal(exact.remaining,false);
// Even after a long gap, one call collects at most 25; it never loops over all elapsed calendar days.
const bounded=B.execute({state:reload},'collect-customer-installments',{throughDay:1000000,includeOverdue:true,batchId:'LONG-GAP'});assert.ok(bounded.due<=25);assert.equal(bounded.remaining,true);assert.ok(bounded.items.every(row=>row.dueDay<=1000000));
// Failure after a real receipt rolls back the schedule too, and retry can process the same due row once.
const last=customerCreditFixture(),loan=last.approve('FAIL-SCHEDULE');last.pauseBranches();last.state.simSeconds=30*86400;
const before=JSON.parse(JSON.stringify(last.state)),owner=last.F,broken={...owner,execute(ctx,name,p){const value=owner.execute(ctx,name,p);if(name==='receive-customer-loan-payment')throw new Error('qa-after-receipt');return value;}};last.s.GH_FINANCE_CORE=broken;
assert.throws(()=>last.s.GH_TRANSACTION_CORE.execute(last.state,{label:'failed-installment-schedule',apply(){last.B.execute({state:last.state},'collect-customer-installments',{throughDay:30,includeOverdue:true,batchId:'FAIL-RETRY'});}}),/qa-after-receipt/);assert.deepEqual(JSON.parse(JSON.stringify(last.state)),before);last.s.GH_FINANCE_CORE=owner;
const retry=last.B.execute({state:last.state},'collect-customer-installments',{throughDay:30,includeOverdue:true,batchId:'FAIL-RETRY'});assert.equal(retry.paid,1);assert.equal(last.state.bank.customerLoanContracts.find(r=>r.id===loan.contract.id).installmentNumber,1);
// The actual staged day still enters the registered system command owner. A second-receipt failure rolls the
// entire day back, and a retry retains both the 25-row bound and an opportunity to paint between receipts.
const staged=customerCreditFixture();for(let i=0;i<26;i++)staged.approve('STAGED-'+i,100000);staged.pauseBranches();staged.state.simSeconds=30*86400;
const commands=staged.s.GH_DOMAIN_COMMANDS,dispatches=[];staged.s.GH_DOMAIN_COMMANDS={...commands,*dispatchSystemStages(ctx,domain,name,payload,options){dispatches.push({domain,name,owner:payload.ownerCompanyId,actor:options.actor});return yield* commands.dispatchSystemStages(ctx,domain,name,payload,options);}};
const stagedBefore=JSON.stringify(staged.state),finance=staged.F;let receipts=0;
staged.s.GH_FINANCE_CORE={...finance,execute(ctx,name,p){const result=finance.execute(ctx,name,p);if(name==='receive-customer-loan-payment'&&++receipts===2)throw new Error('qa-staged-second-receipt');return result;}};
const runStaged=()=>{let step,yields=0;const iterator=staged.B.onFinancialDayStages({state:staged.state,companyId:'bank'},{day:30});while(!(step=iterator.next()).done)yields++;return {report:step.value,yields};};
assert.throws(()=>staged.s.GH_TRANSACTION_CORE.execute(staged.state,{label:'staged-bank-failure',apply:runStaged}),/qa-staged-second-receipt/);assert.equal(JSON.stringify(staged.state),stagedBefore);
staged.s.GH_FINANCE_CORE=finance;const stagedResult=staged.s.GH_TRANSACTION_CORE.execute(staged.state,{label:'staged-bank-retry',apply:runStaged}).value;
assert.equal(stagedResult.report.customerInstallmentsPaid,25);assert(stagedResult.yields>=25);assert.equal(staged.state.finance.customerLoanPaymentReceipts.length,25);assert.deepEqual(dispatches,[{domain:'banking',name:'tick-day',owner:'bank',actor:'simulation-scheduler'},{domain:'banking',name:'tick-day',owner:'bank',actor:'simulation-scheduler'}]);
assert.ok(F.operating(state,'bank')>0);assert.equal(s.GH_SAVE_SCHEMA.validate(reload).ok,true);
console.log(JSON.stringify({suite:'build385-bank-installment-backlog',ok:true,day59:first.customerInstallmentsPaid,day60:next.customerInstallmentsPaid,cap:25,reload:true,manualPeriodPreserved:true,rollbackAndRetry:true}));
