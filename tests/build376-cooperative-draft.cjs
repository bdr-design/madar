'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),{harness,minimal}=require('./helpers/core-harness');
(async()=>{
 const {s}=harness(['transaction-core']),tx=s.GH_TRANSACTION_CORE;
 const state=vm.runInContext(`({saveRevision:1,simSeconds:0,rows:Array.from({length:10000},(_,i)=>({id:'ROW-'+i,amount:i*.1,fields:[i,null,undefined,NaN],text:'وثيقة '+i})),finance:{docs:[{id:'sealed',amount:40},{id:'open',amount:50}],archive:{x:{id:'old',amount:12}}},customRoutes:[{id:'R',ends:['A','B']}],fleet:{rows:'shared-journal'},odd:JSON.parse('{"__proto__":{"safe":true}}')})`,s);
 tx.registerSealedCollections('finance',['docs'],{member:row=>row.id==='sealed'});tx.registerSealedCollections('finance',['archive'],{container:true});tx.registerSealedRoot('customRoutes');
 tx.registerJournaledRoot('fleet',{begin:()=>({}),commit:()=>{},rollback:()=>{}});
 state.otherOpenDoc=state.finance.docs[1];
 const baseline=tx.deepClone(state,{shareJournaledRoots:true});let yields=0;
 const copied=await tx.deepCloneInSlices(state,{shareJournaledRoots:true,budgetMs:.5,yieldToHost:()=>{yields++;return new Promise(resolve=>setTimeout(resolve,0));}});
 assert.equal(JSON.stringify(copied),JSON.stringify(baseline));assert.ok(yields>0,'large mutable graph must give the host opportunities to paint');
 assert.notEqual(copied.finance.docs[1],copied.otherOpenDoc,'unsealed member isolation follows the existing per-member copy contract');assert.equal(copied.fleet,state.fleet);assert.equal(copied.finance.docs[0],state.finance.docs[0]);assert.notEqual(copied.finance.docs[1],state.finance.docs[1]);assert.equal(copied.finance.archive,state.finance.archive);assert.equal(copied.customRoutes[0],state.customRoutes[0]);assert.equal(copied.odd.safe,undefined);assert.equal(Object.getPrototypeOf(copied.odd).safe,undefined);assert.equal(Object.hasOwn(copied.odd,'__proto__'),true);
 copied.rows[0].amount=900;copied.finance.docs[1].amount=1;assert.equal(state.rows[0].amount,0);assert.equal(state.finance.docs[1].amount,50);assert.ok(Number.isNaN(copied.rows[0].fields[3]));
 const graph=vm.runInContext(`(()=>{const buffer=new ArrayBuffer(800000),a={x:1};new Uint8Array(buffer)[700000]=123;const state={a,b:a,buffer,view:new Uint8Array(buffer,600000,150000),hole:[,,1],date:new Date(12345)};state.self=state;return state;})()`,s);
 // Non-state graph is placed inside a state root, preserving cross-links and typed-buffer sharing.
 const more=await tx.deepCloneInSlices({graph},{yieldToHost:()=>Promise.resolve(),budgetMs:.5});assert.equal(more.graph.self,more.graph);assert.equal(more.graph.a,more.graph.b);assert.equal(more.graph.buffer,more.graph.view.buffer);assert.equal(more.graph.view[100000],123);assert.equal(0 in more.graph.hole,false);assert.equal(+more.graph.date,12345);
 let rolled=0,commits=0,pauses=0;const h=harness(['transaction-core']),t=h.s.GH_TRANSACTION_CORE,live=minimal();live.rows=Array.from({length:10000},(_,i)=>({i,text:'x'.repeat(40)}));live.fleet={journal:true};
 t.registerJournaledRoot('fleet',{begin:()=>({}),commit:()=>{commits++;},rollback:()=>{rolled++;}});
 const original=JSON.stringify(live);
 const persist=async draft=>({ok:true,revision:draft.saveRevision});
 const result=await t.executeDurable(live,{yieldToHost:async()=>{pauses++;assert.equal(t.isDurableActive(live),true);assert.throws(()=>t.execute(live,{apply:()=>{live.bad=true;}}),/durable-live-state-transaction-blocked/);},apply:draft=>{draft.changed=true;},persist});
 assert.equal(result.committed,true);assert.ok(pauses>0);assert.equal(commits,1);assert.equal(rolled,0);assert.equal(live.changed,true);assert.equal(t.isDurableActive(live),false);
 const stable=JSON.stringify(live);await assert.rejects(t.executeDurable(live,{yieldToHost:async()=>{throw new Error('host-failed');},apply:()=>{throw new Error('must-not-apply');},persist}),/host-failed/);assert.equal(JSON.stringify(live),stable);assert.equal(rolled,1);assert.equal(t.isDurableActive(live),false);assert.equal(h.s.__GH_DURABLE_COMMAND_CONTEXT__,undefined);
 await assert.rejects(t.executeDurable(live,{yieldToHost:()=>Promise.resolve(),apply:draft=>{draft.changed='bad';throw new Error('apply-failed');},persist}),/apply-failed/);assert.equal(JSON.stringify(live),stable);assert.equal(rolled,2);
 console.log(JSON.stringify({suite:'build376-cooperative-draft',ok:true,rows:10000,yields,pauses,lockedDuringCopy:true,rollbackPaths:2,byteEquivalent:true,originalBytes:original.length}));
})().catch(error=>{console.error(error);process.exitCode=1;});
