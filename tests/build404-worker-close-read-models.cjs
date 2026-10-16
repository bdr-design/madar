'use strict';
// Exact, bounded worker read models. Old sources fail the new API assertions. No timing thresholds or relaxed financial
// assertions: compare with the former readers and prove that stale/malformed evidence cannot invoke a main-thread scan.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {scenario}=require('./helpers/business-scenario');
const e=scenario(),{s,state}=e;
for(const name of ['fleet-day-core','fleet-save-validation-core','fleet-query-core','governance-core'])e.load(name);
const S=s.GH_FLEET_STORE,F=s.GH_FLEET_DATA,D=s.GH_FLEET_DAY_CORE,Q=s.GH_FLEET_QUERY,V=s.GH_FLEET_SAVE_VALIDATION;
assert.equal(typeof S.identitySnapshot,'function');assert.equal(typeof V.summarizeCompany,'function');
const rows=Array.from({length:4103},(_,i)=>({id:`WORKER-${String(i).padStart(6,'0')}`,ownerCompanyId:'air',assetMode:i%3?'air':'road',type:i%3?'air':'road',assetClass:i%3?'aircraft':'truck',baseFacility:'B1',phase:i%7?'moving':'idle',routeId:i%7?'R':null,condition:i%11?90:0,ownership:'owned',purchasePrice:1000,specs:{co2Band:i%4?'A':'C',electric:i%5===0},staffing:{mode:'automatic-fixed',ready:true,roles:[],total:0,monthlyPayroll:0},...i%17===0?{phase:null,simulationFault:{code:'fixture'}}:{}}));
state.fleet=S.fromAssets(rows,{at:0});delete state.assets;
const originalMix=()=>{const mix={total:0,lowEmission:0,road:0,electricRoad:0};for(const [key,count] of F.countByFields(state,['type','specs'],a=>`${a.specs?.co2Band||'C'}|${a.type}|${a.specs?.electric||a.specs?.hydrogen?1:0}`)){const [band,type,electric]=key.split('|');mix.total+=count;if(band==='A'||band==='B')mix.lowEmission+=count;if(type==='road'){mix.road+=count;if(electric==='1')mix.electricRoad+=count;}}return mix;};
const plain=value=>structuredClone(value),expected={rows:rows.length,moving:F.countByPhase(state).get('moving')||0,mix:originalMix()};
let walks=0;const access={...F,scan(...args){walks++;return F.scan(...args);}};
const day=D.compute(state,access,{ownerResolution:{platform:true,knownCompanies:['air'],legacyOwners:[['air','air'],['road','road']]},airDemand:100,bunker:100});
assert.equal(walks,1,'daily metrics are fused into the existing fleet pass');assert.deepEqual(plain(day.dailyMetrics),expected);
walks=0;const combined=Q.run('conditionSum',state,access,{dailyMetrics:true});assert.equal(walks,1,'a necessary condition refresh supplies the same metrics without another pass');assert.deepEqual(plain(combined.dailyMetrics),expected);
const condition=Q.run('conditionSum',state,F,{});assert.equal(combined.sum,condition.sum);assert.equal(combined.readiness,condition.readiness);
for(const [type,specs] of [['road|other',{co2Band:'A'}],['air',{co2Band:'A|road|1'}],[null,{co2Band:1,hydrogen:true}]]){
 S.set(state.fleet,0,'type',type);S.set(state.fleet,0,'specs',specs);
 const current=Q.run('conditionSum',state,F,{dailyMetrics:true}).dailyMetrics;
 assert.deepEqual(plain(current.mix),originalMix(),'legacy separator and coercion behavior is exact');assert.equal(current.moving,F.countByPhase(state).get('moving')||0);
}
state.fleet=S.fromAssets(rows,{at:0});

