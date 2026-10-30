'use strict';
// أصول ونفوذ | ASSETS & INFLUENCE (owner: the game's name and logo «أصول ونفوذ / ASSETS & INFLUENCE», «غير مايلزم باللعبة
// كامله»; the stock group «أصول ونفوذ القابضة», the short name ANI, the home screen name «أصول ونفوذ»): the name changes
// everywhere the player sees it; the technical identifiers (store product ids, packages, the
// keychain service, the save keys, class names) stay, so saves, purchases and the device key still open. Proven on the
// real sources (Node, no browser):
//  1. the stock group and its 15 companies carry the new name in Arabic, English and short (أصول ونفوذ / Assets & Influence
//     / ANI), each trade name the group brand's own rule, and each keeps its old names (فنتورا, Ventora, VH and the Global
//     Holdings ones) among its legacy names;
//  2. an old save takes the new names on load: the group of an old name (فنتورا القابضة, المجموعة العالمية القابضة) with
//     its English and short names, and every company still carrying an old stock name, in each name field; a name the
//     player chose stays (record.customName, a typed name, a custom group name), the contract signed then keeps the name
//     it was signed with, the game's random seed stays the old name's, and loading again changes nothing;
//  3. a branded group (العساف) still renames a company of an old stock name to its own brand;
//  4. the player sees the new name: the page title, the founding screen (wordmark in both languages, default names), the
//     store's Plus titles, the identity labels; no string the player sees in the web app, the iPhone app or
//     the Android app says VENTORA/فنتورا (comments and the legacy name lists aside);
//  5. the apps: the home screen name is «أصول ونفوذ» on both, the release IPA check expects it, and the identifiers stay.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..'),web=path.join(ROOT,'WebApp');
const read=file=>fs.readFileSync(path.join(ROOT,file),'utf8');
for(const file of ['capability-registry-core','company-definitions','company-platform-core','determinism-core'])require(path.join(web,`${file}.js`));
const P=globalThis.GH_COMPANY_PLATFORM,OLD=/فنتورا|Ventora|VENTORA|أبهيب|Upheap|UPHEAP/;
// 1.
const group=P.getDefinition('group').identity;
assert.deepEqual([group.legalDefault.ar,group.legalDefault.en,group.trade.ar,group.trade.en,group.short],['أصول ونفوذ القابضة','Assets & Influence Holdings Group','أصول ونفوذ','Assets & Influence','ANI']);
for(const name of ['فنتورا القابضة','Ventora Holdings Group','VH','المجموعة العالمية القابضة','Global Holdings Group','GH'])assert.ok(group.legacyLegalNames.includes(name),`1: the group keeps ${name}`);
const subsidiaries=P.listDefinitions().filter(row=>row.kind==='subsidiary'&&row.lifecycle==='active');assert.equal(subsidiaries.length,15);
for(const row of subsidiaries){const id=row.identity;
  assert.match(id.legalDefault.ar,/^شركة أصول ونفوذ /,`1: ${row.id} legal`);assert.match(id.legalDefault.en,/^Assets & Influence /,`1: ${row.id} English`);assert.match(id.short,/^ANI /,`1: ${row.id} short`);
  assert.equal(id.trade.ar,P.brandedIdentity({profile:{name:'أصول ونفوذ',shortName:'ANI'},companyRegistry:{}},row.id).tradeName,`1: ${row.id} trade name by the brand rule`);
  for(const value of [id.legalDefault.ar,id.legalDefault.en,id.trade.ar,id.trade.en,id.short])assert.doesNotMatch(value,OLD);
  const old=id.legalDefault.ar.replace('أصول ونفوذ','فنتورا');assert.ok(id.legacyLegalNames.includes(old)&&id.legacyLegalNames.includes(id.legalDefault.en.replace('Assets & Influence','Ventora'))&&id.legacyLegalNames.includes(id.short.replace(/^ANI/,'VH')),`1: ${row.id} keeps its old names`);
}
// 2. An old save.
const base=()=>({simSeconds:86400*40,onboardingComplete:true,openedCompanies:['air','sea','road','bank','media'],profile:{name:'فنتورا القابضة',shortName:'VH',englishName:'Ventora Holdings Group',founder:'سالم'},
  companyRegistry:{group:{legalName:'فنتورا القابضة',shortName:'VH'},
    air:{legalName:'شركة فنتورا للطيران',tradeName:'فنتورا إير',shortName:'VH AIR',englishName:'Ventora Aviation Company',formationPlan:{identity:{legalName:'شركة فنتورا للطيران'}},taxId:'VH-AIR-1A2B3C'},
    sea:{legalName:'شركة فنتورا للشحن البحري',shortName:'VH MARINE',customName:true},
    road:{legalName:'نقليات الخليج',shortName:'NKL'},
    bank:{legalName:'شركة جلوبال هولدينغز المصرفية',shortName:'GH BANK'},
    media:{legalName:'شركة فنتورا للإعلام والإنتاج',shortName:'VH MEDIA'}},
  hired:[],assets:[],globalBases:[],customHubs:[],branches:[],customRoutes:[]});
