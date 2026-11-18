'use strict';
// Build 712 (owner: «شيك على الشركات بستثناء الطيران تسجل خسائر بشكل متكرر» then «طبق الاخف واللي مايسبب الثقل»).
// The companies other than air showed a loss on many single days although their month was profitable: a whole
// month's payroll is booked on day 27 and a sea voyage earns only on arrival. The books stay exactly as they are; the
// card of each opened company in the subsidiaries list now shows its net over the last 30 days of closes (the figure
// the same render already asked GH_FINANCE_CORE.performance for) instead of one day's net, once the company has closed
// a day with activity of its own.
//  1. before any daily close every card keeps its earlier figure and label (today's net or the last close);
//  2. after real day closes up to and including the month's payroll close, every opened company's card reads
//     «صافي 30 يومًا» with the money of its 30-day net summed here from the daily reports, and that sum's sign class;
//  3. on the payroll close, the companies whose day lost money while their 30 days earned show the profit (at least two);
//  4. a company whose closes hold only zero rows (registered before it opened) keeps the earlier figure and label;
//  5. rendering changes nothing in the books, the reports, the profit counters or the save revision (display only).
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||require('node:path').resolve(__dirname,'..');
const assert=require('node:assert/strict'),{chromium}=require('playwright');
const {bootRenderApp}=require('./helpers/render-app.cjs'),{installVault}=require('./helpers/differential-vault-fixture.cjs'),{prepareOperatingWorld}=require('./helpers/all-operating-world.cjs');
const MAX_DAYS=40,overall=setTimeout(()=>{console.error('build712: no result within 250 s');process.exit(1);},250000);
(async()=>{
 const browser=await chromium.launch({headless:true}),errors=[];let env=null;
 try{
  env=await bootRenderApp({browser,errors,beforeScripts:{fn:installVault},viewport:{width:844,height:390}});const {page}=env;page.setDefaultTimeout(120000);
  await prepareOperatingWorld(page,{rows:300,mobilityRows:40,fullDispatch:true});
  const cards=()=>page.evaluate(async()=>{
   const s=__GH_STATE__,books=()=>JSON.stringify([s.finance.dailyCompanyReports,s.finance.journalEntries,s.companyFinance,s.saveRevision,s.todayProfit,s.sectorProfitToday,s.lastClosedSectorProfit]),before=books();
   if(!window.qa712Wrapped){const prepare=GH_INTERFACE.prepare;window.GH_INTERFACE={...GH_INTERFACE,prepare(root,panel,arg,ctx){window.qa712Ctx=ctx;return prepare(root,panel,arg,ctx);}};window.qa712Wrapped=true;}
   __AUDIT__.openDrawer('companies','subs');await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));await new Promise(r=>setTimeout(r,100));
   const money=window.qa712Ctx?.fmtMoney;if(typeof money!=='function')throw Error('qa-712-money-formatter-missing');
   const day=Math.floor(s.simSeconds/86400),out={};
   for(const card of document.querySelectorAll('#drawerBody .company-visual-card[data-company]')){
    const id=card.dataset.company,cell=card.querySelector(':scope .company-visual-body > .metric-row')?.children[1];if(!cell)throw Error('qa-712-card-metric-missing:'+id);
    // The 30-day net summed here from the reports, independently of GH_FINANCE_CORE.performance.
    let sum=0,activity=0,days=0;for(const row of s.finance.dailyCompanyReports){const d=Number(row.day);if(!(d>day-30&&d<=day))continue;days++;const c=row.companies?.[id]||{};sum+=Number(c.net)||0;activity+=Math.abs(Number(c.grossRevenue)||0)+Math.abs(Number(c.expenses)||0)+Math.abs(Number(c.net)||0);}
    const latest=s.finance.dailyCompanyReports.find(row=>Number(row.day)<=day),lastDayNet=Number(latest?.companies?.[id]?.net)||0,currentNet=Number(s.sectorProfitToday?.[id])||0;
    out[id]={label:cell.querySelector('span').textContent,value:cell.querySelector('b').textContent,cls:cell.querySelector('b').className,sum,activity,days,lastDayNet,currentNet,expectedNet:money(sum),expectedToday:money(currentNet!==0?currentNet:lastDayNet)};
   }
   return {out,unchanged:before===books()};});
  const earlier=(id,c,claim)=>{assert.notEqual(c.label,'صافي 30 يومًا',`${claim}: ${id} shows no 30-day figure`);assert.equal(c.label,c.currentNet!==0?'صافي اليوم':'آخر إقفال',`${claim}: ${id} keeps the earlier label (${c.label})`);assert.equal(c.value,c.expectedToday,`${claim}: ${id} keeps the earlier figure`);};
  // 1. before any close
  const first=await cards();assert.ok(first.unchanged,'5: rendering the cards before a close changes nothing');
  const opened=Object.keys(first.out).sort();assert.ok(opened.length>=8,`the operating world shows its opened companies (${opened})`);
  for(const [id,c] of Object.entries(first.out)){assert.equal(c.days,0,`1: ${id} has no close yet`);earlier(id,c,'1');}
  // Real day closes, one at a time, until the close that pays the month's payroll (day 27 of the calendar month).
  const run=await page.evaluate(async max=>{const e=__AUDIT__.simulationEngine,s=__GH_STATE__;for(let d=1;d<=max;d++){const r=e.advanceTo((Math.floor(s.simSeconds/86400)+1)*86400+3600,{reason:'qa-712-period-net',speed:300});if(!r.accepted)throw Error(JSON.stringify(r));const until=performance.now()+60000;while((e.snapshot().manualAdvance||GH_TRANSACTION_CORE.isStaged(s))&&performance.now()<until)await new Promise(r=>setTimeout(r,20));if(e.snapshot().manualAdvance)throw Error('qa-712-advance-stuck');const pay=(s.finance.payrollReports||[])[0];if(pay)return {days:d,payrollDay:Number(pay.day),lastClose:Number(s.finance.dailyCompanyReports[0]?.day)};}throw Error('qa-712-no-payroll-close');},MAX_DAYS);
  assert.equal(run.lastClose,run.payrollDay,`the last close is the payroll close (${JSON.stringify(run)})`);
  const after=await cards();assert.ok(after.unchanged,'5: rendering the cards after the closes changes nothing');
  assert.deepEqual(Object.keys(after.out).sort(),opened,'the same opened companies are shown after the closes');
  let turned=0;
  for(const [id,c] of Object.entries(after.out)){
   assert.ok(c.days>0&&c.activity>0,`2: ${id} has closes with activity (${c.days} days)`);assert.equal(c.label,'صافي 30 يومًا',`2: ${id} reads its 30-day net (${c.label})`);
   assert.equal(c.value,c.expectedNet,`2: ${id} shows its 30-day net ${c.sum}`);assert.equal(c.cls,c.sum>=0?'positive':'negative',`2: ${id} sign class follows the 30-day sum (${c.sum})`);
   if(c.lastDayNet<0&&c.sum>0){turned++;assert.equal(c.cls,'positive',`3: ${id} lost on the payroll close (${c.lastDayNet}) and shows its 30-day profit (${c.sum})`);}
  }
  assert.ok(turned>=2,`3: at least two companies lost on the payroll close while their 30 days earned (${JSON.stringify(Object.fromEntries(Object.entries(after.out).map(([k,v])=>[k,[Math.round(v.lastDayNet),Math.round(v.sum)]])))})`);
  // 4. a company with zero rows only: its rows are zeroed in a copy of the reports for one render, then the real ones return.
  const zero=opened.find(id=>id!=='air');
  const zeroed=await page.evaluate(async id=>{const s=__GH_STATE__,real=s.finance.dailyCompanyReports;s.finance.dailyCompanyReports=real.map(row=>({...row,companies:{...row.companies,[id]:{grossRevenue:0,expenses:0,net:0,tripRevenue:0,operatingRevenue:0,tripCount:0}}}));try{__AUDIT__.openDrawer('companies','subs');await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const cell=document.querySelector(`#drawerBody .company-visual-card[data-company="${id}"] .company-visual-body > .metric-row`)?.children[1];const currentNet=Number(s.sectorProfitToday?.[id])||0;return {label:cell?.querySelector('span').textContent,value:cell?.querySelector('b').textContent,currentNet,expectedToday:window.qa712Ctx.fmtMoney(currentNet)};}finally{s.finance.dailyCompanyReports=real;}},zero);
  earlier(zero,{...zeroed,lastDayNet:0},'4');
  const restored=await cards();assert.ok(restored.unchanged,'5: the real reports are back');assert.equal(restored.out[zero].label,'صافي 30 يومًا','4: the real reports give the 30-day figure again');
  assert.deepEqual(errors,[],'no page errors');
  console.log(JSON.stringify({opened:opened.length,...run,turned,zero}));
 }finally{clearTimeout(overall);await browser.close();await env?.closeOrigin?.();}
})().catch(e=>{console.error(e);process.exit(1);});
