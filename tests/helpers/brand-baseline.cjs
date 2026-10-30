'use strict';
// أصول ونفوذ | ASSETS & INFLUENCE (owner: «غير مايلزم باللعبة كامله»): the game's visible name changed from VENTORA after
// the sources the A/B gates compare with. brandBaseline(tree) gives such a source the same names in its WebApp files
// (فنتورا -> أصول ونفوذ, Ventora -> Assets & Influence, VENTORA -> ASSETS & INFLUENCE, the stock short name VH -> ANI;
// identifiers such as VentoraAndroid stay; the companies' five names are the current definitions' own, matched by their
// Arabic legal name, the trade names following the brand rule), so an A/B gate still compares its own subject alone. It
// refuses a tree that names no VENTORA (nothing to align: the gate's base moved).
const fs=require('node:fs'),path=require('node:path');
const RULES=[[/'إمبراطورية فنتورا'/g,"'إمبراطورية النفوذ'"],[/display:'فنتورا',legal:'VENTORA'/g,"display:'أصول ونفوذ',legal:'أصول ونفوذ'"],[/فنتورا/g,'أصول ونفوذ'],[/Ventora(?![A-Za-z])/g,'Assets & Influence'],[/VENTORA/g,'ASSETS & INFLUENCE'],[/'VH'/g,"'ANI'"],[/'VH /g,"'ANI "],[/"VH"/g,'"ANI"'],[/>VH</g,'>ANI<']];
const IDENTITY=/identity\('([^']*)','[^']*','[^']*','[^']*','[^']*',/g;
function currentNames(source){const names=new Map();for(const m of fs.readFileSync(path.join(source,'WebApp/company-definitions.js'),'utf8').matchAll(IDENTITY))names.set(m[1],m[0]);return names;}
function brandBaseline(tree,source=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'../..')){
  const web=path.join(tree,'WebApp'),names=currentNames(source);let files=0;
  for(const name of fs.readdirSync(web)){
    if(!/\.(js|html)$/.test(name))continue;const file=path.join(web,name),text=fs.readFileSync(file,'utf8');let next=text;
    for(const [pattern,value] of RULES)next=next.replace(pattern,value);
    if(name==='company-definitions.js')next=next.replace(IDENTITY,(whole,legal)=>names.get(legal)||whole);
    if(next!==text){fs.writeFileSync(file,next);files++;}
  }
  if(!files)throw new Error(`brand-baseline: ${tree} names no VENTORA`);
  return files;
}
module.exports={brandBaseline};
