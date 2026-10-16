'use strict';
const assert=require('node:assert/strict'),P=require('../WebApp/map-proxy-core.js');
const rows=[];for(const owner of ['air','second-air','sea','road'])for(let i=0;i<160;i++)rows.push(Object.freeze({id:`${owner}-${String(i).padStart(3,'0')}`,ownerCompanyId:owner,mode:owner.includes('air')?'air':owner,countryId:'C'+i%8,facilityId:'F'+i%5,routeId:'R'+i%7,lat:20+i*.001,lng:40+i*.001,x:i*25,y:rows.length*25}));
const options={limit:300,perCompanyLimit:50,declutterRadius:0,zoom:9},before=JSON.stringify(rows),count=selected=>selected.reduce((m,r)=>(m[r.ownerCompanyId]=(m[r.ownerCompanyId]||0)+1,m),{});
const selected=P.allocate(rows,options);assert.equal(selected.length,200);assert.deepEqual(count(selected),{air:50,'second-air':50,sea:50,road:50});assert.equal(JSON.stringify(rows),before);
assert.deepEqual(P.allocate([...rows].reverse(),options).map(r=>r.id),selected.map(r=>r.id),'selection stays stable when source order changes');
const one=P.allocate(rows.filter(r=>r.ownerCompanyId==='air'),options);assert.equal(one.length,50);
const pinned=P.allocate(rows,{...options,selectedId:'air-159',viewport:{south:-80,north:-70,west:-150,east:-140}});assert.deepEqual(pinned.map(r=>r.id),['air-159']);
const fullPinned=P.allocate(rows,{...options,selectedId:'air-159'});assert.equal(fullPinned[0].id,'air-159');assert.equal(count(fullPinned).air,50,'selection consumes one of the 50 seats');
const crowded=rows.map((r,i)=>({...r,x:i%2?0:i*25,y:i%2?0:i*25})),decluttered=P.allocate(crowded,{...options,declutterRadius:18});assert.ok(Object.values(count(decluttered)).every(n=>n<=50));assert.ok(decluttered.length>50,'another company fills capacity released by capped or colliding candidates');
for(const limit of [72,120,200,300]){const out=P.allocate(rows,{...options,limit});assert.ok(out.length<=limit&&Object.values(count(out)).every(n=>n<=50));}
assert.equal(P.allocate(rows,{...options,perCompanyLimit:0}).length,0);
console.log(JSON.stringify({suite:'build384-map-company-cap',ok:true,companies:count(selected),selectedInsideCap:true,adaptiveTotalAndStableSelection:true}));
