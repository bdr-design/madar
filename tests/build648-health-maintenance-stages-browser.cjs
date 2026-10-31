'use strict';
// Owner (DX-1793426939, the latest IPA on the iPhone: the maintenance round's health part was one 13 ms block, the longest
// it has): after the fleet evidence is settled, the integrity check, the health check with its evidence and the control
// plane's check each take a frame of their own (app.js runMaintenanceTask 'health'). The whole app (local DOM), a company
// open and the clock run:
//   - each check runs exactly once a pass, in its own call, in the order integrity -> evidence -> central, and the
//     evidence uses that same integrity result (no second integrity check);
//   - the stored report equals the main thread's own health check;
//   - a write between two stages (a committed command) starts the part again: the integrity check runs once more and
//     the report it stores is taken after the write;
//   - after HEALTH_STAGE_RESTARTS restarts the part runs whole, in one call, as before;
//   - a critical global fault found by the staged checks still halts the simulation (speed 0);
//   - the game then plays and saves.
const assert=require('node:assert/strict');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');

(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    const {page}=await boot({browser,errors,viewport:{width:844,height:390},bypassCSP:true});
    page.setDefaultTimeout(120000);
    await page.evaluate(async()=>{
      const a=__AUDIT__,s=__GH_STATE__;s.godMoney=true;s.infiniteMoney=true;
      const definition=GH_COMPANY_PLATFORM.definitionFor(s,'air');
      await a.runAuthorizedDomainCommand('corporate','open-company',{type:'air',companyId:'air',capital:Math.max(900000000,definition.founding.minimumCapital),legalName:'QA Stages Air',formationContract:'QA-STAGES'},{silent:true});
    });
    await page.evaluate(()=>__AUDIT__.setSpeed(3));await page.waitForTimeout(1500);await page.evaluate(()=>__AUDIT__.setSpeed(0));
    await page.waitForFunction(()=>!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked(),null,{timeout:60000});
    const result=await page.evaluate(async()=>{
      const a=__AUDIT__,state=__GH_STATE__,I=GH_INTEGRITY_CORE,D=GH_DIAGNOSTICS,C=GH_CONTROL_PLANE;
      const frame=()=>new Promise(resolve=>requestAnimationFrame(()=>resolve()));
      // The cores are frozen: each global is swapped for an object inheriting from it with the one function counted (defined,
      // since an inherited frozen property refuses plain assignment) (the
      // app and diagnostics-core reach these through the global at call time). Only calls made inside the part count.
      const calls=[];let current=0,inPart=false;
      const wrap=(name,key,label)=>{const original=globalThis[name],fn=original[key],proxy=Object.create(original);Object.defineProperty(proxy,key,{value:function(...args){if(inPart)calls.push({label,call:current});return fn.apply(original,args);}});globalThis[name]=proxy;window[name]=proxy;return ()=>{globalThis[name]=original;window[name]=original;};};
      const restore=[wrap('GH_INTEGRITY_CORE','check','integrity'),wrap('GH_DIAGNOSTICS','captureExportEvidence','health'),wrap('GH_CONTROL_PLANE','check','central')];
      const key=report=>(report?.issues||[]).map(row=>`${row.id}|${row.severity}`).sort().join(',');
      const mainReport=()=>D.runHealthCheck(state,{appVersion:'qa',saveSchemaVersion:'3.0.0',simulation:{}},{recordEvent:false,trackTransitions:false,storeResult:false});
      // The part as the maintenance queue runs it: one call per frame; `during(callNumber, entry)` runs after a call.
      const run=async(during,entry={task:'health'})=>{
        calls.length=0;const stages=[];
        for(current=1;;current++){inPart=true;let finished;try{finished=a.runMaintenanceTask(entry)!==false;}finally{inPart=false;}stages.push(entry.lastStage||'');if(finished)break;if(during)await during(current,entry);await frame();if(current>200)throw new Error('health part did not finish');}
        return {stages,calls:calls.map(row=>({...row})),entry};
      };
      const out={};
      // 1. A clean pass.
      const clean=await run();
      const by=label=>clean.calls.filter(row=>row.label===label);
      out.clean={stages:clean.stages,integrity:by('integrity').map(r=>r.call),health:by('health').map(r=>r.call),central:by('central').map(r=>r.call)};
      for(const r of restore)r();
      out.cleanSame=key(state.diagnostics.lastHealth)===key(mainReport());
      const wrapAgain=[wrap('GH_INTEGRITY_CORE','check','integrity'),wrap('GH_DIAGNOSTICS','captureExportEvidence','health'),wrap('GH_CONTROL_PLANE','check','central')];
      // 2. A committed command between the integrity stage and the evidence stage: the part starts again.
      const before=Number(state.controlPlane?.revision)||0;let wrote=false;
      const restarted=await run(async(n,entry)=>{if(!wrote&&entry.lastStage==='integrity'){wrote=true;await a.runAuthorizedDomainCommand('corporate','investor-mode',{enabled:false},{silent:true}).catch(()=>a.setSpeed(0));if((Number(state.controlPlane?.revision)||0)===before)state.controlPlane.revision=before+1;}});
      out.restarted={stages:restarted.stages,integrity:restarted.calls.filter(r=>r.label==='integrity').length,health:restarted.calls.filter(r=>r.label==='health').length,central:restarted.calls.filter(r=>r.label==='central').length,stageRestarts:restarted.entry.stageRestarts||0};
      // 3. After HEALTH_STAGE_RESTARTS restarts the part runs whole in one call (after its fleet evidence).
      const whole=await run(null,{task:'health',stageRestarts:3});
      out.whole={stages:whole.stages,calls:whole.calls.map(r=>`${r.label}@${r.call}`)};
      for(const r of wrapAgain)r();
      // 4. A critical global fault found by the staged checks halts the simulation.
      state.speed=3;const fault={id:'SAVE_SCHEMA_INTEGRITY',severity:'critical',title:'QA'};
      const injected=Object.create(I);Object.defineProperty(injected,'check',{value:(...args)=>{const report=I.check(...args);return {...report,issues:[...(report?.issues||[]),fault],critical:[...(report?.critical||[]),fault]};}});
      globalThis.GH_INTEGRITY_CORE=injected;window.GH_INTEGRITY_CORE=injected;
      let halted;try{const faulted=await run();halted={stages:faulted.stages,speed:state.speed,stored:key(state.diagnostics.lastHealth).includes('SAVE_SCHEMA_INTEGRITY')};}finally{globalThis.GH_INTEGRITY_CORE=I;window.GH_INTEGRITY_CORE=I;}
      out.halted=halted;state.speed=0;
      // The fault was injected; a clean pass replaces the stored report.
      await run();out.recoveredSame=key(state.diagnostics.lastHealth)===key(mainReport());
      return out;
    });
    console.log(JSON.stringify(result));
    assert.deepEqual(errors,[]);
    const c=result.clean,last=c.stages.slice(-3);
    assert.deepEqual(last,['integrity','evidence','central'],'the last three calls are the three stages, in order');
    assert.equal(c.integrity.length,1,'one integrity check a pass (the evidence reuses it)');assert.equal(c.health.length,1,'one health check a pass');assert.equal(c.central.length,1,'one control plane check a pass');
    assert.ok(c.integrity[0]<c.health[0]&&c.health[0]<c.central[0],'each check runs in a call of its own, in order');
    assert.equal(result.cleanSame,true,'the stored report equals the main thread health check');
    const r=result.restarted;
    assert.ok(r.stages.includes('restart'),'a write between stages restarts the part');assert.equal(r.stageRestarts,1);
    assert.equal(r.integrity,2,'the integrity check runs again after the restart');assert.equal(r.health,1,'one health check (after the write)');assert.equal(r.central,1,'one control plane check');
    assert.equal(result.whole.stages.at(-1),'whole','after the restart limit the part runs whole');
    const wholeCalls=result.whole.calls,lastCall=Math.max(...wholeCalls.map(x=>Number(x.split('@')[1])));
    assert.deepEqual(wholeCalls.filter(x=>x.endsWith(`@${lastCall}`)).map(x=>x.split('@')[0]).sort(),['central','health','integrity'],'the whole part runs every check, once each, in its one call (integrity from inside the evidence)');
    assert.deepEqual(result.halted.stages.slice(-3),['integrity','evidence','central']);assert.equal(result.halted.speed,0,'a critical global fault still halts the simulation');assert.equal(result.halted.stored,true,'the staged integrity result reaches the stored report');
    assert.equal(result.recoveredSame,true);
    await page.evaluate(()=>__AUDIT__.setSpeed(3));await page.waitForTimeout(1200);await page.evaluate(()=>__AUDIT__.setSpeed(0));
    const drained=await page.evaluate(()=>GH_PERSISTENCE.drain({timeoutMs:60000}));assert.equal(drained?.ok,true);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({suite:'build648-health-maintenance-stages-browser',ok:true}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
