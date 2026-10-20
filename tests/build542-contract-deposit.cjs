'use strict';
// A signed customer contract took a 10% deposit and then collected its whole value again day by day: over the term the
// client paid 110%. In the full app (its own daily close), with two catalogue contracts of the airline, K3 signed with a
// 10% deposit and K7 without one:
//  1. the signed contract keeps its deposit on its document; a contract signed before that (no amount on its document)
//     reads it from the deposit transfer its official record links;
//  2. each day the contract with a deposit collects its daily revenue less the deposit's share, so the deposit and the
//     term's collections add up to its value; the one without a deposit collects its daily revenue;
//  3. the revenue the daily close records is each contract's value over its term (unchanged);
//  4. the previous source (run from its own tree) collected the daily revenue on top of the deposit.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'),PREVIOUS='c6ee2f0',DAYS=3;
// The close collects each catalogue contract as 'إيراد عقد يومي · <catalogue name>'.
const K3={id:'K3',name:'شحن جوي إلكترونيات عالي الأولوية',value:66000000,termMonths:18,deposit:6600000},K7={id:'K7',name:'جسر شحن دوائي عالمي GDP',value:310000000,termMonths:48,deposit:0};

async function scenario(engine){
  const {boot}=require('./helpers/local-dom-app');
  const browser=await engine.launch({headless:true}),errors=[];
  try{
    const {page}=await boot({browser,errors});page.setDefaultTimeout(300000);
    await page.evaluate(async contracts=>{
      const a=__AUDIT__,s=()=>__GH_STATE__,d=GH_COMPANY_PLATFORM.definitionFor(s(),'air');
      await a.runAuthorizedDomainCommand('corporate','open-company',{type:'air',companyId:'air',capital:Math.max(400000000,d.founding.minimumCapital),legalName:'QA Deposit air',formationContract:'QA-DEPOSIT-air'},{silent:true});
      for(const c of contracts){
        await a.runAuthorizedDomainCommand('contracts','bid',{id:c.id,won:true,number:`GH-CN-QA-${c.id}`,client:'QA Client',sector:'air',title:`QA ${c.id}`,value:c.value,termMonths:c.termMonths},{silent:true});
        await a.runAuthorizedDomainCommand('contracts','sign',{id:c.id,company:'air',companyId:'air',ownerCompanyId:'air',sector:'air',deposit:c.deposit,name:`QA ${c.id}`,client:'QA Client',value:c.value,termMonths:c.termMonths,taxable:true},{silent:true});}
    },[K3,K7]);
    const signed=await page.evaluate(()=>{const s=__GH_STATE__,legacy=JSON.parse(JSON.stringify(s));delete legacy.contractRegistry.K3.depositAmount;
      return {kept:s.contractRegistry.K3.depositAmount??null,read:GH_CONTRACTS_CORE.depositFor?.(s,'K3')??null,legacy:GH_CONTRACTS_CORE.depositFor?.(legacy,'K3')??null,none:GH_CONTRACTS_CORE.depositFor?.(s,'K7')??null};});
    const target=await page.evaluate(n=>(Math.floor(__GH_STATE__.simSeconds/86400)+n)*86400,DAYS);
    await page.evaluate(t=>__AUDIT__.simulationEngine.advanceTo(t,{reason:'qa-deposit'}),target);
    await page.waitForFunction(t=>__GH_STATE__.simSeconds>=t&&!__AUDIT__.simulationEngine.snapshot().manualAdvance,target);
    const out=await page.evaluate(([k3,k7])=>{const f=__GH_STATE__.finance,daily=c=>f.invoices.filter(row=>row.company==='air'&&row.kind==='دخل'&&row.note===`إيراد عقد يومي · ${c.name}`).map(row=>row.amount);
      return {K3:daily(k3),K7:daily(k7),deposit:f.transfers.filter(row=>(row.sourceRefs||[]).includes('K3')).reduce((n,row)=>n+row.amount,0),revenue:(f.dailyCompanyReports||[]).map(row=>row.companies?.air?.grossRevenue||0)};},[K3,K7]);
    assert.deepEqual(errors,[]);return {signed,...out};
  }finally{await browser.close();}
}
if(process.env.GH_B542_CHILD){(async()=>{const {chromium}=require('playwright');console.log(JSON.stringify(await scenario(chromium)));})().catch(e=>{console.error(e);process.exit(1);});return;}
(async()=>{
  const {chromium,webkit}=require('playwright'),results=[],close=(a,b,tol=.01)=>Math.abs(a-b)<=tol,term=c=>c.termMonths*30,perDay=c=>c.value/term(c);
  for(const engine of process.env.GH_REQUEST_ENGINE==='chromium'?[chromium]:[chromium,webkit]){
    const r=await scenario(engine);
    assert.equal(r.signed.kept,K3.deposit,'1: the contract keeps its deposit');assert.equal(r.signed.read,K3.deposit);assert.equal(r.signed.none,0);
    assert.equal(r.signed.legacy,K3.deposit,'1: a contract without the amount on its document reads its linked deposit transfer');
    assert.equal(r.deposit,K3.deposit,'the deposit was collected at signing');
    assert.equal(r.K3.length,DAYS,`each day collected (${JSON.stringify(r.K3)})`);
    assert(r.K3.every(v=>close(v,(K3.value-K3.deposit)/term(K3))),`2: each day collects the daily revenue less the deposit's share (${JSON.stringify(r.K3)})`);
    assert(close(K3.deposit+term(K3)*r.K3[0],K3.value,1),'2: the deposit and the term\'s collections add up to the value');
    assert(r.K7.length===DAYS&&r.K7.every(v=>close(v,perDay(K7))),`2: a contract without a deposit collects its daily revenue (${JSON.stringify(r.K7)})`);
    assert(r.revenue.slice(0,DAYS).every(v=>close(v,perDay(K3)+perDay(K7))),`3: the close records each contract's value over its term (${JSON.stringify(r.revenue)})`);
    results.push({engine:engine.name(),K3:r.K3[0],K7:r.K7[0],revenue:r.revenue[0]});
  }
  const tree=fs.mkdtempSync(path.join(os.tmpdir(),'b542-'));
  try{execFileSync('sh',['-c',`git -C "${ROOT}" archive ${PREVIOUS} WebApp tests/helpers | tar -x -C "${tree}"`]);
    const before=JSON.parse(execFileSync(process.execPath,[__filename],{env:{...process.env,GH_B542_CHILD:'1',GH_AUDIT_ROOT:tree},encoding:'utf8',maxBuffer:16*1024*1024}).trim().split('\n').at(-1));
    assert(before.K3.length>0&&before.K3.every(v=>close(v,perDay(K3))),`4: the previous source collected the whole daily revenue (${JSON.stringify(before.K3)}) on top of the deposit (${before.deposit})`);
    console.log(JSON.stringify({suite:'build542-contract-deposit',ok:true,results,previous:{K3:before.K3[0],deposit:before.deposit}}));
  }finally{fs.rmSync(tree,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exit(1);});
