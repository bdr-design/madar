'use strict';
// Build 711 (owner, 18 Nov 2026, batch H item 9: «الفجوة المجهولة 770 مللي ثانية»). The iPhone recording's worst frame
// interval (770 ms) left no evidence: its FRAME_DROP event fell out of the 120-event list and its work rows out of the 96-row
// list. The recorder now keeps the worst visible gap of a recording apart (diagnostics-core.js worstGapEvidence), in the
// exported file (the snapshot with history). Checks:
//   1. with the recorder off nothing is kept or recorded;
//   2. a 300 ms gap is kept with the work that overlaps it (its frame and the one before, by sequence; work begun after the
//      frame's callback started is not its own); a later 200 ms gap leaves it; a 770 ms gap replaces it;
//   3. after more than 96 work rows, 240 frames and 120 events, the export still holds the 770 ms gap and its rows; the
//      per-frame sample (no history) does not copy it;
//   4. bounds (exact binary times): 250 ms is not kept, 250.5 is; an interval that spans a visibility change (the app's
//      count in the frame sample) is not kept whatever its length (3 s, or a 600 ms app switch); a foreground freeze of 1 s
//      or more is kept, under 60 s (59999.5 kept, 60000 not); without the count the 1 s bound stands in (999.5 kept, 1000
//      not); an interval with a hidden end (either end) is not kept; below 1 s it equals frameSummary.maxFrameIntervalMs;
//   4b. the frame before the gap keeps its recorder overhead (the input of the recorder-overhead cause); the gap's frame,
//      recorded before its own overhead is measured, has none;
//   5. the truncation flag: set when work rows that overlap the gap were dropped (120 rows in a 400 ms gap: 96 overlap,
//      24 dropped, 30 exported); clear when only older rows were dropped;
//   4c. a new worst is confirmed by the next frame: dropped when the visibility count moved meanwhile (the
//      visibilitychange task ran after the first frame of a return); a frame with no count (on either end) falls back to
//      the 1 s bound, and the count of an earlier frame is not carried over it;
//   5b. the truncation bound: a dropped row that ended exactly where the gap began is not the gap's; one that ended inside
//      it is (by its end, not its start);
//   4d. a larger candidate in the very next frame replaces a pending one (the pending one confirmed first); a counted
//      candidate confirmed by a frame without a count is kept; one not yet confirmed is exported marked unconfirmed (also
//      after the recording stops), and no longer once confirmed;
//   7. the evidence: its time (the gap frame's callback end, wall clock) and simulation time, inFrameSummary (exactly 1 s
//      is outside it), no single cause; (source) both app frame samples carry the visibility count, which the
//      visibilitychange listener moves.
//   (Not covered: long-task entries; this harness has no PerformanceObserver.)
//   6. the export keeps it after the recording stops (the stop summary does not repeat it), bounded with long stage names;
//      a new recording starts empty.
const assert=require('node:assert/strict');
const {harness}=require('./helpers/core-harness');
const {s}=harness(['diagnostics-core']);const diag=s.GH_DIAGNOSTICS;
// The app passes its visibilitychange count with each frame (app.js visibilityEpoch); counted:false leaves it out. Gaps
// are exact binary values (16.5, 250, 250.5) so the bounds are tested exactly.
function recording({counted=true}={}){
  const state={simSeconds:0},wall0=1795000000000,perf0=1024;let raf=perf0,epoch=0;
  diag.recorderStart(state,{speed:1,frames:0,slices:0},{nowMs:wall0,performanceNowMs:perf0});
  const frame=(gap,{hidden=false,visibilityChanges=0,uncounted=false,epochValue}={})=>{raf+=gap;epoch+=visibilityChanges;return diag.recorderFrame(state,{rafTimestampMs:raf,callbackStartMs:raf+.25,callbackEndMs:raf+1.5,simSeconds:state.simSeconds,visible:!hidden,hidden,...(epochValue!==undefined?{visibilityEpoch:epochValue}:counted&&!uncounted?{visibilityEpoch:epoch}:{}),panel:'map',mapActive:true,simulationMs:1,targetUpdateMs:0,markerAnimationMs:0,structuralRenderMs:0},{nowMs:wall0+raf});};
  const work=(stage,offset,ms)=>diag.recordMainThreadWork(state,stage,raf+offset,raf+offset+ms);
  const steady=n=>{for(let i=0;i<n;i++)frame(16.5);};
  return {state,frame,work,steady,file:()=>diag.recorderSnapshot(state,{includeHistory:true}),sample:()=>diag.recorderSnapshot(state),at:()=>raf};
}
const stages=g=>Array.from(g.mainThreadWork,row=>row.stage);
// 1.
{const state={simSeconds:0};assert.equal(diag.recordMainThreadWork(state,'x',1,9),false,'1: no work recorded without a recording');assert.equal(diag.recorderSnapshot(state,{includeHistory:true}),null,'1: nothing to export');}
// 2. + 3. + 6.
{const r=recording();r.steady(30);r.work('maintenance.health',5,240);r.work('late.after-callback',300.5,3);r.state.simSeconds=42;r.frame(300);const gapRaf=r.at();r.steady(1);
  let g=r.file().worstGap;assert.equal(g?.frameIntervalMs,300,'2: the 300 ms gap is kept');assert.deepEqual(stages(g),['maintenance.health'],'2: with its own work only (not work begun after its callback started)');
  assert.equal(g.frame.frameIntervalMs,300,'2: its frame');
  // 7.
  assert.equal(g.atMs,Math.round(1795000000000-1024+gapRaf+1.5),'7: its time is the gap frame\'s callback end');assert.equal(g.simSeconds,42,'7: and its simulation time');
  assert.equal(g.inFrameSummary,true,'7: under 1 s: in the frame summary');assert.equal('cause' in g,false,'7: no single cause is named (the rows are the evidence)');assert.equal(g.previousFrame.sequence,g.frame.sequence-1,'2: and the one before');assert.equal(g.workTruncated,false);
  r.steady(10);r.frame(200);assert.equal(r.file().worstGap.frameIntervalMs,300,'2: a smaller later gap leaves it');
  r.steady(10);r.work('simulation.finish',420,300);r.work('road-geometry.rows',3,400);r.frame(770);r.steady(1);
  g=r.file().worstGap;assert.equal(g.frameIntervalMs,770,'2: the 770 ms gap replaces it');assert.deepEqual(stages(g),['road-geometry.rows','simulation.finish'],'2: its own work, sorted by overlap (recorded in the other order)');
  for(let i=0;i<150;i++){r.work(`noise.${i}`,1,2);r.frame(260);}r.steady(100);
  const file=r.file();assert.ok(file.eventCount>120,`3: more events than the event list keeps (${file.eventCount})`);
  g=file.worstGap;assert.equal(g.frameIntervalMs,770,'3: the 770 ms gap survives the event and work-row churn');assert.deepEqual(stages(g),['road-geometry.rows','simulation.finish'],'3: with its rows');
  assert.equal('worstGap' in r.sample(),false,'3: the per-frame sample does not copy it');
  // 4. (returns from the background: rAF does not run while hidden, so both frames read visible; the count changed)
  r.frame(3000,{visibilityChanges:2});r.steady(5);r.frame(900,{visibilityChanges:2});r.steady(5);assert.equal(r.file().worstGap.frameIntervalMs,770,'4: an interval spanning a visibility change (3 s, 900 ms) neither is kept nor replaces it');
  const summary=diag.recorderStop(r.state,{},{});assert.equal('worstGap' in summary,false,'6: the stop summary does not repeat it');
  assert.equal(r.file().worstGap?.frameIntervalMs,770,'6: the export keeps it after the stop');
  diag.recorderStart(r.state,{speed:1},{nowMs:1795000900000,performanceNowMs:r.at()});assert.equal(diag.recorderSnapshot(r.state,{includeHistory:true}).worstGap,null,'6: a new recording starts empty');}
