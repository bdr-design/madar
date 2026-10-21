'use strict';
// The conference keynote, full screen, on every screen the game runs on (owner: «المؤتمر لايعجبني تصميمه سوي تصميم
// عصري ... اهم شي ابعاد الشاشة»; the old hall photograph showed the slide on 63% of a 956×440 iPhone, its controls over
// the audience). Proven with the shipped page and fonts, on a conference snapshot from the real finance and conference
// owners, at iPhone and iPad sizes in both orientations, with and without the iPhone's safe-area insets:
//  1. the slide fills the screen: the backdrop covers it, and the stage is the whole screen less the safe areas, the top
//     controls and, in landscape, the arrows at the sides (on a 956×440 iPhone 680×330 instead of the hall's 601×278);
//  2. every slide's content stays on the stage, a figure stays inside its tile, and nothing lies under a control;
//  3. no text is smaller than 12 px;
//  4. the controls are at least 44 px and inside the safe area; the arrows sit at the sides in landscape and below the
//     slide in portrait; the page does not scroll;
//  5. nothing of the old hall is loaded or drawn, and with reduced motion a slide runs no animation.
const assert=require('node:assert/strict'),path=require('node:path'),{chromium,webkit}=require('playwright'),{serve}=require('./helpers/web-server'),ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
// [width, height, [safe left, right, bottom, top]]: iPhone 16/17 Pro Max, iPhone 15 Pro Max, iPhone 14, iPhone SE,
// iPads, and both held upright.
const SCREENS=[[956,440,[62,62,20,0]],[956,440,[0,0,0,0]],[932,430,[59,59,21,0]],[844,390,[47,47,21,0]],[667,375,[0,0,0,0]],[1180,820,[0,0,20,0]],[1366,1024,[0,0,20,0]],[390,844,[0,0,34,47]],[820,1180,[0,0,20,24]]];
(async()=>{const results=[];for(const engine of [chromium,webkit]){
 const server=await serve(path.join(ROOT,'WebApp')),browser=await engine.launch({headless:true}),page=await browser.newPage({viewport:{width:956,height:440},locale:'ar-SA'}),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));try{
  await page.goto(server.baseURL);await page.waitForFunction(()=>window.GH_CONF_KEYNOTE&&window.GH_CONFERENCE_3D&&window.GH_CONFERENCE);
  await page.evaluate(()=>{
   const types=['air','sea','road','power','bank','mobility','insurance','realestate','telecom','dealership','hospitality'],seed={simSeconds:365*86400,openedCompanies:types,profile:{name:'مجموعة فنتورا العالمية',founder:'مؤسس المجموعة',reputation:75},hired:[],assets:[],globalBases:[],customHubs:[],branches:[],bank:{branches:32},energy:{solarMW:250},mobility:{vehicles:[]},companyRegistry:{}};
   const migrated=GH_COMPANY_PLATFORM.migrateState(seed);if(migrated.errors.length)throw Error(migrated.errors.join(','));const s=migrated.state;GH_FINANCE_CORE.ensure(s);GH_HR_CORE.ensure(s);
   for(let day=0;day<30;day++){const companies=Object.fromEntries(types.map((type,i)=>[type,{grossRevenue:123456789+i*9876543,expenses:23456789+i*12345678,net:100000000-i*2469135}]));GH_FINANCE_CORE.execute({state:s},'record-daily-close',{day,net:Object.values(companies).reduce((sum,r)=>sum+r.net,0),companies});}
   // The longest texts the slides carry: a large group value and rating, a long comment, long country names, three
   // achievements with long details.
   const snapshot=GH_CONFERENCE.buildSnapshot(s,2026);snapshot.group.groupValue=987654321098;snapshot.group.creditRating='AA+';
   snapshot.social={viewers:1284000,attendees:4200,likes:96500,positive:72,neutral:20,negative:8,comments:[{lang:'AR',text:'نتائج قوية جدًا هذا العام، أداء الطيران مبهر ونتطلع إلى المزيد من التوسع في الأسواق الخليجية والآسيوية',handle:'@saad_inv',country:'السعودية'},{lang:'AR',text:'متى تطرح المجموعة شركة الطاقة؟',handle:'@noura.m',country:'الإمارات'},{lang:'EN',text:'x',handle:'@j',country:'المملكة المتحدة'},{lang:'EN',text:'y',handle:'@k',country:'جمهورية الكونغو الديمقراطية'},{lang:'EN',text:'z',handle:'@l',country:'البوسنة والهرسك'}]};
   snapshot.achievements=[{title:'إطلاق 11 شركة في عام واحد',detail:'من الطيران إلى الضيافة، بأسطول يتجاوز ألفي أصل وخدمة في ثلاث قارات.'},{title:'تصنيف AA',detail:'رفع التصنيف الائتماني مرتين.'},{title:'4,200 حاضر',detail:'أكبر حضور منذ التأسيس.'}];
   window.qaSnapshot=snapshot;GH_CONFERENCE_3D.launch({snapshot},{mode:'manual'});
  });await page.waitForFunction(()=>GH_CONFERENCE_3D.diagnostics().phase==='presenting');await page.evaluate(()=>document.fonts.ready);assert(await page.evaluate(()=>document.fonts.check('600 20px "GH Plex Arabic"')),'the shipped Arabic font is loaded');
  for(const [width,height,[left,right,bottom,top]] of SCREENS){const label=`${width}×${height} insets ${left}/${right}/${bottom}/${top}`;
   await page.setViewportSize({width,height});await page.evaluate(([l,r,b,t])=>{const root=document.querySelector('.ghc3');root.style.setProperty('--safe-left',`${l}px`);root.style.setProperty('--safe-right',`${r}px`);root.style.setProperty('--safe-bottom',`${b}px`);root.style.setProperty('--safe-top',`${t}px`);},[left,right,bottom,top]);
   await page.waitForFunction(([w,h])=>innerWidth===w&&innerHeight===h&&document.querySelector('.ghc3')?.clientWidth===w&&document.querySelector('.ghc3')?.clientHeight===h,[width,height]);await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
   const m=await page.evaluate(([sl,sr,sb,st])=>{const W=innerWidth,H=innerHeight,R=e=>e.getBoundingClientRect(),count=GH_CONFERENCE_3D.diagnostics().slides,off=[],untiled=[],covered=[];let smallest=Infinity,smallestAt='';
    const controls=[...document.querySelectorAll('.ghc3-ctl button,.ghc3-chip')].filter(b=>!b.hidden&&b.offsetParent!==null).map(b=>({rect:R(b),name:String(b.dataset.c3||b.className)}));
    const over=(a,b)=>a.left<b.right-1&&b.left<a.right-1&&a.top<b.bottom-1&&b.top<a.bottom-1;
    for(let i=0;i<count;i++){GH_CONFERENCE_3D.go(i);document.getAnimations().forEach(a=>a.finish());const stage=R(document.querySelector('.ghc3-stage'));
     for(const el of document.querySelectorAll('.ghc3-beat *')){const b=R(el);if(!b.width||!b.height)continue;
      if(b.left<stage.left-1||b.right>stage.right+1||b.top<stage.top-1||b.bottom>stage.bottom+1)off.push(`${i}:${el.className}:${el.textContent.slice(0,30)}`);
      for(const c of controls)if(over(b,c.rect))covered.push(`${i}:${el.className}:${c.name}`);
      if([...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())){const f=parseFloat(getComputedStyle(el).fontSize);if(f<smallest){smallest=f;smallestAt=`${i}:${el.className}:${el.textContent.slice(0,20)}`;}}}
     for(const t of document.querySelectorAll('.ghc3-trio>div,.ghc3-list>div,.ghc3-parts>div')){const tb=R(t);for(const el of t.querySelectorAll('*')){const b=R(el);if(b.width&&(b.left<tb.left-1||b.right>tb.right+1||b.top<tb.top-1||b.bottom>tb.bottom+1))untiled.push(`${i}:${el.tagName}:${el.textContent.slice(0,20)}`);}}}
    GH_CONFERENCE_3D.go(0);const stage=R(document.querySelector('.ghc3-stage')),backdrop=R(document.querySelector('.ghc3-backdrop')),arrows=['prev','next'].map(n=>R(document.querySelector(`[data-c3="${n}"]`)));
    const unsafe=controls.filter(({rect:r,name})=>r.left<sl-1||r.right>W-sr+1||r.top<st-1||r.bottom>H-sb+1||(name!=='ghc3-chip'&&(r.width<44||r.height<44))).map(c=>c.name);
    return {slides:count,stage:{x:stage.left,y:stage.top,w:stage.width,h:stage.height},covers:backdrop.left<=.5&&backdrop.top<=.5&&backdrop.right>=W-.5&&backdrop.bottom>=H-.5,
     arrows:arrows.map(r=>({x:r.left,y:r.top,cy:r.top+r.height/2})),off:off.slice(0,6),offCount:off.length,untiled:untiled.slice(0,6),untiledCount:untiled.length,covered:[...new Set(covered)].slice(0,6),coveredCount:covered.length,smallest,smallestAt,unsafe,
     scroll:document.documentElement.scrollWidth>W||document.querySelector('.ghc3').scrollWidth>W,hall:document.querySelectorAll('.ghc3-hall,.ghc3-led,.ghc3-side').length};},[left,right,bottom,top]);
   const landscape=width>height,near=(a,b)=>Math.abs(a-b)<=1;
   assert(m.covers,`1: the slide's backdrop covers the screen at ${label}`);
   assert(near(m.stage.y,top+64)&&near(m.stage.y+m.stage.h,height-bottom-(landscape?26:84)),`1: the stage runs from below the top controls to the bottom at ${label}: ${JSON.stringify(m.stage)}`);
   assert(near(m.stage.x,left+(landscape?76:20))&&near(m.stage.x+m.stage.w,width-right-(landscape?76:20)),`1: the stage spans the screen between the arrows at ${label}: ${JSON.stringify(m.stage)}`);
   assert.equal(m.offCount,0,`2: every slide stays on the stage at ${label}: ${JSON.stringify(m.off)}`);assert.equal(m.untiledCount,0,`2: every figure stays in its tile at ${label}: ${JSON.stringify(m.untiled)}`);assert.equal(m.coveredCount,0,`2: no slide content under a control at ${label}: ${JSON.stringify(m.covered)}`);
   assert(m.smallest>=12,`3: no text under 12 px at ${label} (${m.smallest} ${m.smallestAt})`);
   assert.deepEqual(m.unsafe,[],`4: controls of 44 px inside the safe area at ${label}`);assert.equal(m.scroll,false,`4: no page scroll at ${label}`);
   if(landscape){const [prev,next]=m.arrows;assert(prev.x>width/2&&next.x<width/2&&near(prev.cy,m.stage.y+m.stage.h/2)&&near(next.cy,m.stage.y+m.stage.h/2),`4: the arrows sit at the sides, level with the slide, at ${label}: ${JSON.stringify(m.arrows)}`);}
   else assert(m.arrows.every(a=>a.y>m.stage.y+m.stage.h),`4: upright, the arrows sit below the slide at ${label}`);
   assert.equal(m.hall,0,`5: nothing of the old hall is drawn at ${label}`);
   if(width===956&&left===62)assert(m.stage.w*m.stage.h>601*278*1.3,`1: a larger slide than the hall's LED screen at ${label}: ${m.stage.w}×${m.stage.h}`);
   results.push({engine:engine.name(),screen:label,slides:m.slides,stage:`${Math.round(m.stage.w)}×${Math.round(m.stage.h)}`,smallest:m.smallest});}
  assert(!requests.some(url=>/assets\/conference\//.test(url)),'5: the old hall photograph is not loaded');
  await page.evaluate(()=>GH_CONFERENCE_3D.close());await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>GH_CONFERENCE_3D.launch({snapshot:qaSnapshot},{mode:'manual'}));await page.waitForFunction(()=>GH_CONFERENCE_3D.diagnostics().phase==='presenting');
  const running=await page.evaluate(()=>{GH_CONFERENCE_3D.go(3);return document.getAnimations().filter(a=>a.playState==='running').length;});assert.equal(running,0,'5: reduced motion runs no animation');
  await page.evaluate(()=>GH_CONFERENCE_3D.close());assert.equal(await page.locator('.ghc3').count(),0);assert.deepEqual(errors,[]);
 }finally{await browser.close();await server.close();}}
 console.log(JSON.stringify({suite:'build552-conference-hall-layout-browser',ok:true,results}));
})().catch(error=>{console.error(error);process.exitCode=1;});
