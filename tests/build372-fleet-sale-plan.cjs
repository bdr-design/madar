'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const STORE=require(path.join(ROOT,'WebApp','fleet-store-core.js')),FLEET=require(path.join(ROOT,'WebApp','fleet-access-core.js')),PLAN=require(path.join(ROOT,'WebApp','fleet-sale-plan-core.js'));
const catalog={air:{new:[{id:'jet',price:1000000,residual5y:61.5}],used:[{id:'old',price:350000,residual5y:42}]},sea:{new:[{id:'ship',price:9000000,residual5y:55}],used:[]},road:{new:[],used:[]}};
const assets=[
  {id:'A0',ownerCompanyId:'sky',assetMode:'air',type:'air',catalogId:'jet',purchasePrice:800000,year:2024,condition:93,phase:'idle'},
  {id:'A1',companyId:'sky',assetMode:'air',type:'air',catalogId:'jet',purchasePrice:0,year:2020,condition:70,phase:'moving'},
  {id:'A2',ownerCompanyId:'sky',assetMode:'air',type:'air',catalogId:'old',purchasePrice:200000,year:2018,condition:45,phase:'moving',salePending:true},
  {id:'A3',ownerCompanyId:'sky',assetMode:'air',type:'air',catalogId:'missing',purchasePrice:'125000.5',year:'2022',condition:null,phase:'turnaround'},
  {id:'A4',ownerCompanyId:'sky',assetMode:'air',type:'air',catalogId:'jet',ownership:'lease',monthlyLease:12000,condition:100,phase:'idle'},
  {id:'S0',ownerCompanyId:'marine',assetMode:'sea',type:'sea',catalogId:'ship',condition:90,phase:'idle'},
  {id:'R0',assetMode:'road',type:'road',catalogId:'truck',purchasePrice:50000,condition:80,phase:'idle'}
];
const state={simSeconds:86400*400,resetEpoch:7,fleet:STORE.fromAssets(assets,{at:0})},legacyOwner={air:'sky',sea:'marine',road:'roads'};
function item(type,id,source=catalog){const section=source[type];return section?[...(section.new||[]),...(section.used||[])].find(row=>row.id===id)||null:null;}
function estimate(row,source=catalog){if(row.ownership==='lease')return -(Number(row.monthlyLease)||0)*2;const found=item(row.type,row.catalogId,source),basis=Number(row.purchasePrice)||Number(found?.price)||1000000,residual=Math.max(.15,Math.min(.95,(Number(found?.residual5y)||60)/100)),built=Number(row.year)||2026,age=Math.max(0,2026+state.simSeconds/(365*86400)-built),value=Number(row.purchasePrice)?basis*Math.pow(residual,Math.max(0,age-Math.max(0,2026-built))/5):basis*Math.pow(residual,age/5);return value*(.7+.3*Math.max(0,Math.min(100,Number(row.condition??100)))/100);}
const owner=row=>String(row.ownerCompanyId||row.companyId||legacyOwner[row.assetMode||row.type]||'').trim(),views=[];FLEET.forEach(state,(row,index)=>views.push([row,index]));
const wanted=views.filter(([row])=>owner(row)==='sky'&&!row.salePending),wantedIndices=wanted.map(([,index])=>index),wantedMoving=wanted.filter(([row])=>row.phase==='moving').length,wantedEstimate=wanted.reduce((sum,[row])=>sum+Math.max(0,estimate(row)),0);
const stamp=PLAN.capture(state,FLEET,{companyId:'sky',requestToken:'sell-click-1',catalogToken:'cat-1',ownerToken:'owners-1'}),result=PLAN.plan(state,FLEET,{companyId:'sky',catalog,legacyOwner,request:PLAN.serializableCapture(stamp)});
assert.equal(PLAN.validPlan(result),true);assert.deepEqual([...result.indices],wantedIndices);assert.equal(result.selected,wanted.length);assert.equal(result.moving,wantedMoving);assert.ok(Object.is(result.estimated,wantedEstimate),'sale estimate preserves row-order arithmetic');
assert.equal(PLAN.current(stamp,state,FLEET,{catalog,result,requestToken:'sell-click-1',catalogToken:'cat-1',ownerToken:'owners-1'}),true);assert.deepEqual([...PLAN.chunks(result,2)].map(rows=>[...rows]),[wantedIndices.slice(0,2),wantedIndices.slice(2,4)]);assert.deepEqual([...PLAN.reverseChunks(result,2)].map(rows=>[...rows]),[wantedIndices.slice(-2),wantedIndices.slice(0,-2)],'removal chunks start at the highest stable rows');assert.deepEqual(PLAN.transferables(result),[result.indices.buffer]);
const changedCatalog=structuredClone(catalog);changedCatalog.air.new[0].price++;
assert.equal(PLAN.current(stamp,state,FLEET,{catalog:changedCatalog,result,requestToken:'sell-click-1',catalogToken:'cat-1',ownerToken:'owners-1'}),false,'consulted catalog values are exact dependencies');
state.simSeconds++;assert.equal(PLAN.current(stamp,state,FLEET,{catalog,result}),false,'valuation time invalidates the plan');state.simSeconds--;
STORE.set(state.fleet,0,'salePending',true);assert.equal(PLAN.current(stamp,state,FLEET,{catalog,result}),false,'a fleet write invalidates the plan');STORE.set(state.fleet,0,'salePending',false);
assert.equal(PLAN.validPlan({...result,indices:new Uint32Array([result.sourceLength]),selected:1,moving:0}),false,'out-of-range indices fail closed');
assert.equal(PLAN.validPlan({...result,estimated:Infinity}),false,'non-finite money fails closed');
const unresolved=PLAN.plan({simSeconds:0,assets:[{id:'X',assetMode:'mystery',type:'mystery'}]},{scan(s,f,fn){s.assets.forEach(fn);},scanLength:s=>s.assets.length},{companyId:'sky',catalog,legacyOwner});assert.equal(unresolved.legacy,true,'unresolved legacy ownership cannot authorize a sale');

// Mutation gate: if salePending is no longer excluded, A2 enters the plan and
// the same differential selector assertion fails.
{
  const source=fs.readFileSync(path.join(ROOT,'WebApp','fleet-sale-plan-core.js'),'utf8'),needle='if(owner(row)!==companyId||row.salePending)return;',mutated=source.replace(needle,'if(owner(row)!==companyId||false)return;');assert.notEqual(mutated,source,'salePending mutation applied');
  const box={module:{exports:{}},exports:{},structuredClone,console};box.globalThis=box;vm.createContext(box);vm.runInContext(mutated,box,{filename:'fleet-sale-plan-core.mutant.js'});const mutant=box.module.exports;
  const assertSelection=api=>assert.deepEqual([...api.plan(state,FLEET,{companyId:'sky',catalog,legacyOwner,request:PLAN.serializableCapture(stamp)}).indices],wantedIndices);
  assertSelection(PLAN);assert.throws(()=>assertSelection(mutant),assert.AssertionError);
}
console.log(JSON.stringify({ok:true,selected:result.selected,moving:result.moving,estimated:+result.estimated.toFixed(2),mutation:true}));
