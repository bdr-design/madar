'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {harness}=require('./helpers/core-harness');
const h=harness(['capability-registry-core','company-definitions','company-platform-core','realism-core']),{s}=h;
const asset={id:'OWNER-CACHE-1',type:'air',assetMode:'air',company:'sea',condition:100,purchasePrice:120000000,ownership:'owned',year:2026};
const state={simSeconds:0,saveRevision:1,companyRegistry:{sea:{definitionId:'gh-marine-v1'}},profile:{},fleet:s.GH_FLEET_STORE.fromAssets([asset],{at:0}),finance:{},companyFinance:{}};
const statements=()=>({sea:s.GH_REALISM.statements(state,'sea'),air:s.GH_REALISM.statements(state,'air')});
const first=statements();assert.equal(s.GH_REALISM.assetOwnerCompanyId(state,asset),'sea');assert.equal(first.sea.assets,120000000);assert.equal(first.air.assets,0);

// Company definitions can change while this state and fleet revision remain the same.
// The cache must follow `definitionFor` and the legacy asset-mode fallback immediately.
const fleetRevision=s.GH_FLEET_DATA.revision(state);state.companyRegistry.sea.definitionId='missing-definition';
assert.equal(s.GH_FLEET_DATA.revision(state),fleetRevision,'company definition edits do not change fleet revision');
const changed=statements();assert.equal(s.GH_REALISM.assetOwnerCompanyId(state,asset),'air');
assert.equal(changed.sea.assets,0);assert.equal(changed.air.assets,120000000);

// Fleet-owned fields invalidate by store revision, with exact totals after reassignment.
s.GH_FLEET_STORE.set(state.fleet,0,'ownerCompanyId','sea');
const reassigned=statements();assert.equal(reassigned.sea.assets,120000000);assert.equal(reassigned.air.assets,0);

// Guard the regression itself: cache-key construction must not walk row classes or assets.
const source=fs.readFileSync(path.join(__dirname,'../WebApp/realism-core.js'),'utf8');
const keyCode=source.slice(source.indexOf('function ownerResolutionFingerprint'),source.indexOf('// The owner totals of one pass'));
assert.doesNotMatch(keyCode,/forEachFieldClasses|scanStages|\.scan\s*\(/,'owner totals cache-key lookup must remain independent of fleet size');
console.log(JSON.stringify({ok:true,companyDefinitionInvalidation:true,fleetRevisionInvalidation:true,cacheKeyDoesNotScanFleet:true}));
