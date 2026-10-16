'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{chromium,webkit}=require('playwright');
const {bootAtOrigin,installVault}=require('./helpers/differential-vault-fixture.cjs');
const out=process.env.GH_CONSTRUCTION_ARTIFACTS||null,results=[];
(async()=>{for(const engine of [chromium,webkit]){
 const browser=await engine.launch({headless:true}),errors=[],dialogs=[];let closeOrigin=null;
 try{
  const started=await bootAtOrigin({browser:{newPage:options=>browser.newPage({...options,hasTouch:true})},errors,viewport:{width:956,height:440}});closeOrigin=started.closeOrigin;const {page}=started;page.setDefaultTimeout(60000);
  page.on('dialog',async d=>{dialogs.push(d.message());await d.dismiss();});
  const fixture=await page.evaluate(async()=>{
   const a=__AUDIT__,get=()=>__GH_STATE__;get().godMoney=true;get().infiniteMoney=true;
   for(const type of ['power','realestate'])await a.runAuthorizedDomainCommand('corporate','open-company',{type,capital:400000000,legalName:`QA ${type}`},{silent:true});
   const awarded=await a.runAuthorizedDomainCommand('procurement','award-construction',{company:'power',facilityKind:'power',siteName:'QA Solar',bid:{supplier:{id:'QA-380',legalName:'مقاول الطاقة'},quote:82000000,score:90}},{silent:true}),contractId=awarded.result.id;
   Object.assign(get().constructionContracts.find(c=>c.id===contractId),{leadDays:4,capacityKey:'solarMW',capacityAmount:100,energyKind:'solar',commissioned:false});
   get().customHubs.push({id:'QA-380-POWER',name:'QA Solar',kind:'power',ownerCompanyId:'power',owned:true,city:'الرياض',country:'السعودية',energyKind:'solar',capacityAmount:100,capacity:'100 MW',cost:82000000,commissioned:false,dailyCost:0,plannedDailyCost:12000,constructionContractId:contractId},{id:'QA-380-RE',name:'QA Real Estate Office',kind:'realestate',ownerCompanyId:'realestate',owned:true,city:'الرياض',country:'السعودية',dailyCost:1800});
   GH_ENERGY_CORE.ensure(get());const officeId=GH_REALESTATE_CORE.ensure(get()).offices[0].id,started=await a.runAuthorizedDomainCommand('realestate','start-project',{officeId,type:'residential',size:1,priceLevel:1,mode:'sale'},{silent:true}),projectId=started.result.id;
   const project=get().realEstate.projects.find(p=>p.id===projectId);project.completeDay=4;delete project.risk;
   return {contractId,projectId};
  });
  const balance=company=>page.evaluate(c=>({balance:GH_FINANCE_CORE.operating(__GH_STATE__,c),cheques:__GH_STATE__.finance.cheques.length,saveRevision:__GH_STATE__.saveRevision}),company);
  for(const [panel,id,company]of [['energy','energy-accelerate-construction','power'],['realestate','realestate-accelerate-construction','realestate']]){
   await page.evaluate(panel=>__AUDIT__.openDrawer(panel,{tab:'projects'}),panel);const button=page.locator(`[data-gh-action="${id}"]`).first();assert.equal(await button.count(),1,'newly built facilities show acceleration before first day refresh');
   for(const size of [{width:568,height:320},{width:440,height:956},{width:956,height:440}]){await page.setViewportSize(size);await button.scrollIntoViewIfNeeded();const b=await button.boundingBox();assert.ok(b&&b.x>=0&&b.y>=0&&b.x+b.width<=size.width+1&&b.y+b.height<=size.height+1,`acceleration button fits ${size.width}x${size.height}`);}
   if(out&&engine===chromium){fs.mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,`${panel}-before.png`)});}
   const fee=Number(await button.getAttribute('data-fee')),before=await balance(company);
   await button.tap();await page.locator('.ui-confirm[open]').waitFor();
   const frames=await page.evaluate(()=>new Promise(resolve=>{let count=0;const next=()=>{if(++count===4)resolve(count);else requestAnimationFrame(next);};requestAnimationFrame(next);}));assert.equal(frames,4,'confirmation must let the host render');
   await page.locator('.ui-confirm [data-confirm="cancel"]').tap();assert.deepEqual(await balance(company),before,'cancel has no financial or save effect');
   await button.tap();await page.locator('.ui-confirm [data-confirm="accept"]').tap();await page.waitForFunction(({energy,fixture})=>{const st=__GH_STATE__,row=energy?st.constructionContracts.find(c=>c.id===fixture.contractId):st.realEstate.projects.find(p=>p.id===fixture.projectId);return !!row?.constructionAcceleration&&!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked();},{energy:panel==='energy',fixture});
   const after=await balance(company);assert.ok(Math.abs(before.balance-after.balance-fee)<.02,'actual company current account is debited');assert.equal(after.cheques,before.cheques+1);assert.equal(await page.locator(`[data-gh-action="${id}"]`).count(),0,'one-time acceleration cannot be bought twice');
   if(panel==='realestate')assert.ok(await page.locator('[data-gh-action="realestate-set-price"]').count(),'existing price control is preserved');
   assert.equal(after.saveRevision,before.saveRevision+1,'acceleration commits once; reopening its view must not save again');
   const instant=await page.evaluate(({energy,fixture})=>{const st=__GH_STATE__,row=energy?st.constructionContracts.find(c=>c.id===fixture.contractId):st.realEstate.projects.find(p=>p.id===fixture.projectId),a=row.constructionAcceleration;return {day:Math.floor(st.simSeconds/86400),originalCompleteDay:a.originalCompleteDay,completeDay:a.completeDay,finished:energy?row.commissioned===true:row.status==='مكتمل',progress:energy?GH_ENERGY_CORE.constructionProgress(row,0):GH_REALESTATE_CORE.projectProgress(row,0)};},{energy:panel==='energy',fixture});
   assert.equal(instant.day,0);assert.equal(instant.originalCompleteDay,4);assert.equal(instant.completeDay,2);assert.equal(instant.finished,false);assert.equal(instant.progress,0,'payment does not fabricate completed work');
   results.push({engine:engine.name(),panel,fee,debited:before.balance-after.balance,saveRevisionDelta:after.saveRevision-before.saveRevision,instant});
  }
  // The full app's day close must carry both owners' revenues into finance, after the shortened construction.
  await page.evaluate(()=>__AUDIT__.closeDrawer());await page.evaluate(()=>GH_PERSISTENCE.drain());
  const request=await page.evaluate(()=>__AUDIT__.simulationEngine.advanceTo(2*86400+1,{reason:'qa-construction-income'}));assert.equal(request.accepted,true,JSON.stringify(request));await page.waitForFunction(()=>!__AUDIT__.simulationEngine.snapshot().manualAdvance,null,{timeout:90000});
  const revenue=await page.evaluate(({contractId,projectId})=>{
   const st=__GH_STATE__,F=GH_FINANCE_CORE,day=st.lastFinancialDay,power=st.energy.dailyHistory.find(r=>r.day===day),property=st.realEstate.dailyHistory.find(r=>r.day===day),invoices=st.finance.invoices.filter(i=>i.kind==='دخل'&&i.sourceRef===`OPER-COLLECT-${i.company}-${day}`);
   return {day,fatal:__AUDIT__.simulationEngine.snapshot().fatalError||null,powerRevenue:power?.powerRevenue,propertyRevenue:property?.revenue,powerCommissioned:st.constructionContracts.find(c=>c.id===contractId)?.commissioned,propertyComplete:st.realEstate.projects.find(p=>p.id===projectId)?.status,allRevenueInvoices:st.finance.invoices.filter(i=>i.kind==='دخل').slice(0,8).map(i=>({company:i.company,sourceRef:i.sourceRef,at:i.at,note:i.note,amount:i.amount})),powerInvoice:invoices.filter(i=>i.company==='power').map(i=>({amount:i.amount,proof:GH_DOCUMENT_PROOF.verifyDocument(st,i).ok})),propertyInvoices:invoices.filter(i=>i.company==='realestate').map(i=>({amount:i.amount,proof:GH_DOCUMENT_PROOF.verifyDocument(st,i).ok})),powerCashExpected:power.powerRevenue-Number(power.internalSupply?.cashPostedRevenue||0),pnl:st.finance.dailyCompanyReports.find(r=>r.day===day)?.companies,powerDaily:GH_ECONOMICS_CORE.sectorEconomics(st,{day,preferDailyReport:true}).detail.powerRevenue,propertyDaily:GH_REALESTATE_CORE.dailyResult(st,day),cash:{power:F.operating(st,'power'),realestate:F.operating(st,'realestate')}};
  },fixture);
  console.log(JSON.stringify({phase:"revenue",engine:engine.name(),revenue}));
  assert.equal(revenue.fatal,null,JSON.stringify(revenue.fatal));assert.equal(revenue.day,2);assert.equal(revenue.powerCommissioned,true);assert.equal(revenue.propertyComplete,'مكتمل');assert.ok(revenue.powerRevenue>0);assert.ok(revenue.propertyRevenue>0);assert.ok(Math.abs(revenue.powerDaily-revenue.powerRevenue)<.02);assert.equal(revenue.powerInvoice.length,1,'one protected revenue invoice per power close');assert.ok(revenue.powerInvoice[0].proof);assert.ok(Math.abs(revenue.powerInvoice[0].amount-revenue.powerCashExpected)<.02);assert.equal(revenue.propertyInvoices.length,1);assert.ok(Math.abs(revenue.propertyInvoices[0].amount-revenue.propertyDaily.cashRevenue)<.02);assert.ok(revenue.propertyInvoices.every(i=>i.proof));assert.ok(Math.abs(revenue.pnl.power.grossRevenue-revenue.powerRevenue)<.02);assert.ok(Math.abs(revenue.pnl.realestate.grossRevenue-revenue.propertyRevenue)<.02);
  results.push({engine:engine.name(),revenue});assert.equal(dialogs.length,0,'construction decisions use the nonblocking DOM confirmation');
  const refusedTargets=await page.evaluate(async()=>{
   const get=()=>__GH_STATE__,a=__AUDIT__,awarded=await a.runAuthorizedDomainCommand('procurement','award-construction',{company:'power',facilityKind:'power',siteName:'QA Refused Solar',bid:{supplier:{id:'QA-380-NACK',legalName:'مقاول الطاقة'},quote:82000000,score:90}},{silent:true}),contractId=awarded.result.id;
   Object.assign(get().constructionContracts.find(c=>c.id===contractId),{leadDays:4,capacityKey:'solarMW',capacityAmount:100,energyKind:'solar',commissioned:false});
   get().customHubs.push({id:'QA-380-NACK-POWER',name:'QA Refused Solar',kind:'power',ownerCompanyId:'power',owned:true,city:'الرياض',country:'السعودية',energyKind:'solar',capacityAmount:100,capacity:'100 MW',cost:82000000,commissioned:false,dailyCost:0,plannedDailyCost:12000,constructionContractId:contractId});GH_ENERGY_CORE.ensure(get());
   const officeId=GH_REALESTATE_CORE.ensure(get()).offices[0].id,started=await a.runAuthorizedDomainCommand('realestate','start-project',{officeId,type:'residential',size:1,priceLevel:1,mode:'lease'},{silent:true});await GH_PERSISTENCE.drain();

   return [{panel:'energy',company:'power',id:contractId},{panel:'realestate',company:'realestate',id:started.result.id}];
  });
  await page.evaluate(installVault);await page.evaluate(()=>{__DIFF_VAULT__.mode='commit-nack';});
  for(const target of refusedTargets){
   const before=await page.evaluate(target=>{__DIFF_VAULT__.attempts=[];__AUDIT__.openDrawer(target.panel,{tab:'projects'});const st=__GH_STATE__,row=target.panel==='energy'?st.constructionContracts.find(c=>c.id===target.id):st.realEstate.projects.find(p=>p.id===target.id);return {balance:GH_FINANCE_CORE.operating(st,target.company),cheques:st.finance.cheques.length,saveRevision:st.saveRevision,schedule:target.panel==='energy'?row.leadDays:row.completeDay};},target);
   const selector=`[data-gh-action="${target.panel}-accelerate-construction"][data-${target.panel==='energy'?'contract':'project'}="${target.id}"]`;
   await page.locator(selector).tap();await page.locator('.ui-confirm [data-confirm="accept"]').tap();await page.waitForFunction(()=>__DIFF_VAULT__.attempts.length>0&&!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked());
   const rejected=await page.evaluate(target=>{const st=__GH_STATE__,row=target.panel==='energy'?st.constructionContracts.find(c=>c.id===target.id):st.realEstate.projects.find(p=>p.id===target.id);return {nacks:__DIFF_VAULT__.attempts.length,balance:GH_FINANCE_CORE.operating(st,target.company),cheques:st.finance.cheques.length,saveRevision:st.saveRevision,schedule:target.panel==='energy'?row.leadDays:row.completeDay,acceleration:row.constructionAcceleration};},target);
   assert.equal(rejected.nacks,1,'a refused acceleration must not start a second save while reopening its view');assert.equal(rejected.balance,before.balance);assert.equal(rejected.cheques,before.cheques);assert.equal(rejected.saveRevision,before.saveRevision);assert.equal(rejected.schedule,before.schedule);assert.equal(rejected.acceleration,undefined,'native refusal restores both paid fees and the schedule');assert.equal(await page.locator(selector).count(),1,'a refused acceleration remains available for a later retry');
   results.push({engine:engine.name(),panel:target.panel,nativeRefusalRollback:true,commitAttempts:rejected.nacks});
  }
  assert.deepEqual(errors,[]);await page.close();
 }finally{await browser.close();await closeOrigin?.();}
}console.log(JSON.stringify({suite:'build380-construction-acceleration-browser',ok:true,engines:2,results}));})().catch(e=>{console.error(e);process.exitCode=1;});
