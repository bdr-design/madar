'use strict';
// Build 674, from the play-through (the owner: none of this is intended). What the texts and two commands said or did:
//   a. counts written with one fixed noun: «1 شركات», «عُيّن 15 مديرين», «وُزعت 6 طائرة», «جُدولت 12 شاحنة»;
//   b. «تعيين الجميع» gave one person several companies (15 companies, 12 people): each company took the strongest of
//      its own candidates, and the candidates of different companies are drawn from one pool of people;
//   c. a start task's button opened the companies page on the holding's tab, and the directory unfiltered: the task
//      named its page and no place on it;
//   d. money with no bound was written «$InfinityT»;
//   e. an English word inside an Arabic message («اكتمل Commissioning لمشروع»), a verb that did not agree with a
//      product's name («فُعّل ...»), «ذريًا» in the player's messages, «لشركة شركة ...».
// Checked here:
//   1. the four counted nouns the texts need (مدير، طائرة، سفينة، شاحنة) in every Arabic number category, and in English;
//   2. «تعيين الجميع» with fifteen companies appoints fifteen different people; the company whose candidates were both
//      taken makes an earlier one move to its next candidate; a person who manages a company already is neither moved
//      nor appointed again; one company alone still takes its strongest candidate; when no arrangement exists (two
//      companies, one candidate, the same person) both are appointed as before; the state stays valid;
//   3. the first steps of a career carry their place (the subsidiaries tab, the logistics company's sites) through
//      GH_UI_QUALITY's task list; a task with no place carries none;
//   4. fmtMoney (app.js) writes ∞ for unbounded money and every other amount as before;
//   5. the messages no longer carry the fixed nouns, the English word or «ذريًا».
const path=require('node:path'),fs=require('node:fs'),vm=require('node:vm');
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const assert=require('node:assert/strict');
const {scenario}=require('./helpers/business-scenario'),{harness}=require('./helpers/core-harness');
const ROOT=process.env.GH_TEST_SOURCE_DIR,source=name=>fs.readFileSync(path.join(ROOT,'WebApp',name),'utf8');

// 1. Counted nouns.
{const h=harness([]);h.load('arabic-copy-core');const A=h.s.GH_ARABIC_COPY,forms=noun=>[0,1,2,3,10,11,15,99,100,101].map(n=>A.count(n,noun));
  assert.deepEqual(forms('manager'),['لا مديرين','مدير واحد','مديران','3 مديرين','10 مديرين','11 مديرًا','15 مديرًا','99 مديرًا','100 مدير','101 مدير'],'1: مدير');
  assert.deepEqual(forms('aircraft'),['لا طائرات','طائرة واحدة','طائرتان','3 طائرات','10 طائرات','11 طائرةً','15 طائرةً','99 طائرةً','100 طائرة','101 طائرة'],'1: طائرة');
  assert.deepEqual(forms('ship'),['لا سفن','سفينة واحدة','سفينتان','3 سفن','10 سفن','11 سفينةً','15 سفينةً','99 سفينةً','100 سفينة','101 سفينة'],'1: سفينة');
  assert.deepEqual(forms('truck'),['لا شاحنات','شاحنة واحدة','شاحنتان','3 شاحنات','10 شاحنات','11 شاحنةً','15 شاحنةً','99 شاحنةً','100 شاحنة','101 شاحنة'],'1: شاحنة');
  for(const [noun,one,many] of [['manager','manager','managers'],['aircraft','aircraft','aircraft'],['ship','ship','ships'],['truck','truck','trucks']])assert.deepEqual(Array.from(A.FORMS_EN[noun]),[one,many],`1: ${noun} in English`);
  for(const noun of Object.keys(A.FORMS))assert.ok(Array.isArray(A.FORMS_EN[noun])||typeof A.FORMS_EN[noun]==='object',`1: ${noun} has its English forms`);}
console.log('1 ok: مدير، طائرة، سفينة، شاحنة are counted in every category');

