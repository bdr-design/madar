'use strict';
// Owner («نفذ الباقي»; a company's daily cash settlement amended its trip invoices and sealed its transfer in one task,
// 20-26 ms at 2x CPU throttle in a 300k-asset world): the settlement is a staged command (GH_FINANCE_CORE.executeStages
// through the domain owner's dispatchSystemStages), a step for each invoice it links. In the real app, an air company
// with 40 aircraft on routes, two calendar days, against the source before (93d77d4, from its own tree):
//  1. the same invoices, transfers, current accounts, ledger and journal, the same document proofs (every content digest)
//     and the same command records, in the same order;
//  2. each settlement links its invoices in stages of their own: one stage for each trip invoice of the day (none before).
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');
const ROOT=path.resolve(__dirname,'..'),PREVIOUS='93d77d4',QTY=40;
// Every stage the day close yields, read from its own iterator (next, throw and return pass through).
const HOOKS=`{b630:(()=>{const names=window.__B630_STAGES__=[],record=it=>({next(v){const r=it.next(v);if(!r.done)names.push(String(r.value));return r;},throw(e){return it.throw(e);},return(v){return it.return(v);},[Symbol.iterator](){return this;}});
  const original=financialDayStages;financialDayStages=function(...args){return record(original.apply(this,args));};return true;})()}`;
async function run(root){
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    const {page}=await boot({browser,errors,root,appAudit:HOOKS});
    await page.evaluate(async qty=>{
      const a=__AUDIT__,s=()=>__GH_STATE__,type='air',definition=GH_COMPANY_PLATFORM.definitionFor(s(),type);
      await a.runAuthorizedDomainCommand('corporate','open-company',{type,companyId:type,capital:Math.max(400000000,definition.founding.minimumCapital),legalName:'QA Trip Days',formationContract:'QA-TRIP-DAYS'},{silent:true});
      const airport=GH_WORLD_DATA.airports.find(r=>r[0]==='OMDB');
      const facility={id:'QA-air-OMDB',name:'QA Airport OMDB',kind:'airport-base',company:type,ownerCompanyId:type,owned:true,sourceKey:'air:OMDB',code:airport[1]||airport[0],icao:airport[0],iata:airport[1],city:airport[3]||airport[4]||'—',country:String(airport[5]||'—'),coords:[airport[6],airport[7]]};
      await a.runAuthorizedDomainCommand('facilities','create',{facility,bucket:'globalBases'},{silent:true});
      const model=[...GH_ASSET_CATALOG[type].used].sort((x,y)=>(x.leaseMonthly||0)-(y.leaseMonthly||0)||x.price-y.price)[0];
      if(!await a.buyAsset(type,'used',model.id,'lease',qty,facility.id,true,'QA-TRIP-DAYS-'+qty,type))throw new Error('purchase rejected');
      a.openDrawer('routes',type);
    },QTY);
    const dispatch=page.locator('.dispatch-international-network[data-company="air"]').first();
    await dispatch.waitFor({state:'visible',timeout:30000});await dispatch.click();
    await page.waitForFunction(qty=>{const owned=GH_FLEET_DATA.filter(__GH_STATE__,x=>(x.ownerCompanyId||x.companyId)==='air');return owned.length===qty&&owned.every(x=>x.routeId);},QTY,{timeout:120000});
    await page.waitForFunction(()=>!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked(),null,{timeout:180000});await page.evaluate(()=>GH_PERSISTENCE.drain());
    await page.evaluate(()=>__AUDIT__.closeDrawer());
    const stages=await page.evaluate(async()=>{
      const names=window.__B630_STAGES__;names.length=0;
      try{const e=__AUDIT__.simulationEngine,target=(Math.floor(__GH_STATE__.simSeconds/86400)+2)*86400+3600;e.advanceTo(target,{reason:'b630'});const until=performance.now()+600000;while(e.snapshot().manualAdvance&&performance.now()<until)await new Promise(r=>setTimeout(r,20));}
      finally{}
      return names.slice();
    });
    await page.waitForFunction(()=>!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked(),null,{timeout:180000});
    const finance=await page.evaluate(()=>{const s=__GH_STATE__,pick=row=>JSON.parse(JSON.stringify(row));return JSON.stringify({day:s.lastFinancialDay,invoices:pick(s.finance.invoices),transfers:pick(s.finance.transfers||[]),daily:pick(s.finance.dailySettlementDays||{}),pending:pick(s.finance.pendingDailyCash||{}),books:Object.fromEntries(Object.entries(s.companyFinance||{}).map(([k,b])=>[k,{accounts:b.accounts,ledger:b.ledger,journal:b.journal}])),treasury:pick(s.treasury?.ledger||[]),proofs:Object.values(s.documentProofs?.recordsById||{}).map(r=>[r.id,r.contentDigest]),commands:pick(s.domainRuntime?.commands||s.domainRuntime?.records||[])});});
    assert.deepEqual(errors,[]);
    return {finance,stages};
  }finally{await browser.close();}
}
(async()=>{
  const tree=fs.mkdtempSync(path.join(os.tmpdir(),'b630-'));let before;
  try{execFileSync('sh',['-c',`git -C "${ROOT}" archive ${PREVIOUS} | tar -x -C "${tree}"`]);require(path.join(ROOT,'tests/helpers/brand-baseline.cjs')).brandBaseline(tree,ROOT);before=await run(tree);}finally{fs.rmSync(tree,{recursive:true,force:true});}
  const now=await run(process.env.GH_TEST_SOURCE_DIR||ROOT);
  // 1.
  const parsed=JSON.parse(now.finance);assert.ok(parsed.day>=2&&parsed.invoices.some(row=>/تسوية رحلات يومية/.test(String(row.note||row.description||JSON.stringify(row)))),'1: two days closed with trip invoices');
  assert.ok(Array.isArray(parsed.commands)&&parsed.commands.length>0,'1: command records read');
  assert.equal(now.finance,before.finance,'1: the same invoices, transfers, accounts, ledger, journal, document proofs and command records');
  // 2.
  const linked=now.stages.filter(name=>name==='finance-day.trip-settlement-invoice').length,invoices=now.stages.filter(name=>name==='finance-day.trip-invoice').length;
  assert.ok(linked>=2,`2: the settlements link their invoices in stages (${linked})`);assert.equal(linked,invoices,'2: one stage for each trip invoice of the day');
  assert.equal(before.stages.filter(name=>name==='finance-day.trip-settlement-invoice').length,0,'2: (none before)');
  console.log(JSON.stringify({suite:'build630-settlement-stages-browser',ok:true,day:parsed.day,invoices:parsed.invoices.length,linkedStages:linked}));
})().catch(error=>{console.error(error);process.exitCode=1;});
