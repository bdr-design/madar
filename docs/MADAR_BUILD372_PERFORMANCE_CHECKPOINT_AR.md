# نقطة وقوف أداء «مدار» — Build 372

**التاريخ:** 2026-10-11
**المستودع الهدف:** `https://github.com/bdr-design/madar.git`
**علامة الاستئناف المقترحة بعد تثبيت الـ commit النهائي:** `madar-build372-performance-checkpoint-2026-10-11`

## ملحق التجميد والرفع

**حالة اللقطة عند التجميد:** أوقف صاحب المشروع أعمال إصلاح المشاكل الإضافية وطلب رفع الحالة الحالية إلى `bdr-design/madar` استعدادًا لبناء IPA. هذه اللقطة ليست اعتمادًا نهائيًا للأداء أو الإصدار.

- نُفذ ربط الشراء التجميعي داخل `app.js`: عدد 200,000 أصل وصل إلى 391 مرحلة صفوف، مع شيك وفاتورة ومعاملة مورّد وأمر شراء واحد في تشغيل المتصفح. ونجح اختبار رفض الطلب القديم قبل الدفع عند تغيّر الأسطول.
- لم يكتمل اختبار المتصفح الشامل بعد هذا الربط. تعثر فحص rollback لأن الاختبار توقع رجوع `revision/structure`، بينما يحافظ Fleet Store عليهما متزايدين عمدًا لإبطال قراءات العامل القديمة؛ لم يُعَد تشغيل الاختبار بعد تعديل توقعه.
- اكتملت وحدات وعمليات إضافية للإرسال، نسخ العامل المرحلية، التحقق المضغوط، بدء التشغيل والتفاعلات، وأضيفت اختبارات لها. لم تُشغّل حزمة Build 372 كاملة على هذه اللقطة بعد.
- **لم يُشغّل قياس المليون على هذه اللقطة.** لا توجد أرقام أداء جديدة تثبت انخفاض زمن الإطار على مليون أصل.
- `RELEASE_GATE.json` يبقى مغلقًا (`approved: false`). رفع المصدر يتيح إنشاء build تجريبيًا حسب إعدادات المستودع، لكنه لا يثبت اجتياز اختبارات الجهاز أو اعتماد IPA.
- استئناف العمل: ابدأ من commit التجميد المرفوع إلى `madar`، صحح/أعد اختبار rollback للشراء، أكمل مراجعة روابط التسوية والسياق، شغّل بوابة الاختبارات، ثم قس الأداء على الجهاز المرجعي نفسه قبل اعتماد الإصدار.

> هذه وثيقة استئناف هندسية، وليست إعلان نجاح أداء. **لم يُشغَّل قياس المليون على تغييرات هذه الجولة.** الأرقام الواردة أدناه إما من أدلة قديمة محفوظة في المستودع، أو من ملف التشخيص الذي زوّد به صاحب المشروع. لا تمثل أي منها قياسًا جديدًا للشجرة الحالية.

---

## 0. اقرأ هذا أولًا

بدأت نسخة «مدار» من مصدرين متتاليين:

- `d5fde4ebe9276280a46e99c65c3740c2d3f04014`: آخر نقطة تسليم من فرع المطور الآخر؛ تحتوي إصلاحات Build 372 السابقة ووثيقة تسليمها.
- `d0bf1c90f4e802a1d7fbad9d0d5affb6a7f4316e`: رأس نسخة العمل المحلية قبل هذه الجولة. يسبقها `dfb2a57` لنقل قراءات مركز المسارات إلى العامل، ثم `d0bf1c9` لتقوية المقارنة التفاضلية للمدى.

نُقل الخط الأساسي `d0bf1c9` إلى `bdr-design/madar` في:

- `e3f15ff` — `Import GlobalHoldings baseline d0bf1c9` على `main`.

واجه الرفع أولًا رفض صلاحية GitHub Contents لتثبيت التطبيق رقم `159732933`. مُنحت الصلاحية لاحقًا ونجح رفع الخط الأساسي، لذلك أصبح الرفع إلى `madar` متاحًا. يجب وضع العلامة المقترحة أعلاه على **commit الإصلاحات النهائي** بعد رفعه، لا على `e3f15ff`.

حالة العمل عند تحرير هذه الوثيقة:

- إعادة تصميم الإرسال الكبير مدمجة في التطبيق وتخضع لإعادة اختبار أخيرة.
- مرور إقفال الأسطول اليومي، صيانة مخزن الأسطول، وضغط إيصالات إعادة أوامر الإرسال مدمجة في الشجرة المحلية.
- ملخصات الواجهة وعدة خطط قراءة للأسطول موجودة في العامل؛ بعض المستهلكين مدمجون وبعض أوامر الواجهة ما زالت تحتاج تمرير إثبات النتيجة الحالية.
- نواة الشراء التجميعي الجديدة واختباراتها موجودة، لكن **مسار الشراء في `app.js` لم يُحوّل إليها بعد عند كتابة هذه الوثيقة**. لذلك يظل السلوك القديم الذي يفصل الشراء كل 512 أصل ويصدر مستندًا ماليًا لكل جزء قائمًا حتى يكتمل هذا الربط.
- لم يُشغَّل قياس 1M، ولم يُنفذ اعتماد iPhone، ولم تُشغّل حزمة القبول الكاملة بعد.

لا تبدأ بقياس المليون قبل إكمال البنود الحرجة في §8 وتشغيل بوابة الاختبارات في §7.

---

## 1. الهدف والقيود

