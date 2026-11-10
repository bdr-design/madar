'use strict';
// Build 678, from the play-through (the owner: none of this is intended). On the real page:
//   1. free play founds fifteen companies whose capitals are 1.09B from 1.00B: «فتح جميع الشركات» was refused whole. It
//      founds the companies the balance covers, in the page's order, names the ones left, and leaves no negative balance;
//   2. the monthly income page: its title was cut by the bar and its record's last column lay outside the page;
//   3. the calendar: in the store edition without Plus the advances of more than a day carry the Plus mark (they
//      looked like «+ يوم»); none where the feature is open; the help is one line at the panel's foot; «+ 30 يومًا»;
//   4. a career's market promised «حتى 1,000,000 أصل» and «متاح 1,000,000/1,000,000» at a level that allows 150: the page
//      names the level's ceiling, what the company holds and what is left; free play keeps the facility's own figures;
//   5. the dashboard said the same thing twice («لا توجد منشآت بعد» and «افتح أول مركز لوجستي»): one decision;
//   6. «بيع جميع أصول الشركة» of a company with no asset gave a generic reason: it says there is nothing to sell;
//   7. «تفاصيل العقد» wrote its figures as a notice: they open inside the tender's card, and close again.
const assert=require('node:assert/strict');
const {boot}=require('./helpers/local-dom-app');
(async()=>{
  const errors=[];const {page,browser}=await boot({errors,appAudit:'{openCompany}',viewport:{width:844,height:390}});
  try{
    page.setDefaultTimeout(60000);
    const settle=()=>page.waitForFunction(()=>!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked(),null,{timeout:120000});
    const open=async(panel,arg)=>{await page.evaluate(([p,a])=>__AUDIT__.openDrawer(p,a),[panel,arg]);await page.waitForFunction(p=>document.getElementById('drawer').dataset.panel===p,panel);};
    await page.evaluate(()=>{__GH_STATE__.speed=0;});

    // 2. The monthly income page (before anything is founded: the page is the same).
    await open('monthlyFinance');
    const monthly=await page.evaluate(()=>{const title=document.getElementById('drawerTitle'),table=document.querySelector('#drawerBody .monthly-history-table'),body=document.getElementById('drawerBody').getBoundingClientRect(),cells=[...table.querySelectorAll('.monthly-history-head>b')].map(node=>node.getBoundingClientRect());
      return {title:title.textContent.trim(),cut:title.scrollWidth>title.clientWidth,overflow:table.scrollWidth-table.clientWidth,columns:cells.length,outside:cells.filter(box=>box.left<body.left-1||box.right>body.right+1).length};});
    assert.deepEqual(monthly,{title:'الدخل والمصروفات',cut:false,overflow:0,columns:4,outside:0},'2: the title is whole and the record\'s four columns are inside the page');
    console.log('2 ok: the monthly page\'s title is whole and its record fits the page');

    // 3. The calendar.
    await page.click('#simCalendarToggle');await page.waitForFunction(()=>{const panel=document.getElementById('simCalendarPanel');return panel&&!panel.classList.contains('hidden')&&panel.getBoundingClientRect().height>50;});
    const calendar=()=>page.evaluate(()=>{const panel=document.getElementById('simCalendarPanel');panel.scrollTop=panel.scrollHeight;const box=panel.getBoundingClientRect(),small=panel.querySelector('.sim-cal-foot small'),help=small.getBoundingClientRect();
      return {steps:[...panel.querySelectorAll('[data-calendar-advance]')].map(node=>[node.dataset.calendarAdvance,node.textContent.trim(),node.dataset.plusOnly||null,getComputedStyle(node,'::after').content]),day:[document.getElementById('simNextDay').textContent.trim(),document.getElementById('simNextDay').dataset.plusOnly||null],helpInside:help.top>=box.top-1&&help.bottom<=box.bottom+1&&help.height>0,helpLines:help.height<=parseFloat(getComputedStyle(small).fontSize)*1.9?1:2,helpText:small.textContent.trim()};});
    const openCalendar=await calendar();assert.deepEqual(openCalendar.steps.map(row=>row.slice(0,3)),[['7','+ 7 أيام',null],['30','+ 30 يومًا',null],['year',openCalendar.steps[2][1],null]],'3: where the feature is open the advances carry no mark');assert.deepEqual(openCalendar.day,['+ يوم',null]);
    assert.deepEqual({inside:openCalendar.helpInside,lines:openCalendar.helpLines,text:openCalendar.helpText},{inside:true,lines:1,text:'حتى سنة في كل عملية، مع كل الإقفالات والرواتب والضرائب.'},'3: the help is one whole line at the panel\'s foot (it was two, the second cut)');
    await page.evaluate(()=>{window.__QA_EDITION__=window.GH_EDITION;window.GH_EDITION='release';});
    try{await page.click('#simCalendarToggle');await page.click('#simCalendarToggle');await page.waitForFunction(()=>document.querySelector('#simCalendarPanel [data-calendar-advance]')?.dataset.plusOnly);
      const locked=await calendar();assert.deepEqual(locked.steps.map(row=>[row[0],row[2],row[3]]),[['7','بلس','"بلس"'],['30','بلس','"بلس"'],['year','بلس','"بلس"']],'3: in the store edition without Plus each longer advance carries the Plus mark');assert.deepEqual(locked.day,['+ يوم',null],'3: «+ يوم» carries none');}
    finally{await page.evaluate(()=>{if(window.__QA_EDITION__===undefined)delete window.GH_EDITION;else window.GH_EDITION=window.__QA_EDITION__;});}
    await page.click('#simCalendarToggle');
    console.log('3 ok: the longer advances carry the Plus mark in the store edition without Plus; the help line is whole');

    // 1. «فتح جميع الشركات» with a balance that does not cover every company.
    await open('companies','subs');
    const before=await page.evaluate(()=>{const s=__GH_STATE__,rows=GH_COMPANY_PLATFORM.listInstances(s,{includeGroup:false}).filter(row=>row.definition?.kind==='subsidiary'&&row.definition?.lifecycle==='active'&&!(row.opened&&row.operational)).map(row=>({id:row.id,capital:Number(row.definition.founding.defaultCapital)||0})),cash=GH_FINANCE_CORE.operating(s,'group');
      let room=cash;const fit=[],left=[];for(const row of rows){if(row.capital<=room){fit.push(row.id);room-=row.capital;}else left.push(row.id);}
      const card=document.querySelector('#drawerBody .company-open-all'),button=card.querySelector('.open-all-companies');return {cash,total:rows.reduce((n,row)=>n+row.capital,0),fit,left,spent:cash-room,text:card.textContent.replace(/\s+/g,' '),label:button.textContent.trim(),disabled:button.disabled,expected:GH_ARABIC_COPY.count(fit.length,'company')};});
    assert.ok(before.total>before.cash&&before.left.length>=1&&before.fit.length>=10,`1: the capitals (${before.total}) are more than the balance (${before.cash}); ${before.fit.length} companies fit`);
    assert.deepEqual({label:before.label,disabled:before.disabled},{label:'مراجعة وفتح ما يغطيه الرصيد',disabled:false},'1: the button founds what the balance covers');assert.ok(before.text.includes(`يغطي الرصيد${before.expected}`),`1: the card says how many (${before.expected})`);
    await page.locator('#drawerBody .open-all-companies').click();await page.waitForSelector('#uiConfirm [data-confirm="accept"],.dx [data-confirm="accept"],[data-confirm="accept"]');
    const question=await page.evaluate(()=>document.querySelector('[data-confirm="accept"]').closest('[role="dialog"],[role="alertdialog"],.dx,dialog,div').parentElement.textContent.replace(/\s+/g,' '));
    assert.ok(question.includes(`فتح ${before.expected} الآن؟`),'1: the confirmation counts the companies it founds');assert.match(question,/لا يغطي رصيد القابضة رأس مال: .+؛ تبقى متاح(ة|ةً) للفتح\./,'1: and names the ones the balance does not cover');
    await page.locator('[data-confirm="accept"]').click();await page.waitForFunction(n=>__GH_STATE__.openedCompanies.length>=n,before.fit.length,{timeout:60000});await settle();
    const after=await page.evaluate(()=>({opened:[...__GH_STATE__.openedCompanies],cash:GH_FINANCE_CORE.operating(__GH_STATE__,'group'),valid:GH_SAVE_SCHEMA.validate(__GH_STATE__).ok}));
    assert.deepEqual([...after.opened].sort(),[...before.fit].sort(),'1: exactly the companies the balance covers are founded');assert.equal(Math.round(after.cash*100),Math.round((before.cash-before.spent)*100),'1: for their capitals, and no more');assert.ok(after.cash>=0&&after.valid,'1: no negative balance; the state is valid');
    await open('groupHub');await open('companies','subs');const rest=await page.evaluate(()=>{const card=document.querySelector('#drawerBody .company-open-all'),button=card?.querySelector('.open-all-companies');return card?{tag:card.querySelector('.tag').textContent.trim(),disabled:button.disabled,reason:button.dataset.disabledReason||null}:null;});
    assert.deepEqual(rest,{tag:await page.evaluate(n=>GH_ARABIC_COPY.count(n,'company'),before.left.length),disabled:true,reason:'رصيد القابضة لا يغطي رأس مال أي شركة متاحة.'},'1: the company left stays on the page, with the reason it cannot be founded now');
    console.log(`1 ok: «فتح جميع الشركات» founded ${before.fit.length} companies from the balance and left ${before.left.length}`);

    // 6. A company with no asset has nothing to sell.
    await page.waitForFunction(()=>__AUDIT__.currentFleetUiSummary?.()!=null,null,{timeout:30000}).catch(()=>{});
    await open('assetMarket','road');await page.waitForFunction(()=>{const button=document.querySelector('#drawerBody .sell-all-assets[data-company="road"]');return button&&button.dataset.disabledReason!=='جارٍ تحديث ملخص الأسطول من العامل.';},null,{timeout:30000});
    const sell=await page.evaluate(()=>{const button=document.querySelector('#drawerBody .sell-all-assets[data-company="road"]');return {disabled:button.disabled,reason:button.dataset.disabledReason||null};});
    assert.deepEqual(sell,{disabled:true,reason:'لا تملك هذه الشركة أصولًا للبيع.'},'6: nothing to sell, said so');
    // 4 (free play): the facility's own figures.
    await open('network');await page.locator('#worldKind').selectOption('road');await page.locator('#drawerBody .open-directory-site[data-company="road"]:not([disabled])').first().click();await page.waitForFunction(()=>(__GH_STATE__.customHubs||[]).some(row=>(row.ownerCompanyId||row.company)==='road'));await settle();
    const market=async()=>{await open('groupHub');await open('assetMarket','road');await page.waitForSelector('#drawerBody .manual-asset-qty');return page.evaluate(()=>({hint:document.querySelector('#drawerBody .manual-asset-qty-hint').textContent.trim(),max:document.querySelector('#drawerBody .manual-asset-qty').max,base:[...document.querySelectorAll('#drawerBody select option')].map(node=>node.textContent).find(text=>/متاح /.test(text))?.replace(/^.*متاح /,'')||null}));};
    const free=await market();assert.deepEqual(free,{hint:'حتى 1,000,000 أصل، ضمن سعة المنشآت وسعة الحفظ في الجهاز',max:'1000000',base:'1,000,000/1,000,000'},'4: free play keeps the facility\'s own figures');
    console.log('6 ok: a company with no asset has nothing to sell');

    // 4 (career) and 5.
    await page.evaluate(()=>{const P=GH_PROGRESSION_CORE;__GH_STATE__.progression=P.initial('career-normal');__GH_STATE__.progression.level=3;__GH_STATE__.progression.xp=P.XP[2];});
    const band=await page.evaluate(()=>({limit:GH_PROGRESSION_CORE.bandLimit(__GH_STATE__,'road','road'),held:GH_PROGRESSION_CORE.heldFleet(__GH_STATE__,'road')}));assert.ok(band.limit>0&&band.limit<1000000&&band.held===0,`4: the level's ceiling (${band.limit})`);
    const career=await market(),ceiling=band.limit.toLocaleString('en-US');
    assert.deepEqual(career,{hint:`حتى ${await page.evaluate(n=>GH_ARABIC_COPY.count(n,'asset'),band.limit)}: سقف مستواك ${ceiling} وتملك الشركة 0`,max:String(band.limit),base:`${ceiling}/${ceiling}`},'4: a career\'s market names the level\'s ceiling, what the company holds and what is left');
    await open('groupHub');const decisions=await page.evaluate(()=>[...document.querySelectorAll('#drawer .mc-decision b')].map(node=>node.textContent));
    assert.deepEqual(decisions.filter(text=>/منشآت بعد|مركز لوجستي/.test(text)),[],'5: with a centre open neither decision is raised');
    await page.evaluate(()=>{window.__QA_HUBS__=__GH_STATE__.customHubs;__GH_STATE__.customHubs=__GH_STATE__.customHubs.filter(row=>(row.ownerCompanyId||row.company)!=='road');});await open('contracts');await open('groupHub');
    const twice=await page.evaluate(()=>[...document.querySelectorAll('#drawer .mc-decision b')].map(node=>node.textContent));await page.evaluate(()=>{__GH_STATE__.customHubs=window.__QA_HUBS__;});
    assert.deepEqual(twice.filter(text=>/منشآت بعد|مركز لوجستي/.test(text)),['افتح أول مركز لوجستي'],'5: without one, the first step alone says so');
    console.log(`4 ok: the market names the level's ceiling (${ceiling})`);console.log('5 ok: one decision for the first centre');

    // 7. A tender's details open inside its card.
    await open('contracts');const details=page.locator('#drawerBody .inspect-contract').first(),alerts=await page.evaluate(()=>__GH_STATE__.alerts.length);
    const card=()=>page.evaluate(()=>{const button=document.querySelector('#drawerBody .inspect-contract'),block=button.closest('article').querySelector('[data-contract-details]');return {label:button.textContent.trim(),expanded:button.getAttribute('aria-expanded'),hidden:block.hidden,shown:block.getBoundingClientRect().height>0,rows:[...block.querySelectorAll('span')].map(node=>node.textContent),values:[...block.querySelectorAll('b')].map(node=>node.textContent.trim()).filter(Boolean).length};});
    assert.deepEqual(await card(),{label:'تفاصيل العقد',expanded:'false',hidden:true,shown:false,rows:['قيمة العقد','التكلفة المتوقعة','الهامش الكامل','مستوى الخدمة','القدرة المطلوبة','الغرامات'],values:6},'7: the figures are in the card, closed');
    await details.click();assert.deepEqual((({label,expanded,hidden,shown})=>({label,expanded,hidden,shown}))(await card()),{label:'إخفاء التفاصيل',expanded:'true',hidden:false,shown:true},'7: the button opens them');
    await details.click();assert.deepEqual((({label,expanded,hidden,shown})=>({label,expanded,hidden,shown}))(await card()),{label:'تفاصيل العقد',expanded:'false',hidden:true,shown:false},'7: and closes them');
    assert.equal(await page.evaluate(()=>__GH_STATE__.alerts.length),alerts,'7: nothing is written to the alerts list');
    console.log('7 ok: a tender\'s details open inside its card');

    assert.deepEqual(errors,[],'no page error');
    console.log('BUILD678_BALANCE_CAPACITY_AND_DETAILS_BROWSER_PASS');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
