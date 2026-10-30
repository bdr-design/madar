'use strict';
// Owner (build 98 iPhone diagnostic: «حل باقي المشاكل»; then «صلحها على دفعات دقيقه جدًا»): finance normalized the state's
// seven company metric maps (the day's sector profit, the trip accruals, the pending daily cash) on every finance call by
// building each one again, and copied the list of held companies for each, a tenth of play's allocations (a fleet of
// 60,000, 60 s of play: 3.8 MB of 28). A map that already holds exactly the held companies, in order, each a finite number
// its rule accepts, is now kept as it is; any other map is rebuilt as before. On the real company platform, definitions,
// finance and transaction owners:
//  1. a day's finance work (expenses for every company, the simulation journal of trips and cash, the daily close), inside
//     a simulation transaction and inside an ordinary one, leaves exactly the state the source before (8510d56, from its
//     own tree) leaves;
//  2. inside the transaction, after the first finance call, every later call keeps the same seven maps (no map is built
//     again): through the day's expenses and journals, and after the close (which starts the next day's sector profit) the
//     next calls keep the maps the close left;
//  3. a map that is not already normal is rebuilt exactly as the source before rebuilds it, or refused with the same
//     error: a missing company, a number written as text, keys out of order, a frozen map, an old placeholder of zero for
//     a company the world does not hold (dropped, or kept for the pending cash), a non-zero amount for one (refused), a
//     negative trip revenue (refused), a fractional trip count (refused); and the simulation journal's maps, which are only
//     read (one naming only some companies is read as it is, the others reading 0), are read or refused as before: written
//     as text, missing a company, naming two companies, an old zero placeholder, a company the world does not hold, a
//     negative revenue, a fractional trip count;
//  4. a simulation transaction that fails after the finance work leaves the state exactly as it was.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {harness,minimal}=require('./helpers/core-harness');
const MODULES=['capability-registry-core','company-definitions','company-platform-core','identity-system','control-plane-core','authorization-core','determinism-core','integrity-core','document-proof-core','transaction-core','domain-command-core','finance-core'];
const HELD=['air','sea','road','power','bank','insurance','realestate','telecom','media','healthcare'];
const MAPS=[['finance','pendingDailyCash'],[null,'sectorProfitToday'],[null,'tripProfitAccrued'],[null,'tripRevenueAccrued'],[null,'tripFuelAccrued'],[null,'tripMaintenanceAccrued'],[null,'tripCountAccrued']];
function scenario(){
  const {s}=harness(MODULES),F=s.GH_FINANCE_CORE,T=s.GH_TRANSACTION_CORE,D=s.GH_COMPANY_DEFINITIONS;
  const world=()=>{
    const registry=Object.fromEntries(HELD.map(id=>{const d=D.get(id);return [id,{id,definitionId:d.definitionId,definitionVersion:d.definitionVersion,status:'active'}];}));
    const state={...minimal(),saveVersion:'3.0.0',simSeconds:20*86400,profile:{name:'QA Metric Maps'},openedCompanies:[...HELD],companyRegistry:registry};
    F.ensure(state);for(const id of HELD)F.book(state,id).accounts[0].balance=50e6;F.reconcile(state);return state;
  };
  const maps=state=>MAPS.map(([root,key])=>root?state[root][key]:state[key]);
  const metric=f=>Object.fromEntries(HELD.map((id,i)=>[id,f(i)]));
  const day=(state,mark=()=>{})=>{
    for(const [i,id] of HELD.entries())F.execute({state},'accrue-expense',{company:id,amount:1000+i,note:`QA maps ${id}`,counterparty:'QA Maps Supplier',taxable:false,number:`QA-MAPS-${id}`});
    F.execute({state},'apply-simulation-journal',{journal:{todayProfit:5000,sectorProfit:metric(i=>100+i),tripProfit:metric(i=>50+i),tripRevenue:metric(i=>400+i),tripFuel:metric(i=>30+i),tripMaintenance:metric(i=>10+i),tripCount:metric(i=>i%3),cash:metric(i=>200+i)}});
    F.execute({state},'apply-simulation-journal',{journal:{todayProfit:700,sectorProfit:metric(i=>7+i),tripProfit:metric(i=>3),tripRevenue:metric(i=>9),tripFuel:metric(i=>1),tripMaintenance:metric(i=>1),tripCount:metric(()=>1),cash:metric(i=>i)}});
    mark();F.execute({state},'record-daily-close',{day:20,net:HELD.length*6000,companies:Object.fromEntries(HELD.map((id,i)=>[id,{grossRevenue:10000+i,expenses:4000+i,net:6000}]))});
  };
  const out={};
  // 1-2.
  for(const label of ['simulation:qa-maps-day','qa-maps-command']){
    const state=world();let first=null,kept=null;
    T.execute(state,{label,apply:()=>{F.execute({state},'ensure');first=maps(state);day(state,()=>{kept=maps(state).map((m,i)=>m===first[i]);});const closed=maps(state);F.execute({state},'ensure');F.execute({state},'accrue-expense',{company:'air',amount:5,note:'QA maps after close',counterparty:'QA Maps Supplier',taxable:false,number:'QA-MAPS-AFTER'});kept=kept.concat(maps(state).map((m,i)=>m===closed[i]));}});
    out[label]={state:JSON.stringify(state),kept};
  }
  // 3.
  const cases={
    missing:state=>{delete state.tripProfitAccrued.media;},
    text:state=>{state.tripFuelAccrued.air='12.5';},
    order:state=>{const m=state.sectorProfitToday;state.sectorProfitToday=Object.fromEntries(Object.entries(m).reverse());},
    frozen:state=>{state.tripRevenueAccrued=Object.freeze({...state.tripRevenueAccrued});},
    placeholder:state=>{state.tripProfitAccrued.education=0;state.finance.pendingDailyCash.education=0;},
    orphan:state=>{state.tripProfitAccrued.education=25;},
    negative:state=>{state.tripRevenueAccrued.bank=-1;},
    fraction:state=>{state.tripCountAccrued.sea=1.5;}
  };
  out.cases={};
  for(const [name,edit] of Object.entries(cases)){
    const state=world();edit(state);const before=maps(state);
    try{F.execute({state},'ensure');out.cases[name]={state:JSON.stringify(MAPS.map(([root,key])=>root?state[root][key]:state[key])),frozen:maps(state).some(Object.isFrozen),rebuilt:maps(state).map((m,i)=>m!==before[i])};}catch(error){out.cases[name]={error:String(error.message)};}
  }
  // 3, the simulation journal's maps (read, not kept): one written as text, one missing a company, one naming a company
  // the world does not hold, one with a negative revenue.
  out.journal={};
  for(const [name,edit] of Object.entries({text:j=>{j.tripFuel.air='4';},missing:j=>{delete j.cash.media;},subset:j=>{for(const key of ['sectorProfit','tripProfit','tripRevenue','tripFuel','tripMaintenance','tripCount','cash'])j[key]={air:7,bank:3};},placeholder:j=>{j.tripProfit.education=0;},orphan:j=>{j.sectorProfit.education=9;},negative:j=>{j.tripRevenue.bank=-2;},fraction:j=>{j.tripCount.sea=.5;}})){
    const state=world(),journal={todayProfit:10,sectorProfit:metric(i=>i),tripProfit:metric(i=>i),tripRevenue:metric(i=>i),tripFuel:metric(i=>i),tripMaintenance:metric(i=>i),tripCount:metric(()=>1),cash:metric(i=>i)};edit(journal);
    try{F.execute({state},'apply-simulation-journal',{journal});out.journal[name]={state:JSON.stringify(state)};}catch(error){out.journal[name]={error:String(error.message)};}
  }
  // 4.
  {
    const state=world();F.execute({state},'ensure');const before=JSON.stringify(state);let failed=null;
    try{T.execute(state,{label:'simulation:qa-maps-fail',apply:()=>{F.execute({state},'ensure');day(state);throw new Error('qa-maps-injected');}});}catch(error){failed=String(error.message);}
    out.rollback={failed,same:JSON.stringify(state)===before};
  }
  return out;
}
if(process.env.QA_BUILD597_SCENARIO){process.stdout.write(JSON.stringify(scenario()));return;}
const ROOT=path.resolve(__dirname,'..'),PREVIOUS='8510d56',tree=fs.mkdtempSync(path.join(os.tmpdir(),'b597-'));
try{
  execFileSync('sh',['-c',`git -C "${ROOT}" archive ${PREVIOUS} WebApp | tar -x -C "${tree}"`]);require(path.join(__dirname,'helpers/brand-baseline.cjs')).brandBaseline(tree);
  const before=JSON.parse(execFileSync(process.execPath,[__filename],{env:{...process.env,GH_TEST_SOURCE_DIR:tree,QA_BUILD597_SCENARIO:'1'},maxBuffer:256*1024*1024}).toString());
  const now=scenario();
  // 1.
  for(const label of ['simulation:qa-maps-day','qa-maps-command'])assert.equal(now[label].state,before[label].state,`1: ${label}: the same day leaves the same state as the source before`);
  // 2.
  assert.deepEqual(now['simulation:qa-maps-day'].kept,[...MAPS,...MAPS].map(()=>true),'2: every later finance call keeps the seven maps');
  assert.ok(before['simulation:qa-maps-day'].kept.some(k=>!k),'2: (the source before built them again)');
  // 3.
  for(const name of Object.keys(now.cases)){const a=now.cases[name],b=before.cases[name];assert.equal(a.error??null,b.error??null,`3: ${name}: the same refusal`);if(!a.error){assert.equal(a.state,b.state,`3: ${name}: the same map`);assert.equal(a.frozen,false,`3: ${name}: a map finance can write`);}}
  assert.match(now.cases.orphan.error,/finance-trip-profit-company-unknown:education/,'3: a non-zero amount for a company the world does not hold is refused');
  assert.match(now.cases.negative.error,/finance-trip-revenue-value-negative:bank/,'3: a negative trip revenue is refused');
  assert.match(now.cases.fraction.error,/finance-trip-count-value-not-integer:sea/,'3: a fractional trip count is refused');
  for(const [name,index] of [['missing',2],['text',4],['order',1],['frozen',3],['placeholder',2]])assert.equal(now.cases[name].rebuilt[index],true,`3: ${name}: the map is rebuilt`);
  assert.ok(JSON.parse(now.cases.placeholder.state)[0].education===0&&!('education' in JSON.parse(now.cases.placeholder.state)[2]),'3: a zero placeholder is kept for the pending cash and dropped elsewhere');
  for(const name of Object.keys(now.journal))assert.deepEqual(now.journal[name],before.journal[name],`3: the journal's ${name} map: the same result as the source before`);
  assert.ok(now.journal.text.state&&now.journal.missing.state&&now.journal.subset.state&&/simulation-trip-count-value-not-integer:sea/.test(now.journal.fraction.error)&&/simulation-sector-profit-company-unknown:education/.test(now.journal.orphan.error)&&/simulation-trip-revenue-value-negative:bank/.test(now.journal.negative.error),'3: the journal is read or refused as before');
  // 4.
  assert.equal(now.rollback.failed,'qa-maps-injected','4: the transaction failed');assert.equal(now.rollback.same,true,'4: the state is exactly as it was');
  console.log(JSON.stringify({suite:'build597-finance-metric-maps-in-place',ok:true,kept:now['simulation:qa-maps-day'].kept.length}));
}finally{fs.rmSync(tree,{recursive:true,force:true});}
