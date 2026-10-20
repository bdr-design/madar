'use strict';
// The daily close paid the bank's credit-loss provision in cash: it was part of the bank expense the close posts, and the
// bank pays its expenses from its account. A provision (and a write-off shortfall) is a loss on money already lent; no
// cash leaves for it. Proven on the real banking, finance and economics owners and the daily close's own posting code
// (app.js, run as written):
//  1. on a bank day with a provision, the bank's P&L expense still includes it, and the cash the close posts as the
//     bank's expense is that expense less the provision (and never below zero);
//  2. a day with a write-off shortfall leaves it in P&L and out of cash the same way;
//  3. the previous source (run from its own tree) posted the provision as cash.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm'),{execFileSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'),SOURCE=process.env.GH_TEST_SOURCE_DIR||ROOT,PREVIOUS='2ee236b';
process.env.GH_TEST_SOURCE_DIR=SOURCE;
const {harness,minimal}=require('./helpers/core-harness');

function closeBlock(s,state,day){
  const app=fs.readFileSync(path.join(SOURCE,'WebApp/app.js'),'utf8'),start=app.indexOf('      const baseByCompany=zeroCompanyMap(state)'),end=app.indexOf('      // Build 358: electricity the power company sold inside the group today',start);assert(start>=0&&end>start,'close block found');
  const companyIds=['bank','road'],box={window:s,state,phase:(_name,fn)=>fn(),companyIds,companyIdSet:new Set(companyIds),zeroCompanyMap:()=>Object.fromEntries(companyIds.map(id=>[id,0])),getDynamicFacilities:()=>[...state.globalBases,...state.customHubs],facilityOwnerCompanyId:r=>r.ownerCompanyId||r.companyId||r.company||'group',companyContractRevenue:{},companyContractCost:{},leaseByCompany:{},uniqueOperationalCompanyForCapability:(_state,cap)=>({'operations.bank':'bank'}[cap])};
  state.lastFinancialDay=day;vm.createContext(box);vm.runInContext(app.slice(start,end)+'\nthis.actual={operatingExpense,cashOperatingExpense,ed};',box);return box.actual;
}
function scenario(){
  const {s}=harness(['finance-core','facility-core','banking-core','economics-core','transaction-core','save-schema']);
  const state={...minimal(),profile:{name:'Provision cash'},openedCompanies:['bank','road'],bank:{},branches:[]};
  const F=s.GH_FINANCE_CORE;F.ensure(state);for(const id of state.openedCompanies)F.book(state,id).accounts[0].balance=id==='bank'?500e6:100e6;F.reconcile(state);
  const B=s.GH_BANKING_CORE,b=B.ensure(state);Object.assign(b,{deposits:100e6,loans:0,provisions:0,riskPolicy:{maxLdr:120,minLcr:100,minNsfr:100,minCet1:4.5,sectorConcentration:25}});
  b.branchNetwork=[{id:'BR-PROV',city:'Riyadh',country:'Saudi Arabia',servicesActive:true,deposits:100e6,loans:0,retailCustomers:10,businessCustomers:2,depositMix:{sight:45e6,savings:35e6,term:20e6},lastProcessedDay:0}];
  B.ensure(state);for(const c of Object.values(b.corporateClients))c.creditLimit=500e6;B.reconcilePrudential(state);
  state.simSeconds=86400;B.execute({state},'originate-loan',{amount:40e6,product:'corporate',sector:'commercial'});
  const day=d=>{state.simSeconds=d*86400;const report=B.execute({state},'tick-day',{day:d}),close=closeBlock(s,state,d);return {provision:report.creditLossExpense,pnl:close.operatingExpense.bank,cash:close.cashOperatingExpense.bank,toPost:close.ed.bankExpenseToPost};};
  const out={normal:day(2)};
  b.pendingWriteOffLoss=750000;out.writeOff=day(3);return out;
}
if(process.env.GH_B541_CHILD){console.log(JSON.stringify(scenario()));return;}
(()=>{
  const now=scenario(),close=(a,b)=>Math.abs(a-b)<.01;
  for(const [name,row] of Object.entries(now)){
    assert(row.provision>0,`${name}: the bank provisioned (${JSON.stringify(row)})`);
    assert(close(row.pnl,row.toPost),`${name}: the bank's P&L expense keeps the provision (${JSON.stringify(row)})`);
    assert(close(row.cash,Math.max(0,row.pnl-row.provision)),`${name}: the cash posted is the expense less the provision (${JSON.stringify(row)})`);}
  assert(now.writeOff.provision>=750000,'2: the write-off shortfall is in the day\'s credit loss');
  const tree=fs.mkdtempSync(path.join(os.tmpdir(),'b541-'));
  try{execFileSync('sh',['-c',`git -C "${ROOT}" archive ${PREVIOUS} WebApp | tar -x -C "${tree}"`]);
    const before=JSON.parse(execFileSync(process.execPath,[__filename],{env:{...process.env,GH_B541_CHILD:'1',GH_TEST_SOURCE_DIR:tree},encoding:'utf8',maxBuffer:16*1024*1024}).trim().split('\n').at(-1));
    assert(close(before.normal.cash,before.normal.pnl),'3: the previous source posted the whole expense, provision included, as cash');
    console.log(JSON.stringify({suite:'build541-bank-provision-cash',ok:true,current:now,previous:before}));
  }finally{fs.rmSync(tree,{recursive:true,force:true});}
})();
