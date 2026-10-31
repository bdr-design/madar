'use strict';
// Owner (approved English plan, batch 1): the language in the whole app (local DOM).
//   1. Arabic by default: <html lang="ar" dir="rtl">, the game date in Arabic; the settings page offers the language in
//      the development edition, Arabic pressed;
//   2. English stored on the device (development edition): lang="en" dir="ltr" before the page paints, the game date in
//      English, the language card in English with English pressed; the game plays;
//   3. the store edition stays Arabic with English stored, and offers no language card (EN_READY is false);
//   4. choosing English saves the game first, tells the native shell (languageBridge, its action) and reloads;
//   5. no page error in any of them;
//   6. a failed save changes no language: no reload, the error is shown, the device and the shell keep Arabic, the button
//      can be pressed again.
const assert=require('node:assert/strict');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');
const release={fn:()=>{window.GH_EDITION='release';}};

(async()=>{
  const browser=await chromium.launch({headless:true});
  const results={};
  try{
    const read=page=>page.evaluate(()=>({lang:document.documentElement.lang,dir:document.documentElement.dir,core:GH_I18N.lang(),date:document.getElementById('simClockChip')?.textContent||''}));
    const settings=async page=>{await page.evaluate(()=>__AUDIT__.openDrawer('settings'));await page.waitForTimeout(250);return page.evaluate(()=>{const card=document.querySelector('#drawerBody .language-card');return card?{title:card.querySelector('h3').textContent,buttons:[...card.querySelectorAll('button[data-gh-action="language-set"]')].map(b=>({lang:b.dataset.lang,text:b.textContent,pressed:b.getAttribute('aria-pressed')}))}:null;});};
    // 1.
    {const errors=[];const {page}=await boot({browser,errors,viewport:{width:844,height:390}});
      const state=await read(page);assert.deepEqual({lang:state.lang,dir:state.dir,core:state.core},{lang:'ar',dir:'rtl',core:'ar'},'1: Arabic by default');
      assert.match(state.date,/يناير/,'1: the game date in Arabic');
      const card=await settings(page);assert.ok(card,'1: the language card in the development edition');assert.equal(card.title,'اللغة');
      assert.deepEqual(card.buttons,[{lang:'ar',text:'العربية',pressed:'true'},{lang:'en',text:'English',pressed:'false'}]);
      // 4.
      await page.evaluate(()=>{window.__posted=[];window.webkit={messageHandlers:{languageBridge:{postMessage:m=>window.__posted.push(m)}}};const original=GH_RUNTIME.persistForBackground;GH_RUNTIME.persistForBackground=async(...args)=>{const out=await original(...args);window.name=`persisted:${localStorage.getItem('ani-language')}:${JSON.stringify(window.__posted)}`;return out;};});
      const navigated=page.waitForNavigation({timeout:60000});
      await page.click('#drawerBody .language-card button[data-lang="en"]');await navigated;
      results.switched=await page.evaluate(()=>window.name);
      assert.equal(results.switched,'persisted:en:[{"action":"setLanguage","language":"en"}]','4: stored, told to the shell, saved, then reloaded');
      assert.deepEqual(errors,[]);await page.close();}
    // 2.
    {const errors=[];const {page}=await boot({browser,errors,viewport:{width:844,height:390},storage:[['ani-language','en']]});
      const state=await read(page);assert.deepEqual({lang:state.lang,dir:state.dir,core:state.core},{lang:'en',dir:'ltr',core:'en'},'2: English from the device');
      assert.match(state.date,/Jan/,'2: the game date in English');assert.doesNotMatch(state.date,/يناير/);
      const card=await settings(page);assert.ok(card);assert.equal(card.title,'Language');
      assert.deepEqual(card.buttons.map(b=>[b.lang,b.pressed]),[['ar','false'],['en','true']]);
      await page.evaluate(()=>__AUDIT__.closeDrawer?.());await page.evaluate(()=>__AUDIT__.setSpeed(3));await page.waitForTimeout(1200);await page.evaluate(()=>__AUDIT__.setSpeed(0));
      assert.ok(await page.evaluate(()=>__GH_STATE__.simSeconds>0),'2: the game plays in English');
      assert.deepEqual(errors,[]);await page.close();}
    // 3.
    {const errors=[];const {page}=await boot({browser,errors,viewport:{width:844,height:390},storage:[['ani-language','en']],beforeScripts:release});
      const state=await read(page);assert.equal(await page.evaluate(()=>window.GH_EDITION),'release');
      assert.deepEqual({lang:state.lang,dir:state.dir,core:state.core},{lang:'ar',dir:'rtl',core:'ar'},'3: the store edition stays Arabic');
      assert.equal(await settings(page),null,'3: no language card in the store edition');
      assert.deepEqual(errors,[]);await page.close();}
    // 6.
    {const errors=[];const {page}=await boot({browser,errors,viewport:{width:844,height:390}});
      await settings(page);
      await page.evaluate(()=>{window.__posted=[];window.__navigated=false;window.webkit={messageHandlers:{languageBridge:{postMessage:m=>window.__posted.push({...m})}}};GH_RUNTIME.persistForBackground=async()=>{throw new Error('disk full');};window.addEventListener('beforeunload',()=>{window.__navigated=true;});window.__notices=[];const show=window.GH_INTERACTION_NOTICE;window.GH_INTERACTION_NOTICE=(text,kind)=>{window.__notices.push([String(text),kind]);return show?.(text,kind);};});
      await page.click('#drawerBody .language-card button[data-lang="en"]');
      await page.waitForFunction(()=>window.__notices.length>0,null,{timeout:10000});
      assert.deepEqual(await page.evaluate(()=>window.__notices),[['تعذر تغيير اللغة الآن. أعد المحاولة بعد لحظات.','error']],'6: the player is told, in Arabic');
      await page.waitForTimeout(400);
      const after=await page.evaluate(()=>({navigated:window.__navigated,stored:localStorage.getItem('ani-language'),posted:window.__posted,lang:document.documentElement.lang,core:GH_I18N.lang(),disabled:document.querySelector('#drawerBody .language-card button[data-lang="en"]')?.disabled}));
      assert.deepEqual(after,{navigated:false,stored:null,posted:[{action:'setLanguage',language:'en'},{action:'setLanguage',language:'ar'}],lang:'ar',core:'ar',disabled:false},'6: a failed save keeps Arabic everywhere');
      results.failedSave=after;
      assert.deepEqual(errors,[]);await page.close();}
    console.log(JSON.stringify({suite:'build653-i18n-browser',ok:true,...results}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
