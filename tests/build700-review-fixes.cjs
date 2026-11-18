'use strict';
// Build 700, the review of the automation batch (the owner: «صلح وعيد المراجعة»): what three readers found, each proven
// on the real owners (lifted functions only where the code lives inside app.js):
//   1. a cheque due today is cashed before the policies spend: research no longer takes the cash a due cheque needs (it
//      bounced at the close); a policy keeps back the cheques due today even when they were not cashed;
//   2. every autopilot step runs under the roots app.js gives it with the write audit enforced (a write outside them
//      fails): the standing campaigns of the telecom company and the dealership and a hotel company, the hotels' repairs,
//      pay that follows the market, research and renewals (all three), the bank's review, the funding, a payment run;
//   3. the policy commands are refused without the autopilot (a career below level 7 without Plus), each by behaviour;
//   4. the bank's housekeeping manages the liquidity only while the autopilot is unlocked;
//   5. a hotel's team hired at opening that fails after writing is undone whole: proven in build689 (case 5b);
//   6. the funding amounts are whole halalas and never sum above the holding's room;
//   7. the bank's automatic review: run directly up to 2,048 assets; above, with the cached summary when exact, else once
//      the worker's answer is exact, and deferred (nothing written) when the state changed, a command is in flight, the
//      day moved or no exact answer came;
//   8. the automatic dispatch: a stale or not-ready worker answer keeps the mark and counts no failure; an unavailable
//      worker counts, and the third clears the mark; a company with nothing to send is cleared at once.
// Review round 7 (the owner: «حل المشاكل وعيد تمريرها للتحقق»): the standing campaign waits for its campaign's level (step,
// command, card); a returned cheque presented again uncovered is refused with nothing written, and the button's notices
// say bounced or stays returned, once; the treasury line under a saved «إيقاف» says paused; the automatic dispatch counts
// only its own transient answers, probes again after a refusal, clears a closed company's mark, and keeps the failure
// count until a clear is written.
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||require('path').resolve(__dirname,'..');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{scenario}=require('./helpers/business-scenario'),{hospitalityFixture}=require('./helpers/hospitality-fixture.cjs'),{runStep}=require('./helpers/autopilot-scope.cjs');
const ROOT=process.env.GH_TEST_SOURCE_DIR,DAY=86400;
const sysOf=(s,state)=>(d,n,p)=>{const r=s.GH_DOMAIN_COMMANDS.dispatchSystem({state},d,n,p,{actor:s.GH_COMPANY_AUTOPILOT.ACTOR});if(!r.ok)throw new Error(`${d}:${n}:${r.error}`);return r.result;};
function researchWorld(){
  const e=scenario();for(const n of ['governance-core','company-autopilot-core'])e.load(n);const {s,state}=e;s.GH_GOVERNANCE_CORE.ensure(state);
  state.simSeconds=200*DAY;state.research=state.research&&Object.keys(state.research).length?state.research:{efficiency:0,automation:0,cleanEnergy:0};const ids=Object.keys(state.research);
  state.advanced.researchPrograms={[ids[0]]:{spent:1,rounds:1,history:[],status:'بحث',phase:null}};state.research[ids[0]]=25;state.godMoney=false;state.infiniteMoney=false;
  e.command('governance','set-continuation-policy',{enabled:true});return {e,s,state,ids,F:s.GH_FINANCE_CORE,P:s.GH_COMPANY_AUTOPILOT,sys:sysOf(s,state),cost:s.GH_GOVERNANCE_CORE.researchPhaseCost(state),day:200};
}

// 1.
{const w=researchWorld(),{F,P,state,sys,cost,day}=w;F.book(state,'group').accounts[0].balance=cost+500000;F.reconcile(state);
  const cheque=sys('finance','issue-cheque',{company:'group',amount:1000000,beneficiary:'مورد',note:'QA due cheque',dueDay:day,requestRef:'QA-RV-CHQ-1'});
  assert.ok(P.KINDS.indexOf('cheques')<P.KINDS.indexOf('continuation')&&P.KINDS.indexOf('returned')<P.KINDS.indexOf('campaigns'),'1: the cheques come before the policies');
  // Planned alone, the policy keeps the due cheque's amount back: 25.5 M less 1 M does not cover the 25 M phase.
  assert.equal(P.next(state,'continuation',{F,tried:new Set()}),null,'1: the due cheque is kept back from the policy');
  const tried=new Set(),ran=[];for(const kind of P.KINDS){for(let i=0;i<10;i++){const step=P.next(state,kind,{tried,F});if(!step)break;for(const k of step.keys)tried.add(k);step.commands.forEach(c=>sys(c.domain,c.name,c.payload));ran.push(kind);}}
  assert.deepEqual(ran,['cheques'],'1: the day cashes the cheque and funds no phase');assert.equal(state.finance.cheques.find(r=>r.id===cheque.id).status,'مصروف','1: the cheque is cashed');
  // With the cash for both, the cheque is cashed and the phase funded.
  const v=researchWorld();v.F.book(v.state,'group').accounts[0].balance=v.cost+2000000;v.F.reconcile(v.state);v.sys('finance','issue-cheque',{company:'group',amount:1000000,beneficiary:'مورد',note:'QA due cheque',dueDay:v.day,requestRef:'QA-RV-CHQ-2'});
  const t2=new Set(),ran2=[];for(const kind of v.P.KINDS){for(let i=0;i<10;i++){const step=v.P.next(v.state,kind,{tried:t2,F:v.F});if(!step)break;for(const k of step.keys)t2.add(k);step.commands.forEach(c=>v.sys(c.domain,c.name,c.payload));ran2.push(kind);}}
  assert.deepEqual(ran2,['cheques','continuation'],'1: enough for both: the cheque, then the phase');}
