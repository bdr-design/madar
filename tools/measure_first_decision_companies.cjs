'use strict';
// First decision after play, company by company (a tool, not an acceptance gate, and not an iPhone measurement).
// Same emulated phone as tools/measure_mobile_session.cjs (844x390, 3x, touch, CPU throttled 4x, real fleet worker,
// moving air fleet). For each company: 8 s of map play at speed 3, stop, open the company's facility page, then press
// the real "استكمال الفريق" button (facilities/hire, the one decision every company's facility page has). The press is
// profiled: animation-frame intervals, the durable command's timing, and every busy stretch over 50 ms with its top
// frames. Hospitality has no facility page of this kind and is measured with its pending-decision button instead.
//   node tools/measure_first_decision_companies.cjs <sourceRoot> <label> [rows=20000] [out.json] [companies=a,b]
const path=require('path'),fs=require('fs');
const ROOT=path.resolve(process.argv[2]||path.join(__dirname,'..')),LABEL=process.argv[3]||'run',ROWS=Number(process.argv[4]||20000),OUT=process.argv[5]||null;
const HERE=path.resolve(__dirname,'..'),{chromium}=require('playwright');
const {bootRenderApp}=require(path.join(HERE,'tests/helpers/render-app.cjs')),{installVault}=require(path.join(HERE,'tests/helpers/differential-vault-fixture.cjs')),fixture=require(path.join(HERE,'tests/helpers/request-decisions-fixture.cjs'));
const PHONE={deviceScaleFactor:3,isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'};
// Each company's decision: [panel, arg, button selector]; the first tab that shows the button is used.
const DESK=(id,action)=>['facilityManage',['command','operations','finance'].map(tab=>({id,tab})),`[data-gh-action="${action}"]:not([disabled])`];
const SPECS={air:id=>DESK(id,'facility-hire'),sea:id=>DESK(id,'facility-hire'),road:id=>DESK(id,'facility-hire'),mobility:id=>DESK(id,'facility-hire'),
  bank:id=>DESK(id,'bank-branch-campaign'),power:id=>DESK(id,'energy-set-dispatch'),insurance:id=>DESK(id,'insurance-office-campaign'),telecom:id=>DESK(id,'telecom-campaign'),dealership:id=>DESK(id,'dealership-campaign'),
  realestate:()=>['realestate',[{tab:'develop'}],'[data-gh-action="realestate-start-project"]:not([disabled])'],
  hospitality:()=>['hospitality',[{company:'hospitality',tab:'properties'}],'[data-gh-action="hospitality-hire"]:not([disabled])']};
const PROFILE=process.env.PROFILE!=='0',GAP_US=Number(process.env.GAP_US||4000),PROFILE_DIR=process.env.PROFILE_DIR||null;
const COMPANIES=(process.argv[6]||'air,sea,road,power,bank,mobility,insurance,realestate,telecom,dealership,hospitality').split(',');
const stats=rows=>{const xs=rows.slice().sort((a,b)=>a-b),q=p=>xs.length?+xs[Math.min(xs.length-1,Math.floor(xs.length*p))].toFixed(1):0;return {frames:xs.length,p50:q(.5),max:xs.length?+xs[xs.length-1].toFixed(1):0,over33:xs.filter(x=>x>33.4).length,missed:Math.round(xs.reduce((n,x)=>n+Math.max(0,Math.round(x/16.67)-1),0))};};
// Busy stretches (>50 ms, gaps under 4 ms) of a CPU profile, each with its top self and inclusive frames.
function blocks(p,top=8){
  const nodes=new Map(p.nodes.map(n=>[n.id,n])),parent=new Map();for(const n of p.nodes)for(const c of n.children||[])parent.set(c,n.id);
  const name=id=>{const f=nodes.get(id).callFrame;return `${f.functionName||'(anon)'}:${f.lineNumber+1}@${(f.url||'').split('/').pop().slice(0,24)}`;};
  const idle=new Set(p.nodes.filter(n=>['(idle)','(program)'].includes(n.callFrame.functionName)).map(n=>n.id));
  let t=p.startTime,cur=null;const out=[];
  p.samples.forEach((sid,i)=>{t+=p.timeDeltas[i];if(idle.has(sid))return;if(cur&&t-cur.end<GAP_US){cur.end=t;cur.s.push(sid);}else{if(cur)out.push(cur);cur={start:t,end:t,s:[sid]};}});if(cur)out.push(cur);
  return out.filter(b=>b.end-b.start>50000).sort((a,b)=>b.end-b.start-(a.end-a.start)).slice(0,4).map(b=>{
    const self=new Map(),incl=new Map(),bump=(m,k)=>m.set(k,(m.get(k)||0)+1);
    for(const sid of b.s){bump(self,name(sid));const seen=new Set();for(let x=sid;nodes.has(x);x=parent.get(x)){const k=name(x);if(!seen.has(k)){seen.add(k);bump(incl,k);}}}
    const rank=m=>[...m].sort((a,b)=>b[1]-a[1]).slice(0,top).map(([k,v])=>`${k} ${Math.round(v/b.s.length*100)}%`);
    return {ms:Math.round((b.end-b.start)/1000),offsetMs:Math.round((b.start-p.startTime)/1000),self:rank(self),incl:rank(incl).filter(x=>!/^\(root\)|^\(anon\):1@ |runMicrotasks/.test(x))};
  });
}
(async()=>{
  const browser=await chromium.launch({headless:true}),errors=[],wrapped={newPage:config=>browser.newPage({...config,...PHONE})};let env;const out={label:LABEL,source:ROOT,rows:ROWS,phone:{viewport:'844x390',...PHONE,cpuThrottle:4},companies:{}};
  try{
    env=await bootRenderApp({browser:wrapped,root:ROOT,errors,measureSyncWork:true,viewport:{width:844,height:390},beforeScripts:{fn:installVault}});const page=env.page;page.setDefaultTimeout(300000);
    out.world=await fixture.prepare(page,{rows:ROWS});
    // One facility per company (the fixture already owns air, bank, insurance and telecom ones).
    out.facilities=await page.evaluate(async companies=>{
      const a=__AUDIT__,s=__GH_STATE__,cap=GH_MOBILITY_CORE.capitalMeta('RUH'),ids={air:'QA-DEC-OMDB',bank:'QA-DEC-bank',insurance:'QA-DEC-insurance',telecom:'QA-DEC-telecom'};
      for(const type of companies){
        if(ids[type])continue;if(type==='hospitality'){ids[type]='hotel';continue;}const id='QA-FIRST-'+type;let facility,bucket='customHubs';
        if(type==='sea'){const r=GH_WORLD_DATA.ports.find(r=>r[5])||GH_WORLD_DATA.ports[0];facility={id,name:'QA port',kind:'port-base',company:'sea',ownerCompanyId:'sea',owned:true,sourceKey:`port:${r[0]}:${r[3]}:${r[4]}`,code:r[0],city:r[1],country:String(r[2]||'—'),coords:[r[3],r[4]]};bucket='globalBases';}
        else{const kind=GH_COMPANY_PLATFORM.definitionFor(s,type).facilities.primaryKind;facility={...(type==='power'?{energyKind:'solar',capacity:'100 MW',capacityAmount:100,commissioned:true}:{}),id,name:'QA '+type,kind,ownerCompanyId:type,company:type,owned:true,capitalId:'RUH',sourceKey:`site:${type}:RUH`,city:cap.city,country:cap.country,coords:cap.coords};}
        try{await a.runAuthorizedDomainCommand('facilities','create',{facility,bucket},{silent:true});ids[type]=id;}catch(error){ids[type]='error:'+String(error.message||error);}
      }
      return ids;
    },COMPANIES);
    // Hospitality: one hotel opened in setup, so its page has a team to complete.
    if(COMPANIES.includes('hospitality'))out.hotel=await page.evaluate(async()=>{try{const s=__GH_STATE__,H=GH_HOSPITALITY_CORE,q=H.buildQuote(s,'hospitality',{kind:'hotel',capitalId:'RUH'});await __AUDIT__.runAuthorizedDomainCommand('hospitality','start-property',{companyId:'hospitality',kind:q.kind,capitalId:q.capitalId,expectedCost:q.cost},{silent:true});const p=H.read(s,'hospitality').properties[0],a=H.accelerationQuote(s,'hospitality',p.id);if(a)await __AUDIT__.runAuthorizedDomainCommand('hospitality','accelerate-construction',{companyId:'hospitality',propertyId:p.id,expectedFee:a.fee,expectedCompleteDay:a.completeDay},{silent:true});return H.read(s,'hospitality').properties.map(p=>({id:p.id,status:p.status}));}catch(error){return 'error:'+String(error.message||error);}});
    // One day close in setup: a dealership showroom starts selling (and gets its desk) at the first close.
    await page.evaluate(()=>{const t=(Math.floor(__GH_STATE__.simSeconds/86400)+1)*86400;const r=__AUDIT__.simulationEngine.advanceTo(t,{reason:'qa-first-decision-setup',speed:300});if(!r.accepted)throw Error('advance-refused');return t;}).then(t=>page.waitForFunction(t=>__GH_STATE__.simSeconds>=t&&!__AUDIT__.simulationEngine.snapshot().manualAdvance,t,{timeout:600000,polling:250}));await page.evaluate(()=>__AUDIT__.whenStateIdle());
    // The vault double decodes every chunk's base64 and hashes every save on the page thread (up to 520 ms per press
    // at 4x). On the phone chunks go as raw bytes to gh://app; here the double only acknowledges, so the busy time
    // left is the game's. Durable acknowledgement order is unchanged (one task later, as before).
    await page.evaluate(()=>{const bridge=window.webkit.messageHandlers.saveBridge,original=bridge.postMessage,q=window.__DIFF_VAULT__;q.light=true;
      bridge.postMessage=function(m){if(!q.light)return original.call(this,m);const deliver=(name,detail)=>setTimeout(()=>dispatchEvent(new CustomEvent(name,{detail})),0);
        if(m.action==='storeSaveChunk'){q.uploads.push({id:m.id,bytes:m.bytes,wireBytes:m.base64.length,encoding:m.encoding||'identity'});q.chunks.set(m.id,true);deliver('gh-native-chunk-ack',{requestId:m.requestId,id:m.id,success:true,message:null});return;}
        if(m.action!=='commitSave')throw new Error('unexpected action '+m.action);
        deliver('gh-native-save-ack',{requestId:m.requestId,action:m.action,saveRevision:m.saveRevision,resetEpoch:m.resetEpoch,saveSchemaVersion:m.saveSchemaVersion,saveHash:m.saveHash,success:true,generation:++q.generation,message:null});};});
    const dispatch=await page.evaluate(()=>__AUDIT__.dispatchSharedInternationalNetwork('air'));out.dispatch={departed:dispatch?.departed||0};
    await page.evaluate(()=>{window.__FRAMES__={phase:'setup',rows:[]};let last=null;const loop=t=>{if(last!==null)window.__FRAMES__.rows.push([window.__FRAMES__.phase,t-last]);last=t;requestAnimationFrame(loop);};requestAnimationFrame(loop);
      // Long animation frames (Chromium): every frame over 50 ms with the scripts that ran in it.
      window.__LOAF__=[];try{new PerformanceObserver(list=>{for(const e of list.getEntries())if(/^(decide|play)-/.test(window.__FRAMES__.phase)&&e.duration>=(window.__FRAMES__.phase.startsWith('play-')?100:50))window.__LOAF__.push({phase:window.__FRAMES__.phase,ms:Math.round(e.duration),blocking:Math.round(e.blockingDuration),render:Math.round(e.renderStart?e.startTime+e.duration-e.renderStart:0),style:Math.round(e.styleAndLayoutStart?e.startTime+e.duration-e.styleAndLayoutStart:0),scripts:e.scripts.map(x=>({ms:Math.round(x.duration),fn:x.sourceFunctionName,src:String(x.sourceURL||'').split('/').pop(),at:x.sourceCharPosition,invoker:x.invoker,forced:Math.round(x.forcedStyleAndLayoutDuration||0)})).filter(x=>x.ms>=3)});}).observe({type:'long-animation-frame',buffered:false});}catch{}
      // Bounded timing of the one durable command per press; nothing is replaced in the product.
      const commands=GH_DOMAIN_COMMANDS,q=window.__FIRST__={active:false,calls:[]};
      window.GH_DOMAIN_COMMANDS={...commands,async dispatchDurable(ctx,envelope,options){const intent=GH_AUTHORIZATION.commandIntent(envelope.command),call={domain:intent.domain,name:intent.name,started:performance.now(),done:false};if(q.active)q.calls.push(call);try{const r=await commands.dispatchDurable(ctx,envelope,options);call.committed=r.committed;call.result=r.value?.result?.status||null;return r;}catch(e){call.error=String(e.message||e);throw e;}finally{call.done=true;call.ms=performance.now()-call.started;}}};
    });
    const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:250});await cdp.send('Profiler.start');await page.waitForTimeout(1500);await cdp.send('Profiler.stop');
    const phase=name=>page.evaluate(n=>{window.__FRAMES__.phase=n;},name);let seq=0;
    for(const type of COMPANIES){
      const facility=out.facilities[type],row={facility};out.companies[type]=row;
      if(String(facility||'').startsWith('error:')){row.skipped=facility;continue;}
      await page.evaluate(()=>{window.__LOAF__=[];});await phase('play-'+type);await page.evaluate(()=>__AUDIT__.setSpeed(3));await page.waitForTimeout(8000);await page.evaluate(()=>__AUDIT__.setSpeed(0));await page.evaluate(()=>__AUDIT__.whenStateIdle());
      const [panel,args,selector]=SPECS[type](facility);let button=null;row.decision=selector;
      for(const arg of args){await page.evaluate(([p,a])=>__AUDIT__.openDrawer(p,a),[panel,arg]);await page.waitForTimeout(700);const b=page.locator(selector).first();if(await b.count()){button=b;row.tab=arg.tab;break;}}
      if(!button){row.skipped='no-button';row.seen=await page.evaluate(()=>[...new Set([...document.querySelectorAll('#drawer [data-gh-action]')].map(b=>b.dataset.ghAction+(b.disabled?'(disabled)':'')))]);continue;}
      row.playLoaf=await page.evaluate(()=>window.__LOAF__.filter(e=>e.phase.startsWith('play-')));await page.evaluate(()=>{window.__LOAF__=[];window.__FIRST__.active=true;window.__FIRST__.calls=[];globalThis.__CODEC_TRACE__=[];});if(PROFILE)await cdp.send('Profiler.start');await page.waitForTimeout(300);await phase('decide-'+type);const started=Date.now();
      await button.click();
      const confirm=page.locator('.ui-confirm [data-confirm="accept"]');try{await confirm.waitFor({state:'visible',timeout:1500});await page.evaluate(()=>{window.__FRAMES__.rows=window.__FRAMES__.rows.filter(r=>!r[0].startsWith('decide-'));});await confirm.click();row.confirmed=true;}catch{}
      await page.waitForFunction(()=>{const c=window.__FIRST__.calls;return c.length>=1&&c.every(x=>x.done)&&!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked();},null,{timeout:120000});
      row.wallMs=Date.now()-started;await page.waitForTimeout(500);const {profile}=PROFILE?await cdp.send('Profiler.stop'):{profile:null};if(PROFILE_DIR&&profile)fs.writeFileSync(path.join(PROFILE_DIR,`${LABEL}-${type}.cpuprofile`),JSON.stringify(profile));await phase('setup');
      const rows=await page.evaluate(t=>{window.__FIRST__.active=false;return window.__FRAMES__.rows.filter(r=>r[0]===t).map(r=>r[1]);},'decide-'+type);
      Object.assign(row,{frames:stats(rows),play:stats(await page.evaluate(t=>window.__FRAMES__.rows.filter(r=>r[0]===t).map(r=>r[1]),'play-'+type)),
        calls:await page.evaluate(()=>window.__FIRST__.calls.map(c=>({command:c.domain+'/'+c.name,ms:Math.round(c.ms),committed:c.committed,result:c.result,error:c.error}))),
        durable:await page.evaluate(()=>{const t=GH_TRANSACTION_CORE.telemetry().lastDurable||{},o={};for(const [k,v] of Object.entries(t))if(typeof v==='number'&&k!=='recordedAtMs'&&v>=1)o[k]=Math.round(v);return o;}),
        busy:profile?blocks(profile):[],loaf:await page.evaluate(()=>window.__LOAF__.slice()),encoded:await page.evaluate(()=>(globalThis.__CODEC_TRACE__||[]).map(r=>({...r,wall:Math.round(r.wall)})))});
      console.error(type,JSON.stringify({max:row.frames.max,missed:row.frames.missed,calls:row.calls,durable:row.durable,busy:row.busy.map(b=>b.ms)}));
    }
    out.errors=errors.slice(0,5);
  }finally{await Promise.race([browser.close(),new Promise(r=>setTimeout(r,15000))]);await env?.closeOrigin?.();}
  const text=JSON.stringify(out,null,1);if(OUT)fs.writeFileSync(OUT,text);console.log(text);
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>process.exit(process.exitCode||0));
