'use strict';
// The conference keynote in the owner's hall, on every screen the game runs on (owner: «المؤتمر لايعجبني تصميمه سوي
// تصميم عصري ... اهم شي ابعاد الشاشة», then «القاعة غير موجوده فقط شاشة»: the modern slides stay, on the hall's LED
// screen). Proven with the shipped page and fonts, on a conference snapshot from the real finance and conference owners,
// at iPhone and iPad sizes in both orientations, with and without the iPhone's safe-area insets:
//  1. the hall photograph covers the screen in landscape (upright, the LED screen is whole and the hall leaves black
//     above and below it); the LED screen is always whole on the screen and the stage lies inside it; on a 956×440
//     iPhone the LED screen takes at least 70% of the width and the slide is larger than the old hall's 601×278;
//  2. every slide's content stays on the stage, a figure stays inside its tile, and nothing lies under a control;
//  3. no text is smaller than 12 px;
//  4. the controls are at least 44 px and inside the safe area; the arrows sit at the sides, level with the LED screen,
//     in landscape and below it upright; the page does not scroll;
//  5. on a landscape iPhone from 844 points wide both side screens show, each with the speaker's mark, clear of the arrows; the hall
//     photograph is loaded once, and with reduced motion a slide runs no animation.
const assert=require('node:assert/strict'),path=require('node:path'),{chromium,webkit}=require('playwright'),{serve}=require('./helpers/web-server'),ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
// [width, height, [safe left, right, bottom, top]]: iPhone 16/17 Pro Max, iPhone 15 Pro Max, iPhone 14, iPhone SE,
// iPads, and both held upright.
const SCREENS=[[956,440,[62,62,20,0]],[956,440,[0,0,0,0]],[932,430,[59,59,21,0]],[844,390,[47,47,21,0]],[667,375,[0,0,0,0]],[1180,820,[0,0,20,0]],[1366,1024,[0,0,20,0]],[390,844,[0,0,34,47]],[820,1180,[0,0,20,24]]];
(async()=>{const results=[];for(const engine of [chromium,webkit]){
 // A browser that fails to start still closes the server, so the gate fails at once instead of waiting out its timeout.
 const server=await serve(path.join(ROOT,'WebApp'));let browser;try{browser=await engine.launch({headless:true});const page=await browser.newPage({viewport:{width:956,height:440},locale:'ar-SA'}),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
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
    GH_CONFERENCE_3D.go(0);const stage=R(document.querySelector('.ghc3-stage')),led=R(document.querySelector('.ghc3-led')),arrows=['prev','next'].map(n=>R(document.querySelector(`[data-c3="${n}"]`)));
    // The hall photograph is the viewport's background: 1832 × 859 photograph pixels at --k, placed at --x, --y. A side
    // screen's mark (the compact marks are square) is 61.6 photograph pixels wide, 20% down its free height.
    const css=getComputedStyle(document.querySelector('.ghc3')),k=parseFloat(css.getPropertyValue('--k')),hx=parseFloat(css.getPropertyValue('--x')),hy=parseFloat(css.getPropertyValue('--y')),hall={left:hx,top:hy,right:hx+1832*k,bottom:hy+859*k},sides=[...document.querySelectorAll('.ghc3-side')].map(e=>{const r=R(e),w=61.6*k,t=r.top+(r.height-w)*.2;return {shown:getComputedStyle(e).visibility!=='hidden',logo:{left:r.left+(r.width-w)/2,right:r.left+(r.width+w)/2,top:t,bottom:t+w},src:e.dataset.logo||''};});
    const unsafe=controls.filter(({rect:r,name})=>r.left<sl-1||r.right>W-sr+1||r.top<st-1||r.bottom>H-sb+1||(name!=='ghc3-chip'&&(r.width<44||r.height<44))).map(c=>c.name);
    const inside=(a,b)=>a.left>=b.left-1&&a.right<=b.right+1&&a.top>=b.top-1&&a.bottom<=b.bottom+1;
    return {slides:count,stage:{x:stage.left,y:stage.top,w:stage.width,h:stage.height},led:{x:led.left,y:led.top,w:led.width,h:led.height},covers:hall.left<=.5&&hall.top<=.5&&hall.right>=W-.5&&hall.bottom>=H-.5,
     ledWhole:led.left>=-.5&&led.top>=-.5&&led.right<=W+.5&&led.bottom<=H+.5,stageInLed:inside(stage,led),logo:document.querySelector('.ghc3-brand').dataset.logo||'',
     sides:sides.map(x=>({shown:x.shown,src:x.src,clear:arrows.every(a=>!over(a,x.logo))})),
     arrows:arrows.map(r=>({x:r.left,y:r.top,cy:r.top+r.height/2})),off:off.slice(0,6),offCount:off.length,untiled:untiled.slice(0,6),untiledCount:untiled.length,covered:[...new Set(covered)].slice(0,6),coveredCount:covered.length,smallest,smallestAt,unsafe,
     scroll:document.documentElement.scrollWidth>W||document.querySelector('.ghc3').scrollWidth>W};},[left,right,bottom,top]);
   const landscape=width>height,near=(a,b)=>Math.abs(a-b)<=1;
   if(landscape)assert(m.covers,`1: the hall photograph covers the screen at ${label}`);
   assert(m.ledWhole,`1: the LED screen is whole on the screen at ${label}: ${JSON.stringify(m.led)}`);assert(m.stageInLed,`1: the stage lies inside the LED screen at ${label}: ${JSON.stringify({stage:m.stage,led:m.led})}`);
   assert.equal(m.offCount,0,`2: every slide stays on the stage at ${label}: ${JSON.stringify(m.off)}`);assert.equal(m.untiledCount,0,`2: every figure stays in its tile at ${label}: ${JSON.stringify(m.untiled)}`);assert.equal(m.coveredCount,0,`2: no slide content under a control at ${label}: ${JSON.stringify(m.covered)}`);
   assert(m.smallest>=12,`3: no text under 12 px at ${label} (${m.smallest} ${m.smallestAt})`);
   assert.deepEqual(m.unsafe,[],`4: controls of 44 px inside the safe area at ${label}`);assert.equal(m.scroll,false,`4: no page scroll at ${label}`);
   if(landscape){const [prev,next]=m.arrows;assert(prev.x>width/2&&next.x<width/2&&[prev,next].every(a=>a.cy>m.led.y&&a.cy<m.led.y+m.led.h),`4: the arrows sit at the sides, level with the LED screen, at ${label}: ${JSON.stringify({arrows:m.arrows,led:m.led})}`);}
   else assert(m.arrows.every(a=>a.y>m.led.y+m.led.h),`4: upright, the arrows sit below the LED screen at ${label}`);
   if(width===956){assert(m.led.w>=width*.7,`1: the LED screen takes at least 70% of the width at ${label}: ${m.led.w}`);assert(m.stage.w*m.stage.h>601*278,`1: a larger slide than the old hall's 601×278 at ${label}: ${m.stage.w}×${m.stage.h}`);}
   if(landscape&&height<=440&&width>=844)assert(m.sides.every(x=>x.shown&&x.src&&x.src===m.logo&&x.clear),`5: both side screens show the speaker's mark, clear of the arrows, at ${label}: ${JSON.stringify(m.sides)}`);
   results.push({engine:engine.name(),screen:label,slides:m.slides,led:`${Math.round(m.led.w)}×${Math.round(m.led.h)}`,stage:`${Math.round(m.stage.w)}×${Math.round(m.stage.h)}`,smallest:m.smallest});}
  assert.equal(requests.filter(url=>/assets\/conference\/hall-dark\.webp/.test(url)).length,1,'5: the hall photograph is loaded once');assert(!requests.some(url=>/assets\/conference\/(?!hall-dark\.webp)/.test(url)),'5: no other conference image is loaded');
  await page.evaluate(()=>GH_CONFERENCE_3D.close());await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>GH_CONFERENCE_3D.launch({snapshot:qaSnapshot},{mode:'manual'}));await page.waitForFunction(()=>GH_CONFERENCE_3D.diagnostics().phase==='presenting');
  const running=await page.evaluate(()=>{GH_CONFERENCE_3D.go(3);return document.getAnimations().filter(a=>a.playState==='running').length;});assert.equal(running,0,'5: reduced motion runs no animation');
  await page.evaluate(()=>GH_CONFERENCE_3D.close());assert.equal(await page.locator('.ghc3').count(),0);assert.deepEqual(errors,[]);
 }finally{await browser?.close();await server.close();}}
 console.log(JSON.stringify({suite:'build552-conference-hall-layout-browser',ok:true,results}));
})().catch(error=>{console.error(error);process.exitCode=1;});
