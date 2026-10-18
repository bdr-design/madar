import subprocess,json,os,re,time
from pathlib import Path
root=Path('/workspace/madar');out=Path('/workspace/scratch/ordered-review-20261018');dest=out/'mutants';dest.mkdir(exist_ok=True)
cases=[]
def replace(label,file,old,new,test,marker):
 text=(root/'WebApp'/file).read_text();assert old in text,(label,old);cases.append((label,file,text.replace(old,new,1),test,marker))
replace('per-row-plan-validation','app.js','plan.templates[chunk.templateRefs[offset-chunk.from]]','core.patchAt(plan,offset)','442','road apply must validate')
# Replace just the startup repair with its saved pre-fix definition.
base=(out/'baseline/WebApp/app.js').read_text();now=(root/'WebApp/app.js').read_text();name='  function normalizeLegacyRouteAssignments('
a=base.index(name);b=base.index('\n  function ',a+4);c=now.index(name);d=now.index('\n  function ',c+4);cases.append(('all-corridor-comparisons','app.js',now[:c]+base[a:b]+now[d:],'442','unrelated aviation corridors'))
replace('copy-canonical-routed-rows','fleet-legacy-route-plan-core.js','if(!row?.routeId)return;const routeId','if(!row?.routeId)return;remember(index,row);const routeId','442','canonical routed rows')
replace('drop-near-corridor-check','fleet-legacy-route-plan-core.js','||owners.route.corridorMetrics(other,route).duplicate','||false','442','differential:')
replace('repeat-mobility-validation','mobility-core.js','vehicle=m.vehicles.find(row=>row.id===vehicleId)||null','vehicle=findVehicle(state,vehicleId)','443','validate all mobility ownership once')
replace('discard-internal-projection','mobility-core.js',"if(m.status!=='active'||!m.vehicles.length)return;","if(m.status!=='active'||!m.vehicles.length)return managementSnapshot(state);",'443','private step must not build')
replace('duplicate-energy-economics','advanced-core.js','summary=core.economics(ctx.state,sites,energy)','summary=core.economics(ctx.state)','443','reuse site economics')
replace('duplicate-bank-ensure','advanced-core.js',"';core.reconcilePrudential(ctx.state);","';core.ensure(ctx.state);core.reconcilePrudential(ctx.state);",'443','prudential reconciliation')
replace('unused-company-summary','advanced-core.js',"overviewSummary=active==='overview'?companyOverviewSummary",'overviewSummary=true?companyOverviewSummary','443','prepare company operating summary')
replace('unused-branch-selector','advanced-core.js','branchRows=Array.isArray(row.branches)?row.branches:[],branchPanel=',"branchRows=Array.isArray(row.branches)?row.branches:[],unusedOptions=branchRows.filter(branch=>branch.status!=='closed'),branchPanel=",'443','unused-branch-selector')
replace('unused-payable-search','finance-core.js',"  const transferId=`PAYTR-${reportId||number}","  const payable=s.finance.payables.find(row=>row.number===number);\n  const transferId=`PAYTR-${reportId||number}",'446','must not search the complete payable history')
replace('eager-80-cards','app.js',"const size=view==='invoices'?2:4,",'const size=80,','444','construct only the bounded')
replace('repeat-first-page','app.js','from=page*size','from=0','444','every document appears once')
replace('drop-document-owner-filter','app.js',"if(view==='invoices'){const docs=(state.finance.invoices||[]).filter(d=>validCompany==='all'||(d.company||'group')===validCompany)","if(view==='invoices'){const docs=(state.finance.invoices||[]).filter(d=>true)",'444','every document appears once')
replace('unbounded-invalid-page','app.js','Number.isFinite(requested)?Math.floor(requested):0','Math.floor(requested)','444','invalid page is bounded')
replace('unbound-navigation-buttons','app.js',"document.querySelectorAll('[data-finance-page]').forEach", "document.querySelectorAll('[data-finance-page-broken]').forEach",'445','page navigation must terminate')
files={'442':'build442-fleet-review-work','443':'build443-company-review-work','444':'build444-document-pages','445':'build445-document-pages-browser','446':'build446-payroll-unused-work'};results=[]
for label,file,source,test,marker in cases:
 folder=dest/label/'WebApp';folder.mkdir(parents=True,exist_ok=True)
 for p in (root/'WebApp').iterdir():
  target=folder/p.name
  if target.exists() or target.is_symlink():target.unlink()
  if p.name==file:target.write_text(source)
  else:target.symlink_to(p,target_is_directory=p.is_dir())
 check=subprocess.run(['node','--check',str(folder/file)],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True);assert check.returncode==0,(label,check.stdout)
 env=os.environ.copy();env['GH_TEST_SOURCE_DIR']=str(folder.parent);env['PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS']='1';env['LD_LIBRARY_PATH']='/workspace/scratch/browser-deps/root/usr/lib/x86_64-linux-gnu'
 cmd=['node','tests/'+files[test]+'.cjs'];started=time.time()
 try:r=subprocess.run(cmd,cwd=root,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=75);code=r.returncode;log=r.stdout
 except subprocess.TimeoutExpired as e:code='timeout';log=str(e)
 (out/('mutant-'+label+'.log')).write_text(log);caught=code!=0 and code!='timeout' and 'AssertionError' in log and marker in log;results.append({'mutation':label,'file':file,'test':cmd,'exit_code':code,'detected':caught,'expected_assertion':marker,'seconds':round(time.time()-started,3)});(out/'mutations.json').write_text(json.dumps(results,indent=2)+'\n');print(label,caught,flush=True)
 if not caught:print(log[-3000:],flush=True)
assert all(r['detected'] for r in results)
