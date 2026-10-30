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
// A count and its noun agree in Arabic (owner review: «8 سيارة», «1 فروع البنك»): 3 to 10 take the plural, every other
// count the singular; a label without a known noun is shown as written.
const COUNT_NOUNS=Object.freeze({'فروع البنك':['فرع','فروع'],'المشاريع العقارية':['مشروع عقاري','مشاريع عقارية'],'قاعدة العملاء':['عميل','عملاء'],'مركبات التنقل':['مركبة','مركبات'],'مشاريع الطاقة':['مشروع طاقة','مشاريع طاقة'],'منشآت تشغيلية':['منشأة تشغيلية','منشآت تشغيلية'],'وثائق تأمين':['وثيقة تأمين','وثائق تأمين'],'أصول متحركة':['أصل متحرك','أصول متحركة']});
const countNoun=(value,forms)=>{if(!Array.isArray(forms))return String(forms||'');const n=Math.abs(Math.trunc(Number(value)||0))%100;return n===2||(n>=3&&n<=10)?forms[1]:forms[0];};
const countLabel=(value,label)=>COUNT_NOUNS[label]?countNoun(value,COUNT_NOUNS[label]):String(label||'');
const go=(panel,arg)=>`data-go="${esc(panel)}"${arg===undefined||arg===null?'':` data-go-arg="${esc(JSON.stringify(arg))}"`}`;

// ---- Companies ----------------------------------------------------------------------------------------------------
const KIND_BY_CAPABILITY=Object.freeze([['asset.aircraft','air'],['asset.vessel','sea'],['asset.truck','road'],['operations.mobility','mobility'],['operations.energy','power'],['operations.bank','bank'],['operations.insurance','insurance'],['operations.realestate','realestate'],['operations.telecom','telecom'],['operations.dealer','dealership'],['operations.hospitality','hospitality'],['operations.media','media'],['operations.healthcare','healthcare'],['operations.education','education'],['operations.sports','sports']]);
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
  air:fleetKind('الطيران',['طائرة','طائرات'],'الأسطول الجوي','air-widebody','fleet-air',[
    {key:'buy',title:'شراء طائرات',sub:'جديد ومستعمل · مقارنة · شراء مفصّل',img:'air-narrow',icon:'buy-air',to:id=>['assetMarket',id]},
    {key:'routes',title:'الخطوط الجوية',sub:'الخطوط وتعيين الطائرات',img:'routes-map',icon:'route-air',map:true,to:id=>['routes',id]},
    {key:'bases',title:'المطارات والقواعد',sub:'قواعد الشركة وفتح قاعدة جديدة',img:'facility-airport-v2',icon:'tower',to:id=>['companyFacilities',id]},
    {key:'contracts',title:'عقود الشحن الجوي',sub:'المناقصات والعقود السارية',img:'air-cargo',icon:'contract-air',to:id=>['contracts',id]},
    {key:'maintenance',title:'الصيانة والتأمين',sub:'سياسة الفحص والتغطية',img:'air-hangar',icon:'maintenance',fuel:true,to:id=>['maintenance',id]},
    {key:'crews',title:'الطواقم والأجور',sub:'مستوى الأجور مقابل السوق',img:'air-crew',icon:'pilot',fuel:true,to:id=>['crews',id]}]),
  sea:fleetKind('الشحن البحري',['سفينة','سفن'],'الأسطول البحري','ship-container','fleet-sea',[
    {key:'buy',title:'شراء سفن',sub:'من المغذّية إلى الناقلات العملاقة',img:'ship-tanker',icon:'buy-sea',to:id=>['assetMarket',id]},
    {key:'routes',title:'الخطوط البحرية',sub:'الخطوط وتعيين السفن',img:'routes-map',icon:'route-sea',map:true,to:id=>['routes',id]},
    {key:'bases',title:'الموانئ والقواعد',sub:'موانئ الشركة وفتح ميناء جديد',img:'facility-port-v2',icon:'port',to:id=>['companyFacilities',id]},
    {key:'contracts',title:'عقود الشحن البحري',sub:'المناقصات والعقود السارية',img:'ship-lng',icon:'contract-sea',to:id=>['contracts',id]},
    {key:'maintenance',title:'الصيانة والتأمين',sub:'سياسة الفحص والتغطية',img:'sea-drydock',icon:'maintenance',fuel:true,to:id=>['maintenance',id]},
    {key:'carbon',title:'تصنيف الكربون CII',sub:'خطط تحسين الامتثال البحري',img:'ship-support',icon:'carbon',to:()=>['compliance']},
    {key:'crews',title:'الطواقم والأجور',sub:'مستوى الأجور مقابل السوق',img:'sea-crew',icon:'captain',fuel:true,to:id=>['crews',id]}]),
  road:fleetKind('النقل والتوزيع',['شاحنة','شاحنات'],'الأسطول البري','truck-longhaul-v2','fleet-road',[
    {key:'buy',title:'شراء شاحنات',sub:'من التوصيل الحضري إلى النقل الثقيل',img:'truck-container',icon:'buy-road',to:id=>['assetMarket',id]},
    {key:'routes',title:'المسارات البرية',sub:'المسارات ونقاط التسليم',img:'routes-map',icon:'route-road',map:true,to:id=>['routes',id]},
    {key:'bases',title:'المستودعات والمراكز',sub:'مراكز الشركة وفتح مركز جديد',img:'facility-logistics-v2',icon:'warehouse',to:id=>['companyFacilities',id]},
    {key:'contracts',title:'عقود التوزيع',sub:'المناقصات والعقود السارية',img:'truck-reefer',icon:'contract-road',to:id=>['contracts',id]},
    {key:'maintenance',title:'الصيانة والتأمين',sub:'سياسة الفحص والتغطية',img:'road-workshop',icon:'maintenance',fuel:true,to:id=>['maintenance',id]},
    {key:'crews',title:'السائقون والأجور',sub:'مستوى الأجور مقابل السوق',img:'road-drivers',icon:'driver',fuel:true,to:id=>['crews',id]}]),
  mobility:fleetKind('التنقل الذكي',['سيارة','سيارات'],'سيارات التنقل','mobility-hero','fleet-car',[
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
  hospitality:Object.freeze({sector:'الفنادق والمنتجعات',hero:{key:'operations',title:'تشغيل الفنادق والمنتجعات',img:'realestate-hero',icon:'house',to:id=>['hospitality',{company:id,tab:'overview'}]},tiles:Object.freeze([
    {key:'properties',title:'الفنادق والمنتجعات',sub:'المواقع والإنشاء والتشغيل',img:'realestate-villas',icon:'facilities',to:id=>['hospitality',{company:id,tab:'properties'}]},
    {key:'reservations',title:'حجوزات المجموعات',sub:'الغرف والليالي والعقود',img:'realestate-mall',icon:'documents',to:id=>['hospitality',{company:id,tab:'reservations'}]},
    {key:'settlements',title:'الإيرادات والتسويات',sub:'إقامة فعلية وتسويات يوم 15',img:'finance-budget',icon:'revenue',to:id=>['hospitality',{company:id,tab:'finance'}]},
    {...MANAGE,to:id=>['companyManage',{type:id,tab:'management'}]},FINANCE,BUDGET])}),
  media:Object.freeze({sector:'الإعلام والإنتاج',hero:{key:'operations',title:'الإنتاج والبث',img:'lead-news',icon:'news',to:id=>['serviceCompany',{company:id}]},tiles:Object.freeze([
    {key:'facilities',title:'الاستوديوهات',sub:'فتح منشأة من دليل المدن',img:'telecom-datacenter',icon:'facilities',to:id=>['companyFacilities',id]},
    {key:'overview',title:'التشغيل والإيراد',sub:'الاستغلال والتحصيل ومستوى الأسعار',img:'finance-budget',icon:'revenue',to:id=>['serviceCompany',{company:id}]},
    {...MANAGE,to:id=>['companyManage',{type:id,tab:'management'}],sub:'المدير التنفيذي والتوظيف'},FINANCE,BUDGET])}),
  healthcare:Object.freeze({sector:'الرعاية الصحية',hero:{key:'operations',title:'المستشفيات والمراجعات',img:'insurance-risk',icon:'safety',to:id=>['serviceCompany',{company:id}]},tiles:Object.freeze([
    {key:'facilities',title:'المستشفيات',sub:'فتح منشأة من دليل المدن',img:'company-hq-v2',icon:'facilities',to:id=>['companyFacilities',id]},
    {key:'overview',title:'التشغيل والإيراد',sub:'الاستغلال والتحصيل ومستوى الأسعار',img:'finance-budget',icon:'revenue',to:id=>['serviceCompany',{company:id}]},
    {...MANAGE,to:id=>['companyManage',{type:id,tab:'management'}],sub:'المدير التنفيذي والتوظيف'},FINANCE,BUDGET])}),
  education:Object.freeze({sector:'التعليم',hero:{key:'operations',title:'المدارس والتسجيل',img:'people-recruit',icon:'research',to:id=>['serviceCompany',{company:id}]},tiles:Object.freeze([
    {key:'facilities',title:'المدارس',sub:'فتح منشأة من دليل المدن',img:'group-boardroom',icon:'facilities',to:id=>['companyFacilities',id]},
    {key:'overview',title:'التشغيل والإيراد',sub:'الاستغلال والتحصيل ومستوى الأسعار',img:'finance-budget',icon:'revenue',to:id=>['serviceCompany',{company:id}]},
    {...MANAGE,to:id=>['companyManage',{type:id,tab:'management'}],sub:'المدير التنفيذي والتوظيف'},FINANCE,BUDGET])}),
  sports:Object.freeze({sector:'النادي الرياضي',hero:{key:'operations',title:'المباريات والعضويات',img:'people-team',icon:'performance',to:id=>['serviceCompany',{company:id}]},tiles:Object.freeze([
    {key:'facilities',title:'الملاعب',sub:'فتح منشأة من دليل المدن',img:'company-hq-v2',icon:'facilities',to:id=>['companyFacilities',id]},
    {key:'overview',title:'التشغيل والإيراد',sub:'الاستغلال والتحصيل ومستوى الأسعار',img:'finance-budget',icon:'revenue',to:id=>['serviceCompany',{company:id}]},
    {...MANAGE,to:id=>['companyManage',{type:id,tab:'management'}],sub:'المدير التنفيذي والتوظيف'},FINANCE,BUDGET])}),
  dealership:Object.freeze({sector:'وكالة السيارات',hero:{key:'operations',title:'المخزون والمبيعات',img:'auto-hero',icon:'car-sales',to:id=>['companyManage',{type:id,tab:'operations'}]},tiles:Object.freeze([
    {key:'service',title:'خطط الخدمة والتمويل',sub:'خطط الصيانة وتسوية البيع الممول',img:'auto-service',icon:'car-service',to:id=>['companyManage',{type:id,tab:'operations'}]},
    {key:'showrooms',title:'المعارض والفروع',sub:'فتح فرع من دليل المدن',img:'auto-delivery',icon:'showroom',to:id=>['companyFacilities',id]},
    {...MANAGE,to:id=>['companyManage',{type:id,tab:'management'}],sub:'المدير التنفيذي والتوظيف'},FINANCE,BUDGET])})
});
function tilesFor(state,id){const kindId=kindOf(state,id),kind=KINDS[kindId];if(!kind)return [];const rows=kind.tiles.filter(tile=>!tile.fuel||fuelled(state,id));
  const ui=globalThis.GH_BUSINESS_UI;if(ui?.labels[id])rows.push({key:'market',title:'السوق والمنافسون',sub:'الأسعار المحلية وأرقام التشغيل',img:ui.photos[kindId],icon:'markets',to:()=>['companyMarket',id]});
  if(globalThis.GH_OPERATING_ACQUISITIONS?.COMPANIES.includes(id))rows.push({key:'buy-working',title:{realestate:'شراء مبنى عامل',power:'شراء محطة عاملة',insurance:'شراء محفظة قائمة',bank:'شراء أعمال فرع'}[kindId],sub:'مراجعة الأرصدة والالتزامات ثم الشراء',img:ui.photos[kindId],icon:{realestate:'house',power:'solar',insurance:'umbrella',bank:'atm'}[kindId],to:()=>['operatingAssetMarket',id]});
  return rows;
}

