'use strict';
// Owner (build 106 iPhone diagnostic: a purchase of 150,000 assets took 5-9 s with the clock stopped, the main thread
// idle two thirds of it; then «حلها على دفعات واختبارات صارمة جدًا جدًا»): the purchase yielded a frame after every
// slice of at most 4 ms (512 rows). Its rows now run in slices of 2 ms (512 rows at most), and its stages run the next
// slice in the same frame while the frame's work and the expected slice stay within 8 ms (frameWorkPacer), yielding a
// frame otherwise; every slice is still sent to the fleet worker. On the app's own pacer (from app.js) with a fake clock, and in the real app (local DOM, fleet worker)
// against the source before (1d7dce1, from its own tree, same browser):
//  1. the pacer yields exactly when the frame's work plus the expected slice would pass 8 ms: never more than 8 ms of
//     work in a frame except the one frame where a slice longer than any recent one ran (it cannot be foreseen), one
//     slice a frame after it until the expected slice falls back, and no yield while the work fits;
//  2. a purchase of 30,000 assets keeps one cheque, invoice, supplier transaction, delivery, purchase order and
//     authorization, and leaves exactly the source before's fleet (every row) and purchase order;
//  3. while its rows are written it paints at most 60% as many frames as slices (the source before: one frame a
//     slice), fewer frames in all than the source before, and it takes at most 80% of the source before's time (the
//     median of three alternate runs of each source);
//  4. every slice still reaches the fleet worker (no more than 512 rows each) and the worker's copy commits once;
//  5. no error is logged.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm'),{execFileSync}=require('node:child_process'),acorn=require('acorn');
const {chromium}=require('playwright'),{boot}=require('./helpers/local-dom-app');
const ROOT=path.resolve(__dirname,'..'),SOURCE=process.env.GH_TEST_SOURCE_DIR||ROOT,PREVIOUS='1d7dce1',QTY=30000;
// 1.
async function pacerClaims(){
  const src=fs.readFileSync(path.join(SOURCE,'WebApp/app.js'),'utf8');let found=null;
  (function visit(n){if(!n||typeof n!=='object'||found)return;if(n.type==='FunctionDeclaration'&&n.id?.name==='frameWorkPacer'){found=src.slice(n.start,n.end);return;}for(const v of Object.values(n)){if(Array.isArray(v))v.forEach(visit);else if(v&&typeof v==='object')visit(v);}})(acorn.parse(src,{ecmaVersion:'latest'}));
  assert.ok(found,'1: app.js defines frameWorkPacer');
  const run=async slices=>{let now=0,yields=0;const frames=[[]];const g={performance:{now:()=>now},yieldForInteractivePaint:async()=>{yields++;now+=16.7-(now%16.7);frames.push([]);}};vm.createContext(g);vm.runInContext(found,g);const pace=g.frameWorkPacer();
    for(const ms of slices){now+=ms;frames[frames.length-1].push(ms);await pace();}return {yields,frames:frames.filter(f=>f.length).map(f=>f.reduce((a,b)=>a+b,0))};};
  const even=await run(Array(12).fill(4));assert.ok(even.frames.every(ms=>ms<=8),`1: 4 ms slices: at most 8 ms of work a frame (${even.frames})`);assert.ok(even.frames.every(ms=>ms===8),`1: two 4 ms slices a frame (${even.frames})`);
  const small=await run(Array(40).fill(1));assert.ok(small.frames.every(ms=>ms<=8)&&small.frames.slice(0,-1).every(ms=>ms>=7),`1: 1 ms slices fill a frame up to 8 ms (${small.frames})`);
  const fits=await run([2,2,2]);assert.equal(fits.yields,0,'1: no frame is yielded while the work fits');
  // A slice longer than any before cannot be foreseen: it ends the frame it ran in, and the next frames hold one slice
  // until the expected slice falls back (by a tenth per slice), then two again.
  const big=await run([3,12,...Array(30).fill(3)]);assert.equal(big.frames[0],15,`1: an unforeseen 12 ms slice ends its frame (${big.frames})`);assert.ok(big.frames.slice(1,4).every(ms=>ms===3),`1: then one slice a frame (${big.frames})`);assert.ok(big.frames.slice(-3).every(ms=>ms>=6&&ms<=8),`1: then two again (${big.frames})`);
  const spike=await run([4,4,4,4,20,4,4,4,4]);assert.deepEqual(spike.frames.filter(ms=>ms>8),[20],`1: only the frame where the unforeseen 20 ms slice ran passes 8 ms (${spike.frames})`);
  const mixed=await run([1,1,5,1,1,1,1,1,1,1]);assert.ok(mixed.frames.every(ms=>ms<=8),`1: mixed slices: at most 8 ms of work a frame (${mixed.frames})`);
}
async function purchase(browser,root){
  const errors=[],{page}=await boot({browser,errors,root,fleetWorker:true,viewport:{width:844,height:390}});page.setDefaultTimeout(600000);
  await page.evaluate(async()=>{const a=__AUDIT__,s=__GH_STATE__;s.godMoney=true;s.infiniteMoney=true;
    await a.runAuthorizedDomainCommand('corporate','open-company',{type:'air',companyId:'air',capital:900000000,legalName:'QA Pacing Air',formationContract:'QA-606'},{silent:true});
    const airport=GH_WORLD_DATA.airports.find(r=>r[0]==='OMDB');
    await a.runAuthorizedDomainCommand('facilities','create',{facility:{id:'QA-OMDB',name:'QA OMDB',kind:'airport-base',company:'air',ownerCompanyId:'air',owned:true,sourceKey:'air:OMDB',code:airport[1],icao:'OMDB',iata:airport[1],city:airport[3]||'—',country:String(airport[5]||'—'),coords:[airport[6],airport[7]]},bucket:'globalBases'},{silent:true});
    // The browser's own save holds 6,000 assets; this gate measures the purchase, not the device save.
    const p=GH_PERSISTENCE;window.GH_PERSISTENCE=Object.freeze({...p,fleetRecordLimit:()=>2000000,commitDurableState:async()=>({ok:true,testHarness:true})});});
  await page.waitForFunction(()=>!window.__GH_DURABLE_COMMAND_CONTEXT__&&!GH_PERSISTENCE.isLocked());
  const out=await page.evaluate(async qty=>{
    const a=__AUDIT__,s=__GH_STATE__,count=()=>({cheques:s.finance.cheques.length,invoices:s.finance.invoices.length,supplier:s.supplierTransactions.length,deliveries:s.realism.procurement.deliveries.length,orders:s.realism.procurement.purchaseOrders?.length||0,proofs:Object.values(s.authorization.proofsById).filter(r=>r.action==='asset-purchase.authorize-order').length});
    const before=count();let frames=0,on=true;const tick=()=>{frames++;if(on)requestAnimationFrame(tick);};requestAnimationFrame(tick);
    let slices=0,firstFrame=null,lastFrame=null;const options={progress:()=>{slices++;if(firstFrame===null)firstFrame=frames;lastFrame=frames;}},t0=performance.now(),id=await a.buyAsset('air','used',GH_ASSET_CATALOG.air.used[0].id,'lease',qty,'QA-OMDB',true,'QA-606','air',options),ms=performance.now()-t0;on=false;
    const after=count(),stats=a.fleetEngineThreadClient()?.stats?.()||{},rows=JSON.stringify(GH_FLEET_DATA.map(s,row=>GH_FLEET_DATA.plain(row)));
    const digest=GH_CONTROL_PLANE.sha256(rows);
    const order=s.realism.procurement.purchaseOrders?.[0];
    return {id:Boolean(id),error:options.errorMessage||null,completed:options.completedCount,ms,frames,slices,applyFrames:lastFrame-firstFrame,before,after,fleet:GH_FLEET_DATA.size(s),digest,order:JSON.stringify(order),stats:{incrementalSyncs:stats.incrementalSyncs,maxMutationRows:stats.maxMutationRows,mutationCommits:stats.mutationCommits,mutationRollbacks:stats.mutationRollbacks||0}};
  },QTY);
  await page.close();return {...out,errors};
}
(async()=>{
  await pacerClaims();
  const tree=fs.mkdtempSync(path.join(os.tmpdir(),'b606-'));const browser=await chromium.launch({headless:true});
  try{
    execFileSync('sh',['-c',`git -C "${ROOT}" archive ${PREVIOUS} WebApp | tar -x -C "${tree}"`]);
    // Each source purchases three times, alternately (on the macOS runner one run of a source varied 1.4-3.6 s now and
    // 3.6-6.4 s before, so a single pair could land on either side of 80%); claim 3's time compares the medians, and every
    // other claim holds for every run.
    const runs={before:[],now:[]};for(let k=0;k<3;k++){runs.before.push(await purchase(browser,tree));runs.now.push(await purchase(browser,SOURCE));}
    for(const [label,list] of Object.entries(runs))for(const r of list){assert.equal(r.id,true,`2: ${label}: the purchase commits (${r.error})`);assert.equal(r.completed,QTY);assert.equal(r.fleet,QTY);}
    const median=list=>[...list].sort((x,y)=>x.ms-y.ms)[1],before=median(runs.before),now=median(runs.now);
    for(const r of runs.now){assert.equal(r.digest,before.digest,'2: exactly the source before\'s fleet, every row (each run)');assert.equal(r.order,before.order,'2: exactly the source before\'s purchase order (each run)');assert.ok(r.applyFrames<=0.6*(r.slices-1),`3: each run: at most 60% as many frames as slices (${r.applyFrames}, ${r.slices})`);assert.deepEqual(r.errors,[],'5: no error (each run)');}
    // 2.
    for(const key of ['cheques','invoices','supplier','deliveries','orders','proofs'])assert.equal(now.after[key]-now.before[key],1,`2: one ${key} for the order`);
    assert.equal(now.digest,before.digest,'2: exactly the source before\'s fleet, every row');assert.equal(now.order,before.order,'2: exactly the source before\'s purchase order');
    // 3.
    // The source before painted a frame after each slice of rows; now a frame holds two or more.
    assert.ok(before.applyFrames>=0.9*(before.slices-1),`3: (the source before painted a frame after every slice: ${before.applyFrames} frames, ${before.slices} slices)`);
    assert.ok(now.applyFrames<=0.6*(now.slices-1),`3: while the rows are written, at most 60% as many frames as slices (${now.applyFrames} frames, ${now.slices} slices)`);
    assert.ok(now.frames<now.slices&&now.frames<before.frames,`3: fewer frames for the purchase than the source before (${now.frames} against ${before.frames})`);
    assert.ok(now.ms<=0.8*before.ms,`3: at most 80% of the source before's time, median of three each (${now.ms.toFixed(0)} ms against ${before.ms.toFixed(0)}; now ${runs.now.map(r=>r.ms.toFixed(0))}, before ${runs.before.map(r=>r.ms.toFixed(0))})`);
    // 4.
    assert.ok(now.stats.incrementalSyncs>=now.slices,`4: every slice reaches the worker (${now.stats.incrementalSyncs} syncs, ${now.slices} slices)`);assert.ok(now.stats.maxMutationRows<=512,`4: at most 512 rows a slice (${now.stats.maxMutationRows})`);
    assert.equal(now.stats.mutationCommits,1,'4: the worker\'s copy commits once');assert.equal(now.stats.mutationRollbacks,0);
    // 5.
    assert.deepEqual(now.errors,[],'5: no error');
    console.log(JSON.stringify({suite:'build606-purchase-frame-pacing-browser',ok:true,now:{ms:Math.round(now.ms),frames:now.frames,applyFrames:now.applyFrames,slices:now.slices,runs:runs.now.map(r=>Math.round(r.ms))},before:{ms:Math.round(before.ms),frames:before.frames,applyFrames:before.applyFrames,slices:before.slices,runs:runs.before.map(r=>Math.round(r.ms))}}));
  }finally{await browser.close();fs.rmSync(tree,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
