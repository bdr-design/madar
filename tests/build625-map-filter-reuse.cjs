'use strict';
// Owner («كمل بدقه»; a prepared map draw in a 300k-asset world spent 6 ms of 21 asking, for each facility, whether its
// company is shown, each time copying and freezing the map filter twice): a filter normalizeFilterState made is returned as
// it is, and the facilities' owners are asked once each a draw. Against the source before (b86067a, from its own tree):
//  1. normalizeFilterState gives the same filter (deep-frozen, equal) for plain, legacy, partial and invalid inputs, and
//     the filter it made comes back as the same object;
//  2. companyVisible and categoryVisible answer the same for every company and category, from a plain or a made filter;
//  3. mapOwnedFacilities keeps the same facilities in the same order, and asks each owner once (the source before: once
//     per facility).
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{execFileSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'),SOURCE=process.env.GH_TEST_SOURCE_DIR||ROOT,PREVIOUS='b86067a';
const text={now:{core:fs.readFileSync(path.join(SOURCE,'WebApp/map-feature-core.js'),'utf8'),app:fs.readFileSync(path.join(SOURCE,'WebApp/app.js'),'utf8')},
  before:{core:execFileSync('git',['-C',ROOT,'show',`${PREVIOUS}:WebApp/map-feature-core.js`]).toString(),app:execFileSync('git',['-C',ROOT,'show',`${PREVIOUS}:WebApp/app.js`],{maxBuffer:64*1024*1024}).toString()}};
const platform={isKnownCompany:id=>['air','sea','road','bank','group'].includes(id),companyIds:()=>['air','sea','road','bank','group']};
const load=source=>{const context={globalThis:{}};context.globalThis=context;vm.runInNewContext(source,context);return context.GH_MAP_FEATURE_CORE;};
const core={now:load(text.now.core),before:load(text.before.core)};
const plain=v=>JSON.parse(JSON.stringify(v));
// 1-2.
const inputs=[{},null,'x',{companies:{mode:'include',included:['air','sea','air']},categories:{assets:false}},{companies:{mode:'all',excluded:['road','bank']},optionalLayers:{'infrastructure:port':true},market:{competitors:1}},{companies:{mode:'include',included:['sea'],excluded:['sea','air']},categories:{routes:0,facilities:true,'bad key!':true}},{version:9,companies:'x'}];
for(const [index,input] of inputs.entries()){
  const a=core.now.normalizeFilterState(input,{companyPlatform:platform}),b=core.before.normalizeFilterState(input,{companyPlatform:platform});
  assert.deepEqual(plain(a),plain(b),`1: input ${index}: the same filter`);assert.equal(Object.isFrozen(a)&&Object.isFrozen(a.companies)&&Object.isFrozen(a.categories),true,`1: input ${index}: frozen`);
  assert.equal(core.now.normalizeFilterState(a),a,`1: input ${index}: the filter it made comes back as it is`);
  for(const filter of [input,a])for(const id of ['air','sea','road','bank','group','unknown','']){
    assert.equal(core.now.companyVisible(filter,id,{companyPlatform:platform}),core.before.companyVisible(filter&&typeof filter==='object'?plain(filter):filter,id,{companyPlatform:platform}),`2: input ${index}: ${id||'(none)'} shown the same`);}
  for(const category of ['assets','routes','facilities','infrastructure','other'])assert.equal(core.now.categoryVisible(a,category),core.before.categoryVisible(b,category),`2: input ${index}: ${category}`);
}
// 3.
function owned(app,engine){
  const cut=(from,to)=>{const a=app.indexOf(from),b=app.indexOf(to,a+from.length);assert.ok(a>=0&&b>a,`source anchor missing: ${from}`);return app.slice(a,b);};
  const facilities=Array.from({length:600},(_,i)=>({id:`F-${i}`,owned:i%7!==0,coords:[i%80,i%170],kind:i%3?'airport':'port',ownerCompanyId:['air','sea','road','bank','gone'][i%5]}));
  const asks={n:0};const context={facilities,asks,state:{mapFilterState:{companies:{mode:'all',excluded:['road']}},onboardingComplete:true},
    getDynamicFacilities:()=>facilities,mapFleetCount:()=>new Map([['F-7',3]]),facilityOwnerCompanyId:f=>f.ownerCompanyId||'group',
    mapCompanyVisible:id=>{asks.n++;return engine.companyVisible(engine.normalizeFilterState(context.state.mapFilterState),id,{companyPlatform:platform});}};
  vm.runInNewContext(cut('  function mapOwnedFacilities(filter){','\n  // compact: a base drawn as a small dot')+'\nglobalThis.owned_=mapOwnedFacilities;',context);
  const out={};for(const filter of ['all','airport','port']){asks.n=0;out[filter]={ids:context.owned_(filter).map(f=>f.id),asks:asks.n};}return out;
}
const a=owned(text.now.app,core.now),b=owned(text.before.app,core.before);
for(const filter of ['all','airport','port']){
  assert.deepEqual(a[filter].ids,b[filter].ids,`3: ${filter}: the same facilities in the same order`);
  assert.ok(a[filter].asks<=5,`3: ${filter}: each owner asked once (${a[filter].asks})`);assert.ok(b[filter].asks>=400,`3: (the source before asked ${b[filter].asks} times)`);
}
console.log(JSON.stringify({suite:'build625-map-filter-reuse',ok:true,facilities:a.all.ids.length,asks:{now:a.all.asks,before:b.all.asks}}));
