(()=>{
  'use strict';
  // Owner (build 97): four service companies (media and production, healthcare, education, a sports club) on one engine.
  // Each is a row of data here and a company definition (company-definitions.js). A facility the company opens through
  // the ordinary facility path (a studio, a hospital, a school, a stadium; its build cost and daily running cost are the
  // definition's site template, posted with every facility's) earns each day from its own utilization; the daily close
  // calls onFinancialDay once per operating company (company-adapters-core, operations 'service-company-v1') and the
  // economics close reads dailyResult and posts it to finance. A world that opens none of them runs none of this. Work per
  // day: one pass over the company's own facilities; the save keeps a short history per company.
  const VERSION='GH-SERVICE-COMPANIES-1.0.0',SCHEMA='gh-service-companies/v1',HISTORY=30,MAX_SITES=512;
  const LEVELS=Object.freeze({low:{price:.92,demand:.06,label:'سعر منافس'},market:{price:1,demand:0,label:'سعر السوق'},high:{price:1.08,demand:-.06,label:'سعر مرتفع'}});
  // Figures per facility (owner-approved, build 97). daily(u) is the day's revenue at utilization u (USD, before the
  // country's price level); direct is the share of revenue spent on staff and supplies beyond the facility's running cost;
  // collected is the share of revenue collected (the rest is bad debt).
  const SECTORS=Object.freeze({
    media:Object.freeze({capability:'operations.media',facilityKind:'media-studio',unit:'مشروع',lo:.55,mid:.70,hi:.85,direct:.75,collected:1,
      daily:u=>2000000/30*u,measure:u=>({label:'استغلال الاستوديو',value:u,detail:`${Math.round(6*u*10)/10} مشروع شهريًا`})}),
    healthcare:Object.freeze({capability:'operations.healthcare',facilityKind:'hospital',unit:'سرير',lo:.65,mid:.75,hi:.85,direct:.60,collected:1,
      daily:u=>150*u*1100+400*(u/.75)*90,measure:u=>({label:'إشغال الأسرّة',value:u,detail:`${Math.round(150*u)} سريرًا مشغولًا · ${Math.round(400*u/.75)} مراجعة يوميًا`})}),
    education:Object.freeze({capability:'operations.education',facilityKind:'school',unit:'طالب',lo:.70,mid:.85,hi:.95,direct:.50,collected:.98,
      daily:u=>1200*u*12000/365,measure:u=>({label:'نسبة التسجيل',value:u,detail:`${Math.round(1200*u)} طالبًا · رسوم سنوية 12,000`})}),
    sports:Object.freeze({capability:'operations.sports',facilityKind:'stadium',unit:'مقعد',lo:.50,mid:.70,hi:.90,direct:.62,collected:1,
      daily:u=>(2*25000*u*28+8000*(u/.70)*40+1200000)/30,measure:u=>({label:'حضور المباريات',value:u,detail:`${Math.round(25000*u)} مشجعًا للمباراة · ${Math.round(8000*u/.70)} عضوًا`})})
  });
  const FACILITY_KINDS=Object.freeze(Object.values(SECTORS).map(row=>row.facilityKind));
  const num=v=>Number.isFinite(Number(v))?Number(v):0,clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),cents=v=>Math.round(v*100)/100,today=s=>Math.floor(num(s?.simSeconds)/86400);
  const platform=()=>globalThis.GH_COMPANY_PLATFORM;
  function hash(text){let h=2166136261>>>0;for(const ch of String(text)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}return h>>>0;}
  function sectorOf(state,companyId){
    const definition=platform()?.definitionFor?.(state,companyId);if(!definition)return null;
    for(const [id,row] of Object.entries(SECTORS))if(definition.capabilities?.includes(row.capability))return {id,...row};
    return null;
  }
  function root(state){
    const out=state.serviceCompanies=state.serviceCompanies&&typeof state.serviceCompanies==='object'&&!Array.isArray(state.serviceCompanies)?state.serviceCompanies:{schema:SCHEMA,companies:{}};
    out.schema=SCHEMA;out.companies=out.companies&&typeof out.companies==='object'&&!Array.isArray(out.companies)?out.companies:{};return out;
  }
  function ensure(state,companyId){
    const all=root(state),id=String(companyId||'');if(!sectorOf(state,id))throw new Error('service-company-unknown');
    const row=all.companies[id]=all.companies[id]&&typeof all.companies[id]==='object'?all.companies[id]:{priceLevel:'market',lastDay:null,history:[],ytd:{revenue:0,expense:0}};
    if(!LEVELS[row.priceLevel])row.priceLevel='market';if(!Array.isArray(row.history))row.history=[];row.ytd=row.ytd&&typeof row.ytd==='object'?row.ytd:{revenue:0,expense:0};
    return row;
  }
  function read(state,companyId){return state?.serviceCompanies?.companies?.[String(companyId||'')]||null;}
  function sitesOf(state,companyId,kind){
    const out=[];for(const f of Array.isArray(state.customHubs)?state.customHubs:[])if(f&&f.owned===true&&f.kind===kind&&String(f.ownerCompanyId||f.companyId||f.company||'')===companyId&&f.status!=='closed'&&f.closed!==true)out.push(f);
    return out.slice(0,MAX_SITES);
  }
  function serviceLevel(state,companyId){const model=globalThis.GH_CORPORATE_CORE?.model?.(state,companyId)||state.advanced?.companies?.[companyId]||{};return num(model.serviceLevel)||86;}
  // A facility's utilization on `day`: the sector's middle, the company's service level, its price level, a small
  // deterministic daily variation (the facility and the day name it), bounded by the sector's range.
  function utilization(sector,level,service,facilityId,day){const noise=((hash(`${facilityId}:${day}`)%1000)/1000-.5)*.04;return clamp(sector.mid+(service-85)*.004+level.demand+noise,sector.lo,sector.hi);}
  function priceFactor(country){const f=globalThis.GH_CUSTOMER_BASE?.incomeFactor?.(country,'servicePrice');return Number.isFinite(f)&&f>0?f:1;}
  function dayRow(state,companyId,day){
    const sector=sectorOf(state,companyId),row=read(state,companyId)||{priceLevel:'market'},level=LEVELS[row.priceLevel]||LEVELS.market,service=serviceLevel(state,companyId);
    const sites=sector?sitesOf(state,companyId,sector.facilityKind):[];let revenue=0,expense=0,cash=0;const facilities=[];
    for(const f of sites){
      const u=utilization(sector,level,service,f.id,day),gross=sector.daily(u)*level.price*priceFactor(f.country),direct=gross*sector.direct;
      revenue+=gross;expense+=direct;cash+=gross*sector.collected;facilities.push({id:f.id,u:Math.round(u*1000)/1000,revenue:cents(gross)});
    }
    return {day,sector:sector?.id||null,facilities,revenue:cents(revenue),expense:cents(expense),cashRevenue:cents(cash),cashExpense:cents(expense),badDebt:cents(revenue-cash)};
  }
  function onFinancialDay(ctx,p={}){
    const state=ctx.state||ctx,companyId=String(ctx.companyId||p.companyId||''),day=Math.floor(num(p.day??today(state)));
    if(!sectorOf(state,companyId))return null;const row=ensure(state,companyId);
    if(row.lastDay===day)return row.history.find(item=>item.day===day)||null;
    const result=dayRow(state,companyId,day);
    row.history.unshift({day,revenue:result.revenue,expense:result.expense,cashRevenue:result.cashRevenue,badDebt:result.badDebt,facilities:result.facilities.length,utilization:result.facilities.length?Math.round(result.facilities.reduce((a,f)=>a+f.u,0)/result.facilities.length*1000)/1000:0});
    row.history=row.history.slice(0,HISTORY);row.lastDay=day;row.ytd.revenue=cents(num(row.ytd.revenue)+result.revenue);row.ytd.expense=cents(num(row.ytd.expense)+result.expense);
    return {...row.history[0]};
  }
  // What the economics close posts for the company's day: the day's row if the close recorded it, nothing otherwise.
  function dailyResult(state,day,companyId){
    const row=read(state,companyId)?.history?.find(item=>Number(item.day)===Number(day));
    return row?{revenue:num(row.revenue),expense:num(row.expense),cashRevenue:num(row.cashRevenue),cashExpense:num(row.expense)}:{revenue:0,expense:0,cashRevenue:0,cashExpense:0};
  }
  function summary(state,companyId){
    const sector=sectorOf(state,companyId);if(!sector)return null;const row=read(state,companyId),day=today(state),live=dayRow(state,companyId,day),history=row?.history||[];
    const sites=new Map(sitesOf(state,companyId,sector.facilityKind).map(f=>[f.id,f]));
    const window30=history.slice(0,30),facilities=live.facilities.map(f=>{const site=sites.get(f.id);return {...f,name:site?.name||site?.city||f.id,city:site?.city||'',country:site?.country||'',measure:sector.measure(f.u)};});
    return {companyId,sector:sector.id,facilityKind:sector.facilityKind,priceLevel:row?.priceLevel||'market',levels:Object.entries(LEVELS).map(([id,l])=>({id,label:l.label})),facilities,today:live,revenue30:cents(window30.reduce((a,r)=>a+num(r.revenue),0)),expense30:cents(window30.reduce((a,r)=>a+num(r.expense),0)),badDebt30:cents(window30.reduce((a,r)=>a+num(r.badDebt),0)),history:window30.map(r=>({...r})),ytd:{...(row?.ytd||{revenue:0,expense:0})}};
  }
  function setPriceLevel(state,companyId,level){if(!LEVELS[level])throw new Error('service-price-level-invalid');const row=ensure(state,companyId);row.priceLevel=level;return {companyId,priceLevel:level};}
  function execute(ctx,cmd,p={}){
    const state=ctx.state||ctx,companyId=String(p.companyId||p.company||ctx.companyId||'');
    if(cmd==='ensure')return ensure(state,companyId);
    if(cmd==='set-price-level'){platform()?.requireCompany?.(state,companyId,{registered:true,operational:true});return setPriceLevel(state,companyId,String(p.level||''));}
    throw new Error(`service-company-command-unknown:${cmd}`);
  }
  function* validationSteps(s){
    const errors=[],all=s?.serviceCompanies;if(all===undefined)return {ok:true,errors};
    if(!all||typeof all!=='object'||Array.isArray(all)||all.schema!==SCHEMA||!all.companies||typeof all.companies!=='object'||Array.isArray(all.companies))return {ok:false,errors:['service-companies-root-invalid']};
    for(const [id,row] of Object.entries(all.companies)){
      if(!row||typeof row!=='object'||!LEVELS[row.priceLevel]||!Array.isArray(row.history)||row.history.length>HISTORY||!(row.lastDay===null||Number.isSafeInteger(row.lastDay)))errors.push(`service-company-invalid:${id}`);
      else for(const h of row.history)if(!h||!Number.isSafeInteger(h.day)||!(num(h.revenue)>=0)||!(num(h.expense)>=0))errors.push(`service-company-history-invalid:${id}`);
      yield;
    }
    return {ok:!errors.length,errors};
  }
  const API=Object.freeze({VERSION,SCHEMA,SECTORS,LEVELS,FACILITY_KINDS,sectorOf,ensure,read,onFinancialDay,dailyResult,summary,execute,validationSteps,dayRow});
  // A signed 'services' command names the one company it writes.
  globalThis.GH_AUTHORIZATION?.registerCommandTargetResolver?.('services',({state,payload})=>{const id=String(payload?.companyId||payload?.company||'');if(!sectorOf(state,id))throw new Error('service-company-unknown');return [id];});
  globalThis.GH_SERVICE_COMPANIES_CORE=API;globalThis.GH_DOMAIN_COMMANDS?.register?.('services',API);
  if(globalThis.window&&globalThis.window!==globalThis)globalThis.window.GH_SERVICE_COMPANIES_CORE=API;
  if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
