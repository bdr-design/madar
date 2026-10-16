(()=>{'use strict';
  const VERSION='1.0.0',SCHEMA=1,DAY=86400,HORIZON=90,MAX_PROPERTIES=512,MAX_BOOKINGS=256,HISTORY=30;
  const TYPES=Object.freeze({
    hotel:Object.freeze({id:'hotel',name:'فندق مدينة',rooms:Object.freeze([70,25,5]),rates:Object.freeze([18000,24000,39000]),service:3000,variable:5500,cost:25000000,days:180,dailyCost:2400,staff:60}),
    resort:Object.freeze({id:'resort',name:'منتجع',rooms:Object.freeze([70,35,15]),rates:Object.freeze([28000,39000,65000]),service:8000,variable:10500,cost:55000000,days:300,dailyCost:4800,staff:110})
  }),CLASSES=Object.freeze(['قياسية','ديلوكس','جناح']),PRICE_LEVELS=Object.freeze([.85,1,1.15,1.3]);
  const C=()=>globalThis.GH_HOSPITALITY_CALENDAR,F=()=>globalThis.GH_FINANCE_CORE,P=()=>globalThis.GH_COMPANY_PLATFORM;
  const today=s=>Math.floor((Number(s.simSeconds)||0)/DAY),copy=v=>structuredClone(v),amount=v=>Math.round(v*100),money=v=>v/100;
  const integer=(v,max=1e15)=>Number.isSafeInteger(v)&&v>=0&&v<=max;
  const plain=(v,max=120)=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[<>\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(v);
  const token=id=>globalThis.GH_AUTHORIZATION.digest({companyId:id,sector:'hospitality'}).slice(0,12);
  // A small static destination catalogue supplements capitals without touching transport demand.
  const DESTINATIONS=Object.freeze([
    ['JED','جدة','RUH',21.54,39.17],['ULA','العلا','RUH',26.61,37.92],['DXB','دبي','AUH',25.20,55.27],['RKT','رأس الخيمة','AUH',25.80,55.98],
    ['SSH','شرم الشيخ','CAI',27.92,34.33],['HRG','الغردقة','CAI',27.26,33.81],['AYT','أنطاليا','ANK',36.90,30.70],
    ['DPS','بالي · دينباسار','JKT',-8.65,115.22],['HKT','بوكيت','BKK',7.88,98.39],['MAF','مافوشي','MLE',3.94,73.49]
  ].map(Object.freeze)),destinationCache=new WeakMap();
  function destinations(capitals=globalThis.GH_MOBILITY_CORE?.CAPITALS||[]){
    let saved=destinationCache.get(capitals);if(saved)return saved.rows;
    const byId=new Map(capitals.map(c=>[c.id,c])),rows=capitals.map(c=>Object.freeze({...c,coords:Object.freeze([...c.coords])}));
    for(const [code,city,parent,lat,lng] of DESTINATIONS){const country=byId.get(parent)?.country;if(country)rows.push(Object.freeze({id:`HOSP-${code}`,city,country,coords:Object.freeze([lat,lng]),tourism:true}));}
    saved={rows:Object.freeze(rows),byId:new Map(rows.map(r=>[r.id,r]))};destinationCache.set(capitals,saved);return saved.rows;
  }
  function destinationMeta(id){const capitals=globalThis.GH_MOBILITY_CORE?.CAPITALS||[];destinations(capitals);return destinationCache.get(capitals).byId.get(id)||null;}
  function company(s,id){id=String(id||'');return P().requireCompany(s,id,{registered:true,operational:true,capability:'operations.hospitality'});}
  function read(s,id='hospitality'){return s?.hospitality?.companies?.[id]||null;}
  function ensure(s,id='hospitality'){
    company(s,id);if(!s.hospitality)s.hospitality={schema:SCHEMA,companies:{}};
    if(s.hospitality.schema!==SCHEMA||!s.hospitality.companies||Array.isArray(s.hospitality.companies))throw new Error('hospitality-schema-invalid');
    const all=s.hospitality.companies;
    if(!all[id])all[id]={schema:SCHEMA,companyId:id,openedDay:today(s),lastProcessedDay:Number.isSafeInteger(s.lastFinancialDay)?Math.max(today(s)-1,s.lastFinancialDay):today(s)-1,sequence:0,properties:[],bookings:[],refunds:[],history:[],monthly:{},totals:{net:0,tax:0,occupied:0,available:0,collected:0,deposits:0,depositApplied:0,refunded:0},accounting:{lastAccruedDay:Number.isSafeInteger(s.lastFinancialDay)?Math.max(today(s)-1,s.lastFinancialDay):today(s)-1,buckets:{},closedCycles:{}}};
    const root=all[id];root.requests=root.requests||[];root.requestHistory=root.requestHistory||[];return root;
  }
  function findProperty(root,id){const row=root.properties.find(p=>p.id===String(id));if(!row)throw new Error('hospitality-property-not-found');return row;}
  function facility(s,property){return (s.customHubs||[]).find(f=>f.id===property.facilityId&&f.ownerCompanyId===property.companyId)||null;}
  function cell(property,day,write=false){
    const index=day%HORIZON,existing=property.calendar[index];if(existing?.day===day)return existing;
    if(!write)return null;return property.calendar[index]={day,reserved:[0,0,0],walkin:[0,0,0]};
  }
  function free(property,day,kind){const current=cell(property,day),capacity=Math.max(0,property.rooms[kind]-Math.ceil(property.outOfService*property.rooms[kind]/property.rooms.reduce((a,b)=>a+b,0)));return Math.max(0,capacity-(current?.reserved[kind]||0)-(current?.walkin[kind]||0));}
  function propertyQuote(p={}){
    const type=TYPES[p.kind||'hotel'];if(!type)throw new Error('hospitality-property-kind-invalid');
    const capital=destinationMeta(String(p.capitalId||''));if(!capital)throw new Error('hospitality-location-invalid');
    const local=globalThis.GH_CUSTOMER_BASE?.incomeFactor?.(capital.country,'realestate')||1;
    return {kind:type.id,capitalId:capital.id||String(p.capitalId),city:capital.city,country:capital.country,coords:[...capital.coords],cost:Math.round(type.cost*Math.max(.55,Math.min(1.8,local))),days:type.days,rooms:[...type.rooms],dailyCost:type.dailyCost};
  }
  function buildQuote(s,id,p={}){company(s,id);return {companyId:id,...propertyQuote(p)};}
  function leaseQuote(s,id,projectId){
    company(s,id);P().requireCompany(s,'realestate',{registered:true,operational:true,capability:'operations.realestate'});
    const project=s.realEstate?.projects?.find(row=>row.id===projectId),type=project&&TYPES[project.type],R=globalThis.GH_REALESTATE_CORE;
    if(!project||!type||project.mode!=='lease'||project.status!=='مكتمل'||project.units-project.leased<1)throw new Error('hospitality-lease-building-unavailable');
    const capital=destinations().find(row=>row.city===project.city&&row.country===project.country);if(!capital)throw new Error('hospitality-lease-location-unavailable');
    return {companyId:id,kind:project.type,capitalId:capital.id,city:capital.city,country:capital.country,coords:[...capital.coords],cost:500000,annualRent:Math.round(R.TYPES[project.type].rent*(Number(project.localFactor)>0?project.localFactor:1)),years:3,days:0,rooms:[...type.rooms],dailyCost:type.dailyCost,leaseProjectId:project.id};
  }
  function openProperty(s,p,meta){
    const id=String(p.companyId||p.company||''),root=ensure(s,id),quote=p.leaseProjectId?leaseQuote(s,id,p.leaseProjectId):buildQuote(s,id,p);
    if(root.properties.length>=MAX_PROPERTIES)throw new Error('hospitality-property-limit');
    if(Number(p.expectedCost)!==quote.cost)throw new Error('hospitality-build-quote-changed');
    if(p.name!==undefined&&!plain(p.name))throw new Error('hospitality-property-name-invalid');
    const ref=`HOSP-PROPERTY-${token(id)}-${++root.sequence}`,type=TYPES[quote.kind],day=today(s),name=p.name||`${type.name} · ${quote.city} ${root.sequence}`;
    const paid=F().execute({state:s},'pay-by-cheque',{company:id,amount:quote.cost,line:'capex',requestRef:ref,beneficiary:'مقاول إنشاء وتجهيز منشآت الضيافة',note:`إنشاء وتجهيز ${name}`},meta);
    if(paid?.cheque?.status!=='مصروف')throw new Error('hospitality-construction-payment-failed');
    const capitalized=Number(paid.invoice?.subtotal??quote.cost);F().journal(s,id,'رسملة تكلفة إنشاء وتجهيز ضيافة',[{account:'منشآت ضيافة تحت الإنشاء',debit:capitalized},{account:'مصروف تشغيلي',credit:capitalized}],ref);
    const legal=F().execute({state:s},'register-commercial-contract',{company:id,id:`LEGAL-${ref}`,contractType:'إنشاء وتجهيز منشأة ضيافة',counterparty:'مقاول إنشاء وتجهيز منشآت الضيافة',amount:quote.cost,startDay:day,endDay:day+quote.days,title:name,terms:{kind:quote.kind,rooms:quote.rooms,totalPaid:quote.cost,completionDay:day+quote.days},sourceRefs:[ref,paid.cheque.id]},meta);
    const lease=quote.leaseProjectId?globalThis.GH_REALESTATE_CORE.leaseToCompany(s,{projectId:quote.leaseProjectId,companyId:id,leaseId:`HOSP-LEASE-${ref}`,units:1,rentLevel:1,years:quote.years}):null;
    if(lease&&lease.annualRent!==quote.annualRent)throw new Error('hospitality-lease-quote-changed');
    const property={id:ref,companyId:id,facilityId:ref,kind:quote.kind,name,capitalId:quote.capitalId,city:quote.city,country:quote.country,coords:quote.coords,status:'construction',ownership:lease?'leased':'owned',leaseProjectId:quote.leaseProjectId||null,leaseId:lease?.id||null,leaseYears:quote.years||null,startDay:day,completeDay:day+quote.days,capitalized:amount(capitalized),constructionCost:quote.cost,rooms:quote.rooms,outOfService:0,condition:100,priceLevel:1,calendar:Array(HORIZON).fill(null),campaignUntil:0,services:[],lastDay:null,net:0,occupied:0,available:0,legalDocumentId:legal.id,constructionChequeId:paid.cheque.id};
    if(lease)property.leaseEndDay=lease.endDay;
    root.properties.push(property);s.customHubs=s.customHubs||[];s.customHubs.push({id:ref,name,kind:quote.kind,company:id,ownerCompanyId:id,owned:true,capitalId:quote.capitalId,city:quote.city,country:quote.country,coords:quote.coords,sourceKey:`site:${id}:${quote.capitalId}`,directorySiteKey:`site:${id}:${quote.capitalId}`,capacity:`${quote.rooms.reduce((a,b)=>a+b,0)} غرفة`,roomCount:quote.rooms.reduce((a,b)=>a+b,0),dailyCost:0,cost:quote.cost,constructionContractId:legal.id,constructionStatus:'قيد الإنشاء',photo:'assets/identity/approved/hospitality-symbol.webp',deliveryCapacity:0});
    s.advanced=s.advanced||{};s.advanced.facilities=s.advanced.facilities||{};s.advanced.facilities[ref]={staff:0,serviceLevel:85};
    if(lease)commission(s,property,day);
    return {companyId:id,propertyId:ref,cost:quote.cost,completeDay:property.completeDay,chequeId:paid.cheque.id,legalDocumentId:legal.id};
  }
  function commission(s,property,day){
    if(property.expansion&&day>=property.expansion.completeDay){
      const extra=property.expansion;property.rooms=property.rooms.map((n,i)=>n+extra.rooms[i]);property.capitalized+=extra.capitalized;property.expansion=null;
      F().journal(s,property.companyId,'تشغيل توسعة منشأة ضيافة',[{account:'منشآت وتجهيزات ضيافة',debit:money(extra.capitalized)},{account:'منشآت ضيافة تحت الإنشاء',credit:money(extra.capitalized)}],`HOSP-EXPAND-OPEN-${property.id}-${extra.startDay}`);
      const site=facility(s,property);if(site){site.roomCount=property.rooms.reduce((a,b)=>a+b,0);site.capacity=`${site.roomCount} غرفة`;site.dailyCost=Math.round(TYPES[property.kind].dailyCost*property.rooms.reduce((a,b)=>a+b,0)/TYPES[property.kind].rooms.reduce((a,b)=>a+b,0));}
    }
    if(property.status!=='construction'||day<property.completeDay)return false;
    property.status='operating';property.openedDay=day;const f=facility(s,property);if(!f)throw new Error('hospitality-facility-missing');
    f.dailyCost=TYPES[property.kind].dailyCost;f.constructionStatus='مكتمل';
    F().journal(s,property.companyId,'بدء تشغيل منشأة ضيافة',[{account:'منشآت وتجهيزات ضيافة',debit:money(property.capitalized)},{account:'منشآت ضيافة تحت الإنشاء',credit:money(property.capitalized)}],`HOSP-OPEN-${property.id}`);return true;
  }
  function propertyAccelerationQuote(s,id,p){const day=today(s);if(!p||p.status!=='construction'||p.accelerated||p.completeDay<=day)return null;return {companyId:id,propertyId:p.id,fee:Math.max(10000,Math.round(p.constructionCost*.1*(p.completeDay-day)/TYPES[p.kind].days)),completeDay:day};}
  function accelerationQuote(s,id,propertyId){const root=read(s,id);return propertyAccelerationQuote(s,id,root&&findProperty(root,propertyId));}
  function accelerate(s,p,meta){
    const id=String(p.companyId||''),root=ensure(s,id),property=findProperty(root,p.propertyId);if(property.accelerated)return {...copy(property.accelerated),idempotent:true};
    const quote=accelerationQuote(s,id,property.id);if(!quote||p.expectedFee!==quote.fee||p.expectedCompleteDay!==quote.completeDay)throw new Error('hospitality-acceleration-quote-changed');
    const result=F().execute({state:s},'pay-by-cheque',{company:id,amount:quote.fee,line:'capex',requestRef:`HOSP-ACCEL-${property.id}`,beneficiary:'مقاول إنشاء وتجهيز منشآت الضيافة',note:`تسريع إنجاز ${property.name}`},meta);if(result.cheque?.status!=='مصروف')throw new Error('hospitality-acceleration-unpaid');
    const extra=Number(result.invoice.subtotal);F().journal(s,id,'رسملة تسريع إنشاء منشأة ضيافة',[{account:'منشآت ضيافة تحت الإنشاء',debit:extra},{account:'مصروف تشغيلي',credit:extra}],`HOSP-ACCEL-${property.id}`);property.capitalized+=amount(extra);
    property.completeDay=quote.completeDay;property.accelerated={...quote,chequeId:result.cheque.id};commission(s,property,quote.completeDay);return copy(property.accelerated);
  }
  function bookingQuote(s,id,p={}){
    company(s,id);const root=read(s,id);if(!root)throw new Error('hospitality-company-not-initialized');const property=findProperty(root,p.propertyId),day=today(s),start=Number(p.startDay),end=Number(p.endDay),rooms=Number(p.rooms),roomClass=Number(p.roomClass??0);
    if(property.status!=='operating'||!integer(roomClass,2)||!integer(rooms,10000)||rooms<1||!integer(start,C().MAX_DAY)||!integer(end,C().MAX_DAY)||start<=day||end<=start||end-day>=HORIZON||property.ownership==='leased'&&end>property.leaseEndDay)throw new Error('hospitality-booking-terms-invalid');
    for(let at=start;at<end;at++)if(free(property,at,roomClass)<rooms)throw new Error('hospitality-booking-capacity');
    const type=TYPES[property.kind],rate=Math.round(type.rates[roomClass]*property.priceLevel),nightNet=integer(rate+type.service)?rate+type.service:0,totalNet=nightNet*rooms*(end-start);
    return {companyId:id,propertyId:property.id,startDay:start,endDay:end,rooms,roomClass,nightNet,totalNet,gross:Math.round(totalNet*1.15),depositQuote:Math.round(totalNet*1.15*.2),priceLevel:property.priceLevel};
  }
  function reserve(s,p,meta){
    const id=String(p.companyId||''),root=ensure(s,id),quote=bookingQuote(s,id,p);if(quote.gross!==p.expectedGross)throw new Error('hospitality-booking-quote-changed');
    if(root.bookings.length>=MAX_BOOKINGS)throw new Error('hospitality-booking-register-full');
    if(!plain(p.customerName))throw new Error('hospitality-customer-name-invalid');
    const property=findProperty(root,quote.propertyId),bookingId=`HOSP-BOOK-${token(id)}-${++root.sequence}`;
    const legal=F().execute({state:s},'register-commercial-contract',{company:id,id:`LEGAL-${bookingId}`,contractType:'حجز إقامة مجموعة',counterparty:p.customerName,title:`إقامة مجموعة · ${property.name}`,amount:money(quote.gross),startDay:quote.startDay,endDay:quote.endDay,terms:{...quote,depositPolicy:'تأمين حجز مسترد بالكامل عن الليالي غير المستهلكة؛ ليس إيراد إقامة',settlementDayOfMonth:15},sourceRefs:[property.id,bookingId]},meta);
    for(let at=quote.startDay;at<quote.endDay;at++)cell(property,at,true).reserved[quote.roomClass]+=quote.rooms;
    const row={...quote,id:bookingId,status:'confirmed',customerName:p.customerName,createdDay:today(s),earnedNet:0,depositCollected:0,depositApplied:0,depositRefunded:0,refundReserved:0,legalDocumentId:legal.id};root.bookings.push(row);return copy(row);
  }
  function cancel(s,p){
    const id=String(p.companyId||''),root=ensure(s,id),booking=root.bookings.find(row=>row.id===p.bookingId);if(!booking)throw new Error('hospitality-booking-not-found');
    if(booking.status==='cancelled')return {bookingId:booking.id,idempotent:true};if(booking.status==='completed')throw new Error('hospitality-booking-completed');
    const property=findProperty(root,booking.propertyId),day=today(s),first=Math.max(day,root.lastProcessedDay+1,booking.startDay);
    // A day already consumed is never released. A future cancellation is a single cohort operation.
    for(let at=first;at<booking.endDay;at++){const current=cell(property,at);if(!current||current.reserved[booking.roomClass]<booking.rooms)throw new Error('hospitality-booking-calendar-mismatch');current.reserved[booking.roomClass]-=booking.rooms;}
    const unsettledEarned=Math.max(0,Math.round(booking.earnedNet*1.15)-booking.depositApplied),available=Math.max(0,booking.depositCollected-booking.depositApplied-booking.depositRefunded-booking.refundReserved-unsettledEarned);
    booking.status='cancelled';booking.cancelledDay=day;booking.cancelledFromDay=first;
    const legal=F().execute({state:s},'register-commercial-contract',{company:id,id:`END-${booking.id}`,contractType:'إلغاء ليالي حجز ضيافة',counterparty:booking.customerName,amount:money(available),startDay:day,endDay:day,terms:{bookingId:booking.id,cancelledFromDay:first,earnedNet:booking.earnedNet,securityRefund:available,retainedEarnedCharges:true},sourceRefs:[booking.id,booking.legalDocumentId]});booking.cancellationDocumentId=legal.id;
    if(available)queueSecurityRefund(root,booking,available,day);
    return {bookingId:booking.id,refundable:money(available),refundQueued:available>0};
  }
  function queueSecurityRefund(root,booking,amount,day){
    const pending=root.refunds.filter(r=>r.status!=='paid');if(pending.length>=256)throw new Error('hospitality-refund-queue-full');
    root.refunds=[...root.refunds.filter(r=>r.status==='paid').slice(-64),...pending];
    const refund={id:`HOSP-REFUND-${token(root.companyId)}-${++root.sequence}`,bookingId:booking.id,amount,dueDay:day,status:'queued'};booking.refundReserved+=amount;root.refunds.push(refund);return refund;
  }
  function generateOffers(s,id,root,day){
    const expired=root.requests.filter(r=>r.expiresDay<=day);root.requestHistory.unshift(...expired.map(r=>({id:r.id,status:'expired',day})));root.requests=root.requests.filter(r=>r.expiresDay>day);
    const properties=root.properties.filter(p=>p.status==='operating');
    if(properties.length&&root.requests.length<5&&day%4===0&&root.bookings.length<MAX_BOOKINGS){
      const property=properties[Math.floor(day/4)%properties.length];
      try{
        const terms={propertyId:property.id,startDay:day+7,endDay:day+10,roomClass:0,rooms:Math.min(8,Math.max(1,Math.floor(free(property,day+7,0)*.1)))},quote=bookingQuote(s,id,terms),requestId=`HOSP-OFFER-${token(id)}-${day}`;
        if(!root.requests.some(r=>r.id===requestId))root.requests.push({id:requestId,...terms,customerName:`مجموعة مناسبات · ${property.city}`,quotedGross:quote.gross,expiresDay:day+5,createdDay:day});
      }catch(error){if(!/hospitality-booking-(capacity|terms-invalid)/.test(String(error.message)))throw error;}
    }
    root.requestHistory.splice(32);
  }
  function decideOffers(s,p,meta){
    const root=ensure(s,p.companyId),batchId=String(p.batchId||''),decisions=p.decisions;
    if(!plain(batchId,120)||!Array.isArray(decisions)||!decisions.length||decisions.length>5||new Set(decisions.map(r=>r?.id)).size!==decisions.length||decisions.some(r=>!r||!['accept','decline'].includes(r.decision)))throw new Error('hospitality-offer-decisions-invalid');
    const fingerprint=globalThis.GH_AUTHORIZATION.digest(decisions);if(root.lastOfferBatch?.batchId===batchId){if(root.lastOfferBatch.fingerprint!==fingerprint)throw new Error('hospitality-offer-batch-conflict');return {...copy(root.lastOfferBatch.result),idempotent:true};}
    const result={batchId,accepted:0,declined:0,skipped:0,bookings:[]};
    for(const decision of decisions){
      const request=root.requests.find(r=>r.id===decision.id);if(!request){result.skipped++;continue;}
      let status='declined';
      if(request.expiresDay<=today(s)){status='expired';result.skipped++;}
      else if(decision.decision==='decline')result.declined++;
      else{
        let quote;try{quote=bookingQuote(s,p.companyId,request);}catch(error){if(!/hospitality-booking-(capacity|terms-invalid)/.test(String(error.message)))throw error;}
        if(!quote||quote.gross!==request.quotedGross){status='changed';result.skipped++;}
        else{const booking=reserve(s,{...request,companyId:p.companyId,expectedGross:quote.gross},meta);result.bookings.push(booking.id);result.accepted++;status='accepted';}
      }
      root.requests=root.requests.filter(r=>r.id!==request.id);root.requestHistory.unshift({id:request.id,status,day:today(s)});
    }
    root.requestHistory.splice(32);root.lastOfferBatch={batchId,fingerprint,result:copy(result)};return result;
  }
  function staffing(s,property){const type=TYPES[property.kind],required=Math.ceil(type.staff*property.rooms.reduce((a,b)=>a+b,0)/type.rooms.reduce((a,b)=>a+b,0)),actual=Math.max(0,Number(s.advanced?.facilities?.[property.facilityId]?.staff)||0);return {required,actual,coverage:Math.min(1,actual/required)};}
  function canClose(s,property){const root=read(s,property.companyId);if(property.status==='construction'||property.expansion)throw new Error('hospitality-construction-in-progress');if(root.bookings.some(b=>b.propertyId===property.id&&['confirmed','in-house'].includes(b.status)))throw new Error('hospitality-property-has-bookings');return true;}
  function propertyForFacility(s,facilityId){for(const root of Object.values(s.hospitality?.companies||{})){const property=root.properties.find(p=>p.facilityId===facilityId);if(property)return property;}return null;}
  function currentSummary(s,id='hospitality'){
    const root=read(s,id);if(!root)return {companyId:id,properties:[],bookings:[],refunds:[],rooms:0,occupied:0,available:0,revenue:0,collected:0,deposits:0,depositApplied:0,refunded:0,occupancy:null,adr:null,revpar:null};
    const day=today(s),rows=root.properties.map(p=>({id:p.id,facilityId:p.facilityId,name:p.name,kind:p.kind,city:p.city,country:p.country,status:p.status,rooms:p.rooms.reduce((a,b)=>a+b,0),outOfService:p.outOfService,completeDay:p.completeDay,priceLevel:p.priceLevel,staffing:staffing(s,p),lastDay:p.lastDay?copy(p.lastDay):null,campaignUntil:p.campaignUntil,accelerationQuote:propertyAccelerationQuote(s,id,p)}));
    const latest=root.history[0]||{occupied:0,available:0,roomNet:0,net:0};
    return {companyId:id,cycle:C().cycle(day),lastProcessedDay:root.lastProcessedDay,properties:rows,bookings:root.bookings.slice(-64).reverse().map(copy),refunds:root.refunds.filter(r=>r.status!=='paid').map(copy),rooms:rows.reduce((n,r)=>n+r.rooms,0),occupied:latest.occupied,available:latest.available,revenue:money(latest.net),collected:money(root.totals.collected),deposits:money(root.totals.deposits),refunded:money(root.totals.refunded),occupancy:latest.available?latest.occupied/latest.available:null,adr:latest.occupied?money(latest.roomNet)/latest.occupied:null,revpar:latest.available?money(latest.roomNet)/latest.available:null,totals:copy(root.totals)};
  }
  function* settleStages(s,id,day,meta){
    const root=ensure(s,id),finance=(action,p={})=>F().execute({state:s},'hospitality-accounting',{company:id,action,...p},meta);
    for(const refund of root.refunds)if(refund.status!=='paid'&&refund.dueDay<=day){finance('refund-deposit',{refundId:refund.id});yield 'refund';}
    const closedThrough=Math.min(day,root.accounting.lastAccruedDay);
    if(C().isCloseDay(day)&&day<=closedThrough)for(const booking of root.bookings)if(booking.status==='confirmed'&&booking.startDay>day&&!booking.depositCollected&&booking.depositQuote){finance('collect-booking-deposit',{bookingId:booking.id});yield 'deposit';}
    const buckets=Object.values(root.accounting.buckets).filter(row=>row.dueDay<=closedThrough&&!row.collected);
    for(const bucket of buckets){finance('issue-cycle-invoice',{bucketKey:bucket.key});yield 'invoice';finance('collect-cycle-invoice',{bucketKey:bucket.key});yield 'collection';}
    const unsettledBookings=new Set();for(const b of Object.values(root.accounting.buckets))if(!b.collected)for(const id of Object.keys(b.bookingCharges))unsettledBookings.add(id);
    for(const booking of root.bookings)if(['completed','cancelled'].includes(booking.status)){
      // Release any security left after the last earned service was invoiced. Never consume it as income.
      const remaining=booking.depositCollected-booking.depositApplied-booking.depositRefunded-booking.refundReserved;
      if(!unsettledBookings.has(booking.id)&&remaining>0){const refund=queueSecurityRefund(root,booking,remaining,day);finance('refund-deposit',{refundId:refund.id});yield 'refund';}
    }
    // Prune only fully settled operational data. Legal evidence stays in Finance Core's archive.
    for(const [key,row] of Object.entries(root.accounting.buckets))if(row.collected&&day-row.dueDay>31)delete root.accounting.buckets[key];
    for(const key of Object.keys(root.accounting.closedCycles).sort().slice(0,-24))delete root.accounting.closedCycles[key];
    const obligations=new Set(root.refunds.filter(r=>r.status!=='paid').map(r=>r.bookingId));for(const bucket of Object.values(root.accounting.buckets))if(!bucket.collected)for(const id of Object.keys(bucket.bookingCharges))obligations.add(id);
    const keep=root.bookings.filter(row=>['confirmed','in-house'].includes(row.status)||row.refundReserved>0||row.depositCollected-row.depositApplied-row.depositRefunded>0||obligations.has(row.id));
    const retained=new Set(keep.map(row=>row.id));root.bookings=[...root.bookings.filter(row=>!retained.has(row.id)).slice(-64),...keep];root.refunds=root.refunds.filter(row=>row.status!=='paid'||retained.has(row.bookingId)).slice(-512);
  }
  function* marketDemandStages(s,day){
    const tx=globalThis.GH_TRANSACTION_CORE,key=`hospitality-market:${day}`,cached=tx?.transactionMemoGet?.(key);if(cached)return cached;
    const markets=new Map(),eligible=[],carry=new Map(),out=new Map(),month=C().dateForDay(day).getUTCMonth();let count=0;
    for(const root of Object.values(s.hospitality.companies))for(const property of root.properties){
      if((property.status==='operating'||property.status==='construction'&&property.completeDay<=day)&&!(property.ownership==='leased'&&day>=property.leaseEndDay)){
        const extra=property.expansion&&property.expansion.completeDay<=day?property.expansion.rooms:[0,0,0],rooms=property.rooms.map((n,i)=>n+extra[i]),market=`${property.capitalId}:${property.kind}`;
        eligible.push({property,rooms,market});markets.set(market,(markets.get(market)||0)+rooms.reduce((a,b)=>a+b,0));
      }
      if(++count%32===0)yield 'market';
    }
    for(let index=0;index<eligible.length;index++){
      const {property,rooms,market}=eligible[(index+day)%eligible.length];
      const total=rooms.reduce((a,b)=>a+b,0),season=1+.18*Math.cos((month-(property.kind==='resort'?6:2))*Math.PI/6),service=staffing(s,property).coverage*(.7+.003*property.condition),price=Math.pow(property.priceLevel,-2),share=Math.min(1,(property.kind==='resort'?600:1000)/markets.get(market)),campaign=property.campaignUntil>day?1.12:1;
      const phases=carry.get(market)||[0,0,0],allocation=rooms.map((capacity,kind)=>{
        const available=Math.max(0,capacity-Math.ceil(property.outOfService*capacity/total)),raw=available*.58*season*service*price*share*campaign,withCarry=raw+phases[kind],whole=Math.floor(withCarry+1e-9);phases[kind]=Math.max(0,withCarry-whole);return whole;
      });carry.set(market,phases);out.set(property.id,allocation);
      if(++count%32===0)yield 'market';
    }
    if(tx?.isActive?.())tx.transactionMemoSet(key,out);return out;
  }
  function* tickDayStages(s,p={},meta={}){
    const id=String(p.companyId||p.company||''),root=ensure(s,id),day=C().checkedDay(Number(p.day));
    if(day<=root.lastProcessedDay)return {day,idempotent:true};
    if(day!==root.lastProcessedDay+1)throw new Error('hospitality-day-gap');
    const reservations=new Map();for(const b of root.bookings)if(['confirmed','in-house'].includes(b.status)&&b.startDay<=day&&b.endDay>day){const list=reservations.get(b.propertyId)||[];list.push(b);reservations.set(b.propertyId,list);}
    const demand=yield* marketDemandStages(s,day);
    const report={day,net:0,roomNet:0,serviceNet:0,variableCost:0,depreciation:0,occupied:0,available:0,rows:[]};
    for(const property of root.properties){
      if(property.ownership==='leased'&&property.status==='operating'&&day>=property.leaseEndDay){
        globalThis.GH_FACILITY_CORE.execute({state:s},'close',{id:property.facilityId,company:id});property.status='closed';property.closedReason='lease-expired';property.closedDay=day;
      }
      commission(s,property,day);if(property.status!=='operating'){yield 'property';continue;}
      globalThis.GH_HOSPITALITY_LINKS?.monthlyCondition(s,property,day,root.bookings.some(b=>b.propertyId===property.id&&['confirmed','in-house'].includes(b.status)),meta);
      const type=TYPES[property.kind],current=cell(property,day,true),reserved=reservations.get(property.id)||[];let roomNet=0,serviceNet=0,occupied=0;const bookingNet={};
      for(const booking of reserved){booking.status='in-house';const earned=booking.nightNet*booking.rooms;booking.earnedNet+=earned;bookingNet[booking.id]=earned;roomNet+=(booking.nightNet-type.service)*booking.rooms;serviceNet+=type.service*booking.rooms;occupied+=booking.rooms;}
      let available=0;
      for(let kind=0;kind<3;kind++){
        const cap=Math.max(0,property.rooms[kind]-Math.ceil(property.outOfService*property.rooms[kind]/property.rooms.reduce((a,b)=>a+b,0)));available+=cap;
        const freeRooms=free(property,day,kind),desired=demand.get(property.id)?.[kind]||0,walkin=Math.min(freeRooms,desired),rate=Math.round(type.rates[kind]*property.priceLevel);
        // Walk-in demand is one counted daily cohort, never a record per guest.
        current.walkin[kind]=walkin;occupied+=walkin;roomNet+=walkin*rate;serviceNet+=walkin*type.service;
      }
      const net=roomNet+serviceNet,variableCost=occupied*type.variable+Math.round(roomNet*.05),depreciation=Math.round(property.capitalized/((property.ownership==='leased'?property.leaseYears:30)*365));
      const item={propertyId:property.id,net,roomNet,serviceNet,variableCost,depreciation,occupied,available,bookingNet};report.rows.push(item);
      for(const key of ['net','roomNet','serviceNet','variableCost','depreciation','occupied','available'])report[key]+=item[key];
      property.lastDay={day,net,roomNet,occupied,available,variableCost,depreciation};property.net+=net;property.occupied+=occupied;property.available+=available;
      // The ring stores availability ahead only. Earned nights remain in signed accounting and compact reports.
      property.calendar[day%HORIZON]=null;
      yield 'property';
    }
    if(report.depreciation)F().journal(s,id,'إهلاك مجمع لمنشآت وتجهيزات الضيافة',[{account:'مصروف إهلاك ضيافة',debit:money(report.depreciation)},{account:'مجمع إهلاك ضيافة',credit:money(report.depreciation)}],`HOSP-DEPR-${id}-${day}`);
    const links=globalThis.GH_HOSPITALITY_LINKS?.accrue(s,id,day)||{expense:0,suppliers:{}};report.serviceExpense=links.expense;report.supplierRevenue=links.suppliers;
    root.pendingDay=report;F().execute({state:s},'hospitality-accounting',{company:id,action:'accrue-day',day},meta);delete root.pendingDay;yield 'accrual';
    for(const booking of root.bookings)if(booking.status==='in-house'&&booking.endDay<=day+1)booking.status='completed';
    yield* settleStages(s,id,day,meta);
    if(globalThis.GH_HOSPITALITY_LINKS)yield* globalThis.GH_HOSPITALITY_LINKS.settle(s,id,day,meta);
    const compact={...report};delete compact.rows;root.history.unshift(compact);root.history.splice(HISTORY);
    const key=C().month(day),month=root.monthly[key]||(root.monthly[key]={net:0,roomNet:0,occupied:0,available:0,variableCost:0,depreciation:0});for(const key of Object.keys(month))month[key]+=report[key]||0;
    for(const key of Object.keys(root.monthly).sort().slice(0,-36))delete root.monthly[key];
    root.totals.net+=report.net;root.totals.occupied+=report.occupied;root.totals.available+=report.available;root.lastProcessedDay=day;
    generateOffers(s,id,root,day);
    return compact;
  }
  function drain(iterator){let step;while(!(step=iterator.next()).done){}return step.value;}
  function dailyResult(s,day,id='hospitality',options={}){
    const root=read(s,id),row=root?.history.find(row=>row.day===day);if(!row)return {day,revenue:0,expense:0,cashRevenue:0,cashExpense:0,facilityVatAdjustment:0};
    const base=Number(options.facilityCosts?.byCompany?.[id]??(s.customHubs||[]).reduce((n,f)=>n+(f.owned===true&&String(f.ownerCompanyId||f.company)===id&&['hotel','resort'].includes(f.kind)?Number(f.dailyCost||0):0),0)),supply=s.energy?.dailyHistory?.find(row=>row.day===day)?.internalSupply?.rows?.filter(row=>row.buyer===id)||[],avoided=supply.reduce((n,row)=>n+Number(row.avoidedExternalCost||0),0),external=amount(Math.max(0,base-avoided)),facilityVat=external-Math.round(external/1.15);
    return {day,revenue:money(row.net),expense:money(Math.round(row.variableCost/1.15)+row.depreciation+(row.serviceExpense||0)),cashRevenue:0,cashExpense:money(row.variableCost+facilityVat),facilityVatAdjustment:money(facilityVat),occupied:row.occupied,available:row.available};
  }
  function execute(ctx,cmd,p={},meta={}){
    const s=ctx.state||ctx,id=String(p.companyId||p.company||ctx.companyId||'');
    if(cmd==='ensure')return ensure(s,id);
    if(['sign-service','cancel-service','finance-property','claim-repair'].includes(cmd)){ensure(s,id);return globalThis.GH_HOSPITALITY_LINKS.execute(ctx,cmd,{...p,companyId:id},meta);}
    if(cmd==='start-property'){if(p.leaseProjectId)throw new Error('hospitality-build-source-invalid');return openProperty(s,{...p,companyId:id},meta);}
    if(cmd==='lease-property')return openProperty(s,{companyId:id,leaseProjectId:p.projectId,expectedCost:p.expectedCost},meta);
    if(cmd==='accelerate-construction')return accelerate(s,{...p,companyId:id},meta);
    if(cmd==='reserve-group')return reserve(s,{...p,companyId:id},meta);
    if(cmd==='cancel-booking')return cancel(s,{...p,companyId:id});
    if(cmd==='decide-offers')return decideOffers(s,{...p,companyId:id},meta);
    if(cmd==='credit-booking'){ensure(s,id);return F().execute({state:s},'hospitality-accounting',{company:id,action:'credit-collected-stay',bookingId:p.bookingId,invoiceNumber:p.invoiceNumber,netCents:p.netCents},meta);}
    if(cmd==='tick-day')return drain(tickDayStages(s,{...p,companyId:id},meta));
    if(cmd==='settle-due'){const result=drain(settleStages(s,id,today(s),meta));if(globalThis.GH_HOSPITALITY_LINKS)drain(globalThis.GH_HOSPITALITY_LINKS.settle(s,id,today(s),meta));return result||{settled:true};}
    if(cmd==='set-price'){const property=findProperty(ensure(s,id),p.propertyId);if(!PRICE_LEVELS.includes(p.level))throw new Error('hospitality-price-invalid');property.priceLevel=p.level;return {propertyId:property.id,level:p.level};}
    if(cmd==='hire-property'){const root=ensure(s,id),property=findProperty(root,p.propertyId);if(property.status==='closed')throw new Error('hospitality-property-closed');return globalThis.GH_HR_CORE.execute({state:s,facilityId:property.facilityId,getDynamicFacilities:()=>[facility(s,property)]},'hire',{company:id,scope:'facility',source:'فريق تشغيل الضيافة'});}
    if(cmd==='expand-property'){
      if(findProperty(ensure(s,id),p.propertyId).ownership==='leased')throw new Error('hospitality-leased-building-expansion-forbidden');
      const property=findProperty(ensure(s,id),p.propertyId);if(property.status!=='operating'||property.expansion||property.rooms.some(n=>n+Math.max(1,Math.floor(n*.4))>10000))throw new Error('hospitality-expansion-unavailable');
      const cost=Math.round(property.constructionCost*.4*property.rooms.reduce((a,b)=>a+b,0)/TYPES[property.kind].rooms.reduce((a,b)=>a+b,0));if(p.expectedCost!==cost)throw new Error('hospitality-expansion-quote-changed');
      const paid=F().execute({state:s},'pay-by-cheque',{company:id,amount:cost,line:'capex',requestRef:`HOSP-EXPAND-${property.id}-${today(s)}`,beneficiary:'مقاول توسعات الضيافة',note:`توسعة ${property.name}`},meta);if(paid.cheque?.status!=='مصروف')throw new Error('hospitality-expansion-unpaid');
      const net=amount(paid.invoice.subtotal);F().journal(s,id,'رسملة إنشاء توسعة ضيافة',[{account:'منشآت ضيافة تحت الإنشاء',debit:money(net)},{account:'مصروف تشغيلي',credit:money(net)}],paid.cheque.id);
      property.expansion={startDay:today(s),completeDay:today(s)+90,capitalized:net,rooms:property.rooms.map(n=>Math.max(1,Math.floor(n*.4))),chequeId:paid.cheque.id};return copy(property.expansion);
    }
    if(cmd==='repair-property'){
      const property=findProperty(ensure(s,id),p.propertyId);if(property.status!=='operating'||property.condition>=100&&property.outOfService===0)throw new Error('hospitality-maintenance-unnecessary');
      const cost=property.damage?property.damage.repairGross/100:Math.max(1000,Math.round(property.constructionCost*.001*(100-property.condition+property.outOfService)/100));if(p.expectedCost!==cost)throw new Error('hospitality-maintenance-quote-changed');if(property.damage&&(property.repairClaims||[]).filter(r=>!r.claimReference).length>=16)throw new Error('hospitality-insurance-claims-pending-limit');
      const paid=F().execute({state:s},'pay-by-cheque',{company:id,amount:cost,line:'other',requestRef:`HOSP-REPAIR-${property.id}-${today(s)}`,beneficiary:'مورد صيانة مرافق الضيافة',note:`صيانة ${property.name}`},meta);if(paid.cheque?.status!=='مصروف')throw new Error('hospitality-maintenance-unpaid');if(property.damage){property.repairClaims=property.repairClaims||[];if(property.repairClaims.filter(r=>!r.claimReference).length>=16)throw new Error('hospitality-insurance-claims-pending-limit');property.repairClaims=property.repairClaims.filter(r=>!r.claimReference).concat(property.repairClaims.filter(r=>r.claimReference).slice(-8));property.repairClaims.push({id:paid.cheque.id,invoiceNumber:paid.invoice.number,net:amount(paid.invoice.subtotal),incidentDocumentReference:property.damage.documentReference,coverageServiceId:property.damage.coverageServiceId,day:today(s)});}property.damage=null;property.condition=100;property.outOfService=0;return {propertyId:property.id,cost,chequeId:paid.cheque.id};
    }
    if(cmd==='close-property'){
      const property=findProperty(ensure(s,id),p.propertyId);canClose(s,property);globalThis.GH_FACILITY_CORE.execute({state:s},'close',{id:property.facilityId,company:id});property.status='closed';return {propertyId:property.id,status:'closed'};
    }
    if(cmd==='company-campaign'){
      const root=ensure(s,id),B=globalThis.GH_BRANCH_CAMPAIGN,rows=root.properties.map(row=>({row,active:row.status==='operating',cost:row.rooms.reduce((a,b)=>a+b,0)*100}));
      return B.launch(s,id,root,rows,p,30);
    }
    throw new Error(`Unknown hospitality command: ${cmd}`);
  }
  function* executeStages(ctx,cmd,p={},meta={}){if(cmd!=='tick-day')throw new Error('hospitality-staged-command-invalid');return yield* tickDayStages(ctx.state||ctx,p,meta);}
  function* onFinancialDayStages(ctx,p={}){
    company(ctx.state,ctx.companyId);const commands=globalThis.GH_DOMAIN_COMMANDS,payload={companyId:ctx.companyId,day:p.day};
    if(!read(ctx.state,ctx.companyId))return {day:p.day,dormant:true};
    if(!globalThis.GH_TRANSACTION_CORE?.isActive?.())return commands.dispatchSystem({state:ctx.state},'hospitality','tick-day',payload,{actor:'simulation-scheduler'}).result;
    return yield* commands.dispatchSystemStages({state:ctx.state},'hospitality','tick-day',payload,{actor:'simulation-scheduler'});
  }
  function campaignQuote(s,id){const root=read(s,id);return globalThis.GH_BRANCH_CAMPAIGN.quote(s,id,(root?.properties||[]).map(row=>({row,active:row.status==='operating',cost:row.rooms.reduce((a,b)=>a+b,0)*100})),30);}
  function* validationSteps(s){
    const errors=[],all=s?.hospitality,object=v=>!!v&&typeof v==='object'&&!Array.isArray(v),array=(v,max)=>Array.isArray(v)&&v.length<=max;
    const error=message=>errors.push(message);
    if(all===undefined){
      if((Array.isArray(s?.customHubs)?s.customHubs:[]).some(f=>['hotel','resort'].includes(f?.kind)&&P()?.definitionFor?.(s,String(f.ownerCompanyId||f.company||''))?.capabilities.includes('operations.hospitality')))error('hospitality-operational-register-missing');
      return {ok:!errors.length,errors};
    }
    if(!object(all)||all.schema!==SCHEMA||!object(all.companies)||Object.keys(all.companies).length>256)return {ok:false,errors:['hospitality-schema']};
    const sites=new Map((Array.isArray(s.customHubs)?s.customHubs:[]).filter(object).map(f=>[f.id,f])),knownSites=new Set();
    for(const [id,root] of Object.entries(all.companies)){
      if(!object(root)){error(`hospitality-company:${id}`);continue;}
      if(!P()?.definitionFor?.(s,id)?.capabilities.includes('operations.hospitality')||root.companyId!==id||root.schema!==SCHEMA)error(`hospitality-company:${id}`);
      if(!array(root.properties,MAX_PROPERTIES)||!array(root.bookings,MAX_BOOKINGS)||!array(root.refunds,512)||!array(root.history,HISTORY)||!object(root.accounting)||!object(root.accounting.buckets)||!object(root.accounting.closedCycles)||!object(root.monthly)||Object.keys(root.monthly).length>36||!object(root.totals)){error(`hospitality-register:${id}`);continue;}
      if(Object.hasOwn(root,'pendingDay')||!integer(root.sequence)||!integer(root.openedDay,C().MAX_DAY)||!integer(root.lastProcessedDay+1,C().MAX_DAY+1)||root.accounting.lastAccruedDay!==root.lastProcessedDay||Object.values(root.totals).some(n=>!integer(n)))error(`hospitality-accounting:${id}`);
      if(!array(root.requests,5)||!array(root.requestHistory,32))error(`hospitality-offers:${id}`);
      const props=new Map(),bookings=new Map(),expected=new Map(),expectedKey=(p,day,kind)=>`${p}:${day}:${kind}`;
      for(const row of root.properties){
        if(!object(row)){error(`hospitality-property:${id}`);continue;}
        const roomsValid=Array.isArray(row.rooms)&&row.rooms.length===3&&row.rooms.every(n=>integer(n,10000))&&row.rooms.reduce((a,b)=>a+b,0)>0;
        if(!plain(row.id,80)||props.has(row.id)||row.companyId!==id||!TYPES[row.kind]||!['owned','leased'].includes(row.ownership)||!['construction','operating','closed'].includes(row.status)||!plain(row.name)||!plain(row.city,100)||!plain(row.country,100)||!roomsValid||!array(row.calendar,HORIZON)||row.calendar.length!==HORIZON||!integer(row.capitalized)||!integer(row.completeDay,C().MAX_DAY)||!PRICE_LEVELS.includes(row.priceLevel)||!Number.isFinite(row.condition)||row.condition<0||row.condition>100||!array(row.services,16))error(`hospitality-property:${row.id}`);
        props.set(row.id,row);knownSites.add(row.facilityId);const site=sites.get(row.facilityId);
        if(row.status==='closed'?site?.owned===true:!site||String(site.ownerCompanyId||site.company)!==id||site.kind!==row.kind||site.owned!==true)error(`hospitality-facility:${row.id}`);
        if(row.ownership==='leased'&&(!integer(row.leaseEndDay,C().MAX_DAY)||!integer(row.leaseYears,20)||row.leaseYears<1||!plain(row.leaseId,120)||!plain(row.leaseProjectId,120)))error(`hospitality-lease:${row.id}`);
        if(roomsValid&&!integer(row.outOfService,row.rooms.reduce((a,b)=>a+b,0)))error(`hospitality-out-of-service:${row.id}`);
        for(const service of Array.isArray(row.services)?row.services:[]){if(!object(service)||!plain(service.id,120)||!['telecom','insurance'].includes(service.kind)||!['active','paused','cancelled','expired'].includes(service.status)||!integer(service.dailyNet)||!integer(service.startDay,C().MAX_DAY)||!integer(service.endDay,C().MAX_DAY)||service.endDay<=service.startDay)error(`hospitality-service:${row.id}`);}
        if(row.damage!=null&&(!object(row.damage)||!integer(row.damage.day,C().MAX_DAY)||!integer(row.damage.rooms,10000)||!integer(row.damage.repairGross)||!plain(row.damage.documentReference,140)))error(`hospitality-damage:${row.id}`);
        if(row.repairClaims!==undefined&&(!array(row.repairClaims,24)||row.repairClaims.some(r=>!object(r)||!plain(r.id,120)||!plain(r.invoiceNumber,100)||!plain(r.incidentDocumentReference,140)||!integer(r.net)||!integer(r.day,C().MAX_DAY))))error(`hospitality-repair-claims:${row.id}`);
        for(let index=0;index<(Array.isArray(row.calendar)?row.calendar.length:0);index++){
          const at=row.calendar[index];if(at==null)continue;
          if(!object(at)||!integer(at.day,C().MAX_DAY)||at.day%HORIZON!==index||!array(at.reserved,3)||at.reserved.length!==3||!array(at.walkin,3)||at.walkin.length!==3||[...at.reserved,...at.walkin].some(n=>!integer(n,10000))){error(`hospitality-calendar:${row.id}`);continue;}
          if(roomsValid&&at.reserved.some((n,i)=>n+at.walkin[i]>row.rooms[i]))error(`hospitality-calendar-capacity:${row.id}`);
        }
        yield 'property';
      }
      for(const b of root.bookings){
        if(!object(b)){error(`hospitality-booking:${id}`);continue;}
        const dates=integer(b.startDay,C().MAX_DAY)&&integer(b.endDay,C().MAX_DAY)&&b.endDay>b.startDay&&b.endDay-b.startDay<HORIZON;
        if(!plain(b.id,100)||bookings.has(b.id)||!props.has(b.propertyId)||!dates||!integer(b.rooms,10000)||b.rooms<1||!integer(b.roomClass,2)||!['confirmed','in-house','completed','cancelled'].includes(b.status)||!plain(b.customerName)||['earnedNet','depositCollected','depositApplied','depositRefunded','refundReserved'].some(k=>!integer(b[k]))||b.depositApplied+b.depositRefunded+b.refundReserved>b.depositCollected)error(`hospitality-booking:${b.id}`);
        bookings.set(b.id,b);
        if(dates&&['confirmed','in-house'].includes(b.status))for(let at=Math.max(b.startDay,root.lastProcessedDay+1);at<b.endDay;at++){const key=expectedKey(b.propertyId,at,b.roomClass);expected.set(key,(expected.get(key)||0)+b.rooms);}
        if(b.invoiceRefs!==undefined&&(!array(b.invoiceRefs,5)||b.invoiceRefs.some(ref=>!object(ref)||!plain(ref.number,100)||['net','tax','gross','creditedNet','creditedTax'].some(k=>!integer(ref[k]))||ref.net+ref.tax!==ref.gross||ref.creditedNet>ref.net||ref.creditedTax>ref.tax)))error(`hospitality-booking-invoices:${b.id}`);
        yield 'booking';
      }
      for(const p of props.values()){
        for(const at of Array.isArray(p.calendar)?p.calendar:[])if(object(at)&&integer(at.day,C().MAX_DAY)&&at.day>root.lastProcessedDay&&Array.isArray(at.reserved))for(let i=0;i<3;i++){
          const key=expectedKey(p.id,at.day,i);if(at.reserved[i]!==Number(expected.get(key)||0))error(`hospitality-reservations:${p.id}`);expected.delete(key);
        }
        yield 'calendar';
      }
      for(const request of Array.isArray(root.requests)?root.requests:[])if(!object(request)||!plain(request.id,100)||!props.has(request.propertyId)||!integer(request.startDay,C().MAX_DAY)||!integer(request.endDay,C().MAX_DAY)||request.endDay<=request.startDay||!integer(request.rooms,10000)||request.rooms<1||!integer(request.roomClass,2)||!integer(request.expiresDay,C().MAX_DAY))error(`hospitality-offer:${id}`);
      if(expected.size)error(`hospitality-reservation-calendar-missing:${id}`);
      for(const r of root.refunds)if(!object(r)||!bookings.has(r.bookingId)||!integer(r.amount)||!integer(r.dueDay,C().MAX_DAY)||!['queued','paid'].includes(r.status)||r.kind==='earned'&&(!integer(r.net)||!integer(r.tax)||r.net+r.tax!==r.amount||!plain(r.creditNoteReference,140)))error(`hospitality-refund:${id}`);
      if(Object.keys(root.accounting.buckets).length>MAX_PROPERTIES*3+MAX_BOOKINGS*4)error(`hospitality-bucket-limit:${id}`);
      for(const b of Object.values(root.accounting.buckets))if(!object(b)||b.company!==id||!props.has(b.propertyId)||['net','tax','gross'].some(k=>!integer(b[k]))||b.net+b.tax!==b.gross||!integer(b.dueDay,C().MAX_DAY)||!object(b.bookingCharges)||Object.values(b.bookingCharges).some(n=>!integer(n))||!object(b.propertyCharges)||Object.entries(b.propertyCharges).some(([propertyId,net])=>!props.has(propertyId)||!integer(net))||Object.values(b.propertyCharges).reduce((n,v)=>n+v,0)!==b.net)error(`hospitality-bucket:${id}`);
      if(root.accounting.serviceAccounts!==undefined){
        if(!object(root.accounting.serviceAccounts)||Object.keys(root.accounting.serviceAccounts).length>4096)error(`hospitality-service-accounts:${id}`);
        else for(const a of Object.values(root.accounting.serviceAccounts))if(!object(a)||a.companyId!==id||!integer(a.net)||!integer(a.dueDay,C().MAX_DAY)||!object(a.contracts)||Object.values(a.contracts).some(n=>!integer(n)))error(`hospitality-service-account:${id}`);
      }
      yield 'company';
    }
    for(const site of sites.values())if(['hotel','resort'].includes(site.kind)&&P()?.definitionFor?.(s,String(site.ownerCompanyId||site.company||''))?.capabilities.includes('operations.hospitality')&&!knownSites.has(site.id))error('hospitality-orphan-facility');
    return {ok:!errors.length,errors};
  }
  function validateState(s){return drain(validationSteps(s));}
  const AUTH=globalThis.GH_AUTHORIZATION;if(!AUTH?.registerCommandTargetResolver)throw new Error('hospitality-authorization-owner-missing');
  AUTH.registerCommandTargetResolver('hospitality',({state,name,payload})=>{const id=String(payload.companyId||payload.company||'');company(state,id);const root=read(state,id);if(payload.propertyId&&!root?.properties.some(row=>row.id===payload.propertyId))throw new Error('hospitality-target-property-mismatch');if(payload.bookingId&&!root?.bookings.some(row=>row.id===payload.bookingId))throw new Error('hospitality-target-booking-mismatch');const result=name==='lease-property'?[id,'realestate']:[id],provider=name==='sign-service'?payload.providerCompanyId:name==='claim-repair'?root?.properties.find(p=>p.id===payload.propertyId)?.services.find(row=>row.id===root?.properties.find(p=>p.id===payload.propertyId)?.repairClaims?.find(r=>r.id===payload.repairId)?.coverageServiceId)?.providerCompanyId:name==='cancel-service'?root?.properties.find(p=>p.id===payload.propertyId)?.services.find(r=>r.id===payload.serviceId)?.providerCompanyId:null;if(provider&&provider!=='external')result.push(provider);return result;});
  const API=Object.freeze({VERSION,SCHEMA,HORIZON,MAX_PROPERTIES,MAX_BOOKINGS,TYPES,CLASSES,PRICE_LEVELS,DAILY_FINANCIAL_ORDER:440,destinations,destinationMeta,ensure,read,propertyQuote,buildQuote,leaseQuote,bookingQuote,accelerationQuote,summary:currentSummary,campaignQuote,free,dailyResult,execute,executeStages,onFinancialDayStages,validateState,validationSteps,propertyForFacility,canClose,validate:()=>true,transactionScope:()=>null});
  globalThis.GH_HOSPITALITY_CORE=API;globalThis.GH_DOMAIN_COMMANDS?.register('hospitality',API);
})();
