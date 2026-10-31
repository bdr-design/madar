/* Build 333 Atlas Executive presentation. Business commands retain their atomic owners. */
(()=>{'use strict';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Build 373: every option shows its own tile from the MADAR icon family (madar-icons.js). A page opened for one company
// or one tab takes that option's icon, so "buy aircraft" and "buy ships" never share a mark.
const PANEL_ICONS=Object.freeze({
 map:'map',company:'dashboard',groupHub:'group',financeHub:'finance',systemHub:'settings',companies:'office',companyManage:'manage',groupManagement:'performance',formationContract:'charter',
 network:'directory',expansion:'facilities',companyFacilities:'facilities',facilityManage:'facilities',ports:'port',routes:'routes',globalRoute:'routes',
 assets:'fleet-all',assetMarket:'market',assetManage:'asset',mobilityAsset:'fleet-car',procurement:'deliveries',maintenance:'maintenance',contracts:'contracts',
 energy:'energy-dash',bank:'bank',insurance:'umbrella',realestate:'house',hospitality:'house',serviceCompany:'performance',
 finance:'finance',monthlyFinance:'monthly-income',treasury:'treasury',budgets:'budget',invoices:'documents',market:'markets',stocks:'stocks',
 leadershipHub:'leadership',actionCenter:'tasks',peopleHub:'people',labor:'people-dash',crews:'crews',compliance:'safety',conference:'conference',research:'research',esg:'esg',businessWorld:'relations',realism:'economy',news:'news',
 settings:'settings',investorMode:'treasury',updates:'updates',diagnostics:'diagnostics',controlPlane:'control-plane'
});
const ARG_ICONS=Object.freeze({
 labor:{dashboard:'people-dash',workforce:'people-dash',managers:'executive',jobs:'jobs',contracts:'employment',payroll:'payroll'},
 assets:{air:'fleet-air',sea:'fleet-sea',road:'fleet-road',mobility:'fleet-car',all:'fleet-all'},
 assetMarket:{air:'buy-air',sea:'buy-sea',road:'buy-road',mobility:'buy-car'},
 routes:{air:'route-air',sea:'route-sea',road:'route-road',mobility:'route-city'},
 companyFacilities:{air:'tower',sea:'port',road:'warehouse',mobility:'city-branch',power:'power-site',bank:'atm',insurance:'office',realestate:'office',telecom:'antenna',dealership:'showroom'},
 contracts:{air:'contract-air',sea:'contract-sea',road:'contract-road',power:'tender'},
 crews:{air:'pilot',sea:'captain',road:'driver'},
 market:{deals:'acquisitions'},
 energy:{projects:'solar',overview:'energy-dash',operations:'grid',control:'contract-power',revenue:'revenue'},
 bank:{credit:'credit',overview:'bank',branches:'atm',control:'liquidity',revenue:'revenue'},
 insurance:{overview:'umbrella',lines:'pricing',offices:'office',claims:'claims'},
 realestate:{overview:'house',projects:'construction',develop:'develop'}
});
const argKey=arg=>{if(arg&&typeof arg==='object')return String(arg.tab||arg.type||arg.company||'');const text=String(arg??'');if(text.startsWith('{')){try{const value=JSON.parse(text);return String(value?.tab||value?.type||value?.company||'');}catch(_error){return '';}}return text.split(':')[0];};
const iconFor=(panel,arg)=>ARG_ICONS[String(panel||'')]?.[argKey(arg)]||PANEL_ICONS[String(panel||'')]||'group';
const iconMarkup=(panel,arg)=>globalThis.GH_ICONS?.tile(iconFor(panel,arg))||'';
const domainForPanel=panel=>{
 const key=String(panel||'');
 if(['network','routes','globalRoute','assets','assetMarket','assetManage','mobilityAsset','companyFacilities','facilityManage','expansion','ports','procurement','maintenance','contracts'].includes(key))return'operations';
 if(['groupHub','companies','companyManage','groupManagement','formationContract','energy','bank','insurance','realestate'].includes(key))return'companies';
 if(['financeHub','finance','monthlyFinance','treasury','budgets','invoices','market'].includes(key))return'finance';
 if(['leadershipHub','actionCenter','peopleHub','labor','crews','compliance','conference','research','esg','businessWorld','realism','news'].includes(key))return'leadership';
 if(['systemHub','settings','investorMode','updates','diagnostics','controlPlane'].includes(key))return'system';
 return'map';
};
const history=[];let returning=false,pending=null;
function historyButton(){const b=document.getElementById('workspaceBack');if(b)b.hidden=history.length<2;}
function navigate(panel,arg){const key=JSON.stringify([panel,arg??null]);if(returning)returning=false;else if(history.at(-1)?.key!==key){history.push({key,panel,arg});if(history.length>30)history.shift();}historyButton();}
function back(open){if(history.length<2)return;history.pop();const row=history.at(-1);returning=true;open(row.panel,row.arg);historyButton();}
function resetHistory(){history.length=0;historyButton();}
const card=(panel,title,copy,arg)=>`<button class="command-btn" data-open="${esc(panel)}"${arg===undefined?'':` data-arg="${esc(arg)}"`}><span>${iconMarkup(panel,arg)}</span><div><b>${esc(title)}</b><small>${esc(copy)}</small></div><em aria-hidden="true">←</em></button>`;
function hub(panel,ctx){
if(panel==='labor'&&String(ctx.currentArg||'').startsWith('managers'))return managerView(ctx);
return null;}
function managerView(ctx){
 const s=ctx.state,H=globalThis.GH_HR_CORE,opened=globalThis.GH_COMPANY_PLATFORM?.listInstances?.(s,{includeGroup:false,openedOnly:true,capability:'hr.management'}).filter(c=>c.operational).map(c=>c.id)||(s.openedCompanies||[]).filter(c=>H.MANAGER_COMPANIES.includes(c)),requested=String(ctx.currentArg||'').split(':')[1],company=opened.includes(requested)?requested:opened[0],current=company?H.officialManager(s,company):null;
 const actionAttr=id=>{try{return globalThis.GH_ADVANCED?.actionAttributes?.(id)||'disabled';}catch(_error){return 'disabled';}};
 const nav=`<div class="tabs">${(globalThis.GH_ADVANCED?.LABOR_TABS||[['dashboard','لوحة HR'],['managers','مديرو الشركات']]).map(([key,title])=>`<button class="tab-btn ${key==='managers'?'active':''}" data-labortab="${key}">${title}</button>`).join('')}</div>`;
 if(!company)return nav+'<div class="empty">افتح شركة تابعة أولًا لتعيين مديرها التنفيذي.</div>';
 return nav+`<article class="ui-card ui-manager-bulk"><div class="list-item-head"><div><h3>تعيين جماعي</h3><small>أفضل مرشح متاح لكل شركة شاغرة، في اعتماد واحد.</small></div><button class="primary-btn" ${actionAttr('hr-appoint-all-managers')}>تعيين مديري جميع الشركات</button></div></article><label class="ui-owner-label">الشركة<select id="uiManagerCompany">${opened.map(c=>`<option value="${esc(c)}" ${c===company?'selected':''}>${esc(globalThis.GH_IDENTITY?.legalName?.(s,c)||s.companyRegistry?.[c]?.legalName||ctx.typeName(c))}</option>`).join('')}</select></label><article class="ui-card ui-manager-current"><div class="list-item-head"><div><small>المدير الحالي</small><h3>${esc(current?.name||'المنصب شاغر')}</h3></div><span class="tag ${current?'positive':''}">${current?'معيّن':'بانتظار التعيين'}</span></div>${current?`<small>عقد ${esc(current.contractId)}</small><button class="secondary-btn" ${actionAttr('hr-dismiss-manager')} data-company="${esc(company)}">إنهاء التكليف</button>`:''}</article><div class="official-manager-candidate-grid">${H.officialManagerCandidates(s,company).map(c=>`<article class="ui-card manager-candidate" data-company="${esc(company)}"><div class="list-item-head"><div><h3>${esc(c.name)}</h3><small>${esc(c.city)} · ${esc(c.role)}</small></div><span class="tag">${c.skill}/100</span></div><div class="metric-row"><div><span>الراتب السنوي</span><b>${esc(ctx.fmtMoney(c.salary))}</b></div><div><span>الخبرة</span><b>${c.experience} سنة</b></div></div><p>${esc(c.specialty)} · ${esc(c.style)}</p><button class="primary-btn" ${actionAttr('hr-appoint-manager')} data-company="${esc(company)}" data-candidate="${esc(c.id)}" ${c.appointed?'disabled title="المدير الحالي للشركة"':''}>${c.appointed?'معيّن رسميًا':current?'مراجعة الاستبدال':'مراجعة عقد التعيين'}</button></article>`).join('')}</div>`;
}
function prepare(root,panel,arg,ctx){root.dataset.panel=panel;delete root.dataset.company;const drawer=document.getElementById('drawer');if(drawer)drawer.dataset.domain=domainForPanel(panel);const title={companies:'المجموعة والشركات',finance:'المركز المالي',labor:String(arg||'').startsWith('managers')?'المديرون التنفيذيون':'الموارد البشرية'}[panel];if(title)document.getElementById('drawerTitle').textContent=title;
const replacement=hub(panel,ctx);if(replacement!==null)root.innerHTML=replacement;const companySelect=root.querySelector('#uiManagerCompany');if(companySelect)companySelect.onchange=()=>ctx.openDrawer('labor','managers:'+companySelect.value);
root.querySelectorAll('.command-btn[data-open]').forEach(button=>{const panelName=button.dataset.open,mark=button.querySelector(':scope>span')||document.createElement('span');if(!mark.parentElement)button.prepend(mark);mark.classList.add('command-mark');const icon=iconFor(panelName,button.dataset.arg);if(mark.firstElementChild?.dataset?.icon!==icon)mark.innerHTML=iconMarkup(panelName,button.dataset.arg);button.dataset.optionLogo=icon;});
root.querySelectorAll('[style]').forEach(el=>{if(el.namespaceURI!=='http://www.w3.org/1999/xhtml'||el.closest('.financial-paper,.invoice-paper,.authority-paper,.authorization-paper'))return;for(const key of ['background','background-color','background-image','color','box-shadow','text-shadow','border-color'])el.style.removeProperty(key);});
if(panel==='finance'){const overview=root.querySelector('.finance-overview-v202');if(overview){const d=document.createElement('details');d.className='ui-more';d.innerHTML='<summary>نطاق الحسابات والديون</summary>';overview.before(d);d.append(overview);}root.querySelector('.finance-domain-nav')?.classList.add('ui-finance-tools');}
root.querySelectorAll('.company-identity-editor').forEach(editor=>{const tools=editor.nextElementSibling,details=document.createElement('details');details.className='ui-more';const summary=document.createElement('summary');summary.textContent='تعديل الاسم والشعار';details.append(summary);editor.before(details);details.append(editor);if(tools?.classList.contains('company-logo-actions'))details.append(tools);});
root.querySelectorAll('.company-visual-card').forEach(el=>{const photo=el.querySelector(':scope>img'),body=el.querySelector('.company-visual-body'),heading=body?.querySelector('h3');if(!photo||!body||!heading)return;const identity=document.createElement('header');identity.className='ui-company-row';const copy=document.createElement('div'),company=el.dataset.company;if(company&&globalThis.GH_IDENTITY?.logoMarkup)identity.insertAdjacentHTML('beforeend',globalThis.GH_IDENTITY.logoMarkup(ctx.state,company,'small'));copy.append(heading);const p=body.querySelector('p');if(p)copy.append(p);identity.append(photo,copy);el.prepend(identity);el.classList.add('ui-card');const detail=document.createElement('details');detail.className='ui-more';const summary=document.createElement('summary');summary.textContent='الأداء والإجراءات';detail.append(summary);el.append(detail);detail.append(body);});
root.querySelectorAll('.eyebrow').forEach(e=>{if(/BUILD|DOMAIN|CORE|CENTER|WORKSPACE|V\d|\d+\.\d+\.\d+/i.test(e.textContent))e.textContent='المجموعة العالمية';});root.querySelectorAll('img').forEach(img=>{img.decoding='async';if(!img.alt)img.alt='';});
globalThis.GH_FINANCE_PRESENTATION?.prepare(root);
globalThis.GH_MADAR?.decorate?.(root,panel,arg,ctx);
const selected=root.querySelector('.tabs .active,.hr-manager-company-tabs .active');if(selected&&!selected.parentElement?.classList.contains('mc-in-strip'))requestAnimationFrame(()=>{const parent=selected.parentElement;if(selected.isConnected&&root.contains(selected)&&parent&&!parent.classList.contains('mc-in-strip'))parent.scrollLeft=selected.offsetLeft-parent.offsetLeft;});}
// The decision dialog (owner-approved design, «ادمج معه صور بطريقة عصرية وبدون ثقل»). Presentation only: the message
// is the caller's text, shown whole; the result, the records and the one-dialog guard are unchanged.
//   · a message with figures ("label: value" lines, a total) opens as a split card: the decision over a photo on one side,
//     the total and the lines with the buttons on the other;
//   · any other message opens as one centred card under a photo banner;
//   · the photo is one of the game's own 640×360 images, chosen by the action, else by the open page or company; one
//     image per dialog, decoded off the main path; a missing image leaves the navy ground.
const arEn=(ar,en)=>globalThis.GH_I18N?.L?.(ar,en)??ar;
// A money figure or a Latin name inside an Arabic sentence reads left to right as one unit («مقابل $750.0K؟»,
// «بيع Boeing 787-9 ANI-204؟»).
// Isolated on the raw text, each piece escaped after (an escape such as &amp; is never split).
// A run never ends on "." or "," (a sentence's full stop stays at the sentence's end).
const LTR_RUN=/[−-]?\$\d(?:[\d.,]*\d)?(?:[KMBT])?|[A-Za-z](?:[A-Za-z0-9.\-]*[A-Za-z0-9])?(?: [A-Za-z0-9](?:[A-Za-z0-9.\-]*[A-Za-z0-9])?)*/g;
const isolateText=text=>{const raw=String(text??'');if(globalThis.GH_I18N?.isEn?.())return esc(raw);let out='',last=0;for(const m of raw.matchAll(LTR_RUN)){out+=esc(raw.slice(last,m.index))+`<bdi dir="ltr">${esc(m[0])}</bdi>`;last=m.index+m[0].length;}return out+esc(raw.slice(last));};
const CONFIRM_ACTION_IMAGES=Object.freeze({'open-facilities-by-scope':'facility-port-v2','open-all-companies':'company-hq-v2','launch-ipo':'finance-markets','dividend-policy':'finance-markets','collect-all-receivables':'finance-documents','sell-mobility-asset':'mobility-hero','load-slot':'company-system-v2','hr-appoint-all-managers':'people-recruit','hr-official-manager':'people-recruit','progression-licence':'company-system-v2','conference-prepare':'lead-news','investor-card-return':'bank-vault','investor-card-return-all':'bank-vault'});
const CONFIRM_PANEL_IMAGES=Object.freeze({treasury:'bank-vault',investorMode:'bank-vault',invoices:'finance-documents',finance:'finance-budget',monthlyFinance:'finance-budget',budgets:'finance-documents',stocks:'finance-markets',market:'finance-markets',settings:'company-system-v2',progression:'company-system-v2',labor:'people-recruit',crews:'people-team',conference:'lead-news',news:'lead-news',businessWorld:'lead-partners',compliance:'lead-security',research:'lead-rnd',esg:'lead-esg',companies:'company-hq-v2',network:'facility-airport-v2',expansion:'facility-port-v2',realestate:'realestate-hero',hospitality:'realestate-hero',bank:'bank-credit',insurance:'insurance-hero',energy:'energy-solar',mobilityAsset:'mobility-hero',procurement:'company-system-v2'});
function confirmImage(state,action,explicit){
 const name=String(explicit||CONFIRM_ACTION_IMAGES[action]||(()=>{const row=history.at(-1);if(!row)return '';try{const M=globalThis.GH_MADAR,place=M?.locate?.(state,row.panel,row.arg);const img=place?.company?M.KINDS?.[M.kindOf(state,place.company)]?.hero?.img:'';if(img)return img;}catch(_error){}return CONFIRM_PANEL_IMAGES[row.panel]||'';})()||'group-boardroom');
 return /^[a-z0-9-]+$/.test(name)?`assets/images/ui/${name}.webp`:'assets/images/ui/group-boardroom.webp';
}
// "label: value" (a short label, a short value, no sentence) is one line of figures.
const confirmRow=line=>{const m=/^([^:.؟]{1,42}):\s*(\S.{0,43}?)\.?$/.exec(line);return m&&!/[.؟?]$/.test(m[2])?{label:m[1].trim(),value:m[2].trim()}:null;};
const CONFIRM_TOTAL=/^(إجمالي|الإجمالي|المجموع)/;
// The message, read into the question, the lines of figures, the total and the closing note. Every word of the message
// stays in one of them.
function confirmParts(message){
 const blocks=String(message??'').split(/\n\s*\n/).map(block=>block.split('\n').map(line=>line.trim()).filter(Boolean)).filter(block=>block.length);
 const question=[],rows=[],notes=[];
 blocks.forEach((block,index)=>{
  const last=index>0&&index===blocks.length-1;
  if(index>0&&block.every(confirmRow)&&(!last||block.every(line=>/\d/.test(confirmRow(line).value)))){rows.push(...block.map(confirmRow));return;}
  if(last){notes.push(...block);return;}
  question.push(...block);
 });
 const at=rows.findIndex(row=>CONFIRM_TOTAL.test(row.label)),total=at>=0?rows.splice(at,1)[0]:null;
 return {question,rows,total,notes};
}
const CONFIRM_ICON={normal:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7L10 17l-5-5"/></svg>',risk:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v10"/><path d="M12 19v.01"/></svg>',note:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.01"/></svg>'};
function confirmMarkup(message,{title,accept,risk,image}){
 const parts=confirmParts(message),high=risk==='high'||risk==='critical';
 const chip=high?arEn('قرار مؤثر','High-impact decision'):risk==='financial'?arEn('قرار مالي','Financial decision'):risk==='personnel'?arEn('قرار إداري','Management decision'):arEn('يحتاج تأكيدك','Needs your confirmation');
 const question=`<p class="dx-q">${parts.question.map(line=>isolateText(line)).join('<br>')}</p>`;
 const note=parts.notes.length?`<div class="dx-note">${CONFIRM_ICON.note}<span>${parts.notes.map(line=>isolateText(line)).join(' ')}</span></div>`:'';
 const media=cls=>`<div class="dx-media ${cls}"><img src="${esc(image)}" alt="" decoding="async"></div>`;
 const actions=`<div class="dx-acts"><button type="button" class="dx-btn dx-ok" data-confirm="accept">${esc(accept)}</button><button type="button" class="dx-btn dx-no" data-confirm="cancel">${esc(arEn('إلغاء','Cancel'))}</button></div>`;
 const heading=`<span class="dx-chip"><i></i>${esc(chip)}</span><h2 id="uiConfirmTitle">${esc(title)}</h2>`;
 if(parts.rows.length||parts.total){
  const lines=parts.rows.map(row=>{const m=/^(\d[\d,]*)\s*·\s*(.+)$/.exec(row.value);return `<li><span>${isolateText(row.label)}</span>${m?`<em><bdi dir="ltr">×${esc(m[1])}</bdi></em><b>${isolateText(m[2])}</b>`:`<b>${isolateText(row.value)}</b>`}</li>`;}).join('');
  return {variant:'split',high,html:`<div class="dx-info">${media('dx-photo')}<div class="dx-copy">${heading}${question}${note}</div></div><div class="dx-sum">${parts.total?`<div class="dx-total"><small>${isolateText(parts.total.label)}</small><b>${isolateText(parts.total.value)}</b></div>`:''}${lines?`<ul class="dx-lines">${lines}</ul>`:''}${actions}</div>`};
 }
 const money=parts.question.join(' ').match(/[−-]?\$\d[\d.,]*[KMBT]?/g)||[];
 return {variant:'solo',high,html:`${media('dx-banner')}<span class="dx-badge">${high?CONFIRM_ICON.risk:CONFIRM_ICON.normal}</span>${heading}${question}${money.length===1?`<b class="dx-amount" aria-hidden="true"><bdi dir="ltr">${esc(money[0])}</bdi></b>`:''}${note}${actions}`};
}
function confirm(message,{title='مراجعة القرار',accept='تأكيد',state,action='hr-official-manager',risk='personnel',image}={}){if(pending)return Promise.resolve(false);return new Promise(resolve=>{const dialog=document.createElement('dialog');const view=confirmMarkup(message,{title,accept,risk,image:confirmImage(state,action,image)});dialog.className=`ui-confirm dx dx-${view.variant}${view.high?' risk':''}`;dialog.dir=globalThis.GH_I18N?.dir?.()||'rtl';dialog.setAttribute('aria-labelledby','uiConfirmTitle');dialog.innerHTML=view.html;dialog.querySelectorAll('.dx-media img').forEach(img=>img.addEventListener('error',()=>img.remove(),{once:true}));const prior=document.activeElement;let done=false;const finish=accepted=>{if(done)return;done=true;pending=null;globalThis.GH_WORKFLOW?.record?.(state,accepted?'WORKFLOW_CONFIRM_ACCEPTED':'WORKFLOW_CONFIRM_CANCELLED',{action,risk});dialog.close();dialog.remove();if(prior?.isConnected)prior.focus();resolve(accepted);};pending=finish;document.body.append(dialog);globalThis.GH_WORKFLOW?.record?.(state,'WORKFLOW_CONFIRM_SHOWN',{action,risk});dialog.querySelector('[data-confirm=cancel]').onclick=()=>finish(false);dialog.querySelector('[data-confirm=accept]').onclick=()=>finish(true);dialog.addEventListener('cancel',e=>{e.preventDefault();finish(false);});dialog.addEventListener('close',()=>finish(false));dialog.showModal();dialog.querySelector('[data-confirm=cancel]').focus();});}
// Build 373: the map fills the screen and the chrome floats over it, so the visible map is the map's rectangle
// below the top bar and left of the rail or of the open panel. Centring (panMapTo) uses this rectangle.
function mapViewport(){
 const rect=document.getElementById('map').getBoundingClientRect(),box=selector=>{const node=document.querySelector(selector);if(!node)return null;const r=node.getBoundingClientRect();return r.width&&r.height?r:null;};
 let left=rect.left,top=rect.top,right=rect.right,bottom=rect.bottom;
 const bar=box('.topbar'),rail=box('.side-nav'),panel=box('.sheet-dock');
 if(bar)top=Math.max(top,bar.bottom);if(rail)right=Math.min(right,rail.left);if(panel)right=Math.min(right,panel.left);
 return {left,top,right,bottom,width:Math.max(0,right-left),height:Math.max(0,bottom-top)};
}
globalThis.GH_INTERFACE=Object.freeze({VERSION:'2.0.0',prepare,navigate,back,resetHistory,confirm,mapViewport});
})();
