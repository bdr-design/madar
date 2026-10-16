'use strict';
const assert=require('node:assert/strict'),{hospitalityFixture}=require('./helpers/hospitality-fixture.cjs');
const results=[];function test(name,fn){fn();results.push(name);}
function booking(q,p,name='شركة عميل',startDay=2,endDay=5){const terms={propertyId:p.id,startDay,endDay,rooms:3,roomClass:0},quote=q.H.bookingQuote(q.state,'hospitality',terms);return q.command('reserve-group',{...terms,customerName:name,expectedGross:quote.gross});}
test('named customers get distinct invoices while individual-room revenue stays a single counted cohort',()=>{
 const q=hospitalityFixture(),p=q.property(),a=booking(q,p,'عميل أ'),b=booking(q,p,'عميل ب');q.advance(14);
 const invoices=q.state.finance.invoices.filter(r=>r.sourceRef?.startsWith('HOSP-INVOICE'));
 assert.equal(invoices.length,3);assert(invoices.some(r=>r.counterparty==='عميل أ'));assert(invoices.some(r=>r.counterparty==='عميل ب'));
 assert(q.H.read(q.state).bookings.find(r=>r.id===a.id).invoiceRefs[0].collected);assert(q.H.read(q.state).bookings.find(r=>r.id===b.id).invoiceRefs[0].collected);
 assert.equal(q.H.read(q.state).bookings.length,2,'no records per organic guest');
});
test('a credit note after collection keeps original VAT immutable and refunds exactly once',()=>{
 const q=hospitalityFixture(),p=q.property(),b=booking(q,p);q.advance(14);const current=q.H.read(q.state).bookings.find(r=>r.id===b.id),ref=current.invoiceRefs[0],netCents=b.nightNet*b.rooms,before=q.F.operating(q.state,'hospitality'),vat=q.F.book(q.state,'hospitality').vat.output;
 const credit=q.command('credit-booking',{bookingId:b.id,invoiceNumber:ref.number,netCents},'HOSP-CREDIT-ONCE');assert.equal(q.F.operating(q.state,'hospitality'),before);assert.equal(q.F.book(q.state,'hospitality').vat.output,vat);assert(q.F.book(q.state,'hospitality').vat.creditCarry>0);
 q.command('credit-booking',{bookingId:b.id,invoiceNumber:ref.number,netCents},'HOSP-CREDIT-ONCE');q.command('settle-due');const after=q.F.operating(q.state,'hospitality');assert.equal(Math.round((before-after)*100),Math.round(credit.refundable*100));
 q.command('settle-due');assert.equal(q.F.operating(q.state,'hospitality'),after);assert.equal(q.state.finance.hospitalityDocuments.filter(r=>r.reference===credit.creditNoteReference).length,1);assert.equal(q.state.finance.hospitalityDocuments.filter(r=>r.creditNoteReference===credit.creditNoteReference&&r.cashMovement===true).length,1,'one canonical payout remains after the operational queue is cleared');
 assert.throws(()=>q.command('credit-booking',{bookingId:b.id,invoiceNumber:ref.number,netCents:ref.net}),/credit-amount/);
 assert.equal(q.s.GH_SAVE_SCHEMA.validate(q.state).ok,true);
});
test('a closed prior tax period remains unchanged when a later credit creates carry-forward VAT',()=>{
 const q=hospitalityFixture(),p=q.property(),b=booking(q,p);q.advance(30);q.F.execute({state:q.state},'close-vat-period',{day:30});const period=JSON.stringify(q.state.finance.periods.find(r=>r.company==='hospitality')),current=q.H.read(q.state).bookings.find(r=>r.id===b.id);q.advance(31);
 q.command('credit-booking',{bookingId:b.id,invoiceNumber:current.invoiceRefs[0].number,netCents:b.nightNet*b.rooms});assert.equal(JSON.stringify(q.state.finance.periods.find(r=>r.company==='hospitality')),period);assert(q.F.book(q.state,'hospitality').vat.creditCarry>0);
});
test('multiple tiny partial credits refund the exact original VAT when the last service amount is credited',()=>{
 const q=hospitalityFixture(),p=q.property(),b=booking(q,p);q.advance(14);const ref=q.H.read(q.state).bookings.find(r=>r.id===b.id).invoiceRefs[0],before=q.F.operating(q.state,'hospitality');
 for(const netCents of [2,3,ref.net-5])q.command('credit-booking',{bookingId:b.id,invoiceNumber:ref.number,netCents});
 const current=q.H.read(q.state).bookings.find(r=>r.id===b.id).invoiceRefs[0];assert.equal(current.creditedNet,ref.net);assert.equal(current.creditedTax,ref.tax);q.command('settle-due');assert.equal(Math.round((before-q.F.operating(q.state,'hospitality'))*100),ref.gross);assert(q.H.validateState(q.state).ok);
});
test('invalid saved calendars, NaN balances and cross-company ownership are rejected without throwing from validation',()=>{
 const q=hospitalityFixture(),p=q.property();booking(q,p);
 const good=structuredClone(q.state);for(const mutate of [s=>s.hospitality.companies.hospitality=null,s=>s.hospitality.companies.hospitality.properties[0].rooms=null,s=>s.hospitality.companies.hospitality.properties[0].calendar={},s=>s.hospitality.companies.hospitality.totals.net=NaN,s=>s.hospitality.companies.hospitality.bookings[0].propertyId='other-company-property',s=>s.hospitality.companies.hospitality.properties[0].calendar[7]={day:7,reserved:[99,0,0],walkin:[0,0,0]}]){
  const bad=structuredClone(good);mutate(bad);assert.doesNotThrow(()=>q.H.validateState(bad));assert.equal(q.H.validateState(bad).ok,false);
 }
 const sections=[...q.H.validationSteps(good)];assert(sections.length>=2,'validation yields between properties and bookings');assert(q.H.validateState(good).ok);
});
test('a company bank facility accepts the new sector and preserves principal instead of recording room revenue',()=>{
 const q=hospitalityFixture();q.F.execute({state:q.state},'founder-investment',{company:'group',amount:100000000,ref:'HOSP-QA-BANK-CAPITAL'});q.s.GH_DOMAIN_COMMANDS.dispatch({state:q.state},'corporate','open-company',{type:'bank',capital:100000000});
 const B=q.s.GH_BANKING_CORE;B.ensure(q.state);const before=q.F.operating(q.state,'hospitality');B.execute({state:q.state},'draw-facility',{company:'hospitality',amount:1000000,termDays:365});
 assert(q.F.operating(q.state,'hospitality')>before);assert(q.state.bank.corporateFacilities.some(r=>r.ownerCompanyId==='hospitality'||r.company==='hospitality'));assert.equal(q.H.read(q.state),null,'financing does not generate lodging business');
});
test('financial and legal hospitality documents remain locatable after retention moves them out of the live list',()=>{
 const q=hospitalityFixture();let first;
 for(let i=0;i<70;i++){const result=q.F.execute({state:q.state},'register-commercial-contract',{company:'hospitality',id:'HOSP-QA-CONTRACT-'+i,contractType:'اختبار أرشيف ضيافة',counterparty:'جهة اختبار',amount:100,startDay:0,endDay:30,terms:{i}});if(i===0)first=result;}
 assert(q.state.finance.auditArchive.records.commercialContracts.length>=6);
 assert(q.s.GH_DOCUMENT_PROOF.locateDocument(q.state,first.documentProofId));
 const retry=q.F.execute({state:q.state},'register-commercial-contract',{company:'hospitality',id:'HOSP-QA-CONTRACT-0',contractType:'اختبار أرشيف ضيافة',counterparty:'جهة اختبار',amount:100,startDay:0,endDay:30,terms:{i:0}});assert.equal(retry.documentProofId,first.documentProofId);
});
console.log(JSON.stringify({suite:'build393-hospitality-financial-safety',passed:results.length,results}));
