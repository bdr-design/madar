'use strict';
// VENTORA release seal check: every script, stylesheet and data file of the sealed WebApp opens under the key written
// into VentoraReleaseKey.swift, bound to its own path, and gives back exactly the minified file; a file opened under
// another path, or with one byte changed, is refused (what VentoraPack.open does in the app).
// Usage: node tests/release/ventora-seal-roundtrip.cjs <sealed WebApp> <minified WebApp> <VentoraReleaseKey.swift>
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const [sealedRoot,plainRoot,swift]=process.argv.slice(2).map(p=>path.resolve(p));
// The key is four shares scattered over one table in this build's order (build-release-webapp.cjs): joined here as the app does.
const source=fs.readFileSync(swift,'utf8'),table=name=>{const m=source.match(new RegExp(`${name}: \\[UInt8\\] = \\[(0x[0-9a-f]{2}(?:, 0x[0-9a-f]{2})*)\\]`));assert.ok(m,`the ${name} table`);return m[1].split(', ').map(x=>parseInt(x,16));};
const parts=table('parts'),order=table('order');assert.equal(parts.length,128);assert.deepEqual([...order].sort((a,b)=>a-b),[...Array(128).keys()],'the order is a permutation');
assert.equal(source.match(/\[(0x[0-9a-f]{2}(?:, 0x[0-9a-f]{2})*)\]/g).length,2,'no other byte table');
const key=Buffer.from(Array.from({length:32},(_,i)=>parts[order[i]]^parts[order[32+i]]^parts[order[64+i]]^parts[order[96+i]]));assert.equal(key.length,32);
const MAGIC=Buffer.from('VENC1');
const open=(data,rel)=>{if(!data.subarray(0,5).equals(MAGIC))return null;const nonce=data.subarray(5,17),tag=data.subarray(data.length-16),body=data.subarray(17,data.length-16);try{const d=crypto.createDecipheriv('aes-256-gcm',key,nonce);d.setAAD(Buffer.from(rel));d.setAuthTag(tag);return Buffer.concat([d.update(body),d.final()]);}catch{return null;}};
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
let sealed=0,plain=0;
for(const full of walk(sealedRoot)){
  const rel=path.relative(sealedRoot,full).split(path.sep).join('/'),ext=path.extname(rel).toLowerCase(),data=fs.readFileSync(full),expected=fs.readFileSync(path.join(plainRoot,rel));
  const must=['.js','.css','.json'].includes(ext)&&rel!=='runtime-required.json';
  if(!must){assert.ok(data.equals(expected),`${rel} stays as shipped`);plain++;continue;}
  const opened=open(data,rel);assert.ok(opened&&opened.equals(expected),`${rel} opens to the minified file`);sealed++;
  if(sealed<=3){assert.equal(open(data,rel+'x'),null,'bound to its path');const bad=Buffer.from(data);bad[bad.length-20]^=1;assert.equal(open(bad,rel),null,'an edited byte is refused');}
}
assert.ok(sealed>100,`sealed files: ${sealed}`);
console.log('VENTORA_SEAL_ROUNDTRIP_PASS',JSON.stringify({sealed,plain}));
