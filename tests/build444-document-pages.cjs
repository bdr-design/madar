'use strict';
// Document pages (owner, build 77 diagnostic: the documents page took 80 ms to open on the iPhone; «ليه مانجهز مستند
// بدال الرسم»). A documents page lists light rows, twenty a page; the full signed document is drawn only for an opened
// row. Proven on the real renderer with every collection behind a counting proxy:
//  1. the signed document templates and their actions are byte-for-byte unchanged (the game's name in four of their
//     headers, «· VENTORA» -> «· ASSETS & INFLUENCE», is the only change since build 77: owner, «أصول ونفوذ»);
//  2. every document appears once as a row, in the original (directional) order, through the page controls, beyond any
//     old first-N limit; a page never holds more than twenty rows and draws no full document; a bad page is page one;
//  3. each row opens exactly its own document, drawn once by the unchanged template, with its place in the list, the
//     neighbouring documents and the way back to its page; a document no longer in the list says so.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),espree=require('espree'),{environment}=require('./build440-document-collection-work.cjs');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(ROOT,'WebApp/app.js'),'utf8'),declarations={};
function walk(n){if(!n||typeof n!=='object')return;if(n.type==='FunctionDeclaration')declarations[n.id.name]=source.slice(...n.range);for(const v of Object.values(n))if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')walk(v);}walk(espree.parse(source,{ecmaVersion:'latest',range:true}));
// 1
const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/build444-document-art.json'),'utf8'));for(const [name,hash] of Object.entries(fixture))assert.equal(crypto.createHash('sha256').update(declarations[name]).digest('hex'),hash,name+': signed document markup and actions remain exactly unchanged');
const unescape=value=>value.replaceAll('&quot;','"').replaceAll('&lt;','<').replaceAll('&amp;','&'),SIZE=20;
const rowsOf=html=>[...html.matchAll(/data-finance-doc="([^"]+)"/g)].map(m=>JSON.parse(unescape(m[1])));
const artsOf=html=>html.match(/<(invoiceArt|chequeArt|transferArt|commercialContractArt|payrollArt|taxSettlementArt|debtSettlementArt)>.*?<\/\1>/g)||[];
const keys={invoices:r=>String(r.number||''),cheques:r=>String(r.id||r.chequeNumber||''),transfers:r=>[r.reference||r.id||'',r.kind||'',r.documentNumber||'',Number(r.at)||0,Number(r.amount)||0].join('|'),contracts:r=>String(r.id||r.reference||''),payroll:r=>String(r.id||''),settlements:item=>`${item.kind}:${item.row.settlementNumber||item.row.reference||item.row.id||''}`};
const cases=[];
function check(e,arg,expected,art){
 // 2: the rows, page by page through the controls
 const pages=Math.max(1,Math.ceil(expected.length/SIZE)),seen=[];
 for(let page=0;page<pages;page++){const r=e.run({...arg,page}),rows=rowsOf(r.html);assert(rows.length<=SIZE,`${arg.view}: at most twenty rows a page`);assert.equal(artsOf(r.html).length,0,`${arg.view}: the list draws no full document`);
  for(const row of rows){assert.equal(row.page,page,'a row knows its page');assert.equal(row.company,arg.company,'a row keeps the owner');assert.equal(row.view,arg.view);seen.push(row.doc);}
  if(pages>1){assert(r.html.includes('data-finance-page='),'all retained history must be reachable');assert(r.html.includes('&quot;company&quot;:&quot;'+arg.company+'&quot;'),'page navigation retains owner');}}
 assert.deepEqual(seen,expected.map(keys[arg.view]),`${arg.view}/${arg.company}/${arg.direction}: every document once, in the original order`);
 for(const page of [-1,NaN,Infinity,'invalid'])assert.equal(e.run({...arg,page}).html,e.run({...arg,page:0}).html,'invalid page is bounded');
 const last=e.run({...arg,page:Number.MAX_SAFE_INTEGER});assert.deepEqual(rowsOf(last.html).map(r=>r.doc),expected.slice((pages-1)*SIZE).map(keys[arg.view]),'a page past the end is the last page');
 // 3: each row opens its own document
 expected.forEach((record,index)=>{const doc=keys[arg.view](record),html=e.run({...arg,page:Math.floor(index/SIZE),doc}).html,arts=artsOf(html);
  assert.deepEqual(arts,[art(record)],`${arg.view}: row ${index} opens exactly its document`);assert(html.includes(`>${index+1} / ${expected.length}<`),'its place in the list');
  const back=JSON.parse(unescape(html.match(/data-finance-back="([^"]+)"/)[1]));assert.deepEqual(back,{company:arg.company,tab:'documents',view:arg.view,direction:arg.direction,page:Math.floor(index/SIZE)},'back to its page');
  const steps=[...html.matchAll(/data-finance-page="([^"]+)"/g)].map(m=>JSON.parse(unescape(m[1])).doc);assert.deepEqual(steps,[index>0?keys[arg.view](expected[index-1]):null,index<expected.length-1?keys[arg.view](expected[index+1]):null].filter(v=>v!==null),'the neighbours');});
 const gone=e.run({...arg,doc:'no-such-document'}).html;assert.equal(artsOf(gone).length,0);assert(gone.includes('لم يعد هذا المستند في القائمة المختارة'),'a document no longer listed says so');
 cases.push({view:arg.view,company:arg.company,direction:arg.direction,rows:expected.length,pages});
}
for(const view of ['invoices','cheques'])for(const company of ['all','air','group'])for(const direction of view==='cheques'?['all','incoming','outgoing']:['all']){
 const e=environment(321),selected=e.records[view].filter(r=>company==='all'||(r.company||'group')===company),incoming=r=>e.g.isIncomingCheque(r),rows=view==='cheques'?(direction==='all'?[...selected.filter(incoming),...selected.filter(r=>!incoming(r))]:selected.filter(r=>incoming(r)===(direction==='incoming'))):selected;
 check(e,{company,tab:'documents',view,direction},rows,e.g[view==='invoices'?'invoiceArt':'chequeArt']);}
for(const view of ['transfers','contracts','payroll','settlements'])for(const company of ['all','air']){
 const e=environment(121),belongs=r=>company==='all'||(r.company||'group')===company;let expected,art;
 if(view==='transfers'){expected=e.records.ledger.filter(r=>!e.g.isChequeLedgerRow(r)).filter(r=>company==='all'||r.company===company||String(r.from||'').startsWith(company.toUpperCase())||String(r.to||'').startsWith(company.toUpperCase()));art=e.g.transferArt;}
 if(view==='contracts'){expected=e.records.commercialContracts.filter(belongs);art=e.g.commercialContractArt;}
 if(view==='payroll'){expected=e.records.payrollReports.filter(r=>company==='all'||(r.lines||[]).some(l=>l.company===company));art=e.g.payrollArt;}
 if(view==='settlements'){expected=[...e.records.taxSettlements.filter(belongs).map(row=>({kind:'tax',row})),...e.records.debtSettlements.filter(belongs).map(row=>({kind:'debt',row}))].sort((a,b)=>(Number(b.row.paidAt)||0)-(Number(a.row.paidAt)||0));art=item=>e.g[item.kind==='tax'?'taxSettlementArt':'debtSettlementArt'](item.row);}
 check(e,{company,tab:'documents',view,direction:'all'},expected,art);}
console.log(JSON.stringify({suite:'build444-document-pages',cases,rowsPerPage:SIZE,signedTemplatesUnchanged:true,fullHistoryReachable:true,eachRowOpensItsDocument:true}));
