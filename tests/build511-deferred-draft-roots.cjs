'use strict';
// Emulated phone, operating world (3,000 Mobility vehicles, 4x CPU): Mobility was 81.5 of the 100.8 ms copy of every
// player command although bank, telecom, staffing, governance and finance commands never touch it. A durable draft now
// defers Mobility: copied on its first read or write during the command, shared with the live state when never touched.
// Proven here against the full copy, with the real transaction core:
//  1. an untouched deferred root is the live object after settleDeferredRoots, and the draft text (key order included)
//     is identical to a full copy's;
//  2. a read, a write, an assignment and a delete during the command each give the full-copy result, and the live state
//     is unchanged until publication;
//  3. executeDurable saves a draft whose text equals a full-copy draft's, publishes the result only after the ACK, keeps
//     the live Mobility object, and leaves the live state untouched when the save is refused;
//  4. a copy made without a host yield (no slicing) defers nothing, both durable paths settle right after apply, and only
//     the decisions measured never to read Mobility defer it (HR hiring counts vehicles per center: copied up front).
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
global.window=global;const T=require(path.join(ROOT,'WebApp/transaction-core.js'));
const world=()=>({saveRevision:4,simSeconds:3600,lastPanel:'bank',mobility:{status:'active',vehicles:[{id:'MV-1',status:'idle',coords:[46.7,24.7]},{id:'MV-2',status:'moving',coords:[46.6,24.8]}],drivers:[{id:'DR-1',status:'online'}],kpis:{completed:3}},bank:{requests:[{id:'R-1',status:'open'},{id:'R-2',status:'open'}]},finance:{invoices:[{id:'INV-1',amount:10}]},openedCompanies:['bank','mobility']});
const yieldToHost=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=draft=>typeof Object.getOwnPropertyDescriptor(draft,'mobility')?.get==='function';
(async()=>{
  assert.deepEqual([...T.DURABLE_DEFERRED_ROOTS],['mobility']);
  // 1. Untouched.
  {const live=world(),full=JSON.stringify(T.deepClone(live,{shareJournaledRoots:true})),draft=await T.deepCloneInSlices(live,{shareJournaledRoots:true,deferRoots:T.DURABLE_DEFERRED_ROOTS,yieldToHost});
    assert.equal(deferred(draft),true,'Mobility is not copied with the draft');assert.deepEqual(Object.keys(draft),Object.keys(live),'the root order is kept');
    draft.bank.requests[0].status='approved';assert.equal(live.bank.requests[0].status,'open','other roots are still copies');
    const settled=T.settleDeferredRoots(draft);assert.deepEqual(settled,{shared:1,copied:0,copyMs:0});assert.equal(draft.mobility,live.mobility,'the untouched root is the live object');
    assert.equal(deferred(draft),false);assert.equal(JSON.stringify({...JSON.parse(JSON.stringify(draft)),bank:JSON.parse(full).bank}),full,'the draft text equals a full copy');
    assert.deepEqual(T.settleDeferredRoots(draft),{shared:0,copied:0,copyMs:0},'settling twice does nothing');}
  // 2. Touched: read, nested write, assignment, delete.
  for(const [name,touch,expect] of [
    ['read',draft=>void draft.mobility.vehicles.length,live=>live.mobility],
    ['write',draft=>{draft.mobility.vehicles[0].status='reserved';},live=>({...live.mobility,vehicles:[{...live.mobility.vehicles[0],status:'reserved'},live.mobility.vehicles[1]]})],
    ['assign',draft=>{draft.mobility={status:'not-launched',vehicles:[]};},()=>({status:'not-launched',vehicles:[]})],
    ['delete',draft=>{delete draft.mobility;},()=>undefined]]){
    const live=world(),before=JSON.stringify(live),draft=await T.deepCloneInSlices(live,{shareJournaledRoots:true,deferRoots:T.DURABLE_DEFERRED_ROOTS,yieldToHost}),wanted=expect(world());
    touch(draft);const settled=T.settleDeferredRoots(draft);
    assert.equal(settled.shared,0,`${name}: a touched root is never shared`);assert.equal(settled.copied,name==='read'||name==='write'?1:0,`${name}: copied once when read`);
    assert.notEqual(draft.mobility,live.mobility,`${name}: the draft holds its own Mobility`);assert.deepEqual(draft.mobility,wanted,`${name}: the full-copy result`);
    assert.equal(JSON.stringify(live),before,`${name}: the live state is unchanged`);
    assert.deepEqual(Object.keys(draft),name==='delete'?Object.keys(live).filter(key=>key!=='mobility'):Object.keys(live),`${name}: the root order is kept`);}
  // 3. executeDurable: save, publish, refusal.
  const durable=async(apply,{refuse=false,label='banking:qa-deferred'}={})=>{
    const live=world(),liveMobility=live.mobility,events=[];let saved=null,savedShares=null;
    const run=T.executeDurable(live,{label,yieldToHost,integrity:false,apply,persist:async draft=>{saved=JSON.stringify(draft);savedShares=draft.mobility===liveMobility;events.push(['persist',JSON.stringify(live)===JSON.stringify(world())]);if(refuse)return {ok:false,reason:'qa-refused'};return {ok:true};}});
    let out=null,error=null;try{out=await run;}catch(caught){error=caught;}
    return {live,liveMobility,saved,savedShares,events,out,error,sample:T.telemetry().lastDurable};
  };
  const expected=apply=>{const draft=T.deepClone(world(),{shareJournaledRoots:true});apply(draft);draft.saveRevision=5;return JSON.stringify(draft);};
  const approve=draft=>{draft.bank.requests[1].status='approved';draft.finance.invoices.push({id:'INV-2',amount:4});};
  {const r=await durable(approve);assert.equal(r.error,null);assert.equal(r.savedShares,true,'the saved draft holds the live Mobility');assert.equal(r.saved,expected(approve),'the saved text equals a full-copy draft');
    assert.deepEqual(r.events,[['persist',true]],'nothing is published before the ACK');assert.equal(r.live.mobility,r.liveMobility,'publication keeps the live Mobility object');
    assert.equal(r.live.bank.requests[1].status,'approved');assert.equal(r.live.saveRevision,5);assert.equal(r.sample.deferredShared,1);assert.equal(r.sample.deferredCopied,0);}
  const dispatchCar=draft=>{draft.mobility.vehicles[1].status='idle';draft.mobility.kpis.completed++;draft.bank.requests[0].status='approved';};
  {const r=await durable(dispatchCar);assert.equal(r.error,null);assert.equal(r.savedShares,false,'a command that writes Mobility saves its own copy');assert.equal(r.saved,expected(dispatchCar));
    assert.deepEqual(r.events,[['persist',true]]);assert.equal(r.live.mobility.vehicles[1].status,'idle');assert.equal(r.live.mobility.kpis.completed,4);assert.equal(r.sample.deferredCopied,1);assert.equal(r.sample.deferredShared,0);}
  {const r=await durable(dispatchCar,{label:'hr:qa-copied'});assert.equal(r.error,null);assert.equal(r.savedShares,false);assert.equal(r.saved,expected(dispatchCar));assert.equal(r.sample.deferredShared,0,'a command outside the measured set copies Mobility with the draft');assert.equal(r.sample.deferredCopied,0);assert.equal(r.live.mobility.kpis.completed,4);}
  for(const apply of [approve,dispatchCar]){const r=await durable(apply,{refuse:true});assert.match(String(r.error?.message),/qa-refused/);assert.equal(JSON.stringify(r.live),JSON.stringify(world()),'a refused save leaves the live state untouched');assert.equal(r.live.mobility,r.liveMobility);}
  // 4. No host yield: a plain full copy; both durable paths settle right after apply.
  {const live=world(),draft=await T.deepCloneInSlices(live,{shareJournaledRoots:true,deferRoots:T.DURABLE_DEFERRED_ROOTS});assert.equal(deferred(draft),false);assert.notEqual(draft.mobility,live.mobility);assert.deepEqual(T.settleDeferredRoots(draft),{shared:0,copied:0,copyMs:0});}
  const tx=fs.readFileSync(path.join(ROOT,'WebApp/transaction-core.js'),'utf8'),app=fs.readFileSync(path.join(ROOT,'WebApp/app.js'),'utf8');
  assert.match(tx,/const value=await options\.apply\(draft,context\);\{const deferred=settleDeferredRoots\(draft\);/,'executeDurable settles right after apply');
  assert.match(app,/const value=await apply\(\{state:draft,routes:runtime,fleetMutation:fleetMutationContext\}\);\{const deferred=transactionCore\?\.settleDeferredRoots\?\.\(draft\);/,'runDurableStateCommand settles right after apply');
  assert.equal((app.match(/deferRoots:transactionCore\.durableDeferredRoots\?\.\(name\)/g)||[]).length,1,'the app command copy asks which roots to defer');
  assert.match(tx,/deferRoots:durableDeferredRoots\(label\)/,'executeDurable asks which roots to defer');
  // Only the measured decisions defer Mobility; Mobility, HR, facilities and fleet commands copy it as before.
  for(const label of ['banking:approve-loan-requests-batch','customer-companies:telecom-decide-requests-batch','insurance:decide-risks-batch','governance:cyber-drill','finance:collect-receivables-by-cheque','authorized:settle-all-payables:cheque','authorized:settle-all-cheques','authorized:pay-all-taxes','authorized:launch-ipo','authorized:record-paid-cheque'])assert.deepEqual(T.durableDeferredRoots(label),['mobility'],label);
  for(const label of ['mobility:buy-fleet','hr:hire','conference:convene','facilities:create','authorized:open-mobility-center','authorized:open-facility:air','authorized:dispose-fleet:air','authorized:settle-all-payablesX','bankingX:a','durable-transaction','',null])assert.equal(T.durableDeferredRoots(label),null,String(label));
  console.log(JSON.stringify({suite:'build511-deferred-draft-roots',ok:true}));
})().catch(error=>{console.error(error);process.exitCode=1;});
