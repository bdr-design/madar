#!/usr/bin/env python3
"""Publish a verified test IPA and evidence on a separate Git ref; never change the source branch."""
from __future__ import annotations
import argparse,hashlib,json,os,re,shutil,subprocess,tempfile
from pathlib import Path
from urllib.parse import urlsplit
from acceptance_contract import verify_acceptance

def valid_artifact_url(value:str,repository:str,run_id:int)->bool:
    parsed=urlsplit(value)
    prefix=f'/{repository}/actions/runs/{run_id}/artifacts/'
    return parsed.scheme=='https' and parsed.netloc=='github.com' and parsed.path.startswith(prefix) and parsed.path[len(prefix):].isdigit() and not parsed.query and not parsed.fragment

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--source',type=Path,required=True);args=parser.parse_args()
    root=args.source.resolve();out=root/'.ci-output';out.mkdir(exist_ok=True)
    repository=os.environ['GITHUB_REPOSITORY'];commit=os.environ['GITHUB_SHA'];run_id=int(os.environ['GITHUB_RUN_ID']);attempt=int(os.environ['GITHUB_RUN_ATTEMPT'])
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+',repository) or not re.fullmatch(r'[0-9a-f]{40}',commit):raise ValueError('Invalid CI repository/commit')
    status=os.environ['CI_JOB_STATUS'];artifact=os.environ.get('CI_IPA_ARTIFACT_URL','');single=os.environ.get('CI_IPA_SINGLE_URL','')
    receipt={'version':1,'repository':repository,'source_commit':commit,'run_id':run_id,'attempt':attempt,'job_status':status,'run_url':f'https://github.com/{repository}/actions/runs/{run_id}','certified':False,'ipa_artifact_url':artifact,'ipa_single_file_url':single,'physical_iphone_tested':False}
    read=lambda name:json.loads((out/name).read_text())
    if status=='success':
        try:
            accepted=verify_acceptance(root,read('source-acceptance-results.json'))
            for name in ['native-tests.json','webkit-smoke.json']:
                value=read(name)
                if value.get('failed')!=0 or value.get('passed')!=value.get('total') or not value.get('total'):raise ValueError('Missing/failed native gate: '+name)
            native=read('native-save-worker.json')
            if native.get('nativeGatePassed') is not True or native.get('realWKWebView') is not True or native.get('workerRequestObserved') is not True or native.get('origin')!='gh://app' or native.get('passed')!=8 or native.get('total')!=8 or native.get('failed')!=0:raise ValueError('Native save-worker gate missing or failed')
            for name,digest in native['sourceSha256'].items():
                if name not in ['index.html','fleet-store-core.js','state-codec-core.js','save-chunk-codec.js','save-checksum-thread.js','save-checksum-worker.js'] or hashlib.sha256((root/'WebApp'/name).read_bytes()).hexdigest()!=digest:raise ValueError('Native worker tested other bytes')
            if len(native['sourceSha256'])!=6 or native.get('probeSha256')!=hashlib.sha256((root/'tests/native/save-worker-probe.js').read_bytes()).hexdigest():raise ValueError('Native worker provenance mismatch')
            ipa=read('test-ipa-verification.json');file=out/'GlobalHoldings_BUILD362_unsigned_TEST.ipa'
            if ipa.get('ipa_created') is not True or ipa.get('arm64_iphoneos') is not True or ipa.get('workflow_commit')!=commit or ipa.get('workflow_run_id')!=run_id or ipa.get('source_tree_sha256')!=accepted['source_tree_sha256'] or ipa.get('ipa_sha256')!=hashlib.sha256(file.read_bytes()).hexdigest() or ipa.get('ipa_bytes')!=file.stat().st_size:raise ValueError('IPA/source/compilation evidence mismatch')
            if not valid_artifact_url(artifact,repository,run_id):raise ValueError('Missing artifact download URL')
            if single and not valid_artifact_url(single,repository,run_id):raise ValueError('Single-file artifact URL belongs to another run')
            receipt.update(certified=True,source_acceptance=accepted,native_save_worker={'passed':8,'total':8,'origin':'gh://app'},ipa=ipa)
        except Exception as error:receipt['certification_error']=str(error)
    branch=f'ci-receipts/build362/{commit}/{run_id}-{attempt}';receipt['receipt_ref']='refs/heads/'+branch
    with tempfile.TemporaryDirectory(prefix='madar-ci-receipt-') as tmp:
        stage=Path(tmp);copied={}
        for file in sorted(out.iterdir()):
            if file.name=='ci-receipt.json' or not file.is_file() or file.is_symlink() or file.suffix not in ['.json','.log','.txt']:continue
            if file.stat().st_size>8*1024*1024:
                if file.suffix=='.json':raise ValueError('Oversized JSON evidence')
                data=file.read_bytes()[-8*1024*1024:];target=stage/(file.name+'.tail.txt');target.write_bytes(data);copied[target.name]={'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'truncated_tail':True}
            else:
                target=stage/file.name;shutil.copy2(file,target);copied[target.name]={'bytes':target.stat().st_size,'sha256':hashlib.sha256(target.read_bytes()).hexdigest()}
        if receipt['certified']:
            file=out/'GlobalHoldings_BUILD362_unsigned_TEST.ipa'
            if file.stat().st_size>90*1024*1024:raise ValueError('IPA exceeds the separate Git artifact size limit')
            target=stage/file.name;shutil.copy2(file,target);copied[target.name]={'bytes':target.stat().st_size,'sha256':hashlib.sha256(target.read_bytes()).hexdigest()}
        receipt['files']=copied
        text=json.dumps(receipt,ensure_ascii=False,indent=2)+'\n';(out/'ci-receipt.json').write_text(text);(stage/'ci-receipt.json').write_text(text)
        env={**os.environ,'GIT_TERMINAL_PROMPT':'0'}
        def git(*argv):
            result=subprocess.run(['git',*argv],cwd=stage,env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
            if result.returncode:
                print(result.stdout,flush=True)
                raise RuntimeError(f'Git receipt publication failed: {argv[0]} (exit {result.returncode})')
            return result.stdout
        git('init','-q');git('config','user.name','github-actions[bot]');git('config','user.email','41898282+github-actions[bot]@users.noreply.github.com')
        git('config','credential.helper','');git('config','--add','credential.helper','!gh auth git-credential');git('remote','add','origin',f'https://github.com/{repository}.git')
        git('add','--all');git('commit','-q','-m',f'Build 362 evidence for {commit[:12]} run {run_id}/{attempt}')
        git('push','origin',f'HEAD:refs/heads/{branch}')
    print(json.dumps({'receipt_ref':receipt['receipt_ref'],'certified':receipt['certified'],'run_url':receipt['run_url'],'ipa_artifact_url':artifact}))
    return 1 if status=='success' and not receipt['certified'] else 0

if __name__=='__main__':raise SystemExit(main())
