'use strict';
// Real shipped fonts/assets. Measure text inside each card as well as the card's outer rectangle.
// Runs only on the requested landscape viewports, with the static renderer (no production observers/probes).
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{chromium,webkit}=require('playwright'),{serve}=require('./helpers/web-server'),ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
(async()=>{const results=[],violations=[];for(const engine of [chromium,webkit]){
 const server=await serve(path.join(ROOT,'WebApp')),browser=await engine.launch({headless:true}),page=await browser.newPage({viewport:{width:956,height:440},locale:'ar-SA'}),errors=[];page.on('pageerror',e=>errors.push(e.message));try{
  await page.goto(server.baseURL);await page.waitForFunction(()=>window.GH_CONF_BOARD&&window.GH_CONFERENCE_3D);await page.evaluate(()=>{
   const types=['air','sea','road','power','bank','mobility','insurance','realestate','telecom','dealership','hospitality'],seed={simSeconds:365*86400,openedCompanies:types,profile:{name:'مجموعة فنتورا العالمية',founder:'مؤسس المجموعة',reputation:75},hired:[],assets:[],globalBases:[],customHubs:[],branches:[],bank:{branches:32},energy:{solarMW:250},mobility:{vehicles:[]},companyRegistry:{}};
   const migrated=GH_COMPANY_PLATFORM.migrateState(seed);if(migrated.errors.length)throw Error(migrated.errors.join(','));const s=migrated.state;GH_FINANCE_CORE.ensure(s);GH_HR_CORE.ensure(s);
   const companies=Object.fromEntries(types.map((type,i)=>[type,{grossRevenue:123456789+i*10000,expenses:23456789,net:100000000+i*10000}]));GH_FINANCE_CORE.execute({state:s},'record-daily-close',{day:0,net:Object.values(companies).reduce((sum,r)=>sum+r.net,0),companies});
   window.qaContentSnapshot=GH_CONFERENCE.buildSnapshot(s,2026);window.qaContentSession=GH_CONFERENCE_3D.launch({snapshot:qaContentSnapshot},{mode:'manual'});window.qaContentExact=JSON.stringify(qaContentSnapshot);
  });await page.waitForFunction(()=>GH_CONFERENCE_3D.diagnostics().phase==='presenting');await page.evaluate(()=>document.fonts.ready);assert(await page.evaluate(()=>document.fonts.check('400 20px "GH Plex Arabic"')));
  for(const viewport of [{width:956,height:440},{width:844,height:390},{width:667,height:375}]){await page.setViewportSize(viewport);for(const angle of ['front','wide','stage']){
   await page.evaluate(angle=>qaContentSession.setAngle(angle),angle);const measured=await page.evaluate(()=>{
    const doc=document.querySelector('.ghc3-document'),board=new GH_CONF_BOARD.Board(doc),scenes=GH_CONF_MODEL.buildScenePlan(qaContentSnapshot,{mode:'manual'}),bad=[],styles=[],counts={facts:0,financial:0};
    for(const scene of scenes){board.update(qaContentSnapshot,scene);if(doc.scrollWidth>doc.clientWidth+1||doc.scrollHeight>doc.clientHeight+1)bad.push({scene:scene.id,kind:'board-overflow'});
     for(const tile of doc.querySelectorAll('.ghcb-content-fact,.ghcb-mini-metric')){const box=tile.getBoundingClientRect(),financial=tile.classList.contains('ghcb-mini-metric');for(const el of tile.querySelectorAll('small,b')){if(!el.textContent.trim())continue;counts[financial?'financial':'facts']++;const r=el.getBoundingClientRect(),style=getComputedStyle(el),lines=financial?1:el.tagName==='B'?2:Infinity,expected=Math.min(el.scrollHeight,parseFloat(style.lineHeight)*lines);
      if(r.top<box.top-1||r.bottom>box.bottom+1||r.height<expected-1)bad.push({scene:scene.id,kind:'text-clipped',text:el.textContent,height:r.height,expected,container:box.height,top:r.top-box.top,bottom:r.bottom-box.bottom});
      if(!financial&&styles.length<2)styles.push({tag:el.tagName,font:style.fontFamily,size:parseFloat(style.fontSize),weight:style.fontWeight,color:style.color});
     }}
    }board.update(qaContentSnapshot,scenes[0]);return {chapters:scenes.length,counts,badCount:bad.length,examples:bad.slice(0,12),styles,unchanged:JSON.stringify(qaContentSnapshot)===qaContentExact,scheduled:GH_CONFERENCE_3D.diagnostics().scheduledFrame};
   });assert.equal(measured.chapters,49);assert(measured.counts.facts>=160&&measured.counts.financial>0);assert(measured.unchanged);assert.equal(measured.scheduled,false);
   for(const style of measured.styles){assert(style.font.includes('GH Plex Arabic'));const bold=style.tag==='B';assert(Math.abs(style.size-(bold?Math.max(10,Math.min(15,viewport.width*.011)):7.5))<.01);assert.equal(style.weight,bold?'700':'400');assert.equal(style.color,bold?'rgb(241, 246, 255)':'rgb(170, 198, 215)');}
   if(measured.badCount)violations.push({engine:engine.name(),viewport,angle,count:measured.badCount,examples:measured.examples});results.push({engine:engine.name(),viewport,angle,...measured});
   if(angle==='front'&&process.env.GH_LAYOUT_CAPTURE_DIR){fs.mkdirSync(process.env.GH_LAYOUT_CAPTURE_DIR,{recursive:true});await page.screenshot({animations:'disabled',path:path.join(process.env.GH_LAYOUT_CAPTURE_DIR,`conference-content-${engine.name()}-${viewport.width}.png`)});}
  }}assert.deepEqual(errors,[]);await page.evaluate(()=>GH_CONFERENCE_3D.close());assert.equal(await page.locator('.ghc3').count(),0);
 }finally{await browser.close();await server.close();}}
 if(process.env.GH_CONTENT_RESULTS)fs.writeFileSync(process.env.GH_CONTENT_RESULTS,JSON.stringify({results,violations},null,2)+'\n');assert.deepEqual(violations,[],'no glyph rows may be flex-shrunk or leave their cards');console.log(JSON.stringify({suite:'build422-conference-content-layout-browser',ok:true,results}));
})().catch(error=>{console.error(error);process.exitCode=1;});
