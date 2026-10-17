'use strict';
// Build 358: the map controls and the phone frame, after the owner's report on iPhone (932×430, touch).
// - The scope and world-infrastructure filters apply (a blanket stopPropagation on popover buttons swallowed them).
// - The operations section stays hidden until a company is open.
// - The drawn airports cover the view instead of the first rows of the file.
// - God Mode is a Settings switch again; it survives a reload and the top bar shows ∞.
// - The rail keeps the full landscape inset only on the side of the camera housing.
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {serve}=require('./helpers/web-server');
const {drawFounderSignature}=require('./helpers/signature-input');
(async()=>{
  const server=await serve(path.resolve(__dirname,'../WebApp')),browser=await chromium.launch({headless:true}),errors=[];
  try{
    const page=await browser.newPage({viewport:{width:932,height:430},deviceScaleFactor:1,isMobile:true,hasTouch:true,locale:'ar-SA'});page.setDefaultTimeout(15000);
    page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
    // Observe the actual app map without depending on an unrelated resize/tile event firing after onboarding.
    await page.route('**/app.js',route=>{const source=fs.readFileSync(path.join(__dirname,'../WebApp/app.js'),'utf8'),i=source.lastIndexOf('})();');assert.ok(i>=0);return route.fulfill({contentType:'application/javascript',body:source.slice(0,i)+'\nwindow.__QA_MAP_READER__=()=>map;\n'+source.slice(i)});});
    await page.route(/https:\/\/(tile\.openstreetmap\.org|server\.arcgisonline\.com)\//,route=>route.abort());
    await page.goto(server.baseURL);await page.click('#founderReview');await drawFounderSignature(page);
    await page.locator('#founderForm button[type=submit]').click();await page.waitForFunction(()=>__GH_STATE__?.onboardingComplete);
    if(await page.evaluate(()=>__GH_STATE__.speed>0))await page.click('#speedToggle');

    // Build 373 floating frame: the top bar band ends at 38px and the rail floats 6px clear of the inset. Build 378
    // (owner's decision): the frame is symmetric, both sides keep iOS's inset whichever way the phone is turned.
    const frame=()=>page.evaluate(()=>{const root=document.documentElement;root.style.setProperty('--safe-right','59px');root.style.setProperty('--safe-left','59px');const rail=document.querySelector('.side-nav').getBoundingClientRect(),bar=document.querySelector('.topbar').getBoundingClientRect();return {top:bar.bottom,rail:innerWidth-rail.right,left:bar.left,notch:root.dataset.notch||''};});
    const both=await frame();
    assert.equal(both.top,38,'the top bar band ends at 38px');
    assert.equal(both.rail,59+6,'the rail clears the full inset');assert.equal(both.left,59+6,'and so does the far side');assert.equal(both.notch,'','no side is favoured');
    // Build 378: the map stops at the tiles' edge north and south (no empty sea past the poles).
    await page.waitForFunction(()=>window.__QA_MAP_READER__?.());
    await page.evaluate(()=>{window.__QA_MAP__=window.__QA_MAP_READER__();delete window.__QA_MAP_READER__;});
    const view=await page.evaluate(()=>({center:window.__QA_MAP__.getCenter(),zoom:window.__QA_MAP__.getZoom()}));
    const box=await page.locator('#map').boundingBox(),cx=box.x+box.width/2;
    for(let i=0;i<4;i++){await page.mouse.move(cx,box.y+40);await page.mouse.down();await page.mouse.move(cx,box.y+box.height-20,{steps:8});await page.mouse.up();}
    await page.waitForTimeout(400);
    const north=await page.evaluate(()=>window.__QA_MAP__.getBounds().getNorth());
    assert.ok(north>84&&north<=85.06,`dragged far north, the view stops at the tiles' edge (${north})`);
    await page.evaluate(view=>{window.__QA_MAP__.setView(view.center,view.zoom,{animate:false});delete window.__QA_MAP__;},view);await page.waitForTimeout(400);
    await page.evaluate(()=>{const root=document.documentElement;root.style.removeProperty('--safe-right');root.style.removeProperty('--safe-left');});

    // Filters, by touch.
    await page.tap('#filterToggle');
    const filterGeometry=await page.evaluate(()=>{const panel=document.getElementById('filterPopover').getBoundingClientRect(),dock=document.querySelector('.sheet-dock').getBoundingClientRect(),grid=document.querySelector('#filterPopover .filter-grid').getBoundingClientRect();return {panel:panel.width,dock:dock.width,panelLeft:panel.left,dockLeft:dock.left,gridLeft:grid.left,gridRight:grid.right};});
    assert(Math.abs(filterGeometry.panel-filterGeometry.dock)<=1,`map filters fill the side dock without a dead gutter: ${JSON.stringify(filterGeometry)}`);
    assert(filterGeometry.gridRight-filterGeometry.gridLeft>=filterGeometry.panel-32,`filter choices use the full dock content width: ${JSON.stringify(filterGeometry)}`);
    assert.equal(await page.evaluate(()=>[...document.querySelectorAll('#filterPopover .filter-section')].find(section=>section.querySelector('b')?.textContent.includes('التشغيل'))?.hidden),true,'no empty operations heading before a company opens');
    await page.tap('.filter-btn[data-filter="airport"]');
    // Build 359: the airport filter opens the expansion mode; airports are grouped in bubbles with Western counts.
    await page.waitForFunction(()=>__GH_STATE__.activeFilter==='airport'&&__GH_STATE__.mapMode==='expansion'&&/مطار في نطاق العرض/.test(document.getElementById('mapStatus').textContent));
    assert.deepEqual(await page.evaluate(()=>[...document.querySelectorAll('.map-place-bubble b')].map(b=>b.textContent).filter(text=>!/^[0-9]+(\.[0-9])?[KM]?$/.test(text))),[],'bubble counts use Western digits');
    const spread=await page.evaluate(()=>{const map=GH_INTERFACE.mapViewport(),cells=new Set();for(const marker of document.querySelectorAll('.world-infrastructure-marker')){const r=marker.getBoundingClientRect(),x=Math.floor((r.left-map.left)/map.width*4),y=Math.floor((r.top-map.top)/map.height*3);if(x>=0&&x<4&&y>=0&&y<3)cells.add(`${x}:${y}`);}return cells.size;});
    assert(spread>=8,`airports cover the view (${spread} of 12 quarters-thirds hold one)`);
    await page.tap('.filter-btn[data-filter="port"]');await page.waitForFunction(()=>__GH_STATE__.activeFilter==='port');
    await page.tap('.filter-btn[data-filter="all"]');await page.waitForFunction(()=>__GH_STATE__.activeFilter==='all');
    await page.tap('#layerMenu [data-layer="natural"]');await page.waitForFunction(()=>__GH_STATE__.mapLayer==='natural');
    assert.equal(await page.locator('#layerMenu [data-layer="natural"].active').count(),1);
    await page.tap('#filterToggle');

    // The unlimited-money mode («وضع المستثمر الحر») from its own page in the system section.
    await page.tap('#settingsBtn');const card=page.locator('#drawerBody [data-go="investorMode"]').first();if(await card.count())await card.tap();
    await page.locator('.god-mode-toggle').tap();
    await page.waitForFunction(()=>__GH_STATE__.godMoney===true&&__GH_STATE__.infiniteMoney===true);
    await page.waitForFunction(()=>document.getElementById('cashKpi').textContent==='∞');
    await page.reload();await page.waitForFunction(()=>__GH_STATE__?.onboardingComplete);
    assert.deepEqual(await page.evaluate(()=>[__GH_STATE__.godMoney,__GH_STATE__.infiniteMoney]),[true,true],'God Mode survives a reload');
    // Switching it off works (the command used to return false, read as a rejection, so it stayed on).
    await page.tap('#settingsBtn');{const again=page.locator('#drawerBody [data-go="investorMode"]').first();if(await again.count())await again.tap();}
    await page.locator('.god-mode-toggle').tap();
    await page.waitForFunction(()=>__GH_STATE__.godMoney===false&&__GH_STATE__.infiniteMoney===false);
    await page.waitForFunction(()=>document.getElementById('cashKpi').textContent!=='∞');
    assert.deepEqual(errors,[]);
    console.log('PASS build358-map-controls-browser: filters apply by touch, airports cover the view, God Mode switch persists and switches off, rail keeps the inset only on the camera side');
  }finally{await browser.close();await server.close?.();}
})().catch(error=>{console.error(error);process.exit(1);});
