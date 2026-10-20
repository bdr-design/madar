'use strict';
// The structural map loop drew the fleet summary it held and that render then wanted the store's revision, so the newer
// summary's arrival about 15 ms later rebuilt the map again: two full rebuilds (41-44 ms each on iPhone) for one loop
// render (build514 failed 2 of 8 runs on this). bda0a47 deferred a due loop render to the summary's arrival, but a
// request the worker refused, rejected, left unanswered or answered unavailable then waited a whole interval: the
// structure was redrawn every 16 s instead of every 8 s (an independent review's model). The loop now defers only with a
// request in flight and draws with the summary held after MAP_LOOP_RENDER_DEFER_MS. Proven deterministically on the real
// source text of scheduleViewportMapRender, the summary client, deferLoopRenderToSummary, the end of renderMap and the
// loop's structural line, with virtual time and a scripted worker (8 s interval, 64 s of play, fleet moving every 100 ms):
//  1. a summary answered in 15 ms: no two structural renders within 100 ms, at most one interval between renders, and
//     each render measured once as a structural render;
//  2. a request the worker refuses: at most one interval between renders, as before the deferral;
//  3. a request rejected, unanswered or answered unavailable: at most one interval and the bound between renders;
//  4. a summary of another runtime (a store rebuild): drawn at once, never deferred;
//  5. the previous sources fail: 4ed42a0 draws pairs in case 1, bda0a47 leaves 16 s gaps in case 2.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{execFileSync}=require('node:child_process');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
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

async function play(source,{answer='summary',refuse=()=>false,runtime=()=>'rt'}={}){
  let now=0,seq=0;const timers=[],renders=[],metrics=[];let world=0;
  const setTimeout_=(fn,ms)=>{const id=++seq;timers.push({id,at:now+Math.max(0,Number(ms)||0),fn});return id;};
  const clearTimeout_=id=>{const i=timers.findIndex(t=>t.id===id);if(i>=0)timers.splice(i,1);};
  const state={fleet:{revision:1}};
  const client={disabled:false,fieldClasses(store){
    // The first summary (asked at 0) is always answered; the scripted answer applies to the loop's requests.
    if(refuse(now))return null;const revision=store.revision,stamp=runtime(now),mode=now>50?answer:'summary';
    if(mode==='hang')return new Promise(()=>{});
    if(mode==='reject')return new Promise((_,reject)=>setTimeout_(()=>reject(new Error('qa-summary-rejected')),15));
    if(mode==='unavailable')return new Promise(resolve=>setTimeout_(()=>resolve(null),15));
    return new Promise(resolve=>setTimeout_(()=>resolve({store,runtime:stamp,revision,rows:[[{},1,0,1]]}),15));}};
  const context={setTimeout:setTimeout_,clearTimeout:clearTimeout_,console,state,map:{},MAP_CLASS_FIELDS:[],mapStatusCache:{},mapRenderTimer:null,
    fleetEngineThreadClient:client,ownMarkers:new Map(),renderedMobilityIds:new Set(),mapVehicleCanvas:null,
    appMetricClock:()=>now,__renders:renders,__world:()=>world,
    recordRenderMetric:(kind,ms,detail)=>{if(kind==='structural-render')metrics.push({at:now,detail});},
    window:{GH_FLEET_STORE:{isStore:()=>true,chunkStamp:()=>({runtime:runtime(now)}),epoch:()=>0},GH_FLEET_DATA:{size:()=>100},GH_DIAGNOSTICS:null}};
  const api=vm.runInNewContext(`let mapRenderTimer=null;\n${source}`,context);
  const settle=async()=>{for(let i=0;i<6;i++)await null;};
  const runUntil=async until=>{for(;;){timers.sort((a,b)=>a.at-b.at||a.id-b.id);if(!timers.length||timers[0].at>until)break;const t=timers.shift();now=t.at;t.fn();await settle();}now=until;await settle();};
  api.mapFleetClassRows();await runUntil(50);
  for(let t=64;t<=DURATION;t+=16){await runUntil(t);if(t%100===0)state.fleet.revision++;if(t%1000===0)world++;api.loopStructural(t);await settle();}
  await runUntil(DURATION+2000);
  const gaps=renders.slice(1).map((row,i)=>row.at-renders[i].at);
  // The first summary's arrival draws at 15 ms (the map held no rows): not a loop render.
  return {renders:renders.length,loopRenders:renders.filter(row=>row.at>PAIR_MS).length,pairs:gaps.filter(gap=>gap<PAIR_MS).length,maxGap:Math.max(...gaps),metrics:metrics.length,deferredMetrics:metrics.filter(m=>m.detail?.deferred).length};
}

(async()=>{
  const app=fs.readFileSync(path.join(ROOT,'WebApp/app.js'),'utf8'),current=harness(app);
  const out={};
  // 1. Answered in 15 ms.
  out.answered=await play(current);
  assert.equal(out.answered.pairs,0,`1: no back-to-back structural renders (${JSON.stringify(out.answered)})`);
  assert.ok(out.answered.maxGap<=INTERVAL+50,`1: at most one interval between renders (${JSON.stringify(out.answered)})`);
  assert.ok(out.answered.renders>=DURATION/INTERVAL-1,`1: the structure is redrawn every interval (${JSON.stringify(out.answered)})`);
  assert.equal(out.answered.metrics,out.answered.loopRenders,'1: each loop render is measured once as a structural render');
  assert.ok(out.answered.deferredMetrics>0,'1: the deferred renders are measured');
  // 2. Refused by the worker (a step or a plan pending).
  out.refused=await play(current,{refuse:t=>t>50});
  assert.ok(out.refused.maxGap<=INTERVAL+50,`2: a refused request draws at once (${JSON.stringify(out.refused)})`);
  assert.equal(out.refused.metrics,out.refused.loopRenders,'2: each loop render is measured once');
  // 3. Rejected, never answered, answered unavailable.
  for(const answer of ['reject','hang','unavailable']){
    const row=out[answer]=await play(current,{answer});
    assert.ok(row.maxGap<=INTERVAL+1000+50,`3: ${answer}: at most one interval and the bound between renders (${JSON.stringify(row)})`);
    assert.ok(row.renders>=DURATION/(INTERVAL+1000)-1,`3: ${answer}: the structure keeps being redrawn (${JSON.stringify(row)})`);
  }
  // 4. A summary of another runtime: never deferred.
  out.runtime=await play(current,{runtime:t=>t<20000?'rt':'rt2'});
  assert.ok(out.runtime.maxGap<=INTERVAL+50,`4: a store rebuild draws at once (${JSON.stringify(out.runtime)})`);
  // 5. The previous sources fail these checks.
  const git=process.env.GH_MAP_LOOP_GIT_DIR||ROOT,show=rev=>execFileSync('git',['-C',git,'show',`${rev}:WebApp/app.js`],{encoding:'utf8',maxBuffer:64*1024*1024});
  out.before=await play(harness(show('4ed42a0')));
  assert.ok(out.before.pairs>0,`5: before the deferral a loop render is drawn twice (${JSON.stringify(out.before)})`);
  out.firstDeferral=await play(harness(show('bda0a47')),{refuse:t=>t>50});
  assert.ok(out.firstDeferral.maxGap>=2*INTERVAL-50,`5: the first deferral doubled the gap on a refused request (${JSON.stringify(out.firstDeferral)})`);
  console.log(JSON.stringify({suite:'build532-map-loop-single-render',ok:true,...out}));
})().catch(error=>{console.error(error);process.exit(1);});
