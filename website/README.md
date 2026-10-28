# موقع فنتورا وصقر الوادي

صفحة رسمية واحدة للعبتين، بالعربية والإنجليزية (زر EN / عربي أعلى الصفحة، ويُحفظ الاختيار في المتصفح). المحتوى والصور من أحدث فروع اللعبتين:

- فنتورا: `bdr-design/madar`، الفرع `claude/madar-ventora-handover-3.0.0-stg723`
- صقر الوادي: `bdr-design/saqr-alwadi`، الفرع `claude/f15-cockpit-clarity-fyvgd7`

## التشغيل

```bash
cd website
python3 -m http.server 8000     # ثم افتح http://localhost:8000
```

لا تحتاج الصفحة إلى بناء. الخطوط من Google Fonts، وبقية الملفات في `index.html` و`assets/`.

## إضافة طائرة إلى الحظيرة

أضف عنصرًا إلى المصفوفة `AIRCRAFT` في `index.html`، وحدد `cat: 'rotary'` للعمودي أو `cat: 'jet'` للنفاث. يُكتب لكل طائرة الاسم والصور والمقاعد (`soon: true` للمقعد القادم) والمواصفات بالعربية والإنجليزية.

## الترجمة

كل نص عربي في الصفحة يحمل ترجمته في `data-en`، والنص البديل للصور في `data-en-alt`، ووصف العناصر في `data-en-aria`. النصوص التي يكتبها السكربت في القاموس `T`.

## الصور

| الملف | المصدر |
|---|---|
| `assets/ventora_key*.webp` و`ventora_logo.webp` و`ventora_icon.webp` | `Release/` في فنتورا (صورة الإطلاق والشعار والأيقونة) |
| `assets/v_*.webp` | `WebApp/assets/images/ui/` في فنتورا |
| `assets/world.webp` | بلاطات `ne2-fresh/3` مدموجة ومقصوصة |
| `assets/s_key_*.webp` و`s_ah64_*` و`s_f15_shelter.webp` | `assets/originals/menu/` في صقر الوادي، بدقتها الأصلية |
| `assets/s_f15_cockpit*.webp` | `assets/originals/cockpit/f15ex_day_2x.png` بعد إزالة الخلفية الوردية والخضراء |
| `assets/s_tedac.webp` | `docs/img/weapons-2-tedac.jpg` |
| `assets/s_map_*` و`s_k_*` | `sprites/menu/` في صقر الوادي |
| `assets/valley.jpg` | `tiles/1/` مدموجة (×2) ومصغّرة إلى 2600 بكسل |
| `assets/car_*.png` | `sprites/` في صقر الوادي |
