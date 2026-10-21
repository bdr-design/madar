/* Build 374 · مدار: the telecom company's market, grown from the unified customer base (customer-base-core).
   Every telecom branch serves its country: subscribers join each day at the plan's price stance and leave at its
   churn (1.2-1.5% a month for consumers at the market price, 0.8% for businesses); the group's other companies in the
   same country make joining easier (bounded at +15%). The player chooses each plan's price (-10%, market, +10%), runs
   a branch campaign, and accepts or declines the business contracts companies ask for. Nothing is typed in.
   Money: subscribers are billed once a calendar month per branch through the existing monthly billing of
   customer-companies-core (one invoice per branch, the branch's country on the invoice); the network costs (about 37%
   of the price) and the acquisition costs are the company's daily operating expense through the generic daily close
   (dailyResult, as insurance and real estate do). Load: branches x 4 plans a day, yielded per branch; the saved rows
   are per branch, not per subscriber. Manually entered subscriptions and cohorts of older saves keep billing as before. */
(()=>{'use strict';
const VERSION='GH-TELECOM-MARKET-1.0.0',DAY=86400;
const PLAN_IDS=Object.freeze(['mobile','home','family','business']);
const activePeerCounts=new WeakMap();
const PRICE_LEVELS=Object.freeze([.9,1,1.1]);
const PRICE_LABELS=Object.freeze({'0.9':'أقل من السوق بـ10%','1':'سعر السوق','1.1':'أعلى من السوق بـ10%'});
// pool: the part of the country the plan sells to; penetration: the share of that pool that buys such a plan at all.
const PLAN_MARKET=Object.freeze({
  mobile:Object.freeze({pool:'population',penetration:.85,growth:Object.freeze([30,120]),churn:.015,networkCost:14,acquisition:25}),
  home:Object.freeze({pool:'households',penetration:.45,growth:Object.freeze([5,20]),churn:.012,networkCost:24,acquisition:60}),
  family:Object.freeze({pool:'households',penetration:.25,growth:Object.freeze([4,15]),churn:.012,networkCost:32,acquisition:60}),
  business:Object.freeze({pool:'businesses',penetration:.6,growth:Object.freeze([1,4]),churn:.008,networkCost:140,acquisition:300})
});
const FALLBACK_PRICES=Object.freeze({mobile:38,home:62,family:88,business:420});
const MAX_MARKET_SHARE=.2,CLOSED_CHURN=3,AFFINITY_WEIGHT=.5,MAX_AFFINITY_BOOST=.15;
const CAMPAIGN_DAYS=30,CAMPAIGN_GROWTH=1.6,CAMPAIGN_CHURN=.8;
const MAX_OPEN_REQUESTS=5,REQUEST_DAYS=7,REQUEST_HISTORY=40,DAILY_HISTORY=90,MAX_CONTRACTS=60,MAX_BATCHES=60,CONTRACT_TERMS=Object.freeze([12,24,36]);
const ENTERPRISES=Object.freeze([['مجموعة مستشفيات خاصة','رعاية صحية'],['شركة مقاولات كبرى','إنشاءات'],['سلسلة متاجر تجزئة','تجارة تجزئة'],['بنك تجاري','خدمات مالية'],['شركة خدمات نفطية','طاقة'],['جامعة خاصة','تعليم'],['شركة لوجستيات إقليمية','نقل وتوزيع']]);
const num=value=>Math.max(0,Number(value)||0),clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value)||0));
const now=state=>Number(state?.simSeconds)||0,today=state=>Math.floor(now(state)/DAY);
const clone=value=>globalThis.structuredClone?structuredClone(value):JSON.parse(JSON.stringify(value));
function hash(text){let h=2166136261>>>0;for(const ch of String(text)){h^=ch.codePointAt(0);h=Math.imul(h,16777619)>>>0;}return h>>>0;}
function deterministic(seed,min,max){return min+(hash(seed)/4294967295)*(max-min);}
const roundDraw=(value,seed)=>Math.floor(Math.max(0,value)+deterministic(seed,0,1));
const asciiKey=text=>hash(text).toString(36).toUpperCase().padStart(7,'0');
const base=()=>{const B=globalThis.GH_CUSTOMER_BASE;if(!B?.market||!B?.affinity)throw new Error('customer-base-unavailable');return B;};
const companies=()=>{const C=globalThis.GH_CUSTOMER_COMPANIES_CORE;if(!C?.ensure)throw new Error('customer-companies-unavailable');return C;};
const finance=()=>{const F=globalThis.GH_FINANCE_CORE;if(!F?.execute)throw new Error('finance-core-missing');return F;};
function planPrice(id){return Number(globalThis.GH_CUSTOMER_COMPANIES_CORE?.PLANS?.[id]?.monthlyPrice)||FALLBACK_PRICES[id];}
function planLabel(id){return String(globalThis.GH_CUSTOMER_COMPANIES_CORE?.PLANS?.[id]?.label||id);}
const blankPlans=()=>Object.fromEntries(PLAN_IDS.map(id=>[id,{subscribers:0,newToday:0,lostToday:0}]));