// 2. «تعيين الجميع».
const openAll=()=>{const w=scenario(),{s,state,command}=w;state.godMoney=true;state.infiniteMoney=true;
  for(const definition of s.GH_COMPANY_DEFINITIONS.list()){if(definition.id==='group'||state.openedCompanies.includes(definition.id))continue;command('corporate','open-company',{type:definition.id,capital:400000000,legalName:`Test ${definition.id}`});}return w;};
const strongest=(H,state,company)=>H.officialManagerCandidates(state,company).slice().sort((a,b)=>b.skill-a.skill||b.experience-a.experience||a.salary-b.salary||String(a.id).localeCompare(String(b.id)));
{const {s,state,command}=openAll(),H=s.GH_HR_CORE,companies=Array.from(state.openedCompanies);assert.equal(companies.length,15,'2: fifteen companies are open');
  // The shape that produced the defect is in the data: the strongest candidates of the fifteen are twelve people.
  const first=companies.map(company=>strongest(H,state,company)[0].name);assert.ok(new Set(first).size<companies.length,'2: several companies share their strongest candidate');
  const out=command('hr','appoint-all-official-managers',{termMonths:12}),names=Array.from(out.appointments).map(row=>row.name);
  assert.deepEqual({appointed:out.appointed,skipped:out.skipped,companies:Array.from(out.companies)},{appointed:15,skipped:0,companies},'2: every company is given a manager, in the companies\' order');
  assert.equal(new Set(names).size,15,`2: fifteen different people (${names.join('، ')})`);
  for(const company of companies){const manager=H.officialManager(state,company),candidates=strongest(H,state,company);assert.ok(candidates.some(row=>row.id===manager.candidateId&&row.name===manager.name),`2: ${company} is managed by one of its own candidates`);}
  // The first company in the order is not asked to move when nothing needs its person.
  assert.equal(H.officialManager(state,companies[0]).candidateId,strongest(H,state,companies[0])[0].id,'2: the first company keeps its strongest candidate');
  const again=command('hr','appoint-all-official-managers');assert.deepEqual({appointed:again.appointed,skipped:again.skipped},{appointed:0,skipped:15},'2: a second press appoints nobody');
  assert.deepEqual(companies.map(company=>H.officialManager(state,company).name),names,'2: and moves nobody');const valid=s.GH_SAVE_SCHEMA.validate(state);assert.ok(valid.ok,JSON.stringify(valid.errors));}
{// A person who manages a company already is not moved and is given no second company while another arrangement exists.
  // Every seat of every shared person is tried in one world (the managers are dismissed between tries); the most
  // different people any arrangement could give is counted here by trying every choice.
  const {s,state,command}=openAll(),H=s.GH_HR_CORE,companies=Array.from(state.openedCompanies),lists=new Map(companies.map(company=>[company,strongest(H,state,company).map(row=>({id:row.id,name:row.name}))])),seats=[];
  for(const [company,rows] of lists)for(const row of rows)if([...lists.values()].filter(other=>other.some(item=>item.name===row.name)).length>=2)seats.push({company,...row});
  assert.ok(seats.length>=8,`2: the shared people have ${seats.length} seats`);
  const most=(pinned,free)=>{let best=0;const walk=(index,names)=>{if(index===free.length){best=Math.max(best,new Set(names).size);return;}for(const row of lists.get(free[index]))walk(index+1,[...names,row.name]);};walk(0,[pinned]);return best;};
  let full=0,short=0;
  for(const seat of seats){const kept=command('hr','appoint-official-manager',{company:seat.company,candidateId:seat.id,termMonths:12}).appointment,free=companies.filter(company=>company!==seat.company),expected=most(seat.name,free);
    const out=command('hr','appoint-all-official-managers',{termMonths:12}),label=`${seat.name} at ${seat.company}`;assert.deepEqual({appointed:out.appointed,skipped:out.skipped},{appointed:14,skipped:1},`2: ${label}: the appointed company is left alone`);
    assert.equal(H.officialManager(state,seat.company).id,kept.id,`2: ${label}: the manager the player chose is not moved`);const names=companies.map(company=>H.officialManager(state,company).name);
    assert.equal(new Set(names).size,expected,`2: ${label}: as many different people as any arrangement gives (${expected})`);
    if(expected===15){full++;assert.equal(names.filter(name=>name===seat.name).length,1,`2: ${label}: one company only`);}else short++;
    for(const company of companies)assert.equal(command('hr','dismiss-official-manager',{company}).dismissed,true);}
  assert.ok(full>=1&&short>=1,`2: both shapes were met: an arrangement for everyone (${full}) and none (${short})`);const valid=s.GH_SAVE_SCHEMA.validate(state);assert.ok(valid.ok,JSON.stringify(valid.errors));}
{// One company alone takes its strongest candidate (tests/build360 holds the same for the first game's airline).
  const {s,state,command}=scenario(),H=s.GH_HR_CORE,out=command('hr','appoint-all-official-managers',{termMonths:12});assert.equal(out.appointed,1);assert.equal(H.officialManager(state,'air').candidateId,strongest(H,state,'air')[0].id,'2: one company takes its strongest candidate');}
{// No arrangement exists: two companies whose only candidate is the same person. Both are appointed, as before.
  const {s,state,command}=scenario(),H=s.GH_HR_CORE;state.godMoney=true;state.infiniteMoney=true;command('corporate','open-company',{type:'sea',capital:400000000,legalName:'Test sea'});
  const only=company=>{const row=strongest(H,state,company)[0];state.companyModules=state.companyModules||{};state.companyModules[company]={...(state.companyModules[company]||{}),hr:{managerCandidates:[{...JSON.parse(JSON.stringify(row)),name:'نورة الفهد'}]}};};
  only('air');only('sea');const lists=['air','sea'].map(company=>strongest(H,state,company).map(row=>row.name));
  if(lists.every(rows=>rows.length===1&&rows[0]==='نورة الفهد')){const out=command('hr','appoint-all-official-managers',{termMonths:12});assert.deepEqual({appointed:out.appointed,skipped:out.skipped,names:Array.from(out.appointments).map(row=>row.name)},{appointed:2,skipped:0,names:['نورة الفهد','نورة الفهد']},'2: with one person for two companies both are appointed, as before');}
  else{// The companies' own candidates stay beside the module's: the shared person is then the weakest choice of each.
    const out=command('hr','appoint-all-official-managers',{termMonths:12});assert.equal(out.appointed,2);assert.equal(new Set(Array.from(out.appointments).map(row=>row.name)).size,2,'2: two different people');}}
