// Player commands only. One quoted company campaign, one supplier payment, no timers or fleet access.
(()=>{
  'use strict';
  const dayOf=state=>Math.max(0,Math.floor((Number(state.simSeconds)||0)/86400));
  function rows(items,isActive,cost){
    const counts=new Map();for(const row of items)if(isActive(row))counts.set(row.country,(counts.get(row.country)||0)+1);
    return items.map(row=>({row,active:isActive(row),cost:isActive(row)?cost(row,Math.max(1,counts.get(row.country)||0)):0}));
  }
  function quote(state,company,rows,duration=30){
    const day=dayOf(state),targets=[],seen=new Set();let total=0;
    for(const item of rows){
      const row=item.row,id=String(row?.id||'');if(!item.active||Number(row.campaignUntil)>day)continue;
      const cost=Number(item.cost);if(!id||seen.has(id)||!Number.isSafeInteger(cost)||cost<=0)throw new Error('campaign-branch-quote-invalid');
      seen.add(id);targets.push({id,cost});total+=cost;
    }
    if(!Number.isSafeInteger(total))throw new Error('campaign-total-invalid');
    targets.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
    const hash=globalThis.GH_AUTHORIZATION?.digest;if(typeof hash!=='function')throw new Error('campaign-quote-owner-unavailable');
    const quoteKey=hash({company,day,duration,targets});
    return {company,day,duration,until:day+duration,count:targets.length,skipped:rows.length-targets.length,total,quoteKey,targets};
  }
  function launch(state,company,root,rows,p={},duration=30,onSpend=null){
    if(!globalThis.GH_TRANSACTION_CORE?.isActive?.())throw new Error('campaign-transaction-required');
    const reference=String(p.reference||'');if(!/^[A-Za-z0-9._:-]{1,120}$/.test(reference))throw new Error('campaign-reference-invalid');
    const prior=root.companyCampaignReceipt;
    if(prior?.reference===reference){if(prior.quoteKey!==p.quoteKey||prior.company!==company)throw new Error('campaign-reference-conflict');return {...prior.result,idempotent:true};}
    const plan=quote(state,company,rows,duration);if(!plan.count)throw new Error('campaign-no-eligible-branches');
    if(typeof p.quoteKey!=='string'||plan.quoteKey!==p.quoteKey)throw new Error('campaign-quote-changed');
    const F=globalThis.GH_FINANCE_CORE;
    if(!(globalThis.GH_FINANCE_CORE?.investorMode?.(state))&&F.operating(state,company)<plan.total)throw new Error('insufficient-cash');
    if(!F.canSpend(state,company,plan.total,'marketing'))throw new Error('insufficient-budget');
    const payment=F.execute({state},'pay-by-cheque',{company,amount:plan.total,line:'marketing',requestRef:reference,
      note:`حملة إعلامية لجميع الفروع المؤهلة · ${plan.count} فرع · ${duration} يومًا · ${reference}`,beneficiary:'وكالة الحملات الإعلامية المعتمدة'});
    if(!payment?.cheque?.id||payment.cheque.status!=='مصروف'||payment.idempotent===true)throw new Error('campaign-payment-receipt-invalid');
    const byId=new Map(rows.map(item=>[String(item.row.id),item.row]));
    for(const target of plan.targets){const row=byId.get(target.id);row.campaignUntil=plan.until;row.campaigns=Math.max(0,Math.floor(Number(row.campaigns)||0))+1;row.campaignSpend=(Number(row.campaignSpend)||0)+target.cost;}
    onSpend?.(plan.total);
    const result={company,count:plan.count,skipped:plan.skipped,cost:plan.total,until:plan.until,chequeId:payment.cheque.id,invoiceNumber:payment.invoice.number,reference};
    root.companyCampaignReceipt={company,reference,quoteKey:plan.quoteKey,result};return result;
  }
  const API=Object.freeze({rows,quote,launch});globalThis.GH_BRANCH_CAMPAIGN=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
