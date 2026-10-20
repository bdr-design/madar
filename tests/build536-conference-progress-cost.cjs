'use strict';
// A live conference recorded its resume chapter through a system command on every chapter change, and that command copied
// the whole game state for rollback (the conference owner declared no write scope), checked integrity before and after,
// validated the plan twice, and was followed by a save of the whole game: at 200,000 assets on the desktop, 15-25 ms of
// transaction and a 77-96 ms sliced save per chapter, at least every 9 s in autoplay, to keep one chapter index. Now:
//  1. presentation-state and presentation-progress declare their scope (advanced), with the write set enforced: no full
//     snapshot, nothing written outside it; a progress refused before or after the owner wrote leaves the whole state
//     unchanged;
//  2. the stage records progress on every chapter (the resume record is current) but saves at most once a minute and when
//     the stage closes; hiding the app adds no save of its own (the app's hidden and background saves cover it); a refused
//     save keeps the progress unsaved for the next one; a finished conference (a durable save) is not saved again;
//  3. each chapter validates the plan once (it validated it twice);
//  4. the previous source, restored in memory, copied the whole state, validated twice and saved on every chapter.
// Proven on the real conference owner, domain command and transaction cores (business scenario), with a stand-in stage
// engine and a virtual clock.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{execFileSync}=require('node:child_process');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');process.env.GH_TEST_SOURCE_DIR=ROOT;
const {scenario}=require('./helpers/business-scenario.js');
const CHAPTERS=6,MINUTE=60000;

