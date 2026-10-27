'use strict';
// GH_ENERGY_CORE.ensure() runs on every energy page and power-plant desk render; it copied each of its 13 arrays and the
// offers on every call (about 36 microseconds a call here, with 400 history rows), writing the live state outside a
// transaction. An array with nothing to drop is now kept. Proven on the real energy owner against the source before
// (e2160b5, from its own tree), each in its own process, on worlds with clean arrays, arrays holding nulls, zeros and empty
// strings, missing or non-array fields, a frozen array and more than 240 offers:
//  1. the state after one ensure and after a second is the previous source's, field for field;
//  2. on clean arrays a repeated ensure keeps every array (the previous source replaced all 13 and the offers every call);
//  3. rows to drop are dropped, a frozen array is still copied (so a later push cannot throw), the offers are still cut
//     to the last 240.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..'),PREVIOUS='e2160b5';
const KEYS=['sites','ppaOffers','ppaContracts','dailyHistory','outages','maintenancePlans','fuelContracts','projectFinance','dispatchInstructions','renewableCertificates','tenders','tenderHistory'];
if(process.argv[2]==='--measure'){
  process.env.GH_TEST_SOURCE_DIR=process.argv[3];
  const {harness,minimal}=require(path.join(process.argv[3],'tests/helpers/core-harness'));
  const worlds={
    clean:()=>({dailyHistory:Array.from({length:400},(_,i)=>({day:i,mwh:i*3})),ppaOffers:Array.from({length:120},(_,i)=>({id:'O'+i})),outages:[{id:'X1',siteId:'S1',status:'منتهي'}],tenders:[{id:'T1'}],tenderHistory:[{id:'H1'}]}),
    holes:()=>({dailyHistory:[{day:1},null,{day:2},0,''],ppaOffers:[null,{id:'O1'}],outages:[false,{id:'X'}],tenders:[null],tenderHistory:[{id:'H'},undefined]}),
    missing:()=>({dailyHistory:'not an array',outages:null}),
    frozen:()=>({dailyHistory:Object.freeze([{day:1},{day:2}]),ppaOffers:Object.freeze([{id:'O1'}])}),
    offers:()=>({ppaOffers:Array.from({length:300},(_,i)=>({id:'O'+i}))})
  };
  const out={};
  for(const [name,make] of Object.entries(worlds)){
    const {s}=harness(['energy-core']),E=s.GH_ENERGY_CORE,state={...minimal(),energy:make()};
    E.ensure(state);const first=JSON.stringify(state.energy),before=KEYS.map(key=>state.energy[key]);
    E.ensure(state);const second=JSON.stringify(state.energy),kept=KEYS.filter((key,i)=>state.energy[key]===before[i]).length;
    const lengths=Object.fromEntries(KEYS.map(key=>[key,state.energy[key].length]));
    let push='ok';try{state.energy.dailyHistory.push({day:99});state.energy.ppaOffers.push({id:'late'});}catch(error){push=error.name;}
    out[name]={first,second,kept,push,lengths};
  }
  process.stdout.write(JSON.stringify(out));
  return;
}
const measure=tree=>JSON.parse(execFileSync(process.execPath,[__filename,'--measure',tree],{encoding:'utf8',maxBuffer:1<<26}));
const before=fs.mkdtempSync(path.join(os.tmpdir(),'gh-b588-'));
try{
  const archive=path.join(before,'previous.tar');execFileSync('git',['-C',process.env.GH_B588_GIT_DIR||ROOT,'archive','-o',archive,PREVIOUS,'WebApp','tests/helpers']);execFileSync('tar',['-xf',archive,'-C',before]);fs.rmSync(archive);
  const old=measure(before),now=measure(ROOT);
  for(const name of Object.keys(old)){
    // 1.
    assert.equal(now[name].first,old[name].first,`1: ${name}: the state after ensure is the previous source's`);
    assert.equal(now[name].second,old[name].second,`1: ${name}: and after a second ensure`);
    assert.deepEqual(now[name].lengths,old[name].lengths,`1: ${name}: the same rows`);
    assert.equal(now[name].push,'ok',`3: ${name}: a later push works`);assert.equal(old[name].push,'ok');
  }
  // 2.
  assert.equal(old.clean.kept,0,'the previous source replaced every array on every ensure');
  assert.equal(now.clean.kept,KEYS.length,`2: on clean arrays a repeated ensure keeps every array (${now.clean.kept} of ${KEYS.length})`);
  // 3.
  assert.equal(now.holes.lengths.dailyHistory,2,'3: rows to drop are dropped');assert.equal(now.offers.lengths.ppaOffers,240,'3: the offers are cut to 240');
  console.log(JSON.stringify({suite:'build588-energy-ensure-rows',ok:true,worlds:Object.keys(now).length,cleanKept:{previous:old.clean.kept,current:now.clean.kept}}));
}finally{fs.rmSync(before,{recursive:true,force:true});}
