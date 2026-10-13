/* Build 374 · مدار: the car dealership's market, grown from the unified customer base (customer-base-core).
   Every showroom sells to its country: 2-8 buyers a day at the retail price, more at a 5% or 10% discount, more where
   the group's other companies already serve households (bounded at +15%), within 10% of the country's yearly new-car
   sales (2% of its people) shared by the group's showrooms there. A buyer takes a model in stock (cheaper models sell
   more); a model out of stock loses the sale. The player chooses the price stance, the stock cover (30, 45 or 60 days:
   the stock is reordered from the makers every two weeks through the existing purchase order, invoice and cheque) and the
   service plan offered after a sale (three tiers, taken by a share of buyers and billed monthly). At most once a day a
   company orders a fleet financed by the group's bank through the existing customer-finance request (the bank finances
   from its $1M minimum), and a financed sale settles by itself once the bank's transfer is proven. Nothing is typed in.
   Money: the day's retail sales and the workshop cost of the plans (45% of their price) are the company's daily revenue
   and operating expense through the generic daily close (its usual document and terms, no document per sale); service
   plans are billed once a calendar month per showroom; the stock is reordered every two weeks. Catalogue prices and margins are unchanged. Load: showrooms x models a day; the
   saved rows are per showroom, not per car. Manually entered sales and plans of older saves keep running as before. */
(()=>{'use strict';
const VERSION='GH-DEALER-MARKET-1.0.0',DAY=86400;
const PRICE_LEVELS=Object.freeze([1,.95,.9]);
const PRICE_LABELS=Object.freeze({'1':'سعر التجزئة','0.95':'خصم 5%','0.9':'خصم 10%'});
const DEMAND_BY_PRICE=Object.freeze({'1':1,'0.95':1.35,'0.9':1.75});
const COVER_DAYS=Object.freeze([30,45,60]);
const SERVICE_TIERS=Object.freeze({
  basic:Object.freeze({id:'basic',label:'صيانة أساسية',monthlyPrice:29,attach:.35}),
  standard:Object.freeze({id:'standard',label:'صيانة شاملة',monthlyPrice:49,attach:.25}),
  premium:Object.freeze({id:'premium',label:'صيانة وضمان ممتد',monthlyPrice:89,attach:.15})
});
const SERVICE_IDS=Object.freeze(Object.keys(SERVICE_TIERS));
const BUYERS=Object.freeze([2,8]),YEARLY_CARS_PER_PERSON=.02,MAX_MARKET_SHARE=.1,AFFINITY_WEIGHT=.5,MAX_AFFINITY_BOOST=.15;
const SERVICE_MONTHS=36,WORKSHOP_COST=.45,RESTOCK_EVERY=14,FINANCE_CHANCE=.15;
const CAMPAIGN_DAYS=30,CAMPAIGN_GROWTH=1.6,DAILY_HISTORY=90;
const num=value=>Math.max(0,Number(value)||0),clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value)||0));
const now=state=>Number(state?.simSeconds)||0,today=state=>Math.floor(now(state)/DAY);
const clone=value=>globalThis.structuredClone?structuredClone(value):JSON.parse(JSON.stringify(value));
function hash(text){let h=2166136261>>>0;for(const ch of String(text)){h^=ch.codePointAt(0);h=Math.imul(h,16777619)>>>0;}return h>>>0;}
function deterministic(seed,min,max){return min+(hash(seed)/4294967295)*(max-min);}
const roundDraw=(value,seed)=>Math.floor(Math.max(0,value)+deterministic(seed,0,1));
const asciiKey=text=>hash(text).toString(36).toUpperCase().padStart(7,'0');
const base=()=>{const B=globalThis.GH_CUSTOMER_BASE;if(!B?.market||!B?.affinity)throw new Error('customer-base-unavailable');return B;};
const companies=()=>{const C=globalThis.GH_CUSTOMER_COMPANIES_CORE;if(!C?.ensure||!C?.dealerOps)throw new Error('customer-companies-unavailable');return C;};
const finance=()=>{const F=globalThis.GH_FINANCE_CORE;if(!F?.execute)throw new Error('finance-core-missing');return F;};
// The catalogue (customer-companies-core OEMS): every model with its maker, wholesale cost and retail price.
function catalogue(){const rows=[];for(const oem of globalThis.GH_CUSTOMER_COMPANIES_CORE?.OEMS||[])for(const model of oem.models||[])rows.push({oemId:oem.id,maker:oem.displayName,modelId:model.id,name:model.name,segment:model.segment,cost:Number(model.cost)||0,retail:Number(model.retail)||0});return rows;}
// Cheaper models sell more: a model's share of buyers is inversely proportional to its retail price.
function modelShares(models){const weights=models.map(row=>1/Math.max(1,row.retail)),total=weights.reduce((a,b)=>a+b,0)||1;return models.map((row,index)=>({...row,share:weights[index]/total}));}

