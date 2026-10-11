// Compact, worker-safe fleet part of Save Schema validation.  The scan stays beside the
// replica and only bounded evidence crosses the worker boundary: global error codes,
// per-known-route counters and the (normally empty) Company Platform asset errors.
(()=>{
  'use strict';
  const VERSION='GH-FLEET-SAVE-VALIDATION-1.0.0',SCHEMA='gh-fleet-save-validation/v1',COMPANY_SCHEMA='gh-company-platform-fleet-validation/v1';
  const ROUTE_TYPES=new Set(['air','sea','road']),ASSET_PHASES=new Set(['idle','delivery','turnaround','moving']);
  const ROUTE_FLEET_CAPACITY=Object.freeze({air:24,sea:24,road:64});
  const COMPANY_ERROR_LIMIT=1024;
  const ENTITY_TEXT_FIELDS=Object.freeze([['name',180],['model',180],['status',80],['city',100],['country',100],['code',40],['iata',12],['icao',12],['detail',500],['capacity',180],['icon',16]]);
  const ENTITY_NUMBER_FIELDS=Object.freeze(['year','gates','landingFeePerTon','jetA1Price','congestion','berths','maxDraftM','craneCount','bays','runwayM','elevationM','dryStorageTEU','reeferPlugs','crudeStorageBbl','fuelBunkerBbl']);
  const FIELDS=Object.freeze(['id','name','model','status','city','country','code','iata','icao','detail','capacity','icon','year','gates','landingFeePerTon','jetA1Price','congestion','berths','maxDraftM','craneCount','bays','runwayM','elevationM','dryStorageTEU','reeferPlugs','crudeStorageBbl','fuelBunkerBbl','photo','coords','assetMode','type','assetClass','ownerCompanyId','companyId','baseFacility','phase','progress','fuel','condition','routeId','releaseExclusiveRouteOnArrival']);
  const ERROR_CODES=Object.freeze(['display-text-assets-name','display-text-assets-model','display-text-assets-status','display-text-assets-city','display-text-assets-country','display-text-assets-code','display-text-assets-iata','display-text-assets-icao','display-text-assets-detail','display-text-assets-capacity','display-text-assets-icon','display-number-assets-year','display-number-assets-gates','display-number-assets-landingFeePerTon','display-number-assets-jetA1Price','display-number-assets-congestion','display-number-assets-berths','display-number-assets-maxDraftM','display-number-assets-craneCount','display-number-assets-bays','display-number-assets-runwayM','display-number-assets-elevationM','display-number-assets-dryStorageTEU','display-number-assets-reeferPlugs','display-number-assets-crudeStorageBbl','display-number-assets-fuelBunkerBbl','display-attribute-assets-id','display-attribute-assets-name','display-image-assets-photo','display-coords-assets','asset-shape','asset-phase','asset-progress','asset-fuel','asset-condition','asset-route-reference','asset-route-required','asset-route-company','asset-route-capacity','asset-id']);
  const ERROR_SET=new Set(ERROR_CODES),own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key),object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
  const finite=value=>typeof value==='number'?Number.isFinite(value):value!==null&&value!==''&&typeof value!=='boolean'&&Number.isFinite(Number(value));
  const dataId=value=>/^[A-Za-z][A-Za-z0-9]*(?:[._-][A-Za-z0-9]+)*$/.test(String(value||''));
  const companyDataId=value=>/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(String(value||''));
  const validPoint=point=>Array.isArray(point)&&point.length>=2&&typeof point[0]==='number'&&Number.isFinite(point[0])&&typeof point[1]==='number'&&Number.isFinite(point[1])&&point[0]>=-90&&point[0]<=90&&point[1]>=-180&&point[1]<=180;
  const safeText=(value,maximum,{allowEmpty=true}={})=>{
    if(value==null)return allowEmpty;const raw=typeof value==='string'?value:String(value),inspector=globalThis.GH_IDENTITY?.inspectPlainText,inspected=inspector?.(raw,{minimum:allowEmpty?0:1,maximum,allowEmpty});
    if(inspected)return inspected.ok===true;const text=raw.trim();
    return (allowEmpty||Boolean(text))&&text.length<=maximum&&!/[<>\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(text);
  };
  const safeAttribute=(value,maximum,{allowEmpty=false}={})=>safeText(value,maximum,{allowEmpty})&&!/"/.test(String(value??''));
  const safeImage=value=>{const text=String(value||'');return /^assets\/[a-zA-Z0-9_.\/-]+\.(?:svg|png|jpe?g|webp)$/i.test(text)&&!text.split('/').includes('..');};
  const modeOf=row=>String(row?.assetMode||row?.type||''),ownerOf=row=>String(row?.ownerCompanyId||row?.companyId||'');
  function contextToken(params={}){
    const routeIds=Array.isArray(params.routeIds)?params.routeIds:[],routes=(Array.isArray(params.routes)?params.routes:[]).filter(Array.isArray).map(row=>[row[0],String(row[1]||''),String(row[2]||''),Number.isSafeInteger(row[3])?row[3]:null]),registryCompanies=(Array.isArray(params.registryCompanies)?params.registryCompanies:[]).map(String),companyReferenceCompanies=(Array.isArray(params.companyReferenceCompanies)?params.companyReferenceCompanies:params.registryCompanies||[]).map(String),definitionCompanies=(Array.isArray(params.definitionCompanies)?params.definitionCompanies:[]).map(String),legacyAssetOwners=Object.fromEntries(Object.entries(object(params.legacyAssetOwners)?params.legacyAssetOwners:{}).map(([mode,owner])=>[String(mode),String(owner||'')]));
    return JSON.stringify([routeIds,routes,registryCompanies,companyReferenceCompanies,definitionCompanies,legacyAssetOwners]);
  }
  function normalizedParams(params={}){
    const routeIds=new Set(Array.isArray(params.routeIds)?params.routeIds:[]),routes=new Map();
    for(const row of Array.isArray(params.routes)?params.routes:[])if(Array.isArray(row)&&row.length>=3&&!routes.has(row[0])){const mode=String(row[1]||''),base=ROUTE_FLEET_CAPACITY[mode]||1,stored=Number(row[3]);routes.set(row[0],{mode,owner:String(row[2]||''),capacity:Number.isSafeInteger(stored)&&stored>base?Math.min(stored,8192):base});}
    const registryCompanies=new Set((Array.isArray(params.registryCompanies)?params.registryCompanies:[]).map(String)),companyReferenceCompanies=new Set((Array.isArray(params.companyReferenceCompanies)?params.companyReferenceCompanies:params.registryCompanies||[]).map(String)),definitionCompanies=new Set((Array.isArray(params.definitionCompanies)?params.definitionCompanies:[]).map(String));
    const legacyOwners=object(params.legacyAssetOwners)?params.legacyAssetOwners:{};
    return {routeIds,routes,registryCompanies,companyReferenceCompanies,definitionCompanies,legacyOwners,contextToken:contextToken(params)};
  }
  function summarize(state,fleet,params={}){
    if(!fleet||typeof fleet.scan!=='function'||typeof fleet.idCollisions!=='function')throw new Error('fleet-save-validation-access-missing');
    const context=normalizedParams(params),errors=new Set(),routeUsersAll=new Map(),companyErrors=[],companyErrorSet=new Set();let companyErrorsOverflow=false,logicalRows=0;
    const addCompanyError=error=>{if(companyErrorSet.has(error))return;if(companyErrors.length>=COMPANY_ERROR_LIMIT){companyErrorsOverflow=true;return;}companyErrorSet.add(error);companyErrors.push(error);};
    const validReference=companyId=>dataId(companyId)&&(context.companyReferenceCompanies.has(companyId)||context.definitionCompanies.has(companyId));
    fleet.scan(state,FIELDS,(asset,index)=>{
      logicalRows++;
      for(const [key,maximum] of ENTITY_TEXT_FIELDS)if(asset[key]!=null&&!safeText(asset[key],maximum))errors.add(`display-text-assets-${key}`);
      for(const key of ENTITY_NUMBER_FIELDS)if(asset[key]!=null&&!finite(asset[key]))errors.add(`display-number-assets-${key}`);
      if(asset.id!=null&&!safeAttribute(asset.id,180))errors.add('display-attribute-assets-id');
      if(asset.name!=null&&!safeAttribute(asset.name,180,{allowEmpty:true}))errors.add('display-attribute-assets-name');
      if(asset.photo!=null&&asset.photo!==''&&!safeImage(asset.photo))errors.add('display-image-assets-photo');
      if(asset.coords!=null&&!validPoint(asset.coords))errors.add('display-coords-assets');
      const mode=modeOf(asset),explicitOwner=ownerOf(asset),owner=explicitOwner||String(context.legacyOwners[mode]||'')||mode,knownMode=ROUTE_TYPES.has(mode)||Boolean(context.legacyOwners[mode])||(dataId(mode)&&owner&&context.registryCompanies.has(owner));
      if(!object(asset)||!String(asset.id||'').trim()||!knownMode||!dataId(owner)||!String(asset.baseFacility||'').trim())errors.add('asset-shape');
      if(!ASSET_PHASES.has(asset.phase))errors.add('asset-phase');
      if(!finite(asset.progress)||Number(asset.progress)<0||Number(asset.progress)>1)errors.add('asset-progress');
      if(!finite(asset.fuel)||Number(asset.fuel)<0||Number(asset.fuel)>100)errors.add('asset-fuel');
      if(!finite(asset.condition)||Number(asset.condition)<0||Number(asset.condition)>100)errors.add('asset-condition');
      if(asset.routeId!=null&&(!String(asset.routeId).trim()||!context.routeIds.has(asset.routeId)))errors.add('asset-route-reference');
      if((asset.phase==='moving'||asset.phase==='turnaround')&&!asset.routeId)errors.add('asset-route-required');
      if(asset.routeId){
        let users=routeUsersAll.get(asset.routeId);if(!users){users={users:0,stable:0,firstIndex:index,firstMode:mode};routeUsersAll.set(asset.routeId,users);}users.users++;if(!(asset.phase==='moving'&&asset.releaseExclusiveRouteOnArrival===true))users.stable++;
        const route=context.routes.get(asset.routeId);if(route&&(route.mode!==mode||route.owner!==owner))errors.add('asset-route-company');
      }
      const platformOwner=String(explicitOwner||context.legacyOwners[mode]||'');
      if(!validReference(platformOwner))addCompanyError(`asset-company-reference:${asset.id||'unknown'}`);
      if(asset.assetClass!==undefined&&!companyDataId(asset.assetClass))addCompanyError(`asset-class:${asset.id||'unknown'}`);
    });
    // The original validator checks every route id it sees, including an unknown one, and uses the first user's mode
    // as the capacity fallback. Keep that check in the worker even though only known-route counters cross the boundary.
    for(const [routeId,users] of routeUsersAll){const route=context.routes.get(routeId),capacity=route?.capacity??ROUTE_FLEET_CAPACITY[route?.mode||users.firstMode]??1;if(users.stable>capacity)errors.add('asset-route-capacity');}
    const ids=fleet.idCollisions(state)||{};if(ids.duplicate||ids.missing)errors.add('asset-id');
    const routeUsers=[];for(const routeId of context.routeIds){const row=routeUsersAll.get(routeId);if(row)routeUsers.push([routeId,row.users,row.stable,row.firstIndex,row.firstMode]);}
    return {schema:SCHEMA,version:VERSION,contextToken:context.contextToken,logicalRows,assetFieldVisits:logicalRows,errors:[...errors],ids:{duplicate:!!ids.duplicate,missing:!!ids.missing},routeUsers,companyPlatform:{schema:COMPANY_SCHEMA,version:VERSION,errors:companyErrors,overflow:companyErrorsOverflow,logicalRows,assetFieldVisits:logicalRows}};
  }
  function accepts(summary,{rows=null,routeIds=null,contextToken:expectedContextToken=null}={}){
    if(!object(summary)||summary.schema!==SCHEMA||summary.version!==VERSION||typeof summary.contextToken!=='string'||summary.contextToken.length>1024*1024||expectedContextToken!==null&&summary.contextToken!==expectedContextToken||!Number.isSafeInteger(summary.logicalRows)||summary.logicalRows<0||rows!==null&&summary.logicalRows!==rows||!Array.isArray(summary.errors)||summary.errors.some(error=>!ERROR_SET.has(error))||!object(summary.ids)||typeof summary.ids.duplicate!=='boolean'||typeof summary.ids.missing!=='boolean'||!Array.isArray(summary.routeUsers))return false;
    const allowed=routeIds&&typeof routeIds.has==='function'&&Number.isSafeInteger(routeIds.size)?routeIds:new Set(Array.isArray(routeIds)?routeIds:[]),seen=new Set();if(summary.routeUsers.length>allowed.size)return false;
    for(const row of summary.routeUsers){if(!Array.isArray(row)||row.length!==5||!allowed.has(row[0])||seen.has(row[0])||!Number.isSafeInteger(row[1])||row[1]<1||!Number.isSafeInteger(row[2])||row[2]<0||row[2]>row[1]||!Number.isSafeInteger(row[3])||row[3]<0||typeof row[4]!=='string')return false;seen.add(row[0]);}
    const company=summary.companyPlatform;if(!object(company)||company.schema!==COMPANY_SCHEMA||company.version!==VERSION||!Array.isArray(company.errors)||company.errors.length>COMPANY_ERROR_LIMIT||company.errors.some(error=>typeof error!=='string'||error.length>400||!/^asset-(?:company-reference|class):/.test(error))||typeof company.overflow!=='boolean'||company.logicalRows!==summary.logicalRows||company.assetFieldVisits!==summary.logicalRows)return false;
    return true;
  }
  const API=Object.freeze({VERSION,SCHEMA,COMPANY_SCHEMA,FIELDS,ERROR_CODES,COMPANY_ERROR_LIMIT,contextToken,summarize,accepts});
  globalThis.GH_FLEET_SAVE_VALIDATION=API;if(globalThis.window&&window!==globalThis)window.GH_FLEET_SAVE_VALIDATION=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
