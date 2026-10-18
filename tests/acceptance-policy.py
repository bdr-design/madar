#!/usr/bin/env python3
"""Adversarial evidence checks and mandatory-gate wiring for every current IPA entry point."""
import copy,json,subprocess,sys,tempfile
from pathlib import Path
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root/'tools'))
from acceptance_contract import contract,validate_evidence

current={'sha256':'gate-source','commands':[['node','tests/a.cjs'],['python3','tests/b.py']],'minimum':2}
valid={'completed':True,'all_tests_passed':True,'runtime_unchanged':True,'gates_unchanged':True,
       'runtime_source':{'source_tree_sha256':'runtime'},'acceptance_contract_sha256':'gate-source',
       'tests':[{'argv':row,'exit_code':0} for row in current['commands']],'total':2,'passed':2}
assert validate_evidence(valid,'runtime',current)['verified'] is True
def reject(change):
    result=copy.deepcopy(valid);change(result)
    try:validate_evidence(result,'runtime',current)
    except ValueError:return
    raise AssertionError('Bad acceptance evidence was accepted')
for flag in ['completed','all_tests_passed','runtime_unchanged','gates_unchanged']:
    reject(lambda r,flag=flag:r.update({flag:False}))
reject(lambda r:r['tests'].pop())
reject(lambda r:r['tests'].reverse())
reject(lambda r:r['tests'].__setitem__(1,copy.deepcopy(r['tests'][0])))
reject(lambda r:r['tests'][0].update(exit_code=1))
reject(lambda r:r['tests'][0].update(exit_code='timeout'))
reject(lambda r:r['tests'][0].update(exit_code=False))
reject(lambda r:r.update(total=350,passed=350))
reject(lambda r:r.update(acceptance_contract_sha256='old-tests'))
reject(lambda r:r['runtime_source'].update(source_tree_sha256='old-code'))

# A changed helper or workflow invalidates old success evidence even if runtime bytes are unchanged.
with tempfile.TemporaryDirectory(prefix='madar-acceptance-contract-') as tmp:
    base=Path(tmp);(base/'tests').mkdir();(base/'tools').mkdir();(base/'.github/workflows').mkdir(parents=True)
    (base/'package.json').write_text(json.dumps({'scripts':{'test':'node tests/a.cjs'}}))
    (base/'ACCEPTANCE_POLICY.json').write_text(json.dumps({'minimum_acceptance_gates':1,'required_commands':[['node','tests/a.cjs']]}))
    (base/'tests/a.cjs').write_text('console.log("pass");')
    (base/'tests/helper.cjs').write_text('module.exports=1;')
    (base/'.github/workflows/build.yml').write_text('name: Full gates')
    before=contract(base)['sha256'];(base/'tests/helper.cjs').write_text('module.exports=2;');after=contract(base)['sha256'];assert before!=after
    (base/'.github/workflows/build.yml').write_text('name: Different gate wiring');assert after!=contract(base)['sha256']
    (base/'package.json').write_text(json.dumps({'scripts':{'test':'node tests/helper.cjs'}}))
    try:contract(base)
    except ValueError:pass
    else:raise AssertionError('Removed gate escaped policy')

