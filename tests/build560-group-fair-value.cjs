'use strict';
// The group's fair value (owner: a value that rises and falls with profit, losses, debt, sales and the conference, with no
// weight on the game). Proven on the real corporate owner, from the figures the daily close already has:
//  1. earnings value = the last 365 days' net profit × the credit rating's multiple (8 to 16); fewer than 30 days of
//     closes count as no year yet, and a shorter year is annualised;
//  2. net assets = the statements' equity + listed shares and stakes at market + the facilities' value, which loses 4%
//     a year; fair value = 60% earnings + 40% net assets, never under 80% of the net assets;
//  3. losses lower it, a lower rating lowers it, selling a stake above its price raises it;
//  4. a day is worked out once; the annual meeting keeps the conference's reception;
//  5. a day reads only the closes, the statements, the market rows and the holdings, never the fleet or the records;
//  6. the offering's demand reads a reputation of 0 as the lowest, and a missing one as the middle.
const assert=require('node:assert/strict'),path=require('node:path');
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {harness}=require('./helpers/core-harness');
const {s:G}=harness(['capability-registry-core','company-definitions','company-platform-core','identity-system','corporate-core']),C=G.GH_CORPORATE_CORE;
const run=(s,c,p)=>C.execute({state:s},c,p);
function world({days=0,net=0,equity=1e9,grade='BBB'}={}){const s={simSeconds:0,profile:{name:'فنتورا القابضة',creditRating:grade},advanced:{},companyRegistry:{},openedCompanies:[],finance:{dailyCompanyReports:[]},realism:{financial:{consolidated:{equity}}},market:[{sym:'GLTR',price:80},{sym:'BANK',price:40}],portfolio:{},maPortfolio:[],simulationWorld:{competitors:[{id:'C1',price:200e6}]},groupValue:0};for(let d=days;d>=1;d--)s.finance.dailyCompanyReports.push({day:d,net:typeof net==='function'?net(d):net});return s;}
const near=(a,b,msg)=>assert(Math.abs(a-b)<=Math.max(1e-6,Math.abs(b)*1e-9),`${msg}: ${a} vs ${b}`);
// 1
{const young=world({days:20,net:1e6});const v=run(young,'close-valuation',{day:20});assert.equal(v.profit12,0,'1: under 30 days there is no year yet');near(v.fair,.8*1e9,'1: so the floor holds');
 const half=world({days:180,net:1e6});near(run(half,'close-valuation',{day:180}).profit12,180e6*365/180,'1: a half year is annualised');
 const year=world({days:400,net:1e6});const y=run(year,'close-valuation',{day:400});near(y.profit12,365e6,'1: only the last 365 days count');near(y.earnings,365e6*12,'1: × the BBB multiple');
 for(const [grade,multiple] of [['A',16],['A-',14],['BBB+',13],['BBB',12],['BBB-',11],['BB+',9],['BB',8],['??',12]])assert.equal(run(world({days:40,net:1,grade}),'close-valuation',{day:40}).multiple,multiple,`1: ${grade}`);}
// 2
{const s=world({days:365,net:2e6,equity:3e9});s.portfolio={GLTR:1000,BANK:500};s.maPortfolio=[{id:'C1',stake:25}];run(s,'adjust-group-value',{delta:100e6,kind:'facility'});run(s,'adjust-group-value',{delta:50e6});
 const v=run(s,'close-valuation',{day:365}),holdings=1000*80+500*40+.25*200e6;near(v.holdings,holdings,'2: holdings at market');near(v.facilityBook,100e6,'2: only facilities count as facilities');near(v.nav,3e9+holdings+100e6,'2: net assets');near(v.fair,Math.max(.6*730e6*12+.4*v.nav,.8*v.nav),'2: the blend');
 const later=run(s,'close-valuation',{day:365+365});near(later.facilityBook,100e6*.96,'2: facilities lose 4% a year');}
// 3
{const a=world({days:365,net:1e6}),b=world({days:365,net:d=>d===365?1e6-200e6:1e6});const va=run(a,'close-valuation',{day:365}),vb=run(b,'close-valuation',{day:365});assert(vb.fair<va.fair,'3: a loss lowers it');
 const lower=run(world({days:365,net:1e6,grade:'BB'}),'close-valuation',{day:365});assert(lower.fair<va.fair,'3: a lower rating lowers it');
 const losing=run(world({days:365,net:-1e6}),'close-valuation',{day:365});near(losing.fair,.8*1e9,'3: a losing year leaves the net assets floor');
 const held=world({days:365,net:1e6}),sold=world({days:365,net:1e6});held.maPortfolio=[{id:'C1',stake:10}];sold.realism.financial.consolidated.equity+=.1*200e6*1.2;assert(run(sold,'close-valuation',{day:365}).fair>run(held,'close-valuation',{day:365}).fair,'3: a stake sold above its price raises it');}
// 4
{const s=world({days:365,net:1e6}),first=run(s,'close-valuation',{day:365});s.realism.financial.consolidated.equity*=2;assert.equal(run(s,'close-valuation',{day:365}).fair,first.fair,'4: once a day');
 const agm=run(s,'record-agm',{year:2026,day:300,ratingAdjust:6,positive:91,negative:4});assert.equal(agm.positive,91);assert.equal(agm.negative,4);assert.equal(run(s,'record-agm',{year:2027,day:600,ratingAdjust:0}).positive,undefined,'4: an annual meeting without a conference keeps no reception');}
// 5
// The day reads only the closes, the statements, the market rows and the holdings: the fleet, the assets and the
// records are traps that fail the test if touched. (Timing is measured in the app: a VM context slows global lookups.)
{const s=world({days:400,net:1e6});for(const key of ['fleet','assets','leasedAssets','globalBases','customHubs','crew','hr','companyFinance','treasury'])Object.defineProperty(s,key,{get(){throw new Error(`5: the valuation read ${key}`);},enumerable:false});
 for(const key of ['transfers','journalEntries','invoices','payables','receivables','cheques'])Object.defineProperty(s.finance,key,{get(){throw new Error(`5: the valuation read finance.${key}`);},enumerable:false});
 for(let d=401;d<500;d++)run(s,'close-valuation',{day:d});
 }
// 6
{const s=world({days:365,net:1e6});run(s,'close-valuation',{day:365});s.profile.reputation=0;const low=C.ipoTerms(s,20);delete s.profile.reputation;const middle=C.ipoTerms(s,20);
 assert.equal(low.reputation,-1,'6: a reputation of 0 is the lowest');assert.equal(middle.reputation,0,'6: a missing reputation is the middle');assert(low.demand<middle.demand,'6: and lowers the demand');
 console.log(JSON.stringify({suite:'build560-group-fair-value',ok:true}));}