function read(state){return state?.customerCompanies?.companies?.dealership?.market||null;}
function ensure(state){
  companies().ensure(state);const data=state.customerCompanies.companies.dealership;
  const m=data.market=data.market&&typeof data.market==='object'&&!Array.isArray(data.market)?data.market:{};
  m.version=VERSION;m.priceLevel=PRICE_LEVELS.includes(Number(m.priceLevel))?Number(m.priceLevel):1;m.coverDays=COVER_DAYS.includes(Number(m.coverDays))?Number(m.coverDays):45;m.serviceTier=SERVICE_TIERS[m.serviceTier]?m.serviceTier:'standard';
  for(const key of ['showrooms','dailyHistory'])m[key]=Array.isArray(m[key])?m[key].filter(Boolean):[];
  m.lastProcessedDay=Number.isFinite(Number(m.lastProcessedDay))?Math.floor(Number(m.lastProcessedDay)):-1;m.lastRestockDay=Number.isFinite(Number(m.lastRestockDay))?Math.floor(Number(m.lastRestockDay)):-1;m.financeSequence=Math.max(0,Math.floor(Number(m.financeSequence)||0));
  m.ytd=m.ytd&&typeof m.ytd==='object'?m.ytd:{};for(const key of ['carsSold','salesRevenue','lostSales','restockSpend','workshopCost','campaignCost','plansSold'])m.ytd[key]=num(m.ytd[key]);
  syncShowrooms(state,m);return m;
}
function ownedShowrooms(state){return (Array.isArray(state.customHubs)?state.customHubs:[]).filter(row=>row?.owned===true&&row.kind==='dealership-branch'&&String(row.ownerCompanyId||row.company||'')==='dealership');}
function syncShowrooms(state,m){
  const owned=ownedShowrooms(state),byFacility=new Map(m.showrooms.map(row=>[row.facilityId,row]));
  for(const facility of owned){
    let row=byFacility.get(facility.id);
    if(!row){const country=String(facility.country||'غير محدد'),city=String(facility.city||'');row={id:`SHOW-${asciiKey(facility.id)}`,facilityId:String(facility.id),branchId:String(facility.id),branchName:String(facility.name||`معرض ${city}`).slice(0,120),branchCity:city.slice(0,80),branchCountry:country.slice(0,80),city,country,marketPopulation:base().population(country),openedDay:today(state),active:true,buyers:0,annualRate:0,soldToday:0,lostToday:0,salesToday:0,salesTotal:0,campaignUntil:0,campaigns:0,campaignSpend:0,servicePlans:0,planName:'خطط صيانة',partyId:null,status:'idle',activeCustomers:0,monthlyPrice:0,nextBillingMonth:'',lastBilledMonth:'',invoiceCount:0,billed:0,collected:0,outstanding:0};m.showrooms.push(row);byFacility.set(facility.id,row);}
    row.active=true;
  }
  const open=new Set(owned.map(row=>String(row.id)));for(const row of m.showrooms)if(!open.has(row.facilityId))row.active=false;
  return m.showrooms;
}
function peersIn(m,country){return Math.max(1,m.showrooms.filter(row=>row.active&&row.country===country).length);}
function yearlyCapacity(m,showroom){const people=base().market(showroom.country,showroom.marketPopulation).population;return Math.max(200,Math.round(people*YEARLY_CARS_PER_PERSON*MAX_MARKET_SHARE/peersIn(m,showroom.country)));}
function campaignCost(m,showroom){return Math.round(clamp(yearlyCapacity(m,showroom)*20,150000,3000000));}
const demandFactor=level=>DEMAND_BY_PRICE[String(level)]||1;
// The buyers a showroom expects in a day at today's choices (no draw): what the weekly reorder plans for.
function expectedBuyers(m,showroom,day){if(!showroom.active)return 0;return (BUYERS[0]+BUYERS[1])/2*demandFactor(m.priceLevel)*(Number(showroom.campaignUntil)>day?CAMPAIGN_GROWTH:1);}
function marketParty(state,showroom){
  const W=globalThis.GH_BUSINESS_WORLD;if(!W?.upsertParty)throw new Error('business-world-customer-owner-unavailable');
  const id=`AUTO-MARKET-${asciiKey(showroom.country)}`,existing=W.resolveParty?.(state,id);if(existing)return existing;
  const parties=Object.keys(state.businessWorld?.parties||{}).length,target=parties<480?{id,name:`عملاء التجزئة للسيارات · ${showroom.country}`,country:showroom.country}:{id:'AUTO-MARKET-GROUP',name:'عملاء التجزئة للسيارات',country:'دولي'};
  return W.resolveParty?.(state,target.id)||W.upsertParty(state,{id:target.id,name:target.name,displayName:target.name,legalName:target.name,role:'customer',industry:'شريحة مشتري سيارات مجمعة',country:target.country,sectors:['dealership']});
}
function nextMonthOf(state,day){const period=finance().calendarMonthForDay(day),m=/^(\d{4})-(\d{2})$/.exec(period);return Number(m[2])===12?`${Number(m[1])+1}-01`:`${m[1]}-${String(Number(m[2])+1).padStart(2,'0')}`;}

