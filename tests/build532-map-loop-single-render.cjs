'use strict';
// The structural map loop drew the fleet summary it held and that render then wanted the store's revision, so the newer
// summary's arrival about 15 ms later rebuilt the map again: two full rebuilds (41-44 ms each on iPhone) for one loop
// render (build514 failed 2 of 8 runs on this). bda0a47 deferred a due loop render to the summary's arrival, but a
// request the worker refused, rejected, left unanswered or answered unavailable then waited a whole interval: the
// structure was redrawn every 16 s instead of every 8 s (an independent review's model). The loop now defers only with a
// request in flight and draws with the summary held after MAP_LOOP_RENDER_DEFER_MS, as a render that wants no follow-up
// (a second review found that a summary slower than the bound otherwise brought the double rebuild back). Proven
// deterministically on the real source text of scheduleViewportMapRender, the summary client, deferLoopRenderToSummary,
// the end of renderMap and the loop's structural line, with virtual time and a scripted worker (8 s interval, 64 s of
// play, fleet moving every 100 ms, the rest of the map's signature every 512 ms). In every case at most one loop render per interval, each measured once as a
// structural render, and:
//  1. a summary answered in 15 ms: no two structural renders within 100 ms, at most one interval between renders;
//  2. a request the worker refuses: at most one interval between renders, as before the deferral;
//  3. a request rejected, unanswered or answered unavailable: at most one interval and the bound between renders;
//  4. a summary answered in 1.2 s (slower than the bound): no second rebuild after the late draw;
//  5. a summary of another runtime (a store rebuild): no render waits;
//  6. a request refused at the loop's due time and answered later (the fleet worker busy with a day close, the status
//     line asking every 0.5 s): the loop draws once with the summary held, and the later answer is not a second rebuild;
//  7. each structural render names its reason while a diagnostic recording is active (loop-deferred, loop, loop-late);
//  9. the diagnostic recorder keeps the reason on the map.structure work row and on the frame drop it explains;
//  8. the previous sources fail: 4ed42a0 draws pairs in case 1, bda0a47 leaves 16 s gaps in case 2, 6f3ac50 draws a
//     second rebuild in case 4, ed364e2 draws a second rebuild in case 6, d09e11b fails cases 10 and 11;
// A third review found that the deferral cleared mapFleetSummary.followUp when the worker refused it (d09e11b) or the
// summary was late (since ed364e2), so an explicit render's revision (a purchase's afterCommit) stayed off the map until
// the next interval (8 to 30 s). The deferral now hands back the follow-up an earlier render wanted:
// 10. an explicit render inside a refusal that spans the loop's due time: its revision is drawn on the status line's
//     next answer (summary-due), within half an interval;
// 11. an explicit render whose request is still in flight when the loop's deferral is late: drawn on that answer; when
//     that answer comes while the deferral waits, it is drawn at once as the loop's render, and the deferral's own answer
//     is not a second rebuild;
// 12. without a recording no stack is read (explicit renders are named plainly), with one each explicit render names
//     its caller, and a render that serves a deferral keeps its own reason (+loop);
// 13. a reason does not outlive a render that returned early (no map);
// 14. the caller is the first app frame below renderMap in V8 and JavaScriptCore stacks: a name, or file:line for an
//     anonymous function, never an engine built-in; the recorder bounds a reason to 64 characters;
// 15. an answer whose 0 ms follow-up render is still queued when the frame arms a deferral (the frame runs before
//     timers queued in it): that render serves the deferral, and the deferral's own answer is not a second rebuild.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{execFileSync}=require('node:child_process');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..'),{harness:coreHarness,minimal}=require('./helpers/core-harness');
const INTERVAL=8000,DURATION=64000,PAIR_MS=100;

