'use strict';
const assert=require('node:assert/strict'),{chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');
function vault(){
  const v=window.__DIAG_VAULT__={held:[],commits:0,generation:0,hold:true};
  v.ack=(m,success=true)=>window.dispatchEvent(new CustomEvent('gh-native-save-ack',{detail:{requestId:m.requestId,action:m.action,saveRevision:m.saveRevision,resetEpoch:m.resetEpoch,saveSchemaVersion:m.saveSchemaVersion,saveHash:m.saveHash,success,generation:success?++v.generation:undefined,message:success?'':'injected-native-refusal'}}));
  window.webkit={messageHandlers:{saveBridge:{postMessage(m){if(m.action==='commitSave'){v.commits++;if(v.hold)v.held.push(m);else setTimeout(()=>v.ack(m),0);}}}}};window.GH_NATIVE_BUILD=362;
}
(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[],results=[];
  try{
    const {page}=await boot({browser,errors});page.setDefaultTimeout(90000);await page.evaluate(vault);
    results.push(await page.evaluate(async()=>{
      const P=GH_PERSISTENCE,v=__DIAG_VAULT__,s=__GH_STATE__;
      const one=P.commitState(s),two=P.commitState(s);if(!one.ok||!two.ok)throw new Error('ordinary saves accepted');
      let finished=false;const first=GH_RUNTIME.exportDiagnostics().then(b=>{finished=true;return b;}),second=GH_RUNTIME.exportDiagnostics();
      await new Promise(r=>setTimeout(r,40));if(finished)throw new Error('export captured before ordinary ACK');
      const timer=setInterval(()=>{const m=v.held.shift();if(m)v.ack(m);},10);
      const bundles=await Promise.all([first,second]);clearInterval(timer);
      if(v.commits!==2)throw new Error(`dirty save was not drained: ${v.commits}`);
      for(const b of bundles){if(!b.exportPerformance.consistent)throw new Error('export inconsistent');if(b.runtimeInstrumentation.persistence.ordinaryInFlight)throw new Error('ordinary save still in flight');}
      return {case:'ordinary ACK, dirty follow-up and two exports',commits:v.commits,consistent:bundles.map(b=>b.exportPerformance.consistent)};
    }));
    results.push(await page.evaluate(async()=>{
      const original=GH_DIAGNOSTICS;let injected=false;
      window.GH_DIAGNOSTICS={...original,exportBundleAsync(st,extra,options){injected=true;GH_CONTROL_PLANE.recordBridge(st,'QA_EXPORT_MUTATION',{injected:true});return original.exportBundleAsync(st,extra,options);}};
      let rejected=false;try{await GH_RUNTIME.exportDiagnostics();}catch(e){rejected=/state.changed/i.test(e.message)||e.code==='DIAGNOSTIC_EXPORT_STATE_CHANGED';}finally{window.GH_DIAGNOSTICS=original;}
      if(!rejected)throw new Error(`consistency guard did not reject real mutation (injected=${injected})`);
      if(window.__GH_DIAGNOSTIC_EXPORT_IN_PROGRESS__)throw new Error('snapshot lock leaked');
      const next=await GH_RUNTIME.exportDiagnostics();if(!next.exportPerformance.consistent)throw new Error('retry failed');return {case:'consistency protection and retry',rejected};
    }));
    // A durable command's save is acknowledged while the command holds the live state: the ACK's record survives the
    // command's publication (the publication used to replace it), and one that arrives during an export waits for its end.
    results.push(await page.evaluate(async()=>{
      const v=__DIAG_VAULT__,s=()=>__GH_STATE__,def=GH_COMPANY_PLATFORM.definitionFor(s(),'sea');v.hold=false;
      // Each save is recorded twice: the native ACK (its request) and the durable commit it completes.
      const acks=revision=>{const rows=s().controlPlane.events.filter(e=>e.type==='BRIDGE_SAVE_ACK'&&e.detail?.saveRevision===revision);return {native:rows.filter(e=>e.detail.action==='commitSave').length,durable:rows.filter(e=>e.detail.durable===true).length};};
      const settled=async revision=>{let out=acks(revision);for(let i=0;i<250&&!(out.native&&out.durable);i++){await new Promise(r=>setTimeout(r,20));out=acks(revision);}return out;};
      await __AUDIT__.runAuthorizedDomainCommand('corporate','open-company',{type:'sea',companyId:'sea',capital:Math.max(400000000,def.founding.minimumCapital),legalName:'QA ACK Record',formationContract:'QA-ACK-RECORD'},{silent:true});
      const revision=s().saveRevision,found=await settled(revision);if(found.native!==1||found.durable!==1)throw new Error(`durable command ACK records: ${JSON.stringify(found)}`);
      v.hold=true;return {case:'durable command ACK recorded after its publication',revision,acks:found};
    }));
    // A durable-command context left set with no command running (a past fault) cannot hold an ACK record in a loop of
    // microtasks: timers keep running, and the record is written once, after the lifecycle settles (no command will
    // publish over it).
    results.push(await page.evaluate(async()=>{
      window.__GH_DURABLE_COMMAND_CONTEXT__={draft:null};
      window.dispatchEvent(new CustomEvent('gh-persistence-status',{detail:{ok:true,validated:true,durable:true,native:true,saveRevision:-374}}));
      let ticks=0;const timer=setInterval(()=>ticks++,5);await new Promise(r=>setTimeout(r,150));clearInterval(timer);window.__GH_DURABLE_COMMAND_CONTEXT__=null;
      const recorded=__GH_STATE__.controlPlane.events.filter(e=>e.type==='BRIDGE_SAVE_ACK'&&e.detail?.saveRevision===-374).length;
      if(ticks<5)throw new Error(`timers starved while the record waited (${ticks} ticks)`);if(recorded!==1)throw new Error(`recorded ${recorded} times`);
      return {case:'left-behind command context: timers run, one record',ticks,recorded};
    }));
    // The actual bound export button must handle failures without an unhandled rejection.
    // It waits for the failing export itself instead of a fixed 100 ms (the button's export first yields for paints, which
    // a slower runner's coalesced timers and frames can hold past 100 ms), then reads the lock at once: its release
    // follows the failure in the same microtasks (withDiagnosticOperation's finally).
    await page.evaluate(()=>{window.__DIAG_ORIGINAL__=GH_DIAGNOSTICS;window.__qaExportFailed=false;window.GH_DIAGNOSTICS={...GH_DIAGNOSTICS,exportBundleAsync:async()=>{window.__qaExportFailed=true;throw new Error('injected-export-button-failure');}};__AUDIT__.openDrawer('diagnostics');});
    await page.locator('[data-gh-action="diagnostics-export"]').first().click();
    await page.waitForFunction(()=>window.__qaExportFailed===true,null,{timeout:15000}).catch(()=>assert.fail('the export button did not reach the export'));
    assert.equal(await page.evaluate(()=>window.__GH_DIAGNOSTIC_EXPORT_IN_PROGRESS__),false,'the export lock leaked after a failed export');
    await page.evaluate(()=>{window.GH_DIAGNOSTICS=window.__DIAG_ORIGINAL__;});
    // NACK is completed evidence too: recovery export remains usable after it.
    results.push(await page.evaluate(async()=>{
      const v=__DIAG_VAULT__;GH_PERSISTENCE.commitState(__GH_STATE__);let finished=false;
      const pending=GH_RUNTIME.exportDiagnostics().then(b=>{finished=true;return b;});await new Promise(r=>setTimeout(r,30));if(finished)throw new Error('did not await NACK');
      const m=v.held.shift();if(!m)throw new Error('missing pending commit');v.ack(m,false);
      const bundle=await pending;if(!bundle.exportPerformance.consistent)throw new Error('NACK evidence inconsistent');
      if(!GH_PERSISTENCE.telemetry().recoveryRequired)throw new Error('recovery protection was lost');
      return {case:'NACK recovery evidence',consistent:true,recoveryRequired:true};
    }));
    assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,results}));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
