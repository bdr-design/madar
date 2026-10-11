'use strict';

// Authorization owner for one commercial bulk-purchase intent.  This command
// records the signed compact order and its SHA-256 digest exactly once; row
// staging and the finance/delivery mutations remain in the enclosing durable
// purchase transaction.
((root,factory)=>{
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root){root.GH_ASSET_PURCHASE_DOMAIN_CORE=api;if(root.GH_DOMAIN_COMMANDS&&root.GH_AUTHORIZATION&&root.GH_ASSET_PURCHASE_ORDER_CORE)api.install();}
})(typeof globalThis!=='undefined'?globalThis:this,root=>{
  const VERSION='1.0.0',DOMAIN='asset-purchase',COMMAND='authorize-order';let installed=false;
  const orderCore=()=>root.GH_ASSET_PURCHASE_ORDER_CORE;
  const authorization=()=>root.GH_AUTHORIZATION;
  const compactResult=(payload,meta)=>Object.freeze({
    schema:'gh-asset-purchase-intent-receipt-v1',
    commandId:String(meta?.id||''),
    requestRef:String(payload.order.requestRef),
    orderDigest:String(payload.orderDigest),
    orderFingerprint:String(payload.orderFingerprint),
    availabilityFingerprint:String(payload.availabilityFingerprint),
    ownerCompanyId:String(payload.ownerCompanyId),
    assetMode:String(payload.assetMode),
    count:Number(payload.count),
    allocationCount:payload.order.allocations.length,
    totalUpfront:Number(payload.totalUpfront)
  });
  const owner=Object.freeze({
    VERSION,
    validate(_ctx,name,payload){
      if(String(name)!==COMMAND)return {ok:false,reason:'asset-purchase-intent-command'};
      return orderCore()?.validateCommandPayload?.(payload,{authorization:authorization()})===true?true:{ok:false,reason:'asset-purchase-intent-invalid'};
    },
    execute(_ctx,name,payload,meta){if(String(name)!==COMMAND)throw new Error('asset-purchase-intent-command');return compactResult(payload,meta);},
    validateResult(name,result,payload){
      if(String(name)!==COMMAND||!result||result.schema!=='gh-asset-purchase-intent-receipt-v1')return false;
      return result.requestRef===payload.order.requestRef&&result.orderDigest===payload.orderDigest&&result.orderFingerprint===payload.orderFingerprint&&result.availabilityFingerprint===payload.availabilityFingerprint&&result.ownerCompanyId===payload.ownerCompanyId&&result.assetMode===payload.assetMode&&Object.is(result.count,payload.count)&&Object.is(result.totalUpfront,payload.totalUpfront)&&result.allocationCount===payload.order.allocations.length;
    }
  });
  const targetResolver=({payload})=>[String(payload?.ownerCompanyId||'')];
  function install({domainCommands=root.GH_DOMAIN_COMMANDS,authorizationOwner=root.GH_AUTHORIZATION}={}){
    if(installed)return owner;
    if(!domainCommands?.register||!authorizationOwner?.registerCommandTargetResolver||!orderCore()?.validateCommandPayload)throw new Error('asset-purchase-intent-owner-dependencies');
    authorizationOwner.registerCommandTargetResolver(DOMAIN,targetResolver);domainCommands.register(DOMAIN,owner);installed=true;return owner;
  }
  return Object.freeze({VERSION,DOMAIN,COMMAND,owner,targetResolver,install,isInstalled:()=>installed});
});
