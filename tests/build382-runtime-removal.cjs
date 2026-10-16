'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..');
const retired=['WebApp/performance-trace-core.js','WebApp/performance-report-store.js','iOS/GlobalHoldings/PerformanceDiagnostics.swift','iOS/GlobalHoldings/PerformanceReportVault.swift'];for(const f of retired)assert.equal(fs.existsSync(path.join(root,f)),false,f);
const forbidden=/GH_PERFORMANCE_TRACE|GH_PERFORMANCE_REPORT_STORE|performance-trace-core\.js|performance-report-store\.js|PerformanceDiagnostics|PerformanceReportVault|performanceTrace(Start|Stop|Status)|renderPerformanceTrace/;
for(const f of ['WebApp/index.html','WebApp/runtime-required.json','WebApp/app.js','WebApp/advanced-core.js','WebApp/transaction-core.js','WebApp/simulation-runtime-core.js','WebApp/diagnostics-core.js','iOS/GlobalHoldings/GameViewController.swift','.github/workflows/build362-unsigned-ipa.yml','.github/workflows/ventora-release-ipa.yml'])assert.doesNotMatch(fs.readFileSync(path.join(root,f),'utf8'),forbidden,f);
assert.match(fs.readFileSync(path.join(root,'WebApp/diagnostics-core.js'),'utf8'),/GH_DIAGNOSTICS/,'existing diagnostics remain available');
assert.match(fs.readFileSync(path.join(root,'WebApp/app.js'),'utf8'),/assertAccountPosting/,'previous financial protection remains');
console.log(JSON.stringify({suite:'build382-runtime-removal',ok:true,retiredFiles:retired.length,oldDiagnosticsAndFinancialProtectionsRetained:true}));
