'use strict';

const assert=require('assert');
globalThis.GH_FLEET_STORE=require('../WebApp/fleet-store-core.js');
const Fleet=require('../WebApp/fleet-access-core.js');
const Core=require('../WebApp/asset-purchase-plan-core.js');

const clone=value=>JSON.parse(JSON.stringify(value));
const results=[];
function test(name,fn){try{fn();results.push({name,ok:true});}catch(error){results.push({name,ok:false,error:error.stack||String(error)});}}
const CASES=[
  {mode:'air',ownership:'cash',tab:'new',qty:[1,4,65],specs:{capacity:240,capacityUnit:'راكب',crewPlan:{pilots:8,cabin:13,aeng:3}},price:42850000,leaseMonthly:410000},
  {mode:'sea',ownership:'lease',tab:'used',qty:[7,70],specs:{capacity:4200,capacityUnit:'TEU',crewPlan:{captains:3,sailors:18,seng:5}},price:91000000,leaseMonthly:780000},
  {mode:'road',ownership:'finance',tab:'new',qty:[80],specs:{capacity:24,capacityUnit:'طن',crewPlan:{drivers:3,mech:1}},price:188000,leaseMonthly:4200}
];

function inputFor(row,tag='A'){
  const owner=`${row.mode}-owner`,groups=[];let assetSequence=301,serial=700;
  for(let index=0;index<row.qty.length;index++){
    const qty=row.qty[index],order=`DEL-${tag}-${String(index+1).padStart(8,'0')}`;
    groups.push({qty,assetSequenceStart:assetSequence,serialStart:serial,assetIdPrefix:`N-${owner.toUpperCase()}`,baseId:`BASE-${tag}-${index}`,baseName:`Base ${tag} ${index}`,orderId:order,requestRef:`REQ-${tag}-${index}`,supplier:'Supplier LLC',contractId:`EMP-AUTO-${String(40+index).padStart(8,'0')}`,hiringId:`HR-AUTO-${String(80+index).padStart(8,'0')}`,payment:{kind:'cheque',ref:`CH-${tag}-${index}`,invoiceRef:`INV-${tag}-${index}`,ownerCompanyId:owner,company:owner,amount:row.price*qty},orderedAtSeconds:172801+index,deliveredAtSeconds:172810+index,documentLeadDays:row.tab==='used'?5:120,leadSeconds:500,immediateDelivery:true});
    assetSequence+=qty;serial+=qty;
  }
  return {contextToken:`ctx:${tag}`,ownerCompanyId:owner,assetMode:row.mode,assetClass:`${row.mode}-class`,operationProfileId:`${row.mode}-ops`,companyShortName:`GH ${row.mode.toUpperCase()}`,companyName:`Global ${row.mode}`,tab:row.tab,ownership:row.ownership,simSeconds:172810,item:{id:`CAT-${row.mode}`,icon:`icon-${row.mode}`,name:`Model ${row.mode}`,year:row.tab==='used'?2020:2026,condition:row.tab==='used'?74:100,specs:clone(row.specs),price:row.price,leaseMonthly:row.leaseMonthly},groups};
}
function refStaff(mode,specs){
  const defaults={air:{pilots:10,cabin:16,aeng:4},sea:{captains:2,sailors:16,seng:4},road:{drivers:2,mech:1}}[mode],defs={pilots:['الطيارون',600],cabin:['طاقم الضيافة',130],aeng:['مهندسو الطيران',230],captains:['قباطنة السفن',450],sailors:['بحارة وملاحون',75],seng:['مهندسو السفن',280],drivers:['سائقو الشاحنات',110],mech:['فنيو الصيانة',140]},source=specs.crewPlan&&typeof specs.crewPlan==='object'?specs.crewPlan:defaults,roles=[];
  for(const role of Object.keys(defaults)){const count=Math.max(0,Math.round(Number(source[role])||0));if(!count)continue;const [name,dailyRate]=defs[role];roles.push({id:role,name,dailyRate,count,monthlyPayroll:dailyRate*30*count});}
  return {mode:'automatic-fixed',ready:true,roles,total:roles.reduce((sum,item)=>sum+item.count,0),monthlyPayroll:roles.reduce((sum,item)=>sum+item.monthlyPayroll,0)};
}
function refPending(plan,groupIndex,offset){
  const c=plan.common,item=plan.item,g=plan.groups[groupIndex],sequence=g.assetSequenceStart+offset,serial=g.serialStart+offset;
  return {id:`${g.assetIdPrefix}-${String(sequence).padStart(8,'0')}`,ownerCompanyId:c.ownerCompanyId,assetMode:c.assetMode,assetClass:c.assetClass,operationProfileId:c.operationProfileId,type:c.assetMode,icon:item.icon,name:`${c.companyShortName} ${100+serial}`,catalogId:item.id,routeId:null,baseFacility:g.baseId,progress:0,fuel:100,phase:'delivery',model:item.name,year:item.year,condition:item.condition,specs:clone(item.specs),ownership:c.ownership,monthlyLease:c.ownership==='lease'?item.leaseMonthly:0,leaseTermMonths:c.ownership==='lease'?60:0,leaseStartSeconds:c.ownership==='lease'?c.simSeconds:0,purchasePrice:item.price,deliveryOrderId:g.orderId};
}
function refDelivered(plan,groupIndex,offset){
  const g=plan.groups[groupIndex],asset={...refPending(plan,groupIndex,offset),companyName:plan.common.companyName};
  Object.assign(asset,{ownerCompanyId:plan.common.ownerCompanyId,deliveryOrderId:g.orderId,requestRef:g.requestRef,paymentRef:g.payment.ref,baseFacility:g.baseId,phase:'idle',routeId:null,routeSignature:null,routeSlot:null,departureScheduled:false,progress:0,fuel:100,deliveryStatus:'delivered',deliveredDay:g.deliveredDay,deliveredAtSeconds:g.deliveredAtSeconds});
  asset.staffing={...clone(refStaff(plan.common.assetMode,plan.item.specs)),contractId:g.contractId,provisionedAt:plan.common.simSeconds,center:g.baseName};asset.crewBlocked=false;return asset;
}
function refPendingReceipt(plan,groupIndex){
  const g=plan.groups[groupIndex],assets=Array.from({length:g.qty},(_,offset)=>refPending(plan,groupIndex,offset));
  return {id:g.orderId,deliveryOrderId:g.orderId,status:'pending',payment:clone(g.payment),requestRef:g.requestRef,orderedDay:g.orderedDay,orderedAtSeconds:g.orderedAtSeconds,dueDay:g.dueDay,dueAtSeconds:g.dueAtSeconds,contractLeadDays:g.documentLeadDays,immediateDelivery:g.immediateDelivery,ownerCompanyId:plan.common.ownerCompanyId,assetMode:plan.common.assetMode,assetClass:plan.common.assetClass,type:plan.common.assetMode,catalogId:plan.item.id,baseId:g.baseId,destination:g.baseName,supplier:g.supplier,count:g.qty,assetIds:assets.map(asset=>asset.id),assets};
}
function refDeliveredReceipt(plan,groupIndex){
  // The current Realism owner compacts the original procurement snapshots;
  // live delivered/staffed assets are separate Fleet Store rows.
  const g=plan.groups[groupIndex],row=refPendingReceipt(plan,groupIndex),assets=Array.from({length:g.qty},(_,offset)=>refPending(plan,groupIndex,offset));
  row.status='delivered';row.deliveredDay=g.deliveredDay;row.deliveredAtSeconds=g.deliveredAtSeconds;row.assets=assets;row.count=assets.length;row.assetIds=assets.map(asset=>asset.id);row.assetId=assets.length===1?assets[0].id:null;row.assetName=assets[0].name;row.purchasePrice=assets.reduce((sum,asset)=>sum+(Number(asset.purchasePrice)||0),0);Fleet.compactReceipt(row);return row;
}
function refContract(plan,groupIndex){
  const g=plan.groups[groupIndex],assets=Array.from({length:g.qty},(_,offset)=>refPending(plan,groupIndex,offset)),ids=assets.map(asset=>asset.id),assetIds=Fleet.idLists.of(ids),staff=refStaff(plan.common.assetMode,plan.item.specs),first=assets[0];
  return {id:g.contractId,company:plan.common.ownerCompanyId,ownerCompanyId:plan.common.ownerCompanyId,assetId:ids[0],assetIds,deliveryOrderId:g.orderId,assetCount:ids.length,name:`طاقم ثابت · ${first.name}${ids.length>1?` + ${ids.length-1}`:''}`,role:'طاقم تشغيلي مرتبط بدفعة الأصول',count:staff.total*ids.length,center:g.baseName,salary:staff.monthlyPayroll*ids.length,startDay:Math.floor(plan.common.simSeconds/86400),termMonths:1200,status:'ساري',source:'توظيف آلي ثابت عند شراء دفعة الأصول',automaticAssetStaffing:true,permanent:true};
}
function refHiring(plan,groupIndex){const g=plan.groups[groupIndex],contract=refContract(plan,groupIndex);return {id:g.hiringId,at:plan.common.simSeconds,company:plan.common.ownerCompanyId,source:'توظيف دفعة أصول آلي ثابت',deliveryOrderId:g.orderId,assetIds:contract.assetIds,total:contract.count,monthlyPayroll:contract.salary,coverageBefore:100,coverageAfter:100};}
function repeated(value,count){let total=0;for(let index=0;index<count;index++)total+=value;return total;}
function refSummary(plan){const unit=plan.item.price*(plan.common.ownership==='lease'?.08:.86),groupValueDeltas=plan.groups.map(group=>repeated(unit,group.qty));return {count:plan.count,groups:plan.groups.length,purchasePrice:plan.item.price*plan.count,groupValueDelta:groupValueDeltas.reduce((sum,value)=>sum+value,0),groupValueDeltas,crew:{roles:Object.fromEntries(plan.baseStaffing.roles.map(role=>[role.id,role.count*plan.count])),total:plan.baseStaffing.total*plan.count,monthlyPayroll:plan.baseStaffing.monthlyPayroll*plan.count}};}

