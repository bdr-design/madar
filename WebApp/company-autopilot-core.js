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
//  - funding (automation batch, owner: «نفذ بدقه مع اختبارات صارمة تمنع الثقل والمشاكل»): a company whose current account
//    does not cover what is due today (due VAT, the payables this step pays, issued cheques due) plus its saved minimum
//    operating cash (the cash pool's other way: the sweep sends what is above it to the holding) is sent the gap by the
//    holding, in one bulk transfer a day for all of them (each company's reference AUTO-FUND-<day>-<company>),
//    from what the holding holds above its own due bills; never the bank (not in the cash pool), nothing in the investor
//    mode (the card covers each payment), nothing when the holding has no room; one pass over each finance list;
//  - due VAT: each company's due periods paid when its current account covers them;
//  - open payables without automatic terms that are due (or have no due day), no cheque pending: paid by transfer when
//    the current account covers them, in one payment run per company (finance settle-payables-run);
//  - issued cheques: cashed when the company's funds and budget cover them (a due cheque is still cashed by the close);
//  - returned cheques: presented again when the funds and budget now cover them.
(function(root,factory){const api=factory();if(root)root.GH_COMPANY_AUTOPILOT=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const VERSION='1.0.0',ACTOR='company-autopilot',BATCH_LIMIT=5,ROW_LIMIT=24,MIN_RENT_LEVEL=.9;
  const GRADES=Object.freeze(['AAA','AA','A','BBB','BB','B','C']),STANCE_LIMIT=Object.freeze({cautious:'A',balanced:'BBB',growth:'BB'});
  // The order of a day's work: the decisions, then the money in, then the money out.
  // Review (a reader found a cheque due today bounce at the close after research spent the cash): the obligations of the
  // day (VAT, payables, issued and returned cheques) come before the spending the policies choose (campaigns, pay,
  // research and renewals, the bank's review, repairs), and that spending keeps back each company's cheques due today.
  const KINDS=Object.freeze(['insurance','realestate','telecom','bank','hospitality','receivables','funding','taxes','payables','cheques','returned','campaigns','salaries','continuation','housekeeping','repairs']);
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
    // Review round 4 (a reader: the holding funded a cheque due today, the payables step paid a bill with that money and the
    // cheque bounced at the close): VAT and payables keep back each company's issued cheques due today (read once).
    const day=dayOf(s),free=F.investorMode?.(s)===true,companyOf=row=>String(row?.company||'group'),names=new Map(),name=company=>{let id=names.get(company);if(id===undefined){id=F.requireCompany?F.requireCompany(s,company):company;names.set(company,id);}return id;};let dueCheques=null;
    const chequesDue=company=>{if(!dueCheques){dueCheques=new Map();for(const row of list(s?.finance?.cheques))if(row?.status==='صادر'&&num(row.dueDay)<=day+1){const id=name(companyOf(row));dueCheques.set(id,(dueCheques.get(id)||0)+num(row.amount));}}return dueCheques.get(name(company))||0;};
    const covers=(company,amount)=>free||num(F.operating?.(s,name(company)))-((kind==='taxes'||kind==='payables')?chequesDue(company):0)>=amount;
    if(kind==='receivables'){
      const rows=list(s?.finance?.receivables).filter(row=>row?.number&&row.autoSettle!==true&&due(row,day)&&!tried.has(`${kind}:${row.number}`));if(!rows.length)return null;
      const company=companyOf(rows[0]),take=rows.filter(row=>companyOf(row)===company).slice(0,ROW_LIMIT),numbers=take.map(row=>String(row.number));
      return {kind,company,keys:numbers.map(n=>`${kind}:${n}`),count:numbers.length,commands:[{domain:'finance',name:'collect-receivables-by-cheque',payload:{company,numbers}}]};
    }
    if(kind==='funding'){
      // Review round 4: one bulk transfer, which a career opens at level 3; below it the holding funds nothing automatically.
      if(free||typeof F.operating!=='function'||globalThis.GH_PROGRESSION_CORE?.unlocked?.(s,'command:finance:bulk-transfer')===false)return null;
      const need=new Map(),add=(company,amount)=>{if(amount>0)need.set(company,(need.get(company)||0)+amount);},names=new Map(),norm=company=>{let id=names.get(company);if(id===undefined){id=F.requireCompany?F.requireCompany(s,company):company;names.set(company,id);}return id;};
      for(const row of list(s?.finance?.periods))if(row?.status==='مستحق')add(norm(companyOf(row)),num(row.amount));
      // One pass over each list, a constant cost a row (the finance owner's per-payable reading scans the cheques: 264 ms
      // a day on 4,500 rows, measured). A payable a cheque already pays is left out; one the month's ceiling holds is
      // funded once all the same (the money stays inside the group; the next days find the cash there and send nothing).
      const pending=new Set();for(const row of list(s?.finance?.cheques))if(row?.status==='صادر'){if(row.invoiceNumber)pending.add(String(row.invoiceNumber));if(num(row.dueDay)<=day+1)add(norm(companyOf(row)),num(row.amount));}
      for(const row of list(s?.finance?.payables))if(row?.number&&row.autoSettle!==true&&due(row,day)&&!pending.has(String(row.number))){const amount=num(row.total??row.amount);if(amount>0)add(norm(companyOf(row)),amount);}
      const floors=s?.finance?.centralTreasury?.minOperatingCash||{},room=num(F.operating(s,'group'))-(need.get('group')||0);if(room<=.01)return null;
      for(const [company,floor] of Object.entries(floors))if(num(floor)>0&&!need.has(company))need.set(company,0);
      // One step a day for every company (the day's step limit is shared with the money out): one bulk transfer, each
      // company's own reference AUTO-FUND-<day>-<company> (the transfer owner's idempotency), the holding's room shared
      // in the companies' order.
      // Review (a reader: floored amounts summed one unit above the holding's room, and the day's funding was refused whole):
      // the amounts are whole halalas, and the total the transfer owner adds up is kept within the room.
      if(tried.has(kind))return null;tried.add(kind);const rows=[];let left=Math.floor(room*100+1e-6);
      for(const company of [...need.keys()].sort()){if(company==='group'||left<1)continue;if(F.cashPoolEligible?.(s,company)===false)continue;
        const gap=need.get(company)+Math.max(0,num(floors[company]))-num(F.operating(s,company)),cents=Math.min(Math.ceil(gap*100-1e-6),left);
        if(cents<=1)continue;rows.push({company,amount:cents/100});left-=cents;}
      // The transfer owner checks the total against the holding's cash, then pays each row from the balance left (a float
      // subtraction): a row that drains the room could find one float step less and refuse the whole transfer (a reader,
      // round 3). The rows are checked here the same way, against the room: the first that does not fit is lowered a
      // halala (dropped when it cannot be), at most 16 times; still not fitting, nothing is sent that day.
      const total=()=>rows.reduce((n,row)=>n+row.amount,0),misfit=()=>{if(total()>room)return rows.length-1;let left=room;for(let i=0;i<rows.length;i++){if(left<rows[i].amount)return i;left-=rows[i].amount;}return -1;};
      for(let guard=0,at=misfit();rows.length&&at>=0&&guard<16;guard++,at=misfit()){const row=rows[at],cents=Math.round(row.amount*100)-1,amount=cents/100;if(cents<=1||!(amount<row.amount))rows.splice(at,1);else row.amount=amount;}
      if(!rows.length||misfit()>=0)return null;
      return {kind,keys:[kind,...rows.map(row=>`${kind}:${row.company}`)],rows,amount:rows.reduce((n,row)=>n+row.amount,0),commands:[{domain:'finance',name:'bulk-transfer',payload:{batchId:`AUTO-FUND-${day}`,rows,note:'تمويل آلي من القابضة لمستحقات اليوم والحد الأدنى للنقد'}}]};
    }
    if(kind==='taxes'){
      const totals=new Map();for(const row of list(s?.finance?.periods))if(row?.status==='مستحق'){const company=companyOf(row);totals.set(company,(totals.get(company)||0)+num(row.amount));}
      for(const [company,amount] of totals){const key=`${kind}:${company}`;if(tried.has(key)||amount<=0)continue;if(!covers(company,amount)){tried.add(key);continue;}return {kind,company,keys:[key],amount,commands:[{domain:'finance',name:'pay-taxes',payload:{company}}]};}
      return null;
    }
    if(kind==='payables'){
      // Build 670 (review): a payable the month's ceiling refuses is left out as one the cash cannot cover is (the finance
      // owner says which: payableTransferBlocker); it rejected the whole step, every day.
      const pending=new Set(list(s?.finance?.cheques).filter(row=>row?.status==='صادر'&&row.invoiceNumber).map(row=>String(row.invoiceNumber))),take=[],spent=new Map(),planned={},blocked=typeof F.payableTransferBlocker==='function'?row=>F.payableTransferBlocker(s,row.number,planned)!==null:()=>false;
      for(const row of list(s?.finance?.payables)){
        if(take.length>=ROW_LIMIT)break;if(!row?.number||row.autoSettle===true||!due(row,day)||pending.has(String(row.number)))continue;const key=`${kind}:${row.number}`;if(tried.has(key))continue;
        const company=companyOf(row),amount=num(row.total??row.amount),used=spent.get(company)||0;if(amount<=0||!covers(company,used+amount)||blocked(row)){tried.add(key);continue;}
        spent.set(company,used+amount);take.push(row);
      }
      if(!take.length)return null;
      // Decision 2: one payment run per company (finance settle-payables-run), its payables in the order taken.
      const runs=new Map();for(const row of take){const company=companyOf(row);if(!runs.has(company))runs.set(company,[]);runs.get(company).push(String(row.number));}
      return {kind,keys:take.map(row=>`${kind}:${row.number}`),count:take.length,commands:[...runs].map(([company,numbers])=>({domain:'finance',name:'settle-payables-run',payload:{company,numbers,method:'transfer'}}))};
    }
    if(kind==='cheques'||kind==='returned'){
      const status=kind==='cheques'?'صادر':'مرتجع',take=[],taken=new Map();
      const rows=list(s?.finance?.cheques).filter(row=>row?.status===status&&row.id!=null&&!tried.has(`${kind}:${row.id}`)).sort((a,b)=>num(a.dueDay)-num(b.dueDay)||String(a.id).localeCompare(String(b.id)));
      for(const row of rows){if(take.length>=ROW_LIMIT)break;const key=`${kind}:${row.id}`;let blocker='unchecked';try{blocker=typeof F.chequeFundingBlocker==='function'?F.chequeFundingBlocker(s,row):'unchecked';}catch(_error){blocker='invalid';}if(blocker!==null){tried.add(key);continue;}
        // Build 670 (review): the finance owner checks each cheque alone. A second cheque of the same company in one step was
        // presented against cash or budget room the first had taken, and bounced. It waits for the next step, which reads
        // the state the first one left: always while a ceiling is on (the room is the total's and each line's), and with
        // no ceiling unless the cash covers the step's cheques together.
        const company=F.requireCompany?F.requireCompany(s,companyOf(row)):companyOf(row),amount=num(row.amount),used=taken.get(company);
        if(used!==undefined&&!free&&((typeof F.remaining==='function'?F.remaining(s,company):Infinity)!==Infinity||num(F.operating?.(s,company))<used+amount+.005))continue;
        taken.set(company,(used||0)+amount);take.push(row);}
      if(!take.length)return null;
      return {kind,keys:take.map(row=>`${kind}:${row.id}`),count:take.length,commands:take.map(row=>({domain:'finance',name:'settle-cheque',payload:{id:String(row.id)}}))};
    }
    return null;
  }
  // Plan batch 3: the standing campaigns. Each company whose campaign keeps running (advanced.companies[id].campaignStanding)
  // launches its company-wide campaign again through its own command once branches have ended theirs, with a reference of
  // the day and the quote (the owner's idempotency); a company the cash does not cover waits for the next day.
  const CAMPAIGN_OWNERS=Object.freeze({bank:['GH_BANKING_CORE','banking','branch-campaigns'],insurance:['GH_INSURANCE_CORE','insurance','office-campaigns'],telecom:['GH_TELECOM_MARKET','customer-companies','telecom-branches-campaign'],dealership:['GH_DEALER_MARKET','customer-companies','dealership-showrooms-campaign']});
  function campaignStep(s,kind,tried,covers){
    const rows=s?.advanced?.companies||{},opened=new Set(list(s?.openedCompanies)),hotels=new Set(Object.keys(s?.hospitality?.companies||{}));
    for(const company of Object.keys(rows).sort()){
      if(rows[company]?.campaignStanding!==true||!opened.has(company))continue;const key=`${kind}:${company}`;if(tried.has(key))continue;tried.add(key);
      const owner=CAMPAIGN_OWNERS[company]||(hotels.has(company)?['GH_HOSPITALITY_CORE','hospitality','company-campaign']:null),core=owner?globalThis[owner[0]]:null;if(typeof core?.campaignQuote!=='function')continue;
      // Review round 7 (a reader: the autopilot's commands are the system's, so the level lock the player's own button
      // meets was never checked here): a campaign whose command is still locked by the level waits, as continuation does.
      if(globalThis.GH_PROGRESSION_CORE?.unlocked?.(s,`command:${owner[1]}:${owner[2]}`)===false)continue;
      let plan=null;try{plan=owner[2]==='company-campaign'?core.campaignQuote(s,company):core.campaignQuote(s);}catch(_error){continue;}
      if(!plan?.count||!covers(company,num(plan.total)))continue;
      const reference=`AUTO-CAMPAIGN-${company}-${plan.day}-${String(plan.quoteKey).slice(0,24)}`;
      return {kind,company,keys:[key],commands:[{domain:owner[1],name:owner[2],payload:{company,companyId:company,reference,quoteKey:plan.quoteKey}}]};
    }
    return null;
  }
  // Plan batch 3: pay that follows the market (labor salaryPolicy[company].followMarket): one raise a company a step, to the
  // level GH_HR_CORE.marketSalaryLevel names (none while the pay is at or above the market).
  function salaryStep(s,kind,tried){
    const H=globalThis.GH_HR_CORE,policies=s?.advanced?.labor?.salaryPolicy||{};if(typeof H?.marketSalaryLevel!=='function')return null;
    for(const company of Object.keys(policies).sort()){if(policies[company]?.followMarket!==true)continue;const key=`${kind}:${company}`;if(tried.has(key))continue;tried.add(key);
      let index=null;try{index=H.marketSalaryLevel(s,company);}catch(_error){index=null;}if(!index)continue;
      return {kind,company,keys:[key],index,commands:[{domain:'hr',name:'set-salary-index',payload:{company,index}}]};}
    return null;
  }
  // Plan batch 3: research and renewals that continue (advanced.continuation): the next phase of a project already under
  // way, the cyber drill when cover is below 60% (30 days apart), the safety audit when its plan has ended; each paid by
  // the holding when its cash covers it, one a step.
  const CYBER_RENEW_BELOW=60,CYBER_RENEW_DAYS=30,SAFETY_AUDIT_COST=500000;
  function continuationStep(s,kind,tried,covers){
    if(s?.advanced?.continuation!==true)return null;const G=globalThis.GH_GOVERNANCE_CORE;if(!G)return null;const day=dayOf(s),take=(key,cost,command)=>{if(tried.has(key))return null;tried.add(key);if(globalThis.GH_PROGRESSION_CORE?.unlocked?.(s,`command:${command.domain}:${command.name}`)===false)return null;if(!covers('group',cost))return null;return {kind,keys:[key],commands:[command]};};
    for(const id of Object.keys(s.advanced.researchPrograms||{}).sort()){const meta=s.advanced.researchPrograms[id];if(!meta||meta.phase||!(num(meta.rounds)>0)||num(s.research?.[id])>=100)continue;let cost=0;try{cost=num(G.researchPhaseCost(s));}catch(_error){continue;}const out=take(`${kind}:research:${id}`,cost,{domain:'governance',name:'research-fund',payload:{project:id}});if(out)return out;}
    const cyber=s.advanced.cyber;if(cyber&&Number.isFinite(Number(cyber.lastDrillDay))&&num(cyber.coverage)<CYBER_RENEW_BELOW&&day-Number(cyber.lastDrillDay)>=CYBER_RENEW_DAYS){const out=take(`${kind}:cyber`,num(G.CYBER_DRILL_COST)||650000,{domain:'governance',name:'cyber-drill',payload:{}});if(out)return out;}
    const plan=s.advanced.safety?.plan;if(plan&&Number.isFinite(Number(plan.untilDay))&&day>=Number(plan.untilDay)){const out=take(`${kind}:safety`,SAFETY_AUDIT_COST,{domain:'governance',name:'safety-audit',payload:{cost:SAFETY_AUDIT_COST}});if(out)return out;}
    return null;
  }
  // Plan batch 3: the bank's housekeeping (bank.housekeeping): the corporate credit limits reviewed every 30 days.
  function housekeepingStep(s,kind,tried){const B=globalThis.GH_BANKING_CORE,key=`${kind}:bank`;if(tried.has(key)||!list(s?.openedCompanies).includes('bank')||typeof B?.limitsReviewDue!=='function'||!B.limitsReviewDue(s))return null;tried.add(key);return {kind,company:'bank',keys:[key],commands:[{domain:'banking',name:'review-limits',payload:{}}]};}
  // Plan batch 3: hotel maintenance by policy (hospitality.companies[id].repairPolicy): one property a step, on an
  // incident or below the policy's condition, at the quote repair-property charges, when the company's cash covers it.
  function repairStep(s,kind,tried,covers){
    const H=globalThis.GH_HOSPITALITY_CORE;if(typeof H?.repairDue!=='function')return null;const opened=new Set(list(s?.openedCompanies));
    for(const id of Object.keys(s?.hospitality?.companies||{}).sort()){const root=s.hospitality.companies[id],policy=root?.repairPolicy;if(!policy||!opened.has(id))continue;
      for(const property of list(root.properties)){if(!H.repairDue(property,policy))continue;const key=`${kind}:${id}:${property.id}`;if(tried.has(key))continue;tried.add(key);const cost=num(H.repairCost(property));if(!covers(id,cost))continue;
        return {kind,company:id,keys:[key],commands:[{domain:'hospitality',name:'repair-property',payload:{companyId:id,propertyId:property.id,expectedCost:cost}}]};}}
    return null;
  }
  // Review round 5 (a reader: the close cashes the cheques due the next day before the autopilot runs again, so a cheque
  // dated tomorrow bounced): the cheques kept back and funded are those due today or tomorrow; a returned cheque with no
  // payable behind it is kept back too (one with a payable is the payable's, paid by transfer).
  // What a policy may spend (review round 4: the policies kept back only the cheques due today; research spent the cash a
  // due bill needed): the company's cash less everything due today that is still unpaid (issued cheques, VAT, payables
  // without a cheque pending), less its saved minimum operating cash (and, for the bank, its liquidity floor), and within
  // the month's budget and the line the command charges (the owners refuse past them: the step was refused every day).
  function spendable(s,F,line){
    if(F.investorMode?.(s)===true)return ()=>true;const names=new Map(),name=company=>{let id=names.get(company);if(id===undefined){id=F.requireCompany?F.requireCompany(s,company):company;names.set(company,id);}return id;},day=dayOf(s);let held=null;
    const hold=()=>{held=new Map();const add=(company,amount)=>{if(amount>0){const id=name(String(company||'group'));held.set(id,(held.get(id)||0)+amount);}},pending=new Set();
      for(const row of list(s?.finance?.cheques)){if(row?.status==='صادر'){if(row.invoiceNumber)pending.add(String(row.invoiceNumber));if(num(row.dueDay)<=day+1)add(row.company,num(row.amount));}else if(row?.status==='مرتجع'&&!row.invoiceNumber)add(row.company,num(row.amount));}
      for(const row of list(s?.finance?.periods))if(row?.status==='مستحق')add(row.company,num(row.amount));
      for(const row of list(s?.finance?.payables))if(row?.number&&row.autoSettle!==true&&due(row,day)&&!pending.has(String(row.number)))add(row.company,num(row.total??row.amount));};
    return (company,amount)=>{if(!held)hold();const id=name(company),floor=Math.max(0,num(s?.finance?.centralTreasury?.minOperatingCash?.[id]))+(id==='bank'&&s?.bank&&typeof globalThis.GH_BANKING_CORE?.liquidityFloor==='function'?num(globalThis.GH_BANKING_CORE.liquidityFloor(s.bank)):0);
      if(num(F.operating?.(s,id))-(held.get(id)||0)-floor<amount)return false;
      if(typeof F.remaining==='function'&&F.remaining(s,id)<amount)return false;if(line&&typeof F.lineRemaining==='function'&&F.lineRemaining(s,id,line)<amount)return false;return true;};
  }
  function next(s,kind,{tried=new Set(),F=globalThis.GH_FINANCE_CORE}={}){
    if(kind==='housekeeping')return housekeepingStep(s,kind,tried);
    if(kind==='salaries')return salaryStep(s,kind,tried);
    if(['insurance','realestate','telecom','bank','hospitality'].includes(kind))return decisionStep(s,kind,tried);
    if(!F)return null;
    if(kind==='repairs')return repairStep(s,kind,tried,spendable(s,F,'other'));
    if(kind==='continuation')return continuationStep(s,kind,tried,spendable(s,F,'other'));
    if(kind==='campaigns')return campaignStep(s,kind,tried,spendable(s,F,'marketing'));
    return financeStep(s,kind,tried,F);
  }
  return Object.freeze({VERSION,ACTOR,BATCH_LIMIT,ROW_LIMIT,MIN_RENT_LEVEL,GRADES,STANCE_LIMIT,KINDS,bankStance,loanApproved,next});
});
