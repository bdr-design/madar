'use strict';
// The group's consolidated daily row added every company's revenue and expenses, so what one group company sold another
// (internal rent, electricity, premiums, fees, interest) counted twice in the group's revenue and its expenses; and it
// netted the holding's own income against its overhead. Proven on the real finance, real-estate, economics and domain
// command owners and the daily close's own posting code (app.js, run as written), with a bank, a real estate company
// leasing space to a telecom and a bank tenant, a power company selling the telecom electricity, an arrangement fee and
// facility interest paid to the bank, and a holding with investment income:
//  1. each company's row keeps its intercompany revenue and expenses (unchanged);
//  2. the group row leaves out the day's internal rent, electricity, fee and interest from its revenue and its expenses;
//     the close-owned and capital settlements are not counted twice; the group's profit is unchanged;
//  3. the group row shows the holding's investment income as revenue and its overhead as expense;
//  4. the noted intercompany total is taken once; a malformed holding or intercompany input is refused with no report;
//  5. the previous source (run from its own tree) kept the internal amounts and netted the holding's income away.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm'),{execFileSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'),SOURCE=process.env.GH_TEST_SOURCE_DIR||ROOT,PREVIOUS='9a2307c',DAY=31;
process.env.GH_TEST_SOURCE_DIR=SOURCE;
const {harness,minimal}=require('./helpers/core-harness');

