# تسليم: إعادة تصميم واجهة مدار (فرع `claude/madar-redesign`)

## ابدأ من هنا: الحالة الحالية والمطلوب

### جولة إصلاح بوابة GitHub (فوق `6402c92`)
تشغيل GitHub `38281990679` فشل عند 328/331. الأسباب والإصلاحات:

1. **`build371-air-fleet-series-browser` (مهلة 300 ثانية): سبب حقيقي في اللعبة، لا بطء CI فقط.**
   - القياس: التوزيع (6 أوامر × 20,000 طائرة) استغرق 112 ثانية، والخيط الرئيسي مشغول 16 ثانية منها فقط.
   - السبب: 21,162 تخلّيًا عبر `setTimeout(0)` في `yieldFleetPlanning`. المتصفحات (Chromium وWebKit/iPhone) تفرض 4ms حدًا أدنى على المؤقت المتداخل، فكل شريحة أقل من 1ms كانت تنتظر 4ms خاملة: 92 ثانية من الـ112.
   - الإصلاح: `yieldToEventLoop` في `app.js` يكمل الشرائح عبر `MessageChannel` (بلا حد أدنى) حتى 10ms من كل إطار، ثم ينتظر رسم الإطار (`requestAnimationFrame`، مع مؤقت 50ms للصفحة المخفية). يُستخدم في `yieldFleetPlanning` و`yieldPlanning` (مرشحو المسارات).
   - النتيجة: التوزيع 112 → 21 ثانية، والاختبار 138 → 45 ثانية، بنفس النتائج (280 مسارًا، الحمل 414–429). الإطارات فوق 50ms بقيت 14 مقابل 13 قبل التغيير، وهي من مهام طويلة أخرى لا من التخلّي.
2. **`build372-fleet-day-worker-browser` (`same: null`): سباق في الاختبار.**
   - 5,000 صف أكبر من حد النسخة المتزامنة (2,048)، فتُبنى النسخة على شرائح، والاختبار كان ينتظر 80ms ثابتة.
   - الإصلاح: انتظار `replicaReady` بمهلة 30 ثانية، ثم يفشل برسالة تحمل الإحصاءات.
3. **`build372-asset-purchase-app-browser` (`maxSyncMs` 6.9 > 4.5): توقف GC/جدولة داخل نافذة القياس، لا عمل المزامنة.**
   - أعيد إنتاجه محليًا (4.6–5.9ms). القياس لكل مزامنة: عمل المزامنة 0.1–0.5ms. القيمة الشاذة تقع مرة واحدة في موضع عشوائي من نحو 1,400 مزامنة، وفي مرحلة عشوائية (مرة في كود لا يعمل شيئًا).
   - الإصلاح: `stats.slowSyncs` في `fleet-engine-thread.js` يعدّ المزامنات فوق 4.5ms. الاختبار يشترط 99% من المزامنات ضمن 4.5ms، ولا مزامنة تتجاوز إطارًا كاملًا (16.7ms). محليًا: 0 مزامنة فوق الحد.
4. `eslint.config.cjs`: أضيف `MessageChannel` إلى globals.
5. اختبارات الإيقاف المؤقت للأمر (`build371-durable-fleet-isolation`، `build371-native-update-isolation`، `build371-durable-live-fields`) كانت تمسك أول `setTimeout(0)` داخل أمر التوزيع. صارت تمسك أول `MessagePort.postMessage` داخله، وهو نقطة التخلّي الجديدة نفسها. كل انتظار في `yieldToEventLoop` يحمل معرّفًا خاصًا، فالرسالة الممسوكة لا تُكمل انتظارًا آخر.

- آخر commit: `5cbf2a8`. لم يُدمج شيء في `main`.
- المراحل 3 و4 و5 منفّذة (التفاصيل أدناه). صاحب اللعبة وافق على تصميم المرحلة 3 ولوحة الشركة الأفقية.
- **المطلوب الآن:** IPA عبر بوابات القبول الكاملة (`.github/workflows/build362-unsigned-ipa.yml`)، ثم تسليم رابطه لصاحب اللعبة.
- آخر IPA تجريبي بلا بوابة: https://github.com/bdr-design/madar/actions/runs/38272895878 (commit `0dc21b5`).

