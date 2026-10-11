'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..'),FILE=path.join(ROOT,'WebApp','fleet-main-thread-policy-core.js'),source=fs.readFileSync(FILE,'utf8');

function load(text){const sandbox={module:{exports:{}},exports:{},globalThis:null};sandbox.globalThis=sandbox;vm.createContext(sandbox);vm.runInContext(text,sandbox,{filename:'fleet-main-thread-policy-core.js'});return sandbox.module.exports;}
function contract(P){
  const size=n=>({size(){return n;}}),state={};let calls=0;
  assert.equal(P.DEFAULT_ROW_LIMIT,2048);
  assert.deepEqual({...P.decision(state,size(0),{operation:'empty'})},{allowed:true,rows:0,limit:2048,operation:'empty',reason:'bounded-main-thread-fallback'});
  assert.equal(P.decision(state,size(2048)).allowed,true,'the existing bounded fallback remains exact at the limit');
  assert.equal(P.decision(state,size(2049)).allowed,false,'one row beyond the bound requires the worker');
  const small=P.run(state,size(2048),()=>{calls++;return {exact:-0};},{operation:'simulation-advance'});
  assert.equal(small.executed,true);assert.equal(calls,1);assert.ok(Object.is(small.value.exact,-0));
  const large=P.run(state,size(1_000_000),()=>{calls++;throw new Error('large fallback ran');},{operation:'simulation-advance'});
  assert.equal(large.executed,false);assert.equal(large.reason,'large-fleet-worker-required');assert.equal(large.rows,1_000_000);assert.equal(calls,1,'large fallback callback is never entered');
  const unknown=P.run(state,{size(){throw new Error('bad source');}},()=>{calls++;});assert.equal(unknown.executed,false);assert.equal(unknown.rows,Infinity);assert.equal(calls,1);
  assert.equal(P.run(state,size(9),()=>37,{limit:9}).value,37);
  assert.throws(()=>P.decision(state,size(1),{limit:-1}),/row-limit-invalid/);
  assert.throws(()=>P.run(state,size(1),null),/fallback-function-required/);
}

contract(load(source));
const mutant=source.replace('const rows=rowCount(state,fleet),maximum=rowLimit(limit),allowed=rows<=maximum;','const rows=rowCount(state,fleet),maximum=rowLimit(limit),allowed=true;');
assert.notEqual(mutant,source,'mutation site must remain covered');
assert.throws(()=>contract(load(mutant)),/one row beyond|requires the worker|false/,'the contract kills an accidentally unbounded fallback');
console.log('build372 large-fleet main-thread policy: 11 assertions + mutation passed');
