'use strict';
// Owner («راجع كل لوحات الشركات وكل خيار داخلي فيها وشوف تناسق الكلام والمربعات وتأكد منها واذا فيه اي مشاكل صلحها»):
// every opened company, on an operating world in the real app at phone landscape size, through its control panel and the
// company pages its tiles open (summary, management, assets, people, finance, sites, contracts, the finance centre):
//  1. no English key, developer note or untranslated term reaches the player (raw facility kinds such as «port-base»,
//     «CAPEX», «Mobility», «Street v3», «SLA», «PPA ·», contract penalties in English, bank acronyms, «Stage 1»);
//  2. numbers agree with their nouns («6 أصول», «20 أصلًا», «9 أشهر», «14 يومًا», «قرار واحد بانتظارك», «30 يومًا»), and
//     no figure carries a sign on zero («+$0», «−0.0%»);
//  3. what a page states agrees with the other pages: an empty official manager seat is not «تغطية القيادة 100%», a
//     company without moving assets shows no trips, fleet index or asset crew, the power assets tab reads the commissioned
//     stations, a page reached from a tile carries the tile's name, under the company's sector;
//  4. the boxes: a short status pill stays on one line, the odd last box of a two-column grid spans the row, a facility
//     row and the purchase card show their lines apart (they ran together), and no JavaScript error is raised.
// On the source before the fix (git 1d7dce1) claims 1–3 fail (GH_TEST_SOURCE_DIR pointing at that tree); the :is() check of
// claim 4 fails on f1f3448.
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||require('path').resolve(__dirname,'..');
const assert=require('node:assert/strict'),{chromium}=require('playwright');
const {bootRenderApp:boot}=require('./helpers/render-app.cjs'),{installVault}=require('./helpers/differential-vault-fixture.cjs'),{prepareOperatingWorld}=require('./helpers/all-operating-world.cjs');
const SERVICE=['media','healthcare','education','sports'];
// Claim 1: English and developer wording the player must not read.
// (Company names here are test data such as «QA Decision realestate», so the raw facility kinds are checked on the chip.)
const BANNED=[/CAPEX/,/وMobility/,/Street v3/,/\bSLA\b/,/PPA ·/,/Berth-window|Availability (?:LDs|penalties)|Crew reserve|Service credits|Demurrage/,/\b(?:HQLA|NSFR|LDR)\b/,/Stage \d/,/الخزينة وALM/,/\bactive\b/,
  /هذا الملخص يقود/,/واجهة مختصرة دون تكرار/,/أربع مساحات فقط/,/وبشكل ذري/,/دفعات وقائية/,/لا يعودان إلى الصفر/,/غير منطبق/];
