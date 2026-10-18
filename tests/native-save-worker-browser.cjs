'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium,webkit}=require('playwright'),{serve}=require('./helpers/web-server');
(async()=>{const root=path.resolve(__dirname,'..'),server=await serve(path.join(root,'WebApp'));try{
 const meta=fs.readFileSync(path.join(root,'WebApp/index.html'),'utf8').match(/<meta\b[^>]*http-equiv="Content-Security-Policy"[^>]*>/i)[0];
 for(const engine of [chromium,webkit]){const browser=await engine.launch({headless:true});try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));const url=server.baseURL+'/__qa_native_worker_origin__';
  await page.route(url,r=>r.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8">'+meta+['fleet-store-core.js','save-chunk-codec.js','state-codec-core.js','save-checksum-thread.js','__qa_native_worker_probe__.js'].map(f=>'<script src="/'+f+'"></script>').join('')}));
  await page.route('**/__qa_native_worker_probe__.js',r=>r.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(root,'tests/native/save-worker-probe.js'),'utf8')}));
  await page.goto(url);await page.waitForFunction(()=>globalThis.__GH_SAVE_WORKER_PROBE__,null,{timeout:90000});const result=await page.evaluate(()=>__GH_SAVE_WORKER_PROBE__);
  assert.equal(result.version,'save-pipeline-native-v1');assert.equal(result.total,8);assert.equal(result.failed,0,JSON.stringify(result));assert.equal(result.passed,8);assert.deepEqual(errors,[]);console.log('NATIVE_SAVE_WORKER_PROBE_JS_PASS',engine.name(),JSON.stringify({passed:result.passed,total:result.total,scope:'same probe JavaScript on HTTP; actual gh://app WKWebView remains a separate macOS gate'}));
 }finally{await browser.close();}}
}finally{await server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
