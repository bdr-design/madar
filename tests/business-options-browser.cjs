'use strict';
const assert=require('node:assert/strict'),{chromium,webkit}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),{serve}=require('./helpers/web-server'),{drawFounderSignature}=require('./helpers/signature-input');
let server;
async function boot({browser,errors}){
 const page=await browser.newPage({viewport:{width:932,height:430},isMobile:true,hasTouch:true,locale:'ar-SA'});page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/app.js',route=>{const source=fs.readFileSync(path.resolve(__dirname,'../WebApp/app.js'),'utf8'),i=source.lastIndexOf('})();');return route.fulfill({contentType:'text/javascript',body:source.slice(0,i)+'\nwindow.__AUDIT__={openDrawer,closeDrawer,runAuthorizedDomainCommand,saveNow,currentPanel:()=>activeDrawerPanel};\n'+source.slice(i)});});
 await page.route(/https:\/\/(tile\.openstreetmap\.org|server\.arcgisonline\.com)\//,route=>route.abort());
 await page.goto(server.baseURL);await page.selectOption('#founderMode','sandbox');await page.click('#founderReview');await drawFounderSignature(page);await page.locator('#founderForm button[type=submit]').click();await page.waitForFunction(()=>window.__GH_STATE__?.onboardingComplete&&!window.__GH_DURABLE_COMMAND_CONTEXT__&&!document.getElementById('app')?.hasAttribute('inert'));if(await page.evaluate(()=>__GH_STATE__.speed>0))await page.tap('#speedToggle');await page.evaluate(()=>document.fonts.ready);return {page};
}
async function reboot(page){await page.reload();await page.waitForFunction(()=>window.__GH_STATE__?.onboardingComplete&&!window.__GH_DURABLE_COMMAND_CONTEXT__&&!document.getElementById('app')?.hasAttribute('inert'));return {page};}
async function settled(page){await page.waitForFunction(()=>{const k=GH_SIM_KERNEL.snapshot();return !k.manualAdvance&&!k.jobActive&&!GH_TRANSACTION_CORE.isStaged(__GH_STATE__)&&!GH_PERSISTENCE.isLocked()&&!window.__GH_DURABLE_COMMAND_CONTEXT__&&!window.__GH_APP_RUNTIME_INSTRUMENTATION__?.maintenance.pending?.length;});}
async function tapTile(page,key,panel){
 await settled(page);
 const before=await page.evaluate(()=>window.__QA_TILE_TOUCH__?.sequence||0);
 await page.locator(`[data-tile="${key}"]`).tap();
 try{await page.waitForFunction(expected=>__AUDIT__.currentPanel()===expected,panel,{timeout:15000});}
 catch(error){console.error('BUSINESS_TILE_NAVIGATION',JSON.stringify(await page.evaluate(()=>({event:window.__QA_TILE_TOUCH__,panel:__AUDIT__.currentPanel(),drawer:document.getElementById('drawer')?.dataset.panel,kernel:GH_SIM_KERNEL.snapshot(),maintenance:window.__GH_APP_RUNTIME_INSTRUMENTATION__?.maintenance}))));throw error;}
 const found=await page.evaluate(()=>({event:window.__QA_TILE_TOUCH__,panel:__AUDIT__.currentPanel(),drawer:document.getElementById('drawer').dataset.panel}));
 assert.equal(found.event.sequence,before+1,'one real touch click; no navigation retry');assert.equal(found.event.trusted,true);assert.equal(found.event.key,key);assert.equal(found.event.to,panel);assert.equal(found.panel,panel);assert.equal(found.drawer,panel);
}
async function capture(page,engine,c){if(!process.env.MADAR_REVIEW_IMAGES)return;fs.mkdirSync(process.env.MADAR_REVIEW_IMAGES,{recursive:true});await page.locator('#drawerBody .asset-hero img').evaluateAll(imgs=>imgs.forEach(i=>i.loading='eager'));await page.waitForFunction(()=>[...document.querySelectorAll('#drawerBody .asset-hero img')].every(i=>i.complete&&i.naturalWidth>0));await page.locator('#drawerBody').evaluate(body=>{const card=body.querySelector('.asset-market-card');body.scrollTop+=card.getBoundingClientRect().top-body.getBoundingClientRect().top;});await page.screenshot({path:path.join(process.env.MADAR_REVIEW_IMAGES,`${engine.name()}-${c}-review.png`)});}

