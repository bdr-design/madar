'use strict';
// Build 362 follow-up: HR listed a hotel or resort still under construction as a full staffing gap (60 / 110 people) from
// the first day of building, and "fill every gap" hired and paid that team for the whole build. A facility under
// construction now has no gap; the gap appears when it opens, and the property's own hire fills it exactly.
const assert=require('node:assert/strict'),path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {hospitalityFixture}=require(path.join(ROOT,'tests/helpers/hospitality-fixture.cjs'));
const {s,state,H,command}=hospitalityFixture(),HR=s.GH_HR_CORE;
const gap=()=>HR.snapshot(state,{},'hospitality').facilities.map(row=>[row.needed,row.have,row.missing]);
const quote=H.buildQuote(state,'hospitality',{kind:'hotel',capitalId:'RUH'}),created=command('start-property',{kind:'hotel',capitalId:'RUH',expectedCost:quote.cost});
assert.equal(JSON.stringify(gap()),'[]','no staffing gap while the hotel is being built');
const contractsBefore=HR.ensure(state).employmentContracts.length;
assert.equal(HR.execute({state},'hire',{company:'hospitality'}).total,0,'filling every gap hires no one for a building site');
assert.equal(HR.ensure(state).employmentContracts.length,contractsBefore,'and signs no salary contract');
const q=H.accelerationQuote(state,'hospitality',created.propertyId);command('accelerate-construction',{propertyId:created.propertyId,expectedFee:q.fee,expectedCompleteDay:q.completeDay});
assert.equal(JSON.stringify(gap()),JSON.stringify([[60,0,60]]),'the opened hotel needs its team');
command('hire-property',{propertyId:created.propertyId});
assert.equal(JSON.stringify(gap()),JSON.stringify([[60,60,0]]),'its hire fills the team exactly');
console.log(JSON.stringify({suite:'build362-hospitality-staffing',ok:true}));
