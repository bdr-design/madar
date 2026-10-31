'use strict';
// Owner (approved English plan: «الانتباه من كسر الكلام او الجمل او عدم تنسيقها»): every text written in both languages,
// arEn('عربي','English') in the WebApp and arEn("عربي", "English") in the iOS shell, is read from the source and held to
// the same rules, so no sentence is broken, dropped or mismatched:
//   1. both arguments are string literals (a variable cannot be checked); the Arabic one holds Arabic, the English one
//      holds no Arabic letter and is not empty;
//   2. the same placeholders, in the same number (JS ${…}, Swift \(…)), so no value is dropped or doubled;
//   3. the same leading and trailing whitespace (texts that are joined to others keep their spacing);
//   4. the same Latin digits (a number never changes between the languages);
//   5. the ending matches: . → . , ؟ → ? , ! → ! , … → … , : → : ; an Arabic text with no closing mark gets none in
//      English; an English sentence (it ends with . ? !) starts with a capital where it starts with a letter;
//   6. English typography: no double space, no space before , . ; : ! ? ) , balanced brackets, no Arabic punctuation;
//   7. one helper, one meaning: every WebApp file that uses arEn defines it exactly as the core's L; the iOS shell defines
//      it once; no file defines a global L (Leaflet's) and i18n-core.js is the first script of index.html;
//   8. the iOS shell writes no Arabic text outside arEn (comments aside), so nothing it shows stays Arabic in English;
//      the only exceptions are the language's own name «العربية» on the language button, and GlobalGameStorage.swift (the
//      development edition's update-package checks; its messages are a later batch);
//   9. the save-export owner (SaveExportDownloadOwner.swift, also compiled on its own by the macOS export check) takes
//      the shell's arEn through one property whose default keeps the Arabic text; the shell hands it over once. That
//      forwarding call is the only arEn call without literal texts.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ROOT=path.join(__dirname,'..'),WEB=path.join(ROOT,'WebApp'),IOS=path.join(ROOT,'iOS/GlobalHoldings');
const ARABIC=/[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/,ARABIC_LETTER=/[ء-يٱ-ۓۺ-ۿ]/;
const CANONICAL="const arEn=(ar,en)=>globalThis.GH_I18N?.L?.(ar,en)??ar;";

// Reads one literal at `i` (JS ' " ` or Swift "), returns {value, placeholders, end} or null when it is no literal.
function readLiteral(src,i,swift){
  while(/\s/.test(src[i]))i++;
  const q=src[i];if(swift?q!=='"':!["'",'"','`'].includes(q))return null;
  let j=i+1,value='';const placeholders=[];
  while(j<src.length){
    const c=src[j];
    if(c==='\\'){
      if(swift&&src[j+1]==='('){let depth=1,k=j+2;while(k<src.length&&depth){if(src[k]==='(')depth++;else if(src[k]===')')depth--;k++;}const inner=src.slice(j+2,k-1);placeholders.push(inner.trim());value+='\u0000';j=k;continue;}
      value+=src[j+1]==='n'?'\n':src[j+1];j+=2;continue;
    }
    if(!swift&&q==='`'&&c==='$'&&src[j+1]==='{'){let depth=1,k=j+2;while(k<src.length&&depth){const d=src[k];if(d==='{')depth++;else if(d==='}')depth--;else if(d==="'"||d==='"'||d==='`'){const lit=readLiteral(src,k,false);if(lit){k=lit.end;continue;}}k++;}placeholders.push(src.slice(j+2,k-1).trim());value+='\u0000';j=k;continue;}
    if(c===q)return {value,placeholders,end:j+1};
    if(c==='\n'&&q!=='`')return null;
    value+=c;j++;
  }
  return null;
}
function calls(src,swift){
  const out=[],re=/\barEn\(/g;let m;
  while((m=re.exec(src))){
    const before=src.slice(Math.max(0,m.index-12),m.index);if(/(const|func)\s+$/.test(before)||/function\s+$/.test(before))continue;
    {const lead='owner.arEn = { ar, en in ';if(swift&&src.slice(m.index-lead.length,m.index)===lead&&src.startsWith('arEn(ar, en)',m.index))continue;}
    const a=readLiteral(src,m.index+5,swift);if(!a){out.push({at:m.index,error:'the Arabic argument is not a string literal'});continue;}
    let k=a.end;while(/\s/.test(src[k]))k++;if(src[k]!==','){out.push({at:m.index,error:'expected two arguments'});continue;}
    const b=readLiteral(src,k+1,swift);if(!b){out.push({at:m.index,error:'the English argument is not a string literal'});continue;}
    let e=b.end;while(/\s/.test(src[e]))e++;if(src[e]!==')'){out.push({at:m.index,error:'more than two arguments'});continue;}
    out.push({at:m.index,ar:a,en:b});
  }
  return out;
}
const lineOf=(src,at)=>src.slice(0,at).split('\n').length;
const ENDINGS=[['…','…'],['.','.'],['؟','?'],['?','?'],['!','!'],[':',':']];
function check(file,src,call,problems){
  const where=`${path.relative(ROOT,file)}:${lineOf(src,call.at)}`;
  if(call.error){problems.push(`${where}: ${call.error}`);return;}
  const ar=call.ar.value,en=call.en.value,plain=s=>s.replace(/\u0000/g,'');
  if(!ARABIC_LETTER.test(plain(ar)))problems.push(`${where}: the Arabic text holds no Arabic`);
  if(ARABIC.test(plain(en)))problems.push(`${where}: the English text holds Arabic: ${JSON.stringify(plain(en))}`);
  if(!plain(en).trim())problems.push(`${where}: the English text is empty`);
  const sortJoin=list=>[...list].sort().join('\u0001');
  if(sortJoin(call.ar.placeholders)!==sortJoin(call.en.placeholders))problems.push(`${where}: placeholders differ: [${call.ar.placeholders}] vs [${call.en.placeholders}]`);
  const lead=s=>(/^\s*/.exec(s)[0]),trail=s=>(/\s*$/.exec(s)[0]);
  if(lead(ar)!==lead(en)||trail(ar)!==trail(en))problems.push(`${where}: leading or trailing spaces differ`);
  const digits=s=>sortJoin(plain(s).match(/\d+(?:[.,]\d+)?/g)||[]);
  if(digits(ar)!==digits(en))problems.push(`${where}: numbers differ: ${digits(ar)||'-'} vs ${digits(en)||'-'}`);
  const tAr=plain(ar).trim(),tEn=plain(en).trim(),arEnd=ENDINGS.find(([a])=>tAr.endsWith(a)),enEnd=ENDINGS.find(([,e])=>tEn.endsWith(e));
  if(arEnd&&!tEn.endsWith(arEnd[1]))problems.push(`${where}: the Arabic ends with «${arEnd[0]}», the English should end with «${arEnd[1]}»: ${JSON.stringify(tEn)}`);
  if(!arEnd&&enEnd&&!/[.?!:…]$/.test(tAr))problems.push(`${where}: the English adds a closing «${enEnd[1]}» the Arabic does not have`);
  if(/[.?!]$/.test(tEn)&&/^[a-z]/.test(en.trim()))problems.push(`${where}: an English sentence starts with a small letter: ${JSON.stringify(tEn)}`);
  // A placeholder stands for a value: it keeps its place in the spacing checks.
  const body=en.replace(/\u0000/g,'X');
  if(/ {2,}/.test(body))problems.push(`${where}: double space in the English`);
  if(/ [,.;:!?)]/.test(body.replace(/ \.\.\./g,'')))problems.push(`${where}: space before punctuation in the English: ${JSON.stringify(body)}`);
  if(/[،؛؟]/.test(body))problems.push(`${where}: Arabic punctuation in the English`);
  for(const [open,close] of [['(',')'],['[',']']]){if(body.split(open).length!==body.split(close).length)problems.push(`${where}: unbalanced ${open}${close} in the English`);}
}

const problems=[];let total=0;const perFile={};
for(const name of fs.readdirSync(WEB).filter(f=>f.endsWith('.js')).sort()){
  const file=path.join(WEB,name),src=fs.readFileSync(file,'utf8');
  if(/(^|[^.\w])(window|globalThis)\.L\s*=[^=]/.test(src))problems.push(`${name}: defines a global L (Leaflet owns window.L)`);
  if(name==='i18n-core.js')continue;
  const found=calls(src,false);if(!found.length)continue;
  const defs=src.split('const arEn=').length-1;
  if(defs!==1||!src.includes(CANONICAL))problems.push(`${name}: arEn must be defined once, exactly as: ${CANONICAL}`);
  for(const call of found)check(file,src,call,problems);
  total+=found.length;perFile[name]=found.length;
}
for(const name of fs.readdirSync(IOS).filter(f=>f.endsWith('.swift')).sort()){
  const file=path.join(IOS,name),src=fs.readFileSync(file,'utf8'),found=calls(src,true);
  for(const call of found)check(file,src,call,problems);
  if(found.length){total+=found.length;perFile[`iOS/${name}`]=found.length;}
}
const swiftDefs=fs.readdirSync(IOS).filter(f=>f.endsWith('.swift')).map(f=>fs.readFileSync(path.join(IOS,f),'utf8')).join('\n').match(/func arEn\(_ ar: String, _ en: String\) -> String \{ AppLanguage\.current == "en" \? en : ar \}/g)||[];
if(swiftDefs.length!==1)problems.push(`iOS: arEn must be defined once (found ${swiftDefs.length})`);
// 8. Swift string literals outside comments, and whether each one sits inside an arEn call.
function swiftLiterals(src){const out=[];let i=0;while(i<src.length){const c=src[i];
  if(c==='/'&&src[i+1]==='/'){while(i<src.length&&src[i]!=='\n')i++;continue;}
  if(c==='/'&&src[i+1]==='*'){const end=src.indexOf('*/',i+2);i=end<0?src.length:end+2;continue;}
  if(c==='"'){if(src.startsWith('"""',i)){const end=src.indexOf('"""',i+3);out.push({at:i,end:end+3,text:src.slice(i,end+3)});i=end+3;continue;}let j=i+1,depth=0;while(j<src.length){if(src[j]==='\\'&&src[j+1]==='('){depth++;j+=2;continue;}if(depth&&src[j]===')'){depth--;j++;continue;}if(src[j]==='\\'){j+=2;continue;}if(!depth&&src[j]==='"')break;j++;}out.push({at:i,end:j+1,text:src.slice(i,j+1)});i=j+1;continue;}
  i++;}return out;}
const SWIFT_ARABIC_ALLOWED=new Set(['"العربية"']),SWIFT_LATER=new Set(['GlobalGameStorage.swift']);
for(const name of fs.readdirSync(IOS).filter(f=>f.endsWith('.swift')&&!SWIFT_LATER.has(f)).sort()){
  const src=fs.readFileSync(path.join(IOS,name),'utf8'),spans=calls(src,true).filter(c=>!c.error).map(c=>[c.at,c.en.end]);
  for(const lit of swiftLiterals(src)){if(!ARABIC_LETTER.test(lit.text)||SWIFT_ARABIC_ALLOWED.has(lit.text))continue;if(!spans.some(([a,b])=>lit.at>a&&lit.end<=b))problems.push(`iOS/${name}:${lineOf(src,lit.at)}: Arabic text outside arEn: ${lit.text.slice(0,60)}`);}
}
{const sample='let a = arEn("نعم", "Yes")\n// تعليق "عربي"\nlet b = "لا"\nlet c = "\\(x) قيمة"';const spans=calls(sample,true).map(c=>[c.at,c.en.end]),loose=swiftLiterals(sample).filter(l=>ARABIC_LETTER.test(l.text)&&!spans.some(([a,b])=>l.at>a&&l.end<=b)).map(l=>l.text);
  assert.deepEqual(loose,['"لا"','"\\(x) قيمة"'],'8: the checker finds Arabic outside arEn, not in comments or inside arEn');}
// 9.
{const owner=fs.readFileSync(path.join(IOS,'SaveExportDownloadOwner.swift'),'utf8'),shell=fs.readFileSync(path.join(IOS,'GameViewController.swift'),'utf8');
  if((owner.match(/var arEn: \(String, String\) -> String = \{ ar, _ in ar \}/g)||[]).length!==1)problems.push('iOS/SaveExportDownloadOwner.swift: one arEn property whose default keeps the Arabic text');
  if((shell.match(/owner\.arEn = \{ ar, en in arEn\(ar, en\) \}/g)||[]).length!==1)problems.push('iOS/GameViewController.swift: the export owner gets the shell\'s arEn once');
  if(!/private lazy var saveExportDownloads: VentoraSaveExportDownloads = makeSaveExportDownloads\(\)/.test(shell))problems.push('iOS/GameViewController.swift: the export owner is made by makeSaveExportDownloads');}
const html=fs.readFileSync(path.join(WEB,'index.html'),'utf8'),scripts=[...html.matchAll(/<script\b[^>]*src="([^"]+)"/g)].map(m=>m[1]);
if(scripts[0]!=='i18n-core.js')problems.push(`index.html: i18n-core.js must be the first script (found ${scripts[0]})`);
if(html.indexOf('i18n-core.js')>html.indexOf('<body'))problems.push('index.html: i18n-core.js must load in <head>, before the page paints');
// The checker itself: broken pairs are caught.
{const bad=[["arEn(`مرحبًا ${name}.`,`Hello.`)",'placeholders differ'],["arEn('تم.','done.')",'small letter'],["arEn('سعر 5 دولار','Price 6 dollars')",'numbers differ'],["arEn('نص','نص')",'holds Arabic'],["arEn('سؤال؟','Question.')",'should end with'],["arEn(' مسافة','space')",'spaces differ'],["arEn('نص',value)",'not a string literal'],["arEn('نص','Text  here')",'double space'],["arEn('نص','Text , here')",'space before punctuation']];
  for(const [code,expected] of bad){const local=[];for(const call of calls(code,false))check(path.join(WEB,'self-test.js'),code,call,local);assert.ok(local.some(p=>p.includes(expected)),`the checker catches «${expected}» in ${code} (got ${JSON.stringify(local)})`);}
  const good=[];for(const call of calls("arEn(`حُفظ ${n} ملف.`,`${n} files saved.`)",false))check(path.join(WEB,'self-test.js'),'',call,good);assert.deepEqual(good,[],'a sound pair passes');
  const swiftBad=[];for(const call of calls('arEn("الإصدار \\(v)", "Version")',true))check(path.join(IOS,'self-test.swift'),'',call,swiftBad);assert.ok(swiftBad.some(p=>p.includes('placeholders differ')),'Swift placeholders are checked');}
assert.ok(total>0,'texts in both languages exist');
assert.deepEqual(problems,[],`texts in both languages:\n${problems.join('\n')}`);
console.log(JSON.stringify({suite:'build651-i18n-source-contract',ok:true,texts:total,files:perFile}));
