'use strict';
// A legacy load owns one private root clone and one Company Platform pass.  The
// former chain invoked Company Platform in Save Schema, then cloned and invoked
// it again in Migration Core.
const assert=require('node:assert/strict');
const {harness,minimal}=require('./helpers/core-harness');
const {s,storage}=harness(['capability-registry-core','company-definitions','company-platform-core','identity-system','company-adapters-core','save-schema','migration-core','persistence-core']);
const original=s.GH_COMPANY_PLATFORM;let calls=0,inPlaceCalls=0;
s.GH_COMPANY_PLATFORM={...original,migrateState(input,options){calls++;if(options?.inPlace===true)inPlaceCalls++;return original.migrateState(input,options);}};

const assets=[];for(let index=0;index<2000;index++)assets.push({id:`LEGACY-AIR-${index}`,name:`Aircraft ${index}`,type:'air',baseFacility:'BASE-A',phase:'idle',progress:0,fuel:100,condition:100});
const legacy={...minimal(),speed:5,onboardingComplete:false,companyRegistry:{},openedCompanies:[],unlockedSectors:[],customRoutes:[],assets};
const raw=JSON.stringify(legacy);storage.setItem('legacy-single-pass',raw);
const loaded=s.GH_MIGRATION_CORE.load({defaultState:minimal(),storageKey:'legacy-single-pass',legacyStorageKeys:[],saveSchema:s.GH_SAVE_SCHEMA});
assert.equal(calls,1,'Company Platform ran more than once for one legacy root');
assert.equal(inPlaceCalls,1,'Save Schema did not reuse its private migration draft');
assert.equal(loaded.state.saveVersion,'3.0.0');assert.equal(s.GH_FLEET_DATA.size(loaded.state),assets.length);
assert.equal(JSON.parse(raw).assets[1999].ownerCompanyId,undefined,'persisted input fixture was mutated');

// The public migration API remains pure unless its private-draft option is
// explicitly supplied by Save Schema.
const direct={...minimal(),assets:[{id:'PURE-1',type:'air'}],companyRegistry:{},openedCompanies:[],unlockedSectors:[]},before=JSON.stringify(direct),out=original.migrateState(direct);
assert.notEqual(out.state,direct);assert.equal(JSON.stringify(direct),before);assert.equal(out.state.assets[0].ownerCompanyId,'air');
console.log(JSON.stringify({ok:true,legacyAssets:assets.length,companyMigrationCalls:calls,inPlaceCalls}));
