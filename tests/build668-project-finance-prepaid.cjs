'use strict';
// Build 668, found by a review and reproduced with the game's own commands: the energy company keeps its own balance of a
// project's financing beside the finance ledger. The player may repay that debt from the finance debt page («سداد هذا
// الدين», or the company's «سداد الدين»); the repayment reached the ledger and not the energy company's balance, which went
// on charging interest and instalments on a debt already paid: a plant repaid in full was invoiced a month's interest
// (668,254.61) a month later, shown overdue, and its arrears grew every day.
// The facility now follows the ledger when the ledger is lower; a principal repaid in full is invoiced its interest to
// that day at once and the facility closes when no interest is left to pay. Checked here with real commands:
//   1. control: with no early repayment the facility and the ledger agree at every close, and the month's interest is
//      invoiced as before;
//   2. the whole principal repaid from the debt page: at the next close the facility is closed, the interest accrued to
//      that day is invoiced and paid once, and seventy more closes invoice nothing and leave no arrears;
//   3. a part repaid (one debt, then the company's general repayment): the facility follows the ledger, the next day's
//      interest is on the lower balance, the instalments go on and the month's invoice is smaller than the control's;
//   4. the whole principal repaid with an interest invoice already open and no cash for it: the facility stays open for
//      its interest only, both invoices are paid once when the cash returns (by the owner, or by the autopilot), and then
//      it closes;
//   5. (review) all but a little repaid (1,000; 40,000): the facility's own instalments clear the rest, and the interest
//      accrued to that day is invoiced then, not dropped with the facility's close; the day's report carries it;
//   6. (review, a defect older than this fix) a plant financed while it is being built: its financing follows the ledger
//      there too (a part, the whole); once commissioned the closes go on and its first interest is invoiced once, a month
//      after commissioning (the due day stayed null, read as day 0, and the close failed for good two days after
//      commissioning); a save that defect reached (a due day before the first month) takes the next free month;
//   7. (review) a save the divergence had already reached: the interest the facility accrued on the repaid principal
//      after its repayment day is not invoiced; and a ledger above the facility is not followed.
process.env.GH_TEST_SOURCE_DIR=process.env.GH_TEST_SOURCE_DIR||require('node:path').resolve(__dirname,'..');
const assert=require('node:assert/strict');
const {harness,minimal}=require('./helpers/core-harness');
const DAY=86400,cents=value=>Math.round(Number(value)*100)/100;
const MODULES=['capability-registry-core','company-definitions','company-platform-core','identity-system','control-plane-core','authorization-core','document-proof-core','transaction-core','domain-command-core','save-schema','determinism-core','event-ledger-core','dependency-core','policy-core','lifecycle-core','delivery-monitor-core','realism-core','finance-core','branch-campaign-core','hr-core','corporate-core','facility-core','business-world-core','banking-core','insurance-core','energy-core','realestate-core','economics-core','game-lifecycle-core','company-adapters-core','company-autopilot-core','strategy-core','conference-core','operations-core','advanced-core'];
// One commissioned gas plant financed through the real finance-project command (the fixture of tests/build665).
function plant(options={}){
  const {s}=harness(MODULES),data={...minimal(),profile:{name:'Plant Prepaid'},bank:{},operations:{},crew:[],branches:[],hired:[],unlockedSectors:[],ownedCompanies:[]},state=s.GH_GAME_LIFECYCLE.pristine(data,1);
  s.GH_GAME_LIFECYCLE.foundGroup(state,{mode:'sandbox',name:'Plant Group',founder:'Founder',locationId:'RUH'},data,{nextId:()=>'FOUND-PP',simYear:()=>2026});s.GH_ADVANCED.migrate(state);
  const D=s.GH_DOMAIN_COMMANDS,F=s.GH_FINANCE_CORE,P=s.GH_COMPANY_AUTOPILOT,TX=s.GH_TRANSACTION_CORE,Schema=s.GH_SAVE_SCHEMA;
  const player=(domain,name,payload)=>D.dispatch({state},domain,name,payload).result,system=(domain,name,payload,actor)=>D.dispatchSystem({state},domain,name,payload,{actor}).result;
  player('corporate','open-company',{type:'power',capital:400000000,legalName:'Plant Power'});
  // The plant itself is the one hand-made row (as tests/build545 makes it): building one takes 180 game days of set-up.
  state.customHubs.push({id:'PWR-GAS-PP',name:'Gas PP',city:'الرياض',country:'السعودية',kind:'power',company:'power',ownerCompanyId:'power',owned:true,energyKind:'gas',capacityAmount:100,capacity:'100 MW',commissioned:options.commissioned!==false,openedAt:0,dailyCost:38000,cost:200000000});
  state.simSeconds=100*DAY;s.GH_REALISM.migrate(state).economy.gas=50;s.GH_REALISM.migrate(state).economy.baseRate=.05;state.profile.creditRating='BBB';
  const site=s.GH_ENERGY_CORE.ensure(state).sites.find(row=>row.facilityId==='PWR-GAS-PP');if(options.commissioned!==false)site.commissionedDay=0;
  const financed=player('energy','finance-project',{siteId:site.id,amount:100000000}),facility=()=>state.energy.projectFinance.find(row=>row.id===financed.id);
  const ledger=()=>F.debtOutstanding(state,financed.id),cash=()=>F.operating(state,'power');
  // The daily close's owner loop (advanced-core), in one transaction as app.js runs it: a failure rolls the day back.
  const dayClose=day=>{const out=TX.execute(state,{label:`day-close:${day}`,apply(){state.simSeconds=day*DAY;const stages=s.GH_ADVANCED.onFinancialDayStages(state,day);let step;while(!(step=stages.next()).done){}return step.value;}});assert.equal(out.committed,true,`day ${day}: ${out.reason}`);return out;};
  const tick=day=>{state.simSeconds=day*DAY;return system('energy','tick-day',{day,ownerCompanyId:'power'},'simulation-scheduler');};
  // Commissioning as energy-core commissionNow marks the plant (building one takes 180 game days of set-up).
  const commission=()=>{const hub=state.customHubs.find(row=>row.id==='PWR-GAS-PP');hub.commissioned=true;hub.status='تشغيل تجاري';s.GH_ENERGY_CORE.ensure(state);return Number(state.energy.sites.find(row=>row.id===site.id).commissionedDay);};
  const autopilot=()=>{const step=P.next(state,'payables',{tried:new Set(),F});return step?Array.from(step.commands,command=>({command,result:system(command.domain,command.name,command.payload,P.ACTOR)})):[];};
  const invoices=()=>Array.from(state.finance.invoices).filter(row=>String(row.number).startsWith('PFINT-')).map(row=>({number:row.number,status:row.status,total:cents(row.total)})).sort((a,b)=>a.number.localeCompare(b.number));
  const openPayables=()=>Array.from(state.finance.payables).filter(row=>String(row.number).startsWith('PFINT-')).map(row=>row.number);
  // The two buttons of the finance debt page (app.js .repay-debt-record and .repay-debt).
  const repayRecord=amount=>player('finance','repay-debt',{company:'power',debtId:financed.id,amount,note:`سداد ${financed.id}`}),repayCompany=amount=>player('finance','repay-debt',{company:'power',amount,note:'سداد أصل دين'});
  const base=Array.from(Schema.validate(state).errors),valid=label=>assert.deepEqual(Array.from(Schema.validate(state).errors),base,`${label}: the save schema finds nothing new`);
  return {s,state,F,player,facility,ledger,cash,dayClose,tick,commission,autopilot,invoices,openPayables,repayRecord,repayCompany,valid,site:()=>state.energy.sites.find(row=>row.id===site.id),due:Number(facility().nextInterestDueDay),id:financed.id,started:facility()};
}
const agree=(world,label)=>assert.equal(cents(world.facility().outstanding),cents(world.ledger()),`${label}: the facility and the ledger agree`);

