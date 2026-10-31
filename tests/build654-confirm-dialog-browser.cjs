'use strict';
// Owner (approved design: «ادمج معه صور بطريقة عصرية وبدون ثقل»): the decision dialog, with the game's own images and
// fonts (served locally), on the iPhone landscape sizes 844×390 and 667×375:
//   1. a message with figures opens as a split card: the decision (chip, title, the one <p> question, the closing note)
//      over a photo, the total and its lines (count chip, amount) beside the buttons; a high-impact decision is red, a
//      financial one navy; the card is light (its own colours, outside the app shell) over a dimmed map;
//   2. any other message opens as one centred card under a photo banner; a single amount in the question is shown large,
//      two amounts show none;
//   3. no word of the message is lost or added, for the real message formats (facility scope with exclusions, opening
//      companies, dividends, investor return, asset sale, receivables);
//   4. a Latin name or an amount reads left to right as one unit, and the message is text, never markup ("<b>", "&");
//   5. the photo follows the action, else the open page, else the open company's own image, else the boardroom; an
//      unsafe image name falls back; a missing image is removed and leaves the navy ground, with no page error; one
//      image per dialog;
//   6. the result is unchanged: accept → true, cancel → false, Escape → false; one dialog at a time (a second request is
//      refused at once); focus starts on "cancel" and returns to the button that asked; the dialog leaves the page; each
//      step is recorded as before;
//   7. the card stays inside the screen and clear of the rail, with its buttons in view, even with many lines or a long
//      question (the lines or the question scroll, the buttons stay);
//   8. in English (development edition) the chip and "Cancel" are English and the dialog reads left to right;
//   9. (read-only review) a long decision on the split card scrolls from its first line (its chip and title are never
//      pushed out of reach); a line's label is never cut off beside a long value; a closing "label: text" line without a
//      number stays the closing note; the accept button is the wider one; a full stop after a Latin name stays outside
//      its left-to-right run.
const assert=require('node:assert/strict'),{chromium}=require('playwright'),{bootRenderApp}=require('./helpers/render-app.cjs');
const FACILITIES="فتح 4 منشأة ضمن الخليج العربي؟\n\nأصول ونفوذ للطيران: 2 · $84.0M\nأصول ونفوذ للشحن البحري: 2 · $120.5M\n\nإجمالي العقود: $204.5M.\n\nالمستثناة: أصول ونفوذ للطاقة (الرخصة)\n\nستنفذ كعملية واحدة؛ إذا فشل عقد أو تمويل فلن تُفتح أي منشأة.";
const MESSAGES=[
  FACILITIES,
  "فتح 3 شركات الآن؟\n\nأصول ونفوذ للطيران، أصول ونفوذ للشحن البحري، أصول ونفوذ للنقل\n\nإجمالي رؤوس الأموال: $1.20B. ستُوقّع عقود منفصلة وتُحوّل الأموال من حساب القابضة.",
  "توزيع 25% من ربح كل ربع ابتداءً من الربع الحالي: قرابة $1.2M في آخر الربع، منها $240.0K لمساهمي الطرح بحوالة صادرة، و$960.0K حصة المؤسس تبقى في القابضة إلى أن يُفتح قسم المؤسس. التوزيع يُنقص نقد القابضة ولا يمس ربحها. متابعة؟",
  "إرجاع 2,000,000 دولار من أصول ونفوذ للطيران إلى بطاقة المستثمر. يبقى في حسابها 5,000,000 دولار. متابعة؟",
  "بيع Boeing 787-9 ANI-204؟\nلن يتم البيع أثناء الرحلة.",
  "تحصيل 12 ذمة بقيمة $3.4M؟ سيُنشأ شيك وارد لكل شركة وعميل، ثم تُودع القيمة في الحسابات ضمن عملية واحدة."
];
const words=text=>String(text).replace(/[.,،؛:؟?!()·×⁦-⁩]/g,' ').split(/\s+/).filter(Boolean);
function missingWords(message,shown){const pool=new Map();for(const w of words(shown))pool.set(w,(pool.get(w)||0)+1);const missing=[];for(const w of words(message)){const n=pool.get(w)||0;if(!n)missing.push(w);else pool.set(w,n-1);}return missing;}