// 4.
const maxInterval=r=>r.file().frameSummary.maxFrameIntervalMs;
{const r=recording();r.steady(20);r.frame(240);r.steady(5);r.frame(250);r.steady(1);assert.equal(r.file().worstGap,null,'4: 250 ms is not kept');
  r.steady(5);r.frame(250.5);r.steady(1);let g=r.file().worstGap;assert.equal(g?.frameIntervalMs,250.5,'4: 250.5 ms is');assert.equal(g.frameIntervalMs,maxInterval(r),'4: it is the summary\'s longest interval');
  // 4b.
  assert.ok(Number.isFinite(g.previousFrame.recorderOverheadMs),'4b: the frame before keeps its recorder overhead');assert.equal('recorderOverheadMs' in g.frame,false,'4b: the gap\'s own frame has none yet');
  r.steady(5);r.frame(600,{visibilityChanges:2});r.steady(5);assert.equal(r.file().worstGap.frameIntervalMs,250.5,'4: a 600 ms app switch is not kept');
  r.frame(1500);r.steady(5);assert.equal(r.file().worstGap.frameIntervalMs,1500,'4: a 1.5 s foreground freeze is kept');assert.equal(r.file().worstGap.inFrameSummary,false,'7: over 1 s: outside the frame summary');
  r.frame(60000);r.steady(5);assert.equal(r.file().worstGap.frameIntervalMs,1500,'4: 60 s is not');
  r.frame(59999.5);r.steady(5);assert.equal(r.file().worstGap.frameIntervalMs,59999.5,'4: just under 60 s is');}
{const r=recording({counted:false});r.steady(20);r.frame(1000);r.steady(5);assert.equal(r.file().worstGap,null,'4: without the count, 1 s is not kept');
  r.frame(999.5);r.steady(5);assert.equal(r.file().worstGap?.frameIntervalMs,999.5,'4: without the count, 999.5 ms is');assert.equal(maxInterval(r),999.5);}
{const h=recording();h.steady(20);h.frame(16.5,{hidden:true});h.frame(600,{hidden:true});h.frame(16.5);assert.equal(h.file().worstGap,null,'4: an interval between hidden frames is not kept');
  const v=recording();v.steady(20);v.frame(16.5,{hidden:true});v.frame(600);v.steady(5);assert.equal(v.file().worstGap,null,'4: hidden to visible is not kept');
  const w=recording();w.steady(20);w.frame(600,{hidden:true});w.steady(5);assert.equal(w.file().worstGap,null,'4: visible to hidden is not kept');}
