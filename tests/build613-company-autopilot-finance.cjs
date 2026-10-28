'use strict';
// Owner («خلاص كل شي يتحول بدقه تلقائي حتا صرف الشيكات وتحصيل الذمم والضرائب»): the company autopilot's finance steps
// (company-autopilot-core.js next()), on the real finance, banking and lifecycle owners, a car dealership outside investor
// mode (its cash is real), each step dispatched as app.js does (system actor 'company-autopilot'):
//  1. an open receivable without payment terms (an issued invoice) is collected by its incoming cheque once due, and not
//     before; one on automatic terms is left to the daily close;
//  2. the company's due VAT is paid in full; a company whose cash does not cover its VAT is not tried that day;
//  3. a due payable without terms is paid by transfer; one larger than the current account is left open (tried once);
//  4. an issued cheque the funds cover is cashed; one they do not is left issued (never bounced by the autopilot);
//  5. a returned cheque is presented again only once the funds cover it, and is then cashed;
//  6. each step's commands are the owners' own (the same documents and balances as dispatching them by hand), every row is
//     taken at most once a day, and nothing is left to plan afterwards.
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||require('path').resolve(__dirname,'..');
const assert=require('node:assert/strict');
const {harness,minimal}=require('./helpers/core-harness');
const MODULES=['capability-registry-core','company-definitions','company-platform-core','identity-system','control-plane-core','authorization-core','document-proof-core','transaction-core','domain-command-core','save-schema','determinism-core','event-ledger-core','dependency-core','policy-core','lifecycle-core','delivery-monitor-core','realism-core','finance-core','hr-core','corporate-core','facility-core','business-world-core','banking-core','insurance-core','energy-core','game-lifecycle-core','company-autopilot-core'];
function world(){
  const {s}=harness(MODULES);
  const data={...minimal(),profile:{name:'Autopilot Finance'},bank:{},operations:{},crew:[],branches:[],hired:[],unlockedSectors:[],ownedCompanies:[]};
  const state=s.GH_GAME_LIFECYCLE.pristine(data,1);
  s.GH_GAME_LIFECYCLE.foundGroup(state,{mode:'sandbox',name:'Autopilot Group',founder:'Founder',locationId:'RUH'},data,{nextId:()=> 'FOUND-AP',simYear:()=>2026});
  s.GH_DOMAIN_COMMANDS.dispatch({state},'corporate','open-company',{type:'dealership',capital:100000000,legalName:'AP Dealer'});
  const sys=(domain,name,payload,actor='financial-close')=>{const r=s.GH_DOMAIN_COMMANDS.dispatchSystem({state},domain,name,payload,{actor});if(!r.ok)throw new Error(r.error);return r.result;};
  return {s,state,sys,F:s.GH_FINANCE_CORE,P:s.GH_COMPANY_AUTOPILOT};
}
// Run one planned step as app.js runs it (each command through the system dispatch, actor 'company-autopilot').
const run=(w,step)=>step.commands.map(c=>w.sys(c.domain,c.name,c.payload,w.P.ACTOR));
const atDay=(w,day)=>{w.state.simSeconds=day*86400;};
// Objects made in the owners' realm are compared through JSON (their prototypes differ from this realm's).
const same=(actual,expected,message)=>assert.equal(JSON.stringify(actual),JSON.stringify(expected),message);
const cash=(w,c='dealership')=>Math.round(w.F.operating(w.state,c)*100);
assert.equal(world().P.KINDS.join(','),'insurance,realestate,telecom,bank,hospitality,receivables,taxes,payables,cheques,returned','the day\'s order: decisions, money in, money out');

// 1. Receivables.
{const w=world();
  const manual=w.sys('finance','issue-invoice',{company:'dealership',kind:'دخل',amount:40000,note:'AP manual invoice',counterparty:'AP Customer',dueDay:3,taxable:false});
  w.sys('finance','credit',{company:'dealership',amount:50000,note:'AP sale on terms',taxable:false,termsDays:5});
  const rows=w.state.finance.receivables.map(r=>({n:r.number,auto:r.autoSettle===true,due:r.dueDay}));
  assert.ok(rows.some(r=>r.n===manual.number&&!r.auto)&&rows.some(r=>r.auto),`1: one manual receivable and one on terms (${JSON.stringify(rows)})`);
  atDay(w,2);assert.equal(w.P.next(w.state,'receivables',{F:w.F}),null,'1: not before its due day');
  atDay(w,3);const step=w.P.next(w.state,'receivables',{F:w.F});
  same(step.commands,[{domain:'finance',name:'collect-receivables-by-cheque',payload:{company:'dealership',numbers:[manual.number]}}],'1: only the manual receivable, through the bulk collection command');
  const before=cash(w),result=run(w,step)[0];
  assert.equal(result.count,1);assert.equal(cash(w)-before,4000000,'1: its amount reaches the current account');
  assert.ok(!w.state.finance.receivables.some(r=>r.number===manual.number),'1: and it is collected');assert.ok(w.state.finance.receivables.some(r=>r.autoSettle===true),'1: the one on terms is left to the close');
  assert.equal(w.P.next(w.state,'receivables',{F:w.F}),null,'1: nothing left');}

