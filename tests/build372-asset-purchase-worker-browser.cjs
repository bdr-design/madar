'use strict';

const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const web=path.join(path.resolve(__dirname,'..'),'WebApp'),read=file=>fs.readFileSync(path.join(web,file),'utf8');
const workerFiles=['fleet-store-core.js','simulation-asset-core.js','route-core.js','fleet-event-core.js','fleet-access-core.js','fleet-core.js','fleet-health-core.js','fleet-day-core.js','fleet-ui-summary-core.js','fleet-global-route-query-core.js','fleet-route-normalization-core.js','fleet-sale-plan-core.js','fleet-manual-departure-plan-core.js','asset-purchase-plan-core.js','asset-purchase-apply-core.js','fleet-query-core.js','fleet-dispatch-core.js'];
const workerSource=workerFiles.map(read).join('\n;\n')+'\n;\n'+read('fleet-engine-worker.js').replace(/^importScripts\([^)]*\);$/m,'');
(async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(String(error)));await page.setContent('<!doctype html><meta charset="utf-8">');
    for(const file of ['fleet-store-core.js','simulation-asset-core.js','fleet-access-core.js','asset-purchase-plan-core.js','asset-purchase-apply-core.js','fleet-query-core.js','fleet-engine-thread.js'])await page.addScriptTag({content:read(file)});
    const result=await page.evaluate(async workerSource=>{
      const assets=[];for(let i=0;i<1200;i++)assets.push({id:`OLD-${String(i+1).padStart(8,'0')}`,ownerCompanyId:i%3?'air':'road',companyId:i%3?'air':'road',assetMode:i%3?'air':'road',type:i%3?'air':'road',baseFacility:i%2?'B1':'B2',staffing:{mode:'automatic-fixed',ready:true,roles:[{id:i%3?'pilots':'drivers',count:i===7?1/3:2}]}});
      const state={fleet:GH_FLEET_STORE.fromAssets(assets,{at:0}),simSeconds:100},store=state.fleet,plan=GH_ASSET_PURCHASE_PLAN_CORE.prepare({contextToken:'worker-purchase',ownerCompanyId:'air',assetMode:'air',assetClass:'aircraft',operationProfileId:'air-main',companyShortName:'AIR',companyName:'Air Holdings',tab:'new',ownership:'cash',simSeconds:100,item:{id:'MODEL',name:'Model',year:2026,condition:100,price:10,specs:{crewPlan:{pilots:2,cabin:4,aeng:1}}},groups:[{qty:20,assetSequenceStart:5000,serialStart:1300,assetIdPrefix:'N-AIR',baseId:'B1',baseName:'Alpha',orderId:'DEL-AIR-00005000',requestRef:'REQ',supplier:'Supplier',contractId:'EMP-AUTO-00005000',hiringId:'HR-AUTO-00005000',payment:{ref:'CH-1',invoiceRef:'INV-1',amount:200,ownerCompanyId:'air',company:'air'},orderedAtSeconds:100,deliveredAtSeconds:100,immediateDelivery:true}]});
      const url=URL.createObjectURL(new Blob([workerSource],{type:'text/javascript'})),client=GH_FLEET_ENGINE_THREAD.create({workerFactory:()=>new Worker(url),resolveRoute:()=>null,routesRevision:()=>0,catalogSpecs:()=>({}),timeoutMs:15000});client.prime(store);
      const ask=async()=>{for(let attempt=0;attempt<50;attempt++){const pending=client.query(store,{name:'purchaseBaseline',params:{plan,legacyOwner:{air:'air',road:'road'}},simSeconds:100});if(pending)return pending;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('purchaseBaseline worker stayed unavailable');};
      const first=await ask(),expected=GH_ASSET_PURCHASE_APPLY_CORE.computeBaseline(state,GH_FLEET_DATA,plan,GH_ASSET_PURCHASE_PLAN_CORE,{ownerForMode:{air:'air',road:'road'}}),parity=JSON.stringify(first.result)===JSON.stringify(expected),current=client.current(first,store),tokens=first.result.membershipRevision===GH_FLEET_DATA.membershipRevision(state)&&first.result.revision===GH_FLEET_DATA.revision(state),free=first.result.idsFree===true;
      GH_FLEET_STORE.set(store,0,'id',GH_ASSET_PURCHASE_PLAN_CORE.assetId(plan,0,0));const collision=await ask(),collisionCurrent=client.current(collision,store),blocked=collision.result.idsFree===false;
      const latePromise=ask();GH_FLEET_STORE.set(store,1,'condition',77);const late=await latePromise,staleRejected=client.current(late,store)===false;const stats=client.stats();client.terminate('done');URL.revokeObjectURL(url);return {parity,current,tokens,free,collisionCurrent,blocked,staleRejected,queryRequests:stats.queryRequests};
    },workerSource);
    assert.deepEqual(errors,[]);assert.equal(result.parity,true);assert.equal(result.current,true);assert.equal(result.tokens,true);assert.equal(result.free,true);assert.equal(result.collisionCurrent,true);assert.equal(result.blocked,true);assert.equal(result.staleRejected,true);assert(result.queryRequests>=3);console.log(JSON.stringify({suite:'build372-asset-purchase-worker-browser',ok:true,...result}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
