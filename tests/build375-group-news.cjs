'use strict';
const assert=require('node:assert/strict'),{scenario}=require('./helpers/business-scenario');
const e=scenario(),{s,state}=e;e.load('business-world-core');const W=s.GH_BUSINESS_WORLD,TX=s.GH_TRANSACTION_CORE;
W.ensure(state);const read=()=>W.newsView(state),latest=()=>read()[0];
e.command('corporate','open-company',{type:'power',capital:200000000,legalName:'طاقة المجموعة',formationContract:'INC-NEWS-POWER',commercialRegistration:'CR-NEWS-POWER'});
assert.equal(latest().kind,'company');assert.equal(latest().company,'power');assert.equal(latest().destination,'formationContract');assert.match(latest().title,/طاقة المجموعة/);
const opened=state.businessWorld.sequence;e.command('corporate','open-company',{type:'power',capital:200000000,legalName:'طاقة المجموعة'});assert.equal(state.businessWorld.sequence,opened,'no news for an already-open company');
const countBefore=read().length,before=JSON.stringify(state.businessWorld);
assert.throws(()=>e.command('corporate','open-company',{type:'not-a-company',capital:1}),/definition|company/);assert.equal(JSON.stringify(state.businessWorld),before);
assert.throws(()=>TX.execute(state,{label:'news-rollback',scope:['companyRegistry','profile','companyFinance','finance'],apply(){
  e.command('corporate','rename-company',{type:'power',legalName:'اسم لا يعتمد'});
  assert.equal(read()[0].title.includes('اسم لا يعتمد'),true);
  TX.afterCommit(()=>{throw new Error('reject-news-transaction');},{critical:true});
}}),/reject-news-transaction/);
assert.equal(JSON.stringify(state.businessWorld),before,'news is captured before its first write and rolls back with the command');assert.equal(read().length,countBefore);
const cash=s.GH_FINANCE_CORE.operating(state,'power');e.command('corporate','rename-company',{type:'power',legalName:'الطاقة الجديدة'});assert.equal(latest().company,'power');assert.equal(s.GH_FINANCE_CORE.operating(state,'power'),cash);
const inv=e.command('finance','accrue-expense',{company:'power',amount:1000,note:'News invoice',counterparty:'News supplier',taxable:false,paymentTerms:1});
const ch=e.command('finance','issue-cheque',{company:'power',amount:1000,beneficiary:inv.counterparty,invoiceNumber:inv.number});
assert.match(latest().title,/إصدار شيك/);assert.equal(latest().documentRef,ch.id);assert.equal(latest().commandName,'issue-cheque');
assert.equal(latest().sourceView,'cheques');
e.command('finance','settle-cheque',{id:ch.id});assert.match(latest().title,/صرف شيك/);assert.equal(latest().amount,1000);
const afterPaid=state.businessWorld.sequence;e.command('finance','settle-cheque',{id:ch.id});assert.equal(state.businessWorld.sequence,afterPaid,'a replayed settled cheque is not another payment story');
const secondInvoice=e.command('finance','accrue-expense',{company:'power',amount:1000,note:'Payable cheque news',counterparty:'News supplier',taxable:false});
e.command('finance','settle-payable',{number:secondInvoice.number,method:'cheque'});assert.equal(latest().sourceView,'cheques');assert.match(latest().title,/إصدار شيك/);
const order=e.manualPurchase(3);assert.ok(order);assert.equal(latest().kind,'procurement');assert.equal(latest().count,3);assert.match(latest().detail,/التسليم بحسب حالة الأمر/);
e.load('governance-core');s.GH_GOVERNANCE_CORE.ensure(state);state.research.efficiency=0;e.command('governance','research-fund',{project:'efficiency'});assert.equal(latest().destination,'research');assert.equal(latest().company,'group');assert.equal(latest().sourceDomain,'governance');
const researchSequence=state.businessWorld.sequence;
assert.throws(()=>e.command('governance','research-fund',{project:'efficiency'}),/research-phase-active/);assert.equal(state.businessWorld.sequence,researchSequence);
const reports=e.command('finance','close-vat-period',{day:30});assert.ok(reports.length);assert.match(latest().title,/إقفال الفترة الضريبية/);assert.equal(latest().company,'group');
const periodSequence=state.businessWorld.sequence;e.command('finance','close-vat-period',{day:30});assert.equal(state.businessWorld.sequence,periodSequence);
// Same business reference can belong to different companies; real duplicates within one company are omitted.
e.command('corporate','open-company',{type:'telecom',capital:200000000,legalName:'اتصالات المجموعة'});
for(const company of ['power','telecom'])W.recordEvent(state,{kind:'payment',company,title:'حوالة موثقة',reference:'PAY-SHARED',official:true,sourceDomain:'finance',sourceRef:'S',documentRef:'D'});
assert.equal(read().filter(row=>row.reference==='PAY-SHARED').length,2);
const sequence=state.businessWorld.sequence;W.recordEvent(state,{kind:'payment',company:'power',title:'مكرر',reference:'PAY-SHARED',official:true,sourceDomain:'finance',sourceRef:'S',documentRef:'D'});assert.equal(state.businessWorld.sequence,sequence);
// Batch publication stores one bounded summary, not one item per cheque/customer/asset.
const context={draft:state,name:'news-bulk'};s.__GH_DURABLE_COMMAND_CONTEXT__=context;
for(let i=0;i<1000;i++)W.recordCommandNews(state,'finance','settle-payable',{number:`DOC-${i}`},{company:'power',amount:2,method:'transfer',reference:`PAY-${i}`},{id:`DOM-QA-${i}`},{company:'power'});
s.__GH_DURABLE_COMMAND_CONTEXT__=null;
const batch=read().find(row=>row.reference==='GROUP-DOM-QA-0');assert.equal(batch.count,1000);assert.equal(batch.amount,2000);assert.equal(read().filter(row=>row.reference.startsWith('GROUP-DOM-QA-')).length,1);
// Presentation is read-only and never touches the fleet or writes/normalizes customer state.
const originalFleet=s.GH_FLEET_DATA;s.GH_FLEET_DATA=new Proxy(originalFleet,{get(){throw new Error('news-touched-fleet');}});
const saved=JSON.stringify(state),metrics=W.newsMetrics();for(let i=0;i<10000;i++)assert.ok(W.newsView(state).length);assert.equal(W.newsMetrics().visited,metrics.visited);assert.equal(JSON.stringify(state),saved);const warmVisits=W.newsMetrics().visited-metrics.visited;s.GH_FLEET_DATA=originalFleet;
const restored=JSON.parse(saved);assert.deepEqual(Array.from(W.newsView(restored),row=>row.reference),Array.from(read(),row=>row.reference));
const legacy=JSON.parse(saved);delete legacy.businessWorld;legacy.simSeconds=86400*90;const legacyBefore=JSON.stringify(legacy),legacyRows=W.newsView(legacy);
assert.ok(legacyRows.some(row=>row.company==='group'&&row.scope==='registry'));
assert.ok(legacyRows.some(row=>row.company==='power'&&row.scope==='registry'));assert.ok(legacyRows.every(row=>row.at<legacy.simSeconds));
assert.equal(legacyRows.some(row=>row.company==='telecom'),false,'without an original legal document reference no historical story is invented');
assert.equal(JSON.stringify(legacy),legacyBefore,'old incorporation facts are read from their original records without inventing a current event or migration write');
// News noise cannot replace the official feed or force it to refresh when nothing official changed.
const revision=W.newsRevision(state);for(let i=0;i<300;i++)W.recordEvent(state,{kind:'competitor',company:'group',title:'Market noise',reference:`RIVAL-QA-${i}`});
assert.equal(W.newsRevision(state),revision);assert.ok(read().some(row=>row.reference==='GROUP-DOM-QA-0'));assert.ok(state.businessWorld.events.length<=240);
for(let i=0;i<300;i++)W.recordEvent(state,{kind:'bid',company:'group',title:'Not a completed news event',reference:`BID-QA-${i}`,official:true,sourceDomain:'contracts',sourceRef:'PENDING',documentRef:'PENDING'});
assert.equal(W.newsRevision(state),revision,'an official flag alone cannot displace real group news');
const quietSequence=state.businessWorld.sequence;e.command('governance','tick-research',{day:0});assert.equal(state.businessWorld.sequence,quietSequence,'a research tick without a completion is not news');e.command('governance','tick-research',{day:30});assert.match(latest().title,/اكتمال مرحلة بحثية/);assert.equal(W.supportsCommandNews('market','tick-prices'),false);assert.equal(W.supportsCommandNews('__proto__','constructor'),false);
assert.equal(s.GH_INTEGRITY_CORE.check(state).counts.critical,0);
console.log(JSON.stringify({ok:true,official:read().length,bulk:1000,bulkStories:1,warmReads:10000,additionalWarmVisits:warmVisits,metrics:W.newsMetrics()}));
