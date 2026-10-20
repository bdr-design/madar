'use strict';
// A fleet company insured with an outside insurer books the repair of an incident as an expense in its daily close, but
// the insurer's payment of the covered part arrived as cash only: the close never saw it, so the company's profit showed
// the whole loss. (Claims paid by the group's own insurer, and hospitality claims, were already in the close.) Proven on
// the real realism, finance and domain command owners:
//  1. an outside insurer's claim payment reaches the fleet company's daily close as income, equal to the cash it got;
//  2. a claim is paid once: a later realism day adds nothing;
//  3. the previous source (run from its own tree) paid the cash without the income.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'),SOURCE=process.env.GH_TEST_SOURCE_DIR||ROOT,PREVIOUS='aa8e50a';
process.env.GH_TEST_SOURCE_DIR=SOURCE;
const {harness,minimal}=require('./helpers/core-harness');

function scenario(){
  const h=harness(['capability-registry-core','company-definitions','company-platform-core','identity-system','control-plane-core','authorization-core','document-proof-core','transaction-core','domain-command-core','save-schema','determinism-core','event-ledger-core','dependency-core','policy-core','lifecycle-core','delivery-monitor-core','realism-core','finance-core','hr-core','corporate-core','facility-core','game-lifecycle-core']);
  const {s}=h,d={...minimal(),profile:{name:'Claim Group'},bank:{},operations:{},crew:[],branches:[],hired:[],unlockedSectors:[],ownedCompanies:[]};
  const state=s.GH_GAME_LIFECYCLE.pristine(d,1);s.GH_GAME_LIFECYCLE.foundGroup(state,{mode:'sandbox',name:'Claim Group',founder:'Founder',locationId:'RUH'},d,{nextId:()=>'FOUND-CLM',simYear:()=>2026});
  s.GH_DOMAIN_COMMANDS.dispatch({state},'corporate','open-company',{type:'air',capital:200000000,legalName:'Test Air'});
  const F=s.GH_FINANCE_CORE,R=s.GH_REALISM;R.migrate(state);
  const day=20;state.simSeconds=day*86400;state.advanced.insurance={claims:[{id:'CLM-AIR-15',company:'air',ownerCompanyId:'air',insurerCompanyId:null,policyReference:null,openedAt:15*86400,status:'قيد الفحص',loss:2000000,deductible:250000,covered:1750000,reserve:1750000,incidents:1}],annualPremium:0,fleetPolicies:[]};
  F.takeOffClosePnl(state);const cash=()=>F.book(state,'air').accounts[0].balance,before=cash();
  R.onDay(state,day);
  const claim=state.advanced.insurance.claims[0],first={status:claim.status,paid:claim.paid,cash:cash()-before,income:F.takeOffClosePnl(state).air?.revenue||0};
  state.simSeconds=(day+1)*86400;R.onDay(state,day+1);const again={cash:cash()-before-first.cash,income:F.takeOffClosePnl(state).air?.revenue||0};
  return {first,again};
}
if(process.env.GH_B543_CHILD){console.log(JSON.stringify(scenario()));return;}
(()=>{
  const now=scenario();
  assert.equal(now.first.status,'مدفوعة','the claim was paid');assert.equal(now.first.paid,1750000);
  assert(Math.abs(now.first.cash-1750000)<.01,`the company received the covered amount (${JSON.stringify(now.first)})`);
  assert(Math.abs(now.first.income-1750000)<.01,`1: and its close carries it as income (${JSON.stringify(now.first)})`);
  assert.equal(now.again.income,0,'2: a later day adds no income');assert(Math.abs(now.again.cash)<.01,'2: nor cash from the claim');
  const tree=fs.mkdtempSync(path.join(os.tmpdir(),'b543-'));
  try{execFileSync('sh',['-c',`git -C "${ROOT}" archive ${PREVIOUS} WebApp | tar -x -C "${tree}"`]);
    const before=JSON.parse(execFileSync(process.execPath,[__filename],{env:{...process.env,GH_B543_CHILD:'1',GH_TEST_SOURCE_DIR:tree},encoding:'utf8',maxBuffer:16*1024*1024}).trim().split('\n').at(-1));
    assert(Math.abs(before.first.cash-1750000)<.01,'the previous source paid the cash too');assert.equal(before.first.income,0,'3: without the income');
    console.log(JSON.stringify({suite:'build543-external-claim-recovery',ok:true,current:now,previous:before}));
  }finally{fs.rmSync(tree,{recursive:true,force:true});}
})();
