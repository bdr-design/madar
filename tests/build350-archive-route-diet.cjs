'use strict';
// Build 350: archived mobility trips no longer carry the ~9 KB OSRM polyline; active trips keep it. Owner decision (19 Oct
// 2026): no record per trip or per driver either. A finished trip adds to one row per day and center (tripDays while the
// day is open, then tripArchive), the per-driver earnings and trip counts are gone, and finished requests are dropped.
// Every economic effect of completing or cancelling a trip is unchanged; an old per-trip archive is folded once.
const assert=require('node:assert/strict');
const path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
process.env.GH_TEST_SOURCE_DIR=ROOT;
const {scenario}=require(path.join(ROOT,'tests/helpers/business-scenario'));
const env=scenario(),{state,s,command}=env,M=s.GH_MOBILITY_CORE;

command('corporate','open-company',{type:'mobility',capital:500000000,legalName:'Test Mobility'});
state.customHubs.push({id:'MOB-CENTER-RUH',name:'Riyadh',kind:'mobility-center',ownerCompanyId:'mobility',owned:true,capitalId:'RUH',city:'Riyadh',country:'Saudi Arabia',coords:[24.7,46.7],bays:120});
M.ensure(state);state.mobility.capitalCenters.push({id:'MOB-CENTER-RUH',ownerCompanyId:'mobility',capitalId:'RUH',city:'Riyadh',country:'Saudi Arabia',coords:[24.7,46.7],facilityId:'MOB-CENTER-RUH'});
command('mobility','buy-fleet',{quantity:4,centerId:'RUH',classId:'eco-ev'});
const m=state.mobility,polyline=n=>({coordinates:Array.from({length:n},(_,i)=>[24.7+i*1e-4,46.7+i*1e-4]),distanceKm:10,source:'osrm'});
const trip=(id,v,extra)=>({id,ownerCompanyId:'mobility',requestId:'REQ-'+id,vehicleId:m.vehicles[v].id,driverId:m.drivers[v].id,centerId:'RUH',fromZone:'KAFD',toZone:'OLAYA',distanceKm:10,fare:100,route:polyline(400),routeLocked:true,routeVersion:3,routeSource:'OSRM',...extra});
for(const id of ['A','B','C'])m.rideRequests.push({id:'REQ-'+id,ownerCompanyId:'mobility',status:'active',centerId:'RUH',fromZone:'KAFD',toZone:'OLAYA',fare:100});
const completing=trip('A',0,{routeVerified:true,dueAt:1}),expiring=trip('B',1,{routeVerified:false,routingDeadlineAt:1,dueAt:null}),staying=trip('C',2,{routeVerified:true,dueAt:99999999});
const beforeFields=Object.fromEntries([completing,expiring].map(t=>[t.id,Object.keys(t).filter(k=>k!=='route')]));
m.activeTrips.push(completing,expiring,staying);
for(const i of [0,1,2]){m.vehicles[i].status='moving';m.drivers[i].status='on-trip';}
m.tripArchive.push(trip('OLD1',3,{status:'completed',completedAt:0,routeVerified:true}),trip('OLD2',3,{status:'completed',completedAt:0,routeVerified:true}));
assert.ok(m.tripArchive.every(r=>r.route),'precondition: a legacy archive still carries polylines');

const plain=value=>JSON.parse(JSON.stringify(value));
M.onSimulationTime({state},2000);

