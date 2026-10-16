#!/usr/bin/env python3
"""Run the current source's declared tests; always retain failures and source digests.
No IPA, historical base application, signing key, or state modification is involved.
"""
from __future__ import annotations
import argparse,json,os,shutil,subprocess,time
from pathlib import Path
from verify_current_source import verify
from acceptance_contract import contract,expand

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,required=True);p.add_argument('--node',default='node');p.add_argument('--timeout',type=int,default=240);p.add_argument('--preflight',action='store_true',help='Run the declared risk-focused gates first, then the remaining suite');p.add_argument('--fail-fast',action='store_true',help='Stop at the first failed or timed-out gate');a=p.parse_args()
    root=Path(__file__).resolve().parents[1];out=a.output.absolute()
    if out.exists() or out.is_symlink() or root==out or root in out.parents:raise ValueError('Evidence output must be a new directory outside source')
    before=verify(root);version=subprocess.check_output([a.node,'--version'],text=True).strip()
    if int(version.lstrip('v').split('.')[0])<24:raise ValueError('Node 24 or later is required')
    gates_before=contract(root)
    out.mkdir(parents=True);commands=gates_before['commands'];rows=[]
    preflight=gates_before['preflight_commands'] if a.preflight else []
    preflight_keys={tuple(row) for row in preflight}
    execution=preflight+[row for row in commands if tuple(row) not in preflight_keys]
    node=shutil.which(a.node) or a.node;env={**os.environ,'GH_TEST_SOURCE_DIR':str(root),'PATH':str(Path(node).resolve().parent)+os.pathsep+os.environ.get('PATH','')}
    for i,args in enumerate(execution,1):
        argv=[node if args[0]=='node' else args[0],*args[1:]];start=time.monotonic();log=f'{i:03d}-{Path(args[1]).stem}.log'
        with (out/log).open('w') as stream:
            try:code=subprocess.run(argv,cwd=root,env=env,stdout=stream,stderr=subprocess.STDOUT,timeout=a.timeout,check=False).returncode
            except subprocess.TimeoutExpired:code='timeout'
            except OSError as e:stream.write(str(e));code='launch-failed'
        rows.append({'argv':args,'exit_code':code,'elapsed_seconds':round(time.monotonic()-start,3),'log':log});label='preflight' if args in preflight else 'gate';print(f'{label} {i}/{len(execution)} {code} {args[1]}',flush=True)
        (out/'results.json').write_text(json.dumps({'completed':False,'node':version,'runtime_source':before,'acceptance_contract_sha256':gates_before['sha256'],'tests':rows},ensure_ascii=False,indent=2)+'\n')
        if a.fail_fast and code!=0:
            try:after=verify(root);unchanged=after['source_tree_sha256']==before['source_tree_sha256'];verification_error=None
            except Exception as e:unchanged=False;verification_error=str(e)
            try:gates_unchanged=contract(root)['sha256']==gates_before['sha256'];gates_error=None
            except Exception as e:gates_unchanged=False;gates_error=str(e)
            result={'completed':False,'all_tests_passed':False,'runtime_unchanged':unchanged,'gates_unchanged':gates_unchanged,'verification_error':verification_error,'gates_verification_error':gates_error,'acceptance_contract_sha256':gates_before['sha256'],'runtime_source':before,'tests':rows,'total':len(commands),'passed':sum(row['exit_code']==0 for row in rows),'ipa_built':False,'device_tested':False,'failed_early':args[1]}
            (out/'results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
            print(f'EARLY_FAILURE {args[1]}: stopping before remaining {len(execution)-i} gate(s)',flush=True)
            return 1
    try:after=verify(root);unchanged=after['source_tree_sha256']==before['source_tree_sha256'];verification_error=None
    except Exception as e:after=None;unchanged=False;verification_error=str(e)
    try:gates_unchanged=contract(root)['sha256']==gates_before['sha256'];gates_error=None
    except Exception as e:gates_unchanged=False;gates_error=str(e)
    rows_by_command={tuple(row['argv']):row for row in rows};rows=[rows_by_command[tuple(command)] for command in commands]
    passed=all(row['exit_code']==0 for row in rows) and unchanged and gates_unchanged
    result={'completed':True,'all_tests_passed':passed,'node':version,'runtime_unchanged':unchanged,'gates_unchanged':gates_unchanged,'verification_error':verification_error,'gates_verification_error':gates_error,'acceptance_contract_sha256':gates_before['sha256'],'runtime_source':before,'tests':rows,'total':len(rows),'passed':sum(row['exit_code']==0 for row in rows),'ipa_built':False,'device_tested':False}
    (out/'results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    return 0 if passed else 1
if __name__=='__main__':raise SystemExit(main())
