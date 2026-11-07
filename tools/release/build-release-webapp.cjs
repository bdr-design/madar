#!/usr/bin/env node
'use strict';
// VENTORA release edition: turns a copy of WebApp into the shipped one. Never run on the source tree itself.
//   1. Every script and stylesheet is minified (esbuild, no wrapper: a classic script keeps its globals; local names are
//      shortened and comments dropped).
//   2. Every script, stylesheet and data file is sealed with AES-256-GCM under a key made fresh for this build; the
//      file's own path is the associated data, so a sealed file cannot be swapped for another. index.html and
//      runtime-required.json stay readable (the native runtime checks them before WebKit loads anything).
//   3. The key is written, split and masked, into the Swift source the iPhone app reads it from (VentoraReleaseKey).
// Sealed file: "VENC1" + nonce(12) + ciphertext + tag(16), the layout CryptoKit's AES.GCM.SealedBox(combined:) opens.
// Usage: build-release-webapp.cjs --web <WebApp copy> --swift <VentoraReleaseKey.swift> [--minify-only|--seal-only] [--report <json>]
// The release workflow minifies first (--minify-only), runs the release smoke test on that copy, then seals it (--seal-only).
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');

const args=process.argv.slice(2),option=name=>{const at=args.indexOf(name);return at>=0?args[at+1]:null;};
const web=option('--web'),swift=option('--swift'),reportPath=option('--report'),minifyOnly=args.includes('--minify-only'),sealOnly=args.includes('--seal-only');
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
  const key=crypto.randomBytes(32),mask=crypto.randomBytes(32),masked=Buffer.from(key.map((byte,i)=>byte^mask[i]));
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
    private static let first: [UInt8] = ${list(masked)}
    private static let second: [UInt8] = ${list(mask)}
    static func bytes() -> [UInt8] { zip(first, second).map { $0 ^ $1 } }
}
`);
  key.fill(0);
}

const tree=crypto.createHash('sha256');for(const file of files)tree.update(`${file.rel}\0${crypto.createHash('sha256').update(fs.readFileSync(file.full)).digest('hex')}\n`);
report.treeSha256=tree.digest('hex');
if(reportPath)fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({files:report.files,minified:report.minified,sealed:report.sealed,kept:report.kept.length,treeSha256:report.treeSha256,minifiedRatio:report.minifiedBytesBefore?+(report.minifiedBytesAfter/report.minifiedBytesBefore).toFixed(3):1}));
