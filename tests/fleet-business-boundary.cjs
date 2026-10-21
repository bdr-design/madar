'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const fixture=require('./fixtures/fleet-business-boundary.json'),root=path.resolve(__dirname,'..');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
for(const [file,expected] of Object.entries(fixture.files)){
 let source=fs.readFileSync(path.join(root,file),'utf8');
 if(file==='WebApp/route-core.js'){
  const addition=fixture.approved_route_capacity_extension,start=source.indexOf(addition.begin),end=source.indexOf(addition.end,start);
  assert.ok(start>=0&&end>start,'the reviewed capacity helper must have one exact source boundary');
  assert.equal(hash(source.slice(start,end)),addition.sha256,'capacity extension changed: review its safety tests before approval');
  assert.equal((source.match(/,allocateAvailableForBudget,NEAR_DUPLICATE/g)||[]).length,1,'only the reviewed helper export may be added');
  source=(source.slice(0,start)+source.slice(end)).replace(',allocateAvailableForBudget,NEAR_DUPLICATE',',NEAR_DUPLICATE');
 }
 // Restore the exact reviewed performance edits before the earlier integration edits; retain the original economic hash.
 for(const edit of [...(fixture.approved_runtime_performance_edits?.[file]||[]),...(fixture.approved_nonfleet_integration_edits?.[file]||[]),...(fixture.approved_recovery_validation_edits?.[file]||[]),...(fixture.approved_construction_progress_edits?.[file]||[]),...(fixture.approved_financial_booking_edits?.[file]||[]),...(fixture.approved_airline_cost_edits?.[file]||[])]){
  assert.equal(hash(edit.after),edit.sha256,'reviewed non-economic edit changed');
  assert.equal(source.split(edit.after).length,2,'the reviewed edit must have one exact source boundary');
  source=source.replace(edit.after,edit.before);
 }
 assert.equal(hash(source),expected,`fleet customer/price boundary changed: ${file}`);
}
const {harness}=require('./helpers/core-harness'),{s}=harness(['operating-acquisition-core','business-options-ui']);
// The authorised dealer accounting/stock fix changes this assetless owner, while its economic constants stay pinned.
const local=harness([]);local.s.GH_AUTHORIZATION={registerCommandTargetResolver(){}};local.load('customer-companies-core');
for(const [key,expected] of Object.entries(fixture.economic_constants))assert.equal(crypto.createHash('sha256').update(JSON.stringify(local.s.GH_CUSTOMER_COMPANIES_CORE[key])).digest('hex'),expected,`customer-company price constants changed: ${key}`);
assert.deepEqual(Object.keys(local.s.GH_CUSTOMER_COMPANIES_CORE.COMPANY_CONFIG).sort(),['dealership','telecom']);
for(const company of ['air','sea','road','mobility']){
 assert.equal(s.GH_OPERATING_ACQUISITIONS.COMPANIES.includes(company),false);
 assert.equal(s.GH_BUSINESS_UI.labels[company],undefined);
 assert.equal(s.GH_BUSINESS_UI.extras('companyManage',{type:company,tab:'operations'},{state:{}},{}),'');
}
console.log('FLEET_BUSINESS_BOUNDARY_PASS: fleet customer/pricing engines unchanged, fleet companies excluded');