function harness(app){
  const cut=(from,to)=>{const a=app.indexOf(from),b=app.indexOf(to,a+from.length);if(a<0||b<0)throw new Error(`source anchor missing: ${from}`);return app.slice(a,b);};
  const flagsAndSchedule=cut('  let mapSummaryFollowUpRender=false;','  function selectCanvasVehicle(');
  const summary=cut('  const mapFleetSummary={','  // Every class of the store over MAP_CLASS_FIELDS');
  const tailStart=app.indexOf('    updateMapStatus();renderWorldInfrastructureMarkers();lastMapStructureSignature=mapStructureSignature();');
  if(tailStart<0)throw new Error('renderMap tail missing');
  const tail=app.slice(tailStart,app.indexOf('\n  }\n',tailStart)+4);
  const loopLine=app.split('\n').find(line=>line.includes('mapStructureInterval=fleetSizeForMap>3000'));
  if(!loopLine)throw new Error('loop structural line missing');
  const defer=app.includes('function deferLoopRenderToSummary')?'':'function deferLoopRenderToSummary(){return false;}';
  return `${flagsAndSchedule}\n${summary}\n${defer}
    let lastMapStructureSignature='',lastMapRenderAt=0;
    function mapStructureSignature(){return mapFleetSummary.received+':'+__world();}
    function updateMapStatus(){}function renderWorldInfrastructureMarkers(){}function updateMarkerPositions(){}
    function renderMap(){if(!map)return;const renderStarted=appMetricClock();mapFleetClassRows();
      __renders.push({at:appMetricClock(),drew:mapFleetSummary.revision,store:state.fleet.revision});
${tail}
    function loopStructural(now){let stageStarted=0,structuralRenderMs=0,structureRendered=false;
${loopLine}
    }
    ({loopStructural,mapFleetClassRows,renderMap,scheduleViewportMapRender,mapRenderCaller:typeof mapRenderCaller==='function'?mapRenderCaller:null});`;
}

async function play(source,{answer='summary',refuse=()=>false,runtime=()=>'rt',latency=15,statusEvery=0,script=null,recording=true,frameFirst=false}={}){
  let now=0,seq=0,errors=0;const timers=[],renders=[],metrics=[],reasons={};let world=0;
  const setTimeout_=(fn,ms)=>{const id=++seq;timers.push({id,at:now+Math.max(0,Number(ms)||0),fn});return id;};
  const clearTimeout_=id=>{const i=timers.findIndex(t=>t.id===id);if(i>=0)timers.splice(i,1);};
  const state={fleet:{revision:1}};
  const client={disabled:false,fieldClasses(store){
    // The first summary (asked at 0) is always answered; the scripted answer applies to the loop's requests.
    if(refuse(now))return null;const revision=store.revision,stamp=runtime(now),mode=now>50?answer:'summary';
    if(mode==='hang')return new Promise(()=>{});
    if(mode==='reject')return new Promise((_,reject)=>setTimeout_(()=>reject(new Error('qa-summary-rejected')),latency));
    if(mode==='unavailable')return new Promise(resolve=>setTimeout_(()=>resolve(null),latency));
    return new Promise(resolve=>setTimeout_(()=>resolve({store,runtime:stamp,revision,rows:[[{},1,0,1]]}),latency));}};
  const context={setTimeout:setTimeout_,clearTimeout:clearTimeout_,console,state,map:{},MAP_CLASS_FIELDS:[],mapStatusCache:{},mapRenderTimer:null,
    fleetEngineThreadClient:client,ownMarkers:new Map(),renderedMobilityIds:new Set(),mapVehicleCanvas:null,
    appMetricClock:()=>now,__renders:renders,__world:()=>world,Error:class extends Error{constructor(...args){super(...args);errors++;}},
    recordRenderMetric:(kind,ms,detail)=>{if(kind==='structural-render')metrics.push({at:now,detail});},
    window:{GH_FLEET_STORE:{isStore:()=>true,chunkStamp:()=>({runtime:runtime(now)}),epoch:()=>0},GH_FLEET_DATA:{size:()=>100},
      GH_DIAGNOSTICS:{recorderIsActive:()=>recording,recordMainThreadWork:(state,stage,start,end,detail)=>{if(stage!=='map.structure')return;const reason=String(detail?.reason||'none');if(renders.length)renders[renders.length-1].reason=reason;if(start>=INTERVAL&&start<=DURATION)reasons[reason]=(reasons[reason]||0)+1;}}}};
  const api=vm.runInNewContext(`let mapRenderTimer=null;\n${source}`,context);
  const settle=async()=>{for(let i=0;i<6;i++)await null;};
  // frameFirst: a timer queued for the frame's own time by a timer of that frame waits until after the frame.
  const runUntil=async until=>{const queued=seq;for(;;){timers.sort((a,b)=>a.at-b.at||a.id-b.id);const i=timers.findIndex(t=>t.at<=until&&!(frameFirst&&t.id>queued&&t.at>=until));if(i<0)break;const [t]=timers.splice(i,1);now=Math.max(now,t.at);t.fn();await settle();}now=until;await settle();};
  api.mapFleetClassRows();await runUntil(50);
  for(let t=64;t<=DURATION;t+=16){await runUntil(t);if(t%100===0)state.fleet.revision++;if(t%512===0)world++;if(script){script(t,api,context,state);await settle();}if(statusEvery&&t%statusEvery===0)api.mapFleetClassRows();api.loopStructural(t);await settle();}
  await runUntil(DURATION+2000);
  // Counted while the loop runs: the first summary's arrival draws before the first due render (the map held no rows) and
  // is not a loop render; a deferral armed at the last frame is answered after the loop stopped.
  const drawn=renders.filter(row=>row.at<=DURATION),measured=metrics.filter(row=>row.at<=DURATION);
  const gaps=drawn.slice(1).map((row,i)=>row.at-drawn[i].at);
  return Object.defineProperty({renders:drawn.length,loopRenders:drawn.filter(row=>row.at>=INTERVAL).length,pairs:gaps.filter(gap=>gap<PAIR_MS).length,within2s:gaps.filter(gap=>gap<2000).length,maxGap:Math.max(...gaps),metrics:measured.length,deferredMetrics:measured.filter(m=>m.detail?.deferred).length,reasons,errors},'log',{value:renders});
}
// One explicit render at `at`: how long until a render draws the store revision it saw, and the reasons involved.
async function explicitRender(source,options,at){
  const mark={};const row=await play(source,{...options,script:(t,api,context,state)=>{options.script?.(t,api,context,state);if(t===at){mark.revision=state.fleet.revision;api.renderMap();}}});
  const shown=row.log.find(r=>r.at>at&&r.drew>=mark.revision),{log,...rest}=row;
  return {...rest,delay:shown?shown.at-at:Infinity,shownReason:shown?.reason||null,explicitReason:log.find(r=>r.at===at)?.reason||null,after:log.filter(r=>r.at>at).slice(0,3).map(r=>[r.at-at,r.reason])};
}