// 1. Control: no early repayment.
const control=plant(),FIRST=101,REPAY=control.due+12,LAST=REPAY+70;
assert.ok(control.due>FIRST+5,'the first interest is due some days after the financing');
for(let day=FIRST;day<=control.due+31;day++){control.dayClose(day);agree(control,`control day ${day}`);assert.equal(control.facility().status,'ساري',`control day ${day}: in good standing`);}
const controlInvoices=control.invoices();
assert.equal(controlInvoices.length,2,'control: one interest invoice a month');assert.ok(controlInvoices.every(row=>row.status==='مسددة'),'control: each paid');
assert.ok(control.facility().outstanding>90000000,'control: the principal is still owed');
console.log(`1 ok: control, ${controlInvoices.length} monthly interest invoices (${controlInvoices.map(row=>row.total).join(', ')}); the facility and the ledger agree at every close`);

// 2. The whole principal repaid from the debt page, twelve days into the second month.
{const world=plant();for(let day=FIRST;day<=REPAY;day++)world.dayClose(day);
  const before=world.facility(),accrued=before.operatingInterestAccrued,owed=world.ledger(),firstInvoice=world.invoices();
  assert.equal(firstInvoice.length,1,'2: the first month was invoiced');assert.deepEqual(firstInvoice,[controlInvoices[0]],'2: as in the control');assert.ok(accrued>100000&&!before.interestInvoiceNumber,'2: twelve days of interest are accrued, none invoiced');
  const repaid=world.repayRecord(owed);assert.equal(cents(repaid.amount),cents(owed),'2: the debt page repaid the whole principal');assert.ok(world.ledger()<=.01,'2: the ledger shows no principal');
  world.dayClose(REPAY+1);const after=world.facility(),invoices=world.invoices();
  assert.deepEqual({status:after.status,outstanding:after.outstanding,arrears:after.principalArrears,accrued:after.operatingInterestAccrued,open:after.interestInvoiceNumber,repaidDay:after.repaidDay},{status:'مسدد',outstanding:0,arrears:0,accrued:0,open:null,repaidDay:REPAY+1},'2: the facility is closed at the next close');
  assert.equal(invoices.length,2,'2: one last interest invoice');assert.deepEqual({status:invoices[1].status,total:invoices[1].total},{status:'مسددة',total:cents(accrued)},'2: for the interest accrued to the repayment, paid');
  assert.ok(invoices[1].total<controlInvoices[1].total/2,'2: less than half of the control\'s second month');
  for(let day=REPAY+2;day<=LAST;day++)world.dayClose(day);const end=world.facility();
  assert.deepEqual(world.invoices(),invoices,'2: seventy more closes invoice no interest');assert.deepEqual(world.openPayables(),[],'2: and leave no interest payable');
  assert.deepEqual({status:end.status,outstanding:end.outstanding,arrears:end.principalArrears,accrued:end.operatingInterestAccrued,repaidDay:end.repaidDay},{status:'مسدد',outstanding:0,arrears:0,accrued:0,repaidDay:REPAY+1},'2: the facility stays closed, with no arrears');
  assert.equal(world.site().debtOutstanding,0,'2: the plant shows no debt');assert.ok(world.F.book(world.state,'power').debt<=.01,'2: the company owes nothing');world.valid('2: the state');
  console.log(`2 ok: repaid in full on day ${REPAY}: closed at the next close, last interest ${invoices[1].total} paid once, nothing after`);}