console.log('2 ok: «تعيين الجميع» appoints fifteen different people, moves no appointed manager, and one company still takes its strongest');

// 3. The first steps of a career carry their place.
{const h=harness([]),s=h.s;h.load('catalog');h.load('progression-core');h.load('ui-quality-core');const P=s.GH_PROGRESSION_CORE,Q=s.GH_UI_QUALITY;s.GH_FINANCE_CORE={investorMode:()=>false};
  const career=(extra={})=>({progression:{schema:1,version:'1.0.0',mode:'career',difficulty:'normal',xp:0,level:1,milestones:{},daily:{day:-1,actionXp:0,earnedXp:0},licences:{}},simSeconds:0,alerts:[],...extra}),pick=rows=>Array.from(rows).filter(row=>/^(START|LEVEL):/.test(row.id)).map(row=>({id:row.id,panel:row.panel,arg:row.arg,has:Object.prototype.hasOwnProperty.call(row,'arg')}));
  const none=career();assert.deepEqual(pick(P.startTasks(none)),[{id:'START:COMPANY',panel:'companies',arg:'subs',has:true}],'3: «افتح شركة اللوجستيات» opens the subsidiaries tab');
  assert.deepEqual(pick(Q.collectTasks(none)),[{id:'START:COMPANY',panel:'companies',arg:'subs',has:true}],'3: and the task list keeps the place');
  const opened=career({openedCompanies:['road'],globalBases:[],customHubs:[]});s.GH_FLEET_DATA={countByFields:()=>new Map()};
  assert.deepEqual(pick(Q.collectTasks(opened)),[{id:'START:FACILITY',panel:'network',arg:'road',has:true}],'3: «افتح أول مركز لوجستي» opens the logistics company\'s sites');
  const built=career({openedCompanies:['road'],globalBases:[],customHubs:[{id:'L1',owned:true,ownerCompanyId:'road'}]});assert.deepEqual(pick(Q.collectTasks(built)),[{id:'START:FLEET',panel:'assetMarket',arg:'road',has:true}],'3: the market opens on the logistics company, as before');
  built.progression.lastLevelUp={day:0,to:3};s.GH_FLEET_DATA={countByFields:()=>new Map([['road',5]])};built.customRoutes=[{id:'R',mode:'road'}];
  assert.deepEqual(pick(Q.collectTasks(built)),[{id:'LEVEL:UP',panel:'progression',arg:undefined,has:false}],'3: a task with no place carries none');
  assert.deepEqual(pick(Q.collectTasks({progression:P.initial('sandbox'),simSeconds:0,alerts:[]})),[],'3: none in free play');}