const migrated=P.migrateState(base()).state,r=migrated.companyRegistry;
assert.deepEqual([migrated.profile.name,migrated.profile.shortName,migrated.profile.englishName],['أصول ونفوذ القابضة','ANI','Assets & Influence Holdings Group'],'2: the group');
assert.deepEqual([r.group.legalName,r.group.shortName],['أصول ونفوذ القابضة','ANI'],'2: the group record');
assert.deepEqual([r.air.legalName,r.air.tradeName,r.air.shortName,r.air.englishName],['شركة أصول ونفوذ للطيران','أصول ونفوذ للطيران','ANI AIR','Assets & Influence Aviation Company'],'2: every name field of a company');
assert.deepEqual([r.bank.legalName,r.bank.shortName],['شركة أصول ونفوذ المصرفية','ANI BANK'],'2: a Global Holdings name too');
assert.deepEqual([r.media.legalName,r.media.shortName],['شركة أصول ونفوذ للإعلام والإنتاج','ANI MEDIA'],'2: a new service company');
assert.deepEqual([r.sea.legalName,r.sea.shortName],['شركة فنتورا للشحن البحري','VH MARINE'],'2: a name the player chose stays (customName)');
assert.deepEqual([r.road.legalName,r.road.shortName],['نقليات الخليج','NKL'],'2: a typed name stays');
assert.equal(r.air.formationPlan.identity.legalName,'شركة فنتورا للطيران','2: the contract keeps the name it was signed with');assert.equal(r.air.taxId,'VH-AIR-1A2B3C','2: an issued number stays');
for(const id of ['air','bank','media'])assert.equal(P.resolveIdentity(migrated,id).legalName,r[id].legalName,`2: ${id} shows its new name`);
assert.equal(P.resolveIdentity(migrated,'group').legalName,'أصول ونفوذ القابضة');
const again=P.migrateState(structuredClone(migrated));assert.equal(JSON.stringify(again.state),JSON.stringify(migrated),'2: loading again changes nothing');
const global=P.migrateState({...base(),profile:{name:'المجموعة العالمية القابضة',shortName:'GH',englishName:'Global Holdings Group'}}).state.profile;
assert.deepEqual([global.name,global.shortName,global.englishName],['أصول ونفوذ القابضة','ANI','Assets & Influence Holdings Group'],'2: the older Global Holdings group');
const typedEnglish=P.migrateState({...base(),profile:{name:'فنتورا القابضة',shortName:'FNT',englishName:'Fintora Group'}}).state.profile;
assert.deepEqual([typedEnglish.name,typedEnglish.shortName,typedEnglish.englishName],['أصول ونفوذ القابضة','FNT','Fintora Group'],'2: a short and English name the player typed stay');
// The random seed of a save without one comes from the group's name (GH_DETERMINISM): the old name's, so the new name
// changes no draw of an old game; a save with its seed keeps it.
const D=globalThis.GH_DETERMINISM,oldSeed=D.ensure({profile:{name:'فنتورا القابضة'}}).seed;assert.notEqual(oldSeed,D.ensure({profile:{name:'أصول ونفوذ القابضة'}}).seed);
assert.equal(migrated.determinism?.seed,oldSeed,'2: the old name keeps its seed');
assert.equal(P.migrateState({...base(),determinism:{seed:12345,streams:{}}}).state.determinism.seed,12345,'2: a saved seed stays');
const custom=P.migrateState({...base(),profile:{name:'فنتورا للتجارة',shortName:'FT'}}).state;
assert.equal(custom.profile.name,'فنتورا للتجارة','2: a custom group name stays');
// 3. A branded group renames a company of an old stock name to its brand.
const branded={profile:{name:'العساف',shortName:'ASF'},companyRegistry:{air:{legalName:'شركة فنتورا للطيران'},sea:{legalName:'شركة أصول ونفوذ للشحن البحري'}}};
P.syncBrandedNames(branded);assert.equal(branded.companyRegistry.air.legalName,'شركة العساف للطيران','3: an old stock name follows the brand');assert.equal(branded.companyRegistry.sea.legalName,'شركة العساف للشحن البحري','3: the new stock name too');
// 4. What the player sees.
const html=read('WebApp/index.html');
assert.match(html,/<title>أصول ونفوذ · ASSETS &amp; INFLUENCE<\/title>/);assert.match(html,/name="apple-mobile-web-app-title" content="أصول ونفوذ"/);
assert.match(html,/class="incorporation-wordmark"><b class="incorporation-wordmark-ar">أصول ونفوذ<\/b><span dir="ltr">ASSETS &amp; INFLUENCE<\/span>/,'4: the founding wordmark in both languages');
assert.match(read('WebApp/founding.css'),/\.incorporation-wordmark-ar\{font:inherit;letter-spacing:0\}/,'4: the Arabic wordmark joins (no letter spacing)');
assert.match(html,/id="founderName"[^>]*value="أصول ونفوذ القابضة"/);assert.match(html,/id="founderShort"[^>]*value="ANI"/);assert.match(html,/<strong id="groupName">أصول ونفوذ القابضة<\/strong>/);
const store=require(path.join(web,'store-core.js'));const titles=JSON.stringify(store.PRODUCTS||store.products?.()||read('WebApp/store-core.js'));
assert.match(titles,/أصول ونفوذ بلس · شهري/);assert.match(titles,/أصول ونفوذ بلس · سنوي/);
assert.match(read('WebApp/identity-system.js'),/labels:\{ar:\{short:'ANI',display:'أصول ونفوذ',legal:'أصول ونفوذ',map:'ANI'\},en:\{short:'ANI',display:'ASSETS & INFLUENCE',legal:'ASSETS & INFLUENCE',map:'ANI'\}\}/);
// No string literal the player can see names the old game (comments and the legacy name lists aside).
const literal=/(['"`])((?:(?!\1)[^\\\n]|\\.)*?)\1/g,code=text=>text.replace(/\/\*[\s\S]*?\*\//g,'').split('\n').filter(line=>!/^\s*(\/\/|\*|#)/.test(line)).join('\n');
const visible=(file,allow=()=>false)=>{const found=[];for(const m of code(read(file)).matchAll(literal))if(OLD.test(m[2])&&!allow(m[2]))found.push(m[2]);return found;};
const webFiles=fs.readdirSync(web).filter(name=>/\.(js|html|css)$/.test(name)&&!['company-definitions.js','company-platform-core.js'].includes(name));
for(const name of webFiles)assert.deepEqual(visible(`WebApp/${name}`),[],`4: WebApp/${name}`);
const legacy=new Set(['فنتورا القابضة','المجموعة العالمية القابضة','Ventora Holdings Group','Global Holdings Group']);
assert.deepEqual(visible('WebApp/company-platform-core.js',value=>legacy.has(value)),[],'4: the platform core names only the legacy group names');
const defs=read('WebApp/company-definitions.js');for(const m of defs.matchAll(/identity:identity\(((?:'[^']*',){5})/g))assert.doesNotMatch(m[1],OLD,'4: the definitions use the old names only as legacy names');
const swift=fs.readdirSync(path.join(ROOT,'iOS/GlobalHoldings')).filter(name=>name.endsWith('.swift'));
for(const name of swift)assert.deepEqual(visible(`iOS/GlobalHoldings/${name}`).filter(value=>/VENTORA|فنتورا|UPHEAP|أبهيب/.test(value)),[],`4: iOS ${name}`);
const kotlinDir=path.join(ROOT,'android/app/src/main/java/com/ventora/game');
for(const name of fs.readdirSync(kotlinDir).filter(name=>name.endsWith('.kt')))assert.deepEqual(visible(`android/app/src/main/java/com/ventora/game/${name}`).filter(value=>/VENTORA|فنتورا|UPHEAP|أبهيب/.test(value)),[],`4: Android ${name}`);
// 5. The apps.
const project=read('project.yml');assert.match(project,/CFBundleDisplayName: "أصول ونفوذ"/);assert.match(project,/CFBundleTypeName: "Assets & Influence Update"/);assert.doesNotMatch(project,/"VENTORA/);
assert.match(read('android/app/src/main/res/values/strings.xml'),/<string name="app_name">أصول ونفوذ<\/string>/);
assert.match(read('.github/workflows/ventora-release-ipa.yml'),/info\.get\('CFBundleDisplayName'\)!='أصول ونفوذ'/,'5: the release IPA check expects the new name');
const pack=read('iOS/GlobalHoldings/VentoraPack.swift');assert.ok(pack.includes('"com.ventora.save-secret"')&&pack.includes('"ventora-save-seal-v2"')&&pack.includes('"ventora-save-file-v1"'),'5: the device key and the save keys stay');
assert.match(read('android/app/src/main/java/com/ventora/game/DeviceSealKey.kt'),/"ventora-save-seal-wrap-v1"/);assert.match(read('android/app/src/main/java/com/ventora/game/MainActivity.kt'),/"VentoraAndroid"/);
assert.match(read('android/app/build.gradle.kts'),/ventoraProp\("ventora.applicationId"\)/,'5: the package settings stay');
console.log(JSON.stringify({suite:'build644-game-name',ok:true,companies:subsidiaries.length,webFiles:webFiles.length,swift:swift.length}));
