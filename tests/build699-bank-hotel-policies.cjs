'use strict';
// Build 699, plan batch 3 (the owner: «لاتخلي شي من الخطه نفذه بدقه»):
//   1. the bank's housekeeping (banking set-housekeeping): the corporate credit limits are reviewed by the autopilot every
//      30 days through review-limits (the button's command); not before 30 days; nothing without the policy; with it the
//      daily liquidity management runs as set-auto-liquidity on;
//   2. hotel maintenance by policy (hospitality set-repair-policy): a property below the policy's condition (preventive 90,
//      standard 80, deferred 65) or with an incident is repaired by the autopilot through repair-property at its quote;
//      one above the threshold is not; a company the cash does not cover waits; the button and the autopilot share one
//      quote formula (repairCost);
//   3. both policies need the autopilot.
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||require('path').resolve(__dirname,'..');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{scenario}=require('./helpers/business-scenario'),{hospitalityFixture}=require('./helpers/hospitality-fixture.cjs');
const ROOT=process.env.GH_TEST_SOURCE_DIR,DAY=86400;

// 1.
{const e=scenario();for(const n of ['banking-core','company-autopilot-core'])e.load(n);e.command('corporate','open-company',{type:'bank',capital:400000000,legalName:'House Bank'});
  e.command('corporate','open-company',{type:'air',capital:200000000,legalName:'House Air'});const {s,state}=e,B=s.GH_BANKING_CORE,P=s.GH_COMPANY_AUTOPILOT;B.ensure(state);
  const step=(tried=new Set())=>P.next(state,'housekeeping',{F:s.GH_FINANCE_CORE,tried});
  assert.equal(step(),null,'1: without the policy nothing is planned');
  e.command('banking','set-housekeeping',{enabled:true});assert.equal(state.bank.housekeeping,true,'1: the policy is saved');
  // The clients are reviewed when the bank books them; the first review is due 30 days after.
  assert.equal(B.limitsReviewDue(state),Object.keys(state.bank.corporateClients||{}).length===0,'1: a bank with fresh reviews is not due');if(!B.limitsReviewDue(state))state.simSeconds+=30*DAY;
  const tried=new Set(),review=step(tried);assert.equal(JSON.stringify(review.commands),JSON.stringify([{domain:'banking',name:'review-limits',payload:{}}]),'1: the review, by the button\'s command');assert.equal(step(tried),null,'1: once a day');
  s.GH_DOMAIN_COMMANDS.dispatchSystem({state},'banking','review-limits',{},{actor:P.ACTOR});assert.equal(B.limitsReviewDue(state),false,'1: reviewed now: not due');
  state.simSeconds+=29*DAY;assert.equal(step(),null,'1: not before 30 days');state.simSeconds+=DAY;assert.ok(step(),'1: due again after 30 days');
  e.command('banking','set-housekeeping',{enabled:false});assert.equal(state.bank.housekeeping,undefined);assert.equal(step(),null,'1: the policy removed, nothing planned');
  const src=fs.readFileSync(path.join(ROOT,'WebApp','banking-core.js'),'utf8');assert.ok(src.includes("    if(!treasuryOn(state))return null;")&&src.includes("return bank.housekeeping===true&&bank.autoLiquidityOff!==true&&globalThis.GH_PROGRESSION_CORE?.unlocked?.(state,'tool:autopilot')!==false;"),'1: the daily liquidity management runs under the policy while the autopilot is unlocked (behaviour: build700 part 4)');
  assert.ok(src.includes("function setHousekeeping(state,p){if(p.enabled===true&&globalThis.GH_PROGRESSION_CORE?.unlocked?.(state,'tool:autopilot')===false)throw new Error('autopilot-locked');"),'3: the policy needs the autopilot');}
console.log('1 ok: bank housekeeping');

// 2.
{const f=hospitalityFixture(),{s,state,H,F,command}=f;f.load('company-autopilot-core');const P=s.GH_COMPANY_AUTOPILOT;state.godMoney=true;state.infiniteMoney=true;
  const a=f.property('hotel','RUH'),b=f.property('hotel','CAI');const step=(tried=new Set())=>P.next(state,'repairs',{F,tried});
  const live=id=>H.read(state,'hospitality').properties.find(p=>p.id===id);
  live(a.id).condition=75;live(b.id).condition=85;
  assert.equal(step(),null,'2: without a policy nothing is planned');
  command('set-repair-policy',{policy:'standard'});assert.equal(H.read(state,'hospitality').repairPolicy,'standard','2: the policy is saved');
  const tried=new Set(),first=step(tried),cost=H.repairCost(live(a.id));
  assert.equal(JSON.stringify(first.commands),JSON.stringify([{domain:'hospitality',name:'repair-property',payload:{companyId:'hospitality',propertyId:a.id,expectedCost:cost}}]),'2: the property below 80% at its quote');
  assert.equal(step(tried),null,'2: the one at 85% is not repaired under the standard policy');
  s.GH_DOMAIN_COMMANDS.dispatchSystem({state},'hospitality','repair-property',first.commands[0].payload,{actor:P.ACTOR});assert.equal(live(a.id).condition,100,'2: repaired by the owner\'s command');
  command('set-repair-policy',{policy:'preventive'});const second=step();assert.equal(second.commands[0].payload.propertyId,b.id,'2: under the preventive policy 85% is repaired');
  live(b.id).condition=99;live(b.id).outOfService=2;command('set-repair-policy',{policy:'deferred'});assert.equal(step().commands[0].payload.propertyId,b.id,'2: an incident (rooms out of service) is repaired under any policy');
  state.godMoney=false;state.infiniteMoney=false;F.book(state,'hospitality').accounts[0].balance=1;F.reconcile(state);assert.equal(step(),null,'2: a company the cash does not cover waits');
  command('set-repair-policy',{policy:'off'});assert.equal(H.read(state,'hospitality').repairPolicy,undefined,'2: off removes the policy');
  const core=fs.readFileSync(path.join(ROOT,'WebApp','hospitality-core.js'),'utf8'),ui=fs.readFileSync(path.join(ROOT,'WebApp','hospitality-ui.js'),'utf8');
  assert.ok(core.includes('      const cost=repairCost(property);')&&ui.includes('payload.expectedCost=H().repairCost(p);'),'2: the command and the button share the quote');
  assert.ok(core.includes("if(cmd==='set-repair-policy'){if(String(p.policy||'')!=='off'&&globalThis.GH_PROGRESSION_CORE?.unlocked?.(s,'tool:autopilot')===false)throw new Error('autopilot-locked');"),'3: the policy needs the autopilot');}
console.log('2 ok: hotel maintenance by policy');
{const app=fs.readFileSync(path.join(ROOT,'WebApp','app.js'),'utf8');const decisionKinds=text=>{const m=text.match(/AUTOPILOT_DECISION_KINDS=new Set\(\[([^\]]*)\]\)/);return m?m[1].split(',').map(x=>x.trim().replace(/'/g,'')):[];};assert.ok(['housekeeping','repairs'].every(k=>decisionKinds(app).includes(k)),'3: the autopilot runs both only when unlocked');assert.ok(app.includes("housekeeping:'bank',repairs:'hospitality'})"),'3: each in its owner\'s transaction scope');}
console.log('build699 ok');