declared=contract(root)
assert ['node','tests/phone-layout-browser.cjs'] in declared['commands']
expected_preflight=[
    ['node', 'tests/build497-route-preview-reuse.cjs'],
    ['node', 'tests/build492-manual-slot-slices-browser.cjs'],
    ['node', 'tests/build493-backup-export-browser.cjs'],
    ['node', 'tests/build494-export-worker-protocol.cjs'],
    ['node', 'tests/build495-large-reset-browser.cjs'],
    ['node', 'tests/build496-world-query-reset.cjs'],
    ['node', 'tests/build489-stored-lane-containers.cjs'],
    ['node', 'tests/build490-container-compression.cjs'],
    ['node', 'tests/build491-stored-containers-browser.cjs'],
    ['node', 'tests/build488-route-preview-payload.cjs'],
    ['node', 'tests/build485-cold-validation-query.cjs'],
    ['node', 'tests/build484-operating-vault-bootstrap-browser.cjs'],
    ['node', 'tests/build486-route-card-pages.cjs'],
    ['node', 'tests/build487-route-pages-browser.cjs'],
    ['node', 'tests/build463-ui-summary-projection.cjs'],
    ['node', 'tests/build464-summary-projection-boundary.cjs'],
    ['node', 'tests/build465-directory-ranking-work.cjs'],
    ['node', 'tests/build466-directory-round-robin.cjs'],
    ['node', 'tests/build467-directory-country-work.cjs'],
    ['node', 'tests/build468-summary-projection-browser.cjs'],
    ['node', 'tests/build469-app-notice-work.cjs'],
    ['node', 'tests/build470-composite-notice-work.cjs'],
    ['node', 'tests/build471-company-notice-work.cjs'],
    ['node', 'tests/build472-all-company-operating-browser.cjs'],
    ['node', 'tests/build473-purchase-notice-work.cjs'],
    ['node', 'tests/build474-event-trace-work.cjs'],
    ['node', 'tests/build475-replay-row-ranges.cjs'],
    ['node', 'tests/build476-staged-worker-replay.cjs'],
    ['node', 'tests/build477-bank-read-sync-work.cjs'],
    ['node', 'tests/build478-directory-scope-stream.cjs'],
    ['node', 'tests/build479-facility-scope-work.cjs'],
    ['node', 'tests/build480-journal-reserve-work.cjs'],
    ['node', 'tests/build481-diagnostic-fleet-proof.cjs'],
    ['node', 'tests/build482-worker-route-conflicts.cjs'],
    ['node', 'tests/build483-large-panel-worker-browser.cjs'],
    ['node', 'tests/build457-canvas-idle-work.cjs'],
    ['node', 'tests/build458-stable-ui-writes.cjs'],
    ['node', 'tests/build459-navigation-scroll-work.cjs'],
    ['node', 'tests/build460-render-idle-browser.cjs'],
    ['node', 'tests/build461-market-render-work.cjs'],
    ['node', 'tests/build462-market-summary-refresh.cjs'],

    ['node', 'tests/build447-hr-facility-work.cjs'],
    ['node', 'tests/build448-labor-tab-work.cjs'],
    ['node', 'tests/build449-asset-capacity-work.cjs'],
    ['node', 'tests/build450-other-section-work.cjs'],
    ['node', 'tests/build451-hr-notice-work.cjs'],
    ['node', 'tests/build452-section-review-browser.cjs'],
    ['node', 'tests/build453-section-projections.cjs'],
    ['node', 'tests/build454-facility-pages.cjs'],
    ['node', 'tests/build455-cii-preview-work.cjs'],
    ['node', 'tests/build456-list-build-budget.cjs'],
    ['node', 'tests/build442-fleet-review-work.cjs'],
    ['node', 'tests/build443-company-review-work.cjs'],
    ['node', 'tests/build444-document-pages.cjs'],
    ['node', 'tests/build445-document-pages-browser.cjs'],
    ['node', 'tests/build446-payroll-unused-work.cjs'],
    ['node', 'tests/build439-summary-single-request.cjs'],
    ['node', 'tests/build440-document-collection-work.cjs'],
    ['node', 'tests/build441-bank-migration-work.cjs'],

    ['node','tests/build436-save-work-removal.cjs'],
    ['node','tests/build437-adoption-patch-lineage.cjs'],
    ['node','tests/build438-day-scratch-work.cjs'],
    ['node','tests/build431-decision-notices.cjs'],
    ['node','tests/build432-ready-fleet-validation.cjs'],
    ['node','tests/build434-service-panel-fleet-work.cjs'],
    ['node','tests/build435-conditional-prestage.cjs'],
    ['node','tests/build433-request-decisions-browser.cjs'],
    ['node','tests/build430-legacy-fleet-pages.cjs'],
    ['node','tests/build425-validation-dependencies.cjs'],
    ['node','tests/build428-worker-value-collection.cjs'],
    ['node','tests/build426-governor-pressure.cjs'],
    ['node','tests/governor-overrun-signal.cjs'],
    ['node','tests/build427-day-profile-work.cjs'],
    ['node','tests/build424-dense-fleet-pages.cjs'],
    ['node','tests/build429-worker-value-collection-browser.cjs'],
    ['node', 'tests/build423-worker-sync-work.cjs'],
    ['node', 'tests/build372-asset-purchase-app-browser.cjs'],
    ['node', 'tests/build422-conference-content-layout-browser.cjs'],
    ['node', 'tests/build419-document-drawer-work-browser.cjs'],
    ['node', 'tests/build420-conference-durable-browser.cjs'],
    ['node', 'tests/build421-conference-recovery-contract.cjs'],

    ['node','tests/build416-canonical-preparation.cjs'],
    ['node','tests/build417-document-amendment-work.cjs'],
    ['node','tests/build418-command-phase-trace-browser.cjs'],
    ['node','tests/build412-live-validation-predicates.cjs'],
    ['node','tests/build413-fleet-value-chunks.cjs'],
    ['node','tests/build414-command-preparation.cjs'],
    ['node','tests/build415-route-publication-browser.cjs'],
    ['node','tests/build410-fleet-save-row-patches.cjs'],
    ['node','tests/build411-command-row-patch-browser.cjs'],
    ['node','tests/build334-security-contract.cjs'],
    ['node','tests/business-options-browser.cjs'],
    ['node','tests/build406-save-chunk-transport.cjs'],
    ['node','tests/build407-diagnostic-lifecycle.cjs'],
    ['node','tests/build408-diagnostic-map-browser.cjs'],
    ['node','tests/build358-map-controls-browser.cjs'],
    ['node','tests/build409-compressed-persistence.cjs'],
    ['node','tests/build383-save-encoding.cjs'],
    ['node','tests/fleet-business-boundary.cjs'],
    ['node','tests/build334-procurement-pressure.cjs'],
    ['python3','tests/acceptance-policy.py'],
    ['node','tests/build334-simulation-time-contract.cjs'],
    ['node','tests/build372-store-maintenance-stages.cjs'],
    ['node','tests/build385-bank-credit-accounting.cjs'],
    ['node','tests/build363-energy-health-contract.cjs'],
    ['node','tests/build400-telecom-peer-index.cjs'],
    ['node','tests/build401-mobility-batching-and-indexes.cjs'],
    ['node','tests/build402-company-daily-indexes.cjs'],
    ['node','tests/build403-legacy-runtime-migration-browser.cjs'],
    ['node','tests/build404-worker-close-read-models.cjs'],
    ['node','tests/build405-worker-close-browser.cjs'],
    ['node','tests/build374-daily-worker-integration.cjs'],
    ['node','tests/build334-calendar-journey-browser.cjs'],
    ['node','tests/phone-layout-browser.cjs'],
    ['node','tests/build360-cold-archive.cjs'],
    ['node','tests/build358-fleet-chunk-manifest.cjs'],
    ['node','tests/build358-native-chunked-save.cjs'],
    ['node','tests/build372-native-migration-chunk-adoption.cjs'],
    ['node','tests/fleet-save-slicing.cjs'],
    ['node','tests/fleet-validation-reuse-browser.cjs'],
    ['node','tests/save-checksum-worker-browser.cjs'],
    ['node','tests/save-pipeline-browser.cjs'],
    ['node','tests/native-save-worker-browser.cjs'],
    ['node','tests/build359-save-policy-browser.cjs'],
    ['node','tests/build380-construction-acceleration-browser.cjs'],
    ['node','tests/build389-differential-browser.cjs'],
    ['node','tests/build394-hospitality-browser.cjs'],
    ['node','tests/build397-management-flow-layout-browser.cjs'],
    ['node','tests/build398-asset-market-metrics-layout-browser.cjs'],
    ['node','tests/build399-bank-prudential-summary-layout-browser.cjs'],
]
assert declared['preflight_commands']==expected_preflight,'preserve the targeted save, failure-rollback, finance, and layout preflight set'
with tempfile.TemporaryDirectory(prefix='madar-acceptance-early-stop-') as tmp:
    base=Path(tmp);fake=base/'node';output=base/'evidence'
    fake.write_text("#!/usr/bin/env python3\nimport sys\nif sys.argv[1:]==['--version']:\n print('v24.0.0')\nelse:\n print('EARLY_STOP_SENTINEL '+ ' '.join(sys.argv[1:]))\n sys.exit(7)\n")
    fake.chmod(0o755)
    run=subprocess.run(['python3',str(root/'tools/run_acceptance.py'),'--output',str(output),'--node',str(fake),'--timeout','5','--preflight','--fail-fast'],capture_output=True,text=True)
    assert run.returncode==1 and 'EARLY_FAILURE' in run.stdout,run.stdout+'\n'+run.stderr
    evidence=json.loads((output/'results.json').read_text())
    assert evidence['completed'] is False and evidence['all_tests_passed'] is False
    assert evidence['failed_early']==expected_preflight[0][1] and len(evidence['tests'])==1
    assert evidence['tests'][0]['exit_code']==7