console.log('3 ok: the first steps of a career carry their place through the task list');

// 4. fmtMoney.
{const app=source('app.js'),start=app.indexOf('  const fmtMoney = value => {'),end=app.indexOf('\n  };',start);assert.ok(start>0&&end>start,'4: fmtMoney is where the page defines it');
  const fmtMoney=vm.runInNewContext(`(()=>{${app.slice(start,end+5)};return fmtMoney;})()`);
  assert.deepEqual([Infinity,-Infinity].map(fmtMoney),['∞','-∞'],'4: unbounded money is written ∞ (it was $InfinityT)');
  assert.deepEqual([0,999,1500,-2500000,3.2e9,1.5e12,-4e13,NaN,undefined,null,'12'].map(fmtMoney),['$0','$999','$1.5K','-$2.5M','$3.20B','$1.50T','-$40.00T','$0','$0','$0','$12'],'4: every other amount as before');}
console.log('4 ok: unbounded money is written ∞');

// 5. The messages.
{const app=source('app.js'),advanced=source('advanced-core.js');
  for(const [name,text,gone] of [['app.js',app,['} شركات الآن؟','شركات وتسجيل عقودها','ذري','ذرّية','للأسطول لشركة','`فُعّل ','ألغي شراء سيارات Mobility بالكامل: ${error.message}']],['advanced-core.js',advanced,['} شركات</span>','مديرين رسميين','أصبح المدير الرسمي لـ','مديرًا رسميًا لـ','كمدير رسمي لـ','تم توظيف ${result.total} وحفظ']],['energy-core.js',source('energy-core.js'),['اكتمل Commissioning']],['realism-core.js',source('realism-core.js'),['اكتمل Commissioning']]])
    for(const part of gone)assert.equal(text.includes(part),false,`5: ${name} no longer writes «${part}»`);
  for(const [text,kept] of [[app,["فتح ${countText(plans.length,'company')} الآن؟","${countText(plannedCount,type==='air'?'aircraft':'ship')}","${countText(current.length,'truck')}","غادرت ${countText(candidates.length,'aircraft')}","`تم تفعيل ${"]],[advanced,["${countOf(unopened.length,'company')}","عُيّن ${countOf(result.appointed,'manager')} رسميًا","تم توظيف ${countOf(result.total,'employee')}"]],[source('energy-core.js'),['اكتمل التشغيل التجاري لمشروع']],[source('realism-core.js'),['اكتمل التشغيل التجاري لمشروع']]])
    for(const part of kept)assert.ok(text.includes(part),`5: «${part}» is written`);
  // Every noun the counted texts name is one the copy owner counts.
  const h=harness([]);h.load('arabic-copy-core');const FORMS=h.s.GH_ARABIC_COPY.FORMS;for(const text of [app,advanced])for(const match of text.matchAll(/count(?:Text|Of)\([^()]*(?:\([^()]*\)[^()]*)*,\s*'([a-zA-Z]+)'/g))assert.ok(FORMS[match[1]],`5: «${match[1]}» is a counted noun`);}
console.log('5 ok: the messages count their nouns and carry no English word or «ذريًا»');
console.log('BUILD674_COUNTED_TEXTS_AND_MANAGERS_PASS');
