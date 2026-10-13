'use strict';
// Build 373: the company panel's pending decisions (company-revenue-chain-core) read each owner's records without
// changing them. Build 377 (owner's decision): the revenue-chain design is gone, so the core builds the decisions only:
// no steps and no next step.
const assert=require('node:assert/strict'),path=require('node:path');
const Chain=require(path.join(__dirname,'..','WebApp','company-revenue-chain-core.js'));
const DAY=86400,plain=value=>JSON.parse(JSON.stringify(value)),frozen=state=>JSON.stringify(state);

// Insurance: two risks waiting.
let state={simSeconds:40*DAY,insurance:{offices:[{id:'O1',active:true,lines:{motor:{policies:900}}}],riskRequests:[{id:'R1',subject:'Refinery',premium:3e6,expectedLoss:1.2e6,expiresDay:44},{id:'R2',subject:'Fleet',premium:7e5,expectedLoss:4e5,expiresDay:41}]}};
let before=frozen(state),chain=Chain.build(state,'insurance','insurance');
assert.equal(frozen(state),before,'reading the decisions changes nothing');
assert.deepEqual(Object.keys(chain).sort(),['batch','decisions','kind'],'decisions only: no design steps');
assert.deepEqual(plain(chain.decisions.map(row=>[row.id,row.daysLeft])),[['R1',4],['R2',1]]);assert.equal(chain.batch,'insurance');
assert.deepEqual(plain(chain.decisions[0].detail),{premium:3e6,expectedLoss:1.2e6});

// Real estate: a tenant request.
state={simSeconds:10*DAY,realEstate:{tenantRequests:[{id:'T1',tenant:'Bank',units:12,projectName:'Riyadh Towers',annualRent:2e6,years:5,expiresDay:15}]}};
chain=Chain.build(state,'realestate','realestate');
assert.deepEqual(plain(chain.decisions),[{id:'T1',title:'Bank · 12 وحدة في Riyadh Towers',detail:{annualRent:2e6,years:5},daysLeft:5}]);assert.equal(chain.batch,'realestate');

// Telecom: business contracts asked for, at most five.
state={simSeconds:2*DAY,customerCompanies:{companies:{telecom:{market:{requests:Array.from({length:7},(_,i)=>({id:`E${i}`,customerName:`Co ${i}`,lines:10,monthlyValue:4200,months:12,expiresDay:9}))}}}}};
chain=Chain.build(state,'telecom','telecom');
assert.equal(chain.decisions.length,Chain.MAX_DECISIONS,'at most five decisions');assert.deepEqual(plain(chain.decisions[0].detail),{lines:10,monthlyValue:4200,months:12});

// The dealership decides only its own customer-finance requests; the bank decides every request.
state={simSeconds:3*DAY,bank:{loanRequests:[{id:'Q1',borrower:'A',amount:1,expiresDay:9},{id:'Q2',borrower:'B',amount:2,expiresDay:9,sourceCompanyId:'dealership'}]}};
assert.deepEqual(Chain.build(state,'dealership','dealership').decisions.map(row=>row.id),['Q2']);
assert.deepEqual(Chain.build(state,'bank','bank').decisions.map(row=>row.id),['Q1','Q2']);
assert.equal(Chain.build(state,'dealership','dealership').batch,'dealership');

// A kind without decisions here.
assert.equal(Chain.build(state,'air','air'),null);
console.log(JSON.stringify({suite:'build373-revenue-chain-core',kinds:Chain.KINDS.length}));
console.log('BUILD373_REVENUE_CHAIN_CORE_PASS');
