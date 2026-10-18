(()=>{
  'use strict';
  const VERSION='3.0.0', SAVE_SCHEMA_VERSION='3.0.0', SLOT_FORMAT='global-holdings-save-slot-v2', EXPORT_FORMAT='global-holdings-save';
  // A purchase may not take the fleet past the record ceiling (live assets plus pending delivery snapshots; delivered
  // receipts are stored compactly since Build 358 and do not count). It is an admission rule only: a save above it
  // still loads. The browser save is one localStorage string (4.5 MB), so it keeps 6,000 records. Build 358
  // (million-asset game): the native save keeps the fleet records in 4 MiB vault chunks outside the JSON, validation
  // and the daily close work per class of rows, so the native ceiling is 1,000,000 records. Measured in desktop
  // Chromium with the full app at 1,000,000 assets: 0.5 MB save JSON plus 168 MB of record chunks, warm save ~130 ms,
  // purchase ~0.3 s, daily close ~3.6 s spread over frames (longest task ~0.2 s), boot ~3 s.
  const PERSISTENCE_LIMITS=Object.freeze({softBytes:2*1024*1024,hardBytes:4*1024*1024,storageBytes:4.5*1024*1024,nativeSoftBytes:22.5*1024*1024,nativeHardBytes:30*1024*1024,browserFleetRecordLimit:6000,nativeFleetRecordLimit:1000000,ackTimeoutMs:10000,pending:16});
  const saveSchemaVersion=state=>['2.0.0','3.0.0'].includes(String(state?.saveVersion||''))?String(state.saveVersion):SAVE_SCHEMA_VERSION;
  const slotKey=index=>{if(!Number.isInteger(Number(index))||index<0||index>2)throw new Error('invalid-save-slot');return `global-holdings-save-slot-${Number(index)+1}`;};
  const clone=v=>{const copy=globalThis.structuredClone?structuredClone(v):JSON.parse(JSON.stringify(v));return globalThis.GH_STATE_CODEC?.inheritColdArchive?.(v,copy)||copy;};
  // Storage encoding (Build 350). Large homogeneous collections are persisted as shape + positional-cell rows with an
  // interned pool, so a 20,000-asset fleet no longer repeats every property name and crew table 20,000 times. This is a
  // TRANSPORT encoding only: the live state and Save Schema are unchanged, parseState(serializeState(x)) is exactly
  // JSON.parse(JSON.stringify(x)), and plain (pre-350) saves still load because decodeState passes them through.
  const stateCodec=()=>globalThis.GH_STATE_CODEC||null;
  function serializeState(state){const codec=stateCodec();return codec?codec.serialize(state):JSON.stringify(state);}
  function decodeTree(tree){const codec=stateCodec();return codec?codec.decodeState(tree):tree;}
  function parseState(json){return decodeTree(JSON.parse(json));}
  // Full saves remain full. Stamp the start of the serialized snapshot, then acknowledge only that stamp after the
  // actual storage success. A later tracked write stays pending; failure/old acknowledgements cannot clear it.
  function captureSaveChanges(state){const changes=globalThis.GH_TRANSACTION_CORE?.changeTracking;if(!changes)return null;changes.touch(state);return changes.capture(state);}
  function acknowledgeSaveChanges(state,token){if(token)globalThis.GH_TRANSACTION_CORE?.changeTracking?.acknowledgeSnapshot(state,token);}
  const clock=()=>globalThis.performance?.now?.()??Date.now();
  const FLEET_MAIN_THREAD_ROWS=2048;
  // A recurring save may use a current compact worker answer. A synchronous caller asks the provider for cache only;
  // an asynchronous sliced save may start a query and wait. Above the bounded fallback limit, absence/staleness is a
  // validation failure instead of permission to scan the whole fleet on the presentation thread.
  function fleetValidationOptions(state,{allowAsync=false}={}){
    const fleet=globalThis.GH_FLEET_DATA,policy=globalThis.GH_FLEET_MAIN_THREAD_POLICY;let rows=Infinity;
    try{rows=Number(fleet?.size?.(state));if(!Number.isSafeInteger(rows)||rows<0)rows=Infinity;}catch(_error){rows=Infinity;}
    let requireFleetValidation;try{requireFleetValidation=policy?.decision?policy.decision(state,fleet,{operation:'persistence-save-validation',limit:FLEET_MAIN_THREAD_ROWS}).allowed===false:rows>FLEET_MAIN_THREAD_ROWS;}catch(_error){requireFleetValidation=true;}
    const provider=globalThis.GH_FLEET_VALIDATION_PROVIDER,options={requireFleetValidation};if(typeof provider==='function')options.fleetValidation=(target,params)=>provider(target,params,{syncOnly:!allowAsync||!requireFleetValidation});return options;
  }
  const pending=new Map(), slotPending=new Map(), samples=[],timingSamples=[];
  let lastSaveBreakdown=null,lastNativeAck=null,lastSaveAtMs=null;
  function rememberTiming(row){const value={...row,recordedAtMs:Date.now()};timingSamples.push(value);if(timingSamples.length>24)timingSamples.shift();return value;}
  let sequence=0,slotSequence=0,generation=0,locked=false,durableLocked=false,recoveryRequired=false,ordinaryInFlight=null,ordinaryDirty=false,ordinaryDirtyState=null,ordinaryDirtyOptions=null,ordinaryError=null;
  const nativeSlotMeta=new Map((Array.isArray(globalThis.__GH_NATIVE_SLOT_META__)?globalThis.__GH_NATIVE_SLOT_META__:[]).filter(row=>Number.isInteger(Number(row?.index))&&Number(row.index)>=0&&Number(row.index)<=2).map(row=>[Number(row.index),clone(row)]));
  function telemetry(row){samples.push(row);if(samples.length>32)samples.shift();return row;}
  function status(detail){if(globalThis.dispatchEvent&&globalThis.CustomEvent)globalThis.dispatchEvent(new CustomEvent('gh-persistence-status',{detail}));}
  function validateState(state){return globalThis.GH_SAVE_SCHEMA?.validate?.(state)||{ok:false,errors:['save-schema-unavailable']};}
  function assertState(state){const v=validateState(state);if(!v.ok)throw new Error(`invalid-save:${(v.errors||[]).join(',')}`);}
  // Build 350: recurring saves of the live game use the verified-once ledger (see save-schema.js). Loads, imports, manual
  // slots, exports and recovery keep using assertState() (always full).
  // Build 359 (owner: no save walks every document; the full validation of every tenth save took 77 ms on iPhone at
  // 13,291 documents): the fresh verification of every proof is the proof audit of maintenance (GH_SAVE_SCHEMA.
  // createProofAudit, a few proofs per pass). When the audit finds a fault that a full validation confirms, it asks for
  // full validations here (requireFullValidation): every recurring save then validates in full, and is refused while the
  // state is invalid, as a scheduled full pass refused it before; the first one that passes clears the request.
  let fullValidationReason=null;
  function requireFullValidation(reason='proof-audit'){fullValidationReason=String(reason||'proof-audit');return true;}
  // prevalidated: the caller validated this exact state (trusted) just before.
  function assertRecurringState(state,{prevalidated=false}={}){
    // Build 358: the rows a save writes are sealed first (immutable by contract), so later full passes and durable drafts
    // can rely on them not changing (see GH_TRANSACTION_CORE.registerSealedCollections).
    try{globalThis.GH_TRANSACTION_CORE?.sealCollections?.(state);}catch(_error){/* sealing is an optimisation */}
    const full=fullValidationReason!==null,schema=globalThis.GH_SAVE_SCHEMA;if(prevalidated&&!full)return;
    const validationOptions={...(full?{}:{trustVerified:true}),...fleetValidationOptions(state,{allowAsync:false})},v=schema?.validate?.(state,validationOptions)||{ok:false,errors:['save-schema-unavailable']};
    if(!v.ok)throw new Error(`invalid-save:${(v.errors||[]).join(',')}`);
    if(full)fullValidationReason=null;
  }
  // Build 353: one save used to UTF-8 encode the same multi-megabyte JSON up to three times (native size check,
  // browser cache size check, SHA-256). The encoded bytes are now produced once per save and shared; values are
  // identical because the same TextEncoder output is measured and hashed.
  function utf8(text){return globalThis.TextEncoder?new TextEncoder().encode(text):null;}
  function bytes(text,encoded=null){if(encoded)return encoded.byteLength;if(globalThis.TextEncoder)return new TextEncoder().encode(text).byteLength;let n=0;for(const c of text){const p=c.codePointAt(0);n+=p<128?1:p<2048?2:p<65536?3:4;}return n;}
  function inspectJSON(json,key='',options={},encoded=null){
    if(typeof json!=='string')throw new Error('serialization-failed');
    const utf8Bytes=bytes(json,encoded),storageBytes=json.length*2,hard=Math.min(PERSISTENCE_LIMITS.hardBytes,options.hardBytes||PERSISTENCE_LIMITS.hardBytes);
    let totalStorageBytes=storageBytes+String(key).length*2;
    for(let i=0;i<(localStorage.length||0);i++){const k=localStorage.key(i);if(k!==key)totalStorageBytes+=(String(k).length+(localStorage.getItem(k)||'').length)*2;}
    const warning=utf8Bytes>=Math.min(PERSISTENCE_LIMITS.softBytes,options.softBytes||PERSISTENCE_LIMITS.softBytes)||storageBytes>=PERSISTENCE_LIMITS.softBytes;
    if(utf8Bytes>hard||storageBytes>hard||totalStorageBytes>PERSISTENCE_LIMITS.storageBytes){const e=new Error('save-size-hard-limit');e.measurement={utf8Bytes,storageBytes,totalStorageBytes};throw e;}
    return {utf8Bytes,storageBytes,totalStorageBytes,warning};
  }
  function inspectNativeJSON(json,encoded=null){
    if(typeof json!=='string')throw new Error('serialization-failed');
    const utf8Bytes=bytes(json,encoded),storageBytes=json.length*2,warning=utf8Bytes>=PERSISTENCE_LIMITS.softBytes;
    if(utf8Bytes>PERSISTENCE_LIMITS.nativeHardBytes){const e=new Error('native-save-size-hard-limit');e.measurement={utf8Bytes,storageBytes};throw e;}
    return {utf8Bytes,storageBytes,totalStorageBytes:null,warning};
  }
  function restoreRaw(key,raw){if(raw===null)localStorage.removeItem(key);else localStorage.setItem(key,raw);if(localStorage.getItem(key)!==raw)throw new Error('save-rollback-verification');}
  function writeJSON(key,json,options={},encoded=null){
    const start=clock();let previous=null,attempted=false;
    try{
      const measurement=inspectJSON(json,key,options,encoded);previous=localStorage.getItem(key);attempted=true;
      localStorage.setItem(key,json);
      if(localStorage.getItem(key)!==json)throw new Error('save-readback-mismatch');
      telemetry({operation:'write',ok:true,...measurement,durationMs:clock()-start});
      // A native-mode browser mirror is redundancy only; its 2 MB WebStorage limit is not the player's save limit.
      if(measurement.warning)status({ok:true,warning:true,reason:'save-size-soft-warning',...measurement,mirror:options.mirror===true});
      return {ok:true,json,previous,...measurement};
    }catch(error){
      let rollbackError=null;
      if(attempted)try{if(localStorage.getItem(key)!==previous)restoreRaw(key,previous);}catch(e){rollbackError=String(e.message||e);}
      const out={ok:false,reason:String(error.message||error),rollbackError,...error.measurement};telemetry({operation:'write',...out,durationMs:clock()-start});return out;
    }
  }
  function writeState(key,state,options={}){const start=clock();try{assertState(state);const json=serializeState(state);const out=writeJSON(key,json,options);telemetry({operation:'serialize',ok:out.ok,utf8Bytes:out.utf8Bytes,durationMs:clock()-start});return out;}catch(e){const out={ok:false,reason:`serialization-or-schema:${e.message||e}`};telemetry({operation:'serialize',...out,durationMs:clock()-start});return out;}}
  function bridgeFor(action){return globalThis.webkit?.messageHandlers?.[action==='resetGameSave'?'updateBridge':'saveBridge'];}
  function fleetRecordLimit(){return bridgeFor('commitSave')?PERSISTENCE_LIMITS.nativeFleetRecordLimit:PERSISTENCE_LIMITS.browserFleetRecordLimit;}
  function receiveAck(detail={}){
    const row=pending.get(detail.requestId);if(!row)return false;
    if(detail.action!==row.envelope.action||detail.saveRevision!==row.envelope.saveRevision||detail.resetEpoch!==row.envelope.resetEpoch||detail.saveHash!==row.envelope.saveHash||detail.saveSchemaVersion!==row.envelope.saveSchemaVersion||typeof detail.success!=='boolean')return false;
    if(detail.success&&(!Number.isSafeInteger(detail.generation)||detail.generation<=generation))return false;
    const ackAt=clock(),nativeVaultCommitMs=Number(detail.nativeVaultCommitMs);
    // Native commit and deferred-cleanup timings. The bounded key/count gate keeps the bridge diagnostic-only while
    // retaining the background GC path alongside the foreground parse/write/verify stages.
    const nativeVaultStages=detail.nativeVaultStages&&typeof detail.nativeVaultStages==='object'?Object.fromEntries(Object.entries(detail.nativeVaultStages).filter(([key,value])=>/^[A-Za-z]{1,48}$/.test(key)&&Number.isFinite(Number(value))).slice(0,32).map(([key,value])=>[key,Math.round(Number(value)*10)/10])):null;
    lastNativeAck=rememberTiming({kind:'native-ack',requestId:detail.requestId,action:detail.action,saveRevision:Number(detail.saveRevision)||0,generation:Number(detail.generation)||0,success:detail.success===true,bridgeDispatchMs:Number.isFinite(row.bridgeDispatchMs)?row.bridgeDispatchMs:null,nativeAckLatencyMs:Number.isFinite(row.dispatchedAt)?Math.max(0,ackAt-row.dispatchedAt):null,nativeVaultCommitMs:Number.isFinite(nativeVaultCommitMs)?Math.max(0,nativeVaultCommitMs):null,nativeVaultStages});
    clearTimeout(row.timer);pending.delete(detail.requestId);
    if(detail.success){generation=detail.generation;row.resolve({ok:true,native:true,...detail});}
    else{const e=new Error(detail.message||'native-save-nack');e.code='NATIVE_NACK';row.reject(e);}
    const statusDetail={...detail};delete statusDetail.nativeVaultCommitMs;delete statusDetail.nativeVaultStages;status({ok:detail.success,validated:true,...statusDetail});return true;
  }
  function saveHash(json,encoded=null){
    const text=String(json),owner=globalThis.GH_CONTROL_PLANE?.sha256;if(!owner)throw new Error('save-hash-owner-unavailable');
    const subtle=globalThis.crypto?.subtle;
    if(text.length>=262144&&subtle&&typeof TextEncoder!=='undefined'){
      try{return subtle.digest('SHA-256',encoded||new TextEncoder().encode(text)).then(digest=>[...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join(''),()=>owner(text));}catch(_error){}
    }
    return owner(text);
  }
  function requestNative(action,json,options={}){
    const bridge=bridgeFor(action);if(!bridge)return Promise.resolve({ok:true,native:false});
    if(pending.size>=PERSISTENCE_LIMITS.pending)return Promise.reject(new Error('native-save-backpressure'));
    let saveRevision=Number(options.saveRevision),resetEpoch=Number(options.resetEpoch);
    if(!Number.isSafeInteger(saveRevision)||saveRevision<0||!Number.isSafeInteger(resetEpoch)||resetEpoch<0){const state=parseState(json);assertState(state);saveRevision=Number(state.saveRevision)||0;resetEpoch=Number(state.resetEpoch)||0;}
    const post=saveHashValue=>{
      const envelope={action,requestId:`${action}-${Date.now()}-${++sequence}`,saveJSON:json,saveHash:saveHashValue,saveRevision,resetEpoch,saveSchemaVersion:options.saveSchemaVersion||SAVE_SCHEMA_VERSION,appVersion:options.appVersion||VERSION};
      if(options.transactionId)envelope.transactionId=String(options.transactionId).slice(0,120);
      if(options.idempotencyKey)envelope.idempotencyKey=String(options.idempotencyKey).slice(0,160);
      if(options.expectedPreviousRevision!=null)envelope.expectedPreviousRevision=Number(options.expectedPreviousRevision);
      if(options.clearManualSlots===true)envelope.clearManualSlots=true;
      return new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{pending.delete(envelope.requestId);const e=new Error('native-save-ack-timeout');e.code='ACK_TIMEOUT';reject(e);},options.timeoutMs||PERSISTENCE_LIMITS.ackTimeoutMs);
        const row={resolve,reject,timer,envelope,dispatchedAt:clock(),bridgeDispatchMs:null};pending.set(envelope.requestId,row);
        const dispatchStart=row.dispatchedAt;
        try{bridge.postMessage(envelope);row.bridgeDispatchMs=Math.max(0,clock()-dispatchStart);rememberTiming({kind:'bridge-dispatch',requestId:envelope.requestId,action,saveRevision,bridgeDispatchMs:row.bridgeDispatchMs});}
        catch(e){row.bridgeDispatchMs=Math.max(0,clock()-dispatchStart);clearTimeout(timer);pending.delete(envelope.requestId);reject(e);}
      });
    };
    try{const hashed=saveHash(json,options.encoded||null);return hashed&&typeof hashed.then==='function'?hashed.then(post):post(hashed);}catch(error){return Promise.reject(error);}
  }
  // Build 358 (save size): the same path carries the text chunks of sealed collections (document and authorization
  // proofs, idempotency receipts; GH_STATE_CODEC 'chunk-v1' markers). A save then sends only what changed through the
  // bridge: the 21 MB iPhone save of the diagnostic was ~20 MB of proofs written again by every commit.
  // Build 358 (million-asset save): with the native vault, the fleet record buffer is saved as 'chunks-v1' (one id per
  // 4 MiB store chunk, GH_STATE_CODEC.serializeChunked) instead of base64 in the JSON. serializeNative copies the bytes
  // of every chunk the vault has not acknowledged at the moment the save is taken (the simulation may write rows while
  // the upload runs, and a save must be one consistent instant), and uploadChunks sends them before the commit that
  // lists them. The vault refuses a commit whose chunks are missing; vaultChunks is cleared after any reset and any
  // such refusal, so the next save uploads again (an upload of a chunk the vault holds is checked and accepted).
  const vaultChunks=new Set(),chunkPending=new Map();let chunkSequence=0,lastCommittedChunkIds=null,vaultEpoch=0;
  const CHUNK_ACK_TIMEOUT_MS=60000;
  function noteVaultChunks(ids){for(const id of Array.isArray(ids)?ids:[])if(typeof id==='string'&&id)vaultChunks.add(id);}
  function forgetVaultChunks(){vaultChunks.clear();lastCommittedChunkIds=null;vaultEpoch++;}
  // Keep upload knowledge for the current and previous committed manifests, not every historic upload. Forgetting
  // an id never deletes a vault file: a manual slot/older world can safely reupload it if needed.
  function acknowledgeVaultChunks(save){
    if(!save?.chunked)return;const current=new Set(save.chunkIds),prior=lastCommittedChunkIds;
    for(const id of vaultChunks)if(!current.has(id)&&!prior?.has(id))vaultChunks.delete(id);
    lastCommittedChunkIds=current;
  }
  function chunkedNative(state){return !!bridgeFor('commitSave')&&typeof stateCodec()?.serializeChunked==='function'&&Object.prototype.toString.call(state?.fleet?.rows)==='[object ArrayBuffer]';}
  function copyChunkBytes(state,chunk){
    if(stateCodec()?.isPreparedChunk?.(chunk))return chunk.data;
    if(typeof chunk.text==='string')return utf8(chunk.text);
    if(ArrayBuffer.isView(chunk.data))return new Uint8Array(chunk.data.buffer,chunk.data.byteOffset,chunk.data.byteLength).slice();
    return new Uint8Array(state.fleet.rows,chunk.byteOffset,chunk.byteLength).slice();
  }
  function serializeNative(state){
    if(!chunkedNative(state))return {json:serializeState(state),uploads:[],chunked:false};
    const out=stateCodec().serializeChunked(state,{knownChunkIds:vaultChunks}),uploads=[];
    // Fleet chunks copy their bytes now (rows keep changing); a text chunk (a sealed collection's JSON) is immutable.
    for(const chunk of out.chunks)if(!vaultChunks.has(chunk.id))uploads.push({id:chunk.id,kind:chunk.kind,bytes:copyChunkBytes(state,chunk)});
    return {json:out.text,uploads,chunked:true,chunkIds:out.chunks.map(chunk=>chunk.id)};
  }
  // Build 358 (lighter commands): a durable command's save spread over frames. Serialization runs as codec steps and the
  // UTF-8 encoding in pieces; whenever a slice has run SLICE_MS the caller's frame scheduler (yieldToFrame) is awaited.
  // The command holds the lifecycle lock, so nothing writes the state meanwhile; if the fleet records changed anyway
  // (their revision moved), take one fresh snapshot in slices; a second change refuses the save. Large native fleets use a
  // separate checksum worker; its immutable chunk snapshots are the uploads. The bytes match serializeNative + utf8.
  const SLICE_MS=10;
  async function runSliced(steps,yieldToFrame,timing,checksumSession=null){
    let active=0,input,step,deferredAccounted=0;
    const accountDeferred=()=>{if(!checksumSession)return;const stats=checksumSession.stats(),extra=stats.deferredSubmitMs-deferredAccounted;timing.busyMs+=extra;deferredAccounted=stats.deferredSubmitMs;timing.maxBusySliceMs=Math.max(timing.maxBusySliceMs||0,stats.maxDeferredSubmitMs);};
    for(;;){
      accountDeferred();
      const start=clock();step=steps.next(input);input=undefined;const busy=clock()-start;active+=busy;timing.busyMs+=busy;
      timing.maxBusySliceMs=Math.max(timing.maxBusySliceMs||0,active);
      if(step.done)return step.value;
      if(step.value?.kind==='fleet-row-proof'){
        const provider=globalThis.GH_FLEET_QUERY_PROVIDER,asked=typeof provider==='function'?provider({fleet:step.value.store,simSeconds:0},'saveChunkProof',{index:step.value.index,totalByteLength:step.value.totalByteLength}):null;
        input=await asked;
        // Only a worker answer ends the UI task; an unavailable provider must keep the accumulated busy budget.
        if(asked&&typeof asked.then==='function'){timing.slices++;active=0;}
        if(active>=SLICE_MS){timing.slices++;await yieldToFrame();active=0;}continue;
      }
      if(step.value==='fleet-validation-wait'){timing.slices++;await yieldToFrame();active=0;continue;}
      if(step.value?.kind==='fleet-container-encode'){
        const provider=globalThis.GH_SAVE_CHUNK_ENCODING_PROVIDER;if(typeof provider!=='function')throw new Error('save-container-worker-unavailable');
        const submitted=clock(),pending=provider(step.value.bytes,step.value.stride,{transferOwnership:true}),submitMs=clock()-submitted;active+=submitMs;timing.busyMs+=submitMs;timing.maxBusySliceMs=Math.max(timing.maxBusySliceMs||0,active);
        input=await pending;accountDeferred();timing.containerWorkerMs=(timing.containerWorkerMs||0)+(Number(input?.workerMs)||0);timing.containerRequests=(timing.containerRequests||0)+1;
        if(input?.didYieldToWorker===true)active=0;
        if(active>=SLICE_MS){timing.slices++;await yieldToFrame();active=0;}continue;
      }
      if(step.value?.kind==='fleet-chunk-checksum'){
        if(typeof globalThis.GH_SAVE_CHECKSUM_PROVIDER!=='function')throw new Error('save-checksum-worker-unavailable');
        const submit=clock(),pending=checksumSession?checksumSession.take(step.value.bytes,step.value.nextBytes,step.value.transform,step.value.outputByteLength,step.value.nextTransform,step.value.nextOutputByteLength):globalThis.GH_SAVE_CHECKSUM_PROVIDER(step.value.bytes,step.value.transform,step.value.outputByteLength),submitMs=clock()-submit;
        active+=submitMs;timing.busyMs+=submitMs;timing.maxBusySliceMs=Math.max(timing.maxBusySliceMs||0,active);
        input=await pending;accountDeferred();timing.checksumWorkerMs=(timing.checksumWorkerMs||0)+(Number(input?.workerMs)||0);timing.checksumRequests=(timing.checksumRequests||0)+1;
        // A real worker reply already ended the preceding UI task. A ready prefetched answer does not: keep the
        // budget in that case, so a chain of immediately resolved promises cannot monopolize the main thread.
        if(input?.didYieldToWorker===true)active=0;
      }
      if(active>=SLICE_MS){timing.slices++;await yieldToFrame();active=0;}
    }
  }
  // validatedFleetRevision: the fleet revision the caller's validation saw. A write since (direct store writes are not
  // blocked by the lifecycle lock, and a chunk staging may overlap the validation) takes the same fresh, validated retake
  // as a write during serialization, so a save never lists rows newer than its proof.
  async function serializeNativeSliced(state,yieldToFrame,timing,{retake=true,validatedFleetRevision=null,knownChunkIds=vaultChunks,forceChunked=false}={}){
    const codec=stateCodec();if(!chunkedNative(state)&&!forceChunked)return typeof codec?.serializeSteps==='function'?{json:await runSliced(codec.serializeSteps(state),yieldToFrame,timing),uploads:[],chunked:false}:serializeNative(state);
    if(typeof codec.serializeChunkedSteps!=='function')return serializeNative(state);
    const externalChecksums=typeof globalThis.GH_SAVE_CHECKSUM_PROVIDER==='function'&&Number(state.fleet?.length)>FLEET_MAIN_THREAD_ROWS;let out;
    for(let attempt=0;;attempt++){
      const staleProof=attempt===0&&validatedFleetRevision!=null&&state.fleet?.revision!==validatedFleetRevision;
      const store=state.fleet,revision=store?.revision,buffer=store?.rows,session=externalChecksums&&typeof globalThis.GH_SAVE_CHECKSUM_THREAD?.createSession==='function'?globalThis.GH_SAVE_CHECKSUM_THREAD.createSession({current:()=>state.fleet===store&&store.revision===revision&&store.rows===buffer,submit:globalThis.GH_SAVE_CHECKSUM_PROVIDER}):null;
      try{
        if(staleProof)throw new Error('state-codec-fleet-changed-during-save');
        out=await runSliced(codec.serializeChunkedSteps(state,{externalChecksums,externalEncoding:externalChecksums&&typeof globalThis.GH_SAVE_CHUNK_ENCODING_PROVIDER==='function',knownChunkIds,allowRowPatches:globalThis.GH_NATIVE_ROW_PATCHES===1&&typeof globalThis.GH_FLEET_QUERY_PROVIDER==='function'}),yieldToFrame,timing,session);
        if(state.fleet?.revision!==revision)throw new Error('state-codec-fleet-changed-during-save');
        break;
      }catch(error){
        if(!retake||attempt!==0||error?.message!=='state-codec-fleet-changed-during-save')throw error;timing.retakes++;
        // A fresh snapshot also needs fresh validation; the old proof described the rows before the write.
        const schema=globalThis.GH_SAVE_SCHEMA,options={trustVerified:true,...fleetValidationOptions(state,{allowAsync:true})};
        const check=typeof schema?.validationSteps==='function'?await runSliced(schema.validationSteps(state,options),yieldToFrame,timing):schema?.validate?.(state,options);
        if(!check?.ok)throw new Error(`invalid-save:${(check?.errors||['save-schema-unavailable']).join(',')}`);
      }finally{await session?.close();}
    }
    const uploads=[];let uploadCopyStarted=clock();for(const chunk of out.chunks)if(!knownChunkIds.has(chunk.id)){
      if(externalChecksums&&['lane','lane-container'].includes(chunk.kind)&&!codec.isPreparedChunk?.(chunk))throw new Error('save-worker-snapshot-missing');
      let bytes;
      if(typeof chunk.text==='string'){const busy=clock()-uploadCopyStarted;timing.busyMs+=busy;timing.maxBusySliceMs=Math.max(timing.maxBusySliceMs||0,busy);bytes=await runSliced(utf8Steps(chunk.text,{chunk:true}),yieldToFrame,timing);uploadCopyStarted=clock();}
      else bytes=copyChunkBytes(state,chunk);
      uploads.push({id:chunk.id,kind:chunk.kind,bytes});
      if(clock()-uploadCopyStarted>=4){const busy=clock()-uploadCopyStarted;timing.busyMs+=busy;timing.maxBusySliceMs=Math.max(timing.maxBusySliceMs||0,busy);timing.slices++;await yieldToFrame();uploadCopyStarted=clock();}
    }
    {const busy=clock()-uploadCopyStarted;timing.busyMs+=busy;timing.maxBusySliceMs=Math.max(timing.maxBusySliceMs||0,busy);}
    return {json:out.text,uploads,chunked:true,chunkIds:out.chunks.map(chunk=>chunk.id)};
  }
  // Encode once in bounded pieces, then join into one exact-size buffer. Never split a surrogate pair.
  // The previous 3 * UTF-16-length buffer plus a full final slice could retain far more bytes than the save itself.
  function* utf8Steps(text,{chunk=false}={}){
    if(typeof TextEncoder==='undefined')return null;const encoder=new TextEncoder(),PIECE=1<<16;
    if(text.length<=PIECE)return encoder.encode(text);
    const parts=[];let read=0,total=0;
    while(read<text.length){let end=Math.min(text.length,read+PIECE);if(end<text.length){const code=text.charCodeAt(end-1);if(code>=0xD800&&code<=0xDBFF)end--;}const part=encoder.encode(text.slice(read,end));parts.push(part);total+=part.byteLength;read=end;yield;}
    // Envelope and chunk limits are distinct in the existing vault protocol (30 MiB / 64 MiB).
    if(chunk){if(total>64*1024*1024)throw new Error('save-chunk-too-large');}else inspectNativeJSON(text,{byteLength:total});
    const out=new Uint8Array(total);let written=0;
    for(let at=0;at<parts.length;at++){const part=parts[at];out.set(part,written);written+=part.byteLength;parts[at]=null;yield;}
    return out;
  }
  function receiveChunkAck(detail={}){
    const row=chunkPending.get(detail.requestId);if(!row)return false;
    clearTimeout(row.timer);chunkPending.delete(detail.requestId);
    if(detail.success===true&&detail.id===row.id)row.resolve();else{const error=new Error(detail.message||'native-chunk-nack');error.code='CHUNK_NACK';row.reject(error);}
    return true;
  }
  // Chunks travel as the raw bytes of a fetch POST to the game's own gh://app scheme (measured on CI WebKit: a 4 MiB
  // body arrives intact in ~34 ms, no base64 string). A runtime without that route answers 404 or rejects the request;
  // the chunk then goes as base64 over saveBridge ('storeSaveChunk'), which every native build understands.
  async function uploadChunk(id,bytes,kind=null){
    const rawBytes=bytes.byteLength;let wire=bytes,encoding='identity',workerMs=0;
    // Only a native host advertising the decoder receives compressed data. Existing IPAs keep the exact old route.
    // The existing worker owns the extra computation, on demand during a save; no gameplay scan or new worker/timer.
    if(kind==='lane'&&rawBytes>=32768&&rawBytes<=4194304&&globalThis.GH_NATIVE_CHUNK_ENCODINGS?.includes?.('gh-packbits-v1')&&typeof globalThis.GH_SAVE_CHUNK_ENCODING_PROVIDER==='function'){
      // 128 is an existing wire-codec stride accepted by every advertising
      // native host. It is independent of the lane's logical 8-byte records.
      const packed=await globalThis.GH_SAVE_CHUNK_ENCODING_PROVIDER(bytes,128,{transferOwnership:true});
      if(!packed||packed.rawBytes!==rawBytes||!ArrayBuffer.isView(packed.bytes)||packed.bytes.BYTES_PER_ELEMENT!==1||!(packed.encoding==='identity'&&packed.bytes.byteLength===rawBytes||packed.encoding==='gh-packbits-v1'&&packed.bytes.byteLength>=20&&packed.bytes.byteLength<=Math.floor(rawBytes*.875)))throw new Error('save-chunk-encoding-evidence-invalid');
      wire=packed.bytes;encoding=packed.encoding;workerMs=Number(packed.workerMs)||0;
    }
    const result={bytes:rawBytes,wireBytes:wire.byteLength,encoding,workerMs};
    if(typeof globalThis.fetch!=='function'||globalThis.location?.protocol!=='gh:'){await uploadChunkMessage(id,wire,{encoding,rawBytes});return result;}
    const headers=encoding==='identity'?undefined:{'X-GH-Chunk-Encoding':encoding,'X-GH-Chunk-Raw-Bytes':String(rawBytes)};
    await globalThis.fetch(`gh://app/save-chunk/${encodeURIComponent(id)}`,{method:'POST',body:wire,headers,cache:'no-store'}).then(async response=>{
      if(response.status===404||response.status===405)return uploadChunkMessage(id,wire,{encoding,rawBytes});
      let detail={};try{detail=await response.json();}catch{}
      if(!response.ok||detail.ok!==true||detail.id!==id){const error=new Error(detail.message||`native-chunk-http-${response.status}`);error.code='CHUNK_NACK';throw error;}
    },error=>{if(error?.code==='CHUNK_NACK')throw error;return uploadChunkMessage(id,wire,{encoding,rawBytes});});
    return result;
  }
  async function uploadChunkMessage(id,bytes,{encoding='identity',rawBytes=bytes.byteLength}={}){
    const bridge=bridgeFor('commitSave');if(!bridge)throw new Error('native-chunk-bridge-unavailable');
    // Keep the legacy bridge byte-identical, with bounded fleet-chunk encoding away from the UI thread.
    // Compact fleet overlay pages can be smaller than the old 256 KiB worker threshold while still being emitted in
    // bulk at day close; keep those conversions off the presentation thread too.
    const base64=bytes.byteLength>=32768&&bytes.byteLength<=4194304&&typeof globalThis.GH_SAVE_ENCODING_PROVIDER==='function'?await globalThis.GH_SAVE_ENCODING_PROVIDER(bytes):stateCodec().bytesToBase64(bytes);
    return new Promise((resolve,reject)=>{
      const requestId=`storeSaveChunk-${Date.now()}-${++chunkSequence}`,timer=setTimeout(()=>{chunkPending.delete(requestId);const error=new Error('native-chunk-ack-timeout');error.code='ACK_TIMEOUT';reject(error);},CHUNK_ACK_TIMEOUT_MS);
      chunkPending.set(requestId,{id,resolve,reject,timer});
      try{bridge.postMessage({action:'storeSaveChunk',requestId,id,bytes:rawBytes,base64,...(encoding==='identity'?{}:{encoding})});}
      catch(error){clearTimeout(timer);chunkPending.delete(requestId);reject(error);}
    });
  }
  async function uploadChunks(uploads){
    const started=clock();let bytes=0,wireBytes=0,encodingWorkerMs=0,compressedChunks=0;
    for(const upload of uploads||[]){if(vaultChunks.has(upload.id)){upload.bytes=null;continue;}const sent=await uploadChunk(upload.id,upload.bytes,upload.kind);vaultChunks.add(upload.id);bytes+=sent.bytes;wireBytes+=sent.wireBytes;encodingWorkerMs+=sent.workerMs;if(sent.encoding!=='identity')compressedChunks++;upload.bytes=null;}
    if(uploads?.length)rememberTiming({kind:'chunk-upload',chunks:uploads.length,bytes,wireBytes,encodingWorkerMs,compressedChunks,ms:Math.max(0,clock()-started)});
  }
  // A commit refused for a missing chunk means vaultChunks was stale: forget it so the next save uploads its chunks.
  function noteNativeRefusal(error){if(/Missing save chunk/i.test(String(error?.message||'')))forgetVaultChunks();return error;}
  // Build 362 follow-up (iPhone diagnostic DX-1792142505027, 980,000 assets): a player decision held the calendar ~3.9 s,
  // ~2.0 s waiting for the fleet worker's save validation and then ~1.4 s uploading ~127 MB of fleet chunks. A durable
  // command may upload its draft's chunks while that validation runs. Nothing is committed here: the vault stores a chunk
  // by id and keeps an unreferenced upload for 10 minutes (GlobalSaveVault.chunkGracePeriod); commitDurableState still
  // serializes the draft itself, lists what it lists, uploads whatever is missing, and the vault refuses a commit whose
  // chunks are absent. release() forgets the ids this staging uploaded that no committed manifest lists, so a later save
  // uploads them again rather than trusting a file the vault may have collected. Failures only lose the head start.
  function prestageDurableChunks(state,{yieldToFrame=null}={}){
    const staged=new Set(),epoch=vaultEpoch,started=clock(),timing={kind:'durable-prestage',ok:false,uploads:0,bytes:0,wireBytes:0,encodingWorkerMs:0,compressedChunks:0,busyMs:0,slices:0,retakes:0,wallMs:0,reason:null};let stopped=false;
    // A released staging stops at its next yield or upload: the command has ended and may have rolled the fleet back.
    const stopIfReleased=()=>{if(stopped)throw new Error('prestage-released');if(recoveryRequired||vaultEpoch!==epoch)throw new Error('prestage-vault-changed');};
    const applicable=typeof yieldToFrame==='function'&&!locked&&!durableLocked&&!recoveryRequired&&chunkedNative(state)&&Number(state?.fleet?.length)>FLEET_MAIN_THREAD_ROWS;
    if(!applicable)return null;
    const settled=(async()=>{
      try{
        // No retake: the command holds the lifecycle lock, so a fleet change here means the staging is stale; persist decides.
        const save=await serializeNativeSliced(state,async()=>{await yieldToFrame();stopIfReleased();},timing,{retake:false});
        for(const upload of save.uploads){
          if(vaultChunks.has(upload.id)){upload.bytes=null;continue;}
          stopIfReleased();
          const sent=await uploadChunk(upload.id,upload.bytes,upload.kind);upload.bytes=null;
          if(vaultEpoch!==epoch)throw new Error('prestage-vault-changed');
          vaultChunks.add(upload.id);staged.add(upload.id);timing.uploads++;timing.bytes+=sent.bytes;timing.wireBytes+=sent.wireBytes;timing.encodingWorkerMs+=sent.workerMs;if(sent.encoding!=='identity')timing.compressedChunks++;
        }
        timing.ok=true;
      }catch(error){timing.reason=String(error?.message||error).slice(0,160);}
      finally{timing.wallMs=Math.max(0,clock()-started);rememberTiming(timing);}
      return {ok:timing.ok,uploads:timing.uploads,bytes:timing.bytes,wallMs:timing.wallMs,reason:timing.reason};
    })();
    let released=null;
    return Object.freeze({settled,release(){
      stopped=true;
      if(!released)released=settled.then(()=>{if(vaultEpoch===epoch)for(const id of staged)if(!lastCommittedChunkIds?.has(id))vaultChunks.delete(id);staged.clear();});
      return released;
    }});
  }
  globalThis.addEventListener?.('gh-native-chunk-ack',e=>receiveChunkAck(e.detail));
  globalThis.addEventListener?.('gh-native-save-ack',e=>receiveAck(e.detail));
  globalThis.addEventListener?.('gh-native-reset-ack',e=>receiveAck(e.detail));
  function receiveSlotAck(detail={}){
    const row=slotPending.get(detail.requestId);if(!row)return false;
    if(detail.action!==row.action||Number(detail.index)!==row.index||typeof detail.success!=='boolean')return false;
    if(detail.success&&row.action==='loadManualSlot'&&(!Number.isSafeInteger(detail.generation)||detail.generation<=generation))return false;
    clearTimeout(row.timer);slotPending.delete(detail.requestId);
    if(detail.success){
      if(detail.metadata&&typeof detail.metadata==='object')nativeSlotMeta.set(row.index,clone(detail.metadata));
      if(row.action==='clearManualSlot')nativeSlotMeta.delete(row.index);
      if(row.action==='loadManualSlot'&&Number.isSafeInteger(detail.generation)&&detail.generation>generation)generation=detail.generation;
      row.resolve({ok:true,native:true,index:row.index,action:row.action,generation:detail.generation,meta:detail.metadata?clone(detail.metadata):(nativeSlotMeta.get(row.index)||null)});
    }else{const error=new Error(detail.message||'native-slot-nack');error.code='NATIVE_SLOT_NACK';row.reject(error);}
    return true;
  }
  globalThis.addEventListener?.('gh-native-slot-ack',e=>receiveSlotAck(e.detail));
  async function requestManualSlot(action,index,state=null,meta={},preparedSave=null){
    index=Number(index);if(!Number.isInteger(index)||index<0||index>2)return Promise.reject(new Error('invalid-save-slot'));
    const bridge=bridgeFor('commitSave');if(!bridge)return Promise.reject(new Error('native-slot-bridge-unavailable'));
    if(slotPending.size>=PERSISTENCE_LIMITS.pending)return Promise.reject(new Error('native-slot-backpressure'));
    const requestId=`${action}-${Date.now()}-${++slotSequence}`,envelope={action,requestId,index};let nativeSave=null;
    if(action==='saveManualSlot'){
      if(!preparedSave)assertRecurringState(state);nativeSave=preparedSave||serializeNative(state);const json=nativeSave.json,measurement=inspectNativeJSON(json),saveRevision=Number(state.saveRevision)||0,resetEpoch=Number(state.resetEpoch)||0,schemaVersion=saveSchemaVersion(state),hash=await saveHash(json);
      Object.assign(envelope,{saveJSON:json,saveHash:hash,saveRevision,resetEpoch,saveSchemaVersion:schemaVersion,appVersion:meta.appVersion||VERSION,label:String(meta.label||'').slice(0,120)});
      envelope.measurement=measurement;
    }
    return uploadChunks(nativeSave?.uploads).then(()=>new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{slotPending.delete(requestId);const error=new Error('native-slot-ack-timeout');error.code='ACK_TIMEOUT';reject(error);},meta.timeoutMs||PERSISTENCE_LIMITS.ackTimeoutMs);
      slotPending.set(requestId,{resolve,reject,timer,action,index});
      try{bridge.postMessage(envelope);}catch(error){clearTimeout(timer);slotPending.delete(requestId);reject(error);}
    })).catch(error=>{throw noteNativeRefusal(error);});
  }
  function ordinarySnapshotOptions(storageKey,appVersion,options){return {storageKey,appVersion,...options};}
  function clearOrdinaryDirty(){ordinaryDirty=false;ordinaryDirtyState=null;ordinaryDirtyOptions=null;}
  function deferOrdinary(state,options){ordinaryDirty=true;ordinaryDirtyState=state;ordinaryDirtyOptions=options;status({ok:true,deferred:true,reason:'native-save-coalesced',saveRevision:Number(state?.saveRevision)||0});}
  function beginOrdinary(state,{storageKey='global-holdings-world-v3.0.0',appVersion=VERSION,...options}={},control={}){
    if((locked&&!control.allowLocked)||durableLocked)return {ok:false,reason:'lifecycle-locked'};
    if(recoveryRequired)return {ok:false,reason:'memory-recovery-required'};
    const nativeBridge=!!bridgeFor('commitSave'),previousRevision=Math.max(0,Math.floor(Number(state?.saveRevision)||0)),nextRevision=previousRevision+1,syncStart=clock();
    const timing={kind:'ordinary-save',saveRevision:nextRevision,nativeBridge,schemaMs:0,stringifyMs:0,measurementMs:0,browserCacheMs:0,totalSyncMs:0,utf8Bytes:null,cacheReason:null,ok:false};
    let json,measurement,resetEpoch,cache=null,encoded=null,nativeSave=null,changeToken=null;
    try{
      if(!state||typeof state!=='object')throw new Error('state-required');
      state.saveRevision=nextRevision;
      let stageStart=clock();assertRecurringState(state);timing.schemaMs=Math.max(0,clock()-stageStart);
      stageStart=clock();changeToken=captureSaveChanges(state);nativeSave=nativeBridge?serializeNative(state):null;json=nativeSave?nativeSave.json:serializeState(state);timing.stringifyMs=Math.max(0,clock()-stageStart);timing.chunkUploads=nativeSave?.uploads.length||0;resetEpoch=Number(state.resetEpoch)||0;
      stageStart=clock();encoded=nativeBridge?utf8(json):null;measurement=nativeBridge?inspectNativeJSON(json,encoded):inspectJSON(json,storageKey,options);timing.measurementMs=Math.max(0,clock()-stageStart);timing.utf8Bytes=measurement.utf8Bytes;
      stageStart=clock();
      if(nativeBridge){
        // A chunked save is not self-contained (its records live in the vault), so it is never mirrored to WebStorage.
        cache=nativeSave?.chunked?{ok:false,reason:'chunked-native-save',previous:null,bypassed:true}:(measurement.utf8Bytes>PERSISTENCE_LIMITS.hardBytes||measurement.storageBytes>PERSISTENCE_LIMITS.hardBytes)?{ok:false,reason:'browser-cache-size-bypass',previous:null,bypassed:true}:writeJSON(storageKey,json,{...options,mirror:true},encoded);
        if(!cache.ok&&!nativeSave?.chunked)status({ok:true,warning:true,reason:'browser-cache-skipped',cacheReason:cache.reason,utf8Bytes:measurement.utf8Bytes,mirror:true});
        if(measurement.utf8Bytes>=PERSISTENCE_LIMITS.nativeSoftBytes)status({ok:true,warning:true,reason:'native-save-size-soft-warning',utf8Bytes:measurement.utf8Bytes,nativeHardBytes:PERSISTENCE_LIMITS.nativeHardBytes});
      }else{
        cache=writeJSON(storageKey,json,options);if(!cache.ok)throw Object.assign(new Error(cache.reason),{measurement:cache});
      }
      timing.browserCacheMs=Math.max(0,clock()-stageStart);timing.cacheReason=cache?.ok===false?cache.reason:null;timing.ok=true;timing.totalSyncMs=Math.max(0,clock()-syncStart);globalThis.GH_DIAGNOSTICS?.recordMainThreadWork?.(state,'save.prepare',syncStart,clock());lastSaveBreakdown=rememberTiming(timing);lastSaveAtMs=clock();
    }catch(error){state.saveRevision=previousRevision;timing.totalSyncMs=Math.max(0,clock()-syncStart);timing.error=String(error.message||error);lastSaveBreakdown=rememberTiming(timing);return {ok:false,reason:`serialization-or-schema:${error.message||error}`,...error.measurement};}
    const out={ok:true,json,...measurement,browserCache:cache?.ok!==false,cacheReason:cache?.ok===false?cache.reason:null,previous:cache?.previous??null,saveRevision:nextRevision};
    if(!nativeBridge){ordinaryError=null;acknowledgeSaveChanges(state,changeToken);return out;}
    const nativeMetadata={appVersion,...options,saveRevision:nextRevision,resetEpoch,saveSchemaVersion:saveSchemaVersion(state)};
    const work=Promise.resolve().then(()=>{if(recoveryRequired)throw new Error('native-recovery-required');return uploadChunks(nativeSave?.uploads);}).then(()=>requestNative('commitSave',json,{...nativeMetadata,encoded})).catch(error=>{throw noteNativeRefusal(error);});
    ordinaryInFlight=work.then(ack=>{ordinaryError=null;acknowledgeVaultChunks(nativeSave);acknowledgeSaveChanges(state,changeToken);return ack;},error=>{
      ordinaryError=error;
      if(cache?.ok)try{if(localStorage.getItem(storageKey)===json)restoreRaw(storageKey,cache.previous);}catch(e){error.rollbackError=String(e.message||e);}
      const uncertainNative=error.code==='ACK_TIMEOUT';recoveryRequired=true;status({ok:false,reason:error.message,critical:!!error.rollbackError,requiresMemoryRollback:false,requiresNativeReconciliation:true,storageKey});return {ok:false,reason:error.message,uncertainNative};
    }).finally(()=>{
      ordinaryInFlight=null;
      if(!recoveryRequired&&!locked&&!durableLocked&&ordinaryDirty){const dirtyState=ordinaryDirtyState,dirtyOptions=ordinaryDirtyOptions;clearOrdinaryDirty();beginOrdinary(dirtyState,dirtyOptions);}
    });
    out.native=ordinaryInFlight;return out;
  }
  async function waitOrdinaryIdle({supersedeDirty=false,allowLockedFlush=false}={}){
    while(true){
      if(ordinaryInFlight){const result=await ordinaryInFlight;if(result?.ok===false&&ordinaryError)throw ordinaryError;continue;}
      if(ordinaryError)throw ordinaryError;
      if(supersedeDirty){clearOrdinaryDirty();return {ok:true,generation,superseded:true};}
      if(ordinaryDirty){if((locked&&!allowLockedFlush)||durableLocked||recoveryRequired)break;const dirtyState=ordinaryDirtyState,dirtyOptions=ordinaryDirtyOptions;clearOrdinaryDirty();const out=beginOrdinary(dirtyState,dirtyOptions,{allowLocked:allowLockedFlush});if(!out.ok)throw new Error(out.reason);continue;}
      break;
    }
    return {ok:true,generation};
  }
  function commitState(state,{storageKey='global-holdings-world-v3.0.0',appVersion=VERSION,...options}={}){
    // A save in slices is running: this one joins it (it runs once more after, with the state then).
    if(slicedSave){const task=slicedSave,done=task.kind&&task.kind!=='ordinary'?queueAfterSnapshot(state,{storageKey,appVersion,...options}):(task.again=true,task.done);return {ok:true,deferred:true,coalesced:true,saveRevision:Number(state?.saveRevision)||0,native:done};}
    if(locked||durableLocked)return {ok:false,reason:'lifecycle-locked'};
    if(recoveryRequired)return {ok:false,reason:'memory-recovery-required'};
    const snapshotOptions=ordinarySnapshotOptions(storageKey,appVersion,options),nativeBridge=!!bridgeFor('commitSave');
    if(nativeBridge&&ordinaryInFlight){deferOrdinary(state,snapshotOptions);return {ok:true,deferred:true,coalesced:true,saveRevision:Number(state.saveRevision)||0,native:waitOrdinaryIdle().then(()=>({ok:true,deferred:true,coalesced:true}),error=>({ok:false,reason:String(error.message||error)}))};}
    return beginOrdinary(state,snapshotOptions);
  }
  async function drain(options={}){return waitOrdinaryIdle(options);}
  async function commitDurableState(state,{storageKey='global-holdings-world-v3.0.0',appVersion=VERSION,yieldToFrame=null,...options}={}){
    if(locked||durableLocked||(slicedLocked&&options[SLICED_COMMIT]!==true))throw new Error('lifecycle-locked');if(recoveryRequired)throw new Error('memory-recovery-required');
    if(options.expectedPreviousRevision!=null){const previous=Number(options.expectedPreviousRevision),next=Number(state?.saveRevision);if(!Number.isSafeInteger(previous)||previous<0||!Number.isSafeInteger(next)||next!==previous+1)throw new Error(`save-revision-conflict:${previous}:${next}`);}
    durableLocked=true;
    let written=null;
    try{
      await waitOrdinaryIdle({supersedeDirty:true});
      const durableTiming={kind:'durable-save',saveRevision:Number(state?.saveRevision)||0,schemaMs:0,stringifyMs:0,measurementMs:0,totalSyncMs:0,utf8Bytes:null,ok:false};let stageStart=clock();const syncStart=stageStart;
      assertRecurringState(state,{prevalidated:options.prevalidated===true});durableTiming.schemaMs=Math.max(0,clock()-stageStart);stageStart=clock();const changeToken=captureSaveChanges(state),nativeBridge=!!bridgeFor('commitSave'),sliced=nativeBridge&&typeof yieldToFrame==='function'?{busyMs:0,slices:0,retakes:0}:null,nativeSave=nativeBridge?(sliced?await serializeNativeSliced(state,yieldToFrame,sliced,{validatedFleetRevision:Number.isSafeInteger(options.validatedFleetRevision)?options.validatedFleetRevision:null}):serializeNative(state)):null,json=nativeSave?nativeSave.json:serializeState(state);durableTiming.stringifyMs=sliced?sliced.busyMs:Math.max(0,clock()-stageStart);durableTiming.chunkUploads=nativeSave?.uploads.length||0;lastSaveAtMs=clock();
      if(nativeBridge){
        stageStart=clock();const encodeBusy=sliced?sliced.busyMs:0,encoded=sliced?await runSliced(utf8Steps(json),yieldToFrame,sliced):utf8(json),measurement=inspectNativeJSON(json,encoded);durableTiming.measurementMs=sliced?sliced.busyMs-encodeBusy:Math.max(0,clock()-stageStart);durableTiming.utf8Bytes=measurement.utf8Bytes;durableTiming.totalSyncMs=sliced?durableTiming.schemaMs+sliced.busyMs:Math.max(0,clock()-syncStart);if(sliced){durableTiming.slices=sliced.slices;durableTiming.maxBusySliceMs=sliced.maxBusySliceMs||0;durableTiming.checksumRequests=sliced.checksumRequests||0;durableTiming.checksumWorkerMs=sliced.checksumWorkerMs||0;durableTiming.retakes=sliced.retakes;durableTiming.wallMs=Math.max(0,clock()-syncStart);}durableTiming.ok=true;rememberTiming(durableTiming);let ack;try{await uploadChunks(nativeSave?.uploads);ack=await requestNative('commitSave',json,{appVersion,...options,saveRevision:Number(state.saveRevision)||0,resetEpoch:Number(state.resetEpoch)||0,saveSchemaVersion:saveSchemaVersion(state),encoded});}catch(error){throw noteNativeRefusal(error);}ordinaryError=null;
        const cache=nativeSave?.chunked?{ok:false,reason:'chunked-native-save',previous:null,bypassed:true}:(measurement.utf8Bytes>PERSISTENCE_LIMITS.hardBytes||measurement.storageBytes>PERSISTENCE_LIMITS.hardBytes)?{ok:false,reason:'browser-cache-size-bypass',previous:null,bypassed:true}:writeJSON(storageKey,json,{...options,mirror:true},encoded);
        if(!cache.ok&&!nativeSave?.chunked)status({ok:true,warning:true,reason:'browser-cache-skipped',cacheReason:cache.reason,durable:true,utf8Bytes:measurement.utf8Bytes,mirror:true});
        acknowledgeVaultChunks(nativeSave);acknowledgeSaveChanges(state,changeToken);telemetry({operation:'durable-commit',ok:true,utf8Bytes:measurement.utf8Bytes,native:true,browserCache:cache.ok,durationMs:0});status({ok:true,validated:true,durable:true,native:true,saveRevision:Number(state.saveRevision)||0});return {ok:true,json,...measurement,ack,durable:true,browserCache:cache.ok,cacheReason:cache.ok?null:cache.reason};
      }
      written=writeJSON(storageKey,json,options);if(!written.ok)throw new Error(written.reason);
      const ack=await requestNative('commitSave',json,{appVersion,...options,saveRevision:Number(state.saveRevision)||0,resetEpoch:Number(state.resetEpoch)||0,saveSchemaVersion:saveSchemaVersion(state)});ordinaryError=null;
      acknowledgeSaveChanges(state,changeToken);telemetry({operation:'durable-commit',ok:true,utf8Bytes:written.utf8Bytes,native:false,durationMs:0});status({ok:true,validated:true,durable:true,native:false,saveRevision:Number(state.saveRevision)||0});return {...written,ack,durable:true};
    }catch(error){
      if(written?.ok)try{if(localStorage.getItem(storageKey)===written.json)restoreRaw(storageKey,written.previous);}catch(rollbackError){error.rollbackError=String(rollbackError.message||rollbackError);}
      const uncertainNative=error.code==='ACK_TIMEOUT';if(error.rollbackError||uncertainNative){recoveryRequired=true;error.critical=true;}status({ok:false,reason:String(error.message||error),critical:!!error.critical,durable:true,requiresNativeReconciliation:uncertainNative,storageKey});throw error;
    }finally{durableLocked=false;}
  }
  // Build 359 (the ordinary save was one block of 80-200 ms: schema, serialization and encoding at once): a save of a
  // copy of the state (cheap: the fleet store and sealed collections are shared), its schema validated in sections and
  // its text serialized and encoded in slices, with the caller's frame scheduler (yieldToFrame) between them. From the
  // copy to the commit persistence is locked (isLocked: the simulation and player commands wait, slicedSettled), so the
  // copy and the fleet records are one instant. A save asked meanwhile (this or commitState) runs once more after it.
  // `prepare(state)` runs first on the live state and may refuse ({ok:false,reason}).
  let slicedSave=null,slicedLocked=false;const SLICED_COMMIT=Symbol('sliced-commit');
  async function sliceOnce(state,{storageKey,appVersion,yieldToFrame,prepare}){
    if(locked||durableLocked)return {ok:false,reason:'lifecycle-locked'};if(recoveryRequired)return {ok:false,reason:'memory-recovery-required'};
    const timing={kind:'sliced-save',cloneMs:0,validateMs:0,totalMs:0,ok:false},started=clock();slicedLocked=true;
    try{
      const ready=typeof prepare==='function'?prepare(state):null;if(ready&&ready.ok===false)return {ok:false,reason:ready.reason||'prepare-refused'};
      const changeToken=captureSaveChanges(state);let stage=clock();const previous=Math.max(0,Math.floor(Number(state.saveRevision)||0)),tx=globalThis.GH_TRANSACTION_CORE;timing.cloneBusyMs=0;timing.cloneMaxSliceMs=0;timing.cloneYields=0;const onSlice=(start,end)=>{const busy=Math.max(0,end-start);timing.cloneBusyMs+=busy;timing.cloneMaxSliceMs=Math.max(timing.cloneMaxSliceMs,busy);globalThis.GH_DIAGNOSTICS?.recordMainThreadWork?.(state,'save.clone',start,end);},copy=tx.deepCloneInSlices?await tx.deepCloneInSlices(state,{shareJournaledRoots:true,yieldToHost:async()=>{timing.cloneYields++;await yieldToFrame();},onSlice}):tx.deepClone(state,{shareJournaledRoots:true});copy.saveRevision=previous+1;globalThis.GH_SAVE_SCHEMA?.inheritVerified?.(state,copy);timing.cloneMs=clock()-stage;
      await yieldToFrame();stage=clock();
      // No chunk staging here: a fleet write during this validation must take the retake below, not refuse the save.
      const validatedFleetRevision=copy.fleet?.revision;
      const schema=globalThis.GH_SAVE_SCHEMA;let check;
      const validationOptions={trustVerified:true,...fleetValidationOptions(copy,{allowAsync:true})};
      if(typeof schema?.validationSteps==='function'){const steps=schema.validationSteps(copy,validationOptions);let slice=clock(),step;while(!(step=steps.next()).done){if(step.value==='fleet-validation-wait'){await yieldToFrame();slice=clock();}else if(clock()-slice>=SLICE_MS){await yieldToFrame();slice=clock();}}check=step.value;}
      else check=schema?.validate?.(copy,validationOptions)||{ok:true};
      timing.validateMs=clock()-stage;if(check&&check.ok===false)return {ok:false,reason:`invalid-state:${(check.errors||[]).join(',')}`};
      const out=await commitDurableState(copy,{storageKey,appVersion,prevalidated:true,expectedPreviousRevision:previous,yieldToFrame,validatedFleetRevision,[SLICED_COMMIT]:true});
      if(Number(state.saveRevision)===previous){state.saveRevision=copy.saveRevision;acknowledgeSaveChanges(state,changeToken);}
      timing.ok=true;return {...out,ok:true,saveRevision:copy.saveRevision,timing};
    }catch(error){return {ok:false,reason:String(error?.message||error),critical:!!error?.critical,timing};}
    finally{slicedLocked=false;timing.totalMs=clock()-started;rememberTiming(timing);}
  }
  function commitStateSliced(state,{storageKey='global-holdings-world-v3.0.0',appVersion=VERSION,yieldToFrame=()=>new Promise(resolve=>setTimeout(resolve,0)),prepare=null}={}){
    if(slicedSave){if(slicedSave.kind&&slicedSave.kind!=='ordinary')return queueAfterSnapshot(state,{storageKey,appVersion,yieldToFrame,prepare});slicedSave.again=true;return slicedSave.done;}
    if(locked||durableLocked)return Promise.resolve({ok:false,reason:'lifecycle-locked'});if(recoveryRequired)return Promise.resolve({ok:false,reason:'memory-recovery-required'});
    const run=slicedSave={kind:'ordinary',again:false,done:null};
    run.done=(async()=>{let out;try{do{run.again=false;out=await sliceOnce(state,{storageKey,appVersion,yieldToFrame,prepare});}while(run.again&&out.ok);}finally{slicedSave=null;}return out;})();
    return run.done;
  }
  function largeSnapshot(state){
    if(!state?.fleet?.rows)return false;
    if(Number(state.fleet.length)>FLEET_MAIN_THREAD_ROWS||Number(lastSaveBreakdown?.utf8Bytes)>=262144||String(globalThis.__GH_NATIVE_SAVE_JSON__||'').length>=262144)return true;
    const finance=state.finance;let rows=0;for(const key of ['invoices','cheques','transfers','payrollReports','periods','journalEntries'])rows+=Array.isArray(finance?.[key])?finance[key].length:0;
    return rows>512;
  }
  function queueAfterSnapshot(state,options){
    const task=slicedSave;task.followState=state;task.followOptions=options;
    if(!task.ordinaryAfter)task.ordinaryAfter=task.done.then(()=>commitStateSliced(task.followState,task.followOptions));
    return task.ordinaryAfter;
  }
  async function validatedSnapshot(state,meta,timing){
    const yieldToFrame=meta.yieldToFrame||(()=>new Promise(resolve=>setTimeout(resolve,0))),tx=globalThis.GH_TRANSACTION_CORE,schema=globalThis.GH_SAVE_SCHEMA;
    if(typeof tx?.deepCloneInSlices!=='function'||typeof schema?.validationSteps!=='function')throw new Error('snapshot-sliced-owner-unavailable');
    const ready=typeof meta.prepare==='function'?meta.prepare(state):null;if(ready?.ok===false)throw new Error(ready.reason||'prepare-refused');
    const store=state.fleet,rows=store?.rows,values=store?.values,revision=store?.revision,saveRevision=state.saveRevision,valueRevision=store?globalThis.GH_FLEET_STORE?.valueRevision?.(store):null;
    const fresh=()=>state.fleet===store&&store?.rows===rows&&store?.values===values&&store?.revision===revision&&(store?globalThis.GH_FLEET_STORE?.valueRevision?.(store):null)===valueRevision&&state.saveRevision===saveRevision;
    let at=clock();timing.cloneBusyMs=0;timing.cloneMaxSliceMs=0;timing.cloneYields=0;
    const copy=await tx.deepCloneInSlices(state,{shareJournaledRoots:true,yieldToHost:async()=>{timing.cloneYields++;await yieldToFrame();},onSlice:(start,end)=>{const busy=end-start;timing.cloneBusyMs+=busy;timing.cloneMaxSliceMs=Math.max(timing.cloneMaxSliceMs,busy);}});timing.cloneMs=clock()-at;
    if(!fresh())throw new Error('snapshot-source-changed');
    // An explicit backup/slot retains the full validation contract. No second synchronous validator follows it.
    at=clock();let validationOptions=fleetValidationOptions(copy,{allowAsync:true});if(validationOptions.requireFleetValidation===false)validationOptions=fleetValidationOptions(copy,{allowAsync:false});const check=await runSliced(schema.validationSteps(copy,validationOptions),yieldToFrame,timing);timing.validateMs=clock()-at;
    if(!check?.ok)throw new Error(`invalid-state:${(check?.errors||['save-schema-unavailable']).join(',')}`);
    if(!fresh())throw new Error('snapshot-source-changed');
    return {copy,yieldToFrame,fresh,validatedFleetRevision:copy.fleet?.revision};
  }
  function snapshotOperation(kind,state,meta,operation){
    if(slicedSave)return slicedSettled().then(()=>snapshotOperation(kind,state,meta,operation));
    if(locked||durableLocked||recoveryRequired)return Promise.resolve({ok:false,reason:recoveryRequired?'memory-recovery-required':'lifecycle-locked'});
    const task=slicedSave={kind,again:false,done:null},timing={kind,ok:false,busyMs:0,slices:0,retakes:0},started=clock();slicedLocked=true;
    task.done=(async()=>{try{if(ordinaryInFlight||ordinaryDirty||ordinaryError)await drain({allowLockedFlush:true});const snapshot=await validatedSnapshot(state,meta,timing);const out=await operation(snapshot,timing);timing.ok=out?.ok===true;return out;}catch(error){return {ok:false,reason:String(error?.message||error)};}finally{slicedLocked=false;if(slicedSave===task)slicedSave=null;timing.totalMs=clock()-started;rememberTiming(timing);}})();
    return task.done;
  }
  function saveSlotSliced(index,state,meta){
    return snapshotOperation('manual-slot-snapshot',state,meta,async({copy,yieldToFrame,fresh,validatedFleetRevision},timing)=>{
      const nativeSave=await serializeNativeSliced(copy,yieldToFrame,timing,{retake:false,validatedFleetRevision});if(!fresh())throw new Error('snapshot-source-changed');
      const before=new Set(vaultChunks);try{return await requestManualSlot('saveManualSlot',index,copy,meta,nativeSave);}catch(error){for(const id of vaultChunks)if(!before.has(id)&&!lastCommittedChunkIds?.has(id))vaultChunks.delete(id);throw error;}
    });
  }
  // Resolves once no save in slices runs (a command or the background save waits for it instead of being refused).
  async function slicedSettled(){while(slicedSave)await slicedSave.done;}
  function recoverBrowserState(storageKey='global-holdings-world-v3.0.0'){
    if(bridgeFor('commitSave'))return {ok:false,reason:'native-vault-reconciliation-required'};
    try{const raw=localStorage.getItem(storageKey);if(!raw)return {ok:false,reason:'missing-durable-state'};const state=parseState(raw);assertState(state);return {ok:true,state};}catch(error){return {ok:false,reason:String(error.message||error)};}
  }
  function markRecoveryRequired(reason='manual-recovery-required',evidence={}){recoveryRequired=true;ordinaryError=ordinaryError||new Error(String(reason));status({ok:false,critical:true,reason:String(reason),requiresNativeReconciliation:!!bridgeFor('commitSave'),...evidence});return true;}
  function acknowledgeRecovery(){if(bridgeFor('commitSave')&&recoveryRequired)return false;recoveryRequired=false;ordinaryError=null;return true;}
  async function replaceState(next,previous,{storageKey='global-holdings-world-v3.0.0',resetMarkerKey,appVersion=VERSION,timeoutMs,apply,cleanupKeys=[],clearManualSlots=false,yieldToFrame=()=>new Promise(resolve=>setTimeout(resolve,0))}={}){
    if(locked||durableLocked||slicedLocked)throw new Error('lifecycle-locked');locked=true;
    let nativeAttempted=false,nativeCommitted=false,oldRaw=null,oldMarker=null,browserTouched=false;
    let oldJSON,oldNative=null;
    try{
      await drain({allowLockedFlush:true});const nativeBridge=!!bridgeFor('resetGameSave');let nextNative=null;
      if(nativeBridge&&(largeSnapshot(previous)||largeSnapshot(next))){
        const timing={kind:'reset-snapshots',ok:false,busyMs:0,slices:0,retakes:0},started=clock();
        try{const before=await validatedSnapshot(previous,{yieldToFrame},timing);oldNative=await serializeNativeSliced(before.copy,yieldToFrame,timing,{retake:false,validatedFleetRevision:before.validatedFleetRevision});if(!before.fresh())throw new Error('snapshot-source-changed');const after=await validatedSnapshot(next,{yieldToFrame},timing);nextNative=await serializeNativeSliced(after.copy,yieldToFrame,timing,{retake:false,validatedFleetRevision:after.validatedFleetRevision});if(!before.fresh()||!after.fresh())throw new Error('snapshot-source-changed');timing.ok=true;}finally{timing.totalMs=clock()-started;rememberTiming(timing);}
      }else{assertState(next);assertState(previous);oldNative=nativeBridge?serializeNative(previous):null;nextNative=nativeBridge?serializeNative(next):null;}
      oldJSON=oldNative?oldNative.json:serializeState(previous);
      const json=nextNative?nextNative.json:serializeState(next),nativeMeasurement=nativeBridge?inspectNativeJSON(json):null;if(!nativeBridge)inspectJSON(json,storageKey);oldRaw=localStorage.getItem(storageKey);oldMarker=resetMarkerKey?localStorage.getItem(resetMarkerKey):null;
      // The current in-memory game is the compensating checkpoint. Native owns durability. Both worlds' chunks are in
      // the vault before the reset, so the compensation below can always be committed.
      if(nativeBridge){await uploadChunks(oldNative.uploads);await uploadChunks(nextNative.uploads);}
      nativeAttempted=nativeBridge;
      await requestNative('resetGameSave',json,{appVersion,timeoutMs,clearManualSlots,saveRevision:Number(next.saveRevision)||0,resetEpoch:Number(next.resetEpoch)||0,saveSchemaVersion:saveSchemaVersion(next)});
      nativeCommitted=nativeBridge;
      const out=nextNative?.chunked?{ok:false,reason:'chunked-native-save',previous:null,bypassed:true}
        :(nativeBridge&&(nativeMeasurement.utf8Bytes>PERSISTENCE_LIMITS.hardBytes||nativeMeasurement.storageBytes>PERSISTENCE_LIMITS.hardBytes))
        ? {ok:false,reason:'browser-cache-size-bypass',previous:null,bypassed:true}
        : writeJSON(storageKey,json,{mirror:nativeBridge});
      if(out.ok)browserTouched=true;
      else if(!nativeBridge){const writeError=new Error(out.reason);writeError.rollbackError=out.rollbackError;throw writeError;}
      else if(!nextNative?.chunked)status({ok:true,warning:true,reason:'browser-cache-skipped',cacheReason:out.reason,reset:true,mirror:true});
      if(resetMarkerKey){
        try{localStorage.setItem(resetMarkerKey,String(next.resetEpoch||0));if(localStorage.getItem(resetMarkerKey)!==String(next.resetEpoch||0))throw new Error('reset-marker-verification');}
        catch(markerError){if(!nativeBridge)throw markerError;status({ok:true,warning:true,reason:'reset-marker-cache-skipped',message:String(markerError.message||markerError),mirror:true});}
      }
      if(apply)apply(next);
      for(const key of cleanupKeys)if(key!==storageKey&&key!==resetMarkerKey)try{localStorage.removeItem(key);}catch{}
      ordinaryError=null;clearOrdinaryDirty();return {ok:true,native:nativeAttempted,generation};
    }catch(error){
      try{if(browserTouched)restoreRaw(storageKey,oldRaw);if(resetMarkerKey&&browserTouched)restoreRaw(resetMarkerKey,oldMarker);}catch(e){error.rollbackError=String(e.message||e);}
      // Once a New Game reset that clears manual slots has been ACKed by Native,
      // the durable transaction is committed. Rolling only the main save back here
      // would resurrect an old world without its manual slots. Reload from the
      // freshly refreshed Native bootstrap instead of attempting a partial rollback.
      if(nativeCommitted&&clearManualSlots){
        recoveryRequired=true;error.critical=true;error.requiresNativeReload=true;
        status({ok:false,critical:true,reason:'native-reset-committed-reload-required',requiresNativeReconciliation:true,storageKey});
        throw error;
      }
      if(nativeAttempted)try{await requestNative('resetGameSave',oldJSON,{appVersion,timeoutMs,clearManualSlots:false,saveRevision:Number(previous.saveRevision)||0,resetEpoch:Number(previous.resetEpoch)||0,saveSchemaVersion:saveSchemaVersion(previous)});}catch(e){error.compensationError=String(e.message||e);}
      if(error.rollbackError||error.compensationError){error.critical=true;globalThis.GH_CONTROL_PLANE?.incident?.(previous,{fingerprint:'RESET_COMPENSATION_FAILED',code:'RESET_COMPENSATION_FAILED',severity:'critical',domain:'save',title:'فشل استرداد الحفظ بعد عملية الاستبدال',detail:String(error.compensationError||error.rollbackError)});}
      throw error;
    }finally{locked=false;forgetVaultChunks();}
  }
  function parseSlot(raw){if(!raw)return {ok:false,reason:'empty'};try{const p=JSON.parse(raw),state=decodeTree(p?.format===SLOT_FORMAT?p.state:p);assertState(state);return {ok:true,state,meta:p?.format===SLOT_FORMAT?p.meta||{}:{legacy:true}};}catch(e){return {ok:false,reason:'invalid-save',error:String(e.message||e)};}}
  function slotStatus(index){
    try{
      index=Number(index);if(!Number.isInteger(index)||index<0||index>2)throw new Error('invalid-save-slot');
      if(bridgeFor('commitSave')){const meta=nativeSlotMeta.get(index);return meta?{exists:true,meta:clone(meta),native:true}:{exists:false,reason:'empty',native:true};}
      const p=parseSlot(localStorage.getItem(slotKey(index)));return p.ok?{exists:true,meta:p.meta}:{exists:false,reason:p.reason};
    }catch(e){return {exists:false,reason:'storage-error'};}
  }
  function saveSlot(index,state,meta={}){
    try{
      const day=Math.floor((Number(state.simSeconds)||0)/86400)+1,label=meta.label||`اليوم ${day}`;
      if(bridgeFor('commitSave')&&largeSnapshot(state)){slotKey(index);return saveSlotSliced(Number(index),state,{...meta,label});}
      assertState(state);
      if(bridgeFor('commitSave'))return requestManualSlot('saveManualSlot',index,state,{...meta,label}).catch(error=>({ok:false,reason:String(error.message||error)}));
      const envelope={format:SLOT_FORMAT,version:VERSION,saveSchemaVersion:SAVE_SCHEMA_VERSION,meta:{appVersion:meta.appVersion||VERSION,saveRevision:Number(state.saveRevision)||0,simSeconds:Number(state.simSeconds)||0,day,label},state:stateCodec()?stateCodec().encodeState(state):state};const out=writeJSON(slotKey(index),JSON.stringify(envelope));return {...out,meta:envelope.meta};
    }catch(e){return {ok:false,reason:String(e.message||e)};}
  }
  function statusEventForSlot(error,storageKey){status({ok:false,reason:error.message,requiresNativeReconciliation:true,storageKey});}
  function loadSlot(index,{storageKey='global-holdings-world-v3.0.0',appVersion=VERSION,previousState}={}){
    try{
      if(bridgeFor('commitSave')){
        const status=slotStatus(index);if(!status.exists)return status;
        if(locked||durableLocked||slicedLocked||recoveryRequired)return {ok:false,reason:'lifecycle-locked'};
        locked=true;
        return drain({allowLockedFlush:true}).then(()=>requestManualSlot('loadManualSlot',index,null,{appVersion})).then(out=>({...out,meta:status.meta,reloadRequired:true}),error=>{
          if(error.code==='ACK_TIMEOUT'){recoveryRequired=true;statusEventForSlot(error,storageKey);}else if(!recoveryRequired)locked=false;
          return {ok:false,reason:String(error.message||error),reloadRequired:recoveryRequired};
        });
      }
      const p=parseSlot(localStorage.getItem(slotKey(index)));if(!p.ok)return p;
      const out=writeState(storageKey,p.state);return out.ok?p:out;
    }catch(e){return {ok:false,reason:String(e.message||e)};}
  }
  function clearSlot(index){
    try{
      if(bridgeFor('commitSave'))return requestManualSlot('clearManualSlot',index).catch(error=>({ok:false,reason:String(error.message||error)}));
      localStorage.removeItem(slotKey(index));return {ok:true};
    }catch(e){return {ok:false,error:String(e.message||e)};}
  }
  function exportSaveSliced(state,meta){
    return snapshotOperation('backup-export-snapshot',state,meta,async({copy,yieldToFrame,fresh},timing)=>{
      const worker=globalThis.GH_SAVE_CHECKSUM_THREAD,codec=stateCodec();
      if(typeof worker?.exportStart!=='function'||typeof codec?.serializeChunkedSteps!=='function'||typeof globalThis.GH_SAVE_CHECKSUM_PROVIDER!=='function')throw new Error('export-worker-unavailable');
      // The export has no native ACK and may not replace the live store's durable chunk cache.
      const source=copy.fleet;if(source?.rows){copy.fleet={...source};codec.inheritFleetChunkCache?.(source,copy.fleet);}
      const save=await serializeNativeSliced(copy,yieldToFrame,timing,{retake:false,knownChunkIds:new Set(),forceChunked:true,validatedFleetRevision:copy.fleet.revision});if(!fresh())throw new Error('snapshot-source-changed');
      const appVersion=meta.appVersion||VERSION,day=Math.floor((Number(copy.simSeconds)||0)/86400)+1,header={format:EXPORT_FORMAT,version:appVersion,saveSchemaVersion:SAVE_SCHEMA_VERSION,saveRevision:Number(copy.saveRevision)||0,simSeconds:Number(copy.simSeconds)||0,day};let session=null;
      try{
        session=await worker.exportStart(save.json,header);
        for(const chunk of save.uploads){const bytes=chunk.bytes,length=bytes.length;for(let offset=0;offset<length;offset+=4194304){if(!fresh())throw new Error('snapshot-source-changed');await worker.exportChunk(session,chunk.id,length,offset,bytes.subarray(offset,Math.min(length,offset+4194304)));}chunk.bytes=null;}
        if(!fresh())throw new Error('snapshot-source-changed');const result=await worker.exportFinish(session);session=null;if(!fresh())throw new Error('snapshot-source-changed');
        const a=document.createElement('a'),url=URL.createObjectURL(result.blob);a.href=url;a.download=`Ventora_Save_v${appVersion}_D${day}.ghsave`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);timing.fileBytes=result.blob.size;timing.fileWorkerMs=result.workerMs;return {ok:true,filename:a.download};
      }finally{if(session)await worker.exportAbort(session).catch(()=>{});}
    });
  }
  function exportSave(state,{appVersion=VERSION,...meta}={}){
    if(largeSnapshot(state))return exportSaveSliced(state,{...meta,appVersion});
    try{assertState(state);const day=Math.floor((Number(state.simSeconds)||0)/86400)+1,pack={format:EXPORT_FORMAT,version:appVersion,saveSchemaVersion:SAVE_SCHEMA_VERSION,saveRevision:Number(state.saveRevision)||0,simSeconds:Number(state.simSeconds)||0,day,state:stateCodec()?stateCodec().encodeState(state):clone(state)};const blob=new Blob([JSON.stringify(pack,null,2)],{type:'application/json'}),a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=`Ventora_Save_v${appVersion}_D${day}.ghsave`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return {ok:true,filename:a.download};}catch(e){return {ok:false,reason:'export-failed',error:String(e.message||e)};}
  }
  function migrateMetadata(state){state.advanced=state.advanced||{};state.advanced.saveSlots=Array.isArray(state.advanced.saveSlots)?state.advanced.saveSlots:[null,null,null];for(let i=0;i<3;i++){const s=slotStatus(i);state.advanced.saveSlots[i]=s.exists?{date:s.meta?.label||`اليوم ${s.meta?.day||'—'}`,version:s.meta?.appVersion||'legacy',simSeconds:Number(s.meta?.simSeconds)||0}:null;}return state.advanced.saveSlots;}
  const API=Object.freeze({VERSION,requireFullValidation,fullValidationRequired:()=>fullValidationReason,noteVaultChunks,forgetVaultChunks,prestageDurableChunks,vaultChunkCount:()=>vaultChunks.size,SLOT_FORMAT,LIMITS:PERSISTENCE_LIMITS,fleetRecordLimit,slotStatus,saveSlot,loadSlot,clearSlot,exportSave,migrateMetadata,parseSlot,inspectJSON,inspectNativeJSON,writeJSON,writeState,commitState,commitDurableState,recoverBrowserState,acknowledgeRecovery,markRecoveryRequired,requestNative,receiveAck,receiveSlotAck,drain,replaceState,isLocked:()=>locked||durableLocked||slicedLocked||recoveryRequired,commitStateSliced,slicedSettled,slicedActive:()=>!!slicedSave,
    // Cheap read for the save policy (GH_SAVE_POLICY): when the last save of any kind ran.
    saveCadence:()=>({lastSaveAtMs}),telemetry:()=>({generation,pending:pending.size,slotPending:slotPending.size,ordinaryInFlight:!!ordinaryInFlight,ordinaryDirty,recoveryRequired,samples:clone(samples),timings:{lastSaveBreakdown:clone(lastSaveBreakdown),lastNativeAck:clone(lastNativeAck),samples:clone(timingSamples)}})});
  globalThis.GH_PERSISTENCE=API;if(globalThis.window&&window!==globalThis)window.GH_PERSISTENCE=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