test('compact plan and every materialized value match the current owners',()=>{
  for(let caseIndex=0;caseIndex<CASES.length;caseIndex++){
    const plan=Core.prepare(inputFor(CASES[caseIndex],String(caseIndex)));assert.equal(Core.validate(plan,{contextToken:`ctx:${caseIndex}`}),true);
    assert.deepStrictEqual(plan.baseStaffing,refStaff(plan.common.assetMode,plan.item.specs));
    for(let groupIndex=0;groupIndex<plan.groups.length;groupIndex++){
      const group=plan.groups[groupIndex];for(const offset of [...new Set([0,Math.floor(group.qty/2),group.qty-1])]){assert.deepStrictEqual(Core.pendingAsset(plan,groupIndex,offset),refPending(plan,groupIndex,offset));assert.deepStrictEqual(Core.deliveredAsset(plan,groupIndex,offset),refDelivered(plan,groupIndex,offset));}
      assert.deepStrictEqual(Core.pendingReceipt(plan,groupIndex),refPendingReceipt(plan,groupIndex));
      assert.deepStrictEqual(Core.deliveredReceipt(plan,groupIndex),refDeliveredReceipt(plan,groupIndex));
      assert.deepStrictEqual(Core.employmentContract(plan,groupIndex),refContract(plan,groupIndex));assert.deepStrictEqual(Core.hiringRecord(plan,groupIndex),refHiring(plan,groupIndex));
    }
    assert.deepStrictEqual(Core.summary(plan),refSummary(plan));
  }
});

