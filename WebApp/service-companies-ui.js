(()=>{
  'use strict';
  // Build 97: the page of the four service companies (service-companies-core). It reads one summary per render (one pass
  // over the company's own facilities) and writes only through the signed 'services' domain command.
  const TITLES=Object.freeze({media:'الإنتاج الإعلامي',healthcare:'الرعاية الصحية',education:'التعليم',sports:'النادي الرياضي'});
  const NOTES=Object.freeze({
    media:'كل استوديو ينتج حتى 6 مشاريع شهريًا بنحو ⁦$2M⁩ عند الاستغلال الكامل؛ 75% من الإيراد أجور فرق وحقوق ومعدات.',
    healthcare:'كل مستشفى 150 سريرًا بإيراد 1,100 دولار لليوم السريري و400 مراجعة يوميًا بـ90 دولارًا؛ 60% من الإيراد أطباء وتمريض ومستلزمات. معفاة من ضريبة القيمة المضافة.',
    education:'كل مدرسة 1,200 مقعد برسوم 12,000 دولار سنويًا تُكتسب يوميًا؛ 50% معلمون ومواد، و2% رسوم متعثرة. معفاة من ضريبة القيمة المضافة.',
    sports:'كل ملعب 25 ألف مقعد: مباراتان على أرضه شهريًا بتذكرة 28 دولارًا، و8,000 عضو بـ40 دولارًا شهريًا، و1.2 مليون شهريًا بث ورعاية؛ 62% أجور لاعبين وتشغيل.'
  });
  // A short line under the page's heading: how the company collects, and its VAT treatment.
  const SUBTITLES=Object.freeze({media:'إيراد المشاريع يُحصَّل مع الإقفال اليومي · خاضع لضريبة القيمة المضافة',healthcare:'إيراد الأسرّة والمراجعات يُحصَّل مع الإقفال اليومي · معفاة من الضريبة',education:'الرسوم تُكتسب يوميًا وتُحصَّل مع الإقفال · معفاة من الضريبة',sports:'التذاكر والعضويات والبث تُحصَّل مع الإقفال اليومي · خاضع للضريبة'});
  const pct=v=>`${Math.round(Number(v||0)*1000)/10}%`;
  // The page in the app's own components: a section heading, six figures in two columns (label above value), the price
  // level as a choice (the current one primary), the facilities, then the notes.
  function render(panel,arg,ctx,{action}){
    if(panel!=='serviceCompany')return null;
    const S=globalThis.GH_SERVICE_COMPANIES_CORE,companyId=String(typeof arg==='string'?arg:arg?.company||'');
    if(globalThis.GH_COMPANY_PLATFORM?.resolveCompany?.(ctx.state,companyId)?.operational!==true)return '<div class="empty">أسّس الشركة أولًا.</div><button class="secondary-btn" data-go="companies" data-go-arg="&quot;subs&quot;">فتح الشركات</button>';
    const v=S?.summary(ctx.state,companyId);if(!v)return '<div class="empty">هذه الشركة لا تعمل بمحرك الخدمات.</div>';
    const esc=ctx.esc,money=ctx.fmtMoney,sector=S.SECTORS[v.sector],levels=v.levels.map(l=>action('service-price-level',l.label,`data-company="${esc(companyId)}" data-level="${esc(l.id)}"`,l.id!==v.priceLevel)).join('');
    const average=v.facilities.length?v.facilities.reduce((a,f)=>a+f.u,0)/v.facilities.length:0,measure=sector?.measure?.(average)?.label||'الاستغلال';
    const facts=[['إيراد اليوم (تقديري)',money(v.today.revenue)],['تكلفة مباشرة اليوم',money(v.today.expense)],['إيراد آخر 30 يومًا',money(v.revenue30)],['تكلفة مباشرة آخر 30 يومًا',money(v.expense30)],[`متوسط ${measure}`,v.facilities.length?pct(average):'—'],['المنشآت العاملة',ctx.fmtNumber(v.facilities.length)]];
    const place=f=>String(f.name||'').includes(f.city)?f.country:[f.city,f.country].filter(Boolean).join(' · ');
    const facilities=v.facilities.length?v.facilities.map(f=>`<article class="list-item"><div class="list-item-head"><div><h3>${esc(f.name)}</h3><p>${esc(place(f))}</p></div><b>${esc(money(f.revenue))}</b></div><p class="section-mini">${esc(f.measure.label)} ${esc(pct(f.measure.value))} · ${esc(f.measure.detail)}</p></article>`).join(''):'<div class="empty">لا منشآت بعد. افتح منشأة من دليل المدن لتبدأ الشركة التشغيل والتحصيل.</div>';
    const badDebt=v.sector==='education'?` المتعثر في آخر 30 يومًا <bdi dir="ltr">${esc(money(v.badDebt30))}</bdi>.`:'';
    return `<div class="list"><div class="section-heading"><h3>${esc(TITLES[v.sector]||'')} · التشغيل</h3><p>${esc(SUBTITLES[v.sector]||'')}</p></div>
      <div class="metric-row">${facts.map(([k,val])=>`<div><span>${esc(k)}</span><b>${esc(val)}</b></div>`).join('')}</div>
      <article class="list-item"><h3>مستوى الأسعار</h3><p class="section-mini">السعر المنافس يرفع الاستغلال 6 نقاط ويخفض السعر 8%، والمرتفع عكسه.</p><div class="action-row">${levels}</div></article>
      <div class="section-heading"><h3>المنشآت العاملة</h3><p>إيراد اليوم التقديري لكل منشأة</p></div>${facilities}
      <p class="section-mini">${esc(NOTES[v.sector]||'')}${badDebt} تُضاف تكلفة تشغيل المنشأة اليومية والكهرباء من شركة الطاقة والرواتب عبر الإقفال اليومي.</p>
      <div class="action-row"><button class="secondary-btn" data-go="companyFacilities" data-go-arg="${esc(JSON.stringify(companyId))}">فتح منشأة من دليل المدن</button></div></div>`;
  }
  async function handleAction(btn,ctx,{signedDomainCommand}){
    const id=String(btn.dataset.ghAction||'');if(id!=='service-price-level')return false;
    const companyId=String(btn.dataset.company||''),level=String(btn.dataset.level||'');
    await signedDomainCommand(ctx,'services','set-price-level',{companyId,level},{idempotencyKey:`services:price:${companyId}:${level}:${Math.floor((Number(ctx.state.simSeconds)||0)/86400)}`,subjectId:companyId});
    ctx.openDrawer(ctx.currentPanel,ctx.currentArg);return true;
  }
  globalThis.GH_SERVICE_COMPANIES_UI=Object.freeze({TITLES,render,handleAction});
})();
