'use strict';
// iPhone diagnostic review (A2): Save Schema's fleet validation context was built twice, once with the route section's
// Set of route ids (built-in routes, then custom ids, each once) and once from a plain list that kept a repeated custom
// id. A save whose custom routes repeat an id compared two different context tokens after its worker wait and failed
// with fleet-validation-unavailable instead of reporting the duplicate route. The plain list now holds each id once in
// first-seen order. Proven with the real Save Schema and fleet validation core:
//  1. with a repeated custom id (and a custom id equal to a built-in one) both builds give the same token;
//  2. without repeats the token is exactly the former one (the worker's cached answers stay valid).
const assert=require('node:assert/strict'),path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
global.window=global;for(const file of ['transaction-core.js','fleet-save-validation-core.js','save-schema.js'])require(path.join(ROOT,'WebApp',file));
const S=globalThis.GH_SAVE_SCHEMA,V=globalThis.GH_FLEET_SAVE_VALIDATION;
const route=(id,mode='air')=>({id,routeMode:mode,type:mode,ownerCompanyId:mode,fromFacility:`F-${id}-A`,toFacility:`F-${id}-B`});
const builtins=S.fleetValidationParams({customRoutes:[]}).routeIds;assert.ok(builtins.length>0,'the built-in routes are listed');
// The route section's Set: built-in routes, then each custom id in order.
const sectionToken=state=>{const ids=new Set(builtins);for(const r of state.customRoutes)if(r?.id)ids.add(r.id);return S.fleetValidationParams(state,state.customRoutes,ids).contextToken;};
// 1. Repeats.
{const state={customRoutes:[route('R-1'),route('R-2','sea'),route('R-1'),route(builtins[0])]};
  const plain=S.fleetValidationParams(state);assert.equal(new Set(plain.routeIds).size,plain.routeIds.length,'each route id is listed once');
  assert.equal(plain.contextToken,sectionToken(state),'1: both builds give the same token with a repeated id');}
// 2. No repeats: the token is the former one.
{const state={customRoutes:[route('R-1'),route('R-2','sea'),route('R-3','road')]},plain=S.fleetValidationParams(state);
  const former=V.contextToken({...plain,routeIds:[...builtins,...state.customRoutes.map(r=>r.id)]});
  assert.equal(plain.contextToken,former,'2: without repeats the token is unchanged');assert.equal(plain.contextToken,sectionToken(state));}
console.log(JSON.stringify({suite:'build525-validation-context-route-ids',ok:true,builtins:builtins.length}));
