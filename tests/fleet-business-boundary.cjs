'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const fixture=require('./fixtures/fleet-business-boundary.json'),root=path.resolve(__dirname,'..');
for(const [file,expected] of Object.entries(fixture.files))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex'),expected,`fleet customer/price boundary changed: ${file}`);
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
