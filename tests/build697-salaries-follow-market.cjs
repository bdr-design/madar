'use strict';
// Build 697, plan batch 3 (the owner: «لاتخلي شي من الخطه نفذه بدقه»): crew pay that follows the market. Market wages rise
// about 3% a year and a company paying below them loses crews faster; a company with the policy has its pay level raised
// by the autopilot, never lowered, to the first allowed level at or above the market wage, through set-salary-index. On
// the real HR, realism and autopilot owners:
//   1. without the policy nothing is planned; with it, a market at 1.07 and pay at 100% raises the pay to 110%, once;
//   2. never lowered: a market below the pay plans nothing; the highest level (130%) caps a market above it;
//   3. the raise is the button's own command (the same history and payroll index), and the step is not taken twice a day;
//   4. the policy is saved and removed by its command, which needs the autopilot (as the other policies).
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||require('path').resolve(__dirname,'..');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{scenario}=require('./helpers/business-scenario');
const ROOT=process.env.GH_TEST_SOURCE_DIR;
const e=scenario();e.load('company-autopilot-core');const {s,state}=e,H=s.GH_HR_CORE,P=s.GH_COMPANY_AUTOPILOT;
e.command('corporate','open-company',{type:'air',capital:200000000,legalName:'Pay Air'});H.ensure(state);
const step=(tried=new Set())=>P.next(state,'salaries',{F:s.GH_FINANCE_CORE,tried});
const policy=()=>state.advanced.labor.salaryPolicy.air;
const market=value=>{state.realism=state.realism||{};state.realism.economy=state.realism.economy||{};state.realism.economy.wageIndex=value;};

// 1.
market(1.07);assert.equal(H.salaryMultiplier(state,'air'),1);assert.equal(H.marketSalaryLevel(state,'air'),1.1,'1: the first level at or above 1.07 is 110%');
assert.equal(step(),null,'1: without the policy nothing is planned');
e.command('hr','set-salary-follow-market',{company:'air',enabled:true});assert.equal(policy().followMarket,true,'4: the policy is saved');
const tried=new Set(),raise=step(tried);assert.equal(JSON.stringify(raise.commands),JSON.stringify([{domain:'hr',name:'set-salary-index',payload:{company:'air',index:1.1}}]),'1: one raise to 110%, by the button\'s command');
assert.equal(step(tried),null,'3: not taken twice a day');
// 3.
const history=(policy().history||[]).length;s.GH_DOMAIN_COMMANDS.dispatchSystem({state},raise.commands[0].domain,raise.commands[0].name,raise.commands[0].payload,{actor:P.ACTOR});
assert.equal(H.salaryMultiplier(state,'air'),1.1,'3: the pay is 110%');assert.equal((policy().history||[]).length,history+1,'3: with its history row, as a press');
assert.equal(step(),null,'1: at the market nothing more is planned');
// 2.
market(.92);assert.equal(step(),null,'2: never lowered');
market(1.5);const capped=step();assert.equal(capped.commands[0].payload.index,1.3,'2: the highest level caps the raise');
s.GH_DOMAIN_COMMANDS.dispatchSystem({state},'hr','set-salary-index',{company:'air',index:1.3},{actor:P.ACTOR});assert.equal(step(),null,'2: at the highest level nothing more');
// 4.
e.command('hr','set-salary-follow-market',{company:'air',enabled:false});assert.equal(policy().followMarket,undefined,'4: the policy is removed');market(2);assert.equal(step(),null,'4: and nothing is planned');
{const hr=fs.readFileSync(path.join(ROOT,'WebApp','hr-core.js'),'utf8'),app=fs.readFileSync(path.join(ROOT,'WebApp','app.js'),'utf8');
  assert.ok(hr.includes("function setSalaryFollowMarket(state,p){const hr=ensure(state),company=salaryCompany(state,p.company);if(p.enabled===true&&globalThis.GH_PROGRESSION_CORE?.unlocked?.(state,'tool:autopilot')===false)throw new Error('autopilot-locked');"),'4: the policy needs the autopilot');
  const decisionKinds=text=>{const m=text.match(/AUTOPILOT_DECISION_KINDS=new Set\(\[([^\]]*)\]\)/);return m?m[1].split(',').map(x=>x.trim().replace(/'/g,'')):[];};assert.ok(decisionKinds(app).includes('salaries'),'4: the autopilot runs the step only when unlocked');const {autopilotScope:scopeOf}=require('./helpers/autopilot-scope.cjs').autopilotScope(ROOT),scope=scopeOf({kind:'salaries',company:'air'});assert.ok(scope.includes('advanced'),'3: the step\'s transaction covers the HR state (advanced.labor)');assert.ok(!['insurance','realEstate','customerCompanies','bank','hospitality'].some(root=>scope.includes(root)),'3: and no company domain');}
console.log('build697 ok');
