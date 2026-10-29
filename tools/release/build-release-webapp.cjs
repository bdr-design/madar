#!/usr/bin/env node
'use strict';
// VENTORA release edition: turns a copy of WebApp into the shipped one. Never run on the source tree itself.
//   1. Every script and stylesheet is minified (esbuild, no wrapper: a classic script keeps its globals; local names are
//      shortened and comments dropped).
//   2. Every script, stylesheet and data file is sealed with AES-256-GCM under a key made fresh for this build; the
//      file's own path is the associated data, so a sealed file cannot be swapped for another. index.html and
//      runtime-required.json stay readable (the native runtime checks them before WebKit loads anything).
//   3. The key is written, split and masked, into the Swift source the iPhone app reads it from (VentoraReleaseKey), and,
//      with --kotlin, into the Kotlin source the Android app reads it from (the same key, so one sealed pack serves both).
// Sealed file: "VENC1" + nonce(12) + ciphertext + tag(16), the layout CryptoKit's AES.GCM.SealedBox(combined:) opens.
// Usage: build-release-webapp.cjs --web <WebApp copy> --swift <VentoraReleaseKey.swift> [--kotlin <VentoraReleaseKey.kt>] [--minify-only|--seal-only] [--report <json>]
// The release workflow minifies first (--minify-only), runs the release smoke test on that copy, then seals it (--seal-only).
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');

const args=process.argv.slice(2),option=name=>{const at=args.indexOf(name);return at>=0?args[at+1]:null;};
const web=option('--web'),swift=option('--swift'),kotlin=option('--kotlin'),reportPath=option('--report'),minifyOnly=args.includes('--minify-only'),sealOnly=args.includes('--seal-only');
if(!web||(!minifyOnly&&!swift))throw new Error('usage: --web <dir> --swift <file> [--minify-only] [--report <file>]');
const root=path.resolve(web);
if(fs.existsSync(path.join(root,'..','.git'))&&path.basename(root)==='WebApp'&&!process.env.VENTORA_RELEASE_ALLOW_IN_PLACE)
  throw new Error('refusing to transform the source WebApp; run on a copy (or set VENTORA_RELEASE_ALLOW_IN_PLACE in CI)');

const MAGIC=Buffer.from('VENC1','utf8'),SEALED=new Set(['.js','.css','.json']),KEEP=new Set(['runtime-required.json']);
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{const full=path.join(dir,entry.name);if(entry.isSymbolicLink())throw new Error(`symbolic link in WebApp: ${full}`);return entry.isDirectory()?walk(full):[full];});
const files=walk(root).map(full=>({full,rel:path.relative(root,full).split(path.sep).join('/')})).sort((a,b)=>a.rel<b.rel?-1:1);
const report={files:files.length,minified:0,minifiedBytesBefore:0,minifiedBytesAfter:0,sealed:0,kept:[],treeSha256:null};

if(!sealOnly){const esbuild=require('esbuild');for(const file of files){
  const ext=path.extname(file.rel).toLowerCase();if(ext!=='.js'&&ext!=='.css')continue;if(/\.min\.(js|css)$/.test(file.rel))continue;
  const source=fs.readFileSync(file.full,'utf8');
  const out=esbuild.transformSync(source,{loader:ext==='.css'?'css':'js',minify:true,legalComments:'none',charset:'utf8',sourcefile:file.rel});
  if(out.warnings.length)process.stderr.write(`${file.rel}: ${out.warnings.length} esbuild warnings\n`);
  report.minified++;report.minifiedBytesBefore+=Buffer.byteLength(source);report.minifiedBytesAfter+=Buffer.byteLength(out.code);
  fs.writeFileSync(file.full,out.code);
}}

if(!minifyOnly){
  // The key is written into the app split in four shares (their XOR) and scattered over one 128-byte table in an order
  // made for this build, never as one readable array (approved security layer 4: nothing is computed during play; the
  // app joins it once when its first sealed file opens).
  const key=crypto.randomBytes(32),shares=[crypto.randomBytes(32),crypto.randomBytes(32),crypto.randomBytes(32)];
  shares.push(Buffer.from(key.map((byte,i)=>byte^shares[0][i]^shares[1][i]^shares[2][i])));
  const flat=Buffer.concat(shares),order=[...Array(128).keys()];for(let i=127;i>0;i--){const j=crypto.randomInt(i+1);[order[i],order[j]]=[order[j],order[i]];}
  const parts=Buffer.alloc(128);order.forEach((at,j)=>{parts[at]=flat[j];});
  for(const file of files){
    const ext=path.extname(file.rel).toLowerCase();if(!SEALED.has(ext)||KEEP.has(file.rel)){report.kept.push(file.rel);continue;}
    const plain=fs.readFileSync(file.full),nonce=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,nonce);
    cipher.setAAD(Buffer.from(file.rel,'utf8'));
    const body=Buffer.concat([cipher.update(plain),cipher.final()]),tag=cipher.getAuthTag();
    fs.writeFileSync(file.full,Buffer.concat([MAGIC,nonce,body,tag]));report.sealed++;
  }
  const list=bytes=>`[${[...bytes].map(byte=>`0x${byte.toString(16).padStart(2,'0')}`).join(', ')}]`;
  fs.writeFileSync(swift,`import Foundation

/// VENTORA release key, written by tools/release/build-release-webapp.cjs for this build only (never committed).
enum VentoraReleaseKey {
    private static let parts: [UInt8] = ${list(parts)}
    private static let order: [UInt8] = ${list(order)}
    static func bytes() -> [UInt8] { (0..<32).map { i in parts[Int(order[i])] ^ parts[Int(order[32 + i])] ^ parts[Int(order[64 + i])] ^ parts[Int(order[96 + i])] } }
}
`);
  const kotlinBytes=bytes=>[...bytes].map(byte=>`0x${byte.toString(16).padStart(2,'0')}.toByte()`).join(', ');
  if(kotlin)fs.writeFileSync(kotlin,`package com.ventora.game

/** VENTORA release key, written by tools/release/build-release-webapp.cjs for this build only (never committed). */
internal object VentoraReleaseKey {
    private val parts = byteArrayOf(${kotlinBytes(parts)})
    private val order = intArrayOf(${order.join(', ')})
    fun bytes(): ByteArray = ByteArray(32) { i -> (parts[order[i]].toInt() xor parts[order[32 + i]].toInt() xor parts[order[64 + i]].toInt() xor parts[order[96 + i]].toInt()).toByte() }
}
`);
  key.fill(0);flat.fill(0);for(const share of shares)share.fill(0);
}

const tree=crypto.createHash('sha256');for(const file of files)tree.update(`${file.rel}\0${crypto.createHash('sha256').update(fs.readFileSync(file.full)).digest('hex')}\n`);
report.treeSha256=tree.digest('hex');
if(reportPath)fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({files:report.files,minified:report.minified,sealed:report.sealed,kept:report.kept.length,treeSha256:report.treeSha256,minifiedRatio:report.minifiedBytesBefore?+(report.minifiedBytesAfter/report.minifiedBytesBefore).toFixed(3):1}));
