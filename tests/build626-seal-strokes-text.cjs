'use strict';
// Owner («كمل بدقه»; a system finance document checks the founder's visual seal four to seven times, and encoding the
// seal's strokes for its digest was two thirds of each check): strokes already in canonical form are encoded, for the
// digest, from the numbers the check has just read. On the real authorization owner, against the source before (668f48d,
// from git):
//  1. validateVisualSeal answers the same (ok, digest and point count, or the same reason) for canonical strokes (with and
//     without pressure, -0, the bounds, near the 32 KB limit), strokes taking the normalizing path, and every kind of invalid seal;
//  2. a seal created by createVisualSeal checks with the digest it was created with;
//  3. a 900-point seal is checked in under 70% of the time before (median of alternating runs).
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'),SOURCE=process.env.GH_TEST_SOURCE_DIR||ROOT,PREVIOUS='668f48d';
// Both in this realm (the strokes' prototype is this realm's Object.prototype), each with the real control plane's SHA-256.
const plane=fs.readFileSync(path.join(SOURCE,'WebApp/control-plane-core.js'),'utf8');
const load=text=>{const scope={};new Function('globalThis','module',plane)(scope,undefined);assert.equal(typeof scope.GH_CONTROL_PLANE?.sha256,'function','control plane loaded');new Function('globalThis','module',text)(scope,undefined);return scope.GH_AUTHORIZATION;};
const now=load(fs.readFileSync(path.join(SOURCE,'WebApp/authorization-core.js'),'utf8')),before=load(execFileSync('git',['-C',ROOT,'show',`${PREVIOUS}:WebApp/authorization-core.js`]).toString());
let seed=626;const random=()=>{seed=(seed*1103515245+12345)%2147483648;return seed/2147483648;};
const r4=()=>Math.round(random()*10000)/10000,r3=()=>Math.round(random()*1000)/1000;
const strokes=(count,length,pressure)=>Array.from({length:count},(_,i)=>Array.from({length},(_,j)=>{const point={x:r4(),y:r4()};if(pressure==='all'||(pressure==='some'&&(i+j)%3===0))point.pressure=r3();return point;}));
const row=(input,over={})=>{const base={id:'SIG-B626-V1',ownerPersonId:'PLAYER-FOUNDER',ownerNameSnapshot:'Founder',version:1,kind:'visual-authorization-seal',format:'normalized-strokes-v1',strokes:input,width:640,height:220,ink:'#123248',createdAtSim:0,status:'active',...over};
  if(!('digest' in over))base.digest=before.digest({format:base.format,ownerPersonId:base.ownerPersonId,version:base.version,strokes:(()=>{try{return before.normalizeStrokes(base.strokes);}catch(_error){return base.strokes;}})(),width:base.width,height:base.height,ink:String(base.ink).toLowerCase()});return base;};
const plain=value=>JSON.parse(JSON.stringify(value));
const cases=[
  ['xy',row(strokes(6,60))],['pressure',row(strokes(4,40,'all'))],['mixed',row(strokes(5,30,'some'))],
  ['negative zero',row([[{x:-0,y:.5},{x:.25,y:-0,pressure:-0},{x:1,y:1}],[{x:0,y:0},{x:.0001,y:.9999}]])],
  ['bounds',row([[{x:0,y:0,pressure:0},{x:1,y:1,pressure:1}]])],['near the byte limit',row(strokes(4,320))],
  ['upper ink',row(strokes(2,10),{ink:'#ABCDEF'})],['string fields',row(strokes(2,10),{version:'3',width:'640',height:'220'})],
  ['numeric owner',row(strokes(2,10),{ownerPersonId:7})],['revoked',row(strokes(2,10),{status:'revoked'})],
  ['unrounded (normalizing path)',row([[{x:.123456,y:.5},{x:.7,y:.25}]])],['array points (normalizing path)',row([[[.1,.2],[.3,.4]]])],
  ['extra key',row([[{x:.1,y:.2,z:1},{x:.3,y:.4}]])],['wrong digest',row(strokes(3,20),{digest:'0'.repeat(64)})],['digest of other strokes',{...row(strokes(3,20)),strokes:strokes(3,20)}],
  ['one point stroke',row([[{x:.1,y:.2}]])],['too many points',row(strokes(5,2048))],['pressure out of rounding',row([[{x:.1,y:.2,pressure:.12345},{x:.3,y:.4}]])],
  ['bad ink',row(strokes(2,5),{ink:'red'})],['bad version',row(strokes(2,5),{version:0})],['empty',row([])],['inherited key',row([[Object.assign(Object.create({extra:1}),{x:.1,y:.2}),{x:.3,y:.4}]])]
];
// 1.
for(const [label,seal] of cases){const a=now.validateVisualSeal(seal),b=before.validateVisualSeal(seal);assert.deepEqual(plain(a),plain(b),`1: ${label}: the same answer`);}
assert.equal(now.validateVisualSeal(cases[0][1]).ok,true,'1: a canonical seal is valid');assert.equal(now.validateVisualSeal(cases[3][1]).ok,true,'1: -0 encodes as 0');
// 2.
for(const pressure of [null,'some','all']){const state={simSeconds:0};now.ensurePrincipal(state,{id:'PLAYER-FOUNDER',legalName:'Founder'});const created=now.createVisualSeal(state,{ownerPersonId:'PLAYER-FOUNDER',strokes:strokes(3,50,pressure)}),seal=state.authorization.signatureAssetsById[created.id],check=now.validateVisualSeal(seal);
  assert.equal(check.ok,true,`2: ${pressure||'xy'}: created seal valid`);assert.equal(check.digest,seal.digest,`2: ${pressure||'xy'}: the digest it was created with`);}
// 3.
const big=row(strokes(6,150,'some')),time=api=>{const t=process.hrtime.bigint();for(let i=0;i<20;i++)api.validateVisualSeal(big);return Number(process.hrtime.bigint()-t)/1e6;};
for(let i=0;i<5;i++){time(now);time(before);}
const a=[],b=[];for(let i=0;i<15;i++){a.push(time(now));b.push(time(before));}
const median=list=>list.sort((x,y)=>x-y)[list.length>>1],ratio=median(a)/median(b);
assert.ok(ratio<.7,`3: a 900-point seal checked in under 70% of the time before (${(ratio*100).toFixed(0)}%)`);
console.log(JSON.stringify({suite:'build626-seal-strokes-text',ok:true,cases:cases.length,ratio:+ratio.toFixed(2)}));
