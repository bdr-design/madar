'use strict';
// Owner (approved design «فنتورا: تصميم المستويات وتجهيز الإطلاق»): a career game climbs thirty levels that open the
// companies, the catalogue models and the group's tools; free play and saves from before levels carry no limits (owner,
// approved pricing: in a career, investor mode is unlimited money only, the levels and experience stay). GH_PROGRESSION_CORE, with the real catalogue, company definitions and founding modes:
//  1. the experience table rises strictly to level 30, and levelForXp reads it at every boundary;
//  2. every company definition and every catalogue line (new and used, air, sea, road) has a level from the approved
//     table; a used line takes its new model's level; every listed tool is a real player command;
//  3. the founding offers the three career modes (capital from the difficulty: 1B, 250M, 50M) beside the three free-play
//     modes, the career-normal mode chosen by default; a career mode founds a career root at level 1, any other free play;
//  4. limits apply to a career game, investor mode or not: none for free play or an absent root;
//  5. the command gate refuses a company, a model, a tool or a count past a band with the level that opens it, accepts
//     what the level opens, never refuses repaying or selling, and a licence opens its key early;
//  6. the bands of facilities and fleets follow the company's own level, lift whole at 27 (fleets) and 29 (facilities),
//     and the group's regional headquarters follow their own steps;
//  7. the save validation accepts the roots it writes and refuses a malformed one;
//  8. experience: milestones once, 3 a decision up to 60 a day, the day's profitable companies and group net up to the
//     day's cap, months and years in profit, × the difficulty (and Plus, 50%); investor mode earns as any career; the level never goes down;
//  9. the early licence: the difficulty's reach and fee factor, the approved fee for a company, a model and a tool, a
//     documented group expense in the same command, no second charge, and the licensed key opens;
// 10. the expansion grant: the share of a newly opened company's minimum capital by difficulty, as a documented founder
//     investment once per company; 11. the first steps of a career, one at a time, none in free play.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {harness}=require('./helpers/core-harness');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const h=harness([]),s=h.s;h.load('catalog');h.load('progression-core');h.load('game-lifecycle-core');
const P=s.GH_PROGRESSION_CORE,C=s.GH_ASSET_CATALOG,L=s.GH_GAME_LIFECYCLE;
// Investor mode as its owner reads it (GH_FINANCE_CORE.investorMode: godMoney and infiniteMoney together).
s.GH_FINANCE_CORE={investorMode:state=>Boolean(state?.godMoney&&state?.infiniteMoney)};
assert.ok(P&&C&&L,'the owners load');
const career=(level,extra={})=>({progression:{schema:1,version:'1.0.0',mode:'career',difficulty:'normal',xp:P.XP[level-1],level,milestones:{},daily:{day:-1,actionXp:0,earnedXp:0},licences:{}},...extra});
const same=(actual,expected,message)=>assert.equal(JSON.stringify(actual),JSON.stringify(expected),message);
const refused=(fn,pattern)=>assert.throws(fn,error=>{assert.match(String(error.code),pattern);return true;});

// 1.
assert.equal(P.XP.length,30);assert.equal(P.XP[0],0);for(let i=1;i<P.XP.length;i++)assert.ok(P.XP[i]>P.XP[i-1],`1: level ${i+1} needs more than level ${i}`);
for(let i=0;i<P.XP.length;i++){assert.equal(P.levelForXp(P.XP[i]),i+1);if(i)assert.equal(P.levelForXp(P.XP[i]-1),i);}
assert.equal(P.levelForXp(1e12),30);assert.equal(P.levelForXp(-5),1);

