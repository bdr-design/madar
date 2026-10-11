'use strict';
// Build 372: the fleet engine thread keeps its replica from the store's replica log (STORE.drainReplica), and a store
// decoded from the native vault reaches the worker as its own chunk buffers (STORE.setReplicaSeed), moved, not copied.
// With a real worker, after every kind of change the worker's replica must equal the main thread's store byte for byte
// (records, value table, extras, length, live count, structure) and no whole copy of the store may be made:
//   seed + writes made before the first exchange (set, add, remove, extras, new values); a step replayed and committed;
//   one replayed and rolled back; one discarded; the engine run on the main thread (the fallback path) committed and
//   rolled back; a column pass committed and rolled back; rows, extras, a new value, appended rows and columns written
//   after a replayed step (and after a window's leg) and sent into it while it is open, then committed and rolled back (compared
//   inside, and after settling before any new exchange); compactions (two before one exchange, with rows written before
//   and after each); value reclamation; a calendar window rolled back and one committed; and a new store (a reset), the
//   one case that takes a whole copy, counted as such.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),web=path.join(root,'WebApp'),read=file=>fs.readFileSync(path.join(web,file),'utf8');
const FIX=require('./helpers/fleet-fixture');
const workerSource=['fleet-store-core.js','simulation-asset-core.js','fleet-event-core.js','fleet-access-core.js','fleet-health-core.js','fleet-query-core.js'].map(read).join('\n;\n')+'\n;\n'+read('fleet-engine-worker.js').replace(/^importScripts\([^)]*\);$/m,'');
const pageSources=['fleet-store-core.js','simulation-asset-core.js','fleet-event-core.js','fleet-engine-thread.js'].map(read);

