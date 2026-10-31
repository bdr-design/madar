'use strict';
// Owner (approved levels page, «تم»): the levels page is full screen in the store's language with three tabs, and its smart
// parts read the player's own state. The whole app (local DOM), a career group with the logistics company:
//   1. progress: the level, its title, the 10-segment bar at the true progress; the time to the next level at the player's
//      rate over the closed days since its record began, at most 7 (GH_PROGRESSION_CORE.xpRate), and none before a day has closed;
//   2. the fastest path: the open milestones in the order they come within reach, the fewest that cover what is left (at
//      most 3), each with its experience and the panel it opens; a done milestone is never offered; its button opens
//      that panel;
//   3. today's experience and its sources (GH_PROGRESSION_CORE.xpToday); the next-level card opens the path at that level;
//   4. path: 30 levels, the chosen one marked; a level that opens a company tells whether the holding's cash covers its
//      founding capital; a level already reached says so;
//   5. goals: every milestone once, with its experience at the player's multiplier; the bands of the opened companies;
//      the early licences within reach keep the signed licence action and its fee;
//   6. the markup keeps only width:% inline (the drawer's own rule); the close button returns to the game; a free-play
//      group sees the open page with the same close button.
const assert=require('node:assert/strict');
const {boot}=require('./helpers/local-dom-app');

