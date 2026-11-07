'use strict';
// Build 374 (owner's decision): the asset-less companies are run by choices, in the real app through the signed
// commands. Bank: a risk-appetite preset sets the five limits; a defaulted loan is restructured or written off (the
// collateral recovers 1 - LGD in cash, the provisions absorb the loss and any excess is the next close's credit-loss
// expense); the automatic treasury, once on, invests the surplus. Insurance: a large risk accepted as a 50% share, one
// price level for every line, and the claims reserve earning the market rate. Real estate: construction financed once
// through Finance Core's debt, and a walk-in lease building sold to a property fund, recognised at the next close.
// Energy: automatic maintenance books the most worn plant. No page of these companies has a typed field.
const assert=require('node:assert/strict');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');
const DAY=86400;

(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    const {page}=await boot({browser,errors});page.setDefaultTimeout(60000);
    page.on('dialog',dialog=>dialog.accept());
    await page.evaluate(async()=>{const s=__GH_STATE__;s.godMoney=true;s.infiniteMoney=true;
      for(const type of ['bank','insurance','realestate','power'])await __AUDIT__.runAuthorizedDomainCommand('corporate','open-company',{type,companyId:type,capital:2000000000,legalName:`QA ${type}`,formationContract:`QA-374-OPT-${type}`},{silent:true});});
    const run=(domain,name,payload)=>page.evaluate(async([domain,name,payload])=>{try{const wrapped=await __AUDIT__.runAuthorizedDomainCommand(domain,name,payload,{silent:true});return wrapped?.ok?{ok:true,result:wrapped.result}:{ok:false,error:String(wrapped?.error||wrapped?.reason||'rejected')};}catch(error){return {ok:false,error:String(error?.message||error)};}},[domain,name,payload]);
    const advance=async days=>{await page.evaluate(()=>__AUDIT__.closeDrawer());await page.click('#simCalendarToggle');for(let i=0;i<days;i++){const before=await page.evaluate(()=>__GH_STATE__.simSeconds);await page.click('#simNextDay');await page.waitForFunction(b=>(__GH_STATE__.simSeconds>=b+86400&&!GH_SIM_KERNEL.snapshot().manualAdvance)||Boolean(GH_SIM_KERNEL.snapshot().lastError),before);}await page.click('#simCalendarToggle');assert.equal(await page.evaluate(()=>GH_SIM_KERNEL.snapshot().lastError||null),null);};

    // Bank: the risk preset, the two defaulted-loan decisions and the automatic treasury.
    let r=await run('banking','set-risk-preset',{preset:'cautious'});assert.equal(r.ok,true,r.error);
    assert.deepEqual(await page.evaluate(()=>{const p=__GH_STATE__.bank.riskPolicy;return [p.maxLdr,p.minLcr,p.minNsfr,p.minCet1,p.sectorConcentration,GH_BANKING_CORE.riskPreset(p)];}),[80,130,115,13,20,'cautious']);
    assert.equal((await run('banking','set-risk-preset',{preset:'reckless'})).ok,false);
    const bankBefore=await page.evaluate(()=>{const s=__GH_STATE__,b=s.bank,F=GH_FINANCE_CORE;b.loans=Number(b.loans||0)+30000000;b.provisions=1000000;
      for(const [id,stage] of [['QA-NPL-1',3],['QA-NPL-2',3]])b.loanPortfolios.push({id,name:id,region:'QA',product:'corporate',principal:15000000,outstanding:15000000,rate:.07,termDays:1825,remainingDays:900,pd:.18,lgd:.35,riskGrade:'B',stage,status:'متعثرة',daysPastDue:90});
      return {cash:F.book(s,'bank').accounts[0].balance,loans:b.loans};});
    r=await run('banking','resolve-npl',{loanId:'QA-NPL-1',action:'restructure'});assert.equal(r.ok,true,r.error);
    assert.deepEqual(await page.evaluate(()=>{const l=__GH_STATE__.bank.loanPortfolios.find(x=>x.id==='QA-NPL-1');return [l.stage,l.status,l.restructured,l.rate];}),[2,'مراقبة',true,.08]);
    r=await run('banking','resolve-npl',{loanId:'QA-NPL-2',action:'write-off'});assert.equal(r.ok,true,r.error);
    assert.equal(r.result.recovery,9750000);assert.equal(r.result.loss,5250000);assert.equal(r.result.shortfall,4250000);
    const afterWriteOff=await page.evaluate(()=>{const s=__GH_STATE__,b=s.bank;return {cash:GH_FINANCE_CORE.book(s,'bank').accounts[0].balance,loans:b.loans,provisions:b.provisions,pending:b.pendingWriteOffLoss,status:b.loanPortfolios.find(x=>x.id==='QA-NPL-2').status};});
    assert.equal(afterWriteOff.cash-bankBefore.cash,9750000,'the collateral recovers 65% in cash');assert.equal(bankBefore.loans-afterWriteOff.loans,15000000);
    assert.equal(afterWriteOff.provisions,0);assert.equal(afterWriteOff.pending,4250000);assert.equal(afterWriteOff.status,'مشطوبة');
    assert.equal((await run('banking','resolve-npl',{loanId:'QA-NPL-2',action:'write-off'})).ok,false,'a loan is written off once');
    r=await run('banking','set-auto-liquidity',{enabled:true});assert.equal(r.ok,true,r.error);

    // Insurance: a 50% share of a large risk, one level for every line, and the reserve's yield.
    await page.evaluate(()=>{const s=__GH_STATE__,day=Math.floor(s.simSeconds/86400);GH_INSURANCE_CORE.ensure(s);s.insurance.riskRequests=[{id:'RISK-QA-1',day,expiresDay:day+7,subject:'QA refinery',officeId:'QA',grade:'A',sumInsured:200000000,premium:1600000,expectedLoss:900000,status:'بانتظار القرار'}];s.insurance.claimsReserve=[{id:'INS-RES-QA',day,payDay:day+30,amount:50000000}];});
    r=await run('insurance','decide-risk',{id:'RISK-QA-1',decision:'accept',share:.5});assert.equal(r.ok,true,r.error);assert.equal(r.result.premium,800000);
    assert.equal(await page.evaluate(()=>__GH_STATE__.insurance.largeRisks.find(x=>x.id==='RISK-QA-1').premium),800000,'the group carries half the premium');
    assert.equal((await run('insurance','decide-risk',{id:'RISK-QA-1',decision:'accept',share:.3})).ok,false);
    r=await run('insurance','set-pricing-all',{level:.9});assert.equal(r.ok,true,r.error);
    assert.deepEqual(await page.evaluate(()=>Object.values(__GH_STATE__.insurance.pricing)),[.9,.9,.9,.9]);

    // Real estate: construction finance through Finance Core's debt, and a sale to a property fund.
    await page.evaluate(()=>{const s=__GH_STATE__,day=Math.floor(s.simSeconds/86400);GH_REALESTATE_CORE.ensure(s);
      s.realEstate.projects.push({id:'RE-QA-BUILD',officeId:'QA',city:'QA',country:'السعودية',type:'residential',name:'QA Towers',mode:'sale',units:200,unitCost:212400,landCost:6480000,buildCost:36000000,priceLevel:1,startDay:day,completeDay:day+540,status:'قيد الإنشاء',milestonesPaid:1,sold:0,presold:0,leased:0,handedOver:0,salesRevenue:0,rentRevenue:0,cheques:[]});
      s.realEstate.projects.push({id:'RE-QA-LEASE',officeId:'QA',city:'QA',country:'السعودية',type:'office',name:'QA Offices',mode:'lease',units:80,unitCost:1416000,landCost:17280000,buildCost:96000000,priceLevel:1,startDay:0,completeDay:day,status:'مكتمل',milestonesPaid:3,sold:0,presold:0,leased:50,handedOver:0,salesRevenue:0,rentRevenue:0,cheques:[],leases:[]});});
    r=await run('realestate','finance-construction',{projectId:'RE-QA-BUILD',share:.4});assert.equal(r.ok,true,r.error);assert.equal(r.result.amount,16992000);
    assert.equal(await page.evaluate(()=>(__GH_STATE__.finance.debtRecords||[]).filter(x=>x.id==='RE-CONSTR-RE-QA-BUILD'&&x.company==='realestate').length),1,'one construction debt in Finance Core');
    assert.equal((await run('realestate','finance-construction',{projectId:'RE-QA-BUILD',share:.6})).ok,false,'financed once');
    const fundPrice=await page.evaluate(()=>GH_REALESTATE_CORE.fundValue(__GH_STATE__.realEstate.projects.find(x=>x.id==='RE-QA-LEASE')));assert.equal(fundPrice,Math.round(50*140000/.07+30*1416000));
    r=await run('realestate','sell-to-fund',{projectId:'RE-QA-LEASE'});assert.equal(r.ok,true,r.error);assert.equal(r.result.price,fundPrice);
    assert.equal(await page.evaluate(()=>__GH_STATE__.realEstate.projects.some(x=>x.id==='RE-QA-LEASE')),false,'the building leaves the portfolio');

    // Energy: automatic maintenance books the most worn operating plant.
    await page.evaluate(()=>{const s=__GH_STATE__;GH_ENERGY_CORE.ensure(s);s.energy.sites.push({id:'SITE-QA-1',facilityId:null,name:'QA Solar',city:'QA',country:'السعودية',kind:'solar',capacity:200,commissioned:true,status:'تشغيل تجاري',commissionedDay:-3650,recoveredWearDays:0,availability:100,forcedOutageRate:.012,degradationRate:.006,gridExportLimitMW:200,gridLossRate:.02,dispatchMode:'must-run',reserveMargin:0,capex:0,debtOutstanding:0});});
    r=await run('energy','set-auto-maintenance',{enabled:true});assert.equal(r.ok,true,r.error);

    await advance(1);
    const day1=await page.evaluate(()=>{const s=__GH_STATE__,bank=s.bank.dailyHistory[0],ins=s.insurance.dailyHistory[0],re=s.realEstate.dailyHistory[0],plan=s.energy.maintenancePlans.find(x=>x.siteId==='SITE-QA-1');return {creditLoss:bank.creditLossExpense,pending:s.bank.pendingWriteOffLoss,autoTreasury:bank.autoTreasury,investmentIncome:ins.investmentIncome,insRevenue:ins.revenue,insPremium:ins.premium,insCeding:ins.cedingCommission,fundSales:re.fundSales,reSales:re.sales,plan:plan?[plan.status,plan.startDay-Math.floor(s.simSeconds/86400)]:null,valid:GH_SAVE_SCHEMA.validate(s).ok};});
    assert.ok(day1.creditLoss>=4250000,'the write-off beyond the provisions is the close\'s credit-loss expense');assert.equal(day1.pending,0);
    assert.ok(day1.autoTreasury&&day1.autoTreasury.invested>=1000000,'the automatic treasury invested the surplus');
    assert.ok(day1.investmentIncome>5000,'the claims reserve earns the market rate');assert.ok(Math.abs(day1.insRevenue-(day1.insPremium+day1.insCeding+day1.investmentIncome))<1e-6);
    assert.deepEqual(day1.fundSales.map(x=>x.projectId),['RE-QA-LEASE']);assert.ok(day1.reSales>=fundPrice,'the fund sale is the close\'s sales');
    assert.deepEqual(day1.plan,['مجدولة',7],'booked a week ahead of the close');
    assert.equal(day1.valid,true);

    // No typed field on these companies' pages.
    const pages=[['bank',{tab:'overview'}],['bank',{tab:'credit'}],['bank',{tab:'control'}],['insurance',{tab:'lines'}],['insurance',{tab:'overview'}],['realestate',{tab:'projects'}],['energy',{tab:'operations'}],['energy',{tab:'control'}]];
    for(const [panel,arg] of pages){await page.evaluate(([p,a])=>__AUDIT__.openDrawer(p,a),[panel,arg]);const typed=await page.evaluate(()=>[...document.querySelectorAll('#drawerBody input,#drawerBody textarea')].filter(x=>!['checkbox','file','radio'].includes(x.type)).map(x=>x.id||x.name||x.type));assert.deepEqual(typed,[],`${panel} ${arg.tab}: no typed field`);}
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({suite:'build374-company-options-browser',writeOff:{recovery:9750000,shortfall:4250000},autoTreasury:day1.autoTreasury.invested,investmentIncome:Math.round(day1.investmentIncome),fundPrice,pages:pages.length}));
    console.log('BUILD374_COMPANY_OPTIONS_BROWSER_PASS');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
