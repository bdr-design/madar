/* Build 373 · مدار: the map stays in the centre and every company has its own control panel.
   Presentation and navigation only. Each option opens an existing page through its existing route, every action keeps
   its owner (data-gh-action and the app.js handlers), and retired panel ids still open, redirected to their new home. */
(()=>{'use strict';
const arEn=(ar,en)=>globalThis.GH_I18N?.L?.(ar,en)??ar;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// MADAR icons (madar-icons.js): an option card shows its realistic glyph on a glass tile; the page strip and the
// frame controls draw the glyph bare.
const icon=id=>globalThis.GH_ICONS?.tile(id)||'';
const glyph=id=>globalThis.GH_ICONS?.glyph(id)||'';
const ui=name=>`assets/images/ui/${name}.webp`;
const platform=()=>globalThis.GH_COMPANY_PLATFORM;
// One digit style across the shell, the same Western digits as the money figures in the top bar.
const num=value=>Number.isFinite(Number(value))?Number(value).toLocaleString('en-US'):'—';
// A counted noun from the copy owner, in the page's language («شركة واحدة», «3 شركات», «11 شركةً»; «1 company»,
// «3 companies»): both texts of a pair carry this one placeholder. The plain number without the owner.
const counted=(value,noun)=>{try{return globalThis.GH_ARABIC_COPY.count(value,noun);}catch(_error){return num(value);}};
// A count and its noun agree in Arabic (owner review: «8 سيارة», «1 فروع البنك»): 3 to 10 take the plural, every other
// count the singular; a label without a known noun is shown as written. The labels are the summary's (advanced-core.js),
// in the same two languages.
const COUNT_NOUNS=Object.freeze({[arEn('فروع البنك','Bank branches')]:[arEn('فرع','branch'),arEn('فروع','branches')],[arEn('المشاريع العقارية','Real estate projects')]:[arEn('مشروع عقاري','real estate project'),arEn('مشاريع عقارية','real estate projects')],[arEn('قاعدة العملاء','Customer base')]:[arEn('عميل','customer'),arEn('عملاء','customers')],[arEn('مركبات التنقل','Mobility vehicles')]:[arEn('مركبة','vehicle'),arEn('مركبات','vehicles')],[arEn('مشاريع الطاقة','Energy projects')]:[arEn('مشروع طاقة','energy project'),arEn('مشاريع طاقة','energy projects')],[arEn('منشآت تشغيلية','Operating facilities')]:[arEn('منشأة تشغيلية','operating facility'),arEn('منشآت تشغيلية','operating facilities')],[arEn('وثائق تأمين','Insurance policies')]:[arEn('وثيقة تأمين','insurance policy'),arEn('وثائق تأمين','insurance policies')],[arEn('أصول متحركة','Moving assets')]:[arEn('أصل متحرك','moving asset'),arEn('أصول متحركة','moving assets')]});
// In English: one takes the singular, every other count the plural.
const countNoun=(value,forms)=>{if(!Array.isArray(forms))return String(forms||'');if(globalThis.GH_I18N?.isEn?.())return Math.abs(Math.trunc(Number(value)||0))===1?forms[0]:forms[1];const n=Math.abs(Math.trunc(Number(value)||0))%100;return n===2||(n>=3&&n<=10)?forms[1]:forms[0];};
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
const MANAGE=Object.freeze({key:'manage',title:arEn('الإدارة والهوية','Management and identity'),sub:arEn('المدير · الاسم والشعار · الجودة والأتمتة','Manager · name and logo · quality and automation'),img:'group-boardroom',icon:'manage',to:id=>['companyManage',{type:id,tab:'overview'}]});
const FINANCE=Object.freeze({key:'finance',title:arEn('مالية الشركة','Company finance'),sub:arEn('المستندات · الالتزامات · الأرباح','Documents · obligations · profits'),img:'finance-budget',icon:'company-finance',to:id=>['invoices',{company:id,tab:'overview'}]});
const BUDGET=Object.freeze({key:'budget',title:arEn('ميزانية الشركة','Company budget'),sub:arEn('سقف شهري ملزم لكل بند','A binding monthly cap per item'),img:'finance-documents',icon:'budget',to:id=>['budgets',id]});
const fleetKind=(sector,unit,fleetTitle,fleetImg,fleetIcon,rows)=>Object.freeze({sector,unit,fleet:true,hero:{key:'fleet',title:fleetTitle,img:fleetImg,icon:fleetIcon,to:id=>['assets',id]},tiles:Object.freeze([...rows,
  {key:'deliveries',title:arEn('قيد التسليم','In delivery'),sub:arEn('الطلبات المدفوعة في الطريق','Paid orders on the way'),img:'company-system-v2',icon:'deliveries',to:()=>['procurement']},
  MANAGE,FINANCE,BUDGET])});
const KINDS=Object.freeze({
  air:fleetKind(arEn('الطيران','Aviation'),[arEn('طائرة','aircraft'),arEn('طائرات','aircraft')],arEn('الأسطول الجوي','Air fleet'),'air-widebody','fleet-air',[
    {key:'buy',title:arEn('شراء طائرات','Buy aircraft'),sub:arEn('جديد ومستعمل · مقارنة · شراء مفصّل','New and used · compare · detailed purchase'),img:'air-narrow',icon:'buy-air',to:id=>['assetMarket',id]},
    {key:'routes',title:arEn('الخطوط الجوية','Air routes'),sub:arEn('الخطوط وتعيين الطائرات','Routes and aircraft assignment'),img:'routes-map',icon:'route-air',map:true,to:id=>['routes',id]},
    {key:'bases',title:arEn('المطارات والقواعد','Airports and bases'),sub:arEn('قواعد الشركة وفتح قاعدة جديدة','Company bases and opening a new base'),img:'facility-airport-v2',icon:'tower',to:id=>['companyFacilities',id]},
    {key:'contracts',title:arEn('عقود الشحن الجوي','Air cargo contracts'),sub:arEn('المناقصات والعقود السارية','Tenders and active contracts'),img:'air-cargo',icon:'contract-air',to:id=>['contracts',id]},
    {key:'maintenance',title:arEn('الصيانة والتأمين','Maintenance and insurance'),sub:arEn('سياسة الفحص والتغطية','Inspection and cover policy'),img:'air-hangar',icon:'maintenance',fuel:true,to:id=>['maintenance',id]},
    {key:'crews',title:arEn('الطواقم والأجور','Crews and wages'),sub:arEn('مستوى الأجور مقابل السوق','Wage level against the market'),img:'air-crew',icon:'pilot',fuel:true,to:id=>['crews',id]}]),
  sea:fleetKind(arEn('الشحن البحري','Shipping'),[arEn('سفينة','ship'),arEn('سفن','ships')],arEn('الأسطول البحري','Sea fleet'),'ship-container','fleet-sea',[
    {key:'buy',title:arEn('شراء سفن','Buy ships'),sub:arEn('من المغذّية إلى الناقلات العملاقة','From feeders to giant carriers'),img:'ship-tanker',icon:'buy-sea',to:id=>['assetMarket',id]},
    {key:'routes',title:arEn('الخطوط البحرية','Sea routes'),sub:arEn('الخطوط وتعيين السفن','Routes and ship assignment'),img:'routes-map',icon:'route-sea',map:true,to:id=>['routes',id]},
    {key:'bases',title:arEn('الموانئ والقواعد','Ports and bases'),sub:arEn('موانئ الشركة وفتح ميناء جديد','Company ports and opening a new port'),img:'facility-port-v2',icon:'port',to:id=>['companyFacilities',id]},
    {key:'contracts',title:arEn('عقود الشحن البحري','Sea freight contracts'),sub:arEn('المناقصات والعقود السارية','Tenders and active contracts'),img:'ship-lng',icon:'contract-sea',to:id=>['contracts',id]},
    {key:'maintenance',title:arEn('الصيانة والتأمين','Maintenance and insurance'),sub:arEn('سياسة الفحص والتغطية','Inspection and cover policy'),img:'sea-drydock',icon:'maintenance',fuel:true,to:id=>['maintenance',id]},
    {key:'carbon',title:arEn('تصنيف الكربون CII','CII carbon rating'),sub:arEn('خطط تحسين الامتثال البحري','Maritime compliance improvement plans'),img:'ship-support',icon:'carbon',to:()=>['compliance']},
    {key:'crews',title:arEn('الطواقم والأجور','Crews and wages'),sub:arEn('مستوى الأجور مقابل السوق','Wage level against the market'),img:'sea-crew',icon:'captain',fuel:true,to:id=>['crews',id]}]),
  road:fleetKind(arEn('النقل والتوزيع','Transport and distribution'),[arEn('شاحنة','truck'),arEn('شاحنات','trucks')],arEn('الأسطول البري','Road fleet'),'truck-longhaul-v2','fleet-road',[
    {key:'buy',title:arEn('شراء شاحنات','Buy trucks'),sub:arEn('من التوصيل الحضري إلى النقل الثقيل','From urban delivery to heavy haulage'),img:'truck-container',icon:'buy-road',to:id=>['assetMarket',id]},
    {key:'routes',title:arEn('المسارات البرية','Road routes'),sub:arEn('المسارات ونقاط التسليم','Routes and delivery points'),img:'routes-map',icon:'route-road',map:true,to:id=>['routes',id]},
    {key:'bases',title:arEn('المستودعات والمراكز','Depots and centres'),sub:arEn('مراكز الشركة وفتح مركز جديد','Company centres and opening a new centre'),img:'facility-logistics-v2',icon:'warehouse',to:id=>['companyFacilities',id]},
    {key:'contracts',title:arEn('عقود التوزيع','Distribution contracts'),sub:arEn('المناقصات والعقود السارية','Tenders and active contracts'),img:'truck-reefer',icon:'contract-road',to:id=>['contracts',id]},
    {key:'maintenance',title:arEn('الصيانة والتأمين','Maintenance and insurance'),sub:arEn('سياسة الفحص والتغطية','Inspection and cover policy'),img:'road-workshop',icon:'maintenance',fuel:true,to:id=>['maintenance',id]},
    {key:'crews',title:arEn('السائقون والأجور','Drivers and wages'),sub:arEn('مستوى الأجور مقابل السوق','Wage level against the market'),img:'road-drivers',icon:'driver',fuel:true,to:id=>['crews',id]}]),
  mobility:fleetKind(arEn('التنقل الذكي','Smart mobility'),[arEn('سيارة','car'),arEn('سيارات','cars')],arEn('سيارات التنقل','Mobility cars'),'mobility-hero','fleet-car',[
    {key:'buy',title:arEn('شراء سيارات','Buy cars'),sub:arEn('سيارات كهربائية وهجينة للمدن','Electric and hybrid cars for cities'),img:'auto-delivery',icon:'buy-car',to:id=>['assetMarket',id]},
    {key:'routes',title:arEn('خطوط المدن','City lines'),sub:arEn('التشغيل داخل المدن','Operation inside cities'),img:'routes-map',icon:'route-city',map:true,to:id=>['routes',id]},
    {key:'bases',title:arEn('فروع المدن','City branches'),sub:arEn('مراكز التشغيل وفتح فرع جديد','Operation centres and opening a new branch'),img:'mobility-charging',icon:'city-branch',to:id=>['companyFacilities',id]},
    {key:'maintenance',title:arEn('الصيانة والتأمين','Maintenance and insurance'),sub:arEn('سياسة الفحص والتغطية','Inspection and cover policy'),img:'mobility-driver',icon:'maintenance',fuel:true,to:id=>['maintenance',id]}]),
  power:Object.freeze({sector:arEn('الطاقة والتخزين','Energy and storage'),hero:{key:'projects',title:arEn('المحطات والمشاريع','Plants and projects'),img:'energy-solar',icon:'solar',to:()=>['energy',{tab:'projects'}]},tiles:Object.freeze([
    {key:'overview',title:arEn('لوحة الطاقة','Energy dashboard'),sub:arEn('من التطوير إلى التحصيل','From development to collection'),img:'energy-battery',icon:'energy-dash',to:()=>['energy',{tab:'overview'}]},
    {key:'operations',title:arEn('التشغيل والتوزيع','Operation and dispatch'),sub:arEn('الأحمال والصيانة المجدولة','Loads and scheduled maintenance'),img:'energy-control',icon:'grid',to:()=>['energy',{tab:'operations'}]},
    {key:'control',title:arEn('العقود والتمويل','Contracts and finance'),sub:arEn('عقود البيع والوقود وتمويل المشاريع','Sale, fuel and project finance contracts'),img:'ship-lng',icon:'contract-power',to:()=>['energy',{tab:'control'}]},
    {key:'revenue',title:arEn('الإيرادات','Revenue'),sub:arEn('التسوية والتدفق النقدي','Settlement and cash flow'),img:'finance-markets',icon:'revenue',to:()=>['energy',{tab:'revenue'}]},
    {key:'sites',title:arEn('مواقع المحطات','Plant sites'),sub:arEn('محطات الشركة وموقع محطة جديدة','Company plants and a new plant site'),img:'energy-wind',icon:'power-site',to:id=>['companyFacilities',id]},
    {key:'contracts',title:arEn('المناقصات والعقود','Tenders and contracts'),sub:arEn('عقود الطاقة مع العملاء','Energy contracts with customers'),img:'lead-partners',icon:'tender',to:id=>['contracts',id]},
    MANAGE,FINANCE,BUDGET])}),
  bank:Object.freeze({sector:arEn('الخدمات المصرفية','Banking services'),hero:{key:'credit',title:arEn('الائتمان والقروض','Credit and loans'),img:'bank-credit',icon:'credit',to:()=>['bank',{tab:'credit'}]},tiles:Object.freeze([
    {key:'overview',title:arEn('لوحة البنك','Bank dashboard'),sub:arEn('الودائع والائتمان والدخل والسلامة','Deposits, credit, income and soundness'),img:'company-bank-v2',icon:'bank',to:()=>['bank',{tab:'overview'}]},
    {key:'branches',title:arEn('الفروع والخدمات','Branches and services'),sub:arEn('الحملات وفتح فرع جديد','Campaigns and opening a new branch'),img:'bank-branch',icon:'atm',to:()=>['bank',{tab:'branches'}]},
    {key:'control',title:arEn('السيولة والمخاطر','Liquidity and risk'),sub:arEn('التسعير والاستثمار والحدود','Pricing, investment and limits'),img:'bank-vault',icon:'liquidity',to:()=>['bank',{tab:'control'}]},
    {key:'revenue',title:arEn('الإيرادات','Revenue'),sub:arEn('الفوائد والرسوم المحققة','Interest and fees earned'),img:'finance-markets',icon:'revenue',to:()=>['bank',{tab:'revenue'}]},
    MANAGE,FINANCE,BUDGET])}),
  insurance:Object.freeze({sector:arEn('التأمين','Insurance'),hero:{key:'overview',title:arEn('لوحة التأمين','Insurance dashboard'),img:'insurance-hero',icon:'umbrella',to:()=>['insurance',{tab:'overview'}]},tiles:Object.freeze([
    {key:'lines',title:arEn('المنتجات والتسعير','Products and pricing'),sub:arEn('الأسعار وإعادة التأمين','Prices and reinsurance'),img:'insurance-risk',icon:'pricing',to:()=>['insurance',{tab:'lines'}]},
    {key:'offices',title:arEn('المكاتب','Offices'),sub:arEn('الحملات وفتح مكتب جديد','Campaigns and opening a new office'),img:'insurance-branch',icon:'office',to:()=>['insurance',{tab:'offices'}]},
    {key:'claims',title:arEn('المطالبات','Claims'),sub:arEn('الاحتياطي والسداد','Reserve and payment'),img:'insurance-claims',icon:'claims',to:()=>['insurance',{tab:'claims'}]},
    MANAGE,FINANCE,BUDGET])}),
  realestate:Object.freeze({sector:arEn('التطوير العقاري','Real estate development'),hero:{key:'overview',title:arEn('لوحة العقار','Real estate dashboard'),img:'realestate-sales',icon:'house',to:()=>['realestate',{tab:'overview'}]},tiles:Object.freeze([
    {key:'projects',title:arEn('المشاريع','Projects'),sub:arEn('البيع والتأجير والإشغال','Sales, leasing and occupancy'),img:'realestate-villas',icon:'construction',to:()=>['realestate',{tab:'projects'}]},
    {key:'develop',title:arEn('تطوير مشروع','Develop a project'),sub:arEn('المدينة والنوع والتمويل','City, type and financing'),img:'realestate-hero',icon:'develop',to:()=>['realestate',{tab:'develop'}]},
    {key:'offices',title:arEn('المكاتب','Offices'),sub:arEn('مكاتب الشركة وفتح مكتب جديد','Company offices and opening a new office'),img:'realestate-mall',icon:'office',to:id=>['companyFacilities',id]},
    MANAGE,FINANCE,BUDGET])}),
  telecom:Object.freeze({sector:arEn('الاتصالات','Telecom'),hero:{key:'operations',title:arEn('الاشتراكات والشرائح','Subscriptions and SIM cards'),img:'telecom-store',icon:'sim',to:id=>['companyManage',{type:id,tab:'operations'}]},tiles:Object.freeze([
    {key:'network',title:arEn('الشبكة والفروع','Network and branches'),sub:arEn('فتح الفروع من دليل المدن','Open branches from the city directory'),img:'telecom-fiber',icon:'antenna',to:id=>['companyFacilities',id]},
    {key:'datacenter',title:arEn('نظرة الشركة','Company overview'),sub:arEn('التشغيل والإيراد والعملاء','Operation, revenue and customers'),img:'telecom-datacenter',icon:'datacenter',to:id=>['companyManage',{type:id,tab:'overview'}]},
    {...MANAGE,to:id=>['companyManage',{type:id,tab:'management'}],sub:arEn('المدير التنفيذي والتوظيف','Chief executive and hiring')},FINANCE,BUDGET])}),
  hospitality:Object.freeze({sector:arEn('الفنادق والمنتجعات','Hotels and resorts'),hero:{key:'operations',title:arEn('تشغيل الفنادق والمنتجعات','Hotel and resort operations'),img:'realestate-hero',icon:'house',to:id=>['hospitality',{company:id,tab:'overview'}]},tiles:Object.freeze([
    {key:'properties',title:arEn('الفنادق والمنتجعات','Hotels and resorts'),sub:arEn('المواقع والإنشاء والتشغيل','Sites, construction and operation'),img:'realestate-villas',icon:'facilities',to:id=>['hospitality',{company:id,tab:'properties'}]},
    {key:'reservations',title:arEn('حجوزات المجموعات','Group bookings'),sub:arEn('الغرف والليالي والعقود','Rooms, nights and contracts'),img:'realestate-mall',icon:'documents',to:id=>['hospitality',{company:id,tab:'reservations'}]},
    {key:'settlements',title:arEn('الإيرادات والتسويات','Revenue and settlements'),sub:arEn('إقامة فعلية وتسويات يوم 15','Actual stays and settlements on day 15'),img:'finance-budget',icon:'revenue',to:id=>['hospitality',{company:id,tab:'finance'}]},
    {...MANAGE,to:id=>['companyManage',{type:id,tab:'management'}]},FINANCE,BUDGET])}),
  media:Object.freeze({sector:arEn('الإعلام والإنتاج','Media and production'),hero:{key:'operations',title:arEn('الإنتاج والبث','Production and broadcasting'),img:'lead-news',icon:'news',to:id=>['serviceCompany',{company:id}]},tiles:Object.freeze([
    {key:'facilities',title:arEn('الاستوديوهات','Studios'),sub:arEn('فتح منشأة من دليل المدن','Open a facility from the city directory'),img:'telecom-datacenter',icon:'facilities',to:id=>['companyFacilities',id]},
    {key:'overview',title:arEn('التشغيل والإيراد','Operation and revenue'),sub:arEn('الاستغلال والتحصيل ومستوى الأسعار','Utilisation, collection and price level'),img:'finance-budget',icon:'revenue',to:id=>['serviceCompany',{company:id}]},
    {...MANAGE,to:id=>['companyManage',{type:id,tab:'management'}],sub:arEn('المدير التنفيذي والتوظيف','Chief executive and hiring')},FINANCE,BUDGET])}),
  healthcare:Object.freeze({sector:arEn('الرعاية الصحية','Healthcare'),hero:{key:'operations',title:arEn('المستشفيات والمراجعات','Hospitals and visits'),img:'insurance-risk',icon:'safety',to:id=>['serviceCompany',{company:id}]},tiles:Object.freeze([
    {key:'facilities',title:arEn('المستشفيات','Hospitals'),sub:arEn('فتح منشأة من دليل المدن','Open a facility from the city directory'),img:'company-hq-v2',icon:'facilities',to:id=>['companyFacilities',id]},
    {key:'overview',title:arEn('التشغيل والإيراد','Operation and revenue'),sub:arEn('الاستغلال والتحصيل ومستوى الأسعار','Utilisation, collection and price level'),img:'finance-budget',icon:'revenue',to:id=>['serviceCompany',{company:id}]},
    {...MANAGE,to:id=>['companyManage',{type:id,tab:'management'}],sub:arEn('المدير التنفيذي والتوظيف','Chief executive and hiring')},FINANCE,BUDGET])}),
  education:Object.freeze({sector:arEn('التعليم','Education'),hero:{key:'operations',title:arEn('المدارس والتسجيل','Schools and enrolment'),img:'people-recruit',icon:'research',to:id=>['serviceCompany',{company:id}]},tiles:Object.freeze([
    {key:'facilities',title:arEn('المدارس','Schools'),sub:arEn('فتح منشأة من دليل المدن','Open a facility from the city directory'),img:'group-boardroom',icon:'facilities',to:id=>['companyFacilities',id]},
    {key:'overview',title:arEn('التشغيل والإيراد','Operation and revenue'),sub:arEn('الاستغلال والتحصيل ومستوى الأسعار','Utilisation, collection and price level'),img:'finance-budget',icon:'revenue',to:id=>['serviceCompany',{company:id}]},
    {...MANAGE,to:id=>['companyManage',{type:id,tab:'management'}],sub:arEn('المدير التنفيذي والتوظيف','Chief executive and hiring')},FINANCE,BUDGET])}),
  sports:Object.freeze({sector:arEn('النادي الرياضي','Sports club'),hero:{key:'operations',title:arEn('المباريات والعضويات','Matches and memberships'),img:'people-team',icon:'performance',to:id=>['serviceCompany',{company:id}]},tiles:Object.freeze([
    {key:'facilities',title:arEn('الملاعب','Stadiums'),sub:arEn('فتح منشأة من دليل المدن','Open a facility from the city directory'),img:'company-hq-v2',icon:'facilities',to:id=>['companyFacilities',id]},
    {key:'overview',title:arEn('التشغيل والإيراد','Operation and revenue'),sub:arEn('الاستغلال والتحصيل ومستوى الأسعار','Utilisation, collection and price level'),img:'finance-budget',icon:'revenue',to:id=>['serviceCompany',{company:id}]},
    {...MANAGE,to:id=>['companyManage',{type:id,tab:'management'}],sub:arEn('المدير التنفيذي والتوظيف','Chief executive and hiring')},FINANCE,BUDGET])}),
  dealership:Object.freeze({sector:arEn('وكالة السيارات','Car dealership'),hero:{key:'operations',title:arEn('المخزون والمبيعات','Stock and sales'),img:'auto-hero',icon:'car-sales',to:id=>['companyManage',{type:id,tab:'operations'}]},tiles:Object.freeze([
    {key:'service',title:arEn('خطط الخدمة والتمويل','Service and finance plans'),sub:arEn('خطط الصيانة وتسوية البيع الممول','Maintenance plans and financed sale settlement'),img:'auto-service',icon:'car-service',to:id=>['companyManage',{type:id,tab:'operations'}]},
    {key:'showrooms',title:arEn('المعارض والفروع','Showrooms and branches'),sub:arEn('فتح فرع من دليل المدن','Open a branch from the city directory'),img:'auto-delivery',icon:'showroom',to:id=>['companyFacilities',id]},
    {...MANAGE,to:id=>['companyManage',{type:id,tab:'management'}],sub:arEn('المدير التنفيذي والتوظيف','Chief executive and hiring')},FINANCE,BUDGET])})
});
function tilesFor(state,id){const kindId=kindOf(state,id),kind=KINDS[kindId];if(!kind)return [];const rows=kind.tiles.filter(tile=>!tile.fuel||fuelled(state,id));
  const ui=globalThis.GH_BUSINESS_UI;if(ui?.labels[id])rows.push({key:'market',title:arEn('السوق والمنافسون','Market and competitors'),sub:arEn('الأسعار المحلية وأرقام التشغيل','Local prices and operating figures'),img:ui.photos[kindId],icon:'markets',to:()=>['companyMarket',id]});
  if(globalThis.GH_OPERATING_ACQUISITIONS?.COMPANIES.includes(id))rows.push({key:'buy-working',title:{realestate:arEn('شراء مبنى عامل','Buy an operating building'),power:arEn('شراء محطة عاملة','Buy an operating plant'),insurance:arEn('شراء محفظة قائمة','Buy an existing portfolio'),bank:arEn('شراء أعمال فرع','Buy a branch business')}[kindId],sub:arEn('مراجعة الأرصدة والالتزامات ثم الشراء','Review the balances and obligations, then buy'),img:ui.photos[kindId],icon:{realestate:'house',power:'solar',insurance:'umbrella',bank:'atm'}[kindId],to:()=>['operatingAssetMarket',id]});
  return rows;
}

// ---- Group sections ------------------------------------------------------------------------------------------------
const SECTIONS=Object.freeze({
  group:Object.freeze({label:arEn('المجموعة','Group'),icon:'group',nav:'companies',pages:[['groupHub',null,arEn('لوحة المجموعة','Group dashboard'),'group'],['companies',null,arEn('الشركات','Companies'),'office'],['progression',null,arEn('المستويات','Levels'),'performance'],['groupManagement',null,arEn('أداء الشركات','Company performance'),'performance'],['assets','all',arEn('أسطول المجموعة','Group fleet'),'fleet-all'],['network',null,arEn('الدليل العالمي','World directory'),'directory'],['expansion',null,arEn('كل المنشآت','All facilities'),'facilities'],['formationContract',null,arEn('عقد التأسيس','Incorporation contract'),'charter']]}),
  finance:Object.freeze({label:arEn('المال','Finance'),icon:'finance',nav:'finance',pages:[['financeHub',null,arEn('لوحة المال','Finance dashboard'),'finance'],['finance',null,arEn('دفاتر الشركات','Company books'),'revenue'],['finance','transfers',arEn('التحويلات والتمويل','Transfers and funding'),'liquidity'],['finance','statements',arEn('القوائم المالية','Financial statements'),'performance'],['treasury',null,arEn('الخزينة','Treasury'),'treasury'],['monthlyFinance',null,arEn('الدخل الشهري','Monthly income'),'monthly-income'],['budgets',null,arEn('الميزانيات','Budgets'),'budget'],['invoices',null,arEn('المستندات','Documents'),'documents'],['market',null,arEn('الأسواق والتحوط','Markets and hedging'),'markets'],['market','deals',arEn('الاستحواذات','Acquisitions'),'acquisitions'],['stocks',null,arEn('الأسهم والطرح','Shares and listing'),'stocks']]}),
  people:Object.freeze({label:arEn('الأفراد','People'),icon:'people',nav:'people',pages:[['peopleHub',null,arEn('لوحة الأفراد','People dashboard'),'people'],['labor','managers',arEn('المديرون التنفيذيون','Chief executives'),'executive'],['labor','dashboard',arEn('تغطية الوظائف','Job coverage'),'people-dash'],['labor','jobs',arEn('الوظائف','Jobs'),'jobs'],['labor','contracts',arEn('عقود العمل','Employment contracts'),'employment'],['labor','payroll',arEn('الرواتب','Payroll'),'payroll'],['crews',null,arEn('الأجور والطواقم','Wages and crews'),'crews']]}),
  leadership:Object.freeze({label:arEn('الإدارة','Leadership'),icon:'leadership',nav:'leadership',pages:[['leadershipHub',null,arEn('لوحة الإدارة','Leadership dashboard'),'leadership'],['actionCenter',null,arEn('المهام الآن','Tasks now'),'tasks'],['compliance',null,arEn('السلامة والأمن','Safety and security'),'safety'],['conference',null,arEn('المؤتمر السنوي','Annual conference'),'conference'],['research',null,arEn('البحث والتطوير','Research and development'),'research'],['esg',null,arEn('الاستدامة','Sustainability'),'esg'],['businessWorld',null,arEn('العلاقات التجارية','Business relations'),'relations'],['realism',null,arEn('السوق والاقتصاد','Market and economy'),'economy'],['news',null,arEn('الأخبار','News'),'news']]}),
  system:Object.freeze({label:arEn('النظام','System'),icon:'settings',nav:'system',pages:[['systemHub',null,arEn('لوحة النظام','System dashboard'),'settings'],['store',null,arEn('المتجر','Store'),'treasury'],['settings',null,arEn('الحفظ والإعدادات','Save and settings'),'settings'],['investorMode',null,arEn('وضع المستثمر الحر','Free investor mode'),'treasury'],['updates',null,arEn('التحديثات','Updates'),'updates'],['diagnostics',null,arEn('صحة اللعبة','Game health'),'diagnostics'],['controlPlane',null,arEn('مركز التحكم','Control centre'),'control-plane']]})
});
const SECTION_OF=Object.freeze({groupHub:'group',companies:'group',progression:'group',groupManagement:'group',network:'group',expansion:'group',ports:'group',formationContract:'group',
  financeHub:'finance',finance:'finance',monthlyFinance:'finance',treasury:'finance',budgets:'finance',invoices:'finance',market:'finance',stocks:'finance',
  peopleHub:'people',labor:'people',crews:'people',
  leadershipHub:'leadership',actionCenter:'leadership',compliance:'leadership',conference:'leadership',research:'leadership',esg:'leadership',businessWorld:'leadership',realism:'leadership',news:'leadership',
  systemHub:'system',store:'system',settings:'system',investorMode:'system',updates:'system',diagnostics:'system',controlPlane:'system'});
// Each section opens on its own control panel (the first page of its strip).
const HUBS=Object.freeze({groupHub:'group',financeHub:'finance',peopleHub:'people',leadershipHub:'leadership',systemHub:'system'});
const HUB_TITLES=Object.freeze({groupHub:arEn('لوحة المجموعة','Group dashboard'),financeHub:arEn('لوحة المال','Finance dashboard'),peopleHub:arEn('لوحة الأفراد','People dashboard'),leadershipHub:arEn('لوحة الإدارة','Leadership dashboard'),systemHub:arEn('لوحة النظام','System dashboard')});
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
  if(panel==='hospitality')return tileTitle(state,panel,arg)||[arEn('الفنادق والمنتجعات','Hotels and resorts'),shortName(state,argCompany(state,panel,arg))];
  if(panel==='serviceCompany'){const id=argCompany(state,panel,arg),kind=KINDS[kindOf(state,id)];return tileTitle(state,panel,arg)||[kind?.sector||arEn('الشركة','The company'),shortName(state,id)];}
  if(panel==='companyMarket'||panel==='operatingAssetMarket')return [shortName(state,argCompany(state,panel,arg)),panel==='companyMarket'?arEn('السوق والمنافسون','Market and competitors'):arEn('شراء أعمال قائمة','Buy an existing business')];
  if(panel==='company'){const id=String(arg||''),kind=KINDS[kindOf(state,id)];return [kind?.sector||arEn('الشركة','The company'),shortName(state,id)];}
  if(panel==='procurement')return [arEn('العمليات','Operations'),arEn('الطلبات قيد التسليم','Orders in delivery')];
  if(panel==='labor'){const id=argCompany(state,panel,arg),kind=id?KINDS[kindOf(state,id)]:null;if(kind)return [kind.sector,arEn('المديرون التنفيذيون','Chief executives')];}
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
  const decisionMarkup=total?`<section class="mc-decide" aria-label="${arEn('يحتاج قرارك','Needs your decision')}"><h3>${arEn('يحتاج قرارك','Needs your decision')}</h3>${pending?.markup||''}${decisions.map(([ic,title,copy,panel,arg,label])=>`<div class="mc-decision"><span class="mc-decision-icon">${icon(ic)}</span><span class="mc-decision-copy"><b>${esc(title)}</b><small>${esc(copy)}</small></span><button type="button" class="mc-act" ${go(panel,arg)}>${esc(label)}</button></div>`).join('')}</section>`:'';
  const pill=total?`<button type="button" class="mc-pill" data-mc-decide>${arEn('يحتاج قرارك','Needs your decision')} <b>${esc(num(total))}</b></button>`:'';
  return `<div class="madar-company"${kind?` data-kind="${esc(kind)}"`:''}><div class="mc-main"><div class="mc-head"><p class="mc-manager">${status}</p>${pill}</div><div class="mc-kpis">${kpis.map(([label,value,cls])=>`<div class="mc-kpi"><span>${esc(label)}</span><b class="${esc(cls)}">${esc(value)}</b></div>`).join('')}</div>${heroMarkup(hero)}${decisionMarkup}</div><div class="mc-grid">${tiles}${extra}</div></div>`;
}
const statusLine=(tone,text)=>`<small class="mc-status is-${tone}"><i></i>${esc(text)}</small>`;
// Build 377 (owner's decision): the companies without transport assets open on the same panel as the airline again
// (the hero with their main count and tiles); the decisions waiting for the player (insurance risks, tenant requests,
// bank and dealership customer-finance requests, from company-revenue-chain-core) are accepted or rejected in its
// "needs your decision" section, one by one or all in one batch, through the owners' existing batch commands.
const SERVICE_KINDS=new Set(['insurance','realestate','telecom','dealership','bank']);
function chainDecisionDetail(ctx,kindId,row){
  const x=row.detail||{},left=Number(row.daysLeft),due=Number.isFinite(left)?` · ${left?arEn(`يسقط بعد ${num(left)} ${left===1?arEn('يوم','day'):left<11?arEn('أيام','days'):arEn('يومًا','days')}`,`Lapses in ${num(left)} ${left===1?arEn('يوم','day'):left<11?arEn('أيام','days'):arEn('يومًا','days')}`):arEn('يسقط اليوم','Lapses today')}`:'';
  if(kindId==='insurance')return arEn(`قسط سنوي ${money(ctx,x.premium)} · خسارة متوقعة ${money(ctx,x.expectedLoss)}${due}`,`Annual premium ${money(ctx,x.premium)} · expected loss ${money(ctx,x.expectedLoss)}${due}`);
  if(kindId==='realestate'){const years=x.years>2&&x.years<11?arEn('سنوات','years'):Number(x.years)===1?arEn('سنة','year'):arEn('سنة','years');return arEn(`إيجار سنوي ${money(ctx,x.annualRent)} · ${num(x.years)} ${years}${due}`,`Annual rent ${money(ctx,x.annualRent)} · ${num(x.years)} ${years}${due}`);}
  if(kindId==='telecom')return arEn(`${num(x.lines)} خط · ${money(ctx,x.monthlyValue)} شهريًا · ${num(x.months)} شهرًا${due}`,`${num(x.lines)} lines · ${money(ctx,x.monthlyValue)} monthly · ${num(x.months)} months${due}`);
  return `${money(ctx,x.amount)}${x.grade?arEn(` · درجة ${x.grade}`,` · grade ${x.grade}`):''}${due}`;
}
function pendingDecisions(state,id,ctx,kindId){
  let chain=null;try{chain=globalThis.GH_REVENUE_CHAIN?.build?.(state,id,kindId);}catch(_error){chain=null;}
  const decide=globalThis.GH_ADVANCED?.pendingDecisionAction,rows=chain?.decisions||[];if(!rows.length)return null;
  const bulk=decide&&rows.length>1?`<div class="mc-bulk">${decide(chain.batch,id,'accept',arEn(`قبول الكل (${num(rows.length)})`,`Accept all (${num(rows.length)})`))}${decide(chain.batch,id,'reject',arEn(`رفض الكل (${num(rows.length)})`,`Reject all (${num(rows.length)})`),{secondary:true})}</div>`:'';
  const markup=bulk+rows.map(row=>`<div class="mc-decision mc-pending"><span class="mc-decision-copy"><b>${esc(row.title)}</b><small>${esc(chainDecisionDetail(ctx,kindId,row))}</small></span>${decide?`<span class="mc-row-actions">${decide(chain.batch,id,'accept',arEn('قبول','Accept'),{request:row.id})}${decide(chain.batch,id,'reject',arEn('رفض','Reject'),{request:row.id,secondary:true})}</span>`:''}</div>`).join('');
  return {count:rows.length,markup};
}
function marketChip(state,kindId,ctx){
  const B=globalThis.GH_CUSTOMER_BASE;
  if(kindId==='insurance'){const raw=state.insurance?.solvency?.ratio,ratio=raw==null?NaN:Number(raw);return Number.isFinite(ratio)?arEn(`الملاءة ${num(Math.round(ratio))}%${state.insurance.solvency.writing===false?arEn(' · الاكتتاب موقوف',' · underwriting suspended'):''}`,`Solvency ${num(Math.round(ratio))}%${state.insurance.solvency.writing===false?arEn(' · الاكتتاب موقوف',' · underwriting suspended'):''}`):'';}
  if(kindId==='bank'){const ratio=Number(state.bank?.leverageRatio);return Number.isFinite(ratio)&&ratio>0?arEn(`الرافعة ${ratio.toFixed(1)}%`,`Leverage ${ratio.toFixed(1)}%`):'';}
  if(kindId==='realestate'){const value=Number(B?.propertyValue?.(state));return Number.isFinite(value)?arEn(`سوق العقار ${num(Math.round(value*100))}`,`Property market ${num(Math.round(value*100))}`):'';}
  if(kindId==='dealership'){const last=state.customerCompanies?.companies?.dealership?.market?.dailyHistory?.[0];return last?arEn(`بعد البيع ${money(ctx,(Number(last.serviceRevenue)||0)+(Number(last.usedRevenue)||0)+(Number(last.financeCommission)||0))}/يوم`,`After-sales ${money(ctx,(Number(last.serviceRevenue)||0)+(Number(last.usedRevenue)||0)+(Number(last.financeCommission)||0))}/day`):'';}
  if(kindId==='telecom'){const branches=state.customerCompanies?.companies?.telecom?.market?.branches||[],day=Math.floor((Number(state.simSeconds)||0)/86400),cheaper=typeof B?.rivalPrice==='function'?branches.filter(row=>B.rivalPrice(row.country,'telecom',day)<1).length:0;return branches.length?arEn(`منافس أرخص ${num(cheaper)}/${num(branches.length)}`,`Cheaper rival ${num(cheaper)}/${num(branches.length)}`):'';}
  return '';
}
// Build 378: a second market fact per company, in the hero like the air company's "in motion": the stock finance, the
// network, off-plan units or service charges, claims awaiting payment, bancassurance, and satisfaction when it slips.
function marketChip2(state,kindId,ctx){
  const satisfied=value=>Number.isFinite(Number(value))&&Number(value)<80?arEn(`الرضا ${num(Math.round(Number(value)))}`,`Satisfaction ${num(Math.round(Number(value)))}`):'';
  if(kindId==='dealership'){const m=state.customerCompanies?.companies?.dealership?.market;return m?arEn(`تمويل: ${m.floorPlan?arEn('بنك','bank'):arEn('نقدًا','cash')}`,`Financing: ${m.floorPlan?arEn('بنك','bank'):arEn('نقدًا','cash')}`):'';}
  if(kindId==='telecom'){const branches=state.customerCompanies?.companies?.telecom?.market?.branches||[],own=branches.filter(row=>Number(row.networkLevel)>0).length;return branches.length?arEn(`شبكة خاصة ${num(own)}/${num(branches.length)}`,`Own network ${num(own)}/${num(branches.length)}`):'';}
  if(kindId==='realestate'){const re=state.realEstate,presold=(re?.projects||[]).reduce((sum,row)=>sum+(Number(row.presold)||0),0),roll=Number(re?.serviceChargeRoll)||0;return presold?(presold===1?arEn(`خارطة ${num(presold)} وحدة`,`Off-plan ${num(presold)} unit`):arEn(`خارطة ${num(presold)} وحدة`,`Off-plan ${num(presold)} units`)):roll>0?arEn(`رسوم ${money(ctx,roll)}/سنة`,`Fees ${money(ctx,roll)}/year`):'';}
  if(kindId==='insurance'){const ins=state.insurance,low=satisfied(ins?.satisfaction);if(low)return low;const reserve=(ins?.claimsReserve||[]).reduce((sum,row)=>sum+(Number(row.amount)||0),0);return reserve>0?arEn(`احتياطي مطالبات ${money(ctx,reserve)}`,`Claims reserve ${money(ctx,reserve)}`):'';}
  if(kindId==='bank'){const low=satisfied(state.bank?.satisfaction);if(low)return low;const sold=Number(state.bank?.dailyHistory?.[0]?.groupInsured)||0;return sold?arEn(`تأمين بنكي ${num(sold)}`,`Bancassurance ${num(sold)}`):'';}
  if(kindId==='power'){let mw=0;try{for(const row of globalThis.GH_ENERGY_CORE?.siteEconomics?.(state)||[])if(!row.commissioned&&Number(row.phasedShare)>0)mw+=(Number(row.capacity)||0)*Number(row.phasedShare);}catch(_error){mw=0;}return mw>0?arEn(`كتل تبيع ${num(Math.round(mw))} ميغاواط`,`Blocks selling ${num(Math.round(mw))} MW`):'';}
  return '';
}
function renderCompany(state,id,ctx){
  const kindId=kindOf(state,id),kind=KINDS[kindId];if(!kind)return '<div class="empty">'+arEn('الشركة غير مفتوحة أو غير معروفة.','The company is not open or not known.')+'</div>';
  stickyCompany=id;const facts=companyFacts(state,id,ctx,kind.fleet===true),perf=facts.performance,net=Number(perf?.net)||0,reported=Number(perf?.reportedDays)||0,summary=facts.summary;
  const kpis=[[arEn('رصيد الشركة','Company balance'),Number.isFinite(Number(facts.balance))?money(ctx,facts.balance):'—',''],[arEn('صافي 30 يومًا','30-day net'),reported?`${net>0?'+':''}${money(ctx,net)}`:arEn('لم يُقفل بعد','Not closed yet'),reported?(net>=0?'positive':'negative'):'is-text'],[summary?.primaryOperatingLabel||arEn('التشغيل','Operation'),typeof summary?.primaryOperatingCount==='number'?num(summary.primaryOperatingCount):(summary?.primaryOperatingCount??'—'),'']];
  const status=facts.manager?.name?statusLine('good',arEn(`تعمل · المدير: ${facts.manager.name}`,`Running · manager: ${facts.manager.name}`)):statusLine('warn',arEn('بلا مدير تنفيذي معيّن','No chief executive appointed'));
  let chips=[],count='';
  if(kind.fleet){
    // The worker summary arrives a moment after the first paint (app.js re-renders the panel then); until it does,
    // the bounded overview count is exact for small fleets.
    const mobility=kindId==='mobility'?globalThis.GH_MOBILITY_CORE?.managementSnapshot?.(state):null,boundedCount=summary?.category==='fleet'&&typeof summary.primaryOperatingCount==='number'?summary.primaryOperatingCount:null,boundedMoving=Number((summary?.metrics||[]).find(([label])=>label===arEn('رحلات جارية','Trips under way'))?.[1]),stats=mobility?{total:Number(mobility.vehicles)||0,moving:Number(mobility.moving)||0,service:null}:facts.fleet||(boundedCount!==null?{total:boundedCount,moving:Number.isFinite(boundedMoving)?boundedMoving:0,service:null}:null);
    count=stats?`<b class="mc-count">${esc(num(stats.total))}</b><small>${esc(countNoun(stats.total,kind.unit))}</small>`:`<b class="mc-count">—</b><small>${arEn('جارٍ تحديث الأسطول','Updating the fleet')}</small>`;
    chips=stats?[arEn(`في الحركة ${num(stats.moving)}`,`Moving ${num(stats.moving)}`),stats.service!=null?arEn(`تحتاج صيانة ${num(stats.service)}`,`Needing maintenance ${num(stats.service)}`):'']:[];
  }else{
    // A metric that repeats the hero's main count is left out (Build 378) to make room for the market facts.
    const main=String(summary?.primaryOperatingLabel||''),repeats=label=>main.toLowerCase().includes(String(label||'').replace(/^ال/,'').toLowerCase());
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
  if(kind.fleet&&facts.fleet?.service>0)decisions.push(['maintenance',(facts.fleet.service===1?arEn(`${num(facts.fleet.service)} ${countNoun(facts.fleet.service,kind.unit)} تحتاج صيانة`,`${num(facts.fleet.service)} ${countNoun(facts.fleet.service,kind.unit)} needs maintenance`):arEn(`${num(facts.fleet.service)} ${countNoun(facts.fleet.service,kind.unit)} تحتاج صيانة`,`${num(facts.fleet.service)} ${countNoun(facts.fleet.service,kind.unit)} need maintenance`)),arEn('افتح الصيانة لمراجعة السياسة والفحوص','Open maintenance to review the policy and inspections'),'maintenance',id,arEn('مراجعة','Review')]);
  if(!pending?.count)for(const [label,value] of summary?.metrics||[])if(/بانتظار|طلبات|عروض|awaiting|requests|offers/i.test(String(label))&&Number(value)>0)decisions.push(['tasks',`${label}: ${value}`,arEn('قرار مفتوح في هذه الشركة','An open decision in this company'),hero.to(id)[0],hero.to(id)[1],arEn('فتح','Open')]);
  if(!facts.manager?.name)decisions.push(['executive',arEn('عيّن مديرًا تنفيذيًا','Appoint a chief executive'),arEn('الشركة تعمل بلا مدير رسمي','The company runs without an official manager'),'labor',`managers:${id}`,arEn('تعيين','Appoint')]);
  return panelMarkup({kind:kindId,status,kpis,hero:{key:hero.key,title:hero.title,img:hero.img,to:hero.to(id),count,chips},tiles:tilesFor(state,id).map(tile=>tileMarkup(tile,id)).join(''),decisions,pending});
}

// ---- Section panels --------------------------------------------------------------------------------------------------
// Every figure is read from what the game already keeps (state totals, the daily closes, the task list the alerts use,
// the HR health summary): opening a section adds no new pass over the fleet, the documents or the ledger.
const T=(key,title,sub,img,icon,panel,arg,map)=>Object.freeze({key,title,sub,img,icon,map:!!map,to:()=>[panel,arg]});
const HUB_TILES=Object.freeze({
  group:[T('levels',arEn('المستويات والتراخيص','Levels and licences'),arEn('ما يُفتح في كل مستوى','What each level unlocks'),'company-system-v2','performance','progression'),T('performance',arEn('أداء الشركات','Company performance'),arEn('أرباح وتشغيل كل شركة','Profit and operation of each company'),'group-boardroom','performance','groupManagement'),T('fleet',arEn('أسطول المجموعة','Group fleet'),arEn('الطائرات والسفن والشاحنات','Aircraft, ships and trucks'),'ship-container','fleet-all','assets','all'),T('directory',arEn('الدليل العالمي','World directory'),arEn('المدن والمطارات والموانئ','Cities, airports and ports'),'routes-map','directory','network',undefined,true),T('facilities',arEn('كل المنشآت','All facilities'),arEn('القواعد والموانئ والمراكز','Bases, ports and centres'),'facility-port-v2','facilities','expansion'),T('charter',arEn('عقد التأسيس','Incorporation contract'),arEn('رأس المال والملكية','Capital and ownership'),'finance-documents','charter','formationContract')],
  finance:[T('treasury',arEn('الخزينة','Treasury'),arEn('السيولة والتمويل الداخلي','Cash and internal funding'),'bank-vault','treasury','treasury'),T('budgets',arEn('الميزانيات','Budgets'),arEn('سقف شهري لكل شركة','A monthly cap for each company'),'company-bank-v2','budget','budgets'),T('invoices',arEn('المستندات','Documents'),arEn('الذمم والضرائب والديون','Receivables, taxes and debts'),'finance-documents','documents','invoices'),T('market',arEn('الأسواق والتحوط','Markets and hedging'),arEn('الوقود والعملات والمحفظة','Fuel, currencies and portfolio'),'finance-markets','markets','market'),T('deals',arEn('الاستحواذات','Acquisitions'),arEn('صفقات شراء الشركات','Company purchase deals'),'lead-partners','acquisitions','market','deals'),T('stocks',arEn('الأسهم والطرح','Shares and listing'),arEn('المحفظة والطرح العام','Portfolio and public offering'),'insurance-risk','stocks','stocks'),T('books',arEn('الدفاتر والقوائم','Books and statements'),arEn('دفاتر الشركات والتحويلات والقوائم','Company books, transfers and statements'),'company-hq-v2','revenue','finance')],
  people:[T('coverage',arEn('تغطية الوظائف','Job coverage'),arEn('احتياجات المراكز والمنشآت','Needs of the centres and facilities'),'people-team','people-dash','labor','dashboard'),T('jobs',arEn('الوظائف','Jobs'),arEn('التوظيف والإعلانات','Hiring and job ads'),'air-crew','jobs','labor','jobs'),T('contracts',arEn('عقود العمل','Employment contracts'),arEn('العقود السارية والتجديد','Active contracts and renewal'),'lead-partners','employment','labor','contracts'),T('payroll',arEn('الرواتب','Payroll'),arEn('المسير والتكاليف','Payroll run and costs'),'finance-budget','payroll','labor','payroll'),T('crews',arEn('الأجور والطواقم','Wages and crews'),arEn('الأجر مقابل السوق والاستقالات','Pay against the market and resignations'),'sea-crew','crews','crews')],
  leadership:[T('compliance',arEn('السلامة والأمن','Safety and security'),arEn('الأسطول والأمن السيبراني والكربون','Fleet, cyber security and carbon'),'lead-security','safety','compliance'),T('conference',arEn('المؤتمر السنوي','Annual conference'),arEn('نتائج السنة أمام المساهمين','The year\'s results before the shareholders'),'lead-news','conference','conference'),T('research',arEn('البحث والتطوير','Research and development'),arEn('مشروعات ترفع الكفاءة','Projects that raise efficiency'),'lead-rnd','research','research'),T('esg',arEn('الاستدامة','Sustainability'),arEn('برامج تخفض الوقود والانبعاثات','Programmes that cut fuel and emissions'),'lead-esg','esg','esg'),T('relations',arEn('العلاقات التجارية','Business relations'),arEn('العملاء والموردون والرعايات','Customers, suppliers and sponsorships'),'lead-partners','relations','businessWorld'),T('economy',arEn('السوق والاقتصاد','Market and economy'),arEn('الوقود والطلب والأسعار','Fuel, demand and prices'),'finance-markets','economy','realism'),T('news',arEn('الأخبار','News'),arEn('العقود والمال والرعايات','Contracts, money and sponsorships'),'insurance-risk','news','news')],
  system:[T('store',arEn('المتجر','Store'),arEn('بلس والرخص وحزم رأس المال','Plus, licences and capital packs'),'bank-vault','treasury','store'),T('settings',arEn('الحفظ والإعدادات','Save and settings'),arEn('الخانات والتوقيع والحفظ','Slots, signature and saving'),'telecom-datacenter','settings','settings'),T('investor',arEn('وضع المستثمر الحر','Free investor mode'),arEn('سيولة بلا حدود للتجربة','Unlimited cash for testing'),'bank-vault','treasury','investorMode'),T('updates',arEn('التحديثات','Updates'),arEn('ملفات التحديث والحزم','Update files and packages'),'energy-control','updates','updates'),T('diagnostics',arEn('صحة اللعبة','Game health'),arEn('الأداء والأخطاء والفحص','Performance, errors and checks'),'company-bank-v2','diagnostics','diagnostics'),T('controlPlane',arEn('مركز التحكم','Control centre'),arEn('الصلاحيات والأنظمة','Permissions and systems'),'lead-security','control-plane','controlPlane')]
});
// The tasks' domains are data (task.domain, written in Arabic by the task owners), never translated.
const TASK_DOMAINS=Object.freeze({group:['التشغيل','الشركات'],finance:['المال','المالية'],people:['القيادة','الأفراد'],system:['النظام']});
function sectionTasks(state,section){let tasks=[];try{tasks=globalThis.GH_UI_QUALITY?.collectTasks?.(state)||[];}catch(_error){}const domains=TASK_DOMAINS[section];return domains?tasks.filter(task=>domains.includes(task.domain)):tasks;}
const taskDecision=task=>[task.priority==='critical'?'safety':'tasks',task.title,task.reason||arEn('يتطلب مراجعة أو متابعة','Needs review or follow-up'),task.panel||'actionCenter',task.arg,arEn('فتح','Open')];
const countMarkup=(value,unit)=>`<b class="mc-count">${esc(value)}</b><small>${esc(unit)}</small>`;
const signed=(ctx,value)=>`${value>0?'+':''}${money(ctx,value)}`;
function groupHub(state,ctx){
  const opened=openedCompanies(state),n=opened.length,facilities=(state.globalBases?.length||0)+(state.customHubs?.length||0)+(state.branches?.length||0);
  let vacant=0;for(const row of opened){try{if(!globalThis.GH_HR_CORE?.officialManager?.(state,row.id))vacant++;}catch(_error){}}
  const decisions=[];
  if(vacant)decisions.push(['executive',arEn(`${counted(vacant,'company')} بلا مدير تنفيذي`,`${counted(vacant,'company')} without a chief executive`),arEn('أفضل مرشح لكل شركة في اعتماد واحد','The best candidate for each company in one approval'),'labor','managers',arEn('تعيين','Appoint')]);
  if(n&&!facilities&&!sectionTasks(state,'group').some(task=>task.id==='START:FACILITY'))decisions.push(['facilities',arEn('لا توجد منشآت بعد','No facilities yet'),arEn('افتح أول قاعدة من الدليل العالمي','Open the first base from the world directory'),'network',undefined,arEn('فتح','Open')]);
  decisions.push(...sectionTasks(state,'group').slice(0,3).map(taskDecision));
  return panelMarkup({status:n?statusLine('good',arEn(`${num(n)} ${n===1?arEn('شركة تعمل','operating company'):arEn('شركات تعمل','operating companies')} · السمعة ${num(state.profile?.reputation||0)}/100`,`${num(n)} ${n===1?arEn('شركة تعمل','operating company'):arEn('شركات تعمل','operating companies')} · reputation ${num(state.profile?.reputation||0)}/100`)):statusLine('warn',arEn('لا شركات تابعة بعد','No subsidiaries yet')),
    kpis:[[arEn('قيمة المجموعة','Group value'),money(ctx,state.groupValue),''],[arEn('السيولة','Cash'),money(ctx,state.cash),''],[arEn('الدين','Debt'),money(ctx,state.debt),'']],
    hero:{key:'companies',title:arEn('شركات المجموعة','Group companies'),img:'company-hq-v2',to:['companies'],count:countMarkup(num(n),n===1?arEn('شركة تعمل','operating company'):arEn('شركات تعمل','operating companies')),chips:[...opened.slice(0,3).map(row=>KINDS[kindOf(state,row.id)]?.sector||shortName(state,row.id)),n>3?`\u2066+${num(n-3)}\u2069`:'']},
    tiles:HUB_TILES.group.map(tile=>tileMarkup(tile)).join(''),extra:`<button type="button" class="mc-add" ${go('companies','subs')} data-tile="open-company">${glyph('add')}<span>${arEn('فتح شركة جديدة','Open a new company')}</span></button>`,decisions});
}
function financeHub(state,ctx){
  let perf=null;try{perf=globalThis.GH_FINANCE_CORE?.performance?.(state,'group',30)||null;}catch(_error){}
  const reported=Number(perf?.reportedDays)||0,net=Number(perf?.net)||0,decisions=[];
  if(reported&&net<0)decisions.push(['monthly-income',arEn('آخر 30 يومًا خاسرة','Last 30 days at a loss'),arEn(`صافي ${signed(ctx,net)}: راجع الدخل والمصروف`,`Net ${signed(ctx,net)}: review income and spending`),'monthlyFinance',undefined,arEn('مراجعة','Review')]);
  decisions.push(...sectionTasks(state,'finance').slice(0,3).map(taskDecision));
  return panelMarkup({status:reported?statusLine(net>=0?'good':'warn',net>=0?arEn('آخر 30 يومًا رابحة','Last 30 days in profit'):arEn('آخر 30 يومًا خاسرة','Last 30 days at a loss')):statusLine('good',arEn('لم يُقفل أي يوم بعد','No day closed yet')),
    kpis:[[arEn('السيولة الموحدة','Consolidated cash'),money(ctx,state.cash),''],[arEn('صافي 30 يومًا','30-day net'),reported?signed(ctx,net):arEn('لم يُقفل بعد','Not closed yet'),reported?(net>=0?'positive':'negative'):'is-text'],[arEn('الديون','Debts'),money(ctx,state.debt),'']],
    hero:{key:'monthly',title:arEn('الدخل والمصروف · 30 يومًا','Income and spending · 30 days'),img:'finance-budget',to:['monthlyFinance'],count:countMarkup(reported?signed(ctx,net):'—',arEn('صافي','Net')),chips:reported?[arEn(`دخل ${money(ctx,perf.grossRevenue)}`,`Income ${money(ctx,perf.grossRevenue)}`),arEn(`مصروف ${money(ctx,perf.expenses)}`,`Spending ${money(ctx,perf.expenses)}`)]:[arEn('بانتظار أول إقفال يومي','Waiting for the first daily close')]},
    tiles:HUB_TILES.finance.map(tile=>tileMarkup(tile)).join(''),decisions});
}
function peopleHub(state,ctx){
  let health=null;try{health=globalThis.GH_HR_CORE?.health?.(state,ctx)||null;}catch(_error){}
  const people=(state.hired?.length||0)+(state.crew||[]).reduce((n,row)=>n+(Number(row?.count)||0),0)+(state.mobility?.drivers?.length||0);
  const managers=Number(health?.officialManagers)||0,required=Number(health?.officialManagerRequired)||0,vacant=Math.max(0,required-managers),missing=Number(health?.facilityMissing)||0,decisions=[];
  if(vacant)decisions.push(['executive',arEn(`${counted(vacant,'company')} بلا مدير تنفيذي`,`${counted(vacant,'company')} without a chief executive`),arEn('أفضل مرشح لكل شركة في اعتماد واحد','The best candidate for each company in one approval'),'labor','managers',arEn('تعيين','Appoint')]);
  if(missing)decisions.push(['people-dash',(missing===1?arEn(`${num(missing)} وظيفة غير مغطاة`,`${num(missing)} job uncovered`):arEn(`${num(missing)} وظيفة غير مغطاة`,`${num(missing)} jobs uncovered`)),arEn('المراكز والمنشآت تحتاج موظفين','The centres and facilities need staff'),'labor','dashboard',arEn('توظيف','Hire')]);
  decisions.push(...sectionTasks(state,'people').slice(0,3).map(taskDecision));
  return panelMarkup({status:vacant?statusLine('warn',arEn(`${counted(vacant,'company')} بلا مدير تنفيذي`,`${counted(vacant,'company')} without a chief executive`)):statusLine('good',required?arEn('كل الشركات لها مدير تنفيذي','Every company has a chief executive'):arEn('لا شركات تحتاج مديرًا بعد','No company needs a manager yet')),
    kpis:[[arEn('الموظفون','Employees'),num(people),''],[arEn('تغطية الوظائف','Job coverage'),health?`${num(health.coverage)}%`:'—',''],[arEn('عقود سارية','Active contracts'),health?num(health.contracts):'—','']],
    hero:{key:'managers',title:arEn('المديرون التنفيذيون','Chief executives'),img:'people-recruit',to:['labor','managers'],count:countMarkup(`${num(managers)}/${num(required)}`,arEn('شركات لها مدير','Companies with a manager')),chips:[vacant?(vacant===1?arEn(`${num(vacant)} شاغر`,`${num(vacant)} vacancy`):arEn(`${num(vacant)} شواغر`,`${num(vacant)} vacancies`)):'',health?.openRequisitions?arEn(`طلبات توظيف ${num(health.openRequisitions)}`,`Hiring requests ${num(health.openRequisitions)}`):'']},
    tiles:HUB_TILES.people.map(tile=>tileMarkup(tile)).join(''),decisions});
}
function leadershipHub(state){
  const tasks=sectionTasks(state,'leadership'),critical=tasks.filter(task=>task.priority==='critical').length,high=tasks.filter(task=>task.priority==='high').length;
  return panelMarkup({status:critical?statusLine('warn',`${num(critical)} ${critical===1?arEn('مهمة حرجة تنتظرك','critical task waiting for you'):arEn('مهام حرجة تنتظرك','critical tasks waiting for you')}`):statusLine('good',arEn('لا مهام حرجة الآن','No critical tasks now')),
    kpis:[[arEn('المهام المفتوحة','Open tasks'),num(tasks.length),''],[arEn('حرجة','Critical'),num(critical),critical?'negative':''],[arEn('السمعة','Reputation'),`${num(state.profile?.reputation||0)}/100`,'']],
    hero:{key:'tasks',title:arEn('المهام الآن','Tasks now'),img:'energy-control',to:['actionCenter'],count:countMarkup(num(tasks.length),tasks.length===1?arEn('مهمة مفتوحة','open task'):arEn('مهام مفتوحة','open tasks')),chips:[arEn(`حرجة ${num(critical)}`,`Critical ${num(critical)}`),arEn(`مرتفعة ${num(high)}`,`High ${num(high)}`)]},
    tiles:HUB_TILES.leadership.map(tile=>tileMarkup(tile)).join(''),decisions:tasks.slice(0,4).map(taskDecision)});
}
function systemHub(state,ctx){
  let save=null;try{save=ctx.savePolicyStatus?.()||null;}catch(_error){}
  const ago=Number(save?.lastSaveAgoMs),minutes=Math.round(ago/60000),slots=(state.advanced?.saveSlots||[]).filter(Boolean).length;
  const last=!Number.isFinite(ago)||ago>86400000?'—':minutes<1?arEn('الآن','now'):arEn(`قبل ${num(minutes)} د`,`${num(minutes)} min ago`);
  const decisions=sectionTasks(state,'system').slice(0,3).map(taskDecision);
  return panelMarkup({status:decisions.length?statusLine('warn',arEn('النظام يحتاج مراجعة','The system needs a review')):statusLine('good',arEn('الحفظ التلقائي يعمل','Autosave is on')),
    kpis:[[arEn('نسخة اللعبة','Game version'),String(ctx.appVersion||'—'),''],...(isRelease()?[]:[[arEn('الكتالوج','Catalogue'),String(state.advanced?.content?.catalogVersion||'—'),'']]),[arEn('خانات الحفظ','Save slots'),(total=>arEn(`${num(slots)} من ${num(total)}`,`${num(slots)} of ${num(total)}`))(globalThis.GH_STORE_CORE?.featureOpen?.(state,'slots')===true||slots>3?6:3),'is-text']],
    hero:{key:'save',title:arEn('آخر حفظ','Last save'),img:'company-system-v2',to:['settings'],count:countMarkup(last,''),chips:[save?.capMinutes?arEn(`تلقائي كل ${num(save.capMinutes)} د`,`Auto every ${num(save.capMinutes)} min`):'',arEn('الحفظ والخانات','Saves and slots')]},
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
    const rows=[['company',id,arEn('لوحة الشركة','Company dashboard'),'dashboard'],row(kind.hero.to(id),kind.hero.title,kind.hero.icon),...tilesFor(state,id).map(tile=>row(tile.to(id),tile.title,tile.icon))];
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
    dock.innerHTML='<div class="dock-strip">'+openedCompanies(state).map(row=>{const name=shortName(state,row.id);return `<button type="button" ${go('company',row.id)} aria-label="${arEn(`لوحة ${esc(name)}`,`${esc(name)} dashboard`)}" title="${esc(name)}">${logoImg(state,row.id)||`<b>${esc(name.slice(0,3))}</b>`}</button>`;}).join('')+'</div>'+`<button type="button" class="dock-add" ${go('companies','subs')} aria-label="${arEn('فتح شركة جديدة','Open a new company')}" title="${arEn('فتح شركة جديدة','Open a new company')}">${glyph('add')}</button>`;
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
  expand?.addEventListener('click',()=>{const shell=document.querySelector('.app-shell'),on=!shell.classList.contains('panel-expanded');shell.classList.toggle('panel-expanded',on);expand.setAttribute('aria-pressed',String(on));const mark=expand.querySelector('.mg');mark?.classList.toggle('ic-collapse',on);mark?.classList.toggle('ic-expand',!on);expand.setAttribute('aria-label',on?arEn('العودة بجانب الخريطة','Back beside the map'):arEn('فتح القسم بالكامل','Expand the section'));});
  // The overlay state the map strip, the sheet dock and the status capsule follow, kept as two classes on the app root
  // (drawer-open, overlay-open) when the drawer, the calendar, the layers popover or the asset card opens or closes. The
  // :has() rules they replace searched the whole app on every change inside it (iPhone ui.open up to 38 ms; selector
  // statistics: 135 µs a check, 687 elements restyled to open a 38-element page).
  const overlayShell=document.getElementById('app'),overlayDrawer=document.getElementById('drawer'),overlayOthers=['simCalendarPanel','filterPopover','assetCard'].map(id=>document.getElementById(id)).filter(Boolean);
  const syncOverlay=()=>{if(!overlayShell||!overlayDrawer)return;const open=overlayDrawer.classList.contains('open');overlayShell.classList.toggle('drawer-open',open);overlayShell.classList.toggle('store-open',open&&overlayDrawer.dataset.panel==='store');overlayShell.classList.toggle('levels-open',open&&overlayDrawer.dataset.panel==='progression');overlayShell.classList.toggle('overlay-open',open||overlayOthers.some(node=>!node.classList.contains('hidden')));};
  if(overlayShell&&overlayDrawer&&typeof MutationObserver==='function'){const watch=new MutationObserver(syncOverlay);for(const node of [overlayDrawer,...overlayOthers])watch.observe(node,{attributes:true,attributeFilter:['class','data-panel']});}
  syncOverlay();
  try{syncDock(getState(),null,true);}catch(_error){}
}
// The name of the tile that opens a page, for the cards inside it (one page, one name; panel review).
const titleFor=(state,panel,arg)=>tileTitle(state,panel,arg)?.[1]||null;
globalThis.GH_MADAR=Object.freeze({VERSION:'1.1.0',KINDS,SECTIONS,HUBS,kindOf,openedCompanies,locate,redirect,rail,meta,render,decorate,sync,syncDock,install,tilesFor,titleFor});
})();
