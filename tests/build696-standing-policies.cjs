'use strict';
// Build 696, plan batch 3 and decision 1 (the owner: «لاتخلي شي من الخطه نفذه بدقه»):
//   1. standing campaigns: a company whose campaign keeps running (corporate set-campaign-standing) has it launched again
//      by the autopilot through its own company-wide command once branches end theirs: one cheque, the same quote and
//      branches as a press; nothing while campaigns run, nothing when the cash does not cover it, nothing for a company
//      without the policy; the policy is refused without the autopilot (a career below level 7 without Plus); the step
//      replayed is idempotent (the reference of the day and quote);
//   2. energy automatic maintenance: with the autopilot it is on until the player turns it off (an explicit choice is
//      kept either way); without it it stays off unless turned on, as before;
//   3. decision 1: Mobility's «صيانة وشحن» button is gone (it only wrote an invoice and a cheque: a car's condition never
//      wears and its battery recharges by itself); the command is kept for saves and scripts.
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||require('path').resolve(__dirname,'..');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{scenario}=require('./helpers/business-scenario');
const ROOT=process.env.GH_TEST_SOURCE_DIR,DAY=86400;
function setup(){const e=scenario();e.command('finance','credit',{company:'group',amount:2000000000,taxable:false,reference:'QA-STANDING-CAPITAL'});
  for(const n of ['branch-campaign-core','banking-core','insurance-core','customer-companies-core','customer-base-core','telecom-market-core','dealer-market-core','company-autopilot-core'])e.load(n);
  for(const company of ['telecom','dealership'])e.command('corporate','open-company',{type:company,capital:200000000,legalName:'Standing '+company});
  for(const [company,kind] of [['telecom','telecom-branch'],['dealership','dealership-branch']])for(let i=0;i<3;i++)e.state.customHubs.push({id:`QA-${company}-${i}`,kind,ownerCompanyId:company,owned:true,city:'الرياض',country:'السعودية',coords:[24+i*.01,46]});
  return e;}
const step=(e,tried=new Set())=>e.s.GH_COMPANY_AUTOPILOT.next(e.state,'campaigns',{F:e.s.GH_FINANCE_CORE,tried});
const run=(e,s)=>e.s.GH_TRANSACTION_CORE.execute(e.state,{label:'qa-standing',apply:()=>s.commands.map(c=>e.s.GH_DOMAIN_COMMANDS.dispatchSystem({state:e.state},c.domain,c.name,c.payload,{actor:e.s.GH_COMPANY_AUTOPILOT.ACTOR}).result)}).value;

