'use strict';
// Real bundled Arabic fonts, both browser engines, safe areas and actual taps. Preserve the existing design's
// routes/order/colours while checking the responsive dimensions, including the oldest landscape iPhone width.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const playwright=require('playwright'),{serve}=require('./helpers/web-server'),{drawFounderSignature}=require('./helpers/signature-input');
const root=path.resolve(__dirname,'..');
const devices=[[568,320,0,0],[667,375,0,0],[736,414,0,0],[812,375,50,21],[844,390,47,21],[852,393,59,21],[896,414,44,21],[932,430,59,21],[956,440,62,21]];
const fixture=require('./fixtures/phone-design-contract.json');
for(const [name,hash] of Object.entries(fixture.design_files))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,name))).digest('hex'),hash,`existing design changed: ${name}`);
const typography=new Set(['font-size','font-weight','font-variant-numeric','line-height','text-align','text-overflow','white-space','overflow-wrap','word-break','unicode-bidi','direction','letter-spacing','hyphens']);
const layout=new Set(['--panel','--gap','--rail','min-width','width','height','padding-inline','padding','padding-left','padding-right','padding-top','padding-bottom','padding-inline-start','padding-inline-end','gap','row-gap','column-gap','min-height']);

async function snapshot(page){return page.evaluate(()=>{
  const buttons=[...document.querySelectorAll('.app-shell button')].map(e=>({text:e.textContent.trim(),attributes:[...e.attributes].filter(a=>!['style'].includes(a.name)).map(a=>[a.name,a.value])}));
  const photos=[...document.querySelectorAll('#drawerBody img')].map(e=>({src:e.getAttribute('src'),colour:getComputedStyle(e).backgroundColor}));
  const cosmetics=[...document.querySelectorAll('.topbar,.side-nav,.sheet-dock,#drawerBody button')].map(e=>{const s=getComputedStyle(e);return [s.backgroundColor,s.color,s.borderRadius,s.order,s.pointerEvents,s.visibility]});
  return {buttons,photos,cosmetics};
});}

