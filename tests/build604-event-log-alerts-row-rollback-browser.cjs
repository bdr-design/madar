'use strict';
// Owner (build 98 iPhone diagnostic; then «كمل الباقي بدقه»): every steady and hourly simulation slice deep-copied the
// event log (up to 400 events) and the alerts (up to 40) for its rollback, a copy that grows with the game. Their writers
// only add an entry at the front, trim, or put a shorter list in place; an event is made whole and an alert is text, and
// neither is edited after. Both lists are now captured themselves (level 'root') in those slices. In the real game (local
// DOM, real slice job) with a full event log and full alerts:
//  1. steady and hourly slices capture the event log and the alerts at level 'root' and never deep-copy them; a day's close
//     is unchanged;
//  2. a steady and an hourly slice that fail after the writes their owners make (alerts and events recorded through the
//     operations owner past both limits, the economy news through the strategy owner in the hourly one, an alert added in
//     place) bring the
//     whole game state back byte for byte;
//  3. a game day of slices under the write-set audit commits every slice, and what is recorded in them is kept;
//  4. no error is logged.
const assert=require('node:assert/strict');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');
(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    const {page}=await boot({browser,errors});
    await page.evaluate(async()=>{const a=__AUDIT__,s=__GH_STATE__,d=GH_COMPANY_PLATFORM.definitionFor(s,'air');s.godMoney=true;s.infiniteMoney=true;await a.runAuthorizedDomainCommand('corporate','open-company',{type:'air',companyId:'air',capital:Math.max(400000000,d.founding.minimumCapital),legalName:'QA Log Air',formationContract:'QA-604'},{silent:true});s.godMoney=false;s.infiniteMoney=false;});
    await page.waitForFunction(()=>!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked());
    const result=await page.evaluate(()=>{
      const a=__AUDIT__,s=__GH_STATE__,TX=GH_TRANSACTION_CORE,TIME=GH_SIMULATION_TIME_CORE,OPS=GH_OPERATIONS_CORE;s.speed=0;
      const kindAt=to=>{const b=TIME.boundaryAt(to);return b.day!=null?'day':b.hour!=null?'hour':'steady';};
      const runSlice=(fail=false,writes=null)=>{
        const from=s.simSeconds,to=from+600,b=TIME.boundaryAt(to),originalTime=window.GH_SIMULATION_TIME_CORE;
        window.GH_SIMULATION_TIME_CORE={...originalTime,boundaryAt(x){if(fail)TX.afterCommit(()=>{throw new Error('build604-injected-failure');},{critical:true,key:'build604-injected',owner:'test'});if(writes){writes();writes=null;}return originalTime.boundaryAt(x);}};
        try{
          const job=a.createSimulationSliceJob(600,{from,to,speed:600,boundary:{day:b.day,hour:b.hour}});
          while(job.runChunk(64,{deadline:performance.now()+8})!==true){}
          try{return job.finish();}catch(error){return {committed:false,error:String(error?.message||error)};}
        }finally{window.GH_SIMULATION_TIME_CORE=originalTime;}
      };
      const fingerprint=()=>JSON.stringify({state:s,fleet:GH_FLEET_DATA.list(s),fleetSize:GH_FLEET_DATA.size(s)},function(key,value){return this===s&&key==='fleet'?undefined:value;});
      // A full event log and full alerts, through the operations owner.
      for(let i=0;i<420;i++)OPS.execute({state:s},'record-alert',{text:`QA alert ${i}`,type:'qa',id:`QA-604-${i}`});
      let round=0;
      // The economy news is the strategy owner's hourly write (an hourly slice's, as its 'advanced' root is).
      const ownerWrites=(hourly=false)=>()=>{
        round++;for(let i=0;i<5;i++)OPS.execute({state:s},'record-alert',{text:`QA round ${round} alert ${i}`,type:'qa',id:`QA-604-R${round}-${i}`});
        if(hourly)GH_STRATEGY_CORE.execute({state:s},'economy-news',{hour:100000+round,text:`QA news ${round}`});
        s.alerts.unshift(`QA in place ${round}`);
      };
      const clone=globalThis.structuredClone,copies={eventLog:0,alerts:0};
      globalThis.structuredClone=function(value,options){if(value===s.eventLog||value?.eventLog===s.eventLog)copies.eventLog++;if(value===s.alerts||value?.alerts===s.alerts)copies.alerts++;return clone.call(this,value,options);};
      const out={capture:{},rollback:{},audit:null,full:{events:s.eventLog.length,alerts:s.alerts.length}};
      try{
        // 1.
        for(const wanted of ['steady','hour','day']){
          let guard=0;while(kindAt(s.simSeconds+600)!==wanted&&guard++<200){const r=runSlice();if(r.committed===false)throw new Error('advance failed '+(r.reason||r.error));}
          const before={...copies},r=runSlice(),t=TX.telemetry().lastSimulation||{};
          out.capture[wanted]={committed:r.committed!==false,rowRoots:(t.rowRoots||[]).slice(),copies:{eventLog:copies.eventLog-before.eventLog,alerts:copies.alerts-before.alerts}};
        }
        // 2.
        for(const wanted of ['steady','hour']){
          let guard=0;while(kindAt(s.simSeconds+600)!==wanted&&guard++<200){const r=runSlice();if(r.committed===false)throw new Error('advance failed '+(r.reason||r.error));}
          const before=fingerprint(),simBefore=s.simSeconds,failed=runSlice(true,ownerWrites(wanted==='hour')),after=fingerprint();
          const A=JSON.parse(before).state,B=JSON.parse(after).state,diff=Object.keys({...A,...B}).filter(k=>JSON.stringify(A[k])!==JSON.stringify(B[k]));out.rollback[wanted]={committed:failed.committed,error:failed.error||failed.reason||null,same:before===after,time:s.simSeconds===simBefore,diff,detail:diff.slice(0,2).map(k=>[k,JSON.stringify(A[k]).slice(0,300),JSON.stringify(B[k]).slice(0,300)])};
        }
        // 3.
        window.__GH_BUILD339_WRITE_AUDIT__=true;window.__GH_BUILD358_ENFORCE_SLICE_SCOPE__=true;let committed=0,kept=true;
        try{for(let i=0;i<144;i++){const r=runSlice(false,i%24===0?ownerWrites(kindAt(s.simSeconds+600)==='hour'):null);if(r.committed===false)throw new Error(`slice ${i} failed: ${r.reason||r.error}`);committed++;if(i%24===0)kept=kept&&s.alerts[0]===`QA in place ${round}`&&s.eventLog.some(e=>e.id===`QA-604-R${round}-4`);}}
        finally{window.__GH_BUILD339_WRITE_AUDIT__=false;window.__GH_BUILD358_ENFORCE_SLICE_SCOPE__=false;}
        out.audit={committed,kept};
      }finally{globalThis.structuredClone=clone;}
      return out;
    });
    assert.ok(result.full.events>=400&&result.full.alerts>=40,`a full event log and full alerts (${JSON.stringify(result.full)})`);
    // 1.
    for(const kind of ['steady','hour']){const c=result.capture[kind];assert.equal(c.committed,true,`1: the ${kind} slice commits`);assert.ok(c.rowRoots.includes('eventLog')&&c.rowRoots.includes('alerts'),`1: the ${kind} slice captures the event log and the alerts themselves (${c.rowRoots})`);assert.deepEqual(c.copies,{eventLog:0,alerts:0},`1: and copies neither (${JSON.stringify(c.copies)})`);}
    assert.equal(result.capture.day.committed,true,'1: the day slice commits');assert.ok(!result.capture.day.rowRoots.includes('eventLog')&&result.capture.day.copies.eventLog>=1,`1: the day slice is unchanged: it still copies them (${JSON.stringify(result.capture.day.copies)})`);
    // 2.
    for(const kind of ['steady','hour']){const r=result.rollback[kind];assert.equal(r.committed,false,`2: the ${kind} slice failed`);assert.match(String(r.error),/build604-injected-failure|critical|post-commit|rolled/i,`2: on the injected failure (${r.error})`);assert.equal(r.same,true,`2: the ${kind} slice brings the whole state back byte for byte (${JSON.stringify(r.diff)} ${JSON.stringify(r.detail)})`);assert.equal(r.time,true,`2: and the game time`);}
    // 3.
    assert.equal(result.audit.committed,144,'3: a game day of slices commits under the write-set audit');assert.equal(result.audit.kept,true,'3: what is recorded in them is kept');
    // 4.
    assert.deepEqual(errors,[],'4: no error');
    console.log(JSON.stringify({suite:'build604-event-log-alerts-row-rollback-browser',ok:true,capture:result.capture}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
