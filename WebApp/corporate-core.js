(()=>{
  'use strict';

  const VERSION='3.0.0-build334';
  const num=value=>Math.max(0,Number(value)||0),now=state=>Number(state.simSeconds)||0;
  const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
  const platform=()=>{const api=globalThis.GH_COMPANY_PLATFORM;if(!api?.requireCompany)throw new Error('company-platform-missing');return api;};
  const identity=()=>globalThis.GH_IDENTITY||null;
  // Built at first read (nothing in the app reads it), not at load; the platform is still required at load.
  platform();let companyTypesCache=null;const companyTypes=()=>companyTypesCache||(companyTypesCache=Object.freeze(platform().companyIds({includeGroup:false})));

  function checkedText(value,code,maximum,{minimum=1,allowEmpty=false}={}){
    const raw=typeof value==='string'?value:String(value??''),inspected=identity()?.inspectPlainText?.(raw,{minimum,maximum,allowEmpty});
    if(inspected){if(!inspected.ok)throw new Error(code);return inspected.text;}
    const text=raw.trim();if((!text&&!allowEmpty)||text.length<minimum||text.length>maximum||/[<>\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(text))throw new Error(code);return text;
  }
  function checkedLogo(value){
    if(value==null||value==='')return null;const inspector=identity()?.inspectCustomLogo;if(typeof inspector!=='function')throw new Error('identity-logo-validator-missing');const result=inspector(value);if(!result.ok)throw new Error(`invalid-company-logo:${result.reason}`);return String(value);
  }
  function checkedIdentifier(value,code='invalid-company-identifier'){
    const text=checkedText(value??'',code,180,{minimum:0,allowEmpty:true});if(/"/.test(text))throw new Error(code);return text;
  }
  function validateFoundingIdentity(payload={}){
    const profile=object(payload.profile)?payload.profile:{},registry=object(payload.registry)?payload.registry:{};checkedText(profile.name,'founding-identity-invalid',120);if(profile.shortName!=null&&profile.shortName!=='')checkedText(profile.shortName,'founding-short-name-invalid',28);if(registry.legalName!=null&&registry.legalName!=='')checkedText(registry.legalName,'founding-identity-invalid',120);if(registry.shortName!=null&&registry.shortName!=='')checkedText(registry.shortName,'founding-short-name-invalid',28);if(profile.logo!=null)checkedLogo(profile.logo);if(registry.logo!=null)checkedLogo(registry.logo);return true;
  }

  function ensure(state){
    state.companyRegistry=object(state.companyRegistry)?state.companyRegistry:{};
    state.openedCompanies=Array.isArray(state.openedCompanies)?state.openedCompanies:[];
    state.unlockedSectors=Array.isArray(state.unlockedSectors)?state.unlockedSectors:[];
    state.stakes=object(state.stakes)?state.stakes:{};state.maDeals=object(state.maDeals)?state.maDeals:{};
    state.advanced=object(state.advanced)?state.advanced:{};
    state.advanced.companies=object(state.advanced.companies)?state.advanced.companies:{};
    state.advanced.groupManagement=object(state.advanced.groupManagement)?state.advanced.groupManagement:{};
    const group=state.advanced.groupManagement;delete group.plan;
    if(object(state.ipo)&&state.ipo.listed===true&&(!Array.isArray(state.ipo.capTable)||!state.ipo.capTable.length)){
      const issuedPct=Math.max(0,Math.min(100,Number(state.ipo.issuedPct)||18)),totalShares=Math.max(1,Math.floor(Number(state.ipo.sharesIssued||0)/(issuedPct/100)||100000000)),publicShares=Math.min(totalShares,Math.max(0,Math.floor(totalShares*issuedPct/100)));
      state.ipo.totalShares=totalShares;state.ipo.capTable=[{holderId:'founders',label:'المؤسسون والمساهمون الحاليون',shares:totalShares-publicShares},{holderId:'public-float',label:'المساهمون العموم',shares:publicShares}];
    }
    group.history=Array.isArray(group.history)?group.history:[];return state;
  }
  // Group valuation (owner, shares review): a fair value from the year's profit and the net assets, worked out once a
  // day at the close from figures the close already has (the daily closes, the realism statements, the market rows),
  // with no pass over the fleet or the records. Earnings value = the last 365 days' net profit (annualised once 30 days
  // of closes exist) × a multiple from the credit rating (8 to 16); net assets = the statements' equity + listed shares
  // and stakes at market + the facilities' value (less 4% a year); fair value = 60% earnings value + 40% net assets,
  // never under 80% of the net assets.
  const VALUE_MULTIPLES=Object.freeze({A:16,'A-':14,'BBB+':13,BBB:12,'BBB-':11,'BB+':9,BB:8}),FACILITY_DEPRECIATION=.04;
  function valuation(state){ensure(state);const current=state.advanced.valuation;if(object(current))return current;return state.advanced.valuation={day:null,fair:0,earnings:0,nav:0,equity:0,holdings:0,facilityBook:0,profit12:0,profitDays:0,multiple:12,grade:'BBB'};}
  function trailingProfit(state,day){let sum=0,recent=0,first=day,seen=0,today=null;for(const row of state.finance?.dailyCompanyReports||[]){const rowDay=Number(row?.day);if(!Number.isFinite(rowDay)||rowDay>day||rowDay<=day-365)continue;const net=Number(row.net)||0;sum+=net;if(rowDay>day-90)recent+=net;if(rowDay<first)first=rowDay;seen++;if(rowDay===day)today=row;}const days=seen?day-first+1:0;return {profit:days>=30?sum*365/Math.min(365,days):0,recent:days>=30?recent*365/Math.min(90,days):0,days,today};}
  function holdingsAtMarket(state){
    let sum=0;const market=Array.isArray(state.market)?state.market:[],rivals=Array.isArray(state.simulationWorld?.competitors)?state.simulationWorld.competitors:[];
    for(const [sym,qty] of Object.entries(object(state.portfolio)?state.portfolio:{}))sum+=num(qty)*num(market.find(row=>row?.sym===sym)?.price);
    for(const row of Array.isArray(state.maPortfolio)?state.maPortfolio:[])sum+=num(row?.stake)/100*num(rivals.find(rival=>rival?.id===row?.id)?.price);return sum;
  }
  function closeValuation(state,payload={}){
    const v=valuation(state),day=Math.max(0,Math.floor(Number(payload.day)||0));if(v.day===day)return {...v};
    const before={day:v.day,fresh:num(v.fresh),earnings:Number(v.earnings)||0,nav:Number(v.nav)||0,profit12:Number(v.profit12)||0,multiple:Number(v.multiple)||12,grade:v.grade};
    v.facilityBook=num(v.facilityBook)*Math.pow(1-FACILITY_DEPRECIATION,(v.day==null?0:Math.max(0,day-v.day))/365);
    const trailing=trailingProfit(state,day),grade=String(state.profile?.creditRating||'BBB'),multiple=VALUE_MULTIPLES[grade]||12,equity=Number(state.realism?.financial?.consolidated?.equity)||0,holdings=holdingsAtMarket(state),nav=equity+holdings+num(v.facilityBook),earnings=trailing.profit*multiple;
    const fresh=freshCapital(v,day,nav);Object.assign(v,{day,fair:fairOf(earnings,nav,fresh),fresh,earnings,nav,equity,holdings,profit12:trailing.profit,profit90:trailing.recent,profitDays:trailing.days,multiple,grade});
    if(state.ipo?.listed===true)closeShare(state,v,before,day,trailing.today);return {...v};
  }
  // The group's share once listed (owner, IPO restructuring batch 3, and the annual meeting moving the shares): at each
  // close its price is the fair value per share × the market's mood. The mood keeps 90% of its distance from 100% a
  // day, moves up to ±1.5% a day (from the save's seed and the day: nothing stored, no stream advanced), stays between
  // 85% and 115%, and once a year takes the annual meeting's reception (up to ±3%). The page reads a year of closing
  // prices and the last 20 moves of 1% or more with their cause, split from the day's change in the same order the
  // value is built (the rating's multiple, the year's profit, the net assets, the meeting). Constant work a day.
  const MOOD_MIN=.85,MOOD_MAX=1.15,MOOD_KEEP=.9,MOOD_DAILY=.015,MOOD_AGM=.03,PRICE_DAYS=365,PRICE_EVENTS=20,EVENT_MOVE=.01;
  function moodNoise(state,day){let h=((Number(state.determinism?.seed)>>>0)^Math.imul(day+1,0x9e3779b1))>>>0;h^=h>>>16;h=Math.imul(h,0x85ebca6b)>>>0;h^=h>>>13;h=Math.imul(h,0xc2b2ae35)>>>0;h^=h>>>16;return ((h>>>0)/4294967296*2-1)*MOOD_DAILY;}
  function shareEvent(v,row){v.events=Array.isArray(v.events)?v.events:[];v.events.unshift(row);if(v.events.length>PRICE_EVENTS)v.events.length=PRICE_EVENTS;}
  function sharePrice(v,day,price){v.price=price;v.priceDay=day;v.history=Array.isArray(v.history)?v.history:[];v.history.push([day,price]);if(v.history.length>PRICE_DAYS)v.history.splice(0,v.history.length-PRICE_DAYS);}
  function closeShare(state,v,before,day,today){
    const ipo=state.ipo,total=Math.floor(Number(ipo.totalShares)||0);if(total<1)return;
    const mood0=Number.isFinite(v.sentiment)?v.sentiment:1,agm=state.profile?.agm,bound=m=>Math.max(MOOD_MIN,Math.min(MOOD_MAX,m)),drift=1+MOOD_KEEP*(mood0-1)+moodNoise(state,day);let agmMove=0;
    if(object(agm)&&agm.positive!=null&&Number(agm.day)>=Number(ipo.listedDay||0)&&Number(agm.day)<=day&&Number(agm.year)!==Number(v.agmApplied)){agmMove=MOOD_AGM*unit((num(agm.positive)-num(agm.negative)-60)/40);v.agmApplied=Number(agm.year);}
    const mood=bound(drift+agmMove),agmEffect=mood-bound(drift),per=value=>Math.max(.01,value/total),price=cents(per(v.fair)*mood),prev=num(v.price);
    v.prevPrice=prev||price;v.sentiment=mood;sharePrice(v,day,price);if(!prev||before.day==null)return;
    // The day's change split in the order the value is built: each step's move as a share of yesterday's price.
    const at=(earnings,nav,m,fresh)=>per(fairOf(earnings,nav,fresh))*m,p0=at(before.earnings,before.nav,mood0,before.fresh),base=at(before.earnings,before.nav,mood0,v.fresh),pM=at(before.profit12*v.multiple,before.nav,mood0,v.fresh),pE=at(v.earnings,before.nav,mood0,v.fresh),pN=at(v.earnings,v.nav,mood0,v.fresh),moves=[];
    if(v.multiple!==before.multiple)moves.push({kind:'rating',pct:(pM-base)/p0,grade:v.grade,from:before.grade,multiple:v.multiple,prevMultiple:before.multiple});
    const net=Number(today?.net)||0;let company=null,companyNet=0;if(object(today?.companies))for(const [id,row] of Object.entries(today.companies)){const value=Number(row?.net)||0;if(Math.sign(value)===Math.sign(net)&&Math.abs(value)>Math.abs(companyNet)){company=id;companyNet=value;}}
    moves.push({kind:'profit',pct:(pE-pM)/p0,profit12:v.profit12,net,company,companyNet});
    moves.push({kind:'assets',pct:(pN-pE)/p0,amount:v.nav-before.nav});
    if(agmMove)moves.push({kind:'agm',pct:agmEffect*per(v.fair)/p0,year:Number(agm.year),positive:num(agm.positive),negative:num(agm.negative)});
    for(const move of moves)if(Math.abs(move.pct)>=EVENT_MOVE)shareEvent(v,{day,...move,pct:Math.round(move.pct*10000)/10000});
  }
  // Dividends (owner, IPO restructuring batch 4): the player sets a share of each quarter's profit (0, 25, 40 or 60%).
  // At the close of every 90th day after the listing, the profit of the days since the last quarter (none before the
  // listing) times that share is the dividend, the same for every share. The public's part leaves the holding by one
  // signed transfer to the offering's shareholders (GH_FINANCE_CORE pay-dividend: a distribution of profit, not an
  // expense); the founder's part stays in the holding until the founder's section exists (owner's decision). A loss or
  // too little cash in the holding pays nothing, and the record says why. Nothing is read on the other days.
  const DIVIDEND_PAYOUTS=Object.freeze([0,25,40,60]),DIVIDEND_QUARTER=90,DIVIDEND_RECORDS=12;
  function dividends(state){ensure(state);const current=state.advanced.dividends;if(object(current))return current;return state.advanced.dividends={payout:0,records:[]};}
  function capShares(ipo,id){return Math.floor(Number((Array.isArray(ipo?.capTable)?ipo.capTable:[]).find(row=>row?.holderId===id)?.shares)||0);}
  function profitBetween(state,from,to){let sum=0;for(const row of state.finance?.dailyCompanyReports||[]){const day=Number(row?.day);if(Number.isFinite(day)&&day>from&&day<=to)sum+=Number(row.net)||0;}return sum;}
  function closeDividend(state,payload={}){
    const ipo=state.ipo,day=Math.max(0,Math.floor(Number(payload.day)||0)),listedDay=Math.floor(Number(ipo?.listedDay)||0);if(ipo?.listed!==true||day%DIVIDEND_QUARTER!==0||day<=listedDay)return null;
    const current=object(state.advanced?.dividends)?state.advanced.dividends:null,payout=DIVIDEND_PAYOUTS.includes(Number(current?.payout))?Number(current.payout):0;if(!payout||current.records?.some?.(row=>row?.day===day))return null;
    const total=Math.floor(Number(ipo.totalShares)||0);if(total<1)return null;
    const d=dividends(state),profit=profitBetween(state,Math.max(day-DIVIDEND_QUARTER,listedDay),day),publicShares=capShares(ipo,'public-float'),record={day,payout,profit:cents(profit),amount:0,perShare:0,publicAmount:0,founderAmount:0,paid:false};
    if(profit<=0)record.reason='loss';
    else{const amount=cents(profit*payout/100),perShare=Math.round(amount/total*1e6)/1e6,publicAmount=cents(amount*publicShares/total),finance=globalThis.GH_FINANCE_CORE;Object.assign(record,{amount,perShare,publicAmount,founderAmount:cents(amount-publicAmount)});
     if(!finance?.execute||typeof finance.operating!=='function')throw new Error('finance-core-missing');
     if(publicAmount>finance.operating(state,'group')+.005&&finance.investorMode?.(state)!==true)record.reason='cash';
     // Through the command owner as the financial close (as the conference records its meeting): the transfer is sealed as a
     // system document, and inside the day's close it joins that transaction, so a failure rolls the whole day back.
     else if(publicAmount>0){const commands=globalThis.GH_DOMAIN_COMMANDS;if(typeof commands?.dispatchSystem!=='function')throw new Error('domain-commands-missing');const paid=commands.dispatchSystem({state},'finance','pay-dividend',{company:'group',amount:publicAmount,ref:`DIV-${String(ipo.ticker||'GH')}-${day}`,perShare,shares:publicShares,note:`توزيع ${payout}% من ربح الربع`},{actor:'financial-close'})?.result;if(!paid?.ref)throw new Error('dividend-payment-missing');record.ref=paid.ref;record.paid=true;}}
    d.records.unshift(record);if(d.records.length>DIVIDEND_RECORDS)d.records.length=DIVIDEND_RECORDS;return {...record};
  }
  // What the page and the dialog show for a share of the profit (read-only): the next quarter's day, its dividend so far
  // plus the last 90 days' pace for the days left, its split, and the year's dividends per share against the price.
  function dividendPlan(state,payoutPct){
    const ipo=state.ipo||{},d=object(state.advanced?.dividends)?state.advanced.dividends:{payout:0,records:[]},v=object(state.advanced?.valuation)?state.advanced.valuation:{},day=Math.floor(now(state)/86400),listedDay=Math.floor(Number(ipo.listedDay)||0);
    const policy=DIVIDEND_PAYOUTS.includes(Number(d.payout))?Number(d.payout):0,payout=DIVIDEND_PAYOUTS.includes(Number(payoutPct))?Number(payoutPct):policy,total=Math.max(1,Math.floor(Number(ipo.totalShares)||0)),publicShares=capShares(ipo,'public-float');
    const next=(Math.floor(day/DIVIDEND_QUARTER)+1)*DIVIDEND_QUARTER,from=Math.max(next-DIVIDEND_QUARTER,listedDay),soFar=profitBetween(state,from,day),pace=(Number(v.profit90)||0)/365,quarter=Math.max(0,soFar+pace*Math.max(0,next-Math.max(day,from)));
    const amount=cents(quarter*payout/100),publicAmount=cents(amount*publicShares/total),records=(Array.isArray(d.records)?d.records:[]).map(row=>({...row})),price=Number(v.price)||0,year=records.filter(row=>day-Number(row.day)<365).reduce((sum,row)=>sum+(Number(row.perShare)||0),0);
    return {policy,payout,payouts:DIVIDEND_PAYOUTS,nextDay:next,daysLeft:next-day,estimate:amount,perShare:amount/total,publicShares,publicPct:100*publicShares/total,publicAmount,founderAmount:cents(amount-publicAmount),yieldPct:price>0?year/price*100:0,records};
  }
  // The offering (owner, IPO restructuring): the founder's shares are set so a share is worth about $25 at the fair
  // value; the public takes 10% to 30% in new shares, offered 10% under the fair value per share and ±10% with demand
  // (reputation, rating, the year's growth, the last conference's reception); 3% underwriting and $3M of listing and
  // legal fees come off the proceeds; the founder may not sell for 180 days. The fair value per share is the one after
  // the offering: the value before plus the net proceeds at their full value (fresh capital, below), so the founder
  // gives up only the offer's discount and the fees. The price depends on that value and the proceeds on the price, a
  // linear relation solved exactly. Read-only: the page and the command work out the same terms from the last daily
  // valuation.
  const IPO_FLOATS=Object.freeze([10,15,20,25,30]),IPO_GRADES=Object.freeze(['A','A-','BBB+','BBB','BBB-']),IPO_RATING_SCORE=Object.freeze({A:1,'A-':.75,'BBB+':.5,BBB:.25,'BBB-':0}),IPO_LOCKUP_DAYS=180,cents=value=>Math.round(value*100)/100,unit=value=>Math.max(-1,Math.min(1,value));
  function valueAfter(earnings,nav,cash){return Math.max(0,.6*earnings+.4*(nav+cash),.8*(nav+cash));}
  // Fresh capital (owner's delegated decision): the offering's net proceeds count at their full value on the listing
  // day, not at the 40% the blend gives net assets, and fade into the blend over a year as the market comes to judge them
  // by what they earn; never more than the net assets. Two numbers on the valuation, constant work a day.
  const FRESH_CAPITAL_DAYS=365;
  function freshCapital(v,day,nav){const raised=num(v?.raised);if(!raised)return 0;return Math.min(Math.max(0,nav),raised*Math.max(0,1-Math.max(0,day-Math.floor(Number(v.raisedDay)||0))/FRESH_CAPITAL_DAYS));}
  function fairOf(earnings,nav,fresh){return valueAfter(earnings,nav-fresh,0)+fresh;}
  function conferenceReception(state,day){const agm=state.profile?.agm;if(!object(agm)||agm.positive==null||day-Number(agm.day)>365)return 0;return unit((num(agm.positive)-num(agm.negative)-60)/40);}
  function ipoTerms(state,floatPct=20){
    const v=object(state.advanced?.valuation)?state.advanced.valuation:{},valued=v.day!=null,float=IPO_FLOATS.includes(Number(floatPct))?Number(floatPct):20,day=Math.floor(now(state)/86400),grade=String(state.profile?.creditRating||'BBB'),fair=num(v.fair),profit12=Number(v.profit12)||0,profitDays=num(v.profitDays);
    const conditions=[{id:'value',ok:fair>=1e9,missing:Math.max(0,1e9-fair)},{id:'profit',ok:profitDays>=30&&profit12>0,profit12,profitDays},{id:'age',ok:day>=IPO_LOCKUP_DAYS,missing:Math.max(0,IPO_LOCKUP_DAYS-day)},{id:'rating',ok:IPO_GRADES.includes(grade),grade}];
    const founderShares=Math.max(1e7,Math.round(fair/25/1e7)*1e7),totalShares=Math.round(founderShares/(1-float/100)),offered=totalShares-founderShares;
    const growth=profit12>0?unit(((Number(v.profit90)||0)/profit12-1)/.5):0,reputation=unit(((Number.isFinite(state.profile?.reputation)?state.profile.reputation:50)-50)/50),reception=conferenceReception(state,day),demand=Math.max(0,Math.min(1,.5+.2*reputation+.2*((IPO_RATING_SCORE[grade]??0)-.5)+.2*growth+.1*reception));
    const multiplier=.9+.2*demand,earnings=Number(v.earnings)||0,nav=Number(v.nav)||0,fairShare=Math.max(0,(valueAfter(earnings,nav,0)-3e6)/(totalShares-offered*.9*multiplier*.97));
    const low=fairShare*.81,high=fairShare*.99,price=cents(fairShare*.9*multiplier),proceeds=cents(price*offered),fees=cents(proceeds*.03+3e6);
    return {valued,ready:valued&&conditions.every(row=>row.ok),day,float,grade,multiple:v.multiple,fair,earnings:Number(v.earnings)||0,nav:Number(v.nav)||0,equity:Number(v.equity)||0,holdings:num(v.holdings),facilityBook:num(v.facilityBook),profit12,profitDays,conditions,founderShares,totalShares,offered,issuedPct:100*offered/totalShares,valueShare:fair/founderShares,fairShare,low,high,demand,reputation,growth,reception,price,proceeds,fees,net:cents(proceeds-fees),lockupDays:IPO_LOCKUP_DAYS};
  }
  function model(state,companyId){
    ensure(state);const current=state.advanced.companies[companyId]||(state.advanced.companies[companyId]={});
    for(const legacy of ['budget','growthTarget','capitalPlan','customerScore','management','riskLimit'])delete current[legacy];
    current.serviceLevel=Math.max(0,Math.min(100,Number(current.serviceLevel)||0));current.automation=Math.max(0,Math.min(100,Number(current.automation)||0));current.lastDecision=num(current.lastDecision);
    current.upgradeCooldowns=object(current.upgradeCooldowns)?current.upgradeCooldowns:{};current.history=Array.isArray(current.history)?current.history:[];
    return current;
  }
  function companyIdOf(payload={}){return String(payload.companyId||payload.type||'').trim();}
  function financeSupports(finance,state,companyId,definition=null){
    if(typeof finance?.supportsCompany==='function'){
      if(finance.supportsCompany(state,companyId)===true)return true;
      // During admission a new instance is intentionally not registered yet.
      // A generic dynamic finance adapter may admit its definition here; the
      // provisional record is created only inside the enclosing transaction.
      return Boolean(definition?.capabilities?.includes('finance.book'));
    }
    return Array.isArray(finance?.TYPES)&&finance.TYPES.includes(companyId);
  }
  function planOpenCompany(state,payload={}){
    const companyId=companyIdOf(payload),plan=platform().planInstance(state,{companyId,definitionId:payload.definitionId}),definition=plan.definition,capital=num(payload.capital??definition.founding.defaultCapital);
    if(definition.kind!=='subsidiary'||definition.lifecycle!=='active')throw new Error('company-definition-not-openable');
    if(capital<Number(definition.founding.minimumCapital||0))throw new Error('company-capital-below-minimum');
    const existing=plan.existing||{};
    const branded=platform().brandedIdentity?.(state,companyId)||null,legalName=checkedText(String(payload.legalName||payload.name||existing.legalName||branded?.legalName||definition.identity.legalDefault.ar||definition.identity.legalDefault.en),'invalid-company-name',120),shortName=checkedText(String(payload.shortName||existing.shortName||branded?.shortName||definition.identity.short),'invalid-company-short-name',28),identifiers={};for(const key of ['taxId','commercialRegistration','businessLicense','formationContract'])identifiers[key]=checkedIdentifier(payload[key]??existing[key]??'',`invalid-company-${key}`);
    if(Object.prototype.hasOwnProperty.call(payload,'logo'))checkedLogo(payload.logo);
    return {companyId,definition,capital,existing,metadata:plan.metadata,legalName,shortName,identifiers};
  }
  function validate(ctx,command,payload={}){
    const state=ctx.state||ctx,companyId=companyIdOf(payload);
    try{
      if(command==='found-group')validateFoundingIdentity(payload);
      if(command==='open-company'){
        if(state.openedCompanies?.includes(companyId))return true;
        const plan=planOpenCompany(state,payload),finance=globalThis.GH_FINANCE_CORE;
        if(!financeSupports(finance,state,'group',platform().getDefinition('group'))||!financeSupports(finance,state,companyId,plan.definition))return {ok:false,reason:`finance-company-adapter-missing:${companyId}`};
      }
      if(command==='rename-company')checkedText(String(payload.legalName||''),'invalid-company-name',60);
      if(command==='set-logo')checkedLogo(payload.logo);
      if(['decision','rename-company','set-logo'].includes(command))platform().requireCompany(state,companyId,{registered:true,operational:command!=='rename-company'&&command!=='set-logo'});
      if(command==='unlock-sector'&&!platform().isKnownSector(payload.sectorId||payload.type))return {ok:false,reason:'sector-not-found'};
      return true;
    }catch(error){return {ok:false,reason:String(error?.message||error)};}
  }
  function execute(ctx,command,payload={}){
    const state=ctx.state||ctx;ensure(state);
    if(command==='found-group'){
      if(state.onboardingComplete)throw new Error('group-already-founded');
      if(!payload.profile?.name||!payload.registry?.formationContract)throw new Error('founding-identity-invalid');validateFoundingIdentity(payload);
      const definition=platform().getDefinition('group'),metadata=platform().instanceMetadata('group',definition);
      state.profile={...payload.profile};state.companyRegistry={group:{...payload.registry,...metadata,status:'active',legalName:payload.registry.legalName||payload.profile.name,shortName:payload.registry.shortName||payload.profile.shortName||definition.identity.short}};state.groupValue=num(payload.capital);
      state.openedCompanies=[];state.unlockedSectors=[];state.ownedCompanies=[];state.stakes={};state.maDeals={};state.onboardingComplete=true;
      return {profile:state.profile,registry:state.companyRegistry.group};
    }
    if(command==='open-company'){
      const companyId=companyIdOf(payload);if(state.openedCompanies.includes(companyId))return state.companyRegistry[companyId];
      const plan=planOpenCompany(state,payload),finance=globalThis.GH_FINANCE_CORE;if(!finance?.execute||!finance?.book)throw new Error('finance-core-missing');
      if(!financeSupports(finance,state,'group',platform().getDefinition('group'))||!financeSupports(finance,state,companyId,plan.definition))throw new Error(`finance-company-adapter-missing:${companyId}`);
      // Register the legal instance before funding so the finance owner can create
      // a book for an arbitrary definition-backed company. The surrounding domain
      // transaction rolls this provisional record back if funding or validation fails.
      const existing=plan.existing||{},provisional={...existing,...plan.metadata,status:'forming',legalName:plan.legalName,shortName:plan.shortName,owner:payload.owner||existing.owner||state.profile?.name||'المجموعة',authorizedSignatory:payload.authorizedSignatory||existing.authorizedSignatory||state.profile?.founder||'المؤسس'};
      state.companyRegistry[companyId]=provisional;
      finance.execute({state},'transfer',{from:'group',to:companyId,amount:plan.capital,note:payload.note||`رأس مال مدفوع لتأسيس ${plan.legalName}`});
      state.openedCompanies.push(companyId);for(const sectorId of plan.definition.classification.sectorIds)if(!state.unlockedSectors.includes(sectorId))state.unlockedSectors.push(sectorId);
      const logo=Object.prototype.hasOwnProperty.call(payload,'logo')?checkedLogo(payload.logo):checkedLogo(existing.logo);
      const record={...existing,...plan.metadata,status:'active',legalName:plan.legalName,shortName:plan.shortName,owner:payload.owner||existing.owner||state.profile?.name||'المجموعة',authorizedSignatory:payload.authorizedSignatory||existing.authorizedSignatory||state.profile?.founder||'المؤسس',logo:logo??null,legalForm:payload.legalForm||existing.legalForm||plan.definition.founding.legalForm,currency:payload.currency||existing.currency||plan.definition.finance.currency||state.profile?.currency||'USD',...plan.identifiers,incorporatedAt:existing.incorporatedAt??now(state),paidInCapital:num(existing.paidInCapital)+plan.capital,budget:existing.budget??plan.capital,financeBookId:companyId,bankAccount:finance.book(state,companyId).accounts[0].id,documentPrefix:existing.documentPrefix||plan.metadata.documentPrefix,accountPrefix:existing.accountPrefix||plan.metadata.accountPrefix,incorporationChecklist:Array.isArray(payload.incorporationChecklist)?payload.incorporationChecklist:(Array.isArray(existing.incorporationChecklist)?existing.incorporationChecklist:[...plan.definition.founding.checklistIds]),invoiceSequence:Math.max(1,Number(existing.invoiceSequence)||1),invoices:Array.isArray(existing.invoices)?existing.invoices:(Array.isArray(payload.invoices)?payload.invoices:[])};
      state.companyRegistry[companyId]=record;platform().syncBrandedNames?.(state);model(state,companyId);return record;
    }
    if(command==='rename-company'){
      const companyId=companyIdOf(payload),name=checkedText(String(payload.legalName||''),'invalid-company-name',60),record=platform().requireCompany(state,companyId,{registered:true}).record,oldName=record?.legalName;
      record.legalName=name;if(companyId==='group'&&state.profile)state.profile.name=name;
      // A renamed subsidiary keeps its own name; a renamed group re-brands every subsidiary that follows it.
      if(companyId!=='group'){record.customName=true;delete record.tradeName;}else{platform().syncBrandedNames?.(state);for(const id of Object.keys(state.companyRegistry||{}))if(id!=='group'&&state.companyRegistry[id]?.customName===false)globalThis.GH_FINANCE_CORE?.execute?.({state},'refresh-identity',{company:id});}
      if(state.bank?.corporateClients?.[companyId])state.bank.corporateClients[companyId].name=name;globalThis.GH_FINANCE_CORE?.execute?.({state},'refresh-identity',{company:companyId});return record;
    }
    if(command==='set-logo'){
      const companyId=companyIdOf(payload),record=platform().requireCompany(state,companyId,{registered:true}).record;if(!record)throw new Error('company-not-found');const logo=checkedLogo(payload.logo);record.logo=logo;if(companyId==='group'&&state.profile)state.profile.logo=logo;globalThis.GH_FINANCE_CORE?.execute?.({state},'refresh-identity',{company:companyId});return record;
    }
    if(command==='unlock-sector'){
      const requested=String(payload.sectorId||payload.type||''),sectorId=platform().normalizeSectorId?.(requested)||requested;if(!platform().isKnownSector(sectorId))throw new Error('sector-not-found');if(!state.unlockedSectors.includes(sectorId))state.unlockedSectors.push(sectorId);return [...state.unlockedSectors];
    }
    if(command==='adjust-group-value'){const delta=Number(payload.delta)||0;state.groupValue=Math.max(0,(Number(state.groupValue)||0)+delta);if(payload.kind==='facility'){const v=valuation(state);v.facilityBook=Math.max(0,num(v.facilityBook)+delta);}return state.groupValue;}
    if(command==='close-valuation')return closeValuation(state,payload);
    if(command==='set-dividend-policy'){if(state.ipo?.listed!==true)throw new Error('dividend-not-listed');const payout=Number(payload.payout);if(!DIVIDEND_PAYOUTS.includes(payout))throw new Error('dividend-payout-invalid');const d=dividends(state);d.payout=payout;d.setDay=Math.floor(now(state)/86400);return {payout,setDay:d.setDay};}
    if(command==='close-dividend')return closeDividend(state,payload);
    if(command==='set-credit-rating'){state.profile=state.profile||{};state.profile.creditRating=String(payload.grade||'BBB');return state.profile.creditRating;}
    // The annual general meeting: how shareholders read the year moves the credit rating score for a year (GH_REALISM updateRating).
    // A fleet company's maintenance policy: the condition at which an asset gets its check (GH_REALISM runMaintenance).
    if(command==='set-maintenance-policy'){const companyId=companyIdOf(payload),policy=String(payload.policy||'');if(!['preventive','standard','deferred'].includes(policy))throw new Error('maintenance-policy-invalid');if(!(state.openedCompanies||[]).includes(companyId))throw new Error('company-not-open');const company=model(state,companyId);company.maintenancePolicy=policy;return {companyId,policy};}
    // A fleet company's insurance cover: none, standard (10% deductible) or full (2%) (GH_REALISM runIncidents).
    if(command==='set-insurance-cover'){const companyId=companyIdOf(payload),cover=String(payload.cover||'');if(!['none','standard','full'].includes(cover))throw new Error('insurance-cover-invalid');if(!(state.openedCompanies||[]).includes(companyId))throw new Error('company-not-open');const company=model(state,companyId);company.insuranceCover=cover;return {companyId,cover};}
    if(command==='record-agm'){state.profile=state.profile||{};const share=value=>Math.max(0,Math.min(100,Number(value)||0));state.profile.agm={year:Math.floor(Number(payload.year)||0),day:Math.max(0,Math.floor(Number(payload.day)||0)),ratingAdjust:Math.max(-6,Math.min(6,Math.round(Number(payload.ratingAdjust)||0))),...(payload.positive!=null?{positive:share(payload.positive),negative:share(payload.negative)}:{})};return {...state.profile.agm};}
    if(command==='set-reputation'){state.profile=state.profile||{};state.profile.reputation=Math.max(0,Math.min(100,Number(payload.value)||0));return state.profile.reputation;}
    if(command==='set-ipo'){
      if(payload.listed===true){if(state.ipo?.listed)throw new Error('ipo-already-listed');const totalShares=Math.floor(Number(payload.totalShares)||0),capTable=Array.isArray(payload.capTable)?payload.capTable.map(row=>({holderId:checkedIdentifier(row?.holderId,'ipo-holder-id-invalid'),label:checkedText(row?.label||row?.holderId,'ipo-holder-label-invalid',100),shares:Math.floor(Number(row?.shares)||0)})):[];if(totalShares<2||!capTable.length||capTable.some(row=>!row.holderId||row.shares<0)||capTable.reduce((sum,row)=>sum+row.shares,0)!==totalShares||new Set(capTable.map(row=>row.holderId)).size!==capTable.length)throw new Error('ipo-cap-table-unbalanced');if(!capTable.some(row=>row.holderId==='founders')||!capTable.some(row=>row.holderId==='public-float'))throw new Error('ipo-cap-table-owners-missing');
        const ticker=checkedText(payload.ticker||'ANI','ipo-ticker-invalid',12).toUpperCase(),issuedPct=Number(payload.issuedPct),proceeds=num(payload.proceeds),offerPrice=Number(payload.offerPrice),sharesIssued=Math.floor(Number(payload.sharesIssued)||0),transferReference=String(payload.transferReference||''),publicPct=100*capTable.find(row=>row.holderId==='public-float').shares/totalShares;if(!Number.isFinite(issuedPct)||issuedPct<=0||issuedPct>=100||Math.abs(issuedPct-publicPct)>.0001||proceeds<=0||!Number.isFinite(offerPrice)||offerPrice<=0||Math.abs(offerPrice*sharesIssued-proceeds)>.02||sharesIssued<1||sharesIssued!==capTable.find(row=>row.holderId==='public-float').shares||!transferReference)throw new Error('ipo-terms-invalid');const fees=num(payload.fees);if(fees>=proceeds)throw new Error('ipo-terms-invalid');const equityTransfer=(state.finance?.transfers||[]).find(row=>row.reference===transferReference)||globalThis.GH_FINANCE_CORE?.findArchivedDocument?.(state,'transfers','reference',transferReference);if(equityTransfer?.kind!=='equity-financing'||equityTransfer.company!=='group'||Math.abs(Number(equityTransfer.amount)-(proceeds-fees))>.02)throw new Error('ipo-proceeds-transfer-mismatch');
        const listedDay=Math.max(0,Math.floor(Number(payload.listedDay)||0)),v=valuation(state);v.raised=cents(proceeds-fees);v.raisedDay=listedDay;if(v.day!=null){v.nav=(Number(v.nav)||0)+(proceeds-fees);v.equity=(Number(v.equity)||0)+(proceeds-fees);v.fresh=freshCapital(v,listedDay,v.nav);v.fair=fairOf(Number(v.earnings)||0,v.nav,v.fresh);}v.sentiment=.95+.1*Math.max(0,Math.min(1,Number(payload.demand)||.5));state.ipo={listed:true,ticker,listedDay,issuedPct,proceeds,fees,netProceeds:cents(proceeds-fees),offerPrice,sharesIssued,totalShares,marketCap:num(payload.marketCap),capTable,transferReference,lockupUntilDay:Math.max(listedDay,Math.floor(Number(payload.lockupUntilDay)||listedDay)),...(payload.priceLow!=null?{priceLow:num(payload.priceLow),priceHigh:num(payload.priceHigh),demand:Math.max(0,Math.min(1,Number(payload.demand)||0))}:{})};
        // The first day's price is the value per share after the offering × the mood the demand set: its chart starts here.
        if(v.day!=null){const price=cents(Math.max(.01,v.fair/totalShares)*v.sentiment);v.history=[];v.events=[];v.prevPrice=offerPrice;sharePrice(v,listedDay,price);shareEvent(v,{day:listedDay,kind:'listing',pct:Math.round((price/offerPrice-1)*10000)/10000,ticker,offerPrice});}return state.ipo;
      }
      if(state.ipo?.listed)throw new Error('ipo-delisted-requires-governance');state.ipo={...(state.ipo&&typeof state.ipo==='object'?state.ipo:{}),listed:false,ticker:String(payload.ticker||'GH').toUpperCase()};return state.ipo;
    }
    if(command==='decision'){
      const companyId=companyIdOf(payload),company=model(state,companyId),action=payload.action,allowed=new Set(['company-service','company-automation']);if(!allowed.has(action))throw new Error('obsolete-or-unknown-company-decision');const cost=num(payload.cost),finance=globalThis.GH_FINANCE_CORE;
      if(cost)finance.execute({state},'spend',{company:companyId,amount:cost,note:`قرار ${action} · ${state.companyRegistry[companyId]?.legalName||companyId}`,method:'تحويل بنكي',line:'other'});
      if(action==='company-service')company.serviceLevel=Math.min(100,company.serviceLevel+5);if(action==='company-automation')company.automation=Math.min(100,company.automation+8);if(['company-service','company-automation'].includes(action))company.upgradeCooldowns[action]=now(state);
      company.lastDecision=now(state);company.history.unshift({at:now(state),action});company.history=company.history.slice(0,50);return company;
    }
    throw new Error(`Unknown corporate command: ${command}`);
  }

  const API=Object.freeze({VERSION,get COMPANY_TYPES(){return companyTypes();},IPO_FLOATS,DIVIDEND_PAYOUTS,FACILITY_DEPRECIATION,FRESH_CAPITAL_DAYS,dividendPlan,SHARE_MOOD:Object.freeze({min:MOOD_MIN,max:MOOD_MAX,daily:MOOD_DAILY,agm:MOOD_AGM}),ensure,model,planOpenCompany,validate,execute,ipoTerms,valuation:state=>({...(object(state?.advanced?.valuation)?state.advanced.valuation:{})})});
  globalThis.GH_CORPORATE_CORE=API;globalThis.GH_DOMAIN_COMMANDS?.register?.('corporate',API);
  if(globalThis.window&&window!==globalThis)globalThis.window.GH_CORPORATE_CORE=API;
  if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
