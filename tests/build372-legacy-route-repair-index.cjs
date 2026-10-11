'use strict';
// A legacy save may contain many duplicate route signatures. Repair must preserve the former
// canonical-route decision while indexing the fleet once, instead of filtering every asset for
// every duplicate group (and again inside Array.sort's comparator).
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {harness,minimal}=require('./helpers/core-harness');
const {s}=harness(['save-schema']);

const routes=[],assets=[],GROUPS=40;
for(let group=1;group<=GROUPS;group++){
  const first=`LEGACY-${group}-A`,second=`LEGACY-${group}-B`,from=`BASE-${group}-A`,to=`BASE-${group}-B`,points=[[group,0],[group,.5]];
  routes.push(
    {id:first,type:'air',routeMode:'air',ownerCompanyId:'air',fromFacility:from,toFacility:to,route:structuredClone(points)},
    {id:second,type:'air',routeMode:'air',ownerCompanyId:'air',fromFacility:from,toFacility:to,route:structuredClone(points)}
  );
  for(let index=0;index<3;index++)assets.push({
    id:`LEGACY-ASSET-${group}-${index}`,name:`Legacy ${group}-${index}`,type:'air',assetMode:'air',ownerCompanyId:'air',companyId:'air',
    baseFacility:from,phase:'idle',progress:0,fuel:100,condition:100,routeId:index===0?first:second,routeSlot:0
  });
}

// Count only filters over the whole asset draft. Filters over route-sized arrays are unrelated.
s.__legacyAssetCount=assets.length;s.__legacyWholeFleetFilters=0;
vm.runInContext(`{const native=Array.prototype.filter;Array.prototype.filter=function(...args){if(this.length===globalThis.__legacyAssetCount)globalThis.__legacyWholeFleetFilters++;return native.apply(this,args);};}`,s);
const routeCache=Object.fromEntries(routes.map(route=>[route.id,{route:structuredClone(route.route),distanceKm:100}])),routeEndpoints={ORPHAN:{id:'ORPHAN',routeEndpoint:true,coords:[0,0]}};
for(let group=1;group<=GROUPS;group++){routeEndpoints[`BASE-${group}-A`]={id:`BASE-${group}-A`,routeEndpoint:true,coords:[group,0]};routeEndpoints[`BASE-${group}-B`]={id:`BASE-${group}-B`,routeEndpoint:true,coords:[group,.5]};}
const migrated=s.GH_SAVE_SCHEMA.migrateLegacy({...minimal(),companyRegistry:{air:{id:'air'}},customRoutes:routes,assets,routeCache,routeEndpoints}).state;

assert.equal(s.__legacyWholeFleetFilters,0,'duplicate repair filtered the whole fleet once per route group');
assert.equal(migrated.customRoutes.length,GROUPS);
for(let group=1;group<=GROUPS;group++){
  const canonical=`LEGACY-${group}-B`,rows=[];
  for(let index=0;index<3;index++)rows.push(s.GH_FLEET_DATA.get(migrated,`LEGACY-ASSET-${group}-${index}`));
  assert.ok(rows.every(row=>row.routeId===canonical),`group ${group} did not retain the formerly selected canonical route`);
  assert.deepEqual(rows.map(row=>row.routeSlot),[2,0,1],`group ${group} changed deterministic slot order`);
  assert.equal(Object.hasOwn(migrated.routeCache,`LEGACY-${group}-A`),false,'removed route retained a cache entry');
  assert.equal(migrated.routeCache[canonical].canonicalRouteId,canonical);assert.equal(Object.hasOwn(migrated.routeCache[canonical],'route'),false,'canonical cache retained duplicated geometry');
  assert.ok(migrated.routeEndpoints[`BASE-${group}-A`]);assert.ok(migrated.routeEndpoints[`BASE-${group}-B`]);
}
assert.equal(Object.hasOwn(migrated.routeEndpoints,'ORPHAN'),false,'unreferenced legacy endpoint survived repair');
console.log(JSON.stringify({suite:'build372-legacy-route-repair-index',passed:1,total:1,groups:GROUPS,assets:assets.length,wholeFleetFilters:s.__legacyWholeFleetFilters}));
