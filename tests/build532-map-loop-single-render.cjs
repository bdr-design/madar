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
//     second rebuild in case 4, ed364e2 draws a second rebuild in case 6.
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
    ({loopStructural,mapFleetClassRows});`;
}

async function play(source,{answer='summary',refuse=()=>false,runtime=()=>'rt',latency=15,statusEvery=0}={}){
  let now=0,seq=0;const timers=[],renders=[],metrics=[],reasons={};let world=0;
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
    appMetricClock:()=>now,__renders:renders,__world:()=>world,
    recordRenderMetric:(kind,ms,detail)=>{if(kind==='structural-render')metrics.push({at:now,detail});},
    window:{GH_FLEET_STORE:{isStore:()=>true,chunkStamp:()=>({runtime:runtime(now)}),epoch:()=>0},GH_FLEET_DATA:{size:()=>100},
      GH_DIAGNOSTICS:{recorderIsActive:()=>true,recordMainThreadWork:(state,stage,start,end,detail)=>{if(stage==='map.structure'&&start>=INTERVAL&&start<=DURATION){const reason=String(detail?.reason||'none');reasons[reason]=(reasons[reason]||0)+1;}}}}};
  const api=vm.runInNewContext(`let mapRenderTimer=null;\n${source}`,context);
  const settle=async()=>{for(let i=0;i<6;i++)await null;};
  const runUntil=async until=>{for(;;){timers.sort((a,b)=>a.at-b.at||a.id-b.id);if(!timers.length||timers[0].at>until)break;const t=timers.shift();now=t.at;t.fn();await settle();}now=until;await settle();};
  api.mapFleetClassRows();await runUntil(50);
  for(let t=64;t<=DURATION;t+=16){await runUntil(t);if(t%100===0)state.fleet.revision++;if(t%512===0)world++;if(statusEvery&&t%statusEvery===0)api.mapFleetClassRows();api.loopStructural(t);await settle();}
  await runUntil(DURATION+2000);
  // Counted while the loop runs: the first summary's arrival draws before the first due render (the map held no rows) and
  // is not a loop render; a deferral armed at the last frame is answered after the loop stopped.
  const drawn=renders.filter(row=>row.at<=DURATION),measured=metrics.filter(row=>row.at<=DURATION);
  const gaps=drawn.slice(1).map((row,i)=>row.at-drawn[i].at);
  return {renders:drawn.length,loopRenders:drawn.filter(row=>row.at>=INTERVAL).length,pairs:gaps.filter(gap=>gap<PAIR_MS).length,within2s:gaps.filter(gap=>gap<2000).length,maxGap:Math.max(...gaps),metrics:measured.length,deferredMetrics:measured.filter(m=>m.detail?.deferred).length,reasons};
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
    assert.equal(drop.detail.mainThreadWork[0].reason,'summary-new-layout','9: the work row keeps the reason');}
  console.log(JSON.stringify({suite:'build532-map-loop-single-render',ok:true,...out}));
})().catch(error=>{console.error(error);process.exit(1);});
