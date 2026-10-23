'use strict';
// iPhone diagnostic (build 95): energy.dailyHistory held 759 KB after 59 days (12.9 KB a day, 44 power sites), on its way to
// about 5 MB at its 400-day cap, in a root copied at every day close. Only the newest day keeps its per-site rows now (as
// insurance keeps byLine and telecom byPlan); every total stays in every row. Proven on the real energy, finance,
// economics, facility and domain command owners and the daily close's own posting code (app.js, run as written, through
// the internal supply block), with a running gas plant under project finance, twenty sites under construction and a road
// company that buys the group's power (a monthly internal settlement falls inside the run), against the same source with
// the one compaction call removed (a copy of this tree, so nothing else differs and no git history is needed):
//  1. after 45 closes only the newest row carries sites (one row per site); without the call every row keeps them;
//  2. the history is several times smaller, by exactly the bytes of the older rows' sites;
//  3. nothing else changes: every day's tick result and close (P&L, cash revenue and expense, the energy figures the close
//     reads, the internal supply rows), the whole finance root and every company's book are those of the source without
//     the call, and the energy root equals it with the older rows' sites removed (same keys, same order);
//  4. a save from an earlier build (400 rows with sites), and days an earlier build closed meanwhile, are compacted at the
//     next close, totals unchanged, with no flag in the save; without the call they stay;
//  5. a normal close replaces one row: every older row is the same object as before;
//  6. a second tick for the same day changes nothing;
//  7. a close that fails after the tick rolls the history back: in one transaction, in the day close's staged transaction
//     (stagedFullScope) failing or cancelled after the tick, and after the one-time pass over an earlier build's rows.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm'),{execFileSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'),SOURCE=process.env.GH_TEST_SOURCE_DIR||ROOT;
process.env.GH_TEST_SOURCE_DIR=SOURCE;
const {harness,minimal}=require('./helpers/core-harness');
const BUYER='road',COMPANIES=['power',BUYER];
function closeBlock(s,state,day){
  const app=fs.readFileSync(path.join(SOURCE,'WebApp/app.js'),'utf8'),start=app.indexOf('      const baseByCompany=zeroCompanyMap(state)'),end=app.indexOf('      // رواتب المنشآت',start);assert(start>=0&&end>start,'close block found');
  assert.ok(app.slice(start,end).includes('const internalSupply='),'the block runs the internal supply posting');
  const box={window:s,state,phase:(_name,fn)=>fn(),companyIds:COMPANIES,companyIdSet:new Set(COMPANIES),zeroCompanyMap:()=>Object.fromEntries(COMPANIES.map(id=>[id,0])),getDynamicFacilities:()=>[...state.globalBases,...state.customHubs],facilityOwnerCompanyId:r=>r.ownerCompanyId||r.companyId||r.company||'group',companyContractRevenue:{},companyContractCost:{},leaseByCompany:{},uniqueOperationalCompanyForCapability:(_state,cap)=>({'operations.energy':'power'}[cap])};
  state.lastFinancialDay=day;vm.createContext(box);vm.runInContext(app.slice(start,end)+'\nthis.actual={operatingExpense,cashOperatingRevenue,cashOperatingExpense,ed,internalSupply};',box);return box.actual;
}
function world(){
  const h=harness(['capability-registry-core','company-definitions','company-platform-core','identity-system','control-plane-core','authorization-core','document-proof-core','transaction-core','domain-command-core','save-schema','determinism-core','event-ledger-core','dependency-core','policy-core','lifecycle-core','delivery-monitor-core','realism-core','finance-core','hr-core','corporate-core','facility-core','energy-core','economics-core','game-lifecycle-core']);
  const {s}=h,d={...minimal(),profile:{name:'Energy History'},bank:{},operations:{},crew:[],branches:[],hired:[],unlockedSectors:[],ownedCompanies:[]};
  const state=s.GH_GAME_LIFECYCLE.pristine(d,1);s.GH_GAME_LIFECYCLE.foundGroup(state,{mode:'sandbox',name:'History Group',founder:'Founder',locationId:'RUH'},d,{nextId:()=>'FOUND-EH',simYear:()=>2026});
  const E=s.GH_ENERGY_CORE,run=(name,p)=>s.GH_DOMAIN_COMMANDS.dispatch({state},'energy',name,p).result;
  s.GH_DOMAIN_COMMANDS.dispatch({state},'corporate','open-company',{type:'power',capital:400000000,legalName:'History Power'});
  s.GH_DOMAIN_COMMANDS.dispatch({state},'corporate','open-company',{type:BUYER,capital:200000000,legalName:'History Road'});
  state.customHubs.push({id:'PWR-GAS-EH',name:'Gas EH',city:'الرياض',country:'السعودية',kind:'power',company:'power',ownerCompanyId:'power',owned:true,energyKind:'gas',capacityAmount:100,capacity:'100 MW',commissioned:true,openedAt:0,dailyCost:38000,cost:200000000});
  for(let i=0;i<20;i++)state.customHubs.push({id:`PWR-SOL-EH-${i}`,name:`Solar EH ${i}`,city:'الرياض',country:'السعودية',kind:'power',company:'power',ownerCompanyId:'power',owned:true,energyKind:'solar',capacityAmount:50,capacity:'50 MW',commissioned:false,openedAt:0,dailyCost:9000,cost:60000000});
  state.customHubs.push({id:'ROAD-HUB-EH',name:'Road Depot EH',city:'الرياض',country:'السعودية',kind:'road',company:BUYER,ownerCompanyId:BUYER,owned:true,commissioned:true,openedAt:0,dailyCost:120000,cost:50000000});
  state.simSeconds=100*86400;s.GH_REALISM.migrate(state).economy.gas=50;s.GH_REALISM.migrate(state).economy.baseRate=.05;state.profile.creditRating='BBB';
  const energy=E.ensure(state),site=energy.sites.find(row=>row.facilityId==='PWR-GAS-EH');site.commissionedDay=0;run('finance-project',{siteId:site.id,amount:100000000});
  const TX=s.GH_TRANSACTION_CORE,tick=day=>{state.simSeconds=day*86400;return s.GH_DOMAIN_COMMANDS.dispatchSystem({state},'energy','tick-day',{day,ownerCompanyId:'power'},{actor:'simulation-scheduler'}).result;};
  // The day close's staged transaction (app.js transactionOptions at a day boundary: stagedFullScope), stepped to its end.
  const staged=(day,{fail=false,cancel=false}={})=>{
    const handle=TX.beginStaged(state,{label:'b578-staged-day',scope:['simSeconds','energy'],writeRoots:['simSeconds','energy'],stagedFullScope:true,apply:function*(){tick(day);yield 'energy';if(fail)throw new Error('b578-staged-after-energy');return 'closed';}});
    let guard=0;while(!handle.done&&guard++<1000){if(cancel&&handle.stage==='energy'){handle.abort('b578-cancel');break;}handle.step(-Infinity);}
    return {done:handle.done,error:String(handle.error?.message||'')};
  };
  return {s,state,tick,staged,TX};
}
const bytes=value=>Buffer.byteLength(JSON.stringify(value));
function scenario(){
  const {s,state,tick,staged,TX}=world(),days=[];let identity=true,supplyDays=0,settled=0;
  for(let day=101;day<=145;day++){
    const before=state.energy.dailyHistory.slice(),result=tick(day),after=state.energy.dailyHistory,close=closeBlock(s,state,day);
    if(before.length>=2)for(let i=2;i<after.length;i++)if(after[i]!==before[i-1])identity=false;
    if(close.internalSupply?.rows?.length)supplyDays++;if(close.internalSupply?.settlements?.length)settled++;
    days.push(JSON.stringify({result,close}));
  }
  const money=JSON.stringify({finance:state.finance,companyFinance:state.companyFinance??null,cash:state.cash});
  const history=JSON.parse(JSON.stringify(state.energy.dailyHistory)),energyRoot=JSON.parse(JSON.stringify(state.energy)),sites=state.energy.sites.length;
  // 6. A second tick for the same day changes nothing.
  const kept=()=>JSON.stringify({energy:state.energy,finance:state.finance}),last=()=>state.energy.lastProcessedDay;
  const repeatBefore=kept(),again=tick(145);const repeat={same:kept()===repeatBefore,row:JSON.stringify(again)===JSON.stringify(history.find(row=>row.day===145))};
  // 7. A close that fails after the tick rolls everything back: one transaction, the staged day close failing, cancelled.
  const rollback={};
  {const was=kept(),day=last();let threw=false;try{TX.execute(state,{label:'b578-rollback',apply(){tick(146);throw new Error('b578-after-energy');}});}catch(error){threw=String(error?.message||error).includes('b578-after-energy');}rollback.execute={threw,restored:kept()===was&&last()===day};}
  {const was=kept(),day=last(),out=staged(146,{fail:true});rollback.stagedFail={failed:out.done&&out.error.includes('b578-staged-after-energy'),restored:kept()===was&&last()===day};}
  {const was=kept(),day=last(),out=staged(146,{cancel:true});rollback.stagedCancel={cancelled:out.done&&out.error.includes('b578-cancel'),restored:kept()===was&&last()===day};}
  {const out=staged(146);rollback.stagedCommit={committed:out.done&&!out.error,day:last()===146,newestOnly:Array.isArray(state.energy.dailyHistory[0].sites)&&state.energy.dailyHistory.slice(1).every(row=>row.sites===undefined)};}
  // 4. An earlier build's save: 400 rows that all carry sites; its next close compacts them, totals unchanged.
  const legacy=world();for(let day=101;day<=102;day++)legacy.tick(day);
  const seed=legacy.state.energy.dailyHistory.find(row=>Array.isArray(row.sites));
  const seedLegacy=()=>{legacy.state.energy.dailyHistory=Array.from({length:400},(_,i)=>JSON.parse(JSON.stringify({...seed,day:102-i})));legacy.state.energy.lastProcessedDay=102;};
  seedLegacy();const seeded=legacy.state.energy.dailyHistory.map(({sites:_detail,...totals})=>JSON.stringify(totals));
  // 7. A failure after the one-time pass over those rows restores them, sites included.
  const legacyKept=JSON.stringify(legacy.state.energy);let legacyThrew=false;
  try{legacy.TX.execute(legacy.state,{label:'b578-legacy-rollback',apply(){legacy.tick(103);throw new Error('b578-after-legacy');}});}catch(error){legacyThrew=String(error?.message||error).includes('b578-after-legacy');}
  rollback.legacy={threw:legacyThrew,restored:JSON.stringify(legacy.state.energy)===legacyKept};
  legacy.tick(103);const compacted=legacy.state.energy.dailyHistory;
  const migration={length:compacted.length,newest:Array.isArray(compacted[0].sites),older:compacted.slice(1).every(row=>row.sites===undefined),totals:compacted.slice(1).every((row,i)=>JSON.stringify(row)===seeded[i])};
  // An earlier build that closed three days meanwhile (rows with sites on top of compacted ones): the next close strips them.
  const earlier=Array.from({length:3},(_,i)=>JSON.parse(JSON.stringify({...seed,day:106-i})));legacy.state.energy.dailyHistory.unshift(...earlier);legacy.state.energy.lastProcessedDay=106;legacy.tick(107);
  const after=legacy.state.energy.dailyHistory;migration.downgrade=Array.isArray(after[0].sites)&&after.slice(1).every(row=>row.sites===undefined);const legacyKeys=Object.keys(legacy.state.energy);
  return {days,money,history,energyRoot,sites,historyBytes:bytes(history),rowBytes:history.map(bytes),identity,supplyDays,settled,repeat,rollback,migration,legacyKeys};
}
if(process.env.GH_B578_CHILD){console.log(JSON.stringify(scenario()));return;}
// One realm for both sides: the owners run in a vm sandbox, the other side's result arrives as JSON.
const now=JSON.parse(JSON.stringify(scenario()));
assert.ok(now.supplyDays>=40&&now.settled>=1,`the road company buys the group's power every day and settles monthly (${now.supplyDays} days, ${now.settled} settlements)`);
assert.ok(now.history.length>=45&&Array.isArray(now.history[0].sites),'the newest day keeps its site rows');
assert.equal(now.history[0].sites.length,now.sites,'one row per site');
assert.ok(now.history.slice(1).every(row=>row.sites===undefined),'1: only the newest day carries site rows');
assert.equal(now.identity,true,'5: a normal close replaces one row; every older row is the same object as before');
assert.deepEqual(now.repeat,{same:true,row:true},'6: a second tick for the same day changes nothing');
assert.deepEqual(now.rollback,{execute:{threw:true,restored:true},stagedFail:{failed:true,restored:true},stagedCancel:{cancelled:true,restored:true},stagedCommit:{committed:true,day:true,newestOnly:true},legacy:{threw:true,restored:true}},'7: a failed or cancelled close rolls the history back');
assert.deepEqual(now.migration,{length:400,newest:true,older:true,totals:true,downgrade:true},'4: an earlier build\'s 400 rows, and days an earlier build closed meanwhile, are compacted at the next close');
const tree=fs.mkdtempSync(path.join(os.tmpdir(),'b578-'));
try{
  fs.cpSync(path.join(SOURCE,'WebApp'),path.join(tree,'WebApp'),{recursive:true});
  const file=path.join(tree,'WebApp','energy-core.js'),source=fs.readFileSync(file,'utf8'),call='compactDailyHistory(energy);';
  assert.equal(source.split(call).length-1,1,'the compaction is one call');fs.writeFileSync(file,source.replace(call,''));
  const before=JSON.parse(execFileSync(process.execPath,[__filename],{env:{...process.env,GH_B578_CHILD:'1',GH_TEST_SOURCE_DIR:tree},encoding:'utf8',maxBuffer:256*1024*1024}).trim().split('\n').at(-1));
  assert.ok(before.history.slice(1).every(row=>Array.isArray(row.sites)),'1: without the call every row keeps its site rows');
  assert.equal(before.migration.older,false,'4: without the call an earlier build\'s rows keep their site rows');
  assert.deepEqual(now.legacyKeys,before.legacyKeys,'4: no flag in the save: the energy root has the keys it has without the call');
  const stripped=rows=>rows.map((row,i)=>{if(i===0)return row;const {sites:_detail,...totals}=row;return totals;});
  const removed=before.history.slice(1).reduce((sum,row)=>sum+bytes(row)-bytes(stripped([null,row])[1]),0);
  assert.equal(now.historyBytes,before.historyBytes-removed,'2: the history is smaller by exactly the older rows\' site rows');
  assert.ok(now.historyBytes*3<before.historyBytes,`2: the history is several times smaller (${now.historyBytes} B, without the call ${before.historyBytes} B)`);
  assert.equal(now.days.length,before.days.length);now.days.forEach((day,i)=>assert.equal(day,before.days[i],`3: day ${101+i}: tick result and close unchanged`));
  assert.equal(now.money,before.money,'3: the finance root, every company book and the cash are unchanged');
  assert.equal(JSON.stringify(now.history),JSON.stringify(stripped(before.history)),'3: the history is the other one with the older rows\' sites removed, in the same key order');
  assert.equal(JSON.stringify(now.energyRoot),JSON.stringify({...before.energyRoot,dailyHistory:stripped(before.energyRoot.dailyHistory)}),'3: the rest of the energy root is unchanged');
  console.log(JSON.stringify({suite:'build578-energy-history-compaction',ok:true,days:now.history.length,sites:now.sites,supplyDays:now.supplyDays,settlements:now.settled,historyBytes:{now:now.historyBytes,withoutCall:before.historyBytes},olderRowMaxBytes:Math.max(...now.rowBytes.slice(1)),newestRowBytes:now.rowBytes[0]}));
}finally{fs.rmSync(tree,{recursive:true,force:true});}
