'use strict';
// Build 662, found by playing (store edition, 15 companies, game day 93): the daily compaction moves collected invoices past
// the 2,500 live rows to finance.auditArchive, while a customer receipt that names one of them stays live (a hotel deposit,
// a customer's advance payment, a bank-financed car sale: lists of 1,200 and 400). The save schema looked for the receipt's
// invoice in the live rows only: «customer-sale-payment-shape», every save refused from then on and the clock stopped at
// the day close. The archived invoice now counts, as for cheques (Build 359), and it stays in the hot archive while a live
// receipt names it. Checked here with the game's own commands and the compaction and sealing code of app.js:
// - 2,600 collected invoices later the compaction archives the invoices of three live receipts; the state stays valid and
//   no integrity issue appears;
// - a receipt whose invoice is nowhere, or whose archived invoice belongs to another customer or company, is still refused;
// - 100 game days later the sealing moves the other archived invoices to cold pages and keeps the named ones (a financing
//   receipt alone keeps its invoice); the check then reads no cold page; once no receipt names one it is sealed too;
// - a pass that finds only named old rows is not repeated for a game week (it read every live document's links twice a
//   game day to find nothing);
// - an invoice in a cold page while its receipt is live (no build can save that state; a defence) is found there;
// - the same on the hotel's own path: a group booking's deposit applied to the stay's invoice.
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||require('node:path').resolve(__dirname,'..');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {harness,minimal,ROOT}=require('./helpers/core-harness'),{hospitalityFixture}=require('./helpers/hospitality-fixture.cjs');
const {s}=harness(['state-codec-core','capability-registry-core','company-definitions','company-platform-core','identity-system','control-plane-core','authorization-core','document-proof-core','transaction-core','domain-command-core','integrity-core','save-schema','determinism-core','event-ledger-core','dependency-core','policy-core','lifecycle-core','delivery-monitor-core','realism-core','finance-core','hr-core','corporate-core','facility-core','business-world-core','banking-core','insurance-core','energy-core','game-lifecycle-core']);
const D=s.GH_DOMAIN_COMMANDS,B=s.GH_BANKING_CORE,F=s.GH_FINANCE_CORE,T=s.GH_TRANSACTION_CORE,Schema=s.GH_SAVE_SCHEMA,Codec=s.GH_STATE_CODEC,I=s.GH_INTEGRITY_CORE;
const RECEIPT_ERRORS=['customer-sale-payment-shape','customer-financing-receipt-shape','customer-sale-credit-shape'],DAY=86400;
const receiptErrors=state=>Array.from(Schema.validate(state).errors).filter(code=>RECEIPT_ERRORS.includes(code)).sort();
const valid=(state,label)=>{const out=Schema.validate(state);assert.ok(out.ok,`${label}: ${JSON.stringify(out.errors)}`);};
const criticalIssues=state=>Array.from(I.check(state).issues).filter(row=>row.severity==='critical').map(row=>String(row.id)).sort();
const copy=value=>JSON.parse(JSON.stringify(value));

const data={...minimal(),profile:{name:'Receipt Archive Test'},bank:{},operations:{},crew:[],branches:[],hired:[],unlockedSectors:[],ownedCompanies:[]};
const state=s.GH_GAME_LIFECYCLE.pristine(data,1);
s.GH_GAME_LIFECYCLE.foundGroup(state,{mode:'sandbox',name:'Receipt Archive Group',founder:'Founder',locationId:'RUH'},data,{nextId:()=>'FOUND-RA',simYear:()=>2026});
D.dispatch({state},'corporate','open-company',{type:'bank',capital:400000000,legalName:'Archive Bank'});
D.dispatch({state},'corporate','open-company',{type:'dealership',capital:100000000,legalName:'Archive Dealer'});
const system=(domain,action,payload,key)=>{const out=D.dispatchSystem({state},domain,action,payload,{actor:'simulation-scheduler',idempotencyKey:key});assert.equal(out.ok,true,out.error);return out.result;};

