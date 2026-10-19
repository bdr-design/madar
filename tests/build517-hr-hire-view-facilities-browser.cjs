'use strict';
// The HR dashboard counts the facilities of the app's view: bases and hubs, regional offices and companies the group
// controls (a stake of 51% or more). Its "سد وظائف المنشآت" button sent the hiring command without that list, so HR
// hired from bases and hubs only: an acquired company's team (28) stayed a gap, coverage stayed under 100% and a second
// press committed a hiring of nobody (two hr:hire commits two seconds apart in an iPhone diagnostic). The button now
// hands the command the list it counted. Proven in the real app (Chromium, native-vault double), through the button:
//  1. a company acquired at 51% is a gap of the view, and not of a list without it (the command's old source);
//  2. a refused save (commit NACK) leaves the live state and the saved head as they were;
//  3. the press hires the acquired company's team: saved, coverage 100%, the button disabled;
//  4. a second press with no gap commits nothing.
const assert=require('node:assert/strict'),path=require('node:path'),{chromium}=require('playwright'),{bootRenderApp}=require('./helpers/render-app.cjs'),{installVault}=require('./helpers/differential-vault-fixture.cjs'),{prepare}=require('./helpers/request-decisions-fixture.cjs'),ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];let env;
  try{
    env=await bootRenderApp({browser,root:ROOT,errors,viewport:{width:844,height:390},beforeScripts:{fn:installVault}});const page=env.page;page.setDefaultTimeout(300000);
    await page.evaluate(()=>__AUDIT__.whenStateIdle());await prepare(page,{rows:40});
    const target=await page.evaluate(async()=>{const s=__GH_STATE__,c=s.simulationWorld.competitors.find(row=>!(s.stakes?.[row.id]>0));await __AUDIT__.runAuthorizedDomainCommand('market','buy-stake',{id:c.id,target:51},{silent:true});await __AUDIT__.whenStateIdle();
      // Bring every other facility to its team, so the acquired company is the only gap.
      await __AUDIT__.runAuthorizedDomainCommand('hr','hire',{company:'all',source:'QA setup'},{silent:true});await __AUDIT__.whenStateIdle();return {id:'ACQ-'+c.id,stake:s.stakes[c.id]};});
    assert.equal(target.stake,51);
    // The view is what the dashboard shows; "plain" is HR's own list without the view (bases and hubs).
    const read=()=>page.evaluate(id=>{__AUDIT__.openDrawer('labor','dashboard');const s=__GH_STATE__,q=__DIFF_VAULT__,saved=GH_STATE_CODEC.deserialize(q.head,{resolveChunk:x=>q.chunks.get(x)}),plain=GH_HR_CORE.snapshot(JSON.parse(JSON.stringify(s)),{},'all');
      const card=document.querySelector('#drawerBody .hr-command'),metric=Object.fromEntries([...card.querySelectorAll('.metric-row > div')].map(d=>[d.querySelector('span').textContent,Number(d.querySelector('b').textContent.replace(/[^0-9.]/g,''))]));
      const contracts=state=>(state.advanced?.labor?.employmentContracts||[]).filter(c=>c.facilityId===id&&c.status==='ساري').map(c=>c.count);
      return {revision:s.saveRevision,savedRevision:saved.saveRevision,view:{total:metric['عجز HR'],coverage:Number(card.querySelector('.tag').textContent.replace(/[^0-9]/g,''))},plain:{total:plain.total,counts:plain.facilities.some(f=>f.facilityId===id)},staff:s.advanced?.facilities?.[id]?.staff??null,savedStaff:saved.advanced?.facilities?.[id]?.staff??null,contracts:contracts(s),savedContracts:contracts(saved),labor:JSON.stringify(s.advanced.labor),head:q.head,attempts:q.attempts.length,alert:s.alerts?.[0]||null};},target.id);
    const press=async()=>{await page.evaluate(()=>{__AUDIT__.openDrawer('labor','dashboard');});const button=page.locator('#drawerBody [data-gh-action="hr-hire-all"]');await button.waitFor();const attempts=await page.evaluate(()=>__DIFF_VAULT__.attempts.length),disabled=await button.isDisabled();
      if(disabled)await page.evaluate(()=>document.querySelector('#drawerBody [data-gh-action="hr-hire-all"]').disabled=false);await button.click();
      await page.waitForFunction(n=>__DIFF_VAULT__.attempts.length>n,attempts,{timeout:20000}).catch(()=>{});await page.evaluate(()=>__AUDIT__.whenStateIdle());await page.waitForTimeout(300);return {disabled};};
    // 1. The view counts the acquired company; a list without the view does not.
    const before=await read();assert.equal(before.view.total,28,'the acquired company is the gap of the view: its team of 28');assert.ok(before.view.coverage<100);assert.deepEqual(before.plain,{total:0,counts:false},'a list without the view never had it');assert.equal(before.staff,null);
    // 2. A refused save changes nothing.
    await page.evaluate(()=>{__DIFF_VAULT__.mode='commit-nack';});const refused=await press(),afterNack=await read();await page.evaluate(()=>{__DIFF_VAULT__.mode='ok';});
    assert.equal(refused.disabled,false,'the button is enabled while there is a gap');assert.equal(afterNack.attempts,before.attempts+1,'the save was attempted once');
    assert.equal(afterNack.revision,before.revision,'no revision');assert.equal(afterNack.head,before.head,'the saved head is unchanged');assert.equal(afterNack.labor,before.labor,'HR is unchanged');assert.equal(afterNack.staff,null);assert.deepEqual(afterNack.view,before.view,'the gap stays');
    // 3. The press hires the acquired company's team, saved.
    const hired=await press(),after=await read();
    assert.equal(hired.disabled,false);assert.equal(after.revision,before.revision+1,'one commit');assert.equal(after.savedRevision,after.revision,'the head is the new revision');
    assert.equal(after.staff,28);assert.equal(after.savedStaff,28,'the team is saved');assert.deepEqual(after.savedContracts,[28],'one contract for the team, saved');assert.deepEqual(after.contracts,after.savedContracts);
    assert.deepEqual(after.view,{total:0,coverage:100},'no gap is left in the view');assert.match(after.alert,/تم توظيف 28 .*100%/,'the notice reports the 28 hires and 100%');
    // 4. A second press commits nothing.
    const again=await press(),last=await read();
    assert.equal(again.disabled,true,'the button is disabled once the gap is closed');assert.equal(last.revision,after.revision,'no second commit');assert.equal(last.attempts,after.attempts,'no second save');assert.equal(last.labor,after.labor);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({suite:'build517-hr-hire-view-facilities-browser',ok:true,facility:target.id,before:before.view,after:after.view,alert:after.alert}));
  }finally{await Promise.race([browser.close(),new Promise(r=>setTimeout(r,15000))]);await env?.closeOrigin?.();}
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>process.exit(process.exitCode||0));
