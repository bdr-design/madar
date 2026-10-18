'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');global.window=global;
const S=require(path.join(ROOT,'WebApp/fleet-store-core.js'));require(path.join(ROOT,'WebApp/fleet-event-core.js'));const F=require(path.join(ROOT,'WebApp/fleet-access-core.js')),V=require(path.join(ROOT,'WebApp/fleet-save-validation-core.js'));
const n=65539,fleet=S.create(n),state={fleet,simSeconds:0},params={routeIds:[],routes:[],registryCompanies:['air','sea','road'],definitionCompanies:['air','sea','road'],legacyAssetOwners:{air:'air',sea:'sea',road:'road'}},results=[];
for(let i=0;i<n;i++)S.add(fleet,{id:'STATIC-'+i,name:'Static '+i,type:['air','sea','road'][i%3],ownerCompanyId:['air','sea','road'][i%3],baseFacility:'BASE',phase:'idle',progress:0,fuel:100,condition:100,flightHours:1,flightCycles:1,nextCheckHours:600});
function same(label){const out=V.summarize(state,F,params);assert.deepEqual(out,V.summarizeReference(state,F,params),label);return V.staticStats();}
function expectReused(label){const stat=same(label);assert.equal(stat.lastChecked,0,label+' must not rebuild static row predicates');assert.equal(stat.lastReused,3);results.push({label,chunksChecked:0,chunksReused:3});}
same('cold');expectReused('unchanged');
const writer=S.columnWriter(fleet,['flightHours','flightCycles','nextCheckHours']);for(let i=0;i<n;i++){writer(i,'flightHours',2);writer(i,'flightCycles',2);writer(i,'nextCheckHours',599);}expectReused('daily numeric counter columns');
const spare=S.intern(fleet,{unused:'a'});S.applyValueChanges(fleet,{length:fleet.values.length,changes:[[spare,{unused:'b'}]]});expectReused('unrelated intern value replacement');
const profileRef=S.views(fleet).u32[S.O.profile];S.applyValueChanges(fleet,{length:fleet.values.length,changes:[[profileRef,{...fleet.values[profileRef],model:'<unsafe>'}]]});const changed=same('actual profile replacement');assert.equal(changed.lastChecked,3);assert(V.summarize(state,F,params).errors.includes('display-text-assets-model'));
S.set(fleet,1,'assetClass','<bad>');assert(same('identity field').lastChecked>0);
const before=V.summarize(state,F,params),j=S.beginJournal(fleet);S.set(fleet,1,'id','STATIC-0');assert.equal(same('duplicate inside journal').lastChecked>0,true);assert.equal(V.summarize(state,F,params).ids.duplicate,true);S.rollbackJournal(j);assert.deepEqual(V.summarize(state,F,params),before);
const v=S.views(fleet);v.f64[S.O.fuel]=151;assert(V.summarize(state,F,params).errors.includes('asset-fuel'),'live numeric predicates must never be cached');assert.deepEqual(V.summarize(state,F,params),V.summarizeReference(state,F,params));
console.log(JSON.stringify({suite:'build425-validation-dependencies',ok:true,rows:n,results,changedReferencesInvalidate:true,rollbackExact:true,rawLiveCorruptionDetected:true}));
