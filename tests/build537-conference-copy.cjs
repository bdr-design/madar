'use strict';
// The conference must read as a real corporate event: no wording that calls it a simulation or a game. Proven on the real
// conference owner, plan model and slides (business scenario):
//  1. a prepared conference stores no vendor "simulation" notice, and its preparation page and the monthly report say
//     nothing of a simulation or a game (the notice an older save stored is not shown either);
//  2. a new plan's audience chapter, and the slides of the audience and a company's financial chapters, carry no such words;
//  3. a plan archived with the old wording keeps its stored text and hash (it still validates), while the scenes shown
//     from it use the current wording;
//  4. the previous source, restored in memory, showed that wording on the page, the plan and its board.
const assert=require('node:assert/strict'),path=require('node:path'),vm=require('node:vm'),{execFileSync}=require('node:child_process');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');process.env.GH_TEST_SOURCE_DIR=ROOT;
const {scenario}=require('./helpers/business-scenario.js');
const WORDS=/محاك|لعبة/;
const previous=file=>execFileSync('git',['-C',process.env.GH_CONFERENCE_GIT_DIR||ROOT,'show',`0b056e2:WebApp/${file}`],{encoding:'utf8',maxBuffer:16*1024*1024});

function world(sources=null){
  const env=scenario(),{s,state,command}=env;env.load('arabic-copy-core');
  for(const name of sources?['conference-model','conference-board','conference-core']:['conference-model','conference-keynote','conference-core']){if(sources)vm.runInContext(sources[name],s,{filename:`${name}.js`});else env.load(name);}
  state.simSeconds=365*86400;s.GH_CONFERENCE.execute({state},'tick-day',{day:365});command('conference','prepare',{year:2026,packageId:'executive'});
  const ctx={state,esc:value=>String(value??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])),fmtMoney:value=>String(value),fmtNumber:value=>String(value),fmtInt:value=>String(value)};
  return {s,state,command,ctx,page:arg=>s.GH_CONFERENCE.render(ctx,arg)};
}
function chapters(w){
  const row=w.state.advanced.conference.current,bundle=row.presentation.planBundle,scenes=w.s.GH_CONF_MODEL.scenesForPlan(bundle,'full');
  const pick=id=>scenes.find(scene=>scene.id===id),financial=scenes.find(scene=>/-financial$/.test(scene.id));
  return {row,bundle,scenes,audience:pick('audience'),financial,doc:scene=>JSON.stringify(w.s.GH_CONF_KEYNOTE?w.s.GH_CONF_KEYNOTE.slides(row.snapshot,scenes).filter(slide=>slide.sceneId===scene.id||scene.type&&scene.type!=='group'&&slide.type===scene.type):w.s.GH_CONF_BOARD.documentFor(row.snapshot,scene))};
}
(()=>{
  const out={};
  // 1 and 2: the current source.
  {const w=world(),current=w.state.advanced.conference.current;
    assert.equal('simulationVendorNotice' in current,false,'1: a prepared conference stores no simulation notice');
    const overview=w.page('overview');assert(overview.includes('conference-start')||overview.length>500,'the preparation page rendered');assert(!WORDS.test(overview),'1: the preparation page');
    current.simulationVendorNotice='أسماء الموردين حقيقية؛ التعاقد والأسعار داخل هذه اللعبة محاكاة فقط.';assert(!WORDS.test(w.page('overview')),'1: the notice an older save stored is not shown');delete current.simulationVendorNotice;
    const monthly=w.page('monthly');assert(monthly.includes('التقرير التنفيذي الشهري'),'the monthly report rendered');assert(!WORDS.test(monthly),'1: the monthly report');
    w.command('conference','start',{});const c=chapters(w);
    assert(c.audience&&c.financial,'the plan has audience and financial chapters');
    assert(!WORDS.test(`${c.audience.subtitle} ${c.audience.caption}`),`2: the audience chapter (${c.audience.subtitle} / ${c.audience.caption})`);
    assert(!WORDS.test(JSON.stringify(c.bundle)),'2: nothing in the stored plan');
    for(const scene of [c.audience,c.financial])assert(!WORDS.test(c.doc(scene)),`2: the slides of ${scene.id}`);
    // 3: a plan archived with the old wording.
    const legacyModel=previous('conference-model.js'),model=w.s.GH_CONF_MODEL;vm.runInContext(legacyModel,w.s,{filename:'conference-model-previous.js'});
    const legacy=w.s.GH_CONF_MODEL.buildPlanBundle(c.row.snapshot,{conferenceId:c.row.id,createdAt:1});w.s.GH_CONF_MODEL=model;
    const stored=JSON.stringify(legacy);assert(WORDS.test(stored),'the archived plan holds the old wording');
    assert.equal(model.validatePlanBundle(legacy,c.row.snapshot),true,'3: the archived plan still validates (text and hash untouched)');
    const shown=model.scenesForPlan(legacy,'full'),audience=shown.find(scene=>scene.id==='audience');
    assert.equal(JSON.stringify(legacy),stored,'3: showing it does not change the stored plan');
    assert(!WORDS.test(`${audience.subtitle} ${audience.caption}`),'3: the archived audience chapter is shown with the current wording');
    assert(!WORDS.test(c.doc(audience)),'3: and so are its slides');
    assert.deepEqual(shown.map(scene=>scene.id),legacy.modes.full.map(scene=>scene.id),'3: the chapters and their order are the archived ones');
    out.current={chapters:c.scenes.length,legacyChapters:shown.length};}
  // 4: the previous source.
  {const sources=Object.fromEntries(['conference-model','conference-board','conference-core'].map(name=>[name,previous(`${name}.js`)]));
    const w=world(sources);assert('simulationVendorNotice' in w.state.advanced.conference.current,'4: the previous source stored the notice');
    assert(WORDS.test(w.page('overview')),'4: and showed it on the preparation page');assert(WORDS.test(w.page('monthly')),'4: and in the monthly report');
    w.command('conference','start',{});const c=chapters(w);assert(WORDS.test(`${c.audience.subtitle} ${c.audience.caption}`),'4: and in the audience chapter');assert(WORDS.test(c.doc(c.audience)),'4: and on its board');
    out.previous={notice:true};}
  console.log(JSON.stringify({suite:'build537-conference-copy',ok:true,...out}));
})();
