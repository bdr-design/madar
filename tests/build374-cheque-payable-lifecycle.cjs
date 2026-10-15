'use strict';
const assert=require('node:assert/strict');
const {scenario}=require('./helpers/business-scenario');
let checks=0;
function setup(company){
  const e=scenario(),{state,s}=e;
  if(!['air','group'].includes(company))e.command('corporate','open-company',{type:company,capital:200000000,legalName:`Lifecycle ${company}`});
  const command=(name,p)=>e.command('finance',name,p);
  const invoice=command('accrue-expense',{company,amount:1150,note:'Supplier obligation',counterparty:'Supplier lifecycle',dueDay:1,paymentTerms:1});
  const cheque=command('issue-cheque',{company,amount:1150,beneficiary:invoice.counterparty,invoiceNumber:invoice.number,dueDay:1});
  const getCheque=()=>state.finance.cheques.find(row=>row.id===cheque.id);
  const balance=()=>s.GH_FINANCE_CORE.operating(state,company);
  const snapshot=()=>JSON.stringify([state.finance,state.companyFinance,state.treasury,state.cash,state.documentProofs]);
  const bounce=()=>{command('transfer',{from:company,to:company==='group'?'air':'group',amount:balance(),note:'Fixture funds withdrawal'});assert.equal(command('settle-cheque',{id:cheque.id}).settled,false);command('credit',{company,amount:2000,taxable:false,reference:`REFILL-${company}`});};
  const clean=()=>{assert.deepEqual(Array.from(s.GH_INTEGRITY_CORE.check(state).issues.filter(row=>row.severity==='critical'),row=>row.id),[]);};
  return {...e,command,company,invoice,cheque,getCheque,balance,snapshot,bounce,clean};
}
for(const company of ['group','power','telecom','air','sea','road','bank','realestate','mobility','insurance','dealership']){
  {
    const e=setup(company),before=e.snapshot();
    assert.throws(()=>e.command('settle-payable',{number:e.invoice.number,method:'transfer'}),/payable-cheque-pending/);
    assert.equal(e.snapshot(),before);e.clean();
    assert.equal(e.command('settle-due-terms',{day:1,company}).chequePending,1);
    const b=e.balance();assert.equal(e.command('settle-cheque',{id:e.cheque.id}).settled,true);
    assert.equal(b-e.balance(),1150);const after=e.balance();
    assert.equal(e.command('settle-cheque',{id:e.cheque.id}).settled,true);assert.equal(e.balance(),after);e.clean();checks++;
  }
  for(const automatic of [false,true]){
    const e=setup(company);e.bounce();const before=e.balance();e.state.simSeconds=86400;
    const r=automatic?e.command('settle-due-terms',{day:1,company}):e.command('settle-payable',{number:e.invoice.number,method:'transfer'});
    assert.equal(before-e.balance(),1150);assert.equal(e.getCheque().status,'ملغى');
    const tr=e.state.finance.transfers.find(row=>row.reference===e.getCheque().settlementReference);
    assert.ok(tr);assert.ok(tr.cancelledChequeIds.includes(e.cheque.id));
    assert.equal(tr.documentNumber,e.invoice.number);assert.equal(e.state.finance.payables.some(row=>row.number===e.invoice.number),false);
    for(const doc of [e.getCheque(),tr])assert.equal(e.s.GH_DOCUMENT_PROOF.verifyDocument(e.state,doc).ok,true);
    assert.throws(()=>e.command('settle-cheque',{id:e.cheque.id}),/cheque-cancelled/);
    const settled=e.balance();assert.equal(e.command('settle-due-terms',{day:1,company}).paid,0);assert.equal(e.balance(),settled);e.clean();
    const restored=JSON.parse(JSON.stringify(e.state));assert.equal(e.s.GH_INTEGRITY_CORE.check(restored).counts.critical,0);
    // The exact link survives hot archival and lossless cold storage.
    const historical=JSON.parse(JSON.stringify(e.state));historical.finance.auditArchive={records:{transfers:[tr]},digests:[]};historical.finance.transfers=historical.finance.transfers.filter(row=>row.reference!==tr.reference);
    assert.equal(e.s.GH_INTEGRITY_CORE.check(historical).counts.critical,0);
    e.load('state-codec-core');const cold=JSON.parse(JSON.stringify(historical));cold.coldArchive={schema:'gh-cold-archive-v1',pages:[e.s.GH_STATE_CODEC.createColdArchivePage('transfers',[tr],{firstAt:0,lastAt:86400,createdAtSim:86400})]};cold.finance.auditArchive.records.transfers=[];
    assert.equal(e.s.GH_INTEGRITY_CORE.check(cold).counts.critical,0);
    // A cancellation requires the exact actual settlement, not a plausible-looking status or reference.
    const bad=JSON.parse(JSON.stringify(e.state));bad.finance.transfers.find(row=>row.reference===tr.reference).amount+=1;
    assert.ok(e.s.GH_INTEGRITY_CORE.check(bad).issues.some(row=>row.id===`FINANCE_CHEQUE_PAYABLE_MISSING_${e.cheque.id}`));
    assert.ok(r);checks++;
  }
  {
    const e=setup(company);e.bounce();const before=e.snapshot();
    assert.throws(()=>e.s.GH_TRANSACTION_CORE.execute(e.state,{label:'settlement-rollback',apply(){
      e.command('settle-payable',{number:e.invoice.number,method:'transfer'});
      e.s.GH_TRANSACTION_CORE.afterCommit(()=>{throw new Error('injected-final-check');},{critical:true});
    }}),/injected-final-check/);
    assert.equal(e.snapshot(),before);e.clean();checks++;
  }
  {
    const e=setup(company);e.bounce();
    const replacement=e.command('issue-cheque',{company,amount:1150,beneficiary:e.invoice.counterparty,invoiceNumber:e.invoice.number,dueDay:1});
    assert.equal(e.getCheque().replacedBy,replacement.id);
    assert.throws(()=>e.command('settle-payable',{number:e.invoice.number,method:'transfer'}),/payable-cheque-pending/);
    const b=e.balance();assert.equal(e.command('settle-cheque',{id:replacement.id}).settled,true);assert.equal(b-e.balance(),1150);e.clean();checks++;
  }
  {
    const e=setup(company);e.bounce();e.command('transfer',{from:company,to:company==='group'?'air':'group',amount:e.balance(),note:'Fixture funds withdrawal again'});
    const before=e.snapshot();assert.throws(()=>e.command('settle-payable',{number:e.invoice.number,method:'transfer'}),/insufficient-cash/);
    assert.equal(e.snapshot(),before);assert.equal(e.command('settle-due-terms',{day:1,company}).unpaid,1);assert.equal(e.getCheque().status,'مرتجع');e.clean();checks++;
  }
}
console.log(JSON.stringify({ok:true,checks,companies:11}));
