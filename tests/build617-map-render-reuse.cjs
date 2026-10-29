'use strict';
// Owner («تتبع الثقل والاق ... ابيها اصفار»; renderMap at 2x CPU throttle in a 300k-asset world: 34 ms a render, of it
// 4 ms normalising every facility's country and city names again and 4 ms looking each representative's id up again
// among 300k rows): a facility's place is kept for the facility object while the seven fields it is read from are
// unchanged, and a representative is read from its own row. Against the source before (f4d8bfd, from its own tree):
//  1. the facility places are the same, entry for entry (the same facility object, ids and labels), on facilities with
//     a country id, a country name only, a name the directory refuses, a city id, and no city or name;
//  2. a second render normalises nothing (the source before: every facility again) and gives the same places;
//  3. a facility whose city, country, country id or id changed, one replaced by a copy and one added are worked out
//     again, and only those; the places stay the same as the source before's;
//  4. the vehicle candidates are the same, in the same order (a dead row, the selected asset kept once), and none is
//     looked up by id (the source before: one id read and one id lookup a representative).
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{execFileSync}=require('node:child_process');
const {harness}=require('./helpers/core-harness');
const ROOT=path.resolve(__dirname,'..'),PREVIOUS='f4d8bfd';
const sources={before:execFileSync('git',['-C',ROOT,'show',`${PREVIOUS}:WebApp/app.js`],{maxBuffer:64*1024*1024}).toString(),now:fs.readFileSync(path.join(process.env.GH_TEST_SOURCE_DIR||ROOT,'WebApp/app.js'),'utf8')};
const range=(app,start,end)=>{const a=app.indexOf(start),b=app.indexOf(end,a+start.length);assert(a>=0&&b>a,`missing source range ${start}`);return app.slice(a,b);};
// 1-3.
function places(app,facilities,counts){
  const directory={countryMetadata(label){counts.metadata++;if(label==='Nowhere')throw new Error('unknown-country');return {id:`C-${label.toLowerCase().replace(/\s+/g,'-')}`,label:`${label} (dir)`};}};
  const context={counts,getDynamicFacilities:()=>facilities.list,facilityDirectoryIndex:()=>directory,normalizeSearch:value=>{counts.search++;return String(value||'').toLowerCase().replace(/\s+/g,' ').trim();},
    window:{GH_DIRECTORY_CORE:{normalize:value=>{counts.normalize++;return String(value||'').toLowerCase().replace(/\s+/g,'-');}}},companyDefinition:()=>null};
  vm.runInNewContext(range(app,'  const identityRouteColor=','  function fleetMapCandidate(')+'\nglobalThis.context_=mapFacilityPresentationContext;',context);
  return context.context_;
}
const shape=byId=>[...byId].map(([id,entry])=>[id,{...entry,facility:entry.facility}]);
const facilities=[];for(let i=0;i<400;i++){const kind=i%6,row={id:`F-${i}`,name:kind===5?'':`Site ${i}`,coords:[i%80,i%170]};
  if(kind===0)row.countryId=`ISO-${i%9}`;else if(kind===1)row.country=`Land ${i%7}`;else if(kind===2)row.country='Nowhere';else if(kind===3){row.countryCode=`CC${i%5}`;row.cityId=`CITY-${i}`;}else if(kind===4)row.city=`Town ${i%11}`;
  if(i%4===0)row.city=`City ${i%13}`;facilities.push(row);}
