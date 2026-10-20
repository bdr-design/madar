'use strict';

// The main-thread mutation boundary for GH_ASSET_PURCHASE_PLAN_CORE.  It makes
// one fleet baseline (or accepts an exact worker baseline), validates all group
// capacity before the first write, then applies only bounded row additions.
// Fleet Store's journal owns rollback; no purchase group rescans the fleet.
((root,factory)=>{
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.GH_ASSET_PURCHASE_APPLY_CORE=api;
})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  const VERSION='1.0.0',BASELINE_SCHEMA='gh-asset-purchase-baseline-v1',MAX_SYNC_BASELINE_ROWS=10000;
  const PLAN=()=>globalThis.GH_ASSET_PURCHASE_PLAN_CORE||(typeof require==='function'?require('./asset-purchase-plan-core.js'):null);
  const FLEET=()=>globalThis.GH_FLEET_DATA||(typeof require==='function'?require('./fleet-access-core.js'):null);
  const STORE=()=>globalThis.GH_FLEET_STORE||(typeof require==='function'?require('./fleet-store-core.js'):null);
  const TX=()=>globalThis.GH_TRANSACTION_CORE||(typeof require==='function'?require('./transaction-core.js'):null);
  const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
  const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
  const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
  const APPEND_ONLY=Object.freeze({returnView:false});

  function addCrew(counts,staffing,times){
    if(staffing?.mode!=='automatic-fixed'||staffing.ready!==true)return;
    for(const role of staffing.roles||[])counts.set(role.id,(counts.get(role.id)||0)+(Number(role.count)||0)*times);
  }
  function plannedIdGuard(plan,planCore=PLAN()){
    if(!planCore?.validate?.(plan))throw new TypeError('asset-purchase-baseline-plan');const byPrefix=new Map();for(let groupIndex=0;groupIndex<plan.groups.length;groupIndex++){const group=plan.groups[groupIndex],prefix=String(group.assetIdPrefix),range={start:group.assetSequenceStart,end:group.assetSequenceStart+group.qty-1};const rows=byPrefix.get(prefix);if(rows)rows.push(range);else byPrefix.set(prefix,[range]);}
    for(const rows of byPrefix.values())rows.sort((a,b)=>a.start-b.start||a.end-b.end);
    const ranges=[...byPrefix].sort((a,b)=>a[0].localeCompare(b[0])).map(([prefix,rows])=>[prefix,...rows.flatMap(row=>[row.start,row.end])]);return {byPrefix,ranges,fingerprint:planCore.fingerprint({schema:'gh-asset-purchase-id-guard-v1',ranges})};
  }
  function plannedIdRanges(plan,planCore){
    const {byPrefix}=plannedIdGuard(plan,planCore);
    return id=>{
      if(typeof id!=='string')return false;const split=id.lastIndexOf('-');if(split<1)return false;const prefix=id.slice(0,split),digits=id.slice(split+1),rows=byPrefix.get(prefix);if(!rows||!/^\d+$/.test(digits))return false;const value=Number(digits);if(!Number.isSafeInteger(value))return false;
      let lo=0,hi=rows.length-1;while(lo<=hi){const mid=(lo+hi)>>1,row=rows[mid];if(value<row.start)hi=mid-1;else if(value>row.end)lo=mid+1;else return `${prefix}-${String(value).padStart(8,'0')}`===id;}
      return false;
    };
  }
  // Serializable and worker-safe.  It deliberately follows synchronizeCrew's
  // integer-class fast path and its row-order fallback for non-integer counts.
  function computeBaseline(state,fleet=FLEET(),plan=null,planCore=PLAN(),options={}){
    if(!state||!fleet?.forEachFieldClasses||!fleet?.size)throw new TypeError('asset-purchase-baseline-input');
    let idsFree=null,planFingerprint=null,idGuardFingerprint=null,matchesPlannedId=null,idPasses=0;
    if(plan!==null){if(!planCore?.validate?.(plan)||typeof fleet.scan!=='function')throw new TypeError('asset-purchase-baseline-plan');idsFree=true;planFingerprint=plan.fingerprint;idGuardFingerprint=plannedIdGuard(plan,planCore).fingerprint;matchesPlannedId=plannedIdRanges(plan,planCore);}
    const occupancy=new Map(),crew=new Map(),ownerModeCounts=new Map(),classes=[],ownerMap=object(options.ownerForMode)?options.ownerForMode:null,ownerForMode=typeof options.ownerForMode==='function'?options.ownerForMode:(mode=>ownerMap?.[mode]||null);let integral=true,classPasses=2,rowPasses=0,rows=0;
    fleet.forEachFieldClasses(state,['baseFacility','staffing','assetMode','type','ownerCompanyId','companyId'],(row,count)=>{
      if(!count)return;rows+=count;occupancy.set(row.baseFacility,(occupancy.get(row.baseFacility)||0)+count);
      const mode=String(row.assetMode||row.type||''),owner=String(row.ownerCompanyId||row.companyId||ownerForMode(mode)||'');if(owner&&mode){const key=`${owner}\u0000${mode}`;ownerModeCounts.set(key,(ownerModeCounts.get(key)||0)+count);}
    });
    // Fleet Core groups staffing alone.  Reusing the wider occupancy classes
    // changes IEEE rounding when one staffing profile spans several bases, so
    // keep the exact reference grouping here as a second worker-side class pass.
    fleet.forEachFieldClasses(state,['staffing'],(row,count)=>{if(!count)return;classes.push([row.staffing,count]);if(!(row.staffing?.roles||[]).every(role=>Number.isSafeInteger(Number(role.count)||0)))integral=false;});
    if(integral)for(const [staffing,count] of classes)addCrew(crew,staffing,count);
    else{
      crew.clear();rowPasses++;fleet.forEachFields(state,['staffing'],row=>addCrew(crew,row.staffing,1),{raw:true});
    }
    if(matchesPlannedId){idPasses++;fleet.scan(state,['id'],row=>{if(matchesPlannedId(row.id))idsFree=false;});}
    return {schema:BASELINE_SCHEMA,version:VERSION,fleetSize:fleet.size(state),membershipRevision:typeof fleet.membershipRevision==='function'?fleet.membershipRevision(state):null,revision:typeof fleet.revision==='function'?fleet.revision(state):null,planFingerprint,idGuardFingerprint,idsFree,occupancy:[...occupancy],crew:[...crew],ownerModeCounts:[...ownerModeCounts].map(([key,count])=>{const [owner,mode]=key.split('\u0000');return [owner,mode,count];}),crewRowOrder:!integral,rows,classPasses,rowPasses,idPasses};
  }
  function normalizeBaseline(state,value,fleet=FLEET(),{plan=null,requireIds=false}={}){
    if(!object(value)||value.schema!==BASELINE_SCHEMA||value.version!==VERSION||!Number.isSafeInteger(value.fleetSize)||value.fleetSize!==fleet.size(state)||!Array.isArray(value.occupancy)||!Array.isArray(value.crew))throw new Error('asset-purchase-baseline-stale');
    if(!Number.isSafeInteger(value.rows)||value.rows!==value.fleetSize)throw new Error('asset-purchase-baseline-row-count');
    if(requireIds&&(value.membershipRevision==null||value.revision==null))throw new Error('asset-purchase-baseline-token-missing');
    if(value.membershipRevision!=null&&typeof fleet.membershipRevision==='function'&&value.membershipRevision!==fleet.membershipRevision(state))throw new Error('asset-purchase-baseline-membership-stale');
    if(value.revision!=null&&typeof fleet.revision==='function'&&value.revision!==fleet.revision(state))throw new Error('asset-purchase-baseline-revision-stale');
    if(requireIds&&(!plan||value.idGuardFingerprint!==plannedIdGuard(plan).fingerprint||value.idsFree!==true))throw new Error(value?.idsFree===false?'asset-purchase-id-collision':'asset-purchase-id-guard-stale');
    const occupancy=new Map(),crew=new Map(),ownerMode=new Set();let occupied=0,ownerModeTotal=0;
    for(const row of value.occupancy){if(!Array.isArray(row)||row.length!==2||!Number.isSafeInteger(row[1])||row[1]<0||occupancy.has(row[0]))throw new Error('asset-purchase-baseline-occupancy');occupancy.set(row[0],row[1]);occupied+=row[1];if(!Number.isSafeInteger(occupied))throw new Error('asset-purchase-baseline-occupancy');}
    if(occupied!==value.fleetSize)throw new Error('asset-purchase-baseline-occupancy-total');
    for(const row of value.crew){if(!Array.isArray(row)||row.length!==2||typeof row[0]!=='string'||!row[0]||!Number.isFinite(Number(row[1]))||crew.has(row[0]))throw new Error('asset-purchase-baseline-crew');crew.set(row[0],Number(row[1]));}
    if(!Array.isArray(value.ownerModeCounts))throw new Error('asset-purchase-baseline-owner-mode');for(const row of value.ownerModeCounts){if(!Array.isArray(row)||row.length!==3||typeof row[0]!=='string'||!row[0]||typeof row[1]!=='string'||!row[1]||!Number.isSafeInteger(row[2])||row[2]<0)throw new Error('asset-purchase-baseline-owner-mode');const key=`${row[0]}\u0000${row[1]}`;if(ownerMode.has(key))throw new Error('asset-purchase-baseline-owner-mode-duplicate');ownerMode.add(key);ownerModeTotal+=row[2];if(!Number.isSafeInteger(ownerModeTotal)||ownerModeTotal>value.fleetSize)throw new Error('asset-purchase-baseline-owner-mode-total');}
    if(value.crewRowOrder!==undefined&&typeof value.crewRowOrder!=='boolean')throw new Error('asset-purchase-baseline-crew-order');
    return {occupancy,crew,crewRowOrder:value.crewRowOrder===true,idsVerified:requireIds,fleetSize:value.fleetSize,membershipRevision:value.membershipRevision,revision:value.revision};
  }

  // Capacity is physical storage rather than logical state.  Reserve it in
  // bounded sections before opening the purchase adapter; the adapter still
  // checks the final capacity so a stale/aborted reservation cannot fall back
  // to Store.ensureCapacity and copy the old fleet in one frame.
  function* reserveCapacityStages(state,plan,options={}){
    const fleet=options.fleetData||FLEET(),planCore=options.planCore||PLAN();
    if(!state||typeof state!=='object'||!planCore?.validate?.(plan,options.contextToken===undefined?{}:{contextToken:options.contextToken}))throw new TypeError('asset-purchase-capacity-plan');
    if(typeof fleet?.reserveCapacityStages!=='function')throw new Error('asset-purchase-capacity-owner-missing');
    const current=typeof options.current==='function'?options.current:null;
    if(current&&current()!==true)throw new Error('asset-purchase-capacity-stale');
    const result=yield* fleet.reserveCapacityStages(state,plan.count,{rowSlice:Math.max(256,Math.floor(Number(options.rowSlice)||4096)),label:String(options.label||'asset-purchase.capacity')});
    if(!result||result.stale===true)throw new Error('asset-purchase-capacity-reservation-stale');
    if(current&&current()!==true)throw new Error('asset-purchase-capacity-stale');
    const store=fleet.storeOf?.(state);if(store&&store.capacity<store.length+plan.count)throw new Error(`asset-purchase-capacity-reservation-required:${store.length+plan.count}:${store.capacity}`);
    return result;
  }
  function roleSector(id){return ['pilots','cabin','aeng'].includes(id)?'air':['captains','sailors','seng'].includes(id)?'sea':'road';}
  function applyReceipt(target,source){for(const key of Object.keys(source))target[key]=clone(source[key]);delete target.assets;delete target.asset;return target;}

  function createAdapter(state,options={}){
    if(!state||typeof state!=='object')throw new TypeError('asset-purchase-apply-state');
    const fleet=options.fleetData||FLEET(),storeApi=options.storeApi||STORE(),tx=options.transactionCore||TX(),planCore=options.planCore||PLAN();if(!fleet||!storeApi||!planCore)throw new Error('asset-purchase-apply-owner-missing');
    const telemetry={baselinePasses:0,baselineRowPasses:0,providedBaseline:false,workerIdGuard:false,capacityChecks:0,storeCapacityRequired:0,duplicateChecks:0,assetsApplied:0,groupsApplied:0,rollbacks:0,commits:0,prepareYields:0,finishYields:0};let active=null,prepared=null;
    const facilityOf=typeof options.facilityOf==='function'?options.facilityOf:(id=>[...(state.globalBases||[]),...(state.customHubs||[])].find(row=>row?.id===id)||null),capacityOf=typeof options.capacityOf==='function'?options.capacityOf:(facility=>Number(facility?.deliveryCapacity??facility?.assetCapacity));
    const manageReceipts=options.manageReceipts===true,manageLabor=options.manageLabor!==false,manageGroupValue=options.manageGroupValue===true;
    function baseline(plan){
      if(options.baseline){if(typeof options.current!=='function'||options.current()!==true)throw new Error('asset-purchase-baseline-stale');telemetry.providedBaseline=true;telemetry.workerIdGuard=true;return normalizeBaseline(state,options.baseline,fleet,{plan,requireIds:true});}
      const limit=Math.max(0,Number(options.maxSynchronousBaselineRows??MAX_SYNC_BASELINE_ROWS)||0);if(fleet.size(state)>limit)throw new Error('asset-purchase-worker-baseline-required');
      const value=computeBaseline(state,fleet,plan,planCore);telemetry.baselinePasses+=value.classPasses;telemetry.baselineRowPasses+=value.rowPasses;telemetry.workerIdGuard=true;return normalizeBaseline(state,value,fleet,{plan,requireIds:true});
    }
    function* validateGroupsStages(plan,base,{budgetMs=4,clock=()=>globalThis.performance?.now?.()??Date.now()}={}){
      const occupancy=new Map(base.occupancy),seenOrders=new Set(),seenContracts=new Set(),seenHiring=new Set(),rangesByPrefix=new Map(),budget=Math.min(16,Math.max(.25,Number(budgetMs)||4));let started=clock();
      for(let groupIndex=0;groupIndex<plan.groups.length;groupIndex++){
        const group=plan.groups[groupIndex];
        if(seenOrders.has(group.orderId))throw new Error('asset-purchase-plan-order-duplicate');seenOrders.add(group.orderId);
        if(seenContracts.has(group.contractId))throw new Error('asset-purchase-plan-contract-duplicate');seenContracts.add(group.contractId);
        if(seenHiring.has(group.hiringId))throw new Error('asset-purchase-plan-hiring-duplicate');seenHiring.add(group.hiringId);
        const start=group.assetSequenceStart,end=start+group.qty-1,ranges=rangesByPrefix.get(group.assetIdPrefix)||[];let lo=0,hi=ranges.length;while(lo<hi){const mid=(lo+hi)>>1;if(ranges[mid].start<start)lo=mid+1;else hi=mid;}if(lo>0&&ranges[lo-1].end>=start||lo<ranges.length&&ranges[lo].start<=end)throw new Error('asset-purchase-plan-asset-id-duplicate');ranges.splice(lo,0,{start,end});if(!rangesByPrefix.has(group.assetIdPrefix))rangesByPrefix.set(group.assetIdPrefix,ranges);
        const facility=facilityOf(group.baseId);if(!facility)throw new Error(`asset-purchase-facility-missing:${group.baseId}`);
        if(typeof options.validateGroup==='function'&&options.validateGroup(group,facility,plan)!==true)throw new Error(`asset-purchase-group-invalid:${group.orderId}`);
        const capacity=Math.floor(Number(capacityOf(facility,group,plan)));if(!Number.isFinite(capacity)||capacity<1)throw new Error(`asset-purchase-capacity-invalid:${group.baseId}`);
        const current=occupancy.get(group.baseId)||0;telemetry.capacityChecks++;if(current+group.qty>capacity)throw new Error(`delivery-base-full:${group.baseId}:${Math.max(0,capacity-current)}/${capacity}`);occupancy.set(group.baseId,current+group.qty);
        if(clock()-started>=budget&&groupIndex+1<plan.groups.length){telemetry.prepareYields++;yield {phase:'validate-groups',groupIndex:groupIndex+1,total:plan.groups.length};started=clock();}
      }
      return occupancy;
    }
    function drain(iterator){let step;while(!(step=iterator.next()).done){}return step.value;}
    function baselineStillCurrent(base){return fleet.size(state)===base.fleetSize&&(base.revision==null||fleet.revision?.(state)===base.revision)&&(base.membershipRevision==null||fleet.membershipRevision?.(state)===base.membershipRevision)&&(typeof options.contextCurrent!=='function'||options.contextCurrent()===true);}
    function receiptSource(){const procurement=state.realism?.procurement,deliveries=procurement?.deliveries;if(!object(procurement)||!Array.isArray(deliveries))throw new Error('asset-purchase-receipt-store-missing');return {procurement,deliveries};}
    function* deliveryMapStages(source,{budgetMs=4,clock=()=>globalThis.performance?.now?.()??Date.now()}={}){
      const map=new Map(),budget=Math.min(16,Math.max(.25,Number(budgetMs)||4));let started=clock();
      for(let index=0;index<source.deliveries.length;index++){
        const row=source.deliveries[index],id=String(row?.id||'');if(!id||map.has(id))throw new Error('asset-purchase-receipt-id-duplicate');map.set(id,{row,index});
        if(clock()-started>=budget&&index+1<source.deliveries.length){telemetry.prepareYields++;yield {phase:'delivery-index',done:index+1,total:source.deliveries.length};if(state.realism?.procurement!==source.procurement||source.procurement.deliveries!==source.deliveries)throw new Error('asset-purchase-receipt-baseline-stale');started=clock();}
      }
      return map;
    }
    function* prepareStages(plan,prepareOptions={}){
      if(active)throw new Error('asset-purchase-apply-already-active');if(!planCore.validate(plan,options.contextToken===undefined?{}:{contextToken:options.contextToken}))throw new Error('asset-purchase-plan-invalid');const base=baseline(plan);if(!baselineStillCurrent(base))throw new Error('asset-purchase-baseline-stale');
      const stages=validateGroupsStages(plan,base,prepareOptions);let step;while(!(step=stages.next()).done){if(!baselineStillCurrent(base))throw new Error('asset-purchase-baseline-stale');yield step.value;}if(!baselineStillCurrent(base))throw new Error('asset-purchase-baseline-stale');let receipt=null;if(manageReceipts){const source=receiptSource(),index=deliveryMapStages(source,prepareOptions);let indexed;while(!(indexed=index.next()).done){if(!baselineStillCurrent(base))throw new Error('asset-purchase-baseline-stale');yield indexed.value;}receipt={...source,map:indexed.value};}if(!baselineStillCurrent(base))throw new Error('asset-purchase-baseline-stale');prepared={fingerprint:plan.fingerprint,base,occupancy:step.value,receipt};return prepared;
    }
    function begin(plan){
      if(active)throw new Error('asset-purchase-apply-already-active');if(!planCore.validate(plan,options.contextToken===undefined?{}:{contextToken:options.contextToken}))throw new Error('asset-purchase-plan-invalid');
      const transactionActive=tx?.isActive?.()===true,joinedTransaction=tx?.isActiveFor?.(state)===true,durable=globalThis.__GH_DURABLE_COMMAND_CONTEXT__,durableDraft=!!durable&&durable.draft===state,durableLive=!!durable&&durable.liveState===state;
      // A process-wide active transaction says nothing about which state it
      // owns.  Mutating another state here would leave Fleet Store and the
      // business roots outside that transaction's rollback boundary.
      if(transactionActive&&!joinedTransaction)throw new Error('asset-purchase-transaction-owner-mismatch');
      // Durable commands may write only their discardable draft.  The live
      // state can share journaled Fleet storage with that draft, so accepting
      // it as an owner leaks labor/procurement changes on a late failure.
      if(durableLive&&!durableDraft)throw new Error('asset-purchase-durable-live-state-blocked');
      if(manageReceipts&&(!joinedTransaction&&!durableDraft||typeof options.transitionReceipt!=='function'))throw new Error('asset-purchase-receipt-transaction-required');
      let base,preparedReceipt=null;if(prepared?.fingerprint===plan.fingerprint){base=prepared.base;preparedReceipt=prepared.receipt;prepared=null;if(!baselineStillCurrent(base))throw new Error('asset-purchase-baseline-stale');}else{if(plan.groups.length>Math.max(1,Math.floor(Number(options.maxSynchronousGroups)||64))||manageReceipts)throw new Error('asset-purchase-apply-preparation-required');base=baseline(plan);drain(validateGroupsStages(plan,base,{budgetMs:16,clock:()=>0}));}
      const hadAdvanced=manageLabor&&own(state,'advanced'),hadLabor=manageLabor&&object(state.advanced)&&own(state.advanced,'labor'),originalLabor=hadLabor?state.advanced.labor:undefined;
      const hadRealism=manageReceipts&&own(state,'realism'),hadProcurement=manageReceipts&&object(state.realism)&&own(state.realism,'procurement'),originalProcurement=hadProcurement?state.realism.procurement:undefined;
      const hadCrew=own(state,'crew'),hadGroupValue=own(state,'groupValue'),store=fleet.storeOf?.(state)||null,existingJournal=store?storeApi.journalStats(store):null;
      if(store){const required=store.length+plan.count;telemetry.storeCapacityRequired=required;if(store.capacity<required)throw new Error(`asset-purchase-capacity-reservation-required:${required}:${store.capacity}`);}
      const labor=manageLabor&&object(originalLabor)?originalLabor:null,procurement=manageReceipts&&object(originalProcurement)?originalProcurement:null,deliveries=Array.isArray(procurement?.deliveries)?procurement.deliveries:null;
      if(manageReceipts&&!deliveries)throw new Error('asset-purchase-receipt-store-missing');
      if(manageReceipts&&(preparedReceipt?.procurement!==procurement||preparedReceipt?.deliveries!==deliveries))throw new Error('asset-purchase-receipt-baseline-stale');
      const deliveryMap=manageReceipts?preparedReceipt.map:null;
      const snapshot={hadAdvanced,hadLabor,originalLabor,originalContracts:Array.isArray(labor?.employmentContracts)?labor.employmentContracts:[],originalHiring:Array.isArray(labor?.hiringLog)?labor.hiringLog:[],pendingContracts:[],pendingHiring:[],hadRealism,hadProcurement,originalProcurement,originalDeliveries:deliveries,deliveryMap,receiptPatches:new Map(),hadCrew,crew:clone(state.crew),hadGroupValue,groupValue:state.groupValue,arrayLength:Array.isArray(state.assets)?state.assets.length:null,baseCrew:base.crew,crewRowOrder:base.crewRowOrder===true,crewRunning:new Map(base.crew),planStaffing:plan.baseStaffing,idsVerified:base.idsVerified===true,baseFleetSize:base.fleetSize,baseRevision:base.revision,baseMembershipRevision:base.membershipRevision,assetsApplied:0,store,journal:null,ownJournal:false,outerGuard:null};
      if(store){
        if(existingJournal&&!joinedTransaction&&!durableDraft)throw new Error('asset-purchase-borrowed-journal-owner-missing');
        // A caught adapter failure must not allow the surrounding transaction
        // to commit the rows already appended to its journal.  This closure is
        // read-only, so registering it does not promote a journal transaction
        // to a full state snapshot.
        if(joinedTransaction){
          const guard=snapshot.outerGuard={completed:false,failed:false,reason:null};
          tx.afterCommit(()=>{if(guard.failed||!guard.completed){const error=new Error(`asset-purchase-apply-session-failed:${guard.reason||'incomplete'}`);error.code='ASSET_PURCHASE_APPLY_SESSION_FAILED';throw error;}return true;},{critical:true,owner:'asset-purchase-apply',writeContract:{proven:true,readOnly:true}});
        }
        snapshot.journal=joinedTransaction||existingJournal?storeApi.journalFor(store):storeApi.beginJournal(store);snapshot.ownJournal=!joinedTransaction&&!existingJournal;
      }
      active=snapshot;
      return snapshot;
    }
    function beginGroup(group){
      if(!active)throw new Error('asset-purchase-apply-not-active');
      if(manageReceipts){const delivery=active.deliveryMap.get(group.orderId)?.row;if(!delivery||delivery.id!==group.orderId||delivery.status!=='pending'||delivery.baseId!==group.baseId||Number(delivery.count)!==group.qty||delivery.payment?.ref!==group.payment.ref)throw new Error(`asset-purchase-receipt-mismatch:${group.orderId}`);}
    }
    function expectedMembership(session,added){
      const token=session.baseMembershipRevision;if(typeof token!=='string')return null;if(token.startsWith('array:'))return `array:${session.baseFleetSize+added}`;const split=token.indexOf(':');if(split<1)return null;const structure=Number(token.slice(0,split));return Number.isSafeInteger(structure)?`${structure+added}${token.slice(split)}`:null;
    }
    function assertFleetLease(session=active){
      if(!session)throw new Error('asset-purchase-apply-not-active');const added=session.assetsApplied,expectedSize=session.baseFleetSize+added,actualSize=fleet.size(state),expectedRevision=Number.isSafeInteger(session.baseRevision)?session.baseRevision+added:null,actualRevision=typeof fleet.revision==='function'?fleet.revision(state):null,expectedMember=expectedMembership(session,added),actualMember=typeof fleet.membershipRevision==='function'?fleet.membershipRevision(state):null;
      if(actualSize!==expectedSize||expectedRevision!==null&&actualRevision!==expectedRevision||expectedMember!==null&&actualMember!==expectedMember)throw new Error(`asset-purchase-baseline-mutated:${expectedSize}:${actualSize}:${expectedRevision}:${actualRevision}:${expectedMember}:${actualMember}`);
      return true;
    }
    function addAsset(asset){
      if(!active)throw new Error('asset-purchase-apply-not-active');if((active.assetsApplied&511)===0)assertFleetLease();if(!active.idsVerified){telemetry.duplicateChecks++;if(fleet.has(state,asset.id))throw new Error(`duplicate-asset-id:${asset.id}`);}const added=fleet.add(state,asset,APPEND_ONLY);if(!added)throw new Error(`asset-purchase-add-failed:${asset.id}`);active.assetsApplied++;telemetry.assetsApplied++;
      // synchronizeCrew deliberately preserves row-order IEEE additions when a
      // legacy fractional staffing count exists.  Fold each newly appended row
      // into that same running total while row materialization is already
      // sliced, instead of one aggregate multiply at the end.
      if(active.crewRowOrder&&asset.staffing?.mode==='automatic-fixed'&&asset.staffing.ready===true)for(const role of asset.staffing.roles||[])active.crewRunning.set(role.id,(active.crewRunning.get(role.id)||0)+(Number(role.count)||0));
    }
    function finishGroup(group,_groupIndex,out){
      if(!active)throw new Error('asset-purchase-apply-not-active');
      if(!active.crewRowOrder)addCrew(active.crewRunning,active.planStaffing,group.qty);
      if(manageLabor){active.pendingContracts.push(clone(out.contract));active.pendingHiring.push(clone(out.hiring));}
      if(manageReceipts){const entry=active.deliveryMap.get(group.orderId),delivery={...entry.row};delete delivery.assets;delete delivery.asset;if(options.transitionReceipt(delivery,group,out)!==true)throw new Error(`asset-purchase-receipt-transition-rejected:${group.orderId}`);applyReceipt(delivery,out.receipt);active.receiptPatches.set(entry.index,delivery);}
      if(manageGroupValue){if(typeof options.applyGroupValue==='function')options.applyGroupValue(out.groupValueDelta,group);else state.groupValue=Math.max(0,(Number(state.groupValue)||0)+out.groupValueDelta);}
      if(typeof options.onGroupFinished==='function')options.onGroupFinished(group,out);telemetry.groupsApplied++;
    }
    function applyCrewDelta(delta){
      if(!active)throw new Error('asset-purchase-apply-not-active');assertFleetLease();state.crew=Array.isArray(state.crew)?state.crew:[];const roles=planCore.ROLE_DEFAULTS;
      for(const id of Object.keys(roles)){
        let saved=state.crew.find(row=>row?.id===id);if(!saved){const role=roles[id];saved={id,sector:roleSector(id),name:role.name,count:0,salaryMin:role.dailyRate,salaryMax:role.dailyRate,morale:90};state.crew.push(saved);}
        saved.count=active.crewRunning.get(id)||0;
      }
    }
    function businessRootsCurrent(session=active){
      if(manageLabor){if(session.hadLabor){if(state.advanced?.labor!==session.originalLabor||(Array.isArray(session.originalLabor.employmentContracts)&&session.originalLabor.employmentContracts!==session.originalContracts)||(Array.isArray(session.originalLabor.hiringLog)&&session.originalLabor.hiringLog!==session.originalHiring))return false;}else if(object(state.advanced)&&own(state.advanced,'labor'))return false;}
      if(manageReceipts){if(session.hadProcurement){if(state.realism?.procurement!==session.originalProcurement||session.originalProcurement.deliveries!==session.originalDeliveries)return false;}else if(object(state.realism)&&own(state.realism,'procurement'))return false;}return true;
    }
    function* finishStages(_result,_plan,stageOptions={}){
      if(!active)throw new Error('asset-purchase-apply-not-active');const clock=typeof stageOptions.clock==='function'?stageOptions.clock:(()=>globalThis.performance?.now?.()??Date.now()),budget=Math.min(16,Math.max(.25,Number(stageOptions.budgetMs)||4));let started=clock();
      const boundary=function* (phase,done,total){if(clock()-started>=budget&&done<total){if(!businessRootsCurrent()||!assertFleetLease())throw new Error('asset-purchase-business-root-mutated');telemetry.finishYields++;yield {phase,done,total};started=clock();}};
      let contracts=null,hiring=null,pending=null,history=null,orderedDeliveries=null;
      if(manageLabor){const total=active.pendingContracts.length+active.originalContracts.length;contracts=new Array(total);let at=0;for(let index=active.pendingContracts.length-1;index>=0;index--){contracts[at++]=active.pendingContracts[index];yield* boundary('labor-contracts',at,total);}for(const row of active.originalContracts){contracts[at++]=row;yield* boundary('labor-contracts',at,total);}const hiringTotal=Math.min(200,active.pendingHiring.length+active.originalHiring.length);hiring=new Array(hiringTotal);at=0;for(let index=active.pendingHiring.length-1;index>=0&&at<hiringTotal;index--){hiring[at++]=active.pendingHiring[index];yield* boundary('labor-hiring',at,hiringTotal);}for(const row of active.originalHiring){if(at>=hiringTotal)break;hiring[at++]=row;yield* boundary('labor-hiring',at,hiringTotal);}}
      if(manageReceipts){pending=[];history=[];const total=active.originalDeliveries.length;for(let index=0;index<total;index++){const row=active.receiptPatches.get(index)||active.originalDeliveries[index];(row?.status==='pending'?pending:history).push(row);yield* boundary('delivery-ledger',index+1,total);}orderedDeliveries=new Array(total);let at=0;for(const row of pending){orderedDeliveries[at++]=row;yield* boundary('delivery-order',at,total);}for(const row of history){orderedDeliveries[at++]=row;yield* boundary('delivery-order',at,total);}}
      if(!businessRootsCurrent())throw new Error('asset-purchase-business-root-mutated');assertFleetLease();
      if(manageLabor){state.advanced=object(state.advanced)?state.advanced:{};const original=object(active.originalLabor)?active.originalLabor:{};state.advanced.labor={...original,employmentContracts:contracts,hiringLog:hiring};}
      if(manageReceipts){state.realism=object(state.realism)?state.realism:{};const original=object(active.originalProcurement)?active.originalProcurement:{};state.realism.procurement={...original,pendingDeliveryCount:pending.length,deliveries:orderedDeliveries};}
      if(typeof options.finalize==='function')options.finalize(state);
    }
    function finish(result,plan){
      const stages=finishStages(result,plan,{budgetMs:16,clock:()=>0});while(!stages.next().done){}
    }
    function rollback(token,error){
      const session=active||token;if(!session)return;try{
        // A journal obtained from the surrounding transaction contains writes
        // made before this adapter.  Rolling it back here would erase those
        // writes and close the owner's journal.  The rethrown apply failure is
        // the outer transaction's rollback boundary.
        if(session.outerGuard){session.outerGuard.failed=true;session.outerGuard.reason=String(error?.message||error||'rollback').slice(0,240);}
        else if(session.store&&!session.ownJournal){const durable=globalThis.__GH_DURABLE_COMMAND_CONTEXT__;if(durable?.draft===state){durable.poisoned=true;durable.poisonReason=`asset-purchase-apply-failed:${String(error?.message||error||'rollback').slice(0,160)}`;}}
        if(session.store&&session.ownJournal&&session.journal?.active)storeApi.rollbackJournal(session.journal);else if(!session.store&&session.arrayLength!=null&&Array.isArray(state.assets))state.assets.length=session.arrayLength;
        if(manageLabor){
          if(!session.hadAdvanced)delete state.advanced;
          else if(!session.hadLabor)delete state.advanced.labor;
          else state.advanced.labor=session.originalLabor;
        }
        if(manageReceipts){
          if(!session.hadRealism)delete state.realism;
          else if(!session.hadProcurement)delete state.realism.procurement;
          else state.realism.procurement=session.originalProcurement;
        }
        if(session.hadCrew)state.crew=clone(session.crew);else delete state.crew;
        if(manageGroupValue){if(session.hadGroupValue)state.groupValue=session.groupValue;else delete state.groupValue;}
        telemetry.rollbacks++;
      }finally{active=null;}
    }
    function commit(token){const session=active||token;if(!session)return;assertFleetLease(session);if(session.ownJournal&&session.journal?.active)storeApi.endJournal(session.journal);if(session.outerGuard)session.outerGuard.completed=true;active=null;telemetry.commits++;}
    return {prepareStages,begin,beginGroup,addAsset,finishGroup,applyCrewDelta,finishStages,finish,rollback,commit,telemetry:()=>({...telemetry}),active:()=>!!active};
  }

  return Object.freeze({VERSION,BASELINE_SCHEMA,MAX_SYNC_BASELINE_ROWS,plannedIdGuard,computeBaseline,normalizeBaseline,reserveCapacityStages,createAdapter});
});