function setPrice(state,p={}){const m=ensure(state),level=Number(p.level);if(!PRICE_LEVELS.includes(level))throw new Error('dealership-price-level-invalid');m.priceLevel=level;return {level,label:PRICE_LABELS[String(level)]};}
function setCover(state,p={}){const m=ensure(state),days=Number(p.days);if(!COVER_DAYS.includes(days))throw new Error('dealership-cover-days-invalid');m.coverDays=days;return {days};}
function setServiceTier(state,p={}){const m=ensure(state),tier=SERVICE_TIERS[String(p.tier||'')];if(!tier)throw new Error('dealership-service-tier-invalid');m.serviceTier=tier.id;for(const row of m.showrooms)row.monthlyPrice=row.servicePlans?tier.monthlyPrice:0;return {tier:tier.id,monthlyPrice:tier.monthlyPrice};}
function showroomCampaign(state,p={}){
  const m=ensure(state),showroom=m.showrooms.find(row=>row.id===p.showroomId||row.facilityId===p.showroomId);if(!showroom)throw new Error('dealership-showroom-not-found');if(!showroom.active)throw new Error('dealership-showroom-inactive');
  const day=today(state);if(Number(showroom.campaignUntil)>day)throw new Error('dealership-campaign-running');
  const cost=campaignCost(m,showroom),F=finance();if(!(state.godMoney&&state.infiniteMoney)&&num(F.operating?.(state,'dealership'))<cost)throw new Error('insufficient-cash');
  const payment=F.execute({state},'pay-by-cheque',{company:'dealership',amount:cost,note:`حملة تسويقية · معرض ${showroom.city||showroom.country} · ${CAMPAIGN_DAYS} يومًا`,beneficiary:`وكالة تسويق · ${showroom.city||showroom.country}`,line:'marketing',requestRef:`AUTO-CAMPAIGN-${showroom.id}-${day}`});
  if(!payment?.cheque?.id||payment.cheque.status!=='مصروف')throw new Error('dealership-campaign-cheque-not-cleared');
  showroom.campaignUntil=day+CAMPAIGN_DAYS;showroom.campaigns=Math.max(0,Math.floor(Number(showroom.campaigns)||0))+1;showroom.campaignSpend=num(showroom.campaignSpend)+cost;m.ytd.campaignCost+=cost;
  return {showroomId:showroom.id,city:showroom.city,cost,until:showroom.campaignUntil,chequeId:payment.cheque.id};
}

