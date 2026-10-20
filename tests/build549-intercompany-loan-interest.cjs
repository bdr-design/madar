'use strict';
// Interest paid on a loan between group members (the treasury's internal financing) got paid invoices on both sides but
// reached neither close: the borrower's profit left out its interest expense and the lender's (or the holding's) left out
// its interest income. Proven on the real finance, corporate and domain command owners (the treasury's own commands):
//  1. a repayment's interest is the borrower's expense and the holding's income in their next closes;
//  2. between two companies, the borrower's expense and the lender company's income;
//  3. the group's consolidated row is told to leave it out (intercompany), once; a repeated repayment notes nothing again,
//     and a repayment of principal alone notes no interest;
//  4. the previous source (run from its own tree) noted neither side.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'),SOURCE=process.env.GH_TEST_SOURCE_DIR||ROOT,PREVIOUS='f5ddadf';
process.env.GH_TEST_SOURCE_DIR=SOURCE;
const {harness,minimal}=require('./helpers/core-harness');

function scenario(){
  const h=harness(['capability-registry-core','company-definitions','company-platform-core','identity-system','control-plane-core','authorization-core','document-proof-core','transaction-core','domain-command-core','save-schema','determinism-core','event-ledger-core','dependency-core','policy-core','lifecycle-core','delivery-monitor-core','realism-core','finance-core','hr-core','corporate-core','facility-core','game-lifecycle-core']);
  const {s}=h,d={...minimal(),profile:{name:'Treasury Group'},bank:{},operations:{},crew:[],branches:[],hired:[],unlockedSectors:[],ownedCompanies:[]};
  const state=s.GH_GAME_LIFECYCLE.pristine(d,1);s.GH_GAME_LIFECYCLE.foundGroup(state,{mode:'sandbox',name:'Treasury Group',founder:'Founder',locationId:'RUH'},d,{nextId:()=>'FOUND-ICL',simYear:()=>2026});
  const F=s.GH_FINANCE_CORE,command=(name,p)=>s.GH_DOMAIN_COMMANDS.dispatch({state},name.startsWith('open')?'corporate':'finance',name,p).result;
  F.book(state,'group').accounts[0].balance+=2e9;command('open-company',{type:'air',capital:200000000,legalName:'Test Air'});command('open-company',{type:'insurance',capital:200000000,legalName:'Test Insurance'});
  const holdingLoan=command('issue-intercompany-loan',{lender:'group',borrower:'air',amount:10000000,annualRate:.06,termDays:365}),companyLoan=command('issue-intercompany-loan',{lender:'insurance',borrower:'air',amount:5000000,annualRate:.05,termDays:365});
  const take=()=>{const pnl=F.takeOffClosePnl(state),pick=id=>({revenue:+(pnl[id]?.revenue||0).toFixed(2),expense:+(pnl[id]?.expense||0).toFixed(2)});return {air:pick('air'),group:pick('group'),insurance:pick('insurance'),intercompany:+(Number(F.takeOffCloseIntercompany?.(state))||0).toFixed(2)};};
  take();state.simSeconds=30*86400;
  const first=command('repay-intercompany-loan',{id:holdingLoan.id,amount:1000000,reference:'ICLSET-QA-1'}),afterFirst=take();
  const repeat=command('repay-intercompany-loan',{id:holdingLoan.id,amount:1000000,reference:'ICLSET-QA-1'}),afterRepeat=take();
  const principal=command('repay-intercompany-loan',{id:holdingLoan.id,amount:500000,reference:'ICLSET-QA-2'}),afterPrincipal=take();
  const second=command('repay-intercompany-loan',{id:companyLoan.id,reference:'ICLSET-QA-3'}),afterSecond=take();
  return {first:{interest:first.interest,principal:first.principal,...afterFirst},repeat:{amount:repeat.amount,...afterRepeat},principal:{interest:principal.interest,principal:principal.principal,...afterPrincipal},second:{interest:second.interest,principal:second.principal,...afterSecond}};
}
if(process.env.GH_B549_CHILD){console.log(JSON.stringify(scenario()));return;}
(()=>{
  const now=scenario(),close=(a,b)=>Math.abs(a-b)<.01,{first,repeat,principal,second}=now;
  assert(close(first.interest,10000000*.06*30/365)&&close(first.principal,1000000-first.interest),`the repayment paid 30 days of interest first (${JSON.stringify(first)})`);
  assert(close(first.air.expense,first.interest)&&close(first.group.revenue,first.interest),`1: the borrower's expense and the holding's income (${JSON.stringify(first)})`);
  assert(close(first.intercompany,first.interest),'3: the group row is told to leave it out');
  assert.deepEqual([repeat.air.expense,repeat.group.revenue,repeat.intercompany],[0,0,0],`3: a repeated repayment notes nothing (${JSON.stringify(repeat)})`);
  assert(principal.interest===0&&close(principal.principal,500000),'a same-day repayment pays principal only');
  assert.deepEqual([principal.air.expense,principal.group.revenue,principal.intercompany],[0,0,0],'3: and notes no interest');
  assert(close(second.interest,5000000*.05*30/365)&&close(second.principal,5000000),`the company loan was repaid in full (${JSON.stringify(second)})`);
  assert(close(second.air.expense,second.interest)&&close(second.insurance.revenue,second.interest)&&second.group.revenue===0,`2: the borrower's expense and the lender company's income (${JSON.stringify(second)})`);
  assert(close(second.intercompany,second.interest),'3: left out of the group row');
  const tree=fs.mkdtempSync(path.join(os.tmpdir(),'b549-'));
  try{execFileSync('sh',['-c',`git -C "${ROOT}" archive ${PREVIOUS} WebApp | tar -x -C "${tree}"`]);
    const before=JSON.parse(execFileSync(process.execPath,[__filename],{env:{...process.env,GH_B549_CHILD:'1',GH_TEST_SOURCE_DIR:tree},encoding:'utf8',maxBuffer:16*1024*1024}).trim().split('\n').at(-1));
    assert(close(before.first.interest,first.interest)&&close(before.second.interest,second.interest),'the previous source paid the same interest');
    assert.deepEqual([before.first.air.expense,before.first.group.revenue,before.second.air.expense,before.second.insurance.revenue],[0,0,0,0],`4: and noted neither side (${JSON.stringify(before)})`);
    console.log(JSON.stringify({suite:'build549-intercompany-loan-interest',ok:true,current:{holding:first,company:second},previous:{holding:before.first,company:before.second}}));
  }finally{fs.rmSync(tree,{recursive:true,force:true});}
})();
