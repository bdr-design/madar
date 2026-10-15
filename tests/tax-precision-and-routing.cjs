'use strict';
const assert=require('node:assert/strict');
const {scenario}=require('./helpers/business-scenario');
function setup(){const e=scenario();e.command('finance','credit',{company:'group',amount:1000000000,taxable:false,reference:'QA-FIXTURE-CAPITAL'});for(const [i,company] of ['bank','realestate','telecom','dealership'].entries())e.command('corporate','open-company',{type:company,capital:200000000,legalName:'QA '+company,taxId:String(300000000000003+i)});return {...e,F:e.s.GH_FINANCE_CORE};}

// VAT uses cents, without changing the amount paid or the journal balance.
{
 const {state,F,s}=setup(),opening=F.operating(state,'telecom');
 const invoice=F.execute({state},'credit',{company:'telecom',amount:11.5,taxable:true,reference:'QA-CENTS'});
 assert.equal(invoice.tax,1.5);assert.equal(invoice.subtotal,10);assert.equal(invoice.total,11.5);assert.equal(F.operating(state,'telecom'),opening+11.5);
 const journal=state.finance.journalEntries.find(r=>r.sourceRef==='QA-CENTS'&&r.description.startsWith(invoice.number));assert.equal(journal.lines.reduce((n,r)=>n+(r.debit||0)-(r.credit||0),0),0);assert.ok(journal.lines.some(r=>r.account==='ضريبة مخرجات VAT'&&r.credit===1.5));assert.equal(s.GH_DOCUMENT_PROOF.verifyDocument(state,invoice).ok,true);
 for(let i=0;i<99;i++)F.execute({state},'credit',{company:'telecom',amount:.23,taxable:true,reference:'QA-CENTS-'+i});
 assert.equal(F.book(state,'telecom').vat.output,4.47);
 const row=F.execute({state},'close-vat-period',{day:30}).find(r=>r.company==='telecom');assert.equal(row.amount,4.47);
 const before=F.operating(state,'telecom'),payment=F.execute({state},'pay-taxes',{company:'telecom'});assert.equal(payment.amount,4.47);assert.ok(Math.abs(F.operating(state,'telecom')-before+4.47)<.01);
 assert.equal(F.execute({state},'pay-taxes',{company:'telecom'}).amount,0);
}

// Registered IDs, including historical simulation IDs, have one source. Issued documents keep their snapshot.
{
 const {state,F}=setup();state.profile.taxId='300000000000001';
 for(const c of ['group','air','bank','realestate','telecom','dealership']){
  const registry=c==='group'?state.profile:state.companyRegistry[c];if(c==='air')registry.taxId='VH-AIR-LEGACY';
  const invoice=F.execute({state},'credit',{company:c,amount:1150,reference:'QA-ID-'+c});assert.equal(invoice.taxNumber,F.companyTaxNumber(state,c));
  const stored=invoice.taxNumber;registry.taxId='300000000000099';assert.equal(invoice.taxNumber,stored,'never rewrite an issued document after registration changes');
 }
 delete state.profile.taxId;delete state.profile.taxNumber;assert.equal(F.companyTaxNumber(state,'group'),'غير مسجل');
}

// Branch-country routing preserves the approved simulation rate and honours explicit owner classifications.
{
 const {state,F}=setup();
 const invoice=F.execute({state},'credit',{company:'telecom',amount:1150,taxCountry:'الهند',reference:'QA-INDIA'});
 assert.equal(invoice.taxJurisdiction,'IN');assert.equal(invoice.taxCountry,'الهند');assert.equal(invoice.taxRate,.15);assert.equal(invoice.tax,150);assert.equal(invoice.taxPolicySource,'simulation-vat-15-v1');
 assert.equal(F.invoiceTaxProfile(state,'telecom',{businessLocationCountry:'ألمانيا'}).jurisdiction,'DE');
 assert.equal(F.invoiceTaxProfile(state,'telecom',{businessLocationCountry:'الإمارات'}).jurisdiction,'AE');
 const interest=F.execute({state},'credit',{company:'bank',amount:1150,taxCode:'financial-interest',reference:'QA-INTEREST'});assert.equal(interest.tax,0);
 const home=F.execute({state},'credit',{company:'realestate',amount:1150,taxCode:'residential-rent',taxCountry:'السعودية',reference:'QA-HOME'});assert.equal(home.tax,0);
 const office=F.execute({state},'credit',{company:'realestate',amount:1150,taxCode:'commercial-rent',taxCountry:'السعودية',reference:'QA-OFFICE'});assert.equal(office.tax,150);
}

// One bank invoice represents both interest and fees, with no extra collection or tax on the exempt line.
{
 const {state,F,s}=setup(),before=F.operating(state,'bank'),vatBefore=F.book(state,'bank').vat.output;
 const invoice=F.execute({state},'credit',{company:'bank',amount:1100,reference:'QA-BANK-MIXED',taxComponents:[{description:'interest',amount:985,taxCode:'financial-interest'},{description:'fees',amount:115,taxCode:'standard'}]});
 assert.equal(invoice.tax,15);assert.equal(invoice.taxCode,'mixed');assert.equal(invoice.lines.length,2);assert.equal(invoice.lines[0].taxRate,0);assert.equal(invoice.lines[1].taxRate,.15);assert.equal(F.book(state,'bank').vat.output-vatBefore,15);assert.equal(F.operating(state,'bank')-before,1100);assert.equal(s.GH_DOCUMENT_PROOF.verifyDocument(state,invoice).ok,true);
 assert.throws(()=>F.execute({state},'credit',{company:'bank',amount:1100,reference:'QA-MISMATCH',taxComponents:[{amount:1,taxCode:'standard'}]}),/invoice-tax-components-unbalanced/);
 const explicit=F.execute({state},'credit',{company:'bank',amount:120,taxRate:.2,reference:'QA-EXPLICIT-RATE',taxComponents:[{amount:120,taxCode:'standard'}]});assert.equal(explicit.tax,20);
}
console.log('TAX_PRECISION_ROUTING_PASS');
