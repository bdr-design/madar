'use strict';
// iPhone diagnostic DX-1792378248326: the first command after a day close re-checked all 30 fleet chunks in the save
// validation worker (2.3 s) and the diagnostic could not say why. The cache now records, with its existing counters,
// which part of its key moved (empty, epoch, chunk-mass, context, inspector) and, for each chunk checked again, whether
// its identity version, bounds or interned values changed. Proven here: the summary still equals summarizeReference, and
// each kind of change reports its own reason; the main-thread client copies the reason into its stats.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
global.window=global;require(path.join(ROOT,'WebApp/transaction-core.js'));
const STORE=require(path.join(ROOT,'WebApp/fleet-store-core.js'));require(path.join(ROOT,'WebApp/fleet-event-core.js'));
const FLEET=require(path.join(ROOT,'WebApp/fleet-access-core.js')),CORE=require(path.join(ROOT,'WebApp/fleet-save-validation-core.js'));
const {fleet}=require(path.join(ROOT,'tests/helpers/fleet-fixture.js'));
const CHUNK=STORE.CHUNK_ROWS,template=fleet(),ordinary=template.filter(a=>['A1','S1','R1'].includes(a.routeId)&&!a.salePending&&a.phase);
const assets=template.slice();for(let i=0;assets.length<CHUNK+300;i++){const a=structuredClone(ordinary[i%ordinary.length]);a.id=`CR-${String(i).padStart(7,'0')}`;a.name=`GH CR ${i}`;assets.push(a);}
const state={simSeconds:1000,fleet:STORE.fromAssets(assets,{at:0})},store=state.fleet;
let params={routeIds:['R1','R2','A1','S1','TINY','ZERO'],routes:[['R1','road','road',null],['A1','air','air',null],['S1','sea','sea',null]],registryCompanies:['air','sea','road'],definitionCompanies:['air','sea','road'],legacyAssetOwners:{air:'air',sea:'sea',road:'road'}};
const run=label=>{const value=CORE.summarize(state,FLEET,params);assert.deepEqual(value,CORE.summarizeReference(state,FLEET,params),`${label}: equal to the reference`);const s=CORE.staticStats();return {reset:s.lastReset,miss:s.lastMiss,checked:s.lastChecked,reused:s.lastReused};};
const cold=run('cold');assert.equal(cold.reset,'empty');assert.equal(cold.miss.new,cold.checked);
const warm=run('warm');assert.equal(warm.reset,'');assert.equal(warm.checked,0);
// An identity write in chunk 0 only: that chunk reports 'version', the other is reused.
const index=FLEET.indexOf(state,'CR-0000010');STORE.set(store,index,'name','Renamed CR');
const renamed=run('renamed');assert.equal(renamed.reset,'');assert.equal(renamed.miss.version,1);assert.equal(renamed.checked,1);
// A context change (new route list) resets the cache with 'context'.
params={...params,routeIds:[...params.routeIds,'NEW']};const context=run('context');assert.equal(context.reset,'context');
const thread=fs.readFileSync(path.join(ROOT,'WebApp/fleet-engine-thread.js'),'utf8');
assert.match(thread,/stats\.lastSaveValidationReset=String\(message\.validation\.lastReset\|\|''\)/,'the client keeps the reason in its stats');
console.log(JSON.stringify({suite:'build510-validation-cache-reasons',ok:true,cold,warm,renamed,context}));
