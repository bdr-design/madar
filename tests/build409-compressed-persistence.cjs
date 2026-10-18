'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto'),path=require('node:path'),vm=require('node:vm'),{scenario}=require('./helpers/business-scenario');
const C=require('../WebApp/save-chunk-codec.js'),e=scenario(),s=e.s,state=e.state,TX=s.GH_TRANSACTION_CORE,S=s.GH_FLEET_STORE;
for(const name of ['migration-core','state-codec-core','persistence-core','fleet-save-validation-core','fleet-query-core'])e.load(name);
s.GH_FLEET_VALIDATION_PROVIDER=(target,params)=>s.GH_FLEET_QUERY.run('saveValidation',{fleet:target.fleet,simSeconds:Number(target.simSeconds)||0},s.GH_FLEET_DATA,params);
const P=s.GH_PERSISTENCE,codec=s.GH_STATE_CODEC,results=[],vault={chunks:new Map(),saves:[],requests:[],generation:0},yieldToFrame=()=>new Promise(r=>setTimeout(r,0));let encodeCalls=0,base64Calls=0,route='bridge',corrupt=false,refuse=false;
const realWorker=require('./helpers/save-checksum-node-worker.cjs').install(process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..')),LocalBytes=vm.runInContext('Uint8Array',s),nodeView=bytes=>bytes?new Uint8Array(bytes.buffer,bytes.byteOffset,bytes.byteLength):null,localResult=result=>({...result,bytes:new LocalBytes(result.bytes.buffer,result.bytes.byteOffset,result.bytes.byteLength)});
s.GH_SAVE_CHUNK_ENCODING_PROVIDER=async(bytes,stride,options)=>{encodeCalls++;return realWorker.encodeChunk(nodeView(bytes),stride,options).then(localResult);};
s.GH_SAVE_CHECKSUM_PROVIDER=(bytes,transform,length)=>realWorker.checksum(nodeView(bytes),transform,length).then(localResult);
s.GH_SAVE_ENCODING_PROVIDER=bytes=>{base64Calls++;return realWorker.base64(nodeView(bytes));};
s.GH_SAVE_CHECKSUM_THREAD={createSession(options){const inner=realWorker.createSession({...options,submit:realWorker.checksum});return {take:(bytes,next,transform,length,nextTransform,nextLength)=>inner.take(nodeView(bytes),nodeView(next),transform,length,nextTransform,nextLength).then(localResult),close:inner.close,stats:inner.stats};}};
// Keep exercising the legacy wire format independently of stored-container compression.
// New-format binary/fallback coverage follows the legacy corruption and NACK cases below.
s.GH_STATE_CODEC={...codec,serializeChunkedSteps(target,options){return codec.serializeChunkedSteps(target,{...options,externalEncoding:false});}};
const sha=text=>crypto.createHash('sha256').update(text).digest('hex');
const deliver=(name,detail)=>setTimeout(()=>s.dispatchEvent(new s.CustomEvent(name,{detail})),0);
function store(id,wire,encoding,rawBytes){
 const request={id,rawBytes,wireBytes:wire.byteLength,encoding};vault.requests.push(request);
 try{
  if(refuse)throw new Error('injected-chunk-refusal');
  if(corrupt&&encoding===C.ENCODING){wire=wire.slice();wire[16]^=1;corrupt=false;}
  const raw=encoding===C.ENCODING?C.unpack(wire,rawBytes):wire;assert.equal(raw.length,rawBytes);
  const prior=vault.chunks.get(id);if(prior)assert.deepEqual(Buffer.from(raw),prior,'immutable IDs cannot change their original bytes');
  vault.chunks.set(id,Buffer.from(raw));return {ok:true,id};
 }catch(error){return {ok:false,id,message:error.message};}
}
const bridge={postMessage(m){
 if(m.action==='storeSaveChunk'){const reply=store(m.id,new Uint8Array(Buffer.from(m.base64,'base64')),m.encoding||'identity',m.bytes);return deliver('gh-native-chunk-ack',{requestId:m.requestId,id:m.id,success:reply.ok,message:reply.message});}
 if(m.action==='commitSave'){
  const tree=JSON.parse(m.saveJSON),ids=[...tree.fleet.rows.chunks,...(tree.stateCodec?.chunks||[])],ok=ids.every(id=>vault.chunks.has(id))&&sha(m.saveJSON)===m.saveHash;if(ok)vault.saves.push(m.saveJSON);
  deliver('gh-native-save-ack',{requestId:m.requestId,action:m.action,saveRevision:m.saveRevision,resetEpoch:m.resetEpoch,saveSchemaVersion:m.saveSchemaVersion,saveHash:m.saveHash,success:ok,generation:ok?++vault.generation:undefined,message:ok?'':'missing-chunk'});
 }
}};
s.webkit={messageHandlers:{saveBridge:bridge}};
function chooseRoute(value){route=value;if(value==='bridge'){s.location={protocol:'about:'};delete s.fetch;}else{s.location={protocol:'gh:'};s.fetch=async(url,options)=>{if(route==='404')return {status:404};if(route==='network-error')throw new Error('injected-network-error');const encoding=options.headers?.['X-GH-Chunk-Encoding']||'identity',rawBytes=Number(options.headers?.['X-GH-Chunk-Raw-Bytes']||options.body.byteLength),reply=store(decodeURIComponent(url.split('/').at(-1)),new Uint8Array(options.body),encoding,rawBytes);return {status:reply.ok?200:409,ok:reply.ok,json:async()=>reply};};}}
state.godMoney=true;state.infiniteMoney=true;state.advanced.facilities.B1.capacity=1000000;
const base=state.globalBases.find(x=>x.id==='B1');base.deliveryCapacity=1000000;const item=e.item,total=item.price*3000;
assert(TX.execute(state,{label:'transport-fixture-purchase',apply:()=>s.GH_PROCUREMENT_CORE.withPurchaseBatch(state,()=>{const out=e.command('procurement','purchase-assets',{type:'air',ownerCompanyId:'air',tab:'new',item,base,supplier:{id:'S1',name:'Supplier',legalName:'Supplier LLC'},mode:'cash',qty:3000,manual:true,requestRef:'TRANSPORT-1',upfront:total,totalPrice:total,paymentMethod:'cash',leadSeconds:0,immediateDelivery:true});s.GH_REALISM.onSimulationTime(state,state.simSeconds);return out;})}).committed);
s.GH_MIGRATION_CORE.migrateFleet(state);const template=s.GH_FLEET_DATA.plain(state,s.GH_FLEET_DATA.list(state)[0].id);
TX.execute(state,{label:'transport-fixture-grow',scope:['fleet'],apply:()=>{for(let i=1;i<S.CHUNK_ROWS+17;i++)S.add(state.fleet,{...template,id:'WIRE-'+i,name:'Wire '+i});}});
const change=value=>TX.execute(state,{label:'transport-edit',scope:['fleet'],apply:()=>{S.set(state.fleet,0,'fuel',value);S.set(state.fleet,S.CHUNK_ROWS,'fuel',value+1);}});
const exact=()=>{const restored=codec.deserialize(vault.saves.at(-1),{resolveChunk:id=>vault.chunks.get(id)});assert.deepEqual(new Uint8Array(restored.fleet.rows),new Uint8Array(state.fleet.rows));assert.deepEqual(JSON.parse(JSON.stringify(restored.finance)),JSON.parse(JSON.stringify(state.finance)));};
async function ordinary(){const out=P.commitState(state,{storageKey:'transport-test'});assert(out.ok,out.reason);await out.native;exact();}
async function durable(){const previous=state.saveRevision;state.saveRevision++;try{return await P.commitDurableState(state,{storageKey:'transport-test',prevalidated:true,expectedPreviousRevision:previous,yieldToFrame});}catch(e){state.saveRevision=previous;throw e;}}
(async()=>{
 const money=JSON.stringify({cash:state.cash,finance:state.finance,treasury:state.treasury,companyFinance:state.companyFinance});
 chooseRoute('bridge');await ordinary();assert.equal(encodeCalls,0,'old native builds never receive unsupported compressed bytes');assert(vault.requests.every(r=>r.encoding==='identity'));results.push({case:'old-native capability absent',ok:true});
 s.GH_NATIVE_CHUNK_ENCODINGS=[C.ENCODING];change(71);vault.requests=[];await ordinary();assert(encodeCalls>0,'persistence must actually use the worker provider');assert(vault.requests.some(r=>r.encoding===C.ENCODING));const logical=vault.requests.reduce((sum,r)=>sum+r.rawBytes,0),wire=vault.requests.reduce((sum,r)=>sum+r.wireBytes,0);assert(wire<logical*.25);results.push({case:'compressed bridge and exact reload',logicalBytes:logical,wireBytes:wire});
 for(const value of ['binary','404','network-error']){chooseRoute(value);change(72+results.length);vault.requests=[];await durable();exact();assert(vault.requests.some(r=>r.encoding===C.ENCODING));results.push({case:value,ok:true});}
 chooseRoute('binary');change(87);const previous=vault.saves.at(-1),count=vault.saves.length;corrupt=true;await assert.rejects(durable(),/corrupt/);assert.equal(vault.saves.length,count,'bad transport must never commit a new manifest');assert.equal(vault.saves.at(-1),previous);await durable();exact();results.push({case:'CRC refusal preserves old save; exact retry',ok:true});
 change(89);const beforeRefuse=vault.saves.length;refuse=true;await assert.rejects(durable(),/injected-chunk-refusal/);assert.equal(vault.saves.length,beforeRefuse);refuse=false;await durable();exact();results.push({case:'native NACK preserves prior save; exact retry',ok:true});
 change(91);const beforeStage=vault.saves.length,staging=P.prestageDurableChunks(state,{yieldToFrame});assert(staging);assert((await staging.settled).ok);assert.equal(vault.saves.length,beforeStage);const uploadCount=vault.requests.length;await durable();assert.equal(vault.requests.length,uploadCount,'durable commit must reuse already staged original IDs');await staging.release();exact();results.push({case:'prestage waits for validation; no duplicate upload',ok:true});
 const beforeUnchanged=vault.requests.length;await ordinary();assert.equal(vault.requests.length,beforeUnchanged);assert.equal(JSON.stringify({cash:state.cash,finance:state.finance,treasury:state.treasury,companyFinance:state.companyFinance}),money,'transport never changes financial state');
 const legacyMetric=P.telemetry().timings.samples.find(x=>x.kind==='chunk-upload'&&x.compressedChunks>0);assert(legacyMetric&&legacyMetric.wireBytes<legacyMetric.bytes);
 s.GH_STATE_CODEC=codec;
 for(const [i,value]of ['binary','404','network-error'].entries()){
  chooseRoute(value);change(93+i);vault.requests=[];const beforeBase64=base64Calls;await durable();exact();const tree=JSON.parse(vault.saves.at(-1));
  assert(value==='binary'?base64Calls===beforeBase64:base64Calls>beforeBase64,'binary uploads avoid unused encoding; both fallbacks use the worker');
  assert.equal(tree.fleet.rows.lanes.version,2,'sliced saves must also exercise the actual stored-container format');assert(tree.fleet.rows.lanes.containers.some(c=>c.encoding==='gh-lz4-block-v1'),'a real worker must compress the stored bytes');assert(vault.requests.length>0);results.push({case:'stored-container '+value,ok:true});
 }
 chooseRoute('binary');change(97);const storedHead=vault.saves.at(-1),storedCount=vault.saves.length;refuse=true;await assert.rejects(durable(),/injected-chunk-refusal/);assert.equal(vault.saves.length,storedCount);assert.equal(vault.saves.at(-1),storedHead);refuse=false;await durable();exact();results.push({case:'stored-container native NACK and exact retry',ok:true});
 assert.equal(JSON.stringify({cash:state.cash,finance:state.finance,treasury:state.treasury,companyFinance:state.companyFinance}),money,'stored containers never change financial state');
 const metric=legacyMetric;assert(metric&&metric.wireBytes<metric.bytes);assert.equal(P.telemetry().pending,0);assert.equal(P.telemetry().recoveryRequired,false);assert.equal(P.isLocked(),false);
 assert(realWorker.stats().chunkEncodes>0);assert.equal(realWorker.stats().pending,0);assert.equal(realWorker.stats().activeSessions,0);assert.equal(realWorker.stats().activeChannels,0);
 console.log(JSON.stringify({suite:'build409-compressed-persistence',ok:true,results,unchangedUploads:0,financeUnchanged:true,realWorker:true,workerPending:0,workerSessions:0}));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>realWorker.terminate());