// 1.
{const e=setup(),{s,state}=e,T=s.GH_TELECOM_MARKET;
  assert.equal(step(e),null,'1: no company with the policy, no step');
  e.command('corporate','set-campaign-standing',{companyId:'telecom',enabled:true});assert.equal(state.advanced.companies.telecom.campaignStanding,true,'1: the policy is saved');
  const q=T.campaignQuote(state);assert.equal(q.count,3,'1: three branches await a campaign');
  const first=step(e);assert.equal(JSON.stringify(first.commands),JSON.stringify([{domain:'customer-companies',name:'telecom-branches-campaign',payload:{company:'telecom',companyId:'telecom',reference:`AUTO-CAMPAIGN-telecom-${q.day}-${q.quoteKey.slice(0,24)}`,quoteKey:q.quoteKey}}]),'1: the company-wide command with the quote of the day');
  const cheques=state.finance.cheques.length,cash=s.GH_FINANCE_CORE.operating(state,'telecom'),out=run(e,first)[0];
  assert.equal(out.count,3);assert.equal(state.finance.cheques.length,cheques+1,'1: one cheque');assert.equal(Math.round((cash-s.GH_FINANCE_CORE.operating(state,'telecom'))*100),Math.round(q.total*100),'1: the quoted total');
  for(const row of T.ensure(state).branches)assert.equal(row.campaignUntil,q.until,'1: every branch runs 30 days');
  assert.equal(run(e,first)[0].idempotent,true,'1: the same step replayed is idempotent');assert.equal(state.finance.cheques.length,cheques+1);
  assert.equal(step(e),null,'1: nothing while the campaigns run');
  state.simSeconds=(q.until+1)*DAY;const again=step(e);assert.ok(again,'1: after 30 days the campaign is launched again');assert.notEqual(again.commands[0].payload.reference,first.commands[0].payload.reference,'1: with the reference of that day');
  // The dealership has no policy: nothing for it.
  assert.ok(!again.commands.some(c=>c.payload.company==='dealership'));const tried=new Set();step(e,tried);assert.ok(!tried.has('campaigns:dealership'),'1: a company without the policy is not looked at');
  // Cash short: nothing that day.
  state.godMoney=false;state.infiniteMoney=false;const book=s.GH_FINANCE_CORE.book(state,'telecom').accounts[0];book.balance=1;s.GH_FINANCE_CORE.reconcile(state);assert.equal(step(e),null,'1: a company the cash does not cover waits');
  e.command('corporate','set-campaign-standing',{companyId:'telecom',enabled:false});assert.equal(state.advanced.companies.telecom.campaignStanding,undefined,'1: the policy is removed');}
{const e=setup();e.load('progression-core');e.state.progression={mode:'career',level:2,xp:0};const P=e.s.GH_PROGRESSION_CORE;
  assert.equal(P.unlocked(e.state,'tool:autopilot'),false,'1: a career at level 2 without Plus has no autopilot');assert.throws(()=>e.command('corporate','set-campaign-standing',{companyId:'telecom',enabled:true}),/autopilot-locked/,'1: refused without the autopilot');assert.equal(e.state.advanced.companies?.telecom?.campaignStanding,undefined,'1: nothing saved');
  const corporate=fs.readFileSync(path.join(ROOT,'WebApp','corporate-core.js'),'utf8');assert.ok(corporate.includes("if(payload.enabled===true&&globalThis.GH_PROGRESSION_CORE?.unlocked?.(state,'tool:autopilot')===false)throw new Error('autopilot-locked');"),'1: the command checks the autopilot');
  const app=fs.readFileSync(path.join(ROOT,'WebApp','app.js'),'utf8');const decisionKinds=text=>{const m=text.match(/AUTOPILOT_DECISION_KINDS=new Set\(\[([^\]]*)\]\)/);return m?m[1].split(',').map(x=>x.trim().replace(/'/g,'')):[];};assert.ok(decisionKinds(app).includes('campaigns'),'1: the autopilot runs the step only when unlocked, as its decisions');}
console.log('1 ok: standing campaigns');

// 2.
{const h=require('./helpers/core-harness').harness(['energy-core']);const E=h.s.GH_ENERGY_CORE;assert.equal(typeof E.autoMaintenanceOn,'function');
  const state=o=>({energy:{...o},progression:undefined});
  h.s.GH_PROGRESSION_CORE={unlocked:()=>true};assert.equal(E.autoMaintenanceOn(state({})),true,'2: with the autopilot, on by default');assert.equal(E.autoMaintenanceOn(state({autoMaintenance:false})),false,'2: an explicit off is kept');
  h.s.GH_PROGRESSION_CORE={unlocked:()=>false};assert.equal(E.autoMaintenanceOn(state({})),false,'2: without the autopilot, off by default');assert.equal(E.autoMaintenanceOn(state({autoMaintenance:true})),true,'2: an explicit on is kept');
  const src=fs.readFileSync(path.join(ROOT,'WebApp','energy-core.js'),'utf8');assert.ok(src.includes("    if(!autoMaintenanceOn(state))return null;"),'2: the daily automatic maintenance reads the policy');
  const adv=fs.readFileSync(path.join(ROOT,'WebApp','advanced-core.js'),'utf8');assert.ok(adv.includes("const autoOn=typeof core.autoMaintenanceOn==='function'?core.autoMaintenanceOn(ctx.state):energy.autoMaintenance===true;"),'2: the operations page shows the same');}
// Review round 4: maintenance booked by the default (the player never chose) says so once, with where to turn it off; an
// explicit choice says nothing.
{const src=fs.readFileSync(path.join(ROOT,'WebApp','energy-core.js'),'utf8'),at=src.indexOf('  function autoMaintenance(state,energy,day){'),end=src.indexOf('\n  }\n',at)+4;assert.ok(at>0);
  const make=Function('env',`'use strict';const autoMaintenanceOn=()=>true,performanceLoss=()=>20,AUTO_MAINTENANCE_LOSS=5,AUTO_MAINTENANCE_LEAD_DAYS=3,num=Number,maintenanceQuote=()=>({cost:10}),scheduleMaintenance=env.schedule,globalThis={GH_FINANCE_CORE:{operating:()=>1e9,investorMode:()=>false},GH_OPERATIONS_CORE:env.ops};${src.slice(at,end)};return autoMaintenance;`);
  const run=choice=>{const energy={maintenancePlans:[],sites:[{id:'P1',name:'Plant One',commissioned:true}],...(choice===undefined?{}:{autoMaintenance:choice})},state={alerts:[],energy},fn=make({schedule:()=>{const plan={id:'M'+energy.maintenancePlans.length,status:'مجدولة'};return plan;}});fn(state,energy,10);fn(state,energy,11);return state.alerts;};
  const alerts=run(undefined);assert.equal(alerts.length,1,'2: one notice, the first time');assert.match(alerts[0],/يمكن إيقافها من صفحة الطاقة/);assert.equal(run(true).length,0,'2: the player\'s own choice: no notice');
  // Review round 6: with the operations owner loaded the notice goes through its record-alert (cap, event log, repeats).
  {const energy={maintenancePlans:[],sites:[{id:'P1',name:'Plant One',commissioned:true}]},state={alerts:[],energy},sent=[];make({schedule:()=>({id:'M1'}),ops:{execute:(ctx,cmd,p)=>{sent.push([cmd,p.text]);}}})(state,energy,10);
    assert.equal(sent.length,1);assert.equal(sent[0][0],'record-alert','2: through record-alert');assert.equal(state.alerts.length,0,'2: not written around it');}}
console.log('2 ok: energy automatic maintenance');

// 3.
{const app=fs.readFileSync(path.join(ROOT,'WebApp','app.js'),'utf8'),mobility=fs.readFileSync(path.join(ROOT,'WebApp','mobility-core.js'),'utf8');
  assert.ok(!app.includes('service-mobility-asset'),'3: the button and its binding are gone');assert.ok(!app.includes('>صيانة وشحن<'),'3: no «صيانة وشحن» label');
  assert.ok(/if\(cmd==='service-vehicle'\)return serviceVehicle\(ctx,p\);/.test(mobility),'3: the command is kept');}
console.log('build696 ok');
