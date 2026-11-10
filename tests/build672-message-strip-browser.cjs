'use strict';
// Build 672, the first finding of the play-through: every refusal, result and warning the game writes went to a list no
// page shows (state.alerts; the bell opens the official news). «Buy 1,000 trucks at level 3» was refused and nothing
// appeared on the screen; a tender's result, a holding's cover of a company's deficit, a stopped simulation: all silent.
// The message strip (GH_INTERFACE.toast) shows whatever is written to that list, once, under the top bar. Checked on the
// real page:
//   1. a refusal raised by a real button (repaying a debt the holding does not have) appears as a warning, with the
//      text the alerts list holds;
//   2. kinds: an error, a success and a plain notice are marked as such; the text is shown as text, never as markup;
//   3. at most two messages at a time; the same message twice is shown once; the close button dismisses one; a tap on
//      the message itself reaches the page under it;
//   4. each alert is shown once: when its message has gone, refreshing the top bar does not show it again; the strip
//      leaves the page when it is empty and never sits inside the game shell (#app);
//   5. an alert written by a command into its own state (the investor mode's switch) and one written by the simulation's
//      owner (operations record-alert) are shown too.
const assert=require('node:assert/strict');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');
(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    const {page}=await boot({browser,errors,viewport:{width:844,height:390}});page.setDefaultTimeout(60000);
    const shown=()=>page.evaluate(()=>[...document.querySelectorAll('#uiToasts .ui-toast')].map(node=>({kind:node.dataset.kind,text:node.querySelector('p').textContent,markup:node.querySelector('p').children.length})));
    const gone=()=>page.waitForFunction(()=>!document.getElementById('uiToasts'),null,{timeout:20000});
    const closeAll=async()=>{for(let guard=0;guard<6&&await page.locator('#uiToasts .ui-toast button').count();guard++)await page.locator('#uiToasts .ui-toast button').first().click();await gone();};
    const notify=(text,kind)=>page.evaluate(([text,kind])=>window.GH_WORKFLOW.notify(text,kind,{state:window.__GH_STATE__}),[text,kind]);
    const settle=()=>page.waitForFunction(()=>!window.__GH_DURABLE_COMMAND_CONTEXT__);
    await closeAll();

    // 1. A real refusal.
    await page.evaluate(()=>__AUDIT__.openDrawer('finance','transfers'));const before=await page.evaluate(()=>__GH_STATE__.alerts.length);await page.locator('#drawerBody .repay-debt[data-company="group"]').first().click();
    await page.waitForFunction(()=>document.querySelectorAll('#uiToasts .ui-toast').length===1);const refusal=await shown(),alert=await page.evaluate(()=>String(__GH_STATE__.alerts[0]));
    assert.equal(await page.evaluate(()=>__GH_STATE__.alerts.length),before+1,'1: the refusal is written to the alerts list');assert.match(alert,/^لا يوجد دين قائم على/,'1: it is the repayment\'s refusal');
    assert.deepEqual(refusal,[{kind:'warn',text:alert,markup:0}],'1: and shown on the strip as a warning, with that text');
    const place=await page.evaluate(()=>{const host=document.getElementById('uiToasts'),row=host.firstElementChild.getBoundingClientRect(),bar=document.querySelector('.topbar,#topbar,header')?.getBoundingClientRect();return {inShell:document.getElementById('app').contains(host),top:row.top,bottom:row.bottom,left:row.left,right:row.right,width:innerWidth,height:innerHeight,role:host.getAttribute('role'),live:host.getAttribute('aria-live')};});
    assert.deepEqual({inShell:place.inShell,role:place.role,live:place.live},{inShell:false,role:'status',live:'polite'},'1: the strip is announced politely and sits outside the game shell');
    assert.ok(place.top>=40&&place.bottom<place.height/2&&place.left>=0&&place.right<=place.width,`1: under the top bar, inside the screen (${JSON.stringify(place)})`);
    console.log('1 ok: a real refusal is shown as a warning with the text the alerts list holds');

    // 3 (first half). A tap on the message reaches the page under it; its close button dismisses it.
    const under=await page.evaluate(()=>{const row=document.querySelector('#uiToasts .ui-toast'),body=row.querySelector('p').getBoundingClientRect(),hit=document.elementFromPoint(body.left+body.width/2,body.top+body.height/2);return {toast:!!hit?.closest?.('#uiToasts'),tag:hit?.tagName||''};});
    assert.equal(under.toast,false,`3: a tap on the message reaches the page under it (${under.tag})`);
    await page.locator('#uiToasts .ui-toast button').click();await gone();assert.deepEqual(await shown(),[],'3: the close button dismisses the message');

    // 2. Kinds, and text only.
    await notify('تعذر حفظ الخانة 1: <b>مساحة</b> التخزين غير كافية.','error');await notify('تم تسجيل العملية.','success');await page.waitForFunction(()=>document.querySelectorAll('#uiToasts .ui-toast').length===2);
    assert.deepEqual(await shown(),[{kind:'err',text:'تعذر حفظ الخانة 1: <b>مساحة</b> التخزين غير كافية.',markup:0},{kind:'ok',text:'تم تسجيل العملية.',markup:0}],'2: an error and a success are marked, and markup in a message is shown as text');
    // 3. At most two; the same text once.
    await notify('رسالة ثالثة.','info');await page.waitForFunction(()=>[...document.querySelectorAll('#uiToasts .ui-toast p')].some(node=>node.textContent==='رسالة ثالثة.'));
    assert.deepEqual((await shown()).map(row=>[row.kind,row.text]),[['ok','تم تسجيل العملية.'],['info','رسالة ثالثة.']],'3: at most two messages, the oldest leaves');
    await notify('رسالة ثالثة.','info');await page.waitForTimeout(400);assert.deepEqual((await shown()).map(row=>row.text),['تم تسجيل العملية.','رسالة ثالثة.'],'3: the same message again is shown once');
    const height=await page.evaluate(()=>document.getElementById('uiToasts').getBoundingClientRect().bottom);assert.ok(height<=195,`3: two messages leave half the screen free (${height})`);
    console.log('2 ok: kinds are marked and text stays text');console.log('3 ok: at most two messages, the same one once; a tap passes through and the close button dismisses');

    // 4. Each alert once, and the strip leaves when it is empty.
    await gone();assert.equal(await page.evaluate(()=>document.querySelectorAll('.ui-toasts,.ui-toast').length),0,'4: the strip leaves the page when its messages have gone');
    const alerts=await page.evaluate(()=>__GH_STATE__.alerts.length);await page.evaluate(()=>{__AUDIT__.updateKpis();__AUDIT__.updateKpis();});await page.waitForTimeout(300);
    assert.deepEqual(await shown(),[],'4: refreshing the top bar shows no alert again');assert.equal(await page.evaluate(()=>__GH_STATE__.alerts.length),alerts);
    console.log('4 ok: an alert is shown once; the empty strip leaves the page');

    // 5. An alert a command writes into its own state, and one the simulation's owner writes.
    await page.evaluate(()=>__AUDIT__.openDrawer('investorMode'));await page.locator('#drawerBody .investor-mode-toggle').first().click();await page.waitForFunction(()=>GH_FINANCE_CORE.investorMode(__GH_STATE__)===true);await settle();
    await page.waitForFunction(()=>[...document.querySelectorAll('#uiToasts .ui-toast p')].some(node=>/تفعيل وضع المستثمر الحر/.test(node.textContent)));
    await closeAll();await page.evaluate(()=>{GH_DOMAIN_COMMANDS.dispatchSystem({state:__GH_STATE__},'operations','record-alert',{text:'ارتجع الشيك CHQ-QA لعدم كفاية الرصيد.',type:'operation'},{actor:'simulation-scheduler'});__AUDIT__.updateKpis();});
    await page.waitForFunction(()=>document.querySelectorAll('#uiToasts .ui-toast').length===1);assert.deepEqual(await shown(),[{kind:'warn',text:'ارتجع الشيك CHQ-QA لعدم كفاية الرصيد.',markup:0}],'5: the simulation\'s own alert is shown, as a warning');
    console.log('5 ok: a command\'s own alert and the simulation\'s are shown too');
    assert.deepEqual(errors,[]);console.log('build672 message strip: 5 checks passed');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
