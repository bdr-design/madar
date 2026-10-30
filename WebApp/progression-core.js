// Owner (approved design «فنتورا: تصميم المستويات وتجهيز الإطلاق», «موافق نفذ بدقه عاليه جدًا جدًا»): a career game
// climbs thirty group levels. The level opens the companies a player may found, the catalogue models a company may buy and
// the group's financial and management tools; a company's facilities and fleet grow in bands from the level it opened at.
// Free play and a save from before this build (no progression root) carry no limits at all: everything is open as it
// was. Owner (approved pricing): the investor licence is unlimited money only; in a career the levels and the experience
// stay as they are in investor mode. The level never goes down and nothing held is ever taken back; a limit refuses only
// a new purchase, opening or tool use, with the level that opens it.
// Every check is a lookup in a table or one count of held rows, made when a command is asked for, never on a frame.
(function(root,factory){const api=factory();if(root){root.GH_PROGRESSION_CORE=api;api.install();}if(typeof module!=='undefined'&&module.exports)module.exports=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const VERSION='1.0.0',SCHEMA=1,MAX_LEVEL=30;
  // Cumulative experience to reach each level (index 0 = level 1), a table so each level can be tuned alone after play.
  const XP=Object.freeze([0,100,300,600,1000,1500,2100,2800,3600,4500,5650,7100,8900,11200,14000,16800,20200,24300,29200,35000,41300,48700,57500,67800,80000,92000,105600,121300,139300,160000]);
  // The difficulty sets the founding capital (the founding modes that already exist), the experience multiplier, how many
  // levels ahead an early licence may reach and its fee factor, and the expansion grant (a share of a company's minimum
  // capital when its level is reached).
  const DIFFICULTY=Object.freeze({
    easy:Object.freeze({label:'سهل',xp:1.5,early:3,fee:.5,grant:.5,capitalMode:'career-easy'}),
    normal:Object.freeze({label:'عادي',xp:1,early:2,fee:1,grant:.25,capitalMode:'career-normal'}),
    hard:Object.freeze({label:'صعب',xp:.75,early:1,fee:2,grant:0,capitalMode:'career-hard'})
  });
  const CAREER_MODES=Object.freeze({'career-easy':'easy','career-normal':'normal','career-hard':'hard'});
  const COMPANY=Object.freeze({group:1,road:1,air:3,sea:5,media:6,telecom:8,power:10,education:11,insurance:12,dealership:14,bank:16,hospitality:18,healthcare:20,mobility:21,realestate:22,sports:25});
  // Every catalogue line (GH_ASSET_CATALOG, new and used). A used line takes the level of the new model it stands for.
  const MODEL=Object.freeze({
    'A-ATR42':3,'A-ATR72':3,'A-Q400':3,'A-AT7F':3,'A-PH300':3,'A-CL350':3,
    'A-E175':5,'A-E195E2':5,
    'A-A220':7,'A-A320N':7,'A-B38M':7,'A-A321N':7,
    'A-A321XLR':10,'A-B763F':10,'A-G650':10,'A-G7500':10,
    'A-A339':13,'A-B789':13,'A-A359':13,
    'A-B78X':16,'A-A35K':16,'A-ACJ':16,'A-B77F':16,
    'A-B779':20,'A-A35F':20,'A-B778F':20,
    'S-FDR1800':5,'S-HANDY':5,'S-UMAX':5,'S-KMAX':5,'S-TUG':5,'S-PSV':5,
    'S-WB3500':8,'S-MR':8,
    'S-NPX8200':11,'S-NCM':11,'S-LR2':11,'S-AFRA':11,'S-HLV':11,
    'S-SUEZ':14,'S-VLCC':14,'S-VLGC':14,'S-PCTC':14,
    'S-15K':17,'S-LNG':17,'S-ROPAX':17,'S-EXPED':17,
    'S-ULCV24':20,'S-CRUISE':25,
    'T-ETRANSIT':1,'T-ESPRINTER':1,'T-NPR':1,'T-ACTROS':1,'T-DAF-CONT':1,'T-SCANIA-R':1,
    'T-FH-TANK':2,'T-TGX-CHEM':2,'T-FLE':2,
    'T-TSEMI':4,'T-EACTROS':4,'T-FH16':4,'T-LOHR':4,
    'T-XCIENT':6
  });
  const USED_BASE=Object.freeze({'UA-A320C':'A-A320N','UA-B738':'A-B38M','UA-B77W':'A-B779','UA-A388':'A-B779','UA-B744F':'A-B77F','UA-B738BCF':'A-B763F','UA-ATR72':'A-ATR72',
    'US-PMX4250':'S-WB3500','US-SUEZ':'S-SUEZ','US-SPX':'S-UMAX','US-PCTC':'S-PCTC','US-MR':'S-MR','US-VLCC':'S-VLCC',
    'UT-ACTROS':'T-ACTROS','UT-SCANIA-R':'T-SCANIA-R','UT-DAF-CONT':'T-DAF-CONT','UT-FH-TANK':'T-FH-TANK','UT-EACTROS':'T-EACTROS'});
  // Tools by player command (domain:name). A command not listed is open from level 1 (the basics: transfers, budgets,
  // taxes, cheques, collections, contracts, hiring, a company's own decisions). Repaying a debt or a loan, and selling a
  // stake held, are never refused.
  const FEATURE=Object.freeze({
    'banking:branch-campaign':2,'insurance:office-campaign':2,'customer-companies:telecom-branch-campaign':2,'customer-companies:dealership-showroom-campaign':2,'services:set-price-level':2,'finance:raise-debt':2,
    'finance:transfer-reserve':3,'finance:bulk-transfer':3,
    'market:hedge-fuel':5,
    'market:trade-stock':6,
    'finance:issue-intercompany-loan':8,'finance:cash-pool-sweep':8,'finance:set-central-treasury-policy':8,
    'governance:safety-audit':9,'governance:cyber-drill':9,'governance:esg-program':9,'governance:sea-cii-plan':9,
    'market:buy-stake':10,'energy:acquire-operating':10,'insurance:acquire-operating':10,'realestate:acquire-operating':10,'banking:acquire-operating':10,'customer-companies:telecom-upgrade-network':10,
    'energy:acquire-operating-batch':12,'insurance:acquire-operating-batch':12,'realestate:acquire-operating-batch':12,'banking:acquire-operating-batch':12,'energy:finance-project':12,'energy:bid-tender':12,
    'business-world:accept-sponsorship':14,'insurance:set-reinsurance':14,
    'corporate:set-ipo':15,
    'banking:raise-wholesale-funding':18,'banking:trade-instrument':18,'banking:invest-liquidity':18,
    'realestate:finance-construction':24,'realestate:sell-to-fund':24
  });
  const COMMAND_LABEL=Object.freeze({'banking:branch-campaign':'حملات فروع البنك','insurance:office-campaign':'حملات مكاتب التأمين','customer-companies:telecom-branch-campaign':'حملات فروع الاتصالات','customer-companies:dealership-showroom-campaign':'حملات معارض السيارات','services:set-price-level':'مستويات أسعار الخدمات','finance:raise-debt':'الاقتراض الخارجي',
    'finance:transfer-reserve':'تحويل الاحتياطي','finance:bulk-transfer':'التحويل الجماعي','market:hedge-fuel':'تحوّط الوقود','market:trade-stock':'تداول الأسهم',
    'finance:issue-intercompany-loan':'القروض بين الشركات','finance:cash-pool-sweep':'تجميع النقد','finance:set-central-treasury-policy':'سياسة الخزينة المركزية',
    'governance:safety-audit':'تدقيق السلامة','governance:cyber-drill':'تمرين الأمن السيبراني','governance:esg-program':'برنامج الاستدامة','governance:sea-cii-plan':'خطة CII البحرية',
    'market:buy-stake':'شراء حصص في المنافسين','energy:acquire-operating':'شراء محطة عاملة','insurance:acquire-operating':'شراء محفظة تأمين عاملة','realestate:acquire-operating':'شراء مبنى عامل','banking:acquire-operating':'شراء بنك عامل','customer-companies:telecom-upgrade-network':'ترقية شبكة الاتصالات',
    'energy:acquire-operating-batch':'الاستحواذ الجماعي على المحطات','insurance:acquire-operating-batch':'الاستحواذ الجماعي في التأمين','realestate:acquire-operating-batch':'الاستحواذ الجماعي على المباني','banking:acquire-operating-batch':'الاستحواذ الجماعي في البنوك','energy:finance-project':'تمويل مشاريع الطاقة','energy:bid-tender':'مناقصات الطاقة',
    'business-world:accept-sponsorship':'الرعايات','insurance:set-reinsurance':'إعادة التأمين','corporate:set-ipo':'الطرح العام الأولي',
    'banking:raise-wholesale-funding':'التمويل بالجملة','banking:trade-instrument':'تداول الأدوات المصرفية','banking:invest-liquidity':'استثمار السيولة',
    'realestate:finance-construction':'تمويل البناء','realestate:sell-to-fund':'البيع للتمويل'});
  // Named tools that are not one domain command.
  const TOOL=Object.freeze({autopilot:7});
  const TOOL_LABEL=Object.freeze({autopilot:'الطيار الآلي للشركات'});
  // Facilities and fleets per company, by band: band = floor((level − the company's level) ÷ 2), lifted whole at band 5,
  // and at level 27 for fleets and 29 for facilities whatever the band.
  const BANDS=Object.freeze({facility:Object.freeze([1,3,6,10,20]),road:Object.freeze([30,150,600,3000,15000]),air:Object.freeze([3,8,20,50,150]),sea:Object.freeze([2,6,15,40,100]),mobility:Object.freeze([200,1000,3000,10000,30000])});
  const FLEET_LIFT=27,FACILITY_LIFT=29;
  // The group's regional headquarters (the founding headquarters HQ-GROUP aside): 1 to level 9, 3 from 10, then one more at
  // 19, 23, 26 and 28; no limit at 30.
  const HQ_STEPS=Object.freeze([[30,Infinity],[28,7],[26,6],[23,5],[19,4],[10,3],[1,1]]);
  const TITLES=Object.freeze([[30,'إمبراطورية النفوذ'],[25,'تكتل عالمي'],[20,'مجموعة دولية'],[15,'مجموعة إقليمية'],[10,'مجموعة وطنية'],[5,'شركة إقليمية'],[1,'مؤسسة ناشئة']]);
  const COMPANY_LABEL=Object.freeze({group:'المجموعة القابضة',road:'شركة اللوجستيات',air:'شركة الطيران',sea:'شركة الشحن البحري',media:'شركة الإعلام والإنتاج',telecom:'شركة الاتصالات',power:'شركة الطاقة',education:'شركة التعليم',insurance:'شركة التأمين',dealership:'شركة وكالات السيارات',bank:'البنك',hospitality:'شركة الفنادق والمنتجعات',healthcare:'شركة الرعاية الصحية',mobility:'شركة التنقل الذكي',realestate:'شركة التطوير العقاري',sports:'شركة الأندية الرياضية'});

  const own=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
  const plainObject=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
  function root(state){return plainObject(state?.progression)?state.progression:null;}
  // Investor mode is read from its one owner (GH_FINANCE_CORE.investorMode), as every other reader does.
  function investorMode(state){return globalThis.GH_FINANCE_CORE?.investorMode?.(state)===true;}
  // Limits apply to a career game, investor mode or not.
  function active(state){const p=root(state);return !!p&&p.mode==='career';}
  function levelForXp(xp){xp=Math.max(0,Number(xp)||0);let level=1;for(let i=1;i<XP.length;i++){if(xp>=XP[i])level=i+1;else break;}return level;}
  function level(state){const p=root(state);if(!p||p.mode!=='career')return null;return Math.max(1,Math.min(MAX_LEVEL,Math.floor(Number(p.level)||1)));}
  function title(lvl){for(const [at,name] of TITLES)if(lvl>=at)return name;return TITLES[TITLES.length-1][1];}
  function modelKey(id){id=String(id||'');return own(USED_BASE,id)?USED_BASE[id]:id;}
  // The level a key needs, or null for a key with no requirement (open from level 1). Keys: company:<id>, model:<id>,
  // command:<domain>:<name>, tool:<name>.
  function requirement(key){
    key=String(key||'');const at=key.indexOf(':'),kind=at<0?key:key.slice(0,at),id=at<0?'':key.slice(at+1);
    if(kind==='company')return own(COMPANY,id)?COMPANY[id]:null;
    if(kind==='model'){const base=modelKey(id);return own(MODEL,base)?MODEL[base]:null;}
    if(kind==='command')return own(FEATURE,id)?FEATURE[id]:null;
    if(kind==='tool')return own(TOOL,id)?TOOL[id]:null;
    return null;
  }
  function licensed(state,key){const p=root(state);return !!p&&plainObject(p.licences)&&!!p.licences[key];}
  // A Plus subscriber runs the autopilot from level 1 (approved «فنتورا بلس»).
  function unlocked(state,key){if(!active(state))return true;const need=requirement(key);return need===null||level(state)>=need||licensed(state,licenceKey(key))||(key==='tool:autopilot'&&entitled(state,'plus'));}
  function labelFor(key){
    key=String(key||'');const at=key.indexOf(':'),kind=key.slice(0,at),id=key.slice(at+1);
    if(kind==='company')return COMPANY_LABEL[id]||'هذه الشركة';
    if(kind==='model'){const item=catalogItem(id);return item?.name||'هذا الطراز';}
    if(kind==='tool')return TOOL_LABEL[id]||'هذه الأداة';
    if(kind==='command')return COMMAND_LABEL[id]||'هذه الأداة';
    return 'هذه الأداة';
  }
  function catalogItem(id){const catalog=globalThis.GH_ASSET_CATALOG;if(!catalog)return null;for(const type of ['air','sea','road'])for(const tab of ['new','used'])for(const row of catalog[type]?.[tab]||[])if(row?.id===id)return row;return null;}
  function refusal(code,message,detail={}){const error=new Error(message);error.code=code;Object.assign(error,detail);return error;}
  function lockedError(state,key){const need=requirement(key),now=level(state)||1;return refusal('level-locked',`${labelFor(key)} يُفتح في المستوى ${need} · أنت في المستوى ${now}. افتحه مبكرًا بترخيص من صفحة المستويات، أو تابع التشغيل لرفع مستواك.`,{key,level:need,current:now});}
  function check(state,key){return unlocked(state,key)?{ok:true}:{ok:false,code:'level-locked',key,level:requirement(key),current:level(state)||1};}
  function require(state,key){if(!unlocked(state,key))throw lockedError(state,key);return true;}

  // Limits on held counts (facilities, fleets, regional headquarters). Infinity when none applies.
  function companyLevel(company){return own(COMPANY,company)?COMPANY[company]:1;}
  function bandLimit(state,company,kind){
    if(!active(state))return Infinity;const lvl=level(state);
    if(kind==='facility'&&company==='group'){for(const [at,count] of HQ_STEPS)if(lvl>=at)return count;return 1;}
    if(lvl>=(kind==='facility'?FACILITY_LIFT:FLEET_LIFT))return Infinity;
    const bands=BANDS[kind];if(!bands)return Infinity;const band=Math.floor((lvl-companyLevel(company))/2);if(band<0)return bands[0];return band>=bands.length?Infinity:bands[band];
  }
  function fleetKindFor(company){return company==='road'||company==='air'||company==='sea'||company==='mobility'?company:null;}
  function facilityOwner(row){return String(row?.ownerCompanyId||row?.companyId||row?.company||'');}
  function heldFacilities(state,company){let count=0;for(const list of [state?.globalBases,state?.customHubs])if(Array.isArray(list))for(const row of list)if(row&&row.owned!==false&&facilityOwner(row)===company&&row.id!=='HQ-GROUP')count++;return count;}
  function heldFleet(state,company){
    if(company==='mobility')return Array.isArray(state?.mobility?.vehicles)?state.mobility.vehicles.length:0;
    const data=globalThis.GH_FLEET_DATA;if(!data?.countByFields)return 0;const counts=data.countByFields(state,['ownerCompanyId'],row=>String(row.ownerCompanyId||''));return Number(counts.get(company))||0;
  }
  function capError(state,company,kind,limit,held,adding){
    const room=Math.max(0,limit-held),noun=kind==='facility'?(company==='group'?'مقرًا إقليميًا':'منشأة'):kind==='mobility'?'مركبة':kind==='air'?'طائرة':kind==='sea'?'سفينة':'شاحنة';
    const next=nextBandLevel(state,company,kind);
    return refusal('level-cap',`سقف ${COMPANY_LABEL[company]||'الشركة'} في مستواك ${limit.toLocaleString('en-US')} ${noun}، ولديها ${held.toLocaleString('en-US')}. المتاح الآن ${room.toLocaleString('en-US')} من ${adding.toLocaleString('en-US')} مطلوبة${next?`، ويتسع السقف في المستوى ${next}`:''}. لم يبدأ أي جزء.`,{company,kind,limit,held,adding,room});
  }
  function nextBandLevel(state,company,kind){const lvl=level(state)||1,current=bandLimit(state,company,kind);for(let at=lvl+1;at<=MAX_LEVEL;at++){if(limitAt(at,company,kind)>current)return at;}return null;}
  function limitAt(lvl,company,kind){
    if(kind==='facility'&&company==='group'){for(const [at,count] of HQ_STEPS)if(lvl>=at)return count;return 1;}
    if(lvl>=(kind==='facility'?FACILITY_LIFT:FLEET_LIFT))return Infinity;const bands=BANDS[kind];if(!bands)return Infinity;const band=Math.floor((lvl-companyLevel(company))/2);if(band<0)return bands[0];return band>=bands.length?Infinity:bands[band];
  }
  function requireRoom(state,company,kind,adding){
    if(!active(state))return true;adding=Math.max(0,Math.floor(Number(adding)||0));if(!adding)return true;const limit=bandLimit(state,company,kind);if(limit===Infinity)return true;
    const held=kind==='facility'?heldFacilities(state,company):heldFleet(state,company);if(held+adding>limit)throw capError(state,company,kind,limit,held,adding);return true;
  }

  // The player command gate (GH_DOMAIN_COMMANDS, player dispatches only; the day's own system work is never refused).
  function facilityCompany(payload){const row=plainObject(payload?.facility)?payload.facility:payload;return facilityOwner(row);}
  function checkCommand(state,domain,name,payload={}){
    if(!active(state))return true;domain=String(domain||'');name=String(name||'');payload=plainObject(payload)?payload:{};
    if(domain==='corporate'&&name==='open-company')return require(state,`company:${String(payload.type||payload.companyId||'')}`);
    if(domain==='asset-purchase'&&name==='authorize-order'){
      const order=plainObject(payload.order)?payload.order:{},company=String(payload.ownerCompanyId||order.ownerCompanyId||''),itemId=String(order.item?.id||order.itemId||'');
      require(state,`company:${company}`);require(state,`model:${itemId}`);const kind=fleetKindFor(company);if(kind)requireRoom(state,company,kind,Number(payload.count??order.count)||0);return true;
    }
    if(domain==='mobility'&&name==='buy-fleet'){require(state,'company:mobility');return requireRoom(state,'mobility','mobility',Number(payload.quantity)||0);}
    if(domain==='facilities'&&name==='create'){const company=facilityCompany(payload);if(company){require(state,`company:${company}`);requireRoom(state,company,'facility',1);}return true;}
    // Regional headquarters (GH_FACILITY_CORE 'open-regional-hq', kept in state.branches) take the group's steps.
    if(domain==='facilities'&&name==='open-regional-hq'){const held=Array.isArray(state?.branches)?state.branches.length:0,limit=bandLimit(state,'group','facility');if(held+1>limit)throw capError(state,'group','facility',limit,held,1);return true;}
    if(domain==='hospitality'&&name==='start-property'){require(state,'company:hospitality');return requireRoom(state,'hospitality','facility',1);}
    const key=`command:${domain}:${name}`;if(requirement(key)!==null)require(state,key);return true;
  }

  // Experience (approved table «مصادر الخبرة»): one-time milestones, the day's operation (20 for each company that closed
  // the day in profit and 10 × log10(1 + the group's net ÷ 100,000), up to 150 + 25 × level a day) and 3 for each player
  // decision (up to 60 a day). The difficulty multiplies every point (and Plus); the level never goes down.
  const MILESTONES=Object.freeze({'found-group':50,'first-company':100,company:150,'first-asset':50,'first-trip':50,'first-contract':75,'first-facility':75,'first-profit-day':100,'first-tax':100,'first-profit-month':250,'first-conference':300,'first-profit-year':500});
  const DECISION_XP=3,DECISION_CAP=60,COMPANY_DAY_XP=20,PROFIT_UNIT=100000;
  const MILESTONE_LABEL=Object.freeze({'found-group':'تأسيس المجموعة','first-company':'أول شركة تابعة',company:'شركة جديدة','first-asset':'أول أصل للشركة','first-trip':'أول رحلة مكتملة','first-contract':'أول عقد موقّع','first-facility':'أول منشأة','first-profit-day':'أول يوم رابح','first-tax':'أول سداد ضريبي','first-profit-month':'أول شهر رابح','first-conference':'أول مؤتمر سنوي','first-profit-year':'أول سنة رابحة'});
  function dayOf(state){return Math.max(0,Math.floor((Number(state?.simSeconds)||0)/86400));}
  // Owner (approved Plus): a Plus subscriber earns 50% more.
  function multiplier(state){const p=root(state);let factor=DIFFICULTY[p?.difficulty]?.xp||1;if(entitled(state,'plus'))factor*=1.5;return factor;}
  // Store entitlements (GH_STORE_CORE, state.purchases.entitlements); absent, none applies.
  function entitled(state,id){const store=globalThis.GH_STORE_CORE;if(store?.entitled)return store.entitled(state,id);const rows=state?.purchases?.entitlements;return plainObject(rows)&&!!rows[id];}
  function addXp(state,points,reason){
    if(!active(state))return null;const p=root(state);points=Math.max(0,Number(points)||0);if(!points)return null;
    const gained=Math.round(points*multiplier(state)),from=level(state);p.xp=Math.max(0,Math.round(Number(p.xp)||0))+gained;const to=Math.max(from,levelForXp(p.xp));p.level=to;
    if(to>from){p.lastLevelUp={from,to,day:dayOf(state)};grantsFor(state,from,to);if(Array.isArray(state.alerts)){state.alerts.unshift(`ترقية المجموعة إلى المستوى ${to} (${title(to)}). افتح صفحة المستويات لترى ما فُتح.`);if(state.alerts.length>40)state.alerts.length=40;}}
    return {gained,from,to,reason:String(reason||'')};
  }
  // Expansion grant (approved «منحة التوسع»): when a level opens a company, the founder invests a share of its minimum
  // capital in the group (easy 50%, normal 25%, hard none), once per company, as a documented founder investment
  // (GH_FINANCE_CORE 'founder-investment', reference GRANT-<COMPANY>).
  function grantsFor(state,from,to){
    const p=root(state),share=DIFFICULTY[p?.difficulty]?.grant||0,finance=globalThis.GH_FINANCE_CORE;if(!(share>0)||!finance?.execute)return [];const out=[];
    for(const [id,at] of Object.entries(COMPANY)){
      if(id==='group'||at<=from||at>to||(plainObject(p.grants)&&p.grants[id]))continue;
      const minimum=Number(globalThis.GH_COMPANY_PLATFORM?.getDefinition?.(id)?.founding?.minimumCapital)||0;if(!(minimum>0))continue;
      const amount=Math.round(minimum*share),ref=`GRANT-${id.toUpperCase()}`;finance.execute({state},'founder-investment',{company:'group',amount,ref,note:`منحة توسع · ${COMPANY_LABEL[id]} تُفتح في المستوى ${at}`});
      (plainObject(p.grants)?p.grants:(p.grants={}))[id]={level:at,amount,ref,day:dayOf(state)};out.push({company:id,amount});
    }
    return out;
  }
  // The first steps of a career (GH_UI_QUALITY tasks, «المهام الآن»): each one is also a milestone of experience.
  function startTasks(state){
    if(!active(state))return [];const opened=Array.isArray(state.openedCompanies)?state.openedCompanies:[],rows=[],task=(id,title,panel,reason,arg)=>({id,title,domain:'الشركات',priority:'high',panel,reason,...(arg!==undefined?{arg}:{})});
    if(!opened.includes('road'))return [task('START:COMPANY','افتح شركة اللوجستيات','companies','أول شركة ترفع المجموعة إلى المستوى 3 مباشرة وتفتح شركة الطيران.')];
    if(!heldFacilities(state,'road'))rows.push(task('START:FACILITY','افتح أول مركز لوجستي','network','الشاحنات تحتاج مركزًا تسلَّم إليه وتنطلق منه.'));
    else if(!heldFleet(state,'road'))rows.push(task('START:FLEET','اشترِ شاحناتك الأولى','assetMarket','الشاحنة المستعملة تسترد سعرها في نحو شهرين من التشغيل.','road'));
    else if(!(Array.isArray(state.customRoutes)&&state.customRoutes.some(route=>String(route?.mode||route?.type||'')==='road'||String(route?.ownerCompanyId||'')==='road')))rows.push(task('START:ROUTE','أنشئ أول مسار بري','routes','الإيراد يبدأ حين تتحرك الشاحنات بين مدينتين.','road'));
    const p=root(state);if(p.lastLevelUp&&p.lastLevelUp.day===dayOf(state))rows.push(task('LEVEL:UP',`المستوى ${p.lastLevelUp.to}: اطّلع على ما فُتح`,'progression','شركات وطرازات وأدوات جديدة في متناولك.'));
    return rows;
  }
  function milestone(state,key,kind){if(!active(state))return null;const p=root(state);if(own(p.milestones,key))return null;p.milestones[key]=dayOf(state);return addXp(state,MILESTONES[kind||key]||0,key);}
  function daily(state,day){const p=root(state);if(!plainObject(p.daily)||p.daily.day!==day)p.daily={day,actionXp:0,earnedXp:0};return p.daily;}
  // A committed player command (GH_DOMAIN_COMMANDS, in its transaction).
  function onCommand(state,domain,name,payload={},result=null){
    if(!active(state))return null;domain=String(domain||'');name=String(name||'');payload=plainObject(payload)?payload:{};const key=`${domain}:${name}`;
    // The store never sells levels: a delivery earns no decision points.
    if(domain===DOMAIN||domain==='store')return null;
    if(key==='corporate:open-company'){milestone(state,'first-company');milestone(state,`company:${String(payload.type||payload.companyId||'')}`,'company');}
    else if(key==='asset-purchase:authorize-order')milestone(state,`first-asset:${String(payload.ownerCompanyId||payload.order?.ownerCompanyId||'')}`,'first-asset');
    else if(key==='facilities:create'||key==='hospitality:start-property')milestone(state,'first-facility');
    else if(key==='contracts:sign')milestone(state,'first-contract');
    else if(key==='finance:pay-taxes')milestone(state,'first-tax');
    else if(key==='conference:complete')milestone(state,'first-conference');
    const today=daily(state,dayOf(state)),room=Math.max(0,DECISION_CAP-today.actionXp),points=Math.min(DECISION_XP,room);if(points>0){today.actionXp+=points;return addXp(state,points,'decision');}
    return null;
  }
  // The day's close (app.js, in the day's transaction): its company rows and the group's net.
  function closeDay(state,{day,companies={},net=0}={}){
    // Kept apart from the decisions' day (p.daily, by the clock): the close of a day runs after the clock has passed it.
    if(!active(state))return null;const p=root(state);day=Math.max(0,Math.floor(Number(day)||0));
    if(Number.isInteger(p.lastClosedDay)&&p.lastClosedDay>=day)return null;p.lastClosedDay=day;
    let profitable=0,trips=0;for(const row of Object.values(plainObject(companies)?companies:{})){if((Number(row?.net)||0)>0)profitable++;trips+=Math.max(0,Number(row?.tripCount)||0);}
    net=Number(net)||0;const profitPoints=net>0?10*Math.log10(1+net/PROFIT_UNIT):0,cap=150+25*level(state),earned=Math.min(cap,profitable*COMPANY_DAY_XP+profitPoints);
    if(trips>0)milestone(state,'first-trip');if(net>0)milestone(state,'first-profit-day');
    // Calendar months and years of the group's net (GH_FINANCE_CORE.calendarMonthForDay): the first that closes in profit.
    const month=String(globalThis.GH_FINANCE_CORE?.calendarMonthForDay?.(day)||''),period=plainObject(p.period)?p.period:(p.period={month,monthNet:0,year:month.slice(0,4),yearNet:0});
    if(month&&period.month!==month){if(period.monthNet>0)milestone(state,'first-profit-month');if(period.year!==month.slice(0,4)){if(period.yearNet>0)milestone(state,'first-profit-year');period.year=month.slice(0,4);period.yearNet=0;}period.month=month;period.monthNet=0;}
    period.monthNet+=net;period.yearNet+=net;
    p.lastDayXp=Math.round(earned*multiplier(state));return addXp(state,earned,'day');
  }

  // Early licence (approved «الترخيص المبكر»): a locked key up to the difficulty's reach ahead (easy 3 levels, normal 2,
  // hard 1), for a fee per level ahead: a company 20% of its minimum capital, a model 10% of its new price (at least
  // $250,000), a tool $5M × (its level ÷ 5); × the difficulty's fee factor, halved for a Plus subscriber. Paid from the
  // group's current account as a documented expense in the same command that records the licence; it earns no experience
  // and raises no band.
  const LICENCE_MODEL_SHARE=.1,LICENCE_MODEL_MIN=250000,LICENCE_COMPANY_SHARE=.2,LICENCE_TOOL_BASE=5000000;
  function licenceBase(key){
    const at=key.indexOf(':'),kind=key.slice(0,at),id=key.slice(at+1);
    if(kind==='company'){const definition=globalThis.GH_COMPANY_PLATFORM?.getDefinition?.(id);const minimum=Number(definition?.founding?.minimumCapital)||0;return minimum>0?minimum*LICENCE_COMPANY_SHARE:null;}
    if(kind==='model'){const base=modelKey(id),item=catalogItem(base);const price=Number(item?.price)||0;return price>0?Math.max(LICENCE_MODEL_MIN,price*LICENCE_MODEL_SHARE):null;}
    if(kind==='command'||kind==='tool'){const need=requirement(key);return need?LICENCE_TOOL_BASE*need/5:null;}
    return null;
  }
  function licenceKey(key){key=String(key||'');const at=key.indexOf(':');if(at<0)return key;return key.slice(0,at)==='model'?`model:${modelKey(key.slice(at+1))}`:key;}
  function licenceQuote(state,key){
    key=licenceKey(key);if(!active(state))return {ok:false,reason:'progression-not-active'};
    const need=requirement(key);if(need===null)return {ok:false,reason:'licence-unknown-key'};const now=level(state),ahead=need-now;
    if(ahead<=0||licensed(state,key))return {ok:false,reason:'licence-not-needed'};
    // Owner (approved Plus): a Plus subscriber reaches one level further, at half the fee.
    const p=root(state),rule=DIFFICULTY[p.difficulty],reach=rule.early+(entitled(state,'plus')?1:0);if(ahead>reach)return {ok:false,reason:'licence-too-far',reach,need,current:now};
    const base=licenceBase(key);if(!(base>0))return {ok:false,reason:'licence-unknown-key'};
    const fee=Math.round(base*ahead*rule.fee*(entitled(state,'plus')?.5:1));return {ok:true,key,need,current:now,ahead,fee,label:labelFor(key)};
  }
  const LICENCE_REASON=Object.freeze({'progression-not-active':'الترخيص المبكر للمسار المهني فقط؛ كل شيء مفتوح الآن.','licence-unknown-key':'هذا البند لا يحتاج ترخيصًا.','licence-not-needed':'هذا البند مفتوح لك بالفعل.','licence-too-far':'هذا البند أبعد من مدى الترخيص المبكر في صعوبتك.','licence-fee-changed':'تغيّرت رسوم الترخيص؛ راجعها واعتمد من جديد.'});
  const DOMAIN='progression',LICENCE_COMMAND='early-licence';let installed=false;
  const owner=Object.freeze({
    VERSION,
    validate(ctx,name,payload={}){
      if(String(name)!==LICENCE_COMMAND)return {ok:false,reason:'progression-command'};const state=ctx?.state||ctx,quote=licenceQuote(state,payload.key);
      if(!quote.ok)return {ok:false,reason:LICENCE_REASON[quote.reason]||quote.reason};if(Math.abs(Number(payload.fee)-quote.fee)>.005)return {ok:false,reason:LICENCE_REASON['licence-fee-changed']};return true;
    },
    execute(ctx,name,payload={},meta={}){
      if(String(name)!==LICENCE_COMMAND)throw new Error('progression-command');const state=ctx?.state||ctx,quote=licenceQuote(state,payload.key);
      if(!quote.ok)throw new Error(LICENCE_REASON[quote.reason]||quote.reason);if(Math.abs(Number(payload.fee)-quote.fee)>.005)throw new Error(LICENCE_REASON['licence-fee-changed']);
      const finance=globalThis.GH_FINANCE_CORE;if(!finance?.execute)throw new Error('licence-finance-owner-unavailable');
      const document=finance.execute({state},'spend',{company:'group',amount:quote.fee,line:'opex',note:`رسوم ترخيص مبكر · ${quote.label} (المستوى ${quote.need})`,taxable:false,counterparty:'هيئة الترخيص التجاري'});
      root(state).licences[quote.key]={day:dayOf(state),level:quote.current,need:quote.need,fee:quote.fee,document:String(document?.number||'')};
      return {key:quote.key,fee:quote.fee,need:quote.need,document:String(document?.number||''),commandId:String(meta?.id||'')};
    },
    validateResult(name,result,payload){return String(name)===LICENCE_COMMAND&&!!result&&result.key===licenceKey(payload?.key)&&Number(result.fee)>0;}
  });
  function install({domainCommands=globalThis.GH_DOMAIN_COMMANDS,authorizationOwner=globalThis.GH_AUTHORIZATION}={}){
    if(installed)return owner;if(!domainCommands?.register||!authorizationOwner?.registerCommandTargetResolver)return null;
    authorizationOwner.registerCommandTargetResolver(DOMAIN,()=>['group']);domainCommands.register(DOMAIN,owner);installed=true;return owner;
  }

  // The founding root. A founding mode outside the career modes is free play.
  function initial(mode){const difficulty=own(CAREER_MODES,String(mode))?CAREER_MODES[mode]:null;
    return difficulty?{schema:SCHEMA,version:VERSION,mode:'career',difficulty,xp:Math.round(MILESTONES['found-group']*DIFFICULTY[difficulty].xp),level:1,milestones:{'found-group':0},daily:{day:-1,actionXp:0,earnedXp:0},licences:{}}:{schema:SCHEMA,version:VERSION,mode:'free'};}
  function isCareerMode(mode){return own(CAREER_MODES,String(mode));}

  // Save validation (GH_SAVE_SCHEMA): an absent root is a save from before this build (open, valid).
  function validate(state){
    const p=state?.progression;if(p===undefined)return [];const errors=[];
    if(!plainObject(p)||p.schema!==SCHEMA)return ['progression-shape'];
    if(p.mode!=='career'&&p.mode!=='free')errors.push('progression-mode');
    if(p.mode==='career'){
      if(!own(DIFFICULTY,String(p.difficulty)))errors.push('progression-difficulty');
      if(!Number.isFinite(Number(p.xp))||Number(p.xp)<0)errors.push('progression-xp');
      if(!Number.isInteger(p.level)||p.level<1||p.level>MAX_LEVEL||p.level<levelForXp(p.xp))errors.push('progression-level');
      if(!plainObject(p.milestones)||!plainObject(p.licences)||!plainObject(p.daily))errors.push('progression-records');
      if(p.grants!==undefined&&(!plainObject(p.grants)||Object.entries(p.grants).some(([company,row])=>!own(COMPANY,company)||!plainObject(row))))errors.push('progression-grants');
      if(plainObject(p.licences))for(const key of Object.keys(p.licences))if(requirement(key)===null)errors.push('progression-licence');
    }
    return errors;
  }

  function summary(state){
    const p=root(state);if(!p)return {mode:'open',active:false};if(p.mode!=='career')return {mode:'free',active:false};
    const lvl=level(state),xp=Math.max(0,Number(p.xp)||0),floor=XP[lvl-1],next=lvl<MAX_LEVEL?XP[lvl]:null;
    return {mode:'career',active:active(state),investor:investorMode(state),difficulty:p.difficulty,difficultyLabel:DIFFICULTY[p.difficulty]?.label||'',level:lvl,title:title(lvl),xp,levelFloor:floor,nextLevelXp:next,progress:next===null?1:Math.max(0,Math.min(1,(xp-floor)/(next-floor)))};
  }
  // What a level opens, for the levels page and the level-up notice.
  function opensAt(lvl){
    const out={companies:[],models:[],commands:[],tools:[]};
    for(const [id,at] of Object.entries(COMPANY))if(at===lvl&&id!=='group')out.companies.push(id);
    for(const [id,at] of Object.entries(MODEL))if(at===lvl)out.models.push(id);
    for(const [id,at] of Object.entries(FEATURE))if(at===lvl)out.commands.push(id);
    for(const [id,at] of Object.entries(TOOL))if(at===lvl)out.tools.push(id);
    return out;
  }

  return Object.freeze({VERSION,SCHEMA,MAX_LEVEL,XP,DIFFICULTY,CAREER_MODES,COMPANY,MODEL,USED_BASE,FEATURE,TOOL,BANDS,HQ_STEPS,FLEET_LIFT,FACILITY_LIFT,COMPANY_LABEL,
    active,level,levelForXp,title,requirement,unlocked,check,require,checkCommand,bandLimit,limitAt,requireRoom,heldFacilities,heldFleet,nextBandLevel,
    initial,isCareerMode,validate,summary,opensAt,labelFor,modelKey,MILESTONES,MILESTONE_LABEL,COMMAND_LABEL,TOOL_LABEL,grantsFor,startTasks,licenceQuote,licenceKey,LICENCE_REASON,DOMAIN,LICENCE_COMMAND,owner,install,isInstalled:()=>installed,addXp,milestone,onCommand,closeDay,entitled,multiplier});
});
