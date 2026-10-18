'use strict';
// Count allocations, rather than assuming a fast desktop timer proves their absence.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const root=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..'),file=path.join(root,'WebApp/fleet-access-core.js'),S=require(path.join(root,'WebApp/fleet-store-core.js'));
let proxies=0;const CountedProxy=new Proxy(Proxy,{construct(target,args){proxies++;return new target(...args);}}),ctx=vm.createContext({console,require:createRequire(file),structuredClone,Proxy:CountedProxy,GH_FLEET_STORE:S});
vm.runInContext(fs.readFileSync(file,'utf8'),ctx);const F=ctx.GH_FLEET_DATA;
function state(store=true){return store?{fleet:S.create(2048),simSeconds:42}:{assets:[],simSeconds:42};}
function asset(i){return {id:'QA-'+String(i).padStart(8,'0'),name:'Plane '+i,type:'air',ownerCompanyId:'air',routeId:null,phase:'idle',progress:0,fuel:100,condition:95,specs:{speed:800,nested:[1,2]},staffing:{roles:[{id:'pilots',count:10}]},custom:{kept:true},notFinite:NaN,negativeZero:-0};}
for(const store of [true,false]){
 const before=state(store),after=state(store);proxies=0;
 for(let i=1;i<=1000;i++)assert(F.add(before,asset(i)));
 const referenceProxies=proxies;assert(referenceProxies>=1000);
 proxies=0;for(let i=1;i<=1000;i++)assert(F.add(after,asset(i),{returnView:false})===true,'append returns success without a view');
 assert.equal(proxies,0,'append-only caller must allocate no read-only views');
 if(store){assert.deepEqual(new Uint8Array(after.fleet.rows),new Uint8Array(before.fleet.rows));assert.deepEqual(after.fleet.values,before.fleet.values);assert.deepEqual(after.fleet.extras,before.fleet.extras);assert.equal(after.fleet.revision,before.fleet.revision);assert.equal(after.fleet.structure,before.fleet.structure);}
 else assert.deepEqual(after.assets,before.assets);
 const original=asset(1001);F.add(after,original,{returnView:false});original.specs.nested[0]=999;original.custom.kept=false;
 assert.equal(F.get(after,original.id).specs.nested[0],1);assert.equal(F.get(after,original.id).custom.kept,true);
 const n=F.size(after);assert.throws(()=>F.add(after,null,{returnView:false}));assert.equal(F.size(after),n);
 const view=F.add(after,asset(1002));assert.equal(view.id,asset(1002).id);assert.throws(()=>{view.condition=1;});
}
// The purchase adapter must explicitly request the allocation-free result; the
// existing 200k browser gate owns its real success/stale/late-rollback paths.
const adapter=fs.readFileSync(path.join(root,'WebApp/asset-purchase-apply-core.js'),'utf8');assert.match(adapter,/const APPEND_ONLY=Object\.freeze\(\{returnView:false\}\)/);assert.match(adapter,/fleet\.add\(state,asset,APPEND_ONLY\)/);
console.log(JSON.stringify({suite:'build499-purchase-append-views',ok:true,rowsCompared:2000,discardedProxyAllocations:0,bytesValuesExtrasExact:true,normalizationAndIsolation:true,defaultReadOnlyViewsPreserved:true}));
