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
  // The definition names and legacy owners of a sealed platform are one frozen pair shared by every params object
  // (save-schema fleetValidationParams): their part of the token is kept with the pair. The token is the same string as
  // JSON.stringify of the six parts.
  const STATIC_TOKEN_TAILS=new WeakMap();
  function staticTokenTail(params){
    const names=params.definitionCompanies,owners=params.legacyAssetOwners,fixed=Array.isArray(names)&&Object.isFrozen(names)&&object(owners)&&Object.isFrozen(owners);
    let tail=fixed?STATIC_TOKEN_TAILS.get(names):null;if(tail&&tail.owners===owners)return tail.text;
    const definitionCompanies=(Array.isArray(names)?names:[]).map(String),legacyAssetOwners=Object.fromEntries(Object.entries(object(owners)?owners:{}).map(([mode,owner])=>[String(mode),String(owner||'')]));
    tail={owners,text:JSON.stringify(definitionCompanies)+','+JSON.stringify(legacyAssetOwners)};if(fixed)STATIC_TOKEN_TAILS.set(names,tail);return tail.text;
  }
  function contextToken(params={}){
    const routeIds=Array.isArray(params.routeIds)?params.routeIds:[],routes=(Array.isArray(params.routes)?params.routes:[]).filter(Array.isArray).map(row=>[row[0],String(row[1]||''),String(row[2]||''),Number.isSafeInteger(row[3])?row[3]:null]),registryCompanies=(Array.isArray(params.registryCompanies)?params.registryCompanies:[]).map(String),companyReferenceCompanies=(Array.isArray(params.companyReferenceCompanies)?params.companyReferenceCompanies:params.registryCompanies||[]).map(String);
    return '['+JSON.stringify(routeIds)+','+JSON.stringify(routes)+','+JSON.stringify(registryCompanies)+','+JSON.stringify(companyReferenceCompanies)+','+staticTokenTail(params)+']';
  }
  function normalizedParams(params={}){
    const routeIds=new Set(Array.isArray(params.routeIds)?params.routeIds:[]),routes=new Map();
    for(const row of Array.isArray(params.routes)?params.routes:[])if(Array.isArray(row)&&row.length>=3&&!routes.has(row[0])){const mode=String(row[1]||''),base=ROUTE_FLEET_CAPACITY[mode]||1,stored=Number(row[3]);routes.set(row[0],{mode,owner:String(row[2]||''),capacity:Number.isSafeInteger(stored)&&stored>base?Math.min(stored,8192):base});}
    const registryCompanies=new Set((Array.isArray(params.registryCompanies)?params.registryCompanies:[]).map(String)),companyReferenceCompanies=new Set((Array.isArray(params.companyReferenceCompanies)?params.companyReferenceCompanies:params.registryCompanies||[]).map(String)),definitionCompanies=new Set((Array.isArray(params.definitionCompanies)?params.definitionCompanies:[]).map(String));
    const legacyOwners=object(params.legacyAssetOwners)?params.legacyAssetOwners:{};
    return {routeIds,routes,registryCompanies,companyReferenceCompanies,definitionCompanies,legacyOwners,contextToken:contextToken(params)};
  }
  // The company platform's fleet predicates, on the worker's existing identity class tables. No row strings or class
  // tables cross the worker boundary. A malformed large fleet fails closed with bounded error evidence.
  function summarizeCompany(state,fleet,params={}){
    const context=normalizedParams(params),errors=[],seen=new Set();let overflow=false,logicalRows=0;
    const add=error=>{if(seen.has(error))return;if(errors.length>=COMPANY_ERROR_LIMIT){overflow=true;return;}seen.add(error);errors.push(error);};
    const check=row=>{const mode=String(row?.assetMode||row?.type||''),owner=String(row?.ownerCompanyId||row?.companyId||context.legacyOwners[mode]||'');if(!dataId(owner)||!context.companyReferenceCompanies.has(owner)&&!context.definitionCompanies.has(owner))add(`asset-company-reference:${row?.id||'unknown'}`);if(row?.assetClass!==undefined&&!companyDataId(row.assetClass))add(`asset-class:${row?.id||'unknown'}`);};
    fleet.forEachFieldClasses(state,['id','ownerCompanyId','companyId','assetMode','type','assetClass'],(row,count,info)=>{
      logicalRows+=count;const before=errors.length;check(row);
      if(errors.length!==before&&info.members>1){errors.length=before;seen.clear();for(const error of errors)seen.add(error);info.forEachMember(check);}
    });
    return {schema:COMPANY_SCHEMA,version:VERSION,errors,overflow,logicalRows,assetFieldVisits:logicalRows};
  }
  // The one-pass reference: every check on every row. summarize() below returns exactly its result.
  function summarizeReference(state,fleet,params={}){
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
  // Build 362 follow-up (iPhone diagnostic DX-1792142505027, 980,000 assets): each player decision waited ~2.0 s for this
  // pass on the fleet worker. About four fifths of it are checks of fields an operating fleet does not rewrite (names,
  // text, numbers, images, ids, owners, classes). Those checks are kept per store chunk and reused while the chunk's
  // identityVersions, epoch/chunkMass, the actual interned dependencies, validation context and text inspector agree.
  // Counter columns and unrelated interned values preserve this proof; a replacement of a referenced value expires it.
  // The time-derived and route checks (base, phase,
  // progress, fuel, condition, route) still run over every row on every call. The result, including the order of its
  // errors and company errors, is exactly summarizeReference's: a code's place is its first row, then its place in a row.
  const LIVE_ONLY=Object.freeze(['baseFacility','phase','progress','fuel','condition','routeId','releaseExclusiveRouteOnArrival']);
  const LIVE_FIELDS=Object.freeze(['assetMode','type','ownerCompanyId','companyId',...LIVE_ONLY]);
  const STATIC_FIELDS=Object.freeze(FIELDS.filter(field=>!LIVE_ONLY.includes(field)));
  const ROW_ORDER=new Map([...ENTITY_TEXT_FIELDS.map(([key])=>`display-text-assets-${key}`),...ENTITY_NUMBER_FIELDS.map(key=>`display-number-assets-${key}`),'display-attribute-assets-id','display-attribute-assets-name','display-image-assets-photo','display-coords-assets','asset-shape','asset-phase','asset-progress','asset-fuel','asset-condition','asset-route-reference','asset-route-required','asset-route-company'].map((code,at)=>[code,at]));
  const staticCache=new WeakMap();let staticStats={chunksChecked:0,chunksReused:0,lastChecked:0,lastReused:0,cacheable:null,lastReset:'',lastMiss:null};
  function knownModeOf(context,asset,mode,owner){return ROUTE_TYPES.has(mode)||Boolean(context.legacyOwners[mode])||(dataId(mode)&&owner&&context.registryCompanies.has(owner));}
  function staticChunk(state,fleet,context,from,to){
    const codes=new Map(),company=[],companySet=new Set();let overflow=false;
    // Only these interned values feed STATIC_FIELDS. Unrelated last-trip/free-slot changes must not discard the
    // million-row proof. Existing row identity versions still cover every field write and structural mutation.
    const STORE=globalThis.GH_FLEET_STORE,store=fleet.storeOf?.(state),views=STORE?.isStore?.(store)?STORE.views(store):null,refs=new Map();
    const note=(code,index)=>{if(!codes.has(code))codes.set(code,index);};
    const addCompanyError=error=>{if(companySet.has(error))return;if(company.length>=COMPANY_ERROR_LIMIT){overflow=true;return;}companySet.add(error);company.push(error);};
    const validReference=companyId=>dataId(companyId)&&(context.companyReferenceCompanies.has(companyId)||context.definitionCompanies.has(companyId));
    let companyFailed=false;
    const inspect=(asset,index)=>{
      if(views&&refs.size<=4096){
        const w=index*STORE.WORDS_PER_ROW,present=views.u32[w+STORE.O.present];let ref=views.u32[w+STORE.O.profile];
        if(ref&&!refs.has(ref))refs.set(ref,store.values[ref]);
        if(present&STORE.HOT_BIT.id){ref=views.u32[w+STORE.O.idPattern];if(ref&&!refs.has(ref))refs.set(ref,store.values[ref]);}
        if(present&STORE.HOT_BIT.name){ref=views.u32[w+STORE.O.namePattern];if(ref&&!refs.has(ref))refs.set(ref,store.values[ref]);}
      }
      for(const [key,maximum] of ENTITY_TEXT_FIELDS)if(asset[key]!=null&&!safeText(asset[key],maximum))note(`display-text-assets-${key}`,index);
      for(const key of ENTITY_NUMBER_FIELDS)if(asset[key]!=null&&!finite(asset[key]))note(`display-number-assets-${key}`,index);
      if(asset.id!=null&&!safeAttribute(asset.id,180))note('display-attribute-assets-id',index);
      if(asset.name!=null&&!safeAttribute(asset.name,180,{allowEmpty:true}))note('display-attribute-assets-name',index);
      if(asset.photo!=null&&asset.photo!==''&&!safeImage(asset.photo))note('display-image-assets-photo',index);
      if(asset.coords!=null&&!validPoint(asset.coords))note('display-coords-assets',index);
      const mode=modeOf(asset),explicitOwner=ownerOf(asset),owner=explicitOwner||String(context.legacyOwners[mode]||'')||mode;
      if(!object(asset)||!String(asset.id||'').trim()||!knownModeOf(context,asset,mode,owner)||!dataId(owner))note('asset-shape',index);
      const platformOwner=String(explicitOwner||context.legacyOwners[mode]||'');
      if(!validReference(platformOwner)){companyFailed=true;addCompanyError(`asset-company-reference:${asset.id||'unknown'}`);}
      if(asset.assetClass!==undefined&&!companyDataId(asset.assetClass)){companyFailed=true;addCompanyError(`asset-class:${asset.id||'unknown'}`);}
    };
    if(!views){fleet.scan(state,STATIC_FIELDS,inspect,{from,to});return {codes,company,overflow,refs:refs.size<=4096?[...refs]:null};}
    // Emulated phone (200,000 assets, 4x CPU): this pass read every row's static fields and inspected their text, about
    // 400 ms per chunk of 32,768 rows, and a day close moves every active chunk's identity version without writing a
    // static field (flight hours, incidents, trip ends), so the first command after it re-checked them all (2.3 s on
    // the iPhone's worker). A row without extras takes its static fields from three interned values only: its profile
    // (model, icon, year, mode, type, class, owner) and its id and name, each a pattern prefix plus a number. The checks
    // read text through its characters and trimmed length, and digits are never refused, so rows with the same
    // profile, the same patterns and the same digit counts get the same verdicts. Each such group is inspected at its
    // first row (the earliest index, so every code keeps its first index); a group whose first row fails a company
    // check (its errors name each row's id) has every member inspected. Rows with extras, and a full group table, are
    // inspected row by row as before.
    const W=views.u32,U=views.u8,V=store.values,O=STORE.O,ID=STORE.HOT_BIT.id,NAME=STORE.HOT_BIT.name,WR=STORE.WORDS_PER_ROW,SR=STORE.STRIDE,ALIVE=STORE.ALIVE,EXTRAS=STORE.EXTRAS,end=Math.min(store.length,to),table=new Array(8192);
    const one=index=>fleet.scan(state,STATIC_FIELDS,inspect,{from:index,to:index+1});
    const digits=n=>n<10?1:n<100?2:n<1e3?3:n<1e4?4:n<1e5?5:n<1e6?6:n<1e7?7:n<1e8?8:n<1e9?9:10;
    const width=(ref,n)=>{const pattern=V[ref],w=pattern&&typeof pattern==='object'?Number(pattern.w)||0:0,d=digits(n);return w>d?w:d;};
    let groups=0;
    for(let index=Math.max(0,from);index<end;index++){
      const flags=U[index*SR+O.flags];if(!(flags&ALIVE))continue;
      if(flags&EXTRAS||groups>=4096){one(index);continue;}
      const w=index*WR,present=W[w+O.present],profile=W[w+O.profile],idRef=present&ID?W[w+O.idPattern]:0,idWidth=present&ID?width(idRef,W[w+O.idNumber]):-1,nameRef=present&NAME?W[w+O.namePattern]:0,nameWidth=present&NAME?width(nameRef,W[w+O.nameNumber]):-1;
      // A bounded query-local table, with full tuple equality after hashing. Collisions never reuse a verdict.
      let slot=(Math.imul(profile,0x9e3779b1)^Math.imul(idRef,0x85ebca6b)^Math.imul(nameRef,0xc2b2ae35)^Math.imul(idWidth+2,0x27d4eb2f)^Math.imul(nameWidth+2,0x165667b1))&8191,probes=0,group;
      for(;;){group=table[slot];if(!group||group.profile===profile&&group.idRef===idRef&&group.idWidth===idWidth&&group.nameRef===nameRef&&group.nameWidth===nameWidth)break;if(++probes===16)break;slot=(slot+1)&8191;}
      if(probes===16){one(index);continue;}
      if(!group){companyFailed=false;one(index);table[slot]={profile,idRef,idWidth,nameRef,nameWidth,company:companyFailed};groups++;continue;}
      if(group.company)one(index);
    }
    return {codes,company,overflow,refs:refs.size<=4096?[...refs]:null};
  }
  function staticTables(state,fleet,context){
    const STORE=globalThis.GH_FLEET_STORE,store=typeof fleet.storeOf==='function'?fleet.storeOf(state):null;
    const cacheable=!!store&&typeof STORE?.staticSnapshot==='function'&&typeof STORE.chunkStamp==='function'&&typeof STORE.epoch==='function'&&typeof STORE.valuesGeneration==='function'&&Number.isSafeInteger(STORE.CHUNK_ROWS)&&STORE.CHUNK_ROWS>0&&Array.isArray(STORE.IDENTITY_TIER_EXEMPT)&&!STATIC_FIELDS.some(field=>STORE.IDENTITY_TIER_EXEMPT.includes(field));
    staticStats.cacheable=cacheable;
    if(!cacheable){staticStats.chunksChecked++;staticStats.lastChecked=1;staticStats.lastReused=0;return [staticChunk(state,fleet,context,0,Infinity)];}
    const rows=STORE.CHUNK_ROWS,count=Math.ceil(store.length/rows),versions=STORE.staticSnapshot(store).identity,inspector=globalThis.GH_IDENTITY?.inspectPlainText||null;
    const stamp=`${STORE.epoch(store)}:${STORE.chunkStamp(store).chunkMass}`;
    let cache=staticCache.get(store);
    // iPhone diagnostic DX-1792378248326: the first command after a day close re-checked all 30 chunks (2.3 s on the
    // worker) and nothing said why. The reason is kept with the existing counters (no extra pass): which part of the
    // cache key moved, and for each re-checked chunk whether its identity version, bounds or interned values changed.
    let reset='';if(!cache)reset='empty';else if(cache.stamp!==stamp)reset=cache.stamp.split(':')[0]!==stamp.split(':')[0]?'epoch':'chunk-mass';else if(cache.contextToken!==context.contextToken)reset='context';else if(cache.inspector!==inspector)reset='inspector';
    if(reset){cache={stamp,contextToken:context.contextToken,inspector,chunks:[]};staticCache.set(store,cache);}
    if(cache.chunks.length>count)cache.chunks.length=count;
    const tables=[],miss={version:0,bounds:0,refs:0,new:0};let checked=0,reused=0;
    for(let chunk=0;chunk<count;chunk++){
      const from=chunk*rows,to=Math.min(store.length,from+rows);let entry=cache.chunks[chunk];
      if(entry&&entry.version===versions[chunk]&&entry.from===from&&entry.to===to&&entry.refs&&entry.refs.every(([ref,value])=>store.values[ref]===value))reused++;
      else{miss[!entry?'new':entry.version!==versions[chunk]?'version':entry.from!==from||entry.to!==to?'bounds':'refs']++;entry={version:versions[chunk],from,to,...staticChunk(state,fleet,context,from,to)};cache.chunks[chunk]=entry;checked++;}
      tables.push(entry);
    }
    staticStats.chunksChecked+=checked;staticStats.chunksReused+=reused;staticStats.lastChecked=checked;staticStats.lastReused=reused;staticStats.lastReset=reset;staticStats.lastMiss=miss;
    return tables;
  }
  function summarize(state,fleet,params={}){
    if(!fleet||typeof fleet.scan!=='function'||typeof fleet.idCollisions!=='function')throw new Error('fleet-save-validation-access-missing');
    const context=normalizedParams(params),first=new Map(),routeUsersAll=new Map();let logicalRows=0;
    const note=(code,index)=>{const prior=first.get(code);if(prior===undefined||index<prior)first.set(code,index);};
    const inspect=(asset,index)=>{
      logicalRows++;
      const mode=modeOf(asset),explicitOwner=ownerOf(asset),owner=explicitOwner||String(context.legacyOwners[mode]||'')||mode;
      if(!String(asset.baseFacility||'').trim())note('asset-shape',index);
      if(!ASSET_PHASES.has(asset.phase))note('asset-phase',index);
      if(!finite(asset.progress)||Number(asset.progress)<0||Number(asset.progress)>1)note('asset-progress',index);
      if(!finite(asset.fuel)||Number(asset.fuel)<0||Number(asset.fuel)>100)note('asset-fuel',index);
      if(!finite(asset.condition)||Number(asset.condition)<0||Number(asset.condition)>100)note('asset-condition',index);
      if(asset.routeId!=null&&(!String(asset.routeId).trim()||!context.routeIds.has(asset.routeId)))note('asset-route-reference',index);
      if((asset.phase==='moving'||asset.phase==='turnaround')&&!asset.routeId)note('asset-route-required',index);
      if(asset.routeId){
        let users=routeUsersAll.get(asset.routeId);if(!users){users={users:0,stable:0,firstIndex:index,firstMode:mode};routeUsersAll.set(asset.routeId,users);}users.users++;if(!(asset.phase==='moving'&&asset.releaseExclusiveRouteOnArrival===true))users.stable++;
        const route=context.routes.get(asset.routeId);if(route&&(route.mode!==mode||route.owner!==owner))note('asset-route-company',index);
      }
    };
    const STORE=globalThis.GH_FLEET_STORE,store=fleet.storeOf?.(state);
    if(!STORE?.isStore?.(store)||typeof globalThis.GH_FLEET_EVENTS?.boundedLiveDerive!=='function'||globalThis.GH_FLEET_EVENTS.derive!==globalThis.GH_FLEET_EVENTS.boundedLiveDerive)fleet.scan(state,LIVE_FIELDS,inspect);
    else{
      // Ordinary numeric slots that are already inside these intervals stay inside them under Events.derive:
      // progress clamps to [0,1], fuel to [4,100], condition to [55,100], and idle/turnaround retain the slots.
      // Anything exceptional or outside the intervals still uses the exact time-derived reference projection.
      // This cache lasts only this synchronous query. No gameplay bookkeeping or trust in raw-write versions is added.
      const v=STORE.views(store),W=v.u32,F=v.f64,U=v.u8,V=store.values,O=STORE.O,B=STORE.HOT_BIT,t=Math.max(0,Number(state.simSeconds)||0),groups=new Array(8192);
      let last=null,groupCount=0;
      for(let index=0;index<store.length;index++){
        const at=index*128,flags=U[at+O.flags];if(!(flags&STORE.ALIVE))continue;
        const w=index*32,f=index*16,p=W[w+O.present],progress=p&B.progress?F[f+O.progress]:0,fuel=p&B.fuel?F[f+O.fuel]:100,condition=p&B.condition?F[f+O.condition]:100;
        const routeRef=p&B.routeId?W[w+O.routeId]:-1,baseRef=p&B.baseFacility?W[w+O.baseFacility]:-1,phaseRef=p&B.phase?W[w+O.phase]:-1,profileRef=W[w+O.profile],release=p&B.releaseExclusiveRouteOnArrival?U[at+O.releaseExclusiveRouteOnArrival]===1:undefined;
        const routeId=routeRef<0?undefined:routeRef===0?null:V[routeRef],phaseValue=phaseRef<0?undefined:phaseRef===0?null:V[phaseRef],phase=phaseValue|| (routeId?'moving':'idle'),binding=V[W[w+O.binding]],carry=p&B.simCarrySeconds?F[f+O.simCarrySeconds]:0;
        if(groupCount>=4096||flags&STORE.EXTRAS||!(progress>=0&&progress<=1&&fuel>=0&&fuel<=100&&condition>=0&&condition<=100)||routeId&&phase!=='idle'&&t>F[f+O.at]-Math.max(0,Number.isFinite(carry)?carry:0)&&(!binding||typeof binding.tripSeconds!=='number'||!binding.tripSeconds)){
          fleet.scan(state,LIVE_FIELDS,inspect,{from:index,to:index+1});continue;
        }
        logicalRows++;
        let group=last;
        if(!group||group.profileRef!==profileRef||group.routeRef!==routeRef||group.baseRef!==baseRef||group.phaseRef!==phaseRef||group.release!==release){
          // A bounded query-local table, with full tuple equality after hashing. Collisions never reuse evidence.
          let slot=(Math.imul(profileRef,0x9e3779b1)^Math.imul(routeRef,0x85ebca6b)^Math.imul(baseRef,0xc2b2ae35)^Math.imul(phaseRef,0x27d4eb2f)^(release===undefined?2:release?1:0))&8191,probes=0;
          for(;;){group=groups[slot];if(!group||group.profileRef===profileRef&&group.routeRef===routeRef&&group.baseRef===baseRef&&group.phaseRef===phaseRef&&group.release===release)break;if(++probes===16)break;slot=(slot+1)&8191;}
          if(probes===16){logicalRows--;fleet.scan(state,LIVE_FIELDS,inspect,{from:index,to:index+1});continue;}
          if(!group){
            const value=V[profileRef],profile=value&&typeof value==='object'?value:null,asset={assetMode:profile?.assetMode,type:profile?.type,ownerCompanyId:profile?.ownerCompanyId,companyId:undefined,baseFacility:baseRef<0?undefined:baseRef===0?null:V[baseRef],phase,progress:0,fuel:100,condition:100,routeId,releaseExclusiveRouteOnArrival:release};
            // Apply categorical predicates once at their first row, but numeric predicates stay exact for every row.
            const before=logicalRows;inspect(asset,index);logicalRows=before;
            const users=routeId?routeUsersAll.get(routeId):null;
            group={profileRef,routeRef,baseRef,phaseRef,release,users,stable:!(phase==='moving'&&release===true),first:index};groups[slot]=group;groupCount++;
          }
          last=group;
        }
        if(group.first!==index&&group.users){group.users.users++;if(group.stable)group.users.stable++;}
      }
    }
    const companyErrors=[],companyErrorSet=new Set();let companyErrorsOverflow=false;
    for(const table of staticTables(state,fleet,context)){
      for(const [code,index] of table.codes)note(code,index);
      if(table.overflow)companyErrorsOverflow=true;
      for(const error of table.company){if(companyErrorSet.has(error))continue;if(companyErrors.length>=COMPANY_ERROR_LIMIT){companyErrorsOverflow=true;continue;}companyErrorSet.add(error);companyErrors.push(error);}
    }
    const errors=new Set([...first].sort((a,b)=>a[1]-b[1]||ROW_ORDER.get(a[0])-ROW_ORDER.get(b[0])).map(([code])=>code));
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
  const API=Object.freeze({VERSION,SCHEMA,COMPANY_SCHEMA,FIELDS,STATIC_FIELDS,LIVE_FIELDS,ERROR_CODES,COMPANY_ERROR_LIMIT,contextToken,summarize,summarizeReference,summarizeCompany,staticStats:()=>({...staticStats}),accepts});
  globalThis.GH_FLEET_SAVE_VALIDATION=API;if(globalThis.window&&window!==globalThis)window.GH_FLEET_SAVE_VALIDATION=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
