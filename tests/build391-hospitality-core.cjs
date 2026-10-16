'use strict';
const assert=require('node:assert/strict');
const {hospitalityFixture}=require('./helpers/hospitality-fixture.cjs');
const {harness}=require('./helpers/core-harness');
const results=[];
function check(name,fn){fn();results.push(name);}
check('calendar cycles include every day once through leap and year boundaries',()=>{
 const {s}=harness(['hospitality-calendar-core']),C=s.GH_HOSPITALITY_CALENDAR;
 for(let day=0;day<1100;day++){
  const cycle=C.cycle(day);assert(cycle.startDay<=day&&cycle.endDay>=day);assert.equal(C.dateForDay(cycle.endDay).getUTCDate(),15);
  assert.equal(C.dateForDay(cycle.startDay<0?0:cycle.startDay).getUTCDate(),cycle.startDay<0?1:16);
  if(C.isCloseDay(day))assert.equal(C.cycle(day+1).startDay,day+1);
 }
 for(const bad of [-1,.2,NaN,Infinity,1000001])assert.throws(()=>C.cycle(bad),/hospitality-day-invalid/);
});
check('dynamic identity and independent registration',()=>{
 const {s,state}=hospitalityFixture(),P=s.GH_COMPANY_PLATFORM;
 assert.equal(P.brandedIdentity(state,'hospitality').tradeName,'الاختبار للفنادق والمنتجعات');
 assert.equal(P.definitionFor(state,'hospitality').instancePolicy.mode,'multi');
 assert(P.definitionFor(state,'hospitality').capabilities.includes('finance.tax'));
 assert.equal(s.GH_HOSPITALITY_CORE.read(state),null,'view does not create an operational register');
});
check('construction is paid, acceleration completes the actual facility and stale quotes change nothing',()=>{
 const {state,H,F,command}=hospitalityFixture(),q=H.buildQuote(state,'hospitality',{kind:'hotel',capitalId:'RUH'}),cash=F.operating(state,'hospitality');
 assert.throws(()=>command('start-property',{kind:'hotel',capitalId:'RUH',expectedCost:q.cost+1}),/quote-changed/);
 assert.equal(F.operating(state,'hospitality'),cash);
 const built=command('start-property',{kind:'hotel',capitalId:'RUH',expectedCost:q.cost}),r=H.read(state).properties[0];
 assert.equal(r.status,'construction');assert.equal(F.operating(state,'hospitality'),cash-q.cost);
 const a=H.accelerationQuote(state,'hospitality',r.id);command('accelerate-construction',{propertyId:r.id,expectedFee:a.fee,expectedCompleteDay:a.completeDay});
 assert.equal(r.status,'operating');assert.equal(r.completeDay,0);assert(state.customHubs.find(f=>f.id===built.propertyId).dailyCost>0);
 const paid=F.operating(state,'hospitality');command('accelerate-construction',{propertyId:r.id,expectedFee:a.fee,expectedCompleteDay:a.completeDay});assert.equal(F.operating(state,'hospitality'),paid);
});
check('earned revenue and VAT are daily; cash and invoices settle on January 15 only',()=>{
 const {state,H,F,property,advance,tick}=hospitalityFixture();property();const initial=F.operating(state,'hospitality');
 advance(13);const root=H.read(state);assert(root.totals.net>0);assert(F.book(state,'hospitality').vat.output>0);
 assert.equal(F.operating(state,'hospitality'),initial);assert.equal(Object.values(root.accounting.buckets).filter(b=>b.invoiceNumber).length,0);
 const beforeTax=F.book(state,'hospitality').vat.output;tick(14);
 const earned=H.read(state).totals.net,vat=F.book(state,'hospitality').vat.output;
 assert(vat>=beforeTax);assert.equal(Math.round((F.operating(state,'hospitality')-initial)*100),earned+Math.round(vat*100));
 assert(Object.values(H.read(state).accounting.buckets).every(b=>b.collected));
 const after=F.operating(state,'hospitality');tick(14);assert.equal(F.operating(state,'hospitality'),after);
 assert.equal(state.finance.invoices.filter(d=>d.sourceRef?.startsWith('HOSP-INVOICE')).length,1);
});
check('future group reservation occupies all nights; stale price and overbooking are rejected',()=>{
 const {state,H,command,property}=hospitalityFixture(),p=property(),terms={propertyId:p.id,startDay:20,endDay:23,rooms:4,roomClass:0},q=H.bookingQuote(state,'hospitality',terms);
 const b=command('reserve-group',{...terms,customerName:'شركة اختبار الحجز',expectedGross:q.gross},'HOSP-BOOK-ONCE');
 const repeated=command('reserve-group',{...terms,customerName:'شركة اختبار الحجز',expectedGross:q.gross},'HOSP-BOOK-ONCE');assert.equal(b.id,repeated.id);
 assert.equal(H.read(state).bookings.length,1);for(let day=20;day<23;day++)assert.equal(H.free(p,day,0),66);
 assert.throws(()=>H.bookingQuote(state,'hospitality',{...terms,rooms:70}),/capacity/);
 command('set-price',{propertyId:p.id,level:1.15});assert.throws(()=>command('reserve-group',{...terms,customerName:'شركة أخرى',expectedGross:q.gross}),/quote-changed/);
 assert.equal(H.read(state).bookings[0].nightNet,b.nightNet,'confirmed price is fixed');
});
check('deposit stays a liability and cancellation refunds it once in a batch',()=>{
 const {state,H,F,command,property,advance}=hospitalityFixture(),p=property(),terms={propertyId:p.id,startDay:20,endDay:23,rooms:4,roomClass:0},q=H.bookingQuote(state,'hospitality',terms);
 const b=command('reserve-group',{...terms,customerName:'مجموعة إجازة',expectedGross:q.gross});advance(14);
 const actual=H.read(state).bookings.find(r=>r.id===b.id);assert.equal(actual.depositCollected,q.depositQuote);
 const before=F.operating(state,'hospitality'),vat=F.book(state,'hospitality').vat.output;
 const c=command('cancel-booking',{bookingId:b.id});assert.equal(c.refundable,q.depositQuote/100);command('settle-due');
 assert.equal(F.operating(state,'hospitality'),before-q.depositQuote/100);assert.equal(F.book(state,'hospitality').vat.output,vat);
 const cash=F.operating(state,'hospitality');command('settle-due');command('cancel-booking',{bookingId:b.id});assert.equal(F.operating(state,'hospitality'),cash);
 for(let day=20;day<23;day++)assert.equal(H.free(H.read(state).properties[0],day,0),70);
});
check('monthly VAT remains calendar based and February 15 invoices do not duplicate it',()=>{
 const {state,H,F,property,advance,s}=hospitalityFixture();property();advance(30);
 const januaryOutput=F.book(state,'hospitality').vat.output;F.execute({state},'close-vat-period',{day:30});
 assert(state.finance.periods.some(r=>r.company==='hospitality'&&r.periodKey==='2026-01'));
 advance(45);assert(F.book(state,'hospitality').vat.output>=januaryOutput);
 assert.equal(Object.values(H.read(state).accounting.closedCycles).length,2);
 const validation=s.GH_SAVE_SCHEMA.validate(state);assert.equal(validation.ok,true,validation.errors.join(','));
});
check('a failed settlement restores business and financial registers',()=>{
 const {state,H,F,property,advance,tick}=hospitalityFixture();property();advance(13);
 const before=JSON.stringify({hospitality:state.hospitality,books:state.companyFinance,invoices:state.finance.invoices,journal:state.finance.journalEntries}),original=F.execute;
 F.execute=function(ctx,cmd,p,meta){const result=original.call(this,ctx,cmd,p,meta);if(cmd==='hospitality-accounting'&&p.action==='issue-cycle-invoice')throw Error('qa-hospitality-invoice-failure');return result;};
 try{assert.throws(()=>tick(14),/qa-hospitality-invoice-failure/);}finally{F.execute=original;}
 assert.equal(JSON.stringify({hospitality:state.hospitality,books:state.companyFinance,invoices:state.finance.invoices,journal:state.finance.journalEntries}),before);
 assert.equal(H.read(state).lastProcessedDay,13);tick(14);assert.equal(H.read(state).lastProcessedDay,14);
});
console.log(JSON.stringify({suite:'build391-hospitality-core',passed:results.length,results}));