// 1. A customer's advance payment and the rest of the invoice: two live receipts on one collected invoice.
const guest=s.GH_BUSINESS_WORLD.upsertParty(state,{id:'CUSTOMER-RA',name:'Group Guest',displayName:'Group Guest',role:'customer',industry:'automotive-retail',country:'Saudi Arabia',sectors:['automotive-retail']});
const stay=system('finance','issue-invoice',{kind:'دخل',amount:5000,company:'dealership',counterparty:'Group Guest',counterpartyPartyId:guest.id,note:'advance payment sale'},'INV-RA-1');
const deposit=system('finance','receive-customer-sale-payment',{company:'dealership',invoiceNumber:stay.number,customerId:guest.id,amount:1000,reference:'DEPOSIT-RA-1'},'PAY-RA-1');
assert.equal(deposit.remaining,4000);
system('finance','receive-customer-sale-payment',{company:'dealership',invoiceNumber:stay.number,customerId:guest.id,amount:deposit.remaining,reference:'DEPOSIT-RA-2'},'PAY-RA-2');
assert.equal(state.finance.invoices.find(row=>row.number===stay.number).status,'محصلة');
// 2. A bank-financed car sale: a financing receipt and a sale payment receipt on the dealer's collected invoice.
state.bank.branchNetwork=[{id:'BR-RA',facilityId:'BR-RA',city:'Riyadh',country:'Saudi Arabia',openedAt:0,servicesActive:true,services:[...B.ALL_BRANCH_SERVICES],retailCustomers:0,businessCustomers:0,deposits:0,loans:0,depositMix:{sight:0,savings:0,term:0},incomeStatement:{},lastProcessedDay:0}];state.bank.branches=1;
const buyer=s.GH_BUSINESS_WORLD.upsertParty(state,{id:'CUSTOMER-RA-CAR',name:'Car Buyer',displayName:'Car Buyer',role:'customer',industry:'automotive-retail',country:'Saudi Arabia',sectors:['automotive-retail']});
const quote=B.customerFinancingQuote(state,{invoiceAmount:2000000,downPayment:0,product:'consumer',termDays:1825});
const loan={id:'AUTO-LOAN-SALE-RA',customerId:buyer.id,borrower:buyer.displayName,amount:quote.loanPrincipal,product:'consumer',termDays:quote.termDays,sector:'auto',sourceCompanyId:'dealership',sourceSaleId:'SALE-RA',orderId:'SALE-RA',proFormaReference:'AUTO-ORDER-SALE-RA',invoiceAmount:quote.invoiceAmount,downPayment:quote.downPayment,disbursementAmount:quote.disbursementAmount};
system('banking','submit-customer-loan-request',loan,'SUBMIT-RA');
assert.equal(system('banking','approve-loan-requests-batch',{batchId:'BANK-APPROVAL-RA',periodId:'0',decisions:[{id:loan.id,decision:'approve'}]},'APPROVE-RA').approved,1);
const financed=B.customerDisbursementForSale(state,{sourceSaleId:loan.sourceSaleId,orderId:loan.orderId});assert.equal(financed.status,'posted');
const named=[stay.number,financed.invoiceNumber].sort();
assert.deepEqual(Array.from(state.finance.customerSalePaymentReceipts,row=>row.invoiceNumber).sort(),[stay.number,stay.number,financed.invoiceNumber].sort(),'three live sale payment receipts');
assert.deepEqual(Array.from(state.finance.customerFinancingReceipts,row=>row.invoiceNumber),[financed.invoiceNumber],'one live financing receipt');
valid(state,'before any archiving');const issuesBefore=criticalIssues(state);

// 2,600 later invoices, all collected: the two named invoices are now the oldest rows, past the 2,500 live rows.
{const out=T.execute(state,{label:'later-invoices',apply:()=>{for(let i=0;i<2600;i++)F.issueInvoice(state,{kind:'دخل',amount:100+i,company:'dealership',counterparty:'Walk-in',note:'later sale',status:'محصلة'});}});assert.equal(out.committed,true,out.reason);}
assert.ok(named.every(number=>state.finance.invoices.findIndex(row=>row.number===number)>=2500));
// The compaction and the sealing, as app.js runs them.
const app=fs.readFileSync(path.join(ROOT,'WebApp/app.js'),'utf8'),start=app.indexOf('  function financeAuditArchive()'),end=app.indexOf('  function normalizeSimulationClocks()',start);assert.ok(start>0&&end>start);
function maintenanceOf(realm,world){
  Object.assign(realm,{state:world,clone:value=>value===undefined?undefined:copy(value),companyFinanceTypes:()=>[],companyBook:()=>null});
  vm.runInContext(app.slice(start,end)+'\nglobalThis.maintenance={compactSimulationState,auditSealSelection,liveProofIds,sealAuditRound};',realm);return realm.maintenance;
}
// The pages the cold archive decodes while a function runs (the codec is read from the realm at each call).
function coldReads(realm,run){const codec=realm.GH_STATE_CODEC;let reads=0;realm.GH_STATE_CODEC={...codec,coldArchiveRows:page=>{reads++;return codec.coldArchiveRows(page);}};try{run();}finally{realm.GH_STATE_CODEC=codec;}return reads;}
const M=maintenanceOf(s,state),live=number=>state.finance.invoices.some(row=>row.number===number),hot=number=>(state.finance.auditArchive?.records?.invoices||[]).some(row=>row.number===number);
const cold=number=>(state.coldArchive?.pages||[]).filter(page=>page.kind==='invoices').some(page=>Codec.coldArchiveRows(page).some(row=>row.number===number));
state.simSeconds=3*DAY;assert.equal(M.compactSimulationState(true),true);
assert.equal(state.finance.invoices.length,2500);assert.ok(named.every(number=>!live(number)&&hot(number)),'the named invoices were archived');
assert.equal(state.finance.customerSalePaymentReceipts.length,3);assert.equal(state.finance.customerFinancingReceipts.length,1);
valid(state,'receipts whose invoices were archived');
assert.deepEqual(criticalIssues(state),issuesBefore,'archiving a receipt\'s invoice raises no integrity issue');
valid(Codec.deserialize(Codec.serialize(state)),'the same state after a save and a load');
// The same check without the finance owner (its index): the archived rows are read directly.
{const owner=s.GH_FINANCE_CORE;s.GH_FINANCE_CORE=undefined;try{assert.deepEqual(receiptErrors(state),[]);}finally{s.GH_FINANCE_CORE=owner;}}
console.log('1 ok: 2,600 collected invoices later the receipts\' invoices are archived and the state is valid');

