'use strict';
// The owner's delegated decisions after the IPO restructuring («اعتمد اللي تشوفه مناسب»). Proven on the real corporate
// and facility owners:
//  1. the offering counts its net proceeds at their full value: the value per share after it is the value before plus
//     the proceeds, so the founder's shares lose only the offer's discount and the fees (under 4% of their value at a
//     20% float and an average demand; weighing the proceeds at 40% took over 10%);
//  2. that fresh capital fades into the blend over a year (half after six months, none after a year), never counts above
//     the net assets, and the price follows it; a year of fading alone records no move;
//  3. closing a facility takes back what it added to the facilities' value, aged at 4% a year; an expansion adds to it;
//     a facility from before this takes nothing back.
const assert=require('node:assert/strict'),path=require('node:path');
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {harness}=require('./helpers/core-harness'),{scenario}=require('./helpers/business-scenario.js');
const {s:G}=harness(['capability-registry-core','company-definitions','company-platform-core','identity-system','corporate-core']),C=G.GH_CORPORATE_CORE;
const run=(s,c,p)=>C.execute({state:s},c,p),cents=v=>Math.round(v*100)/100,blend=(e,n)=>Math.max(0,.6*e+.4*n,.8*n);
const near=(a,b,msg,tolerance=1e-9)=>assert(Math.abs(a-b)<=Math.max(1e-6,Math.abs(b)*tolerance),`${msg}: ${a} vs ${b}`);
function world(){const s={simSeconds:200*86400,profile:{name:'فنتورا القابضة',creditRating:'BBB',reputation:50},determinism:{seed:7},advanced:{},companyRegistry:{},openedCompanies:[],finance:{dailyCompanyReports:[],transfers:[]},realism:{financial:{consolidated:{equity:2.5e9}}},market:[],portfolio:{},maPortfolio:[],simulationWorld:{competitors:[]},groupValue:0};
 for(let d=200;d>=1;d--)s.finance.dailyCompanyReports.push({day:d,net:1.2e6});run(s,'close-valuation',{day:200});return s;}
function list(s,terms){const reference='IPO-VH-200';s.finance.transfers=[{reference,kind:'equity-financing',company:'group',amount:terms.net}];
 run(s,'set-ipo',{listed:true,ticker:'VH',listedDay:200,issuedPct:terms.issuedPct,proceeds:terms.proceeds,fees:terms.fees,offerPrice:terms.price,sharesIssued:terms.offered,totalShares:terms.totalShares,capTable:[{holderId:'founders',label:'المؤسس',shares:terms.founderShares},{holderId:'public-float',label:'مساهمو الطرح',shares:terms.offered}],transferReference:reference,lockupUntilDay:380,demand:terms.demand});
 s.realism.financial.consolidated.equity+=terms.net;return C.valuation(s);}
// 1
{const s=world(),before=C.valuation(s),terms=C.ipoTerms(s,20);assert.equal(terms.ready,true,'1: a group the offering accepts');
 const v=list(s,terms),pre=blend(before.earnings,before.nav);near(v.fair,pre+terms.net,'1: the value before plus the net proceeds',1e-12);near(v.fresh,terms.net,'1: all of it fresh');
 near(v.fair/terms.totalShares,terms.fairShare,'1: the offering was priced on that value',.002);
 const founder=terms.founderShares*v.fair/terms.totalShares,weighed=terms.founderShares*blend(before.earnings,before.nav+terms.net)/terms.totalShares;
 assert(founder/pre>.96,`1: the founder keeps ${(founder/pre*100).toFixed(1)}% of the value`);assert(weighed/pre<.9,`1: against ${(weighed/pre*100).toFixed(1)}% when the proceeds were weighed at 40%`);}
// 2
{const s=world(),terms=C.ipoTerms(s,20),v0=list(s,terms),mood=()=>C.valuation(s).sentiment;
 for(let day=201;day<=382;day++){s.finance.dailyCompanyReports.unshift({day,net:1.2e6});run(s,'close-valuation',{day});}
 let v=C.valuation(s);near(v.fresh,terms.net*(1-182/365),'2: half of it after six months',1e-9);assert.equal(v.price,cents(Math.max(.01,v.fair/terms.totalShares)*mood()),'2: the price follows the value');
 for(let day=383;day<=565;day++){s.finance.dailyCompanyReports.unshift({day,net:1.2e6});if(s.finance.dailyCompanyReports.length>400)s.finance.dailyCompanyReports.length=400;run(s,'close-valuation',{day});}
 v=C.valuation(s);assert.equal(v.fresh,0,'2: none after a year');near(v.fair,blend(v.earnings,v.nav),'2: back to the blend',1e-12);
 assert.deepEqual(JSON.parse(JSON.stringify(v.events.map(row=>row.kind))),['listing'],`2: a year of fading records no move ${JSON.stringify(v.events)}`);
 const poor=world(),t2=C.ipoTerms(poor,20);list(poor,t2);poor.realism.financial.consolidated.equity=t2.net/4;poor.finance.dailyCompanyReports.unshift({day:201,net:1.2e6});run(poor,'close-valuation',{day:201});
 near(C.valuation(poor).fresh,t2.net/4,'2: never above the net assets',1e-12);void v0;}
// 3
{const env=scenario(),{s,state,command}=env;state.godMoney=false;state.infiniteMoney=false;const value=()=>s.GH_CORPORATE_CORE.valuation(state).facilityBook||0;
 const airport=s.GH_WORLD_DATA.airports.find(row=>row[0]==='OEJN');state.simSeconds=10*86400;
 command('facilities','create',{facility:{id:'B2',name:'Second airport',kind:'airport-base',company:'air',owned:true,sourceKey:`air:${airport[0]}`,code:airport[1]||airport[0],icao:airport[0],iata:airport[1],city:airport[3]||airport[4]||'—',country:new Intl.DisplayNames(['ar'],{type:'region'}).of(airport[5]),coords:[airport[6],airport[7]]},groupValueAdd:100e6});
 near(value(),100e6,'3: the facility adds its value');assert.equal(state.advanced.facilities.B2.bookValue,100e6);assert.equal(state.advanced.facilities.B2.bookDay,10);
 s.GH_CORPORATE_CORE.execute({state},'close-valuation',{day:10});const groupValue0=state.groupValue,book0=value();state.simSeconds=375*86400;s.GH_CORPORATE_CORE.execute({state},'close-valuation',{day:375});near(value(),book0*.96,'3: a year later it is worth 4% less',1e-9);
 command('facilities','close',{id:'B2'});near(value(),0,'3: closing it takes back its aged part',1e-9);near(groupValue0-state.groupValue,100e6*.96,'3: from the group value too',1e-9);
 const before=JSON.stringify([value(),state.groupValue]);command('facilities','close',{id:'B1'});assert.equal(JSON.stringify([value(),state.groupValue]),before,'3: a facility from before this takes nothing back');}
console.log(JSON.stringify({suite:'build566-fresh-capital-facility-book',ok:true}));
