'use strict';
// Company types are data rows on shared engines, and the owner wants the four coming types to cost a player who never
// opens them nothing per day, command or save. Before this change every listInstances call without openedOnly resolved
// every installed definition (finance ensure on each finance command, the day close's accruals, HR ensure, the boot's
// metric maps), the sector, route-mode, asset-class and legacy-owner questions copied and sorted every definition per
// call (save validation, every route a dispatch creates, every legacy asset at boot), a new world recorded every
// definition's version in its save, and the identity module adapted every definition twice at load. This gate runs the
// platform before the change (PREVIOUS, from its own tree) and this tree, both on PREVIOUS's definitions file, each with
// 0 and with 10 synthetic data-only definitions, on the same states, in four processes:
//  1. heldOnly rows are the full pass's rows without the definition-only rows (no record, not opened), the rows every
//     caller of the option keeps, in the same order, for every state in the matrix (a registry out of definition order,
//     a dynamic instance, a quarantined record, an orphan, a non-object registry value, a `__proto__` key, books only,
//     a string openedCompanies, which takes the full pass); the previous platform ignores the option: its rows grow;
//  2. with 10 more definitions, no held pass visits a definition, and the rows and visits of every measured path (the
//     held lists, 700 lookups after warm-up, a legacy boot's 300 asset owners, the boot's metric maps, the identity
//     module's load) are those with 0; the previous platform grows on each;
//  3. nothing else changes: every lookup answer over a universe of modes, the metric maps and their errors, the versions
//     a new world records (the 12 shipped types, and a type the world holds, in the previous order), the identity tables;
//  4. the memos cannot go stale: a definition installed between two questions is seen, a rolled-back install whose
//     failing row asked while it was being read leaves the answers as before, and after the seal nothing changes.
// Desktop Node counts; nothing here is a claim about iPhone time.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm'),{execFileSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'),PREVIOUS='00380f6',K=10,TYPES=['air','sea','road','power','bank','mobility','insurance','realestate','telecom','dealership','hospitality'],MARK='assets/identity/group-default.svg';
const METRICS=['sectorProfitToday','tripProfitAccrued','tripRevenueAccrued','tripFuelAccrued','tripMaintenanceAccrued','tripCountAccrued','lastClosedSectorProfit'];
function syntheticDefinition(i,extra={}){
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
    legacy:{companyAliases:[],sectorAliases:[],assetOwnerModes:[],routeOwnerModes:[],assetClassByMode:{}},...extra};
}
if(process.argv[2]==='--measure'){
  const root=process.argv[3],k=Number(process.argv[4]);process.env.GH_TEST_SOURCE_DIR=root;
  const {harness,minimal}=require(path.join(root,'tests/helpers/core-harness'));
  const h=harness(['capability-registry-core','company-definitions','company-platform-core']),{s}=h,P=s.GH_COMPANY_PLATFORM;
  for(let i=1;i<=k;i++)P.installDefinition(syntheticDefinition(i),{source:'weight-gate'});
  // Definition visits: every pass over the platform's definitions map (its listDefinitions, and the one pass the memos
  // take) is a Map.prototype.values call in the realm.
  vm.runInContext(`(()=>{const values=Map.prototype.values;globalThis.__GH_VISITS__={rows:0,passes:0};Map.prototype.values=function(){if(this.size>0){const first=this.entries().next().value[1];if(first&&typeof first==='object'&&first.schema==='gh-company-definition/v1'){__GH_VISITS__.rows+=this.size;__GH_VISITS__.passes++;}}return values.call(this);};})()`,s);
  const visits=()=>s.__GH_VISITS__.rows,counts={full:0,fullRows:0,held:0,heldRows:0};
  const window=fn=>{const v0=visits(),c0={...counts},value=fn();return {value,visits:visits()-v0,held:counts.held-c0.held,heldRows:counts.heldRows-c0.heldRows,full:counts.full-c0.full,fullRows:counts.fullRows-c0.fullRows};};
  const identityLoad=window(()=>h.load('identity-system'));
  for(const name of ['company-adapters-core','save-schema','migration-core','persistence-core'])h.load(name);
  // Every owner reads the platform at call time; this copy counts the lists they ask for (the platform's own API is frozen).
  const W=Object.freeze({...P,listInstances(state,options={}){const rows=P.listInstances(state,options);if(options.heldOnly===true){counts.held++;counts.heldRows+=rows.length;}else{counts.full++;counts.fullRows+=rows.length;}return rows;}});
  s.GH_COMPANY_PLATFORM=W;
  const M=s.GH_MIGRATION_CORE,I=s.GH_IDENTITY,row=c=>[c.id,c.known,c.registered,c.opened,c.operational,c.status,c.definition?.definitionId||null];
  // 1. The matrix: states as saves hold them (validated ones and a few a save could carry), four option sets each.
  const states={
    fresh:{},
    group:{companyRegistry:{group:{}},onboardingComplete:true},
    registered:{companyRegistry:{telecom:{definitionId:'gh-telecom-v1'},group:{}},onboardingComplete:true},
    opened:{openedCompanies:['air','bank'],companyRegistry:{air:{definitionId:'gh-air-v1'},bank:{definitionId:'gh-bank-v1'}}},
    openedNoRecord:{openedCompanies:['air','bank']},
    quarantined:{companyRegistry:{air:{definitionId:'future-air-v1',quarantine:{readOnly:true,reason:'definition-missing'}}},openedCompanies:['air']},
    orphan:{companyRegistry:{ghost:{definitionId:'nothing-v1'}}},
    nonObject:{companyRegistry:{air:'x',sea:null,road:{definitionId:'gh-logistics-v1'}}},
    dynamic:{companyRegistry:{'air-east':{definitionId:'gh-air-v1'},air:{definitionId:'gh-air-v1'}},openedCompanies:['air-east','air']},
    outOfOrder:{companyRegistry:{telecom:{},air:{},bank:{},hospitality:{}},openedCompanies:['bank','air']},
    books:{companyFinance:{telecom:{},group:{},nothing:{}},companyRegistry:{air:{}},openedCompanies:['air']},
    text:{openedCompanies:'air',companyRegistry:{bank:{}}},
    proto:JSON.parse('{"companyRegistry":{"__proto__":{"definitionId":"gh-air-v1"},"air":{}}}'),
    ...(k?{synthetic:{companyRegistry:{'synth-01':{definitionId:'gh-synth-01-v1'}},openedCompanies:['synth-01']},syntheticBook:{companyFinance:{'synth-02':{}},openedCompanies:['air']}}:{}),
  };
  const optionSets={group:{includeGroup:true},noGroup:{includeGroup:false},finance:{includeGroup:true,capability:'finance.book'},hr:{includeGroup:false,capability:'hr.management'}};
  const matrix={};
  for(const [name,state] of Object.entries(states)){
    const books=Object.keys(state.companyFinance||{}),registry=state.companyRegistry||{},opened=Array.isArray(state.openedCompanies)?state.openedCompanies:[];
    const out={heldIds:[...Object.keys(registry),...opened],books,textOpened:state.openedCompanies!=null&&!Array.isArray(state.openedCompanies)};
    for(const [label,options] of Object.entries(optionSets)){
      const full=W.listInstances(state,options).map(row),held=window(()=>W.listInstances(state,{...options,heldOnly:true}).map(row)),also=window(()=>W.listInstances(state,{...options,heldOnly:true,alsoDefinitionIds:books}).map(row));
      out[label]={full,held:held.value,heldVisits:held.visits,also:also.value,alsoVisits:also.visits};
    }
    matrix[name]=out;
  }
  // 2. The lookups: 7 questions over a universe of modes, 100 rounds after one warm-up round.
  const modes=['air','sea','road','mobility','rail','tram','','unknown','AIR',' air','constructor','toString','__proto__','hospitality','lodging','synth-01','aircraft','truck',0,null,undefined,'a-b.c','Bad Mode'];
  const fns=['isKnownSector','isKnownRouteMode','isKnownAssetClass','ownerForLegacyAssetMode','ownerForLegacyRouteMode','assetClassForLegacyMode','operationProfileForLegacyMode'];
  const ask=()=>Object.fromEntries(fns.map(fn=>[fn,modes.map(mode=>String(P[fn](mode)))]));
  ask();const lookups=window(()=>{let answers=null;for(let i=0;i<100;i++)answers=ask();return answers;});
  // 3. A legacy save's boot, before the seal: the owner of each of 300 legacy assets.
  const legacyBoot=window(()=>{const out=P.migrateState({...minimal(),profile:{name:'G'},onboardingComplete:true,companyRegistry:{group:{}},openedCompanies:['air','sea','road'],unlockedSectors:['air','sea','road'],assets:Array.from({length:300},(_,i)=>({id:`A-${i}`,name:`A-${i}`,type:['air','sea','road'][i%3],company:['air','sea','road'][i%3],baseFacility:'BASE',phase:'idle',progress:0,fuel:100,condition:100})),customRoutes:[]});return {errors:out.errors,platform:JSON.stringify(out.state.companyPlatform)};});
  // 4. New worlds: what migrateState records, and the boot's metric maps (completeBusinessState) on them.
  const base=()=>({...minimal(),profile:{name:'G'},bank:{},energy:{},operations:{},onboardingComplete:true}),defaults={...minimal(),profile:{},bank:{},energy:{},operations:{},finance:{...minimal().finance},treasury:structuredClone(minimal().treasury)};
  const complete=state=>M.completeBusinessState(state,{defaultState:defaults,initialStocks:[],crewRolesSeed:[]});
  const inputs={
    fresh:base(),
    all:{...base(),openedCompanies:TYPES,sectorProfitToday:{air:5,hospitality:0,telecom:7},tripProfitAccrued:{bank:12}},
    mixed:{...base(),companyRegistry:{air:{definitionId:'gh-air-v1'},'air-east':{definitionId:'gh-air-v1'},telecom:{definitionId:'gh-telecom-v1'}},openedCompanies:['air','air-east'],companyFinance:{bank:{},group:{}},sectorProfitToday:{air:0,telecom:3,bank:4,mobility:0}},
    ...(k?{held:{...base(),companyRegistry:{'synth-01':{definitionId:'gh-synth-01-v1'}},openedCompanies:['synth-01','air'],sectorProfitToday:{'synth-01':9}}}:{}),
  };
  const worlds={};
  for(const [name,input] of Object.entries(inputs)){
    const text=JSON.stringify(input),migrated=window(()=>P.migrateState(input)),state=migrated.value.state,again=P.migrateState(state),done=window(()=>complete(state));
    worlds[name]={inputUnchanged:JSON.stringify(input)===text,errors:migrated.value.errors,changedAgain:again.changed,platform:JSON.stringify(state.companyPlatform),versions:Object.entries(state.companyPlatform.definitionVersions),migrateVisits:migrated.visits,completeVisits:done.visits,completeHeld:done.held,completeHeldRows:done.heldRows,completeFull:done.full,metrics:JSON.stringify(Object.fromEntries(METRICS.map(field=>[field,state[field]])))};
  }
  const metricErrors={};
  for(const [name,input] of Object.entries({unknown:{...base(),sectorProfitToday:{nowhere:5}},...(k?{ambiguous:{...base(),companyRegistry:{s1a:{definitionId:'gh-synth-01-v1'},s1b:{definitionId:'gh-synth-01-v1'}},openedCompanies:['s1a','s1b'],sectorProfitToday:{'synth-01':99}}}:{})})){
    const state=P.migrateState(input).state,before=JSON.stringify(METRICS.map(field=>state[field]));let message='';try{complete(state);}catch(error){message=String(error.message);}
    metricErrors[name]={message,unchanged:JSON.stringify(METRICS.map(field=>state[field]))===before};
  }
  // 5. The identity module's legacy tables.
  const identity={brands:JSON.stringify(I.BRANDS),legacyNames:JSON.stringify(I.LEGACY_NAMES),same:I.BRANDS===I.BRANDS&&I.LEGACY_NAMES===I.LEGACY_NAMES,keys:Object.keys(I).includes('BRANDS')&&Object.keys(I).includes('LEGACY_NAMES'),loadVisits:identityLoad.visits};
  // 6. The memos: an install between two questions, a rolled-back install that asked while being read, the seal.
  const tram=syntheticDefinition(11,{id:'synth-tram',definitionId:'gh-synth-tram-v1',classification:{primarySectorId:'synth-tram',sectorIds:['synth-tram'],operationProfileId:'hospitality-operations-v1',assetClasses:['tramcar'],routeModes:['tram']},legacy:{companyAliases:[],sectorAliases:[],assetOwnerModes:['tram'],routeOwnerModes:['tram'],assetClassByMode:{tram:'tramcar'}}});
  const answers=()=>[P.ownerForLegacyAssetMode('tram'),P.ownerForLegacyRouteMode('tram'),P.isKnownRouteMode('tram'),P.isKnownAssetClass('tramcar'),P.isKnownSector('synth-tram'),P.assetClassForLegacyMode('tram'),P.getDefinition('synth-tram')?.id||null].map(String);
  const before=answers(),seen=[],poison={get id(){seen.push(...answers());return 'poison';}};
  let rolledBack='';try{P.installDefinitions([tram,poison],{source:'weight-gate'});}catch(error){rolledBack=String(error.message);}
  const after=answers();P.installDefinition(tram,{source:'weight-gate'});const installed=answers();
  P.seal({runtimeCheck:false});let sealedRefusal='';try{P.installDefinition(syntheticDefinition(12),{source:'late'});}catch(error){sealedRefusal=String(error.message);}
  ask();let batchRefusal='';try{P.installDefinitions([syntheticDefinition(13)],{source:'late'});}catch(error){batchRefusal=String(error.message);}const afterRefusal=window(()=>ask()).visits;
  const sealedAnswers=JSON.stringify(ask()),sealedList=W.listInstances(states.opened,{includeGroup:true,heldOnly:true}).map(row);
  const memo={before,seen,rolledBack,after,installed,sealedRefusal,batchRefusal,afterRefusal,sealedAnswersSame:sealedAnswers===JSON.stringify(ask()),sealedList};
  const bytes=Object.fromEntries(['company-platform-core.js','migration-core.js','identity-system.js','app.js'].map(file=>[file,fs.statSync(path.join(root,'WebApp',file)).size]));
  process.stdout.write(JSON.stringify({k,definitions:P.listDefinitions().length,matrix,lookups:{answers:lookups.value,visits:lookups.visits},legacyBoot,worlds,metricErrors,identity,memo,bytes}));
  return;
}
const measure=(tree,k)=>JSON.parse(execFileSync(process.execPath,[__filename,'--measure',tree,String(k)],{encoding:'utf8',maxBuffer:1<<27}));
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'b579-'));
let B0,B10,N0,N10;
try{
  const before=path.join(tmp,'before'),now=path.join(tmp,'now');fs.mkdirSync(before);fs.mkdirSync(path.join(now,'tests'),{recursive:true});
  execFileSync('sh',['-c',`git -C "${process.env.GH_B579_GIT_DIR||ROOT}" archive ${PREVIOUS} WebApp tests/helpers | tar -x -C "${before}"`]);
  fs.cpSync(path.join(ROOT,'WebApp'),path.join(now,'WebApp'),{recursive:true});fs.cpSync(path.join(ROOT,'tests/helpers'),path.join(now,'tests/helpers'),{recursive:true});
  // Both arms run on the previous definitions file: the gate is about the platform, not about which types ship.
  fs.copyFileSync(path.join(before,'WebApp/company-definitions.js'),path.join(now,'WebApp/company-definitions.js'));
  assert.ok(!fs.readFileSync(path.join(before,'WebApp/company-platform-core.js'),'utf8').includes('heldOnly'),'the previous platform resolves every definition on every list');
  [B0,B10,N0,N10]=[measure(before,0),measure(before,K),measure(now,0),measure(now,K)];
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
const json=JSON.stringify,kept=rows=>rows.filter(r=>r[0]==='group'||r[2]||r[3]),sum=(arm,field)=>Object.values(arm.matrix).reduce((n,state)=>n+Object.values(state).filter(v=>v&&typeof v==='object'&&!Array.isArray(v)).reduce((m,cell)=>m+cell[field].length,0),0);
for(const [B,N] of [[B0,N0],[B10,N10]]){
  const k=N.k,definitions=new Set(B.matrix.fresh.noGroup.full.map(r=>r[0]));assert.equal(B.definitions,N.definitions,`k=${k}: both arms hold the same definitions`);
  for(const [name,state] of Object.entries(N.matrix)){
    const held=new Set(state.heldIds),also=new Set([...state.heldIds,...state.books]),expected=(full,ids)=>state.textOpened?full:full.filter(r=>r[0]==='group'||ids.has(r[0])||!definitions.has(r[0]));
    for(const label of Object.keys(optionLabels())){
      const b=B.matrix[name][label],n=state[label];
      assert.equal(json(n.full),json(b.full),`k=${k} ${name}/${label}: the full pass is the previous one`);
      assert.equal(json(n.held),json(expected(b.full,held)),`1: k=${k} ${name}/${label}: heldOnly is the full pass without the definition-only rows`);
      assert.equal(json(n.also),json(expected(b.full,also)),`1: k=${k} ${name}/${label}: alsoDefinitionIds adds the named definitions`);
      assert.equal(json(kept(n.held)),json(kept(b.full)),`1: k=${k} ${name}/${label}: the rows a caller keeps are the same`);
      if(!state.textOpened)assert.equal(n.heldVisits+n.alsoVisits,0,`2: k=${k} ${name}/${label}: a held pass visits no definition`);
    }
  }
  assert.equal(json(N.lookups.answers),json(B.lookups.answers),`3: k=${k}: every lookup answer is the previous one`);
  assert.equal(N.lookups.visits,0,`2: k=${k}: 700 lookups after warm-up visit no definition (${N.lookups.visits})`);
  assert.deepEqual(N.legacyBoot.value.errors,[],`k=${k}: the legacy boot migrates`);assert.equal(json(N.legacyBoot.value),json(k?{...B.legacyBoot.value,platform:N0.legacyBoot.value.platform}:B.legacyBoot.value),`3: k=${k}: the legacy boot's platform record is the previous one (the shipped types' versions)`);
  for(const name of Object.keys(N.worlds)){
    const n=N.worlds[name],b=B.worlds[name];
    assert.ok(n.inputUnchanged&&!n.changedAgain&&!n.errors.length,`k=${k} ${name}: migrateState stays pure and settled`);
    assert.equal(n.metrics,b.metrics,`3: k=${k} ${name}: the metric maps are the previous ones`);
    assert.equal(n.completeVisits,0,`2: k=${k} ${name}: the boot's metric maps visit no definition`);
    if(name!=='held')assert.equal(json(n.versions),json(k?N0.worlds[name].versions:b.versions),`3: k=${k} ${name}: a new world records the shipped types' versions`);
  }
  assert.equal(json(N.metricErrors),json(B.metricErrors),`3: k=${k}: metric errors and the state they leave are the previous ones`);
  assert.equal(N.identity.brands,B.identity.brands,`3: k=${k}: BRANDS`);assert.equal(N.identity.legacyNames,B.identity.legacyNames,`3: k=${k}: LEGACY_NAMES`);assert.ok(N.identity.same&&N.identity.keys,'the identity tables are one object, listed as before');
  assert.equal(N.identity.loadVisits,0,`2: k=${k}: the identity module adapts no definition at load (${N.identity.loadVisits})`);
  for(const key of ['before','seen','after','installed'])assert.equal(json(N.memo[key]),json(B.memo[key]),`4: k=${k}: ${key}`);
  assert.equal(json(N.memo.sealedList),json(N.matrix.opened.group.held),`4: k=${k}: the seal changes no held list`);
  assert.equal(json(N.memo.after),json(['null','null','false','false','false','null','null']),'4: a rolled-back install leaves no answer behind');
  assert.equal(N.memo.seen[0],'synth-tram','4: the question asked while the failing row was read saw the row installed before it');
  assert.equal(N.memo.installed[0],'synth-tram','4: a definition installed between two questions is seen');
  assert.match(N.memo.batchRefusal,/company-platform-sealed/);assert.equal(N.memo.afterRefusal,0,`4: k=${k}: a refused batch that installed nothing keeps the lookups (and the fleet evidence)`);
  assert.match(N.memo.rolledBack,/company-definition-invalid/);assert.match(N.memo.sealedRefusal,/company-platform-sealed/);assert.equal(N.memo.sealedAnswersSame,true);
}
function optionLabels(){return {group:1,noGroup:1,finance:1,hr:1};}
// The previous platform grows with the types; this one does not.
assert.ok(sum(B10,'held')>sum(B0,'held')&&B0.matrix.fresh.group.held.length>1,'1: the previous platform ignores heldOnly: its rows grow with the types');
for(const name of Object.keys(N0.matrix))if(!N0.matrix[name].textOpened)for(const label of Object.keys(optionLabels()))assert.equal(json(N10.matrix[name][label].held),json(N0.matrix[name][label].held),`2: ${name}/${label}: 10 more definitions change no held row`);
assert.ok(B10.lookups.visits>B0.lookups.visits&&B0.lookups.visits>0,'2: the previous lookups copied every definition per call');
assert.ok(B10.legacyBoot.visits>B0.legacyBoot.visits,'2: the previous legacy boot visited every definition per asset');assert.equal(N10.legacyBoot.visits,N0.legacyBoot.visits,`2: a legacy boot's visits do not grow with the types (${N0.legacyBoot.visits} and ${N10.legacyBoot.visits})`);
assert.ok(B10.worlds.fresh.completeVisits>B0.worlds.fresh.completeVisits,'2: the previous boot visited every definition for its metric maps');
assert.equal(N10.worlds.fresh.completeHeldRows,N0.worlds.fresh.completeHeldRows);assert.equal(N10.worlds.all.completeHeldRows,N0.worlds.all.completeHeldRows);
assert.equal(B10.worlds.fresh.versions.length,22,'the previous platform recorded every definition in a new world');assert.equal(N10.worlds.fresh.versions.length,12,'3: a new world records the 12 shipped types only');
const baseline=new Set(B0.worlds.fresh.versions.map(([id])=>id));
assert.equal(json(N10.worlds.held.versions),json(B10.worlds.held.versions.filter(([id])=>baseline.has(id)||id==='gh-synth-01-v1')),'3: a type the world holds is recorded as before, in the previous order');
assert.ok(B10.identity.loadVisits>B0.identity.loadVisits,'2: the previous identity module adapted every definition at load');
const bytes=Object.fromEntries(Object.keys(N0.bytes).map(file=>[file,N0.bytes[file]-B0.bytes[file]]));
console.log(JSON.stringify({suite:'build579-defined-types-platform-weight',ok:true,previous:PREVIOUS,heldRows:{previous:[sum(B0,'held'),sum(B10,'held')],now:[sum(N0,'held'),sum(N10,'held')]},lookupVisits:{previous:[B0.lookups.visits,B10.lookups.visits],now:[N0.lookups.visits,N10.lookups.visits]},legacyBootVisits:{previous:[B0.legacyBoot.visits,B10.legacyBoot.visits],now:[N0.legacyBoot.visits,N10.legacyBoot.visits]},bootMetricVisits:{previous:[B0.worlds.fresh.completeVisits,B10.worlds.fresh.completeVisits],now:[N0.worlds.fresh.completeVisits,N10.worlds.fresh.completeVisits]},identityLoadVisits:{previous:[B0.identity.loadVisits,B10.identity.loadVisits],now:[N0.identity.loadVisits,N10.identity.loadVisits]},eagerBytesDelta:bytes}));