### حالة البوابة
- آخر تشغيل محلي على `60b064b` وصل 240 من 331. فشل فيه اختبار واحد فقط: `build334-r2-map-local-dom`، وأُصلح في `5cbf2a8` (يعمل الآن مع `fleetWorker:true`).
- لم يُشغَّل الجزء من 241 إلى 331 على آخر الإصلاحات. في التشغيل الكامل الأول نجحت كلها ما عدا اختبارات أُصلحت لاحقًا.
- أُلغي تشغيل GitHub الأخير (`38276398670`) عمدًا لأنه على commit قبل الإصلاح.

### خطوات الإكمال
1. Node 24.22 (24.19 ينهار على مشغّل macOS بمعالج arm64؛ انظر CURRENT_REVIEW_POINT_AR.md) (من nodejs.org مع التحقق من SHASUMS256)، و`NODE_PATH` يحوي playwright، ومجلد فيه `leaflet/dist/{leaflet.js,leaflet.css}` منسوخ من `WebApp/vendor/leaflet` (يحتاجه `conference-integration`).
2. `python3 tools/run_acceptance.py --output /tmp/acc --node <node24> --timeout 300`. المتوقع 331/331. اختبارات WebKit تعمل على CI فقط.
3. أي تعديل بعدها: `python3 tools/refresh_fingerprints.py` ثم `python3 tools/verify_current_source.py`، ثم أعد `verification/` بـ `git checkout -- verification && git clean -fq verification`، واحذف `tools/__pycache__`.
4. شغّل `build362-unsigned-ipa.yml` على الفرع (workflow_dispatch). ينجح فقط إذا نجحت كل الاختبارات. ثم سلّم رابط artifact `GlobalHoldings_BUILD362_unsigned_TEST_ipa`.

### أخطاء Build 372 أُصلحت أثناء البوابة (كانت على main أيضًا)
- `assetPurchaseBaselineTicket`: الطلب يُربط بمراجعة المتجر (`found.revision`) لا بعدّاد نسخة العامل؛ كان كل شراء كبير يُلغى.
- `fleet-store-core.writeRows({trackIds})` في مزامنة العامل: الصفوف المضافة تدخل فهرس المعرّفات؛ كان الإطلاق بعد الشراء يفشل (`fleet-dispatch-asset-missing`).
- `routeCenterDetails`: `conflict` يُرسل قيمة منطقية؛ كان كائن المتجر يسبب `DataCloneError` فتعلق صفحة المسارات بعد أول إطلاق.
- `applyRoadGeometry`: المعاملة المرحلية تُسجَّل في `activeStagedSlice`؛ كانت حلقة الإطار تلغيها كيتيمة فلا تُطبق مسارات OSRM أبدًا.
- ربط `fleet-main-thread-policy-core.js` (كان غير محمّل): أسطول أكبر من 2,048 لا يتقدم على الخيط الرئيسي عند غياب العامل؛ المحاكاة تتوقف مع تنبيه، وصفحة المسارات تعرض «جارٍ تجهيز بيانات الأسطول».
- إيقاف المحاكاة من تسعير طلب الشراء حتى اعتماده (`assetPurchaseHolds`)، والأسطول الكبير ينتظر العامل بدل الرفض، و`replicaSyncable` للإطلاق.
- اختبارات قديمة حُدّثت لبنية Build 372 دون تخفيف شروطها (تجميع العامل من `importScripts` عبر `tests/helpers/fleet-engine-worker.js`، انتظار بناء النسخة على دفعات، نقطة الإيقاف عند أول yield في الإطلاق).
- `build334-calendar-local-dom` يفشل على main أيضًا وليس في سلسلة `test`؛ لم يُلمس.

