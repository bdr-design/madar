'use strict';
// Reopening a game that had bought a single asset refused its save (MIGRATION_SAVE_REJECTED:delivery-receipt): the load
// migration (migration-core migrateDeliveryAndCrewBatches) took a compact receipt (GH_FLEET_DATA.compactReceipt, the
// current form of a delivered batch) for a legacy row, found its assetId (realism keeps it on a single-asset delivery),
// pulled the live asset back into the receipt as `assets`, and the save schema refuses a compact receipt with assets.
// Proven on the real fleet store, fleet data and migration owners, against the source before (b87885e) in its own
// process:
//  1. a compact single-asset receipt is left exactly as it is (the same object, no assets, still compact) and the
//     migration reports no change, so the load does not rewrite the save either;
//  2. the source before pulled the asset into the receipt and reported a change (the defect);
//  3. a legacy single-asset row (no receipt, only its assetId) is still batched from the live asset, as before;
//  4. multi-asset compact receipts beside it are untouched too.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..'),PREVIOUS='b87885e';
function run(root){
  global.window=global;for(const key of ['GH_FLEET_STORE','GH_FLEET_DATA','GH_MIGRATION_CORE'])delete global[key];
  const STORE=require(path.join(root,'WebApp/fleet-store-core.js'));require(path.join(root,'WebApp/fleet-access-core.js'));require(path.join(root,'WebApp/migration-core.js'));
  const DATA=global.GH_FLEET_DATA,MIGRATION=global.GH_MIGRATION_CORE;
  const asset=(id,order)=>({id,name:'Truck '+id,type:'road',ownerCompanyId:'road',assetMode:'road',deliveryOrderId:order,baseFacility:'DP-RUH',phase:'idle',condition:100});
  const delivery=(id,assets)=>({id,deliveryOrderId:id,status:'delivered',baseId:'DP-RUH',ownerCompanyId:'road',assetMode:'road',count:assets.length,assets,assetIds:assets.map(a=>a.id),assetId:assets.length===1?assets[0].id:null});
  const fleet=STORE.create(),single=asset('ONE-1','DEL-ONE'),many=[asset('MANY-1','DEL-MANY'),asset('MANY-2','DEL-MANY'),asset('MANY-3','DEL-MANY')],legacy=asset('OLD-1','DEL-OLD');
  for(const row of [single,...many,legacy])STORE.add(fleet,{...row});
  const compactOne=delivery('DEL-ONE',[{...single}]),compactMany=delivery('DEL-MANY',many.map(a=>({...a})));
  assert.ok(DATA.compactReceipt(compactOne)&&DATA.compactReceipt(compactMany),'realism compacts both delivered batches');
  assert.equal(compactOne.assetId,'ONE-1','a single-asset receipt keeps its assetId');
  const legacyRow={id:'DEL-OLD',deliveryOrderId:'DEL-OLD',status:'delivered',baseId:'DP-RUH',ownerCompanyId:'road',count:1,assetId:'OLD-1'};
  const state={saveVersion:'3.0.0',simSeconds:100,fleet,realism:{procurement:{deliveries:[compactOne,compactMany,legacyRow],pendingDeliveryCount:0}},advanced:{labor:{employmentContracts:[],hiringLog:[]}}};
  const result=MIGRATION.migrateFleet(state),rows=state.realism.procurement.deliveries,byId=id=>rows.find(row=>row.id===id);
  // A save holding only compact receipts (the usual case once deliveries are done).
  const fleet2=STORE.create(),one2=asset('TWO-1','DEL-TWO');STORE.add(fleet2,{...one2});const compactTwo=delivery('DEL-TWO',[{...one2}]);DATA.compactReceipt(compactTwo);
  const only={saveVersion:'3.0.0',simSeconds:100,fleet:fleet2,realism:{procurement:{deliveries:[compactTwo],pendingDeliveryCount:0}},advanced:{labor:{employmentContracts:[],hiringLog:[]}}},onlyChanged=MIGRATION.migrateFleet(only).changed;
  return {changed:result.changed,onlyCompactChanged:onlyChanged,oneSame:byId('DEL-ONE')===compactOne,oneHasAssets:Object.prototype.hasOwnProperty.call(byId('DEL-ONE'),'assets'),oneCompact:DATA.isCompactReceipt(byId('DEL-ONE')),
    manySame:byId('DEL-MANY')===compactMany,manyHasAssets:Object.prototype.hasOwnProperty.call(byId('DEL-MANY'),'assets'),
    legacyAssets:(byId('DEL-OLD').assets||[]).map(a=>a.id),legacyIds:byId('DEL-OLD').assetIds||null};
}
if(process.env.GH_B639_CHILD==='1'){process.stdout.write(JSON.stringify(run(process.env.GH_TEST_SOURCE_DIR)));return;}
const now=run(ROOT);
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'gh-b639-'));let before;
try{
  fs.cpSync(path.join(ROOT,'WebApp'),path.join(tmp,'WebApp'),{recursive:true});
  fs.writeFileSync(path.join(tmp,'WebApp','migration-core.js'),execFileSync('git',['-C',process.env.GH_B639_GIT_DIR||ROOT,'show',`${PREVIOUS}:WebApp/migration-core.js`],{encoding:'utf8'}));
  before=JSON.parse(execFileSync(process.execPath,[__filename],{env:{...process.env,GH_TEST_SOURCE_DIR:tmp,GH_B639_CHILD:'1'},encoding:'utf8'}));
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
// 1.
assert.equal(now.onlyCompactChanged,false,'1: a save of compact receipts is not changed by the load');assert.equal(now.oneSame,true,'1: the compact single-asset receipt is the same object');assert.equal(now.oneHasAssets,false,'1: no assets are pulled into it');assert.equal(now.oneCompact,true,'1: it is still a compact receipt');
// 2.
assert.equal(before.oneHasAssets,true,'2: the source before pulled the live asset into the compact receipt');assert.equal(before.onlyCompactChanged,true,'2: and reported a change for a save of compact receipts');
// 3.
assert.deepEqual(now.legacyAssets,['OLD-1'],'3: a legacy single-asset row is still batched from the live asset');assert.deepEqual(now.legacyIds,['OLD-1']);assert.deepEqual(now.legacyAssets,before.legacyAssets,'3: as before');
// 4.
assert.equal(now.manySame,true,'4: a multi-asset compact receipt is untouched');assert.equal(now.manyHasAssets,false);
console.log(JSON.stringify({suite:'build639-compact-receipt-reload',ok:true,now,before}));
