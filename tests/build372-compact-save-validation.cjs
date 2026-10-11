'use strict';
// Build 372: Save Schema accepts a bounded, revision/context checked fleet-validation answer from the worker. The
// answer must be bit-for-bit equivalent to the former per-row predicates for ordinary faults, must carry Company
// Platform's asset evidence, and must fail closed without a main-thread fleet scan when it is missing or stale.
const assert=require('node:assert/strict'),path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {scenario}=require(path.join(ROOT,'tests/helpers/business-scenario'));
const e=scenario(),s=e.s,state=e.state,FLEET=s.GH_FLEET_DATA,STORE=s.GH_FLEET_STORE,SCHEMA=s.GH_SAVE_SCHEMA,PLATFORM=s.GH_COMPANY_PLATFORM;
e.load('fleet-save-validation-core');e.load('fleet-query-core');
const QUERY=s.GH_FLEET_QUERY,CORE=s.GH_FLEET_SAVE_VALIDATION,results=[];
const test=(name,fn)=>Promise.resolve().then(fn).then(detail=>results.push({name,ok:true,detail}),error=>results.push({name,ok:false,error:String(error?.stack||error).slice(0,4000)}));
const asset=(id,patch={})=>({id,name:`Asset ${id}`,model:'M-1',assetMode:'air',baseFacility:'B1',phase:'idle',progress:0,fuel:100,condition:100,...patch});
const route=(patch={})=>({id:'CUSTOM_AIR',name:'Custom air route',routeMode:'air',ownerCompanyId:'air',fromFacility:'B1',toFacility:'B2',route:[[24.7,46.7],[25.2,47.2]],...patch});
state.saveVersion='3.0.0';
function install(rows,routes=[]){state.fleet=STORE.fromAssets(rows);delete state.assets;state.customRoutes=routes;}
const outcome=options=>{const value=SCHEMA.validate(state,options);return {ok:value.ok,errors:[...value.errors].sort()};};
function summary(){const params=SCHEMA.fleetValidationParams(state),value=QUERY.run('saveValidation',state,FLEET,params);assert.equal(CORE.accepts(value,{rows:FLEET.size(state),routeIds:params.routeIds,contextToken:params.contextToken}),true);return value;}
function compare(label){const reference=outcome({assetScan:'rows'}),evidence=summary(),compact=outcome({fleetValidationResult:evidence,requireFleetValidation:true});assert.deepEqual(compact,reference,`${label}: compact worker evidence must equal the row reference`);return {reference,evidence};}
function noScanData(){return {...FLEET,scan(){throw new Error('unexpected-main-thread-fleet-scan');},forEachFields(){throw new Error('unexpected-main-thread-fleet-scan');},forEachFieldClasses(){throw new Error('unexpected-main-thread-fleet-scan');},idCollisions(){throw new Error('unexpected-main-thread-fleet-scan');}};}
async function runSteps(options){const steps=SCHEMA.validationSteps(state,options),yields=[];let value=steps.next();while(!value.done){yields.push(value.value);await Promise.resolve();value=steps.next();}return {out:{ok:value.value.ok,errors:[...value.value.errors].sort()},yields};}