// 3. A part repaid: 40% of this debt, then 10 million through the company's general repayment.
{const world=plant();for(let day=FIRST;day<=REPAY;day++)world.dayClose(day);
  const owed=world.ledger(),part=cents(owed*.4);assert.equal(cents(world.repayRecord(part).amount),part,'3: the debt page repaid a part');assert.equal(cents(world.repayCompany(10000000).amount),10000000,'3: and the company repaid ten million');
  const expected=owed-part-10000000;assert.equal(cents(world.ledger()),cents(expected),'3: the ledger is lower by both');assert.ok(world.facility().outstanding>expected+1,'3: the facility has not followed yet');
  const accruedBefore=world.facility().operatingInterestAccrued;world.dayClose(REPAY+1);agree(world,'3: at the next close');
  const first=world.facility(),instalment=expected-first.outstanding;assert.ok(instalment>0&&instalment<expected/1000,'3: that close paid one instalment');
  assert.ok(Math.abs(first.operatingInterestAccrued-accruedBefore-expected*first.rate/365)<.01,'3: the day\'s interest is on the lower balance');
  for(let day=REPAY+2;day<=control.due+31;day++){world.dayClose(day);agree(world,`3: day ${day}`);assert.deepEqual({status:world.facility().status,arrears:world.facility().principalArrears},{status:'ساري',arrears:0},`3: day ${day}: in good standing`);}
  const invoices=world.invoices();assert.equal(invoices.length,2,'3: the month is invoiced on its day');assert.equal(invoices[1].status,'مسددة','3: and paid');
  assert.ok(invoices[1].total<controlInvoices[1].total*.85&&invoices[1].total>controlInvoices[1].total*.5,`3: less interest than the control (${invoices[1].total} against ${controlInvoices[1].total}), more than half of it`);
  assert.ok(world.facility().outstanding>40000000,'3: the rest of the principal is still owed and served');world.valid('3: the state');
  console.log(`3 ok: half repaid in two ways: the facility follows the ledger, the month's interest is ${invoices[1].total} (control ${controlInvoices[1].total})`);}

