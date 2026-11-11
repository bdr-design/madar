'use strict';
// Build 681: what the review of the shipped play-through fixes (a505460) found, proved without a page:
//   1. «ذمة» is counted in every category («حُصلت 3 ذمم», not «3 ذمة»), and has its English forms;
//   2. the count of each alert's text keeps the texts last written, not the first written: a refusal repeated through a
//      long session (128 other texts written since it was first written) is still counted, so its next repeat is shown;
//   3. «تعيين الجميع»: a manager whose contract has ended manages no company; the company they left takes the candidate
//      it would take if it had never had a manager (the ended contract's row excluded its holder from every company);
//   4. the page texts: the vacancy chip («شاغران», «3 شواغر», «11 شاغرًا»), one company «بعقد مستقل», nobody appointed is
//      a warning with no «حُفظت العقود», a partial «فتح جميع الشركات» is labelled as partial, a bid on a tender whose
//      contract is registered is refused before the award is drawn, a burst that pushes the list as last read off the
//      list still shows its newest alerts, and a recovery resets the strip's cursor.
const path=require('node:path'),fs=require('node:fs');
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const assert=require('node:assert/strict');
const {scenario}=require('./helpers/business-scenario'),{harness}=require('./helpers/core-harness');
const ROOT=process.env.GH_TEST_SOURCE_DIR,source=name=>fs.readFileSync(path.join(ROOT,'WebApp',name),'utf8');

// 1.
{const h=harness([]);h.load('arabic-copy-core');const A=h.s.GH_ARABIC_COPY;
  assert.deepEqual([0,1,2,3,10,11,99,100,101].map(n=>A.count(n,'receivable')),['لا ذمم','ذمة واحدة','ذمتان','3 ذمم','10 ذمم','11 ذمةً','99 ذمةً','100 ذمة','101 ذمة'],'1: ذمة');
  assert.equal(A.count(2,'receivable',{oblique:true}),'ذمتين','1: the governed dual');assert.deepEqual(Array.from(A.FORMS_EN.receivable),['receivable','receivables'],'1: in English');
  const app=source('app.js');assert.ok(app.includes("`حُصلت ${countText(result.count,'receivable')} بقيمة "),'1: the collection notice counts them');assert.ok(!/\$\{fmtNumber\(result\.count\)\} ذمة/.test(app),'1: and no longer writes the fixed noun');}
console.log('1 ok: «ذمة» is counted in every category');

// 2.
{const {s,state}=scenario(),O=s.GH_OPERATIONS_CORE,write=text=>O.execute({state},'record-alert',{text,type:'operation'}),refusal='لا يمكن السداد: لا دين على القابضة.';
  const base=O.alertWrites(refusal);write(refusal);for(let index=0;index<130;index++){write(`نتيجة ${index}.`);write(refusal);}
  assert.equal(O.alertWrites(refusal)-base,131,'2: a text written again and again is counted through 130 other texts');
  // A text not written again is the one dropped: the count stays bounded.
  write('نص قديم.');for(let index=0;index<128;index++)write(`نتيجة أخرى ${index}.`);assert.equal(O.alertWrites('نص قديم.'),0,'2: the text least recently written is dropped');assert.equal(O.alertWrites('نتيجة أخرى 127.'),1);
  assert.equal(state.alerts.length,40,'2: the list keeps forty');}
console.log('2 ok: the per-text count keeps the texts last written');

// 3.
{const w=scenario(),{s,state,command}=w,H=s.GH_HR_CORE;state.godMoney=true;state.infiniteMoney=true;
  for(const definition of s.GH_COMPANY_DEFINITIONS.list()){if(definition.id==='group'||state.openedCompanies.includes(definition.id))continue;command('corporate','open-company',{type:definition.id,capital:400000000,legalName:`Test ${definition.id}`});}
  const strongest=company=>H.officialManagerCandidates(state,company).slice().sort((a,b)=>b.skill-a.skill||b.experience-a.experience||a.salary-b.salary||String(a.id).localeCompare(String(b.id)));
  const first=command('hr','appoint-all-official-managers',{termMonths:12});assert.equal(first.appointed,state.openedCompanies.length,'3: every company has its manager');
  // The company whose manager is the strongest candidate of their own company: after their contract ends they are the one
  // that company would take again.
  const companies=Array.from(state.openedCompanies),left=companies.find(company=>{const row=H.officialManager(state,company);return row&&strongest(company)[0].id===row.candidateId;});assert.ok(left,'3: a company managed by its strongest candidate');
  const before=H.officialManager(state,left),contracts=state.advanced.labor.employmentContracts||[];const contract=contracts.find(row=>row.id===before.contractId);assert.ok(contract,'3: the manager\'s contract');
  contract.status='منتهي';
  const again=command('hr','appoint-all-official-managers',{termMonths:12});assert.deepEqual({appointed:again.appointed,skipped:again.skipped},{appointed:1,skipped:companies.length-1},'3: the company they left alone is filled');
  const now=H.officialManager(state,left),others=new Set(companies.filter(company=>company!==left).map(company=>H.officialManager(state,company)?.name).filter(Boolean)),expected=strongest(left).find(row=>!others.has(row.name));
  assert.equal(now.candidateId,expected.id,'3: by the strongest candidate who manages no other company');assert.equal(now.name,before.name,'3: here the person whose contract ended, appointed again');
  assert.equal(new Set(companies.map(company=>H.officialManager(state,company).name)).size,companies.length,'3: each company keeps a person of its own');assert.equal(s.GH_SAVE_SCHEMA.validate(state).ok,true,'3: the state is valid');}