const lists={before:{list:facilities.slice()},now:{list:facilities.slice()}},counts={before:{metadata:0,normalize:0,search:0},now:{metadata:0,normalize:0,search:0}};
const read={before:places(sources.before,lists.before,counts.before),now:places(sources.now,lists.now,counts.now)};
const work=key=>counts[key].metadata+counts[key].normalize+counts[key].search,reset=()=>{for(const key of ['before','now'])for(const name of Object.keys(counts[key]))counts[key][name]=0;};
// 1.
const first={before:shape(read.before().byId),now:shape(read.now().byId)};
assert.deepEqual(first.now,first.before,'1: the same facility places');for(const [id,entry] of read.now().byId)assert.equal(entry.facility,facilities.find(row=>row.id===id),'1: the same facility object');
assert.ok(counts.before.metadata>0&&counts.before.search>0,'1: (the refused name and the country names were exercised)');
// 2.
reset();const second={before:shape(read.before().byId),now:shape(read.now().byId)};
assert.deepEqual(second.now,second.before,'2: the same places on the next render');assert.equal(work('now'),0,`2: nothing normalised again (${JSON.stringify(counts.now)})`);assert.ok(work('before')>=400,'2: (the source before normalised every facility again)');
// 3.
reset();const edits=[[5,row=>{row.city='Moved Town';}],[9,row=>{row.country='Land 99';}],[12,row=>{row.countryId='ISO-77';}],[17,row=>{row.id='F-17b';}]];
for(const [index,edit] of edits)edit(facilities[index]);
const copy={...facilities[30],name:'Copied Site'};for(const key of ['before','now']){lists[key].list[30]=copy;lists[key].list.push({id:'F-new',name:'New Site',country:'Land 3',coords:[1,2]});}
const third={before:shape(read.before().byId),now:shape(read.now().byId)};
assert.deepEqual(third.now,third.before,'3: the same places after the changes');
const once={metadata:0,normalize:0,search:0};{const solo=places(sources.now,{list:[facilities[5],facilities[9],facilities[12],facilities[17],copy,lists.now.list[lists.now.list.length-1]]},once);solo();}
assert.deepEqual(counts.now,once,'3: only the six changed, replaced or added facilities worked out again');
// 4.
function candidates(app){
  const {s}=harness(['fleet-store-core','fleet-access-core']),assets=[];for(let i=0;i<2400;i++)assets.push({id:`A-${i}`,type:i%3?'air':'sea',routeId:i%5?`R-${i%40}`:null,phase:i%5?'moving':'idle',progress:(i%97)/97,baseFacility:`F-${i%30}`});
  const state={saveRevision:1,simSeconds:0,fleet:s.GH_FLEET_STORE.fromAssets(assets,{at:0})},real=s.GH_FLEET_DATA,calls={get:0,idAtRow:0,viewAt:0};
  const fleet={idAtRow:(...args)=>{calls.idAtRow++;return real.idAtRow(...args);},get:(...args)=>{calls.get++;return real.get(...args);},viewAt:(...args)=>{calls.viewAt++;return real.viewAt(...args);}};
  const selected=real.get(state,'A-7');
  const context={state,window:{GH_FLEET_DATA:fleet},selectedAssetId:'A-7',mapAggregateSelectedAsset:()=>selected,fleetMapCandidate:asset=>({id:asset.id,routeId:asset.routeId,progress:asset.progress,phase:asset.phase,base:asset.baseFacility})};
  vm.runInNewContext(range(app,'  function operationVehicleCandidates(','  function placeBubbleHtml(')+'\nglobalThis.candidates_=operationVehicleCandidates;',context);
  const representatives=new Map();for(let i=0;i<2400;i+=4)representatives.set(`rep-${i}`,{index:i});representatives.set('rep-dead',{index:999999});representatives.set('rep-selected',{index:7});
  const out=JSON.parse(JSON.stringify(context.candidates_({},{representatives},[],{byId:new Map()})));return {out,calls};
}
const fleet={before:candidates(sources.before),now:candidates(sources.now)};
assert.deepEqual(fleet.now.out,fleet.before.out,'4: the same candidates in the same order');assert.equal(fleet.now.out.filter(row=>row.id==='A-7').length,1,'4: the selected asset once');
assert.equal(fleet.now.calls.get+fleet.now.calls.idAtRow,0,`4: no representative looked up by id (${JSON.stringify(fleet.now.calls)})`);assert.ok(fleet.before.calls.get>=600&&fleet.before.calls.idAtRow>=600,'4: (the source before looked every one up)');
console.log(JSON.stringify({suite:'build617-map-render-reuse',ok:true,facilities:first.now.length,secondRenderWork:{before:counts.before,now:0},candidates:fleet.now.out.length,lookups:{before:fleet.before.calls,now:fleet.now.calls}}));
