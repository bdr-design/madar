// Manual performance evidence engine. No polling, model weights, network, state scans or game writes.
// Every attribution is a measured overlap, never a claim about unobserved GPU/OS work.
(()=>{
  'use strict';
  const VERSION='1.0.0',FORMAT='ventora-performance-report-v1';
  const LIMITS=Object.freeze({frames:256,incidents:512,work:512,workSearch:128,stages:64,native:128,reportBytes:2097152,durationMs:60000,maxDurationMs:300000});
  const STAGES=Object.freeze(['unknown','map.targets','map.animation','map.structure','frame.other','simulation.task','command.publish','command.clone','command.validate','command.effects','save.prepare','save.clone','save.validate','fleet.replica','fleet.worker.apply','transaction.snapshot','transaction.validate','transaction.apply','transaction.rollback','observer']);
  const OBSERVER_STAGE=STAGES.indexOf('observer');
  const safeText=(v,n=96)=>typeof v==='string'?v.slice(0,n):'';
  const finite=v=>typeof v==='number'&&Number.isFinite(v);
  const round=v=>Math.round(v*1000)/1000;
  const systemClock=()=>globalThis.performance?.now?.()??Date.now();
  function describeStage(stage){
    const name=safeText(stage);
    if(name==='map.targets')return {title:'تحديث مواقع وأهداف الخريطة',nextCheck:'قارن عدد الأهداف المقروءة والظاهرة، وافصل كلفة جمع المواقع عن تحريك العلامات.'};
    if(name==='map.animation')return {title:'تحريك العلامات المرئية',nextCheck:'قارن عدد العلامات المرئية وكلفة تحريكها في الإطار المتأخر.'};
    if(name==='map.structure')return {title:'إعادة بناء طبقات الخريطة',nextCheck:'تحقق من سبب إعادة بناء الطبقات وحجم العمل بدل تحديث العناصر المتغيرة فقط.'};
    if(/clone|snapshot|replica/.test(name))return {title:'نسخ أو مزامنة البيانات',nextCheck:'اعزل إعداد البيانات وتسلسلها ونقلها وتطبيق نتيجة العامل؛ الانتظار ليس كله حجبًا للشاشة.'};
    if(/validat|integrity|proof/.test(name))return {title:'التحقق من البيانات والأدلة',nextCheck:'حدد مرحلة التحقق وشريحتها المقاسة وحجم مدخلها، مع إبقاء شروط سلامة الحفظ فعالة.'};
    if(/save/.test(name))return {title:'تجهيز الحفظ',nextCheck:'افصل زمن تجهيز الحفظ المتزامن عن انتظار تأكيد Native وحافظ على ذرية الحفظ.'};
    if(/financial|boundary/.test(name))return {title:'الإقفال أو معالجة حد زمني',nextCheck:'راجع المراحل الفرعية المقاسة للإقفال وتحقق من المهمة الأطول دون تغيير النتائج المالية.'};
    if(name==='simulation.task')return {title:'مهمة المحاكاة',nextCheck:'المدة مقاسة للمهمة العامة؛ يلزم دليل مرحلة فرعية قبل تسمية محرك اقتصادي بعينه.'};
    if(name==='observer')return {title:'عمل مسجل الأداء نفسه',nextCheck:'راجع كلفة التسجيل وعدد الحوادث؛ لا تنسب كلفة أداة التشخيص إلى محرك اللعبة.'};
    return {title:'عمل متزامن مقاس',nextCheck:'راجع توقيت هذا الموضع وتداخله مع الإطار، ثم أعد تجربة معزولة قبل اعتماد سبب حصري.'};
  }
  let attached=null,sessionSequence=0;
  function create(options={}){
    const clock=options.clock||systemClock,wall=options.wallClock||Date.now,yieldHost=options.yieldToHost||(()=>new Promise(r=>setTimeout(r,0)));
    const schedule=options.setTimer||((fn,ms)=>setTimeout(fn,ms)),unschedule=options.clearTimer||(id=>clearTimeout(id));
    let phase='idle',session=null,lastReport=null,persisted=false,storageError='',timer=null,stopPromise=null;
    function start(input={}){
      if(phase==='recording'||phase==='finalizing'||phase==='failed'&&session)return {ok:false,reason:'session-busy'};
      if(lastReport&&!input.replace)return {ok:false,reason:'report-replacement-required'};
      const duration=Math.min(LIMITS.maxDurationMs,Math.max(1000,Number(input.durationMs)||LIMITS.durationMs)),context={};
      for(const key of ['appVersion','build','sourceSnapshot','saveSchemaVersion'])if(input.context?.[key]!=null)context[key]=String(input.context[key]).slice(0,128);
      const at=clock(),id=`PT-${Math.floor(wall())}-${++sessionSequence}`;
      session={id,context,startedMs:at,startedWallMs:wall(),durationMs:duration,frameCount:0,visibleIntervals:0,excludedFrames:0,jankyFrames:0,callbackOverruns:0,incidentTotal:0,incidentCount:0,incidentWrite:0,workTotal:0,workCount:0,workWrite:0,stageNames:STAGES.slice(),stageIds:new Map(STAGES.map((name,i)=>[name,i])),stageOverflow:0,native:[],nativeDropped:0,nativeAvailable:false,calibration:null,previousRaf:null,previousEnd:0,previousVisible:false,previousGuard:0,baseline:0,cadenceCount:0,cadenceWrite:0,cadenceMode:0,cadenceChanges:0,intervalSum:0,maxInterval:0,maxCallback:0,observerBusyMs:0,maxObserverMs:0,budgetWindowStart:at,budgetWindowBusy:0,budgetViolations:0,budgetStopQueued:false,coverageLimited:0,
        frameRows:new Float64Array(LIMITS.frames*4),incidents:new Float64Array(LIMITS.incidents*32),workRows:new Float64Array(LIMITS.work*3),candidates:new Float64Array(LIMITS.stages),cadenceWindow:new Uint16Array(128),cadenceBins:new Uint16Array(161),intervalHistogram:new Uint32Array(4001),callbackHistogram:new Uint32Array(4001)};
      phase='recording';storageError='';stopPromise=null;
      timer=schedule(()=>{void stop('duration');},duration);
      try{const out=options.onStart?.(id);if(out?.catch)out.catch(()=>{});}catch{/* A sensor failure cannot affect play. */}
      return {ok:true,id,durationMs:duration};
    }
    function work(stage,startMs,endMs){
      const s=session;if(phase!=='recording'||!s||!finite(startMs)||!finite(endMs)||endMs<startMs||endMs-startMs<.1)return false;
      if(startMs<s.startedMs)return false;
      const observedAt=clock();
      stage=safeText(stage);let id=s.stageIds.get(stage);
      if(id===undefined){if(s.stageNames.length<LIMITS.stages){const name=safeText(stage);id=s.stageNames.length;s.stageNames.push(name||'unknown');s.stageIds.set(stage,id);}else{id=0;s.stageOverflow++;}}
      const at=s.workWrite*3;s.workRows[at]=startMs;s.workRows[at+1]=endMs;s.workRows[at+2]=id;s.workWrite=(s.workWrite+1)%LIMITS.work;s.workCount=Math.min(LIMITS.work,s.workCount+1);s.workTotal++;
      const busy=Math.max(0,clock()-observedAt);s.observerBusyMs+=busy;s.workObserverBusyMs=(s.workObserverBusyMs||0)+busy;s.budgetWindowBusy+=busy;return true;
    }
    function cadence(s,gap){
      if(gap<6||gap>80)return;
      const bin=Math.round(gap*2),old=s.cadenceWindow[s.cadenceWrite];
      if(s.cadenceCount>=128)s.cadenceBins[old]--;else s.cadenceCount++;
      s.cadenceWindow[s.cadenceWrite]=bin;s.cadenceWrite=(s.cadenceWrite+1)%128;s.cadenceBins[bin]++;
      if(s.cadenceCount<8)return;
      if(s.cadenceCount!==8&&(s.frameCount&31)!==0)return;
      let best=12;for(let i=13;i<s.cadenceBins.length;i++)if(s.cadenceBins[i]>s.cadenceBins[best])best=i;
      const next=best/2,share=s.cadenceBins[best]/s.cadenceCount;
      // Do not learn repeated stalls as a new healthy cadence. OS refresh-policy changes remain explicitly uncertain.
      if(s.baseline&&next>s.baseline*1.25)return;
      if(!s.baseline||next<s.baseline*.8&&share>=.35||share>=.65){if(s.baseline&&Math.abs(next-s.baseline)>s.baseline*.25)s.cadenceChanges++;s.baseline=next;s.cadenceMode=share;}
    }
    function incident(s,raf,start,end,gap,baseline,kind,guard){
      const at=s.incidentWrite*32,a=s.incidents;a.fill(0,at,at+32);
      a[at]=s.frameCount;a[at+1]=raf;a[at+2]=gap;a[at+3]=end-start;a[at+4]=baseline;a[at+5]=kind===1?s.previousRaf:start;a[at+6]=kind===1?start:end;a[at+7]=kind;a[at+8]=guard;
      const candidates=s.candidates;candidates.fill(0);const left=a[at+5],right=a[at+6],count=Math.min(s.workCount,LIMITS.workSearch);
      for(let i=0;i<count;i++){const pos=((s.workWrite-1-i+LIMITS.work)%LIMITS.work)*3,ws=s.workRows[pos],we=s.workRows[pos+1],id=s.workRows[pos+2],overlap=Math.min(we,right)-Math.max(ws,left);if(overlap>candidates[id])candidates[id]=overlap;}
      // An overwritten evidence window must be visible in the report, never presented as complete attribution.
      if(s.workTotal>count&&count){const pos=((s.workWrite-count+LIMITS.work)%LIMITS.work)*3;if(s.workRows[pos]>left){a[at+9]=1;s.coverageLimited++;}}
      for(let slot=0;slot<8;slot++){let best=0;for(let i=1;i<s.stageNames.length;i++)if(candidates[i]>candidates[best])best=i;if(candidates[best]<=0)break;a[at+16+slot]=best;a[at+24+slot]=candidates[best];candidates[best]=0;}
      s.incidentWrite=(s.incidentWrite+1)%LIMITS.incidents;s.incidentCount=Math.min(LIMITS.incidents,s.incidentCount+1);s.incidentTotal++;
    }
    // Numeric arguments and preallocated buffers: no object/array creation, JSON, sorting or DOM per frame.
    function frame(raf,start,end,visible=true,guard=0){
      const s=session;if(phase!=='recording'||!s)return false;
      if(!finite(raf)||!finite(start)||!finite(end)||end<start||start<s.startedMs)return false;
      const captureStart=clock(),gap=s.previousRaf===null?0:raf-s.previousRaf,callback=end-start,valid=s.previousRaf!==null&&gap>0&&visible&&s.previousVisible;
      s.frameCount++;s.maxCallback=Math.max(s.maxCallback,callback);s.callbackHistogram[Math.min(4000,Math.floor(callback*4))]++;
      const threshold=s.baseline?Math.max(s.baseline*1.5,s.baseline+2):34;
      if(valid){s.visibleIntervals++;s.intervalSum+=gap;s.maxInterval=Math.max(s.maxInterval,gap);s.intervalHistogram[Math.min(4000,Math.floor(gap*4))]++;if(gap>threshold){s.jankyFrames++;incident(s,raf,start,end,gap,s.baseline,1,guard||s.previousGuard);}cadence(s,gap);}
      else s.excludedFrames++;
      if(visible&&callback>threshold){s.callbackOverruns++;if(!(valid&&gap>threshold))incident(s,raf,start,end,gap,s.baseline,2,guard);}
      const row=((s.frameCount-1)%LIMITS.frames)*4;s.frameRows[row]=raf;s.frameRows[row+1]=valid?gap:0;s.frameRows[row+2]=callback;s.frameRows[row+3]=guard;
      s.previousRaf=raf;s.previousEnd=end;s.previousVisible=visible;s.previousGuard=guard;
      const captureEnd=clock(),busy=Math.max(0,captureEnd-captureStart);s.observerBusyMs+=busy;s.maxObserverMs=Math.max(s.maxObserverMs,busy);s.budgetWindowBusy+=busy;
      if(busy>=.1){const pos=s.workWrite*3;s.workRows[pos]=captureStart;s.workRows[pos+1]=captureEnd;s.workRows[pos+2]=OBSERVER_STAGE;s.workWrite=(s.workWrite+1)%LIMITS.work;s.workCount=Math.min(LIMITS.work,s.workCount+1);s.workTotal++;}
      if(captureStart-s.budgetWindowStart>=1000){const allowance=5*(captureStart-s.budgetWindowStart)/1000;if(s.budgetWindowBusy>allowance)s.budgetViolations++;else s.budgetViolations=0;s.budgetWindowStart=captureStart;s.budgetWindowBusy=0;if(s.budgetViolations>=3&&!s.budgetStopQueued){s.budgetStopQueued=true;schedule(()=>{void stop('observer-budget');},0);}}
      return true;
    }
    function nativeSample(input={}){
      const s=session;if(!s||(phase!=='recording'&&phase!=='finalizing')||input.sessionId!==s.id)return false;
      const level=finite(input.batteryLevel)&&input.batteryLevel>=0&&input.batteryLevel<=1?input.batteryLevel:null;
      const thermal=['nominal','fair','serious','critical'].includes(input.thermalState)?input.thermalState:'unknown';
      const battery=['unplugged','charging','full','unknown'].includes(input.batteryState)?input.batteryState:'unknown';
      const row={receivedMs:clock(),nativeUptimeMs:finite(input.nativeUptimeMs)?input.nativeUptimeMs:null,kind:safeText(input.kind,24),thermalState:thermal,batteryLevel:level,batteryState:battery,lowPowerMode:typeof input.lowPowerMode==='boolean'?input.lowPowerMode:null};
      s.nativeAvailable=true;if(s.native.length<LIMITS.native)s.native.push(row);else{s.native[s.native.length-1]=row;s.nativeDropped++;}return true;
    }
    function calibration(input){if(session&&finite(input?.jsSentMs)&&finite(input?.jsReceivedMs)&&finite(input?.nativeUptimeMs)&&input.jsReceivedMs>=input.jsSentMs){session.calibration={jsSentMs:input.jsSentMs,jsReceivedMs:input.jsReceivedMs,nativeUptimeMs:input.nativeUptimeMs,offsetMs:(input.jsSentMs+input.jsReceivedMs)/2-input.nativeUptimeMs,uncertaintyMs:(input.jsReceivedMs-input.jsSentMs)/2};return true;}return false;}
    function quantile(hist,count,q){if(!count)return null;const target=Math.ceil(count*q);let seen=0;for(let i=0;i<hist.length;i++){seen+=hist[i];if(seen>=target)return round(i/4+.125);}return null;}
    function batterySummary(samples){
      const first=samples[0],last=samples[samples.length-1],seconds=first&&last?Math.max(0,(finite(first.nativeUptimeMs)&&finite(last.nativeUptimeMs)?last.nativeUptimeMs-first.nativeUptimeMs:last.receivedMs-first.receivedMs)/1000):0;
      const clean=samples.length>=2&&samples.every(r=>r.batteryState==='unplugged'&&r.batteryLevel!==null);
      const decrease=clean?first.batteryLevel-last.batteryLevel:null;
      return {firstLevel:first?.batteryLevel??null,lastLevel:last?.batteryLevel??null,durationSeconds:round(seconds),percentagePoints:clean&&decrease>=0?round(decrease*100):null,drainEstimateAvailable:clean&&seconds>=300&&decrease>=.01,scope:'whole-device',reason:!clean?'charging-or-unavailable':seconds<300||decrease<.01?'insufficient-duration-or-resolution':'coarse-system-level-change',watts:null,temperatureCelsius:null};
    }
    function analyse(row,names,index){
      const evidence=[];for(let slot=0;slot<8;slot++){const duration=row[24+slot];if(duration>0)evidence.push({stage:names[row[16+slot]]||'unknown',overlapMs:round(duration),basis:'largest-measured-synchronous-overlap'});}
      let primary=evidence[0]||null;
      if(primary?.stage==='simulation.task'){const specific=evidence.find(e=>e.stage!=='simulation.task'&&e.overlapMs>=primary.overlapMs*.55);if(specific)primary=specific;}
      const enough=primary&&primary.stage!=='unknown'&&primary.overlapMs>=Math.max(2,(row[4]||16.67)*.35);
      return {id:`FRAME-${row[0]}-${index}`,frame:row[0],rafMs:round(row[1]),frameIntervalMs:round(row[2]),callbackMs:round(row[3]),observedBaselineMs:row[4]||null,window:{startMs:round(row[5]),endMs:round(row[6])},kind:row[7]===1?'delayed-frame':'callback-overrun',hostGuard:row[8]!==0,evidenceLimited:row[9]===1,assessment:enough?'measured-overlap':'unattributed',primaryStage:enough?primary.stage:null,evidence,causality:'timing-overlap-is-not-proof-of-exclusive-cause'};
    }
    async function stop(reason='player'){
      if(phase==='finalizing')return stopPromise;
      if(phase==='failed'&&session)phase='recording';
      if(phase!=='recording'||!session)return lastReport;
      const s=session;phase='finalizing';if(timer!==null){unschedule(timer);timer=null;}
      if(!s.stopped){s.stopped={endedMs:clock(),endedWallMs:wall(),reason:safeText(reason,40)};}
      const {endedMs,endedWallMs}=s.stopped;reason=s.stopped.reason;
      stopPromise=(async()=>{
        let sensorError=null;try{await options.onStop?.(s.id);}catch{sensorError='native-final-sample-unavailable';}
        const incidents=[],byStage=Object.create(null);let unattributed=0;
        await yieldHost();
        for(let i=0;i<s.incidentCount;i++){
          const pos=((s.incidentWrite-s.incidentCount+i+LIMITS.incidents)%LIMITS.incidents)*32,row=s.incidents.subarray(pos,pos+32),finding=analyse(row,s.stageNames,i);incidents.push(finding);
          if(finding.primaryStage){const bucket=byStage[finding.primaryStage]||(byStage[finding.primaryStage]={incidents:0,maxOverlapMs:0,evidenceIds:[]});bucket.incidents++;if(bucket.evidenceIds.length<12)bucket.evidenceIds.push(finding.id);bucket.maxOverlapMs=Math.max(bucket.maxOverlapMs,finding.evidence.find(e=>e.stage===finding.primaryStage)?.overlapMs||0);}else unattributed++;
          if((i&15)===15)await yieldHost();
        }
        const findings=Object.entries(byStage).map(([stage,counts])=>({stage,...describeStage(stage),...counts,assessment:'measured-overlap'})).sort((a,b)=>b.maxOverlapMs-a.maxOverlapMs);
        const recentFrames=[];for(let i=Math.max(0,s.frameCount-LIMITS.frames);i<s.frameCount;i++){const pos=(i%LIMITS.frames)*4;recentFrames.push({rafMs:round(s.frameRows[pos]),intervalMs:round(s.frameRows[pos+1]),callbackMs:round(s.frameRows[pos+2]),hostGuard:s.frameRows[pos+3]!==0});if((i&31)===31)await yieldHost();}
        const report={format:FORMAT,version:VERSION,id:s.id,context:s.context,startedAt:new Date(s.startedWallMs).toISOString(),endedAt:new Date(endedWallMs).toISOString(),startedMs:s.startedMs,endedMs,requestedDurationMs:s.durationMs,durationMs:round(Math.max(0,endedMs-s.startedMs)),stopReason:safeText(reason,40),analysis:{kind:'local-adaptive-statistics-and-evidence-rules',generativeModel:false,networkUsed:false,accuracyTarget:.99,accuracyVerified:false,findings,byStage,unattributed,exclusiveCauseProven:false},frameSummary:{frames:s.frameCount,visibleIntervals:s.visibleIntervals,excludedFrames:s.excludedFrames,jankyFrames:s.jankyFrames,callbackOverruns:s.callbackOverruns,effectiveFps:s.intervalSum>0?round(s.visibleIntervals*1000/s.intervalSum):null,observedCadenceMs:s.baseline||null,cadenceChanges:s.cadenceChanges,hardwareRefreshMeasured:false,maxFrameIntervalMs:round(s.maxInterval),p50FrameIntervalMs:quantile(s.intervalHistogram,s.visibleIntervals,.5),p95FrameIntervalMs:quantile(s.intervalHistogram,s.visibleIntervals,.95),p99FrameIntervalMs:quantile(s.intervalHistogram,s.visibleIntervals,.99),maxCallbackMs:round(s.maxCallback),histogramCapMs:1000},coverage:{incidentTotal:s.incidentTotal,retainedIncidents:s.incidentCount,overwrittenIncidents:Math.max(0,s.incidentTotal-s.incidentCount),incompleteWorkWindows:s.coverageLimited,workSearchLimit:LIMITS.workSearch,stageOverflow:s.stageOverflow,nativeSamplesDropped:s.nativeDropped,calibrationFrames:8},observer:{busyMs:round(s.observerBusyMs),workHookBusyMs:round(s.workObserverBusyMs||0),frameHookBusyMs:round(s.observerBusyMs-(s.workObserverBusyMs||0)),maxFrameOverheadMs:round(s.maxObserverMs),budgetViolations:s.budgetViolations,bufferBytes:s.frameRows.byteLength+s.incidents.byteLength+s.workRows.byteLength+s.candidates.byteLength+s.cadenceWindow.byteLength+s.cadenceBins.byteLength+s.intervalHistogram.byteLength+s.callbackHistogram.byteLength},native:{available:s.nativeAvailable,sensorError,calibration:s.calibration,samples:s.native,battery:batterySummary(s.native),thermalUnit:'system-state-not-celsius'},incidents,recentFrames,limitations:['RAF is not a GPU presentation timestamp.','Thermal states are not Celsius.','Battery change covers the whole device.','Measured overlap does not prove an exclusive root cause.','Bounded buffers may overwrite incidents; see coverage.','Baseline is not relaxed to hide sustained slowdowns; OS refresh changes require context.']};
        // Retain the new report in memory even when storage fails. A failed replacement must leave the old disk record.
        lastReport=report;persisted=false;storageError='';
        try{if(!options.store?.save)throw new Error('report-storage-unavailable');await options.store.save(report);persisted=true;}catch(error){storageError=safeText(error?.message||'report-save-failed',160);}
        phase='ready';session=null;try{options.onReady?.(report,{persisted,error:storageError});}catch{/* The report remains available if presentation fails. */}return report;
      })().catch(error=>{phase='failed';storageError=safeText(error?.message||'report-finalization-failed',160);return null;});
      return stopPromise;
    }
    async function load(){if(lastReport||phase==='recording'||phase==='finalizing')return lastReport;const report=await options.store?.load?.();if(report){lastReport=report;persisted=true;storageError='';phase='ready';}return lastReport;}
    async function retrySave(){if(!lastReport||phase==='recording'||phase==='finalizing')return false;try{await options.store.save(lastReport);persisted=true;storageError='';return true;}catch(error){persisted=false;storageError=safeText(error?.message,160);return false;}}
    function status(){return {phase,active:phase==='recording',sessionId:session?.id||null,durationMs:session?.durationMs||60000,frames:session?.frameCount??lastReport?.frameSummary.frames??0,incidents:session?.incidentTotal??lastReport?.coverage.incidentTotal??0,hasReport:!!lastReport,persisted,storageError,reportId:lastReport?.id||null};}
    return Object.freeze({start,stop,work,frame,nativeSample,calibration,load,retrySave,status,latest:()=>lastReport,get active(){return phase==='recording';},get phase(){return phase;}});
  }
  function attach(recorder){attached=recorder;}
  function recordWork(stage,start,end){if(attached?.active)return attached.work(stage,start,end);return false;}
  const API=Object.freeze({VERSION,FORMAT,LIMITS,STAGES,create,attach,recordWork,describeStage,get active(){return attached?.active===true;}});globalThis.GH_PERFORMANCE_TRACE=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
