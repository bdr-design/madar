'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium,webkit}=require('playwright');
const results=[];
const {bootAtOrigin,installVault}=require('./helpers/differential-vault-fixture.cjs');
(async()=>{for(const engine of [chromium,webkit]){
 const browser=await engine.launch({headless:true}),errors=[];let page,closeOrigin=null;
 try{
  const started=await bootAtOrigin({browser,errors});page=started.page;closeOrigin=started.closeOrigin;page.setDefaultTimeout(30000);
  await page.evaluate(()=>{__GH_STATE__.qaMutableRows=Array.from({length:5000},(_,i)=>({id:'QA-OPEN-'+i,amount:i,detail:{note:('سجل '+i+' ').repeat(20)}}));});
  await page.evaluate(installVault);
  await page.evaluate(()=>{
   const s=__GH_STATE__,q=__DIFF_VAULT__;q.hold=true;window.__DIFF_BEFORE__={balance:s.companyFinance.group.accounts[0].balance,revision:s.saveRevision};
   window.__DIFF_PENDING__=__AUDIT__.runAuthorizedDomainCommand('finance','credit',{company:'group',amount:100,note:'QA diff first',reference:'QA-DIFF-FIRST'},{silent:true,idempotencyKey:'QA-DIFF-FIRST',successNotice:()=>({text:'QA diff first saved'})});
  });
  await page.waitForFunction(()=>__DIFF_VAULT__.pending.length===1);
  let out=await page.evaluate(()=>({balance:__GH_STATE__.companyFinance.group.accounts[0].balance,before:__DIFF_BEFORE__.balance,head:__DIFF_VAULT__.head,openUploads:__DIFF_VAULT__.uploads.filter(x=>x.id.includes('.o.')).length}));
  assert.equal(out.balance,out.before);assert.equal(out.head,null);assert.ok(out.openUploads>0);
  await page.evaluate(async()=>{const q=__DIFF_VAULT__;q.hold=false;q.pending.splice(0).forEach(fn=>fn());await __DIFF_PENDING__;});
  results.push({engine:engine.name(),name:'parts are uploaded before one ACK publishes the money and notice',openUploads:out.openUploads});
  async function credit(key,mode='ok',row=null){
   return page.evaluate(async({key,mode,row})=>{
    const s=__GH_STATE__,q=__DIFF_VAULT__;if(row!==null)s.qaMutableRows[row].detail.note+=' edit '+key;
    q.mode=mode;q.uploads=[];q.attempts=[];const before={books:JSON.stringify(s.companyFinance),finance:JSON.stringify(s.finance),balance:s.companyFinance.group.accounts[0].balance,head:q.head,revision:s.saveRevision};let rejected=false;
    try{await __AUDIT__.runAuthorizedDomainCommand('finance','credit',{company:'group',amount:100,note:'QA '+key,reference:key},{silent:true,idempotencyKey:key,successNotice:()=>({text:'QA saved '+key})});}catch{rejected=true;}
    let decoded=null,decodeError=null;try{decoded=q.head?GH_STATE_CODEC.deserialize(q.head,{resolveChunk:id=>q.chunks.get(id)}):null;}catch(error){decodeError=String(error.message);}
    return {rejected,attempts:q.attempts.length,uploads:q.uploads.length,openUploads:q.uploads.filter(x=>x.id.includes('.o.')).length,balanceDelta:s.companyFinance.group.accounts[0].balance-before.balance,revisionDelta:s.saveRevision-before.revision,booksRestored:JSON.stringify(s.companyFinance)===before.books,financeRestored:JSON.stringify(s.finance)===before.finance,headUnchanged:q.head===before.head,decodeError,savedBooksMatch:decoded&&JSON.stringify(decoded.companyFinance)===JSON.stringify(s.companyFinance),savedRowsMatch:decoded&&JSON.stringify(decoded.qaMutableRows)===JSON.stringify(s.qaMutableRows)};
   },{key,mode,row});
  }
  out=await credit('QA-DIFF-NACK','commit-nack',2000);assert.equal(out.rejected,true);assert.equal(out.attempts,1);assert.equal(out.openUploads,1);assert.equal(out.booksRestored,true);assert.equal(out.financeRestored,true);assert.equal(out.headUnchanged,true);assert.equal(out.balanceDelta,0);results.push({engine:engine.name(),name:'commit NACK keeps prior durable head and rolls back financial books',...out});
  out=await credit('QA-DIFF-NACK');assert.equal(out.rejected,false);assert.equal(out.attempts,1);assert.equal(out.openUploads,0);assert.equal(out.balanceDelta,100);assert.equal(out.savedBooksMatch,true);assert.equal(out.savedRowsMatch,true);results.push({engine:engine.name(),name:'same failed key retries once and reuses already uploaded immutable parts',...out});
  out=await credit('QA-DIFF-NACK');assert.equal(out.attempts,0);assert.equal(out.balanceDelta,0);results.push({engine:engine.name(),name:'successful receipt replay performs no save or financial effect',...out});
  out=await credit('QA-DIFF-CHUNK','chunk-nack',4000);assert.equal(out.rejected,true);assert.equal(out.attempts,0);assert.equal(out.booksRestored,true);assert.equal(out.financeRestored,true);assert.equal(out.headUnchanged,true);results.push({engine:engine.name(),name:'chunk refusal prevents manifest commit and financial publication',...out});
  out=await credit('QA-DIFF-CHUNK');assert.equal(out.rejected,false);assert.equal(out.attempts,1);assert.equal(out.balanceDelta,100);assert.equal(out.savedRowsMatch,true);results.push({engine:engine.name(),name:'retry after chunk refusal restores the complete world',...out});
  await page.evaluate(()=>{const q=__DIFF_VAULT__,id=JSON.parse(q.head).stateCodec.chunks.find(id=>id.includes('.o.'));q.chunks.delete(id);});
  out=await credit('QA-DIFF-MISSING');assert.equal(out.rejected,true);assert.equal(out.booksRestored,true);assert.equal(out.financeRestored,true);assert.equal(out.headUnchanged,true);assert.match(out.decodeError,/text-chunk-missing/);results.push({engine:engine.name(),name:'vault miss rejects the new manifest and requires repair of the missing part',...out});
  out=await credit('QA-DIFF-MISSING');assert.equal(out.rejected,false);assert.equal(out.balanceDelta,100);assert.ok(out.openUploads>0);assert.equal(out.savedRowsMatch,true);results.push({engine:engine.name(),name:'vault miss recovery reuploads referenced chunks and retries exactly once',...out});
  out=await page.evaluate(()=>{const q=__DIFF_VAULT__,ids=new Set(q.history.slice(-2).flatMap(json=>{const root=JSON.parse(json);return [...(root.fleet?.rows?.chunks||[]),...(root.stateCodec?.chunks||[])];}));return {known:GH_PERSISTENCE.vaultChunkCount(),retainedByTwoHeads:ids.size,oldManifestStillDecodes:GH_STATE_CODEC.deserialize(q.history[0],{resolveChunk:id=>q.chunks.get(id)}).qaMutableRows.length===5000};});
  assert.ok(out.known<=out.retainedByTwoHeads);assert.equal(out.oldManifestStillDecodes,true);results.push({engine:engine.name(),name:'upload knowledge follows the last two manifests without deleting vault files',...out});
  const seed=await page.evaluate(()=>{const q=__DIFF_VAULT__;return {json:q.head,chunks:[...q.chunks].map(([id,bytes])=>[id,GH_STATE_CODEC.bytesToBase64(bytes)]),books:JSON.stringify(__GH_STATE__.companyFinance),rows:JSON.stringify(__GH_STATE__.qaMutableRows)};});
  await page.close();await closeOrigin?.();closeOrigin=null;const rebooted=await bootAtOrigin({browser,errors,beforeScripts:{fn:seed=>{window.GH_NATIVE_BUILD=362;window.__GH_NATIVE_SAVE_JSON__=seed.json;window.__GH_NATIVE_SAVE_CHUNKS__=new Map(seed.chunks.map(([id,b64])=>[id,Uint8Array.from(atob(b64),c=>c.charCodeAt(0)).buffer]));},arg:seed}});page=rebooted.page;closeOrigin=rebooted.closeOrigin;
  out=await page.evaluate(()=>({books:JSON.stringify(__GH_STATE__.companyFinance),rows:JSON.stringify(__GH_STATE__.qaMutableRows),schema:GH_SAVE_SCHEMA.validate(__GH_STATE__).ok}));assert.equal(out.books,seed.books);assert.equal(out.rows,seed.rows);assert.equal(out.schema,true);
  await page.evaluate(installVault,seed);out=await credit('QA-DIFF-REBOOT');assert.equal(out.rejected,false);assert.equal(out.openUploads,0);assert.equal(out.balanceDelta,100);assert.equal(out.savedRowsMatch,true);results.push({engine:engine.name(),name:'native bootstrap restores books and mutable parts and adopts their identities',...out});
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await closeOrigin?.();}
}
if(process.env.GH_DIFFERENTIAL_RESULTS)fs.writeFileSync(process.env.GH_DIFFERENTIAL_RESULTS,JSON.stringify(results,null,2)+'\n');
console.log(JSON.stringify({suite:'build389-differential-browser',ok:true,results}));
})().catch(error=>{console.error(error);process.exitCode=1;});
