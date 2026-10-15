'use strict';
const assert=require('node:assert/strict');
require('../WebApp/diagnostics-core.js');
const Store=require('../WebApp/performance-report-store.js'),Trace=require('../WebApp/performance-trace-core.js');
class Host extends EventTarget{
 constructor(){super();this.GH_NATIVE_PERFORMANCE_TRACE=1;this.listeners=new Set();this.messages=[];this.disk=null;this.active=null;this.failSave=false;this.mismatch=false;this.exports=0;this.silent=false;this.webkit={messageHandlers:{diagnosticBridge:{postMessage:m=>this.post(m)}}};}
 addEventListener(type,listener,...rest){if(type==='gh-performance-native')this.listeners.add(listener);return super.addEventListener(type,listener,...rest);}
 removeEventListener(type,listener,...rest){this.listeners.delete(listener);return super.removeEventListener(type,listener,...rest);}
 reply(m,detail){queueMicrotask(()=>this.dispatchEvent(new CustomEvent('gh-performance-native',{detail:{type:'reply',requestId:m.requestId,action:m.action,ok:true,...detail}})));}
 post(m){this.messages.push(m);if(this.silent)return;
  if(m.action==='performanceStart'){this.active=m.sessionId;this.reply(m,{sample:this.sample('start')});}
  else if(m.action==='performanceStop'){const sample=this.sample('stop');this.active=null;this.reply(m,{sample});}
  else if(m.action==='performanceSave'){if(this.failSave){this.reply(m,{ok:false,error:'disk-full'});return;}this.disk=m.json;this.reply(m,{reportId:this.mismatch?'wrong-report':m.reportId});}
  else if(m.action==='performanceLoad')this.reply(m,{json:this.disk});
  else if(m.action==='performanceExport'){this.exports++;this.reply(m,{prepared:true,externalSaveConfirmed:false});}
 }
 sample(kind){return {sessionId:this.active,kind,thermalState:'serious',batteryLevel:.63,batteryState:'unplugged',lowPowerMode:true,nativeUptimeMs:10000};}
}
(async()=>{
 const host=new Host(),native=Store.createNativeClient({host,clock:()=>100}),store=Store.create({nativeClient:native});let events=0,calibration;
 assert.equal(host.listeners.size,0);await native.startSensors('PT-TEST',()=>events++,v=>{calibration=v;});assert.equal(events,1);assert.equal(host.listeners.size,1);assert.ok(calibration);host.dispatchEvent(new CustomEvent('gh-performance-native',{detail:{...host.sample('change'),type:'sample',sessionId:'OLD'}}));assert.equal(events,1);host.dispatchEvent(new CustomEvent('gh-performance-native',{detail:{...host.sample('change'),type:'sample'}}));assert.equal(events,2);await native.stopSensors('PT-TEST',()=>events++);assert.equal(host.active,null);assert.equal(host.listeners.size,0);
 let now=100;const trace=Trace.create({clock:()=>now,yieldToHost:async()=>{},setTimer:()=>1,clearTimer:()=>{},store});trace.start();for(let i=0;i<12;i++){now+=16.67;trace.frame(now,now,now+1);}const report=await trace.stop();assert.equal(trace.status().persisted,true);assert.equal((await store.load()).id,report.id);const original=host.disk;
 host.failSave=true;await assert.rejects(store.save({...report,id:'PT-NEW'}),/disk-full/);assert.equal(host.disk,original,'storage refusal preserves latest');host.failSave=false;
 host.mismatch=true;await assert.rejects(store.save(report),/ack-mismatch/);host.mismatch=false;
 assert.deepEqual(await store.exportReport(report),{prepared:true,externalSaveConfirmed:false});assert.equal(host.exports,1);assert.ok(host.disk);assert.equal(host.listeners.size,0);
 const hostile=structuredClone(report);hostile.incidents=[{frame:'<img src=x onerror=alert(1)>',frameIntervalMs:1,callbackMs:1,primaryStage:null,evidence:[]}];assert.throws(()=>Store.validate(hostile),/invalid-performance-report-evidence/);assert.throws(()=>Store.parse('x'.repeat(Store.MAX_BYTES+1)),/size/);assert.throws(()=>Store.parse('{}'),/invalid-performance-report/);
 host.silent=true;await assert.rejects(native.request('performanceLoad',{},15),/timeout/);assert.equal(host.listeners.size,0,'request timeout releases listener');
 const fallback=Store.createNativeClient({host:new EventTarget()});assert.equal(fallback.available(),false);assert.equal(await fallback.startSensors('PT-NONE',()=>{}),false);
 console.log(JSON.stringify({suite:'build381-performance-store',ok:true,manualSensors:true,listenersReleased:true,staleSamplesRejected:true,nativePersistenceProtocol:true,exportDoesNotDelete:true,malformedReportsRejected:true,iosSensorHardwareTested:false}));
})().catch(error=>{console.error(error);process.exitCode=1;});
