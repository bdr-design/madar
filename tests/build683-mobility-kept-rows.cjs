'use strict';
// Build 683 (a play of the whole game at a million assets with 30,000 Mobility cars): every simulation slice copied
// every vehicle and every driver (60,000 rows) so that the few a slice edits could be rolled back; after Build 682 it
// was half of the processor's busy time. Mobility now keeps the row as it was before its first edit inside a
// transaction (keepRow, undone after the snapshot is restored) and the snapshot keeps the membership of the two
// collections only. Driven on the real game (local DOM, real slice job, 300 cars on one centre, street routes cached
// for part of the zone pairs so that the others time out):
//   1. a slice that fails after all its writes gives the network back exactly, 96 times in a row (16 game hours):
//      the same rows in the same order with the same keys and values; and the failed slices together had assigned
//      trips, completed trips and released timed-out trips, on vehicles and on drivers (the proof is not empty);
//   2. a slice that commits reads the keys of the rows it edits and of no other row (no copy of the untouched rows);
//   3. inside a row-level transaction that fails, the one-time route normalisation (keys added to old rows), the owner
//      stamped on a row that had none, a member added and a member removed all come back;
//   4. the source: every line that edits a vehicle or a driver in place keeps the row first, and the rollback policy
//      names the two collections as owner-kept.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');

// 4. the source
{
  const source=fs.readFileSync(path.join(ROOT,'WebApp/mobility-core.js'),'utf8'),lines=source.split('\n');let writes=0;
  for(const [index,line] of lines.entries()){
    for(const name of ['vehicle','driver']){
      const write=new RegExp(`\\bdelete ${name}\\.[A-Za-z]+|\\b${name}\\.[A-Za-z]+(?:\\+\\+|--|\\s*[-+*/]?=(?!=))`).exec(line);if(!write)continue;writes++;
      const kept=line.indexOf(`keepRow(${name})`);
      assert.ok(kept>=0&&kept<write.index,`mobility-core.js:${index+1} edits a ${name} in place before keeping it: ${line.slice(Math.max(0,write.index-40),write.index+60)}`);
    }
  }
  assert.ok(writes>=11,`the in-place edits of vehicles and drivers, a deleted field among them, are found (${writes})`);
  // ensure() stamps the owner on a row of any collection through its own name for the row.
  const stamps=lines.filter(line=>/\brow\.ownerCompanyId\s*=(?!=)/.test(line));assert.equal(stamps.length,1,'one owner stamp');assert.ok(stamps[0].includes('else{keepRow(row);row.ownerCompanyId=ownerCompanyId;}'),`the owner stamp keeps the row first: ${stamps[0].trim()}`);
  assert.match(source,/const OWNER_KEPT_ROWS=Object\.freeze\(\['vehicles','drivers'\]\);/);
  assert.match(source,/const ROLLBACK_POLICY=Object\.freeze\(\{level:'rows',immutable:Object\.freeze\(\[\.\.\.IMMUTABLE_ROWS,\.\.\.OWNER_KEPT_ROWS\]\)\}\);/);
  // The sealed (append-only) collections stay what they were: vehicles and drivers are edited, never sealed.
  assert.match(source,/const IMMUTABLE_ROWS=new Set\(\['tripArchive','events','streetRoutes'\]\);/);
}

