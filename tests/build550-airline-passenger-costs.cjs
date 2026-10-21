'use strict';
// A passenger flight earned its fares and paid fuel, maintenance and airport and navigation charges, but none of an
// airline's other trip costs: ground handling, passenger services and catering, sales and distribution, and station and
// administration overhead (the owner's audit: airline net margins of 35-55%). Proven on the real catalogue and the
// simulation asset owner (the trip economics the worker and the main thread both read):
//  1. a passenger flight's fees are the airport and navigation charges plus handling (350$ + 16$ per MTOW tonne),
//     passenger services (3$ + 1.1$ an hour a boarded passenger, by class) and 9% of its revenue;
//  2. freighters and business jets pay the same fees as before;
//  3. a simulated trip carries them in its fees, margin and cash contribution;
//  4. every passenger aircraft still covers its costs on its reference trip;
//  5. the previous source (run from its own tree) charged the airport and navigation fees alone.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'),SOURCE=process.env.GH_TEST_SOURCE_DIR||ROOT,PREVIOUS='70cf1df';

function scenario(){
  globalThis.window=globalThis;require(path.join(SOURCE,'WebApp/catalog.js'));
  const S=require(path.join(SOURCE,'WebApp/simulation-asset-core.js')),catalog=globalThis.GH_ASSET_CATALOG,spec=id=>[...catalog.air.new,...catalog.air.used].find(row=>row.id===id).specs;
  const reference=specs=>{const km=Math.min(specs.rangeKm*.6,5000),hours=km/(specs.speedKmh*.9),e=S.baseTripEconomics({assetMode:'air',type:'air',specs},km,hours);return {km,hours,revenue:e.revenue,fuel:e.fuelCost,maintenance:e.maintenance,fees:e.fees};};
  const rows=Object.fromEntries(catalog.air.new.map(row=>[row.id,{market:row.specs.market,...reference(row.specs)}]));
  const asset={id:'AC-QA',assetMode:'air',type:'air',ownerCompanyId:'air',specs:spec('A-A320N'),tripSeconds:5*3600,staffing:{monthlyPayroll:0}},route={id:'R-QA',distanceKm:3780,tripSeconds:5*3600};
  const trip=S.computeTripEconomics(asset,route,{companies:{air:{serviceLevel:85,crewShortage:.2}},economy:{airDemand:100,jetFuel:.86}});
  return {rows,trip:{revenue:trip.revenue,fuel:trip.fuelCost,maintenance:trip.maintReserve,fees:trip.fees,margin:trip.margin,cash:trip.cashContribution}};
}
if(process.env.GH_B550_CHILD){console.log(JSON.stringify(scenario()));return;}
(()=>{
  globalThis.window=globalThis;require(path.join(SOURCE,'WebApp/catalog.js'));
  const catalog=globalThis.GH_ASSET_CATALOG,now=scenario(),close=(a,b,t=.01)=>Math.abs(a-b)<=t,CLASS={economy:[1,.84],premium:[2,.78],business:[5,.70],first:[9,.55]};
  const airport=(s,km)=>s.mtowTon*10+(km/100)*Math.sqrt(s.mtowTon/50)*60;
  const added=(s,row)=>350+16*s.mtowTon+Object.entries(CLASS).reduce((n,[cls,[factor,load]])=>n+Math.max(0,Number(s.cabin?.[cls])||0)*load*(3+1.1*row.hours)*factor,0)+row.revenue*.09;
  for(const item of catalog.air.new){const s=item.specs,row=now.rows[item.id];
    if(s.market==='air-pax')assert(close(row.fees,airport(s,row.km)+added(s,row)),`1: ${item.id} pays handling, passenger services, distribution and overhead (${row.fees} vs ${airport(s,row.km)+added(s,row)})`);
    else assert(close(row.fees,airport(s,row.km)),`2: ${item.id} pays its airport and navigation fees alone (${row.fees})`);
    if(s.market==='air-pax'){const margin=(row.revenue-row.fuel-row.maintenance-row.fees)/row.revenue;assert(margin>.05&&margin<.85,`4: ${item.id} still covers its costs (${(margin*100).toFixed(0)}%)`);}
  }
  const a320=now.rows['A-A320N'];assert(close(added(catalog.air.new.find(x=>x.id==='A-A320N').specs,a320)/a320.revenue,.152,.01),'1: about 15% of an A320neo\'s revenue on its reference trip');
  const t=now.trip;assert(t.fees>airport(catalog.air.new.find(x=>x.id==='A-A320N').specs,3780)*.8+0.09*t.revenue,`3: the simulated trip carries them (${JSON.stringify(t)})`);
  assert(close(t.margin,t.revenue-t.fuel-t.maintenance-t.fees)&&close(t.cash,t.margin),'3: in its margin and cash contribution');
  const tree=fs.mkdtempSync(path.join(os.tmpdir(),'b550-'));
  try{execFileSync('sh',['-c',`git -C "${ROOT}" archive ${PREVIOUS} WebApp | tar -x -C "${tree}"`]);
    const before=JSON.parse(execFileSync(process.execPath,[__filename],{env:{...process.env,GH_B550_CHILD:'1',GH_TEST_SOURCE_DIR:tree},encoding:'utf8',maxBuffer:16*1024*1024}).trim().split('\n').at(-1));
    const s=catalog.air.new.find(x=>x.id==='A-A320N').specs,old=before.rows['A-A320N'];
    assert(close(old.fees,airport(s,old.km))&&close(old.revenue,a320.revenue),`5: the previous source charged the airport fees alone (${old.fees})`);
    assert(t.fees>before.trip.fees*2,'5: and its simulated trip paid much less');
    const margins=rows=>Object.fromEntries(['A-ATR72','A-A320N','A-B789'].map(id=>[id,+((rows[id].revenue-rows[id].fuel-rows[id].maintenance-rows[id].fees)/rows[id].revenue*100).toFixed(1)]));
    console.log(JSON.stringify({suite:'build550-airline-passenger-costs',ok:true,referenceTripMargin:{current:margins(now.rows),previous:margins(before.rows)}}));
  }finally{fs.rmSync(tree,{recursive:true,force:true});}
})();
