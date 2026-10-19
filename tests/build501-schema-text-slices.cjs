'use strict';
// iPhone diagnostic DX-1792378248326 (980,000 assets, 2,343 invoices): every command's schema check spent one 8-20 ms
// block on the main thread ('command.schema'). The fleet-routes step began with the identity, conference and display
// text checks over every invoice, payable, receivable, contract, mobility vehicle and endpoint, with no host yield, and
// rebuilt the fleet validation params (a second contextToken) even when the worker answer was used without any wait.
// Maintenance schema passes had only fleetClasses, so company-platform scanned classes on the main thread (24 ms).
// Proven here, against the previous save-schema.js run in an isolated process:
//  1. the same validation result (ok and the exact ordered errors) on a valid state and on a state broken in every
//     display-text bucket, through validate() and through the stepped sections;
//  2. with a clock past the 4 ms budget the text checks give the host 'presentation-text' turns; the old code had none;
//  3. a synchronous worker answer no longer rebuilds the params (one contextToken instead of two); after a real wait the
//     context is still read again;
//  4. maintenance schema passes take the worker's validation evidence through the existing client only.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {scenario}=require(path.join(ROOT,'tests/helpers/business-scenario'));

function cases(){
  const e=scenario(),{s,state}=e,Schema=s.GH_SAVE_SCHEMA,out={};
  e.command('finance','issue-invoice',{kind:'مصروف',amount:1000,company:'air',counterparty:'Supplier LLC',note:'QA open payable'});
  const clone=value=>JSON.parse(JSON.stringify(value));
  const run=(label,mutate)=>{
    const original=clone(state.finance),mobility=clone(state.mobility||null),registry=clone(state.contractRegistry||null),routes=clone(state.customRoutes||[]),reports=clone(state.finance?.payrollReports||null);
    mutate(state);
    const whole=Schema.validate(state),steps=Schema.validationSteps(state),names=[];let step;while(!(step=steps.next()).done)names.push(step.value);
    out[label]={ok:whole.ok,errors:whole.errors,steppedOk:step.value.ok,steppedErrors:step.value.errors,names};
    state.finance=original;if(mobility===null)delete state.mobility;else state.mobility=mobility;if(registry===null)delete state.contractRegistry;else state.contractRegistry=registry;state.customRoutes=routes;if(reports!==null)state.finance.payrollReports=reports;
  };
  run('valid',()=>{});
  run('invoice-note',target=>{target.finance.invoices.find(row=>row.status!=='paid'||true).note='<script>';});
  run('payable-counterparty',target=>{const row=target.finance.payables[0]||target.finance.invoices[0];row.counterparty='bad‮text';});
  run('mobility-name',target=>{target.mobility=target.mobility||{};target.mobility.vehicles=[{id:'MV-1',name:'ok'},{id:'MV-2',name:'<b>'},{id:'bad"id'}];});
  run('contract-status',target=>{target.contractRegistry={...(target.contractRegistry||{}),'QA-C1':{status:'<x>',number:'QA-C1'}};});
  run('route-name',target=>{target.customRoutes=[...(target.customRoutes||[]),{id:'QA-R1',name:'<route>'}];});
  run('payroll-month',target=>{target.finance.payrollReports=[{month:'<m>',day:'1'}];});
  return out;
}

if(process.env.GH_SCHEMA_TEXT_CHILD==='1'){process.stdout.write(JSON.stringify(cases()));return;}

// 1. Exact parity with the previous save-schema.js (git HEAD of this change) on valid and broken states.
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'madar-schema-text-old-'));
try{
  fs.cpSync(path.join(ROOT,'WebApp'),path.join(tmp,'WebApp'),{recursive:true});fs.cpSync(path.join(ROOT,'tests'),path.join(tmp,'tests'),{recursive:true});
  const previous=execFileSync('git',['-C',process.env.GH_SCHEMA_TEXT_GIT_DIR||ROOT,'show','23f6be66d960d75a2425e1f054b9f9e62d109557:WebApp/save-schema.js'],{encoding:'utf8',maxBuffer:64*1024*1024});
  assert.ok(previous.includes('function validatePresentationTextState(')&&!previous.includes("'presentation-text'"),'the baseline is the unsliced implementation');
  fs.writeFileSync(path.join(tmp,'WebApp','save-schema.js'),previous);
  const old=JSON.parse(execFileSync(process.execPath,[__filename],{env:{...process.env,GH_TEST_SOURCE_DIR:tmp,GH_SCHEMA_TEXT_CHILD:'1'},encoding:'utf8',maxBuffer:64*1024*1024}));
  const current=JSON.parse(JSON.stringify(cases()));
  assert.deepEqual(Object.keys(current),Object.keys(old));
  for(const [label,row] of Object.entries(current)){
    assert.equal(row.ok,old[label].ok,`${label}: same verdict`);assert.deepEqual(row.errors,old[label].errors,`${label}: same ordered errors`);
    assert.equal(row.steppedOk,row.ok,`${label}: stepped verdict equals validate()`);assert.deepEqual(row.steppedErrors,row.errors,`${label}: stepped errors equal validate()`);
    if(label!=='valid')assert.equal(row.ok,false,`${label}: the broken bucket is still found`);
  }
  assert.equal(current.valid.ok,true,'the valid state still validates');
  for(const [label,code] of [['invoice-note','display-text-invoices-note'],['mobility-name','display-text-mobility-name'],['contract-status','display-text-contract-status'],['route-name','display-text-route-name'],['payroll-month','display-text-payroll-month']])assert.ok(current[label].errors.includes(code),`${label}: ${code}`);
  console.log('PASS same ordered result as the previous implementation on valid and broken states');
}finally{fs.rmSync(tmp,{recursive:true,force:true});}

