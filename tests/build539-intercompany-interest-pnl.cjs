'use strict';
// Interest a group company pays on a facility from the group's own bank was income in the bank's daily close but no
// expense in the borrower's: the group's profit kept interest one of its companies paid another. Proven on the real
// finance, banking and domain command owners (a bank and an airline, a real facility draw and real bank days):
//  1. the day the borrower pays interest, its daily close carries that interest as an expense, equal to the cash moved and
//     to the interest the bank's close counts as income, so the pair adds nothing to the group's profit;
//  2. a retried settlement (same reference) notes nothing twice; a day the borrower cannot pay notes nothing, and the day
//     it pays the arrears notes the whole amount paid;
//  3. the previous source (run from its own tree) noted no expense for the borrower.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'),SOURCE=process.env.GH_TEST_SOURCE_DIR||ROOT,PREVIOUS='0f1f561';
process.env.GH_TEST_SOURCE_DIR=SOURCE;
const {harness,minimal}=require('./helpers/core-harness');

function world(){
  const h=harness(['capability-registry-core','company-definitions','company-platform-core','identity-system','control-plane-core','authorization-core','document-proof-core','transaction-core','domain-command-core','save-schema','determinism-core','event-ledger-core','dependency-core','policy-core','lifecycle-core','delivery-monitor-core','realism-core','finance-core','hr-core','corporate-core','facility-core','banking-core','game-lifecycle-core']);
  const {s}=h,d={...minimal(),profile:{name:'Interest Group'},bank:{},operations:{},crew:[],branches:[],hired:[],unlockedSectors:[],ownedCompanies:[]};
  const state=s.GH_GAME_LIFECYCLE.pristine(d,1);s.GH_GAME_LIFECYCLE.foundGroup(state,{mode:'sandbox',name:'Interest Group',founder:'Founder',locationId:'RUH'},d,{nextId:()=>'FOUND-INT',simYear:()=>2026});
  const ctx={state},command=(domain,name,p={})=>s.GH_DOMAIN_COMMANDS.dispatch(ctx,domain,name,p).result,system=(domain,name,p={})=>s.GH_DOMAIN_COMMANDS.dispatchSystem(ctx,domain,name,p,{actor:'simulation-scheduler'}).result;
  command('corporate','open-company',{type:'bank',capital:400000000,legalName:'Test Bank'});command('corporate','open-company',{type:'air',capital:200000000,legalName:'Test Air'});
  const F=s.GH_FINANCE_CORE,bank=s.GH_BANKING_CORE.ensure(state);s.GH_BANKING_CORE.execute({state},'sync-corporate-clients',{},F);
  return {s,state,F,bank,command,system,take:()=>F.takeOffClosePnl(state)};
}
function scenario(){
  const w=world(),{s,state,F,bank}=w,out={};
  state.simSeconds=10*86400;
  const client=bank.corporateClients.air;assert(client&&client.creditLimit>0,'the airline is a corporate client with a limit');
  s.GH_BANKING_CORE.execute({state},'draw-facility',{ownerCompanyId:'air',amount:Math.min(50000000,client.creditLimit),termDays:365,rate:.08},F);
  const facility=bank.corporateFacilities.at(-1)||bank.corporateFacilities[0];assert(facility?.outstanding>0,'the facility was drawn');w.take();
  const interestTransfers=()=>state.finance.transfers.filter(row=>row.kind==='intercompany-interest');
  // A normal bank day: the borrower pays the day's interest.
  state.simSeconds=11*86400;w.system('banking','tick-day',{day:11});
  const paid=interestTransfers().reduce((n,row)=>n+row.amount,0),pnl=w.take();
  out.day={paid:+paid.toFixed(2),borrowerExpense:+(pnl.air?.expense||0).toFixed(2),bankRevenueNoted:+(pnl.bank?.revenue||0).toFixed(2),bankReportInterest:+(bank.dailyHistory?.find(row=>row.day===11)?.corporateInterestIncome??NaN)};
  // A retried settlement with the same reference.
  const last=interestTransfers().at(-1);F.execute({state},'settle-intercompany-interest',{from:'air',to:'bank',amount:last.amount,note:last.note,ref:last.reference});
  out.retry=+(w.take().air?.expense||0).toFixed(2);
  // A day the borrower cannot pay, then the day it pays the arrears.
  const air=F.book(state,'air').accounts[0],keep=air.balance;air.balance=0;state.simSeconds=12*86400;w.system('banking','tick-day',{day:12});
  out.unpaid={expense:+(w.take().air?.expense||0).toFixed(2),status:facility.status,arrears:+(facility.interestArrears||0).toFixed(2)};
  air.balance=keep;state.simSeconds=13*86400;w.system('banking','tick-day',{day:13});
  const arrearsPaid=interestTransfers().filter(row=>String(row.reference).endsWith('-13')).reduce((n,row)=>n+row.amount,0);out.arrears={paid:+arrearsPaid.toFixed(2),expense:+(w.take().air?.expense||0).toFixed(2)};
  return out;
}
if(process.env.GH_B539_CHILD){console.log(JSON.stringify(scenario()));return;}
(()=>{
  const now=scenario();
  assert(now.day.paid>0,`the airline paid interest (${JSON.stringify(now.day)})`);
  assert(Math.abs(now.day.borrowerExpense-now.day.paid)<.01,`1: the borrower's close carries the interest it paid (${JSON.stringify(now.day)})`);
  assert.equal(now.day.bankRevenueNoted,0,'1: the bank\'s income is not noted again (its own close counts it)');
  if(Number.isFinite(now.day.bankReportInterest))assert(Math.abs(now.day.bankReportInterest-now.day.paid)<.01,`1: and equals what the bank's close counts (${JSON.stringify(now.day)})`);
  assert.equal(now.retry,0,'2: a retried settlement notes nothing');
  assert.equal(now.unpaid.expense,0,'2: an unpaid day notes nothing');assert(now.unpaid.arrears>0,`the unpaid day left arrears (${JSON.stringify(now.unpaid)})`);
  assert(now.arrears.paid>now.day.paid,'the arrears day paid more than one day');assert(Math.abs(now.arrears.expense-now.arrears.paid)<.01,`2: the arrears day notes the whole amount paid (${JSON.stringify(now.arrears)})`);
  // 3: the previous source.
  const tree=fs.mkdtempSync(path.join(os.tmpdir(),'b539-'));
  try{execFileSync('sh',['-c',`git -C "${ROOT}" archive ${PREVIOUS} WebApp | tar -x -C "${tree}"`]);
    const before=JSON.parse(execFileSync(process.execPath,[__filename],{env:{...process.env,GH_B539_CHILD:'1',GH_TEST_SOURCE_DIR:tree},encoding:'utf8',maxBuffer:16*1024*1024}).trim().split('\n').at(-1));
    assert(before.day.paid>0,'the previous source paid the interest too');assert.equal(before.day.borrowerExpense,0,'3: and noted no expense for the borrower');
    console.log(JSON.stringify({suite:'build539-intercompany-interest-pnl',ok:true,current:now,previous:{paid:before.day.paid,borrowerExpense:before.day.borrowerExpense}}));
  }finally{fs.rmSync(tree,{recursive:true,force:true});}
})();
