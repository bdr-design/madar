#!/usr/bin/env python3
"""Fail closed before IPA compilation/publication if source acceptance is stale or incomplete."""
import argparse,json
from pathlib import Path
from acceptance_contract import verify_acceptance

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[1])
    parser.add_argument('--results',type=Path,required=True)
    args=parser.parse_args()
    try:print(json.dumps(verify_acceptance(args.root.resolve(),json.loads(args.results.read_text())),indent=2))
    except Exception as error:raise SystemExit(f'ACCEPTANCE VERIFICATION FAILED: {error}')
