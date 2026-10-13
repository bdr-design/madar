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
  bank(state){return list(state.bank?.branchNetwork).filter(row=>row&&row.servicesActive!==false).map(row=>({country:row.country,population:row.marketPopulation,households:num(row.retailCustomers),businesses:num(row.businessCustomers)}));},
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
    for(const showroom of list(data?.market?.showrooms))rows.push({country:showroom?.country,population:showroom?.marketPopulation,households:num(showroom?.buyers),businesses:0});
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
// Share of the country's households (or businesses) the group's other companies already serve: a bank customer is an
// easier telecom or car customer for the same group. Engines turn it into a bounded conversion boost.
function affinity(state,country,company,pool='households'){const entry=snapshot(state).byCountry[countryOf(country)];return entry?reachOf(entry,pool,company):0;}
function companyCustomers(state,company){const row=snapshot(state).totals.byCompany[company];return row?Math.round(row.households+row.businesses):0;}

const API=Object.freeze({VERSION,COMPANIES,HOUSEHOLD_SIZE,BUSINESS_PER_PEOPLE,DEFAULT_POPULATION,MOBILE_LINES_PER_HOUSEHOLD,population,market,snapshot,affinity,companyCustomers});
globalThis.GH_CUSTOMER_BASE=API;if(globalThis.window&&window!==globalThis)window.GH_CUSTOMER_BASE=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
