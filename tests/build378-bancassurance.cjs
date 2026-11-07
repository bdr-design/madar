'use strict';
// Build 378: bancassurance. 10% of the group bank's new households take home cover and 10% of its new businesses
// commercial cover from the group insurer's office in the same country, within the line's room and only while the
// insurer meets its solvency; nothing without an office there or an insurance company.
process.env.GH_TEST_SOURCE_DIR=require('path').resolve(__dirname,'..');
const assert=require('node:assert/strict');
const {harness,minimal}=require('./helpers/core-harness');
const {s}=harness(['capability-registry-core','company-definitions','company-platform-core','identity-system','control-plane-core','authorization-core','determinism-core','integrity-core','document-proof-core','transaction-core','domain-command-core','finance-core','banking-core','insurance-core','save-schema','economics-core']);
const B=s.GH_BANKING_CORE,I=s.GH_INSURANCE_CORE;
function setup(opened=['bank','insurance'],officeCountry='السعودية'){
  const companyRegistry=Object.fromEntries(opened.map(id=>{const definition=s.GH_COMPANY_DEFINITIONS.get(id);return [id,{id,definitionId:definition.definitionId,definitionVersion:definition.definitionVersion,status:'active'}];}));
  const state={...minimal(),profile:{name:'Bancassurance'},companyRegistry,openedCompanies:opened,bank:{},branches:[],globalBases:[],customHubs:[]};
  const F=s.GH_FINANCE_CORE;F.ensure(state);F.book(state,'bank').accounts[0].balance=500e6;F.reconcile(state);
  const b=B.ensure(state);Object.assign(b,{deposits:100e6,loans:0,provisions:0});
  b.branchNetwork=[{id:'BR-BA',city:'الرياض',country:'السعودية',servicesActive:true,deposits:100e6,loans:0,retailCustomers:10,businessCustomers:2,depositMix:{sight:45e6,savings:35e6,term:20e6},lastProcessedDay:0}];
  state.insurance={sequence:1,offices:[{id:'INS-OFF-BA',facilityId:'INS-BA',city:'الرياض',country:officeCountry,active:true,lines:{motor:{policies:0},health:{policies:0},property:{policies:0},commercial:{policies:0}}}],riskRequests:[],riskHistory:[],largeRisks:[],claimsReserve:[],dailyHistory:[],riskDecisionBatches:[]};
  B.ensure(state);B.reconcilePrudential(state);return state;
}
const lines=state=>state.insurance.offices[0].lines;
// 1. Thirty days: the joined policies are 10% of the bank's new customers, reported on the bank's day.
{
  const state=setup();let households=0,businesses=0,reported=0;
  for(let day=1;day<=30;day++){state.simSeconds=day*86400;const report=B.execute({state},'tick-day',{day});households+=report.newRetail;businesses+=report.newBusiness;reported+=report.groupInsured;}
  const property=lines(state).property.policies,commercial=lines(state).commercial.policies;
  assert.ok(households>300,'the branch grew');
  assert.equal(reported,property+commercial,'the bank reports what it sold at the counter');
  assert.ok(Math.abs(property-households*I.BANCASSURANCE_SHARE)<=30,`home cover ~10% of new households: ${property} of ${households}`);
  assert.ok(Math.abs(commercial-businesses*I.BANCASSURANCE_SHARE)<=30,`commercial cover ~10% of new businesses: ${commercial} of ${businesses}`);
  assert.equal(lines(state).motor.policies+lines(state).health.policies,0,'other lines untouched');
  console.log(JSON.stringify({households,businesses,property,commercial}));
}
// 2. No office in the country, no insurance company, or an insurer below its solvency: nothing is sold.
for(const [label,state] of [['other country',setup(['bank','insurance'],'الإمارات')],['no insurer',setup(['bank'])]]){
  for(let day=1;day<=5;day++){state.simSeconds=day*86400;assert.equal(B.execute({state},'tick-day',{day}).groupInsured,0,label);}
  assert.equal(lines(state).property.policies,0,label);
}
{
  const state=setup();state.insurance.solvency={writing:false};
  assert.equal(JSON.stringify(I.addPoliciesFromBank(state,{country:'السعودية',day:1,households:500,businesses:50})),JSON.stringify({property:0,commercial:0}),'no new cover below the solvency floor');
}
console.log(JSON.stringify({suite:'build378-bancassurance',ok:true}));
