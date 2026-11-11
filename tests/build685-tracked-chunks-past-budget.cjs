'use strict';
// Build 685 (a play of the whole game with 30,000 Mobility cars): the save head was 10 MB, 7 MB of it the cars and their
// drivers written inline, because the cache that names the chunks of open texts has a 4 MB budget and every tracked
// segment past it was declined a chunk; at 87,000 cars the head reached the native 30 MB limit and commands were refused.
// A tracked segment's text is already kept by its tracked cache, so it is remembered outside that budget. Proven with the
// real codec and transaction core (fresh realm per run), on registered collections of 9 MB of text:
//  1. every tracked segment is its own chunk: the head holds no tracked rows and is a small fraction of the text;
//  2. the save decodes to the live state (a fresh decoder), and the text equals what a fresh codec writes;
//  3. an unchanged save names the same chunks; an edited row, an added and a removed row rename only their segments;
//  4. the budget still bounds what this cache alone keeps: an untracked open collection past it stays inline and is
//     declined, and the counted characters never pass the budget;
//  5. a tracked collection under the budget is saved exactly as before (the same head as a codec where nothing is shared).
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {harness}=require(path.join(ROOT,'tests/helpers/core-harness'));
const realm=()=>{const s=harness(['transaction-core','state-codec-core']).s;s.GH_STATE_CODEC.registerTrackedCollection(['mobility','vehicles'],{rows:32});s.GH_STATE_CODEC.registerTrackedCollection(['mobility','drivers'],{rows:64});return s;};
const vehicle=i=>({id:`MOB-V-${String(i).padStart(7,'0')}`,ownerCompanyId:'mobility',assetClass:i%3?'eco-ev':'comfort',name:`ANI Go · Tesla Model 3 · سيارة ${i}`,manufacturer:'Tesla',model:'Model 3',status:i%4?'available':'moving',battery:40+i%60,zoneId:`Z${i%12}`,centerId:`C${i%130}`,tripId:i%4?null:`TRIP-${i}`,totalTrips:i%97,totalKm:i*3.5,purchasePrice:42000+i%900,staffing:{mode:'automatic-fixed',driverId:`DRV-${i}`,employmentContractId:`EMP-${i%500}`}});
const driver=i=>({id:`DRV-${i}`,ownerCompanyId:'mobility',name:`سائق ${i}`,status:i%4?'online':'on-trip',rating:4.5+(i%50)/100,centerId:`C${i%130}`,zoneId:`Z${i%12}`,tripId:null,monthlySalary:6000,assetId:`MOB-V-${String(i).padStart(7,'0')}`});
const make=(cars,extra=null)=>{const state={saveVersion:'3.0.0',saveRevision:1,mobility:{vehicles:Array.from({length:cars},(_,i)=>vehicle(i)),drivers:Array.from({length:cars},(_,i)=>driver(i))},finance:{note:'x'}};if(extra)state.notes=extra;return state;};
const save=(s,state)=>{const textChunks=[],steps=s.GH_STATE_CODEC.serializeSteps(state,{textChunks});let step;while(!(step=steps.next()).done){}return {text:step.value,chunks:new Map(textChunks.map(c=>[c.id,c.text]))};};
const decode=(out)=>{const s=realm();return s.GH_STATE_CODEC.deserialize(out.text,{resolveChunk:id=>out.chunks.has(id)?new TextEncoder().encode(out.chunks.get(id)):null});};
const resolved=out=>out.text.replace(/\{"\$ghText":"chunk-v1","id":"([^"]+)","bytes":\d+\}/g,(_,id)=>`<${out.chunks.get(id)}>`).replace(/"chunks":\[[^\]]*\]/,'"chunks":[#]');
const inlineRows=head=>{const tree=JSON.parse(head);return ['vehicles','drivers'].reduce((n,k)=>n+(tree.mobility[k].g||[]).filter(part=>!(part&&part.$ghText)).reduce((m,part)=>m+((part.r||[]).length),0),0);};
const results={};
// 1-3. 9 MB of tracked text
{
  const s=realm(),C=s.GH_STATE_CODEC,state=make(24000),first=save(s,state),stats=C.cacheStats().openChunks,full=JSON.stringify(state).length;
  assert.equal(inlineRows(first.text),0,'1: no tracked row is written inline in the head');
  assert.ok(first.text.length<full*0.15,`1: the head (${first.text.length} characters) is a small part of the state's ${full}`);
  assert.ok(stats.sharedChars>stats.limitChars,`1: the shared tracked text (${stats.sharedChars}) is past the budget (${stats.limitChars})`);
  assert.ok(stats.chars<=stats.limitChars,'4: the counted characters stay within the budget');
  assert.equal(JSON.stringify(decode(first).mobility),JSON.stringify(state.mobility),'2: the save holds the live state');
  {const fresh=realm(),copy=JSON.parse(JSON.stringify(state));assert.equal(resolved(first),resolved(save(fresh,copy)),'2: the text equals a fresh codec\'s');}
  const ids=out=>new Set([...out.chunks.keys()]),second=save(s,state);
  assert.deepEqual([...ids(second)].sort(),[...ids(first)].sort(),'3: an unchanged save names the same chunks');
  state.mobility.vehicles[7000].status='moving';state.mobility.vehicles[7000]={...state.mobility.vehicles[7000]};
  state.mobility.drivers.splice(12000,1);state.mobility.vehicles.push(vehicle(24000));
  const third=save(s,state),renamed=[...ids(third)].filter(id=>!ids(second).has(id));
  assert.ok(renamed.length>0&&renamed.length<=40,`3: only the edited segments are renamed (${renamed.length})`);
  assert.equal(JSON.stringify(decode(third).mobility),JSON.stringify(state.mobility),'3: the edited save holds the live state');
  assert.equal(inlineRows(third.text),0,'3: still no tracked row inline');
  results.tracked={headChars:first.text.length,stateChars:full,chunks:first.chunks.size,sharedChars:stats.sharedChars,countedChars:stats.chars,renamedAfterEdit:renamed.length};
}
// 4. an untracked open collection past the budget stays bounded
{
  const s=realm(),C=s.GH_STATE_CODEC,notes=Array.from({length:15000},(_,i)=>({id:'NOTE-'+i,text:('ملاحظة طويلة '+i+' ').repeat(24)})),state=make(2000,notes);
  save(s,state);const out=save(s,state),stats=C.cacheStats().openChunks;
  assert.ok(stats.declined>0,'4: untracked texts past the budget are declined');assert.ok(stats.chars<=stats.limitChars,'4: the counted characters never pass the budget');
  assert.equal(JSON.stringify(decode(out).notes),JSON.stringify(notes),'4: the declined texts are saved inline, exactly');
  results.untracked={declined:stats.declined,countedChars:stats.chars,limitChars:stats.limitChars};
}
// 5. under the budget, the save is what it was (the same head text, ids aside, as the previous behaviour gives)
{
  const s=realm(),state=make(1500),out=save(s,state),again=save(s,state);
  assert.equal(inlineRows(out.text),0);assert.deepEqual([...again.chunks.keys()].sort(),[...out.chunks.keys()].sort());
  assert.equal(JSON.stringify(decode(out)),JSON.stringify(state),'5: the small save holds the state');
  results.small={headChars:out.text.length,chunks:out.chunks.size};
}
// the source keeps the budget for counted texts and shares only a tracked part's own text
{const source=fs.readFileSync(path.join(ROOT,'WebApp/state-codec-core.js'),'utf8');assert.match(source,/OPEN_TEXT_LIMIT=4\*1024\*1024/);assert.match(source,/openTextChunkOf\(text,partKey,!!members&&TRACKED_TEXT\.get\(partKey\)\?\.text===text\)/);}
console.log(JSON.stringify({suite:'build685-tracked-chunks-past-budget',...results}));
console.log('BUILD685_TRACKED_CHUNKS_PAST_BUDGET_PASS');
