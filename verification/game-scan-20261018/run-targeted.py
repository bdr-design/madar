import os,subprocess,json,time,hashlib
from pathlib import Path
root=Path('/workspace/madar');out=root/'verification/game-scan-20261018';out.mkdir(exist_ok=True)
names=['build439-summary-single-request','build440-document-collection-work','build441-bank-migration-work','build372-fleet-ui-summary','build372-interactive-summary-consumers','build373-conference-large-fleet-browser','build419-document-drawer-work-browser','build420-conference-durable-browser','build421-conference-recovery-contract','build382-cheque-index','build364-financial-batches','build385-bank-credit-accounting','build358-bank-market','build403-legacy-runtime-migration-browser','build433-request-decisions-browser','build411-command-row-patch-browser','build435-conditional-prestage','build431-decision-notices','build432-ready-fleet-validation','lint']
commands=[['node','tests/'+n+'.cjs'] for n in names]+[['python3','tests/build334-source-layout.py'],['python3','tests/acceptance-policy.py']]
assert all((root/a[1]).is_file() for a in commands)
env={**os.environ,'PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS':'1','LD_LIBRARY_PATH':'/workspace/scratch/browser-deps/root/usr/lib/x86_64-linux-gnu'};rows=[]
source=json.load(open(root/'RUNTIME_SOURCE_MANIFEST.json'))['source_tree_sha256']
for argv in commands:
 print('START',argv[1],flush=True);started=time.monotonic()
 try:r=subprocess.run(argv,cwd=root,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=240);code=r.returncode;log=r.stdout
 except subprocess.TimeoutExpired as e:code='timeout';log=str(e)
 name=Path(argv[1]).stem+'.log';(out/name).write_text(log);rows.append({'argv':argv,'exit_code':code,'seconds':round(time.monotonic()-started,3),'log':name,'script_sha256':hashlib.sha256((root/argv[1]).read_bytes()).hexdigest()})
 d={'source_tree_sha256':source,'scope':'22 related local scripts only; not full acceptance, native CI or iPhone performance.','declared_gates':471,'preflight_definitions':74,'passed':sum(r['exit_code']==0 for r in rows),'total':len(commands),'completed':len(rows)==len(commands),'results':rows};(out/'targeted-results.json').write_text(json.dumps(d,indent=2)+'\n');print('END',argv[1],code,flush=True)
 if code!=0:print(log[-8000:],flush=True);raise SystemExit(1)
