'use strict';
// iPhone diagnostic DX-1792378248326 recorded fleet maintenance up to 38 ms in one frame (74,000 extras on 980,000
// assets). The first maintainStages step called STORE.stats only for length/live, and stats enumerated every extras key
// (Object.keys over a sparse row-indexed object: 9-13 ms for 75,000 extras in desktop V8) on every maintenance pass,
// including a pass for a day already collected. Proven here, against the previous fleet-access-core.js:
//  1. the guard no longer enumerates extras (counted through a Proxy ownKeys trap): [0,0] for a collecting and a
//     same-day pass; the previous code enumerated them in both;
//  2. the same stages, results, row bytes, values, extras and counters as the previous code, with the worker plan,
//     a same-day pass and a store over the compaction threshold.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
function run(){
  global.window=global;const S=require(path.join(ROOT,'WebApp/fleet-store-core.js')),F=require(path.join(ROOT,'WebApp/fleet-access-core.js'));
  const drain=it=>{const stages=[];let step;while(!(step=it.next()).done)stages.push(step.value);return {result:step.value,stages};};
  const fixture=(n=6000,remove=0)=>{const store=S.create(n);for(let i=0;i<n;i++)S.add(store,{id:'GM-'+i,name:'GM '+i,type:['air','sea','road'][i%3],ownerCompanyId:'air',phase:i%3?'idle':'moving',routeId:'R-'+i%7,baseFacility:'B-'+i%5,condition:95,fuel:80,progress:.2,lastTrip:i%4?{revenue:i%13}:undefined});for(let i=0;i<2048;i++)S.intern(store,{orphan:i});for(let i=0;i<remove;i++)S.remove(store,S.indexOf(store,'GM-'+i));return {fleet:store,simSeconds:86400*3};};
  const digest=s=>({rows:crypto.createHash('sha256').update(new Uint8Array(s.rows)).digest('hex'),values:JSON.stringify(s.values),extras:JSON.stringify(s.extras),length:s.length,live:s.live,revision:s.revision,structure:s.structure});
  const out={};
  // Collecting pass then same-day pass, through the worker plan; extras enumeration counted.
  {const state=fixture(),s=state.fleet;global.GH_FLEET_QUERY_PROVIDER=(target,name)=>name==='valueCollection'?{result:S.planValueCollection(s),current:()=>true}:null;
   let keys=0;const extras=s.extras;s.extras=new Proxy(extras,{ownKeys(target){keys++;return Reflect.ownKeys(target);}});
   const counts=[],passes=[];for(let i=0;i<2;i++){keys=0;const r=drain(F.maintainStages(state,3));counts.push(keys);passes.push({stages:r.stages,result:r.result});}
   s.extras=extras;out.collect={counts,passes,store:digest(s)};}
  // A store over the 10% dead-row compaction threshold.
  {const state=fixture(3000,600),s=state.fleet;global.GH_FLEET_QUERY_PROVIDER=(target,name)=>name==='valueCollection'?{result:S.planValueCollection(s),current:()=>true}:null;const r=drain(F.maintainStages(state,4));out.compact={stages:r.stages,result:r.result,store:digest(s),removed:typeof S.remove==='function'};}
  return out;
}
if(process.env.GH_FLEET_GUARD_CHILD==='1'){process.stdout.write(JSON.stringify(run()));return;}
const current=JSON.parse(JSON.stringify(run()));
assert.deepEqual(current.collect.counts,[0,0],'the maintenance guard never enumerates extras');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'madar-fleet-guard-old-'));let old;
try{
  fs.cpSync(path.join(ROOT,'WebApp'),path.join(tmp,'WebApp'),{recursive:true});fs.cpSync(path.join(ROOT,'tests'),path.join(tmp,'tests'),{recursive:true});
  const previous=execFileSync('git',['-C',process.env.GH_FLEET_GUARD_GIT_DIR||ROOT,'show','d953ed5:WebApp/fleet-access-core.js'],{encoding:'utf8',maxBuffer:16*1024*1024});
  assert.ok(previous.includes('const stats=STORE.stats(store),dead='),'the baseline reads STORE.stats');
  fs.writeFileSync(path.join(tmp,'WebApp','fleet-access-core.js'),previous);
  old=JSON.parse(execFileSync(process.execPath,[__filename],{env:{...process.env,GH_TEST_SOURCE_DIR:tmp,GH_FLEET_GUARD_CHILD:'1'},encoding:'utf8',maxBuffer:64*1024*1024}));
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
assert.ok(old.collect.counts.every(n=>n>0),`the previous guard enumerated extras on every pass: ${old.collect.counts}`);
assert.deepEqual(current.collect.passes,old.collect.passes,'same stages and results for a collecting and a same-day pass');
assert.deepEqual(current.collect.store,old.collect.store,'same row bytes, values, extras and counters');
assert.deepEqual(current.compact,old.compact,'same compaction decision, stages and store');
console.log(JSON.stringify({suite:'build505-fleet-maintenance-guard',ok:true,extrasEnumerations:{previous:old.collect.counts,current:current.collect.counts},compactionCase:current.compact.removed}));
