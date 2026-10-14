'use strict';
// Build 373: interface weight on one machine, for comparing two builds (a tool, not an acceptance gate).
// The real app served over HTTP (images included), an iPhone landscape viewport at 3x, a 400-aircraft fleet dispatched
// with the real button, the CPU throttled 4x while measuring. It reports startup, page elements, image bytes, the time to
// open each page (median of 3, to the second frame), and 15 s of play at 120x with the map alone and with a company
// panel open: frame intervals, frames over 50 ms, long tasks, style and layout time and the JS heap.
//
//   NODE_PATH=/opt/node22/lib/node_modules node tools/measure_ui_weight.cjs [repoRoot] [label]
//
// Run it on the base branch (a git worktree) and on the change; an iPhone is about 3 to 5 times slower than the numbers.
const path=require('path');
const ROOT=path.resolve(process.argv[2]||path.join(__dirname,'..')),LABEL=process.argv[3]||'run';
const {chromium}=require('playwright');
const {serve}=require(path.join(ROOT,'tests/helpers/web-server'));const {drawFounderSignature}=require(path.join(ROOT,'tests/helpers/signature-input'));
const median=a=>{const s=[...a].sort((x,y)=>x-y);return s[Math.floor(s.length/2)];};
(async()=>{
 const server=await serve(path.join(ROOT,'WebApp'));const browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:844,height:390},deviceScaleFactor:3,locale:'ar-SA'});
 const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route(/https:\/\/(tile\.openstreetmap\.org|server\.arcgisonline\.com)\//,r=>r.abort());
 const metrics=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
 const out={label:LABEL};
 // Startup, throttled.
 await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 const t0=Date.now();await page.goto(server.baseURL);await page.waitForFunction(()=>window.__GH_STATE__,null,{timeout:120000});
 out.startup={appReadyMs:Date.now()-t0,...await page.evaluate(()=>{const n=performance.getEntriesByType('navigation')[0];return {domContentLoadedMs:Math.round(n.domContentLoadedEventEnd),loadMs:Math.round(n.loadEventEnd),htmlKB:Math.round(n.transferSize/1024)||null};})};
 await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});
 await page.selectOption('#founderMode','sandbox');await page.click('#founderReview');await drawFounderSignature(page);await page.locator('#founderForm button[type=submit]').click();await page.waitForFunction(()=>__GH_STATE__.onboardingComplete);
 await page.evaluate(()=>{__GH_STATE__.speed=0;const o=GH_INTERFACE.prepare;window.GH_INTERFACE={...GH_INTERFACE,prepare(r,p,a,c){window.qaContext=c;return o(r,p,a,c);}};});
 await page.locator('.side-nav button[data-panel]').first().click();await page.waitForTimeout(300);
 // A fleet so the map has moving markers: 400 used airliners, dispatched with the real button.
 const fleet=await page.evaluate(async()=>{const c=qaContext,s=__GH_STATE__,type='air';s.godMoney=true;s.infiniteMoney=true;
   for(const t of ['air','sea','road','power','bank']){if(!s.openedCompanies.includes(t)){const d=GH_COMPANY_PLATFORM.definitionFor(s,t);await c.runAuthorizedDomainCommand('corporate','open-company',{type:t,companyId:t,capital:Math.max(400000000,d?.founding?.minimumCapital||0),legalName:'Perf '+t,formationContract:'PERF-'+t},{silent:true});}}
   s.godMoney=true;s.infiniteMoney=true;
   const model=[...GH_ASSET_CATALOG[type].used].filter(x=>!x.specs.cargo&&Number(x.specs.rangeKm)>=6000).sort((x,y)=>(x.leaseMonthly||0)-(y.leaseMonthly||0)||x.price-y.price)[0];
   const WORLD=GH_WORLD_DATA,facilities=[];for(const site of ['OMDB','EGLL','KJFK','WSSS']){const airport=WORLD.airports.find(r=>r[0]===site);if(!airport)continue;const facility={id:`PERF-air-${airport[0]}`,name:`Perf ${airport[0]}`,kind:'airport-base',company:type,ownerCompanyId:type,owned:true,sourceKey:`air:${airport[0]}`,code:airport[1]||airport[0],icao:airport[0],iata:airport[1],city:airport[3]||airport[4]||'—',country:String(airport[5]||'—'),coords:[airport[6],airport[7]]};await c.runAuthorizedDomainCommand('facilities','create',{facility,bucket:'globalBases'},{silent:true});facilities.push(facility.id);}
   let ok=true;for(let i=0;i<4&&ok;i++)ok=!!await c.buyAsset(type,'used',model.id,'lease',100,facilities[i%facilities.length],true,'PERF-UI-'+i,type);return {ok,size:GH_FLEET_DATA.size(s),facilities:facilities.length};});
 out.fleet=fleet;
 // Deliveries take a month: advance the calendar 30 days with the real button, then dispatch the fleet.
 await page.locator('#simCalendarToggle').click();await page.locator('[data-calendar-advance="30"]').click();
 await page.waitForFunction(()=>/جاهز|اكتمل/.test(document.getElementById('simAdvanceStatus')?.textContent||'')&&(__GH_STATE__.simSeconds||0)>=86400*30,null,{timeout:300000,polling:500}).catch(()=>{});
 await page.waitForTimeout(1500);await page.locator('#simCalendarToggle').click().catch(()=>{});
 await page.evaluate(()=>qaContext.openDrawer('routes','air'));
 const dispatch=page.locator('.dispatch-international-network[data-company="air"]:not([disabled])').first();
 out.dispatched=false;if(await dispatch.count()){await dispatch.click();out.dispatched=true;await page.waitForTimeout(5000);}
 out.moving=await page.evaluate(()=>document.querySelectorAll('.leaflet-marker-icon').length);
 out.dom={nodes:await page.evaluate(()=>document.getElementsByTagName('*').length),svgUse:await page.evaluate(()=>document.querySelectorAll('use').length)};
 // Panel opens, throttled: time to the second frame after openDrawer, median of 3.
 const hasCompany=await page.evaluate(()=>!!window.GH_MADAR);
 const panels=[['companies'],['finance'],['peopleHub'],['leadershipHub'],['settings'],['assets','air'],['routes','air'],['companyManage',{type:'air',tab:'overview'}],['invoices',{company:'all',tab:'overview'}]];
 if(hasCompany)panels.push(['company','air'],['company','bank'],['company','power']);
 if(await page.evaluate(()=>!!window.GH_MADAR?.HUBS))panels.push(['groupHub'],['financeHub'],['systemHub']);
 await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 const before=await metrics();out.panels={};
 for(const [p,a] of panels){const times=[];for(let i=0;i<3;i++){await page.evaluate(()=>qaContext.openDrawer('map'));await page.waitForTimeout(150);
   times.push(await page.evaluate(async([p,a])=>{const t=performance.now();qaContext.openDrawer(p,a);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return performance.now()-t;},[p,a]));}
   out.panels[p+(a?':'+(typeof a==='string'?a:a.type||a.company):'')]=Math.round(median(times));}
 const after=await metrics();out.panelTotals={recalcStyleMs:Math.round((after.RecalcStyleDuration-before.RecalcStyleDuration)*1000),layoutMs:Math.round((after.LayoutDuration-before.LayoutDuration)*1000),scriptMs:Math.round((after.ScriptDuration-before.ScriptDuration)*1000)};
 // Play at speed 3 for 15 s with a panel open (the air company panel, or main's company management), throttled.
 const play=async(name,open)=>{await page.evaluate(open=>{if(open)qaContext.openDrawer(open[0],open[1]);else qaContext.openDrawer('map');},open);await page.waitForTimeout(500);
   await page.evaluate(()=>{window.__F=[];window.__LT=[];let last=performance.now();const loop=t=>{window.__F.push(t-last);last=t;if(window.__run)requestAnimationFrame(loop);};window.__run=true;requestAnimationFrame(loop);
     try{window.__PO=new PerformanceObserver(l=>{for(const e of l.getEntries())window.__LT.push(e.duration);});window.__PO.observe({type:'longtask'});}catch(_e){}
     document.querySelector('[data-speed="3"]')?.click();});
   const m0=await metrics();await page.waitForTimeout(15000);const m1=await metrics();
   const r=await page.evaluate(()=>{window.__run=false;window.__PO?.disconnect();document.querySelector('#speedToggle')?.click();const f=window.__F.slice(5).sort((a,b)=>a-b);return {frames:f.length,avgMs:+(f.reduce((a,b)=>a+b,0)/f.length).toFixed(1),p95Ms:+f[Math.floor(f.length*.95)].toFixed(1),over50:f.filter(x=>x>50).length,longTasks:window.__LT.length,longTaskMs:Math.round(window.__LT.reduce((a,b)=>a+b,0))};});
   r.recalcStylePerSec=+((m1.RecalcStyleCount-m0.RecalcStyleCount)/15).toFixed(1);r.recalcStyleMs=Math.round((m1.RecalcStyleDuration-m0.RecalcStyleDuration)*1000);r.layoutMs=Math.round((m1.LayoutDuration-m0.LayoutDuration)*1000);r.scriptMs=Math.round((m1.ScriptDuration-m0.ScriptDuration)*1000);r.heapMB=+(m1.JSHeapUsedSize/1048576).toFixed(1);
   out[name]=r;await page.waitForTimeout(500);};
 await play('playMapOnly',null);
 await play('playPanelOpen',hasCompany?['company','air']:['companyManage',{type:'air',tab:'overview'}]);
 await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});
 out.images=await page.evaluate(()=>{const rows=performance.getEntriesByType('resource').filter(e=>e.initiatorType==='img'||/\.(webp|png|jpg|svg)$/.test(e.name));return {count:rows.length,kB:Math.round(rows.reduce((a,e)=>a+(e.encodedBodySize||e.transferSize||0),0)/1024)};});
 out.errors=errors.slice(0,5);
 console.log(JSON.stringify(out));
 await browser.close();await server.close();
})().catch(e=>{console.error(e);process.exit(1);});