الهدف هو إزالة العمل المتناسب مع حجم الأسطول من الخيط الرئيسي، مع الحفاظ على النتائج والترتيب والذرية والحفظ والتوقيع. القواعد التي حكمت هذه الجولة:

1. كل مسح كبير يذهب إلى نسخة الأسطول في العامل، أو يُنفّذ بخطة مرحلية ذات حدود زمنية واضحة إن كانت الكتابة نفسها يجب أن تقع داخل معاملة الخيط الرئيسي.
2. لا تُقبل نتيجة عامل قديمة. يجب ربطها بمصدر المخزن، و`revision`، و`structure`، والطول، ووقت المحاكاة، وسياق الأمر ذي الصلة.
3. عند فشل التحقق من الحداثة، لا تُنشر كتابة جزئية. المسارات التفاعلية الكبيرة تؤجل أو ترفض الطلب؛ بعض مسارات الإقفال الإلزامية ما زالت تحتفظ بالحساب الأصلي كمسار صحة احتياطي، وهذا خطر أداء موثق في §8.
4. كل تعديل مالي أو تشغيلي مترابط يقع في معاملة واحدة قابلة للتراجع. سجل Fleet Store يملك تراجع صفوف الأسطول، وتبقى جذور المالية والمشتريات والعمل والعقود ضمن نطاق المعاملة نفسه.
5. أحجام الشرائح مثل 512 هي تفصيل لتنفيذ الصفوف فقط. لا يجوز أن تصبح حدًا قانونيًا أو ماليًا ينشئ شيكًا أو فاتورة أو دفعة مستقلة.
6. لا تُقارن نتائج الأداء إلا على الجهاز نفسه وبخط أساس يعاد تشغيله على ذلك الجهاز.

---

## 2. الأدلة التي قادت العمل

### 2.1 قياسات Build 372 القديمة في المستودع

المرجع هو `verification/build372-perf/README.md` والملفات المجاورة له:

- `7814b23-1m.json` و`7814b23-1m-rss.txt`: خط الأساس القديم على مليون أصل.
- `838569c-1m.json` و`838569c-1m-rss.txt`: بعد أول مجموعة إصلاحات.
- `810b14f-1m-traced.json` وملفات تشريح الكتل: تتبع للتشخيص، وأرقامه منفوخة ولا تصلح للمقارنة.
- `ec0031a-100k.json`: قياس 100 ألف أصل.

التحسن القديم المثبت بين `7814b23` و`838569c` كان:

| المرحلة | توقفات أكبر من 50ms | أسوأ فجوة | p95 / p99 |
|---|---:|---:|---:|
| الإرسال | 3882 → 982 | 1133 → 1100ms | 116.7/533.2 → 66.7/650ms |
| اللعب 90 ثانية | 19 → 14 | 450 → 300ms | 16.8/33.3 → 16.8/16.8ms |
| تقديم يومين | 69 → 62 | 267 → 217ms | 33.3/66.6 → 16.8/66.7ms |

هذه أرقام تاريخية فقط. لا تشمل تغييرات «مدار» الحالية.

### 2.2 ملف التشخيص الذي زوّد به صاحب المشروع

الملف الخارجي:

`GlobalHoldings_diagnostic_v3.0.0_1791740531338.ghdiagnostic`

- SHA-256: `3914f95acb11b586980ac02f7bf2a88897456bd66391d2541c2de824ea84c023`
- `evidenceId`: `DX-1791740526963-4-38-263130`
- تاريخ الإنشاء: `2026-10-11T17:42:06.963Z`
- التطبيق/الخزنة: `3.0.0`، Native Build 362، Save Schema 3.0.0.
- حجم الأسطول: 963,712 أصلًا.

أهم ما يثبته الملف:

| الدليل | القيمة |
|---|---:|
| مدة تسجيل الإطارات | 362.174 ثانية |
| FPS الفعلي | 33.11 |
| p50 / p95 لفاصل الإطار | 17.25 / 91.25ms |
| أسوأ فاصل إطار | 920ms |
| الإطارات المتعثرة | 1,764 من 11,923، أي نحو 14.8% |
| تطبيق عمليات شراء كبيرة | 7.480، 14.789، 20.092، 50.428 ثانية |
| الزمن الكلي لنفس عمليات الشراء | 8.191، 15.756، 21.273، 53.312 ثانية |
| تطبيق أوامر إرسال جوي كبيرة | 5.954–14.102 ثانية في العينات المحفوظة |
| إقفال اليوم الأبطأ | 3.104 ثانية، منها 829ms apply، عبر 984 خطوة staged |
| الفواتير / الشيكات | 1,954 / 1,909 |
| أوامر التسليم المكتملة | 1,889 |

ملف الأحجام داخل التشخيص ربط البطء أيضًا بتضخم الحالة:

| الجذر | الحجم المقاس |
|---|---:|
| `documentProofs` | 31,615,395 بايت |
| `finance` | 14,685,000 بايت |
| `authorization` | 4,975,100 بايت |
| `realism.procurement` | 4,217,541 بايت |
| `domainRuntime.idempotency` | 2,315,442 بايت / 3,989 إدخالًا |

احتوى `domainRuntime.idempotency` على عشر نتائج `fleet/depart-batch` بحجم يقارب 84–88KB لكل نتيجة. كما كان عدد مستندات الشراء قريبًا من عدد دفعات 512، وهو متوافق مع ملاحظة صاحب المشروع: شراء 200 ألف أصل كان يخلق نحو 391 حد تنفيذ، ويتحول الحد خطأً إلى عدد كبير من الشيكات والمستندات.

حدود هذا الدليل:

- لا يحتوي قياس heap/RSS كاملًا يمكن نسبته لهذه الجولة.
- `longTasks: 0` في ملخص مسجل الأعطال لا ينفي توقف الإطارات؛ الدليل المباشر هنا هو فواصل `requestAnimationFrame`.
- الملف مأخوذ من Build 362 وحالة مستخدم، وليس من الشجرة الحالية.

---

## 3. الإصلاحات المدمجة في الشجرة المحلية

### 3.1 الإرسال الكبير: حساب الخطة في العامل وتطبيقها مرحليًا

الملفات الأساسية:

- `WebApp/fleet-dispatch-core.js`
- `WebApp/fleet-engine-worker.js`
- `WebApp/fleet-engine-thread.js`
- `WebApp/fleet-core.js`
- `WebApp/app.js`

المسار الجديد:

1. العامل يستخدم النسخة المطابقة من Fleet Store لحساب الأهلية، الإسناد، التطبيع، والمغادرة بصورة مضاربية داخل journal خاص به.
2. يتراجع العامل عن كتاباته المضاربية، وينقل خطة ثابتة العرض: فهارس الصفوف، bytes، وextras اللازمة فقط.
3. تربط الخطة بوسم الأسطول وبسياق المسارات ووقت المحاكاة ونسختي الكتالوج وسياسة الملكية.
4. يُبنى `assignmentDigest` و`planDigest` بـSHA-256 على مراحل، ثم يُوقع intent واحد مضغوط باسم `dispatch-plan-intent`.
5. يتحقق التطبيق من digest المقاطع والجذر قبل أول كتابة، ثم يطبق الصفوف داخل journal المعاملة بميزانية تقارب 6ms ودُفعات 32 صفًا.
6. إسقاطات الصفوف المساعدة أصبحت cooperative بحد أقصى 256 صفًا بين فرص التسليم، بدل سلاسل `map/filter` متزامنة على صفحة 20 ألف أصل.
7. تنظيف المسارات يعتمد `summary.inUseRouteIds` المحسوب في العامل، فلا يبني `distinctRefs` خفيًا على الرئيسي بعد التطبيق.

عقود السلامة:

- الأسطول الكبير يحتاج replica جاهزة ومطابقة؛ عدم وجودها أو تقادمها يرفض الأمر قبل الكتابة.
- لا يوجد مسح رئيسي كامل كمسار احتياطي للإرسال الكبير. يبقى الحساب المحلي للبيئات الصغيرة فقط.
- تغير المسارات أو الكتالوج أو الملكية أو وقت المحاكاة بعد التخطيط يجعل الخطة stale.
- الـintent يربط تعيين كل أصل ومسار والخطة الفعلية عبر digest؛ عدّ الأصول وقائمة المسارات وحدهما غير كافيين.

الحالة المعروفة: التكامل شبه مكتمل وكان آخر إعادة اختبار جارية عند تحرير الوثيقة. أظهرت بوابة 20 ألف أصل 78 فرصة تسليم في تشغيل سابق. بقي في اختبار الطريق أسوأ إطار قريب من 117ms خارج replay المرحلي؛ يحتاج تشريحًا بعد تثبيت الشجرة وقياس المليون.

### 3.2 ضغط إيصالات idempotency للإرسال

`WebApp/domain-command-core.js` يرفع إيصال الأسطول الساخن من `gh-fleet-batch-receipt-v1` إلى v2:

- الأعمدة المتكررة تُخزن بصيغة raw أو constant أو dictionary بدل تكرار أسماء المفاتيح والقيم لكل أصل.
- digest المنطقي يبقى محسوبًا على صفوف replay بعد إعادة بنائها.
- v1 يهاجر تلقائيًا إلى v2 عند سلامته.
- أي تلاعب في شكل العمود أو الأكواد أو القاموس أو digest يُرفض.
- النتائج الأكبر من حد replay تبقى cold كما كان العقد السابق.

في fixture مماثل للتشخيص، انخفض إيصال `depart-batch` لـ500 أصل إلى 21,887 بايت بدل نحو 84–88KB. هذا **قياس حجم وحدة اختبار** وليس قياس أداء مليون أصل.

### 3.3 مرور الأسطول اليومي في العامل

الملفات:

- `WebApp/fleet-day-core.js`
- `WebApp/realism-core.js`
- `WebApp/fleet-query-core.js`
- طبقة worker/thread وFleet Store.

جُمعت في مرور عامل واحد الحسابات التي كانت تعيد قراءة الأسطول في الإقفال اليومي:

- إجماليات المالك والقيمة والإهلاك والتأجير والوقود والصيانة والرواتب.
- الصيانة والحوادث والتأمين ومؤشرات الجو والبحر والبر.
- مجموع الحالة والاستعداد.
- تحديث `flightHours` و`flightCycles` و`nextCheckHours`.

خطة الكتابة تستخدم Float32 للحالة الشائعة، وتيار Float64 مرتبًا للقيم التي لا يمكن تمثيلها تمامًا، بما فيها extras والقيم غير المحدودة. التياران يشتركان في buffer الفهارس وbuffer القيم المنقولين. قبل أول snapshot أو كتابة:

- تُفحص الخطة كاملة على مراحل؛
- يُرفض NaN غير الممكن في ناتج الصيغ؛
- يعاد فحص freshness وسياق الاقتصاد؛
- تبدأ لقطة أعمدة Fleet Store ثم الكتابة المرحلية؛
- rollback يعيد البايتات وextras والجذور التابعة.

أُعيد استخدام عدد أصول الصيانة لحساب حصة السوق، فأزيل مرور مالك إضافي.