// The reorder, every two weeks: each model is brought back to the chosen cover of expected sales when below half of it,
// in one purchase order per maker (one invoice and one cheque per maker, at most six a round).
function restock(state,m,day,inventory,shares){
  const ops=companies().dealerOps,expected=m.showrooms.reduce((sum,row)=>sum+expectedBuyers(m,row,day),0),orders=[];if(!expected)return orders;
  const F=finance(),unlimited=state.godMoney&&state.infiniteMoney;let cash=unlimited?Infinity:num(F.operating?.(state,'dealership'));
  const byMaker=new Map();
  for(const model of shares){
    const line=inventory.find(row=>row.oemId===model.oemId&&row.modelId===model.modelId),available=line?num(line.quantity)-num(line.reserved):0,target=Math.ceil(expected*model.share*m.coverDays);
    if(target<1||available>=target/2)continue;
    const quantity=Math.min(5000,target-available);if(quantity<1)continue;
    const order=byMaker.get(model.oemId)||{oemId:model.oemId,lines:[],amount:0};order.lines.push({modelId:model.modelId,quantity});order.amount+=quantity*model.cost;byMaker.set(model.oemId,order);
  }
  for(const order of byMaker.values()){
    if(order.amount>cash)continue;
    const result=ops.addStockBatch(state,{oemId:order.oemId,lines:order.lines,reference:`AUTO-RESTOCK-${order.oemId}-${day}`});cash-=order.amount;m.ytd.restockSpend+=order.amount;orders.push({oemId:order.oemId,quantity:result.quantity,amount:order.amount,invoiceNumber:result.invoiceNumber});
  }
  return orders;
}
// At most one company a day orders a small fleet of one model and asks the group's bank to finance it, through the
// existing customer-finance request. The bank's consumer financing starts at its product minimum ($1M), so only an
// order the bank would finance in full is offered; the quote is checked before any customer is recorded.
const FLEET_FINANCE_MIN=1000000,FLEET_MAX_UNITS=25;
// Ten recurring fleet buyers: a returning company is the same named customer, so the named-customer limit lasts.
const FLEET_BUYERS=Object.freeze(['شركة تأجير السيارات المتحدة','مجموعة النقل المؤسسي','شركة خدمات المرافق الوطنية','شركة الأمن والحراسة الحديثة','مجموعة الضيافة الإقليمية','شركة الإنشاءات المتقدمة','شركة التوزيع الغذائي','شركة خدمات الحقول النفطية','مجموعة الرعاية الصحية الخاصة','شركة الاتصالات الميدانية']);
function financeRequest(state,m,day,inventory){
  const ops=companies().dealerOps,bank=state.bank,platform=globalThis.GH_COMPANY_PLATFORM,B=globalThis.GH_BANKING_CORE;
  if(typeof B?.customerFinancingQuote!=='function'||!platform?.resolveCompany?.(state,'bank')?.operational||!Array.isArray(bank?.loanRequests)||bank.loanRequests.length>=(Number(B.MAX_OPEN_REQUESTS)||5))return null;
  if(!companies().namedCustomerRoom?.(state)||deterministic(`${day}:auto-finance`,0,1)>=FINANCE_CHANCE)return null;
  const active=m.showrooms.filter(row=>row.active),fleets=catalogue().map(model=>{const price=Math.round(model.retail*m.priceLevel),quantity=Math.ceil(FLEET_FINANCE_MIN/Math.max(1,price));return {model,price,quantity};}).filter(item=>item.quantity<=FLEET_MAX_UNITS);
  if(!active.length||!fleets.length)return null;
  const showroom=active[Math.floor(deterministic(`${day}:auto-finance:showroom`,0,active.length))%active.length],fleet=fleets[Math.floor(deterministic(`${day}:auto-finance:model`,0,fleets.length))%fleets.length],total=fleet.price*fleet.quantity;
  let quote=null;try{quote=B.customerFinancingQuote(state,{invoiceAmount:total,downPayment:0,product:'consumer',termDays:1825});}catch(_error){quote=null;}
  if(!quote||Math.abs(Number(quote.disbursementAmount)-total)>.01||Math.abs(Number(quote.invoiceAmount)-total)>.01)return null;
  // A fleet is ordered from its maker for the deal: the shortfall is bought first (if the bank declines, the cars stay
  // in stock for retail buyers).
  const line=inventory.find(row=>row.oemId===fleet.model.oemId&&row.modelId===fleet.model.modelId),short=Math.max(0,fleet.quantity-(line?num(line.quantity)-num(line.reserved):0)),cost=short*fleet.model.cost;
  if(short>0&&!(state.godMoney&&state.infiniteMoney)&&num(finance().operating?.(state,'dealership'))<cost)return null;
  const n=++m.financeSequence;
  if(short>0){ops.addStock(state,{modelId:fleet.model.modelId,quantity:short,reference:`AUTO-FLEET-STOCK-${n}`});m.ytd.restockSpend+=cost;}
  return ops.sellVehicle(state,{saleId:`AUTO-MKT-FIN-${n}`,customerName:FLEET_BUYERS[Math.floor(deterministic(`${day}:auto-finance:buyer`,0,FLEET_BUYERS.length))%FLEET_BUYERS.length],industry:'أسطول سيارات شركة',country:showroom.country,modelId:fleet.model.modelId,quantity:fleet.quantity,unitPrice:fleet.price,financeRequested:true,branchId:showroom.branchId});
}
// A financed sale settles by itself once the bank's transfer is proven (the existing verified settlement).
function settleFinanced(state,data){
  const ops=companies().dealerOps,settled=[];
  for(const sale of (data.sales||[]).filter(row=>row&&['awaiting-bank-decision','awaiting-finance-settlement'].includes(row.status)).slice(0,10)){
    try{const result=ops.settleFinancedSale(state,{saleId:sale.id});if(result?.status==='sold-financed')settled.push(sale.id);}catch(_error){/* stays for the next day */}
  }
  return settled;
}

