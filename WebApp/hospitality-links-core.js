(()=>{'use strict';
  const VERSION='1.0.0',KINDS=Object.freeze({telecom:{name:'اتصال أعمال للمنشأة',capability:'operations.telecom'},insurance:{name:'تغطية ممتلكات الضيافة',capability:'operations.insurance'}});
  const H=()=>globalThis.GH_HOSPITALITY_CORE,F=()=>globalThis.GH_FINANCE_CORE,C=()=>globalThis.GH_HOSPITALITY_CALENDAR;
  const day=s=>Math.floor(s.simSeconds/86400),money=v=>v/100,cents=v=>Math.round(v*100),copy=v=>structuredClone(v);
  function quote(s,companyId,propertyId,kind,providerCompanyId='external'){
    const company=globalThis.GH_COMPANY_PLATFORM.requireCompany(s,companyId,{registered:true,operational:true,capability:'operations.hospitality'}),property=H().read(s,companyId)?.properties.find(p=>p.id===propertyId),config=KINDS[kind];
    if(!company||!property||property.status!=='operating'||!config)throw new Error('hospitality-service-unavailable');
    if(providerCompanyId!=='external'){
      globalThis.GH_COMPANY_PLATFORM.requireCompany(s,providerCompanyId,{registered:true,operational:true,capability:config.capability});
      const facilityKind=kind==='telecom'?'telecom-branch':'insurance';
      if(!(s.customHubs||[]).some(f=>f.owned===true&&f.kind===facilityKind&&String(f.ownerCompanyId||f.company)===providerCompanyId&&f.country===property.country))throw new Error('hospitality-provider-local-coverage-required');
    }
    const rooms=property.rooms.reduce((a,b)=>a+b,0),dailyNet=kind==='telecom'?rooms*100:Math.max(100,Math.round(property.capitalized*.004/365));
    return {companyId,propertyId,kind,providerCompanyId,dailyNet,startDay:day(s),endDay:day(s)+365,deductible:.1,limit:kind==='insurance'?Math.round(property.capitalized*.1):0};
  }
  function sign(s,p,meta){
    const q=quote(s,p.companyId,p.propertyId,p.kind,p.providerCompanyId);if(q.dailyNet!==p.expectedDailyNet)throw new Error('hospitality-service-quote-changed');
    const root=H().read(s,q.companyId),property=root.properties.find(r=>r.id===q.propertyId);
    const retainedPolicies=new Set((property.repairClaims||[]).filter(r=>!r.claimReference).map(r=>r.coverageServiceId));if(property.damage?.coverageServiceId)retainedPolicies.add(property.damage.coverageServiceId);
    while(property.services.length>=16){const index=property.services.findIndex(row=>['cancelled','expired'].includes(row.status)&&!retainedPolicies.has(row.id));if(index<0)throw new Error('hospitality-service-register-full');property.services.splice(index,1);}
    if(property.services.some(row=>row.kind===q.kind&&['active','paused'].includes(row.status)&&row.endDay>day(s)))throw new Error('hospitality-service-already-active');
    const sequence=++root.sequence,id=`HOSP-SERVICE-${property.id}-${sequence}`,counterparty=q.providerCompanyId==='external'?`مورد خارجي · ${KINDS[q.kind].name}`:globalThis.GH_COMPANY_PLATFORM.resolveIdentity(s,q.providerCompanyId).legalName;
    const legal=F().execute({state:s},'register-commercial-contract',{company:q.companyId,id:`LEGAL-${id}`,contractType:KINDS[q.kind].name,counterparty,amount:money(q.dailyNet*365),startDay:q.startDay,endDay:q.endDay,terms:{...q,propertyId:property.id,settlementDayOfMonth:15,billing:'actual-service-days',pauseOnOverdue:true,unearnedServiceCancellable:true},sourceRefs:[id,property.id]},meta);
    const row={...q,id,status:'active',country:property.country,counterparty,legalDocumentId:legal.id};property.services.push(row);return copy(row);
  }
  function activeServices(property,at){return property.services.filter(r=>r.status==='active'&&r.startDay<=at&&r.endDay>at);}
  function accrue(s,companyId,at){
    const root=H().read(s,companyId),cycle=C().cycle(at),accounts=root.accounting.serviceAccounts||(root.accounting.serviceAccounts={}),suppliers={},overdue=new Set();let expense=0;
    for(const a of Object.values(accounts))if(!a.settled&&a.dueDay<at)for(const id of Object.keys(a.contracts))overdue.add(id);
    for(const property of root.properties){
      if(property.status!=='operating')continue;
      for(const service of property.services){
        if(['active','paused'].includes(service.status)&&at>=service.endDay){service.status='expired';continue;}
        if(service.status!=='active')continue;
        if(service.providerCompanyId!=='external'&&!globalThis.GH_COMPANY_PLATFORM.resolveCompany(s,service.providerCompanyId)?.operational){service.status='paused';service.pauseReason='provider-unavailable';continue;}
        // A missed prior cycle pauses further supply, without deleting its payable.
        if(overdue.has(service.id)){service.status='paused';service.pauseReason='overdue';continue;}
        const key=`${cycle.id}:${service.providerCompanyId}:${service.kind}:${property.country}`,account=accounts[key]||(accounts[key]={key,cycleId:cycle.id,dueDay:cycle.endDay,companyId,providerCompanyId:service.providerCompanyId,kind:service.kind,country:property.country,counterparty:service.counterparty,net:0,contracts:{},settled:false});
        account.net+=service.dailyNet;account.contracts[service.id]=(account.contracts[service.id]||0)+service.dailyNet;expense+=service.dailyNet;
        if(service.providerCompanyId!=='external')suppliers[service.providerCompanyId]=(suppliers[service.providerCompanyId]||0)+service.dailyNet;
      }
    }
    if(expense)F().journal(s,companyId,'استحقاق مجمع لخدمات منشآت الضيافة',[{account:'مصروف خدمات ضيافة',debit:money(expense)},{account:'خدمات ضيافة مستحقة',credit:money(expense)}],`HOSP-SERVICE-DAY-${companyId}-${at}`);
    for(const [supplier,total] of Object.entries(suppliers))F().journal(s,supplier,'دخل خدمة ضيافة داخل المجموعة',[{account:'خدمات ضيافة مدينة',debit:money(total)},{account:'إيرادات تشغيلية',credit:money(total)}],`HOSP-SERVICE-DAY-${companyId}-${supplier}-${at}`);
    return {expense,suppliers};
  }
  function* settle(s,companyId,at,meta){
    const root=H().read(s,companyId),accounts=root.accounting.serviceAccounts||{};let settledAny=false;
    for(const account of Object.values(accounts)){
      if(account.settled||account.dueDay>Math.min(at,root.accounting.lastAccruedDay))continue;
      const ref='HOSP-SERVICE-SETTLE-'+globalThis.GH_AUTHORIZATION.digest({companyId,key:account.key}).slice(0,24),net=money(account.net);
      if(account.providerCompanyId==='external'){
        if(!account.invoiceNumber){
          const invoice=F().execute({state:s},'issue-invoice',{company:companyId,kind:'مصروف',amount:Math.round(account.net*1.15)/100,taxCode:'hospitality-service',taxCountry:account.country,status:'مستحقة',dueDay:account.dueDay,counterparty:account.counterparty,note:`خدمة ضيافة · ${KINDS[account.kind].name}`,sourceRef:ref},meta);
          account.invoiceNumber=invoice.number;
          F().journal(s,companyId,'إعادة تصنيف استحقاق خدمة إلى فاتورة مورد',[{account:'خدمات ضيافة مستحقة',debit:net},{account:'مصروف تشغيلي',credit:net}],ref);
          yield 'service-invoice';
        }
        const invoice=F().findArchivedDocument?.(s,'invoices','number',account.invoiceNumber)||s.finance.invoices.find(r=>r.number===account.invoiceNumber),amount=Number(invoice?.total||0),line=F().lineFor(invoice?.note,invoice?.method);
        if(!invoice||F().operating(s,companyId)<amount||!F().canSpend(s,companyId,amount,line))continue;
        F().execute({state:s},'settle-payable',{company:companyId,number:account.invoiceNumber,reference:ref},meta);
      }else{
        if(F().operating(s,companyId)<net||!F().canSpend(s,companyId,net,'other'))continue;
        F().execute({state:s},'settle-intercompany-service',{from:companyId,to:account.providerCompanyId,amount:net,line:'other',ref,closeOwned:true,serviceCategory:KINDS[account.kind].name,note:`خدمة ضيافة داخل المجموعة · دورة ${account.cycleId}`,sourceRefs:[ref]},meta);
        F().journal(s,companyId,'تسوية استحقاق خدمة ضيافة سابق',[{account:'خدمات ضيافة مستحقة',debit:net},{account:'مصروف تشغيلي',credit:net}],ref);
        F().journal(s,account.providerCompanyId,'تسوية دخل خدمة ضيافة سابق',[{account:'إيرادات تشغيلية',debit:net},{account:'خدمات ضيافة مدينة',credit:net}],ref);
      }
      account.settled=true;account.settledDay=at;account.settlementReference=ref;settledAny=true;
      F().execute({state:s},'hospitality-accounting',{company:companyId,action:'record-service-settlement',accountKey:account.key},meta);yield 'service-payment';
    }
    if(settledAny){
      const unpaid=new Set();for(const a of Object.values(accounts))if(!a.settled&&a.dueDay<=at)for(const id of Object.keys(a.contracts))unpaid.add(id);
      for(const property of root.properties){for(const service of property.services)if(service.status==='paused'&&service.pauseReason==='overdue'&&!unpaid.has(service.id)&&service.endDay>at&&(service.providerCompanyId==='external'||globalThis.GH_COMPANY_PLATFORM.resolveCompany(s,service.providerCompanyId)?.operational)){service.status='active';delete service.pauseReason;}yield 'service-state';}
    }
    for(const [key,row] of Object.entries(accounts))if(row.settled&&at-row.dueDay>31)delete accounts[key];
  }
  function financeProperty(s,p,meta){
    const root=H().read(s,p.companyId),property=root?.properties.find(r=>r.id===p.propertyId);if(!property||property.ownership!=='owned')throw new Error('hospitality-financing-property-unavailable');
    if(property.loanId)return {ref:property.loanId,idempotent:true};if(![.4,.6].includes(p.share))throw new Error('hospitality-financing-share-invalid');
    const amount=Math.round(property.constructionCost*p.share),termDays=Math.max(0,property.completeDay-day(s))+5*365,rate=F().fixedDebtQuote(s,termDays);if(p.expectedAmount!==amount||p.expectedRate!==rate)throw new Error('hospitality-financing-quote-changed');const result=F().execute({state:s},'raise-debt',{company:p.companyId,amount,ref:`HOSP-LOAN-${property.id}`,fixedRate:true,termDays,lender:'بنك تمويل منشآت الضيافة الخارجي',note:`تمويل منشأة ${property.name}`},meta);
    property.loanId=result.ref;return result;
  }
  function monthlyCondition(s,property,at,hasBookings,meta){
    if(C().dateForDay(at).getUTCDate()!==16)return;
    property.condition=Math.max(40,property.condition-1);
    if(property.damage||hasBookings)return;
    let hash=2166136261;for(const ch of property.id+':'+C().month(at)){hash^=ch.charCodeAt(0);hash=Math.imul(hash,16777619)>>>0;}
    if(hash%100>=2)return;
    const rooms=Math.min(2,Math.max(1,Math.floor(property.rooms.reduce((a,b)=>a+b,0)*.02))),coverage=activeServices(property,at).find(row=>row.kind==='insurance');
    property.damage={id:`HOSP-INCIDENT-${property.id}-${at}`,day:at,rooms,repairGross:Math.max(100000,Math.round(property.constructionCost*.008*100)),coverageServiceId:coverage?.id||null,documentReference:null};property.outOfService=rooms;property.condition=Math.max(40,property.condition-10);
    F().execute({state:s},'hospitality-accounting',{company:property.companyId,action:'record-incident',propertyId:property.id},meta);
  }
  function claimQuote(s,companyId,propertyId,repairId){
    const root=H().read(s,companyId),property=root?.properties.find(p=>p.id===propertyId),repair=property?.repairClaims?.find(r=>r.id===repairId);
    if(!repair?.coverageServiceId||repair.claimReference)throw new Error('hospitality-insurance-claim-unavailable');
    const policy=property.services.find(row=>row.id===repair.coverageServiceId),get=(bucket,key,value)=>(s.finance?.[bucket]||[]).find(row=>row[key]===value)||F().findArchivedDocument(s,bucket,key,value),incident=get('hospitalityDocuments','reference',repair.incidentDocumentReference),invoice=get('invoices','number',repair.invoiceNumber),legal=get('commercialContracts','id',policy?.legalDocumentId);
    if(!policy||!legal||legal.company!==companyId||!incident||incident.company!==companyId||incident.propertyId!==property.id||incident.coverageServiceId!==policy.id||!invoice||invoice.company!==companyId||invoice.kind!=='مصروف'||!['مسددة','مدفوعة'].includes(invoice.status)||cents(invoice.subtotal)!==repair.net||cents(invoice.total)!==cents(incident.amount)||incident.day<legal.startDay||incident.day>=legal.endDay||legal.terms.propertyId!==property.id||legal.terms.providerCompanyId!==policy.providerCompanyId)throw new Error('hospitality-insurance-claim-proof-invalid');
    const amount=Math.min(Math.round(repair.net*(1-legal.terms.deductible)),Math.max(0,legal.terms.limit-(policy.claimsPaid||0)));if(amount<=0)throw new Error('hospitality-insurance-coverage-exhausted');
    return {companyId,propertyId,repairId,providerCompanyId:policy.providerCompanyId,amount,coverageServiceId:policy.id,incidentDocumentReference:repair.incidentDocumentReference,invoiceNumber:repair.invoiceNumber};
  }
  function execute(ctx,cmd,p,meta){
    const s=ctx.state||ctx;if(cmd==='sign-service')return sign(s,p,meta);if(cmd==='finance-property')return financeProperty(s,p,meta);
    if(cmd==='cancel-service'){
      const root=H().read(s,p.companyId),property=root?.properties.find(r=>r.id===p.propertyId),service=property?.services.find(r=>r.id===p.serviceId);if(!service)throw new Error('hospitality-service-not-found');
      if(service.status==='cancelled')return {serviceId:service.id,idempotent:true};
      const legal=F().execute({state:s},'register-commercial-contract',{company:p.companyId,id:`END-${service.id}`,contractType:'إنهاء خدمة منشأة ضيافة',counterparty:service.counterparty,amount:0,startDay:day(s),endDay:day(s),terms:{serviceId:service.id,retainedPayables:true},sourceRefs:[service.id,service.legalDocumentId]},meta);
      service.status='cancelled';service.endedDay=day(s);return {serviceId:service.id,legalDocumentId:legal.id};
    }
    if(cmd==='claim-repair'){
      const property=H().read(s,p.companyId)?.properties.find(r=>r.id===p.propertyId),repair=property?.repairClaims?.find(r=>r.id===p.repairId);if(repair?.claimReference)return {reference:repair.claimReference,idempotent:true};
      const q=claimQuote(s,p.companyId,p.propertyId,p.repairId);if(p.expectedAmount!==q.amount)throw new Error('hospitality-claim-quote-changed');
      const reference=`HOSP-CLAIM-${p.repairId}`,amount=money(q.amount),sourceRefs=[q.repairId,q.incidentDocumentReference,q.invoiceNumber];
      if(q.providerCompanyId==='external')F().execute({state:s},'credit',{company:p.companyId,amount,taxable:false,taxCode:'insurance-claim',reference,counterparty:'مورد تغطية ممتلكات الضيافة الخارجي',note:'تعويض ضرر ضيافة بعد الإصلاح والتحمل',sourceRefs,investmentResult:amount},meta);
      else F().execute({state:s},'settle-intercompany-service',{from:q.providerCompanyId,to:p.companyId,amount,line:'other',ref:reference,serviceCategory:'تعويض ضرر ضيافة',taxCode:'insurance-claim',note:'تعويض ضرر ضيافة بعد الإصلاح والتحمل',sourceRefs},meta);
      const policy=property.services.find(row=>row.id===q.coverageServiceId);policy.claimsPaid=(policy.claimsPaid||0)+q.amount;repair.claimReference=reference;return {reference,amount};
    }
    throw new Error('hospitality-link-command-invalid');
  }
  globalThis.GH_HOSPITALITY_LINKS=Object.freeze({VERSION,KINDS,quote,activeServices,accrue,settle,execute,monthlyCondition,claimQuote});
})();
