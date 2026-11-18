'use strict';
// Build 372: the daily close's insurance stage reads the insured fleet's condition total. The day's maintenance and
// incidents rewrite conditions after the fleet pass, so its memo no longer holds and the stage read every row on the
// main thread (169 ms at a million assets). A staged close now asks the fleet engine's worker
// (GH_FLEET_QUERY_PROVIDER, fleet-query-core conditionSum) and waits for it one stage at a time ('realism.insurance-wait').
// The same answer carries the operations readiness total so the app does not scan the fleet again after this close.
// This gate runs the real daily close (business scenario, maintenance due) and holds:
//   - staged, with a provider answering the store's own total after a few waits: the insurance results equal the plain
//     close's exactly, the stage waited, and the provider was asked once;
//   - the provider's total is what the stage uses (a different total that claims to be current changes the results);
//   - a total that no longer describes the store (current() false), or no answer (null), is not used: the results equal
//     the plain close's;
//   - outside a staged transaction the provider is not asked;
//   - batch H3 (owner, 18 Nov 2026): the question is asked right after the close's maintenance (before the bank, market
//     share, risk and rating stages), its answer used at the insurance stage: one ask, the same results; an answer ready
//     by then is used with no wait at all (the saving H3 is for), the same results; a fleet write after the ask makes it unusable: asked again, the same results; an early question never
//     answered within the wait cap is not asked again (a small fleet then reads the store, as without an answer).
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||require('path').resolve(__dirname,'..');
const assert=require('node:assert/strict');
const {scenario}=require('./helpers/business-scenario');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const QUERY_SOURCE=fs.readFileSync(path.join(process.env.GH_TEST_SOURCE_DIR,'WebApp','fleet-query-core.js'),'utf8');

const DAY=86400;
function setup({extra=0}={}){
  const sc=scenario(),{s,state,ctx,item}=sc,FLEET=s.GH_FLEET_DATA;
  // The worker's pass (fleet-query-core), loaded beside the scenario's owners.
  if(extra){if(!s.GH_FLEET_EVENT_CORE)vm.runInContext(fs.readFileSync(path.join(process.env.GH_TEST_SOURCE_DIR,'WebApp','fleet-event-core.js'),'utf8'),s,{filename:'fleet-event-core.js'});if(!s.GH_FLEET_DAY_CORE)vm.runInContext(fs.readFileSync(path.join(process.env.GH_TEST_SOURCE_DIR,'WebApp','fleet-day-core.js'),'utf8'),s,{filename:'fleet-day-core.js'});}
  if(!s.GH_FLEET_QUERY)vm.runInContext(QUERY_SOURCE,s,{filename:'fleet-query-core.js'});
  state.globalBases.find(row=>row.id==='B1').deliveryCapacity=100;s.GH_FINANCE_CORE.book(state,'air').accounts[0].balance=1e12;
  const out=s.GH_DOMAIN_COMMANDS.dispatch(ctx,'procurement','purchase-assets',{type:'air',assetMode:'air',assetClass:'aircraft',tab:'new',item,base:state.globalBases.find(row=>row.id==='B1'),supplier:ctx.supplierFor(),mode:'cash',qty:12,manual:true,requestRef:'INS-QA',upfront:item.price*12,totalPrice:item.price*12,documentLeadDays:1,leadSeconds:0,immediateDelivery:true},{actor:'insurance-qa',idempotencyKey:'INS-QA-1'});
  assert.ok(out.ok,JSON.stringify(out).slice(0,200));s.GH_REALISM.onSimulationTime(state,state.simSeconds);
  // The game's fleet is a store (the scenario starts with an asset list).
  state.fleet=s.GH_FLEET_STORE.fromAssets(state.assets,{at:state.simSeconds});delete state.assets;assert.ok(s.GH_FLEET_STORE.isStore(state.fleet),'a fleet store');
  const ids=[];FLEET.scan(state,['id'],row=>{ids.push(row.id);});
  // Below the standard policy's line, so the close's maintenance restores them after its fleet pass.
  ids.forEach((id,k)=>FLEET.update(state,id,{condition:k<5?60+k:k===5?0:91.5+k/7}));
  // (A fleet above 2,048 rows takes the large path: the worker's answer also carries the day's metrics.)
  for(let k=0;k<extra;k++)s.GH_FLEET_STORE.add(state.fleet,{id:`INS-QA-X${k}`,type:'air',assetMode:'air',ownerCompanyId:'air',condition:100,purchasePrice:1,phase:'idle'});
  const day=Math.floor(state.simSeconds/DAY)+1;state.simSeconds=day*DAY;
  return {...sc,day,FLEET};
}
const insuranceOf=state=>JSON.stringify({claimsTrend:state.realism.insurance.claimsTrend,renewalIndex:state.realism.insurance.renewalIndex});
const directReadiness=(state,FLEET)=>{let total=0;FLEET.scan(state,['condition'],row=>{total+=Number(row.condition)||0;});return total;};

