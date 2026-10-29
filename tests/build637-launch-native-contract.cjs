'use strict';
// Owner (approved design, «تجهيز الآيفون للإطلاق» and «تجهيز الأندرويد»): the native shells and the game agree. Read from
// the sources (no build here; the iPhone and Android builds run on CI):
//  1. the store products are the same in the game (GH_STORE_CORE), the iPhone's StoreKit 2 owner and the Android Play
//     Billing owner; Android consumes exactly the capital packs and the starter pack and subscribes exactly to Plus;
//  2. the iPhone registers the storeBridge handler, owns it in VentoraStore, delivers only verified transactions and
//     finishes one only on the game's `finish`;
//  3. the privacy manifest declares no tracking and the required-reason APIs the shell uses, and is a bundle resource;
//  4. the store-release workflow selects Xcode 26 (iOS 26 SDK) before any build, removes the update document types from
//     the store edition, sets the bundle id from its input, and signs and uploads only when the Apple secrets exist;
//  5. Android targets API 36 from API 29, uses Play Billing 8 or later, serves the WebApp from its assets on the secure
//     local origin, refuses unsealed scripts in the release edition, injects the bridge before the game's first script,
//     verifies each purchase's signature, keeps no cloud backup of saves, and its workflow builds a debug APK and a
//     sealed, smoke-tested release AAB; the release key is written for Kotlin by the same tool as for Swift.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(ROOT,p),'utf8');
const {harness}=require('./helpers/core-harness');const h=harness([]);h.load('store-core');const S=h.s.GH_STORE_CORE;
const products=Object.keys(S.PRODUCTS).sort();
// 1.
const swift=read('iOS/GlobalHoldings/VentoraStore.swift'),kotlin=read('android/app/src/main/java/com/ventora/game/StoreBilling.kt');
const swiftIds=JSON.parse('['+swift.match(/static let productSuffixes = \[([\s\S]*?)\]/)[1]+']').sort();assert.deepEqual(swiftIds,products,'1: StoreKit lists the game\'s products');
const list=name=>[...kotlin.match(new RegExp(`private val ${name} = (?:setOf|listOf)\\(([^)]*)\\)`))[1].matchAll(/"([^"]+)"/g)].map(m=>m[1]);
const consumable=list('CONSUMABLE').sort(),subs=list('SUBS').sort(),inapp=[...kotlin.match(/private val INAPP = listOf\(([^)]*)\)/)[1].matchAll(/"([^"]+)"/g)].map(m=>m[1]);
assert.deepEqual([...consumable,...subs,...inapp].sort(),products,'1: Play Billing lists the game\'s products');
assert.deepEqual(consumable,products.filter(id=>['consumable','once'].includes(S.PRODUCTS[id].kind)),'1: Android consumes the capital packs and the starter pack (once per game, kept in the save; never owned on Play to be delivered again)');
assert.deepEqual(subs,products.filter(id=>S.PRODUCTS[id].kind==='subscription'),'1: Android subscribes to Plus');
// 2.
const controller=read('iOS/GlobalHoldings/GameViewController.swift');
assert.ok(controller.includes('configuration.userContentController.add(self, name: "storeBridge")'),'2: the handler is registered');
assert.ok(/if message\.name == "storeBridge" \{\s*store\?\.handle\(action: action, payload: payload\)/.test(controller),'2: VentoraStore owns it');
assert.ok(controller.indexOf('message.frameInfo.isMainFrame')<controller.indexOf('if message.name == "storeBridge"'),'2: only the main game document reaches it');
assert.ok(swift.includes('guard case .verified(let transaction) = verification else { return }'),'2: only verified transactions are delivered');
assert.ok(/case "finish":[\s\S]*?pending\.removeValue\(forKey: id\)[\s\S]*?transaction\.finish\(\)/.test(swift)&&(swift.match(/\.finish\(\)/g)||[]).length===1,'2: a transaction (delivered or refunded) is finished only on the game\'s answer');
assert.ok(/if transaction\.revocationDate != nil \{\s*send\("onRevocation"/.test(swift)&&swift.indexOf('pending[transaction.id] = transaction')<swift.indexOf('send("onRevocation"'),'2: (owner «نعم تسحب») a refund goes to the game and waits for its answer');
assert.ok(kotlin.includes('send("onOwned", JSONObject().put("store", "play").put("products", owned)')&&(kotlin.match(/\.put\("store", "play"\)/g)||[]).length===3,'5: Play reports what the account owns (a refunded lifetime purchase is no longer listed) and every Play delivery is marked');
// 2b. (approved security layer 1) the iPhone's saves are sealed and encrypted under this device's own Keychain secret, not
// the build's pack key (a new one each build, which refused every save after an update); every vault JSON file is written
// encrypted and read decrypted, the write is verified against the stored bytes, and the chunk collector reads ids only
// from decrypted files (an unreadable file stops the pass, so a referenced chunk is never deleted).
const release=read('.github/workflows/ventora-release-ipa.yml'),pack=read('iOS/GlobalHoldings/VentoraPack.swift'),vaultSwift=read('iOS/GlobalHoldings/GlobalSaveVault.swift'),sealPart=pack.slice(pack.indexOf('enum VentoraSaveSeal'));
assert.ok(sealPart.includes('static var secretProvider: () -> Data? = VentoraDeviceSecret.load')&&!sealPart.includes('VentoraReleaseKey'),'2b: the save key is the device secret, never the pack key');
assert.ok(pack.includes('kSecAttrAccessibleAfterFirstUnlock')&&pack.includes('kSecAttrSynchronizable as String: false')&&pack.includes('guard found.status == errSecItemNotFound else { return nil }'),'2b: a Keychain secret made only when definitely absent');
assert.ok(sealPart.includes('AES.GCM.seal(plain, using: key, authenticating: fileContext)')&&sealPart.includes('guard required else { return stored }'),'2b: release files are AES-GCM; development files stay plain');
assert.ok(/func sealForWrite[\s\S]*?guard let value = seal\(payload\) else \{ throw Unavailable\(\) \}/.test(sealPart),'2b: a release save is never written unsealed');
assert.equal((vaultSwift.match(/VentoraSaveSeal\.fileBytes\(/g)||[]).length,5,'2b: A/B, rollback, manual slot and both reset checkpoints are written encrypted');
assert.ok(!/seal: VentoraSaveSeal\.seal\(/.test(vaultSwift),'2b: every new seal goes through sealForWrite');
assert.ok(vaultSwift.includes('written == stored')&&vaultSwift.includes('let data = VentoraSaveSeal.plainBytes(stored) else { scanSucceeded = false; break }'),'2b: the write is checked against the stored bytes; the collector scans decrypted files');
assert.equal((vaultSwift.match(/VentoraSaveSeal\.plainBytes\(/g)||[]).length,5,'2b: every vault JSON read decrypts (envelope, manual slot, rollback, reset checkpoint, collector)');
assert.ok(release.includes('check(original.range(of: Data("cash".utf8)) == nil')&&release.includes('check(vault.currentSave() == nil, "an edited save is refused")'),'2b: the release workflow proves an encrypted, unreadable, edit-refusing save');
// 2c. (approved security layers 3 and 4) the release key is written as four shares scattered over one table in a per-build
// order (no readable key array); the shells read device signals once at launch (never during play) and the diagnostic
// file carries them; nothing is refused on them alone.
const tool=read('tools/release/build-release-webapp.cjs'),handler=read('android/app/src/main/java/com/ventora/game/GameAssetHandler.kt');
assert.ok(tool.includes('private static let parts: [UInt8]')&&tool.includes('private val order = intArrayOf(')&&!tool.includes('private static let second'),'2c: the release key is scattered shares, not two halves');
assert.ok(pack.includes('enum VentoraDeviceIntegrity')&&pack.includes('guard ventoraReleaseEdition else { return "" }')&&vaultSwift.includes('VentoraDeviceIntegrity.script'),'2c: the iPhone reads its device signals once, in the release edition, with the first page');
assert.ok(handler.includes('append(DeviceIntegrity.script)')&&read('android/app/src/main/java/com/ventora/game/DeviceIntegrity.kt').includes('val script: String by lazy'),'2c: Android reads them once, with the first page');
assert.ok(read('WebApp/diagnostics-core.js').includes('deviceIntegrity:globalThis.GH_DEVICE_INTEGRITY?'),'2c: the diagnostic file carries them');
// 3.
const privacy=read('iOS/GlobalHoldings/PrivacyInfo.xcprivacy');
assert.ok(/<key>NSPrivacyTracking<\/key>\s*<false\/>/.test(privacy)&&/<key>NSPrivacyCollectedDataTypes<\/key>\s*<array\/>/.test(privacy),'3: no tracking, no collected data');
for(const [api,reason] of [['UserDefaults','CA92.1'],['FileTimestamp','C617.1'],['SystemBootTime','35F9.1']])assert.ok(new RegExp(`NSPrivacyAccessedAPICategory${api}</string>[\\s\\S]*?<string>${reason.replace('.','\\.')}</string>`).test(privacy),`3: ${api} (${reason})`);
const project=read('project.yml');assert.ok(/- path: iOS\/GlobalHoldings\/PrivacyInfo\.xcprivacy\n\s+buildPhase: resources/.test(project),'3: a bundle resource');
// 4.
const firstBuild=release.indexOf('xcodebuild ');
assert.ok(release.indexOf('Xcode_26')>0&&release.indexOf('Xcode_26')<firstBuild,'4: Xcode 26 is selected before any build');assert.ok(release.includes('not 26 or later'),'4: an older SDK fails the build');
assert.ok(release.includes("re.subn(r'\\n        CFBundleDocumentTypes:.*?(?=\\n    settings:)'"),'4: the store edition drops the document types');
assert.ok(release.includes('PRODUCT_BUNDLE_IDENTIFIER: \'+bundle')&&release.includes('github.event.inputs.bundle_id'),'4: the bundle id comes from the input');
assert.ok(release.includes("ASC_ENABLED: ${{ secrets.ASC_KEY_ID != '' && 'yes' || '' }}")&&release.includes("if: success() && env.ASC_ENABLED == 'yes'"),'4: signing and upload run only with the Apple secrets');
assert.ok(release.includes('<key>method</key><string>app-store-connect</string>')&&release.includes('<key>destination</key><string>upload</string>'),'4: an App Store Connect upload');
// 5.
const gradle=read('android/app/build.gradle.kts'),manifest=read('android/app/src/main/AndroidManifest.xml'),activity=read('android/app/src/main/java/com/ventora/game/MainActivity.kt');
assert.ok(/compileSdk = 36/.test(gradle)&&/targetSdk = 36/.test(gradle)&&/minSdk = 29/.test(gradle),'5: API 36 from API 29');
const billing=gradle.match(/com\.android\.billingclient:billing-ktx:(\d+)\./);assert.ok(billing&&Number(billing[1])>=8,'5: Play Billing 8 or later');
assert.ok(activity.includes('WebViewAssetLoader.Builder()')&&handler.includes('const val HOST = "appassets.androidplatform.net"'),'5: the secure local origin');
assert.ok(handler.includes('if (release && mustBeSealed(rel)) return null')&&handler.includes('cipher.updateAAD(rel.toByteArray(Charsets.UTF_8))'),'5: sealed files open under their path; unsealed scripts are refused in release');
assert.ok(handler.includes('text.indexOf("<script")')&&handler.includes("storeBridge:{postMessage:")&&handler.includes("window.GH_EDITION='release';"),'5: the bridge before the first script, with the edition');
assert.ok(kotlin.includes('TIME_URL = "https://www.google.com/generate_204"')&&kotlin.includes('connection.date')&&kotlin.includes('.put("expiresAt", at + GRACE_DAYS * DAY_MS).put("confirmedAt", at)')&&!/System\.currentTimeMillis\(\)/.test(kotlin)&&!kotlin.includes('PERIOD_DAYS'),'5: (approved «أ») a Plus confirmation is dated by a trusted time (the purchase\'s signed time or Google\'s HTTPS answer), never the phone\'s clock');
assert.ok(read('WebApp/domain-command-core.js').includes('globalThis.GH_STORE_CORE?.noteClock?.(state)'),'5: each player command carries the store\'s latest seen time forward');
assert.ok(kotlin.includes('Signature.getInstance("SHA1withRSA")')&&kotlin.includes('if (!verified(purchase)) return'),'5: each purchase\'s signature is verified');
assert.ok(manifest.includes('android:allowBackup="false"')&&read('android/app/src/main/res/xml/data_extraction_rules.xml').includes('<cloud-backup>'),'5: no cloud backup of saves');
assert.ok(manifest.includes('android.intent.category.LAUNCHER')&&manifest.includes('android:exported="true"'),'5: the launcher activity');
// 5b. (approved «انقل خزنة الحفظ للأندرويد بدقة») the Android save vault: the shim gives the game the iPhone's saveBridge and
// updateBridge with the save text as its own argument; the vault's boot script runs right after the bridge and before the
// game's first script; one vault per process, opened off the main thread; answers go only to the page that asked; the
// page is paused only after its background save; a lost page process restarts from the vault; the core is JVM-tested.
const bridgeKt=read('android/app/src/main/java/com/ventora/game/VaultBridge.kt'),vaultKt=read('android/app/src/main/vault/com/ventora/vault/SaveVault.kt');
assert.ok(handler.includes("saveBridge:{postMessage:message=>vault('saveBridge',message)}")&&handler.includes("updateBridge:{postMessage:message=>vault('updateBridge',message)}")&&handler.includes("window.VentoraAndroid.vault(name,JSON.stringify(meta),body)"),'5b: the save bridges, with the save text apart from the envelope');
assert.ok(handler.includes('<script src=\\"$SHIM\\"></script>\\n  <script src=\\"/vault/boot.js\\"></script>'),'5b: the boot script after the bridge, before the game');
assert.ok(activity.includes('.addPathHandler("/vault/", vault.Paths(release))')&&activity.includes('vault.pageStarted(')&&activity.includes('override fun onRenderProcessGone')&&activity.includes('fun backgroundSaved()'),'5b: the activity serves the vault, scopes answers to the page, saves before pausing and recovers a lost page');
assert.ok(bridgeKt.includes('private object Holder')&&/opener\.submit<SaveVault> \{[\s\S]*?DeviceSealKey\.load\(folder\)/.test(bridgeKt)&&bridgeKt.includes('if (token == document.get())'),'5b: one vault per process, opened off the main thread; stale answers dropped');
assert.ok(vaultKt.includes('Executors.newSingleThreadExecutor { Thread(it, "ventora-save-vault")')&&vaultKt.includes('fun bootScript(')&&vaultKt.includes("fetch('/vault/save-chunk/'"),'5b: the vault thread and its boot script');
const androidWorkflow=read('.github/workflows/ventora-android.yml');
assert.ok(androidWorkflow.includes('gradle -p android/vault-jvm --no-daemon test')&&androidWorkflow.indexOf('android/vault-jvm')<androidWorkflow.indexOf('assembleDebug'),'5b: CI tests the vault core before building');
assert.ok(androidWorkflow.includes('assembleDebug')&&androidWorkflow.includes('bundleRelease')&&androidWorkflow.includes('ventora-release-smoke.cjs')&&androidWorkflow.includes('--kotlin android/app/src/main/java/com/ventora/game/VentoraReleaseKey.kt'),'5: a debug APK and a sealed, smoke-tested release AAB');
assert.ok(read('tools/release/build-release-webapp.cjs').includes("kotlin=option('--kotlin')"),'5: the release key for Kotlin');
console.log(JSON.stringify({suite:'build637-launch-native-contract',ok:true,products:products.length}));
