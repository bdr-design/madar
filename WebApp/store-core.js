// Owner (approved design «فنتورا: تصميم المستويات وتجهيز الإطلاق», section «الاشتراكات والمشتريات», and «تسريع الوقت
// خل عليه عملية شراء»): the store edition sells comfort and time, never levels or companies. The products, what each
// one grants, and the one signed command (store:deliver) that writes a verified store transaction into the save exactly
// once. The native shell (StoreKit 2 / Play Billing) verifies the transaction, asks the game to deliver it, and tells the
// store it was delivered only after the save that holds it is stored; a transaction delivered before is answered, not
// delivered again.
// Paid limits apply to the store edition only (GH_EDITION 'release'): the development edition keeps investor mode, the
// 300× speed and the long calendar advances free, as before.
(function(root,factory){const api=factory();if(root){root.GH_STORE_CORE=api;api.install();}if(typeof module!=='undefined'&&module.exports)module.exports=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const VERSION='1.0.0',SCHEMA=1,DOMAIN='store',DELIVER='deliver',REVOKE='revoke',STORES=Object.freeze(['app-store','play']);
  // Product ids are the store's: the bundle prefix is the app's (set at release; the suffix is the product).
  const PRODUCTS=Object.freeze({
    'plus.monthly':Object.freeze({kind:'subscription',grants:'plus',title:'أصول ونفوذ بلس · شهري',price:'4.99'}),
    'plus.yearly':Object.freeze({kind:'subscription',grants:'plus',title:'أصول ونفوذ بلس · سنوي',price:'39.99'}),
    'investor.licence':Object.freeze({kind:'permanent',grants:'investor',title:'رخصة المستثمر',price:'9.99'}),
    'time.accelerator':Object.freeze({kind:'permanent',grants:'accelerator',title:'مسرّع الوقت',price:'2.99'}),
    'starter.pack':Object.freeze({kind:'once',capital:[5000000,5000000,5000000],title:'حزمة البداية',price:'2.99',days:7}),
    'capital.small':Object.freeze({kind:'consumable',capital:[5000000],title:'حزمة رأس مال صغيرة',price:'0.99'}),
    'capital.medium':Object.freeze({kind:'consumable',capital:[30000000],title:'حزمة رأس مال متوسطة',price:'4.99'}),
    'capital.large':Object.freeze({kind:'consumable',capital:[70000000],title:'حزمة رأس مال كبيرة',price:'9.99'}),
    'capital.huge':Object.freeze({kind:'consumable',capital:[160000000],title:'حزمة رأس مال ضخمة',price:'19.99'})
  });
  // What each entitlement opens. Plus includes the time accelerator.
  const BENEFITS=Object.freeze({plus:'خبرة +25% · رسوم الترخيص المبكر بنصف السعر · الطيار الآلي من المستوى 1 · مسرّع الوقت',investor:'وضع المستثمر بشكل دائم: كل القيود مرفوعة والمال لا نهائي',accelerator:'السرعة 300× وتقديم التقويم بأسبوع وشهر وسنة'});
  const own=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
  const plainObject=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
  function release(){return globalThis.GH_EDITION==='release';}
  function root(state){return plainObject(state?.purchases)?state.purchases:null;}
  function ensure(state){if(!plainObject(state.purchases))state.purchases={schema:SCHEMA,entitlements:{},deliveries:{}};if(!plainObject(state.purchases.entitlements))state.purchases.entitlements={};if(!plainObject(state.purchases.deliveries))state.purchases.deliveries={};return state.purchases;}
  function nowSeconds(state){return Math.max(0,Number(state?.simSeconds)||0);}
  // An entitlement held now. A subscription holds until its store expiry (real time, epoch milliseconds, from the store:
  // StoreKit's signed expiry, or Play's confirmation at a trusted network time plus three days).
  // Owner (approved «أ», no server): the clock never runs backwards for an expiry. The save keeps the latest real time it
  // has seen (clockHigh: each player command, each delivery and each store confirmation); setting the phone's date back
  // cannot bring an expired subscription back, and setting it forward only ends one sooner. Game time never reads the
  // phone's clock (it advances only while playing), so no date change gives money or progress.
  function clockOf(state,clock){const high=Number(root(state)?.clockHigh);return Math.max(Number(clock)||0,Number.isFinite(high)?high:0);}
  function entitled(state,id,clock=Date.now()){const row=root(state)?.entitlements?.[id];if(!plainObject(row))return false;if(Number.isFinite(Number(row.expiresAt))&&Number(row.expiresAt)>0)return Number(row.expiresAt)>clockOf(state,clock);return true;}
  // In a player command's transaction (GH_DOMAIN_COMMANDS): one number, only in a save holding a subscription (the only
  // entitlement that reads the clock); every other save is left as it is.
  function expiring(p){for(const row of Object.values(p.entitlements||{}))if(plainObject(row)&&Number(row.expiresAt)>0)return true;return false;}
  function noteClock(state,clock=Date.now()){const p=root(state);if(!p||!expiring(p))return;const now=Number(clock);if(Number.isFinite(now)&&now>(Number(p.clockHigh)||0))p.clockHigh=Math.floor(now);}
  // A paid feature is open in the development edition, and in the store edition with its entitlement.
  function featureOpen(state,feature){if(!release())return true;if(feature==='investor')return entitled(state,'investor');if(feature==='accelerator')return entitled(state,'accelerator')||entitled(state,'plus');return true;}
  // The capital a pack invests: its base × (1 + the career level ÷ 5); level 1 outside a career.
  function packAmount(state,base){const level=globalThis.GH_PROGRESSION_CORE?.level?.(state)||1;return Math.round(Number(base)*(1+level/5));}
  function productOf(productId){const id=String(productId||'');const suffix=Object.keys(PRODUCTS).find(key=>id===key||id.endsWith(`.${key}`));return suffix?{suffix,product:PRODUCTS[suffix]}:null;}
  // A revoked transaction (refunded by the store), found by its id or, for a Play subscription's daily confirmation
  // ("<order>.cYYYYMMDD"), by its order.
  function revokedRow(state,transactionId){const rows=root(state)?.revocations;if(!plainObject(rows))return null;const id=String(transactionId||'');return rows[id]||rows[id.replace(/\.c\d{8}$/,'')]||null;}
  function validateDelivery(state,payload={}){
    const transactionId=String(payload.transactionId||'').trim(),found=productOf(payload.productId);
    if(!/^[A-Za-z0-9._:-]{1,96}$/.test(transactionId))return 'store-transaction-invalid';if(!found)return 'store-product-unknown';
    if(payload.store!==undefined&&!STORES.includes(payload.store))return 'store-name-invalid';
    if(revokedRow(state,transactionId))return 'store-transaction-revoked';
    if(found.product.kind==='subscription'&&!(Number(payload.expiresAt)>0))return 'store-subscription-expiry-required';
    // The same transaction again is a replay (execute answers it with its first delivery and the shell may finish it).
    if(found.product.kind==='once'&&!root(state)?.deliveries?.[transactionId]&&root(state)?.entitlements?.[found.suffix])return 'store-once-already-delivered';
    return null;
  }
  function validateRevocation(state,payload={}){
    const transactionId=String(payload.transactionId||'').trim();
    if(!/^[A-Za-z0-9._:-]{1,96}$/.test(transactionId))return 'store-transaction-invalid';if(!productOf(payload.productId))return 'store-product-unknown';
    return null;
  }
  // Owner («نعم تسحب»): a purchase the store refunds is taken back. store:revoke (signed, once per transaction) removes
  // what that transaction granted (investor licence, accelerator, Plus; the starter pack's "bought once" mark stays) and
  // takes back the capital it added: a founder withdrawal from the holding's current account (document and journal, as
  // every founder transfer), never more than the account holds, so no account goes negative; what was already spent is
  // recorded as unrecovered. A revoked transaction is never delivered again.
  function revoke(state,payload,meta){
    const store=ensure(state),transactionId=String(payload.transactionId),found=productOf(payload.productId);
    if(!plainObject(store.revocations))store.revocations={};
    if(store.revocations[transactionId])return {...store.revocations[transactionId],replay:true};
    const row={transactionId,product:found.suffix,at:nowSeconds(state),entitlements:[],withdrawn:0,unrecovered:0,documents:[],commandId:String(meta?.id||'')};
    const ofThis=id=>{id=String(id||'');return id===transactionId||id.replace(/\.c\d{8}$/,'')===transactionId;};
    for(const [key,held] of Object.entries(store.entitlements))if(key!==found.suffix&&plainObject(held)&&ofThis(held.transactionId)){delete store.entitlements[key];row.entitlements.push(key);}
    const capital=Number(store.deliveries[transactionId]?.capital)||0;
    if(capital>0){
      const finance=globalThis.GH_FINANCE_CORE;if(!finance?.execute||typeof finance.operating!=='function')throw new Error('store-finance-owner-unavailable');
      const amount=Math.min(capital,Math.max(0,Math.floor(Number(finance.operating(state,'group'))||0)));
      if(amount>0){const ref=`STORE-REVOKE-${transactionId}`;finance.execute({state},'founder-withdrawal',{company:'group',amount,ref,note:`${found.product.title} · استرداد المتجر`});row.withdrawn=amount;row.documents.push(ref);}
      row.unrecovered=capital-row.withdrawn;
    }
    store.revocations[transactionId]=row;return {...row};
  }
  const owner=Object.freeze({
    VERSION,
    validate(ctx,name,payload={}){name=String(name);if(name!==DELIVER&&name!==REVOKE)return {ok:false,reason:'store-command'};const reason=name===REVOKE?validateRevocation(ctx?.state||ctx,payload):validateDelivery(ctx?.state||ctx,payload);return reason?{ok:false,reason}:true;},
    execute(ctx,name,payload={},meta={}){
      name=String(name);
      if(name===REVOKE){const state=ctx?.state||ctx,reason=validateRevocation(state,payload);if(reason)throw new Error(reason);return revoke(state,payload,meta);}
      if(name!==DELIVER)throw new Error('store-command');const state=ctx?.state||ctx,reason=validateDelivery(state,payload);if(reason)throw new Error(reason);
      const store=ensure(state),transactionId=String(payload.transactionId),found=productOf(payload.productId),product=found.product;
      // A transaction delivered before is answered with its first delivery (the native shell may ask again after a restart).
      // A subscription delivery never shortens what is held: transactions may arrive in any order (StoreKit's unfinished
      // list has none), so an older renewal arriving last, or a lifetime grant already held, keeps the later expiry.
      if(store.deliveries[transactionId])return {...store.deliveries[transactionId],replay:true};
      const delivery={transactionId,product:found.suffix,at:nowSeconds(state),capital:0,documents:[],commandId:String(meta?.id||'')};if(payload.store)delivery.store=payload.store;
      if(product.grants){const row={product:found.suffix,transactionId,since:nowSeconds(state)};if(payload.store)row.store=payload.store;if(product.kind==='subscription')row.expiresAt=Number(payload.expiresAt);const prior=store.entitlements[product.grants];if(!(product.kind==='subscription'&&plainObject(prior)&&(!(Number(prior.expiresAt)>0)||Number(prior.expiresAt)>row.expiresAt)))store.entitlements[product.grants]=row;if(product.kind==='subscription'){noteClock(state);if(Number(payload.confirmedAt)>0)noteClock(state,Number(payload.confirmedAt));}}
      if(product.kind==='once')store.entitlements[found.suffix]={product:found.suffix,transactionId,since:nowSeconds(state)};
      if(Array.isArray(product.capital)){const finance=globalThis.GH_FINANCE_CORE;if(!finance?.execute)throw new Error('store-finance-owner-unavailable');
        product.capital.forEach((base,index)=>{const amount=packAmount(state,base),ref=`STORE-${transactionId}-${index+1}`;finance.execute({state},'founder-investment',{company:'group',amount,ref,note:`${product.title} · استثمار المؤسس`});delivery.capital+=amount;delivery.documents.push(ref);});}
      store.deliveries[transactionId]=delivery;return {...delivery};
    },
    validateResult(name,result,payload){return (String(name)===DELIVER||String(name)===REVOKE)&&!!result&&result.transactionId===String(payload?.transactionId||'');}
  });
  let installed=false;
  function install({domainCommands=globalThis.GH_DOMAIN_COMMANDS,authorizationOwner=globalThis.GH_AUTHORIZATION}={}){
    if(installed)return owner;if(!domainCommands?.register||!authorizationOwner?.registerCommandTargetResolver)return null;
    authorizationOwner.registerCommandTargetResolver(DOMAIN,()=>['group']);domainCommands.register(DOMAIN,owner);installed=true;return owner;
  }
  // Save validation (GH_SAVE_SCHEMA): an absent root is a save without purchases.
  function validate(state){
    const s=state?.purchases;if(s===undefined)return [];if(!plainObject(s)||s.schema!==SCHEMA||!plainObject(s.entitlements)||!plainObject(s.deliveries))return ['store-shape'];const errors=[];
    for(const [id,row] of Object.entries(s.entitlements))if(!plainObject(row)||!(own(BENEFITS,id)||own(PRODUCTS,id))||!row.transactionId)errors.push('store-entitlement');
    for(const [id,row] of Object.entries(s.deliveries))if(!plainObject(row)||row.transactionId!==id||!own(PRODUCTS,row.product))errors.push('store-delivery');
    if(s.clockHigh!==undefined&&!(Number.isSafeInteger(s.clockHigh)&&s.clockHigh>=0))errors.push('store-clock');
    if(s.revocations!==undefined){if(!plainObject(s.revocations))errors.push('store-revocation');else for(const [id,row] of Object.entries(s.revocations))if(!plainObject(row)||row.transactionId!==id||!own(PRODUCTS,row.product)||!(Number(row.withdrawn)>=0)||!(Number(row.unrecovered)>=0))errors.push('store-revocation');}
    return errors;
  }
  // Whether the starter pack can still be offered (its first 7 game days, once).
  function starterOffered(state){return !root(state)?.entitlements?.['starter.pack']&&Math.floor(nowSeconds(state)/86400)<PRODUCTS['starter.pack'].days;}
  return Object.freeze({VERSION,SCHEMA,DOMAIN,DELIVER,REVOKE,STORES,PRODUCTS,BENEFITS,release,entitled,noteClock,clockOf,featureOpen,packAmount,productOf,validate,starterOffered,owner,install,isInstalled:()=>installed});
});
