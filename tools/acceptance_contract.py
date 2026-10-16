"""Bind acceptance evidence to the exact runtime, declared tests and gate sources."""
from __future__ import annotations
import hashlib,json,shlex
from pathlib import Path
from verify_current_source import verify

def expand(command:str,scripts:dict,stack:tuple=())->list[list[str]]:
    rows=[]
    for part in command.split('&&'):
        argv=shlex.split(part.strip())
        if argv[:2]==['npm','run'] and len(argv)==3:
            if argv[2] in stack:raise ValueError('Recursive package script')
            rows+=expand(scripts[argv[2]],scripts,stack+(argv[2],))
        elif argv and argv[0] in ('node','python3','python') and len(argv)>1:
            rows.append(argv)
        else:raise ValueError(f'Unsupported acceptance command: {argv!r}')
    unique=[]
    for argv in rows:
        if argv not in unique:unique.append(argv)
    return unique

def contract(root:Path)->dict:
    pkg=json.loads((root/'package.json').read_text())
    commands=expand(pkg['scripts']['test'],pkg['scripts'])
    policy=json.loads((root/'ACCEPTANCE_POLICY.json').read_text())
    if len(commands)<policy['minimum_acceptance_gates']:raise ValueError('Acceptance floor was reduced')
    missing=[row for row in policy['required_commands'] if row not in commands]
    if missing:raise ValueError(f'Required acceptance gates were removed: {missing}')
    preflight=policy.get('preflight_commands',[])
    if not isinstance(preflight,list) or len(preflight)!=len(set(tuple(row) for row in preflight)) or any(row not in commands for row in preflight):
        raise ValueError('Preflight commands must be unique declared acceptance gates')
    for argv in commands:
        path=(root/argv[1]).resolve()
        if root.resolve() not in path.parents or not path.is_file():raise ValueError(f'Invalid acceptance script: {argv[1]}')
    names={'package.json','ACCEPTANCE_POLICY.json'}
    if (root/'package-lock.json').is_file():names.add('package-lock.json')
    for folder in ('tests','tools','.github/workflows'):
        for path in (root/folder).rglob('*'):
            if path.is_file() and '__pycache__' not in path.parts and path.suffix not in ('.pyc','.pyo'):
                if path.is_symlink():raise ValueError(f'Linked acceptance source: {path}')
                names.add(path.relative_to(root).as_posix())
    hashes={name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in sorted(names)}
    sha=hashlib.sha256(json.dumps(hashes,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    return {'sha256':sha,'commands':commands,'preflight_commands':preflight,'minimum':policy['minimum_acceptance_gates']}

def validate_evidence(result:dict,runtime_sha:str,current:dict)->dict:
    for flag in ('completed','all_tests_passed','runtime_unchanged','gates_unchanged'):
        if result.get(flag) is not True:raise ValueError(f'Acceptance did not finish cleanly: {flag}')
    if result.get('runtime_source',{}).get('source_tree_sha256')!=runtime_sha:
        raise ValueError('Acceptance belongs to a different runtime source')
    if result.get('acceptance_contract_sha256')!=current['sha256']:
        raise ValueError('Acceptance belongs to different test/gate sources')
    rows=result.get('tests',[])
    if [row.get('argv') for row in rows]!=current['commands']:
        raise ValueError('Acceptance did not execute the exact declared suite')
    if any(type(row.get('exit_code')) is not int or row['exit_code']!=0 for row in rows):
        raise ValueError('Acceptance contains a failed, skipped or timed-out gate')
    total=len(current['commands'])
    if total<current['minimum'] or result.get('total')!=total or result.get('passed')!=total:
        raise ValueError('Acceptance totals do not match the declared suite')
    return {'verified':True,'passed':total,'total':total,'source_tree_sha256':runtime_sha,
            'acceptance_contract_sha256':current['sha256']}

def verify_acceptance(root:Path,result:dict)->dict:
    return validate_evidence(result,verify(root)['source_tree_sha256'],contract(root))