// 4. Repaid in full with an interest invoice already open and no cash for it.
for(const payer of ['owner','autopilot']){const world=plant();for(let day=FIRST;day<world.due;day++)world.dayClose(day);
  // The month's invoice is issued on its day to a company that cannot pay it: the holding lends the principal's repayment only.
  const drain=()=>{const spare=cents(world.cash()-1000);if(spare>0)world.player('finance','transfer',{from:'power',to:'group',amount:spare,note:'cash to the holding'});};drain();world.dayClose(world.due);
  const open=world.facility().interestInvoiceNumber,openAmount=world.facility().interestInvoiceAmount;assert.ok(open&&openAmount>0&&world.openPayables().includes(open),`4 ${payer}: the month's invoice is open`);
  for(let day=world.due+1;day<=world.due+5;day++){drain();world.dayClose(day);}
  assert.equal(world.facility().interestInvoiceNumber,open,`4 ${payer}: still open five days later`);
  const owed=world.ledger();world.player('finance','transfer',{from:'group',to:'power',amount:cents(owed-world.cash()+500),note:'for the principal'});assert.equal(cents(world.repayRecord(owed).amount),cents(owed),`4 ${payer}: the principal is repaid in full`);
  const residual=world.facility().operatingInterestAccrued-openAmount;assert.ok(residual>50000,`4 ${payer}: five more days of interest are accrued beside the open invoice`);
  world.dayClose(world.due+6);let now=world.facility();
  assert.deepEqual({status:now.status,outstanding:now.outstanding,arrears:now.principalArrears,open:now.interestInvoiceNumber,repaidDay:now.repaidDay??null},{status:'ساري',outstanding:0,arrears:0,open,repaidDay:null},`4 ${payer}: open for its interest only`);
  assert.ok(Math.abs(now.operatingInterestAccrued-openAmount-residual)<.01,`4 ${payer}: no interest is added on a repaid principal`);
  world.dayClose(world.due+7);assert.ok(Math.abs(world.facility().operatingInterestAccrued-openAmount-residual)<.01,`4 ${payer}: nor the day after`);assert.equal(world.invoices().length,1,`4 ${payer}: no second invoice while the first is open`);
  world.player('finance','transfer',{from:'group',to:'power',amount:5000000,note:'cash returns'});
  if(payer==='autopilot'){const paid=world.autopilot();assert.ok(paid.some(row=>row.command.name==='settle-payable'&&row.command.payload.number===open),'4 autopilot: the autopilot pays the open invoice');}
  world.dayClose(world.due+8);now=world.facility();
  const invoices=world.invoices();assert.equal(invoices.length,2,`4 ${payer}: the open invoice and one last invoice`);assert.deepEqual(invoices.map(row=>row.status),['مسددة','مسددة'],`4 ${payer}: both paid`);
  assert.deepEqual([invoices[0].total,invoices[1].total],[cents(openAmount),cents(residual)],`4 ${payer}: the month, then the interest to the repayment`);
  assert.deepEqual({status:now.status,outstanding:now.outstanding,accrued:now.operatingInterestAccrued,open:now.interestInvoiceNumber},{status:'مسدد',outstanding:0,accrued:0,open:null},`4 ${payer}: then the facility closes`);
  for(let day=world.due+9;day<=world.due+45;day++)world.dayClose(day);assert.deepEqual(world.invoices(),invoices,`4 ${payer}: nothing is invoiced after`);assert.deepEqual(world.openPayables(),[],`4 ${payer}: no interest payable is left`);world.valid(`4 ${payer}: the state`);}