## الحالة باختصار
- كل العمل في الفرع `claude/madar-redesign`. لم يُدمج شيء في `main`.
- صاحب اللعبة اعتمد: الخريطة المنعشة + القمر الصناعي، الإطار العائم، لوحة تحكم مستقلة لكل شركة، وأيقونات الاتجاه C (واقعية مجسّمة).
- قاعدة العمل مع صاحب اللعبة: النقاش بالعربي، وعرض كل تصميم عليه قبل تنفيذه، ثم صور من اللعبة بعد كل مرحلة. الأداء أولوية قصوى ("لا ثقل على اللعبة").
- لوحة التصاميم المعتمدة: https://claude.ai/artifact/PG79WGopXPnWGWpQWpJren
- آخر IPA ناجح عبر مسار «IPA only (acceptance gate disabled)»: https://github.com/bdr-design/madar/actions/runs/38249234657 (commit 06f3791).

## ما أُنجز
- المرحلة 0: خرائط `ne2-fresh` (أداة `tools/render_fresh_map_tiles.py`) وثلاثة أنماط (منعش/طبيعي/قمر صناعي)، و42 صورة أقسام في `WebApp/assets/images/ui/`.
- المرحلتان 1 و2: الإطار العائم (`interface-layout.css`)، `madar-shell.js/.css` (لوحة لكل شركة، شريط صفحات القسم، شريط الشركات أسفل اليسار، زر «بالكامل»)، وتحويل اللوحات القديمة المحذوفة (control/governanceHub/systemHub/cyber/safety) إلى أماكنها الجديدة.
- الأيقونات: 100 أيقونة جديدة. المصدر الوحيد `tools/madar_icons.py`، وهو يولّد `WebApp/madar-icons.css` (صور SVG مخزّنة، class `ic-<key>`) و`WebApp/madar-icons.js` (`GH_ICONS.tile/glyph/inline`). حُذف الـ sprite القديم وأيقونات الإيموجي من العرض.
- الأداء: القياس بـ `tools/measure_ui_weight.cjs` مقابل main. النتائج: إطارات أبطأ من 50ms أثناء اللعب 0–1 (main: 9–16)، و1.4MB صور (main: 3.7MB).

## العمل الجاري: تشغيل بوابات القبول الكاملة ثم بناء IPA
صاحب اللعبة طلب IPA عبر workflow البوابات الكاملة (`.github/workflows/build362-unsigned-ipa.yml`). البوابة كانت تفشل على main نفسه منذ Build 372، بسبب اختبارات قديمة لم تُحدَّث بعد إعادة الهيكلة.

أُصلح الآتي في هذا التسليم:
- `runtime-required.json`: أضيفت 18 ملفًا أساسيًا كانت ناقصة.
- اختبارات نصّية حُدِّثت لبنية Build 372 مع الحفاظ على قصدها:
  - air-sea-network-worker
  - app-platform-authorization
  - procurement-batch
  - durable-draft-restore
  - corridor-index
- هارنس:
  - `queueFleetMaintenance` في `tests/helpers/fleet-simulation-adapter.js` و build336.
  - تحميل `simulation-asset-core` في fleet-regressions.
  - مزوّد تحقق الأسطول في native-chunked-save.
  - انتظار إطار قبل النقر في row-snapshot-rollback.
- خيار جديد `boot({fleetWorker:true})` في `tests/helpers/local-dom-app.js` (المصدر في `tests/helpers/fleet-engine-worker.js`). مُفعّل في اختبارات الأساطيل الكبيرة، لأن صفحة الاختبار بلا عنوان ملف فلا يعمل Worker المحرك.
- build371-native-update-isolation: نقطة الإيقاف صارت أول yield في أمر الإرسال البحري. **لم يُشغَّل بعد التعديل.**

الخطوات المتبقية:
1. شغّل البوابة كاملة محليًا على Node 24.22 وأضف `NODE_PATH` الذي يحوي playwright:
   `python3 tools/run_acceptance.py --output /tmp/acc --node <node24> --timeout 300`
   - آخر تشغيل وصل إلى 246/330 قبل إيقافه. أعد التشغيل وتحقق من الاختبارات المعدّلة أعلاه ومن البقية بعد 246.
   - مرّت منفردة: build358-row-snapshot-rollback، native-chunked-save، fleet-regressions، build336، build339، 600-air-calendar.
   - لم تُعد بعد مع `fleetWorker`: 362-bulk-asset-purchase، 371-air-destination-pool، 371-air-fleet-series، 371-air-destination-pool-riyadh، 371-durable-fleet-isolation، 358-large-fleet-dispatch.
   - 358-fleet-engine-thread-browser انتهى بمهلة، وغالبًا السبب ضغط المعالج. أعد تشغيله منفردًا.