// Review round 4: (a) the holding's funding for a due cheque is not taken by a payable first (the cheque bounced);
// (b) a policy keeps back a due bill, due VAT and the saved floor; (c) it stays within the month's budget line.
{const {harness,minimal}=require('./helpers/core-harness');const MODULES=fs.readFileSync(path.join(__dirname,'build613-company-autopilot-finance.cjs'),'utf8').match(/const MODULES=(\[[^\]]*\])/)[1];
  const {s}=harness(JSON.parse(MODULES.replace(/'/g,'"')));const data={...minimal(),profile:{name:'Order'},bank:{},operations:{},crew:[],branches:[],hired:[],unlockedSectors:[],ownedCompanies:[]};
  const state=s.GH_GAME_LIFECYCLE.pristine(data,1);s.GH_GAME_LIFECYCLE.foundGroup(state,{mode:'sandbox',name:'Order Group',founder:'Founder',locationId:'RUH'},data,{nextId:()=> 'FOUND-OR',simYear:()=>2026});
  s.GH_DOMAIN_COMMANDS.dispatch({state},'corporate','open-company',{type:'dealership',capital:100000000,legalName:'OR Dealer'});
  const sys=(d,n,p,actor='financial-close')=>{const r=s.GH_DOMAIN_COMMANDS.dispatchSystem({state},d,n,p,{actor});if(!r.ok)throw new Error(r.error);return r.result;},F=s.GH_FINANCE_CORE,P=s.GH_COMPANY_AUTOPILOT;state.godMoney=false;state.infiniteMoney=false;
  sys('finance','transfer',{from:'dealership',to:'group',amount:F.operating(state,'dealership'),note:'setup'});const day=Math.floor(state.simSeconds/DAY);
  const bill=sys('finance','accrue-expense',{company:'dealership',amount:50000,note:'bill',dueDay:day}),chq=sys('finance','issue-cheque',{company:'dealership',amount:50000,beneficiary:'مورد',note:'due cheque',dueDay:day,requestRef:'QA-RV4-CHQ'});
  sys('finance','accrue-expense',{company:'group',amount:F.operating(state,'group')-50000,note:'holding bill',dueDay:day});
  const tried=new Set();for(const kind of ['funding','taxes','payables','cheques'])for(let i=0;i<5;i++){const step=P.next(state,kind,{tried,F});if(!step)break;for(const k of step.keys)tried.add(k);step.commands.forEach(c=>sys(c.domain,c.name,c.payload,P.ACTOR));}
  assert.equal(state.finance.cheques.find(r=>r.id===chq.id).status,'مصروف','1a: the funded cheque due today is cashed');assert.ok(state.finance.payables.some(r=>r.number===bill.number),'1a: the bill waits (the cash was the cheque\'s)');
  // Review round 5: a cheque dated tomorrow is cashed by tonight's close, before the next autopilot: funded and kept back too.
  state.simSeconds+=DAY;const day2=day+1;const chq2=sys('finance','issue-cheque',{company:'dealership',amount:30000,beneficiary:'مورد',note:'cheque tomorrow',dueDay:day2+1,requestRef:'QA-RV5-CHQ'}),bill2=sys('finance','accrue-expense',{company:'dealership',amount:30000,note:'bill 2',dueDay:day2});
  sys('finance','credit',{company:'group',amount:30000,taxable:false,reference:'QA-RV5-ROOM'});const t2=new Set();for(const kind of ['funding','taxes','payables'])for(let i=0;i<5;i++){const step=P.next(state,kind,{tried:t2,F});if(!step)break;for(const k of step.keys)t2.add(k);step.commands.forEach(c=>sys(c.domain,c.name,c.payload,P.ACTOR));}
  assert.ok(F.operating(state,'dealership')>=30000,'1a: the cash for tomorrow\'s cheque is there after the day\'s payables');assert.ok(state.finance.payables.some(r=>r.number===bill2.number),'1a: the bill waits for it');}
{const w=researchWorld(),{F,state,sys,cost,day,P}=w;F.book(state,'group').accounts[0].balance=cost+1000000;F.reconcile(state);
  sys('finance','accrue-expense',{company:'group',amount:cost+5000000,note:'holding supplier bill',counterparty:'QA Supplier',dueDay:day,line:'other'});
  assert.equal(P.next(state,'continuation',{F,tried:new Set()}),null,'1b: a due bill the cash cannot cover holds the research back');}
{const w=researchWorld(),{F,state,cost,P}=w;F.book(state,'group').accounts[0].balance=cost+1000000;F.reconcile(state);state.finance.periods.push({id:'VAT-QA-RV4',company:'group',period:'P',amount:cost,status:'مستحق'});
  assert.equal(P.next(state,'continuation',{F,tried:new Set()}),null,'1b: due VAT holds the research back');}
{const w=researchWorld(),{F,state,cost,P,sys}=w;F.book(state,'group').accounts[0].balance=cost+1000000;F.reconcile(state);assert.ok(P.next(state,'continuation',{F,tried:new Set()}),'1b: with nothing due the research is funded');
  state.finance.centralTreasury=state.finance.centralTreasury||{};state.finance.centralTreasury.minOperatingCash={...(state.finance.centralTreasury.minOperatingCash||{}),group:2000000};assert.equal(P.next(state,'continuation',{F,tried:new Set()}),null,'1b: the holding\'s saved floor is kept');}
{const w=researchWorld(),{F,state,cost,P,sys}=w;F.book(state,'group').accounts[0].balance=cost*3;F.reconcile(state);assert.ok(P.next(state,'continuation',{F,tried:new Set()}),'1c: within the budget');
  sys('finance','set-budget',{company:'group',enabled:true,limit:cost-1,lines:{other:cost-1}},'financial-close');assert.equal(P.next(state,'continuation',{F,tried:new Set()}),null,'1c: a month\'s budget below the phase holds it (the owner would refuse)');}
// Review round 6: a returned cheque with no payable behind it had no button; «إعادة تقديم الشيك» sends the same settle-cheque,
// which cashes it once funds cover it (and leaves it returned when they do not).
{const {harness,minimal}=require('./helpers/core-harness');const MODULES=fs.readFileSync(path.join(__dirname,'build613-company-autopilot-finance.cjs'),'utf8').match(/const MODULES=(\[[^\]]*\])/)[1];
  const {s}=harness(JSON.parse(MODULES.replace(/'/g,'"')));const data={...minimal(),profile:{name:'Ret'},bank:{},operations:{},crew:[],branches:[],hired:[],unlockedSectors:[],ownedCompanies:[]};
  const state=s.GH_GAME_LIFECYCLE.pristine(data,1);s.GH_GAME_LIFECYCLE.foundGroup(state,{mode:'sandbox',name:'Ret Group',founder:'Founder',locationId:'RUH'},data,{nextId:()=> 'FOUND-RT',simYear:()=>2026});state.godMoney=false;state.infiniteMoney=false;
  const sys=(d,n,p)=>{const r=s.GH_DOMAIN_COMMANDS.dispatchSystem({state},d,n,p,{actor:'financial-close'});if(!r.ok)throw new Error(r.error);return r.result;},F=s.GH_FINANCE_CORE,cash=F.operating(state,'group');
  const chq=sys('finance','issue-cheque',{company:'group',amount:cash+1000,beneficiary:'مورد',note:'returned',dueDay:0,requestRef:'QA-RV6-RET'});assert.equal(sys('finance','settle-cheque',{id:chq.id}).settled,false);assert.equal(state.finance.cheques.find(r=>r.id===chq.id).status,'مرتجع','1d: returned');
  // Review round 7: presented again without funds it is refused before any write: the state is byte-for-byte the same
  // (no news line «ارتجاع شيك», no command record, the cheque untouched).
  {const before=JSON.stringify(state);assert.throws(()=>s.GH_DOMAIN_COMMANDS.dispatchSystem({state},'finance','settle-cheque',{id:chq.id},{actor:'financial-close'}),/^Error: insufficient-funds-or-budget$/,'1d: presented again without funds: refused with its reason');
    assert.equal(JSON.stringify(state),before,'1d: and nothing written');assert.equal(state.finance.cheques.find(x=>x.id===chq.id).status,'مرتجع','1d: still returned');}
  sys('finance','credit',{company:'group',amount:5000,taxable:false,reference:'QA-RV6-RET-CASH'});assert.equal(sys('finance','settle-cheque',{id:chq.id}).settled,true,'1d: presented again with funds: cashed');
  const app=fs.readFileSync(path.join(ROOT,'WebApp','app.js'),'utf8');assert.ok(app.includes("status==='مرتجع'&&c.direction!=='incoming'?`<div class=\"action-row cheque-actions\"><button class=\"primary-btn settle-cheque-now\" data-id=\"${esc(c.id)}\">إعادة تقديم الشيك</button>")&&app.includes("drawerRoot.querySelectorAll('.settle-cheque-now').forEach(b=>b.addEventListener('click',()=>settleIssuedCheque(b.dataset.id)));"),'1d: the button and its binding');}
console.log('1 ok: cheques before the policies');

// 2.
{const e=scenario();e.command('finance','credit',{company:'group',amount:2000000000,taxable:false,reference:'QA-RV-CAPITAL'});
  for(const n of ['business-world-core','branch-campaign-core','banking-core','insurance-core','customer-companies-core','customer-base-core','telecom-market-core','dealer-market-core','governance-core','company-autopilot-core'])e.load(n);
  for(const company of ['telecom','dealership'])e.command('corporate','open-company',{type:company,capital:200000000,legalName:'Scope '+company});
  for(const [company,kind] of [['telecom','telecom-branch'],['dealership','dealership-branch']])for(let i=0;i<3;i++)e.state.customHubs.push({id:`QA-RV-${company}-${i}`,kind,ownerCompanyId:company,owned:true,city:'الرياض',country:'السعودية',coords:[24+i*.01,46]});
  const {s,state}=e,P=s.GH_COMPANY_AUTOPILOT,F=s.GH_FINANCE_CORE,run=step=>{const out=runStep(s,state,step,ROOT);assert.equal(out.committed,true,`2: ${step.kind}${step.company?' '+step.company:''} commits under its roots (${out.reason||''})`);return out;};
  for(const company of ['telecom','dealership']){e.command('corporate','set-campaign-standing',{companyId:company,enabled:true});}
  const tried=new Set();for(let i=0;i<2;i++){const step=P.next(state,'campaigns',{F,tried});assert.ok(step,`2: a campaign step ${i+1}`);run(step);}
  // Pay that follows the market (HR) and research and renewals (governance), under the same audit.
  e.command('corporate','open-company',{type:'air',capital:200000000,legalName:'Scope Air'});s.GH_HR_CORE.ensure(state);state.realism=state.realism||{};state.realism.economy=state.realism.economy||{};state.realism.economy.wageIndex=1.07;
  e.command('hr','set-salary-follow-market',{company:'air',enabled:true});run(P.next(state,'salaries',{F,tried:new Set()}));
  s.GH_GOVERNANCE_CORE.ensure(state);state.simSeconds=200*DAY;state.research=state.research&&Object.keys(state.research).length?state.research:{efficiency:0,automation:0,cleanEnergy:0};const ids=Object.keys(state.research);
  state.advanced.researchPrograms={[ids[0]]:{spent:1,rounds:1,history:[],status:'بحث',phase:null}};state.research[ids[0]]=25;state.advanced.cyber=Object.assign(state.advanced.cyber||{},{coverage:40,lastDrillDay:150,events:[]});state.advanced.safety=Object.assign(state.advanced.safety||{},{plan:{startDay:10,untilDay:190}});
  e.command('governance','set-continuation-policy',{enabled:true});const t=new Set(),names=[];for(let i=0;i<3;i++){const step=P.next(state,'continuation',{F,tried:t});run(step);names.push(step.commands[0].name);}
  assert.deepEqual(names,['research-fund','cyber-drill','safety-audit'],'2: the three continuation commands');
  // The bank's review, the funding and a payment run.
  e.command('corporate','open-company',{type:'bank',capital:400000000,legalName:'Scope Bank'});s.GH_BANKING_CORE.ensure(state);e.command('banking','set-housekeeping',{enabled:true});state.simSeconds+=31*DAY;
  run(P.next(state,'housekeeping',{F,tried:new Set()}));
  state.godMoney=false;state.infiniteMoney=false;const bill=sysOf(s,state)('finance','accrue-expense',{company:'telecom',amount:F.operating(state,'telecom')+5000,note:'QA-RV bill',dueDay:0});
  const fund=P.next(state,'funding',{F,tried:new Set()});assert.ok(fund,'2: the funding step');run(fund);
  const pay=P.next(state,'payables',{F,tried:new Set()});assert.ok(pay&&pay.commands[0].payload.numbers.includes(bill.number),'2: the payment run');run(pay);}
{const f=hospitalityFixture(),{s,state,H,F,command}=f;f.load('business-world-core');f.load('company-autopilot-core');const P=s.GH_COMPANY_AUTOPILOT;state.godMoney=false;state.infiniteMoney=false;
  const a=f.property('hotel','RUH');H.read(state,'hospitality').properties.find(p=>p.id===a.id).condition=70;command('set-repair-policy',{policy:'standard'});F.book(state,'hospitality').accounts[0].balance=1e9;F.reconcile(state);
  const out=runStep(s,state,P.next(state,'repairs',{F,tried:new Set()}),ROOT);assert.equal(out.committed,true,`2: a hotel repair commits under its roots (${out.reason||''})`);
  const companyId=Object.keys(state.hospitality.companies)[0];state.advanced=state.advanced||{};state.advanced.companies=state.advanced.companies||{};state.advanced.companies[companyId]={...(state.advanced.companies[companyId]||{}),campaignStanding:true};
  const campaign=P.next(state,'campaigns',{F,tried:new Set()});assert.ok(campaign&&campaign.commands[0].name==='company-campaign','2: a hotel company\'s standing campaign step');const o=runStep(s,state,campaign,ROOT);assert.equal(o.committed,true,`2: a hotel company's campaign commits under its roots (${o.reason||''})`);}
console.log('2 ok: every policy step commits under its roots with the write audit');

// 3.
{const e=scenario();e.command('finance','credit',{company:'group',amount:2000000000,taxable:false,reference:'QA-RV-LOCK-CAPITAL'});for(const n of ['banking-core','governance-core','progression-core'])e.load(n);const {s,state}=e;
  e.command('corporate','open-company',{type:'telecom',capital:200000000,legalName:'Lock Telecom'});e.command('corporate','open-company',{type:'air',capital:200000000,legalName:'Lock Air'});e.command('corporate','open-company',{type:'bank',capital:400000000,legalName:'Lock Bank'});
  s.GH_HR_CORE.ensure(state);s.GH_BANKING_CORE.ensure(state);s.GH_GOVERNANCE_CORE.ensure(state);
  const policies=[['corporate','set-campaign-standing',{companyId:'telecom',enabled:true}],['hr','set-salary-follow-market',{company:'air',enabled:true}],['governance','set-continuation-policy',{enabled:true}],['banking','set-housekeeping',{enabled:true}]];
  state.progression={mode:'career',level:2,xp:0};assert.equal(s.GH_PROGRESSION_CORE.unlocked(state,'tool:autopilot'),false,'3: level 2 without Plus: the autopilot is locked');
  for(const [d,n,p] of policies)assert.throws(()=>e.command(d,n,p),/autopilot-locked/,`3: ${d} ${n} is refused without the autopilot`);
  assert.equal(state.advanced.companies?.telecom?.campaignStanding,undefined);assert.equal(state.advanced.continuation,undefined);assert.equal(state.bank.housekeeping,undefined);
  state.progression={mode:'career',level:7,xp:0};assert.equal(s.GH_PROGRESSION_CORE.unlocked(state,'tool:autopilot'),true,'3: level 7 unlocks it');
  for(const [d,n,p] of policies)e.command(d,n,p);assert.equal(state.advanced.companies.telecom.campaignStanding,true);assert.equal(state.advanced.continuation,true);assert.equal(state.bank.housekeeping,true);
  // Review round 4: a policy kept when the autopilot locks again (a Plus that lapses) can still be switched off.
  state.progression={mode:'career',level:2,xp:0};for(const [d,n,p] of policies)e.command(d,n,{...p,enabled:false});
  assert.equal(state.advanced.companies.telecom.campaignStanding,undefined,'3: switched off while locked');assert.equal(state.advanced.continuation,undefined);assert.equal(state.bank.housekeeping,undefined);assert.notEqual(state.advanced.labor.salaryPolicy.air.followMarket,true);}
{const f=hospitalityFixture(),{s,state,command}=f;f.load('progression-core');state.progression={mode:'career',level:2,xp:0};
  assert.throws(()=>command('set-repair-policy',{policy:'standard'}),/autopilot-locked/,'3: the hotels\' maintenance policy is refused without the autopilot');
  state.progression={mode:'career',level:7,xp:0};command('set-repair-policy',{policy:'standard'});assert.equal(f.H.read(state,'hospitality').repairPolicy,'standard');
  state.progression={mode:'career',level:2,xp:0};command('set-repair-policy',{policy:'off'});assert.equal(f.H.read(state,'hospitality').repairPolicy,undefined,'3: the hotels\' policy switched off while locked');}
// Review round 6: the campaign of all branches opens with the campaign of one branch (level 2), not at level 1.
{const e=scenario();e.command('finance','credit',{company:'group',amount:2000000000,taxable:false,reference:'QA-RV6-CAPITAL'});for(const n of ['branch-campaign-core','customer-companies-core','customer-base-core','telecom-market-core','progression-core'])e.load(n);
  e.command('corporate','open-company',{type:'telecom',capital:200000000,legalName:'Level Telecom'});for(let i=0;i<2;i++)e.state.customHubs.push({id:`QA-RV6-${i}`,kind:'telecom-branch',ownerCompanyId:'telecom',owned:true,city:'الرياض',country:'السعودية',coords:[24+i*.01,46]});
  const {s,state}=e,q=s.GH_TELECOM_MARKET.campaignQuote(state);state.progression={mode:'career',level:1,xp:0};
  assert.throws(()=>e.command('customer-companies','telecom-branches-campaign',{company:'telecom',companyId:'telecom',reference:'QA-RV6-L1',quoteKey:q.quoteKey}),/المستوى 2|level|locked/i,'3: level 1: the campaign of all branches is refused');
  state.progression={mode:'career',level:2,xp:0};const out=e.command('customer-companies','telecom-branches-campaign',{company:'telecom',companyId:'telecom',reference:'QA-RV6-L2',quoteKey:q.quoteKey});assert.equal(out.count,2,'3: level 2: launched');}
// Review round 7 (a reader): a Plus career at level 1 has the autopilot, but the campaign of all branches opens at level 2:
// the standing campaign cannot be switched on, one saved earlier is not launched by the autopilot (its commands are the
// system's, so the lock the player meets was never checked), and switching it off stays open; at level 2 it runs.
{const e=scenario();e.command('finance','credit',{company:'group',amount:2000000000,taxable:false,reference:'QA-RV7-CAPITAL'});for(const n of ['branch-campaign-core','customer-companies-core','customer-base-core','telecom-market-core','progression-core','company-autopilot-core'])e.load(n);
  e.command('corporate','open-company',{type:'telecom',capital:200000000,legalName:'Plus Telecom'});for(let i=0;i<2;i++)e.state.customHubs.push({id:`QA-RV7-${i}`,kind:'telecom-branch',ownerCompanyId:'telecom',owned:true,city:'الرياض',country:'السعودية',coords:[24+i*.01,46]});
  const {s,state}=e,P=s.GH_COMPANY_AUTOPILOT,F=s.GH_FINANCE_CORE;state.progression={mode:'career',level:1,xp:0};state.purchases={...(state.purchases||{}),entitlements:{plus:true}};
  assert.equal(s.GH_PROGRESSION_CORE.unlocked(state,'tool:autopilot'),true,'3b: Plus at level 1 has the autopilot');assert.equal(s.GH_PROGRESSION_CORE.unlocked(state,'command:customer-companies:telecom-branches-campaign'),false,'3b: and the campaign of all branches is locked');
  assert.throws(()=>e.command('corporate','set-campaign-standing',{companyId:'telecom',enabled:true}),/campaign-level-locked/,'3b: the standing campaign is refused below the campaign\'s level');assert.equal(state.advanced.companies?.telecom?.campaignStanding,undefined,'3b: nothing saved');
  state.advanced.companies=state.advanced.companies||{};state.advanced.companies.telecom={...(state.advanced.companies.telecom||{}),campaignStanding:true};
  assert.equal(P.next(state,'campaigns',{F,tried:new Set()}),null,'3b: a standing campaign saved earlier is not launched while its command is locked');
  e.command('corporate','set-campaign-standing',{companyId:'telecom',enabled:false});assert.equal(state.advanced.companies.telecom.campaignStanding,undefined,'3b: switching it off stays open');
  state.progression={mode:'career',level:2,xp:0};e.command('corporate','set-campaign-standing',{companyId:'telecom',enabled:true});const step=P.next(state,'campaigns',{F,tried:new Set()});
  assert.ok(step&&step.commands[0].name==='telecom-branches-campaign','3b: level 2: the standing campaign is saved and launched');
  // The card, lifted from advanced-core and drawn on the real cores: no switch-on below the level; a saved one shows paused with its off button.
  const advSource=fs.readFileSync(path.join(ROOT,'WebApp','advanced-core.js'),'utf8'),line=advSource.split('\n').find(r=>r.trimStart().startsWith('const campaignOwner=')),start=advSource.indexOf('  function companyCampaignMarkup(ctx,company){'),end=advSource.indexOf('\n  }\n',start)+4;
  const card=Function('g',`'use strict';const globalThis=g;const action=(id,label,attrs)=>'<button data-action="'+id+'" '+attrs+'>'+label+'</button>',text=x=>String(x),isolateMoney=x=>x,countOf=(n)=>String(n);${line}\n${advSource.slice(start,end)}\nreturn companyCampaignMarkup;`)(s);
  const ctx={state,fmtNumber:String,fmtMoney:String},draw=()=>card(ctx,'telecom');
  state.progression={mode:'career',level:1,xp:0};delete state.advanced.companies.telecom.campaignStanding;assert.ok(!draw().includes('data-action="company-campaign-standing"'),'3b: card at level 1 with Plus: no switch-on');
  state.advanced.companies.telecom.campaignStanding=true;const paused=draw();assert.ok(paused.includes('data-enabled="false"')&&paused.includes('إيقاف الاستمرار التلقائي'),'3b: a saved one keeps its off button');assert.ok(paused.includes('متوقف حتى تُفتح حملة كل الفروع'),'3b: and says it waits for the campaign\'s level');
  state.progression={mode:'career',level:2,xp:0};delete state.advanced.companies.telecom.campaignStanding;assert.ok(draw().includes('data-enabled="true"'),'3b: level 2: the switch-on is shown');
  const ui=advSource.slice(advSource.indexOf("if(id==='company-campaign-standing'){"),advSource.indexOf("if(id==='company-campaign-standing'){")+900);assert.ok(ui.includes("reason==='campaign-level-locked'?'حملة كل الفروع تُفتح في المستوى 2"),'3b: the refusal has its Arabic reason');}
// Review round 7 (a verifier: only the telecom company was proven): each of the four companies' standing campaign waits
// for its own command's level, in the step and in the command; hotels' campaigns have no level and are not held.
{const e=scenario();e.command('finance','credit',{company:'group',amount:5000000000,taxable:false,reference:'QA-RV7-FOUR'});for(const n of ['progression-core','company-autopilot-core'])e.load(n);const {s,state}=e,P=s.GH_COMPANY_AUTOPILOT,F=s.GH_FINANCE_CORE;
  const owners={bank:'GH_BANKING_CORE',insurance:'GH_INSURANCE_CORE',telecom:'GH_TELECOM_MARKET',dealership:'GH_DEALER_MARKET'};
  for(const type of Object.keys(owners))e.command('corporate','open-company',{type,capital:400000000,legalName:`Four ${type}`});
  for(const [company,core] of Object.entries(owners))s[core]={...(s[core]||{}),campaignQuote:()=>({count:1,total:1,day:1,quoteKey:`QA-${company}`})};
  state.openedCompanies=[...new Set([...(state.openedCompanies||[]),...Object.keys(owners)])];state.advanced.companies=state.advanced.companies||{};
  for(const company of Object.keys(owners))state.advanced.companies[company]={...(state.advanced.companies[company]||{}),campaignStanding:true};
  state.purchases={...(state.purchases||{}),entitlements:{plus:true}};F.book(state,'group').accounts[0].balance=1e9;F.reconcile(state);
  state.progression={mode:'career',level:1,xp:0};assert.equal(P.next(state,'campaigns',{F,tried:new Set()}),null,'3b: level 1: none of the four is launched');
  for(const company of Object.keys(owners))assert.throws(()=>e.command('corporate','set-campaign-standing',{companyId:company,enabled:true}),/campaign-level-locked/,`3b: ${company}: switching on refused at level 1`);
  state.progression={mode:'career',level:2,xp:0};const tried=new Set(),launched=[];for(let i=0;i<4;i++){const step=P.next(state,'campaigns',{F,tried});if(!step)break;launched.push(step.company);}
  assert.deepEqual(launched.sort(),Object.keys(owners).sort(),'3b: level 2: all four are launched');}
// Review round 8 (the owner: «موافق بس تأكد انها ماتخرب شي ولاتسبب ثقل وتكون واقعيه»):
// (a) a company's two campaign commands share one licence: a player who licensed a branch's campaign at level 1 keeps the
// campaign of all branches (and its quote names the one licence);
{const e=scenario();e.command('finance','credit',{company:'group',amount:2000000000,taxable:false,reference:'QA-RV8-LIC'});for(const n of ['progression-core'])e.load(n);const {s,state}=e,P=s.GH_PROGRESSION_CORE;
  state.progression={mode:'career',level:1,xp:0,licences:{'command:banking:branch-campaign':{day:1,level:1,need:2,fee:1,document:'QA'}}};
  for(const [one,all] of [['command:banking:branch-campaign','command:banking:branch-campaigns']]){assert.equal(P.unlocked(state,one),true,'3c: the licensed branch campaign');assert.equal(P.unlocked(state,all),true,'3c: and the campaign of all branches, under the same licence');}
  assert.equal(P.unlocked(state,'command:insurance:office-campaigns'),false,'3c: another company\'s campaign stays locked');
  state.progression.licences={};state.progression.difficulty=Object.keys(state.progression).includes('difficulty')?state.progression.difficulty:'normal';assert.equal(P.unlocked(state,'command:banking:branch-campaigns'),false,'3c: without the licence, locked at level 1');
  const q=P.licenceQuote(state,'command:customer-companies:telecom-branches-campaign');assert.equal(q.key,'command:customer-companies:telecom-branch-campaign','3c: one licence is quoted for both');}
// (b) the campaign card tells a company with no working branch from one whose branches all run a campaign;
{const e=scenario();e.command('finance','credit',{company:'group',amount:2000000000,taxable:false,reference:'QA-RV8-CARD'});for(const n of ['branch-campaign-core','customer-companies-core','customer-base-core','telecom-market-core','progression-core','company-autopilot-core'])e.load(n);
  e.command('corporate','open-company',{type:'telecom',capital:200000000,legalName:'Card Telecom'});const {s,state}=e;state.progression={mode:'career',level:7,xp:0};
  const advSource=fs.readFileSync(path.join(ROOT,'WebApp','advanced-core.js'),'utf8'),line=advSource.split('\n').find(r=>r.trimStart().startsWith('const campaignOwner=')),start=advSource.indexOf('  function companyCampaignMarkup(ctx,company){'),end=advSource.indexOf('\n  }\n',start)+4;
  const card=Function('g',`'use strict';const globalThis=g;const action=(id,label,attrs)=>'<button data-action="'+id+'" '+attrs+'>'+label+'</button>',text=x=>String(x),isolateMoney=x=>x,countOf=(n)=>String(n);${line}\n${advSource.slice(start,end)}\nreturn companyCampaignMarkup;`)(s),draw=()=>card({state,fmtNumber:String,fmtMoney:String},'telecom');
  assert.equal(s.GH_TELECOM_MARKET.campaignQuote(state).count,0,'3d: no branch yet');assert.equal(s.GH_TELECOM_MARKET.campaignQuote(state).running,0);assert.equal(draw(),'','3d: no branch and nothing saved: no card (no claim that branches run a campaign)');
  state.advanced.companies=state.advanced.companies||{};state.advanced.companies.telecom={...(state.advanced.companies.telecom||{}),campaignStanding:true};const saved=draw();
  assert.ok(saved.includes('لا يوجد فرع عامل الآن')&&saved.includes('data-enabled="false"')&&!saved.includes('كل الفروع المؤهلة لديها حملة جارية'),'3d: a saved one with no branch: says so, with its off button');delete state.advanced.companies.telecom.campaignStanding;
  for(let i=0;i<2;i++)state.customHubs.push({id:`QA-RV8-${i}`,kind:'telecom-branch',ownerCompanyId:'telecom',owned:true,city:'الرياض',country:'السعودية',coords:[24+i*.01,46]});
  const q=s.GH_TELECOM_MARKET.campaignQuote(state);e.command('customer-companies','telecom-branches-campaign',{company:'telecom',companyId:'telecom',reference:'QA-RV8-RUN',quoteKey:q.quoteKey});
  const after=s.GH_TELECOM_MARKET.campaignQuote(state);assert.equal(after.count,0);assert.equal(after.running,2,'3d: the two branches run a campaign');assert.equal(after.quoteKey,s.GH_TELECOM_MARKET.campaignQuote(state).quoteKey,'3d: the quote key is unchanged by the new count');
  assert.ok(draw().includes('كل الفروع المؤهلة لديها حملة جارية'),'3d: then the card says every branch runs one');
  const handler=advSource.slice(advSource.indexOf("const plan=owner[0].campaignQuote(s);if(!plan.count){"),advSource.indexOf("const plan=owner[0].campaignQuote(s);if(!plan.count){")+260);assert.ok(handler.includes("'لا يوجد فرع عامل لإطلاق الحملة.'"),'3d: the launch button says the same');}
// (c) the bank's housekeeping says what it does at the player's level; (d) the crews page survives a company on hold.
{const adv=fs.readFileSync(path.join(ROOT,'WebApp','advanced-core.js'),'utf8'),app=fs.readFileSync(path.join(ROOT,'WebApp','app.js'),'utf8');
  assert.ok(adv.includes("treasuryLevelOpen?.(ctx.state)===false?'يراجع الطيار الآلي حدود ائتمان الشركات كل 30 يومًا؛ وتبدأ إدارة سيولة البنك اليومية حين يُفتح استثمار السيولة (المستوى 18).'"),'3e: the notice below level 18');
  assert.ok(adv.includes("!core.treasuryLevelOpen(ctx.state)?'تشغيل آلي: مراجعة الحدود كل 30 يومًا (والسيولة اليومية من المستوى 18)'"),'3e: and the button');
  assert.ok(app.includes("salaryPolicy?.[(()=>{try{return HR?.salaryCompany?.(state,company.id)||company.id;}catch(_error){return company.id;}})()]?.followMarket===true"),'3f: the salary-follow lookup cannot throw out of the crews page');
  const e=scenario();e.load('hr-core');const H=e.s.GH_HR_CORE;assert.throws(()=>H.salaryCompany(e.state,'no-such-company'),'3f: salaryCompany throws for a company it cannot serve (what the guard catches)');}
console.log('3 ok: each policy refused without the autopilot, accepted with it');

// 4.
for(const [level,acts] of [[2,false],[7,false],[18,true]]){const locked=!acts;const e=scenario();for(const n of ['banking-core','progression-core'])e.load(n);e.command('corporate','open-company',{type:'bank',capital:400000000,legalName:'House Bank'});const {s,state}=e,B=s.GH_BANKING_CORE;B.ensure(state);
  // Level 2: no autopilot; level 7: the autopilot, but investing the liquidity opens at 18 (review round 4); level 18: both.
  e.command('banking','set-housekeeping',{enabled:true});state.progression={mode:'career',level,xp:0};
  const day=Math.floor(state.simSeconds/DAY)+1;state.simSeconds=day*DAY;const out=B.execute({state},'tick-day',{day});
  if(locked)assert.equal(out.autoTreasury,null,'4: the policy kept while the autopilot is locked manages nothing');else assert.ok(out.autoTreasury?.invested>0,'4: unlocked, the policy invests the surplus');}
// Review round 4: the player's own «إيقاف» on the treasury holds under the policy (the card read it as off while it ran),
// and the card and the daily close read the same answer (treasuryOn).
{const e=scenario();for(const n of ['banking-core','progression-core'])e.load(n);e.command('corporate','open-company',{type:'bank',capital:400000000,legalName:'Treasury Bank'});const {s,state}=e,B=s.GH_BANKING_CORE;B.ensure(state);state.progression={mode:'career',level:18,xp:0};
  const tick=()=>{const day=Math.floor(state.simSeconds/DAY)+1;state.simSeconds=day*DAY;return B.execute({state},'tick-day',{day}).autoTreasury;};
  e.command('banking','set-housekeeping',{enabled:true});assert.equal(B.treasuryOn(state),true,'4: the policy runs the treasury');
  e.command('banking','set-auto-liquidity',{enabled:false});assert.equal(B.treasuryOn(state),false,'4: the player switched it off');assert.equal(tick(),null,'4: and the close manages nothing');
  e.command('banking','set-housekeeping',{enabled:false});e.command('banking','set-housekeeping',{enabled:true});assert.equal(B.treasuryOn(state),true,'4: switching the policy on again runs it');assert.ok(tick()?.invested>0);
  const adv=fs.readFileSync(path.join(ROOT,'WebApp','advanced-core.js'),'utf8');assert.ok(adv.includes("const treasury=typeof core.treasuryOn==='function'?core.treasuryOn(ctx.state):bank.autoLiquidity===true")&&adv.includes("const saved=treasury||bank.autoLiquidity===true||(bank.housekeeping===true&&bank.autoLiquidityOff!==true);return action('bank-auto-liquidity',saved?"),'4: the card reads the same answer');}
// Review round 7 (a reader): a career below level 7 without Plus, both treasury commands licensed, the bank's policy on:
// the button reads saved («إيقاف») while the treasury does not run, so the line under it says it is paused with the
// policy, not «متوقفة: الاستثمار والتمويل بقرارك».
{const adv=fs.readFileSync(path.join(ROOT,'WebApp','advanced-core.js'),'utf8');
  assert.ok(adv.includes("bank.autoLiquidity!==true&&bank.housekeeping===true&&bank.autoLiquidityOff!==true?'محفوظة ضمن التشغيل الآلي للبنك، ومتوقفة حتى يُفتح الطيار الآلي من جديد.':'متوقفة: الاستثمار والتمويل بقرارك.'"),'4: the paused-with-the-policy line');
  const e=scenario();for(const n of ['banking-core','progression-core'])e.load(n);e.command('corporate','open-company',{type:'bank',capital:400000000,legalName:'Note Bank'});const {s,state}=e,B=s.GH_BANKING_CORE;B.ensure(state);
  e.command('banking','set-housekeeping',{enabled:true});state.progression={mode:'career',level:3,xp:0,licences:{'command:banking:invest-liquidity':true,'command:banking:raise-wholesale-funding':true}};
  assert.equal(B.treasuryLevelOpen(state),true,'4: licensed: the treasury commands are open');assert.equal(B.treasuryOn(state),false,'4: the autopilot locked: the treasury does not run');
  const saved=B.treasuryOn(state)||state.bank.autoLiquidity===true||(state.bank.housekeeping===true&&state.bank.autoLiquidityOff!==true);assert.equal(saved,true,'4: the button reads saved (its «إيقاف»), so the line must say paused');}
// Review round 4: the funding (one bulk transfer, level 3) and the cyber drill and safety audit (level 9) keep their levels.
{const w=researchWorld(),{F,state,P}=w;w.e.load('progression-core');state.advanced.researchPrograms={};state.advanced.cyber=Object.assign(state.advanced.cyber||{},{coverage:40,lastDrillDay:150,events:[]});state.advanced.safety=Object.assign(state.advanced.safety||{},{plan:{startDay:10,untilDay:190}});F.book(state,'group').accounts[0].balance=5e7;F.reconcile(state);
  state.progression={mode:'career',level:7,xp:0};assert.equal(P.next(state,'continuation',{F,tried:new Set()}),null,'4: level 7: the autopilot runs, but no drill nor audit before level 9');
  state.progression={mode:'career',level:9,xp:0};assert.equal(P.next(state,'continuation',{F,tried:new Set()})?.commands[0].name,'cyber-drill','4: level 9: the drill renews');}
{const {harness,minimal}=require('./helpers/core-harness');const MODULES=fs.readFileSync(path.join(__dirname,'build613-company-autopilot-finance.cjs'),'utf8').match(/const MODULES=(\[[^\]]*\])/)[1];
  const {s}=harness([...JSON.parse(MODULES.replace(/'/g,'"')),'progression-core']);const data={...minimal(),profile:{name:'Lvl'},bank:{},operations:{},crew:[],branches:[],hired:[],unlockedSectors:[],ownedCompanies:[]};
  const state=s.GH_GAME_LIFECYCLE.pristine(data,1);s.GH_GAME_LIFECYCLE.foundGroup(state,{mode:'sandbox',name:'Lvl Group',founder:'Founder',locationId:'RUH'},data,{nextId:()=> 'FOUND-LV',simYear:()=>2026});
  s.GH_DOMAIN_COMMANDS.dispatch({state},'corporate','open-company',{type:'dealership',capital:100000000,legalName:'LV Dealer'});state.godMoney=false;state.infiniteMoney=false;const F=s.GH_FINANCE_CORE,P=s.GH_COMPANY_AUTOPILOT;
  const sys=(d,n,p)=>{const r=s.GH_DOMAIN_COMMANDS.dispatchSystem({state},d,n,p,{actor:'financial-close'});if(!r.ok)throw new Error(r.error);return r.result;};sys('finance','accrue-expense',{company:'dealership',amount:F.operating(state,'dealership')+5000,note:'lv bill',dueDay:0});
  state.progression={mode:'career',level:2,xp:0};assert.equal(P.next(state,'funding',{F,tried:new Set()}),null,'4: level 2: no automatic funding (bulk transfer opens at 3)');
  state.progression={mode:'career',level:3,xp:0};assert.ok(P.next(state,'funding',{F,tried:new Set()}),'4: level 3: the holding funds the bill');}
console.log('4 ok: the bank\'s housekeeping acts only while the autopilot is unlocked');

// 6.
{const {harness,minimal}=require('./helpers/core-harness');const MODULES=fs.readFileSync(path.join(__dirname,'build613-company-autopilot-finance.cjs'),'utf8').match(/const MODULES=(\[[^\]]*\])/)[1];
  for(const balance of [886633.57,1000000.03,12345678.91,500000.1,250000.06,3000000.3]){const {s}=harness(JSON.parse(MODULES.replace(/'/g,'"')));const data={...minimal(),profile:{name:'Cents'},bank:{},operations:{},crew:[],branches:[],hired:[],unlockedSectors:[],ownedCompanies:[]};
    const state=s.GH_GAME_LIFECYCLE.pristine(data,1);s.GH_GAME_LIFECYCLE.foundGroup(state,{mode:'sandbox',name:'Cents Group',founder:'Founder',locationId:'RUH'},data,{nextId:()=> 'FOUND-CT',simYear:()=>2026});
    const sys=(d,n,p,actor='financial-close')=>{const r=s.GH_DOMAIN_COMMANDS.dispatchSystem({state},d,n,p,{actor});if(!r.ok)throw new Error(r.error);return r.result;},F=s.GH_FINANCE_CORE,P=s.GH_COMPANY_AUTOPILOT;
    s.GH_DOMAIN_COMMANDS.dispatch({state},'corporate','open-company',{type:'dealership',capital:100000000,legalName:'CT Dealer'});sys('corporate','open-company',{type:'media',capital:100000000,legalName:'CT Media'});
    for(const c of ['dealership','media']){const x=F.operating(state,c);if(x>0)sys('finance','transfer',{from:c,to:'group',amount:x,note:'cents'});}
    const excess=Math.floor(F.operating(state,'group')-1000000);sys('finance','transfer',{from:'group',to:'media',amount:excess,note:'cents'});F.book(state,'group').accounts[0].balance=balance;
    // A bill such that the bill and the room's remainder fit in total but the remainder is above the balance left after
    // the bill (the transfer owner pays row by row): the drain that refused the whole transfer (review round 3).
    let bill=null;for(let c=1000000;c<Math.floor(balance*100);c++){const x=c/100,b=(Math.floor(balance*100+1e-6)-c)/100;if(x+b<=balance&&balance-x<b){bill=x;break;}}assert.ok(bill!==null,`6: a draining bill exists for ${balance}`);
    sys('finance','accrue-expense',{company:'dealership',amount:bill,note:'cents bill',dueDay:0});sys('finance','set-central-treasury-policy',{minOperatingCash:{media:F.operating(state,'media')+5e7}});
    const step=P.next(state,'funding',{F,tried:new Set()});assert.ok(step,'6: a funding step');const sum=step.rows.reduce((n,r)=>n+r.amount,0);
    assert.ok(step.rows.every(r=>Math.abs(r.amount*100-Math.round(r.amount*100))<1e-6),'6: whole halalas');assert.ok(sum<=F.operating(state,'group'),`6: the total ${sum} within the room ${F.operating(state,'group')}`);
    const r=s.GH_DOMAIN_COMMANDS.dispatchSystem({state},'finance','bulk-transfer',step.commands[0].payload,{actor:P.ACTOR});assert.equal(r.ok,true,`6: the transfer owner accepts it (${r.error||''})`);}}
// A very large holding (a halala below the float step), where the trim used to loop for ever: the real core run in a
// separate context with a time limit, so a loop fails the gate at once.
{const vm=require('node:vm'),src=fs.readFileSync(path.join(ROOT,'WebApp','company-autopilot-core.js'),'utf8');
  for(const [books,floors] of [[{group:198047423362731.9,c0:0,c1:0},{c0:111390337079685.27,c1:116611209624052.97}],[{group:8.66e14,a:0,b:0,c:0,d:0},{a:3.1e14+.01,b:2.2e14+.03,c:1.7e14+.07,d:1.6e14+.09}]]){
    const box={books,floors};vm.createContext(box);vm.runInContext(src,box);
    const step=vm.runInContext(`const s={simSeconds:0,finance:{periods:[],cheques:[],payables:[],centralTreasury:{minOperatingCash:floors}}},F={operating:(_s,c)=>books[c],requireCompany:(_s,c)=>c,cashPoolEligible:()=>true,investorMode:()=>false};GH_COMPANY_AUTOPILOT.next(s,'funding',{F,tried:new Set()})`,box,{timeout:1000});
    if(step)assert.ok(step.rows.reduce((n,r)=>n+r.amount,0)<=books.group,'6: within the room');}}
console.log('6 ok: funding in whole halalas, within the room');

// 9. Review round 6: the destination ranking of the dispatch (half the automatic dispatch's work, profiled) takes the least
// haversine term first; every separation it reports is the exact number of the former loop (min over haversine), and the
// whole ranking is the one that loop produced.
{const N=require(path.join(ROOT,'WebApp','air-sea-network-core.js'));const hv=(a,b)=>{const rad=Math.PI/180,lat1=a[0]*rad,lat2=b[0]*rad,dLat=(b[0]-a[0])*rad,dLon=(b[1]-a[1])*rad,h=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;return 2*6371.0088*Math.asin(Math.sqrt(h));};
  let seed=7;const rnd=()=>(seed=(seed*1103515245+12345)%2147483648)/2147483648;let rows=0;
  for(let c=0;c<20;c++){const origin=[rnd()*140-70,rnd()*360-180],samples=[];for(let i=0;i<300;i++)samples.push({sampleIndex:i,worldIndex:i*3,key:'K'+(i%120),coords:[rnd()*140-70,rnd()*360-180]});const coords=[];for(let i=0;i<1+Math.floor(rnd()*200);i++)coords.push([rnd()*140-70,rnd()*360-180]);
    const input={originCoords:origin,rangeKm:rnd()<.3?0:4000+rnd()*12000,samples,ledger:{destinations:[],sectors:[],bands:[],coords}},plan=N.rankDestinations(input);assert.equal(N.validateDestinationPlan(input,plan),true);
    for(const row of plan.ranked){const s=samples[row.sampleIndex];let least=Infinity;for(const point of coords)least=Math.min(least,hv(point,s.coords));assert.equal(row.separation,least,'9: the exact separation');rows++;}
    const expected=plan.ranked.slice().sort((a,b)=>a.reuse-b.reuse||a.sectorUse-b.sectorUse||a.bandUse-b.bandUse||b.separation-a.separation||a.sampleIndex-b.sampleIndex);assert.deepEqual(plan.ranked.map(r=>r.sampleIndex),expected.map(r=>r.sampleIndex),'9: in the same order');}
  assert.ok(rows>1000,`9: ${rows} ranked destinations checked`);
  const app=fs.readFileSync(path.join(ROOT,'WebApp','app.js'),'utf8');assert.ok(app.includes("targetToDestination=haversine(target,destination);")&&app.includes("Math.max(0,haversine(coords,destination)-targetToDestination)*.16"),'9: the technical stop takes the constant distance once');}
console.log('9 ok: the dispatch\'s destination ranking, exact and lighter');

// 7 and 8: the app's review and auto-dispatch paths, lifted from app.js and run with stand-ins.
const espree=require('espree'),appSource=fs.readFileSync(path.join(ROOT,'WebApp','app.js'),'utf8'),appAst=espree.parse(appSource,{ecmaVersion:'latest',range:true}),fnSource=new Map();
(function walk(node){if(!node||typeof node!=='object')return;if(node.type==='FunctionDeclaration'&&node.id)fnSource.set(node.id.name,appSource.slice(...node.range));for(const value of Object.values(node))if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object')walk(value);})(appAst);
const constLine=name=>{const line=appSource.split('\n').find(row=>row.trimStart().startsWith(`const ${name}=`)||row.trimStart().startsWith(`let ${name}=`));assert.ok(line,`app.js defines ${name}`);return line;};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
  // 7.
  const review=Function('env',`'use strict';let {state,currentFleetUiSummary,requireFleetUiSummary,durableCommandInProgress,hardResetInProgress}=env;const window=env.window,runCompanyAutopilotStep=env.run,diag=env.diag;${constLine('AUTOPILOT_REVIEW_MAIN_LIMIT')}\n${fnSource.get('runAutopilotReview')}\nreturn {go:runAutopilotReview,set:o=>{if('state' in o)state=o.state;if('busy' in o)durableCommandInProgress=o.busy;if('reset' in o)hardResetInProgress=o.reset;}};`);
  const make=({size,ready=null,answer=null,txBusy=false})=>{const env={calls:[],diags:[],state:{simSeconds:10*DAY+5},window:{GH_FLEET_DATA:{size:()=>size},GH_TRANSACTION_CORE:{isDurableActive:()=>txBusy,isStaged:()=>false,isActive:()=>false},GH_BANKING_CORE:{limitsReviewDue:()=>env.due!==false}},durableCommandInProgress:false,hardResetInProgress:false};
    let resolve;env.currentFleetUiSummary=()=>ready;env.requireFleetUiSummary=()=>new Promise(r=>{resolve=r;});env.run=(step,ctx)=>env.calls.push(ctx);env.diag=(k,d)=>env.diags.push([k,d.reason]);const api=review(env);return {env,api,answer:value=>resolve(value)};};
  const step={kind:'housekeeping',keys:['housekeeping:bank'],commands:[{domain:'banking',name:'review-limits',payload:{}}]};
  {const t=make({size:100});t.api.go(step);assert.deepEqual(t.env.calls,[undefined],'7: up to 2,048 assets the review runs at once, as before');}
  {const t=make({size:2048});t.api.go(step);assert.deepEqual(t.env.calls,[undefined],'7: at 2,048 assets (the bank\'s own limit) still at once');}
  {const t=make({size:2049});t.api.go(step);assert.deepEqual(t.env.calls,[],'7: at 2,049 the summary is needed');t.answer(null);await flush();}
  {const summary={current:()=>true};const t=make({size:3000,ready:summary});t.api.go(step);assert.equal(t.env.calls[0].fleetSummary,summary,'7: above, with the cached summary when exact');}
  {const t=make({size:3000});t.api.go(step);assert.deepEqual(t.env.calls,[],'7: no summary yet: nothing runs now');const summary={current:target=>target===t.env.state};t.answer(summary);await flush();assert.equal(t.env.calls.length,1,'7: the worker\'s exact answer runs the review');assert.equal(t.env.calls[0].fleetSummary,summary);}
  {const t=make({size:3000});t.api.go(step);t.api.set({state:{simSeconds:10*DAY+9}});t.answer({current:()=>true});await flush();assert.deepEqual(t.env.calls,[],'7: a state replaced meanwhile: deferred');assert.equal(t.env.diags[0][1],'state-replaced');}
  {const t=make({size:3000});t.api.go(step);t.api.set({busy:true});t.answer({current:()=>true});await flush();assert.deepEqual(t.env.calls,[],'7: a command in flight: deferred');assert.equal(t.env.diags[0][1],'busy');}
  {const t=make({size:3000,txBusy:true});t.api.go(step);t.answer({current:()=>true});await flush();assert.deepEqual(t.env.calls,[],'7: a durable transaction active: deferred');assert.equal(t.env.diags[0][1],'busy');}
  {const t=make({size:3000});t.api.go(step);t.env.state.simSeconds+=DAY;t.answer({current:()=>true});await flush();assert.deepEqual(t.env.calls,[],'7: the day moved: deferred');}
  {const t=make({size:3000});t.api.go(step);t.answer({current:()=>false});await flush();assert.deepEqual(t.env.calls,[],'7: an answer no longer exact: deferred');assert.equal(t.env.diags[0][1],'not-current');}
  {const t=make({size:3000});t.api.go(step);t.answer(null);await flush();assert.deepEqual(t.env.calls,[],'7: no answer: deferred');assert.equal(t.env.diags[0][1],'no-summary');}
  {const t=make({size:3000});t.api.go(step);t.api.set({reset:true});t.answer({current:()=>true});await flush();assert.deepEqual(t.env.calls,[],'7: a hard reset under way: deferred');assert.equal(t.env.diags[0][1],'busy');}
  {const t=make({size:3000});t.api.go(step);t.env.window.__GH_DIAGNOSTIC_EXPORT_IN_PROGRESS__=true;t.answer({current:()=>true});await flush();assert.deepEqual(t.env.calls,[],'7: a diagnostic export under way: deferred');}
  {const t=make({size:3000});t.api.go(step);t.env.due=false;t.answer({current:()=>true});await flush();assert.deepEqual(t.env.calls,[],'7: reviewed meanwhile (by the button): not run twice');assert.equal(t.env.diags[0][1],'not-due');}
  console.log('7 ok: the bank\'s automatic review with the fleet summary above 2,048 assets');

  // 8.
  const dispatcher=Function('env',`'use strict';const state=env.state,hardResetInProgress=false,founderAuthorization=()=>({signature:1,mandate:1}),companyRouteModes=()=>['air'],fleetDispatchQuery=env.query,heldFleetDispatchQuery=env.query,dispatchSharedInternationalNetwork=env.send,dispatchExistingDistinctNetworkBatch=env.send,diag=(k,d)=>env.diags.push(k),clearAutoDispatchPending=async c=>{env.cleared.push(c);return env.clearOk!==false;},AUTO_DISPATCH_LIMIT=2000,SHARED_DISPATCH_LIMIT=20000,AUTO_DISPATCH_DAILY_LIMIT=20000,AUTO_DISPATCH_BUDGET_MS=1000,AUTO_DISPATCH_RUN_HOLD_MS=4500,AUTO_DISPATCH_GAP_MS=1500,setTimeout=(fn,ms)=>{(env.gaps=env.gaps||[]).push(ms);env.onGap?.(env,env.gaps.length);return globalThis.setTimeout(fn,0);},AUTO_DISPATCH_MAX={air:20000,sea:20000,road:10000},document=env.document||{hidden:false},window=env.window||{},stagedStateSettled=async()=>{};let deferredRefusals=0;env.bumpRefusals=()=>{deferredRefusals++;};${constLine('autoDispatchSizes')}\n${fnSource.get('autoDispatchLimit')}\n${fnSource.get('noteAutoDispatchHold')}\n${constLine('autoDispatchRunning')}\n${constLine('fleetTransientError')}\nenv.raise=fleetTransientError;\n${constLine('autoDispatchNoneLeft')}\n${constLine('autoDispatchTransient')}\n${fnSource.get('runAutoDispatch')}\nreturn {run:runAutoDispatch,failures:autoDispatchFailures,sizes:autoDispatchSizes,note:noteAutoDispatchHold,limit:autoDispatchLimit,bumpVisibility:()=>{autoDispatchVisibility++;}};`);
  const fleet=(query,send=async()=>({departed:3,remaining:0}),opened=['air'])=>{const env={state:{advanced:{companies:{air:{autoDispatchPending:true}}},openedCompanies:opened},query,send,diags:[],cleared:[]};return {env,api:dispatcher(env)};};
  {const t=fleet(async()=>{throw new Error('fleet-dispatch-query-stale');});for(let day=1;day<=5;day++){const out=await t.api.run(day);assert.equal(out.companies[0].deferred,true);}
    assert.deepEqual(t.env.cleared,[],'8: five stale answers keep the mark');assert.equal(t.api.failures.size,0,'8: and count no failure');assert.ok(t.env.diags.every(k=>k==='AUTO_DISPATCH_DEFERRED'));}
  {const t=fleet(async()=>{throw new Error('fleet-dispatch-worker-not-ready');});await t.api.run(1);assert.deepEqual(t.env.cleared,[]);assert.equal(t.api.failures.size,0,'8: a worker not ready counts no failure');}
  {const t=fleet(async()=>{throw new Error('fleet-dispatch-worker-unavailable');});await t.api.run(1);await t.api.run(2);assert.deepEqual(t.env.cleared,[],'8: two failures keep the mark');assert.equal(t.api.failures.get('air'),2);await t.api.run(3);assert.deepEqual(t.env.cleared,['air'],'8: the third clears it');}
  {const t=fleet(async()=>({indices:[]}));await t.api.run(1);assert.deepEqual(t.env.cleared,['air'],'8: nothing to send: cleared at once');}
  // The dispatch's own query or plan meets a stale or not-ready answer and reports a plain refusal (false): no failure.
  {let t;t=fleet(async()=>({indices:[4]}),async(_c,_n,options)=>{t.env.raise('fleet-dispatch-query-stale',options.transient);return false;});for(let day=1;day<=4;day++){const out=await t.api.run(day);assert.equal(out.companies[0].deferred,true);}
    assert.deepEqual(t.env.cleared,[],'8: a transient answer inside the dispatch keeps the mark');assert.equal(t.api.failures.size,0,'8: and counts no failure');}
  {const t=fleet(async()=>({indices:[4]}),async()=>false);await t.api.run(1);await t.api.run(2);await t.api.run(3);assert.deepEqual(t.env.cleared,['air'],'8: a plain refusal (busy, refused) still counts, the third clears');}
  // Review round 7: a transient answer raised meanwhile for another caller (no scope, or another's) is not this day's.
  {let t;t=fleet(async()=>({indices:[4]}),async()=>{t.env.raise('fleet-dispatch-query-stale');t.env.raise('fleet-dispatch-worker-not-ready',{raised:0});return false;});await t.api.run(1);
    assert.equal(t.api.failures.get('air'),1,'8: another caller\'s transient answer does not turn this refusal into a deferral');}
  // Review round 7: refused, and the probe again finds no idle asset (the player sent or sold it meanwhile): nothing left.
  {let left=[4];const t=fleet(async()=>({indices:left}),async()=>{left=[];return false;});await t.api.run(1);
    assert.deepEqual(t.env.cleared,['air'],'8: nothing left after a refusal: cleared at once');assert.equal(t.api.failures.size,0,'8: and no failure counted');}
  // Review round 7 (a verifier): the second probe meets a stale answer: the day is deferred, not counted a failure.
  {let n=0;const t=fleet(async()=>{if(n++===0)return {indices:[4]};throw new Error('fleet-dispatch-query-stale');},async()=>false);const out=await t.api.run(1);
    assert.equal(out.companies[0].deferred,true,'8: a transient second probe defers the day');assert.equal(t.api.failures.size,0,'8: and counts no failure');assert.deepEqual(t.env.cleared,[]);}
  assert.ok(appSource.includes("throw fleetTransientError('fleet-dispatch-worker-stale',transient)"),'8: the worker plan\'s stale answer is counted on the caller\'s scope');
  {const re=new Function(`${constLine('autoDispatchTransient')}\nreturn autoDispatchTransient;`)();assert.equal(re(new Error('fleet-dispatch-worker-stale')),true,'8: and read as transient');assert.equal(re(new Error('fleet-dispatch-worker-unavailable')),false,'8: unavailable is not');}
  // Review round 7: a closed company's mark is cleared, never dispatched.
  {const t=fleet(async()=>{throw new Error('must-not-probe');},async()=>{throw new Error('must-not-send');},[]);const out=await t.api.run(1);
    assert.deepEqual(t.env.cleared,['air'],'8: a closed company\'s mark is cleared');assert.deepEqual(out.companies,[],'8: and nothing dispatched');}
  // Review round 7: a clear that could not be written keeps the failure count, so the next day clears it, not three more.
  {const t=fleet(async()=>({indices:[4]}),async()=>false);t.env.clearOk=false;for(let day=1;day<=3;day++)await t.api.run(day);assert.equal(t.api.failures.get('air'),3,'8: the clear failed: the count is kept');
    t.env.clearOk=true;await t.api.run(4);assert.deepEqual(t.env.cleared,['air','air'],'8: the next day clears it');assert.equal(t.api.failures.size,0,'8: and drops the count');}
  // Review round 4: a new game while the probe is awaited stops the run (nothing is cleared or sent for the old game).
  {let t;t=fleet(async()=>{t.env.state.resetEpoch=(t.env.state.resetEpoch||0)+1;return {indices:[4]};},async()=>{throw new Error('must-not-send');});const out=await t.api.run(1);assert.equal(out.stopped,'game-changed','8: the run stops');assert.deepEqual(t.env.cleared,[],'8: nothing cleared');assert.equal(t.api.failures.size,0);}
  {const t=fleet(async()=>({indices:[4]}));const out=await t.api.run(1);assert.equal(out.companies[0].departed,3);assert.deepEqual(t.env.cleared,[],'8: assets sent: the dispatch keeps or clears the mark itself');}
  // The raise sites: fleetDispatchQuery's stale and not-ready answers and the worker plan's not-ready are counted on the
  // caller's scope (none without one).
  {const q=Function('env',`'use strict';let fleetEngineThreadClient=env.client;const window=env.window,FLEET_THREAD_EARLY_ROWS=2048,COMPANY_PLATFORM={};${constLine('fleetTransientError')}\n${fnSource.get('fleetDispatchQuery')}\nreturn {query:fleetDispatchQuery,set:c=>{fleetEngineThreadClient=c;}};`);
    const store={},env={client:{disabled:false,query:()=>null,current:()=>false},window:{GH_FLEET_DATA:{size:()=>5000},GH_FLEET_STORE:{isStore:x=>x===store},GH_FLEET_QUERY:{run:()=>({indices:[]})}}},api=q(env),s={fleet:store,simSeconds:0},scope={raised:0};
    await assert.rejects(api.query(s,'dispatchEligible',{},scope),/fleet-dispatch-worker-not-ready/);assert.equal(scope.raised,1,'8: not ready is counted');
    await assert.rejects(api.query(s,'dispatchEligible',{}),/fleet-dispatch-worker-not-ready/);assert.equal(scope.raised,1,'8: another caller\'s raise is not');
    api.set({disabled:false,query:()=>Promise.resolve({result:{}}),current:()=>false});await assert.rejects(api.query(s,'dispatchEligible',{},scope),/fleet-dispatch-query-stale/);assert.equal(scope.raised,2,'8: stale is counted');
    api.set(null);await assert.rejects(api.query(s,'dispatchEligible',{},scope),/fleet-dispatch-worker-unavailable/);assert.equal(scope.raised,2,'8: unavailable is not');
    assert.ok(appSource.includes("}else throw client?fleetTransientError('fleet-dispatch-worker-not-ready',transient):new Error('fleet-dispatch-worker-unavailable');"),'8: the worker plan counts its not-ready answer too');
    // Each dispatch passes the automatic run's scope to its query and its plan.
    for(const [fn,parts] of [['dispatchSharedInternationalNetwork',["{companyId,type,limit:options.limit||SHARED_DISPATCH_LIMIT},options.transient||null)","assignments:batch,routeTable,transient:options.transient||null}"]],['dispatchExistingDistinctNetworkBatch',["includeModeRouteIds:true},options.transient||null)","assignments,routeTable,transient:options.transient||null}"]]])for(const part of parts)assert.ok(fnSource.get(fn).includes(part),`8: ${fn} passes the scope (${part.slice(0,30)})`);}
  // Review round 4 (owner's default): the automatic dispatch is an autopilot decision: nothing is queued while it is locked,
  // and the marks are kept for when it opens.
  {const q=Function('env',`'use strict';const state=env.state,window=env.window,maintenanceQueue=env.queue,runtimeInstrumentation={maintenance:{}};${fnSource.get('queueAutoDispatch')}\nreturn queueAutoDispatch;`);
    const env={state:{advanced:{companies:{air:{autoDispatchPending:true}}}},window:{GH_PROGRESSION_CORE:{unlocked:()=>false}},queue:[]},queue=q(env);queue(5);assert.deepEqual(env.queue,[],'8: locked: nothing queued');assert.equal(env.state.advanced.companies.air.autoDispatchPending,true,'8: the mark is kept');
    env.window.GH_PROGRESSION_CORE.unlocked=()=>true;queue(6);assert.deepEqual(env.queue.map(r=>r.task),['auto-dispatch'],'8: unlocked: queued');}
  // Review round 5: no mark is made while the autopilot is locked (it would send parked assets on unlocking); clearing works.
  {const mk=Function('env',`'use strict';const window=env.window;${fnSource.get('setAutoDispatchPending')}\nreturn setAutoDispatchPending;`),env={window:{GH_PROGRESSION_CORE:{unlocked:()=>false}}},set=mk(env),target={advanced:{companies:{}}};
    set(target,'air',true);assert.equal(target.advanced.companies.air?.autoDispatchPending,undefined,'8: locked: no mark');env.window.GH_PROGRESSION_CORE.unlocked=()=>true;set(target,'air',true);assert.equal(target.advanced.companies.air.autoDispatchPending,true,'8: unlocked: marked');
    env.window.GH_PROGRESSION_CORE.unlocked=()=>false;set(target,'air',false);assert.equal(target.advanced.companies.air.autoDispatchPending,undefined,'8: clearing works while locked');}
  // Review round 7 (a reader): the cheque button. Bounced now (issued, not covered): saved returned, the notice says it
  // bounced (not «بقي مرتجعًا») and the drawer is redrawn so the button reads «إعادة تقديم الشيك»; presented again and still
  // not covered: refused, one notice saying it stays returned, no redraw; cashed: true and redrawn.
  {const make=answer=>{const env={notices:[],reopened:0,opts:null};const fn=Function('env',`'use strict';const state={finance:{cheques:[{id:'CH-1',status:env.status,amount:5,company:'air'}]}},window={},$=()=>({scrollTop:0}),activeDrawerPanel='invoices',activeDrawerArg='air',drawerNavigationRevision=1,notice=t=>env.notices.push(t),updateKpis=()=>{},reopenDrawer=()=>{env.reopened++;},fmtMoney=String,companyFinanceName=String,runAuthorizedDomainCommand=async(d,n,p,o)=>{env.opts=o;return env.answer();};${fnSource.get('settleIssuedCheque')}\nreturn settleIssuedCheque;`);env.answer=answer;return {env,go:status=>{env.status=status;return fn(env)('CH-1');}};};
    {const t=make(async()=>({result:{settled:false,reason:'insufficient-funds-or-budget'}}));assert.equal(await t.go('صادر'),false,'8c: bounced now: false');
      assert.equal(t.env.notices.length,1,'8c: one notice');assert.ok(t.env.notices[0].includes('فارتدّ وصار مرتجعًا'),'8c: it says the cheque bounced');assert.equal(t.env.reopened,1,'8c: the drawer is redrawn (its button changes)');assert.equal(t.env.opts.silent,true,'8c: no second, generic notice');}
    {const t=make(async()=>{throw new Error('insufficient-funds-or-budget');});assert.equal(await t.go('مرتجع'),false,'8c: refused: false');
      assert.deepEqual(t.env.notices.length,1,'8c: one notice');assert.ok(t.env.notices[0].includes('فبقي مرتجعًا'),'8c: it says the cheque stays returned');assert.equal(t.env.reopened,0,'8c: nothing to redraw');}
    {const t=make(async()=>({result:{settled:true}}));assert.equal(await t.go('مرتجع'),true,'8c: cashed: true');assert.equal(t.env.notices.length,0,'8c: the success notice is the command\'s');assert.equal(t.env.reopened,1,'8c: redrawn');}
    {const t=make(async()=>{throw new Error('active-visual-seal-required');});await t.go('صادر');assert.deepEqual(t.env.notices,['اعتمد توقيعك المرئي أولًا. لم تُنفذ المعاملة.'],'8c: the signature notice, once');}}
  console.log('8 ok: transient worker answers are no failures');
  // 8b. Heaviness batch D (the owner: «أوامر متعددة في اليوم»): bounded commands a day, sized by the measured hold.
  {const multi=({hold=600,remaining=1e6,hidden=false,capacityLimited=false,departedOf=limit=>limit,throwAt=-1,mode='air',companies=['air'],onSend=null,onGap=null,timingOf=null,query=null,falseAt=-1,refuseAt=-1}={})=>{const limits=[],env={state:{resetEpoch:1,advanced:{companies:Object.fromEntries(companies.map(id=>[id,{autoDispatchPending:true}]))},openedCompanies:companies},query:query||(async()=>({indices:[1]})),diags:[],cleared:[],document:{hidden},window:{__GH_APP_RUNTIME_INSTRUMENTATION__:{durable:{last:null}}}};
      env.send=async(company,_n,options)=>{limits.push(options.limit);env.companiesSent=(env.companiesSent||[]).concat(company);onSend?.(env,limits.length,options);if(env.failAll)throw new Error('qa-first-failure');if(limits.length-1===throwAt)throw new Error('qa-later-failure');if(limits.length-1===refuseAt){env.bumpRefusals();return false;}if(limits.length-1===falseAt)return false;const departed=departedOf(options.limit);env.window.__GH_APP_RUNTIME_INSTRUMENTATION__.durable.last={name:`authorized:bulk-shared-departure:${company}`,committed:true,totalMs:hold*options.limit/2000,...(timingOf?timingOf(company,options.limit,env):{})};return {departed,remaining,capacityLimited};};
      const api=Function('env',dispatcher.toString().replace(/^function anonymous\(env\s*\)\s*\{/,'').replace(/\}$/,'').replace("companyRouteModes=()=>['air']",`companyRouteModes=()=>['${mode}']`))(env);env.onGap=onGap;return {env,api,limits};};
    {const t=multi();const out=await t.api.run(1);assert.deepEqual(t.limits,[2000,3000,3000,3000,3000],'8b: at 0.3 ms an asset the size settles where a command holds the clock 1,000 ms (3,000); the run stops before a command would pass 4.5 s');assert.equal(out.companies[0].departed,14000,'8b: what the run placed');assert.ok(t.env.gaps.length===4&&t.env.gaps.every(ms=>ms===1500),`8b: the clock runs 1.5 s between commands, and no gap after the last (${t.env.gaps})`);assert.equal(t.api.failures.size,0);assert.deepEqual(t.env.cleared,[],'8b: the mark stays for the next close');}
    {const t=multi();await t.api.run(1);const t2=t.limits.length;await t.api.run(2);assert.equal(t.limits[t2],3000,'8b: the next day starts from the size learned (in memory)');}
    {const t=multi({hold:150});await t.api.run(1);assert.deepEqual(t.limits,[2000,4000,8000,6000],'8b: a fast device grows at most twice a command');}
    {const t=multi({remaining:0});await t.api.run(1);assert.deepEqual(t.limits,[2000],'8b: none left: one command');}
    {const t=multi({hold:3000});await t.api.run(1);assert.ok(t.limits.every(limit=>limit===2000),`8b: a slow device keeps 2,000 a command (${t.limits})`);}
    {const t=multi({hidden:true});await t.api.run(1);assert.ok(t.limits.every(limit=>limit===2000),'8b: a command while hidden is no sample');}
    {const t=multi({capacityLimited:true});await t.api.run(1);assert.deepEqual(t.limits,[2000],'8b: route capacity reached: the day stops');assert.equal(t.api.limit('air','air'),2000,'8b: and it is no sample');}
    {const t=multi({departedOf:()=>400});await t.api.run(1);assert.equal(t.api.limit('air','air'),2000,'8b: under 500 departed is no sample');}
    {const t=multi({throwAt:1});const out=await t.api.run(1);assert.deepEqual(t.limits,[2000,3000]);assert.equal(out.companies[0].departed,2000,'8b: a later command that throws keeps the earlier ones');assert.equal(out.companies[0].failed,null);assert.equal(t.api.failures.size,0,'8b: and counts no failure');}
    {const t=multi({throwAt:0});await t.api.run(1);assert.equal(t.api.failures.get('air'),1,'8b: the first command\'s error is the day\'s failure, as before');}
    // Review (D post): the run budget spans companies; the gap and the budget hold between companies; hidden stops; a game
    // replaced in the gap stops; a failed command starts the size over.
    // Road post-review (F2): a probe holds the clock too. One transient probe refusal (a backlogged worker) defers the other
    // companies without probing them; a probe's held time counts in the run budget.
    {let probes=0;const t=multi({companies:['air','sky','sea'],query:async()=>{probes++;throw new Error('fleet-dispatch-worker-not-ready');}});const out=await t.api.run(0);
      assert.equal(probes,1,'8b: one transient probe refusal, no further probe this run');assert.deepEqual(t.limits,[],'8b: and no command');assert.ok(out.companies.length===3&&out.companies.every(row=>row.deferred===true&&!row.failed),`8b: all three keep their mark, no failure (${JSON.stringify(out.companies)})`);assert.deepEqual(out.companies.map(row=>row.stoppedBy),['fleet-transient','fleet-transient-earlier','fleet-transient-earlier'],'8b: each deferral records its reason');assert.equal(t.api.failures.size,0);}
    {let probes=0;const t=multi({companies:['air','sky'],query:async(_s,_n,_p,transient)=>{probes++;if(transient)transient.heldMs=(Number(transient.heldMs)||0)+5000;return {indices:[1]};}});const out=await t.api.run(0);
      assert.equal(probes,1,'8b: a probe that held the clock 5 s spends the run budget: the next company is not probed');assert.equal(out.companies.find(row=>row.companyId==='sky')?.deferred,true,'8b: it waits for the next close');assert.deepEqual(t.limits,[2000],'8b: the first company still sends its first command');}
    {const t=multi({hold:1500,companies:['air','sky']});const out=await t.api.run(0);assert.deepEqual(t.env.companiesSent,['air','air','air'],'8b: the run budget ends the run before the next company');assert.equal(out.companies.find(row=>row.companyId==='air')?.stoppedBy,'run-clock-budget','8b: the run records why it stopped');assert.equal(out.companies.find(row=>row.companyId==='sky')?.stoppedBy,'run-clock-budget');assert.equal(out.companies.find(row=>row.companyId==='sky')?.deferred,true,'8b: whose mark stays, no failure');assert.deepEqual(t.env.cleared,[]);assert.equal(t.api.failures.size,0);}
    {const t=multi({hold:150,companies:['air','sky'],remaining:0});await t.api.run(0);assert.deepEqual(t.env.companiesSent,['air','sky'],'8b: within the budget the next company runs');assert.deepEqual(t.env.gaps,[1500],'8b: after the gap between companies');}
    {const t=multi({hold:150,companies:['air','sky'],remaining:0});await t.api.run(1);assert.deepEqual(t.env.companiesSent,['sky','air'],'8b: the companies take turns being first');}
    {const t=multi({hold:1800,companies:['air','sky']});const out=await t.api.run(0);assert.deepEqual(t.env.companiesSent,['air','air'],'8b: a company not measured yet is foreseen at the run\'s own hold per asset: no command past the budget');assert.equal(out.companies.find(row=>row.companyId==='sky')?.deferred,true);}
    {const t=multi({hold:150,companies:['air','sky'],remaining:0,onGap:env=>{env.state.resetEpoch=2;}});const out=await t.api.run(0);assert.deepEqual(t.env.companiesSent,['air'],'8b: a game replaced in the gap between companies stops the run');assert.equal(out.stopped,'game-changed');}
    {const t=multi({hold:150,companies:['air','sky'],remaining:0,onGap:env=>{env.document.hidden=true;}});const out=await t.api.run(0);assert.deepEqual(t.env.companiesSent,['air'],'8b: the app hidden in the gap between companies: no further command');assert.equal(out.companies.find(row=>row.companyId==='sky')?.deferred,true);}
    {const t=multi({onGap:env=>{env.state.resetEpoch=2;}});const out=await t.api.run(1);assert.equal(t.limits.length,1,'8b: a game replaced in the gap between commands stops the run');assert.equal(out.stopped,'game-changed');}
    // Road post-review (reF2): every held query of a company counts, not the probe alone: the road command's own held query
    // (reported on the scope) and a raise inside a command defer the rest as a probe's do.
    {const t=multi({hold:150,onSend:(env,n,o)=>{if(n===1)o.transient.heldMs=(Number(o.transient.heldMs)||0)+5000;}});const out=await t.api.run(1);assert.deepEqual(t.limits,[2000],`8b: a command whose own query held the clock 5 s spends the budget (${t.limits})`);assert.equal(out.companies[0].stoppedBy,'run-clock-budget');}
    {const t=multi({hold:150,throwAt:0,companies:['air','sky'],onSend:(env,n,o)=>{if(n===1)o.transient.heldMs=(Number(o.transient.heldMs)||0)+5000;}});const out=await t.api.run(0);assert.deepEqual(t.env.companiesSent,['air'],'8b: a command that throws after a 5 s held query still spends the budget');assert.equal(out.companies.find(row=>row.companyId==='sky')?.deferred,true);}
    {const t=multi({hold:150,remaining:0,companies:['air','sky'],onSend:(env,n,o)=>{if(n===1)o.transient.raised++;}});const out=await t.api.run(0);assert.deepEqual(t.env.companiesSent,['air'],'8b: a transient raise inside a command defers the other companies');assert.equal(out.companies.find(row=>row.companyId==='sky')?.stoppedBy,'fleet-transient-earlier');assert.equal(t.api.failures.size,0);}
    // (rv3) A deferred command refused for a save that ran meanwhile defers its own company only (not a busy worker).
    {const t=multi({hold:150,remaining:0,companies:['air','sky'],refuseAt:0});const out=await t.api.run(0);assert.deepEqual(t.env.companiesSent,['air','sky'],'8b: a save collision does not defer the next company');assert.equal(out.companies.find(row=>row.companyId==='air')?.stoppedBy,'deferred-save-refused');assert.deepEqual([out.companies[0].raised,out.companies[0].saveRefusals],[1,1],'8b: the deferred row carries its counts');assert.equal(t.api.failures.size,0);}
    // (rv3) A command refused before its durable step leaves the former record: it is not counted again.
    {const t=multi({hold:2500,remaining:500,companies:['air','sky'],falseAt:1,onSend:(env,n)=>{if(n===1)t.api.note('sky','air',{holdMs:100,departed:2000,capacityLimited:false,visible:true});}});const out=await t.api.run(0);assert.deepEqual(t.env.companiesSent,['air','air','sky'],`8b: the former command's 2.5 s is counted once (${t.env.companiesSent})`);assert.notEqual(out.companies.find(row=>row.companyId==='sky')?.deferred,true);}
    // (rv4) Hidden before any command, the budget spent by probes: the reason is the budget.
    {const t=multi({hidden:true,companies:['air','sky'],query:async(_s,_n,p,tr)=>{tr.heldMs=(Number(tr.heldMs)||0)+5000;return {indices:p.companyId==='air'?[]:[1]};}});const out=await t.api.run(0);assert.equal(out.companies.find(row=>row.companyId==='sky')?.stoppedBy,'run-clock-budget','8b: no command yet: the budget, not the hidden app');}
    // (rv3) Hidden after a command: the next company is deferred without a held probe.
    {let probes=0;const t=multi({hold:150,remaining:0,companies:['air','sky'],query:async()=>{probes++;return {indices:[1]};},onSend:(env,n)=>{if(n===1)env.document.hidden=true;}});const out=await t.api.run(0);assert.equal(probes,1,'8b: no probe while hidden');assert.equal(out.companies.find(row=>row.companyId==='sky')?.stoppedBy,'app-hidden');}
    // (rv3) A moderate held time (1 s, under the budget alone) is counted once: one command fewer than without it (the
    // control at 8b's first case sends five), the gaps between them, the stop recorded.
    {const t=multi({onSend:(env,n,o)=>{if(n===1)o.transient.heldMs=(Number(o.transient.heldMs)||0)+1000;}});const out=await t.api.run(1);assert.deepEqual(t.limits,[2000,3000,3000,3000],`8b: 1 s held is counted once (${t.limits})`);assert.deepEqual(t.env.gaps,[1500,1500,1500],'8b: a gap between commands, none after the stop');assert.equal(out.companies[0].stoppedBy,'run-clock-budget');}
    // (rv3) A command is made smaller to fit the budget left (6,500, not the 8,000 the measured size would allow).
    {const t=multi({hold:300});await t.api.run(1);assert.deepEqual(t.limits,[2000,4000,6500,6500,1000],`8b: sized to the budget left, then the day's share (${t.limits})`);}
    // (rv3) Held time narrows the last command to the budget left: 1.3 s held after the first: 2,500, not 3,000.
    {const t=multi({onSend:(env,n,o)=>{if(n===1)o.transient.heldMs=(Number(o.transient.heldMs)||0)+1300;}});await t.api.run(1);assert.deepEqual(t.limits,[2000,3000,3000,2500],`8b: held time narrows the last command (${t.limits})`);assert.deepEqual(t.env.gaps,[1500,1500,1500]);}
    // (rv3) A probe that held the clock 3.1 s narrows the second command too (the budget left counts it).
    {const t=multi({query:async(_s,_n,_p,tr)=>{tr.heldMs=(Number(tr.heldMs)||0)+3100;return {indices:[1]};}});await t.api.run(1);assert.deepEqual(t.limits,[2000,2500],`8b: the probe's held time counts in the budget left (${t.limits})`);}
    // (rv3) A refused command's re-probe that answers a busy worker defers the other companies without probing them.
    {let calls=0;const t=multi({companies:['air','sky'],falseAt:0,query:async(_s,_n,_p,tr)=>{calls++;if(calls===2){tr.raised++;tr.heldMs=(Number(tr.heldMs)||0)+5000;throw new Error('fleet-dispatch-worker-not-ready');}return {indices:[1]};}});const out=await t.api.run(0);
      assert.equal(calls,2,'8b: no probe after a busy re-probe');assert.deepEqual(out.companies.map(row=>row.stoppedBy),['fleet-transient','fleet-transient-earlier']);assert.equal(t.api.failures.size,0);}
    // (F3) The foresight is for the assets actually left: 500 left at 1.5 ms an asset fit in the 1.5 s remaining.
    {const t=multi({hold:3000,remaining:500});await t.api.run(1);assert.equal(t.limits.length,2,`8b: the 500 left are foreseen, not a whole command (${t.limits})`);}
    // The hold is a sample only for this command's own, committed record, the page visible throughout.
    {const control=multi({remaining:0,hold:150});await control.api.run(1);assert.ok(control.api.limit('air','air')>2000,'8b: control: one fast command grows the size');}
    {const t=multi({remaining:0,hold:150,onSend:()=>t.api.bumpVisibility()});await t.api.run(1);assert.equal(t.api.limit('air','air'),2000,'8b: hidden and shown again during the command: no sample');}
    for(const [label,timing] of [['another command\'s record',{name:'authorized:other'}],['an uncommitted record',{committed:false}],['a record of another revision',{saveRevision:99}]]){const t=multi({remaining:0,hold:150,timingOf:()=>timing});t.env.state.saveRevision=7;await t.api.run(1);assert.equal(t.api.limit('air','air'),2000,`8b: ${label} is no sample`);}
    {const t=multi({onSend:(env,n)=>{if(n===2)env.document.hidden=true;}});await t.api.run(1);assert.equal(t.limits.length,2,'8b: the app hidden: no further command');assert.deepEqual(t.env.cleared,[]);}
    {const t=multi({onSend:(env,n)=>{if(n===1)env.state.resetEpoch=2;}});const out=await t.api.run(1);assert.equal(t.limits.length,1,`8b: a game replaced during the gap stops the run (${t.limits})`);assert.equal(out.stopped,'game-changed');}
    {const t=multi({hold:150});await t.api.run(1);assert.ok(t.api.limit('air','air')>2000);t.env.failAll=true;await t.api.run(2);assert.equal(t.api.limit('air','air'),2000,'8b: a failed command starts the size over');}
    {const t=multi({mode:'road',hold:100});await t.api.run(1);assert.ok(Math.max(...t.limits)<=10000,`8b: road at most 10,000 a command (${t.limits})`);}
  }
  console.log('8b ok: bounded automatic dispatch commands a day, sized by the measured hold');
  // 8d. Road post-review (F6, the held time, F5). heldFleetDispatchQuery: a small fleet runs without drain or hold; a large
  // one drains, holds, reports the held time on the scope and releases the hold; an answer past 5 s is a counted refusal.
  {const make=size=>{const env={now:0,drains:0,direct:0,answer:()=>Promise.resolve({indices:[1]})};const fn=Function('env',`'use strict';const window={GH_FLEET_DATA:{size:()=>env.size}},FLEET_THREAD_EARLY_ROWS=2048,performance={now:()=>env.now},drainSimulation=async()=>{env.drains++;env.now+=300;},stagedStateSettled=async()=>{},fleetStepSettled=async()=>{env.holdsSeen=fleetQueryHolds;},fleetDispatchQuery=(t,n,p,tr)=>{env.direct++;env.now+=700;return env.answer();},setTimeout=(fn,ms)=>{env.timers=(env.timers||[]).concat(ms);const id=env.timers.length;if(env.fireTimers){env.now+=ms;Promise.resolve().then(fn);}return id;},clearTimeout=id=>{if(id)(env.cleared=env.cleared||[]).push(id);};let fleetQueryHolds=0;${fnSource.get('heldFleetDispatchQuery')}\nreturn {query:heldFleetDispatchQuery,holds:()=>fleetQueryHolds};`)(env);env.size=size;return {env,...fn};};
    {const t=make(100),scope={raised:0};assert.deepEqual(await t.query({},'dispatchEligible',{},scope),{indices:[1]});assert.equal(t.env.drains,0,'8d: a small fleet: no drain');assert.equal(t.env.holdsSeen,undefined,'8d: and no hold');assert.equal(scope.heldMs,undefined,'8d: no held time');}
    {const t=make(5000),scope={raised:0};await t.query({},'dispatchEligible',{},scope);assert.equal(t.env.drains,1,'8d: a large fleet drains first');assert.equal(t.env.holdsSeen,1,'8d: holds while answering');assert.equal(t.holds(),0,'8d: released');assert.equal(scope.heldMs,700,'8d: the held time is reported (from the hold, not the drain before it)');assert.deepEqual(t.env.cleared,[1],'8d: the 5 s timer is cleared on an answer (no later raise)');assert.equal(scope.raised,0);
      await t.query({},'dispatchEligible',{},scope);assert.equal(scope.heldMs,1400,'8d: and added up across queries');}
    {const t=make(2048);await t.query({},'dispatchEligible',{},{raised:0});assert.equal(t.env.drains,1,'8d: 2,048 assets (the worker\'s rows) are held');}
    {const t=make(5000),scope={raised:0};t.env.answer=()=>new Promise(()=>{});t.env.fireTimers=true;await assert.rejects(t.query({},'dispatchEligible',{},scope),/fleet-dispatch-worker-not-ready/);assert.equal(scope.raised,1,'8d: past 5 s: a counted refusal');assert.equal(scope.heldMs,5700,'8d: its held time counts');assert.equal(t.holds(),0);}
    // (F5) The road dispatch: an answer without its rows releases the planning reservation (it held it until a reload).
    const road=Function('env',`'use strict';const state={resetEpoch:1},notice=t=>env.notices.push(t),routeCompanyFromInput=c=>c,SHARED_DISPATCH_LIMIT=20000,reasonText=e=>'R:'+e.message,heldFleetDispatchQuery=async()=>{env.during=roadPlanning;if(env.onQuery)env.onQuery(state);if(env.fail)throw new Error(env.fail);return env.pass;};let roadPlanning=null;${fnSource.get('dispatchExistingDistinctNetworkBatch')}\nreturn {go:dispatchExistingDistinctNetworkBatch,planning:()=>roadPlanning};`);
    for(const [pass,auto,expected] of [[{},false,false],[null,false,false],[{indices:null},true,false],[{indices:[]},true,{departed:0,none:true,remaining:0}],[{indices:[]},false,false]]){const env={notices:[],pass},api=road(env);assert.deepEqual(await api.go('road',null,{auto}),expected,`8d: ${JSON.stringify(pass)} answers ${JSON.stringify(expected)}`);assert.equal(api.planning(),null,`8d: ${JSON.stringify(pass)} releases the planning`);assert.ok(env.during&&env.during.controller,'8d: the planning is reserved before the held query');}
    {const env={notices:[],pass:{indices:[1]},fail:'fleet-dispatch-worker-not-ready'},api=road(env);assert.equal(await api.go('road',null,{auto:true}),false,'8d: a refused held query answers false');assert.equal(api.planning(),null,'8d: and releases the planning');assert.deepEqual(env.notices,[],'8d: the automatic one is silent');}
    {const env={notices:[],pass:{indices:[1]},fail:'fleet-dispatch-worker-not-ready'},api=road(env);assert.equal(await api.go('road',null,{}),false);assert.deepEqual(env.notices,['تعذر تجهيز نسخة العامل المطابقة للأسطول: R:fleet-dispatch-worker-not-ready'],'8d: the button\'s notice reads the reason text');}
    {const env={notices:[],pass:{indices:[1]},onQuery:s=>{s.resetEpoch++;}},api=road(env);assert.equal(await api.go('road',null,{auto:true}),false,'8d: a new game during the held query answers false');assert.equal(api.planning(),null,'8d: and releases the planning');}}
  // 8e. «إصلاح الكل الآن» (reF1): the simulation drains first (the step in flight commits, no clock step back), then the
  // game is held for the quote, the confirm and the steps, released on every way out; each signed step carries at most
  // 500 assets (the frame paints between); every refusal of the command has an Arabic text.
  {const make=held=>{const env={order:[]};const api=Function('env',`'use strict';let assetPurchaseHolds=0,drawerNavigationRevision=1;const window={GH_REALISM:{}},companyFinanceName=String,drainSimulation=async()=>{env.order.push(['drain',assetPurchaseHolds]);},repairAllHeld=async()=>{env.order.push(['held',assetPurchaseHolds]);return env.held();};${fnSource.get('repairAllNow')}\nreturn {go:repairAllNow,holds:()=>assetPurchaseHolds};`)(env);env.held=held;return {env,...api};};
    {const t=make(async()=>true);assert.equal(await t.go('air'),true);assert.deepEqual(t.env.order,[['drain',0],['held',1]],'8e: drained unheld, then held for the work');assert.equal(t.holds(),0,'8e: released');}
    {const t=make(async()=>{throw new Error('qa');});await assert.rejects(t.go('air'),/qa/);assert.equal(t.holds(),0,'8e: released on a throw');}
    assert.ok(fnSource.get('repairAllHeld').includes("companyId,slice:500}"),'8e: the quote is sliced 500 assets a signed step');
    const reasons=Function(`'use strict';${constLine('COMMAND_REASON_TEXT')}\nreturn COMMAND_REASON_TEXT;`)();
    for(const key of ['repair-asset-above-line','repair-quote-stale','repair-batch-company','fleet-service-quote-changed','fleet-dispatch-worker-not-ready','fleet-dispatch-query-stale','fleet-dispatch-worker-stale','fleet-dispatch-worker-unavailable'])assert.ok(/[\u0600-\u06FF]/.test(String(reasons[key]||'')),`8e: ${key} has an Arabic text`);}
  // 8f. Batch H (retired route): withRetiredRouteProof binds the worker's reference count to the service / return command
  //     of an isolated asset leaving a retired route, for a fleet above 2,048 rows, the game held from the drain through
  //     the command (the proof stays current), released on every way out; a small fleet or another asset runs as before.
  {const make=({size=5000,query=null}={})=>{const env={order:[],holds:[]};const api=Function('env',`'use strict';let assetPurchaseHolds=0;const FLEET_THREAD_EARLY_ROWS=2048,state={simSeconds:7},window={GH_FLEET_DATA:{size:()=>env.size},GH_ROUTE_CORE:{referenceRequest:(s,c,p)=>({routeIds:[p.id],baseIds:[],excludeAssetId:p.assetId,command:c})},GH_FLEET_REFERENCE_QUERY:{capture:(s,f,p)=>({stamp:p.routeIds[0]}),current:(stamp,target)=>target===env.draft&&stamp.stamp==='R-OLD'}},drainSimulation=async()=>{env.order.push(['drain',assetPurchaseHolds]);},heldFleetDispatchQuery=async(s,name,params)=>{env.order.push(['query',assetPurchaseHolds,name,params.excludeAssetId]);return env.query?env.query(params):{counts:1};};${fnSource.get('withRetiredRouteProof')}\nreturn {go:withRetiredRouteProof,holds:()=>assetPurchaseHolds};`)(env);env.size=size;env.query=query;env.draft={};return {env,...api};};
    const isolated={id:'A1',phase:'moving',releaseExclusiveRouteOnArrival:true,routeId:'R-OLD'};
    {const t=make();let seen=null;const out=await t.go(isolated,extra=>{seen=extra;t.env.order.push(['run',t.holds()]);return 'done';});assert.equal(out,'done');
      assert.deepEqual(t.env.order,[['drain',0],['query',1,'referenceUsage','A1'],['run',1]],'8f: drained, then held for the query and the command');assert.equal(t.holds(),0,'8f: released');
      assert.deepEqual(seen.context.fleetReferenceUsage.params,{routeIds:['R-OLD'],baseIds:[],excludeAssetId:'A1',command:'delete'},'8f: the delete request, this asset excluded');assert.deepEqual(seen.context.fleetReferenceUsage.result,{counts:1});assert.equal(seen.context.fleetReferenceUsage.current(t.env.draft),true,'8f: current against the command draft');}
    {const t=make();await assert.rejects(t.go(isolated,async()=>{throw new Error('qa-refused');}),/qa-refused/);assert.equal(t.holds(),0,'8f: released on a refusal');}
    {const t=make({query:async()=>{throw new Error('fleet-dispatch-worker-not-ready');}});let seen=null;await t.go(isolated,extra=>{seen=extra;});assert.deepEqual(seen,{},'8f: no answer: the command runs without a proof');assert.equal(t.holds(),0);}
    for(const [fn,command] of [['serviceAsset','service'],['returnAssetToBase','return-to-base']])assert.ok(fnSource.get(fn).includes(`withRetiredRouteProof(a,extra=>runAuthorizedDomainCommand('fleet','${command}'`)&&/\{\.\.\.extra,successNotice:/.test(fnSource.get(fn)),`8f: ${fn} binds the proof to its command`);
    for(const [label,asset,size] of [['a small fleet',isolated,2048],['a parked asset',{...isolated,phase:'turnaround'}],['no retired route',{...isolated,releaseExclusiveRouteOnArrival:false}],['no route',{...isolated,routeId:null}]]){const t=make({size:size||5000});let seen=null;await t.go(asset,extra=>{seen=extra;});assert.deepEqual(seen,{},`8f: ${label}: as before`);assert.deepEqual(t.env.order,[],`8f: ${label}: no drain, hold or query`);}}
  console.log('8d ok: the held query (small fleet, held time, refusal) and the road answer guard; the repair-all hold; the retired-route proof');

  console.log('build700 ok');
})().catch(error=>{console.error(error);process.exit(1);});