### 3.4 صيانة Fleet Store وGC دون كتلة رئيسية كبيرة

التغييرات في `fleet-store-core.js` و`fleet-access-core.js` و`app.js`:

- `reserveCapacityStages`: ينسخ توسعة buffer على شرائح، ثم ينشره ذريًا بعد freshness barrier.
- `columnPlanStages`: يفحص خطة الأعمدة ثم يلتقط rollback ويطبقها على شرائح.
- `compactRowsStages`: يبني buffer الدمج الخاص على شرائح، وينشره مرة واحدة إن بقي المصدر مطابقًا.
- `collectValuesStages`: يفصل mark واستخراج المرشحين والتحرير إلى شرائح؛ يعيد فحص حداثة الصفوف وجدول القيم قبل كل مرحلة.
- free refs أصبحت بنية قابلة للإزالة والإضافة المحددة بدل إعادة بناء القائمة كلها بعد كل payload صغير.
- replica تسجل refs المتغيرة في جدول القيم فقط، بما فيها تحرير ref وإعادة استخدامه والتراجع، بدل snapshot/مقارنة جدول القيم كاملًا.
- `maintainStages` يستأنف عند نتيجة stale، ويحرك map revision بعد النشر الذري للدمج.
- فحص الصحة الكبير لا يعود إلى مسح رئيسي عند غياب/تقادم العامل؛ يترك التقرير السابق ويسجل سبب عدم التوفر. الأسطول الصغير تحت 2,048 يحتفظ بالمسار الأصلي.

يوجد كذلك بروتوكول mutation catch-up في engine thread (`beginMutation`/`flushMutation`/`finishMutation`/`settleMutation`) لإرسال deltas محدودة أثناء mutation كبيرة من دون نسخ الأسطول كله. النواة متاحة، وربطها بمسار الشراء ينتظر تحويل `app.js` إلى مسار الشراء الجديد.

### 3.5 التحقق من إثباتات الأرشيف في عامل منفصل

الملفات:

- `WebApp/proof-verification-worker.js`
- `WebApp/document-proof-core.js`
- تكامل الصيانة في `app.js`.

العامل يستقبل جولة صغيرة من مرشحي الأرشيف ويبني canonical text وSHA-256 باستخدام نفس `authorization-core` و`document-proof-core`. الخيط الرئيسي يحتفظ بملكية النشر وفحص envelope والتفويض والسلسلة والحداثة. الشهادة القديمة أو غير المطابقة تُهمل. عند غياب العامل يبقى التحقق الأصلي للحفاظ على الصحة، ولذلك يظل مسار fallback مرشحًا للثقل ويجب مراقبته في قياس 1M.

### 3.6 إصلاحات بدء التشغيل والهجرة

- `company-platform-core.js` يدعم هجرة in-place، ويطوي فحص الملكية المنفصل داخل مرور الهجرة نفسه.
- `save-schema.js` يتجاوز هجرة الشركة حين يكون marker حديثًا، ويستعمل in-place فقط للحفظ القديم.
- `migration-core.js` يتبنى chunks المخزن المحمّلة بدل نسخ إضافي عندما يتحقق عقد المصدر.
- التخصيص المالي الأولي لم يعد يعد الأسطول مرة لكل شركة؛ يجمع فئات الملكية في مرور واحد.
- مسار staffing السليم يجمع الفئات بدل توسيع كل أصل، ويحتفظ بإصلاح الصفوف الاستثنائية بترتيبها الأصلي.
- `fleet-startup-normalization-core.js` ينتج خطة typed single-pass للصفوف التي تحتاج تطبيعًا فقط، ويربطها بالمسارات والكتالوج وreset/sim tokens.
- `fleet-staffing-reconcile-plan-core.js` يثبت الحالة السليمة من العامل بإجماليات الطواقم، ويرجع فهارس الصفوف الاستثنائية فقط. كان الملف واختباره قيد الربط النهائي عند تحرير الوثيقة.

نواة تطبيع بدء التشغيل واختبارها موجودان ومربوطان كاستعلام worker، لكن تأجيل prune/reconcile/normalization إلى ما بعد first paint وworker prime لم يكتمل في `app.js` عند تحرير الوثيقة.

### 3.7 ملخصات الواجهة وقراءات الأوامر

النوى الجديدة أو المعدلة:

- `fleet-ui-summary-core.js`: إجماليات كل الأسطول والمالكين والأنماط والأنواع والقواعد في مرور عامل واحد.
- `fleet-global-route-query-core.js`: مرشحو الأصل لمسار عالمي.
- `fleet-route-normalization-core.js`: patches typed لتغيير هندسة طريق.
- `fleet-sale-plan-core.js`: خطة البيع الجماعي.
- `fleet-manual-departure-plan-core.js`: خطة المغادرة اليدوية مع أسباب المنع.
- `fleet-reference-query-core.js`: استخدام route/base بدقة لأوامر replace/delete/dedupe وإغلاق المنشأة.
- `fleet-startup-normalization-core.js`: خطة تطبيع البدء.

مستهلكو `advanced-core` و`conference-core` و`banking-core` و`facility-core` يستخدمون summary متى وصلتهم. يمنع المسار الاحتياطي أي فحص كامل فوق 2,048 أصلًا، ويعرض حالة انتظار أو يرفض الأمر بدل تجميد الواجهة.

الربط المكتمل جزئيًا في `app.js` يشمل cache/query لـ`fleetUiSummary`، بعض شاشات الطائرات/السفن/السوق/الملكية/المنشآت، خطة هندسة الطريق، واستعلام مرشحي المسار العالمي. ما زال مطلوبًا قبل الادعاء باكتمال هذا المحور:

