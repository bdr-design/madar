'use strict';
// Build 378: solar (4 blocks) and wind (3 blocks) come online in blocks over the construction contract's lead time; a
// finished block sells test energy at 70% of the market price for 14 days, then the market price; the last block is the
// plant's commissioning. A tender can be won for a plant under construction: the contract waits for commissioning and
// runs its full term from that day. Nothing new is saved for the blocks.
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||require('path').resolve(__dirname,'..');
const assert=require('node:assert/strict');
const {harness,minimal}=require('./helpers/core-harness');
const h=harness(['capability-registry-core','company-definitions','company-platform-core','identity-system','control-plane-core','authorization-core','document-proof-core','transaction-core','domain-command-core','save-schema','determinism-core','event-ledger-core','dependency-core','policy-core','lifecycle-core','delivery-monitor-core','realism-core','finance-core','hr-core','corporate-core','procurement-core','facility-core','energy-core','economics-core','game-lifecycle-core']);
const {s}=h,d={...minimal(),profile:{name:'Energy Blocks'},bank:{},operations:{},crew:[],branches:[],hired:[],unlockedSectors:[],ownedCompanies:[]};
const state=s.GH_GAME_LIFECYCLE.pristine(d,1);
s.GH_GAME_LIFECYCLE.foundGroup(state,{mode:'sandbox',name:'Energy Group',founder:'Founder',locationId:'RUH'},d,{nextId:()=> 'FOUND-EB',simYear:()=>2026});
const E=s.GH_ENERGY_CORE,run=(name,p)=>s.GH_DOMAIN_COMMANDS.dispatch({state},'energy',name,p);
s.GH_DOMAIN_COMMANDS.dispatch({state},'corporate','open-company',{type:'power',capital:400000000,legalName:'Energy Blocks Power'});
const plant=(id,kind,amount,lead,commissioned=false)=>{
  state.constructionContracts=state.constructionContracts||[];state.constructionContracts.push({id:`CC-${id}`,company:'power',ownerCompanyId:'power',facilityKind:'power',awardedAt:0,leadDays:lead,capacityKey:`${kind}MW`,capacityAmount:amount,energyKind:kind,commissioned});
  state.customHubs.push({id,name:`${kind} ${id}`,city:'الرياض',country:'السعودية',kind:'power',company:'power',ownerCompanyId:'power',owned:true,energyKind:kind,capacityAmount:amount,capacity:`${amount} MW`,commissioned,openedAt:0,dailyCost:0,cost:82000000,constructionContractId:`CC-${id}`});
};
plant('SOLAR-B','solar',100,120);plant('WIND-B','wind',120,180);
const at=day=>{state.simSeconds=day*86400;return Object.fromEntries(E.siteEconomics(state).map(row=>[row.facilityId,row]));};

// 1. Blocks: solar every 30 days, wind every 60; nothing before the first block, no new saved field.
let rows=at(29);assert.equal(rows['SOLAR-B'].generationMWh,0);assert.equal(rows['SOLAR-B'].phasedShare,undefined);
rows=at(30);assert.equal(rows['SOLAR-B'].phasedShare,.25);assert.equal(rows['SOLAR-B'].testShare,.25,'a finished block starts on test energy');
const test=rows['SOLAR-B'];assert.ok(test.generationMWh>0&&test.spotRevenue>0);
rows=at(44);const commercial=rows['SOLAR-B'];assert.equal(commercial.testShare,0);
const spot=Number(state.advanced?.economy?.electricityPriceMWh||90);
assert.ok(Math.abs(test.spotRevenue/test.spotMWh-spot*.7)<1e-6,'test energy at 70% of the market price');
assert.ok(Math.abs(commercial.spotRevenue/commercial.spotMWh-spot)<1e-6,'then the market price');
assert.equal(at(60)['SOLAR-B'].phasedShare,.5);assert.equal(at(119)['SOLAR-B'].phasedShare,.75);
rows=at(59);assert.equal(rows['WIND-B'].generationMWh,0);rows=at(60);assert.ok(Math.abs(rows['WIND-B'].phasedShare-1/3)<1e-9);rows=at(179);assert.ok(Math.abs(rows['WIND-B'].phasedShare-2/3)<1e-9);
assert.equal(JSON.stringify(E.ensure(state).sites).includes('phasedShare'),false,'blocks are derived, never saved');

