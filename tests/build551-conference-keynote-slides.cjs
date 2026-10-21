'use strict';
// The conference is a keynote on the hall's LED screen: one idea per slide, in chapters, from the archived snapshot
// (owner: a refined Apple-style keynote about the company, nothing that reads as a game). Proven on the real plan model,
// identity owner and keynote builder:
//  1. the chapters run opening, the year in figures, the portfolio, the operating companies (the leader first, a company
//     being founded only on the founding slide), customers and reputation, the team, the year ahead, the reception and
//     the close;
//  2. the figures are the snapshot's: revenue and net in short form, the margin as cents of each dollar, the leader's
//     share of the profit, the best margin, the gap a loss-making company has to break even;
//  3. every slide belongs to one plan scene (the archive's chapters), so a resumed conference opens on its scene; a
//     company's slides belong to its first scene;
//  4. the executive summary shows no company, people or reception slides; a period without closes says the figures are
//     under review instead of showing them;
//  5. only Arabic comments reach the screen, and every text from the snapshot is escaped.
const assert=require('node:assert/strict'),path=require('node:path');
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {harness}=require('./helpers/core-harness');
const {s}=harness(['capability-registry-core','company-definitions','company-platform-core','identity-system','conference-model','conference-keynote']),M=s.GH_CONF_MODEL,K=s.GH_CONF_KEYNOTE;
const mark=type=>({accent:'#2d72df',variants:{mark:`assets/identity/approved/${type}-symbol.webp`}});
const company=(type,name,revenue,expenses,extra={})=>({type,legalName:name,tradeName:name,brand:mark(type),grossRevenue:revenue,expenses,net:revenue-expenses,reportedDays:120,expectedDays:365,dataQuality:{status:'ok'},headcount:0,ops:{},...extra});
const snapshot={year:2026,group:{name:'فنتورا القابضة',brand:mark('group'),grossRevenue:2.4e9,expenses:1.5e9,net:9e8,reportedDays:120,expectedDays:365,complete:false,dataQuality:{status:'ok'},cash:11.4e9,debt:0,groupValue:9.6e9,creditRating:'A',reputation:81,customerRating:{rating:4.2,confidence:'أولية'},totalHeadcount:132001,officialManagerCoverage:0},
 companies:[company('air','فنتورا إير',2.39e9,1.5e9,{headcount:132000,ops:{assetCount:4400,activeAssets:4400,routeCount:276,tripCount:53745},customerRating:{rating:4.5,components:{reputation:86,service:82,operations:99}}}),
  company('bank','بنك فنتورا',1.2e8,1.4e7,{customerBase:840,ops:{liquidity:9.08e8,corporateClients:11}}),company('telecom','فنتورا تيليكوم',1e6,1.1e7),
  {type:'sea',legalName:'فنتورا البحرية',brand:mark('sea'),grossRevenue:0,expenses:0,net:0,reportedDays:0,dataQuality:{status:'empty'},ops:{}}],
 social:{viewers:901550,attendees:5000,likes:78138,positive:91,neutral:5,negative:4,comments:[{handle:'@RiyadhMarkets',country:'السعودية',lang:'AR',text:'عرض سنوي مرتب <b>واضح</b>.'},{handle:'@GlobalDesk',country:'الولايات المتحدة',lang:'EN',text:'Strong operating leverage.'}]}};
const full=M.buildScenePlan(snapshot,{mode:'full'}),slides=K.slides(snapshot,full),text=slide=>slide.html.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
const chapters=Array.from(slides,slide=>String(slide.chapter)).filter((c,i,all)=>all[i-1]!==c);
assert.deepEqual(chapters,['الافتتاح','العام في أرقام','محفظة الأعمال','شركاتنا العاملة','فنتورا إير','بنك فنتورا','فنتورا تيليكوم','العملاء والسمعة','فريقنا','مرحلة التأسيس','نحو 2027','صدى المؤتمر','الختام'],`1: chapter order (${chapters})`);
assert(!slides.some(slide=>slide.type==='sea'),'1: a company being founded has no slides of its own');
const all=slides.map(text).join(' | ');
assert.match(all,/الإيرادات 2\.4 مليار دولار/,'2: revenue in short form');assert.match(all,/صافي الربح 900 مليون دولار/,'2: net profit');
assert.match(all,/كل دولار من الإيرادات ترك 38 سنتًا ربحًا صافيًا/,'2: the margin as cents of each dollar');
assert.match(all,/فنتورا إير 890 مليون دولار صافي الربح · 99% من أرباح المجموعة|أرباح المجموعة كلها تقريبًا/,'2: the leader\'s share of the profit');
assert.match(all,/بنك فنتورا 88% هامش الربح الأعلى في المجموعة/,'2: the best margin');assert.match(all,/على طريق التعادل\. 10 مليون دولار تفصلها عن نقطة التعادل/,'2: the gap to break even');
assert.match(all,/840 عميل قاعدة عملاء بنك فنتورا المسجلة/,'2: the bank\'s customer base');assert.match(all,/132,001 موظف في المجموعة/,'2: everyone the group employs');
assert(slides.some(slide=>slide.html.includes('<bdi dir="ltr">81<small>/100</small></bdi>')),'2: the reputation reads 81/100 left to right');
for(const slide of slides){const scene=full[slide.scene];assert(scene&&scene.id===slide.sceneId,`3: ${slide.chapter} belongs to a plan scene`);if(slide.type!=='group')assert.equal(slide.scene,full.findIndex(row=>row.type===slide.type),`3: ${slide.type} slides belong to its first scene`);}
assert.equal(slides.findIndex(slide=>slide.sceneId==='group-results'),slides.findIndex(slide=>slide.chapter==='العام في أرقام'),'3: a resumed conference opens on its scene\'s first slide');
const brief=K.slides(snapshot,M.buildScenePlan(snapshot,{mode:'brief'}));
assert(!brief.some(slide=>slide.type!=='group'||['العملاء والسمعة','فريقنا','صدى المؤتمر'].includes(slide.chapter)),'4: the executive summary keeps to the group');
const empty=JSON.parse(JSON.stringify(snapshot));empty.group.reportedDays=0;empty.group.dataQuality={status:'empty',reason:'لا توجد إقفالات مالية معتمدة.'};const emptyText=K.slides(empty,M.buildScenePlan(empty,{mode:'full'})).map(text).join(' | ');
assert.match(emptyText,/البيانات قيد المراجعة\. لا توجد إقفالات مالية معتمدة\./,'4: figures under review');assert.doesNotMatch(emptyText,/الإيرادات 2\.4 مليار/,'4: and not shown');
assert.match(all,/«عرض سنوي مرتب &lt;b&gt;|عرض سنوي مرتب/,'5: the Arabic comment is shown');assert(!slides.some(slide=>slide.html.includes('<b>واضح</b>')),'5: escaped');assert.doesNotMatch(all,/Strong operating leverage/,'5: an English comment is not');
console.log(JSON.stringify({suite:'build551-conference-keynote-slides',ok:true,slides:slides.length,brief:brief.length,chapters:chapters.length}));
