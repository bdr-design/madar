'use strict';
// Owner («تتبع الثقل ... ابيها اصفار»; a calendar day in a 300k-asset world: each fleet window result named the extras of
// each of its rows, 50,632 entries nearly all empty, and reading the message on the main thread took up to 19 ms at 2x
// CPU throttle): the worker sends only the positions with extras (an Int32Array, transferred) and their values, and the
// engine thread rebuilds the list. On the real source text of fleet-engine-worker's packedExtras and postResult and
// fleet-engine-thread's receive:
//  1. the list rebuilt reads the same at every position (objects, null, nested values, empty) and has the same length;
//  2. a short list or one with extras on more than a quarter of its rows is sent as it is;
//  3. a result message is posted with its positions transferred, and the thread puts the list back before any use;
//  4. in a browser, a 50,000-row result with 1% extras is read in under a third of the time of the list as it was (about a fifth measured).
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{chromium}=require('playwright');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const worker=fs.readFileSync(path.join(ROOT,'WebApp/fleet-engine-worker.js'),'utf8'),thread=fs.readFileSync(path.join(ROOT,'WebApp/fleet-engine-thread.js'),'utf8');
const cut=(text,from,to)=>{const a=text.indexOf(from),b=text.indexOf(to,a+from.length);assert.ok(a>=0&&b>a,`source anchor missing: ${from}`);return text.slice(a,b);};
const posted=[],context={self:{postMessage:(message,transfer)=>posted.push({message,transfer})},VERSION:'qa'};
vm.runInNewContext(cut(worker,'function packedExtras(','function imported(')+';globalThis.pack=packedExtras;globalThis.postResult=postResult;',context);
vm.runInNewContext(cut(thread,'    function unpackExtras(','    function receive(')+';globalThis.unpack=unpackExtras;',context);
let seed=623;const random=()=>{seed=(seed*1103515245+12345)%2147483648;return seed/2147483648;};
// 1.
for(const [length,share] of [[256,0],[1000,.01],[50632,.003],[4096,.2],[30000,.15]]){
  const list=Array.from({length},(_,k)=>random()<share?(k%5===0?null:{note:`row ${k}`,nested:{k,tags:['a',k]}}):undefined);
  const sparse=context.pack(list);assert.ok(sparse,`1: a list of ${length} with ${share*100}% extras is packed`);assert.ok(ArrayBuffer.isView(sparse.at)&&sparse.at.BYTES_PER_ELEMENT===4,"1: the positions are an Int32Array");
  const back=context.unpack(structuredClone(sparse));assert.equal(back.length,list.length,'1: the same length');
  for(let k=0;k<length;k++)assert.deepEqual(back[k],list[k],`1: position ${k} reads the same`);
}
// 2.
assert.equal(context.pack(Array.from({length:255},()=>undefined)),null,'2: a short list is sent as it is');
assert.equal(context.pack(Array.from({length:1000},(_,k)=>k%3===0?{k}:undefined)),null,'2: a list a third full is sent as it is');
// 3.
{const extras=Array.from({length:2000},(_,k)=>k===7?{k}:undefined),indices=new Int32Array(2000),bytes=new ArrayBuffer(16);context.postResult(41,2.5,{indices,bytes,extras,out:{events:1}});
  const {message,transfer}=posted.pop();assert.equal(message.type,'result');assert.equal('extras' in message,false,'3: the list itself is not posted');assert.ok(message.extrasSparse&&transfer.includes(message.extrasSparse.at.buffer)&&transfer.includes(bytes)&&transfer.includes(indices.buffer),'3: positions, bytes and indices transferred');
  const receive=cut(thread,'    function receive(message){','\n      if(message.type===\'error\')');assert.match(receive,/message\.type==='result'&&message\.extrasSparse\)\{message\.extras=unpackExtras\(message\.extrasSparse\)/,'3: the thread rebuilds the list first');}
// 4.
(async()=>{
  const browser=await chromium.launch();
  try{
    const page=await browser.newPage();
    const ratio=await page.evaluate(({pack})=>{const packedExtras=(0,eval)(`(${pack})`);
      const list=Array.from({length:50000},(_,k)=>k%100===0?{note:`row ${k}`,k}:undefined),sparse=packedExtras(list);
      const read=message=>new Promise(resolve=>{const channel=new MessageChannel();channel.port2.onmessage=event=>{const t=performance.now();void event.data;resolve(performance.now()-t);channel.port1.close();channel.port2.close();};channel.port1.postMessage(message);});
      return (async()=>{let plain=0,packed=0;for(let i=0;i<6;i++){plain+=await read({type:'result',extras:list});packed+=await read({type:'result',extrasSparse:sparse});}return {plain,packed};})();
    },{pack:cut(worker,'function packedExtras(','function postResult(')});
    assert.ok(ratio.packed<ratio.plain/3,`4: the packed list is read in under a third of the time (${ratio.packed.toFixed(2)} against ${ratio.plain.toFixed(2)} ms)`);
    console.log(JSON.stringify({suite:'build623-worker-extras-packing',ok:true,readMs:{plain:+ratio.plain.toFixed(2),packed:+ratio.packed.toFixed(2)}}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
