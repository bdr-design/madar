'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Transaction=require('../WebApp/transaction-core.js');
const Fleet=require('../WebApp/fleet-core.js');
const APP=fs.readFileSync(path.join(__dirname,'../WebApp/app.js'),'utf8');

globalThis.GH_FINANCE_CORE={execute({state},command,payload){
  state.finance=state.finance||{credits:[],spends:[]};
  if(command==='credit'){state.finance.credits.push({company:payload.company,amount:payload.amount,note:payload.note,counterparty:payload.counterparty});return {ok:true};}
  if(command==='spend'){state.finance.spends.push({company:payload.company,amount:payload.amount,note:payload.note,line:payload.line});return {ok:true};}
  throw new Error(`unexpected-finance-command:${command}`);
}};
globalThis.GH_CORPORATE_CORE={execute({state},command,payload){if(command!=='adjust-group-value')throw new Error(`unexpected-corporate-command:${command}`);state.groupValue+=payload.delta;return state.groupValue;}};

function fixture(count,{mixed=true}={}){
  const contracts=[],assets=[],leasedAssets=[];
  for(let index=0;index<count;index++){
    const id=`SALE-${String(index).padStart(6,'0')}`,lease=mixed&&index%7===0,moving=mixed&&index%11===0,returning=mixed&&!moving&&index%13===0;
    assets.push({id,name:`Aircraft ${index}`,type:'air',ownerCompanyId:'air',ownership:lease?'lease':'owned',phase:moving?'moving':returning?'turnaround':'idle',routeId:moving||returning?'ROUTE-SALE':null,baseFacility:'BASE-SALE',salePending:false,monthlyLease:lease?5000:0,purchasePrice:1000000,condition:80,staffing:{mode:'automatic-fixed',ready:true,contractId:`EMP-${id}`,roles:[{id:'pilots',count:2}]}});
    contracts.push({id:`EMP-${id}`,assetId:id,ownerCompanyId:'air',company:'air',status:'ساري',automaticAssetStaffing:true,count:2,salary:18000});
    if(lease)leasedAssets.push(id);
  }
  return {simSeconds:172800,assets,leasedAssets,crew:Object.keys(Fleet.ROLE_DEFAULTS).map(id=>({id,count:777})),advanced:{labor:{employmentContracts:contracts,hiringLog:[]}},finance:{credits:[],spends:[]},groupValue:1000000};
}
function disposalRows(state){return state.assets.filter(asset=>!asset.salePending).map(asset=>({id:asset.id,proceeds:Math.max(0,(Number(asset.purchasePrice)||1000000)*.72*(Number(asset.condition||100)/100)),fee:asset.ownership==='lease'?Math.max(0,(Number(asset.monthlyLease)||0)*2):0,atOwnedCenter:!(asset.phase==='turnaround'&&asset.routeId),buyer:'Approved asset buyers'}));}
function applyOne(state,row){return Fleet.execute({state},'dispose',row);}
function legacyApply(state,rows){const result={sold:0,scheduled:0,returned:0};for(const row of rows){const outcome=applyOne(state,row);if(outcome.status==='sold')result.sold++;else if(outcome.status==='returned')result.returned++;else result.scheduled++;}return result;}
function batchedApply(state,rows){return Fleet.withDisposalBatch(state,()=>{const result={sold:0,scheduled:0,returned:0};for(const row of rows){const outcome=applyOne(state,row);if(outcome.status==='sold')result.sold++;else if(outcome.status==='returned')result.returned++;else result.scheduled++;}return result;});}

