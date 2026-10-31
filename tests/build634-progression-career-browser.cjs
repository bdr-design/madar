'use strict';
// Owner (approved design «فنتورا: تصميم المستويات وتجهيز الإطلاق»): in the real app, a group founded from the founding
// screen with its default choice (the career at normal difficulty):
//  1. starts at level 1 with 250 million dollars and its founding milestone; its progression root is saved, validated and
//     comes back after a reload;
//  2. a company above its level is refused before any contract or transfer (aviation, level 3); the logistics company
//     opens and its milestones lift the group to level 3 at once (the approved table: level 3 on day 0); a tool above the
//     level (the IPO, level 15) is refused by the command gate itself; level 3 brings the aviation expansion grant;
//  3. a model above the level (Tesla Semi, level 4) and a count past the fleet band are refused with nothing bought or
//     paid, the band itself is bought; facilities stop at their band;
//  4. an early licence (the marine company, level 5, two levels ahead) is one signed command: the group pays the approved
//     fee by a documented expense, the licence is recorded, the company opens, and a second licence is refused;
//  5. (owner, approved pricing) investor mode is unlimited money only: the levels stay (media, level 6, is refused with
//     its level) and the experience keeps counting; turned off, the limits are as they were
//     (telecom, level 8, is refused);
//  6. the level tile beside the cash shows the level and opens the levels page; the page shows the level, the early
//     licences within reach and the table; a day's close is counted once (lastClosedDay) and the level never goes down;
//     the tile follows the level by itself, with no refresh asked of it (owner: «متأكد ان المستوى يتحدث اول بأول؟»):
//     after the decisions above, and while the game plays when experience is added as the day's close adds it;
//  7. a group founded in free play has no limits and no level tile.
const assert=require('node:assert/strict');
const {boot,reboot}=require('./helpers/local-dom-app');
const {drawFounderSignature}=require('./helpers/signature-input');
const AUDIT='{openCompany,toggleInvestorMode,openingBlocker}';
const settle=page=>page.waitForFunction(()=>!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked(),null,{timeout:120000});
async function found(page){
  await page.click('#founderReview');await drawFounderSignature(page);await page.locator('#founderForm button[type=submit]').click();
  await page.waitForFunction(()=>window.__GH_STATE__?.onboardingComplete&&!window.__GH_DURABLE_COMMAND_CONTEXT__&&!document.getElementById('app')?.hasAttribute('inert'),null,{timeout:120000});
  if(await page.evaluate(()=>__GH_STATE__.speed>0))await page.click('#speedToggle');
}
// A logistics centre in a capital (the operating-world fixture's own payload), built in the page from the capital's record.
const createFacility=(page,id,city)=>page.evaluate(async([id,city])=>{const cap=GH_MOBILITY_CORE.capitalMeta(city);let failure=null;
  try{await __AUDIT__.runAuthorizedDomainCommand('facilities','create',{facility:{id,ownerCompanyId:'road',company:'road',kind:'logistics',owned:true,capitalId:city,sourceKey:'site:road:'+city,city:cap.city,country:cap.country,coords:[...cap.coords],name:'QA '+id,deliveryCapacity:1000000,dailyCost:0},bucket:'customHubs'},{silent:true});}catch(e){failure=String(e.message||e);}
  return {failure,held:GH_PROGRESSION_CORE.heldFacilities(__GH_STATE__,'road'),limit:GH_PROGRESSION_CORE.bandLimit(__GH_STATE__,'road','facility')};},[id,city]);
