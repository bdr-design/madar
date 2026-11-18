'use strict';
// Build 705, batch F (owner, 17 Nov 2026: faults 1-4, «إصلاح الكل الآن», the five balance changes, every asset under the
// line checked daily in slices). With the real owners (business scenario):
//   1. a staged worker close of 3,000 aircraft under the line (more than the former 2,000 cap; by id, 128 rows a step)
//      restores every one, resets their hours, bills each at its wear, and is byte-identical to the main-thread close;
//   1b. 70,000 trucks under the line (more than 16,384: the ordered column plan, with the
//      transaction's undo copy of the condition column): the same, byte-identical;
//   1c. the plan's boundary: 16,384 checks are written by id (128 a step), 16,385 by the column plan;
//   2. both staged closes aborted after the checks roll the fleet and the books back byte for byte;
//   3. B3: a parked fleet (no route, or idle) carries no incident risk, has no accident in 120 days, is never sampled;
//   4. B4: a truck's loss is no longer swallowed by the aircraft-sized 250,000 minimum: at today's severity the 10%
//      rate decides, and the insurer pays the rest (12: where a programme lowers the loss, the per-incident minimum at
//      1% of the average truck binds);
//   5. B5: the manual service charges the close's quote whatever `cost` says, refuses a stale quote and a missing cash
//      balance with nothing changed, and is free at 100%;
//   6. fault 3: an asset isolated while moving is serviced back at its base (fault cleared, charged once, no trip
//      income); a healthy moving one is refused; return-to-base parks the isolated one free, keeps the fault, and is
//      refused a second time;
//   7. «إصلاح الكل الآن»: the quote (maintenanceBacklog) is the charge and the cash change; every quoted asset is at
//      100% and an aircraft's hours are reset; a stale quote, another company's asset, an asset above the line and more
//      than 2,000 ids are refused with nothing changed;
//   8. fault 4: one notice on a day with accidents, one on a large check bill, none on a quiet day.
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||require('node:path').resolve(__dirname,'..');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {scenario}=require('./helpers/business-scenario');
const ROOT=process.env.GH_TEST_SOURCE_DIR,DAY_SOURCE=fs.readFileSync(path.join(ROOT,'WebApp','fleet-day-core.js'),'utf8'),QUERY_SOURCE=fs.readFileSync(path.join(ROOT,'WebApp','fleet-query-core.js'),'utf8');
const DAY=86400,PRICE=45000000;
const template={id:'',name:'',type:'air',assetMode:'air',assetClass:'aircraft',ownerCompanyId:'air',companyId:'air',ownership:'owned',purchasePrice:PRICE,year:2021,baseFacility:'B1',phase:'turnaround',condition:100,flightHours:0,flightCycles:0,nextCheckHours:600,specs:{capacity:180,capacityUnit:'مقعد',rangeKm:5500,speedKmh:820},lastTrip:{distanceKm:1300,revenue:90000,fuelCost:17000,crewCost:7000,maintReserve:4000},staffing:{mode:'automatic-fixed',ready:true,total:8,monthlyPayroll:120000}};
function setup(count,make){
  const sc=scenario(),{s,state}=sc;if(!s.GH_FLEET_EVENT_CORE)vm.runInContext(fs.readFileSync(path.join(ROOT,'WebApp','fleet-event-core.js'),'utf8'),s,{filename:'fleet-event-core.js'});vm.runInContext(DAY_SOURCE,s,{filename:'fleet-day-core.js'});vm.runInContext(QUERY_SOURCE,s,{filename:'fleet-query-core.js'});
  const assets=Array.from({length:count},(_,index)=>({...structuredClone(template),id:`F705-${String(index).padStart(5,'0')}`,name:`F705 ${index}`,...make(index)}));
  state.fleet=s.GH_FLEET_STORE.fromAssets(assets,{at:state.simSeconds});delete state.assets;s.GH_FINANCE_CORE.book(state,'air').accounts[0].balance=1e13;
  const day=Math.floor((Number(state.simSeconds)||0)/DAY)+1;state.simSeconds=day*DAY;return {...sc,day,F:s.GH_FLEET_DATA};
}
function snapshot(s,state){const root={...state};delete root.fleet;const store=state.fleet,bytes=Buffer.from(new Uint8Array(store.rows,0,store.length*s.GH_FLEET_STORE.STRIDE));return {root:JSON.stringify(root),rows:bytes.toString('base64'),values:JSON.stringify(store.values),extras:JSON.stringify(store.extras),length:store.length,live:store.live};}
const read=(F,state,fields=['id','condition','flightHours','nextCheckHours','phase','simulationFault','baseFacility'])=>{const out=new Map();F.scan(state,fields,row=>out.set(row.id,{...row}));return out;};
const cash=(s,state,company='air')=>s.GH_FINANCE_CORE.operating(state,company);
const N=3000,ABOVE=300,make=index=>index<N?{condition:60,flightHours:650,phase:index%3?'turnaround':'moving'}:{condition:95};
const TRUCKS=70000,makeTruck=index=>({type:'road',assetMode:'road',assetClass:'truck',purchasePrice:185000,specs:{capacity:24},flightHours:undefined,flightCycles:undefined,nextCheckHours:undefined,condition:index<TRUCKS-500?62:96,staffing:undefined,lastTrip:undefined});

