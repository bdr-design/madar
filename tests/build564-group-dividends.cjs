'use strict';
// Quarterly dividends of the listed group (owner's IPO restructuring, batch 4; the founder's part stays in the holding
// until the founder's section exists). Proven on the real corporate, finance and document owners:
//  1. the policy is one of 0, 25, 40 or 60% of a quarter's profit, and only a listed group has one;
//  2. at the close of a 90th day after the listing the quarter's profit (none before the listing) × the policy is the
//     dividend, the same per share; the public's part leaves the holding by one signed outgoing transfer with its journal
//     against retained earnings, and nothing else moves: the founder's part stays, and no profit or expense is noted;
//  3. the same close again pays nothing more; another day reads nothing and writes nothing;
//  4. a quarter's loss pays nothing, and so does a holding without the cash (the record says why); in investor mode the
//     card covers the shortfall as for any payment; a policy of 0% records nothing;
//  5. the plan the page shows: the next quarter's day, its dividend so far plus the last 90 days' pace, its split, and
//     the year's dividends per share against the price.
const assert=require('node:assert/strict'),path=require('node:path');
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {scenario}=require('./helpers/business-scenario.js');
const cents=v=>Math.round(v*100)/100,plain=v=>JSON.parse(JSON.stringify(v));
function listedWorld({cash=true}={}){const env=scenario(),{s,state}=env;state.godMoney=false;state.infiniteMoney=false;
 state.ipo={listed:true,ticker:'CG',listedDay:10,issuedPct:20,proceeds:4e8,fees:1.5e7,netProceeds:3.85e8,offerPrice:20,sharesIssued:2e7,totalShares:1e8,capTable:[{holderId:'founders',label:'المؤسس',shares:8e7},{holderId:'public-float',label:'مساهمو الطرح',shares:2e7}],transferReference:'IPO-CG-10',lockupUntilDay:190};
 state.finance.dailyCompanyReports=[];for(let day=200;day>=1;day--)state.finance.dailyCompanyReports.push({id:`CLOSE-${day}`,day,net:2e6});
 if(!cash){const F=s.GH_FINANCE_CORE;F.book(state,'group').accounts[0].balance=1e6;F.reconcile(state);}
 const close=day=>s.GH_DOMAIN_COMMANDS.dispatchSystem({state},'corporate','close-dividend',{day},{actor:'financial-close'}).result;
 return {...env,close,F:s.GH_FINANCE_CORE,C:s.GH_CORPORATE_CORE};}
// 1
{const env=scenario(),{state,command}=env;state.godMoney=false;state.infiniteMoney=false;assert.throws(()=>command('corporate','set-dividend-policy',{payout:25}),/dividend-not-listed/,'1: only a listed group');
 const w=listedWorld();for(const payout of [10,30,100,-5,'x'])assert.throws(()=>w.command('corporate','set-dividend-policy',{payout}),/dividend-payout-invalid/,`1: ${payout}`);
 for(const payout of [0,25,40,60])assert.equal(w.command('corporate','set-dividend-policy',{payout}).payout,payout,`1: ${payout}%`);}
