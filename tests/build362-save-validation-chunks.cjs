'use strict';
// Build 362 follow-up (iPhone diagnostic DX-1792142505027, 980,000 assets): every player decision waited ~2.0 s for the
// fleet worker's save validation. GH_FLEET_SAVE_VALIDATION.summarize now keeps the checks of fields an operating fleet
// does not rewrite per store chunk (keyed on identityVersions, the store stamp, the context and the text inspector) and
// runs only the time-derived and route checks over every row. Proven here against summarizeReference (the former
// one-pass validator) after every kind of write: deep equality of the whole result, including the order of its errors
// and company errors, the company error cap and overflow, and reuse only where nothing a static check reads has moved.
const assert=require('node:assert/strict'),path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
global.window=global;require(path.join(ROOT,'WebApp/transaction-core.js'));
const STORE=require(path.join(ROOT,'WebApp/fleet-store-core.js'));require(path.join(ROOT,'WebApp/fleet-event-core.js'));
const FLEET=require(path.join(ROOT,'WebApp/fleet-access-core.js')),CORE=require(path.join(ROOT,'WebApp/fleet-save-validation-core.js'));
const {fleet}=require(path.join(ROOT,'tests/helpers/fleet-fixture.js'));
const results=[];function test(name,fn){try{results.push({name,ok:true,detail:fn()});}catch(error){results.push({name,ok:false,error:String(error.stack||error).slice(0,2400)});}}

const CHUNK=STORE.CHUNK_ROWS,template=fleet(),ordinary=template.filter(a=>['A1','S1','R1'].includes(a.routeId)&&!a.salePending&&a.phase);
function build(count){
  const assets=template.slice();
  for(let i=0;assets.length<count;i++){const a=structuredClone(ordinary[i%ordinary.length]);a.id=`SV-${String(i).padStart(7,'0')}`;a.name=`GH SV ${i}`;a.model='Model X';a.city='Riyadh';a.progress=(i%89)/89;a.condition=60+(i%40);assets.push(a);}
  return assets;
}
const state={simSeconds:1000,fleet:STORE.fromAssets(build(2*CHUNK+500),{at:0})},store=state.fleet;
let params={routeIds:['R1','R2','A1','S1','TINY','ZERO'],routes:[['R1','road','road',null],['A1','air','air',null],['S1','sea','sea',null]],registryCompanies:['air','sea','road'],definitionCompanies:['air','sea','road'],legacyAssetOwners:{air:'air',sea:'sea',road:'road'}};
const chunks=()=>Math.ceil(store.length/CHUNK);
// The new summary equals the reference exactly; returns how many chunks were checked again.
function same(label){
  const reference=CORE.summarizeReference(state,FLEET,params),value=CORE.summarize(state,FLEET,params),stats=CORE.staticStats();
  assert.deepEqual(value,reference,`${label}: summarize must equal summarizeReference`);
  assert.equal(stats.cacheable,true,'a store is cacheable');
  return {checked:stats.lastChecked,reused:stats.lastReused,errors:value.errors.length,companyErrors:value.companyPlatform.errors.length};
}
const row=id=>FLEET.indexOf?FLEET.indexOf(state,id):FLEET.list(state).findIndex(a=>a.id===id);
const at=(chunk,offset)=>chunk*CHUNK+offset;

test('the static fields exclude every field whose in-place write leaves identityVersions alone',()=>{
  assert(Array.isArray(STORE.IDENTITY_TIER_EXEMPT)&&STORE.IDENTITY_TIER_EXEMPT.length>0);
  assert.deepEqual(CORE.STATIC_FIELDS.filter(field=>STORE.IDENTITY_TIER_EXEMPT.includes(field)),[]);
  assert.deepEqual([...new Set([...CORE.STATIC_FIELDS,...CORE.LIVE_FIELDS])].sort(),[...CORE.FIELDS].sort(),'the two passes read exactly the reference fields');
  return {static:CORE.STATIC_FIELDS.length,live:CORE.LIVE_FIELDS.length};
});

