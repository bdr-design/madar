'use strict';
const assert=require('node:assert/strict');
const {harness,minimal}=require('./helpers/core-harness');
const {s}=harness(['capability-registry-core','company-definitions','company-platform-core','identity-system','control-plane-core','authorization-core','determinism-core','integrity-core','document-proof-core','transaction-core','domain-command-core','finance-core','banking-core','customer-base-core','insurance-core','realestate-core','energy-core','facility-core','operating-acquisition-core']);
const A=s.GH_OPERATING_ACQUISITIONS,F=s.GH_FINANCE_CORE,T=s.GH_TRANSACTION_CORE;
function fixture(){
 const companies=A.COMPANIES,companyRegistry=Object.fromEntries(companies.map(id=>{const d=s.GH_COMPANY_DEFINITIONS.get(id);return [id,{id,definitionId:d.definitionId,definitionVersion:d.definitionVersion,status:'active'}];}));
 const state={...minimal(),saveVersion:'3.0.0',profile:{name:'Acquisition QA'},companyRegistry,openedCompanies:[...companies],advanced:{economy:{electricityPriceMWh:72}},realism:{economy:{baseRate:.046}},branches:[],constructionContracts:[]};
 state.customHubs=companies.map(c=>({id:`FAC-${c}`,owned:true,kind:c,ownerCompanyId:c,city:'الرياض',country:'السعودية',cost:1000000,dailyCost:0,capacityAmount:1,commissioned:false}));
 F.ensure(state);for(const c of companies)F.book(state,c).accounts[0].balance=500e6;F.reconcile(state);
 s.GH_REALESTATE_CORE.ensure(state);s.GH_INSURANCE_CORE.ensure(state);s.GH_ENERGY_CORE.ensure(state);
 const b=s.GH_BANKING_CORE.ensure(state);b.branchNetwork=[{id:'BANK-BR',facilityId:'FAC-bank',city:'الرياض',country:'السعودية',servicesActive:true,retailCustomers:0,businessCustomers:0,deposits:0,loans:0,depositMix:{sight:0,savings:0,term:0}}];s.GH_BANKING_CORE.ensure(state);s.GH_BANKING_CORE.reconcilePrudential(state);
 return state;
}
function buy(state,c,q,extra={}){try{return T.execute(state,{label:`test-acquisition-${c}`,apply:()=>({realestate:s.GH_REALESTATE_CORE,power:s.GH_ENERGY_CORE,insurance:s.GH_INSURANCE_CORE,bank:s.GH_BANKING_CORE}[c]).execute({state},'acquire-operating',{targetId:q.targetId,variant:q.variant,quoteKey:q.quoteKey,...extra})});}catch(error){return {committed:false,error:String(error.message)};}}
function relevant(state){return JSON.stringify([state.companyFinance,state.finance,state.realEstate,state.energy,state.insurance,state.bank]);}
for(const c of A.COMPANIES)for(const variant of A.VARIANTS[c]){
 const state=fixture(),target=A.targets(state,c)[0],q=A.quote(state,c,target.id,variant),before=F.operating(state,c);
 assert.ok(Number.isFinite(q.price)&&q.price>0);assert.ok(Number.isFinite(q.annualExpense));
 const quoteBefore=relevant(state);A.quote(state,c,target.id,variant);assert.equal(relevant(state),quoteBefore,'quoting is read-only');
 const preview=c==='bank'?s.GH_BANKING_CORE.operatingAcquisitionPreview(state,q):null;
 const result=buy(state,c,q,{amount:1});assert.equal(result.committed,true,JSON.stringify(result));
 assert.ok(Math.abs(F.operating(state,c)-(before-q.price+q.transferredCash))<.01,`${c}: only price debited and transferred cash credited`);
 const receipt=state.finance.operatingAcquisitions[q.id];assert.equal(A.validRegistry(state.finance.operatingAcquisitions),true);assert.equal(receipt.price,q.price,'payload cannot set its own price');assert.ok(receipt.chequeId&&receipt.legalDocumentId);
 assert.equal(state.finance.cheques.find(row=>row.id===receipt.chequeId).status,'مصروف');
 const after=relevant(state),duplicate=buy(state,c,A.quote(state,c,target.id,variant));assert.equal(duplicate.committed,false);assert.equal(relevant(state),after,'duplicate rolls back');
 if(c==='bank'){for(const metric of ['cet1','leverageRatio','lcr','nsfr'])assert.ok(Math.abs(state.bank[metric]-preview[metric])<.001,`preview ${metric}`);assert.equal(state.bank.deposits,q.deposits);assert.equal(state.bank.loans,q.loans);assert.equal(state.bank.loanPortfolios.length,1);assert.ok(Math.abs((F.operating(state,c)+state.bank.loans-state.bank.deposits)-(before-q.price))<.01,'deposit transfer creates no equity');}
 if(c==='insurance'){assert.equal(state.insurance.claimsReserve[0].amount,q.transferredCash);assert.equal(state.insurance.offices[0].lines[q.variant].policies,q.policies);}
 if(c==='power'){const site=state.energy.sites.find(row=>row.id===receipt.assetId);assert.equal(site.commissioned,true);assert.ok(s.GH_ENERGY_CORE.siteEconomics(state).find(row=>row.id===site.id).dailyRevenue>0);}
 if(c==='realestate'){const project=state.realEstate.projects.find(row=>row.id===receipt.assetId);assert.equal(project.status,'مكتمل');assert.equal(project.leases.length,1);assert.equal(project.leased,q.leased);}
 // Persist/reload retains ownership, contracts and aggregate records.
 const restored=JSON.parse(JSON.stringify(state));assert.equal(A.quote(restored,c,target.id,variant).owned,true);
}
for(const reason of ['stale','cash','payment','contract','capital','concentration']){
 const state=fixture(),c=['capital','concentration'].includes(reason)?'bank':'realestate',target=A.targets(state,c)[0];
 if(reason==='cash')F.book(state,c).accounts[0].balance=1;
 if(reason==='capital')Object.assign(state.bank.riskPolicy,{maxLdr:1});
 if(reason==='concentration'){state.bank.loans=1000000;state.bank.loanPortfolios=[{id:'EXISTING',sector:'agriculture',outstanding:1000000,principal:1000000,product:'corporate',rate:.08,status:'نشطة'}];}
 F.reconcile(state);const q=A.quote(state,c,target.id,A.VARIANTS[c][0]),before=relevant(state),execute=F.execute;
 if(reason==='payment'||reason==='contract')F.execute=(ctx,name,p)=>{const result=execute(ctx,name,p);if(name===(reason==='payment'?'pay-by-cheque':'register-commercial-contract'))throw new Error('injected-final-step-failure');return result;};
 try{const result=buy(state,c,q,reason==='stale'?{quoteKey:'wrong'}:{});assert.equal(result.committed,false,reason);assert.equal(relevant(state),before,`${reason}: money, cheque, contract and ownership all restored`);}finally{F.execute=execute;}
}
{
 const state=fixture();Object.defineProperty(state,'assets',{get(){throw new Error('acquisition touched fleet');}});
 for(const c of A.COMPANIES){const target=A.targets(state,c)[0];assert.ok(A.quote(state,c,target.id,A.VARIANTS[c][0]).price>0);}
}
console.log('OPERATING_ACQUISITIONS_PASS');
