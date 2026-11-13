'use strict';
// Build 689 (owner: «نفذ بدقه مع اختبارات صارمة تمنع الثقل والمشاكل»; a play-through found a finished hotel opened with
// no team, so its walk-in demand was 0 until the player pressed «توظيف»): the team is hired when the property opens and
// when an expansion opens, by the very command that button sends. Proven on the real hospitality, HR, finance and
// command owners (tests/helpers/hospitality-fixture.cjs):
//  1. a hotel built day by day opens on its completion day with its team exactly (need = have, no gap), hired by the
//     opening (its hiring log names it), and earns walk-in nights that day;
//  2. the days after hire no one more, and the property's button hires no one more (no second contract);
//  3. an expansion opens with the extra team its rooms need, exactly, and only that;
//  4. a resort is staffed the same way;
//  5. a hiring that fails leaves the property open (as before this build), says so on the alerts, and the day goes on;
//  6. a property under construction is not staffed (no salary paid during the build).
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {hospitalityFixture}=require(path.join(ROOT,'tests/helpers/hospitality-fixture.cjs'));
const {s,state,H,command,advance}=hospitalityFixture(),HR=s.GH_HR_CORE;
const gapOf=id=>HR.snapshot(state,{},'hospitality').facilities.filter(row=>row.facilityId===H.read(state,'hospitality').properties.find(p=>p.id===id).facilityId).map(row=>[row.needed,row.have,row.missing]),gap=id=>JSON.parse(JSON.stringify(gapOf(id)));
const contracts=()=>HR.ensure(state).employmentContracts.filter(c=>c.status==='ساري').length;
const prop=id=>H.read(state,'hospitality').properties.find(p=>p.id===id);
// 1. built day by day
const quote=H.buildQuote(state,'hospitality',{kind:'hotel',capitalId:'RUH'}),built=command('start-property',{kind:'hotel',capitalId:'RUH',expectedCost:quote.cost});
assert.ok(built.completeDay>1,'a hotel takes days to build');
// 6. while it is built
advance(built.completeDay-1);assert.equal(prop(built.propertyId).status,'construction');assert.deepEqual(gap(built.propertyId),[],'6: no team while it is built');const beforeOpen=contracts();
advance(built.completeDay);
const opened=prop(built.propertyId);assert.equal(opened.status,'operating','1: it opens on its completion day');
const [need,have,missing]=gap(built.propertyId)[0];assert.ok(need>0);assert.equal(have,need,'1: its team is hired exactly');assert.equal(missing,0);
assert.ok(contracts()>beforeOpen,'1: with salary contracts');
assert.ok(HR.ensure(state).hiringLog.some(row=>JSON.stringify(row).includes('تعيين آلي عند التشغيل')),'1: the opening hired it');
const report=H.read(state,'hospitality').dailyReports?.[0]||H.read(state,'hospitality').lastReport||null;
// Review round 4: the header's claim 1 asserted (walk-in nights are earned once it opens staffed).
advance(built.completeDay+1);{const day=prop(built.propertyId).lastDay;assert.ok(day&&day.day>=built.completeDay&&day.occupied>0&&day.roomNet>0,`1: walk-in nights are earned once it opens staffed (${JSON.stringify(day&&{day:day.day,occupied:day.occupied})})`);}
// 2. no duplicate
const afterOpen=contracts();advance(built.completeDay+3);assert.equal(contracts(),afterOpen,'2: the next days hire no one more');
command('hire-property',{propertyId:built.propertyId});assert.equal(contracts(),afterOpen,'2: the button hires no one more');assert.deepEqual(gap(built.propertyId),[[need,need,0]]);
// 3. expansion
{const p=prop(built.propertyId),cost=Math.round(p.constructionCost*.4*p.rooms.reduce((a,b)=>a+b,0)/H.TYPES[p.kind].rooms.reduce((a,b)=>a+b,0)),x=command('expand-property',{propertyId:built.propertyId,expectedCost:cost});
  advance(x.completeDay-1);assert.deepEqual(gap(built.propertyId),[[need,need,0]],'3: the expansion is not staffed before it opens');
  advance(x.completeDay);const [need2,have2,missing2]=gap(built.propertyId)[0];assert.ok(need2>need,'3: the expansion needs more staff');assert.equal(have2,need2,'3: and hires exactly that');assert.equal(missing2,0);
  assert.ok(contracts()>afterOpen,'3: with its contracts');}
