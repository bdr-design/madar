'use strict';
// One-time legacy reconciliation must visit branches once, retaining first-match identity, order and duplicate policy.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{harness,minimal}=require('./helpers/core-harness');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
function environment(){
 const {s:g}=harness(['banking-core']);if(ROOT!==path.resolve(__dirname,'..'))vm.runInContext(fs.readFileSync(path.join(ROOT,'WebApp/banking-core.js'),'utf8'),g);
 const B=g.GH_BANKING_CORE;let state={...minimal(),simSeconds:100,openedCompanies:[],bank:{branches:900,sequence:500,branchNetwork:Array.from({length:350},(_,i)=>({id:`OLD-${i}`,branchId:`OLD-${i}`,facilityId:`FAC-${i}`,city:`City ${i}`,country:'QA',servicesActive:i%2!==0}))}};
 state.customHubs=Array.from({length:700},(_,i)=>({id:`FAC-${i}`,kind:'bank',ownerCompanyId:'bank',owned:true,city:`City ${i}`,country:'QA',openedAt:0}));state.customHubs.push({...state.customHubs[500]},{id:'CLOSED',kind:'bank',ownerCompanyId:'bank',owned:false},{id:'WRONG-OWNER',kind:'bank',ownerCompanyId:'insurance',owned:true});
 g.seedState=state;state=vm.runInContext('JSON.parse(JSON.stringify(seedState))',g);delete g.seedState;return {g,B,state};
}
function run(){const e=environment(),proto=vm.runInContext('Array.prototype',e.g),original=proto.some;let visits=0;proto.some=function(fn,...rest){return original.call(this,(...args)=>{visits++;return fn(...args);},...rest);};let result;try{result=e.B.migrateLegacyBranches(e.state);}finally{proto.some=original;}const saved=JSON.stringify(e.state),repeat=e.B.migrateLegacyBranches(e.state);assert.equal(JSON.stringify(e.state),saved,'completed migration is idempotent');assert.equal(repeat.added,0);assert.equal(repeat.changed,false);return {...e,result,visits,saved};}
module.exports={run};
if(require.main===module){const r=run();assert.equal(r.result.added,550);assert.equal(r.result.branches,900);assert.equal(r.state.bank.branchNetwork[0].id,'OLD-0');assert.equal(r.state.bank.branchNetwork[0].servicesActive,false);assert.equal(r.state.bank.branchNetwork.filter(x=>x.facilityId==='FAC-500').length,1);assert(!r.state.bank.branchNetwork.some(x=>['CLOSED','WRONG-OWNER'].includes(x.facilityId)));assert(r.visits<3000,`migration must not search every known branch for each facility: ${r.visits}`);
 const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/build441-bank-migration.json'),'utf8')),digest=require('node:crypto').createHash('sha256').update(r.saved).digest('hex');assert.equal(digest,fixture.stateSha256,'all normalized/migrated state bytes match the old path');
 const restored=JSON.parse(r.saved),out=r.B.migrateLegacyBranches(restored);assert.equal(out.added,0);assert.equal(JSON.stringify(restored),r.saved);
 console.log(JSON.stringify({suite:'build441-bank-migration-work',facilities:700,legacyTarget:900,added:r.result.added,nestedSomeVisits:r.visits,byteParity:true,reloadIdempotent:true}));}
