'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium,webkit}=require('playwright');
const source=fs.readFileSync(require.resolve('../WebApp/performance-trace-core.js'),'utf8'),results=[];
(async()=>{for(const engine of [chromium,webkit]){
 const browser=await engine.launch({headless:true});try{
  const page=await browser.newPage();await page.addScriptTag({content:source});
  const measured=await page.evaluate(async()=>{
   let timerCount=0,clears=0,wall=1700000000000;const store={save:async()=>{}};
   const make=()=>GH_PERFORMANCE_TRACE.create({store,wallClock:()=>wall++,setTimer:()=>{timerCount++;return timerCount;},clearTimer:()=>{clears++;},yieldToHost:()=>Promise.resolve()});
   const batches=[];let bytes=0;
   for(let batch=0;batch<5;batch++){
    const recorder=make(),inactive=performance.now();for(let i=0;i<20000;i++)recorder.frame(i,i,i);const offMs=performance.now()-inactive;
    recorder.start();const start=performance.now();let raf=start;
    for(let i=0;i<20000;i++){raf+=1000/120;recorder.work('map.targets',raf,raf+.3);recorder.frame(raf,raf+.01,raf+.5);}
    const elapsed=performance.now()-start,report=await recorder.stop();bytes=report.observer.bufferBytes;batches.push({offMs,activeMs:elapsed,meanActiveMs:elapsed/20000});
   }
   const flooded=make();flooded.start();let raf=performance.now();for(let i=0;i<20;i++){raf+=16.67;flooded.frame(raf,raf,raf+1);}const start=performance.now();
   for(let i=0;i<1000;i++){for(let j=0;j<128;j++)flooded.work(j&1?'map.targets':'command.validate',raf+1,raf+20+j*.01);raf+=50;flooded.frame(raf,raf,raf+1);}
   const floodMs=performance.now()-start,full=await flooded.stop();return {batches,medianActiveMs:batches.map(r=>r.meanActiveMs).sort((a,b)=>a-b)[2],bytes,timerCount,clears,retainedIncidents:full.incidents.length,droppedIncidents:full.coverage.overwrittenIncidents,floodMs,meanSaturatedFrameAnd128HooksMs:floodMs/1000,kind:'isolated-engine-throughput-not-game-fps',physicalIPhone:false};
  });
  assert.ok(measured.bytes<=512*1024);assert.equal(measured.timerCount,measured.clears,'manual session timers are released');assert.equal(measured.retainedIncidents,512);assert.equal(measured.droppedIncidents,488);assert.ok(measured.medianActiveMs<.05,'median batch mean work per frame stays under 0.05ms in this environment');assert.ok(measured.meanSaturatedFrameAnd128HooksMs<2,'bounded saturated evidence work remains under 2ms average in this environment');
  results.push({engine:engine.name(),...measured});
 }finally{await browser.close();}
}const result={suite:'build381-performance-budget-browser',ok:true,results};if(process.env.GH_PERFORMANCE_ARTIFACTS)fs.writeFileSync(process.env.GH_PERFORMANCE_ARTIFACTS+'/engine-budget.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));})().catch(error=>{console.error(error);process.exitCode=1;});
