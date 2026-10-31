'use strict';
// Owner (approved English plan, batch 1): the game's language core (WebApp/i18n-core.js, GH_I18N), run in a fresh context
// for every case:
//   1. Arabic by default: <html lang="ar" dir="rtl">, arEn returns the Arabic text; the locales are exactly the ones the game
//      always used (so every Arabic figure and date is unchanged);
//   2. English when stored on the device, in the development edition: lang="en" dir="ltr", English texts, English locales;
//   3. the store edition stays Arabic whatever is stored, until EN_READY (the English edition complete), and refuses to
//      switch; EN_READY is false in this batch;
//   4. a missing or empty English text falls back to the Arabic one, never to an empty string; month names in both;
//   5. setLang: an unknown language is refused; the choice is stored and told to the native shell (languageBridge, with
//      its action); the page reloads only after the save is safe, and not at all when the save fails or the choice is the
//      current one;
//   6. the core defines no global but GH_I18N (Leaflet owns window.L).
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../WebApp/i18n-core.js'),'utf8');

function load({stored=null,edition,persist='ok'}={}){
  const values=new Map(stored?[['ani-language',stored]]:[]),posted=[],calls=[],writes=[];
  const root={dataset:{},lang:'',dir:''};
  const ctx={
    localStorage:{getItem:key=>values.has(key)?values.get(key):null,setItem:(key,value)=>{writes.push(['set',key,String(value)]);values.set(key,String(value));},removeItem:key=>{writes.push(['remove',key]);values.delete(key);}},
    document:{documentElement:root},
    location:{reload:()=>calls.push('reload')},
    webkit:{messageHandlers:{languageBridge:{postMessage:message=>posted.push(message)}}},
    GH_RUNTIME:{persistForBackground:async()=>{calls.push('persist');if(persist==='fail')throw new Error('save failed');}}
  };
  if(edition)ctx.GH_EDITION=edition;
  ctx.globalThis=ctx;vm.createContext(ctx);
  const before=new Set(Object.keys(ctx));vm.runInContext(source,ctx);
  return {ctx,I:ctx.GH_I18N,root,values,posted,calls,writes,added:Object.keys(ctx).filter(key=>!before.has(key))};
}

