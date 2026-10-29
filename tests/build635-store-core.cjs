'use strict';
// Owner (approved design, «الاشتراكات والمشتريات», and «تسريع الوقت خل عليه عملية شراء»): GH_STORE_CORE.
//  1. the products and what they grant: Plus (monthly, yearly), the investor licence, the time accelerator, the starter
//     pack (once, first 7 days) and four capital packs; store product ids match by their suffix;
//  2. paid features are open in the development edition; in the store edition the investor mode needs its licence and
//     the accelerator (300×, long calendar advances) needs its purchase or Plus;
//  3. store:deliver writes a verified transaction once: a permanent grant, a subscription with its store expiry (held
//     until then), capital packs as documented founder investments of base × (1 + level ÷ 5), the starter pack once;
//     the same transaction delivered again is answered with its first delivery and nothing is paid twice; a
//     subscription delivery arriving out of order never shortens the expiry held;
//  4. malformed deliveries are refused (transaction id, unknown product, a subscription without expiry);
//  5. the save validation accepts what it writes and refuses a malformed root;
//  6. a Plus subscriber earns 25% more experience, pays half an early licence and runs the autopilot from level 1;
//  7. a refunded purchase is taken back once (owner «نعم تسحب»).
const assert=require('node:assert/strict');
const {harness}=require('./helpers/core-harness');
const h=harness([]),s=h.s;h.load('progression-core');h.load('store-core');
const S=s.GH_STORE_CORE,P=s.GH_PROGRESSION_CORE;assert.ok(S&&P);
const same=(a,b,m)=>assert.equal(JSON.stringify(a),JSON.stringify(b),m);
const invested=[],withdrawn=[];s.GH_FINANCE_CORE={investorMode:st=>Boolean(st?.godMoney&&st?.infiniteMoney),operating:st=>Number.isFinite(st?.__cash)?st.__cash:1e12,execute(ctx,cmd,payload){if(cmd==='founder-withdrawal'){withdrawn.push(payload);return {ref:payload.ref};}assert.equal(cmd,'founder-investment');invested.push(payload);return {ref:payload.ref};}};
// 1.
same(Object.keys(S.PRODUCTS).sort(),['capital.huge','capital.large','capital.medium','capital.small','investor.licence','plus.monthly','plus.yearly','starter.pack','time.accelerator']);
assert.equal(S.productOf('com.bdran.ventora.capital.small').suffix,'capital.small');assert.equal(S.productOf('com.x.unknown'),null);
assert.equal(S.PRODUCTS['plus.monthly'].price,'4.99');assert.equal(S.PRODUCTS['plus.yearly'].price,'39.99');assert.equal(S.PRODUCTS['investor.licence'].price,'9.99');assert.equal(S.PRODUCTS['time.accelerator'].price,'2.99');
// 2.
const st={simSeconds:0};delete s.GH_EDITION;assert.equal(S.featureOpen(st,'investor'),true,'2: development edition: open');assert.equal(S.featureOpen(st,'accelerator'),true);
s.GH_EDITION='release';assert.equal(S.featureOpen(st,'investor'),false,'2: store edition: the licence is needed');assert.equal(S.featureOpen(st,'accelerator'),false);
// 3.
const deliver=(state,payload)=>S.owner.execute({state},'deliver',payload,{id:'DOM-1'});
const r1=deliver(st,{transactionId:'1001',productId:'com.app.investor.licence'});assert.equal(r1.capital,0);assert.equal(S.featureOpen(st,'investor'),true,'3: the licence opens investor mode');
const r2=deliver(st,{transactionId:'1002',productId:'com.app.time.accelerator'});assert.equal(S.featureOpen(st,'accelerator'),true,'3: the accelerator opens 300×');
const sub={simSeconds:0},later=Date.now()+86400000;deliver(sub,{transactionId:'2001',productId:'com.app.plus.monthly',expiresAt:later});assert.equal(S.entitled(sub,'plus'),true);assert.equal(S.featureOpen(sub,'accelerator'),true,'3: Plus includes the accelerator');
assert.equal(S.entitled(sub,'plus',later+1),false,'3: a subscription holds until its store expiry');deliver(sub,{transactionId:'2002',productId:'com.app.plus.monthly',expiresAt:later+30*86400000});assert.equal(S.entitled(sub,'plus',later+1),true,'3: a renewal extends it');
// An older renewal delivered after a newer one (StoreKit's unfinished list has no order) keeps the later expiry.
deliver(sub,{transactionId:'2003',productId:'com.app.plus.yearly',expiresAt:later+5*86400000});assert.equal(S.entitled(sub,'plus',later+20*86400000),true,'3: an older delivery never shortens a subscription');assert.equal(sub.purchases.entitlements.plus.transactionId,'2002');
// Owner (approved «أ»): the clock never runs backwards for an expiry; only a save holding a subscription records it.
{const D=86400000,T=Date.now(),c={simSeconds:0};deliver(c,{transactionId:'GPA.1-2.c20261029',productId:'com.app.plus.monthly',expiresAt:T+3*D,confirmedAt:T});
  assert.equal(S.entitled(c,'plus',T+D),true,'3: a Play confirmation holds three days');assert.ok(c.purchases.clockHigh>=T,'3: the delivery records the time it saw');
  S.noteClock(c,T+10*D);assert.equal(c.purchases.clockHigh,T+10*D);assert.equal(S.entitled(c,'plus',T+D),false,'3: a date set back cannot bring an expired subscription back');
  S.noteClock(c,T);assert.equal(c.purchases.clockHigh,T+10*D,'3: the recorded time never goes down');assert.equal(S.validate(c).length,0,'3: the save with its clock is valid');
  const bad=JSON.parse(JSON.stringify(c));bad.purchases.clockHigh=-1;assert.ok(S.validate(bad).includes('store-clock'),'3: a broken clock is refused');
  const plain={simSeconds:0};deliver(plain,{transactionId:'9001',productId:'com.app.investor.licence'});S.noteClock(plain,T);assert.equal('clockHigh' in plain.purchases,false,'3: a save without a subscription is left as it is');}
