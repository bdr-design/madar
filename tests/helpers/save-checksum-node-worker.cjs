'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{Worker}=require('node:worker_threads');
// Runs the production worker unmodified on a real Node worker thread; no emulation of its codec or message handler.
function install(root){
 const web=path.join(root,'WebApp');global.__GH_SAVE_CHECKSUM_WORKER_FACTORY__=()=>{
  const worker=new Worker(`const {parentPort}=require('node:worker_threads'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');globalThis.self=globalThis;globalThis.addEventListener=(n,fn)=>parentPort.on('message',data=>fn({data}));globalThis.postMessage=(m,t)=>parentPort.postMessage(m,t);globalThis.importScripts=(...names)=>names.forEach(n=>vm.runInThisContext(fs.readFileSync(path.join(${JSON.stringify(web)},n),'utf8'),{filename:n}));vm.runInThisContext(fs.readFileSync(${JSON.stringify(path.join(web,'save-checksum-worker.js'))},'utf8'));`,{eval:true});
  const handle={postMessage:(...args)=>worker.postMessage(...args),terminate:()=>worker.terminate()};worker.on('message',data=>handle.onmessage?.({data}));worker.on('error',error=>handle.onerror?.(error));return handle;
 };
 vm.runInThisContext(fs.readFileSync(path.join(web,'save-checksum-thread.js'),'utf8'),{filename:'save-checksum-thread.js'});return global.GH_SAVE_CHECKSUM_THREAD;
}
module.exports={install};