const COMPANIES=['realestate','power','insurance','bank','telecom','dealership'];
(async()=>{
 server=await serve();try{
 for(const engine of [chromium,webkit]){
  const browser=await engine.launch({headless:true}),errors=[];
  try{
   let {page}=await boot({browser,errors});page.setDefaultTimeout(60000);page.on('dialog',d=>d.accept());
   // Test-only event evidence distinguishes a lost input from a delayed/wrong destination on mobile WebKit.
   await page.evaluate(()=>{document.addEventListener('click',event=>{const b=event.target.closest?.('[data-tile]');if(!b)return;window.__QA_TILE_TOUCH__={sequence:(window.__QA_TILE_TOUCH__?.sequence||0)+1,key:b.dataset.tile,to:b.dataset.go,trusted:event.isTrusted};},true);});
   await page.setViewportSize({width:932,height:430});
   assert.equal(await page.evaluate(()=>['GH Kufi Arabic','GH Plex Arabic'].every(name=>[...document.fonts].some(f=>f.family.replace(/["']/g,'')===name&&f.status==='loaded'))),true,'bundled fonts load');
   await page.evaluate(async companies=>{const s=__GH_STATE__;s.godMoney=true;s.infiniteMoney=true;for(const c of companies)await __AUDIT__.runAuthorizedDomainCommand('corporate','open-company',{type:c,companyId:c,capital:2000000000,legalName:`QA ${c}`,formationContract:`QA-ACQUISITION-${c}`},{silent:true});},COMPANIES);
   for(const c of COMPANIES){await page.evaluate(()=>__AUDIT__.openDrawer('network'));await page.selectOption('#worldKind',c);await page.locator('.open-directory-site').first().click();await page.waitForFunction(c=>[...__GH_STATE__.customHubs,...__GH_STATE__.globalBases].some(row=>row.owned&&(row.ownerCompanyId||row.company)===c),c);}
   await page.evaluate(()=>__AUDIT__.closeDrawer());await page.click('#simCalendarToggle');const beforeDay=await page.evaluate(()=>__GH_STATE__.simSeconds);await page.click('#simNextDay');await page.waitForFunction(t=>__GH_STATE__.simSeconds>=t+86400&&!GH_SIM_KERNEL.snapshot().manualAdvance,beforeDay);await page.click('#simCalendarToggle');
   // Markets are read-only, use real country prices and retain every old company destination.
   for(const c of COMPANIES){
    await settled(page);await page.evaluate(c=>__AUDIT__.openDrawer('company',c),c);
    const count=await page.locator('[data-tile="market"]').count();assert.equal(count,1,c);
    await tapTile(page,'market','companyMarket');
    assert.match(await page.locator('#drawerBody').textContent(),/السوق والمنافسون/);
    const stateBefore=await page.evaluate(()=>JSON.stringify([__GH_STATE__.companyFinance,__GH_STATE__.finance]));
    await page.selectOption('[data-business-country]', 'الهند');
    assert.equal(await page.evaluate(()=>JSON.stringify([__GH_STATE__.companyFinance,__GH_STATE__.finance])),stateBefore,'country selection cannot change money or documents');
    assert.equal(await page.locator('#drawerBody input,#drawerBody textarea').count(),0,'no typed field');
   }
   const fleetBefore=await page.evaluate(()=>JSON.stringify({catalog:GH_ASSET_CATALOG,priced:Object.values(GH_ASSET_CATALOG).filter(g=>Array.isArray(g.new)&&Array.isArray(g.used)).flatMap(g=>[...g.new,...g.used].map(item=>GH_GOVERNANCE_CORE.pricedAsset(__GH_STATE__,item))),customers:['air','sea','road','mobility'].map(c=>__GH_STATE__.customerCompanies?.companies?.[c]||null)}));
   // A rejected durable save must leave even the new receipt registry unpublished.
   const failedSave=await page.evaluate(async()=>{const s=__GH_STATE__,A=GH_OPERATING_ACQUISITIONS,target=A.targets(s,'realestate')[0],q=A.quote(s,'realestate',target.id,'office'),before=JSON.stringify([s.companyFinance,s.finance,s.realEstate]),persistence=GH_PERSISTENCE;let attempted=false;
    window.GH_PERSISTENCE={...persistence,commitDurableState:async()=>{attempted=true;throw new Error('qa-acquisition-save-failed');}};
    try{await __AUDIT__.runAuthorizedDomainCommand('realestate','acquire-operating',{targetId:q.targetId,variant:q.variant,quoteKey:q.quoteKey},{silent:true,idempotencyKey:`failed-save:${q.id}`});}catch(_error){}finally{window.GH_PERSISTENCE=persistence;}
    return {attempted,same:JSON.stringify([__GH_STATE__.companyFinance,__GH_STATE__.finance,__GH_STATE__.realEstate])===before,owned:Boolean(__GH_STATE__.finance.operatingAcquisitions?.[q.id])};});
   assert.deepEqual(failedSave,{attempted:true,same:true,owned:false},'failed persistence cannot publish cheque, money, contract or ownership');
   // Actual review/confirmation/touch -> signed command -> durable save for each business, with no infinite funding.
   await page.evaluate(()=>{__GH_STATE__.godMoney=false;__GH_STATE__.infiniteMoney=false;});
   for(const c of ['realestate','power','insurance','bank']){
    await settled(page);await page.evaluate(c=>__AUDIT__.openDrawer('company',c),c);await tapTile(page,'buy-working','operatingAssetMarket');
    assert.equal(await page.evaluate(()=>__AUDIT__.currentPanel()),'operatingAssetMarket');
    assert.equal(await page.evaluate(()=>{const card=document.querySelector('#drawerBody .business-offer-card');return Boolean(card)&&(!CSS.supports('content-visibility','auto')||getComputedStyle(card).contentVisibility==='auto');}),true,'an offer card off screen is neither laid out nor painted');
    const review=page.locator('[data-gh-action="operating-review"]').first();assert.equal(await review.count(),1,c);
    const key=await review.getAttribute('data-target'),variant=await review.getAttribute('data-variant');
    const quote=await page.evaluate(([c,t,v])=>GH_OPERATING_ACQUISITIONS.quote(__GH_STATE__,c,t,v),[c,key,variant]);
    const cash=await page.evaluate(c=>GH_FINANCE_CORE.operating(__GH_STATE__,c),c);
    await review.tap();assert.equal(await page.locator('[data-gh-action="operating-buy"]').count(),1);assert.deepEqual(await page.locator('.asset-hero-title').evaluate(e=>[...e.children].map(n=>n.tagName)),['DIV','B'],'same airline image title structure');
    await capture(page,engine,c);await page.locator('[data-gh-action="operating-buy"]').tap();await page.locator('.ui-confirm [data-confirm="accept"]').click();
    await page.waitForFunction(id=>Boolean(__GH_STATE__.finance.operatingAcquisitions?.[id]),quote.id);
    await page.waitForFunction(()=>GH_PERSISTENCE?.isLocked?.()!==true);
    const actual=await page.evaluate(([c,id])=>{const s=__GH_STATE__,r=s.finance.operatingAcquisitions[id],cheque=s.finance.cheques.find(row=>row.id===r.chequeId);return {cash:GH_FINANCE_CORE.operating(s,c),receipt:r,status:cheque?.status,valid:GH_SAVE_SCHEMA.validate(s).ok,integrity:GH_INTEGRITY_CORE.check(s).issues.filter(x=>x.severity==='critical')};},[c,quote.id]);
    assert.ok(Math.abs(actual.cash-(cash-quote.price+quote.transferredCash))<.01,c);assert.equal(actual.status,'مصروف');assert.equal(actual.valid,true);assert.deepEqual(actual.integrity,[],c);
    // Shrink without reloading: card images follow the same responsive airline dimensions.
    await page.setViewportSize({width:568,height:320});await page.evaluate(c=>__AUDIT__.openDrawer('operatingAssetMarket',{company:c,filter:'owned'}),c);
    const bounds=await page.evaluate(()=>{const b=document.getElementById('drawerBody'),hero=b.querySelector('.asset-hero'),r=hero.getBoundingClientRect();return {overflow:b.scrollWidth-b.clientWidth,hero:r.height,expected:Math.max(88,Math.min(130,innerHeight*.3))};});
    assert.ok(bounds.overflow<=1,JSON.stringify(bounds));assert.ok(Math.abs(bounds.hero-bounds.expected)<=1,JSON.stringify(bounds));
    await page.setViewportSize({width:932,height:430});
   }
   assert.equal(await page.evaluate(()=>JSON.stringify({catalog:GH_ASSET_CATALOG,priced:Object.values(GH_ASSET_CATALOG).filter(g=>Array.isArray(g.new)&&Array.isArray(g.used)).flatMap(g=>[...g.new,...g.used].map(item=>GH_GOVERNANCE_CORE.pricedAsset(__GH_STATE__,item))),customers:['air','sea','road','mobility'].map(c=>__GH_STATE__.customerCompanies?.companies?.[c]||null)})),fleetBefore,'business acquisitions must not change fleet customers, catalogues or prices');
   const receiptIds=await page.evaluate(()=>Object.keys(__GH_STATE__.finance.operatingAcquisitions));assert.equal(receiptIds.length,4);
   await page.evaluate(()=>__AUDIT__.closeDrawer());await page.click('#simCalendarToggle');const dayBefore=await page.evaluate(()=>__GH_STATE__.simSeconds);await page.click('#simNextDay');await page.waitForFunction(t=>__GH_STATE__.simSeconds>=t+86400&&!GH_SIM_KERNEL.snapshot().manualAdvance,dayBefore);await page.click('#simCalendarToggle');
   const revenue=await page.evaluate(()=>{const s=__GH_STATE__,receipts=Object.values(s.finance.operatingAcquisitions),property=receipts.find(r=>r.company==='realestate'),power=receipts.find(r=>r.company==='power');return {rent:s.realEstate.projects.find(p=>p.id===property.assetId).today.rent,energy:s.energy.dailyHistory[0].sites.find(p=>p.siteId===power.assetId).revenue,insurance:s.insurance.dailyHistory[0].premium,bank:s.bank.dailyHistory[0].interestIncome,valid:GH_SAVE_SCHEMA.validate(s).ok};});
   for(const field of ['rent','energy','insurance','bank'])assert.ok(revenue[field]>0,`next-day ${field} revenue`);assert.equal(revenue.valid,true);

   await page.evaluate(()=>__AUDIT__.saveNow());({page}=await reboot(page,{errors}));
   assert.deepEqual(await page.evaluate(()=>Object.keys(__GH_STATE__.finance.operatingAcquisitions)),receiptIds,'durable reload retains all ownership');
   for(const c of ['realestate','power','insurance','bank']){await page.evaluate(c=>__AUDIT__.openDrawer('operatingAssetMarket',{company:c,filter:'owned'}),c);assert.match(await page.locator('#drawerBody').textContent(),/تم شراء هذا العرض/);}
   assert.deepEqual(errors,[]);console.log(`BUSINESS_OPTIONS_BROWSER_PASS ${engine.name()}`);
  }finally{await browser.close();}
 }
 }finally{await server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