// 5.
{const r=recording();r.steady(20);for(let i=0;i<120;i++)r.work(`gap-work.${i}`,2+i*2,1.5);r.frame(400);r.steady(1);
  const g=r.file().worstGap;assert.equal(g.workTruncated,true,'5: work of the gap was dropped: flagged');assert.equal(g.droppedWorkRows,24,'5: 24 rows dropped');assert.equal(g.workRowsOverlapping,96,'5: 96 kept rows overlap');assert.equal(g.mainThreadWork.length,30,'5: 30 exported');}
{const r=recording();for(let i=0;i<10;i++)r.work(`old.${i}`,1,1.2);r.steady(20);for(let i=0;i<96;i++)r.work(`gap-work.${i}`,2+i*2,1.5);r.frame(400);r.steady(1);
  const g=r.file().worstGap;assert.equal(g.droppedWorkRows,10,'5: the 10 older rows were dropped');assert.equal(g.workTruncated,false,'5: none of the gap\'s own: not flagged');assert.equal(g.workRowsOverlapping,96);}
// 6. (bounded with long stage names)
{const r=recording();r.steady(20);for(let i=0;i<96;i++)r.work(`maintenance.health.integrity-check-with-a-long-stage-name-${i}-${'x'.repeat(40)}`.slice(0,96),2+i*2,1.5);r.frame(400);r.steady(1);
  const size=JSON.stringify(r.file().worstGap).length;assert.ok(size<12000,`6: bounded (${size} bytes)`);}
