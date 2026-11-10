'use strict';
// Build 666, found by a review of the play-through and reproduced with the game's own daily close: the business world's
// parties are never removed, the save schema allowed 500 of them, and the bank made one per market loan request at the
// decision (even for a request only deferred). A bank of eight branches left alone reached party 501 on game day 951: the
// schema then refused every save and every command, and the next day's slice was rolled back for good. A group with a
// telecom and a dealership in every capital met the limit on day 69, the markets' own parties being one per country.
// Now a borrower is one party however many requests it makes, and the limit leaves room for the writers that the world's
// geography bounds (2,000 parties, 6,000 relationships). Checked here with real commands, no party written by hand:
//   1. a bank of eight branches, 150 game days of the real daily close and of the autopilot's own bank step: its parties
//      are its distinct borrowers, far fewer than the requests decided; every contract's customer is a party; the state is
//      valid on the last day;
//   2. the limits, through the real writers (upsertParty, touchRelationship): 2,000 parties keep the state valid and one
//      more is refused; 6,000 relationships keep it valid and one more is refused.
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||require('node:path').resolve(__dirname,'..');
const assert=require('node:assert/strict');
const {harness,minimal}=require('./helpers/core-harness');
const MODULES=['world-data','capability-registry-core','company-definitions','company-platform-core','identity-system','control-plane-core','authorization-core','document-proof-core','transaction-core','domain-command-core','save-schema','determinism-core','event-ledger-core','dependency-core','policy-core','lifecycle-core','delivery-monitor-core','realism-core','finance-core','branch-campaign-core','hr-core','corporate-core','facility-core','business-world-core','banking-core','insurance-core','energy-core','realestate-core','economics-core','game-lifecycle-core','mobility-core','customer-base-core','hospitality-calendar-core','hospitality-finance-core','hospitality-core','hospitality-links-core','company-adapters-core','company-autopilot-core','strategy-core','conference-core','operations-core','contracts-core','market-core','migration-core','advanced-core'];
const {s}=harness(MODULES),DAY=86400;
const data={...minimal(),profile:{name:'Party Capacity'},bank:{},operations:{},crew:[],branches:[],hired:[],unlockedSectors:[],ownedCompanies:[]},state=s.GH_GAME_LIFECYCLE.pristine(data,1);
s.GH_GAME_LIFECYCLE.foundGroup(state,{mode:'sandbox',name:'Party Capacity Group',founder:'Founder',locationId:'RUH'},data,{nextId:()=>'FOUND-PC',simYear:()=>2026});s.GH_ADVANCED.migrate(state);s.GH_REALISM.migrate(state);
const D=s.GH_DOMAIN_COMMANDS,F=s.GH_FINANCE_CORE,P=s.GH_COMPANY_AUTOPILOT,TX=s.GH_TRANSACTION_CORE,W=s.GH_BUSINESS_WORLD,Schema=s.GH_SAVE_SCHEMA;
const player=(domain,name,payload)=>D.dispatch({state},domain,name,payload).result,system=(domain,name,payload,actor)=>D.dispatchSystem({state},domain,name,payload,{actor}).result;
const parties=()=>Object.keys(state.businessWorld?.parties||{}),bankParties=()=>parties().filter(id=>id.startsWith('BANK-CUST-'));
const valid=label=>{const out=Schema.validate(state);assert.ok(out.ok,`${label}: ${JSON.stringify(out.errors)}`);};

// A bank with its default capital and a branch in eight capitals (facilities create + banking open-branch, as the app does).
player('corporate','open-company',{type:'bank',capital:s.GH_COMPANY_PLATFORM.getDefinition('bank').founding.defaultCapital,legalName:'Capacity Bank'});
for(const capitalId of ['RUH','AUH','DOH','KWI','CAI','LON','PAR','BER']){const capital=s.GH_MOBILITY_CORE.capitalMeta(capitalId),id=`PC-BANK-${capitalId}`,site={key:`site:bank:${capitalId}`,sourceKey:`site:bank:${capitalId}`,capitalId,city:capital.city,country:capital.country,coords:[...capital.coords]};
  player('facilities','create',{facility:{id,sourceKey:site.key,capitalId,company:'bank',ownerCompanyId:'bank',kind:'bank',owned:true,name:`bank · ${capital.city}`,city:capital.city,country:capital.country,coords:[...capital.coords],cost:15000000,dailyCost:5500},bucket:'customHubs',groupValueAdd:0});
  player('banking','open-branch',{branchId:'BR-'+id,facilityId:id,site,servicesActive:true});}
assert.equal(state.bank.branchNetwork.filter(branch=>branch.servicesActive).length,8);valid('the bank is set up');
// One game day as the app runs it: the day's owners, then the market hour through the control plane with the schema check
// due (app.js MARKET_HOURLY_CYCLE); then the autopilot's bank step, each planned command through the system dispatch.
const daySlice=day=>TX.execute(state,{label:`simulation:day-slice:${day}`,apply(){state.simSeconds=day*DAY;state.lastFinancialDay=day;const stages=s.GH_ADVANCED.onFinancialDayStages(state,day);let step;while(!(step=stages.next()).done){}
  const hour=day*24;s.GH_CONTROL_PLANE.execute(state,{name:'MARKET_HOURLY_CYCLE',domain:'market',actor:'simulation-market',correlationId:`MARKET-HOUR-${hour}`},()=>{s.GH_ADVANCED.onMarketHour(state,hour);return {hour};},{atomic:false,integrity:true,schema:true,deferIntegrityToTransaction:true});return step.value;}});
