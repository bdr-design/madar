'use strict';
// The money and payroll owners asked the Company Platform for every installed type on every call: finance ensure about
// ten times per finance command (each a pass over every definition and one resolve per type), the day close's accruals
// through isFinanceCompany, and HR ensure twice per call, once writing a salary policy row into the save for every
// installed type, opened or not. They now ask for the companies the world holds (the platform's heldOnly pass, build579),
// HR's manager loop visits only the rows it has, and the salary policy keeps its rows for the eleven shipped types and
// adds a row for a later type once the world holds it. Proven on the real finance, HR, transaction and platform owners
// and app.js's own companyFinanceTypes and isFinanceCompany (its source, run as written), this tree against the source
// before the change (PREVIOUS, from its own tree), both on PREVIOUS's definitions file, each with 0 and with 10 synthetic
// data-only definitions, on three worlds (everything opened; the holding alone; a mix of opened, registered-only and
// dynamic instances):
//  1. every money result is the previous one: the finance root, every company book, the treasury and the cash after a
//     deposit, a daily settlement and its idempotent retry, a cheque issued and settled; the finance company ids; the
//     unknown-company refusal; a failed transaction leaves the roots byte-identical;
//  2. every payroll result is the previous one: advanced.labor after HR ensure (the salary policy rows and their order,
//     the official-manager rows: ended rows kept, status set, a non-object row deleted, a null row kept), ensure twice is
//     idempotent, the salary multipliers, a raise and its history, the refusals (unknown or unopened company, an index
//     off the scale) and the unchanged state they leave, a failed transaction;
//  3. companyFinanceTypes and isFinanceCompany answer as before for every option set and every id, including ids that
//     are not companies;
//  4. with 10 more definitions nothing above changes and no finance command, HR ensure or app.js answer visits a
//     definition or lists every type; the previous source grows on each, and its HR ensure wrote 10 more salary rows.
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
if(process.argv[2]==='--measure'){
  const root=process.argv[3],k=Number(process.argv[4]);process.env.GH_TEST_SOURCE_DIR=root;
  const {harness}=require(path.join(root,'tests/helpers/core-harness'));
  const h=harness(['capability-registry-core','company-definitions','company-platform-core']),{s}=h,P=s.GH_COMPANY_PLATFORM;
  for(let i=1;i<=k;i++)P.installDefinition(syntheticDefinition(i),{source:'weight-gate'});
  // Definition visits: every pass over the platform's definitions map is a Map.prototype.values call in the realm.
  vm.runInContext(`(()=>{const values=Map.prototype.values;globalThis.__GH_VISITS__={rows:0};Map.prototype.values=function(){if(this.size>0){const first=this.entries().next().value[1];if(first&&typeof first==='object'&&first.schema==='gh-company-definition/v1')__GH_VISITS__.rows+=this.size;}return values.call(this);};})()`,s);
  for(const name of ['identity-system','control-plane-core','document-proof-core','transaction-core','domain-command-core','finance-core','hr-core'])h.load(name);
  const counts={full:0,held:0,heldRows:0,resolve:0},visits=()=>s.__GH_VISITS__.rows;
  // The owners read the platform at call time; this copy counts the lists and resolutions they ask for.
  const W=Object.freeze({...P,listInstances(state,options={}){const rows=P.listInstances(state,options);if(options.heldOnly===true){counts.held++;counts.heldRows+=rows.length;}else counts.full++;return rows;},resolveCompany(...args){counts.resolve++;return P.resolveCompany(...args);},requireCompany(...args){counts.resolve++;return P.requireCompany(...args);}});
  s.GH_COMPANY_PLATFORM=W;
  const F=s.GH_FINANCE_CORE,H=s.GH_HR_CORE,TX=s.GH_TRANSACTION_CORE,json=JSON.stringify;
  const window=fn=>{const v0=visits(),c0={...counts},value=fn();return {value:value===undefined?null:value,visits:visits()-v0,full:counts.full-c0.full,held:counts.held-c0.held,heldRows:counts.heldRows-c0.heldRows,resolve:counts.resolve-c0.resolve};};
  const money=state=>json({finance:state.finance,companyFinance:state.companyFinance,treasury:state.treasury,cash:state.cash});
  const world=(opened,registry={},extra={})=>{const m=P.migrateState({simSeconds:86400,openedCompanies:opened,profile:{name:'أصول ونفوذ القابضة',founder:'سالم'},hired:[],assets:[],globalBases:[],customHubs:[],branches:[],bank:{branches:1},energy:{},mobility:{vehicles:[]},companyRegistry:registry,...extra});if(m.errors.length)throw new Error(m.errors.join(','));const state=m.state;F.ensure(state);for(const id of F.companyIds(state,{includeGroup:false}))F.book(state,id).accounts[0].balance=1000000;F.reconcile(state);return state;};
  const worlds={all:world(TYPES),group:world([],{},{onboardingComplete:true}),mixed:world(['air','air-east'],{air:{definitionId:'gh-air-v1'},bank:{definitionId:'gh-bank-v1'},'air-east':{definitionId:'gh-air-v1'}})};
  // app.js's own company lists, from its source, with the platform copy above as COMPANY_PLATFORM.
  const appSource=fs.readFileSync(path.join(root,'WebApp/app.js'),'utf8'),start=appSource.indexOf('  // Company collections are live projections of the platform registry.'),end=appSource.indexOf('  const operationalCompanyInstances=',start);
  if(start<0||end<0)throw new Error('app.js company lists not found');
  const box={COMPANY_PLATFORM:W,state:null};vm.createContext(box);vm.runInContext(appSource.slice(start,end)+'\nthis.api={companyTypes,companyFinanceTypes,isCompanyType,isFinanceCompany};',box);
  const out={};
  for(const [name,state] of Object.entries(worlds)){
    box.state=state;const company=name==='group'?'group':'air',ids=[...TYPES,'group','air-east','ghost','',' air','synth-01','synth-02'];
    const finance={},cmd=(label,fn)=>{const w=window(fn);finance[label]={visits:w.visits,full:w.full,held:w.held,heldRows:w.heldRows,resolve:w.resolve,result:w.value};};
    cmd('deposit',()=>company==='group'?'skip':[F.execute({state},'settle-daily-cash',{company,amount:2500,day:1,reference:'B580-UP'}).amount]);
    cmd('settle',()=>company==='group'?'skip':[F.execute({state},'settle-daily-cash',{company,amount:-1234.5,day:2,reference:'B580-D2'}).amount]);
    cmd('settleAgain',()=>{if(company==='group')return 'skip';const r=F.execute({state},'settle-daily-cash',{company,amount:-1234.5,day:2,reference:'B580-D2'});return [r.amount,r.idempotent===true];});
    cmd('cheque',()=>{const cheque=F.execute({state},'issue-cheque',{company,amount:500,beneficiary:'Supplier',note:'n'});return F.execute({state},'settle-cheque',{id:cheque.id}).settled;});
    cmd('ids',()=>[F.companyIds(state),F.companyIds(state,{includeGroup:false})]);
    const before=money(state);let unknown='';try{F.execute({state},'issue-cheque',{company:k?'synth-01':'ghost',amount:1,beneficiary:'x',note:'x'});}catch(error){unknown=String(error.message);}
    let rolled='';try{TX.execute(state,{label:'b580-finance',apply(){F.execute({state},'issue-cheque',{company,amount:7,beneficiary:'r',note:'r'});throw new Error('b580-after-cheque');}});}catch(error){rolled=String(error.message);}
    const restored=money(state)===before;
    const app={},appCall=(label,fn)=>{const w=window(fn);app[label]={visits:w.visits,full:w.full,held:w.held,value:w.value};};
    appCall('types',()=>box.api.companyFinanceTypes(state));appCall('opened',()=>box.api.companyFinanceTypes(state,{openedOnly:true}));appCall('operational',()=>box.api.companyFinanceTypes(state,{operationalOnly:true}));
    appCall('isFinance',()=>ids.map(id=>[id,box.api.isFinanceCompany(id,state)]));
    // Payroll: HR ensure over a manager table that holds every kind of row.
    H.ensure(state).officialManagers={air:{status:'منتهي',name:'a'},bank:{name:'b'},road:'truthy',sea:null,ghost:{name:'g'}};
    const ensure1=window(()=>H.ensure(state)),labor=json(state.advanced.labor),ensure2=window(()=>H.ensure(state)),laborAgain=json(state.advanced.labor)===labor;
    const operational=W.listInstances(state,{includeGroup:false,openedOnly:true,capability:'hr.management'}).filter(c=>c.operational).map(c=>c.id);
    const multipliers=Object.fromEntries(['group',...operational].map(id=>[id,H.salaryMultiplier(state,id)]));
    const hrFail={};for(const [label,payload] of Object.entries({unopened:{company:k?'synth-02':'ghost',index:1.1},invalid:{company,index:1.11}})){const was=json(state.advanced.labor);let message='';try{H.execute({state},'set-salary-index',payload);}catch(error){message=String(error.message);}hrFail[label]={message,unchanged:json(state.advanced.labor)===was};}
    const raised=window(()=>H.execute({state},'set-salary-index',{company,index:1.1})),raisedMultiplier=H.salaryMultiplier(state,company),history=H.salaryHistory(state,company).length;
    const laborBefore=json(state.advanced.labor);let hrRolled='';try{TX.execute(state,{label:'b580-hr',apply(){H.execute({state},'set-salary-index',{company,index:1.2});throw new Error('b580-after-raise');}});}catch(error){hrRolled=String(error.message);}
    out[name]={finance,money:money(state),unknown,rolled,restored,app,hr:{ensureVisits:ensure1.visits,ensureFull:ensure1.full,ensureHeld:ensure1.held,ensureHeldRows:ensure1.heldRows,ensureAgainVisits:ensure2.visits,labor,laborAgain,salaryPolicyKeys:Object.keys(state.advanced.labor.salaryPolicy),officialManagers:json(state.advanced.labor.officialManagers),multipliers,hrFail,raisedVisits:raised.visits,raisedFull:raised.full,raisedMultiplier,history,hrRolled,hrRestored:json(state.advanced.labor)===laborBefore}};
  }
  process.stdout.write(json({k,worlds:out}));
  return;
}
const measure=(tree,k)=>JSON.parse(execFileSync(process.execPath,[__filename,'--measure',tree,String(k)],{encoding:'utf8',maxBuffer:1<<27}));
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'b580-'));
let B0,B10,N0,N10;
try{
  const before=path.join(tmp,'before'),now=path.join(tmp,'now');fs.mkdirSync(before);fs.mkdirSync(path.join(now,'tests'),{recursive:true});
  execFileSync('sh',['-c',`git -C "${process.env.GH_B580_GIT_DIR||ROOT}" archive ${PREVIOUS} WebApp tests/helpers | tar -x -C "${before}"`]);require(path.join(__dirname,'helpers/brand-baseline.cjs')).brandBaseline(before);
  fs.cpSync(path.join(ROOT,'WebApp'),path.join(now,'WebApp'),{recursive:true});fs.cpSync(path.join(ROOT,'tests/helpers'),path.join(now,'tests/helpers'),{recursive:true});
  fs.copyFileSync(path.join(before,'WebApp/company-definitions.js'),path.join(now,'WebApp/company-definitions.js'));
  assert.ok(!fs.readFileSync(path.join(before,'WebApp/finance-core.js'),'utf8').includes('heldOnly'),'the previous finance owner resolved every installed type');
  [B0,B10,N0,N10]=[measure(before,0),measure(before,K),measure(now,0),measure(now,K)];
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
const json=JSON.stringify,synthetic=id=>/^synth-/.test(id),withoutSynthetic=labor=>{const copy=JSON.parse(labor);for(const key of Object.keys(copy.salaryPolicy))if(synthetic(key))delete copy.salaryPolicy[key];return json(copy);};
for(const [B,N] of [[B0,N0],[B10,N10]]){
  const k=N.k;
  for(const name of Object.keys(N.worlds)){
    const n=N.worlds[name],b=B.worlds[name];
    for(const label of Object.keys(n.finance)){
      assert.equal(json(n.finance[label].result),json(b.finance[label].result),`1: k=${k} ${name}/${label}: the command's result is the previous one`);
      assert.equal(n.finance[label].visits+n.finance[label].full,0,`4: k=${k} ${name}/${label}: a finance command visits no definition and lists no type (${n.finance[label].visits} visits, ${n.finance[label].full} lists)`);
    }
    assert.equal(n.money,b.money,`1: k=${k} ${name}: the finance root, every book, the treasury and the cash are the previous ones`);
    assert.equal(n.unknown,b.unknown,`1: k=${k} ${name}: the unknown-company refusal`);assert.match(n.unknown,/company-not-found|company-not-operational|unknown/);
    assert.equal(n.rolled,b.rolled,`1: k=${k} ${name}: the failed transaction's error`);assert.match(n.rolled,/b580-after-cheque/);assert.equal(n.restored,true,`1: k=${k} ${name}: a failed transaction leaves the money roots byte-identical`);
    for(const label of Object.keys(n.app)){
      assert.equal(json(n.app[label].value),json(b.app[label].value),`3: k=${k} ${name}/${label}: app.js answers as before`);
      assert.equal(n.app[label].visits+n.app[label].full,0,`4: k=${k} ${name}/${label}: app.js visits no definition and lists no type`);
    }
    const hn=n.hr,hb=b.hr;
    assert.equal(hn.labor,k?N0.worlds[name].hr.labor:hb.labor,`2: k=${k} ${name}: advanced.labor after HR ensure is the previous one (the shipped types' salary rows, in order)`);
    if(k)assert.equal(withoutSynthetic(hb.labor),hn.labor,`2: k=${k} ${name}: the previous HR ensure wrote the same rows plus one per synthetic type`);
    assert.ok(hn.laborAgain&&hn.ensureAgainVisits===0,`2: k=${k} ${name}: ensure twice is idempotent`);
    assert.equal(hn.officialManagers,hb.officialManagers,`2: k=${k} ${name}: the official-manager rows are normalised as before`);
    assert.equal(json(hn.multipliers),json(hb.multipliers),`2: k=${k} ${name}: salary multipliers`);assert.equal(json(hn.hrFail),json(hb.hrFail),`2: k=${k} ${name}: HR refusals and the state they leave`);
    assert.ok(hn.hrFail.unopened.unchanged&&hn.hrFail.invalid.unchanged&&/salary-index-invalid/.test(hn.hrFail.invalid.message),`2: k=${k} ${name}: refusals change nothing`);
    assert.equal(hn.raisedMultiplier,1.1);assert.equal(hn.history,1);assert.equal(hn.raisedMultiplier,hb.raisedMultiplier);assert.equal(hn.history,hb.history);
    assert.match(hn.hrRolled,/b580-after-raise/);assert.equal(hn.hrRestored,true,`2: k=${k} ${name}: a failed raise leaves labor byte-identical`);
    assert.equal(hn.ensureVisits+hn.ensureFull+hn.raisedVisits+hn.raisedFull,0,`4: k=${k} ${name}: HR ensure visits no definition and lists no type (${hn.ensureVisits} visits, ${hn.ensureFull} lists)`);
    assert.ok(hn.ensureHeld>0,`k=${k} ${name}: HR ensure asks for the held companies`);
  }
}
// The previous source grew with the types; this one does not.
for(const name of Object.keys(N0.worlds)){
  const b0=B0.worlds[name],b10=B10.worlds[name],n0=N0.worlds[name],n10=N10.worlds[name];
  assert.ok(b0.finance.cheque.full>0&&b10.finance.cheque.visits>b0.finance.cheque.visits,`4: ${name}: the previous finance command listed every type and grew (${b0.finance.cheque.visits} then ${b10.finance.cheque.visits} visits)`);
  assert.ok(b0.hr.ensureFull>0&&b10.hr.ensureVisits>b0.hr.ensureVisits,`4: ${name}: the previous HR ensure listed every type and grew`);
  assert.ok(b10.hr.salaryPolicyKeys.filter(synthetic).length===K&&n10.hr.salaryPolicyKeys.filter(synthetic).length===0,`4: ${name}: the previous HR ensure wrote ${K} salary rows for unopened types; this one none`);
  assert.equal(json(n10.hr.salaryPolicyKeys),json(n0.hr.salaryPolicyKeys),`4: ${name}: the salary rows do not grow with the types`);
  assert.equal(n10.money,n0.money,`4: ${name}: the money roots do not grow with the types`);
  for(const label of Object.keys(n0.finance))assert.equal(json({...n10.finance[label],result:null}),json({...n0.finance[label],result:null}),`4: ${name}/${label}: the finance command's work does not grow with the types`);
  assert.equal(json(n10.app.types.value),json(n0.app.types.value),`4: ${name}: companyFinanceTypes does not grow with the types`);
}
console.log(JSON.stringify({suite:'build580-company-types-money-weight',ok:true,previous:PREVIOUS,chequeVisits:{previous:[B0.worlds.all.finance.cheque.visits,B10.worlds.all.finance.cheque.visits],now:[N0.worlds.all.finance.cheque.visits,N10.worlds.all.finance.cheque.visits]},chequeLists:{previous:B0.worlds.all.finance.cheque.full,now:{full:N0.worlds.all.finance.cheque.full,held:N0.worlds.all.finance.cheque.held}},hrEnsureVisits:{previous:[B0.worlds.all.hr.ensureVisits,B10.worlds.all.hr.ensureVisits],now:[N0.worlds.all.hr.ensureVisits,N10.worlds.all.hr.ensureVisits]},salaryRows:{previous:[B0.worlds.all.hr.salaryPolicyKeys.length,B10.worlds.all.hr.salaryPolicyKeys.length],now:[N0.worlds.all.hr.salaryPolicyKeys.length,N10.worlds.all.hr.salaryPolicyKeys.length]}}));
