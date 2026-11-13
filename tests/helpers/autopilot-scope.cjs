'use strict';
// The company autopilot's transaction roots as app.js defines them (lifted from the source, not copied), so a gate runs
// each step under exactly the roots the app gives it, with the write audit on (a write outside them fails the step).
const fs=require('node:fs'),path=require('node:path');
function autopilotScope(root){
  const app=fs.readFileSync(path.join(root,'WebApp','app.js'),'utf8'),names=['AUTOPILOT_SCOPE','AUTOPILOT_DOMAIN_ROOTS','AUTOPILOT_KIND_SCOPES','AUTOPILOT_CAMPAIGN_ROOT','autopilotScope','AUTOPILOT_ROW_ROOTS'];
  const lines=names.map(name=>{const line=app.split('\n').find(row=>row.startsWith(`  const ${name}=`));if(!line)throw new Error(`autopilot-scope-missing:${name}`);return line;});
  return Function(`'use strict';${lines.join('\n')};return {autopilotScope,AUTOPILOT_ROW_ROOTS,AUTOPILOT_DECISION_KINDS};`)();
}
// One autopilot step run as runCompanyAutopilotStep runs it (same label, roots, row roots, audit enforced).
function runStep(s,state,step,root){
  const {autopilotScope:scopeOf,AUTOPILOT_ROW_ROOTS}=autopilotScope(root),scope=scopeOf(step);
  return s.GH_TRANSACTION_CORE.execute(state,{label:`company-autopilot:${step.kind}`,scope,writeRoots:scope,scopedJoin:true,rowRoots:AUTOPILOT_ROW_ROOTS,auditWrites:true,enforceWriteRoots:true,apply:()=>step.commands.map(c=>{const r=s.GH_DOMAIN_COMMANDS.dispatchSystem({state},c.domain,c.name,c.payload,{actor:s.GH_COMPANY_AUTOPILOT.ACTOR});if(!r.ok)throw new Error(r.error);return r.result;})});
}
module.exports={autopilotScope,runStep};