// 2.
const source=fs.readFileSync(path.join(ROOT,'WebApp/company-definitions.js'),'utf8'),companies=[...source.matchAll(/^\s*(?:,)?subsidiary\(\{\s*\n\s*id:'([a-z]+)'/gm)].map(m=>m[1]);
assert.equal(companies.length,15,'2: fifteen subsidiaries defined');
for(const id of ['group',...companies]){const need=P.requirement(`company:${id}`);assert.ok(Number.isInteger(need)&&need>=1&&need<=30,`2: company ${id} has a level`);}
assert.deepEqual(Object.keys(P.COMPANY).sort(),['group',...companies].sort(),'2: no level for a company that does not exist');
const lines=[];for(const type of ['air','sea','road'])for(const tab of ['new','used'])for(const row of C[type][tab])lines.push({type,tab,row});
assert.ok(lines.length>=80,'2: the whole catalogue is read');
const newIds=new Set(lines.filter(x=>x.tab==='new').map(x=>x.row.id));
for(const {type,tab,row} of lines){const need=P.requirement(`model:${row.id}`);assert.ok(Number.isInteger(need)&&need>=1&&need<=30,`2: ${type} ${tab} ${row.id} has a level`);
  if(tab==='used'){const base=P.modelKey(row.id);assert.ok(newIds.has(base),`2: used ${row.id} stands for a new model`);assert.equal(need,P.requirement(`model:${base}`));
    const baseRow=lines.find(x=>x.row.id===base).row;assert.equal(row.priceOriginal,baseRow.price,`2: used ${row.id} maps to the model it was listed from`);}}
assert.deepEqual(Object.keys(P.MODEL).sort(),[...newIds].sort(),'2: no level for a model that is not in the catalogue');
const web=fs.readdirSync(path.join(ROOT,'WebApp')).filter(f=>f.endsWith('.js')).map(f=>fs.readFileSync(path.join(ROOT,'WebApp',f),'utf8')).join('\n');
for(const key of Object.keys(P.FEATURE)){const name=key.split(':')[1];assert.ok(web.includes(`'${name}'`),`2: ${key} is a real command name`);}
assert.equal(P.requirement('command:finance:repay-debt'),null);assert.equal(P.requirement('command:finance:repay-intercompany-loan'),null);assert.equal(P.requirement('command:market:sell-stake'),null);

// 3.
for(const [mode,difficulty] of Object.entries(P.CAREER_MODES)){assert.equal(P.DIFFICULTY[difficulty].capitalMode,mode);assert.ok(L.FOUNDING_CAPITALS[mode]>0,`3: ${mode} is a founding mode`);}
assert.equal(L.FOUNDING_CAPITALS['career-easy'],1e9);assert.equal(L.FOUNDING_CAPITALS['career-normal'],25e7);assert.equal(L.FOUNDING_CAPITALS['career-hard'],5e7);
assert.equal(L.FOUNDING_CAPITALS.balanced,5e7);assert.equal(L.FOUNDING_CAPITALS.investor,25e7);assert.equal(L.FOUNDING_CAPITALS.sandbox,1e9);
const html=fs.readFileSync(path.join(ROOT,'WebApp/index.html'),'utf8'),select=html.match(/<select id="founderMode">([\s\S]*?)<\/select>/)[1],options=[...select.matchAll(/<option value="([^"]+)"( selected)?/g)];
assert.deepEqual(options.map(m=>m[1]).sort(),Object.keys(L.FOUNDING_CAPITALS).sort(),'3: the founding screen offers every mode');
assert.deepEqual(options.filter(m=>m[2]).map(m=>m[1]),['career-normal'],'3: the career at normal difficulty is chosen by default');
assert.ok(html.indexOf('progression-core.js')>0&&html.indexOf('progression-core.js')<html.indexOf('app.js"'),'3: the owner loads before the app');
for(const mode of Object.keys(P.CAREER_MODES)){const root=P.initial(mode);assert.equal(root.mode,'career');assert.equal(root.level,1);assert.equal(root.xp,Math.round(50*P.DIFFICULTY[P.CAREER_MODES[mode]].xp),'3: the founding milestone (50 × the difficulty)');same(P.validate({progression:root}),[]);}
for(const mode of ['balanced','investor','sandbox',undefined,'x']){const root=P.initial(mode);assert.equal(root.mode,'free');same(P.validate({progression:root}),[]);}

// 4.
assert.equal(P.active(career(1)),true);assert.equal(P.active({}),false,'4: a save from before levels is open');assert.equal(P.active({progression:P.initial('sandbox')}),false,'4: free play is open');
assert.equal(P.active(career(1,{godMoney:true,infiniteMoney:true})),true,'4: investor mode keeps the levels');assert.equal(P.unlocked(career(1,{godMoney:true,infiniteMoney:true}),'company:sports'),false,'4: investor mode opens nothing early');
for(const state of [{},{progression:P.initial('balanced')}]){
  assert.equal(P.unlocked(state,'company:sports'),true);assert.equal(P.checkCommand(state,'corporate','open-company',{type:'sports'}),true);assert.equal(P.bandLimit(state,'road','road'),Infinity);
  assert.equal(P.checkCommand(state,'mobility','buy-fleet',{quantity:1e6}),true);}

// 5.
const one=career(1);
refused(()=>P.checkCommand(one,'corporate','open-company',{type:'air'}),/^level-locked$/);
assert.throws(()=>P.checkCommand(one,'corporate','open-company',{type:'air'}),/المستوى 3 · أنت في المستوى 1/);
assert.equal(P.checkCommand(one,'corporate','open-company',{type:'road'}),true);
assert.equal(P.checkCommand(career(3),'corporate','open-company',{type:'air'}),true);
refused(()=>P.checkCommand(one,'finance','raise-debt',{company:'group',amount:1}),/^level-locked$/);assert.equal(P.checkCommand(career(2),'finance','raise-debt',{}),true);
for(const [domain,name] of [['finance','repay-debt'],['finance','repay-intercompany-loan'],['market','sell-stake'],['finance','transfer'],['finance','pay-taxes'],['contracts','sign']])assert.equal(P.checkCommand(one,domain,name,{}),true,`5: ${domain}:${name} is open from level 1`);
refused(()=>P.checkCommand(career(11),'corporate','set-ipo',{}),/^level-locked$/);assert.equal(P.checkCommand(career(15),'corporate','set-ipo',{}),true);
let fleetCount=0;s.GH_FLEET_DATA={countByFields(){return new Map([['road',fleetCount]]);}};
const order=(id,count,company='road')=>({ownerCompanyId:company,count,order:{ownerCompanyId:company,count,item:{id}}});
assert.equal(P.checkCommand(one,'asset-purchase','authorize-order',order('T-ACTROS',30)),true,'5: thirty trucks at level 1');
refused(()=>P.checkCommand(one,'asset-purchase','authorize-order',order('T-ACTROS',31)),/^level-cap$/);
assert.throws(()=>P.checkCommand(one,'asset-purchase','authorize-order',order('T-ACTROS',31)),/المتاح الآن 30 من 31.*في المستوى 3/);
fleetCount=29;refused(()=>P.checkCommand(one,'asset-purchase','authorize-order',order('UT-ACTROS',2)),/^level-cap$/);assert.equal(P.checkCommand(one,'asset-purchase','authorize-order',order('UT-ACTROS',1)),true);
fleetCount=0;refused(()=>P.checkCommand(one,'asset-purchase','authorize-order',order('T-TSEMI',1)),/^level-locked$/);assert.equal(P.checkCommand(career(4),'asset-purchase','authorize-order',order('T-TSEMI',1)),true);
refused(()=>P.checkCommand(career(3),'asset-purchase','authorize-order',order('A-A320N',1,'air')),/^level-locked$/);
refused(()=>P.checkCommand(career(3),'asset-purchase','authorize-order',order('UA-A320C',1,'air')),/^level-locked$/,'5: a used line follows its model');
const licensed=career(3);licensed.progression.licences['model:A-A320N']={at:0};assert.equal(P.checkCommand(licensed,'asset-purchase','authorize-order',order('A-A320N',1,'air')),true,'5: a licence opens its key early');
// Review follow-ups: a model's licence opens its used line too; regional headquarters take the group's steps.
assert.equal(P.unlocked(licensed,'model:UA-A320C'),true,'5: a licence of a model opens its used line');assert.equal(P.checkCommand(licensed,'asset-purchase','authorize-order',order('UA-A320C',1,'air')),true,'5: the used line may be bought');
{const hq=career(1,{branches:['RHQ-1']});refused(()=>P.checkCommand(hq,'facilities','open-regional-hq',{id:'RHQ-2'}),/level-cap/);assert.equal(P.checkCommand(career(1,{branches:[]}),'facilities','open-regional-hq',{id:'RHQ-1'}),true,'5: one regional headquarters at level 1');
  assert.equal(P.checkCommand(career(10,{branches:['A','B']}),'facilities','open-regional-hq',{id:'C'}),true,'5: three from level 10');assert.equal(P.checkCommand({branches:['A','B','C']},'facilities','open-regional-hq',{id:'D'}),true,'5: no limit outside the career');}
const facilityState=career(1,{globalBases:[{id:'R1',owned:true,ownerCompanyId:'road'}],customHubs:[]});
refused(()=>P.checkCommand(facilityState,'facilities','create',{facility:{ownerCompanyId:'road'}}),/^level-cap$/);
assert.equal(P.checkCommand(career(3,{globalBases:[{id:'R1',owned:true,ownerCompanyId:'road'}]}),'facilities','create',{facility:{ownerCompanyId:'road'}}),true);
refused(()=>P.checkCommand(career(20),'facilities','create',{facility:{ownerCompanyId:'sports'}}),/^level-locked$/);
refused(()=>P.checkCommand(career(21,{mobility:{vehicles:new Array(200)}}),'mobility','buy-fleet',{quantity:1}),/^level-cap$/);
assert.equal(P.checkCommand(career(21,{mobility:{vehicles:new Array(199)}}),'mobility','buy-fleet',{quantity:1}),true);

// 6.
assert.deepEqual([1,2,3,4,5,6,7,8,9,10,11,12].map(lvl=>P.bandLimit(career(lvl),'road','road')),[30,30,150,150,600,600,3000,3000,15000,15000,Infinity,Infinity]);
assert.deepEqual([3,4,5,7,9,11,13,26,27].map(lvl=>P.bandLimit(career(lvl),'air','air')),[3,3,8,20,50,150,Infinity,Infinity,Infinity]);
assert.deepEqual([25,26,27].map(lvl=>P.bandLimit(career(lvl),'sports','facility')),[1,1,3]);assert.equal(P.bandLimit(career(29),'sports','facility'),Infinity,'6: facilities lift at 29');
assert.equal(P.bandLimit(career(21),'mobility','mobility'),200);assert.equal(P.bandLimit(career(27),'mobility','mobility'),Infinity,'6: fleets lift at 27');
assert.deepEqual([1,9,10,18,19,23,26,28,29,30].map(lvl=>P.bandLimit(career(lvl),'group','facility')),[1,1,3,3,4,5,6,7,7,Infinity]);
assert.equal(P.heldFacilities({globalBases:[{id:'HQ-GROUP',owned:true,ownerCompanyId:'group'},{id:'G2',owned:true,ownerCompanyId:'group'}]},'group'),1,'6: the founding headquarters is not counted');
assert.equal(P.nextBandLevel(career(1),'road','road'),3);

// 7.
same(P.validate({}),[]);same(P.validate(career(5)),[]);
same(P.validate({progression:'x'}),['progression-shape']);
assert.ok(P.validate(career(5,{})).length===0);const bad=career(5);bad.progression.level=2;assert.ok(P.validate(bad).includes('progression-level'),'7: a level below its experience');
const bad2=career(5);bad2.progression.licences['model:NOPE']={};assert.ok(P.validate(bad2).includes('progression-licence'));
for(const value of [null,undefined]){const bad4=career(5);bad4.progression.licences=value;assert.ok(P.validate(bad4).includes('progression-records'),'8: missing licences are refused, not thrown');}
{const bad5=career(5);bad5.progression.grants={air:5};assert.ok(P.validate(bad5).includes('progression-grants'),'8: a grant row is a record');}
const bad3=career(5);bad3.progression.difficulty='insane';assert.ok(P.validate(bad3).includes('progression-difficulty'));

// 8. Experience.
s.GH_FINANCE_CORE.calendarMonthForDay=day=>{const d=new Date(Date.UTC(2026,0,1)+day*86400000);return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;};
const fresh=(difficulty='normal',extra={})=>{const st={simSeconds:0,alerts:[],...extra};st.progression=P.initial(P.DIFFICULTY[difficulty].capitalMode);return st;};
{const st=fresh();assert.equal(st.progression.xp,50);P.onCommand(st,'corporate','open-company',{type:'road'});
  assert.equal(st.progression.xp,50+100+150+3,'8: the first company: its two milestones and the decision');assert.equal(st.progression.level,3,'8: 303 points reach level 3 (day 0 in the approved table)');assert.match(st.alerts[0],/المستوى 3/,'8: a level-up is announced');
  P.onCommand(st,'corporate','open-company',{type:'road'});assert.equal(st.progression.xp,303+3,'8: a milestone counts once');
  for(let i=0;i<40;i++)P.onCommand(st,'finance','transfer',{});assert.equal(st.progression.daily.actionXp,60,'8: decisions stop at 60 a day');const capped=st.progression.xp;
  st.simSeconds=86400;P.onCommand(st,'finance','transfer',{});assert.equal(st.progression.xp,capped+3,'8: the next day counts again');
  P.onCommand(st,'progression','early-licence',{key:'company:air'});assert.equal(st.progression.xp,capped+3,'8: a licence earns nothing');}
{const st=fresh();const before=st.progression.xp,out=P.closeDay(st,{day:0,companies:{road:{net:5000,tripCount:3},air:{net:-10}},net:10000000});
  const expected=Math.round(20+10*Math.log10(1+100));assert.equal(out.gained,expected,'8: 20 a profitable company and the log of the group net');
  assert.equal(st.progression.xp,before+expected+50+100,'8: the first trip and the first profitable day');assert.equal(P.closeDay(st,{day:0,companies:{},net:1}),null,'8: a day closes once');
  const big={};for(let i=0;i<30;i++)big['c'+i]={net:1};const levelBefore=st.progression.level,capOut=P.closeDay(st,{day:1,companies:big,net:1e12});assert.equal(capOut.gained,150+25*levelBefore,'8: the day stops at 150 + 25 × level');
  P.closeDay(st,{day:31,companies:{},net:-1});assert.ok(st.progression.milestones['first-profit-month']!==undefined,'8: January closed in profit');
  P.closeDay(st,{day:400,companies:{},net:1});assert.ok(st.progression.milestones['first-profit-year']!==undefined,'8: 2026 closed in profit');}
{const easy=fresh('easy'),hard=fresh('hard');P.onCommand(easy,'finance','transfer',{});P.onCommand(hard,'finance','transfer',{});assert.equal(easy.progression.xp,75+5);assert.equal(hard.progression.xp,38+2,'8: the difficulty multiplies every point');
  const plus=fresh('normal',{purchases:{entitlements:{plus:{transactionId:'T'}}}});P.onCommand(plus,'finance','transfer',{});assert.equal(plus.progression.xp,50+5,'8: Plus adds 50% (3 × 1.5, rounded)');}
{const st=fresh('normal',{godMoney:true,infiniteMoney:true}),plain=fresh('normal');for(const row of [st,plain]){P.onCommand(row,'corporate','open-company',{type:'road'});P.closeDay(row,{day:0,companies:{a:{net:1}},net:1e9});}assert.ok(st.progression.xp>50,'8: investor mode earns experience');assert.equal(st.progression.xp,plain.progression.xp,'8: exactly as without it');}
{const st=career(10);st.progression.xp=P.XP[9];P.addXp(st,0,'');assert.equal(st.progression.level,10);st.progression.xp=0;P.addXp(st,1,'');assert.equal(st.progression.level,10,'8: the level never goes down');}
// 9. Early licence.
s.GH_COMPANY_PLATFORM={getDefinition:id=>({founding:{minimumCapital:{air:25e6,sea:30e6,bank:75e6}[id]||0}})};
{const q=P.licenceQuote(career(1),'company:air');assert.equal(q.ok,true);assert.equal(q.ahead,2);assert.equal(q.fee,Math.round(25e6*.2*2),'9: a company: 20% of its minimum capital per level ahead');
  assert.equal(P.licenceQuote(career(1),'company:sea').reason,'licence-too-far','9: normal reaches two levels ahead');
  assert.equal(P.licenceQuote(career(14),'company:bank').fee,Math.round(75e6*.2*2),'9: the bank two levels early is 30 million');
  const easy=career(2);easy.progression.difficulty='easy';assert.equal(P.licenceQuote(easy,'company:sea').fee,Math.round(30e6*.2*3*.5),'9: easy reaches three ahead at half the fee');
  const hard=career(2);hard.progression.difficulty='hard';assert.equal(P.licenceQuote(hard,'company:air').fee,Math.round(25e6*.2*2),'9: hard: one level ahead at twice the fee');assert.equal(P.licenceQuote(hard,'model:T-TSEMI').reason,'licence-too-far');
  const truck=P.licenceQuote(career(3),'model:T-TSEMI');assert.equal(truck.fee,250000,'9: a model: 10% of its price, at least 250,000');
  assert.equal(P.licenceQuote(career(5),'model:UA-A320C').key,'model:A-A320N','9: a used line is licensed through its model');assert.equal(P.licenceQuote(career(5),'model:UA-A320C').fee,Math.round(55e6*.1*2));
  assert.equal(P.licenceQuote(career(13),'command:corporate:set-ipo').fee,Math.round(5e6*15/5*2),'9: a tool: $5M × its level ÷ 5 per level ahead');
  assert.equal(P.licenceQuote(career(3),'company:air').reason,'licence-not-needed');assert.equal(P.licenceQuote({progression:P.initial('sandbox')},'company:air').reason,'progression-not-active');
  const plusState=career(1,{purchases:{entitlements:{plus:{transactionId:'T'}}}});assert.equal(P.licenceQuote(plusState,'company:air').fee,Math.round(25e6*.2*2*.5),'9: Plus halves the fee');}
{const st=career(1,{simSeconds:0}),spent=[];s.GH_FINANCE_CORE.execute=(ctx,cmd,payload)=>{assert.equal(cmd,'spend');spent.push(payload);return {number:'EXP-1'};};
  const q=P.licenceQuote(st,'company:air');assert.equal(typeof P.owner.validate({state:st},'early-licence',{key:'company:air',fee:q.fee+1}),'object','9: a changed fee is refused');
  assert.equal(P.owner.validate({state:st},'early-licence',{key:'company:air',fee:q.fee}),true);const result=P.owner.execute({state:st},'early-licence',{key:'company:air',fee:q.fee},{id:'DOM-1'});
  assert.equal(result.fee,q.fee);assert.equal(spent.length,1);assert.equal(spent[0].company,'group');assert.equal(spent[0].amount,q.fee);assert.match(spent[0].note,/رسوم ترخيص مبكر/);
  assert.equal(st.progression.licences['company:air'].document,'EXP-1','9: the licence keeps its expense document');assert.equal(P.checkCommand(st,'corporate','open-company',{type:'air'}),true,'9: the licensed company opens');
  assert.throws(()=>P.owner.execute({state:st},'early-licence',{key:'company:air',fee:q.fee}),/مفتوح لك بالفعل/,'9: no second charge');assert.equal(spent.length,1);same(P.validate(st),[]);}

// 10. Expansion grants.
{const invested=[];s.GH_FINANCE_CORE.execute=(ctx,cmd,payload)=>{invested.push({cmd,...payload});return {ref:payload.ref};};
  s.GH_COMPANY_PLATFORM={getDefinition:id=>({founding:{minimumCapital:{air:25e6,sea:30e6,media:40e6}[id]||0}})};
  const st=fresh();P.onCommand(st,'corporate','open-company',{type:'road'});assert.equal(st.progression.level,3);
  assert.equal(invested.length,1,'10: level 3 opens aviation: one grant');assert.equal(invested[0].cmd,'founder-investment');assert.equal(invested[0].company,'group');assert.equal(invested[0].amount,25e6*.25,'10: normal grants 25% of the minimum capital');assert.equal(invested[0].ref,'GRANT-AIR');
  assert.equal(st.progression.grants.air.amount,6250000);P.addXp(st,0,'');assert.equal(invested.length,1,'10: once per company');
  invested.length=0;const easy=fresh('easy');P.onCommand(easy,'corporate','open-company',{type:'road'});assert.ok(invested.some(row=>row.ref==='GRANT-AIR'&&row.amount===25e6*.5),'10: easy grants 50%');
  invested.length=0;const hard=fresh('hard');P.addXp(hard,5000,'');assert.ok(hard.progression.level>5);assert.equal(invested.length,0,'10: hard grants nothing');same(P.validate(st),[]);}
// 11. The first steps.
{const st=fresh();same(P.startTasks(st).map(t=>t.id),['START:COMPANY']);st.openedCompanies=['road'];st.globalBases=[];st.customHubs=[];s.GH_FLEET_DATA={countByFields:()=>new Map()};
  same(P.startTasks(st).map(t=>t.id),['START:FACILITY']);st.customHubs=[{id:'L1',owned:true,ownerCompanyId:'road'}];same(P.startTasks(st).map(t=>t.id),['START:FLEET']);
  s.GH_FLEET_DATA={countByFields:()=>new Map([['road',5]])};same(P.startTasks(st).map(t=>t.id),['START:ROUTE']);st.customRoutes=[{id:'R',mode:'road'}];same(P.startTasks(st).map(t=>t.id),[]);
  same(P.startTasks({progression:P.initial('sandbox')}),[],'11: none in free play');}
// Owner (approved levels page): the experience of the last 8 game days by source, for «خبرة اليوم» and the time to the next
// level. Each addition lands in its game day and source; eight rows at most; the rate is the mean of the closed days (today
// excluded, the days with nothing counted as 0) over at most 7; a malformed record is refused by the save validation.
{
  const g=career(3,{simSeconds:2*86400+10}),p=g.progression;
  assert.equal(P.xpRate(g),null,'xp-days: no rate before a day has closed');
  P.addXp(g,10,'day');P.addXp(g,6,'decision');P.addXp(g,4,'first-facility');
  assert.deepEqual(JSON.parse(JSON.stringify(p.xpDays)),[{day:2,xp:20,ops:10,decisions:6,milestones:4}],'xp-days: one row a game day, split by source');
  assert.deepEqual(JSON.parse(JSON.stringify(P.xpToday(g))),{day:2,xp:20,ops:10,decisions:6,milestones:4,decisionXp:0,decisionCap:60},'xp-days: today');
  assert.equal(P.xpRate(g),null,'xp-days: today alone gives no rate');
  g.simSeconds=5*86400;P.addXp(g,30,'day');
  assert.equal(P.xpRate(g),20/3,'xp-days: days 2 to 4 closed, day 3 and 4 had nothing');
  for(let day=6;day<=16;day++){g.simSeconds=day*86400;P.addXp(g,day,'decision');}
  assert.equal(p.xpDays.length,P.XP_DAYS,'xp-days: eight rows at most');assert.deepEqual([...p.xpDays.map(row=>row.day)],[9,10,11,12,13,14,15,16]);
  assert.equal(P.xpRate(g),(9+10+11+12+13+14+15)/7,'xp-days: the last seven closed days');
  assert.equal(P.validate(g).length,0,'xp-days: a valid record');
  for(const broken of [{day:-1,xp:1,ops:0,decisions:0,milestones:0},{day:20,xp:-1,ops:0,decisions:0,milestones:0},{day:20,xp:1,ops:'x',decisions:0,milestones:0},{day:3,xp:1,ops:0,decisions:0,milestones:0}]){const bad=JSON.parse(JSON.stringify(g));bad.progression.xpDays.push(broken);bad.progression.xpDays.shift();assert.ok(P.validate(bad).includes('progression-xp-days'),`xp-days: refused ${JSON.stringify(broken)}`);}
  const tooMany=JSON.parse(JSON.stringify(g));tooMany.progression.xpDays.push({day:17,xp:1,ops:1,decisions:0,milestones:0});assert.ok(P.validate(tooMany).includes('progression-xp-days'),'xp-days: nine rows are refused');
  const free={progression:P.initial('sandbox')};assert.equal(P.xpRate(free),null);
}
console.log(JSON.stringify({suite:'build633-progression-core',ok:true,companies:companies.length+1,catalogueLines:lines.length,tools:Object.keys(P.FEATURE).length}));