- closure صريح يثبت أن summary ما زالت current عند إدخالها في أمر دائم؛
- تمرير context إلى أوامر البنك والمنشأة والمؤتمر؛
- ربط manual departure وsell-all بخطط العامل؛
- تمرير reference proofs إلى إنشاء/استبدال/حذف/تنظيف المسارات وكل قائمة operational route ids؛
- إكمال مسار بدء التشغيل المؤجل.

### 3.8 دقة نطاق المعاملة

أضيف `transaction-core.isActiveFor(target)` لأن `isActive()` العالمي وحده يسمح لحالة B أن تظن أنها داخل معاملة الحالة A. هذا مهم في adapter الشراء: journal أسطول B لا يحمي جذور العمل والمشتريات في B إذا كانت المعاملة الفعلية تملك A.

عقد الشراء الجديد يسجل guard حرجًا قبل أول mutation، ويسمّم السياق الدائم عند فشل adapter لا يملك journal مستقلًا، حتى لا يستطيع catch داخلي نشر معاملة ناقصة.

---

## 4. الشراء التجميعي: ما أُنجز وما لم يُربط

الملفات الجديدة:

- `WebApp/asset-purchase-order-core.js`
- `WebApp/asset-purchase-plan-core.js`
- `WebApp/asset-purchase-apply-core.js`

العقد المصمم والمختبر:

1. `purchaseBaseline` في العامل يجمع إشغال القواعد، إجماليات المالك/النمط، ويفحص نطاق IDs المخطط له.
2. `asset-purchase-order-core` ينشئ أمرًا تجاريًا واحدًا للشراء كله.
3. شراء 200,000 أصل يستخدم `rowStageHint=512` و391 مرحلة صفوف، لكنه يعلن:
   - دفعة مورد واحدة؛
   - فاتورة واحدة؛
   - شيكًا واحدًا؛
   - supplier transaction واحدة؛
   - قيد تمويل واحد عند الحاجة؛
   - allocation مدمجة لكل منشأة تسليم.
4. المبالغ الموزعة تجمع إلى الإجمالي نفسه، والجزء الأخير يأخذ الباقي الدقيق لتجنب انحراف التقريب.
5. النطاقات التسلسلية تُحجز مرة واحدة بتعقيد متناسب مع عدد المنشآت، لا عدد الأصول.
6. intent المالي صغير وموقع بـSHA-256؛ تعديل allocation بعد التوقيع يُرفض، وإعادة envelope نفسها تُرجع idempotent replay بلا تنفيذ ثانٍ.
7. adapter يفحص baseline وسعة المنشأة وlease الأسطول قبل وأثناء التطبيق، ويستخدم journal واحدًا لإرجاع الأسطول والعمل والطواقم والتسليمات والمتتاليات.
8. تجهيز ledger التسليم، الترتيب النهائي، وحجز سعة Fleet Store أصبحت مراحل قابلة للتسليم.

**الحالة الحرجة:** هذا العقد لم يُربط بعد بزر الشراء في `app.js` عند تحرير الوثيقة. المسار الحي القديم حول السطر 5850 ما زال يقسم الطلب إلى chunks ويصدر مستندات لكل chunk. لذلك:

- لا تعتبر مشكلة «شيك لكل 512 أصل» محلولة في المنتج بعد.
- لا تحذف النوى أو اختبارات الشراء؛ هي نقطة الاستئناف الجاهزة.
- المطلوب هو استبدال `buyAsset` القديم بالكامل بأمر order واحد، settlement واحد، ثم materialization مرحلية داخل المعاملة نفسها.
- بعد الربط يجب تشغيل اختبار متصفح فعلي يؤكد الفرق العددي في `finance.cheques` و`finance.invoices` و`supplierTransactions` قبل/بعد شراء 200 ألف أصل.

---

## 5. عقود الصحة التي يجب ألا تُكسر

### 5.1 Freshness

أي نتيجة عامل قابلة للكتابة يجب أن تثبت، حسب نوعها:

- هوية مصدر Fleet Store وruntime؛
- `revision` و`structure` والطول وmembership revision؛
- `simSeconds` و`resetEpoch`؛
- tokens للمسارات والكتالوج والمالك والطلب؛
- dependencies الفعلية التي قُرئت، مثل حقول route أو مواصفات catalog؛
- digest الخطة أو الأمر إذا كان سيُوقع أو يكتب.

يُعاد الفحص مباشرة قبل أول كتابة، لا عند وصول الرسالة فقط.

### 5.2 Atomicity وrollback

- worker plan قراءة أو تخطيط فقط؛ النشر النهائي يقع داخل معاملة الخيط الرئيسي.
- الخطط الكبيرة تُفحص كاملة قبل أخذ snapshot أو بدء الكتابة.
- Fleet Store journal يعيد الصفوف والأعمدة وextras وجدول القيم؛ مراجعاته تبقى monotonic عمدًا حتى لا تعود cache قديمة current.
- أي afterCommit حرج يُسجل قبل mutation الذي يحرسه.
- mutation catch-up إلى replica يستقر commit/rollback صراحة.
- لا يُسمح لمعاملة على state مختلفة أن تُستخدم كدليل ملكية.

### 5.3 Fail closed

