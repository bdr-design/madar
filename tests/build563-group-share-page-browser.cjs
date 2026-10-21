'use strict';
// The group's share page (owner's IPO restructuring, batch 3, as designed). Proven in the real app (its simulation, daily
// close, stock desk, listing button, durable command and save), the native storage protocol doubled:
//  1. the game's own daily closes price a listed group's share: one price a closed day, the fair value per share × the
//     mood, the first close of a save listed before this without a move;
//  2. after the listing from the offering page, the desk's tab reads «سهم المجموعة» and the page shows the price and the
//     day's move, the market value and the move since the offering, the chart's first day, earnings per share, P/E and
//     yield, what moves the price (the mood included), the listing as the first move, the public's and the founder's
//     shares, the lock-up's last day, and buy-back and new issue as later;
//  3. after a month of closes the page draws the month's prices with the offer price, and lists the moves of 1% or more
//     with their cause: the annual meeting's reception, a new rating, a company's loss; a tampered rating is shown as
//     text, never markup;
//  4. weight: a listed group's day stays well under a quarter of a millisecond, and the page opens in well under 100 ms
//     (Chromium on this machine, not an iPhone).
const assert=require('node:assert/strict'),path=require('node:path'),{chromium}=require('playwright');
const {bootAtOrigin,installVault}=require('./helpers/differential-vault-fixture.cjs'),{prepareCommandWorld}=require('./helpers/command-world-fixture.cjs');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
(async()=>{const browser=await chromium.launch({headless:true}),errors=[];let env;try{
 env=await bootAtOrigin({browser,root:ROOT,errors,fleetWorker:true,viewport:{width:1180,height:820},beforeScripts:{fn:installVault}});const {page}=env;page.setDefaultTimeout(120000);await prepareCommandWorld(page,{count:2});
 const settled=()=>page.waitForFunction(()=>!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked());
 const open=async arg=>{await page.evaluate(arg=>__AUDIT__.openDrawer('stocks',arg),arg);await page.waitForSelector('#drawerBody .pv');return page.locator('#drawerBody').innerText();};
 await page.evaluate(()=>{const s=__GH_STATE__;s.godMoney=false;s.infiniteMoney=false;});
 // 1: a save listed before this, then two of the game's own days
 const day0=await page.evaluate(()=>{const s=__GH_STATE__,day=Math.floor(s.simSeconds/86400);if(s.advanced)delete s.advanced.valuation;s.ipo={listed:true,ticker:'VH',listedDay:day,issuedPct:18,proceeds:3.6e8,offerPrice:20,sharesIssued:18e6,totalShares:1e8,capTable:[{holderId:'founders',label:'المؤسسون',shares:82e6},{holderId:'public-float',label:'المساهمون العموم',shares:18e6}],transferReference:'IPO-VH-QA'};return day;});
 for(let step=1;step<=2;step++){await page.evaluate(day=>{const r=__AUDIT__.simulationEngine.advanceTo(day*86400+7200,{reason:'qa-563-day',speed:300});if(!r.accepted)throw Error(JSON.stringify(r));},day0+step);await page.waitForFunction(()=>!__AUDIT__.simulationEngine.snapshot().manualAdvance,null,{timeout:120000});await settled();}
 const real=await page.evaluate(()=>{const v=GH_CORPORATE_CORE.valuation(__GH_STATE__);return {day:v.day,history:v.history,price:v.price,prevPrice:v.prevPrice,fair:v.fair,mood:v.sentiment,events:v.events||[],lastFinancialDay:__GH_STATE__.lastFinancialDay};});
 assert.equal(real.history.length,2,`1: a price a closed day ${JSON.stringify(real)}`);assert.deepEqual(real.history.map(row=>row[0]),[real.lastFinancialDay-1,real.lastFinancialDay],'1: on the closed days');
 assert.equal(real.price,Math.round(Math.max(.01,real.fair/1e8)*real.mood*100)/100,'1: the fair value per share × the mood');assert(real.events.every(row=>row.day!==real.history[0][0]),'1: the first close moves nothing');
 // 2: a group the offering accepts, listed from its page
 await page.evaluate(()=>{const s=__GH_STATE__;s.ipo={listed:false};delete s.advanced.valuation;s.realism.financial.consolidated.equity=2.5e9;s.finance.dailyCompanyReports=Array.from({length:365},(_,i)=>({id:`CLOSE-${200-i}`,day:200-i,net:1.2e6}));s.simSeconds=200*86400;s.profile.creditRating='A';s.profile.reputation=80;GH_CORPORATE_CORE.execute({state:s},'close-valuation',{day:200});});
 await open('ipo:20');await page.locator('#drawerBody .launch-ipo').click();await page.waitForSelector('dialog.ui-confirm[open]');await page.locator('dialog.ui-confirm [data-confirm="accept"]').click();await page.waitForFunction(()=>__GH_STATE__.ipo?.listed===true);await settled();
 const listed=await page.evaluate(()=>{const s=__GH_STATE__;return {ipo:s.ipo,v:GH_CORPORATE_CORE.valuation(s),name:s.profile.name};});const {ipo,v}=listed;
 const money=n=>`$${n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`,count=n=>n.toLocaleString('en-US'),move=(v.price/ipo.offerPrice-1)*100;
 let text=await open('ipo');assert.equal(await page.locator('#drawerBody .pv-seg [data-arg="ipo"]').innerText(),'سهم المجموعة','2: the tab');
 for(const shown of [`${listed.name} · VH · مدرجة منذ 0 يومًا`.replace(/VH/,ipo.ticker),money(v.price),`${move>=0?'+':''}${move.toFixed(2)}%`,'القيمة السوقية',`منذ الطرح`,'يُرسم بعد يومي تداول.','ربح السهم','مكرر الربحية',(v.price/(v.profit12/ipo.totalShares)).toFixed(1),'عائد التوزيع','0.0%','ما يحرك السعر','قيمة الأرباح · 60%','صافي الأصول · 40%','مزاج السوق',`${(v.sentiment*100).toFixed(1)}%`,'والمؤتمر السنوي حتى ±3%','آخر ما أثّر على السعر',`الإدراج بالرمز ${ipo.ticker} · سعر الطرح ${money(ipo.offerPrice)}`,'أسهم الجمهور',count(ipo.sharesIssued),'أسهم المؤسس',count(ipo.totalShares-ipo.sharesIssued),`حتى اليوم ${ipo.listedDay+180}`,'إعادة شراء أسهم · لاحقًا','إصدار جديد · لاحقًا'])assert(text.includes(shown),`2: the page shows «${shown}»\n${text}`);
 assert.equal(await page.locator('#drawerBody .pvx-soon button:disabled').count(),2,'2: buy-back and new issue are later');assert.equal(await page.locator('#drawerBody .launch-ipo').count(),0,'2: nothing lists again');
 // 3: a month of closes with a meeting, a new rating, a company's loss and a tampered rating
 const month=await page.evaluate(()=>{const s=__GH_STATE__,C=GH_CORPORATE_CORE,company=s.openedCompanies[0],close=(day,report={})=>{s.finance.dailyCompanyReports.unshift({id:`CLOSE-${day}`,day,net:1.2e6,...report});C.execute({state:s},'close-valuation',{day});};
  for(let day=201;day<=230;day++){if(day===210)C.execute({state:s},'record-agm',{year:2027,day,ratingAdjust:0,positive:91,negative:4});if(day===220)s.profile.creditRating='A-';if(day===225)s.profile.creditRating='<img src=x onerror="window.__qaInjected=1">';close(day,day===215?{net:-60e6,companies:{[company]:{net:-61e6},group:{net:1e6}}}:{});}
  return {company,name:window.GH_IDENTITY?.shortName?.(s,company),v:C.valuation(s)};});
 text=await open('ipo');const m=month.v;assert(text.includes('السعر · آخر 30 يومًا')&&m.history.length===31,'3: a month of prices');assert.equal(await page.locator('#drawerBody .pvx-chart path').count(),1,'3: drawn');assert.equal((await page.locator('#drawerBody .pvx-chart path').getAttribute('d')).split(/[ML]/).filter(Boolean).length,31,'3: one point a day');assert.equal(await page.locator('#drawerBody .pvx-chart line').count(),1,'3: with the offer price');
 const dayMove=(m.price/m.prevPrice-1)*100;assert(text.includes(`${dayMove>=0?'+':''}${dayMove.toFixed(2)}%`),'3: the day\'s move');
 const kinds=m.events.map(row=>row.kind);for(const kind of ['agm','rating','profit','listing'])assert(kinds.includes(kind),`3: a ${kind} move ${JSON.stringify(m.events)}`);
 const pct=row=>`${row.pct<0?'−':'+'}${Math.abs(row.pct*100).toFixed(1)}%`,agm=m.events.find(row=>row.kind==='agm'),rating=m.events.find(row=>row.kind==='rating'&&row.grade==='A-'),loss=m.events.find(row=>row.kind==='profit'&&row.day===215);
 assert(text.includes('صدى المؤتمر السنوي 2027 · إيجابي 91% وسلبي 4%')&&text.includes(pct(agm)),'3: the meeting and its move');assert(agm.pct>0,'3: a warm meeting lifts the price');
 assert(rating&&text.includes('خفض التصنيف إلى A- · المكرر 14 بدل 16')&&text.includes(pct(rating))&&rating.pct<0,`3: the new rating ${JSON.stringify(rating)}`);
 assert(loss&&loss.company===month.company&&text.includes(`خسارة ${month.name} اليوم`)&&text.includes(pct(loss)),`3: the company's loss ${JSON.stringify(loss)}`);
 assert.equal(await page.evaluate(()=>window.__qaInjected||0),0,'3: no markup ran');assert.equal(await page.locator('#drawerBody img[src="x"]').count(),0,'3: a tampered rating stays text');
 // 4
 const weight=await page.evaluate(()=>{const s=__GH_STATE__,C=GH_CORPORATE_CORE;s.profile.creditRating='A';let t=performance.now();for(let day=231;day<2231;day++){s.finance.dailyCompanyReports.unshift({id:`CLOSE-${day}`,day,net:1.2e6});if(s.finance.dailyCompanyReports.length>400)s.finance.dailyCompanyReports.length=400;C.execute({state:s},'close-valuation',{day});}const dayMs=(performance.now()-t)/2000;
  t=performance.now();for(let i=0;i<20;i++)__AUDIT__.openDrawer('stocks','ipo');const pageMs=(performance.now()-t)/20;t=performance.now();for(let i=0;i<20;i++)__AUDIT__.openDrawer('stocks','portfolio');return {dayMs,pageMs,portfolioMs:(performance.now()-t)/20,history:C.valuation(s).history.length};});
 assert(weight.dayMs<.25,`4: a listed day in ${weight.dayMs} ms`);assert(weight.pageMs<100,`4: the page opens in ${weight.pageMs} ms`);assert.equal(weight.history,365,'4: a year of prices');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({suite:'build563-group-share-page-browser',ok:true,price:m.price,events:m.events.length,dayUs:+(weight.dayMs*1000).toFixed(1),pageMs:+weight.pageMs.toFixed(1),portfolioMs:+weight.portfolioMs.toFixed(1)}));
}finally{await browser.close();await env?.closeOrigin?.();}})().catch(error=>{console.error(error);process.exitCode=1;});