// ---- Group sections ------------------------------------------------------------------------------------------------
const SECTIONS=Object.freeze({
  group:Object.freeze({label:'المجموعة',icon:'group',nav:'companies',pages:[['groupHub',null,'لوحة المجموعة','group'],['companies',null,'الشركات','office'],['progression',null,'المستويات','performance'],['groupManagement',null,'أداء الشركات','performance'],['assets','all','أسطول المجموعة','fleet-all'],['network',null,'الدليل العالمي','directory'],['expansion',null,'كل المنشآت','facilities'],['formationContract',null,'عقد التأسيس','charter']]}),
  finance:Object.freeze({label:'المال',icon:'finance',nav:'finance',pages:[['financeHub',null,'لوحة المال','finance'],['finance',null,'دفاتر الشركات','revenue'],['finance','transfers','التحويلات والتمويل','liquidity'],['finance','statements','القوائم المالية','performance'],['treasury',null,'الخزينة','treasury'],['monthlyFinance',null,'الدخل الشهري','monthly-income'],['budgets',null,'الميزانيات','budget'],['invoices',null,'المستندات','documents'],['market',null,'الأسواق والتحوط','markets'],['market','deals','الاستحواذات','acquisitions'],['stocks',null,'الأسهم والطرح','stocks']]}),
  people:Object.freeze({label:'الأفراد',icon:'people',nav:'people',pages:[['peopleHub',null,'لوحة الأفراد','people'],['labor','managers','المديرون التنفيذيون','executive'],['labor','dashboard','تغطية الوظائف','people-dash'],['labor','jobs','الوظائف','jobs'],['labor','contracts','عقود العمل','employment'],['labor','payroll','الرواتب','payroll'],['crews',null,'الأجور والطواقم','crews']]}),
  leadership:Object.freeze({label:'الإدارة',icon:'leadership',nav:'leadership',pages:[['leadershipHub',null,'لوحة الإدارة','leadership'],['actionCenter',null,'المهام الآن','tasks'],['compliance',null,'السلامة والأمن','safety'],['conference',null,'المؤتمر السنوي','conference'],['research',null,'البحث والتطوير','research'],['esg',null,'الاستدامة','esg'],['businessWorld',null,'العلاقات التجارية','relations'],['realism',null,'السوق والاقتصاد','economy'],['news',null,'الأخبار','news']]}),
  system:Object.freeze({label:'النظام',icon:'settings',nav:'system',pages:[['systemHub',null,'لوحة النظام','settings'],['store',null,'المتجر','treasury'],['settings',null,'الحفظ والإعدادات','settings'],['investorMode',null,'وضع المستثمر الحر','treasury'],['updates',null,'التحديثات','updates'],['diagnostics',null,'صحة اللعبة','diagnostics'],['controlPlane',null,'مركز التحكم','control-plane']]})
});
const SECTION_OF=Object.freeze({groupHub:'group',companies:'group',progression:'group',groupManagement:'group',network:'group',expansion:'group',ports:'group',formationContract:'group',
  financeHub:'finance',finance:'finance',monthlyFinance:'finance',treasury:'finance',budgets:'finance',invoices:'finance',market:'finance',stocks:'finance',
  peopleHub:'people',labor:'people',crews:'people',
  leadershipHub:'leadership',actionCenter:'leadership',compliance:'leadership',conference:'leadership',research:'leadership',esg:'leadership',businessWorld:'leadership',realism:'leadership',news:'leadership',
  systemHub:'system',store:'system',settings:'system',investorMode:'system',updates:'system',diagnostics:'system',controlPlane:'system'});
