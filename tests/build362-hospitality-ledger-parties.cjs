'use strict';
// Build 362 follow-up (iPhone diagnostic DX-1792142505027: FINANCE_LEDGER_PARTY warnings for HOSP-ACCRUAL-hospitality-21..24):
// every hospitality accounting document reached the treasury ledger without a source and beneficiary. Each now names its
// parties on its ledger row (non-cash rows name accounting accounts, as Finance Core's accruals do); the signed document is
// unchanged. Proven over a full cycle: daily accruals, cycle invoices and collection, a named booking's deposit, a credit
// note and its payout; integrity then reports no party warning and the documents still verify.
const assert=require('node:assert/strict'),path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {hospitalityFixture}=require(path.join(ROOT,'tests/helpers/hospitality-fixture.cjs'));
const q=hospitalityFixture(),{s,state,H,command}=q,p=q.property();if(!s.GH_INTEGRITY_CORE)q.load('integrity-core');
// Arrival after the day-15 close: its refundable deposit is collected on that close.
const terms={propertyId:p.id,startDay:18,endDay:21,rooms:3,roomClass:0},quote=H.bookingQuote(state,'hospitality',terms);
const b=command('reserve-group',{...terms,customerName:'عميل الحفل',expectedGross:quote.gross});
q.advance(50);
const booked=H.read(state).bookings.find(r=>r.id===b.id),ref=booked.invoiceRefs[0];
command('credit-booking',{bookingId:b.id,invoiceNumber:ref.number,netCents:b.nightNet});command("settle-due");q.advance(80);
const rows=state.treasury.ledger.filter(row=>row.kind==='hospitality-accounting');
const kinds=new Set(state.finance.hospitalityDocuments.map(row=>`${row.cashMovement}:${String(row.reference).split(/[-:]/)[0]}`));
assert(rows.length>=8,'the cycle produced hospitality ledger rows');
for(const row of rows)assert(row.from&&row.to,`ledger row ${row.reference} names both parties`);
const deposit=rows.find(row=>String(row.reference).startsWith('HOSP-DEPOSIT:'));assert(deposit,'a deposit row');assert.equal(deposit.from,'عميل الحفل');
const payout=rows.find(row=>String(row.reference).startsWith('PAY-HOSP-CREDIT'));assert(payout,'a credit payout row');assert.equal(payout.to,'عميل الحفل');
const accrual=rows.find(row=>String(row.reference).startsWith('HOSP-ACCRUAL-'));assert.equal(accrual.to,'إيرادات ضيافة مستحقة');assert.equal(accrual.cashMovement,false);
const integrity=s.GH_INTEGRITY_CORE.check(state),party=(integrity.issues||[]).filter(row=>String(row.id).startsWith('FINANCE_LEDGER_PARTY_'));
assert.equal(JSON.stringify(party.map(row=>row.id)),'[]','no ledger row without parties');
// The documents themselves carry no parties: only their ledger projections do.
assert(state.finance.hospitalityDocuments.every(row=>row.from===undefined&&row.to===undefined),'signed documents are unchanged');
assert(H.validateState(state).ok);
console.log(JSON.stringify({suite:'build362-hospitality-ledger-parties',ok:true,rows:rows.length,documentKinds:[...kinds].sort()}));
