'use strict';
const {harness,minimal}=require('./core-harness');
function customerCreditFixture(){
 const h=harness(['capability-registry-core','company-definitions','company-platform-core','identity-system','control-plane-core','authorization-core','document-proof-core','transaction-core','domain-command-core','save-schema','determinism-core','event-ledger-core','dependency-core','policy-core','lifecycle-core','delivery-monitor-core','realism-core','finance-core','hr-core','corporate-core','facility-core','business-world-core','banking-core','insurance-core','energy-core','economics-core','game-lifecycle-core']);
 const s=h.s,data={...minimal(),profile:{name:'Customer credit QA'},bank:{},operations:{},crew:[],branches:[],hired:[],unlockedSectors:[],ownedCompanies:[]},state=s.GH_GAME_LIFECYCLE.pristine(data,1);
 s.GH_GAME_LIFECYCLE.foundGroup(state,{mode:'sandbox',name:'Credit QA',founder:'Founder',locationId:'RUH'},data,{nextId:()=> 'FOUND-CREDIT-QA',simYear:()=>2026});
 for(const [type,capital] of [['bank',400000000],['dealership',100000000]])s.GH_DOMAIN_COMMANDS.dispatch({state},'corporate','open-company',{type,capital,legalName:'QA '+type});
 const B=s.GH_BANKING_CORE,F=s.GH_FINANCE_CORE;
 state.bank.branchNetwork=[{id:'BR-CREDIT-QA',facilityId:'BR-CREDIT-QA',city:'Riyadh',country:'Saudi Arabia',servicesActive:true,services:[...B.ALL_BRANCH_SERVICES],retailCustomers:0,businessCustomers:0,deposits:0,loans:0,depositMix:{sight:0,savings:0,term:0},lastProcessedDay:0}];
 B.ensure(state);
 function approve(id='CREDIT-QA',amount=1000000){
  const customer=s.GH_BUSINESS_WORLD.upsertParty(state,{id:'CUSTOMER-'+id,name:'Buyer '+id,role:'customer',country:'Saudi Arabia',sectors:['bank']});
  B.execute({state},'submit-customer-loan-request',{id,customerId:customer.id,borrower:'Buyer '+id,amount,product:'consumer',termDays:360,riskGrade:'AAA',sector:'retail'});
  const result=B.execute({state},'decide-loan-request',{id,decision:'approve'});return {result,contract:state.bank.customerLoanContracts.find(row=>row.id===result.contractId),portfolio:state.bank.loanPortfolios.find(row=>row.id===result.loanId)};
 }
 function pauseBranches(){for(const row of state.bank.branchNetwork)row.servicesActive=false;state.bank.autoLiquidity=false;}
 return {...h,state,B,F,approve,pauseBranches};
}
module.exports={customerCreditFixture};
