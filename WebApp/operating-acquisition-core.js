/* Existing businesses are bought once, through their signed domain owner. Quotes and receipts are aggregate
   records; no customer, policy, unit or fleet scan is added to the simulation loop. */
(()=>{'use strict';
const COMPANIES=Object.freeze(['realestate','power','insurance','bank']),LIMIT=128;
const VARIANTS=Object.freeze({realestate:['office','residential'],power:['solar','wind'],insurance:['motor','property'],bank:['branch']});
const num=x=>Math.max(0,Number(x)||0),day=s=>Math.floor(num(s.simSeconds)/86400);
const base=()=>globalThis.GH_CUSTOMER_BASE,F=()=>globalThis.GH_FINANCE_CORE;
function source(s,c){return c==='realestate'?s.realEstate?.offices||[]:c==='insurance'?s.insurance?.offices||[]:c==='bank'?s.bank?.branchNetwork||[]:s.customHubs||[];}
function available(s,c,row){if(!row)return false;if(c==='power')return row.owned===true&&row.kind==='power'&&String(row.ownerCompanyId||row.companyId||row.company||'')==='power';return c==='bank'?row.servicesActive!==false:row.active===true;}
function targets(s,c,page=0){if(!COMPANIES.includes(c))return [];const start=Math.max(0,Math.floor(num(page)))*24;return source(s,c).slice(start,start+24).filter(row=>available(s,c,row));}
function registry(s){return s.finance?.operatingAcquisitions||{};}
function receipts(s,c,page=0){const start=Math.max(0,Math.floor(num(page)))*24;return Object.values(registry(s)).filter(row=>row.company===c).slice(start,start+24);}
function receiptId(c,target,variant){return `OA:${c}:${target}:${variant}`;}
function quote(s,c,targetId,variant){
 if(!COMPANIES.includes(c)||!VARIANTS[c].includes(variant))throw new Error('operating-offer-invalid');
 const platform=globalThis.GH_COMPANY_PLATFORM;
 if(platform?.resolveCompany?.(s,c)?.operational!==true)throw new Error('operating-company-required');
 const target=source(s,c).find(row=>String(row.id)===String(targetId));if(!available(s,c,target))throw new Error('operating-location-required');
 const id=receiptId(c,target.id,variant),B=base(),factor=Number(B?.priceIndex?.(s))||1;
 const prior=registry(s)[id];if(prior?.offer)return {...prior.offer,owned:true};
 const q={id,company:c,targetId:String(target.id),variant,country:target.country||'',city:target.city||'',day:day(s),owned:Boolean(registry(s)[id]),price:0,annualRevenue:0,annualExpense:0,transferredCash:0,liabilities:0};
 if(c==='realestate'){
  const R=globalThis.GH_REALESTATE_CORE,local=R.cityFactor(q.country,s),v=R.projectQuote(variant,.5,1,local);
  q.units=v.units;q.leased=Math.floor(v.units*.8);q.localFactor=v.localFactor;q.landCost=v.land;q.buildCost=v.build;
  q.annualRevenue=q.leased*v.unitRent;
  // The existing property-fund model capitalises occupied rent at 7%, with vacant units at their construction cost.
  q.price=R.fundValue({type:variant,units:q.units,leased:q.leased,unitCost:v.total/q.units,localFactor:v.localFactor,marketAtStart:B.propertyValue(s),priceLevel:1},s);
  q.annualExpense=Math.round(q.price*R.PROPERTY_OPEX+q.price*(v.build/v.total)/(40));
  q.name=`${v.name} المؤجر · ${q.city}`;q.unitRent=v.unitRent;
 }else if(c==='power'){
  const E=globalThis.GH_ENERGY_CORE,p=E.KIND[variant],spot=num(s.advanced?.economy?.electricityPriceMWh||72);
  q.capacity=variant==='solar'?40:30;q.generation=q.capacity*24*365*p.factor*(1-p.forcedOutage)*.98;
  q.annualRevenue=Math.round(q.generation*(spot+num(s.advanced?.economy?.recPriceMWh||2.5)));
  q.annualExpense=Math.round(q.generation*p.variableCost);q.price=Math.max(100000,Math.round((q.annualRevenue-q.annualExpense)/.08));
  q.name=`محطة ${p.name} عاملة · ${q.city}`;
 }else if(c==='insurance'){
  const I=globalThis.GH_INSURANCE_CORE,line=I.LINES[variant],local=(Number(B?.incomeFactor?.(q.country,'insurancePrice'))||1)*factor;
  const market=I.officeMarket(s.insurance,{...target}),capacity=line.buyers==='business'?market.businesses:market.households;
  q.policies=Math.min(2000,Math.max(0,Math.floor((capacity-num(target.lines?.[variant]?.policies))*.15)));
  if(q.policies<1)throw new Error('operating-market-full');
  q.annualRevenue=Math.round(q.policies*I.linePrice(s.insurance,variant)*local);
  const loss=I.quote(s,variant).expectedLossRatio,share=num(s.insurance.reinsurance);
  q.annualExpense=Math.round(q.annualRevenue*(loss*(1-share)+I.COMMISSION+share-share*I.CEDING_COMMISSION));q.liabilities=Math.round(q.annualRevenue*loss*(1-share)*I.CLAIMS_LAG_BY_LINE[variant]/365);
  q.transferredCash=q.liabilities;q.price=Math.max(100000,Math.round(q.annualRevenue*1.5));q.name=`محفظة ${line.name} · ${q.city}`;
 }else{
  const K=globalThis.GH_BANKING_CORE,market=K.branchMarket(s.bank,{...target}),local=(Number(B?.incomeFactor?.(q.country,'bankDeposits'))||1)*factor;
  q.retail=Math.min(1000,Math.max(0,Math.floor((market.retailCapacity-num(target.retailCustomers))*.1)));
  q.business=Math.min(30,Math.max(0,Math.floor((market.businessCapacity-num(target.businessCustomers))*.1)));
  if(q.retail+q.business<1)throw new Error('operating-market-full');
  q.deposits=Math.round((q.retail*18000+q.business*360000)*local);q.loans=Math.round(q.deposits*.65);
  q.rate=K.loanRate(s,'corporate','BBB',q.country);q.liabilities=q.deposits;q.transferredCash=q.deposits-q.loans;
  q.price=Math.max(100000,Math.round(q.deposits*.04));q.annualRevenue=Math.round(q.loans*q.rate);
  const rates=K.depositRates(s,s.bank.depositPricing?.stance);q.annualExpense=Math.round(q.deposits*(rates.sight*.45+rates.savings*.35+rates.term*.2)+q.loans*K.RISK_GRADES.BBB.pd*K.RISK_GRADES.BBB.lgd);q.name=`أعمال فرع ${q.city} القائمة`;
 }
 q.netEstimate=q.annualRevenue-q.annualExpense;
 const digest=globalThis.GH_AUTHORIZATION?.digest;if(typeof digest!=='function')throw new Error('operating-quote-integrity-required');
 q.quoteKey=digest(JSON.stringify(q));return q;
}
function prepare(s,c){const core={realestate:globalThis.GH_REALESTATE_CORE,power:globalThis.GH_ENERGY_CORE,insurance:globalThis.GH_INSURANCE_CORE,bank:globalThis.GH_BANKING_CORE}[c];core.ensure(s);}
function acquire(s,c,p){
 if(c!=='bank')prepare(s,c);const q=quote(s,c,String(p.targetId||''),String(p.variant||'')),finance=F();
 const target=source(s,c).find(row=>String(row.id)===q.targetId),facilityId=c==='power'?target.id:target.facilityId;
 if(![...(s.customHubs||[]),...(s.globalBases||[])].some(row=>row.id===facilityId&&row.owned===true&&String(row.ownerCompanyId||row.companyId||row.company||'')===c))throw new Error('operating-location-required');
 if(q.owned)throw new Error('operating-already-owned');
 if(String(p.quoteKey||'')!==q.quoteKey)throw new Error('operating-quote-changed');
 if(Object.keys(registry(s)).length>=LIMIT)throw new Error('operating-acquisition-limit');
 if(c==='realestate'&&s.realEstate.projects.length>=globalThis.GH_REALESTATE_CORE.MAX_ACTIVE_PROJECTS)throw new Error('realestate-project-limit');
 if(c==='power'&&s.energy.sites.length>=128)throw new Error('operating-site-limit');
 if(c==='bank'&&!(globalThis.GH_FINANCE_CORE?.investorMode?.(s))&&!globalThis.GH_BANKING_CORE.operatingAcquisitionPreview(s,q).accepted)throw new Error('operating-bank-capital');
 if(c==='insurance'){
  const I=globalThis.GH_INSURANCE_CORE,ins=s.insurance,B=base(),priceIndex=Number(B.priceIndex(s))||1;
  const existing=ins.offices.reduce((sum,o)=>sum+I.LINE_IDS.reduce((a,line)=>a+num(o.lines?.[line]?.policies)*I.linePrice(ins,line)*(Number(B.incomeFactor(o.country,'insurancePrice'))||1)*priceIndex,0),0);
  if(!(globalThis.GH_FINANCE_CORE?.investorMode?.(s))&&finance.operating(s,c)-q.price<(existing+q.annualRevenue)*.2)throw new Error('operating-insurance-capital');
 }
 const payment=finance.execute({state:s},'pay-by-cheque',{company:c,amount:q.price,line:'capex',taxable:false,beneficiary:`بائع ${q.name}`,note:`استحواذ على ${q.name}`,requestRef:q.id});
 if(payment?.cheque?.status!=='مصروف')throw new Error('operating-cheque-not-cleared');
 if(payment.idempotent===true)throw new Error('operating-receipt-missing');
 const start=q.day;
 if(c==='realestate'){
  const re=s.realEstate,id=`RE-ACQ-${++re.sequence}`;
  re.projects.push({id,officeId:q.targetId,city:q.city,country:q.country,type:q.variant,name:q.name,mode:'lease',units:q.units,unitCost:q.price/q.units,localFactor:q.localFactor,marketAtStart:globalThis.GH_CUSTOMER_BASE.propertyValue(s),landCost:q.price*(q.landCost/(q.landCost+q.buildCost)),buildCost:q.price*(q.buildCost/(q.landCost+q.buildCost)),priceLevel:1,startDay:start,completeDay:start,status:'مكتمل',milestonesPaid:3,sold:0,presold:0,leased:q.leased,handedOver:0,salesRevenue:0,rentRevenue:0,cheques:[payment.cheque.id],leases:[{id:`LEASE-${id}`,tenant:'مستأجرو المبنى القائمون',units:q.leased,rentLevel:1,startDay:start,endDay:start+365,ended:false}],acquisitionId:q.id,acquisitionVacantUnitValue:(q.landCost+q.buildCost)/q.units});q.assetId=id;
 }else if(c==='power'){
  const e=s.energy,id=`SITE-ACQ-${++e.sequence}`,profile=globalThis.GH_ENERGY_CORE.KIND[q.variant];
  e.sites.push({id,facilityId:null,locationFacilityId:q.targetId,name:q.name,city:q.city,country:q.country,kind:q.variant,capacity:q.capacity,commissioned:true,status:'تشغيل تجاري',commissionedDay:start,availability:100,forcedOutageRate:profile.forcedOutage,degradationRate:profile.degradation,gridExportLimitMW:q.capacity,gridLossRate:.02,dispatchMode:'must-run',reserveMargin:0,maintenanceReservePerMW:profile.variableCost,capex:q.price,debtOutstanding:0,debtRate:0,debtTermDays:0,acquisitionId:q.id});q.assetId=id;
 }else if(c==='insurance'){
  const office=s.insurance.offices.find(row=>row.id===q.targetId);office.lines[q.variant].policies+=q.policies;
  s.insurance.claimsReserve.push({id:`RES-${q.id}`,day:start,line:q.variant,amount:q.liabilities,payDay:start+globalThis.GH_INSURANCE_CORE.CLAIMS_LAG_BY_LINE[q.variant]});q.assetId=office.id;
 }else{
  const b=s.bank,branch=b.branchNetwork.find(row=>row.id===q.targetId),id=`LOAN-ACQ-${++b.sequence}`,risk=globalThis.GH_BANKING_CORE.RISK_GRADES.BBB;
  branch.retailCustomers+=q.retail;branch.businessCustomers+=q.business;branch.deposits+=q.deposits;branch.loans+=q.loans;
  branch.depositMix.sight+=q.deposits*.45;branch.depositMix.savings+=q.deposits*.35;branch.depositMix.term+=q.deposits*.2;b.deposits+=q.deposits;b.loans+=q.loans;
  b.retailCustomers+=q.retail;b.businessCustomers+=q.business;
  b.loanPortfolios.push({id,branchId:branch.id,name:q.name,region:q.country,product:'corporate',sector:'commercial',principal:q.loans,outstanding:q.loans,rate:q.rate,termDays:1825,remainingDays:1825,pd:risk.pd,lgd:risk.lgd,stage:1,status:'نشطة',riskGrade:'BBB',daysPastDue:0,acquisitionId:q.id});q.assetId=id;
 }
 if(q.transferredCash){const account=finance.book(s,c).accounts[0];account.balance+=q.transferredCash;
  finance.journal(s,c,`نقل أرصدة ${q.name}`,c==='bank'?[{account:account.id,debit:q.transferredCash},{account:'محفظة القروض',debit:q.loans},{account:'ودائع العملاء',credit:q.deposits}]:[{account:account.id,debit:q.transferredCash},{account:'احتياطي مطالبات التأمين',credit:q.liabilities}],`BAL-${q.id}`);
 }
 finance.reconcile(s);
 if(c==='bank'){const K=globalThis.GH_BANKING_CORE;K.reconcilePrudential(s);if(!(globalThis.GH_FINANCE_CORE?.investorMode?.(s))&&(num(s.bank.cet1)<num(s.bank.riskPolicy.minCet1)||num(s.bank.lcr)<num(s.bank.riskPolicy.minLcr)||num(s.bank.nsfr)<num(s.bank.riskPolicy.minNsfr)||num(s.bank.loanDepositRatio)>num(s.bank.riskPolicy.maxLdr)||num(s.bank.leverageRatio)<3))throw new Error('operating-bank-capital');}
 const legal=finance.execute({state:s},'register-commercial-contract',{id:`LEGAL-${q.id}`,company:c,contractType:'عقد استحواذ على أعمال قائمة',counterparty:`بائع ${q.name}`,title:q.name,startDay:start,amount:q.price,terms:{assetId:q.assetId,targetId:q.targetId,variant:q.variant,transferredCash:q.transferredCash,liabilities:q.liabilities,quoteKey:q.quoteKey},sourceRefs:[q.assetId],linkedDocuments:[payment.invoice.number,payment.cheque.id]});
 const record={id:q.id,company:c,assetId:q.assetId,targetId:q.targetId,variant:q.variant,day:start,price:q.price,chequeId:payment.cheque.id,invoiceNumber:payment.invoice.number,legalDocumentId:legal.id,offer:{...q}};
 s.finance.operatingAcquisitions={...registry(s),[q.id]:record};return {...record,transferredCash:q.transferredCash,liabilities:q.liabilities};
}
function validRegistry(value){
 if(value==null)return true;if(typeof value!=='object'||Array.isArray(value))return false;let count=0;
 for(const id in value){if(!Object.prototype.hasOwnProperty.call(value,id))continue;if(++count>LIMIT)return false;
  const r=value[id],q=r?.offer;if(!r||!q||r.id!==id||!COMPANIES.includes(r.company)||!VARIANTS[r.company].includes(r.variant)||id!==receiptId(r.company,r.targetId,r.variant))return false;
  if(!Number.isFinite(r.price)||r.price<=0||!Number.isSafeInteger(r.day)||r.day<0||!r.chequeId||!r.invoiceNumber||!r.legalDocumentId||r.price!==q.price||r.assetId!==q.assetId||r.targetId!==q.targetId||r.variant!==q.variant||r.company!==q.company||!/^[a-f0-9]{64}$/i.test(q.quoteKey))return false;
  for(const field of ['annualRevenue','annualExpense','transferredCash','liabilities'])if(!Number.isFinite(q[field])||q[field]<0)return false;
 }
 return true;
}
globalThis.GH_OPERATING_ACQUISITIONS=Object.freeze({COMPANIES,VARIANTS,LIMIT,targets,source,quote,acquire,validRegistry,receipts});
})();
