'use strict';
// Emulated phone (20k assets, 4x CPU, every company): after the replay table (build519), each decision still encoded
// the authorization proofs (sealed rows, up to 4,000, about 93K characters here) and the command records (newest first,
// at most 240, 32K characters) whole on every save. Both owners now register them as tracked collections. Proven with
// the real codec and transaction core, against a fresh codec (no cache) in its own realm, with each owner's writers:
//  1. proofs: a new proof unsealed in the draft (staging) then sealed (commit), and a compaction deleting the oldest:
//     each save encodes one or two segments of many, and its text equals a fresh encoding;
//  2. commands: record() inserts the newest first and keeps 240; each save encodes the first segment or two only;
//  3. every save decodes to the live collections through a fresh decoder; 4. both owners register them.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {harness}=require(path.join(ROOT,'tests/helpers/core-harness'));
const PROOFS=['authorization','proofsById'],COMMANDS=['domainRuntime','commands'];
const realm=(tracked=true)=>{const s=harness(['transaction-core','state-codec-core']).s;if(tracked){s.GH_STATE_CODEC.registerTrackedCollection(PROOFS,{rows:32});s.GH_STATE_CODEC.registerTrackedCollection(COMMANDS,{rows:32});}return s;};
const live=realm(),C=live.GH_STATE_CODEC,T=live.GH_TRANSACTION_CORE;
const proof=i=>({id:`PRF-${String(i).padStart(6,'0')}`,kind:'command',subject:`banking/decide-${i}`,signer:'owner',at:86400+i,digest:`sha256:${String(i).padStart(64,'0')}`,mandateId:'MND-1',lines:[{n:1,amount:i*10}]});
const command=i=>({id:`CMD-${String(i).padStart(9,'0')}`,domain:'banking',name:'decide',status:'committed',at:86400+i,completedAt:86400+i,actor:'owner',manual:true,systemAuthorized:false,executionClass:'player',approvalStatus:'approved',authorizationProofId:`PRF-${i}`});
const proofs={};for(let i=0;i<400;i++){const row=proof(i);assert.ok(T.sealValue(row));proofs[row.id]=row;}
const state={saveVersion:'3.0.0',saveRevision:1,authorization:{proofsById:proofs},domainRuntime:{commands:Array.from({length:240},(_,i)=>command(1000-i))},finance:{note:'x'}};
// domain-command-core record(): newest first, at most 240.
const record=row=>{const runtime=state.domainRuntime;runtime.commands.unshift(row);runtime.commands=runtime.commands.slice(0,240);};
const save=(codec=C,target=state)=>{const textChunks=[],steps=codec.serializeSteps(target,{textChunks});let step;while(!(step=steps.next()).done){}return {text:step.value,chunks:new Map(textChunks.map(c=>[c.id,c.text]))};};
const encoded=(codec=C)=>{const s=codec.cacheStats();return s.open+s.misses;};
const decoded=out=>{const s=realm(false),v=s.GH_STATE_CODEC.deserialize(out.text,{resolveChunk:id=>out.chunks.has(id)?new TextEncoder().encode(out.chunks.get(id)):null});return JSON.stringify([v.authorization.proofsById,v.domainRuntime.commands]);};
const resolved=out=>out.text.replace(/\{"\$ghText":"chunk-v1","id":"([^"]+)","bytes":\d+\}/g,(_,id)=>`<${out.chunks.get(id)}>`).replace(/"chunks":\[[^\]]*\]/,'"chunks":[#]');
const freshSave=()=>save(realm().GH_STATE_CODEC,JSON.parse(JSON.stringify(state)));
const step=(label,mutate)=>{const before=encoded();mutate();const out=save(),n=encoded()-before;
  assert.equal(decoded(out),JSON.stringify([state.authorization.proofsById,state.domainRuntime.commands]),`${label}: the save holds the live collections`);
  assert.equal(resolved(out),resolved(freshSave()),`${label}: the text equals a fresh encoding`);return [label,n];};
const first=save(),segments=encoded();assert.ok(segments>=15,`both collections are split (${segments} segments)`);
const head=JSON.parse(first.text);assert.equal(head.authorization.proofsById.$gh,3);assert.equal(head.domainRuntime.commands.$gh,3);
assert.equal(step('unchanged',()=>{})[1],0,'an unchanged save reuses every segment');
const rows=[];
// 1. A decision's proof: unsealed in the staging save, sealed at commit; and a compaction deleting the oldest.
rows.push(step('new proof (staging, unsealed)',()=>{proofs['PRF-NEW-1']=proof(5000);}));
rows.push(step('new proof (commit, sealed)',()=>{assert.ok(T.sealValue(proofs['PRF-NEW-1']));}));
rows.push(step('oldest proof compacted',()=>{delete proofs['PRF-000000'];}));
// 2. A decision's command record, twice (staging and commit save the same list).
rows.push(step('new command record',()=>record(command(2000))));
rows.push(step('another command record',()=>record(command(2001))));
for(const [label,n] of rows)assert.ok(n>=1&&n<=3,`${label}: ${n} of ${segments} segments encoded again`);
// Untracked, both fall under the codec's default bounds (save audit: a collection of 128-511 rows is split with segments
// of about 64 rows, state-codec MID_POLICY): fewer, larger segments than tracked.
{const s=realm(false),codec=s.GH_STATE_CODEC,copy=JSON.parse(JSON.stringify(state));for(const row of Object.values(copy.authorization.proofsById))s.GH_TRANSACTION_CORE.sealValue(row);
  save(codec,copy);const out=save(codec,copy),parsed=JSON.parse(out.text);for(const [name,untracked,tracked] of [['proofs',parsed.authorization.proofsById,head.authorization.proofsById],['commands',parsed.domainRuntime.commands,head.domainRuntime.commands]]){
    assert.equal(untracked.$gh,3,`untracked: the ${name} are split by the default bounds`);assert.ok(untracked.g.length<tracked.g.length,`untracked: fewer, larger ${name} segments than tracked (${untracked.g.length} against ${tracked.g.length})`);}}
// 4. The owners register them.
assert.match(fs.readFileSync(path.join(ROOT,'WebApp/authorization-core.js'),'utf8'),/registerTrackedCollection\?\.\(\['authorization','proofsById'\],\{rows:32\}\)/);
assert.match(fs.readFileSync(path.join(ROOT,'WebApp/domain-command-core.js'),'utf8'),/registerTrackedCollection\?\.\(\['domainRuntime','commands'\],\{rows:32\}\)/);
console.log(JSON.stringify({suite:'build523-proofs-commands-tracked',ok:true,segments,changes:rows}));
