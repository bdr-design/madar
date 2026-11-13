'use strict';
// Build 691, from the automation batch (the owner: «نفذ بدقه مع اختبارات صارمة تمنع الثقل والمشاكل», then «شوف الاخف
// والامن والواقعي ونفذه»): the cash pool went one way only. The sweep sent a company's surplus to the holding, but a
// company short of what was due waited day after day (the autopilot leaves a bill its cash does not cover), the holding
// holding the money. The autopilot's new 'funding' step, after the money in and before the money out, sends a short
// company the gap from the holding: one transfer a company a day, by the finance owner's own transfer command.
// Checked here on the real finance, platform and lifecycle owners (a car dealership outside the investor mode):
//   1. a due payable larger than the company's cash: the holding sends exactly the gap, then the payables step pays it;
//      the group's total cash is unchanged by the transfer (it moves inside the group);
//   2. a saved minimum operating cash is topped up (the pool's other way), and nothing is sent once it is held;
//   3. the holding keeps its own due bills: it sends only what is above them, part of the gap when that is all it has,
//      nothing when it has no room;
//   4. the investor mode sends nothing (the card covers each payment); a company outside the cash pool (the bank) is
//      never funded;
//   5. due VAT and issued cheques due today count; a cheque due later, a payable not yet due, one on automatic terms and
//      one a cheque already pays do not; a payable is funded once, never again while the cash is there;
//   6. no duplicate: the funding runs once a day, the same step run again (a replay) moves no more money, and a replay
//      with another amount is refused whole by the transfer owner (each company's reference AUTO-FUND-<day>-<company>);
//   7. weight: one pass over the finance lists per step, the cash of each company read once, one command a step, the
//      company of each row resolved once, no per-row call into the finance owner (a step on 4,500 rows stays in a few ms).
//   8. several companies short: one step and one bulk command, the holding's room shared in order, a notice to the player;
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||require('path').resolve(__dirname,'..');
const assert=require('node:assert/strict');
const {harness,minimal}=require('./helpers/core-harness');
const MODULES=require('fs').readFileSync(require('path').join(__dirname,'build613-company-autopilot-finance.cjs'),'utf8').match(/const MODULES=(\[[^\]]*\])/)[1];
function world(){
  const {s}=harness(JSON.parse(MODULES.replace(/'/g,'"')));
  const data={...minimal(),profile:{name:'Funding'},bank:{},operations:{},crew:[],branches:[],hired:[],unlockedSectors:[],ownedCompanies:[]};
  const state=s.GH_GAME_LIFECYCLE.pristine(data,1);
  s.GH_GAME_LIFECYCLE.foundGroup(state,{mode:'sandbox',name:'Funding Group',founder:'Founder',locationId:'RUH'},data,{nextId:()=> 'FOUND-FD',simYear:()=>2026});
  s.GH_DOMAIN_COMMANDS.dispatch({state},'corporate','open-company',{type:'dealership',capital:100000000,legalName:'FD Dealer'});
  const sys=(domain,name,payload,actor='financial-close')=>{const r=s.GH_DOMAIN_COMMANDS.dispatchSystem({state},domain,name,payload,{actor});if(!r.ok)throw new Error(r.error);return r.result;};
  return {s,state,sys,F:s.GH_FINANCE_CORE,P:s.GH_COMPANY_AUTOPILOT};
}
const run=(w,step)=>step.commands.map(c=>w.sys(c.domain,c.name,c.payload,w.P.ACTOR));
const cents=value=>Math.round(Number(value)*100);
const cash=(w,c='dealership')=>cents(w.F.operating(w.state,c));
const groupTotal=w=>cash(w,'group')+cash(w,'dealership');
// Leaves the dealership `left` and moves the rest to the holding.
const leave=(w,left)=>{const extra=w.F.operating(w.state,'dealership')-left;if(extra>0)w.sys('finance','transfer',{from:'dealership',to:'group',amount:extra,note:'FD setup'});};
const funding=(w,tried=new Set(),F=w.F)=>w.P.next(w.state,'funding',{F,tried});
const day=w=>Math.floor(w.state.simSeconds/86400);
const sent=(step,company='dealership')=>step.rows.find(row=>row.company===company)?.amount;

// 1.
{const w=world();leave(w,10000);const bill=w.sys('finance','accrue-expense',{company:'dealership',amount:25000,note:'FD supplier bill',dueDay:0});
  const tried=new Set();assert.equal(w.P.next(w.state,'payables',{F:w.F,tried:new Set()}),null,'1: before: the bill is not covered');
  const step=funding(w,tried);assert.ok(step,'1: a funding step');
  assert.equal(JSON.stringify(step.commands),JSON.stringify([{domain:'finance',name:'bulk-transfer',payload:{batchId:`AUTO-FUND-${day(w)}`,rows:[{company:'dealership',amount:15000}],note:'تمويل آلي من القابضة لمستحقات اليوم والحد الأدنى للنقد'}}]),'1: exactly the gap, by the owner\'s bulk transfer command');
  const total=groupTotal(w),group=cash(w,'group');run(w,step);
  assert.equal(cash(w),2500000,'1: the company now holds the bill');assert.equal(group-cash(w,'group'),1500000,'1: the holding paid the gap');assert.equal(groupTotal(w),total,'1: the group\'s cash is unchanged');
  const pay=w.P.next(w.state,'payables',{F:w.F,tried:new Set()});assert.equal(JSON.stringify(pay.commands),JSON.stringify([{domain:'finance',name:'settle-payables-run',payload:{company:'dealership',numbers:[bill.number],method:'transfer'}}]),'1: then the bill is paid');
  run(w,pay);assert.equal(cash(w),0);assert.ok(!w.state.finance.payables.some(r=>r.number===bill.number),'1: settled');
  assert.equal(funding(w,tried),null,'1: nothing more today');
  const transfer=w.state.finance.transfers.filter(row=>String(row.reference||row.ref||'')===`AUTO-FUND-${day(w)}-dealership`);assert.equal(transfer.length,1,'1: one transfer in the ledger, the company\'s own reference');}
console.log('1 ok: a company short of a due bill is sent the gap, then the bill is paid');

// 2.
{const w=world();leave(w,1000);w.sys('finance','set-central-treasury-policy',{minOperatingCash:{dealership:6000}});
  const step=funding(w);assert.equal(sent(step),5000,'2: topped up to the saved minimum');run(w,step);assert.equal(cash(w),600000);
  const tried=new Set();assert.equal(funding(w,tried),null,'2: nothing once it holds the minimum');assert.ok(tried.has('funding'));
  // The sweep (the other way) leaves the same minimum: the two never chase each other.
  w.sys('finance','cash-pool-sweep',{});assert.equal(cash(w),600000,'2: the sweep keeps the minimum');assert.equal(funding(w),null,'2: and the funding sends nothing after it');}
console.log('2 ok: the saved minimum operating cash is topped up, both ways agree');

// 3.
{const w=world();leave(w,0);w.sys('finance','accrue-expense',{company:'dealership',amount:50000,note:'FD bill',dueDay:0});
  w.sys('finance','accrue-expense',{company:'group',amount:w.F.operating(w.state,'group')-20000,note:'FD holding bill',dueDay:0});
  const before=cash(w);let step=funding(w);assert.equal(sent(step),20000,'3: only what is above the holding\'s own due bill, part of the gap');run(w,step);assert.equal(cash(w)-before,2000000);
  assert.equal(funding(w),null,'3: no room left');
  const v=world();leave(v,0);v.sys('finance','accrue-expense',{company:'dealership',amount:50000,note:'FD bill',dueDay:0});v.sys('finance','accrue-expense',{company:'group',amount:v.F.operating(v.state,'group'),note:'FD holding bill',dueDay:0});
  assert.equal(funding(v),null,'3: the holding with no room sends nothing');
  const u=world();leave(u,0);u.sys('finance','accrue-expense',{company:'dealership',amount:50000,note:'FD bill',dueDay:0});u.sys('finance','accrue-expense',{company:'group',amount:u.F.operating(u.state,'group'),note:'FD holding bill later',dueDay:90});
  assert.equal(sent(funding(u)),50000,'3: a holding bill not yet due is not kept back');}
console.log('3 ok: the holding keeps its own due bills');

// 4.
{const w=world();leave(w,0);w.sys('finance','accrue-expense',{company:'dealership',amount:5000,note:'FD bill',dueDay:0});w.state.godMoney=true;w.state.infiniteMoney=true;
  assert.equal(w.F.investorMode(w.state),true);assert.equal(funding(w),null,'4: the investor mode sends nothing');
  const v=world();leave(v,0);v.sys('finance','accrue-expense',{company:'dealership',amount:5000,note:'FD bill',dueDay:0});
  const outside={...v.F,cashPoolEligible:(s,t)=>t==='dealership'?false:v.F.cashPoolEligible(s,t)},tried=new Set();
  assert.equal(funding(v,tried,outside),null,'4: a company outside the cash pool is not funded');
  assert.equal(v.F.cashPoolEligible(v.state,'bank'),false,'4: the bank is outside the pool');assert.equal(v.F.cashPoolEligible(v.state,'dealership'),true);}
console.log('4 ok: no funding in the investor mode or outside the cash pool');

// 5.
{const w=world();w.sys('finance','credit',{company:'dealership',amount:1150000,note:'FD taxable sale',taxable:true});w.sys('finance','close-vat-period',{day:0});
  const vat=w.state.finance.periods.filter(r=>r.status==='مستحق'&&r.company==='dealership').reduce((n,r)=>n+Number(r.amount||0),0);assert.ok(vat>0);
  leave(w,0);w.sys('finance','issue-cheque',{company:'dealership',amount:7000,beneficiary:'FD Supplier',note:'FD cheque today',dueDay:0});
  w.sys('finance','issue-cheque',{company:'dealership',amount:9000,beneficiary:'FD Supplier',note:'FD cheque later',dueDay:40});
  w.sys('finance','accrue-expense',{company:'dealership',amount:11000,note:'FD bill later',dueDay:40});
  w.sys('finance','credit',{company:'dealership',amount:0.01,note:'FD',taxable:false});leave(w,0);
  let step=funding(w);assert.equal(cents(sent(step)),cents(vat+7000),'5: due VAT and the cheque due today, not the later cheque or bill');
  // A payable a cheque already pays is not funded; one the month's ceiling holds is funded once (the money stays in the
  // group), and the next day sends nothing more.
  const v=world();leave(v,0);const held=v.sys('finance','accrue-expense',{company:'dealership',amount:5000,note:'FD bill',dueDay:0});
  v.state.finance.cheques.push({id:'FD-CH-PAYS',company:'dealership',amount:5000,status:'صادر',invoiceNumber:held.number,dueDay:30});
  assert.equal(funding(v),null,'5: a payable its cheque pays is not funded twice');v.state.finance.cheques.pop();
  const once=funding(v);assert.equal(sent(once),5000);run(v,once);v.state.simSeconds+=86400;assert.equal(funding(v,new Set()),null,'5: funded once; the cash is there the next day');
  // On automatic terms: left to the close.
  const u=world();leave(u,0);u.sys('finance','accrue-expense',{company:'dealership',amount:5000,note:'FD bill',dueDay:0});u.state.finance.payables.forEach(row=>{row.autoSettle=true;});
  assert.equal(funding(u),null,'5: a payable on automatic terms is left to the close');}
console.log('5 ok: only what is due today counts');

// 6.
{const w=world();leave(w,0);w.sys('finance','accrue-expense',{company:'dealership',amount:5000,note:'FD bill',dueDay:0});
  const tried=new Set(),step=funding(w,tried);for(const key of step.keys)tried.add(key);run(w,step);const after=cash(w),group=cash(w,'group');
  run(w,step);assert.equal(cash(w),after,'6: the same step replayed moves no more money');assert.equal(cash(w,'group'),group);
  assert.equal(w.state.finance.transfers.filter(row=>String(row.reference||row.ref||'')===`AUTO-FUND-${day(w)}-dealership`).length,1,'6: one transfer recorded');
  w.sys('finance','transfer',{from:'dealership',to:'group',amount:5000,note:'FD drain'});assert.equal(funding(w,tried),null,'6: the funding runs once a day');
  // The next day the reference is new.
  w.state.simSeconds+=86400;const next=funding(w,new Set());assert.equal(next.commands[0].payload.batchId,`AUTO-FUND-${day(w)}`);run(w,next);assert.equal(w.state.finance.transfers.filter(row=>String(row.reference||row.ref||'')===`AUTO-FUND-${day(w)}-dealership`).length,1,'6: the next day\'s reference is its own');
  // A replay with another amount under the same day's reference is refused whole (nothing moves; app.js rolls the step back).
  const replay=JSON.parse(JSON.stringify(next));replay.commands[0].payload.rows[0].amount+=1;const g=cash(w,'group');assert.throws(()=>run(w,replay),/transfer-reference-conflict/);assert.equal(cash(w,'group'),g,'6: the conflict moved nothing');}
console.log('6 ok: no duplicate transfer');

// 7.
{const w=world();leave(w,0);for(let i=0;i<300;i++)w.sys('finance','accrue-expense',{company:'dealership',amount:10,note:`FD bill ${i}`,dueDay:0});
  let reads=0;const counted={...w.F,operating:(s,t)=>{reads++;return w.F.operating(s,t);}};
  const step=funding(w,new Set(),counted);assert.equal(step.commands.length,1,'7: one command a step');assert.equal(cents(sent(step)),cents(3000));
  assert.ok(reads<=2,`7: the cash read for the holding and the company only (${reads})`);
  const source=require('fs').readFileSync(require('path').join(process.env.GH_TEST_SOURCE_DIR,'WebApp','company-autopilot-core.js'),'utf8'),body=source.slice(source.indexOf("if(kind==='funding'){"),source.indexOf("if(kind==='taxes'){"));
  assert.equal((body.match(/for\(const row of list\(s\?\.finance\?\.(periods|payables|cheques)\)\)/g)||[]).length,3,'7: one pass over each list');
  assert.ok(!/JSON\.|structuredClone|clone\(/.test(body),'7: no copy of the state');assert.ok(!/payableTransferBlocker|chequeFundingBlocker/.test(body),'7: no per-row reading by the finance owner');
  let resolves=0;const resolving={...w.F,requireCompany:(s,t)=>{resolves++;return w.F.requireCompany(s,t);}};funding(w,new Set(),resolving);assert.ok(resolves<=3,`7: each row's company resolved once per name (${resolves})`);
  // 4,500 rows: the step's cost is measured against the payables step's own (the same lists, already in the autopilot).
  for(let i=0;i<2000;i++)w.state.finance.cheques.push({id:`FD-W-${i}`,company:'dealership',amount:1,status:i%3?'محصل':'صادر',dueDay:i%5});for(let i=0;i<1700;i++)w.state.finance.payables.push({number:`FD-W-${i}`,company:'dealership',amount:1,total:1,dueDay:i%2?0:99});
  const time=run=>{const t=process.hrtime.bigint();run();return Number(process.hrtime.bigint()-t)/1e6;},best=run=>Math.min(...Array.from({length:7},()=>time(run)));
  const fund=best(()=>funding(w,new Set())),pay=best(()=>w.P.next(w.state,'payables',{F:w.F,tried:new Set()}));
  assert.ok(fund<=Math.max(5,pay*3),`7: the funding step costs no more than three payables steps (${fund.toFixed(2)} ms against ${pay.toFixed(2)} ms)`);}

// 8. Several companies: one step, one command, the holding's room shared in the companies' order; the day's step limit
//    is spent once, not once a company.
{const w=world();w.sys('corporate','open-company',{type:'media',capital:100000000,legalName:'FD Media'});
  for(const c of ['dealership','media']){const extra=w.F.operating(w.state,c);if(extra>0)w.sys('finance','transfer',{from:c,to:'group',amount:extra,note:'FD setup'});w.sys('finance','accrue-expense',{company:c,amount:40000,note:`FD bill ${c}`,dueDay:0});}
  w.sys('finance','accrue-expense',{company:'group',amount:w.F.operating(w.state,'group')-60000,note:'FD holding bill',dueDay:0});
  const tried=new Set(),step=funding(w,tried);assert.equal(step.commands.length,1,'8: one command for both');assert.equal(JSON.stringify(step.rows.map(row=>[row.company,row.amount])),JSON.stringify([['dealership',40000],['media',20000]]),'8: the room shared in order');
  assert.equal(funding(w,tried),null,'8: one step a day');run(w,step);assert.equal(cash(w,'dealership'),4000000);assert.equal(cash(w,'media'),2000000);
  const app=require('fs').readFileSync(require('path').join(process.env.GH_TEST_SOURCE_DIR,'WebApp','app.js'),'utf8');
  assert.match(app,/if\(step\.kind==='funding'\)return r\.count\?`تمويل آلي من القابضة لمستحقات اليوم: /,'8: the player is told what the holding sent');}
console.log('8 ok: one step a day for every company, the player told');
console.log('build691 ok');
