'use strict';
// Build 698, plan batch 3 (the owner: «لاتخلي شي من الخطه نفذه بدقه»): research and renewals that continue. With the
// policy (governance set-continuation-policy) the autopilot, through the governance owner's own commands:
//   1. funds the next phase of a research project already under way (a phase done, under 100%), not one never started
//      nor one complete, nor one with a phase running;
//   2. renews the cyber drill when cover is below 60% and the last drill is 30 days old, not sooner;
//   3. renews the safety audit when its plan has ended, not before;
//   4. pays from the holding only when its cash covers it; does nothing without the policy; the policy needs the autopilot.
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||require('path').resolve(__dirname,'..');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{scenario}=require('./helpers/business-scenario');
const ROOT=process.env.GH_TEST_SOURCE_DIR,DAY=86400;
function world(){const e=scenario();for(const n of ['governance-core','company-autopilot-core'])e.load(n);const {s,state}=e;s.GH_GOVERNANCE_CORE.ensure(state);
  state.simSeconds=200*DAY;state.research=state.research&&Object.keys(state.research).length?state.research:{efficiency:0,automation:0,cleanEnergy:0};const ids=Object.keys(state.research);assert.ok(ids.length>=3,'research projects exist (the app\'s three)');
  state.advanced.researchPrograms={[ids[0]]:{spent:1,rounds:1,history:[],status:'بحث',phase:null},[ids[1]]:{spent:0,rounds:0,history:[],status:'بحث',phase:null},[ids[2]]:{spent:4,rounds:4,history:[],status:'تشغيل',phase:null}};
  state.research[ids[0]]=25;state.research[ids[1]]=0;state.research[ids[2]]=100;
  state.advanced.cyber=Object.assign(state.advanced.cyber||{},{coverage:40,lastDrillDay:150,events:[]});state.advanced.safety=Object.assign(state.advanced.safety||{},{plan:{startDay:10,untilDay:190}});
  return {e,s,state,ids};}
const plan=(w,tried=new Set())=>w.s.GH_COMPANY_AUTOPILOT.next(w.state,'continuation',{F:w.s.GH_FINANCE_CORE,tried});
const run=(w,step)=>step.commands.map(c=>w.s.GH_DOMAIN_COMMANDS.dispatchSystem({state:w.state},c.domain,c.name,c.payload,{actor:w.s.GH_COMPANY_AUTOPILOT.ACTOR}));

// 1-3.
{const w=world();assert.equal(plan(w),null,'4: without the policy nothing is planned');
  w.e.command('governance','set-continuation-policy',{enabled:true});assert.equal(w.state.advanced.continuation,true,'4: the policy is saved');
  const tried=new Set(),first=plan(w,tried);assert.equal(JSON.stringify(first.commands),JSON.stringify([{domain:'governance',name:'research-fund',payload:{project:w.ids[0]}}]),'1: the next phase of the project under way');
  const second=plan(w,tried);assert.equal(second.commands[0].name,'cyber-drill','2: then the cyber drill (cover 40%, 50 days since the last)');
  const third=plan(w,tried);assert.equal(third.commands[0].name,'safety-audit','3: then the safety audit (its plan ended on day 190)');
  assert.equal(plan(w,tried),null,'1: not the project never started nor the complete one');
  for(const step of [first,second,third]){const out=run(w,step);assert.ok(out.every(r=>r.ok),`the owner accepts ${step.commands[0].name}`);}
  assert.ok(w.state.advanced.researchPrograms[w.ids[0]].phase,'1: the phase is running');assert.equal(plan(w),null,'1-3: nothing more today: a phase runs, the drill and the audit are fresh');}
// Review round 4: the day before each limit is not enough (the drill at 29 days, the audit plan ending tomorrow).
{const w=world();w.state.advanced.cyber.lastDrillDay=171;w.state.advanced.safety.plan.untilDay=201;w.e.command('governance','set-continuation-policy',{enabled:true});
  const tried=new Set();plan(w,tried);assert.equal(plan(w,tried),null,'2-3: a drill 29 days old and an audit plan ending tomorrow are not renewed');}
{const w=world();w.state.advanced.cyber.lastDrillDay=185;w.state.advanced.safety.plan.untilDay=260;w.e.command('governance','set-continuation-policy',{enabled:true});
  const tried=new Set();plan(w,tried);assert.equal(plan(w,tried),null,'2-3: a drill 15 days old and an audit plan still running are not renewed');}
// 4.
{const w=world();w.e.command('governance','set-continuation-policy',{enabled:true});w.state.godMoney=false;w.state.infiniteMoney=false;const F=w.s.GH_FINANCE_CORE;F.book(w.state,'group').accounts[0].balance=1000;F.reconcile(w.state);
  assert.equal(plan(w),null,'4: the holding\'s cash does not cover any: nothing is planned');
  w.e.command('governance','set-continuation-policy',{enabled:false});assert.equal(w.state.advanced.continuation,undefined,'4: the policy is removed');}
{const gov=fs.readFileSync(path.join(ROOT,'WebApp','governance-core.js'),'utf8'),app=fs.readFileSync(path.join(ROOT,'WebApp','app.js'),'utf8');
  assert.ok(gov.includes("if(cmd==='set-continuation-policy'){if(p.enabled===true&&globalThis.GH_PROGRESSION_CORE?.unlocked?.(s,'tool:autopilot')===false)throw new Error('autopilot-locked');"),'4: the policy needs the autopilot');
  const decisionKinds=text=>{const m=text.match(/AUTOPILOT_DECISION_KINDS=new Set\(\[([^\]]*)\]\)/);return m?m[1].split(',').map(x=>x.trim().replace(/'/g,'')):[];};const scope=require('./helpers/autopilot-scope.cjs').autopilotScope(ROOT).autopilotScope({kind:'continuation'});assert.ok(decisionKinds(app).includes('continuation')&&['advanced','research'].every(root=>scope.includes(root)),'4: run only when unlocked, inside a transaction that covers research and advanced');}
console.log('build698 ok');
