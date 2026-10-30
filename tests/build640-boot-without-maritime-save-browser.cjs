'use strict';
// Reopening a large game (iPhone, 630,000 assets) began with a full sliced save that held the simulation for about 3 s
// (the clock stood still, then the backlog was cut): the two built-in sea templates (SEA_SIN_JED, SEA_RTM_NYC) are not
// saved and never carry the maritime geometry version, so app.js rebuilt them on every boot and asked for a save each
// time. Their geometry is still rebuilt in memory; only a saved route that changed asks for a save. Proven in the real
// app (Chromium, the native vault protocol double), a founded game reopened from its native save, on this source and with
// the app.js before (b87885e):
//  1. this source reopens the game without any save in its first seconds (the source before committed one at every boot);
//  2. the reopened game is the saved one (same simulation time and cash), and a durable command afterwards still saves;
//  3. a saved sea route that changes still asks for the save (source contract).
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {chromium}=require('playwright');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..'),PREVIOUS='b87885e';
const {bootRenderApp:boot}=require(path.join(ROOT,'tests/helpers/render-app.cjs')),{installVault}=require(path.join(ROOT,'tests/helpers/differential-vault-fixture.cjs'));
async function reopen(browser,root,seed){
  const errors=[],env=await boot({browser,root,errors,found:false,beforeScripts:{fn:installVault,arg:{...seed,bootstrap:true}}});const {page}=env;
  try{
    await page.waitForFunction(()=>window.__GH_STATE__?.onboardingComplete===true,null,{timeout:60000});
    await page.waitForTimeout(3000);
    const out=await page.evaluate(()=>({commits:__DIFF_VAULT__.attempts.length,sim:__GH_STATE__.simSeconds,cash:__GH_STATE__.cash}));
    return {...out,errors,page,env};
  }catch(error){await env.closeOrigin?.();throw error;}
}
(async()=>{
  const browser=await chromium.launch({headless:true});
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'gh-b640-'));
  try{
    // A founded game and its native save.
    const first=await boot({browser,root:ROOT,errors:[],beforeScripts:{fn:installVault}});
    await first.page.evaluate(async()=>{await __AUDIT__.whenStateIdle?.();});
    const seed=await first.page.evaluate(()=>{const q=__DIFF_VAULT__;return {json:q.head,chunks:[...q.chunks].map(([id,bytes])=>[id,GH_STATE_CODEC.bytesToBase64(bytes)])};});
    assert.ok(seed.json,'the founded game was saved');const saved=JSON.parse(seed.json);
    await first.page.close();await first.closeOrigin?.();
    // 1, 2. This source.
    const now=await reopen(browser,ROOT,seed);
    assert.equal(now.commits,0,`1: no save in the first seconds after reopening (${now.commits})`);
    assert.equal(now.sim,saved.simSeconds,'2: the saved simulation time');assert.equal(now.cash,saved.cash,'2: the saved cash');
    const after=await now.page.evaluate(async()=>{const a=__AUDIT__;await a.runAuthorizedDomainCommand('corporate','open-company',{type:'media',companyId:'media',capital:900000000,legalName:'QA media'},{silent:true}).catch(error=>({error:String(error?.message||error)}));await a.whenStateIdle?.();return {commits:__DIFF_VAULT__.attempts.length,ok:__DIFF_VAULT__.attempts.at(-1)?.ok===true};});
    assert.ok(after.commits>=1&&after.ok,'2: a durable command afterwards is saved');
    assert.deepEqual(now.errors,[],'no page errors');
    await now.page.close();await now.env.closeOrigin?.();
    // 1. The app.js before, everything else this source.
    fs.cpSync(path.join(ROOT,'WebApp'),path.join(tmp,'WebApp'),{recursive:true});fs.cpSync(path.join(ROOT,'tests'),path.join(tmp,'tests'),{recursive:true});
    fs.writeFileSync(path.join(tmp,'WebApp','app.js'),execFileSync('git',['-C',process.env.GH_B640_GIT_DIR||ROOT,'show',`${PREVIOUS}:WebApp/app.js`],{encoding:'utf8',maxBuffer:64*1024*1024}));
    const before=await reopen(browser,tmp,seed);
    assert.ok(before.commits>=1,`1: the app.js before saved at every boot (${before.commits})`);
    await before.page.close();await before.env.closeOrigin?.();
    // 3.
    const app=fs.readFileSync(path.join(ROOT,'WebApp/app.js'),'utf8');
    assert.match(app,/if\(index>=0\)\{state\.customRoutes\[index\]=\{\.\.\.state\.customRoutes\[index\],\.\.\.clone\(route\)\};maritimeSavedRouteChanged=true;\}/,'3: a saved sea route that changes is marked');
    assert.match(app,/if\(maritimeMigrationChanged\)\{state\.routesRevision=[^;]+;if\(maritimeSavedRouteChanged\)save\(\);\}/,'3: and asks for the save');
    console.log(JSON.stringify({suite:'build640-boot-without-maritime-save-browser',ok:true,bootCommits:{previous:before.commits,current:now.commits},afterCommand:after.commits}));
  }finally{fs.rmSync(tmp,{recursive:true,force:true});await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
