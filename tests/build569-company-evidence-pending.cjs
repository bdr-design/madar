'use strict';
// Owner's diagnostic (build 77): the health report was critical with one issue, «مرجع شركة غير صالح:
// asset-validation-unavailable», opened and resolved during play and present again at the export. Above 2048 assets
// the company check reads the fleet worker's evidence instead of walking the fleet on the main thread; between a fleet
// change and the worker's next answer that evidence is not current, which says nothing about any reference. Proven on
// the real integrity, company and diagnostics owners:
//  1. stale, missing or malformed evidence reports «تحقق أصول الشركات غير مكتمل» as a warning, never critical, and the
//     health report shows it as a warning;
//  2. current evidence that finds a real bad reference is still critical «مرجع شركة غير صالح»;
//  3. the company owner still refuses to vouch for the state without current evidence (the save check is unchanged);
//  4. a command after which the evidence went stale is not rolled back for it (it was, as a "new critical" issue);
//  5. no main-thread fleet walk in any of this.
const assert=require('node:assert/strict'),path=require('node:path');
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {scenario}=require('./helpers/business-scenario');
const e=scenario(),{s,state,command}=e;for(const name of ['fleet-save-validation-core','diagnostics-core'])e.load(name);
const S=s.GH_FLEET_STORE,F=s.GH_FLEET_DATA,V=s.GH_FLEET_SAVE_VALIDATION,I=s.GH_INTEGRITY_CORE,P=s.GH_COMPANY_PLATFORM;
const rows=Array.from({length:4103},(_,i)=>({id:`PENDING-${String(i).padStart(6,'0')}`,ownerCompanyId:'air',assetMode:'air',type:'air',assetClass:'aircraft',baseFacility:'B1',phase:'idle',condition:90,ownership:'owned',purchasePrice:1000,specs:{co2Band:'A'},staffing:{mode:'automatic-fixed',ready:true,roles:[],total:0,monthlyPayroll:0}}));
state.fleet=S.fromAssets(rows,{at:0});delete state.assets;const params=()=>s.GH_SAVE_SCHEMA.fleetValidationParams(state),evidence=V.summarizeCompany(state,F,params());
let walks=0;s.GH_FLEET_DATA={...F,forEachFieldClasses(){walks++;throw new Error('forbidden-main-fleet-scan');},forEachFields(){walks++;throw new Error('forbidden-main-fleet-scan');}};
const company=check=>check.issues.filter(row=>row.id.startsWith('COMPANY_PLATFORM_'));
// 1
for(const [name,found] of [['stale',{result:evidence,current:()=>false}],['missing',null],['malformed',{result:{},current:()=>true}]]){
 s.GH_COMPANY_FLEET_VALIDATION_PROVIDER=()=>found;const check=I.check(state),[row]=company(check);
 assert.deepEqual([row?.id,row?.severity,row?.title],['COMPANY_PLATFORM_ASSET_VALIDATION_UNAVAILABLE','warning','تحقق أصول الشركات غير مكتمل'],`1 ${name}: ${JSON.stringify(row)}`);
 assert.notEqual(check.status,'critical',`1 ${name}: integrity`);const health=s.GH_DIAGNOSTICS.runHealthCheck(state,{integrity:check,fleetAssetIssues:[]},{recordEvent:false,trackTransitions:false,layout:false});
 const shown=health.issues.filter(x=>x.id.startsWith('BIZ_COMPANY_PLATFORM_'));assert.deepEqual(JSON.parse(JSON.stringify(shown.map(x=>[x.id,x.severity]))),[['BIZ_COMPANY_PLATFORM_ASSET_VALIDATION_UNAVAILABLE','warning']],`1 ${name}: the health report`);}
// 2
{const bad=S.fromAssets(rows.map((row,i)=>i===5?{...row,ownerCompanyId:'missing-company'}:row),{at:0}),keep=state.fleet;state.fleet=bad;s.GH_FLEET_DATA=F;const found={result:V.summarizeCompany(state,F,params()),current:()=>true};s.GH_FLEET_DATA={...F,forEachFieldClasses(){walks++;throw new Error('forbidden-main-fleet-scan');},forEachFields(){walks++;throw new Error('forbidden-main-fleet-scan');}};
 s.GH_COMPANY_FLEET_VALIDATION_PROVIDER=()=>found;const rowsFound=company(I.check(state));assert(rowsFound.length>0,'2: the bad reference is found');assert(rowsFound.every(row=>row.severity==='critical'&&row.title==='مرجع شركة غير صالح'),`2: ${JSON.stringify(rowsFound)}`);state.fleet=keep;}
// 3
{const result=P.validateState(state,{requireFleetAssetValidation:true});assert.equal(result.ok,false);assert(result.errors.includes('asset-validation-unavailable'),'3: no current evidence, no vouching');}
// 4
{let calls=0;s.GH_COMPANY_FLEET_VALIDATION_PROVIDER=()=>({result:evidence,current:()=>calls++===0});
 assert.doesNotThrow(()=>command('finance','set-budget',{company:'air',limit:5e6}),'4: not rolled back for evidence that went stale');assert.equal(s.GH_FINANCE_CORE.budget(state,'air').limit,5e6,'4: committed');assert(calls>=2,'4: read before and after');}
// 5
assert.equal(walks,0,'5: no main-thread fleet walk');
console.log(JSON.stringify({suite:'build569-company-evidence-pending',ok:true,assets:rows.length}));
