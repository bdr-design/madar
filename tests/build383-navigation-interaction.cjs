'use strict';
const assert=require('node:assert/strict'),{harness}=require('./helpers/core-harness'),{s}=harness(['workflow-core','interaction-core']);
let checks=0;const state={simSeconds:0},healthy={status:'healthy',counts:{critical:0,warning:0,total:0},issues:[]};s.GH_INTEGRITY_CORE={check(){checks++;return healthy;}};
function button(){const attrs=new Map();return {disabled:false,textContent:'QA',dataset:{},classList:{add(){},remove(){}},setAttribute:(k,v)=>attrs.set(k,v),getAttribute:k=>attrs.get(k),removeAttribute:k=>attrs.delete(k)};}
(async()=>{const I=s.GH_INTERACTION,b=button();let ran=0;
 await I.run(b,()=>ran++,{state,navigation:true,action:'open:company'});assert.equal(checks,0);assert.equal(ran,1);assert.equal(b.disabled,false);
 await I.run(b,()=>ran++,{state,action:'open:financial-action'});assert.equal(checks,2,'an action name alone cannot opt a financial decision out');
 let finish;const pending=I.run(b,()=>new Promise(r=>{finish=r;}),{state,navigation:true});assert.equal((await I.run(b,()=>ran++,{state,navigation:true})).busy,true);finish();await pending;assert.equal(ran,2);
 await assert.rejects(I.run(b,()=>{throw Error('navigation-error');},{state,navigation:true}),/navigation-error/);assert.equal(b.disabled,false);
 s.GH_INTEGRITY_CORE={check(){throw Error('integrity-unavailable');}};await assert.rejects(I.run(b,()=>ran++,{state}),/integrity-unavailable/);assert.equal(b.disabled,false,'failed precheck must not strand a locked button');
 s.GH_INTEGRITY_CORE={check(){checks++;return healthy;}};await I.run(b,()=>ran++,{state});assert.equal(checks,4);assert.equal(ran,3);
 console.log(JSON.stringify({suite:'build383-navigation-interaction',ok:true,navigationChecks:0,decisionChecks:2,duplicateAndErrorRecovery:true}));
})().catch(e=>{console.error(e);process.exitCode=1;});
