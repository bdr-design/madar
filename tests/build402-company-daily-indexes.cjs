'use strict';
// Build 402: daily company closes reuse transient indexes instead of rescanning peer offices, branches, financing,
// contracts, maintenance, outages, and facilities for every row. No index is saved in the game state.
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||require('path').resolve(__dirname,'..');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {harness,minimal}=require('./helpers/core-harness');
const {s}=harness(['banking-core','insurance-core','realestate-core','energy-core']);
const RealmArray=vm.runInContext('Array',s);
const [B,I,R,E]=[s.GH_BANKING_CORE,s.GH_INSURANCE_CORE,s.GH_REALESTATE_CORE,s.GH_ENERGY_CORE];
const source=name=>fs.readFileSync(path.join(__dirname,'..','WebApp',name),'utf8');

function peers(rows,active,country){return Math.max(1,rows.filter(row=>row[active]&&row.country===country).length);}

// The transient peer counts produce the same market capacities and arrival rates as the original per-row filters.
{
  const branches=Array.from({length:18},(_,i)=>({id:`B-${i}`,country:i%3?'السعودية':'الإمارات',servicesActive:i%5!==0,marketPopulation:10000000+i}));
  const bank={branchNetwork:branches};
  for(const branch of branches)assert.deepEqual(B.branchMarket(bank,branch,peers(branches,'servicesActive',branch.country)),B.branchMarket(bank,branch));
  const offices=Array.from({length:21},(_,i)=>({id:`I-${i}`,country:i%3?'السعودية':'الإمارات',active:i%4!==0,marketPopulation:5000000+i}));
  const insurance={offices};
  for(const office of offices)assert.deepEqual(I.officeMarket(insurance,office,peers(offices,'active',office.country)),I.officeMarket(insurance,office));
  const reOffices=offices.map(row=>({...row,id:`R-${row.id}`})),realEstate={offices:reOffices};
  const project={type:R.TYPE_IDS[0],units:120,sold:10,presold:5,leased:20,priceLevel:1.05};
  for(const office of reOffices){
    const count=peers(reOffices,'active',office.country);
    assert.deepEqual(R.officeMarket(realEstate,office,count),R.officeMarket(realEstate,office));
    assert.equal(R.arrivals(realEstate,project,office,1.1,count),R.arrivals(realEstate,project,office,1.1));
  }
}
assert.match(source('banking-core.js'),/branchMarket\(bank,branch,Math\.max\(1,activeBranchPeers\.get\(branch\.country\)\|\|0\)\)/,'bank daily close must pass its one-pass peer count');
assert.match(source('insurance-core.js'),/officeMarket\(ins,office,Math\.max\(1,activeOfficePeers\.get\(office\.country\)\|\|0\)\)/,'insurance daily close must pass its one-pass peer count');
assert.match(source('realestate-core.js'),/arrivals\(re,project,office,[\s\S]{0,600}Math\.max\(1,activeOfficePeers\.get\(office\.country\)\|\|0\)\)/,'real-estate daily close must pass its one-pass peer count');
assert.match(source('energy-core.js'),/dailyIndexes\(energy,Math\.floor\(now\(state\)\/86400\)\),siteRows=siteEconomics\(state,energy,indexes\),dailySummary=economics\(state,siteRows,energy\)/,'energy daily close must reuse one transient index across site and company totals');

