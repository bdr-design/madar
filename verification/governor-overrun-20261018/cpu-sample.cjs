'use strict';
const path=require('node:path'),Core=require(path.join(process.argv[2],'WebApp/simulation-core.js'));
let wall=0;const engine=Core.create({getSimTime:()=>0,setSimTime(){},getSpeed:()=>300,setSpeed(){},createSliceJob:()=>({runChunk(){wall+=1;return {pending:true};},finish(){return {committed:true};}})},{nowMs:()=>wall,frameBudgetMs:4,cooldownAfterMs:0});
engine.reset(0);for(let i=0;i<20000;i++){wall+=16;engine.frame(wall);}
const n=100000,start=performance.now();for(let i=0;i<n;i++){wall+=16;engine.frame(wall);}const elapsed=performance.now()-start;
console.log(JSON.stringify({measuredFrameCalls:n,elapsedMs:elapsed,meanCpuMsPerFrame:elapsed/n,finalLevel:engine.snapshot().governor,healthFrames:engine.snapshot().frames,node:process.version}));
