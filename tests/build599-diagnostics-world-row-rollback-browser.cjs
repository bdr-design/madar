'use strict';
// Owner (build 98 iPhone diagnostic: «حل باقي المشاكل»; then «صلحها على دفعات دقيقه جدًا»): every steady and hourly
// simulation slice deep-copied the diagnostics (240 events and the last health report) and the simulated world (the
// competitors and their assets) for its rollback, the largest copies of play (a fleet of 60,000, 60 s: 5.4 MB of 28 went
// to rollback copies). GH_DIAGNOSTICS alone writes the diagnostics, adding or trimming events and resolved issues, counting
// event types and replacing the active issues and the last report whole; the world's writers edit the competitors' price
// and their assets' progress, fields of rows. Both are now captured at row level in those slices. In the real game (local
// DOM, real slice job):
//  1. steady and hourly slices capture the diagnostics (containers) and the world (rows) at row level and never deep-copy
//     either; a day's close is unchanged;
//  2. a steady and an hourly slice that fail after their writes, among them every write those owners make (an event
//     recorded past the limit, a counter, a health check that opens, changes and resolves issues and stores its report,
//     a competitor's price, an asset's progress), bring the whole game state back byte for byte;
//  3. a game day of slices under the write-set audit commits every slice, and the diagnostics and the world written in
//     them are kept;
//  4. no error is logged.
const assert=require('node:assert/strict');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');
(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    const {page}=await boot({browser,errors});
    await page.evaluate(async()=>{const a=__AUDIT__,s=__GH_STATE__,d=GH_COMPANY_PLATFORM.definitionFor(s,'air');s.godMoney=true;s.infiniteMoney=true;await a.runAuthorizedDomainCommand('corporate','open-company',{type:'air',companyId:'air',capital:Math.max(400000000,d.founding.minimumCapital),legalName:'QA Rollback Air',formationContract:'QA-599'},{silent:true});s.godMoney=false;s.infiniteMoney=false;});
    await page.waitForFunction(()=>!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked());
    const result=await page.evaluate(()=>{
      const a=__AUDIT__,s=__GH_STATE__,TX=GH_TRANSACTION_CORE,TIME=GH_SIMULATION_TIME_CORE,D=GH_DIAGNOSTICS;s.speed=0;
      const kindAt=to=>{const b=TIME.boundaryAt(to);return b.day!=null?'day':b.hour!=null?'hour':'steady';};
      const runSlice=(fail=false,writes=null)=>{
        const from=s.simSeconds,to=from+600,b=TIME.boundaryAt(to),originalTime=window.GH_SIMULATION_TIME_CORE;
        window.GH_SIMULATION_TIME_CORE={...originalTime,boundaryAt(x){if(fail)TX.afterCommit(()=>{throw new Error('build599-injected-failure');},{critical:true,key:'build599-injected',owner:'test'});if(writes){writes();writes=null;}return originalTime.boundaryAt(x);}};
        try{
          const job=a.createSimulationSliceJob(600,{from,to,speed:600,boundary:{day:b.day,hour:b.hour}});
          while(job.runChunk(64,{deadline:performance.now()+8})!==true){}
          try{return job.finish();}catch(error){return {committed:false,error:String(error?.message||error)};}
        }finally{window.GH_SIMULATION_TIME_CORE=originalTime;}
      };
      const fingerprint=()=>JSON.stringify({state:s,fleet:GH_FLEET_DATA.list(s),fleetSize:GH_FLEET_DATA.size(s)},function(key,value){return this===s&&key==='fleet'?undefined:value;});
      // Every write the two owners make. The health check is the real one with an issue list that opens one, changes the
      // severity of another and resolves a third.
      let round=0;
      const ownerWrites=()=>{
        round++;D.ensure(s);for(let i=0;i<250;i++)D.record(s,'QA_ROLLBACK_EVENT',{round,i},'info');
        const health=issues=>D.runHealthCheck(s,{integrity:{status:'healthy',issues},fleetAssetIssues:[]},{recordEvent:true,trackTransitions:true,layout:false});
        health([{id:'QA_OPEN_'+round,severity:'warning',title:'QA',detail:'QA',domain:'qa'},{id:'QA_KEEP',severity:round%2?'critical':'warning',title:'QA',detail:'QA',domain:'qa'}]);
        const world=s.simulationWorld;world.competitors[0].price=Number(world.competitors[0].price)*1.01+round;world.competitorAssets[0].progress=(Number(world.competitorAssets[0].progress)+.137)%1;
      };
      // Diagnostics with issues to resolve, before anything is measured.
      D.runHealthCheck(s,{integrity:{status:'healthy',issues:[{id:'QA_RESOLVE',severity:'warning',title:'QA',detail:'QA',domain:'qa'},{id:'QA_KEEP',severity:'warning',title:'QA',detail:'QA',domain:'qa'}]},fleetAssetIssues:[]},{recordEvent:true,trackTransitions:true,layout:false});
      // Deep copies of the two roots are counted (structuredClone of an object with their keys).
      const clone=globalThis.structuredClone,copies={diagnostics:0,world:0};
      globalThis.structuredClone=function(value,options){if(value&&typeof value==='object'&&!Array.isArray(value)){if('events' in value&&'activeIssues' in value&&'counters' in value)copies.diagnostics++;if('competitors' in value&&'competitorAssets' in value)copies.world++;}return clone.call(this,value,options);};
      const out={capture:{},rollback:{},copies:null,audit:null};
      try{
        // 1.
        for(const wanted of ['steady','hour','day']){
          let guard=0;while(kindAt(s.simSeconds+600)!==wanted&&guard++<200){const r=runSlice();if(!r.committed)throw new Error('advance failed '+(r.reason||r.error));}
          const before={...copies},r=runSlice(false,ownerWrites),t=TX.telemetry().lastSimulation||{};
          out.capture[wanted]={committed:r.committed!==false,rowRoots:(t.rowRoots||[]).slice(),storage:t.rollbackStorage,copies:{diagnostics:copies.diagnostics-before.diagnostics,world:copies.world-before.world}};
        }
        // 2.
        for(const wanted of ['steady','hour']){
          let guard=0;while(kindAt(s.simSeconds+600)!==wanted&&guard++<200){const r=runSlice();if(!r.committed)throw new Error('advance failed '+(r.reason||r.error));}
          const before=fingerprint(),simBefore=s.simSeconds,failed=runSlice(true,ownerWrites),after=fingerprint();
          out.rollback[wanted]={committed:failed.committed,error:failed.error||failed.reason||null,same:before===after,time:s.simSeconds===simBefore};
        }
        // 3.
        window.__GH_BUILD339_WRITE_AUDIT__=true;window.__GH_BUILD358_ENFORCE_SLICE_SCOPE__=true;let committed=0,kept=true;
        try{for(let i=0;i<144;i++){const events=s.diagnostics.events.length?s.diagnostics.events[0].id:null,price=s.simulationWorld.competitors[0].price,r=runSlice(false,i%12===0?ownerWrites:null);if(r.committed===false)throw new Error(`slice ${i} failed: ${r.reason||r.error}`);committed++;if(i%12===0)kept=kept&&s.diagnostics.events[0].id!==events&&s.simulationWorld.competitors[0].price!==price;}}
        finally{window.__GH_BUILD339_WRITE_AUDIT__=false;window.__GH_BUILD358_ENFORCE_SLICE_SCOPE__=false;}
        out.audit={committed,kept};
      }finally{globalThis.structuredClone=clone;}
      return out;
    });
    // 1.
    for(const kind of ['steady','hour']){const c=result.capture[kind];assert.equal(c.committed,true,`1: the ${kind} slice commits`);assert.ok(c.rowRoots.includes('diagnostics')&&c.rowRoots.includes('simulationWorld'),`1: the ${kind} slice captures the diagnostics and the world at row level (${c.rowRoots})`);assert.deepEqual(c.copies,{diagnostics:0,world:0},`1: and copies neither (${JSON.stringify(c.copies)})`);}
    assert.equal(result.capture.day.committed,true,'1: the day slice commits');assert.ok(!result.capture.day.rowRoots.includes('diagnostics')&&!result.capture.day.rowRoots.includes('simulationWorld'),'1: the day slice is unchanged');
    // 2.
    for(const kind of ['steady','hour']){const r=result.rollback[kind];assert.equal(r.committed,false,`2: the ${kind} slice failed`);assert.match(String(r.error),/build599-injected-failure|critical|post-commit|rolled/i,`2: on the injected failure (${r.error})`);assert.equal(r.same,true,`2: the ${kind} slice brings the whole state back byte for byte`);assert.equal(r.time,true,`2: and the game time`);}
    // 3.
    assert.equal(result.audit.committed,144,'3: a game day of slices commits under the write-set audit');assert.equal(result.audit.kept,true,'3: the diagnostics and the world written in them are kept');
    // 4.
    assert.deepEqual(errors,[],'4: no error');
    console.log(JSON.stringify({suite:'build599-diagnostics-world-row-rollback-browser',ok:true,capture:result.capture}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
