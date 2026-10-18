import os,subprocess,json
from pathlib import Path
root=Path('/workspace/madar');scratch=Path('/workspace/scratch/request-decisions-20261018/mutants');out=root/'verification/request-decisions-20261018';results=[]
app=(root/'WebApp/app.js').read_text();advanced=(root/'WebApp/advanced-core.js').read_text();shell=(root/'WebApp/madar-shell.js').read_text();tx=(root/'WebApp/transaction-core.js').read_text()
cases=[
 ('ready-promise','app.js',app,'return wrap(last.found);','return Promise.resolve(wrap(last.found));','tests/build432-ready-fleet-validation.cjs'),
 ('stale-ready-revision','app.js',app,'&&client.current(last.found,store))return wrap(last.found);',')return wrap(last.found);','tests/build432-ready-fleet-validation.cjs'),
 ('changed-context','app.js',app,'&&last.found.result?.contextToken===contextToken&&client.current(last.found,store)', '&&client.current(last.found,store)','tests/build432-ready-fleet-validation.cjs'),
 ('stale-inflight','app.js',app,'&&client.current(pending.tag,store))return pending.promise;',')return pending.promise;','tests/build432-ready-fleet-validation.cjs'),
 ('unneeded-fleet-query','madar-shell.js',shell,'if(readFleet)try{fleet=ctx.companyFleetStats','if(true)try{fleet=ctx.companyFleetStats','tests/build434-service-panel-fleet-work.cjs'),
 ('missing-notice','advanced-core.js',advanced,'...plan.options,successNotice:result=>','...plan.options,unusedNotice:result=>','tests/build431-decision-notices.cjs'),
 ('unconditional-prestage','transaction-core.js',tx,'const validatedFleetRevision=Number.isSafeInteger(draft.fleet?.revision)?draft.fleet.revision:null;',"onFleetValidationWait?.();const validatedFleetRevision=Number.isSafeInteger(draft.fleet?.revision)?draft.fleet.revision:null;",'tests/build435-conditional-prestage.cjs'),
 ('missing-async-prestage-hook','app.js',app,'    beforeAsync?.();','    /* removed async overlap */','tests/build432-ready-fleet-validation.cjs'),
 ('skip-stage-settlement','transaction-core.js',tx,'if(staging?.settled){const staged=await staging.settled.catch(()=>null);','if(false){const staged=await staging.settled.catch(()=>null);','tests/build435-conditional-prestage.cjs')]
for name,file,source,old,new,test in cases:
 assert source.count(old)==1,(name,source.count(old));folder=scratch/name;web=folder/'WebApp';web.mkdir(parents=True,exist_ok=True)
 for p in (root/'WebApp').iterdir():
  dst=web/p.name
  if not dst.exists():dst.symlink_to(p)
 dst=web/file;dst.unlink();dst.write_text(source.replace(old,new));env={**os.environ,'GH_TEST_SOURCE_DIR':str(folder)}
 r=subprocess.run(['node',test],cwd=root,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=45);(out/('mutant-'+name+'.log')).write_text(r.stdout);results.append({'name':name,'test':test,'exit_code':r.returncode,'detected':r.returncode!=0});print(name,r.returncode,flush=True);assert r.returncode!=0,'mutant escaped'
(out/'mutations.json').write_text(json.dumps({'all_detected':True,'count':len(results),'results':results},indent=2)+'\n')
