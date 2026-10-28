'use strict';
// Owner (build 98: «الشركات لاتسجل ضرائب»; chosen: zero-rate construction). In the full app with the real buttons: the media
// company, the sports club, the hospital company and the hotel company are founded, a facility is opened for each from the
// world directory, and play runs past the month's VAT close:
//  1. every facility's construction is paid in full by a cleared cheque and carries no input VAT (the build cost as quoted,
//     a hotel's building too);
//  2. after the month closes, the companies with taxed sales record the VAT they owe: the media company's and the club's
//     returns are due (status «مستحق», amount > 0) and equal their sales VAT less their purchases' VAT, and the book's
//     payable carries it; the hospital company's sales are exempt and its return is zero;
//  3. nothing is rolled back and no error is logged.
const assert=require('node:assert/strict');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');
const COMPANIES=['media','sports','healthcare','hospitality'];
(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[],warnings=[];
  try{
    const {page}=await boot({browser,errors,viewport:{width:844,height:390}});page.setDefaultTimeout(60000);
    page.on('console',message=>{if(message.type()==='warning'&&/rolled back/i.test(message.text()))warnings.push(message.text().slice(0,300));});
    await page.evaluate(async companies=>{const a=__AUDIT__,s=__GH_STATE__;s.godMoney=true;s.infiniteMoney=true;for(const type of companies){const d=GH_COMPANY_PLATFORM.definitionFor(s,type);await a.runAuthorizedDomainCommand('corporate','open-company',{type,companyId:type,capital:Math.max(900000000,d.founding.minimumCapital),legalName:`QA ${type}`,formationContract:`QA-VAT-${type}`},{silent:true});}},COMPANIES);
    for(const company of COMPANIES){
      const before=await page.evaluate(c=>(__GH_STATE__.customHubs||[]).filter(f=>(f.ownerCompanyId||f.company)===c).length,company);
      await page.evaluate(()=>__AUDIT__.openDrawer('network'));await page.locator('#worldKind').selectOption(company);
      const open=page.locator('#drawerBody .open-directory-site').first();await open.waitFor({state:'visible'});await open.click();
      const confirm=page.locator('dialog.ui-confirm [data-confirm="accept"]');if(await confirm.isVisible().catch(()=>false))await confirm.click();
      await page.waitForFunction(([c,n])=>(__GH_STATE__.customHubs||[]).filter(f=>(f.ownerCompanyId||f.company)===c).length>n&&!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked(),[company,before],{timeout:30000});
    }
    // 1.
    const construction=await page.evaluate(companies=>{const F=__GH_STATE__.finance;return companies.map(c=>{const rows=F.invoices.filter(i=>i.company===c&&i.kind!=='دخل'&&/^(?:دفعة إنشاء وتسليم · |إنشاء وتجهيز )/.test(String(i.note||'')));return {company:c,rows:rows.map(i=>({tax:Number(i.tax)||0,total:Number(i.total??i.amount),cheque:(F.cheques.find(ch=>ch.invoiceNumber===i.number)||{}).status||null,cost:(__GH_STATE__.customHubs.find(h=>(h.ownerCompanyId||h.company)===c)||{}).cost||null}))};});},COMPANIES);
    for(const row of construction){assert.equal(row.rows.length,1,`1: ${row.company}: one construction payment`);const p=row.rows[0];assert.equal(p.tax,0,`1: ${row.company}: no input VAT on construction`);assert.equal(p.cheque,'مصروف',`1: ${row.company}: paid by a cleared cheque`);assert.ok(p.total>0&&(!p.cost||Math.abs(p.total-p.cost)<1),`1: ${row.company}: the quoted build cost in full (${p.total} / ${p.cost})`);}
    // Play past the month's close (the game's calendar starts on 1 January).
    await page.evaluate(()=>{__AUDIT__.closeDrawer();const s=__GH_STATE__;s.godMoney=false;s.infiniteMoney=false;});
    const end=await page.evaluate(()=>{const start=Math.floor(__GH_STATE__.simSeconds/86400),month=new Date(Date.UTC(2026,0,1)+start*864e5).getUTCMonth();for(let d=start+1;d<400;d++){const date=new Date(Date.UTC(2026,0,1)+d*864e5);if(date.getUTCDate()===2&&date.getUTCMonth()!==month)return d;}return 40;});
    await page.evaluate(to=>__AUDIT__.simulationEngine.advanceTo(to,{reason:'qa-construction-vat'}),end*86400+1);
    await page.waitForFunction(()=>!__AUDIT__.simulationEngine.snapshot().manualAdvance&&!window.__GH_DURABLE_COMMAND_CONTEXT__,null,{timeout:240000});
    const returns=await page.evaluate(companies=>{const s=__GH_STATE__,F=s.finance;return companies.map(c=>{const b=s.companyFinance[c],period=(F.periods||[]).filter(p=>p.company===c).sort((a,b)=>String(a.id).localeCompare(String(b.id)))[0]||null,inv=F.invoices.filter(i=>i.company===c&&Number(i.at)<=Number(period?.closedAt??Infinity));return {company:c,period:period&&{id:period.id,amount:Number(period.amount),status:period.status},saleVat:inv.filter(i=>i.kind==='دخل').reduce((a,i)=>a+(Number(i.tax)||0),0),buyVat:inv.filter(i=>i.kind!=='دخل').reduce((a,i)=>a+(Number(i.tax)||0),0),payable:Number(b.taxPayable)||0};});},COMPANIES);
    const by=Object.fromEntries(returns.map(r=>[r.company,r]));
    // 2.
    for(const c of ['media','sports']){const r=by[c];assert.ok(r.period&&r.period.status==='مستحق'&&r.period.amount>0,`2: ${c}: the month's VAT return is due (${JSON.stringify(r.period)})`);assert.ok(Math.abs(r.period.amount-(r.saleVat-r.buyVat))<1,`2: ${c}: it is the sales VAT less the purchases' VAT (${r.period.amount} vs ${r.saleVat-r.buyVat})`);assert.ok(r.payable>=r.period.amount-0.01,`2: ${c}: the book's payable carries it`);}
    assert.ok(by.healthcare.period&&by.healthcare.period.amount===0&&by.healthcare.saleVat===0,`2: healthcare: exempt sales, a zero return (${JSON.stringify(by.healthcare)})`);
    // 3.
    assert.deepEqual(warnings,[],'3: nothing rolled back');assert.deepEqual(errors,[],'3: no error');
    console.log(JSON.stringify({suite:'build596-construction-vat-browser',ok:true,returns}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
