'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');
const prior=fs.readFileSync(require.resolve('./build371-air-fleet-series-browser.cjs'),'utf8');
const installVault=new Function(prior.slice(prior.indexOf('function installVault(){'),prior.indexOf('(async()=>{'))+'\nreturn installVault;')();
(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    const {page}=await boot({browser,errors,fleetWorker:true});page.setDefaultTimeout(240000);await page.evaluate(installVault);
    const prepared=await page.evaluate(async()=>{
      const a=__AUDIT__,s=__GH_STATE__;
      if(!s.openedCompanies.includes('air'))await a.runAuthorizedDomainCommand('corporate','open-company',{type:'air',capital:400000000,legalName:'Capacity QA'},{silent:true});
      s.godMoney=true;s.infiniteMoney=true;
      const airport=GH_WORLD_DATA.airports.find(row=>row[0]==='OERK'),facility={id:'CAPACITY-B1',name:'Capacity Riyadh',kind:'airport-base',company:'air',ownerCompanyId:'air',owned:true,sourceKey:'air:OERK',icao:'OERK',code:airport[1]||airport[0],iata:airport[1],coords:[airport[6],airport[7]],city:airport[3]||airport[4]||'—',country:String(airport[5]||'—')};
      await a.runAuthorizedDomainCommand('facilities','create',{facility,bucket:'globalBases'},{silent:true});
      const item=GH_ASSET_CATALOG.air.used.filter(row=>Number(row.specs?.rangeKm)>0&&Number(row.specs?.rangeKm)<1500)[0];if(!item)throw new Error('short range fixture model');
      let bought=0;while(bought<20000){const n=Math.min(3000,20000-bought);if(!await a.buyAsset('air','used',item.id,'lease',n,facility.id,true,`CAPACITY-${bought}`,'air'))throw new Error('purchase fixture');bought+=n;}
      // Fill 318 slots with valid, distinct routes at other origins, as a developed international network has.
      const airports=GH_WORLD_DATA.airports.filter(row=>row[0]!=='OERK'),entity=row=>({key:`air:${row[0]}`,kind:'airport',icao:row[0],code:row[0],iata:row[1],name:row[3]||row[0],city:row[4]||row[0],country:row[5],coords:[row[6],row[7]]});
      const model={...GH_FLEET_DATA.viewAt(s,0),specs:{...item.specs,rangeKm:50000}};let rejected=0;
      GH_TRANSACTION_CORE.execute(s,{label:'capacity-test-network',apply(){
        for(let i=0;i+1<airports.length&&s.customRoutes.filter(r=>r.routeMode==='air').length<318;i+=2){
          const from=a.ensurePublicRouteEndpoint(entity(airports[i]),s),to=a.ensurePublicRouteEndpoint(entity(airports[i+1]),s),route=a.buildPublicRoute(model,from,to,s,`CAPACITY-R-${i}`);if(!route)continue;
          try{const registered=GH_ROUTE_CORE.execute({state:s},'create',{route});a.routeTemplates[registered.id]=registered;}catch(e){if(!/duplicate|conflict|near/i.test(e.message))throw e;rejected++;}
        }
      }});
      const budget=GH_ROUTE_CORE.modeRouteBudget(s,'air');return {bought,budget,rejected};
    });
    assert.equal(prepared.budget.used,318);assert.equal(prepared.budget.free,2);
    const result=await page.evaluate(async()=>{
      const out=await __AUDIT__.dispatchSharedInternationalNetwork('air');if(!out)throw new Error('capacity dispatch failed');
      const s=__GH_STATE__,counts={routed:0,idle:0};GH_FLEET_DATA.scan(s,['routeId','phase','departureScheduled'],row=>{if(row.routeId)counts.routed++;else if(row.phase==='idle')counts.idle++;});
      const budget=GH_ROUTE_CORE.modeRouteBudget(s,'air'),schema=GH_SAVE_SCHEMA.validate(s);
      return {departed:out.departed,remaining:out.remaining,limited:out.capacityLimited,created:out.createdRoutes,counts,budget,valid:schema.ok,errors:schema.errors.slice(0,5),maxCapacity:Math.max(...s.customRoutes.map(r=>GH_FLEET_CORE.routeCapacity(r)))};
    });
    assert.equal(result.departed,16384);assert.equal(result.remaining,3616);assert.equal(result.limited,true);assert.equal(result.counts.routed,16384);assert.equal(result.counts.idle,3616);
    assert.equal(result.budget.used,320);assert.equal(result.valid,true,JSON.stringify(result.errors));assert.ok(result.maxCapacity<=8192);
    const retry=await page.evaluate(async()=>{
      const before=JSON.stringify([__GH_STATE__.finance,__GH_STATE__.companyFinance]),rows=new Uint8Array(__GH_STATE__.fleet.rows).slice(),out=await __AUDIT__.dispatchSharedInternationalNetwork('air'),after=new Uint8Array(__GH_STATE__.fleet.rows);
      return {refused:out===false,financeUnchanged:before===JSON.stringify([__GH_STATE__.finance,__GH_STATE__.companyFinance]),rowsUnchanged:rows.length===after.length&&rows.every((v,i)=>v===after[i])};
    });
    assert.deepEqual(retry,{refused:true,financeUnchanged:true,rowsUnchanged:true});assert.deepEqual(errors,[]);
    console.log(JSON.stringify({ok:true,prepared,result,retry}));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
