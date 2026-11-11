'use strict';
// Build 686 (a play of the whole game at a million assets): one air dispatch press spent 4 s rebuilding the facility
// list, once for every base, every registered route and both of its ends (sameUnderlyingFacilityFor -> routeFacilityFor).
// The two loops of the air and sea dispatch now build one index of the draft's facilities before they start and pass
// it. Proven on the real functions lifted from app.js, with the facility list stubbed (duplicate ids, codes shared by
// several facilities, missing ids):
//  1. with the index, routeFacilityFor returns the very facility find() returns (the first of its id), and
//     sameUnderlyingFacilityFor gives the same answer for every pair of ids;
//  2. with the index the list is built once for any number of comparisons; without it, as before, once per lookup;
//  3. the two dispatch loops build their index once, before the loop, and pass it to every comparison and lookup.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),espree=require('espree');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(ROOT,'WebApp/app.js'),'utf8'),ast=espree.parse(source,{ecmaVersion:'latest',range:true}),declared=new Map();
(function walk(node){if(!node||typeof node!=='object')return;if(node.type==='FunctionDeclaration'&&!declared.has(node.id.name))declared.set(node.id.name,source.slice(...node.range));for(const value of Object.values(node))if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object')walk(value);})(ast);
for(const name of ['facilityIndexFor','routeFacilityFor','sameUnderlyingFacilityFor'])assert.ok(declared.has(name),`app.js declares ${name}`);
const box={builds:0,list:[]};box.dynamicFacilitiesFor=()=>{box.builds++;return box.list.slice();};vm.createContext(box);
vm.runInContext(['facilityIndexFor','routeFacilityFor','sameUnderlyingFacilityFor'].map(n=>declared.get(n)).join('\n')+'\nglobalThis.api={facilityIndexFor,routeFacilityFor,sameUnderlyingFacilityFor};',box);
const {api}=box;let seed=7;const random=()=>{seed=(Math.imul(seed,1103515245)+12345)>>>0;return seed/4294967296;};
const ids=Array.from({length:40},(_,i)=>`F${i}`),codes=['DXB','RUH','JED',undefined,''];
for(let round=0;round<30;round++){
  box.list=Array.from({length:120},(_,i)=>({id:random()<.05?undefined:ids[Math.floor(random()*ids.length)],iata:codes[Math.floor(random()*codes.length)],icao:random()<.5?codes[Math.floor(random()*codes.length)]:undefined,code:random()<.3?codes[Math.floor(random()*codes.length)]:undefined,n:i}));
  const target={},probe=[...ids,'MISSING',undefined,null,''];
  box.builds=0;const index=api.facilityIndexFor(target);assert.equal(box.builds,1);
  for(const id of probe)assert.equal(api.routeFacilityFor(target,id,index),box.list.find(f=>f.id===id)||null,`1: lookup ${id}`);
  let compared=0;for(const a of probe)for(const b of probe){assert.equal(api.sameUnderlyingFacilityFor(target,a,b,index),api.sameUnderlyingFacilityFor(target,a,b),`1: pair ${a}/${b}`);compared++;}
  box.builds=0;for(const a of ids)for(const b of ids)api.sameUnderlyingFacilityFor(target,a,b,index);assert.equal(box.builds,0,'2: an indexed comparison builds nothing');
  box.builds=0;api.sameUnderlyingFacilityFor(target,'F1','F2');assert.equal(box.builds,2,'2: without an index each lookup builds the list, as before');
}
// 3. the two dispatch loops
{
  const origin=/originFacilityIndex=facilityIndexFor\(draft\),originRoutes=await cooperativeFleetMap\(originRows,origin=>\(\{originId:origin\.id,routeIds:registeredRoutes\.filter\(route=>sameUnderlyingFacilityFor\(draft,origin\.id,route\.fromFacility,originFacilityIndex\)\|\|sameUnderlyingFacilityFor\(draft,origin\.id,route\.toFacility,originFacilityIndex\)\)/;
  assert.match(source,origin,'3: the origin-route loop compares through one index');
  assert.match(source,/const routeSelectionStarted=performance\.now\(\),selectionFacilities=facilityIndexFor\(draft\);\n\s*await cooperativeFleetLoop\(routePlan\.assignments\.length/,'3: the route-selection loop builds its index before it starts');
  assert.match(source,/sameUnderlyingFacilityFor\(draft,origin\.id,route\.fromFacility,selectionFacilities\),destinationId=fromOrigin\?route\.toFacility:route\.fromFacility,endpoint=routeFacilityFor\(draft,destinationId,selectionFacilities\)/,'3: and passes it to the comparison and the lookup');
}
console.log('BUILD686_DISPATCH_FACILITY_INDEX_PASS');