// Reconciliation of large legacy office/site lists is linear and idempotent.
function countPrototypeCalls(method,work){
  const prototype=RealmArray.prototype,original=prototype[method];let calls=0;
  prototype[method]=function(...args){calls++;return original.apply(this,args);};
  try{work();}finally{prototype[method]=original;}
  return calls;
}
function facilities(kind,total){return RealmArray.from({length:total},(_,i)=>({id:`FAC-${kind}-${i}`,kind,owned:true,ownerCompanyId:kind,companyId:kind,city:'الرياض',country:'السعودية'}));}
{
  const total=700,existing=Math.floor(total/2),insState={...minimal(),globalBases:facilities('insurance',total),insurance:{sequence:0,offices:RealmArray.from({length:existing},(_,i)=>({id:`OLD-I-${i}`,facilityId:`FAC-insurance-${i}`,city:'الرياض',country:'السعودية',active:true}))}};
  const insuranceSomeCalls=countPrototypeCalls('some',()=>{I.ensure(insState);I.ensure(insState);});
  assert.equal(insState.insurance.offices.length,total);assert.equal(new Set(insState.insurance.offices.map(row=>row.facilityId)).size,total);assert.equal(insState.insurance.offices[0].id,'OLD-I-0','existing office identity survives reconciliation');assert.equal(insuranceSomeCalls,0,'insurance facility reconciliation must not scan offices once per facility');
  const reState={...minimal(),globalBases:facilities('realestate',total),realEstate:{sequence:0,offices:RealmArray.from({length:existing},(_,i)=>({id:`OLD-R-${i}`,facilityId:`FAC-realestate-${i}`,city:'الرياض',country:'السعودية',active:true}))}};
  const reSomeCalls=countPrototypeCalls('some',()=>{R.ensure(reState);R.ensure(reState);});
  assert.equal(reState.realEstate.offices.length,total);assert.equal(new Set(reState.realEstate.offices.map(row=>row.facilityId)).size,total);assert.equal(reState.realEstate.offices[0].id,'OLD-R-0','existing office identity survives reconciliation');assert.equal(reSomeCalls,0,'real estate facility reconciliation must not scan offices once per facility');
  const powerState={...minimal(),globalBases:facilities('power',total),energy:{availabilityInitialized:true,debtBalanceMigrationVersion:1,postCommissionInterestSchema:1,sites:RealmArray.from({length:existing},(_,i)=>({id:`SITE-FAC-power-${i}`,facilityId:`FAC-power-${i}`,capacity:50,kind:'solar',commissioned:false}))}};
  const siteFindCalls=countPrototypeCalls('find',()=>{E.ensure(powerState);E.ensure(powerState);});
  assert.equal(powerState.energy.sites.length,total);assert.equal(new Set(powerState.energy.sites.map(row=>row.facilityId)).size,total);assert.equal(powerState.energy.sites[0].id,'SITE-FAC-power-0','existing site identity survives reconciliation');assert.equal(siteFindCalls,0,'energy facility reconciliation must use its one-pass facility map');
}

// Exercise the exact daily site-economics path. Getter counters make a return to site-by-history rescans fail even when
// its output is still numerically correct.
let dailyReadCounts=null;
{
  const total=180,reads={finance:0,ppa:0,maintenance:0,outage:0,fuel:0},tag=(row,key,type)=>{const value=row[key];Object.defineProperty(row,key,{enumerable:true,configurable:true,get(){reads[type]++;return value;}});return row;};
  const sites=RealmArray.from({length:total},(_,i)=>({id:`SITE-${i}`,facilityId:`PLANT-${i}`,name:`Gas ${i}`,city:'الرياض',country:'السعودية',kind:'gas',capacity:100,commissioned:true,commissionedDay:0,availability:100,forcedOutageRate:0,degradationRate:0,gridExportLimitMW:100,gridLossRate:0,dispatchMode:'must-run',reserveMargin:0,maintenanceReservePerMW:0,capex:1000000,fuelContractId:`FUEL-${i}`}));
  const projectFinance=RealmArray.from({length:total},(_,i)=>tag({id:`PF-${i}`,siteId:`SITE-${i}`,status:'ساري',outstanding:10000,originalAmount:10000,amount:10000,principalArrears:2,capitalizedInterest:0,rate:.1,termDays:1000,repaymentStartDay:1,amortizationAmount:10},'siteId','finance'));
  const ppaContracts=RealmArray.from({length:total*3},(_,i)=>tag({id:`PPA-${i}`,siteId:`SITE-${Math.floor(i/3)}`,status:i%3===0?'ساري':i%3===1?'بانتظار التشغيل':'منتهي',capacityMW:i%3===0?10:i%3===1?30:20,tariff:50},'siteId','ppa'));
  const maintenancePlans=RealmArray.from({length:total*2},(_,i)=>tag({id:`MAINT-${i}`,siteId:`SITE-${Math.floor(i/2)}`,status:i%2?'مكتملة':'مجدولة',startDay:0,endDay:20,availabilityDuring:.5,recovery:.7},'siteId','maintenance'));
  const outages=RealmArray.from({length:total*2},(_,i)=>tag({id:`OUT-${i}`,siteId:`SITE-${Math.floor(i/2)}`,status:i%2?'مغلق':'نشط',startDay:0,endDay:20,availabilityDuring:.8},'siteId','outage'));
  const fuelContracts=RealmArray.from({length:total*2},(_,i)=>tag({id:`FUEL-${Math.floor(i/2)}`,status:i%2?'ساري':'منتهي',remainingMWh:100000,priceMWh:50},'id','fuel'));
  const state={...minimal(),simSeconds:10*86400,advanced:{economy:{electricityPriceMWh:100,gasCostMWh:39}},globalBases:RealmArray.of(),customHubs:RealmArray.of(),energy:{availability:100,availabilityInitialized:true,debtBalanceMigrationVersion:1,postCommissionInterestSchema:1,sites,projectFinance,ppaContracts,maintenancePlans,outages,fuelContracts}};
  const rows=E.siteEconomics(state),first=rows[0];
  assert.equal(rows.length,total);assert.equal(first.contractedMW,40,'active and pending capacity counts; expired capacity does not');
  assert.ok(Math.abs(first.availability-.4)<1e-12,'active maintenance and outage factors multiply once');
  assert.ok(Math.abs(first.debtPrincipal-12)<1e-12);assert.ok(Math.abs(first.debtInterest-10000*.1/365)<1e-12);
  const grossGeneration=100*24*.56*.4;
  assert.ok(Math.abs(first.generationMWh-grossGeneration*.98)<1e-9);
  assert.ok(Math.abs(first.fuelContractMWh-grossGeneration)<1e-9);assert.ok(Math.abs(first.gasFuel-grossGeneration*50)<1e-9,'duplicate fuel rows retain the first active contract');
  assert.ok(reads.finance<total*4,`project finance history is visited a constant number of times: ${reads.finance}`);
  assert.ok(reads.ppa<total*7,`PPA history is grouped once: ${reads.ppa}`);
  assert.ok(reads.maintenance<total*4,`maintenance history is indexed once: ${reads.maintenance}`);
  assert.ok(reads.outage<total*5,`outage history is indexed once: ${reads.outage}`);
  assert.ok(reads.fuel<total*3,`active fuel contracts are indexed once: ${reads.fuel}`);
  assert.equal(Object.keys(state.energy).some(key=>/index|bySite/i.test(key)),false,'indexes remain transient and are not saved');
  dailyReadCounts={...reads};
}

