'use strict';
// The group's share after the listing (owner's IPO restructuring, batch 3, and «المؤتمر السنوي يأثر في الاسهم"). Proven on
// the real corporate owner:
//  1. before the listing a close keeps no price; the listing prices its first day at the value per share after the
//     offering × the mood its demand set, starts the chart there and records the listing;
//  2. each close prices the share at the fair value per share × the market's mood; the mood keeps 90% of its distance
//     from 100% and moves at most 1.5% a day more, stays between 85% and 115%, averages 100%, is the same for the same
//     save and day and differs for another save, and advances no random stream (the save's random state is frozen here);
//  3. an annual meeting after the listing moves the mood once, on its day: 3% × (for − against − 60) / 40, at most ±3%
//     (91% for and 4% against: +2%; a cold one: −3%); one held before the listing moves nothing;
//  4. a day's move of 1% or more is kept with its cause: a new rating's multiple, the year's profit (naming the company
//     that made most of the day's loss), the net assets, the meeting; a year of prices and 20 moves are kept;
//  5. a save listed before the fair value prices its first close without a move, then moves like any other;
//  6. weight: a listed day reads only the closes, the statements, the market rows and the holdings, and takes constant
//     work (timing is measured in the app by build563: a VM context slows global lookups).
const assert=require('node:assert/strict'),path=require('node:path');
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {harness}=require('./helpers/core-harness');
const {s:G}=harness(['capability-registry-core','company-definitions','company-platform-core','identity-system','corporate-core']),C=G.GH_CORPORATE_CORE;
const run=(s,c,p)=>C.execute({state:s},c,p),plain=v=>JSON.parse(JSON.stringify(v)),cents=v=>Math.round(v*100)/100;
const near=(a,b,msg,tolerance=1e-9)=>assert(Math.abs(a-b)<=Math.max(1e-9,Math.abs(b)*tolerance),`${msg}: ${a} vs ${b}`);
function world({seed=12345,net=1e6,equity=2e9,grade='BBB'}={}){const s={simSeconds:0,profile:{name:'فنتورا القابضة',creditRating:grade,reputation:60},determinism:Object.freeze({seed,streams:Object.freeze({})}),advanced:{},companyRegistry:{},openedCompanies:[],finance:{dailyCompanyReports:[],transfers:[]},realism:{financial:{consolidated:{equity}}},market:[],portfolio:{},maPortfolio:[],simulationWorld:{competitors:[]},groupValue:0};
 for(let d=200;d>=1;d--)s.finance.dailyCompanyReports.push({day:d,net});return s;}
// One close a day: the day's report first (as the finance owner records it), then the valuation.
function close(s,day,{net=1e6,companies}={}){s.finance.dailyCompanyReports.unshift({day,net,...(companies?{companies}:{})});if(s.finance.dailyCompanyReports.length>400)s.finance.dailyCompanyReports.length=400;return run(s,'close-valuation',{day});}
function list(s,{day=200,demand=.5}={}){const founders=1e8,total=1.25e8,offered=total-founders,offerPrice=20,proceeds=offerPrice*offered,fees=cents(proceeds*.03+3e6),reference=`IPO-VH-${day}`;s.finance.transfers=[{reference,kind:'equity-financing',company:'group',amount:cents(proceeds-fees)}];
 const out=run(s,'set-ipo',{listed:true,ticker:'VH',listedDay:day,issuedPct:20,proceeds,fees,offerPrice,sharesIssued:offered,totalShares:total,capTable:[{holderId:'founders',label:'المؤسس',shares:founders},{holderId:'public-float',label:'مساهمو الطرح',shares:offered}],transferReference:reference,lockupUntilDay:day+180,demand});
 // The statements carry the net proceeds from the next close on, as the realism owner does in the game.
 s.realism.financial.consolidated.equity+=cents(proceeds-fees);return out;}
const listed=options=>{const s=world(options);run(s,'close-valuation',{day:200});list(s,options);return s;};
// 1
{const s=world();const before=run(s,'close-valuation',{day:200});assert.equal(before.price,undefined,'1: no price before the listing');assert.equal(before.history,undefined);
 list(s,{demand:.8});const v=C.valuation(s),mood=.95+.1*.8;near(v.sentiment,mood,'1: the demand sets the first mood');assert.equal(v.price,cents(v.fair/1.25e8*mood),'1: the first price');
 assert.deepEqual(plain(v.history),[[200,v.price]],'1: the chart starts on the listing day');assert.equal(v.prevPrice,20,'1: the first day moves from the offer price');
 assert.deepEqual(plain(v.events),[{day:200,kind:'listing',pct:Math.round((v.price/20-1)*10000)/10000,ticker:'VH',offerPrice:20}],'1: the listing is the first move');}
// 2
{const s=listed(),moods=[];let previous=C.valuation(s).sentiment;
 for(let day=201;day<=2200;day++){const v=close(s,day),drift=1+.9*(previous-1);assert.equal(v.price,cents(Math.max(.01,v.fair/1.25e8)*v.sentiment),`2: day ${day} price`);
  assert(v.sentiment>=.85&&v.sentiment<=1.15,`2: day ${day} mood ${v.sentiment}`);assert(Math.abs(v.sentiment-drift)<=.015+1e-12||v.sentiment===.85||v.sentiment===1.15,`2: day ${day} moved ${v.sentiment-drift}`);moods.push(v.sentiment);previous=v.sentiment;}
 const mean=moods.reduce((a,b)=>a+b,0)/moods.length,spread=Math.max(...moods)-Math.min(...moods);assert(Math.abs(mean-1)<.01,`2: the mood averages 100% (${mean})`);assert(spread>.02,`2: and moves (${spread})`);
 const again=listed(),other=listed({seed:999});for(let day=201;day<=260;day++){close(again,day);close(other,day);}
 const first=listed();for(let day=201;day<=260;day++)close(first,day);assert.deepEqual(plain(C.valuation(first).history),plain(C.valuation(again).history),'2: the same save and days give the same prices');
 assert.notDeepEqual(plain(C.valuation(other).history.slice(1)),plain(C.valuation(again).history.slice(1)),'2: another save moves otherwise');}
