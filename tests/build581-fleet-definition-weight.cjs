'use strict';
// The fleet's worker inputs listed every installed company type on every call: save-schema's fleet validation
// parameters (a pass over every definition, per simulation leg, integrity check and save validation), the validation and
// evidence tokens built from them (the names stringified per call), realism's fleet-day descriptor (a pass over every
// definition and two platform resolves per name, on each of the day close's 3-6 calls) and the fleet dispatch ownership
// snapshot (every type resolved and its row rebuilt, three times per dispatch batch). Once the Company Platform is
// sealed none of that can change: the names and the legacy owners are read once per sealed platform and shared, frozen,
// their JSON kept with them; only 'group', the registry keys and the opened ids are resolved per call. Proven on the
// real platform, save-schema and fleet validation owners and the exact source of realism's descriptor and of app.js's
// token and snapshot, this tree against the source before the change (PREVIOUS, from its own tree), both on PREVIOUS's
// definitions file, each with 0 and with 10 synthetic data-only definitions, on a sealed platform:
//  1. every output is the previous one, on every world (the holding alone; every type opened with records; a dynamic
//     instance, a record naming another definition, an untrimmed opened id, a record outside the registry's keys, a
//     string openedCompanies): the validation parameters and their token, the evidence token, the fleet-day descriptor
//     and its context key, and the dispatch snapshot (key for key, as its digest sees it);
//  2. after a warm-up call, no call visits a definition or lists every type: the validation parameters, the tokens, the
//     descriptor (resolves only 'group' and the registry keys) and the snapshot on every world but those that fall back
//     to the previous reading; the previous source visits every definition per call and grows with the types;
//  3. the shared parts cannot go stale or be written: before the seal a definition installed between two calls is seen,
//     after it installing throws and nothing changes, the shared arrays and rows are frozen, and an unfrozen params
//     object is read afresh by both tokens.
// Desktop Node counts; nothing here is a claim about iPhone time.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm'),{execFileSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'),PREVIOUS='00380f6',K=10,TYPES=['air','sea','road','power','bank','mobility','insurance','realestate','telecom','dealership','hospitality'],MARK='assets/identity/group-default.svg';
function syntheticDefinition(i){
  const nn=String(i).padStart(2,'0'),id=`synth-${nn}`,prefix=`SY${String.fromCharCode(64+i)}`;
  return {schema:'gh-company-definition/v1',id,definitionId:`gh-${id}-v1`,definitionVersion:1,order:120+i,kind:'subsidiary',lifecycle:'active',
    identity:{legalDefault:{ar:`شركة ${id}`,en:`${id} Company`},trade:{ar:`تجارة ${id}`,en:id.toUpperCase()},short:`SY${nn}`,legacyLegalNames:[],marks:{default:MARK,symbol:MARK,horizontal:MARK,seal:MARK,mono:MARK},palette:{accent:'#2d72df',secondary:'#0d3b57',route:'#2d72df',onAccent:'#ffffff'},hero:'assets/images/company-hq-v2.webp'},
    classification:{primarySectorId:id,sectorIds:[id],operationProfileId:'hospitality-operations-v1',assetClasses:[],routeModes:[]},
    capabilities:['company.core','finance.book','finance.budget','finance.tax','hr.management','documents.identity','documents.signature','map.company','conference.participant'],
    founding:{defaultCapital:10000000,minimumCapital:10000000,legalForm:'شركة تابعة مملوكة للمجموعة',checklistIds:['commercial-registration']},
    finance:{accountPrefix:prefix,documentPrefix:prefix,collectionProfileId:'hospitality-revenue-v1',currency:'USD',vatEnabled:true,internalBankEligible:true},
    hr:{managerRoleProfileId:'ceo-hospitality-v1',staffingProfileId:'hospitality-site-v1'},
    facilities:{directoryProviderIds:['world-capitals'],allowedKinds:['hotel'],primaryKind:'hotel',siteTemplate:{label:'موقع',facilityKind:'hotel',cost:6000000,dailyCost:9500,capacity:'220',deliveryCapacity:0,photo:'assets/images/company-hq-v2.webp',iconKey:'hq',groupValueFactor:.72}},
    ui:{shell:'generic-company-v1',tabs:['overview','management','operations','people','finance'],extensions:[]},
    map:{layerProviderIds:['company-facilities'],filterGroup:'services',markerProfileId:'hotel'},conference:{providerId:'generic-company-v1',order:120+i},
    adapters:{lifecycle:'generic-company-v1',operations:'standard-company-operations-v1',finance:'standard-company-finance-v1',hr:'standard-company-hr-v1',facilities:'standard-company-facilities-v1',map:'company-map-v1',conference:'generic-company-v1',documents:'legal-documents-v1'},
    legacy:{companyAliases:[],sectorAliases:[],assetOwnerModes:[],routeOwnerModes:[],assetClassByMode:{}}};
}
// Sorted-key JSON: what the dispatch digest (authorization stable()) sees.
const canonical=value=>value&&typeof value==='object'?Array.isArray(value)?`[${value.map(canonical).join(',')}]`:`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`:JSON.stringify(value);
const slice=(text,start,end)=>{const a=text.indexOf(start),b=text.indexOf(end,a);if(a<0||b<0)throw new Error(`slice not found: ${start.slice(0,40)}`);return text.slice(a,b);};
if(process.argv[2]==='--measure'){
  const root=process.argv[3],k=Number(process.argv[4]);process.env.GH_TEST_SOURCE_DIR=root;
  const {harness,minimal}=require(path.join(root,'tests/helpers/core-harness'));
  const h=harness(['capability-registry-core','company-definitions','company-platform-core','company-adapters-core']),{s}=h,P=s.GH_COMPANY_PLATFORM;
  for(let i=1;i<=k;i++)P.installDefinition(syntheticDefinition(i),{source:'weight-gate'});
  vm.runInContext(`(()=>{const values=Map.prototype.values;globalThis.__GH_VISITS__={rows:0};Map.prototype.values=function(){if(this.size>0){const first=this.entries().next().value[1];if(first&&typeof first==='object'&&first.schema==='gh-company-definition/v1')__GH_VISITS__.rows+=this.size;}return values.call(this);};})()`,s);
  for(const name of ['identity-system','fleet-save-validation-core','save-schema'])h.load(name);
  const counts={lists:0,full:0,resolve:0,definitions:0},visits=()=>s.__GH_VISITS__.rows;
  const W=Object.freeze({...P,listDefinitions(...args){counts.definitions++;return P.listDefinitions(...args);},listInstances(state,options={}){counts.lists++;if(options.heldOnly!==true&&options.openedOnly!==true)counts.full++;return P.listInstances(state,options);},resolveCompany(...args){counts.resolve++;return P.resolveCompany(...args);}});
  s.GH_COMPANY_PLATFORM=W;
  const S=s.GH_SAVE_SCHEMA,V=s.GH_FLEET_SAVE_VALIDATION,app=fs.readFileSync(path.join(root,'WebApp/app.js'),'utf8'),realism=fs.readFileSync(path.join(root,'WebApp/realism-core.js'),'utf8');
  const box={window:{GH_SAVE_SCHEMA:S},COMPANY_PLATFORM:W,platform:()=>W,LEGACY_TYPES:['group','air','sea','road','power','bank','mobility'],JSON};vm.createContext(box);
  const fleetDayStart=realism.includes('  let fleetDayStatics=null;')?'  // The definition-derived names (each definition':'  function fleetDayWorkerParams(state){';
  const snapshotStart=app.includes('  let fleetDispatchOwnershipStatic=null;')?"  // A definition id that is not 'group', not a registry key":'  function fleetDispatchOwnershipSnapshot(target){';
  vm.runInContext([slice(app,'  const companyFleetEvidence=new WeakMap()','  function rememberCompanyFleetEvidence'),slice(realism,fleetDayStart,'  // JSON alone collapses NaN'),slice(realism,'  const fleetDayNumberKey=','\n'),slice(realism,'  const fleetDayContextKey=','\n'),slice(app,snapshotStart,'  function fleetDispatchRevision('),'this.api={companyEvidenceToken,fleetDayWorkerParams,fleetDispatchOwnershipSnapshot,fleetDayContextKey:typeof fleetDayContextKey==="function"?fleetDayContextKey:null};'].join('\n'),box);
  const api=box.api;
  const base=extra=>({...minimal(),profile:{name:'G'},onboardingComplete:true,simSeconds:86400,customRoutes:[],realism:{economy:{airDemand:1,bunker:600}},advanced:{companies:{}},...extra});
  const worlds={
    group:base({companyRegistry:{group:{}},openedCompanies:[]}),
    all:base({companyRegistry:{group:{},...Object.fromEntries(TYPES.map(id=>[id,{definitionId:P.getDefinition(id).definitionId}]))},openedCompanies:TYPES,advanced:{companies:{air:{maintenancePolicy:'balanced'}}}}),
    mixed:base({companyRegistry:{group:{},'air-east':{definitionId:'gh-air-v1'},bank:{definitionId:'gh-bank-v1'}},openedCompanies:['air-east',' sea']}),
    redirected:base({companyRegistry:{group:{},air:{definitionId:'future-air-v1'}},openedCompanies:['air']}),
    arrayRegistry:base({companyRegistry:Object.assign([],{road:{definitionId:'gh-logistics-v1'}}),openedCompanies:['bank']}),
    text:base({companyRegistry:{group:{}},openedCompanies:'air'}),
  };
  if(k)worlds.synthetic=base({companyRegistry:{group:{},'synth-01':{definitionId:'gh-synth-01-v1'}},openedCompanies:['synth-01']});
  const window=fn=>{const v0=visits(),c0={...counts},value=fn();return {value,visits:visits()-v0,lists:counts.lists-c0.lists,full:counts.full-c0.full,resolve:counts.resolve-c0.resolve,definitions:counts.definitions-c0.definitions};};
  // 3a. Before the seal a definition installed between two calls is seen.
  const unsealed={};
  {const before=S.fleetValidationParams(worlds.group).definitionCompanies.length,day=api.fleetDayWorkerParams(worlds.group).ownerResolution.knownCompanies.length,snap=Object.keys(api.fleetDispatchOwnershipSnapshot(worlds.group).definitions).length;
   P.installDefinition({...syntheticDefinition(20),id:'synth-late',definitionId:'gh-synth-late-v1',finance:{...syntheticDefinition(20).finance,accountPrefix:'SYLT',documentPrefix:'SYLT'},identity:{...syntheticDefinition(20).identity,short:'SYLT'},classification:{...syntheticDefinition(20).classification,primarySectorId:'synth-late',sectorIds:['synth-late']}},{source:'weight-gate'});
   unsealed.validation=S.fleetValidationParams(worlds.group).definitionCompanies.length-before;unsealed.day=api.fleetDayWorkerParams(worlds.group).ownerResolution.knownCompanies.length-day;unsealed.snapshot=Object.keys(api.fleetDispatchOwnershipSnapshot(worlds.group).definitions).length-snap;}
  P.seal({runtimeCheck:false});let refusal='';try{P.installDefinition(syntheticDefinition(30),{source:'late'});}catch(error){refusal=String(error.message);}
  const out={};
  for(const [name,state] of Object.entries(worlds)){
    const params0=S.fleetValidationParams(state);api.companyEvidenceToken(params0);api.fleetDayWorkerParams(state);api.fleetDispatchOwnershipSnapshot(state);// warm-up
    const params=window(()=>S.fleetValidationParams(state)),token=window(()=>api.companyEvidenceToken(params.value)),day=window(()=>api.fleetDayWorkerParams(state)),snapshot=window(()=>api.fleetDispatchOwnershipSnapshot(state));
    const p=params.value;
    out[name]={params:JSON.stringify({...p}),contextToken:p.contextToken,validToken:V.contextToken({...p,definitionCompanies:[...p.definitionCompanies],legacyAssetOwners:{...p.legacyAssetOwners}})===p.contextToken,evidence:token.value,day:JSON.stringify(day.value),dayKey:api.fleetDayContextKey?api.fleetDayContextKey(day.value):null,snapshot:canonical(snapshot.value),
      frozen:Object.isFrozen(p.definitionCompanies)&&Object.isFrozen(p.legacyAssetOwners),
      work:{params:{visits:params.visits,definitions:params.definitions},token:{visits:token.visits},day:{visits:day.visits,definitions:day.definitions,resolve:day.resolve},snapshot:{visits:snapshot.visits,full:snapshot.full,resolve:snapshot.resolve}}};
  }
  // 3c. An unfrozen params object is read afresh by both tokens.
  const p=S.fleetValidationParams(worlds.all),loose={...p,definitionCompanies:[...p.definitionCompanies,'extra-name'],legacyAssetOwners:{...p.legacyAssetOwners}};
  const fresh={validation:V.contextToken(loose)===JSON.stringify([loose.routeIds,loose.routes,loose.registryCompanies,loose.companyReferenceCompanies,loose.definitionCompanies,loose.legacyAssetOwners]),evidence:api.companyEvidenceToken(loose)===JSON.stringify([loose.companyReferenceCompanies,loose.definitionCompanies,loose.legacyAssetOwners])};
  process.stdout.write(JSON.stringify({k,unsealed,refusal,worlds:out,fresh}));
  return;
}
const measure=(tree,k)=>JSON.parse(execFileSync(process.execPath,[__filename,'--measure',tree,String(k)],{encoding:'utf8',maxBuffer:1<<27}));
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'b581-'));
let B0,B10,N0,N10;
try{
  const before=path.join(tmp,'before'),now=path.join(tmp,'now');fs.mkdirSync(before);fs.mkdirSync(path.join(now,'tests'),{recursive:true});
  execFileSync('sh',['-c',`git -C "${process.env.GH_B581_GIT_DIR||ROOT}" archive ${PREVIOUS} WebApp tests/helpers | tar -x -C "${before}"`]);
  fs.cpSync(path.join(ROOT,'WebApp'),path.join(now,'WebApp'),{recursive:true});fs.cpSync(path.join(ROOT,'tests/helpers'),path.join(now,'tests/helpers'),{recursive:true});
  fs.copyFileSync(path.join(before,'WebApp/company-definitions.js'),path.join(now,'WebApp/company-definitions.js'));
  assert.ok(!fs.readFileSync(path.join(before,'WebApp/save-schema.js'),'utf8').includes('fleetValidationStatics'),'the previous validation parameters read every definition per call');
  [B0,B10,N0,N10]=[measure(before,0),measure(before,K),measure(now,0),measure(now,K)];
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
const fallback=new Set(['redirected','arrayRegistry','text']);
for(const [B,N] of [[B0,N0],[B10,N10]]){
  const k=N.k;
  assert.deepEqual(N.unsealed,B.unsealed,`3: k=${k}: before the seal a definition installed between two calls is seen`);assert.deepEqual(N.unsealed,{validation:2,day:2,snapshot:1});
  assert.match(N.refusal,/company-platform-sealed/,'3: no install after the seal');
  for(const name of Object.keys(N.worlds)){
    const n=N.worlds[name],b=B.worlds[name];
    for(const key of ['params','contextToken','evidence','day','dayKey','snapshot'])assert.equal(n[key],b[key],`1: k=${k} ${name}: ${key} is the previous one`);
    assert.ok(n.validToken,`1: k=${k} ${name}: the cached token is the token of the same values`);assert.ok(n.frozen,`3: k=${k} ${name}: the shared names and owners are frozen`);
    assert.deepEqual({...n.work.params,tokenVisits:n.work.token.visits},{visits:0,definitions:0,tokenVisits:0},`2: k=${k} ${name}: the validation parameters and the token visit no definition`);
    assert.deepEqual({visits:n.work.day.visits,definitions:n.work.day.definitions},{visits:0,definitions:0},`2: k=${k} ${name}: the fleet-day descriptor visits no definition`);
    assert.ok(n.work.day.resolve<=1+Object.keys(JSON.parse(n.params).registryCompanies).length+(name==='arrayRegistry'?1:0)+(name==='redirected'?1:0),`2: k=${k} ${name}: the descriptor resolves only 'group' and the registry keys (${n.work.day.resolve})`);
    if(!fallback.has(name))assert.deepEqual({visits:n.work.snapshot.visits,full:n.work.snapshot.full},{visits:0,full:0},`2: k=${k} ${name}: the dispatch snapshot visits no definition and lists no type`);
  }
  assert.deepEqual(N.fresh,{validation:true,evidence:true},`3: k=${k}: an unfrozen params object is read afresh`);
}
for(const name of Object.keys(N0.worlds)){
  const b0=B0.worlds[name].work,b10=B10.worlds[name].work,n0=N0.worlds[name].work,n10=N10.worlds[name].work;
  assert.ok(b10.params.visits>b0.params.visits&&b0.params.visits>0,`2: ${name}: the previous validation parameters visited every definition per call`);
  assert.ok(b10.day.resolve>b0.day.resolve,`2: ${name}: the previous descriptor resolved every name per call`);
  assert.ok(b0.snapshot.full>0&&b10.snapshot.visits>b0.snapshot.visits,`2: ${name}: the previous snapshot listed every type per call`);
  assert.equal(n10.day.resolve,n0.day.resolve,`2: ${name}: the descriptor's resolves do not grow with the types`);
  if(!fallback.has(name))assert.equal(n10.snapshot.resolve,n0.snapshot.resolve,`2: ${name}: the snapshot's resolves do not grow with the types`);
}
const w=name=>[B0,B10,N0,N10].map(arm=>arm.worlds[name].work);
console.log(JSON.stringify({suite:'build581-fleet-definition-weight',ok:true,previous:PREVIOUS,all:{validationVisits:w('all').map(x=>x.params.visits),dayResolves:w('all').map(x=>x.day.resolve),snapshotVisits:w('all').map(x=>x.snapshot.visits),snapshotResolves:w('all').map(x=>x.snapshot.resolve)},order:'previous k0, previous k10, now k0, now k10'}));
