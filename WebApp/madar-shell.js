/* Build 373 · مدار: the map stays in the centre and every company has its own control panel.
   Presentation and navigation only. Each option opens an existing page through its existing route, every action keeps
   its owner (data-gh-action and the app.js handlers), and retired panel ids still open, redirected to their new home. */
(()=>{'use strict';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// MADAR icons (madar-icons.js): an option card shows its realistic glyph on a glass tile; the page strip and the
// frame controls draw the glyph bare.
const icon=id=>globalThis.GH_ICONS?.tile(id)||'';
const glyph=id=>globalThis.GH_ICONS?.glyph(id)||'';
const ui=name=>`assets/images/ui/${name}.webp`;
const platform=()=>globalThis.GH_COMPANY_PLATFORM;
// One digit style across the shell, the same Western digits as the money figures in the top bar.
const num=value=>Number.isFinite(Number(value))?Number(value).toLocaleString('en-US'):'—';
const go=(panel,arg)=>`data-go="${esc(panel)}"${arg===undefined||arg===null?'':` data-go-arg="${esc(JSON.stringify(arg))}"`}`;

// ---- Companies ----------------------------------------------------------------------------------------------------
const KIND_BY_CAPABILITY=Object.freeze([['asset.aircraft','air'],['asset.vessel','sea'],['asset.truck','road'],['operations.mobility','mobility'],['operations.energy','power'],['operations.bank','bank'],['operations.insurance','insurance'],['operations.realestate','realestate'],['operations.telecom','telecom'],['operations.dealer','dealership']]);
function kindOf(state,id){let caps=[];try{caps=platform()?.definitionFor?.(state,id)?.capabilities||[];}catch(_error){}for(const [capability,kind] of KIND_BY_CAPABILITY)if(caps.includes(capability))return kind;return null;}
function openedCompanies(state){let rows=[];try{rows=platform()?.listInstances?.(state,{includeGroup:false,openedOnly:true})||[];}catch(_error){}return rows.filter(row=>row?.operational&&kindOf(state,row.id));}
function shortName(state,id){return globalThis.GH_IDENTITY?.shortName?.(state,id)||platform()?.resolveIdentity?.(state,id)?.shortName||String(id||'').toUpperCase();}
function logoImg(state,id){try{return globalThis.GH_IDENTITY?.logoMarkup?.(state,id,{element:'img',decorative:true})||'';}catch(_error){return '';}}
function companyOfKind(state,kind){return openedCompanies(state).find(row=>kindOf(state,row.id)===kind)?.id||null;}
const fuelled=(state,id)=>{try{return Boolean(globalThis.GH_MARKET_CORE?.companyFuel?.(state,id));}catch(_error){return false;}};

// Each company's control panel. `hero` is the large card; every tile opens one existing page scoped to the company.
const MANAGE=Object.freeze({key:'manage',title:'الإدارة والهوية',sub:'المدير · الاسم والشعار · الجودة والأتمتة',img:'group-boardroom',icon:'manage',to:id=>['companyManage',{type:id,tab:'overview'}]});
const FINANCE=Object.freeze({key:'finance',title:'مالية الشركة',sub:'المستندات · الالتزامات · الأرباح',img:'finance-budget',icon:'company-finance',to:id=>['invoices',{company:id,tab:'overview'}]});
const BUDGET=Object.freeze({key:'budget',title:'ميزانية الشركة',sub:'سقف شهري ملزم لكل بند',img:'finance-documents',icon:'budget',to:id=>['budgets',id]});
const fleetKind=(sector,unit,fleetTitle,fleetImg,fleetIcon,rows)=>Object.freeze({sector,unit,fleet:true,hero:{key:'fleet',title:fleetTitle,img:fleetImg,icon:fleetIcon,to:id=>['assets',id]},tiles:Object.freeze([...rows,
  {key:'deliveries',title:'قيد التسليم',sub:'الطلبات المدفوعة في الطريق',img:'company-system-v2',icon:'deliveries',to:()=>['procurement']},
  MANAGE,FINANCE,BUDGET])});
const KINDS=Object.freeze({
  air:fleetKind('الطيران','طائرة','الأسطول الجوي','air-widebody','fleet-air',[
    {key:'buy',title:'شراء طائرات',sub:'جديد ومستعمل · مقارنة · شراء مفصّل',img:'air-narrow',icon:'buy-air',to:id=>['assetMarket',id]},
    {key:'routes',title:'الخطوط الجوية',sub:'الخطوط وتعيين الطائرات',img:'routes-map',icon:'route-air',map:true,to:id=>['routes',id]},
    {key:'bases',title:'المطارات والقواعد',sub:'قواعد الشركة وفتح قاعدة جديدة',img:'facility-airport-v2',icon:'tower',to:id=>['companyFacilities',id]},
    {key:'contracts',title:'عقود الشحن الجوي',sub:'المناقصات والعقود السارية',img:'air-cargo',icon:'contract-air',to:id=>['contracts',id]},
    {key:'maintenance',title:'الصيانة والتأمين',sub:'سياسة الفحص والتغطية',img:'air-hangar',icon:'maintenance',fuel:true,to:id=>['maintenance',id]},
    {key:'crews',title:'الطواقم والأجور',sub:'مستوى الأجور مقابل السوق',img:'air-crew',icon:'pilot',fuel:true,to:id=>['crews',id]}]),
  sea:fleetKind('الشحن البحري','سفينة','الأسطول البحري','ship-container','fleet-sea',[
    {key:'buy',title:'شراء سفن',sub:'من المغذّية إلى الناقلات العملاقة',img:'ship-tanker',icon:'buy-sea',to:id=>['assetMarket',id]},
    {key:'routes',title:'الخطوط البحرية',sub:'الخطوط وتعيين السفن',img:'routes-map',icon:'route-sea',map:true,to:id=>['routes',id]},
    {key:'bases',title:'الموانئ والقواعد',sub:'موانئ الشركة وفتح ميناء جديد',img:'facility-port-v2',icon:'port',to:id=>['companyFacilities',id]},
    {key:'contracts',title:'عقود الشحن البحري',sub:'المناقصات والعقود السارية',img:'ship-lng',icon:'contract-sea',to:id=>['contracts',id]},
    {key:'maintenance',title:'الصيانة والتأمين',sub:'سياسة الفحص والتغطية',img:'sea-drydock',icon:'maintenance',fuel:true,to:id=>['maintenance',id]},
    {key:'carbon',title:'تصنيف الكربون CII',sub:'خطط تحسين الامتثال البحري',img:'ship-support',icon:'carbon',to:()=>['compliance']},
    {key:'crews',title:'الطواقم والأجور',sub:'مستوى الأجور مقابل السوق',img:'sea-crew',icon:'captain',fuel:true,to:id=>['crews',id]}]),
  road:fleetKind('النقل والتوزيع','شاحنة','الأسطول البري','truck-longhaul-v2','fleet-road',[
    {key:'buy',title:'شراء شاحنات',sub:'من التوصيل الحضري إلى النقل الثقيل',img:'truck-container',icon:'buy-road',to:id=>['assetMarket',id]},
    {key:'routes',title:'المسارات البرية',sub:'المسارات ونقاط التسليم',img:'routes-map',icon:'route-road',map:true,to:id=>['routes',id]},
    {key:'bases',title:'المستودعات والمراكز',sub:'مراكز الشركة وفتح مركز جديد',img:'facility-logistics-v2',icon:'warehouse',to:id=>['companyFacilities',id]},
    {key:'contracts',title:'عقود التوزيع',sub:'المناقصات والعقود السارية',img:'truck-reefer',icon:'contract-road',to:id=>['contracts',id]},
    {key:'maintenance',title:'الصيانة والتأمين',sub:'سياسة الفحص والتغطية',img:'road-workshop',icon:'maintenance',fuel:true,to:id=>['maintenance',id]},
    {key:'crews',title:'السائقون والأجور',sub:'مستوى الأجور مقابل السوق',img:'road-drivers',icon:'driver',fuel:true,to:id=>['crews',id]}]),
  mobility:fleetKind('التنقل الذكي','سيارة','سيارات التنقل','mobility-hero','fleet-car',[
    {key:'buy',title:'شراء سيارات',sub:'سيارات كهربائية وهجينة للمدن',img:'auto-delivery',icon:'buy-car',to:id=>['assetMarket',id]},
    {key:'routes',title:'خطوط المدن',sub:'التشغيل داخل المدن',img:'routes-map',icon:'route-city',map:true,to:id=>['routes',id]},
    {key:'bases',title:'فروع المدن',sub:'مراكز التشغيل وفتح فرع جديد',img:'mobility-charging',icon:'city-branch',to:id=>['companyFacilities',id]},
    {key:'maintenance',title:'الصيانة والتأمين',sub:'سياسة الفحص والتغطية',img:'mobility-driver',icon:'maintenance',fuel:true,to:id=>['maintenance',id]}]),
  power:Object.freeze({sector:'الطاقة والتخزين',hero:{key:'projects',title:'المحطات والمشاريع',img:'energy-solar',icon:'solar',to:()=>['energy',{tab:'projects'}]},tiles:Object.freeze([
    {key:'overview',title:'لوحة الطاقة',sub:'من التطوير إلى التحصيل',img:'energy-battery',icon:'energy-dash',to:()=>['energy',{tab:'overview'}]},
    {key:'operations',title:'التشغيل والتوزيع',sub:'الأحمال والصيانة المجدولة',img:'energy-control',icon:'grid',to:()=>['energy',{tab:'operations'}]},
    {key:'control',title:'العقود والتمويل',sub:'عقود البيع والوقود وتمويل المشاريع',img:'ship-lng',icon:'contract-power',to:()=>['energy',{tab:'control'}]},
    {key:'revenue',title:'الإيرادات',sub:'التسوية والتدفق النقدي',img:'finance-markets',icon:'revenue',to:()=>['energy',{tab:'revenue'}]},
    {key:'sites',title:'مواقع المحطات',sub:'محطات الشركة وموقع محطة جديدة',img:'energy-wind',icon:'power-site',to:id=>['companyFacilities',id]},
    {key:'contracts',title:'المناقصات والعقود',sub:'عقود الطاقة مع العملاء',img:'lead-partners',icon:'tender',to:id=>['contracts',id]},
    MANAGE,FINANCE,BUDGET])}),
  bank:Object.freeze({sector:'الخدمات المصرفية',hero:{key:'credit',title:'الائتمان والقروض',img:'bank-credit',icon:'credit',to:()=>['bank',{tab:'credit'}]},tiles:Object.freeze([
    {key:'overview',title:'لوحة البنك',sub:'الودائع والائتمان والدخل والسلامة',img:'company-bank-v2',icon:'bank',to:()=>['bank',{tab:'overview'}]},
    {key:'branches',title:'الفروع والخدمات',sub:'الحملات وفتح فرع جديد',img:'bank-branch',icon:'atm',to:()=>['bank',{tab:'branches'}]},
    {key:'control',title:'السيولة والمخاطر',sub:'التسعير والاستثمار والحدود',img:'bank-vault',icon:'liquidity',to:()=>['bank',{tab:'control'}]},
    {key:'revenue',title:'الإيرادات',sub:'الفوائد والرسوم المحققة',img:'finance-markets',icon:'revenue',to:()=>['bank',{tab:'revenue'}]},
    MANAGE,FINANCE,BUDGET])}),
  insurance:Object.freeze({sector:'التأمين',hero:{key:'overview',title:'لوحة التأمين',img:'insurance-hero',icon:'umbrella',to:()=>['insurance',{tab:'overview'}]},tiles:Object.freeze([
    {key:'lines',title:'المنتجات والتسعير',sub:'الأسعار وإعادة التأمين',img:'insurance-risk',icon:'pricing',to:()=>['insurance',{tab:'lines'}]},
    {key:'offices',title:'المكاتب',sub:'الحملات وفتح مكتب جديد',img:'insurance-branch',icon:'office',to:()=>['insurance',{tab:'offices'}]},
    {key:'claims',title:'المطالبات',sub:'الاحتياطي والسداد',img:'insurance-claims',icon:'claims',to:()=>['insurance',{tab:'claims'}]},
    MANAGE,FINANCE,BUDGET])}),
  realestate:Object.freeze({sector:'التطوير العقاري',hero:{key:'overview',title:'لوحة العقار',img:'realestate-sales',icon:'house',to:()=>['realestate',{tab:'overview'}]},tiles:Object.freeze([
    {key:'projects',title:'المشاريع',sub:'البيع والتأجير والإشغال',img:'realestate-villas',icon:'construction',to:()=>['realestate',{tab:'projects'}]},
    {key:'develop',title:'تطوير مشروع',sub:'المدينة والنوع والتمويل',img:'realestate-hero',icon:'develop',to:()=>['realestate',{tab:'develop'}]},
    {key:'offices',title:'المكاتب',sub:'مكاتب الشركة وفتح مكتب جديد',img:'realestate-mall',icon:'office',to:id=>['companyFacilities',id]},
    MANAGE,FINANCE,BUDGET])}),
  telecom:Object.freeze({sector:'الاتصالات',hero:{key:'operations',title:'الاشتراكات والشرائح',img:'telecom-store',icon:'sim',to:id=>['companyManage',{type:id,tab:'operations'}]},tiles:Object.freeze([
    {key:'network',title:'الشبكة والفروع',sub:'فتح الفروع من دليل المدن',img:'telecom-fiber',icon:'antenna',to:id=>['companyFacilities',id]},
    {key:'datacenter',title:'نظرة الشركة',sub:'التشغيل والإيراد والعملاء',img:'telecom-datacenter',icon:'datacenter',to:id=>['companyManage',{type:id,tab:'overview'}]},
    {...MANAGE,to:id=>['companyManage',{type:id,tab:'management'}],sub:'المدير التنفيذي والتوظيف'},FINANCE,BUDGET])}),
  dealership:Object.freeze({sector:'وكالة السيارات',hero:{key:'operations',title:'المخزون والمبيعات',img:'auto-hero',icon:'car-sales',to:id=>['companyManage',{type:id,tab:'operations'}]},tiles:Object.freeze([
    {key:'service',title:'خطط الخدمة والتمويل',sub:'خطط الصيانة وتسوية البيع الممول',img:'auto-service',icon:'car-service',to:id=>['companyManage',{type:id,tab:'operations'}]},
    {key:'showrooms',title:'المعارض والفروع',sub:'فتح فرع من دليل المدن',img:'auto-delivery',icon:'showroom',to:id=>['companyFacilities',id]},
    {...MANAGE,to:id=>['companyManage',{type:id,tab:'management'}],sub:'المدير التنفيذي والتوظيف'},FINANCE,BUDGET])})
});
function tilesFor(state,id){const kind=KINDS[kindOf(state,id)];if(!kind)return [];return kind.tiles.filter(tile=>!tile.fuel||fuelled(state,id));}

// ---- Group sections ------------------------------------------------------------------------------------------------
const SECTIONS=Object.freeze({
  group:Object.freeze({label:'المجموعة',icon:'group',nav:'companies',pages:[['companies',null,'المجموعة','group'],['groupManagement',null,'أداء الشركات','performance'],['assets','all','أسطول المجموعة','fleet-all'],['network',null,'الدليل العالمي','directory'],['expansion',null,'كل المنشآت','facilities'],['formationContract',null,'عقد التأسيس','charter']]}),
  finance:Object.freeze({label:'المال',icon:'finance',nav:'finance',pages:[['finance',null,'نظرة عامة','finance'],['treasury',null,'الخزينة','treasury'],['monthlyFinance',null,'الدخل الشهري','monthly-income'],['budgets',null,'الميزانيات','budget'],['invoices',null,'المستندات','documents'],['market',null,'الأسواق والتحوط','markets'],['market','deals','الاستحواذات','acquisitions'],['stocks',null,'الأسهم والطرح','stocks']]}),
  people:Object.freeze({label:'الأفراد',icon:'people',nav:'people',pages:[['peopleHub',null,'نظرة عامة','people'],['labor','dashboard','لوحة الأفراد','people-dash'],['labor','managers','المديرون التنفيذيون','executive'],['labor','jobs','الوظائف','jobs'],['labor','contracts','عقود العمل','employment'],['labor','payroll','الرواتب','payroll'],['crews',null,'الأجور والطواقم','crews']]}),
  leadership:Object.freeze({label:'الإدارة',icon:'leadership',nav:'leadership',pages:[['leadershipHub',null,'نظرة عامة','leadership'],['actionCenter',null,'المهام الآن','tasks'],['compliance',null,'السلامة والأمن','safety'],['conference',null,'المؤتمر السنوي','conference'],['research',null,'البحث والتطوير','research'],['esg',null,'الاستدامة','esg'],['businessWorld',null,'العلاقات التجارية','relations'],['realism',null,'السوق والاقتصاد','economy'],['news',null,'الأخبار','news']]}),
  system:Object.freeze({label:'النظام',icon:'settings',nav:'system',pages:[['settings',null,'الحفظ والإعدادات','settings'],['updates',null,'التحديثات','updates'],['diagnostics',null,'صحة اللعبة','diagnostics'],['controlPlane',null,'مركز التحكم','control-plane']]})
});
const SECTION_OF=Object.freeze({companies:'group',groupManagement:'group',network:'group',expansion:'group',ports:'group',formationContract:'group',
  finance:'finance',monthlyFinance:'finance',treasury:'finance',budgets:'finance',invoices:'finance',market:'finance',stocks:'finance',
  peopleHub:'people',labor:'people',crews:'people',
  leadershipHub:'leadership',actionCenter:'leadership',compliance:'leadership',conference:'leadership',research:'leadership',esg:'leadership',businessWorld:'leadership',realism:'leadership',news:'leadership',
  settings:'system',updates:'system',diagnostics:'system',controlPlane:'system'});
// Pages that only exist inside one company: they follow the company that opened them.
const COMPANY_PAGES=new Set(['company','assets','assetMarket','routes','globalRoute','companyFacilities','facilityManage','assetManage','mobilityAsset','contracts','maintenance','procurement','companyManage','energy','bank','insurance','realestate']);
const DEEP_KIND=Object.freeze({energy:'power',bank:'bank',insurance:'insurance',realestate:'realestate'});
// Retired pages open their new home, so every old link, alert and task still lands somewhere real.
const REDIRECTS=Object.freeze({control:['companies',null],governanceHub:['compliance',null],systemHub:['settings',null],cyber:['compliance',null],safety:['compliance',null]});

let installed=null,stickyCompany=null,dockSignature='';
function argCompany(state,panel,arg){
  if(panel==='company')return String(arg||'');
  if(DEEP_KIND[panel])return companyOfKind(state,DEEP_KIND[panel]);
  if(panel==='companyManage')return String((arg&&typeof arg==='object'?arg.type:String(arg||'').split(':')[0])||'');
  if(panel==='invoices')return arg&&typeof arg==='object'?String(arg.company||''):String(arg||'');
  if(['assets','assetMarket','routes','companyFacilities','contracts','maintenance','crews','budgets'].includes(panel))return typeof arg==='string'?arg:'';
  return '';
}
function locate(state,panel,arg){
  const explicit=argCompany(state,panel,arg),opened=new Set(openedCompanies(state).map(row=>row.id));
  if(explicit&&opened.has(explicit))return {section:'company',company:explicit};
  if(COMPANY_PAGES.has(panel)&&stickyCompany&&opened.has(stickyCompany)&&panel!=='companyManage')return {section:'company',company:stickyCompany};
  return {section:SECTION_OF[panel]||(COMPANY_PAGES.has(panel)?'group':'map'),company:null};
}
function redirect(panel,arg){const target=REDIRECTS[panel];return target?[target[0],target[1]===null?undefined:target[1]]:null;}
function rail(state,panel,arg){const place=locate(state,panel,arg);if(place.section==='company')return '';return SECTIONS[place.section]?.nav||'map';}
function meta(state,panel,arg){
  if(panel==='company'){const id=String(arg||''),kind=KINDS[kindOf(state,id)];return [kind?.sector||'الشركة',shortName(state,id)];}
  if(panel==='procurement')return ['العمليات','الطلبات قيد التسليم'];
  return null;
}

// ---- Rendering -----------------------------------------------------------------------------------------------------
function tileMarkup(tile,id,extra=''){
  const [panel,arg]=tile.to(id),art=tile.map?`<svg class="mc-routes" viewBox="0 0 176 99" aria-hidden="true"><path d="M90 52Q106 30 124 50M90 52Q66 26 40 38M124 50Q146 46 162 70"></path><circle cx="90" cy="52" r="3.2"></circle><circle cx="124" cy="50" r="3.2"></circle><circle cx="40" cy="38" r="3.2"></circle></svg>`:'';
  return `<button type="button" class="mc-tile" ${go(panel,arg)} data-tile="${esc(tile.key)}"><img src="${ui(tile.img)}" alt="" loading="lazy" decoding="async">${art}<span class="mc-scrim"></span><span class="mc-badge">${icon(tile.icon)}</span>${extra}<span class="mc-text"><b>${esc(tile.title)}</b><small>${esc(tile.sub||'')}</small></span></button>`;
}
function money(ctx,value){return ctx.fmtMoney?.(Number(value)||0)||String(value);}
function companyFacts(state,id,ctx){
  let summary=null,performance=null,balance=null,manager=null,fleet=null;
  try{const instance=openedCompanies(state).find(row=>row.id===id);summary=globalThis.GH_ADVANCED?.companyOverviewSummary?.(state,instance)||null;}catch(_error){}
  try{performance=ctx.companyPerformance?.(id,30)||null;}catch(_error){}
  try{balance=ctx.companyOperatingBalance?.(id);}catch(_error){}
  try{manager=globalThis.GH_HR_CORE?.officialManager?.(state,id)||null;}catch(_error){}
  try{fleet=ctx.companyFleetStats?.(id)||null;}catch(_error){}
  return {summary,performance,balance,manager,fleet};
}
function renderCompany(state,id,ctx){
  const kindId=kindOf(state,id),kind=KINDS[kindId];if(!kind)return '<div class="empty">الشركة غير مفتوحة أو غير معروفة.</div>';
  stickyCompany=id;const facts=companyFacts(state,id,ctx),perf=facts.performance,net=Number(perf?.net)||0,reported=Number(perf?.reportedDays)||0,summary=facts.summary;
  const kpis=[['رصيد الشركة',Number.isFinite(Number(facts.balance))?money(ctx,facts.balance):'—',''],['صافي 30 يومًا',reported?`${net>=0?'+':''}${money(ctx,net)}`:'لم يُقفل بعد',reported?(net>=0?'positive':'negative'):'is-text'],[summary?.primaryOperatingLabel||'التشغيل',typeof summary?.primaryOperatingCount==='number'?num(summary.primaryOperatingCount):(summary?.primaryOperatingCount??'—'),'']];
  const managerLine=facts.manager?.name?`<small class="mc-status is-good"><i></i>تعمل · المدير: ${esc(facts.manager.name)}</small>`:`<small class="mc-status is-warn"><i></i>بلا مدير تنفيذي معيّن</small>`;
  let heroLine='',heroChips='',heroCount='';
  if(kind.fleet){
    // The worker summary arrives a moment after the first paint (app.js re-renders the panel then); until it does,
    // the bounded overview count is exact for small fleets.
    const mobility=kindId==='mobility'?globalThis.GH_MOBILITY_CORE?.managementSnapshot?.(state):null,boundedCount=summary?.category==='fleet'&&typeof summary.primaryOperatingCount==='number'?summary.primaryOperatingCount:null,boundedMoving=Number((summary?.metrics||[]).find(([label])=>label==='رحلات جارية')?.[1]),stats=mobility?{total:Number(mobility.vehicles)||0,moving:Number(mobility.moving)||0,service:null}:facts.fleet||(boundedCount!==null?{total:boundedCount,moving:Number.isFinite(boundedMoving)?boundedMoving:0,service:null}:null);
    heroCount=stats?`<b class="mc-count">${esc(num(stats.total))}</b><small>${esc(kind.unit)}</small>`:`<b class="mc-count">—</b><small>جارٍ تحديث الأسطول</small>`;
    heroChips=stats?[`في الحركة ${num(stats.moving)}`,stats.service!=null?`تحتاج صيانة ${num(stats.service)}`:''].filter(Boolean).map(text=>`<span class="mc-chip">${esc(text)}</span>`).join(''):'';
  }else{
    heroLine=(summary?.metrics||[]).slice(0,3).map(([label,value])=>`<span class="mc-chip">${esc(label)} ${esc(typeof value==='number'?num(value):value)}</span>`).join('');
  }
  const hero=kind.hero,[heroPanel,heroArg]=hero.to(id);
  const heroCard=`<button type="button" class="mc-tile mc-hero" ${go(heroPanel,heroArg)} data-tile="${esc(hero.key)}"><img src="${ui(hero.img)}" alt="" decoding="async"><span class="mc-scrim mc-scrim-side"></span><span class="mc-badge">${icon(hero.icon)}</span><span class="mc-text"><small class="mc-kicker">${esc(hero.title)}</small>${heroCount?`<span class="mc-hero-count">${heroCount}</span>`:''}<span class="mc-chips">${heroChips||heroLine}</span></span></button>`;
  const decisions=[];
  if(kind.fleet&&facts.fleet?.service>0)decisions.push(['maintenance',`${num(facts.fleet.service)} ${kind.unit} تحتاج صيانة`,'افتح الصيانة لمراجعة السياسة والفحوص','maintenance',id,'مراجعة']);
  for(const [label,value] of summary?.metrics||[])if(/بانتظار|طلبات|عروض/.test(String(label))&&Number(value)>0)decisions.push(['tasks',`${label}: ${value}`,'قرار مفتوح في هذه الشركة',hero.to(id)[0],hero.to(id)[1],'فتح']);
  if(!facts.manager?.name)decisions.push(['executive','عيّن مديرًا تنفيذيًا','الشركة تعمل بلا مدير رسمي','labor',`managers:${id}`,'تعيين']);
  const decisionMarkup=decisions.length?`<section class="mc-decide" aria-label="يحتاج قرارك"><h3>يحتاج قرارك</h3>${decisions.map(([ic,title,copy,panel,arg,label])=>`<div class="mc-decision"><span class="mc-decision-icon">${icon(ic)}</span><span class="mc-decision-copy"><b>${esc(title)}</b><small>${esc(copy)}</small></span><button type="button" class="mc-act" ${go(panel,arg)}>${esc(label)}</button></div>`).join('')}</section>`:'';
  return `<div class="madar-company" data-kind="${esc(kindId)}"><p class="mc-manager">${managerLine}</p><div class="mc-kpis">${kpis.map(([label,value,cls])=>`<div class="mc-kpi"><span>${esc(label)}</span><b class="${esc(cls)}">${esc(value)}</b></div>`).join('')}</div>${heroCard}<div class="mc-grid">${tilesFor(state,id).map(tile=>tileMarkup(tile,id)).join('')}</div>${decisionMarkup}</div>`;
}
function render(panel,arg,ctx){
  if(panel==='company')return renderCompany(ctx.state,String(arg||''),ctx);
  return null;
}

// ---- Chrome: drawer header, page strip, company dock, rail -----------------------------------------------------------
const STRIP_TABS=Object.freeze({'data-labortab':value=>value,'data-energy-tab':tab=>({tab}),'data-bank-tab':tab=>({tab}),'data-insurance-tab':tab=>({tab}),'data-realestate-tab':tab=>({tab})});
function stripFor(state,panel,arg,place){
  if(place.section==='company'){
    const id=place.company,kind=KINDS[kindOf(state,id)];if(!kind)return [];
    const rows=[['company',id,'لوحة الشركة','dashboard'],[...kind.hero.to(id),kind.hero.title,kind.hero.icon],...tilesFor(state,id).map(tile=>[...tile.to(id),tile.title,tile.icon])];
    return rows.map(([p,a,label,ic])=>({panel:p,arg:a,label,icon:ic}));
  }
  const section=SECTIONS[place.section];return section?section.pages.map(([p,a,label,ic])=>({panel:p,arg:a===null?undefined:a,label,icon:ic})):[];
}
function sameTarget(panel,arg,row){
  if(row.panel!==panel)return false;if(row.arg===undefined||row.arg===null)return arg===undefined||arg===null||arg===''||typeof arg==='object'&&!arg.tab&&!arg.view;
  if(typeof row.arg==='object'&&row.arg){const tab=arg&&typeof arg==='object'?arg.tab:undefined;return row.arg.tab===undefined||row.arg.tab===(tab||'overview');}
  if(panel==='labor')return String(arg||'dashboard').split(':')[0]===String(row.arg).split(':')[0];
  return String(arg??'')===String(row.arg);
}
function decorate(root,panel,arg,ctx){
  const state=ctx.state,place=locate(state,panel,arg),drawer=document.getElementById('drawer');
  if(drawer){drawer.dataset.domain=place.section==='company'?'company':place.section;drawer.dataset.company=place.company||'';}
  const mark=document.getElementById('drawerMark'),eyebrow=document.getElementById('drawerEyebrow');
  if(place.section==='company'){
    if(mark)mark.innerHTML=logoImg(state,place.company)||icon('group');
    if(eyebrow)eyebrow.textContent=panel==='company'?(KINDS[kindOf(state,place.company)]?.sector||'الشركة'):shortName(state,place.company);
  }else{
    const section=SECTIONS[place.section];if(mark)mark.innerHTML=icon(section?.icon||'map');if(eyebrow&&section)eyebrow.textContent=section.label;
  }
  const nav=document.getElementById('sectionNav');
  if(nav){
    const rows=stripFor(state,panel,arg,place);
    nav.hidden=!rows.length;
    nav.innerHTML=rows.map(row=>`<button type="button" class="${sameTarget(panel,arg,row)?'on':''}" ${go(row.panel,row.arg)}${sameTarget(panel,arg,row)?' aria-current="page"':''}>${glyph(row.icon)}<span>${esc(row.label)}</span></button>`).join('');
    const active=nav.querySelector('.on');if(active)requestAnimationFrame(()=>{const a=active.getBoundingClientRect(),n=nav.getBoundingClientRect();if(a.left<n.left||a.right>n.right)nav.scrollLeft+=(a.left+a.width/2)-(n.left+n.width/2);});
    // A page's own tab bar whose every tab is already a chip in the strip would show the same buttons twice: the strip
    // owns that navigation, so the bar is hidden (it stays in the markup as the page's tab state).
    const chips=new Set(rows.map(row=>`${row.panel}|${JSON.stringify(row.arg??null)}`));
    for(const bar of root.querySelectorAll('.tabs')){
      const tabs=[...bar.querySelectorAll('button')];
      bar.classList.toggle('mc-in-strip',tabs.length>0&&tabs.every(button=>{const attr=Object.keys(STRIP_TABS).find(name=>button.hasAttribute(name));return !!attr&&chips.has(`${panel}|${JSON.stringify(STRIP_TABS[attr](button.getAttribute(attr)))}`);}));
    }
  }
  syncDock(state,place.company,true);
}
function syncDock(state,activeCompany=null,force=false){
  const dock=document.getElementById('companyDock');if(!dock)return;
  const rows=openedCompanies(state),signature=rows.map(row=>`${row.id}:${shortName(state,row.id)}`).join('|')+`#${activeCompany||''}`;
  if(signature===dockSignature&&!force)return;dockSignature=signature;
  dock.innerHTML=rows.map(row=>`<button type="button" class="${row.id===activeCompany?'on':''}" ${go('company',row.id)} aria-label="لوحة ${esc(shortName(state,row.id))}" title="${esc(shortName(state,row.id))}"${row.id===activeCompany?' aria-current="page"':''}>${logoImg(state,row.id)||`<b>${esc(shortName(state,row.id).slice(0,3))}</b>`}</button>`).join('')+`<button type="button" class="dock-add" ${go('companies','subs')} aria-label="فتح شركة جديدة" title="فتح شركة جديدة">${glyph('add')}</button>`;
  dock.hidden=false;
  const active=dock.querySelector('.on');if(active)requestAnimationFrame(()=>{const a=active.getBoundingClientRect(),d=dock.getBoundingClientRect();if(a.left<d.left+36||a.right>d.right)dock.scrollLeft+=(a.left+a.width/2)-(d.left+d.width/2);});
}
function sync(state,panel,arg,open){
  const settings=document.getElementById('settingsBtn'),place=open&&panel?locate(state,panel,arg):{section:'map',company:null};
  settings?.classList.toggle('active',place.section==='system');settings?.setAttribute('aria-pressed',String(place.section==='system'));
  if(!open){stickyCompany=null;document.querySelector('.app-shell')?.classList.remove('panel-expanded');}
  syncDock(state,place.company);
}
function install({openDrawer,getState}){
  installed={openDrawer,getState};
  document.addEventListener('click',event=>{
    const target=event.target.closest?.('[data-go]');if(!target||!installed)return;
    if(!target.closest('#drawer,#sectionNav,#companyDock'))return;
    event.preventDefault();const panel=target.dataset.go;let arg;try{arg=target.dataset.goArg?JSON.parse(target.dataset.goArg):undefined;}catch(_error){arg=undefined;}
    if(['companies','finance','peopleHub','leadershipHub','settings'].includes(panel))stickyCompany=null;
    installed.openDrawer(panel,arg);
  });
  const expand=document.getElementById('drawerExpand');
  expand?.addEventListener('click',()=>{const shell=document.querySelector('.app-shell'),on=!shell.classList.contains('panel-expanded');shell.classList.toggle('panel-expanded',on);expand.setAttribute('aria-pressed',String(on));expand.querySelector('use')?.setAttribute('href',on?'#m-collapse':'#m-expand');expand.setAttribute('aria-label',on?'العودة بجانب الخريطة':'فتح القسم بالكامل');});
  try{syncDock(getState(),null,true);}catch(_error){}
}
globalThis.GH_MADAR=Object.freeze({VERSION:'1.0.0',KINDS,SECTIONS,kindOf,openedCompanies,locate,redirect,rail,meta,render,decorate,sync,syncDock,install,tilesFor});
})();
