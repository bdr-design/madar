'use strict';
// Emulated phone (200,000 assets, 4x CPU): the fleet save validation's static pass read every row and inspected its
// text, about 400 ms per chunk of 32,768 rows, and a day close moves every active chunk's identity version without
// writing a static field, so the first command after it re-checked them all (2.3 s on the iPhone's worker). Rows
// without extras are now inspected once per group of the same profile, id pattern and digit count, and name pattern
// and digit count. Proven against summarizeReference (every check on every row), on rows that take the grouped path:
//  1. digit counts that cross the 180-character text limit, padded and unpadded numbers, a refused character in a
//     prefix, a blank prefix, ids and names absent;
//  2. invalid owners and classes (company errors name every row, including a duplicated id), the 1,024 error cap;
//  3. dead rows and rows with extras interleaved, more than 4,096 groups (row-by-row beyond the table);
//  4. a uniform fleet is inspected once per group, not once per row.
// Run twice: with the module's own text check (the fleet worker loads no identity system) and with GH_IDENTITY's.
const assert=require('node:assert/strict'),path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
global.window=global;require(path.join(ROOT,'WebApp/transaction-core.js'));
const STORE=require(path.join(ROOT,'WebApp/fleet-store-core.js'));require(path.join(ROOT,'WebApp/fleet-event-core.js'));
const FLEET=require(path.join(ROOT,'WebApp/fleet-access-core.js')),CORE=require(path.join(ROOT,'WebApp/fleet-save-validation-core.js'));
const params={routeIds:['A1'],routes:[['A1','air','air',null]],registryCompanies:['air','sea'],companyReferenceCompanies:['air','sea'],definitionCompanies:['air','sea'],legacyAssetOwners:{}};
const base={phase:'idle',progress:0,fuel:100,condition:90,baseFacility:'F-AIR'};
const profile=(owner='air',extra={})=>({ownerCompanyId:owner,assetMode:'air',type:'air',assetClass:'air',model:'Airbus A320',icon:'plane',year:2020,...extra});
const same=(label,state,expectedSingles=null)=>{
  let singles=0;const counting={...FLEET,scan(s,fields,fn,options){if(options&&options.to-options.from===1)singles++;return FLEET.scan(s,fields,fn,options);}};
  const reference=CORE.summarizeReference(state,FLEET,params),value=CORE.summarize(state,counting,params);
  assert.deepEqual(value,reference,`${label}: the grouped static pass equals the one-pass reference`);
  assert.equal(CORE.staticStats().lastReused,0,`${label}: every chunk was inspected`);
  if(expectedSingles!==null)assert.ok(singles<=expectedSingles,`${label}: ${singles} rows inspected one by one (at most ${expectedSingles})`);
  return {errors:value.errors,company:value.companyPlatform.errors.length,overflow:value.companyPlatform.overflow,singles};
};
function scenarios(inspector){
const rows=[];
  // 1. Text limits by digit count: a 176-character prefix is 177-181 characters with 1-5 digits (180 is the limit).
  const long='N'.repeat(176);
  for(const n of [7,42,999,1000,99999,100000])rows.push({...base,...profile(),id:`AIR-${n}`,name:`${long}${n}`});
  for(let n=1;n<=300;n++)rows.push({...base,...profile(),id:`PAD-${String(n).padStart(7,'0')}`,name:`GH Air ${n}`});
  rows.push({...base,...profile(),id:'BAD-1',name:'Bad<Air 1'},{...base,...profile(),id:'BAD-2',name:'Bad<Air 22'});
  rows.push({...base,...profile(),id:'BLANK-1',name:'   7'},{...base,...profile(),id:'NOID'},{...base,...profile(),id:'Q"1',name:'Quote"9'});
  // 2. Company errors: unknown owner and invalid class, a duplicated id across groups.
  for(let n=0;n<40;n++)rows.push({...base,...profile('ghost'),id:`GHOST-${n}`,name:`Ghost ${n}`});
  rows.push({...base,...profile('ghost'),id:'GHOST-3',name:'Ghost dup 100'},{...base,...profile('ghost'),id:'GHOST-77',name:'Ghost dup 101'});
  for(let n=0;n<20;n++)rows.push({...base,...profile('air',{assetClass:'Bad Class'}),id:`CLS-${n}`,name:`Class ${n}`});
  // 3. Rows with extras interleaved (text and coordinates only extras carry).
  for(let n=0;n<30;n++)rows.push({...base,...profile(),id:`EXT-${n}`,name:`Extra ${n}`,city:n%7?'Riyadh':'Ri<yadh',coords:n%5?[24.7,46.7]:[200,0]});
  for(let n=0;n<20000;n++)rows.push({...base,...profile(),id:`SV-${n}`,name:`GH Air ${n}`});
  const state={simSeconds:1000,fleet:STORE.fromAssets(rows,{at:0})};
  const results=[];
  results.push(['mixed fleet',same('mixed fleet',state)]);
  assert.ok(results[0][1].errors.includes('display-text-assets-name')&&results[0][1].errors.includes('display-attribute-assets-id')&&results[0][1].errors.includes('display-coords-assets'),'the fixture fails the text, attribute and coordinate checks');
  assert.equal(results[0][1].company,61,'every ghost and class row has its own company error (the duplicated GHOST-3 is one error)');
  // Dead rows: remove some rows in place of the grouped ones.
  FLEET.removeMany?FLEET.removeMany(state,['SV-5','GHOST-4','PAD-0000010','EXT-3']):['SV-5','GHOST-4','PAD-0000010','EXT-3'].forEach(id=>FLEET.remove(state,id));
  results.push(['after removals',same('after removals',state)]);
  // The 1,024 company-error cap and overflow.
  {const many=[];for(let n=0;n<1500;n++)many.push({...base,...profile('ghost'),id:`CAP-${n}`,name:`Cap ${n}`});const capped={simSeconds:1000,fleet:STORE.fromAssets(many,{at:0})};const out=same('error cap',capped);assert.equal(out.company,1024);assert.equal(out.overflow,true);results.push(['error cap',out]);}
  // More than 4,096 groups: 5,000 name patterns.
  {const wide=[];for(let n=0;n<5000;n++)wide.push({...base,...profile(),id:`W-${n}`,name:`Pattern ${n} No 7`});const s={simSeconds:1000,fleet:STORE.fromAssets(wide,{at:0})},out=same('over 4,096 groups',s);assert.equal(out.singles,5000,'beyond 4,096 groups every row is inspected on its own');results.push(['over 4,096 groups',out]);}
  // 4. A uniform fleet of 40,000 rows is inspected once per group.
  {const uniform=[];for(let n=0;n<40000;n++)uniform.push({...base,...profile(),id:`U-${n}`,name:`GH Air ${n}`});const s={simSeconds:1000,fleet:STORE.fromAssets(uniform,{at:0})};const out=same('uniform fleet',s,20);assert.ok(out.singles>=1);results.push(['uniform fleet',out]);}
  return results.map(([label,r])=>({inspector,label,errors:r.errors.length,company:r.company,singles:r.singles}));
}
const all=[...scenarios('module')];
for(const file of ['company-definitions.js','capability-registry-core.js','company-platform-core.js','identity-system.js'])require(path.join(ROOT,'WebApp',file));
assert.equal(typeof globalThis.GH_IDENTITY?.inspectPlainText,'function');
all.push(...scenarios('identity'));
console.log(JSON.stringify({suite:'build521-static-validation-groups',ok:true,results:all}));