// 3
{const warm=listed(),plainDay=listed();warm.profile.agm={year:2027,day:230,ratingAdjust:0,positive:91,negative:4};for(let day=201;day<=229;day++){close(warm,day);close(plainDay,day);}
 const a=close(warm,230),b=close(plainDay,230);near(a.sentiment-b.sentiment,.03*(91-4-60)/40,'3: a warm reception (91% for, 4% against) lifts the mood 2%',1e-9);const event=a.events.find(row=>row.kind==='agm');assert(event&&event.year===2027&&event.positive===91&&event.negative===4&&event.pct>.015&&event.pct<.025,`3: the meeting is a move ${JSON.stringify(a.events)}`);
 const a2=close(warm,231),b2=close(plainDay,231);near(a2.sentiment-b2.sentiment,.9*.03*(91-4-60)/40,'3: once a year: the next day only reverts',1e-9);
 const cold=listed(),still=listed();cold.profile.agm={year:2027,day:230,ratingAdjust:0,positive:30,negative:40};for(let day=201;day<=230;day++){close(cold,day);close(still,day);}near(C.valuation(cold).sentiment-C.valuation(still).sentiment,-.03,'3: a cold reception lowers it 3%',1e-9);
 const early=world(),control=world();early.profile.agm={year:2026,day:150,ratingAdjust:0,positive:91,negative:4};for(const s of [early,control]){run(s,'close-valuation',{day:200});list(s);close(s,201);}assert.equal(C.valuation(early).sentiment,C.valuation(control).sentiment,'3: a meeting before the listing moves nothing');}
// 4
{const s=listed();for(let day=201;day<=210;day++)close(s,day);
 s.profile.creditRating='A';let v=close(s,211);const rating=v.events.find(row=>row.kind==='rating'&&row.day===211);assert(rating&&rating.grade==='A'&&rating.from==='BBB'&&rating.multiple===16&&rating.prevMultiple===12&&rating.pct>.1,`4: the rating's multiple ${JSON.stringify(v.events[0])}`);
 v=close(s,212,{net:-400e6,companies:{sea:{net:-380e6},air:{net:-30e6},road:{net:10e6}}});const loss=v.events.find(row=>row.kind==='profit'&&row.day===212);assert(loss&&loss.pct<-.01&&loss.company==='sea'&&loss.companyNet===-380e6&&loss.net===-400e6,`4: the year's profit names the company ${JSON.stringify(v.events.slice(0,3))}`);
 const equity0=s.realism.financial.consolidated.equity;s.realism.financial.consolidated.equity*=1.6;v=close(s,213);const assets=v.events.find(row=>row.kind==='assets'&&row.day===213);assert(assets&&assets.pct>.01,`4: the net assets ${JSON.stringify(v.events.slice(0,3))}`);near(assets.amount,.6*equity0,'4: by the change in the net assets',1e-9);
 for(const row of v.events)assert(Math.abs(row.pct)>=.01,'4: only moves of 1% or more');
 for(let day=214;day<=640;day++){s.realism.financial.consolidated.equity*=day%2?1.2:1/1.2;close(s,day);}v=C.valuation(s);assert.equal(v.history.length,365,'4: a year of prices');assert.deepEqual(plain(v.history.at(-1)),[640,v.price]);assert.equal(v.history[0][0],640-364);assert.equal(v.events.length,20,'4: 20 moves');assert.equal(v.events[0].day,640);}
// 5
{const s=world();s.ipo={listed:true,ticker:'VH',listedDay:10,issuedPct:18,proceeds:3.6e8,offerPrice:20,sharesIssued:18e6,totalShares:1e8,capTable:[{holderId:'founders',label:'المؤسسون',shares:82e6},{holderId:'public-float',label:'المساهمون العموم',shares:18e6}],transferReference:'IPO-VH-10'};
 let v=close(s,201);assert(v.price>0&&v.prevPrice===v.price&&!(v.events||[]).length,'5: the first close prices without a move');s.realism.financial.consolidated.equity*=1.5;v=close(s,202);assert(v.events.some(row=>row.kind==='assets'),'5: then moves like any other');}
// 6
{const s=listed();for(const key of ['fleet','assets','leasedAssets','globalBases','customHubs','crew','hr','companyFinance','treasury'])Object.defineProperty(s,key,{get(){throw new Error(`6: the share read ${key}`);},enumerable:false});
 const reports=s.finance.dailyCompanyReports;s.finance={dailyCompanyReports:reports};for(const key of ['transfers','journalEntries','invoices','payables','receivables','cheques'])Object.defineProperty(s.finance,key,{get(){throw new Error(`6: the share read finance.${key}`);},enumerable:false});
 for(let day=201;day<=1200;day++)close(s,day,{net:1e6+(day%7)*1e5,companies:{air:{net:1e6},sea:{net:(day%7)*1e5}}});
 console.log(JSON.stringify({suite:'build562-group-share-price',ok:true,price:C.valuation(s).price,events:C.valuation(s).events.length}));}
