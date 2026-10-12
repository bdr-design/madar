'use strict';
// Build 373: the revenue chain (company-revenue-chain-core) reads each owner's records without changing them and names
// the step the player stands on and the next step, mid-game as well as on the first day.
const assert=require('node:assert/strict'),path=require('node:path');
const Chain=require(path.join(__dirname,'..','WebApp','company-revenue-chain-core.js'));
const DAY=86400,plain=value=>JSON.parse(JSON.stringify(value)),frozen=state=>JSON.stringify(state);

// Insurance with an office and policies, two risks waiting.
let state={simSeconds:40*DAY,insurance:{offices:[{id:'O1',active:true,lines:{motor:{policies:900},health:{policies:300}}}],pricing:{motor:.9,health:1.1},dailyHistory:[{premium:5000,net:1200}],riskRequests:[{id:'R1',subject:'Refinery',premium:3e6,expectedLoss:1.2e6,expiresDay:44},{id:'R2',subject:'Fleet',premium:7e5,expectedLoss:4e5,expiresDay:41}]}};
let before=frozen(state),chain=Chain.build(state,'insurance','insurance');
assert.equal(frozen(state),before,'reading the chain changes nothing');
assert.deepEqual(chain.steps.map(row=>row.done),[true,true,true,true,true]);assert.equal(chain.current,-1);
assert.deepEqual(plain(chain.steps[2].value),{count:1200});assert.equal(chain.steps[1].value.text,'100%');
assert.match(chain.next.text,/^2 مخاطر/);assert.deepEqual(plain(chain.decisions.map(row=>[row.id,row.daysLeft])),[['R1',4],['R2',1]]);assert.equal(chain.batch,'insurance');

// Real estate: a project under construction whose next milestone is above the company's cash.
state={simSeconds:10*DAY,realEstate:{offices:[{active:true}],projects:[{id:'P1',name:'Riyadh Towers',status:'قيد الإنشاء',milestonesPaid:1,buildCost:320e6,sold:0,presold:140,leased:0}],dailyHistory:[],tenantRequests:[]}};
chain=Chain.build(state,'realestate','realestate',{operating:()=>38e6});
assert.deepEqual(chain.steps.map(row=>row.done),[true,true,false,true,false]);assert.equal(chain.current,2);
assert.equal(chain.next.panel,'finance');assert.equal(chain.next.arg,'transfers');assert.equal(chain.next.amount,96e6);assert.match(chain.next.text,/Riyadh Towers/);
chain=Chain.build(state,'realestate','realestate',{operating:()=>500e6});
assert.equal(chain.next.panel,'realestate','enough cash: no transfer step');

// Bank outside its liquidity limit, no request waiting.
state={simSeconds:3*DAY,bank:{branchNetwork:[{servicesActive:true}],deposits:2e9,loans:1.4e9,loanRequests:[],dailyHistory:[{interestIncome:900000,reportedFeeIncome:100000}],lcr:80,cet1:14,loanDepositRatio:70,riskPolicy:{minLcr:100,minCet1:10.5,maxLdr:90}}};
chain=Chain.build(state,'bank','bank');
assert.equal(chain.steps[4].value.text,'خارج الحدود');assert.equal(chain.steps[4].done,false);assert.equal(chain.current,4);assert.deepEqual(chain.next.arg,{tab:'control'});
assert.deepEqual(plain(chain.steps[3].value),{money:1000000});

// The dealership decides only its own customer-finance requests; the bank decides every request.
state.bank.loanRequests=[{id:'Q1',borrower:'A',amount:1,expiresDay:9},{id:'Q2',borrower:'B',amount:2,expiresDay:9,sourceCompanyId:'dealership'}];
assert.deepEqual(Chain.build(state,'dealership','dealership').decisions.map(row=>row.id),['Q2']);
assert.deepEqual(Chain.build(state,'bank','bank').decisions.map(row=>row.id),['Q1','Q2']);
assert.equal(Chain.build(state,'dealership','dealership').batch,'dealership');

// A kind without a chain.
assert.equal(Chain.build(state,'air','air'),null);
console.log(JSON.stringify({suite:'build373-revenue-chain-core',kinds:Chain.KINDS.length}));
console.log('BUILD373_REVENUE_CHAIN_CORE_PASS');