(async()=>{
  const errors=[];const {page,browser}=await boot({errors,appAudit:'{openCompany}',viewport:{width:844,height:390}});
  try{
    page.setDefaultTimeout(120000);
    const settle=()=>page.waitForFunction(()=>!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked(),null,{timeout:120000});
    await page.evaluate(()=>{const s=__GH_STATE__;if(s.progression?.mode!=='career')s.progression=GH_PROGRESSION_CORE.initial('career-normal');s.speed=0;});
    await page.evaluate(async()=>{if(!(__GH_STATE__.openedCompanies||[]).includes('road'))await __AUDIT__.openCompany('road');});await settle();
    // A known position: level 3 at 40% of the way to 4, the founding and first-company milestones done, a known week.
    const setup=await page.evaluate(()=>{
      const s=__GH_STATE__,P=GH_PROGRESSION_CORE,p=s.progression;s.simSeconds=Math.max(Number(s.simSeconds)||0,10*86400+600);const today=Math.floor(s.simSeconds/86400);
      p.level=3;p.xp=P.XP[2]+Math.round((P.XP[3]-P.XP[2])*.4);p.milestones={'found-group':0,'first-company':0,'company:road':0};p.daily={day:today,actionXp:12,earnedXp:0};
      p.xpDays=[{day:today-5,xp:70,ops:40,decisions:30,milestones:0},{day:today-2,xp:56,ops:20,decisions:36,milestones:0},{day:today,xp:33,ops:0,decisions:18,milestones:15}];
      return {today,xp:p.xp,next:P.XP[3],rate:P.xpRate(s),multiplier:P.multiplier(s)};
    });
    assert.equal(setup.rate,(70+56)/5,'setup: the rate over the closed days since the first record (5 days, two with nothing)');
    const open=async arg=>{await page.evaluate(a=>__AUDIT__.openDrawer('progression',a),arg);await page.waitForFunction(tab=>document.querySelector(`#drawerBody .lv[data-levels-tab="${tab}"]`),arg.tab,{timeout:30000});};
    // 1.
    await open({tab:'progress'});
    const progress=await page.evaluate(()=>({level:document.querySelector('#drawerBody .lv-lvl>b').textContent.trim(),title:document.querySelector('#drawerBody .lv-lvl h3').textContent.trim(),filled:document.querySelectorAll('#drawerBody .lv-seg i.f').length,eta:document.querySelector('#drawerBody .lv-eta').textContent,full:document.getElementById('app').classList.contains('levels-open')}));
    assert.equal(progress.level,'3');assert.equal(progress.title,await page.evaluate(()=>GH_PROGRESSION_CORE.title(3)));assert.equal(progress.filled,4,'1: four of ten segments at 40%');
    const remaining=setup.next-setup.xp,days=Math.ceil(remaining/setup.rate);
    assert.match(progress.eta,new RegExp(days<=1?'يوم لعب واحد':days===2?'يومي لعب':days<=10?`${days} أيام لعب`:`${days} يوم لعب`),`1: the time at the player's rate (${remaining} ÷ ${setup.rate.toFixed(1)})`);
    assert.equal(progress.full,true,'1: full screen');
    // 2. The milestones in the order they come within reach (the founding and first company done).
    const order=[['first-facility','network'],['first-contract','contracts'],['first-trip','routes'],['first-tax','invoices'],['first-profit-day','monthlyFinance']];
    const steps=await page.evaluate(()=>[...document.querySelectorAll('#drawerBody .lv-step')].map(row=>({label:row.querySelector('.t b').textContent,xp:row.querySelector('.t span').textContent,go:row.querySelector('.lv-go').dataset.go})));
    const labels=await page.evaluate(()=>GH_PROGRESSION_CORE.MILESTONE_LABEL),expected=[];let covered=0;
    for(const [key,go] of order){const xp=Math.round(await page.evaluate(k=>GH_PROGRESSION_CORE.MILESTONES[k],key)*setup.multiplier);expected.push({label:labels[key],xp:`+${xp}`,go});covered+=xp;if(covered>=remaining||expected.length===3)break;}
    assert.deepEqual(steps,expected,'2: the fewest open milestones that cover what is left, in order, with their panels');
    assert.ok(!steps.some(step=>step.label===labels['first-company']),'2: a done milestone is not offered');
    await page.click('#drawerBody .lv-step .lv-go');await page.waitForFunction(go=>document.getElementById('drawer').dataset.panel===go,steps[0].go,{timeout:30000});
    // 3.
    await open({tab:'progress'});
    const today=await page.evaluate(()=>({big:document.querySelector('#drawerBody .lv-big').firstChild.textContent.trim(),legend:[...document.querySelectorAll('#drawerBody .lv-leg b')].map(b=>b.textContent),core:GH_PROGRESSION_CORE.xpToday(__GH_STATE__)}));
    assert.equal(today.big,String(today.core.xp),'3: today\'s experience');assert.deepEqual(today.legend,[String(today.core.ops),String(today.core.decisions),String(today.core.milestones)],'3: by source');
    await page.click('#drawerBody .lv-next');await page.waitForFunction(()=>document.querySelector('#drawerBody .lv[data-levels-tab="path"] .lv-d.sel')?.textContent==='4',null,{timeout:30000});
    // 4.
    const path=await page.evaluate(()=>({nodes:document.querySelectorAll('#drawerBody .lv-d').length,done:document.querySelectorAll('#drawerBody .lv-d.done').length,current:document.querySelector('#drawerBody .lv-d.cur').textContent,companies:document.querySelectorAll('#drawerBody .lv-d.co').length,expectedCompanies:new Set(Object.entries(GH_PROGRESSION_CORE.COMPANY).filter(([id])=>id!=='group').map(([,at])=>at)).size}));
    assert.equal(path.nodes,30);assert.equal(path.done,2,'4: levels 1 and 2 are done');assert.equal(path.current,'3');assert.equal(path.companies,path.expectedCompanies,'4: every level that opens a company is marked');
    const cash=await page.evaluate(()=>GH_FINANCE_CORE.investorMode(__GH_STATE__)?Infinity:Number(GH_FINANCE_CORE.operating(__GH_STATE__,'group'))||0);
    const levels=await page.evaluate(()=>Object.entries(GH_PROGRESSION_CORE.COMPANY).filter(([id,at])=>id!=='group'&&at>3&&!(__GH_STATE__.openedCompanies||[]).includes(id)).map(([id,at])=>({id,at,minimum:Number(GH_COMPANY_PLATFORM.getDefinition(id)?.founding?.minimumCapital)||0})).filter(row=>row.minimum>0));
    const covers=levels.find(row=>row.minimum<=cash),short=levels.find(row=>row.minimum>cash);
    for(const row of [covers,short].filter(Boolean)){await open({tab:'path',level:row.at});const ready=await page.evaluate(()=>{const el=document.querySelector('#drawerBody .lv-ready');return el?{ok:el.classList.contains('ok'),text:el.textContent}:null;});
      assert.ok(ready,`4: level ${row.at} (${row.id}) tells about its founding capital`);assert.equal(ready.ok,row.minimum<=cash,`4: ${row.id}: cash ${cash} against ${row.minimum}`);}
    assert.ok(covers||short,'4: at least one company level to check');
    await open({tab:'path',level:2});assert.ok(await page.evaluate(()=>[...document.querySelectorAll('#drawerBody .lv-dl')].some(row=>/مفتوح/.test(row.textContent))),'4: a level reached says so');
    // 5.
    await open({tab:'goals'});
    const goals=await page.evaluate(()=>({rows:[...document.querySelectorAll('#drawerBody .lv-m')].map(row=>({done:row.classList.contains('done'),label:row.querySelector('span:nth-child(2)').textContent,xp:row.querySelector('b').textContent})),caps:document.querySelectorAll('#drawerBody .lv-cr').length,licences:[...document.querySelectorAll('#drawerBody .lv-lr button[data-gh-action="progression-licence"]')].map(b=>({key:b.dataset.key,fee:Number(b.dataset.fee)}))}));
    const keys=await page.evaluate(()=>Object.keys(GH_PROGRESSION_CORE.MILESTONES).filter(key=>key!=='company'&&key!=='first-asset'));
    assert.equal(goals.rows.length,keys.length,'5: every milestone once');
    for(const [index,key] of keys.entries()){const row=goals.rows[index],done=['found-group','first-company'].includes(key);assert.equal(row.label,labels[key]);assert.equal(row.done,done,`5: ${key} done`);if(!done)assert.equal(row.xp,`+${Math.round(await page.evaluate(k=>GH_PROGRESSION_CORE.MILESTONES[k],key)*setup.multiplier)}`);}
    assert.ok(goals.caps>=1,'5: the logistics bands');
    assert.ok(goals.licences.length>0,'5: licences within reach');
    for(const row of goals.licences)assert.equal(row.fee,await page.evaluate(k=>GH_PROGRESSION_CORE.licenceQuote(__GH_STATE__,k).fee,row.key),`5: ${row.key} keeps its quoted fee`);
    // 6.
    for(const tab of ['progress','path','goals']){await open({tab});const styles=await page.evaluate(()=>[...document.querySelectorAll('#drawerBody .lv [style]')].map(el=>el.getAttribute('style')));for(const style of styles)assert.match(style,/^width:\d+(\.\d+)?%;?$/,`6: ${tab}: only width:% inline (${style})`);}
    await page.click('#drawerBody .lv-x');await page.waitForFunction(()=>!document.getElementById('drawer').classList.contains('open')&&!document.getElementById('app').classList.contains('levels-open'),null,{timeout:30000});
    // No rate before a day has closed.
    await page.evaluate(()=>{const p=__GH_STATE__.progression,today=Math.floor(__GH_STATE__.simSeconds/86400);p.xpDays=[{day:today,xp:9,ops:0,decisions:9,milestones:0}];});
    await open({tab:'progress'});assert.match(await page.evaluate(()=>document.querySelector('#drawerBody .lv-eta').textContent),/بعد إقفال أول يوم/,'1: no time before a day has closed');
    await page.evaluate(()=>{__GH_STATE__.progression={...GH_PROGRESSION_CORE.initial('sandbox')};});
    await open({tab:'open'}).catch(()=>{});await page.evaluate(()=>__AUDIT__.openDrawer('progression',{tab:'progress'}));await page.waitForFunction(()=>document.querySelector('#drawerBody .lv[data-levels-tab="open"] .lv-x'),null,{timeout:30000});
    assert.match(await page.evaluate(()=>document.querySelector('#drawerBody .lv-open h3').textContent),/اللعب الحر/,'6: free play sees the open page');
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({suite:'build649-levels-page-browser',ok:true,steps:steps.length,remaining,rate:setup.rate,licences:goals.licences.length}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
