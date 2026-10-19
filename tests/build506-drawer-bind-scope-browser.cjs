'use strict';
// bindDrawerActions ran 84 document-wide querySelectorAll after every #drawerBody render (3.7 ms per page open at 4x CPU
// in emulated-phone Chromium). Every element they bind is rendered into #drawerBody by the seven callers that rewrite it
// just before, so the binding queries now search that subtree; [data-market-view] had no producer and is removed.
// Proven in the real app, in one session: for every page below, the listeners bound from bindDrawerActions (element
// path, event type, order) are identical with the old document scope (an overlay flag in a temporary copy only) and the
// new #drawerBody scope.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{chromium}=require('playwright'),{bootRenderApp}=require('./helpers/render-app.cjs'),{installVault}=require('./helpers/differential-vault-fixture.cjs'),{prepare}=require('./helpers/request-decisions-fixture.cjs'),ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const LINE="    const drawerRoot=$('drawerBody');";
(async()=>{
  const app=fs.readFileSync(path.join(ROOT,'WebApp/app.js'),'utf8');assert.equal(app.split(LINE).length,2,'bindDrawerActions searches #drawerBody');
  const body=app.slice(app.indexOf('  function bindDrawerActions(){'),app.indexOf('\n  }\n',app.indexOf('  function bindDrawerActions(){')));
  assert.deepEqual(body.match(/\n    document\.querySelectorAll\([^)]*\)/g),["\n    document.querySelectorAll('[data-open]')"],'only navigation buttons are bound across the document (build383: a persistent one outside the drawer), once each');assert.ok(!body.includes('[data-market-view]'),'the dead selector is removed');
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ventora-bind-scope-'));fs.cpSync(path.join(ROOT,'WebApp'),path.join(tmp,'WebApp'),{recursive:true});
  fs.writeFileSync(path.join(tmp,'WebApp/app.js'),app.replace(LINE,"    const drawerRoot=window.__QA_DOCUMENT_SCOPE__?document:$('drawerBody');"));
  const browser=await chromium.launch({headless:true}),errors=[];let env;
  try{
    env=await bootRenderApp({browser,root:tmp,errors,viewport:{width:844,height:390},beforeScripts:{fn:installVault}});const page=env.page;page.setDefaultTimeout(120000);
    await prepare(page,{rows:600});
    const pages=[['finance'],['companies'],['company','air'],['company','bank'],['company','insurance'],['company','telecom'],['companyManage',{type:'air',tab:'overview'}],['invoices',{company:'all',tab:'overview'}],['treasury'],['market'],['stocks'],['compliance'],['leadershipHub'],['peopleHub'],['financeHub'],['systemHub'],['labor','dashboard'],['labor','managers'],['assets','air'],['routes','air'],['network'],['settings'],['diagnostics']];
    const out=await page.evaluate(async pages=>{
      const original=EventTarget.prototype.addEventListener,rows=[];let recording=false;
      const pathOf=node=>{const parts=[];for(let n=node;n&&n.nodeType===1&&parts.length<12;n=n.parentElement){let i=0;for(let s=n.previousElementSibling;s;s=s.previousElementSibling)i++;parts.push(`${n.tagName}${n.id?'#'+n.id:''}:${i}`);}return parts.reverse().join('>');};
      EventTarget.prototype.addEventListener=function(type,...rest){if(recording&&/bindDrawerActions/.test(new Error().stack||''))rows.push(`${this===document?'document':this===window?'window':pathOf(this)}|${type}`);return original.call(this,type,...rest);};
      const result={};
      try{
        for(const [p,a] of pages){
          const capture=documentScope=>{window.__QA_DOCUMENT_SCOPE__=documentScope;__AUDIT__.openDrawer('map');rows.length=0;recording=true;try{__AUDIT__.openDrawer(p,a);}finally{recording=false;}return rows.slice();};
          const before=capture(true),after=capture(false);result[p+(a?':'+(typeof a==='string'?a:a.type||a.company):'')]={same:JSON.stringify(before)===JSON.stringify(after),count:after.length,before:before.length};
        }
      }finally{EventTarget.prototype.addEventListener=original;window.__QA_DOCUMENT_SCOPE__=false;}
      return result;
    },pages);
    const bound=Object.values(out).reduce((n,row)=>n+row.count,0);
    for(const [name,row] of Object.entries(out))assert.equal(row.same,true,`${name}: the same listeners in the same order (${row.before} document vs ${row.count} drawer)`);
    assert.ok(bound>100,`the pages bind real controls: ${bound}`);assert.deepEqual(errors,[]);
    console.log(JSON.stringify({suite:'build506-drawer-bind-scope-browser',ok:true,pages:Object.keys(out).length,listeners:bound}));
  }finally{await Promise.race([browser.close(),new Promise(r=>setTimeout(r,15000))]);await env?.closeOrigin?.();fs.rmSync(tmp,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>process.exit(process.exitCode||0));
