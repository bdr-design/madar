'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),crypto=require('node:crypto'),ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..'),K=require(path.join(ROOT,'WebApp/save-chunk-codec.js'));
const golden=require('./fixtures/build490-lz4-blocks.json'),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
assert.equal(typeof K.packContainer,'function');for(const p of golden.cases){const raw=K.unpackContainer(new Uint8Array(Buffer.from(p.stored,'base64')),p.rawBytes);assert.equal(sha(raw),p.sha256,p.name);assert.equal(sha(K.packContainer(raw).bytes),p.producerStoredSha256,'producer vector independently decoded by Python lz4: '+p.name);}
const crcReference=bytes=>{let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;}return(c^0xffffffff)>>>0;};
assert.equal(K.crc32(new TextEncoder().encode('123456789')),0xcbf43926);let seed=42;const random=n=>Uint8Array.from({length:n},()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed&255;});let refused=0,packed=0;
for(const n of [1,7,8,12,13,127,128,129,255,256,1023,4096,65535,65536,4194304])for(const kind of ['zeros','period','random']){
 const bytes=kind==='zeros'?new Uint8Array(n):kind==='period'?Uint8Array.from({length:n},(_,i)=>(i*17)%31):random(n),out=K.packContainer(bytes);assert.equal(K.crc32(bytes),crcReference(bytes));
 if(out.encoding==='identity'){assert.deepEqual(out.bytes,bytes);continue;}packed++;assert.equal(out.encoding,K.LZ4_ENCODING);assert(out.bytes.length<=Math.floor(n*.875));assert.deepEqual(K.unpackContainer(out.bytes,n),bytes);
 const unaligned=new Uint8Array(out.bytes.length+1);unaligned.set(out.bytes,1);assert.deepEqual(K.unpackContainer(unaligned.subarray(1),n),bytes);
 for(const at of [0,8,12,16,out.bytes.length-1]){const bad=out.bytes.slice();bad[at]^=255;assert.throws(()=>K.unpackContainer(bad,n),/corrupt/);refused++;}
 for(const cut of [1,Math.floor(out.bytes.length/2),out.bytes.length-1]){assert.throws(()=>K.unpackContainer(out.bytes.subarray(0,cut),n),/corrupt/);refused++;}
 const extra=new Uint8Array(out.bytes.length+1);extra.set(out.bytes);assert.throws(()=>K.unpackContainer(extra,n),/corrupt/);refused++;
}
for(const n of [0,-1,4194305,Infinity,NaN,1.2]){assert.throws(()=>K.unpackContainer(new Uint8Array(20),n),/corrupt/);refused++;}
// Offset zero / before output, unterminated length, source overrun, output overrun: none may loop or grow allocation.
for(const body of [[0,0,0],[0,1,0],[240,255],[240,127],[31,65,1,0,255,255,255]]){const bytes=new Uint8Array(20+body.length),v=new DataView(bytes.buffer);bytes.set([71,72,67,76,90,52,66,49]);v.setUint32(8,4096,true);v.setUint32(12,1,true);bytes.set(body,20);assert.throws(()=>K.unpackContainer(bytes,4096),/corrupt/);refused++;}
console.log(JSON.stringify({suite:'build490-container-compression',ok:true,golden:golden.cases.length,packed,refused,crcExact:true,maxRawBytes:4194304}));
