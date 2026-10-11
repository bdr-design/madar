'use strict';

// Pure, compact planning for a bulk asset purchase.  The authoritative owners
// still validate money, facilities, authorization and persistence.  This core
// only expands already-reserved deterministic id ranges into the exact asset,
// staffing and delivered-receipt values they own.  A plan remains O(groups),
// even when it describes one million assets.
((root,factory)=>{
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.GH_ASSET_PURCHASE_PLAN_CORE=api;
})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  const VERSION='1.0.0',SCHEMA='gh-asset-purchase-plan-v1',RECEIPT_SCHEMA='gh-asset-receipt-v1';
  const MAX_GROUPS=1000000,MAX_ASSETS=1000000,MAX_COMPACT_SEQUENCE=0xFFFFFFFF,DEFAULT_BUDGET_MS=4;
  const ROLE_DEFAULTS=Object.freeze({
    pilots:Object.freeze({name:'الطيارون',dailyRate:600}),
    cabin:Object.freeze({name:'طاقم الضيافة',dailyRate:130}),
    aeng:Object.freeze({name:'مهندسو الطيران',dailyRate:230}),
    captains:Object.freeze({name:'قباطنة السفن',dailyRate:450}),
    sailors:Object.freeze({name:'بحارة وملاحون',dailyRate:75}),
    seng:Object.freeze({name:'مهندسو السفن',dailyRate:280}),
    drivers:Object.freeze({name:'سائقو الشاحنات',dailyRate:110}),
    mech:Object.freeze({name:'فنيو الصيانة',dailyRate:140})
  });
  const MODE_ROLES=Object.freeze({
    air:Object.freeze({pilots:10,cabin:16,aeng:4}),
    sea:Object.freeze({captains:2,sailors:16,seng:4}),
    road:Object.freeze({drivers:2,mech:1})
  });
  const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
  const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
  const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
  const validatedPlans=new WeakSet();
  const finite=value=>typeof value==='number'&&Number.isFinite(value);
  const text=(value,name,{empty=false,max=1024}={})=>{value=String(value??'');if((!empty&&!value)||value.length>max)throw new TypeError(`asset-purchase-plan-${name}`);return value;};
  const integer=(value,name,{min=0,max=Number.MAX_SAFE_INTEGER}={})=>{if(!Number.isSafeInteger(value)||value<min||value>max)throw new TypeError(`asset-purchase-plan-${name}`);return value;};
  const safeNumber=(value,name,{min=-Infinity,max=Infinity}={})=>{if(!finite(value)||value<min||value>max)throw new TypeError(`asset-purchase-plan-${name}`);return value;};

  function stable(value){
    if(Array.isArray(value))return `[${value.map(stable).join(',')}]`;
    if(object(value))return `{${Object.keys(value).filter(key=>value[key]!==undefined).sort().map(key=>`${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
    return JSON.stringify(value);
  }
  // A corruption/staleness token, not an authorization primitive.  Player
  // authorization remains on the main thread and never trusts this value.
  function fingerprint(value){
    const source=stable(value);let a=0x811c9dc5,b=0x9e3779b9;
    for(let index=0;index<source.length;index++){const code=source.charCodeAt(index);a=Math.imul(a^code,0x01000193)>>>0;b=Math.imul(b^(code+index),0x85ebca6b)>>>0;}
    return `${a.toString(16).padStart(8,'0')}${b.toString(16).padStart(8,'0')}:${source.length}`;
  }
  function id(prefix,sequence){return `${prefix}-${String(sequence).padStart(8,'0')}`;}

  function staffingPlan(assetMode,specs){
    const defaults=MODE_ROLES[assetMode];if(!defaults)throw new TypeError('asset-purchase-plan-mode');
    const source=object(specs?.crewPlan)?specs.crewPlan:defaults,roles=[];let total=0,monthlyPayroll=0;
    for(const roleId of Object.keys(defaults)){
      const count=Math.max(0,Math.round(Number(source[roleId])||0));if(!count)continue;
      const role=ROLE_DEFAULTS[roleId]||{name:roleId,dailyRate:0},rolePayroll=role.dailyRate*30*count;
      roles.push({id:roleId,name:role.name,dailyRate:role.dailyRate,count,monthlyPayroll:rolePayroll});total+=count;monthlyPayroll+=rolePayroll;
    }
    if(!total||!Number.isFinite(monthlyPayroll))throw new TypeError('asset-purchase-plan-staffing');
    return {mode:'automatic-fixed',ready:true,roles,total,monthlyPayroll};
  }
  function normalizedItem(input){
    const row=input.item;if(!object(row)||!object(row.specs))throw new TypeError('asset-purchase-plan-item');
    const price=safeNumber(Number(row.price),'price',{min:0}),leaseMonthly=Number(row.leaseMonthly)||0;
    if(!Number.isFinite(leaseMonthly)||leaseMonthly<0)throw new TypeError('asset-purchase-plan-lease');
    return {id:text(row.id,'catalog-id'),icon:clone(row.icon),name:text(row.name,'model'),year:Number(row.year)||(input.tab==='used'?2021:2026),condition:row.condition||100,specs:clone(row.specs),price,leaseMonthly};
  }
  function normalizedPayment(row,ownerCompanyId){
    const payment=row.payment;if(!object(payment))throw new TypeError('asset-purchase-plan-payment');
    const amount=safeNumber(Number(payment.amount),'payment-amount',{min:0});
    return {kind:text(payment.kind||'cheque','payment-kind'),ref:text(payment.ref,'payment-ref'),invoiceRef:text(payment.invoiceRef,'invoice-ref'),ownerCompanyId:text(payment.ownerCompanyId||ownerCompanyId,'payment-owner'),company:text(payment.company||ownerCompanyId,'payment-company'),amount};
  }
  function normalizeGroup(row,index,common){
    if(!object(row))throw new TypeError('asset-purchase-plan-group');
    const qty=integer(row.qty,'quantity',{min:1,max:MAX_ASSETS}),assetSequenceStart=integer(row.assetSequenceStart,'asset-sequence',{min:1,max:MAX_COMPACT_SEQUENCE}),serialStart=integer(row.serialStart,'serial',{min:1}),orderedAtSeconds=safeNumber(Number(row.orderedAtSeconds??common.simSeconds),'ordered-at',{min:0});
    if(assetSequenceStart+qty-1>MAX_COMPACT_SEQUENCE)throw new TypeError('asset-purchase-plan-asset-sequence-range');
    const deliveredAtSeconds=safeNumber(Number(row.deliveredAtSeconds??common.simSeconds),'delivered-at',{min:0}),orderedDay=Math.floor(orderedAtSeconds/86400),deliveredDay=Math.floor(deliveredAtSeconds/86400),documentLeadDays=Math.max(1,Math.floor(Number(row.documentLeadDays)||1)),immediateDelivery=row.immediateDelivery!==false;
    const assetPrefix=text(row.assetIdPrefix||`N-${common.ownerCompanyId}`,'asset-prefix'),baseId=text(row.baseId,'base-id'),baseName=text(row.baseName,'base-name'),orderId=text(row.orderId,'order-id'),requestRef=row.requestRef==null?null:text(row.requestRef,'request-ref',{empty:true}),supplier=text(row.supplier,'supplier'),contractId=text(row.contractId,'contract-id'),hiringId=text(row.hiringId,'hiring-id'),payment=normalizedPayment(row,common.ownerCompanyId);
    return {index,qty,assetSequenceStart,serialStart,assetIdPrefix:assetPrefix,baseId,baseName,orderId,requestRef,supplier,contractId,hiringId,payment,orderedAtSeconds,orderedDay,deliveredAtSeconds,deliveredDay,documentLeadDays,immediateDelivery,dueDay:immediateDelivery?orderedDay:orderedDay+documentLeadDays,dueAtSeconds:immediateDelivery?orderedAtSeconds:orderedAtSeconds+Math.max(60,Number(row.leadSeconds)||60)};
  }
  function prepare(input){
    if(!object(input)||!Array.isArray(input.groups)||!input.groups.length||input.groups.length>MAX_GROUPS)throw new TypeError('asset-purchase-plan-input');
    const common={ownerCompanyId:text(input.ownerCompanyId,'owner'),assetMode:text(input.assetMode,'mode'),assetClass:text(input.assetClass,'asset-class'),operationProfileId:text(input.operationProfileId,'operation-profile'),companyShortName:text(input.companyShortName,'company-short-name'),companyName:text(input.companyName??input.companyShortName,'company-name'),tab:text(input.tab||'new','tab'),ownership:text(input.ownership||'cash','ownership'),simSeconds:safeNumber(Number(input.simSeconds)||0,'sim-seconds',{min:0})};
    if(!['air','sea','road'].includes(common.assetMode)||!['cash','finance','lease'].includes(common.ownership))throw new TypeError('asset-purchase-plan-classification');
    const item=normalizedItem(input),baseStaffing=staffingPlan(common.assetMode,item.specs),groups=input.groups.map((row,index)=>normalizeGroup(row,index,common));let count=0;
    for(const group of groups){
      count+=group.qty;if(!Number.isSafeInteger(count)||count>MAX_ASSETS)throw new TypeError('asset-purchase-plan-total');
      // Fleet Core's reference batch owner adds these integer values once per
      // asset.  Staying inside the safe-integer domain makes the compact
      // multiplication bit-identical and prevents silent payroll/headcount
      // rounding before any commercial document is created.
      if(!Number.isSafeInteger(baseStaffing.total*group.qty)||!Number.isSafeInteger(baseStaffing.monthlyPayroll*group.qty)||baseStaffing.roles.some(role=>!Number.isSafeInteger(role.count*group.qty)))throw new TypeError('asset-purchase-plan-staffing-range');
    }
    const body={schema:SCHEMA,version:VERSION,contextToken:text(input.contextToken??'','context-token',{empty:true,max:4096}),common,item,baseStaffing,groups,count};
    const plan=deepFreeze({...body,fingerprint:fingerprint(body)});validatedPlans.add(plan);return plan;
  }
  function deepFreeze(value){if(!value||typeof value!=='object'||Object.isFrozen(value))return value;for(const child of Object.values(value))deepFreeze(child);return Object.freeze(value);}
  function validate(plan,{contextToken}={}){
    if(!object(plan)||plan.schema!==SCHEMA||plan.version!==VERSION||!object(plan.common)||!object(plan.item)||!object(plan.baseStaffing)||!Array.isArray(plan.groups)||!Number.isSafeInteger(plan.count)||plan.count<1||plan.count>MAX_ASSETS)return false;
    if(contextToken!==undefined&&plan.contextToken!==String(contextToken))return false;
    if(validatedPlans.has(plan))return true;
    const {fingerprint:found,...body}=plan;if(found!==fingerprint(body))return false;
    let count=0;for(let index=0;index<plan.groups.length;index++){const group=plan.groups[index];if(!object(group)||group.index!==index||!Number.isSafeInteger(group.qty)||group.qty<1||!Number.isSafeInteger(group.assetSequenceStart)||!Number.isSafeInteger(group.serialStart))return false;count+=group.qty;}
    if(count!==plan.count||plan.groups.some(group=>group.assetSequenceStart+group.qty-1>MAX_COMPACT_SEQUENCE))return false;deepFreeze(plan);validatedPlans.add(plan);return true;
  }
  function requirePlan(plan){if(!validate(plan))throw new TypeError('asset-purchase-plan-invalid');return plan;}
  function requireOffset(group,offset){return integer(offset,'offset',{min:0,max:group.qty-1});}
  function assetId(plan,groupIndex,offset){requirePlan(plan);groupIndex=integer(groupIndex,'group-index',{min:0,max:plan.groups.length-1});const group=plan.groups[groupIndex];return id(group.assetIdPrefix,group.assetSequenceStart+requireOffset(group,offset));}
  function pendingAssetUnchecked(plan,groupIndex,offset){
    const group=plan.groups[groupIndex];
    const {common,item}=plan,sequence=group.assetSequenceStart+offset,serial=group.serialStart+offset,now=common.simSeconds;
    return {id:id(group.assetIdPrefix,sequence),ownerCompanyId:common.ownerCompanyId,assetMode:common.assetMode,assetClass:common.assetClass,operationProfileId:common.operationProfileId,type:common.assetMode,icon:item.icon,name:`${common.companyShortName} ${100+serial}`,catalogId:item.id,routeId:null,baseFacility:group.baseId,progress:0,fuel:100,phase:'delivery',model:item.name,year:item.year,condition:item.condition,specs:clone(item.specs),ownership:common.ownership,monthlyLease:common.ownership==='lease'?item.leaseMonthly:0,leaseTermMonths:common.ownership==='lease'?60:0,leaseStartSeconds:common.ownership==='lease'?now:0,purchasePrice:item.price,deliveryOrderId:group.orderId};
  }
  function pendingAsset(plan,groupIndex,offset){requirePlan(plan);groupIndex=integer(groupIndex,'group-index',{min:0,max:plan.groups.length-1});offset=requireOffset(plan.groups[groupIndex],offset);return pendingAssetUnchecked(plan,groupIndex,offset);}
  function deliveredAsset(plan,groupIndex,offset){
    requirePlan(plan);groupIndex=integer(groupIndex,'group-index',{min:0,max:plan.groups.length-1});const group=plan.groups[groupIndex];offset=requireOffset(group,offset);const asset={...pendingAssetUnchecked(plan,groupIndex,offset),companyName:plan.common.companyName};
    asset.ownerCompanyId=plan.common.ownerCompanyId;asset.deliveryOrderId=group.orderId;asset.requestRef=group.requestRef;asset.paymentRef=group.payment.ref;asset.baseFacility=group.baseId;asset.phase='idle';asset.routeId=null;asset.routeSignature=null;asset.routeSlot=null;asset.departureScheduled=false;asset.progress=0;asset.fuel=100;asset.deliveryStatus='delivered';asset.deliveredDay=group.deliveredDay;asset.deliveredAtSeconds=group.deliveredAtSeconds;
    asset.staffing={...clone(plan.baseStaffing),contractId:group.contractId,provisionedAt:plan.common.simSeconds,center:group.baseName};asset.crewBlocked=false;return asset;
  }
  function idsForGroup(group){const out=new Array(group.qty);for(let index=0;index<out.length;index++)out[index]=id(group.assetIdPrefix,group.assetSequenceStart+index);return out;}
  function compactIds(group){
    if(group.qty<64)return idsForGroup(group);
    const prefix=`${group.assetIdPrefix}-`,last=group.assetSequenceStart+group.qty-1,segments=[];
    if(group.assetSequenceStart<10000000){const count=Math.min(last,9999999)-group.assetSequenceStart+1;if(count===1)segments.push(id(group.assetIdPrefix,group.assetSequenceStart));else segments.push([prefix,8,group.assetSequenceStart,count]);}
    if(last>=10000000){const first=Math.max(group.assetSequenceStart,10000000),count=last-first+1;if(count===1)segments.push(id(group.assetIdPrefix,first));else segments.push([prefix,0,first,count]);}
    return {$ids:segments};
  }
  function employmentContract(plan,groupIndex){
    requirePlan(plan);const group=plan.groups[integer(groupIndex,'group-index',{min:0,max:plan.groups.length-1})],ids=compactIds(group),first=pendingAsset(plan,groupIndex,0),staff=plan.baseStaffing;
    return {id:group.contractId,company:plan.common.ownerCompanyId,ownerCompanyId:plan.common.ownerCompanyId,assetId:first.id,assetIds:ids,deliveryOrderId:group.orderId,assetCount:group.qty,name:`طاقم ثابت · ${first.name}${group.qty>1?` + ${group.qty-1}`:''}`,role:'طاقم تشغيلي مرتبط بدفعة الأصول',count:staff.total*group.qty,center:group.baseName,salary:staff.monthlyPayroll*group.qty,startDay:Math.floor(plan.common.simSeconds/86400),termMonths:1200,status:'ساري',source:'توظيف آلي ثابت عند شراء دفعة الأصول',automaticAssetStaffing:true,permanent:true};
  }
  function hiringRecord(plan,groupIndex){
    requirePlan(plan);const group=plan.groups[integer(groupIndex,'group-index',{min:0,max:plan.groups.length-1})],staff=plan.baseStaffing;
    return {id:group.hiringId,at:plan.common.simSeconds,company:plan.common.ownerCompanyId,source:'توظيف دفعة أصول آلي ثابت',deliveryOrderId:group.orderId,assetIds:compactIds(group),total:staff.total*group.qty,monthlyPayroll:staff.monthlyPayroll*group.qty,coverageBefore:100,coverageAfter:100};
  }
  function pendingReceipt(plan,groupIndex,{withAssets=true,compactIdList=false}={}){
    requirePlan(plan);const group=plan.groups[integer(groupIndex,'group-index',{min:0,max:plan.groups.length-1})],assets=withAssets?Array.from({length:group.qty},(_,offset)=>pendingAsset(plan,groupIndex,offset)):undefined,assetIds=compactIdList?compactIds(group):idsForGroup(group);
    const row={id:group.orderId,deliveryOrderId:group.orderId,status:'pending',payment:clone(group.payment),requestRef:group.requestRef,orderedDay:group.orderedDay,orderedAtSeconds:group.orderedAtSeconds,dueDay:group.dueDay,dueAtSeconds:group.dueAtSeconds,contractLeadDays:group.documentLeadDays,immediateDelivery:group.immediateDelivery,ownerCompanyId:plan.common.ownerCompanyId,assetMode:plan.common.assetMode,assetClass:plan.common.assetClass,type:plan.common.assetMode,catalogId:plan.item.id,baseId:group.baseId,destination:group.baseName,supplier:group.supplier,count:group.qty,assetIds,assets};
    if(!withAssets)delete row.assets;return row;
  }
  function deliveredKeys(plan,groupIndex){return Object.keys(deliveredAsset(plan,groupIndex,0));}
  function deliveredReceiptWithTotal(plan,groupIndex,purchasePrice){
    // Realism compacts the procurement snapshot after delivery.  That snapshot
    // intentionally remains in its ordered `phase: delivery` form; the live
    // Fleet Store row is the separate delivered/staffed value.
    const group=plan.groups[groupIndex],receipt=pendingReceipt(plan,groupIndex,{withAssets:false,compactIdList:true}),first=pendingAssetUnchecked(plan,groupIndex,0),keys=Object.keys(first),template={},columns={};
    for(const key of keys){if(key==='id')continue;if(key==='name'&&group.qty>1){columns.name={range:{prefix:`${plan.common.companyShortName} `,start:100+group.serialStart,width:0,count:group.qty}};continue;}template[key]=clone(first[key]);}
    receipt.status='delivered';receipt.assetIds=compactIds(group);receipt.deliveredDay=group.deliveredDay;receipt.deliveredAtSeconds=group.deliveredAtSeconds;receipt.assetId=group.qty===1?first.id:null;receipt.assetName=first.name;receipt.purchasePrice=purchasePrice;receipt.assetReceipt={schema:RECEIPT_SCHEMA,count:group.qty,keys,template,columns,idsFrom:'assetIds'};return receipt;
  }
  function deliveredReceipt(plan,groupIndex){requirePlan(plan);groupIndex=integer(groupIndex,'group-index',{min:0,max:plan.groups.length-1});return deliveredReceiptWithTotal(plan,groupIndex,repeatedSum(plan.item.price,plan.groups[groupIndex].qty));}
  function crewDelta(plan){
    requirePlan(plan);const roles={};for(const role of plan.baseStaffing.roles)roles[role.id]=(roles[role.id]||0)+role.count*plan.count;
    return {roles,total:plan.baseStaffing.total*plan.count,monthlyPayroll:plan.baseStaffing.monthlyPayroll*plan.count};
  }
  function repeatedSum(value,count){let total=0;for(let index=0;index<count;index++)total+=value;return total;}
  function groupValueUnit(plan){return plan.item.price*(plan.common.ownership==='lease'?.08:.86);}
  function groupValueDeltas(plan){requirePlan(plan);const unit=groupValueUnit(plan);return plan.groups.map(group=>repeatedSum(unit,group.qty));}
  function summary(plan){requirePlan(plan);const deltas=groupValueDeltas(plan);return {count:plan.count,groups:plan.groups.length,purchasePrice:plan.item.price*plan.count,groupValueDelta:deltas.reduce((sum,value)=>sum+value,0),groupValueDeltas:deltas,crew:crewDelta(plan)};}

  // Adapter contract: begin(plan) may return a rollback token; addAsset is the
  // only required mutation.  Optional beginGroup/finishGroup/applyCrewDelta and
  // finish receive compact authoritative values.  Any throw, or iterator.return,
  // invokes rollback exactly once.  The caller controls painting between yields.
  function* applyStages(plan,adapter,options={}){
    requirePlan(plan);if(!object(adapter)||typeof adapter.addAsset!=='function')throw new TypeError('asset-purchase-plan-adapter');
    const clock=typeof options.clock==='function'?options.clock:(()=>globalThis.performance?.now?.()??Date.now()),budget=Math.min(16,Math.max(.25,Number(options.budgetMs)||DEFAULT_BUDGET_MS)),maxRows=Math.min(512,Math.max(1,Math.floor(Number(options.maxRowsPerSlice)||512)));let checkpoint,committed=false,rolledBack=false,done=0,sliceStarted=clock(),sliceRows=0,groupValueDelta=0;const groupValueDeltas=[];
    const rollback=error=>{if(rolledBack||committed)return;rolledBack=true;if(typeof adapter.rollback==='function')adapter.rollback(checkpoint,error);};
    const boundary=function* (phase,groupIndex){const elapsed=Math.max(0,clock()-sliceStarted);if(elapsed>=budget||sliceRows>=maxRows){yield {phase,groupIndex,done,total:plan.count,rows:sliceRows,elapsedMs:elapsed};sliceStarted=clock();sliceRows=0;}};
    try{
      if(typeof adapter.prepareStages==='function')yield* adapter.prepareStages(plan,options);
      checkpoint=typeof adapter.begin==='function'?adapter.begin(plan):undefined;
      for(let groupIndex=0;groupIndex<plan.groups.length;groupIndex++){
        const group=plan.groups[groupIndex],valueUnit=groupValueUnit(plan);let groupPurchasePrice=0,groupDelta=0;if(typeof adapter.beginGroup==='function')adapter.beginGroup(group,groupIndex);yield* boundary('group-begin',groupIndex);
        for(let offset=0;offset<group.qty;offset++){
          adapter.addAsset(deliveredAsset(plan,groupIndex,offset),{group,groupIndex,offset,index:done});groupPurchasePrice+=plan.item.price;groupDelta+=valueUnit;done++;sliceRows++;
          yield* boundary('assets',groupIndex);
        }
        groupValueDeltas.push(groupDelta);groupValueDelta+=groupDelta;if(typeof adapter.finishGroup==='function')adapter.finishGroup(group,groupIndex,{contract:employmentContract(plan,groupIndex),hiring:hiringRecord(plan,groupIndex),receipt:deliveredReceiptWithTotal(plan,groupIndex,groupPurchasePrice),groupValueDelta:groupDelta});yield* boundary('group-finish',groupIndex);
      }
      if(typeof adapter.applyCrewDelta==='function')adapter.applyCrewDelta(crewDelta(plan));yield* boundary('crew',plan.groups.length-1);
      const result={count:plan.count,groups:plan.groups.length,purchasePrice:plan.item.price*plan.count,groupValueDelta,groupValueDeltas,crew:crewDelta(plan)};
      if(typeof adapter.finishStages==='function')yield* adapter.finishStages(result,plan,options);else if(typeof adapter.finish==='function')adapter.finish(result,plan);yield* boundary('finish',plan.groups.length-1);
      if(typeof adapter.commit==='function')adapter.commit(checkpoint,result);committed=true;return result;
    }catch(error){rollback(error);throw error;}finally{if(!committed)rollback(new Error('asset-purchase-plan-aborted'));}
  }
  async function applyAtomic(plan,adapter,options={}){
    const stages=applyStages(plan,adapter,options),yieldControl=typeof options.yieldControl==='function'?options.yieldControl:(async()=>{});let step;
    try{while(!(step=stages.next()).done)await yieldControl(step.value);return step.value;}
    catch(error){try{stages.return?.();}catch(_rollbackError){}throw error;}
  }

  return Object.freeze({VERSION,SCHEMA,RECEIPT_SCHEMA,MAX_ASSETS,MAX_COMPACT_SEQUENCE,DEFAULT_BUDGET_MS,ROLE_DEFAULTS,MODE_ROLES,prepare,validate,fingerprint,staffingPlan,assetId,pendingAsset,deliveredAsset,pendingReceipt,deliveredReceipt,employmentContract,hiringRecord,crewDelta,groupValueDeltas,summary,applyStages,applyAtomic});
});
