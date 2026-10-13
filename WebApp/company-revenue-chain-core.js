// Build 373 · مدار: the decisions waiting for the player in a company that owns no transport assets (insurance risks,
// real-estate tenant requests, telecom business contracts, bank and dealership customer-finance requests), at most five,
// decided in the company panel by the owners' existing batch commands (advanced-core company-decide-pending).
// Build 377 (owner's decision): the revenue-chain design (steps and next step) is gone from the panel, so only the
// decisions are built here. Read-only: it reads the owners' own records, never calls their ensure() (which normalises
// state) and never passes over the fleet.
(()=>{
  'use strict';
  const VERSION='2.0.0',KINDS=Object.freeze(['insurance','realestate','telecom','dealership','bank']),MAX_DECISIONS=5,DAY=86400;
  const arr=value=>Array.isArray(value)?value.filter(Boolean):[];
  const obj=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
  const num=value=>{const n=Number(value);return Number.isFinite(n)?n:0;};
  const today=state=>Math.floor(num(state?.simSeconds)/DAY);
  const daysLeft=(state,row)=>Math.max(0,num(row?.expiresDay)-today(state));

  function insurance(state){
    return arr(obj(state?.insurance).riskRequests).slice(0,MAX_DECISIONS).map(row=>({id:String(row.id),title:String(row.subject||row.id),detail:{premium:num(row.premium),expectedLoss:num(row.expectedLoss)},daysLeft:daysLeft(state,row)}));
  }
  function realestate(state){
    return arr(obj(state?.realEstate).tenantRequests).slice(0,MAX_DECISIONS).map(row=>({id:String(row.id),title:`${row.tenant||'مستأجر'} · ${num(row.units)} وحدة في ${row.projectName||'مشروع'}`,detail:{annualRent:num(row.annualRent),years:num(row.years)},daysLeft:daysLeft(state,row)}));
  }
  function telecom(state){
    return arr(obj(obj(obj(obj(state?.customerCompanies).companies).telecom).market).requests).slice(0,MAX_DECISIONS).map(row=>({id:String(row.id),title:String(row.customerName||'شركة'),detail:{lines:num(row.lines),monthlyValue:num(row.monthlyValue),months:num(row.months)},daysLeft:daysLeft(state,row)}));
  }
  function loanDecisions(state,filter){
    return arr(obj(state?.bank).loanRequests).filter(filter).slice(0,MAX_DECISIONS).map(row=>({id:String(row.id),title:String(row.borrower||row.id),detail:{amount:num(row.amount),grade:String(row.riskGrade||'')},daysLeft:daysLeft(state,row)}));
  }
  const BUILDERS=Object.freeze({insurance,realestate,telecom,dealership:state=>loanDecisions(state,row=>row.sourceCompanyId==='dealership'),bank:state=>loanDecisions(state,()=>true)});
  // Returns {kind,batch,decisions} for one of the five kinds, null for any other.
  function build(state,id,kind){
    const builder=BUILDERS[kind];if(!builder)return null;
    return {kind,batch:kind,decisions:builder(state)};
  }
  const API=Object.freeze({VERSION,KINDS,MAX_DECISIONS,build});
  globalThis.GH_REVENUE_CHAIN=API;
  if(globalThis.window&&globalThis.window!==globalThis)globalThis.window.GH_REVENUE_CHAIN=API;
  if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