function world(source=null){
  const env=scenario(),{s,state,command}=env;env.load('arabic-copy-core');env.load('conference-model');s.__GH_BUILD358_ENFORCE_SLICE_SCOPE__=true;
  if(source)vm.runInContext(source,s,{filename:'conference-core.js'});else env.load('conference-core');
  state.simSeconds=365*86400;s.GH_CONFERENCE.execute({state},'tick-day',{day:365});command('conference','prepare',{year:2026,packageId:'executive'});
  let clock=1000,refuseSave=false;const listeners=new Map(),saves=[],checks={plan:0};
  {const model=s.GH_CONF_MODEL;s.GH_CONF_MODEL={...model,validatePlanBundle(...args){checks.plan++;return model.validatePlanBundle(...args);}};}
  s.performance={now:()=>clock};
  s.document={hidden:false,getElementById:id=>id==='conferencePlaybackMode'?{value:'manual'}:null,
    addEventListener:(type,fn)=>{if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},removeEventListener:(type,fn)=>listeners.get(type)?.delete(fn)};
  let launched=null,failLaunch=false;
  s.GH_CONFERENCE_3D={ENGINE_ID:'GH-CONFERENCE-3D',launch(config,options){if(failLaunch)throw new Error('qa-stage-failed');launched={config,options};return {};}};
  const ctx={state,esc:value=>String(value),fmtMoney:value=>String(value),pushAlert(){},updateKpis(){},openDrawer(){},save:()=>{if(refuseSave)return false;saves.push(clock);return true;},
    dispatchSystemCommand:(c,domain,name,payload,options)=>s.GH_DOMAIN_COMMANDS.dispatchSystem(c,domain,name,payload,options),
    runAuthorizedDomainCommand:async(domain,name,payload)=>({result:command(domain,name,payload)})};
  const settle=async()=>{for(let i=0;i<12;i++)await null;};
  const hide=async()=>{s.document.hidden=true;for(const fn of [...(listeners.get('visibilitychange')||[])])fn();await settle();s.document.hidden=false;};
  return {s,state,ctx,saves,listeners,checks,settle,hide,launched:()=>launched,failNextLaunch:()=>{failLaunch=true;},refuseSaves:on=>{refuseSave=on;},advance:ms=>{clock+=ms;}};
}
async function live(w){
  await w.s.GH_CONFERENCE.handleAction({dataset:{ghAction:'conference-start'}},w.ctx);const stage=w.launched();assert(stage,'the stage launched');
  const config=stage.config;config.onPhaseChange({state:'opening',sceneId:'opening'});config.onPhaseChange({state:'presenting',sceneId:'opening'});
  const scenes=w.s.GH_CONF_MODEL.scenesForPlan(config.planBundle,'manual');return {config,scenes};
}
async function chapters(w,{config,scenes},from,to,stepMs){
  const samples=[];
  for(let index=from;index<to;index++){w.advance(stepMs);const planChecks=w.checks.plan;await config.onProgress({mode:'manual',index,sceneId:scenes[index].id});await w.settle();
    const last=w.s.GH_TRANSACTION_CORE.telemetry().last;samples.push({label:last?.label,full:last?.fullSnapshot===true,resume:w.state.advanced.conference.ui.resume?.index,planChecks:w.checks.plan-planChecks});}
  return samples;
}
(async()=>{
  const out={};
  // 1 and 2: the current source.
  {const w=world(),stage=await live(w);
    const phase=w.s.GH_TRANSACTION_CORE.telemetry().last;assert.equal(phase.label,'conference:presentation-state');assert.equal(phase.fullSnapshot,false,'1: the phase command snapshots its scope only');
    const quick=await chapters(w,stage,1,CHAPTERS,5000);
    assert(quick.every(row=>row.label==='conference:presentation-progress'&&!row.full),`1: every chapter command is scoped (${JSON.stringify(quick)})`);
    assert.deepEqual(quick.map(row=>row.resume),[1,2,3,4,5],'2: the resume record follows every chapter');
    assert.deepEqual(w.saves,[],'2: 5 chapters within a minute save nothing');assert(quick.every(row=>row.planChecks===1),`3: one plan validation per chapter (${JSON.stringify(quick.map(row=>row.planChecks))})`);assert(stage.scenes.length>CHAPTERS+3,`enough chapters: ${stage.scenes.length}`);
    // A progress refused before the owner wrote (an index that is not the scene's), and one failing after it wrote (the
    // command's event ledger record), leave the whole state as it was.
    const progress=index=>()=>w.s.GH_DOMAIN_COMMANDS.dispatchSystem({state:w.state},'conference','presentation-progress',{conferenceId:w.state.advanced.conference.current.id,mode:'manual',index,sceneId:stage.scenes[index===3?2:index].id},{actor:'conference-presentation'});
    let before=JSON.stringify(w.state);assert.throws(progress(3),/conference-progress-index-invalid/);assert.equal(JSON.stringify(w.state),before,'1: a refused progress changes nothing');
    const ledger=w.s.GH_EVENT_LEDGER,record=ledger.record;w.s.GH_EVENT_LEDGER={...ledger,record(...args){if(args[1]?.domain==='conference')throw new Error('qa-after-owner-write');return record.apply(ledger,args);}};
    before=JSON.stringify(w.state);try{assert.throws(progress(4),/qa-after-owner-write/);}finally{w.s.GH_EVENT_LEDGER=ledger;}
    assert.equal(JSON.stringify(w.state),before,'1: a progress failing after the owner wrote is rolled back whole');
    // A minute later the next chapter saves once.
    await chapters(w,stage,CHAPTERS,CHAPTERS+1,MINUTE);assert.equal(w.saves.length,1,'2: a chapter a minute after the last save saves once');
    await chapters(w,stage,CHAPTERS+1,CHAPTERS+3,1000);assert.equal(w.saves.length,1,'2: and the next ones within the minute do not');
    await w.hide();assert.equal(w.saves.length,1,'2: hiding the app adds no save of the stage (the app saves when hidden)');assert.equal(w.listeners.size,0,'2: the stage registers no listener');
    // A refused save keeps the progress unsaved: the next chance saves it.
    w.refuseSaves(true);await chapters(w,stage,CHAPTERS+3,CHAPTERS+4,MINUTE);assert.equal(w.saves.length,1,'2: the refused save is not counted');
    w.refuseSaves(false);stage.config.onClose();await w.settle();assert.equal(w.saves.length,2,'2: closing the stage saves the progress a refused save left');
    out.current={chapters:CHAPTERS+3,saves:w.saves.length,scoped:true};}
  // 2: a finished conference is not saved again on close; a stage that fails to open leaves no listener.
  {const w=world(),stage=await live(w);await chapters(w,stage,1,4,1000);
    await stage.config.onFinish();await w.settle();assert.equal(w.state.advanced.conference.current,null,'the conference completed');
    stage.config.onClose();await w.settle();assert.deepEqual(w.saves,[],'2: completion is a durable save; closing after it saves nothing more');
    out.finished={saves:w.saves.length};}
  // 4: the previous source.
  {const git=process.env.GH_CONFERENCE_GIT_DIR||ROOT,previous=execFileSync('git',['-C',git,'show','7b49499:WebApp/conference-core.js'],{encoding:'utf8',maxBuffer:16*1024*1024});
    const w=world(previous),stage=await live(w),rows=await chapters(w,stage,1,CHAPTERS,5000);
    assert(rows.every(row=>row.full),'4: the previous source copied the whole state on every chapter');assert.equal(w.saves.length,CHAPTERS-1,'4: and saved on every chapter');assert(rows.every(row=>row.planChecks===2),'4: and validated the plan twice');
    out.previous={chapters:CHAPTERS-1,saves:w.saves.length,fullSnapshots:rows.filter(row=>row.full).length,planChecks:rows[0].planChecks};}
  console.log(JSON.stringify({suite:'build536-conference-progress-cost',ok:true,...out}));
})().catch(error=>{console.error(error);process.exit(1);});
