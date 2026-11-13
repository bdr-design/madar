'use strict';
// Build 690, from the automation batch (the owner: «نفذ بدقه مع اختبارات صارمة تمنع الثقل والمشاكل»):
//   a tender the group wins waited for a second tap on «توقيع» even when one company only could carry it out, the
//   player having no choice to make. It is signed now, in the same tap, by that company, through signContract (the
//   function the «توقيع» button calls: the same contracts:sign command, document and 10% deposit).
// Checked here on the real bidContract and signContract, lifted from app.js and run with stand-ins for the page:
//   1. won, one eligible company: one bid, then one sign with that company; the notice names it; the contract is active;
//   2. won, two eligible companies: no sign; the contract awaits the player's choice, the notice says so;
//   3. won, no eligible company: no sign, as before;
//   4. lost: no sign, no eligibility read;
//   5. the bid command refused: no sign, the refusal is shown;
//   6. the sign command refused: the contract stays awaiting its signature, the refusal is shown, and a later tap on
//      «توقيع» signs it once;
//   7. a second tap on the tender while it awaits or after signing sends nothing more;
//   8. the bid's own result is checked before signing: a bid recorded but not left awaiting (another path signed it)
//      is not signed again.
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||require('node:path').resolve(__dirname,'..');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR,app=fs.readFileSync(path.join(ROOT,'WebApp','app.js'),'utf8');
const slice=(start,end)=>{const a=app.indexOf(start),b=app.indexOf(end,a+1);assert.ok(a>=0&&b>a,`lift: ${start}`);return app.slice(a,b);};
const bidSource=slice('async function bidContract(','async function signContract('),signSource=slice('async function signContract(','\n');
const AWAIT='بانتظار التوقيع';

function world({eligible=['road-a'],won=true,failBid=null,failSign=null,afterBid=null}={}){
  const calls=[],notices=[],alerts=[],reads=[];
  const state={acceptedContracts:[],contractRegistry:{},branches:[]};
  const contracts=[{id:'K1',sector:'road',category:'تشغيل',name:'توزيع دوائي مبرد',client:'MedAxis International',value:48000000,termMonths:24,region:'الخليج',sla:'98.5%',penalty:'غرامة',capacity:'18 شاحنة',payment:'شهري',bidBase:.9}];
  const names={'road-a':'Road A','road-b':'Road B'};
  const env={state,contracts,drawerNavigationRevision:1,activeDrawerPanel:'contracts',activeDrawerArg:undefined,
    pushAlert:text=>alerts.push(text),notice:(text,kind)=>notices.push({text,kind}),tenderWaitDays:()=>0,countText:(n,unit)=>`${n} ${unit}`,
    reasonText:error=>String(error?.message||error),contractCapacityReason:()=>null,officialManagerCount:()=>0,clamp:(v,a,b)=>Math.min(b,Math.max(a,v)),
    simRandom:()=>won?0:.99,window:{GH_BUSINESS_WORLD:{competitorForSector:()=>({id:'RIVAL-1',displayName:'Rival One'})},GH_CONTRACTS_CORE:{RETENDER_DAYS:30}},
    eligibleContractCompanyIds:contract=>{reads.push(contract.id);return eligible.slice();},nextId:prefix=>`${prefix}-QA-1`,companyFinanceName:id=>names[id]||id,
    companyTaxable:()=>true,updateKpis:()=>{},reopenDrawer:()=>{},
    runAuthorizedDomainCommand:async(domain,cmd,payload,options)=>{
      calls.push({domain,cmd,payload});
      if(cmd==='bid'){
        if(failBid)throw new Error(failBid);
        if(payload.won)state.contractRegistry[payload.id]={status:AWAIT,number:payload.number};else state.failedBids=[payload.id];
        if(afterBid)afterBid(state,payload);
        notices.push({text:options.successNotice({}),kind:'success'});return {result:{won:payload.won}};
      }
      if(cmd==='sign'){
        if(state.acceptedContracts.includes(payload.id))throw new Error('contract-already-signed');
        if(failSign){const reason=failSign;failSign=null;throw new Error(reason);}
        state.acceptedContracts.push(payload.id);state.contractRegistry[payload.id]={...state.contractRegistry[payload.id],status:'نشط',company:payload.company};
        const doc={number:state.contractRegistry[payload.id].number};notices.push({text:options.successNotice(doc),kind:'success'});return {result:doc};
      }
      throw new Error(`unexpected ${domain}:${cmd}`);
    }};
  const names_=Object.keys(env),run=new Function(...names_,`${bidSource}\n${signSource}\nreturn {bidContract,signContract};`)(...names_.map(key=>env[key]));
  return {...run,state,calls,notices,alerts,reads,signs:()=>calls.filter(call=>call.cmd==='sign'),bids:()=>calls.filter(call=>call.cmd==='bid')};
}