// Claim 2: number–noun agreement and signed zeros (a digit run, then the wrong form of its noun).
const AGREEMENT=[[/(?:^|[^\d,.])(?:[3-9]|10) (?:أصل|شهر|يوم|ساعة|بحار|قرار)(?![ً-ْا])/,'3–10 take the plural'],[/(?:^|[^\d,.])(?:1[1-9]|[2-9]\d) (?:أصل|شهر|يوم|ساعة|بحار|موظف|قرار)(?![ً-ْا])/,'11–99 take the accusative singular'],[/(?:^|[^\d,.])0 أصل/,'zero takes «لا أصول»'],[/(?:^|[^\d,.])1 (?:فروع|قرارات|أصول|فرعًا)/,'one takes the singular'],[/(?:^|[^\d,.])(?:30|365) يوم(?![ً-ْا])/,'«30 يومًا»'],[/\+\$0(?![\d.])/,'no sign on zero'],[/[−-]0\.0%/,'no sign on zero']];
(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];let env=null;
  try{
    env=await boot({browser,root:process.env.GH_TEST_SOURCE_DIR,errors,beforeScripts:{fn:installVault},viewport:{width:844,height:390}});const {page}=env;page.setDefaultTimeout(900000);
    await prepareOperatingWorld(page,{rows:40,mobilityRows:6,fullDispatch:false});
    await page.evaluate(async service=>{const a=__AUDIT__,s=__GH_STATE__;for(const type of service){if(s.openedCompanies.includes(type))continue;const d=GH_COMPANY_PLATFORM.definitionFor(s,type);await a.runAuthorizedDomainCommand('corporate','open-company',{type,companyId:type,capital:Math.max(900000000,d?.founding?.minimumCapital||0),legalName:'QA '+type},{silent:true});}
      const start=s.simSeconds;window.__GH_MANUAL_CALENDAR_WINDOWS__=false;a.simulationEngine.advanceTo(start+2*86400,{speed:600,batchSeconds:3600,reason:'build614',maxSeconds:366*86400});for(let i=0;i<200000&&(a.simulationEngine.snapshot().manualAdvance||GH_TRANSACTION_CORE.isStaged(s));i++)await new Promise(r=>setTimeout(r,2));await a.whenStateIdle();},SERVICE);
    const companies=await page.evaluate(()=>GH_COMPANY_PLATFORM.listInstances(__GH_STATE__,{includeGroup:false,openedOnly:true}).filter(r=>r.operational).map(r=>r.id));
    assert.ok(companies.length>=15,`an operating world with every company (${companies.join(',')})`);
    const settle=async()=>{await page.evaluate(()=>__AUDIT__.whenStateIdle()).catch(()=>{});for(let i=0;i<25;i++){await page.waitForTimeout(60);if(!await page.locator('#drawerBody .route-center-loading').count())break;}};
    const read=()=>page.evaluate(()=>({eyebrow:document.querySelector('#drawerEyebrow')?.textContent||'',title:document.querySelector('#drawerTitle')?.textContent||'',text:document.querySelector('#drawerBody')?.innerText||''}));
    const open=async(panel,arg)=>{await page.evaluate(({panel,arg})=>__AUDIT__.openDrawer(panel,arg),{panel,arg});await settle();return read();};
    const pages=[],facts={};
    for(const id of companies){
      const info=await page.evaluate(id=>{const s=__GH_STATE__,d=GH_COMPANY_PLATFORM.definitionFor(s,id),caps=d?.capabilities||[];return {fleet:caps.includes('operations.fleet'),moving:caps.includes('operations.fleet')||caps.includes('operations.mobility'),manager:!!GH_HR_CORE.officialManager(s,id),primaryKind:d?.facilities?.primaryKind||''};},id);
      facts[id]=info;
      const panel=await open('company',id);pages.push({id,where:'panel',...panel});
      const tiles=await page.evaluate(()=>[...document.querySelectorAll('#drawerBody [data-go]')].map(b=>({panel:b.dataset.go,arg:b.dataset.goArg?JSON.parse(b.dataset.goArg):undefined,title:(b.querySelector('.mc-text b,.mc-kicker')?.textContent||'').trim()})));
      for(const tab of ['overview','management','assets','people','finance']){const p=await open('companyManage',{type:id,tab});pages.push({id,where:`manage:${tab}`,...p});facts[id][tab]=p;}
      await open('companyManage',{type:id,tab:'overview'});facts[id].chip=await page.evaluate(()=>document.querySelector('#drawerBody .company-operating-summary .tag')?.textContent||'');
      for(const tile of tiles.filter(t=>['companyFacilities','contracts','invoices','crews','budgets','assetMarket','routes'].includes(t.panel))){const p=await open(tile.panel,tile.arg);pages.push({id,where:`tile:${tile.panel}`,tile:tile.title,...p});}
    }
    // 1. Wording.
    const offences=[];
    for(const p of pages){const body=`${p.eyebrow}\n${p.title}\n${p.text}`;for(const rule of BANNED)if(rule.test(body))offences.push(`${p.id} ${p.where}: ${rule} «${(body.match(rule)||[''])[0]}»`);}
    for(const id of companies)if(/^[a-z-]+$/.test(facts[id].chip))offences.push(`${id} summary chip: «${facts[id].chip}»`);
    assert.deepEqual(offences,[],'1: English keys, untranslated terms and developer notes');
    // 2. Agreement and signs.
    const grammar=[];
    for(const p of pages)for(const line of p.text.split('\n'))for(const [rule,why] of AGREEMENT)if(rule.test(line))grammar.push(`${p.id} ${p.where}: ${why} «${line.trim().slice(0,90)}»`);
    assert.deepEqual(grammar,[],'2: numbers agree with their nouns');
    // 3. Agreement between pages.
    for(const id of companies){
      const f=facts[id];
      if(!f.manager){assert.match(f.management.text,/بلا مدير تنفيذي/,`3: ${id} with an empty manager seat says so`);assert.doesNotMatch(f.management.text,/تغطية القيادة/,`3: ${id} not «covered»`);}
      if(!f.fleet){assert.doesNotMatch(f.finance.text,/رحلات مسجلة/,`3: ${id} has no trips`);assert.doesNotMatch(f.overview.text,/مؤشر الأسطول/,`3: ${id} has no fleet index`);}
      if(!f.moving)assert.doesNotMatch(f.people.text,/طواقم الأصول|طاقم الأصول/,`3: ${id} has no asset crew`);
      for(const p of pages.filter(row=>row.id===id&&row.tile)){assert.equal(p.title,p.tile,`3: ${id} ${p.where} carries its tile's name`);}
    }
    // One thing, one name: the cards inside a page reached from a tile carry the tile's name, the company balance is
    // «رصيد الشركة», the power revenue lines and the bank's interest line read the same on every page, money is «$…».
    const STALE=[/مركز العقود الكبرى والمناقصات/,/ميزانيات الشهر/,/المالية والمستندات/,/رصيد الحساب(?! الجاري| المصدر)/,/صافي دخل الفائدة/,/عقود PPA/,/التخزين\/المراجحة/,/سعة\/موازنة/,/رواتب أصول شهرية/,/\d USD\b/,/مليون دولار/];
    const stale=[];for(const p of pages){const body=`${p.title}\n${p.text}`;for(const rule of STALE)if(rule.test(body))stale.push(`${p.id} ${p.where}: «${body.match(rule)[0]}»`);}
    assert.deepEqual(stale,[],'3: one thing, one name across the pages');
    for(const p of pages.filter(row=>row.tile&&/^tile:(companyFacilities|crews|budgets|invoices)$/.test(row.where)))assert(p.text.includes(p.tile),`3: ${p.id} ${p.where}: the card inside carries the tile's name «${p.tile}»`);
    // One scope, one count: the asset registry opened on a company counts that company (it read the group's total), and a
    // company's contracts list only the construction that company ordered.
    for(const id of companies.filter(id=>facts[id].moving)){
      await open('assets',id);
      const head=await page.evaluate(id=>{const s=__GH_STATE__,mobility=GH_COMPANY_PLATFORM.definitionFor(s,id)?.capabilities?.includes('operations.mobility'),own=mobility?(s.mobility?.vehicles||[]).length:GH_FLEET_DATA.filter(s,x=>(x.ownerCompanyId||x.companyId)===id).length,first=document.querySelector('#drawerBody .registry-hero .metric-row>div');return {own,label:first?.querySelector('span')?.textContent||'',shown:Number(String(first?.querySelector('b')?.textContent||'').replace(/[^\d]/g,''))};},id);
      assert.equal(head.shown,head.own,`3: ${id}: the registry head counts the company's own assets («${head.label}»)`);
    }
    const foreign=await page.evaluate(()=>(__GH_STATE__.constructionContracts||[]).filter(row=>row?.ownerCompanyId&&row?.siteName).map(row=>({owner:row.ownerCompanyId,site:row.siteName})));
    for(const p of pages.filter(row=>row.where==='tile:contracts'))for(const row of foreign)if(row.owner!==p.id&&!foreign.some(other=>other.owner===p.id&&other.site===row.site))assert(!p.text.includes(row.site),`3: ${p.id} contracts do not list ${row.owner}'s construction «${row.site}»`);
    const energy=await page.evaluate(()=>{const s=__GH_STATE__,sites=(s.energy?.sites||[]).filter(x=>x.commissioned===true&&!String(x.id||'').startsWith('LEGACY-'));return {solar:sites.filter(x=>x.kind==='solar').reduce((n,x)=>n+Number(x.capacity||0),0)};});
    if(energy.solar>0&&facts.power)assert.match(facts.power.assets.text,new RegExp(`شمسي\\s*${energy.solar.toLocaleString('en-US')} ميغاواط`),'3: the power assets tab reads the commissioned stations');
    // 4. Boxes (the computed layout of the rules madar-shell.css adds).
    const service=companies.find(id=>!facts[id].fleet)||companies[0];
    await open('companyManage',{type:service,tab:'management'});
    const tagWrap=await page.evaluate(()=>{const tag=document.querySelector('#drawerBody .list-item-head>.tag');return tag?getComputedStyle(tag).whiteSpace:null;});
    await open('companyManage',{type:service,tab:'finance'});
    const layout={tagWrap,...await page.evaluate(()=>{const grid=[...document.querySelectorAll('#drawerBody .metric-row')].find(row=>row.children.length%2===1);return {odd:grid?getComputedStyle(grid.lastElementChild).gridColumnStart+'/'+getComputedStyle(grid.lastElementChild).gridColumnEnd:null};})};
    assert.equal(layout.tagWrap,'nowrap','4: a status pill stays on one line');
    if(layout.odd)assert.equal(layout.odd,'1/-1','4: the odd last box spans the row');
    await open('companyFacilities',companies[0]);
    const lines=await page.evaluate(()=>{const row=document.querySelector('#drawerBody .facility-compact-row>div');return row?[...row.children].map(el=>getComputedStyle(el).display):null;});
    if(lines)assert.deepEqual([...new Set(lines)],['block'],'4: a facility row shows its name and city on lines of their own');
    // The shell's rules are written out, not grouped in :is()/:where(): a list there keeps the browser from setting aside
    // an element outside the drawer at once, and every div on the page walked its ancestors on each restyle (the
    // conference slides' style work grew a fifth; build575 failed in CI builds 110 and 111).
    const shellRules=require('fs').readFileSync(require('path').join(process.env.GH_TEST_SOURCE_DIR,'WebApp/madar-shell.css'),'utf8').replace(/\/\*[\s\S]*?\*\//g,'');
    assert.doesNotMatch(shellRules,/:(?:is|where)\(/,'4: the shell rules set aside an element outside their scope at once (no :is() lists)');
    // The app root carries the overlay state as classes (drawer-open, overlay-open) instead of :has() rules that searched the
    // whole app on every change inside it (opening a 38-element page restyled 687; 135 µs a check), and the classes follow
    // the drawer, the calendar, the layers popover and the asset card.
    const layoutRules=require('fs').readFileSync(require('path').join(process.env.GH_TEST_SOURCE_DIR,'WebApp/interface-layout.css'),'utf8').replace(/\/\*[\s\S]*?\*\//g,'');
    assert.doesNotMatch(layoutRules,/\.app-shell[^{,]*:has\(/,'4: no rule on the app root searches it with :has()');
    const overlay=async()=>{await page.waitForTimeout(30);return page.evaluate(()=>{const c=document.getElementById('app').classList;return `${c.contains('drawer-open')?'D':'-'}${c.contains('overlay-open')?'O':'-'}`;});};
    await open('companies');assert.equal(await overlay(),'DO','4: an open drawer sets both classes');
    await page.evaluate(()=>__AUDIT__.closeDrawer());assert.equal(await overlay(),'--','4: a closed drawer clears them');
    for(const id of ['simCalendarPanel','filterPopover','assetCard']){await page.evaluate(id=>document.getElementById(id).classList.remove('hidden'),id);assert.equal(await overlay(),'-O',`4: ${id} open sets overlay-open only`);await page.evaluate(id=>document.getElementById(id).classList.add('hidden'),id);assert.equal(await overlay(),'--',`4: ${id} closed clears it`);}
    assert.deepEqual(errors,[],'4: no JavaScript errors');
    console.log(JSON.stringify({suite:'build614-panel-copy',ok:true,companies:companies.length,pages:pages.length}));
  }finally{await browser.close();await env?.closeOrigin?.();}
})().catch(e=>{console.error(e);process.exitCode=1;});