{
  const legacy=fixture(240),optimized=fixture(240),rows=disposalRows(legacy),expected=legacyApply(legacy,rows);
  const outer=Transaction.execute(optimized,{label:'fleet-disposal-batch-test',apply:()=>batchedApply(optimized,rows)});
  // Owner («بيع الاصول مايشتغل»): a bulk sale is one order, so each company's proceeds are credited once and its lease
  // fees paid once (an invoice per asset froze a large fleet's sale for minutes). Everything else is as one by one, and
  // the money is the same to the cent.
  const sum=(rows,key)=>Math.round(rows.reduce((n,row)=>n+row.amount,0)*100)/100;
  assert.equal(outer.committed,true);assert.deepEqual(outer.value,expected);
  assert.deepEqual({...optimized,finance:null},{...legacy,finance:null},'batch removal must preserve per-asset outcomes, contracts, crew totals, leased assets, group value and stable fleet order');
  assert.equal(optimized.finance.credits.length,1,'one credit for the order');assert.equal(optimized.finance.spends.length,1,'one payment of the lease fees');
  assert.equal(optimized.finance.credits[0].amount,sum(legacy.finance.credits),'the same proceeds');assert.equal(optimized.finance.spends[0].amount,sum(legacy.finance.spends),'the same fees');
  assert.equal(optimized.finance.spends[0].line,'capex');assert.match(optimized.finance.credits[0].note,/^بيع \d+ أصل بأمر بيع جماعي$/);
  const metric=Transaction.telemetry().last;assert.equal(metric.label,'fleet-disposal-batch-test');assert.equal(metric.rollbackStorage,'full-snapshot');assert.equal(metric.committed,true,'the coalesced owner write retains Full Snapshot rollback');
}

{
  const state=fixture(64),before=structuredClone(state),rows=disposalRows(state).slice(0,20);
  assert.throws(()=>Transaction.execute(state,{label:'fleet-disposal-batch-rollback',apply:()=>Fleet.withDisposalBatch(state,()=>{for(const row of rows.slice(0,8))applyOne(state,row);throw new Error('injected-after-sale');})}),/injected-after-sale/);
  assert.deepEqual(state,before,'a fault after partial sale writes restores every root and asset under a full snapshot');
  assert.equal(Transaction.telemetry().last.rollbackStorage,'full-snapshot');
}

{
  const state=fixture(20000,{mixed:false}),rows=disposalRows(state),started=performance.now();let outcome;
  const tx=Transaction.execute(state,{label:'fleet-disposal-batch-20k',apply:()=>{outcome=batchedApply(state,rows);return outcome;}});
  assert.equal(tx.committed,true);assert.deepEqual(outcome,{sold:20000,scheduled:0,returned:0});assert.equal(state.assets.length,0);assert.equal(state.finance.credits.length,1);assert.equal(state.advanced.labor.employmentContracts.every(row=>row.status==='منتهي'),true);assert.equal(state.crew.find(row=>row.id==='pilots').count,0);
  console.log(JSON.stringify({suite:'build340-fleet-disposal-batch',assets:20000,nodeElapsedMs:+(performance.now()-started).toFixed(2),fullSnapshot:Transaction.telemetry().last.rollbackStorage,financeRecordsForTheOrder:state.finance.credits.length,environment:`Node ${process.version}; synthetic fleet state; not iPhone performance`}));
}

{
  const start=APP.indexOf('  async function sellAllAssets(companyInput){'),end=APP.indexOf('\n  function sellAsset(id)',start),source=APP.slice(start,end);
  assert(start>=0&&end>start);assert.match(source,/GH_TRANSACTION_CORE\.execute\(draft/);assert.match(source,/GH_FLEET_CORE\.withDisposalBatch\(draft/);assert.match(source,/dispatch\('fleet','dispose-company'/,'one fleet command for the order');assert.doesNotMatch(source,/dispatch\('fleet','dispose',/,'not one command per asset');assert.doesNotMatch(source,/draft\.assets\.find\(/);assert.doesNotMatch(source,/dynamicFacilitiesFor\(draft\)\.find\(/);
}

console.log('PASS bulk disposal uses one indexed Fleet context and one full-snapshot transaction, settles each company once with the same money, and rolls back whole');
