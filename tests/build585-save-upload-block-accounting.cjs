'use strict';
// iPhone diagnostic (build 95) review: a durable chunked save's maxBusySliceMs missed the longest main-thread block it
// ran. The codec's last steps return without a yield to a frame, and so does each text chunk's UTF-8 encode that fits
// one piece; each was measured alone, so the block they make together (the envelope join, then tens of encodes) never
// appeared in the figure, and a lower figure on the device proved nothing. persistence-core now carries the time since
// the last yield across them (accounting only). A real durable chunked save (the real codec and persistence owners, a
// stand-in native vault, open finance documents that become text chunks) runs on a clock the test moves (each codec step
// 0 ms, its last step 9 ms, each UTF-8 encode 1 ms, each yield to a frame 100 ms), on this source and on the source
// before this change (git, in its own tree), each in its own process:
//  1. maxBusySliceMs is the longest run of work between two yields, measured from the clock itself (the previous source
//     reported less than that run);
//  2. nothing else changes: the same yields at the same points, the same busy total, the same chunks uploaded with the
//     same bytes, the same committed text (the session's random chunk-id prefix aside, in its hash and in its length: the
//     prefix's length varies from session to session, and three runs in four failed on it when its length differed);
//  3. a save with nothing to upload reports its longest run too (the envelope encode continues the codec's last step;
//     the previous source reported that step alone).
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..'),PREVIOUS='87b678f';
if(process.argv[2]==='--measure'){
  process.env.GH_TEST_SOURCE_DIR=process.argv[3];
  const {scenario}=require(path.join(process.argv[3],'tests/helpers/business-scenario'));
  (async()=>{
    const e=scenario(),s=e.s,state=e.state;e.load('migration-core');e.load('state-codec-core');e.load('persistence-core');
    if(s.GH_FLEET_DATA.mode(state)!=='store')s.GH_MIGRATION_CORE.migrateFleet(state);
    if(!s.crypto?.subtle)s.crypto=crypto.webcrypto;
    // Open documents (never sealed): the codec writes their segments as text chunks of one UTF-8 piece each.
    state.finance.invoices=Array.from({length:3000},(_,i)=>({id:`OPEN-${i}`,company:'group',amount:100+i,status:'open',detail:{reference:`REF-${i}`,note:`وثيقة ${i} `.repeat(12)}}));
    let clock=0,work=0,maxRun=0,nonce='';const yields=[],uploads=[],commits=[],runs=[];
    s.performance={now:()=>clock};
    const Encoder=s.TextEncoder;s.TextEncoder=class extends Encoder{encode(text){clock+=1;work+=1;return super.encode(text);}};
    const original=s.GH_STATE_CODEC;s.GH_STATE_CODEC={...original,serializeChunkedSteps:function*(...args){const steps=original.serializeChunkedSteps(...args);let step,input;for(;;){step=steps.next(input);if(step.done)break;input=yield step.value;}clock+=9;work+=9;return step.value;}};
    // A native reply, a digest and a yield to a frame each end the page's task: the runs of work are counted between them.
    let since=0;const boundary=()=>{const run=work-since;maxRun=Math.max(maxRun,run);if(run)trace.push(run);since=work;},trace=[];
    const deliver=(name,detail)=>setTimeout(()=>{boundary();s.dispatchEvent(new s.CustomEvent(name,{detail}));},0);
    const subtle=s.crypto.subtle,digest=subtle.digest.bind(subtle);s.crypto={...s.crypto,subtle:Object.assign(Object.create(subtle),{digest:(...args)=>digest(...args).then(value=>{boundary();return value;})}),getRandomValues:s.crypto.getRandomValues?.bind(s.crypto)};
    s.webkit={messageHandlers:{saveBridge:{postMessage(m){
      if(m.action==='storeSaveChunk'){nonce=nonce||String(m.id).split('.')[0];uploads.push({id:String(m.id).split(nonce).join('N'),sha:crypto.createHash('sha256').update(Buffer.from(m.base64,'base64')).digest('hex')});return deliver('gh-native-chunk-ack',{requestId:m.requestId,id:m.id,success:true});}
      if(m.action==='commitSave'){{const text=nonce?String(m.saveJSON).split(nonce).join('N'):String(m.saveJSON);commits.push({sha:crypto.createHash('sha256').update(text).digest('hex'),bytes:Buffer.byteLength(text)});}return deliver('gh-native-save-ack',{requestId:m.requestId,action:m.action,saveRevision:m.saveRevision,resetEpoch:m.resetEpoch,saveSchemaVersion:m.saveSchemaVersion,saveHash:m.saveHash,success:true,generation:commits.length});}
    }}}};s.GH_NATIVE_BUILD=358;s.GH_CONTROL_PLANE=s.GH_CONTROL_PLANE||{};
    const save=async()=>{work=0;maxRun=0;since=0;trace.length=0;
      await s.GH_PERSISTENCE.commitDurableState(state,{yieldToFrame:async()=>{boundary();yields.push(work);clock+=100;},prevalidated:true});boundary();
      const t=s.GH_PERSISTENCE.telemetry().timings.samples.filter(r=>r.kind==='durable-save').at(-1);runs.push({ok:t.ok,maxBusySliceMs:t.maxBusySliceMs,busyMs:t.totalSyncMs,stringifyMs:t.stringifyMs,slices:t.slices,maxRun,trace:trace.slice(),yields:yields.splice(0),uploads:uploads.splice(0),commit:commits.at(-1)});};
    await save();
    // 3. Nothing new to upload: the same document set, saved again.
    await save();
    process.stdout.write(JSON.stringify(runs));
  })().catch(error=>{console.error(error);process.exit(1);});
  return;
}
const measure=tree=>JSON.parse(execFileSync(process.execPath,[__filename,'--measure',tree],{encoding:'utf8',maxBuffer:1<<27}));
const before=fs.mkdtempSync(path.join(os.tmpdir(),'gh-b585-'));
try{
  const archive=path.join(before,'previous.tar');execFileSync('git',['-C',process.env.GH_B585_GIT_DIR||ROOT,'archive','-o',archive,PREVIOUS,'WebApp','tests/helpers']);execFileSync('tar',['-xf',archive,'-C',before]);fs.rmSync(archive);
  // The previous source carries the game's present name (tests/helpers/brand-baseline.cjs).
  require(path.join(ROOT,'tests/helpers/brand-baseline.cjs')).brandBaseline(before,ROOT);
  // The previous source runs with this source's text chunk threshold (tests/helpers/codec-baseline.cjs).
  {const codec=path.join(before,'WebApp','state-codec-core.js');fs.writeFileSync(codec,require(path.join(ROOT,'tests/helpers/codec-baseline.cjs')).withCurrentTextChunkMin(fs.readFileSync(codec,'utf8'),ROOT));}
  const [oldFirst,oldSecond]=measure(before),[first,second]=measure(ROOT);
  assert.ok(oldFirst.ok&&first.ok&&oldSecond.ok&&second.ok,'every save commits');
  assert.ok(first.uploads.length>=3,`text chunks are uploaded (${first.uploads.length})`);
  // 1.
  assert.equal(first.maxBusySliceMs,first.maxRun,`1: maxBusySliceMs is the longest run between two yields (${first.maxBusySliceMs} ms, the clock shows ${first.maxRun} ms)`);
  assert.ok(oldFirst.maxBusySliceMs<oldFirst.maxRun,`the previous source reported less than that run (${oldFirst.maxBusySliceMs} ms of ${oldFirst.maxRun} ms)`);
  assert.equal(first.maxRun,oldFirst.maxRun,'the same run on both sources');
  // 2.
  assert.deepEqual(first.yields,oldFirst.yields,'2: the same yields at the same points');
  assert.equal(first.busyMs,oldFirst.busyMs,'2: the same busy total');assert.equal(first.stringifyMs,oldFirst.stringifyMs);assert.equal(first.slices,oldFirst.slices);
  assert.deepEqual(first.uploads,oldFirst.uploads,'2: the same chunks with the same bytes');
  assert.deepEqual(first.commit,oldFirst.commit,'2: the same committed text and hash');
  // 3.
  assert.equal(second.uploads.length,0,'3: nothing new to upload');assert.deepEqual(second.yields,oldSecond.yields);
  assert.equal(second.maxBusySliceMs,second.maxRun,'3: the figure is the longest run');assert.ok(oldSecond.maxBusySliceMs<oldSecond.maxRun);assert.deepEqual(second.commit,oldSecond.commit);
  console.log(JSON.stringify({suite:'build585-save-upload-block-accounting',ok:true,uploads:first.uploads.length,maxBusySliceMs:{previous:oldFirst.maxBusySliceMs,current:first.maxBusySliceMs,longestRun:first.maxRun},noUpload:{previous:oldSecond.maxBusySliceMs,current:second.maxBusySliceMs,longestRun:second.maxRun},yields:first.yields.length}));
}finally{fs.rmSync(before,{recursive:true,force:true});}
