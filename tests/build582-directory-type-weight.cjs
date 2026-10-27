'use strict';
// The last places where an installed company type a world never opened still cost something per command or at boot:
// app.js's isCompanyType and isDirectoryCompany built the list of every type to test one id (a directory open, the
// facility page, the scope plan), a directory site's candidacy (inside the money drafts of base and facility openings,
// once per item of a bulk scope command) listed every directory type with its identity, the bulk scope command's own
// check listed every directory type again, the HR, directory and corporate modules each listed every definition at
// load, and the companies page fetched every unopened company's logo at once. They now test one id through the
// platform's held pass (build579), the command's check reads only operational companies, the module lists are built
// at first read, and those logos load as they near the screen. Proven on the real platform, identity, HR, directory
// and corporate owners and the exact source of app.js's predicates, this tree against the source before the change
// (PREVIOUS, from its own tree), both on PREVIOUS's definitions file, each with 0 and with 10 synthetic data-only
// definitions (each a directory type, as the coming types are):
//  1. every answer is the previous one: isCompanyType for every option set and isDirectoryCompany over every id of a
//     state matrix (a dynamic instance, a record naming another definition, an orphan, untrimmed and empty ids, a
//     definitionId, an alias, the holding, a string openedCompanies); a site's candidacy equals the previous list's
//     membership for every company and entity kind; the command's operational companies are the page's operational
//     rows, in order, with the same providers; the module lists equal the values load built; every logo badge is the
//     same text, and the lazy one differs only by its loading attributes;
//  2. with 10 more definitions none of these visits a definition or lists every type (the module loads included); the
//     previous source grows on each.
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
const slice=(text,start,end)=>{const a=text.indexOf(start),b=text.indexOf(end,a);if(a<0||b<0)throw new Error(`slice not found: ${start.slice(0,50)}`);return text.slice(a,b);};
if(process.argv[2]==='--measure'){
  const root=process.argv[3],k=Number(process.argv[4]);process.env.GH_TEST_SOURCE_DIR=root;
  const {harness,minimal}=require(path.join(root,'tests/helpers/core-harness'));
  const h=harness(['capability-registry-core','company-definitions','company-platform-core']),{s}=h,P=s.GH_COMPANY_PLATFORM;
  for(let i=1;i<=k;i++)P.installDefinition(syntheticDefinition(i),{source:'weight-gate'});
  vm.runInContext(`(()=>{const values=Map.prototype.values;globalThis.__GH_VISITS__={rows:0};Map.prototype.values=function(){if(this.size>0){const first=this.entries().next().value[1];if(first&&typeof first==='object'&&first.schema==='gh-company-definition/v1')__GH_VISITS__.rows+=this.size;}return values.call(this);};})()`,s);
  const visits=()=>s.__GH_VISITS__.rows,load={};
  for(const name of ['identity-system','hr-core','directory-core','corporate-core']){const v0=visits();h.load(name);load[name]=visits()-v0;}
  const counts={full:0,identity:0};
  const W=Object.freeze({...P,listInstances(state,options={}){if(options.heldOnly!==true&&options.openedOnly!==true)counts.full++;return P.listInstances(state,options);},resolveIdentity(...args){counts.identity++;return P.resolveIdentity(...args);}});
  const app=fs.readFileSync(path.join(root,'WebApp/app.js'),'utf8'),box={COMPANY_PLATFORM:W,state:null,window:{}};vm.createContext(box);
  vm.runInContext([slice(app,'  // Company collections are live projections of the platform registry.','  const operationalCompanyInstances='),slice(app,'  function directoryCompanyRows(','  function setDirectoryCompany('),slice(app,'  function worldEntityCompanyCandidates(','  function directoryEntityByKey('),'this.api={companyTypes,isCompanyType,isDirectoryCompany,directoryCompanyRows,worldEntityCompanyCandidates,directoryCandidate:typeof directoryCandidate==="function"?directoryCandidate:null};'].join('\n'),box);
  const api=box.api,window=fn=>{const v0=visits(),c0={...counts},value=fn();return {value,visits:visits()-v0,full:counts.full-c0.full,identity:counts.identity-c0.identity};};
  const base=extra=>({...minimal(),profile:{name:'G'},onboardingComplete:true,...extra});
  const worlds={
    fresh:base({companyRegistry:{group:{}},openedCompanies:[]}),
    all:base({companyRegistry:{group:{},...Object.fromEntries(TYPES.map(id=>[id,{definitionId:P.getDefinition(id).definitionId}]))},openedCompanies:TYPES}),
    mixed:base({companyRegistry:{group:{},'air-east':{definitionId:'gh-air-v1'},bank:{definitionId:'gh-bank-v1'},ghost:{definitionId:'nothing-v1'},power:{definitionId:'future-power-v1'}},openedCompanies:['air-east',' sea','power']}),
    text:base({companyRegistry:{group:{}},openedCompanies:'air'}),
  };
  if(k)worlds.synthetic=base({companyRegistry:{group:{},'synth-01':{definitionId:'gh-synth-01-v1'},'synth-01b':{definitionId:'gh-synth-01-v1'}},openedCompanies:['synth-01','synth-01b']});
  const ids=['air','sea',' sea','air-east','bank','power','ghost','group','','gh-air-v1','hospitality','mobility','telecom','synth-01','synth-01b','synth-02','nothing',' air'];
  const optionSets=[{},{openedOnly:true},{registeredOnly:true},{operationalOnly:true},{openedOnly:true,operationalOnly:true}];
  const entities=[{kind:'airport'},{kind:'port'},{kind:'capital'},{kind:'company-site',company:'mobility'},{kind:'company-site',company:'synth-01'},{kind:'company-site',company:'air'},null];
  const out={};
  for(const [name,state] of Object.entries(worlds)){
    box.state=state;api.isCompanyType('air',state);api.isDirectoryCompany('air',state);// warm-up
    const types=window(()=>optionSets.map(options=>ids.map(id=>api.isCompanyType(id,state,options)))),dir=window(()=>ids.map(id=>api.isDirectoryCompany(id,state)));
    const candidacy=window(()=>api.directoryCandidate?entities.map(entity=>ids.map(id=>api.directoryCandidate(entity,id,state))):null);
    const listed=entities.map(entity=>ids.map(id=>api.worldEntityCompanyCandidates(entity,state).includes(id)));
    const rows=api.directoryCompanyRows(state).filter(row=>row.operational).map(row=>[row.id,row.providers]),array=state.openedCompanies==null||Array.isArray(state.openedCompanies),command=window(()=>array?P.listInstances(state,{includeGroup:false,openedOnly:true}).filter(company=>company.operational&&company.definition?.facilities?.directoryProviderIds?.length).map(company=>[company.id,[...company.definition.facilities.directoryProviderIds]]):rows);
    out[name]={types:types.value,dir:dir.value,candidacy:candidacy.value,listed,rows,command:command.value,work:{types:{visits:types.visits,full:types.full},dir:{visits:dir.visits,full:dir.full,identity:dir.identity},candidacy:{visits:candidacy.visits,full:candidacy.full,identity:candidacy.identity},command:{visits:command.visits}}};
  }
  // The module lists, read now (built at first read in this tree, at load in the previous one).
  const lists={manager:[...s.GH_HR_CORE.MANAGER_COMPANIES],directory:[...s.GH_DIRECTORY_CORE.COMPANIES],corporate:[...s.GH_CORPORATE_CORE.COMPANY_TYPES],same:s.GH_HR_CORE.MANAGER_COMPANIES===s.GH_HR_CORE.MANAGER_COMPANIES&&s.GH_DIRECTORY_CORE.COMPANIES===s.GH_DIRECTORY_CORE.COMPANIES&&s.GH_CORPORATE_CORE.COMPANY_TYPES===s.GH_CORPORATE_CORE.COMPANY_TYPES};
  // Every logo badge form the app uses.
  const I=s.GH_IDENTITY,st=worlds.all,logos={normal:I.logoMarkup(st,'air'),small:I.logoMarkup(st,'air','small'),tiny:I.logoMarkup(st,'bank','tiny','company-logo-badge'),modern:I.logoMarkup(st,'sea',{size:'small',element:'img',className:'x'}),wrapper:I.logoMarkup(st,'group',{size:'normal',wrapper:true,decorative:true}),lazy:I.logoMarkup(st,'telecom','small','company-logo-badge',{lazy:true})};
  // The directory search for every company with a text query (each world-capitals type was a segment over the same
  // capitals): the rows and totals, and the text checks it makes.
  const D=s.GH_DIRECTORY_CORE.create({capitals:vm.runInContext('globalThis.GH_MOBILITY_CORE?.CAPITALS',s)||require(path.join(root,'tests/helpers/core-harness')).harness(['mobility-core']).s.GH_MOBILITY_CORE.CAPITALS});
  const includes=vm.runInContext('String.prototype.includes',s);let checks=0;vm.runInContext('(fn,count)=>{String.prototype.includes=function(...a){count();return fn.apply(this,a);};}',s)(includes,()=>{checks++;});
  const searchState=worlds.all,first=D.search({state:searchState,company:'all',text:'ر'});checks=0;const searched=D.search({state:searchState,company:'all',text:'ر',page:1}),searchChecks=checks;
  vm.runInContext('fn=>{String.prototype.includes=fn;}',s)(includes);
  const search={total:searched.total,pages:searched.pages,rows:JSON.stringify(searched.rows.map(row=>[row.key||row.id,row.companyId||row.company])),firstTotal:first.total,checks:searchChecks};
  // The asset market's instances: the rows it keeps are the full list's.
  vm.runInContext(app.includes('function assetCatalogInstances(')?slice(app,'  let assetCatalogDefinitionIds=null;','  function assetMarketCatalogs('):'function assetCatalogInstances(target){return COMPANY_PLATFORM.listInstances(target,{includeGroup:false});}',box);
  h.load('company-adapters-core');P.seal({runtimeCheck:false});const catalogs={};for(const [name,state] of Object.entries(worlds)){vm.runInContext('assetCatalogInstances',box)(state);const w=window(()=>vm.runInContext('assetCatalogInstances',box)(state).filter(company=>company.known&&company.definition?.lifecycle==='active'&&company.definition?.classification?.assetClasses?.length).map(company=>company.id));catalogs[name]={ids:w.value,visits:w.visits,full:w.full};}
  // HR without a platform (its fallbacks read the manager list).
  const bare=harness(['hr-core']).s,H=bare.GH_HR_CORE,lone={...minimal(),openedCompanies:['air','bank','ghost'],advanced:{}};
  const noPlatform={managers:[...H.MANAGER_COMPANIES],labor:JSON.stringify(H.ensure(lone)),multiplier:H.salaryMultiplier(lone,'air'),health:JSON.stringify(H.health(lone,{}))};
  process.stdout.write(JSON.stringify({k,load,worlds:out,lists,logos,noPlatform,search,catalogs}));
  return;
}
const measure=(tree,k)=>JSON.parse(execFileSync(process.execPath,[__filename,'--measure',tree,String(k)],{encoding:'utf8',maxBuffer:1<<27}));
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'b582-'));
let B0,B10,N0,N10;
try{
  const before=path.join(tmp,'before'),now=path.join(tmp,'now');fs.mkdirSync(before);fs.mkdirSync(path.join(now,'tests'),{recursive:true});
  execFileSync('sh',['-c',`git -C "${process.env.GH_B582_GIT_DIR||ROOT}" archive ${PREVIOUS} WebApp tests/helpers | tar -x -C "${before}"`]);
  fs.cpSync(path.join(ROOT,'WebApp'),path.join(now,'WebApp'),{recursive:true});fs.cpSync(path.join(ROOT,'tests/helpers'),path.join(now,'tests/helpers'),{recursive:true});
  fs.copyFileSync(path.join(before,'WebApp/company-definitions.js'),path.join(now,'WebApp/company-definitions.js'));
  assert.ok(!fs.readFileSync(path.join(before,'WebApp/app.js'),'utf8').includes('function directoryCandidate('),'the previous source listed every directory type for one candidacy');
  [B0,B10,N0,N10]=[measure(before,0),measure(before,K),measure(now,0),measure(now,K)];
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
const json=JSON.stringify;
for(const [B,N] of [[B0,N0],[B10,N10]]){
  const k=N.k;
  for(const name of Object.keys(N.worlds)){
    const n=N.worlds[name],b=B.worlds[name];
    assert.equal(json(n.types),json(b.types),`1: k=${k} ${name}: isCompanyType answers as before for every option set and id`);
    assert.equal(json(n.dir),json(b.dir),`1: k=${k} ${name}: isDirectoryCompany answers as before`);
    assert.equal(json(n.listed),json(b.listed),`1: k=${k} ${name}: the candidate lists are the previous ones`);
    assert.equal(json(n.candidacy),json(n.listed),`1: k=${k} ${name}: a site's candidacy is the previous list's membership`);
    assert.equal(json(n.command),json(n.rows),`1: k=${k} ${name}: the command's operational companies are the page's operational rows, in order`);
    if(name!=='text'){
      assert.deepEqual({...n.work.types},{visits:0,full:0},`2: k=${k} ${name}: isCompanyType visits no definition and lists no type`);
      assert.deepEqual({...n.work.dir},{visits:0,full:0,identity:0},`2: k=${k} ${name}: isDirectoryCompany visits no definition, lists no type, reads no identity`);
      assert.deepEqual({...n.work.candidacy},{visits:0,full:0,identity:0},`2: k=${k} ${name}: a site's candidacy visits no definition, lists no type, reads no identity`);
    }
  }
  assert.equal(json(N.noPlatform),json(B.noPlatform),`1: k=${k}: HR without a platform answers as before`);
  assert.equal(json({...N.search,checks:0}),json({...B.search,checks:0}),`1: k=${k}: the directory search for every company returns the previous rows and totals`);
  for(const name of Object.keys(N.catalogs)){assert.equal(json(N.catalogs[name].ids),json(B.catalogs[name].ids),`1: k=${k} ${name}: the asset market keeps the previous companies`);if(name!=='text')assert.deepEqual({visits:N.catalogs[name].visits,full:N.catalogs[name].full},{visits:0,full:0},`2: k=${k} ${name}: the asset market visits no definition and lists no type`);}
  assert.equal(json(N.lists),json(B.lists),`1: k=${k}: the module lists are the values load built`);assert.equal(N.lists.same,true);
  for(const key of ['normal','small','tiny','modern','wrapper'])assert.equal(N.logos[key],B.logos[key],`1: k=${k}: the ${key} logo badge is the same text`);
  assert.equal(N.logos.lazy.replace(' loading="lazy" decoding="async"',''),B.logos.lazy,`1: k=${k}: the lazy badge differs only by its loading attributes`);assert.match(N.logos.lazy,/ loading="lazy" decoding="async"/);
  for(const [module,count] of Object.entries(N.load))if(module!=='identity-system')assert.equal(count,0,`2: k=${k}: ${module} visits no definition at load (${count})`);
}
for(const name of ['fresh','all','mixed']){
  const b0=B0.worlds[name].work,b10=B10.worlds[name].work;
  assert.ok(b0.types.full>0&&b10.types.visits>b0.types.visits,`2: ${name}: the previous isCompanyType listed every type and grew`);
  assert.ok(b0.dir.full>0&&b10.dir.identity>b0.dir.identity,`2: ${name}: the previous isDirectoryCompany listed every type with its identity and grew`);
}
assert.ok(B10.search.checks>B0.search.checks,`2: the previous directory search checked every world-capitals type's capitals (${B0.search.checks} then ${B10.search.checks})`);
assert.equal(N10.search.checks,N0.search.checks,`2: the directory search's checks do not grow with the types (${N0.search.checks})`);
assert.ok(B10.catalogs.all.visits>0,'2: the previous asset market resolved every type');
for(const module of ['hr-core','directory-core','corporate-core'])assert.ok(B10.load[module]>B0.load[module],`2: the previous ${module} visited every definition at load`);
console.log(JSON.stringify({suite:'build582-directory-type-weight',ok:true,previous:PREVIOUS,searchChecks:{previous:[B0.search.checks,B10.search.checks],now:[N0.search.checks,N10.search.checks]},assetMarketVisits:{previous:[B0.catalogs.all.visits,B10.catalogs.all.visits],now:[N0.catalogs.all.visits,N10.catalogs.all.visits]},isDirectoryCompany:{previousIdentityReads:[B0.worlds.all.work.dir.identity,B10.worlds.all.work.dir.identity],nowIdentityReads:[N0.worlds.all.work.dir.identity,N10.worlds.all.work.dir.identity]},loadVisits:{previous:[B0.load,B10.load],now:[N0.load,N10.load]}}));
