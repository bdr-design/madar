#!/usr/bin/env python3
"""Adversarial evidence checks and mandatory-gate wiring for every current IPA entry point."""
import copy,hashlib,json,re,subprocess,sys,tempfile
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

# The isolated VM interpreter still executes every original assertion and forwards failures.
host_source=(root/'tests/build395-hospitality-edge-cases.cjs').read_text();marker='// VM_HOST_INTERPRETER_END\n'
assert host_source.count(marker)==1
bootstrap,original=host_source.split(marker)
assert hashlib.sha256(original.encode()).hexdigest()==json.loads((root/'tests/fixtures/build395-vm-body.json').read_text())['sha256'],'retain all original hospitality financial assertions'
with tempfile.TemporaryDirectory(prefix='madar-vm-host-') as tmp:
    file=Path(tmp)/'probe.cjs'
    for body,expected in [("require('node:assert/strict').equal(1,1);console.log('VM_FIXTURE_'+process.execArgv.includes('--jitless'));",0),("require('node:assert/strict').fail('QA_EXPECTED_VM_ASSERTION');",1),("process.exit(7);",7)]:
        file.write_text(bootstrap+marker+body)
        run=subprocess.run(['node',str(file)],capture_output=True,text=True,timeout=5)
        assert run.returncode==expected,'VM bootstrap must preserve assertion and explicit failure statuses'
        if expected==0:assert 'VM_FIXTURE_true' in run.stdout
        if expected==1:assert 'QA_EXPECTED_VM_ASSERTION' in run.stderr

