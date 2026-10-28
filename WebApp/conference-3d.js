/* Stable presentation API for the conference: the owner's dark hall, the keynote slides on its LED screen in the speaker's
   colour, the speaker's mark on the two side screens. */
(()=>{'use strict';
const ENGINE_ID='GH-CONFERENCE-3D',VERSION='6.1.0',M=globalThis.GH_CONF_MODEL,{esc}=M;
// The hall photograph (1832 × 859): the LED screen, the two side screens, and the part of the hall a screen must show
// (assets/conference/HALL-ART-NOTES.txt).
const HALL=Object.freeze({w:1832,h:859,led:[473,111,888,411],left:[325,148,110,316],right:[1400,147,110,316],focus:[310,95,1525,745]});
const SLIDE_MS=4200,HERO_MS=5200;
const ICON={close:'<path d="M3.5 3.5l9 9M12.5 3.5l-9 9"/>',next:'<path d="M10 3.5L5.5 8l4.5 4.5"/>',prev:'<path d="M6 3.5L10.5 8 6 12.5"/>',chapters:'<path d="M3 4.5h10M3 8h10M3 11.5h10"/>'};
const icon=name=>`<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;
const PLAY='<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M5 3.2v9.6L12.6 8z"/></svg>',PAUSE='<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="4" y="3" width="2.6" height="10" rx="1"/><rect x="9.4" y="3" width="2.6" height="10" rx="1"/></svg>';
// A CSS url() from a logo path or data URI: quotes, backslashes and line breaks are escaped as CSS string escapes.
// A slide's accent mixed with transparent at a weight, as color-mix(in srgb, accent w, transparent) gives it (the colour
// itself at that share of its alpha), worked out once per accent (owner, build 98: «كمل الباقي بدقه»; the LED screen's glow
// and the number ring evaluated color-mix again on every slide, a fifth of a slide's style work). Anything but a hex colour
// keeps color-mix.
const ACCENT_MIX=new Map();
const accentMix=(accent,weight)=>{const key=`${accent}|${weight}`;let out=ACCENT_MIX.get(key);if(out)return out;const hex=/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(String(accent||''))?.[1];if(hex){const full=hex.length<=4?[...hex].map(c=>c+c).join(''):hex,channel=i=>parseInt(full.slice(i*2,i*2+2),16),alpha=full.length===8?channel(3)/255:1;out=`rgba(${channel(0)},${channel(1)},${channel(2)},${Math.round(alpha*weight*10000)/10000})`;}else out=`color-mix(in srgb,${accent} ${Math.round(weight*100)}%,transparent)`;if(ACCENT_MIX.size<64)ACCENT_MIX.set(key,out);return out;};
const cssUrl=value=>value?`url("${String(value).replace(/["\\\n\r]/g,c=>`\\${c.charCodeAt(0).toString(16)} `)}")`:'none';
let active=null,lastDiagnostics=null;
class ConferenceSession{
 constructor(config,options={}){
  this.config=config;this.mode=['full','brief','manual'].includes(options.mode)?options.mode:'full';
  // The caller hands over its own copy of the snapshot and plan (conference-core clones each once); frozen here.
  this.snapshot=M.freeze(config.owned===true?config.snapshot:M.clone(config.snapshot));
  this.resumePhase=['preflight','opening','presenting'].includes(config.lifecycleState)?config.lifecycleState:'preflight';
  if(config.planBundle){M.validatePlanBundle(config.planBundle,this.snapshot);if(config.planHash&&config.planHash!==config.planBundle.planHash)throw new Error('conference-engine-plan-hash-mismatch');this.planBundle=M.freeze(config.owned===true?config.planBundle:M.clone(config.planBundle));this.scenes=M.scenesForPlan(this.planBundle,this.mode,{validated:true});}
  else if(config.live)throw new Error('conference-live-plan-required');else this.scenes=M.buildScenePlan(this.snapshot,{mode:this.mode});
  this.slides=globalThis.GH_CONF_KEYNOTE.slides(this.snapshot,this.scenes);if(!this.slides.length)throw new Error('conference-slides-empty');
  const start=Math.max(0,Math.min(this.scenes.length-1,Math.floor(M.number(options.startScene))));
  this.slide=Math.max(0,this.slides.findIndex(s=>s.scene===start)>=0?this.slides.findIndex(s=>s.scene===start):this.slides.findIndex(s=>s.scene>start));this.index=this.slides[this.slide].scene;
  this.disposed=false;this.failed=false;this.playing=false;this.frames=0;this.phase='created';this.timer=0;this.events=[];this.panelMode=null;this.assetsReady=false;
 }
 setPhase(next,notify=true){const allowed={created:['preflight'],preflight:['opening'],opening:['presenting'],presenting:['closing'],closing:['closed'],closed:[]};if(this.phase===next)return;if(!allowed[this.phase]?.includes(next))throw new Error(`conference-engine-phase-invalid:${this.phase}->${next}`);this.phase=next;if(this.root)this.root.dataset.phase=next;if(notify&&['opening','presenting','closing'].includes(next))this.config.onPhaseChange?.({state:next,sceneId:this.scenes[this.index]?.id||''});}
 listen(target,event,fn,options){target.addEventListener(event,fn,options);this.events.push(()=>target.removeEventListener(event,fn,options));}
 mount(){
  this.setPhase('preflight',false);this.previousFocus=document.activeElement;this.previousOverflow=document.body.style.overflow;
  const root=this.root=document.createElement('section');root.className='ghc3';root.dir='rtl';root.dataset.phase=this.phase;root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-label',`المؤتمر السنوي ${this.snapshot.year||''}`.trim());
  // The hall photograph is the viewport's background; the slide is drawn on its LED screen (lit in the speaker's colour,
  // a hero slide's photograph behind the stage), the speaker's mark on its side screens. The arrows sit at the sides,
  // where the thumbs rest in landscape.
  root.style.setProperty('--hall-w',String(HALL.w));root.style.setProperty('--hall-h',String(HALL.h));
  root.innerHTML=`<main class="ghc3-viewport"><div class="ghc3-side ghc3-side-right" aria-hidden="true"></div><div class="ghc3-side ghc3-side-left" aria-hidden="true"></div><div class="ghc3-led"><div class="ghc3-stage" role="region" aria-live="polite" aria-label="شاشة المؤتمر"></div></div><div class="ghc3-loading" role="status"><span></span>تجهيز المؤتمر…</div></main><div class="ghc3-ctl ghc3-ctl-top"><button class="ghc3-icon" data-c3="close" aria-label="إغلاق المؤتمر">${icon('close')}</button><div class="ghc3-chip">${this.config.live?'<i class="ghc3-live" title="مباشر"></i>':''}<span class="ghc3-brand" aria-hidden="true"></span><span class="ghc3-count"></span></div></div><div class="ghc3-ctl ghc3-ctl-end"><button data-c3="finish" hidden>اختتام المؤتمر</button><button class="ghc3-icon" data-c3="chapters" aria-expanded="false" aria-label="فصول المؤتمر">${icon('chapters')}</button><button class="ghc3-icon" data-c3="play" aria-label="تشغيل تلقائي">${PLAY}</button></div><div class="ghc3-ctl ghc3-ctl-transport"><button class="ghc3-icon" data-c3="prev" aria-label="الشريحة السابقة">${icon('prev')}</button><button class="ghc3-icon" data-c3="next" aria-label="الشريحة التالية">${icon('next')}</button></div><div class="ghc3-progress" role="progressbar" aria-label="تقدم المؤتمر"></div><aside class="ghc3-panel" hidden><header><h3>فصول المؤتمر</h3><button class="ghc3-icon" data-c3="panel-close" aria-label="إغلاق الفصول">${icon('close')}</button></header><div class="ghc3-panel-content"></div></aside><div class="ghc3-recovery" hidden><h2>تعذّر عرض المؤتمر</h2><p>أعد المحاولة من الفصل الحالي.</p><button data-c3="retry">إعادة المحاولة</button><button data-c3="close">إغلاق</button></div>`;
  document.body.style.overflow='hidden';document.body.appendChild(root);this.siblings=[...document.body.children].filter(el=>el!==root&&el.tagName!=='SCRIPT').map(el=>[el,el.inert]);this.siblings.forEach(([el])=>{el.inert=true;});
  this.stage=root.querySelector('.ghc3-stage');this.brand=root.querySelector('.ghc3-brand');
  this.led=root.querySelector('.ghc3-led');this.sides=[root.querySelector('.ghc3-side-left'),root.querySelector('.ghc3-side-right')];this.frame();
  this.show(false);
  this.listen(root,'click',e=>{const b=e.target.closest('[data-c3]');if(b&&root.contains(b))this.action(b.dataset.c3);});this.listen(root,'keydown',e=>this.keydown(e));this.listen(globalThis,'resize',()=>this.frame());
  this.listen(document,'visibilitychange',()=>{if(document.hidden){this.wasPlaying=this.playing;this.pause();}else if(this.wasPlaying){this.play();this.wasPlaying=false;}});this.listen(globalThis,'pagehide',()=>this.close(false));root.querySelector('[data-c3="close"]').focus({preventScroll:true});this.ready=this.initialize();return this;
 }
 // The hall covers the screen and is never stretched. In landscape (the iPhone app's only orientation) it is scaled so the
 // LED screen takes about 72% of the screen's width (80% on a screen under 760 points, where the slide's type reaches its
 // smallest size; or 74% of the height), with the hall and its side screens around it; the LED screen is always whole,
 // and a side screen the frame cuts is hidden instead of shown in part. Upright (a browser), the hall covers the screen
 // and the slide is a large screen across it, clear of the controls (conference-3d.css), the ceiling above it and the
 // audience below. Runs at mount and when the screen turns, not between slides; the conference covers the window
 // (conference-3d.css), so the window's size is read and no layout is forced.
 frame(){if(this.disposed||!this.root)return;const W=globalThis.innerWidth||this.root.clientWidth||HALL.w,H=globalThis.innerHeight||this.root.clientHeight||HALL.h,[lx,ly,lw,lh]=HALL.led,upright=H>W;
  let K=Math.max(W/HALL.w,H/HALL.h);if(!upright){K=Math.max(K,Math.min(W*(W<760?.8:.72)/lw,H*.74/lh));if(lw*K>W*.98||lh*K>H*.92)K=Math.min(W*.96/lw,H*.9/lh);}
  const covers=HALL.h*K>=H,left=Math.min(Math.max(lx+lw/2-W/(2*K),0),HALL.w-W/K),top=covers?Math.min(Math.max(ly+lh/2-H/(2*K),0),HALL.h-H/K):ly+lh/2-H/(2*K);
  this.root.style.setProperty('--k',K.toFixed(5));this.root.style.setProperty('--x',`${(-left*K).toFixed(2)}px`);this.root.style.setProperty('--y',`${(-top*K).toFixed(2)}px`);
  if(upright)this.root.dataset.upright='true';else delete this.root.dataset.upright;
  const place=(node,[x,y,w,h])=>Object.assign(node.style,{left:`${((x-left)*K).toFixed(2)}px`,top:`${((y-top)*K).toFixed(2)}px`,width:`${(w*K).toFixed(2)}px`,height:`${(h*K).toFixed(2)}px`});
  place(this.led,HALL.led);place(this.sides[0],HALL.left);place(this.sides[1],HALL.right);
  [[this.sides[0],HALL.left],[this.sides[1],HALL.right]].forEach(([node,[x,,w]])=>{node.style.visibility=!upright&&(x-left)*K>=0&&(x+w-left)*K<=W?'':'hidden';});}
 async initialize(){try{
   this.setPhase('opening',this.config.live&&this.resumePhase==='preflight');
   // A font or image that fails to load leaves the fallback; it must not fail the conference.
   const hall=new Image();hall.src='assets/conference/hall-dark.webp';
   await Promise.all([...[400,500,600,700].map(weight=>Promise.resolve(document.fonts?.load?.(`${weight} 20px "GH Plex Arabic"`,'المؤتمر')).catch(()=>null)),Promise.resolve(hall.decode?.()).catch(()=>null)]);
   if(this.disposed)return;this.assetsReady=true;this.frames++;this.root.querySelector('.ghc3-loading')?.remove();this.setPhase('presenting',this.config.live&&this.resumePhase!=='presenting');this.persistProgress();if(this.mode!=='manual')this.play();
  }catch(error){if(!this.disposed)this.fail(error);}}
 show(persist=true){if(this.disposed)return;const slide=this.slides[this.slide],scene=slide.scene,changed=scene!==this.index;this.index=scene;this.frames++;
  // Only what changed is written (owner, build 98: «كمل الباقي بدقه»; each write restyles the presentation, and a slide of
  // the same chapter keeps the colours of the one before).
  const written=this.written||(this.written={}),write=(node,key,value,apply)=>{if(written[key]===value)return;written[key]=value;apply(node,value);};
  write(this.root,'grad',slide.gradient,(node,value)=>node.style.setProperty('--grad',value));
  if(written.accent!==slide.accent){written.accent=slide.accent;this.root.style.setProperty('--accent',slide.accent);this.root.style.setProperty('--glow',accentMix(slide.accent,.2));this.root.style.setProperty('--ring',accentMix(slide.accent,.75));}
  // A hero slide's photograph fills the LED screen behind the stage; the same photograph is not drawn again.
  if((this.led.dataset.photo||'')!==slide.photo){this.led.dataset.photo=slide.photo;this.led.querySelector(':scope>.ghc3-photo')?.remove();if(slide.photo)this.stage.insertAdjacentHTML('beforebegin',`<div class="ghc3-photo" style="--img:url('${esc(slide.photo)}')"></div>`);}
  this.stage.innerHTML=`<div class="ghc3-beat${slide.layout?` ghc3-${slide.layout}`:''}">${slide.html}</div>`;
  // The speaker's compact mark beside the chapter.
  // The hall's side screens show the same mark; an unchanged mark is not drawn again.
  for(const node of [this.brand,...this.sides]){if((node.dataset.logo||'')===slide.logo)continue;node.dataset.logo=slide.logo;node.style.setProperty('--logo',cssUrl(slide.logo));}
  // The next slide's photograph is fetched ahead so the dissolve never waits for it.
  const next=this.slides[this.slide+1];if(next?.photo)new Image().src=next.photo;
  this.root.querySelector('.ghc3-count').innerHTML=`${esc(slide.chapter)} <small>· <bdi dir="ltr">${this.slide+1}</bdi> من <bdi dir="ltr">${this.slides.length}</bdi></small>`;
  this.root.querySelector('[data-c3="prev"]').disabled=this.slide===0;this.root.querySelector('[data-c3="next"]').disabled=this.slide===this.slides.length-1;this.root.querySelector('[data-c3="finish"]').hidden=!this.config.live||this.slide!==this.slides.length-1;
  const progress=this.root.querySelector('.ghc3-progress');write(progress,'done',`${(this.slide+1)/this.slides.length*100}%`,(node,value)=>node.style.setProperty('--done',value));write(progress,'max',String(this.slides.length),(node,value)=>{node.setAttribute('aria-valuemin','1');node.setAttribute('aria-valuemax',value);});progress.setAttribute('aria-valuenow',String(this.slide+1));
  if(persist&&changed)this.persistProgress();}
 persistProgress(){const rejected=error=>{if(this.disposed)return;this.pause();this.config.onError?.(error);};try{const pending=this.config.onProgress?.({mode:this.mode,index:this.index,sceneId:this.scenes[this.index].id});if(pending?.then)pending.catch(rejected);}catch(error){rejected(error);}}
 go(slide){if(this.disposed||this.failed)return;const next=Math.max(0,Math.min(this.slides.length-1,slide));if(next===this.slide)return;this.slide=next;this.show();if(this.playing)this.schedule();}
 schedule(){clearTimeout(this.timer);if(!this.playing||document.hidden)return;this.timer=setTimeout(()=>{if(this.slide===this.slides.length-1)this.pause();else this.go(this.slide+1);},this.slides[this.slide].layout==='hero'?HERO_MS:SLIDE_MS);}
 play(){if(this.disposed||this.failed||!this.assetsReady)return;this.playing=true;this.root.dataset.playing='true';const b=this.root.querySelector('[data-c3="play"]');b.innerHTML=PAUSE;b.setAttribute('aria-label','إيقاف مؤقت');this.schedule();}
 pause(){this.playing=false;clearTimeout(this.timer);this.timer=0;const b=this.root?.querySelector('[data-c3="play"]');if(b){delete this.root.dataset.playing;b.innerHTML=PLAY;b.setAttribute('aria-label','تشغيل تلقائي');}}
 openPanel(){this.pause();this.panelMode='chapters';const panel=this.root.querySelector('.ghc3-panel');panel.hidden=false;this.root.querySelector('[data-c3="chapters"]').setAttribute('aria-expanded','true');
  const chapters=[];this.slides.forEach((s,i)=>{if(!chapters.length||chapters.at(-1).chapter!==s.chapter)chapters.push({chapter:s.chapter,slide:i});});const current=chapters.filter(c=>c.slide<=this.slide).at(-1);
  panel.querySelector('.ghc3-panel-content').innerHTML=chapters.map((c,i)=>`<button data-c3="slide-${c.slide}" ${c===current?'aria-current="step"':''}><small>${String(i+1).padStart(2,'0')}</small><span>${esc(c.chapter)}</span></button>`).join('');panel.querySelector('[data-c3="panel-close"]').focus();}
 closePanel(){this.root.querySelector('.ghc3-panel').hidden=true;this.root.querySelector('[data-c3="chapters"]').setAttribute('aria-expanded','false');this.panelMode=null;this.root.querySelector('[data-c3="chapters"]').focus();}
 keydown(e){if(e.key==='Escape'){e.preventDefault();if(this.panelMode)this.closePanel();else this.close();}else if(e.key==='ArrowLeft'){e.preventDefault();this.go(this.slide+1);}else if(e.key==='ArrowRight'){e.preventDefault();this.go(this.slide-1);}else if(e.key==='Tab'){const scope=this.panelMode?this.root.querySelector('.ghc3-panel'):this.root,items=[...scope.querySelectorAll('button:not([disabled])')].filter(el=>el.offsetParent!==null),first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}}
 action(action){if(this.finishing)return;if(action==='close')this.close();else if(action==='prev')this.go(this.slide-1);else if(action==='next')this.go(this.slide+1);else if(action==='play')this.playing?this.pause():this.play();else if(action==='chapters')this.openPanel();else if(action==='panel-close')this.closePanel();else if(action.startsWith('slide-')){this.go(Number(action.slice(6)));this.closePanel();}else if(action==='retry'){const config=this.config,options={startScene:this.index,mode:this.mode};this.close(false);launch({...config,owned:false},options);}else if(action==='finish')return this.finish();}
 // Completion owns the atomic transition to closing/completed. Keep the stage and its retry action until ACK.
 async finish(){if(this.disposed||this.finishing||!this.config.live||!this.assetsReady||this.phase!=='presenting'||this.slide!==this.slides.length-1)return;
  this.finishing=true;this.pause();this.root.setAttribute('aria-busy','true');const buttons=[...this.root.querySelectorAll('button')].map(button=>[button,button.disabled]);for(const [button] of buttons)button.disabled=true;
  try{await this.config.onFinish?.();if(!this.disposed){this.setPhase('closing');this.close(false);}}
  catch(error){if(!this.disposed){this.root.removeAttribute('aria-busy');for(const [button,disabled] of buttons)button.disabled=disabled;this.config.onError?.(error);}}
  finally{this.finishing=false;}
 }
 fail(error){this.failed=true;this.pause();this.lastError=String(error.message||error);this.root.querySelector('.ghc3-loading')?.remove();this.root.querySelector('.ghc3-recovery').hidden=false;this.root.querySelector('[data-c3="retry"]').focus();}
 diagnostics(){return{engine:'GH-CONFERENCE-2D',engineId:ENGINE_ID,version:VERSION,active:!this.disposed,failed:this.failed,phase:this.phase,planHash:this.planBundle?.planHash||null,chapter:this.scenes[this.index].id,chapters:this.scenes.length,slide:this.slide,slides:this.slides.length,frames:this.frames,webglFrames:0,scheduledFrame:false,playing:this.playing,pixelRatio:1,drawCalls:0,triangles:0,geometries:0,textures:0,assetsReady:!!this.assetsReady,error:this.lastError||null};}
 close(persist=true){if(this.disposed)return;if(persist&&['opening','presenting'].includes(this.phase))this.persistProgress();lastDiagnostics=this.diagnostics();if(this.phase==='closing')this.setPhase('closed',false);this.disposed=true;this.pause();for(const remove of this.events)remove();this.events=[];this.root?.remove();document.body.style.overflow=this.previousOverflow;for(const [el,inert] of this.siblings||[])if(el.isConnected)el.inert=inert;if(this.previousFocus?.isConnected)this.previousFocus.focus();if(active===this)active=null;this.config.onClose?.();}
}
function launch(config,options={}){if(!config?.snapshot?.group)throw new Error('conference-snapshot-required');active?.close();const session=new ConferenceSession(config,options);active=session;return session.mount();}
globalThis.GH_CONFERENCE_3D=Object.freeze({ENGINE_ID,VERSION,HALL,buildScenePlan:M.buildScenePlan,launch,isActive:()=>!!active&&!active.disposed,go:slide=>active?.go(slide),close:()=>active?.close(),diagnostics:()=>active?.diagnostics()||{...lastDiagnostics,active:false}});
})();
