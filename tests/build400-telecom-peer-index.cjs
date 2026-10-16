'use strict';
// Build 400: the telecom day used to recount same-country peers by filtering every market branch for every plan on
// every branch. Keep per-branch scheduler yields unchanged while proving linear peer indexing and exact save parity.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {harness}=require('./helpers/core-harness');
const DAY=86400,BRANCHES=4930,COUNTRIES=['السعودية','الإمارات','مصر','ألمانيا','الهند','اليابان','المغرب','كندا','البرازيل','أستراليا','فرنسا','تركيا','باكستان','نيجيريا','إندونيسيا','المكسيك','إيطاليا','إسبانيا','السويد','النرويج','قطر','الكويت','الأردن','العراق','لبنان','تونس','الجزائر','كوريا الجنوبية','الصين','المملكة المتحدة','الولايات المتحدة'];
const sourcePath=path.resolve(__dirname,'../WebApp/telecom-market-core.js'),source=fs.readFileSync(sourcePath,'utf8');
const peerCountFragment='if(peerCounts&&row.active)peerCounts.set(row.country,(peerCounts.get(row.country)||0)+1);';
const indexedCall='capacity(m,branch,id,Math.max(1,peersByCountry.get(branch.country)||0))';
assert(source.includes('function ensure(state,options={})'),'peer counts must be collected only for the daily simulation path');
assert(source.includes(peerCountFragment),'peer counts must be piggybacked on the existing branch reconciliation loop');
assert(source.includes(indexedCall),'every daily capacity lookup must use the precomputed country count');
assert(source.includes('m=ensure(state,{collectPeerCounts})'),'the day generator must reuse counts prepared during reconciliation');

function environment({legacy=false,count=BRANCHES,closedEvery=10,loadTransaction=false}={}){
 const h=harness([]),g=h.s,parties=new Map();
 g.GH_AUTHORIZATION={registerCommandTargetResolver(){}};
 g.GH_COMPANY_PLATFORM={requireCompany(_state,id){return {id,operational:true,registered:true};},resolveCompany(_state,id){return {id,operational:true};}};
 g.GH_BUSINESS_WORLD={recordEvent(){},upsertParty(_state,p){const id=String(p.id||`CUST-${parties.size+1}`),old=parties.get(id)||{id,roles:[]};Object.assign(old,p,{id,roles:[...new Set([...(old.roles||[]),...(p.role?[p.role]:[])])]});parties.set(id,old);return old;},resolveParty(_state,id){return parties.get(String(id))||null;},touchRelationship(){return {};},touchCustomerLifecycle(){return {};},customerPortfolio(){return {companies:{}};}};
 g.GH_FINANCE_CORE={calendarMonthForDay(value){const date=new Date(Date.UTC(2026,0,1)+Math.max(0,Number(value)||0)*DAY*1000);return `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,'0')}`;},operating(){return 1e12;},execute(){throw new Error('unexpected-finance-write');}};
 g.GH_DOMAIN_COMMANDS={dispatchSystem(){throw new Error('unexpected-domain-command');}};
 g.GH_BANKING_CORE={countryPopulation(){return 10000000;}};g.GH_MAP_LABELS=[];
 h.load('customer-companies-core');h.load('customer-base-core');if(loadTransaction)h.load('transaction-core');
 const state={simSeconds:40*DAY,openedCompanies:['telecom'],customHubs:[],finance:{invoices:[],commercialContracts:[],periods:[]}};
 state.customHubs=Array.from({length:count},(_,i)=>({id:`TEL-FAC-${String(i).padStart(5,'0')}`,kind:'telecom-branch',ownerCompanyId:'telecom',owned:true,city:`مدينة ${i%97}`,country:COUNTRIES[i%COUNTRIES.length],name:`فرع ${i}`}));
 const gameSource=legacy?source.replace(peerCountFragment,'').replace(indexedCall,'capacity(m,branch,id)'):source;
 if(legacy)assert.notEqual(gameSource,source,'legacy reference must actually restore the old per-plan full scan');
 vm.runInContext(gameSource,g,{filename:legacy?'telecom-market-core-reference.js':'telecom-market-core.js'});
 const market=g.GH_TELECOM_MARKET,m=market.ensure(state);
 for(let i=0;i<m.branches.length;i++){
  const row=m.branches[i];row.partyId='TEL-MARKET-GROUP';row.nextBillingMonth='2026-03';
  row.plans.mobile.subscribers=70+(i%17);row.plans.home.subscribers=15+(i%7);row.plans.family.subscribers=8+(i%5);row.plans.business.subscribers=2+(i%3);
 }
 if(closedEvery>0)state.customHubs=state.customHubs.filter((_row,i)=>i%closedEvery!==0);
 return {h,g,state,market,branches:m.branches};
}
function countFilters(env){
 let calls=0;const arrayPrototype=vm.runInContext('Array.prototype',env.g),nativeFilter=arrayPrototype.filter,tracked=new WeakSet([env.branches]);
 arrayPrototype.filter=function(...args){const watch=tracked.has(this),result=nativeFilter.apply(this,args);if(watch){calls++;tracked.add(result);}return result;};
 return {calls:()=>calls,restore(){arrayPrototype.filter=nativeFilter;}};
}
function simulate(env){
 const filters=countFilters(env),started=performance.now();let result,count=0,step;
 try{const gen=env.market.dayStages(env.state,{day:40});for(;;){step=gen.next();if(step.done){result=step.value;break;}count++;}}
 finally{filters.restore();}
 return {result,steps:count,filterCalls:filters.calls(),elapsedMs:Number((performance.now()-started).toFixed(3)),snapshot:JSON.stringify(env.state)};
}
function firstDifference(a,b,path='$'){
 if(Object.is(a,b))return null;if(!a||!b||typeof a!=='object'||typeof b!=='object')return {path,a,b};
 const keys=new Set([...Object.keys(a),...Object.keys(b)]);for(const key of keys){const found=firstDifference(a[key],b[key],`${path}.${key}`);if(found)return found;}return null;
}

