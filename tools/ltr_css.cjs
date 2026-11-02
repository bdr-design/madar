'use strict';
// Owner (approved English plan: «الإنجليزية من اليسار لليمين: أعكس اتجاه كل صفحة»): the English edition is the Arabic
// design mirrored. The design's style sheets stay as they are; this tool reads them and writes WebApp/ltr.css, which
// holds, for every rule that places something on a side, the same rule mirrored and scoped to html[dir="ltr"]:
//   - left ↔ right (positions, margins, paddings, borders, corner radii, float, clear, text-align);
//   - direction:rtl → ltr (the design pins rtl on its frames and papers);
//   - a rule centred on 50% (left:50% with a translate or a negative half margin) is symmetric and left as it is;
//   - the map's markers are placed by geography, never mirrored (MAP_GEOMETRY);
//   - a side the source rule sets alone is cleared on the other side (auto for positions, 0 for spacing), so the
//     mirrored rule does not keep the Arabic side as well.
// The Arabic edition never matches these rules (its <html> is dir="rtl"). tools/ltr-extra.css holds the few mirrored
// details a style sheet cannot express (direction-bearing icons); it is appended as it is.
//   node tools/ltr_css.cjs          writes WebApp/ltr.css
//   node tools/ltr_css.cjs --check  fails when WebApp/ltr.css is not what the design's style sheets give
const fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(__dirname,'..'),WEB=path.join(ROOT,'WebApp'),OUT=path.join(WEB,'ltr.css'),EXTRA=path.join(ROOT,'tools/ltr-extra.css');
// The style sheets index.html links, in order, except the vendor map's own sheet (it is direction-neutral), the icon
// glyphs (drawn shapes) and the generated output.
const SKIP=new Set(['vendor/leaflet/leaflet.css','madar-icons.css','ltr.css']);
const MAP_GEOMETRY=/leaflet|marker|vehicle|map-base-dot|map-place|world-place|mobility-car|facility-brand-logo/;
function sheets(){const html=fs.readFileSync(path.join(WEB,'index.html'),'utf8');return [...html.matchAll(/<link\b[^>]*href="([^"]+\.css)"/g)].map(m=>m[1]).filter(f=>!SKIP.has(f));}

// ---- A small reader for the design's CSS: comments, strings, nested at-rules, declarations. ----
function stripComments(src){let out='',i=0;while(i<src.length){if(src[i]==='/'&&src[i+1]==='*'){const e=src.indexOf('*/',i+2);i=e<0?src.length:e+2;continue;}if(src[i]==='"'||src[i]==="'"){const q=src[i];let j=i+1;while(j<src.length&&src[j]!==q){if(src[j]==='\\')j++;j++;}out+=src.slice(i,j+1);i=j+1;continue;}out+=src[i++];}return out;}
// Returns [{prelude, body}] for one block level; body is the raw text between the braces.
function blocks(src){const out=[];let i=0,start=0;while(i<src.length){const c=src[i];
  if(c==='"'||c==="'"){const q=c;i++;while(i<src.length&&src[i]!==q){if(src[i]==='\\')i++;i++;}i++;continue;}
  if(c==='{'){const prelude=src.slice(start,i).trim();let depth=1,j=i+1;while(j<src.length&&depth){const d=src[j];if(d==='"'||d==="'"){const q=d;j++;while(j<src.length&&src[j]!==q){if(src[j]==='\\')j++;j++;}j++;continue;}if(d==='{')depth++;else if(d==='}')depth--;j++;}out.push({prelude,body:src.slice(i+1,j-1)});i=j;start=i;continue;}
  if(c===';'&&src.slice(start,i).trim().startsWith('@')){start=i+1;}
  i++;}return out;}
function declarations(body){const out=[];let depth=0,quote=null,start=0;for(let i=0;i<=body.length;i++){const c=body[i];if(quote){if(c==='\\')i++;else if(c===quote)quote=null;continue;}if(c==='"'||c==="'"){quote=c;continue;}if(c==='(')depth++;else if(c===')')depth--;else if((c===';'&&!depth)||i===body.length){const text=body.slice(start,i).trim();start=i+1;if(!text)continue;const colon=text.indexOf(':');if(colon<0)continue;let value=text.slice(colon+1).trim(),important=false;if(/!\s*important$/i.test(value)){important=true;value=value.replace(/\s*!\s*important$/i,'');}out.push({prop:text.slice(0,colon).trim().toLowerCase(),value,important});}}return out;}
function tokens(value){const out=[];let depth=0,cur='';for(const c of value){if(c==='(')depth++;if(c===')')depth--;if(/\s/.test(c)&&!depth){if(cur)out.push(cur);cur='';continue;}cur+=c;}if(cur)out.push(cur);return out;}
// Splits a selector list on top-level commas.
function selectors(prelude){const out=[];let depth=0,cur='';for(const c of prelude){if(c==='('||c==='[')depth++;if(c===')'||c===']')depth--;if(c===','&&!depth){out.push(cur.trim());cur='';continue;}cur+=c;}if(cur.trim())out.push(cur.trim());return out;}
function scope(selector){
  if(/^html\b/.test(selector))return selector.replace(/^html/,'html[dir="ltr"]');
  if(/^:root\b/.test(selector))return selector.replace(/^:root/,':root[dir="ltr"]');
  return `html[dir="ltr"] ${selector}`;
}

// ---- Mirroring one rule's declarations. ----
// The sides each declaration sets, in source order (a later declaration replaces an earlier one, as in the cascade).
const BOX={margin:'margin',padding:'padding',inset:''};
function sideModel(decls){
  const groups={pos:{},margin:{},padding:{},bw:{},bs:{},bc:{},radius:{}};
  const set=(group,side,value,important)=>{groups[group][side]={value,important};};
  for(const {prop,value,important} of decls){
    const t=tokens(value);
    if(prop==='left'||prop==='right')set('pos',prop,value,important);
    else if(prop==='inset'){const [a,b=a,c=a,d=b]=t;set('pos','top',a,important);set('pos','right',b,important);set('pos','bottom',c,important);set('pos','left',d,important);}
    else if(prop==='margin'||prop==='padding'){const [a,b=a,c=a,d=b]=t;const g=prop;set(g,'top',a,important);set(g,'right',b,important);set(g,'bottom',c,important);set(g,'left',d,important);}
    else if(/^(margin|padding)-(left|right)$/.test(prop)){const [g,side]=prop.split('-');set(g,side,value,important);}
    else if(prop==='border'){for(const side of ['left','right']){set('bw',side,null,important);groups.bw[side].shorthand=value;}}
    else if(/^border-(left|right)$/.test(prop)){const side=prop.slice(7);set('bw',side,null,important);groups.bw[side].shorthand=value;}
    else if(/^border-(left|right)-(width|style|color)$/.test(prop)){const [, side,kind]=prop.split('-');set({width:'bw',style:'bs',color:'bc'}[kind],side,value,important);}
    else if(prop==='border-width'||prop==='border-style'||prop==='border-color'){const [a,b=a,c=a,d=b]=t,g={'border-width':'bw','border-style':'bs','border-color':'bc'}[prop];set(g,'right',b,important);set(g,'left',d,important);}
    else if(prop==='border-radius'){
      const [h,v]=value.split('/').map(s=>tokens(s.trim()));const four=list=>{const [a,b=a,c=a,d=b]=list;return [a,b,c,d];};const H=four(h),V=v?four(v):null;
      ['top-left','top-right','bottom-right','bottom-left'].forEach((corner,i)=>set('radius',corner,V?`${H[i]} ${V[i]}`:H[i],important));
    }
    else if(/^border-(top|bottom)-(left|right)-radius$/.test(prop)){set('radius',prop.slice(7,-7),value,important);}
  }
  return groups;
}
// The value a mirrored side takes when the rule sets only the other side. The source rule's own value on that side still
// applies under the mirrored one, so it is replaced with what the mirrored cascade gives without this rule: the nearest
// base rule (the same selector without its leading parts, e.g. ".map-strip" for ".app-shell.overlay-open .map-strip"),
// mirrored in turn; with no base rule, the property's neutral value.
function compounds(selector){return selector.split(/\s*(?:>|\+|~|\s)\s*/).filter(Boolean);}
function makeIndex(rules){const index=new Map();for(const rule of rules){if(rule.media)continue;for(const sel of rule.selectors){const key=compounds(sel).join(' ');index.set(key,[...(index.get(key)||[]),...rule.decls]);}}return index;}
const OPPOSITE={left:'right',right:'left','top-left':'top-right','top-right':'top-left','bottom-left':'bottom-right','bottom-right':'bottom-left'};
function mirroredSide(index,key,group,side,neutral,depth=0){
  const model=index.has(key)?sideModel(index.get(key))[group]:null,opposite=model?.[OPPOSITE[side]];
  if(opposite)return opposite.shorthand??opposite.value;
  return baseSide(index,key,group,side,neutral,depth+1);
}
function baseSide(index,key,group,side,neutral,depth=0){
  if(depth>8)return neutral;const parts=key.split(' ');
  for(let i=1;i<parts.length;i++){const sub=parts.slice(i).join(' ');const model=index.has(sub)?sideModel(index.get(sub))[group]:null;if(model&&(model[side]||model[OPPOSITE[side]]))return mirroredSide(index,sub,group,side,neutral,depth);}
  return neutral;
}
function mirror(decls,{geometry,key,index}){
  const out=[],emit=(prop,value,important)=>out.push(`${prop}:${value}${important?'!important':''}`);
  const centred=decls.some(d=>(d.prop==='left'||d.prop==='right')&&d.value.trim()==='50%');
  const g=sideModel(decls);
  const same=(a,b)=>a&&b&&a.value===b.value&&a.shorthand===b.shorthand&&a.important===b.important;
  const valueOf=x=>x.shorthand??x.value;
  const cancel=(group,side,neutral)=>index?baseSide(index,key,group,side,neutral):neutral;
  // A pair of sides: mirrored when they differ; a side the rule sets alone takes, on the other side, the base value.
  const pair=(group,left,right,name,neutral)=>{const L=g[group][left],R=g[group][right];if(!L&&!R)return;if(same(L,R))return;
    emit(name(left),R?valueOf(R):cancel(group,left,neutral),(R||L).important);
    emit(name(right),L?valueOf(L):cancel(group,right,neutral),(L||R).important);};
  if(geometry&&!centred){
    pair('pos','left','right',s=>s,'auto');
    pair('margin','left','right',s=>`margin-${s}`,'0');
  }
  if(geometry){
    pair('padding','left','right',s=>`padding-${s}`,'0');
    // A border side given as a shorthand is mirrored as a shorthand; its parts are mirrored as parts.
    const bl=g.bw.left,br=g.bw.right;
    if((bl?.shorthand!==undefined||br?.shorthand!==undefined)&&!same(bl,br)){
      emit('border-left',br?valueOf(br):cancel('bw','left','0 none'),(br||bl).important);emit('border-right',bl?valueOf(bl):cancel('bw','right','0 none'),(bl||br).important);
    }else pair('bw','left','right',s=>`border-${s}-width`,'0');
    pair('bs','left','right',s=>`border-${s}-style`,'none');pair('bc','left','right',s=>`border-${s}-color`,'currentcolor');
    pair('radius','top-left','top-right',s=>`border-${s}-radius`,'0');pair('radius','bottom-left','bottom-right',s=>`border-${s}-radius`,'0');
  }
  for(const {prop,value,important} of decls){
    const v=value.trim().toLowerCase();
    if(prop==='direction'&&v==='rtl')emit('direction','ltr',important);
    else if(geometry&&['text-align','float','clear'].includes(prop)&&(v==='left'||v==='right'))emit(prop,v==='left'?'right':'left',important);
  }
  // The last word for each property (a later mirrored declaration wins, as in the source).
  const last=new Map();for(const d of out)last.set(d.slice(0,d.indexOf(':')),d);
  return out.filter(d=>last.get(d.slice(0,d.indexOf(':')))===d);
}
function collect(src,rules,media=null){
  for(const {prelude,body} of blocks(src)){
    if(/^@(media|supports|container)\b/i.test(prelude)){collect(body,rules,[...(media||[]),prelude]);continue;}
    if(prelude.startsWith('@'))continue; // @keyframes, @font-face: no sides to mirror
    rules.push({media,selectors:selectors(prelude),decls:declarations(body)});
  }
}
function emitRules(rules,index){
  const lines=[];let open=null;
  const close=()=>{if(open){lines.push('}'.repeat(open.length));open=null;}};
  for(const rule of rules){
    const geometry=!rule.selectors.some(s=>MAP_GEOMETRY.test(s));
    // One mirrored rule per selector when its base values differ; one rule for the list otherwise.
    const per=rule.selectors.map(sel=>({sel,decls:mirror(rule.decls,{geometry,key:compounds(sel).join(' '),index})})).filter(r=>r.decls.length);
    if(!per.length)continue;
    const groups=[];for(const r of per){const text=r.decls.join(';'),last=groups[groups.length-1];if(last&&last.text===text)last.sels.push(r.sel);else groups.push({text,sels:[r.sel]});}
    const media=rule.media||null;
    if(JSON.stringify(media)!==JSON.stringify(open)){close();if(media){lines.push(media.map(m=>`${m}{`).join(''));open=media;}}
    for(const grp of groups)lines.push(`${media?' ':''}${grp.sels.map(scope).join(',')}{${grp.text}}`);
  }
  close();return lines;
}
function generate(){
  const lines=['/* Generated by tools/ltr_css.cjs from the design\'s style sheets: do not edit. The English edition mirrors the',' Arabic design; these rules match only html[dir="ltr"]. Hand-written mirrored details come from tools/ltr-extra.css. */'];
  const perFile=sheets().map(file=>{const rules=[];collect(stripComments(fs.readFileSync(path.join(WEB,file),'utf8')),rules);return {file,rules};});
  const index=makeIndex(perFile.flatMap(f=>f.rules));
  for(const {file,rules} of perFile){const inner=emitRules(rules,index);if(inner.length)lines.push(`/* ${file} */`,...inner);}
  const extra=fs.existsSync(EXTRA)?fs.readFileSync(EXTRA,'utf8').trim():'';if(extra)lines.push('/* ltr-extra.css */',extra);
  return lines.join('\n')+'\n';
}
if(require.main===module){
  const text=generate();
  if(process.argv.includes('--check')){const current=fs.existsSync(OUT)?fs.readFileSync(OUT,'utf8'):'';if(current!==text){console.error('WebApp/ltr.css is not what the design\'s style sheets give: run node tools/ltr_css.cjs');process.exit(1);}console.log('ltr.css up to date');}
  else{fs.writeFileSync(OUT,text);console.log(`wrote WebApp/ltr.css (${text.split('\n').length-1} lines)`);}
}
module.exports={generate,mirror,declarations,blocks,selectors,scope,sheets,compounds,makeIndex,MAP_GEOMETRY};