test('compact id lists match the owner across the eight-digit boundary',()=>{
  const source=inputFor({...CASES[0],qty:[80]},'ID-RANGE');source.groups[0].assetSequenceStart=9999970;const plan=Core.prepare(source),ids=Array.from({length:80},(_,index)=>Core.assetId(plan,0,index));
  assert.deepStrictEqual(Core.employmentContract(plan,0).assetIds,Fleet.idLists.of(ids));assert.deepStrictEqual(Core.deliveredReceipt(plan,0).assetIds,Fleet.idLists.of(ids));
  source.groups[0].assetSequenceStart=0xFFFFFFFF-10;assert.throws(()=>Core.prepare(source),/asset-sequence-range/);
});

test('asset values are independent while the plan stays compact',()=>{
  const source=inputFor(CASES[0],'COMPACT');source.groups=[{...source.groups[0],qty:1000000}];const plan=Core.prepare(source),bytes=Buffer.byteLength(JSON.stringify(plan));
  assert(bytes<12000,`one-million plan unexpectedly large: ${bytes}`);const a=Core.deliveredAsset(plan,0,0),b=Core.deliveredAsset(plan,0,1);a.specs.capacity=1;a.staffing.roles[0].count=999;assert.equal(b.specs.capacity,240);assert.equal(b.staffing.roles[0].count,8);assert.equal(plan.item.specs.capacity,240);
});

test('fingerprint and exact context reject a changed or stale plan',()=>{
  const plan=Core.prepare(inputFor(CASES[1],'GUARD')),changed=structuredClone(plan);changed.item.price++;
  assert.equal(Core.validate(changed),false);assert.equal(Core.validate(plan,{contextToken:'wrong'}),false);assert.equal(Core.validate(plan,{contextToken:'ctx:GUARD'}),true);
});

