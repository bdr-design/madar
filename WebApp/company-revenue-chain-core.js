// Build 373 · مدار (owner's approved design): the revenue chain of a company that owns no transport assets. Five steps
// in the order the game earns that company's money, where the player stands on them, the one next step, and the
// decisions waiting for the player. Read-only: it reads the owners' own records (insurance, realEstate, bank and the
// customer-companies snapshot the panels already read), never calls their ensure() (which normalises state) and never
// passes over the fleet. Every target it names is an existing page; every decision is decided by an existing command.
(()=>{
  'use strict';
  const VERSION='1.0.0',KINDS=Object.freeze(['insurance','realestate','telecom','dealership','bank']),MAX_DECISIONS=5,DAY=86400;
  const arr=value=>Array.isArray(value)?value.filter(Boolean):[];
  const obj=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
  const num=value=>{const n=Number(value);return Number.isFinite(n)?n:0;};
  const today=state=>Math.floor(num(state?.simSeconds)/DAY);
  const daysLeft=(state,row)=>Math.max(0,num(row?.expiresDay)-today(state));
  const step=(key,label,value,done)=>({key,label,value,done:!!done});
  const money=amount=>({money:num(amount)}),count=amount=>({count:num(amount)}),text=value=>({text:String(value)}),pct=value=>({pct:num(value)});
  // The real-estate construction milestones (realestate-core MILESTONES): 40% with the land, 30% at half time, 30% at completion.
  const MILESTONES=Object.freeze([.4,.3,.3]);

  function insurance(state,id,env){
    const ins=obj(state?.insurance),offices=arr(ins.offices),active=offices.filter(row=>row.active).length,pricing=obj(ins.pricing);
    let policies=0;for(const office of offices)for(const line of Object.values(obj(office.lines)))policies+=num(line?.policies);
    const levels=Object.values(pricing).map(Number).filter(Number.isFinite),level=levels.length?levels.reduce((a,b)=>a+b,0)/levels.length:1;
    const last=arr(ins.dailyHistory)[0]||null,risks=arr(ins.riskRequests);
    const steps=[step('offices','المكاتب',count(active),active>0),step('pricing','التسعير',text(`${Math.round(level*100)}%`),active>0),step('policies','الوثائق',count(policies),policies>0),step('premium','أقساط آخر يوم',money(last?.premium),!!last&&num(last.premium)>0),step('net','صافي الاكتتاب',money(last?.net),!!last)];
    let next;
    if(!active)next={text:'افتح أول مكتب في عاصمة من الدليل. المكتب يبيع أربعة خطوط تأمين لسكان بلده: المركبات والصحة والمنازل والتجاري.',label:'فتح مكتب',panel:'insurance',arg:{tab:'offices'}};
    else if(risks.length)next={text:`${risks.length} ${risks.length===1?'خطر تجاري كبير ينتظر':'مخاطر تجارية كبيرة تنتظر'} قرارك، وتسقط عند انتهاء مهلتها.`,label:'تفاصيل المخاطر',panel:'insurance',arg:{tab:'overview'}};
    else if(!policies)next={text:'الوثائق تبدأ بالدخول مع الإقفال اليومي القادم، وأسرع كلما كان السعر تحت السوق.',label:'التسعير',panel:'insurance',arg:{tab:'lines'}};
    else if(last&&num(last.net)<0)next={text:'صافي الاكتتاب سالب: المطالبات والعمولات أكبر من الأقساط. راجع التسعير وإعادة التأمين.',label:'التسعير',panel:'insurance',arg:{tab:'lines'}};
    else next={text:'كل مكتب في عاصمة أخرى يفتح سوقًا جديدًا للوثائق.',label:'المكاتب',panel:'insurance',arg:{tab:'offices'}};
    const decisions=risks.slice(0,MAX_DECISIONS).map(row=>({id:String(row.id),title:String(row.subject||row.id),detail:{premium:num(row.premium),expectedLoss:num(row.expectedLoss)},daysLeft:daysLeft(state,row)}));
    return {steps,next,decisions,batch:'insurance'};
  }

  function realestate(state,id,env){
    const re=obj(state?.realEstate),offices=arr(re.offices).filter(row=>row.active).length,projects=arr(re.projects),building=projects.filter(row=>row.status==='قيد الإنشاء'),completed=projects.filter(row=>row.status==='مكتمل').length;
    const placed=projects.reduce((sum,row)=>sum+num(row.sold)+num(row.presold)+num(row.leased),0),history=arr(re.dailyHistory),last=history[0]||null,earned=history.slice(0,30).some(row=>num(row.revenue)>0),requests=arr(re.tenantRequests);
    const steps=[step('offices','المكاتب',count(offices),offices>0),step('projects','المشاريع',count(projects.length),projects.length>0),step('build','البناء',building.length?text(`${building.length} قيد الإنشاء`):count(completed),completed>0),step('placed','بيع وتأجير',count(placed),placed>0),step('revenue','إيراد آخر يوم',money(last?.revenue),earned)];
    const cash=num(env?.operating?.(id));let blocked=null;
    for(const project of building){const paid=num(project.milestonesPaid);if(paid<1||paid>2)continue;const amount=num(project.buildCost)*MILESTONES[paid];if(amount>cash&&(!blocked||amount>blocked.amount))blocked={name:String(project.name||project.id),amount};}
    let next;
    if(!offices)next={text:'افتح أول مكتب مبيعات وتأجير في عاصمة من الدليل؛ المكتب يطوّر المشاريع في مدينته.',label:'فتح مكتب',panel:'companyFacilities',arg:id};
    else if(!projects.length)next={text:'طوّر أول مشروع: المدينة والنوع والحجم، للبيع أو للتأجير.',label:'تطوير مشروع',panel:'realestate',arg:{tab:'develop'}};
    else if(blocked)next={text:`الدفعة التالية لمقاول ${blocked.name} أكبر من سيولة الشركة؛ عند استحقاقها ينتظر المشروع يومًا بعد يوم.`,amount:blocked.amount,label:'تحويل تمويل',panel:'finance',arg:'transfers'};
    else if(requests.length)next={text:`${requests.length} ${requests.length===1?'طلب إيجار من شركة ينتظر':'طلبات إيجار من شركات تنتظر'} قرارك.`,label:'تفاصيل الطلبات',panel:'realestate',arg:{tab:'overview'}};
    else next={text:'المشاريع المكتملة تبيع وتؤجر يومًا بيوم؛ مشروع جديد يضيف وحدات للسوق.',label:'المشاريع',panel:'realestate',arg:{tab:'projects'}};
    const decisions=requests.slice(0,MAX_DECISIONS).map(row=>({id:String(row.id),title:`${row.tenant||'مستأجر'} · ${num(row.units)} وحدة في ${row.projectName||'مشروع'}`,detail:{annualRent:num(row.annualRent),years:num(row.years)},daysLeft:daysLeft(state,row)}));
    return {steps,next,decisions,batch:'realestate'};
  }

  function customerRow(state,id){
    try{const snapshot=globalThis.GH_CUSTOMER_COMPANIES_CORE?.snapshot?.(state,id);return obj(snapshot?.[id]||snapshot);}catch(_error){return {};}
  }

  function telecom(state,id,env){
    const row=customerRow(state,id),branches=num(row.branchCount),customers=num(row.customerCount),billed=num(row.monthlyBilled),collected=num(row.monthlyCollected),outstanding=num(row.outstanding),plans=Object.keys(obj(globalThis.GH_CUSTOMER_COMPANIES_CORE?.PLANS)).length;
    const steps=[step('branches','الفروع',count(branches),branches>0),step('plans','الباقات',count(plans),branches>0),step('customers','العملاء',count(customers),customers>0),step('billed','فاتورة الشهر',money(billed),billed>0),step('collected','المحصّل',pct(billed?collected/billed*100:0),collected>0)];
    let next;
    if(!branches)next={text:'افتح أول فرع من دليل المدن؛ الفرع يخدم المشتركين ويصدر فواتيرهم.',label:'فتح فرع',panel:'companyFacilities',arg:id};
    else if(!customers)next={text:'أضف أول مشترك أو شريحة سوق؛ كل شريحة تُفوتر شهريًا بفاتورة واحدة.',label:'إضافة مشتركين',panel:'companyManage',arg:{type:id,tab:'operations'}};
    else if(outstanding>0)next={text:'ذمم من فواتير الاشتراكات لم تُحصّل بعد.',amount:outstanding,label:'المستندات',panel:'invoices',arg:{company:id,tab:'overview'}};
    else next={text:'كل شريحة جديدة تضيف فاتورة شهرية؛ باقة الأعمال أعلى قيمة من الباقات الفردية.',label:'إضافة شريحة',panel:'companyManage',arg:{type:id,tab:'operations'}};
    return {steps,next,decisions:[],batch:null};
  }

  function bankRequests(state,filter){return arr(obj(state?.bank).loanRequests).filter(filter);}
  function loanDecision(state,row){return {id:String(row.id),title:String(row.borrower||row.id),detail:{amount:num(row.amount),grade:String(row.riskGrade||'')},daysLeft:daysLeft(state,row)};}

  function dealership(state,id,env){
    const row=customerRow(state,id),branches=num(row.branchCount),suppliers=arr(row.suppliers),agreed=suppliers.filter(supplier=>supplier.agreement).length,inventory=num(row.inventoryUnits),sold=num(row.completedSales),pending=num(row.pendingSales);
    const requests=bankRequests(state,request=>request.sourceCompanyId==='dealership');
    const steps=[step('branches','المعارض',count(branches),branches>0),step('suppliers','المصنّعون',text(`${agreed}/${suppliers.length}`),suppliers.length>0&&agreed===suppliers.length),step('inventory','المخزون',count(inventory),inventory>0),step('sales','المبيعات',count(sold),sold>0),step('settle','بانتظار التسوية',count(pending),sold>0&&pending===0)];
    let next;
    if(!branches)next={text:'افتح أول معرض من دليل المدن؛ المعرض يبيع السيارات ويخدمها بعد البيع.',label:'فتح معرض',panel:'companyFacilities',arg:id};
    else if(suppliers.length&&agreed<suppliers.length)next={text:'سجّل اتفاقيات التوريد مع المصنّعين قبل أول طلب شراء.',label:'اتفاقيات المصنّعين',panel:'companyManage',arg:{type:id,tab:'operations'}};
    else if(!inventory&&!sold)next={text:'اشترِ أول مخزون من المصنّع: طلب شراء وفاتورة مورد وشيك.',label:'شراء مخزون',panel:'companyManage',arg:{type:id,tab:'operations'}};
    else if(requests.length)next={text:`${requests.length} ${requests.length===1?'طلب تمويل لعميل ينتظر':'طلبات تمويل لعملاء تنتظر'} قرار بنك المجموعة؛ البيع لا يُسوّى قبلها.`,label:'تفاصيل التمويل',panel:'companyManage',arg:{type:id,tab:'operations'}};
    else if(pending)next={text:'مبيعات بالتمويل جاهزة للتسوية بعد إثبات تحويل البنك.',label:'تسوية المبيعات',panel:'companyManage',arg:{type:id,tab:'operations'}};
    else next={text:'بيع جديد نقدًا أو بتمويل من بنك المجموعة، وخطط صيانة شهرية بعد البيع.',label:'المبيعات',panel:'companyManage',arg:{type:id,tab:'operations'}};
    return {steps,next,decisions:requests.slice(0,MAX_DECISIONS).map(request=>loanDecision(state,request)),batch:'dealership'};
  }

  function bank(state,id,env){
    const b=obj(state?.bank),branches=arr(b.branchNetwork).filter(row=>row.servicesActive).length,deposits=num(b.deposits),loans=num(b.loans),requests=bankRequests(state,()=>true),daily=arr(b.dailyHistory)[0]||null,policy=obj(b.riskPolicy);
    const income=num(daily?.interestIncome)+num(daily?.reportedFeeIncome??daily?.feeIncome);
    const within=(value,limit,above)=>!Number.isFinite(Number(value))||!Number.isFinite(Number(limit))||(above?Number(value)>=Number(limit):Number(value)<=Number(limit));
    const safe=within(b.lcr,policy.minLcr,true)&&within(b.cet1,policy.minCet1,true)&&within(b.loanDepositRatio,policy.maxLdr,false);
    const steps=[step('branches','الفروع',count(branches),branches>0),step('deposits','الودائع',money(deposits),deposits>0),step('credit','قرار القروض',requests.length?text(`${requests.length} ${requests.length===1?'طلب':'طلبات'}`):money(loans),!requests.length&&loans>0),step('income','فوائد ورسوم آخر يوم',money(income),income>0),step('safety','السلامة',text(safe?'ضمن الحدود':'خارج الحدود'),safe&&branches>0)];
    let next;
    if(!branches)next={text:'افتح أول فرع؛ الفروع تجمع الودائع التي تموّل القروض.',label:'الفروع',panel:'bank',arg:{tab:'branches'}};
    else if(requests.length){const left=Math.min(...requests.map(row=>daysLeft(state,row)));next={text:`${requests.length} ${requests.length===1?'طلب تمويل ينتظر':'طلبات تمويل تنتظر'} قرارك؛ أقربها يسقط بعد ${left} ${left===1?'يوم':'أيام'}.`,label:'الائتمان',panel:'bank',arg:{tab:'credit'}};}
    else if(!safe)next={text:'مؤشر سلامة خارج حدوده؛ راجع السيولة والمخاطر قبل منح قروض جديدة.',label:'السيولة والمخاطر',panel:'bank',arg:{tab:'control'}};
    else next={text:'كل قرض جديد يرفع دخل الفوائد ضمن حدود السيولة ورأس المال.',label:'الائتمان',panel:'bank',arg:{tab:'credit'}};
    return {steps,next,decisions:requests.slice(0,MAX_DECISIONS).map(request=>loanDecision(state,request)),batch:'bank'};
  }

  const BUILDERS=Object.freeze({insurance,realestate,telecom,dealership,bank});
  // env: {operating(companyId) -> the company's operating cash}. Returns null for a kind without a chain.
  function build(state,id,kind,env={}){
    const builder=BUILDERS[kind];if(!builder)return null;
    const chain=builder(state,String(id||kind),env),current=chain.steps.findIndex(row=>!row.done);
    return {...chain,kind,current};
  }
  const API=Object.freeze({VERSION,KINDS,MAX_DECISIONS,build});
  globalThis.GH_REVENUE_CHAIN=API;
  if(globalThis.window&&globalThis.window!==globalThis)globalThis.window.GH_REVENUE_CHAIN=API;
  if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
