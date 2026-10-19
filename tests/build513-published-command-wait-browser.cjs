'use strict';
// fd9580f paints one frame between a command's publication and its page refresh while it still holds the lifecycle
// lock. A command started in that frame was refused as concurrent (durable-transaction-in-progress; build405 failed 4 of
// 4 at fd9580f, passed 4 of 4 before it). A command that has already published now lets the next one wait for it to
// settle. Proven in the real app (native-vault bridge fixture):
//  1. a second command started after the first published (from the first's after-publish work) waits and commits next,
//     at the following revision, with both effects saved;
//  2. a second command started while the first still waits for its save ACK is refused as before, and the first then
//     commits alone.
const assert=require('node:assert/strict'),path=require('node:path'),{chromium}=require('playwright'),{bootRenderApp}=require('./helpers/render-app.cjs'),{installVault}=require('./helpers/differential-vault-fixture.cjs'),{prepare}=require('./helpers/request-decisions-fixture.cjs'),ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];let env;
  try{
    env=await bootRenderApp({browser,root:ROOT,errors,viewport:{width:844,height:390},beforeScripts:{fn:installVault}});const page=env.page;page.setDefaultTimeout(120000);
    await page.evaluate(()=>__AUDIT__.whenStateIdle());await prepare(page,{rows:600});
    const out=await page.evaluate(async()=>{
      const a=__AUDIT__,s=()=>__GH_STATE__,q=__DIFF_VAULT__,accrue=number=>a.runAuthorizedDomainCommand('finance','accrue-expense',{company:'group',amount:1000,note:'QA '+number,counterparty:'QA Vendor LLC',taxable:false,number},{silent:true});
      const has=(state,number)=>(state.finance.payables||[]).some(row=>row.number===number),saved=()=>GH_STATE_CODEC.deserialize(q.head,{resolveChunk:id=>q.chunks.get(id)});
      await a.whenStateIdle();const start=s().saveRevision;let second=null,publishedSeen=false;
      // 1. Started from the first command's after-publish work (published, lock still held).
      const first=accrue('QA-WAIT-1');
      for(let i=0;i<200&&!window.__GH_DURABLE_COMMAND_CONTEXT__;i++)await new Promise(r=>setTimeout(r,0));
      window.__GH_DURABLE_COMMAND_CONTEXT__.afterPublish(()=>{publishedSeen=window.__GH_DURABLE_COMMAND_CONTEXT__?.published===true;second=accrue('QA-WAIT-2').then(()=>'committed',error=>String(error?.message||error));});
      await first;const secondResult=await second;await a.whenStateIdle();const head=saved();
      const waited={publishedSeen,secondResult,revisions:[start,s().saveRevision,head.saveRevision],live:[has(s(),'QA-WAIT-1'),has(s(),'QA-WAIT-2')],saved:[has(head,'QA-WAIT-1'),has(head,'QA-WAIT-2')]};
      // 2. Started while the first still waits for its save ACK.
      const before=s().saveRevision;q.hold=true;const held=accrue('QA-HELD-1');
      for(let i=0;i<2000&&!q.pending.length;i++)await new Promise(r=>setTimeout(r,5));
      const pendingAck=q.pending.length,refused=await accrue('QA-HELD-2').then(()=>'committed',error=>String(error?.message||error));
      q.hold=false;for(const ack of q.pending.splice(0))ack();await held;await a.whenStateIdle();const after=saved();
      const busy={pendingAck,refused,revisions:[before,s().saveRevision,after.saveRevision],live:[has(s(),'QA-HELD-1'),has(s(),'QA-HELD-2')],saved:[has(after,'QA-HELD-1'),has(after,'QA-HELD-2')]};
      return {waited,busy};
    });
    assert.equal(out.waited.publishedSeen,true,'the second command started after the first published');
    assert.equal(out.waited.secondResult,'committed','it waited for the first to settle instead of being refused');
    assert.deepEqual(out.waited.revisions,[out.waited.revisions[0],out.waited.revisions[0]+2,out.waited.revisions[0]+2],'two commits, one after the other');
    assert.deepEqual(out.waited.live,[true,true]);assert.deepEqual(out.waited.saved,[true,true],'both effects are saved');
    assert.equal(out.busy.pendingAck,1,'the first command waits for its ACK');assert.match(out.busy.refused,/durable-transaction-in-progress/,'a command still saving refuses the next one');
    assert.deepEqual(out.busy.revisions,[out.busy.revisions[0],out.busy.revisions[0]+1,out.busy.revisions[0]+1]);assert.deepEqual(out.busy.live,[true,false]);assert.deepEqual(out.busy.saved,[true,false]);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({suite:'build513-published-command-wait-browser',ok:true,...out}));
  }finally{await Promise.race([browser.close(),new Promise(r=>setTimeout(r,15000))]);await env?.closeOrigin?.();}
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>process.exit(process.exitCode||0));
