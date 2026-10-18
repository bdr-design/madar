import subprocess,json,time,hashlib,os
from pathlib import Path
root=Path('/workspace/madar');out=Path('/workspace/scratch/ordered-review-20261018');results=[]
env=os.environ.copy();env['PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS']='1';env['LD_LIBRARY_PATH']='/workspace/scratch/browser-deps/root/usr/lib/x86_64-linux-gnu';env['GH_LAYOUT_CAPTURE_DIR']=str(out/'screenshots-after')
for name in ['build445-document-pages-browser', 'build419-document-drawer-work-browser', 'build371-custom-road-geometry-browser', 'build371-durable-fleet-isolation-browser', 'build399-bank-prudential-summary-layout-browser', 'build394-hospitality-browser', 'build382-nonfleet-tax-browser', 'build433-request-decisions-browser', 'build411-command-row-patch-browser', 'build422-conference-content-layout-browser', 'phone-layout-browser']:
 cmd=['node','tests/'+name+'.cjs'];start=time.time()
 with (out/(name+'.log')).open('w') as log:
  try:r=subprocess.run(cmd,cwd=root,stdout=log,stderr=subprocess.STDOUT,timeout=240,env=env);code=r.returncode
  except subprocess.TimeoutExpired:code='timeout'
 results.append({'argv':cmd,'exit_code':code,'seconds':round(time.time()-start,3),'test_sha256':hashlib.sha256((root/cmd[1]).read_bytes()).hexdigest()})
 (out/'browser-results.json').write_text(json.dumps(results,indent=2)+'\n');print(name,code,flush=True)
