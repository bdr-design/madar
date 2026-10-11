'use strict';
// Build 372: archived proof conversion is a real asynchronous maintenance part. This whole-app browser test uses the
// permanent proof worker and proves prepare -> wait -> freshness refusal -> worker result commit. A second app receives
// a worker error and proves the optional conversion is deferred without running the synchronous hash path in that frame.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app'),{serve}=require('./helpers/web-server');
const web=path.join(path.resolve(__dirname,'..'),'WebApp');
const workerSource=['authorization-core.js','document-proof-core.js'].map(file=>fs.readFileSync(path.join(web,file),'utf8')).join('\n;\n')+'\n;\n'+
  fs.readFileSync(path.join(web,'proof-verification-worker.js'),'utf8').replace(/^importScripts\([^)]*\);$/m,'');

function realWorker(source){const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));window.__GH_PROOF_VERIFICATION_WORKER_FACTORY__=()=>new Worker(url);}
function failedWorker(){window.__GH_PROOF_VERIFICATION_WORKER_FACTORY__=()=>({postMessage(){queueMicrotask(()=>this.onerror?.({message:'qa-proof-worker-failure'}));},terminate(){window.__QA_PROOF_WORKER_TERMINATED__=true;}});}
async function archivedCheques(page,count,prefix){
  return page.evaluate(async({count,prefix})=>{
    const a=__AUDIT__,state=__GH_STATE__,ids=[];state.godMoney=true;state.infiniteMoney=true;
    for(let index=0;index<count;index++){
      const issued=(await a.runAuthorizedDomainCommand('finance','issue-cheque',{company:'group',amount:700+index,beneficiary:'QA Proof Worker LLC',note:`${prefix}-${index}`,requestRef:`${prefix}-${index}`},{silent:true})).result;
      await a.runAuthorizedDomainCommand('finance','settle-cheque',{id:issued.id},{silent:true});ids.push(issued.id);
    }
    const selected=new Set(ids),moving=state.finance.cheques.filter(row=>selected.has(row.id)).map(row=>structuredClone(row));
    state.finance.cheques=state.finance.cheques.filter(row=>!selected.has(row.id));
    const archive=state.finance.auditArchive||{records:{},digests:[]},records=archive.records||{},base=Array.isArray(records.cheques)?records.cheques:[],next=[...base,...moving];
    if(base.length)GH_TRANSACTION_CORE.deriveContainer(next,base,{changed:moving});
    state.finance.auditArchive={...archive,records:{...records,cheques:next}};GH_TRANSACTION_CORE.sealCollections(state);
    if(moving.length!==count)throw new Error('qa-proof-archive-seed-invalid');
    return moving.map(row=>row.documentProofId);
  },{count,prefix});
}
const forms=(page,ids)=>page.evaluate(ids=>ids.map(id=>GH_DOCUMENT_PROOF.record(__GH_STATE__,id)?.form||null),ids);