// 2. Taxes.
{const w=world();
  w.sys('finance','credit',{company:'dealership',amount:1150000,note:'AP taxable sale',taxable:true});
  w.sys('finance','close-vat-period',{day:0});
  const due=w.state.finance.periods.filter(r=>r.status==='مستحق'&&(r.company||'group')==='dealership'),amount=due.reduce((n,r)=>n+Number(r.amount||0),0);
  assert.ok(due.length&&amount>0,`2: a due VAT period (${JSON.stringify(due.map(r=>[r.id,r.amount]))})`);
  const step=w.P.next(w.state,'taxes',{F:w.F});
  same(step.commands,[{domain:'finance',name:'pay-taxes',payload:{company:'dealership'}}],'2: the company\'s own pay-taxes command');
  const before=cash(w),paid=run(w,step)[0];
  assert.equal(Math.round(paid.amount*100),Math.round(amount*100),'2: the whole due amount');assert.equal(before-cash(w),Math.round(amount*100),'2: debited once');
  assert.equal(w.state.finance.periods.filter(r=>r.status==='مستحق'&&(r.company||'group')==='dealership').length,0,'2: no period left due');
  assert.equal(w.P.next(w.state,'taxes',{F:w.F}),null);
  // A company whose cash does not cover its VAT is left due and not tried again that day.
  const v=world();v.sys('finance','credit',{company:'dealership',amount:1150000,note:'AP taxable sale',taxable:true});v.sys('finance','close-vat-period',{day:0});
  const vat=v.state.finance.periods.filter(r=>r.status==='مستحق'&&r.company==='dealership').reduce((n,r)=>n+Number(r.amount||0),0);
  v.sys('finance','transfer',{from:'dealership',to:'group',amount:v.F.operating(v.state,'dealership')-vat/2,note:'AP sweep'});
  const tried=new Set();assert.equal(v.P.next(v.state,'taxes',{F:v.F,tried}),null,'2: not covered: no step');assert.ok(tried.has('taxes:dealership'),'2: and not tried again today');}

// 3. Payables.
{const w=world();
  const small=w.sys('finance','accrue-expense',{company:'dealership',amount:20000,note:'AP supplier bill',dueDay:0});
  const large=w.sys('finance','accrue-expense',{company:'dealership',amount:w.F.operating(w.state,'dealership')+1,note:'AP large bill',dueDay:0});
  const tried=new Set(),step=w.P.next(w.state,'payables',{F:w.F,tried});
  same(step.commands,[{domain:'finance',name:'settle-payable',payload:{number:small.number,method:'transfer'}}],'3: the covered payable only, by transfer');
  assert.ok(tried.has(`payables:${large.number}`),'3: the uncovered one is tried once and left');
  const before=cash(w);run(w,step);assert.equal(before-cash(w),2000000,'3: paid once');
  assert.ok(!w.state.finance.payables.some(r=>r.number===small.number),'3: settled');assert.ok(w.state.finance.payables.some(r=>r.number===large.number),'3: the large one stays open');
  assert.equal(w.P.next(w.state,'payables',{F:w.F,tried}),null,'3: nothing else today');}

// 4 and 5. Cheques.
{const w=world();
  const covered=w.sys('finance','issue-cheque',{company:'dealership',amount:30000,beneficiary:'AP Supplier',note:'AP cheque',dueDay:10});
  const uncovered=w.sys('finance','issue-cheque',{company:'dealership',amount:w.F.operating(w.state,'dealership')*2,beneficiary:'AP Supplier',note:'AP large cheque',dueDay:10});
  const tried=new Set(),step=w.P.next(w.state,'cheques',{F:w.F,tried});
  same(step.commands,[{domain:'finance',name:'settle-cheque',payload:{id:covered.id}}],'4: the covered cheque only');
  const before=cash(w);const [cashed]=run(w,step);assert.equal(cashed.settled,true);assert.equal(before-cash(w),3000000,'4: cashed once');
  assert.equal(w.state.finance.cheques.find(c=>c.id===uncovered.id).status,'صادر','4: the uncovered cheque is left issued, never bounced');
  assert.equal(w.P.next(w.state,'cheques',{F:w.F,tried}),null);
  // 5. The close bounces the uncovered cheque on its due day; it is presented again once funds return.
  w.sys('finance','settle-cheque',{id:uncovered.id},'finance-scheduler');
  assert.equal(w.state.finance.cheques.find(c=>c.id===uncovered.id).status,'مرتجع','5: (returned by the close)');
  const day1=new Set();assert.equal(w.P.next(w.state,'returned',{F:w.F,tried:day1}),null,'5: not presented while uncovered');assert.ok(day1.has(`returned:${uncovered.id}`));
  w.sys('finance','founder-investment',{company:'dealership',amount:w.F.operating(w.state,'dealership')*3+1000000,note:'AP funds'},'financial-close');
  const day2=new Set(),again=w.P.next(w.state,'returned',{F:w.F,tried:day2});
  same(again.commands,[{domain:'finance',name:'settle-cheque',payload:{id:uncovered.id}}],'5: presented again the next day, once covered');
  const [re]=run(w,again);assert.equal(re.settled,true);assert.equal(w.state.finance.cheques.find(c=>c.id===uncovered.id).status,'مصروف','5: and cashed');}

// 6. The same documents and balances as dispatching the commands by hand (two identical worlds).
{const make=()=>{const w=world();w.sys('finance','accrue-expense',{company:'dealership',amount:25000,note:'AP same bill',dueDay:0});w.sys('finance','issue-cheque',{company:'dealership',amount:15000,beneficiary:'AP Supplier',note:'AP same cheque',dueDay:9});return w;};
  const a=make(),b=make();
  for(const kind of ['payables','cheques']){const step=a.P.next(a.state,kind,{F:a.F});run(a,step);for(const c of step.commands)b.sys(c.domain,c.name,c.payload,'company-autopilot');}
  const view=w=>JSON.stringify({finance:w.state.finance,books:w.state.companyFinance,treasury:w.state.treasury});
  assert.equal(view(a),view(b),'6: identical to the same commands dispatched by hand');}

console.log(JSON.stringify({suite:'build613-company-autopilot-finance',ok:true}));