// Each section opens on its own control panel (the first page of its strip).
const HUBS=Object.freeze({groupHub:'group',financeHub:'finance',peopleHub:'people',leadershipHub:'leadership',systemHub:'system'});
const HUB_TITLES=Object.freeze({groupHub:'لوحة المجموعة',financeHub:'لوحة المال',peopleHub:'لوحة الأفراد',leadershipHub:'لوحة الإدارة',systemHub:'لوحة النظام'});
// Pages that only exist inside one company: they follow the company that opened them.
const COMPANY_PAGES=new Set(['hospitality','serviceCompany','company','companyMarket','operatingAssetMarket','assets','assetMarket','routes','globalRoute','companyFacilities','facilityManage','assetManage','mobilityAsset','contracts','maintenance','procurement','companyManage','energy','bank','insurance','realestate']);
const DEEP_KIND=Object.freeze({energy:'power',bank:'bank',insurance:'insurance',realestate:'realestate'});
// Retired pages open their new home, so every old link, alert and task still lands somewhere real.
const REDIRECTS=Object.freeze({control:['groupHub',null],governanceHub:['compliance',null],cyber:['compliance',null],safety:['compliance',null]});

let installed=null,stickyCompany=null;
function argCompany(state,panel,arg){
  if(panel==='hospitality'||panel==='serviceCompany')return String(typeof arg==='string'?arg:arg?.company||'');
  if(panel==='company')return String(arg||'');
  if(['companyMarket','operatingAssetMarket'].includes(panel))return String(typeof arg==='string'?arg:arg?.company||'');
  if(DEEP_KIND[panel])return companyOfKind(state,DEEP_KIND[panel]);
  if(panel==='companyManage')return String((arg&&typeof arg==='object'?arg.type:String(arg||'').split(':')[0])||'');
  if(panel==='invoices')return arg&&typeof arg==='object'?String(arg.company||''):String(arg||'');
  if(['assets','assetMarket','routes','companyFacilities','contracts','maintenance','crews','budgets'].includes(panel))return typeof arg==='string'?arg:'';
  // A company's "assign an executive" opens the managers page for that company (labor, `managers:<company>`): it stays
  // in the company's section like the company's other pages (owner's decision, review of every company panel).
  if(panel==='labor')return typeof arg==='string'?arg.split(':')[1]||'':'';
  return '';
}
function locate(state,panel,arg){
  const explicit=argCompany(state,panel,arg),opened=new Set(openedCompanies(state).map(row=>row.id));
  if(explicit&&opened.has(explicit))return {section:'company',company:explicit};
  if(COMPANY_PAGES.has(panel)&&stickyCompany&&opened.has(stickyCompany)&&panel!=='companyManage')return {section:'company',company:stickyCompany};
  return {section:SECTION_OF[panel]||(COMPANY_PAGES.has(panel)?'group':'map'),company:null};
}
// VENTORA: the release edition (GH_EDITION from the iPhone app) has no developer pages; a link to one opens the settings.
const DEV_PAGES=new Set(['updates','diagnostics','controlPlane']),isRelease=()=>globalThis.GH_EDITION==='release',shown=page=>!(isRelease()&&DEV_PAGES.has(page));
function redirect(panel,arg){if(!shown(panel))return ['settings',undefined];const target=REDIRECTS[panel];return target?[target[0],target[1]===null?undefined:target[1]]:null;}
function rail(state,panel,arg){const place=locate(state,panel,arg);if(place.section==='company')return '';return SECTIONS[place.section]?.nav||'map';}
function meta(state,panel,arg){
  if(panel==='hospitality')return tileTitle(state,panel,arg)||['الفنادق والمنتجعات',shortName(state,argCompany(state,panel,arg))];
  if(panel==='serviceCompany'){const id=argCompany(state,panel,arg),kind=KINDS[kindOf(state,id)];return tileTitle(state,panel,arg)||[kind?.sector||'الشركة',shortName(state,id)];}
  if(panel==='companyMarket'||panel==='operatingAssetMarket')return [shortName(state,argCompany(state,panel,arg)),panel==='companyMarket'?'السوق والمنافسون':'شراء أعمال قائمة'];
  if(panel==='company'){const id=String(arg||''),kind=KINDS[kindOf(state,id)];return [kind?.sector||'الشركة',shortName(state,id)];}
  if(panel==='procurement')return ['العمليات','الطلبات قيد التسليم'];
  if(panel==='labor'){const id=argCompany(state,panel,arg),kind=id?KINDS[kindOf(state,id)]:null;if(kind)return [kind.sector,'المديرون التنفيذيون'];}
  if(HUBS[panel])return [SECTIONS[HUBS[panel]].label,HUB_TITLES[panel]];
  // A company page carries the name of the tile that opens it (the "المطارات والقواعد" tile opens a page of that name,
  // not "قواعد ومراكز الشركة") under the company's sector; opened from the group, a page keeps its general name.
  if(TILE_TITLED.has(panel))return tileTitle(state,panel,arg);
  return null;
}
const TILE_TITLED=new Set(['companyFacilities','contracts','crews','maintenance','budgets','invoices','assets','assetMarket','routes','energy','bank','insurance','realestate']);
// The tile of this company that opens the page (the one naming the same tab first). The company desks (energy, bank,
// insurance, real estate) also take their tab as a plain string and open on their overview without one.
const DESK_PANELS=new Set(['energy','bank','insurance','realestate']);
function tileTitle(state,panel,arg){
  const id=argCompany(state,panel,arg),kind=id?KINDS[kindOf(state,id)]:null;if(!kind)return null;
  const tab=arg&&typeof arg==='object'?(arg.tab??(DESK_PANELS.has(panel)?'overview':undefined)):DESK_PANELS.has(panel)?(typeof arg==='string'&&arg?arg:'overview'):undefined,rows=[kind.hero,...kind.tiles].filter(row=>row.to(id)[0]===panel),tile=rows.find(row=>tab!==undefined&&row.to(id)[1]?.tab===tab)||rows[0];
  return tile?[kind.sector,tile.title]:null;
}

