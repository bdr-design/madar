'use strict';
// Build 675, from the play-through (the owner: none of this is intended). On the real page:
//   1. a refused car purchase read «ألغي شراء سيارات Mobility بالكامل: mobility-center-capacity:0/3000»: it now says how
//      many places the centre has left, or that it is full; a purchase that fits is delivered as before;
//   2. the first step of a career, «افتح شركة اللوجستيات», opened the companies page on the holding's tab: its button
//      opens the subsidiaries tab; the «فتح جميع الشركات» tag counts its companies («15 شركةً», it read «15 شركات»);
//   3. «افتح أول مركز لوجستي» opened the directory unfiltered: it opens the logistics company's sites; the company chosen
//      on the page afterwards is kept when the same page is drawn again, and the task's button filters again when the
//      player comes back from another page; the dashboard counts the companies with no manager («شركة واحدة بلا مدير»);
//   4. a centre opened and working since the day it was ordered was listed among the contracts as «قيد التنفيذ»: the
//      page reads the facility («مكتمل / مشغل»); a facility still under construction keeps «قيد التنفيذ»;
//   5. the market's cards promised a delivery in months on a page that delivers at once: «التسليم فوري»;
//   6. the levels page listed «سدّد الضريبة المستحقة» with no tax due and «أكمل المؤتمر السنوي» before a conference is
//      called as the fastest way up: each is listed when it can be done, and only then;
//   7. the system page counted the save slots against 3 for everyone: 6 where the slots feature is open, 3 in the store
//      edition without Plus; the Plus page no longer promises a free week to everyone.
const assert=require('node:assert/strict');
const {boot}=require('./helpers/local-dom-app');
(async()=>{
  const errors=[];const {page,browser}=await boot({errors,appAudit:'{openCompany}',viewport:{width:844,height:390}});
  try{
    page.setDefaultTimeout(60000);
    const settle=()=>page.waitForFunction(()=>!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked(),null,{timeout:120000});
    const open=async(panel,arg)=>{await page.evaluate(([p,a])=>__AUDIT__.openDrawer(p,a),[panel,arg]);await page.waitForFunction(p=>document.getElementById('drawer').dataset.panel===p,panel);};
    const toasts=()=>page.evaluate(()=>[...document.querySelectorAll('#uiToasts .ui-toast p')].map(node=>node.textContent));
    const closeToasts=async()=>{for(let guard=0;guard<8;guard++){const button=page.locator('#uiToasts .ui-toast button').first();if(!await button.count())break;await button.click({timeout:2000}).catch(()=>{});}};
    const decisions=()=>page.evaluate(()=>[...document.querySelectorAll('#drawer .mc-decision')].map(row=>({title:row.querySelector('b').textContent,go:row.querySelector('.mc-act')?.dataset.go||null,arg:row.querySelector('.mc-act')?.dataset.goArg||null})));
    await page.evaluate(()=>{__GH_STATE__.speed=0;});

    // 1. A refused car purchase (free play, before the career begins: the mobility company opens at a later level).
    await page.evaluate(async()=>{await __AUDIT__.openCompany('mobility');});await settle();await open('network');await page.locator('#worldKind').selectOption('mobility');
    await page.locator('#drawerBody .open-directory-site[data-company="mobility"]:not([disabled])').first().click();await page.waitForFunction(()=>(__GH_STATE__.customHubs||[]).some(row=>row.kind==='mobility-center'));await settle();
    // The centre's own capacity is 3,000 cars; the test's centre is given two bays, as a centre's record may hold.
    await page.evaluate(()=>{__GH_STATE__.customHubs.find(row=>row.kind==='mobility-center').bays=2;});
    const buy=async quantity=>{await open('assetMarket','mobility');const card=page.locator('#drawerBody .mobility-market-card').first();await card.locator('.mobility-purchase-qty').fill(String(quantity));await closeToasts();
      const before=await page.evaluate(()=>__GH_STATE__.alerts.length);await card.locator('.manual-buy-mobility').click();await page.waitForFunction(n=>__GH_STATE__.alerts.length>n&&!window.__GH_DURABLE_COMMAND_CONTEXT__,before);await settle();
      return page.evaluate(()=>({alert:String(__GH_STATE__.alerts[0]),cars:(__GH_STATE__.mobility?.vehicles||[]).length}));};
    const over=await buy(5);assert.deepEqual(over,{alert:'لم يُنفَّذ الشراء: الأماكن المتاحة في هذا المركز 2 من أصل 2.',cars:0},'1: five cars for two places: refused, with the places left');
    assert.ok((await toasts()).includes(over.alert),'1: and the player is shown it');
    const fits=await buy(2);assert.equal(fits.cars,2,'1: two cars for two places are delivered');assert.match(fits.alert,/^تم شراء وتسليم 2 سيارة/,'1: with the purchase\'s own message');
    const full=await buy(1);assert.deepEqual(full,{alert:'لم يُنفَّذ الشراء: هذا المركز ممتلئ (سعته 2 سيارة).',cars:2},'1: a full centre says it is full');
    for(const row of [over,full])assert.doesNotMatch(row.alert,/mobility-center-capacity|ألغي/,'1: no code in the message');
    console.log('1 ok: a refused car purchase says how many places are left, or that the centre is full');

    // 2. The first step of a career.
    await page.evaluate(()=>{__GH_STATE__.progression=GH_PROGRESSION_CORE.initial('career-normal');});await open('groupHub');
    const first=(await decisions()).find(row=>row.title==='افتح شركة اللوجستيات');assert.deepEqual(first,{title:'افتح شركة اللوجستيات',go:'companies',arg:'"subs"'},'2: the first step names the subsidiaries tab');
    await page.locator('#drawer .mc-decision .mc-act[data-go="companies"]').first().click();await page.waitForFunction(()=>document.getElementById('drawer').dataset.panel==='companies');
    const tabs=await page.evaluate(()=>({active:[...document.querySelectorAll('#drawerBody [data-companytab].active')].map(node=>node.dataset.companytab),tag:document.querySelector('#drawerBody .company-open-all .tag')?.textContent||null,unopened:document.querySelectorAll('#drawerBody .company-open-list>*').length}));
    assert.deepEqual(tabs.active,['subs'],'2: its button opens the subsidiaries tab');
    const expected=await page.evaluate(()=>{const s=__GH_STATE__,rows=GH_COMPANY_PLATFORM.listInstances(s,{includeGroup:false}).filter(row=>!(row.opened&&row.operational)&&GH_PROGRESSION_CORE.unlocked(s,`company:${row.id}`)!==false).length;return {rows,text:GH_ARABIC_COPY.count(rows,'company')};});
    assert.ok(expected.rows>=1,'2: companies are within reach');assert.equal(tabs.tag,expected.text,`2: the tag counts them (${expected.text})`);
    console.log(`2 ok: «افتح شركة اللوجستيات» opens the subsidiaries tab; the tag reads «${tabs.tag}»`);

    // 3. The second step.
    await page.evaluate(async()=>{await __AUDIT__.openCompany('road');});await settle();await open('groupHub');const second=await decisions();
    assert.deepEqual(second.find(row=>row.title==='افتح أول مركز لوجستي'),{title:'افتح أول مركز لوجستي',go:'network',arg:'"road"'},'3: the second step names the logistics company\'s sites');
    const vacant=await page.evaluate(()=>GH_COMPANY_PLATFORM.listInstances(__GH_STATE__,{includeGroup:false,openedOnly:true}).filter(row=>row.operational&&!GH_HR_CORE.officialManager(__GH_STATE__,row.id)).length),vacancy=second.find(row=>/بلا مدير تنفيذي$/.test(row.title));
    assert.equal(vacant,2,'3: two companies have no manager');assert.equal(vacancy?.title,'شركتان بلا مدير تنفيذي','3: the dashboard counts them');
    const directory=()=>page.evaluate(()=>({kind:document.getElementById('worldKind')?.value||null,list:document.querySelector('#drawerBody .world-directory')?.dataset.company||null}));
    await page.locator('#drawer .mc-decision .mc-act[data-go="network"][data-go-arg]').first().click();await page.waitForFunction(()=>document.getElementById('drawer').dataset.panel==='network'&&document.getElementById('worldKind'));
    assert.deepEqual(await directory(),{kind:'road',list:'road'},'3: its button opens the logistics company\'s sites');
    await page.locator('#worldKind').selectOption('mobility');await page.waitForFunction(()=>document.querySelector('#drawerBody .world-directory')?.dataset.company==='mobility');
    await page.evaluate(()=>__AUDIT__.openDrawer('network','road'));await page.waitForTimeout(300);assert.deepEqual(await directory(),{kind:'mobility',list:'mobility'},'3: the company chosen on the page is kept when the same page is drawn again');
    await open('groupHub');await page.locator('#drawer .mc-decision .mc-act[data-go="network"][data-go-arg]').first().click();await page.waitForFunction(()=>document.getElementById('drawer').dataset.panel==='network'&&document.getElementById('worldKind'));
    assert.deepEqual(await directory(),{kind:'road',list:'road'},'3: coming back from another page, the task\'s button filters again');
    console.log('3 ok: «افتح أول مركز لوجستي» opens the logistics company\'s sites, and the page keeps the company chosen afterwards');

    // 4. The centre's contract.
    await page.locator('#drawerBody .open-directory-site[data-company="road"]:not([disabled])').first().click();await page.waitForFunction(()=>(__GH_STATE__.customHubs||[]).some(row=>(row.ownerCompanyId||row.company)==='road'));await settle();
    const centre=await page.evaluate(()=>{const s=__GH_STATE__,row=s.customHubs.find(item=>(item.ownerCompanyId||item.company)==='road'),contract=(s.constructionContracts||[]).find(item=>item.id===row.constructionContractId);return {id:row.id,contractId:row.constructionContractId||null,status:contract?.status||null,name:contract?.siteName||null};});
    assert.ok(centre.contractId&&centre.name,'4: the centre has its construction contract');assert.equal(centre.status,'قيد التنفيذ','4: the contract keeps the status it was signed with');
    const tagOf=()=>page.evaluate(name=>{const card=[...document.querySelectorAll('#drawerBody .list-item')].find(node=>node.querySelector('h3')?.textContent.trim()===name);return card?.querySelector('.tag.positive')?.textContent||null;},centre.name);
    await open('contracts');assert.equal(await tagOf(),'مكتمل / مشغل','4: the page reads the working facility');
    await page.evaluate(id=>{__GH_STATE__.customHubs.find(row=>row.id===id).status='قيد الإنشاء';},centre.id);await open('groupHub');await open('contracts');assert.equal(await tagOf(),'قيد التنفيذ','4: a facility under construction keeps «قيد التنفيذ»');
    await page.evaluate(id=>{delete __GH_STATE__.customHubs.find(row=>row.id===id).status;},centre.id);
    console.log('4 ok: a working centre\'s construction contract reads «مكتمل / مشغل»');

    // 5. The market.
    await open('assetMarket','road');const delivery=await page.evaluate(()=>[...document.querySelectorAll('#drawerBody .asset-market-card span')].map(node=>node.textContent.trim()).filter(text=>/^التسليم/.test(text)));
    assert.ok(delivery.length>=2,`5: the cards state their delivery (${delivery.length})`);assert.deepEqual([...new Set(delivery)],['التسليم فوري'],'5: at once, on every card');
    console.log(`5 ok: ${delivery.length} market cards read «التسليم فوري»`);

    // 6. The fastest way up.
    const steps=async()=>{await open('groupHub');await page.evaluate(()=>__AUDIT__.openDrawer('progression',{tab:'progress'}));await page.waitForSelector('#drawerBody .lv[data-levels-tab="progress"]');return page.evaluate(()=>[...document.querySelectorAll('#drawerBody .lv-step .lv-go')].map(node=>node.dataset.go));};
    // A known position: the start of level 10 (far from the next level, so three steps are listed), the first four steps done.
    await page.evaluate(()=>{const p=__GH_STATE__.progression;window.__QA_PROGRESS__=JSON.stringify({milestones:p.milestones,level:p.level,xp:p.xp});for(const key of ['first-company','first-facility','first-contract','first-trip'])p.milestones[key]=0;p.level=10;p.xp=GH_PROGRESSION_CORE.XP[9];});
    const due=await page.evaluate(()=>({tax:(__GH_STATE__.finance?.periods||[]).some(row=>row?.status==='مستحق'),conference:__GH_STATE__.advanced?.conference?.pendingYear??null,current:!!__GH_STATE__.advanced?.conference?.current}));
    assert.deepEqual(due,{tax:false,conference:null,current:false},'6: no tax is due and no conference is called');
    assert.deepEqual(await steps(),['monthlyFinance','monthlyFinance','monthlyFinance'],'6: neither the tax nor the conference is offered');
    await page.evaluate(()=>{const s=__GH_STATE__;s.finance.periods.push({id:'QA-TAX-DUE',status:'مستحق'});});assert.deepEqual(await steps(),['invoices','monthlyFinance','monthlyFinance'],'6: with a tax due, paying it is the first step');
    await page.evaluate(()=>{const s=__GH_STATE__;s.finance.periods.pop();s.advanced.conference=s.advanced.conference||{};s.advanced.conference.pendingYear=2027;});assert.deepEqual(await steps(),['monthlyFinance','conference','monthlyFinance'],'6: with a conference called, it is offered in its place');
    await page.evaluate(()=>{const s=__GH_STATE__;s.advanced.conference.pendingYear=null;Object.assign(s.progression,JSON.parse(window.__QA_PROGRESS__));});
    console.log('6 ok: the tax and the conference are offered when they can be done, and only then');

    // 7. The save slots and the Plus page.
    const slots=async()=>{await open('groupHub');await open('systemHub');return page.evaluate(()=>[...document.querySelectorAll('#drawer *')].filter(node=>node.children.length===0&&node.textContent.trim()==='خانات الحفظ').map(node=>node.parentElement.textContent.replace('خانات الحفظ','').trim())[0]||null);};
    const used=await page.evaluate(()=>GH_STORE_CORE.featureOpen(__GH_STATE__,'slots'));assert.equal(used,true,'7: the slots feature is open in this edition');assert.match(await slots(),/^\d من 6$/,'7: six slots where the feature is open');
    await page.evaluate(()=>{window.__QA_EDITION__=window.GH_EDITION;window.GH_EDITION='release';});
    try{assert.equal(await page.evaluate(()=>GH_STORE_CORE.featureOpen(__GH_STATE__,'slots')),false);assert.match(await slots(),/^\d من 3$/,'7: three slots in the store edition without Plus');
      await page.evaluate(()=>__AUDIT__.openDrawer('store',{tab:'plus'}));await page.waitForSelector('#drawerBody .st-cta');
      const plus=await page.evaluate(()=>({text:document.getElementById('drawerBody').textContent,cta:document.querySelector('#drawerBody .st-cta').textContent.trim(),checks:[...document.querySelectorAll('#drawerBody .st-chk span')].map(node=>node.textContent.trim()).filter(Boolean)}));
      assert.doesNotMatch(plus.text,/أسبوع مجاني|أسبوعك المجاني/,'7: no free week is promised');assert.equal(plus.cta,'اشترك الآن');assert.deepEqual(plus.checks,['العرض التجريبي، إن توفّر لك، يظهر في نافذة المتجر','ألغِ متى شئت من حسابك في المتجر']);}
    finally{await page.evaluate(()=>{if(window.__QA_EDITION__===undefined)delete window.GH_EDITION;else window.GH_EDITION=window.__QA_EDITION__;});}
    console.log('7 ok: the system page counts the slots the edition gives; the Plus page promises no free week');
    assert.deepEqual(errors,[],'no page error');
    console.log('BUILD675_TASK_TARGETS_AND_PAGE_TEXTS_BROWSER_PASS');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
