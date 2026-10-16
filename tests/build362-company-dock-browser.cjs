'use strict';
// Build 362 follow-up (owner report): with many companies, opening any page scrolled the company dock so the logos slid
// beneath the pinned "+" button. "+" now sits outside the scrolling logo strip: at every landscape size, after opening
// company and section pages, no visible logo intersects "+", and the active company's logo is fully visible.
const assert=require('node:assert/strict'),path=require('node:path'),{chromium,webkit}=require('playwright');
const {boot}=require('./helpers/local-dom-app');
const results=[];
(async()=>{for(const engine of [chromium,webkit]){
 const browser=await engine.launch({headless:true}),errors=[];
 try{for(const viewport of [{width:667,height:375},{width:844,height:390},{width:956,height:440}]){
  const {page}=await boot({browser,errors,viewport});
  await page.evaluate(async()=>{const s=__GH_STATE__;s.godMoney=true;s.infiniteMoney=true;for(const type of ['air','sea','road','power','bank','mobility','insurance','telecom','hospitality'])try{await __AUDIT__.runAuthorizedDomainCommand('corporate','open-company',{type,capital:120000000},{silent:true});}catch(_error){}});
  for(const [panel,arg,company] of [['company','air','air'],['company','telecom','telecom'],['hospitality',{company:'hospitality',tab:'overview'},'hospitality'],['finance',null,null]]){
   await page.evaluate(([p,a])=>__AUDIT__.openDrawer(p,a),[panel,arg]);await page.waitForTimeout(250);
   const m=await page.evaluate(()=>{const d=document.getElementById('companyDock'),add=d.querySelector('.dock-add'),strip=d.querySelector('.dock-strip'),a=add.getBoundingClientRect(),st=strip.getBoundingClientRect();
    const rows=[...strip.querySelectorAll('button[data-go="company"]')].map(b=>{const r=b.getBoundingClientRect(),left=Math.max(r.left,st.left),right=Math.min(r.right,st.right);return {go:b.dataset.goArg,on:b.classList.contains('on'),visible:right-left,full:r.left>=st.left-1.5&&r.right<=st.right+1.5,overlap:Math.max(0,Math.min(right,a.right)-Math.max(left,a.left))};});
    return {plusInside:strip.contains(add),rows};});
   assert.equal(m.plusInside,false,'"+" is outside the scrolling strip');
   for(const row of m.rows)if(row.visible>0)assert.equal(row.overlap,0,`${row.go} slides under "+" at ${JSON.stringify(viewport)} after ${panel}`);
   const active=m.rows.find(row=>row.on);if(company){assert(active,`${company} is active`);assert(active.full,`the active ${company} logo is fully visible at ${JSON.stringify(viewport)}`);}
  }
  results.push({engine:engine.name(),viewport});await page.close();
 }}finally{await browser.close();}
 assert.deepEqual(errors,[]);
}
console.log(JSON.stringify({suite:'build362-company-dock-browser',passed:results.length,results}));
})().catch(error=>{console.error(error);process.exitCode=1;});
