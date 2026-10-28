(()=>{'use strict';
const VERSION='1.0.0';
const FORMS=Object.freeze({
 asset:{zero:'لا أصول',one:'أصل واحد',two:'أصلان',few:'أصول',many:'أصلًا',other:'أصل'},
 facility:{zero:'لا منشآت',one:'منشأة واحدة',two:'منشأتان',few:'منشآت',many:'منشأةً',other:'منشأة'},
 company:{zero:'لا شركات',one:'شركة واحدة',two:'شركتان',few:'شركات',many:'شركةً',other:'شركة'},
 employee:{zero:'لا موظفين',one:'موظف واحد',two:'موظفان',few:'موظفين',many:'موظفًا',other:'موظف'},
 route:{zero:'لا مسارات',one:'مسار واحد',two:'مساران',few:'مسارات',many:'مسارًا',other:'مسار'},
 trip:{zero:'لا رحلات',one:'رحلة واحدة',two:'رحلتان',few:'رحلات',many:'رحلةً',other:'رحلة'},
 project:{zero:'لا مشاريع',one:'مشروع واحد',two:'مشروعان',few:'مشاريع',many:'مشروعًا',other:'مشروع'},
 branch:{zero:'لا فروع',one:'فرع واحد',two:'فرعان',few:'فروع',many:'فرعًا',other:'فرع'},
 vehicle:{zero:'لا مركبات',one:'مركبة واحدة',two:'مركبتان',few:'مركبات',many:'مركبةً',other:'مركبة'},
 attendee:{zero:'لا حضور',one:'حاضر واحد',two:'حاضران',few:'حضور',many:'حاضرًا',other:'حاضر'},
 viewer:{zero:'لا مشاهدات',one:'مشاهدة واحدة',two:'مشاهدتان',few:'مشاهدات',many:'مشاهدةً',other:'مشاهدة'},
 month:{zero:'لا أشهر',one:'شهر واحد',two:'شهران',few:'أشهر',many:'شهرًا',other:'شهر'},
 day:{zero:'لا أيام',one:'يوم واحد',two:'يومان',few:'أيام',many:'يومًا',other:'يوم'},
 hour:{zero:'لا ساعات',one:'ساعة واحدة',two:'ساعتان',few:'ساعات',many:'ساعةً',other:'ساعة'},
 year:{zero:'لا سنوات',one:'سنة واحدة',two:'سنتان',few:'سنوات',many:'سنةً',other:'سنة'},
 sailor:{zero:'لا بحارة',one:'بحار واحد',two:'بحاران',few:'بحارة',many:'بحارًا',other:'بحار'},
 ton:{zero:'لا أطنان',one:'طن واحد',two:'طنان',few:'أطنان',many:'طنًا',other:'طن'},
 decision:{zero:'لا قرارات',one:'قرار واحد',two:'قراران',few:'قرارات',many:'قرارًا',other:'قرار'},
 customer:{zero:'لا عملاء',one:'عميل واحد',two:'عميلان',few:'عملاء',many:'عميلًا',other:'عميل'},
 cheque:{zero:'لا شيكات',one:'شيك واحد',two:'شيكان',few:'شيكات',many:'شيكًا',other:'شيك'},
 loan:{zero:'لا قروض',one:'قرض واحد',two:'قرضان',few:'قروض',many:'قرضًا',other:'قرض'},
 order:{zero:'لا أوامر',one:'أمر واحد',two:'أمران',few:'أوامر',many:'أمرًا',other:'أمر'},
 policy:{zero:'لا وثائق',one:'وثيقة واحدة',two:'وثيقتان',few:'وثائق',many:'وثيقةً',other:'وثيقة'},
 subscriber:{zero:'لا مشتركين',one:'مشترك واحد',two:'مشتركان',few:'مشتركين',many:'مشتركًا',other:'مشترك'}
});
const formatNumber=value=>Math.max(0,Math.round(Number(value)||0)).toLocaleString('ar-SA-u-nu-latn');
function category(value){const n=Math.abs(Math.trunc(Number(value)||0)),mod100=n%100;if(n===0)return'zero';if(n===1)return'one';if(n===2)return'two';if(mod100>=3&&mod100<=10)return'few';if(mod100>=11&&mod100<=99)return'many';return'other';}
function count(value,noun,{showZero=true}={}){const n=Math.max(0,Math.round(Number(value)||0)),forms=FORMS[noun];if(!forms)throw new Error(`arabic-copy-noun-unknown:${noun}`);const kind=category(n);if(kind==='zero')return showZero?forms.zero:'';if(kind==='one'||kind==='two')return forms[kind];return `${formatNumber(n)} ${forms[kind]}`;}
// The English words the contract templates carry (their data, seeded into the business world, stays as written): the
// pages show them in Arabic.
const TERMS=Object.freeze({'حتى 7% عند إخفاق SLA':'حتى 7% عند الإخفاق في مستوى الخدمة','شهري Net 30':'شهري خلال 30 يومًا','شهري Net 45':'شهري خلال 45 يومًا','2,400 TEU شهريًا':'2,400 حاوية نمطية شهريًا','52 طن أسبوعيًا':'52 طنًا أسبوعيًا','110 MW':'110 ميغاواط','180 MW':'180 ميغاواط','Service credits حتى 9%':'خصومات خدمة حتى 9%','شهري + حافز SLA':'شهري + حافز مستوى الخدمة','برنامج LNG طويل الأجل':'برنامج الغاز الطبيعي المسال طويل الأجل','Demurrage وOff-hire':'غرامات انتظار السفن والتوقف عن الخدمة','2 ناقلة LNG مخصصة':'ناقلتا غاز مسال مخصصتان','جسر شحن دوائي عالمي GDP':'جسر شحن دوائي عالمي بمعايير التوزيع الجيد','تعويض Cold-chain':'تعويض إخفاق سلسلة التبريد','PPA':'شراء طاقة','Availability LDs':'غرامات عدم الإتاحة','شهري Indexed':'شهري مرتبط بالمؤشر','Berth-window penalties':'غرامات تجاوز نافذة الرسو','VIP/Gov':'كبار الشخصيات وحكومي','Availability penalties':'غرامات عدم التوفر','طائرتان VIP + Crew reserve':'طائرتان لكبار الشخصيات + طاقم احتياطي','Retainer + ساعات طيران':'اشتراك ثابت + ساعات طيران','محفظة 250M':'محفظة 250 مليون دولار'});
const term=value=>Object.prototype.hasOwnProperty.call(TERMS,value)?TERMS[value]:value;
function join(items,{conjunction='و'}={}){const rows=(items||[]).map(value=>String(value||'').trim()).filter(Boolean);if(rows.length<2)return rows[0]||'';return `${rows.slice(0,-1).join('، ')} ${conjunction}${rows.at(-1)}`;}
function readingDuration(lines,{wordsPerMinute=125,minMs=2500,maxMs=18000}={}){const words=(Array.isArray(lines)?lines:[lines]).join(' ').trim().split(/\s+/u).filter(Boolean).length;return Math.max(minMs,Math.min(maxMs,Math.round(words/Math.max(60,Number(wordsPerMinute)||125)*60000)));}
const API=Object.freeze({VERSION,FORMS,TERMS,term,category,count,join,formatNumber,readingDuration});
globalThis.GH_ARABIC_COPY=API;if(globalThis.window&&window!==globalThis)window.GH_ARABIC_COPY=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
