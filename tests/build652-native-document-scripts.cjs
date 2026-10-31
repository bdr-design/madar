'use strict';
// The iOS shell gives every game document two scripts before its own: the store edition's flag (GH_EDITION='release',
// which locks the paid features and hides the developer tools) and the player's language. Before each navigation the
// shell clears the user scripts to install the save bootstrap; it once cleared the edition flag with them, so the store
// edition ran as the development edition. Read from the source:
//   1. addDocumentStartScripts adds the flag in the store edition and the language script, at document start, for the
//      main frame;
//   2. the WebView configuration and every place that clears the user scripts add them back (right after the clearing,
//      before the bootstrap); no other place adds the flag;
//   3. the language bridge is registered and only stores Arabic or English, through its action, and English only where it
//      is offered; English is offered in the store edition only when the English edition is ready, and the shell and the
//      page agree on that (englishEditionReady === EN_READY);
//   4. the Android shell still writes the flag into the store edition's page;
//   5. every trusted main-frame navigation goes through installBootstrapBeforeNavigation (the place that adds the scripts
//      back), and no other Swift file clears or adds user scripts;
//   6. a modified device in the store edition keeps its entry screen locked: no language row, and choosing a language
//      (which draws the entry screen again) is refused there.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ROOT=path.join(__dirname,'..'),IOS=path.join(ROOT,'iOS/GlobalHoldings'),swift=fs.readFileSync(path.join(IOS,'GameViewController.swift'),'utf8');
const body=name=>{const start=swift.indexOf(`func ${name}(`);assert.ok(start>0,`${name} exists`);let depth=0,i=swift.indexOf('{',start);const from=i;for(;i<swift.length;i++){if(swift[i]==='{')depth++;else if(swift[i]==='}'){depth--;if(!depth)break;}}return swift.slice(from,i+1);};
// 1.
const scripts=body('addDocumentStartScripts');
assert.match(scripts,/if ventoraReleaseEdition \{\s*controller\.addUserScript\(WKUserScript\(source: "window\.GH_EDITION='release';", injectionTime: \.atDocumentStart, forMainFrameOnly: true\)\)\s*\}/,'1: the store edition flag, at document start');
assert.match(scripts,/controller\.addUserScript\(WKUserScript\(source: AppLanguage\.documentScript, injectionTime: \.atDocumentStart, forMainFrameOnly: true\)\)/,'1: the language, at document start');
assert.match(swift,/static var documentScript: String \{ "try\{localStorage\.setItem\('ani-language','\\\(current\)'\);\}catch\(_e\)\{\}" \}/,'1: the language script stores the shell\'s choice for GH_I18N');
// 2.
const clears=[...swift.matchAll(/removeAllUserScripts\(\)/g)];assert.ok(clears.length>=1);
// Right after each clearing (only comments between), before the bootstrap script.
for(const m of clears){const after=swift.slice(m.index);assert.match(after,/^removeAllUserScripts\(\)\s*(?:\/\/[^\n]*\s*)*self\.addDocumentStartScripts\(target\.configuration\.userContentController\)/,'2: the scripts are added back right after each clearing');const add=after.indexOf('addDocumentStartScripts('),boot=after.indexOf('WKUserScript(source: script');assert.ok(boot>0&&add<boot,'2: before the save bootstrap');}
assert.match(swift,/addDocumentStartScripts\(configuration\.userContentController\)/,'2: the configuration adds them');
assert.equal((swift.match(/GH_EDITION='release'/g)||[]).length,1,'2: the flag is written in one place only');
// 3.
assert.match(swift,/configuration\.userContentController\.add\(self, name: "languageBridge"\)/,'3: the language bridge is registered');
assert.match(swift,/if message\.name == "languageBridge" \{\s*if action == "setLanguage", let language = payload\["language"\] as\? String, \["ar", "en"\]\.contains\(language\), AppLanguage\.offersEnglish \|\| language == "ar" \{\s*AppLanguage\.set\(language\)/,'3: the bridge stores Arabic or offered English only');
const handler=swift.indexOf('if message.name == "languageBridge"'),guard=swift.indexOf('guard !navigationPreparing, message.webView === webView, message.frameInfo.isMainFrame');assert.ok(guard>0&&guard<handler,'3: behind the trusted-document guard');
assert.match(swift,/static var offersEnglish: Bool \{ englishEditionReady \|\| !ventoraReleaseEdition \}/,'3: English in the store edition only when ready');
const shellReady=/let englishEditionReady = (true|false)/.exec(swift)?.[1],pageReady=/EN_READY=(true|false)/.exec(fs.readFileSync(path.join(ROOT,'WebApp/i18n-core.js'),'utf8'))?.[1];
assert.ok(shellReady&&pageReady);assert.equal(shellReady,pageReady,'3: the shell and the page agree whether English is ready');
// 4.
assert.match(fs.readFileSync(path.join(ROOT,'android/app/src/main/java/com/ventora/game/GameAssetHandler.kt'),'utf8'),/if \(release\) \{ append\("window\.GH_EDITION='release';"\)/,'4: Android writes the flag into the store edition');
// 5.
{const start=swift.indexOf('func webView(_ webView: WKWebView, decidePolicyFor navigationAction:');assert.ok(start>0,'5: the navigation policy exists');let depth=0,i=swift.indexOf('{',start);const from=i;for(;i<swift.length;i++){if(swift[i]==='{')depth++;else if(swift[i]==='}'){depth--;if(!depth)break;}}const policy=swift.slice(from,i+1);
  // Its only allow without the bootstrap is a subframe (no scripts there: they are main frame only); every other way out
  // cancels, downloads a blob, or installs the bootstrap.
  assert.equal((policy.match(/decisionHandler\(\.allow\)/g)||[]).length,1,'5: one plain allow');
  assert.match(policy,/guard navigationAction\.targetFrame\?\.isMainFrame != false else \{\s*decisionHandler\(\.allow\)/,'5: the plain allow is for subframes only');
  assert.match(policy,/installBootstrapBeforeNavigation\(webView, token: nativeNavigationToken, decisionHandler: decisionHandler\)\s*\}$/,'5: a trusted main-frame navigation installs the scripts');}
for(const name of fs.readdirSync(IOS).filter(f=>f.endsWith('.swift')&&f!=='GameViewController.swift')){const src=fs.readFileSync(path.join(IOS,name),'utf8');assert.doesNotMatch(src,/removeAllUserScripts|addUserScript|GH_EDITION/,`5: ${name} touches no user script`);}
assert.equal((swift.match(/addUserScript\(/g)||[]).length,3,'5: the flag, the language and the bootstrap are the only user scripts');
// 6.
assert.match(body('initializeRuntime'),/if ventoraReleaseEdition && VentoraDeviceIntegrity\.isModified\(\) \{\s*deviceBlocked = true\s*showLaunchOverlay\(\)\s*launchPrimaryButton\?\.isEnabled = false/,'6: a modified device locks the entry screen before drawing it');
assert.match(body('showLaunchOverlay'),/if AppLanguage\.offersEnglish && !recovering && !deviceBlocked \{/,'6: no language row on a locked entry screen');
assert.match(body('chooseLanguage'),/guard !deviceBlocked, AppLanguage\.offersEnglish,/,'6: no language choice on a locked entry screen');
assert.equal((swift.match(/deviceBlocked = true/g)||[]).length,1,'6: only the modified-device check sets it');assert.equal((swift.match(/deviceBlocked = /g)||[]).length,2,'6: declared false, never cleared once set');
console.log(JSON.stringify({suite:'build652-native-document-scripts',ok:true,clears:clears.length}));
