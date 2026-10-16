'use strict';
const assert=require('node:assert/strict'),{customerCreditFixture}=require('./helpers/customer-credit-fixture.cjs');
const e=customerCreditFixture(),{s,state}=e;for(const name of ['customer-companies-core','customer-base-core','dealer-market-core'])e.load(name);
state.customHubs.push({id:'FIRST-STOCK-QA',ownerCompanyId:'dealership',company:'dealership',kind:'dealership-branch',owned:true,city:'الرياض',country:'السعودية',name:'QA Showroom',dailyCost:6800});
function day(target,value,scope=s){target.simSeconds=value*86400;const g=scope.GH_CUSTOMER_COMPANIES_CORE.onFinancialDayStages({state:target,companyId:'dealership'},{day:value});while(!g.next().done){}return target.customerCompanies.companies.dealership.market.dailyHistory[0];}
const first=day(state,0),data=state.customerCompanies.companies.dealership,inventory=data.inventory,available=inventory.reduce((n,row)=>n+row.quantity-row.reserved,0);
assert.equal(first.restockOrders,6);assert.ok(first.restockUnits>0&&available>0);assert.ok(first.carsSold>0,'newly bought cars can sell in the same close');assert.equal(first.lostSales,0,'fresh stock is visible to the actual sales loop');assert.equal(inventory.reduce((n,row)=>n+row.quantity+row.sold,0),data.purchases.reduce((n,row)=>n+row.quantity,0),'stock and deliveries conserve regular restocks and any additional financed-order purchase');
assert.equal(first.recognizedSales,first.salesRevenue);assert.ok(first.recognizedCost>0);assert.equal(s.GH_DEALER_MARKET.dailyResult(state,0).revenue,first.recognizedSales+first.revenue,'same-day sales reach the company P&L');
const snapshot=JSON.stringify(state);day(state,0);assert.equal(JSON.stringify(state),snapshot,'replaying the close neither buys nor sells twice');
const restored=JSON.parse(snapshot);day(state,1);day(restored,1);assert.equal(JSON.stringify(restored.customerCompanies.companies.dealership),JSON.stringify(state.customerCompanies.companies.dealership),'reload preserves stock and subsequent sales');
// Starting without cash still cannot invent stock or paid deliveries.
const poor=customerCreditFixture();for(const name of ['customer-companies-core','customer-base-core','dealer-market-core'])poor.load(name);poor.state.customHubs.push({...state.customHubs.find(row=>row.id==='FIRST-STOCK-QA')});poor.state.godMoney=false;poor.state.infiniteMoney=false;poor.F.book(poor.state,'dealership').accounts[0].balance=0;
const none=day(poor.state,0,poor.s);assert.equal(none.restockUnits,0);assert.equal(none.carsSold,0);assert.ok(none.lostSales>0);assert.equal(poor.F.operating(poor.state,'dealership'),0);
console.log(JSON.stringify({suite:'build385-dealer-first-stock',ok:true,firstDay:{received:first.restockUnits,sold:first.carsSold,lost:first.lostSales,available},replayAndReload:true,noCashGuard:true}));