(async()=>{
  const browser=await chromium.launch({headless:true});const results={},envs=[];
  try{
    for(const [width,height] of [[844,390],[667,375]]){
      const errors=[];const env=await bootRenderApp({browser,errors,viewport:{width,height}});envs.push(env);const {page}=env;page.setDefaultTimeout(10000);
      const ask=(message,options={})=>page.evaluate(([message,options])=>{window.__answer=undefined;GH_INTERFACE.confirm(message,{state:__GH_STATE__,...options}).then(value=>{window.__answer=value;});},[message,options]);
      const read=()=>page.evaluate(()=>{const d=document.querySelector('dialog.ui-confirm[open]');if(!d)return null;const r=d.getBoundingClientRect(),rail=document.querySelector('.side-nav')?.getBoundingClientRect(),style=getComputedStyle(d),img=d.querySelector('.dx-media img'),ok=d.querySelector('[data-confirm=accept]'),no=d.querySelector('[data-confirm=cancel]'),inside=el=>{const b=el.getBoundingClientRect();return b.top>=r.top-0.5&&b.bottom<=r.bottom+0.5&&b.left>=r.left-0.5&&b.right<=r.right+0.5&&b.bottom<=innerHeight&&b.top>=0;};
        return {className:d.className,background:style.backgroundColor,backdrop:getComputedStyle(d,'::backdrop').backgroundColor,rect:{top:r.top,bottom:r.bottom,left:r.left,right:r.right},railLeft:rail?.left??null,paragraphs:d.querySelectorAll('p').length,question:d.querySelector('p')?.innerText||'',title:d.querySelector('h2')?.innerText||'',chip:d.querySelector('.dx-chip')?.innerText||'',chipShown:d.querySelector('.dx-chip')?getComputedStyle(d.querySelector('.dx-chip')).display!=='none':false,total:d.querySelector('.dx-total')?{label:d.querySelector('.dx-total small').innerText,value:d.querySelector('.dx-total b').innerText}:null,lines:[...d.querySelectorAll('.dx-lines li')].map(li=>({label:li.querySelector('span').innerText,count:li.querySelector('em')?.innerText||'',value:li.querySelector('b').innerText})),note:d.querySelector('.dx-note')?.innerText||'',amount:d.querySelector('.dx-amount')?.innerText||'',images:d.querySelectorAll('img').length,img:img?{src:img.getAttribute('src'),complete:img.complete,width:img.naturalWidth}:null,okColour:getComputedStyle(ok).backgroundColor,okText:ok.innerText,noText:no.innerText,buttonsInView:inside(ok)&&inside(no),focus:document.activeElement===no,bodyText:[...d.querySelectorAll('p,.dx-note,.dx-total,.dx-lines')].map(el=>el.innerText).join(' '),ltr:[...d.querySelectorAll('bdi[dir=ltr]')].map(b=>b.textContent),markup:d.querySelector('.dx-q').innerHTML};});
      const settle=async()=>{await page.waitForFunction(()=>{const i=document.querySelector('dialog.ui-confirm[open] .dx-media img');return !i||i.complete;});await page.waitForTimeout(220);};
      const answer=async(how)=>{if(how==='escape')await page.keyboard.press('Escape');else await page.click(`dialog.ui-confirm [data-confirm=${how}]`);await page.waitForFunction(()=>window.__answer!==undefined);return page.evaluate(()=>({answer:window.__answer,left:document.querySelectorAll('dialog.ui-confirm').length}));};
      const inScreen=(v,label)=>{assert.ok(v.rect.top>=0&&v.rect.left>=0&&v.rect.bottom<=height+0.5&&v.rect.right<=width+0.5,`7: ${label} inside the screen ${JSON.stringify(v.rect)}`);if(v.railLeft!=null)assert.ok(v.rect.right<=v.railLeft+0.5,`7: ${label} clear of the rail`);assert.ok(v.buttonsInView,`7: ${label} buttons in view`);};
      // 1.
      await ask(FACILITIES,{title:'اعتماد منشآت النطاق',accept:'فتح المنشآت المعروضة',risk:'high',action:'open-facilities-by-scope'});await settle();
      let v=await read();
      assert.match(v.className,/\bui-confirm\b.*\bdx-split\b.*\brisk\b/,'1: a split, high-impact card');assert.equal(v.background,'rgb(255, 255, 255)','1: the card is light');assert.equal(v.backdrop,'rgba(6, 20, 31, 0.56)','1: the map is dimmed');
      assert.equal(v.paragraphs,1,'1: one <p>, the question');assert.equal(v.question,'فتح 4 منشأة ضمن الخليج العربي؟');assert.equal(v.title,'اعتماد منشآت النطاق');assert.equal(v.chip,'قرار مؤثر');assert.equal(v.chipShown,true);
      assert.deepEqual(v.total,{label:'إجمالي العقود',value:'$204.5M'},'1: the total, large');
      assert.deepEqual(v.lines,[{label:'أصول ونفوذ للطيران',count:'×2',value:'$84.0M'},{label:'أصول ونفوذ للشحن البحري',count:'×2',value:'$120.5M'},{label:'المستثناة',count:'',value:'أصول ونفوذ للطاقة (الرخصة)'}],'1: the lines');
      assert.equal(v.note,'ستنفذ كعملية واحدة؛ إذا فشل عقد أو تمويل فلن تُفتح أي منشأة.');
      assert.equal(v.okColour,'rgb(194, 49, 30)','1: high impact is red');assert.equal(v.okText,'فتح المنشآت المعروضة');assert.equal(v.noText,'إلغاء');
      assert.deepEqual(v.img,{src:'assets/images/ui/facility-port-v2.webp',complete:true,width:640},'5: the action\'s photo, loaded');assert.equal(v.images,1,'5: one image');
      assert.equal(v.focus,true,'6: focus starts on cancel');inScreen(v,'split');
      assert.deepEqual(await answer('cancel'),{answer:false,left:0},'6: cancel → false, the dialog leaves');
      await ask(FACILITIES,{title:'اعتماد',accept:'تأكيد',risk:'financial',action:'collect-all-receivables'});await settle();v=await read();
      assert.equal(v.okColour,'rgb(13, 59, 87)','1: a financial decision is navy');assert.equal(v.chip,'قرار مالي');assert.equal(v.img.src,'assets/images/ui/finance-documents.webp');
      assert.deepEqual(await answer('accept'),{answer:true,left:0},'6: accept → true');
      // 2.
      await ask(MESSAGES[5],{title:'مراجعة القرار',accept:'تأكيد',risk:'financial',action:'collect-all-receivables'});await settle();v=await read();
      assert.match(v.className,/\bdx-solo\b/);assert.equal(v.chipShown,false,'2: the badge replaces the chip');assert.equal(v.amount,'$3.4M','2: one amount, large');assert.equal(v.paragraphs,1);inScreen(v,'solo');
      assert.deepEqual(await answer('escape'),{answer:false,left:0},'6: Escape → false');
      await ask(MESSAGES[2],{title:'نسبة توزيع الأرباح',accept:'اعتماد النسبة',risk:'high',action:'dividend-policy'});await settle();v=await read();
      assert.equal(v.amount,'','2: several amounts, none large');assert.ok(v.question.includes('التوزيع يُنقص نقد القابضة ولا يمس ربحها'),'2: a one-block message is the whole question');await answer('cancel');
      // 3.
      for(const [index,message] of MESSAGES.entries()){await ask(message,{title:'مراجعة',accept:'تأكيد',risk:'high',action:'sell-asset'});await settle();v=await read();
        assert.deepEqual(missingWords(message,v.bodyText),[],`3: message ${index} keeps every word`);assert.deepEqual(missingWords(v.bodyText,message),[],`3: message ${index} adds no word`);inScreen(v,`message ${index}`);await answer('cancel');}
      // 4.
      await ask(MESSAGES[4],{title:'بيع أصل',accept:'بيع',risk:'high',action:'sell-mobility-asset'});await settle();v=await read();
      assert.ok(v.ltr.includes('Boeing 787-9 ANI-204'),`4: the name is one left-to-right unit ${JSON.stringify(v.ltr)}`);assert.equal(v.img.src,'assets/images/ui/mobility-hero.webp');await answer('cancel');
      await ask('اعتماد <b>R&D</b> بقيمة $5.0M & "خطة"؟',{title:'<i>عنوان</i>',accept:'<u>نعم</u>',risk:'normal',action:'x'});await settle();
      const unsafe=await page.evaluate(()=>{const d=document.querySelector('dialog.ui-confirm[open]');return {tags:d.querySelectorAll('.dx-q b,h2 i,button u').length,question:d.querySelector('p').innerText,title:d.querySelector('h2').innerText,ok:d.querySelector('[data-confirm=accept]').innerText};});
      assert.deepEqual(unsafe,{tags:0,question:'اعتماد <b>R&D</b> بقيمة $5.0M & "خطة"؟',title:'<i>عنوان</i>',ok:'<u>نعم</u>'},'4: text, never markup');await answer('cancel');
      // 5.
      await page.evaluate(()=>{GH_INTERFACE.resetHistory?.();});
      await ask('سؤال؟',{action:'unknown-action'});await settle();assert.equal((await read()).img.src,'assets/images/ui/group-boardroom.webp','5: no page → the boardroom');await answer('cancel');
      await page.evaluate(()=>__AUDIT__.openDrawer('treasury'));await page.waitForTimeout(200);
      await ask('سؤال؟',{action:'unknown-action'});await settle();assert.equal((await read()).img.src,'assets/images/ui/bank-vault.webp','5: the open page\'s photo');await answer('cancel');
      await ask('سؤال؟',{action:'unknown-action',image:'../../etc"x'});await settle();assert.equal((await read()).img.src,'assets/images/ui/group-boardroom.webp','5: an unsafe name falls back');await answer('cancel');
      await ask('سؤال؟',{action:'unknown-action',image:'missing-photo-qa'});await page.waitForFunction(()=>!document.querySelector('dialog.ui-confirm[open] .dx-media img'));
      assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('dialog.ui-confirm[open] .dx-media')).backgroundColor),'rgb(13, 59, 87)','5: a missing image leaves the navy ground');await answer('cancel');
      if(width===844){
        await page.evaluate(async()=>{const s=__GH_STATE__;s.godMoney=true;s.infiniteMoney=true;await __AUDIT__.runAuthorizedDomainCommand('corporate','open-company',{type:'air',capital:400000000,legalName:'QA Confirm Air'},{silent:true});__AUDIT__.openDrawer('company','air');});await page.waitForTimeout(300);
        await ask('سؤال؟',{action:'unknown-action'});await settle();assert.equal((await read()).img.src,'assets/images/ui/air-widebody.webp','5: the open company\'s own photo');await answer('cancel');
      }
      // 6.
      await page.evaluate(()=>{const b=document.createElement('button');b.id='qaAsker';b.textContent='qa';document.body.append(b);b.focus();});
      const second=await page.evaluate(async()=>{const s=__GH_STATE__,before=(s.workflowControl?.history||[]).length;const first=GH_INTERFACE.confirm('أولى؟',{state:s,action:'qa-first',risk:'normal'});const again=await Promise.race([GH_INTERFACE.confirm('ثانية؟',{state:s,action:'qa-second'}),new Promise(resolve=>setTimeout(()=>resolve('still-waiting'),1500))]);const count=document.querySelectorAll('dialog.ui-confirm').length;document.querySelector('dialog.ui-confirm [data-confirm=accept]').click();const value=await first;const rows=(s.workflowControl?.history||[]).slice(0,Math.max(0,(s.workflowControl?.history||[]).length-before));return {again,count,value,focus:document.activeElement?.id,left:document.querySelectorAll('dialog.ui-confirm').length,types:rows.map(r=>r.type||r.event||r.kind)};});
      assert.equal(second.again,false,'6: a second request is refused at once');assert.equal(second.count,1,'6: one dialog');assert.equal(second.value,true);assert.equal(second.focus,'qaAsker','6: focus returns to the asker');assert.equal(second.left,0);
      assert.deepEqual(second.types,['WORKFLOW_CONFIRM_ACCEPTED','WORKFLOW_CONFIRM_SHOWN'],'6: shown then accepted are recorded; the refused second request records nothing');results[`records${width}`]=second.types;
      assert.deepEqual(errors,[],`no page error at ${width}`);
      // 7. Many lines and a long question.
      const many='اعتماد الشركات؟\n\n'+Array.from({length:14},(_,i)=>`شركة رقم ${i+1}: ${i+1} · $${i+1}.0M`).join('\n')+'\n\nإجمالي العقود: $105.0M.\n\nتُنفذ كلها أو لا شيء.';
      await ask(many,{title:'اعتماد',accept:'تأكيد',risk:'high',action:'open-all-companies'});await settle();v=await read();assert.equal(v.lines.length,14);inScreen(v,'many lines');
      assert.ok(await page.evaluate(()=>{const l=document.querySelector('dialog.ui-confirm .dx-lines');return l.scrollHeight>l.clientHeight;}),'7: the lines scroll');await answer('cancel');
      await ask(Array.from({length:30},()=>'نص طويل جدًا يشرح القرار بالتفصيل').join(' ')+'؟',{title:'قرار',accept:'تأكيد',risk:'normal',action:'x'});await settle();v=await read();inScreen(v,'long question');
      assert.ok(await page.evaluate(()=>{const q=document.querySelector('dialog.ui-confirm .dx-q');return q.scrollHeight>q.clientHeight;}),'7: the question scrolls');await answer('cancel');
      // 9.
      await ask('اعتماد العروض؟\n\n'+Array.from({length:6},(_,i)=>`عرض طويل رقم ${i+1} لشركة أصول ونفوذ للخدمات اللوجستية المتكاملة في الخليج.`).join('\n')+'\n\nإجمالي العقود: $9.0M.\n\nتُنفذ كلها أو لا شيء.',{title:'اعتماد العروض',accept:'تأكيد',risk:'high',action:'x'});await settle();
      const top=await page.evaluate(()=>{const d=document.querySelector('dialog.ui-confirm[open]'),copy=d.querySelector('.dx-copy'),chip=copy.querySelector('.dx-chip').getBoundingClientRect(),c=copy.getBoundingClientRect();return {split:d.classList.contains('dx-split'),chipTop:chip.top,copyTop:c.top,scrolls:copy.scrollHeight>copy.clientHeight,scrollTop:copy.scrollTop};});
      assert.equal(top.split,true);assert.ok(top.chipTop>=top.copyTop-0.5,`9: the chip stays reachable at the top ${JSON.stringify(top)}`);assert.equal(top.scrolls,true,'9: the long decision scrolls');assert.equal(top.scrollTop,0);await answer('cancel');
      await ask('اعتماد؟\n\nأصول ونفوذ للطاقة المتجددة والتخزين: 3 · $45.0M\nالمستثناة: أصول ونفوذ للطاقة (الرخصة)، للبنوك (التمويل)\n\nإجمالي العقود: $45.0M.',{title:'اعتماد',accept:'تأكيد',risk:'high',action:'x'});await settle();
      const labels=await page.evaluate(()=>[...document.querySelectorAll('dialog.ui-confirm .dx-lines li')].map(li=>{const s=li.querySelector('span'),b=li.querySelector('b');return {text:s.innerText,clipped:s.scrollWidth>s.clientWidth+1||b.scrollWidth>b.clientWidth+1,width:s.clientWidth};}));
      assert.equal(labels.length,2);for(const row of labels){assert.equal(row.clipped,false,`9: «${row.text}» is not cut off`);assert.ok(row.width>=60,`9: «${row.text}» has room (${row.width}px)`);}await answer('cancel');
      await ask('سؤال؟\n\nالمبلغ: $5.0M\n\nملاحظة: لا يمكن التراجع',{title:'قرار',accept:'تأكيد',risk:'normal',action:'x'});await settle();v=await read();
      assert.deepEqual(v.lines,[{label:'المبلغ',count:'',value:'$5.0M'}]);assert.equal(v.note,'ملاحظة: لا يمكن التراجع','9: a closing line without a number stays the note');await answer('cancel');
      await ask('بيع QA Air. لن يعود الأصل بعد البيع.',{title:'بيع أصل',accept:'بيع',risk:'high',action:'x'});await settle();v=await read();
      assert.ok(v.ltr.includes('QA Air')&&!v.ltr.some(t=>t.endsWith('.')),`9: the full stop stays outside the run ${JSON.stringify(v.ltr)}`);
      const sizes=await page.evaluate(()=>({ok:document.querySelector('dialog.ui-confirm [data-confirm=accept]').getBoundingClientRect().width,no:document.querySelector('dialog.ui-confirm [data-confirm=cancel]').getBoundingClientRect().width}));
      assert.ok(sizes.ok>sizes.no,`9: the accept button is the wider one ${JSON.stringify(sizes)}`);await answer('cancel');
      assert.deepEqual(errors,[]);await page.close();await env.closeOrigin?.();
    }
    // 8.
    {const errors=[];const env=await bootRenderApp({browser,errors,viewport:{width:844,height:390},storage:[['ani-language','en']]});envs.push(env);const {page}=env;page.setDefaultTimeout(10000);
      assert.equal(await page.evaluate(()=>GH_I18N.lang()),'en');
      await page.evaluate(()=>{GH_INTERFACE.confirm('سؤال؟',{state:__GH_STATE__,action:'x',risk:'high'});});await page.waitForSelector('dialog.ui-confirm[open]');
      assert.deepEqual(await page.evaluate(()=>({chip:document.querySelector('.dx-chip').innerText,no:document.querySelector('[data-confirm=cancel]').innerText,dir:document.querySelector('dialog.ui-confirm').dir})),{chip:'High-impact decision',no:'Cancel',dir:'ltr'},'8: English chip, cancel and direction');
      await page.click('[data-confirm=cancel]');assert.deepEqual(errors,[]);await page.close();await env.closeOrigin?.();}
    console.log(JSON.stringify({suite:'build654-confirm-dialog-browser',ok:true,...results}));
  }finally{await browser.close();for(const env of envs)await Promise.race([env.closeOrigin?.(),new Promise(resolve=>setTimeout(resolve,2000))]);}
})().catch(error=>{console.error(error);process.exit(1);});