// Read-only view of the market (presentation, the customer base, the revenue chain): never normalises the state.
function read(state){return state?.customerCompanies?.companies?.telecom?.market||null;}
function ensure(state,options={}){
  const collectPeerCounts=options?.collectPeerCounts===true;
  companies().ensure(state);const data=state.customerCompanies.companies.telecom;
  const m=data.market=data.market&&typeof data.market==='object'&&!Array.isArray(data.market)?data.market:{};
  m.version=VERSION;m.pricing=m.pricing&&typeof m.pricing==='object'?m.pricing:{};for(const id of PLAN_IDS)m.pricing[id]=PRICE_LEVELS.includes(Number(m.pricing[id]))?Number(m.pricing[id]):1;
  for(const key of ['branches','contracts','requests','requestHistory','dailyHistory','decisionBatches'])m[key]=Array.isArray(m[key])?m[key].filter(Boolean):[];
  m.sequence=Math.max(0,Math.floor(Number(m.sequence)||0));m.lastProcessedDay=Number.isFinite(Number(m.lastProcessedDay))?Math.floor(Number(m.lastProcessedDay)):-1;
  m.ytd=m.ytd&&typeof m.ytd==='object'?m.ytd:{};for(const key of ['networkCost','acquisitionCost','campaignCost','newSubscribers','lostSubscribers','networkCapex','depreciation'])m.ytd[key]=num(m.ytd[key]);
  syncBranches(state,m,collectPeerCounts);return m;
}
// Every owned telecom branch is a market branch (the generic facility flow opens it from the world directory).
function ownedBranches(state){return (Array.isArray(state.customHubs)?state.customHubs:[]).filter(row=>row?.owned===true&&row.kind==='telecom-branch'&&String(row.ownerCompanyId||row.company||'')==='telecom');}
function syncBranches(state,m,collectPeerCounts=false){
  const owned=ownedBranches(state),byFacility=new Map(m.branches.map(row=>[row.facilityId,row]));
  for(const facility of owned){
    let row=byFacility.get(facility.id);
    if(!row){const country=String(facility.country||'غير محدد'),city=String(facility.city||'');row={id:`MKT-${asciiKey(facility.id)}`,facilityId:String(facility.id),branchId:String(facility.id),branchName:String(facility.name||`فرع ${city}`).slice(0,120),branchCity:city.slice(0,80),branchCountry:country.slice(0,80),city,country,marketPopulation:base().population(country),openedDay:today(state),active:true,plans:blankPlans(),campaignUntil:0,campaigns:0,campaignSpend:0,partyId:null,contractId:null,planName:'مشتركو السوق',status:'idle',activeCustomers:0,monthlyPrice:0,nextBillingMonth:'',lastBilledMonth:'',invoiceCount:0,billed:0,collected:0,outstanding:0};m.branches.push(row);byFacility.set(facility.id,row);}
    row.active=true;row.plans=row.plans&&typeof row.plans==='object'?row.plans:blankPlans();for(const id of PLAN_IDS)row.plans[id]=row.plans[id]&&typeof row.plans[id]==='object'?row.plans[id]:{subscribers:0,newToday:0,lostToday:0};
  }
  const open=new Set(owned.map(row=>String(row.id))),peerCounts=collectPeerCounts?new Map():null;
  for(const row of m.branches){if(!open.has(row.facilityId))row.active=false;if(peerCounts&&row.active)peerCounts.set(row.country,(peerCounts.get(row.country)||0)+1);}
  if(peerCounts)activePeerCounts.set(m,peerCounts);return m.branches;
}
function peersIn(m,country){return Math.max(1,m.branches.filter(row=>row.active&&row.country===country).length);}
// Build 377: a branch's country prices its plans, network and acquisition costs at its income (telecomPrice, Riyadh = 1),
// and fixed broadband (home and family plans) reaches fewer households where incomes are low (broadbandReach).
function localPrice(country){const value=Number(base().incomeFactor?.(country,'telecomPrice'));return Number.isFinite(value)&&value>0?value:1;}
function reach(country,id){if(id!=='home'&&id!=='family')return 1;const value=Number(base().incomeFactor?.(country,'broadbandReach'));return Number.isFinite(value)&&value>0?value:1;}
function capacity(m,branch,id,peerCount=null){const market=base().market(branch.country,branch.marketPopulation),q=PLAN_MARKET[id];return Math.max(100,Math.round(num(market[q.pool])*Math.min(.95,q.penetration*reach(branch.country,id))*MAX_MARKET_SHARE/(peerCount??peersIn(m,branch.country))));}
const growthFactor=level=>clamp(1+(1-level)*3,.6,1.4),churnFactor=level=>clamp(1+(level-1)*4,.5,1.6);
// The monthly recurring revenue of a branch at today's prices: what its next invoice bills.
// The price level (customer-base-core priceIndex) is kept on the market by the day's run (one number), so every reader
// of the monthly bill sees the same prices.
const marketPrices=m=>Number(m?.priceIndex)>0?Number(m.priceIndex):1;
function branchRecurring(m,branch){let total=0;for(const id of PLAN_IDS)total+=num(branch.plans?.[id]?.subscribers)*planPrice(id)*num(m.pricing[id]||1);return total*localPrice(branch.country)*marketPrices(m);}
function branchSubscribers(branch){let total=0;for(const id of PLAN_IDS)total+=num(branch.plans?.[id]?.subscribers);return total;}
function campaignCost(m,branch,peers=null){return Math.round(clamp(capacity(m,branch,'mobile',peers)*.4,200000,4000000));}

