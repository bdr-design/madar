'use strict';
// Owner («نفذ الباقي»; a dealer purchase order paid by cheque took 25-38 ms in one task at 2x CPU throttle in a 300k-asset
// world): the cheque payment's three parts are steps; GH_FINANCE_CORE.executeStages('pay-by-cheque') yields between them
// and the dealer reorder takes them as stages. In the real finance, document proof and authorization owners (a founder's
// seal and mandate), against the source before (93d77d4, its execute, from its own tree):
//  1. 30 payments made in stages leave the same finance, document proofs and authorization as the same payments made at
//     once by the source before, and as payByCheque now; each staged payment yields twice (accrued, issued);
//  2. a payment retried with its request reference returns the same settled result, staged or not, without new documents;
//  3. a refused payment (no beneficiary, conflicting retry) fails with the same error at its first step;
//  4. the dealer reorder takes the payment's stages: with a staged finance, one order yields its payment steps, the same
//     purchase is recorded, and with a finance that has no stages nothing changes (the customer-companies and dealer owners).
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'),PREVIOUS='93d77d4';
if(process.argv[2]==='--run'){
  const mode=process.argv[4],{scenario}=require(path.join(ROOT,'tests/helpers/business-scenario')),e=scenario(),s=e.s,state=e.state,Auth=s.GH_AUTHORIZATION,F=s.GH_FINANCE_CORE;state.godMoney=true;state.infiniteMoney=true;
  Auth.ensurePrincipal(state,{id:'PLAYER-FOUNDER',legalName:'B629 Founder'});let seed=629;const r=()=>{seed=(seed*1103515245+12345)%2147483648;return Math.round(seed/2147483648*10000)/10000;};
  Auth.createVisualSeal(state,{ownerPersonId:'PLAYER-FOUNDER',strokes:[Array.from({length:30},()=>({x:r(),y:r()}))]});
  const pay=p=>{if(mode==='staged'){const steps=F.executeStages({state},'pay-by-cheque',p);let step,yields=[];while(!(step=steps.next()).done)yields.push(step.value);return {value:step.value,yields};}return {value:F.execute({state},'pay-by-cheque',p),yields:[]};};
  const request=i=>({company:i%2?'air':'group',amount:5000+i*13.5,note:`b629 order ${i}`,beneficiary:'OEM Supplier LLC',line:'capex',taxable:true,requestRef:`B629-${i}`,type:'شيك مورد'});
  const out={yields:[],retry:null,errors:[]};
  for(let i=0;i<30;i++)out.yields.push(pay(request(i)).yields);
  const documents=()=>Object.keys(state.documentProofs.recordsById).length,before=documents(),retry=pay(request(7));out.retry={idempotent:retry.value.idempotent===true,status:retry.value.cheque?.status,newDocuments:documents()-before,yields:retry.yields};
  for(const bad of [{...request(40),beneficiary:''},{...request(8),amount:1}]){try{pay(bad);out.errors.push(null);}catch(error){out.errors.push(String(error?.message||error));}}
  out.state={finance:state.finance,companyFinance:state.companyFinance,documentProofs:state.documentProofs,authorization:state.authorization};
  fs.writeFileSync(process.argv[3],JSON.stringify(out));process.exit(0);
}
const run=(root,mode)=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'b629-out-')),out=path.join(dir,'run.json');try{execFileSync(process.execPath,[__filename,'--run',out,mode],{env:{...process.env,GH_TEST_SOURCE_DIR:root},stdio:['ignore','ignore','inherit']});return JSON.parse(fs.readFileSync(out,'utf8'));}finally{fs.rmSync(dir,{recursive:true,force:true});}};
const tree=fs.mkdtempSync(path.join(os.tmpdir(),'b629-'));let before;
try{execFileSync('sh',['-c',`git -C "${ROOT}" archive ${PREVIOUS} WebApp | tar -x -C "${tree}"`]);before=run(tree,'whole');}finally{fs.rmSync(tree,{recursive:true,force:true});}
const SOURCE=process.env.GH_TEST_SOURCE_DIR||ROOT,staged=run(SOURCE,'staged'),whole=run(SOURCE,'whole');
// 1.
assert.ok(staged.state.finance.cheques.filter(row=>row.status==='مصروف').length>=30,'1: thirty cheques paid');
assert.equal(JSON.stringify(staged.state),JSON.stringify(before.state),'1: staged payments leave the same finance, proofs and authorization as the source before');
assert.equal(JSON.stringify(whole.state),JSON.stringify(before.state),'1: so do payments made at once now');
assert.ok(staged.yields.every(list=>JSON.stringify(list)===JSON.stringify(['finance:pay-by-cheque.accrued','finance:pay-by-cheque.issued'])),'1: each staged payment yields twice');
// 2.
assert.deepEqual(staged.retry,{idempotent:true,status:'مصروف',newDocuments:0,yields:[]},'2: a retry returns the settled payment at once');assert.deepEqual({...whole.retry,yields:[]},staged.retry,'2: the same at once');
// 3.
assert.deepEqual(staged.errors,before.errors,'3: the same errors');assert.ok(staged.errors.every(Boolean),'3: (both refused)');
// 4.
{
  const {harness}=require('./helpers/core-harness'),DAY=86400;
  const setup=withStages=>{
    const h=harness([]),s=h.s,parties=new Map(),cheques=[],stagesSeen=[];
    s.GH_AUTHORIZATION={registerCommandTargetResolver(){}};
    s.GH_COMPANY_PLATFORM={requireCompany(_state,id){return {id,operational:true,registered:true};},resolveCompany(_state,id){return {id,operational:true};}};
    s.GH_BUSINESS_WORLD={recordEvent(){},upsertParty(_state,p){const id=String(p.id||`CUST-${parties.size+1}`),old=parties.get(id)||{id,roles:[]};Object.assign(old,p,{id,roles:[...new Set([...(old.roles||[]),...(p.role?[p.role]:[]),...(p.roles||[])])]});parties.set(id,old);return old;},resolveParty(_state,id){return parties.get(String(id))||[...parties.values()].find(row=>row.name===id||row.displayName===id)||null;},touchRelationship(){return {};},touchCustomerLifecycle(){return {};},customerPortfolio(){return {companies:{}};}};
    let spent=0;
    const payCheque=p=>{spent+=p.amount;cheques.push({amount:p.amount,beneficiary:p.beneficiary,requestRef:p.requestRef});return {cheque:{id:`CHQ-${cheques.length}`,status:'مصروف'},invoice:{number:`AP-${cheques.length}`}};};
    s.GH_FINANCE_CORE={calendarMonthForDay(value){const date=new Date(Date.UTC(2026,0,1)+Math.max(0,Number(value)||0)*86400000);return `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,'0')}`;},operating(){return 1e12-spent;},
      execute(ctx,cmd,p){if(cmd==='credit'){const row={company:p.company,kind:'دخل',number:`INV-${ctx.state.finance.invoices.length+1}`,sourceRef:p.ref,total:p.amount,status:'مستحقة',at:ctx.state.simSeconds||0,counterpartyPartyId:p.customerId};ctx.state.finance.invoices.push(row);return row;}
        if(cmd==='pay-by-cheque')return payCheque(p);if(cmd==='register-commercial-contract'){(ctx.state.finance.commercialContracts||(ctx.state.finance.commercialContracts=[])).push({id:p.id});return {id:p.id};}throw new Error(`unexpected finance command ${cmd}`);}};
    if(withStages)s.GH_FINANCE_CORE.executeStages=function*(ctx,cmd,p){if(cmd!=='pay-by-cheque')return s.GH_FINANCE_CORE.execute(ctx,cmd,p);yield 'qa:accrued';yield 'qa:issued';return payCheque(p);};
    s.GH_DOMAIN_COMMANDS={dispatchSystem(_ctx,domain,cmd,p){if(domain==='finance'&&cmd==='credit')return {ok:true,result:s.GH_FINANCE_CORE.execute({state:s},cmd,p)};if(domain==='banking'&&cmd==='submit-customer-loan-request'){const row={id:p.id,sourceCompanyId:'dealership',sourceSaleId:p.sourceSaleId,status:'بانتظار القرار'};s.bank.loanRequests.push(row);return {ok:true,result:row};}throw new Error(`unexpected system command ${domain}:${cmd}`);}};
    s.GH_BANKING_CORE={MAX_OPEN_REQUESTS:5,countryPopulation:name=>({'السعودية':35300000,'الإمارات':9890000}[name]||10000000),customerFinancingQuote(_state,p){return {invoiceAmount:p.invoiceAmount,downPayment:0,loanPrincipal:p.invoiceAmount,originationFee:0,disbursementAmount:p.invoiceAmount,termDays:p.termDays,product:p.product};},customerDisbursementForSale(){return null;},execute(){}};
    s.GH_MAP_LABELS=[];h.load('customer-companies-core');h.load('customer-base-core');h.load('dealer-market-core');
    s.simSeconds=0;s.finance={invoices:[]};s.bank={loanRequests:[],branchNetwork:[{id:'BANK-RUH',servicesActive:true}]};s.openedCompanies=['dealership','bank'];
    s.customHubs=[['AUTO-RUH','الرياض','السعودية'],['AUTO-DXB','دبي','الإمارات']].map(([id,city,country])=>({id,kind:'dealership-branch',ownerCompanyId:'dealership',owned:true,city,country,name:`معرض ${city}`}));
    for(let day=0;day<=15;day++){s.simSeconds=day*DAY;const steps=s.GH_CUSTOMER_COMPANIES_CORE.onFinancialDayStages({state:s,companyId:'dealership'},{day});let step;while(!(step=steps.next()).done)stagesSeen.push(String(step.value));}
    return {state:JSON.stringify({companies:s.customerCompanies,finance:s.finance,cheques}),stages:stagesSeen,cheques:cheques.length};
  };
  const a=setup(true),b=setup(false);
  assert.ok(a.cheques>=3,`4: the reorders were paid (${a.cheques})`);assert.equal(a.state,b.state,'4: the same purchases with a staged finance');
  assert.equal(a.stages.filter(x=>x==='qa:accrued').length,a.cheques,'4: each order yields its payment steps');assert.deepEqual(a.stages.filter(x=>!x.startsWith('qa:')),b.stages,'4: every other stage the same');
}
console.log(JSON.stringify({suite:'build629-cheque-payment-stages',ok:true,payments:staged.yields.length,cheques:staged.state.finance.cheques.length}));