test('a cold pass equals the reference, a second one reuses every chunk',()=>{
  const cold=same('cold');assert.equal(cold.checked,chunks());
  const warm=same('warm');assert.equal(warm.checked,0);assert.equal(warm.reused,chunks());
  return {cold,warm};
});

test('time, engine and route writes in place reuse every static chunk and still report their faults',()=>{
  state.simSeconds+=86400;const time=same('time advanced');assert.equal(time.checked,0);
  STORE.set(store,at(1,7),'fuel',150);STORE.set(store,at(0,9),'condition',-3);STORE.set(store,at(2,3),'phase','lost');
  const engine=same('engine faults');assert.equal(engine.checked,0);
  STORE.set(store,at(0,60),'baseFacility','');const base=same('empty base');assert(CORE.summarize(state,FLEET,params).errors.includes('asset-shape'),'an empty base breaks the shape');
  STORE.set(store,at(0,60),'baseFacility','F-AIR-A');same('base restored');
  STORE.set(store,at(1,11),'routeId','R-NOT-THERE');const route=same('route fault');assert.equal(route.checked,0);
  return {time,engine,route};
});

test('a static write checks only its chunk again, and the fault appears and clears exactly',()=>{
  const index=at(1,20),before=FLEET.plain(state,FLEET.list(state)[index].id).name;
  STORE.set(store,index,'name','<unsafe>');const bad=same('unsafe name');assert.equal(bad.checked,1);
  STORE.set(store,at(0,40),'photo','javascript:bad');STORE.set(store,at(2,41),'coords',[999,0]);const more=same('photo and coords');assert.equal(more.checked,2);
  STORE.set(store,index,'name',before);const cleared=same('name restored');assert.equal(cleared.checked,1);
  // An owner that is not a data id breaks the asset shape (a static check) without any engine field.
  STORE.set(store,at(2,50),'ownerCompanyId','Bad Owner!');const shape=same('bad owner shape');assert.equal(shape.checked,1);assert(CORE.summarize(state,FLEET,params).errors.includes('asset-shape'));
  return {bad,more,cleared,shape};
});

test('company errors keep their row order, cap and overflow across chunks',()=>{
  // 1,100 distinct owner faults over three chunks (cap 1,024), plus class faults on some of the same rows.
  for(let k=0;k<1100;k++){const index=(k*61)%store.length;STORE.set(store,index,'ownerCompanyId','ghost');if(k%7===0)STORE.set(store,index,'assetClass','Wide_Body');}
  const capped=same('over the company error cap');assert.equal(capped.companyErrors,CORE.COMPANY_ERROR_LIMIT);
  const value=CORE.summarize(state,FLEET,params);assert.equal(value.companyPlatform.overflow,true);
  return capped;
});

test('more company errors than the cap inside one chunk still report the overflow',()=>{
  const small={simSeconds:1000,fleet:STORE.fromAssets(build(1500).map(asset=>({...asset,ownerCompanyId:'ghost'})),{at:0})};
  const reference=CORE.summarizeReference(small,FLEET,params),value=CORE.summarize(small,FLEET,params);
  assert.deepEqual(value,reference);assert.equal(value.companyPlatform.errors.length,CORE.COMPANY_ERROR_LIMIT);assert.equal(value.companyPlatform.overflow,true);
  assert.deepEqual(CORE.summarize(small,FLEET,params),reference,'and again from the cache');
  return {companyErrors:value.companyPlatform.errors.length,overflow:value.companyPlatform.overflow};
});