function* dayStages(state,p={}){
  const m=ensure(state),day=Math.max(0,Math.floor(Number(p.day??today(state))));if(m.lastProcessedDay>=day)return m.dailyHistory.find(row=>row.day===day)||{day,idempotent:true};
  const C=companies(),ops=C.dealerOps,data=state.customerCompanies.companies.dealership,B=base();
  if(m.showrooms.some(row=>row.active))ops.ensureSupplyAgreements(state);
  const inventory=data.inventory,shares=modelShares(catalogue());
  let orders=[];if(m.showrooms.some(row=>row.active)&&(m.lastRestockDay<0||day-m.lastRestockDay>=RESTOCK_EVERY)){orders=restock(state,m,day,inventory,shares);m.lastRestockDay=day;}
  yield 'dealer-market:restock';
  const tier=SERVICE_TIERS[m.serviceTier];
  let carsSold=0,salesRevenue=0,lostSales=0,plansSold=0,plansEnded=0,workshopCost=0;
  for(const showroom of m.showrooms){
    let sold=0,lost=0,revenue=0;
    if(showroom.active){
      const room=clamp(1-num(showroom.annualRate)/yearlyCapacity(m,showroom),0,1),boost=1+Math.min(MAX_AFFINITY_BOOST,B.affinity(state,showroom.country,'dealership','households')*AFFINITY_WEIGHT);
      const buyers=Math.round(deterministic(`${showroom.id}:${day}:buyers`,BUYERS[0],BUYERS[1])*demandFactor(m.priceLevel)*boost*(Number(showroom.campaignUntil)>day?CAMPAIGN_GROWTH:1)*room);
      for(let index=0;index<buyers;index++){
        const pick=deterministic(`${showroom.id}:${day}:pick:${index}`,0,1);let acc=0,model=shares[shares.length-1];for(const row of shares){acc+=row.share;if(pick<acc){model=row;break;}}
        const line=inventory.find(row=>row.oemId===model.oemId&&row.modelId===model.modelId);
        if(!line||num(line.quantity)-num(line.reserved)<1){lost++;continue;}
        line.quantity-=1;line.sold=num(line.sold)+1;sold++;revenue+=Math.round(num(line.retailPrice)*m.priceLevel);
      }
    }
    const joined=roundDraw(sold*tier.attach,`${showroom.id}:${day}:plans`),ended=Math.min(num(showroom.servicePlans),roundDraw(num(showroom.servicePlans)/(SERVICE_MONTHS*30),`${showroom.id}:${day}:plans-end`));
    showroom.servicePlans=num(showroom.servicePlans)-ended+joined;showroom.activeCustomers=showroom.servicePlans;showroom.monthlyPrice=showroom.servicePlans?tier.monthlyPrice:0;
    if(showroom.servicePlans>0){if(!showroom.partyId)showroom.partyId=marketParty(state,showroom).id;if(!showroom.nextBillingMonth)showroom.nextBillingMonth=nextMonthOf(state,day);showroom.status='active';}else showroom.status='idle';
    workshopCost+=showroom.servicePlans*tier.monthlyPrice*WORKSHOP_COST/30;
    showroom.buyers=num(showroom.buyers)+sold;showroom.annualRate=num(showroom.annualRate)*(1-1/365)+sold;showroom.soldToday=sold;showroom.lostToday=lost;showroom.salesToday=revenue;showroom.salesTotal=num(showroom.salesTotal)+revenue;
    carsSold+=sold;salesRevenue+=revenue;lostSales+=lost;plansSold+=joined;plansEnded+=ended;
    yield `dealer-market:${showroom.id}`;
  }
  const financeSale=m.showrooms.some(row=>row.active)?financeRequest(state,m,day,inventory):null,settled=settleFinanced(state,data);
  const report={day,revenue:salesRevenue,cashRevenue:salesRevenue,expense:workshopCost,cashExpense:workshopCost,workshopCost,carsSold,salesRevenue,lostSales,plansSold,plansEnded,servicePlans:m.showrooms.reduce((sum,row)=>sum+num(row.servicePlans),0),restockOrders:orders.length,restockUnits:orders.reduce((sum,row)=>sum+row.quantity,0),restockSpend:orders.reduce((sum,row)=>sum+row.amount,0),financeRequest:financeSale?.id||null,settledFinanced:settled.length};
  m.ytd.carsSold+=carsSold;m.ytd.salesRevenue+=salesRevenue;m.ytd.lostSales+=lostSales;m.ytd.workshopCost+=workshopCost;m.ytd.plansSold+=plansSold;
  m.dailyHistory.unshift(report);m.dailyHistory=m.dailyHistory.slice(0,DAILY_HISTORY);m.lastProcessedDay=day;
  yield 'dealer-market:close';
  return clone(report);
}
function tickDay(state,p={}){const stages=dayStages(state,p);let step;while(!(step=stages.next()).done){}return step.value;}
// The generic daily close posts the day's retail sales (on its usual terms and document, as insurance premiums and unit
// sales are posted) and the workshop cost; service plans arrive on their monthly invoices.
function dailyResult(state,day){const row=(read(state)?.dailyHistory||[]).find(item=>Number(item.day)===Number(day));return row?{revenue:num(row.revenue),cashRevenue:num(row.cashRevenue??row.revenue),expense:num(row.expense),cashExpense:num(row.cashExpense??row.expense)}:{revenue:0,cashRevenue:0,expense:0,cashExpense:0};}
function summary(state){
  const m=read(state),inventory=state?.customerCompanies?.companies?.dealership?.inventory||[];
  const stock=inventory.reduce((sum,row)=>sum+Math.max(0,num(row.quantity)-num(row.reserved)),0);
  if(!m)return {showrooms:0,activeShowrooms:0,priceLevel:1,coverDays:45,serviceTier:'standard',carsSold:0,servicePlans:0,stock,last:null,ytd:null};
  const showrooms=Array.isArray(m.showrooms)?m.showrooms:[];
  return {showrooms:showrooms.length,activeShowrooms:showrooms.filter(row=>row.active).length,priceLevel:m.priceLevel,coverDays:m.coverDays,serviceTier:m.serviceTier,carsSold:showrooms.reduce((sum,row)=>sum+num(row.buyers),0),servicePlans:showrooms.reduce((sum,row)=>sum+num(row.servicePlans),0),stock,last:(m.dailyHistory||[])[0]||null,ytd:m.ytd?{...m.ytd}:null};
}
function execute(ctx,cmd,p={}){const state=ctx.state||ctx;switch(cmd){case'set-price':return setPrice(state,p);case'set-cover':return setCover(state,p);case'set-service-tier':return setServiceTier(state,p);case'showroom-campaign':return showroomCampaign(state,p);case'tick-day':return tickDay(state,p);default:throw new Error(`Unknown dealer market command: ${cmd}`);}}

const API=Object.freeze({VERSION,PRICE_LEVELS,PRICE_LABELS,COVER_DAYS,SERVICE_TIERS,SERVICE_IDS,BUYERS,MAX_MARKET_SHARE,CAMPAIGN_DAYS,read,ensure,yearlyCapacity,campaignCost,catalogue,dayStages,tickDay,dailyResult,summary,execute});
globalThis.GH_DEALER_MARKET=API;if(globalThis.window&&window!==globalThis)window.GH_DEALER_MARKET=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
