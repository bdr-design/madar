'use strict';
// Emulated-phone profile of decision commands (Chromium, 4x CPU, 20,000 assets): the first animation frame after every
// decision rebuilt the map's id->asset Map (presentationAssetLookup, 62 ms) because the index was keyed on saveRevision,
// although it is a pure function of the fleet rows array, which is replaced (never edited) on a source or membership
// change. Proven in the real app:
//  1. a durable save (saveRevision moves, same fleet) keeps the same index object;
//  2. a fleet membership change (a real purchase) rebuilds it, and the new asset resolves;
//  3. every asset in the rows resolves to its own row in the kept index.
const assert=require('node:assert/strict'),path=require('node:path'),{chromium}=require('playwright'),{bootRenderApp}=require('./helpers/render-app.cjs'),{installVault}=require('./helpers/differential-vault-fixture.cjs'),{prepare}=require('./helpers/request-decisions-fixture.cjs'),ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];let env;
  try{
    env=await bootRenderApp({browser,root:ROOT,errors,viewport:{width:844,height:390},beforeScripts:{fn:installVault}});const page=env.page;page.setDefaultTimeout(120000);
    await prepare(page,{rows:600});
    const out=await page.evaluate(async()=>{
      const a=__AUDIT__,first=a.presentationAssetLookup(),revision=__GH_STATE__.saveRevision;
      const saved=await a.saveNow();await a.whenStateIdle();
      const afterSave=a.presentationAssetLookup(),moved=__GH_STATE__.saveRevision!==revision;
      const rows=GH_FLEET_DATA.list(__GH_STATE__),resolves=rows.every(row=>afterSave.get(row.id)===row||afterSave.get(row.id)?.id===row.id);
      const size=GH_FLEET_DATA.size(__GH_STATE__);
      return {saved,moved,same:first===afterSave,resolves,size,indexSize:afterSave.size};
    });
    assert.equal(out.saved,true,'the durable save completed');assert.equal(out.moved,true,'saveRevision moved');
    assert.equal(out.same,true,'a save that leaves the fleet unchanged keeps the same map index');
    assert.equal(out.resolves,true,'every row resolves in the kept index');assert.equal(out.indexSize,out.size);
    const bought=await page.evaluate(async()=>{
      const a=__AUDIT__,before=a.presentationAssetLookup(),beforeSize=GH_FLEET_DATA.size(__GH_STATE__),base=__GH_STATE__.globalBases[0]?.id||__GH_STATE__.customHubs[0]?.id,model=[...GH_ASSET_CATALOG.air.used].sort((x,y)=>x.price-y.price)[0];
      __GH_STATE__.godMoney=true;__GH_STATE__.infiniteMoney=true;const ok=await a.buyAsset('air','used',model.id,'cash',1,base,true,'QA-INDEX-BUY','air');await a.whenStateIdle();
      const after=a.presentationAssetLookup(),rows=GH_FLEET_DATA.list(__GH_STATE__);
      return {ok:!!ok,rebuilt:after!==before,grew:GH_FLEET_DATA.size(__GH_STATE__)>beforeSize,resolvesNew:rows.every(row=>after.has(row.id)),indexSize:after.size,size:GH_FLEET_DATA.size(__GH_STATE__)};
    });
    assert.equal(bought.ok,true,'the purchase committed');assert.equal(bought.grew,true,'the fleet membership changed');
    assert.equal(bought.rebuilt,true,'a membership change rebuilds the index');assert.equal(bought.resolvesNew,true,'the new asset resolves');assert.equal(bought.indexSize,bought.size);
    const app=require('node:fs').readFileSync(path.join(ROOT,'WebApp/app.js'),'utf8');assert.ok(!/presentationAssetIndexRevision|presentationAssetIndexLength/.test(app),'the revision key is removed, not kept beside the source key');
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({suite:'build508-presentation-index-saves',ok:true,assets:out.size,afterPurchase:bought.size}));
  }finally{await Promise.race([browser.close(),new Promise(r=>setTimeout(r,15000))]);await env?.closeOrigin?.();}
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>process.exit(process.exitCode||0));
