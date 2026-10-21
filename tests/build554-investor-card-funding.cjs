'use strict';
// Investor mode is funded by the founder's investor card, and the earlier founder transfers of the old mode are gone
// from the code (owner: «كل شي يخص وضع المستثمر يطلع من البطاقة … اي شي سابق ازله من الجذر بأمان»). Proven on the real
// finance owner, document proof and identity owners:
//  1. with the mode off a payment the company cannot cover is refused, and the card is never touched;
//  2. with it on, the shortfall arrives as one incoming transfer from the card (the old founder label and the play-mode
//     equity are gone): its signed document, its purpose, a balanced journal against the founder's equity, rounded up in
//     10 million steps with headroom, recorded on the card for that company;
//  3. a payment the company can cover touches nothing on the card (no transfer, no seal, no statement row);
//  4. the statement keeps one row per company a day, adds a second charge to it, and keeps the last 50 rows;
//  5. the reserve, the daily operating settlement and a debt repayment are funded by the card too;
//  6. the god-mode transfers of earlier builds are counted on the card once;
//  7. a charge is capital: the period's revenue and expenses are those of the payment alone;
//  8. every investor-mode check of the game reads one finance helper.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {harness}=require('./helpers/core-harness');
const {s:G}=harness(['capability-registry-core','company-definitions','company-platform-core','identity-system','control-plane-core','document-proof-core','finance-core']),F=G.GH_FINANCE_CORE;
const types=['air','telecom','insurance'];
function world(){const m=G.GH_COMPANY_PLATFORM.migrateState({simSeconds:86400*10,openedCompanies:types,profile:{name:'فنتورا القابضة',founder:'سالم'},hired:[],assets:[],globalBases:[],customHubs:[],branches:[],bank:{branches:1},energy:{},mobility:{vehicles:[]},companyRegistry:{}});if(m.errors.length)throw Error(m.errors.join());const s=m.state;F.ensure(s);for(const t of types){F.book(s,t).accounts[0].balance=2000000;F.book(s,t).accounts[1].balance=0;}F.reconcile(s);return s;}
const plain=v=>JSON.parse(JSON.stringify(v)),run=(s,c,p)=>F.execute({state:s},c,p),card=s=>s.finance.investorCard,cardTransfers=s=>s.finance.transfers.filter(x=>x.fundingSource==='investor-card');
let sealed=0;const proof=G.GH_DOCUMENT_PROOF;G.GH_DOCUMENT_PROOF={...proof,sealDocument(...args){sealed++;return proof.sealDocument(...args);}};
// 1
{const s=world();assert.throws(()=>run(s,'spend',{company:'air',amount:5000000,note:'خدمات أرضية',line:'other'}),/insufficient/);assert.equal(card(s),undefined,'1: the card is not created');assert.equal(cardTransfers(s).length,0);}
// 2
const s=world();s.godMoney=true;s.infiniteMoney=true;
{const before=s.finance.journalEntries.length;run(s,'spend',{company:'air',amount:5000000,note:'خدمات أرضية',line:'other'});
 const [t]=cardTransfers(s);assert(t,'2: one card transfer');assert.equal(cardTransfers(s).length,1);
 assert.equal(t.kind,'founder-investment');assert.equal(t.label,'حوالة واردة من بطاقة المستثمر');assert.equal(t.from,'بطاقة المستثمر · سالم');assert.match(t.id,/^INV-\d+-\d+$/);
 assert.equal(t.purposeCategory,'شحن من بطاقة المستثمر');assert.equal(t.purposeDetail,'مصروف');assert(t.documentProofId&&t.contentDigest,'2: the transfer is a signed document');
 assert.equal(t.amount,30000000,'2: a 3 million shortfall arrives as 30 million (10 million steps, at least 25 million headroom)');assert.equal(F.operating(s,'air'),2000000+30000000-5000000);
 const entry=s.finance.journalEntries.find(x=>x.sourceRef===t.id);assert(entry,'2: journal');assert.deepEqual(plain(entry.lines.map(l=>[l.account,l.debit,l.credit])),[[F.book(s,'air').accounts[0].id,30000000,0],['حقوق ملكية المؤسس',0,30000000]]);assert.equal(s.finance.journalEntries.length-before,2,'2: the charge and the payment');
 assert.equal(card(s).charged.air,30000000);assert.equal(card(s).rows.length,1);assert.deepEqual(plain(card(s).rows[0]),{kind:'charge',day:10,company:'air',amount:30000000,count:1,purposes:['مصروف']});
 const all=JSON.stringify(s);assert.doesNotMatch(all,/وضع التجربة|حقوق ملكية وضع اللعب|god-mode-founder/,'2: no trace of the old mode');}
// 3
{const delta=(w,fn)=>{const transfers=w.finance.transfers.length,journal=w.finance.journalEntries.length,seals=sealed;fn();return {transfers:w.finance.transfers.length-transfers,journal:w.finance.journalEntries.length-journal,seals:sealed-seals};};
 const off=world(),cardJson=JSON.stringify(card(s)),on=delta(s,()=>run(s,'spend',{company:'air',amount:1000000,note:'قرطاسية',line:'other'})),plainMode=delta(off,()=>run(off,'spend',{company:'air',amount:1000000,note:'قرطاسية',line:'other'}));
 assert.deepEqual(on,plainMode,'3: a covered payment in investor mode writes exactly what it writes with the mode off');assert.equal(JSON.stringify(card(s)),cardJson,'3: the card is untouched');assert.equal(cardTransfers(s).length,1);}
