'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{hospitalityFixture}=require('./helpers/hospitality-fixture.cjs');
const results=[],measurements=[];function test(name,fn){fn();results.push(name);}
function drain(iterator){let step,count=0,totalMs=0,maxStepMs=0;do{const at=performance.now();step=iterator.next();const ms=performance.now()-at;totalMs+=ms;maxStepMs=Math.max(maxStepMs,ms);count++;}while(!step.done);return {value:step.value,steps:count,totalMs,maxStepMs};}
function scenario(count,multiplier=1){
 const q=hospitalityFixture(),base=q.property(),site=q.state.customHubs.find(x=>x.id===base.id),model=q.state.advanced.facilities[base.id],root=q.H.read(q.state);root.properties=[];q.state.customHubs=[];q.state.advanced.facilities={};
 // Synthetic density only: these rows are never presented as paid construction, production saves or device evidence.
 for(let i=0;i<count;i++){const id='HOSP-BUDGET-'+i;root.properties.push({...structuredClone(base),id,facilityId:id,rooms:base.rooms.map(n=>n*multiplier),calendar:Array(90).fill(null)});q.state.customHubs.push({...structuredClone(site),id,roomCount:100*multiplier});q.state.advanced.facilities[id]={...structuredClone(model),staff:60*multiplier};}
 root.lastProcessedDay=12;root.accounting.lastAccruedDay=12;q.F.book(q.state,'hospitality').accounts[0].balance=1e12;return q;
}
function day(q,at){q.state.simSeconds=at*86400;let detail;const start=performance.now();q.s.GH_TRANSACTION_CORE.execute(q.state,{label:'qa-hospitality-density',apply:()=>{detail=drain(q.H.executeStages({state:q.state},'tick-day',{companyId:'hospitality',day:at},{actor:'simulation-scheduler'}));}});return {...detail,value:undefined,atomicMs:performance.now()-start};}
test('the dormant sector installs no timers and read-only panels never create operational or financial state',()=>{
 const q=hospitalityFixture(),before=JSON.stringify(q.state);for(let i=0;i<100;i++){assert.equal(q.H.read(q.state),null);q.H.summary(q.state);}for(let day=0;day<31;day++)assert.equal(drain(q.H.onFinancialDayStages({state:q.state,companyId:'hospitality'},{day})).value.dormant,true);assert(q.H.propertyQuote({kind:'resort',capitalId:'HOSP-HKT'}).cost>0);assert.equal(JSON.stringify(q.state),before);
 for(const file of ['hospitality-calendar-core.js','hospitality-core.js','hospitality-finance-core.js','hospitality-links-core.js','hospitality-ui.js'])assert(!/\b(?:setTimeout|setInterval|requestAnimationFrame|requestIdleCallback)\s*\(/.test(fs.readFileSync(path.resolve(__dirname,'../WebApp',file),'utf8')),file+' has no continuous scheduler');
});
for(const count of [10,50,500])test(count+' properties use cooperative stages and one country collection with signed location allocations',()=>{
 const q=scenario(count),data=q.s.GH_FLEET_DATA;q.s.GH_FLEET_DATA=new Proxy(data,{get(target,key){if(['scan','scanStages','scanRouted','forEach','forEachFieldClasses'].includes(key))throw new Error('hospitality-must-not-scan-fleet');return target[key];}});
 let ordinary,close;try{ordinary=day(q,13);close=day(q,14);}finally{q.s.GH_FLEET_DATA=data;}
 const root=q.H.read(q.state),invoices=q.state.finance.invoices.filter(r=>r.sourceRef?.startsWith('HOSP-INVOICE'));assert.equal(invoices.length,1,'compatible organic collections are batched by legal company and country');
 const bucket=Object.values(root.accounting.buckets)[0],allocation=q.state.finance.hospitalityDocuments.find(d=>d.reference===bucket.allocationReference);assert.equal(Object.values(allocation.propertyCharges).reduce((n,v)=>n+v,0),bucket.net);assert.equal(allocation.invoiceNumber,invoices[0].number);assert(allocation.documentProofId);
 assert(close.steps>=count);assert(ordinary.steps>=count);assert(root.history[0].occupied>0&&root.history[0].occupied<=1000,'rounding cannot erase a crowded destination or multiply its market');assert.equal(root.bookings.length,0,'no guest rows are generated');
 const validation=drain(q.H.validationSteps(q.state));assert(validation.value.ok,JSON.stringify(validation.value));assert(validation.steps>=count*2);
 const summaryStart=performance.now(),summary=q.H.summary(q.state);const summaryMs=performance.now()-summaryStart;assert.equal(summary.properties.length,count);
 const copied=performance.now(),clone=q.s.GH_TRANSACTION_CORE.deepClone(q.state);const cloneMs=performance.now()-copied;assert.equal(clone.hospitality.companies.hospitality.properties.length,count);
 measurements.push({properties:count,ordinary,close,summaryMs,validation:{...validation,value:undefined},cloneMs,hospitalityJSONBytes:Buffer.byteLength(JSON.stringify(root)),stateJSONBytes:Buffer.byteLength(JSON.stringify(q.state)),invoices:invoices.length});
});
test('ten times the rooms use the same bounded stages and no guest-level state',()=>{
 const small=scenario(50),large=scenario(50,10),a=day(small,13),b=day(large,13);assert.equal(a.steps,b.steps);assert.equal(small.H.read(small.state).bookings.length,large.H.read(large.state).bookings.length);assert.equal(small.H.read(small.state).properties.length,large.H.read(large.state).properties.length);
 const ratio=Buffer.byteLength(JSON.stringify(large.state.hospitality))/Buffer.byteLength(JSON.stringify(small.state.hospitality));assert(ratio<1.1,'capacity changes numbers, not record count');
});
test('large hospitality state survives the real chunked codec with cooperative JSON stages',()=>{
 const q=scenario(500);day(q,13);q.load('state-codec-core');const codec=q.s.GH_STATE_CODEC,snapshot=JSON.stringify(q.state.hospitality),serialization=drain(codec.serializeChunkedSteps(q.state)),encoded=serialization.value,chunks=new Map(encoded.chunks.map(c=>[c.id,c.bytes||new TextEncoder().encode(c.text)])),restored=codec.deserialize(encoded.text,{resolveChunk:id=>chunks.get(id)});assert.equal(JSON.stringify(restored.hospitality),snapshot);assert(serialization.steps>50);measurements.push({properties:500,codec:{steps:serialization.steps,totalMs:serialization.totalMs,maxStepMs:serialization.maxStepMs,mainJSONBytes:Buffer.byteLength(encoded.text),chunks:encoded.chunks.length}});
});
const output={suite:'build396-hospitality-budgets',passed:results.length,results,environment:{node:process.version,platform:process.platform,scope:'Cloud Linux synthetic density; owner generators drained synchronously. Atomic time includes existing isolation and validation. No physical iPhone, FPS, GPU, heat, battery or Swift storage measurement.'},measurements};
if(process.env.GH_HOSPITALITY_BUDGET_RESULTS)fs.writeFileSync(process.env.GH_HOSPITALITY_BUDGET_RESULTS,JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify(output));
