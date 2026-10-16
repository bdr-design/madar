(()=>{'use strict';
  // Invoked only by Finance Core, with its existing document, journal and account owners.
  // Amounts in the hospitality operational register are integer cents.
  const VERSION='1.0.0',RATE=.15;
  const cents=value=>Math.round(Number(value)*100),money=value=>value/100;
  const clone=value=>structuredClone(value);
  function integer(value){if(!Number.isSafeInteger(value)||value<0||value>1e15)throw new Error('hospitality-money-invalid');return value;}
  function execute(s,action,p,h){
    const company=String(p.company||''),instance=globalThis.GH_COMPANY_PLATFORM?.requireCompany(s,company,{registered:true,operational:true,capability:'operations.hospitality'}),root=s.hospitality?.companies?.[company];
    if(!instance||!root)throw new Error('hospitality-finance-owner-missing');
    const book=h.book(s,company),account=book.accounts[0],ledger=root.accounting;
    if(!ledger)throw new Error('hospitality-finance-register-missing');
    s.finance.hospitalityDocuments=s.finance.hospitalityDocuments||[];
    const tx=globalThis.GH_TRANSACTION_CORE,indexKey=`hospitality-finance-index:${company}:${root.sequence}`;
    const makeIndex=()=>({properties:new Map(root.properties.map(row=>[row.id,row])),bookings:new Map(root.bookings.map(row=>[row.id,row]))});
    const indexes=tx?.isActive?.()?tx.transactionMemo(indexKey,makeIndex):makeIndex();
    const document=(reference,data)=>{
      const row={id:reference,reference,company,at:h.now(s),kind:'hospitality-accounting',status:'معتمد',...data};
      h.protectDocument(s,row,'audit-invoice');s.finance.hospitalityDocuments.unshift(row);h.ledger(s,company,row,{kind:'hospitality-accounting',label:row.note});return row;
    };
    const refresh=()=>{h.refreshBookTaxPayable(s,company);h.reconcile(s);};
    if(action==='record-service-settlement'){
      const account=ledger.serviceAccounts?.[p.accountKey];if(!account?.settled||!account.settlementReference)throw new Error('hospitality-service-settlement-missing');
      const ref=`AUDIT-${account.settlementReference}`;if(account.documentReference)return {reference:account.documentReference,idempotent:true};
      const row=document(ref,{amount:money(account.net),cycleId:account.cycleId,providerCompanyId:account.providerCompanyId,serviceKind:account.kind,country:account.country,contracts:clone(account.contracts),invoiceNumber:account.invoiceNumber||null,settlementReference:account.settlementReference,note:'توزيع تسوية خدمات ضيافة مجمعة على عقودها الأصلية',cashMovement:false});account.documentReference=row.reference;return row;
    }
    if(action==='record-incident'){
      const property=indexes.properties.get(p.propertyId),incident=property?.damage;if(!incident)throw new Error('hospitality-incident-missing');
      if(incident.documentReference)return {id:incident.documentReference,idempotent:true};
      const row=document(incident.id,{propertyId:property.id,day:incident.day,amount:money(incident.repairGross),damagedRooms:incident.rooms,coverageServiceId:incident.coverageServiceId,note:'محضر ضرر فعلي في منشأة ضيافة؛ بلا حركة نقدية',cashMovement:false});incident.documentReference=row.reference;return row;
    }
    if(action==='accrue-day'){
      const pending=root.pendingDay,day=Number(p.day);
      if(ledger.lastAccruedDay===day)return {day,idempotent:true};
      if(!pending||pending.day!==day||!Number.isSafeInteger(day)||day<=ledger.lastAccruedDay)throw new Error('hospitality-day-posting-mismatch');
      let net=0,tax=0;const countries={};
      for(const item of pending.rows){
        integer(item.net);const property=indexes.properties.get(item.propertyId);if(!property)throw new Error('hospitality-posting-property-missing');
        if(!item.net)continue;
        const cycle=globalThis.GH_HOSPITALITY_CALENDAR.cycle(day),parts=Object.entries(item.bookingNet||{}).map(([bookingId,net])=>({bookingId,net:integer(net)})),named=parts.reduce((n,p)=>n+p.net,0);
        if(named>item.net)throw new Error('hospitality-named-revenue-invalid');if(item.net>named)parts.push({bookingId:null,net:item.net-named});
        for(const part of parts){
          const key=part.bookingId?`${cycle.id}:${property.id}:${part.bookingId}`:`${cycle.id}:PUBLIC:${property.country}`,bucket=ledger.buckets[key]||(ledger.buckets[key]={key,company,propertyId:property.id,country:property.country,bookingId:part.bookingId,cycleId:cycle.id,dueDay:cycle.endDay,firstDay:day,lastDay:day,net:0,tax:0,gross:0,bookingCharges:{},propertyCharges:{},invoiceNumber:null});
          if(bucket.invoiceNumber)throw new Error('hospitality-cycle-already-invoiced');
          const nextNet=integer(bucket.net+part.net),nextTax=Math.round(nextNet*RATE),deltaTax=nextTax-bucket.tax;
          bucket.net=nextNet;bucket.tax=nextTax;bucket.gross=nextNet+nextTax;bucket.lastDay=day;
          bucket.propertyCharges[property.id]=integer((bucket.propertyCharges[property.id]||0)+part.net);
          if(part.bookingId)bucket.bookingCharges[part.bookingId]=integer((bucket.bookingCharges[part.bookingId]||0)+part.net);
          net+=part.net;tax+=deltaTax;const country=countries[property.country]||(countries[property.country]={country:property.country,net:0,tax:0});country.net+=part.net;country.tax+=deltaTax;
        }
      }
      if(net){
        const ref=`HOSP-ACCRUAL-${company}-${day}`;
        h.journal(s,company,'إيراد إقامة وخدمات منفذة · دفعة يومية',[{account:'إيرادات ضيافة مستحقة',debit:money(net+tax)},{account:'إيرادات تشغيلية',credit:money(net)},{account:'ضريبة مخرجات VAT',credit:money(tax)}],ref);
        book.vat.output=money(cents(book.vat.output)+tax);
        document(ref,{day,amount:money(net+tax),subtotal:money(net),tax:money(tax),countries:Object.values(countries).map(row=>({...row,net:money(row.net),tax:money(row.tax)})),note:'إثبات مجمع لإقامة وخدمات منفذة؛ بلا حركة نقدية',cashMovement:false});
      }
      root.totals.tax+=tax;ledger.lastAccruedDay=day;refresh();return {day,net:money(net),tax:money(tax)};
    }
    if(action==='issue-cycle-invoice'){
      const bucket=ledger.buckets[String(p.bucketKey||'')];if(!bucket||bucket.company!==company)throw new Error('hospitality-cycle-not-found');
      if(bucket.invoiceNumber)return {number:bucket.invoiceNumber,idempotent:true};
      const day=Math.floor(h.now(s)/86400);if(day<bucket.dueDay||ledger.lastAccruedDay<bucket.dueDay)throw new Error('hospitality-cycle-not-due');
      const property=indexes.properties.get(bucket.propertyId);if(!property)throw new Error('hospitality-property-missing');
      const taxBefore=book.vat.output,sourceRef=`HOSP-INVOICE:${company}:${globalThis.GH_AUTHORIZATION.digest(bucket.key).slice(0,20)}`,namedBooking=bucket.bookingId?indexes.bookings.get(bucket.bookingId):null;
      if(bucket.bookingId&&!namedBooking)throw new Error('hospitality-booking-invoice-owner-missing');
      const invoice=h.invoice(s,{company,kind:'دخل',amount:money(bucket.gross),taxCode:'hospitality-stay',taxRate:RATE,taxCountry:property.country,status:'مستحقة',dueDay:bucket.dueDay,counterparty:namedBooking?.customerName||`مركز تحصيل حجوزات الضيافة · ${property.country}`,sourceRef,businessLocationId:property.facilityId,businessLocationName:property.name,businessLocationCity:property.city,businessLocationCountry:property.country,note:`إقامة وخدمات مجمعة · دورة ${bucket.cycleId} · ${namedBooking?property.name:property.country} · تفصيل المنشآت في محضر التوزيع`});
      if(cents(invoice.tax)!==bucket.tax)throw new Error('hospitality-invoice-rounding-mismatch');
      // Invoice replaces an earned receivable. Revenue and VAT were already recognized on their actual days.
      h.journal(s,company,'تحويل إيراد ضيافة مستحق إلى فاتورة دورة',[{account:'إيرادات تشغيلية',debit:money(bucket.net)},{account:'ضريبة مخرجات VAT',debit:money(bucket.tax)},{account:'إيرادات ضيافة مستحقة',credit:money(bucket.gross)}],sourceRef);
      book.vat.output=taxBefore;bucket.invoiceNumber=invoice.number;
      const allocation=document(`ALLOC-${sourceRef}`,{invoiceNumber:invoice.number,cycleId:bucket.cycleId,country:property.country,amount:money(bucket.gross),subtotal:money(bucket.net),tax:money(bucket.tax),propertyCharges:clone(bucket.propertyCharges),bookingId:bucket.bookingId,note:'توزيع فاتورة تحصيل الضيافة على المنشآت؛ القيم التفصيلية بالسنت',cashMovement:false});bucket.allocationReference=allocation.reference;
      if(namedBooking){namedBooking.invoiceRefs=namedBooking.invoiceRefs||[];namedBooking.invoiceRefs.push({number:invoice.number,net:bucket.net,tax:bucket.tax,gross:bucket.gross,creditedNet:0,creditedTax:0,collected:false});}
      let applied=0;
      for(const [bookingId,net] of Object.entries(bucket.bookingCharges)){
        const booking=indexes.bookings.get(bookingId);if(!booking)throw new Error('hospitality-booking-proof-missing');
        const paid=Math.min(Math.round(net*(1+RATE)),Math.max(0,booking.depositCollected-booking.depositApplied-booking.depositRefunded-booking.refundReserved));
        if(paid<=0)continue;
        h.postCustomerInvoicePayment(s,invoice,money(paid),`HOSP-DEPOSIT-APPLY:${globalThis.GH_AUTHORIZATION.digest({bucket:bucket.key,bookingId}).slice(0,24)}`,{cashAlreadyPosted:true,channel:'تسوية تأمين حجز ضيافة مسترد'});
        h.journal(s,company,'تطبيق رصيد تأمين حجز ضيافة',[{account:'تأمينات حجوزات عملاء',debit:money(paid)},{account:account.id,credit:money(paid)}],`HOSP-DEPOSIT-OFFSET:${globalThis.GH_AUTHORIZATION.digest({bucket:bucket.key,bookingId}).slice(0,24)}`);
        booking.depositApplied+=paid;root.totals.depositApplied+=paid;applied+=paid;
      }
      bucket.depositApplied=applied;refresh();return {number:invoice.number,applied:money(applied)};
    }
    if(action==='collect-cycle-invoice'){
      const bucket=ledger.buckets[String(p.bucketKey||'')];if(!bucket?.invoiceNumber)throw new Error('hospitality-cycle-invoice-missing');
      if(bucket.collected)return {amount:0,idempotent:true};
      const invoice=h.findFinanceDocument(s,'invoices','number',bucket.invoiceNumber);if(!invoice)throw new Error('hospitality-cycle-document-missing');
      const outstanding=cents(invoice.total)-cents(invoice.amountPaid||0);
      let result={amount:0};if(outstanding>0)result=h.collectReceivable(s,{company,number:invoice.number,reference:`HOSP-COLLECT:${globalThis.GH_AUTHORIZATION.digest({company,bucket:bucket.key}).slice(0,24)}`});
      bucket.collected=true;bucket.collectedDay=Math.floor(h.now(s)/86400);root.totals.collected+=outstanding;
      if(bucket.bookingId){const booking=indexes.bookings.get(bucket.bookingId),ref=booking?.invoiceRefs?.find(r=>r.number===invoice.number);if(ref)ref.collected=true;}
      ledger.closedCycles[bucket.cycleId]={id:bucket.cycleId,lastSettledDay:bucket.collectedDay};
      refresh();return result;
    }
    if(action==='collect-booking-deposit'){
      const booking=root.bookings.find(row=>row.id===p.bookingId);if(!booking||booking.status!=='confirmed')throw new Error('hospitality-booking-not-collectible');
      if(booking.depositCollected)return {amount:0,idempotent:true};
      const day=Math.floor(h.now(s)/86400);if(!globalThis.GH_HOSPITALITY_CALENDAR.isCloseDay(day)||day>=booking.startDay||ledger.lastAccruedDay<day)throw new Error('hospitality-deposit-not-due');
      const amount=integer(booking.depositQuote);if(!amount)return {amount:0};
      const before=account.balance;account.balance=money(cents(before)+amount);
      const ref=`HOSP-DEPOSIT:${booking.id}`;
      h.journal(s,company,'تأمين حجز قابل للاسترداد؛ ليس إيراد إقامة',[{account:account.id,debit:money(amount)},{account:'تأمينات حجوزات عملاء',credit:money(amount)}],ref);
      const receipt=document(ref,{bookingId:booking.id,amount:money(amount),tax:0,taxCode:'refundable-security-deposit',accountBalanceBefore:before,accountBalanceAfter:account.balance,note:'تحصيل مجمع لتأمين حجز؛ يبقى التزامًا حتى تقديم الخدمة',cashMovement:true});
      booking.depositCollected=amount;root.totals.deposits+=amount;refresh();return receipt;
    }
    if(action==='credit-collected-stay'){
      const pending=root.refunds.filter(r=>r.status!=='paid');if(pending.length>=256)throw new Error('hospitality-refund-queue-full');root.refunds=[...root.refunds.filter(r=>r.status==='paid').slice(-64),...pending];
      const booking=indexes.bookings.get(p.bookingId),ref=booking?.invoiceRefs?.find(row=>row.number===p.invoiceNumber),net=integer(Number(p.netCents));
      if(!ref?.collected||net<=0||net>ref.net-ref.creditedNet)throw new Error('hospitality-credit-amount-invalid');
      const invoice=h.findFinanceDocument(s,'invoices','number',ref.number);if(!invoice||invoice.company!==company||invoice.status!=='محصلة')throw new Error('hospitality-credit-original-not-collected');
      const tax=Math.round(ref.tax*(ref.creditedNet+net)/ref.net)-ref.creditedTax,gross=net+tax,id=`HOSP-CREDIT-${booking.id}-${++root.sequence}`;
      h.journal(s,company,'إشعار دائن لخدمة ضيافة منفذة',[{account:'مردودات خدمات ضيافة',debit:money(net)},{account:'رصيد ضريبي دائن مرحل',debit:money(tax)},{account:'استردادات ضيافة مستحقة',credit:money(gross)}],id);
      book.vat.creditCarry=money(cents(book.vat.creditCarry)+tax);
      const receipt=document(id,{bookingId:booking.id,invoiceNumber:invoice.number,amount:money(gross),subtotal:money(net),tax:money(tax),taxTreatment:'credit-carry',note:'إشعار دائن مرتبط بفاتورة إقامة محصلة؛ الاسترداد ضمن دفعة المستحقات',cashMovement:false});
      root.refunds.push({id,kind:'earned',bookingId:booking.id,invoiceNumber:invoice.number,amount:gross,net,tax,creditNoteReference:receipt.reference,dueDay:Math.floor(h.now(s)/86400),status:'queued'});
      ref.creditedNet+=net;ref.creditedTax+=tax;booking.creditedNet=(booking.creditedNet||0)+net;root.totals.creditedNet=(root.totals.creditedNet||0)+net;h.notePnl(s,company,0,money(net));refresh();return {creditNoteReference:id,refundable:money(gross)};
    }
    if(action==='refund-deposit'){
      const refund=root.refunds.find(row=>row.id===p.refundId);if(!refund)throw new Error('hospitality-refund-not-found');
      if(refund.status==='paid')return {amount:0,idempotent:true};
      const booking=root.bookings.find(row=>row.id===refund.bookingId),day=Math.floor(h.now(s)/86400),amount=integer(refund.amount);
      if(refund.kind==='earned'){
        const credit=h.findFinanceDocument(s,'hospitalityDocuments','reference',refund.creditNoteReference);
        if(!booking||!credit||credit.company!==company||cents(credit.amount)!==amount||day<refund.dueDay)throw new Error('hospitality-credit-refund-proof-missing');
        if(cents(account.balance)<amount)return {paid:false,reason:'insufficient-cash',amount:0};
        const before=account.balance;account.balance=money(cents(before)-amount);const ref=`PAY-${refund.id}`;
        h.journal(s,company,'سداد إشعار دائن لضيافة',[{account:'استردادات ضيافة مستحقة',debit:money(amount)},{account:account.id,credit:money(amount)}],ref);
        const receipt=document(ref,{bookingId:booking.id,invoiceNumber:refund.invoiceNumber,creditNoteReference:refund.creditNoteReference,amount:money(amount),accountBalanceBefore:before,accountBalanceAfter:account.balance,note:'استرداد مجمع لقيمة خدمة ضيافة محصلة',cashMovement:true});
        refund.status='paid';refund.paidDay=day;refund.documentReference=ref;root.totals.refunded+=amount;refresh();return {paid:true,amount:money(amount),receipt};
      }
      if(!booking||day<refund.dueDay||amount>booking.refundReserved||amount>booking.depositCollected-booking.depositApplied-booking.depositRefunded)throw new Error('hospitality-refund-invalid');
      if(cents(account.balance)<amount)return {paid:false,reason:'insufficient-cash',amount:0};
      const before=account.balance;account.balance=money(cents(before)-amount);const ref=`HOSP-REFUND:${company}:${refund.id}`;
      h.journal(s,company,'استرداد تأمين حجز غير مكتسب',[{account:'تأمينات حجوزات عملاء',debit:money(amount)},{account:account.id,credit:money(amount)}],ref);
      const receipt=document(ref,{bookingId:booking.id,refundId:refund.id,amount:money(amount),tax:0,accountBalanceBefore:before,accountBalanceAfter:account.balance,note:'استرداد تأمين حجز مسترد؛ لا عكس لإيراد إقامة منفذة',cashMovement:true});
      refund.status='paid';refund.paidDay=day;refund.documentReference=ref;booking.refundReserved-=amount;booking.depositRefunded+=amount;root.totals.refunded+=amount;root.totals.depositRefunded=(root.totals.depositRefunded||0)+amount;refresh();return {paid:true,amount:money(amount),receipt};
    }
    throw new Error('hospitality-finance-action-invalid');
  }
  globalThis.GH_HOSPITALITY_FINANCE=Object.freeze({VERSION,execute});
})();