function targetAdapter(target,{failAt=-1,clockAdvance=null}={}){
  let added=0;
  return {
    begin(){return clone(target);},
    addAsset(asset){target.assets.push(asset);if(clockAdvance)clockAdvance();if(added++===failAt)throw new Error(`injected-${failAt}`);},
    finishGroup(_group,_index,out){target.receipts.push(out.receipt);target.contracts.unshift(out.contract);target.hiring.unshift(out.hiring);},
    applyCrewDelta(delta){for(const [role,count] of Object.entries(delta.roles))target.crew[role]=(target.crew[role]||0)+count;},
    finish(value){target.summary=value;},
    rollback(snapshot){for(const key of Object.keys(target))delete target[key];Object.assign(target,clone(snapshot));target.rollbacks=(target.rollbacks||0)+1;},
    commit(){target.commits=(target.commits||0)+1;}
  };
}
function consume(iterator,onYield=()=>{}){let step;while(!(step=iterator.next()).done)onYield(step.value);return step.value;}

test('atomic staged apply matches the reference and keeps measured slices at four milliseconds',()=>{
  const fixture={...CASES[0],qty:[91,83,79]},plan=Core.prepare(inputFor(fixture,'APPLY')),target={assets:[{id:'existing'}],receipts:[],contracts:[{id:'old'}],hiring:[{id:'old-h'}],crew:{pilots:17,cabin:20,aeng:4}},expected=clone(target);let clock=0;
  for(let groupIndex=0;groupIndex<plan.groups.length;groupIndex++){
    for(let offset=0;offset<plan.groups[groupIndex].qty;offset++)expected.assets.push(refDelivered(plan,groupIndex,offset));expected.receipts.push(refDeliveredReceipt(plan,groupIndex));expected.contracts.unshift(refContract(plan,groupIndex));expected.hiring.unshift(refHiring(plan,groupIndex));
  }
  const delta=Core.crewDelta(plan);for(const [role,count] of Object.entries(delta.roles))expected.crew[role]=(expected.crew[role]||0)+count;expected.summary=Core.summary(plan);expected.commits=1;
  const yields=[],out=consume(Core.applyStages(plan,targetAdapter(target,{clockAdvance:()=>{clock+=.6;}}),{budgetMs:3.5,clock:()=>clock}),row=>yields.push(row));
  assert.deepStrictEqual(target,expected);assert.deepStrictEqual(out,Core.summary(plan));assert(yields.length>20);assert(Math.max(...yields.map(row=>row.elapsedMs))<=4,`slice exceeded 4 ms: ${Math.max(...yields.map(row=>row.elapsedMs))}`);
});

test('first, middle, last and explicit abort all roll back byte-identically',()=>{
  const fixture={...CASES[2],qty:[23,19]},plan=Core.prepare(inputFor(fixture,'ROLLBACK')),total=plan.count;
  for(const failAt of [0,Math.floor(total/2),total-1]){
    const target={assets:[{id:'keep'}],receipts:[{id:'keep-r'}],contracts:[],hiring:[],crew:{drivers:11,mech:4}},before=JSON.stringify(target);assert.throws(()=>consume(Core.applyStages(plan,targetAdapter(target,{failAt}),{budgetMs:.25,clock:(()=>{let n=0;return()=>++n;})()})),new RegExp(`injected-${failAt}`));const rollbacks=target.rollbacks;delete target.rollbacks;assert.equal(JSON.stringify(target),before);assert.equal(rollbacks,1);
  }
  const target={assets:[],receipts:[],contracts:[],hiring:[],crew:{}},before=JSON.stringify(target),iterator=Core.applyStages(plan,targetAdapter(target),{budgetMs:.25,clock:(()=>{let n=0;return()=>++n;})()});assert.equal(iterator.next().done,false);iterator.return();const rollbacks=target.rollbacks;delete target.rollbacks;assert.equal(JSON.stringify(target),before);assert.equal(rollbacks,1);
});

test('staffing products outside the exact integer domain are rejected during planning',()=>{
  const input=inputFor({...CASES[0],qty:[2]},'STAFF-RANGE');input.item.specs.crewPlan.pilots=Number.MAX_SAFE_INTEGER;assert.throws(()=>Core.prepare(input),/asset-purchase-plan-staffing-range/);
});

if(results.some(row=>!row.ok)){console.error(JSON.stringify({suite:'build372-asset-purchase-plan',results},null,2));process.exitCode=1;}else console.log(JSON.stringify({suite:'build372-asset-purchase-plan',scope:'pure compact planning, exact procurement/delivery/staffing parity, four-millisecond staged apply and rollback',passed:results.length,total:results.length,results},null,2));
