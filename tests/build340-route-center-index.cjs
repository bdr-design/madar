'use strict';
// Route center fleet data is computed by fleet-query-core on the fleet worker. This contract guards the app boundary:
// route rendering must consume an exact-revision result and must not scan the million-row fleet on the main thread.

const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..'),app=fs.readFileSync(path.join(ROOT,'WebApp/app.js'),'utf8');
require(path.join(ROOT,'WebApp/fleet-store-core.js'));
const FLEET=require(path.join(ROOT,'WebApp/fleet-access-core.js')),QUERY=require(path.join(ROOT,'WebApp/fleet-query-core.js'));
function section(startText,endText){const start=app.indexOf(startText);assert(start>=0,`missing app section ${startText}`);const end=app.indexOf(endText,start+startText.length);assert(end>start,`missing section end ${endText}`);return app.slice(start,end);}
const snapshot=section('  function routeCenterFleetSnapshot(){','  // What the route cards show');
const linked=section('  function routeCenterLinkedSummary(companyId,routeIds){','  function routeCenterLegacyOwnerMap(){');
const details=section('  function routeCenterDetails(companyId,needle,cards,limit,fleetIndex,manualLimit){','  // The first `limit` assets');
const render=section('  function renderRouteCenter(arg){','  async function createRoadRouteFromForm(){');

