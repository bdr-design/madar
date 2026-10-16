'use strict';
const assert=require('node:assert/strict'),{harness}=require('./helpers/core-harness');
const {s}=harness(['transaction-core','state-codec-core']),C=s.GH_STATE_CODEC,results=[];
const state={saveVersion:'3.0.0',saveRevision:1,resetEpoch:0,simSeconds:0,fleet:s.GH_FLEET_STORE.create(0),finance:{invoices:Array.from({length:5000},(_,i)=>({id:'OPEN-'+i,amount:100+i,status:'open',detail:{reference:'REF-'+i,note:('وثيقة '+i+' ').repeat(20)}}))}};
const normalize=x=>JSON.parse(C.serialize(x)),chunkBytes=(out,chunk)=>chunk.text?new TextEncoder().encode(chunk.text):new Uint8Array(state.fleet.rows,chunk.byteOffset,chunk.byteLength).slice();
const vault=new Map();let current;
function save(){const out=C.serializeChunked(state);for(const chunk of out.chunks){const bytes=chunkBytes(out,chunk),old=vault.get(chunk.id);if(old)assert.deepEqual(Buffer.from(bytes),Buffer.from(old),'an id cannot name changed content');else vault.set(chunk.id,bytes);}assert.deepEqual(JSON.parse(C.serialize(C.deserialize(out.text,{resolveChunk:id=>vault.get(id)}))),normalize(state));current=out;return out;}
function test(name,fn){try{results.push({name,ok:true,detail:fn()});}catch(error){results.push({name,ok:false,error:String(error.stack||error)});}}
test('mutable collections use existing chunk-v1 format and self-contained exports stay unchanged',()=>{
 const full=C.serialize(state),out=save();assert.ok(out.chunks.some(c=>c.id.includes('.o.')),'mutable collection chunks are required');assert.ok(out.text.length<full.length/5);assert.equal(JSON.parse(out.text).stateCodec.version,'gh-shape-4');assert.equal(full,JSON.stringify(C.encodeState(state)));assert.ok(!full.includes('$ghText'));
 return {fullChars:full.length,manifestChars:out.text.length,openChunks:out.chunks.filter(c=>c.id.includes('.o.')).length};
});
test('an unchanged collection reuses all ids after checking exact serialized content',()=>{const before=current.chunks.map(c=>c.id),out=save();assert.deepEqual(out.chunks.map(c=>c.id),before);});
test('an in-place nested edit bypassing transaction stamps changes only its own part',()=>{
 const before=new Set(current.chunks.map(c=>c.id));state.finance.invoices[2000].detail.note+=' changed';const out=save(),changed=out.chunks.filter(c=>!before.has(c.id));assert.equal(changed.length,1);return {changedChunks:changed.length};
});
test('deletion, insertion and reorder cannot reuse stale collection bytes',()=>{
 state.finance.invoices.splice(2500,1);save();state.finance.invoices.splice(1300,0,{id:'OPEN-new',amount:999,status:'open',detail:{note:'جديد'.repeat(100)}});save();state.finance.invoices.reverse();save();
});
test('reboot adopts mutable ids only after an exact text comparison',()=>{
 const h=harness(['transaction-core','state-codec-core']),codec=h.s.GH_STATE_CODEC,decoded=codec.deserialize(current.text,{resolveChunk:id=>vault.get(id)});codec.adoptChunkIds(decoded.fleet,JSON.parse(current.text).fleet.rows);
 const out=codec.serializeChunked(decoded),old=new Set(current.chunks.map(c=>c.id));assert.ok(out.chunks.filter(c=>c.id.includes('.o.')).every(c=>old.has(c.id)));assert.ok(codec.cacheStats().openChunks.adopted>0);
});
test('missing, unlisted or malformed parts fail; cache has a fixed text budget',()=>{
 const ids=current.chunks.filter(c=>c.id.includes('.o.')).map(c=>c.id);assert.throws(()=>C.deserialize(current.text,{resolveChunk:id=>id===ids[0]?undefined:vault.get(id)}),/chunk/);
 const unlisted=JSON.parse(current.text);unlisted.stateCodec.chunks=unlisted.stateCodec.chunks.filter(id=>id!==ids[0]);assert.throws(()=>C.decodeState(unlisted,{resolveChunk:id=>vault.get(id)}),/unlisted/);
 const stats=C.cacheStats().openChunks;assert.ok(stats.chars<=stats.limitChars);return stats;
});
test('a nonsegmented mutable collection also uses the same reversible format',()=>{
 const small={fleet:s.GH_FLEET_STORE.create(0),items:Array.from({length:80},(_,i)=>({id:'SMALL-'+i,note:('فتح '+i+' ').repeat(80)}))},out=C.serializeChunked(small),chunks=new Map(out.chunks.map(c=>[c.id,c.text?new TextEncoder().encode(c.text):new Uint8Array(small.fleet.rows,c.byteOffset,c.byteLength)]));
 assert.equal(JSON.parse(out.text).items.$ghText,'chunk-v1');assert.equal(C.serialize(C.deserialize(out.text,{resolveChunk:id=>chunks.get(id)})),C.serialize(small));
});
test('collections beyond the cache budget stay inline without churning uploaded identities',()=>{
 state.more=Array.from({length:15000},(_,i)=>({id:'MORE-'+i,note:('وثيقة طويلة '+i+' ').repeat(24)}));save();
 for(let repeat=0;repeat<2;repeat++){const before=current.chunks.map(c=>c.id);save();const next=new Set(current.chunks.map(c=>c.id));assert.ok(before.every(id=>next.has(id)),'unchanged cached parts must not be renamed as the cache fills');}
 const stats=C.cacheStats().openChunks;assert.ok(stats.chars<=stats.limitChars);assert.ok(stats.declined>0);return {chars:stats.chars,limitChars:stats.limitChars,declined:stats.declined};
});
console.log(JSON.stringify({suite:'build389-differential-collections',passed:results.filter(x=>x.ok).length,total:results.length,results},null,2));if(results.some(x=>!x.ok))process.exitCode=1;