2. اختبارات WebKit لا تعمل محليًا هنا، ويشغّلها CI.
3. بعد النجاح:
   - شغّل `tools/refresh_fingerprints.py` (مرّر أي ملف جديد كوسيط).
   - شغّل `tools/verify_current_source.py`.
   - أعد `verification/` بـ `git checkout -- verification && git clean -fq verification`.
   - commit و push.
4. شغّل `build362-unsigned-ipa.yml` على الفرع، وسلّم رابط artifact الـ IPA لصاحب اللعبة.

## المراحل 3 و4 و5 (هذا التسليم)
- لوحة التصاميم المعتمدة للمرحلة 3: https://claude.ai/artifact/36HneTjcxFsWz96JR7USyC
- المرحلة 3:
  - لكل قسم لوحة تحكم: `groupHub` و`financeHub` و`peopleHub` و`leadershipHub` و`systemHub` في `madar-shell.js`.
  - الشريط الجانبي وزر الإعدادات يفتحون هذه اللوحات.
  - لوحات الشركات والأقسام تتبع نفس الترتيب الأفقي، مع زر «يحتاج قرارك».
- المرحلة 4:
  - ترجمة الشارات الإنجليزية في الواجهة. المستندات الرسمية بقيت بعناوينها الإنجليزية.
  - الأرقام والتواريخ في الواجهة صارت بالأرقام الغربية (`nu-latn`). المستندات بقيت بالأرقام العربية.
  - تقسيم الصفحات الطويلة:
    - الكتالوج يفتح على أول فئة.
    - الدفاتر صارت ثلاث صفحات (`finance` و`finance:transfers` و`finance:statements`).
    - صفحة الميزانيات صارت قائمة قصيرة، ومحرر كل شركة يفتح بـ `{company}` داخل قسم المال.
    - الدليل العالمي يعرض 8 مواقع في الصفحة.
- المرحلة 5:
  - اختبار `tests/build373-reach-browser.cjs` يمر: كل صفحات الأقسام والشركات (125 صفحة) خلال نقرتين.
  - القياس بأداة `measure_ui_weight.cjs` مقابل المرحلة 2، مرتين لكل نسخة:
    - فتح الأفراد 75–88ms بدل 38–44، والمجموعة 79–80 بدل 56–58 (الصور).
    - المال 67–84ms بدل 192–215، والدفاتر 125–142.
    - اللعب بلا فرق واضح عن التذبذب.
    - الصور 1.98MB (المرحلة 2: 1.37MB، وmain: 3.35MB).
- اختبارات فاشلة قبل هذه التعديلات (على المرحلة 2 وعلى main):
  - `build362-bulk-asset-purchase-browser`: يحتاج `fleetWorker`.
  - `build334-calendar-local-dom`: ليس في سلسلة `test`.
- البيئة: `conference-integration` يحتاج `leaflet/dist` في `NODE_PATH`. انسخه من `WebApp/vendor/leaflet`.

## المتبقي
- بوابات القبول الكاملة ثم IPA (الخطوات أعلاه).

## المراحل القادمة (بعد موافقته) (أُنجزت أدناه، تُركت للمرجع)
- المرحلة 3: أقسام المجموعة/المال/الأفراد/الإدارة/النظام بنفس الأسلوب. يجب إصلاح كسر الكلمات في بطاقات الأقسام على الشاشات الضيقة.
- المرحلة 4: الصفحات الداخلية.
  - ترجمة الشارات الإنجليزية (مثل OWNED ONLY).
  - توحيد الأرقام اللاتينية في الواجهة، لأن «٠» يبدو نقطة في خط Kufi (لا تلمس المستندات).
  - تقسيم الصفحات الطويلة.
- المرحلة 5: اختبار الوصول لكل صفحة خلال 3 نقرات، ومقارنة أحجام المستندات، والقياس بـ `measure_ui_weight.cjs`، ثم IPA.
