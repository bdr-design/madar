'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{chromium,webkit}=require('playwright'),{boot}=require('./helpers/local-dom-app');
const out=process.env.GH_CONSTRUCTION_ARTIFACTS||null,results=[];
(async()=>{for(const engine of [chromium,webkit]){
 const browser=await engine.launch({headless:true}),errors=[],dialogs=[];
 try{
  const {page}=await boot({browser:{newPage:options=>browser.newPage({...options,hasTouch:true})},errors,viewport:{width:956,height:440}});page.setDefaultTimeout(60000);
  let accept=false;page.on('dialog',async d=>{dialogs.push(d.message());await (accept?d.accept():d.dismiss());});
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
  const balance=company=>page.evaluate(c=>({balance:GH_FINANCE_CORE.operating(__GH_STATE__,c),cheques:__GH_STATE__.finance.cheques.length}),company);
  for(const [panel,id,company]of [['energy','energy-accelerate-construction','power'],['realestate','realestate-accelerate-construction','realestate']]){
   await page.evaluate(panel=>__AUDIT__.openDrawer(panel,{tab:'projects'}),panel);const button=page.locator(`[data-gh-action="${id}"]`).first();assert.equal(await button.count(),1,'newly built facilities show acceleration before first day refresh');
   for(const size of [{width:568,height:320},{width:440,height:956},{width:956,height:440}]){await page.setViewportSize(size);await button.scrollIntoViewIfNeeded();const b=await button.boundingBox();assert.ok(b&&b.x>=0&&b.y>=0&&b.x+b.width<=size.width+1&&b.y+b.height<=size.height+1,`acceleration button fits ${size.width}x${size.height}`);}
   if(out&&engine===chromium){fs.mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,`${panel}-before.png`)});}
   const fee=Number(await button.getAttribute('data-fee')),before=await balance(company);await button.tap();assert.deepEqual(await balance(company),before,'cancel has no financial effect');
   accept=true;await button.tap();await page.waitForFunction(({energy,fixture})=>{const st=__GH_STATE__,row=energy?st.constructionContracts.find(c=>c.id===fixture.contractId):st.realEstate.projects.find(p=>p.id===fixture.projectId);return !!row?.constructionAcceleration&&!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked();},{energy:panel==='energy',fixture});
   const after=await balance(company);assert.ok(Math.abs(before.balance-after.balance-fee)<.02,'actual company current account is debited');assert.equal(after.cheques,before.cheques+1);assert.equal(await page.locator(`[data-gh-action="${id}"]`).count(),0,'one-time acceleration cannot be bought twice');
   if(panel==='realestate')assert.ok(await page.locator('[data-gh-action="realestate-set-price"]').count(),'existing price control is preserved');
   results.push({engine:engine.name(),panel,fee,debited:before.balance-after.balance});accept=false;
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
  results.push({engine:engine.name(),revenue});assert.equal(dialogs.length,4);
  const refused=await page.evaluate(async()=>{
   const st=__GH_STATE__,officeId=GH_REALESTATE_CORE.ensure(st).offices[0].id,started=await __AUDIT__.runAuthorizedDomainCommand('realestate','start-project',{officeId,type:'residential',size:1,priceLevel:1,mode:'lease'},{silent:true});await GH_PERSISTENCE.drain();
   const projectId=started.result.id,project=__GH_STATE__.realEstate.projects.find(p=>p.id===projectId);window.__QA_380_NACKS=0;
   window.GH_NATIVE_BUILD=362;window.webkit={messageHandlers:{saveBridge:{postMessage(m){if(m.action==='commitSave'){window.__QA_380_NACKS++;setTimeout(()=>dispatchEvent(new CustomEvent('gh-native-save-ack',{detail:{requestId:m.requestId,action:m.action,saveRevision:m.saveRevision,resetEpoch:m.resetEpoch,saveSchemaVersion:m.saveSchemaVersion,saveHash:m.saveHash,success:false,message:'qa-native-reject'}})),0);}}}}};
   __AUDIT__.openDrawer('realestate',{tab:'projects'});return {projectId,completeDay:project.completeDay,balance:GH_FINANCE_CORE.operating(__GH_STATE__,'realestate'),cheques:__GH_STATE__.finance.cheques.length};
  });
  accept=true;await page.locator(`[data-gh-action="realestate-accelerate-construction"][data-project="${refused.projectId}"]`).tap();await page.waitForFunction(()=>__QA_380_NACKS>0&&!window.__GH_DURABLE_COMMAND_CONTEXT__);
  const rejected=await page.evaluate(id=>({nacks:__QA_380_NACKS,balance:GH_FINANCE_CORE.operating(__GH_STATE__,'realestate'),cheques:__GH_STATE__.finance.cheques.length,project:__GH_STATE__.realEstate.projects.find(p=>p.id===id)}),refused.projectId);
  assert.ok(rejected.nacks>0);assert.equal(rejected.balance,refused.balance);assert.equal(rejected.cheques,refused.cheques);assert.equal(rejected.project.completeDay,refused.completeDay);assert.equal(rejected.project.constructionAcceleration,undefined,'native refusal restores both paid fees and the schedule');results.push({engine:engine.name(),nativeRefusalRollback:true});
  assert.deepEqual(errors,[]);await page.close();
 }finally{await browser.close();}
}console.log(JSON.stringify({suite:'build380-construction-acceleration-browser',ok:true,engines:2,results}));})().catch(e=>{console.error(e);process.exitCode=1;});