declared=contract(root)
assert ['node','tests/phone-layout-browser.cjs'] in declared['commands']
# The owner: the gates that failed first, then those not yet tested or touched by a fix, then the ones that passed
# (AGENTS.md). Build 96 stopped at build570-documents-list-weight-browser (the cheques list read 0.53 of the old page
# against a bound of a half on the macOS runner; 0.34 to 0.44 here on this source and the one before it): it runs
# first, with twenty samples instead of ten and the same bound. Then batch B (owner: bulk acquisition in one command):
# build590 and the gates that run the acquisitions, the market page or the four acquiring owners. Then batch A (owner: a paid acceleration finishes the
# plant or project at once): build589, the two acceleration gates whose claims follow the new rule, and the gates that run
# real estate, energy or the acceleration pages. Then batch Z (the fleet's value pages and extras sealed
# and reused, the store's extras version, energy ensure keeping clean arrays): build586 to build588, the two gates whose
# helpers or segment layout it touched (build358-fleet-chunk-manifest, build577), the native value-table and energy gates
# and every gate that loads the codec, the fleet store or persistence. Then build585 and build584 (the save's longest
# block counted across its unyielded steps; one summary query per key in flight; never reached by a build), then the
# gates that run persistence-core's saves and app.js's summary section; then build583 (the boot seals the two proof stores
# before its full check; never reached by a build) and the gates that run the real migration load, its codec and proof
# stores, the boot of app.js or the native seed and vault, then the other company-type weight gates (build580 to
# build582, never reached by a build), then the gates that run the fleet's worker inputs, the directory and company-type
# checks and the pages they changed (save-schema, fleet validation, realism, dispatch, directory, identity, HR, market),
# then the gates that run the money and payroll sites moved onto the platform lever (the real finance, HR, platform, energy and
# economics owners), then the gates that run the lever itself (the real platform, the migration, the identity tables,
# the boot of app.js); then the gates build 96 added or
# changed, or whose code it changed (the two new gates, the investor-card day close, the deferred alerts and ACK records, pacing and
# the governor, the calendar hold, the fleet validation evidence, the save layout steps, the energy history, the native
# bridge, then the gates that run the save codec, the fleet thread or the energy close this change could fail, among them
# build358-fleet-engine-thread (it stopped build 94's re-run and passed in build 95), then the gates that read the tests
# or their fingerprints, and this file, whose pinned list changed); then build487-route-pages, which failed in build 93
# and passed since; then the gates build 95 passed, in their previous order.
expected_preflight=[
    ['node', 'tests/build570-documents-list-weight-browser.cjs'],
    ['node', 'tests/build590-bulk-acquisition.cjs'],
    ['node', 'tests/operating-acquisitions.cjs'],
    ['node', 'tests/build334-bank-balance-sheet.cjs'],
    ['node', 'tests/build334-bank-energy-operating-costs.cjs'],
    ['node', 'tests/build334-bank-fee-reporting.cjs'],
    ['node', 'tests/build334-bank-projected-risk.cjs'],
    ['node', 'tests/build334-bank-sector-concentration.cjs'],
    ['node', 'tests/build334-bank-signed-income.cjs'],
    ['node', 'tests/build334-calendar-safety-contract.cjs'],
    ['node', 'tests/build334-dynamic-company-consumers.cjs'],
    ['node', 'tests/build334-r4-recovery-integration.cjs'],
    ['node', 'tests/build334-tabs-component.cjs'],
    ['node', 'tests/build334-tabs-contract.cjs'],
    ['node', 'tests/build334-xss-logo-security.cjs'],
    ['node', 'tests/build339-accrued-obligation-cash-shortfall.cjs'],
    ['node', 'tests/build339-day-boundary-write-map.cjs'],
    ['node', 'tests/build339-hour-boundary-write-map.cjs'],
    ['node', 'tests/build358-bank-market.cjs'],
    ['node', 'tests/build359-management-effects.cjs'],
    ['node', 'tests/build359-sea-cii-plan.cjs'],
    ['node', 'tests/build360-customer-contract-engine.cjs'],
    ['node', 'tests/build360-customer-ratings-conference.cjs'],
    ['node', 'tests/build360-iphone-failure-recovery.cjs'],
    ['node', 'tests/build360-operational-settlements.cjs'],
    ['node', 'tests/build363-company-economics-balance.cjs'],
    ['node', 'tests/build363-facility-scope-bank-browser.cjs'],
    ['node', 'tests/build363-runtime-diagnostics-contract.cjs'],
    ['node', 'tests/build364-company-overview-summary.cjs'],
    ['node', 'tests/build364-customer-companies-core.cjs'],
    ['node', 'tests/build365-official-news.cjs'],
    ['node', 'tests/build369-insurance-risk-batch.cjs'],
    ['node', 'tests/build369-market-reference.cjs'],
    ['node', 'tests/build372-interactive-summary-consumers.cjs'],
    ['node', 'tests/build373-conference-large-fleet-browser.cjs'],
    ['node', 'tests/build374-company-options-browser.cjs'],
    ['node', 'tests/build374-customer-base-telecom-market.cjs'],
    ['node', 'tests/build374-dealer-market.cjs'],
    ['node', 'tests/build375-group-news.cjs'],
    ['node', 'tests/build378-bancassurance.cjs'],
    ['node', 'tests/build378-bank-capital-conservation.cjs'],
    ['node', 'tests/build378-customer-satisfaction.cjs'],
    ['node', 'tests/build378-dealer-floor-plan.cjs'],
    ['node', 'tests/build378-telecom-network.cjs'],
    ['node', 'tests/build382-campaign-decisions-browser.cjs'],
    ['node', 'tests/build382-company-campaigns.cjs'],
    ['node', 'tests/build382-runtime-removal.cjs'],
    ['node', 'tests/build385-bank-credit-browser.cjs'],
    ['node', 'tests/build387-save-once-browser.cjs'],
    ['node', 'tests/build393-hospitality-financial-safety.cjs'],
    ['node', 'tests/build400-telecom-peer-index.cjs'],
    ['node', 'tests/build402-company-daily-indexes.cjs'],
    ['node', 'tests/build431-decision-notices.cjs'],
    ['node', 'tests/build441-bank-migration-work.cjs'],
    ['node', 'tests/build443-company-review-work.cjs'],
    ['node', 'tests/build448-labor-tab-work.cjs'],
    ['node', 'tests/build450-other-section-work.cjs'],
    ['node', 'tests/build451-hr-notice-work.cjs'],
    ['node', 'tests/build453-section-projections.cjs'],
    ['node', 'tests/build455-cii-preview-work.cjs'],
    ['node', 'tests/build471-company-notice-work.cjs'],
    ['node', 'tests/build477-bank-read-sync-work.cjs'],
    ['node', 'tests/build539-intercompany-interest-pnl.cjs'],
    ['node', 'tests/build540-bank-fee-close-day.cjs'],
    ['node', 'tests/build541-bank-provision-cash.cjs'],
    ['node', 'tests/build546-sponsorship-revenue.cjs'],
    ['node', 'tests/build547-conference-customer-base.cjs'],
    ['node', 'tests/build555-investor-card-return.cjs'],
    ['node', 'tests/build572-fleet-premium-unpaid.cjs'],
    ['node', 'tests/business-options-browser.cjs'],
    ['node', 'tests/core-regressions.cjs'],
    ['node', 'tests/dealer-ledger-and-stock.cjs'],
    ['node', 'tests/fleet-business-boundary.cjs'],
    ['node', 'tests/tax-precision-and-routing-browser.cjs'],
    ['node', 'tests/build589-acceleration-immediate.cjs'],
    ['node', 'tests/build380-construction-acceleration.cjs'],
    ['node', 'tests/build380-construction-acceleration-browser.cjs'],
    ['node', 'tests/build334-energy-take-or-pay.cjs'],
    ['node', 'tests/build358-energy-market.cjs'],
    ['node', 'tests/build360-energy-debt-proof-recovery.cjs'],
    ['node', 'tests/build362-hospitality-staffing.cjs'],
    ['node', 'tests/build363-energy-health-contract.cjs'],
    ['node', 'tests/build364-realestate-internal-leases.cjs'],
    ['node', 'tests/build369-external-rent-monthly-ledger.cjs'],
    ['node', 'tests/build378-energy-blocks-ppa.cjs'],
    ['node', 'tests/build378-realestate-off-plan.cjs'],
    ['node', 'tests/build387-save-actions.cjs'],
    ['node', 'tests/build391-hospitality-core.cjs'],
    ['node', 'tests/build392-hospitality-links.cjs'],
    ['node', 'tests/build394-hospitality-browser.cjs'],
    ['node', 'tests/build395-hospitality-edge-cases.cjs'],
    ['node', 'tests/build544-internal-rent-tenants.cjs'],
    ['node', 'tests/build545-power-finance-interest.cjs'],
    ['node', 'tests/build548-group-intercompany-elimination.cjs'],
    ['node', 'tests/build578-energy-history-compaction.cjs'],
    ['node', 'tests/build588-energy-ensure-rows.cjs'],
    ['node', 'tests/build586-value-pages-reuse.cjs'],
    ['node', 'tests/build587-fleet-extras-reuse.cjs'],
    ['node', 'tests/build358-fleet-chunk-manifest.cjs'],
    ['node', 'tests/build577-save-layout-steps.cjs'],
    ['node', 'tests/build413-fleet-value-chunks.cjs'],
    ['node', 'tests/build411-command-row-patch-browser.cjs'],
    ['node', 'tests/build418-command-phase-trace-browser.cjs'],
    ['node', 'tests/build445-document-pages-browser.cjs'],
    ['node', 'tests/build334-600-air-calendar-regression.cjs'],
    ['node', 'tests/build334-durable-authorization-contract.cjs'],
    ['node', 'tests/build334-durable-publication-recovery.cjs'],
    ['node', 'tests/build334-map-pressure-contract.cjs'],
    ['node', 'tests/build334-native-snapshot-queue.cjs'],
    ['node', 'tests/build334-persistence-snapshot-consistency.cjs'],
    ['node', 'tests/build334-presentation-work-contract.cjs'],
    ['node', 'tests/build334-purchase-delivery-pressure.cjs'],
    ['node', 'tests/build334-r2-delivery-lazy-index.cjs'],
    ['node', 'tests/build334-r2-map-local-dom.cjs'],
    ['node', 'tests/build334-r2-snapshot-budget.cjs'],
    ['node', 'tests/build334-simulation-fault-isolation.cjs'],
    ['node', 'tests/build334-simulation-slice-atomic.cjs'],
    ['node', 'tests/build335-persistence-root-coalescing.cjs'],
    ['node', 'tests/build336-proof-ledger-compaction-regression.cjs'],
    ['node', 'tests/build336-state-byte-attribution-pressure.cjs'],
    ['node', 'tests/build337-instrumentation-baseline.cjs'],
    ['node', 'tests/build339-phase1c-adversarial-contract.cjs'],
    ['node', 'tests/build340-map-status-cache.cjs'],
    ['node', 'tests/build340-map-structure-revision.cjs'],
    ['node', 'tests/build340-route-center-index.cjs'],
    ['node', 'tests/build340-simulation-transaction-worker.cjs'],
    ['node', 'tests/build350-persistence-codec.cjs'],
    ['node', 'tests/build350-proof-ledger-persistence.cjs'],
    ['node', 'tests/build350-state-codec.cjs'],
    ['node', 'tests/build353-persistence-pacing.cjs'],
    ['node', 'tests/build353-steady-slice-rollback.cjs'],
    ['node', 'tests/build355-fleet-access.cjs'],
    ['node', 'tests/build356-fleet-events.cjs'],
    ['node', 'tests/build356-fleet-store.cjs'],
    ['node', 'tests/build357-fleet-journal.cjs'],
    ['node', 'tests/build357-fleet-migration.cjs'],
    ['node', 'tests/build357-fleet-profile-aggregation.cjs'],
    ['node', 'tests/build358-air-sea-dispatch-browser.cjs'],
    ['node', 'tests/build358-codec-id-runs.cjs'],
    ['node', 'tests/build358-codec-segments.cjs'],
    ['node', 'tests/build358-delivery-due-slices.cjs'],
    ['node', 'tests/build358-fleet-engine-thread-browser.cjs'],
    ['node', 'tests/build358-fleet-purchase-vat.cjs'],
    ['node', 'tests/build358-fleet-row-codec-cache.cjs'],
    ['node', 'tests/build358-fleet-save-cap.cjs'],
    ['node', 'tests/build358-fleet-scan.cjs'],
    ['node', 'tests/build358-heaviness.cjs'],
    ['node', 'tests/build358-large-fleet-dispatch-browser.cjs'],
    ['node', 'tests/build358-maintenance.cjs'],
    ['node', 'tests/build358-native-chunked-save.cjs'],
    ['node', 'tests/build358-proof-chunks.cjs'],
    ['node', 'tests/build358-purchase-scale.cjs'],
    ['node', 'tests/build358-route-capacity.cjs'],
    ['node', 'tests/build358-row-snapshot-rollback.cjs'],
    ['node', 'tests/build358-schema-sections.cjs'],
    ['node', 'tests/build358-staged-day-browser.cjs'],
    ['node', 'tests/build358-validation-classes.cjs'],
    ['node', 'tests/build359-archive-seal.cjs'],
    ['node', 'tests/build359-archived-proofs.cjs'],
    ['node', 'tests/build359-command-slices.cjs'],
    ['node', 'tests/build359-compact-records.cjs'],
    ['node', 'tests/build359-container-seal.cjs'],
    ['node', 'tests/build359-document-seal.cjs'],
    ['node', 'tests/build359-fleet-list-query.cjs'],
    ['node', 'tests/build359-map-modes-browser.cjs'],
    ['node', 'tests/build359-proof-checkpoints.cjs'],
    ['node', 'tests/build359-recorder-signal.cjs'],
    ['node', 'tests/build359-road-dispatch-browser.cjs'],
    ['node', 'tests/build359-sim-smoothness.cjs'],
    ['node', 'tests/build360-cold-archive.cjs'],
    ['node', 'tests/build362-bulk-asset-purchase-browser.cjs'],
    ['node', 'tests/build362-calendar-window-equivalence.cjs'],
    ['node', 'tests/build362-durable-prestage.cjs'],
    ['node', 'tests/build362-empty-calendar-browser.cjs'],
    ['node', 'tests/build362-fleet-window-session.cjs'],
    ['node', 'tests/build362-save-validation-chunks.cjs'],
    ['node', 'tests/build371-air-destination-pool-browser.cjs'],
    ['node', 'tests/build371-air-destination-pool-riyadh-browser.cjs'],
    ['node', 'tests/build371-air-fleet-series-browser.cjs'],
    ['node', 'tests/build371-custom-road-geometry-browser.cjs'],
    ['node', 'tests/build371-durable-fleet-isolation-browser.cjs'],
    ['node', 'tests/build371-old-save-trip-correction-browser.cjs'],
    ['node', 'tests/build371-reload-trip-speed-browser.cjs'],
    ['node', 'tests/build371-route-holder-scan.cjs'],
    ['node', 'tests/build371-sea-dispatch-lifecycle-browser.cjs'],
    ['node', 'tests/build372-asset-purchase-app-browser.cjs'],
    ['node', 'tests/build372-asset-purchase-apply.cjs'],
    ['node', 'tests/build372-asset-purchase-order.cjs'],
    ['node', 'tests/build372-asset-purchase-plan.cjs'],
    ['node', 'tests/build372-asset-purchase-worker-browser.cjs'],
    ['node', 'tests/build372-compact-save-validation.cjs'],
    ['node', 'tests/build372-depart-projection.cjs'],
    ['node', 'tests/build372-dispatch-app-integration.cjs'],
    ['node', 'tests/build372-field-classes-worker-browser.cjs'],
    ['node', 'tests/build372-finance-initial-allocation.cjs'],
    ['node', 'tests/build372-fleet-day-core.cjs'],
    ['node', 'tests/build372-fleet-day-exceptional.cjs'],
    ['node', 'tests/build372-fleet-day-slice-parity.cjs'],
    ['node', 'tests/build372-fleet-day-worker.cjs'],
    ['node', 'tests/build372-fleet-day-worker-browser.cjs'],
    ['node', 'tests/build372-fleet-dispatch-plan.cjs'],
    ['node', 'tests/build372-fleet-dispatch-worker-browser.cjs'],
    ['node', 'tests/build372-fleet-health-worker-browser.cjs'],
    ['node', 'tests/build372-fleet-query-worker-browser.cjs'],
    ['node', 'tests/build372-fleet-reference-query.cjs'],
    ['node', 'tests/build372-fleet-sale-plan.cjs'],
    ['node', 'tests/build372-fleet-ui-summary.cjs'],
    ['node', 'tests/build372-global-route-candidates.cjs'],
    ['node', 'tests/build372-insurance-condition-worker.cjs'],
    ['node', 'tests/build372-journal-pool.cjs'],
    ['node', 'tests/build372-large-fleet-fallback-guards-browser.cjs'],
    ['node', 'tests/build372-large-health-fallback-browser.cjs'],
    ['node', 'tests/build372-legacy-migration-single-pass.cjs'],
    ['node', 'tests/build372-legacy-route-plan.cjs'],
    ['node', 'tests/build372-legacy-route-repair-index.cjs'],
    ['node', 'tests/build372-maintenance-health-worker-browser.cjs'],
    ['node', 'tests/build372-manual-departure-plan.cjs'],
    ['node', 'tests/build372-map-summary-worker-browser.cjs'],
    ['node', 'tests/build372-native-migration-chunk-adoption.cjs'],
    ['node', 'tests/build372-native-seed-browser.cjs'],
    ['node', 'tests/build372-owner-totals-cache.cjs'],
    ['node', 'tests/build372-replica-log-browser.cjs'],
    ['node', 'tests/build372-replica-value-log.cjs'],
    ['node', 'tests/build372-route-normalization-plan.cjs'],
    ['node', 'tests/build372-route-reference-proof.cjs'],
    ['node', 'tests/build372-route-tier.cjs'],
    ['node', 'tests/build372-save-validation-worker-browser.cjs'],
    ['node', 'tests/build372-staffing-reconcile-plan.cjs'],
    ['node', 'tests/build372-staged-replica-prime-browser.cjs'],
    ['node', 'tests/build372-startup-normalization-plan.cjs'],
    ['node', 'tests/build372-startup-staffing-classes.cjs'],
    ['node', 'tests/build372-startup-staffing-worker-apply.cjs'],
    ['node', 'tests/build372-store-maintenance-stages.cjs'],
    ['node', 'tests/build373-large-fleet-hour-boundary-browser.cjs'],
    ['node', 'tests/build374-cheque-payable-lifecycle.cjs'],
    ['node', 'tests/build374-route-capacity-browser.cjs'],
    ['node', 'tests/build374-save-slice-telemetry.cjs'],
    ['node', 'tests/build375-large-fleet-background-save-browser.cjs'],
    ['node', 'tests/build376-seed-metadata-browser.cjs'],
    ['node', 'tests/build379-cheque-ui-browser.cjs'],
    ['node', 'tests/build379-command-validation-browser.cjs'],
    ['node', 'tests/build379-financial-posting-browser.cjs'],
    ['node', 'tests/build379-mutation-validation-browser.cjs'],
    ['node', 'tests/build379-realism-identity.cjs'],
    ['node', 'tests/build379-recovery-browser.cjs'],
    ['node', 'tests/build379-validation-slices.cjs'],
    ['node', 'tests/build383-navigation-browser.cjs'],
    ['node', 'tests/build383-save-encoding.cjs'],
    ['node', 'tests/build386-confirmation-browser.cjs'],
    ['node', 'tests/build389-differential-browser.cjs'],
    ['node', 'tests/build389-differential-collections.cjs'],
    ['node', 'tests/build390-cooperative-snapshot.cjs'],
    ['node', 'tests/build390-snapshot-browser.cjs'],
    ['node', 'tests/build396-hospitality-budgets.cjs'],
    ['node', 'tests/build401-mobility-batching-and-indexes.cjs'],
    ['node', 'tests/build404-worker-close-read-models.cjs'],
    ['node', 'tests/build405-worker-close-browser.cjs'],
    ['node', 'tests/build409-compressed-persistence.cjs'],
    ['node', 'tests/build410-fleet-save-row-patches.cjs'],
    ['node', 'tests/build412-live-validation-predicates.cjs'],
    ['node', 'tests/build423-worker-sync-work.cjs'],
    ['node', 'tests/build424-dense-fleet-pages.cjs'],
    ['node', 'tests/build425-validation-dependencies.cjs'],
    ['node', 'tests/build427-day-profile-work.cjs'],
    ['node', 'tests/build428-worker-value-collection.cjs'],
    ['node', 'tests/build429-worker-value-collection-browser.cjs'],
    ['node', 'tests/build430-legacy-fleet-pages.cjs'],
    ['node', 'tests/build432-ready-fleet-validation.cjs'],
    ['node', 'tests/build433-request-decisions-browser.cjs'],
    ['node', 'tests/build434-service-panel-fleet-work.cjs'],
    ['node', 'tests/build435-conditional-prestage.cjs'],
    ['node', 'tests/build436-save-work-removal.cjs'],
    ['node', 'tests/build437-adoption-patch-lineage.cjs'],
    ['node', 'tests/build438-day-scratch-work.cjs'],
    ['node', 'tests/build439-summary-single-request.cjs'],
    ['node', 'tests/build442-fleet-review-work.cjs'],
    ['node', 'tests/build449-asset-capacity-work.cjs'],
    ['node', 'tests/build452-section-review-browser.cjs'],
    ['node', 'tests/build458-stable-ui-writes.cjs'],
    ['node', 'tests/build463-ui-summary-projection.cjs'],
    ['node', 'tests/build464-summary-projection-boundary.cjs'],
    ['node', 'tests/build468-summary-projection-browser.cjs'],
    ['node', 'tests/build469-app-notice-work.cjs'],
    ['node', 'tests/build472-all-company-operating-browser.cjs'],
    ['node', 'tests/build474-event-trace-work.cjs'],
    ['node', 'tests/build475-replay-row-ranges.cjs'],
    ['node', 'tests/build476-staged-worker-replay.cjs'],
    ['node', 'tests/build480-journal-reserve-work.cjs'],
    ['node', 'tests/build482-worker-route-conflicts.cjs'],
    ['node', 'tests/build483-large-panel-worker-browser.cjs'],
    ['node', 'tests/build484-operating-vault-bootstrap-browser.cjs'],
    ['node', 'tests/build485-cold-validation-query.cjs'],
    ['node', 'tests/build488-route-preview-payload.cjs'],
    ['node', 'tests/build489-stored-lane-containers.cjs'],
    ['node', 'tests/build491-stored-containers-browser.cjs'],
    ['node', 'tests/build492-manual-slot-slices-browser.cjs'],
    ['node', 'tests/build493-backup-export-browser.cjs'],
    ['node', 'tests/build494-export-worker-protocol.cjs'],
    ['node', 'tests/build495-large-reset-browser.cjs'],
    ['node', 'tests/build497-route-preview-reuse.cjs'],
    ['node', 'tests/build499-purchase-append-views.cjs'],
    ['node', 'tests/build500-sale-navigation.cjs'],
    ['node', 'tests/build504-durable-clone-budget.cjs'],
    ['node', 'tests/build505-fleet-maintenance-guard.cjs'],
    ['node', 'tests/build507-encode-rows-steps.cjs'],
    ['node', 'tests/build508-presentation-index-saves.cjs'],
    ['node', 'tests/build510-validation-cache-reasons.cjs'],
    ['node', 'tests/build512-deferred-mobility-browser.cjs'],
    ['node', 'tests/build513-published-command-wait-browser.cjs'],
    ['node', 'tests/build514-map-summary-cadence-browser.cjs'],
    ['node', 'tests/build516-tracked-collections.cjs'],
    ['node', 'tests/build517-hr-hire-view-facilities-browser.cjs'],
    ['node', 'tests/build518-maintenance-worst-first.cjs'],
    ['node', 'tests/build519-idempotency-tracked.cjs'],
    ['node', 'tests/build520-map-aggregate-threshold-browser.cjs'],
    ['node', 'tests/build521-static-validation-groups.cjs'],
    ['node', 'tests/build522-fleet-day-prefetch.cjs'],
    ['node', 'tests/build523-proofs-commands-tracked.cjs'],
    ['node', 'tests/build524-sealed-text-reuse.cjs'],
    ['node', 'tests/build526-prestage-fleet-chunks-only.cjs'],
    ['node', 'tests/build532-map-loop-single-render.cjs'],
    ['node', 'tests/build533-durable-context-release.cjs'],
    ['node', 'tests/build534-staged-save-overlap.cjs'],
    ['node', 'tests/build535-staged-save-retake-browser.cjs'],
    ['node', 'tests/build559-share-value-fixes-browser.cjs'],
    ['node', 'tests/build569-company-evidence-pending.cjs'],
    ['node', 'tests/build573-asset-sale-browser.cjs'],
    ['node', 'tests/build579-defined-types-platform-weight.cjs'],
    ['node', 'tests/build583-boot-proof-single-hash.cjs'],
    ['node', 'tests/build584-summary-one-in-flight.cjs'],
    ['node', 'tests/build585-save-upload-block-accounting.cjs'],
    ['node', 'tests/company-platform-regressions.cjs'],
    ['node', 'tests/fleet-regressions.cjs'],
    ['node', 'tests/fleet-save-slicing.cjs'],
    ['node', 'tests/fleet-validation-reuse-browser.cjs'],
    ['node', 'tests/native-save-worker-browser.cjs'],
    ['node', 'tests/persistence-regressions.cjs'],
    ['node', 'tests/save-checksum-worker-browser.cjs'],
    ['node', 'tests/save-pipeline-browser.cjs'],
    ['node', 'tests/build359-sliced-save-browser.cjs'],
    ['node', 'tests/build374-diagnostic-lifecycle-browser.cjs'],
    ['node', 'tests/build338-idempotency-save-lag-root.cjs'],
    ['node', 'tests/build530-durable-alert-defer-browser.cjs'],
    ['node', 'tests/build531-durable-publish-no-late-write-browser.cjs'],
    ['node', 'tests/build359-save-policy-browser.cjs'],
    ['node', 'tests/build462-market-summary-refresh.cjs'],
    ['node', 'tests/build454-facility-pages.cjs'],
    ['node', 'tests/build461-market-render-work.cjs'],
    ['node', 'tests/build336-hour83-calendar-proof-regression.cjs'],
    ['node', 'tests/build334-archive-integrity-r2.cjs'],
    ['node', 'tests/build372-proof-worker-browser.cjs'],
    ['node', 'tests/build360-native-runtime-ready.cjs'],
    ['node', 'tests/build339-architecture-bootstrap.cjs'],
    ['node', 'tests/lint.cjs'],
    ['python3', 'tests/acceptance-policy.py'],
    ['python3', 'tests/build334-source-layout.py'],
    ['node', 'tests/build580-company-types-money-weight.cjs'],
    ['node', 'tests/build581-fleet-definition-weight.cjs'],
    ['node', 'tests/build582-directory-type-weight.cjs'],
    ['node', 'tests/build374-daily-worker-integration.cjs'],
    ['node', 'tests/build525-validation-context-route-ids.cjs'],
    ['node', 'tests/build359-corridor-index.cjs'],
    ['node', 'tests/build571-tax-month-close-browser.cjs'],
    ['node', 'tests/build479-facility-scope-work.cjs'],
    ['node', 'tests/build334-logistics-staged-contract.cjs'],
    ['node', 'tests/build465-directory-ranking-work.cjs'],
    ['node', 'tests/build466-directory-round-robin.cjs'],
    ['node', 'tests/build467-directory-country-work.cjs'],
    ['node', 'tests/build478-directory-scope-stream.cjs'],
    ['node', 'tests/build358-directory-open-sites-browser.cjs'],
    ['node', 'tests/build358-directory-search-browser.cjs'],
    ['node', 'tests/build358-directory-regions-browser.cjs'],
    ['node', 'tests/build361-bulk-opening-browser.cjs'],
    ['node', 'tests/build358-founding-charter-browser.cjs'],
    ['node', 'tests/build361-button-binding-browser.cjs'],
    ['node', 'tests/phone-layout-browser.cjs'],
    ['node', 'tests/build334-market-discovery-browser.cjs'],
    ['node', 'tests/build398-asset-market-metrics-layout-browser.cjs'],
    ['node', 'tests/build459-navigation-scroll-work.cjs'],
    ['node', 'tests/build379-financial-posting.cjs'],
    ['node', 'tests/build334-dynamic-finance-company-ids.cjs'],
    ['node', 'tests/build334-finance-company-security-contract.cjs'],
    ['node', 'tests/build340-finance-report.cjs'],
    ['node', 'tests/build502-consolidated-cash-order.cjs'],
    ['node', 'tests/tax-reload-regressions.cjs'],
    ['node', 'tests/build334-app-platform-authorization.cjs'],
    ['node', 'tests/build353-compaction-scope.cjs'],
    ['node', 'tests/build358-payment-terms.cjs'],
    ['node', 'tests/build567-budget-lapsed-reservation.cjs'],
    ['node', 'tests/build334-asset-route-hr-contract.cjs'],
    ['node', 'tests/build368-hr-payroll-parity.cjs'],
    ['node', 'tests/build358-crews.cjs'],
    ['node', 'tests/conference-capability-core.cjs'],
    ['node', 'tests/build447-hr-facility-work.cjs'],
    ['node', 'tests/build359-durable-command-cost.cjs'],
    ['node', 'tests/review-regressions.cjs'],
    ['node', 'tests/build543-external-claim-recovery.cjs'],
    ['node', 'tests/build549-intercompany-loan-interest.cjs'],
    ['node', 'tests/build334-company-platform-orphan-contract.cjs'],
    ['node', 'tests/build334-company-adapters.cjs'],
    ['node', 'tests/build334-singleton-company-boundaries.cjs'],
    ['node', 'tests/build334-map-identity-registry.cjs'],
    ['node', 'tests/build334-identity-regressions.cjs'],
    ['node', 'tests/build375-group-brand-names.cjs'],
    ['node', 'tests/build367-company-static-identities.cjs'],
    ['node', 'tests/build350-archive-route-diet.cjs'],
    ['node', 'tests/build359-route-seal.cjs'],
    ['node', 'tests/build334-market-discovery-contract.cjs'],
    ['node', 'tests/build557-investor-card-load.cjs'],
    ['node', 'tests/build554-investor-card-funding.cjs'],
    ['node', 'tests/build501-schema-text-slices.cjs'],
    ['node', 'tests/build368-approved-company-logos.cjs'],
    ['node', 'tests/build426-governor-pressure.cjs'],
    ['node', 'tests/build339-phase1bb-pacing-separation.cjs'],
    ['node', 'tests/governor-overrun-signal.cjs'],
    ['node', 'tests/build371-calendar-cancel-maintenance-browser.cjs'],
    ['node', 'tests/build334-calendar-journey-browser.cjs'],
    ['node', 'tests/build334-r4-recovery-browser.cjs'],
    ['node', 'tests/build339-diagnostic-frame-trace.cjs'],
    ['node', 'tests/build498-native-save-export-contract.cjs'],
    ['node', 'tests/build576-presentation-rest-browser.cjs'],
    ['node', 'tests/build358-staged-full-scope.cjs'],
    ['node', 'tests/build334-security-contract.cjs'],
    ['node', 'tests/build487-route-pages-browser.cjs'],
    ['node', 'tests/build376-cooperative-draft.cjs'],
    ['node', 'tests/build340-durable-draft-restore.cjs'],
    ['node', 'tests/build575-conference-keynote-weight-browser.cjs'],
    ['node', 'tests/build558-investor-card-load-browser.cjs'],
    ['node', 'tests/build375-compact-desks-browser.cjs'],
    ['node', 'tests/build470-composite-notice-work.cjs'],
    ['node', 'tests/build574-investor-budget-overrun.cjs'],
    ['node', 'tests/build552-conference-hall-layout-browser.cjs'],
    ['node', 'tests/build421-conference-recovery-contract.cjs'],
    ['node', 'tests/build420-conference-durable-browser.cjs'],
    ['node', 'tests/build553-conference-open-cost.cjs'],
    ['node', 'tests/build460-render-idle-browser.cjs'],
    ['node', 'tests/build496-world-query-reset.cjs'],
    ['node', 'tests/build490-container-compression.cjs'],
    ['node', 'tests/build486-route-card-pages.cjs'],
    ['node', 'tests/build473-purchase-notice-work.cjs'],
    ['node', 'tests/build481-diagnostic-fleet-proof.cjs'],
    ['node', 'tests/build457-canvas-idle-work.cjs'],
    ['node', 'tests/build456-list-build-budget.cjs'],
    ['node', 'tests/build444-document-pages.cjs'],
    ['node', 'tests/build446-payroll-unused-work.cjs'],
    ['node', 'tests/build440-document-collection-work.cjs'],
    ['node', 'tests/build419-document-drawer-work-browser.cjs'],
    ['node', 'tests/build416-canonical-preparation.cjs'],
    ['node', 'tests/build417-document-amendment-work.cjs'],
    ['node', 'tests/build414-command-preparation.cjs'],
    ['node', 'tests/build415-route-publication-browser.cjs'],
    ['node', 'tests/build406-save-chunk-transport.cjs'],
    ['node', 'tests/build407-diagnostic-lifecycle.cjs'],
    ['node', 'tests/build408-diagnostic-map-browser.cjs'],
    ['node', 'tests/build358-map-controls-browser.cjs'],
    ['node', 'tests/build334-procurement-pressure.cjs'],
    ['node', 'tests/build334-simulation-time-contract.cjs'],
    ['node', 'tests/build385-bank-credit-accounting.cjs'],
    ['node', 'tests/build403-legacy-runtime-migration-browser.cjs'],
    ['node', 'tests/build397-management-flow-layout-browser.cjs'],
    ['node', 'tests/build399-bank-prudential-summary-layout-browser.cjs'],
]
assert declared['preflight_commands']==expected_preflight,'run the gate that failed on CI first, then the gates a fix touched or CI has not reached, then the gates that failed before and passed, then the targeted save, failure-rollback, finance, and layout set'
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
# Node 24.19.0 crashes (SIGSEGV) on the arm64 macOS runner: a full GC in a Sparkplug prologue reads an untagged slot
# (node-crash-probe.yml, which keeps 24.19.0 as its baseline). Every other workflow pins 24.22.0 or later.
# Each node-version value on a non-comment line, as (major, minor, patch), or None when it is not an exact version.
def node_pins(text):
    values=[m.group(1) for line in text.splitlines() if not line.lstrip().startswith('#') for m in [re.search(r'node-version:\s*([^\s#,}]+)',line)] if m]
    return [tuple(map(int,v.groups())) if (v:=re.fullmatch(r'["\']?v?(\d+)\.(\d+)\.(\d+)["\']?',value)) else None for value in values]
