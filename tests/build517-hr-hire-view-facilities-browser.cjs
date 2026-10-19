'use strict';
// The HR dashboard counts the facilities of the app's view: bases and hubs, regional offices and companies the group
// controls (a stake of 51% or more). Its "سد وظائف المنشآت" button sent the hiring command without that list, so HR
// hired from bases and hubs only: an acquired company's team (28) stayed a gap, coverage stayed under 100% and a second
// press committed a hiring of nobody (two hr:hire commits two seconds apart in an iPhone diagnostic). The button now
// hands the command the list it counted. Proven in the real app (Chromium, native-vault double), through the button:
//  1. a company acquired at 51% is a gap of the view, and not of a list without it (the command's old source);
//  2. a refused save (commit NACK) leaves the live state and the saved head as they were;
//  3. the press hires the acquired company's team: saved, coverage 100%, the button disabled;
//  4. once the gap is closed the button is disabled and nothing more is saved;
//  5. selling the stake ends the team's contracts (their payroll and renewals stop): a refused save keeps them, the
//     committed sale ends them, saved, and the company leaves the view.
const assert=require('node:assert/strict'),path=require('node:path'),{chromium}=require('playwright'),{bootRenderApp}=require('./helpers/render-app.cjs'),{installVault}=require('./helpers/differential-vault-fixture.cjs'),{prepare}=require('./helpers/request-decisions-fixture.cjs'),ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];let env;
  try{
    env=await bootRenderApp({browser,root:ROOT,errors,viewport:{width:844,height:390},beforeScripts:{fn:installVault}});const page=env.page;page.setDefaultTimeout(300000);
    await page.evaluate(()=>__AUDIT__.whenStateIdle());await prepare(page,{rows:40});
    const target=await page.evaluate(async()=>{const s=__GH_STATE__,c=s.simulationWorld.competitors.find(row=>!(s.stakes?.[row.id]>0));await __AUDIT__.runAuthorizedDomainCommand('market','buy-stake',{id:c.id,target:51},{silent:true});await __AUDIT__.whenStateIdle();
      // Bring every other facility to its team, so the acquired company is the only gap.
      await __AUDIT__.runAuthorizedDomainCommand('hr','hire',{company:'all',source:'QA setup'},{silent:true});await __AUDIT__.whenStateIdle();return {id:'ACQ-'+c.id,company:c.id,stake:s.stakes[c.id]};});
    assert.equal(target.stake,51);
    // The view is what the dashboard shows; "plain" is HR's own list without the view (bases and hubs).
    const read=()=>page.evaluate(id=>{__AUDIT__.openDrawer('labor','dashboard');const s=__GH_STATE__,q=__DIFF_VAULT__,saved=GH_STATE_CODEC.deserialize(q.head,{resolveChunk:x=>q.chunks.get(x)}),plain=GH_HR_CORE.snapshot(JSON.parse(JSON.stringify(s)),{},'all');
      const card=document.querySelector('#drawerBody .hr-command'),metric=Object.fromEntries([...card.querySelectorAll('.metric-row > div')].map(d=>[d.querySelector('span').textContent,Number(d.querySelector('b').textContent.replace(/[^0-9.]/g,''))]));
      const contracts=state=>(state.advanced?.labor?.employmentContracts||[]).filter(c=>c.facilityId===id&&c.status==='ساري').map(c=>c.count),team=state=>(state.advanced?.labor?.employmentContracts||[]).filter(c=>c.facilityId===id).map(c=>({company:c.company,count:c.count,salary:c.salary,status:c.status,endReason:c.endReason||null}));
      return {revision:s.saveRevision,savedRevision:saved.saveRevision,view:{total:metric['عجز HR'],coverage:Number(card.querySelector('.tag').textContent.replace(/[^0-9]/g,''))},plain:{total:plain.total,counts:plain.facilities.some(f=>f.facilityId===id)},staff:s.advanced?.facilities?.[id]?.staff??null,savedStaff:saved.advanced?.facilities?.[id]?.staff??null,contracts:contracts(s),savedContracts:contracts(saved),team:team(s),savedTeam:team(saved),stake:s.stakes?.[id.slice(4)]??null,labor:JSON.stringify(s.advanced.labor),head:q.head,attempts:q.attempts.length,alert:s.alerts?.[0]||null};},target.id);
    // A press waits for its one save attempt; a disabled button is not pressed.
    const click=async(panel,arg,selector)=>{await page.evaluate(([panel,arg])=>__AUDIT__.openDrawer(panel,arg),[panel,arg]);const button=page.locator(selector);await button.waitFor();if(await button.isDisabled())return {disabled:true};
      const attempts=await page.evaluate(()=>__DIFF_VAULT__.attempts.length);await button.click();await page.waitForFunction(n=>__DIFF_VAULT__.attempts.length>n,attempts,{timeout:20000});await page.evaluate(()=>__AUDIT__.whenStateIdle());await page.waitForTimeout(300);return {disabled:false};};
    const press=()=>click('labor','dashboard','#drawerBody [data-gh-action="hr-hire-all"]'),sell=()=>click('market','deals',`#drawerBody .sell-stake[data-id="${target.company}"]`);
    // 1. The view counts the acquired company; a list without the view does not.
    const before=await read();assert.equal(before.view.total,28,'the acquired company is the gap of the view: its team of 28');assert.ok(before.view.coverage<100);assert.deepEqual(before.plain,{total:0,counts:false},'a list without the view never had it');assert.equal(before.staff,null);
    // 2. A refused save changes nothing.
    await page.evaluate(()=>{__DIFF_VAULT__.mode='commit-nack';});const refused=await press(),afterNack=await read();await page.evaluate(()=>{__DIFF_VAULT__.mode='ok';});
    assert.equal(refused.disabled,false,'the button is enabled while there is a gap');assert.equal(afterNack.attempts,before.attempts+1,'the save was attempted once');
    assert.equal(afterNack.revision,before.revision,'no revision');assert.equal(afterNack.head,before.head,'the saved head is unchanged');assert.equal(afterNack.labor,before.labor,'HR is unchanged');assert.equal(afterNack.staff,null);assert.deepEqual(afterNack.view,before.view,'the gap stays');
    // 3. The press hires the acquired company's team, saved.
    const hired=await press(),after=await read();
    assert.equal(hired.disabled,false);assert.equal(after.revision,before.revision+1,'one commit');assert.equal(after.savedRevision,after.revision,'the head is the new revision');
    assert.equal(after.staff,28);assert.equal(after.savedStaff,28,'the team is saved');assert.deepEqual(after.savedContracts,[28],'one contract for the team, saved');assert.deepEqual(after.contracts,after.savedContracts);assert.deepEqual(after.savedTeam,[{company:'group',count:28,salary:5200,status:'ساري',endReason:null}],'the group employs the team at the facility salary');
    assert.deepEqual(after.view,{total:0,coverage:100},'no gap is left in the view');assert.match(after.alert,/تم توظيف 28 .*100%/,'the notice reports the 28 hires and 100%');
    // 4. Nothing more to press.
    const again=await press(),last=await read();
    assert.equal(again.disabled,true,'the button is disabled once the gap is closed');assert.equal(last.revision,after.revision,'no second commit');assert.equal(last.attempts,after.attempts,'no second save');assert.equal(last.labor,after.labor);
    // 5. The sale ends the team. A refused save first: the team stays.
    await page.evaluate(()=>{__DIFF_VAULT__.mode='commit-nack';});const sellRefused=await sell(),keptTeam=await read();await page.evaluate(()=>{__DIFF_VAULT__.mode='ok';});
    assert.equal(sellRefused.disabled,false);assert.equal(keptTeam.revision,last.revision);assert.equal(keptTeam.head,last.head);assert.equal(keptTeam.labor,last.labor,'HR is unchanged');assert.equal(keptTeam.staff,28);assert.equal(keptTeam.stake,51);
    await sell();const sold=await read();
    assert.equal(sold.stake,null,'the stake is sold');assert.equal(sold.revision,last.revision+1,'one commit');assert.equal(sold.savedRevision,sold.revision);
    assert.deepEqual(sold.contracts,[],'no active contract for the team');assert.deepEqual(sold.savedTeam.map(c=>[c.status,c.endReason]),[['منتهي',sold.savedTeam[0].endReason]],'the saved contract is ended');assert.match(sold.savedTeam[0].endReason,/مع بيع الحصة/);assert.deepEqual(sold.team,sold.savedTeam);
    assert.equal(sold.staff,null,'the facility model is removed');assert.equal(sold.savedStaff,null);assert.deepEqual(sold.view,{total:0,coverage:100},'the company has left the view');
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({suite:'build517-hr-hire-view-facilities-browser',ok:true,facility:target.id,before:before.view,after:after.view,alert:after.alert,sold:sold.savedTeam[0]}));
  }finally{await Promise.race([browser.close(),new Promise(r=>setTimeout(r,15000))]);await env?.closeOrigin?.();}
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>process.exit(process.exitCode||0));
