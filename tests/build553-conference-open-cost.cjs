'use strict';
// Opening the conference stage repeated its work: the snapshot and plan were copied about six times and the plan hashed
// about eight times, and a preview of a year not yet held built its plan twice (a 131 ms long task at 4,400 assets on the
// desktop). Proven in the real app (its buttons, conference owner, plan model and stage), with only the native storage
// protocol doubled, counting the hashes of the plan and snapshot and their full copies while the stage opens:
//  1. a preview builds its plan once and hashes it at most four times (its own two, the stage's check of two);
//  2. starting a prepared conference (its start command builds and records the plan, the stage checks it) hashes and
//     copies the plan less than half as often as before;
//  3. both open on the same first chapter as before;
//  4. the previous source (run from its own tree) did several times the work on each.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const {bootAtOrigin,installVault}=require('./helpers/differential-vault-fixture.cjs'),{prepareCommandWorld}=require('./helpers/command-world-fixture.cjs');
const ROOT=path.resolve(__dirname,'..'),SOURCE=process.env.GH_TEST_SOURCE_DIR||ROOT,PREVIOUS='9186a26';
async function measure(root){
 const browser=await chromium.launch({headless:true}),errors=[];let env;try{
  env=await bootAtOrigin({browser,root,errors,fleetWorker:true,viewport:{width:956,height:440},beforeScripts:{fn:installVault}});const {page}=env;page.setDefaultTimeout(45000);await prepareCommandWorld(page,{count:2});
  await page.evaluate(async()=>{__GH_STATE__.simSeconds=365*86400;await __AUDIT__.runAuthorizedDomainCommand('conference','tick-day',{day:365},{silent:true});
   window.__qaCount=()=>{const cp=globalThis.GH_CONTROL_PLANE,sc=globalThis.structuredClone,js=JSON.stringify,counts={hashes:0,snapshotCopies:0,planCopies:0};
    const tally=v=>{if(!v||typeof v!=='object')return;if(v.modes&&v.planHash)counts.planCopies++;else if(v.companies&&v.group&&v.social)counts.snapshotCopies++;else if(v.snapshot?.companies){counts.snapshotCopies++;if(v.presentation?.planBundle)counts.planCopies++;}};
    globalThis.GH_CONTROL_PLANE={...cp,sha256:text=>{const t=String(text);if(t.includes('gh-conference-plan-v1')||t.includes('"social":')&&t.includes('"companies":'))counts.hashes++;return cp.sha256(text);}};globalThis.structuredClone=function(v,o){tally(v);return sc.call(this,v,o);};JSON.stringify=function(v,...rest){tally(v);return js.call(this,v,...rest);};
    return ()=>{globalThis.GH_CONTROL_PLANE=cp;globalThis.structuredClone=sc;JSON.stringify=js;return counts;};};});
  const open=async(action,prepare)=>{await page.evaluate(async prepare=>{if(prepare)await __AUDIT__.runAuthorizedDomainCommand('conference','prepare',{year:2026,packageId:'global'},{idempotencyKey:'QA-PREP-2026'});__AUDIT__.openDrawer('conference','overview');},prepare);
   await page.waitForSelector(`[data-gh-action="${action}"]`);if(await page.locator('#conferencePlaybackMode').count())await page.selectOption('#conferencePlaybackMode','manual');await page.waitForFunction(()=>!GH_PERSISTENCE.isLocked());
   await page.evaluate(()=>{window.__qaStop=__qaCount();});await page.locator(`[data-gh-action="${action}"]`).first().click();await page.waitForFunction(()=>GH_CONFERENCE_3D.isActive()&&GH_CONFERENCE_3D.diagnostics().phase==='presenting',null,{timeout:20000});
   const counts=await page.evaluate(()=>__qaStop()),chapter=await page.evaluate(()=>GH_CONFERENCE_3D.diagnostics().chapter);await page.locator('[data-c3="close"]').first().click();await page.waitForFunction(()=>!GH_CONFERENCE_3D.isActive()&&!GH_PERSISTENCE.isLocked());return {...counts,chapter};};
  const preview=await open('conference-stage-preview',false),start=await open('conference-start',true);assert.deepEqual(errors,[]);return {preview,start};
 }finally{await browser.close();await env?.closeOrigin?.();}}
(async()=>{
 const now=await measure(SOURCE);
 assert(now.preview.hashes<=4,`1: a preview hashes its plan at most four times (${JSON.stringify(now.preview)})`);
 assert(now.start.hashes<=8&&now.start.planCopies<=5&&now.start.snapshotCopies<=6,`2: starting a conference (${JSON.stringify(now.start)})`);
 assert.equal(now.preview.chapter,'opening');assert.equal(now.start.chapter,'opening','3: both open on the opening chapter');
 const tree=fs.mkdtempSync(path.join(os.tmpdir(),'b553-'));
 try{execFileSync('sh',['-c',`git -C "${ROOT}" archive ${PREVIOUS} WebApp | tar -x -C "${tree}"`]);
  const before=await measure(tree);assert.equal(before.start.chapter,now.start.chapter,'3: the previous source opened on the same chapter');
  assert(before.preview.hashes>=now.preview.hashes+3,`4: the previous preview hashed more (${JSON.stringify(before.preview)})`);
  assert(before.start.hashes>=now.start.hashes*2&&before.start.planCopies>=now.start.planCopies*2,`4: and so did its start (${JSON.stringify(before.start)})`);
  console.log(JSON.stringify({suite:'build553-conference-open-cost',ok:true,current:now,previous:before}));
 }finally{fs.rmSync(tree,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