(async()=>{
  // 1.
  {const {I,root,added}=load();
    assert.equal(I.lang(),'ar');assert.equal(I.isEn(),false);assert.equal(I.dir(),'rtl');assert.equal(root.lang,'ar');assert.equal(root.dir,'rtl');assert.equal(root.dataset.lang,'ar');
    assert.equal(I.L('المتجر','Store'),'المتجر');
    assert.deepEqual({number:I.locale('number'),document:I.locale('document'),date:I.locale('date'),cheque:I.locale('cheque'),region:I.locale('region')},{number:'ar-SA-u-nu-latn',document:'ar-SA',date:'ar-SA-u-ca-gregory-nu-latn',cheque:'ar-SA-u-ca-gregory',region:'ar'},'1: the Arabic locales are the ones the game always used');
    assert.deepEqual(added,['GH_I18N'],'6: GH_I18N is the only global (window.L stays Leaflet\'s)');}
  // 2.
  {const {I,root}=load({stored:'en'});
    assert.equal(I.lang(),'en');assert.equal(I.dir(),'ltr');assert.equal(root.lang,'en');assert.equal(root.dir,'ltr');
    assert.equal(I.L('المتجر','Store'),'Store');assert.equal(I.locale('date'),'en-US');assert.equal(I.locale('region'),'en');
    assert.deepEqual([...I.available()],['ar','en']);}
  // A stored value that is no language is ignored.
  {const {I}=load({stored:'fr'});assert.equal(I.lang(),'ar');}
  // 3.
  assert.equal(load().I.EN_READY,false,'3: English is not offered to players in this batch');
  {const {I,root,values,posted,calls,writes}=load({stored:'en',edition:'release'});
    assert.equal(I.lang(),'ar','3: the store edition stays Arabic');assert.equal(root.dir,'rtl');assert.deepEqual([...I.available()],['ar']);
    const out=await I.setLang('en');assert.deepEqual({...out},{ok:false,reason:'language-unavailable'});
    assert.deepEqual(writes,[],'3: nothing was written');assert.equal(values.get('ani-language'),'en');assert.equal(posted.length,0);assert.equal(calls.length,0);}
  // 4.
  {const {I}=load({stored:'en'});
    assert.equal(I.L('نص',''),'نص','4: an empty English text falls back');assert.equal(I.L('نص'),'نص','4: a missing English text falls back');assert.equal(I.L('نص',null),'نص');
    assert.equal(I.month(0),'January');assert.equal(I.month(11),'December');assert.equal(I.month(12),'January');assert.equal(I.month(-1),'December');}
  {const {I}=load();assert.equal(I.month(0),'يناير');assert.equal(I.month(4),'مايو');}
  // 5.
  {const {I,values,posted,calls}=load();
    assert.deepEqual({...(await I.setLang('xx'))},{ok:false,reason:'language-unavailable'});assert.equal(calls.length,0);
    const out=await I.setLang('en');assert.equal(out.ok,true);assert.equal(out.changed,true);
    assert.equal(values.get('ani-language'),'en');assert.deepEqual(posted.map(m=>({...m})),[{action:'setLanguage',language:'en'}],'5: told to the native shell with its action');
    assert.deepEqual(calls,['persist','reload'],'5: the save first, then the reload');}
  // A failed save changes no language: the device and the shell are put back (nothing stored before → nothing stored).
  {const {I,calls,values,posted,writes}=load({persist:'fail'});const out=await I.setLang('en');assert.deepEqual({...out},{ok:false,reason:'save-before-language-failed'});assert.deepEqual(calls,['persist'],'5: no reload when the save fails');
    assert.equal(values.has('ani-language'),false,'5: the device keeps no new language');assert.deepEqual(writes,[['set','ani-language','en'],['remove','ani-language']]);
    assert.deepEqual(posted.map(m=>({...m})),[{action:'setLanguage',language:'en'},{action:'setLanguage',language:'ar'}],'5: the shell is told the page\'s language again');assert.equal(I.lang(),'ar');}
  {const {I,values,posted}=load({stored:'ar',persist:'fail'});await I.setLang('en');assert.equal(values.get('ani-language'),'ar','5: the stored Arabic comes back');assert.deepEqual(posted.map(m=>m.language),['en','ar']);}
  {const {I,values,posted}=load({stored:'en',persist:'fail'});const out=await I.setLang('ar');assert.equal(out.ok,false);assert.equal(values.get('ani-language'),'en','5: the stored English comes back');assert.deepEqual(posted.map(m=>m.language),['ar','en']);assert.equal(I.lang(),'en');}
  {const {I,calls,posted}=load({stored:'en'});const out=await I.setLang('en');assert.equal(out.ok,true);assert.equal(out.changed,false);assert.deepEqual(calls,[],'5: the current language reloads nothing');assert.equal(posted.length,1);}
  {const {I,calls,values}=load();const out=await I.setLang('en',{reload:false});assert.equal(out.ok,true);assert.equal(values.get('ani-language'),'en');assert.deepEqual(calls,[],'5: reload:false stores only');}
  // 1. app.js's own fallback (no GH_I18N) is the same Arabic locales, so an Arabic figure or date never changes.
  {const app=fs.readFileSync(path.join(__dirname,'../WebApp/app.js'),'utf8'),m=/const localeOf = kind => window\.GH_I18N\?\.locale\?\.\(kind\) \|\| \((\{[^}]*\})\)\[kind\];/.exec(app);
    assert.ok(m,'1: app.js chooses its locales through localeOf');const fallback=vm.runInNewContext(`(${m[1]})`);
    const {I}=load();assert.deepEqual({...fallback},Object.fromEntries(['number','document','date','cheque','region'].map(k=>[k,I.locale(k)])),'1: the fallback equals the Arabic core');
    for(const kind of ['ARABIC_INTEGER_FORMAT = new Intl.NumberFormat(localeOf(\'number\')','DOCUMENT_INTEGER_FORMAT = new Intl.NumberFormat(localeOf(\'document\')',"full:new Intl.DateTimeFormat(localeOf('date')","compact:new Intl.DateTimeFormat(localeOf('date')","month:new Intl.DateTimeFormat(localeOf('date')","cheque:new Intl.DateTimeFormat(localeOf('cheque')","new Intl.DisplayNames([localeOf('region')]"])assert.ok(app.includes(kind),`1: ${kind}`);
    // The Arabic outputs, byte for byte, as the game printed them before the language core.
    const day=Date.UTC(2026,0,1);
    assert.equal(new Intl.NumberFormat(I.locale('number'),{maximumFractionDigits:0}).format(1234567),new Intl.NumberFormat('ar-SA-u-nu-latn',{maximumFractionDigits:0}).format(1234567));
    assert.equal(new Intl.DateTimeFormat(I.locale('date'),{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'}).format(day),new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'}).format(day));
    assert.equal(new Intl.DateTimeFormat(I.locale('cheque'),{day:'2-digit',month:'2-digit',year:'numeric',timeZone:'UTC'}).format(day),new Intl.DateTimeFormat('ar-SA-u-ca-gregory',{day:'2-digit',month:'2-digit',year:'numeric',timeZone:'UTC'}).format(day));}
  console.log(JSON.stringify({suite:'build650-i18n-core',ok:true}));
})().catch(error=>{console.error(error);process.exitCode=1;});
