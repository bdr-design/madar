'use strict';
// Owner (build 97): the engine of the four service companies (service-companies-core), on the real definitions, platform,
// capability, adapter and economics owners:
//  1. each sector's figures at its middle utilization are the approved ones (daily revenue per facility, direct cost
//     share, collection), and the definitions carry the approved build cost, running cost and capital;
//  2. a world that opens none of them does no service work: the day close's owners and the economics close leave no
//     service state and read no facility for it;
//  3. a company's day is recorded once (a repeated close returns it), its history keeps 30 days, a price level moves
//     utilization and price as stated, the economics close reports exactly the recorded day, and a corrupted register is
//     refused by the save check.
const assert=require('node:assert/strict');
const {harness,minimal}=require('./helpers/core-harness');
const MODULES=['capability-registry-core','company-definitions','company-platform-core','identity-system','company-adapters-core','customer-base-core','economics-core','service-companies-core'];
const {s}=harness(MODULES),S=s.GH_SERVICE_COMPANIES_CORE,P=s.GH_COMPANY_PLATFORM,D=s.GH_COMPANY_DEFINITIONS,E=s.GH_ECONOMICS_CORE;
const near=(a,b,eps=.5)=>assert.ok(Math.abs(a-b)<=eps,`${a} != ${b}`),out={};
// 1.
const approved={media:{revenue:2000000/30*.70,direct:.75,cost:12000000,daily:5500,capital:40000000,kind:'media-studio'},healthcare:{revenue:150*.75*1100+400*90,direct:.60,cost:60000000,daily:38000,capital:120000000,kind:'hospital'},education:{revenue:1200*.85*12000/365,direct:.50,cost:35000000,daily:9000,capital:60000000,kind:'school'},sports:{revenue:(2*25000*.70*28+8000*40+1200000)/30,direct:.62,cost:90000000,daily:25000,capital:150000000,kind:'stadium'}};
for(const [id,a] of Object.entries(approved)){
  const sector=S.SECTORS[id],d=D.get(id);near(sector.daily(sector.mid),a.revenue);assert.equal(sector.direct,a.direct);assert.equal(sector.facilityKind,a.kind);
  assert.equal(d.facilities.siteTemplate.cost,a.cost);assert.equal(d.facilities.siteTemplate.dailyCost,a.daily);assert.equal(d.founding.minimumCapital,a.capital);
  assert.equal(d.finance.vatEnabled!==false,id==='media'||id==='sports','1: healthcare and education are VAT-exempt');
  assert.equal(d.adapters.operations,'service-company-v1');assert.ok(d.capabilities.includes('operations.services'));
  out[id]={dailyRevenue:Math.round(sector.daily(sector.mid)),margin:Math.round((1-a.direct-a.daily/sector.daily(sector.mid))*1000)/10};
}
assert.equal(out.education&&S.SECTORS.education.collected,.98,'1: education collects 98% (2% bad debt)');
// A world: the platform's registry and opened companies, facilities as the facility path writes them.
function world(opened){
  const state={...minimal(),saveVersion:'3.0.0',simSeconds:10*86400,companyRegistry:{},openedCompanies:[...opened],customHubs:[],advanced:{companies:{}}};
  for(const id of opened){const d=D.get(id);state.companyRegistry[id]={id,definitionId:d.definitionId,definitionVersion:d.definitionVersion,status:'active',operational:true};}
  return state;
}
// 2.
{
  const state=world(['telecom']);let reads=0;const hubs=new Proxy([],{get(t,k,r){if(k===Symbol.iterator||k==='length'||!isNaN(Number(k)))reads++;return Reflect.get(t,k,r);}});state.customHubs=hubs;
  const instances=P.listInstances(state,{includeGroup:false,openedOnly:true,capability:'operations.services'});assert.equal(instances.length,0);
  E.sectorEconomics(state,{day:9});const withEngine=reads;reads=0;const engine=s.GH_SERVICE_COMPANIES_CORE;s.GH_SERVICE_COMPANIES_CORE=undefined;try{E.sectorEconomics(state,{day:9});}finally{s.GH_SERVICE_COMPANIES_CORE=engine;}
  assert.equal(state.serviceCompanies,undefined,'2: no service state for a world without them');assert.equal(withEngine,reads,`2: the engine reads no facility for them (${withEngine} reads with it, ${reads} without)`);
}
// 3.
{
  const state=world(['healthcare']);state.customHubs=[{id:'H1',owned:true,kind:'hospital',ownerCompanyId:'healthcare',city:'الرياض',country:'السعودية',dailyCost:38000},{id:'H2',owned:true,kind:'hospital',ownerCompanyId:'healthcare',city:'دبي',country:'الإمارات',dailyCost:38000}];
  const ctx={state,companyId:'healthcare'},first=S.onFinancialDay(ctx,{day:9}),again=S.onFinancialDay(ctx,{day:9});
  assert.equal(JSON.stringify(again),JSON.stringify(first),'3: a repeated close returns the recorded day');assert.equal(first.facilities,2);assert.ok(first.revenue>0);
  const reported=E.sectorEconomics(state,{day:9}).detail;near(reported.companyRevenue.healthcare,first.revenue,.01);near(reported.companyCashRevenue.healthcare,first.cashRevenue,.01);
  for(let day=10;day<60;day++)S.onFinancialDay(ctx,{day});assert.equal(S.read(state,'healthcare').history.length,30,'3: thirty days kept');
  const market=S.dayRow(state,'healthcare',70);S.execute({state},'set-price-level',{companyId:'healthcare',level:'low'});const low=S.dayRow(state,'healthcare',70);
  for(let i=0;i<2;i++){const m=market.facilities[i],l=low.facilities[i],base=S.SECTORS.healthcare;if(m.u<base.hi-.06&&m.u>base.lo)near(l.u,m.u+.06,1e-9);}
  assert.ok(low.revenue!==market.revenue,'3: a price level changes the day');
  const steps=S.validationSteps(state);let step;while(!(step=steps.next()).done){}assert.equal(step.value.ok,true,step.value.errors.join(','));
  const bad=structuredClone(state);bad.serviceCompanies.companies.healthcare.priceLevel='free';const v=S.validationSteps(bad);let r;while(!(r=v.next()).done){}assert.equal(r.value.ok,false,'3: a corrupted register is refused');
  assert.equal(JSON.stringify(S.dailyResult(state,5,'healthcare')),JSON.stringify({revenue:0,expense:0,cashRevenue:0,cashExpense:0}),'3: a day not closed reports nothing');
}
console.log(JSON.stringify({suite:'build592-service-companies-engine',ok:true,sectors:out}));