const LOOP_RENDERS=DURATION/INTERVAL+1;
function common(label,row){
  assert.ok(row.loopRenders<=LOOP_RENDERS,`${label}: at most one loop render per interval (${JSON.stringify(row)})`);
  assert.equal(row.metrics,row.loopRenders,`${label}: each loop render is measured once as a structural render (${JSON.stringify(row)})`);
}
(async()=>{
  const app=fs.readFileSync(path.join(ROOT,'WebApp/app.js'),'utf8'),current=harness(app);
  const out={};
  // 1. Answered in 15 ms.
  out.answered=await play(current);
  assert.equal(out.answered.pairs,0,`1: no back-to-back structural renders (${JSON.stringify(out.answered)})`);
  assert.ok(out.answered.maxGap<=INTERVAL+50,`1: at most one interval between renders (${JSON.stringify(out.answered)})`);
  assert.ok(out.answered.renders>=DURATION/INTERVAL-1,`1: the structure is redrawn every interval (${JSON.stringify(out.answered)})`);
  common('1',out.answered);assert.ok(out.answered.deferredMetrics>0,'1: the deferred renders are measured');
  assert.deepEqual(out.answered.reasons,{'loop-deferred':out.answered.loopRenders},'7: answered loop renders are named loop-deferred');
  // 2. Refused by the worker (a step or a plan pending).
  out.refused=await play(current,{refuse:t=>t>50});
  assert.ok(out.refused.maxGap<=INTERVAL+50,`2: a refused request draws at once (${JSON.stringify(out.refused)})`);
  common('2',out.refused);assert.deepEqual(out.refused.reasons,{loop:out.refused.loopRenders},'7: refused loop renders are named loop');
  // 3. Rejected, never answered, answered unavailable.
  for(const answer of ['reject','hang','unavailable']){
    const row=out[answer]=await play(current,{answer});
    assert.ok(row.maxGap<=INTERVAL+1000+50,`3: ${answer}: at most one interval and the bound between renders (${JSON.stringify(row)})`);
    assert.ok(row.renders>=DURATION/(INTERVAL+1000)-1,`3: ${answer}: the structure keeps being redrawn (${JSON.stringify(row)})`);
    common(`3: ${answer}`,row);
  }
  // 4. Slower than the bound: the late draw is the loop's one render; the summary arriving after it waits for the next.
  out.slow=await play(current,{latency:1200});
  assert.equal(out.slow.within2s,0,`4: no second rebuild after the late draw (${JSON.stringify(out.slow)})`);
  assert.ok(out.slow.maxGap<=INTERVAL+50,`4: the loop keeps its interval (${JSON.stringify(out.slow)})`);common('4',out.slow);
  assert.deepEqual(out.slow.reasons,{'loop-late':out.slow.loopRenders},'7: late loop renders are named loop-late');
  // 6. Refused at the due time, answered later to the status line's asks.
  const dueRefused={refuse:t=>t>50&&t%INTERVAL<20,statusEvery:496};
  out.dueRefused=await play(current,dueRefused);
  assert.equal(out.dueRefused.within2s,0,`6: the later answer is not a second rebuild (${JSON.stringify(out.dueRefused)})`);
  assert.ok(out.dueRefused.maxGap<=INTERVAL+50,`6: the loop keeps its interval (${JSON.stringify(out.dueRefused)})`);common('6',out.dueRefused);
  // 10. An explicit render inside a refusal (the worker busy with a day close) that spans the loop's due time.
  const DUE=3*INTERVAL,refusalSpansDue={refuse:t=>t>=DUE-700&&t<DUE+2000,statusEvery:496},explicitInRefusal=DUE-592;
  out.explicitRefused=await explicitRender(current,refusalSpansDue,explicitInRefusal);
  assert.ok(out.explicitRefused.delay<=INTERVAL/2,`10: the explicit render's revision is drawn on the next answer, not an interval later (${JSON.stringify(out.explicitRefused)})`);
  assert.equal(out.explicitRefused.shownReason,'summary-due','10: drawn as the explicit render\'s follow-up');
  // 11. An explicit render's request still in flight when the loop's deferral is late (a summary slower than the bound).
  const explicitInFlight=DUE-480,slowSummary={latency:1500};
  out.explicitLate=await explicitRender(current,slowSummary,explicitInFlight);
  assert.ok(out.explicitLate.delay<=slowSummary.latency+100,`11: drawn on that answer (${JSON.stringify(out.explicitLate)})`);
  assert.equal(out.explicitLate.shownReason,'summary-due','11: drawn as the explicit render\'s follow-up');
  out.explicitMet=await explicitRender(current,{latency:900},explicitInFlight);
  assert.deepEqual(out.explicitMet.after[0],[900,'loop-deferred'],`11: the answer is drawn at once as the loop's render (${JSON.stringify(out.explicitMet)})`);
  assert.ok(out.explicitMet.after[1][0]-out.explicitMet.after[0][0]>=2000,`11: and the deferral's own answer is not a second rebuild (${JSON.stringify(out.explicitMet)})`);
  // 12. Stacks are read only while recording; a render that serves an armed deferral keeps its reason.
  out.unrecorded=await explicitRender(current,{recording:false},DUE-400);
  assert.equal(out.unrecorded.errors,0,`12: no stack is read without a recording (${JSON.stringify(out.unrecorded)})`);
  assert.equal(out.unrecorded.explicitReason,'explicit','12: an explicit render is named plainly without a recording');
  out.recorded=await explicitRender(current,{},DUE-400);
  assert.equal(out.recorded.errors,1,`12: one stack read for the one explicit render while recording (${JSON.stringify(out.recorded)})`);
  assert.equal(out.recorded.explicitReason,'explicit:script','12: an explicit render names its caller while recording');
  // A summary answered in 300 ms arms the deferral; an explicit render 96 ms after the due time serves it.
  out.servedByExplicit=await explicitRender(current,{latency:300},DUE+96);
  assert.match(out.servedByExplicit.explicitReason,/^explicit:.+\+loop$/,`12: the serving render keeps its own reason (${JSON.stringify(out.servedByExplicit)})`);
  // 13. A render that returned early (no map) leaves no reason behind.
  out.earlyReturn=await explicitRender(current,{script:(t,api,context)=>{if(t===DUE-96){context.map=null;api.scheduleViewportMapRender(0,false,'viewport');}if(t===DUE-48)context.map={};}},DUE-32);
  assert.match(out.earlyReturn.explicitReason,/^explicit:/,`13: the viewport reason did not outlive its early return (${JSON.stringify(out.earlyReturn)})`);
  // 14. Caller names in V8 and JavaScriptCore stacks.
  {const caller=api=>vm.runInNewContext(`${app.slice(app.indexOf('  function mapRenderCaller('),app.indexOf('  function scheduleViewportMapRender('))}\nmapRenderCaller`,{Error:class{constructor(){this.stack=api;}}});
    const v8=lines=>['Error','    at mapRenderCaller (https://h/WebApp/app.js:1840:30)','    at renderMap (https://h/WebApp/app.js:2700:5)',...lines].join('\n'),jsc=lines=>['mapRenderCaller@https://h/WebApp/app.js:1840:30','renderMap@https://h/WebApp/app.js:2700:5',...lines].join('\n');
    const cases=[[v8(['    at Array.forEach (<anonymous>)','    at HTMLButtonElement.<anonymous> (https://h/WebApp/app.js:5120:7)']),'app.js:5120'],[v8(['    at async runDurableStateCommand (https://h/WebApp/app.js:9000:3)']),'runDurableStateCommand'],
      [v8(['    at Object.openFacility (https://h/WebApp/app.js:4000:1)']),'openFacility'],[v8(['    at new Panel (https://h/WebApp/app.js:3000:1)']),'Panel'],[v8(['    at https://h/WebApp/app.js:77:5']),'app.js:77'],
      [jsc(['forEach@[native code]','@https://h/WebApp/app.js:5120:7']),'app.js:5120'],[jsc(['openFacility@https://h/WebApp/app.js:4000:1']),'openFacility'],[jsc(['promiseReactionJob@[native code]','global code@https://h/WebApp/app.js:12:1']),'app.js:12'],
      [jsc(['async*runDurableStateCommand@https://h/WebApp/app.js:9000:3']),'runDurableStateCommand'],[jsc(['@https://h/WebApp/app.js?v=3:44:2']),'app.js:44'],[jsc(['@ventora://app/WebApp/app.js:88:1']),'app.js:88'],[v8([]),'unknown'],['','unknown']];
    out.callers=cases.map(([stack,want])=>{const got=caller(stack)();assert.equal(got,want,`14: ${JSON.stringify(stack.split('\n').slice(-1)[0])}`);return got;});}
  // 15. The explicit render's answer lands in the frame the loop is due; its follow-up render runs after that frame.
  const raceAt=DUE-384,race={latency:384,frameFirst:true};
  out.queuedFollowUp=await explicitRender(current,race,raceAt);
  assert.deepEqual(out.queuedFollowUp.after[0],[384,'loop-deferred'],`15: the queued follow-up serves the deferral (${JSON.stringify(out.queuedFollowUp)})`);
  assert.ok(out.queuedFollowUp.after[1][0]-out.queuedFollowUp.after[0][0]>=2000,`15: the deferral's own answer is not a second rebuild (${JSON.stringify(out.queuedFollowUp)})`);
  // 5. A summary of another runtime (a store rebuild).
  out.runtime=await play(current,{runtime:t=>t<20000?'rt':'rt2'});
  assert.ok(out.runtime.maxGap<=INTERVAL+50,`5: a store rebuild does not wait (${JSON.stringify(out.runtime)})`);assert.equal(out.runtime.pairs,0,`5: drawn once (${JSON.stringify(out.runtime)})`);
  // 8. The previous sources fail these checks.
  const git=process.env.GH_MAP_LOOP_GIT_DIR||ROOT,show=rev=>execFileSync('git',['-C',git,'show',`${rev}:WebApp/app.js`],{encoding:'utf8',maxBuffer:64*1024*1024});
  out.before=await play(harness(show('4ed42a0')));
  assert.ok(out.before.pairs>0,`8: before the deferral a loop render is drawn twice (${JSON.stringify(out.before)})`);
  out.firstDeferral=await play(harness(show('bda0a47')),{refuse:t=>t>50});
  assert.ok(out.firstDeferral.maxGap>=2*INTERVAL-50,`8: the first deferral doubled the gap on a refused request (${JSON.stringify(out.firstDeferral)})`);
  out.boundedOnly=await play(harness(show('6f3ac50')),{latency:1200});
  assert.ok(out.boundedOnly.within2s>0,`8: the bounded deferral redrew after its late draw (${JSON.stringify(out.boundedOnly)})`);
  out.refusedFollowUp=await play(harness(show('ed364e2')),dueRefused);
  assert.ok(out.refusedFollowUp.within2s>0,`8: a refused loop render wanted a second rebuild (${JSON.stringify(out.refusedFollowUp)})`);
  const cleared=harness(show('d09e11b'));
  out.clearedRefused=await explicitRender(cleared,refusalSpansDue,explicitInRefusal);
  assert.ok(out.clearedRefused.delay>=INTERVAL-1000,`8: d09e11b kept the explicit render's revision off the map for an interval (${JSON.stringify(out.clearedRefused)})`);
  out.clearedLate=await explicitRender(cleared,slowSummary,explicitInFlight);
  assert.ok(out.clearedLate.delay>=INTERVAL-1000,`8: and when its deferral was late (${JSON.stringify(out.clearedLate)})`);
  // 9. The recorder keeps the reason (only while a recording is active).
  {const {s}=coreHarness(['diagnostics-core']),d=s.GH_DIAGNOSTICS,state=minimal();let now=1000;s.performance={now:()=>now};state.speed=0;
    assert.equal(d.recordMainThreadWork(state,'map.structure',1,40,{reason:'loop'}),false,'9: nothing is recorded without a recording');
    d.recorderStart(state,{speed:0},{nowMs:1000000,performanceNowMs:now});
    const frame=at=>d.recorderFrame(state,{rafTimestampMs:at,callbackStartMs:at+.1,callbackEndMs:at+1,visible:true,hidden:false});
    for(let i=0;i<40;i++){frame(now);now+=1000/60;}
    d.recordMainThreadWork(state,'map.structure',now+1,now+31,{reason:'summary-new-layout'});frame(now+34);
    const drop=d.recorderSnapshot(state).events.find(row=>row.type==='FRAME_DROP');
    out.recorder={cause:drop?.detail?.cause,work:drop?.detail?.mainThreadWork};
    assert.equal(drop?.detail?.cause?.stage,'map.structure','9: the rebuild explains the drop');assert.equal(drop.detail.cause.reason,'summary-new-layout','9: the drop names the reason');
    assert.equal(drop.detail.mainThreadWork[0].reason,'summary-new-layout','9: the work row keeps the reason');
    const other=minimal();other.speed=0;d.recorderStart(other,{speed:0},{nowMs:2000000,performanceNowMs:now});
    for(let i=0;i<40;i++){d.recorderFrame(other,{rafTimestampMs:now,callbackStartMs:now+.1,callbackEndMs:now+1,visible:true,hidden:false});now+=1000/60;}
    d.recordMainThreadWork(other,'map.structure',now+1,now+31,{reason:'x'.repeat(200)});d.recorderFrame(other,{rafTimestampMs:now+34,callbackStartMs:now+34.1,callbackEndMs:now+35,visible:true,hidden:false});
    const long=d.recorderSnapshot(other).events.find(row=>row.type==='FRAME_DROP');
    assert.equal(long?.detail?.cause?.reason,'x'.repeat(64),'14: the recorder bounds a reason to 64 characters');}
  console.log(JSON.stringify({suite:'build532-map-loop-single-render',ok:true,...out}));
})().catch(error=>{console.error(error);process.exit(1);});
