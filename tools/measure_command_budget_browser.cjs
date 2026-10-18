'use strict';
// Explicit bounded test instrumentation. Never loaded in the product. ACK uses the protocol test double, not iOS disk.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{chromium,webkit}=require('playwright'),{bootAtOrigin,installVault}=require('../tests/helpers/differential-vault-fixture.cjs'),{prepareCommandWorld}=require('../tests/helpers/command-world-fixture.cjs'),ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
(async()=>{const output=[];for(const engine of process.env.GH_BUDGET_ENGINE==='chromium'?[chromium]:[chromium,webkit]){const browser=await engine.launch({headless:true}),errors=[];let env;try{
 env=await bootAtOrigin({browser,root:ROOT,errors,fleetWorker:true,measureSyncWork:true,viewport:{width:956,height:440},beforeScripts:{fn:installVault}});const {page}=env;if(process.env.GH_BUDGET_CSS)await page.addStyleTag({content:process.env.GH_BUDGET_CSS});await prepareCommandWorld(page,{count:Number(process.env.GH_BUDGET_DOCUMENTS||12)});
 await page.evaluate(()=>{const q=window.__BUDGET__={active:false,spans:{},started:0,ack:0},record=(name,a,b)=>{if(!q.active)return;const span=q.spans[name]||(q.spans[name]={count:0,totalMs:0,maxMs:0});span.count++;span.totalMs+=b-a;span.maxMs=Math.max(span.maxMs,b-a);};window.__RESTORE_PROBE__=__AUDIT__.installWorkProbe(record);q.record=record;
  const wrap=(name,owner,method)=>{const fn=owner[method];return function(...args){const at=performance.now();try{return fn.apply(owner,args);}finally{record(name,at,performance.now());}};};
  const diagnostics=GH_DIAGNOSTICS;window.GH_DIAGNOSTICS={...diagnostics,recordMainThreadWork(s,label,a,b,...rest){record(label,a,b);return diagnostics.recordMainThreadWork?.(s,label,a,b,...rest);}};
  const ui=GH_INTERFACE;window.GH_INTERFACE={...ui,prepare:wrap('ui.prepare',ui,'prepare')};const presentation=GH_FINANCE_PRESENTATION;window.GH_FINANCE_PRESENTATION={...presentation,prepare:wrap('ui.financePrepare',presentation,'prepare')};
  const p=GH_DOCUMENT_PROOF;window.GH_DOCUMENT_PROOF={...p,verifyDocument:wrap('proof.verifyDocument',p,'verifyDocument')};
  addEventListener('gh-native-save-ack',()=>{if(q.active)q.ack=performance.now();});document.addEventListener('click',event=>{if(event.target.closest('.settle-all-payables,.settle-all-cheques')){q.active=true;q.started=performance.now();q.ack=0;q.spans={};}},true);
 });
 for(const [label,view,selector] of [['issue','payables','.settle-all-payables[data-method="cheque"]'],['cash','cheques','.settle-all-cheques']]){
  const open=await page.evaluate(view=>{const q=__BUDGET__;q.active=true;q.spans={};const at=performance.now();__AUDIT__.openDrawer('invoices',{company:'air',tab:view==='payables'?'obligations':'documents',view});q.active=false;return {ms:performance.now()-at,spans:q.spans};},view);
  await page.evaluate(()=>{__DIFF_VAULT__.attempts=[];__DIFF_VAULT__.mode='ok';});await page.locator(selector).first().click({timeout:10000});await page.waitForFunction(()=>!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked()&&__DIFF_VAULT__.attempts.length===1);
  const command=await page.evaluate(()=>{const q=__BUDGET__;q.active=false;const metrics=GH_PERSISTENCE.telemetry(),timing=__GH_APP_RUNTIME_INSTRUMENTATION__.durable.last;return {toAckMs:q.ack-q.started,spans:q.spans,timing,persistence:metrics.timings?.samples?.slice(-2),revision:__GH_STATE__.saveRevision,attempts:__DIFF_VAULT__.attempts.length};});
  assert.equal(command.attempts,1);const maxSyncMs=Math.max(0,...Object.values(command.spans).map(r=>r.maxMs));output.push({engine:engine.name(),label,documents:Number(process.env.GH_BUDGET_DOCUMENTS||12),open,command,maxMeasuredSyncMs:maxSyncMs,totalUnder20:command.toAckMs<20,syncUnder20:maxSyncMs<20});
 }
 assert.deepEqual(errors,[]);
 }finally{await browser.close();await env?.closeOrigin?.();}}
 if(process.env.GH_BUDGET_RESULTS)fs.writeFileSync(process.env.GH_BUDGET_RESULTS,JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify({source:ROOT,results:output}));
})().catch(error=>{console.error(error);process.exitCode=1;});
