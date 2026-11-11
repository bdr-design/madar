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
// Build 676, from the review of the strip:
//   6. the simulation's line for each completed trip, and its summary of many, stays in the list and off the strip
//      (at 300× they kept two messages on the screen through play); of more than two new alerts the gravest and then
//      the newest are shown, in the order written (a bounced cheque written before two results was never shown);
//   7. the same refusal is shown every time it is raised (the fifth equal refusal showed nothing);
//   8. an alert a staged slice has written is not shown before the slice settles: taken back with a cancelled slice it
//      is never shown and no older alert is shown again; committed, it is shown once;
//   9. a list replaced under the strip (a recovery) shows nothing; an alert written after it is shown; an alert written
//      without the alerts' owner (a level-up) is shown;
//  10. a notice raised while the save is locked is shown without being written; notices raised during a command are
//      joined and take the gravest kind; an English refusal is a warning; the kind is named to assistive technology,
//      the close button is labelled and at least 28 points, and a long message is cut at five lines.
const assert=require('node:assert/strict');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');
(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[];
  try{
    const {page}=await boot({browser,errors,viewport:{width:844,height:390}});page.setDefaultTimeout(60000);
    const shown=()=>page.evaluate(()=>[...document.querySelectorAll('#uiToasts .ui-toast')].map(node=>({kind:node.dataset.kind,text:node.querySelector('p').textContent,markup:node.querySelector('p').children.length})));
    const gone=()=>page.waitForFunction(()=>!document.getElementById('uiToasts'),null,{timeout:20000});
    // (a message may expire between the count and the click: the click is then given up, and the count read again)
    const closeAll=async()=>{for(let guard=0;guard<8&&await page.locator('#uiToasts .ui-toast button').count();guard++)await page.locator('#uiToasts .ui-toast button').first().click({timeout:2000}).catch(()=>{});await gone();};
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

    // (Build 676) The same text again while it is the only message: shown once, and no page error.
    await closeAll();await notify('رسالة وحيدة.','info');await page.waitForFunction(()=>document.querySelectorAll('#uiToasts .ui-toast').length===1);await notify('رسالة وحيدة.','info');await page.waitForTimeout(300);
    assert.deepEqual((await shown()).map(row=>row.text),['رسالة وحيدة.'],'3: the only message, raised again, is shown once');assert.deepEqual(errors,[],'3: and the strip took it without a page error');await closeAll();
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

    // 6. Routine lines stay off the strip; the gravest and the newest of many are shown.
    await closeAll();
    const write=(text,type='simulation')=>page.evaluate(([text,type])=>{GH_DOMAIN_COMMANDS.dispatchSystem({state:__GH_STATE__},'operations','record-alert',{text,type},{actor:'simulation-scheduler'});},[text,type]);
    const refresh=()=>page.evaluate(()=>__AUDIT__.updateKpis()),texts=async()=>(await shown()).map(row=>[row.kind,row.text]);
    const TRIPS=['A320-001 أكمل رحلة. إيراد $120.0K − وقود $40.0K − صيانة $8.0K = هامش $72.0K.','B777-004 أكمل 3 رحلات أثناء تقديم الوقت بإجمالي هامش $410.0K.','أصول ونفوذ للطيران: اكتملت 1,240 رحلة في هذه الفترة. إيراد $9.1M − وقود $3.0M − صيانة $0.6M = هامش $5.5M. الرواتب الثابتة تُصرف في مسير 27.'];
    for(const text of TRIPS)await write(text);await refresh();await page.waitForTimeout(300);
    assert.deepEqual(await texts(),[],'6: the lines of completed trips are not shown');assert.deepEqual(await page.evaluate(()=>__GH_STATE__.alerts.slice(0,3)),[...TRIPS].reverse(),'6: and stay in the list');
    await write('ارتجع الشيك CHQ-7 لعدم كفاية الرصيد.','operation');await write('تم صرف الشيك CHQ-8 من حساب الشركة.','operation');await write('تم صرف الشيك CHQ-9 من حساب الشركة.','operation');await write(TRIPS[0]);await refresh();
    await page.waitForFunction(()=>document.querySelectorAll('#uiToasts .ui-toast').length===2);
    assert.deepEqual(await texts(),[['warn','ارتجع الشيك CHQ-7 لعدم كفاية الرصيد.'],['info','تم صرف الشيك CHQ-9 من حساب الشركة.']],'6: of three new alerts the gravest and the newest are shown, in the order written');
    await closeAll();await refresh();await page.waitForTimeout(200);assert.deepEqual(await texts(),[],'6: and none of them again');
    await write('تم صرف الشيك CHQ-10 من حساب الشركة.','operation');await write('تم صرف الشيك CHQ-11 من حساب الشركة.','operation');await write('أُوقفت المحاكاة مؤقتًا: محرك الأسطول غير متاح الآن.','operation');await refresh();await page.waitForFunction(()=>document.querySelectorAll('#uiToasts .ui-toast').length===2);
    assert.deepEqual(await texts(),[['info','تم صرف الشيك CHQ-11 من حساب الشركة.'],['warn','أُوقفت المحاكاة مؤقتًا: محرك الأسطول غير متاح الآن.']],'6: the two shown keep the order they were written in');await closeAll();
    console.log('6 ok: completed-trip lines stay off the strip; the gravest and the newest of many are shown');

    // 7. The same refusal, every time.
    await page.evaluate(()=>__AUDIT__.openDrawer('finance','transfers'));
    for(let press=1;press<=7;press++){const count=await page.evaluate(()=>__GH_STATE__.alerts.length);await page.locator('#drawerBody .repay-debt[data-company="group"]').first().click();
      await page.waitForFunction(()=>document.querySelectorAll('#uiToasts .ui-toast').length===1,null,{timeout:10000}).catch(()=>{});const row=await shown();
      assert.equal(row.length,1,`7: press ${press} of the same refused button shows its message`);assert.match(row[0].text,/^لا يوجد دين قائم على/);assert.equal(row[0].kind,'warn');await closeAll();await settle();
      assert.ok(await page.evaluate(()=>__GH_STATE__.alerts.length)>=Math.min(40,count+1)||count===40,'7: and it is written');}
    assert.deepEqual(await page.evaluate(()=>__GH_STATE__.alerts.slice(0,5).map(text=>/^لا يوجد دين قائم على/.test(text))),[true,true,true,true,true],'7: the list holds five equal refusals at its head');
    console.log('7 ok: the same refusal is shown at each of seven presses');

    // 8. A staged slice's alerts. The slice is stood in for by the transaction owner's own answer (isStaged), inside one
    // task of the page so that no frame of the game runs meanwhile.
    const staged=await page.evaluate(()=>{const real=window.GH_TRANSACTION_CORE,count=()=>document.querySelectorAll('#uiToasts .ui-toast').length,read=()=>[...document.querySelectorAll('#uiToasts .ui-toast p')].map(node=>node.textContent),out={};
      const hold=on=>{window.GH_TRANSACTION_CORE=on?Object.create(real,{isStaged:{value:()=>true}}):real;};
      try{hold(true);GH_OPERATIONS_CORE.execute({state:__GH_STATE__},'record-alert',{text:'تعذر إكمال رحلة QA-1: شريحة ملغاة.',type:'simulation'});__AUDIT__.updateKpis();out.duringCancelled=count();
        __GH_STATE__.alerts.shift();__GH_STATE__.eventLog.shift();hold(false);__AUDIT__.updateKpis();out.afterCancelled=read();
        hold(true);GH_OPERATIONS_CORE.execute({state:__GH_STATE__},'record-alert',{text:'تعذر إكمال رحلة QA-2: شريحة معتمدة.',type:'simulation'});__AUDIT__.updateKpis();out.duringCommitted=count();
        hold(false);__AUDIT__.updateKpis();out.afterCommitted=read();__AUDIT__.updateKpis();out.again=read();}finally{hold(false);}return out;});
    assert.deepEqual(staged,{duringCancelled:0,afterCancelled:[],duringCommitted:0,afterCommitted:['تعذر إكمال رحلة QA-2: شريحة معتمدة.'],again:['تعذر إكمال رحلة QA-2: شريحة معتمدة.']},'8: a staged alert waits for its slice; a cancelled one is never shown and replays nothing; a committed one is shown once');
    await closeAll();console.log('8 ok: a staged slice\'s alert is shown when the slice has settled, and never when it was cancelled');

    // 9. A list replaced under the strip; an alert written without the alerts' owner.
    const replaced=await page.evaluate(()=>{const read=()=>[...document.querySelectorAll('#uiToasts .ui-toast p')].map(node=>node.textContent),out={},kept=__GH_STATE__.alerts;
      __GH_STATE__.alerts=['تعذر حفظ قديم 1.','تعذر حفظ قديم 2.','تعذر حفظ قديم 3.','تعذر حفظ قديم 4.','تعذر حفظ قديم 5.'];__AUDIT__.updateKpis();out.replaced=read();
      GH_OPERATIONS_CORE.execute({state:__GH_STATE__},'record-alert',{text:'تعذر حفظ جديد.',type:'operation'});__AUDIT__.updateKpis();out.next=read();
      __GH_STATE__.alerts=kept;__AUDIT__.updateKpis();out.restored=read();return out;});
    assert.deepEqual(replaced,{replaced:[],next:['تعذر حفظ جديد.'],restored:['تعذر حفظ جديد.']},'9: a replaced list shows nothing of its own; the alert written after it is shown');await closeAll();
    await page.evaluate(()=>{__GH_STATE__.alerts.unshift('ترقية المجموعة إلى المستوى 4: شركات وأدوات جديدة.');__AUDIT__.updateKpis();});await page.waitForFunction(()=>document.querySelectorAll('#uiToasts .ui-toast').length===1);
    assert.deepEqual(await texts(),[['info','ترقية المجموعة إلى المستوى 4: شركات وأدوات جديدة.']],'9: an alert written without the alerts\' owner is shown');await closeAll();
    console.log('9 ok: a replaced list replays nothing; a level-up written without the owner is shown');

    // 10. The locked save, joined notices, English, and what assistive technology and a finger are given.
    const locked=await page.evaluate(()=>{const real=window.GH_PERSISTENCE,before=__GH_STATE__.alerts.length;window.GH_PERSISTENCE=Object.create(real,{isLocked:{value:()=>true}});
      try{const returned=window.GH_INTERACTION_NOTICE('تعذر الحفظ الآن: الخزنة مشغولة.','error');return {returned,written:__GH_STATE__.alerts.length-before,shown:[...document.querySelectorAll('#uiToasts .ui-toast')].map(node=>[node.dataset.kind,node.querySelector('p').textContent])};}finally{window.GH_PERSISTENCE=real;}});
    assert.deepEqual(locked,{returned:false,written:0,shown:[['err','تعذر الحفظ الآن: الخزنة مشغولة.']]},'10: a notice raised while the save is locked is shown, as raised, and not written');await closeAll();
    await page.evaluate(()=>__AUDIT__.runDurableStateCommand('qa-joined-notices',()=>{window.GH_INTERACTION_NOTICE('اكتمل الجزء الأول.','info');window.GH_INTERACTION_NOTICE('تعذر الجزء الثاني.','error');return {ok:true};}));await settle();
    await page.waitForFunction(()=>document.querySelectorAll('#uiToasts .ui-toast').length===1);assert.deepEqual(await texts(),[['err','اكتمل الجزء الأول. • تعذر الجزء الثاني.']],'10: notices raised during a command are joined and take the gravest kind');await closeAll();
    await write('Could not save slot 1: the storage is full.','operation');await write('Cannot open this company yet.','operation');await refresh();await page.waitForFunction(()=>document.querySelectorAll('#uiToasts .ui-toast').length===2);
    assert.deepEqual((await shown()).map(row=>row.kind),['warn','warn'],'10: an English refusal is a warning');
    const parts=await page.evaluate(()=>{const row=document.querySelector('#uiToasts .ui-toast'),mark=row.querySelector('i'),close=row.querySelector('button'),box=close.getBoundingClientRect();return {role:mark.getAttribute('role'),label:mark.getAttribute('aria-label'),hidden:mark.getAttribute('aria-hidden'),close:close.getAttribute('aria-label'),width:box.width,height:box.height};});
    assert.deepEqual({role:parts.role,label:parts.label,hidden:parts.hidden,close:parts.close},{role:'img',label:'تحذير',hidden:null,close:'إغلاق الرسالة'},'10: the kind and the close button are named');assert.ok(parts.width>=28&&parts.height>=28,`10: the close button is at least 28 points (${parts.width}×${parts.height})`);
    await closeAll();await notify('تعذر توزيع الأسطول: '+'مسار طويل بين مدينتين بعيدتين جدًا '.repeat(24),'error');await page.waitForFunction(()=>document.querySelectorAll('#uiToasts .ui-toast').length===1);
    const long=await page.evaluate(()=>{const body=document.querySelector('#uiToasts .ui-toast p'),style=getComputedStyle(body);return {lines:Math.round(body.clientHeight/parseFloat(style.lineHeight)),cut:body.scrollHeight>body.clientHeight+1,clamp:style.webkitLineClamp,bottom:document.getElementById('uiToasts').getBoundingClientRect().bottom};});
    assert.deepEqual({lines:long.lines,cut:long.cut,clamp:long.clamp},{lines:5,cut:true,clamp:'5'},'10: a long message is cut at five lines, with an ellipsis');assert.ok(long.bottom<=195,`10: and leaves half the screen free (${long.bottom})`);await closeAll();
    console.log('10 ok: the locked save, joined notices, English refusals, the names and the size of the parts, and long messages');
    // 11 (Build 681, review). A burst between two reads that pushes the list as last read off the list, with alerts written
    // without their owner among it (a month advanced at once: headlines, a level-up): its gravest and its newest are shown.
    await refresh();const burst=await page.evaluate(()=>{const record=text=>GH_OPERATIONS_CORE.execute({state:__GH_STATE__},'record-alert',{text,type:'operation'});
      for(let index=0;index<20;index++)record(`اكتملت مراجعة الفرع ${index}.`);record('ارتجع الشيك CHQ-BURST لعدم كفاية الرصيد.');for(let index=20;index<35;index++)record(`اكتملت مراجعة الفرع ${index}.`);
      __GH_STATE__.alerts.unshift('عنوان اقتصادي: أسعار الوقود ترتفع.');__GH_STATE__.alerts.unshift('ترقية المجموعة إلى المستوى 5: أدوات جديدة.');__GH_STATE__.alerts=__GH_STATE__.alerts.slice(0,40);
      return {length:__GH_STATE__.alerts.length,cheque:__GH_STATE__.alerts.indexOf('ارتجع الشيك CHQ-BURST لعدم كفاية الرصيد.')};});
    assert.deepEqual({length:burst.length,held:burst.cheque>=0&&burst.cheque<36},{length:40,held:true},'11: thirty-six counted alerts and two uncounted fill the list');
    await refresh();await page.waitForFunction(()=>document.querySelectorAll('#uiToasts .ui-toast').length===2,null,{timeout:5000});
    assert.deepEqual(await texts(),[['warn','ارتجع الشيك CHQ-BURST لعدم كفاية الرصيد.'],['info','ترقية المجموعة إلى المستوى 5: أدوات جديدة.']],'11: the gravest of the burst and its newest are shown');await closeAll();
    await refresh();assert.deepEqual(await texts(),[],'11: once');
    // A burst that is mostly not counted (a month's headlines): a bounced cheque, then thirty headlines with eight
    // counted results among them. One line of the list as last read still shows at the end; the cheque is before it.
    await refresh();const news=await page.evaluate(()=>{const record=text=>GH_OPERATIONS_CORE.execute({state:__GH_STATE__},'record-alert',{text,type:'operation'});
      record('ارتجع الشيك CHQ-NEWS لعدم كفاية الرصيد.');for(let index=0;index<38;index++){if(index%5===2)record(`اكتملت مراجعة القسم ${index}.`);else{__GH_STATE__.alerts.unshift(`عنوان اقتصادي ${index}: الأسواق تتحرك.`);__GH_STATE__.alerts=__GH_STATE__.alerts.slice(0,40);}}
      return {length:__GH_STATE__.alerts.length,cheque:__GH_STATE__.alerts.indexOf('ارتجع الشيك CHQ-NEWS لعدم كفاية الرصيد.'),newest:__GH_STATE__.alerts[0]};});
    assert.deepEqual({length:news.length,cheque:news.cheque},{length:40,cheque:38},'11: the cheque is the oldest of thirty-nine new lines');
    await refresh();await page.waitForFunction(()=>document.querySelectorAll('#uiToasts .ui-toast').length===2,null,{timeout:5000});
    assert.deepEqual(await texts(),[['warn','ارتجع الشيك CHQ-NEWS لعدم كفاية الرصيد.'],['info',news.newest]],'11: the cheque is shown though few of the lines after it were counted');await closeAll();await refresh();assert.deepEqual(await texts(),[],'11: once');
    console.log('11 ok: a burst that leaves no place for the list as last read shows its gravest and its newest');
    assert.deepEqual(errors,[]);console.log('build672 message strip: 11 checks passed');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