// ---- Rendering -----------------------------------------------------------------------------------------------------
function tileMarkup(tile,id,extra=''){
  const [panel,arg]=tile.to(id),art=tile.map?`<svg class="mc-routes" viewBox="0 0 176 99" aria-hidden="true"><path d="M90 52Q106 30 124 50M90 52Q66 26 40 38M124 50Q146 46 162 70"></path><circle cx="90" cy="52" r="3.2"></circle><circle cx="124" cy="50" r="3.2"></circle><circle cx="40" cy="38" r="3.2"></circle></svg>`:'';
  return `<button type="button" class="mc-tile" ${go(panel,arg)} data-tile="${esc(tile.key)}"><img src="${ui(tile.img)}" alt="" loading="lazy" decoding="async">${art}<span class="mc-scrim"></span><span class="mc-badge">${icon(tile.icon)}</span>${extra}<span class="mc-text"><b>${esc(tile.title)}</b><small>${esc(tile.sub||'')}</small></span></button>`;
}
// A money figure stays left to right inside the Arabic chips («مطالبات $55.2K», not «55.2K$»).
function money(ctx,value){const shown=ctx.fmtMoney?.(Number(value)||0);return shown?`\u2066${shown}\u2069`:String(value);}
function companyFacts(state,id,ctx,readFleet=false){
  let summary=null,performance=null,balance=null,manager=null,fleet=null;
  try{const instance=openedCompanies(state).find(row=>row.id===id);summary=globalThis.GH_ADVANCED?.companyOverviewSummary?.(state,instance)||null;}catch(_error){}
  try{performance=ctx.companyPerformance?.(id,30)||null;}catch(_error){}
  try{balance=ctx.companyOperatingBalance?.(id);}catch(_error){}
  try{manager=globalThis.GH_HR_CORE?.officialManager?.(state,id)||null;}catch(_error){}
  // Service panels never display these fleet facts. Enqueuing their unused million-row query can delay the same
  // worker's save proof when the player accepts or rejects a request; only fleet panels need this aggregate.
  if(readFleet)try{fleet=ctx.companyFleetStats?.(id)||null;}catch(_error){}
  return {summary,performance,balance,manager,fleet};
}
// One panel for a company and for a section, laid out for the landscape phone: the status line (with the count of open
// decisions), three figures, a short hero strip and the page tiles fit the first screen beside the map. "بالكامل" turns
// it into two columns (figures, hero and decisions; tiles in three columns) instead of stretching one image across.
function heroMarkup(hero){
  const [panel,arg]=hero.to;
  return `<button type="button" class="mc-tile mc-hero" ${go(panel,arg)} data-tile="${esc(hero.key)}"><img src="${ui(hero.img)}" alt="" decoding="async"><span class="mc-scrim mc-scrim-side"></span><span class="mc-text"><small class="mc-kicker">${esc(hero.title)}</small>${hero.count?`<span class="mc-hero-count">${hero.count}</span>`:''}<span class="mc-chips">${(hero.chips||[]).filter(Boolean).map(text=>`<span class="mc-chip">${esc(text)}</span>`).join('')}</span></span></button>`;
}
function panelMarkup({kind='',status,kpis,hero,tiles,extra='',decisions,pending=null}){
  const pendingCount=pending?.count||0,total=decisions.length+pendingCount;
  const decisionMarkup=total?`<section class="mc-decide" aria-label="يحتاج قرارك"><h3>يحتاج قرارك</h3>${pending?.markup||''}${decisions.map(([ic,title,copy,panel,arg,label])=>`<div class="mc-decision"><span class="mc-decision-icon">${icon(ic)}</span><span class="mc-decision-copy"><b>${esc(title)}</b><small>${esc(copy)}</small></span><button type="button" class="mc-act" ${go(panel,arg)}>${esc(label)}</button></div>`).join('')}</section>`:'';
  const pill=total?`<button type="button" class="mc-pill" data-mc-decide>يحتاج قرارك <b>${esc(num(total))}</b></button>`:'';
  return `<div class="madar-company"${kind?` data-kind="${esc(kind)}"`:''}><div class="mc-main"><div class="mc-head"><p class="mc-manager">${status}</p>${pill}</div><div class="mc-kpis">${kpis.map(([label,value,cls])=>`<div class="mc-kpi"><span>${esc(label)}</span><b class="${esc(cls)}">${esc(value)}</b></div>`).join('')}</div>${heroMarkup(hero)}${decisionMarkup}</div><div class="mc-grid">${tiles}${extra}</div></div>`;
}
const statusLine=(tone,text)=>`<small class="mc-status is-${tone}"><i></i>${esc(text)}</small>`;
// Build 377 (owner's decision): the companies without transport assets open on the same panel as the airline again
// (the hero with their main count and tiles); the decisions waiting for the player (insurance risks, tenant requests,
// bank and dealership customer-finance requests, from company-revenue-chain-core) are accepted or rejected in its
// "needs your decision" section, one by one or all in one batch, through the owners' existing batch commands.
const SERVICE_KINDS=new Set(['insurance','realestate','telecom','dealership','bank']);
function chainDecisionDetail(ctx,kindId,row){
  const x=row.detail||{},left=Number(row.daysLeft),due=Number.isFinite(left)?` · ${left?`يسقط بعد ${num(left)} ${left===1?'يوم':left<11?'أيام':'يومًا'}`:'يسقط اليوم'}`:'';
  if(kindId==='insurance')return `قسط سنوي ${money(ctx,x.premium)} · خسارة متوقعة ${money(ctx,x.expectedLoss)}${due}`;
  if(kindId==='realestate')return `إيجار سنوي ${money(ctx,x.annualRent)} · ${num(x.years)} ${x.years>2&&x.years<11?'سنوات':'سنة'}${due}`;
  if(kindId==='telecom')return `${num(x.lines)} خط · ${money(ctx,x.monthlyValue)} شهريًا · ${num(x.months)} شهرًا${due}`;
  return `${money(ctx,x.amount)}${x.grade?` · درجة ${x.grade}`:''}${due}`;
}
function pendingDecisions(state,id,ctx,kindId){
  let chain=null;try{chain=globalThis.GH_REVENUE_CHAIN?.build?.(state,id,kindId);}catch(_error){chain=null;}
  const decide=globalThis.GH_ADVANCED?.pendingDecisionAction,rows=chain?.decisions||[];if(!rows.length)return null;
  const bulk=decide&&rows.length>1?`<div class="mc-bulk">${decide(chain.batch,id,'accept',`قبول الكل (${num(rows.length)})`)}${decide(chain.batch,id,'reject',`رفض الكل (${num(rows.length)})`,{secondary:true})}</div>`:'';
  const markup=bulk+rows.map(row=>`<div class="mc-decision mc-pending"><span class="mc-decision-copy"><b>${esc(row.title)}</b><small>${esc(chainDecisionDetail(ctx,kindId,row))}</small></span>${decide?`<span class="mc-row-actions">${decide(chain.batch,id,'accept','قبول',{request:row.id})}${decide(chain.batch,id,'reject','رفض',{request:row.id,secondary:true})}</span>`:''}</div>`).join('');
  return {count:rows.length,markup};
}
function marketChip(state,kindId,ctx){
  const B=globalThis.GH_CUSTOMER_BASE;
  if(kindId==='insurance'){const raw=state.insurance?.solvency?.ratio,ratio=raw==null?NaN:Number(raw);return Number.isFinite(ratio)?`الملاءة ${num(Math.round(ratio))}%${state.insurance.solvency.writing===false?' · الاكتتاب موقوف':''}`:'';}
  if(kindId==='bank'){const ratio=Number(state.bank?.leverageRatio);return Number.isFinite(ratio)&&ratio>0?`الرافعة ${ratio.toFixed(1)}%`:'';}
  if(kindId==='realestate'){const value=Number(B?.propertyValue?.(state));return Number.isFinite(value)?`سوق العقار ${num(Math.round(value*100))}`:'';}
  if(kindId==='dealership'){const last=state.customerCompanies?.companies?.dealership?.market?.dailyHistory?.[0];return last?`بعد البيع ${money(ctx,(Number(last.serviceRevenue)||0)+(Number(last.usedRevenue)||0)+(Number(last.financeCommission)||0))}/يوم`:'';}
  if(kindId==='telecom'){const branches=state.customerCompanies?.companies?.telecom?.market?.branches||[],day=Math.floor((Number(state.simSeconds)||0)/86400),cheaper=typeof B?.rivalPrice==='function'?branches.filter(row=>B.rivalPrice(row.country,'telecom',day)<1).length:0;return branches.length?`منافس أرخص ${num(cheaper)}/${num(branches.length)}`:'';}
  return '';
}
// Build 378: a second market fact per company, in the hero like the air company's "in motion": the stock finance, the
// network, off-plan units or service charges, claims awaiting payment, bancassurance, and satisfaction when it slips.
function marketChip2(state,kindId,ctx){
  const satisfied=value=>Number.isFinite(Number(value))&&Number(value)<80?`الرضا ${num(Math.round(Number(value)))}`:'';
  if(kindId==='dealership'){const m=state.customerCompanies?.companies?.dealership?.market;return m?`تمويل: ${m.floorPlan?'بنك':'نقدًا'}`:'';}
  if(kindId==='telecom'){const branches=state.customerCompanies?.companies?.telecom?.market?.branches||[],own=branches.filter(row=>Number(row.networkLevel)>0).length;return branches.length?`شبكة خاصة ${num(own)}/${num(branches.length)}`:'';}
  if(kindId==='realestate'){const re=state.realEstate,presold=(re?.projects||[]).reduce((sum,row)=>sum+(Number(row.presold)||0),0),roll=Number(re?.serviceChargeRoll)||0;return presold?`خارطة ${num(presold)} وحدة`:roll>0?`رسوم ${money(ctx,roll)}/سنة`:'';}
  if(kindId==='insurance'){const ins=state.insurance,low=satisfied(ins?.satisfaction);if(low)return low;const reserve=(ins?.claimsReserve||[]).reduce((sum,row)=>sum+(Number(row.amount)||0),0);return reserve>0?`احتياطي مطالبات ${money(ctx,reserve)}`:'';}
  if(kindId==='bank'){const low=satisfied(state.bank?.satisfaction);if(low)return low;const sold=Number(state.bank?.dailyHistory?.[0]?.groupInsured)||0;return sold?`تأمين بنكي ${num(sold)}`:'';}
  if(kindId==='power'){let mw=0;try{for(const row of globalThis.GH_ENERGY_CORE?.siteEconomics?.(state)||[])if(!row.commissioned&&Number(row.phasedShare)>0)mw+=(Number(row.capacity)||0)*Number(row.phasedShare);}catch(_error){mw=0;}return mw>0?`كتل تبيع ${num(Math.round(mw))} ميغاواط`:'';}
  return '';
}
function renderCompany(state,id,ctx){
  const kindId=kindOf(state,id),kind=KINDS[kindId];if(!kind)return '<div class="empty">الشركة غير مفتوحة أو غير معروفة.</div>';
  stickyCompany=id;const facts=companyFacts(state,id,ctx,kind.fleet===true),perf=facts.performance,net=Number(perf?.net)||0,reported=Number(perf?.reportedDays)||0,summary=facts.summary;
  const kpis=[['رصيد الشركة',Number.isFinite(Number(facts.balance))?money(ctx,facts.balance):'—',''],['صافي 30 يومًا',reported?`${net>0?'+':''}${money(ctx,net)}`:'لم يُقفل بعد',reported?(net>=0?'positive':'negative'):'is-text'],[summary?.primaryOperatingLabel||'التشغيل',typeof summary?.primaryOperatingCount==='number'?num(summary.primaryOperatingCount):(summary?.primaryOperatingCount??'—'),'']];
  const status=facts.manager?.name?statusLine('good',`تعمل · المدير: ${facts.manager.name}`):statusLine('warn','بلا مدير تنفيذي معيّن');
  let chips=[],count='';
  if(kind.fleet){
    // The worker summary arrives a moment after the first paint (app.js re-renders the panel then); until it does,
    // the bounded overview count is exact for small fleets.
    const mobility=kindId==='mobility'?globalThis.GH_MOBILITY_CORE?.managementSnapshot?.(state):null,boundedCount=summary?.category==='fleet'&&typeof summary.primaryOperatingCount==='number'?summary.primaryOperatingCount:null,boundedMoving=Number((summary?.metrics||[]).find(([label])=>label==='رحلات جارية')?.[1]),stats=mobility?{total:Number(mobility.vehicles)||0,moving:Number(mobility.moving)||0,service:null}:facts.fleet||(boundedCount!==null?{total:boundedCount,moving:Number.isFinite(boundedMoving)?boundedMoving:0,service:null}:null);
    count=stats?`<b class="mc-count">${esc(num(stats.total))}</b><small>${esc(countNoun(stats.total,kind.unit))}</small>`:`<b class="mc-count">—</b><small>جارٍ تحديث الأسطول</small>`;
    chips=stats?[`في الحركة ${num(stats.moving)}`,stats.service!=null?`تحتاج صيانة ${num(stats.service)}`:'']:[];
  }else{
    // A metric that repeats the hero's main count is left out (Build 378) to make room for the market facts.
    const main=String(summary?.primaryOperatingLabel||''),repeats=label=>main.includes(String(label||'').replace(/^ال/,''));
    chips=(summary?.metrics||[]).filter(([label])=>!repeats(label)).slice(0,SERVICE_KINDS.has(kindId)?1:3).map(([label,value])=>`${label} ${typeof value==='number'?num(value):value}`);
    if(kindId==='power')chips.push(marketChip2(state,kindId,ctx));
    // Build 377 (owner's decision): the companies without transport assets show their main count like the fleet
    // companies, and the market they sell into (solvency, leverage, the property market, rivals, after-sales).
    if(SERVICE_KINDS.has(kindId))chips.push(marketChip(state,kindId,ctx),marketChip2(state,kindId,ctx));
    // Every company's hero carries its main count (owner review: power, hotels and the four new companies had none).
    const n=summary?.primaryOperatingCount;if(typeof n==='number')count=`<b class="mc-count">${esc(num(n))}</b><small>${esc(countLabel(n,summary.primaryOperatingLabel))}</small>`;
  }
  const hero=kind.hero;
  const decisions=[],pending=SERVICE_KINDS.has(kindId)?pendingDecisions(state,id,ctx,kindId):null;
  if(kind.fleet&&facts.fleet?.service>0)decisions.push(['maintenance',`${num(facts.fleet.service)} ${countNoun(facts.fleet.service,kind.unit)} تحتاج صيانة`,'افتح الصيانة لمراجعة السياسة والفحوص','maintenance',id,'مراجعة']);
  if(!pending?.count)for(const [label,value] of summary?.metrics||[])if(/بانتظار|طلبات|عروض/.test(String(label))&&Number(value)>0)decisions.push(['tasks',`${label}: ${value}`,'قرار مفتوح في هذه الشركة',hero.to(id)[0],hero.to(id)[1],'فتح']);
  if(!facts.manager?.name)decisions.push(['executive','عيّن مديرًا تنفيذيًا','الشركة تعمل بلا مدير رسمي','labor',`managers:${id}`,'تعيين']);
  return panelMarkup({kind:kindId,status,kpis,hero:{key:hero.key,title:hero.title,img:hero.img,to:hero.to(id),count,chips},tiles:tilesFor(state,id).map(tile=>tileMarkup(tile,id)).join(''),decisions,pending});
}