for workflow in sorted([*(root/'.github/workflows').glob('*.yml'),*(root/'.github/workflows').glob('*.yaml')]):
    if workflow.name=='node-crash-probe.yml':continue
    assert all(pin is not None and pin>=(24,22,0) for pin in node_pins(workflow.read_text())),f'{workflow.name}: pin an exact Node 24.22.0 or later (24.19.0 crashes on the arm64 runner)'
for name in ['build362-unsigned-ipa.yml','ventora-release-ipa.yml']:
    text=(root/'.github/workflows'/name).read_text()
    assert 'inputs.acceptance' not in text and 'acceptance_gate=NOT_RUN' not in text
    assert node_pins(text),f'{name} pins its Node version'
    checkout=text.index('uses: actions/checkout@v4');assert 'fetch-depth: 0' in text[checkout:text.index('\n      - name:',checkout)],'check out the full history: the parity gates read earlier source files with git show'
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
    export_start=text.index('      - name: Run native save export download checks')
    export_end=text.index('\n      - name:',export_start+1);export_step=text[export_start:export_end]
    assert export_start<start and '--native-export-only' in export_step,'exercise native Blob streaming and its exact receipt before the long suite'
    assert '\n        if:' not in export_step and 'continue-on-error' not in export_step
    worker=text.index('      - name: Run native save-worker and pipeline checks')
    worker_end=text.index('\n      - name:',worker+1);worker_step=text[worker:worker_end]
    assert worker<build and 'save-worker-smoke.swift' in worker_step and 'native-save-worker.json' in worker_step
    assert '--native-worker-only' in worker_step,'verify the receipt native contract before the long browser suite'
    assert '\n          exit \"$status\"' not in worker_step,'the early receipt check must be reachable after a successful probe'
    assert '\n        if:' not in worker_step and 'continue-on-error' not in worker_step,'native worker gate cannot be optional'
