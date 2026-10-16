'use strict';
const assert=require('node:assert/strict'),{scenario}=require('./helpers/business-scenario');
const e=scenario(),{s,state}=e,S=s.GH_SAVE_SCHEMA,T=s.GH_TRANSACTION_CORE;
const route=()=>({id:'QA-R1',type:'air',routeMode:'air',ownerCompanyId:'air',fromFacility:'B1',toFacility:'B2',route:[[20,30],[21,31]]});
const validate=()=>S.validate(state),work=()=>S.telemetry().lastValidation.routeWork;
state.customRoutes=[route()];assert.equal(validate().ok,true);assert.equal(validate().ok,true);assert.equal(work().geometryChecks,1);
state.customRoutes[0].route[1][0]=200;assert.ok(validate().errors.includes('route-geometry'),'mutable geometry must be read again');
state.customRoutes=[Object.freeze(route())];assert.equal(validate().ok,true);state.customRoutes[0].route[1][1]=999;assert.ok(validate().errors.includes('route-geometry'),'shallow freeze is insufficient');
state.customRoutes=[route()];T.sealValue(state.customRoutes[0]);assert.equal(validate().ok,true);assert.equal(work().geometryChecks,1);assert.equal(validate().ok,true);assert.equal(work().geometryCacheHits,1);assert.equal(work().geometryChecks,0);
state.customRoutes[0]={...route(),fromFacility:'B2',toFacility:'B2'};T.sealValue(state.customRoutes[0]);assert.ok(validate().errors.includes('route-shape'),'shape cannot inherit cached evidence');
state.customRoutes=[route(),{...route(),id:'QA-R2',route:[[21,31],[20,30]]}];for(const r of state.customRoutes)T.sealValue(r);assert.ok(validate().errors.includes('route-geometry-duplicate')); // cached signatures still detect reverse duplicates
state.customRoutes[1]={...route(),id:'QA-R2',ownerCompanyId:''};assert.ok(validate().errors.includes('route-shape'));
console.log(JSON.stringify({suite:'build382-route-validation-cache',ok:true,mutableAndShallowFrozenRechecked:true,sealedCacheHits:1}));