// ---- Section panels --------------------------------------------------------------------------------------------------
// Every figure is read from what the game already keeps (state totals, the daily closes, the task list the alerts use,
// the HR health summary): opening a section adds no new pass over the fleet, the documents or the ledger.
const T=(key,title,sub,img,icon,panel,arg,map)=>Object.freeze({key,title,sub,img,icon,map:!!map,to:()=>[panel,arg]});
const HUB_TILES=Object.freeze({
  group:[T('levels','المستويات والتراخيص','ما يُفتح في كل مستوى','company-system-v2','performance','progression'),T('performance','أداء الشركات','أرباح وتشغيل كل شركة','group-boardroom','performance','groupManagement'),T('fleet','أسطول المجموعة','الطائرات والسفن والشاحنات','ship-container','fleet-all','assets','all'),T('directory','الدليل العالمي','المدن والمطارات والموانئ','routes-map','directory','network',undefined,true),T('facilities','كل المنشآت','القواعد والموانئ والمراكز','facility-port-v2','facilities','expansion'),T('charter','عقد التأسيس','رأس المال والملكية','finance-documents','charter','formationContract')],
  finance:[T('treasury','الخزينة','السيولة والتمويل الداخلي','bank-vault','treasury','treasury'),T('budgets','الميزانيات','سقف شهري لكل شركة','company-bank-v2','budget','budgets'),T('invoices','المستندات','الذمم والضرائب والديون','finance-documents','documents','invoices'),T('market','الأسواق والتحوط','الوقود والعملات والمحفظة','finance-markets','markets','market'),T('deals','الاستحواذات','صفقات شراء الشركات','lead-partners','acquisitions','market','deals'),T('stocks','الأسهم والطرح','المحفظة والطرح العام','insurance-risk','stocks','stocks'),T('books','الدفاتر والقوائم','دفاتر الشركات والتحويلات والقوائم','company-hq-v2','revenue','finance')],
  people:[T('coverage','تغطية الوظائف','احتياجات المراكز والمنشآت','people-team','people-dash','labor','dashboard'),T('jobs','الوظائف','التوظيف والإعلانات','air-crew','jobs','labor','jobs'),T('contracts','عقود العمل','العقود السارية والتجديد','lead-partners','employment','labor','contracts'),T('payroll','الرواتب','المسير والتكاليف','finance-budget','payroll','labor','payroll'),T('crews','الأجور والطواقم','الأجر مقابل السوق والاستقالات','sea-crew','crews','crews')],
  leadership:[T('compliance','السلامة والأمن','الأسطول والأمن السيبراني والكربون','lead-security','safety','compliance'),T('conference','المؤتمر السنوي','نتائج السنة أمام المساهمين','lead-news','conference','conference'),T('research','البحث والتطوير','مشروعات ترفع الكفاءة','lead-rnd','research','research'),T('esg','الاستدامة','برامج تخفض الوقود والانبعاثات','lead-esg','esg','esg'),T('relations','العلاقات التجارية','العملاء والموردون والرعايات','lead-partners','relations','businessWorld'),T('economy','السوق والاقتصاد','الوقود والطلب والأسعار','finance-markets','economy','realism'),T('news','الأخبار','العقود والمال والرعايات','insurance-risk','news','news')],
  system:[T('store','المتجر','بلس والرخص وحزم رأس المال','bank-vault','treasury','store'),T('settings','الحفظ والإعدادات','الخانات والتوقيع والحفظ','telecom-datacenter','settings','settings'),T('investor','وضع المستثمر الحر','سيولة بلا حدود للتجربة','bank-vault','treasury','investorMode'),T('updates','التحديثات','ملفات التحديث والحزم','energy-control','updates','updates'),T('diagnostics','صحة اللعبة','الأداء والأخطاء والفحص','company-bank-v2','diagnostics','diagnostics'),T('controlPlane','مركز التحكم','الصلاحيات والأنظمة','lead-security','control-plane','controlPlane')]
});
const TASK_DOMAINS=Object.freeze({group:['التشغيل','الشركات'],finance:['المال','المالية'],people:['القيادة','الأفراد'],system:['النظام']});
function sectionTasks(state,section){let tasks=[];try{tasks=globalThis.GH_UI_QUALITY?.collectTasks?.(state)||[];}catch(_error){}const domains=TASK_DOMAINS[section];return domains?tasks.filter(task=>domains.includes(task.domain)):tasks;}
const taskDecision=task=>[task.priority==='critical'?'safety':'tasks',task.title,task.reason||'يتطلب مراجعة أو متابعة',task.panel||'actionCenter',undefined,'فتح'];
const countMarkup=(value,unit)=>`<b class="mc-count">${esc(value)}</b><small>${esc(unit)}</small>`;
const signed=(ctx,value)=>`${value>0?'+':''}${money(ctx,value)}`;
function groupHub(state,ctx){
  const opened=openedCompanies(state),n=opened.length,facilities=(state.globalBases?.length||0)+(state.customHubs?.length||0)+(state.branches?.length||0);
  let vacant=0;for(const row of opened){try{if(!globalThis.GH_HR_CORE?.officialManager?.(state,row.id))vacant++;}catch(_error){}}
  const decisions=[];
  if(vacant)decisions.push(['executive',`${num(vacant)} ${vacant===1?'شركة':'شركات'} بلا مدير تنفيذي`,'أفضل مرشح لكل شركة في اعتماد واحد','labor','managers','تعيين']);
  if(n&&!facilities)decisions.push(['facilities','لا توجد منشآت بعد','افتح أول قاعدة من الدليل العالمي','network',undefined,'فتح']);
  decisions.push(...sectionTasks(state,'group').slice(0,3).map(taskDecision));
  return panelMarkup({status:n?statusLine('good',`${num(n)} ${n===1?'شركة تعمل':'شركات تعمل'} · السمعة ${num(state.profile?.reputation||0)}/100`):statusLine('warn','لا شركات تابعة بعد'),
    kpis:[['قيمة المجموعة',money(ctx,state.groupValue),''],['السيولة',money(ctx,state.cash),''],['الدين',money(ctx,state.debt),'']],
    hero:{key:'companies',title:'شركات المجموعة',img:'company-hq-v2',to:['companies'],count:countMarkup(num(n),n===1?'شركة تعمل':'شركات تعمل'),chips:[...opened.slice(0,3).map(row=>KINDS[kindOf(state,row.id)]?.sector||shortName(state,row.id)),n>3?`\u2066+${num(n-3)}\u2069`:'']},
    tiles:HUB_TILES.group.map(tile=>tileMarkup(tile)).join(''),extra:`<button type="button" class="mc-add" ${go('companies','subs')} data-tile="open-company">${glyph('add')}<span>فتح شركة جديدة</span></button>`,decisions});
}
function financeHub(state,ctx){
  let perf=null;try{perf=globalThis.GH_FINANCE_CORE?.performance?.(state,'group',30)||null;}catch(_error){}
  const reported=Number(perf?.reportedDays)||0,net=Number(perf?.net)||0,decisions=[];
  if(reported&&net<0)decisions.push(['monthly-income','آخر 30 يومًا خاسرة',`صافي ${signed(ctx,net)}: راجع الدخل والمصروف`,'monthlyFinance',undefined,'مراجعة']);
  decisions.push(...sectionTasks(state,'finance').slice(0,3).map(taskDecision));
  return panelMarkup({status:reported?statusLine(net>=0?'good':'warn',net>=0?'آخر 30 يومًا رابحة':'آخر 30 يومًا خاسرة'):statusLine('good','لم يُقفل أي يوم بعد'),
    kpis:[['السيولة الموحدة',money(ctx,state.cash),''],['صافي 30 يومًا',reported?signed(ctx,net):'لم يُقفل بعد',reported?(net>=0?'positive':'negative'):'is-text'],['الديون',money(ctx,state.debt),'']],
    hero:{key:'monthly',title:'الدخل والمصروف · 30 يومًا',img:'finance-budget',to:['monthlyFinance'],count:countMarkup(reported?signed(ctx,net):'—','صافي'),chips:reported?[`دخل ${money(ctx,perf.grossRevenue)}`,`مصروف ${money(ctx,perf.expenses)}`]:['بانتظار أول إقفال يومي']},
    tiles:HUB_TILES.finance.map(tile=>tileMarkup(tile)).join(''),decisions});
}
function peopleHub(state,ctx){
  let health=null;try{health=globalThis.GH_HR_CORE?.health?.(state,ctx)||null;}catch(_error){}
  const people=(state.hired?.length||0)+(state.crew||[]).reduce((n,row)=>n+(Number(row?.count)||0),0)+(state.mobility?.drivers?.length||0);
  const managers=Number(health?.officialManagers)||0,required=Number(health?.officialManagerRequired)||0,vacant=Math.max(0,required-managers),missing=Number(health?.facilityMissing)||0,decisions=[];
  if(vacant)decisions.push(['executive',`${num(vacant)} ${vacant===1?'شركة':'شركات'} بلا مدير تنفيذي`,'أفضل مرشح لكل شركة في اعتماد واحد','labor','managers','تعيين']);
  if(missing)decisions.push(['people-dash',`${num(missing)} وظيفة غير مغطاة`,'المراكز والمنشآت تحتاج موظفين','labor','dashboard','توظيف']);
  decisions.push(...sectionTasks(state,'people').slice(0,3).map(taskDecision));
  return panelMarkup({status:vacant?statusLine('warn',`${num(vacant)} ${vacant===1?'شركة':'شركات'} بلا مدير تنفيذي`):statusLine('good',required?'كل الشركات لها مدير تنفيذي':'لا شركات تحتاج مديرًا بعد'),
    kpis:[['الموظفون',num(people),''],['تغطية الوظائف',health?`${num(health.coverage)}%`:'—',''],['عقود سارية',health?num(health.contracts):'—','']],
    hero:{key:'managers',title:'المديرون التنفيذيون',img:'people-recruit',to:['labor','managers'],count:countMarkup(`${num(managers)}/${num(required)}`,'شركات لها مدير'),chips:[vacant?`${num(vacant)} شواغر`:'',health?.openRequisitions?`طلبات توظيف ${num(health.openRequisitions)}`:'']},
    tiles:HUB_TILES.people.map(tile=>tileMarkup(tile)).join(''),decisions});
}
function leadershipHub(state){
  const tasks=sectionTasks(state,'leadership'),critical=tasks.filter(task=>task.priority==='critical').length,high=tasks.filter(task=>task.priority==='high').length;
  return panelMarkup({status:critical?statusLine('warn',`${num(critical)} ${critical===1?'مهمة حرجة تنتظرك':'مهام حرجة تنتظرك'}`):statusLine('good','لا مهام حرجة الآن'),
    kpis:[['المهام المفتوحة',num(tasks.length),''],['حرجة',num(critical),critical?'negative':''],['السمعة',`${num(state.profile?.reputation||0)}/100`,'']],
    hero:{key:'tasks',title:'المهام الآن',img:'energy-control',to:['actionCenter'],count:countMarkup(num(tasks.length),tasks.length===1?'مهمة مفتوحة':'مهام مفتوحة'),chips:[`حرجة ${num(critical)}`,`مرتفعة ${num(high)}`]},
    tiles:HUB_TILES.leadership.map(tile=>tileMarkup(tile)).join(''),decisions:tasks.slice(0,4).map(taskDecision)});
}
function systemHub(state,ctx){
  let save=null;try{save=ctx.savePolicyStatus?.()||null;}catch(_error){}
  const ago=Number(save?.lastSaveAgoMs),minutes=Math.round(ago/60000),slots=(state.advanced?.saveSlots||[]).filter(Boolean).length;
  const last=!Number.isFinite(ago)||ago>86400000?'—':minutes<1?'الآن':`قبل ${num(minutes)} د`;
  const decisions=sectionTasks(state,'system').slice(0,3).map(taskDecision);
  return panelMarkup({status:decisions.length?statusLine('warn','النظام يحتاج مراجعة'):statusLine('good','الحفظ التلقائي يعمل'),
    kpis:[['نسخة اللعبة',String(ctx.appVersion||'—'),''],...(isRelease()?[]:[['الكتالوج',String(state.advanced?.content?.catalogVersion||'—'),'']]),['خانات الحفظ',`${num(slots)} من 3`,'is-text']],
    hero:{key:'save',title:'آخر حفظ',img:'company-system-v2',to:['settings'],count:countMarkup(last,''),chips:[save?.capMinutes?`تلقائي كل ${num(save.capMinutes)} د`:'','الحفظ والخانات']},
    tiles:HUB_TILES.system.filter(tile=>shown(tile.to()[0])).map(tile=>tileMarkup(tile)).join(''),decisions});
}
const HUB_RENDER=Object.freeze({groupHub,financeHub,peopleHub,leadershipHub,systemHub});
function render(panel,arg,ctx){
  if(panel==='company')return renderCompany(ctx.state,String(arg||''),ctx);
  if(HUB_RENDER[panel]){stickyCompany=null;return HUB_RENDER[panel](ctx.state,ctx);}
  return null;
}