console.log('4 ok: repaid with an interest invoice open and no cash: open for its interest only, each invoice paid once (owner, autopilot), then closed');

// 5. All but a little repaid: the facility's own instalments clear the rest.
for(const rest of [1000,40000]){const world=plant();for(let day=FIRST;day<=REPAY;day++)world.dayClose(day);
  const accrued=world.facility().operatingInterestAccrued,owed=world.ledger(),rate=world.facility().rate;assert.equal(cents(world.repayRecord(owed-rest).amount),cents(owed-rest),`5 ${rest}: all but ${rest} is repaid`);
  const cashBefore=world.cash();let closed=null;for(let day=REPAY+1;day<=REPAY+3&&closed===null;day++){world.dayClose(day);agree(world,`5 ${rest}: day ${day}`);if(world.facility().status==='مسدد')closed=day;}
  assert.ok(closed!==null,`5 ${rest}: the instalments clear the rest within three closes`);assert.equal(closed,rest<27000?REPAY+1:REPAY+2,`5 ${rest}: at the instalment that reaches it`);
  const now=world.facility(),invoices=world.invoices();assert.deepEqual({outstanding:now.outstanding,arrears:now.principalArrears,accrued:now.operatingInterestAccrued,open:now.interestInvoiceNumber,repaidDay:now.repaidDay},{outstanding:0,arrears:0,accrued:0,open:null,repaidDay:closed},`5 ${rest}: the facility is closed`);
  assert.ok(world.ledger()<=.01&&world.F.book(world.state,'power').debt<=.01,`5 ${rest}: the rest of the principal was paid, not waived`);
  assert.equal(invoices.length,2,`5 ${rest}: the interest to that day is invoiced, not dropped`);assert.equal(invoices[1].status,'مسددة');
  assert.ok(invoices[1].total>=cents(accrued)&&invoices[1].total<=cents(accrued+rest*rate/365*3+.02),`5 ${rest}: what was accrued at the repayment and the rest's few days (${invoices[1].total} for ${cents(accrued)})`);
  for(let day=closed+1;day<=closed+40;day++)world.dayClose(day);assert.deepEqual(world.invoices(),invoices,`5 ${rest}: nothing is invoiced after`);assert.deepEqual(world.openPayables(),[]);world.valid(`5 ${rest}: the state`);}
{const world=plant();for(let day=FIRST;day<=REPAY;day++)world.dayClose(day);const accrued=world.facility().operatingInterestAccrued;world.repayRecord(world.ledger());
  const report=world.tick(REPAY+1);assert.equal(cents(report.postCommissionInterestPaid),cents(accrued),'5: the day\'s report carries the last interest paid');assert.equal(cents(report.debtPrincipalPaid),0,'5: and no principal');assert.equal(world.facility().status,'مسدد');
  const history=Array.from(world.state.energy.dailyHistory).find(row=>row.day===REPAY+1);assert.deepEqual({interest:cents(history.debtInterest),principal:cents(history.debtPrincipal)},{interest:0,principal:0},'5: the day\'s economics read the repaid balance: no debt service is booked');}
console.log('5 ok: all but 1,000 or 40,000 repaid: the instalments clear the rest and the interest to that day is invoiced');

