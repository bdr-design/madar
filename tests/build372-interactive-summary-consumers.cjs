'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..'),web=file=>path.join(ROOT,'WebApp',file);
const SUMMARY=require(web('fleet-ui-summary-core.js'));

let scans=0;
global.GH_FLEET_DATA={size:()=>1_000_000,forEach(){scans++;throw new Error('million-row-main-thread-scan');},some(){scans++;throw new Error('million-row-main-thread-scan');},filter(){scans++;throw new Error('million-row-main-thread-scan');}};
global.GH_FLEET_UI_SUMMARY=SUMMARY;
global.GH_FINANCE_CORE={book:(state,id)=>state.companyFinance[id]||null,total:(state,id)=>Number(state.companyFinance[id]?.accounts?.[0]?.balance)||0};
delete global.GH_COMPANY_PLATFORM;
const BANK=require(web('banking-core.js'));
const bankState={simSeconds:99,openedCompanies:['air','sea'],profile:{},companyRegistry:{},companyFinance:{group:{accounts:[{balance:1_000_000}],debt:0},air:{accounts:[{balance:20_000_000}],debt:2_000_000},sea:{accounts:[{balance:10_000_000}],debt:30_000_000}},bank:{corporateClients:{air:{company:'air'},sea:{company:'sea'}}}};
const bankResult={schema:SUMMARY.SCHEMA,legacy:false,owners:[['group',{bankCollateral55:0}],['air',{bankCollateral55:12_345_678}],['sea',{bankCollateral55:3_333_333}]],modes:[],types:[],bases:[],facilities:[],staffing:{companies:[]}},bankProof={result:bankResult,lookup:SUMMARY.lookup(bankResult),current:target=>target===bankState};
BANK.execute({state:bankState,fleetSummary:bankProof},'review-limits',{});
const expected=(cash,collateral,debt)=>Math.max(5_000_000,Math.round(Math.max(5_000_000,cash*.35+collateral*.12-debt*.08)/100_000)*100_000);
assert.equal(bankState.bank.corporateClients.air.creditLimit,expected(20_000_000,12_345_678,2_000_000));
assert.equal(bankState.bank.corporateClients.sea.creditLimit,expected(10_000_000,3_333_333,30_000_000));
assert.equal(bankState.bank.riskReviews[0].collateralSource,'worker');assert.equal(scans,0);
assert.throws(()=>BANK.execute({state:bankState,fleetSummary:{...bankProof,current:()=>false}},'review-limits',{}),/bank-fleet-summary-required/,'stale bank proof fails closed');assert.equal(scans,0);

global.GH_COMPANY_PLATFORM={requireCompany:(_state,id)=>({id,operational:true}),getDefinition:()=>null,definitionFor:()=>null};
const FACILITY=require(web('facility-core.js'));
const facilityState=()=>({simSeconds:1,globalBases:[{id:'B1',name:'Base',kind:'airport-base',owned:true,ownerCompanyId:'air',dailyCost:0}],customHubs:[],branches:[],advanced:{facilities:{B1:{staff:0,history:[]}},labor:{employmentContracts:[]}},energy:{},fleet:{}});
const facilityResult=count=>({schema:SUMMARY.SCHEMA,legacy:false,owners:[],modes:[],types:[],bases:[['B1',count]],facilities:[],staffing:{companies:[]}}),facilityProof=(state,count,current=true)=>{const result=facilityResult(count);return {result,lookup:SUMMARY.lookup(result),current:target=>current&&target===state};};
let state=facilityState(),proof=facilityProof(state,1);assert.deepEqual(FACILITY.validate({state,fleetSummary:proof},'close',{id:'B1',company:'air'}),{ok:false,reason:'facility-has-assets'});assert.equal(scans,0);
state=facilityState();proof=facilityProof(state,0);assert.equal(FACILITY.validate({state,fleetSummary:proof},'close',{id:'B1',company:'air'}),true);assert.equal(FACILITY.execute({state,fleetSummary:proof},'close',{id:'B1',company:'air',settlement:0}),true);assert.equal(state.globalBases.length,0);assert.equal(scans,0);
state=facilityState();proof=facilityProof(state,0,false);assert.deepEqual(FACILITY.validate({state,fleetSummary:proof},'close',{id:'B1',company:'air'}),{ok:false,reason:'facility-fleet-summary-required'});assert.equal(scans,0);

// Static gates keep future edits from quietly restoring the exact interactive
// scans this change removes. Bounded small-fleet fallback helpers may scan,
// but the large render/command paths must consume summary data.
const advanced=fs.readFileSync(web('advanced-core.js'),'utf8'),conference=fs.readFileSync(web('conference-core.js'),'utf8'),banking=fs.readFileSync(web('banking-core.js'),'utf8'),facility=fs.readFileSync(web('facility-core.js'),'utf8');
assert.doesNotMatch(advanced,/const assets\s*=\s*fleetData\(\)\.filter/);
assert.doesNotMatch(advanced,/operations\.fleet'\)\)\{const hasAssets=fleetData\(\)\.some/);
assert.doesNotMatch(conference,/fleetData\(\)\.filter/);
assert.doesNotMatch(banking,/review-limits'[\s\S]{0,500}fleetData\(\)\.filter/);
assert.doesNotMatch(facility,/cmd==='close'&&fleetData\(\)\.some/);
console.log(JSON.stringify({ok:true,mainThreadScans:scans,bankClients:2,facilityProofs:3}));