// The plain close (no provider, not staged).
const plainOf=extra=>{const {s,state,day}=setup({extra});let asked=0;s.GH_FLEET_QUERY_PROVIDER=()=>{asked++;return null;};s.GH_REALISM.onDay(state,day);return {insurance:insuranceOf(state),asked};},plain=plainOf(0);
assert.equal(plain.asked,0,'not asked outside a staged transaction');

// A staged close whose provider answers after `after` calls of step(): {result,current} built by `answer`.
async function staged(answer,after=3,{mutateAfterInsurance=false,mutateAfterAsk=false,neverAnswerFirst=false,shiftTimeInWait=false,extra=0,expectError=null}={}){
  const {s,state,day,FLEET}=setup({extra}),TX=s.GH_TRANSACTION_CORE,askStages=[];let asked=0,resolveAnswer=null,mutated=false,askedForInsurance=null;
  s.GH_FLEET_QUERY_PROVIDER=(st,name,params)=>{
    // This gate owns conditionSum only. Decline the earlier combined daily
    // query without counting it, so the assertions remain about insurance
    // refreshes rather than the independent fleetDay optimization.
    // (A large fleet cannot take the main-thread day pass or identity check: those are answered, current, not counted.)
    if(name==='fleetDay'||name==='identityIntegrity'){if(!extra)return null;const result=s.GH_FLEET_QUERY.run(name,st,FLEET,params),revision=st.fleet.revision;return Promise.resolve({result,current:()=>st.fleet.revision===revision});}
    asked++;askStages.push(stagesSeen.length);assert.equal(name,'conditionSum');
    const result=s.GH_FLEET_QUERY.run(name,st,FLEET,params),revision=st.fleet.revision;
    if(neverAnswerFirst&&asked===1)return new Promise(()=>{});
    return new Promise(resolve=>{resolveAnswer=()=>resolve(answer({result,fresh:()=>st.fleet.revision===revision}));});
  };
  const handle=TX.beginStaged(state,{label:'qa-insurance-day',apply:function*(){return yield* s.GH_REALISM.onDayStages(state,day);}});
  const stages=[],stagesSeen=stages;
  for(let call=0;call<5000&&!handle.done;call++){
    if(resolveAnswer&&stages.filter(stage=>stage==='realism.insurance-wait').length>=after){resolveAnswer();resolveAnswer=null;}
    // One yielded stage per call lets this gate inject the same revision change that a due delivery makes between the
    // insurance stage and the final readiness refresh.
    handle.step(-Infinity);stages.push(handle.stage);
    if(askedForInsurance===null&&handle.stage==='realism.insurance')askedForInsurance=asked;
    if(shiftTimeInWait&&!mutated&&handle.stage==='realism.insurance-wait'){state.simSeconds+=1;mutated='time';}
    if(mutated==='time'&&handle.stage==='realism.insurance'){state.simSeconds-=1;mutated=true;}
    if(mutateAfterAsk&&!mutated&&asked>=1&&askStages[0]===stages.length-1){const id=[];FLEET.scan(state,['id'],row=>{if(!id.length)id.push(row.id);});FLEET.update(state,id[0],{name:'INS-QA-RENAMED'});mutated=true;}
    if(mutateAfterInsurance&&!mutated&&handle.stage==='realism.insurance'){
      s.GH_FLEET_STORE.add(state.fleet,{id:'INS-QA-LATE-DELIVERY',type:'air',assetMode:'air',ownerCompanyId:'air',condition:37,purchasePrice:1,phase:'idle'});mutated=true;
    }
    await new Promise(resolve=>setImmediate(resolve));
  }
  assert.equal(handle.done,true);if(expectError){assert.match(String(handle.error?.message||handle.error),expectError);return {error:String(handle.error?.message||handle.error),asked};}assert.equal(handle.error,null,String(handle.error?.stack||handle.error));assert.equal(handle.result.committed,true);
  return {insurance:insuranceOf(state),readiness:s.GH_REALISM.fleetReadinessTotal(state),directReadiness:directReadiness(state,FLEET),asked,askedForInsurance,waits:stages.filter(stage=>stage==='realism.insurance-wait').length,askAt:askStages[0]??-1,bankAt:stages.indexOf('realism.bank'),operationsAt:stages.indexOf('realism.operations')};
}

