'use strict';

const assert=require('node:assert/strict');
const path=require('node:path');
process.env.GH_TEST_SOURCE_DIR=path.resolve(__dirname,'..');
const {harness,minimal}=require('./helpers/core-harness');
const Plan=require('../WebApp/asset-purchase-plan-core.js');
const Order=require('../WebApp/asset-purchase-order-core.js');
const clone=value=>structuredClone(value);

function orderFixture(){
  const fleetBaseline={fleetSize:0,membershipRevision:'0:1',revision:0,occupancy:[],ownerModeCounts:[]},deliveries=[],facilities=[{id:'B1',name:'Alpha',ownerCompanyId:'air',capacity:250000,owned:true,compatible:true}],contextToken='purchase:intent';
  const availability=Order.buildAvailability({fleetBaseline,deliveries,facilities,ownerCompanyId:'air',assetMode:'air',contextToken}),freshness={fleetSize:0,membershipRevision:'0:1',revision:0,deliveries,facilities},state={sequences:{}};
  return Order.quote({availability,freshness,contextToken,ownerCompanyId:'air',assetMode:'air',assetClass:'aircraft',operationProfileId:'air-main',companyShortName:'AIR',companyName:'Air Holdings',tab:'new',ownership:'finance',simSeconds:1234,item:{id:'A350',name:'Airframe',year:2026,condition:100,price:1250000,leaseMonthly:18000,downPayment:.25,specs:{crewPlan:{pilots:3,cabin:7,aeng:2}}},supplier:{id:'SUP-1',legalName:'Supplier LLC'},quantity:200000,distribution:'total',preferredBaseId:'B1',sequences:Order.sequenceSnapshot(state,'air'),documentLeadDays:90,leadSeconds:300,immediateDelivery:true});
}

const h=harness(['save-schema','authorization-core','document-proof-core','transaction-core','domain-command-core','asset-purchase-plan-core','asset-purchase-order-core','asset-purchase-domain-core']),{s}=h,state=minimal(),Auth=s.GH_AUTHORIZATION;state.profile={name:'Intent Holdings',founder:'Founder'};
Auth.ensurePrincipal(state,{id:'founder',legalName:'Founder'});Auth.createVisualSeal(state,{ownerPersonId:'founder',strokes:[[{x:.1,y:.2},{x:.5,y:.7},{x:.9,y:.3}]]});Auth.createDefaultMandate(state,{principalId:'founder',companyIds:['*'],scopes:['asset-purchase.*']});

const order=orderFixture(),payload=Order.commandPayload(order,{authorization:Auth}),idempotencyKey='ASSET-PURCHASE-INTENT-0001',envelope=Auth.buildActiveEnvelope(state,{domain:'asset-purchase',name:'authorize-order',payload,idempotencyKey,actor:{principalId:'founder'}});
assert.equal(JSON.stringify(payload).length<25000,true,'signed intent stays compact at 200k assets');assert.equal(JSON.stringify(payload).includes('assetIds'),false,'signed intent does not list every asset id');

const before=JSON.stringify(state),tampered=clone(envelope);tampered.command.payload.order.allocations[0].qty--;
assert.throws(()=>s.GH_DOMAIN_COMMANDS.dispatchEnvelope({state},tampered),/approval-intent-digest-mismatch/);assert.equal(JSON.stringify(state),before,'tampering after signature cannot mutate state');

const first=s.GH_DOMAIN_COMMANDS.dispatchEnvelope({state},envelope);assert.equal(first.ok,true);assert.equal(first.result.count,200000);assert.equal(first.result.allocationCount,1);assert.equal(first.result.orderDigest,payload.orderDigest);assert.ok(first.authorizationProofId);
const proof=state.authorization.proofsById[first.authorizationProofId];assert.equal(proof.payloadDigest,Auth.intentDigest(envelope.command));assert.equal(payload.orderDigest,Auth.digest(order));assert.equal(Auth.verifyProof(state,first.authorizationProofId).ok,true);

const replay=s.GH_DOMAIN_COMMANDS.dispatchEnvelope({state},envelope);assert.equal(JSON.stringify(replay),JSON.stringify(first));assert.equal(state.domainRuntime.commandSequence,1,'exact retry must not execute the commercial intent twice');
const conflictPayload=clone(payload);conflictPayload.totalUpfront+=1;const conflict=Auth.buildActiveEnvelope(state,{domain:'asset-purchase',name:'authorize-order',payload:conflictPayload,idempotencyKey,actor:{principalId:'founder'}});assert.throws(()=>s.GH_DOMAIN_COMMANDS.dispatchEnvelope({state},conflict),/Idempotency payload conflict/);assert.equal(state.domainRuntime.commandSequence,1);

console.log(JSON.stringify({suite:'build372-asset-purchase-intent',ok:true,count:order.count,rowStages:order.rowStageCount,executions:state.domainRuntime.commandSequence,authorizationProofId:first.authorizationProofId,orderDigest:payload.orderDigest}));
