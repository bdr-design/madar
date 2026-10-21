'use strict';
// Money goes back to the investor card only when the player returns it (owner: «اهم شي ماينقص من رصيد الشركة شيء وخله
// يدوي انا ارجعه اذا بغيت»). Proven on the real finance owner, document proof and identity owners:
//  1. the plan the page reads changes nothing in the save, not even on a save whose card was never used;
//  2. a return is an outgoing transfer to the card: signed, a journal against the founder's equity, the company's
//     current account down by exactly the amount, the card's total and its statement row;
//  3. a return over what the company owes the card, or over its current account, is refused and changes nothing;
//  4. the same request twice returns once; the same reference for another amount is refused;
//  5. a return works with investor mode off;
//  6. «return all» keeps 30 days of each company's expenses (from the stored closes), returns no more than each owes
//     and holds, and leaves a company with nothing to give untouched;
//  7. a return is capital: the period's revenue and expenses do not move;
//  8. the god-mode transfers of earlier builds can be returned like the card's own;
//  9. nothing in the game returns money by itself: only the two return commands write a return.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {harness}=require('./helpers/core-harness');
const {s:G}=harness(['capability-registry-core','company-definitions','company-platform-core','identity-system','control-plane-core','document-proof-core','finance-core']),F=G.GH_FINANCE_CORE;
const types=['air','telecom','insurance'],plain=v=>JSON.parse(JSON.stringify(v)),run=(s,c,p)=>F.execute({state:s},c,p);
function world(){const m=G.GH_COMPANY_PLATFORM.migrateState({simSeconds:86400*10,openedCompanies:types,profile:{name:'فنتورا القابضة',founder:'سالم'},hired:[],assets:[],globalBases:[],customHubs:[],branches:[],bank:{branches:1},energy:{},mobility:{vehicles:[]},companyRegistry:{}});if(m.errors.length)throw Error(m.errors.join());const s=m.state;F.ensure(s);for(const t of types)F.book(s,t).accounts[0].balance=2000000;F.reconcile(s);return s;}
const returns=s=>s.finance.transfers.filter(x=>x.kind==='founder-withdrawal'&&x.fundingSource==='investor-card');
// A world the card funded: air 30m, telecom 30m.
function funded(){const s=world();s.godMoney=true;s.infiniteMoney=true;run(s,'spend',{company:'air',amount:5000000,note:'خدمات',line:'other'});run(s,'spend',{company:'telecom',amount:5000000,note:'شبكة',line:'other'});return s;}
// 1
{const s=world();s.finance.transfers.unshift({id:'GOD-1-1',reference:'GOD-1-1',kind:'founder-investment',fundingSource:'god-mode-founder',company:'air',amount:40000000});const before=JSON.stringify(s),plan=F.investorCardReturnPlan(s);
 assert.equal(JSON.stringify(s),before,'1: reading the plan writes nothing');assert.equal(s.finance.investorCard,undefined);assert.equal(plan.owed,40000000);assert.equal(plan.rows[0].company,'air');assert.equal(plan.statement[0].kind,'legacy');
 const f=funded(),json=JSON.stringify(f);F.investorCardReturnPlan(f);assert.equal(JSON.stringify(f),json,'1: nor on a card in use');}
// 2
const s=funded();
{const cash=F.operating(s,'air'),entries=s.finance.journalEntries.length;const r=run(s,'investor-card-return',{company:'air',amount:12000000,ref:'INV-RET-QA-1'});const [t]=returns(s);
 assert.equal(r.amount,12000000);assert.equal(r.owed,18000000);assert.equal(F.operating(s,'air'),cash-12000000,'2: the current account goes down by the amount');
 assert.equal(t.label,'إرجاع إلى بطاقة المستثمر');assert.equal(t.to,'بطاقة المستثمر · سالم');assert.equal(t.purposeCategory,'إرجاع إلى بطاقة المستثمر');assert(t.documentProofId&&t.contentDigest,'2: signed');
 const entry=s.finance.journalEntries.find(x=>x.sourceRef==='INV-RET-QA-1');assert.deepEqual(plain(entry.lines.map(l=>[l.account,l.debit,l.credit])),[['حقوق ملكية المؤسس',12000000,0],[F.book(s,'air').accounts[0].id,0,12000000]]);assert.equal(s.finance.journalEntries.length-entries,1);
 assert.equal(s.finance.investorCard.returned.air,12000000);assert.deepEqual(plain(s.finance.investorCard.rows[0]),{kind:'return',day:10,company:'air',amount:12000000,count:1,purposes:['إرجاع رأس مال']});
 const plan=F.investorCardReturnPlan(s).rows.find(row=>row.company==='air');assert.equal(plan.owed,18000000);}
