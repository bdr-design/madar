'use strict';
// Native vault protocol test double; does not replace financial owners or persistence code.
function installVault(seed){
 const q=window.__DIFF_VAULT__={chunks:new Map((seed?.chunks||[]).map(([id,b64])=>[id,Uint8Array.from(atob(b64),c=>c.charCodeAt(0))])),head:seed?.json||null,history:[],uploads:[],attempts:[],pending:[],mode:'ok',hold:false,generation:10};
 GH_NATIVE_BUILD=362;window.webkit={messageHandlers:{saveBridge:{postMessage(m){
  const deliver=(name,detail)=>setTimeout(()=>dispatchEvent(new CustomEvent(name,{detail})),0);
  if(m.action==='storeSaveChunk'){
   const bytes=Uint8Array.from(atob(m.base64),c=>c.charCodeAt(0)),old=q.chunks.get(m.id);q.uploads.push({id:m.id,bytes:bytes.length});
   const ok=q.mode!=='chunk-nack'&&(!old||old.length===bytes.length&&old.every((v,i)=>v===bytes[i]));if(ok)q.chunks.set(m.id,bytes);
   deliver('gh-native-chunk-ack',{requestId:m.requestId,id:m.id,success:ok,message:ok?null:'qa-chunk-refused'});return;
  }
  if(m.action!=='commitSave')throw new Error('unexpected action '+m.action);
  const root=JSON.parse(m.saveJSON),ids=[...(root.fleet?.rows?.chunks||[]),...(root.stateCodec?.chunks||[])],missing=ids.find(id=>!q.chunks.has(id)),ok=!missing&&q.mode!=='commit-nack'&&GH_CONTROL_PLANE.sha256(m.saveJSON)===m.saveHash;
  q.attempts.push({json:m.saveJSON,ok});
  const ack=()=>{if(ok){q.head=m.saveJSON;q.history.push(m.saveJSON);}deliver('gh-native-save-ack',{requestId:m.requestId,action:m.action,saveRevision:m.saveRevision,resetEpoch:m.resetEpoch,saveSchemaVersion:m.saveSchemaVersion,saveHash:m.saveHash,success:ok,generation:ok?++q.generation:undefined,message:missing?'Missing save chunk: '+missing:ok?null:'qa-commit-refused'});};
  if(q.hold)q.pending.push(ack);else ack();
 }}}};
}
// WebKit applies worker-src 'self' to the app's blob worker fixture. Serve the checked-out worker from the page's
// own loopback origin, matching the native same-origin worker contract without changing the application's CSP.
async function bootAtOrigin(options){
 const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),{boot}=require('./local-dom-app'),browser=options.browser,root=options.root||path.resolve(__dirname,'../..');
 const worker=fs.readFileSync(path.join(root,'WebApp/state-codec-core.js'),'utf8')+'\n;\n'+fs.readFileSync(path.join(root,'WebApp/save-chunk-codec.js'),'utf8')+'\n;\n'+fs.readFileSync(path.join(root,'WebApp/save-checksum-worker.js'),'utf8').replace(/^importScripts\([^)]*\);$/m,'');
 const server=http.createServer((req,res)=>{const script=req.url==='/__qa_save_worker.js';res.writeHead(script||req.url==='/'?200:404,{'Content-Type':script?'application/javascript':'text/html'});res.end(script?worker:'<!doctype html><title>Local snapshot test</title>');});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const closeOrigin=()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
 try{
  const address=server.address(),adapter={newPage:async config=>{const page=await browser.newPage(config);await page.goto(`http://127.0.0.1:${address.port}/`);return page;}};
  const started=await boot({...options,browser:adapter});
  await started.page.evaluate(()=>{GH_SAVE_CHECKSUM_THREAD.terminate();globalThis.__GH_SAVE_CHECKSUM_WORKER_FACTORY__=()=>new Worker('/__qa_save_worker.js');});
  return {...started,closeOrigin};
 }catch(error){await closeOrigin();throw error;}
}
module.exports={installVault,bootAtOrigin};
