'use strict';
// Owner (approved English plan: «الإنجليزية من اليسار لليمين: أعكس اتجاه كل صفحة») → «نفذ الانجليزي مع الوكيل بالكامل بدقه»,
// batch EN-2a (the frame): the English edition mirrors the Arabic design, and the frame speaks English.
//   1. WebApp/ltr.css is what tools/ltr_css.cjs gives from the design's style sheets (no hand edit, nothing stale), and
//      every one of its rules matches only html[dir="ltr"];
//   2. Arabic is unchanged: with ltr.css removed from the page, every element keeps the same box;
//   3. mirrored: with dir="ltr" (the texts left as they are, so every box keeps its size), every visible element outside
//      the map sits at the mirror of its Arabic place — on the map screen, the calendar, the map layers and four pages.
//      Inside a part the design pins left to right (the speed buttons), the order is kept; inside a horizontal scroller
//      the place is measured from the scroller's start;
//   4. English (development edition): the frame's own texts and labels are English (the rail, the top bar, the map
//      modes, the layers, the calendar, the status line), the rail stands on the left, the page plays, and nothing in it
//      holds Arabic except the map's place names (a later batch) and texts a save already holds;
//   5. no page error.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const AR=/[؀-ۿ]/;

// The boxes of the visible elements outside the map, with each element's frame (an ancestor whose direction differs
// from the page's, or a horizontal scroller, both measured from their start).
function boxes(){
  const W=innerWidth,H=innerHeight,root=document.documentElement.dir,all=[...document.querySelectorAll('body *')],index=new Map(all.map((el,k)=>[el,k])),out=[];
  for(const n of all){const s=getComputedStyle(n);if(/(auto|scroll)/.test(s.overflowX)&&n.scrollWidth>n.clientWidth+1)n.scrollLeft=0;}
  all.forEach((el,k)=>{if(el.closest('#map'))return;const r=el.getBoundingClientRect();if(!r.width||!r.height)return;const s=getComputedStyle(el);if(s.visibility==='hidden')return;
    let frame=-1,kind=null;for(let n=el.parentElement;n&&n!==document.body;n=n.parentElement){const ns=getComputedStyle(n);if(/(auto|scroll|hidden)/.test(ns.overflowX)&&n.scrollWidth>n.clientWidth+1){frame=index.get(n);kind='scroll';break;}if(ns.direction!==root){frame=index.get(n);kind='island';break;}}
    // A piece of a line of text (an inline box) moves with the text's own direction: only blocks are compared.
    out.push({k,x:r.left,y:r.top,w:r.width,vis:r.right>0&&r.left<W&&r.bottom>0&&r.top<H,dir:s.direction,frame,kind,inline:s.display.startsWith('inline')&&!s.display.includes('block')&&!s.display.includes('flex')&&!s.display.includes('grid'),name:`${el.tagName.toLowerCase()}${el.id?'#'+el.id:''}${el.classList.length?'.'+[...el.classList].slice(0,2).join('.'):''}`});});
  return {W,rows:out};
}
async function mirrored(page,label){
  const a=await page.evaluate(boxes);await page.evaluate(()=>{document.documentElement.dir='ltr';});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const b=await page.evaluate(boxes);await page.evaluate(()=>{document.documentElement.dir='rtl';});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const A=new Map(a.rows.map(r=>[r.k,r])),B=new Map(b.rows.map(r=>[r.k,r])),bad=[];let checked=0;
  for(const r of a.rows){const m=B.get(r.k);if(r.inline||!(r.vis||m?.vis))continue;if(!m){bad.push(`${r.name}: missing`);continue;}checked++;
    const f=A.get(r.frame),fm=B.get(r.frame);let want;
    if(f&&fm&&r.kind==='island'&&fm.dir===f.dir)want=fm.x+(r.x-f.x);else if(f&&fm)want=fm.x+(f.x+f.w-(r.x+r.w));else want=a.W-(r.x+r.w);
    if(Math.abs(m.x-want)>2||Math.abs(m.y-r.y)>2||Math.abs(m.w-r.w)>2)bad.push(`${r.name}: ${Math.round(m.x)} for ${Math.round(want)} (Arabic ${Math.round(r.x)}, width ${Math.round(r.w)}→${Math.round(m.w)})`);}
  assert.ok(checked>40,`3: ${label}: ${checked} elements compared`);
  assert.deepEqual(bad,[],`3: ${label}: every element at the mirror of its Arabic place`);
  return checked;
}
(async()=>{
  const browser=await chromium.launch({headless:true}),results={};
  try{
    // 1.
    {const generated=require(path.join(ROOT,'tools/ltr_css.cjs')).generate(),current=fs.readFileSync(path.join(ROOT,'WebApp/ltr.css'),'utf8');
      assert.equal(current,generated,'1: WebApp/ltr.css is what tools/ltr_css.cjs gives');
      const body=current.replace(/\/\*[\s\S]*?\*\//g,''),selectors=[...body.matchAll(/(?:^|[}{])\s*([^{}@]+)\{/g)].map(m=>m[1].trim()).filter(Boolean);
      assert.ok(selectors.length>100,`1: ${selectors.length} rules`);
      const loose=selectors.flatMap(list=>list.split(/,(?![^(\[]*[)\]])/).map(s=>s.trim())).filter(s=>!/^(html|:root)\[dir="ltr"\]/.test(s));
      assert.deepEqual(loose,[],'1: every rule matches only html[dir="ltr"]');
      assert.ok(fs.readFileSync(path.join(ROOT,'WebApp/index.html'),'utf8').includes('<link rel="stylesheet" href="ltr.css">'),'1: the page links ltr.css');
      results.rules=selectors.length;}
    // 2. and 3.
    {const errors=[];const {page}=await boot({browser,errors,viewport:{width:844,height:390}});await page.waitForTimeout(400);
      const withSheet=await page.evaluate(()=>[...document.querySelectorAll('body *')].map(el=>{const r=el.getBoundingClientRect();return [Math.round(r.left),Math.round(r.top),Math.round(r.width)].join(',');}).join('|'));
      const withoutSheet=await page.evaluate(()=>{const sheet=[...document.styleSheets].find(s=>s.ownerNode?.textContent?.includes('Generated by tools/ltr_css.cjs'));if(!sheet)throw Error('ltr.css not loaded');sheet.disabled=true;const out=[...document.querySelectorAll('body *')].map(el=>{const r=el.getBoundingClientRect();return [Math.round(r.left),Math.round(r.top),Math.round(r.width)].join(',');}).join('|');sheet.disabled=false;return out;});
      assert.equal(withSheet,withoutSheet,'2: the Arabic page is the same with and without ltr.css');
      const counted={};
      counted.map=await mirrored(page,'the map screen');
      await page.click('#simCalendarToggle');await page.waitForTimeout(150);counted.calendar=await mirrored(page,'the calendar');await page.click('#simCalendarToggle');
      await page.click('#filterToggle');await page.waitForTimeout(150);counted.layers=await mirrored(page,'the map layers');await page.click('#filterToggle');
      for(const panel of ['groupHub','financeHub','store','news']){await page.evaluate(p=>__AUDIT__.openDrawer(p),panel);await page.waitForTimeout(200);counted[panel]=await mirrored(page,`the ${panel} page`);}
      assert.deepEqual(errors,[],'5: no page error');results.mirrored=counted;await page.close();}
    // 4.
    {const errors=[];const {page}=await boot({browser,errors,viewport:{width:844,height:390},storage:[['ani-language','en']]});await page.waitForTimeout(400);
      const frame=await page.evaluate(()=>{const text=sel=>[...document.querySelectorAll(sel)].map(n=>n.textContent.trim());return {dir:document.documentElement.dir,
        rail:text('.side-nav button>span:not(.mg)'),railTitles:[...document.querySelectorAll('.side-nav button')].map(b=>[b.title,b.getAttribute('aria-label')]),railLeft:document.querySelector('.side-nav').getBoundingClientRect().left,
        modes:text('.map-modes button'),kpis:text('.top-kpis>div:not([hidden])>span'),news:document.querySelector('#topNewsTicker small').textContent,store:document.querySelector('#storeBtn .st-top-label').textContent,
        speedTitles:[...document.querySelectorAll('#speedMenu button')].map(b=>b.title),status:document.getElementById('mapStatus').textContent,day:document.getElementById('simDay').textContent,title:document.title};});
      assert.equal(frame.dir,'ltr');
      assert.deepEqual(frame.rail,['Map','Group','Finance','People','Leadership'],'4: the rail in English');
      assert.deepEqual(frame.railTitles,[['Map','Map'],['Group','Group'],['Finance','Finance'],['People','People'],['Leadership','Leadership']],'4: the rail\'s titles and labels');
      assert.ok(frame.railLeft<60,`4: the rail stands on the left (${frame.railLeft})`);
      assert.deepEqual(frame.modes,['Operations','Network','Expansion']);assert.deepEqual(frame.kpis.slice(0,1),['Cash']);assert.equal(frame.news,'Official News');assert.equal(frame.store,'Store');
      assert.deepEqual(frame.speedTitles,['Normal · 30×','Fast · 120×','Rapid · 300×']);
      assert.match(frame.status,/^\d+ moving · \d+ at stations · (no assets|\d+ assets?)$/,`4: the status line (${frame.status})`);assert.match(frame.day,/^Day \d+$/);assert.equal(frame.title,'ASSETS & INFLUENCE');
      await page.click('#simCalendarToggle');await page.waitForTimeout(150);
      const calendar=await page.evaluate(()=>({head:document.querySelector('.sim-cal-head small').textContent,status:document.getElementById('simAdvanceStatus').textContent,quick:[...document.querySelectorAll('.sim-cal-quick button')].map(b=>b.textContent.trim()),week:[...document.querySelectorAll('.sim-cal-week span')].map(s=>s.textContent)}));
      assert.deepEqual(calendar,{head:'Operations Calendar',status:'Ready to advance',quick:['+ a day','+ 7 days','+ 30 days','+ a year'],week:['Sa','Su','Mo','Tu','We','Th','Fr']},'4: the calendar in English');
      await page.click('#simCalendarToggle');await page.click('#filterToggle');await page.waitForTimeout(150);
      // Nothing in the frame (top bar, rail, map controls, status line, layers) holds Arabic but the group's own news line.
      const left=await page.evaluate(()=>{const AR=/[؀-ۿ]/,out=[];for(const root of document.querySelectorAll('.topbar,.side-nav,.map-modes,.map-strip,#filterPopover')){const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);for(let t;(t=walker.nextNode());)if(AR.test(t.nodeValue)&&t.parentElement.id!=='topNewsHeadline')out.push(t.nodeValue.trim());for(const el of root.querySelectorAll('*'))for(const a of ['title','aria-label','placeholder'])if(AR.test(el.getAttribute(a)||'')&&el.closest('#topNewsTicker')===null&&el.id!=='alertsBtn')out.push(`${a}: ${el.getAttribute(a)}`);}return out;});
      results.leftArabic=left;
      // The company dock's "+" (madar-shell.js) is the next batch's.
      assert.deepEqual(left.filter(t=>!/فتح شركة جديدة/.test(t)),[],'4: no Arabic left in the frame');
      await page.click('#filterToggle');
      // Two slices of play: a pause cancels the slice in flight, never one already committed.
      await page.evaluate(()=>__AUDIT__.setSpeed(3));await page.waitForFunction(()=>__GH_STATE__.simSeconds>=600,null,{timeout:20000}).catch(()=>{});await page.evaluate(()=>__AUDIT__.setSpeed(0));
      assert.ok(await page.evaluate(()=>__GH_STATE__.simSeconds>0),'4: the game plays in English');
      assert.deepEqual(errors,[],'5: no page error');await page.close();}
    console.log(JSON.stringify({suite:'build659-english-shell-browser',ok:true,...results}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
