'use strict';
// The conference showed the group's employees as the holding's own staff only (0 when the holding hires no one) beside a
// people chapter of 132,000. The snapshot now records everyone the group employs, and every group-level count reads it.
// Proven on the real conference owner and board (business scenario, an airline with staff and one holding executive):
//  1. the snapshot keeps the holding's own staff in group.headcount and records group.totalHeadcount = holding + companies;
//  2. the group summary and the people chapter show that total, and the people chart still lists the holding's staff;
//  3. a snapshot archived before the field existed shows the same total (the holding's staff plus the companies');
//  4. the previous source, restored in memory, showed the holding's staff alone as the group's employees.
const assert=require('node:assert/strict'),path=require('node:path'),vm=require('node:vm'),{execFileSync}=require('node:child_process');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');process.env.GH_TEST_SOURCE_DIR=ROOT;
const {scenario}=require('./helpers/business-scenario.js');
const previous=file=>execFileSync('git',['-C',process.env.GH_CONFERENCE_GIT_DIR||ROOT,'show',`11fce99:WebApp/${file}`],{encoding:'utf8',maxBuffer:16*1024*1024});

function world(sources=null){
  const env=scenario(),{s,state}=env;env.load('arabic-copy-core');
  for(const name of ['conference-model','conference-board','conference-core']){if(sources)vm.runInContext(sources[name],s,{filename:`${name}.js`});else env.load(name);}
  env.manualPurchase(3);
  // One holding executive and an airline facility crew of 40, as the HR owner stores employment contracts.
  s.GH_HR_CORE.ensure(state).employmentContracts.push({id:'QA-HOLDING-CFO',status:'ساري',company:'group',role:'المدير المالي',salary:240000},{id:'QA-AIR-STAFF',status:'ساري',company:'air',role:'تشغيل منشأة',count:40,salary:5000});
  const snapshot=s.GH_CONFERENCE.buildSnapshot(state,2026,'global');
  const plan=s.GH_CONF_MODEL.buildPlanBundle(snapshot,{conferenceId:'QA',createdAt:1}),scenes=s.GH_CONF_MODEL.scenesForPlan(plan,'full');
  const doc=(snap,scene)=>s.GH_CONF_BOARD.documentFor(snap,scene);
  return {s,snapshot,scenes,doc,groupFinance:scenes.find(scene=>scene.kind==='finance'&&scene.type==='group'),people:scenes.find(scene=>scene.id==='people')};
}
(()=>{
  const out={};
  {const w=world(),g=w.snapshot.group,companies=w.snapshot.companies.reduce((n,c)=>n+c.headcount,0);
    assert.equal(g.headcount,1,'1: the holding\'s own staff stays in group.headcount');assert(companies>=40,`the airline employs its staff (${companies})`);
    assert.equal(g.totalHeadcount,1+companies,'1: group.totalHeadcount is the holding plus its companies');
    assert(w.groupFinance&&w.people,'the plan has the group results and people chapters');
    const summary=w.doc(w.snapshot,w.groupFinance).summary;assert.equal(summary.group,true);assert.equal(summary.groupHeadcount,g.totalHeadcount,'2: the group summary shows everyone the group employs');
    const people=w.doc(w.snapshot,w.people);assert.equal(people.title,g.totalHeadcount.toLocaleString('en-US'),`2: the people chapter shows the same total (${people.title})`);
    assert.equal(people.series.find(row=>row.label==='الإدارة القابضة')?.value,1,'2: the chart lists the holding\'s staff');assert.equal(people.series.reduce((n,row)=>n+row.value,0),g.totalHeadcount,'2: and adds up to the total');
    const archived=JSON.parse(JSON.stringify(w.snapshot));delete archived.group.totalHeadcount;
    assert.equal(w.doc(archived,w.groupFinance).summary.groupHeadcount,g.totalHeadcount,'3: an archived snapshot shows the same total');
    assert.equal(w.doc(archived,w.people).title,people.title,'3: in its people chapter too');
    out.current={holding:g.headcount,companies,total:g.totalHeadcount};}
  {const sources=Object.fromEntries(['conference-model','conference-board','conference-core'].map(name=>[name,previous(`${name}.js`)]));
    const w=world(sources),g=w.snapshot.group;assert.equal('totalHeadcount' in g,false,'4: the previous snapshot had no total');
    const shown=w.doc(w.snapshot,w.groupFinance).summary.groupHeadcount,people=w.doc(w.snapshot,w.people).title;
    assert.equal(shown,1,'4: the previous group summary showed the holding\'s staff alone');assert.notEqual(String(shown),people.replace(/,/g,''),'4: against a larger people chapter');
    out.previous={groupSummary:shown,people};}
  console.log(JSON.stringify({suite:'build538-conference-group-headcount',ok:true,...out}));
})();
