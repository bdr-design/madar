'use strict';
const assert=require('node:assert/strict'),{chromium,webkit}=require('playwright'),{boot}=require('./helpers/local-dom-app');
(async()=>{for(const engine of [chromium,webkit]){const browser=await engine.launch({headless:true}),errors=[];try{
 const {page}=await boot({browser,errors,beforeScripts:{fn:()=>{const counts=window.__QA_NAV_BIND_COUNTS__=new WeakMap(),add=EventTarget.prototype.addEventListener;EventTarget.prototype.addEventListener=function(type,...args){if(type==='click')counts.set(this,(counts.get(this)||0)+1);return add.call(this,type,...args);};}}});page.setDefaultTimeout(30000);
 await page.evaluate(async()=>{await __AUDIT__.runAuthorizedDomainCommand('corporate','open-company',{type:'bank',capital:200000000,legalName:'QA Navigation Bank'},{silent:true});
  const I=GH_INTEGRITY_CORE,P=GH_PERSISTENCE,q=window.__QA_NAV__={checks:0,saves:0};window.GH_INTEGRITY_CORE={...I,check(...args){q.checks++;return I.check(...args);}};
  window.GH_PERSISTENCE={...P,...Object.fromEntries(['commitState','commitStateSliced','commitDurableState'].map(name=>[name,function(...args){q.saves++;return P[name](...args); }]))};
  // A persistent card action is outside the replaceable drawer, so repeated renders must not bind it again.
  const button=document.createElement('button');button.id='qaPersistentNavigation';button.dataset.open='companyFacilities';button.dataset.arg='bank';button.textContent='QA';document.getElementById('assetCard').append(button);
 });
 const rows=[];
 for(let i=0;i<6;i++){
  await page.evaluate(()=>__AUDIT__.openDrawer('companyManage',{type:'bank',tab:'overview'}));
  rows.push(await page.evaluate(async()=>{const q=__QA_NAV__,s=__GH_STATE__,before={...q,cash:s.cash,revision:s.saveRevision};document.querySelector('#drawerBody [data-open="companyFacilities"]').click();await Promise.resolve();return {checks:q.checks-before.checks,saves:q.saves-before.saves,sameCash:s.cash===before.cash,sameRevision:s.saveRevision===before.revision,panel:__AUDIT__.currentPanel()};}));
 }
 assert.ok(rows.every(r=>r.checks===0&&r.saves===0&&r.sameCash&&r.sameRevision&&r.panel==='companyFacilities'),JSON.stringify(rows));
 const persistent=await page.evaluate(async()=>{const b=document.getElementById('qaPersistentNavigation'),before=GH_INTERACTION.telemetry().filter(r=>r.type==='BUTTON_DUPLICATE_BLOCKED').length;b.click();await Promise.resolve();return {listeners:__QA_NAV_BIND_COUNTS__.get(b),extraBlocked:GH_INTERACTION.telemetry().filter(r=>r.type==='BUTTON_DUPLICATE_BLOCKED').length-before,disabled:b.disabled,panel:__AUDIT__.currentPanel()};});
 assert.deepEqual(persistent,{listeners:1,extraBlocked:0,disabled:false,panel:'companyFacilities'});
 // Dock and strip navigation use their existing delegated route and also preserve the save revision.
 const revision=await page.evaluate(()=>__GH_STATE__.saveRevision);await page.locator('#companyDock [data-go="company"]').first().click();assert.equal(await page.evaluate(()=>__AUDIT__.currentPanel()),'company');assert.equal(await page.evaluate(()=>__GH_STATE__.saveRevision),revision);
 const encoded=await page.evaluate(async()=>{const P=GH_PERSISTENCE,note='حفظ 🛫 UTF-8 '.repeat(30000),draft={...__GH_STATE__,notes:note},oldNotes=__GH_STATE__.notes,vault=new Map();let envelope,generation=P.telemetry().generation;
  window.webkit={messageHandlers:{saveBridge:{postMessage(m){if(m.action==='storeSaveChunk'){vault.set(m.id,Uint8Array.from(atob(m.base64),c=>c.charCodeAt(0)));setTimeout(()=>dispatchEvent(new CustomEvent('gh-native-chunk-ack',{detail:{requestId:m.requestId,id:m.id,success:true}})),0);}else{envelope=m;setTimeout(()=>P.receiveAck({...m,success:true,generation:++generation}),0);}}}}};
  const out=await P.commitDurableState(draft,{prevalidated:true,yieldToFrame:()=>new Promise(r=>requestAnimationFrame(r))});
  return {ok:out.ok,bytes:out.utf8Bytes,expectedBytes:new TextEncoder().encode(envelope.saveJSON).byteLength,hash:envelope.saveHash===GH_CONTROL_PLANE.sha256(envelope.saveJSON),roundtrip:GH_STATE_CODEC.deserialize(envelope.saveJSON,{resolveChunk:id=>vault.get(id)}).notes===note,liveNotesUnchanged:__GH_STATE__.notes===oldNotes,locked:P.isLocked()};});
 assert.equal(encoded.ok,true);assert.equal(encoded.bytes,encoded.expectedBytes);assert.equal(encoded.hash,true);assert.equal(encoded.roundtrip,true);assert.equal(encoded.liveNotesUnchanged,true);assert.equal(encoded.locked,false);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({suite:'build383-navigation-browser',engine:engine.name(),ok:true,transitions:rows.length,navigationSaves:0,navigationIntegrityChecks:0,persistent,nativeBridgeFixture:encoded}));
 }finally{await browser.close();}}})().catch(e=>{console.error(e);process.exitCode=1;});