for command in [['node','tests/save-pipeline-browser.cjs'],['node','tests/native-save-worker-browser.cjs']]:assert command in declared['commands']
for name in ['build362-unsigned-ipa.yml','ventora-release-ipa.yml']:
    text=(root/'.github/workflows'/name).read_text()
    assert 'inputs.acceptance' not in text and 'acceptance_gate=NOT_RUN' not in text
    source_step='Run all declared Build 362 source acceptance gates' if name=='build362-unsigned-ipa.yml' else 'Run the full source acceptance gate'
    start=text.index('      - name: '+source_step);end=text.index('\n      - name:',start+1);step=text[start:end]
    assert 'run_acceptance.py' in step and 'verify_acceptance.py' in step
    if name=='build362-unsigned-ipa.yml':assert '--preflight --fail-fast' in step,'run focused failure checks first and stop at the first failed acceptance gate'
    assert '\n        if:' not in step and 'continue-on-error' not in step
    build=text.index('xcodebuild ');assemble=text.index('      - name: Assemble')
    assert text.count('verify_acceptance.py',0,build)>=2,'verify again immediately before native compilation'
    assert 'verify_acceptance.py' in text[assemble:],'verify again before IPA assembly'
    assert 'Run native save-vault regression tests' in text and 'Run native WKWebView origin and frame smoke checks' in text,'full native gates are mandatory in both IPA editions'
    if name=='build362-unsigned-ipa.yml':
        for early_native in ['Run native save-vault regression tests','Run native WKWebView origin and frame smoke checks']:
            native_start=text.index('      - name: '+early_native);native_end=text.index('\n      - name:',native_start+1)
            assert native_start<start,'compile and exercise changed Swift/vault code before the long browser suite'
            assert '\n        if:' not in text[native_start:native_end] and 'continue-on-error' not in text[native_start:native_end],'early native gates remain mandatory'
    worker=text.index('      - name: Run native save-worker and pipeline checks')
    worker_end=text.index('\n      - name:',worker+1);worker_step=text[worker:worker_end]
    assert worker<build and 'save-worker-smoke.swift' in worker_step and 'native-save-worker.json' in worker_step
    assert '\n        if:' not in worker_step and 'continue-on-error' not in worker_step,'native worker gate cannot be optional'
