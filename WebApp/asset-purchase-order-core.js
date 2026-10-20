'use strict';

// Commercial owner for a bulk fleet purchase.  A row slice is only a paint
// boundary: it never creates a cheque, invoice, supplier transaction, debt or
// employment contract.  One purchase has one payment; each destination has
// one compact delivery/staffing allocation linked to that payment.
((root,factory)=>{
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.GH_ASSET_PURCHASE_ORDER_CORE=api;
})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  const VERSION='1.0.0',AVAILABILITY_SCHEMA='gh-asset-purchase-availability-v1',ORDER_SCHEMA='gh-asset-purchase-order-v1',RESERVATION_SCHEMA='gh-asset-purchase-reservation-v1',AUDIT_SCHEMA='gh-asset-purchase-allocation-v1',COMMAND_SCHEMA='gh-asset-purchase-command-v1';
  const MAX_ASSETS=1000000,MAX_ALLOCATIONS=4096,ROW_STAGE_HINT=512;
  const PLAN=()=>globalThis.GH_ASSET_PURCHASE_PLAN_CORE||(typeof require==='function'?require('./asset-purchase-plan-core.js'):null);
  const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value),own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
  const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
  const finite=(value,name,{min=-Infinity,max=Infinity}={})=>{value=Number(value);if(!Number.isFinite(value)||value<min||value>max)throw new TypeError(`asset-purchase-order-${name}`);return value;};
  const integer=(value,name,{min=0,max=Number.MAX_SAFE_INTEGER}={})=>{value=Number(value);if(!Number.isSafeInteger(value)||value<min||value>max)throw new TypeError(`asset-purchase-order-${name}`);return value;};
  const text=(value,name,{empty=false,max=1024}={})=>{value=String(value??'');if((!empty&&!value)||value.length>max)throw new TypeError(`asset-purchase-order-${name}`);return value;};
  const deepFreeze=value=>{if(!value||typeof value!=='object'||Object.isFrozen(value))return value;for(const child of Object.values(value))deepFreeze(child);return Object.freeze(value);};
  const fingerprint=value=>{const plan=PLAN();if(!plan?.fingerprint)throw new Error('asset-purchase-plan-core-missing');return plan.fingerprint(value);};
  const normalizedPrefix=value=>String(value||'ID').replace(/[^A-Z0-9_-]/gi,'').toUpperCase()||'ID';
  const formatted=(prefix,number,width=8)=>`${prefix}-${String(number).padStart(width,'0')}`;
  const countOf=delivery=>{if(delivery?.assetReceipt?.schema==='gh-asset-receipt-v1')return Math.max(0,Math.floor(Number(delivery.assetReceipt.count)||0));if(Array.isArray(delivery?.assets))return delivery.assets.length;if(delivery?.asset)return 1;return Math.max(0,Math.floor(Number(delivery?.count)||0));};

  function contextRows(deliveries,facilities){
    const pending=(Array.isArray(deliveries)?deliveries:[]).filter(row=>row?.status==='pending').map(row=>({id:String(row.id||''),status:'pending',baseId:String(row.baseId||''),count:countOf(row),ownerCompanyId:String(row.ownerCompanyId||row.companyId||''),assetMode:String(row.assetMode||row.type||'')}));
    const bases=(Array.isArray(facilities)?facilities:[]).map(row=>({id:String(row.id||''),name:String(row.name||''),ownerCompanyId:String(row.ownerCompanyId||row.companyId||row.company||''),capacity:Math.floor(Number(row.capacity)),owned:row.owned!==false,compatible:row.compatible===true}));
    return {pending,bases};
  }
  function contextDigest(deliveries,facilities){return fingerprint(contextRows(deliveries,facilities));}

  // `fleetBaseline` is computed on the fleet worker in one class pass.  The
  // remaining inputs are small business roots and are folded on the main
  // thread without another fleet scan.
  function buildAvailability({fleetBaseline,deliveries=[],facilities=[],ownerCompanyId,assetMode,contextToken=''}){
    if(!object(fleetBaseline)||fleetBaseline.membershipRevision==null||fleetBaseline.revision==null||!Number.isSafeInteger(fleetBaseline.fleetSize)||!Array.isArray(fleetBaseline.occupancy)||!Array.isArray(fleetBaseline.ownerModeCounts))throw new TypeError('asset-purchase-order-fleet-baseline');
    ownerCompanyId=text(ownerCompanyId,'owner');assetMode=text(assetMode,'mode');
    const live=new Map();for(const row of fleetBaseline.occupancy){if(!Array.isArray(row)||row.length!==2||!Number.isSafeInteger(row[1])||row[1]<0)throw new TypeError('asset-purchase-order-occupancy');live.set(String(row[0]??''),(live.get(String(row[0]??''))||0)+row[1]);}
    const pending=new Map();let serialCount=0;
    for(const row of fleetBaseline.ownerModeCounts){if(!Array.isArray(row)||row.length!==3||!String(row[0]||'')||!String(row[1]||''))throw new TypeError('asset-purchase-order-owner-mode-count');const count=integer(row[2],'serial-count');if(String(row[0])===ownerCompanyId&&String(row[1])===assetMode){serialCount+=count;if(!Number.isSafeInteger(serialCount))throw new TypeError('asset-purchase-order-serial-count');}}
    for(const delivery of Array.isArray(deliveries)?deliveries:[]){if(delivery?.status!=='pending')continue;const count=integer(countOf(delivery),'pending-count'),baseId=String(delivery.baseId||'');if(count&&baseId){const next=(pending.get(baseId)||0)+count;if(!Number.isSafeInteger(next))throw new TypeError('asset-purchase-order-pending-count');pending.set(baseId,next);}if(String(delivery.ownerCompanyId||delivery.companyId||'')===ownerCompanyId&&String(delivery.assetMode||delivery.type||'')===assetMode){serialCount+=count;if(!Number.isSafeInteger(serialCount))throw new TypeError('asset-purchase-order-serial-count');}}
    const rows=[],seenFacilities=new Set();for(const facility of Array.isArray(facilities)?facilities:[]){const id=text(facility?.id,'facility-id');if(seenFacilities.has(id))throw new Error(`asset-purchase-order-facility-duplicate:${id}`);seenFacilities.add(id);const capacity=integer(Math.floor(Number(facility.capacity)),'facility-capacity',{min:1}),occupied=(live.get(id)||0)+(pending.get(id)||0);rows.push({id,name:text(facility.name||id,'facility-name'),ownerCompanyId:String(facility.ownerCompanyId||facility.companyId||facility.company||''),capacity,occupied,free:Math.max(0,capacity-occupied),owned:facility.owned!==false,compatible:facility.compatible===true});}
    const body={schema:AVAILABILITY_SCHEMA,version:VERSION,contextToken:String(contextToken||''),ownerCompanyId,assetMode,fleetSize:fleetBaseline.fleetSize,membershipRevision:fleetBaseline.membershipRevision,revision:fleetBaseline.revision,contextDigest:contextDigest(deliveries,facilities),serialCount,facilities:rows};return deepFreeze({...body,fingerprint:fingerprint(body)});
  }
  function availabilityCurrent(value,{fleetSize,membershipRevision,revision,deliveries=[],facilities=[]}={}){
    return !!value&&value.schema===AVAILABILITY_SCHEMA&&Number(fleetSize)===value.fleetSize&&membershipRevision===value.membershipRevision&&revision===value.revision&&contextDigest(deliveries,facilities)===value.contextDigest;
  }
  function requireAvailability(value){if(!object(value)||value.schema!==AVAILABILITY_SCHEMA||value.version!==VERSION){throw new TypeError('asset-purchase-order-availability');}const {fingerprint:found,...body}=value;if(found!==fingerprint(body))throw new TypeError('asset-purchase-order-availability-fingerprint');const ids=new Set();for(const row of value.facilities||[]){if(ids.has(row?.id))throw new Error(`asset-purchase-order-facility-duplicate:${row?.id}`);ids.add(row?.id);}return value;}
  function allocate(availability,{quantity,distribution='total',preferredBaseId=''}={}){
    requireAvailability(availability);quantity=integer(quantity,'quantity',{min:1,max:MAX_ASSETS});distribution=String(distribution||'total');
    const eligible=availability.facilities.filter(row=>row.owned&&row.compatible&&row.ownerCompanyId===availability.ownerCompanyId).sort((a,b)=>Number(b.id===preferredBaseId)-Number(a.id===preferredBaseId)||b.free-a.free||String(a.id).localeCompare(String(b.id)));
    if(!eligible.length)throw new Error('asset-purchase-order-no-compatible-facility');const out=[];
    if(distribution==='per-facility'){for(const row of eligible){if(row.free<quantity)throw new Error(`asset-purchase-order-facility-short:${row.id}:${row.free}/${quantity}`);out.push({baseId:row.id,baseName:row.name,qty:quantity});}}
    else if(distribution==='total'){let remaining=quantity;for(const row of eligible){const qty=Math.min(remaining,row.free);if(qty>0)out.push({baseId:row.id,baseName:row.name,qty});remaining-=qty;if(!remaining)break;}if(remaining)throw new Error(`asset-purchase-order-capacity-short:${quantity-remaining}/${quantity}`);}
    else throw new TypeError('asset-purchase-order-distribution');
    const total=out.reduce((sum,row)=>sum+row.qty,0);if(total<1||total>MAX_ASSETS||out.length>MAX_ALLOCATIONS)throw new Error('asset-purchase-order-allocation-limit');return out;
  }
  function sequenceSnapshot(state,ownerCompanyId){
    if(!state||typeof state!=='object')throw new TypeError('asset-purchase-order-state');const sequences=object(state.sequences)?state.sequences:{},owner=text(ownerCompanyId,'owner'),asset=normalizedPrefix(`N-${owner}`),delivery=normalizedPrefix(`DEL-${owner}`),master='MANUAL-ASSET';
    const current=key=>{const value=Number(sequences[key])||0;if(!Number.isSafeInteger(value)||value<0)throw new Error(`asset-purchase-order-sequence:${key}`);return value;};
    return deepFreeze({ownerCompanyId:owner,master:{key:master,prefix:master,current:current(master),width:8},asset:{key:asset,prefix:asset,current:current(asset),width:8},delivery:{key:delivery,prefix:delivery,current:current(delivery),width:8},contract:{key:'EMP-AUTO',prefix:'EMP-AUTO',current:current('EMP-AUTO'),width:8},hiring:{key:'HR-AUTO',prefix:'HR-AUTO',current:current('HR-AUTO'),width:8}});
  }
  function requireSequences(value,ownerCompanyId){
    if(!object(value)||value.ownerCompanyId!==ownerCompanyId)throw new TypeError('asset-purchase-order-sequences');
    for(const key of ['master','asset','delivery','contract','hiring']){const row=value[key];if(!object(row)||!String(row.key||'')||!String(row.prefix||'')||!Number.isSafeInteger(row.current)||row.current<0||!Number.isSafeInteger(row.width)||row.width<0)throw new TypeError(`asset-purchase-order-sequence:${key}`);}
    return value;
  }
  // The final allocation is the exact residual of the aggregate commercial
  // total.  Row slicing never recalculates money, so allocations reduce back to
  // the single cheque/invoice amount in their recorded order.
  function allocateMoney(total,allocations,totalQty){let allocated=0;return allocations.map((row,index)=>{const value=index===allocations.length-1?total-allocated:total*row.qty/totalQty;allocated+=value;return value;});}
  function quote(input){
    if(!object(input))throw new TypeError('asset-purchase-order-input');const availability=requireAvailability(input.availability),ownerCompanyId=text(input.ownerCompanyId,'owner'),assetMode=text(input.assetMode,'mode');if(ownerCompanyId!==availability.ownerCompanyId||assetMode!==availability.assetMode)throw new Error('asset-purchase-order-availability-owner');
    if(!object(input.freshness)||!availabilityCurrent(availability,input.freshness))throw new Error('asset-purchase-order-availability-stale');
    const contextToken=text(input.contextToken??'','context-token',{empty:true,max:4096});if(contextToken!==availability.contextToken)throw new Error('asset-purchase-order-context-stale');
    const allocations=allocate(availability,{quantity:input.quantity,distribution:input.distribution,preferredBaseId:input.preferredBaseId}),count=allocations.reduce((sum,row)=>sum+row.qty,0),serialStart=availability.serialCount+1,serialEnd=availability.serialCount+count,ownership=text(input.ownership||'cash','ownership');if(!Number.isSafeInteger(serialStart)||!Number.isSafeInteger(serialEnd))throw new TypeError('asset-purchase-order-serial-range');if(!['cash','finance','lease'].includes(ownership))throw new TypeError('asset-purchase-order-ownership');
    const item=clone(input.item);if(!object(item)||!object(item.specs))throw new TypeError('asset-purchase-order-item');item.id=text(item.id,'item-id');item.name=text(item.name,'item-name');item.price=finite(item.price,'price',{min:Number.MIN_VALUE});item.leaseMonthly=finite(item.leaseMonthly||0,'lease',{min:0});item.downPayment=finite(item.downPayment||.2,'down-payment',{min:0,max:1});PLAN().staffingPlan(assetMode,item.specs);
    const totalPrice=item.price*count,totalUpfront=ownership==='cash'?totalPrice:ownership==='finance'?totalPrice*item.downPayment:item.leaseMonthly*3*count,totalResidual=ownership==='finance'?Math.max(0,totalPrice-totalUpfront):0;if(!Number.isFinite(totalPrice)||!Number.isFinite(totalUpfront)||!Number.isFinite(totalResidual))throw new TypeError('asset-purchase-order-total');
    const gross=allocateMoney(totalPrice,allocations,count),upfront=allocateMoney(totalUpfront,allocations,count),residual=allocateMoney(totalResidual,allocations,count),sequences=requireSequences(input.sequences,ownerCompanyId),supplierSource=input.supplier,supplier={id:String(supplierSource?.id||''),name:text(supplierSource?.legalName||supplierSource?.name||supplierSource,'supplier')};
    const requestRef=formatted(sequences.master.prefix,sequences.master.current+1,sequences.master.width),availabilityGuard={fleetSize:availability.fleetSize,membershipRevision:availability.membershipRevision,revision:availability.revision,contextDigest:availability.contextDigest},body={schema:ORDER_SCHEMA,version:VERSION,contextToken,availabilityFingerprint:availability.fingerprint,availabilityGuard,ownerCompanyId,assetMode,assetClass:text(input.assetClass,'asset-class'),operationProfileId:text(input.operationProfileId,'operation-profile'),companyShortName:text(input.companyShortName,'company-short-name'),companyName:text(input.companyName||input.companyShortName,'company-name'),tab:text(input.tab||'new','tab'),ownership,simSeconds:finite(input.simSeconds||0,'sim-seconds',{min:0}),item,supplier,requestRef,documentLeadDays:integer(Math.max(1,Math.floor(Number(input.documentLeadDays)||1)),'lead-days',{min:1}),leadSeconds:Math.max(60,finite(Number(input.leadSeconds)||60,'lead-seconds',{min:0})),immediateDelivery:input.immediateDelivery!==false,serialStart,count,totalPrice,totalUpfront,totalResidual,rowStageHint:ROW_STAGE_HINT,rowStageCount:Math.ceil(count/ROW_STAGE_HINT),commercialDocuments:{payments:1,invoices:1,cheques:1,supplierTransactions:1,assetFinance:ownership==='finance'&&totalResidual>0?1:0,deliveryOrders:allocations.length,employmentContracts:allocations.length,hiringRecords:allocations.length},sequences:clone(sequences),allocations:allocations.map((row,index)=>({...row,grossAmount:gross[index],upfrontAmount:upfront[index],residualAmount:residual[index]}))};return deepFreeze({...body,fingerprint:fingerprint(body)});
  }
  function validateOrder(value){if(!object(value)||value.schema!==ORDER_SCHEMA||value.version!==VERSION)return false;const {fingerprint:found,...body}=value;return found===fingerprint(body);}
  function orderAvailabilityCurrent(order,{fleetSize,membershipRevision,revision,deliveries=[],facilities=[]}={}){
    if(!validateOrder(order)||!object(order.availabilityGuard))return false;const guard=order.availabilityGuard;return guard.fleetSize===Number(fleetSize)&&guard.membershipRevision===membershipRevision&&guard.revision===revision&&guard.contextDigest===contextDigest(deliveries,facilities);
  }
  function commandPayload(order,{authorization=globalThis.GH_AUTHORIZATION}={}){
    if(!validateOrder(order))throw new TypeError('asset-purchase-order-invalid');if(typeof authorization?.digest!=='function')throw new Error('asset-purchase-order-digest-owner-missing');const orderDigest=String(authorization.digest(order));if(!/^[a-f0-9]{64}$/i.test(orderDigest))throw new Error('asset-purchase-order-digest-invalid');
    return deepFreeze({schema:COMMAND_SCHEMA,version:VERSION,order:clone(order),orderDigest,orderFingerprint:order.fingerprint,ownerCompanyId:order.ownerCompanyId,assetMode:order.assetMode,count:order.count,totalUpfront:order.totalUpfront,availabilityFingerprint:order.availabilityFingerprint});
  }
  function validateCommandPayload(value,{authorization=globalThis.GH_AUTHORIZATION}={}){
    if(!object(value)||value.schema!==COMMAND_SCHEMA||value.version!==VERSION||!validateOrder(value.order)||typeof authorization?.digest!=='function')return false;const order=value.order;
    return value.orderFingerprint===order.fingerprint&&value.ownerCompanyId===order.ownerCompanyId&&value.assetMode===order.assetMode&&Object.is(value.count,order.count)&&Object.is(value.totalUpfront,order.totalUpfront)&&value.availabilityFingerprint===order.availabilityFingerprint&&String(authorization.digest(order))===value.orderDigest&&/^[a-f0-9]{64}$/i.test(value.orderDigest);
  }
  function validateReservation(order,reservation){
    if(!validateOrder(order)||!object(reservation)||reservation.schema!==RESERVATION_SCHEMA||reservation.version!==VERSION||reservation.orderFingerprint!==order.fingerprint)return false;const {fingerprint:found,...body}=reservation;return found===fingerprint(body)&&reservation.masterId===order.requestRef;
  }
  function financialIntent(order,reservation){
    if(!validateReservation(order,reservation))throw new TypeError('asset-purchase-order-reservation-required');return deepFreeze({payment:{ownerCompanyId:order.ownerCompanyId,amount:order.totalUpfront,supplier:clone(order.supplier),note:`${order.ownership==='lease'?'دفعة إيجار':'شراء'} ${order.count} × ${order.item.name}`,budgetLine:'capex',taxable:false,requestRef:`${order.requestRef}:PAYMENT`},assetFinance:order.ownership==='finance'&&order.totalResidual>0?{company:order.ownerCompanyId,amount:order.totalResidual,lender:order.supplier.name,assetCatalogId:order.item.id}:null});
  }
  function reservationFromSnapshot(order,current){
    if(!validateOrder(order))throw new TypeError('asset-purchase-order-invalid');current=requireSequences(current,order.ownerCompanyId);if(fingerprint(current)!==fingerprint(order.sequences))throw new Error('asset-purchase-order-sequence-stale');
    const limits={master:1,asset:order.count,delivery:order.allocations.length,contract:order.allocations.length,hiring:order.allocations.length},ends={};for(const key of Object.keys(limits)){ends[key]=current[key].current+limits[key];if(!Number.isSafeInteger(ends[key])||ends[key]>(key==='asset'?PLAN().MAX_COMPACT_SEQUENCE:Number.MAX_SAFE_INTEGER))throw new Error(`asset-purchase-order-sequence-exhausted:${key}`);}
    const body={schema:RESERVATION_SCHEMA,version:VERSION,orderFingerprint:order.fingerprint,masterId:formatted(current.master.prefix,current.master.current+1,current.master.width),asset:{prefix:current.asset.prefix,start:current.asset.current+1,count:order.count,width:current.asset.width},delivery:{prefix:current.delivery.prefix,start:current.delivery.current+1,count:order.allocations.length,width:current.delivery.width},contract:{prefix:current.contract.prefix,start:current.contract.current+1,count:order.allocations.length,width:current.contract.width},hiring:{prefix:current.hiring.prefix,start:current.hiring.current+1,count:order.allocations.length,width:current.hiring.width}};return {reservation:deepFreeze({...body,fingerprint:fingerprint(body)}),ends};
  }
  function previewReservation(order){return reservationFromSnapshot(order,order.sequences).reservation;}
  function reserve(state,order,options={}){
    if(!validateOrder(order))throw new TypeError('asset-purchase-order-invalid');const tx=options.transactionCore||globalThis.GH_TRANSACTION_CORE,durable=options.durableContext||globalThis.__GH_DURABLE_COMMAND_CONTEXT__,transactionActive=tx?.isActive?.()===true,joinedTransaction=tx?.isActiveFor?.(state)===true,durableDraft=!!durable&&durable.draft===state,durableLive=!!durable&&durable.liveState===state;
    if(transactionActive&&!joinedTransaction)throw new Error('asset-purchase-order-transaction-owner-mismatch');if(durableLive&&!durableDraft)throw new Error('asset-purchase-order-durable-live-state-blocked');if(!joinedTransaction&&!durableDraft)throw new Error('asset-purchase-order-reservation-transaction-required');const current=sequenceSnapshot(state,order.ownerCompanyId),built=reservationFromSnapshot(order,current);
    state.sequences=object(state.sequences)?state.sequences:{};for(const key of Object.keys(built.ends))state.sequences[current[key].key]=built.ends[key];return built.reservation;
  }
  function bind(order,reservation,payment){
    if(!validateReservation(order,reservation))throw new TypeError('asset-purchase-order-bind');
    const paymentRef=text(payment?.ref||payment?.reference||payment?.cheque?.id,'payment-ref'),invoiceRef=text(payment?.invoiceRef||payment?.invoice?.number,'invoice-ref'),paymentAmount=finite(payment?.amount??payment?.cheque?.amount,'payment-amount',{min:0});if(Math.abs(paymentAmount-order.totalUpfront)>.01)throw new Error('asset-purchase-order-payment-mismatch');
    let assetOffset=0,serialOffset=0;const groups=order.allocations.map((row,index)=>{const group={qty:row.qty,assetSequenceStart:reservation.asset.start+assetOffset,serialStart:order.serialStart+serialOffset,assetIdPrefix:reservation.asset.prefix,baseId:row.baseId,baseName:row.baseName,orderId:formatted(reservation.delivery.prefix,reservation.delivery.start+index,reservation.delivery.width),requestRef:`${order.requestRef}:ALLOCATION:${index+1}`,supplier:order.supplier.name,contractId:formatted(reservation.contract.prefix,reservation.contract.start+index,reservation.contract.width),hiringId:formatted(reservation.hiring.prefix,reservation.hiring.start+index,reservation.hiring.width),payment:{kind:'cheque',ref:paymentRef,invoiceRef,ownerCompanyId:order.ownerCompanyId,company:order.ownerCompanyId,amount:row.upfrontAmount},orderedAtSeconds:order.simSeconds,deliveredAtSeconds:order.simSeconds,documentLeadDays:order.documentLeadDays,leadSeconds:order.leadSeconds,immediateDelivery:order.immediateDelivery};assetOffset+=row.qty;serialOffset+=row.qty;return group;});
    const plan=PLAN().prepare({contextToken:order.contextToken,ownerCompanyId:order.ownerCompanyId,assetMode:order.assetMode,assetClass:order.assetClass,operationProfileId:order.operationProfileId,companyShortName:order.companyShortName,companyName:order.companyName,tab:order.tab,ownership:order.ownership,simSeconds:order.simSeconds,item:order.item,groups});
    const allocations=groups.map((group,index)=>({deliveryOrderId:group.orderId,baseId:group.baseId,baseName:group.baseName,count:group.qty,assetIds:PLAN().employmentContract(plan,index).assetIds,grossAmount:order.allocations[index].grossAmount,upfrontAmount:order.allocations[index].upfrontAmount,residualAmount:order.allocations[index].residualAmount,contractId:group.contractId,hiringId:group.hiringId}));
    const auditBody={schema:AUDIT_SCHEMA,version:VERSION,requestRef:order.requestRef,ownerCompanyId:order.ownerCompanyId,ownership:order.ownership,paymentRef,invoiceRef,totalCount:order.count,totalPrice:order.totalPrice,totalUpfront:order.totalUpfront,totalResidual:order.totalResidual,allocations},audit=deepFreeze({...auditBody,fingerprint:fingerprint(auditBody)});
    const finance=order.ownership==='finance'&&order.totalResidual>0?{company:order.ownerCompanyId,amount:order.totalResidual,ref:`ASSET-FIN-${paymentRef}`,lender:order.supplier.name,assetCatalogId:order.item.id,invoiceRef}:null;return deepFreeze({order,plan,audit,finance});
  }

  return Object.freeze({VERSION,AVAILABILITY_SCHEMA,ORDER_SCHEMA,RESERVATION_SCHEMA,AUDIT_SCHEMA,COMMAND_SCHEMA,MAX_ASSETS,MAX_ALLOCATIONS,ROW_STAGE_HINT,contextDigest,buildAvailability,availabilityCurrent,orderAvailabilityCurrent,allocate,sequenceSnapshot,quote,validateOrder,commandPayload,validateCommandPayload,validateReservation,previewReservation,financialIntent,reserve,bind});
});