(async()=>{
  const executablePath=['/usr/bin/chromium','/usr/bin/chromium-browser'].find(file=>fs.existsSync(file));
  const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
  try{
    const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(String(error)));
    await page.setContent('<!doctype html><meta charset="utf-8">');
    for(const content of pageSources)await page.addScriptTag({content});
    const fleet=FIX.fleet(),N=70000;
    const result=await page.evaluate(async({workerSource,fleet,routes,context,N})=>{
      const STORE=GH_FLEET_STORE,EVENTS=GH_FLEET_EVENTS,log=[];
      const assets=[];for(let i=0;i<N;i++){const a=structuredClone(fleet[i%fleet.length]);a.id=`QA-${String(i).padStart(7,'0')}`;a.name=`QA ${i}`;if(i%997===0)a.note={text:`n${i}`};assets.push(a);}
      let store=STORE.fromAssets(assets,{at:0});assets.length=0;
      // The vault's chunks: copies of the record buffer as decoded, 4 MiB each (the codec's chunk size).
      const chunkBytes=4*1024*1024,byteLength=store.length*STORE.STRIDE,chunks=[];
      for(let at=0;at<byteLength;at+=chunkBytes)chunks.push(store.rows.slice(at,Math.min(byteLength,at+chunkBytes)));
      if(!STORE.setReplicaSeed(store,{chunks,chunkBytes,byteLength}))throw new Error('seed-refused');
      const url=URL.createObjectURL(new Blob([workerSource],{type:'text/javascript'})),plans=new Map(Object.entries(routes));
      let routesRev=0;const client=GH_FLEET_ENGINE_THREAD.create({workerFactory:()=>new Worker(url),resolveRoute:id=>plans.get(String(id))?{...plans.get(String(id))}:null,routesRevision:()=>routesRev,catalogSpecs:()=>({}),timeoutMs:60000});
      const resolveRoute=id=>plans.get(String(id))?{...plans.get(String(id))}:null;
      const ids=()=>[...Array(store.length).keys()].filter(index=>STORE.isAlive(store,index));
      // A transaction as Transaction Core runs it for a row root: one store journal, undo callbacks settled with it.
      const tx=()=>{const journal=STORE.beginJournal(store),undo=[];return {registerUndo(rollback,commit){undo.push([rollback,commit]);},commit(){STORE.endJournal(journal);for(const [,commit] of undo)commit?.();},rollback(){STORE.rollbackJournal(journal);for(let k=undo.length-1;k>=0;k--)undo[k][0]?.();}};};
      // Mutation catch-up starts before the Store lazily opens its journal. This
      // preserves Transaction Core's real owner order: on rollback Store rows
      // are restored first, then the worker's speculative journal is settled.
      const mutationTx=()=>{const undo=[],critical=[];let journal=null;const api={registerUndo(rollback,commit){undo.push([rollback,commit]);},afterCommit(fn){critical.push(fn);},beginStore(){journal=STORE.beginJournal(store);api.registerUndo(()=>STORE.rollbackJournal(journal),()=>STORE.endJournal(journal));},commit(){for(const fn of critical)fn();for(const [,commit] of undo)commit?.();},rollback(){for(let k=undo.length-1;k>=0;k--)undo[k][0]?.();}};return api;};
      const until=async test=>{for(let k=0;k<20000&&!test();k++)await new Promise(resolve=>setTimeout(resolve,2));if(!test())throw new Error('timeout');};
      // prime:false compares the replica as it is (a step or window open, or just settled), with no exchange first.
      const check=async(label,{prime=true}={})=>{
        if(prime&&!client.prime(store))throw new Error(`${label}: prime refused (${client.stats().lastReason})`);
        const replica=await client.inspect();if(!replica)throw new Error(`${label}: no replica`);
        const a=new Uint8Array(store.rows,0,store.length*STORE.STRIDE),b=new Uint8Array(replica.rows);let row=-1;
        if(a.length!==b.length)row=-2;else for(let i=0;i<a.length;i++)if(a[i]!==b[i]){row=Math.floor(i/STORE.STRIDE);break;}
        const norm=list=>JSON.stringify(list.map(value=>value===undefined?null:value));
        const same={rows:row===-1,values:norm(store.values)===norm(replica.values),extras:JSON.stringify(store.extras)===JSON.stringify(replica.extras),length:store.length===replica.length,live:store.live===replica.live,structure:store.structure===replica.structure,workerLog:replica.replicaLogClean===true};
        log.push({label,row,...same,fullSyncs:client.stats().fullSyncs});
        if(Object.values(same).some(ok=>!ok))throw new Error(`${label}: replica differs ${JSON.stringify({row,...same})}`);
      };
      const step=async(from,to)=>{const ticket=client.request(store,{from,to,context:context,contextKey:'k',tripAlertLimit:64,order:'events',maxEvents:4000,budget:4000});if(!ticket)throw new Error('request-refused');await until(()=>ticket.status!=='pending');if(ticket.status!=='ready')throw new Error(`step ${ticket.status}:${ticket.reason}`);return ticket;};
      const replay=async(from,to,outcome)=>{const ticket=await step(from,to),t=tx();const out=client.apply(ticket,store,{contextKey:'k',tx:t});if(!out)throw new Error(`apply refused ${client.stats().lastReason}`);if(outcome==='commit')t.commit();else t.rollback();return out;};

      // 1. Seed, with writes made before the first exchange.
      for(const index of ids().slice(0,300))STORE.set(store,index,'condition',50+index%40);
      for(let i=0;i<64;i++)STORE.add(store,{...structuredClone(fleet[i%fleet.length]),id:`QA-NEW-${i}`,name:`New ${i}`,note:{i}});
      STORE.set(store,7,'note',{text:'patched'});STORE.set(store,11,'registration','QA-REG-UNIQUE');
      STORE.removeMany(store,ids().filter(index=>index%2311===5));
      await check('seed');
      const seedStats=client.stats();
      const detached=chunks.every(chunk=>chunk.byteLength===0);
      // 1b. A durable bulk writer streams only each bounded append slice into
      // one worker journal. Commit keeps it; rollback restores it even when the
      // final main-side slice was never flushed. No final readRows over the
      // aggregate append is allowed, and simulation stays blocked while open.
      {
        const before=client.stats(),x=mutationTx(),session=client.beginMutation(store,{tx:x,label:'qa-mutation-commit'});if(!session)throw new Error('mutation begin refused');x.beginStore();
        if(client.request(store,{from:0,to:1,context,contextKey:'blocked'})!==null)throw new Error('simulation entered open mutation');
        for(let batch=0;batch<4;batch++){
          for(let i=0;i<37;i++)STORE.add(store,{...structuredClone(fleet[(batch+i)%fleet.length]),id:`QA-MUT-C-${batch}-${i}`,name:`Mutation commit ${batch}/${i}`});
          if(!client.flushMutation(session,store))throw new Error(`mutation flush ${batch} refused:${session.reason}`);
          await check(`mutation-commit-open-${batch}`,{prime:false});
        }
        for(let i=0;i<19;i++)STORE.add(store,{...structuredClone(fleet[i%fleet.length]),id:`QA-MUT-C-F-${i}`,name:`Mutation commit final ${i}`});
        if(!client.finishMutation(session,store))throw new Error(`mutation final refused:${session.reason}`);await check('mutation-commit-final',{prime:false});x.commit();
        await check('mutation-commit-settled',{prime:false});
        const after=client.stats();if(after.fullSyncs!==before.fullSyncs||after.maxMutationRows>37||(after.mutationFlushes||0)-(before.mutationFlushes||0)!==5)throw new Error(`mutation commit was not bounded:${JSON.stringify({before,after})}`);
      }
      await check('mutation-before-rollback');
      {
        const originalLength=store.length,x=mutationTx(),session=client.beginMutation(store,{tx:x,label:'qa-mutation-rollback'});if(!session)throw new Error('rollback mutation begin refused');x.beginStore();
        for(let batch=0;batch<3;batch++){for(let i=0;i<29;i++)STORE.add(store,{...structuredClone(fleet[i%fleet.length]),id:`QA-MUT-R-${batch}-${i}`,name:`Mutation rollback ${batch}/${i}`});if(!client.flushMutation(session,store))throw new Error('rollback mutation flush refused');}
        // Deliberately leave one slice only on main; both journals must still
        // land at the same pre-mutation bytes and counters after outer rollback.
        for(let i=0;i<13;i++)STORE.add(store,{...structuredClone(fleet[i%fleet.length]),id:`QA-MUT-R-U-${i}`,name:`Mutation rollback unflushed ${i}`});x.rollback();
        if(store.length!==originalLength)throw new Error('mutation main rollback length');await check('mutation-rollback-settled',{prime:false});await check('mutation-rollback-next');
      }
      // 2. Steps replayed: committed, rolled back, discarded.
      let t=0;await replay(t,t+1800,'commit');t+=1800;await check('step-commit');
      await replay(t,t+1800,'rollback');await check('step-rollback');
      {const ticket=await step(t,t+1800);client.discard(ticket);}await check('step-discard');
      // 3. The engine on this thread (a refused result's fallback), committed and rolled back.
      for(const outcome of ['commit','rollback']){
        const x=tx();EVENTS.advance(store,{from:t,to:t+3600,context,resolveRoute,catalogSpecs:()=>null,tripAlertLimit:64,order:'events'});
        if(outcome==='commit'){x.commit();t+=3600;}else x.rollback();await check(`main-engine-${outcome}`);
      }
      // 4. A column pass (the daily flight counters), committed and rolled back.
      // Clear one presence bit first: columnWriter must log/send `present` itself when the pass exposes that field. The
      // thread no longer copies the presence column for passes whose fields were already present everywhere.
      STORE.set(store,ids()[0],'flightHours',undefined);await check('column-presence-prep');
      for(const outcome of ['commit','rollback']){
        const x=tx(),put=STORE.columnWriter(store,['flightHours']);for(const index of ids())put(index,'flightHours',(index%500)+(outcome==='commit'?1:2));
        outcome==='commit'?x.commit():x.rollback();await check(`column-${outcome}`);
      }
      // 4b. An exchange while the transaction is open (the replica takes its uncommitted writes), then its rollback: the
      // rows and columns it restores must reach the replica too.
      {
        const x=tx(),put=STORE.columnWriter(store,['flightHours']);for(const index of ids())put(index,'flightHours',7777);
        for(const index of ids().slice(0,500))STORE.set(store,index,'condition',12);STORE.add(store,{...structuredClone(fleet[0]),id:'QA-INSIDE',name:'Inside'});
        if(!client.prime(store))throw new Error('prime inside refused');x.rollback();await check('rollback-after-exchange');
      }
      // A value-table-only append has no row or fleet-length change. Its rollback must still send the shorter value
      // table to the worker; otherwise the main-side length tag can say current while inspect exposes a stale tail.
      {
        const x=tx();STORE.intern(store,{qa:'value-only-open'});if(!client.prime(store))throw new Error('prime value-only refused');
        await check('value-only-open',{prime:false});x.rollback();await check('value-only-rollback');
      }
      // 4c. Rows written here after a replayed step while it is open (the rest of a slice before its post-commit checks):
      // a request that needs the replica to be the store (fieldClasses) sends them into the step, which journals them with
      // its own rows. The replica equals the store inside the step (then after a second write and exchange), and after
      // the step's commit or rollback before any new exchange (the worker's journal settled them itself); then the same
      // for a calendar window after its leg, and for columns rewritten wholesale after a step. New route plans after a step
      // keep the refusal.
      const writeInside=tag=>{
        const live=ids();for(const index of live.slice(1000,1400))STORE.set(store,index,'condition',tag.endsWith('commit')?41:42);
        STORE.set(store,live[1500],'note',{inside:tag});STORE.set(store,live[1501],'registration',`QA-OPEN-${tag}`);
        for(let i=0;i<3;i++)STORE.add(store,{...structuredClone(fleet[i%fleet.length]),id:`QA-OPEN-${tag}-${i}`,name:`Open ${i}`});
      };
      const askInside=async label=>{
        const asked=client.fieldClasses(store,{fields:['type','mode']});if(!asked)throw new Error(`${label}: refused ${JSON.stringify(client.stats().replicaRefusals)}`);
        const found=await asked;if(!found||!client.current(found,store))throw new Error(`${label}: no current result`);
      };
      const sparseColumns=(seed,{transfer=true,limit=Infinity,exceptional=false}={})=>{
        const rows=ids().slice(0,limit),fields=['flightHours','flightCycles','nextCheckHours'],indices=Int32Array.from(rows),values=exceptional?new Float64Array(rows.length*fields.length):new Float32Array(rows.length*fields.length),plan={fields,indices,values,count:rows.length};
        for(let row=0;row<rows.length;row++){values[row*3]=(row+seed)%8192;values[row*3+1]=(row+seed)%1024;values[row*3+2]=600+(row+seed)%2048;}
        if(exceptional&&rows.length>8){plan.exceptionalPositions=new Int32Array([7]);values[21]=Infinity;values[22]=.1;values[23]=-Infinity;}
        const stages=STORE.columnPlanStages(store,plan,{rowSlice:1024,label:'qa.sparse-columns',replicaTransfer:transfer});let step;while(!(step=stages.next()).done){}if(step.value.count!==rows.length)throw new Error('sparse column plan incomplete');return {plan,result:step.value};
      };
      const dualSparseColumns=seed=>{
        const rows=ids(),fields=['flightHours','flightCycles','nextCheckHours'],exceptionAt=7,indices=new Int32Array(rows.length-1),values=new Float32Array((rows.length-1)*3),exceptionalIndices=new Int32Array([rows[exceptionAt]]),exceptionalValues=new Float64Array([Infinity,.1,-Infinity]);let out=0;
        for(let row=0;row<rows.length;row++){if(row===exceptionAt)continue;indices[out]=rows[row];values[out*3]=(row+seed)%8192;values[out*3+1]=(row+seed)%1024;values[out*3+2]=600+(row+seed)%2048;out++;}
        const plan={fields,indices,values,count:indices.length,exceptional:{indices:exceptionalIndices,values:exceptionalValues,count:1},totalCount:rows.length},stages=STORE.columnPlanStages(store,plan,{rowSlice:1024,label:'qa.dual-sparse-columns',replicaTransfer:true});let step;while(!(step=stages.next()).done){}if(step.value.count!==rows.length||!step.value.replicaTransfer)throw new Error('dual sparse column plan incomplete');return {plan,result:step.value};
      };
      // Keep a dense shared free stack for the step/window cases below. The worker may consume some refs while advancing,
      // so the tests prove same-length reuse from the post-apply table instead of assuming one preselected ref survives.
      for(let index=0;index<8192;index++)STORE.intern(store,{qa:'open-reuse-hole',index});STORE.collectValues(store);await check('open-reuse-prepared');
      // A value interned here reuses a free ref while the worker's step journal is open. Sending it into that step and
      // rolling back must free the same ref on both sides before any new prime/exchange.
      {
        const ticket=await step(t,t+1),x=tx();if(!client.apply(ticket,store,{contextKey:'k',tx:x}))throw new Error('apply open-reuse refused');
        const length=store.values.length,free=STORE.stats(store).freeValues,reused=STORE.intern(store,{qa:'open-reused-value'});
        if(reused>=length||store.values.length!==length||STORE.stats(store).freeValues!==free-1)throw new Error(`open step did not reuse one free ref: ${reused}/${length}`);
        await askInside('open-reuse-sent');await check('open-reuse-inside',{prime:false});x.rollback();
        await check('open-reuse-rollback-settled',{prime:false});await check('open-reuse-next');
      }
      // Same-length reuse after request is invisible to revision/length stamps. The dirty replica log must make apply
      // reject the stale ticket before it can replay worker refs over the main thread's newly occupied ref.
      {
        const ticket=await step(t,t+1),x=tx(),length=store.values.length,reused=STORE.intern(store,{qa:'reuse-after-request'});
        if(reused>=length||store.values.length!==length)throw new Error('request guard setup did not reuse');
        if(client.apply(ticket,store,{contextKey:'k',tx:x})!==null)throw new Error('dirty value reuse after request was accepted');
        if(client.stats().lastReason!=='store-changed')throw new Error(`wrong dirty ticket reason: ${client.stats().lastReason}`);
        x.rollback();await check('reuse-after-request-settled',{prime:false});await check('reuse-after-request-next');
      }
      for(const outcome of ['commit','rollback']){
        const ticket=await step(t,t+1800),x=tx();if(!client.apply(ticket,store,{contextKey:'k',tx:x}))throw new Error(`apply refused ${client.stats().lastReason}`);
        writeInside(`step-${outcome}`);await askInside(`in-step-${outcome}`);await check(`in-step-${outcome}`,{prime:false});
        STORE.set(store,ids()[1600],'condition',43);await askInside(`in-step-again-${outcome}`);await check(`in-step-again-${outcome}`,{prime:false});
        if(outcome==='commit'){x.commit();t+=1800;}else x.rollback();
        await check(`in-step-${outcome}-settled`,{prime:false});await check(`in-step-${outcome}-next`);
      }
      // Two real legs retain one outer rollback journal, while each worker result contains only that leg's delta. Between
      // legs a dense main-origin reuse batch is synced into the open worker journal; the second result must not echo it.
      for(const outcome of ['rollback','commit']){
        const session=client.beginWindow(store,{from:t,target:t+2});if(!session)throw new Error('window refused');const x=tx();
        let ticket=client.requestWindow(session,store,{from:t,to:t+1,context,contextKey:'w',tripAlertLimit:64,order:'events',budget:40000});if(!ticket)throw new Error(`window first leg refused ${session.reason}`);
        await until(()=>ticket.status!=='pending');if(!client.applyWindow(ticket,store,{contextKey:'w',tx:x}))throw new Error(`window first apply refused ${session.reason}`);
        const length=store.values.length,refs=[];for(let index=0;index<512;index++){const ref=STORE.intern(store,{qa:`window-${outcome}`,index});if(ref>=length)throw new Error('dense window reuse appended');refs.push(ref);}
        if(store.values.length!==length||new Set(refs).size!==refs.length)throw new Error('dense window reuse was not one-ref-per-value');
        await askInside(`in-window-reuse-${outcome}`);await check(`in-window-reuse-${outcome}`,{prime:false});
        ticket=client.requestWindow(session,store,{from:t+1,to:t+2,context,contextKey:'w',tripAlertLimit:64,order:'events',budget:40000});if(!ticket)throw new Error(`window second leg refused ${session.reason}`);
        await until(()=>ticket.status!=='pending');const reusedSet=new Set(refs);if(ticket.result.values.some(([ref])=>reusedSet.has(ref)))throw new Error('second window leg resent cumulative value refs');
        if(!client.applyWindow(ticket,store,{contextKey:'w',tx:x}))throw new Error(`window second apply refused ${session.reason}`);
        await check(`in-window-${outcome}`,{prime:false});
        if(outcome==='commit'){x.commit();t+=2;}else x.rollback();
        if(refs.some(ref=>(store.values[ref]===null)!==(outcome==='rollback')))throw new Error(`window ${outcome} value settlement mismatch`);
        await check(`in-window-${outcome}-settled`,{prime:false});await check(`in-window-${outcome}-next`);
      }
      // A same-length reuse that has not been synced after leg one must block leg two. Revision and table length alone are
      // unchanged; this is specifically the STORE.replicaClean guard on requestWindow.
      {
        const session=client.beginWindow(store,{from:t,target:t+2});if(!session)throw new Error('dirty window refused');const x=tx();
        const first=client.requestWindow(session,store,{from:t,to:t+1,context,contextKey:'dirty-w',tripAlertLimit:64,order:'events',budget:40000});if(!first)throw new Error('dirty window first leg refused');
        await until(()=>first.status!=='pending');if(!client.applyWindow(first,store,{contextKey:'dirty-w',tx:x}))throw new Error('dirty window first apply refused');
        const length=store.values.length,reused=STORE.intern(store,{qa:'reuse-between-window-legs'});if(reused>=length||store.values.length!==length)throw new Error('between-leg guard setup did not reuse');
        if(client.requestWindow(session,store,{from:t+1,to:t+2,context,contextKey:'dirty-w',tripAlertLimit:64,order:'events',budget:40000})!==null||session.reason!=='store-changed')throw new Error(`dirty between-leg reuse was accepted: ${session.reason}`);
        x.rollback();await check('reuse-between-window-legs-settled',{prime:false});await check('reuse-between-window-legs-next');
      }
      // Columns rewritten wholesale after the step (the day close's flight counters) go into it too, through its journal's
      // column snapshot: equal inside, and after commit or rollback before any new exchange.
      for(const outcome of ['rollback','commit']){
        const ticket=await step(t,t+1800),x=tx();if(!client.apply(ticket,store,{contextKey:'k',tx:x}))throw new Error('apply refused');
        const put=STORE.columnWriter(store,['flightHours','flightCycles']);for(const index of ids()){put(index,'flightHours',4242+index%7);put(index,'flightCycles',outcome==='commit'?11:12);}
        STORE.set(store,ids()[1700],'condition',44);
        await askInside(`in-step-columns-${outcome}`);await check(`in-step-columns-${outcome}`,{prime:false});
        if(outcome==='commit'){x.commit();t+=1800;}else x.rollback();
        await check(`in-step-columns-${outcome}-settled`,{prime:false});await check(`in-step-columns-${outcome}-next`);
      }
      // The staged daily plan returns its original sparse typed buffers to the worker. No full-column gather runs on the
      // UI thread, and the open worker journal still gives byte-identical commit and rollback. A column written before the
      // plan deliberately selects the complete-column fallback because the plan cannot describe that earlier ordering.
      for(const outcome of ['rollback','commit']){
        const ticket=await step(t,t+1800),x=tx();if(!client.apply(ticket,store,{contextKey:'k',tx:x}))throw new Error('sparse apply refused');
        const beforeStats=client.stats(),sparse=outcome==='rollback'?dualSparseColumns(23):sparseColumns(17);if(!sparse.result.replicaTransfer)throw new Error('sparse plan ownership was not accepted');await askInside(`in-step-sparse-${outcome}`);const afterStats=client.stats();
        if(afterStats.columnPlanSyncs!==beforeStats.columnPlanSyncs+1||afterStats.columnSyncs!==beforeStats.columnSyncs)throw new Error(`sparse plan used wrong transport: ${JSON.stringify({beforeStats,afterStats})}`);
        if(sparse.plan.indices.byteLength!==0||sparse.plan.values.byteLength!==0||sparse.plan.exceptionalPositions&&sparse.plan.exceptionalPositions.byteLength!==0||sparse.plan.exceptional&&(sparse.plan.exceptional.indices.byteLength!==0||sparse.plan.exceptional.values.byteLength!==0))throw new Error(`owned sparse buffers were not transferred/detached:${JSON.stringify({indices:sparse.plan.indices.byteLength,values:sparse.plan.values.byteLength,exceptionalIndices:sparse.plan.exceptional?.indices.byteLength,exceptionalValues:sparse.plan.exceptional?.values.byteLength})}`);
        try{const reused=STORE.columnPlanStages(store,sparse.plan,{replicaTransfer:true});reused.next();throw new Error('detached sparse plan was reusable');}catch(error){if(!String(error?.message||error).includes('fleet-store-column-plan-invalid'))throw error;}
        await check(`in-step-sparse-${outcome}`,{prime:false});if(outcome==='commit'){x.commit();t+=1800;}else x.rollback();
        await check(`in-step-sparse-${outcome}-settled`,{prime:false});await check(`in-step-sparse-${outcome}-next`);
      }
      {
        const ticket=await step(t,t+1800),x=tx();if(!client.apply(ticket,store,{contextKey:'k',tx:x}))throw new Error('sparse fallback apply refused');
        const put=STORE.columnWriter(store,['condition']);for(const index of ids().slice(0,64))put(index,'condition',55);const beforeStats=client.stats(),sparse=sparseColumns(31);if(sparse.result.replicaTransfer)throw new Error('ordered fallback incorrectly retained sparse ownership');await askInside('in-step-sparse-fallback');const afterStats=client.stats();
        if(afterStats.columnPlanSyncs!==beforeStats.columnPlanSyncs||afterStats.columnSyncs!==beforeStats.columnSyncs+1)throw new Error('prior column write did not select full-column fallback');
        if(!sparse.plan.indices.byteLength||!sparse.plan.values.byteLength)throw new Error('fallback detached caller-owned buffers');
        await check('in-step-sparse-fallback',{prime:false});x.rollback();await check('in-step-sparse-fallback-settled',{prime:false});await check('in-step-sparse-fallback-next');
      }
      // Without the explicit ownership flag, a caller can keep and reuse its plan after replica sync. Both exchanges use
      // the complete-column fallback and leave the typed buffers attached.
      {
        const reusable=sparseColumns(41,{transfer:false,limit:2048});if(reusable.result.replicaTransfer)throw new Error('reusable plan was consumed');const beforeStats=client.stats();if(!client.prime(store))throw new Error('reusable plan prime refused');await check('sparse-reusable-first',{prime:false});
        if(client.stats().columnSyncs!==beforeStats.columnSyncs+1||!reusable.plan.indices.byteLength||!reusable.plan.values.byteLength)throw new Error('reusable plan changed ownership');
        const stages=STORE.columnPlanStages(store,reusable.plan,{rowSlice:1024,replicaTransfer:false});let stepResult;while(!(stepResult=stages.next()).done){}if(stepResult.value.replicaTransfer)throw new Error('reused plan was consumed');if(!client.prime(store))throw new Error('reused plan second prime refused');await check('sparse-reusable-second',{prime:false});
        if(!reusable.plan.indices.byteLength||!reusable.plan.values.byteLength)throw new Error('reused plan buffers detached');
      }
      // New route plans after a step keep the refusal (the caller reads the store itself).
      {
        const ticket=await step(t,t+1800),x=tx();if(!client.apply(ticket,store,{contextKey:'k',tx:x}))throw new Error('apply refused');
        STORE.set(store,ids()[1800],'condition',45);routesRev++;
        const refused=client.fieldClasses(store,{fields:['type']})===null;x.rollback();
        if(!refused)throw new Error('new route plans after a step were not refused');await check('in-step-routes-refused');
      }
      // 5. Compactions: two before one exchange, rows written before and after each.
      STORE.removeMany(store,ids().filter(index=>index%7===3));STORE.set(store,ids()[100],'condition',33);STORE.compactRows(store);
      STORE.set(store,ids()[200],'condition',34);STORE.removeMany(store,ids().filter(index=>index%9===4));STORE.compactRows(store);STORE.set(store,ids()[300],'note',{after:true});
      await check('compactions');
      await replay(t,t+1800,'commit');t+=1800;await check('step-after-compaction');
      // 6. Values no live row references reclaimed.
      STORE.collectValues(store);await check('collect-values');
      for(let i=0;i<20;i++)STORE.set(store,ids()[i],'registration',`QA-REUSE-${i}`);await check('values-reused');
      // 7. Calendar windows: rolled back, then committed.
      for(const outcome of ['rollback','commit']){
        const session=client.beginWindow(store,{from:t,target:t+7200});if(!session)throw new Error('window refused');
        const x=tx();
        for(const [from,to] of [[t,t+3600],[t+3600,t+7200]]){
          const ticket=client.requestWindow(session,store,{from,to,context,contextKey:'w',tripAlertLimit:64,order:'sweep',budget:40000});if(!ticket)throw new Error(`window step refused ${session.reason}`);
          await until(()=>ticket.status!=='pending');const out=client.applyWindow(ticket,store,{contextKey:'w',tx:x});if(!out)throw new Error(`window apply refused ${session.reason}`);
        }
        if(outcome==='commit'){x.commit();t+=7200;}else x.rollback();
        await check(`window-${outcome}`);
      }
      const before=client.stats();
      // 8. A new store (a hard reset): a whole copy, the one case that takes one.
      store=STORE.fromAssets(fleet.slice(0,40).map((a,i)=>({...structuredClone(a),id:`QA-RESET-${i}`})),{at:t});
      await check('store-replaced');await replay(t,t+1800,'commit');await check('step-after-reset');
      const after=client.stats();client.terminate('done');
      return {log,detached,seedStats,before,after};
    },{workerSource,fleet,routes:FIX.routes,context:FIX.context(0),N});
    assert.deepEqual(errors,[]);
    for(const row of result.log)console.log(JSON.stringify(row));
    assert.equal(result.detached,true,'the seed chunks were moved to the worker, not copied');
    assert.equal(result.seedStats.seedSyncs,1);assert.equal(result.seedStats.fullSyncs,0);
    assert.equal(result.before.fullSyncs,0,'no whole copy before the reset');assert.deepEqual(result.before.fullSyncReasons,{});
    assert.ok(result.before.compactions>=2);assert.ok(result.before.applied>=4);assert.equal(result.before.windowCommits,2);assert.equal(result.before.windowRollbacks,3);
    assert.equal(result.before.openSyncs,12,'rows, columns, sparse plans, and a reused value ref written after a replayed step or window leg went into it');
    assert.equal(result.before.columnPlanSyncs,2,'committed and rolled-back sparse plans reused their typed buffers');
    assert.deepEqual(result.before.replicaRefusals,{'routes-since-step':1});
    assert.equal(result.after.fullSyncs,1);assert.deepEqual(result.after.fullSyncReasons,{'store-replaced':1});
    console.log(JSON.stringify({ok:true,steps:result.after.applied,seedMs:result.seedStats.maxSeedSyncMs,routeAnswerMs:result.seedStats.maxRouteAnswerMs}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