// Keep all active operational rows and only the latest 400 closed/completed records per existing history policy.
{
  const state={...minimal(),simSeconds:86400,advanced:{economy:{electricityPriceMWh:90}},globalBases:RealmArray.of(),customHubs:RealmArray.of(),energy:{availabilityInitialized:true,debtBalanceMigrationVersion:1,postCommissionInterestSchema:1,lastProcessedDay:0,sites:RealmArray.of(),outages:RealmArray.of(),maintenancePlans:RealmArray.of()}};
  const energy=state.energy;
  energy.outages=[{id:'OUT-ENDS',siteId:'ENDED-SITE',status:'نشط',startDay:0,endDay:1},...RealmArray.from({length:405},(_,i)=>({id:`OUT-C-${i}`,siteId:`OLD-SITE-${i}`,status:'مغلق',startDay:0,endDay:0,closedDay:0})),{id:'OUT-ACTIVE-1',siteId:'ACTIVE-1',status:'نشط',startDay:0,endDay:5,availabilityDuring:0},{id:'OUT-ACTIVE-2',siteId:'ACTIVE-2',status:'نشط',startDay:0,endDay:5,availabilityDuring:0}];
  energy.maintenancePlans=[{id:'MAINT-ENDS',siteId:'ENDED-SITE',status:'قيد التنفيذ',startDay:0,endDay:1},...RealmArray.from({length:405},(_,i)=>({id:`MAINT-C-${i}`,siteId:`OLD-SITE-${i}`,status:'مكتملة',startDay:0,endDay:0,completedDay:0})),{id:'MAINT-PLANNED',siteId:'FUTURE',status:'مجدولة',startDay:5,endDay:10},{id:'MAINT-RUNNING',siteId:'RUNNING',status:'قيد التنفيذ',startDay:0,endDay:5,availabilityDuring:0}];
  assert.equal(E.economics(state,state.advanced.economy).generation,0,'legacy economics callers may pass the market as argument two');
  E.tickDay(state,{day:1});
  assert.equal(energy.outages.filter(row=>row.status==='مغلق').length,400);assert.ok(energy.outages.some(row=>row.id==='OUT-ENDS'));assert.ok(energy.outages.some(row=>row.id==='OUT-ACTIVE-1'));assert.ok(energy.outages.some(row=>row.id==='OUT-ACTIVE-2'));
  assert.equal(energy.maintenancePlans.filter(row=>row.status==='مكتملة').length,400);assert.ok(energy.maintenancePlans.some(row=>row.id==='MAINT-ENDS'));assert.ok(energy.maintenancePlans.some(row=>row.id==='MAINT-PLANNED'));assert.ok(energy.maintenancePlans.some(row=>row.id==='MAINT-RUNNING'));
}

console.log(JSON.stringify({suite:'build402-company-daily-indexes',officeFacilities:700,dailySites:180,rowReads:dailyReadCounts,history:{closedOutages:400,completedMaintenance:400,activePreserved:true}}));
