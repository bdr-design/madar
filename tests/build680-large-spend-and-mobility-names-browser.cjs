'use strict';
// Build 680 (the owner: «حلها كلها», the two decisions the report left to him):
//   1. the old brand on the mobility company: its service classes («GH Go Electric»), centres («مركز GH Mobility ·
//      الرياض»), teams and documents. The company is «ANI MOBILITY» since the game was renamed: they carry that name,
//      and its pages no longer print «GH»;
//   2. one tap spent any amount with no question (a $110B purchase), while appointing a manager asks. A purchase or an
//      opening made by one tap asks first when it is large for what pays it: half or more of the cash that can pay it
//      (the paying company's, with the holding's behind it for an asset purchase or an opening; a mobility purchase is
//      one cheque of its own company), or a billion and more, with or without the investor licence. The amount asked
//      about is what the order charges now: the count at every facility for «العدد لكل منشأة», three months of a lease.
//      Declined, nothing is bought, opened or charged; accepted, it goes through as before; a routine spend still takes
//      one tap; a spend the cash does not cover is left to its own refusal; a hotel site, which has its own question,
//      is asked about once; the confirming button is held as an erasure's is.
const assert=require('node:assert/strict');
const {boot}=require('./helpers/local-dom-app');
(async()=>{
  const errors=[];const {page,browser}=await boot({errors,appAudit:'{openCompany,openBranch}',viewport:{width:844,height:390}});
  try{
    page.setDefaultTimeout(60000);
    const settle=()=>page.waitForFunction(()=>!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked(),null,{timeout:120000});
    const open=async(panel,arg)=>{await page.evaluate(([p,a])=>__AUDIT__.openDrawer(p,a),[panel,arg]);await page.waitForFunction(p=>document.getElementById('drawer').dataset.panel===p,panel);};
    const dialog=()=>page.evaluate(()=>{const accept=document.querySelector('[data-confirm="accept"]');if(!accept)return null;const box=accept.closest('dialog');return {title:document.getElementById('uiConfirmTitle')?.textContent.trim()||'',text:box.textContent.replace(/[⁦-⁩‎‏]/g,'').replace(/\s+/g,' '),accept:accept.textContent.trim()};});
    const noDialog=async label=>{await page.waitForTimeout(350);assert.equal(await dialog(),null,label);};
    const decline=async()=>{await page.locator('[data-confirm="cancel"]').click();await page.waitForFunction(()=>!document.querySelector('[data-confirm="accept"]'));await settle();};
    const accept=()=>page.locator('[data-confirm="accept"]').click();
    const cash=company=>page.evaluate(c=>GH_FINANCE_CORE.operating(__GH_STATE__,c),company),hubs=company=>page.evaluate(c=>(__GH_STATE__.customHubs||[]).filter(row=>(row.ownerCompanyId||row.company)===c).length,company);
    const move=async(from,to,amount)=>{if(amount>=1){await page.evaluate(([from,to,amount])=>__AUDIT__.runAuthorizedDomainCommand('finance','transfer',{from,to,amount,note:'cash to another company'}),[from,to,Math.floor(amount)]);await settle();}};
    const leaveHolding=async amount=>move('group','air',await cash('group')-amount);
    const site=async company=>{await open('groupHub');await open('network');await page.locator('#worldKind').selectOption(company);return page.locator(`#drawerBody .open-directory-site[data-company="${company}"]:not([disabled])`).first();};
    const short=amount=>`$${(amount/1000000).toFixed(1)}M`;
    await page.evaluate(()=>{__GH_STATE__.speed=0;window.__QA_HELD__=[];new MutationObserver(()=>{const accept=document.querySelector('[data-confirm="accept"]');if(accept&&!accept.dataset.qaSeen){accept.dataset.qaSeen='1';window.__QA_HELD__.push(accept.disabled);}}).observe(document.body,{childList:true,subtree:true});});
    for(const company of ['air','road','mobility','hospitality']){await page.evaluate(async c=>{await __AUDIT__.openCompany(c);},company);await settle();}

    // 2a. A routine opening takes one tap.
    assert.ok(await cash('group')>100000000,'2: the holding holds its capital');
    await (await site('road')).click();await page.waitForFunction(()=>(__GH_STATE__.customHubs||[]).some(row=>(row.ownerCompanyId||row.company)==='road'));await settle();await noDialog('2: an opening that is small for the group asks nothing');
    assert.equal(await hubs('road'),1);
    // 2b. The same opening when it is more than half of what can pay it.
    const price=Number(await (await site('road')).getAttribute('data-quote'));assert.ok(price>0,'2: the opening is priced');await leaveHolding(Math.max(0,Math.round(price*1.4-await cash('road'))));const roadCash=await cash('road'),groupCash=await cash('group'),second=await site('road');assert.ok(price<=roadCash+groupCash&&price>=(roadCash+groupCash)/2,'2: the opening now takes more than half of what can pay it');
    await second.click();await page.waitForSelector('[data-confirm="accept"]');const asked=await dialog();
    assert.equal(asked.title,'تأكيد إنفاق كبير','2: a large opening asks first');assert.ok(asked.text.includes(`المطلوب دفعه الآن${short(price)}`)||asked.text.includes(`المطلوب دفعه الآن: ${short(price)}`),`2: with what is charged now (${asked.text})`);assert.ok(asked.text.includes(short(roadCash+groupCash)),'2: and what can pay it');assert.match(asked.text,/فتح .+ · /,'2: and what is being opened');assert.match(asked.text,/هذه العملية تنفق نصف السيولة المتاحة أو أكثر\./);assert.equal(asked.accept,'تأكيد التنفيذ');
    assert.deepEqual(await page.evaluate(()=>window.__QA_HELD__),[true],'2: the confirming button is held when the question opens (a double tap does not confirm)');
    await decline();
    assert.deepEqual({hubs:await hubs('road'),road:await cash('road'),group:await cash('group')},{hubs:1,road:roadCash,group:groupCash},'2: declined, nothing is opened and nothing is charged');
    await (await site('road')).click();await page.waitForSelector('[data-confirm="accept"]');await accept();await page.waitForFunction(()=>(__GH_STATE__.customHubs||[]).filter(row=>(row.ownerCompanyId||row.company)==='road').length===2,null,{timeout:60000});await settle();
    assert.ok(await cash('road')+await cash('group')<roadCash+groupCash,'2: accepted, the centre is opened and paid for');
    // 2c. A spend the cash does not cover is left to its refusal.
    await move('road','air',await cash('road')-1000);await leaveHolding(1000);const poor=await site('road');assert.equal(await poor.count(),1,'2: the opening is still offered');const alertsBefore=await page.evaluate(()=>__GH_STATE__.alerts[0]);
    await poor.click();await page.waitForFunction(old=>__GH_STATE__.alerts[0]!==old||document.querySelector('#uiToasts .ui-toast'),alertsBefore,{timeout:15000});await settle();await noDialog('2: an opening the cash cannot pay is not asked about');
    assert.equal(await hubs('road'),2,'2: and it is refused as before');
    console.log('2 ok: a large opening asks first; a routine one takes one tap; one the cash cannot pay is refused as before');

    // 2d. A hotel site has its own question: it is asked about once.
    {const hotel=await site('hospitality'),quote=Number(await hotel.getAttribute('data-quote'));assert.ok(quote>0,'2: a hotel site is priced');await move('hospitality','air',await cash('hospitality')-1000);await move('air','group',quote*1.3);
      await hotel.click();await page.waitForSelector('[data-confirm="accept"]');const own=await dialog();assert.notEqual(own.title,'تأكيد إنفاق كبير','2: the hotel\'s own question is the one asked');await decline();await noDialog('2: and no second question follows');}
    console.log('2 ok: a hotel site is asked about once, by its own question');

    // 2e. The investor licence: a billion and more asks; less does not. The amount is the order's.
    await page.evaluate(()=>{__GH_STATE__.godMoney=true;__GH_STATE__.infiniteMoney=true;});
    const openAirport=async()=>{const bases=await page.evaluate(()=>(__GH_STATE__.globalBases||[]).length);await (await site('air')).click();await page.waitForFunction(n=>(__GH_STATE__.globalBases||[]).length===n+1,bases,{timeout:60000});await settle();};
    await openAirport();await noDialog('2: an airport opened under the licence for less than a billion asks nothing');
    const buy=async(quantity,{mode='cash',distribution='total'}={})=>{await open('groupHub');await open('assetMarket','air');await page.waitForSelector('#drawerBody .asset-market-card .manual-asset-qty');const card=page.locator('#drawerBody .asset-market-card').first();await card.locator('.manual-asset-qty').fill(String(quantity));await card.locator('.manual-asset-mode').selectOption(mode);await card.locator('.manual-asset-distribution').selectOption(distribution);const button=card.locator('[data-type][data-id]').first(),model=await button.evaluate(node=>{window.__QA_BUY__=node;return {id:node.dataset.id,type:node.dataset.type};});await button.click();return model;};
    const fleet=()=>page.evaluate(()=>GH_FLEET_DATA.size(__GH_STATE__));
    const model=await buy(1);await page.waitForFunction(()=>GH_FLEET_DATA.size(__GH_STATE__)===1,null,{timeout:60000});await settle();await noDialog('2: one aircraft under the licence asks nothing');
    const item=await page.evaluate(([type,id])=>{const list=GH_ASSET_CATALOG[type],row=[...list.new,...list.used].find(row=>row.id===id);return {price:Number(row.price),lease:Number(row.leaseMonthly)};},[model.type,model.id]),unit=item.price;assert.ok(unit>0&&unit<1000000000&&item.lease>0,`2: the model's price and lease (${model.id}: ${unit}, ${item.lease})`);
    const many=Math.ceil(1000000000/unit);await buy(many);await page.waitForSelector('[data-confirm="accept"]');const investor=await dialog();
    assert.equal(investor.title,'تأكيد إنفاق كبير','2: a billion and more under the licence asks first');assert.match(investor.text,/التمويل:? ?بطاقة المستثمر/);assert.match(investor.text,/عملية بمليار دولار أو أكثر تُراجع قبل تنفيذها\./);
    await decline();assert.equal(await fleet(),1,'2: declined, nothing is bought');
    assert.deepEqual(await page.evaluate(()=>{const node=window.__QA_BUY__;return {onPage:node.isConnected,disabled:node.disabled,busy:node.dataset.busy||null,label:node.textContent.trim()};}),{onPage:true,disabled:false,busy:null,label:'شراء وتسليم الآن'},'2: and the very button that was tapped is free again');
    if(many>2){await buy(many-1);await page.waitForFunction(n=>GH_FLEET_DATA.size(__GH_STATE__)===n,many,{timeout:120000});await settle();await noDialog('2: just under a billion asks nothing');}
    const held=await fleet();await buy(many);await page.waitForSelector('[data-confirm="accept"]');await accept();await page.waitForFunction(n=>GH_FLEET_DATA.size(__GH_STATE__)===n,held+many,{timeout:120000});await settle();
    // «العدد لكل منشأة»: the count is at every airport of the company. Half a billion each at two airports is a billion.
    await openAirport();const airports=await page.evaluate(()=>(__GH_STATE__.globalBases||[]).length);assert.ok(airports>=2,'2: two airports');const each=Math.ceil(1000000000/unit/airports);assert.ok(each*unit<1000000000,'2: one airport\'s share is under a billion');
    await buy(each,{distribution:'per-facility'});await page.waitForSelector('[data-confirm="accept"]');const spread=await dialog();
    assert.ok(spread.text.includes(await page.evaluate(([each,airports])=>`(${each.toLocaleString('en-US')} لكل منشأة في ${GH_ARABIC_COPY.count(airports,'facility',{oblique:true})})`,[each,airports])),`2: the question counts every airport (${spread.text})`);await decline();
    // A lease is charged three months at once.
    const leased=Math.ceil(1000000000/(item.lease*3));assert.ok(leased*item.lease<1000000000,'2: one month of the lease is under a billion');await buy(leased,{mode:'lease'});await page.waitForSelector('[data-confirm="accept"]');assert.match((await dialog()).text,/استئجار /,'2: a lease whose three months reach a billion asks');await decline();
    assert.equal(await fleet(),held+many,'2: declined, nothing is bought');
    console.log(`2 ok: under the licence ${many} aircraft (a billion and more) ask first and are bought once accepted; fewer do not ask; every airport and a lease's three months are counted`);

    // 2f. The mobility market asks by its company's own cash: the holding's is not behind its cheque.
    await page.evaluate(()=>{__GH_STATE__.godMoney=false;__GH_STATE__.infiniteMoney=false;});
    await move('air','group',20000000);await (await site('mobility')).click();await page.waitForFunction(()=>(__GH_STATE__.customHubs||[]).some(row=>row.kind==='mobility-center'),null,{timeout:60000});await settle();
    const centre=await page.evaluate(()=>__GH_STATE__.customHubs.find(row=>row.kind==='mobility-center').name);assert.match(centre,/^مركز ANI Mobility · /,'1: a centre carries the company\'s name');
    await open('groupHub');await open('assetMarket','mobility');await page.waitForSelector('#drawerBody .mobility-market-card');const classes=await page.evaluate(()=>[...document.querySelectorAll('#drawerBody .mobility-market-card h3')].map(node=>node.textContent.replace(/[^\x20-\x7E]/g,'').trim()));
    assert.deepEqual(classes,['ANI Go Electric','ANI Comfort','ANI Black','ANI Access'],'1: the service classes carry the company\'s name');
    const cost=await page.evaluate(()=>Number(GH_MOBILITY_CORE.CLASSES[0].cost));assert.ok(cost>0,'2: a car is priced');
    {const own=await cash('mobility');assert.ok(own>cost*4,'2: the mobility company holds its capital');await move('mobility','air',own-cost*3.5);}assert.ok(await cash('group')>cost*100,'2: the holding holds far more than the cars cost');
    const cars=()=>page.evaluate(()=>(__GH_STATE__.mobility?.vehicles||[]).length),buyCars=async quantity=>{await open('groupHub');await open('assetMarket','mobility');await page.waitForSelector('#drawerBody .mobility-market-card');await page.locator('#drawerBody .mobility-market-card .mobility-purchase-qty').first().fill(String(quantity));await page.locator('#drawerBody .mobility-market-card .manual-buy-mobility').first().click();};
    await buyCars(1);await page.waitForFunction(()=>(__GH_STATE__.mobility?.vehicles||[]).length===1,null,{timeout:60000});await settle();await noDialog('2: one car of three and a half asks nothing');
    await buyCars(2);await page.waitForSelector('[data-confirm="accept"]');const carsAsked=await dialog();assert.equal(carsAsked.title,'تأكيد إنفاق كبير','2: two cars that take most of their company\'s cash ask first, whatever the holding holds');assert.match(carsAsked.text,/المتاح للدفع:? ?\$[\d.]+K/,`2: against the mobility company's own cash, not the holding's millions (${carsAsked.text})`);await decline();assert.equal(await cars(),1,'2: declined, no car is bought');
    await buyCars(2);await page.waitForSelector('[data-confirm="accept"]');await accept();await page.waitForFunction(()=>(__GH_STATE__.mobility?.vehicles||[]).length===3,null,{timeout:60000});await settle();
    console.log('2 ok: the mobility market asks by its own company\'s cash');

    // 2g. A regional headquarters is asked about by what its construction charges (the winning bid, not the list price).
    {await move('air','group',Math.max(0,52000000-await cash('group')));await leaveHolding(52000000);const before=await cash('group');assert.ok(Math.abs(before-52000000)<2,'2: the holding holds 52M');
      await page.evaluate(()=>{window.__QA_HQ__=__AUDIT__.openBranch('EX-SHA');});await page.waitForSelector('[data-confirm="accept"]');const hq=await dialog();assert.equal(hq.title,'تأكيد إنفاق كبير','2: a headquarters that takes most of the holding\'s cash asks first');
      await accept();await page.waitForFunction(()=>(__GH_STATE__.branches||[]).includes('EX-SHA'),null,{timeout:60000});await settle();const charged=before-await cash('group');
      assert.ok(charged>35000000,`2: the construction charges more than the list price (${charged})`);assert.ok(hq.text.includes(short(charged)),`2: and the question named that amount (${short(charged)}; ${hq.text})`);}
    console.log('2 ok: a regional headquarters is asked about by its construction\'s amount');

    // 1. The mobility company's names.
    const names=await page.evaluate(()=>({vehicles:__GH_STATE__.mobility.vehicles.map(row=>row.name),teams:JSON.stringify(__GH_STATE__.advanced.labor).match(/فريق سائقي [A-Za-z]+ Mobility/g)||[],old:JSON.stringify([__GH_STATE__.finance.transfers,__GH_STATE__.finance.invoices,__GH_STATE__.finance.journalEntries,__GH_STATE__.advanced.labor,__GH_STATE__.mobility]).match(/GH (?:Mobility|Go Electric|Comfort|Black|Access)/g)||[]}));
    assert.ok(names.vehicles.every(name=>/^ANI Go Electric · /.test(name)),`1: the cars carry the class's name (${names.vehicles[0]})`);assert.ok(names.teams.length>0&&names.teams.every(name=>name==='فريق سائقي ANI Mobility'),`1: the drivers' team carries the company's name (${names.teams[0]})`);assert.deepEqual(names.old,[],'1: no document, team or car of the purchase carries the old brand');
    for(const [panel,arg] of [['assetMarket','mobility'],['assets','mobility'],['network',undefined],['company','mobility'],['labor',undefined]]){await open('groupHub');await page.evaluate(([p,a])=>__AUDIT__.openDrawer(p,a),[panel,arg]);await page.waitForFunction(()=>document.getElementById('drawer').dataset.panel!=='groupHub',null,{timeout:10000});await page.waitForTimeout(300);const old=await page.evaluate(()=>(document.getElementById('drawer').innerText.match(/GH (?:Mobility|Go Electric|Comfort|Black|Access)/g)||[]));assert.deepEqual(old,[],`1: the ${panel} page prints no old brand`);}
    console.log('1 ok: the mobility company\'s classes, centres, cars, teams and documents carry «ANI Mobility»');
    assert.deepEqual(errors,[],'no page error');
    console.log('BUILD680_LARGE_SPEND_AND_MOBILITY_NAMES_BROWSER_PASS');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