(async()=>{
  // 1. Main-thread reference close.
  const plainOf=(count,maker)=>{const {s,state,day}=setup(count,maker);s.GH_FLEET_QUERY_PROVIDER=null;s.GH_REALISM.onDay(state,day);return {snap:snapshot(s,state),row:state.realism.maintenance.companies.air};};
  const plain=plainOf(N+ABOVE,make);
  async function staged(abort,count=N+ABOVE,maker=make){
    const env=setup(count,maker),{s,state,day,F}=env,TX=s.GH_TRANSACTION_CORE;let pending=[],conditionAskAt=-1;const stages=[];
    s.GH_FLEET_QUERY_PROVIDER=(target,name,params)=>{if(name==='conditionSum'&&conditionAskAt<0)conditionAskAt=stages.length;const revision=target.fleet.revision,result=s.GH_FLEET_QUERY.run(name,target,F,params);return new Promise(resolve=>pending.push(()=>resolve({result,current:()=>target.fleet.revision===revision})));};
    const before=snapshot(s,state),handle=TX.beginStaged(state,{label:'qa-705',apply:function*(){const out=yield* s.GH_REALISM.onDayStages(state,day);if(abort)throw new Error('qa-705-abort');return out;}});
    for(let calls=0;calls<20000&&!handle.done;calls++){handle.step(-Infinity);stages.push(handle.stage);if(pending.length){for(const resolve of pending.splice(0))resolve();}await new Promise(resolve=>setImmediate(resolve));}
    assert.equal(handle.done,true);return {...env,handle,stages,before,conditionAskAt};
  }
  {const run=await staged(false),{s,state,F,handle,stages,conditionAskAt}=run;assert.equal(handle.error,null,String(handle.error?.stack||handle.error));assert.equal(handle.result.committed,true);
    assert.equal(stages.includes('realism.fleet-day'),false,'1: the worker pass, not the main-thread scan');
    // (Batch H: the condition total is asked right after the checks, in one more frame under the maintenance name; that frame
    //  is not a check step.)
    assert.equal(stages[conditionAskAt],'realism.maintenance','1: the early condition-total ask takes the frame after the checks');
    assert.equal(stages.filter((stage,index)=>stage==='realism.maintenance'&&index!==conditionAskAt).length,Math.ceil(N/128),'1: the checks are written by id, 128 rows a step');
    const rows=read(F,state),checked=[...rows.values()].filter(row=>row.id<`F705-${String(N).padStart(5,'0')}`);
    assert.ok(checked.every(row=>row.condition===100&&row.flightHours===0&&row.nextCheckHours===600),'1: every aircraft under the line restored, hours reset');
    assert.ok([...rows.values()].slice(N).every(row=>row.condition===95),'1: above the line untouched');
    const row=state.realism.maintenance.companies.air;assert.equal(row.checks,N,'1: no daily cap');assert.equal(row.cost,Math.round(N*PRICE*.004*40/20),'1: each check priced at 40 points of wear (2x the line\'s)');
    assert.deepEqual(snapshot(s,state),plain.snap,'1: the staged worker close equals the main-thread close byte for byte');}
  // 1b. The column plan above 16,384 checks.
  {const big=plainOf(TRUCKS,makeTruck),run=await staged(false,TRUCKS,makeTruck),{s,state,F,handle,stages}=run;assert.equal(handle.error,null,String(handle.error?.stack||handle.error));assert.equal(handle.result.committed,true);
    const steps=stages.filter(stage=>stage==='realism.maintenance').length;assert.ok(steps>=Math.ceil((TRUCKS-500)/1024)&&steps<Math.ceil((TRUCKS-500)/256),`1b: the column plan (${steps} steps)`);
    let restored=0,untouched=0;F.scan(state,['condition'],row=>{if(row.condition===100)restored++;else if(row.condition===96)untouched++;});assert.equal(restored,TRUCKS-500,'1b: every truck under the line');assert.equal(untouched,500);
    assert.equal(state.realism.maintenance.companies.air.checks,TRUCKS-500);assert.deepEqual(snapshot(s,state),big.snap,'1b: byte-identical to the main-thread close');}
  // 1c. The plan's boundary (MAINTENANCE_COLUMN_ROWS): 16,384 checks by id, 128 a step; one more, the column plan.
  for(const [count,byId] of [[16384,true],[16385,false]]){const run=await staged(false,count,()=>makeTruck(0)),{F,state,handle,stages,conditionAskAt}=run;assert.equal(handle.error,null,String(handle.error?.stack||handle.error));
    assert.equal(stages[conditionAskAt],'realism.maintenance',`1c: ${count}: the early condition-total ask takes the frame after the checks`);
    const steps=stages.filter((stage,index)=>stage==='realism.maintenance'&&index!==conditionAskAt).length;console.log(JSON.stringify({section:'1c',count,steps}));
    if(byId)assert.equal(steps,count/128,`1c: ${count} checks by id, 128 a step (${steps} steps)`);else assert.ok(steps<Math.ceil(count/128),`1c: ${count} checks by the column plan (${steps} steps)`);
    let restored=0;F.scan(state,['condition'],row=>{if(row.condition===100)restored++;});assert.equal(restored,count,`1c: all ${count} restored`);}
  // 2. Rollback (both paths).
  for(const [count,maker,label] of [[N+ABOVE,make,'by id'],[TRUCKS,makeTruck,'column plan']]){const run=await staged(true,count,maker),{s,state,handle,before}=run;assert.ok(handle.error&&/qa-705-abort/.test(String(handle.error.message||handle.error)),`2 (${label}): the staged close aborted`);assert.deepEqual(snapshot(s,state),before,`2 (${label}): the fleet and the books are back byte for byte`);}
  // 3. B3: a parked fleet.
  {const {s,state,day,F}=setup(400,index=>index%2?{routeId:null,phase:'idle',condition:90}:{routeId:'R-QA',phase:'idle',condition:90});
    const result=s.GH_FLEET_DAY_CORE.compute(state,F,{storeApi:s.GH_FLEET_STORE}),acc=result.maintenance.find(([owner])=>owner==='air')[1];assert.equal(acc.risk,0,'3: no risk on parked assets');assert.equal(acc.sample.length,0,'3: never sampled');
    for(let d=day;d<day+120;d++){state.simSeconds=d*DAY;s.GH_REALISM.onDay(state,d);}
    assert.equal((state.realism.incidents||[]).filter(row=>row.company==='air').length,0,'3: no accident in 120 days');
    const routed=setup(400,()=>({phase:'turnaround',routeId:'R-QA',condition:90}));const r2=routed.s.GH_FLEET_DAY_CORE.compute(routed.state,routed.F,{storeApi:routed.s.GH_FLEET_STORE}).maintenance.find(([owner])=>owner==='air')[1];assert.ok(Math.abs(r2.risk-400*.000044)<1e-12,'3: a routed fleet keeps its risk');}
  // 4. B4: a truck's deductible.
  {const {s,state}=setup(1,()=>({}));const truck=185000,count=2;let found=null;
    for(let d=3000;d<3600&&!found;d++){state.simSeconds=d*DAY;const before=(state.realism.incidents||[]).length;const gen=s.GH_REALISM.runIncidents(state,{companies:new Map([['air',{count:500,conditionSum:500*100,value:500*truck,risk:count,premium:0,sample:Array.from({length:64},(_,i)=>({id:`T${i}`,price:truck})),checks:0,cost:0,restored:0,threshold:80,licence:0,unsafe:0,fine:0}]])},d);while(!gen.next().done){}if((state.realism.incidents||[]).length>before&&state.realism.incidents[0].day===d)found=state.realism.incidents[0];}
    assert.ok(found,'4: an incident day');const loss=Math.round(found.count*truck*.15),deductible=Math.max(found.count*Math.min(250000,truck*.01),loss*.10);
    assert.equal(found.loss,loss);assert.equal(found.deductible,Math.min(loss,deductible),'4: the deductible');assert.ok(found.deductible<found.count*250000,'4: not the 250,000 minimum');assert.ok(found.covered>0&&found.claimId,'4: the insurer pays the rest (a claim)');}
  // 5. and 6. The manual service and the isolated moving asset.
  {const {s,state,ctx,F}=setup(4,index=>[{condition:70},{condition:100},{condition:70,phase:'moving',routeId:'R-QA',simulationFault:{code:'QA'}},{condition:70,phase:'moving',routeId:'R-QA'}][index]);
    const D=(name,payload,key)=>s.GH_DOMAIN_COMMANDS.dispatch(ctx,'fleet',name,payload,key?{idempotencyKey:key}:{}),id=index=>`F705-${String(index).padStart(5,'0')}`,quote=Math.round(PRICE*.004*30/20);
    assert.equal(s.GH_REALISM.maintenanceQuote(F.get(state,id(0))),quote);
    F.update(state,id(0),{flightHours:300,nextCheckHours:600});let before=cash(s,state);assert.throws(()=>D('service',{id:id(0),cost:1,expectedCost:quote+1}),/fleet-service-quote-changed/,'5: a stale quote is refused');assert.equal(cash(s,state),before);assert.equal(F.get(state,id(0)).condition,70,'5: nothing changed');
    const done=D('service',{id:id(0),cost:1,expectedCost:quote},'SVC-705');assert.ok(done.ok);assert.equal(before-cash(s,state),quote,'5: the close\'s quote is charged, not the payload\'s cost');assert.equal(F.get(state,id(0)).condition,100);assert.equal(F.get(state,id(0)).flightHours,0,'5: the service resets an aircraft\'s hours');assert.equal(F.get(state,id(0)).nextCheckHours,600);
    D('service',{id:id(0),cost:1,expectedCost:quote},'SVC-705');assert.equal(before-cash(s,state),quote,'5: the same request key charges once');
    before=cash(s,state);assert.ok(D('service',{id:id(1)}).ok);assert.equal(cash(s,state),before,'5: free at 100%');
    // (id 0 is now at 100%: worn again for the no-cash case)
    // (and a second service at the same second, once worn again, is charged: a new cheque, not the first one replayed)
    F.update(state,id(0),{condition:70});{const book=s.GH_FINANCE_CORE.book(state,'air').accounts[0],saved=book.balance;book.balance=10;assert.throws(()=>D('service',{id:id(0)}),'5: no cash: refused');assert.equal(F.get(state,id(0)).condition,70,'5: nothing changed');book.balance=saved;}
    // 6.
    const healthy=s.GH_FLEET_CORE.validate({state},'service',{id:id(3)});assert.equal(healthy?.reason,'asset-moving','6: a healthy moving asset is refused');
    assert.equal(s.GH_FLEET_CORE.validate({state},'return-to-base',{id:id(3)})?.reason,'return-to-base-not-isolated');
    before=cash(s,state);const back=D('return-to-base',{id:id(2)});assert.ok(back.ok);let row=F.get(state,id(2));assert.equal(row.phase,'turnaround','6: parked at its base');assert.equal(row.baseFacility,'B1');assert.ok(row.simulationFault,'6: the fault stays');assert.equal(cash(s,state),before,'6: free');
    assert.equal(s.GH_FLEET_CORE.validate({state},'return-to-base',{id:id(2)})?.reason,'return-to-base-not-isolated','6: a second return is refused');
    F.update(state,id(2),{phase:'moving'});const revenue=Number(F.get(state,id(2)).lastTrip?.revenue)||0;before=cash(s,state);assert.ok(D('service',{id:id(2),expectedCost:quote}).ok,'6: an isolated moving asset is serviced');
    row=F.get(state,id(2));assert.equal(row.phase,'turnaround','6: back at its base');assert.equal(row.simulationFault,undefined,'6: fault cleared');assert.equal(row.condition,100);assert.equal(before-cash(s,state),quote,'6: charged once');assert.equal(Number(row.lastTrip?.revenue)||0,revenue,'6: no trip income');}
  // 6b. An isolated asset bound to release a retired shared route on arrival is released as that arrival would.
  {const {s,state,ctx,F}=setup(2,()=>({condition:90,phase:'moving',routeId:'R-OLD',releaseExclusiveRouteOnArrival:true,simulationFault:{code:'QA'}}));const D=(name,payload)=>s.GH_DOMAIN_COMMANDS.dispatch(ctx,'fleet',name,payload);
    assert.ok(D('return-to-base',{id:'F705-00000'}).ok);let row=F.get(state,'F705-00000');assert.equal(row.phase,'idle','6b: idle');assert.equal(row.routeId??null,null,'6b: off the retired route');assert.ok(!row.releaseExclusiveRouteOnArrival,'6b: flag cleared');assert.ok(row.simulationFault,'6b: fault kept');
    assert.ok(D('service',{id:'F705-00001'}).ok);row=F.get(state,'F705-00001');assert.equal(row.phase,'idle');assert.equal(row.routeId??null,null,'6b: service releases it too');assert.equal(row.simulationFault,undefined);}
  // 6c. Batch H (owner, 18 Nov 2026: «يُحذف كما عند الوصول»; dispatch marked after a service only): the retired route an
  //     isolated asset frees is deleted when no other asset uses it, kept when one does; the owner is marked for the
  //     automatic dispatch after a service, not after a return to base (the fault stays), and never while the autopilot is
  //     locked. A fleet above 2,048 rows decides from the worker's reference proof bound to the command (no store scan),
  //     keeps the route without one, and treats a stale proof as none (the service still runs).
  {const retired=(n,make)=>{const env=setup(n,make);const {s,state}=env;if(!s.GH_FLEET_REFERENCE_QUERY)vm.runInContext(fs.readFileSync(path.join(ROOT,'WebApp','fleet-reference-query-core.js'),'utf8'),s,{filename:'fleet-reference-query-core.js'});
      state.customRoutes=[{id:'R-OLD',ownerCompanyId:'air',routeMode:'air',type:'air',fromFacility:'B1',toFacility:'B9',from:'B1',to:'B9',route:[[24,46],[25,47]]},{id:'R-KEEP',ownerCompanyId:'air',routeMode:'air',type:'air',fromFacility:'B1',toFacility:'B8',from:'B1',to:'B8',route:[[24,46],[26,47]]}];state.routeCache=state.routeCache||{};state.routeEndpoints=state.routeEndpoints||{};
      delete state.advanced?.companies?.air?.autoDispatchPending;return env;};
    const isolated={phase:'moving',routeId:'R-OLD',releaseExclusiveRouteOnArrival:true,simulationFault:{code:'QA'},condition:100};
    const routes=state=>(state.customRoutes||[]).map(row=>row.id).sort().join(','),marked=state=>state.advanced?.companies?.air?.autoDispatchPending===true;
    // Small fleet: two on the route. Service of one keeps it (the other uses it) and marks; return of the other deletes it, no mark.
    {const {s,state,ctx,F}=retired(2,()=>isolated),D=(name,payload)=>s.GH_DOMAIN_COMMANDS.dispatch(ctx,'fleet',name,payload);
      assert.ok(D('service',{id:'F705-00000',expectedCost:0}).ok);assert.equal(routes(state),'R-KEEP,R-OLD','6c: kept while another asset uses it');assert.equal(marked(state),true,'6c: the owner marked after a service');
      delete state.advanced.companies.air.autoDispatchPending;assert.ok(D('return-to-base',{id:'F705-00001'}).ok);assert.equal(routes(state),'R-KEEP','6c: deleted once no asset uses it');assert.equal(marked(state),false,'6c: a return to base marks nothing');
      assert.equal(F.get(state,'F705-00001').routeId??null,null);}
    // Locked autopilot: deleted, not marked.
    {const {s,state,ctx}=retired(1,()=>isolated),prior=s.GH_PROGRESSION_CORE;s.GH_PROGRESSION_CORE={...(prior||{}),unlocked:(_s,key)=>key==='tool:autopilot'?false:(prior?.unlocked?.(_s,key)??true)};
      try{assert.ok(s.GH_DOMAIN_COMMANDS.dispatch(ctx,'fleet','service',{id:'F705-00000',expectedCost:0}).ok);}finally{s.GH_PROGRESSION_CORE=prior;}
      assert.equal(routes(state),'R-KEEP','6c: deleted');assert.equal(marked(state),false,'6c: no mark while the autopilot is locked');}
    // Large fleet (2,100 rows): the proof decides; no proof or a stale one keeps the route; the service runs in every case.
    {const big=index=>index===0?isolated:index===1?{...isolated,simulationFault:undefined,phase:'turnaround'}:{routeId:'R-KEEP',phase:'turnaround'};
      const proofFor=(s,state,assetId,mutate)=>{const Q=s.GH_FLEET_REFERENCE_QUERY,F=s.GH_FLEET_DATA,params=s.GH_ROUTE_CORE.referenceRequest(state,'delete',{id:'R-OLD',assetId}),stamp=Q.capture(state,F,params),result=Q.plan(state,F,params);if(mutate)mutate();return {params,result,current:target=>Q.current(stamp,target,F,params)};};
      const scans=(s,run)=>{const F=s.GH_FLEET_DATA;let n=0;s.GH_FLEET_DATA=Object.freeze({...F,distinctRefs:(...args)=>{if(args[1]==='routeId')n++;return F.distinctRefs(...args);}});try{run();}finally{s.GH_FLEET_DATA=F;}return n;};
      {const {s,state,ctx}=retired(2100,big);const proof=proofFor(s,state,'F705-00000');assert.equal(s.GH_FLEET_REFERENCE_QUERY.lookup(proof.result).route('R-OLD'),1,'fixture: one other asset on the route');
        const n=scans(s,()=>assert.ok(s.GH_DOMAIN_COMMANDS.dispatch({...ctx,fleetReferenceUsage:proof},'fleet','service',{id:'F705-00000',expectedCost:0}).ok));assert.equal(routes(state),'R-KEEP,R-OLD','6c: the proof shows another user: kept');assert.equal(n,0,'6c: no store scan');}
      {const {s,state,ctx,F}=retired(2100,big);F.update(state,'F705-00001',{routeId:'R-KEEP'});const proof=proofFor(s,state,'F705-00000');
        const n=scans(s,()=>assert.ok(s.GH_DOMAIN_COMMANDS.dispatch({...ctx,fleetReferenceUsage:proof},'fleet','service',{id:'F705-00000',expectedCost:0}).ok));assert.equal(routes(state),'R-KEEP','6c: the proof shows no other user: deleted');assert.equal(marked(state),true);assert.equal(n,0,'6c: no store scan with a proof');}
      {const {s,state,ctx,F}=retired(2100,big);F.update(state,'F705-00001',{routeId:'R-KEEP'});
        const n=scans(s,()=>assert.ok(s.GH_DOMAIN_COMMANDS.dispatch(ctx,'fleet','service',{id:'F705-00000',expectedCost:0}).ok));assert.equal(routes(state),'R-KEEP,R-OLD','6c: a large fleet without a proof keeps the route');assert.equal(n,0,'6c: and scans nothing');assert.equal(marked(state),true,'6c: still marked after the service');}
      {const {s,state,ctx,F}=retired(2100,big);F.update(state,'F705-00001',{routeId:'R-KEEP'});const proof=proofFor(s,state,'F705-00000',()=>F.update(state,'F705-00002',{condition:99}));
        assert.ok(s.GH_DOMAIN_COMMANDS.dispatch({...ctx,fleetReferenceUsage:proof},'fleet','service',{id:'F705-00000',expectedCost:0}).ok,'6c: a stale proof does not refuse the service');assert.equal(routes(state),'R-KEEP,R-OLD','6c: and keeps the route');}
      // (Endpoints changed while the worker counted (a route created elsewhere): the delete would check other bases than the
      //  proof's; the service runs and the route stays, rather than the delete refusing the paid service.)
      {const {s,state,ctx,F}=retired(2100,big);F.update(state,'F705-00001',{routeId:'R-KEEP'});const proof=proofFor(s,state,'F705-00000',()=>{state.routeEndpoints={...state.routeEndpoints,'EP-QA-NEW':{id:'EP-QA-NEW',routeEndpoint:true,coords:[21,39]}};});
        assert.ok(s.GH_DOMAIN_COMMANDS.dispatch({...ctx,fleetReferenceUsage:proof},'fleet','service',{id:'F705-00000',expectedCost:0}).ok,'6c: endpoints changed after the proof: the service still runs');assert.equal(routes(state),'R-KEEP,R-OLD','6c: and the route stays');}}}
  // 7. «إصلاح الكل الآن».
  {const {s,state,ctx,F}=setup(2600,index=>index<2500?{condition:index%2?70:75,purchasePrice:PRICE+index*7.37,flightHours:650,nextCheckHours:1250}:{condition:90});const R=s.GH_REALISM,D=(payload,key)=>s.GH_DOMAIN_COMMANDS.dispatch(ctx,'fleet','repair-batch',payload,key?{idempotencyKey:key}:{});
    const quote=s.GH_FLEET_DAY_CORE.maintenanceBacklog(state,F,{...R.fleetDayParams(state),companyId:'air',slice:2000});
    assert.equal(quote.count,2500);assert.equal(quote.line,80);assert.equal(JSON.stringify(quote.slices.map(slice=>slice.ids.length)),'[2000,500]','7: slices of 2,000');
    const each=(price,condition)=>Math.round(price*.004*(100-condition)/20);let expected=0;for(let i=0;i<2500;i++)expected+=each(PRICE+i*7.37,i%2?70:75);assert.equal(quote.cost,expected,'7: the sum of each asset\'s rounded quote (fractional prices)');
    s.GH_DOMAIN_COMMANDS.dispatch(ctx,'corporate','open-company',{type:'sea',capital:100000000,legalName:'Test Sea 705'});
    const snap=snapshot(s,state);
    assert.throws(()=>D({companyId:'air',ids:quote.slices[0].ids,expectedCost:quote.slices[0].cost+1}),/repair-quote-stale/,'7: a stale quote');assert.deepEqual(snapshot(s,state),snap,'7: nothing changed');
    assert.throws(()=>D({companyId:'air',ids:['F705-02550'],expectedCost:0}),/repair-asset-above-line/,'7: an asset above the line');assert.deepEqual(snapshot(s,state),snap);
    assert.equal(s.GH_FLEET_CORE.validate({state},'repair-batch',{companyId:'air',ids:Array.from({length:2001},(_,i)=>`X${i}`),expectedCost:0})?.reason,'repair-batch-invalid','7: more than 2,000 ids');
    assert.throws(()=>D({companyId:'sea',ids:quote.slices[1].ids,expectedCost:quote.slices[1].cost}),/repair-batch-company/,'7: another company\'s assets');assert.deepEqual(snapshot(s,state),snap);
    // (The owner check is memoised per owner key: a batch mixing the company's asset with another company's is refused too.)
    {F.update(state,'F705-02599',{ownerCompanyId:'sea',companyId:'sea',company:'sea',type:'sea',assetMode:'sea',assetClass:'vessel',condition:70});const mixed=[quote.slices[1].ids[0],'F705-02599'],snap2=snapshot(s,state);
      assert.throws(()=>D({companyId:'air',ids:mixed,expectedCost:mixed.reduce((sum,id)=>sum+R.maintenanceQuote(F.get(state,id)),0)}),/repair-batch-company/,'7: a batch mixing another company\'s asset');assert.deepEqual(snapshot(s,state),snap2);
      // (The memo key holds the owner: an aircraft like the batch's own but owned by another company is checked again.)
      F.update(state,'F705-02599',{type:'air',assetMode:'air',assetClass:'aircraft',company:F.get(state,mixed[0]).company,companyId:F.get(state,mixed[0]).companyId});const own=F.get(state,mixed[0]),other=F.get(state,'F705-02599');
      assert.deepEqual(['companyId','company','assetMode','type','assetClass'].map(k=>other[k]),['companyId','company','assetMode','type','assetClass'].map(k=>own[k]),'7 fixture: only ownerCompanyId differs');assert.notEqual(other.ownerCompanyId,own.ownerCompanyId);const snap3=snapshot(s,state);
      assert.throws(()=>D({companyId:'air',ids:mixed,expectedCost:mixed.reduce((sum,id)=>sum+R.maintenanceQuote(F.get(state,id)),0)}),/asset-class-owner-mismatch/,'7: another owner\'s aircraft in the batch (checked again, not memoised)');assert.deepEqual(snapshot(s,state),snap3);}
    const before=cash(s,state);for(const [k,slice] of quote.slices.entries())assert.ok(D({companyId:'air',ids:slice.ids,expectedCost:slice.cost,},`MNT-NOW-QA-${k}`).ok);
    assert.equal(before-cash(s,state),quote.cost,'7: the charge is the quote');const rows=read(F,state);for(const id of quote.slices.flatMap(slice=>slice.ids)){const row=rows.get(id);assert.ok(row.condition===100&&row.flightHours===0&&row.nextCheckHours===600,`7: ${id} restored, hours reset`);}
    assert.equal(s.GH_FLEET_DAY_CORE.maintenanceBacklog(state,F,{...R.fleetDayParams(state),companyId:'air'}).count,0,'7: nothing left under the line');}
  // 8. Fault 4: the daily notices.
  {const {s,state,day}=setup(5000,()=>({type:'road',assetMode:'road',assetClass:'truck',purchasePrice:185000,specs:{capacity:24},condition:100,routeId:'R-QA',flightHours:undefined,nextCheckHours:undefined,flightCycles:undefined}));
    const notices=d=>(state.alerts||[]).filter(row=>String(row.text||row).startsWith(`صيانة `)&&String(row.text||row).includes(`اليوم ${d}:`));let incidentDay=null;
    for(let d=day;d<day+60&&!incidentDay;d++){state.simSeconds=d*DAY;s.GH_REALISM.onDay(state,d);const today=(state.realism.incidents||[]).find(row=>row.company==='air'&&row.day===d);
      if(today){incidentDay=d;assert.equal(notices(d).length,1,'8: one notice on an accident day');assert.match(String(notices(d)[0].text||notices(d)[0]),/حادث|حوادث/);}else assert.equal(notices(d).length,0,'8: none on a quiet day');}
    assert.ok(incidentDay,'8: an accident within 60 days (5,000 routed trucks)');
    const bill=setup(3000,()=>({condition:60}));bill.s.GH_FINANCE_CORE.book(bill.state,'air').accounts[0].balance=1e9;bill.s.GH_REALISM.onDay(bill.state,bill.day);
    const lines=(bill.state.alerts||[]).map(row=>String(row.text||row)).filter(text=>text.startsWith('صيانة ')&&text.includes(`اليوم ${bill.day}:`));assert.equal(lines.length,1,'8: one notice on a large check bill');assert.match(lines[0],/فحص 3000 أصول بفاتورة/);}
  // 9. The aircraft due count reads min(72%, line): under the deferred line (65) an aircraft at 68% is not due (the former
  //    fixed 72 kept it due for good); under preventive (90) one at 71% is (both passes).
  for(const [policy,condition,due] of [['deferred',68,0],['preventive',71,1]]){const {s,state,day,F,command}=setup(1,()=>({condition,flightHours:10}));command('corporate','set-maintenance-policy',{companyId:'air',policy});
    const worker=s.GH_FLEET_DAY_CORE.compute(state,F,{storeApi:s.GH_FLEET_STORE,maintenancePolicies:[['air',policy]]});assert.equal(worker.ops.maintenanceDue,due,`9: worker, ${policy} at ${condition}%`);
    s.GH_REALISM.onDay(state,day);assert.equal(state.realism.aviation.maintenanceDue,due,`9: main thread, ${policy} at ${condition}%`);}
  // 10. B3 on the main-thread pass: an accident only ever hits routed assets (parked ones are never sampled).
  {const {s,state,day}=setup(6000,index=>({type:'road',assetMode:'road',assetClass:'truck',purchasePrice:185000,specs:{capacity:24},condition:100,flightHours:undefined,nextCheckHours:undefined,flightCycles:undefined,...(index%2?{routeId:'R-QA',phase:'turnaround'}:{routeId:null,phase:'idle'})}));
    let hits=[];for(let d=day;d<day+40&&hits.length<20;d++){state.simSeconds=d*DAY;s.GH_REALISM.onDay(state,d);for(const row of (state.realism.incidents||[]).filter(row=>row.day===d))hits.push(...row.assets);}
    assert.ok(hits.length>0,'10: accidents happened');assert.ok(hits.every(id=>Number(id.slice(5))%2===1),'10: only routed trucks are hit');}
  // 11. A malformed worker answer (rows out of order, or fewer than the checks) is refused: a large fleet's staged close
  //     then fails whole (no main-thread pass above 2,048 rows) and nothing is written.
  for(const tamper of ['swap','short']){const {s,state,day,F}=setup(2500,index=>({condition:index<600?60:95})),TX=s.GH_TRANSACTION_CORE;let pending=[];const before=snapshot(s,state);
    s.GH_FLEET_QUERY_PROVIDER=(target,name,params)=>{const result=s.GH_FLEET_QUERY.run(name,target,F,params);if(name==='fleetDay'){const rows=result.maintenanceRows;if(tamper==='swap'){const t=rows[0];rows[0]=rows[1];rows[1]=t;}else result.maintenanceRows=rows.slice(1);}const revision=target.fleet.revision;return new Promise(resolve=>pending.push(()=>resolve({result,current:()=>target.fleet.revision===revision})));};
    const handle=TX.beginStaged(state,{label:'qa-705-tamper',apply:function*(){return yield* s.GH_REALISM.onDayStages(state,day);}}),stages=[];
    for(let calls=0;calls<20000&&!handle.done;calls++){handle.step(-Infinity);stages.push(handle.stage);if(pending.length){for(const resolve of pending.splice(0))resolve();}await new Promise(resolve=>setImmediate(resolve));}
    assert.ok(handle.done&&/fleet-day-worker-unavailable/.test(String(handle.error?.message||handle.error)),`11 (${tamper}): the answer is refused (${handle.error})`);assert.deepEqual(snapshot(s,state),before,`11 (${tamper}): nothing written`);}
  // 12. B4 where the minimum binds (a repair programme lowering the loss): the minimum is capped per incident at 1% of
  //     the average truck, not the aircraft-sized 250,000.
  {const {s,state}=setup(1,()=>({}));s.GH_GOVERNANCE_CORE={...(s.GH_GOVERNANCE_CORE||{}),programEffects:()=>({incidentRepair:.5})};const truck=185000;let found=null;
    for(let d=4000;d<4600&&!found;d++){state.simSeconds=d*DAY;const before=(state.realism.incidents||[]).length;const gen=s.GH_REALISM.runIncidents(state,{companies:new Map([['air',{count:500,conditionSum:500*100,value:500*truck,risk:2,premium:0,sample:Array.from({length:64},(_,i)=>({id:`T${i}`,price:truck})),checks:0,cost:0,restored:0,threshold:80,licence:0,unsafe:0,fine:0}]])},d);while(!gen.next().done){}if((state.realism.incidents||[]).length>before&&state.realism.incidents[0].day===d)found=state.realism.incidents[0];}
    assert.ok(found,'12: an incident day');assert.equal(found.deductible,Math.min(found.loss,found.count*truck*.01),'12: the per-incident minimum at 1% of the truck binds');}
  // 13. Fault 4's rules: a quiet company gets none; a bill of at least $50M, or of at least 10% of the cash, gets one.
  {const quiet=setup(200,()=>({condition:95}));for(let d=quiet.day;d<quiet.day+20;d++){quiet.state.simSeconds=d*DAY;quiet.s.GH_REALISM.onDay(quiet.state,d);}
    assert.equal((quiet.state.alerts||[]).filter(row=>String(row.text||row).startsWith('صيانة ')).length,0,'13: a quiet company gets no notice');
    const billCase=(count,balance)=>{const env=setup(count,()=>({condition:60}));env.s.GH_FINANCE_CORE.book(env.state,'air').accounts[0].balance=balance;env.s.GH_REALISM.onDay(env.state,env.day);return (env.state.alerts||[]).filter(row=>String(row.text||row).startsWith('صيانة ')).length;};
    assert.equal(billCase(150,1e13),1,'13: 150 checks x 360k = $54M: over the floor');assert.equal(billCase(50,1e13),0,'13: $18M with ample cash: none');assert.equal(billCase(50,1e8),1,'13: $18M against $100M of cash (18%): one');}
  // Source: the app sends the quote, confirms before charging, and the repair-all button runs signed steps.
  const app=fs.readFileSync(path.join(ROOT,'WebApp','app.js'),'utf8');
  assert.ok(app.includes("runAuthorizedDomainCommand('fleet','service',{id,expectedCost:cost,")&&!/cost=a\.type==='air'\?78000/.test(app),'B5: the app sends the quote, no fixed price');
  assert.ok(app.includes("heldFleetDispatchQuery(state,'maintenanceBacklog',")&&app.includes("runAuthorizedSteps(`repair-all:${companyId}`,steps,"),'repair-all: worker quote and signed steps');
  {const core=fs.readFileSync(path.join(ROOT,'WebApp','fleet-core.js'),'utf8');assert.ok(core.includes("routeOwner.companyId!==assetOwner.companyId||(asset.phase==='moving'&&!asset.simulationFault)||asset.salePending"),'fault 3: an isolated moving asset may take a route again (source)');}
  console.log(JSON.stringify({suite:'build705-fault-balance',ok:true,checked:N,rowsCost:plain.row.cost}));
})().catch(error=>{console.error(error);process.exitCode=1;});
