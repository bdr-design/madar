'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium,webkit}=require('playwright'),{bootRenderApp}=require('./helpers/render-app.cjs');
const results=[];
(async()=>{for(const engine of [chromium,webkit]){
 const browser=await engine.launch({headless:true}),errors=[],native=[];let env;
 try{
  env=await bootRenderApp({browser,errors,beforeApp:async page=>page.evaluate(()=>{
   // Native ACK releases the financial lock before an outer DOM handler has
   // finished. Await that handler too before the next independent test action.
   window.__CONFIRM_PENDING_CLICKS__=0;const add=EventTarget.prototype.addEventListener;
   EventTarget.prototype.addEventListener=function(type,listener,options){if(type==='click'&&typeof listener==='function'){const original=listener;listener=function(...args){const result=original.apply(this,args);if(result&&typeof result.then==='function'){__CONFIRM_PENDING_CLICKS__++;return result.finally(()=>{__CONFIRM_PENDING_CLICKS__--;});}return result;};}return add.call(this,type,listener,options);};
  })});const {page}=env;page.setDefaultTimeout(15000);
  page.on('dialog',async d=>{native.push(d.message());await d.dismiss();});
  await page.evaluate(async()=>{
   const a=__AUDIT__,s=__GH_STATE__;s.godMoney=true;s.infiniteMoney=true;
   for(const type of ['air','mobility'])await a.runAuthorizedDomainCommand('corporate','open-company',{type,capital:400000000,legalName:'QA Confirmation '+type},{silent:true});
   const st=__GH_STATE__;st.groupValue=2000000000;
   // A group the offering accepts (owner, IPO restructuring): a year of profit, 200 days old, rated A, valued at the close.
   st.realism=st.realism||{};st.realism.financial=st.realism.financial||{};st.realism.financial.consolidated={...(st.realism.financial.consolidated||{}),equity:2.5e9};st.finance.dailyCompanyReports=Array.from({length:365},(_,i)=>({id:`CLOSE-${200-i}`,day:200-i,net:1.2e6}));st.simSeconds=200*86400;st.profile.creditRating='A';if(st.advanced)delete st.advanced.valuation;GH_CORPORATE_CORE.execute({state:st},'close-valuation',{day:200});if(!GH_CORPORATE_CORE.ipoTerms(st,20).ready)throw new Error('QA offering not ready');
   st.globalBases.push({id:'QA-AIR-BASE',name:'QA Airport',kind:'airport-base',ownerCompanyId:'air',company:'air',owned:true,icao:'OERK',iata:'RUH',city:'الرياض',country:'السعودية',coords:[24.95,46.7]});
   for(let i=1;i<=3;i++)GH_FLEET_DATA.add(st,{id:'N-AIR-CONFIRM-'+i,name:'QA Aircraft '+i,type:'air',assetMode:'air',assetClass:'aircraft',ownerCompanyId:'air',baseFacility:'QA-AIR-BASE',model:'QA',ownership:i===3?'lease':'owned',monthlyLease:i===3?1000:0,phase:'idle',purchasePrice:100000,condition:100,fuel:100,progress:0,routeId:null});
   const m=GH_MOBILITY_CORE.ensure(st);m.vehicles.push({id:'M-CONFIRM-1',name:'QA Car',model:'QA',assetClass:'economy',ownerCompanyId:'mobility',status:'idle',condition:100,battery:100,purchasePrice:100000,totalTrips:0,totalKm:0,centerId:'RUH'});
   await a.runAuthorizedDomainCommand('finance','credit',{company:'group',amount:11500,note:'QA receivable',counterparty:'QA Client',reference:'CONFIRM-AR',termsDays:7},{silent:true});
   const saved=await GH_PERSISTENCE.saveSlot(0,__GH_STATE__);if(!saved.ok)throw new Error(saved.reason);
   window.__CONFIRM_TEST__={mode:'ok',commits:[],loads:0,generation:0};
  });
  const snapshot=()=>page.evaluate(()=>{const s=__GH_STATE__;return {revision:s.saveRevision,cash:s.cash,groupValue:s.groupValue,balances:Object.fromEntries(['group','air','mobility'].map(c=>[c,GH_FINANCE_CORE.operating(s,c)])),financialState:{books:s.companyFinance,finance:s.finance},receivables:s.finance.receivables.map(r=>r.number),cheques:s.finance.cheques.length,transfers:s.finance.transfers.length,listed:s.ipo.listed,assets:GH_FLEET_DATA.filter(s,()=>true).map(r=>r.id),vehicles:GH_MOBILITY_CORE.ensure(s).vehicles.map(v=>v.id)};});
  // A QA aircraft's sale is the fleet owner's quote on the day (it loses value with the days the offering fixture adds).
  const sale=await page.evaluate(()=>GH_FLEET_CORE.saleQuote(__GH_STATE__,{type:'air',ownership:'owned',purchasePrice:100000,condition:100}).proceeds);
  const cases=[
   {name:'load-slot',panel:'settings',selector:'[data-gh-action="load-slot"][data-slot="0"]'},
   {name:'launch-ipo',panel:'stocks',arg:'ipo',selector:'.launch-ipo'},
   {name:'collect-all-receivables',panel:'invoices',arg:{company:'group',tab:'obligations',view:'receivables'},selector:'.collect-all-receivables'},
   {name:'sell-mobility-asset',panel:'mobilityAsset',arg:'M-CONFIRM-1',selector:'.sell-mobility-asset'},
   {name:'sell-asset',panel:'assetManage',arg:'N-AIR-CONFIRM-1',selector:'.sell-asset'},
   {name:'return-lease',panel:'assetManage',arg:'N-AIR-CONFIRM-3',selector:'.sell-asset'},
   {name:'sell-all-assets',panel:'assetMarket',arg:'air',selector:'.sell-all-assets[data-company="air"]'}
  ];
  async function open(c){await page.evaluate(c=>__AUDIT__.openDrawer(c.panel,c.arg),c);const b=page.locator(c.selector).first();assert.equal(await b.count(),1,c.name+' real button '+JSON.stringify(await page.evaluate(()=>({panel:__AUDIT__.currentPanel(),arg:__AUDIT__.currentArg(),assets:GH_FLEET_DATA.filter(__GH_STATE__,()=>true).map(r=>r.id),pending:__CONFIRM_PENDING_CLICKS__,html:document.querySelector('#drawerBody').innerText.slice(0,350)}))));await page.waitForFunction(selector=>{const button=document.querySelector(selector);return button&&!button.disabled;},c.selector);assert.equal(await b.isDisabled(),false,c.name+' available');return b;}
  async function confirm(c){const b=await open(c);await b.click();await page.locator('.ui-confirm[open]').waitFor();return b;}
  for(const c of cases){
   const before=await snapshot(),button=await confirm(c);
   assert.deepEqual(await snapshot(),before,c.name+' cannot mutate before confirmation');
   assert.equal(await page.evaluate(()=>new Promise(resolve=>{let count=0;const frame=()=>++count===4?resolve(count):requestAnimationFrame(frame);requestAnimationFrame(frame);})),4,c.name+' frames continue while awaiting player');
   await button.dispatchEvent('click');assert.equal(await page.locator('.ui-confirm[open]').count(),1,'repeated click cannot create another dialog');
   await page.locator('.ui-confirm [data-confirm=cancel]').click();await page.waitForFunction(sel=>{const b=document.querySelector(sel);return b&&!b.disabled&&!b.dataset.busy;},c.selector);
   assert.deepEqual(await snapshot(),before,c.name+' cancellation has no financial or save effect');
   results.push({engine:engine.name(),action:c.name,cancelAndFrames:true,buttonRecovered:true});
  }
  const beforeEscape=await snapshot();await confirm(cases[1]);await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.ui-confirm')&&!document.querySelector('.launch-ipo').disabled);assert.deepEqual(await snapshot(),beforeEscape);
  results.push({engine:engine.name(),action:'launch-ipo',escapeCancel:true});
  // Decline a stale fixed-price quote; the simulation is now free to progress while the DOM dialog is open.
  await confirm(cases[1]);await page.evaluate(()=>{const v=__GH_STATE__.advanced.valuation;v.fair*=1.05;v.earnings*=1.05;v.nav*=1.05;});const changedQuote=await snapshot();await page.locator('.ui-confirm [data-confirm=accept]').click();await page.waitForFunction(()=>!document.querySelector('.launch-ipo').disabled&&!window.__GH_DURABLE_COMMAND_CONTEXT__);assert.deepEqual(await snapshot(),changedQuote,'an IPO price that moved more than 1% cannot execute or save');
  results.push({engine:engine.name(),action:'launch-ipo',changedQuoteRejected:true});
  // The confirmation UI is required. Its absence cannot fall back to a blocking native confirm or approve an action.
  for(const c of cases){const button=await open(c),before=await snapshot();await page.evaluate(()=>{window.__CONFIRM_INTERFACE__=GH_INTERFACE;window.GH_INTERFACE=null;});await button.click();await page.waitForFunction(sel=>{const b=document.querySelector(sel);return b&&!b.disabled&&!b.dataset.busy;},c.selector);assert.equal(await page.locator('.ui-confirm').count(),0);assert.deepEqual(await snapshot(),before,c.name+' fails closed without confirmation UI');await page.evaluate(()=>{window.GH_INTERFACE=__CONFIRM_INTERFACE__;delete window.__CONFIRM_INTERFACE__;});results.push({engine:engine.name(),action:c.name,missingConfirmationDeclined:true});}
  // Loading refusal is exercised through the actual drawer handler. A failed load must not reload or save.
  await page.evaluate(()=>{const original=GH_PERSISTENCE;window.__CONFIRM_PERSISTENCE__=original;window.GH_PERSISTENCE=Object.freeze({...original,loadSlot:async(_slot,opts)=>{if(opts.previousState!==__GH_STATE__)throw new Error('load used a stale live state');__CONFIRM_TEST__.loads++;return {ok:false,reason:'qa-load-refused'};}});});
  await confirm(cases[0]);await page.evaluate(()=>__AUDIT__.runAuthorizedDomainCommand('corporate','adjust-group-value',{delta:1000000},{silent:true}));const beforeLoad=await snapshot();await page.locator('.ui-confirm [data-confirm=accept]').click();await page.waitForFunction(()=>__CONFIRM_TEST__.loads===1&&!document.querySelector('.ui-confirm'));
  assert.deepEqual(await snapshot(),beforeLoad);assert.equal(await page.locator(cases[0].selector).isDisabled(),false);await page.evaluate(()=>{window.GH_PERSISTENCE=__CONFIRM_PERSISTENCE__;delete window.__CONFIRM_PERSISTENCE__;});
  results.push({engine:engine.name(),action:'load-slot',loadRefusedAndFreshState:true});
  // Exercise the real durable path with asynchronous native acknowledgement and refusal.
  await page.evaluate(()=>{window.GH_NATIVE_BUILD=362;window.webkit={messageHandlers:{saveBridge:{postMessage(m){if(m.action==='storeSaveChunk'){setTimeout(()=>dispatchEvent(new CustomEvent('gh-native-chunk-ack',{detail:{requestId:m.requestId,id:m.id,success:true}})),0);return;}if(m.action!=='commitSave')throw new Error('unexpected native action '+m.action);__CONFIRM_TEST__.commits.push({revision:m.saveRevision,id:m.requestId,mode:__CONFIRM_TEST__.mode});const success=__CONFIRM_TEST__.mode==='ok',generation=success?++__CONFIRM_TEST__.generation:0;setTimeout(()=>dispatchEvent(new CustomEvent('gh-native-save-ack',{detail:{requestId:m.requestId,action:m.action,saveRevision:m.saveRevision,resetEpoch:m.resetEpoch,saveSchemaVersion:m.saveSchemaVersion,saveHash:m.saveHash,success,generation,message:success?null:'qa-native-refusal'}})),50);}}}};});
  for(const c of cases.slice(1)){
   const before=await snapshot();await page.evaluate(()=>{__CONFIRM_TEST__.mode='refuse';__CONFIRM_TEST__.commits=[];});const button=await confirm(c);await page.locator('.ui-confirm [data-confirm=accept]').click();
   await page.waitForFunction(()=>__CONFIRM_TEST__.commits.length>0&&!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked()&&__CONFIRM_PENDING_CLICKS__===0).catch(async error=>{throw new Error(c.name+' refusal: '+JSON.stringify(await page.evaluate(()=>({commits:__CONFIRM_TEST__.commits,lock:GH_PERSISTENCE.isLocked(),durable:GH_TRANSACTION_CORE.telemetry().lastDurable,notices:__GH_STATE__.workflowControl?.history?.slice(0,3),alerts:__GH_STATE__.alerts.slice(0,3)})))+' '+error.message);});
   assert.equal(await page.evaluate(()=>__CONFIRM_TEST__.commits.length),1,c.name+' one rejected commit attempt');assert.deepEqual(await snapshot(),before,c.name+' native refusal restores money, documents and ownership');
   assert.equal(await button.isDisabled(),false,c.name+' button recovers after refusal');assert.equal(await button.getAttribute('aria-busy'),null);
   results.push({engine:engine.name(),action:c.name,nativeRefusalRollback:true,commitAttempts:1});
  }
  for(const c of cases.slice(1)){
   const before=await snapshot();await page.evaluate(()=>{__CONFIRM_TEST__.mode='ok';__CONFIRM_TEST__.commits=[];});const button=await confirm(c);await page.locator('.ui-confirm [data-confirm=accept]').click();await button.dispatchEvent('click').catch(()=>{});
   await page.waitForFunction(()=>__CONFIRM_TEST__.commits.length>0&&!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked()&&__CONFIRM_PENDING_CLICKS__===0);
   const after=await snapshot();assert.equal(await page.evaluate(()=>__CONFIRM_TEST__.commits.length),1,c.name+' one commit despite repeated click');assert.equal(after.revision,before.revision+1);
   if(c.name==='launch-ipo'){assert.equal(after.listed,true);assert.ok(after.balances.group>before.balances.group);assert.equal(after.transfers,before.transfers+1);}
   if(c.name==='collect-all-receivables'){assert.equal(after.receivables.length,0);assert.equal(after.cheques,before.cheques+1);assert.equal(after.balances.group-before.balances.group,11500);}
   if(c.name==='sell-mobility-asset'){assert.equal(after.vehicles.length,0);assert.equal(after.balances.mobility-before.balances.mobility,60000);}
   if(c.name==='sell-asset'){assert.equal(after.assets.length,before.assets.length-1);assert(Math.abs(after.balances.air-before.balances.air-sale)<.005,`the fleet owner's quote ${sale}`);}
   if(c.name==='return-lease'){assert.equal(after.assets.length,before.assets.length-1);assert.equal(after.balances.air-before.balances.air,-2000,'one lease termination fee');}
   if(c.name==='sell-all-assets'){assert.equal(after.assets.length,0);assert(Math.abs(after.balances.air-before.balances.air-sale)<.005,'one remaining owned sale');}
   results.push({engine:engine.name(),action:c.name,success:true,commits:1,revisionDelta:1});
  }
  // Conference preparation normally used DOM already; its missing-component fallback must also decline safely.
  await page.evaluate(()=>{GH_CONFERENCE.ensure(__GH_STATE__).pendingYear=2026;});
  const conference={name:'conference-prepare',panel:'conference',arg:'overview',selector:'[data-gh-action="conference-prepare"]'},beforeConference=await snapshot();
  await confirm(conference);await page.locator('.ui-confirm [data-confirm=cancel]').click();await page.waitForFunction(()=>!document.querySelector('[data-gh-action="conference-prepare"]').disabled);assert.deepEqual(await snapshot(),beforeConference);
  const conferenceButton=await open(conference);await page.evaluate(()=>{window.__CONFIRM_INTERFACE__=GH_INTERFACE;window.GH_INTERFACE=null;});await conferenceButton.click();await page.waitForFunction(()=>!document.querySelector('[data-gh-action="conference-prepare"]').disabled);assert.equal(await page.locator('.ui-confirm').count(),0);assert.deepEqual(await snapshot(),beforeConference);await page.evaluate(()=>{window.GH_INTERFACE=__CONFIRM_INTERFACE__;delete window.__CONFIRM_INTERFACE__;});
  results.push({engine:engine.name(),action:'conference-prepare',cancelAndMissingConfirmationDeclined:true});
  const integrity=await page.evaluate(()=>({schema:GH_SAVE_SCHEMA.validate(__GH_STATE__),integrity:GH_INTEGRITY_CORE.check(__GH_STATE__).counts}));assert.equal(integrity.schema.ok,true,JSON.stringify(integrity.schema));assert.equal(integrity.integrity.critical,0,JSON.stringify(integrity));
  assert.deepEqual(native,[],'all six routes use DOM confirmation');assert.deepEqual(errors,[]);
 }finally{await browser.close();await env?.closeOrigin?.();}
 }if(process.env.GH_CONFIRMATION_RESULTS)fs.writeFileSync(process.env.GH_CONFIRMATION_RESULTS,JSON.stringify(results,null,2));console.log(JSON.stringify({suite:'build386-confirmation-browser',ok:true,engines:2,results}));
})().catch(error=>{console.error(error);process.exitCode=1;});
