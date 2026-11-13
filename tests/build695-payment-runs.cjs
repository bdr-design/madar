'use strict';
// Build 695, plan decision 2 (the owner: «لاتخلي شي من الخطه نفذه بدقه»): the autopilot paid every payable with its own
// command (about 1,500 a day in a large world, each with a command record and proof). It now sends one payment run per
// company per step (finance settle-payables-run), as banks run them. On the real finance and lifecycle owners:
//   1. a run leaves the books exactly as the same payables paid one by one with settle-payable: balances, invoices,
//      payables, transfers and journal entries are the same (the run calls the same settlement for each);
//   2. all or none: a run with a payable the cash does not cover is refused whole inside its transaction (nothing paid);
//   3. a run refuses an empty list, an unknown payable and a payable of another company; a number listed twice is paid once;
//   4. the autopilot's payables step sends one run per company (two companies: two commands), in the order it took them;
//   5. lighter: three payables paid in one run make fewer command records than three commands.
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||require('path').resolve(__dirname,'..');
const assert=require('node:assert/strict');
const {harness,minimal}=require('./helpers/core-harness');
const MODULES=require('fs').readFileSync(require('path').join(__dirname,'build613-company-autopilot-finance.cjs'),'utf8').match(/const MODULES=(\[[^\]]*\])/)[1];
function world(){
  const {s}=harness(JSON.parse(MODULES.replace(/'/g,'"')));
  const data={...minimal(),profile:{name:'Runs'},bank:{},operations:{},crew:[],branches:[],hired:[],unlockedSectors:[],ownedCompanies:[]};
  const state=s.GH_GAME_LIFECYCLE.pristine(data,1);
  s.GH_GAME_LIFECYCLE.foundGroup(state,{mode:'sandbox',name:'Runs Group',founder:'Founder',locationId:'RUH'},data,{nextId:()=> 'FOUND-RN',simYear:()=>2026});
  s.GH_DOMAIN_COMMANDS.dispatch({state},'corporate','open-company',{type:'dealership',capital:100000000,legalName:'RN Dealer'});
  const sys=(domain,name,payload,actor='company-autopilot')=>{const r=s.GH_DOMAIN_COMMANDS.dispatchSystem({state},domain,name,payload,{actor});if(!r.ok)throw new Error(r.error);return r.result;};
  return {s,state,sys,F:s.GH_FINANCE_CORE,P:s.GH_COMPANY_AUTOPILOT,T:s.GH_TRANSACTION_CORE};
}
const bills=(w,amounts,company='dealership')=>amounts.map((amount,i)=>w.sys('finance','accrue-expense',{company,amount,note:`RN bill ${company} ${i}`,dueDay:0},'financial-close').number);
// What a payment leaves in the books (ids and sequence numbers aside, which the runs share).
const books=w=>{const F=w.state.finance,strip=row=>{const {id,at,createdAt,ts,...rest}=row||{};return rest;};return JSON.stringify({cash:['group','dealership'].map(c=>Math.round(w.F.operating(w.state,c)*100)),payables:(F.payables||[]).map(r=>[r.number,r.status,r.total??r.amount]),invoices:(F.invoices||[]).map(r=>[r.number,r.status,r.paidAmount??null]),transfers:(F.transfers||[]).length,journal:(F.journalEntries||[]).length});};
const records=w=>JSON.stringify(w.state).length,events=w=>(w.state.businessWorld?.events||[]).length;

// 1 and 5.
{const one=world(),run=world();const a=bills(one,[1000,2500,4000]),b=bills(run,[1000,2500,4000]);assert.deepEqual(a,b,'1: the same payables in both');
  const before=[records(one),records(run)],eventsBefore=[events(one),events(run)];
  for(const number of a)one.sys('finance','settle-payable',{number,method:'transfer'});
  const out=run.sys('finance','settle-payables-run',{company:'dealership',numbers:b,method:'transfer'});
  assert.equal(out.count,3);assert.equal(Math.round(out.total*100),750000,'1: the run reports its count and total');assert.deepEqual(Array.from(out.numbers),b,'1: and its statement lists the payables');
  assert.equal(books(run),books(one),'1: the books are the same as three payments one by one');
  assert.equal(events(one)-eventsBefore[0],3,'5: three payments, three business documents');assert.equal(events(run)-eventsBefore[1],1,'5: one run, one document listing the three');
  assert.ok(records(run)-before[1]<records(one)-before[0],`5: and the state grows less (${records(run)-before[1]} against ${records(one)-before[0]} characters)`);}
console.log('1 ok, 5 ok: the same books, fewer records');

// 2.
{const w=world();const cash=w.F.operating(w.state,'dealership'),[small,large]=bills(w,[1000,cash+1]);const before=books(w);
  let refused=null;try{const out=w.T.execute(w.state,{label:'rn-run',apply:()=>w.sys('finance','settle-payables-run',{company:'dealership',numbers:[small,large],method:'transfer'})});if(out?.committed===false)refused=out.reason||'rejected';}catch(error){refused=String(error.message||error);}
  assert.equal(refused,'insufficient-cash','2: a run with an uncovered payable is refused');assert.equal(books(w),before,'2: nothing was paid, the small one included');}
console.log('2 ok: all or none');

// 3.
{const w=world();const [x]=bills(w,[1000]),[g]=bills(w,[500],'group');const refused=f=>{try{f();return null;}catch(error){return String(error.message||error);}};
  assert.equal(refused(()=>w.sys('finance','settle-payables-run',{company:'dealership',numbers:[]})),'payables-run-empty');
  assert.match(refused(()=>w.sys('finance','settle-payables-run',{company:'dealership',numbers:['NOPE-1']})),/payable-not-found:NOPE-1/);
  assert.match(refused(()=>w.sys('finance','settle-payables-run',{company:'dealership',numbers:[x,g]})),/payables-run-company-mismatch/);
  const out=w.sys('finance','settle-payables-run',{company:'dealership',numbers:[x,x],method:'transfer'});assert.equal(out.count,1,'3: a number listed twice is paid once');
  // Review round 4: a run is at most 200 payables (one command record and proof; the autopilot takes 24 a step).
  assert.match(refused(()=>w.sys('finance','settle-payables-run',{company:'dealership',numbers:Array.from({length:201},(_,i)=>`RN-${i}`)})),/payables-run-too-long/,'3: 201 numbers are refused');}
console.log('3 ok: refusals');

// 4.
{const w=world();const d=bills(w,[1000,2000]),g=bills(w,[700],'group');const step=w.P.next(w.state,'payables',{F:w.F,tried:new Set()});
  const order=[...new Set(w.state.finance.payables.filter(r=>[...d,...g].includes(r.number)).map(r=>r.company||'group'))];
  assert.equal(JSON.stringify(step.commands),JSON.stringify(order.map(company=>({domain:'finance',name:'settle-payables-run',payload:{company,numbers:w.state.finance.payables.filter(r=>[...d,...g].includes(r.number)&&(r.company||'group')===company).map(r=>r.number),method:'transfer'}}))),'4: one run per company, in the order the payables were taken');
  assert.equal(step.keys.length,3,'4: each payable is still a key (tried once a day)');
  for(const command of step.commands)w.sys(command.domain,command.name,command.payload);assert.equal((w.state.finance.payables||[]).filter(r=>[...d,...g].includes(r.number)).length,0,'4: all three paid');}
console.log('build695 ok');