// 6. A plant financed while it is being built.
{const world=plant({commissioned:false});assert.deepEqual({due:world.started.nextInterestDueDay,repayment:world.started.repaymentStartDay},{due:null,repayment:null},'6: under construction no interest is due and no principal');
  for(let day=FIRST;day<=110;day++){world.dayClose(day);agree(world,`6: day ${day}`);}const built=world.facility();assert.ok(built.capitalizedInterest>100000&&built.outstanding>100000000,'6: its interest is capitalised');
  assert.equal(cents(world.repayRecord(40000000).amount),40000000,'6: a part is repaid from the debt page');const lower=world.ledger(),capitalised=built.capitalizedInterest;world.dayClose(111);agree(world,'6: at the next close');
  assert.ok(Math.abs(world.facility().capitalizedInterest-capitalised-lower*(Math.pow(1+built.rate/365,1)-1))<.01,'6: the day\'s interest is capitalised on the lower balance');
  const commissioned=world.commission();assert.ok(commissioned>=110&&commissioned<=112,`6: commissioned on day ${commissioned}`);
  for(let day=112;day<=commissioned+29;day++){world.dayClose(day);agree(world,`6: day ${day}`);}assert.deepEqual(world.invoices(),[],'6: no interest is invoiced in the first month');assert.equal(world.facility().nextInterestDueDay,commissioned+30,'6: the first interest is due a month after commissioning');
  for(let day=commissioned+30;day<=commissioned+45;day++){world.dayClose(day);agree(world,`6: day ${day}`);}const invoices=world.invoices();
  assert.deepEqual(invoices.map(row=>[row.number,row.status]),[[`PFINT-${world.id}-1`,'مسددة']],'6: one invoice for the first month, paid');{const month=world.facility().outstanding*world.facility().rate/365*30;assert.ok(invoices[0].total>month*.97&&invoices[0].total<month*1.05,`6: thirty days of interest on the lower balance (${invoices[0].total} for about ${cents(month)})`);}
  assert.equal(world.facility().nextInterestDueDay,commissioned+60);assert.equal(world.facility().status,'ساري');world.valid('6: commissioned');
  // A save the defect reached: the due day it left (30) is before the plant's first month; the first month's number is taken.
  world.facility().nextInterestDueDay=30;for(let day=commissioned+46;day<=commissioned+59;day++)world.dayClose(day);assert.equal(world.facility().nextInterestDueDay,commissioned+60,'6: a due day before the first month moves to the next free month');assert.equal(world.invoices().length,1,'6: and nothing is invoiced before it');
  for(let day=commissioned+60;day<=commissioned+62;day++)world.dayClose(day);assert.deepEqual(world.invoices().map(row=>[row.number,row.status]),[[`PFINT-${world.id}-1`,'مسددة'],[`PFINT-${world.id}-2`,'مسددة']],'6: the second month is invoiced once, under its own number');world.valid('6: repaired');}
{const world=plant({commissioned:false});for(let day=FIRST;day<=105;day++)world.dayClose(day);const owed=world.ledger();world.player('finance','transfer',{from:'group',to:'power',amount:cents(Math.max(1,owed-world.cash()+1000)),note:'for the principal'});
  assert.equal(cents(world.repayRecord(owed).amount),cents(owed),'6: the whole is repaid while building');world.dayClose(106);const closed=world.facility(),capitalised=closed.capitalizedInterest;
  assert.deepEqual({status:closed.status,outstanding:closed.outstanding,repaidDay:closed.repaidDay},{status:'مسدد',outstanding:0,repaidDay:106},'6: the facility is closed at the next close');for(let day=107;day<=112;day++)world.dayClose(day);
  assert.equal(world.facility().capitalizedInterest,capitalised,'6: no interest is capitalised after');assert.equal(world.site().debtOutstanding,0);assert.ok(world.F.book(world.state,'power').debt<=.01);world.valid('6: repaid while building');}
// The save that defect reached two days after commissioning: the first day's interest was invoiced as month 1 and paid, and
// the due day was left at 30. Month 1's number is taken: the next free month is the second.
{const world=plant({commissioned:false});for(let day=FIRST;day<=105;day++)world.dayClose(day);const commissioned=world.commission();world.dayClose(commissioned+1);
  const number=`PFINT-${world.id}-1`;world.s.GH_DOMAIN_COMMANDS.dispatchSystem({state:world.state},'finance','issue-invoice',{number,kind:'مصروف',company:'power',amount:22516.28,status:'مستحقة',taxable:false,method:'فائدة تمويل مشروع طاقة',counterparty:world.facility().lender,note:`فائدة تشغيل بعد تشغيل المشروع · ${world.id} · فترة 1`,dueDay:commissioned+1,sourceRef:`${world.id}:1`},{actor:'simulation-scheduler'});
  world.player('finance','settle-payable',{number,method:'transfer'});world.facility().nextInterestDueDay=30;
  for(let day=commissioned+2;day<=commissioned+62;day++)world.dayClose(day);assert.equal(world.facility().nextInterestDueDay,commissioned+90,'6: the reached save takes the second month, then the third');
  assert.deepEqual(world.invoices().map(row=>[row.number,row.status]),[[number,'مسددة'],[`PFINT-${world.id}-2`,'مسددة']],'6: its closes go on and the second month is invoiced under a free number');world.valid('6: the reached save');}
