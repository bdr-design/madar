'use strict';
// The conference hall on every screen the game runs on (owner: the old hall was one image stretched to the screen, its
// text 6-7 px, side logos adrift in portrait). Proven with the shipped page, fonts and hall image, on a conference
// snapshot from the real finance and conference owners, at iPhone and iPad sizes in both orientations:
//  1. the hall is drawn at its own proportions (never stretched) and, in landscape, covers the screen;
//  2. the LED screen is always whole on screen; a side screen the frame cuts is hidden, never shown in part;
//  3. every slide's content stays inside the LED screen, and no text is smaller than 10 px;
//  4. the controls are at least 44 px, inside the screen, and the page does not scroll;
//  5. with reduced motion, a slide runs no animation.
const assert=require('node:assert/strict'),path=require('node:path'),{chromium,webkit}=require('playwright'),{serve}=require('./helpers/web-server'),ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const VIEWPORTS=[{width:844,height:390},{width:667,height:375},{width:956,height:440},{width:1180,height:820},{width:1366,height:1024},{width:390,height:844},{width:820,height:1180}];
(async()=>{const results=[];for(const engine of [chromium,webkit]){
 const server=await serve(path.join(ROOT,'WebApp')),browser=await engine.launch({headless:true}),page=await browser.newPage({viewport:VIEWPORTS[0],locale:'ar-SA'}),errors=[];page.on('pageerror',e=>errors.push(e.message));try{
  await page.goto(server.baseURL);await page.waitForFunction(()=>window.GH_CONF_KEYNOTE&&window.GH_CONFERENCE_3D&&window.GH_CONFERENCE);
  await page.evaluate(()=>{
   const types=['air','sea','road','power','bank','mobility','insurance','realestate','telecom','dealership','hospitality'],seed={simSeconds:365*86400,openedCompanies:types,profile:{name:'مجموعة فنتورا العالمية',founder:'مؤسس المجموعة',reputation:75},hired:[],assets:[],globalBases:[],customHubs:[],branches:[],bank:{branches:32},energy:{solarMW:250},mobility:{vehicles:[]},companyRegistry:{}};
   const migrated=GH_COMPANY_PLATFORM.migrateState(seed);if(migrated.errors.length)throw Error(migrated.errors.join(','));const s=migrated.state;GH_FINANCE_CORE.ensure(s);GH_HR_CORE.ensure(s);
   for(let day=0;day<30;day++){const companies=Object.fromEntries(types.map((type,i)=>[type,{grossRevenue:123456789+i*9876543,expenses:23456789+i*12345678,net:100000000-i*2469135}]));GH_FINANCE_CORE.execute({state:s},'record-daily-close',{day,net:Object.values(companies).reduce((sum,r)=>sum+r.net,0),companies});}
   window.qaSnapshot=GH_CONFERENCE.buildSnapshot(s,2026);GH_CONFERENCE_3D.launch({snapshot:qaSnapshot},{mode:'manual'});
  });await page.waitForFunction(()=>GH_CONFERENCE_3D.diagnostics().phase==='presenting');await page.evaluate(()=>document.fonts.ready);assert(await page.evaluate(()=>document.fonts.check('600 20px "GH Plex Arabic"')),'the shipped Arabic font is loaded');
  for(const viewport of VIEWPORTS){await page.setViewportSize(viewport);await page.waitForTimeout(50);
   const m=await page.evaluate(()=>{const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height};},W=innerWidth,H=innerHeight,inside=(r,t=1)=>r.x>=-t&&r.y>=-t&&r.x+r.w<=W+t&&r.y+r.h<=H+t,count=GH_CONFERENCE_3D.diagnostics().slides,bad=[];let smallest=Infinity;
    for(let i=0;i<count;i++){GH_CONFERENCE_3D.go(i);document.getAnimations().forEach(a=>a.finish());const led=document.querySelector('.ghc3-led').getBoundingClientRect();
     for(const el of document.querySelectorAll('.ghc3-beat *')){const b=el.getBoundingClientRect();if(b.width&&b.height&&(b.left<led.left-1||b.right>led.right+1||b.top<led.top-1||b.bottom>led.bottom+1))bad.push({slide:i,cls:String(el.className),text:el.textContent.slice(0,40)});
      if([...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()))smallest=Math.min(smallest,parseFloat(getComputedStyle(el).fontSize));}}
    GH_CONFERENCE_3D.go(0);const hall=rect(document.querySelector('.ghc3-hall')),led=rect(document.querySelector('.ghc3-led')),sides=[...document.querySelectorAll('.ghc3-side')].map(e=>({...rect(e),hidden:getComputedStyle(e).visibility==='hidden'})),controls=[...document.querySelectorAll('.ghc3-ctl button')].filter(b=>!b.hidden).map(rect);
    return {slides:count,bad:bad.slice(0,6),badCount:bad.length,smallest,ratio:hall.w/hall.h,covers:hall.x<=.5&&hall.y<=.5&&hall.x+hall.w>=W-.5&&hall.y+hall.h>=H-.5,ledInside:inside(led),sides:sides.map(s=>s.hidden||inside(s)),controls:controls.every(r=>inside(r)&&r.h>=44&&r.w>=44),scroll:document.documentElement.scrollWidth>W||document.querySelector('.ghc3').scrollWidth>W};});
   const landscape=viewport.width>viewport.height;
   assert(Math.abs(m.ratio-1832/859)<.01,`1: the hall keeps its proportions at ${viewport.width}×${viewport.height} (${m.ratio})`);if(landscape)assert(m.covers,`1: the hall covers the screen at ${viewport.width}×${viewport.height}`);
   assert(m.ledInside,`2: the LED screen is whole at ${viewport.width}×${viewport.height}`);assert(m.sides.every(Boolean),`2: no side screen is cut at ${viewport.width}×${viewport.height}`);
   assert.equal(m.badCount,0,`3: slide content stays on the LED screen at ${viewport.width}×${viewport.height}: ${JSON.stringify(m.bad)}`);assert(m.smallest>=10,`3: no text under 10 px at ${viewport.width}×${viewport.height} (${m.smallest})`);
   assert(m.controls,`4: controls at ${viewport.width}×${viewport.height}`);assert.equal(m.scroll,false,`4: no page scroll at ${viewport.width}×${viewport.height}`);
   results.push({engine:engine.name(),viewport,slides:m.slides,smallest:m.smallest,covers:m.covers});}
  await page.evaluate(()=>GH_CONFERENCE_3D.close());await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>GH_CONFERENCE_3D.launch({snapshot:qaSnapshot},{mode:'manual'}));await page.waitForFunction(()=>GH_CONFERENCE_3D.diagnostics().phase==='presenting');
  const running=await page.evaluate(()=>{GH_CONFERENCE_3D.go(3);return document.getAnimations().filter(a=>a.playState==='running').length;});assert.equal(running,0,'5: reduced motion runs no animation');
  await page.evaluate(()=>GH_CONFERENCE_3D.close());assert.equal(await page.locator('.ghc3').count(),0);assert.deepEqual(errors,[]);
 }finally{await browser.close();await server.close();}}
 console.log(JSON.stringify({suite:'build552-conference-hall-layout-browser',ok:true,results}));
})().catch(error=>{console.error(error);process.exitCode=1;});