const params=()=>s.GH_SAVE_SCHEMA.fleetValidationParams(state);
for(const mutate of [()=>{},()=>S.set(state.fleet,2,'ownerCompanyId','missing-company'),()=>S.set(state.fleet,3,'assetClass','BAD_CLASS'),()=>S.set(state.fleet,7,'ownerCompanyId',''),()=>S.set(state.fleet,9,'assetClass',null)]){
 mutate();const summary=V.summarizeCompany(state,F,params()),reference=s.GH_COMPANY_PLATFORM.validateState(state).errors.filter(x=>x.startsWith('asset-'));
 assert.deepEqual(plain(summary.errors).sort(),[...reference].sort());assert.equal(summary.logicalRows,rows.length);assert.equal(summary.overflow,false);
}
// Identity evidence survives exactly the movement tier; every conservative invalidation expires it.
const snapshot=S.identitySnapshot(state.fleet);assert.equal(S.identityCurrent(state.fleet,snapshot),true);
S.toucher(state.fleet)(0);S.setSlot(state.fleet,'progress',0,.4);assert.equal(S.identityCurrent(state.fleet,snapshot),true,'pure engine movement does not repeat company validation');
for(const how of ['owner','extras','column','membership','epoch','buffer','values','rollback']){
 const target=S.fromAssets(rows,{at:0}),stamp=S.identitySnapshot(target);
 if(how==='owner')S.set(target,1,'ownerCompanyId','sea');
 if(how==='extras')S.set(target,1,'companyId','other');
 if(how==='column')S.columnWriter(target,['flightHours'])(1,'flightHours',10);
 if(how==='membership')S.remove(target,1);
 if(how==='epoch')S.bumpEpoch(target);
 if(how==='buffer')target.rows=target.rows.slice(0);
 if(how==='values')target.values=structuredClone(target.values);
 if(how==='rollback'){const journal=S.beginJournal(target);S.set(target,1,'condition',42);S.rollbackJournal(journal);}
 assert.equal(S.identityCurrent(target,stamp),false,how);
}
// Actual integrity reader: worker evidence or an explicit unavailable issue; never a synchronous fleet walk.
state.fleet=S.fromAssets(rows,{at:0});const evidence=V.summarizeCompany(state,F,params());let fullWalks=0;
s.GH_FLEET_DATA={...F,forEachFieldClasses(){fullWalks++;throw new Error('forbidden-main-fleet-scan');},forEachFields(){fullWalks++;throw new Error('forbidden-main-fleet-scan');}};
for(const [name,found,available] of [['valid',{result:evidence,current:()=>true},true],['stale',{result:evidence,current:()=>false},false],['missing',null,false],['malformed',{result:{},current:()=>true},false]]){
 s.GH_COMPANY_FLEET_VALIDATION_PROVIDER=()=>found;const check=s.GH_INTEGRITY_CORE.check(state),missing=check.issues.some(row=>row.id==='COMPANY_PLATFORM_ASSET_VALIDATION_UNAVAILABLE');assert.equal(missing,!available,name);
}
assert.equal(fullWalks,0);
(async()=>{
 s.GH_FLEET_DATA=F;let queries=0;s.__COMPANY_CLIENT__={disabled:false,current:(found,store)=>found?.store===store&&found.revision===store.revision,query(store,{params}){queries++;return Promise.resolve({store,revision:store.revision,result:V.summarizeCompany(state,F,params)});}};
 s.COMPANY_PLATFORM=s.GH_COMPANY_PLATFORM;const startup=s.GH_COMPANY_PLATFORM.validateState(state);assert.equal(startup.ok,true);assert.equal(s.GH_COMPANY_PLATFORM.fleetEvidence(state).current(),true);
 const app=fs.readFileSync(path.join(process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..'),'WebApp/app.js'),'utf8'),start=app.indexOf('  const companyFleetEvidence=new WeakMap()'),end=app.indexOf('  globalThis.GH_FLEET_VALIDATION_PROVIDER=',start);
 assert.ok(start>=0&&end>start);vm.runInContext('let fleetEngineThreadClient=globalThis.__COMPANY_CLIENT__,lastFleetValidation=null;\n'+app.slice(start,end),s);
 const provider=s.GH_COMPANY_FLEET_VALIDATION_PROVIDER,first=await provider(state);assert.equal(first.current(),true);assert.equal(queries,0,'the existing startup check does not queue another fleet pass');
 for(let i=0;i<100;i++){S.toucher(state.fleet)(0);S.setSlot(state.fleet,'progress',0,i/100);assert.equal(provider(state,{syncOnly:true}).current(),true);}
 assert.equal(queries,0,'ordinary movement queues zero repeated company passes');
 const routes=state.customRoutes;state.customRoutes=[...routes,{id:'COMPANY-CONTEXT-ONLY',routeMode:'air',ownerCompanyId:'air'}];assert.equal(first.current(),true,'route geometry is not a company-reference predicate');assert.equal(provider(state,{syncOnly:true}).current(),true);assert.equal(queries,0);state.customRoutes=routes;
 const record=state.companyRegistry.air;state.companyRegistry.air=null;assert.equal(first.current(),false,'company registry changes expire evidence');assert.equal(provider(state,{syncOnly:true}),null);state.companyRegistry.air=record;
 const oldFleet=state.fleet;state.fleet=S.fromAssets(S.toAssets(oldFleet),{at:0});assert.equal(first.current(),false,'a replacement store cannot revive an old answer');assert.equal(provider(state,{syncOnly:true}),null);const replacement=await provider(state);assert.equal(queries,1);assert.equal(replacement.current(),true);
 S.set(state.fleet,0,'ownerCompanyId','unknown-owner');assert.equal(replacement.current(),false);assert.equal(provider(state,{syncOnly:true}),null);const changed=await provider(state);assert.equal(queries,2);assert.ok(changed.result.errors.includes('asset-company-reference:WORKER-000000'));
 s.GH_COMPANY_PLATFORM.validateState(state,{fleetAssetValidation:{...changed.result,errors:[],overflow:false}});assert.equal(s.GH_COMPANY_PLATFORM.fleetEvidence(state),null,'supplied evidence cannot certify itself for later checks');
 const client=s.__COMPANY_CLIENT__;let release=null;
 client.query=(store,{params})=>{const result=V.summarizeCompany(state,F,params),revision=store.revision;return new Promise(resolve=>{release=()=>resolve({store,revision,result});});};
 S.set(state.fleet,0,'assetClass','replacement-class');const inFlight=provider(state);state.fleet=S.fromAssets(rows,{at:0});release();assert.equal(await inFlight,null,'an in-flight answer for a replaced store is declined');assert.equal(provider(state,{syncOnly:true}),null);
 console.log(JSON.stringify({suite:'build404-worker-close-read-models',rows:rows.length,dailyWalks:1,refreshWalks:1,identityInvalidations:8,evidenceCases:4,mainFullWalks:fullWalks,ordinaryMoves:100,repeatedCompanyQueries:0}));
})().catch(error=>{console.error(error);process.exitCode=1;});
