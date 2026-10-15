'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{chromium,webkit}=require('playwright'),{serve}=require('./helpers/web-server');
const root=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..'),web=path.join(root,'WebApp');
(async()=>{const server=await serve(web);try{for(const engine of [chromium,webkit]){const browser=await engine.launch({headless:true});try{
 const page=await browser.newPage(),url=server.baseURL+'/__qa_mutation379__';await page.route(url,r=>r.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8">'}));await page.goto(url);
 for(const file of ['fleet-store-core.js','simulation-asset-core.js','fleet-event-core.js','fleet-engine-thread.js'])await page.addScriptTag({content:fs.readFileSync(path.join(web,file),'utf8')});
 const out=await page.evaluate(async origin=>{
  const S=GH_FLEET_STORE,store=S.create(3000);for(let i=0;i<3000;i++)S.add(store,{id:'MV-'+i,ownerCompanyId:'air',assetMode:'air',baseFacility:'B1',phase:'idle',progress:0,fuel:100,condition:100});
  const client=GH_FLEET_ENGINE_THREAD.create({workerFactory:()=>new Worker(origin+'/fleet-engine-worker.js'),resolveRoute:()=>null,routesRevision:()=>0,catalogSpecs:()=>({}),timeoutMs:30000}),check=(x,m)=>{if(!x)throw new Error(m);};client.prime(store);
  for(let i=0;i<1000&&!client.replicaReady(store);i++)await new Promise(r=>setTimeout(r,5));check(client.replicaReady(store),'replica-not-ready');
  const before=new Uint8Array(store.rows).slice(),values=JSON.stringify(store.values),session=client.beginMutation(store),journal=S.beginJournal(store);check(session,'mutation-refused');
  const ask=()=>client.query(store,{name:'saveValidation',params:{routeIds:[],registryCompanies:['air'],definitionCompanies:['air'],companyReferenceCompanies:['air'],legacyAssetOwners:{air:'air'}}});
  check(ask()===null,'unfinished mutation admitted validation');S.set(store,0,'fuel',91);check(client.finishMutation(session,store),'final-flush-refused');
  const valid=await ask();check(client.current(valid,store)&&valid.result.errors.length===0,'final-validation-failed');
  check(client.query(store,{name:'conditionSum'})===null,'gameplay query entered mutation');check(client.fieldClasses(store,{fields:['id']})===null,'class query entered mutation');
  S.set(store,1,'fuel',92);check(ask()===null,'unflushed write admitted validation');check(client.flushMutation(session,store),'flush-refused');check(ask()===null,'nonfinal flush admitted validation');check(client.finishMutation(session,store),'second-final-refused');check(client.current(await ask(),store),'new validation stale');
  S.rollbackJournal(journal);check(client.settleMutation(session,'rollback'),'rollback-refused');const replica=await client.inspect(),actual=new Uint8Array(replica.rows);check(actual.length===before.length&&actual.every((v,i)=>v===before[i]),'worker rollback changed row bytes');check(JSON.stringify(replica.values)===values,'worker rollback changed values');check(new Uint8Array(store.rows).every((v,i)=>v===before[i]),'main rollback changed row bytes');
  const stats=client.stats();client.terminate('test-complete');return {rows:3000,validationQueries:stats.queryRequests,fullSyncs:stats.fullSyncs,mutationRollbacks:stats.mutationRollbacks};
 },server.baseURL);
 assert.equal(out.fullSyncs,1);assert.equal(out.mutationRollbacks,1);console.log(JSON.stringify({suite:'build379-mutation-validation-browser',ok:true,engine:engine.name(),...out}));
}finally{await browser.close();}}}finally{await server.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
