'use strict';
// Finite, test-only profiling. It executes the original purchase gate once,
// preserving every assertion, and records its exact synchronous subcalls.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),out=process.env.GH_PURCHASE_PROFILE_OUT||path.join(root,'.ci-output');
fs.mkdirSync(out,{recursive:true});let page,cdp;
const profile={
  async beforeApp(target){
    page=target;cdp=await page.context().newCDPSession(page);
    await cdp.send('Tracing.start',{categories:'devtools.timeline,v8,v8.execute,disabled-by-default-v8.gc',transferMode:'ReturnAsStream'});
    await page.evaluate(()=>{
      const samples=[],syncs=[];let cursor=0;
      const record=(name,start,end,detail)=>{samples.push({name,start,end,ms:end-start,detail});if(samples.length>12000){samples.splice(0,6000);cursor=Math.max(0,cursor-6000);}};
      globalThis.__PURCHASE_RECORD__=record;
      const post=Worker.prototype.postMessage;Worker.prototype.postMessage=function(message,...args){const detail={type:message?.type,rows:message?.rows?.indices?.length,values:message?.values?.changes?.length},start=performance.now();try{return post.call(this,message,...args);}finally{record('postMessage',start,performance.now(),detail);}};
      const engine=GH_FLEET_ENGINE_THREAD;
      globalThis.GH_FLEET_ENGINE_THREAD={...engine,create(options){return engine.create({...options,onMainThreadWork(name,start,end){options.onMainThreadWork?.(name,start,end);if(name==='fleet.sync'){if(end-start>=2)syncs.push({start,end,ms:end-start,spans:samples.slice(cursor).filter(row=>row.start>=start&&row.end<=end)});cursor=samples.length;}}});}};
      globalThis.__PURCHASE_PROFILE__={samples,syncs};
    });
  },
  async finish(){
    try{if(page){const result=await page.evaluate(()=>({timeOrigin:performance.timeOrigin,...__PURCHASE_PROFILE__}));fs.writeFileSync(path.join(out,'purchase-sync-spans.json'),JSON.stringify(result));console.log('SYNC_SPANS',JSON.stringify(result.syncs));}}
    finally{if(cdp){const completion=new Promise(resolve=>cdp.once('Tracing.tracingComplete',resolve));await cdp.send('Tracing.end');const {stream}=await completion;let data='';while(true){const part=await cdp.send('IO.read',{handle:stream});data+=part.data;if(part.eof)break;}await cdp.send('IO.close',{handle:stream});fs.writeFileSync(path.join(out,'purchase-sync-trace.json'),data);}}
  }
};
module.exports=profile;
if(require.main===module){
 const file=path.join(root,'tests/build372-asset-purchase-app-browser.cjs'),original=fs.readFileSync(file,'utf8');
 const prelude=`let storeApi;Object.defineProperty(globalThis,'GH_FLEET_STORE',{configurable:true,get:()=>storeApi,set(api){storeApi={...api};for(const name of ['drainReplica','readRows','replicaValueChanges','views'])storeApi[name]=function(...args){const start=performance.now();try{return api[name](...args);}finally{globalThis.__PURCHASE_RECORD__?.(name,start,performance.now(),name==='readRows'?args[1]?.length:null);}};}});`;
 let code=original.replace('beforeScripts:{arg:workerSource','beforeApp:profile.beforeApp,beforeScripts:{arg:workerSource').replace('fn:source=>{','fn:source=>{'+prelude).replace('}finally{await browser.close();}','}finally{try{await profile.finish();}finally{await browser.close();}}');
 if(code===original||!code.includes('await profile.finish()'))throw new Error('purchase profile anchors changed');
 code="const profile=require('../tools/diagnose_purchase_sync.cjs');\n"+code;
 fs.writeFileSync(path.join(out,'purchase-sync-source.json'),JSON.stringify({testSha256:crypto.createHash('sha256').update(original).digest('hex'),commit:process.env.GITHUB_SHA||null}));
 const mod=new Module(file,module);mod.filename=file;mod.paths=Module._nodeModulePaths(path.dirname(file));mod._compile(code,file);
}
