'use strict';
// The documents page is light (owner, build 77 diagnostic: opening it took 80 ms on the iPhone, building it 68 ms;
// «ليه مانجهز مستند بدال الرسم»). Measured in the real app on this source and on the source before the list (run from
// its own tree), the same world with sixty more documents of each kind:
//  1. opening each documents page (transfers, cheques, invoices) builds no full document and fewer elements than before,
//     and building it (the app's own 'ui.render' clock) costs at most half of what drawing its documents cost;
//  2. opening one document from its row costs no more than drawing a page of documents did;
//  3. reading the pages writes nothing.
// Both sources are open side by side and each page is opened on each in turn, the cheapest of five kept, so a machine
// that slows down during the run weighs on both alike. The processor runs at full speed: slowed four times, the
// throttle's own pauses land at random in a build of a few milliseconds (the same cheques page measured 3.6 to 15 ms
// from one opening to the next), and one source measured after the other failed the half once. Chromium on a desktop;
// not iPhone performance.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const {bootAtOrigin,installVault}=require('./helpers/differential-vault-fixture.cjs'),{prepareCommandWorld}=require('./helpers/command-world-fixture.cjs');
const ROOT=path.resolve(__dirname,'..'),SOURCE=process.env.GH_TEST_SOURCE_DIR||ROOT,PREVIOUS='adb8b56',VIEWS=['transfers','cheques','invoices'];
async function boot(root){
 const browser=await chromium.launch({headless:true}),errors=[];let env;try{
  env=await bootAtOrigin({browser,root,errors,fleetWorker:true,viewport:{width:956,height:440},beforeScripts:{fn:installVault}});const {page}=env;page.setDefaultTimeout(180000);await prepareCommandWorld(page,{count:2});
  // Sixty more of each: accrued payables (invoices), a third paid by cheque, a third by transfer, in one transaction.
  await page.evaluate(()=>{const s=__GH_STATE__,F=GH_FINANCE_CORE;s.godMoney=true;s.infiniteMoney=true;GH_TRANSACTION_CORE.execute(s,{label:'QA-documents-weight',apply:()=>{for(let i=0;i<60;i++){const company=['air','sea','road'][i%3],doc=F.execute({state:s},'accrue-expense',{company,amount:1000+i,note:`QA weight ${i}`,counterparty:'QA Weight Vendor LLC',taxable:false,number:`QA-W-${String(i).padStart(3,'0')}`});if(i%3===0){const c=F.execute({state:s},'settle-payable',{number:doc.number,method:'cheque'});F.execute({state:s},'settle-cheque',{id:c.chequeId});}else if(i%3===1)F.execute({state:s},'settle-payable',{number:doc.number,method:'transfer'});}}});});
  await page.evaluate(()=>{const api=window.GH_DIAGNOSTICS;window.__qaStages=[];window.GH_DIAGNOSTICS={...api,recordMainThreadWork:(s,stage,from,to)=>{window.__qaStages.push([stage,to-from]);return api.recordMainThreadWork(s,stage,from,to);}};});
  const open=async arg=>{await page.evaluate(()=>__AUDIT__.closeDrawer?.());await page.waitForTimeout(60);return page.evaluate(async arg=>{window.__qaStages=[];const t0=performance.now();__AUDIT__.openDrawer('invoices',arg);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const stage=n=>window.__qaStages.filter(([k])=>k===n).reduce((a,[,v])=>a+v,0),body=document.getElementById('drawerBody');return {render:stage('ui.render'),total:performance.now()-t0,nodes:body.querySelectorAll('*').length,documents:body.querySelectorAll('.document-card').length,firstRow:body.querySelector('[data-finance-doc]')?.dataset.financeDoc||null};},arg);};
  const books=()=>page.evaluate(()=>JSON.stringify([__GH_STATE__.finance,__GH_STATE__.treasury,__GH_STATE__.saveRevision]));
  return {errors,open,books,initial:await books(),out:{},close:async()=>{await browser.close();await env?.closeOrigin?.();}};
 }catch(error){await browser.close();await env?.closeOrigin?.();throw error;}
}
(async()=>{
 const tree=fs.mkdtempSync(path.join(os.tmpdir(),'b570-'));let current,old;try{execFileSync('sh',['-c',`git -C "${ROOT}" archive ${PREVIOUS} WebApp | tar -x -C "${tree}"`]);
  current=await boot(SOURCE);old=await boot(tree);
  for(const view of VIEWS){
   const arg={company:'all',tab:'documents',view},runs=new Map([[current,[]],[old,[]]]);for(let i=0;i<5;i++)for(const t of [current,old])runs.get(t).push(await t.open(arg));
   for(const t of [current,old]){const rows=runs.get(t),best=key=>Math.min(...rows.map(r=>r[key]));t.out[view]={render:best('render'),total:best('total'),nodes:rows[0].nodes,documents:rows[0].documents};
    if(rows[0].firstRow){const doc=JSON.parse(rows[0].firstRow),one=[];for(let i=0;i<5;i++)one.push(await t.open(doc));t.out[view].opened={render:Math.min(...one.map(r=>r.render)),documents:one[0].documents};}}
  }
  for(const t of [current,old]){t.out.unchanged=(await t.books())===t.initial;assert.deepEqual(t.errors,[]);}
  const now=current.out,before=old.out;
  for(const view of VIEWS){const n=now[view],b=before[view];
   // 1
   assert.equal(n.documents,0,`1 ${view}: the list draws no full document`);assert(b.documents>0,`1 ${view}: the old page drew documents`);assert(n.nodes<b.nodes,`1 ${view}: fewer elements (${n.nodes} vs ${b.nodes})`);
   assert(n.render<=b.render*.5,`1 ${view}: building the page (${n.render.toFixed(1)} vs ${b.render.toFixed(1)} ms)`);
   // 2
   assert(n.opened&&n.opened.documents===1,`2 ${view}: a row opens its one document`);assert(n.opened.render<=b.render*1.1+2,`2 ${view}: opening one document (${n.opened.render.toFixed(1)} ms) against a page of them (${b.render.toFixed(1)} ms)`);}
  // 3
  assert(now.unchanged&&before.unchanged,'3: reading the pages writes nothing');
  console.log(JSON.stringify({suite:'build570-documents-list-weight-browser',ok:true,environment:'Chromium desktop, full speed, the two sources in turn; not iPhone performance',now,before}));
 }finally{await current?.close();await old?.close();fs.rmSync(tree,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
