(()=>{
  'use strict';
  const VERSION='3.0.2';
  const num=value=>Math.max(0,Number(value)||0),now=state=>Number(state.simSeconds)||0;
  const fleetData=()=>{const api=globalThis.GH_FLEET_DATA||(typeof require==='function'?require('./fleet-access-core.js'):null);if(!api)throw new Error('fleet-data-access-unavailable');return api;};
  const PRODUCTS=Object.freeze({
    // Build 375 (owner's decision): an individual loan starts at $10,000 so one car can be financed at its price; its
    // origination fee floor is $250 (0.6% above it). Generated requests and their risk grade keep the $1M scale (requestBase).
    consumer:{name:'قروض أفراد',rate:.082,termDays:1095,provision:.018,rsf:.85,minimum:10000,requestBase:1000000,feeMinimum:250,riskWeight:.75},
    mortgage:{name:'تمويل سكني',rate:.057,termDays:3650,provision:.009,rsf:.82,minimum:5000000,riskWeight:.50},
    sme:{name:'تمويل منشآت صغيرة ومتوسطة',rate:.071,termDays:1825,provision:.016,rsf:.88,minimum:5000000,riskWeight:.85},
    corporate:{name:'تمويل شركات',rate:.064,termDays:2555,provision:.012,rsf:.90,minimum:10000000,riskWeight:.72},
    project:{name:'تمويل مشاريع وبنية تحتية',rate:.068,termDays:3650,provision:.014,rsf:.92,minimum:10000000,riskWeight:.90},
    green:{name:'تمويل أخضر',rate:.052,termDays:2920,provision:.008,rsf:.86,minimum:5000000,riskWeight:.60}
  });
  const DEPOSIT_PRODUCTS=Object.freeze({
    sight:{name:'حسابات جارية',runoff:.10,asf:.90},
    savings:{name:'حسابات ادخار',runoff:.05,asf:.92},
    term:{name:'ودائع لأجل',runoff:.03,asf:.95}
  });
  const RISK_GRADES=Object.freeze({
    AAA:{pd:.001,lgd:.20},AA:{pd:.002,lgd:.24},A:{pd:.004,lgd:.28},BBB:{pd:.012,lgd:.35},BB:{pd:.035,lgd:.42},B:{pd:.08,lgd:.52},C:{pd:.18,lgd:.65}
  });
  const ASF_WHOLESALE=.50,MIN_LEVERAGE_RATIO=3,RESERVE_REQUIREMENT=.05,DEPOSIT_INSURANCE_PREMIUM=.001;
  const BRANCH_SERVICE_OPEX=4300,RESERVE_YIELD_SHARE=.35;
  const ALL_BRANCH_SERVICES=Object.freeze(['حسابات وودائع','تحويلات ومدفوعات','بطاقات','تمويل أفراد','تمويل شركات','تمويل مشاريع','تجارة دولية','إدارة نقد الشركات','صرف العملات','قبول التجار ونقاط البيع']);
  const clone=value=>globalThis.structuredClone?structuredClone(value):JSON.parse(JSON.stringify(value));
  const portfolioLookup=new WeakMap();
  const contractLookup=new WeakMap();
  const contractPositionLookup=new WeakMap();
  function portfolioFor(bank,id){let map=portfolioLookup.get(bank);if(!map){map=new Map(bank.loanPortfolios.map(row=>[String(row.id),row]));portfolioLookup.set(bank,map);}return map.get(String(id))||null;}
  function cachePortfolio(bank,row){let map=portfolioLookup.get(bank);if(!map){map=new Map(bank.loanPortfolios.map(item=>[String(item.id),item]));portfolioLookup.set(bank,map);}map.set(String(row.id),row);}
  function contractFor(bank,id){let map=contractLookup.get(bank);if(!map){map=new Map(bank.customerLoanContracts.map(row=>[String(row.id),row]));contractLookup.set(bank,map);contractPositionLookup.set(bank,new Map(bank.customerLoanContracts.map((row,index)=>[String(row.id),index])));}return map.get(String(id))||null;}
  function cacheContract(bank,row){let map=contractLookup.get(bank);if(!map){map=new Map(bank.customerLoanContracts.map(item=>[String(item.id),item]));contractLookup.set(bank,map);contractPositionLookup.set(bank,new Map(bank.customerLoanContracts.map((item,index)=>[String(item.id),index])));}map.set(String(row.id),row);const positions=contractPositionLookup.get(bank);if(!positions.has(String(row.id))){positions.set(String(row.id),bank.customerLoanContracts.length);bank.customerLoanContracts.push(row);}}
  function archiveCustomerContract(bank,contract){let positions=contractPositionLookup.get(bank),map=contractLookup.get(bank);if(!positions){contractFor(bank,contract.id);positions=contractPositionLookup.get(bank);map=contractLookup.get(bank);}const index=positions.get(String(contract.id));if(index===undefined)return;const last=bank.customerLoanContracts.pop();if(index<bank.customerLoanContracts.length){bank.customerLoanContracts[index]=last;positions.set(String(last.id),index);}positions.delete(String(contract.id));map?.delete(String(contract.id));bank.customerLoanContractArchive.unshift(clone(contract));bank.customerLoanContractArchive=bank.customerLoanContractArchive.slice(0,120);}
  function scheduleCustomerInstallment(bank,contract){const key=String(Math.max(0,Math.floor(Number(contract.nextDueDay)||0))),schedule=bank.customerInstallmentSchedule;const ids=schedule[key]=Array.isArray(schedule[key])?schedule[key]:[];if(!ids.includes(contract.id))ids.push(contract.id);}
  // One-time repair of the clone-only repayment flag in older customer contracts. The portfolio already contains the
  // principal actually returned to cash, so reduce the contract to that evidenced balance; never mint/refund cash or
  // rewrite receipts. Old interest balances and accrual dates are preserved: the aggregate history cannot prove which
  // contract received an old daily cash credit. Flag that history for reconciliation rather than invent a refund/waiver.
  function repairCustomerCredit(bank){
    if(Number(bank.customerCreditSchema)>=3)return;
    const portfolios=new Map(bank.loanPortfolios.map(row=>[String(row.id),row])),summary={schema:3,throughDay:Math.max(0,Math.floor(Number(bank.lastProcessedDay)||0)),linked:0,principalAligned:0,unresolved:0,historicalInterestReview:0};
    portfolioLookup.set(bank,portfolios);contractLookup.delete(bank);contractPositionLookup.delete(bank);
    for(const contract of [...bank.customerLoanContracts,...bank.customerLoanContractArchive]){
      const portfolio=portfolios.get(String(contract.portfolioId));
      if(!portfolio||Math.abs(num(portfolio.principal)-num(contract.originalPrincipal||contract.principal))>.01){summary.unresolved++;continue;}
      const legacy=portfolio.repaymentModel!=='monthly-customer-contract';portfolio.repaymentModel='monthly-customer-contract';portfolio.customerContractId=contract.id;summary.linked++;
      if(!legacy||contract.status==='مسدد')continue;
      const balance=Number(portfolio.outstanding),owed=num(contract.outstanding);
      if(Number.isFinite(balance)&&balance>=0&&balance<owed){const paid=owed-balance;contract.outstanding=balance;contract.principalArrears=Math.min(num(contract.principalArrears),balance);contract.legacyPrincipalPaid=num(contract.legacyPrincipalPaid)+paid;summary.principalAligned+=paid;}
      if(summary.throughDay>num(contract.startDay))summary.historicalInterestReview++;
      if(contract.outstanding<=.01)contract.status='مسدد';
    }
    for(const contract of [...bank.customerLoanContracts])if(contract.status==='مسدد'&&num(contract.outstanding)<=.01)archiveCustomerContract(bank,contract);
    bank.customerCreditRepair=summary;bank.customerCreditSchema=3;
  }
  // Build 400: restore the exact customer identity already recorded on an active loan contract when an older save
  // retained the contract but lost its Business World party row. Reuse the contract's stable party id and stored name;
  // never change the borrower, loan balance, receipt history, or signed finance documents.
  function repairCustomerLoanParties(state,bank){
    if(Number(bank.customerLoanPartySchema)>=1)return;
    const W=globalThis.GH_BUSINESS_WORLD;if(typeof W?.resolveParty!=='function'||typeof W?.upsertParty!=='function')return;
    let repaired=0,unresolved=0;
    for(const contract of bank.customerLoanContracts){
      const id=String(contract?.customerId||'').trim();if(!id||W.resolveParty(state,id))continue;
      const name=String(contract?.customerName||'').trim();if(!name){unresolved++;continue;}
      const party=W.upsertParty(state,{id,name,displayName:name,legalName:name,role:'customer',industry:'عميل مصرفي',country:String(contract?.country||'دولي'),sectors:['bank']});
      if(party?.id===id&&W.resolveParty(state,id)?.id===id)repaired++;else unresolved++;
    }
    bank.customerLoanPartyRepair={schema:1,repaired,unresolved};bank.customerLoanPartySchema=1;
  }
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value)||0));
  const companyPlatform=()=>globalThis.GH_COMPANY_PLATFORM||null;
  function canonicalOwnerCompanyId(row){return String(row?.ownerCompanyId||row?.companyId||'').trim();}
  function facilityOwnerCompanyId(row){return canonicalOwnerCompanyId(row)||String(row?.company||'').trim();}
  function assetOwnerCompanyId(row){
    const explicit=canonicalOwnerCompanyId(row);if(explicit)return explicit;
    const mode=String(row?.assetMode||row?.type||'').trim();
    return String(companyPlatform()?.ownerForLegacyAssetMode?.(mode)||'').trim();
  }
  const REVIEW_FLEET_FALLBACK_LIMIT=2048;
  function reviewCollateralByOwner(ctx,state){
    const proof=ctx?.fleetSummary,core=globalThis.GH_FLEET_UI_SUMMARY,result=proof?.result;
    if(result&&result.schema===core?.SCHEMA&&result.legacy!==true&&typeof proof.current==='function'&&proof.current(state)===true){
      const lookup=proof.lookup||core.lookup(result);return {get:owner=>Number(lookup.owner(owner)?.bankCollateral55)||0,source:'worker'};
    }
    const data=fleetData(),size=Number(data.size?.(state));if(!Number.isFinite(size)||size>REVIEW_FLEET_FALLBACK_LIMIT)throw new Error('bank-fleet-summary-required');
    const totals=new Map();data.forEach(state,asset=>{const owner=assetOwnerCompanyId(asset);if(!owner)return;totals.set(owner,(totals.get(owner)||0)+num(asset.purchasePrice)*.55);});
    return {get:owner=>totals.get(String(owner))||0,source:'bounded-main'};
  }
  function isOperationalFinanceCompany(state,companyId,F){
    companyId=String(companyId||'').trim();if(!companyId)return false;
    const platform=companyPlatform();
    if(platform?.resolveCompany){const company=platform.resolveCompany(state,companyId);return Boolean(company?.operational&&platform.hasCapability(state,companyId,'finance.book'));}
    return companyId==='group'||Boolean((state.openedCompanies||[]).includes(companyId)&&F?.book?.(state,companyId));
  }
  function corporateCompanyIds(state,F){
    const platform=companyPlatform();
    if(platform?.listInstances)return platform.listInstances(state,{openedOnly:true,capability:'finance.book'}).filter(company=>company.operational&&!platform.hasCapability(state,company.id,'operations.bank')).map(company=>company.id);
    return ['group',...(state.openedCompanies||[])].filter((id,index,all)=>id!=='bank'&&all.indexOf(id)===index&&isOperationalFinanceCompany(state,id,F));
  }
  function hash(text){let h=2166136261>>>0;for(const ch of String(text)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}return h>>>0;}
  function deterministic(seed,min,max){return min+(hash(seed)/4294967295)*(max-min);}
  // Rates follow the market base rate (GH_REALISM economy, moved hourly). The bank picks a deposit pricing stance;
  // loans add the product spread and the borrower's expected loss; funding and liquidity are priced by term.
  const DEPOSIT_STANCES=Object.freeze({competitive:.005,market:0,conservative:-.005}),REFERENCE_BASE=.046;
  const FUNDING_TERMS=Object.freeze([365,1095,1825]),LIQUIDITY=Object.freeze({sovereign:{spread:-.002,terms:[90,365,730]},'central-bank':{spread:-.0025,terms:[30]},'covered-bond':{spread:.004,terms:[365,730,1095]}});
  function marketBaseRate(state){const rate=Number(state.realism?.economy?.baseRate??state.advanced?.economy?.baseRate);return Number.isFinite(rate)&&rate>0?rate:REFERENCE_BASE;}
  function depositRates(state,stance){const base=marketBaseRate(state),offset=DEPOSIT_STANCES[stance]??0,r=value=>Number(Math.max(0,value).toFixed(4));return {sight:r(base*.28),savings:r(base*.65+offset),term:r(base*.90+offset)};}
  function pricing(state,bank){return depositRates(state,bank.depositPricing?.stance);}
  function loanRateQuote(state,productId,riskGrade,country=''){
    const product=PRODUCTS[productId]||PRODUCTS.corporate,risk=RISK_GRADES[riskGrade]||RISK_GRADES.BBB,referenceApi=globalThis.GH_MARKET_REFERENCE;
    const selected=referenceApi?.referenceForCountry?.(country),baseRate=selected?.available?selected.rate:marketBaseRate(state),rate=Math.round((baseRate+(product.rate-REFERENCE_BASE)+risk.pd*risk.lgd)*1e5)/1e5;
    const reference=selected?.available?referenceApi.attachableReference(selected):{available:false,fresh:false,reason:selected?.reason||'reference-unavailable',country:String(country||''),rate:null,unit:null,benchmark:null,referenceId:null,referenceDate:null,retrievedAt:null,sourceUrl:null,sourcePage:null,attribution:'سعر مرجعي محاكى من اقتصاد اللعبة؛ لا توجد سلسلة موثقة لهذا البلد.',coverage:'تطبق هوامش المنتج ومخاطر المقترض الداخلية.',fallback:'simulation'};
    return {rate,baseRate,productSpread:product.rate-REFERENCE_BASE,riskPremium:risk.pd*risk.lgd,reference};
  }
  function loanRate(state,productId,riskGrade,country=''){return loanRateQuote(state,productId,riskGrade,country).rate;}
  function liquidityYield(state,kind,termDays){const row=LIQUIDITY[kind];if(!row||!row.terms.includes(termDays))throw new Error('bank-liquidity-term-invalid');return Math.round((marketBaseRate(state)+row.spread+termDays/365*.001)*1e5)/1e5;}
  function wholesaleRate(state,termDays){if(!FUNDING_TERMS.includes(termDays))throw new Error('bank-wholesale-term-invalid');return globalThis.GH_FINANCE_CORE.fixedDebtQuote(state,termDays);}
  function branchTemplate(state,p={}){
    return {id:String(p.branchId||p.id||''),facilityId:p.facilityId||p.branchId||null,capitalId:p.capitalId||null,city:String(p.city||'غير محدد'),country:String(p.country||'غير محدد'),openedAt:Number(p.openedAt)||now(state),servicesActive:p.servicesActive!==false,services:[...ALL_BRANCH_SERVICES],retailCustomers:num(p.retailCustomers),businessCustomers:num(p.businessCustomers),deposits:num(p.deposits),loans:num(p.loans),depositMix:{sight:num(p.depositMix?.sight),savings:num(p.depositMix?.savings),term:num(p.depositMix?.term)},incomeStatement:{interestIncome:num(p.incomeStatement?.interestIncome),feeIncome:num(p.incomeStatement?.feeIncome),feeBreakdown:p.incomeStatement?.feeBreakdown&&typeof p.incomeStatement.feeBreakdown==='object'?{...p.incomeStatement.feeBreakdown}:{},interestExpense:num(p.incomeStatement?.interestExpense),creditLossExpense:num(p.incomeStatement?.creditLossExpense),opex:num(p.incomeStatement?.opex),serviceOpex:num(p.incomeStatement?.serviceOpex??p.incomeStatement?.opex),facilityOpex:num(p.incomeStatement?.facilityOpex),net:Number(p.incomeStatement?.net)||0},serviceModel:'شامل',...(Number(p.marketPopulation)>0?{marketPopulation:Number(p.marketPopulation)}:{}),...(p.today&&typeof p.today==='object'?{today:{...p.today}}:{}),...(Number(p.campaignUntil)>0?{campaignUntil:Math.floor(Number(p.campaignUntil)),campaigns:Math.max(0,Math.floor(Number(p.campaigns)||0)),campaignSpend:num(p.campaignSpend)}:{}),lastProcessedDay:Number.isFinite(Number(p.lastProcessedDay))?Number(p.lastProcessedDay):Math.floor(now(state)/86400)};
  }
  function ensure(state){
    const bank=state.bank=state.bank&&typeof state.bank==='object'?state.bank:{};
    bank.corporateClients=bank.corporateClients&&typeof bank.corporateClients==='object'?bank.corporateClients:{};
    for(const key of ['riskReviews','lettersOfCredit','guarantees','cashSweeps','branchNetwork','loanPortfolios','corporateFacilities','dailyHistory','treasurySecurities','wholesaleFacilities','creditDecisions','delinquencyEvents','recoveries','feeEvents','loanRequests','loanRequestHistory','customerLoanContracts','customerLoanContractArchive','customerInstallmentSettlements','loanApprovalBatches','customerInstallmentBatches','customerDisbursements'])bank[key]=Array.isArray(bank[key])?bank[key].filter(Boolean):[];
    if(!bank.transactionFeeByDay||typeof bank.transactionFeeByDay!=='object'||Array.isArray(bank.transactionFeeByDay)){bank.transactionFeeByDay={};for(const row of bank.feeEvents){const day=String(Math.max(0,Math.floor(Number(row.closeDay??row.day)||0)));bank.transactionFeeByDay[day]=num(bank.transactionFeeByDay[day])+num(row.amount);}}
    for(const type of corporateCompanyIds(state,globalThis.GH_FINANCE_CORE))if(!bank.corporateClients[type])bank.corporateClients[type]={company:type,ownerCompanyId:type,creditLimit:5000000,drawn:0,depositBalance:0,lastReview:0,rating:'BBB'};
    for(const key of ['branches','deposits','loans','npl','capitalRatio','hqla','stableFunding','requiredStableFunding','wholesaleFunding','offBalance','feeIncomeYTD','provisions','retailCustomers','businessCustomers','dailyServiceFeeRevenue','interestIncomeYTD','depositInterestExpenseYTD','creditLossExpenseYTD'])bank[key]=num(bank[key]);
    // Net income is signed: normalizing balances must not erase accumulated losses.
    const signedNet=Number(bank.netBankingIncomeYTD);bank.netBankingIncomeYTD=Number.isFinite(signedNet)?signedNet:0;
    bank.revenueYTD=bank.revenueYTD&&typeof bank.revenueYTD==='object'?bank.revenueYTD:{};for(const key of ['accounts','payments','cards','merchant','cashManagement','fx','tradeFinance','retailFinance','businessFinance','projectFinance','arrangement','treasury'])bank.revenueYTD[key]=num(bank.revenueYTD[key]);
    bank.sequence=Math.max(0,Math.floor(Number(bank.sequence)||0));
    bank.depositPricing={stance:bank.depositPricing?.stance in DEPOSIT_STANCES?bank.depositPricing.stance:'market',lastChangedAt:Number(bank.depositPricing?.lastChangedAt)||0};
    bank.riskPolicy=bank.riskPolicy&&typeof bank.riskPolicy==='object'?bank.riskPolicy:{};
    bank.riskPolicy={maxLdr:clamp(bank.riskPolicy.maxLdr||95,55,120),minLcr:clamp(bank.riskPolicy.minLcr||110,100,200),minNsfr:clamp(bank.riskPolicy.minNsfr||105,100,180),minCet1:clamp(bank.riskPolicy.minCet1||10.5,4.5,30),sectorConcentration:clamp(bank.riskPolicy.sectorConcentration||25,10,60),...bank.riskPolicy};
    bank.alm=bank.alm&&typeof bank.alm==='object'?bank.alm:{};
    bank.alm={maturityLadder:{overnight:0,under30:0,under365:0,over365:0},interestRateGap:0,liquidityGap30d:0,weightedDepositRate:0,...bank.alm};bank.autoLiquidity=bank.autoLiquidity===true;bank.pendingWriteOffLoss=num(bank.pendingWriteOffLoss);
    bank.branchNetwork=bank.branchNetwork.map(row=>branchTemplate(state,row));
    bank.customerInstallmentSchedule=bank.customerInstallmentSchedule&&typeof bank.customerInstallmentSchedule==='object'&&!Array.isArray(bank.customerInstallmentSchedule)?bank.customerInstallmentSchedule:{};
    if((Number(bank.customerCreditSchema)||0)<2){
      // Legacy aggregate portfolios retain their old repayment behavior. New named contracts are indexed once on migration.
      for(const portfolio of bank.loanPortfolios)if(!portfolio.repaymentModel)portfolio.repaymentModel='legacy-daily-principal';
      for(const contract of bank.customerLoanContracts){contract.outstanding=num(contract.outstanding);contract.originalPrincipal=num(contract.originalPrincipal||contract.principal);contract.principalArrears=num(contract.principalArrears);contract.accruedInterest=num(contract.accruedInterest);contract.interestArrears=num(contract.interestArrears);contract.rate=clamp(contract.rate,0,.30);contract.termMonths=Math.max(1,Math.floor(Number(contract.termMonths)||1));contract.installmentNumber=Math.max(0,Math.floor(Number(contract.installmentNumber)||0));contract.nextDueDay=Math.max(0,Math.floor(Number(contract.nextDueDay)||0));contract.lastAccruedDay=Math.max(0,Math.floor(Number(contract.lastAccruedDay)||contract.startDay||0));if(contract.status!=='مسدد')scheduleCustomerInstallment(bank,contract);else archiveCustomerContract(bank,contract);}
      bank.customerCreditSchema=2;
    }
    repairCustomerCredit(bank);
    repairCustomerLoanParties(state,bank);
    for(const facility of bank.corporateFacilities){facility.ownerCompanyId=String(facility.ownerCompanyId||facility.company||'').trim();facility.originalAmount=num(facility.originalAmount||facility.amount);facility.outstanding=num(facility.outstanding);facility.principalArrears=num(facility.principalArrears);facility.interestArrears=num(facility.interestArrears);facility.termDays=Math.max(30,Math.floor(Number(facility.termDays)||365));facility.rate=clamp(facility.rate||.06,0,.30);facility.startDay=Math.max(0,Math.floor(Number(facility.startDay)||0));facility.lastProcessedDay=Math.max(facility.startDay,Math.floor(Number(facility.lastProcessedDay)||facility.startDay));facility.maturityDay=Math.max(facility.startDay+facility.termDays,Math.floor(Number(facility.maturityDay)||0));}
    // Runtime reads never fabricate branches. Legacy reconstruction is isolated
    // in migrateLegacyBranches() and is invoked once during save migration.
    bank.branches=bank.branchNetwork.length;
    return bank;
  }
  function migrateLegacyBranches(state){
    const legacyCount=Math.max(0,Math.floor(Number(state.bank?.branches)||0)),bank=ensure(state);let added=0;
    const facilities=(state.customHubs||[]).filter(row=>row?.owned===true&&facilityOwnerCompanyId(row)==='bank'&&row.kind==='bank'),knownFacilities=new Set(bank.branchNetwork.map(row=>row.facilityId));
    for(const facility of facilities)if(!knownFacilities.has(facility.id)){
      const branch=branchTemplate(state,{branchId:`BR-${++bank.sequence}`,facilityId:facility.id,capitalId:facility.capitalId||null,city:facility.city,country:facility.country,openedAt:facility.openedAt,servicesActive:true,legacyMigrated:true});
      bank.branchNetwork.push(branch);knownFacilities.add(branch.facilityId);added++;
    }
    while(bank.branchNetwork.length<legacyCount){bank.branchNetwork.push(branchTemplate(state,{branchId:`BR-${++bank.sequence}`,city:'فرع محفوظ',country:'سجل قديم',openedAt:0,servicesActive:true,legacyMigrated:true}));added++;}
    bank.branches=bank.branchNetwork.length;return {changed:added>0,added,branches:bank.branches};
  }
  // Branch markets (owner review, Build 358: customers grew 18-65 a day per branch forever, none ever left, a branch in a
  // small state equal to one in Riyadh). A branch now serves a share of its country: 55% of the population banks, the
  // group's bank can win at most 4% of them, split between its branches in that country (500 to 250,000 per branch,
  // one business client per 40 people). Growth slows as a branch fills its market; customers leave at 6% a year (more when
  // deposit pricing is below the market, less above) and take their share of the branch's deposits with them.
  const SMALL_STATES=Object.freeze({'الإمارات':9890000,'سنغافورة':5920000,'عُمان':4580000,'البحرين':1500000,'المالديف':520000,'أيرلندا':5120000,'مالطا':530000,'أندورا':80000,'موناكو':39000,'سان مارينو':34000,'ليختنشتاين':39000,'الكونغو الديمقراطية':102000000,'الكونغو':6000000,'أفريقيا الوسطى':5500000,'الرأس الأخضر':590000,'ساو تومي وبرينسيب':220000,'ملاوي':20400000,'موريشيوس':1260000,'سيشل':100000,'جزر القمر':840000,'الباهاما':410000,'بربادوس':280000,'ساموا':220000,'تونغا':100000,'كيريباس':130000,'ميكرونيسيا':110000,'جزر مارشال':40000,'بالاو':18000,'ناورو':12000,'توفالو':11000});
  const DEFAULT_POPULATION=10000000,BANKED_SHARE=.55,MAX_MARKET_SHARE=.04,BASE_RETAIL_CHURN=.06,BASE_BUSINESS_CHURN=.04,BUSINESS_PER_PEOPLE=40;
  function countryPopulation(country){
    const name=String(country||'').trim();if(SMALL_STATES[name])return SMALL_STATES[name];
    const row=(Array.isArray(globalThis.GH_MAP_LABELS)?globalThis.GH_MAP_LABELS:[]).find(item=>item?.name===name);
    return Number(row?.population)>0?Number(row.population):DEFAULT_POPULATION;
  }
  function branchMarket(bank,branch,peerCount=null){
    // Resolved once and kept on the branch so a save simulates the same everywhere (the labels are a UI data file).
    if(!(Number(branch.marketPopulation)>0))branch.marketPopulation=countryPopulation(branch.country);
    const peers=(peerCount??Math.max(1,bank.branchNetwork.filter(row=>row.servicesActive&&row.country===branch.country).length)),retailCapacity=Math.round(clamp(num(branch.marketPopulation)*BANKED_SHARE*MAX_MARKET_SHARE/peers,500,250000));
    return {population:num(branch.marketPopulation),retailCapacity,businessCapacity:Math.max(50,Math.round(retailCapacity/BUSINESS_PER_PEOPLE))};
  }
  // A branch campaign (a branch decision): for 30 days new customers come 60% faster and 20% fewer leave. It costs
  // three dollars per customer the branch can reach (250,000 to 5,000,000), paid by the bank through Finance Core.
  const CAMPAIGN_DAYS=30,CAMPAIGN_GROWTH=1.6,CAMPAIGN_CHURN=.8;
  function campaignCost(bank,branch,peers=null){return Math.round(clamp(branchMarket(bank,{...branch},peers).retailCapacity*3,250000,5000000));}
  const campaignRows=bank=>globalThis.GH_BRANCH_CAMPAIGN.rows(bank.branchNetwork,row=>row.servicesActive===true,(row,peers)=>campaignCost(bank,row,peers));
  function campaignQuote(state){const bank=ensure(state);return globalThis.GH_BRANCH_CAMPAIGN.quote(state,'bank',campaignRows(bank),CAMPAIGN_DAYS);}
  function branchCampaigns(state,p){const bank=ensure(state);return globalThis.GH_BRANCH_CAMPAIGN.launch(state,'bank',bank,campaignRows(bank),p,CAMPAIGN_DAYS);}
  function branchCampaign(state,p,F){
    const bank=ensure(state),branch=bank.branchNetwork.find(row=>row.id===p.branchId||row.facilityId===p.branchId);if(!branch)throw new Error('bank-branch-not-found');if(!branch.servicesActive)throw new Error('bank-active-branch-required');
    const day=Math.floor(now(state)/86400);if(Number(branch.campaignUntil)>day)throw new Error('bank-campaign-running');
    const cost=campaignCost(bank,branch);if(num(F.operating(state,'bank'))<cost)throw new Error('insufficient-cash');
    // Paid like any outside supplier (energy maintenance does the same): an invoice settled by a cleared cheque.
    const payment=F.execute({state},'pay-by-cheque',{company:'bank',amount:cost,note:`حملة تسويقية · فرع ${branch.city} · ${CAMPAIGN_DAYS} يومًا`,beneficiary:`وكالة تسويق · ${branch.city}`,line:'marketing',requestRef:`BANK-CAMPAIGN-${branch.id}-${day}`});if(!payment?.cheque?.id||payment.cheque.status!=='مصروف')throw new Error('bank-campaign-cheque-not-cleared');
    branch.campaignUntil=day+CAMPAIGN_DAYS;branch.campaigns=Math.max(0,Math.floor(Number(branch.campaigns)||0))+1;branch.campaignSpend=num(branch.campaignSpend)+cost;return {branchId:branch.id,city:branch.city,cost,until:branch.campaignUntil,chequeId:payment.cheque.id};
  }
  const roundDraw=(value,seed)=>Math.floor(Math.max(0,value)+deterministic(seed,0,1));
  // Loan requests (owner review, Build 358: the bank ran itself). Borrowers come to the branches and wait for the player's
  // credit decision: amount, product, sector, grade and collateral are the borrower's; the price is the market's
  // (loanRate). Approving books the loan through originateLoan, so liquidity, loan-to-deposit, capital and sector limits
  // apply as for any loan; rejecting or letting it lapse costs only the business. Load: at most 5 open requests, one new
  // request a day at most, 7 days to decide, 40 decisions kept.
  const MAX_OPEN_REQUESTS=5,REQUEST_DAYS=7,REQUEST_HISTORY=40;
  // A consumer loan's borrower is the retail book; a company loan goes to one of the sector's companies (a consumer loan
  // named after a hotel company read as a retail loan to a company). The draw keeps the same seed.
  const RETAIL_BORROWER='محفظة تمويل الأفراد';
  function requestBorrower(group,productId,draw){const names=group.names.filter(name=>name!==RETAIL_BORROWER);if(productId==='consumer')return RETAIL_BORROWER;const pool=names.length?names:group.names;return pool[Math.floor(draw*pool.length)%pool.length];}
  const REQUEST_SECTORS=Object.freeze([
    {sector:'real-estate',products:['mortgage','project'],names:['شركة الأفق للتطوير العقاري','دار المسكن للاستثمار','مجموعة الواحة السكنية','بيوت الخليج للتطوير']},
    {sector:'industrial',products:['corporate','project'],names:['مصانع النخبة للصناعات المعدنية','شركة الصناعات البلاستيكية المتقدمة','مجمع البناء للأسمنت','شركة الأغذية الوطنية']},
    {sector:'trade',products:['sme','corporate'],names:['مؤسسة السوق المركزي للتجارة','شركة التوريدات المتحدة','بيت التجارة الدولية','متاجر الريادة']},
    {sector:'services',products:['sme','consumer'],names:['محفظة تمويل الأفراد','شركة الخدمات الصحية المتكاملة','مجموعة التعليم الحديث','شركة الضيافة الراقية']},
    {sector:'power',products:['green','project'],names:['مطور الطاقة النظيفة','شركة مشاريع الطاقة الشمسية','تحالف رياح الشمال']},
    {sector:'road',products:['corporate','sme'],names:['شركة النقل السريع','مؤسسة الإمداد اللوجستي']},
    {sector:'air',products:['corporate'],names:['شركة خدمات المطارات','أكاديمية الطيران المدني']},
    {sector:'sea',products:['corporate'],names:['شركة خدمات الموانئ','مقاولو بناء السفن']}
  ]);
  const requestBase=product=>product.requestBase||product.minimum,originationFee=(product,amount)=>Math.max(product?.feeMinimum??25000,Math.round(amount*.006));
  const GRADE_WHEEL=Object.freeze([['AA',.10],['A',.25],['BBB',.35],['BB',.20],['B',.10]]);
  function pickGrade(roll){let acc=0;for(const [grade,weight] of GRADE_WHEEL){acc+=weight;if(roll<acc)return grade;}return 'B';}
  function generateLoanRequest(state,bank,day){
    const branches=bank.branchNetwork.filter(row=>row.servicesActive);if(!branches.length||bank.loanRequests.length>=MAX_OPEN_REQUESTS)return null;
    if(deterministic(`${day}:loan-request`,0,1)>=Math.min(.7,.15+.10*branches.length))return null;
    const seed=`${day}:loan-request`,group=REQUEST_SECTORS[Math.floor(deterministic(`${seed}:sector`,0,REQUEST_SECTORS.length))%REQUEST_SECTORS.length],productId=group.products[Math.floor(deterministic(`${seed}:product`,0,group.products.length))%group.products.length],product=PRODUCTS[productId],branch=branches[Math.floor(deterministic(`${seed}:branch`,0,branches.length))%branches.length];
    const amount=Math.round(requestBase(product)*deterministic(`${seed}:amount`,1,15)/100000)*100000,riskGrade=pickGrade(deterministic(`${seed}:grade`,0,1)),collateralCoverage=Math.round(deterministic(`${seed}:collateral`,0,1.6)*10)/10;
    const request={id:`REQ-${++bank.sequence}`,day,expiresDay:day+REQUEST_DAYS,borrower:requestBorrower(group,productId,deterministic(`${seed}:name`,0,1)),sector:group.sector,product:productId,amount,termDays:product.termDays,riskGrade,collateralCoverage,branchId:branch.id,branchName:`${branch.city} · ${branch.country}`,status:'بانتظار القرار'};
    bank.loanRequests.push(request);return request;
  }
  // What a request would earn and risk if approved today (read-only, for the decision card).
  function loanRequestQuote(state,request){
    const branch=Array.isArray(state.bank?.branchNetwork)?state.bank.branchNetwork.find(row=>row.id===request.branchId):null,product=PRODUCTS[request.product]||PRODUCTS.corporate,risk=RISK_GRADES[request.riskGrade]||RISK_GRADES.BBB,quote=loanRateQuote(state,request.product,request.riskGrade,branch?.country||''),rate=quote.rate,collateral=clamp(request.collateralCoverage||0,0,5),lgd=clamp(risk.lgd*(collateral?Math.max(.35,1-collateral*.22):1),.08,.90);
    return {rate,rateReference:quote.reference,rateComponents:{baseRate:quote.baseRate,productSpread:quote.productSpread,riskPremium:quote.riskPremium},annualInterest:num(request.amount)*rate,expectedLoss:num(request.amount)*risk.pd*lgd,pd:risk.pd,lgd,fee:originationFee(product,num(request.amount)),productName:product.name,termYears:Math.round(num(request.termDays)/365*10)/10};
  }
  function customerFinancingQuote(state,p={}){
    const product=PRODUCTS[String(p.product||'consumer')];if(!product)throw new Error('bank-loan-product-invalid');const invoiceAmount=num(p.invoiceAmount),downPayment=num(p.downPayment);if(invoiceAmount<=0||downPayment>invoiceAmount)throw new Error('bank-customer-finance-invoice-invalid');const net=invoiceAmount-downPayment;let principal=Math.max(product.minimum,net+originationFee(product,net)),fee=0;for(let i=0;i<6;i++){fee=originationFee(product,principal);principal=Math.max(product.minimum,net+fee);}fee=originationFee(product,principal);const disbursementAmount=principal-fee;return {product:String(p.product||'consumer'),termDays:Math.max(30,Math.floor(Number(p.termDays)||product.termDays)),invoiceAmount,downPayment,loanPrincipal:principal,originationFee:fee,disbursementAmount,customerContribution:downPayment};
  }
  function closeLoanRequest(bank,request,status,extra={}){bank.loanRequests=bank.loanRequests.filter(row=>row.id!==request.id);bank.loanRequestHistory.unshift({...request,...extra,status});bank.loanRequestHistory=bank.loanRequestHistory.slice(0,REQUEST_HISTORY);}
  function stableDigest(value){const text=typeof value==='string'?value:JSON.stringify(value);return `fnv1a:${hash(text).toString(16).padStart(8,'0')}`;}
  function batchReplay(rows,batchId,fingerprint){const prior=rows.find(row=>row.batchId===batchId);if(!prior)return null;if(prior.fingerprint!==fingerprint)throw new Error('bank-batch-reference-conflict');return clone(prior.result);}
  function rememberBatch(rows,batchId,fingerprint,result,state){rows.unshift({batchId,fingerprint,result:clone(result),at:now(state)});rows.splice(120);return result;}
  function customerLoanPartyId(request){return String(request.customerId||`BANK-CUST-${stableDigest([request.id,request.branchId,request.borrower]).slice(7)}`);}
  function ensureCustomerLoanParty(state,request){
    const W=globalThis.GH_BUSINESS_WORLD;if(typeof W?.resolveParty!=='function'||typeof W?.upsertParty!=='function')throw new Error('bank-customer-party-not-found');
    const id=customerLoanPartyId(request);let party=W.resolveParty(state,id);if(party)return id;
    const name=String(request.borrower||'').trim();if(!name)throw new Error('bank-customer-party-not-found');
    party=W.upsertParty(state,{id,name,displayName:name,legalName:name,role:'customer',industry:'عميل مصرفي',country:String(request.country||'دولي'),sectors:['bank']});
    if(party?.id!==id||W.resolveParty(state,id)?.id!==id)throw new Error('bank-customer-party-not-found');return id;
  }
  function makeCustomerLoanContract(state,request,portfolio){
    const bank=ensure(state),startDay=Math.floor(now(state)/86400),termMonths=Math.max(1,Math.ceil(portfolio.termDays/30)),customerId=customerLoanPartyId(request),contractId=`CUST-${portfolio.id}`;
    if(bank.customerLoanContracts.some(row=>row.id===contractId))throw new Error('bank-customer-loan-contract-conflict');
    const stored=portfolioFor(bank,portfolio.id);if(!stored)throw new Error('bank-customer-portfolio-missing');
    stored.repaymentModel='monthly-customer-contract';stored.customerContractId=contractId;
    const contract={id:contractId,portfolioId:portfolio.id,customerId,customerName:String(request.borrower||'عميل مصرفي'),customerType:request.product==='corporate'?'business':'individual',sourceCompanyId:request.sourceCompanyId?String(request.sourceCompanyId):null,sourceSaleId:request.sourceSaleId?String(request.sourceSaleId):null,orderId:request.orderId?String(request.orderId):null,invoiceNumber:request.invoiceNumber?String(request.invoiceNumber):null,product:portfolio.product,branchId:portfolio.branchId,sector:portfolio.sector,originalPrincipal:portfolio.principal,outstanding:portfolio.outstanding,principal:portfolio.principal,rate:portfolio.rate,rateReferenceId:portfolio.rateReference?.referenceId||null,rateComponents:portfolio.rateComponents||null,termMonths,monthlyPrincipal:portfolio.principal/termMonths,startDay,firstDueDay:startDay+30,nextDueDay:startDay+30,lastAccruedDay:startDay,installmentNumber:0,principalArrears:0,accruedInterest:0,interestArrears:0,status:'نشط'};
    cacheContract(bank,contract);scheduleCustomerInstallment(bank,contract);return contract;
  }
  function approveLoanRequest(state,request,day,F){
    const customerId=ensureCustomerLoanParty(state,request),customerRequest={...request,customerId};
    const portfolio=originateLoan(state,{product:request.product,amount:request.amount,branchId:request.branchId,sector:request.sector,riskGrade:request.riskGrade,collateralCoverage:request.collateralCoverage,termDays:request.termDays,borrowers:1,...(request.sourceCompanyId?{disbursementRecipient:'customer-sale',disbursementRecipientCompanyId:request.sourceCompanyId}:{})},F);
    portfolio.borrower=request.borrower;const contract=makeCustomerLoanContract(state,customerRequest,portfolio);let disbursementReceipt=null;
    if(request.sourceCompanyId){const bank=ensure(state),company=String(request.sourceCompanyId),F=globalThis.GH_FINANCE_CORE;if(!isOperationalFinanceCompany(state,company,F)||company==='bank')throw new Error('bank-customer-disbursement-recipient-invalid');const amount=num(portfolio.principal)-num(portfolio.originationFee),receiptId=`CUST-DISB-${contract.id}`;if(Math.abs(amount-num(request.disbursementAmount))>.01||Math.abs(amount-num(request.invoiceAmount))>.01)throw new Error('bank-customer-disbursement-amount-conflict');if(bank.customerDisbursements.some(row=>row.id===receiptId))throw new Error('bank-customer-disbursement-reference-conflict');const settlement=F.execute({state},'disburse-customer-loan-to-sale',{fromCompany:'bank',toCompany:company,contractId:contract.id,sourceSaleId:request.sourceSaleId,orderId:request.orderId,proFormaReference:request.proFormaReference,customerId:contract.customerId,customerName:contract.customerName,reference:receiptId,amount,invoiceAmount:num(request.invoiceAmount),downPayment:0,loanPrincipal:portfolio.principal,originationFee:portfolio.originationFee});disbursementReceipt={id:receiptId,reference:settlement?.reference||receiptId,loanId:portfolio.id,contractId:contract.id,customerId:contract.customerId,sourceCompanyId:company,fromCompany:'bank',toCompany:company,sourceSaleId:request.sourceSaleId||null,orderId:request.orderId||null,invoiceNumber:settlement?.invoiceNumber||request.invoiceNumber||null,proFormaReference:request.proFormaReference||null,invoiceAmount:num(request.invoiceAmount),downPayment:0,loanPrincipal:portfolio.principal,originationFee:portfolio.originationFee,amount,status:settlement?.status||'posted',financeReceiptId:settlement?.receiptId||null,payerSource:'bank-customer-financing',postedAt:now(state)};bank.customerDisbursements.unshift(disbursementReceipt);bank.customerDisbursements=bank.customerDisbursements.slice(0,400);contract.disbursementReference=receiptId;contract.sourceSaleId=disbursementReceipt.sourceSaleId;contract.orderId=disbursementReceipt.orderId;contract.invoiceNumber=disbursementReceipt.invoiceNumber;contract.invoiceAmount=disbursementReceipt.invoiceAmount;contract.downPayment=0;}
    closeLoanRequest(ensure(state),request,'موافق',{decidedDay:day,loanId:portfolio.id,customerContractId:contract.id,disbursementReference:disbursementReceipt?.reference||null});return {requestId:request.id,status:'موافق',loanId:portfolio.id,contractId:contract.id,customerId:contract.customerId,principal:portfolio.principal,...(disbursementReceipt?{disbursementReceipt:clone(disbursementReceipt)}:{})};
  }
  function customerDisbursementForSale(state,p={}){const bank=ensure(state),row=bank.customerDisbursements.find(item=>(p.reference&&item.reference===String(p.reference))||(p.sourceSaleId&&item.sourceSaleId===String(p.sourceSaleId))||(p.orderId&&item.orderId===String(p.orderId)));if(!row)return null;const posted=(state.finance?.customerFinancingReceipts||[]).some(item=>item.reference===row.reference&&item.receiptId===row.financeReceiptId&&item.status==='posted'&&item.contractId===row.contractId&&item.toCompany===row.sourceCompanyId&&item.sourceSaleId===row.sourceSaleId&&item.orderId===row.orderId&&item.invoiceNumber===row.invoiceNumber&&Math.abs(num(item.amount)-num(row.amount))<.01);if(!posted||row.status!=='posted')return null;return clone(row);}
  function notifyCustomerLoanDecision(state,request,status,reason){if(!request?.sourceCompanyId)return;globalThis.GH_CUSTOMER_COMPANIES_CORE?.bankDecision?.(state,request,{status,reason});}
  function decideLoanRequest(state,p,F){
    const bank=ensure(state),request=bank.loanRequests.find(row=>row.id===String(p.id||''));if(!request)throw new Error('bank-loan-request-not-found');
    const day=Math.floor(now(state)/86400);if(day>=Number(request.expiresDay)){closeLoanRequest(bank,request,'منتهي',{decidedDay:day});notifyCustomerLoanDecision(state,request,'expired','bank-loan-request-expired');return {id:request.id,status:'منتهي',reason:'bank-loan-request-expired'};}
    if(p.decision==='reject'){closeLoanRequest(bank,request,'مرفوض',{decidedDay:day});notifyCustomerLoanDecision(state,request,'rejected','player-declined');return {id:request.id,status:'مرفوض'};}
    if(p.decision!=='approve')throw new Error('bank-loan-request-decision-invalid');
    const result=approveLoanRequest(state,request,day,F);return {id:request.id,status:result.status,loanId:result.loanId,contractId:result.contractId,customerId:result.customerId,principal:result.principal};
  }
  function submitCustomerLoanRequest(state,p){
    const bank=ensure(state),id=String(p.id||'').trim(),customerId=String(p.customerId||'').trim(),borrower=String(p.borrower||'').trim(),productId=String(p.product||'consumer'),product=PRODUCTS[productId],day=Math.floor(now(state)/86400);let amount=num(p.amount);
    if(!id||id.length>120||!customerId||customerId.length>120||!borrower||borrower.length>120)throw new Error('bank-customer-loan-identity-required');if(!product)throw new Error('bank-loan-product-invalid');if(amount<product.minimum)throw new Error('bank-loan-amount-invalid');
    if(!globalThis.GH_BUSINESS_WORLD?.resolveParty?.(state,customerId))throw new Error('bank-customer-party-not-found');
    const branch=bank.branchNetwork.find(row=>(row.id===p.branchId||row.facilityId===p.branchId)&&row.servicesActive)||bank.branchNetwork.find(row=>row.servicesActive);if(!branch)throw new Error('bank-active-branch-required');
    const termDays=Math.max(30,Math.floor(Number(p.termDays)||product.termDays)),riskGrade=RISK_GRADES[p.riskGrade]?p.riskGrade:'BBB',downPaymentReference=p.downPaymentReference?String(p.downPaymentReference):null,sourceCompanyId=p.sourceCompanyId?String(p.sourceCompanyId):null,invoiceAmount=num(p.invoiceAmount),downPayment=num(p.downPayment);
    if(sourceCompanyId){if(sourceCompanyId!=='dealership')throw new Error('bank-customer-finance-recipient-unsupported');if(downPayment!==0||downPaymentReference)throw new Error('bank-customer-finance-down-payment-not-supported');const quote=customerFinancingQuote(state,{invoiceAmount,downPayment:0,product:productId,termDays});amount=num(p.amount)||quote.loanPrincipal;if(Math.abs(amount-quote.loanPrincipal)>.01||Math.abs(num(p.disbursementAmount)-quote.disbursementAmount)>.01||Math.abs(invoiceAmount-quote.disbursementAmount)>.01)throw new Error('bank-customer-finance-quote-mismatch');if(!p.orderId||!p.sourceSaleId)throw new Error('bank-customer-finance-order-reference-required');if(p.proFormaReference&&String(p.proFormaReference)!==`AUTO-ORDER-${String(p.sourceSaleId)}`)throw new Error('bank-customer-finance-proforma-reference-invalid');}
    const request={id,customerId,borrower,product:productId,amount,termDays,riskGrade,collateralCoverage:clamp(p.collateralCoverage||0,0,5),sector:String(p.sector||'consumer').trim(),branchId:branch.id,branchName:`${branch.city} · ${branch.country}`,sourceCompanyId,sourceSaleId:p.sourceSaleId?String(p.sourceSaleId):null,orderId:p.orderId?String(p.orderId):null,invoiceNumber:p.invoiceNumber?String(p.invoiceNumber):null,proFormaReference:`AUTO-ORDER-${String(p.sourceSaleId||'')}`,invoiceAmount,downPayment:sourceCompanyId?0:downPayment,disbursementAmount:num(p.disbursementAmount),day,expiresDay:day+REQUEST_DAYS,status:'بانتظار القرار'};
    const stableRequest={id,customerId,borrower,product:productId,amount,termDays,riskGrade,collateralCoverage:request.collateralCoverage,sector:request.sector,branchId:branch.id,sourceCompanyId,sourceSaleId:request.sourceSaleId,orderId:request.orderId,invoiceNumber:request.invoiceNumber,invoiceAmount,downPayment:request.downPayment,proFormaReference:request.proFormaReference,disbursementAmount:request.disbursementAmount},fingerprint=JSON.stringify(stableRequest),existing=bank.loanRequests.find(row=>row.id===id);if(existing){if(existing.requestFingerprint!==fingerprint)throw new Error('bank-loan-request-reference-conflict');return clone(existing);}
    if(bank.loanRequestHistory.some(row=>row.id===id))throw new Error('bank-loan-request-reference-conflict');if(bank.loanRequests.length>=MAX_OPEN_REQUESTS)throw new Error('bank-loan-request-capacity');request.requestFingerprint=fingerprint;bank.loanRequests.push(request);return clone(request);
  }
  const BATCH_SKIP_CODES=new Set(['bank-loan-request-not-found','bank-loan-request-expired','bank-customer-party-not-found','bank-active-branch-required','bank-liquidity-buffer','bank-loan-deposit-limit','bank-projected-risk-limit','bank-borrower-sector-required']);
  function decideLoanRequestsBatch(state,p,F){
    const bank=ensure(state),day=Math.floor(now(state)/86400),batchId=String(p.batchId||'').trim(),periodId=String(p.periodId??Math.floor(day/30)),decisions=Array.isArray(p.decisions)?p.decisions:[];
    if(!batchId||batchId.length>120)throw new Error('bank-batch-id-required');if(!decisions.length||decisions.length>MAX_OPEN_REQUESTS)throw new Error('bank-loan-batch-size-invalid');
    const normalized=decisions.map(row=>({id:String(row?.id||''),decision:String(row?.decision||''),...(row?.customerId?{customerId:String(row.customerId)}:{}),...(row?.sourceCompanyId?{sourceCompanyId:String(row.sourceCompanyId)}:{}),...(row?.sourceSaleId?{sourceSaleId:String(row.sourceSaleId)}:{})})).sort((a,b)=>a.id.localeCompare(b.id));if(normalized.some(row=>!row.id||!['approve','reject'].includes(row.decision)))throw new Error('bank-loan-batch-decision-invalid');if(new Set(normalized.map(row=>row.id)).size!==normalized.length)throw new Error('bank-loan-batch-duplicate-request');
    const fingerprint=JSON.stringify({periodId,decisions:normalized}),cached=batchReplay(bank.loanApprovalBatches,batchId,fingerprint);if(cached)return cached;
    const items=[];let totalPrincipal=0,totalDisbursed=0,rejected=0,approved=0,skipped=0;
    for(const item of normalized){const request=bank.loanRequests.find(row=>row.id===item.id);if(!request){items.push({requestId:item.id,status:'تجاوز',reason:'bank-loan-request-not-found'});skipped++;continue;}
      if(day>=Number(request.expiresDay)){closeLoanRequest(bank,request,'منتهي',{decidedDay:day});notifyCustomerLoanDecision(state,request,'expired','bank-loan-request-expired');items.push({requestId:item.id,status:'منتهي',reason:'bank-loan-request-expired'});skipped++;continue;}
      if(item.decision==='reject'){closeLoanRequest(bank,request,'مرفوض',{decidedDay:day,batchId});notifyCustomerLoanDecision(state,request,'rejected','player-declined');items.push({requestId:item.id,status:'مرفوض'});rejected++;continue;}
      try{const result=approveLoanRequest(state,{...request,...item},day,F);items.push({...result});approved++;totalPrincipal+=num(result.principal);totalDisbursed+=num(result.disbursementReceipt?.amount);}
      catch(error){if(!BATCH_SKIP_CODES.has(String(error?.code||error?.message||'')))throw error;const reason=String(error?.code||error?.message);items.push({requestId:item.id,status:'تجاوز',reason});skipped++;}
    }
    const result={batchId,periodId,approved,rejected,skipped,totalPrincipal,totalDisbursed,items};return rememberBatch(bank.loanApprovalBatches,batchId,fingerprint,result,state);
  }
  function* collectCustomerInstallmentStages(state,p={}){
    const bank=ensure(state),day=Math.max(0,Math.floor(Number(p.throughDay??Math.floor(now(state)/86400)))),periodNumber=Math.max(0,Math.floor(Number(p.periodId??Math.floor(day/30)))),periodId=String(periodNumber),includeOverdue=p.includeOverdue===true,batchId=String(p.batchId||`BANK-COLLECT-${periodId}-${day}`),fingerprint=JSON.stringify({periodId,throughDay:day,...(includeOverdue?{includeOverdue:true}:{})});
    const cached=batchReplay(bank.customerInstallmentBatches,batchId,fingerprint);if(cached)return cached;
    let paid=0,missed=0,principalPaid=0,interestPaid=0,totalDue=0;const items=[],dueIds=[],maxRows=25,startDay=includeOverdue?0:p.periodId===undefined?day:periodNumber*30,endDay=includeOverdue?day:Math.min(day,p.periodId===undefined?day:periodNumber*30+29),schedule=bank.customerInstallmentSchedule;
    // Walk only existing date buckets, oldest first. Keep the same 25-contract work cap; the next daily close resumes
    // any older bucket across period boundaries. Explicit player period queries keep their original scope.
    const eligible=key=>Number.isSafeInteger(Number(key))&&Number(key)>=startDay&&Number(key)<=endDay&&Array.isArray(schedule[key])&&schedule[key].length>0;
    for(const key of Object.keys(schedule).filter(eligible).sort((a,b)=>Number(a)-Number(b))){const ids=schedule[key];while(ids.length&&dueIds.length<maxRows){const id=ids.shift();if(id)dueIds.push(id);}if(!ids.length)delete schedule[key];if(dueIds.length>=maxRows)break;}
    for(const id of dueIds){const contract=contractFor(bank,id);if(!contract||contract.status==='مسدد')continue;const portfolio=portfolioFor(bank,contract.portfolioId),installmentNumber=contract.installmentNumber+1,installmentId=`${contract.id}:${installmentNumber}`;
      const elapsed=Math.max(0,day-Math.max(Number(contract.lastAccruedDay)||contract.startDay,Number(contract.nextDueDay)-30)),newInterest=num(contract.outstanding)*num(contract.rate)*elapsed/365;contract.accruedInterest+=newInterest;contract.lastAccruedDay=day;
      const scheduledPrincipal=Math.min(contract.outstanding,installmentNumber>=contract.termMonths?contract.outstanding:contract.monthlyPrincipal),duePrincipal=Math.min(contract.outstanding,scheduledPrincipal+contract.principalArrears),dueInterest=contract.accruedInterest+contract.interestArrears,amount=duePrincipal+dueInterest;totalDue+=amount;
      const externalSettlementReference=`BANK-CUST-PAY-${installmentId}`,row={installmentId,contractId:contract.id,customerId:contract.customerId,dueDay:contract.nextDueDay,periodId:String(Math.floor(contract.nextDueDay/30)),principalDue:duePrincipal,interestDue:dueInterest,amount,status:'مستحقة',payerSource:'customer',externalSettlementReference};
      if(!portfolio||portfolio.stage>=3||portfolio.status==='متعثرة'){
        contract.principalArrears=duePrincipal;contract.interestArrears=dueInterest;contract.accruedInterest=0;contract.status='متأخر';row.status='متأخرة';missed++;
      }else{
        // Finance Core owns the external receipt, cash posting, and balanced loan/interest journal legs.
        const principal=Math.min(duePrincipal,contract.outstanding),interest=dueInterest,settlement=globalThis.GH_FINANCE_CORE.execute({state},'receive-customer-loan-payment',{company:'bank',reference:`BANK-CUST-PAY-${installmentId}`,contractId:contract.id,customerId:contract.customerId,customerName:contract.customerName,principalAmount:principal,interestAmount:interest,payerSource:'customer'});if(settlement?.status!=='posted'||settlement?.contractId!==contract.id||settlement?.customerId!==contract.customerId||Math.abs(num(settlement.amount)-amount)>.01)throw new Error('bank-customer-installment-settlement-unconfirmed');
        contract.outstanding=Math.max(0,contract.outstanding-principal);contract.principalArrears=0;contract.accruedInterest=0;contract.interestArrears=0;contract.status=contract.outstanding<=.01?'مسدد':'نشط';if(portfolio){portfolio.outstanding=Math.max(0,portfolio.outstanding-principal);if(portfolio.outstanding<=.01)portfolio.status='مسددة';}
      bank.loans=Math.max(0,bank.loans-principal);const branch=bank.branchNetwork.find(row=>row.id===contract.branchId);if(branch)branch.loans=Math.max(0,num(branch.loans)-principal);principalPaid+=principal;interestPaid+=interest;row.status='مدفوعة';row.principalPaid=principal;row.interestPaid=interest;row.receiptId=settlement.receiptId;row.paidAt=now(state);paid++;
      }
      contract.installmentNumber=installmentNumber;contract.nextDueDay=Math.max(0,Math.floor(Number(contract.nextDueDay)||0))+30;items.push(row);bank.customerInstallmentSettlements.unshift(row);if(contract.status!=='مسدد')scheduleCustomerInstallment(bank,contract);else archiveCustomerContract(bank,contract);
      yield `customer-installment:${id}`;
    }
    bank.customerInstallmentSettlements=bank.customerInstallmentSettlements.slice(0,800);const result={batchId,periodId,throughDay:day,due:items.length,paid,missed,totalDue,principalPaid,interestPaid,totalCollected:principalPaid+interestPaid,remaining:Object.keys(schedule).some(eligible),items};return rememberBatch(bank.customerInstallmentBatches,batchId,fingerprint,result,state);
  }
  function drainBankStages(stages){let step;while(!(step=stages.next()).done){}return step.value;}
  function collectCustomerInstallments(state,p={}){return drainBankStages(collectCustomerInstallmentStages(state,p));}
  function dormant(bank){return num(bank.branches)===0&&num(bank.deposits)===0&&num(bank.loans)===0&&num(bank.wholesaleFunding)===0;}
  function depositMix(bank){
    const mix=bank.branchNetwork.reduce((out,branch)=>{for(const key of Object.keys(DEPOSIT_PRODUCTS))out[key]+=num(branch.depositMix?.[key]);return out;},{sight:0,savings:0,term:0}),known=mix.sight+mix.savings+mix.term,missing=Math.max(0,num(bank.deposits)-known);
    mix.sight+=missing*.45;mix.savings+=missing*.35;mix.term+=missing*.20;return mix;
  }
  // One read-only calculator for both actual balances and credit preflight.
  // The formulas are this game's existing prudential model, not a regulatory model.
  function prudentialMetrics(state,bank,cash){
    const deposits=num(bank.deposits),wholesale=num(bank.wholesaleFunding),mix=depositMix(bank),securities=bank.treasurySecurities.filter(row=>row.status==='ساري');
    const securityAssets=securities.reduce((sum,row)=>sum+num(row.amount),0),securityHqla=securities.reduce((sum,row)=>sum+num(row.amount)*num(row.hqlaFactor||.85),0);
    const offBalance=[...bank.lettersOfCredit,...bank.guarantees].filter(row=>row.status==='ساري').reduce((sum,row)=>sum+num(row.amount),0);
    const hqla=Math.round(cash+securityHqla),requiredStableFunding=bank.loanPortfolios.reduce((sum,row)=>sum+num(row.outstanding)*num(row.rsfFactor||.85),0)+Object.values(bank.corporateClients).reduce((sum,row)=>sum+num(row.drawn)*.85,0)+securities.reduce((sum,row)=>sum+num(row.amount)*.15,0);
    const stressedOutflows=Math.max(1,mix.sight*DEPOSIT_PRODUCTS.sight.runoff+mix.savings*DEPOSIT_PRODUCTS.savings.runoff+mix.term*DEPOSIT_PRODUCTS.term.runoff+wholesale*.25);
    const rwa=bank.loanPortfolios.reduce((sum,row)=>sum+num(row.outstanding)*num(PRODUCTS[row.product]?.riskWeight||.72),0)+Object.values(bank.corporateClients).reduce((sum,row)=>sum+num(row.drawn)*.85,0)+offBalance*.35+num(bank.branches)*2500000;
    const equity=Math.max(0,cash+num(bank.loans)+securityAssets-deposits-wholesale-num(bank.provisions));
    const stableFunding=Math.round(mix.sight*DEPOSIT_PRODUCTS.sight.asf+mix.savings*DEPOSIT_PRODUCTS.savings.asf+mix.term*DEPOSIT_PRODUCTS.term.asf+wholesale*ASF_WHOLESALE+equity),lcr=clamp(hqla/stressedOutflows*100,0,500),nsfr=clamp(stableFunding/Math.max(1,requiredStableFunding)*100,0,400),cet1=rwa?clamp(equity/rwa*100,0,100):equity>0?100:0;
    // Build 377 (Basel III leverage ratio): capital over the whole exposure, on and off balance sheet (guarantees and letters
    // of credit at 50%), with no risk weights. Regulators require at least 3%.
    const exposure=cash+num(bank.loans)+securityAssets+offBalance*.5,leverageRatio=exposure>0?clamp(equity/exposure*100,0,100):equity>0?100:0;
    return {offBalance,hqla,requiredStableFunding,stressedOutflows,rwa,cet1Capital:equity,leverageExposure:exposure,stableFunding,lcr,nsfr,cet1,capitalRatio:cet1,leverageRatio,loanDepositRatio:deposits?num(bank.loans)/deposits*100:0,alm:{weightedDepositRate:(mix.sight*num(pricing(state,bank).sight)+mix.savings*num(pricing(state,bank).savings)+mix.term*num(pricing(state,bank).term))/(deposits||1),maturityLadder:{overnight:mix.sight,under30:mix.savings*.35+wholesale*.15,under365:mix.savings*.65+mix.term*.45+wholesale*.35,over365:mix.term*.55+wholesale*.50},interestRateGap:num(bank.loans)-deposits,liquidityGap30d:hqla-stressedOutflows}};
  }
  // A distribution must preserve both the 7% CET1 buffer and the 3% leverage floor. Cash leaves the exposure as well
  // as capital, so the leverage headroom solves (capital - payout) / (exposure - payout) >= 3%.
  const CET1_DISTRIBUTION_FLOOR=7;
  function distributableCash(state){
    if(!state.bank||typeof state.bank!=='object')return Infinity;const bank=ensure(state);if(dormant(bank))return Infinity;
    const metrics=prudentialMetrics(state,bank,num(globalThis.GH_FINANCE_CORE?.operating?.(state,'bank')));
    const capital=num(metrics.cet1Capital),cet1Room=metrics.rwa>0?capital-metrics.rwa*CET1_DISTRIBUTION_FLOOR/100:Infinity;
    const leverageFloor=MIN_LEVERAGE_RATIO/100,leverageRoom=metrics.leverageExposure>0?(capital-metrics.leverageExposure*leverageFloor)/(1-leverageFloor):Infinity;
    return Math.max(0,Math.min(cet1Room,leverageRoom));
  }
  function reconcilePrudential(state){
    const bank=ensure(state);
    if(dormant(bank)){Object.assign(bank,{hqla:0,stableFunding:0,requiredStableFunding:0,lcr:120,nsfr:112,cet1:num(bank.capitalRatio)||16.4,loanDepositRatio:0,rwa:0,stressedOutflows:0});return bank;}
    // A dormant, unfounded bank has no finance book. Keep active-bank reads strict.
    const metrics=prudentialMetrics(state,bank,num(globalThis.GH_FINANCE_CORE?.operating?.(state,'bank'))),{alm,leverageExposure,...values}=metrics;
    Object.assign(bank,values);Object.assign(bank.alm,alm);return bank;
  }
  // A single review computes the same prudential metrics as the eventual transfer. The preview copies bank rows,
  // never the game or its fleet; it neither normalises the live state nor writes customer balances.
  function operatingAcquisitionPreview(state,q){
    const bank=state.bank,branch=bank.branchNetwork.find(row=>row.id===q.targetId);if(!branch)throw new Error('operating-location-required');
    const next={...bank,deposits:num(bank.deposits)+q.deposits,
      branchNetwork:bank.branchNetwork.map(row=>row===branch?{...row,deposits:num(row.deposits)+q.deposits,depositMix:{sight:num(row.depositMix.sight)+q.deposits*.45,savings:num(row.depositMix.savings)+q.deposits*.35,term:num(row.depositMix.term)+q.deposits*.2}}:row)};
    const preview=creditRiskPreview({...state,bank:next},{cashDelta:q.transferredCash-q.price,loanDelta:q.loans,sector:'commercial',portfolio:{outstanding:q.loans,product:'corporate',sector:'commercial',status:'نشطة',rsfFactor:.85}});
    return {...preview.metrics,accepted:preview.accepted,violations:preview.violations,concentration:preview.concentration};
  }
  function creditRiskPreview(state,proposal={}){
    const bank=state.bank;if(!bank?.riskPolicy||!bank.corporateClients||!Array.isArray(bank.loanPortfolios))throw new Error('bank-risk-state-not-initialized');
    const delta=key=>{const value=Number(proposal[key]??0);if(!Number.isFinite(value)||(key!=='cashDelta'&&value<0))throw new Error(`bank-risk-projection-invalid:${key}`);return value;};
    const cashDelta=delta('cashDelta'),loanDelta=delta('loanDelta'),provisionDelta=delta('provisionDelta'),drawnDelta=delta('drawnDelta'),offBalanceDelta=delta('offBalanceDelta');
    // Only small, touched banking collections are copied; nothing is published or
    // persisted until the existing transaction owner accepts the original command.
    const projected={...bank,loans:num(bank.loans)+loanDelta,provisions:num(bank.provisions)+provisionDelta};
    if(proposal.portfolio)projected.loanPortfolios=[proposal.portfolio,...bank.loanPortfolios];
    if(drawnDelta){const clientId=String(proposal.clientId||''),client=bank.corporateClients[clientId];if(!client)throw new Error('bank-client-not-synced');projected.corporateClients={...bank.corporateClients,[clientId]:{...client,drawn:num(client.drawn)+drawnDelta}};}
    if(offBalanceDelta)projected.guarantees=[...bank.guarantees,{status:'ساري',amount:offBalanceDelta}];
    const cash=num(globalThis.GH_FINANCE_CORE?.operating?.(state,'bank'))+cashDelta,metrics=prudentialMetrics(state,projected,cash),violations=[];
    if(!Number.isFinite(cash)||cash<0)violations.push({metric:'cash',projected:cash,minimum:0});
    // The leverage floor is the regulator's, not a policy the player sets.
    if(Number.isFinite(metrics.leverageRatio)&&metrics.leverageRatio+1e-9<MIN_LEVERAGE_RATIO)violations.push({metric:'leverageRatio',projected:metrics.leverageRatio,minimum:MIN_LEVERAGE_RATIO});
    for(const [metric,key] of [['lcr','minLcr'],['nsfr','minNsfr'],['cet1','minCet1']]){const minimum=Number(bank.riskPolicy[key]);if(!Number.isFinite(minimum)||minimum<=0)throw new Error(`bank-risk-policy-invalid:${key}`);if(!Number.isFinite(metrics[metric])||metrics[metric]+1e-9<minimum)violations.push({metric,projected:metrics[metric],minimum});}
    const maximum=Number(bank.riskPolicy.maxLdr);if(!Number.isFinite(maximum)||maximum<=0)throw new Error('bank-risk-policy-invalid:maxLdr');
    if(num(bank.deposits)>0&&metrics.loanDepositRatio>maximum+1e-9)violations.push({metric:'loanDepositRatio',projected:metrics.loanDepositRatio,maximum});
    let concentration={status:'not-applicable',configuredLimit:num(bank.riskPolicy.sectorConcentration)};
    const proposedSector=String(proposal.sector||'').trim();
    if(proposedSector){
      const exposures=new Map(),add=(sector,amount)=>{sector=String(sector||'').trim();amount=num(amount);if(sector&&amount>0)exposures.set(sector,(exposures.get(sector)||0)+amount);};
      for(const row of bank.loanPortfolios)if(row.status!=='مسددة')add(row.sector,row.outstanding);
      for(const row of bank.corporateFacilities)if(row.status!=='مسدد'){const client=bank.corporateClients[row.ownerCompanyId||row.company];add(row.sector||client?.sector,row.outstanding);}
      add(proposedSector,loanDelta||drawnDelta||offBalanceDelta);
      const total=[...exposures.values()].reduce((sum,value)=>sum+value,0),sectorAmount=exposures.get(proposedSector)||0,pct=total>0?sectorAmount/total*100:0,maximum=num(bank.riskPolicy.sectorConcentration);
      concentration={status:'enforced',sector:proposedSector,projected:pct,maximum,totalExposure:total};
      // A first classified exposure necessarily starts at 100%. Concentration becomes
      // an enforceable portfolio limit once there is another classified exposure to
      // diversify against; this avoids making a new bank unable to originate at all.
      if(total>sectorAmount+1e-8&&pct>maximum+1e-9)violations.push({metric:'sectorConcentration',sector:proposedSector,projected:pct,maximum});
    }else if(loanDelta||drawnDelta||offBalanceDelta)concentration={status:'not-enforced-missing-sector-classification',configuredLimit:num(bank.riskPolicy.sectorConcentration)};
    return {accepted:violations.length===0,metrics,violations,concentration};
  }
  function assertProjectedCredit(state,proposal){
    const preview=creditRiskPreview(state,proposal);if(preview.accepted)return preview;
    const labels={leverageRatio:'نسبة الرافعة المالية',cash:'السيولة المتاحة',lcr:'تغطية السيولة',nsfr:'التمويل المستقر',cet1:'كفاية رأس المال',loanDepositRatio:'القروض إلى الودائع',sectorConcentration:'التركّز القطاعي'};
    const error=new Error(`رُفض التمويل: يتجاوز حدود سياسة البنك بعد التنفيذ (${preview.violations.map(row=>labels[row.metric]||row.metric).join('، ')})`);error.code='bank-projected-risk-limit';error.violations=preview.violations;throw error;
  }
  function corporateClientRow(state,type,existing,p,book){
    const baseValue=Math.max(5000000,num(state.groupValue)*(type==='group'?.04:.025));if(!book?.accounts?.[0])throw new Error(`bank-client-finance-book-missing:${type}`);const sector=String(companyPlatform()?.definitionFor?.(state,type)?.classification?.primarySectorId||existing.sector||'').trim()||null;
    return {company:type,ownerCompanyId:type,name:p.names?.[type]||companyPlatform()?.resolveIdentity?.(state,type)?.legalName||state.companyRegistry?.[type]?.legalName||(type==='group'?state.profile?.name:type),accountId:book.accounts[0].id,depositBalance:num(existing.depositBalance),creditLimit:num(existing.creditLimit)||Math.round(baseValue),drawn:num(existing.drawn),rating:existing.rating||(type==='group'?state.profile?.creditRating:'BBB'),sector,kyc:existing.kyc||'مكتمل',lastReview:num(existing.lastReview)};
  }
  function corporateClientView(state,p={}){
    if(corporateClientsCurrent(state,p))return state.bank.corporateClients;
    const F=globalThis.GH_FINANCE_CORE,clients={...(state.bank?.corporateClients||{})};
    for(const type of corporateCompanyIds(state,F))clients[type]=corporateClientRow(state,type,clients[type]||{creditLimit:5000000,rating:'BBB'},p,F.book(state,type));
    return clients;
  }
  function corporateClientsCurrent(state,p={}){
    const F=globalThis.GH_FINANCE_CORE,clients=state.bank?.corporateClients;if(!F||!clients||typeof clients!=='object'||Array.isArray(clients))return false;
    for(const type of corporateCompanyIds(state,F)){
      const current=clients[type],book=state.companyFinance?.[type];if(!current||typeof current!=='object'||Array.isArray(current)||!book?.accounts?.[0])return false;
      const expected=corporateClientRow(state,type,current,p,book),keys=Object.keys(expected);if(Object.keys(current).length!==keys.length||keys.some(key=>!Object.prototype.hasOwnProperty.call(current,key)||!Object.is(current[key],expected[key])))return false;
    }
    return true;
  }
  function syncCorporateClients(state,p,F){
    const bank=ensure(state),types=corporateCompanyIds(state,F);
    for(const type of types){const book=F.book(state,type),existing=bank.corporateClients[type]||{};bank.corporateClients[type]=corporateClientRow(state,type,existing,p,book);}
    return bank.corporateClients;
  }
  function openBranch(state,p={}){
    if(!(state.openedCompanies||[]).includes('bank'))throw new Error('bank-company-not-open');
    const facilityCore=globalThis.GH_FACILITY_CORE;if(!facilityCore?.verifyDirectorySite)throw new Error('facility-directory-owner-missing');
    const site=facilityCore.verifyDirectorySite(p.site||p,'bank',state),facility=(state.customHubs||[]).find(row=>row?.id===p.facilityId&&row.owned===true&&facilityOwnerCompanyId(row)==='bank'&&row.kind==='bank'&&row.sourceKey===site.key);
    if(!facility)throw new Error('bank-branch-facility-required');
    const bank=ensure(state),id=String(p.branchId||`BR-${++bank.sequence}`);if(bank.branchNetwork.some(row=>row.id===id||row.facilityId===facility.id))throw new Error('bank-branch-already-open');
    const branch=branchTemplate(state,{...p,branchId:id,facilityId:facility.id,capitalId:site.capitalId,city:site.city,country:site.country});bank.branchNetwork.push(branch);bank.branches=bank.branchNetwork.length;state.unlockedSectors=Array.isArray(state.unlockedSectors)?state.unlockedSectors:[];if(!state.unlockedSectors.includes('bank'))state.unlockedSectors.push('bank');reconcilePrudential(state);return clone(branch);
  }
  function gradeFor(p,amount,product){if(RISK_GRADES[p.riskGrade])return p.riskGrade;const collateral=clamp(p.collateralCoverage||0,0,5),borrowers=Math.max(1,Number(p.borrowers)||1),size=amount/Math.max(1,requestBase(product)),score=72+collateral*9-Math.log10(Math.max(1,size))*5-Math.min(12,borrowers/20);return score>=88?'AA':score>=78?'A':score>=66?'BBB':score>=54?'BB':'B';}
  function recordTransactionFee(bank,{id,at,day,amount,category,sourceId}){
    const fee=num(amount);if(fee<=0)return;
    // A fee is counted by the first bank close that has not run yet. The close of a day runs at its start, so a fee
    // charged after that day's bank close (any daytime action, or later in that close) is counted the next day.
    const eventDay=Math.max(0,Math.floor(Number(day)||0)),closeDay=Number(bank.lastProcessedDay)>=eventDay?eventDay+1:eventDay,key=String(closeDay);
    if(bank.feeEvents.some(row=>row.id===id))return;
    bank.feeEvents.unshift({id,at,day:eventDay,closeDay,amount:fee,category,sourceId});bank.feeEvents=bank.feeEvents.slice(0,800);
    bank.transactionFeeByDay=bank.transactionFeeByDay&&typeof bank.transactionFeeByDay==='object'&&!Array.isArray(bank.transactionFeeByDay)?bank.transactionFeeByDay:{};
    bank.transactionFeeByDay[key]=num(bank.transactionFeeByDay[key])+fee;
    const days=Object.keys(bank.transactionFeeByDay).map(Number).filter(Number.isFinite).sort((a,b)=>b-a);for(const stale of days.slice(0+400))delete bank.transactionFeeByDay[String(stale)];
  }
  function originateLoan(state,p,F){
    const bank=ensure(state),productId=String(p.product&&PRODUCTS[p.product]?p.product:'corporate'),product=PRODUCTS[productId],branch=bank.branchNetwork.find(row=>row.id===p.branchId||row.facilityId===p.branchId)||bank.branchNetwork.find(row=>row.servicesActive);if(!branch?.servicesActive)throw new Error('bank-active-branch-required');
    const requested=num(p.amount);if(requested<=0)throw new Error('bank-loan-amount-invalid');const amount=Math.max(product.minimum,requested),operating=F.operating(state,'bank'),minimumLiquidity=Math.max(5000000,num(bank.deposits)*.12);if(operating-amount<minimumLiquidity)throw new Error('bank-liquidity-buffer');
    const projectedLdr=(num(bank.loans)+amount)/Math.max(1,num(bank.deposits))*100;if(bank.deposits>0&&projectedLdr>num(bank.riskPolicy.maxLdr))throw new Error('bank-loan-deposit-limit');
    const riskGrade=gradeFor(p,amount,product),risk=RISK_GRADES[riskGrade],collateralCoverage=clamp(p.collateralCoverage||0,0,5),lgd=clamp(risk.lgd*(collateralCoverage?Math.max(.35,1-collateralCoverage*.22):1),.08,.90),expectedLoss=amount*risk.pd*lgd,fee=originationFee(product,amount),cashDisbursement=amount-fee,id=`LOAN-${bank.sequence+1}`;
    const termDays=Math.max(30,Math.floor(Number(p.termDays)||product.termDays)),sector=String(p.sector||p.borrowerSector||'').trim()||null;if(!sector)throw new Error('bank-borrower-sector-required');const rateQuote=loanRateQuote(state,productId,riskGrade,branch.country||''),referenceApi=globalThis.GH_MARKET_REFERENCE,portfolio={id,branchId:branch.id,product:productId,name:product.name,region:`${branch.city} · ${branch.country}`,borrowers:Math.max(1,Math.floor(Number(p.borrowers)||Math.max(1,amount/product.minimum))),principal:amount,outstanding:amount,rate:rateQuote.rate,rateReference:referenceApi?.persistedReference?.(rateQuote.reference)||rateQuote.reference,rateComponents:{baseRate:rateQuote.baseRate,productSpread:rateQuote.productSpread,riskPremium:rateQuote.riskPremium},termDays,remainingDays:termDays,sector,provisionRate:num(p.provisionRate||product.provision),rsfFactor:num(p.rsfFactor||product.rsf),originationFee:fee,originatedAt:now(state),riskGrade,pd:risk.pd,lgd,expectedLoss,collateralCoverage,stage:1,daysPastDue:0,repricingDays:Math.max(30,Math.floor(Number(p.repricingDays)||365)),status:'نشطة'};
    if(p.disbursementRecipient){portfolio.disbursementRecipient=String(p.disbursementRecipient);portfolio.disbursementRecipientCompanyId=String(p.disbursementRecipientCompanyId||'');}
    const provision=Math.max(amount*portfolio.provisionRate,expectedLoss);
    assertProjectedCredit(state,{cashDelta:-cashDisbursement,loanDelta:amount,provisionDelta:provision,portfolio,sector:portfolio.sector});
    const book=F.book(state,'bank');bank.sequence++;
    if(p.disbursementRecipient){F.journal(state,'bank',`${id} · ${product.name}`,[{account:`محفظة قروض · ${product.name}`,debit:amount},{account:'تمويلات عملاء مستحقة للتحويل',credit:cashDisbursement},{account:'إيراد رسوم ترتيب تمويل',credit:fee}],id);}
    else{book.accounts[0].balance-=cashDisbursement;F.journal(state,'bank',`${id} · ${product.name}`,[{account:`محفظة قروض · ${product.name}`,debit:amount},{account:book.accounts[0].id,credit:cashDisbursement},{account:'إيراد رسوم ترتيب تمويل',credit:fee}],id);}
    bank.loanPortfolios.unshift(portfolio);cachePortfolio(bank,portfolio);recordTransactionFee(bank,{id:`FEE-${id}`,at:now(state),day:Math.floor(now(state)/86400),amount:fee,category:'arrangement',sourceId:id});bank.creditDecisions.unshift({id:`CRD-${id}`,loanId:id,at:now(state),decision:'موافق',riskGrade,pd:risk.pd,lgd,expectedLoss,collateralCoverage,amount,product:productId});bank.creditDecisions=bank.creditDecisions.slice(0,300);bank.loans+=amount;bank.provisions+=provision;bank.feeIncomeYTD+=fee;bank.revenueYTD.arrangement=num(bank.revenueYTD.arrangement)+fee;branch.loans+=amount;F.reconcile(state);reconcilePrudential(state);return clone(portfolio);
  }
  // Build 377 (owner's decision): the group's developer sends its home buyers to the group's bank. Once a month the bank
  // books the month's mortgages of one country as one portfolio (product 'mortgage', one borrower per unit) at a branch
  // it runs there. The same limits apply as to any loan; when the bank cannot lend (no branch, liquidity, limits), the
  // buyers financed elsewhere and nothing is booked. Returns the portfolio or null.
  const MORTGAGE_DECLINES=new Set(['bank-liquidity-buffer','bank-loan-deposit-limit','bank-projected-risk-limit','bank-active-branch-required']);
  function originateMarketMortgage(state,p={}){
    if(!(state.openedCompanies||[]).includes('bank')||!state.bank)return null;
    const F=globalThis.GH_FINANCE_CORE,country=String(p.country||'').trim(),amount=Math.round(num(p.amount)),units=Math.max(1,Math.floor(num(p.units)));if(!F?.execute||!country||amount<PRODUCTS.mortgage.minimum)return null;
    const bank=ensure(state),branch=bank.branchNetwork.find(row=>row.servicesActive&&row.country===country&&(row.services||[]).includes('تمويل أفراد'));if(!branch)return null;
    try{return originateLoan(state,{product:'mortgage',branchId:branch.id,amount,borrowers:units,sector:'real-estate',collateralCoverage:1.4,reference:String(p.reference||'')},F);}
    catch(error){if(MORTGAGE_DECLINES.has(String(error?.code||error?.message||'')))return null;throw error;}
  }
  function setDepositPricing(state,p){const bank=ensure(state),stance=String(p.stance||'');if(!(stance in DEPOSIT_STANCES))throw new Error('bank-deposit-stance-invalid');bank.depositPricing={stance,lastChangedAt:now(state)};return {...bank.depositPricing,...pricing(state,bank)};}
  function setRiskPolicy(state,p){const bank=ensure(state),policy={...bank.riskPolicy};if(p.maxLdr!==undefined)policy.maxLdr=clamp(p.maxLdr,55,120);if(p.minLcr!==undefined)policy.minLcr=clamp(p.minLcr,100,200);if(p.minNsfr!==undefined)policy.minNsfr=clamp(p.minNsfr,100,180);if(p.minCet1!==undefined)policy.minCet1=clamp(p.minCet1,4.5,30);if(p.sectorConcentration!==undefined)policy.sectorConcentration=clamp(p.sectorConcentration,10,60);policy.lastChangedAt=now(state);bank.riskPolicy=policy;bank.riskReviews.unshift({at:now(state),type:'risk-policy',policy:clone(policy)});return clone(policy);}
  function raiseWholesaleFunding(state,p,F){
    const bank=ensure(state),amount=num(p.amount),termDays=Math.floor(Number(p.termDays)||0),rate=wholesaleRate(state,termDays);if(amount<=0)throw new Error('bank-wholesale-amount-invalid');const account=F.book(state,'bank').accounts[0],id=`WF-${++bank.sequence}`;account.balance+=amount;bank.wholesaleFunding+=amount;const facility={id,lender:'سوق التمويل المؤسسي',amount,outstanding:amount,rate,termDays,startDay:Math.floor(now(state)/86400),maturityDay:Math.floor(now(state)/86400)+termDays,status:'ساري'};bank.wholesaleFacilities.unshift(facility);F.journal(state,'bank',`${id} · تمويل جملة`,[{account:account.id,debit:amount},{account:'تمويل جملة مستحق',credit:amount}],id);F.reconcile(state);reconcilePrudential(state);return clone(facility);
  }
  function investLiquidity(state,p,F){
    const bank=ensure(state),amount=num(p.amount),kind=['sovereign','central-bank','covered-bond'].includes(p.kind)?p.kind:'sovereign',termDays=Math.floor(Number(p.termDays)||0),yieldRate=liquidityYield(state,kind,termDays),account=F.book(state,'bank').accounts[0],minimum=Math.max(5000000,num(bank.deposits)*.12);if(amount<=0||num(account.balance)-amount<minimum)throw new Error('bank-liquidity-buffer');
    const id=`HQLA-${++bank.sequence}`,factor=kind==='sovereign'||kind==='central-bank'?1:.85;account.balance-=amount;const security={id,kind,amount,yieldRate,termDays,hqlaFactor:factor,purchasedDay:Math.floor(now(state)/86400),maturityDay:Math.floor(now(state)/86400)+termDays,status:'ساري'};bank.treasurySecurities.unshift(security);F.journal(state,'bank',`${id} · استثمار سيولة`,[{account:'أوراق مالية عالية السيولة',debit:amount},{account:account.id,credit:amount}],id);F.reconcile(state);reconcilePrudential(state);return clone(security);
  }
  // Build 374 (owner's decision): the bank is run by choices. Risk appetite is one of three presets that set the five
  // limits together; the "balanced" preset is the bank's default limits.
  const RISK_PRESETS=Object.freeze({
    cautious:Object.freeze({label:'حذر',maxLdr:80,minLcr:130,minNsfr:115,minCet1:13,sectorConcentration:20}),
    balanced:Object.freeze({label:'متوازن',maxLdr:95,minLcr:110,minNsfr:105,minCet1:10.5,sectorConcentration:25}),
    growth:Object.freeze({label:'نمو',maxLdr:110,minLcr:100,minNsfr:100,minCet1:9,sectorConcentration:35})
  });
  function setRiskPreset(state,p){const preset=RISK_PRESETS[String(p.preset||'')];if(!preset)throw new Error('bank-risk-preset-invalid');const {label:_label,...limits}=preset;const policy=setRiskPolicy(state,limits);const bank=ensure(state);bank.riskPolicy.preset=String(p.preset);return {...policy,preset:String(p.preset)};}
  function riskPreset(policy){for(const [id,row] of Object.entries(RISK_PRESETS))if(['maxLdr','minLcr','minNsfr','minCet1','sectorConcentration'].every(key=>Number(policy?.[key])===row[key]))return id;return null;}
  // Automatic treasury (off unless the player turns it on): each day the cash above 1.6x the liquidity floor is invested
  // in 90-day sovereign paper down to 1.3x, and cash below the floor is topped up with 180-day wholesale funding (at most
  // 15% of deposits outstanding). The floor is the one investLiquidity already enforces.
  function setAutoLiquidity(state,p){const bank=ensure(state);bank.autoLiquidity=p.enabled===true;return {enabled:bank.autoLiquidity};}
  function liquidityFloor(bank){return Math.max(5000000,num(bank.deposits)*.12);}
  function autoLiquidity(state,bank,F){
    if(bank.autoLiquidity!==true)return null;
    const account=F.book(state,'bank').accounts[0],floor=liquidityFloor(bank),cash=num(account.balance);
    if(cash>floor*1.6){const amount=Math.floor((cash-floor*1.3)/100000)*100000;if(amount>=1000000){const security=investLiquidity(state,{amount,kind:'sovereign',termDays:90},F);return {invested:amount,securityId:security.id};}}
    if(cash<floor&&num(bank.deposits)>0){const room=Math.max(0,num(bank.deposits)*.15-num(bank.wholesaleFunding)),amount=Math.min(room,Math.ceil((floor*1.3-cash)/100000)*100000);if(amount>=1000000){const facility=raiseWholesaleFunding(state,{amount,termDays:180},F);return {wholesale:amount,facilityId:facility.id};}}
    return null;
  }
  // A defaulted loan (stage 3) waits for the player's decision. Restructure once: back to watch (stage 2) with a year
  // more and one point more interest. Or write it off: the collateral recovers (1 - LGD) of the balance in cash; the
  // loss is taken from the provisions held, and any loss beyond them is today's credit-loss expense at the next close.
  function nonPerformingLoans(state){return (state.bank?.loanPortfolios||[]).filter(row=>row&&row.stage===3&&row.status==='متعثرة'&&num(row.outstanding)>0);}
  function resolveNpl(state,p,F){
    const bank=ensure(state),loan=bank.loanPortfolios.find(row=>row.id===String(p.loanId||''));if(!loan||loan.stage!==3||loan.status!=='متعثرة'||num(loan.outstanding)<=0)throw new Error('bank-npl-not-found');
    const day=Math.floor(now(state)/86400),outstanding=num(loan.outstanding);
    if(p.action==='restructure'){
      if(loan.restructured)throw new Error('bank-npl-already-restructured');
      loan.stage=2;loan.status='مراقبة';loan.daysPastDue=30;loan.restructured=true;loan.restructuredDay=day;loan.rate=Number((num(loan.rate)+.01).toFixed(4));loan.termDays=Math.max(1,Math.floor(Number(loan.termDays)||0))+365;loan.remainingDays=Math.max(0,Math.floor(Number(loan.remainingDays)||0))+365;
      bank.recoveries.unshift({id:`NPL-${loan.id}-${day}`,loanId:loan.id,day,action:'restructure',outstanding});bank.recoveries=bank.recoveries.slice(0,100);reconcilePrudential(state);return {loanId:loan.id,action:'restructure',outstanding,rate:loan.rate};
    }
    if(p.action!=='write-off')throw new Error('bank-npl-action-invalid');
    const recovery=Math.round(outstanding*(1-Math.min(1,num(loan.lgd||.35)))),loss=outstanding-recovery,fromProvisions=Math.min(num(bank.provisions),loss),shortfall=loss-fromProvisions,account=F.book(state,'bank').accounts[0];
    if(recovery>0){account.balance+=recovery;F.journal(state,'bank',`استرداد ضمان قرض متعثر · ${loan.id}`,[{account:account.id,debit:recovery},{account:'محفظة القروض',credit:recovery}],`NPL-RECOVERY-${loan.id}`);}
    bank.provisions=num(bank.provisions)-fromProvisions;bank.pendingWriteOffLoss=num(bank.pendingWriteOffLoss)+shortfall;bank.loans=Math.max(0,num(bank.loans)-outstanding);
    const branch=bank.branchNetwork.find(row=>row.id===loan.branchId);if(branch)branch.loans=Math.max(0,num(branch.loans)-outstanding);
    loan.outstanding=0;loan.status='مشطوبة';loan.writtenOffDay=day;loan.recovery=recovery;loan.writeOffLoss=loss;
    bank.recoveries.unshift({id:`NPL-${loan.id}-${day}`,loanId:loan.id,day,action:'write-off',outstanding,recovery,loss,fromProvisions,shortfall});bank.recoveries=bank.recoveries.slice(0,100);
    const nplAmount=bank.loanPortfolios.filter(row=>row.stage===3&&row.status==='متعثرة').reduce((sum,row)=>sum+num(row.outstanding),0);bank.npl=bank.loans?nplAmount/bank.loans*100:0;
    F.reconcile(state);reconcilePrudential(state);return {loanId:loan.id,action:'write-off',outstanding,recovery,loss,shortfall};
  }
  // Build 377: a branch's fees and what its new customers deposit follow its country's income (bankFees, bankDeposits;
  // Riyadh = 1). Loans keep their own amounts: borrowers ask for them one by one.
  function incomeFactor(country,sector){const B=globalThis.GH_CUSTOMER_BASE,value=typeof B?.incomeFactor==='function'?Number(B.incomeFactor(country,sector)):1;return Number.isFinite(value)&&value>0?value:1;}
  function branchServiceRevenue(branch,prices=1){
    const enabled=new Set(branch.services||[]),r=num(branch.retailCustomers),b=num(branch.businessCustomers),out={accounts:0,payments:0,cards:0,merchant:0,cashManagement:0,fx:0,tradeFinance:0,retailFinance:0,businessFinance:0,projectFinance:0};
    if(enabled.has('حسابات وودائع'))out.accounts=r*.35+b*2;
    if(enabled.has('تحويلات ومدفوعات'))out.payments=r*.25+b*3;
    if(enabled.has('بطاقات'))out.cards=r*.45+b*1;
    if(enabled.has('قبول التجار ونقاط البيع'))out.merchant=r*.04+b*3;
    if(enabled.has('إدارة نقد الشركات'))out.cashManagement=b*4.5;
    if(enabled.has('صرف العملات'))out.fx=r*.08+b*2;
    if(enabled.has('تجارة دولية'))out.tradeFinance=b*5;
    if(enabled.has('تمويل أفراد'))out.retailFinance=r*.12;
    if(enabled.has('تمويل شركات'))out.businessFinance=b*4;
    if(enabled.has('تمويل مشاريع'))out.projectFinance=b*3;
    const local=incomeFactor(branch.country,'bankFees')*(Number(prices)>0?Number(prices):1);for(const key of Object.keys(out))out[key]=Math.round(out[key]*local);
    return out;
  }
  function sumRevenueBreakdown(out,row){for(const key of Object.keys(out))out[key]+=num(row[key]);return out;}
  function operatingCosts(state,bank=ensure(state)){
    const core=globalThis.GH_FACILITY_CORE;
    if(!core?.dailyOperatingCosts){
      if([...(state.globalBases||[]),...(state.customHubs||[])].some(row=>row?.owned===true&&facilityOwnerCompanyId(row)==='bank'))throw new Error('facility-daily-cost-owner-missing');
      const serviceOpex=bank.branchNetwork.filter(row=>row.servicesActive).length*BRANCH_SERVICE_OPEX;
      return {serviceOpex,facilityOpex:0,opex:serviceOpex,byFacility:Object.create(null)};
    }
    const costs=core.dailyOperatingCosts(state),serviceOpex=bank.branchNetwork.filter(row=>row.servicesActive).length*BRANCH_SERVICE_OPEX,facilityOpex=num(costs.byCompany.bank);
    return {serviceOpex,facilityOpex,opex:serviceOpex+facilityOpex,byFacility:costs.byFacility};
  }
  function* tickDayStages(state,p,F=globalThis.GH_FINANCE_CORE){
    const bank=ensure(state),day=Math.max(0,Math.floor(Number(p.day)||Math.floor(now(state)/86400)));if(bank.lastProcessedDay===day)return bank.dailyHistory.find(row=>row.day===day)||{day,idempotent:true};
    let newDeposits=0,newRetail=0,newBusiness=0,serviceFees=0,principalRepaid=0,corporatePrincipalRepaid=0,corporateInterestIncome=0,corporateOverdue=0,securitiesMatured=0,wholesalePrincipalRepaid=0,wholesaleOverdue=0,expired=0,interestIncome=0,customerContractInterestIncome=0,depositInterestExpense=0,creditLossExpense=0,securityIncome=0,reserveIncome=0,wholesaleInterestExpense=0,revenueBreakdown={accounts:0,payments:0,cards:0,merchant:0,cashManagement:0,fx:0,tradeFinance:0,retailFinance:0,businessFinance:0,projectFinance:0};
    let lostRetailTotal=0,lostBusinessTotal=0,withdrawn=0;const withdrawalRequests=[];
    const prices=typeof globalThis.GH_CUSTOMER_BASE?.priceIndex==='function'?globalThis.GH_CUSTOMER_BASE.priceIndex(state):1,marketRate=marketBaseRate(state)*.7,depositRates=num(pricing(state,bank).savings)+num(pricing(state,bank).term)*.65,pricingBoost=clamp((depositRates-marketRate)*9,-.25,.35);
    // Build 377: a branch's savers compare the bank's deposit rates with their country's rival bank (customer-base-core
    // rivalPrice: a rival paying up to 6% more or less than the market).
    // Build 377: customers of the group's other companies in the branch's country open accounts more readily
    // (customer-base-core affinityBoost, at most +15%).
    const groupReach=(country,pool)=>{const B=globalThis.GH_CUSTOMER_BASE;return typeof B?.affinityBoost==='function'?B.affinityBoost(state,country,'bank',pool):1;};
    const boostFor=country=>{const B=globalThis.GH_CUSTOMER_BASE,rival=typeof B?.rivalPrice==='function'?B.rivalPrice(country,'bank',day):1;return clamp((depositRates-marketRate*rival)*9,-.25,.35);};
    const bankNewByCountry=new Map(),activeBranches=[],activeBranchPeers=new Map(),branchById=new Map(),service=typeof globalThis.GH_CUSTOMER_BASE?.serviceEffects==='function'?globalThis.GH_CUSTOMER_BASE.serviceEffects(bank.satisfaction):{churn:1,demand:1};
    for(const branch of bank.branchNetwork){if(!branchById.has(branch.id))branchById.set(branch.id,branch);if(branch.servicesActive){activeBranches.push(branch);activeBranchPeers.set(branch.country,(activeBranchPeers.get(branch.country)||0)+1);}}
    for(const branch of activeBranches){
      if(Number(branch.lastProcessedDay)>=day)continue;const market=branchMarket(bank,branch,Math.max(1,activeBranchPeers.get(branch.country)||0)),retailRoom=clamp(1-num(branch.retailCustomers)/market.retailCapacity,0,1),businessRoom=clamp(1-num(branch.businessCustomers)/market.businessCapacity,0,1);
      const campaign=Number(branch.campaignUntil)>day,churnFactor=campaign?CAMPAIGN_CHURN:1,growthFactor=campaign?CAMPAIGN_GROWTH:1,pricingBoost=boostFor(branch.country);
      const retailChurn=clamp(BASE_RETAIL_CHURN*(1-pricingBoost),.03,.12)*churnFactor*service.churn/365,businessChurn=clamp(BASE_BUSINESS_CHURN*(1-pricingBoost*.6),.02,.08)*churnFactor*service.churn/365,lostRetail=Math.min(num(branch.retailCustomers),roundDraw(num(branch.retailCustomers)*retailChurn,`${branch.id}:${day}:retail-churn`)),lostBusiness=Math.min(num(branch.businessCustomers),roundDraw(num(branch.businessCustomers)*businessChurn,`${branch.id}:${day}:business-churn`)),weight=num(branch.retailCustomers)+num(branch.businessCustomers)*8,leavingShare=weight>0?(lostRetail+lostBusiness*8)/weight:0;
      if(lostRetail||lostBusiness){branch.retailCustomers-=lostRetail;branch.businessCustomers-=lostBusiness;lostRetailTotal+=lostRetail;lostBusinessTotal+=lostBusiness;const leaving=num(branch.deposits)*leavingShare;if(leaving>0)withdrawalRequests.push({branch,amount:leaving});}
      const retail=Math.round(deterministic(`${branch.id}:${day}:retail`,18,65)*(1+pricingBoost)*growthFactor*service.demand*groupReach(branch.country,'households')*retailRoom),business=Math.round(deterministic(`${branch.id}:${day}:business`,1,7)*(1+pricingBoost*.6)*growthFactor*service.demand*groupReach(branch.country,'businesses')*businessRoom),deposits=Math.round((retail*deterministic(`${branch.id}:${day}:rdep`,9000,26000)+business*deterministic(`${branch.id}:${day}:bdep`,180000,720000))*incomeFactor(branch.country,'bankDeposits')*prices);
      branch.retailCustomers+=retail;branch.businessCustomers+=business;branch.today={day,newRetail:retail,newBusiness:business,lostRetail,lostBusiness,withdrawn:0};branch.deposits+=deposits;branch.depositMix.sight+=deposits*.45;branch.depositMix.savings+=deposits*.35;branch.depositMix.term+=deposits*.20;branch.lastProcessedDay=day;newRetail+=retail;newBusiness+=business;if(retail||business){const row=bankNewByCountry.get(branch.country)||{households:0,businesses:0};row.households+=retail;row.businesses+=business;bankNewByCountry.set(branch.country,row);}newDeposits+=deposits;const branchRevenue=branchServiceRevenue(branch,prices),branchServiceFees=Object.values(branchRevenue).reduce((a,v)=>a+num(v),0);branch._dailyFeeBreakdown=branchRevenue;serviceFees+=branchServiceFees;sumRevenueBreakdown(revenueBreakdown,branchRevenue);
    }
    if(newDeposits>0){const account=F.book(state,'bank').accounts[0];account.balance+=newDeposits;F.journal(state,'bank',`ودائع عملاء جديدة · يوم ${day}`,[{account:account.id,debit:newDeposits},{account:'ودائع العملاء',credit:newDeposits}],`DEP-${day}`);bank.deposits+=newDeposits;}
    // Leaving customers withdraw their deposits; a withdrawal is paid from the bank's cash and never beyond it.
    const requested=withdrawalRequests.reduce((sum,row)=>sum+row.amount,0),Base=globalThis.GH_CUSTOMER_BASE;
    // Build 378: a withdrawal the bank cannot pay is a service failure (customer-base-core satisfactionStep).
    if(typeof Base?.satisfactionStep==='function'){const account=F.book(state,'bank').accounts[0],payable=Math.min(requested,num(bank.deposits),Math.max(0,num(account.balance)));bank.satisfaction=Base.satisfactionStep(bank.satisfaction,requested>0?Base.SERVICE_NORMAL*payable/requested:Base.SERVICE_NORMAL);}if(requested>0){const account=F.book(state,'bank').accounts[0],paid=Math.min(requested,num(bank.deposits),Math.max(0,num(account.balance)));if(paid>0){const scale=paid/requested;for(const row of withdrawalRequests){const amount=row.amount*scale,before=num(row.branch.deposits);if(row.branch.today?.day===day)row.branch.today.withdrawn=amount;row.branch.deposits=Math.max(0,before-amount);if(before>0)for(const key of Object.keys(DEPOSIT_PRODUCTS))row.branch.depositMix[key]=num(row.branch.depositMix[key])*(row.branch.deposits/before);}account.balance-=paid;F.journal(state,'bank',`سحب ودائع عملاء مغادرين · يوم ${day}`,[{account:'ودائع العملاء',debit:paid},{account:account.id,credit:paid}],`DEP-OUT-${day}`);bank.deposits=Math.max(0,num(bank.deposits)-paid);withdrawn=paid;}bank.unpaidWithdrawals=Math.max(0,requested-paid);}
    const mix=depositMix(bank);depositInterestExpense=(mix.sight*num(pricing(state,bank).sight)+mix.savings*num(pricing(state,bank).savings)+mix.term*num(pricing(state,bank).term))/365;
    // Build 377: the deposit insurance scheme's premium (0.1% of deposits a year) is a cost of the deposits.
    const depositInsurance=num(bank.deposits)*DEPOSIT_INSURANCE_PREMIUM/365;depositInterestExpense+=depositInsurance;bank.depositInsuranceYTD=num(bank.depositInsuranceYTD)+depositInsurance;
    for(const portfolio of bank.loanPortfolios.filter(row=>row.status==='نشطة'||row.status==='مراقبة'||row.status==='متعثرة')){
      const portfolioInterest=num(portfolio.outstanding)*num(portfolio.rate)/365;interestIncome+=portfolioInterest;if(portfolio.repaymentModel==='monthly-customer-contract')customerContractInterestIncome+=portfolioInterest;const defaultRoll=deterministic(`${portfolio.id}:${day}:credit`,0,1),dailyPd=num(portfolio.pd||RISK_GRADES.BBB.pd)/365;
      if(defaultRoll<dailyPd&&portfolio.stage<3){portfolio.stage=portfolio.stage===1?2:3;portfolio.daysPastDue=portfolio.stage===2?30:90;portfolio.status=portfolio.stage===3?'متعثرة':'مراقبة';bank.delinquencyEvents.unshift({id:`DLQ-${portfolio.id}-${day}`,loanId:portfolio.id,day,stage:portfolio.stage,outstanding:num(portfolio.outstanding)});}
      const loss=num(portfolio.outstanding)*num(portfolio.pd||RISK_GRADES.BBB.pd)*num(portfolio.lgd||.35)/365*(portfolio.stage===3?3:portfolio.stage===2?1.8:1);creditLossExpense+=loss;if(portfolio.stage===3)continue;
      if(portfolio.repaymentModel!=='monthly-customer-contract'){const due=Math.min(num(portfolio.outstanding),num(portfolio.principal)/Math.max(1,Number(portfolio.termDays)||1));if(due>0){portfolio.outstanding=Math.max(0,num(portfolio.outstanding)-due);portfolio.remainingDays=Math.max(0,Number(portfolio.remainingDays)-1);principalRepaid+=due;const branch=branchById.get(portfolio.branchId);if(branch)branch.loans=Math.max(0,num(branch.loans)-due);if(portfolio.outstanding<=.01)portfolio.status='مسددة';}}
    }
    if(principalRepaid>0){const account=F.book(state,'bank').accounts[0];account.balance+=principalRepaid;F.journal(state,'bank',`تحصيل أصول قروض · يوم ${day}`,[{account:account.id,debit:principalRepaid},{account:'محفظة القروض',credit:principalRepaid}],`LOAN-PRINCIPAL-${day}`);bank.loans=Math.max(0,bank.loans-principalRepaid);}
    const customerBatch=yield* collectCustomerInstallmentStages(state,{throughDay:day,periodId:Math.floor(day/30),includeOverdue:true,batchId:`BANK-AUTO-COLLECT-${day}`});principalRepaid+=num(customerBatch.principalPaid);
    for(const facility of bank.corporateFacilities.filter(row=>row.status==='ساري'||row.status==='متأخر')){
      if(Number(facility.lastProcessedDay)>=day)continue;const company=String(facility.ownerCompanyId||facility.company||'').trim();if(!isOperationalFinanceCompany(state,company,F))throw new Error(`bank-facility-company-invalid:${company||'missing'}`);const client=bank.corporateClients[company],outstanding=num(facility.outstanding);if(!client)throw new Error(`bank-client-not-synced:${company}`);if(outstanding<=.01){facility.outstanding=0;facility.status='مسدد';continue;}
      const dailyInterest=outstanding*num(facility.rate)/365,principalDue=Math.min(outstanding,num(facility.originalAmount)/Math.max(1,Number(facility.termDays)||1)+num(facility.principalArrears)),interestDue=dailyInterest+num(facility.interestArrears),totalDue=principalDue+interestDue,borrowerCash=F.operating(state,company);
      if(totalDue>0&&borrowerCash+1e-8>=totalDue){if(principalDue>0){F.execute({state},'transfer',{from:company,to:'bank',amount:principalDue,note:`سداد أصل تسهيل ائتماني · ${facility.id}`,ref:`CF-PRINCIPAL-${facility.id}-${day}`});F.book(state,company).debt=Math.max(0,num(F.book(state,company).debt)-principalDue);facility.outstanding=Math.max(0,outstanding-principalDue);client.drawn=Math.max(0,num(client.drawn)-principalDue);bank.loans=Math.max(0,num(bank.loans)-principalDue);corporatePrincipalRepaid+=principalDue;}if(interestDue>0){const settlement=F.execute({state},'settle-intercompany-interest',{from:company,to:'bank',amount:interestDue,note:`فائدة تسهيل ائتماني · ${facility.id}`,ref:`CF-INTEREST-${facility.id}-${day}`});corporateInterestIncome+=num(settlement.cashPostedRevenue);}facility.principalArrears=0;facility.interestArrears=0;facility.status=facility.outstanding<=.01?'مسدد':'ساري';if(facility.status==='مسدد')facility.repaidDay=day;}else{facility.principalArrears=principalDue;facility.interestArrears=interestDue;facility.status='متأخر';facility.overdueSinceDay=Number(facility.overdueSinceDay)||day;facility.daysPastDue=Math.max(1,day-facility.overdueSinceDay+1);corporateOverdue+=totalDue;}facility.lastProcessedDay=day;facility.remainingDays=Math.max(0,Number(facility.maturityDay)-day);
    }
    interestIncome+=corporateInterestIncome;principalRepaid+=corporatePrincipalRepaid;
    const bankAccount=F.book(state,'bank').accounts[0];
    // Positive operating cash is held as remunerated central-bank/overnight liquidity. Previously it earned nothing on a
    // normal bank close, so even a prudently capitalised new bank was structurally loss-making until the player approved loans.
    // Build 377: the required reserve (5% of deposits) is held at the central bank and earns nothing; the cash above it
    // earns the overnight rate as before.
    reserveIncome=Math.max(0,num(bankAccount.balance)-num(bank.deposits)*RESERVE_REQUIREMENT)*Math.max(0,marketBaseRate(state))*RESERVE_YIELD_SHARE/365;securityIncome+=reserveIncome;
    for(const security of bank.treasurySecurities.filter(row=>row.status==='ساري')){
      securityIncome+=num(security.amount)*num(security.yieldRate)/365;
      if(day<Number(security.maturityDay))continue;
      const principal=num(security.amount);if(principal>0){bankAccount.balance+=principal;F.journal(state,'bank',`استرداد أصل ورقة مالية · ${security.id}`,[{account:bankAccount.id,debit:principal},{account:'أوراق مالية عالية السيولة',credit:principal}],`MATURITY-${security.id}`);securitiesMatured+=principal;}
      security.status='مستردة';security.maturedDay=day;security.redemptionAmount=principal;
    }
    for(const facility of bank.wholesaleFacilities.filter(row=>row.status==='ساري'||row.status==='متأخر')){
      const outstanding=num(facility.outstanding);if(outstanding<=0){facility.status='مسدد';continue;}
      wholesaleInterestExpense+=outstanding*num(facility.rate)/365;if(day<Number(facility.maturityDay))continue;
      if(num(bankAccount.balance)+1e-8>=outstanding){bankAccount.balance-=outstanding;F.journal(state,'bank',`سداد أصل تمويل جملة · ${facility.id}`,[{account:'تمويل جملة مستحق',debit:outstanding},{account:bankAccount.id,credit:outstanding}],`REPAY-${facility.id}`);facility.outstanding=0;facility.status='مسدد';facility.repaidDay=day;wholesalePrincipalRepaid+=outstanding;bank.wholesaleFunding=Math.max(0,num(bank.wholesaleFunding)-outstanding);}
      else{facility.status='متأخر';facility.overdueSinceDay=Number(facility.overdueSinceDay)||day;facility.daysPastDue=Math.max(1,day-facility.overdueSinceDay+1);wholesaleOverdue+=outstanding;}
    }
    for(const instrument of [...bank.lettersOfCredit,...bank.guarantees])if(instrument.status==='ساري'&&Number(instrument.expiryDay||Infinity)<=day){instrument.status='منتهي';instrument.expiredDay=day;expired++;}
    const writeOffShortfall=num(bank.pendingWriteOffLoss);if(writeOffShortfall>0){creditLossExpense+=writeOffShortfall;bank.pendingWriteOffLoss=0;}
    bank.retailCustomers=bank.branchNetwork.reduce((sum,row)=>sum+num(row.retailCustomers),0);bank.businessCustomers=bank.branchNetwork.reduce((sum,row)=>sum+num(row.businessCustomers),0);bank.dailyServiceFeeRevenue=serviceFees;bank.lastProcessedDay=day;bank.interestIncomeYTD+=interestIncome+securityIncome;bank.depositInterestExpenseYTD+=depositInterestExpense+wholesaleInterestExpense;bank.creditLossExpenseYTD+=creditLossExpense;bank.provisions+=creditLossExpense-writeOffShortfall;bank.feeIncomeYTD+=serviceFees;for(const [key,value] of Object.entries(revenueBreakdown))bank.revenueYTD[key]=num(bank.revenueYTD[key])+num(value);bank.revenueYTD.treasury=num(bank.revenueYTD.treasury)+num(securityIncome);
    // Repaid portfolios carry no balance; the daily pass and the save keep the last 100 and fold older ones into a summary
    // (count and principal), so a long game does not walk an ever-growing list (nothing looks a portfolio up by id).
    {const repaid=bank.loanPortfolios.filter(row=>row.status==='مسددة');if(repaid.length>100){const drop=new Set(repaid.slice(100));const archive=bank.repaidLoanArchive=bank.repaidLoanArchive&&typeof bank.repaidLoanArchive==='object'?bank.repaidLoanArchive:{count:0,principal:0,fees:0};for(const row of drop){archive.count++;archive.principal+=num(row.principal);archive.fees+=num(row.originationFee);}bank.loanPortfolios=bank.loanPortfolios.filter(row=>!drop.has(row));}}
    for(const request of [...bank.loanRequests])if(day>=Number(request.expiresDay)){closeLoanRequest(bank,request,'منتهي',{decidedDay:day});notifyCustomerLoanDecision(state,request,'expired','bank-loan-request-expired');}
    const autoTreasury=autoLiquidity(state,bank,F);
    const newRequest=generateLoanRequest(state,bank,day);
    const nplAmount=bank.loanPortfolios.filter(row=>row.stage===3&&row.status!=='مسددة').reduce((sum,row)=>sum+num(row.outstanding),0);bank.npl=bank.loans?nplAmount/bank.loans*100:0;const costSnapshot=operatingCosts(state,bank),serviceOpex=costSnapshot.serviceOpex,facilityOpex=costSnapshot.facilityOpex,opex=costSnapshot.opex,feeIncome=serviceFees,transactionFeeIncome=num(bank.transactionFeeByDay?.[String(day)]),reportedFeeIncome=feeIncome+transactionFeeIncome,netBankingIncome=interestIncome+securityIncome+reportedFeeIncome-depositInterestExpense-wholesaleInterestExpense-creditLossExpense-opex;bank.netBankingIncomeYTD+=netBankingIncome;
    for(const branch of bank.branchNetwork){const loanShare=bank.loans?num(branch.loans)/bank.loans:1/Math.max(1,bank.branchNetwork.length),depositShare=bank.deposits?num(branch.deposits)/bank.deposits:1/Math.max(1,bank.branchNetwork.length),branchInterest=interestIncome*loanShare,branchFees=feeIncome*(num(branch.retailCustomers)+num(branch.businessCustomers)*8)/Math.max(1,bank.retailCustomers+bank.businessCustomers*8),branchExpense=depositInterestExpense*depositShare,branchLoss=creditLossExpense*loanShare,branchServiceOpex=branch.servicesActive?BRANCH_SERVICE_OPEX:0,facilityCost=costSnapshot.byFacility[branch.facilityId],branchFacilityOpex=facilityCost?.ownerCompanyId==='bank'?num(facilityCost.amount):0,branchOpex=branchServiceOpex+branchFacilityOpex;const ownBreakdown=branch._dailyFeeBreakdown||branchServiceRevenue(branch,prices),ownFees=Object.values(ownBreakdown).reduce((a,v)=>a+num(v),0);branch.incomeStatement={interestIncome:branchInterest,feeIncome:ownFees,feeBreakdown:{...ownBreakdown},interestExpense:branchExpense,creditLossExpense:branchLoss,opex:branchOpex,serviceOpex:branchServiceOpex,facilityOpex:branchFacilityOpex,net:branchInterest+ownFees-branchExpense-branchLoss-branchOpex};delete branch._dailyFeeBreakdown;}
    const customerInterestPaid=num(customerBatch.interestPaid),cashPostedInterestIncome=corporateInterestIncome+customerInterestPaid,unpostedInterestIncome=Math.max(0,interestIncome-corporateInterestIncome-customerContractInterestIncome);
    F.reconcile(state);reconcilePrudential(state);
    // Build 378: the day's new customers are offered the group insurer's cover at the counter (insurance-core addPoliciesFromBank).
    let groupInsured=0;const insurer=globalThis.GH_INSURANCE_CORE;if(typeof insurer?.addPoliciesFromBank==='function')for(const [country,row] of bankNewByCountry){const joined=insurer.addPoliciesFromBank(state,{country,day,households:row.households,businesses:row.businesses});groupInsured+=num(joined.property)+num(joined.commercial);}
    const report={day,autoTreasury,groupInsured,newLoanRequest:newRequest?.id||null,newDeposits,newRetail,newBusiness,lostRetail:lostRetailTotal,lostBusiness:lostBusinessTotal,depositWithdrawals:withdrawn,serviceFees,feeIncome,transactionFeeIncome,reportedFeeIncome,revenueBreakdown:{...revenueBreakdown},principalRepaid,corporatePrincipalRepaid,customerInstallmentsDue:customerBatch.due,customerInstallmentsPaid:customerBatch.paid,customerInstallmentsMissed:customerBatch.missed,customerInstallmentPrincipalPaid:customerBatch.principalPaid,customerInstallmentInterestPaid:customerInterestPaid,corporateInterestIncome,customerContractInterestIncome,cashPostedInterestIncome,unpostedInterestIncome,corporateOverdue,securitiesMatured,wholesalePrincipalRepaid,wholesaleOverdue,expired,customers:bank.retailCustomers+bank.businessCustomers,interestIncome,securityIncome,reserveIncome,depositInterestExpense,wholesaleInterestExpense,creditLossExpense,opex,serviceOpex,facilityOpex,netBankingIncome,lcr:bank.lcr,nsfr:bank.nsfr,cet1:bank.cet1,npl:bank.npl};bank.dailyHistory.unshift(report);bank.dailyHistory=bank.dailyHistory.slice(0,400);return clone(report);
  }
  function tickDay(state,p,F){return drainBankStages(tickDayStages(state,p,F));}
  // Called only through the existing company operations provider. Keep the
  // domain command inside the caller's atomic time/day boundary transaction.
  function onFinancialDay(ctx,p={}){
    const platform=globalThis.GH_COMPANY_PLATFORM,commands=globalThis.GH_DOMAIN_COMMANDS;
    if(!platform?.requireCompany||!commands?.dispatchSystem)throw new Error('company-daily-owner-unavailable');
    const company=platform.requireCompany(ctx.state,ctx.companyId,{registered:true,operational:true,capability:'operations.bank'});
    return commands.dispatchSystem({state:ctx.state},'banking','tick-day',{...p,ownerCompanyId:company.id},{actor:'simulation-scheduler'}).result;
  }
  function* onFinancialDayStages(ctx,p={}){
    const platform=companyPlatform(),commands=globalThis.GH_DOMAIN_COMMANDS;if(!platform?.requireCompany||!commands?.dispatchSystem)throw new Error('company-daily-owner-unavailable');
    const company=platform.requireCompany(ctx.state,ctx.companyId,{registered:true,operational:true,capability:'operations.bank'});
    if(!globalThis.GH_TRANSACTION_CORE?.isActive?.())return onFinancialDay(ctx,p);
    if(typeof commands.dispatchSystemStages!=='function')throw new Error('company-daily-staged-owner-unavailable');
    const result=yield* commands.dispatchSystemStages({state:ctx.state},'banking','tick-day',{...p,ownerCompanyId:company.id},{actor:'simulation-scheduler'});return result.result;
  }
  function* executeStages(ctx,cmd,p={}){
    if(cmd!=='tick-day')throw new Error('bank-staged-command-invalid');const state=ctx.state||ctx;
    companyPlatform().requireCompany(state,String(p.ownerCompanyId||'bank'),{registered:true,operational:true,capability:'operations.bank'});
    return yield* tickDayStages(state,p);
  }
  function statementAdjustments(state,companyId){
    const bank=ensure(state),id=String(companyId||'');
    if(id==='bank'){
      const securities=bank.treasurySecurities.filter(row=>row.status==='ساري').reduce((sum,row)=>sum+num(row.amount),0);
      return {assets:num(bank.loans)+securities,liabilities:num(bank.deposits)+num(bank.wholesaleFunding),bankLoans:num(bank.loans),bankSecurities:securities,customerDeposits:num(bank.deposits),wholesaleFunding:num(bank.wholesaleFunding)};
    }
    const client=bank.corporateClients?.[id],depositAsset=client?num(client.depositBalance):0;
    return {assets:depositAsset,liabilities:0,bankDepositAsset:depositAsset};
  }
  function intercompanyBalanceEliminations(state){
    const bank=ensure(state),depositBalances=Object.values(bank.corporateClients||{}).reduce((sum,row)=>sum+num(row?.depositBalance),0),corporateLoans=(bank.corporateFacilities||[]).filter(row=>row.status!=='مسدد').reduce((sum,row)=>sum+num(row.outstanding),0);
    return {assets:depositBalances+corporateLoans,liabilities:depositBalances+corporateLoans,deposits:depositBalances,loans:corporateLoans};
  }
  function execute(ctx,cmd,p={}){
    const state=ctx.state||ctx,F=globalThis.GH_FINANCE_CORE,bank=ensure(state);if(!F)throw new Error('finance-core-missing');
    if(cmd==='acquire-operating')return globalThis.GH_OPERATING_ACQUISITIONS.acquire(state,'bank',p);if(cmd==='acquire-operating-batch')return globalThis.GH_OPERATING_ACQUISITIONS.acquireBatch(state,'bank',p);
    if(cmd==='sync-corporate-clients')return syncCorporateClients(state,p,F);
    if(cmd==='set-deposit-pricing')return setDepositPricing(state,p);
    if(cmd==='set-risk-policy')return setRiskPolicy(state,p);
    if(cmd==='set-risk-preset')return setRiskPreset(state,p);
    if(cmd==='set-auto-liquidity')return setAutoLiquidity(state,p);
    if(cmd==='resolve-npl')return resolveNpl(state,p,F);
    if(cmd==='raise-wholesale-funding')return raiseWholesaleFunding(state,p,F);
    if(cmd==='invest-liquidity')return investLiquidity(state,p,F);
    if(cmd==='review-limits'){const collateral=reviewCollateralByOwner(ctx,state);if(!corporateClientsCurrent(state))syncCorporateClients(state,{},F);for(const client of Object.values(bank.corporateClients)){const type=String(client.ownerCompanyId||client.company||'');if(!isOperationalFinanceCompany(state,type,F))continue;const assets=collateral.get(type),cash=F.total(state,type),book=F.book(state,type),debt=num(book?.debt),base=Math.max(5000000,cash*.35+assets*.12-debt*.08);if(!book)throw new Error(`bank-client-finance-book-missing:${type}`);client.ownerCompanyId=type;client.creditLimit=Math.max(5000000,Math.round(base/100000)*100000);client.lastReview=now(state);client.rating=debt>cash*2?'BB':cash>debt?'A-':'BBB';}bank.riskReviews.unshift({at:now(state),type:'corporate-limits',clients:Object.keys(bank.corporateClients).length,collateralSource:collateral.source});bank.riskReviews=bank.riskReviews.slice(0,80);return true;}
    if(cmd==='draw-facility'){const type=String(p.ownerCompanyId||p.company||'').trim();if(!isOperationalFinanceCompany(state,type,F)||companyPlatform()?.hasCapability?.(state,type,'operations.bank'))throw new Error('invalid-company');const clients=corporateClientView(state),riskState=clients===bank.corporateClients?state:{...state,bank:{...bank,corporateClients:clients}};const client=clients[type];if(!client)throw new Error('bank-client-not-synced');const amount=Math.min(num(p.amount),Math.max(0,num(client.creditLimit)-num(client.drawn)));if(amount<=0||F.operating(state,'bank')<amount)throw new Error('facility-unavailable');const fee=Math.max(25000,amount*.0035),termDays=Math.max(30,Math.floor(Number(p.termDays)||365)),rate=clamp(p.rate||.06,0,.30),startDay=Math.floor(now(state)/86400),id=`CF-${bank.sequence+1}`;if(F.operating(state,type)+amount<fee)throw new Error('borrower-fee-unavailable');const sector=String(client.sector||companyPlatform()?.definitionFor?.(state,type)?.classification?.primarySectorId||'').trim()||null;assertProjectedCredit(riskState,{cashDelta:fee-amount,loanDelta:amount,drawnDelta:amount,clientId:type,sector});if(clients!==bank.corporateClients)bank.corporateClients=clients;bank.sequence++;F.transferBankFacility(state,{from:'bank',to:type,amount,note:`سحب تسهيل ائتماني من بنك المجموعة · ${id}`,ref:id});F.execute({state},'settle-intercompany-service',{receiverInClose:true,from:type,to:'bank',amount:fee,note:`رسوم ترتيب تسهيل ائتماني · ${id}`,serviceCategory:'رسوم ترتيب تمويل مصرفي',taxCode:'financial-service-exempt',line:'other',ref:`FEE-${id}`,sourceRefs:[id]});client.drawn+=amount;bank.loans+=amount;bank.feeIncomeYTD+=fee;recordTransactionFee(bank,{id:`FEE-${id}`,at:now(state),day:startDay,amount:fee,category:'corporateFacility',sourceId:id});F.book(state,type).debt+=amount;const legal=F.execute({state},'register-commercial-contract',{id:`LEGAL-${id}`,company:'bank',contractType:'عقد تسهيل ائتماني داخلي',counterparty:client.name||type,title:`تسهيل ${id}`,startDay,endDay:startDay+termDays,amount,terms:{borrowerCompanyId:type,sector,rate,termDays,fee,creditLimit:client.creditLimit},sourceRefs:[id,`FEE-${id}`],linkedTransferReferences:[id,`FEE-${id}`]}),facility={id,company:type,ownerCompanyId:type,sector,amount,originalAmount:amount,outstanding:amount,principalArrears:0,interestArrears:0,rate,termDays,startDay,lastProcessedDay:startDay,maturityDay:startDay+termDays,remainingDays:termDays,status:'ساري',legalDocumentId:legal.id,documentProofId:legal.documentProofId,contentDigest:legal.contentDigest};bank.corporateFacilities.unshift(facility);reconcilePrudential(state);return amount;}
    if(cmd==='trade-instrument'){const type=String(p.ownerCompanyId||p.company||'').trim(),kind=p.kind==='lc'?'lc':'guarantee',amount=Math.max(100000,num(p.amount));if(!isOperationalFinanceCompany(state,type,F))throw new Error('credit-headroom');const clients=corporateClientView(state),riskState=clients===bank.corporateClients?state:{...state,bank:{...bank,corporateClients:clients}};const client=clients[type];if(!client||amount>Math.max(0,num(client.creditLimit)-num(client.drawn)))throw new Error('credit-headroom');const fee=Math.max(15000,Math.round(amount*(kind==='lc'?.006:.004))),feeSourceId=`${kind==='lc'?'LC':'GTEE'}-${Math.floor(now(state))}-${bank.lettersOfCredit.length+bank.guarantees.length+1}`;const sector=String(client.sector||companyPlatform()?.definitionFor?.(state,type)?.classification?.primarySectorId||'').trim()||null;assertProjectedCredit(riskState,{cashDelta:fee,offBalanceDelta:amount,sector});if(clients!==bank.corporateClients)bank.corporateClients=clients;F.execute({state},'settle-intercompany-service',{receiverInClose:true,from:type,to:'bank',amount:fee,note:kind==='lc'?`رسوم اعتماد مستندي · ${feeSourceId}`:`رسوم ضمان مصرفي · ${feeSourceId}`,serviceCategory:kind==='lc'?'رسوم اعتماد مستندي':'رسوم ضمان مصرفي',taxCode:'financial-service-exempt',line:'other',ref:`FEE-${feeSourceId}`,sourceRefs:[feeSourceId]});bank.feeIncomeYTD+=fee;recordTransactionFee(bank,{id:`FEE-${feeSourceId}`,at:now(state),day:Math.floor(now(state)/86400),amount:fee,category:'tradeFinance',sourceId:feeSourceId});bank.revenueYTD.tradeFinance=num(bank.revenueYTD.tradeFinance)+fee;bank.offBalance+=amount;const startDay=Math.floor(now(state)/86400),counterparty=String(p.counterparty||companyPlatform()?.resolveIdentity?.(state,type)?.legalName||state.companyRegistry?.[type]?.legalName||bank.corporateClients?.[type]?.name||'الجهة المستفيدة'),legal=F.execute({state},'register-commercial-contract',{id:`LEGAL-${feeSourceId}`,company:'bank',contractType:kind==='lc'?'اعتماد مستندي':'ضمان مصرفي',counterparty,title:`${kind==='lc'?'اعتماد':'ضمان'} ${feeSourceId}`,startDay,endDay:startDay+90,amount,terms:{applicantCompanyId:type,sector,fee,kind},sourceRefs:[feeSourceId],linkedTransferReferences:[`FEE-${feeSourceId}`]}),document={id:feeSourceId,company:type,ownerCompanyId:type,amount,fee,feeTransferReference:`FEE-${feeSourceId}`,status:'ساري',issuedAt:now(state),expiryDay:startDay+90,counterparty,legalDocumentId:legal.id,documentProofId:legal.documentProofId,contentDigest:legal.contentDigest};(kind==='lc'?bank.lettersOfCredit:bank.guarantees).unshift(document);reconcilePrudential(state);return document;}
    if(cmd==='cash-sweep'){let total=0;for(const type of corporateCompanyIds(state,F).filter(id=>id!=='group')){const client=bank.corporateClients[type];if(!client)throw new Error(`bank-client-not-synced:${type}`);const balance=F.operating(state,type),floor=Math.max(5000000,balance*.65),amount=Math.max(0,Math.floor((balance-floor)/100000)*100000);if(amount<500000)continue;F.execute({state},'transfer',{from:type,to:'bank',amount,note:'Cash sweep يومي إلى بنك المجموعة'});client.depositBalance+=amount;bank.deposits+=amount;total+=amount;}bank.cashSweeps.unshift({at:now(state),amount:total});bank.cashSweeps=bank.cashSweeps.slice(0,60);reconcilePrudential(state);return total;}
    if(cmd==='open-branch')return openBranch(state,p);
    if(cmd==='activate-market'){const branch=bank.branchNetwork.find(row=>row.id===p.branchId||row.facilityId===p.branchId);if(!branch)throw new Error('bank-branch-not-found');branch.servicesActive=true;branch.activatedAt=now(state);return clone(branch);}
    if(cmd==='set-branch-services'){const branch=bank.branchNetwork.find(row=>row.id===p.branchId||row.facilityId===p.branchId);if(!branch)throw new Error('bank-branch-not-found');if(p.servicesActive!==undefined)branch.servicesActive=p.servicesActive!==false;branch.services=[...ALL_BRANCH_SERVICES];branch.serviceModel='شامل';return clone(branch);}
    if(cmd==='originate-loan'||cmd==='issue-loans'||cmd==='fund-loan-portfolio')return originateLoan(state,{...p,product:p.product||'corporate'},F);
    if(cmd==='decide-loan-request')return decideLoanRequest(state,p,F);
    if(cmd==='submit-customer-loan-request')return submitCustomerLoanRequest(state,p);
    if(cmd==='approve-loan-requests-batch')return decideLoanRequestsBatch(state,p,F);
    if(cmd==='collect-customer-installments')return collectCustomerInstallments(state,p);
    if(cmd==='branch-campaign')return branchCampaign(state,p,F);
    if(cmd==='branch-campaigns')return branchCampaigns(state,p);
    if(cmd==='tick-day')return tickDay(state,p,F);
    throw new Error(`Unknown banking command: ${cmd}`);
  }
  const API={corporateClientView,corporateClientsCurrent,operatingAcquisitionPreview,CET1_DISTRIBUTION_FLOOR,distributableCash,originateMarketMortgage,RISK_PRESETS,riskPreset,liquidityFloor,nonPerformingLoans,campaignCost,campaignQuote,CAMPAIGN_DAYS,loanRequestQuote,customerFinancingQuote,customerDisbursementForSale,MAX_OPEN_REQUESTS,branchMarket,countryPopulation,VERSION,DAILY_FINANCIAL_ORDER:100,onFinancialDay,onFinancialDayStages,executeStages,tickDayStages,ALL_BRANCH_SERVICES,PRODUCTS,DEPOSIT_PRODUCTS,RISK_GRADES,DEPOSIT_STANCES,FUNDING_TERMS,LIQUIDITY,depositRates,loanRate,loanRateQuote,liquidityYield,wholesaleRate,ensure,migrateLegacyBranches,execute,reconcilePrudential,creditRiskPreview,dormant,operatingCosts,statementAdjustments,intercompanyBalanceEliminations};globalThis.GH_BANKING_CORE=API;globalThis.GH_DOMAIN_COMMANDS?.register?.('banking',API);if(globalThis.window&&window!==globalThis)window.GH_BANKING_CORE=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