// Real mismatches are still refused.
{const broken=copy(state);broken.finance.auditArchive.records.invoices=broken.finance.auditArchive.records.invoices.filter(row=>!named.includes(row.number));
  assert.deepEqual(receiptErrors(broken),['customer-financing-receipt-shape','customer-sale-payment-shape'],'an invoice that is nowhere');}
{const broken=copy(state);broken.finance.auditArchive.records.invoices.find(row=>row.number===stay.number).counterpartyPartyId='CUSTOMER-OTHER';
  assert.deepEqual(receiptErrors(broken),['customer-sale-payment-shape'],'an archived invoice of another customer');}
{const broken=copy(state);broken.finance.auditArchive.records.invoices.find(row=>row.number===financed.invoiceNumber).company='bank';
  assert.deepEqual(receiptErrors(broken),['customer-financing-receipt-shape','customer-sale-payment-shape'],'an archived invoice of another company');}
{const broken=copy(state);broken.finance.customerSalePaymentReceipts[0].invoiceNumber='';assert.deepEqual(receiptErrors(broken),['customer-sale-payment-shape'],'a receipt without an invoice number');}
// A live invoice wins over an archived row with the same number.
{const twice=copy(state),row=twice.finance.auditArchive.records.invoices.find(row=>row.number===stay.number);twice.finance.invoices.push(copy(row));row.counterpartyPartyId='CUSTOMER-OTHER';
  assert.ok(!receiptErrors(twice).includes('customer-sale-payment-shape'),'the live invoice is the one compared');}
console.log('2 ok: a missing invoice and an invoice of another customer or company are still refused');

// 100 game days later: the other archived invoices are due for the cold pages, the named ones stay hot.
state.simSeconds=103*DAY;
{const entry={queue:M.auditSealSelection(),keep:M.liveProofIds()},due=Array.from(entry.queue).filter(item=>item.kind==='invoices').map(item=>item.row.number);
  assert.equal(due.length,state.finance.auditArchive.records.invoices.length-named.length,'every archived invoice but the named ones is due');assert.ok(named.every(number=>!due.includes(number)));
  const ages=Array.from(entry.queue,item=>item.at);assert.deepEqual(ages,[...ages].sort((a,b)=>a-b),'oldest first');
  let rounds=0;while(entry.queue.length&&rounds++<200)M.sealAuditRound(entry);assert.equal(entry.queue.length,0);}
assert.deepEqual(Array.from(state.finance.auditArchive.records.invoices,row=>row.number).sort(),named,'only the named invoices are left in the hot archive');
assert.ok(named.every(number=>!cold(number)));valid(state,'after the sealing');valid(Codec.deserialize(Codec.serialize(state)),'after the sealing, saved and loaded');
assert.ok((state.coldArchive?.pages||[]).some(page=>page.kind==='invoices'),'there are cold invoice pages now');
assert.equal(coldReads(s,()=>{valid(state,'checked with cold pages present');criticalIssues(state);}),0,'a named invoice is found in the hot archive: no cold page is decoded');
// A financing receipt alone keeps its invoice: without the sale receipts and the bank's transfer, the financed invoice stays.
{const keep={sale:state.finance.customerSalePaymentReceipts,transfers:state.finance.transfers};
  state.finance.customerSalePaymentReceipts=keep.sale.filter(row=>row.invoiceNumber!==financed.invoiceNumber);state.finance.transfers=keep.transfers.filter(row=>row.documentNumber!==financed.invoiceNumber);
  state.simSeconds+=8*DAY;assert.deepEqual(Array.from(M.auditSealSelection()),[],'named by its financing receipt only');
  state.finance.customerSalePaymentReceipts=keep.sale;state.finance.transfers=keep.transfers;}
