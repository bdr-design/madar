'use strict';
// Build 688 (owner: «نفذ الاخف والامن»): with the save head freed of the Mobility cars (Build 685), the only bound left
// on the network was the centres' bays: 390,000 cars, measured on desktop at a 1.6 GB page, an 18.8 s save and a 102 s
// day. The network is held at a safe size (80,000 cars, under the 87,000 at which saves were refused before). Proven on
// the real recordFleetPurchase and the real interface functions lifted from the source:
//  1. a purchase that stays within the safe size reaches the payment; one that passes it is refused with the room left
//     (mobility-network-capacity:<left>/<cap>) before any payment, and no car is added;
//  2. a network already past the safe size (a save from before) keeps its cars; only a new purchase is refused;
//  3. the centre's own bays are still checked first;
//  4. the interface refuses before the spend question and explains the engine's refusal in Arabic, with the numbers.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),espree=require('espree');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const declarations=file=>{const source=fs.readFileSync(path.join(ROOT,'WebApp',file),'utf8'),ast=espree.parse(source,{ecmaVersion:'latest',range:true}),out=new Map();(function walk(node){if(!node||typeof node!=='object')return;if(node.type==='FunctionDeclaration'&&!out.has(node.id.name))out.set(node.id.name,source.slice(...node.range));for(const v of Object.values(node))if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')walk(v);})(ast);return {source,out};};
const mobility=declarations('mobility-core.js'),app=declarations('app.js');
const cap=Number((/const MAX_NETWORK_VEHICLES=(\d+);/.exec(mobility.source)||[])[1]);
assert.equal(cap,80000,'the safe size is 80,000 cars');
assert.match(mobility.source,/const API=\{VERSION,MAX_FLEET_PURCHASE_QUANTITY,MAX_NETWORK_VEHICLES,/,'the engine publishes the safe size');
function attempt({held,buy,bays=3000,inCentre=0}){
  const payments=[],m={ownerCompanyId:'mobility',vehicles:Array.from({length:held},(_,i)=>({id:`V${i}`,centerId:i<inCentre?'RUH':'JED'})),drivers:[],events:[]},state={mobility:m,customHubs:[{id:'MOB-RUH',kind:'mobility-center',owned:true,capitalId:'RUH',bays}]};
  const box={MAX_NETWORK_VEHICLES:cap,facilityOwnerCompanyId:()=> 'mobility',acquisitionCost:total=>total*1000,id:()=> 'REF',now:()=>0,GH_FINANCE_CORE:{execute(_ctx,_cmd,payment){payments.push(payment.amount);throw new Error('PAYMENT-REACHED');}}};box.globalThis=box;vm.createContext(box);
  vm.runInContext(mobility.out.get('recordFleetPurchase')+'\nglobalThis.run=recordFleetPurchase;',box);
  let error=null;try{box.run(state,m,buy,'note','RUH','الرياض',[],null);}catch(e){error=String(e.message);}
  return {error,payments,cars:m.vehicles.length};
}
// 1.
{const ok=attempt({held:cap-10,buy:10});assert.equal(ok.error,'PAYMENT-REACHED','1: a purchase to the safe size reaches the payment');assert.deepEqual(ok.payments,[10000]);}
{const no=attempt({held:cap-10,buy:11});assert.equal(no.error,`mobility-network-capacity:10/${cap}`,'1: one car past it is refused with the room left');assert.deepEqual(no.payments,[],'1: before any payment');assert.equal(no.cars,cap-10,'1: no car is added');}
{const full=attempt({held:cap,buy:1});assert.equal(full.error,`mobility-network-capacity:0/${cap}`);assert.deepEqual(full.payments,[]);}
// 2.
{const old=attempt({held:cap+5000,buy:1});assert.equal(old.error,`mobility-network-capacity:0/${cap}`,'2: a network past the safe size is refused a new car');assert.equal(old.cars,cap+5000,'2: and keeps the cars it holds');}
// 3.
{const centre=attempt({held:2000,buy:1500,bays:3000,inCentre:2000});assert.equal(centre.error,'mobility-center-capacity:1000/3000','3: the centre\'s bays are checked first');assert.deepEqual(centre.payments,[]);}
// 4. the interface
{
  const box={fmtNumber:n=>Number(n).toLocaleString('en-US')};vm.createContext(box);vm.runInContext(app.out.get('mobilityNetworkCapacityText')+'\nglobalThis.text=mobilityNetworkCapacityText;',box);
  assert.equal(box.text(10,cap),'لم يُنفَّذ الشراء ولم يُخصم أي مبلغ: الحد الآمن لشبكة التنقل 80,000 سيارة، والمتاح الآن 10 فقط.');
  assert.equal(box.text(0,cap),'لم يُنفَّذ الشراء ولم يُخصم أي مبلغ: بلغت شبكة التنقل حدها الآمن (80,000 سيارة) حفاظًا على سرعة اللعبة والحفظ.');
  const purchase=app.out.get('manualMobilityPurchaseFromCard'),pre=purchase.indexOf('MAX_NETWORK_VEHICLES'),question=purchase.indexOf('confirmLargeSpend');
  assert.ok(pre>0&&pre<question,'4: the safe size is checked before the spend question');
  assert.match(purchase,/if\(cap>0&&held\+quantity>cap\)\{notice\(mobilityNetworkCapacityText\(Math\.max\(0,cap-held\),cap\),'warning'\);return null;\}/);
  assert.match(purchase,/const network=\/\^mobility-network-capacity:\(\\d\+\)\\\/\(\\d\+\)\$\/\.exec\(String\(error\?\.message\|\|''\)\);if\(network\)\{notice\(mobilityNetworkCapacityText\(Number\(network\[1\]\),Number\(network\[2\]\)\),'warning'\);return null;\}/,'4: the engine\'s refusal is explained');
}
console.log('BUILD688_MOBILITY_NETWORK_SAFE_SIZE_PASS');
