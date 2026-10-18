'use strict';
const fs=require('node:fs'),fixture=require('../../tests/helpers/request-decisions-fixture.cjs'),install=fixture.installTrace,read=fixture.read;
let cdp,complete,count=0;
fixture.installTrace=async page=>{
 await install(page);cdp=await page.context().newCDPSession(page);complete=new Promise(resolve=>cdp.once('Tracing.tracingComplete',resolve));
 await cdp.send('Tracing.start',{categories:'toplevel,devtools.timeline,disabled-by-default-devtools.timeline,blink.user_timing,v8,disabled-by-default-v8.gc',transferMode:'ReturnAsStream'});
 await page.evaluate(()=>{window.__TASK_TRACE_N__=0;document.addEventListener('click',event=>{if(event.target.closest('.ui-confirm [data-confirm="accept"]'))performance.mark('GH_REQUEST_BEGIN_'+(++__TASK_TRACE_N__));},true);});
};
fixture.read=async page=>{
 const out=await read(page);out.validation=await page.evaluate(()=>GH_SAVE_SCHEMA.telemetry().lastValidation);out.saveBreakdown=await page.evaluate(()=>GH_PERSISTENCE.telemetry().timings.lastSaveBreakdown);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>{performance.mark('GH_REQUEST_END_'+__TASK_TRACE_N__);resolve();}))));
 if(++count===6){await cdp.send('Tracing.end');const {stream}=await complete;let data='';for(;;){const part=await cdp.send('IO.read',{handle:stream});data+=part.base64Encoded?Buffer.from(part.data,'base64').toString():part.data;if(part.eof)break;}await cdp.send('IO.close',{handle:stream});fs.writeFileSync(process.env.GH_TASK_TRACE_OUTPUT,data);}
 return out;
};
require('../../tools/measure_request_decisions.cjs');