// 3
{const json=JSON.stringify(s);assert.throws(()=>run(s,'investor-card-return',{company:'air',amount:18000001,ref:'INV-RET-QA-2'}),/over-owed/);assert.throws(()=>run(s,'investor-card-return',{company:'insurance',amount:1,ref:'INV-RET-QA-3'}),/over-owed/,'3: a company the card never funded owes nothing');
 F.book(s,'telecom').accounts[0].balance=1000000;F.reconcile(s);const json2=JSON.stringify(s);assert.throws(()=>run(s,'investor-card-return',{company:'telecom',amount:2000000,ref:'INV-RET-QA-4'}),/insufficient-cash/);assert.equal(JSON.stringify(s),json2,'3: a refused return changes nothing');
 assert.throws(()=>run(s,'investor-card-return',{company:'air',amount:0,ref:'INV-RET-QA-5'}),/invalid-amount/);void json;}
// 4
{const n=returns(s).length,cash=F.operating(s,'air');const again=run(s,'investor-card-return',{company:'air',amount:12000000,ref:'INV-RET-QA-1'});assert.equal(again.idempotent,true);assert.equal(returns(s).length,n,'4: once');assert.equal(F.operating(s,'air'),cash);
 assert.throws(()=>run(s,'investor-card-return',{company:'air',amount:1000000,ref:'INV-RET-QA-1'}),/reference-conflict/);}
// 5
{s.godMoney=false;s.infiniteMoney=false;const r=run(s,'investor-card-return',{company:'air',amount:3000000,ref:'INV-RET-QA-6'});assert.equal(r.amount,3000000,'5: with the mode off');assert.equal(s.finance.investorCard.returned.air,15000000);}
// 6
{const w=funded();for(let day=0;day<40;day++)run(w,'record-daily-close',{day,net:0,companies:{air:{grossRevenue:1000000,expenses:300000,net:700000},telecom:{grossRevenue:0,expenses:0,net:0},insurance:{grossRevenue:0,expenses:0,net:0}}});
 F.book(w,'telecom').accounts[0].balance=0;F.reconcile(w);const plan=F.investorCardReturnPlan(w),air=plan.rows.find(r=>r.company==='air'),tel=plan.rows.find(r=>r.company==='telecom');
 assert.equal(air.keep,9000000,'6: 30 days of 300 thousand a day');assert.equal(air.availableAll,Math.min(air.owed,air.cash-9000000));assert.equal(tel.availableAll,0);
 const cashTel=F.operating(w,'telecom'),r=run(w,'investor-card-return-all',{ref:'INV-RET-ALL-1'});assert.equal(r.companies,1);assert.equal(r.amount,air.availableAll);assert.equal(F.operating(w,'air'),air.cash-air.availableAll);assert(F.operating(w,'air')>=9000000-.01,'6: the 30 days stay');assert.equal(F.operating(w,'telecom'),cashTel,'6: telecom is untouched');
 const again=run(w,'investor-card-return-all',{ref:'INV-RET-ALL-1'});assert.equal(again.amount,0,'6: the same request twice returns once');}
// 7
{const w=funded();F.takeOffClosePnl(w);run(w,'investor-card-return',{company:'air',amount:10000000,ref:'INV-RET-QA-7'});assert.deepEqual(plain(F.takeOffClosePnl(w)),plain(F.takeOffClosePnl(world())),'7: no revenue or expense');}
// 8
{const w=world();w.finance.transfers.unshift({id:'GOD-1-1',reference:'GOD-1-1',kind:'founder-investment',fundingSource:'god-mode-founder',company:'air',amount:40000000});F.book(w,'air').accounts[0].balance=50000000;F.reconcile(w);
 const r=run(w,'investor-card-return',{company:'air',amount:40000000,ref:'INV-RET-QA-8'});assert.equal(r.owed,0,'8: the earlier transfer is returned');assert.equal(w.finance.investorCard.charged.air,40000000);assert.throws(()=>run(w,'investor-card-return',{company:'air',amount:1,ref:'INV-RET-QA-9'}),/over-owed/);}
// 9
const web=path.join(process.env.GH_TEST_SOURCE_DIR,'WebApp'),writers=[];
for(const file of fs.readdirSync(web).filter(f=>f.endsWith('.js'))){const text=fs.readFileSync(path.join(web,file),'utf8');if(/noteInvestorCard\([^)]*'return'/.test(text))writers.push(file);for(const m of text.matchAll(/'investor-card-return(?:-all)?'/g))writers.push(`${file}:${text.slice(Math.max(0,m.index-40),m.index).replace(/\s+/g,' ')}`);}
const source=fs.readFileSync(path.join(web,'finance-core.js'),'utf8');assert.equal((source.match(/noteInvestorCard\(s,t,'return'/g)||[]).length,1,'9: one writer of a return');assert(/function returnToInvestorCard[\s\S]*?noteInvestorCard\(s,t,'return'/.test(source));
assert.equal(writers.filter(w=>!/^finance-core\.js|^business-world-core\.js|^app\.js|^advanced-core\.js/.test(w)).length,0,`9: only the finance owner, the news and the page name the return (${writers})`);
assert.equal(/'investor-card-return/.test(fs.readFileSync(path.join(web,'simulation-core.js'),'utf8')+fs.readFileSync(path.join(web,'game-lifecycle-core.js'),'utf8')),false,'9: no tick returns money');
console.log(JSON.stringify({suite:'build555-investor-card-return',ok:true,returns:returns(s).length}));