// The country's subscribers as one billed customer (one aggregate party per country, as the market cohorts use).
function marketParty(state,branch){
  const W=globalThis.GH_BUSINESS_WORLD;if(!W?.upsertParty)throw new Error('business-world-customer-owner-unavailable');
  const id=`TEL-MARKET-${asciiKey(branch.country)}`,existing=W.resolveParty?.(state,id);if(existing)return existing;
  const parties=Object.keys(state.businessWorld?.parties||{}).length,limit=480;
  const target=parties<limit?{id,name:`مشتركو الاتصالات · ${branch.country}`,country:branch.country}:{id:'TEL-MARKET-GROUP',name:'مشتركو الاتصالات',country:'دولي'};
  return W.resolveParty?.(state,target.id)||W.upsertParty(state,{id:target.id,name:target.name,displayName:target.name,legalName:target.name,role:'customer',industry:'شريحة عملاء اتصالات مجمعة',country:target.country,sectors:['telecom']});
}
function startBilling(state,branch){
  if(branch.partyId&&branch.nextBillingMonth)return;
  const party=marketParty(state,branch),F=finance(),period=F.calendarMonthForDay(today(state));
  branch.partyId=party.id;branch.contractId=`TEL-MKT-CONTRACT-${branch.id}`;
  if(!(state.finance?.commercialContracts||[]).some(row=>row.id===branch.contractId))F.execute({state},'register-commercial-contract',{company:'telecom',id:branch.contractId,contractType:'عقد خدمة اتصالات جماعية',title:`مشتركو السوق · ${branch.city||branch.country}`,counterparty:party.legalName||party.displayName,amount:0,currency:'USD',terms:{billing:'calendar-month',aggregation:'market-branch',country:branch.country,businessLocationId:branch.branchId,businessLocationName:branch.branchName,businessLocationCity:branch.branchCity,businessLocationCountry:branch.branchCountry},sourceRefs:[`TEL-MKT-${branch.id}`]});
  const serial=/^(\d{4})-(\d{2})$/.exec(period),next=serial?(Number(serial[2])===12?`${Number(serial[1])+1}-01`:`${serial[1]}-${String(Number(serial[2])+1).padStart(2,'0')}`):period;
  branch.nextBillingMonth=next;
}

