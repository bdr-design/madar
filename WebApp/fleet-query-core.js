// Build 372: fleet passes that read every row (a million at the largest scale) as pure functions of the fleet, so the
// fleet engine's worker can run them on its replica (fleet-engine-worker 'query') and the main thread runs the same code
// when it cannot (no worker, or a replica that is not exactly its store). Each is the pass app.js made itself, with the
// same fields, predicates and row order, so both give the same result:
//   dispatchEligible: the shared international dispatch's pass (app.js dispatchSharedInternationalNetwork);
//   routeCards: the route center's per-route card counts and trip sums (app.js routeCenterLinkedSummary);
//   conditionSum: the insured fleet's condition total (realism-core fleetConditionSum, the daily close's insurance).
// The owner of a row is its ownerCompanyId or companyId; a row with neither is owned through the company platform's
// legacy mode table, which only the main thread has: a pass given no legacyOwner then returns {legacy:true} and the
// caller runs it on the main thread instead.
(()=>{
  'use strict';
  const VERSION='1.0.0';
  const DISPATCH_FIELDS=Object.freeze(['ownerCompanyId','companyId','assetMode','type','deliveryStatus','phase','departureScheduled','salePending','routeId']);
  const CARD_FIELDS=Object.freeze(['ownerCompanyId','companyId','assetMode','type','routeId','phase','departureScheduled','lastTrip','id']);
  const ROUTE_CENTER_FIELDS=Object.freeze(['ownerCompanyId','companyId','assetMode','type','routeId','phase','simulationFault','status','departureScheduled','deliveryStatus','salePending','baseFacility','name','id','catalogId','icon','specs','lastTrip']);
  const ROUTE_CENTER_RESULT_FIELDS=Object.freeze(['ownerCompanyId','companyId','assetMode','type','routeId','phase','departureScheduled','deliveryStatus','salePending','baseFacility','name','id','catalogId','icon']);
  const modeOf=row=>String(row?.assetMode||row?.type||'').trim();
  // app.js assetOwnerCompanyId, with the legacy mode table as a parameter.
  const ownerFn=(legacyOwner,flag)=>row=>{
    const explicit=row?.ownerCompanyId||row?.companyId;if(explicit)return String(explicit).trim();
    const mode=modeOf(row);
    if(typeof legacyOwner==='function')return String(legacyOwner(mode)||'').trim();
    if(legacyOwner)return String(legacyOwner[mode]||'').trim();
    flag.legacy=true;return '';
  };
  // The company's idle assets of this mode (first `limit` row indices, row order), the idle ones beyond (and how many of
  // them hold a route), and the assets per route (initial loads, in first-occurrence order).
  function dispatchEligible(state,fleet,{companyId,type,limit=20000,legacyOwner=null}={}){
    const flag={legacy:false},owner=ownerFn(legacyOwner,flag),indices=[],loads=new Map();let remaining=0,remainingOnRoutes=0;
    fleet.scan(state,DISPATCH_FIELDS,(row,index)=>{
      if(owner(row)!==companyId||modeOf(row)!==type)return;
      const idle=row.deliveryStatus!=='pending'&&row.phase!=='moving'&&!row.departureScheduled&&!row.salePending;
      if(idle&&indices.length<limit){indices.push(index);return;}
      if(idle){remaining++;if(row.routeId)remainingOnRoutes++;}
      if(row.routeId)loads.set(row.routeId,(loads.get(row.routeId)||0)+1);
    });
    if(flag.legacy)return {legacy:true};
    return {legacy:false,indices,remaining,remainingOnRoutes,initialLoads:[...loads]};
  }
  // What the route cards show about the company's assets on `routeIds`: per route the count, ready / scheduled / moving
  // counts, the first asset's id, and the trip margin and revenue sums in row order over assets with a last trip.
  function routeCards(state,fleet,{companyId,routeIds=[],legacyOwner=null}={}){
    const flag={legacy:false},owner=ownerFn(legacyOwner,flag),wanted=new Set(routeIds),out=new Map();
    if(!wanted.size)return {legacy:false,cards:[]};
    fleet.scan(state,CARD_FIELDS,row=>{
      if(!row.routeId||!wanted.has(row.routeId)||owner(row)!==companyId)return;
      let card=out.get(row.routeId);if(!card){card={count:0,turn:0,scheduled:0,inMotion:0,primaryId:row.id,scored:0,margin:0,revenue:0};out.set(row.routeId,card);}
      card.count++;if(row.phase==='turnaround'){if(row.departureScheduled)card.scheduled++;else card.turn++;}else if(row.phase==='moving')card.inMotion++;
      if(row.lastTrip){card.scored++;card.margin=card.margin+(Number(row.lastTrip.margin)||0);card.revenue=card.revenue+(Number(row.lastTrip.revenue)||0);}
    });
    if(flag.legacy)return {legacy:true};
    return {legacy:false,cards:[...out]};
  }
  // The insured fleet's condition total (realism-core fleetConditionSum): condition, or 100 without one, over every row
  // in row order, so the sum is the same number on either side.
  function conditionSum(state,fleet){let sum=0;fleet.scan(state,['condition'],row=>{sum+=Number(row.condition)||100;});return {legacy:false,sum};}
  // The route drawer used to do separate main-thread passes for totals, idle rows, manual candidates and assignable
  // candidates after durable commands. Keep one row-order pass and return only bounded presentation rows.
  function routeCenter(state,fleet,{companyId=null,routeIds=[],manualNeedle='',manualLimit=80,idleLimit=60,assignableRoutes=[],facilityAliases={},legacyOwner=null}={}){
    const flag={legacy:false},owner=ownerFn(legacyOwner,flag),wanted=new Set(routeIds),summaries=new Map(),cards=new Map(),idleByCompany=new Map(),manualAssets=[],assignable=new Map(),needle=normalizeSearch(manualNeedle),manualMax=Math.max(0,Math.floor(Number(manualLimit)||0)),idleMax=Math.max(0,Math.floor(Number(idleLimit)||0));
    const routeSpecs=(assignableRoutes||[]).map(spec=>({...spec,aliases:new Set([...(spec.fromAliases||[]),...(spec.toAliases||[])])})),specsByAlias=new Map();
    for(const spec of routeSpecs)for(const alias of spec.aliases){let list=specsByAlias.get(alias);if(!list){list=[];specsByAlias.set(alias,list);}list.push(spec);}
    for(const spec of routeSpecs)assignable.set(spec.id,[]);
    fleet.scan(state,ROUTE_CENTER_FIELDS,row=>{
      const company=owner(row);if(!company)return;
      const phase=fleet.presentedPhase(state,row);let summary=summaries.get(company);
      if(!summary){summary={total:0,assigned:0,idle:0,moving:0,movingPhase:0,ready:0,internationalReady:0,manualReady:0};summaries.set(company,summary);}
      summary.total++;if(row.routeId)summary.assigned++;else summary.idle++;
      if(phase==='moving'||row.status==='moving')summary.moving++;if(phase==='moving')summary.movingPhase++;
      if(row.routeId&&phase==='turnaround'&&!row.departureScheduled)summary.ready++;
      if(['air','sea'].includes(modeOf(row))&&row.deliveryStatus!=='pending'&&phase!=='moving'&&!row.departureScheduled&&!row.salePending)summary.internationalReady++;
      if(row.deliveryStatus!=='pending'&&phase!=='moving'&&!row.departureScheduled&&!row.salePending)summary.manualReady++;
      if(!row.routeId&&idleMax){let list=idleByCompany.get(company);if(!list){list=[];idleByCompany.set(company,list);}if(list.length<idleMax)list.push(copyRouteRow(row));}
      if(company===companyId&&row.deliveryStatus!=='pending'&&row.phase!=='moving'&&!row.departureScheduled&&!row.salePending&&manualAssets.length<manualMax&&(!needle||normalizeSearch(`${row.name||''} ${row.id||''} ${row.catalogId||''}`).includes(needle)))manualAssets.push(copyRouteRow(row));
      if(row.routeId&&wanted.has(row.routeId)&&company===companyId){let card=cards.get(row.routeId);if(!card){card={count:0,turn:0,scheduled:0,inMotion:0,primaryId:row.id,scored:0,margin:0,revenue:0};cards.set(row.routeId,card);}card.count++;if(row.phase==='turnaround'){if(row.departureScheduled)card.scheduled++;else card.turn++;}else if(row.phase==='moving')card.inMotion++;if(row.lastTrip){card.scored++;card.margin=card.margin+(Number(row.lastTrip.margin)||0);card.revenue=card.revenue+(Number(row.lastTrip.revenue)||0);}}
      if(company!==companyId||row.routeId||row.phase==='moving'||row.salePending||row.deliveryStatus==='pending'||!row.baseFacility)return;
      if(needle&&!normalizeSearch(`${row.name||''} ${row.id||''} ${row.catalogId||''}`).includes(needle))return;
      const base=facilityAliases[String(row.baseFacility)]||[`id:${String(row.baseFacility)}`],range=row.type==='sea'?(row.specs?.rangeNm||0)*1.852:(row.specs?.rangeKm||0),candidateSpecs=new Set();
      for(const alias of base)for(const spec of specsByAlias.get(alias)||[])candidateSpecs.add(spec);
      for(const spec of candidateSpecs){if(spec.conflict||!routeFitsRange(range,spec.legKm))continue;const list=assignable.get(spec.id);if(list.length>=Number(spec.limit||40)){list.more=true;continue;}list.push(copyRouteRow(row));}
    });
    if(flag.legacy)return {legacy:true};
    for(const [company,list] of idleByCompany){const summary=summaries.get(company);if(summary)summary.idleAssets=list;}
    for(const spec of routeSpecs)if(spec.conflict||(cards.get(spec.id)?.count||0)>=Number(spec.capacity||0))assignable.set(spec.id,[]);
    return {legacy:false,summaryByCompany:[...summaries],cards:[...cards],manualAssets,assignable:[...assignable].map(([id,rows])=>[id,{rows,more:!!rows.more}])};
  }
  function copyRouteRow(row){const out={};for(const field of ROUTE_CENTER_RESULT_FIELDS)if(row[field]!==undefined)out[field]=row[field];return out;}
  function normalizeSearch(value){return String(value||'').normalize('NFKD').replace(/[\u0300-\u036f\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]/g,'').toLocaleLowerCase('ar').replace(/\s+/g,' ').trim();}
  function routeFitsRange(range,legKm){return !range||legKm<=range*1.005;}
  const QUERIES=Object.freeze({dispatchEligible,routeCards,conditionSum,routeCenter});
  function run(name,state,fleet,params){const query=QUERIES[name];if(!query)throw new Error(`fleet-query-unknown:${name}`);return query(state,fleet,params||{});}
  const API=Object.freeze({VERSION,DISPATCH_FIELDS,CARD_FIELDS,ROUTE_CENTER_FIELDS,ROUTE_CENTER_RESULT_FIELDS,dispatchEligible,routeCards,conditionSum,routeCenter,run,names:Object.freeze(Object.keys(QUERIES))});
  globalThis.GH_FLEET_QUERY=API;
  if(globalThis.window&&globalThis.window!==globalThis)globalThis.window.GH_FLEET_QUERY=API;
  if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