- الإرسال الكبير والأوامر التفاعلية لا تفحص مليون صف على الرئيسي عند غياب العامل.
- health الكبير لا ينشر تقريرًا جديدًا من نتيجة مفقودة أو stale.
- route/reference proofs غير المتطابقة ترفض الأمر.
- خطة شراء stale أو ID collision أو capacity stale ترفض قبل نشر جزئي.
- fallback الحسابي الكامل ما زال موجودًا في الإقفال اليومي وبعض تحقق الإثباتات لحفظ الوظيفة؛ يجب قياسه ووضع سياسة retry/defer إن ظهر في 1M.

---

## 6. ملفات التغيير الرئيسية

| المجال | الملفات |
|---|---|
| dispatch | `fleet-dispatch-core.js`, `fleet-core.js`, `fleet-engine-thread.js`, `fleet-engine-worker.js`, `app.js` |
| daily close | `fleet-day-core.js`, `realism-core.js`, `fleet-query-core.js`, `fleet-store-core.js` |
| store/GC/replica | `fleet-store-core.js`, `fleet-access-core.js`, engine thread/worker |
| purchase | `asset-purchase-order-core.js`, `asset-purchase-plan-core.js`, `asset-purchase-apply-core.js` |
| UI queries | `fleet-ui-summary-core.js`, `fleet-global-route-query-core.js`, `fleet-reference-query-core.js`, `fleet-sale-plan-core.js`, `fleet-manual-departure-plan-core.js` |
| normalization | `fleet-route-normalization-core.js`, `fleet-startup-normalization-core.js` |
| startup staffing | `fleet-staffing-reconcile-plan-core.js`, `fleet-core.js` |
| proofs | `document-proof-core.js`, `proof-verification-worker.js`, `app.js` |
| startup/migration | `company-platform-core.js`, `migration-core.js`, `save-schema.js`, `finance-core.js`, `fleet-core.js` |
| receipts/transactions | `domain-command-core.js`, `transaction-core.js` |
| consumers | `advanced-core.js`, `banking-core.js`, `conference-core.js`, `facility-core.js`, `route-core.js`, `simulation-asset-core.js` |

لا تعدّل `RUNTIME_SOURCE_MANIFEST.json` أو `SOURCE_INTEGRITY_SHA256.txt` يدويًا. تُحدّث بأداة المشروع بعد تثبيت الشجرة، ثم يُعاد `verify_current_source.py`.

---

## 7. الاختبارات المعروفة وحالة البوابة

### 7.1 اختبارات أُبلغ بنجاحها أثناء التطوير

#### الشراء

- `tests/build372-asset-purchase-plan.cjs` — 7/7.
- `tests/build372-asset-purchase-apply.cjs` — 26/26.
- `tests/build372-asset-purchase-order.cjs` — 9/9.
- `tests/build372-asset-purchase-worker-browser.cjs` — نجح.
- `tests/build372-asset-purchase-intent.cjs` — نجح؛ 200k، 391 مرحلة صفوف، payload مضغوط، tamper/replay.

هذه الاختبارات تثبت النوى، ولا تثبت أن `app.js` يستخدمها.

#### الإرسال

- `tests/build372-fleet-dispatch-plan.cjs`.
- `tests/build372-fleet-dispatch-worker-browser.cjs`.
- `tests/build372-dispatch-app-integration.cjs`.
- `tests/build372-depart-projection.cjs`.
- `tests/build372-fleet-query-worker-browser.cjs`.
- اختبارات air/sea/road القائمة ذات الصلة.

نجحت قبل آخر ترقيع cooperative؛ يجب إعادة المجموعة كاملة على الشجرة المثبتة.

#### اليوم والصيانة والنسخة

- `tests/build372-fleet-day-core.cjs`.
- `tests/build372-fleet-day-worker.cjs`.
- `tests/build372-fleet-day-worker-browser.cjs`.
- `tests/build372-fleet-day-exceptional.cjs`.
- `tests/build372-fleet-day-slice-parity.cjs`.
- `tests/build372-store-maintenance-stages.cjs`.
- `tests/build372-replica-value-log.cjs`.
- `tests/build372-large-health-fallback-browser.cjs`.
- `tests/build372-replica-log-browser.cjs`.

تغطي المقارنة byte-for-byte، Float32/Float64 الاستثنائي، NaN/±Infinity/−0، stale قبل الكتابة، rollback، GC، compaction، وreplica parity.

#### الواجهة والمسارات والبدء

- `tests/build372-fleet-ui-summary.cjs`.
- `tests/build372-interactive-summary-consumers.cjs`.
- `tests/build372-global-route-candidates.cjs`.
- `tests/build372-manual-departure-plan.cjs`.
- `tests/build372-fleet-sale-plan.cjs`.
- `tests/build372-route-normalization-plan.cjs`.
- `tests/build372-fleet-reference-query.cjs`.
- `tests/build372-route-reference-proof.cjs`.
- `tests/build372-startup-normalization-plan.cjs`.
- `tests/build372-startup-staffing-classes.cjs`.
- `tests/build372-staffing-reconcile-plan.cjs` (أضيف أثناء تحرير نقطة الوقوف؛ يحتاج إدخاله في إعادة التشغيل النهائية).
- `tests/build372-finance-initial-allocation.cjs`.
- `tests/build372-legacy-migration-single-pass.cjs`.
- `tests/build372-native-migration-chunk-adoption.cjs`.

اختبارات النوى نجحت في التشغيل المباشر المبلغ عنه؛ ربط كل مستهلك في التطبيق ما زال بندًا منفصلًا.

#### الإثباتات والإيصالات

- `tests/build372-proof-worker.cjs`.
- `tests/build372-proof-worker-browser.cjs`.
- `tests/build358-cold-fleet-receipts.cjs`.
- `tests/build338-idempotency-save-lag-root.cjs`.
- `tests/build362-idempotency-byte-budget.cjs`.