(async()=>{
  const used=await staged(({result,fresh})=>({result,current:fresh}));
  assert.equal(used.asked,1,'the staged close asked the worker once');
  assert.ok(used.askAt>=0&&used.askAt>used.operationsAt&&used.askAt<used.bankAt,`H3: asked after the maintenance, before the bank stage (${JSON.stringify(used)})`);assert.ok(used.waits>=3,`waited ${used.waits}`);
  assert.equal(used.insurance,plain.insurance,'the worker total gives the plain close\'s insurance results');
  assert.ok(Object.is(used.readiness,used.directReadiness),'the accepted worker answer also supplies exact post-close readiness');

  const planted=await staged(({result})=>({result:{...result,sum:result.sum*0.5,readiness:result.readiness*0.5},current:()=>true}));
  assert.notEqual(planted.insurance,plain.insurance,'the stage uses the provider\'s total');
  assert.notEqual(planted.readiness,planted.directReadiness,'a claimed-current readiness result is the one exposed to the operations brief');

  const delivered=await staged(({result,fresh})=>({result,current:fresh}),1,{mutateAfterInsurance:true});
  assert.equal(delivered.asked,2,'a fleet delivery after insurance refreshes readiness on the worker');
  assert.ok(Object.is(delivered.readiness,delivered.directReadiness),'the refreshed result includes the delivered asset exactly');

  const stale=await staged(({result})=>({result:{...result,sum:result.sum*0.5},current:()=>false}));
  assert.equal(stale.insurance,plain.insurance,'a total that no longer describes the store is not used');

  const none=await staged(()=>null,1);
  assert.equal(none.insurance,plain.insurance,'without an answer the stage reads the store itself');

  // (The saving H3 is for: an answer ready by the insurance stage is used with no wait, the same results, asked once.)
  const ready=await staged(({result,fresh})=>({result,current:fresh}),0);
  assert.equal(ready.askedForInsurance,1,'H3: the early answer is used');assert.equal(ready.waits,0,`H3: no wait at the insurance stage (${ready.waits})`);assert.equal(ready.insurance,plain.insurance,'H3: the same results');assert.ok(Object.is(ready.readiness,ready.directReadiness));
  // (An early question made stale by a fleet write and never answered: not waited on; asked again at once.)
  const staleSilent=await staged(({result,fresh})=>({result,current:fresh}),1,{mutateAfterAsk:true,neverAnswerFirst:true});
  assert.equal(staleSilent.askedForInsurance,2,'H3: a stale early question is not waited on, asked again');assert.equal(staleSilent.insurance,plain.insurance);
  // (A fleet above 2,048 rows: the early answer also carries the day's metrics, so the close asks once; never answered: the
  //  large fleet refuses the close as before, no second ask.)
  const largePlain=plainOf(2100),large=await staged(({result,fresh})=>({result,current:fresh}),0,{extra:2100});
  assert.equal(large.asked,1,'H3: a large fleet asks once (the early answer kept the day\'s metrics)');assert.equal(large.insurance,largePlain.insurance,'H3: large: the same results');
  const largeSilent=await staged(({result,fresh})=>({result,current:fresh}),1,{extra:2100,neverAnswerFirst:true,expectError:/fleet-condition-worker-unavailable/});
  assert.equal(largeSilent.asked,1,'H3: large, unanswered at the cap: refused, not asked again');
  const moved=await staged(({result,fresh})=>({result,current:fresh}),1,{mutateAfterAsk:true});
  assert.equal(moved.askedForInsurance,2,'H3: a fleet write after the early ask: the early answer is not used, the stage asks again');assert.equal(moved.insurance,plain.insurance,'H3: the same results');
  const shifted=await staged(({result,fresh})=>({result,current:fresh}),2,{shiftTimeInWait:true});
  assert.equal(shifted.askedForInsurance,2,'H3: an early answer whose key (the game time) moved during the wait is not used');
  // (An early answer whose total is not a finite number is not used: the stage asks again and gets the store's total.)
  let nanAnswers=0;const nan=await staged(({result,fresh})=>++nanAnswers===1?{result:{...result,sum:NaN},current:()=>true}:{result,current:fresh},1);
  assert.equal(nan.askedForInsurance,2,'H3: an early answer with a non-finite total is not used, asked again');assert.equal(nan.insurance,plain.insurance,'H3: non-finite: the same results');
  const silent=await staged(({result,fresh})=>({result,current:fresh}),1,{neverAnswerFirst:true});
  assert.equal(silent.askedForInsurance,1,'H3: an early question unanswered within the wait cap is not asked again');assert.equal(silent.insurance,plain.insurance,'H3: a small fleet then reads the store');
  console.log(JSON.stringify({ok:true,insurance:JSON.parse(plain.insurance),waits:used.waits}));
})().catch(error=>{console.error(error);process.exitCode=1;});