// Once no live receipt names it (the lists are capped), an invoice is sealed like any other archived invoice; the financed
// sale's invoice is still named by the bank's live transfer and stays.
{const receipts={sale:state.finance.customerSalePaymentReceipts,financing:state.finance.customerFinancingReceipts};
  state.finance.customerSalePaymentReceipts=[];state.finance.customerFinancingReceipts=[];
  // The pass above found only named old rows: the next one inside a game week answers at once, the one after it reads again.
  assert.deepEqual(Array.from(M.auditSealSelection()),[],'not read again inside the game week');
  state.simSeconds+=7*DAY;
  assert.deepEqual(Array.from(M.auditSealSelection()).filter(item=>item.kind==='invoices').map(item=>item.row.number).sort(),[stay.number],'unnamed, it is due');
  // An invoice already in a cold page while its receipt is live (a state saved before this build): found in the page.
  const entry={queue:M.auditSealSelection(),keep:M.liveProofIds()};let rounds=0;while(entry.queue.length&&rounds++<50)M.sealAuditRound(entry);
  assert.ok(cold(stay.number)&&!hot(stay.number)&&hot(financed.invoiceNumber),'sealed to a cold page');
  state.finance.customerSalePaymentReceipts=receipts.sale;state.finance.customerFinancingReceipts=receipts.financing;
  assert.deepEqual(receiptErrors(state),[],'a receipt whose invoice is in a cold page');valid(state,'a receipt whose invoice is in a cold page');
  valid(Codec.deserialize(Codec.serialize(state)),'the same, saved and loaded');}
console.log('3 ok: named invoices stay in the hot archive, unnamed ones are sealed, and a cold invoice is still found');

// 4. The hotel's own path: a group booking pays a deposit, the stay is invoiced and the deposit applied to that invoice.
{const q=hospitalityFixture(),world=q.state,realm=q.s;q.load('state-codec-core');q.load('integrity-core');
  const property=q.property(),terms={propertyId:property.id,startDay:20,endDay:26,rooms:2,roomClass:0},quote=q.H.bookingQuote(world,'hospitality',terms);
  q.command('reserve-group',{...terms,customerName:'عميل وديعة',expectedGross:quote.gross});q.advance(45);
  const receipts=world.finance.customerSalePaymentReceipts||[],deposits=Array.from(new Set(Array.from(receipts,row=>row.invoiceNumber)));
  assert.ok(receipts.length>0&&Array.from(receipts).every(row=>String(row.reference).startsWith('HOSP-DEPOSIT-APPLY:')),'the stay applied the deposit to its invoice');
  const check=label=>{const out=realm.GH_SAVE_SCHEMA.validate(world);assert.ok(out.ok,`${label}: ${JSON.stringify(out.errors)}`);};check('hotel, before any archiving');
  {const out=realm.GH_TRANSACTION_CORE.execute(world,{label:'later-invoices',apply:()=>{for(let i=0;i<2600;i++)realm.GH_FINANCE_CORE.issueInvoice(world,{kind:'دخل',amount:100+i,company:'hospitality',counterparty:'Walk-in',note:'later stay',status:'محصلة'});}});assert.equal(out.committed,true,out.reason);}
  const H=maintenanceOf(realm,world),hotRows=()=>Array.from(world.finance.auditArchive?.records?.invoices||[],row=>row.number);
  world.simSeconds=47*DAY;assert.equal(H.compactSimulationState(true),true);
  assert.ok(deposits.every(number=>!world.finance.invoices.some(row=>row.number===number)&&hotRows().includes(number)),'the stay\'s invoice was archived');
  check('hotel, the deposit\'s invoice archived');
  {const out=realm.GH_SAVE_SCHEMA.validate(realm.GH_STATE_CODEC.deserialize(realm.GH_STATE_CODEC.serialize(world)));assert.ok(out.ok,`hotel, saved and loaded: ${JSON.stringify(out.errors)}`);}
  // 100 game days later, with the stay's own documents gone from their list (it keeps 64): the receipt alone names the invoice.
  world.simSeconds=150*DAY;world.finance.hospitalityDocuments=[];
  const entry={queue:H.auditSealSelection(),keep:H.liveProofIds()};assert.ok(entry.queue.length>0);assert.ok(deposits.every(number=>!Array.from(entry.queue).some(item=>item.row.number===number)),'the receipt keeps its invoice hot');
  let rounds=0;while(entry.queue.length&&rounds++<400)H.sealAuditRound(entry);assert.equal(entry.queue.length,0);
  assert.ok(deposits.every(number=>hotRows().includes(number)));check('hotel, after the sealing');}
console.log('4 ok: a hotel deposit applied to an invoice the compaction archived keeps the save valid');
console.log('build662 receipt archived invoice: 4 checks passed');
