(()=>{
  'use strict';
  // Build 358 (owner request: an integrated real-estate company where the customer base and realism come first). The
  // company has no fleet: its sales and leasing offices (facilities of kind "realestate", one per capital from the world
  // directory) develop projects in their city and sell or lease the units to the people and businesses there.
  //
  // Customer base. A country's households are its population over 4.5; each year some of them move (6%), and the group
  // can win a share of them that depends on its price against the market. Businesses (one per 40 people) take offices,
  // shops and warehouses. Buyers and tenants arrive day by day for each project, more slowly as the price rises above
  // the market and as the project fills; leases end every year (15% at market rent, more above it) and the units go
  // back on the market.
  //
  // Development. A project is land plus construction in three milestones (40% at the start with the land, 30% at half
  // time, 30% at completion), each paid by cheque to the contractor as capital spending (the game's construction line).
  // Units of a project for sale can be sold off-plan at 5% below the price; their revenue and cost are recognised at
  // handover (completion), later sales on the day of sale. Units for lease earn their rent day by day once completed.
  //
  // Decisions. Which project, where and how big; sale or lease; the price or rent level (85% to 125% of the market);
  // corporate tenants who ask for a block of units at their rent and term (accept or decline).
  //
  // Accounts. Construction is paid by cheque at its milestones and booked then (as every construction contract in the
  // game). The day's revenue (sales handed over, rent) and expenses (property running costs, commissions) reach the
  // group's daily close through dailyResult(); the cost of the units sold is reported for the margin only, because
  // its cash and expense already left with the construction cheques. The offices' own running costs are their facility
  // costs (the company definition's site template), posted by the close. If the company cannot pay a milestone, the
  // project waits (one day later each day) instead of failing the close. Nothing here writes a document per unit or
  // tenant.
  //
  // Load. Units and tenants are counts per project, not records; at most 30 active projects, 5 open tenant requests,
  // history capped at 90 days (the screens read 30), 40 decisions kept. No per-frame work.
  const VERSION='3.0.0';
  const num=value=>Math.max(0,Number(value)||0),now=state=>Number(state.simSeconds)||0;
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value)||0));
  const clone=value=>globalThis.structuredClone?structuredClone(value):JSON.parse(JSON.stringify(value));
  function hash(text){let h=2166136261>>>0;for(const ch of String(text)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}return h>>>0;}
  function deterministic(seed,min,max){return min+(hash(seed)/4294967295)*(max-min);}
  const roundDraw=(value,seed)=>Math.floor(Math.max(0,value)+deterministic(seed,0,1));
  const TYPES=Object.freeze({
    residential:{name:'برج سكني',units:200,unitCost:180000,price:260000,rent:18000,days:540,buyers:'household',modes:['sale','lease']},
    villas:{name:'مجمع فلل',units:60,unitCost:420000,price:600000,rent:36000,days:420,buyers:'household',modes:['sale','lease']},
    office:{name:'برج مكاتب',units:80,unitCost:1200000,price:1800000,rent:140000,days:720,buyers:'business',modes:['lease','sale']},
    retail:{name:'مركز تجاري',units:120,unitCost:600000,price:900000,rent:70000,days:720,buyers:'business',modes:['lease']},
    logistics:{name:'مستودعات لوجستية',units:40,unitCost:900000,price:1300000,rent:85000,days:365,buyers:'business',modes:['lease','sale']}
  });
  const TYPE_IDS=Object.freeze(Object.keys(TYPES));
  const LAND_SHARE=.18,MILESTONES=Object.freeze([.4,.3,.3]),OFF_PLAN_DISCOUNT=.95,SALES_COMMISSION=.02,PROPERTY_OPEX=.012;
  // Build 378: an off-plan buyer pays 20% on signing and instalments with construction until 70% is paid; the rest at
  // handover. A later buyer pays the deposit and the instalments already due on the day of signing.
  const OFF_PLAN_DEPOSIT=.2,OFF_PLAN_PAID_AT_COMPLETION=.7;
  const HOUSEHOLD_SIZE=4.5,MOVE_RATE=.06,BUSINESS_PER_PEOPLE=40,DEFAULT_POPULATION=10000000,BASE_LEASE_CHURN=.15;
  const PRICE_LEVELS=Object.freeze([.85,.9,.95,1,1.05,1.1,1.15,1.25]),SIZE_LEVELS=Object.freeze([.5,1,1.5,2]);
  // Build 377: 60% of home buyers borrow 70% of the price; the group's bank lends to them where it has a branch
  // (one mortgage portfolio per country and month, banking-core originateMarketMortgage).
  const MORTGAGE_SHARE=.6,MORTGAGE_LTV=.7,MORTGAGE_PERIOD_DAYS=30;
  const MAX_ACTIVE_PROJECTS=30,MAX_OPEN_REQUESTS=5,MAX_INTERNAL_LEASES=120,REQUEST_DAYS=10,INTERNAL_RENT_SETTLE_DAYS=30,HISTORY=40,DAILY_HISTORY=90;
  function countryPopulation(country){const bank=globalThis.GH_BANKING_CORE;if(typeof bank?.countryPopulation==='function')return bank.countryPopulation(country);const row=(Array.isArray(globalThis.GH_MAP_LABELS)?globalThis.GH_MAP_LABELS:[]).find(item=>item?.name===String(country||'').trim());return Number(row?.population)>0?Number(row.population):DEFAULT_POPULATION;}
  function officeTemplate(p={}){return {id:String(p.id||''),facilityId:String(p.facilityId||''),city:String(p.city||'غير محدد'),country:String(p.country||'غير محدد'),openedAt:Number(p.openedAt)||0,active:p.active!==false,marketPopulation:Number(p.marketPopulation)>0?Number(p.marketPopulation):0,today:p.today&&typeof p.today==='object'?{...p.today}:null};}
  function ensure(state){
    const re=state.realEstate=state.realEstate&&typeof state.realEstate==='object'&&!Array.isArray(state.realEstate)?state.realEstate:{};
  for(const key of ['offices','projects','dailyHistory','tenantRequests','requestHistory','completedArchive','requestDecisionBatches'])re[key]=Array.isArray(re[key])?re[key].filter(Boolean):[];
    re.internalRentAccounts=re.internalRentAccounts&&typeof re.internalRentAccounts==='object'&&!Array.isArray(re.internalRentAccounts)?re.internalRentAccounts:{};
    re.sequence=Math.max(0,Math.floor(Number(re.sequence)||0));re.offices=re.offices.map(officeTemplate);syncOffices(state,re);
    re.ytd=re.ytd&&typeof re.ytd==='object'?re.ytd:{};for(const key of ['sales','rent','costOfSales','opex','commission','net','capex'])re.ytd[key]=Number(re.ytd[key])||0;
    re.lastProcessedDay=Number.isFinite(Number(re.lastProcessedDay))?Math.floor(Number(re.lastProcessedDay)):-1;return re;
  }
  function syncOffices(state,re){
    const facilities=[...(state.customHubs||[]),...(state.globalBases||[])].filter(row=>row?.owned===true&&row.kind==='realestate'&&String(row.ownerCompanyId||row.companyId||row.company||'')==='realestate');
    for(const facility of facilities)if(!re.offices.some(row=>row.facilityId===facility.id))re.offices.push(officeTemplate({id:`RE-OFF-${++re.sequence}`,facilityId:facility.id,city:facility.city,country:facility.country,openedAt:now(state)}));
    const owned=new Set(facilities.map(row=>row.id));for(const office of re.offices)if(!owned.has(office.facilityId))office.active=false;return re.offices;
  }
  // A country's yearly movers and businesses; the group's offices there share them.
  function officeMarket(re,office){
    if(!(Number(office.marketPopulation)>0))office.marketPopulation=countryPopulation(office.country);
    const peers=Math.max(1,re.offices.filter(row=>row.active&&row.country===office.country).length),households=num(office.marketPopulation)/HOUSEHOLD_SIZE;
    return {population:num(office.marketPopulation),households:Math.round(households),moversPerDay:households*MOVE_RATE/365/peers,businesses:Math.round(num(office.marketPopulation)/BUSINESS_PER_PEOPLE/peers)};
  }
  const priceFactor=level=>clamp(Math.pow(1/Math.max(.5,level),3),.3,2.2);
  // Daily arrivals of buyers or tenants for one project at the market price: they grow with the square root of the
  // market (a 200-unit tower in Riyadh sells in about 16 months, 60 villas in Manama in about 20), shaped by the price
  // level and by how full the project already is.
  // Build 377: demand is today's market for the project's mode (customer-base-core demandFactor: a dearer mortgage
  // means fewer buyers and a few more tenants; activity moves both).
  function arrivals(re,project,office,demand=1){
    const market=officeMarket(re,office),type=TYPES[project.type],base=type.buyers==='household'?.012*Math.sqrt(market.moversPerDay):.0004*Math.sqrt(market.businesses);
    const free=Math.max(0,project.units-project.sold-project.presold-project.leased),room=project.units?free/project.units:0;
    return base*priceFactor(project.priceLevel)*clamp(room*1.4,0,1)*(Number(demand)>0?Number(demand):1);
  }
  // Build 377: a city's land, construction, prices and rents follow its country's income (propertyPrice; Riyadh = 1).
  // The factor is fixed on the project when it starts, so its contract, costs and prices stay consistent; a project
  // started before Build 377 keeps the prices it was started with (factor 1).
  // The price level (customer-base-core priceIndex, the wage index) is part of the factor: a project started later costs
  // and sells for more.
  function cityFactor(country,state=null){const B=globalThis.GH_CUSTOMER_BASE;const value=(typeof B?.incomeFactor==='function'?Number(B.incomeFactor(country,'propertyPrice')):1)*(state&&typeof B?.priceIndex==='function'?Number(B.priceIndex(state)):1);return Number.isFinite(value)&&value>0?Math.round(value*10000)/10000:1;}
  const local=project=>Number(project?.localFactor)>0?Number(project.localFactor):1;
  // Build 377: the property market moves (customer-base-core propertyValue). A project keeps the market level of its start
  // (or of its first day after Build 377); unsold units sell, and walk-in tenants rent, at today's market against it
  // (rents move half as much). Off-plan sales keep their contract price.
  function marketValue(state){const B=globalThis.GH_CUSTOMER_BASE,value=typeof B?.propertyValue==='function'?Number(B.propertyValue(state)):1;return Number.isFinite(value)&&value>0?value:1;}
  const marketMove=(project,value)=>Number(project?.marketAtStart)>0&&Number(value)>0?Number(value)/Number(project.marketAtStart):1;
  // Build 378: off-plan sales are recognised over time (IFRS 15): revenue and the units' cost follow the construction's
  // progress (time elapsed), cash follows the payment plan. One aggregate per project (offPlan), no buyer records.
  // The contract price is fixed on signing; it is the price the units were handed over at before Build 378.
  const offPlanUnitPrice=(type,project)=>Math.round(type.price*local(project)*project.priceLevel*OFF_PLAN_DISCOUNT);
  const cents=value=>Math.round(value*100)/100;
  function offPlanOf(project,type){
    if(project.offPlan&&typeof project.offPlan==='object')return {plan:project.offPlan,commission:0};
    // A save from before Build 378: its presold units are signed now at the same contract price; their commission
    // (paid at handover before) is paid once now, and the next progress step recognises the construction done so far.
    const units=Math.max(0,num(project.presold)),value=units*offPlanUnitPrice(type,project);
    project.offPlan={units,value,cost:units*num(project.unitCost),recognized:0,recognizedCost:0,collected:0,progress:0};
    return {plan:project.offPlan,commission:value*SALES_COMMISSION};
  }
  // Today's step towards the contracts' share at the project's progress (never back: a construction that waits for its
  // milestone moves its completion day, not its recognised share).
  function offPlanStep(project,plan,day){
    const span=Math.max(1,num(project.completeDay)-num(project.startDay)),progress=Math.max(num(plan.progress),clamp((day-num(project.startDay))/span,0,1));
    const revenue=cents(plan.value*progress-plan.recognized),cost=cents(plan.cost*progress-plan.recognizedCost),cash=Math.max(0,cents(plan.value*(OFF_PLAN_DEPOSIT+(OFF_PLAN_PAID_AT_COMPLETION-OFF_PLAN_DEPOSIT)*progress)-plan.collected));
    plan.progress=progress;plan.recognized+=revenue;plan.recognizedCost+=cost;plan.collected+=cash;
    return {revenue,cost,cash};
  }
  function projectQuote(type,size=1,level=1,factor=1){
    const t=TYPES[type];if(!t)throw new Error('realestate-type-invalid');const f=Number(factor)>0?Number(factor):1,units=Math.max(10,Math.round(t.units*size)),build=Math.round(units*t.unitCost*f),land=Math.round(build*LAND_SHARE);
    return {type,name:t.name,units,land,build,total:land+build,days:Math.round(t.days*(size>1?1+(size-1)*.35:1)),localFactor:f,unitPrice:Math.round(t.price*f*level),unitRent:Math.round(t.rent*f*level),saleValue:Math.round(units*t.price*f*level),annualRent:Math.round(units*t.rent*f*level),modes:t.modes};
  }
  function payContractor(state,project,amount,stage){
    const F=globalThis.GH_FINANCE_CORE;if(!F?.execute)throw new Error('finance-core-missing');
    const payment=F.execute({state},'pay-by-cheque',{company:'realestate',amount:Math.round(amount),note:`إنشاء ${project.name} · ${stage}`,beneficiary:`مقاول البناء · ${project.city}`,line:'capex',requestRef:`RE-BUILD-${project.id}-${stage}`});
    if(!payment?.cheque?.id||payment.cheque.status!=='مصروف')throw new Error('realestate-cheque-not-cleared');return payment.cheque.id;
  }
  // A milestone due in the daily close: paid when the company has the cash, otherwise the project waits a day.
  function payMilestone(state,project,amount,stage){
    if(num(globalThis.GH_FINANCE_CORE?.operating?.(state,'realestate'))<amount){project.completeDay++;project.waitingDays=(Number(project.waitingDays)||0)+1;return false;}
    project.cheques.push(payContractor(state,project,amount,stage));return true;
  }
  function startProject(state,p){
    const re=ensure(state),office=re.offices.find(row=>row.id===p.officeId||row.facilityId===p.officeId);if(!office||!office.active)throw new Error('realestate-office-required');
    if(re.projects.filter(row=>row.status!=='مكتمل'||row.units>row.sold).length>=MAX_ACTIVE_PROJECTS)throw new Error('realestate-project-limit');
    const type=String(p.type||''),size=Number(p.size)||1,level=Number(p.priceLevel)||1,mode=String(p.mode||'');if(!TYPES[type])throw new Error('realestate-type-invalid');if(!SIZE_LEVELS.includes(size))throw new Error('realestate-size-invalid');if(!PRICE_LEVELS.includes(level))throw new Error('realestate-price-invalid');if(!TYPES[type].modes.includes(mode))throw new Error('realestate-mode-invalid');
    const q=projectQuote(type,size,level,cityFactor(office.country,state)),first=q.land+q.build*MILESTONES[0],F=globalThis.GH_FINANCE_CORE;if(num(F?.operating?.(state,'realestate'))<first)throw new Error('insufficient-cash');
    const day=Math.floor(now(state)/86400),project={id:`RE-PRJ-${++re.sequence}`,officeId:office.id,city:office.city,country:office.country,type,name:`${q.name} · ${office.city}`,mode,units:q.units,unitCost:Math.round((q.land+q.build)/q.units),localFactor:q.localFactor,marketAtStart:Math.round(marketValue(state)*10000)/10000,landCost:q.land,buildCost:q.build,priceLevel:level,startDay:day,completeDay:day+q.days,status:'قيد الإنشاء',milestonesPaid:0,sold:0,presold:0,leased:0,handedOver:0,salesRevenue:0,rentRevenue:0,today:null};
    project.cheques=[payContractor(state,project,first,'الأرض والدفعة الأولى')];project.milestonesPaid=1;const legal=F.execute({state},'register-commercial-contract',{id:`LEGAL-${project.id}`,company:'realestate',contractType:'عقد أرض وإنشاء',counterparty:`مقاول البناء · ${project.city}`,title:`عقد تطوير ${project.name}`,startDay:day,endDay:project.completeDay,amount:q.total,terms:{officeId:office.id,country:office.country,type,mode,units:q.units,landCost:q.land,buildCost:q.build,milestones:[...MILESTONES]},sourceRefs:[project.id],linkedDocumentNumbers:project.cheques});project.legalDocumentId=legal.id;project.documentProofId=legal.documentProofId;project.contentDigest=legal.contentDigest;re.ytd.capex+=first;re.projects.push(project);return clone(project);
  }
  // Build 374 (owner's decision). A project under construction can borrow 40% or 60% of its land and build cost from
  // construction lenders, once, through Finance Core's existing debt (fixed rate, due two years after completion; the
  // interest and repayment follow the company's debt). A completed lease building with only walk-in tenants (no lease
  // contract running) can be sold to a property fund at its rent capitalised at 7% (vacant units at their cost); the
  // sale is recognised in the next daily close as unit sales are, with the same 2% commission.
  const CONSTRUCTION_SHARES=Object.freeze([.4,.6]),FUND_CAP_RATE=.07;
  function financeConstruction(state,p){
    const re=ensure(state),project=re.projects.find(row=>row.id===p.projectId);if(!project)throw new Error('realestate-project-not-found');if(project.status!=='قيد الإنشاء')throw new Error('realestate-construction-finance-closed');if(project.constructionLoanId)throw new Error('realestate-construction-already-financed');
    const share=Number(p.share);if(!CONSTRUCTION_SHARES.includes(share))throw new Error('realestate-construction-share-invalid');
    const day=Math.floor(now(state)/86400),amount=Math.round((num(project.landCost)+num(project.buildCost))*share),F=globalThis.GH_FINANCE_CORE;if(!F?.execute)throw new Error('finance-core-missing');
    const ref=`RE-CONSTR-${project.id}`,result=F.execute({state},'raise-debt',{company:'realestate',amount,liabilityAccount:'قروض إنشاءات عقارية',lender:'بنوك تمويل الإنشاءات',termDays:Math.max(365,Number(project.completeDay)-day+730),fixedRate:true,note:`تمويل إنشاء ${project.name}`,ref});
    project.constructionLoanId=ref;project.constructionLoan=amount;project.constructionShare=share;return {projectId:project.id,amount,ref:result.ref||ref};
  }
  // With the state, the fund pays today's market: its yield moves with the base rate (5%-10%) and the rent with the market.
  function fundValue(project,state=null){const type=TYPES[project.type];if(!type)return 0;const vacant=Math.max(0,num(project.units)-num(project.leased));let cap=FUND_CAP_RATE,move=1;if(state){const B=globalThis.GH_CUSTOMER_BASE,rate=Number(B?.economicConditions?.(state)?.rate);if(Number.isFinite(rate))cap=clamp(FUND_CAP_RATE+(rate-Number(B.REFERENCE_RATE||.046)),.05,.1);move=Math.sqrt(marketMove(project,marketValue(state)));}return Math.round(num(project.leased)*type.rent*local(project)*num(project.priceLevel||1)*move/cap+vacant*num(project.unitCost));}
  function canSellToFund(project){return !!project&&project.mode==='lease'&&project.status==='مكتمل'&&num(project.leased)>0&&!(Array.isArray(project.leases)&&project.leases.some(row=>!row.ended));}
  function sellToFund(state,p){
    const re=ensure(state),project=re.projects.find(row=>row.id===p.projectId);if(!project)throw new Error('realestate-project-not-found');if(!canSellToFund(project))throw new Error('realestate-fund-sale-not-allowed');
    const day=Math.floor(now(state)/86400),price=fundValue(project,state);
    re.pendingFundSales=Array.isArray(re.pendingFundSales)?re.pendingFundSales:[];re.pendingFundSales.push({projectId:project.id,name:project.name,amount:price,cost:project.units*num(project.unitCost),day});
    re.completedArchive.unshift({id:project.id,name:project.name,units:project.units,salesRevenue:price,rentRevenue:num(project.rentRevenue),completeDay:project.completeDay,soldToFundDay:day});re.completedArchive=re.completedArchive.slice(0,100);
    re.projects=re.projects.filter(row=>row.id!==project.id);
    for(const request of [...re.tenantRequests])if(request.projectId===project.id)closeRequest(re,request,'ملغى',{decidedDay:day,reason:'بيع المبنى لصندوق'});
    return {projectId:project.id,price,units:project.units};
  }
  function setProjectPrice(state,p){const re=ensure(state),project=re.projects.find(row=>row.id===p.projectId);if(!project)throw new Error('realestate-project-not-found');const level=Number(p.level);if(!PRICE_LEVELS.includes(level))throw new Error('realestate-price-invalid');project.priceLevel=level;return clone(project);}
  // Corporate tenants: a business asks for a block of completed (or soon completed) units at its rent and term.
  const TENANTS=Object.freeze(['شركة استشارات دولية','مجموعة تجزئة إقليمية','شركة تقنية ناشئة','مكتب محاماة','بنك استثماري','شركة توزيع أغذية','مزود خدمات لوجستية']);
  function generateRequest(state,re,day){
    if(re.tenantRequests.length>=MAX_OPEN_REQUESTS||deterministic(`${day}:re-request`,0,1)>=.25)return null;
    const candidates=re.projects.filter(row=>row.mode==='lease'&&TYPES[row.type].buyers==='business'&&row.units-row.leased>=4&&(row.status==='مكتمل'||row.completeDay-day<=60));if(!candidates.length)return null;
    const project=candidates[Math.floor(deterministic(`${day}:re-request:project`,0,candidates.length))%candidates.length],free=project.units-project.leased,units=Math.max(2,Math.min(free,Math.round(free*deterministic(`${day}:re-request:units`,.1,.35)))),rentLevel=Math.round(deterministic(`${day}:re-request:rent`,.85,1.02)*100)/100,years=[3,5,7,10][Math.floor(deterministic(`${day}:re-request:term`,0,4))%4];
    const request={id:`RE-REQ-${++re.sequence}`,day,expiresDay:day+REQUEST_DAYS,tenant:TENANTS[Math.floor(deterministic(`${day}:re-request:tenant`,0,TENANTS.length))%TENANTS.length],projectId:project.id,projectName:project.name,units,rentLevel,annualRent:Math.round(units*TYPES[project.type].rent*local(project)*rentLevel),years,status:'بانتظار القرار'};
    re.tenantRequests.push(request);return request;
  }
  function closeRequest(re,request,status,extra={}){re.tenantRequests=re.tenantRequests.filter(row=>row.id!==request.id);re.requestHistory.unshift({...request,...extra,status});re.requestHistory=re.requestHistory.slice(0,HISTORY);}
  function decideRequest(state,p){
    const re=ensure(state),request=re.tenantRequests.find(row=>row.id===String(p.id||''));if(!request)throw new Error('realestate-request-not-found');
    const day=Math.floor(now(state)/86400);if(day>=Number(request.expiresDay)){closeRequest(re,request,'منتهي',{decidedDay:day});return {id:request.id,status:'منتهي',reason:'realestate-request-expired'};}
    if(p.decision==='decline'){closeRequest(re,request,'معتذر عنه',{decidedDay:day});return {id:request.id,status:'معتذر عنه'};}
    if(p.decision!=='accept')throw new Error('realestate-request-decision-invalid');
    const project=re.projects.find(row=>row.id===request.projectId);if(!project)throw new Error('realestate-project-not-found');const units=Math.min(Math.floor(Number(request.units)||0),Math.max(0,project.units-project.leased));if(units<=0)throw new Error('realestate-no-free-units');
    const annualRent=Math.round(units*TYPES[project.type].rent*local(project)*Number(request.rentLevel||1));project.leases=Array.isArray(project.leases)?project.leases:[];const startDay=Math.max(day,project.completeDay),endDay=startDay+request.years*365,F=globalThis.GH_FINANCE_CORE;if(!F?.execute)throw new Error('finance-core-missing');const legal=F.execute({state},'register-commercial-contract',{id:`LEGAL-LEASE-${request.id}`,company:'realestate',contractType:'عقد إيجار مؤسسي',counterparty:request.tenant,title:`إيجار ${project.name}`,startDay,endDay,amount:annualRent*request.years,terms:{projectId:project.id,units,rentLevel:request.rentLevel,annualRent,years:request.years},sourceRefs:[request.id,project.id]}),lease={id:request.id,tenant:request.tenant,units,rentLevel:request.rentLevel,annualRent,startDay,endDay,legalDocumentId:legal.id,documentProofId:legal.documentProofId,contentDigest:legal.contentDigest};project.leases.push(lease);project.leased+=units;
    closeRequest(re,request,'مقبول',{decidedDay:day,units,annualRent});return {id:request.id,status:'مقبول',units,annualRent};
  }
  function decideRequestsBatch(state,p={}){
    const tx=globalThis.GH_TRANSACTION_CORE;if(!tx?.isActive?.())throw new Error('realestate-batch-transaction-required');
    const re=ensure(state),day=Math.floor(now(state)/86400),batchId=String(p.batchId||'').trim(),periodId=String(p.periodId??Math.floor(day/30)),decisions=Array.isArray(p.decisions)?p.decisions:[];
    if(!batchId||batchId.length>120)throw new Error('realestate-batch-id-required');if(!decisions.length||decisions.length>MAX_OPEN_REQUESTS)throw new Error('realestate-request-batch-size-invalid');
    const normalized=decisions.map(row=>({id:String(row?.id||''),decision:String(row?.decision||'')})).sort((a,b)=>a.id.localeCompare(b.id));
    if(normalized.some(row=>!row.id||!['accept','decline'].includes(row.decision)))throw new Error('realestate-request-batch-decision-invalid');if(new Set(normalized.map(row=>row.id)).size!==normalized.length)throw new Error('realestate-request-batch-duplicate-id');
    const fingerprint=JSON.stringify({periodId,decisions:normalized}),prior=re.requestDecisionBatches.find(row=>row.batchId===batchId);if(prior){if(prior.fingerprint!==fingerprint)throw new Error('realestate-batch-reference-conflict');return clone(prior.result);}
    const items=[];let accepted=0,declined=0,skipped=0,totalUnits=0,totalAnnualRent=0;
    for(const item of normalized){
      const request=re.tenantRequests.find(row=>row.id===item.id);if(!request){items.push({requestId:item.id,status:'تجاوز',reason:'realestate-request-not-found'});skipped++;continue;}
      if(day>=Number(request.expiresDay)){const result=decideRequest(state,{id:item.id,decision:item.decision});items.push({...result,reason:'realestate-request-expired'});skipped++;continue;}
      if(item.decision==='accept'){
        const project=re.projects.find(row=>row.id===request.projectId);if(!project){items.push({requestId:item.id,status:'تجاوز',reason:'realestate-project-not-found'});skipped++;continue;}
        const available=Math.max(0,Math.floor(Number(project.units)||0)-Math.floor(Number(project.leased)||0));if(available<=0){items.push({requestId:item.id,status:'تجاوز',reason:'realestate-no-free-units'});skipped++;continue;}
      }
      // Any unexpected Finance/document error aborts this enclosing domain transaction, so the whole batch rolls
      // back. Expected per-item skips are classified before making writes; no half-created lease is caught here.
      const result=decideRequest(state,{id:item.id,decision:item.decision});items.push({...result});
      if(item.decision==='accept'){accepted++;totalUnits+=Number(result.units)||0;totalAnnualRent+=Number(result.annualRent)||0;}else declined++;
    }
    const result={batchId,periodId,accepted,declined,skipped,totalUnits,totalAnnualRent,items};re.requestDecisionBatches.unshift({batchId,fingerprint,result:clone(result),at:now(state)});re.requestDecisionBatches.splice(HISTORY);return result;
  }
  function leaseToCompany(state,p={}){
    const re=ensure(state),project=re.projects.find(row=>row.id===String(p.projectId||''));if(!project)throw new Error('realestate-project-not-found');
    const leaseId=String(p.leaseId||'').trim(),companyId=String(p.companyId||'').trim(),units=Number(p.units),rentLevel=Number(p.rentLevel),years=Number(p.years),type=TYPES[project.type];
    if(!leaseId)throw new Error('realestate-internal-lease-id-required');
    const duplicate=project.leases?.find(row=>row.id===leaseId);if(duplicate){if(duplicate.tenantCompanyId!==companyId||Number(duplicate.units)!==units||Number(duplicate.rentLevel)!==rentLevel||Number(duplicate.years)!==years)throw new Error('realestate-internal-lease-reference-conflict');return clone(duplicate);}
    if(project.mode!=='lease'||project.status!=='مكتمل'||!type)throw new Error('realestate-internal-lease-project-unavailable');
    if(companyId==='realestate'||companyId==='group')throw new Error('realestate-internal-lease-tenant-invalid');
    const platform=globalThis.GH_COMPANY_PLATFORM;if(!platform?.requireCompany)throw new Error('company-platform-unavailable');
    const tenant=platform.requireCompany(state,companyId,{registered:true,operational:true,capability:'finance.book'}),count=Math.floor(units),yearsAllowed=[1,3,5,10];
    if(!Number.isSafeInteger(units)||count!==units||count<1||count>Math.max(0,project.units-project.leased))throw new Error('realestate-internal-lease-units-invalid');
    if(!PRICE_LEVELS.includes(rentLevel)||!yearsAllowed.includes(years))throw new Error('realestate-internal-lease-terms-invalid');
    const internalCount=re.projects.reduce((sum,row)=>sum+(row.leases||[]).filter(lease=>lease.tenantCompanyId).length,0);if(internalCount>=MAX_INTERNAL_LEASES)throw new Error('realestate-internal-lease-capacity');
    const day=Math.floor(now(state)/86400),annualRent=Math.round(count*type.rent*local(project)*rentLevel),startDay=Math.max(day,project.completeDay),endDay=startDay+years*365,F=globalThis.GH_FINANCE_CORE;
    if(!F?.execute)throw new Error('finance-core-missing');
    const legal=F.execute({state},'register-commercial-contract',{id:`LEGAL-${leaseId}`,company:'realestate',contractType:'عقد إيجار داخلي للمجموعة',counterparty:tenant.identity?.legalName||tenant.id,title:`إيجار داخلي · ${project.name}`,startDay,endDay,amount:annualRent*years,terms:{projectId:project.id,tenantCompanyId:tenant.id,units:count,rentLevel,annualRent,years,internal:true,settlementDays:INTERNAL_RENT_SETTLE_DAYS},sourceRefs:[leaseId,project.id]}),lease={id:leaseId,tenant:tenant.identity?.legalName||tenant.id,tenantCompanyId:tenant.id,internal:true,units:count,rentLevel,annualRent,years,startDay,endDay,legalDocumentId:legal.id,documentProofId:legal.documentProofId,contentDigest:legal.contentDigest};
    project.leases=Array.isArray(project.leases)?project.leases:[];project.leases.push(lease);project.leased+=count;re.sequence++;return clone(lease);
  }
  function rentPeriodKey(state,day){const F=globalThis.GH_FINANCE_CORE,key=F?.calendarMonthForDay?.(day);if(typeof key!=='string'||!key)throw new Error('realestate-finance-period-unavailable');return key;}
  function rentInvoiceSource(projectId,leaseId,period){return `RENT-EXT:${String(projectId)}:${String(leaseId)}:${String(period)}`;}
  function invoiceBySource(state,sourceRef){const live=(state.finance?.invoices||[]).find(row=>row?.sourceRef===sourceRef);return live||globalThis.GH_FINANCE_CORE?.findArchivedDocument?.(state,'invoices','sourceRef',sourceRef)||null;}
  function invoiceByNumber(state,number){const live=(state.finance?.invoices||[]).find(row=>row?.number===number);return live||globalThis.GH_FINANCE_CORE?.findArchivedDocument?.(state,'invoices','number',number)||null;}
  function issueExternalRentInvoice(state,{project,leaseId,tenant,amount,period,day}){
    const rounded=Math.round(Number(amount)*100)/100;if(!(rounded>.005))return null;
    const F=globalThis.GH_FINANCE_CORE;if(!F?.execute)throw new Error('finance-core-missing');
    const sourceRef=rentInvoiceSource(project.id,leaseId,period),number=`RLE-${hash(sourceRef).toString(36).toUpperCase()}`;
    const prior=invoiceBySource(state,sourceRef),numberConflict=invoiceByNumber(state,number);
    if(prior){if(prior.company!=='realestate'||prior.kind!=='دخل'||Math.abs(Number(prior.total??prior.amount)-rounded)>.01||prior.number!==number)throw new Error('realestate-rent-invoice-reference-conflict');return prior;}
    if(numberConflict)throw new Error('realestate-rent-invoice-number-conflict');
    return F.execute({state},'issue-invoice',{company:'realestate',kind:'دخل',amount:rounded,note:`إيجار شهر ${period} · ${project.name}`,method:'فاتورة إيجار شهرية',taxable:true,status:'مستحقة',counterparty:tenant,number,dueDay:day+7,paymentTerms:7,sourceRef});
  }
  function rentInvoiceStatus(state,invoiceOrNumber,day=Math.floor(now(state)/86400)){
    const invoice=typeof invoiceOrNumber==='string'?invoiceByNumber(state,invoiceOrNumber):invoiceOrNumber;
    if(!invoice||invoice.company!=='realestate'||invoice.kind!=='دخل'||!String(invoice.sourceRef||'').startsWith('RENT-EXT:'))return 'غير موجود';
    if(['محصلة','مدفوعة','مسددة'].includes(String(invoice.status||'')))return 'مدفوع';
    return Number(invoice.dueDay)<Number(day)?'متأخر':'مستحق';
  }
  function collectRentInvoice(state,p={}){
    const number=String(p.number||p.invoiceNumber||''),invoice=invoiceByNumber(state,number);
    if(!invoice||invoice.company!=='realestate'||invoice.kind!=='دخل'||!String(invoice.sourceRef||'').startsWith('RENT-EXT:'))throw new Error('realestate-rent-invoice-not-found');
    if(rentInvoiceStatus(state,invoice)==='مدفوع')return {number,amount:0,status:'مدفوع',idempotent:true,reference:invoice.transferReference||null};
    const F=globalThis.GH_FINANCE_CORE;if(!F?.execute)throw new Error('finance-core-missing');
    const reference=String(p.reference||`RENT-COLLECT-${number}`);if(reference.length>120)throw new Error('realestate-rent-collection-reference-invalid');
    const result=F.execute({state},'collect-receivable',{number,company:'realestate',reference,sourceRefs:[invoice.sourceRef]});
    return {...result,number,status:'مدفوع'};
  }
  function externalRentBilling(state,{project,leaseId,tenant,period,amount,day}){
    return issueExternalRentInvoice(state,{project,leaseId,tenant,period,amount,day});
  }
  function tickDay(state,p={}){
    const re=ensure(state),day=Math.max(0,Math.floor(Number(p.day)||Math.floor(now(state)/86400)));if(re.lastProcessedDay===day)return re.dailyHistory.find(row=>row.day===day)||{day,idempotent:true};
    re.mortgagePending=re.mortgagePending&&typeof re.mortgagePending==='object'&&!Array.isArray(re.mortgagePending)?re.mortgagePending:{};
    const financeHomes=(project,units,revenue)=>{if(TYPES[project.type]?.buyers!=='household'||!(revenue>0))return;const row=re.mortgagePending[project.country]||(re.mortgagePending[project.country]={units:0,amount:0});row.units+=units;row.amount+=revenue*MORTGAGE_SHARE*MORTGAGE_LTV;};
    const valueToday=marketValue(state);for(const project of re.projects)if(!(Number(project.marketAtStart)>0))project.marketAtStart=Math.round(valueToday*10000)/10000;
    // Build 377: buyers and tenants compare the price with the city's rival developer (customer-base-core rivalPrice): the
    // same price sensitivity as the group's own price level, bounded at +-20%.
    const rivalDemand=country=>{const rival=typeof globalThis.GH_CUSTOMER_BASE?.rivalPrice==='function'?globalThis.GH_CUSTOMER_BASE.rivalPrice(country,'realestate',day):1;return clamp(Math.pow(rival,3),.8,1.2);};
    // Build 377: customers of the group's other companies in the city's country buy and rent more readily
    // (customer-base-core affinityBoost, at most +15%).
    const groupReach=(country,pool)=>typeof globalThis.GH_CUSTOMER_BASE?.affinityBoost==='function'?globalThis.GH_CUSTOMER_BASE.affinityBoost(state,country,'realestate',pool):1;
    const B=globalThis.GH_CUSTOMER_BASE,saleDemand=typeof B?.demandFactor==='function'?B.demandFactor(state,'housingSale'):1,leaseDemand=typeof B?.demandFactor==='function'?B.demandFactor(state,'housingLease'):1;
    let sales=0,rent=0,internalRentRevenue=0,externalRentRevenue=0,costOfSales=0,opex=0,commission=0,capex=0,newBuyers=0,newTenants=0,vacated=0,offPlanRevenue=0,offPlanCash=0;const completed=[],internalRentByCompany=new Map(),rentInvoices=[];
    // Build 374: buildings sold to a property fund since the last close are that close's sales.
    const fundSales=Array.isArray(re.pendingFundSales)?re.pendingFundSales:[];for(const row of fundSales){sales+=num(row.amount);costOfSales+=num(row.cost);commission+=num(row.amount)*SALES_COMMISSION;}re.pendingFundSales=[];
    for(const project of re.projects){
      const office=re.offices.find(row=>row.id===project.officeId),type=TYPES[project.type],today={day,sold:0,leased:0,vacated:0,rent:0,sales:0};
      const offPlan=project.mode==='sale'&&project.status==='قيد الإنشاء'?offPlanOf(project,type):null;if(offPlan)commission+=offPlan.commission;
      // Construction milestones and completion.
      if(project.status==='قيد الإنشاء'){
        const half=project.startDay+Math.floor((project.completeDay-project.startDay)/2);
        if(project.milestonesPaid===1&&day>=half){const amount=project.buildCost*MILESTONES[1];if(payMilestone(state,project,amount,'منتصف الإنشاء')){project.milestonesPaid=2;capex+=amount;}}
        if(project.milestonesPaid===2&&day>=project.completeDay&&payMilestone(state,project,project.buildCost*MILESTONES[2],'التسليم')){const amount=project.buildCost*MILESTONES[2];project.milestonesPaid=3;capex+=amount;project.status='مكتمل';completed.push(project.id);
          // Off-plan units are handed over now: the rest of their revenue and cost, and the last 30% of their price.
          if(offPlan){const plan=offPlan.plan,revenue=cents(plan.value-plan.recognized),cost=cents(plan.cost-plan.recognizedCost),cash=Math.max(0,cents(plan.value-plan.collected));sales+=revenue;costOfSales+=cost;offPlanRevenue+=revenue;offPlanCash+=cash;project.salesRevenue+=revenue;today.sales+=revenue;financeHomes(project,project.presold,plan.value);project.sold+=project.presold;project.handedOver+=project.presold;project.presold=0;project.offPlan=null;}}
      }
      if(office&&office.active){
        const arriving=roundDraw(arrivals(re,project,office,(project.mode==='sale'?saleDemand:leaseDemand)*rivalDemand(office.country)*groupReach(office.country,TYPES[project.type]?.buyers==='business'?'businesses':'households')),`${project.id}:${day}:arrivals`),free=Math.max(0,project.units-project.sold-project.presold-project.leased),take=Math.min(free,arriving);
        if(take>0&&project.mode==='sale'){
          if(project.status==='مكتمل'){const revenue=take*Math.round(type.price*local(project)*marketMove(project,valueToday)*project.priceLevel);sales+=revenue;costOfSales+=take*num(project.unitCost);commission+=revenue*SALES_COMMISSION;project.salesRevenue+=revenue;financeHomes(project,take,revenue);project.sold+=take;project.handedOver+=take;today.sales+=revenue;}
          else{const plan=offPlan.plan,value=take*offPlanUnitPrice(type,project);project.presold+=take;plan.units+=take;plan.value+=value;plan.cost+=take*num(project.unitCost);commission+=value*SALES_COMMISSION;}
          today.sold=take;newBuyers+=take;
        }else if(take>0&&project.mode==='lease'&&project.status==='مكتمل'){project.leased+=take;today.leased=take;newTenants+=take;commission+=take*type.rent*local(project)*project.priceLevel/12;}
      }
      // Off-plan contracts under construction: today's share of revenue, cost and instalments (with today's buyers).
      if(offPlan&&project.status==='قيد الإنشاء'&&offPlan.plan.units>0){const step=offPlanStep(project,offPlan.plan,day);sales+=step.revenue;costOfSales+=step.cost;offPlanRevenue+=step.revenue;offPlanCash+=step.cash;project.salesRevenue+=step.revenue;today.sales+=step.revenue;}
      if(project.status==='مكتمل'&&project.mode==='lease'){
        // Public occupancy remains on its existing daily settlement path. Contracted external leases stay in daily
        // P&L accrual but are invoiced once per month from their lease record; no tenant-level state is created.
        const leases=Array.isArray(project.leases)?project.leases:[],contractUnits=leases.filter(row=>!row.ended).reduce((sum,row)=>sum+num(row.units),0),walkIn=Math.max(0,project.leased-contractUnits),period=rentPeriodKey(state,day);
        const churn=clamp(BASE_LEASE_CHURN*(1+(project.priceLevel-1)*2.5),.05,.5),leaving=Math.min(walkIn,roundDraw(walkIn*churn/365,`${project.id}:${day}:churn`));
        project.leased-=leaving;today.vacated=leaving;vacated+=leaving;
        for(const lease of leases){
          const external=!lease.tenantCompanyId,active=day>=Number(lease.startDay)&&day<Number(lease.endDay)&&!lease.ended,leasePeriod=period;
          if(external&&lease.rentPeriod!==leasePeriod){if(lease.rentPeriod&&num(lease.rentAccrued)>.005){const invoice=externalRentBilling(state,{project,leaseId:lease.id,tenant:lease.tenant,period:lease.rentPeriod,amount:lease.rentAccrued,day});if(invoice)rentInvoices.push(invoice.number);}lease.rentPeriod=leasePeriod;lease.rentAccrued=0;}
          if(external&&active){lease.rentAccrued=Math.round((num(lease.rentAccrued)+lease.units*type.rent*local(project)*lease.rentLevel/365)*100000)/100000;externalRentRevenue+=lease.units*type.rent*local(project)*lease.rentLevel/365;}
          if(day>=Number(lease.endDay)&&!lease.ended){
            if(external&&num(lease.rentAccrued)>.005){const invoice=externalRentBilling(state,{project,leaseId:lease.id,tenant:lease.tenant,period:lease.rentPeriod||leasePeriod,amount:lease.rentAccrued,day});if(invoice)rentInvoices.push(invoice.number);lease.rentAccrued=0;}
            lease.ended=true;project.leased=Math.max(0,project.leased-num(lease.units));
            const F=globalThis.GH_FINANCE_CORE;if(lease.tenantCompanyId&&lease.legalDocumentId&&F?.ensure?.(state)?.commercialContracts?.some(row=>row.id===lease.legalDocumentId))F.execute({state},'update-commercial-contract-status',{id:lease.legalDocumentId,status:'منتهي',endedAt:day,reason:'انتهاء مدة الإيجار الداخلي'});
          }
        }
        project.leases=leases.filter(row=>!row.ended);
        const activeLeases=leases.filter(row=>day>=row.startDay&&day<row.endDay),dailyWalkIn=Math.max(0,walkIn-leaving)*type.rent*local(project)*Math.sqrt(marketMove(project,valueToday))*project.priceLevel/365,dailyContract=activeLeases.reduce((sum,row)=>sum+row.units*type.rent*local(project)*row.rentLevel,0)/365,dailyRent=dailyWalkIn+dailyContract;
        rent+=dailyRent;project.rentRevenue+=dailyRent;today.rent=dailyRent;
        for(const lease of activeLeases)if(lease.tenantCompanyId){const amount=lease.units*type.rent*local(project)*lease.rentLevel/365,companyId=lease.tenantCompanyId,row=internalRentByCompany.get(companyId)||{companyId,amount:0,sourceRefs:[]};row.amount+=amount;if(row.sourceRefs.length<80&&!row.sourceRefs.includes(lease.id))row.sourceRefs.push(lease.id);internalRentByCompany.set(companyId,row);internalRentRevenue+=amount;}
      }
      if(project.status==='مكتمل'){const held=project.mode==='lease'?project.units:Math.max(0,project.units-project.sold);opex+=held*project.unitCost*PROPERTY_OPEX/365;}
      project.today=today;
    }
    // A sold-out sale project leaves the active list for a compact archive record.
    const done=re.projects.filter(row=>row.mode==='sale'&&row.status==='مكتمل'&&row.sold>=row.units);
    for(const row of done){re.completedArchive.unshift({id:row.id,name:row.name,units:row.units,salesRevenue:row.salesRevenue,completeDay:row.completeDay});}
    re.completedArchive=re.completedArchive.slice(0,100);re.projects=re.projects.filter(row=>!done.includes(row));
    for(const request of [...re.tenantRequests])if(day>=Number(request.expiresDay))closeRequest(re,request,'منتهي',{decidedDay:day});
    const internalRentRows=[...internalRentByCompany.values()].map(row=>({...row,amount:Math.round(row.amount*100)/100})),internalRentSettlements=[],accounts=re.internalRentAccounts,F=globalThis.GH_FINANCE_CORE;
    for(const row of internalRentRows){const account=accounts[row.companyId]||(accounts[row.companyId]={companyId:row.companyId,openedDay:day,amount:0,days:0,sourceRefs:[]});account.amount=Math.round((num(account.amount)+row.amount)*100)/100;account.days=Math.max(0,Math.floor(Number(account.days)||0))+1;for(const ref of row.sourceRefs)if(account.sourceRefs.length<80&&!account.sourceRefs.includes(ref))account.sourceRefs.push(ref);}
    for(const companyId of Object.keys(accounts).sort()){
      const account=accounts[companyId];if(!account||num(account.amount)<=0){delete accounts[companyId];continue;}if(Number(account.days)<INTERNAL_RENT_SETTLE_DAYS)continue;
      try{const result=F.execute({state},'settle-intercompany-service',{closeOwned:true,from:companyId,to:'realestate',amount:account.amount,note:`إيجار عقاري داخلي · ${account.days} يومًا`,serviceCategory:'إيجار عقاري داخلي',taxCode:'intercompany-tax-group',line:'other',ref:`RE-INT-RENT-${companyId}-${day}`,sourceRefs:account.sourceRefs});internalRentSettlements.push({companyId,amount:account.amount,days:account.days,reference:result.reference});delete accounts[companyId];}
      catch(error){if(!/insufficient-service-cash-or-budget/.test(String(error?.message||error)))throw error;account.carriedOver=(Number(account.carriedOver)||0)+1;}
    }
    // Build 378: the units' cost is the sale's expense (their construction was paid as capex); it is not paid again.
    const revenue=sales+rent,cashExpense=opex+commission,expense=cashExpense+costOfSales,net=revenue-expense;
    // Once a month the group's bank books the month's home loans, one portfolio per country (the rest borrowed elsewhere).
    const mortgages=[];if(day%MORTGAGE_PERIOD_DAYS===MORTGAGE_PERIOD_DAYS-1){const bankCore=globalThis.GH_BANKING_CORE;for(const [country,row] of Object.entries(re.mortgagePending)){const loan=typeof bankCore?.originateMarketMortgage==='function'?bankCore.originateMarketMortgage(state,{country,units:row.units,amount:row.amount,reference:`RE-MORTGAGE-${country}-${day}`}):null;if(loan)mortgages.push({country,units:row.units,amount:Math.round(row.amount),loanId:loan.id});}re.mortgagePending={};}
    const report={day,mortgages,fundSales:fundSales.map(row=>({projectId:row.projectId,amount:row.amount})),sales,rent,internalRentRevenue,externalRentRevenue,internalRentRows,internalRentSettlements,rentInvoices,costOfSales,opex,commission,capex,revenue,expense,cashExpense,offPlanRevenue,offPlanCash,net,newBuyers,newTenants,vacated,completed,newRequest:generateRequest(state,re,day)?.id||null};
    re.ytd.sales+=sales;re.ytd.rent+=rent;re.ytd.costOfSales+=costOfSales;re.ytd.opex+=opex;re.ytd.commission+=commission;re.ytd.net+=net;re.ytd.capex+=capex;
    re.dailyHistory.unshift(report);re.dailyHistory=re.dailyHistory.slice(0,DAILY_HISTORY);re.lastProcessedDay=day;return clone(report);
  }
  function dailyResult(state,day){const row=(state.realEstate?.dailyHistory||[]).find(item=>Number(item.day)===Number(day));if(!row)return {revenue:0,expense:0,cashRevenue:0,cashExpense:0,internalRentRows:[],internalRentSettlements:[]};return {revenue:num(row.revenue),expense:num(row.expense),cashRevenue:Math.max(0,num(row.revenue)-num(row.internalRentRevenue)-num(row.externalRentRevenue)-num(row.offPlanRevenue)+num(row.offPlanCash)),cashExpense:num(row.cashExpense??row.expense),internalRentRows:Array.isArray(row.internalRentRows)?row.internalRentRows:[],internalRentSettlements:Array.isArray(row.internalRentSettlements)?row.internalRentSettlements:[]};}
  function rentInvoices(state,projectId=null){const rows=(state.finance?.invoices||[]).filter(row=>row?.company==='realestate'&&row.kind==='دخل'&&String(row.sourceRef||'').startsWith('RENT-EXT:')&&(!projectId||String(row.sourceRef).startsWith(`RENT-EXT:${projectId}:`)));return rows.map(row=>({number:row.number,sourceRef:row.sourceRef,amount:Number(row.total??row.amount)||0,dueDay:Number(row.dueDay)||0,status:rentInvoiceStatus(state,row),ledgerStatus:row.status,counterparty:row.counterparty}));}
  function summary(state){
    const re=ensure(state),projects=re.projects,completedLease=projects.filter(row=>row.status==='مكتمل'&&row.mode==='lease'),leasable=completedLease.reduce((s,r)=>s+r.units,0),leased=completedLease.reduce((s,r)=>s+r.leased,0),window30=re.dailyHistory.slice(0,30);
    const annualRentRoll=completedLease.reduce((sum,project)=>{const type=TYPES[project.type],leases=Array.isArray(project.leases)?project.leases:[],contracted=leases.reduce((total,row)=>total+row.units*type.rent*local(project)*row.rentLevel,0),walkIn=Math.max(0,project.leased-leases.reduce((total,row)=>total+row.units,0));return sum+contracted+walkIn*type.rent*local(project)*project.priceLevel;},0);
    const internalRentReceivable=Object.values(re.internalRentAccounts).reduce((sum,row)=>sum+num(row?.amount),0);
    return {offices:re.offices.length,projects:projects.length,underConstruction:projects.filter(row=>row.status==='قيد الإنشاء').length,units:projects.reduce((s,r)=>s+r.units,0),occupancy:leasable?leased/leasable:0,unsoldUnits:projects.filter(row=>row.mode==='sale').reduce((s,r)=>s+Math.max(0,r.units-r.sold-r.presold),0),presold:projects.reduce((s,r)=>s+r.presold,0),revenue30:window30.reduce((s,r)=>s+num(r.revenue),0),net30:window30.reduce((s,r)=>s+Number(r.net||0),0),capex30:window30.reduce((s,r)=>s+num(r.capex),0)+projects.filter(row=>row.startDay>Math.floor(now(state)/86400)-30).reduce((s,r)=>s+num(r.landCost)+num(r.buildCost)*MILESTONES[0],0),annualRentRoll,openRequests:re.tenantRequests.length,internalRentAccounts:Object.keys(re.internalRentAccounts).length,internalRentReceivable};
  }
  function onFinancialDay(ctx,p={}){
    const platform=globalThis.GH_COMPANY_PLATFORM,commands=globalThis.GH_DOMAIN_COMMANDS;
    if(!platform?.requireCompany||!commands?.dispatchSystem)throw new Error('company-daily-owner-unavailable');
    const company=platform.requireCompany(ctx.state,ctx.companyId,{registered:true,operational:true,capability:'operations.realestate'});
    return commands.dispatchSystem({state:ctx.state},'realestate','tick-day',{...p,ownerCompanyId:company.id},{actor:'simulation-scheduler'}).result;
  }
  function execute(ctx,cmd,p={}){
    const state=ctx.state||ctx;
    if(cmd==='ensure')return ensure(state);if(cmd==='tick-day')return tickDay(state,p);if(cmd==='start-project')return startProject(state,p);if(cmd==='set-project-price')return setProjectPrice(state,p);if(cmd==='decide-request')return decideRequest(state,p);if(cmd==='decide-requests-batch')return decideRequestsBatch(state,p);if(cmd==='lease-to-company')return leaseToCompany(state,p);if(cmd==='finance-construction')return financeConstruction(state,p);if(cmd==='sell-to-fund')return sellToFund(state,p);if(cmd==='collect-rent-invoice')return collectRentInvoice(state,p);
    throw new Error(`Unknown real estate command: ${cmd}`);
  }
  const API={VERSION,DAILY_FINANCIAL_ORDER:350,CONSTRUCTION_SHARES,FUND_CAP_RATE,fundValue,canSellToFund,TYPES,TYPE_IDS,PRICE_LEVELS,SIZE_LEVELS,MAX_ACTIVE_PROJECTS,MAX_INTERNAL_LEASES,MAX_OPEN_REQUESTS,ensure,officeMarket,projectQuote,cityFactor,arrivals,tickDay,dailyResult,summary,rentInvoices,rentInvoiceStatus,leaseToCompany,decideRequestsBatch,onFinancialDay,execute};
  globalThis.GH_REALESTATE_CORE=API;globalThis.GH_DOMAIN_COMMANDS?.register?.('realestate',API);if(globalThis.window&&window!==globalThis)window.GH_REALESTATE_CORE=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
