// One independent durable report. IndexedDB for web, a bounded atomic file in the native shell.
// No game save lock, localStorage, network requests or automatic sharing.
(()=>{
  'use strict';
  const DB='ventora-performance-report-v1',MAX_BYTES=2097152;
  let requestSequence=0;
  function validate(report){
    if(!report||report.format!=='ventora-performance-report-v1'||typeof report.id!=='string'||!/^[A-Za-z0-9-]{1,100}$/.test(report.id)||!report.frameSummary||!Array.isArray(report.incidents)||report.incidents.length>512||!Array.isArray(report.recentFrames)||report.recentFrames.length>256)throw new Error('invalid-performance-report');
    const number=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
    if(!number(report.frameSummary.frames)||!number(report.frameSummary.jankyFrames)||!number(report.frameSummary.maxFrameIntervalMs)||!report.observer||!number(report.observer.maxFrameOverheadMs)||!report.coverage||!number(report.coverage.incidentTotal))throw new Error('invalid-performance-report-summary');
    for(const row of report.incidents){if(!row||!number(row.frame)||!number(row.frameIntervalMs)||!number(row.callbackMs)||(row.primaryStage!==null&&(typeof row.primaryStage!=='string'||row.primaryStage.length>96))||!Array.isArray(row.evidence)||row.evidence.length>8||row.evidence.some(e=>!e||typeof e.stage!=='string'||e.stage.length>96||!number(e.overlapMs)))throw new Error('invalid-performance-report-evidence');}
    if(report.native?.samples&&(!Array.isArray(report.native.samples)||report.native.samples.length>128))throw new Error('invalid-performance-native-samples');
    if(report.analysis?.findings&&(!Array.isArray(report.analysis.findings)||report.analysis.findings.length>64||report.analysis.findings.some(row=>!row||typeof row.title!=='string'||row.title.length>160||typeof row.nextCheck!=='string'||row.nextCheck.length>400||!number(row.incidents)||!number(row.maxOverlapMs))))throw new Error('invalid-performance-analysis');
    return report;
  }
  async function serialize(report){
    validate(report);const diagnostic=globalThis.GH_DIAGNOSTICS,yieldToHost=()=>new Promise(r=>setTimeout(r,0));
    const text=diagnostic?.stringifyAsync?(await diagnostic.stringifyAsync(report,{yieldToHost,budgetMs:1,space:0})).text:JSON.stringify(report);
    // A bounded report is encoded only once per explicit save/export, never once per frame.
    const bytes=diagnostic?.utf8ByteLengthAsync?(await diagnostic.utf8ByteLengthAsync(text,{yieldToHost,budgetMs:1})).bytes:new TextEncoder().encode(text).byteLength;
    if(bytes>MAX_BYTES)throw new Error('performance-report-too-large');return text;
  }
  function parse(text){if(typeof text!=='string'||text.length>MAX_BYTES||new TextEncoder().encode(text).byteLength>MAX_BYTES)throw new Error('invalid-performance-report-size');return validate(JSON.parse(text));}
  function createNativeClient(options={}){
    const host=options.host||globalThis,clock=options.clock||(()=>performance.now());
    const available=()=>host.GH_NATIVE_PERFORMANCE_TRACE===1&&!!host.webkit?.messageHandlers?.diagnosticBridge?.postMessage;
    let sensorListener=null,sensorSession=null;
    function request(action,payload={},timeoutMs=2500){
      if(!available())return Promise.reject(new Error('native-performance-unavailable'));
      const requestId=`PERF-${++requestSequence}`,post=host.webkit.messageHandlers.diagnosticBridge;
      return new Promise((resolve,reject)=>{
        const cleanup=()=>{host.removeEventListener('gh-performance-native',listener);clearTimeout(timer);};
        const listener=event=>{const m=event.detail;if(m?.requestId!==requestId||m.action!==action||m.type!=='reply')return;cleanup();if(m.ok===true)resolve(m);else reject(new Error(String(m.error||'native-performance-failed').slice(0,160)));};
        const timer=setTimeout(()=>{cleanup();reject(new Error('native-performance-timeout'));},timeoutMs);
        host.addEventListener('gh-performance-native',listener);
        try{post.postMessage({action,requestId,...payload});}catch(error){cleanup();reject(error);}
      });
    }
    async function startSensors(sessionId,onSample,onCalibration){
      detach();if(!available())return false;sensorSession=sessionId;
      sensorListener=event=>{const m=event.detail;if(m?.type==='sample'&&m.sessionId===sessionId)onSample(m);};host.addEventListener('gh-performance-native',sensorListener);
      const sent=clock();try{const out=await request('performanceStart',{sessionId});if(sensorSession!==sessionId)return false;const received=clock();if(out.sample){onSample(out.sample);onCalibration?.({jsSentMs:sent,jsReceivedMs:received,nativeUptimeMs:out.sample.nativeUptimeMs});}return true;}catch{if(sensorSession===sessionId)detach();return false;}
    }
    function detach(){if(sensorListener)host.removeEventListener('gh-performance-native',sensorListener);sensorListener=null;sensorSession=null;}
    async function stopSensors(sessionId,onSample){try{if(available()){const result=await request('performanceStop',{sessionId},1500);if(result.sample)onSample(result.sample);}}finally{if(sensorSession===sessionId)detach();}}
    return Object.freeze({available,request,startSensors,stopSensors,detach});
  }
  function create(options={}){
    const native=options.nativeClient||createNativeClient(),idb=options.indexedDB||globalThis.indexedDB;
    let dbPromise=null,writeTail=Promise.resolve();
    function database(){
      if(dbPromise)return dbPromise;
      dbPromise=new Promise((resolve,reject)=>{
        if(!idb){reject(new Error('report-storage-unavailable'));return;}
        let request;try{request=idb.open(DB,1);}catch(error){reject(error);return;}
        request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('reports'))request.result.createObjectStore('reports');};
        request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();dbPromise=null;};resolve(db);};request.onerror=()=>reject(new Error('report-database-open-failed'));request.onblocked=()=>reject(new Error('report-database-blocked'));
      }).catch(error=>{dbPromise=null;throw error;});return dbPromise;
    }
    async function transact(mode,value){const db=await database();return new Promise((resolve,reject)=>{let result;const tx=db.transaction('reports',mode),store=tx.objectStore('reports');const req=mode==='readwrite'?store.put(value,'latest'):store.get('latest');req.onsuccess=()=>{result=req.result;};tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(new Error('report-database-transaction-failed'));tx.onabort=()=>reject(new Error('report-database-aborted'));});}
    async function save(report){
      const text=await serialize(report);
      const job=writeTail.catch(()=>{}).then(async()=>{if(native.available()){const ack=await native.request('performanceSave',{reportId:report.id,json:text},10000);if(ack.reportId!==report.id)throw new Error('performance-report-ack-mismatch');}else await transact('readwrite',text);return {ok:true,id:report.id};});writeTail=job;return job;
    }
    async function load(){await writeTail.catch(()=>{});if(native.available()){const reply=await native.request('performanceLoad',{},10000);return reply.json?parse(reply.json):null;}const text=await transact('readonly');return text?parse(text):null;}
    async function exportReport(report){
      const text=await serialize(report),filename=`Ventora_Performance_${report.id}.ghdiagnostic`;
      if(native.available()){await native.request('performanceExport',{reportId:report.id,json:text},10000);return {prepared:true,externalSaveConfirmed:false};}
      const bridge=globalThis.webkit?.messageHandlers?.diagnosticBridge;
      if(bridge?.postMessage){bridge.postMessage({action:'exportDiagnostic',json:text,filename});return {prepared:true,externalSaveConfirmed:false};}
      const url=URL.createObjectURL(new Blob([text],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return {prepared:true,externalSaveConfirmed:false};
    }
    return Object.freeze({save,load,exportReport,native,serialize});
  }
  const API=Object.freeze({create,createNativeClient,serialize,validate,parse,MAX_BYTES});globalThis.GH_PERFORMANCE_REPORT_STORE=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
