'use strict';
// Owner («امنع تصوير الشاشة باللعبة» → «نسخة المتجر فقط»): the store edition protects the game's screen; the
// development edition stays capturable (store listing images, bug reports). Read from the native sources:
//   1. Android: the store edition's window is secure (FLAG_SECURE: screenshots, recordings and the recent-apps thumbnail
//      show nothing), set in onCreate before any content is shown, only when the edition is the store's, and never
//      cleared;
//   2. iOS: in the store edition only, iOS's own capture notice (UIScreen.capturedDidChangeNotification, on the main
//      queue) shows a cover over the game while the screen is recorded, mirrored or sent by AirPlay, and removes it when
//      that stops; the state is read when the view loads and appears, and again whenever the app becomes active (a
//      capture that ended while the app was suspended); the cover stays above the entry screen and the
//      game page; nothing polls (no timer, no display link) and no private secure-field trick is used;
//   3. the cover's texts are written in both languages.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ROOT=path.join(__dirname,'..');
const kotlin=fs.readFileSync(path.join(ROOT,'android/app/src/main/java/com/ventora/game/MainActivity.kt'),'utf8');
const swift=fs.readFileSync(path.join(ROOT,'iOS/GlobalHoldings/GameViewController.swift'),'utf8');
const block=(src,head)=>{const start=src.indexOf(head);assert.ok(start>=0,`${head} exists`);let depth=0,i=src.indexOf('{',start);const from=i;for(;i<src.length;i++){if(src[i]==='{')depth++;else if(src[i]==='}'){depth--;if(!depth)break;}}return src.slice(from,i+1);};
// 1.
{const create=block(kotlin,'override fun onCreate(');
  assert.match(kotlin,/^import android\.view\.WindowManager$/m);
  assert.match(create,/val release = BuildConfig\.EDITION == "release"[\s\S]*?\n\s*if \(release\) window\.setFlags\(WindowManager\.LayoutParams\.FLAG_SECURE, WindowManager\.LayoutParams\.FLAG_SECURE\)\n/,'1: the store edition sets FLAG_SECURE');
  assert.ok(create.indexOf('FLAG_SECURE')<create.indexOf('setContentView('),'1: before any content is shown');
  assert.equal((kotlin.match(/FLAG_SECURE/g)||[]).length,2,'1: set in one place');
  const androidRoot=path.join(ROOT,'android/app/src/main/java/com/ventora/game');
  for(const name of fs.readdirSync(androidRoot).filter(f=>f.endsWith('.kt'))){const src=fs.readFileSync(path.join(androidRoot,name),'utf8');assert.doesNotMatch(src,/clearFlags\([^)]*FLAG_SECURE|addFlags\([^)]*FLAG_SECURE/,`1: ${name} never clears or re-adds it`);}
  assert.match(fs.readFileSync(path.join(ROOT,'android/app/build.gradle.kts'),'utf8'),/buildConfigField\("String", "EDITION", "\\"release\\""\)/,'1: the store build is the release edition');}
// 2.
{assert.match(block(swift,'override func viewDidLoad()'),/observeScreenCapture\(\)/,'2: observed when the view loads');
  assert.match(block(swift,'override func viewDidAppear('),/updateCaptureCover\(\)/,'2: read again when the view appears (its screen is known then)');
  const observe=block(swift,'private func observeScreenCapture()');
  assert.match(observe,/^\{\s*guard ventoraReleaseEdition, captureObservers\.isEmpty else \{ return \}/,'2: store edition only, once');
  assert.match(observe,/for name in \[UIScreen\.capturedDidChangeNotification, UIApplication\.didBecomeActiveNotification\] \{\s*captureObservers\.append\(NotificationCenter\.default\.addObserver\(forName: name, object: nil, queue: \.main\) \{ \[weak self\] _ in\s*self\?\.updateCaptureCover\(\)/,'2: iOS\'s capture notice and every return to the app, on the main queue');
  const update=block(swift,'private func updateCaptureCover()');
  assert.match(update,/^\{\s*guard ventoraReleaseEdition else \{ return \}/,'2: never in the development edition');
  assert.match(update,/let captured = \(view\.window\?\.windowScene\?\.screen \?\? UIScreen\.main\)\.isCaptured\s*if !captured \{\s*captureCover\?\.removeFromSuperview\(\)\s*return\s*\}/,'2: removed when the capture stops');
  assert.match(update,/view\.addSubview\(cover\)[\s\S]*cover\.topAnchor\.constraint\(equalTo: view\.topAnchor\)[\s\S]*cover\.bottomAnchor\.constraint\(equalTo: view\.bottomAnchor\)[\s\S]*captureCover = cover/,'2: a full-screen cover');
  assert.match(update,/cover\.backgroundColor = ventoraSky/,'2: the game\'s navy');
  assert.match(block(swift,'override func viewDidLayoutSubviews()'),/if let cover = captureCover, view\.subviews\.last !== cover \{ view\.bringSubviewToFront\(cover\) \}/,'2: above the entry screen and the game page');
  for(const part of [observe,update])assert.doesNotMatch(part,/Timer|CADisplayLink|asyncAfter|isSecureTextEntry/,'2: no polling, no secure-field trick');
  assert.doesNotMatch(swift,/isSecureTextEntry/,'2: no secure-field trick anywhere');
  // 3.
  assert.match(update,/title\.text = arEn\("أصول ونفوذ", "Assets & Influence"\)/);
  assert.match(update,/note\.text = arEn\("تسجيل الشاشة وعرضها غير متاحين في اللعبة\.", "Screen recording and mirroring are not available in the game\."\)/,'3: the cover\'s note in both languages');}
console.log(JSON.stringify({suite:'build655-store-capture-protection',ok:true}));
