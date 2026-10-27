(()=>{
  'use strict';
  // Build 97: the page of the four service companies (service-companies-core). It reads one summary per render (one pass
  // over the company's own facilities) and writes only through the signed 'services' domain command.
  const TITLES=Object.freeze({media:'الإنتاج الإعلامي',healthcare:'الرعاية الصحية',education:'التعليم',sports:'النادي الرياضي'});
  const NOTES=Object.freeze({
    media:'كل استوديو ينتج حتى 6 مشاريع شهريًا بنحو 2 مليون دولار عند الاستغلال الكامل؛ 75% من الإيراد أجور فرق وحقوق ومعدات.',
    healthcare:'كل مستشفى 150 سريرًا بإيراد 1,100 دولار لليوم السريري و400 مراجعة يوميًا بـ90 دولارًا؛ 60% من الإيراد أطباء وتمريض ومستلزمات. معفاة من ضريبة القيمة المضافة.',
    education:'كل مدرسة 1,200 مقعد برسوم 12,000 دولار سنويًا تُكتسب يوميًا؛ 50% معلمون ومواد، و2% رسوم متعثرة. معفاة من ضريبة القيمة المضافة.',
    sports:'كل ملعب 25 ألف مقعد: مباراتان على أرضه شهريًا بتذكرة 28 دولارًا، و8,000 عضو بـ40 دولارًا شهريًا، و1.2 مليون شهريًا بث ورعاية؛ 62% أجور لاعبين وتشغيل.'
  });
  const pct=v=>`${Math.round(Number(v||0)*1000)/10}%`;
  function render(panel,arg,ctx,{action}){
    if(panel!=='serviceCompany')return null;
    const S=globalThis.GH_SERVICE_COMPANIES_CORE,companyId=String(typeof arg==='string'?arg:arg?.company||'');
    if(globalThis.GH_COMPANY_PLATFORM?.resolveCompany?.(ctx.state,companyId)?.operational!==true)return '<div class="empty">أسّس الشركة أولًا.</div><button class="secondary-btn" data-go="companies" data-go-arg="&quot;subs&quot;">فتح الشركات</button>';
    const v=S?.summary(ctx.state,companyId);if(!v)return '<div class="empty">هذه الشركة لا تعمل بمحرك الخدمات.</div>';
    const esc=ctx.esc,money=ctx.fmtMoney,levels=v.levels.map(l=>action('service-price-level',`${l.label}${l.id===v.priceLevel?' ✓':''}`,`data-company="${esc(companyId)}" data-level="${esc(l.id)}"`)).join('');
    const facilities=v.facilities.length?v.facilities.map(f=>`<article class="list-item"><div class="list-item-head"><div><h3>${esc(f.name)}</h3><p>${esc(f.city)} · ${esc(f.country)}</p></div><b>${esc(money(f.revenue))}</b></div><p class="section-mini">${esc(f.measure.label)} ${esc(pct(f.measure.value))} · ${esc(f.measure.detail)}</p></article>`).join(''):'<div class="empty">لا منشآت بعد. افتح منشأة من دليل المدن لتبدأ الشركة التشغيل والتحصيل.</div>';
    const facts=[['إيراد اليوم (تقديري)',money(v.today.revenue)],['تكلفة مباشرة اليوم',money(v.today.expense)],['إيراد آخر 30 يومًا',money(v.revenue30)],['تكلفة مباشرة آخر 30 يومًا',money(v.expense30)],['متعثر آخر 30 يومًا',money(v.badDebt30)],['المنشآت العاملة',ctx.fmtNumber(v.facilities.length)]];
    return `<div class="list"><article class="list-item"><h3>${esc(TITLES[v.sector]||'')} · التشغيل</h3><div class="metric-grid">${facts.map(([k,val])=>`<div class="metric"><small>${esc(k)}</small><b>${esc(val)}</b></div>`).join('')}</div><p class="section-mini">${esc(NOTES[v.sector]||'')} تُضاف تكلفة تشغيل المنشأة اليومية والكهرباء من شركة الطاقة والرواتب عبر الإقفال اليومي.</p></article>
      <article class="list-item"><h3>مستوى الأسعار</h3><p class="section-mini">السعر المنافس يرفع الاستغلال 6 نقاط ويخفض السعر 8%؛ المرتفع عكسه.</p><div class="action-row">${levels}</div></article>
      ${facilities}<div class="action-row"><button class="secondary-btn" data-go="companyFacilities" data-go-arg="${esc(JSON.stringify(companyId))}">فتح منشأة من دليل المدن</button></div></div>`;
  }
  async function handleAction(btn,ctx,{signedDomainCommand}){
    const id=String(btn.dataset.ghAction||'');if(id!=='service-price-level')return false;
    const companyId=String(btn.dataset.company||''),level=String(btn.dataset.level||'');
    await signedDomainCommand(ctx,'services','set-price-level',{companyId,level},{idempotencyKey:`services:price:${companyId}:${level}:${Math.floor((Number(ctx.state.simSeconds)||0)/86400)}`,subjectId:companyId});
    ctx.openDrawer(ctx.currentPanel,ctx.currentArg);return true;
  }
  globalThis.GH_SERVICE_COMPANIES_UI=Object.freeze({TITLES,render,handleAction});
})();
