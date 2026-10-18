import json,pathlib,subprocess,os,shutil
root=pathlib.Path('/workspace/madar');base=pathlib.Path('/workspace/scratch/section-review-20261018');folder=base/'mutants';folder.mkdir(exist_ok=True)
cases=[
 ('hr-index-per-center','hr-core.js',"if(f.kind==='mobility-center'&&!mobilityCounts)","if(f.kind==='mobility-center')",'build447-hr-facility-work'),
 ('unused-hr-snapshot','advanced-core.js','function renderLabor(arg,ctx){','function renderLabor(arg,ctx){globalThis.GH_HR_CORE.snapshot(ctx.state,ctx);','build448-labor-tab-work'),
 ('unknown-capacity-zero','facility-core.js',"delivered?(delivered.get(key)||0):null", "delivered?(delivered.get(key)||0):0",'build449-asset-capacity-work'),
 ('large-capacity-fallback','facility-core.js','size(state)<=2048','size(state)<=1000000','build449-asset-capacity-work'),
 ('missing-delivery-occupancy','facility-core.js',"row?.status==='pending'&&key===key", "row?.status==='NEVER'&&key===key",'build449-asset-capacity-work'),
 ('duplicate-market-capacity','app.js',"const list = items.map(a=>`<article", "const list = items.map(a=>`${capacityCore.readAssetOccupancies(state,bases,currentFleetUiSummary())}<article",'build449-asset-capacity-work'),
 ('unused-loan-projection','advanced-core.js',"loans=['overview','loans'].includes(tab)?",'loans=true?','build450-other-section-work'),
 ('unbounded-hr-cards','advanced-core.js','rows:rows.slice(page*size,page*size+size)','rows:rows','build448-labor-tab-work'),
 ('post-ack-personnel-notice','advanced-core.js',"});ctx.updateKpis();ctx.openDrawer('labor',`managers:${company}`);", "});notify(ctx,'extra success','success');ctx.updateKpis();ctx.openDrawer('labor',`managers:${company}`);",'build451-hr-notice-work'),
 ('unused-customer-projection','business-world-core.js',"needs=name=>tab==='all'||name.includes(tab)","needs=_name=>true",'build453-section-projections'),
 ('copy-full-delivery-history','advanced-core.js',"const deliveries=ctx.state.realism?.procurement?.deliveries||[],pending=[];", "const deliveries=(ctx.state.realism?.procurement?.deliveries||[]).slice(),pending=[];",'build453-section-projections'),
 ('unbounded-facilities','app.js','owned.slice(page*4,page*4+4).map','owned.map','build454-facility-pages'),
 ('unbounded-hub-facilities','app.js',".slice(page*4,page*4+4).map(f=>`<article class=\"list-item facility-register-row", ".map(f=>`<article class=\"list-item facility-register-row",'build454-facility-pages'),
 ('cii-main-thread-scan','advanced-core.js',"let cost=null;if(!plan){", "let cost=G.seaCiiPlanCost(s);if(!plan){",'build455-cii-preview-work'),
 ('cii-stale-summary','advanced-core.js',"summary?.current?.(s)===true&&summary.result?.schema", "summary&&summary.result?.schema",'build455-cii-preview-work'),
 ('unbounded-list-build','fleet-list-query-core.js','now()-started>=3','now()-started>=3000','build456-list-build-budget'),
]
results=[]
for name,file,old,new,test in cases:
 s=(root/'WebApp'/file).read_text();assert s.count(old)==(2 if name in ['hr-index-per-center','post-ack-personnel-notice'] else 1),(name,s.count(old));tmp=folder/name;web=tmp/'WebApp';web.mkdir(parents=True,exist_ok=True)
 for p in (root/'WebApp').iterdir():
  dest=web/p.name
  if dest.exists() or dest.is_symlink():
   if dest.is_dir() and not dest.is_symlink():shutil.rmtree(dest)
   else:dest.unlink()
  if p.name==file:dest.write_text(s.replace(old,new))
  else:dest.symlink_to(p,target_is_directory=p.is_dir())
 checked=subprocess.run(['node','--check',str(web/file)],capture_output=True,text=True);assert checked.returncode==0,(name,checked.stderr)
 r=subprocess.run(['node',str(root/'tests'/(test+'.cjs'))],env={**os.environ,'GH_TEST_SOURCE_DIR':str(tmp)},capture_output=True,text=True,timeout=30);output=r.stdout+r.stderr;(tmp/'result.log').write_text(output);detected=r.returncode!=0 and ('AssertionError' in output or 'full-delivery-copy' in output)
 results.append({'name':name,'file':file,'test':test,'exit_code':r.returncode,'detected':detected});print(name,detected,flush=True)
 (base/'mutations.json').write_text(json.dumps(results,indent=2)+'\n')
 assert detected,(name,output)
