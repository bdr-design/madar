'use strict';
const fs=require('node:fs'),path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'../..');
async function prepare(page,{rows=4400}={}){
 await page.evaluate(fs.readFileSync(path.join(ROOT,'WebApp/save-chunk-codec.js'),'utf8'));
 return page.evaluate(async rows=>{
  const a=__AUDIT__;window.GH_NATIVE_ROW_PATCHES=1;window.GH_NATIVE_VALUE_CHUNKS=1;window.GH_NATIVE_CHUNK_ENCODINGS=['gh-packbits-v1'];__GH_STATE__.godMoney=true;__GH_STATE__.infiniteMoney=true;
  for(const type of ['air','sea','road','power','bank','mobility','insurance','realestate','telecom','dealership','hospitality']){if(__GH_STATE__.openedCompanies.includes(type))continue;const d=GH_COMPANY_PLATFORM.definitionFor(__GH_STATE__,type);await a.runAuthorizedDomainCommand('corporate','open-company',{type,companyId:type,capital:Math.max(900000000,d.founding.minimumCapital),legalName:'QA Decision '+type,formationContract:'QA-DECISION-'+type},{silent:true});}
  const model=GH_ASSET_CATALOG.air.used.filter(m=>!m.specs.cargo&&Number(m.specs.rangeKm)>=6000).sort((a,b)=>a.price-b.price)[0];
  for(const [i,code] of ['OMDB','EGLL'].entries()){
   const r=GH_WORLD_DATA.airports.find(r=>r[0]===code),id='QA-DEC-'+code;
   await a.runAuthorizedDomainCommand('facilities','create',{facility:{id,name:'QA '+code,kind:'airport-base',company:'air',ownerCompanyId:'air',owned:true,sourceKey:'air:'+code,code:r[1]||code,icao:code,iata:r[1],city:r[3]||'—',country:String(r[5]||'—'),coords:[r[6],r[7]]},bucket:'globalBases'},{silent:true});
   if(!await a.buyAsset('air','used',model.id,'lease',i?rows-Math.floor(rows/2):Math.floor(rows/2),id,true,'QA-DEC-'+code,'air'))throw Error('decision-fleet-buy-failed:'+code);
  }
  const cap=GH_MOBILITY_CORE.capitalMeta('RUH');
  for(const type of ['bank','insurance','telecom']){
   const kind=type==='telecom'?'telecom-branch':type,facility={id:'QA-DEC-'+type,name:'QA '+type,kind,ownerCompanyId:type,company:type,owned:true,capitalId:'RUH',sourceKey:`site:${type}:RUH`,city:cap.city,country:cap.country,coords:cap.coords};
   await a.runAuthorizedDomainCommand('facilities','create',{facility,bucket:'customHubs'},{silent:true});
   if(type==='bank')await a.runAuthorizedDomainCommand('banking','open-branch',{facilityId:facility.id,branchId:'QA-DEC-BR',site:facility},{silent:true});
  }
  const s=__GH_STATE__;GH_INSURANCE_CORE.ensure(s);GH_TELECOM_MARKET.ensure(s);
  return {rows:GH_FLEET_DATA.size(s),companies:s.openedCompanies.length};
 },rows);
}
async function seed(page,{kind,decision,count=5,seq=0}={}){
 return page.evaluate(({kind,decision,count,seq})=>{
  if(GH_TRANSACTION_CORE.isStaged(__GH_STATE__)||GH_PERSISTENCE.isLocked()||window.__GH_DURABLE_COMMAND_CONTEXT__)throw Error('decision-fixture-not-idle');const s=__GH_STATE__,day=Math.floor(s.simSeconds/86400),rows=Array.from({length:count},(_,i)=>({id:`QA-${kind}-${seq}-${decision}-${i}`,day,expiresDay:day+7}));
  if(kind==='bank')s.bank.loanRequests=rows.map((r,i)=>({...r,borrower:'QA Customer '+seq+' '+i,sector:'consumer',product:'consumer',amount:500000,termDays:365,riskGrade:'A',collateralCoverage:1,branchId:'QA-DEC-BR'}));
  if(kind==='insurance'){const ins=GH_INSURANCE_CORE.ensure(s);ins.riskRequests=rows.map((r,i)=>({...r,subject:'QA risk '+seq+' '+i,officeId:ins.offices[0].id,grade:'A',sumInsured:1000000,premium:10000,expectedLoss:1000,status:'بانتظار القرار'}));}
  if(kind==='telecom'){const m=GH_TELECOM_MARKET.ensure(s),b=m.branches[0];m.requests=rows.map((r,i)=>({...r,branchRowId:b.id,customerName:'QA Enterprise '+seq+' '+i,industry:'خدمات',country:b.country,lines:100,monthlyPrice:420,monthlyValue:42000,months:12,status:'بانتظار القرار'}));}
  return rows.map(r=>r.id);
 },{kind,decision,count,seq});
}

