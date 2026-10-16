'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium,webkit}=require('playwright'),{installVault,bootAtOrigin}=require('./helpers/differential-vault-fixture.cjs');
const results=[];
(async()=>{for(const engine of [chromium,webkit]){
 const browser=await engine.launch({headless:true}),errors=[];let closeOrigin=async()=>{};
 try{
  const started=await bootAtOrigin({browser,errors,fleetWorker:true}),page=started.page;closeOrigin=started.closeOrigin;page.setDefaultTimeout(30000);await page.evaluate(installVault);
  assert.equal(await page.evaluate(async()=>{const bytes=Uint8Array.from({length:300000},(_,i)=>i&255);return await GH_SAVE_ENCODING_PROVIDER(bytes)===GH_STATE_CODEC.bytesToBase64(bytes);}),true,'real encoding worker must be available before the large-part checks');
  await page.evaluate(()=>{const s=__GH_STATE__;s.savePolicy={...s.savePolicy,capMinutes:0};s.qaDeep={one:{two:{three:{values:Array.from({length:20000},(_,i)=>i/7),text:('العربية 😀 \"\\\n\t '+String.fromCharCode(0xD800)+'X').repeat(10000)}}}};s.qaMarker='asked';});
  await page.evaluate(()=>{
   const s=__GH_STATE__,q=__DIFF_VAULT__;q.hold=true;window.__SNAPSHOT_BEFORE__={revision:s.saveRevision,balance:s.companyFinance.group.accounts[0].balance,deep:JSON.stringify(s.qaDeep)};
   window.__SNAPSHOT_SAVE__=__AUDIT__.saveNow();s.qaMarker='after';
   window.__SNAPSHOT_COMMAND__=__AUDIT__.runAuthorizedDomainCommand('finance','credit',{company:'group',amount:100,note:'QA queued snapshot',reference:'QA-SNAPSHOT-QUEUED'},{silent:true,idempotencyKey:'QA-SNAPSHOT-QUEUED'});
  });
  await page.waitForFunction(()=>__DIFF_VAULT__.pending.length===1);
  let out=await page.evaluate(()=>({locked:GH_PERSISTENCE.isLocked(),commits:__DIFF_VAULT__.attempts.length,balance:__GH_STATE__.companyFinance.group.accounts[0].balance,before:__SNAPSHOT_BEFORE__.balance}));assert.equal(out.locked,true);assert.equal(out.commits,1);assert.equal(out.balance,out.before);results.push({engine:engine.name(),name:'private snapshot holds financial isolation and queued command waits for ACK',...out});
  out=await page.evaluate(async()=>{
   const q=__DIFF_VAULT__;q.hold=false;q.pending.splice(0).forEach(fn=>fn());const saved=await __SNAPSHOT_SAVE__;await __SNAPSHOT_COMMAND__;
   const first=GH_STATE_CODEC.deserialize(q.history[0],{resolveChunk:id=>q.chunks.get(id)}),last=GH_STATE_CODEC.deserialize(q.head,{resolveChunk:id=>q.chunks.get(id)}),timing=GH_PERSISTENCE.telemetry().timings.samples.filter(x=>x.kind==='sliced-save').at(-1);
   return {saved,commits:q.history.length,firstMarker:first.qaMarker,lastMarker:last.qaMarker,liveMarker:__GH_STATE__.qaMarker,deepMatches:JSON.stringify(first.qaDeep)===__SNAPSHOT_BEFORE__.deep,revisionDelta:__GH_STATE__.saveRevision-__SNAPSHOT_BEFORE__.revision,balanceDelta:__GH_STATE__.companyFinance.group.accounts[0].balance-__SNAPSHOT_BEFORE__.balance,booksMatch:JSON.stringify(last.companyFinance)===JSON.stringify(__GH_STATE__.companyFinance),timing};
  });
  assert.equal(out.saved,true);assert.equal(out.commits,2);assert.equal(out.firstMarker,'asked');assert.equal(out.lastMarker,'after');assert.equal(out.liveMarker,'after');assert.equal(out.deepMatches,true);assert.equal(out.revisionDelta,2);assert.equal(out.balanceDelta,100);assert.equal(out.booksMatch,true);assert.equal(out.timing.ok,true);results.push({engine:engine.name(),name:'snapshot preserves request-time values and command commits at the next revision',...out});
  out=await page.evaluate(async()=>{
   const s=__GH_STATE__,q=__DIFF_VAULT__,before={head:q.head,revision:s.saveRevision,books:JSON.stringify(s.companyFinance),attempts:q.attempts.length};q.mode='commit-nack';
   const saved=await __AUDIT__.saveNow();q.mode='ok';return {saved,headUnchanged:q.head===before.head,revisionUnchanged:s.saveRevision===before.revision,booksUnchanged:JSON.stringify(s.companyFinance)===before.books,attempts:q.attempts.length-before.attempts,unlocked:!GH_PERSISTENCE.isLocked()};
  });
  assert.equal(out.saved,false);assert.equal(out.headUnchanged,true);assert.equal(out.revisionUnchanged,true);assert.equal(out.booksUnchanged,true);assert.equal(out.attempts,1);assert.equal(out.unlocked,true);results.push({engine:engine.name(),name:'refused snapshot leaves prior head, revision and financial state intact',...out});
  out=await page.evaluate(async()=>{
   const s=__GH_STATE__,q=__DIFF_VAULT__,before={head:q.head,revision:s.saveRevision,attempts:q.attempts.length};s.qaInvalidValue=1n;
   const saved=await __AUDIT__.saveNow();delete s.qaInvalidValue;
   return {saved,headUnchanged:q.head===before.head,revisionUnchanged:s.saveRevision===before.revision,attempts:q.attempts.length-before.attempts,unlocked:!GH_PERSISTENCE.isLocked()};
  });
  assert.equal(out.saved,false);assert.equal(out.headUnchanged,true);assert.equal(out.revisionUnchanged,true);assert.equal(out.attempts,0);assert.equal(out.unlocked,true);results.push({engine:engine.name(),name:'invalid snapshot fails before a commit and releases the lock',...out});
  out=await page.evaluate(async()=>{
   const s=__GH_STATE__,q=__DIFF_VAULT__;s.qaSealed={records:Array.from({length:64},(_,i)=>({id:'SEALED-'+i,note:('نص '+i+' ').repeat(5000)}))};GH_TRANSACTION_CORE.registerSealedCollections('qaSealed',['records']);GH_TRANSACTION_CORE.sealCollections(s);q.uploads=[];
   const encode=TextEncoder.prototype.encode,tagged=[];TextEncoder.prototype.encode=function(text){if(String(text).startsWith('{"$gh"'))tagged.push(String(text).length);return encode.call(this,text);};
   const warn=console.warn,warnings=[];console.warn=(...args)=>{warnings.push(args.map(String).join(' '));};
   let saved;try{saved=await __AUDIT__.saveNow();}finally{TextEncoder.prototype.encode=encode;console.warn=warn;}
   const decoded=GH_STATE_CODEC.deserialize(q.head,{resolveChunk:id=>q.chunks.get(id)});
   return {saved,taggedCalls:tagged.length,maxTaggedInput:Math.max(0,...tagged),largeSealedUploads:q.uploads.filter(x=>x.id.includes('.t.')&&x.bytes>1000000).length,recordsMatch:JSON.stringify(decoded.qaSealed)===JSON.stringify(s.qaSealed),failure:saved?null:warnings};
  });
  assert.equal(out.saved,true,JSON.stringify(out));assert.ok(out.taggedCalls>0);assert.ok(out.maxTaggedInput<=65536);assert.ok(out.largeSealedUploads>0);assert.equal(out.recordsMatch,true);results.push({engine:engine.name(),name:'large immutable text parts encode in bounded UTF-8 pieces and round trip exactly',...out});
  out=await page.evaluate(()=>{const s=__GH_STATE__,full=GH_STATE_CODEC.serialize(s),decoded=GH_STATE_CODEC.deserialize(full);return {selfContained:!full.includes('"$ghText"')&&!full.includes('"$ghBinary":"chunks-v1"'),deepMatches:JSON.stringify(decoded.qaDeep)===JSON.stringify(s.qaDeep),cap:s.savePolicy.capMinutes,due:GH_SAVE_POLICY.due({nowMs:99999999,lastSaveAtMs:0,capMinutes:GH_SAVE_POLICY.capMinutes(s),quiet:true}),schema:GH_SAVE_SCHEMA.validate(s).ok};});
  assert.equal(out.selfContained,true);assert.equal(out.deepMatches,true);assert.equal(out.cap,0);assert.equal(out.due,null);assert.equal(out.schema,true);results.push({engine:engine.name(),name:'full exports remain independent and exit-only checkpoint policy stays selected',...out});
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await closeOrigin();}
}
if(process.env.GH_SNAPSHOT_RESULTS)fs.writeFileSync(process.env.GH_SNAPSHOT_RESULTS,JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify({suite:'build390-snapshot-browser',ok:true,results}));
})().catch(error=>{console.error(error);process.exitCode=1;});