test('duplicate ids, appended and removed rows stay exact',()=>{
  const list=FLEET.list(state),a=list[at(0,100)].id;STORE.set(store,at(2,100),'id',a);const dup=same('duplicate id');assert(CORE.summarize(state,FLEET,params).errors.includes('asset-id'));
  const extra={...FLEET.plain(state,list[5].id),id:'SV-APPENDED-1',name:'<appended>'};FLEET.add(state,extra);const added=same('appended row');
  FLEET.remove(state,'SV-APPENDED-1');const removed=same('removed row');
  return {dup,added,removed};
});

test('mass column writes, a new context and a new text inspector check again',()=>{
  const write=STORE.columnWriter(store,['condition']);write(at(0,3),'condition',101);const mass=same('column writer');
  params={...params,routeIds:params.routeIds.filter(id=>id!=='A1')};const context=same('route registry changed');assert.equal(context.checked,chunks(),'a new context checks every chunk');
  // A company registry change moves the static owner checks themselves.
  const companies=params;params={...params,registryCompanies:['air','sea'],definitionCompanies:['air','sea'],legacyAssetOwners:{air:'air',sea:'sea'}};const registry=same('company registry changed');assert.equal(registry.checked,chunks());params=companies;same('company registry restored');
  // A replaced interned value changes every row that references it without a row write: the store stamp moves.
  // (names are stored as a shared pattern value plus a number per row)
  const ref=store.values.findIndex(value=>value&&typeof value==='object'&&value.p==='GH SV '),pattern=store.values[ref];assert(ref>0,'the shared name pattern is interned');
  STORE.applyValueChanges(store,{length:store.values.length,changes:[[ref,{...pattern,p:'<SV '}]]});
  const valueSwap=same('interned value replaced');assert.equal(valueSwap.checked,chunks());assert(CORE.summarize(state,FLEET,params).errors.includes('display-text-assets-name'));
  STORE.applyValueChanges(store,{length:store.values.length,changes:[[ref,pattern]]});same('interned value restored');
  const again=same('same context again');assert.equal(again.checked,0);
  const identity=global.GH_IDENTITY;global.GH_IDENTITY={inspectPlainText:value=>value==='Model X'?{ok:false}:{ok:true}};
  try{const inspector=same('identity inspector');assert.equal(inspector.checked,chunks());assert(CORE.summarize(state,FLEET,params).errors.includes('display-text-assets-model'));}
  finally{global.GH_IDENTITY=identity;}
  const restored=same('inspector restored');assert.equal(restored.checked,chunks());
  return {mass,context,again,restored};
});

test('a replica sync of rows checks their chunks again',()=>{
  // The engine worker writes rows the main thread sent with staticRows:true (fleet-engine-worker 'sync').
  const index=at(2,77),read=STORE.readRows(store,[index]);
  STORE.set(store,index,'name','<synced>');const synced=STORE.readRows(store,[index]);
  STORE.writeRows(store,[index],read.bytes,read.extras,{staticRows:true});const restored=same('sync restores the row');assert.equal(restored.checked,1);
  STORE.writeRows(store,[index],synced.bytes,synced.extras,{staticRows:true});const faulty=same('sync writes a fault');assert.equal(faulty.checked,1);
  assert(CORE.summarize(state,FLEET,params).errors.includes('display-text-assets-name'));
  return {restored,faulty};
});

test('a plain asset array (no store) is checked whole, exactly as before',()=>{
  const plain={simSeconds:state.simSeconds,assets:FLEET.list(state).slice(0,300).map(asset=>FLEET.plain(state,asset.id))};plain.assets[3].name='<x>';plain.assets[9].fuel=-1;
  const reference=CORE.summarizeReference(plain,FLEET,params),value=CORE.summarize(plain,FLEET,params);assert.deepEqual(value,reference);assert.equal(CORE.staticStats().cacheable,false);
  return {errors:value.errors};
});

const passed=results.filter(r=>r.ok).length;
console.log(JSON.stringify({suite:'build362-save-validation-chunks',passed,total:results.length,results},null,2));
if(passed!==results.length)process.exitCode=1;
