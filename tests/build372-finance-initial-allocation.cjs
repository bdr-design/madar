'use strict';
// The one-time finance-book migration must preserve the former allocation
// exactly while reading fleet ownership once, rather than once per company.
const assert=require('node:assert/strict'),path=require('node:path');
const web=path.join(path.resolve(__dirname,'..'),'WebApp'),load=name=>require(path.join(web,name));
const STORE=load('fleet-store-core.js'),DATA=load('fleet-access-core.js');

const companies=['air','sea','road'];
const definitions=Object.fromEntries(companies.map(id=>[id,{id,capabilities:['finance.book'],classification:{assetClasses:[`${id}-asset`],routeModes:[id]}}]));
global.GH_COMPANY_PLATFORM={
  listInstances:(_state,{includeGroup=true}={})=>[...(includeGroup?[{id:'group',known:true,registered:true,opened:true,definition:{id:'group',capabilities:['finance.book'],classification:{assetClasses:[],routeModes:[]}}}]:[]),...companies.map(id=>({id,known:true,registered:true,opened:true,definition:definitions[id]}))],
  resolveCompany:(_state,id)=>id==='group'?{id,known:true,registered:true,opened:true,operational:true,definition:{id:'group',capabilities:['finance.book'],classification:{assetClasses:[],routeModes:[]}}}:definitions[id]?{id,known:true,registered:true,opened:true,operational:true,definition:definitions[id]}:null,
  requireCompany:(state,id)=>{const row=global.GH_COMPANY_PLATFORM.resolveCompany(state,id);if(!row)throw new Error(`company-not-found:${id}`);return row;},
  resolveDocumentProfile:(_state,id)=>({legalName:id,accountPrefix:id.toUpperCase(),documentPrefix:id.toUpperCase()}),
  resolveIdentity:(_state,id)=>({legalName:id}),ownerForLegacyAssetMode:mode=>companies.includes(mode)?mode:null
};

const source=[];
for(const [owner,count] of [['air',12000],['sea',7000],['road',3000]])for(let index=0;index<count;index++)source.push({id:`${owner.toUpperCase()}-${index}`,ownerCompanyId:owner,assetMode:owner,type:owner});
const state={simSeconds:0,openedCompanies:companies.slice(),companyRegistry:Object.fromEntries(companies.map(id=>[id,{id}])),companyBudgets:{},finance:{},companyFinance:{},treasury:{accounts:[{id:'GH-OPER-001',name:'Operating',currency:'USD',balance:123456789}],ledger:[],paymentQueue:[]},fleet:STORE.fromAssets(source),cash:0,debt:0,godMoney:false,infiniteMoney:false};

let classCallbacks=0;
global.GH_FLEET_DATA={...DATA,
  count:()=>{throw new Error('finance-allocation-repeated-row-scan');},
  forEachFieldClasses:(target,fields,fn,options)=>DATA.forEachFieldClasses(target,fields,(row,count,info)=>{classCallbacks++;return fn(row,count,info);},options)
};
const FINANCE=load('finance-core.js'),opening=state.treasury.accounts[0].balance,pool=Math.max(0,Number(opening)||0)*.55;

// Former formula, calculated independently from the source rows.
const counts=new Map();for(const asset of source)counts.set(asset.ownerCompanyId,(counts.get(asset.ownerCompanyId)||0)+1);
const weights=companies.map(id=>[id,Math.max(1,(counts.get(id)||0)*2+1)]),sum=weights.reduce((total,row)=>total+row[1],0);let allocated=0;
const expected={};weights.forEach(([id,weight],index)=>{const amount=index===weights.length-1?Math.max(0,pool-allocated):Math.floor(pool*weight/sum);expected[id]=amount;allocated+=amount;});

FINANCE.ensure(state);
for(const id of companies)assert.equal(state.companyFinance[id].accounts[0].balance,expected[id],`${id} allocation changed`);
assert.equal(state.treasury.accounts[0].balance,opening-allocated,'holding cash changed');
assert.ok(classCallbacks<=4,`expected ownership classes, saw ${classCallbacks} callbacks`);
assert.equal(FINANCE.ensure(state),state.companyFinance,'second ensure remains idempotent');
console.log(JSON.stringify({ok:true,assets:source.length,classCallbacks,allocations:expected}));