const decided={approved:0,rejected:0,skipped:0},borrowers=new Set(),requests=new Set();
function autopilotBank(){const tried=new Set();for(let steps=0;steps<64;steps++){const step=P.next(state,'bank',{tried,F});if(!step)break;for(const key of step.keys)tried.add(key);
  const out=TX.execute(state,{label:'company-autopilot:bank',apply:()=>Array.from(step.commands,command=>system(command.domain,command.name,command.payload,P.ACTOR))});assert.equal(out.committed,true,out.reason);
  for(const result of out.value){decided.approved+=Number(result?.approved)||0;decided.rejected+=Number(result?.rejected)||0;decided.skipped+=Number(result?.skipped)||0;}}}

// 1. 150 game days.
const baseline=parties().length;
for(let day=1;day<=150;day++){const out=daySlice(day);assert.equal(out.committed,true,`day ${day}: ${out.reason}`);for(const request of state.bank.loanRequests){requests.add(request.id);borrowers.add(String(request.borrower));}autopilotBank();}
const customers=bankParties(),decisions=decided.approved+decided.rejected+decided.skipped,names=new Set(customers.map(id=>{const party=state.businessWorld.parties[id];return String(party.displayName||party.legalName||party.name||id);}));
assert.ok(requests.size>=60&&decisions>=100,`enough activity to judge: ${requests.size} requests, ${decisions} decisions`);
assert.ok(customers.length>0&&customers.length<=borrowers.size,`the bank's parties (${customers.length}) are at most its distinct borrowers (${borrowers.size})`);
assert.equal(names.size,customers.length,'one party per borrower: no two of the bank\'s parties share a name');
assert.ok(customers.length*3<=requests.size,`far fewer parties (${customers.length}) than requests (${requests.size})`);
assert.equal(parties().length,baseline+customers.length,'nothing else made a party');
const contracts=Array.from(state.bank.customerLoanContracts);assert.ok(contracts.length>0,'loans were granted');
for(const contract of contracts)assert.ok(W.resolveParty(state,contract.customerId),`contract ${contract.id}: its customer is a party`);
valid('after 150 game days');
console.log(`1 ok: 150 game days, ${requests.size} loan requests, ${decisions} decisions, ${contracts.length} loans: ${customers.length} bank parties (${borrowers.size} distinct borrowers)`);

// 2. The limits, through the real writers.
{const fill=(count,label)=>{const out=TX.execute(state,{label:`parties:${label}`,apply:()=>{for(let index=parties().length;index<count;index++)W.upsertParty(state,{id:`ORG-CAPACITY-${index}`,name:`Capacity Party ${index}`,displayName:`Capacity Party ${index}`,role:'customer',industry:'أعمال متنوعة',country:'دولي',sectors:['bank']});}});assert.equal(out.committed,true,out.reason);};
  fill(501,'501');valid('501 parties');fill(2000,'2000');assert.equal(parties().length,2000);valid('2,000 parties');
  W.upsertParty(state,{id:'ORG-CAPACITY-OVER',name:'One Too Many',displayName:'One Too Many',role:'customer',industry:'أعمال متنوعة',country:'دولي',sectors:['bank']});
  assert.ok(Array.from(Schema.validate(state).errors).includes('business-world-party-capacity'),'party 2,001 is refused');delete state.businessWorld.parties['ORG-CAPACITY-OVER'];valid('back at 2,000');
  // Relationships through the real writer (touchRelationship: one per party and company), with a third company opened.
  const insurance=s.GH_COMPANY_PLATFORM.getDefinition('insurance').founding.defaultCapital,need=insurance-F.operating(state,'group')+1000000;if(need>0)F.execute({state},'founder-investment',{company:'group',amount:need,ref:'PC-FUND-INSURANCE'});
  player('corporate','open-company',{type:'insurance',capital:insurance,legalName:'Capacity Insurance'});
  const ids=parties(),count=()=>Object.keys(state.businessWorld.relationships).length,link=(party,company)=>W.touchRelationship(state,{partyId:party,company,role:'customer',reference:`CAPACITY-${company}-${party}`});
  {const out=TX.execute(state,{label:'relationships:6000',apply:()=>{for(const company of ['group','bank','insurance'])for(const party of ids){if(count()>=6000)return;link(party,company);}}});assert.equal(out.committed,true,out.reason);}
  assert.equal(count(),6000);valid('6,000 relationships');
  // 2,000 parties with three companies are 6,000 relationships: the next one needs a fourth company.
  {const capital=s.GH_COMPANY_PLATFORM.getDefinition('telecom').founding.defaultCapital,short=capital-F.operating(state,'group')+1000000;if(short>0)F.execute({state},'founder-investment',{company:'group',amount:short,ref:'PC-FUND-TELECOM'});
    player('corporate','open-company',{type:'telecom',capital,legalName:'Capacity Telecom'});assert.equal(count(),6000,'opening a company writes no relationship');valid('6,000 relationships and a fourth company');link(ids[0],'telecom');assert.equal(count(),6001,'one more relationship was written');}
  const over=Array.from(Schema.validate(state).errors);assert.deepEqual(over,['business-world-relationship-capacity'],`relationship 6,001 is refused, and only for its number: ${JSON.stringify(over)}`);}
console.log('2 ok: 2,000 parties are valid and one more is refused; the same for 6,000 relationships');
console.log('build666 party capacity: 2 checks passed');
