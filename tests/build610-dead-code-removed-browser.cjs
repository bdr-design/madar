'use strict';
// Owner («احذف اي انظمة سابقه بلا داعي بحذر مع تتبع المصدر والارتباطات», then «نفذ الحذف بشكل كامل وامن مع اختبارات
// صارمة جدًا جدًا»): code nothing called left the app. app.js's per-asset processor that the Fleet Event engine replaced
// (processAssetDraft and its guards; the build 340 gate keeps its text as a fixture), and functions no caller reached
// (app.js recordPaidCheque, creditCompany, payNamedSupplier, awardConstruction; one helper or export in each other owner
// below; the transaction owner's mobility-free label of the removed paid-cheque command). Against
// the source before (1d7dce1, from its own tree, with a call counter planted in every removed function):
//  1. no removed name is left in the app (each was there before), and every script still compiles;
//  2. in the real app (local DOM, fleet worker), one saved world (an airline on routes) advanced 26 hours, through a
//     daily close, never calls a removed function in the source before (the counter itself counts: a direct call is
//     seen), and leaves exactly the source before's state;
//  3. the world the source before saved (after those 26 hours) loads in this source to exactly the state it loads to in
//     the source before;
//  4. no error is logged.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm'),{execFileSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'),SOURCE=process.env.GH_TEST_SOURCE_DIR||ROOT,PREVIOUS='1d7dce1',HOURS=26;
const REMOVED=Object.freeze({
  'app.js':['processAssetDraft','simulationAssetGuard','simulationAssetSnapshot','simulationContextGuard','SIMULATION_ASSET_GUARD_FIELDS','recordPaidCheque','creditCompany','payNamedSupplier','awardConstruction'],
  'authorization-core.js':['areTargetResolversSealed'],'capability-registry-core.js':['listAdapters'],'company-platform-core.js':['getAssetClasses'],
  'conference-core.js':['listContributors'],'control-plane-core.js':['executeAsync','ingestDomainEvent','markOutboxDelivered'],'dependency-core.js':['setStatus'],
  'document-proof-core.js':['markLegacy'],'event-ledger-core.js':['forCorrelation','forEntity'],'facility-core.js':['availableAssetCapacity'],
  'fleet-core.js':['reconcileStaffingPlan'],'fleet-event-core.js':['checkpointTime','peekNext','validTop'],'fleet-store-core.js':['forEachProfile'],'governance-core.js':['companyFor'],
  'map-feature-core.js':['featureKey'],'mobility-core.js':['urbanPath','vehiclePosition'],'persistence-core.js':['clearSlot'],'procurement-core.js':['withPurchaseBatchAsync'],
  'qr-core.js':['zatcaPayload'],'simulation-time-core.js':['planSlice']
});
const word=name=>new RegExp(`(?<![\\w$])${name.replace(/\$/g,'\\$')}(?![\\w$])`);
// The body's opening brace of `function name(...)`: past the parameter list (defaults hold braces and parentheses).
function bodyStart(text,name){
  const at=[...text.matchAll(new RegExp(`function\\s*\\*?\\s*${name}\\s*\\(`,'g'))];assert.equal(at.length,1,`one declaration of ${name}`);
  let i=at[0].index+at[0][0].length,depth=1,quote=null;
  for(;i<text.length&&depth>0;i++){const c=text[i];if(quote){if(c==='\\')i++;else if(c===quote)quote=null;continue;}if(c==='\''||c==='"'||c==='`')quote=c;else if(c==='(')depth++;else if(c===')')depth--;}
  while(text[i]!=='{')i++;return i+1;
}
const canonical=page=>page.evaluate(()=>{
  const s=__GH_STATE__,state=JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(s).filter(([key])=>key!=='fleet'))));
  // Diagnostics hold wall-clock samples; the kernel's last commit names its run (build362 and build607 compare the same).
  delete state.diagnostics;delete state.simulationKernel;
  const replica=GH_FLEET_STORE.exportReplica(s.fleet);
  return JSON.stringify({state,fleet:{length:replica.length,live:replica.live,values:replica.values,extras:replica.extras,words:Array.from(new Uint32Array(replica.rows))}});
});
const settle=page=>page.waitForFunction(()=>!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked()&&!__AUDIT__.simulationEngine.snapshot().manualAdvance&&!GH_TRANSACTION_CORE.isStaged(__GH_STATE__),null,{timeout:300000});
const storageOf=page=>page.evaluate(()=>Array.from({length:localStorage.length},(_,i)=>{const key=localStorage.key(i);return [key,localStorage.getItem(key)];}));
const advance=page=>page.evaluate(async hours=>{
  const a=__AUDIT__,s=__GH_STATE__;window.__GH_MANUAL_CALENDAR_WINDOWS__=false;const start=s.simSeconds,day=s.lastFinancialDay;
  const accepted=a.simulationEngine.advanceTo(start+hours*3600,{speed:600,batchSeconds:3600,reason:'qa-610',maxSeconds:366*86400});
  for(let i=0;i<120000&&(a.simulationEngine.snapshot().manualAdvance||GH_TRANSACTION_CORE.isStaged(s));i++)await new Promise(r=>setTimeout(r,2));
  return {accepted:accepted?.accepted===true,hours:(s.simSeconds-start)/3600,closedDays:s.lastFinancialDay-day,failure:a.simulationEngine.snapshot().lastAdvanceFailure||null};
},HOURS);
(async()=>{
  // 1.
  const now=path.join(SOURCE,'WebApp'),tree=fs.mkdtempSync(path.join(os.tmpdir(),'b610-'));
  try{
    execFileSync('sh',['-c',`git -C "${ROOT}" archive ${PREVIOUS} WebApp | tar -x -C "${tree}"`]);
    const sources=fs.readdirSync(now).filter(file=>/\.(js|html)$/.test(file));
    for(const [file,names] of Object.entries(REMOVED)){
      const before=fs.readFileSync(path.join(tree,'WebApp',file),'utf8');
      for(const name of names){assert.match(before,word(name),`1: ${file} ${name} was in the source before`);for(const other of sources)assert.doesNotMatch(fs.readFileSync(path.join(now,other),'utf8'),word(name),`1: ${name} is left in ${other}`);}
    }
    assert.match(fs.readFileSync(path.join(tree,'WebApp/transaction-core.js'),'utf8'),/record-paid-cheque/,'1: the label was in the source before');assert.doesNotMatch(fs.readFileSync(path.join(now,'transaction-core.js'),'utf8'),/record-paid-cheque/,'1: the removed command\'s label is gone');
    for(const file of sources.filter(file=>file.endsWith('.js')))assert.doesNotThrow(()=>new vm.Script(fs.readFileSync(path.join(now,file),'utf8'),{filename:file}),`1: ${file} compiles`);
    // The source before, a counter planted at the start of every removed function.
    let planted=0;
    for(const [file,names] of Object.entries(REMOVED)){
      const target=path.join(tree,'WebApp',file);let text=fs.readFileSync(target,'utf8');
      for(const name of names){if(name==='SIMULATION_ASSET_GUARD_FIELDS')continue;const at=bodyStart(text,name),key=`${file}:${name}`;text=text.slice(0,at)+`(globalThis.__B610__??=Object.create(null))[${JSON.stringify(key)}]=(globalThis.__B610__[${JSON.stringify(key)}]|0)+1;`+text.slice(at);planted++;}
      fs.writeFileSync(target,text);assert.doesNotThrow(()=>new vm.Script(text,{filename:file}),`1: ${file} with its counters compiles`);
    }
    assert.equal(planted,Object.values(REMOVED).flat().length-1);
    // 2.
    const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app'),browser=await chromium.launch({headless:true}),errors=[];
    try{
      const setup=await boot({browser,errors,root:SOURCE,fleetWorker:true});setup.page.setDefaultTimeout(600000);
      const world=await setup.page.evaluate(async()=>{
        const a=__AUDIT__,s=__GH_STATE__,W=GH_WORLD_DATA;s.godMoney=true;s.infiniteMoney=true;
        await a.runAuthorizedDomainCommand('corporate','open-company',{type:'air',companyId:'air',capital:900000000,legalName:'QA Removal Air',formationContract:'QA-610'},{silent:true});
        for(const icao of ['OMDB','EGLL']){const row=W.airports.find(i=>i[0]===icao);await a.runAuthorizedDomainCommand('facilities','create',{facility:{id:`QA-${icao}`,name:`QA ${icao}`,kind:'airport-base',company:'air',ownerCompanyId:'air',owned:true,sourceKey:`air:${icao}`,code:row[1]||icao,icao,iata:row[1],city:row[3]||'—',country:String(row[5]||'—'),coords:[row[6],row[7]]},bucket:'globalBases'},{silent:true});}
        const model=[...GH_ASSET_CATALOG.air.used].sort((x,y)=>(x.leaseMonthly||0)-(y.leaseMonthly||0)||x.price-y.price)[0];
        for(const icao of ['OMDB','EGLL'])await a.buyAsset('air','used',model.id,'lease',12,`QA-${icao}`,true,`QA-610-${icao}`,'air',{});
        let dispatched=null;try{dispatched=await a.dispatchSharedInternationalNetwork('air');}catch(error){dispatched=String(error?.message||error);}
        return {dispatched:JSON.stringify(dispatched)?.slice(0,300),fleet:GH_FLEET_DATA.size(s),routed:GH_FLEET_DATA.count(s,row=>Boolean(row.routeId))};
      });
      await settle(setup.page);await setup.page.evaluate(()=>GH_PERSISTENCE.drain());const storage=await storageOf(setup.page);await setup.page.close();
      assert.equal(world.fleet,24);assert.equal(world.routed,24,`every aircraft on a route (${world.dispatched})`);
      const run=async root=>{
        const env=await boot({browser,errors,root,storage,fleetWorker:true});env.page.setDefaultTimeout(600000);await settle(env.page);
        const loaded=await canonical(env.page),result=await advance(env.page);await settle(env.page);const state=await canonical(env.page);
        await env.page.evaluate(()=>GH_PERSISTENCE.drain());const saved=await storageOf(env.page);
        const calls=await env.page.evaluate(()=>({...(globalThis.__B610__||{})}));
        const control=root===tree?await env.page.evaluate(()=>{GH_EVENT_LEDGER.forEntity(__GH_STATE__,'asset','QA');return globalThis.__B610__?.['event-ledger-core.js:forEntity']|0;}):null;
        await env.page.close();return {loaded,result,state,saved,calls,control};
      };
      const old=await run(tree),current=await run(SOURCE);
      for(const [label,r] of [['before',old],['now',current]]){assert.equal(r.result.accepted,true,label);assert.equal(r.result.failure,null,`${label}: ${JSON.stringify(r.result.failure)}`);assert.equal(r.result.hours,HOURS,`${label}: the advance reaches its target`);assert.ok(r.result.closedDays>=1,`${label}: a daily close ran`);}
      assert.deepEqual(old.calls,{},`2: no removed function ran in the source before (${JSON.stringify(old.calls)})`);
      assert.equal(old.control,1,'2: (a direct call is counted)');
      assert.equal(current.loaded,old.loaded,'2: the same saved world loads to the same state');
      assert.equal(current.state,old.state,'2: exactly the source before\'s state after 26 hours and a daily close');
      // 3.
      const reload=async(root,storage)=>{const env=await boot({browser,errors,root,storage,fleetWorker:true});env.page.setDefaultTimeout(600000);await settle(env.page);const state=await canonical(env.page);await env.page.close();return state;};
      const beforeLoads=await reload(tree,old.saved),nowLoads=await reload(SOURCE,old.saved);
      assert.equal(nowLoads,beforeLoads,'3: the source before\'s save loads to exactly the same state');
      // 4.
      assert.deepEqual(errors,[],'4: no error');
      console.log(JSON.stringify({suite:'build610-dead-code-removed-browser',ok:true,removed:Object.values(REMOVED).flat().length,counted:planted,world:{...world,dispatched:undefined},closedDays:current.result.closedDays}));
    }finally{await browser.close();}
  }finally{fs.rmSync(tree,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