// No row per trip: the open day holds one row for the center; the legacy rows are still compacted (no polyline).
assert.deepEqual(plain(m.tripArchive.map(r=>r.id)),['OLD1','OLD2'],'no finished trip is archived on its own');
for(const row of m.tripArchive)assert.ok(!Object.prototype.hasOwnProperty.call(row,'route'),`archived ${row.id} must not carry a route`);
assert.deepEqual(plain(m.tripDays),[{id:'MOB-DAY-0-RUH',ownerCompanyId:'mobility',day:0,centerId:'RUH',completed:1,cancelled:1,grossBookings:100,driverPayouts:10,platformRevenue:90,distanceKm:10}],'one row for the day and center');
{const ids=plain(m.rideRequests.map(r=>r.id));assert.ok(!ids.includes('REQ-A')&&!ids.includes('REQ-B'),'finished requests are dropped');assert.ok(ids.includes('REQ-C'),'the open one stays');assert.ok(m.rideRequests.every(r=>r.status==='queued'||r.status==='active'),'only open requests are kept');}
for(const driver of m.drivers){assert.ok(!('earnings' in driver),'no per-driver earnings');assert.ok(!('totalTrips' in driver),'no per-driver trip count');}
assert.equal(m.vehicles[0].totalTrips,1,'the vehicle card keeps its trips');assert.equal(m.vehicles[0].totalKm,10);
// the still-active trip keeps its polyline untouched; economic effects of completing a trip are unchanged
const active=m.activeTrips.find(t=>t.id==='C');assert.equal(active.route.coordinates.length,400);
assert.equal(state.tripProfitAccrued.mobility,74);assert.equal(state.finance.pendingDailyCash.mobility,74);assert.equal(m.kpis.completed,1);
// The next day closes the row: it moves, newest first, into the archive.
m.activeTrips=m.activeTrips.filter(t=>t.id!=='C');m.vehicles[2].status='available';m.drivers[2].status='online';m.rideRequests=[];
M.onSimulationTime({state},86400+5);
assert.deepEqual(plain(m.tripArchive.map(r=>r.id)),['MOB-DAY-0-RUH','OLD1','OLD2'],'the closed day is archived as one row');assert.equal(m.tripArchive[0].completed,1);
assert.ok(m.tripDays.every(r=>r.day>=1),'only the open day stays editable');
// idempotent: a second ensure/tick changes nothing
const digest=JSON.stringify(m);M.ensure(state);assert.equal(JSON.stringify(m),digest,'ensure() is idempotent once compacted');
// the compacted state still passes the game's own schema and company-platform validation and reloads
assert.equal(s.GH_COMPANY_PLATFORM.validateState(state).ok,true);
const reloaded=s.GH_COMPANY_PLATFORM.migrateState(JSON.parse(JSON.stringify(state)));assert.equal(reloaded.errors.length,0,reloaded.errors.join(','));

// An old save: 1,200 archived trips of ~9 KB polylines (about 10 MB), per-driver ledgers and finished requests.
const perRowWithRoute=JSON.stringify(trip('X',0,{status:'completed'})).length;
const big=[];for(let i=0;i<1200;i++)big.push(trip('BIG'+i,0,{status:i%10?'completed':'cancelled',completedAt:i*300,cancelledAt:i*300,routeVerified:true,driverPayout:10,platformRevenue:90}));
delete m.tripLedgerVersion;m.tripDays=[];m.tripArchive=big;for(const d of m.drivers){d.earnings=40;d.totalTrips=4;}m.rideRequests=[{id:'REQ-OLD',status:'completed'},{id:'REQ-Q',status:'queued'}];
const migrated=M.migrateTripLedger(state);assert.equal(migrated.changed,true);assert.equal(migrated.trips,1200);
const rows=[...m.tripDays,...m.tripArchive],sum=k=>rows.reduce((n,r)=>n+r[k],0);
assert.equal(rows.length,new Set(big.map(r=>Math.floor(r.completedAt/86400))).size,'one row per day and center');
assert.equal(sum('completed'),1080);assert.equal(sum('cancelled'),120);assert.equal(sum('grossBookings'),108000);assert.equal(sum('driverPayouts'),10800);assert.equal(sum('distanceKm'),10800);
for(const d of m.drivers){assert.ok(!('earnings' in d));assert.ok(!('totalTrips' in d));}assert.deepEqual(plain(m.rideRequests.map(r=>r.id)),['REQ-Q']);
assert.equal(M.migrateTripLedger(state).changed,false,'migrated once');
const bytes=JSON.stringify(m.tripArchive).length+JSON.stringify(m.tripDays).length;
assert.ok(bytes<2000,`1,200 archived trips fold into a few day rows (got ${bytes} bytes)`);
assert.ok(perRowWithRoute>6000,'the synthetic polyline is realistic in size');
console.log(JSON.stringify({suite:'build350-archive-route-diet',archivedTrips:1200,bytesBefore:1200*perRowWithRoute,bytesAfter:bytes,dayRows:rows.length}));
