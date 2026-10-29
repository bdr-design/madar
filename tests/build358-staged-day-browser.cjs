'use strict';
// Build 358 section 6: a live day boundary is ONE staged transaction stepped across frames by the real engine
// (requestAnimationFrame -> GH_SIMULATION_CORE -> createSimulationSliceJob -> GH_TRANSACTION_CORE.beginStaged).
// With 120 aircraft on routes this checks, in the full app:
//  - the close spans several simulation ticks with no long task (>50 ms) while it runs, and the day commits;
//  - a save requested during the close is deferred (nothing is written until it ends), then written with the closed day;
//  - a player command issued during the close waits for it and then commits;
//  - pausing or hiding the app mid-close aborts the transaction and restores the state exactly (everything but the
//    diagnostics log, which records the pause/hide itself and is never part of a transaction, and the fleet store's
//    cache epoch, which a rollback advances by design).
const assert=require('node:assert/strict');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');
const QTY=120;

(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    const {page}=await boot({browser,errors});
    await page.evaluate(async qty=>{
      const a=__AUDIT__,s=()=>__GH_STATE__,type='air',definition=GH_COMPANY_PLATFORM.definitionFor(s(),type);
      await a.runAuthorizedDomainCommand('corporate','open-company',{type,companyId:type,capital:Math.max(400000000,definition.founding.minimumCapital),legalName:'QA Staged Day',formationContract:'QA-STAGED-DAY'},{silent:true});
      const airport=GH_WORLD_DATA.airports.find(r=>r[0]==='OMDB');
      const facility={id:'QA-air-OMDB',name:'QA Airport OMDB',kind:'airport-base',company:type,ownerCompanyId:type,owned:true,sourceKey:'air:OMDB',code:airport[1]||airport[0],icao:airport[0],iata:airport[1],city:airport[3]||airport[4]||'—',country:String(airport[5]||'—'),coords:[airport[6],airport[7]]};
      await a.runAuthorizedDomainCommand('facilities','create',{facility,bucket:'globalBases'},{silent:true});
      const model=[...GH_ASSET_CATALOG[type].used].sort((x,y)=>(x.leaseMonthly||0)-(y.leaseMonthly||0)||x.price-y.price)[0];
      if(!await a.buyAsset(type,'used',model.id,'lease',qty,facility.id,true,'QA-STAGED-DAY-'+qty,type))throw new Error('purchase rejected');
      a.openDrawer('routes',type);
    },QTY);
    const dispatch=page.locator('.dispatch-international-network[data-company="air"]').first();
    await dispatch.waitFor({state:'visible',timeout:30000});await dispatch.click();
    await page.waitForFunction(qty=>{const owned=GH_FLEET_DATA.filter(__GH_STATE__,x=>(x.ownerCompanyId||x.companyId)==='air');return owned.length===qty&&owned.every(x=>x.routeId);},QTY,{timeout:120000});
    // Build 359: the dispatch assigns in chunks, so the routes show before the command ends; it reopens the routes panel
    // when it commits. Wait for that before the next panel.
    await page.waitForFunction(()=>!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked(),null,{timeout:180000});await page.evaluate(()=>GH_PERSISTENCE.drain());
    await page.evaluate(()=>__AUDIT__.closeDrawer());

    // Paused one game second before the next midnight (calendar advance: the one-call path). The next live slice is
    // therefore exactly the day-boundary slice, and its rollback point is the state captured here.
    const beforeMidnight=async()=>{
      const target=await page.evaluate(()=>(Math.floor((__GH_STATE__.simSeconds+2)/86400)+1)*86400-1);
      const request=await page.evaluate(t=>__AUDIT__.simulationEngine.advanceTo(t,{reason:'qa-staged-day'}),target);
      assert.equal(request.accepted,true,JSON.stringify(request));
      await page.waitForFunction(()=>!__AUDIT__.simulationEngine.snapshot().manualAdvance,null,{timeout:120000});
      const at=await page.evaluate(()=>({sim:__GH_STATE__.simSeconds,speed:__GH_STATE__.speed,staged:GH_TRANSACTION_CORE.isStaged(__GH_STATE__)}));
      assert.deepEqual(at,{sim:target,speed:0,staged:false});
    };

    // 1. Commit, with a save and a player command issued while the close is staged.
    await beforeMidnight();
    const commit=await page.evaluate(async()=>{
      const TX=GH_TRANSACTION_CORE,s=()=>__GH_STATE__,startDay=s().lastFinancialDay,long=[],writes=[],frames=[];
      const write=localStorage.setItem;localStorage.setItem=function(key,value){writes.push({t:performance.now(),staged:TX.isStaged(s()),day:(()=>{try{return JSON.parse(value).lastFinancialDay;}catch{return null;}})()});return write.call(this,key,value);};
      const observer=new PerformanceObserver(list=>{for(const entry of list.getEntries())long.push({start:entry.startTime,duration:entry.duration});});observer.observe({entryTypes:['longtask']});
      // Each simulation tick (the close's steps and its commit run in them), staged or not at its start and end.
      const engine=__AUDIT__.simulationEngine,engineFrame=engine.frame,ticks=[];engine.frame=function(...args){const from=performance.now(),was=TX.isStaged(s());try{return engineFrame.apply(this,args);}finally{ticks.push({from,until:performance.now(),was,is:TX.isStaged(s())});}};
      let save=null,command=null,commandSettledAt=null,commandError=null,prev=performance.now();
      __AUDIT__.setSpeed(3);
      await new Promise(resolve=>{const tick=now=>{const staged=TX.isStaged(s());frames.push({t:now,gap:now-prev,staged});prev=now;
        if(staged&&!command){
          save={result:__AUDIT__.save(),t:now};
          const airport=GH_WORLD_DATA.airports.find(r=>r[0]==='OMAA');
          const facility={id:'QA-air-OMAA',name:'QA Airport OMAA',kind:'airport-base',company:'air',ownerCompanyId:'air',owned:true,sourceKey:'air:OMAA',code:airport[1]||airport[0],icao:airport[0],iata:airport[1],city:airport[3]||airport[4]||'—',country:String(airport[5]||'—'),coords:[airport[6],airport[7]]};
          command=__AUDIT__.runAuthorizedDomainCommand('facilities','create',{facility,bucket:'globalBases'},{silent:true}).then(()=>true,error=>{commandError=String(error?.message||error);return false;}).finally(()=>{commandSettledAt=performance.now();});
        }
        if((s().lastFinancialDay>startDay&&!staged)||frames.length>900)return resolve();
        requestAnimationFrame(tick);};requestAnimationFrame(tick);});
      __AUDIT__.setSpeed(0);
      const committed=await command;await new Promise(resolve=>setTimeout(resolve,400));
      observer.disconnect();localStorage.setItem=write;engine.frame=engineFrame;
      const staged=frames.filter(f=>f.staged),first=staged[0]?.t??0,end=staged.at(-1)?.t??0,commitTick=ticks.find(tick=>tick.was&&!tick.is);
      return {startDay,day:s().lastFinancialDay,stagedFrames:staged.length,stagedTicks:ticks.filter(tick=>tick.was||tick.is).length,stagedMs:end-first,maxGap:Math.max(0,...staged.map(f=>f.gap)),
        // The close runs from its first staged frame to the end of the simulation tick that commits it (the tick that
        // starts staged and ends not). It used to end a frame (17 ms) after the last staged frame, which took in what
        // follows the close when it starts that soon: the save deferred during it, its own timer task once the state is
        // no longer staged (with the processor slowed twice here, a 62 ms task 15 ms after the last staged frame, holding
        // the save's write). That save and the day's compaction after the close are not bounded here.
        longDuringClose:long.filter(task=>task.start+task.duration>=first&&task.start<=commitTick?.until),commitTick:!!commitTick,
        save,writes,commandIssuedWhileStaged:!!command,committed,commandError,commandSettledAt,stagedEnd:end,
        facility:(s().globalBases||[]).some(f=>f.id==='QA-air-OMAA'),deferredDiag:(s().diagnostics?.events||[]).some(e=>e.type==='SAVE_DEFERRED_STAGED')};
    });
    assert.equal(commit.day,commit.startDay+1,'the day close must commit');
    assert.equal(commit.commitTick,true,'the close commits in a simulation tick');
    // The close spans several simulation ticks (tasks), read from the engine's own ticks: with presentation frames
    // slowed to 80 ms a close of a few ticks fell within one frame (the early warning, as on 88f4014, 3 runs in 5).
    assert(commit.stagedTicks>=2,`the close must be staged across simulation ticks: ${JSON.stringify(commit)}`);
    assert.deepEqual(commit.longDuringClose,[],`no long task while the close runs: ${JSON.stringify(commit.longDuringClose)}`);
    assert.equal(commit.save?.result,true,'a save during the close is accepted (deferred), not dropped');
    assert(!commit.writes.some(w=>w.staged),`nothing is written while staged: ${JSON.stringify(commit.writes)}`);
    assert(commit.writes.some(w=>w.t>=commit.stagedEnd&&w.day===commit.day),`the deferred save writes the closed day: ${JSON.stringify(commit.writes)}`);
    assert.equal(commit.deferredDiag,true,'SAVE_DEFERRED_STAGED is recorded');
    assert.equal(commit.commandIssuedWhileStaged,true);
    assert.equal(commit.committed,true,`the waiting player command commits: ${commit.commandError}`);
    assert(commit.commandSettledAt>=commit.stagedEnd,'the player command finishes only after the close');
    assert.equal(commit.facility,true);
    console.log(`commit: ${commit.stagedFrames} frames, ${commit.stagedMs.toFixed(1)} ms, longest frame gap ${commit.maxGap.toFixed(1)} ms, no long task; save deferred; command waited`);

    // 2. Pause and hide mid-close: the transaction is aborted and the state is restored exactly.
    for(const how of ['pause','hide']){
      await beforeMidnight();
      const out=await page.evaluate(async how=>{
        const TX=GH_TRANSACTION_CORE,s=()=>__GH_STATE__,encode=()=>GH_STATE_CODEC.serialize(s()),before=encode(),revision=s().saveRevision,day=s().lastFinancialDay,sim=s().simSeconds;
        const setHidden=hidden=>{for(const [key,value] of [['hidden',hidden],['visibilityState',hidden?'hidden':'visible']]){if(hidden)Object.defineProperty(document,key,{configurable:true,get:()=>value});else delete document[key];}document.dispatchEvent(new Event('visibilitychange'));};
        // The pause/hide lands right after the first simulation tick that leaves the close staged (the engine runs in timer
        // tasks every 8 ms while a job is open, not in requestAnimationFrame). Watching for it in requestAnimationFrame, as
        // this did, missed the whole close on a slow runner (CI build 109, macOS: frames 116 ms apart) and paused the next
        // slice instead, after the day had committed (simSeconds 172799 -> 172800, lastFinancialDay 1 -> 2).
        const engine=__AUDIT__.simulationEngine,engineFrame=engine.frame;let seen=false,seenSim=null,ticks=0;
        await new Promise(resolve=>{
          const timeout=setTimeout(()=>{engine.frame=engineFrame;resolve();},30000);
          engine.frame=function(...args){try{return engineFrame.apply(this,args);}finally{ticks++;
            if(!seen&&TX.isStaged(s())){seen=true;seenSim=s().simSeconds;engine.frame=engineFrame;clearTimeout(timeout);if(how==='pause')__AUDIT__.setSpeed(0);else setHidden(true);resolve();}}};
          __AUDIT__.setSpeed(3);});
        const stagedAfter=TX.isStaged(s()),reason=engine.snapshot().lastCancelReason;
        if(how==='hide'){__AUDIT__.setSpeed(0);setHidden(false);}
        await new Promise(resolve=>setTimeout(resolve,400));
        // Compared decoded (Build 358): a collection that reaches 64 rows (the diagnostics log, written by the hide save) is
        // shape-encoded and adds the codec's own 'stateCodec' metadata to the save text; neither is game state.
        const after=encode(),decode=text=>{const tree=GH_STATE_CODEC.decodeState(JSON.parse(text));delete tree.stateCodec;return tree;},A=decode(before),B=decode(after);
        // The fleet store's revision is its cache epoch: a rollback advances it by design (fleet-store-core.js: "revision
        // and structure only ever grow"), so no cache keyed by it mistakes the restored rows for the aborted ones. It
        // moves whenever the close wrote fleet rows before the abort, which a slow runner reaches (CI run 83, frames 116 ms
        // apart). Every row, value and the structure are still compared; the epoch is set aside once it is shown not to
        // have gone back.
        const epoch={before:A.fleet?.revision,after:B.fleet?.revision};if(A.fleet&&B.fleet){delete A.fleet.revision;delete B.fleet.revision;}
        // The diagnostics log records the pause/hide (and, timing-dependent, governor samples) outside any transaction.
        // Hiding the app also saves (setHidden -> onPersist) after the abort, which moves saveRevision.
        const volatile=how==='hide'?['saveRevision','diagnostics']:['diagnostics'];
        // Collections of 64+ rows (the diagnostics events) are shape-encoded in the save text; read them decoded.
        const types=tree=>{const events=tree?.diagnostics?.events;return Array.isArray(events)?events.map(e=>e.type):[];},appended=types(B).slice(types(A).length);
        const without=(tree,keys)=>JSON.stringify(Object.fromEntries(Object.entries(tree).filter(([k])=>!keys.includes(k))));
        const changed=Object.keys({...A,...B}).filter(k=>JSON.stringify(A[k])!==JSON.stringify(B[k])&&!volatile.includes(k)),paths=[];
        // Where a changed root differs (the first few paths), so a failure names the field (CI run 83: 'fleet' after hiding).
        const walk=(a,b,at)=>{if(paths.length>=8||JSON.stringify(a)===JSON.stringify(b))return;if(a&&b&&typeof a==='object'&&typeof b==='object'){for(const k of new Set([...Object.keys(a),...Object.keys(b)]))walk(a[k],b[k],`${at}.${k}`);}else paths.push(`${at}: ${String(JSON.stringify(a)).slice(0,80)} -> ${String(JSON.stringify(b)).slice(0,80)}`);};
        for(const k of changed)walk(A[k],B[k],k);
        return {seen,seenSim,ticks,stagedAfter,reason,epochForward:!(Number(epoch.after)<Number(epoch.before)),identical:without(A,volatile)===without(B,volatile),appended,changed,paths,
          revisionStep:s().saveRevision-revision,day:s().lastFinancialDay,day0:day,sim:s().simSeconds,sim0:sim};
      },how);
      assert.equal(out.seen,true,`${how}: the close must have started`);
      assert.equal(out.seenSim,out.sim0,`${how}: caught in the day close itself, before it commits`);
      assert.equal(out.stagedAfter,false,`${how}: the staged transaction must be aborted at once`);
      assert.equal(out.reason,how==='pause'?'user-speed-change':'hidden');
      assert.equal(out.epochForward,true,`${how}: the fleet store's epoch never goes back`);
      assert.deepEqual(out.changed,[],`${how}: state restored exactly (diagnostics appended: ${JSON.stringify(out.appended)}; differs at ${JSON.stringify(out.paths)})`);
      assert.equal(out.day,out.day0);assert.equal(out.sim,out.sim0);
      if(how==='pause')assert.equal(out.identical,true,'pause: byte-for-byte identical apart from the diagnostics log');
      else assert(out.revisionStep<=1,`hide: at most the one hide save: ${out.revisionStep}`);
      console.log(`${how}: aborted (${out.reason}); state restored${how==='pause'?' byte for byte apart from the diagnostics log':' (only the hide save moved saveRevision/diagnostics)'}; diagnostics appended ${JSON.stringify(out.appended)}`);
    }
    assert.deepEqual(errors,[]);
    console.log('BUILD358_STAGED_DAY_BROWSER_PASS');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
