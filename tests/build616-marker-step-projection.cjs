'use strict';
// Owner («تتبع الثقل والاق والمشاكل وحلها بدقه عاليه جدًا ... ابيها اصفار»; sampled allocation, 300k assets, 20 s of live
// play: 116 MB, of which the marker motion 70 MB, the step's route search 52 MB): each marker's step searched its route
// through Leaflet's map.project, a LatLng and two Points a call, 26 calls a marker a frame, and a new array for every
// candidate point. The step now measures on the map's spherical Mercator CRS with Leaflet 1.9's own arithmetic, in its
// order, and writes the candidate point into one array. On the real Leaflet in a browser, against the source before
// (f4d8bfd, from its own tree):
//  1. every screen distance is the same number, bit for bit, at whole and fractional zooms, past the poles, across the
//     date line, and for the coordinates Leaflet refuses (the same 0 and the same nonCritical report);
//  2. another CRS, or a replaced map.project, gives the same numbers through Leaflet's path;
//  3. every route step (point and progress) is the same, bit for bit, on routes across the date line;
//  4. the step projects nothing through Leaflet (the source before: 26 calls a step) and allocates less than a third (about a quarter measured).
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const ROOT=path.resolve(__dirname,'..'),PREVIOUS='f4d8bfd';
function pieces(app){
  const range=(start,end)=>{const a=app.indexOf(start),b=app.indexOf(end,a+start.length);assert(a>=0&&b>a,`missing source range ${start}`);return app.slice(a,b);};
  return [range('  const clamp =','\n'),range('  const EARTH_RADIUS_KM =','\n'),range('  function haversine(','  function bearingBetween('),range('  const presentationRouteMetricCache=','  function currentAssetRoute('),range('  function markerPoint(value)','  function animateMapMarkerPositions(')].join('\n');
}
const factory=app=>`(function(map,nonCritical){${pieces(app)}\nreturn {markerScreenDistance,advanceRouteSegment,interpolatePresentationRoute};})`;
const before=factory(execFileSync('git',['-C',ROOT,'show',`${PREVIOUS}:WebApp/app.js`],{maxBuffer:64*1024*1024}).toString());
const now=factory(fs.readFileSync(path.join(process.env.GH_TEST_SOURCE_DIR||ROOT,'WebApp/app.js'),'utf8'));
(async()=>{
  const browser=await chromium.launch();
  try{
    const page=await browser.newPage({viewport:{width:844,height:390}});
    await page.setContent('<div id="map" style="width:844px;height:390px"></div><div id="geo" style="width:844px;height:390px"></div>');
    await page.addScriptTag({path:path.join(ROOT,'WebApp/vendor/leaflet/leaflet.js')});
    const out=await page.evaluate(({before,now})=>{
      // The app's map (its options), and a plate carrée one.
      const map=L.map('map',{zoomControl:false,attributionControl:false,minZoom:2,maxZoom:19,worldCopyJump:true,preferCanvas:true,maxBounds:L.latLngBounds([[-85.05,-540],[85.05,540]]),maxBoundsViscosity:1}).setView([22,28],3);
      const geo=L.map('geo',{crs:L.CRS.EPSG4326}).setView([22,28],3);
      const reports={before:0,now:0},make=(source,key,target)=>(0,eval)(source)(target,()=>{reports[key]++;});
      let seed=616;const random=()=>{seed=(seed*1103515245+12345)%2147483648;return seed/2147483648;};
      const coordinate=()=>[random()*200-100,random()*400-200];
      const same=(a,b)=>JSON.stringify(a,(_k,v)=>typeof v==='number'?(Object.is(v,-0)?'-0':String(v)):v)===JSON.stringify(b,(_k,v)=>typeof v==='number'?(Object.is(v,-0)?'-0':String(v)):v);
      const result={distances:0,mismatches:[],reports:null,fallback:0,steps:0,stepMismatches:[],projectCalls:null};
      // 1.
      const A=make(before,'before',map),B=make(now,'now',map);
      for(const zoom of [2,3,3.5,5,7.25,9,12,16]){map.setZoom(zoom,{animate:false});for(let i=0;i<2500;i++){const from=coordinate(),to=random()<.2?[from[0]+(random()-.5)*.01,from[1]+(random()-.5)*.01]:coordinate(),x=A.markerScreenDistance(from,to),y=B.markerScreenDistance(from,to);result.distances++;if(!Object.is(x,y)&&result.mismatches.length<5)result.mismatches.push({zoom,from,to,x,y});}}
      const odd=[[[NaN,1],[2,3]],[[1,2],[NaN,3]],[[1,Infinity],[2,3]],[[1,2],[Infinity,3]],[[90,179.9],[-90,-179.9]],[[1,2],null],[['12','40'],['13','41']],[[0,180],[0,-180]],[[85.06,0],[-85.06,0]]];
      for(const [from,to] of odd){const x=A.markerScreenDistance(from,to),y=B.markerScreenDistance(from,to);result.distances++;if(!Object.is(x,y))result.mismatches.push({odd:true,from:String(from),to:String(to),x,y});}
      result.reports={...reports};
      // 2.
      const C=make(before,'before',geo),D=make(now,'now',geo);for(let i=0;i<2000;i++){const from=coordinate(),to=coordinate();if(!Object.is(C.markerScreenDistance(from,to),D.markerScreenDistance(from,to)))result.mismatches.push({crs:'EPSG4326',from,to});result.fallback++;}
      const own=Object.create(map);own.project=function(...args){return L.Map.prototype.project.apply(this,args);};const E=make(before,'before',own),F=make(now,'now',own);
      for(let i=0;i<2000;i++){const from=coordinate(),to=coordinate();if(!Object.is(E.markerScreenDistance(from,to),F.markerScreenDistance(from,to)))result.mismatches.push({project:'replaced',from,to});result.fallback++;}
      // 3.
      const route=()=>{const n=2+Math.floor(random()*38),start=coordinate(),points=[start];for(let i=1;i<n;i++){const p=points[i-1];points.push([Math.max(-84,Math.min(84,p[0]+(random()-.5)*12)),((p[1]+(random()-.5)*30+540)%360)-180]);}if(random()<.3)points.push([points[n-1][0],points[n-1][1]]);return points;};
      const steps=[];for(const zoom of [2,4,6.5,9]){for(let i=0;i<800;i++){const r=route(),v=random(),t=random()<.85?v+random()*(1-v):v*random(),cur=A.interpolatePresentationRoute(r,v),current=random()<.3?[cur[0]+(random()-.5),cur[1]+(random()-.5)]:cur,maxPixels=[0,.4,3,12,40,400][Math.floor(random()*6)];steps.push({zoom,r,v,t,current,maxPixels});}}
      for(const s of steps){map.setZoom(s.zoom,{animate:false});const x=A.advanceRouteSegment(s.r,s.v,s.t,s.current,s.maxPixels),y=B.advanceRouteSegment(s.r,s.v,s.t,s.current,s.maxPixels);result.steps++;if(!same(x,y)&&result.stepMismatches.length<5)result.stepMismatches.push({s,x,y});}
      // 4. (the steps that search: a target farther than one step)
      const searching=steps.filter(s=>{map.setZoom(s.zoom,{animate:false});const x=A.advanceRouteSegment(s.r,s.v,s.t,s.current,s.maxPixels);return x&&x.progress!==s.t;}).slice(0,600).sort((a,b)=>a.zoom-b.zoom);
      const original=L.Map.prototype.project;let calls=0;L.Map.prototype.project=function(...args){calls++;return original.apply(this,args);};
      const count=fn=>{let total=0;for(const s of searching){map.setZoom(s.zoom,{animate:false});calls=0;fn.advanceRouteSegment(s.r,s.v,s.t,s.current,s.maxPixels);total+=calls;}return total;};
      result.projectCalls={before:count(A),now:count(B),steps:searching.length};L.Map.prototype.project=original;
      window.__B616__={A,B,searching,map};
      return result;
    },{before,now});
    // 4. Sampled allocation of the same searching steps, each source three times over.
    const cdp=await page.context().newCDPSession(page);await cdp.send('HeapProfiler.enable');
    const allocation=async key=>{const run=rounds=>page.evaluate(({key,rounds})=>{const {searching,map}=window.__B616__,fn=window.__B616__[key];for(let k=0;k<rounds;k++)for(const s of searching){if(map.getZoom()!==s.zoom)map.setZoom(s.zoom,{animate:false});fn.advanceRouteSegment(s.r,s.v,s.t,s.current,s.maxPixels);}},{key,rounds});await run(20);await cdp.send('HeapProfiler.collectGarbage');await cdp.send('HeapProfiler.startSampling',{samplingInterval:512,includeObjectsCollectedByMajorGC:true,includeObjectsCollectedByMinorGC:true});
      await run(3);
      const {profile}=await cdp.send("HeapProfiler.stopSampling");let bytes=0;const by={};const walk=n=>{if(process.env.B616_DEBUG&&n.selfSize)by[n.callFrame.functionName+":"+n.callFrame.lineNumber]=(by[n.callFrame.functionName+":"+n.callFrame.lineNumber]||0)+n.selfSize;if(/advanceRouteSegment|markerScreenDistance|mercatorScreenDistance|interpolatePresentationRoute|^project$|latLngToPoint|_transform|^w$|^v$|^p$/.test(n.callFrame.functionName))bytes+=n.selfSize||0;for(const c of n.children||[])walk(c);};walk(profile.head);if(process.env.B616_DEBUG)console.log(key,JSON.stringify(Object.entries(by).sort((a,b)=>b[1]-a[1]).slice(0,12)));return bytes;};
    const bytes={before:await allocation('A'),now:await allocation('B')};
    // 1.
    assert.deepEqual(out.mismatches,[],'1-2: the same screen distance, bit for bit');assert.ok(out.distances>=20000);
    assert.equal(out.reports.now,out.reports.before,'1: the same nonCritical reports for the coordinates Leaflet refuses');assert.ok(out.reports.before>=1);
    assert.ok(out.fallback>=4000);
    // 3.
    assert.deepEqual(out.stepMismatches,[],'3: the same route step, bit for bit');assert.ok(out.steps>=3200);
    // 4.
    assert.ok(out.projectCalls.steps>=200,`4: searching steps measured (${out.projectCalls.steps})`);
    assert.ok(out.projectCalls.before>=26*out.projectCalls.steps,`4: (the source before projected ${out.projectCalls.before} times)`);
    assert.equal(out.projectCalls.now,0,'4: the step projects nothing through Leaflet');
    assert.ok(bytes.before>0&&bytes.now<bytes.before/3,`4: the step allocates less than a third (${bytes.now} against ${bytes.before} bytes sampled)`);
    console.log(JSON.stringify({suite:'build616-marker-step-projection',ok:true,distances:out.distances,steps:out.steps,projectCalls:out.projectCalls,bytes}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
