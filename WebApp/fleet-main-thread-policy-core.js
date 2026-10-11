// Build 372: one policy for fleet operations whose synchronous fallback scans
// every row.  Worker callers may keep their exact legacy fallback for a small
// fleet, but a missing, stale, or rejected worker answer must never turn into a
// million-row presentation-thread pass.
(()=>{
  'use strict';

  const VERSION='1.0.0';
  const DEFAULT_ROW_LIMIT=2048;

  function rowLimit(value=DEFAULT_ROW_LIMIT){
    const limit=Number(value);
    if(!Number.isSafeInteger(limit)||limit<0)throw new TypeError('fleet-main-thread-row-limit-invalid');
    return limit;
  }

  function rowCount(state,fleet){
    if(!fleet||typeof fleet.size!=='function')return Infinity;
    let rows;
    try{rows=Number(fleet.size(state));}catch(_error){return Infinity;}
    return Number.isSafeInteger(rows)&&rows>=0?rows:Infinity;
  }

  function decision(state,fleet,{operation='fleet-full-scan',limit=DEFAULT_ROW_LIMIT}={}){
    const rows=rowCount(state,fleet),maximum=rowLimit(limit),allowed=rows<=maximum;
    return Object.freeze({allowed,rows,limit:maximum,operation:String(operation||'fleet-full-scan'),reason:allowed?'bounded-main-thread-fallback':'large-fleet-worker-required'});
  }

  // The callback is deliberately owned by this core.  Call sites cannot check
  // the limit and accidentally invoke the expensive fallback on the following
  // line.  Unknown fleet sizes fail closed as Infinity.
  function run(state,fleet,work,options={}){
    if(typeof work!=='function')throw new TypeError('fleet-main-thread-fallback-function-required');
    const gate=decision(state,fleet,options);
    if(!gate.allowed)return Object.freeze({...gate,executed:false});
    return {...gate,executed:true,value:work()};
  }

  const API=Object.freeze({VERSION,DEFAULT_ROW_LIMIT,rowCount,decision,run});
  globalThis.GH_FLEET_MAIN_THREAD_POLICY=API;
  if(globalThis.window&&globalThis.window!==globalThis)globalThis.window.GH_FLEET_MAIN_THREAD_POLICY=API;
  if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
