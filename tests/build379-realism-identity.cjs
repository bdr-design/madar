'use strict';
const assert=require('node:assert/strict'),{scenario}=require('./helpers/business-scenario');
const {harness,minimal}=require('./helpers/core-harness');
(async()=>{
 const {s}=harness(['fleet-query-core']),F=s.GH_FLEET_DATA,Q=s.GH_FLEET_QUERY;let checks=0;
 for(const ids of [['A1','A2'],['DUP','DUP'],[undefined,null,'',0,false],['', '',null,null,'X',3,3],[1,2,'1','2']]){
  const st=minimal();st.assets=ids.map(id=>({id}));let expected=0;const seen=new Set();for(const id of ids){if(!id||seen.has(id))expected++;seen.add(id);}
  const out=Q.run('identityIntegrity',st,F,{});assert.equal(out.issueCount,expected);assert.equal(out.rows,ids.length);checks++;
 }
 // Extract the actual staged identity owner; test its wait/currentness policy without running unrelated daily owners.
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{ROOT}=require('./helpers/core-harness'),source=fs.readFileSync(path.join(ROOT,'WebApp/realism-core.js'),'utf8');
 const a=source.indexOf('  function* dailyIdentityFromWorker('),b=source.indexOf('  function* onDayStages',a),owner=source.slice(a,b);
 const env=harness([]),g=env.s;g.fleetData=()=>({size:()=>980000});g.CONDITION_SUM_WAITS=3;g.GH_TRANSACTION_CORE={isStaged:()=>true};vm.runInContext(owner+';globalThis.testIdentity=dailyIdentityFromWorker;',g);
 for(const kind of ['current','stale','missing','invalid','rejected']){
  g.GH_FLEET_QUERY_PROVIDER=()=>kind==='missing'?null:kind==='rejected'?Promise.reject(new Error('worker-failed')):Promise.resolve({current:()=>kind!=='stale',result:{rows:980000,issueCount:kind==='invalid'?980001:0}});
  const steps=g.testIdentity({}),waits=[];let step,error=null;try{while(!(step=steps.next()).done){waits.push(step.value);await Promise.resolve();}}catch(e){error=e;}
  if(kind==='current'){assert.equal(step.value,0);assert.deepEqual(waits,['realism.identity-wait']);}else assert.match(error?.message||'',/realism-identity-worker-unavailable/);checks++;
 }
 console.log(JSON.stringify({suite:'build379-realism-identity',ok:true,checks,legacyIssueCountsPreserved:true,staleCannotScanMain:true,boundedWorkerReply:true}));
})().catch(error=>{console.error(error);process.exitCode=1;});
