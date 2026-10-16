'use strict';
// This isolates the registered UI handlers. Domain results are fixtures here; the companion browser suite runs
// real authorized domain commands, persistence, native acknowledgements, and save/reload checks.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');
const fixturePath=path.join(__dirname,'helpers/save-action-cases.json'),fixture=JSON.parse(fs.readFileSync(fixturePath,'utf8'));
(async()=>{const browser=await chromium.launch({headless:true}),errors=[];try{
 const {page}=await boot({browser,errors});
 await page.evaluate(async()=>{__GH_STATE__.godMoney=true;__GH_STATE__.infiniteMoney=true;for(const type of ['air','sea','road','power','bank','insurance','realestate','telecom','dealership'])await __AUDIT__.runAuthorizedDomainCommand('corporate','open-company',{type,capital:200000000,legalName:'QA '+type},{silent:true});__AUDIT__.openDrawer('settings');window.__QA_ACTION_ORIGIN__=document.querySelector('[data-gh-action-origin]').dataset.ghActionOrigin;__AUDIT__.closeDrawer();});
 const results=await page.evaluate(async actions=>{
  const real={workflow:GH_WORKFLOW,interaction:GH_INTERACTION,ui:GH_INTERFACE,hr:GH_HR_CORE,world:GH_BUSINESS_WORLD,energy:GH_ENERGY_CORE,date:Date.now,random:Math.random};
  let trace,confirmed=true,mode='success';Date.now=()=>1700000000000;Math.random=()=>.5;
  GH_INTERFACE={...real.ui,confirm:async()=>{trace.confirmations++;return confirmed;}};
  GH_WORKFLOW={...real.workflow,notify:(text,kind='info')=>{trace.messages.push({text:String(text),kind});}};
  GH_INTERACTION={...real.interaction,run:(_button,work)=>{window.__CASE_PROMISE__=Promise.resolve().then(work);return __CASE_PROMISE__;}};
  GH_HR_CORE={...real.hr,snapshot:()=>({total:mode==='no-work'?0:3})};
  GH_BUSINESS_WORLD={...real.world,snapshot:()=>({sponsorships:[{id:'QA',partyId:'QA-PARTY',value:100,termDays:30}]}),resolveParty:()=>({displayName:'QA Party'})};
  GH_ENERGY_CORE={...real.energy,projectFinanceRoom:()=>1000000};
  const result={id:'QA-RESULT',name:'QA Result',city:'QA City',cost:100,until:30,premium:100,principal:100,expectedLoss:10,riskGrade:'BBB',sight:.01,savings:.02,term:.03,maxLdr:80,minLcr:110,minCet1:12,enabled:true,action:'write-off',loanId:'QA',recovery:100,loss:10,amount:100,total:3,rows:[{}],rate:.07,price:100,units:2,annualRent:100,priceLevel:1.1,completeDay:30,monthlyPrice:100,level:2,supplyAgreements:3,quantity:2,invoiceNumber:'QA-INVOICE',chequeId:'QA-CHEQUE',bankApplicationId:'QA-APP',status:'sold-financed',bankDisbursementReference:'QA-TRANSFER',approved:1,rejected:0,skipped:0,totalPrincipal:100,activeCustomers:10,coverageAfter:100,won:true,contract:{id:'QA-CONTRACT',capacityMW:10},bidPrice:100,winningPrice:90,buyer:'QA Buyer',capacityMW:10,tariff:100,dispatchMode:'balanced',reserveMargin:10,siteName:'QA Site',durationDays:3,startDay:7,priceMWh:100,termDays:365,interest:10,coverage:.9,rtoHours:2,ships:3,plan:{untilDay:30}};
  const facility={id:'QA',name:'QA Facility',kind:'airport-base',ownerCompanyId:'air',company:'air',owned:true,coords:[24,46]};
  __GH_STATE__.bank.loanRequests=[{id:'QA',sourceCompanyId:'dealership',customerId:'QA',sourceSaleId:'QA'}];
  const fields={telecomCustomerName:'QA Customer',telecomCohortId:'QA',telecomCohortSize:10,telecomCohortPrice:100,dealerStockModel:'QA',dealerStockQuantity:2,dealerStockReference:'QA',dealerSaleCustomer:'QA',dealerSaleModel:'QA',dealerSaleQuantity:1,dealerSalePrice:100,dealerServiceId:'QA',dealerServiceCustomer:'QA',dealerServicePrice:100,icLoanLender:'group',icLoanBorrower:'air',icLoanAmount:100,icLoanRate:7,icLoanTerm:365,'repay-QA':100,treasuryReserveAmount:100,insReinsurance:.4,'insPrice-QA':1.1,'rePrice-QA':1.1,reOffice:'QA',reType:'residential',reSize:1,reMode:'sale',rePriceLevel:1.1,'reTenant-QA':'air','reTenantUnits-QA':2,'reTenantRate-QA':1,'reTenantYears-QA':1,'businessSponsorCompany-QA':'air'};
  const root=document.createElement('div');document.body.append(root);
  const observed=[];
  for(const action of actions){
   for(const attempt of ['success','failure','cancel',...(['hr-hire-all','hr-hire-company'].includes(action.action)?['no-work']:[]),...(action.action==='dealership-settle-financed-sale'?['pending']:[]),...(action.action==='dealership-retail-sale'?['finance']:[])]){
    trace={action:action.action,attempt,calls:[],messages:[],views:[],saves:0,commits:0,confirmations:0,noticeBeforeCommit:false,sideEffects:[]};mode=attempt;confirmed=attempt!=='cancel';window.__CASE_PROMISE__=null;
    root.innerHTML='<article class="list-item"><select data-finance-share><option value="0.2">20%</option></select><button type="button"></button></article>';
    for(const [id,value]of Object.entries(fields)){const input=document.createElement('input');input.id=id;input.value=String(value);root.append(input);}
    const include=document.createElement('input');include.type='checkbox';include.checked=true;include.dataset.customerFinanceInclude='QA';root.append(include);
    const decision=document.createElement('select');decision.dataset.customerFinanceDecision='QA';decision.innerHTML='<option value="approve">Approve</option>';root.append(decision);
    const financed=document.createElement('input');financed.id='dealerSaleFinance';financed.type='checkbox';financed.checked=attempt==='finance';root.append(financed);
    const button=root.querySelector('button');Object.assign(button.dataset,{ghAction:action.action,ghActionOrigin:__QA_ACTION_ORIGIN__,id:'QA',company:'air',line:'QA',project:'QA',branch:'QA',office:'QA',offer:'QA',sale:'QA',loan:'QA',lease:'QA',site:'QA',plan:'mobile',level:'1.1',days:'30',tier:'premium',mode:'bank',enabled:'true',active:'1',program:'QA',share:'.2',term:'365',preset:'balanced',nplAction:'write-off',tender:'QA'});
    const ctx={state:__GH_STATE__,currentPanel:'qa',currentArg:'QA',fmtMoney:v=>'$'+Number(v).toFixed(2),fmtNumber:v=>String(Number(v)),typeName:v=>String(v),findFacility:()=>facility,getDynamicFacilities:()=>[facility],requireFleetUiSummary:async()=>({result:{},lookup:{},current:()=>true}),save:()=>{trace.saves++;},updateKpis:()=>{},openDrawer:(panel,arg)=>trace.views.push({panel,arg:arg??null}),renderMap:()=>{},refreshRouteRuntime:()=>trace.sideEffects.push('routes'),pushAlert:text=>trace.messages.push({text:String(text),kind:null}),runAuthorizedDomainCommand:async request=>{
     trace.calls.push({domain:request.domain,name:request.name,payload:request.payload,context:request.context||null,idempotencyKey:request.idempotencyKey||null});
     if(mode==='failure')throw new Error('qa-rejected');
     const value=mode==='pending'?{...result,status:'financing-pending',bankDisbursementReference:null,invoiceNumber:null}:['bank-draw-facility','bank-cash-sweep'].includes(action.action)?100:result;
     if(request.successNotice){const notice=request.successNotice(value);trace.messages.push(typeof notice==='string'?{text:notice,kind:null}:{text:notice.text,kind:notice.kind??null});trace.noticeBeforeCommit=true;}
     trace.commits++;return {ok:true,result:value,commandId:'QA-COMMAND'};
    }};
    GH_ADVANCED.bind(root,ctx);button.click();if(!window.__CASE_PROMISE__)throw new Error('not bound '+action.action);await window.__CASE_PROMISE__;
    observed.push(JSON.parse(JSON.stringify(trace)));
   }
  }
  root.remove();GH_WORKFLOW=real.workflow;GH_INTERACTION=real.interaction;GH_INTERFACE=real.ui;GH_HR_CORE=real.hr;GH_BUSINESS_WORLD=real.world;GH_ENERGY_CORE=real.energy;Date.now=real.date;Math.random=real.random;
  return observed;
 },fixture.actions);
 if(process.env.GH_SAVE_ACTION_CAPTURE){fs.writeFileSync(process.env.GH_SAVE_ACTION_CAPTURE,JSON.stringify(results,null,2));console.log(JSON.stringify(results.map(r=>({action:r.action,attempt:r.attempt,calls:r.calls.length,saves:r.saves,commits:r.commits,messages:r.messages}))));}
 else{
  assert.equal(results.length,67*3+4);
  for(const r of results){const before=fixture.baseline.find(b=>b.action===r.action&&b.attempt===r.attempt);assert.ok(before,r.action+' baseline');assert.deepEqual(r.calls,before.calls,r.action+' preserves command payload/authority context');assert.deepEqual(r.messages,before.messages,r.action+' preserves player messages');assert.deepEqual(r.views,before.views,r.action+' preserves return view');assert.deepEqual(r.sideEffects,before.sideEffects);assert.equal(r.saves,0,r.action+' view never requests a world save');
   if(['success','pending','finance'].includes(r.attempt)||r.attempt==='cancel'&&!r.confirmations){assert.equal(r.calls.length,1,r.action+' executes command');assert.equal(r.commits,1);assert.equal(r.noticeBeforeCommit,true,r.action+' notice belongs to the original commit');}
   else{assert.equal(r.commits,0);assert.equal(r.calls.length,r.attempt==='cancel'||r.attempt==='no-work'?0:1);}
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({suite:'build387-save-actions',ok:true,actions:67,results:results.length,scope:'registered UI handlers; domain results are isolated fixtures, financial execution covered by browser companion'}));
 }
 }finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
