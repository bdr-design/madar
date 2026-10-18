#!/usr/bin/env python3
"""Explicit bounded diagnosis of a Node VM host crash; no test assertion is suppressed."""
import json,os,subprocess,sys,time
from pathlib import Path
root=Path(sys.argv[1]);out=Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True)
rows=[]
for mode,flags in [('default',[]),('jitless',['--jitless'])]:
    for trial in range(5):
        log=out/f'hospitality-vm-{mode}-{trial}.log'
        with log.open('w') as stream:
            result=subprocess.run(['node',*flags,'-e',"const fs=require('node:fs'),M=require('node:module'),p=process.argv[1],s=fs.readFileSync(p,'utf8').split('// VM_HOST_INTERPRETER_END\\n').pop(),m=new M(p,module);m.filename=p;m.paths=M._nodeModulePaths(require('node:path').dirname(p));m._compile(s,p);",str(root/'tests/build395-hospitality-edge-cases.cjs')],cwd=root,stdout=stream,stderr=subprocess.STDOUT,timeout=60)
        row={'mode':mode,'trial':trial,'exit_code':result.returncode,'log':log.name};rows.append(row);print(json.dumps(row),flush=True)
(out/'hospitality-vm-host.json').write_text(json.dumps(rows,indent=2)+'\n')
crashes=Path.home()/'Library/Logs/DiagnosticReports'
if crashes.exists():
    for file in sorted(crashes.glob('node*.ips'),key=lambda p:p.stat().st_mtime,reverse=True)[:5]:
        if time.time()-file.stat().st_mtime<600:(out/file.name).write_bytes(file.read_bytes()[:2_000_000])
# Default-mode native crashes are the subject of this diagnosis. A normal assertion failure still fails this probe.
assert all(r['exit_code'] in [0,-11] for r in rows if r['mode']=='default'),rows
assert all(r['exit_code']==0 for r in rows if r['mode']=='jitless'),rows
