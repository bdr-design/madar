'use strict';
// Large-world study (977k assets, a Mobility fleet, 4x CPU): Mobility's vehicles and drivers, mutable rows of which
// 0.2-1.4% changed between two decisions while playing, were encoded afresh by every save. Their owner registers them as
// tracked collections: small segments, a segment reused when its members are the same objects holding the same top-level
// values, nested objects sealed so an edit inside one throws instead of being missed. Proven here with the real codec and
// transaction core, against a fresh codec (no cache) in its own realm:
//  1. a save whose rows did not change reuses every tracked segment, and its text equals a fresh encoding;
//  2. a primitive write, a nested object replaced, a key added, a row appended or removed: only the segments holding
//     them are encoded again, and every save's state equals the live state through a fresh decoder;
//  3. an edit inside a nested object throws (strict code), so it cannot be missed;
//  4. tracked segments are chunks at any size: the header carries their references, an unchanged one keeps its id;
//  5. Mobility registers its vehicles and drivers.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {harness}=require(path.join(ROOT,'tests/helpers/core-harness'));
const live=harness(['transaction-core','state-codec-core']).s,fresh=()=>harness(['transaction-core','state-codec-core']).s;
const C=live.GH_STATE_CODEC;C.registerTrackedCollection(['mobility','vehicles'],{rows:32});C.registerTrackedCollection(['mobility','drivers'],{rows:64});
const vehicle=i=>({id:`MOB-V-${String(i).padStart(6,'0')}`,ownerCompanyId:'mobility',assetClass:'eco-ev',name:`GH Go Electric · Tesla Model 3 ${i}`,status:i%4?'available':'moving',battery:40+i%60,zoneId:`Z${i%12}`,tripId:i%4?null:`TRIP-${i}`,totalTrips:i%97,totalKm:i*1.25,staffing:{mode:'automatic-fixed',roles:[{id:'mobility-driver',count:1,monthlyPayroll:6000}],employmentContractId:`EMP-${i%5}`}});
const state={saveVersion:'3.0.0',saveRevision:1,mobility:{vehicles:Array.from({length:3000},(_,i)=>vehicle(i)),drivers:Array.from({length:3000},(_,i)=>({id:`DRV-${i}`,status:'online',zoneId:`Z${i%12}`,tripId:null,assetId:`MOB-V-${i}`}))},finance:{note:'x'}};
const save=()=>{const textChunks=[],steps=C.serializeSteps(state,{textChunks});let step;while(!(step=steps.next()).done){}return {text:step.value,chunks:new Map(textChunks.map(c=>[c.id,c.text]))};};
const stats=()=>({...C.cacheStats().tracked});
const decoded=out=>{const s=fresh();return JSON.stringify(s.GH_STATE_CODEC.deserialize(out.text,{resolveChunk:id=>out.chunks.has(id)?new TextEncoder().encode(out.chunks.get(id)):null}).mobility);};
const freshSave=()=>{const s=fresh();s.GH_STATE_CODEC.registerTrackedCollection(['mobility','vehicles'],{rows:32});s.GH_STATE_CODEC.registerTrackedCollection(['mobility','drivers'],{rows:64});const copy=JSON.parse(JSON.stringify(state)),textChunks=[],steps=s.GH_STATE_CODEC.serializeSteps(copy,{textChunks});let step;while(!(step=steps.next()).done){}return {text:step.value,chunks:new Map(textChunks.map(c=>[c.id,c.text]))};};
// Chunk ids carry a per-codec nonce and sequence: every reference is replaced by the chunk's own text.
const resolved=out=>out.text.replace(/\{"\$ghText":"chunk-v1","id":"([^"]+)","bytes":\d+\}/g,(_,id)=>`<${out.chunks.get(id)}>`).replace(/"chunks":\[[^\]]*\]/,'"chunks":[#]');
const step=(label,mutate,expect)=>{const before=stats();mutate();const out=save(),after=stats();const encoded=after.encoded-before.encoded;
  assert.equal(decoded(out),JSON.stringify(state.mobility),`${label}: the save holds the live state`);assert.equal(resolved(out),resolved(freshSave()),`${label}: the text equals a fresh encoding`);
  if(expect!=null)assert.equal(encoded,expect,`${label}: ${encoded} segments encoded again`);return {label,encoded,reused:after.reused-before.reused,out};};
// 1. First save encodes, the second reuses all.
const first=save(),initial=stats();assert.ok(initial.encoded>100&&initial.reused===0,'the first save encodes every tracked segment');
const segments=initial.encoded,same=step('unchanged',()=>{},0);assert.equal(same.reused,segments,'every tracked segment is reused');
// 4. Chunks at any size: references only, unchanged ids.
{const head=JSON.parse(same.out.text),inline=['vehicles','drivers'].flatMap(k=>head.mobility[k].g.filter(part=>!(part&&part.$ghText)));assert.ok(inline.every(part=>JSON.stringify(part).length<512),'a tracked segment stays in the header only when it is under 512 characters');assert.ok(head.mobility.vehicles.g.length+head.mobility.drivers.g.length-inline.length>=segments*0.9,'the tracked segments are chunk references');}
assert.deepEqual([...same.out.chunks.keys()].sort(),[...first.chunks.keys()].sort(),'unchanged segments keep their chunk ids');
assert.ok(same.out.text.length<60000,`the header holds references, not the rows (${same.out.text.length} chars)`);
// 2. Each kind of change re-encodes only what holds it.
const rows=[];
rows.push(step('primitive writes in 3 vehicles',()=>{for(const i of [5,1500,2999])state.mobility.vehicles[i].battery=1;},3));
rows.push(step('driver status',()=>{state.mobility.drivers[42].status='on-trip';},1));
rows.push(step('nested object replaced',()=>{const v=state.mobility.vehicles[700];v.staffing={...v.staffing,employmentContractId:'EMP-NEW'};},1));
rows.push(step('key added',()=>{state.mobility.vehicles[901].lastServiceAt=86400;},1));
rows.push(step('row appended',()=>{state.mobility.vehicles.push(vehicle(3000));},null));
rows.push(step('row removed',()=>{state.mobility.vehicles.splice(1200,1);},null));
for(const row of rows.slice(-2))assert.ok(row.encoded<=3,`${row.label}: ${row.encoded} segments encoded again`);
// 3. An edit inside a nested object throws.
assert.throws(()=>{state.mobility.vehicles[10].staffing.employmentContractId='X';},TypeError,'a nested edit cannot be missed');
assert.throws(()=>{state.mobility.vehicles[10].staffing.roles[0].count=2;},TypeError);
// 5. Mobility registers its collections.
const mobility=fs.readFileSync(path.join(ROOT,'WebApp/mobility-core.js'),'utf8');
assert.match(mobility,/registerTrackedCollection\?\.\(\['mobility','vehicles'\],\{rows:32\}\)/);assert.match(mobility,/registerTrackedCollection\?\.\(\['mobility','drivers'\],\{rows:64\}\)/);
console.log(JSON.stringify({suite:'build516-tracked-collections',ok:true,segments,changes:rows.map(r=>[r.label,r.encoded])}));
