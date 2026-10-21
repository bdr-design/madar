'use strict';
// The investor card adds no weight to the game (owner: «اهم شي لاثقل على اللعبة اختبارات صارمة جدًا لمعرفة اي اسباب
// ثقل»). Measured on the real finance, document proof and identity owners, the same world on this source and on the
// source before the card (run from its own tree, in its own process), 400 payments that need money and 400 that do not:
//  1. a funded payment writes exactly what it wrote before: as many signed documents, transfers, treasury and company
//     ledger rows and journal entries, and no more bytes in the save;
//  2. a payment that needs no money writes and costs the same with investor mode on as before;
//  3. the card itself stays bounded: after 5,000 charges over 400 days and 11 companies it holds at most 50 statement
//     rows and one total per company (under 12 KB);
//  4. the earlier mode's transfers are read once: with the card in use, the page's plan does not read the transfers,
//     even with 50,000 of them;
//  5. time per funded payment is within the old time (median, with a margin for timer noise).
// Desktop Node timings; not iPhone performance.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'),SOURCE=process.env.GH_TEST_SOURCE_DIR||ROOT,PREVIOUS='65ee1eb';
if(process.argv[2]==='--measure'){
 process.env.GH_TEST_SOURCE_DIR=process.argv[3];const {harness}=require('./helpers/core-harness');
 const {s:G}=harness(['capability-registry-core','company-definitions','company-platform-core','identity-system','control-plane-core','document-proof-core','finance-core']),F=G.GH_FINANCE_CORE;
 let seals=0;const proof=G.GH_DOCUMENT_PROOF;G.GH_DOCUMENT_PROOF={...proof,sealDocument(...args){seals++;return proof.sealDocument(...args);}};
 const types=['air','sea','road','power','bank','mobility','insurance','realestate','telecom','dealership','hospitality'];
 const world=()=>{const m=G.GH_COMPANY_PLATFORM.migrateState({simSeconds:86400,openedCompanies:types,profile:{name:'فنتورا القابضة',founder:'سالم'},hired:[],assets:[],globalBases:[],customHubs:[],branches:[],bank:{branches:1},energy:{},mobility:{vehicles:[]},companyRegistry:{}});const s=m.state;F.ensure(s);for(const t of types)F.book(s,t).accounts[0].balance=1000000;F.reconcile(s);s.godMoney=true;s.infiniteMoney=true;return s;};
 const counts=s=>({seals,transfers:s.finance.transfers.length,ledger:s.treasury.ledger.length+types.reduce((n,t)=>n+F.book(s,t).ledger.length,0),journal:s.finance.journalEntries.length});
 const bytes=s=>{const copy=JSON.parse(JSON.stringify(s));delete copy.finance.investorCard;return JSON.stringify(copy).length;};
 const run=(s,n,need)=>{const times=[],before=counts(s),b0=bytes(s);for(let i=0;i<n;i++){const t=types[i%types.length];if(i%types.length===0)s.simSeconds+=86400;const amount=need?F.operating(s,t)+1000:1000;const t0=process.hrtime.bigint();F.execute({state:s},'spend',{company:t,amount,note:'تشغيل',line:'other'});times.push(Number(process.hrtime.bigint()-t0)/1e6);}
  times.sort((a,b)=>a-b);const after=counts(s);return {median:times[Math.floor(n/2)],p95:times[Math.floor(n*.95)],seals:after.seals-before.seals,transfers:after.transfers-before.transfers,ledger:after.ledger-before.ledger,journal:after.journal-before.journal,bytes:bytes(s)-b0};};
 // Each case on its own world, below the treasury ledger's 1,200-row window (rows leaving it would skew the bytes).
 const s=world();run(s,60,true);const funded=run(s,400,true),plainWorld=world(),plain=run(plainWorld,400,false);
 const out={funded,plain,card:s.finance.investorCard?JSON.stringify(s.finance.investorCard).length:null};
 if(typeof F.investorCardReturnPlan==='function'){
  const big=world();for(let i=0;i<5000;i++){const t=types[i%types.length];if(i%13===0)big.simSeconds+=86400;F.execute({state:big},'spend',{company:t,amount:F.operating(big,t)+1,note:['رواتب','مصروف','صرف شيك'][i%3],line:'other'});}
  out.bounded={rows:big.finance.investorCard.rows.length,companies:Object.keys(big.finance.investorCard.charged).length,bytes:JSON.stringify(big.finance.investorCard).length};
  const legacy=world();for(let i=0;i<50000;i++)legacy.finance.transfers.push({id:`GOD-1-${i}`,reference:`GOD-1-${i}`,kind:'founder-investment',fundingSource:i%2?'god-mode-founder':'',company:types[i%types.length],amount:10});
  let reads=0;const rows=legacy.finance.transfers;legacy.finance.transfers=new Proxy(rows,{get(target,key,receiver){if(key===Symbol.iterator)reads++;return Reflect.get(target,key,receiver);}});
  F.investorCardReturnPlan(legacy);const firstReads=reads;const airBefore=F.operating(legacy,'air');F.execute({state:legacy},'spend',{company:'air',amount:airBefore+1,note:'تشغيل',line:'other'});const charge=legacy.finance.transfers.find(x=>x.fundingSource==='investor-card').amount;reads=0;const t0=process.hrtime.bigint();F.investorCardReturnPlan(legacy);out.plan={firstReads,laterReads:reads,ms:Number(process.hrtime.bigint()-t0)/1e6,legacy:legacy.finance.investorCard.charged.air-charge,expectedLegacy:rows.filter(x=>x.fundingSource==='god-mode-founder'&&x.company==='air').length*10};
 }
 process.stdout.write(JSON.stringify(out));process.exit(0);
}
const measure=root=>JSON.parse(execFileSync(process.execPath,[__filename,'--measure',root],{encoding:'utf8',maxBuffer:1<<26}));
const tree=fs.mkdtempSync(path.join(os.tmpdir(),'b557-'));
try{execFileSync('sh',['-c',`git -C "${ROOT}" archive ${PREVIOUS} WebApp | tar -x -C "${tree}"`]);
 // Timer noise: three runs of each source, alternated; the counts are the first run's, the times the fastest median.
 const runs={now:[],before:[]};for(let i=0;i<3;i++){runs.now.push(measure(SOURCE));runs.before.push(measure(tree));}
 const fastest=(rows,key)=>({...rows[0][key],median:Math.min(...rows.map(row=>row[key].median)),p95:Math.min(...rows.map(row=>row[key].p95))});
 const now={...runs.now[0],funded:fastest(runs.now,'funded'),plain:fastest(runs.now,'plain')},before={...runs.before[0],funded:fastest(runs.before,'funded'),plain:fastest(runs.before,'plain')};
 for(const key of ['seals','transfers','ledger','journal','bytes'])for(const side of ['now','before'])assert(runs[side].every(row=>row.funded[key]===runs[side][0].funded[key]&&row.plain[key]===runs[side][0].plain[key]),`the ${side} counts repeat exactly (${key})`);
 // 1
 for(const key of ['seals','transfers','ledger','journal'])assert.equal(now.funded[key],before.funded[key],`1: ${key} per 400 funded payments (${now.funded[key]} vs ${before.funded[key]})`);
 assert(now.funded.bytes<=before.funded.bytes,`1: no more bytes in the save (${now.funded.bytes} vs ${before.funded.bytes})`);
 // 2
 for(const key of ['seals','transfers','ledger','journal','bytes'])assert.equal(now.plain[key],before.plain[key],`2: ${key} for payments that need no money`);
 assert(now.plain.median<=before.plain.median*1.35+.05,`2: time for payments that need no money (${now.plain.median.toFixed(3)} vs ${before.plain.median.toFixed(3)} ms)`);
 // 3
 assert(now.bounded.rows<=50&&now.bounded.companies<=11&&now.bounded.bytes<12000,`3: the card stays bounded (${JSON.stringify(now.bounded)})`);
 // 4
 assert(now.plan.firstReads>=1&&now.plan.laterReads===0,`4: the transfers are read once (${JSON.stringify(now.plan)})`);assert.equal(now.plan.legacy,now.plan.expectedLegacy,'4: and counted in full');
 // 5
 assert(now.funded.median<=before.funded.median*1.35+.05,`5: time per funded payment (${now.funded.median.toFixed(3)} vs ${before.funded.median.toFixed(3)} ms)`);
 console.log(JSON.stringify({suite:'build557-investor-card-load',ok:true,environment:'Node desktop; not iPhone performance',now,before}));
}finally{fs.rmSync(tree,{recursive:true,force:true});}