const before=environment({legacy:true}),after=environment();
const old=simulate(before),fresh=simulate(after);
assert.deepEqual(firstDifference(after.state.customerCompanies,before.state.customerCompanies),null,'indexed peer counts must preserve every daily company row and accumulator');
assert.equal(fresh.snapshot,old.snapshot,'the full state must be byte-equivalent to the old path');
assert.equal(old.steps,BRANCHES+1,'preserve exactly one scheduler yield per branch plus the close yield');
assert.equal(fresh.steps,old.steps,'the optimization must not enlarge any per-frame branch batch');
assert.equal(fresh.filterCalls,2,'the indexed path may filter the branch list only for ensure and request generation');
assert.equal(old.filterCalls,2+BRANCHES*4,'the reference path reproduces four full peer scans per branch');
const activeCount=after.state.customHubs.length;
assert.ok(after.branches.some(row=>!row.active)&&after.branches.some(row=>row.active),'the scenario includes closed and active rows');
assert.equal(after.market.dailyResult(after.state,40).revenue,after.state.customerCompanies.companies.telecom.market.dailyHistory[0].accrued);
const committedSnapshot=JSON.stringify(after.state),replay=after.market.dayStages(after.state,{day:40}).next();
assert.equal(replay.done,true,'the same financial day must be idempotent');assert.equal(JSON.stringify(after.state),committedSnapshot,'replay cannot post or accrue the day twice');

// Inject a late calculation fault after earlier branches have already mutated the staged draft. Transaction rollback
// must restore the whole state; removing the peer scans does not change the existing failure boundary.
{
 const env=environment({count:24,closedEvery:0,loadTransaction:true}),state=env.state,TX=env.g.GH_TRANSACTION_CORE,BASE=env.g.GH_CUSTOMER_BASE;
 const original=JSON.stringify(state);let affinityCalls=0;
 env.g.GH_CUSTOMER_BASE={...BASE,affinity(...args){if(++affinityCalls===19)throw new Error('qa-telecom-peer-index-failure');return BASE.affinity(...args);}};
 const staged=TX.beginStaged(state,{label:'qa-telecom-peer-index-rollback',apply:function*(){return yield* env.market.dayStages(state,{day:40});}});
 staged.step(Infinity);
 assert.match(String(staged.error?.message||''),/qa-telecom-peer-index-failure/,'an injected late branch fault must reach the transaction owner');
 assert.equal(JSON.stringify(state),original,'failure after prior branch writes must roll back the exact state');
 env.g.GH_CUSTOMER_BASE=BASE;
 const retry=TX.beginStaged(state,{label:'qa-telecom-peer-index-retry',apply:function*(){return yield* env.market.dayStages(state,{day:40});}});
 retry.step(Infinity);assert.equal(retry.error,null);assert.equal(retry.result?.committed,true);assert.equal(state.customerCompanies.companies.telecom.market.lastProcessedDay,40,'retry commits the day once');
 assert.equal(TX.telemetry().last?.committed,true);
}

console.log(JSON.stringify({suite:'build400-telecom-peer-index',branches:BRANCHES,activeBranches:activeCount,stagedYields:fresh.steps,legacyFullBranchFilters:old.filterCalls,indexedFullBranchFilters:fresh.filterCalls,legacyReferenceMs:old.elapsedMs,indexedMs:fresh.elapsedMs,rollbackAndRetry:true}));