const pack={simSeconds:0};deliver(pack,{transactionId:'3001',productId:'com.app.capital.small'});assert.equal(invested.length,1);assert.equal(invested[0].company,'group');assert.equal(invested[0].amount,5000000*1.2,'3: level 1 (no career): base × 1.2');assert.equal(invested[0].ref,'STORE-3001-1');
const replay=deliver(pack,{transactionId:'3001',productId:'com.app.capital.small'});assert.equal(replay.replay,true);assert.equal(invested.length,1,'3: the same transaction pays once');
const career={simSeconds:0,progression:{...P.initial('career-normal'),level:10,xp:P.XP[9]}};deliver(career,{transactionId:'3002',productId:'com.app.capital.huge'});assert.equal(invested[1].amount,160000000*3,'3: level 10: base × 3');
deliver(pack,{transactionId:'4001',productId:'com.app.starter.pack'});assert.equal(invested.length,5,'3: the starter pack invests three small packs');assert.equal(S.starterOffered(pack),false);
assert.throws(()=>deliver(pack,{transactionId:'4002',productId:'com.app.starter.pack'}),/store-once-already-delivered/,'3: the starter pack once');
assert.equal(S.owner.validate({state:pack},'deliver',{transactionId:'4001',productId:'com.app.starter.pack'}),true,'3: the same starter transaction again is a replay the shell can finish');assert.equal(deliver(pack,{transactionId:'4001',productId:'com.app.starter.pack'}).replay,true);
assert.equal(S.starterOffered({simSeconds:7*86400}),false,'3: offered in the first 7 days only');assert.equal(S.starterOffered({simSeconds:6*86400}),true);
// 4.
for(const [payload,reason] of [[{transactionId:'',productId:'com.app.capital.small'},'store-transaction-invalid'],[{transactionId:'x y',productId:'com.app.capital.small'},'store-transaction-invalid'],[{transactionId:'5',productId:'com.app.nope'},'store-product-unknown'],[{transactionId:'6',productId:'com.app.plus.yearly'},'store-subscription-expiry-required']]){
  const out=S.owner.validate({state:{}},'deliver',payload);assert.equal(out.ok,false);assert.equal(out.reason,reason,`4: ${reason}`);}
