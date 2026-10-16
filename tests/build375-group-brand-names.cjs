'use strict';
// Build 375 (owner: the name typed at the start brands every company with its own business): the group «العساف» names
// each subsidiary «شركة العساف ...» with its activity, and a subsidiary keeps following the group until the player
// renames it. Telecom and the car dealership (Build 364) had no brand rule and stayed «جلوبال هولدينغز».
const assert=require('node:assert/strict'),path=require('node:path');
const web=path.resolve(__dirname,'../WebApp');
for(const file of ['capability-registry-core','company-definitions','company-platform-core'])require(path.join(web,`${file}.js`));
const P=globalThis.GH_COMPANY_PLATFORM;
const EXPECTED={
  air:['شركة العساف للطيران','العساف للطيران'],sea:['شركة العساف للشحن البحري','العساف للشحن البحري'],road:['شركة العساف للنقل','العساف للنقل'],
  mobility:['شركة العساف للتنقل الذكي','العساف للتنقل الذكي'],bank:['شركة العساف المصرفية','بنك العساف'],insurance:['شركة العساف للتأمين','العساف للتأمين'],
  realestate:['شركة العساف للتطوير العقاري','العساف للتطوير العقاري'],power:['شركة العساف للطاقة','العساف للطاقة'],
  telecom:['شركة العساف للاتصالات','العساف للاتصالات'],dealership:['شركة العساف لوكالات السيارات','العساف لوكالات السيارات'],hospitality:['شركة العساف للفنادق والمنتجعات','العساف للفنادق والمنتجعات']
};
const subsidiaries=P.listDefinitions().filter(row=>row.kind==='subsidiary'&&row.lifecycle==='active').map(row=>row.id);
assert.deepEqual([...subsidiaries].sort(),Object.keys(EXPECTED).sort(),'every active company is covered');
for(const name of ['العساف','شركة العساف القابضة','مجموعة العساف']){
  const state={profile:{name,shortName:'ASF',englishName:'Alassaf Holding'},companyRegistry:{}};
  for(const [id,[legal,trade]] of Object.entries(EXPECTED)){const branded=P.brandedIdentity(state,id);assert.ok(branded,`${id} follows the group`);assert.equal(branded.legalName,legal,`${name}: ${id}`);assert.equal(branded.tradeName,trade);assert.match(branded.shortName,/^ASF /);assert.match(branded.englishName,/^Alassaf /);}
}
// The stock group keeps the stock names; a company renamed by the player keeps its own name.
assert.equal(P.brandedIdentity({profile:{name:'المجموعة العالمية القابضة'},companyRegistry:{}},'telecom'),null);
const state={profile:{name:'العساف',shortName:'ASF'},companyRegistry:{telecom:{legalName:'شركة جلوبال هولدينغز للاتصالات'},dealership:{legalName:'وكالة الخليج',customName:true}}};
P.syncBrandedNames?.(state);
assert.equal(state.companyRegistry.telecom.legalName,'شركة العساف للاتصالات','a stock name follows the group');
assert.equal(state.companyRegistry.dealership.legalName,'وكالة الخليج','a name the player chose stays');
console.log('BUILD375_GROUP_BRAND_NAMES_PASS',JSON.stringify({companies:subsidiaries.length}));