// ---- Chrome: drawer header, page strip, company dock, rail -----------------------------------------------------------
const STRIP_TABS=Object.freeze({'data-labortab':value=>value,'data-energy-tab':tab=>({tab}),'data-bank-tab':tab=>({tab}),'data-insurance-tab':tab=>({tab}),'data-realestate-tab':tab=>({tab})});
function stripFor(state,panel,arg,place){
  if(place.section==='company'){
    const id=place.company,kind=KINDS[kindOf(state,id)];if(!kind)return [];
    // A page with no argument returns a one-item target: its label must not land in the argument slot.
    const row=(target,label,ic)=>[target[0],target[1],label,ic];
    const rows=[['company',id,'لوحة الشركة','dashboard'],row(kind.hero.to(id),kind.hero.title,kind.hero.icon),...tilesFor(state,id).map(tile=>row(tile.to(id),tile.title,tile.icon))];
    return rows.map(([p,a,label,ic])=>({panel:p,arg:a,label,icon:ic}));
  }
  const section=SECTIONS[place.section];return section?section.pages.filter(([p])=>shown(p)).map(([p,a,label,ic])=>({panel:p,arg:a===null?undefined:a,label,icon:ic})):[];
}
function sameTarget(panel,arg,row){
  if(row.panel===panel&&['companyMarket','operatingAssetMarket'].includes(panel))return String(typeof arg==='string'?arg:arg?.company||'')===String(row.arg);
  if(row.panel!==panel)return false;if(row.arg===undefined||row.arg===null)return arg===undefined||arg===null||arg===''||typeof arg==='object'&&!arg.tab&&!arg.view;
  if(typeof row.arg==='object'&&row.arg){const tab=arg&&typeof arg==='object'?arg.tab:undefined;return row.arg.tab===undefined||row.arg.tab===(tab||'overview');}
  if(panel==='labor')return String(arg||'dashboard').split(':')[0]===String(row.arg).split(':')[0];
  return String(arg??'')===String(row.arg);
}
// Opening a page must stay cheap: the head mark, the page strip and the dock are rewritten only when what they show
// changes. Identities (names, logos) are re-read when companies open or on the page that edits them.
let lastMark='',lastNav='',dockKey='',dockActive=null;
const IDENTITY_PAGES=new Set(['companyManage']);
function decorate(root,panel,arg,ctx){
  const state=ctx.state,place=locate(state,panel,arg),drawer=document.getElementById('drawer'),refresh=IDENTITY_PAGES.has(panel);
  if(drawer){drawer.dataset.domain=place.section==='company'?'company':place.section;drawer.dataset.company=place.company||'';}
  const mark=document.getElementById('drawerMark'),eyebrow=document.getElementById('drawerEyebrow'),markKey=`${place.section}|${place.company||''}`;
  if(place.section==='company'){
    if(mark&&(markKey!==lastMark||refresh))mark.innerHTML=logoImg(state,place.company)||icon('group');
    if(eyebrow)eyebrow.textContent=KINDS[kindOf(state,place.company)]?.sector||shortName(state,place.company);
  }else{
    const section=SECTIONS[place.section];if(mark&&markKey!==lastMark)mark.innerHTML=icon(section?.icon||'map');if(eyebrow&&section)eyebrow.textContent=section.label;
  }
  lastMark=markKey;
  const nav=document.getElementById('sectionNav');
  if(nav){
    const rows=stripFor(state,panel,arg,place);
    const html=rows.map(row=>`<button type="button" class="${sameTarget(panel,arg,row)?'on':''}" ${go(row.panel,row.arg)}${sameTarget(panel,arg,row)?' aria-current="page"':''}>${glyph(row.icon)}<span>${esc(row.label)}</span></button>`).join('');
    nav.hidden=!rows.length;
    if(html!==lastNav){lastNav=html;nav.innerHTML=html;const active=nav.querySelector('.on');if(active)requestAnimationFrame(()=>{const a=active.getBoundingClientRect(),n=nav.getBoundingClientRect();if(a.left<n.left||a.right>n.right)nav.scrollLeft+=(a.left+a.width/2)-(n.left+n.width/2);});}
    // A page's own tab bar whose every tab is already a chip in the strip would show the same buttons twice: the strip
    // owns that navigation, so the bar is hidden (it stays in the markup as the page's tab state).
    const chips=new Set(rows.map(row=>`${row.panel}|${JSON.stringify(row.arg??null)}`));
    for(const bar of root.querySelectorAll('.tabs')){
      const tabs=[...bar.querySelectorAll('button')];
      bar.classList.toggle('mc-in-strip',tabs.length>0&&tabs.every(button=>{const attr=Object.keys(STRIP_TABS).find(name=>button.hasAttribute(name));return !!attr&&chips.has(`${panel}|${JSON.stringify(STRIP_TABS[attr](button.getAttribute(attr)))}`);}));
    }
  }
  syncDock(state,place.company,refresh);
}
function syncDock(state,activeCompany=null,refresh=false){
  const dock=document.getElementById('companyDock');if(!dock)return;
  const key=(state.openedCompanies||[]).join(',');
  if(key!==dockKey||refresh||!dock.childElementCount){
    dockKey=key;dockActive=undefined;
    dock.innerHTML='<div class="dock-strip">'+openedCompanies(state).map(row=>{const name=shortName(state,row.id);return `<button type="button" ${go('company',row.id)} aria-label="لوحة ${esc(name)}" title="${esc(name)}">${logoImg(state,row.id)||`<b>${esc(name.slice(0,3))}</b>`}</button>`;}).join('')+'</div>'+`<button type="button" class="dock-add" ${go('companies','subs')} aria-label="فتح شركة جديدة" title="فتح شركة جديدة">${glyph('add')}</button>`;
    dock.hidden=false;
  }
  if(activeCompany===dockActive)return;dockActive=activeCompany;
  const wanted=activeCompany?JSON.stringify(activeCompany):null;let active=null;
  for(const button of dock.querySelectorAll('button[data-go="company"]')){const on=button.dataset.goArg===wanted;button.classList.toggle('on',on);if(on){button.setAttribute('aria-current','page');active=button;}else button.removeAttribute('aria-current');}
  const strip=dock.querySelector('.dock-strip')||dock;
  if(active)requestAnimationFrame(()=>{const a=active.getBoundingClientRect(),d=strip.getBoundingClientRect();if(a.left<d.left||a.right>d.right)strip.scrollLeft+=(a.left+a.width/2)-(d.left+d.width/2);});
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
    const pill=event.target.closest?.('#drawer [data-mc-decide]');
    if(pill){pill.closest('.madar-company')?.querySelector('.mc-decide')?.scrollIntoView({block:'start',behavior:'smooth'});return;}
    const target=event.target.closest?.('[data-go]');if(!target||!installed)return;
    if(!target.closest('#drawer,#sectionNav,#companyDock'))return;
    event.preventDefault();const panel=target.dataset.go;let arg;try{arg=target.dataset.goArg?JSON.parse(target.dataset.goArg):undefined;}catch(_error){arg=undefined;}
    if(HUBS[panel]||['companies','finance','settings'].includes(panel))stickyCompany=null;
    installed.openDrawer(panel,arg);
  });
  const expand=document.getElementById('drawerExpand');
  expand?.addEventListener('click',()=>{const shell=document.querySelector('.app-shell'),on=!shell.classList.contains('panel-expanded');shell.classList.toggle('panel-expanded',on);expand.setAttribute('aria-pressed',String(on));const mark=expand.querySelector('.mg');mark?.classList.toggle('ic-collapse',on);mark?.classList.toggle('ic-expand',!on);expand.setAttribute('aria-label',on?'العودة بجانب الخريطة':'فتح القسم بالكامل');});
  // The overlay state the map strip, the sheet dock and the status capsule follow, kept as two classes on the app root
  // (drawer-open, overlay-open) when the drawer, the calendar, the layers popover or the asset card opens or closes. The
  // :has() rules they replace searched the whole app on every change inside it (iPhone ui.open up to 38 ms; selector
  // statistics: 135 µs a check, 687 elements restyled to open a 38-element page).
  const overlayShell=document.getElementById('app'),overlayDrawer=document.getElementById('drawer'),overlayOthers=['simCalendarPanel','filterPopover','assetCard'].map(id=>document.getElementById(id)).filter(Boolean);
  const syncOverlay=()=>{if(!overlayShell||!overlayDrawer)return;const open=overlayDrawer.classList.contains('open');overlayShell.classList.toggle('drawer-open',open);overlayShell.classList.toggle('store-open',open&&overlayDrawer.dataset.panel==='store');overlayShell.classList.toggle('overlay-open',open||overlayOthers.some(node=>!node.classList.contains('hidden')));};
  if(overlayShell&&overlayDrawer&&typeof MutationObserver==='function'){const watch=new MutationObserver(syncOverlay);for(const node of [overlayDrawer,...overlayOthers])watch.observe(node,{attributes:true,attributeFilter:['class','data-panel']});}
  syncOverlay();
  try{syncDock(getState(),null,true);}catch(_error){}
}
// The name of the tile that opens a page, for the cards inside it (one page, one name; panel review).
const titleFor=(state,panel,arg)=>tileTitle(state,panel,arg)?.[1]||null;
globalThis.GH_MADAR=Object.freeze({VERSION:'1.1.0',KINDS,SECTIONS,HUBS,kindOf,openedCompanies,locate,redirect,rail,meta,render,decorate,sync,syncDock,install,tilesFor,titleFor});
})();
