'use strict';
// Real save/load path: an old 600x choice is capped and per-driver contracts migrate before another fleet action.
const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright'),{boot,reboot}=require('./helpers/local-dom-app');
(async()=>{for(const engine of [chromium,webkit]){
  const browser=await engine.launch({headless:true}),errors=[];
  try{
    let {page}=await boot({browser,errors,viewport:{width:956,height:440}});
    const before=await page.evaluate(async()=>{
      const a=__AUDIT__;await a.runAuthorizedDomainCommand('corporate','open-company',{type:'mobility',capital:500000000,legalName:'QA Legacy Driver Migration'},{silent:true});
      const s=__GH_STATE__,M=GH_MOBILITY_CORE;
      s.customHubs.push({id:'QA-MIGRATE-RUH',name:'الرياض',kind:'mobility-center',ownerCompanyId:'mobility',owned:true,capitalId:'RUH',city:'الرياض',country:'السعودية',coords:[24.7,46.7],bays:120});
      M.ensure(s);s.mobility.capitalCenters=[{id:'QA-MIGRATE-RUH',facilityId:'QA-MIGRATE-RUH',ownerCompanyId:'mobility',capitalId:'RUH',city:'الرياض',country:'السعودية',coords:[24.7,46.7]}];
      await a.runAuthorizedDomainCommand('mobility','buy-fleet',{quantity:2,centerId:'RUH',classId:'eco-ev'},{silent:true});
      const state=__GH_STATE__,hr=GH_HR_CORE.ensure(state),cohort=hr.employmentContracts.find(row=>row.mobilityDriverCohort===true&&row.status==='ساري');
      hr.employmentContracts=hr.employmentContracts.filter(row=>row!==cohort);
      for(const [index,vehicle] of state.mobility.vehicles.entries()){
        const legacy={...cohort,id:`QA-LEGACY-EMP-${index}`,assetId:vehicle.id,count:1};delete legacy.mobilityDriverCohort;
        hr.employmentContracts.push(legacy);delete vehicle.staffing.employmentContractId;
      }
      delete state.mobility.driverLedgerVersion;state.speed=4;
      if(await a.saveNow()!==true)throw new Error('legacy fixture save failed');
      return {economy:JSON.stringify({cash:state.cash,companyFinance:state.companyFinance,finance:state.finance}),drivers:state.mobility.drivers.map(row=>row.id)};
    });
    ({page}=await reboot(page,{browser,errors,found:false,viewport:{width:956,height:440}}));
    const loaded=await page.evaluate(async()=>{
      const s=__GH_STATE__,a=__AUDIT__,speed=s.speed;a.setSpeed(0);await GH_PERSISTENCE.drain();
      const contracts=s.advanced.labor.employmentContracts.filter(row=>row.mobilityDriverCohort===true&&row.status==='ساري');
      return {speed,version:s.mobility.driverLedgerVersion,count:contracts.length,drivers:contracts[0]?.count,salary:contracts[0]?.salary,id:contracts[0]?.id,links:s.mobility.vehicles.every(row=>row.staffing?.employmentContractId===contracts[0]?.id),driverIds:s.mobility.drivers.map(row=>row.id),economy:JSON.stringify({cash:s.cash,companyFinance:s.companyFinance,finance:s.finance})};
    });
    assert.equal(loaded.speed,3,'a saved 600x choice becomes the supported 300x level');
    assert.equal(loaded.version,1);assert.equal(loaded.count,1);assert.equal(loaded.drivers,2);assert.equal(loaded.salary,6000);assert.equal(loaded.links,true);
    assert.deepEqual(loaded.driverIds,before.drivers);assert.equal(loaded.economy,before.economy,'load migration changes no money or finance document');
    ({page}=await reboot(page,{browser,errors,found:false,viewport:{width:956,height:440}}));
    const again=await page.evaluate(()=>{const s=__GH_STATE__,contracts=s.advanced.labor.employmentContracts.filter(row=>row.mobilityDriverCohort===true&&row.status==='ساري');return {count:contracts.length,id:contracts[0]?.id,drivers:contracts[0]?.count,version:s.mobility.driverLedgerVersion};});
    assert.deepEqual(again,{count:1,id:loaded.id,drivers:2,version:1},'a second reload neither repeats migration nor changes the shared contract identity');
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({suite:'build403-legacy-runtime-migration-browser',engine:engine.name(),legacySpeed:4,loadedSpeed:loaded.speed,activeDriverContracts:loaded.count,drivers:loaded.drivers,reloadIdempotent:true,economyUnchanged:true}));
  }finally{await browser.close();}
}})().catch(error=>{console.error(error);process.exitCode=1;});
