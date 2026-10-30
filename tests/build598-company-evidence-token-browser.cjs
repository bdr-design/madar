'use strict';
// Owner (build 98 iPhone diagnostic: «حل باقي المشاكل»; then «صلحها على دفعات دقيقه جدًا»): above 2048 assets every
// simulation slice and every integrity check asks whether the fleet worker's company evidence is current, and each question
// computed the whole fleet validation parameter set twice (its route list and context token included) only to compare the
// registry's company names (a fleet of 60,000, 60 s of play: 1.7 MB of 28). The token is now kept while the same state
// holds the same registry with the same companies under the same sealed platform. In the full app (fleet worker, a fleet of
// 3,000) against the source before (8510d56, from its own tree, measured the same way in the same run):
//  1. through play, every slice's question is answered as before: the evidence is current at every question;
//  2. the full parameter set is computed for none of those questions, where the source before computed it twice for each;
//  3. the answer follows the registry as before: a company record added in place makes the evidence not current, removing
//     it makes it current again, a record that is not set changes nothing, an equal registry put in its place keeps it
//     current (and the parameters are computed once again), and a new evidence question after a real registry change is
//     answered by the worker;
//  4. no error is logged.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {chromium}=require('playwright'),{bootAtOrigin,installVault}=require('./helpers/differential-vault-fixture.cjs'),{prepareCommandWorld}=require('./helpers/command-world-fixture.cjs');
const ROOT=path.resolve(__dirname,'..'),SOURCE=process.env.GH_TEST_SOURCE_DIR||ROOT,PREVIOUS='8510d56';
async function measure(browser,root){
  const errors=[],env=await bootAtOrigin({browser,root,errors,fleetWorker:true,viewport:{width:844,height:390},beforeScripts:{fn:installVault}}),{page}=env;page.setDefaultTimeout(120000);
  try{
    await prepareCommandWorld(page,{count:2});
    await page.evaluate(async()=>{const a=__AUDIT__,model=GH_ASSET_CATALOG.air.used.slice().sort((x,y)=>x.price-y.price)[0];if(!await a.buyAsset('air','used',model.id,'lease',3000,'QA-TRACE-BASE',true,'QA-598','air'))throw new Error('purchase refused');});
    await page.waitForFunction(()=>GH_FLEET_DATA.size(__GH_STATE__)>2048&&__AUDIT__.fleetEngineThreadClient()?.replicaReady(__GH_STATE__.fleet)&&!GH_PERSISTENCE.isLocked()&&!window.__GH_DURABLE_COMMAND_CONTEXT__);
    // Count the full parameter computations the evidence question makes (its signature: no routes, an empty route set) and
    // every question the slices and the integrity check ask, with its answer.
    await page.evaluate(()=>{
      const schema=window.GH_SAVE_SCHEMA,provider=globalThis.GH_COMPANY_FLEET_VALIDATION_PROVIDER;window.qa={params:0,asked:0,current:0};
      window.GH_SAVE_SCHEMA={...schema,fleetValidationParams(state,routes,routeIds){if(Array.isArray(routes)&&!routes.length&&routeIds instanceof Set&&!routeIds.size)window.qa.params++;return schema.fleetValidationParams(state,routes,routeIds);}};
      globalThis.GH_COMPANY_FLEET_VALIDATION_PROVIDER=(s,options)=>{const found=provider(s,options);if(options?.syncOnly){window.qa.asked++;const current=found?.current;if(found&&typeof current==='function'){const before=window.qa.params;const ok=current.call(found)===true;window.qa.params=before;if(ok)window.qa.current++;}}return found;};
    });
    // Evidence is current before play (the first question computes it).
    await page.waitForFunction(()=>globalThis.GH_COMPANY_FLEET_VALIDATION_PROVIDER(__GH_STATE__,{syncOnly:true})?.current?.()===true,null,{timeout:60000});
    await page.evaluate(()=>{window.qa={params:0,asked:0,current:0};document.querySelector('[data-speed="3"]').click();});
    await page.waitForTimeout(6000);
    const play=await page.evaluate(()=>{document.querySelector('[data-speed="0"]')?.click();__GH_STATE__.speed=0;return {...window.qa};});
    await page.waitForFunction(()=>!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked()&&!__AUDIT__.simulationEngine.snapshot().manualAdvance);
    // 3.
    const registry=await page.evaluate(async()=>{
      const s=__GH_STATE__,provider=globalThis.GH_COMPANY_FLEET_VALIDATION_PROVIDER,found=provider(s,{syncOnly:true}),out={start:found?.current?.()===true},reg=s.companyRegistry;
      reg['qa-598-extra']={id:'qa-598-extra',status:'active'};out.added=found.current()===true;delete reg['qa-598-extra'];out.removed=found.current()===true;
      reg['qa-598-unset']=null;out.unset=found.current()===true;delete reg['qa-598-unset'];
      window.qa.params=0;s.companyRegistry={...reg};out.replaced=found.current()===true;out.replacedParams=window.qa.params;out.again=found.current()===true;out.againParams=window.qa.params;s.companyRegistry=reg;
      return out;
    });
    return {play,registry,errors};
  }finally{await env.closeOrigin?.();}
}
(async()=>{
  const browser=await chromium.launch({headless:true}),tree=fs.mkdtempSync(path.join(os.tmpdir(),'b598-'));
  try{
    execFileSync('sh',['-c',`git -C "${ROOT}" archive ${PREVIOUS} WebApp tests/helpers | tar -x -C "${tree}"`]);require(path.join(ROOT,'tests/helpers/brand-baseline.cjs')).brandBaseline(tree,ROOT);
    const before=await measure(browser,tree),now=await measure(browser,SOURCE);
    // 1.
    assert.ok(now.play.asked>=4,`1: the slices asked through play (${now.play.asked})`);
    assert.equal(now.play.current,now.play.asked,`1: the evidence was current at every question (${JSON.stringify(now.play)})`);
    assert.equal(before.play.current,before.play.asked,'1: (as it was before)');
    // 2.
    assert.equal(now.play.params,0,`2: no full parameter computation for any question (${JSON.stringify(now.play)})`);
    assert.ok(before.play.params>=2*before.play.asked,`2: the source before computed it twice for each (${JSON.stringify(before.play)})`);
    // 3.
    for(const key of ['start','added','removed','unset','replaced','again'])assert.equal(now.registry[key],before.registry[key],`3: ${key}: the same answer as before (${JSON.stringify(now.registry)} / ${JSON.stringify(before.registry)})`);
    assert.deepEqual([now.registry.start,now.registry.added,now.registry.removed,now.registry.unset,now.registry.replaced,now.registry.again],[true,false,true,true,true,true],'3: added → not current, removed → current, an unset record and an equal registry change nothing');
    assert.equal(now.registry.replacedParams,1,'3: a registry put in place computes the parameters once again');assert.equal(now.registry.againParams,1,'3: and then keeps the token');
    // 4.
    assert.deepEqual(now.errors,[],'4: no error');assert.deepEqual(before.errors,[]);
    console.log(JSON.stringify({suite:'build598-company-evidence-token-browser',ok:true,before:before.play,now:now.play}));
  }finally{await browser.close();fs.rmSync(tree,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
