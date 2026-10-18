'use strict';
// Explicit local measurements; no gameplay hook. Compare the same script with GH_TEST_SOURCE_DIR pointing to
// the preserved source. Codec times exclude native transport/ACK, signatures, validation and restoration assertions.
const assert=require('node:assert/strict'),path=require('node:path');
const ROOT=path.resolve(process.env.GH_TEST_SOURCE_DIR||path.join(__dirname,'..')),mode=process.argv[2]||'validation';global.window=global;
const TX=require(path.join(ROOT,'WebApp/transaction-core.js')),S=require(path.join(ROOT,'WebApp/fleet-store-core.js'));
const timed=async fn=>{const at=performance.now(),value=await fn();return {ms:performance.now()-at,value};};
async function validation(){
 require(path.join(ROOT,'WebApp/fleet-event-core.js'));const F=require(path.join(ROOT,'WebApp/fleet-access-core.js')),V=require(path.join(ROOT,'WebApp/fleet-save-validation-core.js'));
 const rows=Number(process.env.GH_ROWS||1000000),fleet=S.create(rows),routes=Array.from({length:859},(_,i)=>['R'+i,['air','sea','road'][i%3],['air','sea','road'][i%3],8192]),state={simSeconds:3600,fleet};
 for(let i=0;i<rows;i++){const r=routes[i%routes.length];S.add(fleet,{id:'QA-'+i,name:'QA '+i,type:r[1],ownerCompanyId:r[2],baseFacility:'BASE-'+(i%2),routeId:r[0],phase:'moving',progress:.1,fuel:90,condition:95,tripSeconds:70000});}
 const params={routeIds:routes.map(r=>r[0]),routes,registryCompanies:['air','sea','road'],definitionCompanies:['air','sea','road'],legacyAssetOwners:{air:'air',sea:'sea',road:'road'}},samples=[];
 V.summarize(state,F,params);let result;for(let i=0;i<3;i++){state.simSeconds+=20;const sample=await timed(()=>V.summarize(state,F,params));samples.push(sample.ms);result=sample.value;}
 const ref=await timed(()=>V.summarizeReference(state,F,params));assert.deepEqual(result,ref.value);return {rows,routes:routes.length,warmMs:samples,referenceMs:ref.ms,exact:true};
}
async function clone(){
 const shape={route:Array.from({length:5000},(_,i)=>[i/100,i/200]),terms:{currency:'USD',unitCost:1200}};assert(TX.sealValue(shape));const state={mobility:{vehicles:Array.from({length:3000},(_,i)=>({id:'CAR-'+i,battery:90,route:shape}))},saveRevision:10},samples=[];let copied;
 for(let i=0;i<4;i++){const sample=await timed(()=>TX.deepCloneInSlices(state,{shareJournaledRoots:true,yieldToHost:async()=>{}}));if(i)samples.push(sample.ms);copied=sample.value;}
 assert.deepEqual(copied.mobility.vehicles[0].route,shape);assert.equal(copied.mobility.vehicles.at(-1).route,copied.mobility.vehicles[0].route);copied.mobility.vehicles[0].battery=1;assert.equal(state.mobility.vehicles[0].battery,90);return {vehicles:3000,sealedPoints:5000,extraGeometryCopies:copied.mobility.vehicles[0].route===shape?0:1,warmMs:samples,mutableIsolation:true};
}
async function values(){
 const C=require(path.join(ROOT,'WebApp/state-codec-core.js'));global.GH_NATIVE_VALUE_CHUNKS=1;
 const fleet=S.create(19),state={saveVersion:'3.0.0',saveRevision:1,resetEpoch:0,simSeconds:0,fleet,companyFinance:{group:{accounts:[{balance:123456.78}]}}},vault=new Map();
 for(let i=0;i<19;i++)S.add(fleet,{id:'VALUE-'+i,type:['air','sea','road'][i%3],name:'Value '+i,phase:'idle',fuel:100,condition:100,progress:0});
 for(let i=0;i<4099;i++)S.intern(fleet,{id:'INTERN-'+i,note:'تشخيص الحركة 🙂 '.repeat(42),point:[i%90,i%180],amount:i*.25,nested:{phase:'moving',values:[null,true,false,'"\\\n',i]}});
 function save(){const iter=C.serializeChunkedSteps(state,{knownChunkIds:new Set(vault.keys())}),at=performance.now();let step,maxStepMs=0,yields=0;for(;;){const started=performance.now();step=iter.next();maxStepMs=Math.max(maxStepMs,performance.now()-started);if(step.done)break;yields++;}const ms=performance.now()-at,out=step.value;let uploadBytes=0;for(const c of out.chunks)if(!vault.has(c.id)){const bytes=c.data||new TextEncoder().encode(c.text);vault.set(c.id,bytes.slice());uploadBytes+=bytes.length;}const restored=C.deserialize(out.text,{resolveChunk:id=>vault.get(id)});assert.deepEqual(restored.fleet.values,fleet.values);assert.deepEqual(restored.companyFinance,state.companyFinance);return {ms,maxStepMs,yields,uploadBytes,payloadBytes:Buffer.byteLength(out.text)};}
 const cold=save(),warm=[];for(let i=0;i<3;i++){state.companyFinance.group.accounts[0].balance+=1;warm.push(save());}fleet.values[301].nested.phase='turnaround';const changed=save();return {values:fleet.values.length,tableBytes:Buffer.byteLength(JSON.stringify(fleet.values)),cold,warm,changed,cache:C.valueChunkStats?.()||null,exact:true};
}
async function settlement(){
 const {scenario}=require(path.join(ROOT,'tests/helpers/business-scenario')),e=scenario(),g=e.s,F=g.GH_FINANCE_CORE,T=g.GH_TRANSACTION_CORE,base=e.state;let target=base;base.godMoney=true;base.infiniteMoney=true;
 const command=(name,p)=>g.GH_DOMAIN_COMMANDS.dispatch({...e.ctx,state:target},'finance',name,p).result;
 g.__GH_DURABLE_COMMAND_CONTEXT__={liveState:{},draft:base};for(let i=0;i<80;i++)command('accrue-expense',{company:'air',amount:100+i,note:'QA Trace '+i,counterparty:'QA Trace Supplier LLC',number:'TRACE-'+i,taxable:false});delete g.__GH_DURABLE_COMMAND_CONTEXT__;
 const snapshots=[],samples=[];let cold;
 for(let round=0;round<4;round++){target=T.deepClone(base);g.__GH_DURABLE_COMMAND_CONTEXT__={liveState:{},draft:target};const phases={};try{const at=performance.now();await F.withSettlementBatch(target,async()=>{let start=performance.now();for(let i=0;i<80;i++)command('settle-payable',{number:'TRACE-'+i,method:'cheque'});phases.issueMs=performance.now()-start;start=performance.now();for(const id of target.finance.cheques.map(r=>r.id))command('settle-cheque',{id});phases.cashMs=performance.now()-start;});phases.totalMs=performance.now()-at;}finally{delete g.__GH_DURABLE_COMMAND_CONTEXT__;}
  const snapshot=JSON.stringify({finance:target.finance,books:target.companyFinance,proofs:target.documentProofs,treasury:target.treasury,budgets:target.companyBudgets});snapshots.push(snapshot);if(round)samples.push(phases);else cold=phases;
 }
 for(const snapshot of snapshots)assert.equal(snapshot,snapshots[0]);return {issues:80,settlements:80,cold,warm:samples,exactAcrossRuns:true,financialSha256:require('node:crypto').createHash('sha256').update(snapshots[0]).digest('hex'),scope:'core apply only; no UI yields, native ACK, schema, clone or publication'};
}
(async()=>{assert(['validation','clone','values','settlement'].includes(mode));console.log(JSON.stringify({source:ROOT,mode,...await ({validation,clone,values,settlement}[mode])()}));})().catch(error=>{console.error(error);process.exitCode=1;});
