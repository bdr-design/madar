'use strict';
// Exercise the actual app wrapper with a live-style deadline, not one generator step per call.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {ROOT}=require('./helpers/core-harness'),{scenario}=require('./helpers/business-scenario');
const gate=fs.readFileSync(path.join(__dirname,'build372-fleet-day-worker.cjs'),'utf8');
const fixture=gate.slice(gate.indexOf('function setup(){'),gate.indexOf('const plain='));
const {setup,snapshot}=new Function('scenario','assert','vm','DAY_SOURCE','QUERY_SOURCE',fixture+'\nreturn {setup,snapshot};')(
  scenario,assert,vm,fs.readFileSync(path.join(ROOT,'WebApp/fleet-day-core.js'),'utf8'),fs.readFileSync(path.join(ROOT,'WebApp/fleet-query-core.js'),'utf8'));
const wrapper=fs.readFileSync(path.join(ROOT,'WebApp/app.js'),'utf8').split('\n').find(line=>line.includes('const realismDay=window.GH_REALISM.onDayStages(state,state.lastFinancialDay);for(;;)'));
assert.ok(wrapper,'actual app daily-close wrapper');
const expected=(()=>{const {s,state,day}=setup();state.lastFinancialDay=day;s.GH_REALISM.onDay(state,day);return snapshot(s,state);})();
async function run(kind){
  const {s,state,day,F}=setup();state.lastFinancialDay=day;
  let pending=[],calls=0,waits=0,maxWaitsPerCall=0,accepted=0;const names=[],phases=[];
  if(kind!=='day-absent')s.GH_FLEET_QUERY_PROVIDER=(target,name,params)=>{
    names.push(name);const fault=name==='identityIntegrity'&&['stale','null','absent'].includes(kind)?kind:name==='fleetDay'&&kind.startsWith('day-')?kind.slice(4):null;
    if(fault==='absent')return undefined;
    const result=s.GH_FLEET_QUERY.run(name,target,F,params),revision=target.fleet.revision;
    return new Promise(resolve=>pending.push({at:calls+3,resolve:()=>resolve(fault==='null'?null:{result,current:()=>{accepted++;return fault!=='stale'&&target.fleet.revision===revision;}})}));
  };
  s.state=state;s.probePhase=(_name,work)=>{const out=work();if(typeof out?.value==='string'&&out.value.endsWith('-wait'))waits++;return out;};
  vm.runInContext('function* appDay(){let realismCost;const phase=probePhase;'+wrapper+'\nreturn realismCost;}',s);
  const before=snapshot(s,state),TX=s.GH_TRANSACTION_CORE;
  const h=TX.beginStaged(state,{label:'daily-app-integration',apply:function*(){return yield* s.appDay();}});
  while(!h.done&&calls++<5000){
    const old=waits;h.step(performance.now()+30);maxWaitsPerCall=Math.max(maxWaitsPerCall,waits-old);phases.push(h.stage);
    if(kind==='abort'&&waits){h.abort('integration-abort');break;}
    const ready=pending.filter(p=>p.at<=calls);pending=pending.filter(p=>p.at>calls);for(const p of ready)p.resolve();
    await new Promise(resolve=>setImmediate(resolve));
  }
  assert.equal(h.done,true);assert.ok(maxWaitsPerCall<=1,`worker waits consumed in a task: ${maxWaitsPerCall}`);
  if(kind==='abort'){
    assert.equal(h.error.code,'TRANSACTION_STAGED_ABORTED');assert.deepEqual(snapshot(s,state),before);
    for(const p of pending)p.resolve();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(snapshot(s,state),before);
  }else if(['null','stale','absent','day-null','day-stale','day-absent'].includes(kind)){
    assert.equal(h.error?.message,kind.startsWith('day-')?'fleet-day-worker-unavailable':'realism-identity-worker-unavailable');
    assert.equal(names.includes('identityIntegrity'),!kind.startsWith('day-'),'day evidence must pass before the independent identity failure');
    const after=snapshot(s,state);assert.ok(after.revision>=before.revision&&after.structure>=before.structure,'rollback invalidates stale fleet tokens');assert.deepEqual({...after,revision:before.revision,structure:before.structure},before,'missing current worker evidence rolls back the complete close');
  }else{
    assert.equal(h.error,null,String(h.error?.stack||h.error));assert.equal(h.result.committed,true);
    assert.deepEqual(snapshot(s,state),expected,'financial results and fleet bytes exactly equal the original close');
    if(kind==='success'){assert.ok(accepted>0);assert.ok(phases.some(p=>p.endsWith('-wait')));assert.ok(waits<30,'did not exhaust wait caps');}
  }
  return {kind,calls,waits,maxWaitsPerCall,names,accepted};
}
(async()=>{const results=[];for(const kind of ['success','stale','null','absent','day-stale','day-null','day-absent','abort'])results.push(await run(kind));console.log(JSON.stringify({ok:true,results}));})().catch(e=>{console.error(e);process.exitCode=1;});
