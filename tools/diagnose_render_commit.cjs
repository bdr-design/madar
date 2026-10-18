'use strict';
// Finite diagnosis of the existing rendering gate. All original assertions stay.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),file=path.join(root,'tests/build460-render-idle-browser.cjs'),original=fs.readFileSync(file,'utf8');
let code=original.replace('points=a.mapMetrics().vehiclePoints;','points=a.mapMetrics().vehiclePoints,initialEngine=a.simulationEngine.snapshot();').replace('a.setSpeed(0);await a.whenStateIdle();return','const beforePause=a.simulationEngine.snapshot();a.setSpeed(0);await a.whenStateIdle();return').replace('return {simProgress:a.state().simSeconds-sim,','return {initialEngine,beforePause,afterPause:a.simulationEngine.snapshot(),simProgress:a.state().simSeconds-sim,');
if(process.env.GH_RENDER_COMMIT_PROOF==='1')code=code.replace('a.state().simSeconds>sim&&moved()', 'a.simulationEngine.snapshot().slices>initialEngine.slices&&a.simulationEngine.snapshot().lastProgressSim>sim&&moved()');
if(!code.includes('const beforePause=')||code===original)throw Error('diagnosis anchors changed');
console.log(JSON.stringify({originalSha256:crypto.createHash('sha256').update(original).digest('hex'),condition:process.env.GH_RENDER_COMMIT_PROOF==='1'?'committed-slice':'original-live-value'}));
const mod=new Module(file,module);mod.filename=file;mod.paths=Module._nodeModulePaths(path.dirname(file));mod._compile(code,file);
