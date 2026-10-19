'use strict';
// Real app, operating world with a Mobility fleet (Chromium, native-vault bridge fixture). A bank decision's draft
// defers Mobility (build511). Proven end to end:
//  1. the decision commits, its draft never copied Mobility, and the live Mobility object is the same object after it;
//  2. the saved head, loaded back, holds exactly the live Mobility and the decided requests, at the new revision;
//  3. HR hiring (counts vehicles per center) and a Mobility purchase copy Mobility with the draft as before, and the
//     purchase is saved and published.
const assert=require('node:assert/strict'),path=require('node:path'),{chromium}=require('playwright'),{bootRenderApp}=require('./helpers/render-app.cjs'),{installVault}=require('./helpers/differential-vault-fixture.cjs'),{prepareOperatingWorld}=require('./helpers/all-operating-world.cjs'),fixture=require('./helpers/request-decisions-fixture.cjs'),ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];let env;
  try{
    env=await bootRenderApp({browser,root:ROOT,errors,measureSyncWork:true,viewport:{width:844,height:390},beforeScripts:{fn:installVault}});const page=env.page;page.setDefaultTimeout(300000);
    await page.evaluate(()=>__AUDIT__.whenStateIdle());
    const world=await prepareOperatingWorld(page,{rows:600,mobilityRows:120,fullDispatch:false});assert.equal(world.mobility,120);
    await fixture.installTrace(page);
    const ids=await fixture.seed(page,{kind:'bank',decision:'accept',count:3,seq:7});
    await page.evaluate(()=>{const b=__GH_STATE__.bank.branchNetwork?.[0];if(b)for(const r of __GH_STATE__.bank.loanRequests)r.branchId=b.id;window.__QA_MOBILITY__=__GH_STATE__.mobility;window.__QA_REVISION__=__GH_STATE__.saveRevision;});
    const button=await fixture.open(page,{kind:'bank',decision:'accept'});await fixture.press(page,button);await fixture.waitFinished(page);await page.evaluate(()=>__AUDIT__.whenStateIdle());
    const bank=await page.evaluate(ids=>{
      const d=GH_TRANSACTION_CORE.telemetry().lastDurable,q=__DIFF_VAULT__,saved=GH_STATE_CODEC.deserialize(q.head,{resolveChunk:id=>q.chunks.get(id)}),live=__GH_STATE__,status=s=>ids.map(id=>(s.bank.loanRequests||[]).find(r=>r.id===id)?.status??'decided');
      return {label:d.label,committed:d.committed,shared:d.deferredShared,copied:d.deferredCopied,sameObject:window.__QA_MOBILITY__===live.mobility,revision:[window.__QA_REVISION__,live.saveRevision,saved.saveRevision],mobilitySaved:JSON.stringify(saved.mobility)===JSON.stringify(live.mobility),vehicles:saved.mobility.vehicles.length,requests:[status(saved),status(live)]};
    },ids);
    assert.equal(bank.label,'banking:approve-loan-requests-batch');assert.equal(bank.committed,true);
    assert.equal(bank.shared,1,'the decision draft shared Mobility');assert.equal(bank.copied,0,'and never copied it');assert.equal(bank.sameObject,true,'the live Mobility object is kept');
    assert.equal(bank.revision[1],bank.revision[0]+1);assert.equal(bank.revision[2],bank.revision[1],'the head is the new revision');
    assert.equal(bank.mobilitySaved,true,'the saved Mobility equals the live Mobility');assert.equal(bank.vehicles,120);assert.deepEqual(bank.requests[0],bank.requests[1],'the decided requests are saved as published');
    const copied=await page.evaluate(async()=>{
      const out={},run=async(domain,name,payload)=>{const before=__GH_STATE__.mobility;await __AUDIT__.runAuthorizedDomainCommand(domain,name,payload,{silent:true});await __AUDIT__.whenStateIdle();const d=GH_TRANSACTION_CORE.telemetry().lastDurable,q=__DIFF_VAULT__,saved=GH_STATE_CODEC.deserialize(q.head,{resolveChunk:id=>q.chunks.get(id)});return {label:d.label,committed:d.committed,shared:d.deferredShared,copied:d.deferredCopied,sameObject:before===__GH_STATE__.mobility,vehicles:[saved.mobility.vehicles.length,__GH_STATE__.mobility.vehicles.length],mobilitySaved:JSON.stringify(saved.mobility)===JSON.stringify(__GH_STATE__.mobility)};};
      __GH_STATE__.godMoney=true;out.hire=await run('hr','hire',{company:'all',source:'QA deferred'});
      out.buy=await run('mobility','buy-fleet',{quantity:1,centerId:'RUH',classId:'eco-ev'});return out;
    });
    for(const [name,row] of Object.entries(copied)){assert.equal(row.committed,true,name);assert.equal(row.shared,0,`${name}: Mobility is copied with the draft`);assert.equal(row.copied,0,`${name}: not on first touch`);assert.equal(row.mobilitySaved,true,`${name}: the saved Mobility equals the live one`);}
    assert.deepEqual(copied.buy.vehicles,[121,121],'the purchase is saved and published');
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({suite:'build512-deferred-mobility-browser',ok:true,bank:{shared:bank.shared,copied:bank.copied},hire:copied.hire.label,buy:copied.buy.vehicles[0]}));
  }finally{await Promise.race([browser.close(),new Promise(r=>setTimeout(r,15000))]);await env?.closeOrigin?.();}
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>process.exit(process.exitCode||0));