// 2. The block's output is its share of the finished plant (same plant, commissioned).
plant('SOLAR-TWIN','solar',100,120,true);rows=at(50);
const twin=rows['SOLAR-TWIN'],block=rows['SOLAR-B'];
assert.ok(Math.abs(block.generationMWh-twin.generationMWh*.25)<1e-6,'a quarter of the plant');assert.ok(Math.abs(block.operations-twin.operations*.25)<1e-6,'and a quarter of its operating cost');
const total=E.economics(state);assert.ok(total.powerRevenue>twin.dailyRevenue,'the close counts the blocks\' revenue');
state.customHubs=state.customHubs.filter(row=>row.id!=='SOLAR-TWIN');E.ensure(state).sites=E.ensure(state).sites.filter(row=>row.facilityId!=='SOLAR-TWIN');

// 3. A tender won for the solar plant under construction waits for commissioning, then runs its full term from that day.
state.simSeconds=50*86400;const energy=E.ensure(state),site=energy.sites.find(row=>row.facilityId==='SOLAR-B');let won=null;
for(let i=0;i<40&&!won;i++){energy.tenders.push({id:`TENDER-QA-${i}`,siteId:site.id,siteName:site.name,buyer:'مركز بيانات · الرياض',capacityMW:40,referencePrice:95,termDays:3650,competitors:2,day:50,expiresDay:60,status:'مفتوحة'});const result=run('bid-tender',{id:`TENDER-QA-${i}`,level:'low'});assert.equal(result.ok,true,result.error);if(result.result.won)won=result.result.contract;}
assert.ok(won,'a tender is won for a plant under construction');
assert.equal(won.status,'بانتظار التشغيل');assert.equal(won.startDay,120,'planned to start on the construction contract\'s completion day');
const signed=state.finance.commercialContracts.find(row=>row.id===won.legalDocumentId);
assert.equal(signed.startDay,120);assert.equal(signed.status,'موقع بانتظار التشغيل','the original contract makes its pending condition explicit');
assert.equal(at(80)['SOLAR-B'].ppaRevenue,0,'nothing is earned on the contract before the plant runs');
assert.equal(at(80)['SOLAR-B'].contractedMW,40,'its capacity is no longer offered');
const contract=state.energy.ppaContracts.find(row=>row.id===won.id);
const legacyPending=structuredClone(state);
state.constructionContracts.find(row=>row.id==='CC-SOLAR-B').commissioned=true;const facility=state.customHubs.find(row=>row.id==='SOLAR-B');facility.commissioned=true;
state.simSeconds=126*86400;E.ensure(state);E.tickDay(state,{day:126});
assert.equal(contract.status,'ساري');assert.equal(contract.startDay,126,'the contract starts on the day the plant runs');assert.equal(contract.endDay,126+3650,'and runs its full term');
const commissioning=state.finance.commercialContracts.find(row=>row.id===contract.commissioningDocumentId);
assert.ok(commissioning,'commissioning produces a protected addendum to the signed PPA');
assert.equal(commissioning.startDay,126);assert.equal(commissioning.endDay,126+3650);
assert.equal(commissioning.terms.originalContractId,signed.id);assert.equal(commissioning.terms.plannedStartDay,120);
assert.equal(s.GH_DOCUMENT_PROOF.verifyDocument(state,commissioning).ok,true,'the actual dates have a valid document proof');
assert.equal(signed.startDay,120,'the signed planned dates remain in the original proof');
assert.equal(state.finance.commercialContracts.filter(row=>row.id===commissioning.id).length,1,'the addendum is not duplicated');
assert.ok(at(127)['SOLAR-B'].ppaRevenue>0,'the contract earns once the plant runs');
// A saved Build 378 game may already have activated a PPA while its original proof still shows the planned dates.
legacyPending.simSeconds=126*86400;legacyPending.customHubs.find(row=>row.id==='SOLAR-B').commissioned=true;
E.ensure(legacyPending);const legacyContract=legacyPending.energy.ppaContracts.find(row=>row.id===won.id);
legacyContract.status='ساري';legacyContract.startDay=126;legacyContract.endDay=126+3650;
E.tickDay(legacyPending,{day:126});const migrated=legacyPending.finance.commercialContracts.find(row=>row.id===legacyContract.commissioningDocumentId);
assert.ok(migrated,'an already active PPA gets its missing commissioning addendum once');assert.equal(migrated.startDay,126);
console.log(JSON.stringify({suite:'build378-energy-blocks-ppa',testPrice:+(test.spotRevenue/test.spotMWh).toFixed(2),blockMWh:Math.round(block.generationMWh),contract:{start:contract.startDay,end:contract.endDay}}));
