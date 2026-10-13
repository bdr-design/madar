'use strict';
// Build 378: customer satisfaction. A service failure (a withdrawal the bank cannot pay, a claim paid late, a car out
// of stock) pulls a score down a 30th of the way each day; below 85 customers leave faster and fewer join. Normal
// service keeps it at 85 and changes nothing.
process.env.GH_TEST_SOURCE_DIR=require('path').resolve(__dirname,'..');
const assert=require('node:assert/strict');
const {harness,minimal}=require('./helpers/core-harness');
const {s}=harness(['capability-registry-core','company-definitions','company-platform-core','identity-system','control-plane-core','authorization-core','determinism-core','integrity-core','document-proof-core','transaction-core','domain-command-core','finance-core','customer-base-core','banking-core','insurance-core','save-schema','economics-core']);
const C=s.GH_CUSTOMER_BASE,B=s.GH_BANKING_CORE,I=s.GH_INSURANCE_CORE,F=s.GH_FINANCE_CORE;
const plain=value=>JSON.parse(JSON.stringify(value));

// 1. The score and its effects.
assert.equal(C.satisfactionStep(undefined,85),85,'normal service keeps 85');
assert.equal(C.satisfactionStep(85,0),Math.round((85-85/30)*1000)/1000,'a total failure moves it a 30th of the way');
assert.deepEqual(plain(C.serviceEffects(85)),{churn:1,demand:1});assert.deepEqual(plain(C.serviceEffects(95)),{churn:1,demand:1},'no bonus above normal');
assert.deepEqual(plain(C.serviceEffects(60)),{churn:1.5,demand:.75});assert.deepEqual(plain(C.serviceEffects(0)),{churn:1.7,demand:.65},'bounded');

function world(opened){
  const companyRegistry=Object.fromEntries(opened.map(id=>{const definition=s.GH_COMPANY_DEFINITIONS.get(id);return [id,{id,definitionId:definition.definitionId,definitionVersion:definition.definitionVersion,status:'active'}];}));
  const state={...minimal(),profile:{name:'Satisfaction'},companyRegistry,openedCompanies:opened,bank:{},branches:[],globalBases:[],customHubs:[],realism:{economy:{}}};F.ensure(state);return state;
}
// 2. Bank: withdrawals it cannot pay lower satisfaction; low satisfaction means fewer new and more lost customers.
function bank(cash,satisfaction,retail=100000){
  const state=world(['bank']);F.book(state,'bank').accounts[0].balance=cash;F.reconcile(state);
  const b=B.ensure(state);Object.assign(b,{deposits:5e9,loans:0,provisions:0});if(satisfaction!==undefined)b.satisfaction=satisfaction;
  b.branchNetwork=[{id:'BR-SAT',city:'الرياض',country:'السعودية',servicesActive:true,deposits:5e9,loans:0,retailCustomers:retail,businessCustomers:retail/50,depositMix:{sight:2e9,savings:2e9,term:1e9},lastProcessedDay:0}];
  B.ensure(state);B.reconcilePrudential(state);return state;
}
{
  const failing=bank(1000,undefined,400000);let reports=[];for(let day=1;day<=10;day++){failing.simSeconds=day*86400;reports.push(B.execute({state:failing},'tick-day',{day}));}
  assert.ok(failing.bank.satisfaction<80,`unpaid withdrawals: ${failing.bank.satisfaction}`);
  const healthy=bank(5e9);for(let day=1;day<=10;day++){healthy.simSeconds=day*86400;B.execute({state:healthy},'tick-day',{day});}
  assert.equal(healthy.bank.satisfaction,85,'paid withdrawals keep it at 85');
  const happy=bank(5e9,85),unhappy=bank(5e9,40);let joinedHappy=0,joinedUnhappy=0,lostHappy=0,lostUnhappy=0;
  for(let day=1;day<=5;day++){happy.simSeconds=unhappy.simSeconds=day*86400;const a=B.execute({state:happy},'tick-day',{day}),b=B.execute({state:unhappy},'tick-day',{day});joinedHappy+=a.newRetail;joinedUnhappy+=b.newRetail;lostHappy+=a.lostRetail;lostUnhappy+=b.lostRetail;}
  assert.ok(joinedUnhappy<joinedHappy&&lostUnhappy>lostHappy,`unhappy customers: ${joinedUnhappy}/${joinedHappy} joined, ${lostUnhappy}/${lostHappy} lost`);
}
// 3. Insurance: claims it cannot pay when due lower satisfaction; low satisfaction means fewer new and more lapsed policies.
function insurer(cash,satisfaction){
  const state=world(['insurance']);F.book(state,'insurance').accounts[0].balance=cash;F.reconcile(state);
  state.globalBases.push({id:'INS-SAT',kind:'insurance',ownerCompanyId:'insurance',owned:true,city:'الرياض',country:'السعودية',name:'مكتب'});
  I.ensure(state);const ins=state.insurance;if(satisfaction!==undefined)ins.satisfaction=satisfaction;
  for(const line of Object.values(ins.offices[0].lines))line.policies=50000;return state;
}
{
  const failing=insurer(0);failing.insurance.claimsReserve.push({id:'INS-RES-QA',day:0,amount:5e6,payDay:1});
  for(let day=1;day<=10;day++){failing.simSeconds=day*86400;I.execute({state:failing},'tick-day',{day});}
  assert.ok(failing.insurance.satisfaction<80,`unpaid claims: ${failing.insurance.satisfaction}`);
  const happy=insurer(1e9,85),unhappy=insurer(1e9,40);let newHappy=0,newUnhappy=0,lapsedHappy=0,lapsedUnhappy=0;
  for(let day=1;day<=5;day++){happy.simSeconds=unhappy.simSeconds=day*86400;I.execute({state:happy},'tick-day',{day});I.execute({state:unhappy},'tick-day',{day});
    for(const line of Object.values(happy.insurance.offices[0].lines)){newHappy+=line.newToday||0;lapsedHappy+=line.lapsedToday||0;}
    for(const line of Object.values(unhappy.insurance.offices[0].lines)){newUnhappy+=line.newToday||0;lapsedUnhappy+=line.lapsedToday||0;}}
  assert.ok(newUnhappy<newHappy&&lapsedUnhappy>lapsedHappy,`unhappy policyholders: ${newUnhappy}/${newHappy} new, ${lapsedUnhappy}/${lapsedHappy} lapsed`);
}
console.log(JSON.stringify({suite:'build378-customer-satisfaction',ok:true}));
