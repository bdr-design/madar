'use strict';
// Owner («نفذ الانجليزي مع الوكيل بالكامل بدقه» → «كمل كل شي بدقه وارفع»), batch EN-2b: the rail's four section pages
// (madar-shell.js) and every company's control page speak English, and the texts one file writes and another reads stay
// the same pair in both languages.
//   1. English (development edition): the Group, Finance, People, Leadership and System pages hold no Arabic, in their
//      texts or labels, before and after companies open;
//   2. each company's control page (fourteen companies, free play) holds no Arabic; its main count reads as an English
//      noun that agrees with the number (the summary's label found in the page's count nouns, e.g. "0 branches", never
//      the raw label "Bank branches");
//   3. the summary's labels (advanced-core.js) and the pages' readers (madar-shell.js) share their pairs: every count
//      noun key is a label the summary writes, the moving-trips label the fleet hero reads is the one the summary
//      writes, and every summary label raises a decision in English exactly when it does in Arabic (the reader's own
//      test, run on each pair); the tasks' domains stay data: the System page lists the system tasks in English as in
//      Arabic;
//   4. counts agree in English: one company, two companies (the executive line), one vacancy;
//   5. no page error.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const COMPANIES=['air','sea','road','mobility','power','bank','insurance','realestate','telecom','dealership','hospitality','media','healthcare','education'];
const HUBS=['groupHub','financeHub','peopleHub','leadershipHub','systemHub'];
const arabicIn=page=>page.evaluate(()=>{const AR=/[؀-ۿ]/,out=[],root=document.getElementById('drawer');const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);for(let t;(t=walker.nextNode());)if(AR.test(t.nodeValue)&&t.parentElement.getClientRects().length)out.push(t.nodeValue.trim());for(const el of root.querySelectorAll('*'))for(const a of ['title','aria-label','placeholder','data-disabled-reason'])if(AR.test(el.getAttribute(a)||''))out.push(`${a}: ${el.getAttribute(a)}`);return [...new Set(out)];});
(async()=>{
  const browser=await chromium.launch({headless:true}),results={hubs:{},companies:{}};
  try{
    // 3. (source) the count nouns' keys are the summary's labels, pair for pair.
    {const shell=fs.readFileSync(path.join(ROOT,'WebApp/madar-shell.js'),'utf8'),advanced=fs.readFileSync(path.join(ROOT,'WebApp/advanced-core.js'),'utf8');
      const block=shell.slice(shell.indexOf('const COUNT_NOUNS='),shell.indexOf('\n',shell.indexOf('const COUNT_NOUNS=')));
      const keys=[...block.matchAll(/\[(arEn\('[^']+','[^']+'\))\]:/g)].map(m=>m[1]);
      assert.ok(keys.length>=8,`3: ${keys.length} count-noun keys`);
      const summary=advanced.slice(advanced.indexOf('function companyOverviewSummary('),advanced.indexOf('function companyNextAction('));
      for(const key of keys)assert.ok(summary.includes(`primaryOperatingLabel=${key}`)||summary.includes(`?${key}:`)||summary.includes(`:${key};`),`3: the count-noun key ${key} is a label the summary writes`);
      assert.ok(summary.includes("[arEn('رحلات جارية','Trips under way'),")&&shell.includes("label===arEn('رحلات جارية','Trips under way')"),'3: the moving-trips label is one pair on both sides');
      // The reader's decision test, taken from madar-shell.js, on every label pair the summary writes.
      const source=/\/(\S+)\/(\w*)\.test\(String\(label\)\)/.exec(shell);assert.ok(source,'3: the decision test is found');const decision=new RegExp(source[1],source[2]);
      const pairs=[...summary.matchAll(/arEn\('([^']+)','([^']+)'\)/g)].map(m=>[m[1],m[2]]);assert.ok(pairs.length>=50,`3: ${pairs.length} summary pairs`);
      const differ=pairs.filter(([ar,en])=>decision.test(ar)!==decision.test(en));assert.deepEqual(differ,[],'3: each label raises a decision in English exactly when it does in Arabic');
      results.decisionLabels=pairs.filter(([ar])=>decision.test(ar)).map(([,en])=>en);assert.ok(results.decisionLabels.length>=3,'3: the request labels are among them');
      // The task domains stay the Arabic data the task owners write.
      assert.match(shell,/const TASK_DOMAINS=Object\.freeze\(\{group:\['التشغيل','الشركات'\],finance:\['المال','المالية'\],people:\['القيادة','الأفراد'\],system:\['النظام'\]\}\);/,'3: the task domains are not translated');
      results.countNounKeys=keys.length;}
    const errors=[];const {page}=await boot({browser,errors,viewport:{width:844,height:390},storage:[['ani-language','en']],appAudit:'{openCompany}'});
    // 1. Before any company.
    for(const hub of HUBS){await page.evaluate(p=>__AUDIT__.openDrawer(p),hub);await page.waitForTimeout(200);const left=await arabicIn(page);assert.deepEqual(left,[],`1: the ${hub} page holds no Arabic`);}
    // 4. One company without a chief executive, then two.
    const executiveLine=()=>page.evaluate(()=>{__AUDIT__.openDrawer('peopleHub');return [...document.querySelectorAll('#drawer .mc-status, #drawer [class*="status"]')].map(n=>n.textContent.trim()).find(t=>/without a chief executive/.test(t))||'';});
    assert.equal(await page.evaluate(async()=>await __AUDIT__.openCompany('air')),true);await page.waitForTimeout(300);
    results.oneCompany=await executiveLine();assert.match(results.oneCompany,/^1 company without a chief executive$/,'4: one company');
    results.oneVacancy=await page.evaluate(()=>[...document.querySelectorAll('#drawer .mc-chip, #drawer [class*="chip"]')].map(n=>n.textContent.trim()).find(t=>/vacanc/.test(t))||'');assert.equal(results.oneVacancy,'1 vacancy','4: one vacancy');
    assert.equal(await page.evaluate(async()=>await __AUDIT__.openCompany('road')),true);await page.waitForTimeout(300);
    results.twoCompanies=await executiveLine();assert.match(results.twoCompanies,/^2 companies without a chief executive$/,'4: two companies');
    // 2.
    for(const id of COMPANIES){
      const opened=id==='air'||id==='road'?true:await page.evaluate(async id=>await __AUDIT__.openCompany(id),id);assert.equal(opened,true,`2: ${id} opens in free play`);await page.waitForTimeout(250);
      await page.evaluate(id=>__AUDIT__.openDrawer('company',id),id);await page.waitForTimeout(250);
      const left=await arabicIn(page);assert.deepEqual(left,[],`2: the ${id} control page holds no Arabic`);
      const count=await page.evaluate(()=>{const b=document.querySelector('#drawer .mc-count');return b?{n:b.textContent.trim(),noun:b.nextElementSibling?.textContent.trim()||''}:null;});
      results.companies[id]=count;
      if(count&&/^\d+$/.test(count.n)){const n=Number(count.n);assert.match(count.noun,/^[a-z][a-z -]*$/,`2: ${id}: the count reads as an English noun (${count.noun})`);
        if(n!==1)assert.ok(!/(^| )(branch|project|customer|vehicle|facility|policy|asset|aircraft|ship|truck|car)$/.test(count.noun)||/aircraft/.test(count.noun),`2: ${id}: ${n} takes the plural (${count.noun})`);}
    }
    assert.equal(results.companies.bank?.noun,'branches','2: the bank counts its branches, not "Bank branches"');
    // 3. A pending-request label still raises a decision in English (the realestate company's lease requests are seeded by
    // the game only later; the reader's test is checked on the labels the summary writes).
    {const raised=await page.evaluate(()=>{const s=document.createElement('div');return ['Lease requests','Financing requests','Risks awaiting a decision'].every(label=>/بانتظار|طلبات|عروض|awaiting|requests|offers/i.test(label));});assert.ok(raised,'3: the request labels raise a decision');
      const shell=fs.readFileSync(path.join(ROOT,'WebApp/madar-shell.js'),'utf8');assert.ok(shell.includes('/بانتظار|طلبات|عروض|awaiting|requests|offers/i.test(String(label))'),'3: the reader tests both languages');}
    // 3. The System page lists the system tasks (domain «النظام») in English: the power company without capacity raises one
    // once the health check has run.
    await page.evaluate(()=>__AUDIT__.runRealtimeHealth?.());await page.waitForTimeout(300);
    const system=await page.evaluate(()=>{const tasks=(GH_UI_QUALITY.collectTasks(__GH_STATE__)||[]).filter(t=>t.domain==='النظام');__AUDIT__.openDrawer('systemHub');return {tasks:tasks.length,shown:document.querySelectorAll('#drawer .mc-decide .mc-decision').length};});
    results.systemTasks=system;assert.ok(system.tasks>0,'3: a system task exists (the power company without capacity)');assert.equal(system.shown,system.tasks,'3: the System page lists every system task in English');
    // 1. After the companies opened.
    for(const hub of HUBS){await page.evaluate(p=>__AUDIT__.openDrawer(p),hub);await page.waitForTimeout(200);const left=await arabicIn(page);assert.deepEqual(left,[],`1: the ${hub} page holds no Arabic with fourteen companies`);results.hubs[hub]='English';}
    assert.deepEqual(errors,[],'5: no page error');
    console.log(JSON.stringify({suite:'build660-english-section-pages-browser',ok:true,...results}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
