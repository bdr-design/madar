'use strict';
// A domain depart-batch returns exactly the compact replay projection already used by domain-command-core, while the
// public Fleet Core helper keeps its historical full-asset result. Both paths must leave the fleet bit-for-bit equal.
const assert=require('node:assert/strict'),path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');process.env.GH_TEST_SOURCE_DIR=ROOT;
const {harness,minimal}=require('./helpers/core-harness');
const {s}=harness(['fleet-store-core','simulation-asset-core','fleet-access-core','route-core','fleet-core']);
const STORE=s.GH_FLEET_STORE,FLEET=s.GH_FLEET_CORE;

const route={id:'DEPART-PROJECTION-ROUTE',type:'air',company:'air',ownerCompanyId:'air',routeMode:'air',name:'Projection route',from:'A',to:'B',fromFacility:'BASE-A',toFacility:'BASE-B',route:[[24.7,46.6],[25.2,47.1]],distanceKm:90,maxLegKm:90,effectiveSpeedKmh:600,tripSeconds:540,dwellHours:1,fleetCapacity:96};
const assets=Array.from({length:80},(_,index)=>({
  id:`DEPART-PROJECTION-${String(index).padStart(3,'0')}`,name:`Aircraft ${index}`,type:'air',assetMode:'air',ownerCompanyId:'air',companyId:'air',baseFacility:index%2?'BASE-B':'BASE-A',phase:'turnaround',progress:0,fuel:73,condition:91,routeId:route.id,routeSlot:index,departureScheduled:false,staffing:{mode:'automatic-fixed',ready:true,roles:[],total:8,monthlyPayroll:1},specs:{capacity:180,rangeKm:5000,speedKmh:820}
}));
function build(){const state={...minimal(),simSeconds:12345,saveVersion:'3.0.0',customRoutes:[structuredClone(route)]};state.fleet=STORE.fromAssets(structuredClone(assets),{at:state.simSeconds});delete state.assets;return state;}
const departures=assets.map((asset,index)=>({id:asset.id,routeRef:'route',load:index%4===0?{passengers:120+index}:`LOAD-${index}`,delaySeconds:index%3===0?FLEET.departureDelay(asset):0}));
const fullState=build(),projectedState=build(),routes={route};
const full=FLEET.departBatch(fullState,structuredClone(departures),routes);
const projected=FLEET.execute({state:projectedState},'depart-batch',{departures:structuredClone(departures),routes});
const projection=asset=>{const row={id:String(asset?.id||''),departureScheduled:asset?.departureScheduled===true,reverse:asset?.reverse===true};for(const key of ['routeId','baseFacility','phase','departureScheduledAt'])if(asset?.[key]!==undefined&&asset?.[key]!==null)row[key]=asset[key];return row;};
const canonical=value=>JSON.parse(JSON.stringify(value));
assert.deepEqual(canonical(projected),canonical(full.map(projection)),'domain result is the established replay projection');
assert.deepEqual(canonical(STORE.toAssets(projectedState.fleet)),canonical(STORE.toAssets(fullState.fleet)),'projection path preserves every fleet write');
assert.ok(full.every(row=>row.staffing?.ready===true),'public helper still returns complete assets');
assert.ok(projected.every(row=>!Object.prototype.hasOwnProperty.call(row,'staffing')&&Object.keys(row).every(key=>['id','departureScheduled','reverse','routeId','baseFacility','phase','departureScheduledAt'].includes(key))),'batch result contains no discarded row materialization');
console.log(JSON.stringify({suite:'build372-depart-projection',rows:assets.length,fullKeys:Object.keys(full[0]).length,projectedKeys:Object.keys(projected[0]).length}));
console.log('BUILD372_DEPART_PROJECTION_PASS');