for name in ['build350-unsigned-ipa.yml','build362-ipa-only.yml']:
    text=(root/'.github/workflows'/name).read_text()
    assert 'uses: ./.github/workflows/build362-unsigned-ipa.yml' in text
    assert 'xcodebuild' not in text and 'NOT_RUN' not in text
assert 'workflow_call:' in (root/'.github/workflows/build362-unsigned-ipa.yml').read_text()
release=(root/'.github/workflows/ventora-release-ipa.yml').read_text()
assert 'cd "$RELEASE_SOURCE_DIR"' in release and 'rm -rf WebApp' not in release,'preserve the source accepted by the full suite'
from publish_ci_receipt import valid_artifact_url,verify_native_worker,NATIVE_SAVE_WORKER_CASES,verify_native_export,NATIVE_EXPORT_CASES
assert NATIVE_SAVE_WORKER_CASES==9
native_good={'nativeGatePassed':True,'realWKWebView':True,'workerRequestObserved':True,'origin':'gh://app','passed':9,'total':9,'failed':0,'sourceSha256':{name:hashlib.sha256((root/'WebApp'/name).read_bytes()).hexdigest() for name in ['index.html','fleet-store-core.js','state-codec-core.js','save-chunk-codec.js','save-checksum-thread.js','save-checksum-worker.js']},'probeSha256':hashlib.sha256((root/'tests/native/save-worker-probe.js').read_bytes()).hexdigest()}
assert verify_native_worker(root,native_good)=={'passed':9,'total':9,'origin':'gh://app'}
for change in [lambda v:v.update(passed=8,total=8),lambda v:v.update(failed=1),lambda v:v.update(origin='http://localhost'),lambda v:v.update(workerRequestObserved=False),lambda v:v['sourceSha256'].__setitem__('save-checksum-worker.js','old-source'),lambda v:v.update(probeSha256='old-probe')]:
    bad=copy.deepcopy(native_good);change(bad)
    try:verify_native_worker(root,bad)
    except ValueError:pass
    else:raise AssertionError('Invalid native worker receipt was accepted')
