'use strict';
const fixture=require('../../tests/helpers/request-decisions-fixture.cjs'),read=fixture.read;
fixture.read=async page=>{const out=await read(page);out.validation=await page.evaluate(()=>GH_SAVE_SCHEMA.telemetry().lastValidation);out.saveBreakdown=await page.evaluate(()=>GH_PERSISTENCE.telemetry().timings.lastSaveBreakdown);return out;};
require('../../tools/measure_request_decisions.cjs');