function closeBlock(s,state,box){
  const app=fs.readFileSync(path.join(SOURCE,'WebApp/app.js'),'utf8'),start=app.indexOf('      // Build 375: documents made outside this close'),marker='runOperationsCycle(net,fleetConditionTotal);});',end=app.indexOf(marker,start);assert(start>=0&&end>start,'close block found');
  const run={window:s,state,phase:(_name,fn)=>fn(),runOperationsCycle:()=>{},fleetConditionTotal:0,dispatchSystemCommand:(ctx,domain,name,p,meta)=>domain==='finance'?s.GH_DOMAIN_COMMANDS.dispatchSystem(ctx,domain,name,p,meta):{},...box};
  vm.createContext(run);vm.runInContext(app.slice(start,end+marker.length)+'\nthis.actual={net};',run);return run.actual;
}
function scenario(){
  const {s}=harness(['capability-registry-core','company-definitions','company-platform-core','identity-system','control-plane-core','authorization-core','determinism-core','integrity-core','document-proof-core','transaction-core','domain-command-core','finance-core','facility-core','realestate-core','economics-core','save-schema']);
  const companyIds=['bank','realestate','telecom','power'],companyRegistry=Object.fromEntries(companyIds.map(id=>{const definition=s.GH_COMPANY_DEFINITIONS.get(id);return [id,{id,definitionId:definition.definitionId,definitionVersion:definition.definitionVersion,status:'active'}];}));
  const state={...minimal(),profile:{name:'Group consolidation'},companyRegistry,openedCompanies:companyIds,branches:[],customHubs:[{id:'RE-RUH',kind:'realestate',ownerCompanyId:'realestate',owned:true,city:'الرياض',country:'السعودية'}],realEstate:{},advanced:{}};
  const F=s.GH_FINANCE_CORE;F.ensure(state);for(const id of [...companyIds,'group'])F.book(state,id).accounts[0].balance=250000000;F.reconcile(state);
  const RE=s.GH_REALESTATE_CORE,re=RE.ensure(state),office=re.offices[0];
  re.projects.push({id:'RE-TOWER-QA',officeId:office.id,city:office.city,country:office.country,type:'office',name:'برج المجموعة',mode:'lease',units:60,unitCost:1200000,landCost:2160000,buildCost:12000000,priceLevel:1,startDay:0,completeDay:0,status:'مكتمل',milestonesPaid:3,sold:0,presold:0,leased:0,handedOver:0,salesRevenue:0,rentRevenue:0,leases:[]});
  ['telecom','bank'].forEach((companyId,i)=>RE.leaseToCompany(state,{projectId:'RE-TOWER-QA',companyId,leaseId:`RE-TOWER-QA-${i+1}`,units:i+2,rentLevel:1,years:3}));
  for(let day=1;day<=DAY;day++){state.simSeconds=day*86400;RE.tickDay(state,{day});}
  F.takeOffClosePnl(state);F.takeOffCloseIntercompany?.(state);
  const ed=s.GH_ECONOMICS_CORE.sectorEconomics(state,{day:DAY,preferDailyReport:true}).detail,rent=(RE.dailyResult(state,DAY).internalRentRows||[]).reduce((n,row)=>n+row.amount,0);
  // Settlements outside the close: a bank fee (the bank's own close books it) and facility interest, both intercompany;
  // a close-owned settlement and a capital purchase (neither is noted for the close); the holding's investment income.
  const run=(name,p)=>F.execute({state},name,p);
  run('settle-intercompany-service',{receiverInClose:true,from:'telecom',to:'bank',amount:12000,serviceCategory:'رسوم ترتيب تمويل مصرفي',taxCode:'financial-service-exempt',line:'other',ref:'FEE-QA-1'});
  run('settle-intercompany-interest',{from:'realestate',to:'bank',amount:8000,ref:'CF-INTEREST-QA-1'});
  run('settle-intercompany-service',{closeOwned:true,from:'bank',to:'realestate',amount:3000,line:'other',ref:'RE-INT-RENT-QA'});
  run('settle-intercompany-service',{from:'power',to:'telecom',amount:40000,line:'capex',ref:'CAPEX-QA-1'});
  run('credit',{company:'group',amount:20000,reference:'DIV-QA-1',note:'توزيعات أرباح',counterparty:'شركة مدرجة',investmentResult:20000});
  // The day's operating rows as the close builds them: each engine's P&L, the power company's internal electricity sale.
  const supply={rows:[{buyer:'telecom',mwh:2,amount:500,avoidedExternalCost:600}]},gross={},expense={};
  for(const id of companyIds){gross[id]=Math.max(0,Number(ed.companyRevenue?.[id])||0);expense[id]=Math.max(0,Number(ed.companyExpense?.[id])||0);}
  // The bank's own close books the fee and the interest it was paid (with its other income).
  gross.power+=500+90000;expense.power+=60000;expense.telecom+=500;gross.telecom+=70000;expense.telecom+=30000;gross.bank+=12000+8000+25000;expense.bank+=15000;const pre={gross:{...gross},expense:{...expense}};
  const companyDaily={},closedSectorProfit={};for(const id of companyIds){closedSectorProfit[id]=gross[id]-expense[id];companyDaily[id]={tripRevenue:0,operatingRevenue:gross[id],grossRevenue:gross[id],expenses:expense[id],net:closedSectorProfit[id],tripCount:0};}
  state.lastFinancialDay=DAY;const out=closeBlock(s,state,{companyIds,companyIdSet:new Set(companyIds),companyDaily,closedSectorProfit,groupCost:50000,groupPayrollExpense:0,ed,internalSupply:supply,energyCompany:'power'});
  const report=state.finance.dailyCompanyReports.find(row=>row.day===DAY),sum=field=>companyIds.reduce((n,id)=>n+report.companies[id][field],0);
  const refused={};for(const [name,extra] of Object.entries({holding:{holding:{revenue:1,expense:0}},intercompany:{intercompany:-1}})){const before=state.finance.dailyCompanyReports.length;try{F.execute({state},'record-daily-close',{day:DAY+1,net:0,...extra});refused[name]='accepted';}catch(error){refused[name]=String(error.message);}refused[`${name}Reports`]=state.finance.dailyCompanyReports.length-before;}
  return {rent,rentRows:Object.fromEntries((RE.dailyResult(state,DAY).internalRentRows||[]).map(row=>[row.companyId,row.amount])),pre,net:out.net,group:report.group,companies:report.companies,sum:{grossRevenue:sum('grossRevenue'),expenses:sum('expenses'),net:sum('net')},leftover:F.takeOffCloseIntercompany?.(state)??null,refused};
}
if(process.env.GH_B548_CHILD){console.log(JSON.stringify(scenario()));return;}
(()=>{
  const now=scenario(),close=(a,b)=>Math.abs(a-b)<.01,{group,companies,sum}=now;
  assert(now.rent>0,`internal rent accrued (${now.rent})`);
  const {pre}=now;
  assert(close(pre.expense.telecom,now.rentRows.telecom+500+30000)&&close(companies.telecom.expenses,pre.expense.telecom+12000),`1: the telecom row keeps its rent, electricity and fee (${JSON.stringify(companies.telecom)})`);
  assert(close(companies.realestate.grossRevenue,pre.gross.realestate)&&companies.realestate.grossRevenue>=now.rent&&close(companies.realestate.expenses,pre.expense.realestate+8000),`1: the landlord's row keeps the internal rent and its interest (${JSON.stringify(companies.realestate)})`);
  assert(close(companies.bank.grossRevenue,pre.gross.bank)&&close(companies.bank.expenses,pre.expense.bank)&&close(companies.power.grossRevenue,pre.gross.power)&&close(companies.power.expenses,pre.expense.power),'1: the bank and power rows are as their closes booked them');
  const internal=now.rent+500+12000+8000;
  assert(close(group.intercompanyEliminated,internal),`2: the group leaves out rent, electricity, fee and interest, nothing else (${group.intercompanyEliminated} vs ${internal})`);
  assert(close(group.grossRevenue,sum.grossRevenue-internal+20000),`2/3: the group's revenue (${group.grossRevenue}; companies ${sum.grossRevenue})`);
  assert(close(group.expenses,sum.expenses-internal+50000),`2/3: the group's expenses (${group.expenses}; companies ${sum.expenses})`);
  assert(close(group.net,now.net)&&close(now.net,sum.net+20000-50000)&&close(group.grossRevenue-group.expenses,now.net),'2: the group\'s profit is unchanged');
  assert(close(group.holdingRevenue,20000)&&close(group.overhead,50000),`3: the holding's income and overhead (${JSON.stringify(group)})`);
  assert.equal(now.leftover,0,'4: the noted intercompany total was taken by the close');
  assert.match(now.refused.holding,/finance-daily-close-holding-unbalanced/);assert.match(now.refused.intercompany,/finance-daily-close-intercompany-negative/);
  assert.equal(now.refused.holdingReports,0);assert.equal(now.refused.intercompanyReports,0,'4: a refused close records nothing');
  const tree=fs.mkdtempSync(path.join(os.tmpdir(),'b548-'));
  try{execFileSync('sh',['-c',`git -C "${ROOT}" archive ${PREVIOUS} WebApp | tar -x -C "${tree}"`]);
    const before=JSON.parse(execFileSync(process.execPath,[__filename],{env:{...process.env,GH_B548_CHILD:'1',GH_TEST_SOURCE_DIR:tree},encoding:'utf8',maxBuffer:16*1024*1024}).trim().split('\n').at(-1));
    assert(close(before.net,now.net),'the previous source had the same profit');
    assert(close(before.group.grossRevenue,before.sum.grossRevenue)&&before.group.holdingRevenue===0,`5: the previous source kept the internal revenue and no holding income (${JSON.stringify(before.group)})`);
    assert(close(before.group.expenses,before.sum.expenses+30000),'5: and netted the holding\'s income against its overhead');
    console.log(JSON.stringify({suite:'build548-group-intercompany-elimination',ok:true,current:{eliminated:group.intercompanyEliminated,grossRevenue:group.grossRevenue,expenses:group.expenses,net:group.net,holdingRevenue:group.holdingRevenue,overhead:group.overhead},previous:{grossRevenue:before.group.grossRevenue,expenses:before.group.expenses,net:before.group.net}}));
  }finally{fs.rmSync(tree,{recursive:true,force:true});}
})();
