'use strict';
// The owner's iPhone save holds consolidated cash near 2.5e14. Above 2^47 one ULP is 0.03125, more than the 0.01
// tolerance of FINANCE_CONSOLIDATED_CASH_MISMATCH, and integrity summed the company balances alphabetically while
// reconcile (which writes state.cash) sums them in the finance company order. Order alone then produced a critical
// mismatch that rejected correct settlements. Proven here against the previous integrity-core.js in an isolated process:
//  1. a reconciled state whose two summation orders differ is clean now and was critical before;
//  2. a real difference of one cent above 2^47 is still reported, and so is one dollar;
//  3. no balance, cash value or reconcile result is changed by the check.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {scenario}=require(path.join(ROOT,'tests/helpers/business-scenario'));

function run(){
  const e=scenario(),{s,state}=e,F=s.GH_FINANCE_CORE,I=s.GH_INTEGRITY_CORE;
  state.godMoney=true;state.infiniteMoney=true;for(const type of ['sea','road'])e.command('corporate','open-company',{type,capital:500000000,legalName:'Test '+type});state.godMoney=false;state.infiniteMoney=false;
  const ids=F.companyIds(state).filter(id=>state.companyFinance[id]?.accounts?.length),alpha=[...ids].sort();
  assert.ok(ids.length>=3,'several books');assert.notDeepEqual(ids,alpha,'the finance order is not alphabetical');
  // Deterministic search for balances above 2^47 whose sums differ only by order.
  let seed=7;const next=()=>(seed=(seed*1103515245+12345)%2147483648)/2147483648;let found=null;
  for(let attempt=0;attempt<5000&&!found;attempt++){
    const values=Object.fromEntries(ids.map(id=>[id,Math.round((1.5e14+next()*3e13)*100)/100+next()]));
    let a=0;for(const id of ids)a+=values[id];let b=0;for(const id of alpha)b+=values[id];
    if(Math.abs(a-b)>.01)found=values;
  }
  assert.ok(found,'balances whose order-only difference exceeds the tolerance exist');
  for(const id of ids){const accounts=state.companyFinance[id].accounts;accounts[0].balance=found[id];for(const extra of accounts.slice(1))extra.balance=0;}
  F.reconcile(state);const reconciled=state.cash,snapshot=JSON.stringify(state.companyFinance);
  const codes=target=>I.check(target).issues.filter(row=>row.id==='FINANCE_CONSOLIDATED_CASH_MISMATCH').map(row=>row.details||row.detail||row.id);
  const out={orderOnly:codes(state).length};
  assert.equal(state.cash,reconciled,'the check does not write cash');assert.equal(JSON.stringify(state.companyFinance),snapshot,'the check does not write balances');
  const ulp=2**(Math.floor(Math.log2(reconciled))-52);out.ulp=ulp;state.cash=reconciled+2*ulp;assert.ok(state.cash-reconciled>.01,'two ULPs exceed the cent tolerance here');out.oneUlpPair=codes(state).length;
  state.cash=reconciled+1;out.oneDollar=codes(state).length;
  state.cash=reconciled;
  return out;
}

if(process.env.GH_CASH_ORDER_CHILD==='1'){process.stdout.write(JSON.stringify(run()));return;}

const current=run();
assert.equal(current.orderOnly,0,'a reconciled state is not reported for summation order');
assert.equal(current.oneUlpPair,1,'a real two-ULP difference above 2^47 is still critical');
assert.equal(current.oneDollar,1,'a one-dollar difference is still critical');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'madar-cash-order-old-'));
try{
  fs.cpSync(path.join(ROOT,'WebApp'),path.join(tmp,'WebApp'),{recursive:true});fs.cpSync(path.join(ROOT,'tests'),path.join(tmp,'tests'),{recursive:true});
  const previous=execFileSync('git',['-C',process.env.GH_CASH_ORDER_GIT_DIR||ROOT,'show','42ecded:WebApp/integrity-core.js'],{encoding:'utf8',maxBuffer:16*1024*1024});
  assert.ok(previous.includes('const expected=balances.reduce((n,v)=>n+v,0)'),'the baseline is the alphabetical sum');
  fs.writeFileSync(path.join(tmp,'WebApp','integrity-core.js'),previous);
  const old=JSON.parse(execFileSync(process.execPath,[__filename],{env:{...process.env,GH_TEST_SOURCE_DIR:tmp,GH_CASH_ORDER_CHILD:'1'},encoding:'utf8'}));
  assert.equal(old.orderOnly,1,'the previous check reported the reconciled state (false positive reproduced)');
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
console.log(JSON.stringify({suite:'build502-consolidated-cash-order',ok:true,current}));
