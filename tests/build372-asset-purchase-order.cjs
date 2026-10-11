'use strict';

const assert=require('assert');
const crypto=require('crypto');
const {scenario}=require('./helpers/business-scenario');
const Plan=require('../WebApp/asset-purchase-plan-core.js');
const Apply=require('../WebApp/asset-purchase-apply-core.js');
const Order=require('../WebApp/asset-purchase-order-core.js');
const Determinism=require('../WebApp/determinism-core.js');
const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
const stable=value=>Array.isArray(value)?`[${value.map(stable).join(',')}]`:value&&typeof value==='object'?`{${Object.keys(value).filter(key=>value[key]!==undefined).sort().map(key=>`${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`:JSON.stringify(value);
const authorization={digest:value=>crypto.createHash('sha256').update(typeof value==='string'?value:stable(value)).digest('hex')};
const results=[];
function test(name,fn){try{fn();results.push({name,ok:true});}catch(error){results.push({name,ok:false,error:error.stack||String(error)});}}
function consume(iterator,onYield=()=>{}){let step;while(!(step=iterator.next()).done)onYield(step.value);return step.value;}

function fixture({facilities=null,deliveries=null,ownerModeCounts=null,occupancy=null,contextToken='purchase:test'}={}){
  facilities=facilities||[{id:'B1',name:'Alpha',ownerCompanyId:'air',capacity:300000,owned:true,compatible:true},{id:'B2',name:'Beta',ownerCompanyId:'air',capacity:400000,owned:true,compatible:true}];
  deliveries=deliveries||[];const fleetBaseline={fleetSize:37,membershipRevision:11,revision:29,occupancy:occupancy||[['B1',100]],ownerModeCounts:ownerModeCounts||[['air','air',37]]};
  const availability=Order.buildAvailability({fleetBaseline,deliveries,facilities,ownerCompanyId:'air',assetMode:'air',contextToken});
  const freshness={fleetSize:fleetBaseline.fleetSize,membershipRevision:fleetBaseline.membershipRevision,revision:fleetBaseline.revision,deliveries,facilities};
  return {fleetBaseline,deliveries,facilities,availability,freshness};
}
function quoteOf(f,{quantity=1,distribution='total',preferredBaseId='B1',ownership='cash',state={sequences:{}},item=null,contextToken=f.availability.contextToken}={}){
  item=item||{id:'A350',name:'Airframe',year:2026,condition:100,price:1250000,leaseMonthly:18000,downPayment:.25,specs:{crewPlan:{pilots:3,cabin:7,aeng:2}}};
  const sequences=Order.sequenceSnapshot(state,'air');
  return Order.quote({availability:f.availability,freshness:f.freshness,contextToken,ownerCompanyId:'air',assetMode:'air',assetClass:'aircraft',operationProfileId:'air-main',companyShortName:'AIR',companyName:'Air Holdings',tab:'new',ownership,simSeconds:987654,item,supplier:{id:'SUP-1',legalName:'Supplier LLC'},quantity,distribution,preferredBaseId,sequences,documentLeadDays:90,leadSeconds:300,immediateDelivery:true});
}
function fakeTx(){return {isActive:()=>true,isActiveFor:()=>true};}
function pay(order){return {ref:'CHQ-AGG-0001',invoiceRef:'INV-AGG-0001',amount:order.totalUpfront};}
function sums(order,key){return order.allocations.reduce((sum,row)=>sum+row[key],0);}

// 512 controls only row materialization. It must never become a payment/document boundary.
test('200k assets use 391 row stages but one commercial payment document set',()=>{
  const f=fixture({facilities:[{id:'B1',name:'Alpha',ownerCompanyId:'air',capacity:250000,owned:true,compatible:true}],occupancy:[]}),state={sequences:{}},order=quoteOf(f,{quantity:200000,state});
  assert.equal(order.rowStageHint,512);assert.equal(order.rowStageCount,391);assert.equal(order.count,200000);assert.deepStrictEqual(order.commercialDocuments,{payments:1,invoices:1,cheques:1,supplierTransactions:1,assetFinance:0,deliveryOrders:1,employmentContracts:1,hiringRecords:1});
  const reservation=Order.reserve(state,order,{transactionCore:fakeTx()}),intent=Order.financialIntent(order,reservation),bound=Order.bind(order,reservation,pay(order));
  assert.equal(intent.payment.amount,order.totalUpfront);assert.equal(bound.plan.count,200000);assert.equal(bound.plan.groups.length,1);assert.equal(bound.plan.groups[0].payment.ref,'CHQ-AGG-0001');assert.equal(bound.audit.allocations.length,1);assert.equal(state.sequences['N-AIR'],200000);assert.equal(JSON.stringify(bound.plan).length<20000,true);assert.equal(JSON.stringify(bound.audit).length<10000,true);
  for(const offset of [0,99999,199999]){const asset=Plan.deliveredAsset(bound.plan,0,offset);assert.equal(asset.ownerCompanyId,'air');assert.equal(asset.baseFacility,'B1');assert.equal(asset.paymentRef,'CHQ-AGG-0001');}
});

test('multi-base allocations share one cheque and their ordered residuals sum exactly',()=>{
  const f=fixture({facilities:[{id:'B1',name:'Alpha',ownerCompanyId:'air',capacity:100003,owned:true,compatible:true},{id:'B2',name:'Beta',ownerCompanyId:'air',capacity:199997,owned:true,compatible:true}],occupancy:[]}),state={sequences:{}},order=quoteOf(f,{quantity:250001,ownership:'finance',state,preferredBaseId:'B1'});
  assert.equal(order.allocations.length,2);assert.equal(order.commercialDocuments.cheques,1);assert.equal(order.commercialDocuments.invoices,1);assert.equal(order.commercialDocuments.supplierTransactions,1);assert.equal(order.commercialDocuments.assetFinance,1);assert.equal(order.commercialDocuments.deliveryOrders,2);
  assert(Object.is(sums(order,'grossAmount'),order.totalPrice));assert(Object.is(sums(order,'upfrontAmount'),order.totalUpfront));assert(Object.is(sums(order,'residualAmount'),order.totalResidual));
  const reservation=Order.reserve(state,order,{transactionCore:fakeTx()}),bound=Order.bind(order,reservation,pay(order));assert.equal(bound.plan.groups.length,2);assert.equal(new Set(bound.plan.groups.map(row=>row.payment.ref)).size,1);assert.equal(bound.finance.amount,order.totalResidual);assert.equal(bound.audit.allocations.reduce((sum,row)=>sum+row.count,0),order.count);
  for(let index=0;index<bound.plan.groups.length;index++){const group=bound.plan.groups[index],audit=bound.audit.allocations[index];assert.equal(audit.deliveryOrderId,group.orderId);assert.equal(audit.contractId,group.contractId);assert.equal(audit.hiringId,group.hiringId);assert.equal(Plan.assetId(bound.plan,index,0),Array.isArray(audit.assetIds)?audit.assetIds[0]:`${audit.assetIds.$ids[0][0]}${String(audit.assetIds.$ids[0][2]).padStart(audit.assetIds.$ids[0][1],'0')}`);}
});

test('aggregate cash finance and lease totals match the former 512 formulas without multiplying documents',()=>{
  const f=fixture({facilities:[{id:'B1',name:'Alpha',ownerCompanyId:'air',capacity:250000,owned:true,compatible:true}],occupancy:[]}),item={id:'A',name:'Model',year:2026,condition:100,price:1200000,leaseMonthly:17500,downPayment:.25,specs:{crewPlan:{pilots:2,cabin:4,aeng:1}}},count=200000;
  for(const mode of ['cash','finance','lease']){const order=quoteOf(f,{quantity:count,ownership:mode,state:{sequences:{}},item}),chunks=[];for(let left=count;left>0;left-=512)chunks.push(Math.min(left,512));const old=chunks.reduce((sum,qty)=>sum+(mode==='cash'?item.price*qty:mode==='finance'?item.price*qty*item.downPayment:item.leaseMonthly*3*qty),0);assert(Object.is(order.totalUpfront,old),`${mode}: ${order.totalUpfront} !== ${old}`);assert.equal(order.commercialDocuments.cheques,1);assert.equal(order.rowStageCount,chunks.length);}
});

test('sequence reservation is O(allocations) and bit-for-bit nextId compatible at width eight',()=>{
  const f=fixture({facilities:[{id:'B1',name:'Alpha',ownerCompanyId:'air',capacity:10,owned:true,compatible:true},{id:'B2',name:'Beta',ownerCompanyId:'air',capacity:20,owned:true,compatible:true}],occupancy:[]}),initial={sequences:{'MANUAL-ASSET':9,'N-AIR':100,'DEL-AIR':3,'EMP-AUTO':4,'HR-AUTO':5}},state=clone(initial),reference=clone(initial),order=quoteOf(f,{quantity:23,state,preferredBaseId:'B1'}),preview=Order.previewReservation(order),reservation=Order.reserve(state,order,{transactionCore:fakeTx()});
  assert.deepStrictEqual(reservation,preview);
  const master=Determinism.nextId(reference,'MANUAL-ASSET'),assetIds=Array.from({length:23},()=>Determinism.nextId(reference,'N-AIR')),deliveryIds=Array.from({length:2},()=>Determinism.nextId(reference,'DEL-AIR')),contractIds=Array.from({length:2},()=>Determinism.nextId(reference,'EMP-AUTO')),hiringIds=Array.from({length:2},()=>Determinism.nextId(reference,'HR-AUTO'));
  assert.deepStrictEqual(state.sequences,reference.sequences);assert.equal(reservation.masterId,master);assert.equal(`${reservation.asset.prefix}-${String(reservation.asset.start).padStart(8,'0')}`,assetIds[0]);assert.equal(`${reservation.asset.prefix}-${String(reservation.asset.start+reservation.asset.count-1).padStart(8,'0')}`,assetIds.at(-1));assert.equal(`${reservation.delivery.prefix}-${String(reservation.delivery.start+1).padStart(8,'0')}`,deliveryIds.at(-1));assert.equal(`${reservation.contract.prefix}-${String(reservation.contract.start+1).padStart(8,'0')}`,contractIds.at(-1));assert.equal(`${reservation.hiring.prefix}-${String(reservation.hiring.start+1).padStart(8,'0')}`,hiringIds.at(-1));
  const outside=clone(initial);assert.throws(()=>Order.reserve(outside,order),/reservation-transaction-required/);assert.deepStrictEqual(outside,initial);
});

test('availability is exact, scan-free after its worker baseline, and fails closed on stale/malformed roots',()=>{
  const deliveries=[{id:'D1',status:'pending',baseId:'B1',count:9,ownerCompanyId:'air',assetMode:'air'}],f=fixture({deliveries,occupancy:[['B1',20]],ownerModeCounts:[['air','air',31],['road','road',4]]});assert.equal(f.availability.serialCount,40);assert.equal(f.availability.facilities.find(row=>row.id==='B1').occupied,29);assert.equal(Order.availabilityCurrent(f.availability,f.freshness),true);
  const guarded=quoteOf(f,{quantity:1});assert.equal(Order.orderAvailabilityCurrent(guarded,f.freshness),true);
  assert.equal(Order.availabilityCurrent(f.availability,{...f.freshness,revision:30}),false);const changed=clone(deliveries);changed[0].count=10;assert.equal(Order.availabilityCurrent(f.availability,{...f.freshness,deliveries:changed}),false);assert.throws(()=>quoteOf(f,{quantity:1,contextToken:'wrong'}),/context-stale/);assert.throws(()=>Order.quote({...(()=>{const order=quoteOf(f,{quantity:1});return {availability:f.availability,freshness:{...f.freshness,revision:30},contextToken:f.availability.contextToken,ownerCompanyId:'air',assetMode:'air',assetClass:order.assetClass,operationProfileId:order.operationProfileId,companyShortName:order.companyShortName,companyName:order.companyName,tab:'new',ownership:'cash',simSeconds:0,item:order.item,supplier:order.supplier,quantity:1,sequences:Order.sequenceSnapshot({sequences:{}},'air')};})()}),/availability-stale/);
  assert.equal(Order.orderAvailabilityCurrent(guarded,{...f.freshness,deliveries:changed}),false);assert.equal(Order.orderAvailabilityCurrent(guarded,{...f.freshness,revision:30}),false);
  assert.throws(()=>Order.buildAvailability({fleetBaseline:{...f.fleetBaseline,ownerModeCounts:[['air','air']]},deliveries:[],facilities:f.facilities,ownerCompanyId:'air',assetMode:'air'}),/owner-mode-count/);
  assert.throws(()=>Order.buildAvailability({fleetBaseline:f.fleetBaseline,deliveries:[],facilities:[f.facilities[0],clone(f.facilities[0])],ownerCompanyId:'air',assetMode:'air'}),/facility-duplicate:B1/);
});

test('quote rejects impossible serial arithmetic and invalid staffing before sequences or money can move',()=>{
  const malformed=fixture({facilities:[{id:'B1',name:'Alpha',ownerCompanyId:'air',capacity:10,owned:true,compatible:true}],occupancy:[],ownerModeCounts:[['air','air',Number.MAX_SAFE_INTEGER]]});assert.throws(()=>quoteOf(malformed,{quantity:1}),/serial-range/);
  const f=fixture({facilities:[{id:'B1',name:'Alpha',ownerCompanyId:'air',capacity:10,owned:true,compatible:true}],occupancy:[]}),state={sequences:{}},invalid={id:'BAD',name:'No crew',price:100,leaseMonthly:1,specs:{crewPlan:{pilots:0,cabin:0,aeng:0}}};assert.throws(()=>quoteOf(f,{quantity:1,state,item:invalid}),/staffing/);assert.deepStrictEqual(state,{sequences:{}});
});

test('signed command payload carries the compact full order and a recomputed SHA-256 digest',()=>{
  const f=fixture({facilities:[{id:'B1',name:'Alpha',ownerCompanyId:'air',capacity:250000,owned:true,compatible:true}],occupancy:[]}),order=quoteOf(f,{quantity:200000,state:{sequences:{}}}),payload=Order.commandPayload(order,{authorization});assert.equal(payload.order.fingerprint,order.fingerprint);assert.match(payload.orderDigest,/^[a-f0-9]{64}$/);assert.equal(Order.validateCommandPayload(payload,{authorization}),true);assert.equal(JSON.stringify(payload).length<25000,true);assert.equal(JSON.stringify(payload).includes('assetIds'),false);
  const tampered=clone(payload);tampered.totalUpfront+=1;assert.equal(Order.validateCommandPayload(tampered,{authorization}),false);const tamperedOrder=clone(payload);tamperedOrder.order.allocations[0].qty--;assert.equal(Order.validateCommandPayload(tamperedOrder,{authorization}),false);
});

function financeWorld(tag,ownership='finance',qty=3){
  const e=scenario(),{s,state,item}=e;state.godMoney=true;state.infiniteMoney=true;state.advanced.facilities.B1.capacity=1000000;state.fleet=s.GH_FLEET_STORE.fromAssets([],{at:state.simSeconds});delete state.assets;
  const base=state.globalBases.find(row=>row.id==='B1'),facilities=[{id:base.id,name:base.name,ownerCompanyId:'air',capacity:s.GH_FACILITY_CORE.assetCapacity(base),owned:true,compatible:true}],baseline=Apply.computeBaseline(state,s.GH_FLEET_DATA),deliveries=state.realism.procurement.deliveries,availability=Order.buildAvailability({fleetBaseline:baseline,deliveries,facilities,ownerCompanyId:'air',assetMode:'air',contextToken:`purchase:${tag}`}),freshness={fleetSize:baseline.fleetSize,membershipRevision:baseline.membershipRevision,revision:baseline.revision,deliveries,facilities},registry=state.companyRegistry.air;
  const order=Order.quote({availability,freshness,contextToken:`purchase:${tag}`,ownerCompanyId:'air',assetMode:'air',assetClass:'aircraft',operationProfileId:registry.operationProfileId,companyShortName:registry.shortName,companyName:registry.legalName,tab:'new',ownership,simSeconds:state.simSeconds,item:clone(item),supplier:{id:'S1',name:'Supplier'},quantity:qty,distribution:'total',preferredBaseId:'B1',sequences:Order.sequenceSnapshot(state,'air'),immediateDelivery:true});return {...e,order,facilities};
}
function settleOne(env){const {s,state,order}=env,reservation=Order.reserve(state,order,{transactionCore:s.GH_TRANSACTION_CORE}),intent=Order.financialIntent(order,reservation),paid=s.GH_PROCUREMENT_CORE.execute({state},'supplier-payment',{ownerCompanyId:intent.payment.ownerCompanyId,amount:intent.payment.amount,supplier:intent.payment.supplier,note:intent.payment.note,budgetLine:intent.payment.budgetLine,taxable:intent.payment.taxable,requestRef:intent.payment.requestRef}),bound=Order.bind(order,reservation,{...paid,amount:intent.payment.amount});if(bound.finance)s.GH_FINANCE_CORE.execute({state},'record-asset-finance',bound.finance);return bound;}

test('one aggregate supplier settlement creates exactly one cheque invoice transaction and finance record',()=>{
  const env=financeWorld('DOCS','finance',3),{s,state}=env,before={cheques:state.finance.cheques.length,invoices:state.finance.invoices.length,supplier:state.supplierTransactions.length,debt:state.finance.debtRecords.length};let bound;const tx=s.GH_TRANSACTION_CORE.execute(state,{label:'asset-purchase-one-settlement',apply:()=>{bound=settleOne(env);return bound.audit;}});assert.equal(tx.committed,true);assert.equal(state.finance.cheques.length,before.cheques+1);assert.equal(state.finance.invoices.length,before.invoices+1);assert.equal(state.supplierTransactions.length,before.supplier+1);assert.equal(state.finance.debtRecords.length,before.debt+1);assert.equal(bound.plan.groups.every(row=>row.payment.ref===bound.audit.paymentRef),true);assert.equal(bound.finance.amount,env.order.totalResidual);
});

function rollbackSnapshot(env){const {s,state}=env;return {sequences:clone(state.sequences),finance:clone(state.finance),supplier:clone(state.supplierTransactions),procurement:clone(state.realism.procurement),labor:clone(state.advanced.labor),crew:clone(state.crew),fleet:clone(s.GH_FLEET_DATA.map(state,row=>s.GH_FLEET_DATA.plain(row)))};}
test('failure during row slicing rolls back master documents allocations sequences labor and fleet together',()=>{
  const env=financeWorld('ROLLBACK','cash',9),{s,state,order}=env,before=rollbackSnapshot(env);let added=0;
  assert.throws(()=>s.GH_TRANSACTION_CORE.execute(state,{label:'asset-purchase-full-rollback',apply:()=>{
    const bound=settleOne(env);for(let index=0;index<bound.plan.groups.length;index++)state.realism.procurement.deliveries.push(Plan.pendingReceipt(bound.plan,index));state.realism.procurement.pendingDeliveryCount+=bound.plan.groups.length;
    consume(Apply.reserveCapacityStages(state,bound.plan,{fleetData:s.GH_FLEET_DATA,planCore:Plan,current:()=>true,rowSlice:256}));
    const base=Apply.createAdapter(state,{fleetData:s.GH_FLEET_DATA,storeApi:s.GH_FLEET_STORE,transactionCore:s.GH_TRANSACTION_CORE,planCore:Plan,facilityOf:id=>state.globalBases.find(row=>row.id===id),capacityOf:facility=>s.GH_FACILITY_CORE.assetCapacity(facility),manageReceipts:true,transitionReceipt:delivery=>{delivery.lifecycleRevision=(Number(delivery.lifecycleRevision)||0)+1;return true;},maxSynchronousBaselineRows:10000}),failing={...base,addAsset(asset,meta){base.addAsset(asset,meta);if(added++===3)throw new Error('injected-middle-row-failure');}};
    consume(Plan.applyStages(bound.plan,failing,{budgetMs:.25,clock:(()=>{let n=0;return()=>++n;})()}));return order.requestRef;
  }}),/injected-middle-row-failure/);assert.deepStrictEqual(rollbackSnapshot(env),before);
});

if(results.some(row=>!row.ok)){console.error(JSON.stringify({suite:'build372-asset-purchase-order',results},null,2));process.exitCode=1;}else console.log(JSON.stringify({suite:'build372-asset-purchase-order',scope:'aggregate commercial order, exact allocation, deterministic ranges, SHA-256 command payload, one settlement and atomic rollback',passed:results.length,total:results.length,results},null,2));
