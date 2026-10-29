'use strict';
// Owner («تتبع الثقل ... ابيها اصفار»; the proof maintenance converted 100 earlier document versions to checkpoints in one
// task, 43 ms at 2x CPU throttle in a 300k-asset world): a round converts 25, up to 64 rounds a pass (the same 1,600 at
// most as 16 rounds of 100). On the real document proof, transaction and finance owners, against the source before
// (9ce7d24, its round size and cap read from its own app.js):
//  1. a pass over 1,000 cheques (2,000 versions) leaves the same checkpoints and the same proof store as the source before;
//  2. so does a pass over more than a pass can take (2,100 cheques), and the next pass finishes the same way;
//  3. no round converts more than 25 versions (the source before: 100).
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'),SOURCE=process.env.GH_TEST_SOURCE_DIR||ROOT;
const {scenario}=require(path.join(ROOT,'tests/helpers/business-scenario'));
const limits=app=>{const round=/const PROOF_CHECKPOINT_ROUND=(\d+)/.exec(app),cap=/const PROOF_CHECKPOINT_ROUND=\d+,PROOF_CHECKPOINT_ROUNDS=(\d+)/.exec(app)||/entry\.rounds<(\d+)\)/.exec(app);assert.ok(round&&cap,'round size and cap found');return {round:Number(round[1]),cap:Number(cap[1])};};
const now=limits(fs.readFileSync(path.join(SOURCE,'WebApp/app.js'),'utf8')),before=limits(execFileSync('git',['-C',ROOT,'show','9ce7d24:WebApp/app.js'],{maxBuffer:64*1024*1024}).toString());
function world(){
  const e=scenario(),s=e.s,state=e.state,TX=s.GH_TRANSACTION_CORE;state.godMoney=true;state.infiniteMoney=true;let sequence=0;
  const cheques=count=>{const out=TX.execute(state,{label:`b624-${sequence}`,apply:()=>{for(let i=0;i<count;i++,sequence++){const c=e.command('finance','issue-cheque',{company:'air',amount:300+sequence,beneficiary:'Supplier LLC',note:'b624',requestRef:`B624-${sequence}`});e.command('finance','settle-cheque',{id:c.id});}}});assert.equal(out.committed,true,out.reason);state.simSeconds+=3600;};
  return {state,Proof:s.GH_DOCUMENT_PROOF,cheques};
}
// One maintenance pass as app.js runs it: rounds until one converts fewer than a round, or the cap.
function pass(w,{round,cap}){const sizes=[];for(let rounds=1;;rounds++){const out=w.Proof.checkpointAncestors(w.state,{limit:round});sizes.push(out.checkpointed||0);if(!((out.checkpointed||0)>=round&&rounds<cap))break;}return sizes;}
const store=w=>JSON.stringify(w.state.documentProofs);
for(const [label,count] of [['1',1000],['2',2100]]){
  const a=world(),b=world();a.cheques(count);b.cheques(count);
  const sizesNow=pass(a,now),sizesBefore=pass(b,before);
  assert.equal(store(a),store(b),`${label}: the same proof store after the pass (${count} cheques)`);
  assert.equal(sizesNow.reduce((n,x)=>n+x,0),sizesBefore.reduce((n,x)=>n+x,0),`${label}: the same versions converted`);
  // 3.
  assert.ok(Math.max(...sizesNow)<=25,`3: no round converts more than 25 (${Math.max(...sizesNow)})`);
  if(label==='2'){pass(a,now);pass(b,before);assert.equal(store(a),store(b),'2: the next pass finishes the same way');assert.ok(Math.max(...sizesBefore)===100,'3: (the source before converted 100 a round)');}
}
console.log(JSON.stringify({suite:'build624-proof-checkpoint-rounds',ok:true,now,before}));
