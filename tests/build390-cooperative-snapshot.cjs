'use strict';
const assert=require('node:assert/strict'),{harness}=require('./helpers/core-harness'),{s}=harness(['transaction-core','state-codec-core']),C=s.GH_STATE_CODEC,results=[];
function drain(state){const steps=C.serializeSteps(state);let count=0,next;while(!(next=steps.next()).done)count++;return {text:next.value,steps:count};}
function test(name,fn){try{results.push({name,ok:true,detail:fn()});}catch(error){results.push({name,ok:false,error:String(error.stack||error)});}}
test('plain deep arrays yield even when no collection or binary codec path qualifies',()=>{
 const state={saveVersion:'3.0.0',deep:{a:{b:{c:{values:Array.from({length:10000},(_,i)=>i/3)}}}}};
 const out=drain(state);assert.equal(out.text,JSON.stringify(state));assert.ok(out.steps>=30,'deep numeric arrays must not stringify in one task');return {steps:out.steps};
});
test('large nested scalar values are serialized in bounded pieces with exact Unicode/escaping semantics',()=>{
 const text=('العربية 😀 "\\\n\t\u0000'+String.fromCharCode(0xD800)+'X').repeat(20000),state={deep:{nested:{text}}};
 const out=drain(state);assert.equal(out.text,JSON.stringify(state));assert.ok(out.steps>=10,'one large string must yield between pieces');return {chars:text.length,steps:out.steps};
});
test('mixed JSON, holes, omitted values, repeated references and nonfinite numbers keep JSON semantics',()=>{
 const shared={n:7},array=[1,,undefined,NaN,Infinity,-0,{a:undefined,b:null}],state={x:undefined,array,deep:{shared,again:shared},keep:true};
 assert.equal(drain(state).text,JSON.stringify(state));
});
test('fragment replacement remains byte-identical for self-contained exports and native round trips',()=>{
 const state={fleet:s.GH_FLEET_STORE.create(0),finance:{invoices:Array.from({length:1500},(_,i)=>({id:'F-'+i,note:('وثيقة '+i+' ').repeat(40),value:i}))}};
 const out=drain(state);assert.equal(out.text,JSON.stringify(C.encodeState(state)));const native=C.serializeChunked(state),chunks=new Map(native.chunks.map(c=>[c.id,c.text?new TextEncoder().encode(c.text):new Uint8Array(state.fleet.rows,c.byteOffset,c.byteLength).slice()]));
 assert.equal(C.serialize(C.deserialize(native.text,{resolveChunk:id=>chunks.get(id)})),out.text);
});
test('cycle and BigInt errors remain failures rather than partial saves',()=>{
 const state={a:{}};state.a.back=state;assert.throws(()=>drain(state),error=>error.name==='TypeError');assert.throws(()=>drain({a:{n:1n}}),error=>error.name==='TypeError');
});
console.log(JSON.stringify({suite:'build390-cooperative-snapshot',passed:results.filter(x=>x.ok).length,total:results.length,results},null,2));if(results.some(x=>!x.ok))process.exitCode=1;