async function activity(page){
 return page.evaluate(()=>{const state=__GH_STATE__;let routed=0,moving=0;GH_FLEET_DATA.scan(state,['routeId','phase'],row=>{if(row.routeId)routed++;if(row.phase==='moving')moving++;});return {routed,moving,simSeconds:state.simSeconds};});
}

// Bounded test instrumentation; no product hook or financial owner is replaced.
async function installTrace(page){
 await page.evaluate(()=>{
  const q=window.__REQUEST_TRACE__={active:false,spans:{},events:[],calls:[],liveAlerts:0,uiSummaryQueries:0,prestages:0,started:0,confirmed:0,ack:0,ended:0,originalButton:null};
  const persistence=GH_PERSISTENCE;window.GH_PERSISTENCE={...persistence,prestageDurableChunks(...args){if(q.active)q.prestages++;return persistence.prestageDurableChunks(...args);}};
  const client=__AUDIT__.fleetEngineThreadClient(),query=client.query;client.query=function(store,options){if(options?.name==='uiSummary')q.uiSummaryQueries++;return query.call(client,store,options);};
  const record=(name,a,b)=>{if(!q.active)return;const span=q.spans[name]||(q.spans[name]={count:0,totalMs:0,maxMs:0});span.count++;span.totalMs+=b-a;span.maxMs=Math.max(span.maxMs,b-a);q.ended=Math.max(q.ended,b);};
  q.restore=__AUDIT__.installWorkProbe(record);const diagnostics=GH_DIAGNOSTICS,commands=GH_DOMAIN_COMMANDS;
  window.GH_DIAGNOSTICS={...diagnostics,recordMainThreadWork(s,label,a,b,...rest){record(label,a,b);return diagnostics.recordMainThreadWork?.(s,label,a,b,...rest);}};
  window.GH_DOMAIN_COMMANDS={...commands,dispatchSystem(ctx,name,command,...rest){if(q.active&&ctx?.state===__GH_STATE__&&name==='operations'&&command==='record-alert')q.liveAlerts++;return commands.dispatchSystem(ctx,name,command,...rest);},async dispatchDurable(ctx,envelope,options){
   const intent=GH_AUTHORIZATION.commandIntent(envelope.command),call={domain:intent.domain,name:intent.name,payload:intent.payload,key:intent.idempotencyKey,done:false};if(q.active)q.calls.push(call);
   try{const receipt=await commands.dispatchDurable(ctx,envelope,options);call.receipt={committed:receipt.committed,idempotent:receipt.idempotent===true,result:receipt.value?.result};return receipt;}catch(error){call.error=String(error.message||error);throw error;}finally{call.done=true;call.ended=performance.now();}
  }};
  addEventListener('gh-native-save-ack',event=>{if(q.active){q.ack=performance.now();q.events.push({kind:'ack',ok:event.detail.success,at:q.ack});}});
  document.addEventListener('click',event=>{const button=event.target.closest('[data-gh-action="company-decide-pending"],[data-gh-action="bank-loan-request"],[data-gh-action="insurance-decide-risk"],[data-gh-action="insurance-decide-risks-batch"]');if(button){q.active=true;q.originalButton=button;q.started=q.confirmed=performance.now();}if(event.target.closest('.ui-confirm [data-confirm="accept"]'))q.confirmed=performance.now();},true);
  q.financial=()=>GH_AUTHORIZATION.stable({bank:__GH_STATE__.bank,insurance:__GH_STATE__.insurance,customers:__GH_STATE__.customerCompanies,finance:__GH_STATE__.finance,books:__GH_STATE__.companyFinance,treasury:__GH_STATE__.treasury,proofs:__GH_STATE__.documentProofs,authorization:__GH_STATE__.authorization});
 });
}
async function open(page,{kind,decision,single=false,hold=false,mode='ok',panel='company'}={}){
 await page.evaluate(()=>__AUDIT__.whenStateIdle());
 await page.evaluate(({kind,hold,mode,panel})=>{const q=__REQUEST_TRACE__;q.active=false;q.uiSummaryQueries=0;__AUDIT__.openDrawer(panel,panel==='company'?kind:{tab:'overview'});q.spans={};q.events=[];q.calls=[];q.liveAlerts=0;q.prestages=0;q.started=q.confirmed=q.ack=q.ended=0;q.originalButton=null;__DIFF_VAULT__.hold=hold;__DIFF_VAULT__.mode=mode;__DIFF_VAULT__.attempts=[];__DIFF_VAULT__.uploads=[];},{kind,hold,mode,panel});
 if(panel==='bank')return page.locator(`[data-gh-action="bank-loan-request"][data-decision="${decision==='accept'?'approve':'reject'}"]`).first();
 if(panel==='insurance'){
  if(!single)await page.locator('[data-insurance-risk-select]').evaluateAll(rows=>rows.forEach(row=>{row.checked=true;row.dispatchEvent(new Event('change',{bubbles:true}));}));
  return page.locator(`[data-gh-action="insurance-decide-${single?'risk':'risks-batch'}"][data-decision="${decision==='accept'?'accept':'decline'}"]${single&&decision==='accept'?'[data-share="1"]':''}`).first();
 }
 return page.locator(`[data-gh-action="company-decide-pending"][data-kind="${kind}"][data-decision="${decision}"]${single?'[data-request]':':not([data-request])'}`).first();
}
async function press(page,button,{cancel=false}={}){
 const action=await button.getAttribute('data-gh-action');await button.click();
 if(action==='company-decide-pending'||action==='insurance-decide-risks-batch')await page.locator(`.ui-confirm [data-confirm="${cancel?'cancel':'accept'}"]`).click();
}
async function waitFinished(page){
 await page.waitForFunction(()=>{const q=__REQUEST_TRACE__;return q.calls.length===1&&q.calls[0].done&&!q.originalButton?.hasAttribute('aria-busy')&&!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked();});
}
async function read(page){
 return page.evaluate(()=>{
  const q=__REQUEST_TRACE__;q.active=false;const calls=q.calls.map(c=>({...c}));return {calls,liveAlerts:q.liveAlerts,uiSummaryQueries:q.uiSummaryQueries,prestages:q.prestages,toAckMs:q.ack-q.confirmed,toUiEndMs:q.ended-q.confirmed,maxMeasuredSyncMs:Math.max(0,...Object.values(q.spans).map(s=>s.maxMs)),spans:q.spans,attempts:__DIFF_VAULT__.attempts.length,uploadBytes:__DIFF_VAULT__.uploads.reduce((n,c)=>n+c.bytes,0),wireBytes:__DIFF_VAULT__.uploads.reduce((n,c)=>n+(c.wireBytes??c.bytes),0),timing:GH_TRANSACTION_CORE.telemetry().lastDurable,rows:GH_FLEET_DATA.size(__GH_STATE__),companies:__GH_STATE__.openedCompanies.length};
 });
}
module.exports={prepare,seed,activity,installTrace,open,press,waitFinished,read};