(async()=>{const server=await serve();const report=[];try{
for(const engine of ['chromium','webkit']){
  const browser=await playwright[engine].launch({headless:true});try{
  for(const [width,height,safe,bottom] of devices){
    const errors=[],page=await browser.newPage({viewport:{width,height},isMobile:true,hasTouch:true,locale:'ar-SA'});page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/app.js',route=>{const source=fs.readFileSync(path.join(root,'WebApp/app.js'),'utf8'),i=source.lastIndexOf('})();');return route.fulfill({contentType:'text/javascript',body:source.slice(0,i)+'\nwindow.__QA_PHONE__={openDrawer,closeDrawer,runAuthorizedDomainCommand};\n'+source.slice(i)});});
    await page.route(/https:\/\/(tile\.openstreetmap\.org|server\.arcgisonline\.com)\//,r=>r.abort());
    await page.goto(server.baseURL);await page.selectOption('#founderMode','sandbox');await page.click('#founderReview');await drawFounderSignature(page);await page.locator('#founderForm button[type=submit]').click();await page.waitForFunction(()=>__GH_STATE__?.onboardingComplete);
    if(await page.evaluate(()=>__GH_STATE__.speed>0))await page.tap('#speedToggle');
    await page.evaluate(()=>document.fonts.ready);
    await page.evaluate(async({safe,bottom})=>{const r=document.documentElement;r.style.setProperty('--safe-left',safe+'px');r.style.setProperty('--safe-right',safe+'px');r.style.setProperty('--safe-bottom',bottom+'px');const s=__GH_STATE__;s.godMoney=true;s.infiniteMoney=true;for(const row of GH_COMPANY_PLATFORM.listInstances(s,{includeGroup:false})){const d=row.definition;await __QA_PHONE__.runAuthorizedDomainCommand('corporate','open-company',{type:row.id,companyId:row.id,capital:d.founding.defaultCapital,legalName:`QA ${row.id}`,formationContract:`QA-PHONE-${row.id}`},{silent:true});}},{safe,bottom});
    assert.equal(await page.evaluate(()=>['GH Kufi Arabic','GH Plex Arabic'].every(name=>[...document.fonts].some(f=>f.family.replace(/["']/g,'')===name&&f.status==='loaded'))),true,'actual bundled Arabic fonts must load');
    const cssAudit=await page.evaluate(()=>{const out=[];const walk=(rules,file)=>{for(const rule of rules){if(rule.style)for(const property of rule.style)out.push([file,rule.selectorText,property,rule.style.getPropertyValue(property)]);if(rule.cssRules?.length)walk(rule.cssRules,file)}};for(const sheet of document.styleSheets)if(/phone-(typography|layout)\.css$/.test(sheet.href||''))walk(sheet.cssRules,sheet.href.includes('typography')?'type':'layout');return out;});
    for(const file of ['type','layout'])assert(cssAudit.some(row=>row[0]===file),`${file} stylesheet is loaded: ${JSON.stringify(cssAudit)}`);for(const [file,selector,property,value] of cssAudit){assert((file==='type'?typography:layout).has(property),`unapproved style property ${property}`);assert(!/cheque|financial-paper|invoice-paper|authority-paper/.test(selector),'official papers retain their design');assert(!/none|hidden/.test(value),`a responsive rule hid a control: ${selector}`);}
    const frame=await page.evaluate(()=>{const fields=[document.querySelector('.sim-clock-copy strong'),...document.querySelectorAll('.top-kpis strong'),document.querySelector('.top-news-ticker strong')],original=fields.map(e=>e.textContent),stress=['30 سبتمبر 2026','$8.08T','+$60.38B','توقيع عقد اتصالات مؤسسي متعدد السنوات مع مجموعة شركات'];fields.forEach((e,i)=>{e.textContent=stress[i];});const bar=document.querySelector('.topbar').getBoundingClientRect(),result={left:bar.left,right:bar.right,children:[...document.querySelector('.topbar').children].map(e=>{const r=e.getBoundingClientRect();return {class:e.className,left:r.left,right:r.right,top:r.top,bottom:r.bottom}}),height:innerHeight};fields.forEach((e,i)=>{e.textContent=original[i];});return result;});
    for(const c of frame.children){assert(c.left>=frame.left-1&&c.right<=frame.right+1,`${engine} ${width}: top capsule outside safe area ${JSON.stringify(c)}`);assert(c.top>=0&&c.bottom<=height,`${width}: capsule outside height`);}
    const ids=await page.evaluate(()=>__GH_STATE__.openedCompanies.slice());const views=[...['groupHub','financeHub','peopleHub','leadershipHub'].map(p=>[p,null]),...ids.map(id=>['company',id]),['assetMarket','air']];
    for(const [panel,arg] of views){await page.evaluate(([p,a])=>__QA_PHONE__.openDrawer(p,a),[panel,arg]);await page.evaluate(()=>{for(const link of document.querySelectorAll('link[href^="phone-"]'))link.sheet.disabled=true;});const baseline=await snapshot(page);await page.evaluate(()=>{for(const link of document.querySelectorAll('link[href^="phone-"]'))link.sheet.disabled=false;});assert.deepEqual(await snapshot(page),baseline,`${engine} ${width} ${panel}: content, actions/order or design identity changed`);
      const geometry=await page.evaluate(()=>{const body=document.querySelector('#drawerBody'),r=body.getBoundingClientRect(),dock=document.querySelector('.sheet-dock').getBoundingClientRect(),hero=body.querySelector('.asset-hero'),tiles=[...body.querySelectorAll('.mc-tile:not(.mc-hero)')];return{overflow:body.scrollWidth-body.clientWidth,left:dock.left,right:dock.right,bottom:dock.bottom,contentHeight:r.height,heroHeight:hero?.getBoundingClientRect().height,tiles:tiles.map(e=>e.getBoundingClientRect().height)}});
      assert.equal(geometry.overflow,0,`${width} ${panel}: horizontal content overflow`);assert(geometry.left>=safe-1&&geometry.right<=width-safe+1&&geometry.bottom<=height+1,`${width}: panel outside safe screen`);assert(geometry.contentHeight>100,'the panel must retain usable scrolling content');
      if(geometry.heroHeight)assert(Math.abs(geometry.heroHeight-Math.max(88,Math.min(130,height*.30)))<1,'photo uses viewport height');for(const tile of geometry.tiles)assert(Math.abs(tile-Math.max(60,Math.min(72,height*.18)))<1,`${engine} ${width}x${height} ${panel}: tile ${tile}, expected ${Math.max(60,Math.min(72,height*.18))}`);
    }
    // Real touches: every rail section, all company logos (including the scrolling dock), each speed, calendar,
    // news, alerts, settings, map filters, expanded/collapsed panel and company section navigation.
    for(const nav of ['companies','finance','people','leadership']){await page.tap(`.side-nav [data-nav="${nav}"]`);assert(await page.locator('.drawer.open').count());}
    for(let i=0;i<ids.length;i++){const id=ids[i];await page.tap('#brandBtn');await page.locator('#companyDock button[data-go="company"]').nth(i).tap();assert.equal(await page.locator('#drawerTitle').textContent(),await page.evaluate(id=>GH_IDENTITY.shortName(__GH_STATE__,id),id));}
    const sections=await page.locator('#sectionNav button').count();for(let i=0;i<sections;i++){await page.locator('#sectionNav button').nth(i).tap();assert(await page.locator('.drawer.open').count());}
    await page.tap('#brandBtn');await page.tap('#simCalendarToggle');assert.equal(await page.locator('#simCalendarToggle').getAttribute('aria-expanded'),'true');await page.tap('#simCalendarToggle');assert.equal(await page.locator('#simCalendarToggle').getAttribute('aria-expanded'),'false');
    for(const speed of [1,2,3,4]){const button=page.locator('#speedMenu button').nth(speed-1),value=Number(await button.getAttribute('data-speed'));await button.tap();assert.equal(await page.evaluate(()=>__GH_STATE__.speed),value);}await page.tap('#speedToggle');assert.equal(await page.evaluate(()=>__GH_STATE__.speed),0);
    for(const control of ['#topNewsTicker','#alertsBtn','#settingsBtn']){await page.tap('#brandBtn');await page.tap(control);assert(await page.locator('.drawer.open').count(),`${control} must still open its panel`);}
    await page.tap('#brandBtn');await page.tap('#filterToggle');assert.equal(await page.locator('#filterPopover').evaluate(e=>e.classList.contains('hidden')),false);await page.tap('#filterToggle');
    await page.evaluate(()=>__QA_PHONE__.openDrawer('company','air'));const expand=page.locator('#drawerExpand');await expand.tap();assert.equal(await expand.getAttribute('aria-pressed'),'true');await expand.tap();assert.equal(await expand.getAttribute('aria-pressed'),'false');
    if(width===932){await page.setViewportSize({width:568,height:320});await page.evaluate(()=>{for(const name of ['--safe-left','--safe-right','--safe-bottom'])document.documentElement.style.setProperty(name,'0px');});const resized=await page.evaluate(()=>{const b=document.querySelector('.topbar').getBoundingClientRect(),r=document.querySelector('.top-actions').getBoundingClientRect();return{left:b.left,actions:r.left,panel:document.querySelector('.sheet-dock').getBoundingClientRect().right,width:innerWidth}});assert(resized.actions>=resized.left-1&&resized.panel<=resized.width,'resize adapts without reload');await page.tap('#drawerExpand');await page.tap('#drawerExpand');await page.setViewportSize({width,height});}
    assert.deepEqual(errors,[],`${engine} ${width}: JavaScript errors`);report.push({engine,width,height,panels:views.length,companies:ids.length});await page.close();
  }
  }finally{await browser.close();}
}
console.log(JSON.stringify({suite:'phone-layout',cases:report.length,report}));
}finally{await server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