// 2 and 3
{const w=listedWorld(),{state,F}=w;w.command('corporate','set-dividend-policy',{payout:25});
 const cash0=F.operating(state,'group'),transfers0=state.finance.transfers.length,journal0=state.finance.journalEntries.length,pnl0=JSON.stringify(state.finance.offClosePnl||{});
 const paid=w.close(90),profit=80*2e6,amount=cents(profit*.25),publicAmount=cents(amount*.2);
 assert.deepEqual({day:paid.day,payout:paid.payout,profit:paid.profit,amount:paid.amount,publicAmount:paid.publicAmount,founderAmount:paid.founderAmount,paid:paid.paid},{day:90,payout:25,profit,amount,publicAmount,founderAmount:cents(amount-publicAmount),paid:true},'2: the quarter after the listing');
 assert.equal(paid.perShare,Math.round(amount/1e8*1e6)/1e6,'2: the same per share');
 const added=state.finance.transfers.slice(0,state.finance.transfers.length-transfers0);assert.equal(added.length,1,'2: one transfer');const [t]=added;
 assert.equal(t.kind,'dividend-distribution');assert.equal(t.company,'group');assert.equal(t.amount,publicAmount);assert.equal(t.reference,'DIV-CG-90');assert.equal(t.to,'مساهمو الطرح العام');assert(t.contentDigest&&t.documentProofId,'2: signed');assert.equal(t.authorizationKind,'system-unsealed','2: as a document of the close, not one awaiting the player');
 assert(Math.abs(cash0-F.operating(state,'group')-publicAmount)<.005,'2: only the public\'s part leaves the holding');
 const j=state.finance.journalEntries.slice(0,state.finance.journalEntries.length-journal0);assert.equal(j.length,1);assert.deepEqual(plain(j[0].lines.map(l=>[l.account,l.debit,l.credit])),[['أرباح مبقاة',publicAmount,0],[state.companyFinance.group.accounts[0].id,0,publicAmount]],'2: against retained earnings');
 assert.equal(JSON.stringify(state.finance.offClosePnl||{}),pnl0,'2: no profit or expense noted');
 assert.equal(w.close(90),null,'3: the same close pays nothing more');assert.equal(state.finance.transfers.length,transfers0+1);
 const before=JSON.stringify([state.advanced,state.finance,state.companyFinance]);for(const day of [91,135,179])assert.equal(w.close(day),null,`3: day ${day}`);assert.equal(JSON.stringify([state.advanced,state.finance,state.companyFinance]),before,'3: other days write nothing');
 const second=w.close(180);assert.equal(second.profit,90*2e6,'2: then a full quarter');}
// 4
{const loss=listedWorld();loss.command('corporate','set-dividend-policy',{payout:40});for(const row of loss.state.finance.dailyCompanyReports)if(row.day>10&&row.day<=90)row.net=-1e6;const t0=loss.state.finance.transfers.length;
 const r=loss.close(90);assert.equal(r.reason,'loss');assert.equal(r.paid,false);assert.equal(loss.state.finance.transfers.length,t0,'4: a loss pays nothing');
 const poor=listedWorld({cash:false});poor.command('corporate','set-dividend-policy',{payout:60});const cash=poor.F.operating(poor.state,'group'),t1=poor.state.finance.transfers.length;const p=poor.close(90);
 assert.equal(p.reason,'cash');assert.equal(p.paid,false);assert.equal(poor.state.finance.transfers.length,t1);assert.equal(poor.F.operating(poor.state,'group'),cash,'4: too little cash pays nothing');
 const card=listedWorld({cash:false});card.state.godMoney=true;card.state.infiniteMoney=true;card.command('corporate','set-dividend-policy',{payout:60});const c=card.close(90);assert.equal(c.paid,true,'4: in investor mode the card covers it');
 assert(card.state.finance.transfers.some(x=>x.kind==='founder-investment'&&x.company==='group'),'4: by a card transfer');
 const none=listedWorld();none.command('corporate','set-dividend-policy',{payout:0});const before=JSON.stringify(none.state.advanced);assert.equal(none.close(90),null,'4: 0% records nothing');assert.equal(JSON.stringify(none.state.advanced),before);}
// 5
{const w=listedWorld(),{state,C}=w;w.command('corporate','set-dividend-policy',{payout:25});state.simSeconds=60*86400;state.advanced.valuation={day:60,profit90:2e6*365,price:25};
 const plan=C.dividendPlan(state);assert.equal(plan.policy,25);assert.equal(plan.nextDay,90);assert.equal(plan.daysLeft,30);
 const quarter=50*2e6+2e6*30;assert(Math.abs(plan.estimate-cents(quarter*.25))<.01,`5: so far plus the pace (${plan.estimate})`);assert(Math.abs(plan.publicAmount-cents(plan.estimate*.2))<.01&&Math.abs(plan.founderAmount-(plan.estimate-plan.publicAmount))<.01,'5: the split');
 assert.equal(C.dividendPlan(state,60).payout,60,'5: another share for the dialog');assert.equal(plan.yieldPct,0,'5: no dividend yet');
 state.simSeconds=90*86400;w.close(90);state.simSeconds=100*86400;const after=C.dividendPlan(state);assert(Math.abs(after.yieldPct-after.records[0].perShare/25*100)<1e-9,'5: the year\'s dividends per share against the price');
 console.log(JSON.stringify({suite:'build564-group-dividends',ok:true,paid:plain(after.records[0])}));}
