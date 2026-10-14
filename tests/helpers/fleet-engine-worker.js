'use strict';
// Build 372: the fleet engine runs on a Worker (fleet-engine-worker.js). Browser suites boot the app from a page without
// a file URL (local-dom-app), where that relative Worker URL cannot load. boot({fleetWorker:true}) hands the app the same
// worker script assembled here (its importScripts inlined) through __GH_FLEET_ENGINE_WORKER_FACTORY__, the hook the
// Build 372 browser suites already use.
const fs=require('node:fs'),path=require('node:path');
function fleetEngineWorkerSource(root=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'../..')){
  const web=path.join(root,'WebApp'),read=file=>fs.readFileSync(path.join(web,file),'utf8'),worker=read('fleet-engine-worker.js');
  const line=worker.match(/^importScripts\(([^)]*)\);$/m);if(!line)throw new Error('fleet worker imports unavailable');
  const imports=[...line[1].matchAll(/['"]([^'"]+)['"]/g)].map(match=>match[1]);
  return imports.map(read).join('\n;\n')+'\n;\n'+worker.replace(/^importScripts\([^)]*\);$/m,'');
}
module.exports={fleetEngineWorkerSource};
