'use strict';
const assert=require('node:assert/strict');
const {harness}=require('./helpers/core-harness');
const {s}=harness(['advanced-core']),A=s.GH_ADVANCED,results=[];
const requests=()=>[1,2].map(i=>({id:'REQ-'+i,expiresDay:7}));
async function run({kind,decision='accept',single=false,page='company',cancel=false,fail=false}){
  const state={simSeconds:0,bank:{loanRequests:requests()},insurance:{riskRequests:requests()},customerCompanies:{companies:{telecom:{market:{requests:requests()}}}}},calls=[],notices=[],uiNotices=[],drawers=[];let kpis=0;
  const action=page==='insurance'?(single?'insurance-decide-risk':'insurance-decide-risks-batch'):page==='bank'?'bank-loan-request':'company-decide-pending';
  const origin=/data-gh-action-origin="([^"]+)"/.exec(A.actionAttributes(action))[1];
  const button={tagName:'BUTTON',dataset:{ghAction:action,ghActionOrigin:origin,kind,company:kind,decision:page==='bank'?(decision==='accept'?'approve':'reject'):page==='insurance'?(decision==='accept'?'accept':'decline'):decision,...(single?{request:'REQ-1',risk:'REQ-1'}:{})},addEventListener(name,fn){if(name==='click')this.click=fn;}};
  const selected=requests().map(row=>({dataset:{insuranceRiskSelect:row.id},checked:true,addEventListener(){}}));
  s.document={querySelectorAll:selector=>selector==='[data-insurance-risk-select]:checked'?selected:[],getElementById:()=>null};
  s.GH_INTERFACE={confirm:async()=>!cancel};s.GH_WORKFLOW={notify:text=>uiNotices.push(text)};
  const result=page==='bank'?{status:decision==='accept'?'موافق':'مرفوض',loanId:'LOAN-1',principal:500000}:page==='insurance'&&single?{status:decision==='accept'?'مقبول':'معتذر عنه',id:'REQ-1',premium:10000}:{approved:2,rejected:0,accepted:2,declined:0,skipped:0,totalPremium:20000,totalInsured:2000000};
  const ctx={state,currentPanel:page==='company'?'company':page,currentArg:page==='company'?kind:{tab:'overview'},fmtMoney:String,fmtNumber:String,pushAlert:text=>uiNotices.push(text),updateKpis(){kpis++;},openDrawer(...args){drawers.push(args);},async runAuthorizedDomainCommand(request){calls.push(request);if(fail)throw Error('injected-save-nack');if(typeof request.successNotice==='function')notices.push(request.successNotice(result));return {ok:true,result};}};
  const root={querySelectorAll:selector=>selector==='[data-gh-action]'?[button]:selector==='[data-insurance-risk-select]'?selected:[],querySelector:()=>null};
  A.bind(root,ctx);await button.click();
  if(cancel){assert.equal(calls.length,0);assert.equal(notices.length,0);assert.equal(uiNotices.length,0);assert.equal(kpis,0);return;}
  assert.equal(calls.length,1);assert.equal(typeof calls[0].successNotice,'function',`${kind}/${page}/${decision}: success notice belongs in the durable draft`);
  if(fail){assert.equal(notices.length,0);assert.equal(uiNotices.length,1,'only the failure notice may be shown');assert(uiNotices[0].includes('injected-save-nack'));return;}
  assert.equal(notices.length,1);assert.equal(uiNotices.length,0,'success must not dispatch another live-state alert after ACK');
  assert.equal(kpis,1,'one presentation refresh');assert.equal(drawers.length,1);const text=typeof notices[0]==='string'?notices[0]:notices[0].text;assert(text.length>0);
  if(page==='company')assert.equal(notices[0].kind,'success');else assert.equal(typeof notices[0],'string','legacy plain alerts must not add a workflow notice event');
  const before=JSON.stringify(state);assert.deepEqual(JSON.parse(JSON.stringify(calls[0].successNotice(result))),JSON.parse(JSON.stringify(notices[0])));assert.equal(JSON.stringify(state),before,'notice builder reads the committed result without writing state');
  results.push({kind,page,decision,single,notice:text});
}
(async()=>{
 for(const kind of ['bank','insurance','telecom'])for(const decision of ['accept','reject'])for(const single of [false,true])await run({kind,decision,single});
 for(const decision of ['accept','reject']){await run({kind:'bank',page:'bank',decision,single:true});for(const single of [true,false])await run({kind:'insurance',page:'insurance',decision,single});}
 for(const kind of ['bank','insurance','telecom'])for(const decision of ['accept','reject']){await run({kind,decision,cancel:true});await run({kind,decision,fail:true});}
 console.log(JSON.stringify({suite:'build431-decision-notices',successCases:results.length,cancelCases:6,failedSaveCases:6,results},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
