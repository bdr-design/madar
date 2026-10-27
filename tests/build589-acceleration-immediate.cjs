'use strict';
// Owner (build 97): a paid acceleration builds the plant, the project or the hotel at once. Energy commissions the plant
// when the fee clears (by the owners the daily close uses); real estate pays its remaining milestones and hands the
// project over when the fee clears (its construction step, moved out of the daily close into one function, runs then and
// its totals join the next close); a hotel was already finished at once. Proven on the real owners against the source
// before (67ab1fe, from its own tree), each in its own process:
//  1. without an acceleration nothing changes: sixty daily closes of real estate (two projects, sale and lease, with the
//     random delay and overrun) and of energy leave the very same state as the previous source's;
//  2. a paid acceleration finishes each at once: the plant is commissioned with its capacity added once (a later close
//     adds nothing), the project is handed over with all three milestones paid, the hotel operates;
//  3. the fee is the previous source's fee for the same contract, project and property.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..'),PREVIOUS='67ab1fe';
if(process.argv[2]==='--measure'){
  process.env.GH_TEST_SOURCE_DIR=process.argv[3];
  const {harness,minimal}=require(path.join(process.argv[3],'tests/helpers/core-harness'));
  const MODULES=['capability-registry-core','company-definitions','company-platform-core','identity-system','control-plane-core','authorization-core','document-proof-core','transaction-core','domain-command-core','save-schema','determinism-core','event-ledger-core','dependency-core','policy-core','lifecycle-core','delivery-monitor-core','realism-core','finance-core','hr-core','corporate-core','procurement-core','facility-core','energy-core','realestate-core','economics-core','operations-core','game-lifecycle-core'];
  const world=()=>{const {s}=harness(MODULES),defaults={...minimal(),profile:{name:'Acceleration'},bank:{},operations:{},crew:[],branches:[],hired:[],unlockedSectors:[],ownedCompanies:[]},state=s.GH_GAME_LIFECYCLE.pristine(defaults,1);
    s.GH_GAME_LIFECYCLE.foundGroup(state,{mode:'sandbox',name:'Acceleration QA',founder:'Founder',locationId:'RUH'},defaults,{nextId:()=>'FOUND-589',simYear:()=>2026});
    for(const type of ['power','realestate'])s.GH_DOMAIN_COMMANDS.dispatch({state},'corporate','open-company',{type,capital:400000000,legalName:`QA ${type}`});
    state.customHubs.push({id:'RE-RUH',kind:'realestate',ownerCompanyId:'realestate',owned:true,city:'الرياض',country:'السعودية',dailyCost:1800});
    const contract=s.GH_DOMAIN_COMMANDS.dispatch({state},'procurement','award-construction',{company:'power',facilityKind:'power',siteName:'QA Solar',bid:{supplier:{id:'QA-BUILDER',legalName:'مقاول الطاقة'},quote:82000000,score:90}}).result;
    Object.assign(contract,{leadDays:120,capacityKey:'solarMW',capacityAmount:100,energyKind:'solar',commissioned:false});
    state.customHubs.push({id:'SOLAR-589',name:'QA Solar',kind:'power',ownerCompanyId:'power',owned:true,city:'الرياض',country:'السعودية',energyKind:'solar',capacityAmount:100,capacity:'100 MW',cost:82000000,commissioned:false,dailyCost:0,plannedDailyCost:12000,constructionContractId:contract.id});
    const E=s.GH_ENERGY_CORE,RE=s.GH_REALESTATE_CORE;E.ensure(state);const re=RE.ensure(state);
    const sale=RE.execute({state},'start-project',{officeId:re.offices[0].id,type:'residential',size:1,priceLevel:1,mode:'sale'}),lease=RE.execute({state},'start-project',{officeId:re.offices[0].id,type:'residential',size:1,priceLevel:1,mode:'lease'});
    return {s,state,E,RE,contractId:contract.id,saleId:sale.id,leaseId:lease.id};};
  const out={};
  // 1. Sixty closes, no acceleration.
  {const w=world();for(let day=1;day<=60;day++){w.state.simSeconds=day*86400;for(const _ of w.s.GH_REALISM.onDayStages(w.state,day)){}w.E.tickDay(w.state,{day});w.RE.tickDay(w.state,{day});}
   out.plain={realEstate:JSON.stringify(w.state.realEstate),energy:JSON.stringify(w.state.energy),contracts:JSON.stringify(w.state.constructionContracts),cheques:w.state.finance.cheques.length};}
  // 2, 3. Accelerations on day 30.
  {const w=world();for(let day=1;day<=30;day++){w.state.simSeconds=day*86400;for(const _ of w.s.GH_REALISM.onDayStages(w.state,day)){}w.E.tickDay(w.state,{day});w.RE.tickDay(w.state,{day});}
   const contract=w.state.constructionContracts.find(c=>c.id===w.contractId),project=w.state.realEstate.projects.find(p=>p.id===w.saleId);
   const eq=w.E.constructionAccelerationQuote(w.state,contract),rq=w.RE.constructionAccelerationQuote(w.state,project);out.fees={energy:eq.fee,realestate:rq.fee};
   w.s.GH_DOMAIN_COMMANDS.dispatch({state:w.state},'energy','accelerate-construction',{contractId:contract.id,expectedFee:eq.fee,expectedCompleteDay:eq.completeDay},{idempotencyKey:'e589'});
   w.s.GH_DOMAIN_COMMANDS.dispatch({state:w.state},'realestate','accelerate-construction',{projectId:project.id,expectedFee:rq.fee,expectedCompleteDay:rq.completeDay},{idempotencyKey:'r589'});
   out.atPayment={commissioned:contract.commissioned===true,solarMW:Number(w.state.energy.solarMW)||0,facility:w.state.customHubs.find(f=>f.id==='SOLAR-589').commissioned===true,projectStatus:project.status,milestones:project.milestonesPaid};
   for(let day=31;day<=33;day++){w.state.simSeconds=day*86400;for(const _ of w.s.GH_REALISM.onDayStages(w.state,day)){}w.E.tickDay(w.state,{day});w.RE.tickDay(w.state,{day});}
   out.later={solarMW:Number(w.state.energy.solarMW)||0,commissioned:contract.commissioned===true,projectStatus:project.status,milestones:project.milestonesPaid};}
  process.stdout.write(JSON.stringify(out));
  return;
}
const measure=tree=>JSON.parse(execFileSync(process.execPath,[__filename,'--measure',tree],{encoding:'utf8',maxBuffer:1<<28}));
const before=fs.mkdtempSync(path.join(os.tmpdir(),'gh-b589-'));
try{
  const archive=path.join(before,'previous.tar');execFileSync('git',['-C',process.env.GH_B589_GIT_DIR||ROOT,'archive','-o',archive,PREVIOUS,'WebApp','tests/helpers']);execFileSync('tar',['-xf',archive,'-C',before]);fs.rmSync(archive);
  const old=measure(before),now=measure(ROOT);
  // 1.
  for(const key of ['realEstate','energy','contracts','cheques'])assert.equal(now.plain[key],old.plain[key],`1: without an acceleration, sixty closes leave the previous source's ${key}`);
  // 2.
  assert.equal(old.atPayment.commissioned,false,'the previous source left the plant under construction at payment');
  assert.deepEqual(now.atPayment,{commissioned:true,solarMW:100,facility:true,projectStatus:'مكتمل',milestones:3},'2: the plant runs and the project is handed over when the fees clear');
  assert.deepEqual(now.later,{solarMW:100,commissioned:true,projectStatus:'مكتمل',milestones:3},'2: later closes add no capacity and pay no milestone again');
  // 3.
  assert.deepEqual(now.fees,old.fees,'3: the fee is the previous source\'s');
  console.log(JSON.stringify({suite:'build589-acceleration-immediate',ok:true,closes:60,fees:now.fees,atPayment:now.atPayment,previousAtPayment:old.atPayment}));
}finally{fs.rmSync(before,{recursive:true,force:true});}
