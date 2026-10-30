'use strict';
// Owner (build 106 iPhone diagnostic: a purchase of 150,000 assets took 5-9 s, the clock stopped; then «حلها على دفعات
// واختبارات صارمة جدًا جدًا»): every purchased row was copied through JSON three times before the fleet store copied what
// it keeps (the item's specs and the base staffing for the row, then the whole row). The purchase now hands each row to
// the fleet once: the rows share one frozen copy of the specs and of the base staffing, and the fleet takes a row built
// for that call alone ({fresh:true}) without its own JSON copy when JSON would not change it. On the real plan, apply,
// fleet access, fleet store, transaction and fleet core owners, against the source before (1d7dce1, from its own tree):
//  1. the same purchases (one and two delivery groups, cash and lease, nested specs, empty specs, 3,000 rows) leave exactly
//     the source before's fleet: every row, the store's bytes, values and extras, the crew, the labor and the sequences;
//  2. a purchase parses JSON a bounded number of times per delivery group, not per row: 3,000 rows as often as 102 in as
//     many groups (the source before: three times per row);
//  3. deliveredAsset still returns rows of its own: equal to the source before's, no two sharing an object;
//  4. a row JSON would change (a number that is not finite or is -0, in a slot or in a nested value; a row with toJSON;
//     a class instance; a Date; an undefined, function or symbol value) is stored by fleet.add({fresh:true}) exactly as
//     the source before stores it, and the store keeps no reference to a row it was given: changing the row (and its
//     nested values) afterwards changes nothing stored;
//  5. a purchase that fails after its rows were written, inside a transaction, leaves the fleet (every row, the store's
//     bytes, values and extras; its revision counters move on), the crew and the labor exactly as they were.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm'),{execFileSync}=require('node:child_process');
const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
function scenario(){
  const SOURCE=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
  const {scenario:world}=require('./helpers/business-scenario');
  const Plan=require(path.join(SOURCE,'WebApp/asset-purchase-plan-core.js')),Apply=require(path.join(SOURCE,'WebApp/asset-purchase-apply-core.js'));
  const make=({tag,groups:sizes,ownership='cash',specs})=>{
    const e=world(),{s,state,item}=e;state.simSeconds=172810;state.advanced.facilities.B1.capacity=1000000;
    state.fleet=s.GH_FLEET_STORE.fromAssets([],{at:state.simSeconds});delete state.assets;
    const registry=state.companyRegistry.air,itemSpecs=specs===undefined?clone(item.specs):specs==='none'?undefined:specs;
    const common={contextToken:`purchase:${tag}`,ownerCompanyId:'air',assetMode:'air',assetClass:'aircraft',operationProfileId:registry.operationProfileId,companyShortName:registry.shortName,companyName:registry.legalName,tab:'new',ownership,simSeconds:state.simSeconds,item:{id:item.id,icon:item.icon,name:item.name,year:item.year,condition:item.condition,...(itemSpecs===undefined?{}:{specs:itemSpecs}),price:item.price,leaseMonthly:item.leaseMonthly||1000}};
    state.sequences=state.sequences||{};state.sequences['fleetCore_EMP-AUTO']=sizes.length;state.sequences['fleetCore_HR-AUTO']=sizes.length;
    let next=101;const groups=sizes.map((qty,index)=>{const start=next;next+=qty;return {qty,assetSequenceStart:start,serialStart:400+start,assetIdPrefix:'N-AIR',baseId:'B1',baseName:'Test airport',orderId:`DEL-${tag}-${index}`,requestRef:`REQ-${tag}-${index}`,supplier:'Supplier LLC',contractId:`EMP-AUTO-000000${index+1}`,hiringId:`HR-AUTO-000000${index+1}`,payment:{kind:'cheque',ref:`CH-${tag}-${index}`,invoiceRef:`INV-${tag}-${index}`,ownerCompanyId:'air',company:'air',amount:item.price*qty},orderedAtSeconds:state.simSeconds,deliveredAtSeconds:state.simSeconds,documentLeadDays:120,immediateDelivery:true};});
    const plan=Plan.prepare({...common,groups});s.GH_FLEET_STORE.ensureCapacity(state.fleet,state.fleet.length+plan.count);
    return {...e,state,plan};
  };
  const adapterFor=env=>{const {s,state}=env;return Apply.createAdapter(state,{fleetData:s.GH_FLEET_DATA,storeApi:s.GH_FLEET_STORE,transactionCore:s.GH_TRANSACTION_CORE,planCore:Plan,facilityOf:id=>state.globalBases.find(row=>row.id===id)||null,capacityOf:facility=>s.GH_FACILITY_CORE.assetCapacity(facility),manageReceipts:false,manageGroupValue:false,maxSynchronousBaselineRows:10000});};
  const consume=iterator=>{let step;while(!(step=iterator.next()).done){}return step.value;};
  const snapshot=env=>{const {s,state}=env,store=state.fleet;return JSON.stringify({assets:s.GH_FLEET_DATA.map(state,row=>s.GH_FLEET_DATA.plain(row)),labor:state.advanced.labor||null,crew:state.crew,sequences:state.sequences,store:{length:store.length,live:store.live,capacity:store.capacity,structure:store.structure,revision:store.revision,values:store.values,rows:Buffer.from(new Uint8Array(store.rows,0,store.length*s.GH_FLEET_STORE.STRIDE)).toString('base64'),extras:store.extras}});};
  // JSON.parse in both realms (the plan and apply owners run in Node's, the fleet owners in the harness context).
  const counting=env=>{const contextJSON=vm.runInContext('JSON',env.s),parses={n:0},wrap=target=>{const real=target.parse;target.parse=function(...args){parses.n++;return real.apply(this,args);};return ()=>{target.parse=real;};};const undo=[wrap(JSON),wrap(contextJSON)];return {parses,stop:()=>undo.forEach(f=>f())};};
  const out={purchases:{},parses:{},delivered:null,fresh:{},rollback:null};
  // 1-2.
  for(const variant of [{tag:'ONE',groups:[67]},{tag:'TWO',groups:[67,35],ownership:'lease'},{tag:'NESTED',groups:[40],specs:{range:{km:7400,reserve:[1,2,{x:0.5}]},seats:[12,180],label:'QA'}},{tag:'EMPTYSPECS',groups:[25],specs:{}},{tag:'LARGE',groups:[2000,1000]}]){
    const env=make(variant),count=counting(env);let result;try{result=consume(Plan.applyStages(env.plan,adapterFor(env),{budgetMs:4}));}finally{count.stop();}
    out.purchases[variant.tag]={count:result.count,snapshot:snapshot(env)};out.parses[variant.tag]={rows:result.count,groups:variant.groups.length,parses:count.parses.n};
  }
  // 3.
  {const env=make({tag:'DELIVERED',groups:[3,2]}),a=Plan.deliveredAsset(env.plan,0,0),b=Plan.deliveredAsset(env.plan,0,1),c=Plan.deliveredAsset(env.plan,1,0);
    out.delivered={rows:JSON.stringify([a,b,c]),separate:a.specs!==b.specs&&a.staffing!==b.staffing&&a.staffing.roles!==b.staffing.roles&&a.specs!==c.specs,writable:!Object.isFrozen(a.specs)&&!Object.isFrozen(a.staffing)&&!Object.isFrozen(a.staffing.roles)};
    a.specs.qa=1;a.staffing.roles.push({id:'qa',count:1});out.delivered.after=JSON.stringify([Plan.deliveredAsset(env.plan,0,0),Plan.deliveredAsset(env.plan,0,1)]);}
  // 4.
  {
    class Point{constructor(){this.id='N-AIR-00009001';this.name='Class 1';this.baseFacility='B1';this.phase='idle';}}
    const base=index=>({id:`N-AIR-${String(9100+index).padStart(8,'0')}`,name:`QA ${100+index}`,ownerCompanyId:'air',assetMode:'air',assetClass:'aircraft',type:'air',routeId:null,baseFacility:'B1',phase:'idle',progress:0,fuel:100,condition:90,routeSlot:null,departureScheduled:false,crewBlocked:false,specs:{range:100},staffing:{mode:'automatic-fixed',ready:true,roles:[{id:'pilots',count:2}]}});
    const rows={plain:()=>base(0),nan:()=>({...base(1),progress:NaN}),infinity:()=>({...base(2),fuel:Infinity}),negativeInfinity:()=>({...base(3),condition:-Infinity}),negativeZero:()=>({...base(4),condition:-0}),negativeZeroSlot:()=>({...base(5),routeSlot:-0}),negativeZeroProfile:()=>({...base(6),year:-0}),nestedNaN:()=>({...base(7),specs:{range:NaN,list:[Infinity,-0]}}),toJSON:()=>({...base(8),toJSON(){return {id:'N-AIR-00009208',name:'Rewritten 1',phase:'idle'};}}),instance:()=>new Point(),date:()=>({...base(10),deliveredAtSeconds:new Date(0)}),undefinedValue:()=>({...base(11),routeId:undefined,extraField:undefined}),functionValue:()=>({...base(12),helper(){return 1;}}),symbolKey:()=>({...base(13),[Symbol('qa')]:1}),extraNested:()=>({...base(14),lastTrip:{from:'A',to:'B',legs:[1,2]},customNote:{text:'x',n:[1,{y:2}]}})};
    for(const [name,make_] of Object.entries(rows)){
      const env=world(),{s,state}=env;state.fleet=s.GH_FLEET_STORE.fromAssets([],{at:0});delete state.assets;
      const row=make_();let error=null;try{s.GH_FLEET_DATA.add(state,row,{returnView:false,fresh:true});}catch(e){error=String(e.message);}
      const stored=snapshot({s,state});
      // The row and its nested values changed afterwards.
      try{if(row.specs&&typeof row.specs==='object'&&!Object.isFrozen(row.specs))row.specs.range=-1;if(row.staffing?.roles)row.staffing.roles.push({id:'late',count:9});if(row.lastTrip)row.lastTrip.legs.push(3);if(row.customNote)row.customNote.n[1].y=99;row.phase='changed';}catch(_e){}
      out.fresh[name]={error,stored,unchanged:snapshot({s,state})===stored};
    }
  }
  // 5.
  {const env=make({tag:'FAIL',groups:[700,300]}),before=snapshot(env);let failed=null;
    try{env.s.GH_TRANSACTION_CORE.execute(env.state,{label:'qa-605-purchase-fails',apply:()=>{consume(Plan.applyStages(env.plan,adapterFor(env),{budgetMs:4}));throw new Error('qa-605-injected');}});}catch(error){failed=String(error.message);}
    // The store's structure and revision counters only move forward (a rollback is a new revision).
    const strip=text=>{const v=JSON.parse(text);delete v.store.structure;delete v.store.revision;return JSON.stringify(v);};out.rollback={failed,same:strip(snapshot(env))===strip(before),size:env.s.GH_FLEET_DATA.size(env.state)};}
  return out;
}
if(process.env.QA_BUILD605_SCENARIO){process.stdout.write(JSON.stringify(scenario()));return;}
const ROOT=path.resolve(__dirname,'..'),PREVIOUS='1d7dce1',tree=fs.mkdtempSync(path.join(os.tmpdir(),'b605-'));
try{
  execFileSync('sh',['-c',`git -C "${ROOT}" archive ${PREVIOUS} WebApp | tar -x -C "${tree}"`]);require(path.join(ROOT,'tests/helpers/brand-baseline.cjs')).brandBaseline(tree,ROOT);
  const before=JSON.parse(execFileSync(process.execPath,[__filename],{env:{...process.env,GH_TEST_SOURCE_DIR:tree,QA_BUILD605_SCENARIO:'1'},maxBuffer:512*1024*1024}).toString());
  const now=scenario();
  // 1.
  assert.deepEqual(Object.keys(now.purchases),Object.keys(before.purchases));
  for(const tag of Object.keys(now.purchases)){assert.equal(now.purchases[tag].count,before.purchases[tag].count,`1: ${tag}: the same rows`);assert.equal(now.purchases[tag].snapshot,before.purchases[tag].snapshot,`1: ${tag}: exactly the source before's fleet, store bytes, crew, labor and sequences`);}
  assert.equal(now.purchases.LARGE.count,3000);
  // 2.
  for(const tag of Object.keys(now.parses)){const a=now.parses[tag],b=before.parses[tag];assert.ok(b.parses>=3*b.rows,`2: ${tag}: (the source before parsed JSON three times per row: ${b.parses} for ${b.rows})`);assert.ok(a.parses<=40*a.groups,`2: ${tag}: at most 40 JSON parses per delivery group, not per row (${a.parses} for ${a.rows} rows in ${a.groups})`);}
  assert.equal(now.parses.LARGE.parses,now.parses.TWO.parses,`2: 3,000 rows parse as often as 102 in as many groups (${now.parses.LARGE.parses}, ${now.parses.TWO.parses})`);
  // 3.
  assert.equal(now.delivered.rows,before.delivered.rows,'3: deliveredAsset returns the source before\'s rows');assert.equal(now.delivered.separate,true,'3: no two rows share an object');assert.equal(now.delivered.writable,true,'3: its rows are the caller\'s to change');assert.equal(now.delivered.after,before.delivered.after,'3: changing one row changes no other');
  // 4.
  assert.deepEqual(Object.keys(now.fresh),Object.keys(before.fresh));
  for(const name of Object.keys(now.fresh)){const a=now.fresh[name],b=before.fresh[name];assert.equal(a.error,b.error,`4: ${name}: the same refusal`);assert.equal(a.stored,b.stored,`4: ${name}: stored exactly as the source before stores it`);assert.equal(a.unchanged,true,`4: ${name}: changing the row afterwards changes nothing stored`);}
  assert.notEqual(now.fresh.nan.stored,now.fresh.plain.stored);
  // 5.
  assert.equal(now.rollback.failed,'qa-605-injected','5: the purchase failed');assert.equal(now.rollback.same,true,'5: the fleet, crew and labor are exactly as they were');assert.equal(now.rollback.size,0);
  console.log(JSON.stringify({suite:'build605-purchase-rows-copied-once',ok:true,parses:{now:now.parses,before:before.parses}}));
}finally{fs.rmSync(tree,{recursive:true,force:true});}