تغطي digest، tamper، هجرة v1، cold receipts وحد الحجم.

### 7.2 أوامر البوابة قبل وضع العلامة

من جذر المستودع، مع Chromium النظام عند الحاجة:

```bash
export NODE_PATH=/opt/node-tools/node_modules
python3 tools/verify_current_source.py
node tests/lint.cjs
git diff --check
```

شغّل اختبارات Build 372 الجديدة مباشرة؛ لا تعتمد على `npm run test:build362` وحده لأن قائمة package كانت تحتوي مجموعة فرعية فقط عند تحرير الوثيقة:

```bash
for test in \
  build372-asset-purchase-plan \
  build372-asset-purchase-apply \
  build372-asset-purchase-order \
  build372-asset-purchase-intent \
  build372-fleet-dispatch-plan \
  build372-fleet-day-core \
  build372-fleet-day-worker \
  build372-fleet-day-exceptional \
  build372-store-maintenance-stages \
  build372-replica-value-log \
  build372-fleet-ui-summary \
  build372-interactive-summary-consumers \
  build372-global-route-candidates \
  build372-manual-departure-plan \
  build372-fleet-sale-plan \
  build372-route-normalization-plan \
  build372-fleet-reference-query \
  build372-route-reference-proof \
  build372-startup-normalization-plan \
  build372-startup-staffing-classes \
  build372-finance-initial-allocation \
  build372-legacy-migration-single-pass \
  build372-native-migration-chunk-adoption \
  build372-proof-worker; do
  node "tests/$test.cjs" || exit 1
done
```

اختبارات المتصفح تستخدم Playwright مع Chromium النظام إن لم يجد Playwright نسخته:

```bash
node -e 'const p=require("playwright"); const launch=p.chromium.launch.bind(p.chromium); p.chromium.launch=options=>launch({...options,executablePath:"/usr/bin/chromium",args:["--no-sandbox"]}); require("./tests/build372-dispatch-app-integration.cjs")'
```

كرر النمط مع:

- `build372-fleet-dispatch-worker-browser.cjs`
- `build372-fleet-day-worker-browser.cjs`
- `build372-asset-purchase-worker-browser.cjs`
- `build372-large-health-fallback-browser.cjs`
- `build372-proof-worker-browser.cjs`

بعد نجاح المجموعة المركزة شغّل `npm run test:build362`، ثم حزمة القبول المتاحة في البيئة. سجل Node وChromium ونتائج كل أمر في commit أو artifact مستقل.

---

## 8. المخاطر وما بقي قبل الادعاء بالإغلاق

مرتبة حسب الأولوية:

1. **ربط الشراء الجديد في التطبيق:** ما دام `app.js` يستخدم chunks القديمة، تبقى مشكلة الشيك لكل 512 وسجلات الوثائق المتضخمة قائمة في المنتج.
2. **التحقق من الحفظ ما زال مرشحًا لكتلة مليونية:** `save-schema.js` يطلب classes من العامل، لكن تضمين `id`/`name` يمكن أن يعيد cardinality قريبًا من مليون object عبر `postMessage`. وفوق ذلك، مسار الحفظ العادي وSave Now في `persistence-core.js` يستدعيان تحقق schema من دون provider العامل؛ قد تنفذ خطوة fleet متزامنة داخل `next()`. يلزم إخراج مضغوط من العامل يرسل الأخطاء وملخصات المسارات وأعلام IDs فقط، وربط provider بكل مسارات الحفظ.
3. **التهيئة الأولى للـreplica قد تنسخ 128MB متزامنة:** مسار `newReplica`/`exportReplica` يستطيع نسخ صفوف مليون أصل كاملة، وقد يصل إليه idle render. يجب جعل bootstrap من seed أو نقلًا/نسخًا مرحليًا، وقياس `fullSyncReasons` و`maxFullSyncMs`.
4. **simulation fallback ما زال يستطيع sweep كاملًا على الرئيسي:** عند رفض/غياب العامل يرجع التطبيق إلى `EVENTS.advance`؛ event mode قد يبني heap كبيرًا. للأسطول الكبير يلزم pending/reprime/retry أو fail closed مضبوط بدل المسح الكامل.
5. **routeCenter له fallback رئيسي كامل:** عند غياب العامل أو نتيجة legacy يستطيع `GH_FLEET_QUERY.run('routeCenter')` مسح الأسطول. يجب قصر fallback على أسطول صغير، وإظهار pending مع retry للأحجام الكبيرة.
6. **إعادة اختبار dispatch بعد آخر patch:** اختبارات core/worker/app والطرق الثلاثة مطلوبة. كتلة طريق تقارب 117ms ما زالت تحتاج attribution.
7. **إكمال interactive wiring:** بعض النوى موجودة ومختبرة من دون تمرير proof/current إلى الأمر الحي.
8. **بدء التشغيل:** تطبيع العامل وتأجيل العمل بعد first paint غير مربوطين بالكامل؛ قد تبقى مسوحات startup على الرئيسي.
9. **fallback اليومي:** جواب fleetDay stale أو مفقود قد يرجع إلى المرور الأصلي على الرئيسي للحفاظ على الإقفال. على مليون أصل قد يعيد التجمّد.
10. **عامل الإثباتات:** غيابه يرجع إلى التحقق الأصلي. يجب قياس معدل fallback وعدم تكرار hash الأرشيف كاملًا.
11. **وقت العامل وRSS:** نقل العمل لا يضمن عدم ضغط الذاكرة أو تجويع محرك المحاكاة. لا توجد أرقام جديدة.
12. **التوافق مع الحفظ القديم:** اختبارات الهجرة مركزة؛ يلزم تحميل save واقعي على iPhone، حفظه، إغلاق التطبيق، وإعادة فتحه.
13. **القبول الكامل:** لم يُشغّل بعد على الشجرة النهائية.
14. **تحديث manifests:** يجب توليد hashes بعد آخر تعديل فقط؛ أي تعديل لاحق يبطلها.

