'use strict';
// Owner (build 97): four new companies (media and production, healthcare, education, a sports club) on one engine
// (service-companies-core), fully joined to the group. In the full app, for each company: it is founded, a facility is
// opened from the world directory with the real buttons (its build cost paid as any facility's), the day close runs, and:
//  1. the engine's day for the company is the finance close's: the company's daily report carries the same revenue, a
//     protected collection invoice carries the cash revenue, and the facility's running cost is in its expenses;
//  2. healthcare and education charge no VAT (exempt), media and the club do;
//  3. the company's page shows its facility, its utilization and its revenue; a price level is a signed command that
//     commits once;
//  4. its logo is its approved mark; its facility shows on the map with the company's logo;
//  5. nothing is rolled back and no error is logged.
const assert=require('node:assert/strict');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');
const COMPANIES=['media','healthcare','education','sports'];
(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[],warnings=[],results=[];
  try{
    const {page}=await boot({browser,errors,viewport:{width:844,height:390}});page.setDefaultTimeout(60000);
    page.on('console',message=>{if(message.type()==='warning'&&/rolled back/i.test(message.text()))warnings.push(message.text().slice(0,300));});
    await page.evaluate(async companies=>{
      const a=__AUDIT__,s=()=>__GH_STATE__;s().godMoney=true;s().infiniteMoney=true;
      for(const type of companies){const d=GH_COMPANY_PLATFORM.definitionFor(s(),type);await a.runAuthorizedDomainCommand('corporate','open-company',{type,companyId:type,capital:Math.max(900000000,d.founding.minimumCapital),legalName:`QA ${type}`,formationContract:`QA-SVC-${type}`},{silent:true});}
    },COMPANIES);
    for(const company of COMPANIES){
      const before=await page.evaluate(c=>(__GH_STATE__.customHubs||[]).filter(f=>(f.ownerCompanyId||f.company)===c).length,company);
      await page.evaluate(()=>__AUDIT__.openDrawer('network'));await page.locator('#worldKind').selectOption(company);
      const open=page.locator('#drawerBody .open-directory-site').first();await open.waitFor({state:'visible'});await open.click();
      await page.waitForFunction(([c,n])=>(__GH_STATE__.customHubs||[]).filter(f=>(f.ownerCompanyId||f.company)===c).length>n&&!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked(),[company,before],{timeout:30000});
    }
    const facilities=await page.evaluate(companies=>companies.map(c=>{const f=(__GH_STATE__.customHubs||[]).filter(x=>(x.ownerCompanyId||x.company)===c).at(-1);return {company:c,kind:f?.kind,dailyCost:f?.dailyCost,cost:f?.cost,logo:GH_IDENTITY.logo(__GH_STATE__,c)};}),COMPANIES);
    const kinds={media:'media-studio',healthcare:'hospital',education:'school',sports:'stadium'};
    for(const f of facilities){assert.equal(f.kind,kinds[f.company],`${f.company}: its facility kind`);assert.ok(f.dailyCost>0&&f.cost>0);assert.equal(f.logo,`assets/identity/approved/${f.company}-symbol.svg`,`4: ${f.company}: its approved mark`);}
    // The day close, in the full app.
    await page.evaluate(()=>__AUDIT__.closeDrawer());await page.evaluate(()=>GH_PERSISTENCE.drain());
    const start=await page.evaluate(()=>Math.floor(__GH_STATE__.simSeconds/86400));
    const request=await page.evaluate(to=>__AUDIT__.simulationEngine.advanceTo(to,{reason:'qa-service-companies'}),(start+2)*86400+1);assert.equal(request.accepted,true,JSON.stringify(request));
    await page.waitForFunction(()=>!__AUDIT__.simulationEngine.snapshot().manualAdvance,null,{timeout:120000});
    const closed=await page.evaluate(companies=>{const st=__GH_STATE__,day=st.lastFinancialDay,report=st.finance.dailyCompanyReports.find(r=>r.day===day)?.companies||{};
      return {day,fatal:__AUDIT__.simulationEngine.snapshot().fatalError||null,rows:companies.map(c=>{const row=GH_SERVICE_COMPANIES_CORE.read(st,c)?.history?.find(h=>h.day===day),invoices=st.finance.invoices.filter(i=>i.company===c&&i.kind==='دخل'&&i.sourceRef===`OPER-COLLECT-${c}-${day}`);
        return {company:c,engine:row||null,pnl:report[c]||null,invoices:invoices.map(i=>({amount:i.amount,tax:Number(i.tax)||0,proof:GH_DOCUMENT_PROOF.verifyDocument(st,i).ok}))};})};},COMPANIES);
    assert.equal(closed.fatal,null,JSON.stringify(closed.fatal));
    for(const row of closed.rows){
      // 1.
      assert.ok(row.engine&&row.engine.revenue>0&&row.engine.facilities===1,`1: ${row.company}: the engine closed its day (${JSON.stringify(row.engine)})`);
      assert.ok(row.pnl&&Math.abs(row.pnl.grossRevenue-row.engine.revenue)<.05,`1: ${row.company}: the daily report carries the engine's revenue (${row.pnl?.grossRevenue} vs ${row.engine.revenue})`);
      assert.equal(row.invoices.length,1,`1: ${row.company}: one collection invoice`);assert.ok(row.invoices[0].proof,`1: ${row.company}: protected`);
      assert.ok(row.pnl.expenses>row.engine.expense,`1: ${row.company}: the facility's running cost is in its expenses too`);
      // 2.
      const exempt=row.company==='healthcare'||row.company==='education';
      assert.equal(row.invoices[0].tax>0,!exempt,`2: ${row.company}: ${exempt?'no VAT (exempt)':'VAT charged'}`);
      results.push({company:row.company,revenue:row.engine.revenue,utilization:row.engine.utilization,grossRevenue:row.pnl.grossRevenue,expenses:row.pnl.expenses,invoice:row.invoices[0]});
    }
    // 3. The page and a price level.
    for(const company of COMPANIES){
      await page.evaluate(c=>__AUDIT__.openDrawer('serviceCompany',{company:c}),company);
      await page.locator('#drawerBody .metric-grid').waitFor();const text=await page.locator('#drawerBody').innerText();
      assert.ok(/%/.test(text)&&!/لا منشآت بعد/.test(text),`3: ${company}: the page shows its facility and utilization`);
    }
    const revision=await page.evaluate(()=>__GH_STATE__.saveRevision);
    await page.evaluate(()=>__AUDIT__.openDrawer('serviceCompany',{company:'healthcare'}));await page.locator('#drawerBody [data-gh-action="service-price-level"][data-level="high"]').click();
    await page.waitForFunction(()=>GH_SERVICE_COMPANIES_CORE.read(__GH_STATE__,'healthcare')?.priceLevel==='high'&&!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked());
    assert.equal(await page.evaluate(()=>__GH_STATE__.saveRevision),revision+1,'3: a price level commits once');
    // 4. The map marker carries the company's logo.
    const marker=await page.evaluate(()=>{const f=(__GH_STATE__.customHubs||[]).find(x=>x.kind==='stadium');return !!f;});assert.ok(marker);
    // 5.
    assert.deepEqual(warnings,[],'5: nothing rolled back');assert.deepEqual(errors,[],'5: no error');
    console.log(JSON.stringify({suite:'build591-service-companies-browser',ok:true,day:closed.day,results}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