assert.match(snapshot,/routeCenterSummaryCache/);
assert.doesNotMatch(snapshot,/\.scan\(|forEachFieldClasses|viewAt\(/,'route summary snapshot must not read fleet rows on the UI thread');
assert.match(linked,/c\.revision===fleet\.revision\(state\)/,'linked route cards are only shown for the exact store revision');
assert.doesNotMatch(linked,/\.query\(|GH_FLEET_QUERY\.run/,'route card counts share the combined route-center worker pass');
assert.match(details,/client\.query\(queryStore,\{name:'routeCenter'/,'route-center detail query uses the fleet worker');
assert.match(details,/client\.current\(found,queryStore\)/,'late worker results are rejected unless the store revision is still exact');
assert.match(details,/routeCenterSummaryCache=\{store,key:fleetIndex\.key,revision,result\}/,'worker results update the summary cache');
assert.doesNotMatch(details,/\.scan\(|forEachFieldClasses|viewAt\(/,'worker query path must not scan or materialize fleet rows on the UI thread');
assert.match(render,/routeCenterDetails\(/,'route search and assignment candidates use the combined route-center query');
assert.doesNotMatch(render,/routeCenterManualAssets|routeCenterFillAssignable/,'old repeated main-thread candidate scans are removed');

// Independently reconstruct the route-center result from plain rows. This checks the query predicates, ordering,
// bounded lists, card sums, facility aliases and capacity handling without using routeCenter as its own oracle.
const assets=Array.from({length:14000},(_,index)=>({id:`ASSET-${String(index).padStart(5,'0')}`,name:`${index%13===0?'Falcon':'Unit'} ${index}`,catalogId:`CAT-${index%9}`,icon:'✈️',ownerCompanyId:`company-${index%5}`,assetMode:index%3===0?'air':index%3===1?'sea':'road',type:index%3===0?'air':index%3===1?'sea':'road',baseFacility:`BASE-${index%100}`,routeId:index%19===0?'R-OPEN':index%101===0?'R-FULL':null,phase:index%7===0?'moving':index%3===0?'turnaround':'idle',status:index%17===0?'moving':'idle',departureScheduled:index%11===0,salePending:index%37===0,deliveryStatus:index%43===0?'pending':'delivered',specs:{rangeKm:index===37?'invalid':index%29===0?100:4000,rangeNm:index===38?'invalid':index%31===0?50:2500},lastTrip:index%5===0?{margin:index*1.1,revenue:index*10.3}:null}));
// Exercise routeFitsAsset's original JS truthiness/coercion behavior on a matching facility and owner.
assets[37].ownerCompanyId='company-0';assets[37].assetMode='road';assets[37].type='road';assets[37].baseFacility='BASE-1';assets[37].name='Falcon invalid range';assets[37].salePending=false;assets[37].deliveryStatus='delivered';assets[37].departureScheduled=false;assets[37].specs.rangeKm='invalid';
const state={assets,simSeconds:0},companyId='company-0',routeIds=['R-OPEN','R-FULL'],facilityAliases=Object.create(null);
for(let index=0;index<100;index++)facilityAliases[`BASE-${index}`]=[`id:BASE-${index}`,`iata:A${index%16}`,`icao:ICAO-${index%16}`,`code:C${index%16}`];
const params={companyId,routeIds,manualNeedle:'falcon',manualLimit:80,idleLimit:60,facilityAliases,legacyOwner:{air:'company-0',sea:'company-1',road:'company-2'},assignableRoutes:[
  {id:'R-OPEN',fromAliases:['id:BASE-1','iata:A1'],toAliases:['id:BASE-2'],capacity:10000,legKm:900,limit:25},
  {id:'R-FULL',fromAliases:['id:BASE-1'],toAliases:['id:BASE-2'],capacity:1,legKm:900,limit:25},
  {id:'R-CONFLICT',fromAliases:['id:BASE-1'],toAliases:['id:BASE-3'],capacity:10000,legKm:900,limit:25,conflict:true}
]};
const actual=QUERY.routeCenter(state,FLEET,params),summaries=new Map(),cards=new Map(),idleRows=new Map(),manualAssets=[],assignable=new Map(params.assignableRoutes.map(route=>[route.id,[]]));
const norm=value=>String(value||'').normalize('NFKD').replace(/[\u0300-\u036f\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]/g,'').toLocaleLowerCase('ar').replace(/\s+/g,' ').trim();
for(const row of assets){const owner=row.ownerCompanyId||row.companyId||params.legacyOwner[row.assetMode||row.type]||'',company=String(owner).trim();if(!company)continue;
  const phase=FLEET.presentedPhase(state,row);let summary=summaries.get(company);if(!summary){summary={total:0,assigned:0,idle:0,moving:0,movingPhase:0,ready:0,internationalReady:0,manualReady:0};summaries.set(company,summary);}
  summary.total++;if(row.routeId)summary.assigned++;else summary.idle++;if(phase==='moving'||row.status==='moving')summary.moving++;if(phase==='moving')summary.movingPhase++;
  if(row.routeId&&phase==='turnaround'&&!row.departureScheduled)summary.ready++;
  if(['air','sea'].includes(row.assetMode||row.type)&&row.deliveryStatus!=='pending'&&phase!=='moving'&&!row.departureScheduled&&!row.salePending)summary.internationalReady++;
  if(row.deliveryStatus!=='pending'&&phase!=='moving'&&!row.departureScheduled&&!row.salePending)summary.manualReady++;
  if(!row.routeId){let list=idleRows.get(company);if(!list){list=[];idleRows.set(company,list);}if(list.length<60)list.push(row);}
  if(company===companyId&&row.deliveryStatus!=='pending'&&row.phase!=='moving'&&!row.departureScheduled&&!row.salePending&&(!params.manualNeedle||norm(`${row.name} ${row.id} ${row.catalogId}`).includes(norm(params.manualNeedle)))&&manualAssets.length<80)manualAssets.push(row);
  if(company===companyId&&row.routeId&&routeIds.includes(row.routeId)){let card=cards.get(row.routeId);if(!card){card={count:0,turn:0,scheduled:0,inMotion:0,primaryId:row.id,scored:0,margin:0,revenue:0};cards.set(row.routeId,card);}card.count++;if(row.phase==='turnaround'){if(row.departureScheduled)card.scheduled++;else card.turn++;}else if(row.phase==='moving')card.inMotion++;if(row.lastTrip){card.scored++;card.margin+=(Number(row.lastTrip.margin)||0);card.revenue+=(Number(row.lastTrip.revenue)||0);}}
  if(company!==companyId||row.routeId||row.phase==='moving'||row.salePending||row.deliveryStatus==='pending'||!row.baseFacility||!norm(`${row.name} ${row.id} ${row.catalogId}`).includes(norm(params.manualNeedle)))continue;
  const base=facilityAliases[row.baseFacility]||[`id:${row.baseFacility}`],range=row.type==='sea'?(row.specs.rangeNm||0)*1.852:(row.specs.rangeKm||0);
  for(const spec of params.assignableRoutes){if(spec.conflict||(cards.get(spec.id)?.count||0)>=spec.capacity||!(spec.fromAliases.some(alias=>base.includes(alias))||spec.toAliases.some(alias=>base.includes(alias)))||(!range?false:!(spec.legKm<=range*1.005)))continue;assignable.get(spec.id).push(row);}
}
for(const [company,list] of idleRows)summaries.get(company).idleAssets=list.map(row=>{const out={};for(const key of QUERY.ROUTE_CENTER_RESULT_FIELDS)if(row[key]!==undefined)out[key]=row[key];return out;});
const expectedAssignable=params.assignableRoutes.map(spec=>{const rows=spec.conflict||(cards.get(spec.id)?.count||0)>=spec.capacity?[]:assignable.get(spec.id);return [spec.id,{rows:rows.slice(0,25).map(row=>{const out={};for(const key of QUERY.ROUTE_CENTER_RESULT_FIELDS)if(row[key]!==undefined)out[key]=row[key];return out;}),more:rows.length>25}];});
const expected={legacy:false,summaryByCompany:[...summaries],cards:[...cards],manualAssets:manualAssets.map(row=>{const out={};for(const key of QUERY.ROUTE_CENTER_RESULT_FIELDS)if(row[key]!==undefined)out[key]=row[key];return out;}),assignable:expectedAssignable};
assert.deepEqual(actual,expected,'worker query predicates and bounded presentation rows match an independent row-order oracle');

console.log(JSON.stringify({suite:'build340-route-center-index',check:'worker query boundary and exact-revision acceptance'}));
console.log('PASS route center query matches the independent oracle for summaries, cards, manual rows and facility-matched candidates; the app requests this result without scanning on the main thread');
