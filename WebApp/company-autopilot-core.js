// Owner («خلاص كل شي يتحول بدقه تلقائي حتا صرف الشيكات وتحصيل الذمم والضرائب»): the decisions and the finance actions the
// player made by hand are made after each daily close by fixed rules, through the very commands the player's buttons send
// (same owners, same checks, same documents), by the system actor 'company-autopilot'. app.js runs one step at a time,
// each in its own transaction (a step that fails is rolled back alone and the day goes on).
// The decisions (read from each owner's own request fields; at most the owner's batch limit, the oldest first):
//  - insurance risks: accepted when the expected loss is below the premium, declined otherwise;
//  - real-estate tenant requests: accepted at 90% of the market rent or more, declined otherwise;
//  - telecom business contracts: accepted when the monthly value exceeds the network cost, declined otherwise;
//  - bank loan requests (the group's customers and the dealership's): approved when the customer's grade is within the
//    bank's risk stance (cautious: A or better, balanced: BBB or better, growth: BB or better), rejected otherwise; the
//    bank still defers what its liquidity and capital do not allow;
//  - hotel group offers: accepted (the owner re-checks rooms and price and skips an offer that no longer fits).
// The finance actions (each row at most once a day; a row the company cannot cover now waits for the next day):
//  - open receivables without automatic terms that are due (or have no due day): collected by incoming cheques;
//  - due VAT: each company's due periods paid when its current account covers them;
//  - open payables without automatic terms that are due (or have no due day), no cheque pending: paid by transfer when
//    the current account covers them;
//  - issued cheques: cashed when the company's funds and budget cover them (a due cheque is still cashed by the close);
//  - returned cheques: presented again when the funds and budget now cover them.
(function(root,factory){const api=factory();if(root)root.GH_COMPANY_AUTOPILOT=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const VERSION='1.0.0',ACTOR='company-autopilot',BATCH_LIMIT=5,ROW_LIMIT=24,MIN_RENT_LEVEL=.9;
  const GRADES=Object.freeze(['AAA','AA','A','BBB','BB','B','C']),STANCE_LIMIT=Object.freeze({cautious:'A',balanced:'BBB',growth:'BB'});
  // The order of a day's work: the decisions, then the money in, then the money out.
  const KINDS=Object.freeze(['insurance','realestate','telecom','bank','hospitality','receivables','taxes','payables','cheques','returned']);
  const dayOf=s=>Math.floor((Number(s?.simSeconds)||0)/86400);
  const list=value=>Array.isArray(value)?value:[];
  const num=value=>Number.isFinite(Number(value))?Number(value):0;
  const digest=value=>{const d=globalThis.GH_AUTHORIZATION?.digest;if(typeof d!=='function')throw new Error('company-autopilot-digest-unavailable');return String(d(value)).slice(0,24);};
  const due=(row,day)=>!Number.isFinite(Number(row?.dueDay))||Number(row.dueDay)<=day;
  function bankStance(s){const policy=s?.bank?.riskPolicy,named=String(policy?.preset||globalThis.GH_BANKING_CORE?.riskPreset?.(policy)||'balanced');return STANCE_LIMIT[named]?named:'balanced';}
  function loanApproved(s,request){const limit=GRADES.indexOf(STANCE_LIMIT[bankStance(s)]),grade=GRADES.indexOf(String(request?.riskGrade||''));return grade>=0&&grade<=limit;}
  const fresh=(rows,tried,kind)=>list(rows).filter(row=>row&&row.id!=null&&!tried.has(`${kind}:${row.id}`));
  // One step of `kind` from the state as it is now, or null when nothing is left for today. A step names the rows it
  // takes (keys, never tried again today) and the commands that take them.
  function decisionStep(s,kind,tried){
    const day=dayOf(s),period=Math.floor(day/30),periodId=String(period);
    if(kind==='insurance'){const rows=fresh(s?.insurance?.riskRequests,tried,kind).slice(0,BATCH_LIMIT),decisions=rows.map(row=>({id:String(row.id),decision:num(row.expectedLoss)<num(row.premium)?'accept':'decline'})).sort((a,b)=>a.id.localeCompare(b.id));if(!decisions.length)return null;
      return {kind,keys:rows.map(row=>`${kind}:${row.id}`),decisions,commands:[{domain:'insurance',name:'decide-risks-batch',payload:{batchId:`AUTO-INS-${day}-${digest({periodId,decisions})}`,periodId,decisions}}]};}
    if(kind==='realestate'){const rows=fresh(s?.realEstate?.tenantRequests,tried,kind).slice(0,BATCH_LIMIT),decisions=rows.map(row=>({id:String(row.id),decision:num(row.rentLevel)>=MIN_RENT_LEVEL?'accept':'decline'})).sort((a,b)=>a.id.localeCompare(b.id));if(!decisions.length)return null;
      return {kind,keys:rows.map(row=>`${kind}:${row.id}`),decisions,commands:[{domain:'realestate',name:'decide-requests-batch',payload:{batchId:`AUTO-RE-${day}-${digest({periodId,decisions})}`,periodId,decisions}}]};}
    if(kind==='telecom'){const rows=fresh(s?.customerCompanies?.companies?.telecom?.market?.requests,tried,kind).slice(0,BATCH_LIMIT),decisions=rows.map(row=>({id:String(row.id),decision:num(row.monthlyValue)>num(row.networkCost)?'accept':'decline'})).sort((a,b)=>a.id.localeCompare(b.id));if(!decisions.length)return null;
      return {kind,keys:rows.map(row=>`${kind}:${row.id}`),decisions,commands:[{domain:'customer-companies',name:'telecom-decide-requests-batch',payload:{company:'telecom',batchId:`AUTO-TEL-${day}-${digest({periodId,decisions})}`,periodId,decisions}}]};}
    if(kind==='bank'){const rows=fresh(s?.bank?.loanRequests,tried,kind).slice(0,BATCH_LIMIT),decisions=rows.map(row=>({id:String(row.id),decision:loanApproved(s,row)?'approve':'reject',...(row.customerId?{customerId:String(row.customerId)}:{}),...(row.sourceCompanyId?{sourceCompanyId:String(row.sourceCompanyId)}:{}),...(row.sourceSaleId?{sourceSaleId:String(row.sourceSaleId)}:{})})).sort((a,b)=>a.id.localeCompare(b.id));if(!decisions.length)return null;
      return {kind,keys:rows.map(row=>`${kind}:${row.id}`),decisions,commands:[{domain:'banking',name:'approve-loan-requests-batch',payload:{batchId:`AUTO-BANK-${day}-${digest({period,decisions})}`,periodId:period,decisions}}]};}
    if(kind==='hospitality'){for(const companyId of Object.keys(s?.hospitality?.companies||{}).sort()){const rows=fresh(s.hospitality.companies[companyId]?.requests,tried,`${kind}:${companyId}`).slice(0,BATCH_LIMIT),decisions=rows.map(row=>({id:String(row.id),decision:'accept'}));if(!decisions.length)continue;
      return {kind,company:companyId,keys:rows.map(row=>`${kind}:${companyId}:${row.id}`),decisions,commands:[{domain:'hospitality',name:'decide-offers',payload:{companyId,batchId:`AUTO-HOSP-${day}-${digest({id:companyId,decisions})}`,decisions}}]};}return null;}
    return null;
  }
  function financeStep(s,kind,tried,F){
    const day=dayOf(s),free=F.investorMode?.(s)===true,companyOf=row=>String(row?.company||'group'),covers=(company,amount)=>free||num(F.operating?.(s,F.requireCompany?F.requireCompany(s,company):company))>=amount;
    if(kind==='receivables'){
      const rows=list(s?.finance?.receivables).filter(row=>row?.number&&row.autoSettle!==true&&due(row,day)&&!tried.has(`${kind}:${row.number}`));if(!rows.length)return null;
      const company=companyOf(rows[0]),take=rows.filter(row=>companyOf(row)===company).slice(0,ROW_LIMIT),numbers=take.map(row=>String(row.number));
      return {kind,company,keys:numbers.map(n=>`${kind}:${n}`),count:numbers.length,commands:[{domain:'finance',name:'collect-receivables-by-cheque',payload:{company,numbers}}]};
    }
    if(kind==='taxes'){
      const totals=new Map();for(const row of list(s?.finance?.periods))if(row?.status==='مستحق'){const company=companyOf(row);totals.set(company,(totals.get(company)||0)+num(row.amount));}
      for(const [company,amount] of totals){const key=`${kind}:${company}`;if(tried.has(key)||amount<=0)continue;if(!covers(company,amount)){tried.add(key);continue;}return {kind,company,keys:[key],amount,commands:[{domain:'finance',name:'pay-taxes',payload:{company}}]};}
      return null;
    }
    if(kind==='payables'){
      const pending=new Set(list(s?.finance?.cheques).filter(row=>row?.status==='صادر'&&row.invoiceNumber).map(row=>String(row.invoiceNumber))),take=[],spent=new Map();
      for(const row of list(s?.finance?.payables)){
        if(take.length>=ROW_LIMIT)break;if(!row?.number||row.autoSettle===true||!due(row,day)||pending.has(String(row.number)))continue;const key=`${kind}:${row.number}`;if(tried.has(key))continue;
        const company=companyOf(row),amount=num(row.total??row.amount),used=spent.get(company)||0;if(amount<=0||!covers(company,used+amount)){tried.add(key);continue;}
        spent.set(company,used+amount);take.push(row);
      }
      if(!take.length)return null;
      return {kind,keys:take.map(row=>`${kind}:${row.number}`),count:take.length,commands:take.map(row=>({domain:'finance',name:'settle-payable',payload:{number:String(row.number),method:'transfer'}}))};
    }
    if(kind==='cheques'||kind==='returned'){
      const status=kind==='cheques'?'صادر':'مرتجع',take=[];
      const rows=list(s?.finance?.cheques).filter(row=>row?.status===status&&row.id!=null&&!tried.has(`${kind}:${row.id}`)).sort((a,b)=>num(a.dueDay)-num(b.dueDay)||String(a.id).localeCompare(String(b.id)));
      for(const row of rows){if(take.length>=ROW_LIMIT)break;const key=`${kind}:${row.id}`;let blocker='unchecked';try{blocker=typeof F.chequeFundingBlocker==='function'?F.chequeFundingBlocker(s,row):'unchecked';}catch(_error){blocker='invalid';}if(blocker!==null){tried.add(key);continue;}take.push(row);}
      if(!take.length)return null;
      return {kind,keys:take.map(row=>`${kind}:${row.id}`),count:take.length,commands:take.map(row=>({domain:'finance',name:'settle-cheque',payload:{id:String(row.id)}}))};
    }
    return null;
  }
  function next(s,kind,{tried=new Set(),F=globalThis.GH_FINANCE_CORE}={}){
    if(['insurance','realestate','telecom','bank','hospitality'].includes(kind))return decisionStep(s,kind,tried);
    if(!F)return null;return financeStep(s,kind,tried,F);
  }
  return Object.freeze({VERSION,ACTOR,BATCH_LIMIT,ROW_LIMIT,MIN_RENT_LEVEL,GRADES,STANCE_LIMIT,KINDS,bankStance,loanApproved,next});
});