with tempfile.TemporaryDirectory(prefix='madar-native-receipt-') as tmp:
    base=Path(tmp);(base/'WebApp').symlink_to(root/'WebApp',target_is_directory=True);(base/'tests').symlink_to(root/'tests',target_is_directory=True);(base/'.ci-output').mkdir()
    def native_cli(value):
        (base/'.ci-output/native-save-worker.json').write_text(json.dumps(value))
        return subprocess.run(['python3',str(root/'tools/publish_ci_receipt.py'),'--source',str(base),'--native-worker-only'],capture_output=True,text=True)
    assert native_cli(native_good).returncode==0,'same validator must work before CI needs publication credentials'
    bad=copy.deepcopy(native_good);bad.update(passed=8,total=8)
    assert native_cli(bad).returncode!=0,'an older eight-case probe must fail before the full suite'
assert NATIVE_EXPORT_CASES==8
export_good={'realWKWebView':True,'origin':'gh://app','workerBlobExact':True,'passed':8,'total':8,'failed':0,'sourceSha256':{name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in ['iOS/GlobalHoldings/SaveExportDownloadOwner.swift','iOS/GlobalHoldings/GameViewController.swift','tests/native/save-export-download-smoke.swift']}}
assert verify_native_export(root,export_good)['worker_blob_exact'] is True
for change in [lambda v:v.update(passed=7,total=7),lambda v:v.update(failed=1),lambda v:v.update(workerBlobExact=False),lambda v:v.update(origin='http://localhost'),lambda v:v['sourceSha256'].__setitem__('iOS/GlobalHoldings/SaveExportDownloadOwner.swift','other-bytes')]:
    bad=copy.deepcopy(export_good);change(bad)
    try:verify_native_export(root,bad)
    except ValueError:pass
    else:raise AssertionError('Invalid native export proof was accepted')
