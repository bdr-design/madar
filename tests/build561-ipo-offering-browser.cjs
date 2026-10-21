'use strict';
// The offering on the group's fair value (owner's IPO restructuring). Proven in the real app (its stock desk, buttons,
// confirmation dialog, durable composite command, finance and corporate owners and save), the native storage protocol
// doubled; the group's year of closes, age and rating are set by the test:
//  1. before the first daily valuation the page offers nothing and its button is disabled;
//  2. while a condition fails the page names it (the missing value, the closes, the age, the rating), shows no offer, and
//     the button is disabled;
//  3. for each share of 10% to 30%: the founder's shares put a share near $25 before the offering, the offered shares are
//     that share of all of them, the price lies in its range, the fees are 3% + $3M, and the page shows these terms;
//  4. cancelling the dialog changes nothing; a value that moved more than 1% since the dialog opened lists nothing;
//  5. accepting lists the group: one equity transfer of the net with the gross and the deduction on it, the listing
//     record with its terms and a 180-day lock-up, saved; the listed price is not below the offer price;
//  6. the finance hub opens the offering page instead of listing from its own button;
//  7. a save listed before the fair value keeps its share price (the old group value per share) until its first daily
//     valuation;
//  8. weight: a day's valuation over the most closes the finance owner keeps (400), and the offering's terms as the
//     finance hub reads them, each well under a quarter of a millisecond (Chromium on this machine, not an iPhone).
const assert=require('node:assert/strict'),path=require('node:path'),{chromium}=require('playwright');
const {bootAtOrigin,installVault}=require('./helpers/differential-vault-fixture.cjs'),{prepareCommandWorld}=require('./helpers/command-world-fixture.cjs');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
(async()=>{const browser=await chromium.launch({headless:true}),errors=[];let env;try{
 env=await bootAtOrigin({browser,root:ROOT,errors,fleetWorker:true,viewport:{width:1180,height:820},beforeScripts:{fn:installVault}});const {page}=env;page.setDefaultTimeout(120000);await prepareCommandWorld(page,{count:2});
 const settled=()=>page.waitForFunction(()=>!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked());
 const open=async arg=>{await page.evaluate(arg=>__AUDIT__.openDrawer('stocks',arg),arg);await page.waitForSelector('#drawerBody .pv');return page.locator('#drawerBody').innerText();};
 await page.evaluate(()=>{const s=__GH_STATE__;s.godMoney=false;s.infiniteMoney=false;if(s.advanced)delete s.advanced.valuation;});
 // 1
 let text=await open('ipo');assert.match(text,/تُحسب عند أول إقفال يومي/,'1: no value yet');assert.equal(await page.locator('#drawerBody .launch-ipo').isDisabled(),true);
 // 2: a day-old, losing group
 await page.evaluate(()=>{const s=__GH_STATE__;s.realism.financial.consolidated.equity=4e8;s.finance.dailyCompanyReports=Array.from({length:40},(_,i)=>({id:`CLOSE-${40-i}`,day:40-i,net:-2e6}));s.simSeconds=40*86400;s.profile.creditRating='BB';GH_CORPORATE_CORE.execute({state:s},'close-valuation',{day:40});});
 text=await open('ipo');for(const pattern of [/القيمة فوق مليار · باقٍ/,/ربح موجب 12 شهرًا · خسارة/,/180 يومًا منذ التأسيس · باقٍ 140 يومًا/,/تصنيف BBB− أو أعلى · الحالي BB/])assert.match(text,pattern,`2: ${pattern}`);
 assert.equal(await page.locator('#drawerBody .pvx-opt5, #drawerBody .pv-facts').count(),0,'2: no offer while a condition fails');assert.equal(await page.locator('#drawerBody .pvx-card h4',{hasText:'السعر والمتحصلات'}).count(),0);assert.equal(await page.locator('#drawerBody .launch-ipo').isDisabled(),true,'2: disabled');
 // 3: a year of profit, 200 days, rating A
 const fixture=()=>page.evaluate(()=>{const s=__GH_STATE__;s.realism.financial.consolidated.equity=2.5e9;s.finance.dailyCompanyReports=Array.from({length:365},(_,i)=>({id:`CLOSE-${200-i}`,day:200-i,net:1.2e6+((200-i)%5)*1e5}));s.simSeconds=200*86400;s.profile.creditRating='A';s.profile.reputation=80;s.advanced.valuation.day=null;GH_CORPORATE_CORE.execute({state:s},'close-valuation',{day:200});});
 await fixture();const fair=await page.evaluate(()=>__GH_STATE__.advanced.valuation.fair);assert(fair>1e9,`3: a ready group (${fair})`);
 for(const float of [10,15,20,25,30]){const terms=await page.evaluate(f=>GH_CORPORATE_CORE.ipoTerms(__GH_STATE__,f),float);text=await open(`ipo:${float}`);
  assert.equal(terms.ready,true);assert.equal(terms.founderShares,Math.round(fair/25/1e7)*1e7,'3: founder shares near $25 a share');assert(Math.abs(terms.valueShare-25)<1.5,`3: ${terms.valueShare}`);
  assert(Math.abs(terms.offered/terms.totalShares*100-float)<1e-4,`3: ${float}% offered`);assert(terms.price>=terms.low-.01&&terms.price<=terms.high+.01,`3: price in range ${JSON.stringify(terms)}`);
  assert(Math.abs(terms.fees-(terms.proceeds*.03+3e6))<.01&&Math.abs(terms.net-(terms.proceeds-terms.fees))<.01,'3: fees and net');
  for(const shown of [terms.founderShares,terms.offered,terms.totalShares].map(n=>n.toLocaleString('en-US')))assert(text.includes(shown),`3: the page shows ${shown}`);assert(text.includes(`$${terms.price.toFixed(2)}`),'3: the price');}
 // 4
 const before=await page.evaluate(()=>JSON.stringify([__GH_STATE__.ipo,__GH_STATE__.finance.transfers.length,__GH_STATE__.saveRevision]));
 await open('ipo:20');await page.locator('#drawerBody .launch-ipo').click();await page.waitForSelector('dialog.ui-confirm[open]');await page.locator('dialog.ui-confirm [data-confirm="cancel"]').click();await settled();
 assert.equal(await page.evaluate(()=>JSON.stringify([__GH_STATE__.ipo,__GH_STATE__.finance.transfers.length,__GH_STATE__.saveRevision])),before,'4: cancelling changes nothing');
 await page.locator('#drawerBody .launch-ipo').click();await page.waitForSelector('dialog.ui-confirm[open]');await page.evaluate(()=>{const v=__GH_STATE__.advanced.valuation;v.fair*=1.05;v.earnings*=1.05;v.nav*=1.05;});
 await page.locator('dialog.ui-confirm [data-confirm="accept"]').click();await page.waitForTimeout(800);await settled();assert.equal(await page.evaluate(()=>__GH_STATE__.ipo?.listed===true),false,'4: a moved price lists nothing');
 // 5
 await fixture();const terms=await page.evaluate(()=>GH_CORPORATE_CORE.ipoTerms(__GH_STATE__,20)),revision=await page.evaluate(()=>__GH_STATE__.saveRevision);
 await open('ipo:20');await page.locator('#drawerBody .launch-ipo').click();await page.waitForSelector('dialog.ui-confirm[open]');assert.match(await page.locator('dialog.ui-confirm p').innerText(),new RegExp(`بسعر \\$${terms.price.toFixed(2)}`));
 await page.locator('dialog.ui-confirm [data-confirm="accept"]').click();await page.waitForFunction(()=>__GH_STATE__.ipo?.listed===true);await settled();
 const listed=await page.evaluate(()=>{const s=__GH_STATE__,t=s.finance.transfers.filter(x=>x.kind==='equity-financing');return {ipo:s.ipo,transfers:t.map(x=>({amount:x.amount,gross:x.grossAmount,deductions:x.deductions,ref:x.reference,signed:Boolean(x.contentDigest)})),fair:s.advanced.valuation.fair,revision:s.saveRevision};});
 assert.equal(listed.transfers.length,1,'5: one equity transfer');const [t]=listed.transfers;assert(Math.abs(t.amount-terms.net)<.01&&Math.abs(t.gross-terms.proceeds)<.01&&Math.abs(t.deductions-terms.fees)<.01&&t.signed,`5: ${JSON.stringify(t)}`);
 const ipo=listed.ipo;assert.equal(ipo.totalShares,terms.totalShares);assert.equal(ipo.sharesIssued,terms.offered);assert.equal(ipo.offerPrice,terms.price);assert.equal(ipo.fees,terms.fees);assert.equal(ipo.lockupUntilDay,ipo.listedDay+180);assert.equal(ipo.capTable.reduce((n,r)=>n+r.shares,0),ipo.totalShares);assert(listed.revision>revision,'5: saved');
 const listedPrice=listed.fair/ipo.totalShares;assert(listedPrice>=ipo.offerPrice,`5: the listed price ${listedPrice} is not below the offer ${ipo.offerPrice}`);assert(Math.abs(listedPrice/terms.fairShare-1)<.005,`5: it is the value per share after the offering (${listedPrice} vs ${terms.fairShare})`);
 // 6
 await page.evaluate(()=>{__GH_STATE__.ipo={listed:false};__AUDIT__.openDrawer('finance','transfers');});const hub=page.locator('#drawerBody [data-open="stocks"][data-arg="ipo"]');assert.equal(await hub.count(),1,'6: the hub links the offering page');
 assert.equal(await page.locator('#drawerBody .launch-ipo').count(),0,'6: and does not list from its own button');
 // 7
 await page.evaluate(()=>{const s=__GH_STATE__;delete s.advanced.valuation;s.groupValue=3e9;s.ipo={listed:true,ticker:'VH',listedDay:10,issuedPct:18,proceeds:3.6e8,offerPrice:20,sharesIssued:18e6,totalShares:1e8,capTable:[{holderId:'founders',label:'المؤسسون',shares:82e6},{holderId:'public-float',label:'المساهمون العموم',shares:18e6}],transferReference:'IPO-VH-10'};});
 text=await open('ipo');assert(text.includes('$30.00')&&text.includes('+50.00%'),'7: the old price until the first valuation');
 // 8
 const weight=await page.evaluate(()=>{const s=__GH_STATE__,C=GH_CORPORATE_CORE;s.finance.dailyCompanyReports=Array.from({length:400},(_,i)=>({id:`CLOSE-${600-i}`,day:600-i,net:1e6+(i%7)*1e5}));
  let t=performance.now();for(let d=601;d<2601;d++)C.execute({state:s},'close-valuation',{day:d});const dayMs=(performance.now()-t)/2000;t=performance.now();for(let i=0;i<2000;i++)C.ipoTerms(s,20);return {dayMs,termsMs:(performance.now()-t)/2000};});
 assert(weight.dayMs<.25,`8: a day's valuation in ${weight.dayMs} ms`);assert(weight.termsMs<.25,`8: the offering's terms in ${weight.termsMs} ms`);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({suite:'build561-ipo-offering-browser',ok:true,offer:terms.price,listedPrice:+listedPrice.toFixed(2),net:terms.net,dayUs:+(weight.dayMs*1000).toFixed(1),termsUs:+(weight.termsMs*1000).toFixed(1)}));
}finally{await browser.close();await env?.closeOrigin?.();}})().catch(error=>{console.error(error);process.exitCode=1;});
