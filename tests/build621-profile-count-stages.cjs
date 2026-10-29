'use strict';
// Owner («تتبع الثقل ... ابيها اصفار»; the day close's payroll counted the fleet's 300k rows per profile in one task, 24 ms
// at 2x CPU throttle): the same count is made over slices of 65,536 rows before the payroll reads it. On the real fleet
// store, 300,000 rows from 900 purchases (runs of one profile, a dead row in places), against profileRefCounts:
//  1. the sliced count is the same map, entry for entry and in the same order, and it is the one the payroll and lease
//     groups then read (no second count);
//  2. it is cut into slices (five yields for 300,000 rows), each of at most 65,536 rows;
//  3. a profile changed between two slices (a row removed, a profile written) leaves no count behind: the next read
//     counts the store as it is;
//  4. the financial close counts in slices before its payroll plan (and the source before, c57745e, had no such step).
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'),SOURCE=process.env.GH_TEST_SOURCE_DIR||ROOT;
const STORE=require(path.join(SOURCE,'WebApp/fleet-store-core.js'));
function build(){
  const assets=[];for(let i=0;i<300000;i++){const batch=Math.floor(i/333);assets.push({id:`B621-${i}`,type:'air',ownership:batch%3?'owned':'lease',ownerCompanyId:batch%2?'air':'sea',monthlyLease:1000+batch,staffing:{ready:true,monthlyPayroll:5000+batch%7,total:4},phase:'idle',progress:0});}
  const store=STORE.fromAssets(assets,{at:0});for(let i=0;i<300000;i+=4999)STORE.remove(store,i);return store;
}
const entries=map=>JSON.stringify([...map]);
assert.equal(typeof STORE.profileRefCountsStages,'function','the store has a sliced profile count');
// 1-2.
{const store=build(),reference=entries(STORE.profileRefCounts(build()));
  const steps=STORE.profileRefCountsStages(store,{rowSlice:65536});let step,yields=0;while(!(step=steps.next()).done)yields++;
  assert.equal(entries(step.value),reference,'1: the same counts in the same order');
  assert.equal(STORE.profileRefCounts(store),step.value,'1: the cached count is the sliced one');
  assert.equal(yields,Math.ceil(store.length/65536)-1,`2: cut into slices (${yields} yields)`);
  let payroll=0;STORE.forEachPayrollGroup(store,(_g,count)=>{payroll+=count;});assert.equal(payroll,store.live,'1: the payroll groups read it');}
// 3.
for(const change of ['remove','profile']){
  const store=build(),steps=STORE.profileRefCountsStages(store,{rowSlice:65536});steps.next();
  if(change==='remove')STORE.remove(store,70001);else STORE.set(store,70002,'staffing',{ready:true,monthlyPayroll:1,total:1});
  let step;while(!(step=steps.next()).done){}
  assert.equal(step.value,null,`3: ${change}: no count left behind`);
  const fresh=build();if(change==='remove')STORE.remove(fresh,70001);else STORE.set(fresh,70002,'staffing',{ready:true,monthlyPayroll:1,total:1});
  assert.equal(entries(STORE.profileRefCounts(store)),entries(STORE.profileRefCounts(fresh)),`3: ${change}: the next read counts the store as it is`);
}
// 4.
const close=app=>{const a=app.indexOf("issueContractExpiryNotices(state.lastFinancialDay);yield 'finance-day.advanced-owner';"),b=app.indexOf("payrollPlan=phase('simulation.finance-day.payroll-plan'",a);assert.ok(a>0&&b>a,'the close runs its payroll plan after the advanced owners');return app.slice(a,b);};
assert.match(close(fs.readFileSync(path.join(SOURCE,'WebApp/app.js'),'utf8')),/yield\* window\.GH_FLEET_STORE\.profileRefCountsStages\(state\.fleet\)/,'4: the close counts in slices before its payroll plan');
assert.doesNotMatch(close(execFileSync('git',['-C',ROOT,'show','c57745e:WebApp/app.js'],{maxBuffer:64*1024*1024}).toString()),/profileRefCountsStages/,'4: (the source before did not)');
console.log(JSON.stringify({suite:'build621-profile-count-stages',ok:true,rows:300000,sliceRows:65536}));
