'use strict';
// Guard against a fix that moves heaviness elsewhere (a tool, not an acceptance gate, and not an iPhone measurement).
// Compares two outputs of tools/measure_first_decision_companies.cjs (same phone, rows and companies), company by
// company and phase by phase (the decision and the play before it), and exits 1 when any company got heavier:
//  - a phase's missed frames grew by more than max(3, 25%), or its worst frame grew by more than 34 ms (two frames);
//  - a decision's committed command changed, failed, or stopped committing;
//  - a decision's uploaded save bytes grew by more than 25% and 64 KB (close to deterministic, unlike frames);
//  - a company measured before is missing or skipped after.
// One emulated run is noisy (the play phase most): a flagged company is measured again before a fix is kept.
//   node tools/compare_first_decision.cjs before.json after.json
const fs=require('fs');
const [beforePath,afterPath]=process.argv.slice(2);if(!beforePath||!afterPath){console.error('usage: compare_first_decision.cjs before.json after.json');process.exit(2);}
const before=JSON.parse(fs.readFileSync(beforePath,'utf8')),after=JSON.parse(fs.readFileSync(afterPath,'utf8'));
if(before.rows!==after.rows)console.warn(`warning: rows differ (${before.rows} vs ${after.rows})`);
const worse=(a,b)=>{const out=[];if(!a||!b)return out;
  if(b.missed-a.missed>Math.max(3,Math.ceil(a.missed*.25)))out.push(`missed ${a.missed}->${b.missed}`);
  if(b.max-a.max>34)out.push(`worst ${a.max}->${b.max} ms`);return out;};
const rows=[],problems=[];
for(const [company,a] of Object.entries(before.companies||{})){
  const b=after.companies?.[company];
  if(!a.frames){continue;}
  if(!b||!b.frames){problems.push(`${company}: measured before, ${b?.skipped||'missing'} after`);continue;}
  const callA=(a.calls||[]).map(c=>`${c.command}:${c.committed}`).join(','),callB=(b.calls||[]).map(c=>`${c.command}:${c.committed}`).join(',');
  if(callA!==callB)problems.push(`${company}: command ${callA} -> ${callB}`);
  if((b.calls||[]).some(c=>c.error||c.committed!==true))problems.push(`${company}: the decision did not commit (${JSON.stringify(b.calls)})`);
  const ua=a.uploads?.bytes,ub=b.uploads?.bytes;if(Number.isFinite(ua)&&Number.isFinite(ub)&&ub-ua>Math.max(65536,ua*.25))problems.push(`${company} decision: uploaded ${Math.round(ua/1024)} KB -> ${Math.round(ub/1024)} KB`);
  for(const [phase,key] of [['decision','frames'],['play','play']]){const w=worse(a[key],b[key]);if(w.length)problems.push(`${company} ${phase}: ${w.join(', ')}`);}
  rows.push([company,`${a.frames.max}/${a.frames.missed}`,`${b.frames.max}/${b.frames.missed}`,`${a.play?.max}/${a.play?.missed}`,`${b.play?.max}/${b.play?.missed}`]);
}
console.log('company      decision worst/missed  before -> after   play worst/missed  before -> after');
for(const r of rows)console.log(`${r[0].padEnd(12)} ${r[1].padStart(12)} -> ${r[2].padEnd(12)}   ${r[3].padStart(12)} -> ${r[4]}`);
if(problems.length){console.log('\nheavier or broken:');for(const p of problems)console.log(' - '+p);process.exitCode=1;}else console.log('\nno company got heavier');