console.log('6 ok: financed while building: the ledger is followed, and once commissioned the first interest is invoiced once, a month later');

// 7. A save the divergence had already reached, and a ledger above the facility.
{const world=plant();for(let day=FIRST;day<=REPAY;day++)world.dayClose(day);const accrued=world.facility().operatingInterestAccrued;world.repayRecord(world.ledger());
  // Its shape ten days later under the old build: the facility went on accruing on the repaid principal, in arrears.
  const facility=world.facility(),days=10;facility.operatingInterestAccrued+=facility.outstanding*facility.rate/365*days;facility.lastOperatingInterestDay+=days;facility.principalArrears=273972.6;facility.status='متأخر';
  world.dayClose(REPAY+days+1);const invoices=world.invoices(),now=world.facility();assert.deepEqual({status:now.status,outstanding:now.outstanding,arrears:now.principalArrears,accrued:now.operatingInterestAccrued},{status:'مسدد',outstanding:0,arrears:0,accrued:0},'7: the facility is closed');
  assert.equal(invoices.length,2);assert.equal(invoices[1].total,cents(accrued),'7: only the interest owed at the repayment is invoiced');world.valid('7: the reached save');}
{const world=plant();for(let day=FIRST;day<=REPAY;day++)world.dayClose(day);const before=world.facility().outstanding;
  // The ledger moved up alone (the three writes of a capitalised interest, without the facility's own).
  world.F.adjustDebtOutstanding(world.state,world.id,5000,{at:world.state.simSeconds});world.F.book(world.state,'power').debt+=5000;world.dayClose(REPAY+1);
  const after=world.facility().outstanding;assert.ok(after<before&&before-after<30000,'7: the facility paid its instalment');assert.equal(cents(world.ledger()-after),5000,'7: and did not follow the ledger upward');}
// A ledger above the facility, and its own last instalment paid on a day its interest cannot be: the facility has no
// principal left by its own account and closes once its interest is paid; the ledger's rest is not its to waive.
{const world=plant(),due=world.due,drain=keep=>{const spare=cents(world.cash()-keep);if(spare>0)world.player('finance','transfer',{from:'power',to:'group',amount:spare,note:'cash to the holding'});},fund=amount=>world.player('finance','transfer',{from:'group',to:'power',amount,note:'funding'});
  for(let day=FIRST;day<=due-3;day++)world.dayClose(day);world.repayRecord(cents(world.ledger()-60000));world.dayClose(due-2);
  world.F.adjustDebtOutstanding(world.state,world.id,5000,{at:world.state.simSeconds});world.F.book(world.state,'power').debt+=5000;drain(28000);world.dayClose(due-1);
  drain(0);fund(6000);world.dayClose(due);let now=world.facility();assert.deepEqual({outstanding:now.outstanding,status:now.status,open:!!now.interestInvoiceNumber},{outstanding:0,status:'ساري',open:true},'7: the last instalment is paid and the month\'s interest is still owed');
  for(let day=due+1;day<=due+3;day++){drain(100);world.dayClose(day);}assert.equal(world.facility().status,'ساري','7: open for its interest while there is no cash');
  fund(5000000);world.dayClose(due+4);now=world.facility();assert.deepEqual({status:now.status,outstanding:now.outstanding,accrued:now.operatingInterestAccrued,open:now.interestInvoiceNumber,repaidDay:now.repaidDay},{status:'مسدد',outstanding:0,accrued:0,open:null,repaidDay:due+4},'7: it closes when its interest is paid');
  assert.equal(cents(world.ledger()),5000,'7: the ledger\'s rest is still owed');assert.equal(world.invoices().length,1);assert.equal(world.invoices()[0].status,'مسددة');}
console.log('7 ok: phantom interest of a reached save is not invoiced; a ledger above the facility is not followed');
console.log('build668 project finance prepaid: 7 checks passed');