console.log('3 ok: a manager whose contract ended manages no company');

// 4.
{const shell=source('madar-shell.js'),app=source('app.js'),advanced=source('advanced-core.js');
  assert.ok(shell.includes("vacant===2?arEn('شاغران','Two vacancies'):vacant%100>=3&&vacant%100<=10?arEn(`${num(vacant)} شواغر`,`${num(vacant)} vacancies`):vacant%100>=11?arEn(`${num(vacant)} شاغرًا`,`${num(vacant)} vacancies`):arEn(`${num(vacant)} شاغر`,`${num(vacant)} vacancies`)"),'4: the vacancy chip is counted');
  assert.ok(app.includes("${result.count===1?'بعقد مستقل':'بعقود مستقلة'}"),'4: one company, one contract');
  assert.ok(advanced.includes(".${result.appointed?' حُفظت العقود في عملية واحدة.':''}`,kind:result.appointed?'success':'warning'"),'4: nobody appointed is a warning and saves no contract');
  assert.ok(app.includes("title:left.length?'اعتماد فتح الشركات التي يغطيها الرصيد':types.length<unopened.length?'اعتماد فتح الشركات المتاحة':'اعتماد فتح جميع الشركات',accept:left.length?'توقيع العقود وفتح المغطّاة':types.length<unopened.length?'توقيع العقود وفتح المتاحة':'توقيع العقود وفتح الجميع'"),'4: a partial opening, by the balance or by the level, is labelled as partial');
  for(const text of ["`أُصدر ${countText(result.count,'cheque')} بقيمة ","`صُرف ${countText(result.count,'cheque')} بقيمة ","`؛ بقي ${countText(result.skipped,'cheque')} (","${result.count===1?'بتحويل بنكي':'بتحويلات بنكية'}"])assert.ok(app.includes(text),`4: counted: ${text}`);assert.ok(!/\$\{fmtNumber\(result\.(?:count|skipped)\)\} (?:شيكات|شيكًا)/.test(app),'4: no cheque count with a fixed noun');
  const bid=app.slice(app.indexOf('async function bidContract(id){')),guard=bid.indexOf("if(state.contractRegistry?.[id]){notice(reasonText({message:'tender-closed'}),'warning');return;}"),roll=bid.indexOf('simRandom('),won=bid.indexOf("if(state.contractRegistry?.[id]?.status==='بانتظار التوقيع')");
  assert.ok(guard>0&&roll>guard&&guard<bid.indexOf('\n'),'4: a registered contract\'s tender is refused before the award is drawn');assert.ok(won>0&&won<guard,'4: after the tender won and awaiting its signature is said to be so (the core\'s order)');
  assert.ok(app.includes('if(fresh<0&&written>0){fresh=alerts.length;for(let offset=Math.max(1,alerts.length-head.length+1);offset<alerts.length;offset++)if(same(offset)){fresh=offset;break;}}\n    mark();if(fresh<=0)return 0;'),'4: a burst that leaves no place for the list as last read is new up to that list\'s cut start');
  assert.ok(app.includes('if(recovered.ok){replaceLiveState(recovered.state);resetAlertCursor();'),'4: a recovery resets the strip\'s cursor');
  assert.ok(/band&&band\.room<=0\?' disabled':''/.test(app)&&app.includes('`بلغت الشركة سقف مستواك: تملك ${fmtNumber(band.held)} والسقف ${fmtNumber(band.limit)}. ارفع المستوى لشراء المزيد.`'),'4: at the level\'s ceiling the market says so');}
console.log('4 ok: the page texts');
console.log('BUILD681_REVIEW_LEFTOVERS_PASS');
