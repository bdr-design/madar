'use strict';
// A group company renting space from the group's real estate company carries that rent as a daily expense; the daily
// economics added it while reading the real estate row, but the telecom and dealership rows are read after it and set
// their company's expense, so those two tenants kept no rent at all (the landlord still had the income: the group's profit
// gained the rent). Proven on the real real-estate, economics, finance and facility owners, with the telecom and dealer
// markets' stored daily rows:
//  1. a telecom and a dealership tenant carry their market expense plus the day's rent; a bank tenant its rent;
//  2. the rent stays out of each tenant's cash expense (its monthly settlement moves the cash);
//  3. the landlord's internal rent income equals the rent the tenants carry;
//  4. the previous source (run from its own tree) dropped the telecom and dealership rent.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'),SOURCE=process.env.GH_TEST_SOURCE_DIR||ROOT,PREVIOUS='3aca0e8',DAY=31;
process.env.GH_TEST_SOURCE_DIR=SOURCE;
const {harness,minimal}=require('./helpers/core-harness');

function scenario(){
  const {s}=harness(['capability-registry-core','company-definitions','company-platform-core','identity-system','control-plane-core','authorization-core','determinism-core','integrity-core','document-proof-core','transaction-core','domain-command-core','finance-core','facility-core','realestate-core','telecom-market-core','dealer-market-core','economics-core','save-schema']);
  const openedCompanies=['bank','realestate','telecom','dealership'],companyRegistry=Object.fromEntries(openedCompanies.map(id=>{const definition=s.GH_COMPANY_DEFINITIONS.get(id);return [id,{id,definitionId:definition.definitionId,definitionVersion:definition.definitionVersion,status:'active'}];}));
  // The telecom and dealer markets as their engines store a day: network/acquisition and workshop costs.
  const market=(expense,cashExpense)=>({market:{dailyHistory:[{day:DAY,accrued:4000,invoiced:0,revenue:3000,expense,cashExpense}]}});
  const state={...minimal(),profile:{name:'Internal rent tenants'},companyRegistry,openedCompanies,branches:[],customHubs:[{id:'RE-RUH',kind:'realestate',ownerCompanyId:'realestate',owned:true,city:'الرياض',country:'السعودية'}],realEstate:{},advanced:{},customerCompanies:{companies:{telecom:market(900,700),dealership:market(1500,1100)}}};
  const F=s.GH_FINANCE_CORE;F.ensure(state);for(const id of openedCompanies)F.book(state,id).accounts[0].balance=250000000;F.reconcile(state);
  const RE=s.GH_REALESTATE_CORE,re=RE.ensure(state),office=re.offices[0];
  re.projects.push({id:'RE-TOWER-QA',officeId:office.id,city:office.city,country:office.country,type:'office',name:'برج المجموعة',mode:'lease',units:60,unitCost:1200000,landCost:2160000,buildCost:12000000,priceLevel:1,startDay:0,completeDay:0,status:'مكتمل',milestonesPaid:3,sold:0,presold:0,leased:0,handedOver:0,salesRevenue:0,rentRevenue:0,leases:[]});
  const leases=Object.fromEntries(['telecom','dealership','bank'].map((companyId,i)=>[companyId,RE.leaseToCompany(state,{projectId:'RE-TOWER-QA',companyId,leaseId:`RE-TOWER-QA-${i+1}`,units:i+1,rentLevel:1,years:3})]));
  let row;for(let day=1;day<=DAY;day++){state.simSeconds=day*86400;row=RE.tickDay(state,{day});}
  const eco=s.GH_ECONOMICS_CORE.sectorEconomics(state,{day:DAY,preferDailyReport:true}).detail,rent=Object.fromEntries((row.internalRentRows||[]).map(item=>[item.companyId,item.amount]));
  return {rent,internalRentRevenue:row.internalRentRevenue,expense:eco.companyExpense,cashExpense:eco.companyCashExpense,annual:Object.fromEntries(Object.entries(leases).map(([k,v])=>[k,v.annualRent]))};
}
if(process.env.GH_B544_CHILD){console.log(JSON.stringify(scenario()));return;}
(()=>{
  const now=scenario(),close=(a,b)=>Math.abs(a-b)<.01;
  for(const id of ['telecom','dealership','bank'])assert(now.rent[id]>0&&close(now.rent[id],now.annual[id]/365),`${id}: a day's rent accrued (${JSON.stringify(now.rent)})`);
  assert(close(now.expense.telecom,900+now.rent.telecom),`1: the telecom tenant carries its market expense and rent (${now.expense.telecom})`);
  assert(close(now.expense.dealership,1500+now.rent.dealership),`1: the dealership tenant too (${now.expense.dealership})`);
  assert(close(now.expense.bank,now.rent.bank),'1: the bank tenant carries its rent');
  assert(close(now.cashExpense.telecom,700)&&close(now.cashExpense.dealership,1100)&&close(now.cashExpense.bank,0),`2: no tenant's cash expense includes rent (${JSON.stringify(now.cashExpense)})`);
  assert(close(now.internalRentRevenue,now.rent.telecom+now.rent.dealership+now.rent.bank),'3: the landlord\'s internal rent income equals what the tenants carry');
  const tree=fs.mkdtempSync(path.join(os.tmpdir(),'b544-'));
  try{execFileSync('sh',['-c',`git -C "${ROOT}" archive ${PREVIOUS} WebApp | tar -x -C "${tree}"`]);
    const before=JSON.parse(execFileSync(process.execPath,[__filename],{env:{...process.env,GH_B544_CHILD:'1',GH_TEST_SOURCE_DIR:tree},encoding:'utf8',maxBuffer:16*1024*1024}).trim().split('\n').at(-1));
    assert(close(before.expense.telecom,900)&&close(before.expense.dealership,1500),`4: the previous source dropped their rent (${JSON.stringify(before.expense)})`);
    assert(close(before.expense.bank,before.rent.bank),'4: (the bank tenant kept it)');
    console.log(JSON.stringify({suite:'build544-internal-rent-tenants',ok:true,current:{rent:now.rent,expense:now.expense},previous:{expense:before.expense}}));
  }finally{fs.rmSync(tree,{recursive:true,force:true});}
})();