(async()=>{
  // 1.
  {const w=world();await w.bidContract('K1');
    assert.equal(w.bids().length,1,'1: one bid');assert.equal(w.signs().length,1,'1: one signature');
    const sign=w.signs()[0].payload;assert.equal(sign.company,'road-a','1: signed by the only eligible company');assert.equal(sign.companyId,'road-a');assert.equal(sign.ownerCompanyId,'road-a');
    assert.equal(sign.deposit,4800000,'1: the same 10% deposit as the button');assert.equal(sign.id,'K1');
    assert.ok(w.calls.indexOf(w.signs()[0])>w.calls.indexOf(w.bids()[0]),'1: the signature follows the bid');
    assert.equal(w.state.contractRegistry.K1.status,'نشط','1: the contract is active');assert.deepEqual(w.state.acceptedContracts,['K1']);
    assert.match(w.notices[0].text,/والعقد يُرسل للتوقيع باسم Road A، الشركة الوحيدة المؤهلة لتنفيذه/,'1: the bid notice names the signer');assert.ok(!/يُوقَّع العقد الآن/.test(w.notices[0].text),'1: and does not claim the signature before it is made (review round 4)');
    assert.match(w.notices[1].text,/^تم توقيع GH-CN-QA-1 باسم Road A مع MedAxis International/,'1: then the signature notice');
    assert.equal(w.notices.length,2,'1: two notices, no warning');}
  console.log('1 ok: one eligible company signs the won tender in the same tap');

  // 2.
  {const w=world({eligible:['road-a','road-b']});await w.bidContract('K1');
    assert.equal(w.signs().length,0,'2: no signature');assert.equal(w.state.contractRegistry.K1.status,AWAIT,'2: awaits the player');
    assert.match(w.notices[0].text,/العقد بانتظار توقيعك قبل بدء التشغيل/,'2: the notice says the choice is the player\'s');assert.equal(w.notices.length,1);
    const signed=await w.signContract('K1','road-b');assert.equal(signed,true);assert.equal(w.signs().length,1);assert.equal(w.signs()[0].payload.company,'road-b','2: the player\'s choice signs');}
  console.log('2 ok: with two eligible companies the player chooses, as before');

  // 3.
  {const w=world({eligible:[]});await w.bidContract('K1');
    assert.equal(w.signs().length,0,'3: no signature');assert.equal(w.state.contractRegistry.K1.status,AWAIT);assert.match(w.notices[0].text,/بانتظار توقيعك/);}
  console.log('3 ok: no eligible company, no signature');

  // 4.
  {const w=world({won:false});await w.bidContract('K1');
    assert.equal(w.bids().length,1);assert.equal(w.bids()[0].payload.won,false);assert.equal(w.signs().length,0,'4: no signature');
    assert.deepEqual(w.reads,[],'4: a lost tender reads no eligibility');assert.match(w.notices[0].text,/لم يفز عرض المجموعة.*Rival One/,'4: the loss notice as before');}
  console.log('4 ok: a lost tender signs nothing');

  // 5.
  {const w=world({failBid:'command-queue-busy'});await w.bidContract('K1');
    assert.equal(w.signs().length,0,'5: no signature after a refused bid');assert.equal(w.state.contractRegistry.K1,undefined);
    assert.deepEqual(w.notices,[{text:'تعذر تسجيل نتيجة المناقصة: command-queue-busy',kind:'warning'}],'5: the refusal is shown');}
  console.log('5 ok: a refused bid signs nothing');

  // 6.
  {const w=world({failSign:'insufficient-company-cash'});await w.bidContract('K1');
    assert.equal(w.signs().length,1,'6: one attempt');assert.equal(w.state.contractRegistry.K1.status,AWAIT,'6: still awaiting its signature');assert.deepEqual(w.state.acceptedContracts,[]);
    assert.equal(w.notices.at(-1).text,'تعذر توقيع العقد: insufficient-company-cash','6: the refusal is shown');
    await w.bidContract('K1');assert.equal(w.bids().length,1,'6: a second tap on the tender bids no more');assert.equal(w.signs().length,1,'6: and signs nothing');
    assert.match(w.notices.at(-1).text,/فازت المجموعة بهذه المناقصة بالفعل/);
    assert.equal(await w.signContract('K1'),true,'6: «توقيع» later signs it');assert.equal(w.signs().length,2);assert.deepEqual(w.state.acceptedContracts,['K1']);}
  console.log('6 ok: a refused signature leaves the contract awaiting it');

  // 7.
  {const w=world();await w.bidContract('K1');await w.bidContract('K1');
    assert.equal(w.bids().length,1,'7: a signed tender is not bid on again');assert.equal(w.signs().length,1,'7: nor signed again');
    assert.match(w.alerts.at(-1),/موقّعة بالفعل/);}
  console.log('7 ok: no second bid or signature');

  // 8.
  {const w=world({afterBid:(state,payload)=>{state.contractRegistry[payload.id].status='نشط';state.acceptedContracts.push(payload.id);}});await w.bidContract('K1');
    assert.equal(w.signs().length,0,'8: a contract no longer awaiting is not signed again');}
  console.log('8 ok: the signature follows the bid\'s recorded state');

  // Source: one signature path, the button's, called after the bid's transaction and outside its try.
  {const tail=bidSource.slice(bidSource.indexOf("runAuthorizedDomainCommand('contracts','bid'"));
    assert.equal((bidSource.match(/runAuthorizedDomainCommand\('contracts','sign'/g)||[]).length,0,'source: bidContract sends no sign command of its own');
    assert.match(tail,/catch\(error\)\{notice\(`تعذر تسجيل نتيجة المناقصة: \$\{reasonText\(error\)\}`,'warning'\);return;\}if\(signer&&state\.contractRegistry\?\.\[id\]\?\.status==='بانتظار التوقيع'\)await signContract\(id,signer\);\}\s*$/,'source: signContract after the bid, guarded by the recorded status');
    assert.match(bidSource,/const eligibleSigners=won\?eligibleContractCompanyIds\(c\):\[\],signer=eligibleSigners\.length===1\?eligibleSigners\[0\]:null;/,'source: exactly one eligible company');}
  console.log('build690 ok');
})().catch(error=>{console.error(error);process.exit(1);});