// 2. Past the budget the text checks yield to the host; time between them is not counted as section work.
{
  const e=scenario(),{s,state}=e,Schema=s.GH_SAVE_SCHEMA;
  const real=s.performance;let now=1000;s.performance={now:()=>(now+=1)};
  try{
    const steps=Schema.validationSteps(state),names=[];let step;while(!(step=steps.next()).done){names.push(step.value);if(step.value==='presentation-text')now+=500;}
    const turns=names.filter(name=>name==='presentation-text').length,firstFleet=names.indexOf('fleet-routes');
    assert.ok(turns>=3,`the text checks give the host several turns: ${turns}`);
    assert.ok(names.lastIndexOf('presentation-text')<firstFleet,'all text turns come before the fleet-routes section ends');
    assert.equal(step.value.ok,true,'the stepped result is unchanged');
    const sample=Schema.telemetry().lastValidation.sectionSamples.find(row=>row.name==='fleet-routes');assert.ok(sample&&sample.durationMs<500,`paused host time is excluded: ${sample?.durationMs}`);
    console.log(`PASS text checks yield ${turns} host turns past 4 ms`);
  }finally{s.performance=real;}
}

// 3. A ready worker answer is accepted without rebuilding the params; after a real wait the context is read again.
{
  const e=scenario(),{s,state}=e,Schema=s.GH_SAVE_SCHEMA;e.load('fleet-save-validation-core');const real=s.GH_FLEET_SAVE_VALIDATION;assert.ok(real?.contextToken,'the worker validation core is loaded');
  let tokens=0;s.GH_FLEET_SAVE_VALIDATION={...real,contextToken(params){tokens++;return real.contextToken(params);},accepts(){return false;}};
  try{
    const ready=()=>({result:{},current:()=>true});
    const drain=options=>{const steps=Schema.validationSteps(state,options);let step;while(!(step=steps.next()).done){}return step.value;};
    tokens=0;drain({fleetValidation:()=>ready()});assert.equal(tokens,1,'synchronous answer: one contextToken (params only)');
    tokens=0;drain({fleetValidation:()=>Promise.resolve(ready())});
    // The promise settles only after a microtask; a drained generator cannot wait, so emulate the wait across turns.
    const steps=Schema.validationSteps(state,{fleetValidation:()=>Promise.resolve(ready())});tokens=0;
    (async()=>{let step;for(;;){step=steps.next();if(step.done)break;if(step.value==='fleet-validation-wait')await Promise.resolve();}
      assert.equal(tokens,2,'after a real wait the params are read again');console.log('PASS ready answers skip the rebuilt params; waited answers keep the recheck');})().catch(error=>{console.error(error);process.exitCode=1;});
  }finally{queueMicrotask(()=>{s.GH_FLEET_SAVE_VALIDATION=real;});}
}

// 4. Maintenance wiring.
{
  const app=fs.readFileSync(path.join(ROOT,'WebApp/app.js'),'utf8'),schema=fs.readFileSync(path.join(ROOT,'WebApp/save-schema.js'),'utf8');
  assert.equal((app.match(/validationSteps\(state,\{trustVerified:true,fleetClasses:fleetClassesForValidation,fleetValidation:maintenanceFleetValidation\}\)/g)||[]).length,2,'both maintenance schema constructions take the worker evidence');
  assert.match(app,/function maintenanceFleetValidation\(s,params\)\{return fleetEngineThreadClient\?globalThis\.GH_FLEET_VALIDATION_PROVIDER\?\.\(s,params\)\|\|null:null;\}/,'existing client only, never starting a worker');
  assert.ok(!/requireFleetValidation/.test(app.slice(app.indexOf('function schemaSectionsTask'),app.indexOf('function haltOnGlobalFault'))),'maintenance stays non fail-closed (a missing answer falls back to classes)');
  assert.ok(!schema.includes('validatePresentationTextState'),'the unsliced text pass is removed, not kept beside the stepped one');
  assert.match(app,/contextToken=typeof params\?\.contextToken==='string'&&params\.contextToken\?params\.contextToken:/,'the provider reuses the token its params already carry');
  console.log('PASS maintenance takes worker evidence; the old text pass is removed');
}
