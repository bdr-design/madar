from pathlib import Path
import json,subprocess,os,tempfile
root=Path('/workspace/madar');out=root/'verification/cleanup-review-20261018';web=root/'WebApp';source={n:(web/n).read_text() for n in ['state-codec-core.js','save-checksum-thread.js','save-checksum-worker.js','fleet-save-validation-core.js','fleet-day-core.js']}
c=source['state-codec-core.js'];thread=source['save-checksum-thread.js'];v=source['fleet-save-validation-core.js'];d=source['fleet-day-core.js'];worker=source['save-checksum-worker.js']
patchGuard="    if(decoded.patches.length!==parts.patches.length||decoded.patches.some((p,i)=>p.id!==parts.patches[i].id||p.rows!==parts.patches[i].rows||p.byteLength!==parts.patches[i].byteLength))return false;"
start=v.index('      if(views&&refs.size<=4096){');end=v.index('      for(const [key,maximum]',start);baseline=(Path('/workspace/scratch/cleanup-review-20261018/baseline/WebApp/fleet-save-validation-core.js')).read_text();oldStart=baseline.index('      if(views&&refs.size<=4096){');oldEnd=baseline.index('      for(const [key,maximum]',oldStart)
cases=[
 ('unused-whole-page-hash','save-checksum-worker.js','const evidence=m.transform', 'self.GH_STATE_CODEC.chunkChecksum(output);const evidence=m.transform','tests/build436-save-work-removal.cjs'),
 ('unused-legacy-layout','state-codec-core.js','if(STORE.STRIDE!==FLEET_ROW_STRIDE)','fleetOverlayLayout();if(STORE.STRIDE!==FLEET_ROW_STRIDE)','tests/build436-save-work-removal.cjs'),
 ('missing-row-stride-guard','state-codec-core.js',"if(STORE.STRIDE!==FLEET_ROW_STRIDE)throw new Error('state-codec-fleet-row-layout');",'', 'tests/build436-save-work-removal.cjs'),
 ('wrong-patch-lineage','state-codec-core.js',patchGuard,'','tests/build437-adoption-patch-lineage.cjs'),
 ('per-row-reference-array','fleet-save-validation-core.js',v[start:end],baseline[oldStart:oldEnd],'tests/build436-save-work-removal.cjs'),
 ('thread-accepts-sparse-evidence','save-checksum-thread.js',"function validLaneSums(sums){if(!Array.isArray(sums)||sums.length!==16)return false;for(let lane=0;lane<16;lane++)if(!validChecksum(sums[lane]))return false;return true;}","function validLaneSums(sums){return Array.isArray(sums)&&sums.length===16&&sums.every(validChecksum);}",'tests/build436-save-work-removal.cjs'),
 ('codec-accepts-sparse-evidence','state-codec-core.js',"function validLaneSums(sums){if(!Array.isArray(sums)||sums.length!==LANES)return false;for(let lane=0;lane<LANES;lane++)if(typeof sums[lane]!=='string'||!LANE_SUM.test(sums[lane]))return false;return true;}","function validLaneSums(sums){return Array.isArray(sums)&&sums.length===16&&sums.every(sum=>typeof sum==='string'&&LANE_SUM.test(sum));}",'tests/build436-save-work-removal.cjs'),
 ('per-row-financial-object','fleet-day-core.js','fixed(row,scratch||(scratch={}))','fixed(row)','tests/build438-day-scratch-work.cjs'),
 ('scratch-aliased-into-cache','fleet-day-core.js','cached=fixed(row);profileMemo.set(ref,cached);','cached=fixed(row,scratch||(scratch={}));profileMemo.set(ref,cached);','tests/build438-day-scratch-work.cjs')]
results=[]
for name,file,old,new,test in cases:
 count=source[file].count(old);assert count==(2 if name=='per-row-financial-object' else 1),(name,count)
 with tempfile.TemporaryDirectory(prefix='ventora-cleanup-mutant-') as tmp:
  folder=Path(tmp);(folder/'WebApp').mkdir()
  for p in web.iterdir():
   if p.is_file():
    target=folder/'WebApp'/p.name
    if p.name==file:target.write_text(source[file].replace(old,new))
    else:target.symlink_to(p)
  r=subprocess.run(['node',test],cwd=root,env={**os.environ,'GH_TEST_SOURCE_DIR':str(folder)},stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=60);(out/('mutant-'+name+'.log')).write_text(r.stdout);assert r.returncode!=0,('escaped',name);results.append({'name':name,'file':file,'test':test,'exit_code':r.returncode,'detected':True,'replacement':{'old':old,'new':new}});print(name,'DETECTED',flush=True)
(out/'mutations.json').write_text(json.dumps({'source_tree_sha256':json.load(open(root/'RUNTIME_SOURCE_MANIFEST.json'))['source_tree_sha256'],'all_detected':True,'count':len(results),'results':results},indent=2)+'\n')
