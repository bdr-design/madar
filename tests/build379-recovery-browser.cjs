'use strict';
// Actual daily-close regression on both engines; isolated fixtures, no player save.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');const {chromium,webkit}=require(path.join(root,'node_modules/playwright')),{boot}=require(path.join(root,'tests/helpers/local-dom-app'));
const QTY=40,results=[];
async function requestAdvance(page,target,reason){const out=await page.evaluate(({target,reason})=>__AUDIT__.simulationEngine.advanceTo(target,{reason}),{target,reason});assert.equal(out.accepted,true,JSON.stringify(out));await page.waitForFunction(()=>!__AUDIT__.simulationEngine.snapshot().manualAdvance,null,{timeout:180000});return out;}
async function trial(browser,engine,balance){
 const errors=[];const {page}=await boot({browser,errors});page.setDefaultTimeout(90000);console.log(JSON.stringify({phase:'setup',engine,balance}));
 try{
  await page.evaluate(async qty=>{
   const a=__AUDIT__,get=()=>__GH_STATE__,type='air',def=GH_COMPANY_PLATFORM.definitionFor(get(),type);
   await a.runAuthorizedDomainCommand('corporate','open-company',{type,companyId:type,capital:Math.max(400000000,def.founding.minimumCapital),legalName:'QA Report Review',formationContract:'QA-REPORT-REVIEW'},{silent:true});
   const airport=GH_WORLD_DATA.airports.find(r=>r[0]==='OMDB'),facility={id:'QA-air-OMDB',name:'QA Airport OMDB',kind:'airport-base',company:type,ownerCompanyId:type,owned:true,sourceKey:'air:OMDB',code:airport[1]||airport[0],icao:airport[0],iata:airport[1],city:airport[3]||airport[4]||'—',country:String(airport[5]||'—'),coords:[airport[6],airport[7]]};
   await a.runAuthorizedDomainCommand('facilities','create',{facility,bucket:'globalBases'},{silent:true});
   const model=[...GH_ASSET_CATALOG[type].used].sort((x,y)=>(x.leaseMonthly||0)-(y.leaseMonthly||0)||x.price-y.price)[0];
   if(!await a.buyAsset(type,'used',model.id,'lease',qty,facility.id,true,'QA-REVIEW-'+qty,type))throw new Error('fixture-purchase-rejected');a.openDrawer('routes',type);
  },QTY);
  await page.locator('.dispatch-international-network[data-company="air"]').first().click();
  await page.waitForFunction(qty=>{const rows=GH_FLEET_DATA.filter(__GH_STATE__,a=>(a.ownerCompanyId||a.companyId)==='air');return rows.length===qty&&rows.every(a=>a.routeId);},QTY,{timeout:120000});
  await page.waitForFunction(()=>!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked(),null,{timeout:180000});await page.evaluate(()=>GH_PERSISTENCE.drain());await page.evaluate(()=>__AUDIT__.closeDrawer());
  const target=await page.evaluate(()=>(Math.floor((__GH_STATE__.simSeconds+2)/86400)+1)*86400-60);
  console.log(JSON.stringify({phase:'warmup',engine,balance,target}));await requestAdvance(page,target,'posting-regression-warmup');
  const setup=await page.evaluate(balance=>{const st=__GH_STATE__,F=GH_FINANCE_CORE;F.book(st,'air').accounts[0].balance=balance;F.reconcile(st);return {day:st.lastFinancialDay,sim:st.simSeconds,air:F.operating(st,'air'),pendingAir:Number(st.finance.pendingDailyCash?.air)||0};},balance);
  await page.evaluate(()=>{const original=GH_FINANCE_CORE.assertAccountPosting;window.__postingFault=true;GH_FINANCE_CORE.assertAccountPosting=(state,receipt,expected)=>{if(window.__postingFault&&expected.code?.startsWith('daily-profit-'))GH_FINANCE_CORE.book(state,receipt.company).accounts[0].balance+=.1;return original(state,receipt,expected);};});
  await requestAdvance(page,target+120,'posting-fault-injection');
  const failed=await page.evaluate(()=>({sim:__GH_STATE__.simSeconds,day:__GH_STATE__.lastFinancialDay,fatal:__AUDIT__.simulationEngine.snapshot().fatalError,health:GH_DIAGNOSTICS.runHealthCheck(__GH_STATE__).status,failures:GH_TRANSACTION_CORE.telemetry().lastSimulation.rollbackFailures}));
  assert.equal(failed.sim,setup.sim);assert.equal(failed.day,setup.day);assert.equal(failed.fatal.code,'FINANCE_ACCOUNT_POSTING_MISMATCH');assert.equal(failed.fatal.postingEvidence.company,'air');assert.equal(failed.health,'critical');assert.deepEqual(failed.failures,[]);
  await page.evaluate(()=>{__AUDIT__.simulationEngine.reset();window.__postingFault=false;});
  assert.equal(await page.evaluate(()=>!!__AUDIT__.simulationEngine.snapshot().fatalError),true);
  await requestAdvance(page,target+120,'posting-verified-recovery');
  const outcome=await page.evaluate(()=>{const st=__GH_STATE__,snap=__AUDIT__.simulationEngine.snapshot(),last=GH_TRANSACTION_CORE.telemetry().lastSimulation;return {day:st.lastFinancialDay,sim:st.simSeconds,fatalError:snap.fatalError?.message||null,settlement:(st.finance.transfers||[]).find(t=>t.kind==='daily-operating-settlement'&&t.company==='air'&&t.day===st.lastFinancialDay)||null,rollbackFailures:last?.rollbackFailures||[],integrity:GH_INTEGRITY_CORE.check(st).counts};});
  assert.equal(outcome.day,setup.day+1);assert.equal(outcome.sim,target+120);assert.equal(outcome.fatalError,null);assert.equal(outcome.integrity.critical,0);assert.equal(outcome.settlement.accountBalanceAfter,outcome.settlement.accountBalanceBefore+outcome.settlement.signedAmount);
  const recovered=await page.evaluate(()=>({kernel:__GH_STATE__.simulationKernel,sim:__AUDIT__.simulationEngine.snapshot(),health:GH_DIAGNOSTICS.runHealthCheck(__GH_STATE__,{simulation:__AUDIT__.simulationEngine.snapshot()}).status}));
  assert.equal(recovered.sim.fatalError,null);assert.equal(recovered.kernel.runtimeFatal,undefined);assert.equal(recovered.kernel.lastAdvanceFailure,undefined);assert.equal(recovered.kernel.lastRecoveredFailure.code,'SIM_CALENDAR_ADVANCE_FAILED');assert.equal(recovered.sim.lastRecoveredFatal.error.code,'FINANCE_ACCOUNT_POSTING_MISMATCH');assert.notEqual(recovered.health,'critical');
  const result={engine,balance,setup,outcome,failed,recoveredAt:recovered.sim.lastRecoveredFatal.recoveredAt};
  result.pageErrors=errors;assert.deepEqual(errors,[]);return result;
 }finally{await page.close();}
}
(async()=>{
 for(const engine of [chromium,webkit]){
  const browser=await engine.launch({headless:true,...(engine===webkit?{executablePath:webkit.executablePath()}:{})});
  try{for(const balance of [1.98e14]){const result=await trial(browser,engine.name(),balance);results.push(result);console.log(JSON.stringify({phase:'case-complete',engine:engine.name(),balance,day:result.outcome.day,fatal:result.outcome.fatalError,recovery:result.recoveryAfterFixtureBalanceChange}));}}
  finally{await browser.close();}
 }
 console.log(JSON.stringify({suite:'build379-recovery-browser',ok:true,cases:results.length,engines:2,results}));
})().catch(e=>{console.error(e);process.exitCode=1;});