const command=(page,domain,name,payload)=>page.evaluate(async([domain,name,payload])=>{try{return {ok:true,result:await __AUDIT__.runAuthorizedDomainCommand(domain,name,payload,{silent:true})};}catch(e){return {ok:false,message:String(e.message||e)};}},[domain,name,payload]);
(async()=>{
  const errors=[];let {page,browser}=await boot({found:false,errors,appAudit:AUDIT});
  try{
    page.setDefaultTimeout(120000);
    assert.equal(await page.inputValue('#founderMode'),'career-normal','the career at normal difficulty is the default');
    await found(page);
    // 1.
    const founded=await page.evaluate(()=>({p:JSON.parse(JSON.stringify(__GH_STATE__.progression)),cash:GH_FINANCE_CORE.operating(__GH_STATE__,'group'),schema:GH_SAVE_SCHEMA.validate(__GH_STATE__).errors.filter(e=>/progression/.test(e))}));
    assert.equal(founded.p.mode,'career');assert.equal(founded.p.difficulty,'normal');assert.equal(founded.p.level,1);assert.equal(founded.p.xp,50,'1: the founding milestone');
    assert.equal(founded.cash,250000000,'1: the normal career founds with 250 million');assert.deepEqual(founded.schema,[]);
    // 2.
    const snapshot=()=>page.evaluate(()=>({opened:[...__GH_STATE__.openedCompanies],cash:GH_FINANCE_CORE.operating(__GH_STATE__,'group'),contracts:Object.keys(__GH_STATE__.companyRegistry||{}).length}));
    const before=await snapshot();
    assert.match(await page.evaluate(()=>__AUDIT__.openingBlocker('air')),/المستوى 3 · أنت في المستوى 1/);
    assert.equal(await page.evaluate(()=>__AUDIT__.openCompany('air')),false,'2: the aviation company is refused at level 1');await settle(page);
    assert.deepEqual(await snapshot(),before,'2: nothing opened, paid or contracted');
    assert.equal(await page.evaluate(()=>__AUDIT__.openCompany('road')),true,'2: the logistics company opens at level 1');await settle(page);
    const lifted=await page.evaluate(()=>JSON.parse(JSON.stringify(__GH_STATE__.progression)));
    assert.ok(lifted.milestones['first-company']!==undefined&&lifted.milestones['company:road']!==undefined,'2: the opening milestones');assert.ok(lifted.xp>=303,`2: experience ${lifted.xp}`);assert.equal(lifted.level,3,'2: level 3 on day 0');
    const grant=await page.evaluate(()=>({record:__GH_STATE__.progression.grants?.air,transfer:(__GH_STATE__.finance.transfers||[]).find(row=>row.reference==='GRANT-AIR')}));
    assert.equal(grant.record?.amount,6250000,'2: level 3 brings the aviation expansion grant (25% of 25 million)');assert.equal(grant.transfer?.kind,'founder-investment','2: a documented founder investment');assert.equal(grant.transfer.amount,6250000);
    const ipo=await command(page,'corporate','set-ipo',{company:'group',enabled:true});assert.equal(ipo.ok,false);assert.match(ipo.message,/يُفتح في المستوى 15/,'2: the IPO is refused by the command gate');
    // 3.
    const first=await createFacility(page,'QA-L-ROAD-1','RUH');assert.equal(first.failure,null,`3: the first facility (${first.failure})`);await settle(page);
    let index=2;const cities=['AUH','DOH','KWI','MCT','BAH','AMM','CAI'];let last=first;
    while(last.held<last.limit&&index<9){last=await createFacility(page,`QA-L-ROAD-${index}`,cities[index-2]);assert.equal(last.failure,null,`3: facility ${index} within the band`);index++;await settle(page);}
    const over=await createFacility(page,`QA-L-ROAD-${index}`,cities[index-2]);assert.equal(over.held,last.held,'3: a facility past the band is not created');assert.match(String(over.failure),/سقف شركة اللوجستيات في مستواك/);await settle(page);
    const buy=await page.evaluate(async()=>{const P=GH_PROGRESSION_CORE,cash=()=>GH_FINANCE_CORE.operating(__GH_STATE__,'road')+GH_FINANCE_CORE.operating(__GH_STATE__,'group'),size=()=>GH_FLEET_DATA.size(__GH_STATE__),out={limit:P.bandLimit(__GH_STATE__,'road','road')};
      const attempt=async(tab,id,qty)=>{const options={},c0=cash(),s0=size();const r=await __AUDIT__.buyAsset('road',tab,id,'cash',qty,'QA-L-ROAD-1',true,null,'road',options);return {ok:!!r,message:options.errorMessage||null,paid:Math.round(c0-cash()),added:size()-s0};};
      out.semi=await attempt('new','T-TSEMI',1);out.over=await attempt('used','UT-ACTROS',out.limit+1);out.band=await attempt('used','UT-ACTROS',out.limit);out.more=await attempt('used','UT-ACTROS',1);return out;});
    assert.equal(buy.semi.ok,false);assert.match(buy.semi.message,/يُفتح في المستوى 4/);assert.equal(buy.semi.paid,0);assert.equal(buy.semi.added,0,'3: a model above the level buys nothing');
    assert.equal(buy.over.ok,false);assert.match(buy.over.message,new RegExp(`المتاح الآن ${buy.limit} من ${buy.limit+1}`));assert.equal(buy.over.paid,0);assert.equal(buy.over.added,0,'3: a count past the band buys nothing');
    assert.equal(buy.band.ok,true,`3: the band is bought (${buy.band.message})`);assert.equal(buy.band.added,buy.limit);assert.ok(buy.band.paid>0);
    assert.equal(buy.more.ok,false,'3: one more is past the band');assert.equal(buy.more.added,0);await settle(page);
    // 4.
    const licence=await page.evaluate(async()=>{const P=GH_PROGRESSION_CORE,quote=P.licenceQuote(__GH_STATE__,'company:sea'),cash0=GH_FINANCE_CORE.operating(__GH_STATE__,'group');let failure=null;
      try{await __AUDIT__.runAuthorizedDomainCommand('progression','early-licence',{key:quote.key,fee:quote.fee},{silent:true});}catch(e){failure=String(e.message||e);}
      const record=__GH_STATE__.progression.licences['company:sea'],doc=(__GH_STATE__.finance.invoices||[]).find(row=>row.number===record?.document);
      return {quote,failure,paid:Math.round(cash0-GH_FINANCE_CORE.operating(__GH_STATE__,'group')),record:record?{...record}:null,doc:doc?{kind:doc.kind,amount:doc.amount,note:doc.note,company:doc.company}:null};});
    assert.equal(licence.failure,null,`4: the licence command (${licence.failure})`);assert.equal(licence.quote.ahead,2);assert.equal(licence.quote.fee,30000000*0.2*2,'4: 20% of the marine minimum capital per level ahead');
    assert.equal(licence.paid,licence.quote.fee,'4: the group pays the fee');assert.ok(licence.doc,'4: a documented expense');assert.equal(licence.doc.company,'group');assert.match(licence.doc.note,/رسوم ترخيص مبكر/);
    await settle(page);assert.equal(await page.evaluate(()=>__AUDIT__.openCompany('sea')),true,'4: the licensed company opens');await settle(page);
    const again=await command(page,'progression','early-licence',{key:'company:sea',fee:licence.quote.fee});assert.equal(again.ok,false,'4: no second licence or charge');
    // 5.
    await page.evaluate(()=>__AUDIT__.toggleInvestorMode());await settle(page);
    const investing=await page.evaluate(()=>({on:GH_FINANCE_CORE.investorMode(__GH_STATE__),active:GH_PROGRESSION_CORE.active(__GH_STATE__),blocker:__AUDIT__.openingBlocker('media'),xp:__GH_STATE__.progression.xp}));
    assert.equal(investing.on,true);assert.equal(investing.active,true,'5: investor mode keeps the levels');assert.match(investing.blocker,/المستوى 6/,'5: media stays at its level in investor mode');
    assert.equal(await page.evaluate(()=>__AUDIT__.openCompany('media')),false,'5: media does not open in investor mode');await settle(page);
    assert.ok(await page.evaluate(xp=>{GH_PROGRESSION_CORE.onCommand(__GH_STATE__,'finance','transfer',{});return __GH_STATE__.progression.xp>xp;},investing.xp),'5: the experience keeps counting in investor mode');
    await page.evaluate(()=>__AUDIT__.toggleInvestorMode());await settle(page);
    const after=await page.evaluate(()=>({active:GH_PROGRESSION_CORE.active(__GH_STATE__),media:__GH_STATE__.openedCompanies.includes('media'),blocker:__AUDIT__.openingBlocker('telecom')}));
    assert.equal(after.active,true);assert.equal(after.media,false,'5: nothing opened early');assert.match(after.blocker,/المستوى 8/,'5: the limits are as they were');
    // 6.
    // The tile is read as the game drew it: no updateKpis() is called by the test.
    const readTile=()=>page.evaluate(()=>{const t=document.getElementById('levelKpi');return {hidden:t.hidden,value:document.getElementById('levelKpiValue').textContent,level:__GH_STATE__.progression.level};});
    await page.waitForFunction(()=>document.getElementById('levelKpiValue')?.textContent===String(__GH_STATE__.progression.level),null,{timeout:5000}).catch(()=>{});
    const tile=await readTile();
    assert.equal(tile.hidden,false,'6: the level tile shows in a career');assert.equal(tile.value,String(tile.level),'6: the tile follows the decisions by itself');
    // The approved levels page (three tabs): the level on the progress tab, all 30 levels on the path, the early licences
    // within reach on the goals tab.
    await page.click('#levelKpi');await page.waitForFunction(()=>document.querySelector('#drawerBody .lv-hero'),null,{timeout:30000});
    const head=await page.evaluate(()=>({level:document.querySelector('#drawerBody .lv-lvl>b').textContent.trim(),title:document.querySelector('#drawerBody .lv-lvl h3').textContent.trim(),state:__GH_STATE__.progression.level,expected:GH_PROGRESSION_CORE.title(__GH_STATE__.progression.level)}));
    assert.equal(head.level,String(head.state),'6: the page shows the level');assert.equal(head.title,head.expected);
    await page.click('#drawerBody .lv-dock button[data-go-arg*="path"]');await page.waitForFunction(()=>document.querySelector('#drawerBody .lv[data-levels-tab="path"]'),null,{timeout:30000});
    assert.equal(await page.evaluate(()=>document.querySelectorAll('#drawerBody .lv-d').length),30,'6: the whole table');
    await page.click('#drawerBody .lv-dock button[data-go-arg*="goals"]');await page.waitForFunction(()=>document.querySelector('#drawerBody .lv[data-levels-tab="goals"]'),null,{timeout:30000});
    assert.ok(await page.evaluate(()=>document.querySelectorAll('#drawerBody .lv-lr button[data-gh-action="progression-licence"]').length)>0,'6: early licences within reach');
    // Full screen like the store: its close button returns to the game (the top bar is under it while it is open).
    assert.equal(await page.evaluate(()=>document.getElementById('app').classList.contains('levels-open')),true,'6: the levels page is full screen');
    await page.click('#drawerBody .lv-x');await page.waitForFunction(()=>!document.getElementById('drawer').classList.contains('open')&&!document.getElementById('app').classList.contains('levels-open'),null,{timeout:30000});
    const day=await page.evaluate(async()=>{const e=__AUDIT__.simulationEngine,s=__GH_STATE__,xp=s.progression.xp,level=s.progression.level,target=(Math.floor(s.simSeconds/86400)+1)*86400+3600;e.advanceTo(target,{reason:'b634',maxSeconds:3*86400});const until=performance.now()+300000;while((e.snapshot().manualAdvance||GH_TRANSACTION_CORE.isStaged(s))&&performance.now()<until)await new Promise(r=>setTimeout(r,20));return {xp,level,after:s.progression.xp,levelAfter:s.progression.level,closed:s.progression.lastClosedDay,day:s.lastFinancialDay};});
    assert.equal(day.closed,day.day,'6: the day close was counted');assert.ok(day.after>=day.xp&&day.levelAfter>=day.level,'6: experience and level never go down');
    // Experience added while the game plays, as the day's close adds it (GH_PROGRESSION_CORE.addXp, 'day'): the next
    // level's threshold reached; the tile shows it by itself within 5 s.
    await settle(page);await page.click('[data-speed="1"]');
    const next=await page.evaluate(()=>{const s=__GH_STATE__,p=s.progression,need=GH_PROGRESSION_CORE.XP?.[p.level]??null;if(need===null)return null;GH_PROGRESSION_CORE.addXp(s,Math.ceil((need-p.xp)/(GH_PROGRESSION_CORE.multiplier?.(s)||1))+1,'day');return p.level;});
    assert.ok(next>tile.level,`6: the experience reaches the next level (${next})`);
    await page.waitForFunction(level=>document.getElementById('levelKpiValue')?.textContent===String(level),next,{timeout:5000}).catch(()=>{});
    assert.equal((await readTile()).value,String(next),'6: the tile follows experience gained while playing by itself');
    await page.click('#speedToggle');await settle(page);
    // 1. (after a reload)
    await settle(page);const saved=await page.evaluate(()=>JSON.stringify(__GH_STATE__.progression));await page.evaluate(()=>__AUDIT__.save?.());await settle(page);
    ({page}=await reboot(page,{errors,appAudit:AUDIT}));page.setDefaultTimeout(120000);
    assert.equal(await page.evaluate(()=>JSON.stringify(__GH_STATE__.progression)),saved,'1: the progression root comes back after a reload');
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
  // 7.
  const free=await boot({errors,appAudit:AUDIT});
  try{free.page.setDefaultTimeout(120000);
    assert.equal(await free.page.evaluate(()=>__GH_STATE__.progression?.mode),'free','7: the free-play founding');
    assert.equal(await free.page.evaluate(()=>document.getElementById('levelKpi').hidden),true,'7: no level tile in free play');
    assert.equal(await free.page.evaluate(()=>__AUDIT__.openCompany('air')),true,'7: free play opens the aviation company at once');
    assert.deepEqual(errors,[]);
  }finally{await free.browser.close();}
  console.log(JSON.stringify({suite:'build634-progression-career-browser',ok:true}));
})().catch(error=>{console.error(error);process.exitCode=1;});
