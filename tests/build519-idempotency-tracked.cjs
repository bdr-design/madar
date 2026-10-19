'use strict';
// Emulated-phone study (20k assets, 4x CPU, the first decision after play in each of the eleven companies): every
// decision encoded domainRuntime.idempotency whole twice (staging and commit, ~500K characters, 110-160 ms each): under
// 512 rows, so one segment, and a new receipt changes it. Its rows are inserted or replaced whole and sealed, so the
// command owner registers it as a tracked collection. Proven here with the real codec and transaction core, against a
// fresh codec (no cache) in its own realm:
//  1. a decision's new receipt, unsealed in the draft (staging) and then sealed (commit): each save encodes only the
//     segment holding it, and the text equals a fresh encoding;
//  2. pruning the oldest receipt and replacing one whole (archiving): only the segments holding them are encoded;
//  3. every save decodes to the live table through a fresh decoder;
//  4. untracked, the same receipt makes the save encode the whole table again (the cost removed);
//  5. the command owner registers the table.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {harness}=require(path.join(ROOT,'tests/helpers/core-harness'));
const PATH=['domainRuntime','idempotency'],realm=(tracked=true)=>{const s=harness(['transaction-core','state-codec-core']).s;if(tracked)s.GH_STATE_CODEC.registerTrackedCollection(PATH,{rows:32});return s;};
const live=realm(),C=live.GH_STATE_CODEC,T=live.GH_TRANSACTION_CORE;
const receipt=i=>({at:86400+i,fingerprint:`v2:sha256:${String(i).padStart(64,'0')}`,fingerprintVersion:2,permanent:i%3===0,result:{ok:true,commandId:`CMD-${i}`,authorizationProofId:`PRF-${i}`,result:{status:'committed',reference:`REF-${i}`,lines:Array.from({length:12},(_,n)=>({n,amount:i*10+n,note:`سطر ${n} من القرار ${i}`}))}}});
const table={};for(let i=0;i<450;i++){const row=receipt(i);assert.ok(T.sealValue(row));table[`banking:decide:KEY-${i}`]=row;}
const state={saveVersion:'3.0.0',saveRevision:1,domainRuntime:{schema:'x',idempotency:table},finance:{note:'x'}};
const save=(codec=C,target=state)=>{const textChunks=[],steps=codec.serializeSteps(target,{textChunks});let step;while(!(step=steps.next()).done){}return {text:step.value,chunks:new Map(textChunks.map(c=>[c.id,c.text]))};};
const encodedSoFar=(codec=C)=>{const s=codec.cacheStats();return s.open+s.misses;};
const decoded=out=>{const s=realm(false);return JSON.stringify(s.GH_STATE_CODEC.deserialize(out.text,{resolveChunk:id=>out.chunks.has(id)?new TextEncoder().encode(out.chunks.get(id)):null}).domainRuntime.idempotency);};
const resolved=out=>out.text.replace(/\{"\$ghText":"chunk-v1","id":"([^"]+)","bytes":\d+\}/g,(_,id)=>`<${out.chunks.get(id)}>`).replace(/"chunks":\[[^\]]*\]/,'"chunks":[#]');
const freshSave=()=>save(realm().GH_STATE_CODEC,JSON.parse(JSON.stringify(state)));
const step=(label,mutate)=>{const before=encodedSoFar();mutate();const out=save(),encoded=encodedSoFar()-before;
  assert.equal(decoded(out),JSON.stringify(state.domainRuntime.idempotency),`${label}: the save holds the live table`);
  assert.equal(resolved(out),resolved(freshSave()),`${label}: the text equals a fresh encoding`);return {label,encoded,out};};
// First save encodes every segment; the table is split into small segments.
const first=save(),segments=encodedSoFar();assert.ok(segments>=8,`the table is split (${segments} segments)`);
assert.equal(JSON.parse(first.text).domainRuntime.idempotency.$gh,3,'saved as segments (the existing $gh:3 format)');
assert.equal(step('unchanged',()=>{}).encoded,0,'an unchanged table reuses every segment');
// 1. A decision: the new receipt is unsealed in the staging save, sealed at commit.
const rows=[];
rows.push(step('new receipt (staging, unsealed)',()=>{table['facilities:hire:KEY-NEW']=receipt(9000);}));
rows.push(step('new receipt (commit, sealed)',()=>{assert.ok(T.sealValue(table['facilities:hire:KEY-NEW']));}));
// 2. Pruning and archiving replace rows whole.
rows.push(step('oldest pruned',()=>{delete table['banking:decide:KEY-0'];}));
rows.push(step('one archived',()=>{const key='banking:decide:KEY-300',row=table[key],next={...row,result:{ok:true,commandId:row.result.commandId,archived:true}};T.sealValue(next);table[key]=next;}));
for(const row of rows)assert.ok(row.encoded>=1&&row.encoded<=2,`${row.label}: ${row.encoded} of ${segments} segments encoded again`);
// Sealed rows cannot be edited in place, so a write that is not a whole replacement cannot be missed.
assert.throws(()=>{table['banking:decide:KEY-5'].result.ok=false;},TypeError);
// 4. Untracked: the same new receipt re-encodes the whole table (one segment, every row).
{const s=realm(false),codec=s.GH_STATE_CODEC,copy=JSON.parse(JSON.stringify(state));for(const row of Object.values(copy.domainRuntime.idempotency))s.GH_TRANSACTION_CORE.sealValue(row);
  save(codec,copy);const before=codec.cacheStats().misses+codec.cacheStats().open;copy.domainRuntime.idempotency['x:y:NEW']=receipt(9001);const out=save(codec,copy);
  assert.equal(codec.cacheStats().misses+codec.cacheStats().open-before,1,'untracked: one encoding');assert.notEqual(JSON.parse(out.text).domainRuntime.idempotency.$gh,3,'untracked: the table is one segment, encoded whole');}
// 5. The command owner registers the table.
assert.match(fs.readFileSync(path.join(ROOT,'WebApp/domain-command-core.js'),'utf8'),/registerTrackedCollection\?\.\(\['domainRuntime','idempotency'\],\{rows:32\}\)/);
console.log(JSON.stringify({suite:'build519-idempotency-tracked',ok:true,segments,changes:rows.map(r=>[r.label,r.encoded])}));
