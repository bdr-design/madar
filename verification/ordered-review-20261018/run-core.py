import subprocess,json,time,hashlib
from pathlib import Path
root=Path('/workspace/madar');out=Path('/workspace/scratch/ordered-review-20261018');results=[]
names=['build442-fleet-review-work', 'build443-company-review-work', 'build444-document-pages', 'build446-payroll-unused-work', 'build372-legacy-route-plan', 'build372-legacy-route-repair-index', 'build372-route-normalization-plan', 'build351-mobility-stepping', 'build366-mobility-no-repeat-scans', 'build401-mobility-batching-and-indexes', 'build358-energy-market', 'build363-energy-health-contract', 'build378-energy-blocks-ppa', 'build369-insurance-risk-batch', 'build364-realestate-internal-leases', 'build378-realestate-off-plan', 'build364-customer-companies-core', 'build400-telecom-peer-index', 'build402-company-daily-indexes', 'build396-hospitality-budgets', 'build393-hospitality-financial-safety', 'build368-hr-payroll-parity', 'build340-payroll-settlement-index', 'build364-financial-batches', 'build382-cheque-index', 'tax-precision-and-routing', 'build436-save-work-removal', 'build437-adoption-patch-lineage', 'build438-day-scratch-work', 'build432-ready-fleet-validation', 'build435-conditional-prestage', 'build439-summary-single-request', 'build440-document-collection-work', 'build441-bank-migration-work', 'fleet-business-boundary']
for name in names:
 cmd=['node','tests/'+name+'.cjs'];start=time.time()
 with (out/(name+'.log')).open('w') as log:
  try:r=subprocess.run(cmd,cwd=root,stdout=log,stderr=subprocess.STDOUT,timeout=150);code=r.returncode
  except subprocess.TimeoutExpired:code='timeout'
 results.append({'argv':cmd,'exit_code':code,'seconds':round(time.time()-start,3),'test_sha256':hashlib.sha256((root/cmd[1]).read_bytes()).hexdigest()})
 (out/'core-results.json').write_text(json.dumps(results,indent=2)+'\n');print(name,code,flush=True)