(async()=>{
  const executablePath=['/usr/bin/chromium','/usr/bin/chromium-browser'].find(file=>fs.existsSync(file)),browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})}),server=await serve(web),errors=[];
  try{
    // Exercise the deployed URL as well as the Blob fixture below: importScripts must resolve both production cores.
    const workerPage=await browser.newPage();await workerPage.goto(`${server.baseURL}/document-proof-core.js`);
    const workerSmoke=await workerPage.evaluate(()=>new Promise((resolve,reject)=>{
      const worker=new Worker('proof-verification-worker.js'),timer=setTimeout(()=>{worker.terminate();reject(new Error('qa-proof-worker-url-timeout'));},10000);
      worker.onerror=event=>{clearTimeout(timer);worker.terminate();reject(new Error(event.message||'qa-proof-worker-url-error'));};
      worker.onmessage=event=>{clearTimeout(timer);worker.terminate();resolve(event.data);};worker.postMessage({type:'hash-archived',requestId:17,jobs:[{token:1}]});
    }));
    assert.equal(workerSmoke.type,'hash-archived-result');assert.equal(workerSmoke.version,'GH-PROOF-VERIFY-372.1.0');assert.equal(workerSmoke.requestId,17);assert.equal(workerSmoke.results?.[0]?.ok,false);await workerPage.close();
    const live=await boot({browser,errors,bypassCSP:true,beforeScripts:{fn:realWorker,arg:workerSource}}),page=live.page;page.setDefaultTimeout(120000);
    const ids=await archivedCheques(page,6,'QA-PROOF-WORKER'),before=await forms(page,ids);
    const schemaFirst=await page.evaluate(()=>{const mark=()=>`${__GH_STATE__.saveRevision}|${__GH_STATE__.controlPlane?.revision}|${__GH_STATE__.simSeconds}`,entry=window.__QA_PROOF_SCHEMA_ENTRY__={task:'schema',steps:GH_SAVE_SCHEMA.validationSteps(__GH_STATE__,{trustVerified:true}),mark:mark(),markOf:mark},finished=__AUDIT__.runMaintenanceTask(entry)!==false;return {finished,jobs:entry.proofHashRound?.plan?.jobs?.length||0};});
    assert.equal(schemaFirst.finished,false,'schema waits for archived hashes before entering its unchanged validation');assert.ok(schemaFirst.jobs>0,'the schema preflight sent sealed archive pairs to the worker');assert.deepEqual(await forms(page,ids),before);
    await page.evaluate(()=>{__GH_STATE__.documentProofs.recordsById={...__GH_STATE__.documentProofs.recordsById};});
    const schemaOutcome=await page.evaluate(async ids=>{const entry=window.__QA_PROOF_SCHEMA_ENTRY__,sleep=()=>new Promise(resolve=>setTimeout(resolve,0));for(let calls=1;calls<300;calls++){await sleep();const finished=__AUDIT__.runMaintenanceTask(entry)!==false;if(finished)return {calls:calls+1,restarts:entry.proofHashRestarts||0,verified:entry.proofHashesVerified||0,fallback:entry.proofHashFallback===true,forms:ids.map(id=>GH_DOCUMENT_PROOF.record(__GH_STATE__,id)?.form),valid:GH_SAVE_SCHEMA.validate(__GH_STATE__).ok};}throw new Error('qa-proof-schema-worker-timeout');},ids);
    assert.ok(schemaOutcome.restarts>=1,'schema discards a worker batch for replaced proof maps');assert.ok(schemaOutcome.verified>=ids.length,'schema worker certified every archived pair');assert.equal(schemaOutcome.fallback,false);assert.deepEqual(schemaOutcome.forms,before,'schema certificates never convert records');assert.equal(schemaOutcome.valid,true);
    const first=await page.evaluate(()=>{const entry=window.__QA_PROOF_ENTRY__={task:'proof-archived'},finished=__AUDIT__.runMaintenanceTask(entry)!==false;return {finished,jobs:entry.proofRound?.plan?.jobs?.length||0,done:entry.proofRound?.done===true};});
    assert.equal(first.finished,false,'the first call prepares and waits');assert.ok(first.jobs>0);assert.equal(first.done,false);
    assert.deepEqual(await forms(page,ids),before,'prepare does not publish a conversion');
    // Replace the exact proof map while the worker owns its clone. Its first answer must be refused as stale.
    await page.evaluate(()=>{__GH_STATE__.documentProofs.recordsById={...__GH_STATE__.documentProofs.recordsById};});
    const outcome=await page.evaluate(async({ids,before})=>{
      const entry=window.__QA_PROOF_ENTRY__,sleep=()=>new Promise(resolve=>setTimeout(resolve,0));let calls=1,staleUnchanged=false,staleObserved=false;
      for(;calls<100;calls++){
        await sleep();const finished=__AUDIT__.runMaintenanceTask(entry)!==false;
        if(!staleObserved&&entry.staleRetries===1&&!entry.proofRound){staleObserved=true;staleUnchanged=ids.every((id,index)=>GH_DOCUMENT_PROOF.record(__GH_STATE__,id)?.form===before[index]);}
        if(finished)return {calls:calls+1,staleRetries:entry.staleRetries||0,staleObserved,staleUnchanged,rounds:entry.rounds||0,forms:ids.map(id=>GH_DOCUMENT_PROOF.record(__GH_STATE__,id)?.form),valid:GH_SAVE_SCHEMA.validate(__GH_STATE__).ok};
      }
      throw new Error('qa-proof-worker-maintenance-timeout');
    },{ids,before});
    assert.equal(outcome.staleRetries,1,'the in-flight result for replaced maps is refused');assert.equal(outcome.staleUnchanged,true,`the stale answer publishes no record: ${JSON.stringify({before,outcome})}`);
    assert.ok(outcome.calls>2&&outcome.rounds>=3,'the part waits across calls and commits bounded rounds');assert.ok(outcome.forms.every(form=>form==='archived-document-v2'));assert.equal(outcome.valid,true);
    await page.close();

    const broken=await boot({browser,errors,bypassCSP:true,beforeScripts:{fn:failedWorker}}),failedPage=broken.page;failedPage.setDefaultTimeout(120000);
    const failedIds=await archivedCheques(failedPage,2,'QA-PROOF-FAIL'),failedBefore=await forms(failedPage,failedIds);
    await failedPage.evaluate(()=>{const owner=GH_AUTHORIZATION;window.__QA_AUTH_COMPACTIONS__=0;window.GH_AUTHORIZATION={...owner,compact(...args){window.__QA_AUTH_COMPACTIONS__++;return owner.compact(...args);}};});
    const failure=await failedPage.evaluate(async ids=>{
      const entry={task:'proof-archived'},sleep=()=>new Promise(resolve=>setTimeout(resolve,0));let calls=0,first;
      for(;calls<20;calls++){
        const finished=__AUDIT__.runMaintenanceTask(entry)!==false;if(calls===0)first=finished;
        if(finished)return {first,calls:calls+1,forms:ids.map(id=>GH_DOCUMENT_PROOF.record(__GH_STATE__,id)?.form),terminated:window.__QA_PROOF_WORKER_TERMINATED__===true,authorizationCompactions:window.__QA_AUTH_COMPACTIONS__};
        await sleep();
      }
      throw new Error('qa-proof-worker-failure-timeout');
    },failedIds);
    assert.equal(failure.first,false,'a failed worker is still awaited asynchronously');assert.ok(failure.calls>=2);assert.deepEqual(failure.forms,failedBefore,'worker failure defers conversion without a synchronous fallback');assert.equal(failure.terminated,true);assert.equal(failure.authorizationCompactions,0,'worker failure does not run unrelated archive compaction as a fallback');
    const fallbackSchema=await failedPage.evaluate(async()=>{const mark=()=>`${__GH_STATE__.saveRevision}|${__GH_STATE__.controlPlane?.revision}|${__GH_STATE__.simSeconds}`,entry={task:'schema',steps:GH_SAVE_SCHEMA.validationSteps(__GH_STATE__,{trustVerified:true}),mark:mark(),markOf:mark},sleep=()=>new Promise(resolve=>setTimeout(resolve,0));for(let calls=0;calls<100;calls++){const finished=__AUDIT__.runMaintenanceTask(entry)!==false;if(finished)return {calls:calls+1,fallback:entry.proofHashFallback===true,valid:GH_SAVE_SCHEMA.validate(__GH_STATE__).ok};await sleep();}throw new Error('qa-proof-schema-fallback-timeout');});
    assert.equal(fallbackSchema.fallback,true,'schema records that the worker was unavailable');assert.equal(fallbackSchema.valid,true,'the unchanged main-thread validator remains the correctness fallback');
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({ok:true,schemaCalls:schemaOutcome.calls,schemaVerified:schemaOutcome.verified,calls:outcome.calls,rounds:outcome.rounds,staleRetries:outcome.staleRetries,failureCalls:failure.calls,fallbackSchemaCalls:fallbackSchema.calls}));
    console.log('BUILD372_PROOF_WORKER_BROWSER_PASS');
  }finally{await server.close();await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
