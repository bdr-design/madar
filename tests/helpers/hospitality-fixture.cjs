'use strict';
const {harness,minimal}=require('./core-harness');
function hospitalityFixture(){
 const h=harness(['capability-registry-core','company-definitions','company-platform-core','identity-system','control-plane-core','authorization-core','document-proof-core','transaction-core','domain-command-core','save-schema','determinism-core','event-ledger-core','dependency-core','policy-core','lifecycle-core','delivery-monitor-core','realism-core','finance-core','branch-campaign-core','hr-core','corporate-core','facility-core','business-world-core','banking-core','insurance-core','energy-core','realestate-core','economics-core','game-lifecycle-core','mobility-core','customer-base-core','hospitality-calendar-core','hospitality-finance-core','hospitality-core','hospitality-links-core','company-adapters-core']);
 const {s}=h,defaultState={...minimal(),profile:{name:'Hospitality QA'},bank:{},operations:{},crew:[],branches:[],hired:[],unlockedSectors:[],ownedCompanies:[]},state=s.GH_GAME_LIFECYCLE.pristine(defaultState,1);
 s.GH_GAME_LIFECYCLE.foundGroup(state,{mode:'sandbox',name:'مجموعة الاختبار',founder:'المؤسس',locationId:'RUH'},defaultState,{nextId:()=> 'FOUND-HOSPITALITY-QA',simYear:()=>2026});
 s.GH_DOMAIN_COMMANDS.dispatch({state},'corporate','open-company',{type:'hospitality',capital:120000000});
 const H=s.GH_HOSPITALITY_CORE,F=s.GH_FINANCE_CORE;
 const command=(name,p={},key)=>s.GH_DOMAIN_COMMANDS.dispatch({state},'hospitality',name,{companyId:'hospitality',...p},key?{idempotencyKey:key}:{}).result;
 function property(kind='hotel',capitalId='RUH'){
  const quote=H.buildQuote(state,'hospitality',{kind,capitalId}),created=command('start-property',{kind,capitalId,expectedCost:quote.cost});
  const q=H.accelerationQuote(state,'hospitality',created.propertyId);command('accelerate-construction',{propertyId:created.propertyId,expectedFee:q.fee,expectedCompleteDay:q.completeDay});
  state.advanced.facilities[created.propertyId].staff=H.TYPES[kind].staff;
  return H.read(state,'hospitality').properties.find(p=>p.id===created.propertyId);
 }
 function tick(day){state.simSeconds=day*86400;return s.GH_DOMAIN_COMMANDS.dispatchSystem({state},'hospitality','tick-day',{companyId:'hospitality',day},{actor:'simulation-scheduler'}).result;}
 function advance(last){const next=(H.read(state,'hospitality')?.lastProcessedDay??-1)+1;for(let day=next;day<=last;day++)tick(day);}
 return {...h,state,H,F,command,property,tick,advance};
}
module.exports={hospitalityFixture};
