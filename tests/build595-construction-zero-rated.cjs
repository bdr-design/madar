'use strict';
// Owner (build 98: «الشركات لاتسجل ضرائب»; chosen: zero-rate construction): every facility's construction carried 15% input
// VAT (a solar plant 14.3M, a stadium 11.4M, a hospital 7.6M), a credit larger than months of sales VAT, so after a month
// of play every company's VAT return was zero. A facility's construction is now zero-rated, as the fleet's purchases are
// (build 358). On the real company platform, finance, procurement and facility owners:
//  1. a construction award pays the contractor the same amount by a cleared cheque, with no input VAT (the invoice's tax
//     is 0 and the company's VAT book is unchanged); so does a facility's expansion;
//  2. a save made before (construction taxed, some of it before the company's last VAT close, some after) has that input
//     VAT reversed once on load: payments after the close from the open period, earlier ones from the credit carried,
//     never more than either holds; one reclassification entry per company; cash and documents unchanged; the save is
//     marked, and a second load changes nothing;
//  3. nothing else is reversed: a telecom network expansion, a real-estate project's construction and an ordinary
//     supplier invoice keep their input VAT;
//  4. a new game has nothing to reverse and is left untouched (its save and reload stay exact).
const assert=require('node:assert/strict');
const {harness,minimal}=require('./helpers/core-harness');
const MODULES=['capability-registry-core','company-definitions','company-platform-core','identity-system','control-plane-core','authorization-core','determinism-core','integrity-core','document-proof-core','transaction-core','domain-command-core','finance-core','facility-core','procurement-core'];
const {s}=harness(MODULES),F=s.GH_FINANCE_CORE,P=s.GH_PROCUREMENT_CORE,D=s.GH_COMPANY_DEFINITIONS;
const HELD=['sports','telecom','realestate'];
function world(){
  const registry=Object.fromEntries(HELD.map(id=>{const d=D.get(id);return [id,{id,definitionId:d.definitionId,definitionVersion:d.definitionVersion,status:'active'}];}));
  const state={...minimal(),saveVersion:'3.0.0',simSeconds:40*86400,profile:{name:'QA Construction VAT'},openedCompanies:[...HELD],companyRegistry:registry,customHubs:[],globalBases:[]};
  F.ensure(state);for(const id of HELD)F.book(state,id).accounts[0].balance=900e6;F.reconcile(state);return state;
}
const supplier={id:'SUP-QA',name:'Gulf Infrastructure Contractor',legalName:'Gulf Infrastructure Contractor',taxId:'300000000000003'};
// 1.
{
  const state=world(),cash=F.operating(state,'sports'),input=Number(F.book(state,'sports').vat?.input||0);
  const award=P.execute({state},'award-construction',{ownerCompanyId:'sports',facilityKind:'stadium',siteName:'نادٍ وملعب · الرياض',bid:{supplier,quote:90000000,score:90},bids:[]});
  const invoice=state.finance.invoices.find(i=>i.note==='دفعة إنشاء وتسليم · نادٍ وملعب · الرياض'),cheque=state.finance.cheques.find(c=>c.id===award.paymentRef);
  assert.equal(Number(invoice.tax)||0,0,'1: the construction invoice carries no VAT');assert.equal(Number(invoice.total??invoice.amount),90000000,'1: the contractor is paid the same amount');
  assert.equal(cheque?.status,'مصروف','1: by a cleared cheque');assert.equal(Math.round(cash-F.operating(state,'sports')),90000000,'1: the same cash leaves');
  assert.equal(Number(F.book(state,'sports').vat?.input||0),input,'1: the VAT book is unchanged');
  state.customHubs.push({id:'FAC-QA-STADIUM',name:'ملعب الرياض',kind:'stadium',ownerCompanyId:'sports',company:'sports',owned:true,cost:90000000,dailyCost:25000,capacityAmount:1,city:'الرياض',country:'السعودية'});
  const expanded=s.GH_FACILITY_CORE.expandable?.(state.customHubs[0]);
  if(expanded!==false){try{s.GH_FACILITY_CORE.execute({state},'expand',{id:'FAC-QA-STADIUM',company:'sports'});const row=state.finance.invoices.find(i=>String(i.note||'').startsWith('توسعة '));if(row)assert.equal(Number(row.tax)||0,0,'1: a facility expansion carries no VAT');}catch(error){if(!/expansion-not-applicable/.test(String(error.message)))throw error;}}
}
// 2-3. A save from before: taxed invoices written as the previous source wrote them, the VAT book and one closed period.
function oldSave(){
  const state=world(),day=86400,at=d=>d*day,taxed=(company,note,amount,dayAt,extra={})=>{const tax=Math.round(amount*15/115*100)/100;state.finance.invoices.unshift({number:`INV-OLD-${state.finance.invoices.length+1}`,kind:'مصروف',company,amount,total:amount,subtotal:amount-tax,tax,note,at:at(dayAt),status:'مسددة',...extra});F.book(state,company).vat.input+=tax;return tax;};
  for(const id of HELD)F.book(state,id).vat=F.book(state,id).vat||{output:0,input:0,creditCarry:0,periodOutputStart:0,periodInputStart:0};
  const closedTax=taxed('sports','دفعة إنشاء وتسليم · نادٍ وملعب · الرياض',90000000,5);
  const telecomNet=taxed('telecom','توسعة الشبكة · فرع الرياض · المستوى 2',2000000,6),realestate=taxed('realestate','إنشاء برج سكني · الأساسات',3000000,7),ordinary=taxed('sports','مصروف يومي نادي فنتورا · فاتورة مورد آجلة',115000,8);
  // The January close: sports had no sales, so its whole input VAT became the credit carried.
  const sb=F.book(state,'sports').vat;sb.creditCarry=sb.input;sb.periodInputStart=sb.input;sb.periodOutputStart=sb.output;state.finance.periods.unshift({id:'TAX-sports-2026-01',company:'sports',amount:0,status:'صفر',closedAt:at(31)});
  const openTax=taxed('sports','دفعة إنشاء وتسليم · نادٍ وملعب · دبي',57500000,35),hotel=taxed('sports','إنشاء وتجهيز فندق مدينة · دبي 2',11500000,36);
  delete state.finance.constructionVat;
  return {state,closedTax,openTax:openTax+hotel,telecomNet,realestate,ordinary};
}
{
  const save=oldSave(),{state}=save,sb=F.book(state,'sports').vat,before={input:sb.input,credit:sb.creditCarry,cash:F.operating(state,'sports'),invoices:JSON.stringify(state.finance.invoices),telecom:F.book(state,'telecom').vat.input,realestate:F.book(state,'realestate').vat.input,journal:state.finance.journalEntries.length};
  const adjusted=F.zeroRateConstructionVat(state);
  const r=v=>Math.round(v*100)/100;
  assert.equal(r(adjusted.sports.open),r(save.openTax),'2: the open period gives back the construction VAT paid after the close');
  assert.equal(r(adjusted.sports.closed),r(save.closedTax),'2: the credit carried gives back the construction VAT paid before it');
  assert.equal(r(sb.input),r(before.input-save.openTax),'2: the open period keeps only the ordinary input VAT');assert.equal(r(sb.creditCarry),r(before.credit-save.closedTax),'2: the credit keeps only what was not construction');
  assert.equal(F.operating(state,'sports'),before.cash,'2: no cash moves');assert.equal(JSON.stringify(state.finance.invoices),before.invoices,'2: no document changes');
  const entries=state.finance.journalEntries.slice(0,state.finance.journalEntries.length-before.journal);
  assert.equal(JSON.stringify(entries.map(e=>[e.company,e.sourceRef,r(e.lines[0].debit),r(e.lines[1].credit)])),JSON.stringify([['sports','VAT-CONSTRUCTION-ZERO-sports',r(save.openTax+save.closedTax),r(save.openTax+save.closedTax)]]),'2: one reclassification entry for the company');
  assert.equal(state.finance.constructionVat,'zero-rated','2: the save is marked');
  const marked=JSON.stringify(state);assert.equal(F.zeroRateConstructionVat(state),null,'2: a second load changes nothing');assert.equal(JSON.stringify(state),marked);
  // 3.
  assert.equal(F.book(state,'telecom').vat.input,before.telecom,'3: a telecom network expansion keeps its input VAT');assert.equal(F.book(state,'realestate').vat.input,before.realestate,'3: a real-estate project keeps its input VAT');
  assert.ok(r(sb.input)>=r(save.ordinary-0.01),'3: an ordinary supplier invoice keeps its input VAT');
  // The save check accepts the corrected save.
  assert.equal(s.GH_SAVE_SCHEMA?.validate?s.GH_SAVE_SCHEMA.validate(state).ok!==false:true,true);
}
// 4.
{const state=world(),before=JSON.stringify(state);assert.equal(F.zeroRateConstructionVat(state),null,'4: a new game has nothing to reverse');assert.equal(JSON.stringify(state),before,'4: and is left untouched');}
console.log(JSON.stringify({suite:'build595-construction-zero-rated',ok:true}));