// One business customer asks for lines on a contract term: the player accepts or declines it.
function generateRequest(state,m,day){
  if(m.requests.length>=MAX_OPEN_REQUESTS||m.contracts.filter(row=>row.status==='active').length>=MAX_CONTRACTS)return null;
  const active=m.branches.filter(row=>row.active);if(!active.length)return null;
  if(deterministic(`${day}:tel-request`,0,1)>=Math.min(.5,.1+.05*active.length))return null;
  if(!companies().namedCustomerRoom?.(state))return null;
  const seed=`${day}:tel-request`,branch=active[Math.floor(deterministic(`${seed}:branch`,0,active.length))%active.length],[kind,industry]=ENTERPRISES[Math.floor(deterministic(`${seed}:kind`,0,ENTERPRISES.length))%ENTERPRISES.length];
  const lines=Math.round(deterministic(`${seed}:lines`,5,200))*10,level=Math.round(deterministic(`${seed}:price`,.85,1)*100)/100,months=CONTRACT_TERMS[Math.floor(deterministic(`${seed}:term`,0,CONTRACT_TERMS.length))%CONTRACT_TERMS.length],price=Math.round(planPrice('business')*localPrice(branch.country)*marketPrices(m)*level*100)/100;
  const request={id:`TEL-REQ-${++m.sequence}`,day,expiresDay:day+REQUEST_DAYS,customerName:`${kind} · ${branch.city||branch.country}`,industry,branchRowId:branch.id,city:branch.city,country:branch.country,lines,monthlyPrice:price,priceLevel:level,months,monthlyValue:Math.round(lines*price*100)/100,networkCost:lines*PLAN_MARKET.business.networkCost*localPrice(branch.country)*marketPrices(m),status:'بانتظار القرار'};
  m.requests.push(request);return request;
}
function closeRequest(m,request,status,extra={}){m.requests=m.requests.filter(row=>row.id!==request.id);m.requestHistory.unshift({...request,...extra,status});m.requestHistory=m.requestHistory.slice(0,REQUEST_HISTORY);}
function decideRequest(state,p={}){
  const m=ensure(state),request=m.requests.find(row=>row.id===String(p.id||''));if(!request)throw new Error('telecom-request-not-found');
  const day=today(state);if(day>=Number(request.expiresDay)){closeRequest(m,request,'منتهي',{decidedDay:day});throw new Error('telecom-request-expired');}
  if(p.decision==='decline'||p.decision==='reject'){closeRequest(m,request,'معتذر عنه',{decidedDay:day});return {id:request.id,status:'معتذر عنه'};}
  if(p.decision!=='accept')throw new Error('telecom-request-decision-invalid');
  const branch=m.branches.find(row=>row.id===request.branchRowId&&row.active);if(!branch)throw new Error('telecom-request-branch-closed');
  const id=`ENT-${request.id.replace(/^TEL-REQ-/,'')}`,contractId=`TEL-ENT-CONTRACT-${id}`;
  const party=companies().enterpriseCustomer(state,{company:'telecom',customerName:request.customerName,industry:request.industry,country:request.country,contractId,reference:request.id,title:`عقد اتصالات مؤسسي · ${request.customerName}`,amount:request.monthlyValue*request.months,terms:{lines:request.lines,monthlyPrice:request.monthlyPrice,months:request.months,billing:'calendar-month',businessLocationId:branch.branchId,businessLocationName:branch.branchName,businessLocationCity:branch.branchCity,businessLocationCountry:branch.branchCountry}});
  const period=finance().calendarMonthForDay(day),serial=/^(\d{4})-(\d{2})$/.exec(period),next=Number(serial[2])===12?`${Number(serial[1])+1}-01`:`${serial[1]}-${String(Number(serial[2])+1).padStart(2,'0')}`;
  const contract={id,contractId,requestId:request.id,partyId:party.id,customer:request.customerName,planName:`اتصال أعمال · ${request.lines} خط`,activeCustomers:request.lines,monthlyPrice:request.monthlyPrice,months:request.months,startDay:day,endDay:day+request.months*30,country:branch.country,branchId:branch.branchId,branchName:branch.branchName,branchCity:branch.branchCity,branchCountry:branch.branchCountry,status:'active',nextBillingMonth:next,lastBilledMonth:'',invoiceCount:0,billed:0,collected:0,outstanding:0};
  m.contracts.push(contract);closeRequest(m,request,'مقبول',{decidedDay:day,contractId:id});return {id:request.id,status:'مقبول',contractId:id,monthlyValue:request.monthlyValue};
}
// All waiting requests in one decision, as insurance risks and tenant requests are decided (one durable command).
function decideRequestsBatch(state,p={}){
  if(!globalThis.GH_TRANSACTION_CORE?.isActive?.())throw new Error('telecom-batch-transaction-required');
  const m=ensure(state),batchId=String(p.batchId||'').trim(),periodId=String(p.periodId??Math.floor(today(state)/30)),decisions=Array.isArray(p.decisions)?p.decisions:[];
  if(!batchId||batchId.length>120)throw new Error('telecom-batch-id-required');if(!decisions.length||decisions.length>MAX_OPEN_REQUESTS)throw new Error('telecom-batch-size-invalid');
  const normalized=decisions.map(row=>({id:String(row?.id||''),decision:String(row?.decision||'')})).sort((a,b)=>a.id.localeCompare(b.id));
  if(normalized.some(row=>!row.id||!['accept','decline'].includes(row.decision)))throw new Error('telecom-batch-decision-invalid');if(new Set(normalized.map(row=>row.id)).size!==normalized.length)throw new Error('telecom-batch-duplicate-request');
  const fingerprint=JSON.stringify({periodId,decisions:normalized}),prior=m.decisionBatches.find(row=>row.batchId===batchId);if(prior){if(prior.fingerprint!==fingerprint)throw new Error('telecom-batch-reference-conflict');return clone(prior.result);}
  const items=[];let accepted=0,declined=0,skipped=0,monthlyValue=0;
  for(const item of normalized){const request=m.requests.find(row=>row.id===item.id);if(!request){items.push({requestId:item.id,status:'تجاوز',reason:'telecom-request-not-found'});skipped++;continue;}if(today(state)>=Number(request.expiresDay)){closeRequest(m,request,'منتهي',{decidedDay:today(state),batchId});items.push({requestId:item.id,status:'منتهي',reason:'telecom-request-expired'});skipped++;continue;}const result=decideRequest(state,item);items.push(result);if(item.decision==='accept'){accepted++;monthlyValue+=num(result.monthlyValue);}else declined++;}
  const result={batchId,periodId,accepted,declined,skipped,monthlyValue,items};m.decisionBatches.unshift({batchId,fingerprint,result:clone(result),at:now(state)});m.decisionBatches.splice(MAX_BATCHES);return result;
}
function setPlanPrice(state,p={}){
  const m=ensure(state),id=String(p.planId||'');if(!PLAN_IDS.includes(id))throw new Error('telecom-plan-invalid');const level=Number(p.level);if(!PRICE_LEVELS.includes(level))throw new Error('telecom-price-level-invalid');
  m.pricing[id]=level;for(const branch of m.branches){const subscribers=branchSubscribers(branch);branch.monthlyPrice=subscribers?branchRecurring(m,branch)/subscribers:0;}
  return {planId:id,level,monthlyPrice:Math.round(planPrice(id)*level*100)/100};
}
// Build 378: network investment. A branch starts on leased capacity (level 0: the network cost above). Each of up to
// three levels of its own network (sites, spectrum, backhaul) costs NETWORK_CAPEX_PER_PERSON of the branch's share of
// its country's people at the country's price level, paid once as capex and depreciated over NETWORK_LIFE_DAYS; each
// level cuts the network cost per subscriber by 12% and churn by 6%, and raises joining by 6%.
const NETWORK_MAX_LEVEL=3,NETWORK_CAPEX_PER_PERSON=5,NETWORK_LIFE_DAYS=2920,NETWORK_COST_CUT=.12,NETWORK_CHURN_CUT=.06,NETWORK_GROWTH=.06;
const networkLevel=branch=>clamp(Math.floor(num(branch?.networkLevel)),0,NETWORK_MAX_LEVEL);
function networkCapex(m,branch){const market=base().market(branch.country,branch.marketPopulation);return Math.round(num(market.population)*NETWORK_CAPEX_PER_PERSON*localPrice(branch.country)/peersIn(m,branch.country));}
function networkDepreciation(branch,day){return (Array.isArray(branch.networkAssets)?branch.networkAssets:[]).reduce((sum,row)=>sum+(day>=num(row.day)&&day<num(row.day)+NETWORK_LIFE_DAYS?num(row.cost)/NETWORK_LIFE_DAYS:0),0);}
function upgradeNetwork(state,p={}){
  const m=ensure(state),branch=m.branches.find(row=>row.id===p.branchId||row.facilityId===p.branchId);if(!branch)throw new Error('telecom-branch-not-found');if(!branch.active)throw new Error('telecom-branch-inactive');
  const level=networkLevel(branch);if(level>=NETWORK_MAX_LEVEL)throw new Error('telecom-network-max-level');
  const day=today(state),cost=networkCapex(m,branch),F=finance();if(!(globalThis.GH_FINANCE_CORE?.investorMode?.(state))&&num(F.operating?.(state,'telecom'))<cost)throw new Error('insufficient-cash');
  const payment=F.execute({state},'pay-by-cheque',{company:'telecom',amount:cost,note:`توسعة الشبكة · فرع ${branch.city||branch.country} · المستوى ${level+1}`,beneficiary:`مورد معدات الشبكة · ${branch.country}`,line:'capex',requestRef:`TEL-NETWORK-${branch.id}-${level+1}`});
  if(!payment?.cheque?.id||payment.cheque.status!=='مصروف')throw new Error('telecom-network-cheque-not-cleared');
  branch.networkLevel=level+1;branch.networkAssets=[...(Array.isArray(branch.networkAssets)?branch.networkAssets:[]),{level:level+1,cost,day}];m.ytd.networkCapex+=cost;
  return {branchId:branch.id,level:branch.networkLevel,cost,chequeId:payment.cheque.id};
}
const campaignRows=m=>globalThis.GH_BRANCH_CAMPAIGN.rows(m.branches,row=>row.active===true,(row,peers)=>campaignCost(m,row,peers));
function campaignQuote(state){const m=ensure(state);return globalThis.GH_BRANCH_CAMPAIGN.quote(state,'telecom',campaignRows(m),CAMPAIGN_DAYS);}
function companyCampaign(state,p){const m=ensure(state);return globalThis.GH_BRANCH_CAMPAIGN.launch(state,'telecom',m,campaignRows(m),p,CAMPAIGN_DAYS,cost=>{m.ytd.campaignCost+=cost;});}
function branchCampaign(state,p={}){
  const m=ensure(state),branch=m.branches.find(row=>row.id===p.branchId||row.facilityId===p.branchId);if(!branch)throw new Error('telecom-branch-not-found');if(!branch.active)throw new Error('telecom-branch-inactive');
  const day=today(state);if(Number(branch.campaignUntil)>day)throw new Error('telecom-campaign-running');
  const cost=campaignCost(m,branch),F=finance();if(!(globalThis.GH_FINANCE_CORE?.investorMode?.(state))&&num(F.operating?.(state,'telecom'))<cost)throw new Error('insufficient-cash');
  const payment=F.execute({state},'pay-by-cheque',{company:'telecom',amount:cost,note:`حملة تسويقية · فرع ${branch.city||branch.country} · ${CAMPAIGN_DAYS} يومًا`,beneficiary:`وكالة تسويق · ${branch.city||branch.country}`,line:'marketing',requestRef:`TEL-CAMPAIGN-${branch.id}-${day}`});
  if(!payment?.cheque?.id||payment.cheque.status!=='مصروف')throw new Error('telecom-campaign-cheque-not-cleared');
  branch.campaignUntil=day+CAMPAIGN_DAYS;branch.campaigns=Math.max(0,Math.floor(Number(branch.campaigns)||0))+1;branch.campaignSpend=num(branch.campaignSpend)+cost;m.ytd.campaignCost+=cost;
  return {branchId:branch.id,city:branch.city,cost,until:branch.campaignUntil,chequeId:payment.cheque.id};
}

