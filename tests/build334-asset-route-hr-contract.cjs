'use strict';

const assert = require('assert/strict');
const path = require('path');

process.env.GH_TEST_SOURCE_DIR = path.resolve(__dirname, '..');
const {harness, minimal} = require('./helpers/core-harness');
const defects = [];
const passes = [];
const check = (condition, id, evidence) => condition ? passes.push(id) : defects.push({id, evidence});

const route = {
  id: 'B334-AIR-ROUTE', type: 'air', company: 'air', name: 'Audit route',
  from: 'A', to: 'B', fromFacility: 'BASE-air', toFacility: 'PUBLIC-air',
  route: [[24.7, 46.6], [25.2, 47.1]], distanceKm: 90,
  effectiveSpeedKmh: 60, tripSeconds: 100, dwellHours: 1
};
const asset = id => ({
  id, name: id, type: 'air', baseFacility: 'BASE-air', phase: 'turnaround',
  progress: 0, fuel: 100, condition: 100, routeId: null, routeSlot: null,
  departureScheduled: false, staffing: {mode: 'automatic-fixed', ready: true, roles: [], total: 1, monthlyPayroll: 1}
});

const {s: fleetBox} = harness(['route-core', 'fleet-core', 'simulation-asset-core']);
const first = asset('B334-A1');
const second = asset('B334-A2');
const fleetState = {...minimal(), assets: [first, second], customRoutes: [route]};
let batchRejected = false;
try {
  fleetBox.GH_FLEET_CORE.assignRoutesBatch(fleetState, [
    {id: first.id, routeId: route.id, route, phase: 'turnaround'},
    {id: second.id, routeId: 'WRONG-ID', route, phase: 'turnaround'}
  ]);
} catch (_error) { batchRejected = true; }
check(batchRejected && first.routeId === null && second.routeId === null,
  'FLEET_BATCH_VALIDATES_BEFORE_MUTATION', {batchRejected, firstRoute: first.routeId, secondRoute: second.routeId});

let isolationRejected = false;
try { fleetBox.GH_ROUTE_CORE.canonicalRoute({...route, company: 'sea'}); }
catch (_error) { isolationRejected = true; }
check(isolationRejected, 'ROUTE_COMPANY_ISOLATION', {isolationRejected});

const moving = {...asset('B334-MOVING'), routeId: route.id, phase: 'moving', progress: 0.5, routeSlot: 0};
// The asset slice semantics (simulation-asset-core processRow, the reference the Fleet Event engine is proven equal to:
// build356-fleet-events); app.js's unused copy of the same processor was removed.
const engineContext = {companies: {air: {serviceLevel: 85, automation: 0}}, research: {}, sustainability: {}, economy: {jetFuel: .86, bunker: 600, diesel: 1, airDemand: 100, seaDemand: 100, roadDemand: 100}, market: {share: {}, competitorPressure: {}}, reputation: {}, ownedFacilities: [], simSeconds: 0};
const processAsset = (row, routeOf) => fleetBox.GH_SIMULATION_ASSET_CORE.processRow({id: row.id, guard: 'b334', asset: structuredClone(row), route: routeOf, catalogSpecs: null, departureDelay: fleetBox.GH_FLEET_CORE.departureDelay(row)}, {simAdvance: 60, simMeta: {from: 0, to: 60}, context: engineContext}).patch;
const movingDraft = processAsset(moving, route);
check(movingDraft.departureScheduledAt === 60 + movingDraft.dwellRemaining,
  'ASSET_DEPARTURE_TIMESTAMP_DRIFTS_AFTER_MID_SLICE_ARRIVAL', {
    progressAtStart: 0.5,
    sliceSeconds: 60,
    tripSeconds: 100,
    dwellRemainingAtSliceEnd: movingDraft.dwellRemaining,
    storedDepartureScheduledAt: movingDraft.departureScheduledAt,
    expectedDepartureScheduledAt: 60 + movingDraft.dwellRemaining
  });

const missingRouteDraft = {...asset('B334-MISSING-ROUTE'), routeId: 'MISSING', phase: 'moving', progress: 0.25};
const missingRoutePatch = processAsset(missingRouteDraft, null);
check(Boolean(missingRoutePatch.simulationFault) || missingRoutePatch.routeId === null,
  'ASSET_WITH_MISSING_ROUTE_FREEZES_SILENTLY', {
    routeId: missingRoutePatch.routeId,
    phase: missingRoutePatch.phase,
    progress: missingRoutePatch.progress,
    simulationFault: missingRoutePatch.simulationFault || null
  });

const {s: hrBox} = harness(['transaction-core', 'domain-command-core', 'hr-core']);
const hrState = {...minimal(), advanced: {}, hired: [], openedCompanies: ['air'], assets: [{type: 'air'}]};
let missingCatalogRejected = false;
let missingCatalogResult = null;
try {
  missingCatalogResult = hrBox.GH_DOMAIN_COMMANDS.dispatch(
    {state: hrState, candidates: []}, 'hr', 'hire',
    {company: 'air', scope: 'executive', source: 'Build334 audit'},
    {actor: 'qa'}
  ).result;
} catch (_error) { missingCatalogRejected = true; }
check(missingCatalogRejected,
  'HR_MISSING_CANDIDATE_CATALOG_REPORTS_FALSE_COMPLETE', {
    rejected: missingCatalogRejected,
    result: missingCatalogResult,
    snapshot: hrBox.GH_HR_CORE.snapshot(hrState, {candidates: []}, 'air')
  });

const salaryState = {...minimal(), advanced: {}, hired: [], openedCompanies: []};
hrBox.GH_HR_CORE.ensure(salaryState).salaryPolicy.group.salaryIndex = 1.05;
check(Math.abs(hrBox.GH_HR_CORE.salaryMultiplier(salaryState, 'group') - 1.05) < 1e-9,
  'HR_SAVED_SALARY_INDEX_IGNORED', {multiplier: hrBox.GH_HR_CORE.salaryMultiplier(salaryState, 'group')});

const result = {passed: defects.length === 0, passCount: passes.length, passes, defectCount: defects.length, defects};
console.log(JSON.stringify(result, null, 2));
assert.deepEqual(defects, [], `${defects.length} asset/route/HR contract defects reproduced`);
