'use strict';
// Build 664, found by playing the store edition (a game of 183 days): «بدء مجموعة جديدة» in the settings
//   a. erased the game on one tap, with no confirmation;
//   b. then opened the founding screen on its second step, with an empty contract, no signature field and the erased
//      group's name still in the field;
//   c. and, founded again, left the founding screen over the game for good (an inline «display:grid !important» beat the
//      class that hides it): only restarting the app showed the game.
// A review then found that the founding screen a reset showed could not be finished by touch (as a grid its panes did not
// scroll: «التالي» stayed below a phone's screen) and that a double tap answered the new question by itself (the button
// lies under the confirming one).
// Checked here in the store edition, with the page's own buttons and the native vault's test double (its reset included):
//   1. the button asks first, naming the group; a double tap anywhere on it erases nothing (the confirming button answers
//      only after a moment); «إلغاء» leaves the game, its day and its save untouched;
//   2. confirmed, the game and its save are erased and the founding screen opens as a first launch does: the same layout
//      (its fields scroll and «التالي» is reached by a wheel gesture), the first step, the declared default name, no
//      reviewed contract, no signature field, no page of the game reachable under it;
//   3. the second founding goes through the same steps (review, contract, drawn signature) and the founding screen leaves:
//      it is not displayed, a tap on the map and on the top bar reaches the game, and the new group is the one founded;
//   4. the same holds after the app restarts from the vault; no page error.
const assert=require('node:assert/strict');
const {chromium}=require('playwright'),{bootRenderApp}=require('./helpers/render-app.cjs'),{installVault}=require('./helpers/differential-vault-fixture.cjs'),{drawFounderSignature}=require('./helpers/signature-input');
// The native reset (persistence-core sends it to updateBridge), as tests/build495-large-reset-browser.cjs doubles it.
const resetBridge=()=>{const q=window.__DIFF_VAULT__,handlers=window.webkit.messageHandlers,post=handlers.saveBridge.postMessage;q.resetAttempts=[];
  handlers.saveBridge.postMessage=m=>{if(m.action!=='resetGameSave')return post(m);
    const root=JSON.parse(m.saveJSON),ids=[...(root.fleet?.rows?.chunks||[]),...(root.stateCodec?.chunks||[])],ok=ids.every(id=>q.chunks.has(id))&&GH_CONTROL_PLANE.sha256(m.saveJSON)===m.saveHash;q.resetAttempts.push(ok);
    setTimeout(()=>{if(ok){q.head=m.saveJSON;q.history.push(m.saveJSON);}dispatchEvent(new CustomEvent('gh-native-reset-ack',{detail:{requestId:m.requestId,action:m.action,saveRevision:m.saveRevision,resetEpoch:m.resetEpoch,saveSchemaVersion:m.saveSchemaVersion,saveHash:m.saveHash,success:ok,generation:ok?++q.generation:undefined,message:ok?null:'qa-reset-refused'}}));},0);};
  handlers.updateBridge=handlers.saveBridge;};
const release=async page=>{await page.evaluate(()=>{window.GH_EDITION='release';window.__storePosts=[];window.webkit.messageHandlers.storeBridge={postMessage:message=>window.__storePosts.push(JSON.parse(JSON.stringify(message)))};});};
const founded=page=>page.waitForFunction(()=>window.__GH_STATE__?.onboardingComplete&&!window.__GH_DURABLE_COMMAND_CONTEXT__&&!document.getElementById('app')?.hasAttribute('inert'),null,{timeout:120000});
const idle=page=>page.evaluate(()=>window.__AUDIT__.whenStateIdle?.());
// What the founding screen shows, and what a tap in the middle of the map and on the top bar would reach.
const screen=page=>page.evaluate(()=>{
  const flow=document.getElementById('founderFlow'),form=document.getElementById('founderForm'),at=(x,y)=>{const el=document.elementFromPoint(x,y);return el?(flow.contains(el)?'founding':el.closest('#app')?'game':el.tagName.toLowerCase()):'none';};
  return {displayed:getComputedStyle(flow).display!=='none'&&flow.getClientRects().length>0,inlineDisplay:flow.style.getPropertyValue('display'),reviewing:form.classList.contains('is-reviewing'),dataPane:!document.getElementById('founderDataPane').hidden,reviewPane:!document.getElementById('founderReviewPane').hidden,
    contract:document.getElementById('founderContractPreview').textContent.trim().length,signature:document.getElementById('founderSignatureMount').childElementCount,name:document.getElementById('founderName').value,owner:document.getElementById('founderOwner').value,
    map:at(Math.round(innerWidth*.45),Math.round(innerHeight*.55)),bar:at(Math.round(innerWidth*.5),24),appInert:document.getElementById('app').hasAttribute('inert'),appHidden:document.getElementById('app').getAttribute('aria-hidden'),appPointer:document.getElementById('app').style.pointerEvents};});