// The next properties are paid from the group's investor card (investor mode covers a shortfall; it changes no hiring).
state.godMoney=true;state.infiniteMoney=true;
// 4. a resort
{const q=H.buildQuote(state,'hospitality',{kind:'resort',capitalId:'AUH'}),r=command('start-property',{kind:'resort',capitalId:'AUH',expectedCost:q.cost});const a=H.accelerationQuote(state,'hospitality',r.propertyId);command('accelerate-construction',{propertyId:r.propertyId,expectedFee:a.fee,expectedCompleteDay:a.completeDay});
  const [n,h,m]=gap(r.propertyId)[0];assert.ok(n>0&&h===n&&m===0,'4: a resort opens staffed');}
// 5. a hiring that fails
{const q=H.buildQuote(state,'hospitality',{kind:'hotel',capitalId:'CAI'}),r=command('start-property',{kind:'hotel',capitalId:'CAI',expectedCost:q.cost});const a=H.accelerationQuote(state,'hospitality',r.propertyId);
  const original=HR.execute;HR.execute=()=>{throw new Error('build689-hr-down');};
  try{command('accelerate-construction',{propertyId:r.propertyId,expectedFee:a.fee,expectedCompleteDay:a.completeDay});}finally{HR.execute=original;}
  assert.equal(prop(r.propertyId).status,'operating','5: the property opens');assert.equal(gap(r.propertyId)[0][2]>0,true,'5: unstaffed, as before');
  assert.ok((state.alerts||[]).some(text=>String(text).includes('تعذر تعيين فريق')&&String(text).includes('لم يكتمل التوظيف')&&!String(text).includes('build689-hr-down')),'5: and the alerts say so');
  command('hire-property',{propertyId:r.propertyId});assert.equal(gap(r.propertyId)[0][2],0,'5: the button still staffs it');}
// 5b. review (two readers): a hiring that writes the staff and its contract and then refuses (hr-hiring-incomplete) is
// undone whole: the facility's staff row as before the opening and no contract added
{const q=H.buildQuote(state,'hospitality',{kind:'hotel',capitalId:'CAI'}),r=command('start-property',{kind:'hotel',capitalId:'CAI',expectedCost:q.cost});const a=H.accelerationQuote(state,'hospitality',r.propertyId);
  const fid=prop(r.propertyId).facilityId,rowBefore=JSON.stringify(state.advanced.facilities[fid]),contracts=JSON.stringify(state.advanced.labor?.employmentContracts||[]);
  const teamAlert=text=>String(text).includes('تعذر تعيين فريق')&&String(text).includes('لم يكتمل التوظيف'),alertsBefore=(state.alerts||[]).filter(teamAlert).length;
  const original=HR.execute;let wrote=false;HR.execute=(ctx,cmd,p)=>{const out=original(ctx,cmd,p);wrote=(out?.total||0)>0;throw new Error('hr-hiring-incomplete');};
  try{command('accelerate-construction',{propertyId:r.propertyId,expectedFee:a.fee,expectedCompleteDay:a.completeDay});}finally{HR.execute=original;}
  assert.equal(wrote,true,'5b: the hiring had written its staff before refusing');assert.equal(prop(r.propertyId).status,'operating','5b: the property opens');
  assert.equal(JSON.stringify(state.advanced.facilities[fid]),rowBefore,'5b: the staff row is as before');assert.equal(JSON.stringify(state.advanced.labor?.employmentContracts||[]),contracts,'5b: no contract was left');
  // Review round 10 (a reader: part 5's alert has the same Arabic words, so a search over all alerts passed with no 5b alert):
  // exactly one more such alert after this opening, and no alert carries the raw code.
  assert.equal((state.alerts||[]).filter(teamAlert).length,alertsBefore+1,'5b: this opening adds its own alert, in Arabic');assert.ok(!(state.alerts||[]).some(text=>/hr-hiring-incomplete/.test(String(text))),'5b: no alert carries the raw code');
  command('hire-property',{propertyId:r.propertyId});assert.equal(gap(r.propertyId)[0][2],0,'5b: the button staffs it once');}
// the source: one hire at the opening and one at an expansion, through the button's command
{const source=fs.readFileSync(path.join(ROOT,'WebApp/hospitality-core.js'),'utf8');
  assert.match(source,/HOSP-OPEN-\$\{property\.id\}`\);hireTeam\(s,property\);return true;/);assert.match(source,/if\(property\.status==='operating'\)hireTeam\(s,property\);/);
  assert.match(source,/const facilities=s\.advanced\?\.facilities\|\|null,id=property\.facilityId,/);assert.match(source,/hr\.execute\(\{state:s,facilityId:id,getDynamicFacilities:\(\)=>\[site\]\},'hire',\{company:property\.companyId,scope:'facility'/);}
console.log(JSON.stringify({suite:'build689-hotel-team-at-opening',ok:true,need,contractsOpened:afterOpen}));
