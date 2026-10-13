/* Build 374 · مدار: one customer base for every company without transport assets.
   Each country is one market of households and businesses (the same population the bank and the insurer already
   size their branches from). The base reads how many of them each company serves from that company's own records
   and never writes the state: it adds nothing to the save. Telecom and the car dealership grow their customers from
   it (with the reach of the group's other companies in the same country), and the customer views read their counts
   from it. Load: one pass over branches, offices, projects and contracts (tens to hundreds of rows), memoised per day;
   no pass over the fleet, the documents or the ledger. */
(()=>{'use strict';
const VERSION='GH-CUSTOMER-BASE-1.0.0';
const HOUSEHOLD_SIZE=4.5,BUSINESS_PER_PEOPLE=40,DEFAULT_POPULATION=10000000,UNKNOWN='غير محدد';
const COMPANIES=Object.freeze(['bank','insurance','realestate','telecom','dealership','power']);
// A household holds several of one insurer's policies; its customers are its widest household line.
const HOUSEHOLD_LINES=Object.freeze(['motor','health','property']);
const BUSINESS_TYPES=Object.freeze(new Set(['office','retail','logistics']));
// A household keeps about two mobile lines; a home or family plan is one household.
const MOBILE_LINES_PER_HOUSEHOLD=2;
// Build 377: a bank's retail customers are people. 55% of people bank (banking-core BANKED_SHARE) in households of 4.5,
// so a household holds about 2.5 of them; counting each customer as a household overstated the bank's reach 2.5 times.
const BANK_CUSTOMERS_PER_HOUSEHOLD=.55*HOUSEHOLD_SIZE;
// Build 377: a car buyer stays a customer while the car is on the road: about eight years of a showroom's sales (the
// cars its workshop serves, dealer-market-core SERVICE_BASE_YEARS), not every car it ever sold.
const CAR_OWNERSHIP_YEARS=8;
// A sale with its car handed over: invoiced to the buyer, or paid by the bank's financing.
const SOLD=Object.freeze(new Set(['awaiting-collection','sold-collected','sold-on-credit','sold-financed']));
const num=value=>Math.max(0,Number(value)||0);
const countryOf=value=>String(value||'').trim()||UNKNOWN;

// Population: the bank's table (small states) and the map labels. A value is cached only once the labels are loaded,
// so an early read never pins the default. Engines that simulate keep the population on their own rows, as the bank
// and the insurer do, so a save simulates the same everywhere.
const populations=new Map();
function population(country){
  const name=countryOf(country);if(name===UNKNOWN)return DEFAULT_POPULATION;
  const cached=populations.get(name);if(cached)return cached;
  let value=0;try{value=Number(globalThis.GH_BANKING_CORE?.countryPopulation?.(name))||0;}catch(_error){value=0;}
  const labels=Array.isArray(globalThis.GH_MAP_LABELS)?globalThis.GH_MAP_LABELS:null;
  if(!(value>0)&&labels)value=Number(labels.find(item=>item?.name===name)?.population)||0;
  if(!(value>0))value=DEFAULT_POPULATION;
  if(labels)populations.set(name,value);
  return value;
}
function market(country,pinned){
  const people=Number(pinned)>0?Number(pinned):population(country);
  return {country:countryOf(country),population:people,households:Math.max(1,Math.round(people/HOUSEHOLD_SIZE)),businesses:Math.max(1,Math.round(people/BUSINESS_PER_PEOPLE))};
}

// Readers: each returns [{country,households,businesses,population}] from the owner's records, read-only.
const list=value=>Array.isArray(value)?value:[];
const READERS=Object.freeze({
  bank(state){return list(state.bank?.branchNetwork).filter(row=>row&&row.servicesActive!==false).map(row=>({country:row.country,population:row.marketPopulation,households:num(row.retailCustomers)/BANK_CUSTOMERS_PER_HOUSEHOLD,businesses:num(row.businessCustomers)}));},
  insurance(state){return list(state.insurance?.offices).map(row=>{const lines=row?.lines||{};return {country:row?.country,population:row?.marketPopulation,households:Math.max(0,...HOUSEHOLD_LINES.map(id=>num(lines[id]?.policies))),businesses:num(lines.commercial?.policies)};});},
  realestate(state){return list(state.realEstate?.projects).map(row=>{const units=num(row?.sold)+num(row?.presold)+num(row?.leased),business=BUSINESS_TYPES.has(String(row?.type||''));return {country:row?.country,households:business?0:units,businesses:business?units:0};});},
  telecom(state){
    const data=state.customerCompanies?.companies?.telecom,rows=[];
    for(const branch of list(data?.market?.branches)){const plans=branch?.plans||{};rows.push({country:branch?.country,population:branch?.marketPopulation,households:num(plans.home?.subscribers)+num(plans.family?.subscribers)+Math.round(num(plans.mobile?.subscribers)/MOBILE_LINES_PER_HOUSEHOLD),businesses:num(plans.business?.subscribers)});}
    for(const contract of list(data?.market?.contracts))if(contract?.status==='active')rows.push({country:contract.country,households:0,businesses:1});
    for(const cohort of list(data?.cohorts))if(cohort?.status==='active'){const consumer=String(cohort.segment||'consumer')==='consumer';rows.push({country:cohort.country,households:consumer?num(cohort.activeCustomers):0,businesses:consumer?0:num(cohort.activeCustomers)});}
    for(const row of list(data?.subscriptions))if(row?.status==='active'){const business=row.planId==='business';rows.push({country:row.branchCountry,households:business?0:1,businesses:business?1:0});}
    return rows;
  },
  dealership(state){
    const data=state.customerCompanies?.companies?.dealership,rows=[];
    for(const showroom of list(data?.market?.showrooms))rows.push({country:showroom?.country,population:showroom?.marketPopulation,households:Math.min(num(showroom?.buyers),num(showroom?.annualRate)*CAR_OWNERSHIP_YEARS),businesses:0});
    for(const sale of list(data?.sales))if(sale&&!sale.marketSale&&SOLD.has(String(sale.status||'')))rows.push({country:sale.branchCountry,households:num(sale.quantity)||1,businesses:0});
    return rows;
  },
  power(state){
    const sites=new Map(list(state.energy?.sites).map(site=>[site?.id,site]));
    return list(state.energy?.ppaContracts).filter(row=>row?.status==='ساري').map(row=>({country:sites.get(row.siteId)?.country,households:0,businesses:1}));
  }
});

// The base for every country the group serves. Memoised on the state object for one day and one shape: the counts
// change at the daily close and when a branch, office, project or contract is added or removed.
const memo=new WeakMap();
function signature(state){
  const day=Math.floor(num(state.simSeconds)/86400),tel=state.customerCompanies?.companies?.telecom,dealer=state.customerCompanies?.companies?.dealership;
  return [day,state.bank?.lastProcessedDay,list(state.bank?.branchNetwork).length,state.insurance?.lastProcessedDay,list(state.insurance?.offices).length,state.realEstate?.lastProcessedDay,list(state.realEstate?.projects).length,tel?.market?.lastProcessedDay,list(tel?.market?.branches).length,list(tel?.market?.contracts).length,list(tel?.cohorts).length,list(tel?.subscriptions).length,dealer?.market?.lastProcessedDay,list(dealer?.market?.showrooms).length,list(dealer?.sales).length,list(state.energy?.ppaContracts).length].join('|');
}
function snapshot(state){
  if(!state||typeof state!=='object')return {countries:[],byCountry:{},totals:{households:0,businesses:0,customers:0,byCompany:{}}};
  const key=signature(state),prior=memo.get(state);if(prior&&prior.key===key)return prior.value;
  const byCountry={},byCompany={};
  for(const company of COMPANIES){
    byCompany[company]={households:0,businesses:0};
    let rows=[];try{rows=READERS[company](state);}catch(_error){rows=[];}
    for(const row of rows){
      const country=countryOf(row.country),entry=byCountry[country]||(byCountry[country]={...market(country,row.population),companies:{}}),own=entry.companies[company]||(entry.companies[company]={households:0,businesses:0});
      if(!(Number(entry.pinned)>0)&&Number(row.population)>0){Object.assign(entry,market(country,row.population));entry.pinned=Number(row.population);}
      own.households+=num(row.households);own.businesses+=num(row.businesses);byCompany[company].households+=num(row.households);byCompany[company].businesses+=num(row.businesses);
    }
  }
  const countries=Object.values(byCountry).map(entry=>{entry.reachHouseholds=reachOf(entry,'households');entry.reachBusinesses=reachOf(entry,'businesses');return entry;}).sort((a,b)=>b.population-a.population||a.country.localeCompare(b.country));
  const totals={byCompany,households:0,businesses:0,customers:0};
  for(const entry of countries){totals.households+=Math.round(entry.reachHouseholds*entry.households);totals.businesses+=Math.round(entry.reachBusinesses*entry.businesses);}
  totals.customers=totals.households+totals.businesses;
  const value={countries,byCountry,totals};memo.set(state,{key,value});return value;
}
// Share of a country's pool served by at least one of the given companies (independent companies: 1-Π(1-p)).
function reachOf(entry,pool,except=null){
  let none=1;for(const [company,row] of Object.entries(entry.companies||{})){if(company===except)continue;none*=1-Math.min(1,num(row[pool])/Math.max(1,num(entry[pool])));}
  return 1-none;
}
// Build 377 (owner's decision: each country buys at its own income). GDP per person in US dollars (Natural Earth
// admin-0 countries, GDP_MD / POP_EST, World Bank estimates, mostly 2019), one fixed number per country. Prices were
// calibrated on Riyadh, so Saudi Arabia is the reference (1); a country's price and spending follow its income at a
// sector's elasticity (a phone plan or a flat costs less where people earn less, but not in proportion). A pure lookup:
// nothing is written to the state or the save, and an unknown country is priced as the reference.
const INCOME_PER_PERSON=Object.freeze({'آيسلندا':66940,'أذربيجان':4790,'أرمينيا':4620,'أستراليا':55060,'أفريقيا الوسطى':470,'أفغانستان':510,'ألبانيا':5350,'ألمانيا':46440,'أندورا':40890,'أنغولا':2790,'أوزبكستان':1720,'أوغندا':790,'أوكرانيا':3460,'أيرلندا':78660,'إثيوبيا':860,'إريتريا':340,'إسبانيا':29600,'إستونيا':23720,'إسرائيل':43590,'إسواتيني':3890,'إندونيسيا':4140,'إيران':5480,'إيطاليا':33230,'الأرجنتين':9910,'الأردن':4400,'الأوروغواي':16190,'الإكوادور':6180,'الإمارات':43100,'الإمارات العربية المتحدة':43100,'الباهاما':34860,'البحرين':23500,'البرازيل':8720,'البرتغال':23250,'البوسنة والهرسك':6110,'التشيك':23500,'الجبل الأسود':8910,'الجزائر':3970,'الدنمارك':60170,'الرأس الأخضر':3600,'السعودية':23140,'السلفادور':4190,'السنغال':1450,'السودان':710,'السويد':51620,'الصحراء الغربية':1500,'الصومال':460,'الصين':10260,'العراق':5960,'الغابون':7770,'الفلبين':3480,'الكاميرون':1510,'الكونغو':2280,'الكونغو الديمقراطية':580,'الكويت':32000,'المالديف':10630,'المجر':16730,'المغرب':3280,'المكسيك':9950,'المملكة المتحدة':42330,'النرويج':75420,'النمسا':50140,'النيجر':550,'الهند':2100,'الولايات المتحدة':65300,'اليابان':40250,'اليمن':770,'اليونان':19580,'بابوا غينيا الجديدة':2830,'باراغواي':5420,'باكستان':1280,'بالاو':14880,'باهاماس':34860,'بربادوس':18150,'بروناي':31090,'بلجيكا':46420,'بلغاريا':9830,'بليز':4810,'بنغلاديش':1860,'بنما':15730,'بنين':1220,'بوتان':3320,'بوتسوانا':7960,'بورتوريكو':32870,'بوركينا فاسو':790,'بوروندي':260,'بولندا':15690,'بوليفيا':3550,'بيرو':6980,'بيلاروسيا':6660,'تايلاند':7810,'تايوان':47820,'تركمانستان':6860,'تركيا':9130,'ترينيداد وتوباغو':17400,'تشاد':710,'تشيلي':14900,'تنزانيا':1090,'توغو':680,'توفالو':4040,'تونس':3320,'تونغا':4900,'تيمور الشرقية':1560,'جامايكا':5580,'جرينلاند':54260,'جزر القمر':1370,'جزر سليمان':2370,'جزر مارشال':3760,'جمهورية أفريقيا الوسطى':470,'جمهورية أيرلندا':78660,'جمهورية الدومينيكان':8280,'جمهورية الكونغو':2280,'جمهورية الكونغو الديمقراطية':580,'جنوب أفريقيا':6000,'جنوب السودان':1080,'جورجيا':4700,'جيبوتي':3410,'رواندا':820,'روسيا':11770,'رومانيا':12920,'زامبيا':1300,'زيمبابوي':1460,'ساحل العاج':2280,'ساموا':4320,'سان مارينو':48880,'ساو تومي وبرينسيب':1940,'سريلانكا':3850,'سلطنة عمان':15340,'سلوفاكيا':19270,'سلوفينيا':25950,'سنغافورة':65230,'سوريا':5790,'سورينام':6360,'سويسرا':81990,'سيراليون':530,'سيشل':17440,'صربيا':7410,'صوماليلاند':3500,'طاجيكستان':870,'عُمان':15340,'غامبيا':780,'غانا':2200,'غواتيمالا':4620,'غيانا':6610,'غينيا':960,'غينيا الاستوائية':8130,'غينيا بيساو':700,'فانواتو':3120,'فرنسا':40490,'فلسطين':3470,'فنزويلا':16920,'فنلندا':48780,'فيتنام':2720,'فيجي':6180,'قبرص':20820,'قبرص الشمالية':11040,'قطر':62090,'قيرغيزستان':1310,'كازاخستان':9810,'كاليدونيا الجديدة':37420,'كرواتيا':14940,'كمبوديا':1640,'كندا':46200,'كوبا':8820,'كوريا الجنوبية':31850,'كوريا الشمالية':1560,'كوستاريكا':12240,'كوسوفو':4420,'كولومبيا':6430,'كيريباس':1650,'كينيا':1820,'لاتفيا':17830,'لاوس':2540,'لبنان':7580,'لوكسمبورغ':114700,'ليبيا':7690,'ليبيريا':620,'ليتوانيا':19600,'ليختنشتاين':180860,'ليسوتو':1120,'مالاوي':410,'مالطا':29820,'مالي':880,'ماليزيا':11410,'مدغشقر':520,'مصر':3020,'مقدونيا الشمالية':6020,'ملاوي':410,'منغوليا':4340,'موريتانيا':1680,'موريشيوس':11100,'موزمبيق':500,'مولدوفا':4500,'موناكو':184480,'ميانمار':1410,'ميكرونيسيا':3520,'ناميبيا':4960,'ناورو':9380,'نيبال':1070,'نيجيريا':2230,'نيكاراغوا':1910,'نيوزيلندا':42080,'هايتي':1270,'هندوراس':2580,'هولندا':52330});
const INCOME_REFERENCE=INCOME_PER_PERSON['السعودية'],INCOME_RATIO_RANGE=Object.freeze([.02,5]);
const ELASTICITY=Object.freeze({insurancePrice:.8,insuranceReach:.6,telecomPrice:.7,broadbandReach:.5,propertyPrice:.7,carsPerPerson:.9,bankFees:.7,bankDeposits:.8,servicePrice:.5});
function incomePerPerson(country){const value=INCOME_PER_PERSON[countryOf(country)];return Number(value)>0?Number(value):null;}
function incomeRatio(country){const value=incomePerPerson(country);return value?Math.max(INCOME_RATIO_RANGE[0],Math.min(INCOME_RATIO_RANGE[1],value/INCOME_REFERENCE)):1;}
// A country's multiplier for one sector: its income ratio raised to the sector's elasticity.
// Kept per country (as given) and sector: the daily runs ask for the same few numbers for every plan of every branch.
const incomeFactors=new Map();
function incomeFactor(country,sector){
  let row=incomeFactors.get(country);if(!row){row=Object.create(null);incomeFactors.set(country,row);}
  let value=row[sector];if(value===undefined){const e=Number(ELASTICITY[sector]);value=row[sector]=Number.isFinite(e)?Math.pow(incomeRatio(country),e):1;}
  return value;
}

// Build 377: the economy these companies sell into, read from the realism economy the game already moves (nothing new
// is stored). Interest: the base rate against its 4.6% mean; a dearer mortgage or car loan means fewer buyers, and some
// would-be buyers rent instead. Activity: the world demand indices (65-145, mean 100) move with growth and credit
// events; households buy more cars, homes and cover when trade is strong. Prices: the wage index (3% a year) is the
// price level: premiums, claims, plans, rents, fees and deposits rise with it.
const REFERENCE_RATE=.046;
const DEMAND=Object.freeze({
  housingSale:Object.freeze({activity:1,rate:-6,min:.6,max:1.3}),
  housingLease:Object.freeze({activity:.5,rate:2,min:.85,max:1.15}),
  cars:Object.freeze({activity:1.2,rate:-3,min:.7,max:1.2}),
  insurance:Object.freeze({activity:.5,rate:0,min:.85,max:1.15}),
  telecom:Object.freeze({activity:.3,rate:0,min:.9,max:1.1})
});
function economyOf(state){return state?.realism?.economy||state?.advanced?.economy||null;}
function economicConditions(state){
  const e=economyOf(state),rate=Number(e?.baseRate),wage=Number(e?.wageIndex),demand=['airDemand','seaDemand','roadDemand'].map(key=>Number(e?.[key])).filter(Number.isFinite);
  return {rate:Number.isFinite(rate)&&rate>0?rate:REFERENCE_RATE,activity:demand.length?Math.max(.75,Math.min(1.25,demand.reduce((a,b)=>a+b,0)/demand.length/100)):1,priceIndex:Number.isFinite(wage)&&wage>0?Math.max(1,Math.min(10,wage)):1};
}
// One sector's demand multiplier today (1 at the reference rate and normal activity).
function demandFactor(state,sector){
  const d=DEMAND[sector];if(!d)return 1;const c=economicConditions(state);
  return Math.max(d.min,Math.min(d.max,Math.pow(c.activity,d.activity)*(1+d.rate*(c.rate-REFERENCE_RATE))));
}
function priceIndex(state){return economicConditions(state).priceIndex;}
// Build 377: the property market's value level: the price level, lower when money is dear (a higher base rate raises
// the yields investors ask, so prices fall), higher when activity is strong. 1 at the reference economy.
function propertyValue(state){const c=economicConditions(state);return c.priceIndex*Math.max(.75,Math.min(1.25,1-4*(c.rate-REFERENCE_RATE)))*Math.sqrt(c.activity);}

// Build 377: one rival per country and sector. It reprices once a month (30 days), between 6% below and 6% above the
// market, drawn from the country, the sector and the month (nothing stored). Customers compare the group's price with
// the rival's: a cheaper rival slows the group's growth and takes more of its customers.
const RIVAL_RANGE=.06;
function rivalHash(text){let h=2166136261>>>0;for(const ch of String(text)){h^=ch.codePointAt(0);h=Math.imul(h,16777619)>>>0;}h^=h>>>16;h=Math.imul(h,0x85ebca6b)>>>0;h^=h>>>13;h=Math.imul(h,0xc2b2ae35)>>>0;h^=h>>>16;return h>>>0;}
// The current month's prices are kept per country and sector (a new month replaces them).
const rivalPrices=new Map();
function rivalPrice(country,sector,day){
  const month=Math.floor(Math.max(0,Number(day)||0)/30);let row=rivalPrices.get(country);if(!row){row=Object.create(null);rivalPrices.set(country,row);}
  const held=row[sector];if(held&&held.month===month)return held.value;
  const value=1+(rivalHash(`rival|${countryOf(country)}|${sector}|${month}`)/4294967295*2-1)*RIVAL_RANGE;row[sector]={month,value};return value;
}

// Share of the country's households (or businesses) the group's other companies already serve: a bank customer is an
// easier telecom or car customer for the same group. Engines turn it into a bounded conversion boost.
function affinity(state,country,company,pool='households'){const entry=snapshot(state).byCountry[countryOf(country)];return entry?reachOf(entry,pool,company):0;}
// Build 377: the same bounded boost for every company without transport assets (as telecom and the dealer had): half of
// the share of the pool the group's other companies already serve, at most +15%. One memoised read per branch and day.
const AFFINITY_WEIGHT=.5,MAX_AFFINITY_BOOST=.15;
function affinityBoost(state,country,company,pool='households'){return 1+Math.min(MAX_AFFINITY_BOOST,affinity(state,country,company,pool==='businesses'?'businesses':'households')*AFFINITY_WEIGHT);}
function companyCustomers(state,company){const row=snapshot(state).totals.byCompany[company];return row?Math.round(row.households+row.businesses):0;}

const API=Object.freeze({VERSION,COMPANIES,HOUSEHOLD_SIZE,BUSINESS_PER_PEOPLE,DEFAULT_POPULATION,MOBILE_LINES_PER_HOUSEHOLD,INCOME_REFERENCE,ELASTICITY,population,market,incomePerPerson,incomeRatio,incomeFactor,economicConditions,demandFactor,priceIndex,propertyValue,REFERENCE_RATE,rivalPrice,snapshot,affinity,affinityBoost,companyCustomers});
globalThis.GH_CUSTOMER_BASE=API;if(globalThis.window&&window!==globalThis)window.GH_CUSTOMER_BASE=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