// 4c.
{const r=recording();r.steady(20);r.frame(1500);assert.equal(r.file().worstGap?.unconfirmed,true,'4c/4d: before the next frame confirms it, exported unconfirmed');
  r.frame(16.5,{visibilityChanges:1});r.steady(5);assert.equal(r.file().worstGap,null,'4c: dropped when the count moved by the next frame');
  r.frame(1200);r.frame(16.5);assert.equal(r.file().worstGap?.frameIntervalMs,1200,'4c: kept when it did not');assert.equal('unconfirmed' in r.file().worstGap,false,'4d: confirmed: no longer marked');
  const m=recording();m.steady(20);m.frame(1500,{uncounted:true});m.steady(5);assert.equal(m.file().worstGap,null,'4c: 1.5 s ending on a frame with no count: the 1 s bound');
  m.frame(16.5,{uncounted:true});m.frame(1500);m.steady(5);assert.equal(m.file().worstGap,null,'4c: 1.5 s after a frame with no count: the 1 s bound (the count before it is not carried over it)');
  m.frame(600,{uncounted:true});m.steady(5);assert.equal(m.file().worstGap?.frameIntervalMs,600,'4c: under 1 s with no count: kept');
  m.frame(16.5,{uncounted:true});m.frame(700);m.steady(5);assert.equal(m.file().worstGap?.frameIntervalMs,700,'4c: under 1 s after a frame with no count: kept');
  m.frame(1500,{epochValue:null});m.steady(5);assert.equal(m.file().worstGap.frameIntervalMs,700,'4c: a count that is not a number (null) is no count');}
// 4d.
{const r=recording();r.steady(20);r.frame(400);r.frame(800);r.steady(2);assert.equal(r.file().worstGap.frameIntervalMs,800,'4d: a larger candidate in the next frame replaces the pending one');
  r.frame(1300);r.frame(16.5,{uncounted:true});r.steady(2);assert.equal(r.file().worstGap.frameIntervalMs,1300,'4d: confirmed by a frame without a count');
  r.frame(2000);diag.recorderStop(r.state,{},{});const g=r.file().worstGap;assert.equal(g.frameIntervalMs,2000,'4d: stopped before its confirmation: still exported');assert.equal(g.unconfirmed,true,'4d: marked unconfirmed');}
{const r=recording();r.steady(20);r.frame(1000);r.steady(1);const g=r.file().worstGap;assert.equal(g?.frameIntervalMs,1000,'7: exactly 1 s in the foreground: kept');assert.equal(g.inFrameSummary,false,'7: and outside the frame summary');}
// 5c. (the latest end among dropped rows, not the last dropped row's)
{const r=recording();r.steady(20);r.work('long-from-before',-50,60);r.work('short-before',-40,5);for(let i=0;i<96;i++)r.work(`gap-work.${i}`,12+i*2,1.5);r.frame(400);r.steady(1);
  const g=r.file().worstGap;assert.equal(g.droppedWorkRows,2);assert.equal(g.workTruncated,true,'5c: a dropped row that ended inside the gap flags it though a later-dropped one ended before');}
// 5b.
{const r=recording();r.steady(20);r.work('ended-at-gap-start',-5,5);for(let i=0;i<96;i++)r.work(`gap-work.${i}`,2+i*2,1.5);r.frame(400);r.steady(1);
  const g=r.file().worstGap;assert.equal(g.droppedWorkRows,1);assert.equal(g.workTruncated,false,'5b: a dropped row that ended where the gap began is not the gap\'s');}
{const r=recording();r.steady(20);r.work('straddles-gap-start',-5,10);for(let i=0;i<96;i++)r.work(`gap-work.${i}`,2+i*2,1.5);r.frame(400);r.steady(1);
  const g=r.file().worstGap;assert.equal(g.droppedWorkRows,1);assert.equal(g.workTruncated,true,'5b: one that ended inside the gap is (by its end)');}
// 7. (source)
{const app=require('node:fs').readFileSync(require('node:path').join(process.env.GH_TEST_SOURCE_DIR||require('node:path').resolve(__dirname,'..'),'WebApp','app.js'),'utf8');
  const calls=[...app.matchAll(/GH_DIAGNOSTICS\??\.recorderFrame\??\.?\(state,\{[^}]*\}/g)].map(m=>m[0]);assert.equal(calls.length,2,`7: two app frame samples (${calls.length})`);
  for(const call of calls)assert.match(call,/[{,]visibilityEpoch:autoDispatchVisibility,/,'7: each carries the visibility count');
  assert.match(app,/addEventListener\?\.\('visibilitychange',\(\)=>\{autoDispatchVisibility\+\+;/,'7: the visibilitychange listener moves it');}
console.log(JSON.stringify({suite:'build711-worst-gap-evidence',ok:true}));
