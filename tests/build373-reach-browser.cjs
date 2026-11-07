'use strict';
// Build 373 (owner: every page within three taps): from the rail, the company dock and the system button, walk what each
// opened page offers (panel tiles, the section strip, in-page links) and require every section page and every company
// page to be reached in at most three taps.
const assert=require('node:assert/strict');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');

(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    const {page}=await boot({browser,errors,viewport:{width:844,height:390}});page.setDefaultTimeout(60000);
    await page.evaluate(async()=>{const s=__GH_STATE__;s.godMoney=true;s.infiniteMoney=true;for(const row of GH_COMPANY_PLATFORM.listInstances(s,{includeGroup:false}))if(!row.operational){const d=row.definition;await __AUDIT__.runAuthorizedDomainCommand('corporate','open-company',{type:row.id,companyId:row.id,capital:d.founding.defaultCapital,legalName:`QA ${row.id}`,formationContract:`QA-REACH-${row.id}`},{silent:true});}});
    const result=await page.evaluate(()=>{
      const key=(panel,arg)=>JSON.stringify([panel,arg===undefined||arg===''?null:arg]);
      const parse=value=>{if(value===undefined)return undefined;try{return JSON.parse(value);}catch(_error){return value;}};
      const offered=()=>{const out=[];
        for(const el of document.querySelectorAll('#drawerBody [data-go],#sectionNav [data-go]'))out.push([el.dataset.go,parse(el.dataset.goArg)]);
        for(const el of document.querySelectorAll('#drawerBody [data-open]'))out.push([el.dataset.open,el.dataset.arg||undefined]);
        return out;};
      __AUDIT__.openDrawer('groupHub');__AUDIT__.closeDrawer?.();
      // One tap: the rail sections, the system button and each company in the dock.
      const roots=[...document.querySelectorAll('.side-nav button[data-panel]')].map(b=>[b.dataset.panel,undefined]);
      roots.push(['systemHub',undefined]);
      for(const b of document.querySelectorAll('#companyDock button[data-go]'))roots.push([b.dataset.go,parse(b.dataset.goArg)]);
      const depth=new Map(),queue=[];
      for(const [p,a] of roots){const k=key(p,a);if(!depth.has(k)){depth.set(k,1);queue.push([p,a,1]);}}
      while(queue.length){const [p,a,d]=queue.shift();if(d>=3)continue;__AUDIT__.openDrawer(p,a);
        for(const [np,na] of offered()){const k=key(np,na);if(!depth.has(k)){depth.set(k,d+1);queue.push([np,na,d+1]);}}}
      const required=[];
      for(const section of Object.values(GH_MADAR.SECTIONS))for(const [p,a] of section.pages)required.push([p,a===null?undefined:a]);
      for(const row of GH_MADAR.openedCompanies(__GH_STATE__)){required.push(['company',row.id]);for(const tile of GH_MADAR.tilesFor(__GH_STATE__,row.id)){const [p,a]=tile.to(row.id);required.push([p,a]);}}
      const missing=required.filter(([p,a])=>!depth.has(key(p,a))).map(([p,a])=>key(p,a));
      return {roots:roots.length,reached:depth.size,required:required.length,missing,deepest:Math.max(...required.map(([p,a])=>depth.get(key(p,a))||9))};
    });
    assert.deepEqual(result.missing,[],`pages beyond three taps: ${result.missing.join(', ')}`);
    assert(result.deepest<=3);assert.deepEqual(errors,[]);
    console.log(JSON.stringify({suite:'build373-reach-browser',...result}));console.log('BUILD373_REACH_BROWSER_PASS');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
