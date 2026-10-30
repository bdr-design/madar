// Owner (approved consent screen «اعتمدت هذا», أصول ونفوذ · ASSETS & INFLUENCE; the doc «سياسة الخصوصية وشروط الاستخدام»): the privacy
// policy and the terms of use the player accepts once before founding the group, and a save that has not accepted this
// version once after an update (its game is kept). Both texts read in full inside the game without the internet: from the
// consent, from «الحفظ والإعدادات» and from the store, beside the subscription terms. Nothing here runs in the game loop:
// the screens are built when opened. The acceptance (the version of the texts) is written in the save by the caller: in
// the founding command for a new group, in its own durable command for a founded save.
(function(root,factory){const api=factory();if(root)root.GH_LEGAL=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  // A change of either text that the player must accept again changes VERSION (and UPDATED).
  const VERSION='2026-10-30',UPDATED='30 أكتوبر 2026';
  // Filled by the owner before publishing (the published pages carry the same text).
  const PUBLISHER=Object.freeze({name:'[اسم الناشر]',country:'[الدولة]',email:'[البريد]'});
  const P=PUBLISHER;
  // Blocks: [h, text] heading, [p, text] paragraph, [ul, [items]] list, [table, [head], [[row]...]] table.
  const PRIVACY=Object.freeze([
    ['p','أصول ونفوذ لا تجمع بياناتك الشخصية ولا ترسلها إلينا. تُحفظ لعبتك على جهازك فقط، لا حسابات ولا إعلانات ولا تتبّع. تشرح هذه السياسة ما يحدث لبيانات اللعبة والخدمات القليلة التي تتصل بها.'],
    ['h','من نحن'],['p',`تُنشر أصول ونفوذ من ${P.name}، ${P.country}. للتواصل: ${P.email}.`],
    ['h','ما لا نجمعه'],['ul',['لا اسم ولا بريد ولا رقم هاتف ولا موقع جغرافي ولا جهات اتصال.','لا معرّفات إعلانية، ولا تحليلات استخدام، ولا أدوات تتبّع من أطراف ثالثة.','لا نبيع أي بيانات ولا نشاركها.']],
    ['h','بيانات اللعبة على جهازك'],['ul',['تُحفظ اللعبة (شركاتك وأصولك ومالك الافتراضي، واسم المجموعة والتوقيع اللذين تدخلهما في اللعبة) داخل التطبيق على جهازك فقط، مشفّرة بمفتاح خاص بالجهاز.','لا تُرفع إلى أي خادم. حذف التطبيق يحذفها من الجهاز.','نسخة الحفظ الاحتياطية و«الإبلاغ عن مشكلة» ينشئان ملفًا على جهازك، ولا يُرسل إلا إذا اخترت أنت مشاركته. يحتوي بيانات اللعبة ومعلومات تقنية عن الجهاز (نظام التشغيل، اللغة، وضع الطاقة والحرارة).','للحماية من الغش، تفحص اللعبة على الجهاز نفسه ما إذا كان نظامه معدّلًا. لا تُرسل نتيجة الفحص إلى أي مكان.']],
    ['h','المشتريات'],['p','تتم المشتريات والاشتراكات عبر App Store أو Google Play وحدهما. لا نرى بيانات الدفع أبدًا. تتلقى اللعبة من المتجر رقم العملية والمنتج وتاريخها فقط، لتفتح لك ما اشتريته وتسحبه إن استُرد مبلغه، ويُحفظ ذلك على جهازك. يخضع الدفع لسياسة خصوصية أبل أو جوجل.'],
    ['h','الخدمات التي تتصل بها اللعبة'],['p','كل اتصال بالإنترنت يكشف عنوان IP الخاص بجهازك للجهة المتصل بها. لا نرسل معها أي بيانات شخصية.'],
    ['table',['الخدمة','لماذا','ما يُرسل'],[['App Store وGoogle Play','الشراء واستعادة المشتريات','ما يلزم المتجر لإتمام العملية'],['جوجل (أندرويد فقط)','معرفة الوقت الصحيح عند تأكيد اشتراك أصول ونفوذ بلس','طلب فارغ بلا بيانات']]],
    ['p','الخريطة ومسارات النقل تُحسب على جهازك، فلا تتصل اللعبة بأي خادم أثناء اللعب.'],
    ['h','الأطفال'],['p','اللعبة غير موجهة لمن هم دون 13 سنة، ولا تجمع بيانات من أحد. المشتريات تخضع لإعدادات الرقابة الأبوية في المتجر.'],
    ['h','حقوقك'],['p',`بياناتك كلها على جهازك وتحت تحكمك: بدء لعبة جديدة يمسح الحفظ، وحذف التطبيق يمسحه نهائيًا. لأي سؤال أو طلب راسلنا على ${P.email}.`],
    ['h','تغيير السياسة'],['p','ننشر أي تغيير هنا مع تاريخ التحديث، وننبهك داخل اللعبة إن كان التغيير جوهريًا.']
  ]);
  const TERMS=Object.freeze([
    ['p','بتثبيت أصول ونفوذ أو استخدامها توافق على هذه الشروط. إن لم توافق فلا تستخدم اللعبة.'],
    ['h','1. الترخيص'],['p',`نمنحك ترخيصًا شخصيًا غير تجاري وغير حصري وقابلًا للإلغاء لاستخدام اللعبة على أجهزتك، وفق قواعد المتجر الذي حمّلتها منه. اللعبة ورسومها ونصوصها وشيفرتها ملك لـ${P.name}.`],
    ['h','2. المحتوى الافتراضي'],['p','أصول ونفوذ لعبة محاكاة أعمال. الأموال والشركات والأسهم والعقود والأصول فيها افتراضية:'],
    ['ul',['لا قيمة نقدية حقيقية لها، ولا تُستبدل بمال ولا تُنقل لغيرك.','ليست نصيحة مالية أو استثمارية. أسماء المدن والموانئ مستخدمة للواقعية، والشركات والأشخاص فيها خياليون.','اللعبة لا تتضمن مقامرة ولا جوائز حقيقية.']],
    ['h','3. المشتريات داخل اللعبة'],
    ['table',['المنتج','النوع','السعر (دولار)','ما يفتحه'],[['أصول ونفوذ بلس · شهري','اشتراك يتجدد شهريًا','4.99','خبرة +25%، رسوم الترخيص المبكر بنصف السعر، الطيار الآلي، مسرّع الوقت'],['أصول ونفوذ بلس · سنوي','اشتراك يتجدد سنويًا','39.99','ما يفتحه الشهري'],['مسرّع الوقت','شراء دائم','2.99','السرعة 300× وتقديم التقويم'],['رخصة المستثمر','شراء دائم','9.99','وضع المستثمر الحر'],['حزمة البداية','مرة واحدة','2.99','رأس مال افتراضي في أول 7 أيام من اللعبة']]],
    ['p','الأسعار المعروضة في المتجر بعملتك هي المعتمدة.'],
    ['h','4. الاشتراك التلقائي'],['ul',['يُخصم المبلغ من حسابك في App Store أو Google Play عند تأكيد الشراء.','يتجدد الاشتراك تلقائيًا بالسعر نفسه ما لم تلغه قبل 24 ساعة على الأقل من نهاية الفترة الحالية.','تدير اشتراكك أو تلغيه من إعدادات حسابك في المتجر. حذف اللعبة لا يلغي الاشتراك.','بعد الإلغاء تبقى المزايا حتى نهاية الفترة المدفوعة.']],
    ['h','5. الاسترداد'],['p','يتم الاسترداد عبر أبل أو جوجل وفق سياستهما. إن استُرد مبلغ شراء تسحب اللعبة ما فتحه، ومنه رأس المال الافتراضي بقدر المتاح. استعادة المشتريات متاحة من صفحة المتجر داخل اللعبة.'],
    ['h','6. السلوك الممنوع'],['ul',['تعديل اللعبة أو ملفات حفظها، أو فك شيفرتها، أو التحايل على المشتريات أو ساعة الجهاز.','بيع اللعبة أو محتواها أو نسخها أو إعادة نشرها.','قد ترفض اللعبة العمل على جهاز معدّل النظام، أو ترفض حفظًا معدّلًا.']],
    ['h','7. التحديثات وحفظ اللعبة'],['p','قد نغيّر اللعبة أو توازنها في التحديثات. الحفظ محفوظ على جهازك فقط، لذا ننصح بتصدير نسخة احتياطية. لسنا مسؤولين عن فقده بحذف التطبيق أو تغيير الجهاز.'],
    ['h','8. إخلاء المسؤولية'],['p','تُقدّم اللعبة «كما هي». في حدود ما يسمح به القانون، لا نتحمل مسؤولية أي ضرر غير مباشر، ولا تتجاوز مسؤوليتنا ما دفعته في اللعبة خلال آخر 12 شهرًا.'],
    ['h','9. شروط المتجر'],['p','إن حمّلت اللعبة من App Store تنطبق أيضًا اتفاقية ترخيص المستخدم النهائي القياسية من أبل (apple.com/legal/internet-services/itunes/dev/stdeula)، وإن حمّلتها من Google Play تنطبق شروط خدمة Google Play. أبل وجوجل ليستا طرفًا في هذه الشروط ولا مسؤولتين عن اللعبة.'],
    ['h','10. القانون الحاكم والتواصل'],['p',`تخضع هذه الشروط لقوانين ${P.country}. قد نحدّثها وننبهك داخل اللعبة إن كان التغيير جوهريًا. للتواصل: ${P.email}.`]
  ]);
  const DOCS=Object.freeze({privacy:Object.freeze({title:'سياسة الخصوصية',tab:'الخصوصية',blocks:PRIVACY}),terms:Object.freeze({title:'شروط الاستخدام',tab:'الشروط',blocks:TERMS})});
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
  // The save's acceptance: {version, acceptedDay}. Accepted means this version of the texts.
  function accepted(state){return plain(state?.legal)&&state.legal.version===VERSION;}
  function record(state,day){state.legal={version:VERSION,acceptedDay:Math.max(1,Math.floor(Number(day)||1))};return state.legal;}
  function validate(state){
    if(state?.legal===undefined)return [];const row=state.legal;
    if(!plain(row))return ['legal-invalid'];const errors=[];
    if(typeof row.version!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(row.version))errors.push('legal-version-invalid');
    if(!Number.isInteger(row.acceptedDay)||row.acceptedDay<1)errors.push('legal-day-invalid');
    for(const key of Object.keys(row))if(key!=='version'&&key!=='acceptedDay')errors.push(`legal-field-unknown:${key}`);
    return errors;
  }
  function documentMarkup(kind){
    const doc=DOCS[kind]||DOCS.privacy;
    return `<p class="legal-updated">آخر تحديث: ${esc(UPDATED)}</p>${doc.blocks.map(([type,a,b])=>{
      if(type==='h')return `<h3>${esc(a)}</h3>`;if(type==='ul')return `<ul>${a.map(item=>`<li>${esc(item)}</li>`).join('')}</ul>`;
      if(type==='table')return `<div class="legal-table"><table><thead><tr>${a.map(cell=>`<th>${esc(cell)}</th>`).join('')}</tr></thead><tbody>${b.map(row=>`<tr>${row.map(cell=>`<td>${esc(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      return `<p>${esc(a)}</p>`;}).join('')}`;
  }
  const ICONS={lock:'<rect x="5" y="11" width="14" height="10" rx="2"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4"></path>',track:'<path d="M3 12h18"></path><path d="M12 3a14 14 0 0 1 0 18"></path><path d="M12 3a14 14 0 0 0 0 18"></path><circle cx="12" cy="12" r="9"></circle><path d="M4 4l16 16"></path>',money:'<rect x="3" y="6" width="18" height="13" rx="2"></rect><path d="M3 10h18"></path><path d="M7 15h4"></path>'};
  const icon=name=>`<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  // The approved screen. A founded save (after an update) reads «قبل أن تتابع» and continues to its game.
  function consentMarkup({founded=false}={}){
    const card=(name,title,copy)=>`<div class="legal-card">${icon(name)}<b>${esc(title)}</b><span>${esc(copy)}</span></div>`;
    return `<div class="legal-consent-panel"><div class="legal-consent-main">
      <div class="legal-brand"><span class="legal-brand-ar">أصول ونفوذ</span><span class="legal-brand-en" dir="ltr">ASSETS &amp; INFLUENCE</span></div>
      <h1 id="legalConsentTitle">${founded?'قبل أن تتابع':'قبل أن تؤسس مجموعتك'}</h1>
      <p>مرحبًا بك في أصول ونفوذ. اللعبة لا تجمع بياناتك الشخصية، وتحفظ تقدمك على جهازك فقط. الأموال والشركات فيها افتراضية وليست نصيحة مالية.</p>
      <div class="legal-cards">${card('lock','على جهازك فقط','حفظ مشفّر، بلا حسابات')}${card('track','بلا تتبّع','لا إعلانات ولا خوادم أثناء اللعب')}${card('money','مال افتراضي','لا قيمة نقدية حقيقية')}</div>
    </div><div class="legal-consent-side">
      <button type="button" class="legal-link" data-legal-open="privacy">سياسة الخصوصية<span aria-hidden="true">‹</span></button>
      <button type="button" class="legal-link" data-legal-open="terms">شروط الاستخدام<span aria-hidden="true">‹</span></button>
      <label class="legal-agree"><input type="checkbox" data-legal-agree><span>قرأت سياسة الخصوصية وشروط الاستخدام وأوافق عليهما</span></label>
      <button type="button" class="legal-continue" data-legal-accept disabled>${founded?'متابعة':'متابعة إلى التأسيس'}</button>
      <p class="legal-status" role="status" aria-live="polite"></p>
      <small class="legal-note">تظهر مرة واحدة، ومتاحة دائمًا من الحفظ والإعدادات</small>
    </div></div>`;
  }
  function readerMarkup(kind,{fromConsent=false}={}){
    const doc=DOCS[kind]?kind:'privacy';
    return `<div class="legal-reader-panel"><header class="legal-reader-head"><div><button type="button" class="legal-back" data-legal-close aria-label="رجوع">›</button><h1 id="legalReaderTitle">${esc(DOCS[doc].title)}</h1></div>
      <nav aria-label="النصوص">${Object.entries(DOCS).map(([id,row])=>`<button type="button" class="legal-tab${id===doc?' active':''}" data-legal-tab="${id}" aria-pressed="${id===doc}">${esc(row.tab)}</button>`).join('')}</nav></header>
      <div class="legal-reader-body" tabindex="0">${documentMarkup(doc)}</div>
      <footer class="legal-reader-foot"><span>يعمل بلا إنترنت · النص نفسه المنشور على رابط الخصوصية</span><button type="button" class="legal-link" data-legal-close>${fromConsent?'رجوع إلى الموافقة':'رجوع'}</button></footer></div>`;
  }
  // The screens (in the page, built when opened). showConsent resolves once the player accepted and onAccept answered
  // true (the acceptance stored); a false answer keeps the screen with its message.
  const view={consent:null,reader:null,onAccept:null,busy:false,lastFocus:null,bound:false};
  const byId=id=>typeof document!=='undefined'?document.getElementById(id):null;
  function bind(){
    if(view.bound||typeof document==='undefined')return;view.bound=true;
    document.addEventListener('click',event=>{
      const target=event.target;if(!target?.closest)return;
      const open=target.closest('[data-legal-open]'),tab=target.closest('[data-legal-tab]'),close=target.closest('[data-legal-close]'),accept=target.closest('[data-legal-accept]');
      if(open){event.preventDefault();openReader(open.dataset.legalOpen,{fromConsent:!!open.closest('#legalConsent')});return;}
      if(tab){event.preventDefault();openReader(tab.dataset.legalTab,{fromConsent:view.reader?.fromConsent===true});return;}
      if(close&&close.closest('#legalReader')){event.preventDefault();closeReader();return;}
      if(accept&&accept.closest('#legalConsent')){event.preventDefault();acceptConsent();}
    },true);
    document.addEventListener('change',event=>{const box=event.target?.closest?.('[data-legal-agree]');if(!box)return;const button=byId('legalConsent')?.querySelector('[data-legal-accept]');if(button)button.disabled=!box.checked||view.busy;});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&view.reader){event.preventDefault();closeReader();}});
  }
  function show(node){node.classList.remove('hidden');node.removeAttribute('aria-hidden');}
  function hide(node){node.classList.add('hidden');node.setAttribute('aria-hidden','true');node.replaceChildren();}
  function showConsent({founded=false,onAccept}={}){
    const node=byId('legalConsent');if(!node)return Promise.resolve(false);bind();
    if(view.consent)return view.consent.promise;
    let resolve;const promise=new Promise(done=>{resolve=done;});view.consent={promise,resolve,founded};view.onAccept=typeof onAccept==='function'?onAccept:()=>true;
    node.innerHTML=consentMarkup({founded});show(node);node.querySelector('[data-legal-agree]')?.focus?.();
    return promise;
  }
  async function acceptConsent(){
    const node=byId('legalConsent'),box=node?.querySelector('[data-legal-agree]'),button=node?.querySelector('[data-legal-accept]'),status=node?.querySelector('.legal-status');
    if(!view.consent||view.busy||!box?.checked)return false;
    view.busy=true;button.disabled=true;if(status)status.textContent='';
    let ok=false;try{ok=await view.onAccept()===true;}catch(_error){ok=false;}
    view.busy=false;
    if(!ok){button.disabled=!box.checked;if(status)status.textContent='تعذر حفظ الموافقة. أعد المحاولة بعد لحظات.';return false;}
    const done=view.consent;view.consent=null;view.onAccept=null;closeReader();hide(node);done.resolve(true);return true;
  }
  function openReader(kind,{fromConsent=false}={}){
    const node=byId('legalReader');if(!node)return false;bind();
    if(!view.reader)view.lastFocus=typeof document!=='undefined'?document.activeElement:null;
    const doc=DOCS[kind]?kind:'privacy';view.reader={kind:doc,fromConsent};node.innerHTML=readerMarkup(doc,{fromConsent});show(node);
    node.querySelector('.legal-reader-body')?.focus?.({preventScroll:true});return true;
  }
  function closeReader(){
    const node=byId('legalReader');if(!node||!view.reader)return false;view.reader=null;hide(node);
    try{view.lastFocus?.focus?.();}catch(_error){}view.lastFocus=null;return true;
  }
  const state=()=>({consent:!!view.consent,founded:view.consent?.founded===true,reader:view.reader?{...view.reader}:null,busy:view.busy});
  return Object.freeze({VERSION,UPDATED,PUBLISHER,DOCS,accepted,record,validate,documentMarkup,consentMarkup,readerMarkup,showConsent,openReader,closeReader,view:state});
});
