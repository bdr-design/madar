'use strict';
// The owner's shares review («حل المشاكل»). Proven in the real app (its purchase, sale, listing and stock desk, durable
// commands and save), with only the native storage protocol doubled, investor mode off:
//  1. buying an asset and selling it again leaves the group value where it was (it used to gain 68% of the price a
//     round trip, for nothing), and the sale pays the fleet owner's own quote whatever price the page sends;
//  2. returning a leased asset charges two months' rent whatever fee the page sends, and gives back its 8%;
//  3. the sale quote is the same formula the page used (no price changed), constant work per asset;
//  4. a listing whose value moved less than 1% while the dialog was open lists at the live value;
//  5. after a day boundary every stock keeps its previous close, and the desk shows the day's move.
const assert=require('node:assert/strict'),path=require('node:path'),{chromium}=require('playwright');
const {bootAtOrigin,installVault}=require('./helpers/differential-vault-fixture.cjs'),{prepareCommandWorld}=require('./helpers/command-world-fixture.cjs');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
(async()=>{const browser=await chromium.launch({headless:true}),errors=[];let env;try{
 env=await bootAtOrigin({browser,root:ROOT,errors,fleetWorker:true,viewport:{width:1180,height:820},beforeScripts:{fn:installVault}});const {page}=env;page.setDefaultTimeout(120000);await prepareCommandWorld(page,{count:2});
 const settled=()=>page.waitForFunction(()=>!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked());
 await page.evaluate(()=>{__GH_STATE__.godMoney=false;__GH_STATE__.infiniteMoney=false;});
 // 1 and 2
 const trips=await page.evaluate(async()=>{const s=__GH_STATE__,F=GH_FINANCE_CORE,a=__AUDIT__,cash=()=>Object.keys(s.companyFinance).reduce((n,t)=>n+F.total(s,t),0),model=GH_ASSET_CATALOG.air.new.slice().sort((x,y)=>x.price-y.price)[0],rows=[];
  const newest=()=>{let found=null;GH_FLEET_DATA.forEach(s,row=>{if(row.catalogId===model.id)found=row.id;});return found;};
  for(const ownership of ['cash','cash','lease']){const value0=s.groupValue,cash0=cash();if(!await a.buyAsset('air','new',model.id,ownership,1,'QA-TRACE-BASE',true,`QA-559-${rows.length}`,'air'))throw Error('buy failed');
   const id=newest(),asset=GH_FLEET_DATA.get(s,id),quote=GH_FLEET_CORE.saleQuote(s,asset),monthly=Number(asset.monthlyLease)||0,valueBought=s.groupValue,cashBought=cash();
   const out=await a.runAuthorizedDomainCommand('fleet','dispose',{id,proceeds:quote.proceeds*10,fee:0,atOwnedCenter:true,buyer:'QA buyer'});
   rows.push({ownership,price:model.price,lease:monthly,status:out.result.status,added:valueBought-value0,left:s.groupValue-value0,saleCash:cash()-cashBought,quote,bought:cashBought-cash0});}
  return rows;});await settled();
 for(const row of trips.filter(r=>r.ownership==='cash')){assert.equal(row.status,'sold');assert(Math.abs(row.added-row.price*.86)<.01,`1: buying adds 86% (${JSON.stringify(row)})`);assert(Math.abs(row.left)<.01,`1: a round trip leaves the group value where it was (${JSON.stringify(row)})`);assert(Math.abs(row.saleCash-row.quote.proceeds)<.01,`1: the sale pays the owner's quote, not the page's price (${JSON.stringify(row)})`);}
 const lease=trips.find(r=>r.ownership==='lease');assert.equal(lease.status,'returned');assert(Math.abs(lease.added-lease.price*.08)<.01&&Math.abs(lease.left)<.01,`2: a lease gives back its 8% (${JSON.stringify(lease)})`);assert(lease.lease>0&&Math.abs(lease.saleCash+lease.lease*2)<.01,`2: two months' rent whatever the page sends (${JSON.stringify(lease)})`);
 // 3
 const parity=await page.evaluate(()=>{const s=__GH_STATE__,old=(a,item)=>{const basis=Number(a.purchasePrice)||Number(item?.price)||1000000,residual=Math.max(.15,Math.min(.95,(Number(item?.residual5y)||60)/100)),built=Number(a.year)||2026,ageYears=Math.max(0,2026+(Number(s.simSeconds)||0)/(365*86400)-built),value=(Number(a.purchasePrice)?basis*Math.pow(residual,Math.max(0,ageYears-Math.max(0,2026-built))/5):basis*Math.pow(residual,ageYears/5));return value*(.7+.3*Math.max(0,Math.min(100,Number(a.condition??100)))/100);};
  let worst=0,checked=0;for(const type of ['air','sea','road'])for(const kind of ['new','used'])for(const item of GH_ASSET_CATALOG[type][kind])for(const [year,condition,purchasePrice] of [[2026,100,item.price],[2019,63,item.price],[2012,35,0]]){const a={type,catalogId:item.id,ownership:'cash',year,condition,purchasePrice};worst=Math.max(worst,Math.abs(GH_FLEET_CORE.saleQuote(s,a).proceeds-old(a,item)));checked++;}
  const sample={type:'air',catalogId:GH_ASSET_CATALOG.air.new[0].id,ownership:'cash',year:2020,condition:80,purchasePrice:0},t0=performance.now();let sum=0;for(let i=0;i<100000;i++)sum+=GH_FLEET_CORE.saleQuote(s,sample).proceeds;return {worst,checked,ms:performance.now()-t0,sum};});
 assert(parity.checked>100&&parity.worst<1e-6,`3: the same prices (${JSON.stringify(parity)})`);assert(parity.ms<400,`3: 100,000 quotes in ${parity.ms.toFixed(1)} ms`);
 // 4
 await page.evaluate(()=>__AUDIT__.openDrawer('stocks','ipo'));await page.waitForSelector('#drawerBody .launch-ipo');
 const shown=await page.evaluate(()=>Number(__GH_STATE__.groupValue));await page.locator('#drawerBody .launch-ipo').click();await page.waitForSelector('dialog.ui-confirm[open]');
 await page.evaluate(v=>__AUDIT__.runAuthorizedDomainCommand('corporate','adjust-group-value',{delta:Math.round(v*.005)},{silent:true}),shown);await settled();
 const live=await page.evaluate(()=>Number(__GH_STATE__.groupValue));await page.locator('dialog.ui-confirm [data-confirm="accept"]').click();await page.waitForFunction(()=>__GH_STATE__.ipo?.listed===true);await settled();
 const ipo=await page.evaluate(()=>__GH_STATE__.ipo);assert(Math.abs(ipo.offerPrice-live/82000000)<1e-9,`4: listed at the live value (${ipo.offerPrice} vs ${live/82000000})`);assert(Math.abs(ipo.proceeds-Math.round(live/82000000*18000000*100)/100)<.01);
 // 5
 await page.evaluate(()=>{const r=__AUDIT__.simulationEngine.advanceTo((Math.floor(__GH_STATE__.simSeconds/86400)+1)*86400+7200,{reason:'qa-559-day',speed:300});if(!r.accepted)throw Error(JSON.stringify(r));});await page.waitForFunction(()=>!__AUDIT__.simulationEngine.snapshot().manualAdvance,null,{timeout:120000});await settled();
 const stocks=await page.evaluate(()=>(__GH_STATE__.market||[]).map(r=>({sym:r.sym,price:r.price,prevClose:r.prevClose,change:r.change})));assert(stocks.length>0&&stocks.every(r=>r.prevClose>0),`5: previous closes (${JSON.stringify(stocks)})`);
 await page.evaluate(()=>__AUDIT__.openDrawer('stocks','portfolio'));await page.waitForSelector('#drawerBody .pv-row');
 const shownMoves=await page.locator('#drawerBody .pv-row .pv-val span').allInnerTexts();for(const [i,row] of stocks.entries()){const move=(row.price/row.prevClose-1)*100;assert.equal(shownMoves[i],`${move>=0?'+':''}${move.toFixed(2)}%`,`5: ${row.sym} shows the day's move`);}
 assert.deepEqual(errors,[]);console.log(JSON.stringify({suite:'build559-share-value-fixes-browser',ok:true,trips,parity:{checked:parity.checked,ms:+parity.ms.toFixed(1)},offerPrice:ipo.offerPrice}));
}finally{await browser.close();await env?.closeOrigin?.();}})().catch(error=>{console.error(error);process.exitCode=1;});
