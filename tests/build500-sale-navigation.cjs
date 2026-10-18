'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),acorn=require('acorn');
const root=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..'),src=fs.readFileSync(path.join(root,'WebApp/app.js'),'utf8'),functions=new Map();
(function visit(n){if(!n||typeof n!=='object')return;if(n.type==='FunctionDeclaration')functions.set(n.id.name,src.slice(n.start,n.end));for(const v of Object.values(n)){if(Array.isArray(v))v.forEach(visit);else if(v&&typeof v==='object')visit(v);}})(acorn.parse(src,{ecmaVersion:'latest'}));
(async()=>{
 let checked=0;
 for(const type of ['mobility','sold','returned','scheduled'])for(const outcome of ['same','navigate','close','fail','cancel']){
  let release,entered,opens=0,calls=0;const waiting=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve),vehicle={id:'A',name:'QA',ownership:type==='returned'?'lease':'owned',monthlyLease:100,baseFacility:'B'};
  const g={console,drawerNavigationRevision:1,state:{},selectedMobilityId:null,selectedAssetId:null,ask:async()=>outcome!=='cancel',fmtMoney:String,saleEstimate:()=>123,assetOwnerCompanyId:()=> 'air',companyFinanceName:String,findFacility:()=>({owned:true}),notice(){},pushAlert(){},updateKpis(){},renderMap(){},openDrawer(){opens++;},async runAuthorizedDomainCommand(){calls++;entered();await waiting;if(outcome==='fail')throw new Error('native-refusal');return {result:type==='mobility'?{vehicle,proceeds:123}:{status:type,proceeds:123,fee:200}};},window:{GH_MOBILITY_CORE:{findVehicle:()=>vehicle},GH_FLEET_DATA:{get:()=>vehicle}}};
  vm.createContext(g);vm.runInContext(functions.get(type==='mobility'?'sellMobilityAsset':'disposeAsset'),g);
  const job=type==='mobility'?g.sellMobilityAsset('A'):g.disposeAsset('A');
  if(outcome==='cancel'){assert.equal(await job,false);assert.equal(calls,0);assert.equal(opens,0);checked++;continue;}
  await started;assert.equal(opens,0,'no presentation success before native ACK');if(outcome==='navigate'||outcome==='close')g.drawerNavigationRevision++;
  release();await job;assert.equal(calls,1);assert.equal(opens,outcome==='same'?1:0,`${type}/${outcome}: an old handler cannot replace a newer navigation`);checked++;
 }
 assert.match(functions.get('openDrawer'),/if\(!drawerWasOpen\|\|!sameLocation\)drawerNavigationRevision\+\+/);
 assert.match(functions.get('closeDrawer'),/drawerNavigationRevision\+\+/);assert.match(functions.get('openDrawerContent'),/drawerNavigationRevision\+\+/);
 for(const panel of ['assets','assetManage','assetMarket','bank','insurance','telecom','labor'])for(const hidden of [false,true]){
  let writes=0,renders=0;const body={set innerHTML(value){writes++;}},drawer={getAttribute:()=>hidden?'true':'false'},g={activeDrawerPanel:panel,activeDrawerArg:'A',ownedFilterType:'air',$:name=>name==='drawer'?drawer:body,renderOwnedAssets:()=>{renders++;return 'assets';},window:{GH_INTERFACE:{prepare(){}}},bindDrawerActions(){},installOwnedVirtualizer(){},advancedContext:()=>({})};
  vm.createContext(g);vm.runInContext(functions.get('renderOwnedAssetsInto'),g);g.renderOwnedAssetsInto(false);const expected=panel==='assets'&&!hidden?1:0;assert.equal(renders,expected,`${panel}/${hidden}: stale queued worker render performs no work`);assert.equal(writes,expected);checked++;
 }
 console.log(JSON.stringify({suite:'build500-sale-navigation',ok:true,cases:checked,heldAck:true,newNavigationAndClosePreserved:true,staleWorkerRendersSkipWork:true,refusalAndCancellation:true}));
})().catch(e=>{console.error(e);process.exitCode=1;});