(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    const {page}=await boot({browser,errors});
    const setup=await page.evaluate(async()=>{
      const a=__AUDIT__,s=()=>__GH_STATE__;
      const d=GH_COMPANY_PLATFORM.definitionFor(s(),'mobility');
      await a.runAuthorizedDomainCommand('corporate','open-company',{type:'mobility',companyId:'mobility',capital:Math.max(400000000,d.founding.minimumCapital),legalName:'Kept rows mobility',formationContract:'KEPT-ROWS-mobility'},{silent:true});
      const M=GH_MOBILITY_CORE,st=s();
      st.customHubs.push({id:'MOB-CENTER-RUH',name:'Riyadh',kind:'mobility-center',company:'mobility',ownerCompanyId:'mobility',owned:true,capitalId:'RUH',city:'Riyadh',country:'Saudi Arabia',coords:[24.7,46.7],bays:400});
      M.ensure(st);st.mobility.capitalCenters.push({id:'MOB-CENTER-RUH',ownerCompanyId:'mobility',capitalId:'RUH',city:'Riyadh',country:'Saudi Arabia',coords:[24.7,46.7],facilityId:'MOB-CENTER-RUH'});
      await a.runAuthorizedDomainCommand('mobility','buy-fleet',{quantity:300,centerId:'RUH'},{silent:true});
      // Street routes for two zone pairs in three: a trip on any other pair waits for its street route and is released.
      let cached=0,left=0;
      for(const [i,from] of M.ZONES.entries())for(const [j,to] of M.ZONES.entries()){if((i+j)%3===0){left++;continue;}const mid=[(from.coords[0]+to.coords[0])/2+.001,(from.coords[1]+to.coords[1])/2];M.cacheStreetRoute({state:st},{centerId:'RUH',fromZone:from.id,toZone:to.id,route:[from.coords,mid,to.coords],distanceKm:8,durationSeconds:700});cached++;}
      return {vehicles:st.mobility.vehicles.length,drivers:st.mobility.drivers.length,cached,left,policy:M.ROLLBACK_POLICY};
    });
    assert.equal(setup.vehicles,300);assert.ok(setup.drivers>=300,`drivers: ${setup.drivers}`);assert.ok(setup.cached>0&&setup.left>0);
    assert.deepEqual(setup.policy,{level:'rows',immutable:['tripArchive','events','streetRoutes','vehicles','drivers']});

    const result=await page.evaluate(()=>{
      const a=__AUDIT__,s=__GH_STATE__,TX=GH_TRANSACTION_CORE,TIME=GH_SIMULATION_TIME_CORE,M=GH_MOBILITY_CORE,m=s.mobility;s.speed=0;
      const runSlice=(beforeFailure=null)=>{
        const from=s.simSeconds,to=from+600,b=TIME.boundaryAt(to),originalTime=window.GH_SIMULATION_TIME_CORE;
        if(beforeFailure)window.GH_SIMULATION_TIME_CORE={...originalTime,boundaryAt(x){TX.afterCommit(()=>{beforeFailure();throw new Error('build683-injected-failure');},{critical:true,key:'build683-injected',owner:'test'});return originalTime.boundaryAt(x);}};
        try{
          const job=a.createSimulationSliceJob(600,{from,to,speed:600,boundary:{day:b.day,hour:b.hour}});
          while(job.runChunk(64,{deadline:performance.now()+8})!==true){}
          try{return job.finish();}catch(error){return {committed:false,error:String(error?.message||error)};}
        }finally{window.GH_SIMULATION_TIME_CORE=originalTime;}
      };
      const texts=rows=>rows.map(row=>JSON.stringify(row));
      // 1. failed slices
      const edits={vehicle:{assigned:0,completed:0,released:0},driver:{assigned:0,freed:0}},failures=[];let failedSlices=0,rowsRolledBack=0;
      for(let i=0;i<96;i++){
        const vehicles=m.vehicles.slice(),drivers=m.drivers.slice(),vehicleText=texts(vehicles),driverText=texts(drivers),whole=JSON.stringify(m);let seen=0;
        const failed=runSlice(()=>{
          // All the slice's writes are done here; the failure follows.
          for(const [index,row] of m.vehicles.entries()){const text=JSON.stringify(row);if(text===vehicleText[index])continue;seen++;const before=JSON.parse(vehicleText[index]);
            if(row.tripId&&row.tripId!==before.tripId)edits.vehicle.assigned++;if(row.totalTrips>before.totalTrips)edits.vehicle.completed++;else if(before.tripId&&!row.tripId)edits.vehicle.released++;}
          for(const [index,row] of m.drivers.entries()){const text=JSON.stringify(row);if(text===driverText[index])continue;seen++;const before=JSON.parse(driverText[index]);
            if(row.tripId&&row.tripId!==before.tripId)edits.driver.assigned++;if(before.tripId&&!row.tripId)edits.driver.freed++;}
        });
        failedSlices++;rowsRolledBack+=seen;
        if(failed.committed!==false)failures.push(`slice ${i}: a failed slice was committed`);
        if(s.mobility!==m)failures.push(`slice ${i}: the network object was replaced`);
        if(m.vehicles.length!==vehicles.length||m.vehicles.some((row,index)=>row!==vehicles[index]))failures.push(`slice ${i}: the vehicles are not the same rows in the same order`);
        if(m.drivers.length!==drivers.length||m.drivers.some((row,index)=>row!==drivers[index]))failures.push(`slice ${i}: the drivers are not the same rows in the same order`);
        const vehicleAfter=texts(m.vehicles),driverAfter=texts(m.drivers),badVehicle=vehicleAfter.findIndex((text,index)=>text!==vehicleText[index]),badDriver=driverAfter.findIndex((text,index)=>text!==driverText[index]);
        if(badVehicle>=0)failures.push(`slice ${i}: vehicle ${badVehicle} came back as ${vehicleAfter[badVehicle]} instead of ${vehicleText[badVehicle]}`);
        if(badDriver>=0)failures.push(`slice ${i}: driver ${badDriver} came back as ${driverAfter[badDriver]} instead of ${driverText[badDriver]}`);
        if(JSON.stringify(m)!==whole)failures.push(`slice ${i}: the network differs after the rollback`);
        if(failures.length>6)break;
        const ok=runSlice();if(!ok.committed){failures.push(`slice ${i}: did not commit after the rollback: ${ok.reason||ok.error}`);break;}
      }
      // 2. committed slices read the keys of the rows they edit only
      const rowSet=new Set([...m.vehicles,...m.drivers]),nativeKeys=Object.keys,reads=[];
      for(let i=0;i<24;i++){
        const vehicleText=texts(m.vehicles),driverText=texts(m.drivers),read=new Set();let calls=0;
        Object.keys=function(value){if(rowSet.has(value)){calls++;read.add(value);}return nativeKeys(value);};
        let out;try{out=runSlice();}finally{Object.keys=nativeKeys;}
        if(!out.committed){failures.push(`counted slice ${i} did not commit: ${out.reason||out.error}`);break;}
        const changed=new Set();for(const [index,row] of m.vehicles.entries())if(JSON.stringify(row)!==vehicleText[index])changed.add(row);for(const [index,row] of m.drivers.entries())if(JSON.stringify(row)!==driverText[index])changed.add(row);
        reads.push({calls,read:read.size,changed:changed.size,missed:[...changed].filter(row=>!read.has(row)).length,extra:[...read].filter(row=>!changed.has(row)).length});
      }
      // 3. a row-level transaction that fails: old rows normalised, a member added, a member removed
      const direct={};
      {
        const vehicle=m.vehicles[7],driver=m.drivers[9];delete vehicle.realModel;delete vehicle.routeSource;vehicle.routeLocked=false;delete driver.centerId;m.routeSchemaVersion=2;
        const unowned=[m.vehicles[11],m.drivers[13]];for(const row of unowned)delete row.ownerCompanyId;
        const before=JSON.stringify(m),vehicles=m.vehicles.slice(),drivers=m.drivers.slice();let inside=null,error=null;
        try{TX.execute(s,{label:'build683-direct',scope:['mobility'],rowRoots:{mobility:M.ROLLBACK_POLICY},apply(){
          M.ensure(s);
          inside={realModel:vehicle.realModel,routeLocked:vehicle.routeLocked,routeSource:!!vehicle.routeSource,driverCenter:driver.centerId,schema:m.routeSchemaVersion,owners:unowned.map(row=>row.ownerCompanyId)};
          m.vehicles.push({...m.vehicles[0],id:'QA-ADDED-VEHICLE'});m.drivers.splice(3,1);
          throw new Error('build683-direct-failure');
        }});}catch(caught){error=String(caught?.message||caught);}
        direct.error=error;direct.inside=inside;direct.identical=JSON.stringify(m)===before;direct.sameRows=m.vehicles.length===vehicles.length&&m.vehicles.every((row,index)=>row===vehicles[index])&&m.drivers.length===drivers.length&&m.drivers.every((row,index)=>row===drivers[index]);
        direct.keys={realModel:'realModel' in vehicle,routeSource:'routeSource' in vehicle,driverCenter:'centerId' in driver,owners:unowned.map(row=>'ownerCompanyId' in row)};
        // The same repair outside a transaction is kept (nothing to undo).
        M.ensure(s);direct.repaired={realModel:!!vehicle.realModel,routeLocked:vehicle.routeLocked,driverCenter:driver.centerId,schema:m.routeSchemaVersion,owners:unowned.map(row=>row.ownerCompanyId)};
      }
      return {failures,failedSlices,rowsRolledBack,edits,reads,direct,rows:rowSet.size,kpis:{completed:m.kpis.completed,cancelled:m.kpis.cancelled},trips:m.activeTrips.length};
    });
    console.log(JSON.stringify({failedSlices:result.failedSlices,rowsRolledBack:result.rowsRolledBack,edits:result.edits,kpis:result.kpis,rows:result.rows,direct:result.direct}));
    // 1
    assert.deepEqual(result.failures,[],result.failures.join('\n'));assert.equal(result.failedSlices,96);
    assert.ok(result.edits.vehicle.assigned>20&&result.edits.vehicle.completed>20&&result.edits.vehicle.released>0,`the failed slices edited vehicles in the three ways: ${JSON.stringify(result.edits)}`);
    assert.ok(result.edits.driver.assigned>20&&result.edits.driver.freed>20,`the failed slices edited drivers: ${JSON.stringify(result.edits)}`);
    assert.ok(result.kpis.completed>0&&result.kpis.cancelled>0,'the committed slices completed trips and released timed-out trips');
    // 2
    const total=result.reads.reduce((sum,row)=>({calls:sum.calls+row.calls,read:sum.read+row.read,changed:sum.changed+row.changed,missed:sum.missed+row.missed,extra:sum.extra+row.extra}),{calls:0,read:0,changed:0,missed:0,extra:0});
    console.log('committed slices',JSON.stringify(total),'of',result.rows,'rows a slice');
    assert.equal(result.reads.length,24);assert.ok(total.changed>40,`the counted slices edited rows: ${JSON.stringify(total)}`);
    assert.equal(total.missed,0,'every edited row was kept before its edit');
    assert.equal(total.extra,0,`no untouched row is read by a slice: ${JSON.stringify(result.reads)}`);
    assert.equal(total.calls,total.read,'a row is kept once in a slice');
    // 3
    assert.equal(result.direct.error,'build683-direct-failure');
    assert.deepEqual(result.direct.inside,{realModel:result.direct.inside.realModel,routeLocked:true,routeSource:true,driverCenter:'RUH',schema:3,owners:['mobility','mobility']});assert.ok(result.direct.inside.realModel,'the repair ran inside the transaction');
    assert.equal(result.direct.identical,true,'the failed transaction gives the network back exactly');assert.equal(result.direct.sameRows,true,'the members are the same rows in the same order');
    assert.deepEqual(result.direct.keys,{realModel:false,routeSource:false,driverCenter:false,owners:[false,false]},'keys added by the repair and the owner stamp are removed again');
    assert.deepEqual(result.direct.repaired,{realModel:true,routeLocked:true,driverCenter:'RUH',schema:3,owners:['mobility','mobility']});
    assert.deepEqual(errors,[],errors.join('\n'));
    console.log('BUILD683_MOBILITY_KEPT_ROWS_PASS');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