// 5.
same(S.validate({}),[]);same(S.validate(st),[]);same(S.validate(sub),[]);same(S.validate(pack),[]);same(S.validate({purchases:'x'}),['store-shape']);
const bad=JSON.parse(JSON.stringify(pack));bad.purchases.deliveries['3001'].transactionId='9';assert.ok(S.validate(bad).includes('store-delivery'));
// 6.
delete s.GH_EDITION;const plus={simSeconds:0,alerts:[],purchases:{schema:1,entitlements:{plus:{product:'plus.yearly',transactionId:'7',expiresAt:Date.now()+86400000}},deliveries:{}}};plus.progression=P.initial('career-normal');
const before=plus.progression.xp;P.onCommand(plus,'finance','transfer',{});assert.equal(plus.progression.xp-before,4,'6: 3 × 1.25');
s.GH_COMPANY_PLATFORM={getDefinition:()=>({founding:{minimumCapital:25e6}})};assert.equal(P.licenceQuote(plus,'company:air').fee,25e6*.2*2*.5,'6: half the licence fee');
assert.equal(P.unlocked(plus,'tool:autopilot'),true,'6: the autopilot from level 1');assert.equal(P.unlocked({progression:P.initial('career-normal')},'tool:autopilot'),false);
// 7. (owner «نعم تسحب») a refunded purchase is taken back once: what it granted, and the capital it added as far as the
// holding's current account holds it (a documented founder withdrawal, never a negative balance); never delivered again.
{s.GH_EDITION='release';const rv=(state,payload)=>S.owner.execute({state},'revoke',payload,{id:'DOM-R'});
  const lic={simSeconds:0};deliver(lic,{transactionId:'R100',productId:'com.app.investor.licence',store:'app-store'});assert.equal(S.featureOpen(lic,'investor'),true);assert.equal(lic.purchases.entitlements.investor.store,'app-store');
  const r=rv(lic,{transactionId:'R100',productId:'com.app.investor.licence'});same(r.entitlements,['investor'],'7: the licence is taken back');assert.equal(S.featureOpen(lic,'investor'),false,'7: investor mode is closed again');
  assert.equal(rv(lic,{transactionId:'R100',productId:'com.app.investor.licence'}).replay,true,'7: a refund is applied once');
  assert.throws(()=>deliver(lic,{transactionId:'R100',productId:'com.app.investor.licence'}),/store-transaction-revoked/,'7: a refunded transaction is never delivered again');assert.equal(S.validate(lic).length,0,'7: the save with its refund is valid');
  const cap={simSeconds:0};deliver(cap,{transactionId:'R200',productId:'com.app.capital.medium'});const added=cap.purchases.deliveries.R200.capital;cap.__cash=added/3;
  const back=rv(cap,{transactionId:'R200',productId:'com.app.capital.medium'});const last=withdrawn[withdrawn.length-1];
  assert.equal(last.company,'group');assert.equal(last.amount,Math.floor(added/3),'7: no more than the current account holds');assert.equal(last.ref,'STORE-REVOKE-R200');assert.equal(back.withdrawn,Math.floor(added/3));assert.equal(back.unrecovered,added-Math.floor(added/3),'7: what was spent is recorded, not charged below zero');
  const n=withdrawn.length;rv(cap,{transactionId:'R200',productId:'com.app.capital.medium'});assert.equal(withdrawn.length,n,'7: the capital is taken back once');
  const sub={simSeconds:0},T=Date.now();deliver(sub,{transactionId:'GPA.7-1.c20261030',productId:'com.app.plus.yearly',expiresAt:T+3*86400000,confirmedAt:T,store:'play'});
  rv(sub,{transactionId:'GPA.7-1',productId:'com.app.plus.yearly'});assert.equal(S.entitled(sub,'plus'),false,'7: a refunded Play subscription ends with its daily confirmations');
  assert.throws(()=>deliver(sub,{transactionId:'GPA.7-1.c20261031',productId:'com.app.plus.yearly',expiresAt:T+4*86400000,confirmedAt:T,store:'play'}),/store-transaction-revoked/,'7: and is not confirmed again');
  const star={simSeconds:0};deliver(star,{transactionId:'R300',productId:'com.app.starter.pack'});rv(star,{transactionId:'R300',productId:'com.app.starter.pack'});assert.ok(star.purchases.entitlements['starter.pack'],'7: the starter pack stays bought once');assert.equal(S.starterOffered(star),false);
  const bad=JSON.parse(JSON.stringify(lic));bad.purchases.revocations.R100.transactionId='X';assert.ok(S.validate(bad).includes('store-revocation'),'7: a malformed refund record is refused');
  assert.equal(S.owner.validate({state:{}},'deliver',{transactionId:'Z1',productId:'com.app.capital.small',store:'mars'}).reason,'store-name-invalid');}
console.log(JSON.stringify({suite:'build635-store-core',ok:true,products:Object.keys(S.PRODUCTS).length}));