// Build 377 (owner's decision, IFRS 15): a subscription's revenue is earned day by day as the service is given, not on
// the invoice day. Each branch and business contract accrues today's share of its monthly bill (the monthly amount over
// the days of the calendar month) into the current month; when the month closes, its accrued amount waits as one
// billable period and customer-companies-core bills exactly that amount on the next monthly run (billing in arrears).
// The company's daily report carries the accrual (revenue without cash); the invoice moves the receivable and the cash
// only, so nothing is counted twice. A row billed in advance for the current month by an older save starts accruing on
// the next month (that month is already in its results), and a row never billed starts today.
const round2=value=>Math.round(num(value)*100)/100;
function periodOf(day){return finance().calendarMonthForDay(day);}
function daysInPeriod(period){const match=/^(\d{4})-(\d{2})$/.exec(String(period));return match?new Date(Date.UTC(Number(match[1]),Number(match[2]),0)).getUTCDate():30;}
function nextPeriod(period){const match=/^(\d{4})-(\d{2})$/.exec(String(period));if(!match)return period;const y=Number(match[1]),mo=Number(match[2]);return mo===12?`${y+1}-01`:`${y}-${String(mo+1).padStart(2,'0')}`;}
function accrueRow(row,day,monthly){
  const period=periodOf(day);
  if(row.billing!=='arrears'){row.billing='arrears';row.accrualFromPeriod=row.lastBilledMonth===period?nextPeriod(period):period;row.billables=[];}
  row.billables=Array.isArray(row.billables)?row.billables:[];
  if(row.accrual&&row.accrual.period!==period){if(num(row.accrual.amount)>0)row.billables.push({period:row.accrual.period,amount:round2(row.accrual.amount)});row.accrual=null;}
  if(String(period)<String(row.accrualFromPeriod||period)||!(monthly>0))return 0;
  const today=monthly/daysInPeriod(period);row.accrual=row.accrual||{period,amount:0};row.accrual.amount=num(row.accrual.amount)+today;return today;
}
// The day: each branch's plans gain and lose subscribers; costs are the day's operating expense.
function* dayStages(state,p={}){
  const day=Math.max(0,Math.floor(Number(p.day??today(state)))),priorDay=Number(state?.customerCompanies?.companies?.telecom?.market?.lastProcessedDay),collectPeerCounts=!(Number.isFinite(priorDay)&&priorDay>=day),m=ensure(state,{collectPeerCounts});if(m.lastProcessedDay>=day)return m.dailyHistory.find(row=>row.day===day)||{day,idempotent:true};
  // Capacity depends on same-country active branches. ensure() counts peers while it already reconciles row activity;
  // this avoids four full branch-list filters per branch without adding another scan or a saved cache.
  const peersByCountry=activePeerCounts.get(m)||new Map();
  const B=base();m.priceIndex=typeof B.priceIndex==='function'?B.priceIndex(state):1;const demand=typeof B.demandFactor==='function'?B.demandFactor(state,'telecom'):1,byPlan=Object.fromEntries(PLAN_IDS.map(id=>[id,{subscribers:0,newSubscribers:0,lostSubscribers:0}]));
  let depreciation=0,networkCost=0,acquisitionCost=0,newSubscribers=0,lostSubscribers=0,subscribers=0,recurring=0,accrued=0;
  for(const branch of m.branches){
    const campaign=Number(branch.campaignUntil)>day,local=localPrice(branch.country)*marketPrices(m),rivalLevel=(typeof globalThis.GH_CUSTOMER_BASE?.rivalPrice==='function'?globalThis.GH_CUSTOMER_BASE.rivalPrice(branch.country,'telecom',day):1),affinity={households:B.affinity(state,branch.country,'telecom','households'),businesses:B.affinity(state,branch.country,'telecom','businesses')},network=networkLevel(branch);depreciation+=networkDepreciation(branch,day);
    for(const id of PLAN_IDS){
      // Build 377: joining and leaving follow the plan's price against the country's rival operator (rivalPrice).
      const q=PLAN_MARKET[id],row=branch.plans[id],level=num(m.pricing[id]||1)/rivalLevel,held=num(row.subscribers),seed=`${branch.id}:${day}:${id}`;
      const churn=q.churn*churnFactor(level)*(1-NETWORK_CHURN_CUT*network)*(campaign?CAMPAIGN_CHURN:1)*(branch.active?1:CLOSED_CHURN)/30,lost=Math.min(held,roundDraw(held*churn,`${seed}:lost`));
      const room=clamp(1-held/capacity(m,branch,id,Math.max(1,peersByCountry.get(branch.country)||0)),0,1),boost=1+Math.min(MAX_AFFINITY_BOOST,affinity[q.pool==='businesses'?'businesses':'households']*AFFINITY_WEIGHT);
      const joined=branch.active?Math.round(deterministic(`${seed}:new`,q.growth[0],q.growth[1])*growthFactor(level)*(1+NETWORK_GROWTH*network)*boost*demand*(campaign?CAMPAIGN_GROWTH:1)*room):0;
      row.subscribers=Math.max(0,held-lost+joined);row.newToday=joined;row.lostToday=lost;
      networkCost+=row.subscribers*q.networkCost*local*(1-NETWORK_COST_CUT*network)/30;acquisitionCost+=joined*q.acquisition*local;newSubscribers+=joined;lostSubscribers+=lost;
      byPlan[id].subscribers+=row.subscribers;byPlan[id].newSubscribers+=joined;byPlan[id].lostSubscribers+=lost;
    }
    const total=branchSubscribers(branch),monthly=branchRecurring(m,branch);
    branch.activeCustomers=total;branch.monthlyPrice=total?monthly/total:0;subscribers+=total;recurring+=monthly;
    if(total>0){startBilling(state,branch);branch.status='active';}else branch.status='idle';
    accrued+=accrueRow(branch,day,monthly);
    yield `telecom-market:${branch.id}`;
  }
  for(const contract of m.contracts){if(contract.status!=='active'){if(contract.billing==='arrears')accrueRow(contract,day,0);continue;}if(day>=Number(contract.endDay)){contract.status='ended';contract.endedDay=day;accrueRow(contract,day,0);continue;}networkCost+=num(contract.activeCustomers)*PLAN_MARKET.business.networkCost*localPrice(contract.country)*marketPrices(m)/30;const monthly=num(contract.activeCustomers)*num(contract.monthlyPrice);recurring+=monthly;accrued+=accrueRow(contract,day,monthly);}
  for(const request of [...m.requests])if(day>=Number(request.expiresDay))closeRequest(m,request,'منتهي',{decidedDay:day});
  const newRequest=generateRequest(state,m,day);
  const cashExpense=networkCost+acquisitionCost,expense=cashExpense+depreciation,report={day,revenue:0,accrued:round2(accrued),expense,cashExpense,networkCost,acquisitionCost,depreciation,newSubscribers,lostSubscribers,subscribers,monthlyRecurring:recurring,activeContracts:m.contracts.filter(row=>row.status==='active').length,newRequest:newRequest?.id||null,byPlan};
  m.ytd.networkCost+=networkCost;m.ytd.depreciation+=depreciation;m.ytd.acquisitionCost+=acquisitionCost;m.ytd.newSubscribers+=newSubscribers;m.ytd.lostSubscribers+=lostSubscribers;
  if(m.dailyHistory[0]?.byPlan){const {byPlan:_detail,...totals}=m.dailyHistory[0];m.dailyHistory[0]=totals;}
  m.dailyHistory.unshift(report);m.dailyHistory=m.dailyHistory.slice(0,DAILY_HISTORY);m.lastProcessedDay=day;
  yield 'telecom-market:close';
  return clone(report);
}
function tickDay(state,p={}){const stages=dayStages(state,p);let step;while(!(step=stages.next()).done){}return step.value;}
// The generic daily close posts the network and acquisition costs; revenue arrives on the monthly invoices.
// The day's invoices (customer-companies-core records them as invoiced) are its revenue without cash: they posted it.
function dailyResult(state,day){const row=(read(state)?.dailyHistory||[]).find(item=>Number(item.day)===Number(day));return row?{revenue:num(row.accrued)+num(row.invoiced),cashRevenue:0,expense:num(row.expense),cashExpense:num(row.cashExpense??row.expense)}:{revenue:0,cashRevenue:0,expense:0,cashExpense:0};}
function summary(state){
  const m=read(state);if(!m)return {branches:0,activeBranches:0,subscribers:0,monthlyRecurring:0,byPlan:Object.fromEntries(PLAN_IDS.map(id=>[id,0])),pricing:Object.fromEntries(PLAN_IDS.map(id=>[id,1])),openRequests:0,activeContracts:0,last:null};
  const branches=Array.isArray(m.branches)?m.branches:[],byPlan=Object.fromEntries(PLAN_IDS.map(id=>[id,branches.reduce((sum,row)=>sum+num(row.plans?.[id]?.subscribers),0)]));
  const contracts=(Array.isArray(m.contracts)?m.contracts:[]).filter(row=>row.status==='active');
  return {branches:branches.length,activeBranches:branches.filter(row=>row.active).length,subscribers:Object.values(byPlan).reduce((a,b)=>a+b,0),monthlyRecurring:branches.reduce((sum,row)=>sum+num(row.activeCustomers)*num(row.monthlyPrice),0)+contracts.reduce((sum,row)=>sum+num(row.activeCustomers)*num(row.monthlyPrice),0),byPlan,pricing:{...(m.pricing||{})},openRequests:(m.requests||[]).length,activeContracts:contracts.length,contractLines:contracts.reduce((sum,row)=>sum+num(row.activeCustomers),0),last:(m.dailyHistory||[])[0]||null};
}
function execute(ctx,cmd,p={}){const state=ctx.state||ctx;switch(cmd){case'set-plan-price':return setPlanPrice(state,p);case'branch-campaign':return branchCampaign(state,p);case'branch-campaigns':return companyCampaign(state,p);case'upgrade-network':return upgradeNetwork(state,p);case'decide-request':return decideRequest(state,p);case'decide-requests-batch':return decideRequestsBatch(state,p);case'tick-day':return tickDay(state,p);default:throw new Error(`Unknown telecom market command: ${cmd}`);}}

const API=Object.freeze({NETWORK_MAX_LEVEL,networkCapex,networkLevel,VERSION,PLAN_IDS,PRICE_LEVELS,PRICE_LABELS,PLAN_MARKET,MAX_MARKET_SHARE,CAMPAIGN_DAYS,MAX_OPEN_REQUESTS,REQUEST_DAYS,read,ensure,capacity,campaignCost,campaignQuote,planPrice,planLabel,branchRecurring,localPrice,dayStages,tickDay,dailyResult,summary,execute});
globalThis.GH_TELECOM_MARKET=API;if(globalThis.window&&window!==globalThis)window.GH_TELECOM_MARKET=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