for name in ['build350-unsigned-ipa.yml','build362-ipa-only.yml']:
    text=(root/'.github/workflows'/name).read_text()
    assert 'uses: ./.github/workflows/build362-unsigned-ipa.yml' in text
    assert 'xcodebuild' not in text and 'NOT_RUN' not in text
assert 'workflow_call:' in (root/'.github/workflows/build362-unsigned-ipa.yml').read_text()
release=(root/'.github/workflows/ventora-release-ipa.yml').read_text()
assert 'cd "$RELEASE_SOURCE_DIR"' in release and 'rm -rf WebApp' not in release,'preserve the source accepted by the full suite'
from publish_ci_receipt import valid_artifact_url
assert valid_artifact_url('https://github.com/bdr-design/madar/actions/runs/123/artifacts/456','bdr-design/madar',123)
for url in ['http://github.com/bdr-design/madar/actions/runs/123/artifacts/456','https://github.com/other/repo/actions/runs/123/artifacts/456','https://github.com/bdr-design/madar/actions/runs/124/artifacts/456','https://github.com.evil.test/bdr-design/madar/actions/runs/123/artifacts/456','https://github.com/bdr-design/madar/actions/runs/123/artifacts/456?token=x']:
    assert not valid_artifact_url(url,'bdr-design/madar',123),'artifact links must belong to this exact repository/run'
print(f'PASS acceptance-policy: stale/failed/incomplete evidence rejected; {len(declared["commands"])} mandatory gates; all current IPA entry points guarded')
