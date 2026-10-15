'use strict';
const assert=require('node:assert/strict');
const {scenario}=require('./helpers/business-scenario');
const DAY=86400;
function setup(){
 const env=scenario();for(const module of ['banking-core','business-world-core','customer-companies-core','customer-base-core','dealer-market-core'])env.load(module);
 env.command('corporate','open-company',{type:'dealership',capital:200000000,legalName:'Test Dealer'});
 env.state.customHubs.push({id:'AUTO-QA',kind:'dealership-branch',ownerCompanyId:'dealership',owned:true,city:'الرياض',country:'السعودية',name:'QA showroom',coords:[24.7,46.7],dailyCost:6800});
 return {...env,C:env.s.GH_CUSTOMER_COMPANIES_CORE,M:env.s.GH_DEALER_MARKET,F:env.s.GH_FINANCE_CORE};
}
function drain(g){let row;do{row=g.next();}while(!row.done);return row.value;}

// A supplied vehicle's actual average cost is recognised once, without a second receipt or stock movement.
{
 const e=setup(),{state,C,F,M,command}=e;
 command('customer-companies','receive-stock',{modelId:'corolla',quantity:5,reference:'QA-RECEIVE'});
 const stock=state.customerCompanies.companies.dealership.inventory[0];stock.unitCost=19500.25;
 const input={saleId:'QA-SALE',customerName:'QA sale customer',modelId:'corolla',quantity:2,branchId:'AUTO-QA',termsDays:0};
 const first=command('customer-companies','retail-sale',input),after=F.operating(state,'dealership'),quantity=stock.quantity;
 assert.equal(first.costOfSales,39000.5);assert.equal(first.pnlRecognized,true);
 command('customer-companies','retail-sale',input);assert.equal(F.operating(state,'dealership'),after);assert.equal(stock.quantity,quantity);
 assert.equal(state.customerCompanies.companies.dealership.pendingSaleAccrual.revenue,44800);
 // Reload before the close: the three pending totals survive independently of the short sale-history list.
 const copy=JSON.parse(JSON.stringify(state));copy.simSeconds=DAY;
 drain(C.onFinancialDayStages({state:copy,companyId:'dealership'},{day:1}));
 const result=M.read(copy).dailyHistory[0];assert.equal(result.namedSales,44800);assert.equal(result.namedCost,39000.5);assert.equal(result.namedUnits,2);
 assert.equal(M.dailyResult(copy,1).revenue,result.revenue+result.recognizedSales+result.invoiced);
 assert.equal(copy.customerCompanies.companies.dealership.pendingSaleAccrual.revenue,0);
 assert.equal(F.operating(copy,'dealership'),after-result.restockSpend,'closing sale revenue never collects it again');
 const snapshot=JSON.stringify(M.read(copy));drain(C.onFinancialDayStages({state:copy,companyId:'dealership'},{day:1}));assert.equal(JSON.stringify(M.read(copy)),snapshot);
 copy.simSeconds=2*DAY;drain(C.onFinancialDayStages({state:copy,companyId:'dealership'},{day:2}));assert.equal(M.read(copy).dailyHistory[0].namedSales,0);
}

// A payment still retained by Finance cannot be used to receive the same stock twice after the short receipt expired.
{
 const {state,command,C,F}=setup();const input={modelId:'corolla',quantity:3,reference:'QA-OLD-RECEIPT'};
 command('customer-companies','receive-stock',input);const root=state.customerCompanies.companies.dealership;
 const cash=F.operating(state,'dealership'),stock=root.inventory[0].quantity;
 root.purchases=[];
 assert.throws(()=>command('customer-companies','receive-stock',input),/dealership-stock-receipt-missing/);
 assert.equal(F.operating(state,'dealership'),cash);assert.equal(state.customerCompanies.companies.dealership.inventory[0].quantity,stock);
 assert.throws(()=>C.dealerOps.addStockBatch(state,{oemId:'toyota',reference:'QA-DUPLICATE-SKU',lines:[{modelId:'corolla',quantity:2},{modelId:'corolla',quantity:2}]}),/dealership-stock-batch-invalid/);
}

// Capped completed history cannot evict an outstanding order and orphan its stock reservation.
{
 const {state,command}=setup();command('customer-companies','receive-stock',{modelId:'corolla',quantity:5,reference:'QA-RETENTION'});
 const root=state.customerCompanies.companies.dealership;
 root.sales=Array.from({length:499},(_,i)=>({id:'OLD-'+i,status:'sold-collected'}));
 root.sales.push({id:'OLD-PENDING',status:'awaiting-bank-decision',quantity:1,modelId:'corolla',oemId:'toyota'});root.inventory[0].reserved=1;
 command('customer-companies','retail-sale',{saleId:'QA-NEW-SALE',customerName:'QA retention customer',modelId:'corolla',quantity:1,branchId:'AUTO-QA',termsDays:0});
 assert.equal(root.sales.length,500);assert.ok(root.sales.some(row=>row.id==='OLD-PENDING'));assert.equal(root.inventory[0].reserved,1);
}

// Procurement forecasts use the existing demand factors, including the actual monthly competitor price.
{
 const normal=setup(),strong=setup();strong.state.realism.economy.airDemand=125;strong.state.realism.economy.seaDemand=125;strong.state.realism.economy.roadDemand=125;
 for(const e of [normal,strong]){e.state.simSeconds=DAY;drain(e.C.onFinancialDayStages({state:e.state,companyId:'dealership'},{day:1}));}
 assert.ok(strong.M.read(strong.state).dailyHistory[0].restockUnits>normal.M.read(normal.state).dailyHistory[0].restockUnits);
 assert.equal(strong.M.summary(strong.state).coverDays,45);assert.equal(strong.M.summary(strong.state).floorPlan,undefined);assert.equal(strong.M.read(strong.state).floorPlan,false);
}
console.log('DEALER_LEDGER_AND_STOCK_PASS');
