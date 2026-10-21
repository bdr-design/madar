'use strict';
// The conference's customer chapter and the monthly report counted a company's customers as its named business
// relationships (0 for a bank with hundreds of customers), except for telecom and the dealership. Proven on the real
// conference, banking, insurance, customer-base and finance owners (business scenario: an airline, a bank with a branch
// of 800 retail and 40 business customers, an insurer with policies):
//  1. the snapshot records each company's customer base: the bank's own customers, the insurer's insured households and
//     businesses as the customer-base owner counts them, none for the airline;
//  2. the customer chapter shows that base as the registered customer base, with the current-snapshot caption; the
//     airline still shows its named relationships;
//  3. the monthly report's customer count is the same base;
//  4. the previous source (run from its own tree) showed the bank's relationships instead (none).
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'),SOURCE=process.env.GH_TEST_SOURCE_DIR||ROOT,PREVIOUS='677c7a6';
process.env.GH_TEST_SOURCE_DIR=SOURCE;
const {scenario:business}=require('./helpers/business-scenario.js');

function scenario(){
  const env=business(),{s,state,command}=env;for(const name of ['customer-base-core','banking-core','insurance-core','arabic-copy-core','conference-model',fs.existsSync(path.join(SOURCE,'WebApp/conference-keynote.js'))?'conference-keynote':'conference-board','conference-core'])env.load(name);
  s.GH_FINANCE_CORE.book(state,'group').accounts[0].balance+=2e9;command('corporate','open-company',{type:'bank',capital:400000000,legalName:'Test Bank'});command('corporate','open-company',{type:'insurance',capital:200000000,legalName:'Test Insurance'});
  const bank=s.GH_BANKING_CORE.ensure(state);bank.branchNetwork.push({id:'BR-QA',city:'Riyadh',country:'Saudi Arabia',servicesActive:true,deposits:0,loans:0,retailCustomers:800,businessCustomers:40,lastProcessedDay:0});
  const ins=s.GH_INSURANCE_CORE.ensure(state);(ins.offices||[]).length||ins.offices.push({id:'INS-QA',city:'Riyadh',country:'Saudi Arabia',lines:{}});
  const office=ins.offices[0];office.lines=office.lines||{};for(const [line,policies] of Object.entries({motor:300,health:120,commercial:25}))office.lines[line]={...(office.lines[line]||{}),policies};
  const snap=s.GH_CONFERENCE.buildSnapshot(state,2026,'global'),company=type=>snap.companies.find(row=>row.type===type);
  const chapter=type=>company(type).conferenceContributions.find(row=>row.id==='customer-voice')||null,row=type=>chapter(type)?.metrics?.find(m=>m.id==='customers')||null;
  const ctx={state,esc:value=>String(value??''),fmtMoney:value=>String(value),fmtNumber:value=>Number(value).toLocaleString('en-US'),fmtInt:value=>String(value)},page=s.GH_CONFERENCE.render(ctx,'monthly');
  return {base:{bank:company('bank').customerBase??null,insurance:company('insurance').customerBase??null,air:company('air').customerBase??null},expectedInsurance:s.GH_CUSTOMER_BASE.companyCustomers(state,'insurance'),
    rows:{bank:row('bank'),insurance:row('insurance'),air:row('air')},caption:chapter('bank')?.caption||'',
    monthly:{page:page.length,bank840:page.includes('840')}};
}
if(process.env.GH_B547_CHILD){console.log(JSON.stringify(scenario()));return;}
(()=>{
  const now=scenario();
  assert.equal(now.base.bank,840,`1: the bank's base is its own customers (${JSON.stringify(now.base)})`);
  assert(now.expectedInsurance>0&&now.base.insurance===Math.round(now.expectedInsurance),`1: the insurer's base is the customer-base owner's count (${JSON.stringify(now)})`);
  assert.equal(now.base.air,null,'1: the airline has no customer base');
  assert.deepEqual([now.rows.bank?.label,now.rows.bank?.value],['قاعدة العملاء المسجلة','840'],`2: the bank's chapter shows its base (${JSON.stringify(now.rows.bank)})`);
  assert.equal(now.rows.insurance?.label,'قاعدة العملاء المسجلة','2: so does the insurer\'s');assert.match(now.caption,/دورة العملاء الحالية/,'2: with the current-snapshot caption');
  assert(!now.rows.air||now.rows.air.label==='علاقات العملاء المسجلة','2: the airline keeps its named relationships');
  assert(now.monthly.page>500&&now.monthly.bank840,`3: the monthly report shows the bank's base (${JSON.stringify(now.monthly)})`);
  const tree=fs.mkdtempSync(path.join(os.tmpdir(),'b547-'));
  try{execFileSync('sh',['-c',`git -C "${ROOT}" archive ${PREVIOUS} WebApp | tar -x -C "${tree}"`]);
    const before=JSON.parse(execFileSync(process.execPath,[__filename],{env:{...process.env,GH_B547_CHILD:'1',GH_TEST_SOURCE_DIR:tree},encoding:'utf8',maxBuffer:16*1024*1024}).trim().split('\n').at(-1));
    assert.notEqual(before.rows.bank?.value,'840',`4: the previous source did not show the bank's customers (${JSON.stringify(before.rows.bank)})`);assert.equal(before.monthly.bank840,false,'4: nor did its monthly report');
    console.log(JSON.stringify({suite:'build547-conference-customer-base',ok:true,current:{base:now.base,monthly:now.monthly},previous:{bank:before.rows.bank,insurance:before.rows.insurance}}));
  }finally{fs.rmSync(tree,{recursive:true,force:true});}
})();
