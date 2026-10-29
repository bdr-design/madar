'use strict';
// Owner («تتبع الثقل ... ابيها اصفار»; a calendar window in a 300k-asset world: replaying the window's rows reserved the
// store journal's whole log at once, one 67 MB block allocated and copied, 449 ms in one task at 2x CPU throttle, again on
// every window since a log that large was not pooled): the log keeps its row blocks in 512 KB segments made as rows are
// logged. On the real fleet store with 300,000 rows, against the source before (c57745e, from its own tree):
//  1. after each rollback the store equals, byte for byte (records, values, extras, length, live), the store before the
//     journal, over journals that replay every row through writeRows, set fields and extras, and add rows, alternately
//     rolled back and committed, the large log reused from the pool;
//  2. the replay's first slice, which reserves its 300,000 rows, allocates only the segments of the rows it logs (the
//     source before: about 64 MB at once);
//  3. a journal that follows a large one sees none of its rows marked, and its pooled log holds at most 32 MB of blocks.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const ROWS=300000;
function scenario(root){
  const STORE=require(path.join(root,'WebApp/fleet-store-core.js'));
  const assets=[];for(let i=0;i<ROWS;i++)assets.push({id:`B620-${i}`,type:i%3?'air':'sea',routeId:i%4?`R-${i%50}`:null,phase:i%4?'moving':'idle',progress:(i%97)/97,condition:80+(i%20),baseFacility:`F-${i%40}`});
  const store=STORE.fromAssets(assets,{at:0});
  const image=()=>({rows:Buffer.from(new Uint8Array(store.rows,0,store.length*STORE.STRIDE)).toString('base64'),values:JSON.stringify(store.values),extras:JSON.stringify(store.extras),length:store.length,live:store.live});
  const out={rounds:[],firstSliceBytes:null};
  const arrayBytes=()=>{global.gc?.();return process.memoryUsage().arrayBuffers;};
  for(let round=0;round<4;round++){
    const before=image(),journal=STORE.beginJournal(store),indices=Int32Array.from({length:store.length},(_,i)=>i),copy=STORE.readRows(store,indices),words=new Float64Array(copy.bytes);
    for(let k=0;k<indices.length;k+=7)words[k*(STORE.STRIDE/8)+3]+=round+1;
    const base=arrayBytes();
    // 2. The replay's first slice of 4,096 rows, which reserves all of them.
    STORE.writeRows(store,indices,copy.bytes,copy.extras,{rowStart:0,rowEnd:4096,reserveRows:indices.length});
    if(round===0)out.firstSliceBytes=arrayBytes()-base;
    for(let start=4096;start<indices.length;start+=4096)STORE.writeRows(store,indices,copy.bytes,copy.extras,{rowStart:start,rowEnd:Math.min(indices.length,start+4096),reserveRows:4096});
    for(let k=0;k<500;k++){const index=(k*613)%store.length;STORE.set(store,index,'condition',30+(k%60));if(k%50===0)STORE.set(store,index,'note',{round,k});}
    STORE.add(store,{id:`B620-ADD-${round}`,type:'air',phase:'idle',progress:0});
    const rolledBack=round%2===0;
    if(rolledBack){STORE.rollbackJournal(journal);out.rounds.push({rolledBack,restored:JSON.stringify(image())===JSON.stringify(before)});}
    else{STORE.endJournal(journal);out.rounds.push({rolledBack,restored:null});}
    // 3.
    const next=STORE.beginJournal(store),marked=next.seen.slice(0,store.length).some(Boolean);out.rounds[out.rounds.length-1].markedAfter=marked;STORE.endJournal(next);
  }
  return out;
}
if(process.env.QA_BUILD620_ROOT){process.stdout.write(JSON.stringify(scenario(process.env.QA_BUILD620_ROOT)));return;}
const ROOT=path.resolve(__dirname,'..'),PREVIOUS='c57745e',tree=fs.mkdtempSync(path.join(os.tmpdir(),'b620-'));
const run=root=>JSON.parse(execFileSync(process.execPath,['--expose-gc','--max-old-space-size=4096',__filename],{env:{...process.env,QA_BUILD620_ROOT:root},maxBuffer:64*1024*1024}).toString());
try{
  execFileSync('sh',['-c',`git -C "${ROOT}" archive ${PREVIOUS} WebApp | tar -x -C "${tree}"`]);
  const before=run(tree),now=run(process.env.GH_TEST_SOURCE_DIR||ROOT);
  // 1.
  for(const [index,row] of now.rounds.entries())if(row.rolledBack)assert.equal(row.restored,true,`1: round ${index}: the store after the rollback is the store before, byte for byte`);
  assert.deepEqual(now.rounds.map(row=>row.restored),before.rounds.map(row=>row.restored),'1: (as with the source before)');
  // 2.
  assert.ok(before.firstSliceBytes>=48*1024*1024,`2: (the source before allocated ${Math.round(before.firstSliceBytes/1048576)} MB for the replay's first slice)`);
  assert.ok(now.firstSliceBytes<4*1024*1024,`2: the reservation allocates no row block, the first slice only its segments (${(now.firstSliceBytes/1048576).toFixed(1)} MB)`);
  // 3.
  assert.ok(now.rounds.every(row=>row.markedAfter===false),'3: a journal after a large one sees none of its rows marked');
  console.log(JSON.stringify({suite:'build620-journal-log-segments',ok:true,rows:ROWS,firstSliceMB:{before:+(before.firstSliceBytes/1048576).toFixed(1),now:+(now.firstSliceBytes/1048576).toFixed(1)}}));
}finally{fs.rmSync(tree,{recursive:true,force:true});}
