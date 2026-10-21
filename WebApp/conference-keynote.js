/* The conference keynote: the archived snapshot told one idea per slide, in chapters, on the hall's LED screen. */
(()=>{'use strict';
const M=globalThis.GH_CONF_MODEL,{esc,number,usable}=M;
// The plan's scenes stay the archive's chapters (their hash is the record); each slide belongs to one scene, so a
// resumed conference opens on its scene's first slide. The text and figures come from the same frozen snapshot.
const PHOTO=Object.freeze({air:'air-widebody',sea:'ship-container',road:'truck-longhaul-v2',power:'company-energy-v2',bank:'company-bank-v2',telecom:'company-system-v2',insurance:'company-hq-v2',realestate:'company-hq-v2',mobility:'truck-urban',dealership:'truck-urban',hospitality:'company-hq-v2'});
const SECTOR=Object.freeze({air:'الطيران',sea:'الشحن البحري',road:'النقل البري',power:'الطاقة',bank:'الخدمات المصرفية',mobility:'التنقل',insurance:'التأمين',realestate:'العقار',telecom:'الاتصالات',dealership:'الوكالات',hospitality:'الضيافة'});
const GROUP_MARK='assets/identity/approved/group-symbol.webp',GROUP_GRADIENT='linear-gradient(100deg,#fff4dc,#e9c27a 45%,#c8963e)',GROUP_ACCENT='#c8963e';
const photo=type=>`assets/images/${PHOTO[type]||'company-hq-v2'}.webp`;
const ltr=value=>`<bdi dir="ltr">${esc(value)}</bdi>`,count=value=>Math.round(number(value)).toLocaleString('en-US');
function short(n){const a=Math.abs(n),[v,u]=a>=1e9?[a/1e9,'مليار']:a>=1e6?[a/1e6,'مليون']:a>=1e3?[a/1e3,'ألف']:[a,''];return [(n<0?'−':'')+Number(v.toFixed(a>=1e3?1:0)).toLocaleString('en-US'),u];}
const money=n=>{const [v,u]=short(number(n));return {v:ltr(v),u:u?`${u} دولار`:'دولار'};};
const compact=n=>{const [v,u]=short(number(n));return `${ltr(v)}${u?` ${u}`:''} دولار`;};
const shortHtml=n=>{const [v,u]=short(number(n));return `${ltr(v)}${u?` ${u}`:''}`;};
const pct=n=>ltr(`${Math.round(number(n))}%`),cents=n=>n>=3&&n<=10?`${n} سنتات`:`${n} سنتًا`;
const companies=n=>n===1?'شركة واحدة':n===2?'شركتان':n<=10?`${n} شركات`:`${n} شركة`;
const newCompanies=n=>n===1?'شركة جديدة':n===2?'شركتان جديدتان':n<=10?`${n} شركات جديدة`:`${n} شركة جديدة`;
function safeLogo(value){const logo=String(value||''),inspect=globalThis.GH_IDENTITY?.inspectCustomLogo;return logo&&typeof inspect==='function'&&inspect(logo).ok?logo:'';}
const safeColor=value=>/^#[0-9a-f]{3,8}$/i.test(String(value||''))?String(value):'';
function slides(snapshot,scenes){
 const g=snapshot?.group||{},year=Number(snapshot?.year)||0,social=snapshot?.social||{},plan=Array.isArray(scenes)?scenes:[],out=[];
 const rows=(snapshot?.companies||[]).map(c=>({c,t:String(c.type),name:String(c.tradeName||c.legalName||c.type),revenue:number(c.grossRevenue),expenses:number(c.expenses),net:number(c.net),margin:number(c.grossRevenue)>0?number(c.net)/number(c.grossRevenue)*100:null,ops:c.ops||{}}));
 const active=rows.filter(r=>usable(r.c)&&(r.revenue||r.expenses)).sort((a,b)=>b.net-a.net),idle=rows.filter(r=>!active.includes(r));
 const brandOf=type=>type==='group'?g.brand||{}:rows.find(r=>r.t===type)?.c.brand||{};
 const logo=type=>safeLogo(brandOf(type).variants?.mark)||safeLogo(brandOf(type).logo)||(type==='group'?GROUP_MARK:'');
 const gradient=type=>{const accent=type==='group'?'':safeColor(brandOf(type).accent);return accent?`linear-gradient(100deg,#ffffff,color-mix(in srgb,${accent} 70%,#fff) 55%,${accent})`:GROUP_GRADIENT;};
 // The solid colour the stage is lit with and the chapter ring is drawn in.
 const accent=type=>(type==='group'?'':safeColor(brandOf(type).accent))||GROUP_ACCENT;
 const sector=r=>SECTOR[r.t]||r.name;
 const sceneAt=id=>plan.findIndex(s=>s?.id===id),companyScene=type=>plan.findIndex(s=>s?.type===type);
 let chapter='';const add=(scene,slide)=>{if(scene>=0)out.push({scene,sceneId:plan[scene].id,chapter,type:'group',photo:'',layout:'',...slide});};
 const divider=(scene,no,title,sub='')=>{chapter=title;add(scene,{layout:'divider',html:`<div class="ghc3-no">${ltr(String(no).padStart(2,'0'))}</div><div class="ghc3-statement">${esc(title)}</div>${sub?`<div class="ghc3-cap">${sub}</div>`:''}`});};
 const value=(kicker,v,unit,cap='')=>`${kicker?`<div class="ghc3-kicker">${kicker}</div>`:''}<div class="ghc3-value">${v}</div>${unit?`<div class="ghc3-unit">${unit}</div>`:''}${cap?`<div class="ghc3-cap">${cap}</div>`:''}`;
 // The longest figure's width in characters (a <small> unit counts at its smaller size) sizes the figures to their tiles.
 const width=v=>{const html=String(v),small=(html.match(/<small>.*?<\/small>/g)||[]).join('').replace(/<[^>]*>/g,'').length;return html.replace(/<[^>]*>/g,'').replace(/&[#\w]+;/g,'x').length-small*.55;};
 const trio=items=>`<div class="ghc3-trio${items.length===2?' is-duo':''}" style="--chars:${Math.max(2,Math.ceil(Math.max(...items.map(([v])=>width(v)))))}">${items.map(([v,l])=>`<div><b>${v}</b><span>${l}</span></div>`).join('')}</div>`;
 const vchart=(revenue,expenses,net)=>{const max=Math.max(revenue,expenses,Math.abs(net),1),h=v=>Math.max(1.5,Math.abs(v)/max*80).toFixed(1),col=(v,cls,label)=>`<div><div class="ghc3-track"><i class="${cls}" style="height:${h(v)}%"></i><b style="bottom:calc(${h(v)}% + 1.2cqh)">${shortHtml(v)}</b></div><span>${label}</span></div>`;return `<div class="ghc3-vchart">${col(revenue,'','الإيرادات')}${col(expenses,'is-cost','المصروفات')}${col(net,net<0?'is-cost':'is-gain',net<0?'صافي الخسارة':'صافي الربح')}</div>`;};
 const stars=r=>`<div class="ghc3-stars">★★★★★<i style="width:${Math.max(0,Math.min(100,r/5*100)).toFixed(1)}%">★★★★★</i></div>`;
 const margin=number(g.grossRevenue)>0?number(g.net)/number(g.grossRevenue)*100:0,leader=active[0]||null,leaderShare=leader&&number(g.net)>0?leader.net/number(g.net)*100:0;
 const winners=active.filter(r=>r.net>0),losers=active.filter(r=>r.net<0),bestMargin=active.filter(r=>r.net>0&&r.margin!==null).sort((a,b)=>b.margin-a.margin)[0]||null;
 // Opening.
 chapter='الافتتاح';const opening=sceneAt('opening');
 add(opening,{html:`<img class="ghc3-logo" src="${esc(logo('group'))}" alt=""><div class="ghc3-cap">المؤتمر السنوي ${ltr(year)}</div>`});
 if(rows.length)add(opening,{photo:photo('group'),layout:'hero',html:`<div class="ghc3-kicker">${esc(g.name||'')}</div><div class="ghc3-statement">${companies(rows.length)}.<br><em>مجموعة واحدة.</em></div>`});
 // The year in figures.
 const results=sceneAt('group-results');divider(results,1,'العام في أرقام',g.complete?'':'نتائج أولية للفترة المسجلة');
 if(usable(g)){
  const r=money(g.grossRevenue),n=money(g.net);
  add(results,{html:value('الإيرادات',r.v,r.u)});add(results,{html:value(number(g.net)<0?'صافي الخسارة':'صافي الربح',n.v,n.u)});
  if(number(g.grossRevenue)>0&&number(g.net)>0)add(results,{html:value('',pct(margin),'هامش الربح',`كل دولار من الإيرادات ترك ${cents(Math.round(margin))} ربحًا صافيًا.`)});
  add(results,{html:`<div class="ghc3-title">من الإيراد إلى الربح</div>${vchart(number(g.grossRevenue),number(g.expenses),number(g.net))}`});
 }else add(results,{html:`<div class="ghc3-statement">البيانات قيد المراجعة.</div><div class="ghc3-cap">${esc(g.dataQuality?.reason||'لا توجد إقفالات مالية معتمدة لهذه الفترة.')}</div>`});
 add(results,{html:`<div class="ghc3-statement">${number(g.debt)>0?`ديون ${compact(g.debt)}.`:'<em>بلا ديون.</em>'}</div><div class="ghc3-cap">سيولة ${compact(g.cash)}${number(g.debt)>0?'':'، جاهزة للاستثمار'}.</div>`});
 {const [v,u]=short(number(g.groupValue));add(results,{html:trio([[`${ltr(v)}${u?`<small> ${u}</small>`:''}`,'قيمة المجموعة بالدولار'],[ltr(g.creditRating||'—'),'التصنيف الائتماني'],[`<bdi dir="ltr">${esc(Math.round(number(g.reputation)))}<small>/100</small></bdi>`,'السمعة']])});}
 // The portfolio.
 const portfolio=sceneAt('portfolio');divider(portfolio,2,'محفظة الأعمال');
 add(portfolio,{html:trio([[ltr(winners.length),winners.length===1?'شركة رابحة':'شركات رابحة'],[ltr(losers.length),losers.length===1?'شركة تتعافى':'شركات تتعافى'],[ltr(idle.length),'في مرحلة التأسيس']])});
 if(active.length){const max=Math.max(1,...active.map(r=>Math.abs(r.net)));add(portfolio,{html:`<div class="ghc3-title">من صنع الربح</div><div class="ghc3-bars">${active.slice(0,4).map((r,i)=>`<div class="ghc3-bar${r.net<0?' is-loss':i===0?' is-lead':''}"><span>${esc(r.name)}</span><div class="ghc3-track"><i style="width:${Math.max(1.2,Math.abs(r.net)/max*100).toFixed(1)}%"></i></div><b>${shortHtml(r.net)}</b></div>`).join('')}</div>`});}
 // The operating companies, leader first; each slide belongs to the company's own scene.
 const first=active.find(r=>companyScene(r.t)>=0);
 if(first)divider(companyScene(first.t),3,'شركاتنا العاملة',`${companies(active.length)} تقود نتائج ${ltr(year)}`);
 for(const r of active){const scene=companyScene(r.t);if(scene<0)continue;chapter=r.name;const one=slide=>add(scene,{type:r.t,...slide}),m=money(r.net),o=r.ops,c=r.c;
  if(r.net<0)one({photo:photo(r.t),layout:'hero',html:`<div class="ghc3-kicker">${esc(r.name)}</div><div class="ghc3-statement">على طريق<br><em>التعادل.</em></div><div class="ghc3-cap">${compact(-r.net)} تفصلها عن نقطة التعادل.</div>`});
  else if(r===leader)one({photo:photo(r.t),layout:'hero',html:value(esc(r.name),m.v,m.u,`صافي الربح · ${leaderShare>=95?'أرباح المجموعة كلها تقريبًا':`${pct(leaderShare)} من أرباح المجموعة`}`)});
  else if(r===bestMargin)one({photo:photo(r.t),layout:'hero',html:value(esc(r.name),pct(r.margin),'هامش الربح',`الأعلى في المجموعة · صافي ${compact(r.net)}`)});
  else one({html:`${logo(r.t)?`<img class="ghc3-logo is-small" src="${esc(logo(r.t))}" alt="">`:''}${value(esc(r.name),r.margin===null?m.v:pct(r.margin),r.margin===null?m.u:'هامش الربح',`صافي ${compact(r.net)}`)}`});
  if(r.revenue>=1000)one({html:`<div class="ghc3-title">${r.net<0?'المصروفات تسبق الإيرادات':'من الإيراد إلى الربح'}</div>${vchart(r.revenue,r.expenses,r.net)}${r.net>0&&number(g.grossRevenue)>0?`<div class="ghc3-cap">هامش ${pct(r.margin)} مقابل ${pct(margin)} للمجموعة.</div>`:''}`});
  const ops=[[o.assetCount,'أصل'],[o.routeCount,'مسار'],[o.tripCount,'رحلة']].filter(([v])=>number(v)>=10);
  if(ops.length>=2)one({html:`${trio(ops.map(([v,l])=>[ltr(count(v)),l]))}${number(o.activeAssets)&&number(o.activeAssets)===number(o.assetCount)?'<div class="ghc3-cap">كل الأصول في الخدمة.</div>':''}`});
  if(number(o.liquidity)>0){const l=money(o.liquidity);one({html:value(`سيولة ${esc(r.name)}`,l.v,l.u,number(o.corporateClients)?`تخدم ${ltr(count(o.corporateClients))} عميلًا من الشركات.`:'')});}
  if(number(o.policies)>=10)one({html:trio([[ltr(count(o.policies)),'وثيقة سارية'],...(number(o.premium30)>=10?[[ltr(count(o.premium30)),'دولار أقساط 30 يومًا']]:[])])});
  if(number(c.customerBase)>=10)one({html:value('',ltr(count(c.customerBase)),'عميل',`قاعدة عملاء ${esc(r.name)} المسجلة.`)});
  const rating=c.customerRating;if(rating?.components&&number(rating.rating)>0&&(r===leader||r===bestMargin))one({html:`<div class="ghc3-kicker">تقييم العملاء</div><div class="ghc3-value is-compact">${ltr(number(rating.rating).toFixed(1))}</div>${stars(number(rating.rating))}<div class="ghc3-parts">${[['reputation','السمعة'],['service','الخدمة'],['operations','التشغيل']].map(([k,l])=>`<div><b>${ltr(Math.round(number(rating.components[k])))}</b><span>${l}</span><div class="ghc3-track"><i style="width:${Math.max(0,Math.min(100,number(rating.components[k])))}%"></i></div></div>`).join('')}</div>`});
  if(number(c.headcount)>0)one({html:value('',ltr(count(c.headcount)),'موظف',r.net>0?`ربح ${compact(r.net/number(c.headcount))} لكل موظف.`:'')});
 }
 // Customers, reputation, people and the companies being founded.
 const peopleScene=sceneAt('people');divider(peopleScene,4,'العملاء والسمعة');
 if(number(g.customerRating?.rating)>0)add(peopleScene,{html:`<div class="ghc3-kicker">تقييم العملاء للمجموعة</div><div class="ghc3-value">${ltr(number(g.customerRating.rating).toFixed(1))}</div>${stars(number(g.customerRating.rating))}<div class="ghc3-cap">من 5${g.customerRating.confidence?` · ${esc(g.customerRating.confidence)}`:''}</div>`});
 add(peopleScene,{html:value('',ltr(Math.round(number(g.reputation))),'من 100',`سمعة ${esc(g.name||'المجموعة')} في السوق.`)});
 const people=Number.isFinite(Number(g.totalHeadcount))?number(g.totalHeadcount):number(g.headcount)+rows.reduce((n,r)=>n+number(r.c.headcount),0);
 if(people>0){divider(peopleScene,5,'فريقنا');const staffed=rows.filter(r=>number(r.c.headcount)>0);add(peopleScene,{html:value('',ltr(count(people)),'موظف في المجموعة',staffed.length===1?`جميعهم في ${esc(staffed[0].name)}.`:staffed.slice(0,6).map(r=>esc(r.name)).join('، '))});}
 if(idle.length){chapter='مرحلة التأسيس';add(peopleScene,{html:`<div class="ghc3-statement"><em>${newCompanies(idle.length)}</em><br>جاهزة للانطلاق.</div><div class="ghc3-logos">${idle.map(r=>logo(r.t)?`<img src="${esc(logo(r.t))}" alt="">`:'').join('')}</div>`});}
 const achievements=sceneAt('achievements');if(achievements>=0){chapter='إنجازات العام';const items=(snapshot.achievements||[]).slice(0,3);add(achievements,{html:`<div class="ghc3-title">إنجازات العام</div><div class="ghc3-list">${items.map((a,i)=>`<div><b>${ltr(i+1)}</b><h4>${esc(a.title)}</h4><p>${esc(a.detail)}</p></div>`).join('')}</div>`});}
 // The year ahead: the approved targets, then the priorities the figures point to.
 const outlook=sceneAt('outlook');divider(outlook,6,`نحو ${year+1}`);
 if(number(g.targetRevenue)>0||number(g.targetMargin)>0)add(outlook,{html:trio([...(number(g.targetRevenue)>0?[[compact(g.targetRevenue),'هدف الإيرادات']]:[]),...(number(g.targetMargin)>0?[[pct(g.targetMargin),'هامش الربح المستهدف']]:[])])});
 {const items=[];if(leader&&leaderShare>=50)items.push([`ريادة ${esc(sector(leader))}`,'نبني على أكبر محرك للربح.']);
  if(idle.length)items.push([`إطلاق ${newCompanies(idle.length)}`,'دخل أوسع ومخاطر أقل.']);
  if(rows.length&&number(g.officialManagerCoverage)<100)items.push(['قيادة لكل شركة','تعيين رؤساء تنفيذيين.']);
  items.push(losers.length?[`تعادل ${esc(sector(losers[0]))}`,`خلال ${ltr(year+1)}.`]:['هامش أعلى','كفاءة في كل شركة.']);
  add(outlook,{html:`<div class="ghc3-title">أولوياتنا</div><div class="ghc3-list">${items.slice(0,3).map(([h,p],i)=>`<div><b>${ltr(i+1)}</b><h4>${h}</h4><p>${p}</p></div>`).join('')}</div>`});}
 // How the conference was received.
 const audience=sceneAt('audience');divider(audience,7,'صدى المؤتمر');
 add(audience,{html:trio([[ltr(count(social.viewers)),'مشاهدة للبث'],[ltr(count(social.attendees)),'حاضر في القاعة'],[ltr(count(social.likes)),'إعجاب']])});
 {const p=number(social.positive),n=number(social.neutral),x=number(social.negative);if(p+n+x>0)add(audience,{html:`${value('',pct(p),'انطباع إيجابي')}<div class="ghc3-split"><i style="flex:${p};background:#30d158"></i><i style="flex:${n};background:#8e8e93"></i><i style="flex:${x};background:#ff6961"></i></div><div class="ghc3-legend"><span style="--c:#30d158">إيجابي <b>${pct(p)}</b></span><span style="--c:#8e8e93">محايد <b>${pct(n)}</b></span><span style="--c:#ff6961">سلبي <b>${pct(x)}</b></span></div>`});}
 const comments=Array.isArray(social.comments)?social.comments:[];
 for(const row of comments.filter(row=>row?.lang==='AR'||/[؀-ۿ]/.test(String(row?.text||''))).slice(0,2))add(audience,{html:`<div class="ghc3-quote">«${esc(row.text)}»</div><div class="ghc3-cap">${esc(row.handle)} · ${esc(row.country)}</div>`});
 const countries=[...new Set(comments.map(row=>String(row?.country||'')).filter(Boolean))];if(countries.length)add(audience,{html:`<div class="ghc3-title">تعليقات من ${ltr(countries.length)} ${countries.length<=10&&countries.length>2?'دول':'دولة'}</div><div class="ghc3-chips">${countries.map(c=>`<span>${esc(c)}</span>`).join('')}</div>`});
 chapter='الختام';add(sceneAt('closing'),{html:`<img class="ghc3-logo" src="${esc(logo('group'))}" alt=""><div class="ghc3-statement">شكرًا لكم.</div>`});
 // A group scene with nothing to show still gets its headline (a company's scenes share its slides, and a company
 // being founded is on the founding slide).
 for(let i=0;i<plan.length;i++)if((!plan[i]?.type||plan[i].type==='group')&&!out.some(s=>s.scene===i)){const s=plan[i];chapter=String(s.title||'');const at=out.findIndex(row=>row.scene>i);const slide={scene:i,sceneId:s.id,chapter,type:s.type&&s.type!=='group'?String(s.type):'group',photo:'',layout:'',html:`<div class="ghc3-kicker">${esc(s.title)}</div><div class="ghc3-statement">${esc(s.headline||s.title)}</div>${s.caption?`<div class="ghc3-cap">${esc(s.caption)}</div>`:''}`};if(at<0)out.push(slide);else out.splice(at,0,slide);}
 return out.map(s=>({...s,gradient:gradient(s.type),accent:accent(s.type),logo:logo(s.type)||logo('group')}));
}
globalThis.GH_CONF_KEYNOTE=Object.freeze({slides,photo,safeLogo});
if(typeof module!=='undefined'&&module.exports)module.exports=globalThis.GH_CONF_KEYNOTE;
})();
