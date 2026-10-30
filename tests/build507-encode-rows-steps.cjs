'use strict';
// Emulated-phone profile of decision commands (Chromium, 4x CPU): every decision held a 63-117 ms main-thread block in
// the sliced save, where one unsealed collection segment was encoded (encodeRows) inside a single step. encodeRows now
// runs as steps that yield every 64 rows; a sliced caller gives the frame back past its budget. Proven against the
// previous state-codec-core.js in an isolated process:
//  1. serialize() text, serializeSteps() text and every text chunk (ids and bytes) are identical;
//  2. the stepped serialization yields many more times over the same large segments (the old one held them in one step);
//  3. a deserialized round trip still restores the exact state.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {harness}=require(path.join(ROOT,'tests/helpers/core-harness'));
function run(){
  const {s}=harness(['state-codec-core']),C=s.GH_STATE_CODEC;
  const rows=n=>Array.from({length:n},(_,i)=>({id:'INV-'+i,number:'N-'+i,amount:1000+i*3.25,status:i%3?'open':'paid',counterparty:'Party '+(i%37),lines:[{sku:'S'+(i%11),qty:i%5+1}],note:i%7?null:'note '+i}));
  const state={saveVersion:'3.0.0',saveRevision:3,simSeconds:86400,finance:{invoices:rows(2600),payables:rows(700)},mobility:{vehicles:Array.from({length:900},(_,i)=>({id:'MV-'+i,name:'Car '+i,status:i%2?'idle':'busy',km:i*1.5}))},misc:{a:1}};
  const whole=C.serialize(state);
  const textChunks=[],steps=C.serializeSteps(state,{textChunks});let step,count=0;while(!(step=steps.next()).done)count++;
  const restored=C.deserialize(whole);
  // Chunk ids carry a per-process random nonce: compare them by position.
  let stepped=step.value;const ids=textChunks.map(c=>c.id);ids.forEach((id,i)=>{stepped=stepped.split(id).join(`#chunk${i}`);});
  const body=c=>c.text??(c.bytes?Buffer.from(c.bytes).toString('base64'):null);
  return {whole,stepped,chunks:textChunks.map((c,i)=>[`#chunk${i}`,body(c),c.count??null]),count,roundTrip:JSON.stringify(restored)===JSON.stringify(state)};
}
if(process.env.GH_ENCODE_STEPS_CHILD==='1'){process.stdout.write(JSON.stringify(run()));return;}
const current=JSON.parse(JSON.stringify(run()));
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'madar-encode-steps-old-'));let old;
try{
  fs.cpSync(path.join(ROOT,'WebApp'),path.join(tmp,'WebApp'),{recursive:true});fs.cpSync(path.join(ROOT,'tests'),path.join(tmp,'tests'),{recursive:true});
  const previous=execFileSync('git',['-C',process.env.GH_ENCODE_STEPS_GIT_DIR||ROOT,'show','5e2277d:WebApp/state-codec-core.js'],{encoding:'utf8',maxBuffer:32*1024*1024});
  assert.ok(!previous.includes('encodeRowsSteps'),'the baseline encodes a segment in one step');
  // The baseline runs with this source's text chunk threshold (tests/helpers/codec-baseline.cjs).
  fs.writeFileSync(path.join(tmp,'WebApp','state-codec-core.js'),require(path.join(ROOT,'tests/helpers/codec-baseline.cjs')).withCurrentTextChunkMin(previous,ROOT));
  old=JSON.parse(execFileSync(process.execPath,[__filename],{env:{...process.env,GH_TEST_SOURCE_DIR:tmp,GH_ENCODE_STEPS_CHILD:'1'},encoding:'utf8',maxBuffer:256*1024*1024}));
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
assert.equal(current.whole,old.whole,'serialize() text is identical');
assert.equal(current.stepped,old.stepped,'serializeSteps() text is identical');
assert.deepEqual(current.chunks,old.chunks,'every text chunk id and body is identical');
assert.equal(current.roundTrip,true,'the round trip restores the exact state');
assert.ok(current.count>=old.count+40,`the large segments are encoded across many steps: ${old.count} -> ${current.count}`);
console.log(JSON.stringify({suite:'build507-encode-rows-steps',ok:true,steps:{previous:old.count,current:current.count},chunks:current.chunks.length}));
