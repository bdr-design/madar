'use strict';
const assert=require('node:assert/strict'),{harness,minimal}=require('./helpers/core-harness');
const {s}=harness(['capability-registry-core','company-definitions','company-platform-core','identity-system','control-plane-core','authorization-core','document-proof-core','transaction-core','domain-command-core','save-schema','determinism-core','event-ledger-core','dependency-core','policy-core','lifecycle-core','delivery-monitor-core','realism-core','finance-core','hr-core','corporate-core','procurement-core','facility-core','energy-core','realestate-core','economics-core','operations-core','game-lifecycle-core']);
const E=s.GH_ENERGY_CORE,RE=s.GH_REALESTATE_CORE,F=s.GH_FINANCE_CORE,plain=x=>JSON.parse(JSON.stringify(x)),near=(a,b)=>assert.ok(Math.abs(a-b)<.02,`${a} != ${b}`),results=[];
function setup(){
 const defaults={...minimal(),profile:{name:'Construction'},bank:{},operations:{},crew:[],branches:[],hired:[],unlockedSectors:[],ownedCompanies:[]},state=s.GH_GAME_LIFECYCLE.pristine(defaults,1);
 s.GH_GAME_LIFECYCLE.foundGroup(state,{mode:'sandbox',name:'Construction QA',founder:'Founder',locationId:'RUH'},defaults,{nextId:()=> 'FOUND-380',simYear:()=>2026});
 for(const type of ['power','realestate'])s.GH_DOMAIN_COMMANDS.dispatch({state},'corporate','open-company',{type,capital:400000000,legalName:`QA ${type}`});
 state.customHubs.push({id:'RE-RUH',kind:'realestate',ownerCompanyId:'realestate',owned:true,city:'الرياض',country:'السعودية',dailyCost:1800});
 const contract=s.GH_DOMAIN_COMMANDS.dispatch({state},'procurement','award-construction',{company:'power',facilityKind:'power',siteName:'QA Solar',bid:{supplier:{id:'QA-BUILDER',legalName:'مقاول الطاقة'},quote:82000000,score:90}}).result;
 Object.assign(contract,{leadDays:120,capacityKey:'solarMW',capacityAmount:100,energyKind:'solar',commissioned:false});
 state.customHubs.push({id:'SOLAR-380',name:'QA Solar',kind:'power',ownerCompanyId:'power',owned:true,city:'الرياض',country:'السعودية',energyKind:'solar',capacityAmount:100,capacity:'100 MW',cost:82000000,commissioned:false,dailyCost:0,plannedDailyCost:12000,constructionContractId:contract.id});
 E.ensure(state);const re=RE.ensure(state),project=RE.execute({state},'start-project',{officeId:re.offices[0].id,type:'residential',size:1,priceLevel:1,mode:'sale'});return {state,contractId:contract.id,projectId:project.id};
}
const run=(state,domain,id,key)=>{const owner=domain==='energy'?E:RE,quote=owner.constructionAccelerationQuote(state,domain==='energy'?id:state.realEstate.projects.find(p=>p.id===id));assert.ok(quote);const payload={...(domain==='energy'?{contractId:id}:{projectId:id}),expectedFee:quote.fee,expectedCompleteDay:quote.completeDay};return {quote,payload,result:s.GH_DOMAIN_COMMANDS.dispatch({state},domain,'accelerate-construction',payload,{idempotencyKey:key}).result};};
function check(name,fn){fn();results.push(name);}
// Owner (build 97): a paid acceleration finishes the plant or the project on the day its fee clears (it used to halve
// the remaining time). The fee is unchanged.
check('fee is debited once, VAT and proofs are preserved, the plant or project is finished at once',()=>{
 const {state,contractId,projectId}=setup();state.simSeconds=30*86400;
 const original=state.finance.commercialContracts.find(row=>row.id===state.realEstate.projects[0].legalDocumentId),originalJSON=JSON.stringify(original);
 for(const [domain,id,company]of [['energy',contractId,'power'],['realestate',projectId,'realestate']]){
  const before=F.operating(state,company),progress=domain==='energy'?E.constructionProgress(state.constructionContracts[0],30):RE.projectProgress(state.realEstate.projects[0],30),priorCheques=state.finance.cheques.length,priorIds=new Set(state.finance.cheques.map(c=>c.id));
  const {quote,payload,result}=run(state,domain,id,`${domain}-acceleration`),paid=state.finance.cheques.filter(c=>!priorIds.has(c.id)),built=paid.filter(c=>c.id!==result.chequeId);
  assert.equal(quote.completeDay,30,'finished on the day the fee clears');
  // The fee once; a real-estate project also pays its remaining construction milestones now (due at its completion).
  assert.equal(paid.length-built.length,1);assert.equal(built.length,domain==='energy'?0:2);near(before-F.operating(state,company),quote.fee+built.reduce((sum,c)=>sum+Number(c.amount),0));const cheque=state.finance.cheques.find(c=>c.id===result.chequeId),invoice=state.finance.invoices.find(i=>i.number===cheque.invoiceNumber),doc=state.finance.commercialContracts.find(c=>c.id===result.legalDocumentId);
  assert.equal(cheque.status,'مصروف');assert.equal(invoice.status,'مسددة');assert.equal(invoice.company,company);assert.ok(invoice.tax>0);for(const record of [cheque,invoice,doc])assert.equal(s.GH_DOCUMENT_PROOF.verifyDocument(state,record).ok,true);
  const after=F.operating(state,company),count=state.finance.cheques.length;s.GH_DOMAIN_COMMANDS.dispatch({state},domain,'accelerate-construction',payload,{idempotencyKey:`${domain}-acceleration`});s.GH_DOMAIN_COMMANDS.dispatch({state},domain,'accelerate-construction',payload,{idempotencyKey:`${domain}-different-key`});near(F.operating(state,company),after);assert.equal(state.finance.cheques.length,count);
  assert.equal(domain==='energy'?E.constructionProgress(state.constructionContracts[0],30):RE.projectProgress(state.realEstate.projects[0],30),1,'finished at once');void progress;
  if(domain==='energy')assert.equal(state.constructionContracts[0].commissioned,true,'the plant is commissioned when the fee clears');else assert.equal(state.realEstate.projects[0].status,'مكتمل','the project is handed over when the fee clears');
 }
 assert.equal(JSON.stringify(original),originalJSON,'the original signed development contract is immutable');
});
check('stale quotes, wrong owners and insufficient cash leave no charge or acceleration',()=>{
 for(const domain of ['energy','realestate'])for(const failure of ['stale','ownerCompanyId','companyId','company','cash','late']){
  const {state,contractId,projectId}=setup(),id=domain==='energy'?contractId:projectId,owner=domain==='energy'?E:RE,company=domain==='energy'?'power':'realestate';state.simSeconds=20*86400;
  const quote=owner.constructionAccelerationQuote(state,domain==='energy'?id:state.realEstate.projects[0]),payload={...(domain==='energy'?{contractId:id}:{projectId:id}),expectedFee:quote.fee,expectedCompleteDay:quote.completeDay};
  if(failure==='stale')payload.expectedFee--;
  if(['ownerCompanyId','companyId','company'].includes(failure))payload[failure]='air';
  if(failure==='cash'){for(const a of F.book(state,company).accounts)a.balance=0;state.godMoney=false;state.infiniteMoney=false;F.reconcile(state);}
  s.GH_DOMAIN_COMMANDS.ensureRuntime(state);const before=JSON.stringify(state),original=F.execute;
  if(failure==='late')F.execute=function(ctx,cmd,p,...args){const out=original.call(this,ctx,cmd,p,...args);if(cmd==='register-commercial-contract'&&String(p.id).includes('ACCEL'))throw new Error('qa-late-document-failure');return out;};
  try{assert.throws(()=>s.GH_DOMAIN_COMMANDS.dispatch({state},domain,'accelerate-construction',payload,{idempotencyKey:`fail-${domain}-${failure}`}));}finally{F.execute=original;}
  assert.equal(JSON.stringify(state),before,`${domain}/${failure}: rollback includes cash, documents, schedule and cost`);
 }
});
check('energy output before the fee is historical, the plant runs at full capacity once it clears, and commissions only once',()=>{
 const {state,contractId}=setup();state.simSeconds=50*86400;const energy=E.ensure(state),site=energy.sites[0];let won;
 for(let i=0;i<40&&!won;i++){energy.tenders.push({id:`QA-380-T-${i}`,siteId:site.id,siteName:site.name,buyer:'مركز بيانات',capacityMW:40,referencePrice:95,termDays:3650,competitors:2,day:50,expiresDay:60,status:'مفتوحة'});const bid=s.GH_DOMAIN_COMMANDS.dispatch({state},'energy','bid-tender',{id:`QA-380-T-${i}`,level:'low'}).result;if(bid.won)won=bid.contract;}
 assert.ok(won);const signed=state.finance.commercialContracts.find(c=>c.id===won.legalDocumentId),signedBefore=JSON.stringify(signed),before=E.siteEconomics(state)[0],history=JSON.stringify(state.energy.dailyHistory);run(state,'energy',contractId,'energy-phases');const contract=state.constructionContracts.find(c=>c.id===contractId),a=contract.constructionAcceleration;
 const after=E.siteEconomics(state)[0];assert.ok(before.phasedShare<1,'the plant was still being built');assert.ok(after.commissioned===true&&!(after.phasedShare<1),'from the day the fee clears the plant runs at full capacity');assert.ok(after.spotRevenue>before.spotRevenue);assert.equal(JSON.stringify(state.energy.dailyHistory),history,'past output is unchanged');
 state.simSeconds=56*86400;assert.ok(!(E.siteEconomics(state)[0].phasedShare<1),'and stays at full capacity');
 for(const day of [a.completeDay,a.completeDay+1]){state.simSeconds=day*86400;for(const _ of s.GH_REALISM.onDayStages(state,day)){}E.tickDay(state,{day});}
 assert.equal(contract.commissioned,true);assert.equal(state.energy.solarMW,100,'capacity commissioned once');assert.ok(state.energy.dailyHistory[0].powerRevenue>0);const report=plain(state.energy.dailyHistory[0]);E.tickDay(state,{day:a.completeDay+1});assert.deepEqual(plain(state.energy.dailyHistory[0]),report);
 const ppa=state.energy.ppaContracts.find(c=>c.id===won.id);assert.equal(ppa.startDay,a.completeDay);assert.equal(ppa.endDay,a.completeDay+3650);assert.equal(JSON.stringify(signed),signedBefore);assert.equal(s.GH_DOCUMENT_PROOF.verifyDocument(state,state.finance.commercialContracts.find(c=>c.id===ppa.commissioningDocumentId)).ok,true);assert.ok(state.energy.dailyHistory[0].ppaRevenue>0);
});
check('accelerated real-estate handover keeps milestones and recognises each off-plan amount once',()=>{
 const {state,projectId}=setup(),project=state.realEstate.projects.find(p=>p.id===projectId);delete project.risk;
 let totalRevenue=0,totalCash=0,totalCost=0;for(let day=1;day<=30;day++){state.simSeconds=day*86400;const r=RE.tickDay(state,{day});totalRevenue+=r.offPlanRevenue;totalCash+=r.offPlanCash;totalCost+=r.costOfSales;}
 const history=JSON.stringify(state.realEstate.dailyHistory),finalValue=project.offPlan.value,chequesBefore=new Set(project.cheques),{quote}=run(state,'realestate',projectId,'realestate-income');
 // Handed over when the fee clears: the remaining construction payments are made and the off-plan contracts settled.
 assert.equal(project.status,'مكتمل');assert.equal(project.milestonesPaid,3);assert.equal(project.cheques.length,4,'three construction payments and one acceleration fee');assert.equal(project.offPlan,null);
 assert.equal(JSON.stringify(state.realEstate.dailyHistory),history,'charging acceleration never invents a daily revenue entry');
 // The next close books it once: the fee and the two milestones in its capex, the handover's revenue, cost and cash.
 const built=state.finance.cheques.filter(c=>project.cheques.includes(c.id)&&!chequesBefore.has(c.id)&&c.id!==project.constructionAcceleration.chequeId).reduce((sum,c)=>sum+Number(c.amount),0);
 state.simSeconds=31*86400;const r=RE.tickDay(state,{day:31});totalRevenue+=r.offPlanRevenue;totalCash+=r.offPlanCash;totalCost+=r.costOfSales;
 assert.ok(r.completed.includes(projectId),'the close reports the handover');assert.ok(Math.abs(r.capex-quote.fee-built)<=1,`the fee and the milestones once (${r.capex} vs ${quote.fee+built})`);
 const daily=RE.dailyResult(state,31);near(daily.revenue,r.revenue);near(daily.cashRevenue,r.revenue-r.internalRentRevenue-r.externalRentRevenue-r.offPlanRevenue+r.offPlanCash);
 near(totalRevenue,finalValue);near(totalCash,finalValue);assert.ok(totalCost>0);
 const snapshot=JSON.stringify(state);RE.tickDay(state,{day:31});assert.equal(JSON.stringify(state),snapshot,'repeated close never repeats revenue or fees');
 const loaded=JSON.parse(snapshot);RE.tickDay(loaded,{day:31});assert.equal(JSON.stringify(loaded),snapshot,'reload of same day is idempotent');
 state.simSeconds=32*86400;const next=RE.tickDay(state,{day:32});assert.ok(!next.completed.includes(projectId)&&next.capex<1,'and the day after books nothing of it again');
});
check('quotes are read-only and independent of fleet size; lease depreciation includes the paid fee',()=>{
 const {state,projectId,contractId}=setup(),before=JSON.stringify(state);
 Object.defineProperty(state,'assets',{get(){throw new Error('quote-must-not-scan-fleet');},configurable:true});
 const project=state.realEstate.projects.find(p=>p.id===projectId),contract=state.constructionContracts.find(c=>c.id===contractId),facility=state.customHubs.find(f=>f.constructionContractId===contractId);
 for(let i=0;i<10000;i++){assert.ok(E.constructionAccelerationQuote(state,contract,facility));assert.ok(RE.constructionAccelerationQuote(state,project));}
 Object.defineProperty(state,'assets',{value:[],writable:true,enumerable:true,configurable:true});assert.equal(JSON.stringify(state),before);
 const re=RE.ensure(state),started=RE.execute({state},'start-project',{officeId:re.offices[0].id,type:'residential',size:1,priceLevel:1,mode:'lease'}),lease=re.projects.find(p=>p.id===started.id);delete lease.risk;lease.leased=100;
 const {quote}=run(state,'realestate',lease.id,'lease-acceleration');assert.equal(lease.status,'مكتمل','the building is finished when the fee clears');state.simSeconds=86400;const report=RE.tickDay(state,{day:1});
 assert.ok(lease.today.rent>0);near(report.depreciation,(lease.buildCost+quote.fee)/(40*365));assert.equal(lease.milestonesPaid,3);assert.equal(lease.priceLevel,1);
});
console.log(JSON.stringify({suite:'build380-construction-acceleration',passed:results.length,checks:results}));
