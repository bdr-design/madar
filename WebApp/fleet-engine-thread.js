// Build 358: main-thread side of the fleet engine thread (fleet-engine-worker.js). The event engine's work, the larger
// part of every simulation slice and of every frame during a calendar advance, runs on a Worker over a replica of the
// fleet store; this side keeps the replica in step and replays each result inside the slice's transaction.
//
// - Before each step the replica receives what changed here since the last exchange: rows from the store's dirty log
//   (purchases, sales, route assignments), value-table changes by reference number, route plans for every
//   (route, base) the fleet can reach. Interned values come from the same incremental log; no full value-table scan or
//   snapshot runs on an ordinary exchange.
// - Build 372: what changed comes from the store's replica log (STORE.drainReplica), which only this side drains and
//   which never overflows; compactions are replayed by the worker (compactRowsAt). The first replica of a store decoded
//   from the native vault is its chunk buffers, moved to the worker (STORE.takeReplicaSeed), so no copy of the store is
//   made here; the worker finds the (route, base) pairs of its replica itself and this side resolves those it names.
//   A store with no seed and no replica is streamed to the worker in bounded row/value/extra chunks; exportReplica is
//   retained only for synthetic stores of at most 2048 rows. Full rebuild reasons remain counted in fullSyncReasons.
// - request() posts the step; apply() replays it: values interned at the worker's numbers (STORE.internAt), rows written
//   through the store's toucher (journaled, so the transaction's rollback restores them), the engine's revision count.
//   The worker keeps its step open until the transaction settles it (commit or rollback), so both sides stay equal.
// - Anything unexpected (the store changed since the request, a value at another number, a route plan the worker does
//   not hold, a worker error) makes apply() refuse; the caller then runs the step itself on this thread, exactly as
//   before, and the next exchange sends the whole store.
(()=>{
  'use strict';
  const VERSION='1.4.0';
  const STORE=globalThis.GH_FLEET_STORE||(typeof require==='function'?require('./fleet-store-core.js'):null);
  if(!STORE)throw new Error('Fleet engine thread requires the Fleet Store core');
  const W_ROUTE=STORE.O.routeId,W_BASE=STORE.O.baseFacility,WR=STORE.WORDS_PER_ROW;
  const routeKey=(routeId,base)=>String(routeId||'')+'\u0000'+String(base||'');
  // One incremental exchange's main-thread budget. stats.slowSyncs counts the exchanges that took longer in wall time;
  // a single sample can include a GC or scheduler pause unrelated to the exchange's own work.
  const SYNC_BUDGET_MS=4.5;

  function create({workerFactory,resolveRoute,catalogSpecs,routesRevision=()=>0,clock=()=>performance.now(),timeoutMs=15000,replicaRowSlice=4096,replicaValueSlice=512,replicaExtraSlice=256,replicaBudgetMs=4}={}){
    let worker=null,disabled=null,nextId=1,needsFull=true,synced=null,routeTable=new Map(),routesAt=null,pending=null,windowSession=null,mutationSession=null,lastBudgetTime=Infinity,importId=0,routesReady=true,replicaBuild=null;
    const tickets=new Map(),waiters=[],inspections=new Map(),healthChecks=new Map(),classRequests=new Map(),queryRequests=new Map(),dispatchRequests=new Map(),stats={requests:0,applied:0,fallbacks:0,windowBegins:0,windowSteps:0,windowCommits:0,windowRollbacks:0,windowFallbacks:0,fullSyncs:0,seedSyncs:0,incrementalSyncs:0,columnSyncs:0,columnPlanSyncs:0,compactions:0,rowsSent:0,routeKeysAnswered:0,deferredRequests:0,windowDeferred:0,replicaPrimeSlices:0,replicaPrimeRestarts:0,replicaPrimeFailures:0,replicaPrimeRows:0,replicaPrimeValues:0,replicaPrimeExtras:0,lastReplicaPrimeSliceMs:0,maxReplicaPrimeSliceMs:0,lastWorkerMs:0,lastApplyMs:0,lastSyncMs:0,maxWorkerMs:0,maxApplyMs:0,maxSyncMs:0,maxFullSyncMs:0,maxSeedSyncMs:0,maxRouteAnswerMs:0,slowSyncs:0,lastReason:'',fullSyncReasons:{}};
    replicaRowSlice=Math.max(256,Math.floor(Number(replicaRowSlice)||4096));replicaValueSlice=Math.max(64,Math.floor(Number(replicaValueSlice)||512));replicaExtraSlice=Math.max(32,Math.floor(Number(replicaExtraSlice)||256));replicaBudgetMs=Math.max(1,Math.min(8,Number(replicaBudgetMs)||4));
    const scheduleReplica=fn=>typeof globalThis.requestAnimationFrame==='function'?{kind:'frame',id:globalThis.requestAnimationFrame(()=>fn())}:{kind:'timer',id:setTimeout(fn,0)};
    const cancelReplica=task=>{if(!task)return;if(task.kind==='frame'&&typeof globalThis.cancelAnimationFrame==='function')globalThis.cancelAnimationFrame(task.id);else clearTimeout(task.id);};
    const settleWaiters=()=>{if(pending||windowSession||mutationSession||dispatchRequests.size||replicaBuild)return;while(waiters.length)waiters.shift()();};
    function disable(reason){
      if(disabled)return;disabled=String(reason||'disabled');stats.lastReason=disabled;
      if(replicaBuild){cancelReplica(replicaBuild.task);replicaBuild=null;}
      try{worker?.terminate?.();}catch(_error){}worker=null;
      for(const ticket of tickets.values()){ticket.status='failed';ticket.reason=disabled;clearTimeout(ticket.timer);}
      // A failed window still owns the main transaction's rollback point. Keep
      // it busy until that transaction explicitly settles the session; otherwise
      // an external fleet writer could enter before main has restored leg 1.
      if(windowSession){windowSession.status='failed';windowSession.reason=disabled;}
      // The worker may hold rows from a still-reversible bulk mutation. Keep its
      // owner busy until that transaction settles; releasing it here would let
      // callers mistake a dead/speculative replica for a committed one.
      if(mutationSession){mutationSession.status='failed';mutationSession.reason=disabled;}
      tickets.clear();pending=null;routesReady=true;for(const resolve of inspections.values())resolve(null);inspections.clear();for(const entry of healthChecks.values())entry.resolve(null);healthChecks.clear();for(const entry of classRequests.values())entry.resolve(null);classRequests.clear();for(const entry of queryRequests.values())entry.resolve(null);queryRequests.clear();for(const entry of dispatchRequests.values()){clearTimeout(entry.timer);entry.resolve(null);}dispatchRequests.clear();settleWaiters();
    }
    function ensureWorker(){
      if(disabled)return null;if(worker)return worker;
      try{worker=typeof workerFactory==='function'?workerFactory():null;}catch(error){disable(`worker-create:${error?.message||error}`);return null;}
      if(!worker){disable('worker-unavailable');return null;}
      worker.onmessage=event=>receive(event?.data||{});
      worker.onerror=event=>disable(`worker-error:${event?.message||'unknown'}`);
      worker.onmessageerror=()=>disable('worker-message-error');
      needsFull=true;
      if(typeof catalogSpecs==='function')post({type:'specs',specs:catalogSpecs()});
      return worker;
    }
    function post(message,transfer){worker.postMessage(message,transfer||[]);}
    function receive(message){
      if(message.type==='error'){disable(`worker:${message.error}`);return;}
      if(message.type==='route-keys'){answerRouteKeys(message);return;}
      if(message.type==='health'){const entry=healthChecks.get(message.id);healthChecks.delete(message.id);if(entry){stats.lastHealthWorkerMs=Number(message.ms)||0;stats.totalWorkerMs=(stats.totalWorkerMs||0)+stats.lastHealthWorkerMs;stats.maxHealthWorkerMs=Math.max(stats.maxHealthWorkerMs||0,stats.lastHealthWorkerMs);entry.resolve(message.unavailable||!Array.isArray(message.issues)?null:{...entry.tag,issues:message.issues});}return;}
      if(message.type==='classes'){const entry=classRequests.get(message.id);classRequests.delete(message.id);if(entry){stats.lastClassesWorkerMs=Number(message.ms)||0;stats.totalWorkerMs=(stats.totalWorkerMs||0)+stats.lastClassesWorkerMs;stats.maxClassesWorkerMs=Math.max(stats.maxClassesWorkerMs||0,stats.lastClassesWorkerMs);entry.resolve(message.unavailable||!Array.isArray(message.rows)?null:{...entry.tag,rows:message.rows,ids:message.ids||null});}return;}
      if(message.type==='query'){const entry=queryRequests.get(message.id);queryRequests.delete(message.id);if(entry){const ms=Number(message.ms)||0;stats.totalWorkerMs=(stats.totalWorkerMs||0)+ms;stats.maxQueryWorkerMs=Math.max(stats.maxQueryWorkerMs||0,ms);entry.resolve(message.unavailable||!message.result||message.result.legacy?null:{...entry.tag,result:message.result});}return;}
      if(message.type==='dispatch-plan'){
        const entry=dispatchRequests.get(message.id);dispatchRequests.delete(message.id);if(entry){clearTimeout(entry.timer);const ms=Number(message.ms)||0;stats.lastDispatchWorkerMs=ms;stats.totalWorkerMs=(stats.totalWorkerMs||0)+ms;stats.maxDispatchWorkerMs=Math.max(stats.maxDispatchWorkerMs||0,ms);const plan=message.plan,tag=plan?.tag,valid=!message.unavailable&&plan&&plan.indices instanceof Int32Array&&plan.bytes instanceof ArrayBuffer&&tag&&tag.revision===entry.tag.revision&&tag.structure===entry.tag.structure&&tag.length===entry.tag.length&&tag.valuesLength===entry.tag.valuesLength;if(!valid)stats.lastDispatchPlanRefusal=String(message.unavailable||(plan?'tag-mismatch':'no-plan')).slice(0,200);entry.resolve(valid?{...entry.tag,plan}:null);settleWaiters();}return;
      }
      if(message.type==='inspect'){const resolve=inspections.get(message.id);inspections.delete(message.id);resolve?.(message.missing?null:message);return;}
      if(message.type!=='result')return;
      const ticket=tickets.get(message.id);if(!ticket)return;
      clearTimeout(ticket.timer);stats.lastWorkerMs=Number(message.ms)||0;stats.totalWorkerMs=(stats.totalWorkerMs||0)+stats.lastWorkerMs;stats.maxWorkerMs=Math.max(stats.maxWorkerMs,stats.lastWorkerMs);
      if(message.fallback){
        ticket.status='fallback';ticket.reason=String(message.fallback);ticket.settled=true;tickets.delete(ticket.id);if(pending===ticket)pending=null;
        if(ticket.window){ticket.window.status='failed';ticket.window.reason=ticket.reason;stats.windowFallbacks++;needsFull=true;}
        else needsFull=needsFull||ticket.reason.startsWith('engine-error');
        settleWaiters();return;
      }
      if(Number.isFinite(message.nextBudgetTime)||message.nextBudgetTime===Infinity)lastBudgetTime=message.nextBudgetTime;
      ticket.result=message;ticket.status='ready';
      if(ticket.discarded)settle(ticket,'rollback');
    }
    // (route, base) pairs a row can reach: its own, then the ends of every plan reached, until nothing new appears.
    // Only for the rows of an incremental exchange: a whole replica's pairs are found by the worker (route-keys).
    function addRouteKeys(store,keys,indices){
      const u32=STORE.views(store).u32,values=store.values,add=(routeId,base)=>{if(routeId)keys.add(routeKey(routeId,base));};
      for(const index of indices){if(index<store.length){const routeRef=u32[index*WR+W_ROUTE],baseRef=u32[index*WR+W_BASE];if(routeRef)add(values[routeRef],baseRef?values[baseRef]:'');}}
    }
    function closeRouteKeys(keys){
      const queue=[...keys].filter(key=>!routeTable.has(key)),plans=[];
      while(queue.length){
        const key=queue.pop();if(routeTable.has(key))continue;
        const split=key.indexOf('\u0000'),routeId=key.slice(0,split),base=key.slice(split+1);
        let plan=null;try{plan=resolveRoute(routeId,base)||null;}catch(_error){plan=null;}
        if(plan&&typeof plan==='object')plan=JSON.parse(JSON.stringify(plan));
        routeTable.set(key,plan);plans.push([key,plan]);
        if(plan)for(const end of [plan.fromFacility,plan.toFacility]){const next=routeKey(routeId,end||'');if(!routeTable.has(next)){keys.add(next);queue.push(next);}}
      }
      return plans;
    }
    // The worker's answer to a whole replica: the pairs its rows name. Steps wait (deferred tickets) until they are sent.
    function answerRouteKeys(message){
      if(disabled||message.importId!==importId||routesReady)return;
      const started=clock();
      const plans=closeRouteKeys(new Set(Array.isArray(message.keys)?message.keys.map(String):[]));
      if(plans.length)post({type:'routes',replace:false,plans});
      routesReady=true;stats.routeKeysAnswered+=plans.length;stats.maxRouteAnswerMs=Math.max(stats.maxRouteAnswerMs,clock()-started);
      const ticket=pending;
      if(ticket?.deferredWindow&&!ticket.settled&&!disabled){
        // The window's revision is pinned (requestWindow checked it): its step goes as it was asked.
        const message=ticket.deferredWindow;delete ticket.deferredWindow;
        ticket.timer=setTimeout(()=>{if(ticket.status==='pending')disable('worker-window-timeout');},timeoutMs);post(message);return;
      }
      if(ticket?.deferred&&!ticket.settled&&!disabled){
        let ready=false;try{ready=sync(ticket.store);}catch(error){disable(`sync:${error?.message||error}`);return;}
        if(ready)postDeferred(ticket);
      }
    }
    function postDeferred(ticket){
      const store=ticket.store,request=ticket.deferred;delete ticket.deferred;
      ticket.revision=store.revision;ticket.valuesLength=store.values.length;ticket.length=store.length;
      ticket.timer=setTimeout(()=>{if(ticket.status==='pending')disable('worker-timeout');},timeoutMs);
      post({type:'advance',id:ticket.id,...request});
    }
    const own=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
    function extraEntries(object){return(function*(){for(const key in object)if(own(object,key))yield [key,object[key]];})();}
    function deferredPrimeFailed(reason){
      const ticket=pending;if(!ticket?.deferred||ticket.settled)return;
      ticket.status='fallback';ticket.reason=String(reason);ticket.settled=true;tickets.delete(ticket.id);pending=null;stats.fallbacks++;stats.lastReason=ticket.reason;settleWaiters();
    }
    function abandonReplicaBuild(build,reason,{restart=false}={}){
      if(!build||build!==replicaBuild)return;
      cancelReplica(build.task);build.task=null;
      try{post({type:'replica-abort',importId:build.id});}catch(_error){}
      replicaBuild=null;synced=null;needsFull=true;routesReady=false;stats.lastReason=String(reason);
      if(restart&&build.attempt<2&&!disabled&&worker){stats.replicaPrimeRestarts++;startStagedReplica(build.store,build.reason,build.attempt+1);return;}
      stats.replicaPrimeFailures++;deferredPrimeFailed(reason);settleWaiters();
    }
    function completeReplicaBuild(build){
      if(build!==replicaBuild||!STORE.replicaSnapshotFresh(build.store,build.snapshot))return abandonReplicaBuild(build,'replica-prime-stale',{restart:true});
      post({type:'replica-end',importId:build.id});
      replicaBuild=null;synced={store:build.store,runtime:build.runtime,valuesLength:build.valuesLength,length:build.length};needsFull=false;
      stats.fullSyncs++;stats.lastSyncMs=build.workMs;stats.maxFullSyncMs=Math.max(stats.maxFullSyncMs,build.maxSliceMs);stats.maxSyncMs=Math.max(stats.maxSyncMs,build.maxSliceMs);stats.lastReplicaPrimeMs=clock()-build.started;stats.maxReplicaPrimeMs=Math.max(stats.maxReplicaPrimeMs||0,stats.lastReplicaPrimeMs);settleWaiters();
    }
    function runReplicaBuild(build){
      if(build!==replicaBuild||disabled||!worker)return;
      build.task=null;const sliceStarted=clock();let pieces=0;
      try{
        while(pieces<4&&clock()-sliceStarted<replicaBudgetMs){
          if(!STORE.replicaSnapshotFresh(build.store,build.snapshot)){abandonReplicaBuild(build,'replica-prime-stale',{restart:true});return;}
          if(build.rowAt<build.length){
            const from=build.rowAt,count=Math.min(replicaRowSlice,build.length-from),start=from*STORE.STRIDE,bytes=build.snapshot.rows.slice(start,start+count*STORE.STRIDE);build.rowAt+=count;
            post({type:'replica-chunk',importId:build.id,kind:'rows',from,count,bytes},[bytes]);stats.replicaPrimeRows+=count;
          }else if(build.valueAt<build.valuesLength){
            const from=build.valueAt,count=Math.min(replicaValueSlice,build.valuesLength-from),values=new Array(count);for(let index=0;index<count;index++){const value=build.snapshot.values[from+index];values[index]=value===undefined?null:value;}build.valueAt+=count;
            post({type:'replica-chunk',importId:build.id,kind:'values',from,values});stats.replicaPrimeValues+=count;
          }else if(!build.extrasDone){
            const entries=[];while(entries.length<replicaExtraSlice){const next=build.extras.next();if(next.done){build.extrasDone=true;break;}entries.push(next.value);}
            if(entries.length){post({type:'replica-chunk',importId:build.id,kind:'extras',entries});stats.replicaPrimeExtras+=entries.length;}
          }else break;
          pieces++;
        }
      }catch(error){disable(`replica-prime:${error?.message||error}`);return;}
      const elapsed=clock()-sliceStarted;build.workMs+=elapsed;build.maxSliceMs=Math.max(build.maxSliceMs,elapsed);stats.replicaPrimeSlices++;stats.lastReplicaPrimeSliceMs=elapsed;stats.maxReplicaPrimeSliceMs=Math.max(stats.maxReplicaPrimeSliceMs,elapsed);
      if(!STORE.replicaSnapshotFresh(build.store,build.snapshot)){abandonReplicaBuild(build,'replica-prime-stale',{restart:true});return;}
      if(build.rowAt===build.length&&build.valueAt===build.valuesLength&&build.extrasDone){completeReplicaBuild(build);return;}
      build.task=scheduleReplica(()=>runReplicaBuild(build));
    }
    function startStagedReplica(store,reason,attempt=0){
      const snapshot=STORE.beginReplicaSnapshot(store);if(!snapshot){stats.lastReason='replica-prime-baseline-refused';stats.replicaPrimeFailures++;return false;}
      const id=++importId,runtime=STORE.chunkStamp(store).runtime,build={id,store,reason,attempt,snapshot,runtime,length:snapshot.length,valuesLength:snapshot.values.length,rowAt:0,valueAt:0,extras:extraEntries(snapshot.extras),extrasDone:false,started:clock(),workMs:0,maxSliceMs:0,task:null};
      routeTable=new Map();routesAt=routesRevision();routesReady=false;synced=null;needsFull=true;replicaBuild=build;
      post({type:'replica-begin',importId:id,meta:{length:snapshot.length,live:snapshot.live,structure:snapshot.structure,revision:snapshot.revision,valuesLength:snapshot.values.length}});
      build.task=scheduleReplica(()=>runReplicaBuild(build));return false;
    }
    // A decoded store still moves its seed buffers directly. A small synthetic store keeps the simple synchronous path.
    // A larger store with no seed is streamed in bounded frame slices: no exportReplica, full value-table map, extras
    // enumeration or record-buffer copy runs in the initiating call. Freshness is proved after every yield and before
    // publication; a changed snapshot is abandoned and rebuilt, never accepted approximately.
    function newReplica(store,reason){
      if(replicaBuild){if(replicaBuild.store===store)return false;abandonReplicaBuild(replicaBuild,'replica-prime-store-replaced');}
      const started=clock(),runtime=STORE.chunkStamp(store).runtime,seed=STORE.takeReplicaSeed(store);
      routeTable=new Map();routesAt=routesRevision();routesReady=false;
      if(seed){
        const id=++importId,buffers=[...new Set(seed.chunks)];
        post({type:'seed',importId:id,meta:{length:seed.length,live:seed.live,structure:seed.structure,revision:seed.revision,chunkBytes:seed.chunkBytes,byteLength:seed.byteLength},values:seed.values,extras:seed.extras,chunks:seed.chunks},buffers);
        synced={store,runtime,valuesLength:seed.values.length,length:seed.length};
        stats.seedSyncs++;stats.lastSyncMs=clock()-started;stats.maxSeedSyncMs=Math.max(stats.maxSeedSyncMs,stats.lastSyncMs);stats.maxSyncMs=Math.max(stats.maxSyncMs,stats.lastSyncMs);needsFull=false;return true;
      }
      stats.fullSyncReasons[reason]=(stats.fullSyncReasons[reason]||0)+1;
      if(store.length>2048||store.values.length>2048)return startStagedReplica(store,reason);
      const id=++importId;STORE.drainReplica(store);const payload=STORE.exportReplica(store);
      post({type:'replica',id:0,importId:id,payload},[payload.rows]);synced={store,runtime,valuesLength:payload.values.length,length:store.length};
      stats.fullSyncs++;stats.lastSyncMs=clock()-started;stats.maxFullSyncMs=Math.max(stats.maxFullSyncMs,stats.lastSyncMs);stats.maxSyncMs=Math.max(stats.maxSyncMs,stats.lastSyncMs);needsFull=false;return true;
    }
    // Values the worker interned for a step it replayed here are already on the replica. apply/applyWindow explicitly
    // suppress internAt's main-to-worker log around that known replay; only the known table length advances here.
    function replicaHolds(store,values){
      if(!synced||synced.store!==store)return;
      if(values.length)synced.valuesLength=store.values.length;
    }
    // Brings the replica up to this store. Returns false while the worker's route pairs are not answered (a step then
    // waits as a deferred ticket). `into` ({step}, {window}, or {mutation}: its id) sends the rows into that open journal
    // (syncIntoOpen); the worker refuses any other sync while one is open.
    function sync(store,into=null){
      const runtime=STORE.chunkStamp(store).runtime;
      const reason=needsFull?'stale':!synced?'first':synced.store!==store?'store-replaced':synced.runtime!==runtime?'store-runtime':'';
      if(reason&&!newReplica(store,reason))return false;
      const started=clock(),log=STORE.drainReplica(store);
      // Columns rewritten wholesale travel exactly as logged. columnWriter logs `present` itself, once, when it first
      // exposes a previously absent field; adding it unconditionally copied another million-entry column on every close.
      const columnNames=log.columns.length?[...new Set(log.columns)]:null;
      if(columnNames&&!columnNames.every(name=>Object.prototype.hasOwnProperty.call(STORE.SLOTS,name))){newReplica(store,'column-writes');return sync(store);}
      const plan=log.columnPlan,planColumns=Array.isArray(plan?.columns)?[...new Set(plan.columns)]:null,planReported=Array.isArray(plan?.reportedColumns)?[...new Set(plan.reportedColumns)]:null;
      const sameNames=(left,right)=>!!left&&!!right&&left.length===right.length&&left.every(name=>right.includes(name));
      const planExceptions=plan?.exceptionalPositions,dual=plan?.exceptional,planCount=Number(plan?.count),width=Array.isArray(plan?.fields)?plan.fields.length:0;
      const ownedView=view=>ArrayBuffer.isView(view)&&view.buffer instanceof ArrayBuffer&&view.buffer.byteLength>0;
      const primaryValid=Number.isSafeInteger(planCount)&&planCount>=0&&ownedView(plan?.indices)&&plan.indices.length===planCount&&ownedView(plan?.values)&&plan.values.length===planCount*width;
      const dualCount=Number(dual?.count),totalCount=dual?Number(plan?.totalCount):planCount,dualValid=!dual||plan.indices instanceof Int32Array&&plan.values instanceof Float32Array&&Number.isSafeInteger(dualCount)&&dualCount>=0&&dual.indices instanceof Int32Array&&dual.indices.length===dualCount&&ownedView(dual.indices)&&dual.values instanceof Float64Array&&dual.values.length===dualCount*width&&ownedView(dual.values)&&Number.isSafeInteger(totalCount)&&totalCount===planCount+dualCount;
      const markerValid=dual||planExceptions==null||planExceptions instanceof Int32Array&&planExceptions.buffer instanceof ArrayBuffer&&planExceptions.length<=planCount;
      const columnPlan=columnNames&&plan&&width>0&&totalCount>0&&primaryValid&&dualValid&&markerValid&&sameNames(columnNames,planColumns)&&sameNames(log.reportedColumns,planReported)&&plan.fields.every(name=>Object.prototype.hasOwnProperty.call(STORE.SLOTS,name))?plan:null;
      for(const compaction of log.compactions){post({type:'compact',dead:compaction.dead,length:compaction.length},[compaction.dead.buffer]);stats.compactions++;}
      if(!log.valuesDirty&&store.values.length!==synced.valuesLength){newReplica(store,'value-log-missed');return sync(store);}
      const indices=log.rows,values=log.valuesDirty?STORE.replicaValueChanges(store,log.valueRefs):{length:store.values.length,changes:[]};
      if(routesRevision()!==routesAt){
        routesAt=routesRevision();const keys=new Set(routeTable.keys());routeTable=new Map();addRouteKeys(store,keys,indices);
        post({type:'routes',replace:true,plans:closeRouteKeys(keys)});
      }else if(indices.length){const keys=new Set();addRouteKeys(store,keys,indices);const plans=closeRouteKeys(keys);if(plans.length)post({type:'routes',replace:false,plans});}
      if(indices.length||values.changes.length||values.length!==synced.valuesLength||store.length!==synced.length||log.compactions.length){
        const rows=STORE.readRows(store,indices),count=indices.length;
        post({type:'sync',...(into||{}),length:store.length,live:store.live,structure:store.structure,values,rows:{indices,bytes:rows.bytes,extras:rows.extras}},[rows.bytes,indices.buffer]);
        stats.rowsSent+=count;
      }
      if(columnPlan){
        const transfer=[];for(const view of [columnPlan.indices,columnPlan.values,columnPlan.exceptional?.indices,columnPlan.exceptional?.values,columnPlan.exceptionalPositions])if(ArrayBuffer.isView(view)&&view.buffer instanceof ArrayBuffer&&view.buffer.byteLength&&!transfer.includes(view.buffer))transfer.push(view.buffer);
        post({type:'column-plan',...(into||{}),reported:log.reportedColumns,plan:{fields:columnPlan.fields,indices:columnPlan.indices,values:columnPlan.values,count:columnPlan.count,rejectNaN:columnPlan.rejectNaN,...(columnPlan.exceptional?{exceptional:columnPlan.exceptional,totalCount:columnPlan.totalCount}:{exceptionalPositions:columnPlan.exceptionalPositions})}},transfer);stats.columnPlanSyncs++;
      }else if(columnNames){const payload=STORE.readColumns(store,columnNames);post({type:'columns',...(into||{}),reported:log.reportedColumns,payload},payload.columns.map(([,buffer])=>buffer));stats.columnSyncs++;}
      synced.valuesLength=values.length;
      synced.length=store.length;
      stats.incrementalSyncs++;stats.lastSyncMs=clock()-started;stats.maxSyncMs=Math.max(stats.maxSyncMs,stats.lastSyncMs);if(stats.lastSyncMs>SYNC_BUDGET_MS)stats.slowSyncs++;
      return routesReady;
    }
    // Build 372: rows, values, appended rows and columns rewritten wholesale (the day close's flight counters) this side
    // wrote after replaying the open step, or the open calendar window's last leg (the rest of a slice before its
    // post-commit checks: its business journal, deliveries, the market hour, the day close), go into that step or window:
    // the worker writes them inside its journal (a column through its journal's column snapshot), so settling it commits
    // or rolls them back with it (and this side's rollback logs every row and column it restores, so the next exchange
    // sends them again in any case). The slice's save check then takes its classes from the worker (refused, it read
    // every row here: 334 ms at a million assets). A compaction, a column outside the record slots, a shorter store, new
    // route plans, a replica due for a new copy or a window that is not open keep the refusal (the caller then reads
    // the store itself, as before). Returns '' once sent, else the refusal's reason.
    function syncIntoOpen(store){
      const step=pending&&pending.applied&&!pending.settled&&!windowSession&&pending.store===store?pending:null;
      const session=!pending&&windowSession&&windowSession.status==='open'&&!windowSession.settled&&windowSession.store===store?windowSession:null;
      if(!step&&!session)return 'written-since-step';
      if(needsFull)return 'stale-since-step';
      const held=STORE.replicaPending(store);
      if(held.compactions)return 'compaction-since-step';
      if(!held.columns.every(name=>Object.prototype.hasOwnProperty.call(STORE.SLOTS,name)))return 'mass-write-since-step';
      if(store.length<synced.length)return 'rows-removed-since-step';
      if(routesRevision()!==routesAt)return 'routes-since-step';
      try{sync(store,step?{step:step.id}:{window:session.id});}catch(error){disable(`open-sync:${error?.message||error}`);return 'open-sync-failed';}
      stats.openSyncs=(stats.openSyncs||0)+1;return '';
    }
    // The replica, once the messages posted so far are handled, is exactly this store: with nothing in flight it is
    // brought to the store first; with a step or window in flight, only once this side replayed its result (both then
    // hold that step), what this side wrote since sent into it (syncIntoOpen). Returns the store's tag (for current()),
    // or null.
    function replicaIsStore(store){
      const refuse=reason=>{const r=stats.replicaRefusals||(stats.replicaRefusals={});r[reason]=(r[reason]||0)+1;return null;};
      if(disabled||!worker||!STORE.isStore(store)||!synced||synced.store!==store)return refuse('no-replica');
      if(mutationSession)return refuse('mutation-open');
      if(pending&&!pending.applied)return refuse('step-not-replayed');
      if(!pending&&!windowSession){if(!prime(store))return refuse('prime');}
      else if(synced.runtime!==STORE.chunkStamp(store).runtime)return refuse('store-changed');
      else if(!STORE.replicaClean(store)||synced.length!==store.length||synced.valuesLength!==store.values.length){const reason=syncIntoOpen(store);if(reason)return refuse(reason);}
      return {store,runtime:STORE.chunkStamp(store).runtime,revision:store.revision,structure:store.structure,length:store.length};
    }
    // Keeps the replica current between steps (after load, after commands): a later step then sends only its own
    // changes. Does nothing while a step or window is in flight.
    function prime(store){
      if(pending||windowSession||mutationSession||dispatchRequests.size||!STORE.isStore(store)||!ensureWorker())return false;
      try{sync(store);}catch(error){disable(`sync:${error?.message||error}`);return false;}
      return !replicaBuild;
    }
    // Posts one step. Returns a ticket ({status:'pending'|'ready'|'fallback'|'failed'}) or null when the thread is not
    // available (the caller runs the step itself).
    function request(store,{from,to,context,contextKey,tripAlertLimit,order,maxEvents,budget}={}){
      if(pending||windowSession||mutationSession||dispatchRequests.size||!STORE.isStore(store)||!ensureWorker())return null;
      let ready;try{ready=sync(store);}catch(error){disable(`sync:${error?.message||error}`);return null;}
      const ticket={id:nextId++,store,from,to,contextKey:String(contextKey||''),revision:store.revision,valuesLength:store.values.length,length:store.length,status:'pending',result:null,settled:false,discarded:false,applied:false,reason:''};
      tickets.set(ticket.id,ticket);pending=ticket;stats.requests++;
      // The worker has not yet named its replica's route pairs: the step is posted (and the ticket stamped) once they
      // are answered.
      if(!ready){ticket.deferred={from,to,context,tripAlertLimit,order,maxEvents,budget};stats.deferredRequests++;return ticket;}
      ticket.timer=setTimeout(()=>{if(ticket.status==='pending')disable('worker-timeout');},timeoutMs);
      post({type:'advance',id:ticket.id,from,to,context,tripAlertLimit,order,maxEvents,budget});
      return ticket;
    }
    // A manual calendar window keeps one journal open in the worker while the
    // main transaction advances one exact hour at a time with a fresh context.
    // Only one step is in flight; commit or rollback settles the whole window.
    function beginWindow(store,{from=0,target=Infinity}={}){
      if(pending||windowSession||mutationSession||dispatchRequests.size||!STORE.isStore(store)||!ensureWorker())return null;
      try{sync(store);}catch(error){disable(`window-sync:${error?.message||error}`);return null;}
      if(replicaBuild)return null;
      const start=Number(from),end=Number(target);if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)return null;
      const session={id:nextId++,store,revision:store.revision,valuesLength:store.values.length,length:store.length,routesRevision:routesRevision(),nextFrom:start,target:end,nextSeq:0,status:'open',reason:'',registered:false,settled:false,steps:0};
      windowSession=session;stats.windowBegins++;post({type:'window-begin',id:session.id,from:start,target:end});return session;
    }
    function requestWindow(session,store,{from,to,context,contextKey,tripAlertLimit,order,maxEvents,budget}={}){
      if(pending||!session||session!==windowSession||session.status!=='open'||session.settled||store!==session.store)return null;
      if(store.revision!==session.revision||store.values.length!==session.valuesLength||store.length!==session.length||!STORE.replicaClean(store)){session.reason='store-changed';return null;}
      if(routesRevision()!==session.routesRevision){session.reason='routes-changed';return null;}
      from=Number(from);to=Number(to);if(!Number.isFinite(from)||!Number.isFinite(to)||Math.abs(from-session.nextFrom)>1e-6||to<=from||to>session.target+1e-6){session.reason='window-range-invalid';return null;}
      const seq=session.nextSeq,ticket={id:nextId++,window:session,seq,store,from,to,contextKey:String(contextKey||''),revision:store.revision,valuesLength:store.values.length,length:store.length,status:'pending',result:null,settled:false,discarded:false,applied:false,reason:''};
      tickets.set(ticket.id,ticket);pending=ticket;stats.requests++;stats.windowSteps++;
      const message={type:'window-advance',windowId:session.id,id:ticket.id,seq,from,to,context,tripAlertLimit,order,maxEvents,budget};
      // The worker has not yet named its replica's route pairs: the step is posted once they are answered.
      if(!routesReady){ticket.deferredWindow=message;stats.windowDeferred++;return ticket;}
      ticket.timer=setTimeout(()=>{if(ticket.status==='pending')disable('worker-window-timeout');},timeoutMs);
      post(message);
      return ticket;
    }
    // Messages reach the worker in order, so a settle posted while its step still runs is handled right after it.
    function settle(ticket,outcome){
      if(!ticket||ticket.settled)return;ticket.settled=true;tickets.delete(ticket.id);clearTimeout(ticket.timer);
      if(worker&&!disabled&&(ticket.status==='pending'||ticket.status==='ready'))post({type:'settle',id:ticket.id,outcome});
      if(pending===ticket)pending=null;settleWaiters();
    }
    // The caller will not use this ticket (cancelled slice, or it runs the step itself): the worker rolls the step back,
    // which leaves its replica where this side still is.
    function discard(ticket){
      if(!ticket||ticket.settled||ticket.applied)return;ticket.discarded=true;
      if(ticket.window)settleWindow(ticket.window,'rollback');else settle(ticket,'rollback');
    }
    function settleWindow(session,outcome){
      if(!session||session.settled)return;const failed=session.status==='failed';session.settled=true;session.status=outcome==='commit'?'committed':'rolled-back';
      const active=pending?.window===session?pending:null;if(active){active.settled=true;clearTimeout(active.timer);tickets.delete(active.id);pending=null;}
      for(const ticket of [...tickets.values()])if(ticket.window===session){ticket.settled=true;clearTimeout(ticket.timer);tickets.delete(ticket.id);}
      if(worker&&!disabled)try{post({type:'window-settle',id:session.id,outcome});}catch(_error){needsFull=true;}
      if(windowSession===session)windowSession=null;
      if(outcome==='commit')stats.windowCommits++;else stats.windowRollbacks++;
      // Build 372: a window rolled back on both sides needs no new replica (the store's rollback logs every row it
      // restores, and the value-ref log reports the values it removed); a failed one may have diverged and gets one.
      if(failed)needsFull=true;
      settleWaiters();
    }
    // A large main-thread mutation (bulk purchase) keeps one matching journal
    // open in the worker. The caller flushes the replica log at every bounded
    // apply yield, so no final exchange has to gather/copy every appended row
    // in one frame. The main transaction remains the owner: its rollback first
    // restores the Store journal, then this callback rolls the worker journal
    // back; commit is allowed only after one final clean flush.
    function beginMutation(store,{tx=null,label='fleet-mutation'}={}){
      if(pending||windowSession||mutationSession||dispatchRequests.size||!STORE.isStore(store)||!ensureWorker())return null;
      // The mutation session must be registered before the Store lazily opens
      // its row journal. Transaction rollback then restores main rows before it
      // asks the worker to settle, including a final unflushed apply slice.
      if(STORE.journalStats(store))return null;
      try{if(!sync(store))return null;}catch(error){disable(`mutation-sync:${error?.message||error}`);return null;}
      const runtime=STORE.chunkStamp(store).runtime;
      if(needsFull||!STORE.replicaClean(store)||!synced||synced.store!==store||synced.runtime!==runtime||synced.length!==store.length||synced.valuesLength!==store.values.length)return null;
      const session={id:nextId++,store,runtime,length:store.length,live:store.live,structure:store.structure,revision:store.revision,valuesLength:store.values.length,status:'open',reason:'',ready:false,registered:false,settled:false,flushes:0,rowsSent:0,label:String(label||'fleet-mutation')};
      mutationSession=session;stats.mutationBegins=(stats.mutationBegins||0)+1;
      post({type:'mutation-begin',id:session.id,tag:{length:session.length,live:session.live,structure:session.structure,revision:session.revision,valuesLength:session.valuesLength}});
      if(tx?.registerUndo){
        tx.registerUndo(()=>settleMutation(session,'rollback'),()=>settleMutation(session,session.ready?'commit':'rollback'));session.registered=true;
        // A missing final flush is a transaction failure, rather than a commit
        // followed by a whole-replica repair. This critical hook runs before
        // registered owners are released, so ordinary rollback is still exact.
        if(typeof tx.afterCommit==='function')tx.afterCommit(()=>{
          const clean=session===mutationSession&&session.status==='open'&&session.ready&&STORE.replicaClean(store)&&synced?.store===store&&synced.runtime===STORE.chunkStamp(store).runtime&&synced.length===store.length&&synced.valuesLength===store.values.length;
          if(!clean){const error=new Error('fleet-mutation-final-flush-required');error.code='FLEET_MUTATION_FINAL_FLUSH_REQUIRED';throw error;}return true;
        },{critical:true,owner:'fleet-engine-mutation',writeContract:{proven:true,readOnly:true}});
      }
      return session;
    }
    function flushMutation(session,store,{final=false}={}){
      if(!session||session!==mutationSession||session.settled||session.status!=='open'||store!==session.store)return false;
      const fail=reason=>{session.status='failed';session.reason=String(reason);stats.mutationFallbacks=(stats.mutationFallbacks||0)+1;stats.lastReason=session.reason;return false;};
      if(disabled||!worker)return fail(disabled||'worker-missing');
      if(STORE.chunkStamp(store).runtime!==session.runtime||needsFull||!synced||synced.store!==store||synced.runtime!==session.runtime)return fail('mutation-store-changed');
      const held=STORE.replicaPending(store);if(held.compactions)return fail('mutation-compaction');
      if(store.length<synced.length)return fail('mutation-shorter');
      const before=stats.rowsSent;
      try{sync(store,{mutation:session.id});}catch(error){disable(`mutation-flush:${error?.message||error}`);return false;}
      const rows=stats.rowsSent-before;session.flushes++;session.rowsSent+=rows;stats.mutationFlushes=(stats.mutationFlushes||0)+1;stats.maxMutationRows=Math.max(stats.maxMutationRows||0,rows);
      if(!STORE.replicaClean(store)||synced.length!==store.length||synced.valuesLength!==store.values.length)return fail('mutation-flush-incomplete');
      session.ready=final===true;return true;
    }
    function finishMutation(session,store){return flushMutation(session,store,{final:true});}
    function settleMutation(session,outcome){
      if(!session||session.settled)return false;session.settled=true;
      let settled=outcome==='commit'?'commit':'rollback';
      const clean=session===mutationSession&&session.status==='open'&&session.ready&&STORE.replicaClean(session.store)&&synced?.store===session.store&&synced.runtime===STORE.chunkStamp(session.store).runtime&&synced.length===session.store.length&&synced.valuesLength===session.store.values.length;
      if(settled==='commit'&&!clean){settled='rollback';needsFull=true;stats.mutationFallbacks=(stats.mutationFallbacks||0)+1;stats.lastReason=session.reason||'mutation-final-flush-missing';}
      const store=session.store,tag=STORE.isStore(store)?{length:store.length,live:store.live,structure:store.structure,revision:store.revision,valuesLength:store.values.length}:null;
      if(worker&&!disabled)try{post({type:'mutation-settle',id:session.id,outcome:settled,tag});}catch(_error){needsFull=true;}
      if(settled==='rollback'&&synced?.store===store){synced.length=store.length;synced.valuesLength=store.values.length;}
      session.status=settled==='commit'?'committed':'rolled-back';if(mutationSession===session)mutationSession=null;
      if(settled==='commit')stats.mutationCommits=(stats.mutationCommits||0)+1;else stats.mutationRollbacks=(stats.mutationRollbacks||0)+1;
      settleWaiters();return settled===outcome;
    }
    const sameExtra=(a,b)=>{if(a===b)return true;try{return JSON.stringify(a)===JSON.stringify(b);}catch(_error){return false;}};
    function changedWindowRows(store,message){
      const indices=message.indices,source=new Uint32Array(message.bytes),target=STORE.views(store).u32,chosen=new Int32Array(indices.length);let count=0;
      for(let k=0;k<indices.length;k++){
        const row=indices[k],src=k*WR,dst=row*WR;let changed=!sameExtra(store.extras?.[row],message.extras?.[k]);
        for(let w=0;!changed&&w<WR;w++)if(source[src+w]!==target[dst+w])changed=true;
        if(changed)chosen[count++]=k;
      }
      if(count===indices.length)return {indices,bytes:message.bytes,extras:message.extras};
      const selected=new Int32Array(count),words=new Uint32Array(count*WR),extras=new Array(count);
      for(let out=0;out<count;out++){const at=chosen[out];selected[out]=indices[at];words.set(source.subarray(at*WR,(at+1)*WR),out*WR);extras[out]=message.extras?.[at];}
      return {indices:selected,bytes:words.buffer,extras};
    }
    // Replays a ready step into the store, inside the caller's transaction. Returns the engine's output, or null (the
    // ticket is then discarded and the caller runs the step itself).
    function apply(ticket,store,{contextKey,tx}={}){
      if(!ticket||ticket.status!=='ready'||ticket.settled||ticket.discarded)return null;
      const refuse=reason=>{stats.fallbacks++;stats.lastReason=reason;discard(ticket);return null;};
      if(store!==ticket.store||store.revision!==ticket.revision||store.values.length!==ticket.valuesLength||store.length!==ticket.length||!STORE.replicaClean(store))return refuse('store-changed');
      if(contextKey!==undefined&&String(contextKey)!==ticket.contextKey)return refuse('context-changed');
      if(!tx?.registerUndo)return refuse('transaction-required');
      const started=clock(),message=ticket.result;
      // From here the store is written: a disagreement throws, and the transaction rolls back what was replayed. The
      // store's journal starts before the first value (it would otherwise start at the first row, and a rollback would
      // keep values interned before it while the worker removes them); a step that changed nothing opens none.
      if(message.values.length||message.indices.length)STORE.journalFor(store);
      STORE.withoutReplicaLog(store,()=>{
        for(const [ref,value] of message.values)if(!STORE.internAt(store,ref,value)){
          needsFull=true;discard(ticket);
          throw new Error(`fleet-thread-value-mismatch:${ref}:length=${store.values.length}:held=${JSON.stringify(store.values[ref]??null).slice(0,60)}:wanted=${JSON.stringify(value).slice(0,60)}:list=${JSON.stringify(message.values.map(([r])=>r))}`);
        }
      });
      STORE.withoutReplicaLog(store,()=>STORE.withoutDirtyLog(store,()=>STORE.writeRows(store,message.indices,message.bytes,message.extras,{revisionDelta:message.revisionDelta,staticRows:message.staticRows})));
      ticket.applied=true;
      tx.registerUndo(()=>settle(ticket,'rollback'),()=>settle(ticket,'commit'));
      replicaHolds(store,message.values);
      stats.applied++;stats.lastApplyMs=clock()-started;stats.maxApplyMs=Math.max(stats.maxApplyMs,stats.lastApplyMs);
      return message.out;
    }
    function applyWindow(ticket,store,{contextKey,tx}={}){
      const session=ticket?.window;
      if(!ticket||!session||ticket.status!=='ready'||ticket.settled||ticket.discarded||session!==windowSession||session.status!=='open')return null;
      const refuse=reason=>{stats.fallbacks++;stats.windowFallbacks++;stats.lastReason=reason;session.reason=reason;needsFull=true;
        // Once any leg has touched the main store, only the outer transaction's
        // undo may release the worker journal. Releasing here lets another fleet
        // command run against bytes that have not yet been rolled back.
        if(session.registered||session.steps>0){session.status='failed';ticket.status='fallback';ticket.reason=reason;ticket.settled=true;ticket.discarded=true;clearTimeout(ticket.timer);tickets.delete(ticket.id);if(pending===ticket)pending=null;settleWaiters();}
        else settleWindow(session,'rollback');return null;};
      if(store!==ticket.store||store!==session.store||store.revision!==ticket.revision||store.values.length!==ticket.valuesLength||store.length!==ticket.length||!STORE.replicaClean(store))return refuse('window-store-changed');
      if(contextKey!==undefined&&String(contextKey)!==ticket.contextKey)return refuse('window-context-changed');
      if(!tx?.registerUndo)return refuse('window-transaction-required');
      const started=clock(),message=ticket.result;
      if(message.windowId!==session.id||Number(message.seq)!==ticket.seq||Number(message.from)!==ticket.from||Number(message.to)!==ticket.to)return refuse('window-result-mismatch');
      if(!session.registered){tx.registerUndo(()=>settleWindow(session,'rollback'),()=>settleWindow(session,'commit'));session.registered=true;}
      const rows=changedWindowRows(store,message);
      if(message.values.length||rows.indices.length)STORE.journalFor(store);
      STORE.withoutReplicaLog(store,()=>{
        for(const [ref,value] of message.values)if(!STORE.internAt(store,ref,value)){
          needsFull=true;throw new Error(`fleet-window-value-mismatch:${ref}:length=${store.values.length}:held=${JSON.stringify(store.values[ref]??null).slice(0,60)}:wanted=${JSON.stringify(value).slice(0,60)}`);
        }
      });
      STORE.withoutReplicaLog(store,()=>STORE.withoutDirtyLog(store,()=>STORE.writeRows(store,rows.indices,rows.bytes,rows.extras,{revisionDelta:message.revisionDelta,staticRows:message.staticRows})));
      ticket.applied=true;ticket.settled=true;tickets.delete(ticket.id);clearTimeout(ticket.timer);if(pending===ticket)pending=null;
      session.revision=store.revision;session.valuesLength=store.values.length;session.length=store.length;session.nextFrom=Number(message.out?.completeTo);session.nextSeq++;session.steps++;
      if(!Number.isFinite(session.nextFrom)||session.nextFrom<ticket.from-1e-6||session.nextFrom>ticket.to+1e-6)return refuse('window-complete-to-invalid');
      replicaHolds(store,message.values);
      stats.applied++;stats.lastApplyMs=clock()-started;stats.maxApplyMs=Math.max(stats.maxApplyMs,stats.lastApplyMs);
      return message.out;
    }
    // Resolves when no step is in flight (commands that write the fleet wait for it).
    function idle(){return pending||windowSession||mutationSession||dispatchRequests.size||replicaBuild?new Promise(resolve=>waiters.push(resolve)):Promise.resolve();}
    const api={
      VERSION,request,apply,discard,beginWindow,requestWindow,applyWindow,settleWindow,beginMutation,flushMutation,finishMutation,settleMutation,idle,prime,
      // Build 372: the health check's fleet issues (fleet-health-core), found by the worker on the replica brought to this
      // store now. Only with no step or window in flight (else null at once: the replica would hold an unsettled step).
      // Resolves with {store, runtime, revision, structure, length, simSeconds, issues} (the store as it was when asked;
      // the caller drops a result for another store), or null.
      health(store,{simSeconds=0}={}){
        if(!prime(store))return null;
        const id=nextId++,tag={store,runtime:STORE.chunkStamp(store).runtime,revision:store.revision,structure:store.structure,length:store.length,simSeconds:Number(simSeconds)||0};
        stats.healthRequests=(stats.healthRequests||0)+1;
        return new Promise(resolve=>{healthChecks.set(id,{tag,resolve});post({type:'health',id,simSeconds:tag.simSeconds});});
      },
      // Build 372: the store's classes of rows (STORE.forEachClass over `fields`, extremes of `numeric`) and, with ids, its id
      // collision check, found by the worker on a replica that is exactly this store now: with nothing in flight it is
      // brought to the store first; with a step or window in flight, only once this side has replayed its result (then
      // both hold that step), its rows written since sent into it (syncIntoOpen). Otherwise null at once (the caller finds
      // them itself).
      // Resolves with {store, runtime, revision, structure, length, rows: [[row, count, index, members], ...], ids}, or
      // null; the caller checks current(result) before it uses one.
      fieldClasses(store,{fields=[],numeric=[],ids=false}={}){
        const tag=replicaIsStore(store);if(!tag)return null;const id=nextId++;
        stats.classRequests=(stats.classRequests||0)+1;
        return new Promise(resolve=>{classRequests.set(id,{tag,resolve});post({type:'classes',id,fields:[...fields],numeric:[...numeric],ids:!!ids});});
      },
      // Build 372: a fleet-query-core pass (name, params) found by the worker on a replica that is exactly this store (as
      // fieldClasses). Resolves with {store, runtime, revision, structure, length, result}, or null (no worker, a replica
      // that is not the store, or a pass that needs the legacy owner table); the caller checks current(result) first.
      query(store,{name,params={},simSeconds=0}={}){
        const tag=replicaIsStore(store);if(!tag)return null;const id=nextId++;
        stats.queryRequests=(stats.queryRequests||0)+1;
        return new Promise(resolve=>{queryRequests.set(id,{tag,resolve});post({type:'query',id,name:String(name),params,simSeconds:Number(simSeconds)||0});});
      },
      // Computes a bulk dispatch against an exact, idle replica. Its binary plan is only a candidate: fleet-dispatch-core
      // validates the fleet, route, catalogue, ownership and request context again before its first main-thread write.
      // One plan at a time also prevents a long speculative pass from queueing event work behind another such pass.
      dispatchPlan(store,{input,timeout=Math.max(timeoutMs*4,60000)}={}){
        if(pending||windowSession||mutationSession||dispatchRequests.size||!STORE.isStore(store)||!input||typeof input!=='object'||!ensureWorker())return null;
        try{sync(store);}catch(error){disable(`dispatch-sync:${error?.message||error}`);return null;}
        if(replicaBuild)return null;
        const id=nextId++,tag={store,runtime:STORE.chunkStamp(store).runtime,revision:store.revision,structure:store.structure,length:store.length,valuesLength:store.values.length},wait=Math.max(1000,Math.floor(Number(timeout)||60000));
        stats.dispatchPlanRequests=(stats.dispatchPlanRequests||0)+1;
        return new Promise(resolve=>{const entry={tag,resolve,timer:null};entry.timer=setTimeout(()=>{if(!dispatchRequests.delete(id))return;stats.dispatchPlanTimeouts=(stats.dispatchPlanTimeouts||0)+1;resolve(null);settleWaiters();},wait);dispatchRequests.set(id,entry);post({type:'dispatch-plan',id,input,tag:{revision:tag.revision,structure:tag.structure,length:tag.length,valuesLength:tag.valuesLength}});});
      },
      // A result of fieldClasses (or health) still describes this store: the same store, runtime, revision, length and
      // structure (every write moves the revision).
      current(result,store){return !!result&&!!store&&result.store===store&&result.runtime===STORE.chunkStamp(store).runtime&&result.revision===store.revision&&result.length===store.length&&result.structure===store.structure;},
      // Read-only guard for callers that must never trigger the first/full
      // replica export (bulk dispatch and large durable mutations). It performs
      // no sync and returns true only for an exact, idle incremental replica.
      // Build 373: the replica belongs to this store and only rows written since the last sync are missing; the next
      // request brings it current with an incremental sync (no full export), as dispatchPlan does itself.
      replicaSyncable(store){return !disabled&&!!worker&&!replicaBuild&&!needsFull&&routesReady&&!pending&&!windowSession&&!mutationSession&&!dispatchRequests.size&&STORE.isStore(store)&&!!synced&&synced.store===store&&synced.runtime===STORE.chunkStamp(store).runtime;},
      replicaReady(store){return !disabled&&!!worker&&!replicaBuild&&!needsFull&&routesReady&&!pending&&!windowSession&&!mutationSession&&!dispatchRequests.size&&STORE.isStore(store)&&!!synced&&synced.store===store&&synced.runtime===STORE.chunkStamp(store).runtime&&synced.length===store.length&&synced.valuesLength===store.values.length&&STORE.replicaClean(store);},
      // The worker's replica as it is once every message posted so far is handled (null without one). For gates only.
      inspect(){if(disabled||!worker||replicaBuild)return Promise.resolve(null);const id=nextId++;return new Promise(resolve=>{inspections.set(id,resolve);post({type:'inspect',id});});},
      markStale(){needsFull=true;if(replicaBuild)abandonReplicaBuild(replicaBuild,'replica-marked-stale');},
      get busy(){return !!pending||!!windowSession||!!mutationSession||!!dispatchRequests.size||!!replicaBuild;},get disabled(){return disabled;},get available(){return !disabled&&typeof workerFactory==='function';},
      budgetTime:()=>lastBudgetTime,stats:()=>({...stats,fullSyncReasons:{...stats.fullSyncReasons},disabled,pending:!!pending,window:!!windowSession,mutation:!!mutationSession,dispatchPending:dispatchRequests.size,replicaPriming:!!replicaBuild,replicaPrimeAttempt:replicaBuild?.attempt||0}),
      terminate(reason='terminated'){disable(reason);}
    };
    // Non-enumerable by design: a decorator/proxy must explicitly preserve the
    // atomic-window contract instead of accidentally advertising it via spread.
    Object.defineProperty(api,'windowProtocol',{value:'journal-v1',enumerable:false});return api;
  }
  const API=Object.freeze({VERSION,create,routeKey});
  globalThis.GH_FLEET_ENGINE_THREAD=API;
  if(globalThis.window&&globalThis.window!==globalThis)globalThis.window.GH_FLEET_ENGINE_THREAD=API;
  if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