(async()=>{
  await test('healthy built-in and legacy modes without explicit owners retain original owner resolution',()=>{
    const airDefinition=PLATFORM.getDefinition('air');install([asset('AIR-1'),asset('MOB-1',{assetMode:'mobility'}),asset('DEF-1',{ownerCompanyId:airDefinition.definitionId})]);const {reference,evidence}=compare('legacy owner and definition id');assert.equal(reference.ok,true,JSON.stringify(reference.errors));assert.equal(evidence.companyPlatform.errors.length,0);return {rows:evidence.logicalRows,bytes:JSON.stringify(evidence).length};
  });

  await test('route owner uses the resolved legacy owner and custom capacity stays exact',()=>{
    install(Array.from({length:32},(_,i)=>asset(`ROUTE-${i}`,{routeId:'CUSTOM_AIR',phase:'turnaround'})),[route({fleetCapacity:32})]);let checked=compare('custom route at capacity');assert.equal(checked.reference.errors.includes('asset-route-company'),false);assert.equal(checked.reference.errors.includes('asset-route-capacity'),false);
    install([asset('MISMATCH-1',{routeId:'CUSTOM_AIR',phase:'turnaround'})],[route({ownerCompanyId:'road'})]);checked=compare('resolved owner mismatch');assert(checked.reference.errors.includes('asset-route-company'));
    install([asset('NUMERIC-ROUTE',{routeId:7,phase:'turnaround'})],[route({id:7})]);checked=compare('numeric route identity');assert.equal(checked.reference.ok,true,JSON.stringify(checked.reference.errors));
    install(Array.from({length:33},(_,i)=>asset(`OVER-${i}`,{routeId:'CUSTOM_AIR',phase:'turnaround'})),[route({fleetCapacity:32})]);checked=compare('custom route over capacity');assert(checked.reference.errors.includes('asset-route-capacity'));return checked.reference.errors;
  });

  await test('unknown route users still contribute the original capacity error',()=>{
    install(Array.from({length:25},(_,i)=>asset(`UNKNOWN-${i}`,{routeId:'AIR_UNKNOWN',phase:'turnaround'})));const {reference}=compare('unknown route over capacity');assert(reference.errors.includes('asset-route-reference'));assert(reference.errors.includes('asset-route-capacity'));return reference.errors;
  });

  await test('worker text checks call the same identity inspector as Save Schema',()=>{
    const identity=s.GH_IDENTITY,raw='identity-inspector-only-rejection';s.GH_IDENTITY={...identity,inspectPlainText(value,options){if(value===raw)return {ok:false,error:'test-rejection'};return identity.inspectPlainText(value,options);}};
    try{install([asset('TEXT-1',{name:raw})]);const {reference}=compare('identity inspector');assert(reference.errors.includes('display-text-assets-name'));return reference.errors;}finally{s.GH_IDENTITY=identity;}
  });

  await test('company reference and class evidence is identical and avoids its second fleet scan',()=>{
    install([asset('COMPANY-1',{ownerCompanyId:'ghost'}),asset('CLASS-1',{assetClass:'Wide_Body'}),asset('GOOD-1')]);const {reference,evidence}=compare('company evidence');assert(reference.errors.includes('company-platform:asset-company-reference:COMPANY-1'));assert(reference.errors.includes('company-platform:asset-class:CLASS-1'));
    const original=s.GH_FLEET_DATA;s.GH_FLEET_DATA=noScanData();try{assert.deepEqual(outcome({fleetValidationResult:evidence,requireFleetValidation:true}),reference);}finally{s.GH_FLEET_DATA=original;}
    return evidence.companyPlatform.errors;
  });

  await test('duplicates, presentation faults and numeric faults preserve the complete error set',()=>{
    install([asset('DUP',{name:'<unsafe>',fuel:101,coords:[999,0],photo:'javascript:bad'}),asset('DUP',{condition:-1,progress:2})]);const {reference}=compare('mixed faults');for(const code of ['asset-id','asset-fuel','asset-condition','asset-progress','display-text-assets-name','display-image-assets-photo','display-coords-assets'])assert(reference.errors.includes(code),code);return reference.errors;
  });

  await test('async provider waits once and accepts only a current answer',async()=>{
    install([asset('ASYNC-1'),asset('ASYNC-2')]);const evidence=summary(),reference=outcome({assetScan:'rows'}),run=await runSteps({fleetValidation:()=>Promise.resolve({result:evidence,current:()=>true}),requireFleetValidation:true});assert.deepEqual(run.out,reference);assert(run.yields.includes('fleet-validation-wait'));return {waits:run.yields.filter(value=>value==='fleet-validation-wait').length};
  });

  await test('missing, stale and context-mismatched answers fail closed without any fleet scan',()=>{
    install([asset('STALE-1'),asset('STALE-2')]);const evidence=summary(),badContext={...evidence,contextToken:`${evidence.contextToken}:stale`},original=s.GH_FLEET_DATA;s.GH_FLEET_DATA=noScanData();
    try{
      for(const candidate of [null,badContext,{result:evidence,current:()=>false}]){const result=outcome({fleetValidationResult:candidate,requireFleetValidation:true});assert.equal(result.ok,false);assert(result.errors.includes('fleet-validation-unavailable'));assert(result.errors.includes('company-platform:asset-validation-unavailable'));}
    }finally{s.GH_FLEET_DATA=original;}
    return 'fail-closed';
  });

  await test('healthy evidence size is independent of unique fleet names and ids',()=>{
    install(Array.from({length:5000},(_,i)=>asset(`UNIQUE-${i}`,{name:`Unique aircraft ${i}`})));const evidence=summary(),bytes=Buffer.byteLength(JSON.stringify(evidence));assert.equal(evidence.logicalRows,5000);assert(bytes<64*1024,`bounded evidence was ${bytes} bytes`);assert.equal(Object.prototype.hasOwnProperty.call(evidence,'rows'),false);return {rows:evidence.logicalRows,bytes};
  });

  await test('pathological company faults are capped and make the save fail closed',()=>{
    install(Array.from({length:1100},(_,i)=>asset(`FAULT-${i}`,{ownerCompanyId:'ghost'})));const evidence=summary();assert.equal(evidence.companyPlatform.errors.length,CORE.COMPANY_ERROR_LIMIT);assert.equal(evidence.companyPlatform.overflow,true);const result=outcome({fleetValidationResult:evidence,requireFleetValidation:true});assert.equal(result.ok,false);assert(result.errors.includes('company-platform:asset-validation-overflow'));return {reported:evidence.companyPlatform.errors.length,overflow:evidence.companyPlatform.overflow};
  });

  const passed=results.filter(row=>row.ok).length;console.log(JSON.stringify({suite:'build372-compact-save-validation',passed,total:results.length,results},null,2));if(passed!==results.length)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
