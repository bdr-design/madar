'use strict';
// Deterministic external routing response only. Game route, dispatch and finance owners remain real.
async function osrmDouble(page){
  await page.route(/https:\/\/router\.project-osrm\.org\//,route=>{
    const url=new URL(route.request().url()),coords=url.pathname.split('/').pop().split(';').map(p=>p.split(',').map(Number));
    const hav=(a,b)=>{const R=6371000,r=x=>x*Math.PI/180,dLat=r(b[1]-a[1]),dLon=r(b[0]-a[0]),h=Math.sin(dLat/2)**2+Math.cos(r(a[1]))*Math.cos(r(b[1]))*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(h));};
    const legs=[],all=[];
    for(let i=0;i<coords.length-1;i++){const a=coords[i],b=coords[i+1],n=40,pts=[];for(let k=0;k<=n;k++){const t=k/n,w=Math.sin(t*Math.PI)*0.02;pts.push([+(a[0]+(b[0]-a[0])*t+w).toFixed(5),+(a[1]+(b[1]-a[1])*t).toFixed(5)]);}
      const d=hav(a,b)*1.25+50;legs.push({distance:d,duration:d/22,steps:[{geometry:{coordinates:pts},distance:d,duration:d/22}]});for(const p of pts)if(!all.length||all.at(-1)[0]!==p[0]||all.at(-1)[1]!==p[1])all.push(p);}
    const distance=legs.reduce((x,l)=>x+l.distance,0);
    route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({code:'Ok',routes:[{distance,duration:distance/22,geometry:{type:'LineString',coordinates:all},legs}],waypoints:coords.map(c=>({location:c}))})});
  });
}

module.exports={osrmDouble};
