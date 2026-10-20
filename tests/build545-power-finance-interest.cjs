'use strict';
// Project-finance interest on a running power plant was paid twice: Energy Core accrues it and pays it on a monthly PFINT
// invoice, while the daily close also put it in the power company's cash expense (a supplier payable it pays). Proven on
// the real energy, finance, economics and domain command owners and the daily close's own posting code (app.js, run as
// written), with a commissioned gas plant and its project finance:
//  1. each day the power company's P&L carries the interest Energy Core accrued that day (unchanged);
//  2. the close's cash expense leaves that interest out (and the take-or-pay accrual, as before);
//  3. the monthly PFINT invoice pays what accrued, so the interest leaves the company's cash once;
//  4. the previous source (run from its own tree) put the interest in the close's cash as well.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm'),{execFileSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'),SOURCE=process.env.GH_TEST_SOURCE_DIR||ROOT,PREVIOUS='3191cab';
process.env.GH_TEST_SOURCE_DIR=SOURCE;
const {harness,minimal}=require('./helpers/core-harness');

function closeBlock(s,state,day){
  const app=fs.readFileSync(path.join(SOURCE,'WebApp/app.js'),'utf8'),start=app.indexOf('      const baseByCompany=zeroCompanyMap(state)'),end=app.indexOf('      // Build 358: electricity the power company sold inside the group today',start);assert(start>=0&&end>start,'close block found');
  const companyIds=['power'],box={window:s,state,phase:(_name,fn)=>fn(),companyIds,companyIdSet:new Set(companyIds),zeroCompanyMap:()=>Object.fromEntries(companyIds.map(id=>[id,0])),getDynamicFacilities:()=>[...state.globalBases,...state.customHubs],facilityOwnerCompanyId:r=>r.ownerCompanyId||r.companyId||r.company||'group',companyContractRevenue:{},companyContractCost:{},leaseByCompany:{},uniqueOperationalCompanyForCapability:(_state,cap)=>({'operations.energy':'power'}[cap])};
  state.lastFinancialDay=day;vm.createContext(box);vm.runInContext(app.slice(start,end)+'\nthis.actual={operatingExpense,cashOperatingExpense,ed};',box);return box.actual;
}
function scenario(){
  const h=harness(['capability-registry-core','company-definitions','company-platform-core','identity-system','control-plane-core','authorization-core','document-proof-core','transaction-core','domain-command-core','save-schema','determinism-core','event-ledger-core','dependency-core','policy-core','lifecycle-core','delivery-monitor-core','realism-core','finance-core','hr-core','corporate-core','facility-core','energy-core','economics-core','game-lifecycle-core']);
  const {s}=h,d={...minimal(),profile:{name:'Plant Interest'},bank:{},operations:{},crew:[],branches:[],hired:[],unlockedSectors:[],ownedCompanies:[]};
  const state=s.GH_GAME_LIFECYCLE.pristine(d,1);s.GH_GAME_LIFECYCLE.foundGroup(state,{mode:'sandbox',name:'Plant Group',founder:'Founder',locationId:'RUH'},d,{nextId:()=>'FOUND-PF',simYear:()=>2026});
  const E=s.GH_ENERGY_CORE,F=s.GH_FINANCE_CORE,R=s.GH_REALISM,run=(name,p)=>s.GH_DOMAIN_COMMANDS.dispatch({state},'energy',name,p).result;
  s.GH_DOMAIN_COMMANDS.dispatch({state},'corporate','open-company',{type:'power',capital:400000000,legalName:'Plant Power'});
  state.customHubs.push({id:'PWR-GAS-PF',name:'Gas PF',city:'الرياض',country:'السعودية',kind:'power',company:'power',ownerCompanyId:'power',owned:true,energyKind:'gas',capacityAmount:100,capacity:'100 MW',commissioned:true,openedAt:0,dailyCost:38000,cost:200000000});
  state.simSeconds=100*86400;R.migrate(state).economy.gas=50;R.migrate(state).economy.baseRate=.05;state.profile.creditRating='BBB';
  const energy=E.ensure(state),site=energy.sites.find(row=>row.facilityId==='PWR-GAS-PF');site.commissionedDay=0;
  run('finance-project',{siteId:site.id,amount:100000000});
  const days=[],paidInvoices=()=>(state.finance.invoices||[]).filter(row=>String(row.number||'').startsWith('PFINT-')&&row.status==='مسددة').reduce((n,row)=>n+row.total,0);
  for(let day=101;day<=136;day++){state.simSeconds=day*86400;s.GH_DOMAIN_COMMANDS.dispatchSystem({state},'energy','tick-day',{day,ownerCompanyId:'power'},{actor:'simulation-scheduler'});
    const report=(state.energy.dailyHistory||[]).find(row=>row.day===day)||{},close=closeBlock(s,state,day);
    days.push({day,accrued:report.postCommissionInterestAccrued||0,scheduled:report.debtInterest||0,pnlInterest:close.ed.powerDebtInterest,takeOrPay:close.ed.takeOrPayAccrued||0,pnl:close.operatingExpense.power,cash:close.cashOperatingExpense.power});}
  return {days,pfintPaid:paidInvoices()};
}
if(process.env.GH_B545_CHILD){console.log(JSON.stringify(scenario()));return;}
(()=>{
  const now=scenario(),close=(a,b,t=.01)=>Math.abs(a-b)<=t,accrued=now.days.reduce((n,row)=>n+row.accrued,0);
  assert(now.days.every(row=>row.accrued>0),`Energy Core accrued interest every day (${JSON.stringify(now.days.slice(0,2))})`);
  assert(now.days.every(row=>close(row.pnlInterest,row.accrued)),`1: P&L interest is the day's accrual (${JSON.stringify(now.days.map(row=>[row.day,row.pnlInterest,row.accrued]).slice(0,4))})`);
  assert(now.days.every(row=>close(row.cash,Math.max(0,row.pnl-row.takeOrPay-row.pnlInterest))),'2: the close\'s cash expense leaves the interest (and take-or-pay) out');
  assert(now.pfintPaid>0&&now.pfintPaid<=accrued+.05,`3: the PFINT invoice paid the accrued interest (${now.pfintPaid} of ${accrued})`);
  const tree=fs.mkdtempSync(path.join(os.tmpdir(),'b545-'));
  try{execFileSync('sh',['-c',`git -C "${ROOT}" archive ${PREVIOUS} WebApp | tar -x -C "${tree}"`]);
    const before=JSON.parse(execFileSync(process.execPath,[__filename],{env:{...process.env,GH_B545_CHILD:'1',GH_TEST_SOURCE_DIR:tree},encoding:'utf8',maxBuffer:16*1024*1024}).trim().split('\n').at(-1));
    const paidInClose=before.days.reduce((n,row)=>n+Math.max(0,row.cash-Math.max(0,row.pnl-row.takeOrPay-row.pnlInterest)),0);
    assert(close(paidInClose,before.days.reduce((n,row)=>n+row.pnlInterest,0),.05)&&paidInClose>0,`4: the previous source paid the interest in the close's cash too (${paidInClose})`);
    assert(before.pfintPaid>0,'4: (and on its PFINT invoice)');
    console.log(JSON.stringify({suite:'build545-power-finance-interest',ok:true,accrued:+accrued.toFixed(2),pfintPaid:now.pfintPaid,previous:{interestInCloseCash:+paidInClose.toFixed(2),pfintPaid:before.pfintPaid}}));
  }finally{fs.rmSync(tree,{recursive:true,force:true});}
})();
