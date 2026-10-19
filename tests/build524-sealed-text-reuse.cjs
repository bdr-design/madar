'use strict';
// Emulated phone (20k assets, every company): each save stringified the roots outside the codec's collections whole,
// about 470K characters per save, a third of them in sealed values (final finance documents, ledger rows, proof
// checkpoints). The codec now keeps a sealed value's text with it and reuses it. Proven with the real codec and
// transaction core, against a fresh codec (no cache) in its own realm:
//  1. a second save reuses the sealed texts and is identical to a fresh codec's save and decodes to the live state;
//  2. a sealed document replaced by another (a new object) is written anew; an open document edited in place is
//     written as edited (open values are never kept);
//  3. a sealed value cannot be edited in place (strict mode throws), so a kept text cannot go stale;
//  4. values under 256 characters are not kept, and nothing outside sealed values is kept.
const assert=require('node:assert/strict'),path=require('node:path');
const ROOT=process.env.GH_TEST_SOURCE_DIR||path.resolve(__dirname,'..');
const {harness}=require(path.join(ROOT,'tests/helpers/core-harness'));
const realm=()=>harness(['transaction-core','state-codec-core']).s;
const live=realm(),C=live.GH_STATE_CODEC,T=live.GH_TRANSACTION_CORE;
const doc=(i,status='مدفوعة')=>({number:`INV-${i}`,company:'air',status,amount:1000+i,lines:Array.from({length:6},(_,n)=>({n,amount:i+n,note:`بند ${n} للمستند ${i}`})),proof:{id:`PRF-${i}`,digest:'x'.repeat(64)}});
const sealed=row=>{assert.ok(T.sealValue(row));return row;};
// Root arrays under the collection minimum (64 rows), so they are stringified with their root.
const state={saveVersion:'3.0.0',saveRevision:1,finance:{invoices:[...Array.from({length:20},(_,i)=>sealed(doc(i))),doc(99,'مسودة')],note:'x',small:sealed({a:1})},treasury:{ledger:Array.from({length:30},(_,i)=>sealed({id:`TL-${i}`,amount:i,memo:'تحويل خزينة '.repeat(20)}))}};
const save=(codec=C,target=state)=>{const steps=codec.serializeSteps(target,{});let step;while(!(step=steps.next()).done){}return step.value;};
const fresh=()=>save(realm().GH_STATE_CODEC,JSON.parse(JSON.stringify(state)));
const stats=()=>({...C.cacheStats().sealedText});
const decoded=text=>JSON.stringify(realm().GH_STATE_CODEC.deserialize(text,{}).finance)+JSON.stringify(realm().GH_STATE_CODEC.deserialize(text,{}).treasury);
const liveText=()=>JSON.stringify(state.finance)+JSON.stringify(state.treasury);
// 1. Reuse and exactness.
const first=save(),afterFirst=stats();assert.equal(first,fresh(),'the first save equals a fresh codec');assert.ok(afterFirst.stored>=50,`sealed texts kept (${afterFirst.stored})`);
const second=save(),afterSecond=stats();assert.equal(second,first,'an unchanged second save is identical');assert.ok(afterSecond.hits-afterFirst.hits>=50,`the second save reuses them (${afterSecond.hits-afterFirst.hits})`);
assert.equal(decoded(second),liveText(),'the save decodes to the live state');
// 2. A replaced sealed document and an open document edited in place.
state.finance.invoices[3]=sealed(doc(3,'ملغاة'));state.finance.invoices[20].amount=777;
const third=save();assert.equal(third,fresh(),'the replaced and the edited documents are written as they are now');assert.ok(third.includes('ملغاة')&&third.includes('777'));assert.equal(decoded(third),liveText());
// 3. A sealed value cannot be edited in place.
assert.throws(()=>{state.finance.invoices[0].amount=1;},TypeError);assert.throws(()=>{state.treasury.ledger[0].memo='y';},TypeError);
// 4. Small sealed values are not kept; open values never.
{const s=realm(),codec=s.GH_STATE_CODEC,small={saveVersion:'3.0.0',saveRevision:1,finance:{tiny:Array.from({length:10},(_,i)=>{const v={i};s.GH_TRANSACTION_CORE.sealValue(v);return v;}),open:doc(5,'مسودة')}};
  const steps=codec.serializeSteps(small,{});let step;while(!(step=steps.next()).done){}assert.equal(codec.cacheStats().sealedText.stored,0,'nothing under 256 characters and nothing open is kept');}
console.log(JSON.stringify({suite:'build524-sealed-text-reuse',ok:true,stored:afterFirst.stored,reused:afterSecond.hits-afterFirst.hits}));
