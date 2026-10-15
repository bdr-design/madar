'use strict';
const {boot}=require('./helpers/local-dom-app');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{chromium,webkit}=require('playwright');
(async()=>{for(const engine of [chromium,webkit]){
 const browser=await engine.launch({headless:true,...(engine===webkit?{executablePath:webkit.executablePath()}:{})});
 try{const page=await browser.newPage();await page.addScriptTag({content:fs.readFileSync(path.resolve(__dirname,'../WebApp/transaction-core.js'),'utf8')});
 const result=await page.evaluate(async()=>{
  const t=GH_TRANSACTION_CORE,state={saveRevision:1,rows:Array.from({length:60000},(_,i)=>({id:'DOC-'+i,amount:i*.75,company:'air',fields:{text:'وثيقة '+i,active:true}}))};
  const start=performance.now(),sync=t.deepClone(state,{shareJournaledRoots:true}),syncMs=performance.now()-start;let frames=0,copying=true,framesDuringCopy=0;
  const frame=()=>{frames++;if(copying)framesDuringCopy++;};let paused=0,applyCalls=0,persistCalls=0;
  const result=await t.executeDurable(state,{yieldToHost:()=>new Promise(resolve=>{paused++;requestAnimationFrame(()=>{frame();setTimeout(resolve,0);});}),apply:draft=>{copying=false;applyCalls++;if(JSON.stringify(draft)!==JSON.stringify(sync))throw new Error('different-draft');draft.rows[40].amount=987;},persist:draft=>{persistCalls++;if(state.rows[40].amount!==30)throw new Error('changed-before-ack');return {ok:true,revision:draft.saveRevision};}});
  const timing=t.telemetry().lastDurable;if(!result.committed||state.rows[40].amount!==987||t.isDurableActive(state))throw new Error('commit-failed');
  return {syncMs,frames,framesDuringCopy,paused,applyCalls,persistCalls,cloneBusyMs:timing.cloneBusyMs,cloneMaxSliceMs:timing.cloneMaxSliceMs,cloneYields:timing.cloneYields,cloneWallMs:timing.cloneMs};
 });
 assert.ok(result.framesDuringCopy>0&&result.cloneYields>0,'actual animation callbacks must execute while the copy is in progress');assert.equal(result.applyCalls,1);assert.equal(result.persistCalls,1);
 await page.close();const errors=[],app=await boot({browser,errors});
 await app.page.evaluate(async()=>{
  await __AUDIT__.runAuthorizedDomainCommand('corporate','open-company',{type:'power',capital:200000000,legalName:'طاقة اختبار النسخ'},{silent:true});
  __GH_STATE__.cloneFixture=Array.from({length:40000},(_,i)=>({id:'COPY-'+i,text:'test '+i,value:i}));
  const original=GH_DOMAIN_COMMANDS;window.qaCopy={original,held:null,armed:true};
  window.GH_DOMAIN_COMMANDS={...original,dispatchDurable:(ctx,envelope,options)=>original.dispatchDurable(ctx,envelope,{...options,yieldToHost:async()=>{if(qaCopy.armed){qaCopy.armed=false;await new Promise(resolve=>{qaCopy.held=resolve;});}await options.yieldToHost();}})};
  __AUDIT__.setSpeed(1);window.qaCopy.pending=__AUDIT__.runAuthorizedDomainCommand('corporate','rename-company',{type:'power',legalName:'طاقة النسخ المعتمد'},{silent:true});
 });
 await app.page.waitForFunction(()=>typeof qaCopy.held==='function');
 const lock=await app.page.evaluate(()=>{if(__GH_DURABLE_COMMAND_CONTEXT__.draft!==null)throw new Error('not-paused-in-copy');let blocked=false;try{GH_TRANSACTION_CORE.execute(__GH_STATE__,{apply:()=>{throw new Error('must-not-enter');}});}catch(error){blocked=/durable-live-state-transaction-blocked/.test(error.message);}__AUDIT__.setSpeed(0);__AUDIT__.setMapMode('expansion');__AUDIT__.openDrawer('news');return blocked;});assert.equal(lock,true);
 const live=await app.page.evaluate(async()=>{qaCopy.held();await qaCopy.pending;window.GH_DOMAIN_COMMANDS=qaCopy.original;const state=__GH_STATE__,saved=JSON.parse(localStorage.getItem('global-holdings-world-v3.0.0'));return {speed:state.speed,mapMode:state.mapMode,lastPanel:state.lastPanel,savedSpeed:saved.speed,savedMapMode:saved.mapMode,cloneYields:GH_TRANSACTION_CORE.telemetry().lastDurable.cloneYields};});
 assert.equal(live.speed,0);assert.equal(live.savedSpeed,0);assert.equal(live.mapMode,'expansion');assert.equal(live.savedMapMode,'expansion');assert.equal(live.lastPanel,'news');assert.ok(live.cloneYields>0);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({suite:'build376-cooperative-draft-browser',ok:true,engine:engine.name(),...result,actualApp:live}));
 }finally{await browser.close();}
}})().catch(error=>{console.error(error);process.exitCode=1;});