// 4
{run(s,'spend',{company:'air',amount:F.operating(s,'air')+1000000,note:'رواتب',line:'payroll'});assert.equal(card(s).rows.length,1,'4: the same company and day share a row');assert.equal(card(s).rows[0].count,2);assert.equal(card(s).rows[0].amount,card(s).charged.air);
 run(s,'spend',{company:'telecom',amount:3000000,note:'شبكة',line:'other'});assert.equal(card(s).rows.length,2,'4: another company has its own row');assert.equal(card(s).rows[0].company,'telecom');
 for(let day=11;day<=70;day++){s.simSeconds=day*86400;run(s,'spend',{company:'insurance',amount:F.operating(s,'insurance')+1,note:'مطالبات',line:'other'});}
 assert.equal(card(s).rows.length,50,'4: the statement keeps the last 50 rows');assert.equal(card(s).rows[0].day,70);assert.equal(card(s).rows[49].day,21);
 assert.equal(card(s).charged.insurance,cardTransfers(s).filter(x=>x.company==='insurance').reduce((n,x)=>n+x.amount,0),'4: the totals do not depend on the statement rows');}
// 5
{const t0=cardTransfers(s).length;run(s,'transfer-reserve',{company:'telecom',amount:7000000,toReserve:false});const reserve=cardTransfers(s).slice(0,cardTransfers(s).length-t0)[0];
 assert(reserve&&reserve.toAccount===F.book(s,'telecom').accounts[1].id,'5: the reserve is funded by the card');assert.equal(reserve.purposeDetail,'تحويل من الاحتياطي');
 const t1=cardTransfers(s).length,pending=Number(s.finance.pendingDailyCash.telecom)||0,cash=F.operating(s,'telecom');const settled=run(s,'settle-daily-cash',{company:'telecom',amount:-(cash+4000000),day:70});
 assert.equal(settled.shortfall,0,'5: the daily settlement is paid in full');assert.equal(Number(s.finance.pendingDailyCash.telecom)||0,pending,'5: nothing is carried');assert.equal(cardTransfers(s).length,t1+1);
 run(s,'raise-debt',{company:'air',amount:600000,lender:'بنك التمويل التجاري',note:'تمويل معدات'});F.book(s,'air').accounts[0].balance=100000;F.reconcile(s);const t2=cardTransfers(s).length;
 run(s,'repay-debt',{company:'air',amount:600000,note:'سداد'});assert.equal(cardTransfers(s).length,t2+1,'5: the debt repayment is funded by the card');assert.equal(F.book(s,'air').debt,0);
 assert.doesNotMatch(JSON.stringify(s.finance.journalEntries),/حقوق ملكية وضع اللعب/);}
// 6
{const old=world();old.finance.transfers.unshift({id:'GOD-1-1',reference:'GOD-1-1',kind:'founder-investment',fundingSource:'god-mode-founder',company:'air',amount:50000000},{id:'GOD-1-2',reference:'GOD-1-2',kind:'founder-investment',fundingSource:'god-mode-founder',company:'telecom',amount:20000000});
 old.godMoney=true;old.infiniteMoney=true;run(old,'spend',{company:'air',amount:3000000,note:'خدمات',line:'other'});
 assert.equal(card(old).charged.air,50000000+30000000,'6: the earlier air transfer is on the card');assert.equal(card(old).charged.telecom,20000000);assert.deepEqual(plain(card(old).rows.at(-1)),{kind:'legacy',day:null,company:'',amount:70000000,count:2,purposes:[]});
 run(old,'spend',{company:'air',amount:F.operating(old,'air')+1,note:'خدمات',line:'other'});assert.equal(card(old).charged.air,50000000+60000000,'6: counted once');}
// 7
{const a=world(),b=world();a.godMoney=true;a.infiniteMoney=true;F.book(b,'air').accounts[0].balance=50000000;F.reconcile(b);F.takeOffClosePnl(a);F.takeOffClosePnl(b);
 run(a,'spend',{company:'air',amount:6000000,note:'خدمات أرضية',line:'other'});run(b,'spend',{company:'air',amount:6000000,note:'خدمات أرضية',line:'other'});
 assert.deepEqual(plain(F.takeOffClosePnl(a)),plain(F.takeOffClosePnl(b)),'7: the charge adds no revenue or expense');assert.equal(cardTransfers(a).length,1);}
// 8
const web=path.join(process.env.GH_TEST_SOURCE_DIR,'WebApp'),reads=[];
for(const file of fs.readdirSync(web).filter(f=>f.endsWith('.js'))){const text=fs.readFileSync(path.join(web,file),'utf8');for(const m of text.matchAll(/\.(godMoney|infiniteMoney)\b(?!\s*[=:](?!=))/g))reads.push(`${file}:${text.slice(0,m.index).split('\n').length}`);}
assert.deepEqual(reads,['finance-core.js:306','finance-core.js:306'],`8: only the finance helper reads the mode (${reads})`);
assert.equal(fs.readdirSync(web).filter(f=>f.endsWith('.js')).some(f=>/coverInfiniteFunds|god-mode-toggle|toggleGodMode|حقوق ملكية وضع اللعب|'GOD'/.test(fs.readFileSync(path.join(web,f),'utf8'))),false,'8: the old mode is gone from the code');
console.log(JSON.stringify({suite:'build554-investor-card-funding',ok:true,cardTransfers:cardTransfers(s).length,rows:card(s).rows.length}));