const game=page=>page.evaluate(()=>{const s=window.__GH_STATE__;return {onboard:s.onboardingComplete===true,name:s.profile?.name||'',day:Math.floor((Number(s.simSeconds)||0)/86400),cash:Math.round(window.GH_FINANCE_CORE.operating(s,'group')),companies:[...(s.openedCompanies||[])],rev:Number(s.saveRevision)||0,legal:window.GH_LEGAL?.accepted?.(s)===true};});
// The founding screen's layout: what decides whether its buttons can be reached on a phone.
const layout=page=>page.evaluate(()=>{const flow=document.getElementById('founderFlow'),work=flow.querySelector('.incorporation-workspace'),fields=document.querySelector('#founderDataPane .incorporation-fields');return {display:getComputedStyle(flow).display,workspace:Math.round(work.getBoundingClientRect().height),fields:fields.clientHeight,fieldsScroll:fields.scrollHeight};});
const nextReachable=async page=>{const pane=await page.locator('#founderDataPane .incorporation-fields').boundingBox();await page.mouse.move(pane.x+pane.width/2,pane.y+pane.height/2);await page.mouse.wheel(0,2000);await page.waitForTimeout(250);return page.evaluate(()=>{const r=document.getElementById('founderReview').getBoundingClientRect(),el=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return r.top>=0&&r.bottom<=innerHeight&&!!el&&el.closest('#founderReview')!==null;});};
const vaultGroup=page=>page.evaluate(()=>{const q=window.__DIFF_VAULT__;return q.head?{name:JSON.parse(q.head).profile?.name||'',onboard:JSON.parse(q.head).onboardingComplete===true}:null;});
async function found(page,name){
  await page.fill('#founderName',name);await page.selectOption('#founderMode','sandbox');await page.click('#founderReview');await page.waitForTimeout(200);
  const review=await screen(page);assert.equal(review.reviewing,true,`${name}: the review step opens`);assert.ok(review.contract>200,`${name}: the contract is written`);assert.ok(review.signature>0,`${name}: the signature field is there`);
  await drawFounderSignature(page);await page.locator('#founderForm button[type=submit]').click();await founded(page);await idle(page);
}
const openNewGame=async page=>{await page.evaluate(()=>window.__AUDIT__.openDrawer('settings'));await page.waitForTimeout(600);const button=page.locator('#drawerBody .new-game-direct');await button.scrollIntoViewIfNeeded();return button;};
(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    const env=await bootRenderApp({browser,found:false,errors,beforeScripts:{run:async page=>{await page.evaluate(installVault);await page.evaluate(resetBridge);await release(page);}},viewport:{width:844,height:390},appAudit:'{openCompany}'}),page=env.page;page.setDefaultTimeout(60000);
    await page.locator('#legalConsent [data-legal-agree]').check();await page.locator('#legalConsent [data-legal-accept]').click();await page.waitForTimeout(400);
    const first=await screen(page);assert.deepEqual({displayed:first.displayed,reviewing:first.reviewing,dataPane:first.dataPane,reviewPane:first.reviewPane,contract:first.contract,signature:first.signature},{displayed:true,reviewing:false,dataPane:true,reviewPane:false,contract:0,signature:0},'a first launch opens the first step');
    const declared={name:first.name,owner:first.owner},firstLayout=await layout(page);assert.equal(await nextReachable(page),true,'a first launch reaches «التالي» by a wheel gesture');
    await found(page,'مجموعة الرواد القابضة');
    await page.evaluate(()=>window.__AUDIT__.openCompany('road'));await idle(page);
    const before=await game(page);assert.equal(before.name,'مجموعة الرواد القابضة');assert.deepEqual(before.companies,['road']);assert.equal((await screen(page)).displayed,false);
    assert.deepEqual(await vaultGroup(page),{name:'مجموعة الرواد القابضة',onboard:true},'the first group is in the vault');

    // 1. The button asks first; cancelling changes nothing.
    let button=await openNewGame(page);await button.click();
    const dialog=page.locator('dialog.ui-confirm');await dialog.waitFor({state:'visible'});
    const asked=await dialog.evaluate(node=>({text:node.innerText,risk:node.classList.contains('risk'),buttons:[...node.querySelectorAll('[data-confirm]')].map(b=>b.textContent.trim())}));
    assert.match(asked.text,/«مجموعة الرواد القابضة»/,'1: the confirmation names the group');assert.match(asked.text,/خانات الحفظ/);assert.match(asked.text,/لا يمكن التراجع/);assert.doesNotMatch(asked.text,/\d+ يوم|لا أيام/,'1: no day count on the first day');assert.equal(asked.risk,true,'1: shown as a high-impact decision');assert.deepEqual(asked.buttons,['تأكيد المسح','إلغاء']);
    assert.deepEqual(await game(page),before,'1: nothing is erased while the question is open');
    await dialog.locator('[data-confirm="cancel"]').click();await dialog.waitFor({state:'detached'});await page.waitForTimeout(300);await idle(page);
    // A double tap: the second tap lands where the question's buttons are. Tried across the button, the settings scrolled to their end.
    for(const part of [.12,.3,.5,.7,.88]){
      button=await openNewGame(page);await page.evaluate(()=>{const body=document.getElementById('drawerBody');for(let node=body;node;node=node.parentElement)node.scrollTop=node.scrollHeight;});await page.waitForTimeout(150);
      const box=await button.boundingBox(),x=box.x+box.width*part,y=box.y+box.height/2;await page.mouse.click(x,y);await page.waitForTimeout(140);await page.mouse.click(x,y);await page.waitForTimeout(400);
      assert.deepEqual(await game(page),before,`1: a double tap at ${Math.round(part*100)}% of the button erases nothing`);
      if(await dialog.count()){await page.waitForTimeout(500);await dialog.locator('[data-confirm="cancel"]').click();await dialog.waitFor({state:'detached'});}
      await page.waitForTimeout(200);await idle(page);assert.deepEqual(await game(page),before);}
    assert.deepEqual(await game(page),before,'1: cancelling leaves the game as it was');assert.equal((await screen(page)).displayed,false,'1: and the founding screen closed');
    assert.deepEqual(await vaultGroup(page),{name:'مجموعة الرواد القابضة',onboard:true},'1: and its save');
    assert.equal(await page.locator('#drawerBody .new-game-direct').isEnabled(),true,'1: the button is ready again');
    // The worst double tap: the second tap falls on the confirming button itself, 140 ms after the question opened.
    button=await openNewGame(page);await button.click();await dialog.waitFor({state:'visible'});
    {const accept=await dialog.locator('[data-confirm="accept"]').boundingBox(),x=accept.x+accept.width/2,y=accept.y+accept.height/2;assert.equal(await dialog.locator('[data-confirm="accept"]').isDisabled(),true,'1: the confirming button opens dimmed');
      await page.waitForTimeout(140);await page.mouse.click(x,y);
      assert.equal(await dialog.count(),1,'1: the question is still open after a tap on its confirming button 140 ms in');assert.deepEqual(await game(page),before,'1: and nothing is erased');
      await page.waitForFunction(()=>document.querySelector('dialog.ui-confirm [data-confirm="accept"]')?.disabled===false,null,{timeout:10000});
      await dialog.locator('[data-confirm="cancel"]').click();await dialog.waitFor({state:'detached'});await page.waitForTimeout(200);await idle(page);assert.deepEqual(await game(page),before);}
    // A slow frame: the page is busy for 900 ms from the question's opening; a tap made 200 ms in is read only after the
    // button is back. It was pressed too early, so it does not confirm.
    button=await openNewGame(page);await button.click();await dialog.waitFor({state:'visible'});
    {const accept=await dialog.locator('[data-confirm="accept"]').boundingBox(),x=accept.x+accept.width/2,y=accept.y+accept.height/2;
      await page.evaluate(()=>{setTimeout(()=>{const until=performance.now()+900;while(performance.now()<until){}},0);});await page.waitForTimeout(120);await page.mouse.click(x,y);await page.waitForTimeout(400);
      assert.equal(await dialog.count(),1,'1: a tap queued behind a slow frame does not confirm');assert.deepEqual(await game(page),before,'1: and nothing is erased');
      await dialog.locator('[data-confirm="cancel"]').click();await dialog.waitFor({state:'detached'});await page.waitForTimeout(200);await idle(page);}
    // A press held across the moment the button comes back (down before, up after) does not confirm either.
    button=await openNewGame(page);await button.click();await dialog.waitFor({state:'visible'});
    {const accept=await dialog.locator('[data-confirm="accept"]').boundingBox(),x=accept.x+accept.width/2,y=accept.y+accept.height/2;
      await page.mouse.move(x,y);await page.waitForTimeout(300);await page.mouse.down();await page.waitForFunction(()=>document.querySelector('dialog.ui-confirm [data-confirm="accept"]')?.disabled===false,null,{timeout:10000});await page.waitForTimeout(100);await page.mouse.up();await page.waitForTimeout(300);
      assert.deepEqual(await game(page),before,'1: a press held across the arming erases nothing');
      if(await dialog.count()){await dialog.locator('[data-confirm="cancel"]').click();await dialog.waitFor({state:'detached'});}await page.waitForTimeout(200);await idle(page);assert.deepEqual(await game(page),before);}
    // The keyboard, on the same critical question asked directly (this one erases nothing): the dimmed button takes no focus
    // and an early press on it is refused; once armed, Enter on it confirms although that press was refused; Escape cancels.
    {const ask=()=>page.evaluate(()=>{window.__qaAnswer=undefined;window.GH_INTERFACE.confirm('سؤال؟',{state:window.__GH_STATE__,action:'qa-critical',risk:'critical'}).then(value=>{window.__qaAnswer=value;});}),answer=()=>page.evaluate(()=>window.__qaAnswer);
      const focusAccept=()=>page.evaluate(()=>{const accept=document.querySelector('dialog.ui-confirm [data-confirm="accept"]');accept.focus();return document.activeElement===accept;}),armed=()=>page.waitForFunction(()=>document.querySelector('dialog.ui-confirm [data-confirm="accept"]')?.disabled===false,null,{timeout:10000});
      await ask();await dialog.waitFor({state:'visible'});const accept=await dialog.locator('[data-confirm="accept"]').boundingBox();assert.equal(await focusAccept(),false,'1: the dimmed button takes no focus');
      await page.waitForTimeout(140);await page.mouse.click(accept.x+accept.width/2,accept.y+accept.height/2);assert.equal(await answer(),undefined,'1: an early press is refused');
      await armed();await page.waitForTimeout(100);assert.equal(await focusAccept(),true,'1: armed, the button takes focus');await page.keyboard.press('Enter');await page.waitForFunction(()=>window.__qaAnswer!==undefined,null,{timeout:10000});
      assert.equal(await answer(),true,'1: Enter confirms once the button is armed, after a refused early press');await dialog.waitFor({state:'detached'});
      await ask();await dialog.waitFor({state:'visible'});await armed();await page.keyboard.press('Escape');await page.waitForFunction(()=>window.__qaAnswer!==undefined,null,{timeout:10000});assert.equal(await answer(),false,'1: Escape cancels');await dialog.waitFor({state:'detached'});
      assert.deepEqual(await game(page),before,'1: the direct question changed nothing');}
    assert.deepEqual(await page.evaluate(()=>window.__DIFF_VAULT__.resetAttempts),[],'1: no reset reached the vault');
    console.log('1 ok: the new-game button asks first; a double tap and a cancel change nothing');

    // 2. Confirmed: the game is erased and the founding screen opens as a first launch does.
    button=await openNewGame(page);await button.click();await dialog.waitFor({state:'visible'});await dialog.locator('[data-confirm="accept"]').click();
    await page.waitForFunction(()=>window.__GH_STATE__?.onboardingComplete!==true&&getComputedStyle(document.getElementById('founderFlow')).display!=='none',null,{timeout:120000});await page.waitForTimeout(500);
    const erased=await game(page);assert.deepEqual({onboard:erased.onboard,day:erased.day,companies:erased.companies,legal:erased.legal},{onboard:false,day:0,companies:[],legal:true},'2: the game is erased; the accepted texts stay accepted');
    const reset=await screen(page);
    assert.deepEqual({displayed:reset.displayed,reviewing:reset.reviewing,dataPane:reset.dataPane,reviewPane:reset.reviewPane,contract:reset.contract,signature:reset.signature,name:reset.name,owner:reset.owner,map:reset.map,bar:reset.bar},
      {displayed:true,reviewing:false,dataPane:true,reviewPane:false,contract:0,signature:0,name:declared.name,owner:declared.owner,map:'founding',bar:'founding'},'2: the founding screen opens on its first step, as declared');
    assert.equal(await page.locator('#legalConsent').isVisible().catch(()=>false),false,'2: the consent is not asked again');
    assert.deepEqual(await page.evaluate(()=>window.__DIFF_VAULT__.resetAttempts),[true],'2: the reset reached the vault once and was accepted');assert.equal((await vaultGroup(page)).onboard,false,'2: the saved game is the erased one');
    assert.deepEqual(await layout(page),firstLayout,'2: the founding screen is laid out as at a first launch');
    assert.deepEqual(await page.evaluate(()=>[...document.querySelectorAll('#founderFlow .incorporation-fields,#founderFlow .incorporation-preview')].map(pane=>pane.scrollTop)).then(tops=>tops.every(top=>top===0)),true,'2: its panes open at their top');
    assert.equal(await page.evaluate(()=>{const r=document.getElementById('founderReview').getBoundingClientRect();return r.top>=innerHeight;}),true,'2: «التالي» starts below the fold, as at a first launch');assert.equal(await nextReachable(page),true,'2: and is reached by a wheel gesture');
    assert.deepEqual({inert:reset.appInert,hidden:reset.appHidden},{inert:true,hidden:'true'},'2: the game under it is inert, as at a first launch');
    console.log('2 ok: confirmed, the founding screen opens as a first launch does');

    // 3. Founded again, the founding screen leaves and the game is reachable.
    await found(page,'مجموعة الأفق القابضة');await page.waitForTimeout(300);
    const after=await screen(page);
    assert.deepEqual({displayed:after.displayed,inlineDisplay:after.inlineDisplay,map:after.map,bar:after.bar,appInert:after.appInert,appHidden:after.appHidden,appPointer:after.appPointer,reviewing:after.reviewing,signature:after.signature},
      {displayed:false,inlineDisplay:'',map:'game',bar:'game',appInert:false,appHidden:null,appPointer:'',reviewing:false,signature:0},'3: the founding screen is gone and taps reach the game');
    const second=await game(page);assert.deepEqual({onboard:second.onboard,name:second.name,day:second.day,companies:second.companies},{onboard:true,name:'مجموعة الأفق القابضة',day:0,companies:[]},'3: the new group is the one founded');
    await page.click('#speedToggle');await page.waitForFunction(()=>Number(window.__GH_STATE__.simSeconds)>0,null,{timeout:30000});await page.click('#speedToggle');await idle(page);
    await page.evaluate(()=>window.__AUDIT__.openCompany('road'));await idle(page);assert.deepEqual((await game(page)).companies,['road'],'3: a command works in the new game');
    assert.deepEqual(await vaultGroup(page),{name:'مجموعة الأفق القابضة',onboard:true},'3: and it is the saved one');
    console.log('3 ok: the second founding leaves the founding screen and the game is reachable');

    // 4. The same after the app restarts from the vault.
    const seed=await page.evaluate(()=>{const q=window.__DIFF_VAULT__,b64=u=>{let s='';for(let i=0;i<u.length;i+=0x8000)s+=String.fromCharCode.apply(null,u.subarray(i,i+0x8000));return btoa(s);};return {json:q.head,chunks:[...q.chunks].map(([id,bytes])=>[id,b64(bytes)]),bootstrap:true};});
    const again=await bootRenderApp({browser,found:false,errors,beforeScripts:{run:async p=>{await p.evaluate(installVault,seed);await p.evaluate(resetBridge);await release(p);}},viewport:{width:844,height:390},appAudit:'{openCompany}'}),page2=again.page;await page2.waitForTimeout(1200);
    const restarted=await screen(page2),loaded=await game(page2);
    assert.deepEqual({displayed:restarted.displayed,map:restarted.map,bar:restarted.bar},{displayed:false,map:'game',bar:'game'},'4: after a restart the game is on screen');assert.deepEqual({onboard:loaded.onboard,name:loaded.name,companies:loaded.companies},{onboard:true,name:'مجموعة الأفق القابضة',companies:['road']},'4: and it is the new group');
    await page2.close();await again.closeOrigin?.();await page.close();await env.closeOrigin?.();
    assert.deepEqual(errors,[],'no page error');
    console.log('4 ok: the restarted app shows the new group');
    console.log('build664 new game flow: 4 checks passed');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