معيار القبول ليس اختفاء long task واحد. المطلوب أن تنخفض `worstMs` وp95/p99 و`over50` و`stalls50TotalMs` مع عدم ارتفاع RSS/heap أو زمن العامل بصورة غير مقبولة، وأن تبقى نتائج الوظيفة والrollback والحفظ متطابقة.

---

## 9. خطوات استئناف قياس المليون

### 9.1 ثبت نقطتي المقارنة

بعد اكتمال §8 والاختبارات:

1. ارفع commit الإصلاحات إلى `bdr-design/madar`.
2. أنشئ العلامة:

   ```bash
   git tag -a madar-build372-performance-checkpoint-2026-10-11 -m "Madar Build 372 performance checkpoint"
   git push origin madar-build372-performance-checkpoint-2026-10-11
   ```

3. أنشئ worktree للخط الأساسي `d0bf1c9` أو commit الاستيراد `e3f15ff`، وworktree للعلامة الجديدة.

### 9.2 أعد الخط الأساسي على جهاز القياس نفسه

لا تستخدم أرقام جهاز Linux القديم للمقارنة المباشرة مع جهاز جديد. شغّل الخط الأساسي أولًا، من دون trace ومن دون أي اختبارات أو indexing متزامن:

```bash
export NODE_PATH=/opt/node-tools/node_modules
S=/tmp/madar-perf-baseline
mkdir -p "$S"
GH_PERF_ROOT=$PWD node --max-old-space-size=8192 tools/measure_fullgame_trace.cjs \
  --assets 1000000 --play 90 --days 2 --out "$S/baseline-1m.json" \
  > "$S/baseline-1m.log" 2>&1 &
tools/sample_browser_rss.sh measure_fullgame_trace.cjs "$S/baseline-rss.txt" &
```

بعد انتهاء الخط الأساسي، أعد التشغيل من worktree العلامة بالشروط نفسها:

```bash
S=/tmp/madar-perf-checkpoint
mkdir -p "$S"
GH_PERF_ROOT=$PWD node --max-old-space-size=8192 tools/measure_fullgame_trace.cjs \
  --assets 1000000 --play 90 --days 2 --out "$S/checkpoint-1m.json" \
  > "$S/checkpoint-1m.log" 2>&1 &
tools/sample_browser_rss.sh measure_fullgame_trace.cjs "$S/checkpoint-rss.txt" &
```

### 9.3 افحص المقاييس

لكل مرحلة: الشراء، الإرسال، اللعب، وتقديم الأيام، سجل:

- `worstMs`؛
- p50/p95/p99؛
- `over50` و`stalls50TotalMs`؛
- long tasks وأعلى 20 كتلة؛
- `cpu.mainThreadTaskSeconds`؛
- `heap.peakMB` وRSS للمتصفح والعامل؛
- وقت العامل، `maxWorkerMs`، sync، full sync reasons، stale/unavailable/refusal counts؛
- عدد الشيكات والفواتير وsupplier transactions والتسليمات في شراء 200k؛
- زمن إقفال اليوم وعدد wait/apply stages؛
- حجم `domainRuntime.idempotency` و`documentProofs` بعد السيناريو.

لا تعلن النتيجة قبل التأكد من أن شراء 200k ينشئ مستندًا ماليًا واحدًا فعلًا في التطبيق الحي.

### 9.4 استخدم trace للتشريح فقط

إذا بقيت كتلة:

```bash
# أضف --trace و--profile إلى تشغيل منفصل
python3 tools/attribute_long_tasks.py /tmp/madar-perf-trace/play.trace.json 15
python3 tools/cpuprofile_blocks.py /tmp/madar-perf-trace/dispatch.cpuprofile 8
python3 tools/cpuprofile_blocks.py /tmp/madar-perf-trace/dispatch-advance.cpuprofile 8
```

لا تقارن أرقام تشغيل traced بتشغيل untraced.

---

## 10. علامة الاستئناف العملية

عند تسليم العمل، اكتب في وصف الـcommit النهائي:

- SHA المصدر: `d5fde4e` ثم `d0bf1c9`؛
- SHA الاستيراد في madar: `e3f15ff`؛
- SHA الإصلاحات النهائي؛
- أسماء الاختبارات التي شغلت فعليًا ونتيجتها؛
- عبارة صريحة: `1M measurement: not run` إلى أن يكتمل §9؛
- حالة ربط الشراء والواجهة؛
- رابط هذه الوثيقة.

علامة الاستئناف المقترحة:

`madar-build372-performance-checkpoint-2026-10-11`

إن توقفت الجولة قبل إكمال الربط، ابدأ بالبحث عن:

- `asset-purchase-bulk` و`chunks` في `WebApp/app.js`؛
- `runFleetDispatchStages` و`dispatch-plan-intent`؛
- `fleetDayFromWorker`؛
- `beginMutation`؛
- `fleetUiSummary` و`fleetReferenceUsage`؛
- `startupNormalizationPlan`.

هذه هي نقاط الاتصال التي تفصل النوى الجديدة عن المسارات الحية.
