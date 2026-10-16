'use strict';
const assert=require('node:assert/strict');
const {harness}=require('./helpers/core-harness');
const results=[];
async function test(name,fn){try{results.push({name,ok:true,detail:await fn()});}catch(error){results.push({name,ok:false,error:String(error.stack||error)});}}
function setup(){const {s}=harness(['transaction-core']),tx=s.GH_TRANSACTION_CORE;assert.ok(tx.changeTracking,'runtime change tracking is required');return {s,tx,c:tx.changeTracking};}
function plain(value){return JSON.parse(JSON.stringify(value));}
(async()=>{
await test('untracked legacy state requires a full snapshot and metadata never enters JSON',()=>{
 const {c}=setup(),state={value:1},before=JSON.stringify(state);
 assert.equal(c.pending(state).unknown,true);assert.equal(c.pending(state).incrementalReady,false);
 const token=c.capture(state);assert.equal(c.acknowledgeSnapshot(state,token),true);
 assert.equal(c.pending(state).unknown,false);assert.equal(c.pending(state).incrementalReady,false);
 assert.equal(JSON.stringify(state),before);assert.deepEqual(Object.keys(state),['value']);
 state.value=2;assert.equal(c.pending(state).requiresFullSnapshot,true,'legacy direct writes cannot be treated as clean');assert.equal(c.pending(state).incrementalReady,false);
});
await test('scoped commit records conservative roots without scanning payloads',()=>{
 const {tx,c}=setup(),state={a:{n:1},b:{n:2}};c.acknowledgeSnapshot(state,c.capture(state));
 const from=c.capture(state);tx.execute(state,{scope:['a'],writeRoots:['a'],apply(){state.a.n++;}});
 assert.deepEqual(plain(c.pending(state).roots),['a']);assert.equal(c.since(state,from).unknown,false);
 assert.equal(c.since(state,from).revision,2);assert.equal(c.pending(state).incrementalReady,false);
});
await test('unknown writers force a full snapshot; forged and cross-state tokens cannot clear changes',()=>{
 const {tx,c}=setup(),state={a:1},other={};c.acknowledgeSnapshot(state,c.capture(state));
 tx.execute(state,{apply(){state.a++;}});assert.equal(c.pending(state).unknown,true);
 assert.equal(c.acknowledgeSnapshot(state,{}),false);assert.equal(c.acknowledgeSnapshot(state,c.capture(other)),false);
});
await test('snapshot acknowledgement leaves later edits pending and rejects older acknowledgements',()=>{
 const {c}=setup(),state={};c.acknowledgeSnapshot(state,c.capture(state));
 c.touch(state,['a']);const old=c.capture(state);c.touch(state,['b']);const current=c.capture(state);c.touch(state,['a']);
 assert.equal(c.acknowledgeSnapshot(state,old),true);assert.deepEqual(plain(c.pending(state).roots),['a','b']);
 assert.equal(c.acknowledgeSnapshot(state,current),true);assert.deepEqual(plain(c.pending(state).roots),['a']);
 assert.equal(c.acknowledgeSnapshot(state,old),false);
});
await test('apply and critical-task failures restore state and discard tracking',()=>{
 for(const critical of [false,true]){
  const {tx,c}=setup(),state={a:{n:1}},before=JSON.stringify(state);c.acknowledgeSnapshot(state,c.capture(state));const token=c.capture(state);
  assert.throws(()=>tx.execute(state,{scope:['a'],writeRoots:['a'],apply(){state.a.n=9;if(critical)tx.afterCommit(()=>{c.touch(state,['a']);throw new Error('fault');},{critical:true});else throw new Error('fault');}}),/fault/);
  assert.equal(JSON.stringify(state),before);assert.deepEqual(plain(c.since(state,token).roots),[]);assert.equal(c.since(state,token).unknown,false);
 }
});
await test('joined roots are covered once; an unscoped join is conservative; caught failure cannot leak a commit',()=>{
 const {tx,c}=setup(),state={a:1,b:2};c.acknowledgeSnapshot(state,c.capture(state));
 tx.execute(state,{scope:['a','b'],writeRoots:['a','b'],scopedJoin:true,apply(){state.a++;tx.join(state,{apply(){state.b++;}});}});
 assert.deepEqual(plain(c.pending(state).roots),['a','b']);assert.equal(c.pending(state).unknown,false);
 c.acknowledgeSnapshot(state,c.capture(state));tx.execute(state,{scope:['a'],writeRoots:['a'],apply(){tx.join(state,{apply(){state.b++;}});}});assert.equal(c.pending(state).unknown,true);
 c.acknowledgeSnapshot(state,c.capture(state));const from=c.capture(state),before=JSON.stringify(state);
 assert.throws(()=>tx.execute(state,{scope:['a'],writeRoots:['a'],apply(){try{tx.join(state,{apply(){state.b++;throw new Error('join-fault');}});}catch{}}}),/join-fault/);
 assert.equal(JSON.stringify(state),before);assert.equal(c.since(state,from).unknown,false);assert.deepEqual(plain(c.since(state,from).roots),[]);
});
await test('scope extension and late post-commit transactions are tracked by the parent boundary',()=>{
 const {tx,c}=setup(),state={a:1,b:2};c.acknowledgeSnapshot(state,c.capture(state));
 tx.execute(state,{scope:['a'],writeRoots:['a'],apply(){tx.extendScope(state,['b']);state.b++;tx.afterCommit(()=>tx.execute(state,{scope:['a'],writeRoots:['a'],apply(){state.a++;}}),{critical:true});}});
 assert.deepEqual(plain(c.pending(state).roots),['a','b']);assert.equal(c.pending(state).revision,2);
});
await test('staged work is invisible until commit and abort discards all flags',()=>{
 for(const abort of [false,true]){
  const {tx,c}=setup(),state={a:1};c.acknowledgeSnapshot(state,c.capture(state));const before=JSON.stringify(state),token=c.capture(state);
  const staged=tx.beginStaged(state,{scope:['a'],writeRoots:['a'],apply:function*(){state.a++;c.touch(state,['a']);yield 'work';state.a++;}});
  while(staged.stage!=='work'&&!staged.done)staged.step();
  assert.equal(c.pending(state).inFlight,true);assert.deepEqual(plain(c.since(state,token).roots),[]);
  assert.equal(c.acknowledgeSnapshot(state,c.capture(state)),false);
  if(abort){assert.equal(staged.abort('cancel'),true);assert.equal(JSON.stringify(state),before);assert.equal(c.pending(state).unknown,false);assert.deepEqual(plain(c.pending(state).roots),[]);}
  else{while(!staged.done)staged.step();assert.equal(state.a,3);assert.deepEqual(plain(c.pending(state).roots),['a']);}
 }
});
await test('replacement invalidates old tokens, including replacement with the same root identity',()=>{
 const {tx,c}=setup(),state={a:1};c.acknowledgeSnapshot(state,c.capture(state));const old=c.capture(state);
 tx.publishObject(state,{a:5});assert.equal(c.acknowledgeSnapshot(state,old),false);assert.equal(c.pending(state).unknown,true);
 c.acknowledgeSnapshot(state,c.capture(state));const next=c.capture(state);tx.restoreObject(state,{a:2});assert.equal(c.acknowledgeSnapshot(state,next),false);
});
await test('durable rejection leaves live tracking untouched; success and publish failures are conservative',async()=>{
 for(const mode of ['reject','success','publish-failure']){
  const {tx,c}=setup(),state={saveRevision:0,a:1};c.acknowledgeSnapshot(state,c.capture(state));const from=c.capture(state),before=JSON.stringify(state);
  const work=()=>tx.executeDurable(state,{apply(draft){draft.a++;},persist:async()=>mode==='reject'?{ok:false,reason:'nack'}:{ok:true},...(mode==='publish-failure'?{publish(live,draft){tx.publishObject(live,draft);throw new Error('publish-fault');}}:{})});
  if(mode==='success'){await work();assert.equal(state.a,2);assert.equal(c.pending(state).unknown,true);assert.equal(c.acknowledgeSnapshot(state,from),false);}
  else{await assert.rejects(work,mode==='reject'?/nack/:/publish-fault/);if(mode==='reject'){assert.equal(JSON.stringify(state),before);assert.equal(c.since(state,from).unknown,false);assert.deepEqual(plain(c.since(state,from).roots),[]);}else assert.equal(c.pending(state).unknown,true);}
 }
});
await test('validation refusal and a failed late child transaction leave no tracking residue',()=>{
 const {tx,c}=setup(),state={a:1};c.acknowledgeSnapshot(state,c.capture(state));const token=c.capture(state),before=JSON.stringify(state);
 const refused=tx.execute(state,{scope:['a'],writeRoots:['a'],validate(){c.touch(state,['a']);return false;},apply(){throw new Error('must not run');}});assert.equal(refused.committed,false);
 assert.equal(c.since(state,token).unknown,false);assert.deepEqual(plain(c.pending(state).roots),[]);
 assert.throws(()=>tx.execute(state,{scope:['a'],writeRoots:['a'],apply(){state.a++;tx.afterCommit(()=>{tx.execute(state,{scope:['a'],writeRoots:['a'],apply(){state.a++;}});throw new Error('late-fault');},{critical:true});}}),/late-fault/);
 assert.equal(JSON.stringify(state),before);assert.equal(c.since(state,token).unknown,false);assert.deepEqual(plain(c.pending(state).roots),[]);
});
await test('failed rollback marks the state unknown rather than advertising a clean baseline',()=>{
 const {tx,c}=setup(),state={a:1};c.acknowledgeSnapshot(state,c.capture(state));
 assert.throws(()=>tx.execute(state,{scope:['a'],writeRoots:['a'],undo(){throw new Error('undo-fault');},apply(){state.a++;throw new Error('apply-fault');}}),error=>error.code==='TRANSACTION_ROLLBACK_FAILED');
 assert.equal(c.pending(state).unknown,true);assert.equal(c.pending(state).inFlight,false);
});
await test('post-commit effects and malformed scope hints remain conservative',()=>{
 const {tx,c}=setup(),state={a:1,b:2};c.acknowledgeSnapshot(state,c.capture(state));
 tx.execute(state,{scope:['a'],writeRoots:['a'],apply(){state.a++;tx.afterCommit(()=>{state.b++;});}});assert.equal(c.pending(state).unknown,true);
 c.acknowledgeSnapshot(state,c.capture(state));c.touch(state,['x'.repeat(1000)]);assert.equal(c.pending(state).unknown,true);assert.equal(c.pending(state).rootCount,0);
});
await test('a token captured during staged work remains invalid after the work finishes',()=>{
 const {tx,c}=setup(),state={a:1};c.acknowledgeSnapshot(state,c.capture(state));
 const staged=tx.beginStaged(state,{scope:['a'],writeRoots:['a'],apply:function*(){state.a++;yield 'work';}}),token=c.capture(state);
 while(!staged.done)staged.step();assert.equal(c.acknowledgeSnapshot(state,token),false);assert.deepEqual(plain(c.pending(state).roots),['a']);
});
await test('deleting a declared root records its name; no-op commits stay conservative',()=>{
 const {tx,c}=setup(),state={a:1};c.acknowledgeSnapshot(state,c.capture(state));
 tx.execute(state,{scope:['a'],writeRoots:['a'],apply(){delete state.a;}});assert.deepEqual(plain(c.pending(state).roots),['a']);
 c.acknowledgeSnapshot(state,c.capture(state));tx.execute(state,{scope:['a'],writeRoots:['a'],apply(){}});assert.deepEqual(plain(c.pending(state).roots),['a']);
});
await test('tracking does not visit state payloads, retain event history or grow without bound',()=>{
 const {c}=setup(),state=new Proxy({}, {ownKeys(){throw new Error('payload scan');},get(){throw new Error('payload read');}});
 c.acknowledgeSnapshot(state,c.capture(state));const start=performance.now();
 for(let i=0;i<100000;i++)c.touch(state,['fleet']);const elapsedMs=performance.now()-start;
 assert.equal(c.pending(state).rootCount,1);assert.equal(c.pending(state).revision,100001);
 for(let i=0;i<1000;i++)c.touch(state,['root'+i]);assert.ok(c.pending(state).rootCount<=c.MAX_ROOTS);assert.equal(c.pending(state).unknown,true);
 return {marks:100000,elapsedMs,storedRootsBeforeOverflow:1,maxRoots:c.MAX_ROOTS};
});
console.log(JSON.stringify({suite:'build388-change-tracking',passed:results.filter(x=>x.ok).length,total:results.length,results},null,2));if(results.some(x=>!x.ok))process.exitCode=1;
})();
