(() => {
  'use strict';
  // Owner (approved English plan, «نسخة عربي ونسخة انجليزي وتختار من الشاشة الرئيسية»): the game's language. Every text the
  // game shows is written in both languages where it is used, L('عربي','English'); there is no observer over the page and
  // no lookup table to drift. The language is the player's device setting, never part of a save: texts a save already holds
  // (alerts, documents, news) stay in the language they were written in.
  // Loaded first, in <head>: it sets <html lang dir> before the page paints.
  // Until every batch of the English edition is done (EN_READY), English is offered in the development edition only; the
  // store edition stays Arabic whatever is stored.
  const VERSION='1.0.0',STORAGE_KEY='ani-language',LANGUAGES=Object.freeze(['ar','en']),EN_READY=false;
  const LOCALES=Object.freeze({ar:Object.freeze({number:'ar-SA-u-nu-latn',document:'ar-SA',date:'ar-SA-u-ca-gregory-nu-latn',cheque:'ar-SA-u-ca-gregory',region:'ar'}),en:Object.freeze({number:'en-US',document:'en-US',date:'en-US',cheque:'en-US',region:'en'})});
  const MONTHS=Object.freeze({ar:Object.freeze(['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر']),en:Object.freeze(['January','February','March','April','May','June','July','August','September','October','November','December'])});
  const releaseEdition=()=>globalThis.GH_EDITION==='release';
  function available(){return EN_READY||!releaseEdition()?LANGUAGES:Object.freeze(['ar']);}
  function stored(){try{const value=globalThis.localStorage?.getItem(STORAGE_KEY);return LANGUAGES.includes(value)?value:null;}catch(_error){return null;}}
  // The stored choice when it is offered here; Arabic otherwise.
  function resolve(){const value=stored();return value&&available().includes(value)?value:'ar';}
  let current=resolve();
  const lang=()=>current,isEn=()=>current==='en',dir=()=>current==='en'?'ltr':'rtl';
  // The text in the current language. A missing English text falls back to the Arabic one (never to an empty string).
  function L(ar,en){return current==='en'&&typeof en==='string'&&en!==''?en:ar;}
  const locale=kind=>LOCALES[current][kind]||LOCALES[current].number;
  const month=index=>MONTHS[current][((Math.floor(Number(index))%12)+12)%12];
  function apply(doc=globalThis.document){const root=doc?.documentElement;if(!root)return false;root.lang=current;root.dir=dir();root.dataset.lang=current;return true;}
  const tell=language=>{try{globalThis.webkit?.messageHandlers?.languageBridge?.postMessage({action:'setLanguage',language});}catch(_error){}};
  // A new choice is stored on the device and told to the native shell (its entry screen shows it, and it gives the stored
  // choice to every page it loads, so it is told before the reload); the page then reloads, after the save is safe, so
  // every text is drawn once in the new language. When the save fails, the language is not changed: the device and the
  // shell are put back to the page's language, so no later launch or recovery switches it.
  async function setLang(value,{reload=true}={}){
    if(!available().includes(value))return {ok:false,reason:'language-unavailable'};
    let before=null;try{before=globalThis.localStorage?.getItem(STORAGE_KEY)??null;}catch(_error){}
    try{globalThis.localStorage?.setItem(STORAGE_KEY,value);}catch(_error){return {ok:false,reason:'language-storage-unavailable'};}
    tell(value);
    if(value===current||!reload)return {ok:true,changed:value!==current,language:value};
    try{await globalThis.GH_RUNTIME?.persistForBackground?.();}catch(_error){
      try{if(before===null)globalThis.localStorage?.removeItem?.(STORAGE_KEY);else globalThis.localStorage?.setItem(STORAGE_KEY,before);}catch(_restore){}
      tell(current);return {ok:false,reason:'save-before-language-failed'};
    }
    globalThis.location?.reload?.();return {ok:true,changed:true,language:value};
  }
  apply();
  const API=Object.freeze({VERSION,STORAGE_KEY,LANGUAGES,EN_READY,available,lang,isEn,dir,L,locale,month,apply,setLang});
  globalThis.GH_I18N=API;
  if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
