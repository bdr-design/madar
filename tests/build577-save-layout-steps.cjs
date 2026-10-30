'use strict';
// iPhone diagnostic (build 95, 980,000 assets): every durable save held one 60-65 ms main-thread step. The fleet's extras
// map (75,963 members, never sealed) was listed and walked whole several times inside one generator step: the scan for
// collections, then the layout (comparison with the last save, segment bounds, parts). They now read the collection once
// and walk it in steps of 2,048 members. Proven against the previous state-codec-core.js (b6b2fd5) in an isolated process,
// on a 12,000-member sparse map, a 4,096-row array and a small map, through four saves (the first, an unchanged one, one
// after three members changed, one after a key was added and another removed):
//  1. serialize() text and serializeSteps() text (with text chunks, ids by position) are identical in every save, and a
//     deserialized round trip restores the state;
//  2. no step lists the large map more than once or reads more than 2 x 2,048 + 64 of its members (the previous codec
//     listed it several times and read it whole in one step: it fails this claim);
//  3. a save abandoned in the middle of its layout keeps nothing: the next full save of the changed state is the text a
//     fresh codec writes;
//  4. a member written between two layout steps is not served stale: the next save is the text a fresh codec writes;
//  5. a key deleted between two layout steps does not break the save: it is the text a fresh codec writes after it;
//  6. the same bounds hold with the large map as the last root (the scan reaches it after every other root);
//  7. the scan itself is bounded however the state is shaped: 300 small sealed nodes (12,000 keys, none a collection,
//     their text kept sealed) are read at most 2 x 2,048 + 64 keys a step (the previous codec read them in one step);
//  8. a save abandoned inside the scan, in the middle of a large sealed collection's check, keeps no answer for it: the next
//     save is a fresh codec's text and the save after it reads none of its members but the first (the id-run test);
//  9. arrays without ids, with repeated ids and a tracked collection are segmented as before (the save, encodeState and the
//     adoption of chunk ids at load share one rule): their text is the previous codec's.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {harness}=require(path.join(ROOT,'tests/helpers/core-harness'));
const LAYOUT_STEP=2048,BIG=12000;
function run(last=false){
  const codec=()=>{const C=harness(['state-codec-core']).s.GH_STATE_CODEC;C.registerTrackedCollection(['finance','tracked'],{rows:32});return C;},C=codec();
  const counts={listings:0,reads:0},member=i=>({id:`X-${i}`,routeId:`R${i%17}`,crew:i%5,note:i%9?null:`n${i}`});
  const target={};for(let i=0;i<BIG;i++)target[String(i*13)]=member(i);
  const extras=new Proxy(target,{ownKeys(t){counts.listings++;return Reflect.ownKeys(t);},get(t,k,r){if(typeof k==='string'&&Object.prototype.hasOwnProperty.call(t,k))counts.reads++;return Reflect.get(t,k,r);}});
  const rows=n=>Array.from({length:n},(_,i)=>({id:`INV-${i}`,amount:1000+i*3.25,status:i%3?'open':'paid'}));
  const plain=n=>Array.from({length:n},(_,i)=>({amount:i*2.5,kind:i%4?'debit':'credit'})),repeated=n=>Array.from({length:n},(_,i)=>({id:`T-${i%300}`,v:i}));
  const finance={invoices:rows(4096),ledger:plain(1500),transfers:repeated(700),tracked:rows(900)};
  const state=last?{saveVersion:'3.0.0',saveRevision:7,simSeconds:86400,finance,small:{a:{v:1},b:{v:2}},fleet:{extras}}:{saveVersion:'3.0.0',saveRevision:7,simSeconds:86400,fleet:{extras},finance,small:{a:{v:1},b:{v:2}}};
  const stepped=(c=C,abortWhen=null,onStep=null)=>{
    const textChunks=[],steps=c.serializeSteps(state,{textChunks});let step,maxListings=0,maxReads=0,count=0;
    for(;;){const before={...counts};step=steps.next();count++;const listings=counts.listings-before.listings,reads=counts.reads-before.reads;maxListings=Math.max(maxListings,listings);maxReads=Math.max(maxReads,reads);if(step.done)break;if(onStep?.(counts))break;if(abortWhen?.(counts)){steps.return();return null;}}
    if(!step.done){while(!(step=steps.next()).done){}}
    let text=step.value;textChunks.forEach((chunk,i)=>{text=text.split(chunk.id).join(`#chunk${i}`);});
    const body=chunk=>chunk.text??(chunk.bytes?Buffer.from(chunk.bytes).toString('base64'):null);
    return {text,chunks:textChunks.map((chunk,i)=>[`#chunk${i}`,body(chunk)]),maxListings,maxReads,steps:count};
  };
  const fresh=()=>codec().serialize(state);
  const saves=[];
  const save=label=>{const whole=C.serialize(state);const steps=stepped();saves.push({label,whole,stepped:steps.text,chunks:steps.chunks,maxListings:steps.maxListings,maxReads:steps.maxReads,roundTrip:JSON.stringify(C.deserialize(whole))===JSON.stringify(state)});};
  save('first');save('unchanged');
  for(const i of [5,6007,11990])target[String(i*13)]=member(i+100000);save('three members changed');
  target['999999']=member(999999);delete target['13'];save('one key added, one removed');
  // 3. Abandoned in the middle of the layout, then a member changes: the next save is a fresh codec's text.
  const start={...counts};stepped(C,c=>c.reads-start.reads>BIG+LAYOUT_STEP);target[String(100*13)]=member(424242);
  const afterAbandon=C.serialize(state)===fresh();
  // 4. A member written between two layout steps: this save finishes, the next one is a fresh codec's text.
  const mid={...counts};let written=false;stepped(C,null,c=>{if(!written&&c.reads-mid.reads>BIG+LAYOUT_STEP){target[String(200*13)]=member(434343);written=true;}return false;});
  const afterWrite=written&&C.serialize(state)===fresh();
  // 5. A key deleted between layout steps (a fleet write while the save yields): the layout reads the collection again,
  //    the save completes and is the text a fresh codec writes for the state after the deletion.
  const del={...counts};let deleted=false;const steps=C.serializeSteps(state);let step;
  while(!(step=steps.next()).done){if(!deleted&&counts.reads-del.reads>BIG+LAYOUT_STEP){delete target[String(11000*13)];deleted=true;}}
  const afterDelete=deleted&&step.value===fresh();
  return {saves,afterAbandon,afterWrite,afterDelete};
}
// 7, 8. The scan over many small sealed nodes, and a save abandoned inside it (a sealed collection's check), in a realm
// whose transaction core marks what the test seals (a sealed value's text is kept, so the next save reads only the scan).
// Member reads are counted (a Proxy's Object.isFrozen lists its keys, which a frozen object does not).
function scan(){
  const h=harness(['state-codec-core']),C=h.s.GH_STATE_CODEC,SEALED=new WeakSet();h.s.GH_TRANSACTION_CORE={isSealed:value=>SEALED.has(value)};
  const counts={reads:0,big:0},seal=value=>{Object.freeze(value);SEALED.add(value);return value;};
  const watch=(target,big=false)=>{const proxy=new Proxy(target,{get(t,k,r){if(typeof k==='string'&&k!=='length'&&Object.prototype.hasOwnProperty.call(t,k)){counts.reads++;if(big)counts.big++;}return Reflect.get(t,k,r);}});SEALED.add(proxy);return proxy;};
  const nodes={count:300};for(let i=0;i<300;i++){const node={};for(let j=0;j<40;j++)node[`f${j}`]=i*40+j;nodes[`n${i}`]=watch(seal(node));}
  const collection=()=>watch(seal(Array.from({length:6000},(_,i)=>seal({id:`B-${i}`,v:i}))),true);
  const state={saveVersion:'3.0.0',nodes:watch(seal(nodes)),sealed:{big:collection()}};
  const drive=(abortWhen=null)=>{const steps=C.serializeSteps(state);let step,maxReads=0;for(;;){const before=counts.reads;step=steps.next();maxReads=Math.max(maxReads,counts.reads-before);if(step.done)return {text:step.value,maxReads};if(abortWhen?.()){steps.return();return null;}}};
  drive();const second=drive();
  // 8. A sealed collection not yet answered: abandon a save inside its check (part of its members read), then save twice.
  state.sealed={big:collection()};const fromBig=counts.big;drive(()=>counts.big-fromBig>2100);const abandonedAt=counts.big-fromBig;
  const fresh=()=>{const other=harness(['state-codec-core']).s;other.GH_TRANSACTION_CORE={isSealed:value=>SEALED.has(value)};return other.GH_STATE_CODEC.serialize(state);};
  const afterScanAbandon=C.serialize(state)===fresh(),bigBefore=counts.big;C.serialize(state);
  return {secondMaxReads:second.maxReads,abandonedInside:abandonedAt>0&&abandonedAt<6000,afterScanAbandon,bigReadsAfter:counts.big-bigBefore};
}
const all=()=>({first:run(),last:run(true),scan:scan()});
if(process.env.GH_LAYOUT_STEPS_CHILD==='1'){process.stdout.write(JSON.stringify(all()));return;}
const now=JSON.parse(JSON.stringify(all())),current=now.first;
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'madar-layout-steps-old-'));let old,previousAll;
try{
  fs.cpSync(path.join(ROOT,'WebApp'),path.join(tmp,'WebApp'),{recursive:true});fs.cpSync(path.join(ROOT,'tests'),path.join(tmp,'tests'),{recursive:true});
  const previous=execFileSync('git',['-C',process.env.GH_LAYOUT_STEPS_GIT_DIR||ROOT,'show','b6b2fd5:WebApp/state-codec-core.js'],{encoding:'utf8',maxBuffer:32*1024*1024});
  assert.ok(!previous.includes('collectionLayoutSteps'),'the baseline lays a collection out in one step');
  // The baseline runs with this source's text chunk threshold (tests/helpers/codec-baseline.cjs).
  fs.writeFileSync(path.join(tmp,'WebApp','state-codec-core.js'),require(path.join(ROOT,'tests/helpers/codec-baseline.cjs')).withCurrentTextChunkMin(previous,ROOT));
  previousAll=JSON.parse(execFileSync(process.execPath,[__filename],{env:{...process.env,GH_TEST_SOURCE_DIR:tmp,GH_LAYOUT_STEPS_CHILD:'1'},encoding:'utf8',maxBuffer:512*1024*1024}));old=previousAll.first;
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
assert.equal(current.saves.length,4);
current.saves.forEach((save,i)=>{
  const before=old.saves[i];
  assert.equal(save.whole,before.whole,`${save.label}: serialize() text is identical`);
  assert.equal(save.stepped,before.stepped,`${save.label}: serializeSteps() text is identical`);
  assert.deepEqual(save.chunks,before.chunks,`${save.label}: every text chunk is identical`);
  assert.equal(save.roundTrip,true,`${save.label}: the round trip restores the state`);
  assert.ok(save.maxListings<=1,`${save.label}: one listing of the large map at most per step (${save.maxListings})`);
  assert.ok(save.maxReads<=2*LAYOUT_STEP+64,`${save.label}: a bounded walk per step (${save.maxReads} reads)`);
});
assert.ok(old.saves.some(save=>save.maxListings>1||save.maxReads>2*LAYOUT_STEP+64),'the previous codec walked the large map whole in one step');
now.last.saves.forEach((save,i)=>{
  const before=previousAll.last.saves[i];
  assert.equal(save.whole,before.whole,`last root, ${save.label}: serialize() text is identical`);assert.equal(save.stepped,before.stepped,`last root, ${save.label}: serializeSteps() text is identical`);
  assert.ok(save.maxListings<=1&&save.maxReads<=2*LAYOUT_STEP+64,`6: the large map as the last root, ${save.label}: ${save.maxListings} listings, ${save.maxReads} reads in a step`);
});
assert.ok(previousAll.last.saves.some(save=>save.maxListings>1||save.maxReads>2*LAYOUT_STEP+64),'6: the previous codec walked the large map whole in one step as the last root too');
assert.ok(now.scan.secondMaxReads<=2*LAYOUT_STEP+64,`7: the scan reads ${now.scan.secondMaxReads} keys at most in a step over 12,000 keys of small nodes`);
assert.ok(previousAll.scan.secondMaxReads>=12000,`7: the previous scan read them in one step (${previousAll.scan.secondMaxReads})`);
assert.equal(now.scan.afterScanAbandon,true,'8: a save abandoned inside the scan keeps nothing: the next save is a fresh codec\'s text');
assert.equal(now.scan.abandonedInside,true,'8: the save was abandoned inside the collection\'s check');
assert.ok(now.scan.bigReadsAfter<=1,`8: the sealed collection is answered once its check completes: the save after reads none of its members but the first (the id-run test, as before) (${now.scan.bigReadsAfter})`);
assert.equal(current.afterAbandon,true,'a save abandoned mid-layout keeps nothing');
assert.equal(current.afterWrite,true,'a member written between layout steps is not served stale');
assert.equal(current.afterDelete,true,'a key deleted between layout steps is read again: the save is the state after it');
console.log(JSON.stringify({suite:'build577-save-layout-steps',ok:true,scan:{now:now.scan.secondMaxReads,previous:previousAll.scan.secondMaxReads},current:current.saves.map(s=>({label:s.label,maxListings:s.maxListings,maxReads:s.maxReads})),previous:old.saves.map(s=>({label:s.label,maxListings:s.maxListings,maxReads:s.maxReads}))}));
