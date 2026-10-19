'use strict';
// Emulated phone (200,000 assets, 4x CPU, every company): a decision's schema validation ran 4 ms per frame and then
// waited for the next frame, so about 28 ms of checks took about 100 ms (validateBusyMs against validateMs). A durable
// command holds the lifecycle lock (no simulation slice or marker work shares its frames); its copy already takes up to
// 8 ms of each frame (DURABLE_CLONE_SLICE_MS) and its validation now takes the same. Proven with the real transaction
// core, a schema of 20 sections of 2 ms and a host that paints a 17 ms frame on each yield (210 -> 125 ms here):
//  1. a durable command validates in 5 slices (5 frames waited) instead of 10 (10 frames), each at most 8 ms plus one section,
//     and its wall time drops accordingly; the result is the same and is committed;
//  2. an invalid draft is still rejected after its last section and nothing is persisted;
//  3. a caller outside a durable command keeps 4 ms slices;
//  4. the app's own durable path (validateDraftInSlices) passes the same budget.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {harness}=require(path.join(ROOT,'tests/helpers/core-harness'));
const SECTIONS=20,SECTION_MS=2,FRAME_MS=17;
function world(){
  const {s}=harness(['transaction-core']),t=s.GH_TRANSACTION_CORE,clock={now:0},slices=[];
  s.performance={now:()=>clock.now};s.GH_FLEET_DATA={size:()=>0};
  s.GH_SAVE_SCHEMA={validate(){throw new Error('synchronous-validation-forbidden');},*validationSteps(draft){for(let i=0;i<SECTIONS;i++){clock.now+=SECTION_MS;yield 'section';}return {ok:!draft.invalid,errors:draft.invalid?['injected-invalid']:[]};}};
  s.GH_DIAGNOSTICS={recordMainThreadWork(_state,stage,start,end){if(stage==='command.schema'&&end>start)slices.push(end-start);}};
  return {s,t,clock,slices};
}
// 1 and 2. A durable command.
async function durable(invalid=false){
  const {t,clock,slices}=world(),live={saveRevision:1,cash:1};let yields=0,persisted=0;
  const run=t.executeDurable(live,{yieldToHost:async()=>{if(persisted)return;yields++;clock.now+=FRAME_MS;},apply:draft=>{draft.changed=true;if(invalid)draft.invalid=true;},persist:async()=>{persisted++;return {committed:true};}});
  if(invalid){await assert.rejects(run,/invalid-draft:injected-invalid/);return {yields,persisted,slices,live};}
  const result=await run,timing=t.telemetry().lastDurable;return {result,yields,persisted,slices,timing,live};
}
(async()=>{
  const ok=await durable();
  assert.equal(ok.result.committed,true,'1: the command commits');assert.equal(ok.live.changed,true);assert.equal(ok.persisted,1);
  assert.equal(ok.timing.validateBusyMs,SECTIONS*SECTION_MS,'1: the same checks');
  assert.equal(ok.slices.length,5,`1: five slices (${ok.slices})`);assert.equal(ok.yields,5,'1: five frames waited, not ten');
  assert.ok(ok.slices.every(ms=>ms<=8+SECTION_MS),`1: no slice past the budget by more than a section (${ok.slices})`);
  assert.ok(ok.timing.validateMs<=SECTIONS*SECTION_MS+5*FRAME_MS+1e-6,`1: wall ${ok.timing.validateMs} ms`);
  const bad=await durable(true);assert.equal(bad.persisted,0,'2: an invalid draft persists nothing');assert.equal(bad.live.changed,undefined,'2: and leaves the live state as it was');
  assert.equal(bad.slices.length,5,'2: it is rejected after its last section');
  // 3. Outside a durable command the default 4 ms slices are kept.
  {const {s,t,clock,slices}=world();let yields=0;const out=await t.validateSchemaInSlices({},{yieldToHost:async()=>{yields++;clock.now+=FRAME_MS;},onSlice:(a,b)=>{if(b>a)slices.push(b-a);}});
    assert.equal(out.ok,true);assert.equal(slices.length,10,`3: ten 4 ms slices (${slices})`);assert.equal(yields,10);assert.equal(s.GH_TRANSACTION_CORE.DURABLE_CLONE_SLICE_MS,8);}
  // 4. The app's durable path passes the same budget.
  assert.match(fs.readFileSync(path.join(ROOT,'WebApp/app.js'),'utf8'),/validateSchemaInSlices\(draft,\{yieldToHost:\(\)=>yieldForInteractivePaint\(document\.hidden\?0:80\),onFleetValidationWait,budgetMs:window\.GH_TRANSACTION_CORE\.DURABLE_CLONE_SLICE_MS\|\|4,/,'4: validateDraftInSlices takes the durable budget');
  console.log(JSON.stringify({suite:'build529-durable-validation-budget',ok:true,slices:ok.slices,yields:ok.yields,wallMs:ok.timing.validateMs}));
})().catch(error=>{console.error(error);process.exit(1);});
