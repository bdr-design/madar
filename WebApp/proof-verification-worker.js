'use strict';

// Build 372: archived proof maintenance sends only its small candidate round here. Canonical JSON construction and
// SHA-256 use document-proof-core and authorization-core themselves, so the worker and the synchronous verifier cannot
// drift. State publication and every envelope/authorization/chain check remain on the main thread.
importScripts('authorization-core.js','document-proof-core.js');

const VERSION=self.GH_DOCUMENT_PROOF?.ARCHIVED_WORKER_VERSION;
self.addEventListener('message',event=>{
  const message=event?.data||{};
  try{
    if(message.type!=='hash-archived'||!Number.isSafeInteger(message.requestId)||!Array.isArray(message.jobs)||message.jobs.length>200||!VERSION)throw new Error('proof-verification-request-invalid');
    const results=message.jobs.map(job=>{try{return self.GH_DOCUMENT_PROOF.hashArchivedCandidate(job);}catch(error){return {token:job?.token,ok:false,reason:String(error?.message||error).slice(0,240)};}});
    self.postMessage({type:'hash-archived-result',version:VERSION,requestId:message.requestId,results});
  }catch(error){self.postMessage({type:'proof-verification-error',version:VERSION||null,requestId:Number.isSafeInteger(message.requestId)?message.requestId:0,error:String(error?.message||error).slice(0,240)});}
});
