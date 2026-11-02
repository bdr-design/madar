'use strict';
// Owner («كمل ابحاثك عن اسباب الثقل والمشاكل» → «جميعها على دفعات مع مراجعة الوكيل»): while a diagnostic recording runs,
// the frame recorder's cadence estimate rebuilt and sorted its bucket map on every frame (its largest cost, about a tenth
// of the busy main thread under a 4x slowed processor), which also weighed on the recordings the owner sends. The bucket
// counts now follow the window as samples enter and leave. Proven against the previous algorithm (copied below), frame by
// frame, over 6,000 intervals of steady, mixed, switching and out-of-range cadences:
//   1. the same expected frame interval, refresh estimate, mode share and confidence after every frame, and the same
//      janky-frame and missed-frame counts (these read the unrounded estimate), counted intervals and long gaps (≥1 s);
//   2. the recorder still starts provisional and reaches a steady 60 Hz and 30 Hz reading;
//   3. the per-frame work no longer rebuilds and sorts the bucket map (source).
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const D=require(path.join(ROOT,'WebApp/diagnostics-core.js'));
const SOURCE=fs.readFileSync(path.join(ROOT,'WebApp/diagnostics-core.js'),'utf8');
const WINDOW=Number(/CADENCE_WINDOW=(\d+)/.exec(SOURCE)?.[1]);assert.ok(WINDOW>=12,'the cadence window is read from the source');
const roundMs=value=>Math.round((Number(value)||0)*100)/100;
// The previous algorithm, as it was (WebApp/diagnostics-core.js before this change).
function previous(buffer,gapMs){
  if(gapMs>=6&&gapMs<=60){buffer.cadenceSamples.push(gapMs);if(buffer.cadenceSamples.length>WINDOW)buffer.cadenceSamples.shift();}
  const samples=buffer.cadenceSamples;if(samples.length<6)return;
  const buckets=new Map();for(const value of samples){const bucket=Math.round(value);buckets.set(bucket,(buckets.get(bucket)||0)+1);}
  const ranked=[...buckets.entries()].sort((a,b)=>b[1]-a[1]||(a[0]-b[0]));let [bucket,count]=ranked[0];
  if(buffer.baselineIntervalMs!=null&&ranked.length>1){const currentBucket=Math.round(buffer.baselineIntervalMs),currentCount=buckets.get(currentBucket)||0,share=count/samples.length;if(bucket>currentBucket*1.5&&share<.7){bucket=currentBucket;count=currentCount;}else if(bucket<currentBucket*.65&&share<.35){bucket=currentBucket;count=currentCount;}}
  const selected=samples.filter(value=>Math.round(value)===bucket).sort((a,b)=>a-b),middle=Math.floor(selected.length/2),estimate=selected.length%2?selected[middle]:(selected[middle-1]+selected[middle])/2;
  buffer.baselineIntervalMs=estimate;buffer.cadenceModeShare=count/samples.length;buffer.cadenceConfidence=samples.length<12||buffer.cadenceModeShare<.35?'provisional':buffer.cadenceModeShare>=.6?'steady':'mixed';
}
// A deterministic sequence of frame intervals: steady 60 Hz, steady 30 Hz, a mix of both, sudden pauses (61–361 ms gaps,
// counted as intervals but not cadence samples, and 1.1–2 s gaps, counted as long gaps), short gaps under 6 ms, 120 Hz,
// and gaps around the janky threshold.
let seed=7;const random=()=>((seed=(seed*1103515245+12345)%2147483648)/2147483648);
const gaps=[];
for(let i=0;i<6000;i++){
  const phase=Math.floor(i/500)%7,r=random(),q=random();
  // Phase 6 puts a quarter of the gaps at 24.85–25.25 ms, across 1.5 × the 60 Hz estimate (the janky threshold, 25.10–25.17 ms), so a different
  // threshold factor or an estimate taken before this frame's update would count other frames.
  gaps.push(phase===0?16.6+r*.3:phase===1?33.3+r*.4:phase===2?(r<.5?16.7:33.4)+q*.2:phase===3?(r<.03?1100+q*900:r<.15?61+q*300:16.7+q*.5):phase===4?(r<.1?3+q*2:20+q*3):phase===5?8.3+r*.4:(r<.25?24.85+q*.4:16.65+q*.2));
}
const state={};let raf=1000;const reference={cadenceSamples:[],baselineIntervalMs:null,cadenceModeShare:0,cadenceConfidence:'uncalibrated'};
assert.ok(D.recorderStart(state,{},{nowMs:Date.now(),performanceNowMs:raf}),'the recorder starts');
let janks=0,missed=0,intervals=0,longGaps=0,compared=0,steady60=false,steady30=false,provisional=false;
// The recorder measures an interval from the second frame on (the first has no frame before it), as the reference does.
D.recorderFrame(state,{rafTimestampMs:raf,callbackStartMs:raf+.1,callbackEndMs:raf+1,simSeconds:0,visible:true},{});
for(const step of gaps){
  // The recorder keeps each frame's time rounded to 0.01 ms and measures the interval from that rounded time; the reference
  // takes the same interval.
  const before=roundMs(raf);raf+=step;D.recorderFrame(state,{rafTimestampMs:raf,callbackStartMs:raf+.1,callbackEndMs:raf+1,simSeconds:0,visible:true},{});
  const gap=Math.max(0,raf-before);if(gap>2&&gap<1000){intervals++;previous(reference,gap);}else if(gap>=1000)longGaps++;
  // The recorder's janky test on the estimate after this frame's update (diagnostics-core recorderFrame), as before.
  {const expected=reference.baselineIntervalMs,threshold=expected==null?34:Math.max(12,expected*1.5),janky=gap>threshold&&gap<1000;if(janky){janks++;missed+=expected>0?Math.max(1,Math.round(gap/expected)-1):0;}}
  const summary=D.recorderSnapshot(state).frameSummary,interval=reference.baselineIntervalMs;
  if(reference.cadenceSamples.length<6)continue;
  // 1.
  assert.deepEqual({expected:summary.expectedFrameIntervalMs,refresh:summary.estimatedRefreshHz,share:summary.cadenceModeShare,confidence:summary.cadenceConfidence},
    {expected:interval==null?null:roundMs(interval),refresh:interval>0?roundMs(1000/interval):null,share:roundMs(reference.cadenceModeShare),confidence:reference.cadenceConfidence},`1: frame ${compared}: the same cadence as before`);
  assert.deepEqual({intervals:summary.visibleIntervals,longGaps:summary.longGaps},{intervals,longGaps},`1: frame ${compared}: the same counted intervals and long gaps`);
  assert.deepEqual({janky:summary.jankyFrames,missed:summary.estimatedMissedFrames},{janky:janks,missed},`1: frame ${compared}: the same janky and missed frames`);
  compared++;if(summary.cadenceConfidence==='provisional')provisional=true;if(summary.cadenceConfidence==='steady'&&Math.round(summary.estimatedRefreshHz)===60)steady60=true;if(summary.cadenceConfidence==='steady'&&Math.round(summary.estimatedRefreshHz)===30)steady30=true;
}
assert.ok(compared>5000,`1: compared ${compared} frames`);assert.ok(longGaps>=10,`1: the sequence has long gaps (${longGaps})`);
// 2.
assert.ok(provisional&&steady60&&steady30,'2: provisional at first, then steady at 60 Hz and at 30 Hz');
// 3.
const body=SOURCE.slice(SOURCE.indexOf('function cadenceEstimate('),SOURCE.indexOf('function frameSummary('));
assert.doesNotMatch(body,/\[\.\.\.\w+\.entries\(\)\]|\.filter\(/,'3: no copy, sort or filter of the bucket map on each frame (only the chosen bucket is sorted, for its median)');
assert.match(body,/counts\.set\(added/,'3: the counts follow the window');
console.log(JSON.stringify({suite:'build658-recorder-cadence-equivalence',ok:true,frames:compared,window:WINDOW}));