with tempfile.TemporaryDirectory(prefix='madar-export-receipt-') as tmp:
    base=Path(tmp)
    for name in ['iOS','tests']:(base/name).symlink_to(root/name,target_is_directory=True)
    (base/'.ci-output').mkdir();file=base/'.ci-output/native-save-export.json';file.write_text(json.dumps(export_good))
    cli=['python3',str(root/'tools/publish_ci_receipt.py'),'--source',str(base),'--native-export-only']
    assert subprocess.run(cli,capture_output=True,text=True).returncode==0
    bad=copy.deepcopy(export_good);bad['workerBlobExact']=False;file.write_text(json.dumps(bad))
    assert subprocess.run(cli,capture_output=True,text=True).returncode!=0
assert valid_artifact_url('https://github.com/bdr-design/madar/actions/runs/123/artifacts/456','bdr-design/madar',123)
for url in ['http://github.com/bdr-design/madar/actions/runs/123/artifacts/456','https://github.com/other/repo/actions/runs/123/artifacts/456','https://github.com/bdr-design/madar/actions/runs/124/artifacts/456','https://github.com.evil.test/bdr-design/madar/actions/runs/123/artifacts/456','https://github.com/bdr-design/madar/actions/runs/123/artifacts/456?token=x']:
    assert not valid_artifact_url(url,'bdr-design/madar',123),'artifact links must belong to this exact repository/run'
print(f'PASS acceptance-policy: stale/failed/incomplete evidence rejected; {len(declared["commands"])} mandatory gates; all current IPA entry points guarded')
