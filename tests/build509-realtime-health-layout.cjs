'use strict';
// Emulated-phone profile of decision commands: the periodic in-game health pass (every 10 s, also while playing) read
// element geometry for its top-bar checks (layoutSnapshot: a forced synchronous layout of 50 ms at 4x CPU right after a
// decision re-render) and scanned every button. Those checks now run only in explicit diagnostics (export, the open
// diagnostics page). Proven here:
//  1. runHealthCheck with layout:false reads no geometry and runs no button scan; the default still runs both and still
//     reports a wrapped top bar;
//  2. every non-UI issue is identical with and without the layout checks;
//  3. the periodic pass asks for layout only while the diagnostics page is open; export evidence keeps the default.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {harness}=require(path.join(ROOT,'tests/helpers/core-harness'));
const {s}=harness(['diagnostics-core']),D=s.GH_DIAGNOSTICS;
let rects=0,scans=0;
const rect=(top,bottom,left=0,right=10)=>({top,bottom,left,right,width:right-left,height:bottom-top});
const el=(r,id)=>({id,getBoundingClientRect(){rects++;return r;}});
const buttons=[el(rect(0,30),'a'),el(rect(40,70),'b')];
s.document={querySelector(sel){if(/top-actions/.test(sel))return {...el(rect(0,80)),querySelectorAll:()=>buttons};if(sel==='.topbar')return el(rect(0,80,0,500));return null;},querySelectorAll(){return [];},getElementById(){return null;}};
s.getComputedStyle=()=>({display:'flex',visibility:'visible'});
s.GH_INTERACTION={validate(){scans++;return [];}};
const state={simSeconds:3600,finance:{receivables:[],payables:[]}},extra={integrity:{issues:[{id:'QA_BIZ',severity:'warning',title:'t',detail:'d',domain:'business'}]}};
const off=D.runHealthCheck(state,extra,{layout:false});const offRects=rects,offScans=scans;
const on=D.runHealthCheck(state,extra,{});
assert.equal(offRects,0,'the periodic pass reads no geometry');assert.equal(offScans,0,'the periodic pass scans no buttons');
assert.ok(rects>0,'explicit diagnostics still read the layout');assert.ok(scans>0,'explicit diagnostics still scan the buttons');assert.ok(on.issues.some(row=>row.id==='UI_TOPBAR_ACTION_WRAP'),'a wrapped top bar is still reported by explicit diagnostics');
const nonUi=report=>report.issues.filter(row=>!/^UI_|BUTTON_|DISABLED_/.test(row.id)).map(row=>row.id);
assert.deepEqual(nonUi(off),nonUi(on),'business issues are identical');
assert.ok(nonUi(on).includes('BIZ_QA_BIZ'),'integrity issues are reported');
const app=fs.readFileSync(path.join(ROOT,'WebApp/app.js'),'utf8');
assert.match(app,/trackTransitions:true,layout:activeDrawerPanel==='diagnostics'&&\$\('drawer'\)\.classList\.contains\('open'\)\}/,'the periodic pass reads layout only while the diagnostics page is open');
const diagnostics=fs.readFileSync(path.join(ROOT,'WebApp/diagnostics-core.js'),'utf8');
assert.match(diagnostics,/const layout=options\.layout===false\?null:layoutSnapshot\(\);/);
assert.ok(/runHealthCheck\(state,\{\.\.\.extra,simulation,integrity\},\{recordEvent:options\.recordEvent===true/.test(diagnostics),'export evidence keeps the full layout checks');
console.log(JSON.stringify({suite:'build509-realtime-health-layout',ok:true,explicitGeometryReads:rects,periodicGeometryReads:offRects}));
