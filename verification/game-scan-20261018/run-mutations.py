from pathlib import Path
import tempfile,os,subprocess,json,hashlib
root=Path('/workspace/madar');web=root/'WebApp';out=root/'verification/game-scan-20261018';app=(web/'app.js').read_text();bank=(web/'banking-core.js').read_text();oldBank=(Path('/workspace/scratch/game-scan-20261018/baseline/WebApp/banking-core.js')).read_text()
def function(s,name):
 a=s.index('  function '+name+'(');b=s.index('\n  function ',a+10);return s[a:b]
cases=[
 ('duplicate-summary-query','app.js',"asked=fleetUiSummaryCache.get(key)?.asking?.promise", "asked=client.query(store,{name:'uiSummary',params:options,simSeconds})",'build439-summary-single-request'),
 ('retain-historical-summary-stores','app.js','fleetUiSummaryCache.clear();','', 'build439-summary-single-request'),
 ('accept-older-pending-time','app.js','Number(found.result.asOfSimSeconds)===Number(simSeconds)&&','', 'build439-summary-single-request'),
 ('accept-value-only-stale-proof','app.js','&&(valueRevision===null||window.GH_FLEET_STORE.valueRevision(store)===valueRevision)','', 'build439-summary-single-request'),
 ('unused-invoice-preparation','app.js',"if(view==='cheques'){const cheques=", "if(view==='cheques'){state.finance.invoices.filter(()=>true);const cheques=",'build440-document-collection-work'),
 ('per-card-cheque-scan','app.js','issuedByInvoice.get(x.number)',"(state.finance.cheques||[]).find(ch=>ch.invoiceNumber===x.number&&ch.status==='صادر')",'build440-document-collection-work'),
 ('last-cheque-overwrites-first','app.js','&&!issuedByInvoice.has(number)','', 'build440-document-collection-work'),
 ('nan-equals-nan','app.js','number===number&&numbers.has(number)','numbers.has(number)', 'build440-document-collection-work'),
 ('restore-nested-bank-migration','banking-core.js',function(bank,'migrateLegacyBranches'),function(oldBank,'migrateLegacyBranches'),'build441-bank-migration-work'),
 ('duplicate-new-bank-facility','banking-core.js','knownFacilities.add(branch.facilityId);','', 'build441-bank-migration-work')]
rows=[]
for name,file,old,new,test in cases:
 source=app if file=='app.js' else bank;assert source.count(old)==1,(name,source.count(old))
 with tempfile.TemporaryDirectory(prefix='ventora-scan-mutant-') as tmp:
  base=Path(tmp);(base/'WebApp').mkdir()
  for p in web.iterdir():
   if p.name==file:(base/'WebApp'/p.name).write_text(source.replace(old,new))
   else:(base/'WebApp'/p.name).symlink_to(p,target_is_directory=p.is_dir())
  result=subprocess.run(['node','tests/'+test+'.cjs'],cwd=root,env={**os.environ,'GH_TEST_SOURCE_DIR':str(base)},capture_output=True,text=True,timeout=20)
  log=name+'.log';(out/log).write_text(result.stdout+result.stderr)
  row={'name':name,'file':file,'test':test,'exit_code':result.returncode,'caught':result.returncode==1,'log':log,'replace':{'before':old,'after':new}};rows.append(row);print(name,result.returncode,flush=True)
  if not row['caught']:raise SystemExit('MUTATION ESCAPED or harness failed '+name)
(out/'mutations.json').write_text(json.dumps({'source_tree_sha256':json.load(open(root/'RUNTIME_SOURCE_MANIFEST.json'))['source_tree_sha256'],'caught':len(rows),'total':len(cases),'results':rows},ensure_ascii=False,indent=2)+'\n')
